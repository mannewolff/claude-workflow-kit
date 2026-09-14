// Abbrueche der Nacht-Kette: kein Plan, Korrekturrunden, Kosten, Zeit (Plan #638, A5–A7, E1; Issue #643).
//
// Jeder Abbruch ist ein Ausgang mit Grund im Ergebnisstand, kein Fehler des Laufs: Der
// Runner endet mit Exit 0, das Label ist verbraucht, der naechste Kandidat kaeme dran.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, sessions, stand, planBody, PLAN_ANLEGEN, FORM_REPARIEREN, REVIEW_MARKER,
} from "./helpers/kette-fixture.mjs";

test("[night-19] ohne neuen Plan endet die Kette abgebrochen: kein Plan entstanden", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: {} });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /kein Plan entstanden/);
    assert.equal(einheit.stufen.plan.id, null);
    assert.ok(!board(dir, "issue", "get", F).labels.includes("kit:night"), "das Label ist trotzdem verbraucht");
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan"]);
  });
});

test("[night-19] eine rote Formpruefung loest eine Korrekturrunde aus; danach ist die Kette fertig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, form: FORM_REPARIEREN, review: REVIEW_MARKER },
      plan: planBody({ ohneVerifizierung: true }),
      fix: planBody(),
    });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.plan.korrekturrunden, 1);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "form", "review"]);
    assert.match(res.stdout, /Formpruefung #0002 rot .*Korrekturrunde 1 von 2/);
    assert.match(res.stdout, /Formpruefung #0002 gruen/);
  });
});

test("[night-19] bleibt die Form nach den Korrekturrunden rot, endet die Kette abgebrochen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, form: ":", review: REVIEW_MARKER },
      plan: planBody({ ohneVerifizierung: true }),
    });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /Form nach 2 Korrekturrunde\(n\) weiterhin verletzt \(#0002\)/);
    assert.equal(einheit.stufen.plan.korrekturrunden, 2);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "form", "form"], "keine Review-Session nach dem Abbruch");
  }, { korrekturrunden: 2 });
});

test("[night-19] ueberschreiten die Kosten das Budget, endet die Kette nach der Session abgebrochen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER }, kosten: 30 });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /Kostenbudget: 30\.00 \$ von 25 \$ nach der Stufe plan/);
    assert.equal(einheit.kostenUsd, 30);
    assert.equal(einheit.stufen.plan.id, "0002", "der Plan ist trotzdem angelegt worden");
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan"], "die Review-Session darf nicht mehr starten");
  }, { kostenUsd: 25 });
});

test("[night-19] eine Session ohne result-Ereignis zaehlt 0 und erhoeht kostenUnbekannt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER }, ohneResult: true });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig");
    assert.equal(einheit.kostenUsd, 0);
    assert.equal(einheit.kostenUnbekannt, 2);
    assert.equal(einheit.stufen.plan.kennzahlen, null);
  });
});

test("[night-19] reisst eine Session das Zeitbudget der Stufe, endet die Kette abgebrochen mit Zeitbudget plan", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: "sleep 5; " + PLAN_ANLEGEN } });
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "300" });
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /Zeitbudget plan: die Session wurde nach [\d.]+ min am Limit beendet/);
  });
});

test("[night-19] ein Fehlstart der Session ist ein technischer Fehler dieser Kette, kein harter Stopp", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: "exit 3" } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, "ein Fehlstart beendet die Kette, nicht den Lauf");
    const lauf = stand(dir);
    assert.equal(lauf.abschluss, "regulaer");
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /technischer Fehler: die Session der Stufe plan endete mit Exit 3/);
  });
});
