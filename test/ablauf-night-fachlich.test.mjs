// Ablauf-Pruefung: die Fachlich-Leitplanke wirkt im Zusammenspiel von Auswahl, Board und Session ueber einen ganzen Lauf von night.mjs.
//
// E2E fuer die Fachlich-Leitplanke des Nacht-Runners (Issue #146).
// Fachliche Issues ([Fachlich]-Titelpraefix) werden nie implementiert: liegt eines
// in Ready, stellt der Runner es kommentiert ins Backlog zurueck, startet dafuer
// KEINE Session und macht mit dem naechsten Issue weiter.
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD (verschiebt das Issue nach in_review und protokolliert den Aufruf).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { lfAttribute } from "./helpers/zeilenenden.mjs";
import { mitSzenarien } from "./helpers/szenarien-fixture.mjs";


const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
// Die Isolation leistet cwd + KIT_ROOT auf das Fixture-Verzeichnis (Issue #189).
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  const res = spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
  return res;
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-fachlich-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  cpSync(join(repoRoot, "kit", "texte"), join(dir, ".claude", "kit", "texte"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  // Wie im dokumentierten Nachtbetrieb-Setup: Runner-Log (und das Fake-Session-Log
  // dieses Tests) sind gitignored, sonst waere der Tree nach dem Start dirty.
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\n");
  // night.mjs verlangt einen sauberen Working Tree — alles committen.
  lfAttribute(join(dir, ".gitattributes"));
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

function issuesDirText(dir) {
  const issuesDir = join(dir, "issues");
  return readdirSync(issuesDir)
    .map((f) => readFileSync(join(issuesDir, f), "utf-8"))
    .join("\n---\n");
}

test("Nachtlauf: fachliches Issue wird kommentiert uebersprungen, normales Issue laeuft", () => {
  const dir = setupProjekt();
  try {
    const fachlich = board(dir, "issue", "create", "--title", "[Fachlich] Kunden-Selbstauskunft", "--body", mitSzenarien("## Ziel\nPO-Story."));
    const normal = board(dir, "issue", "create", "--title", "Normales technisches Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(fachlich.id), "ready");
    board(dir, "issue", "move", String(normal.id), "ready");

    // Session-Fake: protokolliert den Aufruf und meldet Erfolg uebers Board.
    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)} && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    // Fachliches Issue: zurueck im Backlog, mit Nachtlauf-Kommentar, KEINE Session dafuer.
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(fachlich.id)), "fachliches Issue liegt nicht im Backlog");
    assert.match(issuesDirText(dir), /[Ff]achlich\w*\s+Issue.*nicht implementiert/s);

    // Normales Issue: in In review, genau eine Session, und zwar fuer das normale Issue.
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(normal.id)), "normales Issue liegt nicht in In review");
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(normal.id)], "es lief nicht genau eine Session fuer das normale Issue");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dry-Run weist fachliche Issues als uebersprungen aus, ohne etwas zu bewegen", () => {
  const dir = setupProjekt();
  try {
    const fachlich = board(dir, "issue", "create", "--title", "[Fachlich] Reporting-Wunsch", "--body", mitSzenarien("## Ziel\nStory."));
    board(dir, "issue", "move", String(fachlich.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"]);
    assert.equal(res.status, 0, `dry-run schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /fachlich/i, "dry-run erwaehnt das fachliche Issue nicht");
    assert.match(res.stdout, /0 Session\(s\) wuerden starten/, "dry-run wuerde faelschlich eine Session starten");

    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(fachlich.id)), "dry-run hat das Issue bewegt — darf er nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Szenarien in der Nacht-Kette (Issue #1593, Plan #1588 A6, A7, E13, E14) -----------------
//
// Ein pflichtiger Fachplan ohne vollstaendiges Szenario laeuft auch nachts in keinen Plan
// (Kriterium 4 der fachlichen Quelle #1586); Altbestand unter dem Stichtag bleibt unbeanstandet
// (Kriterium 5). Fehlt der Stichtag, nennt die Kette das einmal je Lauf im Protokoll und im
// Nachtbericht, ohne Kommentar und ohne Laufstand.

const kette = await import("./helpers/kette-ablauf.mjs");

/** Der Fachplan #F ohne seinen Abschnitt Szenarien — `issue update` weist das nicht ab (E13). */
function ohneSzenarien(dir, F) {
  const body = kette.fachplanBody().replace(/## Szenarien\n[\s\S]*?(?=## Nicht-Ziele)/, "");
  assert.ok(!body.includes("Szenari"), "der Abschnitt ist noch im Body");
  kette.board(dir, "issue", "update", F, "--body", body);
}

test("Szenario: pflichtiger Fachplan ohne Abschnitt Szenarien wird von der Kette ausgeschlossen", () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    ohneSzenarien(dir, F);
    const res = kette.run(dir, ["--chain", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes(`#${F} [Fachlich] Ein Anliegen -> uebersprungen (Fachplan #${F} hat keinen Abschnitt Szenarien; er entsteht beim Groomen (\`/groom #${F}\`))`),
      res.stdout);
    assert.ok(!res.stdout.includes("-> Kette 1"), "die Kette darf nicht anlaufen");
  }, {}, "night-szenarien-", { szenarienAb: 1 });
});

test("Szenario: Altbestand ohne Abschnitt Szenarien wird von der Kette nicht ausgeschlossen", () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    ohneSzenarien(dir, F);
    const res = kette.run(dir, ["--chain", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes(`#${F} [Fachlich] Ein Anliegen -> Kette 1`), res.stdout);
    assert.ok(!res.stdout.includes("keinen Abschnitt Szenarien"), res.stdout);
    assert.ok(!res.stdout.includes("Stichtag fehlt"), "mit Stichtag kein Hinweis");
  }, {}, "night-szenarien-", { szenarienAb: 99 });
});

test("Szenario: fehlt der Stichtag, nennt die Kette ihn im Protokoll und im Nachtbericht", () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    const env = kette.umgebung(dir, { stufen: { plan: kette.PLAN_ANLEGEN, review: kette.REVIEW_MARKER, pakete: kette.PAKETE_ANLEGEN } });
    const res = kette.run(dir, ["--chain"], env);
    assert.equal(res.status, 0, res.stderr);
    const zeilen = res.stdout.split("\n").filter((z) => z.includes("Stichtag fehlt"));
    assert.equal(zeilen.length, 1, `genau eine log-Zeile je Lauf:\n${res.stdout}`);
    assert.match(zeilen[0], /szenarienAb/);

    const text = readFileSync(join(dir, "issues", `${F}.md`), "utf-8");
    assert.match(text, /### Hinweise\n\n- Stichtag fehlt: `szenarienAb`/);
    // Kein eigener Kommentar: Der Hinweis steht genau einmal, im Nachtbericht.
    assert.equal(text.split("Stichtag fehlt").length - 1, 1, "der Hinweis steht nur im Nachtbericht");
  }, {}, "night-szenarien-");
});
