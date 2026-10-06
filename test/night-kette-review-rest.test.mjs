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
  run, mitProjekt, fachplan, umgebung, stand, sessions, board, PLAN_ANLEGEN, PAKETE_ANLEGEN, REVIEW_MARKER, EREIGNIS,
} from "./helpers/kette-fixture.mjs";
import { REVIEW_REST_ANKER } from "../kit/night/kette.mjs";
import { WARTEND_ANKER } from "../kit/night/wartend.mjs";

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
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: BEFUNDE + "; sleep 60" } });
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

test("[night-19] bricht die Review-Stufe ohne neuen Kommentar ab, bleibt der Plan ohne Vermerk", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: `${EREIGNIS}; exit 3` } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    const { einheit, text } = plan(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /technischer Fehler: die Session der Stufe review endete mit Exit 3/);
    assert.equal(anker(text), 0, "ohne Befunde gibt es nichts zu retten");
    assert.doesNotMatch(res.stdout, new RegExp(REVIEW_REST_ANKER));
  });
});

test("[night-19] traegt der Plan beim Abbruch schon den Marker, bleibt er ohne Vermerk", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    // Die Review-Session hat den Marker gesetzt: Die Einarbeitung war durch, der Abbruch
    // traf sie danach. Seit Issue #1086 (Plan #1079 E9) ist der Marker das Ergebnis der
    // Stufe — sie gilt als fertig, und die Kette laeuft weiter.
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: `${REVIEW_MARKER}; ${BEFUNDE}; ${EREIGNIS}; exit 3`, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    const { einheit, text } = plan(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.review.vorgefunden, true);
    assert.match(res.stdout, /Stufe review: abgebrochen \(technischer Fehler: die Session der Stufe review endete mit Exit 3\), das Ergebnis liegt aber vor/);
    assert.ok(/^[ \t]*Plan-Review:[ \t]*\S/m.test(text), "der Marker steht im Body");
    assert.equal(anker(text), 0, "mit Marker ist die Einarbeitung durch");
    assert.doesNotMatch(res.stdout, new RegExp(REVIEW_REST_ANKER));
  });
});

// Ein Schlusstext, der nach Warten klingt, und ein Ergebnis, das vorliegt (Issue #1207).
//
// Der Lauf 2026-10-05-121520 hielt die Kette in der Stufe review an, obwohl die Session
// fertig war: Der Marker stand neu im Plan, nur der Schlusstext beschrieb ein "Warten auf
// eine Bedingung". Das Ergebnis ist ein Beleg, der Schlusstext nur ein Indiz.

/** Ein Schlusstext, der die Musterliste trifft ("laeuft noch"). */
const WARTE_TEXT = "Das Review ist eingearbeitet, die Formpruefung laeuft noch im Hintergrund.";

test("[night-57] eine Review-Session, die den Marker neu setzt, laeuft trotz wartendem Schlusstext in die Stufe pakete", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, review: `${REVIEW_MARKER}; KETTE_RESULT_TEXT="${WARTE_TEXT}"`, pakete: PAKETE_ANLEGEN },
    });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    const { einheit, text } = plan(dir, F);
    assert.ok(sessions(env.logPfad).map((s) => s.stufe).includes("pakete"), `die Kette lief nicht in die Stufe pakete: ${JSON.stringify(einheit)}`);
    assert.ok(!("wartendBeendet" in einheit), `das Feld steht da, obwohl das Ergebnis vorliegt: ${JSON.stringify(einheit)}`);
    assert.ok(!text.includes(WARTEND_ANKER), `trotz Ergebnis ein Vermerk am Plan:\n${text}`);
    assert.ok(!board(dir, "issue", "get", F).body.includes(WARTEND_ANKER), "trotz Ergebnis ein Vermerk am Fachplan");
    assert.match(res.stdout, /Stufe review: Schlusstext klang nach Warten, das Ergebnis liegt aber vor/);
  });
});

test("[night-57] eine Review-Session ohne neuen Marker bricht mit wartendem Schlusstext weiter ab", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, review: `KETTE_RESULT_TEXT="${WARTE_TEXT}"`, pakete: PAKETE_ANLEGEN },
    });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    const { einheit, text } = plan(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /selbst angestossene Arbeit gewartet/);
    assert.equal(einheit.wartendBeendet, true);
    assert.ok(!sessions(env.logPfad).map((s) => s.stufe).includes("pakete"), "die Kette lief trotz wartender Sitzung weiter");
    assert.ok(text.includes(WARTEND_ANKER), `der Vermerk fehlt am Plan:\n${text}`);
  });
});
