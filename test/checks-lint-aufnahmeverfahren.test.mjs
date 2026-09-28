// Das Aufnahmeverfahren fuer Lint-Regeln steht im Kopf von eslint.config.mjs
// (Issue #969, Plan #968, Fachliche Quelle #966).
//
// Geprueft werden die tragenden Merkmale je Teil, nicht ganze Saetze: Ein Vergleich
// gegen einen hinterlegten Wortlaut macht jede Umformulierung rot und wird dann
// angepasst statt gelesen.
//
// Geprueft wird mit `assert.ok` statt `assert.match`: Bei einem Fehlschlag haengte
// `assert.match` die vollstaendige Konfiguration als `actual` an die Meldung, und die
// eine fehlende Angabe waere darin nicht mehr zu sehen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const KONFIG = readFileSync(join(repoRoot, "eslint.config.mjs"), "utf-8");

const steht = (muster, fehlt) => assert.ok(muster.test(KONFIG), `${fehlt} (eslint.config.mjs)`);

test("der Kopf nennt die Bedingung: zweimal rot oder Wiederkehr nach einer Handbehebung", () => {
  steht(/zweimal/i, "das Zahlwort `zweimal` fehlt im Kopf");
  steht(/Handbehebung/i, "die Wiederkehr nach einer `Handbehebung` fehlt im Kopf");
});

test("das Erreichen der Bedingung loest eine Aufnahmepruefung aus, nicht die Aufnahme", () => {
  steht(/Aufnahmepr(ue|ü)fung/i, "der Kopf nennt keine `Aufnahmepruefung`");
});

test("die Aufnahme laeuft als Arbeitspaket und wirkt erst nach der Freigabe des Menschen", () => {
  steht(/Arbeitspaket/i, "der Kopf nennt den Weg ueber ein Arbeitspaket nicht");
  steht(/Freigabe/i, "der Kopf nennt die Freigabe des Menschen nicht");
});

test("der Kopf nennt die drei Wege fuer die Bestandsfunde", () => {
  steht(/beheben/i, "im Kopf fehlt der Weg `beheben` fuer Bestandsfunde");
  steht(/ausnehmen/i, "im Kopf fehlt der Weg `ausnehmen` fuer Bestandsfunde");
  steht(/Geltungsbereich/i, "im Kopf fehlt der Weg, den `Geltungsbereich` enger zu ziehen");
});

test("die Set-Entscheidung steht mit Datum und Messzahlen in der Konfiguration", () => {
  steht(/2026-09-28/, "das Datum der Set-Entscheidung fehlt");
  for (const zahl of ["8082", "31", "1547", "4805", "1507", "976", "794"]) {
    steht(new RegExp(String.raw`\b${zahl}\b`), `die Messzahl ${zahl} der Set-Entscheidung fehlt`);
  }
});
