// Stufe Abdeckung der Nacht-Kette (Plan #638, A9; Issue #644).
//
// Eine lesende Session haelt die Pakete gegen den Fachplan; ihr Text kommt aus dem
// result-Ereignis in den Ergebnisstand. Zeitbudget oder fehlender Text lassen die Kette
// trotzdem fertig enden — die Abdeckung ist eine Auskunft, kein Tor. Schreibt die Session
// doch am Board, steht das als abdeckungSchrieb in der Einheit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { abdeckungPrompt, ABDECKUNG_PROMPT, leseErgebnisText } from "../kit/night.mjs";
import {
  NUR_POSIX, run, mitProjekt, fachplan, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, ABDECKUNG_SCHREIBT,
} from "./helpers/kette-fixture.mjs";

const RESULT_TEXT = "### Zuordnung 1 -> #0003. ### Ohne Paket Alle Kriterien sind abgebildet. ### Zuwachs Nichts Zusaetzliches.";

test("[night-20] der Text der Abdeckungs-Session steht in der Einheit", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.abdeckung.text, RESULT_TEXT);
    assert.equal("grund" in einheit.stufen.abdeckung, false);
    assert.equal("abdeckungSchrieb" in einheit, false);
    assert.equal(einheit.kostenUsd, 4, "vier Sessions zu je 1 $");
    assert.match(res.stdout, /Stufe abdeckung: Pakete gegen Fachplan #0001/);
  });
});

test("[night-20] schreibt die Abdeckungs-Session am Fachplan, steht abdeckungSchrieb in der Einheit — die Kette bleibt fertig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, abdeckung: ABDECKUNG_SCHREIBT } });
    const res = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig");
    assert.equal(einheit.abdeckungSchrieb, true);
    assert.match(res.stdout, /die Abdeckungs-Session hat am Board geschrieben/);
  });
});

test("[night-20] ohne Text bleibt die Abdeckung null mit Grund, die Kette endet fertig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig");
    assert.equal(einheit.stufen.abdeckung.text, null);
    assert.match(einheit.stufen.abdeckung.grund, /lieferte keinen Text/);
  });
});

test("[night-20] reisst die Abdeckungs-Session ihr Zeitbudget, endet die Kette trotzdem fertig, der Grund steht an der Stufe", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, abdeckung: "sleep 5" } });
    // NIGHT_TIMEOUT_MS gilt jeder Session; die drei davor sind schnell genug.
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "1500" });
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.abdeckung.text, null);
    assert.match(einheit.stufen.abdeckung.grund, /Zeitbudget abdeckung/);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
  });
});

test("[night-20] abdeckungPrompt nennt Fachplan, Plan und Pakete, verbietet Schreiben und verlangt die drei Abschnitte", () => {
  const p = abdeckungPrompt("0001", "0002", ["0003", "0004"]);
  assert.match(p, /den Fachplan #0001, den Plan #0002 und die Pakete #0003, #0004/);
  assert.ok(p.includes(ABDECKUNG_PROMPT));
  for (const teil of ["Aendere dabei NICHTS", "### Zuordnung", "### Ohne Paket", "### Zuwachs", "Dieser Lauf ist unbeaufsichtigt"]) {
    assert.ok(p.includes(teil), `${teil} fehlt im Prompt`);
  }
});

test("[night-20] leseErgebnisText liest das result-Feld des letzten result-Ereignisses", () => {
  const stdout = 'x\n{"type":"assistant","text":"a"}\n{"type":"result","result":"erster"}\nkein json\n{"type":"result","result":"  zweiter  ","total_cost_usd":1}\n';
  assert.equal(leseErgebnisText(stdout), "zweiter");
  assert.equal(leseErgebnisText('{"type":"result","result":""}'), null);
  assert.equal(leseErgebnisText('{"type":"result"}'), null);
  assert.equal(leseErgebnisText(""), null);
  assert.equal(leseErgebnisText(undefined), null);
});
