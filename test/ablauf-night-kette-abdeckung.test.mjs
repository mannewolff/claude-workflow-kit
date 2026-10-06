// Ablauf-Pruefung: Das Zeitbudget der Stufe abdeckung beendet eine wirklich haengende Session nach der echten Uhr; im selben Prozess laesst sich dieser Abbruch nicht herstellen.
//
// Stufe Abdeckung der Nacht-Kette (Plan #638, A9; Issue #644), soweit sie am Zeitbudget
// haengt. Text, Schreibverbot und Prompt der Stufe stehen im selben Prozess in
// `night-kette-abdeckung.test.mjs` (Issue #1233).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  run, mitProjekt, fachplan, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-ablauf.mjs";

test("[night-20] reisst die Abdeckungs-Session ihr Zeitbudget, endet die Kette trotzdem fertig, der Grund steht an der Stufe", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, abdeckung: "sleep 5" } }); // # haengt — das Zeitbudget von 1,5 s beendet die Session, der Test wartet die 5 s nicht ab
    // Das kurze Limit gilt nur der Abdeckung (Issue #1080): Die drei Sessions davor
    // rissen es unter Last, und der Test wurde rot, obwohl die Abdeckung richtig reagierte.
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "1500", NIGHT_TIMEOUT_STUFE: "abdeckung" });
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.abdeckung.text, null);
    assert.match(einheit.stufen.abdeckung.grund, /Zeitbudget abdeckung/);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
  });
});
