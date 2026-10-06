// Waechter fuer leichte Pruefungen (Issue #1210, Plan #1199, E7 und E18).
//
// Der Plan will die Pruefungen leicht machen: Tests im selben Prozess statt
// Kindprozessen, keine festen Wartezeiten, und was als Ablauf bleibt, traegt eine
// Begruendung. Damit das nicht nur im Plantext steht, prueft dieser Test es an den
// Dateien unter `test/` — mit vier Regeln:
//
//   1. Eine Testdatei, die selbst oder ueber einen Helfer unter `test/helpers/` ein
//      Programm aus `kit/` oder `tools/` als Kindprozess startet, traegt im Kopf
//      `// Ablauf-Pruefung: <Grund>`.
//   2. Keine feste Pause. Ein begrenztes Warten auf eine Bedingung (`warteAuf…`) nur
//      in einer gekennzeichneten Ablauf-Pruefung, und es scheitert bei Fristablauf
//      mit Befund.
//   3. `sleep <n>` in einer Attrappe nur mit `# haengt` in derselben Zeile.
//   4. Eine Testdatei, die keine Ablauf-Pruefung ist, importiert aus dem Teil unter
//      `kit/night/` oder `kit/board/`, nicht aus dem Einstieg.
//
// Die Regeln gelten fuer jede Testdatei, ohne Liste fuer Altlasten (Issue #1236).
// Die Regeln selbst stehen in `helpers/leichtigkeit.mjs`; die Faelle unten belegen
// jede an erfundenen Dateien im selben Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { REGELN, leichtigkeitPruefen, testdateienLesen, befundeAlsText } from "./helpers/leichtigkeit.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Befunde einer erfundenen Dateimenge, als `regel datei`. */
function treffer(dateien) {
  const { verstoesse } = leichtigkeitPruefen(new Map(Object.entries(dateien)));
  return { verstoesse: verstoesse.map((v) => `${v.regel} ${v.datei}`) };
}

const KOPF = "// Ablauf-Pruefung: der Runner ist nur als Prozess beobachtbar.\n";

const STARTENDER_HELFER = [
  'import { spawnSync } from "node:child_process";',
  'import { join } from "node:path";',
  'export const NIGHT = join(repoRoot, "kit", "night.mjs");',
  "export function nacht(dir) { return spawnSync(process.execPath, [NIGHT], { cwd: dir }); }",
].join("\n");

test("der heutige Stand verstoesst gegen keine Regel, in keiner Testdatei", () => {
  const befunde = leichtigkeitPruefen(testdateienLesen(repoRoot));
  assert.equal(befunde.verstoesse.length, 0, befundeAlsText(befunde));
});

test("der Waechter fuehrt genau die vier Regeln", () => {
  assert.deepEqual([...REGELN].sort(), ["ablauf-kennzeichnen", "haenger-kennzeichnen", "import-aus-teil", "keine-pausen"]);
});

// --- Regel 1: Ablauf-Pruefung kennzeichnen -----------------------------------

test("Regel 1: ein Prozessstart nur ueber einen Helfer unter test/helpers/ wird gemeldet", () => {
  const { verstoesse } = treffer({
    "test/helpers/start.mjs": STARTENDER_HELFER,
    "test/night-x.test.mjs": 'import { nacht } from "./helpers/start.mjs";\ntest("x", () => nacht("/tmp"));\n',
  });
  assert.deepEqual(verstoesse, ["ablauf-kennzeichnen test/night-x.test.mjs"]);
});

test("Regel 1: die Kette durch zwei Helfer wird verfolgt", () => {
  const { verstoesse } = treffer({
    "test/helpers/start.mjs": STARTENDER_HELFER,
    "test/helpers/mitte.mjs": 'export { nacht } from "./start.mjs";\n',
    "test/night-x.test.mjs": 'import { nacht } from "./helpers/mitte.mjs";\n',
  });
  assert.deepEqual(verstoesse, ["ablauf-kennzeichnen test/night-x.test.mjs"]);
});

test("Regel 1: ein direkter Start eines Programms aus tools/ wird gemeldet", () => {
  const { verstoesse } = treffer({
    "test/tools-x.test.mjs": [
      'import { spawnSync } from "node:child_process";',
      'spawnSync(process.execPath, ["tools/sync-blobs.mjs", "--check"]);',
    ].join("\n"),
  });
  assert.deepEqual(verstoesse, ["ablauf-kennzeichnen test/tools-x.test.mjs"]);
});

test("Regel 1: mit Kennzeichnung im Kopf ist der Start erlaubt", () => {
  const { verstoesse } = treffer({
    "test/helpers/start.mjs": STARTENDER_HELFER,
    "test/night-x.test.mjs": `${KOPF}\nimport { nacht } from "./helpers/start.mjs";\n`,
  });
  assert.deepEqual(verstoesse, []);
});

test("Regel 1: eine Kennzeichnung unterhalb des Kopfes zaehlt nicht", () => {
  const { verstoesse } = treffer({
    "test/helpers/start.mjs": STARTENDER_HELFER,
    "test/night-x.test.mjs": `import { nacht } from "./helpers/start.mjs";\n${KOPF}`,
  });
  assert.deepEqual(verstoesse, ["ablauf-kennzeichnen test/night-x.test.mjs"]);
});

test("Regel 1: ein Kindprozess ohne Programm aus kit/ oder tools/ und ein reiner Import sind kein Start", () => {
  const { verstoesse } = treffer({
    "test/night-git.test.mjs": [
      'import { spawnSync } from "node:child_process";',
      'import { teil } from "../kit/night/beispiel.mjs";',
      'spawnSync("git", ["status"]);',
    ].join("\n"),
    "test/night-leicht.test.mjs": 'import { teil } from "../kit/night/beispiel.mjs";\n',
  });
  assert.deepEqual(verstoesse, []);
});

test("Regel 1: ein Programmpfad, der nur in einem Kommentar steht, ist kein Start", () => {
  const { verstoesse } = treffer({
    "test/helpers/leicht.mjs": [
      "// Ruft kit/checks.mjs im selben Prozess, statt es zu starten.",
      " * Frueher startete dieser Helfer \"kit/checks.mjs\" als Kindprozess.",
      'import { spawnSync } from "node:child_process";',
      'export const git = (dir) => spawnSync("git", ["status"], { cwd: dir });',
    ].join("\n"),
    "test/checks-x.test.mjs": 'import { git } from "./helpers/leicht.mjs";\n',
  });
  assert.deepEqual(verstoesse, []);
});

// --- Regel 2: keine Pausen ---------------------------------------------------

test("Regel 2: eine feste Pause wird gemeldet, in jeder ihrer Formen", () => {
  const { verstoesse } = treffer({
    "test/a.test.mjs": "await setTimeout(500);\n",
    "test/b.test.mjs": "await new Promise((r) => setTimeout(r, 100));\n",
    "test/c.test.mjs": "const pause = (ms) => new Promise((r) => setTimeout(r, ms));\nawait pause(3500);\n",
    "test/d.test.mjs": "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);\n",
  });
  assert.deepEqual(verstoesse, [
    "keine-pausen test/a.test.mjs",
    "keine-pausen test/b.test.mjs",
    "keine-pausen test/c.test.mjs",
    "keine-pausen test/d.test.mjs",
  ]);
});

const WARTE_AUF = [
  "async function warteAuf(pruefung, ms) {",
  "  const ende = Date.now() + ms;",
  "  while (!pruefung()) {",
  '    if (Date.now() > ende) throw new Error("Frist abgelaufen");',
  "    await new Promise((r) => setTimeout(r, 50));",
  "  }",
  "}",
].join("\n");

test("Regel 2: ein begrenztes Warten mit Befund ist in einer Ablauf-Pruefung erlaubt", () => {
  const { verstoesse } = treffer({ "test/a.test.mjs": `${KOPF}\n${WARTE_AUF}\n` });
  assert.deepEqual(verstoesse, []);
});

test("Regel 2: dasselbe Warten ohne Kennzeichnung wird gemeldet", () => {
  const { verstoesse } = treffer({ "test/a.test.mjs": `${WARTE_AUF}\n` });
  assert.deepEqual(verstoesse, ["keine-pausen test/a.test.mjs"]);
});

test("Regel 2: ein Warten, das bei Fristablauf still endet, wird auch gekennzeichnet gemeldet", () => {
  const still = [
    "async function warteAuf(pruefung, ms) {",
    "  const ende = Date.now() + ms;",
    "  while (!pruefung() && Date.now() < ende) {",
    "    await new Promise((r) => setTimeout(r, 50));",
    "  }",
    "}",
  ].join("\n");
  const { verstoesse } = treffer({ "test/a.test.mjs": `${KOPF}\n${still}\n` });
  assert.deepEqual(verstoesse, ["keine-pausen test/a.test.mjs"]);
});

test("Regel 2: eine Pause neben, nicht in einem warteAuf bleibt eine feste Pause", () => {
  const daneben = `${WARTE_AUF}\ntest("x", async () => {\n  await new Promise((r) => setTimeout(r, 1100));\n});\n`;
  const { verstoesse } = treffer({ "test/a.test.mjs": `${KOPF}\n${daneben}` });
  assert.deepEqual(verstoesse, ["keine-pausen test/a.test.mjs"]);
});

test("Regel 2: eine injizierte Uhr ist keine Pause", () => {
  const { verstoesse } = treffer({
    "test/a.test.mjs": "const schlaf = async () => {};\nawait warteAufProzessgruppe(1, 1000, { schlaf, pollMs: 1 });\n",
  });
  assert.deepEqual(verstoesse, []);
});

// --- Regel 3: gekennzeichnete Haenger ----------------------------------------

test("Regel 3: sleep 3 ohne # haengt wird gemeldet, mit # haengt nicht", () => {
  const { verstoesse } = treffer({
    "test/a.test.mjs": 'const fake = "touch marker && sleep 1";\n',
    "test/b.test.mjs": 'const fake = "touch marker && sleep 3 # haengt";\n',
    "test/helpers/c.mjs": 'export const FAKE = "sleep 0.05";\n',
  });
  assert.deepEqual(verstoesse, ["haenger-kennzeichnen test/a.test.mjs", "haenger-kennzeichnen test/helpers/c.mjs"]);
});

test("Regeln 2 und 3: eine Kommentarzeile ist weder Pause noch Haenger", () => {
  const { verstoesse } = treffer({
    "test/a.test.mjs": "// Gemessen mit dem Kommando \"sleep 1\" und await setTimeout(5).\n",
  });
  assert.deepEqual(verstoesse, []);
});

// --- Regel 4: Import aus dem Teil ----------------------------------------------

test("Regel 4: ein Import aus ../kit/night.mjs ohne Kennzeichnung wird gemeldet", () => {
  const { verstoesse } = treffer({
    "test/night-a.test.mjs": 'import { lauf } from "../kit/night.mjs";\n',
    "test/board-a.test.mjs": 'const { x } = await import("../kit/board.mjs");\n',
  });
  assert.deepEqual(verstoesse, ["import-aus-teil test/board-a.test.mjs", "import-aus-teil test/night-a.test.mjs"]);
});

test("Regel 4: ein Import aus dem Teil oder in einer Ablauf-Pruefung ist erlaubt", () => {
  const { verstoesse } = treffer({
    "test/night-a.test.mjs": 'import { lauf } from "../kit/night/beispiel.mjs";\n',
    "test/night-b.test.mjs": `${KOPF}import { lauf } from "../kit/night.mjs";\n`,
  });
  assert.deepEqual(verstoesse, []);
});

// --- Befundtext ----------------------------------------------------------------

test("der Befundtext nennt Regel, Datei und Grund samt Zeile", () => {
  const befunde = leichtigkeitPruefen(new Map([["test/a.test.mjs", 'x\nconst f = "sleep 1";\n']]));
  assert.match(befundeAlsText(befunde), /haenger-kennzeichnen test\/a\.test\.mjs: Zeile 2/);
});
