// Die Protokolle der Wirksamkeits-Auswertung im `.gitignore`-Block des Installers
// (Plan #782; Issue #784).
//
// `.claude/ausfuehrungen.tsv` (aus kit/checks.mjs) und `.claude/bewegungen.tsv` (aus
// kit/board.mjs) entstehen in jedem Lauf. Ohne Eintrag im Block laegen sie in jedem
// frisch installierten Projekt als Reste im Arbeitsbaum — genau wie `.claude/wegmarken.tsv`,
// neben dem sie darum stehen.
//
// Geprueft wird am ECHTEN install.mjs im Piped-Modus: gelesen wird die `.gitignore`, die
// der Installer schreibt, denn der Block selbst ist nicht exportiert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

// Der kuerzeste Weg durch die Fragen: projektlokal, GitHub, alle Defaults — dieselbe
// Antwortfolge wie in install-flow.test.mjs.
const PROJEKT_GITHUB = ["projekt", "github", "github", "", "", "", "", "", ""];

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function installiere(dir, antworten) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
  });
}

test("[installer-12] der .gitignore-Block fuehrt beide Protokolle namentlich neben den Wegmarken", () => {
  const dir = fixture("install-protokolle-");
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf-8" });
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, res.stderr);

    const zeilen = readFileSync(join(dir, ".gitignore"), "utf-8").split("\n").map((z) => z.trim());
    for (const pfad of [".claude/ausfuehrungen.tsv", ".claude/bewegungen.tsv"]) {
      assert.ok(zeilen.includes(pfad), `${pfad} fehlt im .gitignore-Block:\n${zeilen.join("\n")}`);
    }
    // Sie stehen im Block der Zustandsdateien, nicht irgendwo: neben den Wegmarken.
    assert.ok(zeilen.includes(".claude/wegmarken.tsv"), "der Bestandseintrag der Wegmarken fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
