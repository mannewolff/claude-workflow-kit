// Der Nacht-Runner startet jede Session ohne das Auto-Memory des Menschen (Issue #772).
//
// Claude Code laedt das persoenliche Gedaechtnis in jede Session, auch in eine
// unbeaufsichtigte. Es ist fuer die Zusammenarbeit mit einem Menschen geschrieben
// ("mit Manne klaeren", "Rueckfrage stellen") und wirkt nachts falsch: Am 2026-09-21
// hat eine Nacht-Session daraus abgeleitet, sie duerfe eine Stopp-Frage im Gespraech
// klaeren statt am Board zu parken — es sass niemand daneben.
//
// Geprueft wird die Prozessgrenze: Kommt CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in der
// Umgebung jeder der drei Session-Arten an (Implementierung, Salvage, Vorflug), und
// stehen die uebrigen Variablen unveraendert daneben. Laeuft lokal: issueTracker
// "local", Session-Fake via NIGHT_CLAUDE_CMD bzw. NIGHT_VORFLUG_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Der Vorflug laeuft nur im Kettenmodus — sein Fixture steht schon bereit.
import {
  NUR_POSIX, NIGHT, repoRoot, run as ketteRun, mitProjekt, fachplan, umgebung, VORFLUG_OK,
} from "./helpers/kette-fixture.mjs";

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs],
    { KIT_AGENT_MODEL: "fixture-modell" });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-auto-memory-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/checks-summary.json\nenv.log\n");
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

/**
 * Die Shell-Zeile, mit der ein Session-Fake seine Umgebung protokolliert: je Session
 * eine Tab-getrennte Zeile. Neben der neuen Variablen stehen die vier, die es schon
 * gab — ein Test, der nur die neue misst, saehe nicht, wenn sie eine andere verdraengt.
 */
function envProbe(logPfad) {
  return String.raw`printf '%s\t%s\t%s\t%s\t%s\t%s\n'`
    + ` "\${CLAUDE_CODE_DISABLE_AUTO_MEMORY:-KEINE}"`
    + ` "\${KIT_AGENT_MODEL:-KEINE}"`
    + ` "\${NIGHT_ISSUE_ID:-KEINE}"`
    + ` "\${NIGHT_PROMPT:+gesetzt}"`
    + ` "\${NIGHT_SALVAGE:-KEINE}"`
    + ` "\${NIGHT_VORFLUG:-KEINE}"`
    + ` >> ${JSON.stringify(logPfad)}`;
}

function envZeilen(logPfad) {
  return readFileSync(logPfad, "utf-8").trim().split("\n").filter(Boolean).map((z) => {
    const [autoMemory, modell, issueId, prompt, salvage, vorflug] = z.split("\t");
    return { autoMemory, modell, issueId, prompt, salvage, vorflug };
  });
}

test("[night-52] Implementierungs- und Salvage-Session starten ohne das Auto-Memory des Menschen", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const envLog = join(dir, "env.log");
    // Die regulaere Session laesst unkommittete Arbeit liegen und bewegt das Board nicht.
    // Damit greift bei gruenen buildChecks der Salvage-Pfad, und beide Session-Arten
    // protokollieren ihre Umgebung im selben Lauf.
    const fake = [
      envProbe(envLog),
      'if [ -n "$NIGHT_SALVAGE" ]; then',
      '  git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"',
      '  node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null',
      "else",
      '  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"',
      "fi",
    ].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--model", "claude-sonnet-5"],
      { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = envZeilen(envLog);
    assert.equal(zeilen.length, 2,
      `erwartet: regulaere Runde + Salvage-Runde, tatsaechlich ${zeilen.length} Session(s)`);
    const [implementierung, salvage] = zeilen;
    assert.equal(implementierung.salvage, "KEINE", "die erste Zeile ist die regulaere Session");
    assert.equal(salvage.salvage, "1", "die zweite Zeile ist die Salvage-Session");

    for (const [name, zeile] of [["Implementierung", implementierung], ["Salvage", salvage]]) {
      assert.equal(zeile.autoMemory, "1",
        `die ${name}-Session haette CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 sehen muessen`);
      // Die uebrigen Variablen stehen unveraendert daneben.
      assert.equal(zeile.modell, "claude-sonnet-5", `KIT_AGENT_MODEL fehlt der ${name}-Session`);
      assert.equal(zeile.issueId, String(erstes.id), `NIGHT_ISSUE_ID fehlt der ${name}-Session`);
      assert.equal(zeile.prompt, "gesetzt", `NIGHT_PROMPT fehlt der ${name}-Session`);
      assert.equal(zeile.vorflug, "KEINE", `NIGHT_VORFLUG gehoert nicht in die ${name}-Session`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-52] auch die Vorflug-Session startet ohne das Auto-Memory des Menschen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fachplan(dir);
    const env = umgebung(dir, { stufen: {} });
    // helfer/ ist im Fixture ignoriert — der Vorflug darf den Working Tree nicht veraendern.
    const envLog = join(dir, "helfer", "vorflug-env.log");
    const res = ketteRun(dir, ["--kette", "--dry-run"], {
      ...env, NIGHT_VORFLUG_CMD: `${envProbe(envLog)}\n${VORFLUG_OK}`,
    });
    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = envZeilen(envLog);
    assert.equal(zeilen.length, 1, `erwartet: genau eine Vorflug-Session, tatsaechlich ${zeilen.length}`);
    const [vorflug] = zeilen;
    assert.equal(vorflug.autoMemory, "1",
      "die Vorflug-Session haette CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 sehen muessen");
    assert.equal(vorflug.vorflug, "1", "NIGHT_VORFLUG fehlt der Vorflug-Session");
    assert.equal(vorflug.prompt, "gesetzt", "NIGHT_PROMPT fehlt der Vorflug-Session");
    assert.equal(vorflug.issueId, "vorflug", "NIGHT_ISSUE_ID fehlt der Vorflug-Session");
    // Das Modell nicht abgeschrieben, sondern aus der Startzeile des Runners gelesen.
    const modell = res.stdout.match(/Vorflug-Session startet \(Modell (\S+),/)?.[1];
    assert.ok(modell, "die Startzeile der Vorflug-Session fehlt im Protokoll");
    assert.equal(vorflug.modell, modell, "KIT_AGENT_MODEL fehlt der Vorflug-Session");
  });
});
