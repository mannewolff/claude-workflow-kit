// Tests fuer die Zwei-Datei-Config (Issue #207).
//
// workflow.config.json gehoert ins Repo und gilt fuer alle; workflow.config.local.json
// bleibt lokal und darf nur persoenliche Felder ueberschreiben. Die Allowlist ist die
// eigentliche Entscheidung: Bei freiem Merge setzt jemand lokal "buildChecks": [] und
// die ganze Trennung waere wirkungslos.
//
// Geprueft wird die reine Funktion direkt — der Merge braucht kein Dateisystem. Der
// CLI-Mantel laeuft wie in allen board-*-Tests gegen ein Fixture-Projekt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { mergeWorkflowConfig } from "../kit/board.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Nacht-Runner wird hier ueber git im Fixture gefahren; siehe Issue #199." } : {};

const GETEILT = {
  codeHost: "local",
  issueTracker: "local",
  buildChecks: ["node --test"],
  mainBranch: "main",
  reviewModel: "claude-opus-4-8",
  reviewScope: "diff",
  local: { issuesDir: "issues" },
  columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" },
};

// --- mergeWorkflowConfig: erlaubte Felder ---

test("mergeWorkflowConfig: fehlende lokale Datei laesst die geteilte Config unveraendert", () => {
  assert.deepEqual(mergeWorkflowConfig(GETEILT, null).config, GETEILT);
  assert.deepEqual(mergeWorkflowConfig(GETEILT, {}).config, GETEILT);
  assert.deepEqual(mergeWorkflowConfig(GETEILT, null).ignored, []);
});

test("mergeWorkflowConfig: reviewModel und reviewScope gewinnen lokal", () => {
  const { config, ignored } = mergeWorkflowConfig(GETEILT, {
    reviewModel: "claude-sonnet-5",
    reviewScope: "full",
  });
  assert.equal(config.reviewModel, "claude-sonnet-5");
  assert.equal(config.reviewScope, "full");
  assert.deepEqual(ignored, []);
  assert.deepEqual(config.buildChecks, ["node --test"], "geteilte Felder bleiben unberuehrt");
});

test("mergeWorkflowConfig: triggers gewinnen lokal", () => {
  const { config } = mergeWorkflowConfig(GETEILT, { triggers: { go: "LOS" } });
  assert.deepEqual(config.triggers, { go: "LOS" });
});

// --- mergeWorkflowConfig: Allowlist ---

test("mergeWorkflowConfig: buildChecks aus der lokalen Datei werden ignoriert und gemeldet", () => {
  // Der Kern der Entscheidung: Waere das Feld lokal ueberschreibbar, koennte sich jeder
  // sein Gate wegkonfigurieren — und die Trennung waere reine Kosmetik.
  const { config, ignored } = mergeWorkflowConfig(GETEILT, { buildChecks: [] });
  assert.deepEqual(config.buildChecks, ["node --test"]);
  assert.deepEqual(ignored, ["buildChecks"]);
});

test("mergeWorkflowConfig: alle teamweiten Felder werden ignoriert", () => {
  const { config, ignored } = mergeWorkflowConfig(GETEILT, {
    buildChecks: [],
    mutationCommand: "irgendwas",
    formatFixCommand: "irgendwas",
    mainBranch: "meinbranch",
    columns: { ready: "Meine Spalte" },
    issueTracker: "github",
  });
  assert.equal(config.mainBranch, "main");
  assert.equal(config.issueTracker, "local");
  assert.deepEqual(config.columns, GETEILT.columns);
  assert.deepEqual(
    ignored.sort(),
    ["buildChecks", "columns", "formatFixCommand", "issueTracker", "mainBranch", "mutationCommand"]
  );
});

// --- mergeWorkflowConfig: verschachtelte Pfade ---

test("mergeWorkflowConfig: toolbox.tokenFile gewinnt, die uebrigen toolbox-Felder bleiben", () => {
  // Regression zu Issue #188: Dort hat ein nachgestelltes ...config das ganze
  // toolbox-Objekt samt Mock-Host ersetzt und zwanzig Tests still ohne Token laufen
  // lassen. Der Merge muss am Blatt greifen, nicht am Elternobjekt.
  const geteilt = { ...GETEILT, toolbox: { host: "https://board.example", ideaStored: true } };
  const { config, ignored } = mergeWorkflowConfig(geteilt, {
    toolbox: { tokenFile: "~/.config/tbx-token" },
  });
  assert.deepEqual(config.toolbox, {
    host: "https://board.example",
    ideaStored: true,
    tokenFile: "~/.config/tbx-token",
  });
  assert.deepEqual(ignored, []);
});

test("mergeWorkflowConfig: nicht erlaubte toolbox-Felder werden einzeln ignoriert", () => {
  const geteilt = { ...GETEILT, toolbox: { host: "https://board.example" } };
  const { config, ignored } = mergeWorkflowConfig(geteilt, {
    toolbox: { host: "https://mein-host.example", tokenFile: "~/token" },
  });
  assert.equal(config.toolbox.host, "https://board.example");
  assert.equal(config.toolbox.tokenFile, "~/token");
  assert.deepEqual(ignored, ["toolbox.host"]);
});

test("mergeWorkflowConfig: toolbox.tokenFile funktioniert auch ohne toolbox in der geteilten Config", () => {
  const { config } = mergeWorkflowConfig(GETEILT, { toolbox: { tokenFile: "~/token" } });
  assert.deepEqual(config.toolbox, { tokenFile: "~/token" });
});

// --- Das Reviewer-Paar in der persoenlichen Config (Issue #435) ---
//
// `reviewCommand` ist die Alternative zu `reviewModel` und damit genauso persoenlich.
// Fehlte es in der Allowlist, waere ein `reviewCommand` in der lokalen Datei still
// wirkungslos — nur eine Zeile auf stderr, und der Review liefe gegen das falsche
// Werkzeug. Weil beide Felder ein Paar sind (Issue #432: genau eines gilt), reicht
// striktes feldweises Mischen nicht: Geteiltes `reviewModel` plus lokales
// `reviewCommand` ergaebe sonst eine Config mit beiden Feldern.

const GETEILT_KOMMANDO = (() => {
  const { reviewModel, ...rest } = GETEILT;
  return { ...rest, reviewCommand: "codex exec --model gpt-5" };
})();

test("mergeWorkflowConfig: reviewCommand gewinnt lokal", () => {
  const { config, ignored } = mergeWorkflowConfig(GETEILT_KOMMANDO, {
    reviewCommand: "codex exec --model gpt-5.6-sol",
  });
  assert.equal(config.reviewCommand, "codex exec --model gpt-5.6-sol");
  assert.deepEqual(ignored, []);
});

test("mergeWorkflowConfig: lokales reviewCommand entfernt das geteilte reviewModel", () => {
  // Der Normalfall dieser Entscheidung: Das Team faehrt den Claude-Default, einer
  // reviewt mit fremder CLI. Bliebe reviewModel stehen, haette das Ergebnis beide
  // Felder und verletzte die Oder-Regel aus Issue #432.
  const { config, ignored } = mergeWorkflowConfig(GETEILT, {
    reviewCommand: "codex exec --model gpt-5",
  });
  assert.equal(config.reviewCommand, "codex exec --model gpt-5");
  assert.equal("reviewModel" in config, false, "reviewModel muss beim Merge weichen");
  assert.deepEqual(ignored, []);
  assert.deepEqual(config.buildChecks, ["node --test"], "geteilte Felder bleiben unberuehrt");
});

test("mergeWorkflowConfig: lokales reviewModel entfernt das geteilte reviewCommand", () => {
  const { config } = mergeWorkflowConfig(GETEILT_KOMMANDO, { reviewModel: "claude-sonnet-5" });
  assert.equal(config.reviewModel, "claude-sonnet-5");
  assert.equal("reviewCommand" in config, false, "reviewCommand muss beim Merge weichen");
});

test("die Allowlist steht in board.mjs und night.mjs identisch", () => {
  // SYNC-Paar: board.mjs und night.mjs sind eigenstaendige Single-File-Tools, die
  // Liste ist bewusst dupliziert. Dieser Test haelt die Kopien zusammen.
  const listeAus = (datei) => {
    const quelle = readFileSync(join(repoRoot, "kit", datei), "utf-8");
    const treffer = quelle.match(/const LOCAL_OVERRIDE_ALLOWLIST = (\[[^\]]*\]);/);
    assert.ok(treffer, `LOCAL_OVERRIDE_ALLOWLIST nicht in kit/${datei} gefunden`);
    return JSON.parse(treffer[1].replace(/,\s*\]/, "]"));
  };
  const board = listeAus("board.mjs");
  assert.ok(board.includes("reviewCommand"), "reviewCommand fehlt in der Allowlist von board.mjs");
  assert.deepEqual(listeAus("night.mjs"), board);
});

// --- CLI ---

/** Fixture mit geteilter Config plus optionaler lokaler Datei. */
function mitLokalerConfig(local, fn) {
  const dir = setupProjekt(GETEILT, "board-localcfg-");
  if (local !== null) {
    writeFileSync(
      join(dir, ".claude", "workflow.config.local.json"),
      typeof local === "string" ? local : JSON.stringify(local, null, 2)
    );
  }
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("board.mjs meldet ignorierte Felder auf stderr, nicht auf stdout", () => {
  // stdout bleibt maschinenlesbar: Die Skills parsen die Ausgabe als JSON.
  mitLokalerConfig({ buildChecks: [], reviewModel: "claude-sonnet-5" }, (dir) => {
    const res = runBoard(dir, ["issue", "list"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /buildChecks/);
    assert.doesNotMatch(res.stdout, /buildChecks/);
    JSON.parse(res.stdout);
  });
});

test("board.mjs laeuft ohne lokale Datei unveraendert", () => {
  mitLokalerConfig(null, (dir) => {
    const res = runBoard(dir, ["issue", "list"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr.trim(), "");
  });
});

test("board.mjs: kaputte lokale Datei kippt die geteilte Config nicht", () => {
  // Eine persoenliche Datei mit Tippfehler darf nicht das ganze Projekt lahmlegen —
  // anders als bei der geteilten Config, wo ein Syntaxfehler ein harter Fehler bleibt.
  mitLokalerConfig("{ kaputt", (dir) => {
    const res = runBoard(dir, ["issue", "list"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /workflow\.config\.local\.json/);
    JSON.parse(res.stdout);
  });
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
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  if (lokaleConfig) {
    writeFileSync(join(dir, ".claude", "workflow.config.local.json"), JSON.stringify(lokaleConfig, null, 2));
  }
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
  }
  return dir;
}

function nightDryRun(dir) {
  return spawnSync(process.execPath, [join(repoRoot, "kit", "night.mjs"), "--dry-run", "--label", "none"],
    { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
}

test("night.mjs: lokale buildChecks koennen das Gate nicht abschalten", NUR_POSIX, () => {
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

test("night.mjs: ohne lokale Datei bleibt der Vorflug unveraendert", NUR_POSIX, () => {
  const dir = nightFixture(null);
  try {
    const res = nightDryRun(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /ignoriert/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("night.mjs: kaputte lokale Datei kippt den Lauf nicht", NUR_POSIX, () => {
  const dir = mkdtempSync(join(tmpdir(), "night-localcfg-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".claude", "workflow.config.local.json"), "{ kaputt");
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
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
