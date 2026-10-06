// Gehoert der Pruefnachweis zum Commit des Pakets? (Issue #865, #857)
//
// `nachweisPasstZuCommit` haelt die Zusammenfassung gegen die Pfade und Blobs, die der
// Commit aendert. Geprueft am Teil bericht im selben Prozess, mit eingesetztem git
// (Plan #1199, E6); den Weg durch den Runner mit echtem checks.mjs prueft
// test/ablauf-night-bericht-nachweis.test.mjs.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { berichtAbhaengigkeiten, nachweisPasstZuCommit, pruefBericht } from "../kit/night/bericht.mjs";

afterEach(() => berichtAbhaengigkeiten());

/**
 * Ein git, das `diff-tree` und `rev-parse` aus einer Tabelle beantwortet — `eintraege` als
 * `[status, pfad]`, `blobs` als Pfad → Blob. `null` statt der Eintraege laesst git scheitern.
 */
function gitAttrappe(eintraege, blobs = {}) {
  const aufrufe = [];
  const git = (args) => {
    aufrufe.push(args);
    if (args[0] === "diff-tree") {
      if (eintraege === null) return { status: 128, stdout: "" };
      return { status: 0, stdout: eintraege.map(([s, p]) => `${s}\0${p}\0`).join("") };
    }
    const pfad = args[1].slice(args[1].indexOf(":") + 1);
    return pfad in blobs ? { status: 0, stdout: `${blobs[pfad]}\n` } : { status: 128, stdout: "" };
  };
  berichtAbhaengigkeiten({ git });
  return aufrufe;
}

test("[night-865] passen alle Blobs des Commits, gehoert der Nachweis zu ihm", () => {
  const aufrufe = gitAttrappe([["M", "kit/a.mjs"], ["A", "kit/b.mjs"]], { "kit/a.mjs": "aaa", "kit/b.mjs": "bbb" });
  const daten = { hashes: { "kit/a.mjs": "aaa", "kit/b.mjs": "bbb", "issues/7.md": "fremd" } };
  assert.deepEqual(nachweisPasstZuCommit(daten, "c0ffee"), { passt: true, grund: null });
  assert.deepEqual(aufrufe[0], ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", "--root", "c0ffee"]);
  assert.deepEqual(aufrufe.slice(1), [["rev-parse", "c0ffee:kit/a.mjs"], ["rev-parse", "c0ffee:kit/b.mjs"]]);
});

test("[night-865] ein Pfad des Commits, der im Nachweis fehlt, wird benannt", () => {
  gitAttrappe([["M", "kit/a.mjs"]], { "kit/a.mjs": "aaa" });
  assert.deepEqual(nachweisPasstZuCommit({ hashes: {} }, "c0ffee"),
    { passt: false, grund: "kit/a.mjs ist darin nicht geprueft" });
});

test("[night-865] ein anderer Blob heisst: in einer anderen Fassung geprueft", () => {
  gitAttrappe([["M", "kit/a.mjs"]], { "kit/a.mjs": "neu" });
  assert.deepEqual(nachweisPasstZuCommit({ hashes: { "kit/a.mjs": "alt" } }, "c0ffee"),
    { passt: false, grund: "kit/a.mjs wurde in einer anderen Fassung geprueft" });
});

test("[night-865] eine Loeschung genuegt mit dem Pfad, ohne Blob", () => {
  const aufrufe = gitAttrappe([["D", "kit/weg.mjs"]]);
  assert.deepEqual(nachweisPasstZuCommit({ hashes: { "kit/weg.mjs": null } }, "c0ffee"), { passt: true, grund: null });
  assert.equal(aufrufe.length, 1, "fuer eine Loeschung wird kein Blob gelesen");
});

test("[night-857] eine abgebrochene Fassung ist nie der Nachweis eines Commits", () => {
  const aufrufe = gitAttrappe([]);
  assert.deepEqual(nachweisPasstZuCommit({ hashes: {}, abgeschlossen: false }, "c0ffee"),
    { passt: false, grund: "die Pruefung wurde abgebrochen" });
  assert.equal(aufrufe.length, 0, "ohne git zu fragen");
});

test("[night-865] nicht beurteilbar gilt als passend: ohne hashes und wenn git scheitert", () => {
  gitAttrappe(null);
  assert.deepEqual(nachweisPasstZuCommit({ hashes: null }, "c0ffee"), { passt: true, grund: null });
  assert.deepEqual(nachweisPasstZuCommit(null, "c0ffee"), { passt: true, grund: null });
  assert.deepEqual(nachweisPasstZuCommit({ hashes: { "kit/a.mjs": "aaa" } }, "c0ffee"), { passt: true, grund: null });
});

test("[night-865] der Pruefteil nennt den fremden Nachweis und zaehlt die Nachpruefung mit", () => {
  const nachgeprueft = {
    id: "7", zustand: "nachgeprueft", nachweisFremd: true, nachweisGrund: "kit/a.mjs wurde in einer anderen Fassung geprueft",
    laufen: [{ cmd: "true", grund: "Nachpruefung des Commits (Nachweis war fremd)", ergebnis: "gruen" }], ausgelassen: [],
  };
  const rot = {
    id: "8", zustand: "rot", nachweisFremd: true, nachweisGrund: "die Pruefung wurde abgebrochen", rotesKommando: "npm test",
    laufen: [{ cmd: "npm test", grund: "x", ergebnis: "rot" }], ausgelassen: [],
  };
  const zeilen = pruefBericht([nachgeprueft, rot]);
  assert.equal(zeilen[0], "Pruefungen der Sessions:");
  assert.equal(zeilen[1], "  Issue #7: nachgeprueft — Nachweis gehoerte nicht zum Commit (kit/a.mjs wurde in einer anderen Fassung geprueft), Nachpruefung gruen.");
  assert.equal(zeilen[2], "  Issue #8: rot — Nachweis gehoerte nicht zum Commit (die Pruefung wurde abgebrochen), Nachpruefung rot — npm test endete rot.");
  assert.match(zeilen[3], /1 nachgeprueft, .* 1 rot; 1 Pruefung\(en\) gelaufen \(davon 0 rot\)/);
});

test("berichtAbhaengigkeiten weist eine unbekannte Abhaengigkeit ab", () => {
  assert.throws(() => berichtAbhaengigkeiten({ spawn: () => {} }), /kennt keine Abhaengigkeit 'spawn'/);
});
