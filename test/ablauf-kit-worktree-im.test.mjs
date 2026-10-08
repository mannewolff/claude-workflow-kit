// Ablauf-Pruefung: kit/worktree.mjs exportiert nichts; das Unterkommando im ist nur als Prozess beobachtbar.
//
// `worktree.mjs im <pfad> -- <kommando> [argumente]` (Issue #1372): Die Release-Skills
// fahren die Schritte aus RELEASING.md im Worktree, ohne `cd`. Claude Code setzt das
// Arbeitsverzeichnis ausserhalb der erlaubten Verzeichnisse nach jedem Aufruf zurueck, und
// ein zusammengesetzter Aufruf `cd <pfad> && …` faellt nicht mehr unter
// `sandbox.excludedCommands`. Das Kommando startet das genannte Programm mit dem Worktree als
// Arbeitsverzeichnis, reicht Ausgabe und Exitcode durch und startet keine Shell.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WERKZEUG = join(repoRoot, "kit", "worktree.mjs");

function werkzeug(cwd, ...cliArgs) {
  return spawnSync(process.execPath, [WERKZEUG, ...cliArgs], { cwd, encoding: "utf-8" });
}

function mitVerzeichnissen(fn) {
  const aufrufer = realpathSync(mkdtempSync(join(tmpdir(), "im-aufrufer-")));
  const ziel = realpathSync(mkdtempSync(join(tmpdir(), "im-ziel-")));
  try {
    fn({ aufrufer, ziel });
  } finally {
    rmSync(aufrufer, { recursive: true, force: true });
    rmSync(ziel, { recursive: true, force: true });
  }
}

test("[1372] im startet das Kommando mit dem genannten Verzeichnis als Arbeitsverzeichnis", () => {
  mitVerzeichnissen(({ aufrufer, ziel }) => {
    const skript = "require('fs').writeFileSync('ort.txt', process.cwd()); console.log('ausgabe-durch')";
    const res = werkzeug(aufrufer, "im", ziel, "--", process.execPath, "-e", skript);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /ausgabe-durch/, "die Ausgabe des Kommandos kommt nicht durch");
    assert.equal(realpathSync(readFileSync(join(ziel, "ort.txt"), "utf-8")), ziel);
    assert.ok(!existsSync(join(aufrufer, "ort.txt")), "das Kommando lief im Arbeitsverzeichnis des Aufrufers");
  });
});

test("[1372] im reicht den Exitcode des Kommandos durch", () => {
  mitVerzeichnissen(({ aufrufer, ziel }) => {
    const res = werkzeug(aufrufer, "im", ziel, "--", process.execPath, "-e", "process.exit(7)");
    assert.equal(res.status, 7);
  });
});

test("[1372] im startet keine Shell: Sonderzeichen gehen woertlich als Argument durch", () => {
  mitVerzeichnissen(({ aufrufer, ziel }) => {
    const skript = "require('fs').writeFileSync('arg.txt', process.argv[1])";
    const res = werkzeug(aufrufer, "im", ziel, "--", process.execPath, "-e", skript, "a && b; $(x) > y");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(join(ziel, "arg.txt"), "utf-8"), "a && b; $(x) > y");
    assert.ok(!existsSync(join(ziel, "y")), "eine Shell hat die Umleitung ausgewertet");
  });
});

test("[1372] im ohne Verzeichnis, ohne Trenner oder ohne Kommando bricht mit JSON-Fehler ab", () => {
  mitVerzeichnissen(({ aufrufer, ziel }) => {
    for (const args of [
      ["im"],
      ["im", ziel],
      ["im", ziel, "--"],
      ["im", ziel, process.execPath, "-e", "0"],
      ["im", join(ziel, "gibt-es-nicht"), "--", process.execPath, "-e", "0"],
    ]) {
      const res = werkzeug(aufrufer, ...args);
      assert.equal(res.status, 1, `kein Abbruch bei ${args.join(" ")}`);
      const letzte = res.stdout.trim().split("\n").at(-1);
      const stand = JSON.parse(letzte);
      assert.equal(stand.ok, false);
      assert.match(stand.fehler, /im/);
    }
  });
});
