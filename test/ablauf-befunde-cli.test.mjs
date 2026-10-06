// Ablauf-Pruefung: Ob checks.mjs neben befunde.mjs liegt, entscheidet das Modul beim Laden, der Board-Adapter startet ohne Attrappe als Kindprozess, und Exit-Code und Fehlerzeile setzt nur die Kommandozeile.
//
// Die uebrigen Tests von kit/befunde.mjs rufen das Werkzeug im selben Prozess ueber
// `aufrufen` und geben den Board-Adapter als Attrappe (Issue #1213, Plan #1199 E6). Was
// dabei ungeprueft bliebe, belegt diese Datei an echten Prozessen:
//
//   - Portabilitaet: Allein in einem leeren Verzeichnis laufen `arten`, `pruefen` und
//     `buchen` unterhalb der Code-Stufe; erst `buchen --stufe code` meldet den fehlenden
//     Nachbarn checks.mjs. Das Kit liefert seine Werkzeuge als eigenstaendige
//     Einzeldateien aus — ein Import auf eine Datei des Kit-Repos fiele hier auf.
//   - Ohne Attrappe startet `vorschlag` den Board-Adapter unter KIT_ROOT als Kindprozess.
//   - Die Kommandozeile setzt den Exit-Code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const BEFUNDE = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "befunde.mjs");

const FUND = [
  "#### WICHTIG",
  "",
  "**C1 — Ein Fund.**",
  "Gegenprobe: Eine Beobachtung. — geprueft, bestaetigt",
  "Art: korrektheit",
  "Uebernahme: uebernommen",
].join("\n");

function cli(programm, dir, cliArgs, env = process.env) {
  return spawnSync(process.execPath, [programm, ...cliArgs], { cwd: dir, encoding: "utf-8", env });
}

/** Ein leeres Verzeichnis mit einer Kopie von befunde.mjs ohne Nachbarn und dem Fundtext. */
function mitKopieAllein(fn) {
  const dir = mkdtempSync(join(tmpdir(), "befunde-allein-"));
  try {
    const allein = join(dir, "befunde.mjs");
    copyFileSync(BEFUNDE, allein);
    writeFileSync(join(dir, "text.md"), FUND, "utf-8");
    fn(dir, allein);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("portabel: befunde.mjs allein in einem leeren Verzeichnis — arten und pruefen laufen, buchen --stufe code meldet den fehlenden Nachbarn", () => {
  mitKopieAllein((dir, allein) => {
    const arten = cli(allein, dir, ["arten"]);
    assert.equal(arten.status, 0, `arten lief nicht ohne Repo-Kontext: ${arten.stderr}`);
    assert.equal(JSON.parse(arten.stdout).anzahl, 12);

    const pruefen = cli(allein, dir, ["pruefen", "--datei", "text.md"]);
    assert.equal(pruefen.status, 0, `pruefen lief nicht ohne Repo-Kontext: ${pruefen.stderr}`);
    assert.equal(JSON.parse(pruefen.stdout).funde.length, 1);

    const buchen = cli(allein, dir, ["buchen", "--datei", "text.md", "--stufe", "code", "--karte", "1"]);
    assert.equal(buchen.status, 1, "der fehlende Nachbar ist ein Fehler, kein stiller Lauf");
    const json = JSON.parse(buchen.stdout);
    assert.equal(json.ok, false);
    assert.match(json.fehler, /checks\.mjs/);
  });
});

test("portabel: buchen ohne Nachbarn laeuft fuer die Stufen ohne Vergleichsstand weiter", () => {
  mitKopieAllein((dir, allein) => {
    const res = cli(allein, dir, ["buchen", "--datei", "text.md", "--stufe", "plan", "--karte", "1"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).geschrieben, 1);
  });
});

test("[befunde-1213] ohne Attrappe startet vorschlag den Board-Adapter unter KIT_ROOT als Kindprozess", () => {
  const dir = mkdtempSync(join(tmpdir(), "befunde-kitroot-"));
  try {
    mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
    const zeile = "2026-09-22T00:00:00.000Z\tplan\t797\treviewer\tform\tWICHTIG\t-\n";
    writeFileSync(join(dir, ".claude", "befunde.tsv"), zeile.repeat(3), "utf-8");
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), [
      "import { appendFileSync } from 'node:fs';",
      String.raw`appendFileSync(process.env.STUB_LOG, process.argv.slice(2).slice(0, 2).join(' ') + '\n', 'utf-8');`,
      String.raw`process.stdout.write(JSON.stringify({ id: "812" }) + '\n');`,
    ].join("\n"), "utf-8");
    const log = join(dir, "board.log");

    const res = cli(BEFUNDE, dir, ["vorschlag", "--art", "form"], { ...process.env, KIT_ROOT: dir, STUB_LOG: log });

    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).karte, "812");
    assert.deepEqual(readFileSync(log, "utf-8").split("\n").filter(Boolean), ["issue create"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[befunde-1213] die Kommandozeile setzt bei einem abgewiesenen Aufruf Exit 1, und befund schreibt den Fehler nach stderr", () => {
  mitKopieAllein((dir) => {
    const json = cli(BEFUNDE, dir, ["arten", "--alles"]);
    assert.equal(json.status, 1);
    assert.equal(JSON.parse(json.stdout).ok, false);

    const text = cli(BEFUNDE, dir, ["befund", "--zuviel"]);
    assert.equal(text.status, 1);
    assert.equal(text.stdout, "");
    assert.match(text.stderr, /^Fehler: 'befund' nimmt keine Argumente/);
  });
});
