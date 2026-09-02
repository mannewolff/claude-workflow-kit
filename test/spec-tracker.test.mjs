// A19: `github` und `gitlab` sind vom beschriebenen Verhalten ausgeschlossen
// (Issue #461).
//
// Der Grund steht in Plan #437, A19: Aktivitaetsverlauf, Suche ueber Aussagen und
// Rueckverfolgung haben dort keine Entsprechung. `local` bleibt ausdruecklich erlaubt —
// er hat keinen Server, gegen den die Begruendung zielt, und er kann den Verlauf, seit
// ihn Issue #460 aus dem Frontmatter synthetisiert.
//
// Die Pruefung sitzt an EINER Stelle in main(), unmittelbar nach --help/--version und
// vor jedem Dateizugriff. Deshalb reicht fuer `check --anker` und `apply` ein Aufruf
// ohne Git-Repo und ohne Anker-Wert: Die Abweisung kommt, bevor das Argument geprueft
// wird.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(repoRoot, "kit", "spec.mjs");

const SPEC_BLOCK = {
  seit: "2026-09-03",
  bereiche: { alpha: ["src/**"] },
  testGlobs: ["test/*.test.mjs"],
};

/** Wegwerf-Projekt mit spec-Block und dem angegebenen Tracker. */
function projekt(issueTracker, { mitSpec = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "spec-tracker-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const config = { issueTracker };
  if (mitSpec) config.spec = SPEC_BLOCK;
  writeFileSync(join(dir, ".claude", "workflow.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return dir;
}

function spec(dir, ...args) {
  return spawnSync(process.execPath, [SPEC, ...args], { cwd: dir, encoding: "utf-8" });
}

const KOMMANDOS = [
  ["index"],
  ["show", "alpha-1"],
  ["check", "--paket", "irgendwas.md"],
  ["check", "--anker", "HEAD"],
  ["luecken", "--bereich", "alpha"],
  ["vorhaben", "--kuerzel", "VER", "--code-gelesen", "nein"],
  ["apply", "--anker", "HEAD"],
];

for (const tracker of ["github", "gitlab"]) {
  for (const argv of KOMMANDOS) {
    test(`[spec-3] ${argv[0]} weist ${tracker} ab`, () => {
      const dir = projekt(tracker);
      try {
        const res = spec(dir, ...argv);
        assert.notEqual(res.status, 0, `${argv.join(" ")} lief trotz ${tracker} durch`);
        assert.equal(res.stdout.trim(), "", "stdout muss im Abweisungsfall leer bleiben");
        assert.match(res.stderr, /issueTracker/, "die Meldung nennt das Feld nicht");
        assert.match(res.stderr, /A19/, "die Meldung verweist nicht auf A19");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

test("[spec-3] ein fehlendes issueTracker gilt als github und wird abgewiesen", () => {
  // Das Schema fuehrt issueTracker mit default "github" und required: []. Ein Block
  // ohne das Feld ist gueltig — und darf den Schalter nicht stillschweigend freigeben.
  const dir = mkdtempSync(join(tmpdir(), "spec-tracker-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "workflow.config.json"),
    `${JSON.stringify({ spec: SPEC_BLOCK }, null, 2)}\n`,
    "utf-8",
  );
  try {
    const res = spec(dir, "index");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /issueTracker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[spec-3] --help und --version laufen auch bei ausgeschlossenem Tracker", () => {
  const dir = projekt("github");
  try {
    const hilfe = spec(dir, "--help");
    assert.equal(hilfe.status, 0, hilfe.stderr);
    assert.match(hilfe.stdout, /spec\.mjs/);

    const version = spec(dir, "--version");
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /claude-workflow-kit v\d+\.\d+\.\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[spec-3] ohne spec-Block bleibt github unberuehrt (Kriterium 2)", () => {
  // Ein Projekt ohne Schalter merkt nichts — auch nicht von dieser Regel.
  const dir = projekt("github", { mitSpec: false });
  try {
    const res = spec(dir, "index");
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /A19/, "ohne spec-Block darf A19 nicht auftauchen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[spec-3] local wird nicht abgewiesen", () => {
  // A19 richtet sich gegen github und gitlab, nicht gegen den Datei-Tracker: Er hat
  // keinen Server, gegen den die Begruendung zielt, und er kann den Aktivitaetsverlauf
  // seit Issue #460. Waere er ausgeschlossen, verloeren rund 40 Spec-Tests ihre
  // Grundlage.
  const dir = projekt("local");
  try {
    const res = spec(dir, "index");
    assert.equal(res.status, 0, `local wurde abgewiesen: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /A19/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[spec-3] toolbox wird nicht abgewiesen", () => {
  const dir = projekt("toolbox");
  try {
    const res = spec(dir, "index");
    assert.equal(res.status, 0, `toolbox wurde abgewiesen: ${res.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
