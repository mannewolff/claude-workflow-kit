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
import eslintKonfig from "../eslint.config.mjs";

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

// Dritte Gruppe: Zu jeder eingeschalteten Regel dieser Datei sind Fundklasse (Sonar-Kennung)
// und Anlass (Kartennummer) nachlesbar (Issue #970, Fachliche Quelle #966, AK 3).
//
// Die Liste der zu pruefenden Schluessel kommt aus dem geladenen Export, nicht aus einer im
// Test gefuehrten Aufzaehlung: Nur so faengt die Pruefung auch die naechste Regel, die jemand
// aufnimmt. Zwei Schluesselklassen fallen dabei heraus, beide aus dem Export selbst erkennbar
// und nicht aus einer Namensliste:
//   - Schluessel ohne eigene Zeile in dieser Datei stammen aus einem `recommended`-Set. Das
//     Set ist im Kopf begruendet, nicht Regel fuer Regel.
//   - Abgeschaltete Regeln (`off`) fangen keine Fundklasse; sie tragen ihre Begruendung als
//     Prosa im Block darueber.

const ZEILEN = KONFIG.split("\n");

const alsRegex = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

// Alle Regelschluessel aller Bloecke des geladenen Exports.
const regelWerte = new Map();
for (const block of eslintKonfig) {
  for (const [schluessel, wert] of Object.entries(block.rules ?? {})) regelWerte.set(schluessel, wert);
}

// Index der Zeile, die den Schluessel als Schluessel traegt; -1, wenn es keine gibt.
const schluesselZeile = (schluessel) => {
  const muster = new RegExp(String.raw`^\s*"?${alsRegex(schluessel)}"?\s*:`);
  return ZEILEN.findIndex((zeile) => muster.test(zeile));
};

// Prueffenster: die Schluesselzeile plus die zusammenhaengenden `//`-Zeilen darueber
// (Plan #968/E5).
const prueffenster = (index) => {
  let anfang = index;
  while (anfang > 0 && /^\s*\/\//.test(ZEILEN[anfang - 1])) anfang -= 1;
  return ZEILEN.slice(anfang, index + 1).join("\n");
};

const istAbgeschaltet = (wert) => {
  const schwere = Array.isArray(wert) ? wert[0] : wert;
  return schwere === "off" || schwere === 0;
};

test("jede eingeschaltete Regel nennt Fundklasse und Kartennummer an ihrer Zeile", () => {
  const geprueft = [];
  // Alle Maengel werden gesammelt und einmal gemeldet: Wer zwei Regeln ohne Angabe
  // aufnimmt, soll beide in einem Lauf sehen statt die zweite erst nach der ersten Behebung.
  const maengel = [];
  for (const [schluessel, wert] of regelWerte) {
    const index = schluesselZeile(schluessel);
    if (index === -1 || istAbgeschaltet(wert)) continue;
    const fenster = prueffenster(index);
    if (!/\bS\d{3,4}\b/.test(fenster)) {
      maengel.push(`\`${schluessel}\`: keine Sonar-Kennung (Muster S9999) an ihrer Zeile oder im Kommentar unmittelbar darueber`);
    }
    if (!/Issue #\d+/.test(fenster)) {
      maengel.push(`\`${schluessel}\`: keine Kartennummer (Muster \`Issue #N\`) an ihrer Zeile oder im Kommentar unmittelbar darueber`);
    }
    geprueft.push(schluessel);
  }
  assert.ok(maengel.length === 0, `Regeln ohne Fundklasse oder Anlass:\n- ${maengel.join("\n- ")}`);
  assert.ok(
    geprueft.length >= 12,
    `nur ${geprueft.length} Regelzeilen geprueft — erwartet mindestens die 12 aus dem Bestand; die Suche nach der Schluesselzeile greift nicht mehr`,
  );
});

test("die beiden bekannten Luecken stehen, und keine Bereichsdifferenz wird als Luecke bezeichnet", () => {
  steht(/Ergebnisse von `filter`\/`map` bleiben unbewacht/, "die bekannte Luecke von S6959 fehlt");
  steht(/Syntaktisch statt typbasiert/, "der Geltungsbereich von S2871 als bekannte Luecke fehlt");
  assert.ok(
    !/Luecke: keine bekannte/.test(KONFIG),
    "Pflichtzeile `Luecke: keine bekannte` an Regeln ohne bekannte Luecke (Plan #968/E7 verwirft sie)",
  );
  assert.ok(
    !/(sonar\.sources|Ausnahmeliste)[^\n]*L(ue|ü)cke|L(ue|ü)cke[^\n]*(sonar\.sources|Ausnahmeliste)/.test(KONFIG),
    "die Differenz zwischen Lint-Bereich und `sonar.sources` ist als Luecke bezeichnet (Plan #968/E6: sie ist ein Ueberschuss der Abdeckung)",
  );
});
