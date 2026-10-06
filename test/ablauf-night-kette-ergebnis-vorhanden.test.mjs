// Ablauf-Pruefung: Das Zeitlimit einer haengenden Review-Session greift nur am echten Prozess der Session (Kill der Prozessgruppe durch kit/night.mjs).
//
// Belegfall 2 aus #868 (Plan #1079, E2; Issue #1086): Die Review-Stufe reisst ihr Zeitlimit,
// der Marker steht aber schon im Plan — das Ergebnis gilt als vorgefunden. Die uebrigen
// Faelle des vorhandenen Ergebnisses stehen im selben Prozess in
// `night-kette-ergebnis-vorhanden.test.mjs` (Issue #1233).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  run, mitProjekt, fachplan, umgebung, sessions, stand, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-ablauf.mjs";

const ERZEUGEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };

function einheitVon(dir, id) {
  const einheit = stand(dir).einheiten.find((e) => e.id === id);
  assert.ok(einheit, `keine Einheit fuer #${id}`);
  return einheit;
}

test("[night-ergebnis] Belegfall 2 (#868): Review am Zeitlimit, Marker im Plan — fertig und vorgefunden", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, review: `${REVIEW_MARKER}; sleep 60` } }); // # haengt — das Zeitlimit beendet die Session, der Test wartet nicht auf sie
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "6000", NIGHT_TIMEOUT_STUFE: "review" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.review.vorgefunden, true);
    assert.equal(einheit.stufen.review.marker, true);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
  });
});
