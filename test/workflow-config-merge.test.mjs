// Die Zwei-Datei-Config im Nacht-Runner (Issue #207) und der Gleichlauf ihrer Allowlist
// zwischen Board-Werkzeug, Nacht-Runner und Einstellungs-Oberflaeche.
//
// Die reine Merge-Funktion des Board-Werkzeugs und das Lesen der beiden Dateien prueft
// seit Issue #1211 board-grundlagen-config.test.mjs im selben Prozess. Hier bleibt, was nur
// am laufenden Nacht-Runner sichtbar ist, und der Abgleich der drei Quelltexte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("die Allowlist steht in board.mjs und night.mjs identisch", () => {
  // SYNC-Paar: board.mjs und night.mjs sind eigenstaendige Werkzeuge, die Liste ist
  // bewusst dupliziert. Dieser Test haelt die Kopien zusammen. Beim Board-Werkzeug steht
  // sie seit Issue #1211 in seinem Teil kit/board/grundlagen.mjs, beim Nacht-Runner
  // seit Issue #1224 in kit/night/grundlagen.mjs.
  const listeAus = (datei) => {
    const quelle = readFileSync(join(repoRoot, "kit", datei), "utf-8");
    const treffer = quelle.match(/const LOCAL_OVERRIDE_ALLOWLIST = (\[[^\]]*\]);/);
    assert.ok(treffer, `LOCAL_OVERRIDE_ALLOWLIST nicht in kit/${datei} gefunden`);
    return JSON.parse(treffer[1].replace(/,\s*\]/, "]"));
  };
  const board = listeAus("board/grundlagen.mjs");
  assert.ok(board.includes("reviewCommand"), "reviewCommand fehlt in der Allowlist von board/grundlagen.mjs");
  assert.deepEqual(listeAus("night/grundlagen.mjs"), board);
  // Seit Issue #676 die dritte Kopie: die heruntergeladene Einstellungs-Oberflaeche hat
  // keine Nachbardatei, aus der sie importieren koennte.
  assert.deepEqual(listeAus("einstellungen.mjs"), board);
});

test("[einstellungen-3] REVIEWER_PAAR steht in board.mjs, night.mjs und einstellungen.mjs identisch", () => {
  const paarAus = (datei) => {
    const quelle = readFileSync(join(repoRoot, "kit", datei), "utf-8");
    const treffer = quelle.match(/const REVIEWER_PAAR = (\{[^}]*\});/);
    assert.ok(treffer, `REVIEWER_PAAR nicht in kit/${datei} gefunden`);
    return treffer[1].replaceAll(/\s+/g, "");
  };
  assert.equal(paarAus("night/grundlagen.mjs"), paarAus("board/grundlagen.mjs"));
  assert.equal(paarAus("einstellungen.mjs"), paarAus("board/grundlagen.mjs"));
});

// --- Nacht-Runner ---
//
// Fuer den Runner ist die Allowlist am wichtigsten: Die Pruefung auf leere buildChecks
// ist sein einziges Gate. Waere das Feld lokal ueberschreibbar, liefe ein Nachtlauf
// ohne jede Absicherung durch. Getestet ueber --dry-run: Der Vorflug-Check laeuft,
// eine Session wird nicht gestartet.

function nightFixture(lokaleConfig) {
  const dir = mkdtempSync(join(tmpdir(), "night-localcfg-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  if (lokaleConfig) {
    writeFileSync(join(dir, ".claude", "workflow.config.local.json"), JSON.stringify(lokaleConfig, null, 2));
  }
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
  lfAttribute(join(dir, ".gitattributes"));
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
  }
  return dir;
}

function nightDryRun(dir) {
  return spawnSync(process.execPath, [join(repoRoot, "kit", "night.mjs"), "--dry-run", "--label", "none"],
    { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
}

test("night.mjs: lokale buildChecks koennen das Gate nicht abschalten", () => {
  const dir = nightFixture({ buildChecks: [] });
  try {
    const res = nightDryRun(dir);
    assert.doesNotMatch(
      (res.stdout || "") + (res.stderr || ""),
      /buildChecks in workflow\.config\.json ist leer/,
      "das Gate darf sich nicht lokal wegkonfigurieren lassen"
    );
    assert.match(res.stderr, /'buildChecks'.*ignoriert/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("night.mjs: ohne lokale Datei bleibt der Vorflug unveraendert", () => {
  const dir = nightFixture(null);
  try {
    const res = nightDryRun(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /ignoriert/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("night.mjs: kaputte lokale Datei kippt den Lauf nicht", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-localcfg-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".claude", "workflow.config.local.json"), "{ kaputt");
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
  lfAttribute(join(dir, ".gitattributes"));
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
  }
  try {
    const res = nightDryRun(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /workflow\.config\.local\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Die Liste erlaubter Modellnamen ist teamweit (Issue #664).
//
// Sie gehoert bewusst NICHT in die Allowlist: Waere sie persoenlich ueberschreibbar,
// koennte jemand lokal einen Namen ergaenzen, den das Team nie freigegeben hat — und
// damit genau die Pruefung aushebeln, die verhindert, dass ein Wert aus einem Issue-Body
// in `argv` wandert. Dasselbe Argument wie bei `buildChecks`, nur eine Stufe frueher.
test("night.mjs: lokale night.modelle werden ignoriert und gemeldet", () => {
  const dir = nightFixture({ night: { modelle: ["claude-fremd-1"] } });
  try {
    const res = nightDryRun(dir);
    assert.match(res.stderr, /'night'.*ignoriert/, `die Meldung fehlt: ${res.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
