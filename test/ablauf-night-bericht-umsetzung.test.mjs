// Ablauf-Pruefung: Die Felder der Kette-Einheit entstehen erst im echten Kettenlauf unter
// Variante B — die Listen fuellt der Runner aus den Stufen, nicht der Bericht.
//
// Die Kette-Einheit des Ergebnisstands traegt `variante`, die drei Paketlisten und je
// umgesetztem Paket Stufe, Modell und Gruendlichkeit (Plan #691, E13; Issue #697, #713,
// #846). Wie der Nachtbericht sie liest, prueft test/night-bericht-umsetzung.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  run, mitProjekt, fachplan, umgebung, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG, durchziehen,
} from "./helpers/kette-ablauf.mjs";

test("[night-36] [night-41] [night-42] die Kette-Einheit des Ergebnisstands traegt variante, die drei Listen und je umgesetztem Paket stufe, stufeVerwendet, modell und effort", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Ein Anliegen");
    durchziehen(dir, F);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.variante, "B");
    assert.ok(Array.isArray(einheit.stufen.umsetzung.umgesetzt));
    assert.ok(Array.isArray(einheit.stufen.umsetzung.angehalten));
    assert.ok(Array.isArray(einheit.stufen.umsetzung.nichtBegonnen));
    assert.deepEqual(einheit.stufen.umsetzung.umgesetzt.map((e) => e.id), einheit.stufen.pakete.ids);
    for (const eintrag of einheit.stufen.umsetzung.umgesetzt) {
      assert.ok("stufe" in eintrag, "traegt stufe");
      assert.ok("stufeVerwendet" in eintrag, "traegt stufeVerwendet");
      assert.ok("modell" in eintrag, "traegt modell");
      // Die Gruendlichkeit der verwendeten Stufe (Issue #846) — wie die drei Felder
      // daneben aus der Paket-Einheit, und ohne Stufe schlicht null.
      assert.ok("effort" in eintrag, "traegt effort");
    }
  });
});
