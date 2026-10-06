// Die Auskunftszeit in der Aufwands-Auswertung (Issue #1027, Plan #1015, E11 bis E13).
//
// Zwei Dinge werden belegt, der Gleichlauf der beiden `auskunftArt`-Fassungen steht in
// test/night-session-auskunft-gleichlauf.test.mjs:
//
//   Der Abschnitt "Auskuenfte" mittelt nur ueber Umsetzungseinheiten (E12) und nennt ihre
//   Zahl. Alles andere steht in einer eigenen Zeile "keine Umsetzung". `auskunft: null`
//   und Altstaende ohne das Feld heissen "nicht gemessen" und gehen nie als 0 ein.
//
//   Der Unterbefehl `auskunft` misst Claude-Code-Transkripte mit DEMSELBEN Klassifizierer
//   wie der Runner (E13) — so laesst sich ein Referenzwert nachtraeglich bestimmen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mitProjekt, lauf, einheit, auswerten, bericht, stand, aufwand } from "./helpers/aufwand-fixture.mjs";
import { transkriptMessen } from "../kit/aufwand.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const SPANNEN = join(FIXTURES, "aufwand", "transkript-spannen.jsonl");
const OHNE_ZEIT = join(FIXTURES, "aufwand", "transkript-ohne-zeitstempel.jsonl");
const ECHTE_ZEILE = join(FIXTURES, "auskunft", "transkript-tool-results.jsonl");

const MIN = 60_000;

const lesen = (pfad) => readFileSync(pfad, "utf-8");

/** Eine Einheit, wie night.mjs sie seit Issue #1026 schreibt. */
function gemessen(id, umsetzung, auskunft) {
  return einheit(id, { umsetzung, auskunft });
}

/** Eine Einheit aus einem Stand vor Issue #1026: weder `umsetzung` noch `auskunft`. */
function altstand(id) {
  return einheit(id);
}

// ============================================================
// Abschnitt "Auskuenfte" in aufwand.json und aufwand.md
// ============================================================

test("[aufwand-1027] der Mittelwert traegt nur Umsetzungseinheiten und nennt ihre Zahl", () => {
  const laeufe = [lauf("2026-09-27-220000", {
    art: "kette",
    einheiten: [
      gemessen(601, true, { ms: 2 * MIN, aufrufe: 4 }),
      gemessen(602, true, { ms: 1 * MIN, aufrufe: 2 }),
      gemessen(603, false, { ms: 10 * MIN, aufrufe: 9 }),
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(e.auskuenfte.mittelMs, { wert: 1.5 * MIN, einheiten: 2, laeufe: 1 },
      "die Einheit ohne Umsetzung darf das Mittel nicht verschieben");
    assert.deepEqual(e.auskuenfte.umsetzungen.map((u) => [u.id, u.ms, u.aufrufe]), [
      ["601", 2 * MIN, 4],
      ["602", 1 * MIN, 2],
    ]);
    assert.equal(e.auskuenfte.umsetzungen[0].lauf, "2026-09-27-220000");
    assert.deepEqual(e.auskuenfte.keineUmsetzung, { einheiten: 1, ms: { wert: 10 * MIN, laeufe: 1 }, laeufe: 1 });
    assert.deepEqual(stand(dir).auskuenfte, e.auskuenfte, "aufwand.json traegt dasselbe Feld wie stdout");

    const md = bericht(dir);
    assert.match(md, /## Auskuenfte/);
    assert.match(md, /\| 2026-09-27-220000 \| #601 Paket 601 \| 2,0 min \| 4 \|/);
    assert.match(md, /Mittel ueber 2 Umsetzungseinheiten: 1,5 min/);
    assert.match(md, /keine Umsetzung: 1 Einheit, Auskunftszeit 10,0 min/);
  });
});

test("[aufwand-1027] auskunft null und Altstaende aendern das Mittel nicht und heissen nicht gemessen", () => {
  const laeufe = [
    lauf("2026-09-27-220000", { einheiten: [
      gemessen(611, true, { ms: 3 * MIN, aufrufe: 5 }),
      gemessen(612, true, null),
    ] }),
    lauf("2026-09-20-220000", { einheiten: [altstand(613), altstand(614)] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(e.auskuenfte.mittelMs, { wert: 3 * MIN, einheiten: 1, laeufe: 1 },
      "weder null noch ein fehlendes Feld darf als 0 ins Mittel");
    assert.deepEqual(e.auskuenfte.nichtGemessen, { einheiten: 3, laeufe: 2 });
    const ohne = e.auskuenfte.umsetzungen.find((u) => u.id === "612");
    assert.equal(ohne.ms, null);
    assert.equal(ohne.aufrufe, null);

    const md = bericht(dir);
    assert.match(md, /\| #612 Paket 612 \| nicht gemessen \| nicht gemessen \|/);
    assert.match(md, /nicht gemessen: 3 Einheiten/);
  });
});

test("[aufwand-1027] ohne jede Messung steht das Mittel als nicht gemessen, nicht als 0", () => {
  const laeufe = [lauf("2026-09-20-220000", { einheiten: [altstand(621)] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(e.auskuenfte.mittelMs, { wert: null, einheiten: 0, laeufe: 0 });
    assert.deepEqual(e.auskuenfte.umsetzungen, []);
    assert.match(bericht(dir), /Mittel ueber die Umsetzungseinheiten: nicht gemessen/);
  });
});

// ============================================================
// Unterbefehl `auskunft` (E13)
// ============================================================

test("[aufwand-1027] auskunft misst ein Transkript mit bekannten Spannen", () => {
  // 30 s Rueckfrage, 90 s Nachlesen eines ausgelagerten Ergebnisses, 60 s Pipe an jq;
  // der `git status` dazwischen dauert vier Minuten und zaehlt nicht.
  mitProjekt({}, (dir) => {
    const res = aufwand(dir, "auskunft", SPANNEN);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /transkript-spannen\.jsonl: 3,0 min, 3 Aufrufe/);
    assert.match(res.stdout, /Gesamt: 3,0 min, 3 Aufrufe aus 1 Datei/);
  });
});

test("[aufwand-1027] eine Datei ohne Zeitstempel und eine unlesbare werden gemeldet, nicht als 0 gezaehlt", () => {
  mitProjekt({}, (dir) => {
    const fehlt = join(dir, "gibt-es-nicht.jsonl");
    const res = aufwand(dir, "auskunft", SPANNEN, OHNE_ZEIT, fehlt);

    assert.equal(res.status, 1, "eine nicht messbare Datei ist ein Fehlschlag des Aufrufs");
    assert.match(res.stdout, /transkript-ohne-zeitstempel\.jsonl: ohne Zeitstempel — nicht gemessen/);
    assert.match(res.stdout, /gibt-es-nicht\.jsonl: nicht lesbar/);
    assert.match(res.stdout, /Gesamt: 3,0 min, 3 Aufrufe aus 1 Datei \(2 nicht gemessen\)/,
      "die beiden nicht messbaren Dateien duerfen die Summe nicht als 0 tragen");
  });
});

test("[aufwand-1027] transkriptMessen: Aufruf ohne Ergebnis zaehlt, seine Spanne nicht", () => {
  const m = transkriptMessen(lesen(ECHTE_ZEILE));
  assert.deepEqual(m, { ms: 0, aufrufe: 1, ohneSpanne: 1, zeitstempel: true });
  assert.deepEqual(transkriptMessen(lesen(OHNE_ZEIT)).zeitstempel, false);
});

test("[aufwand-1027] auskunft ohne Datei wird abgewiesen", () => {
  mitProjekt({}, (dir) => {
    const res = aufwand(dir, "auskunft");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /auskunft.*Transkript/);
  });
});

test("[aufwand-1027] ein unbekannter Unterbefehl nennt alle drei", () => {
  mitProjekt({}, (dir) => {
    const res = aufwand(dir, "zaehlen");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /auswerten, befund oder auskunft/);
    assert.match(res.stdout, /aufwand\.mjs auskunft <transkript/, "die Hilfe nennt den Unterbefehl");
  });
});
