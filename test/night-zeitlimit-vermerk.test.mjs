// Der Vermerk, den ein Zeitabbruch am Arbeitspaket hinterlaesst (Issue #976, Plan #974).
//
// Am Zeitlimit wird die Sitzung samt Prozessgruppe gekillt. Was der Morgen an der Karte
// liest, entscheidet, ob er den Abbruch von einem inhaltlichen Fehlschlag unterscheiden
// kann — darum ist der Text hier eine reine Funktion und an Fixtures pruefbar, dieselbe
// Linie wie `wartendVermerk` in `night-wartende-session.test.mjs`.
//
// Die Grenze im Vermerk ist das WIRKSAME Zeitlimit der Runde und nicht `args.timeoutMin`:
// Ein Lauf unter `NIGHT_TIMEOUT_MS` lauge den Vermerk sonst an. Dass `runSession` es
// fuehrt, ist darum Teil dieses Pakets und steht am Ende der Datei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { zeitlimitVermerk, ZEITLIMIT_ANKER, runSession } from "../kit/night.mjs";

/** Die Form, die `fortschrittBeobachter().ergebnis()` liefert (Issue #975). */
const auskunft = (zeilen, gesehen = zeilen.length) => ({ zeilen, gesehen });

const ZEILEN = ["FORTSCHRITT: AK1 — Testdatei liegt rot", "FORTSCHRITT: AK2 — Vermerk gebaut"];

test("[night-976-1] der Vermerk traegt den Anker als erste Zeile", () => {
  const text = zeitlimitVermerk(60, auskunft(ZEILEN));
  assert.equal(ZEITLIMIT_ANKER, "## Nachtlauf: Zeitgrenze erreicht");
  assert.equal(text.split("\n")[0], ZEITLIMIT_ANKER);
});

test("[night-976-2] der Grund steht woertlich da, samt Grenze in Minuten", () => {
  const text = zeitlimitVermerk(45, auskunft(ZEILEN));
  assert.match(text, /Grund: Session am Zeitlimit beendet/);
  assert.match(text, /45 Minuten/);
});

test("[night-976-3] der Vermerk sagt, dass dies kein inhaltlicher Fehlschlag ist", () => {
  const text = zeitlimitVermerk(60, auskunft(ZEILEN));
  assert.match(text, /kein inhaltlicher Fehlschlag/);
});

test("[night-976-4] die Auskunft der Sitzung steht unter eigener Ueberschrift", () => {
  const text = zeitlimitVermerk(60, auskunft(ZEILEN));
  assert.match(text, /### Stand nach eigener Auskunft der Sitzung/);
  for (const zeile of ZEILEN) assert.ok(text.includes(zeile), `die Zeile "${zeile}" fehlt im Vermerk`);
});

test("[night-976-5] eine leere Auskunft meldet, dass die Sitzung nichts gesagt hat", () => {
  const text = zeitlimitVermerk(60, auskunft([]));
  assert.match(text, /### Stand nach eigener Auskunft der Sitzung/);
  assert.match(text, /keine Auskunft der Sitzung/);
  assert.ok(!text.includes("nicht beobachtet"), "nichts gemeldet ist nicht dasselbe wie nicht beobachtet");
});

test("[night-976-6] ohne Strom steht 'nicht beobachtet' und nicht derselbe Satz wie bei leerer Auskunft", () => {
  const text = zeitlimitVermerk(60, null);
  assert.match(text, /Fortschritt nicht beobachtet \(kein Strom\)/);
  assert.ok(!text.includes("keine Auskunft der Sitzung"),
    "nicht beobachtet ist nicht dasselbe wie nichts gemeldet — dieselbe Regel wie 'nicht gemessen' statt 0");
});

test("[night-976-7] eine gekuerzte Liste weist ihre Kuerzung aus", () => {
  const voll = zeitlimitVermerk(60, auskunft(ZEILEN, 2));
  assert.ok(!/14 gemeldet/.test(voll));
  const gekuerzt = zeitlimitVermerk(60, auskunft(ZEILEN, 14));
  assert.match(gekuerzt, /14/, "die Gesamtzahl bleibt sichtbar, sonst saehe eine gekappte Liste wie die ganze aus");
});

test("[night-976-8] die Empfehlung ist als Empfehlung gekennzeichnet und nie als Aufgabe formuliert", () => {
  const text = zeitlimitVermerk(60, auskunft(ZEILEN));
  assert.match(text, /### Naechster Schritt \(Mensch\)/);
  assert.match(text, /Empfehlung \(keine Vorgabe\)/);
  assert.match(text, /teil/i, "die Empfehlung nennt die Teilung des Pakets");
  assert.match(text, /entscheidet ein Mensch|ein Mensch entscheidet/i);
});

test("[night-976-9] der Ursachen-Vorbehalt steht im Vermerk", () => {
  const text = zeitlimitVermerk(60, auskunft(ZEILEN));
  assert.match(text, /Ursache/i);
  assert.match(text, /keine Aussage|folgt nicht/i);
});

test("[night-976-10] der Abschnitt zum Arbeitsverzeichnis fehlt ohne Pfade und steht mit ihnen", () => {
  const ohne = zeitlimitVermerk(60, auskunft(ZEILEN));
  assert.ok(!ohne.includes("### Im Arbeitsverzeichnis"), "eine Meldung ueber nichts ist keine");

  const mit = zeitlimitVermerk(60, auskunft(ZEILEN), ["kit/night.mjs", "test/x.test.mjs"]);
  assert.match(mit, /### Im Arbeitsverzeichnis/);
  assert.ok(mit.includes("kit/night.mjs"));
  assert.ok(mit.includes("test/x.test.mjs"));
});

test("[night-976-13] eine nicht bekannte Grenze wird benannt statt erfunden", () => {
  const text = zeitlimitVermerk(null, auskunft(ZEILEN));
  assert.match(text, /Grund: Session am Zeitlimit beendet/);
  assert.ok(!/null|undefined|NaN/.test(text), "eine fehlende Grenze erscheint nie als Wert");
  assert.match(text, /Grenze nicht bekannt/);
});

test("[night-976-14] eine nicht ganze Grenze steht mit einer Nachkommastelle", () => {
  assert.match(zeitlimitVermerk(1.5, auskunft(ZEILEN)), /1\.5 Minuten/);
});

// --- Das wirksame Zeitlimit im Ergebnis von `runSession` ---

const ARGS = { model: "fixture-modell", timeoutMin: 7, yolo: false, verbose: false };

test("[night-976-11] runSession fuehrt das wirksame Zeitlimit in seinem Ergebnis", async () => {
  process.env.NIGHT_CLAUDE_CMD = "true";
  delete process.env.NIGHT_TIMEOUT_MS;
  try {
    const res = await runSession("976", ARGS, {});
    assert.equal(res.timeoutMs, 7 * 60 * 1000, "ohne Sonderwert gilt args.timeoutMin");
  } finally {
    delete process.env.NIGHT_CLAUDE_CMD;
  }
});

test("[night-976-12] ein gesetztes NIGHT_TIMEOUT_MS kommt im Ergebnis an", async () => {
  process.env.NIGHT_CLAUDE_CMD = "true";
  process.env.NIGHT_TIMEOUT_MS = "90000";
  try {
    const res = await runSession("976", ARGS, {});
    assert.equal(res.timeoutMs, 90000,
      "die Grenze im Vermerk ist die wirksame — sonst luegt ein Test unter NIGHT_TIMEOUT_MS den Vermerk an");
  } finally {
    delete process.env.NIGHT_CLAUDE_CMD;
    delete process.env.NIGHT_TIMEOUT_MS;
  }
});
