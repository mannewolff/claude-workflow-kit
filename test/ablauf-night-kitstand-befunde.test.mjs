// Ablauf-Pruefung: Ob die Kette an ihren beiden Abbaustellen die Befunde genau einmal zurueckholt, zeigt nur der echte Runner mit Worktree.
//
// Der Rueckweg der Befunde an den Abbaustellen der Nacht-Kette (Plan #797; Issue #803).
//
// Gerufen wird `befundeZurueck` an beiden Abbaustellen der Kette: vor der Umsetzungsstufe
// und im finally am Kettenende. Das Nullen von `kette.wt` nach dem ersten Abbau verhindert
// das doppelte Anhaengen. Die Funktion selbst belegt test/night-kitstand-befunde.test.mjs im
// selben Prozess (Issue #1226).

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  run, mitProjekt, fachplan, umgebung,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG, durchziehen,
} from "./helpers/kette-fixture.mjs";

/** Eine Protokollzeile, wie `befunde.mjs buchen` sie schreibt — sieben Spalten, Art in Spalte 5. */
function zeile(art) {
  return `2026-09-22T00:00:00.000Z\tplan\t2\treviewer\t${art}\tWICHTIG\t-`;
}

function hauptZeilen(repo) {
  return readFileSync(join(repo, ".claude", "befunde.tsv"), "utf-8").split("\n").filter((z) => z !== "");
}

// --- Die beiden Abbaustellen der Kette ----------------------------------------

/** Die Fake-Zeile, die im Worktree eine Buchung hinterlaesst — wie `befunde buchen` es taete. */
const BUCHUNG_IM_WORKTREE = String.raw`printf "2026-09-22T00:00:00.000Z\tplan\t2\treviewer\tluecke\tWICHTIG\t-\n" >> .claude/befunde.tsv`;

test("[night-69] der Abbau im finally am Kettenende holt die Buchungen der Review-Stufe zurueck", () => {
  mitProjekt((dir) => {
    // Zwei Vorkommen liegen schon in der Hauptkopie — der Spiegel traegt sie nicht in
    // den Worktree, und die Kette darf sie beim Rueckholen nicht ueberschreiben.
    const alt = [zeile("luecke"), zeile("luecke")];
    writeFileSync(join(dir, ".claude", "befunde.tsv"), alt.map((z) => `${z}\n`).join(""));

    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: {
      plan: PLAN_ANLEGEN,
      review: `${REVIEW_MARKER}; ${BUCHUNG_IM_WORKTREE}`,
      pakete: PAKETE_ANLEGEN,
    } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const zeilen = hauptZeilen(dir);
    assert.equal(zeilen.length, 3, `die Buchung der Kette fehlt oder wurde gedoppelt:\n${zeilen.join("\n")}`);
    assert.deepEqual(zeilen.slice(0, 2), alt, "die alten Zeilen stehen unveraendert voran");
    assert.match(res.stdout, /Schwelle erreicht: luecke/,
      "der Runner protokolliert die Arten, deren Gesamtstand die Schwelle erreicht");
    assert.ok(String(F), "Fachplan angelegt"); // benutzt, damit die Nummer im Fehlerfall greifbar ist
  });
});

test("[night-69] der Abbau vor der Umsetzungsstufe holt die Buchungen zurueck — und das finally haengt nicht noch einmal an", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    durchziehen(dir, F);
    const env = umgebung(dir, { stufen: {
      plan: PLAN_ANLEGEN,
      review: REVIEW_MARKER,
      pakete: `${PAKETE_ANLEGEN}; ${BUCHUNG_IM_WORKTREE}`,
      umsetzung: UMSETZUNG_ERFOLG,
    } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    // Genau eine Zeile: Der Abbau vor der Umsetzungsstufe hat sie geholt, und das
    // finally am Kettenende darf nach `kette.wt = null` nicht noch einmal anhaengen.
    assert.deepEqual(hauptZeilen(dir), [zeile("luecke")],
      "die Buchung muss genau einmal in der Hauptkopie stehen");
  });
});
