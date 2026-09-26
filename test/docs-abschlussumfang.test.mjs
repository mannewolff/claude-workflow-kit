// Prozesstext und Doku zum verkleinerten Abschlussumfang (Issue #953, Plan #944,
// fachliche Quelle #938).
//
// Der Code der Achse `nichtBeimAbschluss` steht schon (Issues #946 bis #951). Was
// fehlt, ist der Text: Die Aufzaehlung der Achsen im Prozesstext zaehlt drei, und ein
// Leser hielte die vierte fuer undokumentiert. Zwei Zusicherungen tragen die
// Verkleinerung ueberhaupt erst — jede verschobene Pruefung laeuft vor dem
// Veroeffentlichen, und ein Lauf ohne Karte faehrt den heutigen Umfang (AK 5). Ohne
// sie liest die Aenderung sich als Rabatt auf die Pruefung, und genau das ist sie nicht.
//
// Die Doku braucht zwei Dinge, die nur dem Menschen gehoeren: das Maven-Beispiel, an
// dem die Aufteilung nach Testart anschaulich wird (surefire beim Abschluss, failsafe
// und jacoco erst beim Push), und die Verursachersuche — der Gewinn, den er beim roten
// Push-Lauf sieht. Der Kennzahlblock bekommt einen eigenen Unterabschnitt, der
// `wirksamkeit.md` benennt; ein Kapitel zur Wirksamkeit von Grund auf ist nicht Teil
// dieses Plans.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Auslieferungsvorlage; die Kopie unter .claude/ ist Installer-Ausgabe. */
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");
const DOKU = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");

/** Ein `##`-Abschnitt der Vorlage, bis zur naechsten Trennlinie. */
function abschnitt(ueberschrift) {
  const idx = VORLAGE.indexOf(ueberschrift);
  assert.ok(idx >= 0, `'${ueberschrift}' fehlt in templates/CLAUDE-workflow.md`);
  return VORLAGE.slice(idx).split(/\n---/)[0];
}

/** Ein Abschnitt der Doku, bis zur naechsten Ueberschrift gleicher oder hoeherer Ebene. */
function dokuAbschnitt(muster) {
  const treffer = DOKU.match(muster);
  assert.ok(treffer, `kein Abschnitt zu ${muster} in docs/dokumentation.md`);
  const idx = DOKU.indexOf(treffer[0]);
  return DOKU.slice(idx + treffer[0].length).split(/\n##+ /)[0];
}

// --- Prozesstext: die Aufzaehlung der Achsen ---

test("der Config-Abschnitt zaehlt die vierte Achse mit auf", () => {
  const text = abschnitt("## Config (.claude/workflow.config.json)");
  assert.match(text, /`nichtBeimAbschluss`/,
    "die Aufzaehlung der buildChecks-Achsen nennt `nichtBeimAbschluss` nicht");
});

// --- Prozesstext: die vierte Achse und ihre zwei Zusicherungen ---

test("der Abschnitt zu den Pflichtchecks beschreibt die Achse nichtBeimAbschluss", () => {
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /`nichtBeimAbschluss`/, "die Achse fehlt im Abschnitt");
  assert.match(text, /zusammenspiel/, "der Wert `zusammenspiel` fehlt");
  assert.match(text, /volleTestmenge/, "der Wert `volleTestmenge` fehlt");
  assert.match(text, /--abschluss/,
    "dass die Achse nur beim Lauf mit --abschluss wirkt, steht nicht im Abschnitt");
});

test("der Abschnitt sichert zu, dass jede verschobene Pruefung vor dem Veroeffentlichen laeuft", () => {
  // Die Zusicherung, die die Verkleinerung tragbar macht: verschoben, nicht erlassen.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /`nichtBeimAbschluss`[\s\S]{0,900}vor dem Veroeffentlichen/,
    "dass jede verschobene Pruefung vor dem Veroeffentlichen laeuft, steht nicht im Abschnitt");
});

test("der Abschnitt sagt, dass ein Lauf ohne Karte den heutigen Umfang faehrt", () => {
  // AK 5: Wer `--abschluss` nicht setzt — jeder andere Lauf —, merkt von der
  // Aenderung nichts.
  const text = abschnitt("## Pflichtchecks vor Push");
  assert.match(text, /[Oo]hne (die Karte|Kartennummer|`--abschluss`)[\s\S]{0,200}Umfang/,
    "dass ein Lauf ohne Karte den heutigen Umfang faehrt, steht nicht im Abschnitt");
});

// --- Prozesstext: der Kennzahlblock ---

test("der Abschnitt zur Wirksamkeit nennt die mittlere Pruefzeit je Karte samt Bezugsgroesse", () => {
  const text = abschnitt("## Wirksamkeit der Pruefungen");
  assert.match(text, /mittlere Pruefzeit je Karte/,
    "der neue Kennzahlblock fehlt im Abschnitt");
  assert.match(text, /Abschlusslaeufe/,
    "die Bezugsgroesse (die Abschlusslaeufe dieser Karte) fehlt");
  assert.match(text, /Vergleich/,
    "der Vergleichswert im vollen Umfang fehlt");
});

test("Gate W3 bleibt unveraendert ohne die neue Achse", () => {
  // E11: W3 beschreibt die Staffelung selbst und wird von diesem Paket nicht angefasst.
  const idx = VORLAGE.indexOf("### W3 —");
  assert.ok(idx >= 0, "Gate W3 fehlt in templates/CLAUDE-workflow.md");
  const regel = VORLAGE.slice(idx).split(/\n### /)[0];
  assert.doesNotMatch(regel, /nichtBeimAbschluss/,
    "W3 traegt die neue Achse — es sollte unveraendert bleiben");
});

// --- Doku: der Unterabschnitt zur Achse ---

test("die Doku fuehrt den Unterabschnitt zu nichtBeimAbschluss hinter dem zu `stufe`", () => {
  const stufe = DOKU.indexOf("### Gestaffelte Prüfungen: `stufe`");
  const achse = DOKU.search(/^### Abschluss und Veröffentlichen: `nichtBeimAbschluss`$/m);
  assert.ok(stufe >= 0, "der Abschnitt zu `stufe` fehlt");
  assert.ok(achse >= 0, "der Unterabschnitt zu `nichtBeimAbschluss` fehlt");
  assert.ok(achse > stufe, "der neue Unterabschnitt steht nicht hinter dem zu `stufe`");
});

test("der Unterabschnitt zeigt das Maven-Beispiel mit surefire, failsafe und jacoco", () => {
  // Der Gebrauchswert: An der Testart entlang wird die Aufteilung erst anschaulich.
  const text = dokuAbschnitt(/^### Abschluss und Veröffentlichen: `nichtBeimAbschluss`$/m);
  assert.match(text, /surefire/, "das Kommando der Modultests (surefire) fehlt");
  assert.match(text, /failsafe/, "das Kommando der Integrationstests (failsafe) fehlt");
  assert.match(text, /jacoco/, "das Kommando der Abdeckung (jacoco) fehlt");
  assert.match(text, /"nichtBeimAbschluss": "zusammenspiel"/,
    "der Wert `zusammenspiel` steht nicht im Beispiel");
  assert.match(text, /"nichtBeimAbschluss": "volleTestmenge"/,
    "der Wert `volleTestmenge` steht nicht im Beispiel");
});

test("der Unterabschnitt nennt die Bedingungen der Achse", () => {
  const text = dokuAbschnitt(/^### Abschluss und Veröffentlichen: `nichtBeimAbschluss`$/m);
  assert.match(text, /`--abschluss/, "dass nur der Abschlusslauf auslaesst, fehlt");
  assert.match(text, /`paket`/, "dass die Achse an der Paketstufe gilt, fehlt");
  assert.match(text, /fehlende[sn]? Feld|[Oo]hne (das )?Feld/,
    "dass ein fehlendes Feld unveraendertes Verhalten bedeutet, fehlt");
  assert.match(text, /vor dem Veröffentlichen/,
    "die Zusicherung, dass die Pruefung vor dem Veroeffentlichen laeuft, fehlt");
});

// --- Doku: Verursachersuche und Kennzahlblock ---

test("die Doku beschreibt die Verursachersuche des roten Push-Laufs", () => {
  const text = dokuAbschnitt(/^### Wer war es\? Die Verursachersuche$/m);
  assert.match(text, /`--stufe push`|Stufe `push`/,
    "dass die Suche nur an der Push-Stufe laeuft, fehlt");
  assert.match(text, /\(Issue #/, "das Muster der Kartennummer im Commit-Betreff fehlt");
  assert.match(text, /Refs #/, "das zweite Muster (`Refs #<n>`) fehlt");
  assert.match(text, /Commit ohne Karte|ohne (erkennbare )?Nummer/,
    "der Commit ohne Kartennummer fehlt");
  assert.match(text, /neue Karte/,
    "dass die Reparatur eine neue Karte ist, fehlt");
});

test("die Doku fuehrt einen eigenen Unterabschnitt zum Kennzahlblock und benennt wirksamkeit.md", () => {
  const text = dokuAbschnitt(/^### Was die Verkleinerung einbringt: die mittlere Prüfzeit je Karte$/m);
  assert.match(text, /wirksamkeit\.md/, "die Datei `.claude/wirksamkeit.md` ist nicht benannt");
  assert.match(text, /je Karte/, "die Bezugsgroesse (je Karte) fehlt");
  assert.match(text, /Abschlusslauf|Abschlussläufe/,
    "dass nur Abschlusslaeufe zaehlen, fehlt");
  assert.match(text, /kein Gate|hält nichts auf|haelt nichts auf/,
    "dass die Kennzahl kein Gate ist, fehlt");
});
