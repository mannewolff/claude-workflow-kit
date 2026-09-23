// Die Salvage-Session fordert den Strom auch bei `--verbose no` an (Issue #871).
//
// `docs/dokumentation.md` sagt zu, dass weder die Verlaufsdatei noch die Kennzahlen an
// einem Flag haengen. Der Salvage-Aufruf von `runSession` uebergab aber kein
// `stream: true`; `sessionStart` haengt `--output-format stream-json` nur bei
// `args.verbose || opts.stream` an, und `runProcess` wertet den Strom unter derselben
// Bedingung aus. Mit `--verbose no` lief die Rettung darum ohne Strom, und ihre
// Kennzahlen fehlten im Verbrauch der Einheit.
//
// Gemessen wird hier an dem, was allein am angeforderten Strom haengt: das
// Beobachter-Ergebnis (`werkzeugzeit`) der Salvage-Session. Es entsteht in `runProcess`
// genau unter `useStream` — derselben Bedingung, unter der `sessionStart` das Flag
// setzt. Faellt `stream: true` am Salvage-Aufruf weg, bleibt es `null`, und die Summe
// der Einheit wird nach `zeitenAddieren` null. Der Verbrauch wird daneben gleich
// mitgeprueft: Er ist der im Issue genannte Schaden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

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
  const dir = mkdtempSync(join(tmpdir(), "night-salvage-stream-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\n");
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

function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

function protokoll(dir) {
  const datei = readdirSync(join(dir, ".claude")).find((n) => n.startsWith("night-run-") && n.endsWith(".log"));
  assert.ok(datei, "kein Tagesprotokoll geschrieben");
  return readFileSync(join(dir, ".claude", datei), "utf-8");
}

/** Ein Schub aus `tool_use` und `tool_result`, mit messbarer Spanne dazwischen. */
const SCHUB = [
  `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"true"}}]}}'`,
  "sleep 0.05",
  `echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}'`,
].join("\n");

const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}'`
  + " > .claude/checks-summary.json";
const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';

test("[night-57] mit --verbose no laeuft auch die Salvage-Session ueber den Strom: ihre Kennzahlen stehen im Verbrauch der Einheit", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Salvage-Kandidat", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // Die regulaere Runde laesst Arbeit liegen und bewegt das Board nicht — der einzige
    // Weg in den Salvage-Versuch. Die Rettung committet und zieht nach In review.
    const regulaer = [
      SCHUB,
      `echo '{"type":"result","duration_api_ms":1000,"num_turns":1,"total_cost_usd":0.1,"usage":{"input_tokens":10,"output_tokens":20}}'`,
      'echo dirty > "dirty-$NIGHT_ISSUE_ID.txt"',
    ].join("\n");
    const salvage = [
      SCHUB, SCHUB,
      `echo '{"type":"result","duration_api_ms":9000,"num_turns":2,"total_cost_usd":0.2,"usage":{"input_tokens":30,"output_tokens":40}}'`,
      SUMMARY_GRUEN,
      'git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"',
      NACH_IN_REVIEW,
    ].join("\n");
    const fake = `if [ -n "$NIGHT_SALVAGE" ]; then\n${salvage}\nelse\n${regulaer}\nfi`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose", "no"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/, "der Salvage-Versuch lief nicht");

    const s = stand(dir);
    assert.equal(s.einheiten.length, 1, `nur die eine Einheit des Pakets erwartet: ${JSON.stringify(s.einheiten)}`);
    const e = s.einheiten[0];

    // Der Verbrauch der Einheit traegt BEIDE Sessions — die Rettung fehlte vorher ganz.
    assert.ok(Math.abs(e.verbrauch.kostenUsd - 0.3) < 1e-9,
      `0.1 der Runde plus 0.2 der Rettung erwartet: ${e.verbrauch.kostenUsd}`);
    assert.equal(e.verbrauch.eingabeTokens, 40, "10 der Runde plus 30 der Rettung");
    assert.equal(e.verbrauch.ausgabeTokens, 60, "20 der Runde plus 40 der Rettung");

    // Und die Zeiten: Nur ein angeforderter Strom liefert das Beobachter-Ergebnis der
    // Salvage-Session. Ohne es waere die Summe nach zeitenAddieren null.
    const z = e.zeiten;
    assert.equal(z.nachdenkenMs, 10000, "1000 der Runde plus 9000 der Rettung");
    assert.equal(z.werkzeugSchuebe, 3, "ein Schub der Runde plus zwei der Rettung — die Rettung wurde mitgemessen");
    assert.equal(z.offeneSchuebe, 0);
    assert.ok(typeof z.werkzeugMs === "number" && z.werkzeugMs > 0,
      `werkzeugMs haette gemessen sein muessen: ${z.werkzeugMs}`);

    // Gemessen, nicht ausgegeben: mit --verbose no bleibt das Protokoll frei von
    // Ereigniszeilen — auch von denen der Salvage-Session.
    const ereignis = new RegExp(`#${issue.id} > `);
    assert.doesNotMatch(res.stdout, ereignis, "mit --verbose no duerfen keine Ereigniszeilen auf der Konsole stehen");
    assert.doesNotMatch(protokoll(dir), ereignis, "mit --verbose no duerfen keine Ereigniszeilen im Tagesprotokoll stehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
