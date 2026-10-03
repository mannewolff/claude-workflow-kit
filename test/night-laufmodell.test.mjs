// Das Modell des Laufs kommt aus der Config (Issue #994).
//
// Bis dahin stand es fest im Code (`DEFAULT_MODEL`), und nur `--model` konnte es aendern.
// `night.modelle` ist bloss die Liste der erlaubten Namen, `night.stufen` gilt nur fuer
// Pakete mit `Aufgabenstufe:` — ein Projekt, das ueberall `claude-opus-5-5` eingetragen
// hatte, fuhr Plan, Review und Abdeckung trotzdem mit `claude-opus-5`.
//
// Vorrang: `--model` vor `night.modell` vor `DEFAULT_MODEL`. `night.modell` muss in
// `night.modelle` stehen; sonst endet der Runner vor dem Vorflug, statt still auf ein
// Modell zurueckzufallen, das niemand gewaehlt hat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { laufModell } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const ERLAUBT = ["claude-opus-5-5", "claude-sonnet-5"];

// --- Die reine Funktion ---

test("laufModell: --model gewinnt vor night.modell", () => {
  const r = laufModell({ model: "claude-sonnet-5", modelGesetzt: true }, { night: { modell: "claude-opus-5-5", modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-sonnet-5", herkunft: "--model", fehler: null });
});

test("laufModell: ohne --model gilt night.modell", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modell: "claude-opus-5-5", modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-opus-5-5", herkunft: "night.modell", fehler: null });
});

test("laufModell: ohne beides gilt die Vorgabe", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-opus-5", herkunft: "Vorgabe", fehler: null });
  assert.equal(laufModell({ model: "claude-opus-5", modelGesetzt: false }, {}).herkunft, "Vorgabe");
});

test("laufModell: night.modell ausserhalb von night.modelle ist ein Fehler, der Feld und Wert nennt", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modell: "claude-haiku-4-5", modelle: ERLAUBT } });
  assert.equal(r.modell, null);
  assert.match(r.fehler, /night\.modell/);
  assert.match(r.fehler, /claude-haiku-4-5/);
  assert.match(r.fehler, /night\.modelle/);
});

test("laufModell: ohne night.modelle ist jedes night.modell ein Fehler", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modell: "claude-opus-5-5" } });
  assert.equal(r.modell, null);
  assert.match(r.fehler, /claude-opus-5-5/);
});

test("laufModell: --model wird wie bisher nicht gegen night.modelle geprueft", () => {
  const r = laufModell({ model: "claude-fremd-1", modelGesetzt: true }, { night: { modell: "claude-opus-5-5", modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-fremd-1", herkunft: "--model", fehler: null });
});

// --- Der Runner: Startzeile im Trockenlauf ---

function fixture({ night = null, lokal = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-laufmodell-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
    ...(night ? { night } : {}),
  }, null, 2));
  if (lokal) writeFileSync(join(dir, ".claude", "workflow.config.local.json"), JSON.stringify(lokal, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/night-run-*.json\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
  }
  return dir;
}

function trockenlauf(dir, extra = []) {
  const res = spawnSync(process.execPath, [NIGHT, "--dry-run", "--label", "none", ...extra],
    { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
  return { ...res, alles: `${res.stdout || ""}${res.stderr || ""}` };
}

function mitFixture(optionen, fn) {
  const dir = fixture(optionen);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Startzeile: night.modell aus der geteilten Config samt Herkunft", () => {
  mitFixture({ night: { modell: "claude-opus-5-5", modelle: ERLAUBT } }, (dir) => {
    const res = trockenlauf(dir);
    assert.equal(res.status, 0, res.alles);
    assert.match(res.alles, /Nacht-Runner startet \(.*Modell claude-opus-5-5 \(night\.modell\)/);
  });
});

test("Startzeile: --model gewinnt und nennt sich als Herkunft", () => {
  mitFixture({ night: { modell: "claude-opus-5-5", modelle: ERLAUBT } }, (dir) => {
    const res = trockenlauf(dir, ["--model", "claude-sonnet-5"]);
    assert.equal(res.status, 0, res.alles);
    assert.match(res.alles, /Modell claude-sonnet-5 \(--model\)/);
  });
});

test("Startzeile: ohne beides gilt die Vorgabe", () => {
  mitFixture({}, (dir) => {
    const res = trockenlauf(dir);
    assert.equal(res.status, 0, res.alles);
    assert.match(res.alles, /Modell claude-opus-5 \(Vorgabe\)/);
  });
});

test("night.modell ausserhalb von night.modelle beendet den Runner vor dem Start", () => {
  mitFixture({ night: { modell: "claude-haiku-4-5", modelle: ERLAUBT } }, (dir) => {
    const res = trockenlauf(dir);
    assert.notEqual(res.status, 0, "der Runner darf nicht weiterlaufen");
    assert.match(res.alles, /night\.modell/);
    assert.match(res.alles, /claude-haiku-4-5/);
    assert.doesNotMatch(res.alles, /Nacht-Runner startet/, "der Abbruch kommt vor dem Start");
  });
});

test("ein night.modell aus der lokalen Config wird ignoriert und gemeldet", () => {
  mitFixture({ night: { modelle: ERLAUBT }, lokal: { night: { modell: "claude-sonnet-5" } } }, (dir) => {
    const res = trockenlauf(dir);
    assert.equal(res.status, 0, res.alles);
    assert.match(res.stderr, /'night'.*ignoriert/, `die Meldung fehlt: ${res.stderr}`);
    assert.match(res.alles, /Modell claude-opus-5 \(Vorgabe\)/);
  });
});
