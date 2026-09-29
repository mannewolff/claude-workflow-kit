// Die Sitzungsumfang-Konvention (Issue #979, Plan #974, fachlich #963).
//
// Text-Tests, kein Verhalten — die Einschaetzung entsteht beim Zerlegen, und
// wer sie trifft, ist das Modell, das den Skill liest. Geprueft wird deshalb,
// dass die Zeile, ihre beiden Werte, ihr Massstab und die Abgrenzung gegen das
// Stufenbudget im Text stehen, und dass der Abschluss die reissenden Pakete
// beim Namen nennt.
//
// Ausdruecklich **nicht** geprueft wird ein Gate: `kit/board.mjs` bleibt
// unangetastet, die Zeile ist ein Hinweis und keine Sperre (E4).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = (name) => readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");

const SKILLS = [
  ["issues", skill("issues")],
  ["task", skill("task")],
];

/** Absaetze eines Skills (durch Leerzeilen getrennt). */
function absaetze(text) {
  return text.split(/\n\s*\n/);
}

// --- 1. Die Zeile samt beiden Werten ----------------------------------------

test("[skills-979] beide Skills nennen die Zeile `Sitzungsumfang:` mit `passt` und `reisst`", () => {
  for (const [name, text] of SKILLS) {
    const treffer = absaetze(text).filter(
      (a) => a.includes("Sitzungsumfang:") && /passt/.test(a) && /rei(ss|ß)t/.test(a),
    );
    assert.ok(
      treffer.length >= 1,
      `${name}: kein Absatz nennt die Zeile 'Sitzungsumfang:' zusammen mit beiden Werten — ` +
        "ohne beide Werte weiss niemand, was die Zeile tragen soll",
    );
  }
});

test("[skills-979] keiner der Skills verlangt eine Minutenzahl oder eine dritte Stufe", () => {
  for (const [name, text] of SKILLS) {
    for (const absatz of absaetze(text).filter((a) => /Sitzungsumfang: passt \| rei(ss|ß)t/.test(a))) {
      assert.match(
        absatz,
        /keine gesch(ä|ae)tzte Minutenzahl/i,
        `${name}: der Absatz schliesst eine geschaetzte Minutenzahl nicht aus — ` +
          "eine Zahl behauptete eine Messung (E5)",
      );
      assert.match(
        absatz,
        /keine dritte (Zwischenstufe|Stufe)/i,
        `${name}: der Absatz schliesst eine dritte Zwischenstufe nicht aus`,
      );
    }
  }
});

// --- 2. Massstab und Abgrenzung ---------------------------------------------

test("[skills-979] beide Skills nennen `--timeout-min` als Massstab", () => {
  for (const [name, text] of SKILLS) {
    const treffer = absaetze(text).filter(
      (a) => a.includes("Sitzungsumfang") && a.includes("--timeout-min"),
    );
    assert.ok(
      treffer.length >= 1,
      `${name}: kein Absatz nennt '--timeout-min' als Massstab der Einschaetzung`,
    );
  }
});

test("[skills-979] beide Skills grenzen `night.kette.umsetzungMin` ausdruecklich ab", () => {
  for (const [name, text] of SKILLS) {
    const treffer = absaetze(text).filter(
      (a) =>
        a.includes("night.kette.umsetzungMin") &&
        /nicht gemeint|nicht\b.*gemeint|ausdr(ü|ue)cklich nicht/i.test(a),
    );
    assert.ok(
      treffer.length >= 1,
      `${name}: kein Absatz grenzt 'night.kette.umsetzungMin' als nicht gemeint ab — ` +
        "das Stufenbudget wird nur zwischen zwei Sessions geprueft (E6)",
    );
  }
});

// --- 3. Abschlusstabelle und Abschlusssatz ----------------------------------

test("[skills-979] die Abschlusstabelle des issues-Skills fuehrt die Spalte `Sitzungsumfang`", () => {
  const zeilen = skill("issues").split("\n");
  const kopf = zeilen.find((z) => z.startsWith("| Issue |"));
  assert.ok(kopf, "die Abschlusstabelle fehlt");
  assert.match(
    kopf,
    /\|\s*Sitzungsumfang\s*\|/,
    "die Tabelle hat keine Spalte `Sitzungsumfang` — dann muesste der Leser jede Karte oeffnen",
  );
});

test("[skills-979] der Abschlusssatz nennt die reissenden Pakete beim Namen", () => {
  const treffer = absaetze(skill("issues")).filter(
    (a) => /rei(ss|ß)t/.test(a) && /Alle Issues liegen in Backlog/.test(a),
  );
  assert.ok(
    treffer.length >= 1,
    "der Abschlusssatz nennt die Pakete mit `reisst` nicht — vor dem GO steht die Einschaetzung sonst nur in den Karten",
  );
});

// --- 4. Kein neues Gate ------------------------------------------------------

test("[skills-979] `kit/board.mjs` kennt keine Regel zur neuen Zeile", () => {
  const board = readFileSync(join(repoRoot, "kit", "board.mjs"), "utf-8");
  assert.doesNotMatch(
    board,
    /Sitzungsumfang/,
    "board.mjs nennt `Sitzungsumfang` — die Zeile ist ein Hinweis, kein Gate (E4)",
  );
});
