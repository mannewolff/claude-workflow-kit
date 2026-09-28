// Leitplanke fuer die ESLint-Basisregeln (Issue #400).
//
// `eslint.config.mjs` hat bis zum 2026-09-28 nur neun handverlesene Regeln gefahren
// und `js.configs.recommended` gar nicht geladen — auch die Basisregeln liefen also
// nicht. Dieser Test belegt beides, was Schritt 1 der Ausweitung ausmacht: das Set
// ist aktiv, und die Node-Globals sind gesetzt. Ohne die Globals meldet `no-undef`
// jedes `process` und jedes `console` als Fund (gemessen: 1167 Stellen) — das Set
// waere in dieser Form nicht benutzbar, und wer die Zahl ohne sie erhebt, haelt den
// Schritt faelschlich fuer unbezahlbar.

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

test("[400] die Basisregeln laufen: eine unbenutzte Variable wird beanstandet", async () => {
  const funde = await meldungen("const ungenutzt = 1;\nexport const x = 2;\n", "kit/probe.mjs");
  assert.ok(
    funde.some((m) => m.ruleId === "no-unused-vars"),
    `erwartet einen no-unused-vars-Fund, erhalten: ${JSON.stringify(funde)}`,
  );
});

test("[400] die Basisregeln gelten auch fuer test/ und .githooks/", async () => {
  for (const pfad of ["test/probe.test.mjs", ".githooks/probe.mjs", "tools/probe.mjs", "install.mjs"]) {
    const funde = await meldungen("const ungenutzt = 1;\n", pfad);
    assert.ok(
      funde.some((m) => m.ruleId === "no-unused-vars"),
      `${pfad}: erwartet einen no-unused-vars-Fund, erhalten: ${JSON.stringify(funde)}`,
    );
  }
});

test("[400] die Node-Globals sind gesetzt — process und console sind kein no-undef", async () => {
  const funde = await meldungen(
    "console.log(process.argv, Buffer.from(\"x\"), __dirname);\n",
    "kit/probe.mjs",
  );
  assert.deepEqual(funde.filter((m) => m.ruleId === "no-undef"), []);
});

test("[400] ein ignorierter Parameter mit Unterstrich bleibt unbeanstandet", async () => {
  // Wo eine unbenutzte Bindung Absicht ist, wird sie gekennzeichnet statt die Regel
  // abgeschaltet — die Konvention dafuer ist der fuehrende Unterstrich.
  const funde = await meldungen(
    "export const f = (_unbenutzt, b) => b;\n",
    "kit/probe.mjs",
  );
  assert.deepEqual(funde.filter((m) => m.ruleId === "no-unused-vars"), []);
});
