// Kennzahlen je Stufe einer Kette im Ergebnisstand und in der Meldung (Issue #807/#808).
//
// Dritte von drei Dateien zum Ergebnisstand (Issue #836): Diese Tests fahren ganze
// Ketten, deshalb stehen sie fuer sich. Anlage und harte Stopps liegen in
// `night-ergebnisstand.test.mjs`, die Einheiten je Arbeitspaket in
// `night-ergebnisstand-einheiten.test.mjs`.
//
// Das Fixture der Kette liegt neben den uebrigen Kette-Tests und wird als Namensraum
// eingebunden, weil es `run`, `board`, `stand` und `NUR_POSIX` unter denselben Namen
// fuehrt wie das Fixture des Ergebnisstands.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import * as kette from "./helpers/kette-fixture.mjs";


// --- Kennzahlen einer Stufe mit Korrekturrunden (Issue #807) ---
//
// Eine Stufe der Nacht-Kette kann mehrere Sessions fahren: die eigentliche plus bis zu
// `korrekturrunden` Formkorrekturen. Bis Issue #807 behielt die Stufe die Kennzahlen der
// LETZTEN Session — die Summe ueber die Stufen entsprach damit nicht dem Verbrauch des
// Vorgangs, und eine Plan-Stufe mit zwei Korrekturrunden sah zu billig aus. Summiert
// werden alle numerischen Felder; `stopReason` und `isError` tragen den Wert der letzten
// Session, weil eine Summe ueber sie nicht definiert ist.

/** Die Fake-Zeile der Stufe form: repariert erst in der zweiten Runde, je Runde eigene Kennzahlen. */
const FORM_ZWEITE_RUNDE = [
  'runde=$(cat "$KETTE_LOG.formrunde" 2>/dev/null || echo 0)',
  "runde=$((runde + 1))",
  'printf "%s" "$runde" > "$KETTE_LOG.formrunde"',
  String.raw`KETTE_STOP="\"runde$runde\""`,
  `if [ "$runde" -ge 2 ]; then KETTE_IS_ERROR=false; ${kette.FORM_REPARIEREN}; else KETTE_IS_ERROR=true; fi`,
].join("; ");

/** Die Fake-Zeile der Stufe form fuer ein Paket, mit eigenen Kennzahlen der Korrekturrunde. */
const PAKET_REPARIEREN_MIT_KENNZAHLEN = `KETTE_STOP='"korrektur"'; KETTE_IS_ERROR=true; ${kette.PAKET_REPARIEREN}`;

test("[night-62] die Plan-Stufe mit zwei Korrekturrunden traegt die Summe ihrer drei Sessions, stopReason und isError der letzten", kette.NUR_POSIX, () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    const env = kette.umgebung(dir, {
      stufen: { plan: kette.PLAN_ANLEGEN, form: FORM_ZWEITE_RUNDE, review: kette.REVIEW_MARKER, pakete: kette.PAKETE_ANLEGEN },
      plan: kette.planBody({ ohneVerifizierung: true }),
      fix: kette.planBody(),
    });
    const res = kette.run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const e = kette.stand(dir).einheiten.find((x) => x.id === F);
    assert.equal(e.ausgang, "fertig", e.grund);
    assert.equal(e.stufen.plan.korrekturrunden, 2, "der Test braucht genau zwei Korrekturrunden");
    // Drei Sessions à 1 $, 5 ms API-Dauer, 1 Zug und den vier Token-Mengen des Fakes.
    // Vor Issue #807 stand hier der Wert der letzten Session allein (1 $, 5 ms, 1 Zug).
    assert.deepEqual(e.stufen.plan.kennzahlen, {
      kostenUsd: 3,
      apiDauerMs: 15,
      zuege: 3,
      stopReason: "runde2",
      isError: false,
      eingabeTokens: 30,
      ausgabeTokens: 60,
      cacheErzeugtTokens: 90,
      cacheGelesenTokens: 120,
      cache5mTokens: null,
      cache1hTokens: null,
    });
  });
});

test("[night-62] die Pakete-Stufe mit einer Korrekturrunde traegt die Summe ihrer zwei Sessions, stopReason und isError der letzten", kette.NUR_POSIX, () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    const env = kette.umgebung(dir, {
      stufen: {
        plan: kette.PLAN_ANLEGEN, review: kette.REVIEW_MARKER,
        pakete: kette.PAKET_OHNE_ABHAENGIGKEITEN, form: PAKET_REPARIEREN_MIT_KENNZAHLEN,
      },
    });
    const res = kette.run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const e = kette.stand(dir).einheiten.find((x) => x.id === F);
    assert.equal(e.ausgang, "fertig", e.grund);
    assert.equal(e.stufen.pakete.korrekturrunden, 1, "der Test braucht genau eine Korrekturrunde");
    assert.deepEqual(e.stufen.pakete.kennzahlen, {
      kostenUsd: 2,
      apiDauerMs: 10,
      zuege: 2,
      stopReason: "korrektur",
      isError: true,
      eingabeTokens: 20,
      ausgabeTokens: 40,
      cacheErzeugtTokens: 60,
      cacheGelesenTokens: 80,
      cache5mTokens: null,
      cache1hTokens: null,
    });
  });
});

test("[night-62] Review und Abdeckung haben keine Korrekturrunden und tragen die Kennzahlen ihrer einen Session", kette.NUR_POSIX, () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    const env = kette.umgebung(dir, {
      stufen: { plan: kette.PLAN_ANLEGEN, review: kette.REVIEW_MARKER, pakete: kette.PAKETE_ANLEGEN },
    });
    const res = kette.run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const e = kette.stand(dir).einheiten.find((x) => x.id === F);
    assert.equal(e.ausgang, "fertig", e.grund);
    const eineSession = { kostenUsd: 1, apiDauerMs: 5, zuege: 1 };
    for (const stufe of ["plan", "review", "pakete", "abdeckung"]) {
      const k = e.stufen[stufe].kennzahlen;
      assert.deepEqual({ kostenUsd: k.kostenUsd, apiDauerMs: k.apiDauerMs, zuege: k.zuege }, eineSession,
        `Stufe ${stufe}: eine Session, also unveraendert deren Kennzahlen`);
      assert.equal(k.stopReason, null, `Stufe ${stufe}: der Fake liefert keinen stop_reason`);
      assert.equal(k.isError, null, `Stufe ${stufe}: der Fake liefert kein is_error`);
    }
  });
});

// --- Budgets, Herkunft, Stufen, Modellzeit und Zuege in der Meldung (Issue #808) ---
//
// Der Unit-Test in board-nightrun.test.mjs belegt die reine nachtlaufMeldung(); dieser
// hier belegt ueber den meldungs-abfangenden Board-Stellvertreter, dass der ECHTE Runner
// diese Payload baut — nicht nur die Hilfsfunktion im Test. Die Kette laeuft ohne
// eigenen night.kette-Block: Alle Budget-Felder kommen aus den Defaults, der Zuschnitt
// auf die fuenf gezeigten Felder (E4) ist damit direkt sichtbar.
test("[board-20] der echte Kettenlauf meldet Budget samt Herkunft, die vier Stufen und Modellzeit und Zuege je Vorgang", kette.NUR_POSIX, () => {
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
