// Der gekennzeichnete Plan als Auftrag der Nacht-Kette (Fachplan #883, Plan #890; Issue #895).
//
// Mit Issue #893 konnte der Runner einen startbereiten Plan nur erkennen. Hier nimmt er
// ihn an: Die Kette ueberspringt die Stufen `plan` und `review`, uebernimmt das
// vorhandene Dokument und faehrt von `pakete` an weiter. Kein zweiter Plan entsteht,
// kein aelterer wird als ueberholt vermerkt.
//
// Die Kollisionen zwischen Auftragsarten stehen in `night-kette-kollision.test.mjs`.
//
// Seit Issue #1233 laufen die Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6).
// Variante B, die die Stufe umsetzung faehrt, steht in `ablauf-night-kette-planauftrag.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, planKarte, GLATT, KETTE_LABEL } from "./helpers/kette-fixture.mjs";

/**
 * Die Wurzel ohne Kennzeichen und der gekennzeichnete, gepruefte Plan zu ihr. Die Sessions
 * spielen alle erzeugenden Stufen (`GLATT`), auch `plan` und `review`: Liefe eine von ihnen
 * doch, stuende sie in `sitzungen` — die Zusicherung waere sonst blind.
 */
const wurzelUndPlan = ({ wurzelLabels = [REVIEW_FERTIG_LABEL], planLabels = [KETTE_LABEL, REVIEW_FERTIG_LABEL] } = {}) => [
  fachplanKarte("1", { titel: "[Fachlich] Die Wurzel", labels: wurzelLabels }),
  planKarte("2", "1", { labels: planLabels }),
];

/** Kein Kommentar `Ueberholt durch Plan #` an irgendeiner Karte des Boards. */
function keinUeberholtKommentar(r) {
  for (const i of r.karten) {
    const text = [i.body, ...(i.comments ?? []).map((c) => c.body)].join("\n");
    assert.ok(!text.includes("Ueberholt durch Plan #"), `#${i.id} traegt einen Ueberholt-Kommentar`);
  }
}

test("[night-895] ein gekennzeichneter, gepruefter Plan laeuft als Auftrag: nur pakete und abdeckung", async () => {
  const r = await ketteImProzess({ karten: wurzelUndPlan(), sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const F = "1";
  const M = "2";

  // Das Kennzeichen ist am Plan verbraucht — dort hat der Mensch es gesetzt.
  assert.ok(!r.karte(M).labels.includes("kit:night"), "das Label muss am Plan abgenommen sein");

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["pakete", "abdeckung"],
    "plan und review duerfen bei einem Plan-Auftrag nicht laufen");

  // Kein zweites Plandokument, kein Ueberholt-Vermerk.
  const plaene = r.karten.filter((i) => /^\[Plan\]/.test(i.title));
  assert.deepEqual(plaene.map((i) => String(i.id)), [M], "es entstand ein zweites [Plan]-Dokument");
  keinUeberholtKommentar(r);

  const einheit = r.lauf.einheiten.find((e) => e.id === M);
  assert.ok(einheit, "die Einheit traegt die Nummer der gekennzeichneten Karte");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.auftrag, "plan");
  assert.equal(einheit.fachplan, F);
  assert.equal(einheit.stufen.plan.id, M, "der uebernommene Plan steht im Stand der Stufe plan");
  assert.equal(einheit.stufen.plan.uebernommen, true);
  assert.equal(einheit.stufen.plan.dauerMs, 0, "eine uebernommene Stufe kostet keine Zeit");
  assert.equal("review" in einheit.stufen, false, "die Review-Stufe darf keinen Stand hinterlassen");
  assert.deepEqual(einheit.stufen.pakete.ids, ["3", "4"]);
  assert.equal(einheit.kostenUsd, 2, "zwei Sessions zu je 1 $");

  // Die Abdeckung haelt die Pakete gegen die fachliche Anforderung, nicht gegen den Plan.
  const prompt = r.sitzungen.find((s) => s.stufe === "abdeckung").prompt;
  assert.match(prompt, new RegExp(`den Fachplan #${F}\\b`));
  assert.match(prompt, new RegExp(`den Plan #${M}\\b`));
  assert.match(prompt, /#3, #4/);

  assert.match(r.ausgabe, new RegExp(`Kette 1/\\d+: Plan #${M} \\(fachliche Quelle #${F}\\) — \\[Plan\\]`));

  // Der Nachtbericht steht an der gekennzeichneten Karte, und die uebernommene Stufe
  // wird nicht abgerechnet (Issue #896).
  assert.equal(einheit.bericht, "veroeffentlicht");
  assert.match(r.ausgabe, new RegExp(`Nachtbericht als Kommentar an #${M} veroeffentlicht`));
  const bericht = r.karte(M).comments.map((c) => c.body).join("\n");
  assert.match(bericht, new RegExp(`### Stufen\\n\\n- Auftrag: Plan #${M} \\(fachliche Quelle #${F}\\)\\n- Variante: A\\n`));
  assert.match(bericht, /als Auftrag uebernommen, nicht neu geschrieben, Pruefer keiner\./);
  assert.doesNotMatch(bericht, /Dauer 0\.0 min/, "die uebernommene Stufe behauptet eine Messung");
  assert.ok(!r.karte(F).comments.some((c) => c.body.includes("## Nachtbericht, Kette")),
    "der Bericht gehoert an die gekennzeichnete Karte, nicht an die Wurzel");
});

test("[night-895] das Durchziehen-Label an der fachlichen Anforderung bleibt wirkungslos", async () => {
  // Wie `durchziehen()` der Ablauf-Pruefungen: das Label an der Karte, der Uebergang freigegeben.
  const r = await ketteImProzess({
    karten: wurzelUndPlan({ wurzelLabels: [REVIEW_FERTIG_LABEL, "kit:durchziehen"] }),
    kette: { uebergaenge: { abdeckungUmsetzung: true } },
    sitzung: GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["pakete", "abdeckung"],
    "die Umsetzungsstufe lief, obwohl der Plan das Kennzeichen nicht traegt");
  const einheit = r.lauf.einheiten.find((e) => e.id === "2");
  assert.equal(einheit.variante, "A");
  const backlog = new Set(r.karten.filter((i) => i.status === "backlog").map((i) => String(i.id)));
  for (const id of einheit.stufen.pakete.ids) assert.ok(backlog.has(id), `Paket #${id} liegt nicht in Backlog`);
});

test("[night-895] --kette --dry-run nennt den Plan-Auftrag mit fachlicher Quelle und Variante", async () => {
  const karten = wurzelUndPlan();
  const vorher = structuredClone(karten);
  const r = await ketteImProzess({ karten, argv: ["--dry-run"], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.match(r.ausgabe, /#2 \[Plan\] Ein fertiger Weg -> Kette 1 \(Plan-Auftrag, fachliche Quelle #1, Variante A\)/);
  assert.deepEqual(r.karten.map(({ id, title, body, status, labels }) => ({ id, title, body, status, labels })), vorher,
    "der Dry-Run hat am Board etwas veraendert");
  assert.deepEqual(r.karten.flatMap((k) => k.comments ?? []), [], "der Dry-Run hat am Board kommentiert");
});
