// Ablauf-Pruefung: Das Zeitbudget beendet eine wirklich haengende Session nach der echten Uhr, und Fehlstart-Wiederholung, harter Stopp und Exit-Code entstehen erst im Lauf des Einstiegs kit/night.mjs.
//
// Abbrueche der Nacht-Kette, soweit sie den Einstieg brauchen (Plan #638, A5–A7, E1; Issue
// #643). Kein Plan, Korrekturrunden, Kosten und fehlende result-Ereignisse stehen im selben
// Prozess in `night-kette-budget-ablauf.test.mjs` (Issue #1233).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  run, mitProjekt, fachplan, umgebung, sessions, stand, PLAN_ANLEGEN,
} from "./helpers/kette-ablauf.mjs";
import { nachtlaufMeldung } from "../kit/board.mjs";

test("[night-19] reisst eine Session das Zeitbudget der Stufe, endet die Kette abgebrochen mit Zeitbudget plan", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: "sleep 5; " + PLAN_ANLEGEN } }); // # haengt — das Zeitbudget von 300 ms beendet die Session, der Test wartet die 5 s nicht ab
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "300" });
    assert.equal(res.status, 0, res.stderr);
    const lauf = stand(dir);
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /Zeitbudget plan: die Session wurde nach [\d.]+ min am Limit beendet/);
    // Eine erreichte Grenze ist kein Abbruch des Laufs (Issue #881): Der Lauf endet
    // regulaer, und die Meldung ans Board traegt deshalb keinen abortReason — der
    // Ausgang steht am roten Paket, nicht am Lauf.
    assert.equal(lauf.abschluss, "regulaer");
    assert.ok(!("abortReason" in nachtlaufMeldung(lauf)), "ein Zeitbudget stoppt die Kette, nicht den Lauf");
  });
});

// Seit Issue #1088 (Plan #1079 E13) ist ein Fehlstart — Exit ungleich 0 ohne ein Ereignis
// der Session — ein Umgebungsfehler: ein zweiter Versuch nach der Pause, scheitert auch er,
// haelt der Lauf an. Eine Session, die zustande kam und scheiterte, bleibt ein technischer
// Fehler dieser Kette (test/night-kette-review-rest.test.mjs).
test("[night-19] ein Fehlstart der Session bekommt einen zweiten Versuch, scheitert auch er, haelt der Lauf an", () => {
  mitProjekt((dir) => {
    fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: "exit 3" } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "plan").length, 2, "der Fehlstart wurde nicht genau einmal wiederholt");
    assert.match(res.stdout, /Umgebungsfehler: Sitzungsstart zu #\d+ gescheitert \(Exit 3\) — 2\. Versuch/);
    const lauf = stand(dir);
    assert.equal(lauf.abschluss, "harterStopp");
    assert.equal(lauf.fehlerklasse, "umgebung");
    assert.match(lauf.fehlerText, /Sitzungsstart der Stufe plan .* auch im 2\. Versuch gescheitert \(Exit 3\)/);
  }, {}, "night-kette-", { night: { stand: { pauseMin: 0.0001 } } });
});
