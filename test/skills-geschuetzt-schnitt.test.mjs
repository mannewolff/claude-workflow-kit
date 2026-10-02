// /issues und /task schneiden geschuetzte Aenderungen heraus (Issue #1054, Plan #987, E7, E8,
// E9, E18).
//
// Zwei Konventionen beim Schneiden: Eine geplante Aenderung an einem geschuetzten Pfad wird
// als eigene `[Mensch]`-Karte herausgetrennt, die das Restpaket unter `## Abhaengigkeiten`
// als `Issue #N` nennt; und `## Aufgabe` nennt die Dateien des Pakets als Backtick-Token,
// die Voraussetzung von I7 und damit jeder Erkennung. Dazu die Kennungen I7 bis I9 aus
// `issue check-form`.
//
// Geprueft wird der Skill-TEXT der Quelle unter `skills/`. Jede Pruefung ist eine Funktion
// ueber den Text, damit die abgewandelten Kopien unten zeigen, dass sie rot wird.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Quelle eines Skills unter `skills/` — nie die Dogfooding-Kopie. */
function quelle(name) {
  return readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
}

const SKILLS = ["issues", "task"];

const GESCHUETZT_MARKE = "Konvention „Geschuetzte Datei“";
const BACKTICK_MARKE = "Konvention „Dateien in Backticks“";

/** Der Absatz ab einer Marke bis zur naechsten Leerzeile. */
function absatz(text, marke, name) {
  const anfang = text.indexOf(marke);
  assert.ok(anfang >= 0, `${name}: die ${marke} fehlt`);
  const ende = text.indexOf("\n\n", anfang);
  return ende < 0 ? text.slice(anfang) : text.slice(anfang, ende);
}

function pruefeGeschuetzt(text, name) {
  const a = absatz(text, GESCHUETZT_MARKE, name);
  assert.match(a, /`\[Mensch\]`-Karte/, `${name}: das Heraustrennen als \`[Mensch]\`-Karte fehlt`);
  assert.match(a, /`Issue #N`/, `${name}: die Abhaengigkeit als \`Issue #N\` fehlt`);
  assert.match(a, /GESCHUETZTE_PFADE/, `${name}: der Verweis auf GESCHUETZTE_PFADE fehlt`);
  assert.match(a, /installierte[nr]? Kopie/, `${name}: die Abgrenzung zur installierten Kopie fehlt`);
  assert.match(a, /\bI8\b/, `${name}: I8 fehlt`);
  assert.match(a, /\bI9\b/, `${name}: I9 fehlt`);
}

function pruefeBackticks(text, name) {
  const a = absatz(text, BACKTICK_MARKE, name);
  assert.match(a, /`## Aufgabe`/, `${name}: der Abschnitt \`## Aufgabe\` fehlt`);
  assert.match(a, /Backtick/, `${name}: das Backtick-Token fehlt`);
  assert.match(a, /\bI7\b/, `${name}: I7 fehlt`);
}

for (const name of SKILLS) {
  test(`${name}: nennt die Konvention „Geschuetzte Datei“ mit [Mensch]-Karte, Issue #N, I8 und I9`, () => {
    pruefeGeschuetzt(quelle(name), name);
  });
  test(`${name}: nennt die Konvention „Dateien in Backticks“ mit I7`, () => {
    pruefeBackticks(quelle(name), name);
  });
  test(`${name}: abgewandelte Kopie ohne eine der Konventionen wird rot`, () => {
    const text = quelle(name);
    assert.throws(() => pruefeGeschuetzt(text.replace(GESCHUETZT_MARKE, "Konvention X"), name));
    assert.throws(() => pruefeGeschuetzt(text.replace("`[Mensch]`-Karte", "Karte"), name));
    assert.throws(() => pruefeBackticks(text.replace(BACKTICK_MARKE, "Konvention Y"), name));
    assert.throws(() => pruefeBackticks(text.replaceAll(/\bI7\b/g, "Ix"), name));
  });
}
