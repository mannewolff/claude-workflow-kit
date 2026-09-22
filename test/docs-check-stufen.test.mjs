// Regeltext der gestaffelten Pflichtpruefungen (Issue #757, Plan #753,
// fachliche Quelle #738).
//
// Erstes Paket der Staffelung und bindende Quelle: Bevor Code eine Stufenangabe
// auswertet, muss der Regeltext sie kennen. Steht er nachher, beschreibt er eine
// Weile lang einen Zustand, den es noch nicht gibt (Plan #753, E17).
//
// Der heikelste Punkt ist nicht die Staffelung selbst, sondern ihr Name. Der
// Begriff ist im Kit dreifach besetzt: `reviewStufen` sind die Pruefstufen des
// Reviews, die Nacht-Kette hat eigene Stufen, und `stufe` ist ab hier die Stufe
// einer Pflichtpruefung. Unmittelbar vor W3 steht der Satz „unabhaengig von der
// Pruefstufe" — er meint das Review und muss es weiter meinen. Ohne die
// Abgrenzung liest die naechste Session ihn als Aussage ueber die Staffelung und
// haelt W3 fuer stufenblind (Plan-Review, HINWEIS 1).
//
// Der zweite heikle Punkt ist die Reichweite. „Eine spaetere Stufe laeuft an der
// frueheren nicht mit" klingt wie eine Abschwaechung von W3. Sie ist keine —
// jede Stufe faehrt ihre Vorgaengerstufen mit, und vor jeder Freigabe laufen
// alle drei. Genau dieser Satz muss im Text stehen, sonst wertet ein Review die
// Staffelung als Gate-Verstoss.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

/** Die Auslieferungsvorlage. Die Kopie unter .claude/ ist Installer-Ausgabe und
 *  nicht versioniert — in CI existiert sie nicht. */
const VORLAGE = lies("templates", "CLAUDE-workflow.md");

/** Ein `##`-Abschnitt der Vorlage, bis zur naechsten Trennlinie. */
function abschnitt(ueberschrift) {
  const idx = VORLAGE.indexOf(ueberschrift);
  assert.ok(idx >= 0, `'${ueberschrift}' fehlt in templates/CLAUDE-workflow.md`);
  return VORLAGE.slice(idx).split(/\n---/)[0];
}

// --- Die Staffelung im Abschnitt „Pflichtchecks vor Push (Schritt 6)" ---

test("der Regeltext nennt die drei Stufennamen paket, push und merge", () => {
  const text = abschnitt("## Pflichtchecks vor Push");
  for (const name of ["paket", "push", "merge"]) {
    assert.match(text, new RegExp("`" + name + "`"),
      `die Stufe '${name}' wird im Abschnitt nicht benannt`);
  }
});

test("der Regeltext nennt paket als Vorgabe ohne Angabe", () => {
  // Ohne den Default waere jede Bestandsconfig unbestimmt: Sie traegt an keinem
  // Eintrag eine Stufe, und der Text sagte nicht, was dann laeuft.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /[Oo]hne Angabe[\s\S]{0,60}`paket`/,
    "dass ohne Angabe die Paketstufe gilt, steht nicht im Abschnitt");
});

test("der Regeltext sagt, dass eine spaetere Stufe an der frueheren nicht mitlaeuft", () => {
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /nicht mit/,
    "dass eine spaetere Stufe an der frueheren ausbleibt, steht nicht im Abschnitt");
});

test("der Regeltext sagt, dass jede Stufe ihre Vorgaengerstufen mitfaehrt", () => {
  // Die andere Haelfte der Aussage. Nur die Auslassung zu nennen, laese die
  // Staffelung wie einen Verzicht aussehen.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /Vorgaengerstufe/,
    "dass jede Stufe ihre Vorgaengerstufen mitfaehrt, steht nicht im Abschnitt");
});

test("der Regeltext sagt, dass keine Pflichtpruefung aus dem Gesamtprozess entfaellt", () => {
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /[Kk]eine Pflichtpruefung entfaellt[\s\S]{0,80}Gesamtprozess/,
    "der Satz zum Gesamtprozess fehlt im Abschnitt");
});

// --- Gate W3: derselbe Halt, ein anderer Umfang ---

test("W3 bindet die betroffenen buildChecks an die faellige Stufe", () => {
  const regel = VORLAGE.slice(VORLAGE.indexOf("### W3 —")).split(/\n### /)[0];
  assert.match(regel, /faelligen Stufe/,
    "W3 nennt die faellige Stufe nicht — der Umfang bleibt unbestimmt");
  assert.match(regel, /mechanisch/,
    "W3 hat die Mechanik der roten Checks verloren");
});

test("W3 haelt fest, dass vor jeder Freigabe alle drei Stufen laufen", () => {
  // Sonst liest ein Review die Staffelung als Aufweichung eines Gates — genau
  // die Lesart, gegen die W3 gebaut ist.
  const regel = VORLAGE.slice(VORLAGE.indexOf("### W3 —")).split(/\n### /)[0];
  assert.match(regel, /alle drei Stufen/,
    "W3 sagt nicht, dass vor jeder Freigabe alle drei Stufen laufen");
  assert.match(regel, /[Kk]eine Pflichtpruefung entfaellt[\s\S]{0,80}Gesamtprozess/,
    "W3 sagt nicht, dass keine Pflichtpruefung aus dem Gesamtprozess entfaellt");
});

// --- Die Config-Feldliste ---

test("die Config-Feldliste nennt die optionale Stufenangabe stufe", () => {
  const text = abschnitt("## Config (.claude/workflow.config.json)");
  assert.match(text, /`buildChecks`[\s\S]{0,200}`stufe`/,
    "die Feldliste nennt `stufe` nicht bei `buildChecks`");
  assert.match(text, /`checkAreas`/,
    "die Feldliste hat `checkAreas` bei `buildChecks` verloren");
});

// --- Die Abgrenzung der drei Stufenbegriffe ---

test("der Regeltext grenzt stufe gegen reviewStufen und die Nacht-Kette ab", () => {
  // Der eigentliche Zweck dieses Pakets neben der Staffelung selbst: Drei
  // verschiedene Dinge heissen im Kit „Stufe". Wer sie verwechselt, prueft zum
  // falschen Zeitpunkt oder liest ein Gate falsch.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /`stufe`/, "der Abgrenzungsabsatz nennt `stufe` nicht");
  assert.match(text, /`reviewStufen`/, "der Abgrenzungsabsatz nennt `reviewStufen` nicht");
  assert.match(text, /Nacht-Kette/, "der Abgrenzungsabsatz nennt die Stufen der Nacht-Kette nicht");
});

test("der Satz 'unabhaengig von der Pruefstufe' steht weiterhin vor W3 und meint das Review", () => {
  const satz = VORLAGE.indexOf("unabhaengig von der Pruefstufe");
  assert.ok(satz >= 0, "der Satz 'unabhaengig von der Pruefstufe' ist aus der Vorlage verschwunden");
  assert.ok(satz < VORLAGE.indexOf("### W3 —"),
    "der Satz steht nicht mehr vor W3");
  // Die Abgrenzung steht an der mehrdeutigen Stelle selbst: im selben Absatz.
  // Sie anderswo zu fuehren hiesse, dass genau der Leser sie verpasst, der ueber
  // den Satz stolpert.
  const absatz = VORLAGE.slice(satz).split("\n")[0];
  assert.match(absatz, /`reviewStufen`/,
    "der Absatz sagt nicht, dass die Pruefstufe hier das Review meint");
  assert.match(absatz, /`stufe`/,
    "der Absatz grenzt die Pruefstufe nicht gegen die Stufe einer Pflichtpruefung ab");
});
