// Ein Plan ohne fachliche Anforderung als eigene Wurzel der Nacht-Kette (Fachplan #1644,
// Plan #1645, E1, E2, E3, E6, E11; Issue #1647).
//
// Ein `[Plan]` ohne Zeile `Fachliche Quelle:` laeuft wie ein Plan mit Anforderung: Seine
// Wurzel `F` ist die Nummer des Plans, Sperre, Kollision und Sitzungsname greifen ohne
// neuen Mechanismus. Eine Zeile, die keine Karte trifft oder nicht die Form `Issue #N`
// hat, ist ein Verweis ins Leere und haelt an. Alle uebrigen Gruende halten ihn mit
// demselben Wortlaut an wie einen Plan mit Anforderung.
//
// Abgleich und Bericht gegen den Plan traegt das Folgepaket (#1648).

import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_FERTIG_LABEL, planAusschluss, quelleLage, waehleKettenKandidaten } from "../kit/night/kette.mjs";
import { KLAEREN_LABEL } from "../kit/night/wartend.mjs";
import { spracheFestlegen } from "../kit/board/namen.mjs";
import {
  ketteImProzess, fachplanKarte, planKarte, planBody, paketBody, jeStufe, paketeAnlegen, paketeHalt, vorbereitungAblegen,
  KETTE_LABEL,
} from "./helpers/kette-fixture.mjs";

const GEPRUEFT = [KETTE_LABEL, REVIEW_FERTIG_LABEL];

/** Der Body eines Plans ohne Zeile `Fachliche Quelle:`. */
const OHNE_BODY = planBody().replace("Fachliche Quelle: Issue #__F__\n", "");

/** Ein Plan ohne fachliche Anforderung als Karte der Attrappe. */
function planOhne(id, { labels = GEPRUEFT, body = OHNE_BODY, status = "backlog", titel = "[Plan] Ohne Anforderung" } = {}) {
  return { id: String(id), title: titel, body, status, labels: [...labels] };
}

const einheitVon = (r, id) => r.lauf.einheiten.find((e) => e.id === id);
const stufenVon = (r) => r.sitzungen.map((s) => s.stufe);
const PAKETE_GLATT = jeStufe({ pakete: paketeAnlegen });

// --- Das Szenario aus dem Paket ---

test("Szenario: Ein Plan ohne Anforderung mit offener Klärung bleibt liegen", async () => {
  const r = await ketteImProzess({
    karten: [planOhne("2", { labels: [...GEPRUEFT, KLAEREN_LABEL] })],
    sitzung: PAKETE_GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);

  const einheit = einheitVon(r, "2");
  assert.equal(einheit.ausgang, "uebersprungen");
  assert.equal(einheit.grund, planAusschluss(planOhne("2", { labels: [...GEPRUEFT, KLAEREN_LABEL] }), KETTE_LABEL, []));
  assert.match(einheit.grund, /^traegt kit:clarify — die Entscheidung gehoert in den Plan/);
  for (const text of [einheit.grund, r.ausgabe]) {
    assert.doesNotMatch(text, /Herkunft|verweist ins Leere/, "der Bericht nennt eine fehlende Herkunft");
  }
  assert.match(r.ausgabe, /#2 .*traegt kit:clarify/);
  assert.deepEqual(r.sitzungen, [], "keine Session darf gelaufen sein");
  assert.ok(r.karte("2").labels.includes(KLAEREN_LABEL), "das Label kit:clarify muss stehen bleiben");
  assert.ok(r.karte("2").labels.includes(KETTE_LABEL), "das Kennzeichen muss stehen bleiben");
});

// --- quelleLage ---

test("[night-1647] quelleLage unterscheidet keine Zeile, eine Karte und einen Verweis ins Leere", () => {
  const karten = [{ id: "5" }, { id: "0007" }];
  assert.deepEqual(quelleLage("## Ziel\n\nx\n", karten), { lage: "keine" });
  assert.deepEqual(quelleLage("", karten), { lage: "keine" });
  assert.deepEqual(quelleLage("Fachliche Quelle: Issue #5\n", karten), { lage: "karte", nummer: "5" });
  assert.deepEqual(quelleLage("Requirement: Issue #0007\n", karten), { lage: "karte", nummer: "0007" });
  assert.deepEqual(quelleLage("Fachliche Quelle: Issue #9\n", karten), { lage: "insLeere", zeile: "Fachliche Quelle: Issue #9" });
  assert.deepEqual(quelleLage("Fachliche Quelle: Issue #7\n", karten), { lage: "insLeere", zeile: "Fachliche Quelle: Issue #7" },
    "die Nummer wird zeichengleich verglichen");
  assert.deepEqual(quelleLage("Fachliche Quelle: siehe Idee\n", karten), { lage: "insLeere", zeile: "Fachliche Quelle: siehe Idee" });
});

// --- Der Verweis ins Leere ---

test("[night-1647] ein Verweis ins Leere bleibt liegen und nennt die Zeile", async () => {
  const body = planBody().replaceAll("__F__", "999");
  const r = await ketteImProzess({ karten: [planOhne("2", { body })], sitzung: PAKETE_GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = einheitVon(r, "2");
  assert.equal(einheit.ausgang, "uebersprungen");
  assert.match(einheit.grund, /^die Zeile 'Fachliche Quelle: Issue #999' verweist ins Leere/);
  assert.deepEqual(r.sitzungen, []);
  assert.ok(r.karte("2").labels.includes(KETTE_LABEL), "das Kennzeichen muss stehen bleiben");
});

test("[night-1647] eine Zeile ohne die Form Issue #N bleibt liegen, auch in der anderen Sprachfassung", () => {
  for (const zeile of ["Fachliche Quelle: siehe Idee", "Requirement: siehe Idee"]) {
    const grund = planAusschluss(planOhne("2", { body: `${zeile}\n\n${OHNE_BODY}` }), KETTE_LABEL, []);
    assert.equal(grund?.startsWith(`die Zeile '${zeile}' verweist ins Leere`), true, grund);
  }
});

test("[night-1647] in einem englischen Projekt heisst der Verweis ins Leere englisch", () => {
  spracheFestlegen("en");
  try {
    const grund = planAusschluss(planOhne("2", { body: `Fachliche Quelle: siehe Idee\n\n${OHNE_BODY}` }), KETTE_LABEL, []);
    assert.match(grund, /^the line 'Fachliche Quelle: siehe Idee' points nowhere/);
  } finally {
    spracheFestlegen(null);
  }
});

// --- Aufnahme mit und ohne Ziel (E11) ---

test("[night-1647] ohne Ziel-Label laeuft der Plan mit der Vorgabe: pakete und abdeckung, Einheit ohne fachplan", async () => {
  const r = await ketteImProzess({ karten: [planOhne("2")], sitzung: PAKETE_GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["pakete", "abdeckung"]);
  assert.ok(r.sitzungen.every((s) => s.issue === "2"), "die Wurzel der Kette ist der Plan selbst");

  const einheit = einheitVon(r, "2");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.auftrag, "plan");
  assert.equal("fachplan" in einheit, false, "ein Plan ohne Anforderung traegt kein Feld fachplan (E6)");
  assert.equal("ohneAnforderung" in einheit, false, "die Einheit bekommt kein neues Feld (E6)");
  assert.equal(einheit.stufen.plan.uebernommen, true);
  assert.ok(!r.karte("2").labels.includes(KETTE_LABEL), "das Kennzeichen ist verbraucht");
  assert.match(r.ausgabe, /Kette 1\/\d+: Plan #2 \(ohne fachliche Anforderung\) — \[Plan\] Ohne Anforderung/);
  assert.doesNotMatch(r.ausgabe, /fachliche Quelle #/);
});

test("[night-1647] mit ziel:pakete, ziel:umsetzung und ziel:push-vorbereitet wird der Plan aufgenommen", () => {
  for (const ziel of ["ziel:pakete", "ziel:umsetzung", "ziel:push-vorbereitet"]) {
    const r = waehleKettenKandidaten([planOhne("2", { labels: [...GEPRUEFT, ziel] })], KETTE_LABEL, 5);
    assert.deepEqual(r.uebersprungen, [], ziel);
    assert.deepEqual(r.kandidaten.map((a) => [a.karte.id, a.art, a.F, a.planId, a.ohneAnforderung]),
      [["2", "plan", "2", "2", true]], ziel);
  }
});

test("[night-1647] ziel:pakete endet nach abdeckung mit fertig", async () => {
  const r = await ketteImProzess({ karten: [planOhne("2", { labels: [...GEPRUEFT, "ziel:pakete"] })], sitzung: PAKETE_GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["pakete", "abdeckung"]);
  assert.equal(einheitVon(r, "2").ausgang, "fertig", einheitVon(r, "2").grund);
  assert.match(r.ausgabe, /Ziel pakete erreicht nach abdeckung/);
});

/** Der gepruefte Plan ohne Anforderung mit umgesetzten Paketen und dem Laufstand nach der Abdeckung. */
function bisAbdeckungOhne(ziel) {
  const P = "2";
  const pakete = ["3", "4"].map((id, i) => ({
    id, title: `Paket ${id}`, status: "in_review", labels: [], body: paketBody(P, P, { n: i + 1, aufgabe: `Paket ${id}.` }),
  }));
  const plan = planOhne(P, { labels: [...GEPRUEFT, ziel, "lauf:abgebrochen"] });
  plan.comments = [{ body: `## Laufstand\n\nzuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z` }];
  return [plan, ...pakete];
}

test("[night-1647] ziel:umsetzung endet nach umsetzung mit fertig", async () => {
  const r = await ketteImProzess({ karten: bisAbdeckungOhne("ziel:umsetzung"), sitzung: PAKETE_GLATT, kette: { uebergaenge: { abdeckungUmsetzung: true } } });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = einheitVon(r, "2");
  assert.equal(einheit.variante, "B");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.match(r.ausgabe, /Ziel umsetzung erreicht nach umsetzung/);
});

test("[night-1647] ziel:push-vorbereitet erreicht die Stufe vorbereitung", async () => {
  const r = await ketteImProzess({
    karten: bisAbdeckungOhne("ziel:push-vorbereitet"), kette: { uebergaenge: { abdeckungUmsetzung: true } },
    sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["vorbereitung"]);
  const einheit = einheitVon(r, "2");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.deepEqual(r.lauf.vorbereitung.karten, ["2"]);
  assert.match(r.ausgabe, /Ziel push-vorbereitet erreicht nach vorbereitung/);
});

// --- Die uebrigen Gruende, mit demselben Wortlaut wie beim Plan mit Anforderung ---

/** Ein Plan mit Anforderung (#1, ohne Kennzeichen) in derselben Lage wie `planOhne`. */
const mitAnforderung = (over = {}) => [
  fachplanKarte("1", { titel: "[Fachlich] Die Wurzel", labels: [REVIEW_FERTIG_LABEL] }),
  planKarte("2", "1", { labels: GEPRUEFT, ...over }),
];

/** Der Grund an Karte #2 nach der Auswahl. */
const grundVon = (karten, max = 5, optionen = {}) =>
  waehleKettenKandidaten(karten, KETTE_LABEL, max, optionen).uebersprungen.find((u) => u.id === "2")?.grund;

test("[night-1647] jeder uebrige Grund haelt einen Plan ohne Anforderung mit demselben Wortlaut an", () => {
  const offeneFrage = planBody({ offeneFragen: "- Welcher Adapter zuerst?" });
  const faelle = {
    spalte: { status: "ready" },
    pruefung: { labels: [KETTE_LABEL] },
    klaerung: { labels: [...GEPRUEFT, KLAEREN_LABEL] },
    offeneFrage: { body: offeneFrage },
    unpassendeLabels: { labels: [...GEPRUEFT, "ziel:plan"] },
    zweiZiele: { labels: [...GEPRUEFT, "ziel:pakete", "ziel:umsetzung"] },
  };
  for (const [fall, over] of Object.entries(faelle)) {
    const ohneOver = over.body ? { ...over, body: over.body.replace("Fachliche Quelle: Issue #__F__\n", "") } : over;
    const mit = grundVon(mitAnforderung(over));
    assert.ok(mit, `${fall}: der Plan mit Anforderung haette anhalten muessen`);
    assert.equal(grundVon([planOhne("2", ohneOver)]), mit, fall);
  }
});

test("[night-1647] eine belegte Wurzel haelt den Plan ohne Anforderung an seiner eigenen Nummer", () => {
  const halter = { karte: "2", laufId: "dort/123/2026-10-06-010000" };
  const gefragt = [];
  const belegt = (F) => { gefragt.push(F); return halter; };
  const ohne = grundVon([planOhne("2")], 5, { belegt });
  assert.deepEqual(gefragt, ["2"], "gefragt wird nach der Nummer des Plans selbst");
  assert.equal(ohne, grundVon(mitAnforderung(), 5, { belegt }));
  assert.match(ohne, /dort\/123\/2026-10-06-010000/);
});

test("[night-1647] sind die Plaetze vergeben, bleibt der Plan ohne Anforderung liegen wie jeder andere", () => {
  const karten = [{ id: "1", title: "[Fachlich] Vorher", status: "backlog", labels: GEPRUEFT, body: "" }, planOhne("2")];
  const r = waehleKettenKandidaten(karten, KETTE_LABEL, 1);
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["1"]);
  assert.deepEqual(r.liegengeblieben, [{ id: "2", title: "[Plan] Ohne Anforderung" }]);
});

// --- Zwei Plaene ohne Anforderung ---

test("[night-1647] zwei Plaene ohne Anforderung laufen beide", async () => {
  const r = await ketteImProzess({
    karten: [planOhne("2", { titel: "[Plan] Erster" }), planOhne("3", { titel: "[Plan] Zweiter" })],
    sitzung: PAKETE_GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);
  for (const id of ["2", "3"]) {
    const einheit = einheitVon(r, id);
    assert.equal(einheit.ausgang, "fertig", `#${id}: ${einheit.grund}`);
    assert.equal("fachplan" in einheit, false);
  }
  assert.deepEqual(r.sitzungen.filter((s) => s.stufe === "pakete").map((s) => s.issue), ["2", "3"]);
  assert.match(r.ausgabe, /Nacht-Kette beendet: 2 fertig/);
});

// --- Trockenlauf und Halt ---

test("[night-1647] der Trockenlauf nennt den Plan-Auftrag ohne fachliche Anforderung", async () => {
  const karten = [planOhne("2")];
  const vorher = structuredClone(karten);
  const r = await ketteImProzess({ karten, argv: ["--dry-run"], sitzung: PAKETE_GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.match(r.ausgabe, /#2 \[Plan\] Ohne Anforderung -> Kette 1 \(Plan-Auftrag ohne fachliche Anforderung, Variante A\)/);
  assert.deepEqual(r.karten.map(({ id, title, body, status, labels }) => ({ id, title, body, status, labels })), vorher);
  assert.deepEqual(r.sitzungen, []);
});

test("[night-1647] der Halt am Plan ohne Anforderung nennt keine fachliche Anforderung", async () => {
  const r = await ketteImProzess({ karten: [planOhne("2")], sitzung: jeStufe({ pakete: paketeHalt }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(einheitVon(r, "2").ausgang, "angehalten");
  assert.ok(r.karte("2").labels.includes(KLAEREN_LABEL));
  const text = r.karte("2").comments.map((c) => c.body).join("\n");
  assert.match(text, /Die Entscheidung gehoert in Plan #2: Die naechste Kette nimmt den Plan als Auftrag/);
  assert.match(text, /^\d+\. kit:clarify an Plan #2 abnehmen\.$/m);
  assert.doesNotMatch(text, /fachliche(?:n)? Anforderung #/);
});
