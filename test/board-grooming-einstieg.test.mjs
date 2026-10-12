// Einstieg ins Grooming und Stopp-Kommentar (Issue #1511, Plan #1510 A5, E6, E7, E13):
// `groomEinstieg` prueft die Gruende in fester Reihenfolge, `stoppKommentar` sucht den
// juengsten Einarbeitungs-Kommentar ueber das Namensregister.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { groomEinstieg, stoppKommentar, KETTE_HALT_ANKER as GROOMING_HALT_ANKER } from "../kit/board/grooming.mjs";
import { KETTE_HALT_ANKER } from "../kit/night/kette.mjs";
import { spracheFestlegen } from "../kit/board/namen.mjs";

afterEach(() => spracheFestlegen(null));

const OFFEN = "## Ziel\nz\n\n## Offene Fragen an den PO\n1. Frage?\n";
const VERMERK = "## Ziel\nz\n\n## Offene Fragen an den PO\nKeine. Die 1 Frage hat der PO am 2026-10-10 entschieden, die Antwort steht unter der Frage.\n\n1. Frage?\n   **Antwort (PO, 2026-10-10):** Ja.\n";
const VERMERK_UND_OFFEN = `${VERMERK}2. Folgefrage?\n`;

const karte = ({ id = "42", title = "[Fachlich] Export", body = OFFEN, labels = ["review:fertig"] } = {}) => ({ id, title, body, labels });
const OHNE_AUFSICHT = {};

test("kein Fachplan: jede andere Karte wird abgewiesen", () => {
  for (const title of ["[Plan] Export", "[Idee] Export", "Export als Paket", "[Task] Export"]) {
    const e = groomEinstieg(karte({ title }), OHNE_AUFSICHT);
    assert.equal(e.start, false, title);
    assert.equal(e.grund, "kein-fachplan", title);
    assert.ok(e.meldung, `${title}: eine Meldung`);
  }
});

test("[Requirement] gilt als Fachplan (Gegenprobe)", () => {
  assert.deepEqual(groomEinstieg(karte({ title: "[Requirement] Export" }), OHNE_AUFSICHT), { start: true, grund: null });
});

test("kein-fachplan geht vor unbeaufsichtigt", () => {
  assert.equal(groomEinstieg(karte({ title: "[Plan] x" }), { KIT_AGENT_MODEL: "opus" }).grund, "kein-fachplan");
});

test("unbeaufsichtigt bei gesetztem, nicht leerem KIT_AGENT_MODEL", () => {
  const e = groomEinstieg(karte(), { KIT_AGENT_MODEL: "claude-opus-5-5" });
  assert.equal(e.start, false);
  assert.equal(e.grund, "unbeaufsichtigt");
  assert.ok(e.meldung);
});

test("leeres KIT_AGENT_MODEL zaehlt nicht als unbeaufsichtigt", () => {
  assert.equal(groomEinstieg(karte(), { KIT_AGENT_MODEL: "" }).start, true);
  assert.equal(groomEinstieg(karte(), { KIT_AGENT_MODEL: "   " }).start, true);
});

test("unbeaufsichtigt geht vor ungeprueft", () => {
  assert.equal(groomEinstieg(karte({ labels: [] }), { KIT_AGENT_MODEL: "x" }).grund, "unbeaufsichtigt");
});

test("ungeprueft ohne review:fertig und kit:klaeren, mit dem Satz zum Pruefen", () => {
  const e = groomEinstieg(karte({ id: "77", labels: ["kit:nightrun"] }), OHNE_AUFSICHT);
  assert.equal(e.start, false);
  assert.equal(e.grund, "ungeprueft");
  assert.match(e.meldung, /zuerst prüfen lassen \(`\/issue-review #77`\)/);
});

test("ungeprueft: Meldung in einem englischen Projekt", () => {
  spracheFestlegen("en");
  const e = groomEinstieg(karte({ id: "77", labels: [] }), OHNE_AUFSICHT);
  assert.equal(e.grund, "ungeprueft");
  assert.match(e.meldung, /`\/issue-review #77`/);
  assert.doesNotMatch(e.meldung, /prüfen/);
});

test("review:fertig oder kit:klaeren genuegt fuer den Start, auch englisch", () => {
  for (const labels of [["review:fertig"], ["kit:klaeren"], ["review:done"], ["kit:clarify"], [{ name: "review:fertig" }]]) {
    assert.deepEqual(groomEinstieg(karte({ labels }), OHNE_AUFSICHT), { start: true, grund: null }, JSON.stringify(labels));
  }
});

test("nichts-offen: Vermerk steht und kein kit:klaeren", () => {
  for (const labels of [["review:fertig"], ["review:done"]]) {
    const e = groomEinstieg(karte({ body: VERMERK, labels }), OHNE_AUFSICHT);
    assert.equal(e.start, false);
    assert.equal(e.grund, "nichts-offen");
    assert.ok(e.meldung);
    assert.equal(e.hinweis, undefined, "ohne offene Frage kein Hinweis");
  }
});

test("nichts-offen mit hinweis, wenn unter dem Vermerk eine Frage ohne Antwortzeile steht (E13)", () => {
  const e = groomEinstieg(karte({ body: VERMERK_UND_OFFEN }), OHNE_AUFSICHT);
  assert.equal(e.grund, "nichts-offen");
  assert.match(e.hinweis, /Folgefrage\?/);
  assert.match(e.hinweis, /1/);
});

test("Vermerk mit kit:klaeren: der Ablauf beginnt", () => {
  for (const labels of [["kit:klaeren"], ["kit:clarify", "review:fertig"]]) {
    assert.deepEqual(groomEinstieg(karte({ body: VERMERK, labels }), OHNE_AUFSICHT), { start: true, grund: null });
  }
});

test("ohne env liest groomEinstieg process.env nicht stillschweigend als unbeaufsichtigt, wenn leer", () => {
  assert.equal(groomEinstieg(karte(), { KIT_AGENT_MODEL: undefined }).start, true);
});

// --- stoppKommentar ---

const kommentar = (id, body, createdAt = `2026-10-1${id}T08:00:00Z`) => ({ id: String(id), author: "M", body, createdAt });

test("juengster Einarbeitungs-Kommentar mit Id, Datum und Text", () => {
  const r = stoppKommentar([
    kommentar(1, "## Fachplan-Review, Runde 1\n\nFunde"),
    kommentar(2, "## Einarbeitung, Runde 1\n\nalt"),
    kommentar(3, "## Fachplan-Review, Runde 2\n\nFunde"),
    kommentar(4, "## Einarbeitung, Runde 2\n\nStopp-Frage: Welche Zielgruppe?"),
    kommentar(5, "## Laufstand\n\nStand: x"),
  ]);
  assert.deepEqual(r, {
    kommentar: { id: "4", datum: "2026-10-14T08:00:00Z", text: "## Einarbeitung, Runde 2\n\nStopp-Frage: Welche Zielgruppe?" },
    grund: null,
  });
});

test("englischer Einarbeitungs-Kommentar ## Incorporation, Round <n>", () => {
  const r = stoppKommentar([kommentar(1, "## Incorporation, Round 1\n\nStop question")]);
  assert.equal(r.kommentar.id, "1");
  assert.equal(r.grund, null);
});

test("der Anker zaehlt nur als erste Zeile", () => {
  const r = stoppKommentar([kommentar(1, "Vorrede\n## Einarbeitung, Runde 1\n")]);
  assert.equal(r.kommentar, null);
  assert.ok(r.grund);
});

test("ohne Einarbeitungs-Kommentar: null mit Grund", () => {
  for (const comments of [[], undefined, [kommentar(1, "## Fachplan-Review, Runde 1\n")]]) {
    const r = stoppKommentar(comments);
    assert.equal(r.kommentar, null);
    assert.equal(typeof r.grund, "string");
    assert.ok(r.grund.length > 0);
  }
});

test("ein juengerer ## Kette angehalten daneben: null mit Grund (E6)", () => {
  const r = stoppKommentar([
    kommentar(1, "## Einarbeitung, Runde 1\n\nStopp"),
    kommentar(2, `${KETTE_HALT_ANKER}\n\nDie Kette haelt an.`),
  ]);
  assert.equal(r.kommentar, null);
  assert.match(r.grund, /Kette angehalten/);
});

test("ein aelterer ## Kette angehalten stoert nicht", () => {
  const r = stoppKommentar([
    kommentar(1, `${KETTE_HALT_ANKER}\n\nalt`),
    kommentar(2, "## Einarbeitung, Runde 1\n\nStopp"),
  ]);
  assert.equal(r.kommentar.id, "2");
});

test("Kommentare als reine Texte werden ebenso gelesen", () => {
  const r = stoppKommentar(["## Einarbeitung, Runde 1\n\nStopp"]);
  assert.deepEqual(r.kommentar, { id: null, datum: null, text: "## Einarbeitung, Runde 1\n\nStopp" });
});

test("Gleichlauf: der Halt-Anker ist der, den die Nacht-Kette schreibt", () => {
  assert.equal(GROOMING_HALT_ANKER, KETTE_HALT_ANKER);
});
