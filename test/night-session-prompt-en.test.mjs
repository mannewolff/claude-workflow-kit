// Prompts an Sessions in der Projektsprache (Issue #1471, Plan #1420 E13/E16).
//
// Der Nachtlauf gibt Sessions zwei Prompttexte mit: den Zusatz der Stufen-Sessions der Kette
// (`KETTE_ZUSATZ` in kit/night/kette.mjs) und den Vorgabeprompt einer Umsetzungs-Session
// (kit/night/session.mjs). Beide gehen ueber die Texttabelle des Moduls:
//   - englisches Projekt: englischer Wortlaut, kein deutscher Skill-Name (`/fachplan`,
//     `/kontext`) — ein Skill heisst dort, wenn ueberhaupt, `/requirement` oder `/context`;
//   - deutsches Projekt: der Wortlaut bleibt Zeichen fuer Zeichen;
//   - die Erkennung des Umsetzungsstarts (Regex auf `/implement-…`) trifft in beiden.

import { test } from "node:test";
import assert from "node:assert/strict";

import { KETTE_ZUSATZ, TEXTE as KETTE_TEXTE, ketteZusatz, korrekturPrompt } from "../kit/night/kette.mjs";
import { TEXTE as SESSION_TEXTE, umsetzungsStart, vorgabePrompt } from "../kit/night/session.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { deutschImEnglischen } from "./helpers/quelltext-texte.mjs";

/** Fuehrt `fn` mit der Prozesssprache `sprache` aus und vergisst sie danach wieder. */
function inSprache(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return fn();
  } finally {
    spracheFestlegen(null);
  }
}

// Der deutsche Wortlaut vor dem Umbau — er bleibt Zeichen fuer Zeichen.
const ZUSATZ_DEUTSCH = "Dieser Lauf ist unbeaufsichtigt: Es sieht niemand zu, und es wird nicht gefragt. "
  + "Schreibe dein Ergebnis ans Board, bevor die Session endet. "
  + "Beende deine Arbeit nicht, solange eine von dir angestossene lange Arbeit laeuft: "
  + "Warte auf ihr Ergebnis oder brich sie ab und melde den Abbruch als Fehlschlag.";

const DEUTSCHE_SKILLS = /\/(?:fachplan|kontext)(?![\w-])/;

test("[1471] englisches Projekt: der Zusatz der Stufen-Sessions ist englisch und nennt keinen deutschen Skill", () => {
  inSprache("en", () => {
    const zusatz = ketteZusatz();
    assert.match(zusatz, /^This run is unattended/);
    assert.match(zusatz, /Write your result to the board before the session ends\./);
    assert.match(zusatz, /wait for its result or cancel it and report the cancellation as a failure\.$/);
    assert.doesNotMatch(zusatz, DEUTSCHE_SKILLS);
    // Am Prompt einer Korrektursession gemessen, nicht nur an der Funktion.
    assert.ok(korrekturPrompt("7", [{ gate: "g", meldung: "m" }]).endsWith(`\n${zusatz}`));
  });
});

test("[1471] englisches Projekt: der Vorgabeprompt startet die Umsetzung und nennt keinen deutschen Skill", () => {
  inSprache("en", () => {
    const prompt = vorgabePrompt("12");
    assert.equal(prompt, "/implement-next #12");
    assert.doesNotMatch(prompt, DEUTSCHE_SKILLS);
    assert.equal(umsetzungsStart(prompt), true);
  });
});

test("[1471] deutsches Projekt: Zusatz und Vorgabeprompt bleiben unveraendert", () => {
  inSprache("de", () => {
    assert.equal(ketteZusatz(), ZUSATZ_DEUTSCH);
    assert.equal(vorgabePrompt("12"), "/implement-next #12");
    assert.equal(umsetzungsStart(vorgabePrompt("12")), true);
  });
  // Die exportierte Konstante bleibt der deutsche Wortlaut, fuer die bestehenden Tests.
  assert.equal(KETTE_ZUSATZ, ZUSATZ_DEUTSCH);
});

test("[1471] beide Prompttexte stehen in den Texttabellen, in beiden Sprachen gleich gebaut", () => {
  assert.ok(Object.hasOwn(KETTE_TEXTE.de, "ketteZusatz") && Object.hasOwn(KETTE_TEXTE.en, "ketteZusatz"));
  assert.ok(Object.hasOwn(SESSION_TEXTE.de, "vorgabePrompt") && Object.hasOwn(SESSION_TEXTE.en, "vorgabePrompt"));
  assert.deepEqual(pruefeParitaet(KETTE_TEXTE), []);
  assert.deepEqual(pruefeParitaet(SESSION_TEXTE), []);
  assert.deepEqual(deutschImEnglischen(KETTE_TEXTE), []);
  assert.deepEqual(deutschImEnglischen(SESSION_TEXTE), []);
});
