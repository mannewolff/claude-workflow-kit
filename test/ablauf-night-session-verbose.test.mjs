// Ablauf-Pruefung: Wie --verbose auf der Kommandozeile zur Ausgabe einer ganzen Runde wird, sieht nur ein Lauf des echten Runners mit Board und Fake-Session.
//
// E2E fuer das --verbose-Flag des Nacht-Runners (Issue #154, Vorbelegung seit #867).
// Der Runner liest den stream-json-Output der Session live und schreibt kompakte
// Ereigniszeilen (Tool-Aufrufe, Text-Snippets) mit in Log und Konsole — das ist
// seit Issue #867 der Normalfall, auch ohne jedes Flag. Erst `--verbose no` bringt
// das Log zurueck auf das alte Format (nur Start/Ende plus finaler Session-Output-
// Block); `--verbose` allein bleibt zulaessig und wirkungslos.
// Der Timeout-Pfad zeigt, dass eine gekillte Session die Runde regulaer beendet.
// Laeuft komplett lokal: issueTracker "local", Session-Fake via NIGHT_CLAUDE_CMD.
//
// Seit Issue #1229 steht hier nur, was den Weg durch den Runner braucht: die Lesart des
// Flags und der Ausgang der Runde. Wie die Ereigniszeilen aus dem Strom entstehen und wie
// das Zeitlimit die Session beendet, pruefen test/night-session-verbose.test.mjs und
// test/night-session-timeout-group.test.mjs im selben Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "night-verbose-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\n");
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

test("ohne jedes Flag zeigt der Lauf kompakte Ereigniszeilen — das Verlaufsprotokoll ist der Normalfall", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Normalfall-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: streamFake() });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`#${issue.id} > Bash: mvn -q verify`), "Tool-Aufruf-Zeile fehlt");
    assert.match(res.stdout, new RegExp(`#${issue.id} > Claude: Tests gruen`), "Text-Snippet-Zeile fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--verbose yes schaltet ausdruecklich an", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Laut-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose", "yes"],
      { NIGHT_CLAUDE_CMD: streamFake() });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`#${issue.id} > Bash: mvn -q verify`), "Tool-Aufruf-Zeile fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Ein Wert, den es nicht gibt, ist ein Tippfehler — und ein Tippfehler darf nicht
// stillschweigend zur Vorbelegung zurueckfallen: Wer `--verbose nein` schreibt, will
// abschalten und bekaeme sonst das Gegenteil.
test("ein unbekannter Wert bricht ab und nennt beide Schreibweisen", () => {
  const dir = setupProjekt();
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose", "vielleicht"],
      { NIGHT_CLAUDE_CMD: "true" });

    assert.notEqual(res.status, 0, "ein unbekannter Wert haette abbrechen muessen");
    const ausgabe = `${res.stderr}${res.stdout}`;
    assert.match(ausgabe, /\bno\b/, "die Meldung muss `no` nennen");
    assert.match(ausgabe, /\byes\b/, "die Meldung muss `yes` nennen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// `--verbose` darf den naechsten Eintrag nur dann verbrauchen, wenn er ein Wert ist.
// Ein Flag ist keiner — sonst verschluckte `--verbose --max 5` das `--max`.
test("--verbose --max 5 laesst --max seine Wirkung", () => {
  const dir = setupProjekt();
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run", "--verbose", "--max", "5"],
      { NIGHT_CLAUDE_CMD: "true" });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /max 5 Sessions/, "--max wurde von --verbose verschluckt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--verbose ohne Wert bleibt zulaessig und wirkungslos (Rueckwaertskompatibilitaet)", () => {
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

test("--verbose no bleibt beim alten Format (keine Ereigniszeilen)", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Still-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose", "no"],
      { NIGHT_CLAUDE_CMD: streamFake() });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /> Bash:/, "mit --verbose no duerften keine Ereigniszeilen erscheinen");
    assert.match(res.stdout, /Erfolg/, "die erfolgreiche Runde wird weiterhin gemeldet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Timeout-Pfad: laenger laufende Session wird gekillt, Runde endet ohne Haenger", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Langsames-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // Fake laeuft laenger als das (per Test-Hook winzig gesetzte) Zeitlimit und
    // bringt das Issue nicht nach In review -> Timeout greift, Runde = Fehlschlag.
    const started = Date.now();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: "sleep 120 # haengt", NIGHT_TIMEOUT_MS: "400" });
    const elapsed = Date.now() - started;

    // Unter der Schlafdauer, mit Reserve fuer Last (Issue #1080).
    assert.ok(elapsed < 90000, `Timeout griff nicht — Lauf haengt (${elapsed} ms)`);
    // Sauberer Tree, kein In review -> Issue zurueck ins Backlog, Lauf endet regulaer.
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(issue.id)), "Issue haette nach Timeout im Backlog liegen muessen");
    assert.equal(res.status, 0, "regulaeres Ende (kein harter Stopp) nach Timeout-Fehlschlag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
