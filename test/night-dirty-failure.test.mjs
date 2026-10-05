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
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Ein eigener Sperrpfad je Testprozess (Issue #958): Dieser Test faehrt das echte
// kit/checks.mjs, und ohne eigenen Pfad serialisierte die maschinenweite Sperre die
// parallelen Testdateien gegeneinander.
import "./helpers/checks-sperre.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

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
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  // Die Salvage-Vorpruefung faehrt seit Issue #919 `checks.mjs run` im Zielprojekt,
  // damit sie denselben Nachweis hinterlaesst, den das Commit-Gate liest. Ohne die
  // Datei im Fixture gaebe es keine Pflicht-Pruefung und damit keinen Rettungsversuch.
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    // Rote Pflichtchecks: damit ist der Salvage-Versuch ausgeschlossen und der Lauf
    // faellt direkt in den vierten hardStop-Ausgang.
    buildChecks: ["false"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\n");
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

test("Nachtlauf: Fehlschlag mit dirty Tree sichert die Reste im Stash, legt das Issue ins Backlog und laeuft weiter (Issue #1089, E14)", () => {
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

    // Ein Paket, das an sich selbst scheitert, haelt nur sich an: kein harter Stopp.
    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /FEHLSCHLAG[\s\S]*Working Tree dirty/, "die Fehlschlag-Meldung fehlt");
    assert.doesNotMatch(res.stdout, /HARTER STOPP/);
    assert.match(res.stdout, /Nacht-Runner beendet:[^\n]*2 abgebrochen mit Resten im Stash/,
      "die Abschlusszeile weist die abgebrochenen Pakete nicht aus");

    // Beide Pakete liefen; jedes liegt mit seinen Resten im eigenen Stash.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id), String(zweites.id)], "der Lauf ging nicht weiter");
    const stashes = run(dir, "git", ["stash", "list"]).stdout;
    for (const id of [erstes.id, zweites.id]) assert.match(stashes, new RegExp(`nachtrest #${id} `));
    // Die Laufdateien unter .claude/ zaehlen nicht als Rest und bleiben, wo sie sind.
    assert.doesNotMatch(run(dir, "git", ["status", "--porcelain"]).stdout, /work-/, "der Baum blieb unsauber");

    // Die Karte geht ins Backlog: Bliebe sie in Ready, zoege der Lauf sie erneut. Ihr
    // Kommentar nennt den Stash, ihr Laufstand den Abbruch.
    const full = board(dir, "issue", "get", String(erstes.id));
    assert.equal(full.status, "backlog");
    assert.match(full.body, /Working Tree nicht sauber hinterlassen/);
    assert.match(full.body, new RegExp(`Die Reste liegen im Stash „nachtrest #${erstes.id} `));
    assert.ok(full.labels.includes("lauf:abgebrochen"), `Labels: ${full.labels}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
