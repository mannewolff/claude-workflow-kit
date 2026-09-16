// Das Modell einer Karte (Issue #665, Plan #663).
//
// Der Nacht-Runner startete jede Session mit demselben Modell — `args.model`, einmal fuer
// den ganzen Lauf. Eine Empfehlung am Arbeitspaket hatte keine Wirkung. Jetzt laeuft die
// Session einer Karte mit dem Modell dieser Karte.
//
// Die Liste erlaubter Namen aus `night.modelle` ist die EINZIGE Pruefung (Plan #663, E3).
// Sie ist kein Komfort, sondern der Sicherheitskern: Ohne sie wanderte ein Wert aus einem
// Issue-Body unbesehen in `argv`, und ein Paket mit
// `Empfohlenes Modell: --dangerously-skip-permissions` waere ein Angriff ueber eine Karte.
// Ein Name ausserhalb der Liste faellt auf das Modell des Laufs zurueck, mit Grund in der
// Einheit. Ein Modell, das trotz gueltigen Namens nicht startet, bleibt ein Fehlschlag wie
// heute — `werteRunde` behandelt jeden Nicht-Timeout-Exit ungleich 0 so, und "nicht
// gestartet" waere von "abgestuerzt" nur durch Deutung von stderr zu unterscheiden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { empfohlenesModell } from "../kit/night.mjs";

const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const ERLAUBT = ["claude-opus-5", "claude-sonnet-5"];

// --- Die reine Funktion ---

test("[night-26] ein Name von der Liste wird uebernommen", () => {
  const { modell, grund } = empfohlenesModell("## Kontext\n\nEmpfohlenes Modell: claude-sonnet-5\n", ERLAUBT);
  assert.equal(modell, "claude-sonnet-5");
  assert.equal(grund, null, "ein uebernommener Name braucht keinen Grund");
});

test("[night-26] ein Name ausserhalb der Liste liefert null mit Grund", () => {
  const { modell, grund } = empfohlenesModell("Empfohlenes Modell: gpt-6-astra\n", ERLAUBT);
  assert.equal(modell, null);
  assert.ok(grund && grund.length > 0, "der Rueckfall braucht einen Grund");
  assert.match(grund, /gpt-6-astra/, "der Grund nennt den abgewiesenen Namen");
});

test("[night-26] ein Wert mit fuehrendem Bindestrich gilt gar nicht erst als Treffer", () => {
  // Der Sicherheitskern. Der Wert darf nicht einmal als Kandidat entstehen — er stuende
  // sonst eine Vergleichsoperation davon entfernt, in argv zu landen.
  const { modell } = empfohlenesModell("Empfohlenes Modell: --dangerously-skip-permissions\n", ERLAUBT);
  assert.equal(modell, null, "ein Flag ist kein Modellname");
});

test("[night-26] ein Wert mit Leerzeichen gilt nicht als Treffer", () => {
  // Sonst waere `claude-opus-5 --dangerously-skip-permissions` ein Treffer, sobald der
  // Vergleich nur den Anfang prueft.
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5 --yolo\n", ERLAUBT).modell, null);
});

test("[night-26] eine fehlende Zeile liefert null ohne Grund", () => {
  const { modell, grund } = empfohlenesModell("## Kontext\n\nKein Hinweis hier.\n", ERLAUBT);
  assert.equal(modell, null);
  assert.equal(grund, null, "eine fehlende Empfehlung ist kein abgewiesener Name");
});

test("[night-26] eine fehlende oder leere Liste schaltet die Wirkung ab", () => {
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", []).modell, null);
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", undefined).modell, null);
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", null).modell, null);
});

test("[night-26] die Zeile ist am Zeilenanfang verankert", () => {
  // Sonst traefe eine Erwaehnung im Fliesstext ("... siehe Empfohlenes Modell: X ...").
  assert.equal(empfohlenesModell("siehe Empfohlenes Modell: claude-opus-5\n", ERLAUBT).modell, null);
});

// --- Der Runner: E2E gegen ein Temp-Repo ---

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix, { modelle = ERLAUBT, buildChecks = ["true"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    local: { issuesDir: "issues" },
    ...(modelle ? { night: { modelle } } : {}),
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/night-run-*.json\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "t@example.invalid"]],
    ["git", ["config", "user.name", "T"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-qm", "Fixture"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")}: ${res.stderr}`);
  }
  return dir;
}

function readyIssue(dir, titel, empfehlung) {
  // `Autor-Modell:` ist Pflicht im Body — `issue create` weist ihn sonst ab.
  const zeile = empfehlung ? `Empfohlenes Modell: ${empfehlung}\n` : "";
  const body = `## Kontext\n\nAutor-Modell: claude-opus-5\n${zeile}\n## Abhaengigkeiten\nKeine.\n`;
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Eine Fake-CLI im PATH, die Argumente und KIT_AGENT_MODEL mitschreibt. */
function fakeCli(extra = "") {
  const binDir = mkdtempSync(join(tmpdir(), "night-modell-bin-"));
  const argLog = join(binDir, "args.txt");
  writeFileSync(join(binDir, "claude"),
    `#!/bin/sh\nprintf 'ARGS %s\\n' "$*" >> ${JSON.stringify(argLog)}\n` +
    `printf 'AGENT %s\\n' "$KIT_AGENT_MODEL" >> ${JSON.stringify(argLog)}\n${extra}exit 0\n`);
  chmodSync(join(binDir, "claude"), 0o755);
  return { binDir, argLog };
}

const staende = (dir) => readdirSync(join(dir, ".claude")).filter((n) => /^night-run-.*\.json$/.test(n)).sort();
const leseStand = (dir) => JSON.parse(readFileSync(join(dir, ".claude", staende(dir)[0]), "utf-8"));

test("[night-26] die Session startet mit dem Modell der Karte, in --model und KIT_AGENT_MODEL", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-karte-");
  let bin = null;
  try {
    readyIssue(dir, "Empfiehlt sonnet", "claude-sonnet-5");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = readFileSync(bin.argLog, "utf-8");
    assert.match(log, /--model claude-sonnet-5/, `die Karte setzt das Modell nicht durch:\n${log}`);
    assert.match(log, /AGENT claude-sonnet-5/, `KIT_AGENT_MODEL traegt nicht denselben Wert:\n${log}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-4] die Einheit traegt Modell, Herkunft und Grund", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-einheit-");
  let bin = null;
  try {
    readyIssue(dir, "Empfiehlt etwas Fremdes", "gpt-6-astra");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    // Der Rueckfall: ein Name ausserhalb der Liste laeuft mit dem Modell des Laufs.
    assert.match(readFileSync(bin.argLog, "utf-8"), /--model claude-opus-5/, "der Rueckfall greift nicht");

    const einheit = leseStand(dir).einheiten[0];
    assert.equal(einheit.modell, "claude-opus-5");
    assert.equal(einheit.modellHerkunft, "lauf");
    assert.ok(einheit.modellGrund && einheit.modellGrund.length > 0, "der Grund des Rueckfalls fehlt");
    assert.match(einheit.modellGrund, /gpt-6-astra/, "der Grund nennt den abgewiesenen Namen nicht");

    // Die Feldreihenfolge ist der Vertrag: die drei Felder stehen direkt nach titel.
    const schluessel = Object.keys(einheit);
    assert.deepEqual(schluessel.slice(0, 5), ["id", "titel", "modell", "modellHerkunft", "modellGrund"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] ein Flag als Empfehlung kommt nicht in die Argumente", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-flag-");
  let bin = null;
  try {
    readyIssue(dir, "Versucht ein Flag", "--dangerously-skip-permissions");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = readFileSync(bin.argLog, "utf-8");
    assert.doesNotMatch(log, /--dangerously-skip-permissions/, `der Wert aus der Karte steht in argv:\n${log}`);
    assert.match(log, /--model claude-opus-5/, "der Rueckfall greift nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] eine leere Liste schaltet die Wirkung ab", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-leer-", { modelle: [] });
  let bin = null;
  try {
    readyIssue(dir, "Empfiehlt sonnet", "claude-sonnet-5");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(readFileSync(bin.argLog, "utf-8"), /--model claude-opus-5/, "ohne Liste gilt das Modell des Laufs");

    const einheit = leseStand(dir).einheiten[0];
    assert.equal(einheit.modellHerkunft, "lauf");
    assert.equal(einheit.modellGrund, null, "eine leere Liste ist kein abgewiesener Name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] --dry-run nennt je Karte Modell und Herkunft", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-dry-");
  try {
    readyIssue(dir, "Empfiehlt sonnet", "claude-sonnet-5");
    readyIssue(dir, "Empfiehlt nichts", null);
    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none", "--model", "claude-opus-5"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Modell claude-sonnet-5 \(Karte\)/, `die Karte fehlt im Dry-Run:\n${res.stdout}`);
    assert.match(res.stdout, /Modell claude-opus-5 \(Lauf\)/, `der Rueckfall fehlt im Dry-Run:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
