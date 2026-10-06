// Die beiden Kollisionen zwischen den Auftragsarten der Nacht-Kette (Fachplan #883,
// Plan #890; Issue #895).
//
// Ein Mensch kann beides kennzeichnen — die fachliche Anforderung und einen aus ihr
// entstandenen Plan —, und er kann zwei Plaene derselben Wurzel kennzeichnen. Beide
// Faelle loest die Auswahl auf, bevor `--max` greift: Eine weichende Karte verbraucht
// keinen Platz.
//
// Seit Issue #1233 laufen die Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6);
// keiner dieser Faelle braucht den Einstieg, darum gibt es zu dieser Datei keine Ablauf-Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waehleKettenKandidaten, UNGEPRUEFT_PRAEFIX, REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, planKarte, GLATT, KETTE_LABEL } from "./helpers/kette-fixture.mjs";

const GEPRUEFT = [KETTE_LABEL, REVIEW_FERTIG_LABEL];

/** Die Nummern der Auftragskarten, die `waehleKettenKandidaten` fahren wuerde. */
const laufen = (r) => r.kandidaten.map((a) => String(a.karte.id));

test("[night-895] ist zu einer gekennzeichneten Anforderung ein Plan gekennzeichnet, laeuft der Plan", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1", { titel: "[Fachlich] Die Wurzel" }), planKarte("2", "1", { labels: GEPRUEFT })],
    sitzung: GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["pakete", "abdeckung"],
    "es lief eine zweite Kette an der Anforderung");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "2").ausgang, "fertig");
  const weicht = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(weicht.ausgang, "uebersprungen");
  assert.match(weicht.grund, /#2\b/, "der Grund nennt die Karte, die stattdessen laeuft");
  assert.ok(r.karte("1").labels.includes("kit:night"), "die Anforderung muss ihr Label behalten");
});

test("[night-895] die Anforderung weicht dem gekennzeichneten Plan auch dann, wenn der Plan selbst uebersprungen wird", () => {
  const anforderung = { id: "1", title: "[Fachlich] Die Wurzel", status: "backlog", labels: ["kit:night", REVIEW_FERTIG_LABEL] };
  // Ohne review:fertig: Der Plan laeuft selbst nicht — das Kennzeichen des Menschen
  // steht trotzdem an ihm, und die Anforderung soll nicht ersatzweise neu geplant werden.
  const plan = {
    id: "2", title: "[Plan] Ein Weg", status: "backlog", labels: ["kit:night"],
    body: "Fachliche Quelle: Issue #1\n\n## Offene Fragen\n\n- Keine.\n",
  };
  const r = waehleKettenKandidaten([anforderung, plan], "kit:night", 5);
  assert.deepEqual(laufen(r), [], "keine der beiden Karten laeuft");
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["1", "2"], "beide gehen mit Grund nach uebersprungen");
  assert.match(r.uebersprungen[0].grund, /#2/);
  assert.ok(r.uebersprungen[1].grund.startsWith(UNGEPRUEFT_PRAEFIX), r.uebersprungen[1].grund);
});

test("[night-895] von zwei gekennzeichneten Plaenen derselben Wurzel laeuft der mit der hoeheren Nummer", async () => {
  const r = await ketteImProzess({
    karten: [
      fachplanKarte("1", { titel: "[Fachlich] Die Wurzel", labels: [REVIEW_FERTIG_LABEL] }),
      planKarte("2", "1", { titel: "[Plan] Der aeltere Weg", labels: GEPRUEFT }),
      planKarte("3", "1", { titel: "[Plan] Der neuere Weg", labels: GEPRUEFT }),
    ],
    sitzung: GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["pakete", "abdeckung"], "es lief mehr als eine Kette");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "3").ausgang, "fertig");
  const weicht = r.lauf.einheiten.find((e) => e.id === "2");
  assert.equal(weicht.ausgang, "uebersprungen");
  assert.match(weicht.grund, /#3\b/, "der Grund nennt den Plan, der stattdessen laeuft");
  assert.ok(r.karte("2").labels.includes("kit:night"), "der aeltere Plan muss sein Label behalten");
});

test("[night-895] eine weichende Karte verbraucht keinen Platz unter --max", () => {
  const geprueft = ["kit:night", REVIEW_FERTIG_LABEL];
  const karten = [
    { id: "1", title: "[Fachlich] Erste Wurzel", status: "backlog", labels: geprueft },
    { id: "2", title: "[Plan] Zu #1", status: "backlog", labels: geprueft, body: "Fachliche Quelle: Issue #1\n\n## Offene Fragen\n\n- Keine.\n" },
    { id: "3", title: "[Fachlich] Zweite Wurzel", status: "backlog", labels: geprueft },
  ];
  const r = waehleKettenKandidaten(karten, "kit:night", 2);
  assert.deepEqual(laufen(r), ["2", "3"], "die weichende #1 haette sonst einen der zwei Plaetze belegt");
  assert.deepEqual(r.liegengeblieben, []);
});

test("[night-895] ein Fachplan-Auftrag und ein Plan-Auftrag zu einer anderen Wurzel laufen in derselben Nacht", async () => {
  const r = await ketteImProzess({
    karten: [
      fachplanKarte("1", { titel: "[Fachlich] Erste Wurzel" }),
      fachplanKarte("2", { titel: "[Fachlich] Zweite Wurzel", labels: [REVIEW_FERTIG_LABEL] }),
      planKarte("3", "2", { labels: GEPRUEFT }),
    ],
    sitzung: GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe),
    ["plan", "review", "pakete", "abdeckung", "pakete", "abdeckung"],
    "der Fachplan-Auftrag faehrt alle vier Stufen, der Plan-Auftrag nur die beiden hinteren");
  const F1 = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(F1.ausgang, "fertig", "der Fachplan-Auftrag lief nicht");
  assert.equal(F1.auftrag, "fachplan");
  assert.equal("fachplan" in F1, false, "ein Fachplan-Auftrag traegt keine zweite Herkunftsangabe");
  const planAuftrag = r.lauf.einheiten.find((e) => e.id === "3");
  assert.equal(planAuftrag.ausgang, "fertig", planAuftrag.grund);
  assert.equal(planAuftrag.auftrag, "plan");
  assert.equal(planAuftrag.fachplan, "2");
  assert.match(r.ausgabe, /Nacht-Kette beendet: 2 fertig/);
});
