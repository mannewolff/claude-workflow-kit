// Salvage-Prompt und Rest-Guard urteilen nach derselben Regel (Issue #818).
//
// Der Prompt der Salvage-Session verlangte bis #818 ein vollstaendig leeres
// `git status --porcelain`, bevor sie das Board bewegt. Der Runner misst
// Sauberkeit dagegen mit `gitReste()`, und das nimmt eine Reihe von Pfaden
// ausdruecklich aus — `night-run-*`, den Umsetzungs-Lock, `wegmarken.tsv` und
// die uebrigen Laufzeit-Dateien unter `.claude/`. In einem Projekt ohne den
// `.claude/*`-Block in `.gitignore` liegen die waehrend des Salvage im Baum:
// Die Session committete, liess das Board unberuehrt, weil `git status` nicht
// leer war, und der Runner meldete danach "SALVAGE UNVOLLSTAENDIG" mit hartem
// Stopp. Die Rettung scheiterte an einem Widerspruch zwischen zwei Regeln
// desselben Werkzeugs.
//
// Beide Seiten leiten ihre Pruefung jetzt aus `gitResteAusnahmen()` ab. Der
// E2E hier faehrt genau das Projekt ohne Ignore-Block, seine Fake-Session
// folgt dem Prompt woertlich — sie holt sich das Kommando aus NIGHT_PROMPT —
// und der Lauf muss mit Erfolg enden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { gitResteAusnahmen, salvageSauberkeitsKommando, salvagePrompt } from "../kit/night.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

test("[night-66] jede Ausnahme von gitReste() steht als Ausschluss im Kommando des Salvage-Prompts", () => {
  const ausnahmen = gitResteAusnahmen();
  assert.ok(ausnahmen.length > 1, "die Ausnahmeliste ist leer — dann prueft dieser Test nichts");

  const prompt = salvagePrompt("42", "alles gruen", null);
  for (const pfad of ausnahmen) {
    assert.ok(prompt.includes(`:(exclude)${pfad}`),
      `die Ausnahme '${pfad}' fehlt als Ausschluss im Salvage-Prompt:\n${prompt}`);
  }

  // Die einzige trackerabhaengige Ausnahme geht denselben Weg: Beim lokalen Tracker
  // sind Board-Moves Dateiaenderungen unter issuesDir, und der Runner wertet sie
  // nicht als Rest. Also darf die Session sie auch nicht als Rest sehen.
  const lokal = gitResteAusnahmen({ issueTracker: "local", local: { issuesDir: "meine-issues" } });
  assert.ok(lokal.includes("meine-issues"), `issuesDir fehlt in der Liste: ${lokal.join(", ")}`);
  assert.ok(salvageSauberkeitsKommando(lokal).includes(":(exclude)meine-issues"),
    "die issuesDir-Ausnahme fehlt im Kommando");
});

test("[night-66] eine neue Ausnahme kommt ohne Aenderung am Prompt-Text mit", () => {
  // Die Liste ist der einzige Ort: Was hier hineingereicht wird, steht im Kommando.
  // Waere der Ausschluss im Prompt-Text ausgeschrieben, ginge dieser Fall rot aus.
  const kommando = salvageSauberkeitsKommando([".claude/frisch-erfunden-*", "eigener/pfad"]);
  assert.match(kommando, /^git status --porcelain -- \. /,
    `das Kommando faengt nicht mit dem erwarteten Kopf an: ${kommando}`);
  assert.ok(kommando.includes(":(exclude).claude/frisch-erfunden-*"),
    `die neue Ausnahme fehlt im Kommando: ${kommando}`);
  assert.ok(kommando.includes(":(exclude)eigener/pfad"),
    `die zweite Ausnahme fehlt im Kommando: ${kommando}`);
});

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// Fixture OHNE `.claude/*`-Zeile in `.gitignore` — genau der Fall aus #818. Der
// Installer laesst eine vorhandene eigene `.claude`-Regel unangetastet, es gibt
// solche Projekte also wirklich; dieses Repo selbst fuehrt den Block und ist
// darum nicht betroffen.
function setupProjektOhneIgnoreBlock() {
  const dir = mkdtempSync(join(tmpdir(), "night-salvage-ohne-ignore-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  // Nur das Protokoll des Fakes selbst; die Laufzeit-Dateien des Runners bleiben
  // bewusst ungeignored.
  writeFileSync(join(dir, ".gitignore"), "sessions.log\n");
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

// Die Fake-Session folgt dem Prompt woertlich: Sie committet ihre eigene Arbeit
// (nicht `git add -A`, sonst nimmt sie die Laufzeit-Dateien des Runners mit und
// der Fall verschwindet), holt sich das Sauberkeits-Kommando aus dem Prompt und
// bewegt das Board nur, wenn dessen Ausgabe leer ist.
function fakeSession(sessionLog) {
  return `if [ -n "$NIGHT_SALVAGE" ]; then\n`
    + `  echo "salvage $NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}\n`
    + `  git add "work-$NIGHT_ISSUE_ID.txt" || exit 1\n`
    + `  git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)" || exit 1\n`
    // Genommen wird nur eine Zeile, die fuer sich ein Kommando ist. Nennt der Prompt
    // keines, faellt die Session auf das nackte `git status --porcelain` zurueck —
    // genau das tat sie vor #818, und genau daran scheiterte die Rettung.
    + `  kommando=$(printf '%s\\n' "$NIGHT_PROMPT" | sed -n 's/^ *\\(git status --porcelain.*\\)$/\\1/p' | head -1)\n`
    + `  [ -n "$kommando" ] || kommando="git status --porcelain"\n`
    + `  echo "kommando:$kommando" >> ${JSON.stringify(sessionLog)}\n`
    + `  rest=$(eval "$kommando")\n`
    + `  if [ -z "$rest" ]; then\n`
    + `    node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null\n`
    + `  else\n`
    + `    echo "rest:$rest" >> ${JSON.stringify(sessionLog)}\n`
    + `  fi\n`
    + `else\n`
    + `  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"\n`
    + `fi\n`;
}

test("[night-66] Salvage gelingt auch in einem Projekt ohne .claude/*-Block in .gitignore", NUR_POSIX, () => {
  const dir = setupProjektOhneIgnoreBlock();
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fakeSession(sessionLog) });

    const log = readFileSync(sessionLog, "utf-8");
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      `die Salvage-Startzeile fehlt: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /SALVAGE UNVOLLSTAENDIG/,
      `die Session folgte dem Prompt — sie haette das Board bewegen muessen.\nProtokoll der Session:\n${log}\n${res.stdout}`);
    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);

    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(erstes.id)),
      `das Issue haette in In review landen muessen.\nProtokoll der Session:\n${log}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
