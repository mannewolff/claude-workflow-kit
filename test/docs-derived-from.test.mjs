// Doku zu `--derived-from` und die benannte Luecke.
//
// Geprueft wird bewusst NICHT per Wortfund ueber die ganze Datei: Ein
// `assert.match(DOKU, /derived-from/)` waere schon durch eine beilaeufige Erwaehnung
// irgendwo erfuellt. Dieselbe Hausregel steht im Kopf
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

// Die Einrichtungsseite traegt Option, Luecke und Body-Zeilen in einem Abschnitt (Plan
// #1652, A8). Das Analysewerkzeug `tools/derived-from-report.mjs` gehoert zum Repo, nicht
// zum installierten Kit; seine Beschreibung steht in seinem `--help`.
const DOKU = lies("docs", "einrichtung.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");

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

const HERKUNFT = () => abschnitt(DOKU, "\n### Herkunft am Board: `--derived-from`\n");

test("die Doku beschreibt, was --derived-from sendet", () => {
  const a = HERKUNFT();
  assert.match(a, /--derived-from/, "die Option wird im Abschnitt nicht genannt");
  assert.match(a, /projektweite Kartennummer/i, "die Wertform (projektweite Kartennummer) fehlt");
  assert.match(a, /nächsten Vorfahren|naechsten Vorfahren/i, "der nächste Vorfahr ist nicht benannt");
});

test("die Doku nennt, wer die Option setzt und was die uebrigen Tracker tun", () => {
  const a = HERKUNFT();
  for (const skill of ["/requirement", "/task", "/techplan", "/issues"]) {
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

// `/task` ist der zweite Nie-Setzer neben `/requirement` — aber aus einem anderen Grund:
// Die fachliche Anforderung ist die WURZEL einer Kette, ein `[Task]` steht ueberhaupt in
// keiner (Issue #574). Geprueft wird deshalb nicht bloss die Anwesenheit des Namens,
// sondern die Begruendung daneben. Ohne sie liest die naechste Sitzung das `nie` als
// Versehen und setzt das Flag aus Gewohnheit.
test("[skills-7] die Doku fuehrt /task als Nie-Setzer, mit dem fehlenden Vorfahren als Grund", () => {
  const a = HERKUNFT();
  const zeile = a.split("\n").find((z) => z.includes("`/task`"));
  assert.ok(zeile, "`/task` steht in keiner Zeile des Abschnitts");
  assert.match(zeile, /\bnie\b/, "die Zeile zu `/task` sagt nicht, dass die Option nie gesetzt wird");
  assert.match(zeile, /kein(?:en)? Vorfahr/, "der Grund (kein Vorfahr) fehlt in der Zeile zu `/task`");
});

test("[skills-7] die Prozessdatei-Vorlage fuehrt /task ebenfalls als Nie-Setzer", () => {
  const a = abschnitt(VORLAGE, "\nHerkunfts-Konvention:");
  assert.match(a, /`\/task` nie \(kein Vorfahr\)/,
    "die Vorlage nennt `/task` nicht als Nie-Setzer mit Begruendung");
});

// Der eigentliche Zweck dieses Issues.
test("die Luecke ist als Luecke benannt, mit Exit 0 und fehlender Herkunft", () => {
  const a = HERKUNFT();
  assert.match(a, /Exit 0/, "dass der Aufruf mit Exit 0 endet, fehlt");
  assert.match(a, /still|stillschweigend/i, "das stille Schlucken ist nicht als solches benannt");
  assert.match(a, /Herkunft fehlt|ohne Herkunft|keine Herkunft/i,
    "die Folge (Karte ohne Herkunft) fehlt");
});

test("die Luecke nennt die Begruendung, warum nicht abgesichert wird", () => {
  const a = HERKUNFT();
  assert.match(a, /Rücklesen|Ruecklesen|Echo/i, "die verworfene Absicherung ist nicht benannt");
  assert.match(a, /Pool-Idee/, "der Pool-Fall als Grund fehlt");
  assert.match(a, /nicht lesbar|unerreichbar/i,
    "dass die Pool-Idee nicht lesbar ist, fehlt — das ist der ganze Grund");
});

test("die Doku erklaert die Vergaenglichkeit beim Projektwechsel", () => {
  const a = HERKUNFT();
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
