// Abgleich der Kommando-Grammatik gegen die echten CLIs (Issue #218).
//
// test/fixtures/cli-grammar.json ist handgepflegt. Sie faengt den Fehler aus Issue
// #216, kann aber selbst veralten oder von Anfang an falsch sein — und dann sichert
// sie einen Irrtum genauso ab, wie es der GitLab-Test vorher tat. Genau die Kritik,
// die skills/local-check an handgepflegten Verbotslisten uebt ("die selbst veraltet").
//
// Ein Detail entscheidet: **Der Exit-Code taugt nicht als Signal.**
// `glab issue note create --help` liefert Exit 0 und den `note`-Hilfetext, weil
// `create` als Argument gelesen wird. Ein Test, der nur auf Exit 0 prueft, haelt jedes
// erfundene Subkommando fuer gueltig. Ausgewertet wird deshalb die USAGE-Zeile.
//
// Das echte CLI wird nur mit --help aufgerufen: keine Schreiboperation, kein Netzwerk,
// keine Authentifizierung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRAMMATIK = JSON.parse(
  readFileSync(join(repoRoot, "test", "fixtures", "cli-grammar.json"), "utf-8")
);

/** true, wenn das CLI im PATH liegt und antwortet. */
function vorhanden(cli) {
  const res = spawnSync(cli, ["--version"], { encoding: "utf-8" });
  return !res.error && res.status === 0;
}

/**
 * Die USAGE-Zeile fuer `<cli> <sub>` aus dem Hilfetext, oder null.
 *
 * Gesucht wird die Zeile, die woertlich mit "<cli> <sub> " beginnt. Existiert das
 * Subkommando nicht, zeigt das CLI den Hilfetext des naechstgelegenen echten
 * Kommandos — dessen USAGE-Zeile beginnt dann anders, und wir bekommen null. Das ist
 * die eigentliche Pruefung.
 */
function usageZeile(cli, sub) {
  const res = spawnSync(cli, [...sub.split(" "), "--help"], { encoding: "utf-8" });
  const text = (res.stdout || "") + (res.stderr || "");
  const praefix = `${cli} ${sub} `;
  for (const roh of text.split("\n")) {
    const zeile = roh.trim();
    if (zeile.startsWith(praefix)) return zeile.slice(praefix.length).trim();
  }
  return null;
}

/**
 * Zaehlt Positionsargumente in einem USAGE-Rest zu { min, max }.
 *
 * `<x>` und `{<a> | <b>}` sind Pflicht, `[<x>]` ist optional, `[flags]`/`[--flags]`
 * zaehlen nicht mit. Mehr Genauigkeit braucht es nicht: Die Grammatik prueft ohnehin
 * nur die Argumentzahl, nicht die Bedeutung.
 */
export function zaehleArgumente(rest) {
  let min = 0;
  let max = 0;
  // Optionale Gruppen zuerst herausnehmen, damit sie nicht als Pflicht zaehlen.
  const optional = rest.match(/\[[^\]]*<[^>]+>[^\]]*\]/g) || [];
  max += optional.length;
  let ohneOptional = rest;
  for (const o of optional) ohneOptional = ohneOptional.replace(o, "");

  // Pflichtgruppen: {<a> | <b>} zaehlt als eines, sonst jedes <x> einzeln.
  const gruppen = ohneOptional.match(/\{[^}]*\}/g) || [];
  min += gruppen.length;
  let rein = ohneOptional;
  for (const g of gruppen) rein = rein.replace(g, "");
  min += (rein.match(/<[^>]+>/g) || []).length;

  max += min;
  return { min, max };
}

for (const [cli, kommandos] of Object.entries(GRAMMATIK)) {
  if (cli.startsWith("_")) continue;

  const fehlt = !vorhanden(cli);
  // Skip mit Grund im Text: Ein stummer Skip ist von einem bestandenen Test nicht zu
  // unterscheiden (dieselbe Regel wie bei den Windows-Skips aus Issue #197).
  const bedingung = fehlt
    ? { skip: `${cli} nicht installiert — Grammatik-Abgleich uebersprungen. Die Fixture bleibt ungeprueft.` }
    : {};

  test(`cli-grammar: ${cli}-Eintraege stimmen mit den echten Hilfetexten ueberein`, bedingung, () => {
    const abweichungen = [];
    for (const [sub, { args }] of Object.entries(kommandos)) {
      const rest = usageZeile(cli, sub);
      if (rest === null) {
        abweichungen.push(`'${cli} ${sub}': keine passende USAGE-Zeile — Subkommando existiert nicht (mehr)?`);
        continue;
      }
      const { min, max } = zaehleArgumente(rest);
      if (args < min || args > max) {
        abweichungen.push(
          `'${cli} ${sub}': Fixture sagt ${args} Argument(e), USAGE erlaubt ${min}..${max} — gelesen: "${rest}"`
        );
      }
    }
    assert.deepEqual(
      abweichungen,
      [],
      `Die Fixture test/fixtures/cli-grammar.json weicht vom installierten ${cli} ab.\n` +
      `Nachzuziehen ist die FIXTURE, nicht der Adapter — und das Feld _quelle darin.\n` +
      abweichungen.join("\n")
    );
  });
}

// --- zaehleArgumente, direkt ---

test("zaehleArgumente: Pflichtargument", () => {
  assert.deepEqual(zaehleArgumente("<issue-id> [--flags]"), { min: 1, max: 1 });
});

test("zaehleArgumente: optionales Argument ergibt einen Bereich", () => {
  assert.deepEqual(zaehleArgumente("[<repository>] [flags]"), { min: 0, max: 1 });
});

test("zaehleArgumente: Alternativgruppe zaehlt als ein Argument", () => {
  assert.deepEqual(zaehleArgumente("{<number> | <url>} [flags]"), { min: 1, max: 1 });
});

test("zaehleArgumente: ohne Argumente", () => {
  assert.deepEqual(zaehleArgumente("[--flags]"), { min: 0, max: 0 });
  assert.deepEqual(zaehleArgumente("[flags]"), { min: 0, max: 0 });
});

test("zaehleArgumente: zwei Pflichtargumente", () => {
  assert.deepEqual(zaehleArgumente("<von> <nach> [flags]"), { min: 2, max: 2 });
});
