// Die Zwei-Datei-Config des Board-Werkzeugs (Issue #207), im selben Prozess belegt
// (Issue #1211, Plan #1199, E6).
//
// workflow.config.json gehoert ins Repo und gilt fuer alle; workflow.config.local.json
// bleibt lokal und darf nur persoenliche Felder ueberschreiben. Die Allowlist ist die
// eigentliche Entscheidung: Bei freiem Merge setzt jemand lokal "buildChecks": [] und
// die ganze Trennung waere wirkungslos.
//
// Geprueft wird die reine Funktion direkt — der Merge braucht kein Dateisystem. Das Lesen
// der beiden Dateien (`ladeConfigDatei`) lief bis Issue #1211 ueber den Einstieg des
// Board-Werkzeugs als Kindprozess; die Hinweise auf stderr faengt der Test jetzt im selben Prozess ab.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { mergeWorkflowConfig, ladeConfigDatei } from "../kit/board/grundlagen.mjs";

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

// --- ladeConfigDatei: die persoenliche Datei neben der geteilten ---

/**
 * Legt die geteilte Config und optional die lokale Datei an, liest sie mit
 * `ladeConfigDatei` und liefert die Config samt allem, was dabei auf stderr ging.
 */
function geladen(local) {
  const dir = mkdtempSync(join(tmpdir(), "board-grundlagen-cfg-"));
  const pfad = join(dir, ".claude", "workflow.config.json");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(pfad, JSON.stringify(GETEILT, null, 2));
  if (local !== null) {
    writeFileSync(
      join(dir, ".claude", "workflow.config.local.json"),
      typeof local === "string" ? local : JSON.stringify(local, null, 2),
    );
  }
  const stderr = [];
  const schreiben = process.stderr.write;
  process.stderr.write = (text) => {
    stderr.push(String(text));
    return true;
  };
  try {
    return { config: ladeConfigDatei(pfad), stderr: stderr.join("") };
  } finally {
    process.stderr.write = schreiben;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ladeConfigDatei meldet ignorierte Felder auf stderr und uebernimmt erlaubte", () => {
  // stderr, nicht stdout: stdout bleibt maschinenlesbar, die Skills parsen ihn als JSON.
  const { config, stderr } = geladen({ buildChecks: [], reviewModel: "claude-sonnet-5" });
  assert.match(stderr, /'buildChecks' aus workflow\.config\.local\.json wird ignoriert/);
  assert.doesNotMatch(stderr, /reviewModel/);
  assert.deepEqual(config.buildChecks, ["node --test"]);
  assert.equal(config.reviewModel, "claude-sonnet-5");
});

test("ladeConfigDatei laeuft ohne lokale Datei unveraendert und still", () => {
  const { config, stderr } = geladen(null);
  assert.deepEqual(config, GETEILT);
  assert.equal(stderr, "");
});

test("ladeConfigDatei: eine kaputte lokale Datei kippt die geteilte Config nicht", () => {
  // Eine persoenliche Datei mit Tippfehler darf nicht das ganze Projekt lahmlegen —
  // anders als bei der geteilten Config, wo ein Syntaxfehler ein harter Fehler bleibt.
  const { config, stderr } = geladen("{ kaputt");
  assert.match(stderr, /workflow\.config\.local\.json ist kein gueltiges JSON/);
  assert.deepEqual(config, GETEILT);
});

test("ladeConfigDatei bildet das alte Feld provider auf codeHost und issueTracker ab", () => {
  const dir = mkdtempSync(join(tmpdir(), "board-grundlagen-cfg-"));
  try {
    const pfad = join(dir, "workflow.config.json");
    writeFileSync(pfad, JSON.stringify({ provider: "gitlab", buildChecks: ["x"] }));
    const config = ladeConfigDatei(pfad);
    assert.equal(config.codeHost, "gitlab");
    assert.equal(config.issueTracker, "gitlab");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
