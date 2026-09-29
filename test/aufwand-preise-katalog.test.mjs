// Die Preistabelle gegen den Modellkatalog von Claude Code (Issue #994).
//
// Gelesen aus dem Katalog im Binary von Claude Code 2.1.283, Feld `pricing` des
// jeweiligen Eintrags: `claude-opus-5-5` liegt auf `tier_4_20_cache_read_0_20`,
// `claude-sonnet-5` auf `tier_2_10`. Vorher kannte die Tabelle Opus 5.5 gar nicht (kein
// Betrag, das Kostenbudget der Kette sah die Sessions nicht) und rechnete Sonnet 5 mit
// `tier_3_15`, also um die Haelfte zu teuer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { preisFuer } from "../kit/preise.mjs";

test("preisFuer: claude-opus-5-5 traegt die Saetze aus dem Katalog", () => {
  assert.deepEqual(preisFuer("claude-opus-5-5"),
    { eingabe: 4, ausgabe: 20, cacheSchreiben5m: 5, cacheSchreiben1h: 8, cacheLesen: 0.2 });
});

test("preisFuer: claude-sonnet-5 traegt die Saetze aus dem Katalog", () => {
  assert.deepEqual(preisFuer("claude-sonnet-5"),
    { eingabe: 2, ausgabe: 10, cacheSchreiben5m: 2.5, cacheSchreiben1h: 4, cacheLesen: 0.2 });
});

test("preisFuer: die uebrigen Modelle der Familie 5 bleiben, wie der Katalog sie fuehrt", () => {
  assert.equal(preisFuer("claude-opus-5").eingabe, 5);
  assert.equal(preisFuer("claude-fable-5").eingabe, 10);
});
