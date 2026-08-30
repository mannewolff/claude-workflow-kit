// E2E fuer die kit:klaeren-Leitplanke des Nacht-Runners (Issue #382, offener Rest
// von #251).
//
// Anders als [Fachlich]/[Idee]/[Plan] haengt dieses Gate nicht am Titel, sondern an
// einem Label — und es hat eine Richtung: Die Maschine darf es SETZEN, aber nie
// ABNEHMEN (Plan #368, A4). Ein Lauf, der sein eigenes kit:klaeren abraeumen
// duerfte, koennte sich selbst freigeben.
//
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { selectReviewCandidates } from "../kit/night.mjs";

const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-klaeren-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.invalid"]],
    ["git", ["config", "user.name", "Night Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-q", "-m", "setup"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

const issueText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
const kommentare = (text) =>
  text.split(/\n---\n\*\*Kommentar\*\* \([^)]*\)\n\n/).slice(1).map((k) => k.trim());

// --- Implementierungsschleife ---

test("Nachtlauf: Ready-Issue mit kit:klaeren wird kommentiert uebersprungen", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const gezeichnet = board(dir, "issue", "create", "--title", "Gezeichnetes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const normal = board(dir, "issue", "create", "--title", "Normales technisches Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "label", "add", String(gezeichnet.id), "kit:klaeren");
    board(dir, "issue", "move", String(gezeichnet.id), "ready");
    board(dir, "issue", "move", String(normal.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_PROMPT" >> ${JSON.stringify(sessionLog)} && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(gezeichnet.id)), "gezeichnetes Issue liegt nicht im Backlog");

    assert.deepEqual(kommentare(issueText(dir, gezeichnet.id)), [
      `Nachtlauf: Traegt kit:klaeren — eine offene Entscheidung wartet auf einen Menschen, wird nicht implementiert.`,
    ]);

    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(normal.id)), "normales Issue liegt nicht in In review");
    assert.deepEqual(readFileSync(sessionLog, "utf-8").trim().split("\n"), [`/implement-next #${normal.id}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A4: Die Maschine setzt, der Mensch nimmt ab. Ohne diesen Test koennte ein
// spaeterer Umbau das Label "aufraeumen" und der Runner gaebe sich selbst frei.
test("Nachtlauf entfernt das Label NIE", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const gezeichnet = board(dir, "issue", "create", "--title", "Bleibt gezeichnet", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "label", "add", String(gezeichnet.id), "kit:klaeren");
    board(dir, "issue", "move", String(gezeichnet.id), "ready");

    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}`);

    assert.ok(board(dir, "issue", "get", String(gezeichnet.id)).labels.includes("kit:klaeren"),
      "der Lauf hat kit:klaeren entfernt — A4 verletzt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dry-Run weist gezeichnete Issues aus, ohne etwas zu bewegen", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const gezeichnet = board(dir, "issue", "create", "--title", "Gezeichnet im Dry-Run", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "label", "add", String(gezeichnet.id), "kit:klaeren");
    board(dir, "issue", "move", String(gezeichnet.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_PROMPT" >> ${JSON.stringify(sessionLog)}`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `dry-run schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /wuerde ins Backlog \(kit:klaeren, offene Entscheidung\)/);
    assert.match(res.stdout, /0 Session\(s\) wuerden starten/);

    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(gezeichnet.id)), "dry-run hat das Issue bewegt — darf er nicht");
    assert.deepEqual(kommentare(issueText(dir, gezeichnet.id)), [], "dry-run hat kommentiert — darf er nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Review-Kandidaten ---

test("selectReviewCandidates sortiert gezeichnete Issues aus", () => {
  const issues = [
    { id: 1, title: "Gezeichnet", body: "## Kontext\n", labels: ["kit:klaeren"] },
    { id: 2, title: "Normal", body: "## Kontext\n", labels: [] },
  ];
  const { kandidaten, uebersprungen } = selectReviewCandidates(issues, { stufe: "issue" });
  assert.deepEqual(kandidaten.map((i) => i.id), [2]);
  assert.deepEqual(uebersprungen, [{ id: 1, title: "Gezeichnet", grund: "kit:klaeren, offene Entscheidung" }]);
});

test("selectReviewCandidates: kit:klaeren gilt in jeder Stufe", () => {
  const issues = [
    { id: 1, title: "[Fachlich] Gezeichnet", body: "## Ziel\n", labels: ["kit:klaeren"] },
    { id: 2, title: "[Plan] Gezeichnet", body: "## Ziel\n", labels: ["kit:klaeren"] },
  ];
  for (const stufe of ["fachlich", "plan"]) {
    assert.deepEqual(selectReviewCandidates(issues, { stufe }).kandidaten, [],
      `Stufe ${stufe}: gezeichnetes Dokument kam als Kandidat durch`);
  }
});

// --- Skill-Texte ---

test("implement-ready und implement-next nennen kit:klaeren, die anderen beiden nicht", () => {
  const lies = (skill) => readFileSync(join(repoRoot, "skills", skill, "SKILL.md"), "utf-8");
  for (const skill of ["implement-ready", "implement-next"]) {
    assert.match(lies(skill), /kit:klaeren/, `${skill} nennt kit:klaeren nicht`);
  }
  // Konvention, festgehalten im Kopf von skills-plan-gate.test.mjs: Nur ready/next
  // und der Nacht-Runner tragen die mechanische Leitplanke.
  for (const skill of ["implement-test", "implement-done"]) {
    assert.doesNotMatch(lies(skill), /kit:klaeren/,
      `${skill} nennt kit:klaeren — die Konvention wird hier nicht erweitert`);
  }
});
