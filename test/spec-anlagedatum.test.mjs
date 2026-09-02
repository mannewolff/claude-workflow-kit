// Das Anlagedatum aus dem Aktivitaetsverlauf (Issue #460, A17).
//
// Diese Tests fahren `check --anker` gegen ein Fixture, dessen Verlauf ueber den
// lokalen Tracker synthetisiert wird — die Auswahlregel selbst haengt aber nicht am
// Tracker, sondern an drei Entscheidungen aus dem Review von #460:
//
//   1. Aeltester heisst KLEINSTES createdAt, nicht eintraege[0].
//   2. Nur CREATED zaehlt — ein MOVED ist kein Anlegen.
//   3. Bei einer Idee zaehlt CREATED, nicht PROMOTED.
//
// Weil der lokale Tracker immer genau einen CREATED-Eintrag liefert, pruefen die
// Faelle 1 bis 3 die Funktion direkt. Das Zusammenspiel mit dem Gate deckt
// test/spec-check-anker.test.mjs ab.

import { test } from "node:test";
import assert from "node:assert/strict";

import { anlagedatum } from "../kit/spec.mjs";

test("aeltester Eintrag heisst kleinstes createdAt, nicht der erste der Liste", () => {
  // Die Antwort kommt bewusst UNSORTIERT (juengster zuerst). Ein `eintraege[0]`
  // bestuende den Test nur, solange der Server aufsteigend sortiert — und pruefte
  // dann die Fixture statt den Code.
  const verlauf = [
    { type: "CREATED", createdAt: "2026-09-01T10:00:00Z" },
    { type: "CREATED", createdAt: "2026-08-14T09:12:33Z" },
    { type: "CREATED", createdAt: "2026-08-30T12:00:00Z" },
  ];
  assert.equal(anlagedatum(verlauf), "2026-08-14");
});

test("nur CREATED zaehlt — ein Verlauf aus MOVED allein hat kein Anlagedatum", () => {
  // Der reale Fall: eine Karte von vor kanban-kit V13 (2026-07-14), die seitdem
  // bewegt wurde. Ihr aeltester Eintrag ist ein MOVED von letzter Woche — wer den
  // naehme, hielte eine alte Karte fuer neu.
  const verlauf = [
    { type: "MOVED", createdAt: "2026-09-01T10:00:00Z" },
    { type: "MOVED", createdAt: "2026-08-20T10:00:00Z" },
  ];
  assert.equal(anlagedatum(verlauf), null);
});

test("bei einer Idee zaehlt CREATED, nicht das spaetere PROMOTED", () => {
  // Eine Karte aus dem Ideen-Pool traegt zuerst „Idee angelegt"; die Board-Nummer
  // kommt erst beim Einplanen. Zaehlte PROMOTED, waere ein Paket, das Wochen im Pool
  // lag, am Tag des Einplanens „neu".
  const verlauf = [
    { type: "PROMOTED", createdAt: "2026-09-02T08:00:00Z" },
    { type: "CREATED", createdAt: "2026-07-20T15:30:00Z" },
  ];
  assert.equal(anlagedatum(verlauf), "2026-07-20");
});

test("der Zeitstempel wird auf den Kalendertag gekuerzt, ohne Zeitzonen-Umrechnung", () => {
  // 23:30 mit Offset +02:00 waere in UTC schon der Folgetag. Uebernommen wird der
  // Tag, den die Plattform nennt — dieselbe Regel wie in createdFrom (Issue #457).
  assert.equal(anlagedatum([{ type: "CREATED", createdAt: "2026-09-02T23:30:00+02:00" }]), "2026-09-02");
  assert.equal(anlagedatum([{ type: "CREATED", createdAt: "2026-09-02T09:12:33Z" }]), "2026-09-02");
});

test("ein leerer oder unbrauchbarer Verlauf hat kein Anlagedatum", () => {
  assert.equal(anlagedatum([]), null);
  assert.equal(anlagedatum(null), null);
  assert.equal(anlagedatum([{ type: "CREATED" }]), null, "Eintrag ohne createdAt");
  assert.equal(anlagedatum([{ type: "CREATED", createdAt: "" }]), null, "leeres createdAt");
});
