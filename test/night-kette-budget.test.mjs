// Die Budgets der Nacht-Kette und die Kostensumme je Lauf (Plan #638, A5/A6; Issue #642).
//
// `night.kette` traegt Zahlen, keine Prosa: Zeit je Stufe, Kosten je Kette, Korrekturrunden.
// Jede muss endlich und groesser 0 sein — ein Budget von 0 waere eine Kette, die nie
// startet. `kostenAddieren` summiert, und eine fehlende Kennzahl zaehlt 0 mit eigenem
// Zaehler (E1 im Plan).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ladeKetteBudget, ketteBudgetDefaults, kostenAddieren, KETTE_BUDGET_DEFAULTS } from "../kit/night.mjs";

test("[night-18] ohne Block gelten die Startwerte aus Fachplan #635", () => {
  assert.deepEqual(ladeKetteBudget({}), {
    label: "kit:night", varianteBLabel: "kit:durchziehen", planMin: 20, paketeMin: 15, reviewMin: 15,
    abdeckungMin: 10, umsetzungMin: 120, kostenUsd: 50, kostenUsdB: 150, korrekturrunden: 2,
  });
  assert.deepEqual(ladeKetteBudget(undefined), { ...KETTE_BUDGET_DEFAULTS });
  assert.deepEqual(ladeKetteBudget({ night: {} }), { ...KETTE_BUDGET_DEFAULTS });
});

test("[night-18] jedes Feld laesst sich einzeln ueberschreiben, der Rest bleibt Default", () => {
  const budget = ladeKetteBudget({ night: { kette: { planMin: 45, kostenUsd: 12.5, label: " kit:nacht ", varianteBLabel: " kit:weiter " } } });
  assert.equal(budget.planMin, 45);
  assert.equal(budget.kostenUsd, 12.5);
  assert.equal(budget.label, "kit:nacht", "das Label wird getrimmt");
  assert.equal(budget.varianteBLabel, "kit:weiter", "das Variante-B-Label wird getrimmt");
  assert.equal(budget.paketeMin, 15);
  assert.equal(budget.umsetzungMin, 120);
  assert.equal(budget.kostenUsdB, 150);
  assert.equal(budget.korrekturrunden, 2);
});

for (const [feld, wert] of [["planMin", 0], ["paketeMin", -5], ["reviewMin", Number.NaN], ["abdeckungMin", "10"], ["kostenUsd", Number.POSITIVE_INFINITY]]) {
  test(`[night-18] ${feld} = ${String(wert)} wird mit Feldname abgewiesen`, () => {
    assert.throws(() => ladeKetteBudget({ night: { kette: { [feld]: wert } } }), new RegExp(`night\\.kette\\.${feld} muss eine Zahl groesser 0 sein`));
  });
}

for (const [feld, wert] of [["umsetzungMin", 0], ["umsetzungMin", -5], ["umsetzungMin", Number.POSITIVE_INFINITY], ["umsetzungMin", "120"], ["kostenUsdB", 0], ["kostenUsdB", -5], ["kostenUsdB", Number.POSITIVE_INFINITY], ["kostenUsdB", "150"]]) {
  test(`[night-18] ${feld} = ${String(wert)} wird mit Feldname abgewiesen`, () => {
    assert.throws(() => ladeKetteBudget({ night: { kette: { [feld]: wert } } }), new RegExp(`night\\.kette\\.${feld} muss eine Zahl groesser 0 sein`));
  });
}

test("[night-18] korrekturrunden muss ganzzahlig sein", () => {
  assert.throws(() => ladeKetteBudget({ night: { kette: { korrekturrunden: 1.5 } } }), /night\.kette\.korrekturrunden muss ganzzahlig sein/);
  assert.equal(ladeKetteBudget({ night: { kette: { korrekturrunden: 3 } } }).korrekturrunden, 3);
});

test("[night-18] ein leeres Label wird abgewiesen", () => {
  assert.throws(() => ladeKetteBudget({ night: { kette: { label: "  " } } }), /night\.kette\.label/);
});

test("[night-18] ein leeres varianteBLabel wird abgewiesen", () => {
  assert.throws(() => ladeKetteBudget({ night: { kette: { varianteBLabel: "  " } } }), /night\.kette\.varianteBLabel/);
});

test("[night-18] ein varianteBLabel, das kein Text ist, wird abgewiesen", () => {
  assert.throws(() => ladeKetteBudget({ night: { kette: { varianteBLabel: 5 } } }), /night\.kette\.varianteBLabel/);
});

test("[night-18] kostenAddieren summiert Zahlen und zaehlt fehlende Werte als 0 mit eigenem Zaehler", () => {
  const lauf = {};
  kostenAddieren(lauf, { kostenUsd: 1.25, apiDauerMs: 10, zuege: 2 });
  kostenAddieren(lauf, { kostenUsd: 0, apiDauerMs: 10, zuege: 1 });
  kostenAddieren(lauf, { kostenUsd: null, apiDauerMs: null, zuege: null });
  kostenAddieren(lauf, null);
  kostenAddieren(lauf, { kostenUsd: 2 });
  assert.equal(lauf.kostenSumme, 3.25);
  assert.equal(lauf.kostenUnbekannt, 2, "null und fehlende Kennzahlen zaehlen als unbekannt");
});

// Die Herkunft der Budgets (Issue #659): welche Felder aus den Defaults stammen.
test("[night-28] ketteBudgetDefaults ohne Block nennt alle zehn Felder", () => {
  assert.deepEqual(ketteBudgetDefaults({}),
    ["label", "varianteBLabel", "planMin", "paketeMin", "reviewMin", "abdeckungMin", "umsetzungMin", "kostenUsd", "kostenUsdB", "korrekturrunden"]);
  assert.deepEqual(ketteBudgetDefaults(undefined), ketteBudgetDefaults({ night: {} }));
});

test("[night-28] ketteBudgetDefaults mit vollstaendigem Block liefert eine leere Liste", () => {
  const kette = {
    label: "kit:night", varianteBLabel: "kit:durchziehen", planMin: 30, paketeMin: 25, reviewMin: 30,
    abdeckungMin: 10, umsetzungMin: 120, kostenUsd: 50, kostenUsdB: 150, korrekturrunden: 2,
  };
  assert.deepEqual(ketteBudgetDefaults({ night: { kette } }), []);
});

test("[night-28] ketteBudgetDefaults nennt genau das eine fehlende Feld", () => {
  const kette = {
    label: "kit:night", varianteBLabel: "kit:durchziehen", planMin: 30, paketeMin: 25, abdeckungMin: 10,
    umsetzungMin: 120, kostenUsd: 50, kostenUsdB: 150, korrekturrunden: 2,
  };
  assert.deepEqual(ketteBudgetDefaults({ night: { kette } }), ["reviewMin"]);
});

test("[night-28] ketteBudgetDefaults liefert die Felder in der Reihenfolge von ladeKetteBudget", () => {
  const kette = { korrekturrunden: 2, planMin: 30, label: "kit:night" };
  assert.deepEqual(ketteBudgetDefaults({ night: { kette } }),
    ["varianteBLabel", "paketeMin", "reviewMin", "abdeckungMin", "umsetzungMin", "kostenUsd", "kostenUsdB"]);
  assert.deepEqual(Object.keys(ladeKetteBudget({})).filter((f) => ketteBudgetDefaults({}).includes(f)), ketteBudgetDefaults({}));
});
