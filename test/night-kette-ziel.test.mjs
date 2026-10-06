// Die Auswahl der Nacht-Kette lehnt unpassende Ziel- und Pruefer-Einstellungen ab
// (Plan #1243, A9, E3, E4; Issue #1244).
//
// `zielAusschluss` ist rein und an Fixtures pruefbar. Die Auswahl ruft ihn nach den
// vorhandenen Ausschluessen; ein Treffer gilt als uebersprungen, die Karte behaelt alle
// Labels und bekommt einmal einen Hinweis mit dem naechsten Schritt — nach dem Muster
// der Ablehnung einer ungeprueften Anforderung (test/night-kette-pruefung.test.mjs).
//
// Das Ziel bestimmt Variante und Ende der Kette (Plan #1243, A2, A3, E1; Issue #1249):
// Der Start verbraucht Startkennzeichen, Ziel und Prueferzahl zusammen, und die Kette
// endet nach der Endstufe ihres Ziels mit `fertig`. Leicht, Session und Board ueber
// `ketteImProzess` (KETTE_ABHAENGIGKEITEN), ohne feste Pause.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KETTE_ZIEL_ANKER, REVIEW_FERTIG_LABEL, ZIEL_UNPASSEND_PRAEFIX, waehleKettenKandidaten, zielAusschluss } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, planKarte, planBody, paketBody, KETTE_LABEL, GLATT } from "./helpers/kette-fixture.mjs";

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

// --- Verbrauch beim Start und Ende am Ziel (A2, A3, E1; Issue #1249) ---

const F = "1";
const P = "2";
const einheitVon = (r, id) => r.lauf.einheiten.find((e) => e.id === id);
const stufenVon = (r) => r.sitzungen.map((s) => s.stufe);
const fachMit = (...labels) => fachplanKarte(F, { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, ...labels] });

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

test("E1: der Start verbraucht kit:night, ziel:* und planreview:* zusammen und haelt Ziel und Prueferzahl fest", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:plan", "planreview:2")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.karte(F).labels.filter((l) => l === KETTE_LABEL || l.startsWith("ziel:") || l.startsWith("planreview:")), []);
  assert.ok(r.karte(F).labels.includes(REVIEW_FERTIG_LABEL), "fremde Labels bleiben");
  for (const label of [KETTE_LABEL, "ziel:plan", "planreview:2"]) {
    assert.ok(r.aufrufe.some((a) => a.join(" ") === `issue label remove ${F} ${label}`), `${label} nicht abgenommen`);
  }
  assert.match(r.ausgabe, /Ziel plan, Pruefer 2 festgehalten/);
});

test("E1: ohne Ziel und ohne planreview:* nimmt der Start nur kit:night ab", async () => {
  const r = await ketteImProzess({ karten: [fachMit()], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const entfernt = r.aufrufe.filter((a) => a[1] === "label" && a[2] === "remove" && a[3] === F).map((a) => a[4]);
  assert.deepEqual(entfernt, [KETTE_LABEL]);
  assert.doesNotMatch(r.ausgabe, /festgehalten/);
});

test("A2: ziel:plan endet nach review mit fertig, ohne Stufe pakete", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:plan")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review"]);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.variante, "A");
  assert.equal(einheit.stufen.pakete, undefined, "die Stufe pakete lief");
  assert.match(r.ausgabe, /Ziel plan erreicht nach review/);
});

test("A2: ziel:pakete endet nach abdeckung mit fertig", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:pakete")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review", "pakete", "abdeckung"]);
  assert.equal(einheitVon(r, F).ausgang, "fertig");
  assert.match(r.ausgabe, /Ziel pakete erreicht nach abdeckung/);
});

test("A2: ziel:pakete endet auch bei abdeckungUmsetzung: true mit fertig statt zu warten", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:pakete")], sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: true } } });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.doesNotMatch(r.ausgabe, /Karte ohne Freigabe zur Umsetzung/);
  assert.match(r.ausgabe, /Ziel pakete erreicht nach abdeckung/);
});

test("A2: ziel:umsetzung und ziel:push-vorbereitet enden nach umsetzung mit fertig", async () => {
  for (const ziel of ["umsetzung", "push-vorbereitet"]) {
    const r = await ketteImProzess({ karten: bisAbdeckungVorhanden(fachMit(`ziel:${ziel}`)), sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: true } } });
    assert.equal(r.code, 0, r.ausgabe);
    assert.deepEqual(r.sitzungen, []);
    const einheit = einheitVon(r, F);
    assert.equal(einheit.variante, "B", ziel);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.umsetzung.vorgefunden, true, ziel);
    assert.match(r.ausgabe, new RegExp(`Ziel ${ziel} erreicht nach umsetzung`));
  }
});

test("A3: kit:durchziehen plus ziel:plan laeuft bis zur Umsetzung", async () => {
  const r = await ketteImProzess({ karten: [fachMit("kit:durchziehen", "ziel:plan")], sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: false } } });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review", "pakete", "abdeckung"]);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.variante, "B");
  assert.equal(einheit.ausgang, "unvollstaendig");
  assert.match(einheit.grund, /Übergang abdeckungUmsetzung im Projekt nicht freigegeben/, "die Kette endete nicht vor der Umsetzung");
  assert.doesNotMatch(r.ausgabe, /Ziel plan erreicht/);
});

test("A3: kit:durchziehen plus ziel:plan setzt bis nach umsetzung fort", async () => {
  const r = await ketteImProzess({ karten: bisAbdeckungVorhanden(fachMit("kit:durchziehen", "ziel:plan")), sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: true } } });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.umsetzung.vorgefunden, true);
  assert.match(r.ausgabe, /Ziel umsetzung erreicht nach umsetzung/);
});

test("A3: ohne Ziel bleibt die Kette wie heute — Variante A wartet bei abdeckungUmsetzung: true", async () => {
  const r = await ketteImProzess({ karten: [fachMit()], sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: true } } });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review", "pakete", "abdeckung"]);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "unvollstaendig");
  assert.match(einheit.grund, /Karte ohne Freigabe zur Umsetzung/);
  assert.doesNotMatch(r.ausgabe, /Ziel .* erreicht/);
});

test("A3: ohne Ziel endet Variante A ohne Freigabe-Einstellung nach abdeckung, ohne Vermerk", async () => {
  const r = await ketteImProzess({ karten: [fachMit()], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(einheitVon(r, F).ausgang, "fertig");
  assert.doesNotMatch(r.ausgabe, /Ziel .* erreicht/);
});
