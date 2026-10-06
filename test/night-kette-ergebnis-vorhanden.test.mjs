// Jede Kettenstufe erkennt ihr vorhandenes Ergebnis (Plan #1079, E2, E9, E10, E11; Issue #1086).
//
// Vor jeder Stufe und nach jedem Abbruch prueft die Kette am Board, ob das Ergebnis der
// Stufe schon vorliegt, statt vorher und nachher zu vergleichen. Ist es da, endet die
// Stufe `fertig` mit `vorgefunden: true`, und es startet keine Session. `kit:night` an
// der Karte ist damit die Geste fuer den Wiedereinstieg: Die Kette beginnt bei der ersten
// Stufe ohne Ergebnis.
//
// Seit Issue #1233 im selben Prozess (`ketteImProzess`, Plan #1199, E6). Belegfall 2 — die
// Review-Session am Zeitlimit — braucht den echten Prozess und steht in
// `ablauf-night-kette-ergebnis-vorhanden.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paketUmgesetzt } from "../kit/night/kette.mjs";
import {
  ketteImProzess, fachplanKarte, planKarte, planBody, paketBody, GLATT, KETTE_LABEL,
} from "./helpers/kette-fixture.mjs";
import { REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";

const MARKER = "Plan-Review: opus (2026-09-28, Nachtlauf)";
const F = "1";
const P = "2";

/** Ein Plan zum Fachplan F, wie ihn ein frueherer Lauf hinterliess — ohne Kettenlabel. */
function planVorhanden(id, { marker = false, status = "backlog" } = {}) {
  const body = marker ? planBody().replace("Plan-Modell: fixture-modell", `Plan-Modell: fixture-modell\n${MARKER}`) : planBody();
  return planKarte(id, F, { body, status });
}

/** Zwei Arbeitspakete zum Plan P, wie /issues sie anlegte. */
const paketeVorhanden = (ids, { status = "backlog" } = {}) => ids.map((id, i) => ({
  id, title: `Paket ${i + 1}`, status, labels: [], body: paketBody(P, F, { n: i + 1, aufgabe: `Paket ${i + 1}.` }),
}));

/** Die Karte F mit dem Laufstand, den ein frueherer Lauf hinterliess; `fertig` traegt kein Label. */
function mitLaufstand(karte, zustand, text) {
  const label = zustand === "fertig" ? [] : [`lauf:${zustand}`];
  return { ...karte, labels: [...karte.labels, ...label], comments: [{ body: `## Laufstand\n\n${text}` }] };
}

const einheitVon = (r, id) => {
  const einheit = r.lauf.einheiten.find((e) => e.id === id);
  assert.ok(einheit, `keine Einheit fuer #${id}`);
  return einheit;
};

const kommentare = (r, id) => r.karte(id).comments.map((c) => c.body).join("\n");

test("[night-ergebnis] kit:night an einem Fachplan mit fertigem Plan startet bei review", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte(F), planVorhanden(P)], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["review", "pakete", "abdeckung"]);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.plan.id, P);
  assert.equal(einheit.stufen.plan.vorgefunden, true);
  assert.equal(r.karten.filter((i) => /^\[Plan\]/.test(i.title)).length, 1, "kein zweiter Plan");
  assert.equal("vorgefunden" in einheit.stufen.review, false, "die Stufe review lief selbst");
});

test("[night-ergebnis] Plan mit Pruefvermerk: plan und review vorgefunden, keine Session dafuer", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte(F), planVorhanden(P, { marker: true })], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["pakete", "abdeckung"]);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.plan.vorgefunden, true);
  assert.equal(einheit.stufen.review.vorgefunden, true);
  assert.equal(einheit.stufen.review.marker, true);
  assert.equal(einheit.stufen.plan.id, P);
});

test("[night-ergebnis] Laufstand 'pakete fertig fuer #M': pakete vorgefunden, nur die Abdeckung laeuft", async () => {
  const fach = mitLaufstand(fachplanKarte(F), "abgebrochen",
    `zuletzt begonnen: abdeckung begonnen für #${P} um 2026-09-28T03:00:00.000Z\nzuletzt abgeschlossen: pakete fertig für #${P} um 2026-09-28T02:50:00.000Z`);
  const r = await ketteImProzess({ karten: [fach, planVorhanden(P, { marker: true }), ...paketeVorhanden(["3", "4"])], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["abdeckung"]);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.pakete.vorgefunden, true);
  assert.deepEqual(einheit.stufen.pakete.ids, ["3", "4"]);
  assert.equal(r.karten.filter((i) => /^Paket /.test(i.title)).length, 2, "keine doppelten Pakete");
});

test("[night-ergebnis] Laufstand 'abdeckung fertig fuer #M': die ganze Kette ist vorgefunden, keine Session", async () => {
  const fach = mitLaufstand(fachplanKarte(F), "fertig",
    `zuletzt begonnen: abdeckung begonnen für #${P} um 2026-09-28T03:00:00.000Z\nzuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z`);
  const r = await ketteImProzess({ karten: [fach, planVorhanden(P, { marker: true }), ...paketeVorhanden(["3", "4"])], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen, []);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  for (const s of ["plan", "review", "pakete", "abdeckung"]) assert.equal(einheit.stufen[s].vorgefunden, true, `Stufe ${s}`);
});

test("[night-ergebnis] Variante B: Pakete in In review mit Nachweis sind vorgefunden, keine Umsetzungs-Session", async () => {
  const fachB = fachplanKarte(F, { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "kit:durchziehen"] });
  const fach = mitLaufstand(fachB, "abgebrochen", `zuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z`);
  const r = await ketteImProzess({
    karten: [fach, planVorhanden(P, { marker: true }), ...paketeVorhanden(["3", "4"], { status: "in_review" })],
    kette: { uebergaenge: { abdeckungUmsetzung: true } },
    sitzung: GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen, []);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.variante, "B");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.umsetzung.vorgefunden, true);
});

test("[night-ergebnis] Umsetzung: In review ohne gueltigen Nachweis zaehlt nicht als vorgefunden", () => {
  const mangel = "Nachtlauf: Nachweis fehlt — die Session hat keine Pruefung gefahren. Die Karte bleibt in In review und der Commit unangetastet — bitte den Stand pruefen.";
  assert.equal(paketUmgesetzt({ status: "in_review", comments: [] }), true);
  assert.equal(paketUmgesetzt({ status: "done", comments: [] }), true);
  assert.equal(paketUmgesetzt({ status: "in_review", comments: [{ body: mangel }] }), false);
  assert.equal(paketUmgesetzt({ status: "in_review", comments: [{ body: "Nachtlauf: Nachweis rot — npm test endete rot. Die Karte bleibt …" }] }), false);
  assert.equal(paketUmgesetzt({ status: "backlog", comments: [] }), false);
  assert.equal(paketUmgesetzt({ status: "ready", comments: [] }), false);
  assert.equal(paketUmgesetzt(null), false);
});

test("[night-ergebnis] ein vorgefundener Plan bekommt keinen Ueberholt-Kommentar, auch keiner in Done", async () => {
  const alt = planVorhanden(P, { status: "done" });
  const r = await ketteImProzess({ karten: [fachplanKarte(F), alt, planVorhanden("3", { marker: true })], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  const einheit = einheitVon(r, F);
  assert.equal(einheit.stufen.plan.id, "3");
  assert.equal("ueberholt" in einheit, false);
  assert.doesNotMatch(kommentare(r, "3"), /Ueberholt durch Plan/);
  assert.doesNotMatch(kommentare(r, P), /Ueberholt durch Plan/);
});

test("[night-ergebnis] ein Plan in Done zaehlt nicht als vorgefunden: die Stufe plan laeuft", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte(F), planVorhanden(P, { marker: true, status: "done" })], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
  const einheit = einheitVon(r, F);
  assert.notEqual(einheit.stufen.plan.id, P);
  assert.equal("vorgefunden" in einheit.stufen.plan, false);
});

for (const status of ["ready", "in_review"]) {
  test(`[night-ergebnis] ein Plan in ${status} zaehlt als vorgefunden`, async () => {
    const r = await ketteImProzess({ karten: [fachplanKarte(F), planVorhanden(P, { status })], sitzung: GLATT });
    assert.equal(r.code, 0, r.ausgabe);

    assert.equal(r.sitzungen[0]?.stufe, "review");
    const einheit = einheitVon(r, F);
    assert.equal(einheit.stufen.plan.id, P);
    assert.equal(einheit.stufen.plan.vorgefunden, true);
  });
}

test("[night-ergebnis] Teilschnitt im Laufstand: abgebrochen mit den Paketen, kein Versuch", async () => {
  const fach = mitLaufstand(fachplanKarte(F), "abgebrochen",
    `zuletzt begonnen: pakete begonnen für #${P} um 2026-09-28T02:40:00.000Z\nzuletzt abgeschlossen: review fertig für #${P} um 2026-09-28T02:30:00.000Z`);
  const r = await ketteImProzess({ karten: [fach, planVorhanden(P, { marker: true }), ...paketeVorhanden(["3", "4"])], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen, [], "kein Versuch");
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.equal(einheit.grund, "Teilschnitt vorhanden (#3, #4) — eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night");
  assert.equal(r.karten.filter((i) => /^Paket /.test(i.title)).length, 2);
  assert.ok(r.karte(F).labels.includes("lauf:abgebrochen"), `Labels: ${r.karte(F).labels}`);
  assert.match(kommentare(r, F), /Teilschnitt vorhanden/);
});

test("[night-ergebnis] Teilschnitt im Journal eines frueheren Laufs: abgebrochen, kein Versuch", async () => {
  const zeilen = [
    { art: "lauf", zeit: "2026-09-28T02:00:00.000Z", pid: 999999, text: "begonnen" },
    { art: "stand", nr: 1, zeit: "2026-09-28T02:40:00.000Z", karte: F, zustand: "laeuft", text: `zuletzt begonnen: pakete begonnen für #${P} um 2026-09-28T02:40:00.000Z`, status: "offen" },
    { art: "quittung", nr: 1, zeit: "2026-09-28T02:40:01.000Z" },
    { art: "lauf", zeit: "2026-09-28T02:45:00.000Z", pid: 999999, text: "abgebrochen, SIGTERM" },
  ];
  const r = await ketteImProzess({
    karten: [fachplanKarte(F), planVorhanden(P, { marker: true }), ...paketeVorhanden(["3", "4"])],
    sitzung: GLATT,
    vorher: ({ dir }) => {
      mkdirSync(join(dir, ".claude", "lauf"), { recursive: true });
      writeFileSync(join(dir, ".claude", "lauf", "2026-09-28-020000.jsonl"), zeilen.map((z) => JSON.stringify(z)).join("\n") + "\n");
    },
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen, []);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /Teilschnitt vorhanden \(#3, #4\)/);
});

test("[night-ergebnis] Pakete ohne jeden Laufstand-Eintrag: die Stufe pakete laeuft wie bisher (Issue #895)", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte(F), planVorhanden(P, { marker: true }), ...paketeVorhanden(["3", "4"])], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["pakete", "abdeckung"]);
  const einheit = einheitVon(r, F);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal("vorgefunden" in einheit.stufen.pakete, false);
});

test("[night-ergebnis] der Laufstand je Stufe steht an der Karte, die die Kette traegt", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte(F)], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  const plan = einheitVon(r, F).stufen.plan.id;
  const karte = r.karte(F);
  assert.ok(!karte.labels.some((l) => l.startsWith("lauf:")), `nach dem Ende haengt kein Laufstand-Label: ${karte.labels}`);
  const staende = karte.comments.map((c) => c.body).filter((k) => k.startsWith("## Laufstand"));
  assert.equal(staende.length, 1, "genau ein Laufstand-Kommentar");
  assert.match(staende[0], new RegExp(`abdeckung fertig für #${plan}\\b`));
  // Das Journal fuehrt den Verlauf: Beginn und Ende jeder Stufe.
  const journal = r.journal.map((z) => String(z.text ?? "")).join("\n");
  for (const eintrag of [`plan begonnen für #${F}`, `plan fertig für #${F}`, `review fertig für #${plan}`, `pakete begonnen für #${plan}`, `pakete fertig für #${plan}`]) {
    assert.ok(journal.includes(eintrag), `Journal ohne '${eintrag}'`);
  }
});
