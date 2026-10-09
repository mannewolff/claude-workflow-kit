// Ablauf-Pruefung: Ob ein echter Push mit seinem eigenen sync-blobs eine saubere Kopie ergibt und der Runner als Kind aus ihm laeuft, zeigt nur der echte Lauf mit git.
//
// Der feste Kit-Stand eines unbeaufsichtigten Laufs im Lauf (Issue #1102, Plan #1101): die
// echte Bereitstellung aus einem Push und der Runner, der als Kind aus ihr laeuft. Ermitteln,
// Einsetzen, Freigeben, die Erkennung des Kindes und das Aufraeumen als Einheit belegt
// test/night-kitstand-stand.test.mjs im selben Prozess (Issue #1226).
//
// Der Stand ist der Commit, auf den `refs/remotes/origin/<mainBranch>` beim Start zeigt
// (E1, ohne `git fetch`). Er greift nur, wenn dieser Commit die Kit-Quelle selbst traegt
// (E3); andere Projekte laufen unveraendert. Kann er nicht bereitgestellt werden, bricht
// der Lauf ab, statt still auf die Kopie der Hauptkopie zurueckzufallen (E2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";


import { KIT_STAND_MARKIERUNG } from "../kit/night/grundlagen.mjs";
import { kitStandErmitteln, kitStandBereitstellen, kitStandEinsetzen, kitStandFreigeben } from "../kit/night/kitstand.mjs";
import {
  kitFixture, git, runner, board, laufStand, standWorktrees, aufraeumen,
} from "./helpers/kitstand-fixture.mjs";

function mitFixture(optionen, fn) {
  const fx = kitFixture(optionen);
  try {
    return fn(fx);
  } finally {
    aufraeumen(fx);
  }
}

// --- Bereitstellen (A1, E2, E4) ---

test("[kitstand-2] bereitgestellt wird eine installierte Kopie des Pushs in einem eigenen Worktree", () => {
  mitFixture({}, ({ dir }) => {
    const { commit } = kitStandErmitteln(dir, "main");
    const pfad = kitStandBereitstellen(dir, commit, "implementierung");
    assert.ok(basename(pfad).startsWith(`kitstand-implementierung-${basename(dir)}-`), pfad);
    assert.equal(git(pfad, "rev-parse", "HEAD"), commit, "der Worktree steht auf dem Stand");
    assert.equal(git(pfad, "status", "--porcelain", "--untracked-files=no"), "", "abgeloest und unveraendert");
    for (const datei of [
      [".claude", "kit", "night.mjs"], [".claude", "kit", "checks.mjs"], [".claude", "kit", "board.mjs"],
      [".claude", "skills", "issue-review", "SKILL.md"], [".claude", "CLAUDE-workflow.md"], [".githooks", "gate.mjs"],
      [".claude", "kit", "rollen", "code-review.md"], [".claude", "agents", "kit-pruefer.md"],
    ]) {
      assert.ok(existsSync(join(pfad, ...datei)), `${datei.join("/")} fehlt im Stand`);
    }
    // Die Arbeitskopie steht hier noch auf dem Push.
    assert.equal(readFileSync(join(pfad, ".claude", "kit", "checks.mjs"), "utf-8"),
      readFileSync(join(dir, "kit", "checks.mjs"), "utf-8"), "die Kopie ist die Quelle des Pushs");
  });
});

// Issue #1377: Der Leser-Agent liegt unter .claude/agents/, nicht unter kit/ oder skills/ —
// ohne eigenen Schritt fehlte er in jeder Sitzung eines unbeaufsichtigten Laufs.
test("[kitstand-3] der eingesetzte Kit-Stand traegt agents neben kit und skills", () => {
  mitFixture({}, ({ dir }) => {
    const { commit } = kitStandErmitteln(dir, "main");
    const pfad = kitStandBereitstellen(dir, commit, "implementierung");
    const baum = mkdtempSync(join(tmpdir(), "kitstand-agents-"));
    try {
      kitStandEinsetzen({ commit, pfad }, baum);
      for (const teil of ["kit", "skills", "agents"]) {
        assert.ok(existsSync(join(baum, ".claude", teil)), `.claude/${teil} fehlt im eingesetzten Stand`);
      }
      assert.equal(readFileSync(join(baum, ".claude", "agents", "kit-pruefer.md"), "utf-8"),
        readFileSync(join(dir, "agents", "kit-pruefer.md"), "utf-8"), "der Agent ist der des Stands");
    } finally {
      kitStandFreigeben(baum);
      rmSync(baum, { recursive: true, force: true });
    }
  });
});

// Issue #1125 (Teil von #1122): Unter Windows checkt Git mit `core.autocrlf=true` aus. Ohne die
// `.gitattributes` des Repos bekam der Stand-Worktree CRLF, `sync-blobs` sah andere Bytes und
// schrieb Blobs und Stempel neu — in der CI trug der Worktree ` M install.mjs`. Nachgestellt
// ueber dieselbe Einstellung, damit der Fall auch hier laeuft.
test("[kitstand-2] auch mit core.autocrlf=true bleibt der Stand-Worktree unveraendert", () => {
  mitFixture({}, ({ dir }) => {
    git(dir, "config", "core.autocrlf", "true");
    const { commit } = kitStandErmitteln(dir, "main");
    const pfad = kitStandBereitstellen(dir, commit, "implementierung");
    assert.equal(git(pfad, "status", "--porcelain", "--untracked-files=no"), "", "der Stand ist unter CRLF-Auschecken nicht sauber");
  });
});

// --- Erkennung des Kindes (A2) ---

test("[kitstand-4] ein Runner mit ererbtem KIT_STAND, der nicht aus dem Stand laeuft, baut seinen eigenen", () => {
  mitFixture({}, ({ dir }) => {
    const commit = git(dir, "rev-parse", "refs/remotes/origin/main");
    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "true", KIT_STAND: "deadbeef", KIT_STAND_PFAD: "/nicht/vorhanden" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const lauf = laufStand(dir);
    assert.equal(lauf.schemaFassung, 1);
    assert.deepEqual(lauf.kitStand, {
      commit, ref: "origin/main", commitZeit: git(dir, "show", "-s", "--format=%cI", commit),
    });
    assert.match(res.stdout, new RegExp(`Kit-Stand: ${commit.slice(0, 12)} \\(origin/main vom \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}\\)`));
    const staende = standWorktrees(dir);
    assert.equal(staende.length, 1, `genau ein Stand-Worktree erwartet: ${staende.join(", ")}`);
    assert.ok(basename(staende[0]).startsWith("kitstand-implementierung-"));
    assert.equal(existsSync(join(staende[0], ".claude", "kit", "night.mjs")), true, "der Runner des Stands liegt bereit");
    assert.equal(existsSync(join(dir, KIT_STAND_MARKIERUNG)), false, "ohne Paket keine Markierung in der Hauptkopie");
  });
});

// --- Gegenprobe und Abbruch (E2, E3) ---

test("[kitstand-5] Gegenprobe: ohne kit/night.mjs unter origin laeuft der Runner ohne Stand-Schritt, kitStand ist null", () => {
  mitFixture({ mitKitQuelle: false }, ({ dir }) => {
    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const lauf = laufStand(dir);
    assert.equal(lauf.kitStand, null);
    assert.equal(lauf.schemaFassung, 1);
    assert.deepEqual(standWorktrees(dir), [], "kein Stand-Worktree");
    assert.doesNotMatch(res.stdout, /Kit-Stand:/);
  });
});

test("[kitstand-5] fehlt origin/main in einem Repo mit Kit-Quelle, bricht der Lauf vor der ersten Sitzung ab", () => {
  mitFixture({ ohneOrigin: true }, ({ dir }) => {
    const spur = join(dir, "helfer", "sitzung");
    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: `touch ${spur}` });
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /Kit-Stand/);
    assert.match(res.stderr, /origin\/main/);
    assert.equal(existsSync(spur), false, "keine Sitzung");
    assert.deepEqual(standWorktrees(dir), []);
  });
});

// --- Aufraeumen erst nach den Vorpruefungen (Issue #1200) ---

test("[kitstand-6] ein Start, der an der Vorpruefung scheitert, laesst einen verwaisten Stand derselben Laufart stehen", () => {
  mitFixture({}, ({ dir }) => {
    const alt = join(tmpdir(), `kitstand-implementierung-${basename(dir)}-alt`);
    mkdirSync(alt, { recursive: true });
    board(dir, "issue", "create", "--title", "Ein Paket", "--body", "Autor-Modell: x");
    board(dir, "issue", "move", "1", "in_progress");

    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.notEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}${res.stderr}`, /In progress \(#0*1\)/);
    assert.ok(existsSync(alt), "der Stand ohne lebenden Halter bleibt unangetastet");
    assert.doesNotMatch(res.stdout, /Liegengebliebenen Kit-Stand entfernt/);
  });
});

test("[kitstand-6] ein Start, der die Vorpruefungen besteht, raeumt den verwaisten Stand ab und behaelt den eigenen", () => {
  mitFixture({}, ({ dir }) => {
    const alt = join(tmpdir(), `kitstand-implementierung-${basename(dir)}-alt`);
    mkdirSync(alt, { recursive: true });

    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(existsSync(alt), false, "der verwaiste Stand ist weg");
    // Gemeldet wird der realpath (Issue #1372).
    assert.ok(res.stdout.includes(`Liegengebliebenen Kit-Stand entfernt: ${join(realpathSync(tmpdir()), basename(alt))}`), res.stdout);
    const staende = standWorktrees(dir);
    assert.equal(staende.length, 1, `genau der eigene Stand bleibt: ${staende.join(", ")}`);
    assert.ok(existsSync(join(staende[0], ".claude", "kit", "night.mjs")), "der eigene Stand steht noch");
  });
});

