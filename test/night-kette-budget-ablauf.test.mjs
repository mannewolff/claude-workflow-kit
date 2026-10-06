// Abbrueche der Nacht-Kette: kein Plan, Korrekturrunden, Kosten, Zeit (Plan #638, A5–A7, E1; Issue #643).
//
// Jeder Abbruch ist ein Ausgang mit Grund im Ergebnisstand, kein Fehler des Laufs: Der
// Runner endet mit Exit 0, das Label ist verbraucht, der naechste Kandidat kaeme dran.
//
// Seit Issue #1233 laufen diese Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6).
// Das Zeitbudget einer haengenden Session und die Fehlstart-Wiederholung brauchen den
// Einstieg und stehen in `ablauf-night-kette-budget-ablauf.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, planBody, formReparieren, reviewMarker, paketeAnlegen,
} from "./helpers/kette-fixture.mjs";

test("[night-19] ohne neuen Plan endet die Kette abgebrochen: kein Plan entstanden", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: jeStufe({}) });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /kein Plan entstanden/);
  assert.equal(einheit.stufen.plan.id, null);
  assert.ok(!r.karte("1").labels.includes("kit:night"), "das Label ist trotzdem verbraucht");
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan"]);
});

test("[night-19] eine rote Formpruefung loest eine Korrekturrunde aus; danach ist die Kette fertig", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(planBody({ ohneVerifizierung: true })), form: formReparieren(planBody()), review: reviewMarker, pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.plan.korrekturrunden, 1);
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "form", "review", "pakete", "abdeckung"]);
  assert.match(r.ausgabe, /Formpruefung #2 rot .*Korrekturrunde 1 von 2/);
  assert.match(r.ausgabe, /Formpruefung #2 gruen/);
});

test("[night-19] bleibt die Form nach den Korrekturrunden rot, endet die Kette abgebrochen", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")], kette: { korrekturrunden: 2 },
    sitzung: jeStufe({ plan: planAnlegen(planBody({ ohneVerifizierung: true })), review: reviewMarker }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /Form nach 2 Korrekturrunde\(n\) weiterhin verletzt \(#2\)/);
  assert.equal(einheit.stufen.plan.korrekturrunden, 2);
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "form", "form"], "keine Review-Session nach dem Abbruch");
});

test("[night-19] ueberschreiten die Kosten das Budget, endet die Kette nach der Session abgebrochen", async () => {
  const stufen = jeStufe({ plan: planAnlegen(), review: reviewMarker });
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")], kette: { kostenUsd: 25 },
    sitzung: (s) => ({ ...stufen(s), kosten: 30 }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /Kostenbudget: 30\.00 \$ von 25 \$ nach der Stufe plan/);
  assert.equal(einheit.kostenUsd, 30);
  assert.equal(einheit.stufen.plan.id, "2", "der Plan ist trotzdem angelegt worden");
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan"], "die Review-Session darf nicht mehr starten");
});

test("[night-19] eine Session ohne result-Ereignis zaehlt 0 und erhoeht kostenUnbekannt", async () => {
  const stufen = jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen });
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: (s) => ({ ...stufen(s), ohneResult: true }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig");
  assert.equal(einheit.kostenUsd, 0);
  assert.equal(einheit.kostenUnbekannt, 4);
  assert.equal(einheit.stufen.plan.kennzahlen, null);
});
