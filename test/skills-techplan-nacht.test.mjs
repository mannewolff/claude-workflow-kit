// Tests fuer den Betriebsart-Schalter in /techplan (Issue #523).
//
// Geprueft wird Text, nicht Verhalten — wie in den uebrigen Skill-Tests des
// Repos. Der Wert liegt in der *Reihenfolge*: Eine Session liest von oben und
// handelt nach dem ersten Fall, den sie findet. Am 2026-08-31 endeten vier von
// vier Nacht-Sessions mit "Schaerfung fehlt", weil die unbeaufsichtigte Ausnahme
// achtzig Zeilen unter der interaktiven Regel stand (Issue #417). Deshalb steht
// an jeder Rueckfrage-Stelle die unbeaufsichtigte Variante zuerst — und deshalb
// messen diese Tests genau das und nicht bloss die Anwesenheit beider Faelle.
//
// Muster: `test/skills-issue-review-reihenfolge.test.mjs` (Schnitt an
// Ueberschriften) und `test/skills-techplan-format.test.mjs` (woertliche Anker).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "techplan", "SKILL.md"), "utf-8");

// Die beiden Marker stehen woertlich so im Skill. `**Unbeaufsichtigt**` endet
// vor der Klammer mit dem Erkennungsmerkmal, `**Interaktiv:**` traegt den
// Doppelpunkt innerhalb der Hervorhebung.
const UNBEAUFSICHTIGT = "**Unbeaufsichtigt**";
const INTERAKTIV = "**Interaktiv:**";

// Gesucht wird am Zeilenanfang: Der Rahmenabschnitt nennt die vier Stellen im
// Text, und eine Erwaehnung mitten im Satz ist keine Ueberschrift.
/** Der Abschnitt zwischen zwei woertlichen Ueberschriften. */
function abschnitt(von, bis) {
  const start = SKILL.indexOf(`\n${von}`);
  assert.ok(start > -1, `die Ueberschrift '${von}' fehlt`);
  const ende = SKILL.indexOf(`\n${bis}`, start);
  assert.ok(ende > start, `die Ueberschrift '${bis}' fehlt hinter '${von}'`);
  return SKILL.slice(start, ende);
}

/** Beide Marker stehen im Abschnitt, der unbeaufsichtigte zuerst. */
function reihenfolgePruefen(text, stelle) {
  const unbeaufsichtigt = text.indexOf(UNBEAUFSICHTIGT);
  const interaktiv = text.indexOf(INTERAKTIV);
  assert.ok(unbeaufsichtigt > -1,
    `in ${stelle} fehlt der Marker \`${UNBEAUFSICHTIGT}\` — die Betriebsart ist dort nicht geregelt`);
  assert.ok(interaktiv > -1,
    `in ${stelle} fehlt der Marker \`${INTERAKTIV}\` — der bisherige Ablauf ist dort nicht mehr benannt`);
  assert.ok(unbeaufsichtigt < interaktiv,
    `in ${stelle} steht die interaktive Variante zuerst — eine Nacht-Session handelt dann nach ihr, bevor sie die Ausnahme liest`);
}

test("[skills-2] der Abschnitt `## Im Nachtbetrieb` regelt die Betriebsart", () => {
  const idx = SKILL.indexOf("## Im Nachtbetrieb");
  assert.ok(idx > -1, "der Abschnitt `## Im Nachtbetrieb` fehlt");
  const rest = SKILL.slice(idx);
  const grenze = rest.indexOf("\n## ", 1);
  const nacht = grenze >= 0 ? rest.slice(0, grenze) : rest;

  // Gross-/Kleinschreibung bleibt offen: am Satzanfang steht ein grosses N.
  assert.match(nacht, /nachts wird nicht gefragt/i,
    "die Regel fehlt woertlich — ohne sie improvisiert jede Session neu");
  assert.match(nacht, /KIT_AGENT_MODEL/,
    "das Erkennungsmerkmal der Betriebsart fehlt");
  assert.match(nacht, /--erzeuge --stufe plan/,
    "wer den Skill nachts startet, steht nicht da");
  assert.match(nacht, /jeden unbeaufsichtigten Lauf/,
    "die Regel haengt sonst an diesem einen Runner");
});

test("[skills-2] Schritt 0 nennt die unbeaufsichtigte Bahn vor der interaktiven", () => {
  const schritt0 = abschnitt("### 0. Bahn bestimmen", "### 1. Anforderung verstehen");
  reihenfolgePruefen(schritt0, "Schritt 0");
  assert.match(schritt0, /Bahn 2/,
    "dass unbeaufsichtigt immer Bahn 2 gilt, steht nicht da — ohne Dokument hat der Nachtlauf kein Erfolgssignal");
  assert.match(schritt0, /## Architektonische Entscheidungen/,
    "wohin das Bahn-1-Urteil wandert, steht nicht da — verworfen waere es eine unterschlagene Einschaetzung");
});

// --- Bahn 3 in Schritt 0 (Issue #574) ----------------------------------------
//
// Ohne diese drei Tests waeren die Bedingungen "bestehende Tests bleiben gruen" und
// "ein Test traegt [skills-2]" schon vor jeder Aenderung erfuellt — und die Aenderung
// an Schritt 0 bliebe maschinell ungeprueft.

test("[skills-2] Schritt 0 bietet interaktiv Bahn 3 mit /task an und plant dann nicht", () => {
  const schritt0 = abschnitt("### 0. Bahn bestimmen", "### 1. Anforderung verstehen");
  const interaktiv = schritt0.slice(schritt0.indexOf(INTERAKTIV));
  assert.match(interaktiv, /Bahn 3/,
    "die dritte Bahn wird interaktiv nicht benannt — der Mensch hat weiter nur die Wahl zwischen zu viel und zu wenig");
  assert.match(interaktiv, /`\/task`/,
    "der Skill, auf den Bahn 3 zeigt, ist nicht genannt");
  assert.match(interaktiv, /nichts abzuw(?:ae|ä)gen/,
    "die Bedingung fuer Bahn 3 (nichts abzuwaegen) fehlt");
  assert.match(interaktiv, /plant nicht|kein Plan/,
    "dass der Skill dann nicht plant, steht nicht da");
});

test("[skills-2] das Bahn-3-Angebot nimmt [Fachlich] und [Plan] als Quelle aus", () => {
  const schritt0 = abschnitt("### 0. Bahn bestimmen", "### 1. Anforderung verstehen");
  assert.match(schritt0, /\[Fachlich\]/, "die Ausnahme fuer [Fachlich] als Quelle fehlt");
  assert.match(schritt0, /\[Plan\]/, "die Ausnahme fuer [Plan] als Quelle fehlt");
  // Die Idee ist ausdruecklich KEINE Ausnahme — `/task #N` nimmt sie an. Ohne diesen
  // Satz liest eine Sitzung die Ausnahme als "jede Nummer" und verweist nie auf /task.
  assert.match(schritt0, /\[Idee\]/,
    "dass eine [Idee] dem Angebot nicht entgegensteht, ist nicht benannt");
  assert.match(schritt0, /lehnt diese Quelle|lehnt .{0,40}ab/,
    "dass /task die Quelle [Fachlich] ausdruecklich ablehnt, fehlt");
});

test("[skills-2] unbeaufsichtigt wird ein Bahn-3-Urteil woertlich festgehalten", () => {
  const schritt0 = abschnitt("### 0. Bahn bestimmen", "### 1. Anforderung verstehen");
  const unbeaufsichtigt = schritt0.slice(0, schritt0.indexOf(INTERAKTIV));
  const ZEILE = "- Bahn 3 nach CLAUDE-workflow.md; nachts als Plan festgehalten, Entscheidung beim Menschen.";
  assert.ok(unbeaufsichtigt.includes(ZEILE),
    "die Bahn-3-Zeile fehlt woertlich in der unbeaufsichtigten Variante — jede Sitzung formulierte sie sonst anders");
  assert.match(unbeaufsichtigt, /erste Zeile in `## Architektonische Entscheidungen`/,
    "der Ort der Zeile (erste Zeile des Abschnitts) ist nicht festgelegt");
  assert.match(unbeaufsichtigt, /kann nachts kein `\[Task\]` entstehen/,
    "der Grund fehlt: nachts kann keine Bestaetigung eingeholt werden");
});

test("[skills-2] Schritt 1 fragt unbeaufsichtigt nicht nach", () => {
  const schritt1 = abschnitt("### 1. Anforderung verstehen", "### 2. Relevante Dateien lesen");
  reihenfolgePruefen(schritt1, "Schritt 1");
  assert.match(schritt1, /## Offene Fragen/,
    "wohin eine Stopp-Frage wandert, steht nicht da — dort und nur dort liest der Runner sie");
  assert.match(schritt1, /Annahme/,
    "die nachtraeglich entscheidbare Frage hat keinen Ort");
});

test("[skills-2] Schritt 4 laesst die Diskussion unbeaufsichtigt entfallen", () => {
  const schritt4 = abschnitt("### 4. Plan zur Diskussion stellen", "### 5. Plan-Dokument anlegen");
  reihenfolgePruefen(schritt4, "Schritt 4");
  assert.match(schritt4, /Schritt 5/,
    "dass Schritt 5 unmittelbar folgt, steht nicht da — sonst entsteht nachts kein Artefakt");
});

test("[skills-2] die Vorhaben-Notiz faellt nachts auf `plan-<M>` zurueck", () => {
  const notiz = abschnitt("#### Vorhaben-Notiz", "## Stop-Punkt");
  reihenfolgePruefen(notiz, "der Vorhaben-Notiz");
  assert.match(notiz, /plan-<M>/,
    "der Rueckfall fehlt — die Rueckfrage bei mehreren Vorhaben blieb nachts unbeantwortet");
});

test("[skills-3] jedes Absatzpaar der Vorhaben-Notiz nennt die unbeaufsichtigte Variante zuerst", () => {
  // Der Unterschritt regelt seit Issue #548 ZWEI Stellen nach Betriebsart: das
  // Kuerzel und den Fehlerpfad einer misslungenen Ablage. `reihenfolgePruefen`
  // sieht nur das erste Paar — bliebe es dabei, koennte das zweite in der
  // falschen Reihenfolge stehen, ohne dass ein Test es bemerkt.
  const notiz = abschnitt("#### Vorhaben-Notiz", "## Stop-Punkt");
  const folge = [...notiz.matchAll(/\*\*Unbeaufsichtigt\*\*|\*\*Interaktiv:\*\*/g)].map((m) => m[0]);

  assert.ok(folge.length >= 4,
    `im Unterschritt stehen nur ${folge.length} Marker — Kuerzel und Fehlerpfad brauchen je ein Paar`);
  assert.equal(folge.length % 2, 0, "ein Marker steht ohne Gegenstueck da");
  for (let i = 0; i < folge.length; i += 2) {
    assert.equal(folge[i], UNBEAUFSICHTIGT,
      `das ${i / 2 + 1}. Paar beginnt mit der interaktiven Variante — eine Nacht-Session handelt dann nach ihr`);
    assert.equal(folge[i + 1], INTERAKTIV,
      `dem ${i / 2 + 1}. Paar fehlt die interaktive Variante — der bisherige Ablauf ist dort nicht mehr benannt`);
  }
});

test("[skills-3] der Nachhol-Adressat der Nacht ist ein Kommentar am Plandokument", () => {
  const notiz = abschnitt("#### Vorhaben-Notiz", "## Stop-Punkt");
  assert.match(notiz, /issue comment <M>/,
    "das Kommentar-Kommando fehlt — nachts landete die Meldung nur im Lauf-Log, und der Runner"
      + " misst den Erfolg am Board: niemand erfuehre, dass die Notiz fehlt");
  assert.match(notiz, /Vorhaben-Notiz nicht abgelegt/,
    "der Wortlaut des Kommentars steht nicht da — ohne ihn erfindet jede Session einen eigenen");
});

test("[skills-2] die Ueberschrift von Schritt 5 setzt nicht mehr allein die Freigabe voraus", () => {
  const zeile = SKILL.split("\n").find((z) => z.startsWith("### 5."));
  assert.ok(zeile, "Schritt 5 fehlt");
  assert.doesNotMatch(zeile, /\(nur Bahn 2, nach der Freigabe\)/,
    "die Ueberschrift nennt die Freigabe als einzige Voraussetzung — eine Nacht-Session trifft dann auf eine Bedingung, die es nicht gibt");
  assert.match(zeile, /unbeaufsichtigt/i,
    "die zweite Betriebsart fehlt in der Ueberschrift von Schritt 5");
});
