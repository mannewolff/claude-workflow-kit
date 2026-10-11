// Englische Skill-Namen mit aufrufbaren Altnamen (Issue #1463, Plan #1420 E16).
//
// `fachplan` heisst jetzt `requirement`, `kontext` heisst `context`. Der Altname bleibt
// aufrufbar, aber nicht als Wegweiser wie `skills/plan`, der nur auf den neuen Namen
// verweist: Er fuehrt den Ziel-Skill mit denselben Argumenten aus. Geprueft wird deshalb
// zweierlei. Der Altname nennt den Ziel-Skill samt `$ARGUMENTS` und traegt keine eigene
// Anleitung — sonst liefen zwei Fassungen auseinander. Der neue Name traegt den bisherigen
// Inhalt, erkennbar an Abschnitten, die nur dort stehen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

const PAARE = [
  { alt: "fachplan", neu: "requirement", inhalt: [/^## Ablauf$/m, /^## Eingang `\/fachplan #T`/m] },
  { alt: "kontext", neu: "context", inhalt: [/^## Vorbedingung: Config-Modus bestimmen$/m, /Zusammenfassung ausgeben/] },
];

const frontmatter = (text) => /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";

for (const { alt, neu, inhalt } of PAARE) {
  test(`skills/${alt} fuehrt /${neu} mit denselben Argumenten aus`, () => {
    const text = lies("skills", alt, "SKILL.md");
    assert.match(frontmatter(text), new RegExp(`^name: ${alt}$`, "m"));
    assert.match(frontmatter(text), /^user-invocable: true$/m);
    assert.match(text, new RegExp(`skill: "${neu}"`), "der Ziel-Skill fehlt im Aufruf");
    assert.match(text, /args: "\$ARGUMENTS"/, "die Argumente werden nicht weitergereicht");
  });

  test(`skills/${alt} traegt keine eigene Anleitung`, () => {
    const text = lies("skills", alt, "SKILL.md");
    for (const muster of inhalt) assert.doesNotMatch(text, muster, `${alt}: Anleitung steht noch im Altnamen`);
    assert.ok(text.split("\n").length < 30, `${alt}: zu lang fuer eine Weiterleitung`);
  });

  test(`skills/${neu} traegt den bisherigen Inhalt von ${alt}`, () => {
    const text = lies("skills", neu, "SKILL.md");
    assert.match(frontmatter(text), new RegExp(`^name: ${neu}$`, "m"));
    assert.match(frontmatter(text), /^user-invocable: true$/m);
    for (const muster of inhalt) assert.match(text, muster, `${neu}: bisheriger Inhalt fehlt`);
  });
}
