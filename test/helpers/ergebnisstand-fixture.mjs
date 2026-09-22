// Gemeinsame Hilfen der E2E-Tests zum Ergebnisstand des Nacht-Runners (Issue #486/#488,
// geteilt mit Issue #836).
//
// Die Tests liegen in drei Dateien — Anlage und harte Stopps, die Einheiten je
// Arbeitspaket, die Kennzahlen einer Kette —, weil eine einzelne Datei ihre Tests
// nacheinander faehrt und damit die Wandzeit der ganzen Suite nach unten begrenzte
// (Issue #836). Was mehrere brauchen, steht hier: die beiden Fixture-Projekte, die
// Zugriffe auf Stand und Einheiten und die Bausteine der Session-Fakes. Doppelt
// gepflegt wird davon nichts.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture).
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
export const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
// Die Isolation leistet cwd + KIT_ROOT auf das Fixture-Verzeichnis (Issue #189).
export const NIGHT = join(repoRoot, "kit", "night.mjs");

export function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

export function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

export function setupProjekt(praefix, night = null) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
    ...(night ? { night } : {}),
  }, null, 2));
  // Bewusst OHNE `.claude/*` und ohne `*.json` (Muster aus night-guards.test.mjs:48):
  // Die Ergebnisstand-Datei muss untracked sichtbar bleiben, sonst bewiese der
  // [night-3]-Test nichts. Die .log-Datei bleibt ignoriert, sonst fiele die
  // Gegenprobe schon am Textprotokoll statt an der JSON-Datei. Die
  // Pruef-Zusammenfassung ebenso: Sie ist in einem installierten Projekt von
  // `.claude/*` gedeckt, hier aber einzeln zu nennen — sonst hinterliesse jeder
  // Fake, der prueft, einen unsauberen Baum und der Rest-Guard schluege an.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nbin/\n");
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

// `nightrun melden` postet gegen die echte Toolbox-API — in der Testumgebung nicht
// erreichbar. Der Stellvertreter faengt nur diesen einen Unterbefehl ab und haengt den
// tatsaechlich gebauten Meldungs-Rumpf (ueber die echte, reine nachtlaufMeldung()) an
// NIGHT43_CAPTURE an; jeder andere Befehl geht unveraendert an das echte board.mjs
// (als board-real.mjs daneben abgelegt) — Issues entstehen und bewegen sich weiterhin
// ueber den lokalen Tracker (Issue #743).
const BOARD_STUB = [
  'import { spawnSync } from "node:child_process";',
  'import { readFileSync, appendFileSync } from "node:fs";',
  'import { join, dirname } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  'import { nachtlaufMeldung } from "./board-real.mjs";',
  "",
  "const args = process.argv.slice(2);",
  'if (args[0] === "nightrun" && args[1] === "melden") {',
  '  const datei = args[args.indexOf("--datei") + 1];',
  '  const stand = JSON.parse(readFileSync(datei, "utf-8"));',
  String.raw`  appendFileSync(process.env.NIGHT43_CAPTURE, JSON.stringify(nachtlaufMeldung(stand)) + "\n");`,
  String.raw`  process.stdout.write(JSON.stringify({ ok: true, outcome: "TEST" }) + "\n");`,
  "} else {",
  '  const real = join(dirname(fileURLToPath(import.meta.url)), "board-real.mjs");',
  "  const res = spawnSync(process.execPath, [real, ...args], { stdio: \"inherit\" });",
  "  process.exit(res.status ?? 1);",
  "}",
  "",
].join("\n");

/** Wie setupProjekt, aber mit dem meldung-abfangenden Stellvertreter aus BOARD_STUB. */
export function setupProjektMitMeldeCapture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board-real.mjs"));
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), BOARD_STUB);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nbin/\n");
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

/** Die Meldungen aus NIGHT43_CAPTURE, eine je Zeile. */
export function meldungen(captureFile) {
  if (!existsSync(captureFile)) return [];
  return readFileSync(captureFile, "utf-8").split("\n").filter((z) => z.trim() !== "").map((z) => JSON.parse(z));
}

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
export function readyIssue(dir, titel, zusatz = "") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", `${zusatz}## Abhaengigkeiten\nKeine.`);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Die Ergebnisstand-Dateien im Fixture, nach Namen sortiert. */
export function staende(dir) {
  return readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
}

/** Der eine Ergebnisstand des Laufs — mehr als einer waere hier ein Fehler. */
export function stand(dir) {
  const dateien = staende(dir);
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Die Einheit zu einem Issue — der Zugriff ueber die ID, nicht ueber die Position. */
export function einheit(dir, id) {
  const s = stand(dir);
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

/** Das Textprotokoll des Laufs liegt daneben und bleibt der Weg ins Detail. */
export function textprotokollDa(dir) {
  return readdirSync(join(dir, ".claude")).some((n) => /^night-run-\d{4}-\d{2}-\d{2}\.log$/.test(n));
}

// --- Bausteine der Session-Fakes ---

export const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
// Gezielt stagen statt `git add -A`: Die Board-Dateien und der Ergebnisstand sollen
// untracked bleiben, so wie sie es im echten Projekt sind.
export const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
// Die Zusammenfassung schreibt hier der Fake selbst statt checks.mjs: Der Test misst,
// was der Runner aus der Datei macht, nicht wie sie entsteht.
export const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}'`
  + " > .claude/checks-summary.json";
export const SUMMARY_LEER = `printf '%s' '{"leeresPaket":true}' > .claude/checks-summary.json`;

// Die `result`-Zeile aus dem Fixture von test/night-kennzahlen.test.mjs — echte
// Feldnamen aus einer echten Session, gekuerzt in den Textfeldern. Sie enthaelt keine
// einfachen Anfuehrungszeichen und laesst sich darum im sh-Fake als Literal echoen.
export const RESULT_ZEILE =
  '{"is_error":false,"duration_api_ms":296247,"num_turns":37,"stop_reason":"end_turn",' +
  '"session_id":"8945efcc","total_cost_usd":2.4124460000000005,' +
  '"usage":{"input_tokens":70,"output_tokens":17688,"service_tier":"standard"},' +
  '"modelUsage":{"claude-opus-5":{"costUSD":2.4124460000000005}},"permission_denials":[],' +
  '"result":"Abschlussbericht gekuerzt.","ttft_ms":2744,"time_to_request_ms":35,' +
  '"type":"result","duration_ms":382540,"uuid":"d967193f"}';
export const RESULT_AUSGEBEN = `echo '${RESULT_ZEILE}'`;
