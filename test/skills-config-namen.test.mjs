// Regeltexte, Skills und Doku nennen Einstellungen mit ihrem englischen Namen (Issue #1737,
// Plan #1710 A15, Kriterium 1 der fachlichen Quelle #1705).
//
// Skills lassen die Session die Einstellungsdatei selbst lesen; seit dem Update traegt sie
// englische Namen, und ein deutscher Name im Text fuehrt die Session ins Leere. Geprueft wird
// jedes Backtick-Token der Dateien unten: Es darf kein deutscher Name aus SCHLUESSEL sein, der
// sich vom englischen unterscheidet, weder als Wurzelfeld (`vertragsRepos`) noch als Pfad mit
// Punkt (`night.stufen`, `buildChecks[].vorab`, `buildChecks[0].stufe`). Ein einzelnes Blatt
// (`vorab`) zaehlt nicht: ohne Pfad ist es vom gewoehnlichen Wort nicht zu unterscheiden.
//
// Geprueft wird die Quelle, nicht die installierte Kopie unter `.claude/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SEITEN = ["nachtbetrieb", "einrichtung", "prozess", "dokumentation"];
const DATEIEN = [
  ...["CLAUDE-workflow.md", "CLAUDE-Plan.md", "CLAUDE-Fachplan.md"].flatMap((n) => [`templates/${n}`, `en/templates/${n}`]),
  ...["requirement", "techplan", "issue-review", "issues", "task", "push-main", "merge-production",
    "implement-done", "implement-next", "implement-ready", "kit-review"].map((s) => `skills/${s}/SKILL.md`),
  ...SEITEN.flatMap((s) => [`docs/${s}.md`, `docs/en/${s}.md`]),
];

// Der englische Pfad zu einem deutschen: jedes Glied mit dem englischen Namen seines Pfads. Ein
// Listenglied (`buildChecks[]`) steht in der Tabelle ohne `[]`.
function englischerPfad(pfad) {
  const glieder = pfad.split(".");
  return glieder.map((glied, i) => {
    const en = SCHLUESSEL[[...glieder.slice(0, i), glied.replace(/\[\]$/, "")].join(".")];
    return glied.endsWith("[]") ? `${en}[]` : en;
  }).join(".");
}

/** Deutscher Name → englischer, je Wurzelfeld und je Pfad mit Punkt, der sich unterscheidet. */
function deutscheNamen() {
  const namen = new Map();
  for (const pfad of Object.keys(SCHLUESSEL)) {
    const en = englischerPfad(pfad);
    if (pfad === en) continue;
    if (!pfad.includes(".")) {
      namen.set(pfad, en);
      continue;
    }
    namen.set(pfad, en);
    namen.set(pfad.replaceAll("[]", ""), en.replaceAll("[]", ""));
  }
  return namen;
}

/** Je Backtick-Token, das ein deutscher Name ist: `datei:zeile: token → englisch`. */
function funde(text, datei, namen = deutscheNamen()) {
  const liste = [];
  text.split("\n").forEach((zeile, i) => {
    for (const [, token] of zeile.matchAll(/`([^`\n]+)`/g)) {
      const en = namen.get(token.replaceAll(/\[\d+\]/g, "[]"));
      if (en) liste.push(`${datei}:${i + 1}: \`${token}\` → \`${en}\``);
    }
  });
  return liste;
}

test("Die Namensliste kennt Wurzelfelder und Pfade, nicht aber gleichnamige", () => {
  const namen = deutscheNamen();
  assert.equal(namen.get("vertragsRepos"), "contractRepos");
  assert.equal(namen.get("night.stufen"), "night.tiers");
  assert.equal(namen.get("night.kette.umsetzungMin"), "night.chain.implementationMin");
  assert.equal(namen.get("buildChecks[].vorab"), "buildChecks[].upfront");
  assert.equal(namen.get("buildChecks.vorab"), "buildChecks.upfront");
  assert.equal(namen.has("buildChecks"), false);
  assert.equal(namen.has("night"), false);
  assert.equal(namen.has("vorab"), false, "ein einzelnes Blatt zaehlt nicht");
});

test("Der Fund schlaegt an, wenn in skills/issues/SKILL.md wieder `night.stufen` steht", () => {
  const datei = "skills/issues/SKILL.md";
  const text = readFileSync(join(repoRoot, datei), "utf-8");
  assert.deepEqual(funde(text, datei), []);
  const rueckfall = funde(`${text}\nDie Stufen stehen in \`night.stufen\`.\n`, datei);
  assert.equal(rueckfall.length, 1);
  assert.match(rueckfall[0], /`night\.stufen` → `night\.tiers`/);
});

test("Listenpositionen zaehlen wie der Listeneintrag", () => {
  assert.deepEqual(funde("`buildChecks[0].stufe` und `buildChecks[].stage`", "x"), ["x:1: `buildChecks[0].stufe` → `buildChecks[].stage`"]);
});

test("Regeltexte, Skills und Doku nennen Einstellungen englisch", () => {
  const namen = deutscheNamen();
  const alle = DATEIEN.flatMap((datei) => funde(readFileSync(join(repoRoot, datei), "utf-8"), datei, namen));
  assert.deepEqual(alle, [], `Deutsche Einstellungsnamen:\n${alle.join("\n")}`);
});
