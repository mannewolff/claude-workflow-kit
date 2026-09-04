// E2E fuer das --verbose-Flag des Nacht-Runners (Issue #154).
// Mit --verbose liest der Runner den stream-json-Output der Session live und
// schreibt kompakte Ereigniszeilen (Tool-Aufrufe, Text-Snippets) mit in Log
// und Konsole. Ohne Flag bleibt das Log beim heutigen Format (nur Start/Ende
// plus finaler Session-Output-Block). Der Umbau von spawnSync auf async spawn
// wird zusaetzlich am Timeout-Pfad abgesichert (eigener Timer killt die Runde).
// Laeuft komplett lokal: issueTracker "local", Session-Fake via NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "night-verbose-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\n");
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

// Fake, der zwei stream-json-Zeilen ausgibt (Tool-Aufruf + Text) und dann das
// Issue erfolgreich nach In review bringt.
function streamFake() {
  return [
    `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"mvn -q verify"}}]}}'`,
    `echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Tests gruen, ich committe jetzt."}]}}'`,
    "node .claude/kit/checks.mjs run > /dev/null 2>&1",
    `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`,
  ].join(" && ");
}

test("--verbose zeigt kompakte Ereigniszeilen (Tool-Aufruf + Text) im Konsolen-Log", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Verbose-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"],
      { NIGHT_CLAUDE_CMD: streamFake() });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`#${issue.id} > Bash: mvn -q verify`), "Tool-Aufruf-Zeile fehlt");
    assert.match(res.stdout, new RegExp(`#${issue.id} > Claude: Tests gruen`), "Text-Snippet-Zeile fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne --verbose bleibt das Log beim heutigen Format (keine Ereigniszeilen)", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Still-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: streamFake() });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /> Bash:/, "ohne --verbose duerften keine Ereigniszeilen erscheinen");
    assert.match(res.stdout, /Erfolg/, "die erfolgreiche Runde wird weiterhin gemeldet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Timeout-Pfad: laenger laufende Session wird gekillt, Runde endet ohne Haenger", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Langsames-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // Fake laeuft laenger als das (per Test-Hook winzig gesetzte) Zeitlimit und
    // bringt das Issue nicht nach In review -> Timeout greift, Runde = Fehlschlag.
    const started = Date.now();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: "sleep 30", NIGHT_TIMEOUT_MS: "400" });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 20000, `Timeout griff nicht — Lauf haengt (${elapsed} ms)`);
    // Sauberer Tree, kein In review -> Issue zurueck ins Backlog, Lauf endet regulaer.
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(issue.id)), "Issue haette nach Timeout im Backlog liegen muessen");
    assert.equal(res.status, 0, "regulaeres Ende (kein harter Stopp) nach Timeout-Fehlschlag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Was der Stream sonst noch liefert (Issue #405) ---
//
// Die Ereigniszeilen entstehen aus fremdem NDJSON. Was dort ankommt, bestimmt nicht
// der Runner — und alles, was er nicht versteht, muss er ueberspringen, statt den
// Lauf daran zu kippen. Ein Verbose-Modus, der an einer unparsebaren Zeile stirbt,
// waere schlimmer als keiner.

test("--verbose ueberspringt Zeilen, die kein Ereignis sind", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const fake = [
      `echo 'kein JSON'`,                                   // unparsebar
      `echo ''`,                                            // leer
      `echo 'null'`,                                        // JSON, aber kein Objekt
      `echo '"nur ein String"'`,
      `echo '{"type":"system","subtype":"init"}'`,          // Objekt ohne content
      `echo '{"type":"assistant","message":{}}'`,           // ohne content-Array
      `echo '{"type":"assistant","message":{"content":[{"type":"text","text":"   "}]}}'`, // leerer Text
      `echo '{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}'`,          // ohne Namen
      `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}'`,
      `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep"}]}}'`,  // ganz ohne input
      `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Glob","input":{"zahl":7}}]}}'`,
      "node .claude/kit/checks.mjs run > /dev/null 2>&1",
    `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`,
    ].join(" && ");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}${res.stdout}`);
    // Ein Tool-Aufruf ohne brauchbares Argument erscheint mit blossem Namen ...
    assert.match(res.stdout, new RegExp(`#${issue.id} > Read$`, "m"),
      "ein Tool ohne Argument muss mit blossem Namen erscheinen");
    assert.match(res.stdout, new RegExp(`#${issue.id} > Grep$`, "m"),
      "ein Tool ganz ohne input-Feld muss mit blossem Namen erscheinen");
    // ... eines mit nicht-textlichem Argument als kompaktes JSON.
    assert.match(res.stdout, new RegExp(`#${issue.id} > Glob: \\{"zahl":7\\}`),
      "ein nicht-textliches Argument muss als JSON erscheinen");
    // Und nichts davon erzeugt eine leere oder kaputte Ereigniszeile.
    assert.doesNotMatch(res.stdout, /> undefined|> null|> \s*$/m,
      "aus einer unverstandenen Zeile wurde ein Ereignis gebaut");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--verbose kuerzt lange Texte und Argumente", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // Ein Text ueber 200 Zeichen und ein Kommando ueber 160: Beide muessen gekuerzt
    // ankommen, sonst walzt eine einzelne Session das Protokoll platt.
    const langerText = "T".repeat(400);
    const langesKommando = `echo ${"x".repeat(400)}`;
    const fake = [
      `echo '{"type":"assistant","message":{"content":[{"type":"text","text":"${langerText}"}]}}'`,
      `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"${langesKommando}"}}]}}'`,
      "node .claude/kit/checks.mjs run > /dev/null 2>&1",
    `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`,
    ].join(" && ");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}${res.stdout}`);
    const textZeile = res.stdout.split("\n").find((z) => z.includes("> Claude: "));
    assert.ok(textZeile, "die Textzeile fehlt");
    assert.ok(textZeile.includes("…"), "der lange Text wurde nicht gekuerzt");
    assert.ok(textZeile.length < 300, `die Textzeile ist zu lang: ${textZeile.length} Zeichen`);
    const bashZeile = res.stdout.split("\n").find((z) => z.includes("> Bash: "));
    assert.ok(bashZeile?.includes("…"), "das lange Kommando wurde nicht gekuerzt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--verbose wertet auch eine letzte Zeile ohne Zeilenumbruch aus", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // `printf` ohne \n: Das Ereignis bleibt im Puffer, bis der Prozess endet. Ohne
    // die Auswertung beim Schliessen ginge die letzte Meldung einer Session verloren
    // — und das ist oft die interessanteste.
    const fake = [
      "node .claude/kit/checks.mjs run > /dev/null 2>&1",
    `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`,
      `printf '%s' '{"type":"assistant","message":{"content":[{"type":"text","text":"Letzte Zeile ohne Umbruch"}]}}'`,
    ].join(" && ");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, /> Claude: Letzte Zeile ohne Umbruch/,
      "die letzte Zeile ohne Umbruch wurde verschluckt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
