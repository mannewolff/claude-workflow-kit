// Regeltext der Guetemessung (Issue #762, Plan #753, fachliche Quelle #738).
//
// Erstes Paket der Guetemessung und bindende Quelle: Bevor Code eine Marke
// auswertet, muss der Regeltext sie kennen. Steht er nachher, beschreibt er eine
// Weile lang einen Zustand, den es noch nicht gibt (Plan #753, E17).
//
// Der heikelste Punkt ist die Einordnung des Halts. Er ist KEIN neuer
// Stop-Punkt: W1 fuehrt drei menschliche Stellen (GO, Push, Merge), und ein
// Halt wegen verfehlter Marke ist keine vierte davon, sondern ein roter
// Pflichtcheck wie jeder andere. Steht das nicht ausdruecklich in W3, haelt die
// naechste Session ihn spaeter fuer eine vierte Entscheidungsstelle und baut ihr
// eine eigene Mechanik (Plan-Review, HINWEIS 3).
//
// Der zweite heikle Punkt ist die Angst vor verlorener Arbeit. Ein Halt vor dem
// Veroeffentlichen klingt, als fiele der Batch zurueck. Er faellt nicht: Der
// Halt ist ein roter Lauf vor Commit und Push, die fertigen Pakete bleiben
// lokal committet, und der Versionsbump von `/push-main` ist idempotent
// (skills-20). Dafuer braucht es keinen neuen Code — aber es muss dastehen,
// sonst raet jeder Leser selbst.
//
// Der dritte Punkt ist der Bestand: Ohne Benennung gibt es weder Messung noch
// Marke noch Halt. Das ist das Nicht-Ziel „Keine Einfuehrung ohne Zutun" des
// Fachplans, und es ist der Satz, der eine Bestandsconfig beruhigt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Auslieferungsvorlage. Die Kopie unter .claude/ ist Installer-Ausgabe und
 *  nicht versioniert — in CI existiert sie nicht. */
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");

/** Ein `##`-Abschnitt der Vorlage, bis zur naechsten Trennlinie. */
function abschnitt(ueberschrift) {
  const idx = VORLAGE.indexOf(ueberschrift);
  assert.ok(idx >= 0, `'${ueberschrift}' fehlt in templates/CLAUDE-workflow.md`);
  return VORLAGE.slice(idx).split(/\n---/)[0];
}

/** Gate W3, bis zum naechsten Gate. */
function gateW3() {
  const idx = VORLAGE.indexOf("### W3 —");
  assert.ok(idx >= 0, "Gate W3 fehlt in templates/CLAUDE-workflow.md");
  return VORLAGE.slice(idx).split(/\n### /)[0];
}

// --- Die Benennung im Abschnitt „Pflichtchecks vor Push (Schritt 6)" ---

test("der Regeltext erlaubt genau eine Pruefung als Guetemessung", () => {
  // „Eine" ist die ganze Aussage: Zwei Messungen brauchten eine Vorrangregel
  // darueber, welche Marke den Halt ausloest.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /Guetemessung/, "der Abschnitt nennt die Guetemessung nicht");
  assert.match(text, /\*\*eine\*\*[^.]{0,80}Guetemessung/i,
    "dass es bei genau einer Pruefung bleibt, steht nicht hervorgehoben im Abschnitt");
  assert.match(text, /Marke/, "der Abschnitt nennt die Marke nicht");
});

test("der Regeltext nennt den Halt als denselben wie bei einer roten Pflichtpruefung", () => {
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /unter der Marke[\s\S]{0,200}rote[nr]? Pflichtpruefung/,
    "dass ein Wert unter der Marke derselbe Halt ist wie eine rote Pflichtpruefung, steht nicht im Abschnitt");
});

test("der Regeltext schliesst Ausnahme, neuen Stop-Punkt und persoenliche Marke aus", () => {
  // Alle drei Verneinungen gehoeren zusammen: Eine Marke, die jemand lokal
  // senken darf, ist keine Marke, und ein Halt mit Ausnahme ist keine Mechanik.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /keine Ausnahme/, "die fehlende Ausnahme steht nicht im Abschnitt");
  assert.match(text, /kein neuer Stop-Punkt/, "dass es kein neuer Stop-Punkt ist, steht nicht im Abschnitt");
  assert.match(text, /keine persoenliche Marke/, "dass die Marke nicht persoenlich abweichen darf, steht nicht im Abschnitt");
});

test("der Regeltext sagt, dass ein Projekt ohne Benennung unberuehrt bleibt", () => {
  // Das Nicht-Ziel „Keine Einfuehrung ohne Zutun": Wer nichts benennt, merkt
  // von der Guetemessung nichts.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /[Oo]hne Benennung[\s\S]{0,120}Halt/,
    "der Satz, dass es ohne Benennung weder Messung noch Marke noch Halt gibt, fehlt");
});

// --- Der Satz zur erhaltenen Arbeit ---

test("der Regeltext sagt, dass beim Halt keine Arbeit verloren geht", () => {
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /vor Commit und Push/,
    "dass der Halt ein roter Lauf vor Commit und Push ist, steht nicht im Abschnitt");
  assert.match(text, /lokal committet/,
    "dass die fertigen Pakete lokal committet bleiben, steht nicht im Abschnitt");
  assert.match(text, /idempotent/,
    "dass der Versionsbump von /push-main idempotent stehen bleibt, steht nicht im Abschnitt");
});

// --- Gate W3: derselbe Halt, keine vierte Entscheidungsstelle ---

test("W3 nennt den Halt ausdruecklich als Fall der bestehenden Mechanik", () => {
  const regel = gateW3();
  assert.match(regel, /Guetemessung|Marke/,
    "W3 kennt die Guetemessung nicht — der Halt bleibt unverortet");
  assert.match(regel, /mechanisch/, "W3 hat die Mechanik der roten Checks verloren");
});

test("W3 schliesst eine vierte Entscheidungsstelle aus", () => {
  // Der eigentliche Zweck des Zusatzes. W1 fuehrt drei menschliche Stellen;
  // ohne diesen Satz liest die naechste Session den Halt als vierte.
  const regel = gateW3();
  assert.match(regel, /kein[en]? vierte[rn]? Stop-Punkt|keine vierte/,
    "W3 sagt nicht, dass der Halt kein vierter Stop-Punkt ist");
});

test("die drei Stop-Punkte bleiben drei", () => {
  // Die Gegenprobe zum Satz in W3: Der Zusatz darf die Ueberschrift des
  // Abschnitts und W1 nicht angefasst haben.
  assert.match(VORLAGE, /## Die drei Stop-Punkte \(nie automatisiert\)/,
    "der Abschnitt der drei Stop-Punkte heisst nicht mehr so");
  assert.match(VORLAGE, /### W1 — Die drei Stop-Punkte bleiben menschlich/,
    "W1 heisst nicht mehr so");
});
