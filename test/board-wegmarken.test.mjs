// Wegmarken beim Verschieben einer Karte (Issue #733).
//
// Der Verbrauch einer interaktiven Sitzung soll einer Karte zugeordnet werden koennen,
// ohne Handarbeit. Dafuer vermerkt `issue move` beim Zug nach In progress bzw. In review
// Zeitpunkt, Kartennummer und Spalte in `.claude/wegmarken.tsv`; ein eigener Melder teilt
// den Sitzungsverbrauch spaeter anhand dieser Zeitstempel auf die Abschnitte auf.
//
// Zwei Eigenschaften sind hier entscheidend und werden deshalb an der Wirkung geprueft,
// nicht am Code: Es wird ANGEHAENGT (sonst ueberschriebe der zweite Zug den ersten und
// der Melder saehe nur den letzten Abschnitt), und ein Schreibfehler haelt die
// Kartenbewegung NICHT auf — eine Wegmarke ist Buchhaltung, keine Bedingung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn) {
  const dir = setupProjekt(LOKAL, "board-wegmarken-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function wegmarkenPfad(dir) {
  return join(dir, ".claude", "wegmarken.tsv");
}

/** Die Zeilen der Wegmarken-Datei; eine fehlende Datei zaehlt als keine Zeile. */
function wegmarken(dir) {
  const pfad = wegmarkenPfad(dir);
  if (!existsSync(pfad)) return [];
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean);
}

const ZEITSTEMPEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("[board-9] ein Zug nach In progress haengt Zeitstempel, Kartennummer und Spalte an", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    board(dir, "issue", "move", "0001", "in_progress");

    const zeilen = wegmarken(dir);
    assert.equal(zeilen.length, 1);
    const [zeit, nummer, spalte] = zeilen[0].split("\t");
    assert.match(zeit, ZEITSTEMPEL, "der Zeitstempel ist ISO-8601 in UTC");
    assert.equal(nummer, "0001");
    assert.equal(spalte, "in_progress", "die Wegmarke traegt den kanonischen Status, nicht den Spaltennamen");
  });
});

test("[board-9] der zweite Zug haengt an, statt die erste Wegmarke zu ueberschreiben", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    board(dir, "issue", "move", "0001", "in_progress");
    const erste = wegmarken(dir)[0];
    board(dir, "issue", "move", "0001", "in_review");

    const zeilen = wegmarken(dir);
    assert.equal(zeilen.length, 2);
    assert.equal(zeilen[0], erste, "die erste Wegmarke bleibt unveraendert stehen");
    assert.equal(zeilen[1].split("\t")[2], "in_review");
  });
});

test("[board-9] ein Zug in eine andere Spalte schreibt keine Wegmarke", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    for (const status of ["ready", "done", "backlog"]) {
      board(dir, "issue", "move", "0001", status);
    }
    assert.deepEqual(wegmarken(dir), []);
  });
});

// Fehlt `.claude/` im Arbeitsverzeichnis, legt die Wegmarke es an. Nachgestellt wird das
// ueber den Config-Fallback: Die workflow.config.json liegt unter KIT_ROOT, das
// Arbeitsverzeichnis daneben bringt nur die Issues mit — genau der Wegwerf-Ordner aus dem
// Akzeptanzkriterium.
test("[board-9] fehlt .claude/ im Arbeitsverzeichnis, wird es fuer die Wegmarke angelegt", () => {
  const konfig = setupProjekt(LOKAL, "board-wegmarken-cfg-");
  const arbeit = mkdtempSync(join(tmpdir(), "board-wegmarken-arbeit-"));
  try {
    const env = { KIT_ROOT: konfig };
    assert.equal(runBoard(arbeit, ["issue", "create", "--title", "Wandert"], env).status, 0);
    assert.equal(existsSync(join(arbeit, ".claude")), false, "Vorbedingung: kein .claude/ im Arbeitsverzeichnis");

    const res = runBoard(arbeit, ["issue", "move", "0001", "in_review"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(wegmarken(arbeit).length, 1);
  } finally {
    rmSync(konfig, { recursive: true, force: true });
    rmSync(arbeit, { recursive: true, force: true });
  }
});

test("[board-9] ist die Wegmarke nicht schreibbar, wird die Karte trotzdem verschoben", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    // Ein Verzeichnis an der Stelle der Datei laesst jedes Anhaengen scheitern (EISDIR) —
    // anders als ein Rechte-Entzug wirkt das unabhaengig vom ausfuehrenden Benutzer.
    mkdirSync(wegmarkenPfad(dir), { recursive: true });

    const res = runBoard(dir, ["issue", "move", "0001", "in_progress"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, id: "0001", status: "in_progress" });
    assert.match(res.stderr, /Wegmarke/, "der Fehlschlag wird als Hinweis gemeldet, nicht verschwiegen");
    assert.match(readFileSync(join(dir, "issues", "0001.md"), "utf-8"), /status: in_progress/);
  });
});
