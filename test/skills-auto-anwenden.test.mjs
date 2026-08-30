/**
 * skills-auto-anwenden.test.mjs — das automatische Anwenden (Issue #387).
 *
 * **Geprueft wird Text, nicht Verhalten** — und das ist hier keine Bequemlichkeit,
 * sondern die einzig moegliche Pruefart: Den Body schreibt eine Session, die dem
 * Skill-Text folgt. Ein node:test-Lauf kann weder einen echten Review erzeugen
 * noch beweisen, dass eine Session nie frei formuliert. Was pruefbar ist, ist die
 * Vorgabe — und genau die pruefen diese Tests.
 *
 * Die Fehlerklasse dahinter fand der Issue-Review zu #387 als BLOCKER: Ein
 * Akzeptanzkriterium, das plausibel klingt und nicht ausfuehrbar ist.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(root, "skills", "issue-review", "SKILL.md"), "utf-8");
const DOKU = readFileSync(join(root, "docs", "dokumentation.md"), "utf-8");
const NIGHT = readFileSync(join(root, "kit", "night.mjs"), "utf-8");

test("Der Nachtbetrieb gibt beide Faelle vor", () => {
  assert.match(SKILL, /alle Funde `korrektur`/i, "der erste Fall fehlt");
  assert.match(SKILL, /`gate`-\s*oder\s*`alternativen`-Fund/i, "der zweite Fall fehlt");
  assert.match(SKILL, /`kit:klaeren` wird gesetzt|kit:klaeren.*gesetzt/i);
});

test("Das Label-Kommando steht woertlich da", () => {
  assert.match(SKILL, /issue label add <id> kit:klaeren/);
});

test("Die A10-Grenze steht woertlich als Vorgabe", () => {
  // Umlaute zaehlen in beiden Schreibweisen — dieselbe Regel fuehren die
  // Gate-Register, weil das Repo gemischt transliteriert und nicht.
  assert.match(SKILL, /nur w(ö|oe)rtlich Vorgeschlagenes/i);
  assert.match(SKILL, /keine Umformulierung/i);
});

// Bedingung 1 kollidierte mit der Klassifikation: Ein `korrektur`-Fund kann
// WICHTIG sein, und das Ticket bliebe dann weder markiert noch gezeichnet liegen.
test("Bedingung 1 der Marker-Regel steht nicht mehr in der alten Form", () => {
  assert.doesNotMatch(SKILL, /1\. Kein Fund trägt den Schweregrad `BLOCKER` oder `WICHTIG`\. Ein einziger reicht/);
  assert.match(SKILL, /alle Funde `korrektur`.*Marker|Marker.*alle Funde `korrektur`/is);
});

test("Der alte Schwellen-Satz ist ersetzt, nicht geloescht", () => {
  assert.doesNotMatch(SKILL, /Verantwortungsschwelle liegt beim Ändern der Anforderung/);
  assert.match(SKILL, /Verantwortungsschwelle/, "die neue Begruendung fehlt ganz");
  assert.doesNotMatch(DOKU, /Verantwortungsschwelle liegt beim Ändern der Anforderung/);
});

test("Reihenfolge und Fehlerpfad der Schreibbefehle stehen da", () => {
  assert.match(SKILL, /Reihenfolge/);
  assert.match(SKILL, /nie ein[en]? Marker ohne/i);
  assert.match(SKILL, /keine weitere Mutation|fuehrt keine weitere/i);
});

test("Fuer fachlich und plan bleibt es beim Marker-Verbot", () => {
  assert.match(SKILL, /`fachlich`.*`plan`.*kein.*Marker|kein.*Marker.*`fachlich`/is);
  assert.match(DOKU, /Für `fachlich` und `plan`/);
});

// night.mjs waehlt je Aufruf genau einen Modus — eine "Implementierungsauswahl
// desselben Laufs" gibt es im Review-Modus nicht. Der Ausschluss von kit:klaeren
// aus der Implementierungsauswahl liegt in Issue #382.
test("night.mjs waehlt je Aufruf genau einen Modus", () => {
  assert.match(NIGHT, /const modus = args\.review \? "Review" : "Implementierung"/);
});
