// E2E fuer die Laufkennung des Nacht-Runners (Issue #1194).
// night.mjs setzt jeder Session KIT_NIGHT_RUN auf den `start` des laufenden
// Ergebnisstands. Die Bash-Kindprozesse der Session erben sie, und board.mjs sendet sie
// als Header X-Night-Run — so ordnet das Board jede Karte auch bei parallelen Laeufen
// mit demselben Token ihrem Lauf zu. Geprueft wird hier die erste Prozessgrenze: Steht
// derselbe Wert in der Session-Umgebung, den die Laufmeldung als `startedAt` sendet,
// und zwar in der regulaeren wie in der Salvage-Session.
// Laeuft lokal: issueTracker "local", Session-Fake via NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Ein eigener Sperrpfad je Testprozess (Issue #958): Die Salvage-Vorpruefung faehrt das
// echte kit/checks.mjs.
import "./helpers/checks-sperre.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";
import { nachtlaufMeldung } from "../kit/board.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  const basis = { ...process.env };
  // Eine geerbte Kennung wuerde den Wert verfaelschen, den der Lauf selbst setzt.
  delete basis.KIT_NIGHT_RUN;
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...basis, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-laufkennung-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nlaufkennung.log\n");
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

test("Implementierungs- und Salvage-Session tragen KIT_NIGHT_RUN mit dem startedAt der Laufmeldung", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Erstes", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", a.id, "ready");

    const log = join(dir, "laufkennung.log");
    // Die regulaere Session laesst unkommittete Arbeit liegen; bei gruenen buildChecks
    // greift damit der Salvage-Pfad, und beide Session-Arten protokollieren ihre Kennung.
    const fake = [
      `printf '%s\\t%s\\n' "\${NIGHT_SALVAGE:-KEINE}" "\${KIT_NIGHT_RUN:-KEINE}" >> ${JSON.stringify(log)}`,
      'if [ -n "$NIGHT_SALVAGE" ]; then',
      '  git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"',
      '  node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null',
      "else",
      '  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"',
      "fi",
    ].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const standDatei = readdirSync(join(dir, ".claude")).find((n) => /^night-run-.*\.json$/.test(n));
    assert.ok(standDatei, "der Lauf haette einen Ergebnisstand anlegen muessen");
    const stand = JSON.parse(readFileSync(join(dir, ".claude", standDatei), "utf-8"));
    const startedAt = nachtlaufMeldung(stand).startedAt;
    assert.match(startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "startedAt ist ein ISO-Zeitstempel");

    const zeilen = readFileSync(log, "utf-8").trim().split("\n").map((z) => z.split("\t"));
    assert.deepEqual(zeilen, [["KEINE", startedAt], ["1", startedAt]],
      "beide Sessions haetten den startedAt des Laufs in KIT_NIGHT_RUN sehen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
