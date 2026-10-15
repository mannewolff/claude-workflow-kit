// Die Nacht-Kette haelt an einer offenen Frage im Plan erst nach der Pruefung an
// (Plan #1697, E1, E2, E3, E5, E11; Issue #1700).
//
// Die Stufe `plan` laeuft an einer offenen Frage durch, die Stufe `review` prueft den Plan,
// und erst danach haelt die Kette an — vor dem Schnitt in Pakete. Am Ende der Review-Sitzung
// liest `stufeReview` zuerst `stoppFragenGrund` am Body, dann `hatKlaerenLabel`; beim Halt
// vermerkt sie den Pruefstand am Plan. Das gilt auch, wenn erst die Pruefung die Frage
// in den Plan bringt (K7).

import { test } from "node:test";
import assert from "node:assert/strict";
import { hatLabel } from "./helpers/labels.mjs";
import { PRUEFSTAND_ANKER, REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, planBody, reviewHalt, reviewMarker, reviewMitFrage, paketeAnlegen,
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
