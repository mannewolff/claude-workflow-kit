// Ziel und Prueferzahl einer Karte der Nacht-Kette (Plan #1243, A1, A3, E2; Issue #1244).
//
// zielVon und pruefreihenVon sind rein und an Fixtures pruefbar: kein Wurf, auch nicht
// ohne Labels oder Budget. Unpassende Kombinationen lehnt erst `zielAusschluss` in der
// Auswahl ab (test/night-kette-ziel.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { KETTE_ZIELE, PLANREVIEW_LABELS, ZIEL_LABEL_PRAEFIX, pruefreihenVon, zielVon } from "../kit/night/session.mjs";

const BUDGET = { varianteBLabel: "kit:durchziehen" };
const karte = (...labels) => ({ labels: ["kit:night", ...labels] });

test("die Ziele stehen in fester Reihenfolge, je mit ihrer Endstufe", () => {
  assert.deepEqual(KETTE_ZIELE.map((z) => [z.ziel, z.endstufe]), [
    ["plan", "review"],
    ["pakete", "abdeckung"],
    ["umsetzung", "umsetzung"],
    ["push-vorbereitet", "vorbereitung"],
  ]);
  assert.equal(ZIEL_LABEL_PRAEFIX, "ziel:");
  assert.deepEqual([...PLANREVIEW_LABELS], ["planreview:1", "planreview:2"]);
});

test("A3: jedes Ziel-Label allein ergibt sein Ziel", () => {
  for (const { ziel } of KETTE_ZIELE) {
    assert.equal(zielVon(karte(`ziel:${ziel}`), BUDGET), ziel);
  }
});

test("A3: ohne Ziel-Label und ohne kit:durchziehen gilt kein Ziel", () => {
  assert.equal(zielVon(karte(), BUDGET), null);
  assert.equal(zielVon({ labels: [] }, BUDGET), null);
  assert.equal(zielVon({}, BUDGET), null);
  assert.equal(zielVon(undefined, BUDGET), null);
});

test("A3: kit:durchziehen allein zaehlt als umsetzung", () => {
  assert.equal(zielVon(karte("kit:durchziehen"), BUDGET), "umsetzung");
});

test("A3: kit:durchziehen plus ziel:plan ergibt umsetzung, das weiter reichende gilt", () => {
  assert.equal(zielVon(karte("ziel:plan", "kit:durchziehen"), BUDGET), "umsetzung");
  assert.equal(zielVon(karte("ziel:pakete", "kit:durchziehen"), BUDGET), "umsetzung");
});

test("A3: ziel:push-vorbereitet reicht weiter als kit:durchziehen", () => {
  assert.equal(zielVon(karte("ziel:push-vorbereitet", "kit:durchziehen"), BUDGET), "push-vorbereitet");
});

test("A3: das Durchziehen-Label kommt aus dem Budget, ohne Budget zaehlt nur das Ziel-Label", () => {
  assert.equal(zielVon(karte("kit:weiterziehen"), { varianteBLabel: "kit:weiterziehen" }), "umsetzung");
  assert.equal(zielVon(karte("kit:durchziehen"), { varianteBLabel: "kit:weiterziehen" }), null);
  assert.equal(zielVon(karte("kit:durchziehen"), undefined), null);
  assert.equal(zielVon(karte("ziel:pakete"), undefined), "pakete");
});

test("ein unbekanntes ziel:* zaehlt nicht als Ziel", () => {
  assert.equal(zielVon(karte("ziel:irgendwas"), BUDGET), null);
});

test("pruefreihenVon: planreview:1 ergibt 1, planreview:2 ergibt 2, ohne Angabe null", () => {
  assert.equal(pruefreihenVon(karte("planreview:1")), 1);
  assert.equal(pruefreihenVon(karte("planreview:2")), 2);
  assert.equal(pruefreihenVon(karte()), null);
  assert.equal(pruefreihenVon({}), null);
  assert.equal(pruefreihenVon(undefined), null);
});

test("pruefreihenVon: tragen beide, gilt 2 ohne Wurf", () => {
  assert.equal(pruefreihenVon(karte("planreview:1", "planreview:2")), 2);
});
