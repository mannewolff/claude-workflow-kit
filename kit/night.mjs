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
 *   --model <id>       Modell der Nacht-Sessions (Default claude-opus-5)
 *   --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
 *   --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
 *   --yolo             --dangerously-skip-permissions statt acceptEdits (Warnung!)
 *   --no-checks-ok     Start trotz leerer buildChecks erlauben
 *   --label <name>     verarbeitet nur Ready-Issues mit diesem Label (Default
 *                      kit:nightrun); --label none schaltet den Filter ab (altes
 *                      Verhalten: striktes ready[0])
 *   --verbose          Live-Verlaufsprotokoll: liest den stream-json-Output der
 *                      Session und loggt Tool-Aufrufe und Text-Snippets mit
 *   --version          Kit-Stand dieser Datei (greift vor allen Checks)
 *   --help, -h         Usage-Uebersicht (greift vor allen Checks, keine Config noetig)
 *
 * Verhalten bei Fehlschlag einer Runde (Issue nicht in In review):
 *   - Session-Exit != 0 (kein Timeout) -> Infrastruktur-Fehler (Auth, CLI kaputt):
 *     harter Stopp, Issue bleibt unangetastet (kein Kommentar, kein Backlog-Move)
 *   - Working Tree dirty  -> Salvage-Versuch (siehe unten), sonst harter Stopp
 *   - Working Tree sauber -> Issue mit Kommentar zurueck ins Backlog, weiter
 *
 * Salvage (Issue #167): Eine Session, die einen langen Check im Hintergrund
 * startet und ihren Turn beendet, bevor das Ergebnis da ist, verliert es — eine
 * headless -p-Session hat keinen Folge-Turn. Das Board zeigt dann einen
 * Fehlschlag, obwohl die Arbeit fertig ist. Vor dem harten Stopp verifiziert der
 * Runner deshalb die buildChecks selbst (nicht mutationCommand — das ist ein
 * nachgelagerter Check, kein Blocker fuer diese Entscheidung). Sind sie gruen,
 * bekommt genau eine Salvage-Session pro Issue die Chance, den Zwischenstand
 * gegen das Issue zu pruefen, zu committen und das Board zu bewegen. Rote Checks
 * oder eine gescheiterte Salvage-Session -> harter Stopp. Immer an; ein Opt-out-
 * Flag waere in der Praxis wirkungslos, weil man es nachts vergisst.
 * Die Vorpruefung mergt den env-Block aus .claude/settings.json und
 * .claude/settings.local.json (local gewinnt, wie in Claude Code) in die eigene
 * Kindprozess-Umgebung (settingsEnv/runBuildChecksSync) — sonst fehlen
 * projektspezifische Variablen, die sonst nur Claude Codes eigene Bash-Aufrufe
 * bekommen, und die Vorpruefung liefert ein falsches Rot (kanban-kit #445, #168).
 * Sind die Checks rot und ist config.formatFixCommand gesetzt, laeuft das Kommando
 * genau einmal und die Checks werden genau einmal wiederholt (Issue #169): ein
 * reiner Formatverstoss ist mechanisch behebbar und darf keinen Lauf beenden, in
 * dem noch zwanzig Issues warten. Bleiben sie rot, war das Format nicht die Ursache.
 * Timeout (--timeout-min) zaehlt als issue-spezifisch, nicht als Infrastruktur.
 * Verhalten bei Erfolg einer Runde (Issue in In review):
 *   - Working Tree sauber -> weiter mit der naechsten Runde
 *   - Working Tree dirty   -> harter Stopp (unkommittete Reste wuerden die naechste
 *     Runde vergiften, siehe Issue #152)
 * Abhaengigkeiten: `## Abhaengigkeiten` muss erfuellt sein (referenzierte #N in
 * In review oder Done), sonst wandert das Issue kommentiert ins Backlog (Kaskade).
 *
 * Test-Hooks (nur fuer Tests gedacht):
 *   NIGHT_CLAUDE_CMD  ersetzt den claude-Aufruf durch ein Shell-Kommando
 *                     (erhaelt NIGHT_ISSUE_ID als Umgebungsvariable).
 *   NIGHT_TIMEOUT_MS  ueberschreibt das Rundenzeitlimit in Millisekunden
 *                     (statt --timeout-min), damit der Timeout-Pfad schnell
 *                     testbar ist. Gilt auch fuer die Salvage-Session.
 *   NIGHT_SALVAGE     wird der Salvage-Session als Umgebungsvariable gesetzt
 *                     (Wert "1"), damit ein Fake-Hook die beiden Session-Arten
 *                     unterscheiden kann.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOARD_PATH = join(__dirname, "board.mjs");
// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "1.24.0";
const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_LABEL = "kit:nightrun";
const MAX_ITERATIONS = 500; // Notbremse gegen Endlosschleifen, weit ueber jedem realen Lauf

// --- Argumente ---

function printHelp() {
  process.stdout.write(`Nacht-Runner: arbeitet die Ready-Spalte unbeaufsichtigt ab —
pro Issue eine frische Headless-Session (/implement-next), sequenziell.
Erfolg wird am Board gemessen (Issue in In review). Gepusht wird nie.

Aufruf (im Projekt-Root):
  node .claude/kit/night.mjs [Flags]

Flags:
  --max <N>          maximale Session-Starts pro Lauf (Default 10)
  --model <id>       Modell der Nacht-Sessions (Default ${DEFAULT_MODEL})
  --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
  --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
  --yolo             --dangerously-skip-permissions statt acceptEdits (Warnung!)
  --no-checks-ok     Start trotz leerer buildChecks erlauben
  --label <name>     nur Ready-Issues mit diesem Label verarbeiten
                     (Default ${DEFAULT_LABEL}); --label none schaltet den
                     Filter ab (altes Verhalten: striktes erstes Ready-Issue)
  --verbose          Live-Verlaufsprotokoll: Tool-Aufrufe und Text-Snippets
                     der laufenden Session mitloggen (via stream-json)
  --version          Kit-Stand dieser Datei
  --help, -h         diese Uebersicht

Salvage (immer an): Endet eine Runde ohne Board-Ergebnis, aber mit Aenderungen im
Working Tree, fuehrt der Runner die buildChecks selbst aus. Sind sie gruen, bekommt
genau eine Salvage-Session pro Issue die Chance, den Zwischenstand gegen das Issue
zu pruefen, zu committen und nach In review zu verschieben (Zeitlimit 10 min). Rote
Checks oder ein gescheiterter Salvage-Versuch fuehren zum harten Stopp.

Ist in der Config "formatFixCommand" gesetzt (z.B. "mvn spotless:apply" oder
"npx prettier --write ."), laeuft es bei roten Checks genau einmal, danach werden
die Checks genau einmal wiederholt: ein reiner Formatverstoss kippt so keinen Lauf
mehr. Bleiben die Checks rot, war das Format nicht die Ursache -> harter Stopp.
Ohne das Feld aendert sich nichts.

Beispiele:
  caffeinate -i node .claude/kit/night.mjs
  TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs

Details: Kapitel "Nachtbetrieb" in der Kit-Dokumentation.
`);
}

function parseArgs(argv) {
  const args = { max: 10, model: DEFAULT_MODEL, timeoutMin: 60, dryRun: false, yolo: false, noChecksOk: false, verbose: false, label: DEFAULT_LABEL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--version") {
      // Wie --help: greift vor allen Vorflug-Checks, damit die Auskunft auch in
      // einem Verzeichnis ohne Config und ohne board.mjs funktioniert.
      process.stdout.write(`night.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
      process.exit(0);
    } else if (a === "--max") args.max = Number(argv[++i]);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--label") args.label = argv[++i];
    else if (a === "--timeout-min") args.timeoutMin = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yolo") args.yolo = true;
    else if (a === "--no-checks-ok") args.noChecksOk = true;
    else if (a === "--verbose") args.verbose = true;
    else fail(`Unbekanntes Argument: ${a} — siehe --help`);
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

// --- Fachliche Issues (PO-Schleife, #146) ---

// [Fachlich]-Titelpraefix = Discovery-Issue: wird gegroomt, nie implementiert.
// Titel-basiert, weil issue list den Titel bei allen Trackern ohne Adapter-
// Erweiterung liefert (Stufe 1; Label-Achse ist als Folgepaket benannt).
function isFachlich(title) {
  return /^\s*\[fachlich\]/i.test(title || "");
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

// --- Verbose-Stream (Issue #154) ---

// Kuerzt Text auf eine kompakte, einzeilige Log-Zeile.
function flatten(str, max) {
  const flat = (str || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// Waehlt das aussagekraeftigste Argument eines Tool-Aufrufs (Kommando, Pfad),
// faellt auf ein kompaktes JSON zurueck.
function toolArg(block) {
  const input = block.input || {};
  for (const key of ["command", "file_path", "path", "pattern", "url"]) {
    if (typeof input[key] === "string") return input[key];
  }
  const json = JSON.stringify(input);
  return json && json !== "{}" ? json : "";
}

// Uebersetzt eine stream-json-Zeile (ein NDJSON-Objekt) in 0..n kompakte
// Ereigniszeilen: Tool-Aufrufe (Bash/Edit/…) und Text-Snippets der Session.
function interpretStreamEvent(obj) {
  const out = [];
  if (!obj || typeof obj !== "object") return out;
  if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        out.push(`Claude: ${flatten(block.text, 200)}`);
      } else if (block.type === "tool_use" && block.name) {
        const arg = toolArg(block);
        out.push(arg ? `${block.name}: ${flatten(arg, 160)}` : block.name);
      }
    }
  }
  return out;
}

function emitVerbose(issueId, line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return; // unparsebare Zeilen tolerant ueberspringen
  }
  for (const ev of interpretStreamEvent(obj)) {
    log(`  #${issueId} > ${ev}`);
  }
}

// --- Nacht-Session ---

// Startet einen Prozess asynchron, sammelt stdout/stderr und (bei useStream)
// parst stdout live zeilenweise. Eigener Timeout-Timer statt spawnSync-timeout,
// weil wir waehrend des Laufs streamen muessen. Das Rueckgabe-Objekt spiegelt
// die von spawnSync bekannten Felder (status, signal, error, stdout, stderr),
// damit der Infrastruktur-Guard (#149) und die Erfolgs-/Fehlschlag-Pfade
// unveraendert weiterarbeiten.
function runProcess(cmd, cmdArgs, { issueId, timeoutMs, useStream, extraEnv }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      env: { ...process.env, NIGHT_ISSUE_ID: String(issueId), ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    let buf = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (useStream) {
        buf += text;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          emitVerbose(issueId, buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => done({ status: null, signal: null, error: err, stdout, stderr }));
    child.on("close", (code, signal) => {
      if (useStream && buf.trim()) emitVerbose(issueId, buf);
      const error = timedOut
        ? Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
        : null;
      done({ status: code, signal, error, stdout, stderr });
    });
  });
}

// opts (Issue #167): { prompt, timeoutMs, extraEnv } — die Salvage-Session nutzt
// denselben Mechanismus wie eine regulaere Runde, nur mit anderem Prompt und
// eigenem Zeitlimit. Ohne opts bleibt alles wie vor #167.
async function runSession(issueId, args, opts = {}) {
  const timeoutMs = process.env.NIGHT_TIMEOUT_MS
    ? Number(process.env.NIGHT_TIMEOUT_MS)
    : (opts.timeoutMs ?? args.timeoutMin * 60 * 1000);
  const testCmd = process.env.NIGHT_CLAUDE_CMD;
  let cmd, cmdArgs;
  if (testCmd) {
    cmd = "sh";
    cmdArgs = ["-c", testCmd];
  } else {
    const permArgs = args.yolo
      ? ["--dangerously-skip-permissions"]
      : ["--permission-mode", "acceptEdits"];
    const streamArgs = args.verbose ? ["--output-format", "stream-json", "--verbose"] : [];
    cmd = "claude";
    cmdArgs = ["-p", opts.prompt || "/implement-next", "--model", args.model, ...permArgs, ...streamArgs];
  }
  const res = await runProcess(cmd, cmdArgs, {
    issueId, timeoutMs, useStream: args.verbose, extraEnv: opts.extraEnv,
  });
  if (!testCmd && res.error && res.error.code === "ENOENT") {
    fail("claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?");
  }
  if (LOG_FILE) {
    appendFileSync(LOG_FILE, `--- Session-Output Issue #${issueId} ---\n${res.stdout || ""}${res.stderr || ""}\n`, "utf-8");
  }
  return res;
}

// --- Salvage (Issue #167) ---

// Zeitlimit der Salvage-Session: sie fuehrt keinen Build mehr aus, sondern prueft
// nur den Diff gegen das Issue, committet und bewegt das Board. Bewusst unabhaengig
// von --timeout-min (das bemisst eine volle Implementierungsrunde).
const SALVAGE_TIMEOUT_MS = 10 * 60 * 1000;

// Liest den env-Block aus .claude/settings.json (falls vorhanden). Dort stehen
// projektspezifische Variablen (z.B. DOCKER_HOST/TESTCONTAINERS_DOCKER_SOCKET_
// OVERRIDE fuer Testcontainers unter Colima), die Claude Code seinen eigenen
// Bash-Tool-Aufrufen automatisch mitgibt. night.mjs ist aber ein eigener
// Node-Prozess ausserhalb von Claude Code und bekommt diese Variablen sonst
// nicht — ohne sie liefert runBuildChecksSync ein falsches Rot (beobachtet bei
// kanban-kit #445: mvn verify schlug ohne die beiden Variablen mit Mockito-
// MockMaker-Fehlern fehl, mit ihnen lief er sauber durch).
function settingsEnv() {
  // Precedence wie in Claude Code: settings.json zuerst, settings.local.json
  // gewinnt. Die local-Datei ist gitignored und damit der uebliche Ort fuer
  // maschinenspezifische Werte — genau die, die hier fehlen wuerden (Issue #168).
  const merged = {};
  for (const name of ["settings.json", "settings.local.json"]) {
    const path = join(process.cwd(), ".claude", name);
    if (!existsSync(path)) continue;
    try {
      const settings = JSON.parse(readFileSync(path, "utf-8"));
      if (settings.env && typeof settings.env === "object") Object.assign(merged, settings.env);
    } catch {
      // Kaputtes JSON blockiert die Vorpruefung nicht — nur diese eine Quelle faellt aus.
    }
  }
  return merged;
}

// Fuehrt die buildChecks der Config sequenziell aus und bricht beim ersten roten
// Check ab. mutationCommand bleibt bewusst aussen vor: ein nachgelagerter Check,
// kein Blocker fuer die Salvage-Entscheidung. Die Kindprozess-Umgebung bekommt
// zusaetzlich den env-Block aus .claude/settings.json gemergt (siehe settingsEnv).
// Umgebung fuer die eigenen Kindprozesse (Vorpruefung und Format-Fix): process.env
// plus der gemergte settings-env-Block.
function checkEnv() {
  return { ...process.env, ...settingsEnv() };
}

function runBuildChecksSync(cfg) {
  const env = checkEnv();
  let output = "";
  for (const cmd of cfg.buildChecks || []) {
    const res = spawnSync("sh", ["-c", cmd], { cwd: process.cwd(), encoding: "utf-8", env });
    output += `$ ${cmd}\n${res.stdout || ""}${res.stderr || ""}`;
    if (res.status !== 0) return { ok: false, output };
  }
  return { ok: true, output };
}

// Vorpruefung fuer den Salvage inklusive einmaligem Format-Fix (Issue #169).
//
// Ein reiner Formatverstoss ist mechanisch und deterministisch behebbar und sagt
// nichts ueber die fachliche Qualitaet der Arbeit — er darf keinen Lauf beenden,
// in dem noch zwanzig Issues warten (beobachtet bei kanban-kit#463: ein einzelner
// Javadoc-Zeilenumbruch). Ist formatFixCommand gesetzt und sind die Checks rot,
// laeuft das Kommando genau einmal und die Checks werden genau einmal wiederholt.
// Bleiben sie rot, war das Format nicht die Ursache -> harter Stopp wie bisher.
// Ohne formatFixCommand ist das Verhalten exakt wie vor #169.
function verifyChecksForSalvage(cfg) {
  const first = runBuildChecksSync(cfg);
  if (first.ok) return { ok: true, output: first.output, formatFixCmd: null };

  const fixCmd = (cfg.formatFixCommand || "").trim();
  if (!fixCmd) return { ok: false, output: first.output, formatFixCmd: null };

  log(`  buildChecks rot — einmaliger Format-Fix wird angewendet: ${fixCmd}`);
  spawnSync("sh", ["-c", fixCmd], { cwd: process.cwd(), encoding: "utf-8", env: checkEnv() });

  const second = runBuildChecksSync(cfg);
  if (!second.ok) return { ok: false, output: second.output, formatFixCmd: null };
  log(`  FORMAT-FIX angewendet, buildChecks jetzt gruen — der Lauf geht weiter.`);
  return { ok: true, output: second.output, formatFixCmd: fixCmd };
}

// Baut den Prompt der Salvage-Session. Kernpunkt: die Checks sind bereits extern
// gruen — die Session darf sie NICHT erneut starten, sonst laeuft sie in genau
// den Hintergrund-Check, der die Runde ueberhaupt erst gekostet hat.
function salvagePrompt(issueId, checksOutput, formatFixCmd) {
  const tail = (checksOutput || "").trim().split("\n").slice(-15).join("\n");
  return [
    `Die Pflicht-Checks (buildChecks) dieses Projekts wurden soeben EXTERN ausgefuehrt und sind GRUEN.`,
    `Fuehre sie NICHT erneut aus und starte keine langen Builds.`,
    ``,
    `Im Working Tree liegen unkommittete Aenderungen zu Issue #${issueId}. Deine einzige Aufgabe:`,
    `1. Lies das Issue: node .claude/kit/board.mjs issue get ${issueId}`,
    `2. Sieh dir den Stand an: git status und git diff`,
    `3. Passt der Stand zum Issue, committe ihn (Betreff mit "(Issue #${issueId})", im Body "Refs #${issueId}"`,
    `   — niemals Closes/Fixes/Resolves), verschiebe das Issue mit`,
    `   node .claude/kit/board.mjs issue move ${issueId} in_review`,
    `   und kommentiere den Abschlussbericht per`,
    `   node .claude/kit/board.mjs issue comment ${issueId} --text "..."`,
    `4. Passt der Stand nicht zum Issue oder wirkt unvollstaendig: NICHT committen,`,
    `   nichts am Board bewegen, und klar benennen was fehlt.`,
    // Ohne diesen Hinweis blieben die Formatierungsaenderungen unkommittiert liegen
    // und der Rest-Guard (#152) wertete die geglueckte Runde doch noch als Fehlschlag.
    ...(formatFixCmd ? [
      ``,
      `WICHTIG: Die Checks waren zunaechst rot; danach lief automatisch das Format-Kommando`,
      `"${formatFixCmd}" und erst dann wurden sie gruen. Die dadurch entstandenen`,
      `Formatierungsaenderungen gehoeren MIT in denselben Commit und in den Abschlussbericht.`,
    ] : []),
    ``,
    `Nicht pushen. Letzte Zeilen der externen Check-Ausgabe:`,
    tail,
  ].join("\n");
}

// --- Hauptprogramm ---

const args = parseArgs(process.argv.slice(2));

if (!existsSync(BOARD_PATH)) fail(`board.mjs nicht gefunden unter ${BOARD_PATH}`);
const configPath = join(process.cwd(), ".claude", "workflow.config.json");
if (!existsSync(configPath)) fail("Keine .claude/workflow.config.json — bitte im Projekt-Root starten.");
const config = JSON.parse(readFileSync(configPath, "utf-8"));

mkdirSync(join(process.cwd(), ".claude"), { recursive: true });
LOG_FILE = join(process.cwd(), ".claude", `night-run-${new Date().toISOString().slice(0, 10)}.log`);

// Routing-Label (Issue #159): nur Ready-Issues mit diesem Label werden verarbeitet,
// alle anderen bleiben unangetastet liegen. --label none schaltet den Filter ab
// (null = striktes ready[0], das Verhalten vor #159).
const labelFilter = args.label === "none" ? null : args.label;
const hasLabel = (issue) => labelFilter === null || (issue.labels || []).includes(labelFilter);

log(`Nacht-Runner startet (max ${args.max} Sessions, Modell ${args.model}, Label ${args.label}${args.dryRun ? ", DRY-RUN" : ""}${args.yolo ? ", YOLO" : ""})`);
if (args.yolo && !args.dryRun) {
  log("WARNUNG: --yolo umgeht ALLE Permission-Checks der Nacht-Sessions. Die Stop-Punkte haengen dann allein am Skill-Prompt.");
}

// Versions-Drift zwischen den beiden Kit-Dateien (Issue #172). Sie werden
// gemeinsam installiert, koennen aber auseinanderlaufen (einzeln kopiert,
// abgebrochenes Re-Install). Der Runner ruft dann Adapter-Funktionen auf, die eine
// aeltere board.mjs nicht kennt — das aeussert sich als schwer zuzuordnendes
// Fehlverhalten. Bewusst nur eine Warnung: ein Unterschied macht den Lauf nicht
// zwingend kaputt, und ein zusaetzlicher naechtlicher Abbruchgrund waere schlimmer
// als das Problem, das er meldet.
function boardKitVersion() {
  try {
    const m = readFileSync(BOARD_PATH, "utf-8").match(/const KIT_VERSION = "([^"]*)";/);
    return m ? m[1] : null;
  } catch {
    return null; // nicht lesbar -> wie fehlende Konstante behandeln
  }
}

function warnBeiVersionsDrift() {
  const andere = boardKitVersion();
  if (andere === KIT_VERSION) return;
  log(
    `WARNUNG: Versions-Drift in .claude/kit/ — night.mjs ist v${KIT_VERSION}, ` +
    `board.mjs ist ${andere ? `v${andere}` : "unbekannt (Kopie ohne Versionsstempel)"}. ` +
    `Die Installation ist halb aufgefrischt; bitte per install.mjs erneuern. Der Lauf geht weiter.`
  );
}

// Vorflug-Checks
warnBeiVersionsDrift();
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
    if (!hasLabel(issue)) {
      log(`  #${issue.id} ${issue.title} -> uebersprungen (kein Label '${labelFilter}')`);
      continue;
    }
    if (isFachlich(issue.title)) {
      log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (fachliches Issue, wird nicht implementiert)`);
      continue;
    }
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
// Genau ein Salvage-Versuch pro Issue und Lauf (#167).
const salvageAttempted = new Set();

while (sessions < args.max && iterations < MAX_ITERATIONS) {
  iterations++;
  const ready = board("issue", "list", "--status", "ready");
  if (ready.length === 0) break;

  // Routing-Label (#159): erstes Ready-Issue mit dem gesuchten Label; ungelabelte
  // Issues davor bleiben unangetastet. Kein Treffer -> Lauf endet wie bei leerem Ready.
  const top = labelFilter === null ? ready[0] : ready.find(hasLabel);
  if (!top) break;
  if (isFachlich(top.title)) {
    log(`#${top.id} uebersprungen: fachliches Issue ([Fachlich]), wird nicht implementiert.`);
    board("issue", "comment", String(top.id), "--text",
      `Nachtlauf: Fachliches Issue — wird nicht implementiert, bitte per /plan #${top.id} in technische Issues ueberfuehren.`);
    board("issue", "move", String(top.id), "backlog");
    deferred++;
    continue;
  }
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
  const res = await runSession(top.id, args);
  const minutes = ((Date.now() - started) / 60000).toFixed(1);

  const nowInReview = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
  if (nowInReview) {
    succeeded++;
    log(`  Erfolg nach ${minutes} min, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
    // Rest-Guard (Issue #152): Eine erfolgreiche Runde muss den Tree sauber
    // hinterlassen. Unkommittete Reste (z. B. Temp-Dateien) wuerden die
    // Diagnose der Folgerunde verfaelschen und koennten sie faelschlich als
    // dirty hart stoppen — darum hier stoppen, wo die Ursache noch klar ist.
    if (!gitClean()) {
      log(`  HARTER STOPP: erfolgreiche Runde zu Issue #${top.id} hat unkommittete Reste hinterlassen — bitte morgens sichten und aufraeumen.`);
      hardStop = true;
      break;
    }
    continue;
  }

  // Infrastruktur-Guard (Issue #149): Exit != 0 ohne Timeout heisst, das CLI selbst
  // ist gescheitert (Auth abgelaufen, Fehlkonfiguration) — mit dem Issue ist nichts
  // falsch. Harter Stopp ohne Kommentar und ohne Backlog-Move, sonst raeumt eine
  // kaputte Umgebung die ganze Ready-Spalte leer.
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  if (!timedOut && (res.error || res.status !== 0)) {
    const exitInfo = res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`;
    const detail = (res.stderr || res.stdout || "").trim().split("\n").slice(0, 3).join(" | ");
    log(`  INFRASTRUKTUR-FEHLSCHLAG nach ${minutes} min (${exitInfo}): Session-Start gescheitert — harter Stopp, Issue #${top.id} bleibt unangetastet.`);
    if (detail) log(`  CLI-Meldung: ${detail}`);
    hardStop = true;
    break;
  }

  if (!gitClean()) {
    // Salvage (#167): Bevor der Lauf hart stoppt, pruefen wir selbst, ob die Arbeit
    // inhaltlich fertig ist. Gruene buildChecks sind das Indiz dafuer, dass die
    // Session nur ihr Ergebnis verloren hat (Hintergrund-Check ohne Folge-Turn) und
    // nicht wirklich gescheitert ist. Genau ein Versuch pro Issue.
    if (!salvageAttempted.has(String(top.id))) {
      salvageAttempted.add(String(top.id));
      const checks = verifyChecksForSalvage(config);
      if (checks.ok) {
        log(`  SALVAGE-VERSUCH gestartet (Checks extern verifiziert gruen): Issue #${top.id} — Zwischenstand wird gegen das Issue geprueft.`);
        await runSession(top.id, args, {
          prompt: salvagePrompt(top.id, checks.output, checks.formatFixCmd),
          timeoutMs: SALVAGE_TIMEOUT_MS,
          extraEnv: { NIGHT_SALVAGE: "1" },
        });
        const salvaged = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
        if (salvaged && gitClean()) {
          succeeded++;
          log(`  Salvage erfolgreich, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
          board("issue", "comment", String(top.id), "--text",
            "Nachtlauf: Die regulaere Runde endete ohne Board-Ergebnis, die Pflicht-Checks waren extern aber gruen. Eine Salvage-Session hat den Zwischenstand geprueft, committet und das Issue nach In review verschoben. Bitte beim Review besonders auf Vollstaendigkeit achten.");
          continue;
        }
        log(`  SALVAGE-VERSUCH gescheitert — harter Stopp. Issue #${top.id}${salvaged ? " ist in In review, aber der Tree ist weiterhin dirty" : " weiterhin nicht in In review"}.`);
        board("issue", "comment", String(top.id), "--text",
          "Nachtlauf: Pflicht-Checks extern gruen, aber die Salvage-Session konnte den Zwischenstand nicht sauber abschliessen — Lauf hart gestoppt. Bitte morgens manuell sichten.");
        hardStop = true;
        break;
      }
      log(`  Salvage nicht moeglich: buildChecks sind rot — die Runde ist wirklich gescheitert.`);
    }
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
