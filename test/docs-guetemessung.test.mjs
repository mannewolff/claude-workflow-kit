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

/** Die Nutzer-Dokumentation (Issue #765). */
const DOKU = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");

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

// --- Die Nutzer-Dokumentation (Issue #765) ---
//
// Der Regeltext oben bindet die Session; dieser Abschnitt erklaert dem Menschen,
// wie er die Messung einschaltet. Sein Kern sind die beiden Werkzeug-Beispiele:
// PIT und Stryker melden Verschiedenes, und ohne je ein Beispiel schreibt jeder
// sein eigenes Muster — meist eines ohne Gruppe, das dann nie greift.

/** Ein `###`-Abschnitt der Doku, bis zur naechsten Ueberschrift gleicher oder
 *  hoeherer Ebene. */
function dokuAbschnitt(muster) {
  const treffer = DOKU.match(muster);
  assert.ok(treffer, `kein Abschnitt zu ${muster} in docs/dokumentation.md`);
  const idx = DOKU.indexOf(treffer[0]);
  return DOKU.slice(idx + treffer[0].length).split(/\n##+ /)[0];
}

test("die Dokumentation fuehrt den Abschnitt zur Guetemessung und ihrer Marke", () => {
  const text = dokuAbschnitt(/^### G(ü|ue)temessung und Marke.*$/m);
  assert.match(text, /`guete`/, "der Abschnitt nennt den Block `guete` nicht");
  assert.match(text, /`muster`/, "der Abschnitt nennt das Feld `muster` nicht");
  assert.match(text, /`marke`/, "der Abschnitt nennt das Feld `marke` nicht");
  // Die Benennung ist die Einschaltstelle: hoechstens ein Eintrag der Liste.
  assert.match(text, /\*\*eine\*\*|h(ö|oe)chstens ein/i,
    "dass hoechstens ein Eintrag die Messung traegt, steht nicht im Abschnitt");
});

test("der Abschnitt zeigt je ein Muster-Beispiel fuer PIT und fuer Stryker", () => {
  // Der eigentliche Gebrauchswert. Beide Werkzeuge melden Verschiedenes; wer nur
  // eines sieht, haelt dessen Form fuer die Form.
  const text = dokuAbschnitt(/^### G(ü|ue)temessung und Marke.*$/m);
  assert.match(text, /PIT/, "das PIT-Beispiel fehlt");
  assert.match(text, /Killed 42 \(84%\)/, "die PIT-Ausgabe `Killed 42 (84%)` fehlt");
  assert.match(text, /Stryker/, "das Stryker-Beispiel fehlt");
  assert.match(text, /Mutation score: 84\.21/, "die Stryker-Ausgabe `Mutation score: 84.21` fehlt");
  assert.match(text, /genau eine[nr]? Gruppe|eine Gruppe/i,
    "dass das Muster genau eine Gruppe braucht, steht nicht im Abschnitt");
});

test("der Abschnitt nennt den Halt beim Veroeffentlichen als denselben roten Lauf", () => {
  const text = dokuAbschnitt(/^### G(ü|ue)temessung und Marke.*$/m);
  assert.match(text, /unter der Marke/,
    "der Fall 'gemessener Anteil unter der Marke' steht nicht im Abschnitt");
  assert.match(text, /rote[nr]? Pflichtpr(ü|ue)fung/,
    "dass der Halt derselbe ist wie bei einer roten Pflichtpruefung, fehlt");
  assert.match(text, /kein (eigener|neuer) Stop-Punkt/,
    "dass es kein eigener Stop-Punkt ist, fehlt");
});

test("der Abschnitt grenzt mutationCommand gegen die Guetemessung ab", () => {
  const text = dokuAbschnitt(/^### G(ü|ue)temessung und Marke.*$/m);
  assert.match(text, /`mutationCommand`/,
    "die Abgrenzung zu `mutationCommand` fehlt im Abschnitt");
  assert.match(text, /`mutationCommand`[\s\S]{0,300}(kein|nicht)/,
    "es steht nicht, was `mutationCommand` gerade nicht ist");
});

test("der Abschnitt sagt, dass ein Projekt ohne Benennung unberuehrt bleibt", () => {
  // Derselbe Satz wie im Regeltext, hier fuer den Menschen mit Bestandsconfig:
  // Wer nichts benennt, merkt von der Guetemessung nichts.
  const text = dokuAbschnitt(/^### G(ü|ue)temessung und Marke.*$/m);
  assert.match(text, /[Oo]hne (die )?Benennung[\s\S]{0,160}Halt/,
    "der Satz, dass es ohne Benennung weder Messung noch Marke noch Halt gibt, fehlt");
});

test("die drei Stop-Punkte bleiben drei", () => {
  // Die Gegenprobe zum Satz in W3: Der Zusatz darf die Ueberschrift des
  // Abschnitts und W1 nicht angefasst haben.
  assert.match(VORLAGE, /## Die drei Stop-Punkte \(nie automatisiert\)/,
    "der Abschnitt der drei Stop-Punkte heisst nicht mehr so");
  assert.match(VORLAGE, /### W1 — Die drei Stop-Punkte bleiben menschlich/,
    "W1 heisst nicht mehr so");
});
