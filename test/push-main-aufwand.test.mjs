// Die zweite Ausgabestelle: der Aufwands-Befund in `/push-main` (Issue #752, Plan #745).
//
// Beide Stellen sind noetig (Kriterium 8): Wenn unbeaufsichtigte Laeufe kuenftig ohne
// Zutun eines Menschen starten, liest ihren Bericht womoeglich niemand mehr — das
// Veroeffentlichen bleibt der eine Schritt, den ein Mensch ausloest.
//
// DER BLOCK TRAEGT KEINE NUMMER (W5 aus dem Plan-Review). Ein nummerierter Schritt
// verschoebe jede Schrittzahl des Skills um eins und machte saemtliche Querverweise
// auf „Schritt 4" und „Schritt 6" falsch. Der unnummerierte Block stellt dasselbe her,
// ohne etwas zu brechen — und genau das haelt dieser Test fest, samt der Zahlen, die
// der Skill heute fuehrt.
//
// Geprueft wird Text, nicht Verhalten.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "push-main", "SKILL.md"), "utf-8");

/** Der Block „Aufwand melden" — von seiner Ueberschrift bis zur naechsten Ueberschrift. */
function aufwandBlock() {
  const treffer = SKILL.match(/^#{2,4}.*Aufwand melden.*$|^\*\*Aufwand melden\.?\*\*.*$/m);
  assert.ok(treffer, "im Skill steht kein Block 'Aufwand melden'");
  const rest = SKILL.slice(treffer.index + treffer[0].length);
  const ende = rest.search(/^(#{2,4} |\*\*[A-ZÄÖÜ])/m);
  return { start: treffer.index, kopf: treffer[0], text: ende === -1 ? rest : rest.slice(0, ende) };
}

/** Zahl der Vorkommen eines Musters im Skill. */
function zaehle(muster) {
  return (SKILL.match(muster) ?? []).length;
}

test("[skills-30] der Block 'Aufwand melden' steht hinter 'Fortschritt melden' und vor Schritt 1", () => {
  const fortschritt = SKILL.indexOf("**Fortschritt melden.**");
  assert.notEqual(fortschritt, -1, "der Absatz 'Fortschritt melden' fehlt");
  const schritt1 = SKILL.indexOf("### 1. Config lesen");
  assert.notEqual(schritt1, -1, "der Abschnitt 'Config lesen' fehlt");

  const block = aufwandBlock();
  assert.ok(block.start > fortschritt, "der Block steht vor 'Fortschritt melden'");
  assert.ok(block.start < schritt1, "der Block steht hinter Schritt 1 — dann liefe der Befund erst nach der Config");
});

test("[skills-30] der Block traegt keine Nummer — die Ueberschriften zaehlen unveraendert 1 bis 9", () => {
  const block = aufwandBlock();
  assert.ok(!/\d/.test(block.kopf), `der Kopf des Blocks traegt eine Zahl: ${block.kopf}`);

  const nummern = [...SKILL.matchAll(/^### (\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(nummern, [1, 2, 3, 4, 5, 6, 7, 8, 9], "die Schrittnummern des Skills haben sich verschoben");
  const ueberschriften = (SKILL.match(/^### /gm) ?? []).length;
  assert.equal(ueberschriften, 9, "es gibt eine `###`-Ueberschrift, die keine der neun Schrittnummern traegt");
});

// Die Zahlen gelten fuer den Stand nach Issue #929: Der Skill faehrt neun Schritte — der
// Worktree kam als Schritt 3 dazu, Rueckweg und Abbau als Schritt 8. Sie sind der
// Vergleichsmassstab, gegen den die Schrittzaehlung unveraendert bleiben muss. Faellt einer
// dieser Werte, hat ein Einschub die Zaehlung verschoben.
test("[skills-30] die Fortschrittszeilen nennen unveraendert dieselben Schrittzahlen", () => {
  assert.equal(zaehle(/Schritt k von 7/g), 0, "die literale Form 'Schritt k von 7' hat sich geaendert");
  assert.equal(zaehle(/Schritt k von 9/g), 1, "die literale Form 'Schritt k von 9' hat sich geaendert");
  assert.equal(zaehle(/Schritt \d+ von 7/g), 0, "es sind nummerierte Zeilen mit 'von 7' hinzugekommen");
  assert.equal(zaehle(/Schritt \d+ von 9/g), 6, "die Zahl der nummerierten Fortschrittszeilen hat sich geaendert");
});

// Seit Issue #929 ist Schritt 4 das Erzeugen der Release-Dateien; Schritt 3 legt den
// Worktree an, in dem sie entstehen.
test("[skills-30] Schritt 4 erzeugt die Release-Dateien, Schritt 3 den Worktree", () => {
  const worktree = SKILL.indexOf("### 3. ");
  assert.notEqual(worktree, -1, "Schritt 3 fehlt");
  assert.match(SKILL.slice(worktree).split(/\n### /)[0], /worktree\.mjs anlegen/,
    "Schritt 3 legt keinen Worktree an");

  const start = SKILL.indexOf("### 4. ");
  assert.notEqual(start, -1, "Schritt 4 fehlt");
  const abschnitt = SKILL.slice(start).split(/\n### /)[0];
  assert.match(abschnitt, /RELEASING\.md/, "Schritt 4 nennt die `RELEASING.md` nicht mehr");
});

test("[skills-30] der Block ruft `aufwand.mjs befund` und zeigt die Ausgabe unveraendert", () => {
  const { text } = aufwandBlock();
  assert.match(text, /node \.claude\/kit\/aufwand\.mjs befund/, "der Aufruf fehlt");
  assert.match(text, /unver[aä]ndert/i, "es steht nicht, dass die Ausgabe unveraendert gezeigt wird");
});

// Der zweite Befund (Issue #783, Plan #782): Die Wirksamkeit der Pruefungen steht
// unmittelbar hinter dem Aufwand. Die Reihenfolge ist Teil der Aussage — der Aufwand
// ist der aeltere Befund, und wer die beiden tauscht, aendert, was ein Mensch zuerst
// liest, ohne dass ein Gate es meldet.
test("[skills-30] der Block ruft beide Befunde, `wirksamkeit.mjs befund` hinter `aufwand.mjs befund`", () => {
  const { text } = aufwandBlock();
  const aufwand = text.indexOf("node .claude/kit/aufwand.mjs befund");
  const wirksamkeit = text.indexOf("node .claude/kit/wirksamkeit.mjs befund");
  assert.notEqual(aufwand, -1, "der Aufruf `aufwand.mjs befund` fehlt");
  assert.notEqual(wirksamkeit, -1, "der Aufruf `wirksamkeit.mjs befund` fehlt");
  assert.ok(wirksamkeit > aufwand, "der Wirksamkeits-Befund steht vor dem Aufwands-Befund");
});

test("[skills-30] fuer den Wirksamkeits-Befund gelten dieselben Regeln wie fuer den Aufwands-Befund", () => {
  const { text } = aufwandBlock();
  const ab = text.slice(text.indexOf("node .claude/kit/wirksamkeit.mjs befund"));
  assert.match(ab, /dieselben Regeln|denselben Regeln/, "es steht nicht, dass dieselben Regeln gelten");
  assert.match(ab, /\.claude\/wirksamkeit\.json/, "die gelesene Datei des zweiten Befunds fehlt");
});

// Der dritte Befund (Issue #806, Plan #797): die Befunde der Modell-Pruefungen,
// unmittelbar hinter der Wirksamkeit. Dieselbe Begruendung wie beim zweiten — die
// Reihenfolge ist Teil der Aussage, und `/retro` laeuft nur alle ein bis zwei Wochen
// und truege die Zahl damit zu spaet.
test("[skills-30] der Block ruft `befunde.mjs befund` unmittelbar hinter `wirksamkeit.mjs befund`", () => {
  const { text } = aufwandBlock();
  const wirksamkeit = text.indexOf("node .claude/kit/wirksamkeit.mjs befund");
  const befunde = text.indexOf("node .claude/kit/befunde.mjs befund");
  assert.notEqual(befunde, -1, "der Aufruf `befunde.mjs befund` fehlt");
  assert.ok(befunde > wirksamkeit, "der Befunde-Block steht vor dem Wirksamkeits-Block");
  // Unmittelbar heisst: kein weiterer Kit-Aufruf dazwischen.
  const dazwischen = text.slice(wirksamkeit, befunde).match(/node \.claude\/kit\/\S+/g) ?? [];
  assert.deepEqual(dazwischen, ["node .claude/kit/wirksamkeit.mjs"],
    `zwischen den beiden Befunden steht ein weiterer Aufruf: ${dazwischen.join(", ")}`);
});

test("[skills-30] der Befunde-Block steht vor dem ersten nummerierten Schritt", () => {
  const befunde = SKILL.indexOf("node .claude/kit/befunde.mjs befund");
  const schritt1 = SKILL.indexOf("### 1. Config lesen");
  assert.notEqual(befunde, -1, "der Aufruf fehlt im Skill");
  assert.ok(befunde < schritt1, "der Befunde-Block steht hinter Schritt 1 — dann liefe er erst nach der Config");
});

test("[skills-30] fuer den Befunde-Befund gelten dieselben Regeln, und er liest allein seinen Stand", () => {
  const { text } = aufwandBlock();
  const ab = text.slice(text.indexOf("node .claude/kit/befunde.mjs befund"));
  assert.match(ab, /dieselben Regeln|denselben Regeln/, "es steht nicht, dass dieselben Regeln gelten");
  assert.match(ab, /\.claude\/befunde\.json/, "die gelesene Datei des dritten Befunds fehlt");
});

test("[skills-30] ein Projekt ohne Modell-Pruefungen sieht nichts, und das bleibt unkommentiert", () => {
  const { text } = aufwandBlock();
  const ab = text.slice(text.indexOf("node .claude/kit/befunde.mjs befund"));
  assert.match(ab, /Fehlt die Datei|ohne .*Pr(ue|ü)fung|kein.*Protokoll/i,
    "der Fall des Projekts ohne Modell-Pruefungen kommt nicht vor");
});

test("[skills-30] eine leere Ausgabe bleibt unkommentiert", () => {
  const { text } = aufwandBlock();
  assert.match(text, /[Ll]eere? Ausgabe/, "der Leerfall fehlt");
  assert.match(text, /nicht kommentiert|unkommentiert|kein Befund/, "es steht nicht, dass der Leerfall unkommentiert bleibt");
  assert.match(text, /je Befund/, "der Leerfall gilt nicht erkennbar fuer jeden der beiden Befunde");
});

test("[skills-30] ein Fehlschlag wird in einer Zeile vermerkt und haelt nichts auf", () => {
  const { text } = aufwandBlock();
  assert.match(text, /Fehlschlag|scheitert/, "der Fehlerfall fehlt");
  assert.match(text, /h[aä]lt nichts auf/, "es steht nicht, dass der Fehlschlag nichts aufhaelt");
});

test("[skills-30] der Befund braucht die Config nicht und liest allein den Auswertungsstand", () => {
  const { text } = aufwandBlock();
  assert.match(text, /\.claude\/aufwand\.json/, "die gelesene Datei fehlt");
  assert.match(text, /Config/, "es steht nicht, dass der Befund die Config nicht braucht");
});

test("[skills-30] 'Was dieser Skill nicht tut' nennt alle drei Befunde ausdruecklich als kein Gate", () => {
  const start = SKILL.indexOf("## Was dieser Skill nicht tut");
  assert.notEqual(start, -1, "der Abschnitt fehlt");
  const abschnitt = SKILL.slice(start);
  assert.match(abschnitt, /Aufwand/, "der Aufwands-Befund kommt im Abschnitt nicht vor");
  assert.match(abschnitt, /Wirksamkeit/, "der Wirksamkeits-Befund kommt im Abschnitt nicht vor");
  assert.match(abschnitt, /Modell-Pr(ue|ü)fungen/, "der Befunde-Befund kommt im Abschnitt nicht vor");
  assert.match(abschnitt, /kein Gate/, "es steht nicht, dass die Befunde kein Gate sind");
});
