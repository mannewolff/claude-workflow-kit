// Herkunfts-Leser: naechster Vorfahr aus einem Karten-Body (Issue #364).
//
// Die Verweise stehen als Body-Zeilen `Plan: Issue #M` und `Fachliche Quelle: Issue #N`.
// Zwei Dinge machen das schwerer, als es aussieht:
//
//  1. ZWEI FUNDORTE. Arbeitspakete tragen die Zeilen im Abschnitt `## Kontext`,
//     Plandokumente im Kopfbereich vor `## Ziel` — die haben gar keinen Kontext.
//     Ein Leser, der nur den Kontext kennt, uebersaehe jede Zwischenstufe der Kette.
//  2. CODE-FENCES. In diesem Repo handeln Issues regelmaessig vom Issue-Format selbst
//     und zeigen die Zeilen als Beispiel. Genau daran ist `parseDeps` in Issue #308
//     gescheitert; das Schadensbild geht in beide Richtungen und faellt am Board nie
//     auf.
//
// Dazu die Falle, die der Issue-Review gefunden hat: Ohne Normalisierung der
// Zeilenenden liefen die verankerten Ausdruecke bei einem CRLF-Body ins Leere und
// JEDE Karte fiele stumm auf `keiner`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { herkunftAusBody } from "../tools/derived-from-report.mjs";
import { kontextGrenzen } from "../kit/board.mjs";

/** Kurzschreibweise: nur was der Leser braucht. */
const karte = (body, { id = "1", title = "Ein Arbeitspaket" } = {}) => ({ id, title, body });

const KONTEXT = (...zeilen) => ["## Kontext", "", ...zeilen, "", "## Aufgabe", "", "Text."].join("\n");

// --- der Regelfall an beiden Fundorten ---

test("Arbeitspaket mit Plan-Zeile im Kontext liefert den Vorfahren", () => {
  const r = herkunftAusBody(karte(KONTEXT("Autor-Modell: m", "Plan: Issue #363")));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

test("Plandokument mit Fachlicher Quelle im Kopfbereich liefert den Vorfahren", () => {
  const body = ["Plan-Modell: m", "Fachliche Quelle: Issue #285", "", "## Ziel", "", "Text."].join("\n");
  const r = herkunftAusBody(karte(body, { title: "[Plan] Ein Plandokument" }));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 285);
});

test("Karte ohne jede Verweiszeile ist keiner", () => {
  const r = herkunftAusBody(karte(KONTEXT("Autor-Modell: m")));
  assert.equal(r.zustand, "keiner");
  assert.equal(r.vorfahr, null);
});

// Ohne Normalisierung laufen die verankerten Ausdruecke leer und die Karte faellt
// stumm auf `keiner` — der teuerste Fund des Issue-Reviews.
test("CRLF-Zeilenenden aendern nichts am Ergebnis", () => {
  const body = KONTEXT("Autor-Modell: m", "Plan: Issue #363").replace(/\n/g, "\r\n");
  const r = herkunftAusBody(karte(body));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

// --- Vorrang und Mehrdeutigkeit ---

test("beide Zeilen: die Plan-Nummer gewinnt, ohne Warnung", () => {
  const r = herkunftAusBody(karte(KONTEXT("Plan: Issue #363", "Fachliche Quelle: Issue #285")));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

// Vorrang gilt VOR Mehrdeutigkeit: Der naechste Vorfahr ist gefragt; was in der
// ferneren Ebene widerspruecklich steht, aendert daran nichts.
test("eindeutige Plan-Zeile schlaegt widersprueckliche Fachliche Quellen", () => {
  const r = herkunftAusBody(karte(KONTEXT(
    "Plan: Issue #363",
    "Fachliche Quelle: Issue #285",
    "Fachliche Quelle: Issue #999",
  )));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

test("zwei Plan-Zeilen mit verschiedenen Nummern sind mehrdeutig", () => {
  const r = herkunftAusBody(karte(KONTEXT("Plan: Issue #363", "Plan: Issue #354")));
  assert.equal(r.zustand, "mehrdeutig");
  assert.equal(r.vorfahr, null);
});

test("zwei identische Plan-Zeilen sind kein Widerspruch", () => {
  const r = herkunftAusBody(karte(KONTEXT("Plan: Issue #363", "Plan: Issue #363")));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

// Gleichheit numerisch, wie parseDeps es mit Number(...) und Set haelt.
test("fuehrende Nullen sind derselbe Wert", () => {
  const r = herkunftAusBody(karte(KONTEXT("Plan: Issue #07", "Plan: Issue #7")));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 7);
});

test("vorfahr ist eine Zahl, kein String", () => {
  const r = herkunftAusBody(karte(KONTEXT("Plan: Issue #363")));
  assert.equal(typeof r.vorfahr, "number");
});

// --- Fences ---

// Eine gefencte Zeile existiert fuer den Leser gar nicht — auch nicht als
// Fehlplatzierung. Sonst kollidierten zwei Regeln an derselben Stelle.
test("Verweiszeile nur im Fence ausserhalb des Kontexts ist keiner, nicht fehlplatziert", () => {
  const body = [
    "## Kontext", "", "Autor-Modell: m", "", "## Aufgabe", "",
    "So sieht die Konvention aus:", "", "```", "Plan: Issue #363", "```", "",
  ].join("\n");
  const r = herkunftAusBody(karte(body));
  assert.equal(r.zustand, "keiner");
  assert.equal(r.vorfahr, null);
});

test("gefencte Zeile neben gueltiger Zeile im Kontext: die Kontext-Nummer gilt", () => {
  const body = [
    "## Kontext", "", "Plan: Issue #363", "", "## Aufgabe", "",
    "```", "Plan: Issue #999", "```", "",
  ].join("\n");
  const r = herkunftAusBody(karte(body));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

// Die Fence-Regel gilt an BEIDEN Enden (Issue #308): Eine ##-Zeile im Fence
// beendet den Abschnitt nicht.
test("eine ##-Zeile im Fence beendet den Kontext-Abschnitt nicht", () => {
  const body = [
    "## Kontext", "", "```", "## Aufgabe", "```", "", "Plan: Issue #363", "",
    "## Aufgabe", "", "Text.",
  ].join("\n");
  const r = herkunftAusBody(karte(body));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

test("eine ##-Zeile im Fence beendet den Kopfbereich eines Plandokuments nicht", () => {
  const body = [
    "Plan-Modell: m", "", "```", "## Ziel", "```", "",
    "Fachliche Quelle: Issue #285", "", "## Ziel", "", "Text.",
  ].join("\n");
  const r = herkunftAusBody(karte(body, { title: "[Plan] Mit Beispielblock" }));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 285);
});

// --- fehlplatziert ---

test("Verweiszeile im Fliesstext trotz vorhandenem Kontext ist fehlplatziert", () => {
  const body = [
    "## Kontext", "", "Autor-Modell: m", "", "## Aufgabe", "", "Plan: Issue #363", "",
  ].join("\n");
  const r = herkunftAusBody(karte(body));
  assert.equal(r.zustand, "fehlplatziert");
  assert.equal(r.vorfahr, null);
});

test("Arbeitspaket ganz ohne Kontext-Abschnitt: Verweiszeile ist fehlplatziert", () => {
  const body = ["## Aufgabe", "", "Plan: Issue #363", "", "Text."].join("\n");
  const r = herkunftAusBody(karte(body));
  assert.equal(r.zustand, "fehlplatziert");
  assert.equal(r.vorfahr, null);
});

test("Arbeitspaket ganz ohne Kontext-Abschnitt und ohne Zeile ist keiner", () => {
  const r = herkunftAusBody(karte(["## Aufgabe", "", "Text."].join("\n")));
  assert.equal(r.zustand, "keiner");
});

test("Plandokument mit der Zeile unterhalb von ## Ziel ist fehlplatziert", () => {
  const body = ["Plan-Modell: m", "", "## Ziel", "", "Fachliche Quelle: Issue #285", ""].join("\n");
  const r = herkunftAusBody(karte(body, { title: "[Plan] Zeile zu tief" }));
  assert.equal(r.zustand, "fehlplatziert");
  assert.equal(r.vorfahr, null);
});

// Spiegelbild des Fence-Falls: Ein Streuner draussen macht einen gueltigen Verweis
// drinnen nicht kaputt.
test("gueltige Zeile im Kontext plus Streuner im Fliesstext: die Kontext-Nummer gilt", () => {
  const body = [
    "## Kontext", "", "Plan: Issue #363", "", "## Aufgabe", "", "Plan: Issue #999", "",
  ].join("\n");
  const r = herkunftAusBody(karte(body));
  assert.equal(r.zustand, "vorfahr");
  assert.equal(r.vorfahr, 363);
});

// --- Praefix-Erkennung ---

test("das [Plan]-Praefix wird wie im Bestand erkannt", () => {
  const kopf = ["Fachliche Quelle: Issue #285", "", "## Ziel", "", "Text."].join("\n");
  for (const titel of ["[Plan] Normal", "[plan] Kleingeschrieben", "  [PLAN] Mit Leerraum", "[Plan]Ohne Leerzeichen"]) {
    const r = herkunftAusBody(karte(kopf, { title: titel }));
    assert.equal(r.zustand, "vorfahr", `Titel "${titel}" wurde nicht als Plandokument erkannt`);
  }
});

test("ein Praefix mitten im Titel zaehlt nicht", () => {
  // Als Arbeitspaket gelesen: Der Kopfbereich gilt nicht, es gibt keinen Kontext,
  // also ist die Zeile fehlplatziert.
  const kopf = ["Fachliche Quelle: Issue #285", "", "## Ziel", "", "Text."].join("\n");
  const r = herkunftAusBody(karte(kopf, { title: "Text ueber [Plan] im Titel" }));
  assert.equal(r.zustand, "fehlplatziert");
});

// --- der Export aus board.mjs ---

test("kontextGrenzen ist aus kit/board.mjs importierbar", () => {
  const text = "## Kontext\n\nPlan: Issue #363\n\n## Aufgabe\n";
  const grenzen = kontextGrenzen(text);
  assert.ok(grenzen, "kontextGrenzen liefert keine Grenzen");
  assert.match(text.slice(grenzen.start, grenzen.ende), /Plan: Issue #363/);
});
