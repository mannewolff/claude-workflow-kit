// Statische Windows-Pruefung auf dem Mac (Issue #1157, Plan #1150, E13 bis E17, E19).
//
// `tools/windows-brueche.mjs` meldet Stellen, die unter Windows brechen, mit Datei, Zeile,
// Art und Grund. Die reinen Regeln pruefen die exportierten Funktionen; Dateiauswahl,
// Ausgabe und Exit-Code laufen als echter Kindprozess gegen ein Wegwerf-Verzeichnis.
//
// Die Quelltexte der Faelle tragen Platzhalter statt der Woerter, auf die das Werkzeug
// anspringt (`§W` fuer den Plattformnamen, `§V` fuer den Vermerk): Diese Datei liegt
// selbst im geprueften Bestand und darf dort keinen Fund ausloesen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGELN, pruefeQuelle, skipFunde } from "../tools/windows-brueche.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const werkzeug = join(repoRoot, "tools", "windows-brueche.mjs");

/** Setzt die Platzhalter ein und verbindet die Zeilen. */
const q = (...zeilen) => zeilen.join("\n").replaceAll("§W", "win" + "32").replaceAll("§V", "windows-" + "ausnahme");

const lauf = (args, cwd = repoRoot) => spawnSync(process.execPath, [werkzeug, ...args], { cwd, encoding: "utf-8" });
const hinweise = (stdout) => stdout.split(/\r?\n/).filter((z) => z.startsWith("Hinweis: "));

function wegwerf(dateien) {
  const dir = mkdtempSync(join(tmpdir(), "windows-brueche-"));
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(dir, pfad)), { recursive: true });
    writeFileSync(join(dir, pfad), inhalt);
  }
  return dir;
}

// ---- Regel skips ------------------------------------------------------------

test("[1157] REGELN traegt die Art skips mit Kennung und Pruefung", () => {
  const skips = REGELN.find((r) => r.art === "skips");
  assert.ok(skips, "Regel skips fehlt");
  assert.equal(typeof skips.pruefe, "function");
});

test("[1157] skips: eine Skip-Zeile mit dem Plattformnamen ist ein Fund", () => {
  assert.deepEqual(skipFunde(q('test("x", () => {});', 'test("y", { skip: process.platform === "§W" }, () => {});')), [2]);
});

test("[1157] skips: eine NUR_POSIX-Konstante ueber mehrere Zeilen ist ein Fund", () => {
  assert.deepEqual(skipFunde(q('const NUR_POSIX_SYMLINK = process.platform === "§W"', '  ? { skip: "Windows: kein Privileg." }', "  : {};")), [1]);
  assert.deepEqual(skipFunde(q('const OHNE = process.platform === "§W"', '  ? { skip: "Windows" }', "  : {};")), [1]);
});

test("[1157] skips: injizierte Plattform und Faehigkeits-Skip sind kein Fund", () => {
  assert.deepEqual(skipFunde(q(
    'const r = gitBashPfad({ plattform: "§W", existiert: () => true });',
    "assert.equal(r.pfad, null);",
    'test("z", { skip: !hatGh }, () => {});',
  )), []);
});

test("[1157] skips: eine Datendatei ist kein Test und kein Fund (E15)", () => {
  const bruch = q(String.raw`"body": "test(\"y\", { skip: process.platform === \"§W\" })"`);
  for (const datei of ["test/fixtures/snapshot.json", "a.jsonl", "lauf.log"]) {
    assert.deepEqual(pruefeQuelle(bruch, { kontext: { datei } }), [], datei);
  }
  assert.equal(pruefeQuelle(bruch, { kontext: { datei: "test/a.test.mjs" } }).length, 1);
});

test("[1157] pruefeQuelle meldet den Fund mit Art und Grund", () => {
  const funde = pruefeQuelle(q('test("y", { skip: process.platform === "§W" }, () => {});'));
  assert.equal(funde.length, 1);
  assert.equal(funde[0].zeile, 1);
  assert.equal(funde[0].art, "skips");
  assert.match(funde[0].grund, /Plattformnamen/);
});

// ---- Vermerk (E14) ----------------------------------------------------------

test("[1157] Vermerk mit Grund und Plattformweiche nimmt die Stelle aus", () => {
  // in derselben Zeile
  assert.deepEqual(pruefeQuelle(q('test("y", { skip: process.platform === "§W" }, () => {}); // §V: nur Beispiel')), []);
  // in der Zeile davor
  assert.deepEqual(pruefeQuelle(q("// §V: nur Beispiel", 'test("y", { skip: process.platform === "§W" }, () => {});')), []);
});

test("[1157] Vermerk ohne Plattformweiche in den fuenf Zeilen davor ist ein Fund", () => {
  // Eine Skip-Zeile traegt den Plattformnamen immer selbst; die Weiche pruefen darum eine
  // eigene Probe-Regel, deren Stelle keine Weiche enthaelt.
  const regel = { art: "probe", pruefe: (zeilen) => zeilen.flatMap((z, i) => (z.includes("PROBE") ? [{ zeile: i + 1, grund: "Probe" }] : [])) };
  const ohne = q("a();", "b();", "// §V: Grund steht da", "PROBE();");
  assert.deepEqual(pruefeQuelle(ohne, { regeln: [regel] }).map((f) => [f.zeile, f.art, f.grund]), [[4, "probe", "Vermerk ohne Plattformzweig"]]);
  const mit = q("if (process.platform === \"§W\") {", "b();", "// §V: Grund steht da", "PROBE();");
  assert.deepEqual(pruefeQuelle(mit, { regeln: [regel] }), []);
  // fuenf Zeilen vor der Stelle zaehlen noch, sechs nicht mehr
  const weit = q("if (plattform) {", "b();", "c();", "d();", "// §V: Grund steht da", "PROBE();");
  assert.deepEqual(pruefeQuelle(weit, { regeln: [regel] }).map((f) => f.grund), []);
  const zuWeit = q("if (plattform) {", "a();", "b();", "c();", "d();", "e();", "// §V: Grund steht da", "PROBE();");
  assert.deepEqual(pruefeQuelle(zuWeit, { regeln: [regel] }).map((f) => f.grund), ["Vermerk ohne Plattformzweig"]);
});

test("[1157] Vermerk ohne Grund ist selbst ein Fund", () => {
  assert.deepEqual(pruefeQuelle(q('test("y", { skip: process.platform === "§W" }, () => {}); // §V:')).map((f) => [f.art, f.grund]),
    [["skips", "Vermerk ohne Grund"]]);
  // auch ohne Stelle daneben
  assert.deepEqual(pruefeQuelle(q("a();", "// §V:", "b();")).map((f) => [f.zeile, f.art, f.grund]), [[2, "vermerk", "Vermerk ohne Grund"]]);
  // Markdown-Form
  assert.deepEqual(pruefeQuelle(q("<!-- §V: -->", "ls")).map((f) => f.grund), ["Vermerk ohne Grund"]);
  assert.deepEqual(pruefeQuelle(q("<!-- §V: Grund -->", "ls")), []);
});

// ---- Werkzeug als Kindprozess -----------------------------------------------

test("[1157] --wurzel liest jede Datei, auch .txt, und meldet je Fund eine Hinweis-Zeile; Exit 0", () => {
  const dir = wegwerf({ "a.txt": q("x();", 'test("y", { skip: process.platform === "§W" }, () => {});'), "unter/b.mjs": "ok();\n" });
  try {
    const r = lauf(["--wurzel", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(hinweise(r.stdout), ["Hinweis: a.txt:2 — skips: Test ueberspringt sich nach dem Plattformnamen statt nach einer Faehigkeit"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1157] --json gibt die Funde als Liste aus", () => {
  const dir = wegwerf({ "a.txt": q('test("y", { skip: process.platform === "§W" }, () => {});') });
  try {
    const r = lauf(["--wurzel", dir, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const funde = JSON.parse(r.stdout);
    assert.deepEqual(funde.map((f) => [f.datei, f.zeile, f.art]), [["a.txt", 1, "skips"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1157] --namen wird gelesen; eine fehlende Datei ist ein eigener Fehler mit Exit 2", () => {
  const dir = wegwerf({ "namen.txt": "a.mjs\nb.mjs\n" });
  try {
    assert.equal(lauf(["--wurzel", dir, "--namen", join(dir, "namen.txt")]).status, 0);
    assert.equal(lauf(["--wurzel", dir, "--namen", join(dir, "fehlt.txt")]).status, 2);
    assert.equal(lauf(["--wurzel", join(dir, "fehlt")]).status, 2);
    assert.equal(lauf(["--unbekannt"]).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1157] Dateiauswahl im Bestand: Bash-Block einer Skill-Datei ja, Fliesstext nein, .claude/ und Fixtures nein", () => {
  const bruch = q('test("y", { skip: process.platform === "§W" }, () => {});');
  const dir = wegwerf({
    "skills/probe/SKILL.md": q("# Probe", "", bruch, "", "```bash", bruch, "```", "", "```js", bruch, "```"),
    "templates/VORLAGE.md": q("```sh", bruch, "```"),
    "kit/k.mjs": bruch,
    "install.mjs": bruch,
    ".githooks/pre-commit": bruch,
    ".claude/kit/k.mjs": bruch,
    "test/fixtures/windows-brueche/f.txt": bruch,
    "docs/d.mjs": bruch,
  });
  try {
    const r = lauf([], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(hinweise(r.stdout).map((z) => z.split(" — ")[0]).sort(), [
      "Hinweis: .githooks/pre-commit:1",
      "Hinweis: install.mjs:1",
      "Hinweis: kit/k.mjs:1",
      "Hinweis: skills/probe/SKILL.md:6",
      "Hinweis: templates/VORLAGE.md:2",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1157] Das Fixture traegt genau einen Bruch der Art skips", () => {
  const r = lauf(["--wurzel", join(repoRoot, "test", "fixtures", "windows-brueche")]);
  assert.equal(r.status, 0, r.stderr);
  const zeilen = hinweise(r.stdout);
  assert.equal(zeilen.length, 1, r.stdout);
  assert.match(zeilen[0], /^Hinweis: skips\.txt:\d+ — skips: /);
});

test("[1157] Der Bestand ist fundfrei (E15)", () => {
  const r = lauf([]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(hinweise(r.stdout), []);
});
