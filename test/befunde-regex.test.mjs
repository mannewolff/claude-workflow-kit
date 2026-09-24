// Haelt die Bedeutung der sechs Ausdruecke aus kit/befunde.mjs fest, die SonarQube als
// super-linear meldet (S8786, Issue #877) — und bei STAND_RE zusaetzlich als zu komplex
// (S5843, Komplexitaet 31 statt 20).
//
// Die Ausdruecke lesen Review-Kommentare: Dekoration am Zeilenende, die Pflichtzeilen
// 'Gegenprobe:' und 'Art:', den Stand am Ende der Gegenprobe, den Uebernahmevermerk und
// den Reviewer-Kopf. Eine stille Bedeutungsaenderung verschoebe die Zaehlung der Funde,
// ohne dass irgendwo ein Fehler auftauchte.
//
// Diese Tests liefen gegen den Stand VOR dem Umbau gruen (gemessen am 2026-09-24 gegen
// die gekapselte Alt-Fassung) und muessen es danach bleiben. Die Laufzeitproben am Ende
// waren gegen diesen Stand rot — sie sind der Grund des Umbaus.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  angabenWert,
  ohneDekoHinten,
  reviewerRolle,
  standVon,
} from "../kit/befunde.mjs";

// --- 1. DEKO_HINTEN_RE: /[\s*_#]+$/ ---

test("ohneDekoHinten zieht Leerraum, Sterne, Unterstriche und Rauten am Ende ab", () => {
  assert.equal(ohneDekoHinten("**WICHTIG — Titel**"), "**WICHTIG — Titel");
  assert.equal(ohneDekoHinten("#### BLOCKER ###"), "#### BLOCKER");
  assert.equal(ohneDekoHinten("Titel  \t"), "Titel");
  assert.equal(ohneDekoHinten("a_b_"), "a_b");
  // Unveraendert bleibt, was nicht auf Dekoration endet.
  assert.equal(ohneDekoHinten("Titel"), "Titel");
  assert.equal(ohneDekoHinten("kit/board.mjs:12"), "kit/board.mjs:12");
  // Randfaelle: nur Dekoration, leerer Text, und `\s` schliesst den Umbruch ein.
  assert.equal(ohneDekoHinten("***"), "");
  assert.equal(ohneDekoHinten(""), "");
  assert.equal(ohneDekoHinten("Zeile\n  "), "Zeile");
  assert.equal(ohneDekoHinten("Zeile\r"), "Zeile", String.raw`ein \r aus CRLF faellt mit ab`);
});

// --- 2./3./4. GEGENPROBE_RE, ART_RE, UEBERNAHME_RE: /^Kopf\s*:\s*(.*)$/ ---

test("angabenWert liest den Wert hinter dem Doppelpunkt", () => {
  assert.equal(angabenWert("Gegenprobe: Ein zweiter Ort in skills/", "Gegenprobe"),
    "Ein zweiter Ort in skills/");
  assert.equal(angabenWert("Art: doppelung", "Art"), "doppelung");
  assert.equal(angabenWert("Uebernahme: uebernommen", "Uebernahme", "Übernahme"), "uebernommen");
  assert.equal(angabenWert("Übernahme: abgelehnt", "Uebernahme", "Übernahme"), "abgelehnt");
});

test("angabenWert: Leerraum um den Doppelpunkt zaehlt nicht, der hinter dem Wert schon", () => {
  // Der Vertrag der alten Ausdruecke, Zeichen fuer Zeichen: `\s*` vor und hinter dem
  // Doppelpunkt faellt weg, `(.*)` reicht bis zum Zeilenende — nachlaufender Leerraum
  // gehoert also zum Wert. Das Stutzen machen die Aufrufer (`artName`, `trim`).
  assert.equal(angabenWert("Gegenprobe : x", "Gegenprobe"), "x");
  assert.equal(angabenWert("Gegenprobe\t:\tx", "Gegenprobe"), "x");
  assert.equal(angabenWert("Art:   doppelung  ", "Art"), "doppelung  ");
  assert.equal(angabenWert("Art:doppelung", "Art"), "doppelung");
});

test("angabenWert: der leere Wert ist ein Wert, die fehlende Zeile ist null", () => {
  // Der Unterschied traegt `fehlendeAngaben`: 'Gegenprobe:' ohne Text ist eine
  // vorhandene, aber leere Angabe — und wird als fehlende Beobachtung gemeldet, nicht
  // als fehlende Zeile.
  assert.equal(angabenWert("Gegenprobe:", "Gegenprobe"), "");
  assert.equal(angabenWert("Gegenprobe:   ", "Gegenprobe"), "");
  assert.equal(angabenWert("Titel ohne Angabe", "Gegenprobe"), null);
  assert.equal(angabenWert("", "Gegenprobe"), null);
});

test("angabenWert verlangt genau den Kopf am Zeilenanfang", () => {
  // 'Gegenprobe am Bestand:' ist bewusst kein Treffer — die Form verlangt genau die
  // eine Zeile, und eine grosszuegigere Erkennung liesse die Altform erfuellt aussehen.
  assert.equal(angabenWert("Gegenprobe am Bestand: x", "Gegenprobe"), null);
  assert.equal(angabenWert("Meine Gegenprobe: x", "Gegenprobe"), null);
  assert.equal(angabenWert("gegenprobe: x", "Gegenprobe"), null, "Kleinschreibung zaehlt nicht");
  assert.equal(angabenWert("Arten: doppelung", "Art"), null);
  assert.equal(angabenWert("Uebernahme: x", "Übernahme"), null, "nur die genannten Koepfe");
});

test("angabenWert liest eine Zeile — der Aufrufer zerlegt vorher", () => {
  // Die einzige Stelle, an der der Umbau die Antwort aendert, und sie ist im Bestand
  // nicht erreichbar: Alle Aufrufer geben Zeilen aus `text.split("\n")` oder
  // `fund.zeilen`. Der alte Ausdruck endete auf `(.*)$` ohne m-Flag und gab auf einem
  // mehrzeiligen Text darum `null` zurueck; die Zerlegung liest den Rest. Geschuetzt ist
  // die Funktion also nicht durch ihre Form, sondern durch diesen Vertrag — wer ihn
  // spaeter bricht, faellt hier auf.
  assert.equal(angabenWert("Art: doppelung\nnoch eine Zeile", "Art"), "doppelung\nnoch eine Zeile");
  assert.equal(angabenWert("Art: doppelung", "Art"), "doppelung", "der Vertragsfall bleibt unveraendert");
});

// --- 5. STAND_RE ---

test("standVon erkennt beide Staende an beiden Strichformen", () => {
  assert.equal(standVon("Beobachtung — geprueft, bestaetigt").bestaetigt, true);
  assert.equal(standVon("Beobachtung — geprüft, bestätigt").bestaetigt, true);
  assert.equal(standVon("Beobachtung – geprueft, bestaetigt.").bestaetigt, true, "Halbgeviertstrich");
  assert.equal(standVon("Beobachtung - geprueft, bestaetigt").bestaetigt, true, "Bindestrich");
  // Der zweite Ast: geprueft wurde nicht, ein Stand steht trotzdem da.
  assert.equal(standVon("Beobachtung — nicht geprueft").bestaetigt, false);
  assert.equal(standVon("Beobachtung — nicht geprüft.").bestaetigt, false);
  // Kein Stand.
  assert.equal(standVon("Beobachtung ohne Stand"), null);
  assert.equal(standVon("Beobachtung — teilweise geprueft"), null);
  assert.equal(standVon(""), null);
});

test("standVon ist unempfindlich gegen Gross-, Klein- und Leerraumschreibung", () => {
  assert.equal(standVon("x — GEPRUEFT, BESTAETIGT").bestaetigt, true);
  assert.equal(standVon("x — Geprüft , Bestätigt .").bestaetigt, true);
  assert.equal(standVon("x —geprueft,bestaetigt").bestaetigt, true);
  assert.equal(standVon("x — NICHT GEPRÜFT").bestaetigt, false);
  assert.equal(standVon("x — nicht   geprueft  .  ").bestaetigt, false);
  // 'nicht' braucht mindestens ein Leerzeichen zum Wort — anders als die uebrigen Fugen.
  assert.equal(standVon("x — nichtgeprueft"), null);
});

test("standVon findet den Strich, an dem der Stand beginnt — nicht den ersten der Zeile", () => {
  // Der Fall aus dem Kopfkommentar von `gegenprobeTeile`: Die Beobachtung traegt selbst
  // einen Gedankenstrich. Geteilt wird am Stand-Suffix, also am zweiten.
  const rest = "Ein zweiter Ort in skills/ — kein Treffer. — geprueft, bestaetigt";
  assert.equal(standVon(rest).index, rest.lastIndexOf("—"));
  assert.equal(rest.slice(0, standVon(rest).index).trim(), "Ein zweiter Ort in skills/ — kein Treffer.");
});

test("standVon zaehlt nur den Stand am Zeilenende", () => {
  assert.equal(standVon("x — geprueft, bestaetigt, aber unklar"), null);
  assert.equal(standVon("x — nicht geprueft, weil zu teuer"), null);
});

// --- 6. REVIEWER_RE ---

test("reviewerRolle liest die Rolle vor dem Komma", () => {
  assert.equal(reviewerRolle("Reviewer 1: Architekt, opus"), "Architekt");
  assert.equal(reviewerRolle("Reviewer 12 : Pruefer der Form, fable"), "Pruefer der Form");
  assert.equal(reviewerRolle("Reviewer 2:Sicherheit,codex"), "Sicherheit");
  assert.equal(reviewerRolle("Reviewer  3:  Rolle , modell"), "Rolle", "der Aufrufer bekam sie schon immer gestutzt");
});

test("reviewerRolle: was kein Reviewer-Kopf ist", () => {
  assert.equal(reviewerRolle("Reviewer 1: nur eine Rolle ohne Komma"), null);
  assert.equal(reviewerRolle("Reviewer: Architekt, opus"), null, "ohne Nummer kein Kopf");
  assert.equal(reviewerRolle("Zweiter Reviewer 1: Architekt, opus"), null, "nur am Zeilenanfang");
  assert.equal(reviewerRolle("Art: doppelung, zweifach"), null);
  assert.equal(reviewerRolle(""), null);
});

// --- Laufzeitproben ---------------------------------------------------------
//
// Die Wahl der Eingabe ist der Kern jeder dieser Proben, wie schon in Issue #406
// aufgeschrieben: Ein Text, der sofort scheitert, misst kein Backtracking. Gebraucht
// wird ein Text, bei dem ein PRAEFIX passt und der Rest scheitert.
//
// Gemessen wird gegen die Funktionen des Bestands, nicht gegen kopierte Literale: Eine
// Kopie driftet ab, sobald der Ausdruck sich aendert, und misst dann etwas, das niemand
// mehr aufruft.

const GROSS = 64 * 1024;
const GRENZE_MS = 100;

function dauer(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

const PROBEN = [
  // Dekoration, dann eine lange Leerraum-Schleppe, dann ein Zeichen, an dem `$` scheitert.
  ["ohneDekoHinten", (n) => `Titel${" ".repeat(n)}x`, (t) => ohneDekoHinten(t)],
  // Der Kopf passt, dann Leerraum, dann ein Zeichen und erst DAHINTER der Umbruch: So
  // scheitert `$`, und `\s*` und `(.*)` probierten jede Grenze zwischen sich durch. Mit
  // dem Umbruch direkt hinter dem Leerraum traefe der Ausdruck sofort und maesse nichts.
  ["angabenWert", (n) => `Gegenprobe:${" ".repeat(n)}x\ny`, (t) => angabenWert(t, "Gegenprobe")],
  // Der Stand beginnt, aber hinter dem Leerraum steht noch ein Zeichen: `\s*\.?\s*$`
  // ueberlappte sich selbst und probierte jede Aufteilung durch.
  ["standVon", (n) => `x — geprueft, bestaetigt${" ".repeat(n)}z`, (t) => standVon(t)],
  // Der Reviewer-Kopf passt, das Komma fehlt: `\s*` und `[^,]+` akzeptierten dieselben
  // Zeichen.
  ["reviewerRolle", (n) => `Reviewer 1:${" ".repeat(n)}`, (t) => reviewerRolle(t)],
];

for (const [name, bau, lauf] of PROBEN) {
  test(`${name} bleibt beim Worst-Case unter ${GRENZE_MS} ms`, (t) => {
    const text = bau(GROSS);
    const ms = dauer(() => lauf(text));
    t.diagnostic(`${name}: ${ms.toFixed(2)} ms bei 64 KiB`);
    assert.ok(ms < GRENZE_MS, `${name}: ${ms.toFixed(1)} ms bei 64 KiB — erwartet unter ${GRENZE_MS} ms`);
  });
}
