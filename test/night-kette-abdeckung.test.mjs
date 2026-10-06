// Stufe Abdeckung der Nacht-Kette (Plan #638, A9; Issue #644).
//
// Eine lesende Session haelt die Pakete gegen den Fachplan; ihr Text kommt aus dem
// result-Ereignis in den Ergebnisstand. Zeitbudget oder fehlender Text lassen die Kette
// trotzdem fertig enden — die Abdeckung ist eine Auskunft, kein Tor. Schreibt die Session
// doch am Board, steht das als abdeckungSchrieb in der Einheit.
//
// Seit Issue #1233 laufen diese Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6).
// Das Zeitbudget einer haengenden Abdeckungs-Session braucht die echte Uhr und steht in
// `ablauf-night-kette-abdeckung.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { abdeckungPrompt, ABDECKUNG_PROMPT, ABDECKUNG_ZUSATZ, KETTE_ZUSATZ } from "../kit/night/kette.mjs";
import { leseErgebnisText } from "../kit/night/session.mjs";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, reviewMarker, paketeAnlegen, abdeckungSchreibt,
} from "./helpers/kette-fixture.mjs";

const RESULT_TEXT = "### Zuordnung 1 -> #0003. ### Ohne Paket Alle Kriterien sind abgebildet. ### Zuwachs Nichts Zusaetzliches.";

/** Jede Session liefert den Schlusstext, wie KETTE_RESULT_TEXT im Prozess. */
const mitText = (stufen) => (s) => ({ ...stufen(s), ergebnis: RESULT_TEXT });

test("[night-20] der Text der Abdeckungs-Session steht in der Einheit", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: mitText(jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen })),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.abdeckung.text, RESULT_TEXT);
  assert.equal("grund" in einheit.stufen.abdeckung, false);
  assert.equal("abdeckungSchrieb" in einheit, false);
  assert.equal(einheit.kostenUsd, 4, "vier Sessions zu je 1 $");
  assert.match(r.ausgabe, /Stufe abdeckung: Pakete gegen Fachplan #1/);
});

test("[night-20] schreibt die Abdeckungs-Session am Fachplan, steht abdeckungSchrieb in der Einheit — die Kette bleibt fertig", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: mitText(jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen, abdeckung: abdeckungSchreibt })),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig");
  assert.equal(einheit.abdeckungSchrieb, true);
  assert.match(r.ausgabe, /die Abdeckungs-Session hat am Board geschrieben/);
});

test("[night-20] ohne Text bleibt die Abdeckung null mit Grund, die Kette endet fertig", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig");
  assert.equal(einheit.stufen.abdeckung.text, null);
  assert.match(einheit.stufen.abdeckung.grund, /lieferte keinen Text/);
});

test("[night-20] abdeckungPrompt nennt Fachplan, Plan und Pakete, verbietet Schreiben und verlangt die drei Abschnitte", () => {
  const p = abdeckungPrompt("0001", "0002", ["0003", "0004"]);
  assert.match(p, /den Fachplan #0001, den Plan #0002 und die Pakete #0003, #0004/);
  assert.ok(p.includes(ABDECKUNG_PROMPT));
  for (const teil of ["Aendere dabei NICHTS", "### Zuordnung", "### Ohne Paket", "### Zuwachs"]) {
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

test("[night-20] die Abdeckungs-Session bekommt keinen Auftrag, ans Board zu schreiben — Plan, Review und Pakete tragen KETTE_ZUSATZ unveraendert", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: mitText(jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen })),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const promptVon = (stufe) => r.sitzungen.find((s) => s.stufe === stufe).prompt;
  for (const stufe of ["plan", "review", "pakete"]) {
    const prompt = promptVon(stufe);
    assert.ok(prompt.includes(KETTE_ZUSATZ), `KETTE_ZUSATZ fehlt an Stufe ${stufe}:\n${prompt}`);
  }
  const prompt = promptVon("abdeckung");
  assert.ok(!prompt.includes("Schreibe dein Ergebnis ans Board"), prompt);
  assert.doesNotMatch(prompt, /ans Board/);
  assert.ok(prompt.includes(ABDECKUNG_ZUSATZ), prompt);
  assert.match(prompt, /Beende deine Arbeit nicht, solange eine von dir angestossene lange Arbeit laeuft/);
  assert.match(prompt, /Warte auf ihr Ergebnis oder brich sie ab/);
});
