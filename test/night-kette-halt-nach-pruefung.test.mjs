// Die Nacht-Kette haelt an einer offenen Frage im Plan erst nach der Pruefung an
// (Plan #1697, E1, E2, E3, E5, E11; Issue #1700).
//
// Die Stufe `plan` laeuft an einer offenen Frage durch, die Stufe `review` prueft den Plan,
// und erst danach haelt die Kette an — vor dem Schnitt in Pakete. Am Ende der Review-Sitzung
// liest `stufeReview` zuerst `stoppFragenGrund` am Body, dann `hatKlaerenLabel`; beim Halt
// vermerkt sie den Pruefstand am Plan. Das gilt auch, wenn erst die Pruefung die Frage
// in den Plan bringt (K7). Am Ende der Datei der Neustart am Plan nach der Antwort (Issue #1701).

import { test } from "node:test";
import assert from "node:assert/strict";
import { hatLabel } from "./helpers/labels.mjs";
import { PRUEFSTAND_ANKER, REVIEW_FERTIG_LABEL, pruefstandVon } from "../kit/night/kette.mjs";
import { mitEreignis } from "../kit/board/ereignis.mjs";
import {
  ketteImProzess, fachplanKarte, fachplanBody, planKarte, jeStufe, planAnlegen, planBody, reviewHalt, reviewMarker, reviewMitFrage, paketeAnlegen,
  EINARBEITUNG_ZEILE_ABGELEHNT, KETTE_LABEL, REVIEW_FRAGE,
} from "./helpers/kette-fixture.mjs";

const FRAGE = "- Ist der neue Endpunkt eine Schnittstelle, die jemand anderes nutzt?";
const MIT_FRAGE = planBody({ offeneFragen: FRAGE });

const fachMit = (...labels) => fachplanKarte("1", { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, ...labels] });
const einheitVon = (r) => r.lauf.einheiten.find((e) => e.id === "1");
const kommentare = (r, id) => r.karte(id).comments.map((c) => c.body);
const stufenVon = (r) => r.sitzungen.map((s) => s.stufe);

/** Der Halt nach der Pruefung: Einheit, Halt-Kommentar am Fachplan, kein /issues, Pruefstand am Plan. */
function haeltNachDerPruefung(r, frage) {
  const einheit = einheitVon(r);
  assert.equal(einheit.ausgang, "angehalten", einheit.grund);
  assert.equal(einheit.grund, "Stopp-Frage im geprüften Plan #2");
  assert.equal(einheit.stufen.review.marker, true, "die Review-Stufe hat den Marker gesetzt");
  assert.ok(hatLabel(r.karte("1").labels, "kit:klaeren"), "kit:klaeren fehlt am Fachplan");
  const halt = kommentare(r, "1").find((k) => k.startsWith("## Kette angehalten"));
  assert.ok(halt, "kein Halt-Kommentar am Fachplan");
  assert.match(halt, /Stufe review, Dokument #2\b/);
  assert.ok(halt.includes(frage.slice(2)), `die Frage fehlt im Halt-Kommentar:\n${halt}`);
  assert.ok(!r.sitzungen.some((s) => /^\/issues #/.test(s.prompt)), "/issues startet nicht");
  assert.equal(kommentare(r, "2").filter((k) => k.startsWith(PRUEFSTAND_ANKER)).length, 1, "genau ein Pruefstand am Plan");
}

test("Szenario: Ein Plan mit offener Frage wird trotzdem geprüft", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(MIT_FRAGE), review: reviewMarker, pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review"]);
  const plan = r.karte("2");
  assert.match(plan.body, /^Plan-Review: opus \(2026-09-14, Nachtlauf\)$/m, "der Marker fehlt");
  assert.ok(kommentare(r, "2").some((k) => k.startsWith("## Einarbeitung, Runde 1")), "die Einarbeitung fehlt am Plan");
  assert.ok(plan.body.includes(`## Offene Fragen\n\n${FRAGE}\n`), "die Frage bleibt unveraendert stehen");
  haeltNachDerPruefung(r, FRAGE);
});

test("Szenario: Ohne offene Frage ändert sich nichts", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review", "pakete", "abdeckung"]);
  assert.equal(einheitVon(r).ausgang, "fertig", einheitVon(r).grund);
  assert.ok(!kommentare(r, "2").some((k) => k.startsWith(PRUEFSTAND_ANKER)), "kein Pruefstand ohne Halt");
});

test("Szenario: Die Prüfung findet eine Frage an den Menschen", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: reviewMitFrage, pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review"]);
  assert.ok(r.karte("2").body.includes(`## Offene Fragen\n\n${REVIEW_FRAGE}\n`), "die Frage der Pruefung steht im Plan");
  haeltNachDerPruefung(r, REVIEW_FRAGE);
});

test("E2: ziel:plan und ein Plan mit Frage — angehalten, nicht fertig bis plan", async () => {
  const r = await ketteImProzess({ karten: [fachMit("ziel:plan")], sitzung: jeStufe({ plan: planAnlegen(MIT_FRAGE), review: reviewMarker }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan", "review"]);
  haeltNachDerPruefung(r, FRAGE);
  assert.doesNotMatch(r.ausgabe, /Ziel plan erreicht nach review/);
});

test("E3: gesperrter Übergang planReview und ein Plan mit Frage — Ende an der Projektgrenze vor review", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(MIT_FRAGE), review: reviewMarker }),
    kette: { uebergaenge: { planReview: false } },
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["plan"]);
  const einheit = einheitVon(r);
  assert.notEqual(einheit.ausgang, "angehalten", "kein Halt nach dem Plan");
  assert.ok(!hatLabel(r.karte("1").labels, "kit:klaeren"), "kein kit:klaeren am Fachplan");
  const text = kommentare(r, "1").join("\n");
  assert.ok(text.includes("wartet: Übergang planReview im Projekt nicht freigegeben"), text);
  assert.doesNotMatch(text, /## Kette angehalten/);
});

test("E5: kit:klaeren nach der Review-Sitzung ohne Frage im Body haelt wie bisher mit dem letzten neuen Kommentar", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: jeStufe({ plan: planAnlegen(), review: reviewHalt }) });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = einheitVon(r);
  assert.equal(einheit.ausgang, "angehalten");
  assert.match(einheit.grund, /^Stopp-Frage aus dem Review von #2$/);
  assert.match(kommentare(r, "1").join("\n"), /ist das eine Schnittstelle nach aussen\?/);
  assert.ok(!kommentare(r, "2").some((k) => k.startsWith(PRUEFSTAND_ANKER)), "der Pruefstand gehoert zum Halt an der Frage im Body");
});

test("E11: der Nachtbericht nennt beim Halt nach der Prüfung Marker, Einarbeitung und die offene Frage", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: jeStufe({ plan: planAnlegen(MIT_FRAGE), review: reviewMarker }) });
  assert.equal(r.code, 0, r.ausgabe);
  const bericht = kommentare(r, "1").find((k) => k.includes("### Ausgang"));
  assert.ok(bericht, "kein Nachtbericht am Fachplan");
  assert.match(bericht, /Pruefer opus \(2026-09-14, Nachtlauf\), Marker gesetzt\./);
  assert.ok(bericht.includes(EINARBEITUNG_ZEILE_ABGELEHNT), "die Einarbeitung fehlt im Bericht");
  assert.ok(bericht.includes(`### Offene Stopp-Frage\n\n${FRAGE}`), bericht);
});

// --- Neustart am Plan nach der Antwort (Plan #1697, E7, E8, E9, E13, E14; Issue #1701) ---
//
// Der Mensch hat die Frage beantwortet und den Plan mit `kit:night` neu angestossen. Am Plan
// steht der Pruefstand des Halts. Hat die Antwort den Plan nur um sich selbst ergaenzt, entstehen
// die Pakete direkt; hat sie ihn darueber hinaus geaendert, laeuft vorher die Stufe `review`,
// mit den Pruefern aus dem Pruefstand und danach ohne `nachDemReview`.

const MARKER_ALT = "Plan-Review: opus (2026-09-14, Nachtlauf)";
const MARKER_NEU = "Plan-Review: opus (2026-10-16, Nachtlauf)";
const PRUEFER = "fable, gpt-astra";
const ANTWORT = "- E2: Ist der Endpunkt eine Schnittstelle? Gewaehlt: intern. Verworfen: extern. Grund: niemand ruft ihn. Rueckbau: trivial.";

/** Der Plan, wie die Kette ihn beim Halt hinterliess: Marker und offene Frage. */
const HALT_BODY = planBody({ offeneFragen: FRAGE }).replaceAll("__F__", "1")
  .replace("Plan-Modell: fixture-modell", `Plan-Modell: fixture-modell\n${MARKER_ALT}`);

/** Die Antwort des Menschen: ein neuer E-Eintrag, `- Keine.` unter den offenen Fragen. */
const BEANTWORTET = HALT_BODY
  .replace("Rueckbau: trivial.\n\n## Geplante", `Rueckbau: trivial.\n${ANTWORT}\n\n## Geplante`)
  .replace(FRAGE, "- Keine.");

/** Die Antwort und dazu eine geaenderte Zeile unter `## Geplante Änderungen`. */
const GEAENDERT = BEANTWORTET.replace("- src/plan.mjs: eine Funktion.", "- src/plan.mjs: zwei Funktionen.");

/** Der Pruefstand-Kommentar, den der Halt ueber `HALT_BODY` schrieb. */
function pruefstandKommentar(body = HALT_BODY, pruefer = PRUEFER) {
  const stand = pruefstandVon(body);
  return [PRUEFSTAND_ANKER, "", MARKER_ALT, `Prüfer: ${pruefer}`, `Rest: ${stand.rest}`, `Entscheidungen: ${stand.entscheidungen.join(" ")}`, ""].join("\n");
}

/** Fachplan #1 ohne Kennzeichen, Plan #2 als Auftrag mit Pruefstand. */
function neustartKarten(body, { fachBody } = {}) {
  return [
    fachplanKarte("1", { labels: [REVIEW_FERTIG_LABEL], ...(fachBody ? { body: fachBody } : {}) }),
    { ...planKarte("2", "1", { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL], body }), comments: [{ body: pruefstandKommentar() }] },
  ];
}

/** Stufe review beim Neustart: neuer Marker statt des alten, Einarbeitung am Plan; wahlweise eine neue Frage. */
const reviewErneut = (frage = null) => (s) => {
  const id = /^\/issue-review #(\d+)/.exec(s.prompt)[1];
  let body = s.board("issue", "get", id).body.replace(MARKER_ALT, MARKER_NEU);
  if (frage) body = body.replace("## Offene Fragen\n\n- Keine.", `## Offene Fragen\n\n${frage}`);
  s.board("issue", "update", id, "--body", body);
  s.board("issue", "comment", id, "--text", "## Einarbeitung, Runde 1\n\n- Fund 1 (opus, HINWEIS): übernommen.\n");
};

const NEUSTART_SITZUNG = jeStufe({ review: reviewErneut(), pakete: paketeAnlegen });

test("Szenario: Nach der Antwort geht es direkt zu den Arbeitspaketen", async () => {
  const r = await ketteImProzess({ karten: neustartKarten(BEANTWORTET), sitzung: NEUSTART_SITZUNG });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["pakete", "abdeckung"], "keine Review-Sitzung, /issues laeuft");
  const einheit = r.lauf.einheiten.find((e) => e.id === "2");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.pakete.ids.length, 2, "die Pakete entstehen");
  assert.doesNotMatch(r.ausgabe, /Prüfstand ist veraltet/);
});

test("Szenario: Ein durch die Antwort geänderter Plan wird vor dem Schnitt erneut geprüft", async () => {
  const r = await ketteImProzess({ karten: neustartKarten(GEAENDERT), sitzung: NEUSTART_SITZUNG });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["review", "pakete", "abdeckung"], "die Review-Sitzung laeuft vor /issues");
  const review = r.sitzungen.find((s) => s.stufe === "review");
  assert.match(review.prompt, /^\/issue-review #2\n/);
  assert.equal(review.planReviewer, PRUEFER, "KIT_PLAN_REVIEWER kommt aus der Zeile Prüfer: des Pruefstands");
  assert.equal(r.ausgabe.match(/Plan #2: Die Antwort hat den Plan über das Eintragen hinaus geändert/g)?.length, 1, "die Protokollzeile steht genau einmal");
  const einheit = r.lauf.einheiten.find((e) => e.id === "2");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.pakete.ids.length, 2, "die Pakete entstehen nach der Pruefung");
});

test("[1701] E9: ohne Pruefer im Pruefstand gilt die Vorgabe des Projekts", async () => {
  const karten = neustartKarten(GEAENDERT);
  karten[1].comments = [{ body: pruefstandKommentar(HALT_BODY, "") }];
  const r = await ketteImProzess({ karten, sitzung: NEUSTART_SITZUNG });
  assert.equal(r.code, 0, r.ausgabe);
  const review = r.sitzungen.find((s) => s.stufe === "review");
  assert.ok(review, "die Review-Sitzung laeuft");
  assert.equal(review.planReviewer, undefined);
});

test("[1701] E8: veralteter Pruefstand und reviewPakete: false — nach der Pruefung entstehen die Pakete, keine Projektgrenze", async () => {
  const r = await ketteImProzess({ karten: neustartKarten(GEAENDERT), sitzung: NEUSTART_SITZUNG, kette: { uebergaenge: { reviewPakete: false } } });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["review", "pakete", "abdeckung"]);
  const einheit = r.lauf.einheiten.find((e) => e.id === "2");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.ok(!einheit.projektgrenze, "keine Projektgrenze beim Plan-Auftrag");
  assert.doesNotMatch(kommentare(r, "2").join("\n"), /Übergang reviewPakete im Projekt nicht freigegeben/);
});

test("[1701] E13: veralteter Pruefstand und ein wartender Fachplan — keine Sitzung, keine Review-Sitzung", async () => {
  const fachBody = mitEreignis(fachplanBody(), "wartet, bis der Tarif X wählbar ist", "de");
  const r = await ketteImProzess({ karten: neustartKarten(GEAENDERT, { fachBody }), sitzung: NEUSTART_SITZUNG });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.sitzungen, [], "keine Sitzung");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "2")?.ausgang, "uebersprungen");
});

test("[1701] die erneute Pruefung bringt eine neue Frage in den Plan — Halt in Stufe review, /issues startet nicht", async () => {
  const r = await ketteImProzess({
    karten: neustartKarten(GEAENDERT),
    sitzung: jeStufe({ review: reviewErneut(REVIEW_FRAGE), pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(stufenVon(r), ["review"]);
  const einheit = r.lauf.einheiten.find((e) => e.id === "2");
  assert.equal(einheit.ausgang, "angehalten", einheit.grund);
  assert.equal(einheit.grund, "Stopp-Frage im geprüften Plan #2");
  const halt = kommentare(r, "2").find((k) => k.startsWith("## Kette angehalten"));
  assert.ok(halt, "kein Halt-Kommentar am Plan");
  assert.match(halt, /Stufe review, Dokument #2\b/);
  assert.equal(kommentare(r, "2").filter((k) => k.startsWith(PRUEFSTAND_ANKER)).length, 2, "der Halt schreibt einen neuen Pruefstand");
});
