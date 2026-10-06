// Ablauf-Pruefung: Die Hilfe antwortet, bevor kit/board/grundlagen.mjs geladen ist; ob sie dieselben Statuswerte nennt, zeigt nur der gestartete Einstieg.
//
// Seit Issue #1211 (Plan #1199, E2) beantwortet kit/board.mjs `--help`, ohne einen Teil zu
// laden — sonst gaebe eine einzeln kopierte Datei keine Auskunft mehr (Issue #170). Die
// gueltigen Statuswerte stehen darum woertlich im Hilfetext, waehrend der Adapter sie aus
// `VALID_STATUSES` in den Grundlagen nimmt. Diese Pruefung haelt beide Stellen zusammen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { VALID_STATUSES } from "../kit/board/grundlagen.mjs";

const BOARD = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "board.mjs");

test("board.mjs --help nennt genau die Statuswerte der Grundlagen", () => {
  const res = spawnSync(process.execPath, [BOARD, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
  const zeile = res.stdout.split("\n").find((z) => z.startsWith("Gueltige Status-Werte: "));
  assert.ok(zeile, "die Hilfe nennt keine Statuswerte");
  assert.equal(zeile, `Gueltige Status-Werte: ${VALID_STATUSES.join(" | ")}`);
});
