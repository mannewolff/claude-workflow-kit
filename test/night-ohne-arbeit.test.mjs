// Der eine Satz eines Laufs ohne Arbeitspaket (Fachliche Quelle #880, Plan #882; Issue #885).
//
// `grundOhneArbeit` ist die einzige Stelle, die diese Saetze bildet: Jeder Fall nennt
// sich selbst und traegt die beteiligten Namen und Zahlen mit. Verstreute Formulierungen
// laufen auseinander, ein Satz je Fall an einer Stelle nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { grundOhneArbeit, OHNE_ARBEIT_UNBEKANNT } from "../kit/night.mjs";

/** Die Grenze, die `nachtlaufMeldung` beim Kappen zieht (`NACHTLAUF_NOWORKREASON_MAX`, `kit/board.mjs`). */
const NOWORKREASON_MAX = 300;

/** Ein Name, der deutlich ueber `OHNE_ARBEIT_NAME_MAX` (80) hinausgeht. */
const LANGER_NAME = "x".repeat(400);

/** Alle Faelle mit Daten, die jede Variable ueber die Kuerzungsgrenze treiben. */
const FAELLE_LANG = [
  ["readyLeer", {}],
  ["keinLabel", { anzahl: 999999, label: LANGER_NAME }],
  ["alleZurueckgestellt", { anzahl: 999999 }],
  ["umsetzungBelegt", { grund: LANGER_NAME }],
  ["ketteKeinLabel", { label: LANGER_NAME }],
  ["ketteAlleUebersprungen", { anzahl: 999999, label: LANGER_NAME }],
];

test("[night-45] jeder Fall liefert einen Satz, der den Fall benennt und seine Namen und Zahlen traegt", () => {
  assert.equal(grundOhneArbeit("readyLeer", {}), "Ready ist leer — nichts zu tun.");
  assert.equal(
    grundOhneArbeit("keinLabel", { anzahl: 3, label: "kit:night" }),
    "Keine der 3 Karten in Ready traegt das Label 'kit:night' — nichts zu tun.",
  );
  assert.equal(
    grundOhneArbeit("alleZurueckgestellt", { anzahl: 4 }),
    "Alle 4 Karten in Ready wurden am Gate zurueckgestellt — der Lauf hat Ready selbst geleert, es blieb nichts zu tun.",
  );
  assert.equal(
    grundOhneArbeit("umsetzungBelegt", { grund: "Lauf 2026-09-24 laeuft noch" }),
    "Die Umsetzung ist belegt: Lauf 2026-09-24 laeuft noch — der Lauf endet ohne Paket.",
  );
  assert.equal(
    grundOhneArbeit("ketteKeinLabel", { label: "kit:night" }),
    "Keine Kette zu fahren: kein Fachplan traegt das Label 'kit:night'.",
  );
  assert.equal(
    grundOhneArbeit("ketteAlleUebersprungen", { anzahl: 2, label: "kit:night" }),
    "Keine Kette zu fahren: alle 2 Fachplaene mit dem Label 'kit:night' wurden uebersprungen, weil eine Voraussetzung fehlt.",
  );
});

test("[night-45] ein unbekannter Fallname liefert wortgleich den Rueckfall-Satz", () => {
  assert.equal(grundOhneArbeit("gibtEsNicht", {}), OHNE_ARBEIT_UNBEKANNT);
  assert.equal(grundOhneArbeit(undefined, undefined), OHNE_ARBEIT_UNBEKANNT);
  assert.match(OHNE_ARBEIT_UNBEKANNT, /bitte melden\.$/);
});

test("[night-45] beide Kettensaetze beginnen mit dem gemeinsamen Praefix", () => {
  for (const fall of ["ketteKeinLabel", "ketteAlleUebersprungen"]) {
    const satz = grundOhneArbeit(fall, { anzahl: 2, label: "kit:night" });
    assert.ok(satz.startsWith("Keine Kette zu fahren:"), `${fall} beginnt anders: ${satz}`);
  }
});

test("[night-45] auch der laengste bildbare Satz bleibt unter der Grenze des Lauf-Kopfs", () => {
  for (const [fall, daten] of FAELLE_LANG) {
    const satz = grundOhneArbeit(fall, daten);
    assert.ok(
      satz.length < NOWORKREASON_MAX,
      `${fall} bildet ${satz.length} Zeichen und wuerde am Lauf-Kopf gekappt`,
    );
  }
  assert.ok(OHNE_ARBEIT_UNBEKANNT.length < NOWORKREASON_MAX, "der Rueckfall-Satz wuerde gekappt");
});
