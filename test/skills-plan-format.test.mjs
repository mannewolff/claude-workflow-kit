// Tests fuer das verbindliche Plan-Format in /plan (Issue #274).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell,
// das ihn liest. Wert haben sie trotzdem: Die sechs Ueberschriften sind der Anker,
// an dem die Plan-Pruefung und /issues arbeiten. Wird einer davon sinngemaess
// umformuliert, umsortiert oder gestrichen, laufen die daran haengenden Werkzeuge
// ins Leere — dieser Test schlaegt dann an.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "plan", "SKILL.md"), "utf-8");

// Die verbindliche Form: genau diese sechs, genau in dieser Reihenfolge.
const FORMAT = [
  "## Ziel",
  "## Betroffene Bereiche",
  "## Architektonische Entscheidungen",
  "## Geplante Änderungen",
  "## Offene Fragen",
  "## Verifizierung",
];

// Der Format-Block ist der einzige ```markdown-Block im Skill; alle anderen
// Codebloecke dort sind ```bash oder ohne Sprache.
function formatBlock(text) {
  const treffer = text.match(/```markdown\n([\s\S]*?)```/);
  assert.ok(treffer, "kein ```markdown-Block im Skill — der Format-Block fehlt");
  return treffer[1];
}

// Zaehlt nur Ueberschriften der Ebene 2. Genau darum sind die Kopfzeilen
// `Plan-Modell:` und `Fachliche Quelle:` kein Abschnitt: sie sind keine Ueberschrift.
const ueberschriften = (md) =>
  md.split("\n").filter((zeile) => /^## /.test(zeile)).map((zeile) => zeile.trimEnd());

test("der Format-Block nennt genau die sechs Abschnitte in dieser Reihenfolge", () => {
  assert.deepEqual(ueberschriften(formatBlock(SKILL)), FORMAT);
});

test("der Format-Block enthaelt keine weiteren Ueberschriften", () => {
  const block = formatBlock(SKILL);
  const alle = block.split("\n").filter((zeile) => /^#/.test(zeile)).map((z) => z.trimEnd());
  assert.deepEqual(alle, FORMAT, "im Block steht eine Ueberschrift, die nicht zum Format gehoert");
});

test("das Format ist als verbindlich ausgewiesen, nicht als Anregung", () => {
  assert.match(SKILL, /verbindlich/i, "das Wort fehlt — ohne es bleibt die Liste eine Empfehlung");
  assert.match(SKILL, /genau einmal und in dieser Reihenfolge/,
    "die Bindung an Anzahl und Reihenfolge ist nicht ausgesprochen");
  assert.match(SKILL, /###/, "die Regel zu erlaubten Unterueberschriften fehlt");
});

test("Umformulieren der Ueberschriften ist ausdruecklich verboten", () => {
  // Ohne dieses Verbot waere jede Ueberschrift verhandelbar und der Anker wertlos.
  assert.match(SKILL, /sinngemäß umformuliert wirken sie nicht/,
    "das Umformulierungsverbot fehlt");
});

test("jede architektonische Entscheidung traegt eine Begruendung", () => {
  assert.match(
    SKILL,
    /damit ihre Annahmen und Abwägungen im Review geprüft und angegriffen werden können/,
    "der woertliche Begruendungs-Anker fehlt",
  );
});

test("Offene Fragen sind Stopp-Fragen und haben einen Fehlerpfad", () => {
  assert.match(SKILL, /Stopp-Fragen/, "die Abgrenzung als Stopp-Frage fehlt");
  assert.match(SKILL, /Nachträglich entscheidbare Fragen gehören nicht hierher/,
    "die Abgrenzung nach unten fehlt — sonst landet jedes Detail im Abschnitt");
  assert.match(SKILL, /darf der Plan nicht in Arbeitspakete überführt werden/,
    "der Fehlerpfad bei mindestens einer offenen Stopp-Frage fehlt");
});

test("Verifizierung beschreibt Pruefungen, nicht deren Ergebnis", () => {
  assert.match(
    SKILL,
    /beschreibt die auszuführenden Prüfungen, nicht deren vorweggenommenes Ergebnis/,
    "der woertliche Satz zu `## Verifizierung` fehlt",
  );
});

test("leere Pflichtabschnitte gibt es nicht", () => {
  assert.match(SKILL, /`- Keine\.`/, "die Leerfall-Form fehlt");
  assert.match(SKILL, /Alle sechs bleiben erhalten/,
    "die Regel, dass kein Abschnitt entfaellt, fehlt");
});

test("die Reihenfolge Offene Fragen vor Verifizierung ist begruendet", () => {
  const zielIndex = SKILL.indexOf("## Offene Fragen");
  const verifikationIndex = SKILL.indexOf("## Verifizierung");
  assert.ok(zielIndex > -1 && zielIndex < verifikationIndex,
    "`## Offene Fragen` steht nicht vor `## Verifizierung`");
  assert.match(SKILL, /nicht am Ende vergraben/,
    "die Begruendung der Reihenfolge fehlt — ohne sie liest sie sich als Willkuer");
});

test("Plan-Modell und Fachliche Quelle sind kein siebter Abschnitt", () => {
  // Die Kopfzeilen aus Issue #266 stehen vor `## Ziel`. Ein Format-Test, der
  // Ebene-2-Ueberschriften zaehlt, darf sie nicht als Formverstoss werten.
  const beispielplan = [
    "Plan-Modell: claude-opus-5",
    "Fachliche Quelle: Issue #272",
    "",
    ...FORMAT.flatMap((ueberschrift) => [ueberschrift, "", "- Inhalt.", ""]),
  ].join("\n");

  assert.deepEqual(ueberschriften(beispielplan), FORMAT);

  assert.match(SKILL, /Plan-Modell: [\s\S]{0,400}kein siebter Abschnitt/,
    "der Skill stellt nicht klar, dass die Metadaten nicht zum Format zaehlen");
});
