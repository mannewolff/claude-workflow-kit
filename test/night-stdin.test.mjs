// Der Nacht-Runner startet jede CLI-Session mit geschlossenem stdin (Issue #620).
//
// Ohne stdio-Angabe erbt das Kind eine offene stdin-Pipe, die der Runner nie
// schliesst: Die CLI wartete je Session drei Sekunden auf Eingabe und schrieb
// "no stdin data received" ins Protokoll. Ein Fake, der stdin bis zum Dateiende
// liest, stellt das nach — mit offenem stdin haengt er bis zum Zeitlimit, mit
// geschlossenem bekommt er sofort das Dateiende und laeuft regulaer aus.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  run, mitProjekt, fachplan, umgebung, sessions, stand, VORFLUG_OK,
} from "./helpers/kette-ablauf.mjs";

test("[night-22] eine Session, die stdin bis zum Dateiende liest, endet sofort statt am Zeitlimit", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: "cat > /dev/null" } });
    // 20 s statt 2 s (Issue #1080): Die Session soll sofort enden; 2 s riss unter Last
    // schon der Start. Haelt stdin sie fest, wartet der Test im Fehlerfall 20 s.
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "20000" });
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /kein Plan entstanden/, "die Session haette regulaer enden muessen, nicht am Zeitlimit");
    assert.doesNotMatch(einheit.grund, /Zeitbudget/);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan"]);
  });
});

test("[night-22] auch die Vorflug-Session bekommt ein geschlossenes stdin", () => {
  mitProjekt((dir) => {
    fachplan(dir);
    const env = umgebung(dir, { stufen: {} });
    const res = run(dir, ["--kette", "--dry-run"], {
      ...env, NIGHT_VORFLUG_CMD: `cat > /dev/null; ${VORFLUG_OK}`, NIGHT_VORFLUG_TIMEOUT_MS: "2000",
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Tracker \(review-session\): erreichbar/, "der Vorflug-Befund kam nicht an — die Session hing an stdin");
    assert.doesNotMatch(res.stdout, /Zeitlimit von 2000 ms/);
  });
});
