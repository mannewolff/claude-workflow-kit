// Bewegungsprotokoll beim Verschieben einer Karte (Issue #786).
//
// Die Ruecklaeuferquote braucht einen Kandidatenfilter: Welche Karten hat das Kit
// ueberhaupt je bewegt? Dafuer haengt `issue move` jeden geglueckten Zug an
// `.claude/bewegungen.tsv` an — Zeitpunkt, Kartennummer, Status-Schluessel.
//
// Der Unterschied zur Wegmarke (board-9) ist der Kern dieser Datei und wird deshalb
// an beiden Dateien nebeneinander geprueft: Die Wegmarke vermerkt NUR die beiden
// Arbeitsspalten, weil sie Abschnitte einer Sitzung aufteilt; das Bewegungsprotokoll
// vermerkt JEDEN Status, weil gerade der Zug nach Backlog den Ruecklaeufer ausmacht.
// Gemeinsam bleibt: angehaengt, nie geleert, und ein Schreibfehler haelt die
// Kartenbewegung nicht auf — ein Protokoll ist Buchhaltung, keine Bedingung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn) {
  const dir = setupProjekt(LOKAL, "board-bewegungen-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function bewegungenPfad(dir) {
  return join(dir, ".claude", "bewegungen.tsv");
}

/** Die Zeilen des Bewegungsprotokolls; eine fehlende Datei zaehlt als keine Zeile. */
function bewegungen(dir) {
  const pfad = bewegungenPfad(dir);
  if (!existsSync(pfad)) return [];
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean);
}

/** Die Zeilen der Wegmarken-Datei — fuer die Abgrenzung gegen board-9. */
function wegmarken(dir) {
  const pfad = join(dir, ".claude", "wegmarken.tsv");
  if (!existsSync(pfad)) return [];
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean);
}

const ZEITSTEMPEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("[board-17] ein Zug haengt Zeitstempel, Kartennummer und Status-Schluessel an", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    board(dir, "issue", "move", "0001", "in_progress");

    const zeilen = bewegungen(dir);
    assert.equal(zeilen.length, 1);
    const [zeit, nummer, status] = zeilen[0].split("\t");
    assert.match(zeit, ZEITSTEMPEL, "der Zeitstempel ist ISO-8601 in UTC");
    assert.equal(nummer, "0001");
    assert.equal(status, "in_progress", "protokolliert wird der Status-Schluessel, nicht der Spaltenname");
  });
});

test("[board-17] der zweite Zug haengt an, statt das Protokoll zu ueberschreiben", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    board(dir, "issue", "move", "0001", "in_progress");
    const erste = bewegungen(dir)[0];
    board(dir, "issue", "move", "0001", "in_review");

    const zeilen = bewegungen(dir);
    assert.equal(zeilen.length, 2);
    assert.equal(zeilen[0], erste, "die erste Zeile bleibt unveraendert stehen");
    assert.equal(zeilen[1].split("\t")[2], "in_review");
  });
});

// Der Ruecklaeufer selbst: ein Zug aus In review zurueck nach Backlog. Die Wegmarke
// laesst ihn aus, das Protokoll nicht — sonst saehe die Auswertung nur die Hinwege.
test("[board-17] auch ein Zug nach backlog, ready und done wird protokolliert", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    for (const status of ["in_review", "backlog", "ready", "done"]) {
      board(dir, "issue", "move", "0001", status);
    }

    assert.deepEqual(
      bewegungen(dir).map((z) => z.split("\t")[2]),
      ["in_review", "backlog", "ready", "done"],
    );
    assert.deepEqual(
      wegmarken(dir).map((z) => z.split("\t")[2]),
      ["in_review"],
      "die Wegmarke bleibt bei ihren zwei Spalten (board-9)",
    );
  });
});

test("[board-17] fehlt .claude/ im Arbeitsverzeichnis, wird es fuer das Protokoll angelegt", () => {
  const konfig = setupProjekt(LOKAL, "board-bewegungen-cfg-");
  const arbeit = mkdtempSync(join(tmpdir(), "board-bewegungen-arbeit-"));
  try {
    const env = { KIT_ROOT: konfig };
    assert.equal(runBoard(arbeit, ["issue", "create", "--title", "Wandert"], env).status, 0);
    assert.equal(existsSync(join(arbeit, ".claude")), false, "Vorbedingung: kein .claude/ im Arbeitsverzeichnis");

    const res = runBoard(arbeit, ["issue", "move", "0001", "backlog"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(bewegungen(arbeit).length, 1);
  } finally {
    rmSync(konfig, { recursive: true, force: true });
    rmSync(arbeit, { recursive: true, force: true });
  }
});

test("[board-17] ist das Protokoll nicht schreibbar, wird die Karte trotzdem verschoben", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert");
    // Ein Verzeichnis an der Stelle der Datei laesst jedes Anhaengen scheitern (EISDIR) —
    // anders als ein Rechte-Entzug wirkt das unabhaengig vom ausfuehrenden Benutzer.
    mkdirSync(bewegungenPfad(dir), { recursive: true });

    const res = runBoard(dir, ["issue", "move", "0001", "backlog"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, id: "0001", status: "backlog" });
    assert.match(res.stderr, /Bewegung/, "der Fehlschlag wird als Hinweis gemeldet, nicht verschwiegen");
    assert.match(readFileSync(join(dir, "issues", "0001.md"), "utf-8"), /status: backlog/);
  });
});
