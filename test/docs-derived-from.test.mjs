// Doku zu `--derived-from` und die benannte Luecke (Issue #358).
//
// Geprueft wird bewusst NICHT per Wortfund ueber die ganze Datei: `docs/dokumentation.md`
// hat weit ueber tausend Zeilen, ein `assert.match(DOKU, /derived-from/)` waere schon
// durch eine beilaeufige Erwaehnung irgendwo erfuellt. Dieselbe Hausregel steht im Kopf
// von docs-lebenszyklus.test.mjs. Deshalb schneidet jeder Test hier zuerst den Abschnitt
// heraus, um den es geht, und prueft nur darin.
//
// Der inhaltliche Kern ist die Luecke: Ein Tracker, der das Feld nicht kennt, schluckt
// es still — Exit 0, Karte da, Herkunft weg. Das wird dokumentiert und ausdruecklich
// nicht abgesichert, weil die naheliegende Absicherung (Ruecklesen) genau am
// wichtigsten Fall scheitert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const DOKU = lies("docs", "dokumentation.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");

import { ZUSTAENDE } from "../tools/derived-from-report.mjs";

/**
 * Schneidet den Abschnitt ab einer Ueberschrift bis zur naechsten Ueberschrift
 * gleicher oder hoeherer Ebene. Findet die Ueberschrift nicht statt, schlaegt der
 * Test mit einer Meldung fehl, die den fehlenden Anker nennt — nicht mit einem
 * nichtssagenden Vergleich auf `undefined`.
 */
function abschnitt(text, ueberschrift) {
  const start = text.indexOf(ueberschrift);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${ueberschrift.trim()}`);
  const rest = text.slice(start + ueberschrift.length);
  const ende = rest.search(/\n#{1,4} /);
  return ende >= 0 ? rest.slice(0, ende) : rest;
}

const HERKUNFT = () => abschnitt(DOKU, "\n#### Herkunft am Board: `--derived-from`\n");

test("die Doku beschreibt, was --derived-from sendet", () => {
  const a = HERKUNFT();
  assert.match(a, /--derived-from/, "die Option wird im Abschnitt nicht genannt");
  assert.match(a, /projektweite Kartennummer/i, "die Wertform (projektweite Kartennummer) fehlt");
  assert.match(a, /nächsten Vorfahren|naechsten Vorfahren/i, "der nächste Vorfahr ist nicht benannt");
});

test("die Doku nennt, wer die Option setzt und was die uebrigen Tracker tun", () => {
  const a = HERKUNFT();
  for (const skill of ["/fachplan", "/plan", "/issues"]) {
    assert.ok(a.includes(skill), `der Skill ${skill} ist nicht als Setzer benannt`);
  }
  assert.match(a, /GitHub, GitLab und local|github.*gitlab.*local/i,
    "die uebrigen drei Tracker sind nicht benannt");
  // Auf die Aussage geprueft, nicht auf den Satzbau: "nehmen die Option ... an"
  // ist dieselbe Zusage wie "nehmen sie an".
  assert.match(a, /nehmen .{0,40}\ban\b|angenommen/i, "das Annehmen fehlt");
  assert.match(a, /nicht übertragen|nicht uebertragen|übertragen sie nicht/i,
    "dass sie den Wert nicht uebertragen, fehlt");
});

// Der eigentliche Zweck dieses Issues.
test("die Luecke ist als Luecke benannt, mit Exit 0 und fehlender Herkunft", () => {
  const a = abschnitt(DOKU, "\n#### Die Luecke: ein Tracker ohne das Feld schweigt\n");
  assert.match(a, /Exit 0/, "dass der Aufruf mit Exit 0 endet, fehlt");
  assert.match(a, /still|stillschweigend/i, "das stille Schlucken ist nicht als solches benannt");
  assert.match(a, /Herkunft fehlt|ohne Herkunft|keine Herkunft/i,
    "die Folge (Karte ohne Herkunft) fehlt");
});

test("die Luecke nennt die Begruendung, warum nicht abgesichert wird", () => {
  const a = abschnitt(DOKU, "\n#### Die Luecke: ein Tracker ohne das Feld schweigt\n");
  assert.match(a, /Rücklesen|Ruecklesen|Echo/i, "die verworfene Absicherung ist nicht benannt");
  assert.match(a, /Pool-Idee/, "der Pool-Fall als Grund fehlt");
  assert.match(a, /nicht lesbar|unerreichbar/i,
    "dass die Pool-Idee nicht lesbar ist, fehlt — das ist der ganze Grund");
});

test("die Doku erklaert die Vergaenglichkeit beim Projektwechsel", () => {
  const a = abschnitt(DOKU, "\n#### Warum die Body-Zeilen daneben stehen bleiben\n");
  assert.match(a, /Projektwechsel/, "der Projektwechsel fehlt");
  assert.match(a, /löscht|loescht/i, "dass er die Herkunft loescht, fehlt");
  // Nicht nur die verschobene Karte — auch die, die auf sie zeigen. Das ist der
  // Teil, der beim Lesen ueberrascht und deshalb dastehen muss.
  assert.match(a, /die auf sie zeigen|zeigenden|Kinder/i,
    "dass es auch die verweisenden Karten trifft, fehlt");
  assert.match(a, /Fachliche Quelle: Issue #N/, "die fachliche Body-Zeile ist nicht zitiert");
  assert.match(a, /Plan: Issue #M/, "die Plan-Body-Zeile ist nicht zitiert");
  assert.match(a, /dauerhafte|überleben|ueberleben/i,
    "die Body-Zeilen sind nicht als die dauerhafte Form ausgewiesen");
});

test("die Prozessdatei-Vorlage traegt eine Herkunfts-Konvention", () => {
  const a = abschnitt(VORLAGE, "\nHerkunfts-Konvention:");
  assert.match(a, /--derived-from/, "die Vorlage nennt die Option nicht");
  assert.match(a, /nächsten Vorfahren|naechsten Vorfahren/i,
    "die Vorlage sagt nicht, worauf der Verweis zeigt");
});

// --- Der Trockenlauf: derived-from-report (Issue #366) ---

const AUSWERTEN = () => abschnitt(DOKU, "\n#### Herkunft auswerten: derived-from-report\n");

test("die Doku beschreibt den Aufruf des Trockenlaufs", () => {
  const a = AUSWERTEN();
  assert.match(a, /issue list \| node tools\/derived-from-report\.mjs/,
    "der Pipe-Aufruf fehlt");
  assert.match(a, /--json/, "das Flag --json fehlt");
  assert.match(a, /--help/, "das Flag --help fehlt");
});

test("die Doku sagt, dass nichts geschrieben wird, und warum", () => {
  const a = AUSWERTEN();
  assert.match(a, /schreibt nichts|nichts geschrieben|schreibt weder/i,
    "das Nicht-Schreiben ist nicht benannt");
  assert.match(a, /Schreibpfad/, "der fehlende Schreibpfad als Grund fehlt");
  assert.match(a, /#355/, "der Verweis auf Idee #355 fehlt");
});

test("die Doku nennt beide Fundorte", () => {
  const a = AUSWERTEN();
  assert.match(a, /## Kontext/, "der Fundort des Arbeitspakets fehlt");
  assert.match(a, /\[Plan\]/, "das Plandokument ist nicht als eigener Fall benannt");
  assert.match(a, /Kopfbereich|vor `## Ziel`/,
    "der Kopfbereich als zweiter Fundort fehlt — ohne ihn wirkt fehlplatziert willkuerlich");
});

// Die Namen kommen aus dem Werkzeug, nicht aus einer Liste im Test. Waeren sie hier
// fest verdrahtet, bliebe der Test bei einem siebten Zustand gruen und die Doku still
// zurueck — genau der Fall, den dieses Kriterium verhindern soll.
test("jeder Zustand, den das Werkzeug kennt, steht in der Doku", () => {
  const a = AUSWERTEN();
  for (const zustand of ZUSTAENDE) {
    assert.match(a, new RegExp(`\\b${zustand}\\b`), `der Zustand ${zustand} fehlt in der Doku`);
  }
  // Heutiger Erwartungswert, damit ein versehentliches Leeren von ZUSTAENDE auffaellt.
  assert.equal(ZUSTAENDE.length, 6);
});

// Die Prozessdatei beschreibt den taeglichen Prozess, nicht die einmaligen
// Analysewerkzeuge dieses Repos. Geprueft wird der WERKZEUGNAME — `derived-from`
// allein steht dort seit Issue #358 zu Recht (Herkunfts-Konvention), ein naives
// /derived-from/ waere schon am unveraenderten Bestand rot.
test("die Prozessdatei nennt das Werkzeug nicht", () => {
  assert.doesNotMatch(VORLAGE, /derived-from-report/,
    "die Prozessdatei soll die Analysewerkzeuge dieses Repos nicht fuehren");
  assert.match(VORLAGE, /--derived-from/,
    "die Herkunfts-Konvention aus Issue #358 muss dort weiterhin stehen");
});
