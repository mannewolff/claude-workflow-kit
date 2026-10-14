// Die Nacht-Kette liest die Wartezeile `Wartet auf Ereignis:` (Fachplan #1619, Plan #1624,
// E5, E6, E8, E11, E12; Issue #1663).
//
// Ein wartender Fachplan wird kein Fachplan-Auftrag, und ein schon entstandener Plan zu ihm
// wird kein Plan-Auftrag. Beide laufen ueber den bestehenden Weg der Uebersprunge (E8): Grund
// in `uebersprungen`, Einheit `uebersprungen` im Ergebnisstand, dieselbe Zeile im Dry-Run.
// Die Fixtures schreiben die Wartezeile direkt in den Body; die Kette liest nur die Zeile.

import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_FERTIG_LABEL, istUngeprueftGrund, planAusschluss, waehleKettenKandidaten } from "../kit/night/kette.mjs";
import { KLAEREN_LABEL } from "../kit/night/wartend.mjs";
import { mitEreignis, ohneEreignis } from "../kit/board/ereignis.mjs";
import { ketteImProzess, fachplanKarte, fachplanBody, planKarte, KETTE_LABEL } from "./helpers/kette-fixture.mjs";

const GRUND = "wartet, bis der Tarif X für das Projekt wählbar ist";
const GEPRUEFT = [KETTE_LABEL, REVIEW_FERTIG_LABEL];
// Der Punkt im Dateinamen steht maskiert: Die Verflechtungserhebung zaehlt jede woertliche
// Nennung eines Quellpfads als Laden, und die Datei laedt den Board-Einstieg nicht.
const LIFT = (n) => `aufheben mit \`node .claude/kit/board\x2emjs issue hold ${n} --lift\``;
const KETTE_GRUND = (n) => `wartet auf ein Ereignis: ${GRUND} — ${LIFT(n)}`;
const PLAN_GRUND = (f) => `Fachplan #${f} wartet auf ein Ereignis: ${GRUND} — ${LIFT(f)}`;
// Ab Karte 1 traegt jeder Fachplan die Szenarien-Pflicht; die Fixture traegt ein vollstaendiges.
const CONFIG = { szenarienAb: 1 };

const wartend = (body = fachplanBody()) => mitEreignis(body, GRUND, "de");

/** Ein Fachplan, der sonst startbereit ist und auf ein Ereignis wartet. */
const wartenderFachplan = (id = "1", { labels = GEPRUEFT, body = wartend(), status = "backlog" } = {}) =>
  fachplanKarte(id, { labels, body, status });

const waehle = (karten) => waehleKettenKandidaten(karten, KETTE_LABEL, 5, { config: CONFIG });
const grundVon = (r, id) => r.uebersprungen.find((u) => u.id === String(id))?.grund ?? null;

// --- Die Szenarien aus dem Paket ---

test("Szenario: Ein wartender Fachplan wird nachts nicht gebaut", async () => {
  const r = waehle([wartenderFachplan("1")]);
  assert.deepEqual(r.kandidaten, []);
  assert.equal(grundVon(r, "1"), KETTE_GRUND("1"));

  // Bericht und Vorschau: derselbe Grund im Dry-Run und in der Einheit des Ergebnisstands.
  const vorschau = await ketteImProzess({ karten: [wartenderFachplan("1")], argv: ["--dry-run"] });
  assert.equal(vorschau.code, 0, vorschau.ausgabe);
  assert.ok(vorschau.ausgabe.includes(`#1 [Fachlich] Ein Anliegen -> uebersprungen (${KETTE_GRUND("1")})`), vorschau.ausgabe);

  const lauf = await ketteImProzess({ karten: [wartenderFachplan("1")] });
  assert.equal(lauf.code, 0, lauf.ausgabe);
  const einheit = lauf.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "uebersprungen");
  assert.equal(einheit.grund, KETTE_GRUND("1"));
  assert.deepEqual(lauf.sitzungen, [], "fuer einen wartenden Fachplan beginnt keine Sitzung");
  assert.ok(lauf.karte("1").labels.includes(KETTE_LABEL), "das Kennzeichen fuer die Nacht bleibt stehen");
});

test("Szenario: Nach dem Aufheben wird der Fachplan wieder gebaut", () => {
  const vorher = wartenderFachplan("1");
  const nachher = { ...vorher, body: ohneEreignis(vorher.body), labels: [...vorher.labels] };
  const r = waehle([nachher]);
  assert.deepEqual(r.uebersprungen, []);
  assert.deepEqual(r.kandidaten.map((a) => [a.karte.id, a.art]), [["1", "fachplan"]]);
  assert.deepEqual(nachher.labels, GEPRUEFT, "review:done und kit:night bleiben unveraendert");
});

test("Szenario: Ein schon entstandener Plan wartet mit seinem Fachplan", () => {
  const fachplan = wartenderFachplan("1", { labels: [REVIEW_FERTIG_LABEL] });
  const plan = planKarte("2", "1", { labels: GEPRUEFT });
  const r = waehle([fachplan, plan]);
  assert.deepEqual(r.kandidaten, [], "aus dem Plan entstehen keine Arbeitspakete");
  assert.equal(grundVon(r, "2"), PLAN_GRUND("1"));
  assert.equal(planAusschluss(plan, KETTE_LABEL, [fachplan, plan]), PLAN_GRUND("1"));
});

// --- Rangfolge beim Fachplan (E5) ---

test("[night-1663] der Wartegrund gewinnt vor kit:clarify, Pruefung, PO-Fragen und Szenarien", () => {
  const offenePo = wartend(fachplanBody().replace("Keine offenen Fragen.", "- Welcher Tarif gilt?"));
  const ohneSzenario = wartend(fachplanBody().replace(/## Szenarien[\s\S]*?(?=## Nicht-Ziele)/, ""));
  const karten = [
    wartenderFachplan("1", { labels: [...GEPRUEFT, KLAEREN_LABEL] }),
    wartenderFachplan("2", { labels: [KETTE_LABEL] }),
    wartenderFachplan("3", { body: offenePo }),
    wartenderFachplan("4", { body: ohneSzenario }),
  ];
  // Ohne Wartezeile hielte jede Karte ein anderer Grund an — sonst belegte der Test nichts.
  const ohne = waehle(karten.map((k) => ({ ...k, body: ohneEreignis(k.body) })));
  for (const id of ["1", "2", "3", "4"]) assert.doesNotMatch(grundVon(ohne, id), /Ereignis/, `#${id}`);

  const r = waehle(karten);
  for (const id of ["1", "2", "3", "4"]) assert.equal(grundVon(r, id), KETTE_GRUND(id), `#${id}`);
});

test("[night-1663] ausserhalb von Backlog gewinnt weiter die Spalte", () => {
  const r = waehle([wartenderFachplan("1", { status: "ready" })]);
  assert.match(grundVon(r, "1"), /nicht in Backlog/);
});

test("[night-1663] wartend und ungeprueft: kein Grund 'Pruefung fehlt'", () => {
  const grund = grundVon(waehle([wartenderFachplan("1", { labels: [KETTE_LABEL] })]), "1");
  assert.equal(grund, KETTE_GRUND("1"));
  assert.equal(istUngeprueftGrund(grund), false, "sonst entstuende der Kommentar 'Kette nicht gestartet: Pruefung fehlt'");
});

// --- Rangfolge beim Plan (E6) ---

test("[night-1663] beim Plan steht der Wartegrund nach der Spalte und vor kit:clarify", () => {
  const fachplan = wartenderFachplan("1", { labels: [REVIEW_FERTIG_LABEL] });
  const geklaert = planKarte("2", "1", { labels: [...GEPRUEFT, KLAEREN_LABEL] });
  const ungeprueft = planKarte("3", "1", { labels: [KETTE_LABEL] });
  const inReady = planKarte("4", "1", { labels: GEPRUEFT, status: "ready" });
  const karten = [fachplan, geklaert, ungeprueft, inReady];
  assert.equal(planAusschluss(geklaert, KETTE_LABEL, karten), PLAN_GRUND("1"));
  assert.equal(planAusschluss(ungeprueft, KETTE_LABEL, karten), PLAN_GRUND("1"));
  assert.match(planAusschluss(inReady, KETTE_LABEL, karten), /nicht in Backlog/);
});

test("[night-1663] beim Plan steht der Wartegrund nach der Herkunft", () => {
  const fachplan = wartenderFachplan("1", { labels: [REVIEW_FERTIG_LABEL] });
  const body = planKarte("2", "1").body.replace("Fachliche Quelle: Issue #1", "Fachliche Quelle: Issue #1\nFachliche Quelle: Issue #9");
  const plan = { ...planKarte("2", "1", { labels: GEPRUEFT }), body };
  assert.match(planAusschluss(plan, KETTE_LABEL, [fachplan, plan]), /verweist ins Leere/);
});

test("[night-1663] ein Plan ohne Fachliche Quelle bleibt unberuehrt", () => {
  const fachplan = wartenderFachplan("1", { labels: [REVIEW_FERTIG_LABEL] });
  const ohne = { ...planKarte("2", "1", { labels: GEPRUEFT }) };
  ohne.body = ohne.body.replace("Fachliche Quelle: Issue #1\n", "");
  assert.equal(planAusschluss(ohne, KETTE_LABEL, [fachplan, ohne]), null);
});

test("[night-1663] ein Plan zu einem nicht wartenden Fachplan laeuft wie bisher", () => {
  const fachplan = fachplanKarte("1", { labels: [REVIEW_FERTIG_LABEL] });
  const plan = planKarte("2", "1", { labels: GEPRUEFT });
  assert.equal(planAusschluss(plan, KETTE_LABEL, [fachplan, plan]), null);
});
