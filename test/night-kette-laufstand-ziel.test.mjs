// Laufstand der Nacht-Kette mit Ziel, Prueferzahl und Projektgrenze (Plan #1243, E5, E16;
// Issue #1251).
//
// Nach dem Verbrauch der Labels beim Start (#1249) liest das Board das Ziel nur noch im
// Laufstand. Jede Fassung, die die Kette schreibt, traegt darum unter dem Kopf `Ziel:`,
// bei gesetztem `planreview:*` `Prüfer:` und, wenn eine Projektgrenze vor dem Ziel liegt,
// `Grenze:`. Endet die Kette an ihrem Ziel, lautet der Kopf `fertig bis <Ziel>` mit der
// Zeile `Als Nächstes:`. Leicht, Session und Board ueber `ketteImProzess`
// (KETTE_ABHAENGIGKEITEN), ohne feste Pause.

import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, planKarte, planBody, paketBody, jeStufe, vorbereitungAblegen, KETTE_LABEL, GLATT } from "./helpers/kette-fixture.mjs";

const F = "1";
const P = "2";
const fachMit = (...labels) => fachplanKarte(F, { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, ...labels] });

/** Die Texte aller Laufstaende, die die Kette an F schrieb, in Folge — ohne den Vorab-Stand des Laufs. */
const staendeVon = (r) => r.journal.filter((z) => z.art === "stand" && z.karte === F).map((z) => z.text)
  .filter((t) => !t.startsWith("Lauf angenommen"));
const letzterStand = (r) => staendeVon(r).at(-1);

/** Ein geprufter Plan zu F und zwei umgesetzte Pakete, dazu der Laufstand nach der Abdeckung. */
function bisAbdeckungVorhanden(karte) {
  const markiert = planBody().replace("Plan-Modell: fixture-modell", "Plan-Modell: fixture-modell\nPlan-Review: opus (2026-09-28, Nachtlauf)");
  const pakete = ["3", "4"].map((id, i) => ({
    id, title: `Paket ${i + 1}`, status: "in_review", labels: [], body: paketBody(P, F, { n: i + 1, aufgabe: `Paket ${i + 1}.` }),
  }));
  const mitStand = {
    ...karte, labels: [...karte.labels, "lauf:abgebrochen"],
    comments: [{ body: `## Laufstand\n\nzuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z` }],
  };
  return [mitStand, planKarte(P, F, { body: markiert }), ...pakete];
}

const ALS_NAECHSTES = {
  plan: "Als Nächstes: Plan lesen, dann `kit:night` an den Plan.",
  pakete: "Als Nächstes: Pakete nach Ready ziehen.",
  umsetzung: "Als Nächstes: Pakete in In review testen, dann `push main`.",
  "push-vorbereitet": "Als Nächstes: Meldung der Vorbereitung lesen, dann `push main`.",
};

test("E5/E16: ziel:plan mit planreview:2 — jede Fassung traegt Ziel und Prüfer, am Ende fertig bis plan", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:plan", "planreview:2")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const staende = staendeVon(r);
  assert.ok(staende.length >= 3, staende.join("\n---\n"));
  for (const text of staende) assert.match(text, /(?:^|\n)Ziel: plan\nPrüfer: 2(?:\n|$)/, text);
  assert.ok(staende[0].startsWith("Ziel: plan\nPrüfer: 2\n\nzuletzt begonnen: plan begonnen"), staende[0]);
  assert.ok(letzterStand(r).startsWith(`fertig bis plan\n${ALS_NAECHSTES.plan}\n\nZiel: plan\nPrüfer: 2\n\nzuletzt`), letzterStand(r));
  assert.doesNotMatch(staende.join("\n"), /Grenze:/);
  // Der Laufstand am Board ist die letzte Fassung.
  const amBoard = r.karte(F).comments.findLast((c) => c.body.startsWith("## Laufstand")).body;
  assert.match(amBoard, /fertig bis plan/);
});

test("E5: ziel:pakete endet mit fertig bis pakete, ohne planreview:* keine Zeile Prüfer:", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:pakete")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  for (const text of staendeVon(r)) assert.match(text, /(?:^|\n)Ziel: pakete(?:\n|$)/, text);
  assert.ok(letzterStand(r).startsWith(`fertig bis pakete\n${ALS_NAECHSTES.pakete}\n\nZiel: pakete\n\nzuletzt`), letzterStand(r));
  assert.doesNotMatch(staendeVon(r).join("\n"), /Prüfer:|Grenze:/);
  // Vor dem Ende am Ziel steht kein `fertig bis`.
  assert.ok(staendeVon(r).slice(0, -1).every((t) => !t.includes("fertig bis")));
});

test("E5: ziel:umsetzung und ziel:push-vorbereitet enden mit fertig bis und ihrem Satz", async () => {
  // push-vorbereitet endet erst nach der Vorbereitung des Laufs (Issue #1254), die die Datei ablegt.
  const sitzung = jeStufe({ vorbereitung: vorbereitungAblegen() });
  for (const ziel of ["umsetzung", "push-vorbereitet"]) {
    const r = await ketteImProzess({ karten: bisAbdeckungVorhanden(fachMit(`ziel:${ziel}`)), sitzung, kette: { uebergaenge: { abdeckungUmsetzung: true } } });
    assert.equal(r.code, 0, r.ausgabe);
    assert.ok(letzterStand(r).startsWith(`fertig bis ${ziel}\n${ALS_NAECHSTES[ziel]}\n\nZiel: ${ziel}\n`), letzterStand(r));
  }
});

test("E5: eine Projektgrenze vor dem Ziel steht als Grenze: in jeder Fassung", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:pakete")], sitzung: GLATT, kette: { uebergaenge: { paketeAbdeckung: false } } });
  assert.equal(r.code, 0, r.ausgabe);
  for (const text of staendeVon(r)) assert.match(text, /(?:^|\n)Ziel: pakete\nGrenze: pakete(?:\n|$)/, text);
  assert.ok(letzterStand(r).startsWith("wartet: Übergang paketeAbdeckung im Projekt nicht freigegeben — weiter mit kit:night\n\nZiel: pakete\nGrenze: pakete\n"), letzterStand(r));
  assert.doesNotMatch(letzterStand(r), /fertig bis/);
  // E6: Die Einheit traegt Ziel und Grenze, der Nachtbericht an der Karte die Zeile unter `### Ausgang`.
  const einheit = r.lauf.einheiten.find((e) => e.id === F);
  assert.equal(einheit.ausgang, "unvollstaendig");
  assert.equal(einheit.ziel, "pakete");
  assert.equal(einheit.projektgrenze, true);
  const bericht = r.karte(F).comments.map((c) => c.body).find((b) => b.includes("### Ausgang"));
  assert.match(bericht, /### Ausgang\n\nunvollstaendig — wartet: Übergang paketeAbdeckung[^\n]*\nan der Projektgrenze stehen geblieben, nicht am Ziel pakete\n/);
});

test("E5: die Grenze vor der Umsetzung nennt abdeckung", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:umsetzung", "planreview:1")], sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: false } } });
  assert.equal(r.code, 0, r.ausgabe);
  for (const text of staendeVon(r)) assert.match(text, /(?:^|\n)Ziel: umsetzung\nPrüfer: 1\nGrenze: abdeckung(?:\n|$)/, text);
});

test("E5: eine gesperrte Stufe hinter dem Ziel ist keine Grenze", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:plan")], sitzung: GLATT, kette: { uebergaenge: { paketeAbdeckung: false } } });
  assert.equal(r.code, 0, r.ausgabe);
  assert.doesNotMatch(staendeVon(r).join("\n"), /Grenze:/);
  assert.match(letzterStand(r), /^fertig bis plan\n/);
});

test("E16: planreview:2 ohne Ziel ergibt nur Prüfer: 2 unter dem Kopf", async () => {
  const r = await ketteImProzess({ karten: [fachMit("planreview:2")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const staende = staendeVon(r);
  for (const text of staende) assert.ok(text.startsWith("Prüfer: 2\n\nzuletzt"), text);
  assert.doesNotMatch(staende.join("\n"), /Ziel:|Grenze:|fertig bis|Als Nächstes:/);
});

test("ohne Ziel und ohne planreview:* keine dieser Zeilen", async () => {
  const r = await ketteImProzess({ karten: [fachMit()], sitzung: GLATT, kette: { uebergaenge: { paketeAbdeckung: false } } });
  assert.equal(r.code, 0, r.ausgabe);
  const staende = staendeVon(r);
  assert.ok(staende.length > 0);
  assert.doesNotMatch(staende.join("\n"), /Ziel:|Prüfer:|Grenze:|fertig bis|Als Nächstes:/);
  assert.ok(staende[0].startsWith("zuletzt begonnen: plan begonnen"), staende[0]);
});
