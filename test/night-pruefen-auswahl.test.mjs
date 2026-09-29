// Die Kandidatenwahl des Prueflaufs (Fachplan #899, Plan #904, Issue #906).
//
// Reine Funktionen ueber `issue list`, wie bei der Nacht-Kette: Was das Kennzeichen
// traegt, aber nicht geprueft wird, geht mit Grund nach `uebersprungen` und behaelt sein
// Kennzeichen. Anders als dort gibt es KEINE Spaltenbedingung — ein `[Fachlich]`-Dokument
// geht nie nach Ready, und die Geste gilt der Karte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefLaufAusschluss, waehlePruefLaufKandidaten, KLAEREN_LABEL } from "../kit/night.mjs";

const LABEL = "kit:pruefen";

const karte = (id, title, extra = {}) => ({
  id: String(id), title, status: "backlog", labels: [LABEL], body: "", ...extra,
});

const ids = (r) => r.kandidaten.map((k) => String(k.id));

test("[night-906] eine gekennzeichnete fachliche Anforderung wird geprueft", () => {
  assert.equal(pruefLaufAusschluss(karte(1, "[Fachlich] Eine Anforderung"), LABEL), null);
});

test("[night-906] ohne Kennzeichen kein Ausschlussgrund und kein Kandidat", () => {
  const ohne = karte(1, "[Fachlich] Eine Anforderung", { labels: [] });
  assert.match(pruefLaufAusschluss(ohne, LABEL), /kit:pruefen/,
    "die Funktion nennt das fehlende Kennzeichen als Grund");
  const r = waehlePruefLaufKandidaten([ohne], LABEL, null);
  assert.deepEqual(ids(r), []);
  assert.deepEqual(r.uebersprungen, [],
    "ungekennzeichnete Karten stehen nicht in der Liste der Uebersprungenen");
});

test("[night-906] die Spalte spielt keine Rolle", () => {
  for (const status of ["backlog", "ready", "in_progress", "in_review", "done"]) {
    assert.equal(pruefLaufAusschluss(karte(1, "[Fachlich] X", { status }), LABEL), null, status);
  }
});

test("[night-906] ein Plandokument und ein Arbeitspaket weichen mit dem Hinweis auf die Nicht-Ziele", () => {
  const plan = karte(1, "[Plan] Ein Weg");
  const paket = karte(2, "Irgendein Arbeitspaket");
  const idee = karte(3, "[Idee] Ein Einfall");
  for (const k of [plan, paket, idee]) {
    const grund = pruefLaufAusschluss(k, LABEL);
    assert.match(grund, /fachlich/i, `${k.title}: ${grund}`);
    assert.match(grund, /Plandokumente und Arbeitspakete/, `${k.title}: ${grund}`);
  }
  assert.match(pruefLaufAusschluss(plan, LABEL), /\[Plan\]/);
  assert.match(pruefLaufAusschluss(paket, LABEL), /\[Fachlich\]/);
});

test("[night-906] eine Karte mit kit:klaeren wartet auf einen Menschen", () => {
  const k = karte(1, "[Fachlich] Eine Anforderung", { labels: [LABEL, KLAEREN_LABEL] });
  const grund = pruefLaufAusschluss(k, LABEL);
  assert.match(grund, new RegExp(KLAEREN_LABEL));
  assert.match(grund, /Entscheidung/i);
});

test("[night-906] die Auswahl trennt Kandidaten und Uebersprungene und laesst das Kennzeichen stehen", () => {
  const issues = [
    karte(1, "[Fachlich] Erste"),
    karte(2, "[Plan] Ein Weg"),
    karte(3, "[Fachlich] Zweite", { labels: [LABEL, KLAEREN_LABEL] }),
    karte(4, "[Fachlich] Dritte"),
    karte(5, "[Fachlich] Ohne Kennzeichen", { labels: [] }),
  ];
  const r = waehlePruefLaufKandidaten(issues, LABEL, null);
  assert.deepEqual(ids(r), ["1", "4"]);
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["2", "3"],
    "Uebersprungene stehen in Board-Reihenfolge");
  assert.equal(r.uebersprungen[0].title, "[Plan] Ein Weg");
  assert.ok(r.uebersprungen.every((u) => typeof u.grund === "string" && u.grund.length > 0));
  assert.deepEqual(r.liegengeblieben, []);
});

test("[night-906] max als Zahl laesst die restlichen Kandidaten liegen", () => {
  const issues = [
    karte(1, "[Fachlich] Erste"),
    karte(2, "[Fachlich] Zweite"),
    karte(3, "[Fachlich] Dritte"),
  ];
  const r = waehlePruefLaufKandidaten(issues, LABEL, 2);
  assert.deepEqual(ids(r), ["1", "2"]);
  assert.deepEqual(r.liegengeblieben, [{ id: "3", title: "[Fachlich] Dritte" }]);
  assert.deepEqual(r.uebersprungen, [],
    "liegengeblieben ist kein Ausschluss und taucht nicht doppelt auf");
});

test("[night-906] max null ist kein Deckel", () => {
  const issues = Array.from({ length: 7 }, (_, i) => karte(i + 1, `[Fachlich] Nummer ${i + 1}`));
  const r = waehlePruefLaufKandidaten(issues, LABEL, null);
  assert.equal(r.kandidaten.length, 7);
  assert.deepEqual(r.liegengeblieben, []);
});

test("[night-906] eine leere Liste ist kein Fehler", () => {
  const r = waehlePruefLaufKandidaten([], LABEL, null);
  assert.deepEqual(r, { kandidaten: [], uebersprungen: [], liegengeblieben: [] });
});
