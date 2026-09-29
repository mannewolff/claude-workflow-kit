// Akzeptanzkriterium 5 der fachlichen Anforderung #899: Eine Karte, die der Prueflauf
// als geprueft hinterlaesst, erfuellt die Aufnahmevoraussetzung der Nacht-Kette — an der
// Pruefung ist nichts nachzuholen.
//
// Geprueft wird ueber `waehleKettenKandidaten`, nicht ueber `kettenAusschluss`: Die ist
// nicht exportiert, und die Kette waehlt ohnehin ueber die exportierte Funktion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waehleKettenKandidaten, REVIEW_FERTIG_LABEL, KLAEREN_LABEL } from "../kit/night.mjs";

const KETTENLABEL = "kit:night";

/** Eine Karte, wie der Prueflauf sie nach einem Ausgang "geprueft und bereit" hinterlaesst. */
const geprueft = (id = "1") => ({
  id,
  title: "[Fachlich] Eine gepruefte Anforderung",
  status: "backlog",
  labels: [KETTENLABEL, REVIEW_FERTIG_LABEL],
  body: "## Ziel\nEtwas.\n\nAutor-Modell: claude-opus-5\nFachplan-Review: fable, gpt-astra (2026-09-24)\n",
});

test("[night-906] eine vom Prueflauf geprueft hinterlassene Karte ist Kandidat der Nacht-Kette", () => {
  const r = waehleKettenKandidaten([geprueft()], KETTENLABEL, 3);
  assert.deepEqual(r.uebersprungen, [], "es bleibt nichts nachzuholen");
  assert.deepEqual(r.kandidaten.map((a) => String(a.karte.id)), ["1"]);
  assert.equal(r.kandidaten[0].art, "fachplan");
  assert.equal(r.kandidaten[0].F, "1", "die Anforderung ist ihre eigene fachliche Wurzel");
});

test("[night-906] ohne das Pruef-Label bliebe dieselbe Karte uebersprungen", () => {
  const ungeprueft = { ...geprueft(), labels: [KETTENLABEL] };
  const r = waehleKettenKandidaten([ungeprueft], KETTENLABEL, 3);
  assert.deepEqual(r.kandidaten, []);
  assert.equal(r.uebersprungen.length, 1);
});

test("[night-906] eine Karte mit wartender Entscheidung bleibt uebersprungen", () => {
  const wartend = { ...geprueft(), labels: [KETTENLABEL, REVIEW_FERTIG_LABEL, KLAEREN_LABEL] };
  const r = waehleKettenKandidaten([wartend], KETTENLABEL, 3);
  assert.deepEqual(r.kandidaten, []);
  assert.match(r.uebersprungen[0].grund, new RegExp(KLAEREN_LABEL));
});
