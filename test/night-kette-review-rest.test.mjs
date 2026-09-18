// Der Rest einer abgebrochenen Review-Stufe (Issue #654).
//
// Bricht die Review-Session ab, nachdem sie ihre Befunde schon an den Plan geschrieben
// hat, bleibt der teuerste Zustand zurueck: Die Pruefung ist bezahlt, die Befunde stehen
// am Board, der Body ist unveraendert und traegt keinen `Plan-Review:`-Marker. Wer das
// Dokument spaeter sichtet, sieht ein ungeprueftes und prueft erneut. Der Vermerk macht
// genau diesen Zustand am Dokument selbst sichtbar — ohne den Ausgang zu aendern.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NUR_POSIX, run, mitProjekt, fachplan, umgebung, stand, planBody, PLAN_ANLEGEN,
} from "./helpers/kette-fixture.mjs";
import { REVIEW_REST_ANKER } from "../kit/night.mjs";

/** Die Fake-Zeile der Stufe review: haengt die Befunde als Kommentar an den Plan aus dem Prompt. */
const BEFUNDE = String.raw`id=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issue-review #\([0-9]*\).*|\1|p"); node .claude/kit/board.mjs issue comment "$id" --text "Fund 1 (opus, WICHTIG): Kriterium 3 ist im Weg nicht abgebildet." >/dev/null`;

/** Der Plan-Body, wie ihn eine durchgelaufene Einarbeitung hinterliesse: mit Marker im Kopf. */
const PLAN_MIT_MARKER = planBody().replace(
  "Plan-Modell: fixture-modell",
  "Plan-Modell: fixture-modell\nPlan-Review: opus (2026-09-14, Nachtlauf)",
);

/** Der Plan des Laufs und sein Dateiinhalt. */
function plan(dir, F) {
  const einheit = stand(dir).einheiten.find((e) => e.id === F);
  const id = einheit.stufen.plan.id;
  return { einheit, id, text: readFileSync(join(dir, "issues", `${id}.md`), "utf-8") };
}

/** Wie oft der Anker im Dokument steht. */
function anker(text) {
  return text.split(REVIEW_REST_ANKER).length - 1;
}

test("[night-19] bricht die Review-Stufe nach geschriebenen Befunden ohne Marker ab, traegt der Plan den Vermerk", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    // Die Session schreibt ihre Befunde und haengt dann — genau der Ablauf, der am
    // 2026-09-14 im Lauf 2026-09-14-113433 am Zeitbudget endete.
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: BEFUNDE + "; sleep 60" } });
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "6000" });
    assert.equal(res.status, 0, res.stderr);

    const { einheit, id, text } = plan(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /Zeitbudget review: die Session wurde nach [\d.]+ min am Limit beendet/);
    assert.equal(anker(text), 1, "genau ein Vermerk am Plan");
    assert.match(text, new RegExp(`^${REVIEW_REST_ANKER}$`, "m"), "der Anker steht auf einer eigenen Zeile");
    assert.ok(text.includes(`/issue-review #${id}`), "der Weg nach vorn nennt den Plan");
    assert.match(text, /Zeitbudget review/, "der Grund des Abbruchs steht im Vermerk");
    assert.ok(!/^\s*Plan-Review:\s*\S/m.test(text), "der Body traegt weiterhin keinen Marker");
    assert.match(res.stdout, new RegExp(`Vermerk .*an Plan #${id}`));
  });
});

test("[night-19] bricht die Review-Stufe ohne neuen Kommentar ab, bleibt der Plan ohne Vermerk", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: "exit 3" } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    const { einheit, text } = plan(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /technischer Fehler: die Session der Stufe review endete mit Exit 3/);
    assert.equal(anker(text), 0, "ohne Befunde gibt es nichts zu retten");
    assert.doesNotMatch(res.stdout, new RegExp(REVIEW_REST_ANKER));
  });
});

test("[night-19] traegt der Plan beim Abbruch schon den Marker, bleibt er ohne Vermerk", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    // Der Plan traegt den Marker bereits aus der Plan-Stufe: Die Einarbeitung war durch,
    // der Abbruch traf die Stufe danach.
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: BEFUNDE + "; exit 3" }, plan: PLAN_MIT_MARKER });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    const { einheit, text } = plan(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /technischer Fehler: die Session der Stufe review endete mit Exit 3/);
    assert.ok(/^\s*Plan-Review:\s*\S/m.test(text), "der Marker steht im Body");
    assert.equal(anker(text), 0, "mit Marker ist die Einarbeitung durch");
    assert.doesNotMatch(res.stdout, new RegExp(REVIEW_REST_ANKER));
  });
});
