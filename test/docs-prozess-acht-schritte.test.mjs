// Abschlusstest zu Plan #1671: Der Prozess hat acht Schritte und keinen Schritt "Lokale
// Pruefung" mehr (Issue #1679, fachliche Quelle #1609).
//
// Die Teilpakete haben Vorlage, Skills, Prozessseite und Doku einzeln umgestellt. Dieser Test
// misst das Ergebnis als Ganzes: Die Schritttabellen sind von 1 bis 8 fortlaufend, keine heisst
// "Lokale Pruefung", und `local-check` steht nirgends mehr, wo der geltende Prozess beschrieben
// ist. Ausgenommen sind die historischen Seiten aus `docs-site/sprachen.json`; die Update-Hinweise
// stehen in CHANGELOG.md und in install.mjs, beide liegen ausserhalb der gemessenen Orte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

const HISTORISCH = new Set(JSON.parse(lies("docs-site", "sprachen.json")).historisch);

/** Alle Dateien unter `ordner`, ohne node_modules. */
function dateienUnter(ordner) {
  const ergebnis = [];
  for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
    if (eintrag.name === "node_modules") continue;
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) ergebnis.push(...dateienUnter(pfad));
    else ergebnis.push(pfad);
  }
  return ergebnis;
}

/** Die Schrittnummern einer Tabelle: `| 1. Anforderung |` oder `| **1** |` bzw. `| 2 |`. */
function schrittZeilen(text) {
  return text
    .split("\n")
    .map((zeile) => /^\|\s*(?:\*\*)?(\d+)\.?(?:\*\*)?\s*[|.\s]/.exec(zeile) && zeile)
    .filter(Boolean)
    .map((zeile) => ({ nummer: Number(/\d+/.exec(zeile)[0]), zeile }));
}

const TABELLEN = [
  ["templates", "CLAUDE-workflow.md"],
  ["en", "templates", "CLAUDE-workflow.md"],
  ["docs", "prozess.md"],
  ["docs", "en", "prozess.md"],
];

test("[1609] Prozess ohne lokale Prüfung — die Schritte 1 bis 8 sind fortlaufend und keiner heißt Lokale Prüfung", () => {
  for (const teile of TABELLEN) {
    const pfad = teile.join("/");
    const zeilen = schrittZeilen(lies(...teile));
    assert.deepEqual(zeilen.map((z) => z.nummer), [1, 2, 3, 4, 5, 6, 7, 8], `${pfad}: die Schritte sind nicht 1 bis 8`);
    for (const { zeile } of zeilen) {
      assert.doesNotMatch(zeile, /Lokale Pr(ü|ue)fung|Local check/i, `${pfad}: ein Schritt heisst noch Lokale Pruefung`);
    }
  }

  const gemessen = [
    ...dateienUnter(join(repoRoot, "skills")),
    ...dateienUnter(join(repoRoot, "kit")),
    ...dateienUnter(join(repoRoot, "templates")),
    ...dateienUnter(join(repoRoot, "docs")).filter((datei) => datei.endsWith(".md")),
  ].filter((datei) => !(datei.endsWith(".md") && relative(repoRoot, datei).startsWith("docs") && HISTORISCH.has(basename(datei, ".md"))));
  const fundstellen = gemessen.filter((datei) => readFileSync(datei, "utf-8").includes("local-check"));
  assert.deepEqual(fundstellen.map((datei) => relative(repoRoot, datei)), [], "local-check steht noch im geltenden Prozess");

  assert.equal(existsSync(join(repoRoot, "skills", "local-check")), false, "skills/local-check/ existiert noch");
});

test("Seitenleiste der Doku nennt den Prozess in acht Schritten (Issue #1708)", () => {
  const config = lies("docs-site", ".vitepress", "config.ts");
  assert.doesNotMatch(config, /neun Schritte|nine steps/i, "config.ts nennt noch neun Schritte");
  assert.match(config, /\{ text: "Die acht Schritte", link: "\/prozess" \}/, "deutscher Eintrag fehlt");
  assert.match(config, /\{ text: "The eight steps", link: "\/en\/prozess" \}/, "englischer Eintrag fehlt");
});
