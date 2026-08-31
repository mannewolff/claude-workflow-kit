// Laufzeitwaechter fuer die Ausdruecke, die SonarCloud als super-linear meldet (S8786,
// Issue #396).
//
// Gemessen wurde: Mit einem Zeilenumbruch im Eingabetext braucht `/^Pruefung: *(.*?) *$/`
// bei 1 KiB rund 280 ms und ab 4 KiB laenger als zehn Sekunden — die beiden
// Wiederholungen ` *` und `(.*?)` akzeptieren dieselben Zeichen, und `.` kann das `\n`
// nicht ueberspringen, also probiert die Engine jede Aufteilung durch.
//
// Erreichbar ist dieser Fall im Bestand nicht: Beide Ausdruecke laufen ausschliesslich
// ueber Zeilen aus `.split("\n")`, und `normalisiereZeilenenden` hat vorher jedes `\r`
// entfernt. Eine Zeile traegt also nie einen Umbruch. Deshalb bleiben die Ausdruecke
// unveraendert — geschuetzt sind sie aber nicht durch ihre Form, sondern durch diesen
// Aufrufvertrag.
//
// Genau den halten diese Tests fest. Wer die Ausdruecke spaeter auf einen ganzen Body
// loslaesst, faellt hier auf, statt nachts einen Lauf haengen zu lassen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePruefvorgabe, fenceLauf } from "../kit/board.mjs";

const GROSS = 16 * 1024;
const GRENZE_MS = 100;

function dauer(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

test("parsePruefvorgabe bleibt bei einer sehr langen Pruefung-Zeile schnell", () => {
  const body = `## Kontext\nPruefung: 3${" ".repeat(GROSS)}\n`;
  const ms = dauer(() => parsePruefvorgabe(body));
  assert.ok(ms < GRENZE_MS, `${ms.toFixed(1)} ms fuer 16 KiB — erwartet unter ${GRENZE_MS} ms`);
});

test("parsePruefvorgabe bleibt bei einer sehr langen Pruefung-Stand-Zeile schnell", () => {
  // Der Stand muss 64 Hex-Zeichen tragen, sonst weist parsePruefvorgabe ihn ab, bevor
  // die Laufzeit ueberhaupt zaehlt. Die Fuellzeichen stehen dahinter — genau dort, wo
  // sich ` *` und `(.*?)` ueberlappen.
  const stand = "a".repeat(64);
  const body = `## Kontext\nPruefung: 3\nPruefung-Stand: ${stand}${" ".repeat(GROSS)}\n`;
  const ms = dauer(() => parsePruefvorgabe(body));
  assert.ok(ms < GRENZE_MS, `${ms.toFixed(1)} ms fuer 16 KiB — erwartet unter ${GRENZE_MS} ms`);
});

test("fenceLauf bleibt bei einer sehr langen Fence-Zeile schnell", () => {
  const imFence = fenceLauf();
  const zeile = "   " + "`".repeat(GROSS);
  const ms = dauer(() => imFence(zeile));
  assert.ok(ms < GRENZE_MS, `${ms.toFixed(1)} ms fuer 16 KiB — erwartet unter ${GRENZE_MS} ms`);
});

test("die Pruefung-Zeile ohne Wert wird weiterhin erkannt und abgelehnt", () => {
  // Der leere Treffer ist kein Zufall, und er ist teurer als er aussieht: `(.*?)` trifft
  // auch den leeren Wert, und genau daran haengt die Fehlermeldung unten. Ein
  // Umschreiben nach `([^\s].*?)` haette den Treffer genommen — eine `Pruefung:`-Zeile
  // ohne Wert waere dann stillschweigend durchgelaufen, statt abgelehnt zu werden.
  assert.throws(
    () => parsePruefvorgabe("## Kontext\nPruefung:\n"),
    /Erlaubt: 1, 2, 3 oder Verzicht/,
    "die leere Vorgabe muss erkannt und abgelehnt werden"
  );
  assert.equal(parsePruefvorgabe("## Kontext\nPruefung: 3\n").wert, 3);
});
