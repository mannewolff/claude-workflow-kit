// Ein offener Vertrag im Plan und die Korrekturrunde der Nacht-Kette (Issue #1613, Plan #1611 E5).
//
// Gate P14 verlangt fuer jeden offenen Vertrag eine Frage unter `## Offene Fragen`. Vergisst die
// Planungssitzung sie, meldet `formSicherstellen` P14, die Korrekturrunde schreibt die Frage, und
// `stoppFragenGrund` haelt die Planstufe an — kein neuer Haltepunkt. Damit die Korrektursitzung
// das darf, nennt ihr Auftrag die Frage ausdruecklich als erlaubten Inhalt und verbietet eine
// Zeile `Entschieden:`, die den Verstoss durch eine erfundene Entscheidung tilgte.
//
// Die Formpruefung ist hier eine Attrappe nach dem Muster von `formNachAbschnitten`: Was P14
// genau prueft, belegt test/board-vertraege-form.test.mjs; hier zaehlt, was die Kette tut.

import { test } from "node:test";
import assert from "node:assert/strict";
import { korrekturPrompt } from "../kit/night/kette.mjs";
import {
  ketteImProzess, fachplanKarte, formReparieren, jeStufe, planAnlegen, planBody, reviewMarker, paketeAnlegen,
} from "./helpers/kette-fixture.mjs";

/** Der Satz aus E5, den der Auftrag jeder Korrektursession traegt. */
const SATZ_E5 = "Verlangt eine Formmeldung eine Frage unter `## Offene Fragen`, schreibst du sie dorthin; eine Zeile `Entschieden:` schreibst du nie.";

const VERTRAG = [
  "### Verträge",
  "- V1: Die Laufkennung heißt `Run-ID:` — kanban-kit, liest",
  "  Gebauter Stand: kanban-kit@0123456789ab, src/lauf.ts:12",
  "  Abgleich: weicht ab",
].join("\n");

const VERTRAGSFRAGE = "- V1: Die Laufkennung heißt im gebauten kanban-kit anders — Plan anpassen, kanban-kit nachziehen oder Abweichung annehmen?";

/** Ein Plan mit dem offenen Vertrag V1 am Ende der Entscheidungen. */
const planMitVertrag = (offeneFragen) => planBody({ offeneFragen })
  .replace("Rueckbau: trivial.\n", `Rueckbau: trivial.\n\n${VERTRAG}\n`);

/** P14 als Attrappe: ein offener Vertrag ohne `Entschieden:` braucht eine Frage, die V1 nennt. */
function formMitP14(karte) {
  if (!/^\[Plan\]/.test(karte.title)) return { ok: true, verstoesse: [], hinweise: [] };
  const offen = /^ {2}Abgleich: weicht ab$/m.test(karte.body) && !/^ {2}Entschieden:/m.test(karte.body);
  const fragen = karte.body.split("## Offene Fragen")[1] ?? "";
  if (!offen || /^- V1\b/m.test(fragen)) return { ok: true, verstoesse: [], hinweise: [] };
  const meldung = "Offene Verträge ohne Zeile `Entschieden:`: V1. Unter „## Offene Fragen“ steht eine Frage an den Menschen, die V1 aufzählt.";
  return { ok: false, verstoesse: [{ gate: "P14", meldung }], hinweise: [] };
}

test("[1613] ein offener Vertrag ohne Frage: die Korrekturrunde schreibt sie, die Planstufe haelt an, /issues startet nicht", async () => {
  const auftraege = [];
  const reparieren = formReparieren(planMitVertrag(VERTRAGSFRAGE));
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    formPruefung: formMitP14,
    sitzung: jeStufe({
      plan: planAnlegen(planMitVertrag("- Keine.")),
      form: (s) => { auftraege.push(s.prompt); reparieren(s); },
      review: reviewMarker,
      pakete: paketeAnlegen,
    }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.equal(auftraege.length, 1, "genau eine Korrekturrunde");
  assert.match(auftraege[0], /^- P14: Offene Verträge/m, "der Auftrag nennt den P14-Verstoss");
  assert.ok(auftraege[0].includes(SATZ_E5), "der Auftrag erlaubt die Frage unter ## Offene Fragen");

  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "angehalten", einheit.grund);
  assert.match(einheit.grund, /Stopp-Frage im Plan #2\b/);
  assert.equal(einheit.stufen.plan.korrekturrunden, 1);
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "form"], "weder Review noch /issues nach dem Halt");
  assert.ok(!r.sitzungen.some((s) => /^\/issues #/.test(s.prompt)), "/issues startet nicht");

  const kommentare = r.karte("1").comments.map((c) => c.body).join("\n");
  assert.match(kommentare, /## Kette angehalten/);
  assert.ok(kommentare.includes("V1: Die Laufkennung heißt im gebauten kanban-kit anders"), "der Halt traegt die Vertragsfrage");
  assert.doesNotMatch(r.karte("2").body, /^ {2}Entschieden:/m, "keine erfundene Entscheidung im Plan");
});

test("[1613] der Korrekturauftrag verbietet das Schreiben einer Zeile Entschieden:", () => {
  const p = korrekturPrompt("0002", [{ gate: "P14", meldung: "Offene Verträge ohne Zeile `Entschieden:`: V1." }]);
  assert.ok(p.includes(SATZ_E5), p);
  assert.match(p, /eine Zeile `Entschieden:` schreibst du nie\./);
  assert.match(p, /Aendere sonst nichts/, "das Verbot sonstigen Inhalts bleibt");
});
