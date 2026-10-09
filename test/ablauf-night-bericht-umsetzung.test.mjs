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
import { prueflaufZeilen } from "../kit/night/bericht.mjs";

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

// --- Der Ausgang festgefahren im Pruefbericht (Issue #1391, Plan #1386, E13) ---
//
// Je Bremsung eine Zeile mit Pruefung, Laufzeit, Zeitgrenze und der gesparten Zeit als
// Schaetzung. Die Schaetzung steht nicht in der Einheit (E8), der Bericht rechnet sie aus
// `zeitgrenzeMs - dauerMs`, nie unter 0.

function festgefahreneEinheit(dauerMs, zeitgrenzeMs) {
  return {
    id: "0007", ausgang: "festgefahren", dauerMs, pruefung: { laufen: [] },
    festgefahren: { pruefung: "npm test", fehler: "test/a.test.mjs: erwartet 2", versuche: 3, zeitgrenzeMs },
  };
}

test("[night-1391] eine festgefahrene Einheit erscheint mit Pruefung, Laufzeit, Zeitgrenze und gesparter Zeit", () => {
  const zeilen = prueflaufZeilen([festgefahreneEinheit(12 * 60000, 60 * 60000)]);
  const zeile = zeilen.find((z) => z.includes("festgefahren"));
  assert.ok(zeile, zeilen.join("\n"));
  assert.equal(zeile, "- Issue #0007: festgefahren an npm test (3 Versuche), Laufzeit 12.0 min, Zeitgrenze 60.0 min, gesparte Zeit (Schaetzung) 48.0 min");
});

test("[night-1391] liegt die Laufzeit ueber der Zeitgrenze, ist die gesparte Zeit 0", () => {
  const zeile = prueflaufZeilen([festgefahreneEinheit(61 * 60000, 60 * 60000)]).find((z) => z.includes("festgefahren"));
  assert.match(zeile, /, gesparte Zeit \(Schaetzung\) 0\.0 min$/);
});

test("[night-1391] eine Einheit ohne Bremsung bekommt keine Zeile festgefahren", () => {
  const zeilen = prueflaufZeilen([{ id: "0008", ausgang: "erfolg", dauerMs: 60000, pruefung: { laufen: [] } }]);
  assert.ok(!zeilen.some((z) => z.includes("festgefahren")), zeilen.join("\n"));
});
