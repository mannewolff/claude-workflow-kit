// Die Auswahl der Nacht-Kette lehnt unpassende Ziel- und Pruefer-Einstellungen ab
// (Plan #1243, A9, E3, E4; Issue #1244).
//
// `zielAusschluss` ist rein und an Fixtures pruefbar. Die Auswahl ruft ihn nach den
// vorhandenen Ausschluessen; ein Treffer gilt als uebersprungen, die Karte behaelt alle
// Labels und bekommt einmal einen Hinweis mit dem naechsten Schritt — nach dem Muster
// der Ablehnung einer ungeprueften Anforderung (test/night-kette-pruefung.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { KETTE_ZIEL_ANKER, REVIEW_FERTIG_LABEL, ZIEL_UNPASSEND_PRAEFIX, waehleKettenKandidaten, zielAusschluss } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, planKarte, KETTE_LABEL } from "./helpers/kette-fixture.mjs";

const fach = (...labels) => ({ id: "1", title: "[Fachlich] Anliegen", labels: [KETTE_LABEL, ...labels] });
const plan = (...labels) => ({ id: "2", title: "[Plan] Weg", labels: [KETTE_LABEL, ...labels] });
const GEPRUEFTER_PLAN = { id: "2", body: "Fachliche Quelle: Issue #1\nPlan-Review: fable (2026-10-06)\n" };
const UNGEPRUEFTER_PLAN = { id: "2", body: "Fachliche Quelle: Issue #1\n" };

/** Prueft, dass ein Grund das feste Praefix traegt und den Text enthaelt. */
function grundMit(grund, muster) {
  assert.ok(grund?.startsWith(ZIEL_UNPASSEND_PRAEFIX), `kein Grund mit Praefix: ${grund}`);
  assert.match(grund, muster);
}

// --- zielAusschluss an Fixtures, je Regel aus E3 ---

test("E3: passende Einstellungen ergeben keinen Grund", () => {
  assert.equal(zielAusschluss(fach(), "fachplan", null), null);
  assert.equal(zielAusschluss(fach("ziel:plan", "planreview:2"), "fachplan", null), null);
  assert.equal(zielAusschluss(fach("planreview:1"), "fachplan", UNGEPRUEFTER_PLAN), null);
  assert.equal(zielAusschluss(plan("ziel:pakete"), "plan", null), null);
  assert.equal(zielAusschluss(plan("ziel:push-vorbereitet", "kit:durchziehen"), "plan", null), null);
});

test("E3: mehr als ein ziel:*-Label wird abgelehnt", () => {
  grundMit(zielAusschluss(fach("ziel:plan", "ziel:pakete"), "fachplan", null), /ziel:plan, ziel:pakete/);
  grundMit(zielAusschluss(plan("ziel:umsetzung", "ziel:irgendwas"), "plan", null), /mehr als ein Ziel/);
});

test("E3: beide planreview:* werden abgelehnt", () => {
  grundMit(zielAusschluss(fach("planreview:1", "planreview:2"), "fachplan", null), /planreview:1 und planreview:2/);
});

test("E3: ziel:plan an einem Plandokument wird abgelehnt", () => {
  grundMit(zielAusschluss(plan("ziel:plan"), "plan", null), /ziel:plan an einem Plandokument/);
});

test("E3: planreview:* an einem Plandokument wird abgelehnt", () => {
  grundMit(zielAusschluss(plan("planreview:1"), "plan", null), /planreview:1 an einem Plandokument/);
  grundMit(zielAusschluss(plan("planreview:2", "ziel:pakete"), "plan", null), /planreview:2 an einem Plandokument/);
});

test("E3: planreview:* an einer Anforderung, deren Plan schon einen Plan-Review-Marker traegt, wird abgelehnt", () => {
  grundMit(zielAusschluss(fach("planreview:2"), "fachplan", GEPRUEFTER_PLAN), /Plan #2 ist schon geprueft/);
});

test("jeder Grund nennt den naechsten Schritt und dass die Labels bleiben", () => {
  const grund = zielAusschluss(plan("ziel:plan"), "plan", null);
  assert.match(grund, /abnehmen/);
  assert.match(grund, /die Karte behaelt ihre Labels/);
});

// --- Die Auswahl ---

const karten = () => [
  { id: "10", title: "[Fachlich] Ziel plan", status: "backlog", body: "", labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "ziel:plan"] },
  { id: "11", title: "[Fachlich] Ziel pakete", status: "backlog", body: "", labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "ziel:pakete", "planreview:2"] },
  { id: "12", title: "[Fachlich] Zwei Ziele", status: "backlog", body: "", labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "ziel:plan", "ziel:umsetzung"] },
  planKarte("13", "99", { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "ziel:plan"] }),
  { id: "99", title: "[Fachlich] Quelle des Plans", status: "backlog", body: "", labels: [] },
];

test("A9: zwei gueltige und zwei unpassende Karten — zwei Kandidaten, zwei Uebersprungene mit Grund, Labels unveraendert", () => {
  const vorher = karten();
  const eingabe = structuredClone(vorher);
  const r = waehleKettenKandidaten(eingabe, KETTE_LABEL, 5);
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["10", "11"]);
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["12", "13"]);
  for (const u of r.uebersprungen) assert.ok(u.grund.startsWith(ZIEL_UNPASSEND_PRAEFIX), u.grund);
  assert.deepEqual(eingabe, vorher, "die Auswahl hat Karten oder Labels veraendert");
});

test("A9: die Ablehnung steht hinter den vorhandenen Ausschluessen", () => {
  const r = waehleKettenKandidaten([
    { id: "1", title: "[Fachlich] Ungeprueft", status: "backlog", labels: [KETTE_LABEL, "ziel:plan", "ziel:pakete"] },
  ], KETTE_LABEL, 5);
  assert.match(r.uebersprungen[0].grund, /^ungeprueft/, "der vorhandene Ausschluss gewinnt");
});

test("A9: eine unpassende Karte verbraucht keinen Platz unter max", () => {
  const r = waehleKettenKandidaten(karten(), KETTE_LABEL, 2);
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["10", "11"]);
  assert.deepEqual(r.liegengeblieben, []);
});

test("E3: planreview an einer Anforderung, zu der ein gepruefter Plan am Board steht, wird abgelehnt", () => {
  const r = waehleKettenKandidaten([
    { id: "20", title: "[Fachlich] Mit Plan", status: "backlog", body: "", labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "planreview:1"] },
    { id: "21", title: "[Plan] Schon geprueft", status: "backlog", body: "Fachliche Quelle: Issue #20\nPlan-Review: fable (2026-10-06)\n", labels: [] },
  ], KETTE_LABEL, 5);
  assert.deepEqual(r.kandidaten, []);
  assert.match(r.uebersprungen[0].grund, /Plan #21 ist schon geprueft/);
});

test("E4: ein Ziel-Label ohne kit:night bleibt unbeachtet", () => {
  const r = waehleKettenKandidaten([
    { id: "30", title: "[Fachlich] Ohne Start", status: "backlog", body: "", labels: [REVIEW_FERTIG_LABEL, "ziel:plan", "ziel:pakete"] },
  ], KETTE_LABEL, 5);
  assert.deepEqual(r, { kandidaten: [], uebersprungen: [], liegengeblieben: [] });
});

// --- Der einmalige Hinweis an der Karte ---

const ankerZaehlen = (r, id) => r.karte(id).comments.filter((c) => c.body.includes(KETTE_ZIEL_ANKER)).length;
const ZWEI_ZIELE = () => fachplanKarte("7", { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "ziel:plan", "ziel:pakete"] });

test("A9: die unpassende Karte bekommt einmal den Hinweis mit Grund und behaelt alle Labels", async () => {
  const r = await ketteImProzess({ karten: [ZWEI_ZIELE()] });
  assert.equal(r.code, 0);
  assert.equal(ankerZaehlen(r, "7"), 1);
  const text = r.karte("7").comments.map((c) => c.body).join("\n");
  assert.match(text, /ziel:plan, ziel:pakete/);
  assert.deepEqual(r.karte("7").labels, [KETTE_LABEL, REVIEW_FERTIG_LABEL, "ziel:plan", "ziel:pakete"]);
  assert.ok(!r.aufrufe.some((a) => a[1] === "stand"), "ein Laufstand ist entstanden");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "7").ausgang, "uebersprungen");
  assert.deepEqual(r.sitzungen, []);
});

test("A9: ein zweiter Lauf schreibt den Hinweis nicht noch einmal", async () => {
  const erster = await ketteImProzess({ karten: [ZWEI_ZIELE()] });
  const r = await ketteImProzess({ karten: structuredClone(erster.karten) });
  assert.equal(r.code, 0);
  assert.equal(ankerZaehlen(r, "7"), 1);
  assert.match(r.ausgabe, /steht schon am Board/);
});

test("A9: der Trockenlauf zeigt die Ablehnung und schreibt nichts ans Board", async () => {
  const r = await ketteImProzess({ karten: [ZWEI_ZIELE()], argv: ["--dry-run"] });
  assert.equal(r.code, 0);
  assert.match(r.ausgabe, new RegExp(`#7 .*-> uebersprungen \\(${ZIEL_UNPASSEND_PRAEFIX}`));
  assert.equal(ankerZaehlen(r, "7"), 0);
  assert.ok(!r.aufrufe.some((a) => a[1] === "comment" || a[1] === "stand"), "der Trockenlauf schreibt ans Board");
});
