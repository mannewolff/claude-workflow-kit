// Haelt die Bedeutung der neun Ausdruecke fest, die SonarCloud als super-linear
// meldet (S8786, Issue #403) — bevor sie umgeschrieben werden.
//
// Die Ausdruecke tragen die Erkennung von `Autor-Modell:`, `Pruefung:`,
// `Pruefung-Stand:`, Code-Fences und Review-Markern. Eine stille
// Bedeutungsaenderung traefe den Nachtbetrieb an einer Stelle, an der niemand
// zusieht. Diese Tests liefen gegen den alten Stand gruen und muessen es danach
// bleiben.
//
// Zwei Faelle sind besonders heikel und deshalb ausdruecklich festgehalten:
//   1. `(.*?)` in PRUEFUNG_ZEILE trifft auch den LEEREN Wert — daran haengt die
//      Ablehnung einer `Pruefung:`-Zeile ohne Angabe.
//   2. `\s*` in nurAutorZeile schliesst `\n` ein — ein Body aus Leerzeilen plus
//      Autor-Zeile bekommt die Abschnitts-Vorlage angehaengt (Issue #266).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTOR_MODELL_ZEILE,
  FENCE_ZEILE,
  PRUEFUNG_ZEILE,
  PRUEFUNG_STAND_ZEILE,
  parsePruefvorgabe,
  pruefvorgabeStand,
  autorModellSicherstellen,
  nurAutorZeileTrifft,
} from "../kit/board.mjs";
import { REVIEW_MARKER_ZEILE, RUNDEN_KOPF, hasReviewMarker } from "../kit/night.mjs";

// --- 1. board.mjs: AUTOR_MODELL_ZEILE ---

test("AUTOR_MODELL_ZEILE: Treffer und Nicht-Treffer", () => {
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell: opus")[1], "opus");
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell:   opus   ")[1], "opus");
  assert.equal(AUTOR_MODELL_ZEILE.exec("## Kontext\nAutor-Modell: claude-opus-5\n")[1], "claude-opus-5");
  // Leerer Wert: `\S` verlangt ein Nicht-Leerzeichen — kein Treffer.
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell:"), null);
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell:    "), null);
  assert.equal(AUTOR_MODELL_ZEILE.exec("kein Autor hier"), null);
});

test("AUTOR_MODELL_ZEILE: der Capture reicht vom ersten bis zum letzten Nicht-Leerzeichen", () => {
  // Der Kern des Capture-Vertrags, festgehalten vor dem Umschreiben in Issue
  // #406: Das lazy `(\S[^\n]*?)` mit nachfolgendem `[^\S\n]*$` fasst genau die
  // Spanne vom ersten bis zum letzten Nicht-Leerzeichen der Zeile — INNEN
  // liegender Leerraum gehoert dazu, aussen liegender nicht. Eine Umschreibung,
  // die nur am ersten Wort endet, faellt hier auf.
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell: claude opus 5")[1], "claude opus 5");
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell:   claude  opus   ")[1], "claude  opus");
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell:\tclaude-opus-5\t")[1], "claude-opus-5", "Tabs zaehlen als Leerraum");
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell: x")[1], "x", "ein einzelnes Zeichen");
  // Der Wert endet am Zeilenende, nicht am Bodyende.
  assert.equal(AUTOR_MODELL_ZEILE.exec("Autor-Modell: opus  \nText\n")[1], "opus");
  // Nur die Zeile ab Zeilenanfang zaehlt — `^` mit m-Flag, kein Leerraum davor.
  assert.equal(AUTOR_MODELL_ZEILE.exec("  Autor-Modell: opus"), null, "kein fuehrender Leerraum erlaubt");
  assert.equal(AUTOR_MODELL_ZEILE.exec("x Autor-Modell: opus"), null);
});

// --- 2. board.mjs: PRUEFUNG_ZEILE ---

test("PRUEFUNG_ZEILE: Treffer, Nicht-Treffer und der leere Wert", () => {
  assert.equal(PRUEFUNG_ZEILE.exec("Pruefung: 3")[1].trim(), "3");
  assert.equal(PRUEFUNG_ZEILE.exec("Pruefung: Verzicht")[1].trim(), "Verzicht");
  assert.equal(PRUEFUNG_ZEILE.exec("Pruefung: 2   ")[1].trim(), "2");
  // Der Kern: Der leere Wert MUSS treffen, mit leerem Capture.
  assert.equal(PRUEFUNG_ZEILE.exec("Pruefung:")[1].trim(), "");
  assert.equal(PRUEFUNG_ZEILE.exec("Pruefung:    ")[1].trim(), "");
  assert.equal(PRUEFUNG_ZEILE.exec("Pruefung-Stand: abc"), null);
  assert.equal(PRUEFUNG_ZEILE.exec("  Pruefung: 3"), null, "kein fuehrender Leerraum erlaubt");
});

test("die leere Pruefung-Zeile wird erkannt und abgelehnt", () => {
  assert.throws(
    () => parsePruefvorgabe("## Kontext\nPruefung:\n"),
    /Erlaubt: 1, 2, 3 oder Verzicht/,
    "die leere Vorgabe muss erkannt und abgelehnt werden"
  );
  assert.equal(parsePruefvorgabe("## Kontext\nPruefung: 3\n").wert, 3);
});

// --- 3. board.mjs: PRUEFUNG_STAND_ZEILE ---

test("PRUEFUNG_STAND_ZEILE: Treffer, Nicht-Treffer und der leere Wert", () => {
  const hex = "a".repeat(64);
  assert.equal(PRUEFUNG_STAND_ZEILE.exec(`Pruefung-Stand: ${hex}`)[1].trim(), hex);
  assert.equal(PRUEFUNG_STAND_ZEILE.exec(`Pruefung-Stand: ${hex}   `)[1].trim(), hex);
  assert.equal(PRUEFUNG_STAND_ZEILE.exec("Pruefung-Stand:")[1].trim(), "");
  assert.equal(PRUEFUNG_STAND_ZEILE.exec("Pruefung: 3"), null);
});

test("die leere Pruefung-Stand-Zeile wird erkannt und abgelehnt", () => {
  assert.throws(
    () => parsePruefvorgabe("## Kontext\nPruefung: 3\nPruefung-Stand:\n"),
    /Erwartet: 64 Hex-Zeichen/
  );
});

// --- 4. board.mjs: FENCE_ZEILE ---

test("FENCE_ZEILE: Treffer, Nicht-Treffer und die Einrueckungsgrenze", () => {
  assert.equal(FENCE_ZEILE.exec("```")[1], "```");
  assert.equal(FENCE_ZEILE.exec("~~~~")[1], "~~~~");
  assert.equal(FENCE_ZEILE.exec("```js")[2], "js");
  assert.equal(FENCE_ZEILE.exec("   ```")[1], "```", "bis zu drei Leerzeichen sind erlaubt");
  assert.equal(FENCE_ZEILE.exec("    ```"), null, "vier Leerzeichen sind Code, kein Fence");
  assert.equal(FENCE_ZEILE.exec("``"), null, "zwei Zeichen reichen nicht");
});

// --- 5. board.mjs: der Trim-Replace in setzeAutorModell ---

test("autorModellSicherstellen stutzt Leerzeilen vor und nach der Einfuegestelle", () => {
  const mit = autorModellSicherstellen("## Kontext\nText\n\n\n## Aufgabe\nmehr\n", "opus");
  assert.match(mit, /Text\nAutor-Modell: opus\n\n## Aufgabe/);
  const ohneKontext = autorModellSicherstellen("nur Text", "opus");
  assert.equal(ohneKontext, "Autor-Modell: opus\n\nnur Text");
});

test("der Trim-Replace hinter dem Kontext-Abschnitt: Ein- und Ausgabepaare", () => {
  // Ein-/Ausgabepaare fuer `\n+$` -> `(?<!\n)\n+$` (Issue #406). Der Lookbehind
  // erlaubt nur den Anfang des Newline-Laufs als Startpunkt; das Ergebnis des
  // Ersetzens bleibt dasselbe.
  const paare = [
    // Ein Kontext-Abschnitt ohne Leerzeilen am Ende — nichts zu stutzen.
    ["## Kontext\nText\n## Aufgabe\nmehr\n", "## Kontext\nText\nAutor-Modell: opus\n\n## Aufgabe\nmehr\n"],
    // Mehrere Leerzeilen am Ende des Abschnitts: alle fallen weg.
    ["## Kontext\nText\n\n\n\n\n## Aufgabe\n", "## Kontext\nText\nAutor-Modell: opus\n\n## Aufgabe\n"],
    // Kontext ganz ohne Inhalt: der Lauf beginnt direkt hinter der Ueberschrift.
    ["## Kontext\n\n\n## Aufgabe\n", "## Kontext\nAutor-Modell: opus\n\n## Aufgabe\n"],
    // Letzter Abschnitt im Body: gestutzt wird bis zum Dateiende.
    ["## Kontext\nText\n\n\n", "## Kontext\nText\nAutor-Modell: opus\n\n"],
  ];
  for (const [ein, aus] of paare) {
    assert.equal(autorModellSicherstellen(ein, "opus"), aus, `Eingabe ${JSON.stringify(ein)}`);
  }
});

// --- 6. board.mjs: die Trim-Replaces in pruefvorgabeStand ---

test("pruefvorgabeStand ignoriert fuehrende und folgende Leerzeilen", () => {
  const a = pruefvorgabeStand("## Aufgabe\nText\n");
  const b = pruefvorgabeStand("\n\n## Aufgabe\nText\n\n\n");
  assert.equal(a, b, "gestutzt wird vorn und hinten — derselbe Stand");
  assert.notEqual(a, pruefvorgabeStand("## Aufgabe\nAnderer Text\n"));
});

test("der Trim-Replace in pruefvorgabeStand: dieselben Aequivalenzklassen wie vorher", () => {
  // `^\n+|\n+$` -> `^\n+|(?<!\n)\n+$` (Issue #406). Der Lookbehind aendert nur
  // den Startpunkt des zweiten Zweigs, nicht das Ergebnis. Geprueft wird ueber
  // den Hash: Was vorher denselben Stand ergab, muss ihn weiter ergeben — und
  // was sich unterschied, muss sich weiter unterscheiden.
  const stand = pruefvorgabeStand("## Aufgabe\nText\n");
  const gleich = [
    "## Aufgabe\nText",                 // ohne abschliessenden Umbruch
    "\n## Aufgabe\nText\n",             // eine Leerzeile vorn
    "\n\n\n\n## Aufgabe\nText\n\n\n\n", // viele vorn und hinten
  ];
  for (const ein of gleich) {
    assert.equal(pruefvorgabeStand(ein), stand, `Eingabe ${JSON.stringify(ein)} muss denselben Stand ergeben`);
  }
  // Innenliegende Leerzeilen werden NICHT gestutzt — sie gehoeren zum Inhalt.
  assert.notEqual(pruefvorgabeStand("## Aufgabe\n\nText\n"), stand, "eine Leerzeile mittendrin zaehlt");
  // Ein Body ganz aus Leerzeilen stutzt auf den leeren String — der Sonderfall,
  // in dem der Lauf am Stringanfang beginnt und der Lookbehind trotzdem greift.
  assert.equal(pruefvorgabeStand("\n\n\n"), pruefvorgabeStand(""));
});

// --- 6b. board.mjs: nurAutorZeileTrifft ---

test("nurAutorZeileTrifft: Treffer und Nicht-Treffer", () => {
  // Der Ausdruck fasst seit Issue #406 nur noch die rohe Zeile, das Trimmen
  // macht die Funktion — dasselbe Muster wie bei PRUEFUNG_ZEILE in #403. Die
  // Bedeutung bleibt die des alten `^\s*Autor-Modell:...\s*$`.
  assert.equal(nurAutorZeileTrifft("Autor-Modell: opus"), true);
  assert.equal(nurAutorZeileTrifft("Autor-Modell:   opus   "), true, "Leerraum um den Wert ist erlaubt");
  assert.equal(nurAutorZeileTrifft("\n\nAutor-Modell: opus\n\n"), true, "Leerzeilen davor und danach zaehlen nicht");
  assert.equal(nurAutorZeileTrifft("  \n Autor-Modell: opus \n "), true, "auch gemischter Leerraum");
  // Kein Treffer: leerer Wert, fremder Text, zweite Inhaltszeile.
  assert.equal(nurAutorZeileTrifft("Autor-Modell:"), false, "ohne Wert kein Treffer");
  assert.equal(nurAutorZeileTrifft("Autor-Modell:    "), false);
  assert.equal(nurAutorZeileTrifft("## Kontext\nAutor-Modell: opus"), false, "eine Zeile davor zaehlt");
  assert.equal(nurAutorZeileTrifft("Autor-Modell: opus\nText"), false, "eine Zeile danach zaehlt");
  assert.equal(nurAutorZeileTrifft(""), false);
  assert.equal(nurAutorZeileTrifft(null), false);
  assert.equal(nurAutorZeileTrifft(undefined), false);
});

// --- 7. board.mjs: nurAutorZeile (inline in issueCreate) ---
// Der Ausdruck ist modulprivat und wirkt ueber das Anlegen einer Karte. Geprueft
// wird deshalb seine Wirkung: Ein Body, der nur die Autor-Zeile traegt — auch mit
// Leerzeilen davor und danach —, bekommt die Abschnitts-Vorlage angehaengt.

test("ein Body aus Leerzeilen plus Autor-Zeile bekommt die Vorlage", async () => {
  const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");

  const dir = mkdtempSync(join(tmpdir(), "board-nurautor-"));
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "workflow.config.json"),
      JSON.stringify({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } })
    );
    const board = join(process.cwd(), "kit", "board.mjs");
    const aus = execFileSync(process.execPath, [board, "issue", "create", "--title", "T", "--body", "-"], {
      cwd: dir,
      input: "\n\nAutor-Modell: opus\n\n",
      encoding: "utf-8",
    });
    const id = JSON.parse(aus).id;
    const datei = readFileSync(join(dir, "issues", `${String(id).padStart(4, "0")}.md`), "utf-8");
    assert.match(datei, /## Kontext/, "die Abschnitts-Vorlage muss angehaengt sein");
    assert.match(datei, /Autor-Modell: opus/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 8. night.mjs: der Review-Marker ---

test("REVIEW_MARKER_ZEILE: nur ein Wert auf derselben Zeile zaehlt", () => {
  assert.equal(hasReviewMarker("## Kontext\nIssue-Review: fable (2026-08-31)\n"), true);
  assert.equal(hasReviewMarker("  Issue-Review: codex"), true, "fuehrender Leerraum ist erlaubt");
  assert.equal(hasReviewMarker("Issue-Review:"), false, "ohne Wert kein Marker");
  assert.equal(hasReviewMarker("Issue-Review folgt noch"), false);
  assert.equal(hasReviewMarker(""), false);
  assert.equal(hasReviewMarker(null), false);
  assert.ok(REVIEW_MARKER_ZEILE instanceof RegExp);
});

// --- 9. night.mjs: RUNDEN_KOPF ---

test("RUNDEN_KOPF: Treffer, Rundennummer und Nicht-Treffer", () => {
  assert.equal(RUNDEN_KOPF.exec("## Issue-Review, Runde 1")[1], "1");
  assert.equal(RUNDEN_KOPF.exec("## Synthese, Runde 12")[1], "12");
  assert.equal(RUNDEN_KOPF.exec("## Plan-Review, Runde 2   ")[1], "2");
  assert.equal(RUNDEN_KOPF.exec("## Issue-Review, Runde"), null, "ohne Nummer kein Treffer");
  // Nebenbefund, hier festgehalten statt geaendert: Drei Rauten treffen ebenfalls.
  // `^##` passt auf den Anfang von `###`, und `[^\\n]*?` frisst die dritte Raute.
  // Das ist heutiges Verhalten; das Umschreiben darf es nicht nebenbei kippen.
  assert.equal(RUNDEN_KOPF.exec("### Issue-Review, Runde 1")[1], "1");
  assert.equal(RUNDEN_KOPF.exec("Issue-Review, Runde 1"), null, "ohne Rauten kein Treffer");
});

// --- Laufzeitprobe: der Fall, der vor dem Umschreiben explodierte ---
//
// Gemessen in Issue #396: Mit einem Zeilenumbruch im Eingabetext brauchte
// `/^Pruefung: *(.*?) *$/` bei 1 KiB rund 280 ms und ab 4 KiB laenger als zehn
// Sekunden — die beiden Wiederholungen ` *` und `(.*?)` akzeptierten dieselben
// Zeichen, und `.` kann das `\n` nicht ueberspringen. Nach dem Umschreiben ist
// derselbe Text harmlos.
//
// Erreichbar war der Fall im Bestand nicht (die Aufrufer splitten vorher an
// `\n`). Genau deshalb wird hier direkt gegen den Ausdruck gemessen: Nur so
// trifft die Probe den Pfad, den SonarCloud bemaengelt.

const GROSS = 16 * 1024;
const GRENZE_MS = 100;

function dauer(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

const WORST_CASE = [
  ["AUTOR_MODELL_ZEILE", AUTOR_MODELL_ZEILE, (n) => `Autor-Modell: x${" ".repeat(n)}\n`],
  ["PRUEFUNG_ZEILE", PRUEFUNG_ZEILE, (n) => `Pruefung: ${" ".repeat(n)}\n`],
  ["PRUEFUNG_STAND_ZEILE", PRUEFUNG_STAND_ZEILE, (n) => `Pruefung-Stand: ${" ".repeat(n)}\n`],
  ["FENCE_ZEILE", FENCE_ZEILE, (n) => `   ${"`".repeat(n)}\n`],
  ["REVIEW_MARKER_ZEILE", REVIEW_MARKER_ZEILE, (n) => `${" ".repeat(n)}Issue-Review:`],
  ["RUNDEN_KOPF", RUNDEN_KOPF, (n) => `## ${"x".repeat(n)}, Runde `],
];

for (const [name, re, bau] of WORST_CASE) {
  test(`${name} bleibt beim Worst-Case mit Zeilenumbruch unter ${GRENZE_MS} ms`, () => {
    const text = bau(GROSS);
    const ms = dauer(() => re.test(text));
    assert.ok(ms < GRENZE_MS, `${name}: ${ms.toFixed(1)} ms bei 16 KiB — erwartet unter ${GRENZE_MS} ms`);
  });
}

test("die Trim-Replaces bleiben beim Worst-Case schnell", () => {
  // Gemessen wird gegen die Funktionen des Bestands, nicht gegen kopierte
  // Literale (Issue #406). Der alte Stand dieser Probe kopierte `/\n+$/` und
  // `/^\n+|\n+$/g` und fuetterte sie mit `x` + lauter Umbruechen — der Ausdruck
  // trifft dort SOFORT, also mass die Probe kein Backtracking und blieb auch
  // gegen die quadratische Fassung gruen. Der Worst-Case braucht die umgekehrte
  // Form: Umbrueche zuerst, dann ein Zeichen, an dem das Ende scheitert.
  const viele = `${"\n".repeat(GROSS)}x`;
  assert.ok(dauer(() => autorModellSicherstellen(`## Kontext\n${viele}`, "opus")) < GRENZE_MS);
  assert.ok(dauer(() => pruefvorgabeStand(`## Aufgabe\n${viele}`)) < GRENZE_MS);
  assert.ok(dauer(() => nurAutorZeileTrifft(`Autor-Modell: x${" ".repeat(GROSS)}\ny`)) < GRENZE_MS);
});

// --- Die eine gewollte Verhaltensaenderung ---

test("ein Marker ueber Zeilengrenzen zaehlt nicht mehr", () => {
  // Vorher matchte `\s*` in die Folgezeile hinein, sodass dieser Body als
  // freigegeben galt. Der Kommentar an hasReviewMarker beschrieb seit jeher das
  // Gegenteil: Nur eine Zeile, die mit 'Issue-Review:' beginnt und DANACH etwas
  // traegt, zaehlt. Entscheidung vom 2026-08-31: Die Doku gewinnt.
  assert.equal(hasReviewMarker("Issue-Review:\nGO"), false);
  assert.equal(hasReviewMarker("## Kontext\nIssue-Review:\nfable"), false);
  // Unveraendert: der Marker mit Wert auf derselben Zeile.
  assert.equal(hasReviewMarker("Issue-Review: fable (2026-08-31)"), true);
});
