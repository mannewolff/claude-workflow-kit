#!/usr/bin/env node
/**
 * claude-workflow-kit Nacht-Runner (Issue #131)
 *
 * Arbeitet die Ready-Spalte unbeaufsichtigt ab: pro Issue eine FRISCHE
 * Headless-Session (`claude -p "/implement-next"`), sequenziell, bis Ready
 * leer oder --max erreicht ist. Das Board ist einziges Koordinations- und
 * Erfolgssignal (Issue in In review = Erfolg). Der Runner pusht nie.
 *
 * Aufruf im Projekt-Root:  node .claude/kit/night.mjs [Flags]
 *
 * Flags:
 *   --max <N>          maximale Session-Starts pro Lauf (Default 10)
 *   --model <id>       Modell der Nacht-Sessions (Default claude-opus-4-8)
 *   --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
 *   --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
 *   --yolo             --dangerously-skip-permissions statt acceptEdits (Warnung!)
 *   --no-checks-ok     Start trotz leerer buildChecks erlauben
 *
 * Verhalten bei Fehlschlag einer Runde (Issue nicht in In review):
 *   - Working Tree dirty  -> harter Stopp (auf halben Aenderungen wird nicht weitergebaut)
 *   - Working Tree sauber -> Issue mit Kommentar zurueck ins Backlog, weiter
 * Abhaengigkeiten: `## Abhaengigkeiten` muss erfuellt sein (referenzierte #N in
 * In review oder Done), sonst wandert das Issue kommentiert ins Backlog (Kaskade).
 *
 * Test-Hook: NIGHT_CLAUDE_CMD ersetzt den claude-Aufruf durch ein Shell-Kommando
 * (erhaelt NIGHT_ISSUE_ID als Umgebungsvariable) — nur fuer Tests gedacht.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOARD_PATH = join(__dirname, "board.mjs");
const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_ITERATIONS = 500; // Notbremse gegen Endlosschleifen, weit ueber jedem realen Lauf

// --- Argumente ---

function parseArgs(argv) {
  const args = { max: 10, model: DEFAULT_MODEL, timeoutMin: 60, dryRun: false, yolo: false, noChecksOk: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max") args.max = Number(argv[++i]);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--timeout-min") args.timeoutMin = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yolo") args.yolo = true;
    else if (a === "--no-checks-ok") args.noChecksOk = true;
    else fail(`Unbekanntes Argument: ${a}`);
  }
  if (!Number.isFinite(args.max) || args.max < 1) fail("--max braucht eine Zahl >= 1");
  if (!Number.isFinite(args.timeoutMin) || args.timeoutMin < 1) fail("--timeout-min braucht eine Zahl >= 1");
  return args;
}

// --- Logging ---

let LOG_FILE = null;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stdout.write(line + "\n");
  if (LOG_FILE) appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

function fail(msg) {
  const line = `Fehler: ${msg}`;
  process.stderr.write(line + "\n");
  if (LOG_FILE) appendFileSync(LOG_FILE, line + "\n", "utf-8");
  process.exit(1);
}

// --- Board-Adapter als Kind-Prozess (keine Logik-Duplikation) ---

function board(...cliArgs) {
  const res = spawnSync(process.execPath, [BOARD_PATH, ...cliArgs], { encoding: "utf-8" });
  if (res.status !== 0) {
    fail(`board.mjs ${cliArgs.join(" ")} schlug fehl: ${(res.stderr || res.stdout || "").trim()}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    fail(`board.mjs ${cliArgs.join(" ")} lieferte kein JSON: ${res.stdout.slice(0, 200)}`);
  }
}

// --- Git-Helfer ---

function gitClean() {
  // Beim lokalen Tracker sind Board-Moves Dateiaenderungen unter issuesDir —
  // Board-Zustand ist kein Code-Zustand und zaehlt nicht als dirty.
  const pathspec = ["--", "."];
  if (config.issueTracker === "local") {
    pathspec.push(`:(exclude)${config.local?.issuesDir || "issues"}`);
  }
  const res = spawnSync("git", ["status", "--porcelain", ...pathspec], { encoding: "utf-8" });
  if (res.status !== 0) fail("git status schlug fehl — bin ich im Projekt-Root eines git-Repos?");
  return res.stdout.trim() === "";
}

function lastCommitHash() {
  const res = spawnSync("git", ["log", "-1", "--format=%h"], { encoding: "utf-8" });
  return res.status === 0 ? res.stdout.trim() : "?";
}

// --- Abhaengigkeiten ---

// Liest #N-Referenzen aus dem Abschnitt "## Abhaengigkeiten" (auch "Abhängigkeiten").
// Bewusst nur nackte #N-Tokens: Referenzen wie `owner/repo`#245 (Backtick/Slash davor)
// sind fremde Repos und werden nicht als lokale Issues gewertet.
function parseDeps(body) {
  const m = (body || "").match(/##\s*Abh(?:ä|ae)ngigkeiten([\s\S]*?)(?=\n##\s|$)/i);
  if (!m) return [];
  const refs = [...m[1].matchAll(/(?<![\w`/#])#(\d+)/g)].map((x) => Number(x[1]));
  return [...new Set(refs)];
}

function satisfiedIds() {
  const inReview = board("issue", "list", "--status", "in_review");
  const done = board("issue", "list", "--status", "done");
  return new Set([...inReview, ...done].map((i) => Number(i.id)));
}

// --- Nacht-Session ---

function runSession(issueId, args) {
  const timeoutMs = args.timeoutMin * 60 * 1000;
  const testCmd = process.env.NIGHT_CLAUDE_CMD;
  let res;
  if (testCmd) {
    res = spawnSync("sh", ["-c", testCmd], {
      encoding: "utf-8",
      timeout: timeoutMs,
      env: { ...process.env, NIGHT_ISSUE_ID: String(issueId) },
    });
  } else {
    const permArgs = args.yolo
      ? ["--dangerously-skip-permissions"]
      : ["--permission-mode", "acceptEdits"];
    res = spawnSync("claude", ["-p", "/implement-next", "--model", args.model, ...permArgs], {
      encoding: "utf-8",
      timeout: timeoutMs,
    });
    if (res.error && res.error.code === "ENOENT") {
      fail("claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?");
    }
  }
  if (LOG_FILE) {
    appendFileSync(LOG_FILE, `--- Session-Output Issue #${issueId} ---\n${res.stdout || ""}${res.stderr || ""}\n`, "utf-8");
  }
  return res;
}

// --- Hauptprogramm ---

const args = parseArgs(process.argv.slice(2));

if (!existsSync(BOARD_PATH)) fail(`board.mjs nicht gefunden unter ${BOARD_PATH}`);
const configPath = join(process.cwd(), ".claude", "workflow.config.json");
if (!existsSync(configPath)) fail("Keine .claude/workflow.config.json — bitte im Projekt-Root starten.");
const config = JSON.parse(readFileSync(configPath, "utf-8"));

mkdirSync(join(process.cwd(), ".claude"), { recursive: true });
LOG_FILE = join(process.cwd(), ".claude", `night-run-${new Date().toISOString().slice(0, 10)}.log`);

log(`Nacht-Runner startet (max ${args.max} Sessions, Modell ${args.model}${args.dryRun ? ", DRY-RUN" : ""}${args.yolo ? ", YOLO" : ""})`);
if (args.yolo && !args.dryRun) {
  log("WARNUNG: --yolo umgeht ALLE Permission-Checks der Nacht-Sessions. Die Stop-Punkte haengen dann allein am Skill-Prompt.");
}

// Vorflug-Checks
const inProgress = board("issue", "list", "--status", "in_progress");
if (inProgress.length > 0) {
  fail(`Issue(s) in In progress (${inProgress.map((i) => "#" + i.id).join(", ")}) — Crash-Rest? Bitte manuell aufraeumen, dann neu starten.`);
}
if (!gitClean()) fail("Working Tree ist nicht sauber. Bitte committen oder aufraeumen, dann neu starten.");
if ((!config.buildChecks || config.buildChecks.length === 0) && !args.noChecksOk) {
  fail("buildChecks in workflow.config.json ist leer — nachts ohne Gate zu implementieren ist riskant. Override: --no-checks-ok");
}

// Dry-Run: Reihenfolge + Abhaengigkeits-Bewertung anzeigen, nichts bewegen, nichts starten.
if (args.dryRun) {
  const ready = board("issue", "list", "--status", "ready");
  if (ready.length === 0) {
    log("Ready ist leer — nichts zu tun.");
    process.exit(0);
  }
  const satisfied = satisfiedIds();
  const assumedDone = new Set(satisfied); // Annahme: frühere Runden gelingen
  let planned = 0;
  for (const issue of ready) {
    const full = board("issue", "get", String(issue.id));
    const unmet = parseDeps(full.body).filter((d) => !assumedDone.has(d));
    if (unmet.length > 0) {
      log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt)`);
    } else if (planned >= args.max) {
      log(`  #${issue.id} ${issue.title} -> ueber --max ${args.max}, bliebe liegen`);
    } else {
      planned++;
      assumedDone.add(Number(issue.id));
      log(`  #${issue.id} ${issue.title} -> Session ${planned}`);
    }
  }
  log(`Dry-Run beendet: ${planned} Session(s) wuerden starten.`);
  process.exit(0);
}

// Echter Lauf
let sessions = 0;
let succeeded = 0;
let deferred = 0;
let iterations = 0;
let hardStop = false;

while (sessions < args.max && iterations < MAX_ITERATIONS) {
  iterations++;
  const ready = board("issue", "list", "--status", "ready");
  if (ready.length === 0) break;

  const top = ready[0];
  const full = board("issue", "get", String(top.id));
  const unmet = parseDeps(full.body).filter((d) => !satisfiedIds().has(d));
  if (unmet.length > 0) {
    log(`#${top.id} zurueckgestellt: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt.`);
    board("issue", "comment", String(top.id), "--text",
      `Nachtlauf: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt (nicht in In review/Done) — Issue zurueckgestellt.`);
    board("issue", "move", String(top.id), "backlog");
    deferred++;
    continue;
  }

  sessions++;
  log(`Session ${sessions}/${args.max}: Issue #${top.id} — ${top.title}`);
  const started = Date.now();
  runSession(top.id, args);
  const minutes = ((Date.now() - started) / 60000).toFixed(1);

  const nowInReview = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
  if (nowInReview) {
    succeeded++;
    log(`  Erfolg nach ${minutes} min, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
    continue;
  }

  if (!gitClean()) {
    log(`  FEHLSCHLAG nach ${minutes} min: Issue #${top.id} nicht in In review UND Working Tree dirty — harter Stopp.`);
    board("issue", "comment", String(top.id), "--text",
      "Nachtlauf: Runde fehlgeschlagen und Working Tree nicht sauber hinterlassen — Lauf hart gestoppt. Bitte morgens manuell sichten.");
    hardStop = true;
    break;
  }

  log(`  Fehlschlag nach ${minutes} min: Issue #${top.id} nicht in In review, Tree sauber — Issue ins Backlog, weiter.`);
  board("issue", "comment", String(top.id), "--text",
    "Nachtlauf: Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter.");
  board("issue", "move", String(top.id), "backlog");
  deferred++;
}

log(`Nacht-Runner beendet: ${succeeded} erfolgreich, ${deferred} zurueckgestellt, ${sessions} Session(s) gestartet${hardStop ? ", HARTER STOPP" : ""}.`);
log(`Morgen-Ritual: /review -> Test -> push main. Protokoll: ${LOG_FILE}`);
process.exit(hardStop ? 1 : 0);
