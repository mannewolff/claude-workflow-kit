// Lueckenhafte Antworten von gh und glab (Issue #405).
//
// Die Bestandstests fahren vollstaendige CLI-Antworten. Was hier geprueft wird, sind
// die Rueckfaelle fuer das, was fehlen kann: ein `project list` ohne `projects`, ein
// Status-Feld ohne `options`, ein Issue ohne `projectItems`, eine Item-Liste ohne
// `items`.
//
// Das ist kein konstruierter Fall. `gh` aendert sein JSON zwischen Versionen, und
// ein Feld, das gestern da war, kann heute fehlen — dann muss der Adapter eine
// Meldung liefern und nicht an `undefined.length` sterben. Genau so ist der
// Nachtlauf am 2026-07-09 gekippt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setupProjekt, runBoard, board, fakeCli } from "./helpers/board-fixture.mjs";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-CLI ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197." }
  : {};

const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };
const GITHUB_OHNE_NUMMER = { codeHost: "github", issueTracker: "github" };
const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };

const OPTIONEN = [
  { id: "opt-backlog", name: "Backlog" },
  { id: "opt-ready", name: "Ready" },
  { id: "opt-progress", name: "In progress" },
  { id: "opt-review", name: "In review" },
  { id: "opt-done", name: "Done" },
];

function graphqlItem(itemId = "ITEM_1") {
  return {
    data: {
      repository: {
        issue: {
          projectItems: { nodes: [{ id: itemId, project: { number: 14, owner: { login: "besitzer" } } }] },
        },
      },
    },
  };
}

function basisRegeln() {
  return [
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^project list", stdout: { projects: [{ number: 14, title: "Mein Board", id: "PVT_1" }] } },
    { match: "^project field-list", stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: OPTIONEN }] } },
    { match: "^api graphql", stdout: graphqlItem() },
    { match: "^project item-list", stdout: { items: [] } },
    { match: "^project item-edit", stdout: "" },
    { match: "^issue list", stdout: [] },
    { match: "^issue create", stdout: "https://github.com/besitzer/mein-repo/issues/42\n" },
  ];
}

function mitGh(fn, { regeln = [], config = GITHUB, praefix = "board-adapter-gh-" } = {}) {
  const dir = setupProjekt(config, praefix);
  fakeCli(dir, "gh", [...regeln, ...basisRegeln()]);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// GitHub: fehlende Felder in den gh-Antworten
// ============================================================

test("ein 'project list' ohne projects-Feld gilt als 'kein Project'", NUR_POSIX, () => {
  // Ohne den Rueckfall auf die leere Liste stuende hier `undefined.length` — ein
  // Absturz statt der Meldung, die der Anwender braucht.
  //
  // Zwei Wege fuehren durch diese Stelle, und sie enden verschieden: `issue move`
  // braucht das Project zwingend und scheitert mit Anleitung; `issue list --status`
  // faellt auf alle offenen Issues zurueck (Bestandsverhalten), damit ein Lesezugriff
  // an einer fehlenden Projektnummer nicht stirbt.
  mitGh((dir) => {
    const move = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.notEqual(move.status, 0, "ohne Project haette der move scheitern muessen");
    assert.match(move.stderr, /hat kein GitHub Project/, "die Lage wird nicht benannt");
    assert.match(move.stderr, /"github": \{ "projectNumber": <N> \}/, "die Anleitung fehlt");

    const liste = runBoard(dir, ["issue", "list", "--status", "ready"]);
    assert.equal(liste.status, 0, `list haette zurueckfallen muessen: ${liste.stderr}`);
    assert.deepEqual(JSON.parse(liste.stdout), [], "der Rueckfall liefert die offenen Issues");
  }, { regeln: [{ match: "^project list", stdout: {} }], config: GITHUB_OHNE_NUMMER, praefix: "board-adapter-ohne-projects-" });
});

test("ein Status-Feld ohne options meldet den fehlenden Status statt zu crashen", NUR_POSIX, () => {
  mitGh((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);

    assert.notEqual(res.status, 0, "ohne Optionen haette der move scheitern muessen");
    assert.match(res.stderr, /Status 'ready' hat keine Entsprechung im GitHub Project/,
      "die Meldung nennt den gesuchten Status nicht");
  }, {
    regeln: [{ match: "^project field-list", stdout: { fields: [{ id: "F", name: "Status" }] } }],
    praefix: "board-adapter-ohne-optionen-",
  });
});

test("eine field-list ohne fields-Feld wird als fehlendes Status-Feld gemeldet", NUR_POSIX, () => {
  mitGh((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);

    assert.notEqual(res.status, 0, "ohne Felder haette der move scheitern muessen");
    assert.match(res.stderr, /Status/, "die Meldung nennt das fehlende Feld nicht");
  }, { regeln: [{ match: "^project field-list", stdout: {} }], praefix: "board-adapter-ohne-fields-" });
});

test("ein Issue ohne projectItems liegt nicht auf dem Board", NUR_POSIX, () => {
  mitGh((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);

    assert.notEqual(res.status, 0, "ein Issue ohne Board-Eintrag haette scheitern muessen");
    assert.match(res.stderr, /Board|Project/i, "die Meldung nennt die Ursache nicht");
  }, {
    regeln: [{ match: "^api graphql", stdout: { data: { repository: { issue: {} } } } }],
    praefix: "board-adapter-ohne-items-",
  });
});

test("eine item-list ohne items-Feld liefert eine leere Liste", NUR_POSIX, () => {
  // Der Status-Filter laeuft ueber das Project. Fehlt das Feld, ist die richtige
  // Antwort "keine Treffer" — nicht ein Absturz und auch nicht "alle Issues".
  mitGh((dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);

    assert.equal(res.status, 0, `list haette durchlaufen muessen: ${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stdout), [], "eine fehlende Item-Liste muss leer bleiben");
  }, { regeln: [{ match: "^project item-list", stdout: {} }], praefix: "board-adapter-ohne-itemliste-" });
});

test("ein Project-Item ohne status faellt aus dem Statusfilter", NUR_POSIX, () => {
  mitGh((dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);

    assert.equal(res.status, 0, `list haette durchlaufen muessen: ${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stdout), [],
      "ein Item ohne Status darf keinem Status zugeordnet werden");
  }, {
    regeln: [{ match: "^project item-list", stdout: { items: [{ content: { number: 42 } }] } }],
    praefix: "board-adapter-item-ohne-status-",
  });
});

test("issue create ohne --body schickt einen leeren Body statt 'undefined'", NUR_POSIX, () => {
  mitGh((dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Ohne Body"]);

    assert.equal(res.status, 0, `create haette durchlaufen muessen: ${res.stderr}`);
    // Die Autor-Modell-Leitplanke (#266) macht den Body nie ganz leer — aber
    // "undefined" darf dort unter keinen Umstaenden stehen.
    assert.ok(!res.stdout.includes("undefined"), "'undefined' steht in der Ausgabe");
  }, { praefix: "board-adapter-create-ohne-body-" });
});

test("ein korrupter Auto-Cache wird wie ein Cache-Miss behandelt", NUR_POSIX, () => {
  mitGh((dir) => {
    // Der Cache liegt da, ist aber unlesbar. Der Adapter muss ihn uebergehen und
    // neu ermitteln, statt daran zu scheitern.
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"), "{kein JSON", "utf-8");

    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);

    assert.equal(res.status, 0, `list haette durchlaufen muessen: ${res.stderr}`);
    assert.match(res.stderr, /automatisch erkanntes einziges GitHub Project/,
      "die Projektnummer wurde nicht neu ermittelt");
  }, { config: GITHUB_OHNE_NUMMER, praefix: "board-adapter-cache-kaputt-" });
});

test("ein Auto-Cache ohne projectNumber gilt als leer", NUR_POSIX, () => {
  mitGh((dir) => {
    // Syntaktisch gueltiges JSON, aber der Eintrag traegt die Nummer nicht — etwa
    // aus einer aelteren Kit-Version. Auch das ist ein Cache-Miss.
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"),
      JSON.stringify({ "besitzer#auto": {} }), "utf-8");

    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);

    assert.equal(res.status, 0, `list haette durchlaufen muessen: ${res.stderr}`);
    assert.match(res.stderr, /automatisch erkanntes einziges GitHub Project/,
      "der halbe Cache-Eintrag wurde als Treffer gewertet");
  }, { config: GITHUB_OHNE_NUMMER, praefix: "board-adapter-cache-halb-" });
});

// ============================================================
// GitLab
// ============================================================

test("glab: issue create ohne --body schickt eine leere Beschreibung", NUR_POSIX, () => {
  const dir = setupProjekt(GITLAB, "board-adapter-glab-create-");
  try {
    fakeCli(dir, "glab", [
      { match: "^issue create", stdout: "https://gitlab.com/gruppe/repo/-/issues/7\n" },
    ]);

    const res = runBoard(dir, ["issue", "create", "--title", "Ohne Body"]);

    assert.equal(res.status, 0, `create haette durchlaufen muessen: ${res.stderr}`);
    assert.ok(!res.stdout.includes("undefined"), "'undefined' steht in der Ausgabe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("glab: ein Status ohne Label-Zuordnung wird woertlich als Label genutzt", NUR_POSIX, () => {
  // `columnLabels(config)[status] || status`: Fuer einen Status, den die
  // Spaltentabelle nicht fuehrt, gilt der Statusname selbst. Ohne diesen Rueckfall
  // stuende `--label undefined` in der Kommandozeile.
  const dir = setupProjekt(
    { ...GITLAB, columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" } },
    "board-adapter-glab-status-",
  );
  try {
    fakeCli(dir, "glab", [{ match: "^issue list", stdout: [] }]);

    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);

    assert.equal(res.status, 0, `list haette durchlaufen muessen: ${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stdout), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// exec: das Werkzeug selbst
// ============================================================

test("ein nicht ausfuehrbares gh meldet den Systemfehler, nicht 'nicht gefunden'", NUR_POSIX, () => {
  const dir = setupProjekt(GITHUB, "board-adapter-eacces-");
  try {
    // Eine Datei ohne Ausfuehrungsrecht: spawnSync liefert EACCES statt ENOENT — der
    // zweite Zweig der Fehlerbehandlung, den die ENOENT-Meldung sonst verdeckt.
    const binDir = join(dir, "fakebin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "gh"), "#!/bin/sh\necho hi\n", { mode: 0o644 });

    const res = runBoard(dir, ["issue", "list"], { PATH: binDir });

    assert.notEqual(res.status, 0, "ein nicht startbares gh haette scheitern muessen");
    assert.match(res.stderr, /EACCES|permission denied/i, "der Systemfehler fehlt");
    assert.doesNotMatch(res.stderr, /nicht gefunden — ist es installiert/,
      "ein Rechteproblem darf nicht als 'nicht installiert' gemeldet werden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
