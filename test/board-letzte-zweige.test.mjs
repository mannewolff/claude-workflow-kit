// Die letzten erreichbaren Verzweigungen in kit/board.mjs (Issue #405).
//
// Was hier steht, sind Rueckfaelle auf Werte, die von aussen kommen: die Umgebung
// (HOME statt TBX_CONFIG_DIR), ein Flag ohne Wert, ein Ticket ohne Body, ein
// Reviewer-Kommando, das gar nicht existiert, eine Karte ohne Titel und ohne Labels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setupProjekt, runBoard, runBoardAsync, board, starteServer } from "./helpers/board-fixture.mjs";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Fake ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197." }
  : {};

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn, config = LOKAL, praefix = "board-letzte-") {
  const dir = setupProjekt(config, praefix);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// Der tbx-Login unter HOME
// ============================================================

test("ohne TBX_CONFIG_DIR wird der tbx-Login unter HOME gesucht", async () => {
  const { server, requests, host } = await starteServer((req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") return { status: 200, json: {} };
    return null;
  });
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox" }, "board-letzte-home-");
  try {
    // Host UND Token kommen aus dem Login unter HOME — der Weg, den ein frisch
    // eingerichteter Rechner geht. TBX_CONFIG_DIR ist nur der Test-Hook.
    const login = join(dir, "home", ".config", "toolbox-cli");
    mkdirSync(login, { recursive: true });
    writeFileSync(join(login, "config.json"), JSON.stringify({ host }), "utf-8");
    writeFileSync(join(login, "tokens.json"), JSON.stringify({ token: "home-token" }), "utf-8");

    const res = await runBoardAsync(dir, ["issue", "list"], {
      TBX_CONFIG_DIR: undefined, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
    });

    assert.equal(res.status, 0, `list haette durchlaufen muessen: ${res.stderr}`);
    const get = requests.find((r) => r.method === "GET");
    assert.equal(get.headers["x-kanban-token"], "home-token",
      "der Login unter HOME wurde nicht gefunden");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Flags ohne Wert
// ============================================================

test("--text-file ohne Pfad bricht mit einem Hinweis ab", () => {
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");

    // `--text-file` als letztes Argument: Der Parser setzt `true` statt eines Pfades.
    const res = runBoard(dir, ["issue", "comment", String(issue.id), "--text-file"]);

    assert.notEqual(res.status, 0, "ein Flag ohne Wert haette scheitern muessen");
    assert.match(res.stderr, /--text-file braucht einen Pfad/, "die Meldung nennt das Flag nicht");
  });
});

test("--text ohne Wert nennt auch den stdin-Weg", () => {
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");

    const res = runBoard(dir, ["issue", "comment", String(issue.id), "--text"]);

    assert.notEqual(res.status, 0, "ein Flag ohne Wert haette scheitern muessen");
    assert.match(res.stderr, /--text braucht einen Wert \(oder '-' fuer stdin\)/,
      "der stdin-Weg fehlt in der Meldung");
  });
});

// ============================================================
// update gegen ein Ticket ohne Body
// ============================================================

test("issue update uebertraegt die Pruefvorgabe auch aus einem leeren Altbody", () => {
  mitProjekt((dir) => {
    // Ein Ticket, dessen Body leer ist: Die Uebernahme der Pruefvorgabe bekommt den
    // leeren Text statt `undefined` und laesst den neuen Body unveraendert stehen.
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "0007.md"), "---\nid: 7\ntitle: Leer\nstatus: backlog\n---\n", "utf-8");

    const neu = "## Kontext\n\nNeuer Text.\n\n## Abhaengigkeiten\n\nKeine.\n";
    const res = runBoard(dir, ["issue", "update", "7", "--body", neu]);

    assert.equal(res.status, 0, `update haette durchlaufen muessen: ${res.stderr}`);
    const text = readFileSync(join(dir, "issues", "0007.md"), "utf-8");
    assert.ok(text.includes("Neuer Text."), "der neue Body wurde nicht geschrieben");
    assert.ok(!text.includes("undefined"), "'undefined' steht in der Datei");
  });
});

// ============================================================
// Ein Reviewer-Kommando, das es nicht gibt
// ============================================================

test("check: ein Kommando ausserhalb des PATH wird VOR dem Probelauf abgefangen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    // Die PATH-Pruefung greift zuerst: Ein Werkzeug, das gar nicht da ist, kostet
    // keinen Probelauf. Der Befund traegt deshalb `geprueft: "pfad"` und nicht
    // "probelauf" — und genau darum ist der `error`-Zweig in `probelauf` von hier
    // aus unerreichbar (er griffe nur, wenn das Binary zwischen Pruefung und Start
    // verschwaende).
    const res = runBoard(dir, ["issue-review", "check"]);

    assert.equal(res.status, 0, "check bleibt eine Auskunft, kein Gate");
    const befund = JSON.parse(res.stdout).reviewers[0];
    assert.equal(befund.verfuegbar, false, "ein fehlendes Werkzeug darf nicht als verfuegbar gelten");
    assert.equal(befund.geprueft, "pfad", "die PATH-Pruefung haette zuerst greifen muessen");
    assert.match(befund.grund, /gibt-es-garantiert-nicht nicht im PATH/,
      "die Meldung nennt das fehlende Werkzeug nicht");
  }, {
    ...LOKAL,
    issueReview: { rounds: 1, reviewers: [{ name: "fehlt", kind: "command", command: "gibt-es-garantiert-nicht --flag" }] },
  }, "board-letzte-probe-enoent-");
});

// ============================================================
// label-sync gegen eine karge Karte
// ============================================================

test("label-sync kommt mit einer Karte ohne Titel und ohne Labels zurecht", () => {
  mitProjekt((dir) => {
    // Weder title noch labels im Frontmatter: Die Stufe faellt auf `issue` zurueck,
    // und die Liste der vorhandenen Labels ist leer — es gibt nichts zu entfernen.
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "0007.md"),
      "---\nid: 7\nstatus: backlog\n---\n\n## Kontext\n\nOhne alles.\n", "utf-8");

    const res = runBoard(dir, ["issue-review", "label-sync", "7"]);

    assert.equal(res.status, 0, `label-sync haette durchlaufen muessen: ${res.stderr}`);
    const daten = JSON.parse(res.stdout);
    assert.equal(daten.zustand, "offen", "ohne Marker und Kommentare ist der Zustand offen");
    assert.equal(daten.label, "review:offen");
  }, { ...LOKAL, issueReview: { statusLabels: true } }, "board-letzte-karge-karte-");
});
