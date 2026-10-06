// Ablauf-Pruefung: Das Zeitbudget der Stufe review beendet eine wirklich haengende Session nach der echten Uhr; im selben Prozess laesst sich dieser Abbruch nicht herstellen.
//
// Der Rest einer abgebrochenen Review-Stufe (Issue #654), soweit er am Zeitbudget haengt.
// Abbrueche mit Exit-Code und der wartende Schlusstext stehen im selben Prozess in
// `night-kette-review-rest.test.mjs` (Issue #1233).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  run, mitProjekt, fachplan, umgebung, stand, PLAN_ANLEGEN,
} from "./helpers/kette-ablauf.mjs";
import { REVIEW_REST_ANKER } from "../kit/night/kette.mjs";

/** Die Fake-Zeile der Stufe review: haengt die Befunde als Kommentar an den Plan aus dem Prompt. */
const BEFUNDE = String.raw`id=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issue-review #\([0-9]*\).*|\1|p"); node .claude/kit/board.mjs issue comment "$id" --text "Fund 1 (opus, WICHTIG): Kriterium 3 ist im Weg nicht abgebildet." >/dev/null`;

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

test("[night-19] bricht die Review-Stufe nach geschriebenen Befunden ohne Marker ab, traegt der Plan den Vermerk", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    // Die Session schreibt ihre Befunde und haengt dann — genau der Ablauf, der am
    // 2026-09-14 im Lauf 2026-09-14-113433 am Zeitbudget endete.
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: BEFUNDE + "; sleep 60" } }); // # haengt — das Zeitbudget der Stufe review beendet die Session, der Test wartet die 60 s nicht ab
    // Das Limit gilt nur dem Review (Issue #1080), die Planstufe davor behaelt ihres.
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "6000", NIGHT_TIMEOUT_STUFE: "review" });
    assert.equal(res.status, 0, res.stderr);

    const { einheit, id, text } = plan(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /Zeitbudget review: die Session wurde nach [\d.]+ min am Limit beendet/);
    assert.equal(anker(text), 1, "genau ein Vermerk am Plan");
    assert.match(text, new RegExp(`^${REVIEW_REST_ANKER}$`, "m"), "der Anker steht auf einer eigenen Zeile");
    assert.ok(text.includes(`/issue-review #${id}`), "der Weg nach vorn nennt den Plan");
    assert.match(text, /Zeitbudget review/, "der Grund des Abbruchs steht im Vermerk");
    assert.ok(!/^[ \t]*Plan-Review:[ \t]*\S/m.test(text), "der Body traegt weiterhin keinen Marker");
    assert.match(res.stdout, new RegExp(`Vermerk .*an Plan #${id}`));
  });
});
