// Statische Windows-Pruefung auf dem Mac (Issue #1157, Plan #1150, E13 bis E17, E19).
//
// `tools/windows-brueche.mjs` meldet Stellen, die unter Windows brechen, mit Datei, Zeile,
// Art und Grund. Die reinen Regeln pruefen die exportierten Funktionen; Dateiauswahl,
// Ausgabe und Exit-Code laufen als echter Kindprozess gegen ein Wegwerf-Verzeichnis.
//
// Die Quelltexte der Faelle tragen Platzhalter statt der Woerter, auf die das Werkzeug
// anspringt (`§W` fuer den Plattformnamen, `§V` fuer den Vermerk, `§P` fuer die
// Umgebungsvariable der Programmpfade, `§T` und `§N` fuer die festen POSIX-Pfade, `§L` fuer
// den Schraegstrich als Zeichenkette): Diese Datei liegt selbst im geprueften Bestand und
// darf dort keinen Fund ausloesen.

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
const q = (...zeilen) => zeilen.join("\n")
  .replaceAll("§W", "win" + "32")
  .replaceAll("§V", "windows-" + "ausnahme")
  .replaceAll("§P", "PA" + "TH")
  .replaceAll("§T", "/t" + "mp")
  .replaceAll("§N", "/dev/" + "null")
  .replaceAll("§L", '"' + "/" + '"');

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

// ---- Regel pfade -------------------------------------------------------------

const pfadFunde = (...zeilen) => pruefeQuelle(q(...zeilen), { kontext: { datei: "test/a.test.mjs" } })
  .filter((f) => f.art === "pfade");

test("[1158] REGELN traegt die Art pfade", () => {
  const pfade = REGELN.find((r) => r.art === "pfade");
  assert.ok(pfade, "Regel pfade fehlt");
  assert.equal(typeof pfade.pruefe, "function");
});

test("[1158] pfade: eine Pfadliste mit Doppelpunkt ist ein Fund, mit path.delimiter nicht", () => {
  for (const bruch of [
    "process.env.§P = `${join(dir, \"fakebin\")}:${altPath}`;",
    "const env = { ...process.env, §P: `${bin}:${process.env.§P}` };",
    "const env = { §P: bin + \":\" + process.env.§P };",
    "const teile = process.env.§P.split(\":\");",
    "env.NODE_§P = [a, b].join(\":\");",
  ]) {
    const funde = pfadFunde(bruch);
    assert.equal(funde.length, 1, bruch);
    assert.match(funde[0].grund, /path\.delimiter/);
  }
  assert.deepEqual(pfadFunde("process.env.§P = `${bin}${delimiter}${altPath}`;"), []);
  assert.deepEqual(pfadFunde("const teile = process.env.§P.split(path.delimiter);"), []);
  // ein Doppelpunkt ohne Programmpfade ist keine Pfadliste
  assert.deepEqual(pfadFunde("const adresse = `${host}:${port}`;"), []);
});

test("[1158] pfade: ein fester POSIX-Pfad als Argument ist ein Fund, os.tmpdir() nicht", () => {
  for (const bruch of [
    'const dir = mkdtempSync("§T/probe-");',
    'writeFileSync(join("§T", "a.txt"), "x");',
    'spawnSync("node", ["x.mjs"], { cwd: "§T" });',
    'const out = openSync("§N", "w");',
  ]) {
    const funde = pfadFunde(bruch);
    assert.equal(funde.length, 1, bruch);
    assert.match(funde[0].grund, /os\.tmpdir\(\)|Nullgeraet/);
  }
  assert.deepEqual(pfadFunde('const dir = mkdtempSync(join(tmpdir(), "probe-"));'), []);
  // in einer Shell-Zeile gehoert das zur Art kommandos, in Erwartung und Kommentar ist es kein Pfad
  assert.deepEqual(pfadFunde('execSync("git status 2>§N");'), []);
  assert.deepEqual(pfadFunde(String.raw`assert.match(r.stdout, /§T\/x/);`), []);
  assert.deepEqual(pfadFunde("// Auf macOS zeigt schon `§T` auf `/private§T`."), []);
});

test("[1158] pfade: Pfadzerlegung an Schraegstrich ist ein Fund, basename nicht", () => {
  for (const bruch of ["const name = pfad.split(§L).pop();", "const name = datei.split(§L).at(-1);"]) {
    const funde = pfadFunde(bruch);
    assert.equal(funde.length, 1, bruch);
    assert.match(funde[0].grund, /basename/);
  }
  assert.deepEqual(pfadFunde("const name = basename(pfad);"), []);
  // in join gespreizt: der Text ist POSIX-Form, join setzt den Trenner der Plattform
  assert.deepEqual(pfadFunde("return join(root, ...relativ.split(§L));"), []);
  // Repo-Namen, URLs und Config-Vorlagen tragen den Schraegstrich als festes Format
  assert.deepEqual(pfadFunde("return repoName.split(§L).pop();"), []);
  assert.deepEqual(pfadFunde("const muster = (template || standard).split(§L).pop();"), []);
  assert.deepEqual(pfadFunde("const letzter = url.split(§L).pop();"), []);
});

test("[1158] pfade: eine Datendatei ist kein Fund (E15)", () => {
  const bruch = q("process.env.§P = `${bin}:${altPath}`;");
  assert.deepEqual(pruefeQuelle(bruch, { kontext: { datei: "test/fixtures/snapshot.json" } }), []);
});

test("[1158] pfade: Vermerk mit Plattformweiche nimmt einen festen Pfad aus", () => {
  assert.deepEqual(pfadFunde(
    'if (process.platform !== "§W") {',
    "  // §V: nur POSIX, dort ist das Nullgeraet eine Datei",
    '  writeFileSync("§N", "x");',
    "}",
  ), []);
});

test("[1158] Das Fixture traegt genau einen Bruch der Art pfade", () => {
  const r = lauf(["--wurzel", join(repoRoot, "test", "fixtures", "windows-brueche")]);
  assert.equal(r.status, 0, r.stderr);
  const zeilen = hinweise(r.stdout).filter((z) => z.startsWith("Hinweis: pfade.txt:"));
  assert.equal(zeilen.length, 1, r.stdout);
  assert.match(zeilen[0], /^Hinweis: pfade\.txt:\d+ — pfade: /);
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
  const zeilen = hinweise(r.stdout).filter((z) => z.startsWith("Hinweis: skips.txt:"));
  assert.equal(zeilen.length, 1, r.stdout);
  assert.match(zeilen[0], /^Hinweis: skips\.txt:\d+ — skips: /);
});

test("[1157] Der Bestand ist fundfrei (E15)", () => {
  const r = lauf([]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(hinweise(r.stdout), []);
});
