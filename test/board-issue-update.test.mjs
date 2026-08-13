// Tests fuer `board.mjs issue update` (Issue #237).
//
// Der Adapter konnte Issues anlegen, lesen, listen, verschieben und kommentieren —
// aber keinen Body schreiben. Aufgefallen ist das erst mit /issue-review: Dessen
// Schritt 6 schreibt den geschaerften Body und setzt die Marker-Zeile, und ohne
// Adapter-Kommando ginge das nur an ihm vorbei (`gh issue edit`), also
// provider-gebunden.
//
// Geprueft wird vor allem eines: dass ein Body mit Backticks, Anfuehrungszeichen,
// Command-Substitution und Zeilenumbruechen **byte-identisch** ankommt. Das ist die
// Stelle, an der ein Shell-Aufruf falsch waere (Issue #196).
//
// Seit Issue #303 liest `issue update` den alten Body, BEVOR es schreibt — die
// Pruefvorgabe-Leitplanke braucht den Vergleich. Alle vier Adapterfaelle mocken
// deshalb auch den Lesebefehl; ein Mock, der nur den Schreibbefehl kennt, faellt
// hier durch. Der Lesefehler-Test haelt fest, was daran die Hauptsache ist: kein
// Schreibzugriff auf halbem Wissen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, fakeCli, runBoard, board, aufrufe, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};

// Der Haerte-Fall: alles, was eine Kommandozeile zerlegen wuerde.
const BOESER_BODY = [
  "## Kontext",
  "",
  "Autor-Modell: claude-opus-5",
  'Ein Zitat mit "doppelten" und \'einfachen\' Anfuehrungszeichen.',
  "Ein Codeblock:",
  "```js",
  "const x = `template ${literal}`;",
  "```",
  "Command-Substitution: $(rm -rf /) und `echo boom`",
  "Ein Backslash: C:\\bin\\codex.cmd",
  "",
  "## Abhaengigkeiten",
  "",
  "Keine.",
].join("\n");

// --- Lokaler Tracker: echter Roundtrip ohne Mock ---

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitLokal(fn) {
  const dir = setupProjekt(LOKAL, "board-update-local-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("issue update: lokaler Roundtrip liefert den geschriebenen Body zurueck", () => {
  mitLokal((dir) => {
    const { id } = board(dir, "issue", "create", "--title", "Testissue", "--body", "## Kontext\n\nalt\n");
    const res = runBoard(dir, ["issue", "update", String(id), "--body", BOESER_BODY]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).ok, true);

    const nachher = board(dir, "issue", "get", String(id));
    assert.equal(nachher.body.trim(), BOESER_BODY.trim());
  });
});

test("issue update: der Frontmatter bleibt unangetastet", () => {
  // Nur der Body wird ersetzt — Status, Titel und Labels gehoeren anderen Kommandos.
  mitLokal((dir) => {
    const { id } = board(dir, "issue", "create", "--title", "Bleibt so", "--body", "alt");
    board(dir, "issue", "move", String(id), "ready");
    board(dir, "issue", "update", String(id), "--body", "neu");

    const nachher = board(dir, "issue", "get", String(id));
    assert.equal(nachher.title, "Bleibt so");
    assert.equal(nachher.status, "ready");
    assert.equal(nachher.body.trim(), "neu");
  });
});

test("issue update: ein leerer Body ist ein harter Fehler", () => {
  // Ein versehentlich geleerter Issue-Body ist nicht wiederherstellbar — deshalb
  // ein Abbruch statt eines stillen No-ops.
  mitLokal((dir) => {
    const { id } = board(dir, "issue", "create", "--title", "Bleibt erhalten", "--body", "Autor-Modell: m\nwichtiger Inhalt");

    const leer = runBoard(dir, ["issue", "update", String(id), "--body", ""]);
    assert.notEqual(leer.status, 0);
    assert.match(leer.stderr, /--body/);

    const ohne = runBoard(dir, ["issue", "update", String(id)]);
    assert.notEqual(ohne.status, 0);
    assert.match(ohne.stderr, /--body/);

    // Nichts veraendert.
    assert.equal(board(dir, "issue", "get", String(id)).body.trim(), "Autor-Modell: m\nwichtiger Inhalt");
  });
});

test("issue update: ohne id bricht es mit Meldung ab", () => {
  mitLokal((dir) => {
    const res = runBoard(dir, ["issue", "update", "--body", "egal"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /id/i);
  });
});

test("issue update: ein unbekanntes Issue bricht ab", () => {
  mitLokal((dir) => {
    const res = runBoard(dir, ["issue", "update", "4711", "--body", "egal"]);
    assert.notEqual(res.status, 0);
  });
});

// --- GitHub ---

const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };

test("issue update: GitHub ruft 'gh issue edit' mit unveraendertem Body", NUR_POSIX, () => {
  const dir = setupProjekt(GITHUB, "board-update-gh-");
  try {
    fakeCli(dir, "gh", [
      { match: "^repo view", stdout: "besitzer/mein-repo\n" },
      { match: "^issue view", stdout: { number: 42, title: "T", body: "## Kontext\n\nalt\n", state: "OPEN", comments: [] } },
      { match: "^issue edit", stdout: "" },
    ]);
    const res = runBoard(dir, ["issue", "update", "42", "--body", BOESER_BODY]);
    assert.equal(res.status, 0, res.stderr);

    const alle = aufrufe(dir, "gh");
    const call = alle.find((a) => a[0] === "issue" && a[1] === "edit");
    assert.ok(call, "gh issue edit wurde nicht aufgerufen");
    assert.deepEqual(call.slice(0, 3), ["issue", "edit", "42"]);
    assert.ok(call.includes("--repo"));
    // Der Kern: der Body kommt als EIN Argument an, byte-identisch.
    assert.ok(call.includes(BOESER_BODY), "Body kam nicht unveraendert an");
    // Read-before-write (Issue #303): Ohne den alten Body gaebe es nichts zu vergleichen.
    const gelesen = alle.findIndex((a) => a[0] === "issue" && a[1] === "view");
    assert.ok(gelesen !== -1, "der alte Body wurde nicht gelesen");
    assert.ok(gelesen < alle.indexOf(call), "gelesen wurde erst nach dem Schreiben");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("issue update: ein Lesefehler loest keinen Schreibzugriff aus", NUR_POSIX, () => {
  // Die gefaehrlichste Variante eines halben Wissens: Der alte Body ist unbekannt,
  // also ist auch unbekannt, ob der neue die Pruefung verringert. Dann lieber nicht
  // schreiben — ein durchgewinktes Update waere genau der Bypass, den #303 schliesst.
  const dir = setupProjekt(GITHUB, "board-update-gh-lesefehler-");
  try {
    fakeCli(dir, "gh", [
      { match: "^repo view", stdout: "besitzer/mein-repo\n" },
      { match: "^issue view", stderr: "GraphQL: Could not resolve\n", exit: 1 },
      { match: "^issue edit", stdout: "" },
    ]);
    const res = runBoard(dir, ["issue", "update", "42", "--body", BOESER_BODY]);
    assert.notEqual(res.status, 0, "ein Lesefehler muss den Aufruf beenden");

    assert.ok(
      !aufrufe(dir, "gh").some((a) => a[0] === "issue" && a[1] === "edit"),
      "trotz Lesefehler wurde geschrieben",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- GitLab ---

const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };

test("issue update: GitLab ruft 'glab issue update' mit --description", NUR_POSIX, () => {
  const dir = setupProjekt(GITLAB, "board-update-glab-");
  try {
    fakeCli(dir, "glab", [
      { match: "^issue view", stdout: { iid: 7, title: "T", description: "## Kontext\n\nalt\n", state: "opened", labels: [] } },
      { match: "^api projects", stdout: [] },
      { match: "^issue update", stdout: "" },
    ]);
    const res = runBoard(dir, ["issue", "update", "7", "--body", BOESER_BODY]);
    assert.equal(res.status, 0, res.stderr);

    assert.ok(
      aufrufe(dir, "glab").some((a) => a[0] === "issue" && a[1] === "view"),
      "der alte Body wurde nicht gelesen (Issue #303)",
    );
    const call = aufrufe(dir, "glab").find((a) => a[0] === "issue" && a[1] === "update");
    assert.ok(call, "glab issue update wurde nicht aufgerufen");
    assert.deepEqual(call.slice(0, 3), ["issue", "update", "7"]);
    assert.ok(call.includes("--description"));
    assert.ok(call.includes(BOESER_BODY), "Body kam nicht unveraendert an");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Toolbox (HTTP) ---

test("issue update: Toolbox schickt den Body an das Item", async () => {
  const KARTE = { id: 900, number: 9, title: "T", body: "## Kontext\n\nalt\n", column: "BACKLOG", position: 0 };
  const { server, requests, host } = await starteServer((req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") {
      return { status: 200, json: { BACKLOG: [KARTE] } };
    }
    return { status: 200, json: { ok: true } };
  });
  const dir = setupProjekt(
    { codeHost: "local", issueTracker: "toolbox", toolbox: { host } },
    "board-update-tbx-",
  );
  try {
    const res = await runBoardAsync(dir, ["issue", "update", "9", "--body", BOESER_BODY], { TBX_TOKEN: "test-token" });
    assert.equal(res.status, 0, res.stderr);

    const schreibend = requests.find((r) => r.method !== "GET" && r.url.includes("/items/900"));
    assert.ok(schreibend, "kein Schreibzugriff auf das Item");
    assert.equal(JSON.parse(schreibend.body).body, BOESER_BODY);
    // Read-before-write (Issue #303): Der Lesezugriff liegt vor dem Schreibzugriff.
    assert.ok(
      requests.indexOf(requests.find((r) => r.method === "GET")) < requests.indexOf(schreibend),
      "der alte Body wurde nicht vor dem Schreiben gelesen",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});

// --- Grammatik ---

test("cli-grammar kennt 'gh issue edit'", () => {
  // Ohne Eintrag akzeptiert das Fake-CLI alles — genau so lief 'glab issue note create'
  // monatelang gruen durch die Suite (Issue #216/#217).
  const pfad = join(import.meta.dirname, "fixtures", "cli-grammar.json");
  const grammatik = JSON.parse(readFileSync(pfad, "utf-8"));
  assert.ok(grammatik.gh["issue edit"], "'gh issue edit' fehlt in der Grammatik");
  assert.equal(grammatik.gh["issue edit"].args, 1);
});
