// Kennzahlen je Stufe einer Kette im Ergebnisstand und in der Meldung (Issue #807/#808).
//
// Dritte von drei Dateien zum Ergebnisstand (Issue #836): Diese Tests fahren ganze
// Ketten, deshalb stehen sie fuer sich. Anlage und harte Stopps liegen in
// `ablauf-night-ergebnisstand.test.mjs`, die Einheiten je Arbeitspaket in
// `ablauf-night-ergebnisstand-einheiten.test.mjs`.
//
// Seit Issue #1233 laufen diese Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6).
// Die Meldung ans Board baut erst der Einstieg; ihr Beleg steht in
// `ablauf-night-kette-ergebnisstand.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, planBody, formReparieren, reviewMarker, paketeAnlegen,
  paketOhneAbhaengigkeiten, paketReparieren, resultZeile, GLATT,
} from "./helpers/kette-fixture.mjs";

// --- Kennzahlen einer Stufe mit Korrekturrunden (Issue #807) ---
//
// Eine Stufe der Nacht-Kette kann mehrere Sessions fahren: die eigentliche plus bis zu
// `korrekturrunden` Formkorrekturen. Bis Issue #807 behielt die Stufe die Kennzahlen der
// LETZTEN Session — die Summe ueber die Stufen entsprach damit nicht dem Verbrauch des
// Vorgangs, und eine Plan-Stufe mit zwei Korrekturrunden sah zu billig aus. Summiert
// werden alle numerischen Felder; `stopReason` und `isError` tragen den Wert der letzten
// Session, weil eine Summe ueber sie nicht definiert ist.

/** Das Ende einer Session mit eigenem stop_reason und is_error statt des result-Ereignisses der Vorgabe. */
function mitKennzahlen(stop, isError) {
  return { zeilen: [JSON.stringify({ ...JSON.parse(resultZeile()), stop_reason: stop, is_error: isError })], ohneResult: true };
}

/** Stufe form: repariert erst in der zweiten Runde, je Runde eigene Kennzahlen. */
function formZweiteRunde() {
  let runde = 0;
  const reparieren = formReparieren(planBody());
  return (s) => {
    runde += 1;
    if (runde >= 2) {
      reparieren(s);
      return mitKennzahlen(`runde${runde}`, false);
    }
    return mitKennzahlen(`runde${runde}`, true);
  };
}

/** Stufe form fuer ein Paket, mit eigenen Kennzahlen der Korrekturrunde. */
function paketReparierenMitKennzahlen(s) {
  paketReparieren(s);
  return mitKennzahlen("korrektur", true);
}

test("[night-62] die Plan-Stufe mit zwei Korrekturrunden traegt die Summe ihrer drei Sessions, stopReason und isError der letzten", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(planBody({ ohneVerifizierung: true })), form: formZweiteRunde(), review: reviewMarker, pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const e = r.lauf.einheiten.find((x) => x.id === "1");
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

test("[night-62] die Pakete-Stufe mit einer Korrekturrunde traegt die Summe ihrer zwei Sessions, stopReason und isError der letzten", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketOhneAbhaengigkeiten, form: paketReparierenMitKennzahlen }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const e = r.lauf.einheiten.find((x) => x.id === "1");
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

test("[night-62] Review und Abdeckung haben keine Korrekturrunden und tragen die Kennzahlen ihrer einen Session", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  const e = r.lauf.einheiten.find((x) => x.id === "1");
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
