// Die Modell-Empfehlung wandert in das Arbeitspaket (Issue #666, Plan #663).
//
// `/issues` traf die Empfehlung schon vorher und begruendete sie — aber nur in der
// Tabelle am Ende des Laufs. Wo sie am Board stand, stand sie, weil eine einzelne
// Sitzung sie aus eigenem Antrieb kommentiert hat; vorgeschrieben war das nirgends, und
// der Nacht-Runner findet sie so nicht.
//
// Seit diesem Paket schreibt der Skill sie dorthin, wo der Runner ohnehin liest: in den
// Kontext-Abschnitt des Pakets. Die Tabelle bleibt daneben — sie traegt die Begruendung
// fuer den Menschen, die Zeile den Wert fuer die Maschine.
//
// Geprueft wird die QUELLE unter `skills/`, nicht die Dogfooding-Kopie: Die ist per
// `.gitignore` ausgeschlossen und fehlt in jedem frischen Checkout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issues", "SKILL.md"), "utf-8");
const SKILL_TASK = readFileSync(join(repoRoot, "skills", "task", "SKILL.md"), "utf-8");

test("[skills-22] der Skill nennt die Zeile als Bestandteil des Kontext-Abschnitts", () => {
  assert.match(SKILL, /Empfohlenes Modell:/, "die Zeile kommt im Skill nicht vor");
  // Sie muss im Kontext-Abschnitt landen, nicht irgendwo im Body: Der Runner liest sie
  // ueber eine am Zeilenanfang verankerte Regex, und `/issues` schreibt die uebrigen
  // Modell-Zeilen (Autor-Modell, Plan-Modell) ebenfalls dorthin.
  const absatz = SKILL.split(/\n\n/).find((a) => /Empfohlenes Modell:/.test(a) && /Kontext/.test(a));
  assert.ok(absatz, "kein Absatz verbindet die Zeile mit dem Kontext-Abschnitt");
});

test("[skills-22] der Skill nennt night.modelle als Quelle und die Ordnung der Liste", () => {
  assert.match(SKILL, /night\.modelle/, "die Quelle des Namens fehlt");
  const absatz = SKILL.split(/\n\n/).find((a) => /night\.modelle/.test(a));
  assert.match(absatz, /erste/i, "die Rolle des ersten Eintrags steht nicht da");
  assert.match(absatz, /letzte/i, "die Rolle des letzten Eintrags steht nicht da");
});

test("[skills-22] der Skill sagt, dass die Zeile ohne Liste ersatzlos entfaellt", () => {
  // Eine erfundene Angabe waere schlechter als keine: Der Runner faellt bei fehlender
  // Zeile ohnehin auf das Modell des Laufs zurueck.
  const absatz = SKILL.split(/\n\n/).find((a) => /night\.modelle/.test(a) && /entf(ä|ae)llt/i.test(a));
  assert.ok(absatz, "es steht nicht, dass die Zeile ohne Liste entfaellt");
});

test("[skills-22] der Skill bleibt unter 205 Zeilen", () => {
  // Die Grenze gehoert zu skills-14 und wird von test/skills-issues-kern.test.mjs
  // gemessen. Sie steht hier mit, weil dieses Paket den Absatz ERSETZT statt ihn zu
  // ergaenzen — genau deshalb. Mit Issue #687 von 200 auf 205, gleich wie dort.
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 205, `der Skill hat ${zeilen} Zeilen`);
});

// --- Der zweite Weg: Aufgabenstufe statt Empfehlung (Issue #714, Plan #707) ---
//
// Der Nachtlauf kann `night.stufen` lesen (Issue #711), aber bis hierher schrieb kein
// Skill die Stufe ins Paket. Ist die Einstellung aktiv, tritt die Stufe an die Stelle der
// Modell-Empfehlung — nicht daneben, sonst wuessten Runner und Mensch nicht, welche der
// beiden Angaben gilt.

test("[skills-22] /issues nennt beide Wege und die Zeilen Aufgabenstufe:/Stufengrund:", () => {
  assert.match(SKILL, /Aufgabenstufe:/, "die Zeile Aufgabenstufe: fehlt");
  assert.match(SKILL, /Stufengrund:/, "die Zeile Stufengrund: fehlt");
  const absatz = SKILL.split(/\n\n/).find((a) => /Aufgabenstufe:/.test(a) && /Stufengrund:/.test(a));
  assert.ok(absatz, "kein Absatz nennt beide Zeilen zusammen");
  assert.match(absatz, /keine[^.]*Empfohlenes Modell:[^.]*Zeile/i,
    "es steht nicht da, dass bei aktiver Einstellung keine Empfohlenes-Modell-Zeile entsteht");
});

test("[skills-22] /issues enthaelt den Regelabsatz mit allen drei Stufen und dem Verweis auf night.stufenRegel", () => {
  const absatz = SKILL.split(/\n\n/).find((a) => /Aufgabenstufe:/.test(a) && /schwer/.test(a));
  assert.ok(absatz, "kein Absatz traegt die Regel");
  assert.match(absatz, /schwer/);
  assert.match(absatz, /mittel/);
  assert.match(absatz, /leicht/);
  assert.match(absatz, /night\.stufenRegel/, "der Verweis auf night.stufenRegel fehlt");
});

test("[skills-29] /task nennt beide Zeilen und verweist auf den Regelabsatz in /issues, ohne die Regel zu wiederholen", () => {
  assert.match(SKILL_TASK, /Aufgabenstufe:/, "die Zeile Aufgabenstufe: fehlt in /task");
  assert.match(SKILL_TASK, /Stufengrund:/, "die Zeile Stufengrund: fehlt in /task");
  const absatz = SKILL_TASK.split(/\n\n/).find((a) => /Aufgabenstufe:/.test(a));
  assert.ok(absatz, "kein Absatz nennt die Zeile in /task");
  assert.match(absatz, /`\/issues`/, "der Verweis auf /issues fehlt");
  assert.doesNotMatch(absatz, /Architektur-, Sicherheits-/,
    "die Regel wird in /task wiederholt statt referenziert");
});

// --- Die Empfehlung tagsueber (Issue #667) ---
//
// Tagsueber sitzt der Mensch daneben und waehlt sein Modell selbst. Verborgen bleiben soll
// ihm die Empfehlung trotzdem nicht: Wer ein Paket interaktiv umsetzt, soll sehen, was die
// Planung dafuer vorgesehen hat, ohne den Plan noch einmal zu oeffnen.
//
// Verbindlich ist sie dabei NICHT. Eine laufende Sitzung kann ihr eigenes Modell nicht
// wechseln; sie verbindlich zu machen hiesse, den Menschen mitten im Lauf zum Neustart
// aufzufordern. Deshalb prueft der letzte Fall hier auf die Abwesenheit eines Halts.

const IMPLEMENT_SKILLS = [
  ["implement-next", readFileSync(join(repoRoot, "skills", "implement-next", "SKILL.md"), "utf-8")],
  ["implement-ready", readFileSync(join(repoRoot, "skills", "implement-ready", "SKILL.md"), "utf-8")],
];

/** Der Abschnitt zu Schritt 2 — von seiner Ueberschrift bis zur naechsten. */
function schritt2(text) {
  const start = text.search(/^#{2,4} .*2\..*Issue/m);
  if (start < 0) return null;
  const rest = text.slice(start);
  // Ab dem Ende der Ueberschriftszeile suchen, nicht ab Zeichen 1: Sonst traefe das
  // Muster die eigene Ueberschrift, von der nach slice(1) noch '## ' uebrig ist.
  const nachKopf = rest.indexOf("\n") + 1;
  const ende = rest.slice(nachKopf).search(/^#{2,4} /m);
  return ende < 0 ? rest : rest.slice(0, nachKopf + ende);
}

test("[skills-23] beide implement-Skills nennen die Zeile im Abschnitt zu Schritt 2", () => {
  for (const [name, text] of IMPLEMENT_SKILLS) {
    assert.match(text, /Empfohlenes Modell:/, `${name}: die Zeile kommt nicht vor`);
    const abschnitt = schritt2(text);
    assert.ok(abschnitt, `${name}: der Abschnitt zu Schritt 2 ist nicht auffindbar`);
    assert.match(abschnitt, /Empfohlenes Modell:/,
      `${name}: die Zeile steht ausserhalb von Schritt 2 — vorher kennt die Session den Body gar nicht`);
  }
});

test("[skills-23] beide Skills sagen, dass die laufende Sitzung ihr Modell nicht wechselt", () => {
  for (const [name, text] of IMPLEMENT_SKILLS) {
    const absatz = text.split(/\n\n/).find((a) => /Empfohlenes Modell:/.test(a));
    assert.ok(absatz, `${name}: kein Absatz zur Zeile`);
    assert.match(absatz, /wechselt|wechseln/i, `${name}: der Hinweis auf das nicht wechselbare Modell fehlt`);
  }
});

test("[skills-23] die Angabe loest keinen Halt und keine Ruecksprache aus", () => {
  for (const [name, text] of IMPLEMENT_SKILLS) {
    const absatz = text.split(/\n\n/).find((a) => /Empfohlenes Modell:/.test(a));
    assert.doesNotMatch(absatz, /kit:klaeren/, `${name}: die Zeile darf kein Label setzen`);
    assert.match(absatz, /kein Halt|keine R(ü|ue)ckfrage|keine R(ü|ue)cksprache/i,
      `${name}: es steht nicht ausdruecklich da, dass nichts anhaelt`);
  }
});

test("[skills-23] beide implement-Skills nennen Aufgabenstufe: mit dem Zusatz, dass die laufende Sitzung ihr Modell nicht wechselt, und ohne Halt", () => {
  for (const [name, text] of IMPLEMENT_SKILLS) {
    assert.match(text, /Aufgabenstufe:/, `${name}: die Zeile Aufgabenstufe: kommt nicht vor`);
    const abschnitt = schritt2(text);
    assert.ok(abschnitt, `${name}: der Abschnitt zu Schritt 2 ist nicht auffindbar`);
    assert.match(abschnitt, /Aufgabenstufe:/,
      `${name}: die Zeile steht ausserhalb von Schritt 2 — vorher kennt die Session den Body gar nicht`);
    const absatz = text.split(/\n\n/).find((a) => /Aufgabenstufe:/.test(a));
    assert.ok(absatz, `${name}: kein Absatz zur Zeile Aufgabenstufe:`);
    assert.match(absatz, /wechselt|wechseln/i, `${name}: der Hinweis auf das nicht wechselbare Modell fehlt`);
    assert.doesNotMatch(absatz, /kit:klaeren/, `${name}: die Zeile darf kein Label setzen`);
    assert.match(absatz, /kein Halt|keine R(ü|ue)ckfrage|keine R(ü|ue)cksprache/i,
      `${name}: es steht nicht ausdruecklich da, dass nichts anhaelt`);
  }
});
