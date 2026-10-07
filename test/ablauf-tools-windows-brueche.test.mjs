// Ablauf-Pruefung: ein Teil der Faelle prueft die Kommandozeile von tools/windows-brueche.mjs mit Ausgabe und Exitcode.
//
// Statische Windows-Pruefung auf dem Mac (Issue #1157, Plan #1150, E13 bis E17, E19).
//
// `tools/windows-brueche.mjs` meldet Stellen, die unter Windows brechen, mit Datei, Zeile,
// Art und Grund. Die reinen Regeln pruefen die exportierten Funktionen; Dateiauswahl,
// Ausgabe und Exit-Code laufen als echter Kindprozess gegen ein Wegwerf-Verzeichnis.
//
// Die Quelltexte der Faelle tragen Platzhalter statt der Woerter, auf die das Werkzeug
// anspringt (`§W` fuer den Plattformnamen, `§V` fuer den Vermerk, `§P` fuer die
// Umgebungsvariable der Programmpfade, `§T` und `§N` fuer die festen POSIX-Pfade, `§L` fuer
// den Schraegstrich als Zeichenkette, `§S` und `§B` fuer die Shell als Zeichenkette, `§X`
// fuer ihren Namen, `§Y` fuer eine Shell-Variable, `§D`
// fuer die Kommandoersetzung, `§E` fuer die Variable des Temp-Ordners, `§C` fuer ihren
// Rueckfall, `§H` fuer den Aufruf, der Dateirechte setzt, `§K` fuer das Shell-Kommando
// dazu, `§M` fuer das Feld der Dateirechte, `§R` fuer den Kill mit negativer PID, `§A` fuer
// die eigene Prozessgruppe, `§O` und `§I` fuer die Signalnamen als Zeichenkette, `§Z` fuer
// das Zerlegen an LF, `§G` fuer das Init-Kommando als Zeichenkette, `§F` fuer den Shebang): Diese
// Datei liegt selbst im geprueften Bestand und darf dort keinen Fund ausloesen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGELN, namenFunde, pruefeQuelle, skipFunde } from "../tools/windows-brueche.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const werkzeug = join(repoRoot, "tools", "windows-brueche.mjs");

/** Setzt die Platzhalter ein und verbindet die Zeilen. */
const q = (...zeilen) => zeilen.join("\n")
  .replaceAll("§W", "win" + "32")
  .replaceAll("§V", "windows-" + "ausnahme")
  .replaceAll("§P", "PA" + "TH")
  .replaceAll("§T", "/t" + "mp")
  .replaceAll("§N", "/dev/" + "null")
  .replaceAll("§L", '"' + "/" + '"')
  .replaceAll("§S", '"' + "s" + "h" + '"')
  .replaceAll("§B", '"' + "ba" + "sh" + '"')
  .replaceAll("§D", "$" + "(")
  .replaceAll("§E", "$" + "TMPDIR")
  .replaceAll("§C", "cyg" + 'path -m "$TEMP"')
  .replaceAll("§X", "s" + "h")
  .replaceAll("§Y", "$" + "HOME")
  .replaceAll("§H", "ch" + "modSync")
  .replaceAll("§K", "ch" + "mod")
  .replaceAll("§M", "mo" + "de")
  .replaceAll("§R", "ki" + "ll(-")
  .replaceAll("§A", "detac" + "hed: true")
  .replaceAll("§O", '"SIG' + 'TERM"')
  .replaceAll("§I", '"SIG' + 'INT"')
  .replaceAll("§Z", ".split(" + '"' + "\\" + "n" + '"' + ")")
  .replaceAll("§G", '"in' + 'it"')
  .replaceAll("§F", "#" + "!");

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

// ---- Regel kommandos ---------------------------------------------------------

const kommandoFunde = (datei, ...zeilen) => pruefeQuelle(q(...zeilen), { kontext: { datei } })
  .filter((f) => f.art === "kommandos");

test("[1159] REGELN traegt die Art kommandos", () => {
  const kommandos = REGELN.find((r) => r.art === "kommandos");
  assert.ok(kommandos, "Regel kommandos fehlt");
  assert.equal(typeof kommandos.pruefe, "function");
});

test("[1159] kommandos: POSIX-Shellsyntax in einem Zeichenketten-Aufruf ist ein Fund", () => {
  for (const bruch of [
    'const kopf = execSync("git rev-parse HEAD 2>§N");',
    "const ast = execSync(`git branch --show-current §D git rev-parse HEAD)`);",
    'exec("echo §Y", (fehler) => {});',
    'const r = child.execSync("git status >§N", { encoding: "utf-8" });',
    'spawnSync("git log 2>§N", { shell: true });',
    ['const r = spawn(', '  "echo §D date)",', "  { shell: true, stdio: \"pipe\" },", ");"],
  ]) {
    const funde = kommandoFunde("kit/a.mjs", ...[bruch].flat());
    assert.equal(funde.length, 1, String(bruch));
    assert.equal(funde[0].zeile, 1);
    assert.match(funde[0].grund, /POSIX-Shellsyntax/);
  }
});

test("[1159] kommandos: dieselbe Syntax ohne Shell, als JS-Einsetzung oder in einem Argument-Array ist kein Fund", () => {
  for (const ok of [
    // ohne shell reicht spawn die Zeichenkette als ein Argument weiter, keine Shell liest sie
    'spawnSync("git", ["log", "2>§N"]);',
    // `${…}` setzt JavaScript ein, nicht die Shell
    "execSync(`git show ${rev}`);",
    'execSync("git rev-parse HEAD", { stdio: "pipe" });',
    // RegExp#exec ist kein Prozessaufruf
    'const m = /§D/.exec("§D x");',
  ]) {
    assert.deepEqual(kommandoFunde("kit/a.mjs", ok), [], ok);
  }
});

test("[1159] kommandos: sh oder bash woertlich als Programm ist ein Fund", () => {
  for (const bruch of [
    'const r = spawnSync(§S, ["-c", "command -v git"]);',
    'spawn(§B, ["skript.sh"], { stdio: "inherit" });',
    'execFileSync("/bin/" + "x", []); execFileSync(§S, ["-c", "true"]);',
    'execSync("§X -c ls");',
    'execSync("ba§X skript.sh");',
  ]) {
    const funde = kommandoFunde("test/a.test.mjs", bruch);
    assert.equal(funde.length, 1, bruch);
    assert.match(funde[0].grund, /Git-Bash-Aufloesung/);
  }
});

test("[1159] kommandos: die Shell aus der Git-Bash-Aufloesung ist kein Fund", () => {
  for (const ok of [
    'const r = spawnSync(posixShell(), ["-c", "command -v git"]);',
    'const aufruf = spawnAufruf(shell.pfad, ["-c", \'command -v -- "$1"\', §S, programm], shell);',
    'spawnSync(shell.pfad, ["-c", "true"]);',
    // ein Argument namens sh ist kein Programm
    'spawnSync("git", ["log", §S]);',
  ]) {
    assert.deepEqual(kommandoFunde("kit/a.mjs", ok), [], ok);
  }
});

test("[1159] kommandos: ein konfiguriertes Projektkommando mit shell: true ist kein Fund (Fund 11)", () => {
  // die Zeile aus kit/checks.mjs, dazu die ausgeschriebene Form
  assert.deepEqual(kommandoFunde("kit/checks.mjs", "    const kind = spawn(cmd, { cwd: process.cwd(), env, ...startOptionen() });"), []);
  assert.deepEqual(kommandoFunde("kit/checks.mjs", "const kind = spawn(cmd, { shell: true });"), []);
  assert.deepEqual(kommandoFunde("kit/worktree.mjs", 'const res = spawnSync(kommando, { cwd: pfad, encoding: "utf-8", shell: true });'), []);
});

test("[1159] kommandos: Vermerk mit Plattformweiche nimmt einen POSIX-Zweig aus", () => {
  assert.deepEqual(kommandoFunde("test/a.test.mjs",
    'if (process.platform !== "§W") {',
    "  // §V: nur POSIX, unter Windows steht die Git Bash im Zweig daneben",
    '  spawnSync(§S, ["-c", "true"]);',
    "}",
  ), []);
});

test("[1159] kommandos: $TMPDIR im Bash-Block ohne cygpath-Rueckfall im Abschnitt ist ein Fund", () => {
  const funde = kommandoFunde("skills/x/SKILL.md", "## Bericht", "", "```bash", 'cat > "§E/x.md"', "```");
  assert.deepEqual(funde.map((f) => f.zeile), [4]);
  assert.match(funde[0].grund, /cygpath/);
  // auch in der Form mit Klammern und in einem sh-Block
  assert.equal(kommandoFunde("templates/V.md", "## A", "```sh", 'ls "${TMPDIR}"', "```").length, 1);
  // der Rueckfall in einem anderen Abschnitt hilft nicht
  assert.deepEqual(kommandoFunde("skills/x/SKILL.md",
    "## Eins", "Sonst gilt `§C`.", "## Zwei", "```bash", 'cat > "§E/x.md"', "```").map((f) => f.zeile), [5]);
});

test("[1159] kommandos: $TMPDIR mit cygpath-Rueckfall im Abschnitt, ausserhalb eines Bash-Blocks oder im Code ist kein Fund", () => {
  // Rueckfall im Fliesstext desselben Abschnitts
  assert.deepEqual(kommandoFunde("skills/x/SKILL.md",
    "## Bericht", "Bleibt `printenv TMPDIR` leer, gilt `§C`.", "```bash", 'cat > "§E/x.md"', "```"), []);
  // Rueckfall im Block selbst
  assert.deepEqual(kommandoFunde("skills/x/SKILL.md",
    "## Bericht", "```bash", 'd="${TMPDIR:-$(§C)}"', 'cat > "§E/x.md"', "```"), []);
  // Fliesstext und Bloecke anderer Sprachen
  assert.deepEqual(kommandoFunde("skills/x/SKILL.md", "## A", "Die Datei liegt in `§E`.", "```js", "const d = '§E';", "```"), []);
  // eine Code-Datei traegt keine Bash-Bloecke, auch wenn ihr Text so aussieht
  assert.deepEqual(kommandoFunde("test/a.test.mjs", "const md = `", "```bash", 'cat > "§E/x.md"', "```", "`;"), []);
});

test("[1159] Das Fixture traegt je genau einen Bruch der Art kommandos in Code und Markdown", () => {
  const r = lauf(["--wurzel", join(repoRoot, "test", "fixtures", "windows-brueche")]);
  assert.equal(r.status, 0, r.stderr);
  for (const datei of ["kommandos.txt", "kommandos-skill.txt"]) {
    const zeilen = hinweise(r.stdout).filter((z) => z.startsWith(`Hinweis: ${datei}:`));
    assert.equal(zeilen.length, 1, r.stdout);
    assert.ok(zeilen[0].startsWith(`Hinweis: ${datei}:`) && zeilen[0].includes(" — kommandos: "), zeilen[0]);
  }
});

test("[1159] Dateiauswahl im Bestand: $TMPDIR im Bash-Block einer Skill-Datei, Fliesstext nur fuer den Rueckfall", () => {
  const dir = wegwerf({
    "skills/ohne/SKILL.md": q("# Ohne", "", "## Bericht", "", "Erst §E pruefen.", "", "```bash", 'cat > "§E/x.md"', "```"),
    "skills/mit/SKILL.md": q("# Mit", "", "## Bericht", "", "Sonst gilt `§C`.", "", "```bash", 'cat > "§E/x.md"', "```"),
  });
  try {
    const r = lauf([], dir);
    assert.equal(r.status, 0, r.stderr);
    const zeilen = hinweise(r.stdout);
    assert.equal(zeilen.length, 1, r.stdout);
    assert.match(zeilen[0], /^Hinweis: skills\/ohne\/SKILL\.md:8 — kommandos: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Regel dateien ------------------------------------------------------------

const dateiFunde = (datei, ...zeilen) => pruefeQuelle(q(...zeilen), { kontext: { datei } })
  .filter((f) => f.art === "dateien");

test("[1160] REGELN traegt die Art dateien", () => {
  const dateien = REGELN.find((r) => r.art === "dateien");
  assert.ok(dateien, "Regel dateien fehlt");
  assert.equal(typeof dateien.pruefe, "function");
});

test("[1160] dateien: ein Name mit unter Windows verbotenem Zeichen ist ein Fund", () => {
  for (const name of ["docs/a:b.md", "x<y", "x>y", 'zitat"e.txt', "a|b", "frage?.md", "stern*.txt", "steuer\u0001.txt"]) {
    const funde = namenFunde(["ok.mjs", name]);
    assert.deepEqual(funde.map((f) => f.index), [1], JSON.stringify(name));
    assert.match(funde[0].grund, /verbotenes Zeichen/);
  }
});

test("[1160] dateien: ein reservierter Name ist ein Fund, auch mit Endung, Kleinschreibung und als Ordner", () => {
  for (const name of ["CON", "nul.txt", "kit/Aux.mjs", "com1/datei.md", "LPT9.log", "prn"]) {
    const funde = namenFunde([name]);
    assert.equal(funde.length, 1, name);
    assert.match(funde[0].grund, /reservierter Name/);
  }
  // nur der ganze Teil vor dem ersten Punkt zaehlt
  assert.deepEqual(namenFunde(["console.mjs", "nullen.txt", "com10.md", "auxiliar/a.md", "test/con-fig.mjs"]), []);
});

test("[1160] dateien: Namen, die sich nur in der Schreibweise unterscheiden, sind ein Fund", () => {
  const funde = namenFunde(["docs/README.md", "kit/a.mjs", "docs/readme.md"]);
  assert.deepEqual(funde.map((f) => f.index), [2]);
  assert.match(funde[0].grund, /Schreibweise/);
  assert.match(funde[0].grund, /docs\/README\.md/);
  // auch ein Ordner, der sich nur in der Schreibweise unterscheidet
  assert.deepEqual(namenFunde(["Docs/a.md", "docs/b.md"]).map((f) => f.index), [1]);
  // derselbe Ordner mit verschiedenen Dateien ist kein Fund
  assert.deepEqual(namenFunde(["docs/a.md", "docs/b.md", "docs/A-b.md"]), []);
});

test("[1160] dateien: ein chmod, das dem Eigentuemer das Leserecht nimmt, ist ein Fund", () => {
  for (const bruch of [
    "§H(datei, 0o000);",
    "§H(join(dir, \"geheim.txt\"), 0o200);",
    "fs.§H(ordner, 0);",
    "await §K(ordner, \"000\");",
  ]) {
    const funde = dateiFunde("test/a.test.mjs", bruch);
    assert.equal(funde.length, 1, bruch);
    assert.match(funde[0].grund, /Leserecht/);
  }
  // ueber mehrere Zeilen
  assert.equal(dateiFunde("test/a.test.mjs", "§H(", "  join(dir, \"x\"),", "  0o000,", ");").length, 1);
  // in einem Bash-Block
  assert.equal(dateiFunde("skills/x/SKILL.md", "```bash", "§K 000 geheim.txt", "```").length, 1);
  assert.equal(dateiFunde("skills/x/SKILL.md", "```bash", "§K a-r geheim.txt", "```").length, 1);
});

test("[1160] dateien: Ausfuehrbarkeit setzen, Schreibschutz und ein Modus aus einer Variable sind kein Fund", () => {
  for (const ok of [
    "§H(join(bin, \"claude\"), 0o755);",
    "§H(datei, 0o644);",
    "§H(datei, 0o444);",
    "§H(pfad, modus);",
    "spawnSync(\"§K\", [\"+x\", pfad]);",
    "accessSync(p, constants.X_OK);",
    "// Unter Windows wirkt §K nicht als Leseschutz.",
  ]) {
    assert.deepEqual(dateiFunde("test/a.test.mjs", ok), [], ok);
  }
  assert.deepEqual(dateiFunde("skills/x/SKILL.md", "```bash", "§K +x .githooks/pre-commit", "```"), []);
});

test("[1160] dateien: die x-Bits aus stat lesen ist ein Fund, andere Bits nicht", () => {
  for (const bruch of [
    "assert.equal((statSync(p).§M & 0o111) !== 0, true);",
    "const ausfuehrbar = (§M & 0o100) !== 0;",
  ]) {
    const funde = dateiFunde("test/a.test.mjs", bruch);
    assert.equal(funde.length, 1, bruch);
    assert.match(funde[0].grund, /x-Bits/);
  }
  assert.deepEqual(dateiFunde("test/a.test.mjs", "const art = statSync(p).§M & 0o170000;"), []);
  assert.deepEqual(dateiFunde("test/a.test.mjs", "const schreibbar = (§M & 0o200) !== 0;"), []);
});

test("[1160] dateien: ein Leseschutz unter der Faehigkeit MIT_DATEIRECHTEN ist kein Fund", () => {
  assert.deepEqual(dateiFunde("test/a.test.mjs",
    'test("gesperrt", MIT_DATEIRECHTEN, () => {',
    "  const ordner = join(dir, \"x\");",
    "  a();", "  b();", "  c();", "  d();", "  e();",
    "  §H(ordner, 0o000);",
    "});",
  ), []);
  // die Probe der Faehigkeit selbst
  assert.deepEqual(dateiFunde("test/helpers/h.mjs",
    "function dateirechteGreifen() {",
    "  const probe = mkdtempSync(join(tmpdir(), \"p-\"));",
    "  try {",
    "    §H(probe, 0o000);",
  ), []);
  // ein anderer Test davor nimmt nichts aus
  assert.equal(dateiFunde("test/a.test.mjs",
    'test("gesperrt", MIT_DATEIRECHTEN, () => {});',
    'test("offen", () => {',
    "  §H(ordner, 0o000);",
    "});",
  ).length, 1);
});

test("[1160] dateien: Vermerk mit Plattformweiche nimmt einen POSIX-Zweig aus", () => {
  assert.deepEqual(dateiFunde("test/a.test.mjs",
    'if (process.platform !== "§W") {',
    "  // §V: unter Windows steht ein Verzeichnis an Stelle der Datei",
    "  §H(datei, 0o000);",
    "}",
  ), []);
});

test("[1160] --namen meldet je Fund die Zeile der Namensliste; ohne --namen und ohne Git keine Namenspruefung", () => {
  const dir = wegwerf({ "namen.txt": "kit/a.mjs\n\nkit/b?.mjs\nKit/A.mjs\n", "c.mjs": "ok();\n" });
  try {
    const r = lauf(["--wurzel", dir, "--namen", join(dir, "namen.txt")]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(hinweise(r.stdout).map((z) => z.split(" — ")[0] + " — " + z.split(" — ")[1].split(":")[0]), [
      "Hinweis: namen.txt:3 — dateien",
      "Hinweis: namen.txt:4 — dateien",
    ]);
    assert.deepEqual(hinweise(lauf(["--wurzel", dir]).stdout), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1160] Im Bestand kommen die Namen aus git ls-files, ohne echte Datei", () => {
  const dir = wegwerf({});
  try {
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
    lfAttribute(join(dir, ".gitattributes"));
    assert.equal(git("init", "-q").status, 0);
    const blob = git("hash-object", "-w", "--stdin").stdout.trim();
    for (const name of ["kit/a.mjs", "kit/b|c.mjs"]) {
      // git unter Windows weist den verbotenen Namen sonst wegen core.protectNTFS ab (#1172)
      assert.equal(git("-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${blob},${name}`).status, 0);
    }
    const r = lauf([], dir);
    assert.equal(r.status, 0, r.stderr);
    const zeilen = hinweise(r.stdout);
    assert.equal(zeilen.length, 1, r.stdout);
    assert.match(zeilen[0], /^Hinweis: kit\/b\|c\.mjs:1 — dateien: .*verbotenes Zeichen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1160] Das Fixture traegt je genau einen Bruch der Art dateien in Namensliste und Inhalt", () => {
  const fixtures = join(repoRoot, "test", "fixtures", "windows-brueche");
  const r = lauf(["--wurzel", fixtures, "--namen", join(fixtures, "dateien-namen.txt")]);
  assert.equal(r.status, 0, r.stderr);
  const zeilen = hinweise(r.stdout).filter((z) => z.includes(" — dateien: "));
  assert.equal(zeilen.length, 2, r.stdout);
  assert.match(zeilen[0], /^Hinweis: dateien-namen\.txt:\d+ — dateien: /);
  assert.match(zeilen[1], /^Hinweis: dateien\.txt:\d+ — dateien: /);
  // die Namensliste traegt genau zwei Namen, von denen einer zulaessig ist
  const namen = readFileSync(join(fixtures, "dateien-namen.txt"), "utf-8").split(/\r?\n/).filter(Boolean);
  assert.equal(namen.length, 2);
  assert.equal(namenFunde(namen).length, 1);
});

// ---- Regel prozesse -----------------------------------------------------------

const prozessFunde = (datei, ...zeilen) => pruefeQuelle(q(...zeilen), { kontext: { datei } })
  .filter((f) => f.art === "prozesse");

test("[1161] REGELN traegt die Art prozesse", () => {
  const prozesse = REGELN.find((r) => r.art === "prozesse");
  assert.ok(prozesse, "Regel prozesse fehlt");
  assert.equal(typeof prozesse.pruefe, "function");
});

test("[1161] prozesse: ein Kill mit negativer PID ist ein Fund", () => {
  for (const zeile of ["process.§Rkind.pid, \"SIGTERM\");", "process.§R pid);", "  try { process.§Rchild.pid, signal); } catch {}"]) {
    const funde = prozessFunde("kit/a.mjs", "x();", zeile);
    assert.deepEqual(funde.map((f) => f.zeile), [2], zeile);
    assert.match(funde[0].grund, /Prozessgruppe/);
  }
});

test("[1161] prozesse: ein Kill mit positiver PID oder als Kommentar ist kein Fund", () => {
  for (const zeile of ["process.kill(pid, 0);", "process.kill(aufruf.pid, aufruf.signal);", "kind.kill(\"SIGTERM\");",
    "// process.§Rpid) trifft die Gruppe", " * process.§Rpid) trifft die Gruppe"]) {
    assert.deepEqual(prozessFunde("kit/a.mjs", zeile), [], zeile);
  }
});

test("[1161] prozesse: eine eigene Prozessgruppe per detached ist ein Fund", () => {
  const funde = prozessFunde("kit/a.mjs", "const kind = spawn(cmd, args, {", "  §A,", "  stdio: \"pipe\",", "});");
  assert.deepEqual(funde.map((f) => f.zeile), [2]);
  assert.match(funde[0].grund, /detached/);
  assert.equal(prozessFunde("kit/a.mjs", "spawn(cmd, args, { §A, stdio: \"inherit\" });").length, 1);
});

test("[1161] prozesse: detached mit windowsHide, mit unref, aus einer Weiche oder als Kommentar ist kein Fund", () => {
  assert.deepEqual(prozessFunde("kit/a.mjs", "return { cwd, §A, stdio: \"ignore\", windowsHide: true };"), []);
  assert.deepEqual(prozessFunde("kit/a.mjs", "spawn(cmd, args, {", "  windowsHide: true,", "  §A,", "});"), []);
  assert.deepEqual(prozessFunde("test/a.test.mjs", "const s = 'spawn(x, [], { §A, stdio: \"inherit\" }).unref()';"), []);
  assert.deepEqual(prozessFunde("kit/a.mjs", "spawn(cmd, args, { detached: process.platform !== \"§W\" });"), []);
  assert.deepEqual(prozessFunde("kit/a.mjs", "// (`§A`) gibt dem Kind eine eigene Gruppe"), []);
});

test("[1161] prozesse: ein Signal-Handler in einem Test ist ein Fund", () => {
  for (const signal of ["§O", "§I"]) {
    const funde = prozessFunde("test/a.test.mjs", "x();", `process.on(${signal}, () => process.exit(0));`);
    assert.deepEqual(funde.map((f) => f.zeile), [2], signal);
    assert.match(funde[0].grund, /Signal/);
  }
  assert.equal(prozessFunde("test/helpers/fake.mjs", "process.once(§O, () => {});").length, 1);
  // eine Datei, die node:test laedt, ist ein Test, auch ausserhalb von test/
  assert.equal(prozessFunde("probe.txt", 'import { test } from "node:test";', "process.on(§O, () => {});").length, 1);
});

test("[1161] prozesse: ein Signal-Handler im Kit-Code, ein anderes Signal oder ein Kommentar ist kein Fund", () => {
  assert.deepEqual(prozessFunde("kit/a.mjs", "process.on(§O, () => laufAbbrechen());"), []);
  assert.deepEqual(prozessFunde("test/a.test.mjs", 'process.on("uncaughtException", (e) => {});'), []);
  assert.deepEqual(prozessFunde("test/a.test.mjs", "// process.on(§O) wuerde hier nie feuern"), []);
});

test("[1161] prozesse: eine Plattformweiche ohne Vermerk nimmt nicht aus, mit Vermerk schon", () => {
  // Kriterium 2 der Quelle #1147: Ausgenommen ist eine Stelle nur mit Vermerk daneben.
  assert.equal(prozessFunde("kit/a.mjs", 'if (process.platform !== "§W") {', "  process.§Rpid, signal);", "}").length, 1);
  assert.deepEqual(prozessFunde("kit/a.mjs",
    'if (process.platform !== "§W") {',
    "  // §V: Prozessgruppen gibt es nur auf POSIX, Windows nimmt taskkill",
    "  process.§Rpid, signal);",
    "}",
  ), []);
  assert.deepEqual(prozessFunde("kit/a.mjs", "// §V: Grund steht da", "process.§Rpid, signal);").map((f) => f.grund),
    ["Vermerk ohne Plattformzweig"]);
});

test("[1161] Das Fixture traegt genau einen Bruch der Art prozesse", () => {
  const r = lauf(["--wurzel", join(repoRoot, "test", "fixtures", "windows-brueche")]);
  assert.equal(r.status, 0, r.stderr);
  const zeilen = hinweise(r.stdout).filter((z) => z.includes(" — prozesse: "));
  assert.equal(zeilen.length, 1, r.stdout);
  assert.match(zeilen[0], /^Hinweis: prozesse\.txt:\d+ — prozesse: /);
});

// ---- Regel zeilenenden ---------------------------------------------------------

const zeilenFunde = (datei, ...zeilen) => pruefeQuelle(q(...zeilen), { kontext: { datei } })
  .filter((f) => f.art === "zeilenenden");

test("[1162] REGELN traegt die Art zeilenenden", () => {
  const zeilenenden = REGELN.find((r) => r.art === "zeilenenden");
  assert.ok(zeilenenden, "Regel zeilenenden fehlt");
  assert.equal(typeof zeilenenden.pruefe, "function");
  assert.equal(q("x§Z"), String.raw`x.split("\n")`);
});

test("[1162] zeilenenden: Zerlegen an LF auf Dateiinhalt oder Prozessausgabe im selben Ausdruck ist ein Fund", () => {
  for (const zeile of [
    'const z = readFileSync(p, "utf-8")§Z;',
    'const z = (await readFile(p, "utf-8")).trim()§Z;',
    'const z = execFileSync("git", ["log"], { encoding: "utf-8" }).trim()§Z;',
    'const z = spawnSync("git", ["status"], { encoding: "utf-8" }).stdout§Z;',
    "for (const z of r.stdout.trim()§Z) {}",
    "const z = r.stderr§Z.filter(Boolean);",
  ]) {
    const funde = zeilenFunde("kit/a.mjs", "x();", zeile);
    assert.deepEqual(funde.map((f) => f.zeile), [2], zeile);
    assert.match(funde[0].grund, /\\r\?\\n/);
  }
  // die Kette ueber mehrere Zeilen
  assert.deepEqual(zeilenFunde("kit/a.mjs", 'const z = readFileSync(p, "utf-8")', "  .trim()", "  §Z;").map((f) => f.zeile), [3]);
});

test("[1162] zeilenenden: Zerlegen an LF ueber eine Variable aus Datei oder Prozess in derselben Funktion ist ein Fund", () => {
  assert.deepEqual(zeilenFunde("kit/a.mjs",
    "function lies(p) {", '  const text = readFileSync(p, "utf-8");', "  return text§Z;", "}").map((f) => f.zeile), [3]);
  assert.deepEqual(zeilenFunde("kit/a.mjs",
    "function lies() {", '  const out = execSync("git log", {', '    encoding: "utf-8",', "  });", "  return out.trim()§Z;", "}").map((f) => f.zeile), [5]);
  assert.deepEqual(zeilenFunde("kit/a.mjs",
    "function lies() {", '  const { stdout } = spawnSync("git", ["log"], { encoding: "utf-8" });', "  return stdout§Z;", "}").map((f) => f.zeile), [3]);
  assert.deepEqual(zeilenFunde("kit/a.mjs",
    "function lies(p) {", '  const raw = readFileSync(p, "utf-8");', "  return raw.slice(start, ende(raw)).trim()§Z;", "}").map((f) => f.zeile), [3]);
});

test(String.raw`[1162] zeilenenden: selbst gebaute Zeichenketten, /\r?\n/ und eine Variable aus einer anderen Funktion sind kein Fund`, () => {
  assert.deepEqual(zeilenFunde("kit/a.mjs", "const z = bericht§Z;"), []);
  assert.deepEqual(zeilenFunde("kit/a.mjs", String.raw`const z = ["a", "b"].join("\n")§Z;`), []);
  assert.deepEqual(zeilenFunde("kit/a.mjs", String.raw`const z = readFileSync(p, "utf-8").split(/\r?\n/);`), []);
  assert.deepEqual(zeilenFunde("kit/a.mjs", String.raw`const z = r.stdout.split(/\r?\n/);`), []);
  assert.deepEqual(zeilenFunde("kit/a.mjs",
    "function a(p) {", '  const text = readFileSync(p, "utf-8");', "  return text;", "}",
    "function b(text) {", "  return text§Z;", "}"), []);
  assert.deepEqual(zeilenFunde("kit/a.mjs", '// readFileSync(p, "utf-8")§Z ist der Bruch'), []);
});

test("[1162] zeilenenden: sofort bereinigte Zeilen und jedes Zerlegen in einem Test sind kein Fund (E15)", () => {
  assert.deepEqual(zeilenFunde("kit/a.mjs", "const [a, b] = res.stdout§Z.map((z) => z.trim());"), []);
  assert.deepEqual(zeilenFunde("kit/a.mjs", 'const z = readFileSync(p, "utf-8")§Z.map((zeile) => JSON.parse(zeile));'), []);
  // erst filtern, dann parsen: eine Zeile aus nur "\r" uebersteht das Filtern
  assert.equal(zeilenFunde("kit/a.mjs", 'const z = readFileSync(p, "utf-8")§Z.filter(Boolean).map((z) => JSON.parse(z));').length, 1);
  assert.deepEqual(zeilenFunde("test/a.test.mjs", 'const z = readFileSync(p, "utf-8")§Z;'), []);
  assert.deepEqual(zeilenFunde("test/helpers/a.mjs", "const z = r.stdout§Z;"), []);
  assert.deepEqual(zeilenFunde("probe.txt", 'import { test } from "node:test";', "const z = r.stdout§Z;"), []);
});

test("[1162] zeilenenden: git init in einem Test ohne .gitattributes und ohne autocrlf ist ein Fund", () => {
  for (const zeile of ["  git(dir, §G, \"-q\");", '  execFileSync("git", [§G, "-q"], { cwd: dir });', '    ["git", [§G, "-q"]],',
    '  for (const a of [[§G, "-q"], ["config", "user.name", "T"]]) git(dir, ...a);', '  execSync("git init -q", { cwd: dir });']) {
    const funde = zeilenFunde("test/a.test.mjs", "function repo(dir) {", zeile, "}");
    assert.deepEqual(funde.map((f) => f.zeile), [2], zeile);
    assert.match(funde[0].grund, /gitattributes/);
  }
  assert.equal(zeilenFunde("test/helpers/repo.mjs", "function repo(dir) {", "  git(dir, §G);", "}").length, 1);
});

test("[1162] zeilenenden: git init mit .gitattributes oder autocrlf im selben Helfer, ausserhalb eines Tests oder als Wort ist kein Fund", () => {
  assert.deepEqual(zeilenFunde("test/a.test.mjs",
    "function repo(dir) {", "  git(dir, §G);", String.raw`  writeFileSync(join(dir, ".gitattributes"), "* text=auto eol=lf\n");`, "}"), []);
  assert.deepEqual(zeilenFunde("test/a.test.mjs",
    "function repo(dir) {", "  git(dir, §G);", '  git(dir, "config", "core.autocrlf", "false");', "}"), []);
  assert.deepEqual(zeilenFunde("kit/a.mjs", "function repo(dir) {", "  git(dir, §G);", "}"), []);
  // mehrzeilige Parameterliste: `} = {}) {` schliesst die Parameter, nicht die Funktion (#1168)
  assert.deepEqual(zeilenFunde("test/a.test.mjs", "function repo(dir, {", "  stub = null,", "} = {}) {",
    String.raw`  writeFileSync(join(dir, ".gitattributes"), "* text=auto eol=lf\n");`, "  git(dir, §G);", "}"), []);
  assert.deepEqual(zeilenFunde("test/a.test.mjs", 'const zeile = JSON.stringify({ subtype: §G });'), []);
  assert.deepEqual(zeilenFunde("test/a.test.mjs", "// Kein `git init`: git log scheitert"), []);
  // eine andere Funktion schreibt die .gitattributes: nicht derselbe Helfer
  assert.equal(zeilenFunde("test/a.test.mjs",
    "function repo(dir) {", "  git(dir, §G);", "}",
    "function attribute(dir) {", String.raw`  writeFileSync(join(dir, ".gitattributes"), "* text=auto eol=lf\n");`, "}").length, 1);
});

test("[1162] Das Fixture traegt genau einen Bruch der Art zeilenenden", () => {
  const r = lauf(["--wurzel", join(repoRoot, "test", "fixtures", "windows-brueche")]);
  assert.equal(r.status, 0, r.stderr);
  const zeilen = hinweise(r.stdout).filter((z) => z.includes(" — zeilenenden: "));
  assert.equal(zeilen.length, 1, r.stdout);
  assert.match(zeilen[0], /^Hinweis: zeilenenden\.txt:\d+ — zeilenenden: /);
});

// ---- Regel fakes ----------------------------------------------------------------

const fakeFunde = (datei, ...zeilen) => pruefeQuelle(q(...zeilen), { kontext: { datei } })
  .filter((f) => f.art === "fakes");

test("[1163] REGELN traegt die Art fakes", () => {
  const fakes = REGELN.find((r) => r.art === "fakes");
  assert.ok(fakes, "Regel fakes fehlt");
  assert.equal(typeof fakes.pruefe, "function");
  assert.equal(q("§F/bin/sh"), "#" + "!/bin/sh");
});

test("[1163] fakes: ein ausfuehrbares Ersatzprogramm im bin-Ordner ohne Huelle ist ein Fund", () => {
  // Modus im Schreibaufruf
  let funde = fakeFunde("test/a.test.mjs",
    "function fake(dir) {", String.raw`  writeFileSync(join(dir, "bin", "gh"), "§F/bin/sh\nexit 0\n", { mode: 0o755 });`, "}");
  assert.deepEqual(funde.map((f) => f.zeile), [2]);
  assert.match(funde[0].grund, /\.cmd/);
  // chmod danach, Pfad ueber eine Variable, Shebang in einem Array auf eigener Zeile
  funde = fakeFunde("test/a.test.mjs",
    "function fake(dir) {", '  const pfad = join(binDir, "claude");', "  writeFileSync(pfad, [", '    "§F/bin/sh",', '    "exit 0",',
    String.raw`  ].join("\n"));`, "  §H(pfad, 0o755);", "}");
  assert.deepEqual(funde.map((f) => f.zeile), [4]);
  // der Inhalt aus einer Variable derselben Funktion, wie im gemeinsamen Helfer
  funde = fakeFunde("test/helpers/a.mjs",
    "export function fakeCli(dir, name) {", "  const wrapper = [", '    "§F/bin/sh",', '    "exec node impl.mjs",', String.raw`  ].join("\n");`,
    '  const cliPfad = join(dir, "fakebin", name);', "  writeFileSync(cliPfad, wrapper);", "  §H(cliPfad, 0o755);", "}");
  assert.deepEqual(funde.map((f) => f.zeile), [3]);
  // chmod +x als Kindprozess
  assert.equal(fakeFunde("test/a.test.mjs",
    "function fake(bin) {", String.raw`  writeFileSync(join(bin, "git"), "§F/bin/sh\n");`, '  spawnSync("§K", ["+x", join(bin, "git")]);', "}").length, 1);
  // ein Testhelfer ausserhalb einer .test-Datei
  assert.equal(fakeFunde("test/helpers/a.mjs",
    "function fake(dir) {", String.raw`  writeFileSync(join(dir, "fakebin", "gh"), "§F/bin/sh\n", { mode: 0o755 });`, "}").length, 1);
});

test("[1163] fakes: mit fakeCli, fakePath oder einer .cmd-Huelle ist kein Fund", () => {
  const schreibe = String.raw`  writeFileSync(join(binDir, "gh"), "§F/bin/sh\n", { mode: 0o755 });`;
  for (const huelle of ['  cmdAttrappe(join(binDir, "gh"));', String.raw`  writeFileSync(join(binDir, "gh.cmd"), "@rem\r\n");`,
    "  writeFileSync(`${pfad}.cmd`, \"@rem\\r\\n\");", '  writeFileSync(`${pfad}.exe`, "kein Programm");',
    '  fakeCli(dir, "git", []);', "  return fakePath(dir);"]) {
    assert.deepEqual(fakeFunde("test/a.test.mjs", "function fake(dir) {", schreibe, huelle, "}"), [], huelle);
  }
  // ein eigener Helfer derselben Datei, der die Huelle schreibt
  assert.deepEqual(fakeFunde("test/a.test.mjs",
    "function huelle(binDir, name) {", '  writeFileSync(join(binDir, `${name}.cmd`), "@rem\\r\\n");', "}",
    "function fake(binDir) {", schreibe, '  huelle(binDir, "gh");', "}"), []);
  // ein Kommentar, der die Huelle nur nennt, und eine eigene Funktion namens fakeCli legen keine
  assert.equal(fakeFunde("test/a.test.mjs",
    "function fake(dir) {", schreibe, "  // Unter Windows findet das Kit es ueber die `.cmd` daneben.", "}").length, 1);
  assert.equal(fakeFunde("test/a.test.mjs", "function fakeCli(dir) {", schreibe, "}").length, 1);
  // die Huelle in einer anderen Funktion gilt nicht
  assert.equal(fakeFunde("test/a.test.mjs",
    "function andere(dir) {", '  cmdAttrappe(join(dir, "x"));', "}",
    "function fake(dir) {", schreibe, "}").length, 1);
});

test("[1163] fakes: nicht ausfuehrbar, ausserhalb eines bin-Ordners, ausserhalb eines Tests oder ohne Shebang ist kein Fund", () => {
  assert.deepEqual(fakeFunde("test/a.test.mjs",
    "function fake(dir) {", String.raw`  writeFileSync(join(dir, "bin", "gh"), "§F/bin/sh\n", { mode: 0o644 });`, "}"), []);
  assert.deepEqual(fakeFunde("test/a.test.mjs",
    "function fake(dir) {", String.raw`  writeFileSync(join(binDir, "gh"), "§F/bin/sh\n");`, '  §H(join(binDir, "gh"), 0o644);', "}"), []);
  // ein Stufenprogramm, das das Kit ueber die POSIX-Shell startet, nicht ueber den PATH
  assert.deepEqual(fakeFunde("test/a.test.mjs",
    "function fake(dir) {", '  const prog = join(dir, "stufen-programm");', String.raw`  writeFileSync(prog, "§F/bin/sh\n", { mode: 0o755 });`, "}"), []);
  assert.deepEqual(fakeFunde("kit/a.mjs",
    "function hook(dir) {", String.raw`  writeFileSync(join(dir, "bin", "x"), "§F/bin/sh\n", { mode: 0o755 });`, "}"), []);
  assert.deepEqual(fakeFunde("test/a.test.mjs",
    "function fake(dir) {", String.raw`  writeFileSync(join(dir, "bin", "x"), "exit 0\n", { mode: 0o755 });`, "}"), []);
});

test("[1163] fakes: ein Ersatzprogramm nur fuer Tests, die sich ueber das Ausfuehrungsrecht ausnehmen, ist kein Fund", () => {
  const helfer = ["function mitBin(fn) {", String.raw`  writeFileSync(join(bin, "git"), "§F/bin/sh\n", { mode: 0o755 });`, "  fn(bin);", "}"];
  assert.deepEqual(fakeFunde("test/a.test.mjs", ...helfer,
    'test("x", {', '  skip: !kenntAusfuehrungsrecht() && "kein x-Bit",', "}, () => {", "  mitBin(() => {});", "});"), []);
  assert.deepEqual(fakeFunde("test/a.test.mjs", ...helfer,
    'test("x", MIT_DATEIRECHTEN, () => {', "  mitBin(() => {});", "});"), []);
  // ein zweiter Aufruf ohne Faehigkeit: der Fund bleibt
  assert.equal(fakeFunde("test/a.test.mjs", ...helfer,
    'test("x", MIT_DATEIRECHTEN, () => {', "  mitBin(() => {});", "});",
    'test("y", () => {', "  mitBin(() => {});", "});").length, 1);
});

test("[1163] Das Fixture traegt genau einen Bruch der Art fakes", () => {
  const r = lauf(["--wurzel", join(repoRoot, "test", "fixtures", "windows-brueche")]);
  assert.equal(r.status, 0, r.stderr);
  const zeilen = hinweise(r.stdout).filter((z) => z.includes(" — fakes: "));
  assert.equal(zeilen.length, 1, r.stdout);
  assert.match(zeilen[0], /^Hinweis: fakes\.txt:\d+ — fakes: /);
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

// Echte Brueche, die eine eigene Karte reparieren soll (E15): Die Regel bleibt scharf, und
// der Bestand ist bis zur Reparatur nicht fundfrei. Wer repariert, streicht die Zeilen hier.
// Je Fund ein Eintrag aus Datei und Art, ohne Zeile: Sonst braeche jede Bearbeitung einer
// der Dateien diesen Test (Issue #1162).
//
// Seit dem Ende von nativem Windows (Plan #1265) sind diese Stellen keine Brueche mehr,
// sondern die POSIX-Fassung ohne Weiche (Issue #1268). Sie stehen hier, bis Issue #1272
// das Werkzeug samt diesem Test entfernt.
const BEKANNTE_BRUECHE = [
  "kit/checks.mjs — prozesse",
  "test/checks-hash.test.mjs — dateien",
];

test("[1157] Der Bestand ist fundfrei bis auf die bekannten Brueche mit Karte (E15)", () => {
  const r = lauf([]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(hinweise(r.stdout).map((z) => z.replace(/^Hinweis: /, "").replace(/: [^:]*$/, "").replace(/:\d+ — /, " — ")),
    BEKANNTE_BRUECHE);
});
