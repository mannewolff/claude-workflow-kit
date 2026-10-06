// Die Pfade der Nachbarn in den Grundlagen des Nacht-Runners (Issue #189, #498, #752, #790,
// #806, #919, #1224).
//
// KIT_ROOT verlegt die CLI-Aufrufe in ein fremdes Projekt, NIGHT_NACHBAR_DIR die Suche nach
// den Modulen. Beide werden beim Laden gelesen; deshalb setzt diese Datei sie vor dem ersten
// dynamischen Import — `node --test` startet je Datei einen eigenen Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projekt = join(repoRoot, "test", "fixtures", "gibt-es-nicht-projekt");
const nachbarn = join(repoRoot, "test", "fixtures", "gibt-es-nicht-nachbarn");

process.env.KIT_ROOT = projekt;
process.env.NIGHT_NACHBAR_DIR = nachbarn;
const g = await import(pathToFileURL(join(repoRoot, "kit", "night", "grundlagen.mjs")).href);

test("unter KIT_ROOT liegen die Kommandos im .claude/kit/ des fremden Projekts", () => {
  const kit = join(projekt, ".claude", "kit");
  assert.equal(g.BOARD_PATH, join(kit, "board.mjs"));
  assert.equal(g.AUFWAND_PATH, join(kit, "aufwand.mjs"));
  assert.equal(g.WIRKSAMKEIT_PATH, join(kit, "wirksamkeit.mjs"));
  assert.equal(g.BEFUNDE_PATH, join(kit, "befunde.mjs"));
  assert.equal(g.CHECKS_PATH, join(kit, "checks.mjs"));
});

test("NIGHT_NACHBAR_DIR verlegt die Module, nicht die Kommandos (Issue #498)", () => {
  assert.equal(g.NACHBAR_DIR, nachbarn);
  assert.equal(g.NACHBAR_BOARD, join(nachbarn, "board.mjs"));
  assert.equal(g.NACHBAR_CHECKS, join(nachbarn, "checks.mjs"));
  assert.equal(g.NACHBAR_AUFWAND, join(nachbarn, "aufwand.mjs"));
  assert.equal(g.NACHBAR_WIRKSAMKEIT, join(nachbarn, "wirksamkeit.mjs"));
  assert.equal(g.NACHBAR_BEFUNDE, join(nachbarn, "befunde.mjs"));
});

test("ohne Board-Teil unter den Nachbarn setzt boardUmgebung kein Budget (Issue #1067)", () => {
  assert.deepEqual(g.boardUmgebung({ PATH: "/usr/bin" }), { PATH: "/usr/bin" });
});
