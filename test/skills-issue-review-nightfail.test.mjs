// Tests fuer die Nachtregel bei ausgefallenem Reviewer (Issue #267).
//
// Am 2026-08-08 haben vier Nacht-Sessions ihre fertige Reviewer-Arbeit verworfen,
// weil `codex` sich nicht starten liess und sie daraufhin nachgefragt haben —
// nachts antwortet niemand. Der Skill kannte die Lage nicht: Er regelte
// "Reviewer fehlt beim Vorflug" und "Reviewer faellt mitten im Lauf aus", aber
// nicht "Vorflug meldet ihn, der Start scheitert".
//
// Geprueft wird Text, nicht Verhalten. Der Wert liegt darin, dass eine spaetere
// Umformulierung auffaellt, bevor sie wieder eine Nacht kostet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

// Der Nachtbetriebs-Abschnitt allein. Er begrenzt die Zusicherungen zum
// Reviewer-Ausfall: Rueckfragen sind interaktiv ausdruecklich erwuenscht, ein
// Treffer dort duerfte hier nicht zaehlen. Seit Issue #417 traegt der Abschnitt
// nur noch diese Regel — die Fallunterscheidung zum Body-Schreiben steht in
// Schritt 6 und wird ueber `schritt6` geprueft.
const nachtAbschnitt = SKILL.slice(SKILL.indexOf("## Im Nachtbetrieb"));

// Schritt 6 allein — von seiner Ueberschrift bis zum Nachtbetriebs-Abschnitt.
const schritt6 = SKILL.slice(
  SKILL.indexOf("### 6. Body schärfen"),
  SKILL.indexOf("## Im Nachtbetrieb")
);

test("die Regel schliesst den Ausfall BEIM START ein, nicht nur waehrend des Laufs", () => {
  assert.match(nachtAbschnitt, /beim Start ausf/i,
    "der Ausfall beim Start ist nicht benannt — genau diese Lage trat am 2026-08-08 ein");
});

test("nachts wird in keiner Lage gefragt", () => {
  assert.match(nachtAbschnitt, /in keiner Lage/,
    "die Regel ist nicht als ausnahmslos formuliert");
});

test("der Review laeuft mit den verbleibenden Reviewern zu Ende", () => {
  assert.match(nachtAbschnitt, /verbleibenden Reviewern zu Ende/,
    "ohne diesen Satz verfaellt die Arbeit des anderen Reviewers wieder");
});

// Seit Issue #282 laeuft die Stufe `issue` mit einem einzigen Reviewer. Faellt er
// aus, bleibt niemand uebrig — die Regel oben liefe leer, und eine Session ohne
// Anschlussregel improvisiert. Genau diese Luecke hat am 2026-08-08 vier
// Naechte gekostet, nur eine Stufe hoeher.
test("der Fall 'kein Reviewer bleibt uebrig' hat eine Anschlussregel", () => {
  assert.match(nachtAbschnitt, /Bleibt keiner übrig|Bleibt kein(er)? Reviewer/i,
    "die Lage ohne verbleibenden Reviewer ist nicht geregelt");
  assert.match(nachtAbschnitt, /protokoll/i,
    "die Folge (nur noch protokollieren) fehlt");
});

test("kein Ersatz-Reviewer aus eigenem Antrieb", () => {
  assert.match(nachtAbschnitt, /Kein Ersatz-Reviewer/i);
  assert.match(nachtAbschnitt, /pairs/,
    "die Begruendung ueber die Paar-Tabelle fehlt");
});

test("die Stop-Punkte nennen beide Regeln", () => {
  const stopPunkte = SKILL.slice(SKILL.indexOf("## Stop-Punkte"));
  assert.match(stopPunkte, /nie gefragt, in keiner Lage/);
  assert.match(stopPunkte, /kein Ersatz-Reviewer/i);
});

test("der bestehende Satz zum Ausfall waehrend des Laufs bleibt erhalten", () => {
  // Er steht bei der Ausfuehrung von kind: "command" und gilt auch interaktiv —
  // die neue Nachtregel ersetzt ihn nicht, sie verschaerft ihn nur fuer die Nacht.
  assert.match(SKILL, /gilt der Reviewer als ausgefallen.*kein Abbruch/s,
    "der Bestandssatz wurde ersatzlos entfernt");
});

// Issue #417: Dieselbe Fehlerklasse wie oben, eine Etage tiefer. Schritt 6 trug
// den Absolutsatz "Der Body wird nie automatisch geschrieben.", die Ausnahme
// stand rund 80 Zeilen tiefer im Nachtabschnitt — die Session handelte, bevor sie
// sie las. Am 2026-08-31 endeten vier von vier Nacht-Sessions mit "Schaerfung
// fehlt". Zwei frueheren Gegenmassnahmen war die Formulierung geschaerft worden,
// beide ohne Wirkung; der Fehler ist strukturell. Deshalb wird hier die Struktur
// zugesichert, nicht der Wortlaut.

test("Schritt 6 traegt beide Betriebsarten, die unbeaufsichtigte zuerst", () => {
  assert.notEqual(schritt6, "", "der Schritt-6-Abschnitt wurde nicht gefunden");

  const unbeaufsichtigt = schritt6.search(/unbeaufsichtigt/i);
  const interaktiv = schritt6.search(/interaktiv/i);
  assert.notEqual(unbeaufsichtigt, -1,
    "Schritt 6 nennt die unbeaufsichtigte Betriebsart nicht — dann liest die Nacht-Session hier nur die interaktive Regel");
  assert.notEqual(interaktiv, -1,
    "Schritt 6 nennt die interaktive Betriebsart nicht");
  assert.ok(unbeaufsichtigt < interaktiv,
    "die unbeaufsichtigte Betriebsart muss zuerst stehen — wer von oben liest, handelt nach dem ersten Fall");
});

test("die Ueberschrift von Schritt 6 traegt nicht mehr die halbe Regel", () => {
  assert.doesNotMatch(SKILL, /### 6\. Body schärfen — nur mit Freigabe/,
    "\"nur mit Freigabe\" ist fuer den unbeaufsichtigten Anwendungsfall falsch");
});

// Issue #419: Der Nacht-Runner sagt der Session im Prompt, dass sie unbeaufsichtigt
// laeuft. Schritt 6 muss festhalten, dass das nur eine Wiederholung ist — sonst
// koennte eine Session das FEHLEN des Hinweises als Entwarnung lesen und den
// interaktiven Pfad nehmen, obwohl KIT_AGENT_MODEL gesetzt ist. Zwei
// Erkennungsmerkmale waeren die zweite Wahrheit, die dieses Repo ueberall vermeidet.
test("Schritt 6 benennt KIT_AGENT_MODEL als alleiniges Erkennungsmerkmal", () => {
  assert.match(schritt6, /KIT_AGENT_MODEL/,
    "Schritt 6 nennt das Erkennungsmerkmal nicht");
  assert.match(schritt6, /kein zweites Signal/,
    "ohne diesen Satz darf ein weiteres Signal danebentreten");
  assert.match(schritt6, /Ma(ß|ss)geblich bleibt allein `KIT_AGENT_MODEL`; der Hinweis im Prompt wiederholt es nur/i,
    "der Prompt-Hinweis des Nacht-Runners ist nicht als blosse Wiederholung eingeordnet");
});

test("die Reihenfolge der Schreibbefehle steht in Schritt 6 und nicht mehr im Nachtabschnitt", () => {
  assert.match(schritt6, /Reihenfolge der Schreibbefehle/,
    "die Reihenfolge gehoert in den Schritt, den sie regelt");
  assert.doesNotMatch(nachtAbschnitt, /Reihenfolge der Schreibbefehle/,
    "zwei Orte fuer dieselbe Regel driften — im Nachtabschnitt darf sie nicht stehenbleiben");
});
