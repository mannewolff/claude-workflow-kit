// Die Salvage-Vorpruefung kennt die Fehlermerkmale wie checks.mjs (Issue #859).
//
// Vor einem Rettungsversuch faehrt der Runner die Pflichtchecks selbst, per
// `spawnSync` und damit an `checks.mjs` vorbei. Kennt nur `checks.mjs` die
// Merkmal-Pruefung aus #858, entsteht eine Drift: Ein Kommando mit Rueckgabewert 0
// und einem Fehlermerkmal in der Ausgabe waere fuer den Salvage gruen und fuer
// `checks.mjs` rot — die Salvage-Session schoebe ein Paket nach In review, das
// `/push-main` danach anhaelt. Derselbe Fall wie die Guetemessung in #817.
//
// Die Merkmale stehen hier NICHT woertlich: Diese Suite laeuft selbst unter der
// Merkmal-Pruefung dieses Repos, und ein Merkmal in einem Testnamen faerbte den
// eigenen Prueflauf rot. Deshalb entstehen die Literale erst zur Laufzeit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

/** Die beiden Merkmale, zur Laufzeit gebaut — siehe Kopfkommentar. */
const MERKMAL_STUFE = `${String.fromCharCode(91)}ERROR${String.fromCharCode(93)}`;
const MERKMAL_BAU = ["BUILD", "FAILURE"].join(" ");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(buildChecks) {
  const dir = mkdtempSync(join(tmpdir(), "night-merkmal-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    local: { issuesDir: "issues" },
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

// Die regulaere Runde hinterlaesst unkommittete Arbeit und bewegt das Board
// nicht — genau das Schadensbild, das den Salvage ueberhaupt erst ausloest.
function fakeSession(sessionLog, salvageBody) {
  return `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}\n`
    + `if [ -n "$NIGHT_SALVAGE" ]; then\n`
    + `  echo "salvage $NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}\n`
    + `  ${salvageBody}\n`
    + `else\n`
    + `  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"\n`
    + `fi\n`;
}

/**
 * Ein Kommando, das den Text ausgibt und mit 0 endet — der Fall, um den es geht.
 * Der Text steht in einfachen Anfuehrungszeichen innerhalb der doppelten: So
 * bleibt die eckige Klammer der Shell verborgen. `node -e` statt `echo`, damit
 * POSIX und Windows dasselbe sehen.
 */
function gibtAus(text) {
  return `node -e "console.log('${text}')"`;
}

/** Faehrt einen Lauf mit genau einem Ready-Issue und den gegebenen buildChecks. */
function lauf(buildChecks) {
  const dir = setupProjekt(buildChecks);
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog,
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    return {
      res,
      geretttet: inReview.includes(String(erstes.id)),
      sessions: readFileSync(sessionLog, "utf-8").trim().split("\n"),
      id: String(erstes.id),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [wie, merkmal] of [["ersten", MERKMAL_STUFE], ["zweiten", MERKMAL_BAU]]) {
  test(`[night-859] Salvage: Exit 0 mit dem ${wie} Merkmal in der Ausgabe ist rot — kein Rettungsversuch`, NUR_POSIX, () => {
    const { res, geretttet, sessions, id } = lauf([gibtAus(merkmal)]);

    assert.equal(res.status, 1, `night.mjs haette hart stoppen muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Salvage nicht moeglich/,
      "das Fehlermerkmal haette den Salvage verhindern muessen");
    assert.doesNotMatch(res.stdout, /SALVAGE-VERSUCH gestartet/,
      "bei einem Fehlermerkmal darf keine Salvage-Session starten");
    assert.match(res.stdout, /Fehlermerkmal in der Ausgabe/,
      "die Meldung nennt das Fehlermerkmal nicht");
    assert.ok(res.stdout.includes(merkmal), "die Meldung nennt das getroffene Merkmal nicht");
    assert.match(res.stdout, /FEHLSCHLAG[\s\S]*Working Tree dirty/, "die Fehlschlag-Meldung fehlt");

    assert.deepEqual(sessions, [id], "es lief nicht genau die regulaere Session");
    assert.equal(geretttet, false, "mit einem Fehlermerkmal darf nichts nach In review wandern");
  });
}

test("[night-859] Salvage: dasselbe Kommando ohne Merkmal bleibt gruen und rettet", NUR_POSIX, () => {
  // Die Gegenprobe zum Fall darueber: Ohne das Merkmal ist der Lauf unveraendert
  // gruen — die Pruefung faerbt also nicht pauschal jede Ausgabe rot.
  const { res, geretttet } = lauf([gibtAus("alles gut")]);

  assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
  assert.doesNotMatch(res.stdout, /Fehlermerkmal in der Ausgabe/,
    "eine merkmalfreie Ausgabe darf die Meldung nicht ausloesen");
  assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
    "die Salvage-Startzeile fehlt");
  assert.ok(geretttet, "Issue haette in In review landen muessen");
});
