// Der Kommando-Reviewer in /review (Issue #434).
//
// `skills/review/SKILL.md` startete den Reviewer ausschliesslich als Subagent
// ueber das Agent-Tool — und das Agent-Tool kennt nur Claude-Modelle. Ein
// `reviewCommand` in der Config waere damit still wirkungslos gewesen: Die
// Installer-Regel aus Issue #433 laesst die Config durch, der Skill haette sie
// anschliessend ignoriert.
//
// Geprueft wird als Textpruefung, dem Muster von skills-issue-review-bestand
// folgend. Die SKILL.md ist Prosa, die eine Session zur Laufzeit ausfuehrt; es
// gibt im Repository keinen Code, der `reviewCommand` startet — also auch keinen
// ausfuehrbaren Testgegenstand (PO-Entscheidung vom 2026-09-01).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "review", "SKILL.md"), "utf-8");

test("der Reviewer-Start unterscheidet nach Reviewer-Art", () => {
  // Ohne Fallunterscheidung reicht der Skill `reviewCommand` an ein Werkzeug
  // durch, das nur Claude-Modelle kennt.
  assert.match(SKILL, /reviewCommand/,
    "der Skill kennt das Feld reviewCommand ueberhaupt nicht");
  assert.match(SKILL, /reviewModel[\s\S]{0,600}Agent-Tool/,
    "der Claude-Pfad ist nicht mehr an reviewModel gebunden");
  assert.match(SKILL, /reviewCommand[\s\S]{0,600}\bstdin\b/,
    "der Kommando-Pfad nennt stdin nicht — der Prompt darf kein Argument sein");
  assert.match(SKILL, /reviewCommand[\s\S]{0,600}\bstdout\b/,
    "der Kommando-Pfad sagt nicht, woher die Antwort kommt");
});

test("der Ausfallpfad steht woertlich da: kein Spaltenwechsel, kein Board-Kommentar", () => {
  // Ein Review, der nicht lief, darf keine Spur hinterlassen, die wie eine
  // Pruefung aussieht.
  const stelle = SKILL.slice(SKILL.search(/Exit ungleich 0/));
  assert.notEqual(stelle, "", "der Ausfall bei Exit ungleich 0 ist nicht benannt");
  assert.match(stelle.slice(0, 800), /stderr/,
    "die Fehlermeldung enthaelt keinen stderr-Ausschnitt");
  assert.match(stelle.slice(0, 800), /nicht\W{0,4}nach In review|kein Spaltenwechsel/,
    "es steht nicht da, dass das Issue nicht nach In review wechselt");
  assert.match(stelle.slice(0, 800), /kein(en)? Board-Kommentar/,
    "es steht nicht da, dass kein Board-Kommentar entsteht");
});

test("die Vorbedingung nennt die Oder-Regel und beide Randfaelle", () => {
  assert.match(SKILL, /genau eines von beiden|Genau eines der beiden|genau eines der beiden/,
    "die Oder-Regel ist nicht benannt");
  // Randfall 1: keines gesetzt — Alt-Configs duerfen nicht brechen.
  assert.match(SKILL, /[Ff]ehlen beide[\s\S]{0,400}claude-opus-4-8/,
    "der Default fuer Alt-Configs ohne beide Felder fehlt");
  // Randfall 2: beide gesetzt — durch Handedit trotz Installer-Validierung moeglich.
  assert.match(SKILL, /[Ss]ind beide[\s\S]{0,400}(bricht|Abbruch)/,
    "der Abbruch bei zwei gesetzten Feldern fehlt");
});

test("reviewCommand steht in der Aufzaehlung der persoenlichen Felder", () => {
  const [, felder = ""] = SKILL.match(/nur persoenliche Felder: ([^)]+)\)/) ?? [];
  assert.match(felder, /reviewCommand/,
    "die Aufzaehlung der lokal ueberschreibbaren Felder kennt reviewCommand nicht (Issue #435)");
});
