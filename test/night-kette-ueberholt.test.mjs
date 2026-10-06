// Ueberholte Plaene (Plan #638, A8; Issue #644).
//
// Eine zweite Kette zum selben Fachplan beginnt von vorn. Der aeltere Plan bekommt den
// Kommentar "Ueberholt durch Plan #M2", kein Label, keinen Move; ein Plan zu einem
// anderen Fachplan bleibt unberuehrt.
//
// Von vorn beginnt sie nur, wenn der Mensch den alten Plan geschlossen hat: Ein Plan in
// Backlog, Ready oder In review ist das vorgefundene Ergebnis der Stufe plan (Issue
// #1086, Plan #1079 E9) und bekommt keinen Nachfolger.
//
// Seit Issue #1233 laufen diese Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6):
// Die zweite Kette startet auf einer Kopie der Karten, die die erste hinterliess. Ablauf-
// Pruefungen gibt es hier keine; der glatte Lauf als Prozess steht in
// `ablauf-night-kette-ablauf.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ketteImProzess, fachplanKarte, GLATT } from "./helpers/kette-fixture.mjs";
import { REVIEW_FERTIG_LABEL, UEBERHOLT_UNBESTAETIGT_GRUND as UNBESTAETIGT_GRUND } from "../kit/night/kette.mjs";

const RESULT_TEXT = "Alle Kriterien sind abgebildet.";

/** Die Sessions einer glatten Kette, jede mit dem Schlusstext. */
const SITZUNG = (s) => ({ ...GLATT(s), ergebnis: RESULT_TEXT });

/** Body und Kommentare einer Karte als ein Text, wie die Datei des lokalen Trackers. */
const kartenText = (r, id) => [r.karte(id).body, ...r.karte(id).comments.map((c) => c.body)].join("\n\n");

/** Die Plaene am Board. */
const plaene = (r) => r.karten.filter((k) => /^\[Plan\]/.test(k.title)).map((k) => k.id);

/**
 * Der Ueberholt-Kommentar an `id`, den das Board annimmt, ohne ihn zu speichern — wie am
 * 2026-09-14 an Plan #577 (Issue #653).
 */
const ueberholtKommentarAn = (id) => (args) => args[0] === "issue" && args[1] === "comment" && String(args[2]) === id
  && /^Ueberholt durch/.test(args[args.indexOf("--text") + 1] ?? "");

/** Die erste Kette zum Fachplan: legt den aelteren Plan an und liefert ihn mit dem Lauf. */
async function ersteKette(karten = [fachplanKarte("1")]) {
  const r = await ketteImProzess({ karten, sitzung: SITZUNG });
  assert.equal(r.code, 0, r.ausgabe);
  const alt = plaene(r);
  assert.equal(alt.length, 1, "die erste Kette hinterlaesst genau einen Plan");
  return { r, alt: alt[0] };
}

/**
 * Die zweite Kette zum selben Fachplan: Der Mensch schliesst den alten Plan, damit ein
 * frischer entsteht (E9), und setzt das Label neu.
 */
async function zweiteKette(vorher, alt, { schlucken } = {}) {
  const karten = structuredClone(vorher.karten);
  karten.find((k) => k.id === alt).status = "done";
  karten.find((k) => k.id === "1").labels.push("kit:night");
  const r = await ketteImProzess({ karten, sitzung: SITZUNG, schlucken });
  assert.equal(r.code, 0, r.ausgabe);
  return { r, einheit: r.lauf.einheiten.find((e) => e.id === "1"), text: kartenText(r, "1") };
}

test("[night-20] die zweite Kette kommentiert den aelteren Plan als ueberholt, den fremden nicht", async () => {
  const anderer = fachplanKarte("2", { titel: "[Fachlich] Ein anderes Anliegen", labels: [REVIEW_FERTIG_LABEL] });
  const { r: erster } = await ersteKette([fachplanKarte("1"), anderer]);
  assert.deepEqual(plaene(erster), ["3"]);
  // Ein Plan zu einem anderen Fachplan, wie ihn eine andere Kette hinterliesse.
  const fremd = {
    id: "99", title: "[Plan] Fremder Weg", status: "backlog", labels: [], comments: [],
    body: "Plan-Modell: x\nFachliche Quelle: Issue #2\n\n## Ziel\n\nx\n\n## Betroffene Bereiche\n\n- y\n\n## Architektonische Entscheidungen\n\n- Keine.\n\n## Geplante Änderungen\n\n- z\n\n## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- w\n",
  };
  erster.karten.push(fremd);

  // Die zweite Kette: der Mensch schliesst den alten Plan (E9) und setzt das Label neu.
  const { r: zweiter, einheit } = await zweiteKette(erster, "3");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.deepEqual(einheit.ueberholt, ["3"]);
  const neuerPlan = einheit.stufen.plan.id;
  assert.notEqual(neuerPlan, "3");
  assert.match(kartenText(zweiter, "3"), new RegExp(`Ueberholt durch Plan #${neuerPlan} \\(Kette `));
  assert.equal(zweiter.karte("3").status, "done", "der alte Plan wird nicht bewegt");
  assert.doesNotMatch(kartenText(zweiter, "99"), /Ueberholt/, "ein Plan zu einem anderen Fachplan bleibt unberuehrt");
  assert.match(zweiter.ausgabe, new RegExp(`Plan #3 als ueberholt kommentiert \\(neuer Plan #${neuerPlan}\\)`));
});

test("[night-20] ohne aelteren Plan traegt die Einheit kein Feld ueberholt", async () => {
  const { r } = await ersteKette();
  assert.equal("ueberholt" in r.lauf.einheiten.find((e) => e.id === "1"), false);
});

test("[night-20] ist der Ueberholt-Kommentar nach dem Schreiben auffindbar, steht der Plan im Bericht unter Ueberholt", async () => {
  const { r: erster, alt } = await ersteKette();
  const { r, einheit, text } = await zweiteKette(erster, alt);

  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.deepEqual(einheit.ueberholt, [alt]);
  assert.equal("ueberholtUnbestaetigt" in einheit, false);
  assert.ok(text.includes(`### Ueberholt\n\n- Plan #${alt}\n`), "der bestaetigte Plan steht unter Ueberholt");
  assert.ok(!text.includes("### Ueberholt, nicht bestaetigt"), "ohne unbestaetigten Kommentar entfaellt der Abschnitt");
  assert.match(r.ausgabe, new RegExp(`Plan #${alt} als ueberholt kommentiert \\(neuer Plan #${einheit.stufen.plan.id}\\)`));
});

test("[night-20] ist der Ueberholt-Kommentar nicht auffindbar, steht der Plan getrennt im Bericht und der Lauf laeuft weiter", async () => {
  const { r: erster, alt } = await ersteKette();
  // Ab hier nimmt das Board den Kommentar an den alten Plan an, ohne ihn zu speichern.
  const { r, einheit, text } = await zweiteKette(erster, alt, { schlucken: ueberholtKommentarAn(alt) });

  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal("ueberholt" in einheit, false, "ohne Zustellnachweis gilt kein Plan als ueberholt");
  assert.deepEqual(einheit.ueberholtUnbestaetigt, [{ id: alt, grund: UNBESTAETIGT_GRUND }]);
  assert.ok(!text.includes("### Ueberholt\n"), "der unbestaetigte Plan steht nicht unter Ueberholt");
  assert.ok(text.includes(`### Ueberholt, nicht bestaetigt\n\n- Plan #${alt} — ${UNBESTAETIGT_GRUND}\n`));
  assert.match(r.ausgabe, new RegExp(`Plan #${alt}: der Ueberholt-Kommentar ist am Board nicht auffindbar`));
  assert.doesNotMatch(r.ausgabe, new RegExp(`Plan #${alt} als ueberholt kommentiert`));
});
