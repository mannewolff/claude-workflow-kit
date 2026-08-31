// E2E fuer den vierten hardStop-Ausgang: Fehlschlag mit dirty Tree (Issue #404).
//
// Die drei anderen harten Stopps sind bereits per Subprozess-E2E festgehalten
// (night-infra: Session-Fehlstart, night-dirty-success: Erfolg mit Rest,
// night-salvage: gescheiterte Salvage-Session). Dieser Ausgang wird von
// night-salvage zwar *durchlaufen* — rote buildChecks fuehren dort an dieselbe
// Stelle —, aber nur an der Log-Zeile geprueft. Seine Wirkung stand nirgends:
// dass das Issue liegen bleibt statt ins Backlog zu wandern, dass ein Kommentar
// am Ticket haengt und dass der Lauf mit "HARTER STOPP" endet.
//
// Das ist der Unterschied, auf den es beim Umbau von main() (Issue #404) ankommt:
// Ein Fehlschlag, der das Issue verschiebt, sieht am naechsten Morgen aus wie ein
// zurueckgestelltes Ticket — nicht wie ein Lauf, der mitten im Baum stehengeblieben
// ist. Die Log-Zeile allein haelt das nicht fest.
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

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
// Die Isolation leistet cwd + KIT_ROOT auf das Fixture-Verzeichnis (Issue #189).
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
  const dir = mkdtempSync(join(tmpdir(), "night-dirty-failure-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    // Rote Pflichtchecks: damit ist der Salvage-Versuch ausgeschlossen und der Lauf
    // faellt direkt in den vierten hardStop-Ausgang.
    buildChecks: ["false"],
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

test("Nachtlauf: Fehlschlag mit dirty Tree stoppt hart und laesst das Issue liegen", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    // Session-Fake: endet mit Exit 0 (also kein Infrastruktur-Fehlschlag), bringt das
    // Issue aber NICHT nach In review und laesst unkommittete Arbeit liegen.
    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}`
      + ` && echo arbeit > "work-$NIGHT_ISSUE_ID.txt"`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, `night.mjs haette mit Exit 1 enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /FEHLSCHLAG[\s\S]*Working Tree dirty/, "die Fehlschlag-Meldung fehlt");
    // Die Abschlusszeile trennt den harten Stopp vom sauberen Ende — das ist das
    // Signal, das der Morgen liest.
    assert.match(res.stdout, /Nacht-Runner beendet:[^\n]*HARTER STOPP/,
      "die Abschlusszeile weist den harten Stopp nicht aus");

    // Kein Backlog-Move: Ein verschobenes Issue sieht morgens aus wie ein regulaer
    // zurueckgestelltes, obwohl der Lauf mitten im Baum stehengeblieben ist.
    const ready = new Set(board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id)));
    assert.ok(ready.has(String(erstes.id)), "das gescheiterte Issue haette in Ready bleiben muessen");
    assert.ok(ready.has(String(zweites.id)), "zweites Issue haette in Ready bleiben muessen");

    // Der Kommentar am Ticket ist der Hinweis fuer die morgendliche Sichtung.
    // Der lokale Tracker haengt Kommentare an den Body an, statt sie in einem
    // eigenen Feld zu fuehren — deshalb wird hier der Body geprueft.
    const full = board(dir, "issue", "get", String(erstes.id));
    assert.match(full.body, /Working Tree nicht sauber hinterlassen/,
      "am gescheiterten Issue haengt kein Hinweis auf den harten Stopp");

    // Genau eine Session: Der Lauf bricht ab, statt das naechste Issue anzufassen.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id)], "es lief nicht genau eine Session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
