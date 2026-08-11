// Tests fuer die Bestandszugriffs-Regel im Issue-Review (Issue #268).
//
// Die Rollen-Prompts sagten "du hast nur den Text" und stellten zwei Zeilen
// spaeter eine Frage, die ohne Blick in den Bestand nicht zu beantworten ist:
// "Was bricht, das im Issue nicht steht?". Subagents mit Werkzeugen haben den
// Satz folgerichtig ignoriert — am 2026-08-08 in beiden Laeufen protokolliert.
//
// Die Entscheidung: Der Reviewer darf den Bestand lesen. Kontextlosigkeit meint
// die Entstehungsgeschichte, nicht den Code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

test("es gibt einen benannten Abschnitt zum Bestandszugriff", () => {
  assert.match(SKILL, /^#+ .*Bestand lesen/m,
    "kein Abschnitt, der die Frage ausdruecklich beantwortet");
});

test("der Abschnitt trennt Entstehungskontext von Bestandskenntnis", () => {
  assert.match(SKILL, /Entstehungs(kontext|geschichte)/,
    "die Trennung ist nicht benannt — ohne sie liest sich die Erlaubnis wie ein Widerspruch zum Verfahren");
  assert.match(SKILL, /Repository lesen|den Bestand lesen/);
});

test("der widerspruechliche Satz steht nicht mehr in den Rollen-Prompts", () => {
  // "du hast nur den Text" neben einer Bestandsfrage war der Widerspruch.
  // Geprueft wird der Bereich aller Rollen-Prompts — im Erklaertext darueber wird
  // der alte Satz bewusst zitiert, um die Aenderung nachvollziehbar zu machen.
  // Anker ist seit Issue #282 die Rolle `pruefbarkeit`; "Rolle A" gibt es nur
  // noch als historischen Verweis auf die gewanderte Rolle B.
  const prompts = SKILL.slice(SKILL.indexOf("**Rolle `pruefbarkeit`:**"), SKILL.indexOf("### 4."));
  assert.doesNotMatch(prompts, /du hast nur den Text/,
    "die alte Formulierung steht noch in einem Rollen-Prompt");
  // Eine Frage, die den Blick in den Bestand erzwingt, bleibt — sie ist der
  // Grund, warum der Zugriff noetig ist. Sie steht jetzt in der Plan-Stufe.
  assert.match(prompts, /Stimmt jede Behauptung über den Bestand\?/,
    "keine Rolle stellt mehr eine Frage, die den Bestandszugriff verlangt");
});

test("der Board-Kommentar weist den Bestandszugriff je Reviewer aus", () => {
  assert.match(SKILL, /Bestand: (gelesen|ja)/i,
    "keine vorgeschriebene Form, an der man den Zugriff ablesen kann");
});

test("fuer command-Reviewer ist die Nicht-Durchsetzbarkeit benannt", () => {
  // Ein fremdes Werkzeug bringt seine eigenen Rechte mit; das laesst sich nicht
  // erzwingen, aber es gehoert vermerkt.
  assert.match(SKILL, /kind: "command"[\s\S]{0,400}(eigene Rechte|nicht durchsetzbar|nicht erzwingen)/);
});
