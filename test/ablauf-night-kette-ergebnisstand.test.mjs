// Ablauf-Pruefung: Die Meldung ans Board baut erst der Einstieg kit/night.mjs aus dem Lauf-Kopf samt Budget-Herkunft; belegt wird, was der echte Runner einliefert, nicht nur die Hilfsfunktion.
//
// Kennzahlen je Stufe einer Kette in der Meldung (Issue #808). Die Kennzahlen im
// Ergebnisstand (Issue #807) stehen im selben Prozess in `night-kette-ergebnisstand.test.mjs`
// (Issue #1233).
//
// Das Fixture der Kette wird als Namensraum eingebunden, weil es `run`, `board` und
// `stand` unter denselben Namen fuehrt wie das Fixture des Ergebnisstands.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import * as kette from "./helpers/kette-ablauf.mjs";

// --- Budgets, Herkunft, Stufen, Modellzeit und Zuege in der Meldung (Issue #808) ---
//
// Der Unit-Test in board-nightrun.test.mjs belegt die reine nachtlaufMeldung(); dieser
// hier belegt ueber den meldungs-abfangenden Board-Stellvertreter, dass der ECHTE Runner
// diese Payload baut — nicht nur die Hilfsfunktion im Test. Die Kette laeuft ohne
// eigenen night.kette-Block: Alle Budget-Felder kommen aus den Defaults, der Zuschnitt
// auf die fuenf gezeigten Felder (E4) ist damit direkt sichtbar.
test("[board-20] der echte Kettenlauf meldet Budget samt Herkunft, die vier Stufen und Modellzeit und Zuege je Vorgang", () => {
  const dir = kette.setupProjekt({}, "night-stand-payload-");
  const capture = join(dir, "..", `melde-capture-${basename(dir)}.jsonl`);
  kette.meldeCaptureInstallieren(dir);
  try {
    const F = kette.fachplan(dir);
    const env = {
      ...kette.umgebung(dir, { stufen: { plan: kette.PLAN_ANLEGEN, review: kette.REVIEW_MARKER, pakete: kette.PAKETE_ANLEGEN } }),
      NIGHT_MELDEN_ERZWINGEN: "1",
      KETTE_MELDE_CAPTURE: capture,
    };
    const res = kette.run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const alle = readFileSync(capture, "utf-8").trim().split("\n").filter(Boolean).map((z) => JSON.parse(z));
    const m = alle.at(-1).meldung;
    assert.deepEqual(m.budget, {
      planMin: 20, reviewMin: 15, paketeMin: 15, abdeckungMin: 10, kostenUsd: 50,
      origin: "DEFAULTED", defaultFields: ["planMin", "paketeMin", "reviewMin", "abdeckungMin", "kostenUsd"],
    }, "das Budget traegt die fuenf gezeigten Felder und die zugeschnittene Herkunft");

    const einheit = m.items.find((i) => i.cardNumber === Number(F));
    assert.ok(einheit, `kein Item zur Kette #${F} in der Meldung: ${JSON.stringify(m.items)}`);
    assert.deepEqual(einheit.stages.map((s) => s.stage), ["plan", "review", "pakete", "abdeckung"]);
    for (const s of einheit.stages) {
      assert.equal(typeof s.durationMs, "number", `Stufe ${s.stage}: die Dauer fehlt`);
      assert.equal(s.usage.costUsd, 1, `Stufe ${s.stage}: die Kosten der einen Session`);
      assert.equal(s.usage.modelDurationMs, 5, `Stufe ${s.stage}: die Modellzeit der einen Session`);
      assert.equal(s.usage.turns, 1, `Stufe ${s.stage}: die Zuege der einen Session`);
    }
    assert.equal(einheit.usage.modelDurationMs, 20, "die Kette summiert die Modellzeit ihrer vier Stufen");
    assert.equal(einheit.usage.turns, 4, "die Kette summiert die Zuege ihrer vier Stufen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(capture, { force: true });
  }
});
