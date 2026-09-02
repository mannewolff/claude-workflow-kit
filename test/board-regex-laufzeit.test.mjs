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

import {
  parsePruefvorgabe,
  fenceLauf,
  nurAutorZeileTrifft,
  autorModellSicherstellen,
  pruefvorgabeStand,
  AUTOR_MODELL_ZEILE,
  SPEC_WIRKUNG_UEBERSCHRIFT,
} from "../kit/board.mjs";
import { REVIEW_MARKER_ZEILE } from "../kit/night.mjs";

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

// --- Die drei quadratischen Ausdruecke aus Issue #406 ---
//
// Diese drei liefen ueber den GANZEN Body, nicht ueber eine Zeile aus
// `.split("\n")` — der Aufrufvertrag aus #396 schuetzte sie also nicht. Gemessen
// am 2026-08-31 vor dem Umbau: 18,5 s / 19,2 s / 22,1 s bei 256 KiB, mit
// vierfacher Eingabe sechzehnfacher Laufzeit.
//
// Die Wahl der Eingabe ist der Kern jeder dieser Proben: Ein Text, der sofort
// scheitert, misst kein Backtracking. Gebraucht wird ein Text, bei dem ein
// PRAEFIX passt und der Rest scheitert — erst dann probiert die Engine jede
// Aufteilung durch. Ein erster Anlauf mit sofort scheiternden Eingaben blieb bei
// allen fuenf unter 1 ms und war wertlos.
//
// Gemessen wird gegen die Funktionen des Bestands, nicht gegen kopierte
// Literale: Eine Kopie driftet ab, sobald der Ausdruck sich aendert, und misst
// dann etwas, das niemand mehr aufruft.

const SEHR_GROSS = 256 * 1024;

test("nurAutorZeileTrifft bleibt bei 256 KiB Leerraum hinter der Autor-Zeile schnell", () => {
  // Die Autor-Zeile trifft, dann folgen 256 KiB Leerzeichen und eine zweite
  // Zeile, an der das Ende scheitert. Genau hier ueberlappten sich `[^\n]*` und
  // `\s*` im alten `^\s*...\s*$`.
  const body = `Autor-Modell: x${" ".repeat(SEHR_GROSS)}\ny`;
  const ms = dauer(() => nurAutorZeileTrifft(body));
  assert.equal(nurAutorZeileTrifft(body), false, "der Rest muss scheitern, sonst misst die Probe nichts");
  assert.ok(ms < GRENZE_MS, `${ms.toFixed(1)} ms fuer 256 KiB — erwartet unter ${GRENZE_MS} ms`);
});

test("autorModellSicherstellen bleibt bei 256 KiB Leerzeilen im Kontext schnell", () => {
  // Der Trim-Replace `\n+$` laeuft ueber den Kontext-Abschnitt. Er endet hier
  // auf `x`, also findet der Ausdruck nie einen Treffer und probierte frueher
  // jede Startposition durch.
  const body = `## Kontext\n${"\n".repeat(SEHR_GROSS)}x`;
  const ms = dauer(() => autorModellSicherstellen(body, "opus"));
  assert.ok(ms < GRENZE_MS, `${ms.toFixed(1)} ms fuer 256 KiB — erwartet unter ${GRENZE_MS} ms`);
});

test("pruefvorgabeStand bleibt bei 256 KiB Leerzeilen schnell", () => {
  // Ohne Kontext-Abschnitt geht der ganze Text in den Trim-Replace
  // `^\n+|\n+$`. Er endet auf `x` — kein Treffer, jede Startposition wurde
  // durchprobiert.
  const body = `## Aufgabe\n${"\n".repeat(SEHR_GROSS)}x`;
  const ms = dauer(() => pruefvorgabeStand(body));
  assert.ok(ms < GRENZE_MS, `${ms.toFixed(1)} ms fuer 256 KiB — erwartet unter ${GRENZE_MS} ms`);
});

// --- AUTOR_MODELL_ZEILE: die Einstufung des Tickets hielt der Messung nicht ---
//
// Issue #406 fuehrte diesen Ausdruck als linear (0,15 ms bei 256 KiB) und wollte
// ihn stehen lassen. Diese Probe zeigt das Gegenteil: 61,6 s. Der Unterschied
// liegt allein in der Eingabe. Gemessen wurde dort mit einer Zeile, die sauber
// endet — dann trifft der Ausdruck sofort. Kommt hinter dem Leerraum aber noch
// ein Zeichen, muss die Engine jede Grenze zwischen Wert und Leerraum
// durchprobieren.
//
// Deshalb faehrt diese Probe MEHRERE Formen statt einer: Welche die teuerste
// ist, sieht man einem Ausdruck nicht an. Genau diese Annahme hat das Ticket an
// dieser Stelle einmal falsch getroffen.

const AUTOR_FORMEN = [
  ["Wert, dann Leerraum bis Zeilenende", (n) => `Autor-Modell: x${" ".repeat(n)}\n`],
  ["Wert, dann Leerraum, dann Zeichen", (n) => `Autor-Modell: x${" ".repeat(n)}z`],
  ["kein Wert, nur Leerraum", (n) => `Autor-Modell:${" ".repeat(n)}`],
  ["Wechsel aus Wort und Leerraum", (n) => `Autor-Modell: ${"x ".repeat(n / 2)}`],
  ["viele Zeilen, keine mit Wert", (n) => "Autor-Modell: \n".repeat(n / 15)],
];

test("AUTOR_MODELL_ZEILE bleibt bei 256 KiB in jeder Worst-Case-Form schnell", (t) => {
  for (const [was, bau] of AUTOR_FORMEN) {
    const text = bau(SEHR_GROSS);
    const ms = dauer(() => AUTOR_MODELL_ZEILE.test(text));
    t.diagnostic(`${was}: ${ms.toFixed(2)} ms bei 256 KiB`);
    assert.ok(ms < GRENZE_MS, `${was}: ${ms.toFixed(1)} ms — erwartet unter ${GRENZE_MS} ms`);
  }
});

// --- REVIEW_MARKER_ZEILE: der eine, der stehen bleibt ---
//
// SonarCloud meldet ihn als S8786, die Messung widerspricht: linear in jeder
// Form, die hier gefahren wird. Er bleibt deshalb unveraendert — diese Probe ist
// der Beleg, auf den sich die `accepted`-Entscheidung in SonarCloud stuetzt.
//
// Warum kein Umschreiben? `[^\S\n]*` ueberlappt zwar mit dem folgenden `\S`,
// aber `\S` ist ein EINZELNES Zeichen, keine zweite Wiederholung, und es folgt
// kein Endanker. Die Engine hat pro Startposition genau einen Ruecksetzpfad
// ueber den Leerraum, kein Kreuzprodukt. Ein Lookahead wie bei FENCE_ZEILE
// haette hier nichts zu verbieten: Die Aufteilung ist bereits eindeutig.

const REVIEW_FORMEN = [
  ["Praefix passt, dann nur Leerraum", (n) => `Issue-Review:${" ".repeat(n)}`],
  ["Leerraum, dann Praefix ohne Wert", (n) => `${" ".repeat(n)}Issue-Review:`],
  ["viele eingerueckte Zeilen ohne Wert", (n) => "   Issue-Review:\n".repeat(n / 18)],
];

test("REVIEW_MARKER_ZEILE ist bei 256 KiB gemessen linear und bleibt unveraendert", (t) => {
  for (const [was, bau] of REVIEW_FORMEN) {
    const text = bau(SEHR_GROSS);
    const ms = dauer(() => REVIEW_MARKER_ZEILE.test(text));
    t.diagnostic(`${was}: ${ms.toFixed(2)} ms bei 256 KiB`);
    assert.ok(ms < GRENZE_MS, `${was}: ${ms.toFixed(1)} ms — erwartet unter ${GRENZE_MS} ms`);
  }
});

// --- SPEC_WIRKUNG_UEBERSCHRIFT: dieselbe Bauart, dieselbe Probe (Issue #443) ---
//
// `[^\S\n]*` vor `$` ist genau die Stelle, an der AUTOR_MODELL_ZEILE teuer war.
// Der Unterschied: Hier folgt keine zweite Wiederholung, die dieselben Zeichen
// akzeptiert — die Aufteilung ist eindeutig, es bleibt ein Ruecksetzpfad ueber
// den Leerraum. Gemessen wird trotzdem, weil man einem Ausdruck nicht ansieht,
// welche Form die teuerste ist; genau diese Annahme hat Issue #406 bei
// AUTOR_MODELL_ZEILE einmal falsch getroffen.
//
// Gemessen gegen die EXPORTIERTE Konstante des Bestands, nicht gegen ein
// kopiertes Literal: Eine Kopie driftet ab, sobald der Ausdruck sich aendert.

const WIRKUNG_FORMEN = [
  // Der einzige Fall, in dem die Engine ueberhaupt zuruecksetzt: Hinter dem
  // Leerraum steht ein Zeichen, an dem `$` scheitert.
  ["Ueberschrift, dann Leerraum, dann Zeichen", (n) => `## Spec-Wirkung${" ".repeat(n)}z`],
  ["Ueberschrift, dann nur Leerraum", (n) => `## Spec-Wirkung${" ".repeat(n)}`],
];

test("SPEC_WIRKUNG_UEBERSCHRIFT bleibt bei 256 KiB in beiden Formen schnell", (t) => {
  for (const [was, bau] of WIRKUNG_FORMEN) {
    const text = bau(SEHR_GROSS);
    const ms = dauer(() => SPEC_WIRKUNG_UEBERSCHRIFT.test(text));
    t.diagnostic(`${was}: ${ms.toFixed(2)} ms bei 256 KiB`);
    assert.ok(ms < GRENZE_MS, `${was}: ${ms.toFixed(1)} ms — erwartet unter ${GRENZE_MS} ms`);
  }
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
