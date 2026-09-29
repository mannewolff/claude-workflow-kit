// Leitplanke gegen `.sort()` ohne Vergleichsfunktion (Issue #956, Sonar S2871).
//
// Der Fall ist ein Wiederholungsfall: `main` stand schon am 2026-09-24 an S2871
// rot (Issue #872/#873), die Stellen wurden von Hand behoben, und der Fund war
// wieder da. Der `implement-next`-Skill verlangt fuer eine wiederkehrende,
// klassenweite Fundklasse eine harte Lint-Leitplanke statt einer Bitte in einer
// Doku — dieser Test belegt, dass sie greift, statt nur dazustehen.
//
// Warum nicht `sonarjs/no-alphabetical-sort`, die Sonars eigene S2871-Regel ist:
// Sie braucht Parser-Services (Typinformationen), um zu erkennen, ob der
// Empfaenger ein Array ist (cjs/S2871/rule.js:52). Fuer reine .mjs-Dateien ohne
// TypeScript-Projekt liefert sie ein leeres Regelobjekt und meldet nichts —
// aktiviert gegen die sechs offenen Stellen dieses Repos blieb sie stumm. Die
// Leitplanke ist deshalb syntaktisch gebaut (`no-restricted-syntax`) und faengt
// den Aufruf, nicht den Typ.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: repoRoot });

async function meldungen(code, relativerPfad) {
  const [ergebnis] = await eslint.lintText(code, { filePath: join(repoRoot, relativerPfad) });
  return ergebnis.messages;
}

// Der Geltungsbereich ist der von `sonar.sources` (kit, install.mjs, tools) — genau
// die Menge, fuer die das Quality Gate rot wird.
for (const pfad of ["kit/probe.mjs", "tools/probe.mjs", "install.mjs"]) {
  test(`[956] der Linter beanstandet .sort() ohne Vergleich in ${pfad}`, async () => {
    const funde = await meldungen("export const x = [\"b\", \"a\"].sort();\n", pfad);
    assert.equal(funde.length, 1, `erwartet genau ein Fund, erhalten: ${JSON.stringify(funde)}`);
    assert.equal(funde[0].ruleId, "no-restricted-syntax");
    assert.match(funde[0].message, /S2871/);
  });
}

test("[956] auch toSorted() ohne Vergleich wird beanstandet", async () => {
  const funde = await meldungen("export const x = [\"b\", \"a\"].toSorted();\n", "kit/probe.mjs");
  assert.equal(funde.length, 1, `erwartet genau ein Fund, erhalten: ${JSON.stringify(funde)}`);
  assert.equal(funde[0].ruleId, "no-restricted-syntax");
});

test("[956] ein .sort() MIT Vergleichsfunktion bleibt unbeanstandet", async () => {
  const funde = await meldungen(
    "export const x = [\"b\", \"a\"].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));\n",
    "kit/probe.mjs",
  );
  assert.deepEqual(funde.filter((m) => m.ruleId === "no-restricted-syntax"), []);
});

test("[956] test/ bleibt ausgenommen — dort zaehlt kein Gate", async () => {
  // Die Testsuite traegt Dutzende `.sort()`-Aufrufe ueber Schluesselnamen und
  // Dateilisten. Sie liegt nicht in `sonar.sources`, und eine Leitplanke, die beim
  // ersten Lauf hunderte Funde meldet, wird abgeschaltet statt befolgt — dieselbe
  // Begruendung, mit der eslint.config.mjs die `recommended`-Sets meidet.
  const funde = await meldungen("const x = [\"b\", \"a\"].sort();\n", "test/probe.test.mjs");
  assert.deepEqual(funde.filter((m) => m.ruleId === "no-restricted-syntax"), []);
});

test("[956] die Quellen unter sonar.sources sind heute frei von .sort() ohne Vergleich", async () => {
  const ergebnisse = await eslint.lintFiles(["kit", "tools", "install.mjs"]);
  const funde = ergebnisse.flatMap((r) =>
    r.messages.filter((m) => m.ruleId === "no-restricted-syntax")
      .map((m) => `${r.filePath}:${m.line}`));
  assert.deepEqual(funde, []);
});
