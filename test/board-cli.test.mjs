// Tests fuer den CLI-Mantel von kit/board.mjs (Issue #188): Hilfe, --version,
// Config-Aufloesung, Argument-Parser und die Validierung der Sub-Befehle.
//
// Alles laeuft gegen einen Fixture-Ordner im Temp-Verzeichnis mit issueTracker
// "local" — kein Fremdsystem, kein Netz. Siehe test/helpers/board-fixture.mjs
// zur Begruendung, warum das echte Repo-Script mit fremdem cwd gestartet wird.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, schreibeConfig, runBoard, board } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(config, fn) {
  const dir = setupProjekt(config);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Hilfe und Version ---

test("Ohne Argumente wird die Hilfe ausgegeben, Exit 0", () => {
  mitProjekt(LOKAL, (dir) => {
    const res = runBoard(dir, []);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Board-Adapter fuer das claude-workflow-kit/);
    assert.match(res.stdout, /backlog \| ready \| in_progress \| in_review \| done/);
  });
});

test("--help und -h geben dieselbe Hilfe aus", () => {
  mitProjekt(LOKAL, (dir) => {
    const lang = runBoard(dir, ["--help"]);
    const kurz = runBoard(dir, ["-h"]);
    assert.equal(lang.status, 0);
    assert.equal(kurz.status, 0);
    assert.equal(lang.stdout, kurz.stdout);
  });
});

// Akzeptanzkriterium aus Issue #188: --version muss ohne jeden Repo-Kontext
// antworten — genau in einem Projekt ohne Config fragt man danach.
test("--version antwortet auch ohne workflow.config.json", () => {
  mitProjekt(null, (dir) => {
    const res = runBoard(dir, ["--version"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^board\.mjs \(claude-workflow-kit v\d+\.\d+\.\d+\)$/m);
  });
});

test("Unbekannte Achse: Hilfe plus Fehlermeldung, Exit 1", () => {
  mitProjekt(LOKAL, (dir) => {
    const res = runBoard(dir, ["quatsch", "list"]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /Board-Adapter/);
    assert.match(res.stderr, /Unbekannte Achse: 'quatsch'/);
  });
});

test("Unbekannter issue- und code-Befehl: Hilfe plus Fehlermeldung", () => {
  mitProjekt(LOKAL, (dir) => {
    const issue = runBoard(dir, ["issue", "fliegen"]);
    assert.equal(issue.status, 1);
    assert.match(issue.stderr, /Unbekannter issue-Befehl: 'fliegen'/);

    const code = runBoard(dir, ["code", "fliegen"]);
    assert.equal(code.status, 1);
    assert.match(code.stderr, /Unbekannter code-Befehl: 'fliegen'/);
  });
});

// --- Config-Aufloesung ---

test("Fehlende workflow.config.json: Hinweis auf den Installer, Exit 1", () => {
  mitProjekt(null, (dir) => {
    const res = runBoard(dir, ["issue", "list"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Keine \.claude\/workflow\.config\.json gefunden/);
  });
});

test("Kaputte workflow.config.json: Meldung nennt den Pfad, Exit 1", () => {
  mitProjekt("{ das ist kein JSON", (dir) => {
    const res = runBoard(dir, ["issue", "list"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /workflow\.config\.json konnte nicht gelesen werden/);
  });
});

// Rueckwaertskompatibilitaet: vor der Zwei-Achsen-Trennung (#368) gab es nur
// `provider`. Alte Configs muessen weiter laufen.
test("Altes Feld 'provider' fuellt codeHost und issueTracker", () => {
  mitProjekt({ provider: "local", local: { issuesDir: "issues" } }, (dir) => {
    const angelegt = board(dir, "issue", "create", "--title", "Aus Alt-Config");
    assert.equal(angelegt.id, "0001");
    const repo = board(dir, "code", "repo-name");
    assert.ok(repo.repoName, "codeHost wurde nicht aus provider abgeleitet");
  });
});

test("Unbekannter issueTracker und codeHost werden benannt", () => {
  mitProjekt({ issueTracker: "jira", codeHost: "svn" }, (dir) => {
    const issue = runBoard(dir, ["issue", "list"]);
    assert.equal(issue.status, 1);
    assert.match(issue.stderr, /Unbekannter issueTracker: 'jira'/);

    const code = runBoard(dir, ["code", "repo-name"]);
    assert.equal(code.status, 1);
    assert.match(code.stderr, /Unbekannter codeHost: 'svn'/);
  });
});

// --- Argument-Parser ---

test("parseArgs: Werte mit Leerzeichen bleiben zusammen, Flags ohne Wert werden true", () => {
  mitProjekt(LOKAL, (dir) => {
    board(dir, "issue", "create", "--title", "Titel mit Leerzeichen", "--body", "Text");
    const geholt = board(dir, "issue", "get", "0001");
    assert.equal(geholt.title, "Titel mit Leerzeichen");
    assert.equal(geholt.body, "Text");

    // --status ohne Wert am Zeilenende wird zu true und faellt in die Validierung.
    const res = runBoard(dir, ["issue", "list", "--status"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Ungueltiger Status/);
  });
});

// --- Validierung der Sub-Befehle ---

test("issue create ohne --title schlaegt fehl", () => {
  mitProjekt(LOKAL, (dir) => {
    const res = runBoard(dir, ["issue", "create", "--body", "nur Body"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--title ist erforderlich/);
  });
});

test("issue get ohne id schlaegt fehl", () => {
  mitProjekt(LOKAL, (dir) => {
    const res = runBoard(dir, ["issue", "get"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /id ist erforderlich/);
  });
});

test("issue list mit ungueltigem Status nennt die gueltigen Werte", () => {
  mitProjekt(LOKAL, (dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "erledigt"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Ungueltiger Status 'erledigt'.*backlog, ready/s);
  });
});

test("issue move prueft id, Zielstatus und dessen Gueltigkeit", () => {
  mitProjekt(LOKAL, (dir) => {
    const ohneId = runBoard(dir, ["issue", "move"]);
    assert.equal(ohneId.status, 1);
    assert.match(ohneId.stderr, /id ist erforderlich/);

    const ohneStatus = runBoard(dir, ["issue", "move", "1"]);
    assert.equal(ohneStatus.status, 1);
    assert.match(ohneStatus.stderr, /status ist erforderlich/);

    const falsch = runBoard(dir, ["issue", "move", "1", "erledigt"]);
    assert.equal(falsch.status, 1);
    assert.match(falsch.stderr, /Ungueltiger Status 'erledigt'/);
  });
});

test("issue comment prueft id und --text", () => {
  mitProjekt(LOKAL, (dir) => {
    const ohneId = runBoard(dir, ["issue", "comment"]);
    assert.equal(ohneId.status, 1);
    assert.match(ohneId.stderr, /id ist erforderlich/);

    board(dir, "issue", "create", "--title", "Mit Kommentar");
    const ohneText = runBoard(dir, ["issue", "comment", "0001"]);
    assert.equal(ohneText.status, 1);
    assert.match(ohneText.stderr, /--text ist erforderlich/);
  });
});

test("code pr prueft --from und --to", () => {
  mitProjekt(LOKAL, (dir) => {
    const ohneFrom = runBoard(dir, ["code", "pr", "--to", "main"]);
    assert.equal(ohneFrom.status, 1);
    assert.match(ohneFrom.stderr, /--from ist erforderlich/);

    const ohneTo = runBoard(dir, ["code", "pr", "--from", "feature"]);
    assert.equal(ohneTo.status, 1);
    assert.match(ohneTo.stderr, /--to ist erforderlich/);
  });
});

// Erwartete Fehler aus den Adaptern tragen das Praefix "Fehler:", nicht
// "Unerwarteter Fehler:" — das unterscheidet einen Bedienfehler von einem Absturz.
test("BoardError aus dem Adapter wird als 'Fehler:' ausgegeben", () => {
  mitProjekt(LOKAL, (dir) => {
    const res = runBoard(dir, ["issue", "get", "42"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Fehler: Issue 42 nicht gefunden/);
  });
});
