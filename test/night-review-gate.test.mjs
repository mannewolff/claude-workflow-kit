// Vorflug-Gate fuer ungepruefte Ready-Issues (Issue #223).
//
// Dritter Filter neben [Fachlich] (#146) und [Idee] (#192), aus demselben Grund: Eine
// Session, die ein ungeeignetes Issue korrekt ablehnt, ist vom Runner nicht von einem
// Fehlschlag zu unterscheiden. Ein ungepruefte Issue wuerde der Runner dagegen gar
// nicht ablehnen — er wuerde es implementieren, und die Maengel fielen erst im Code
// auf. Die Nacht waere verloren.
//
// Anders als die beiden Geschwister greift dieser Filter am BODY, nicht am Titel — der
// Marker steht im Kontext-Abschnitt. Der Body liegt ohnehin vor, weil parseDeps ihn
// braucht; ein zusaetzlicher Board-Aufruf entsteht nicht.
//
// Wie in den uebrigen night-Tests laeuft das ECHTE kit/night.mjs gegen ein Fixture
// (cwd + KIT_ROOT), Sessions ueber NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Ein Board-Aufruf ohne KIT_AGENT_MODEL — also der Mensch am Board.
 *
 * Nur so darf eine Verringerung der Pruefung geschrieben werden (Issue #303). Der
 * Bezugsstand entsteht dabei im echten Ablauf, statt im Test von Hand gerechnet zu
 * werden: Ein selbst gebauter Stand wuerde die Rechnung des Adapters nachbilden und
 * bliebe gruen, wenn beide auseinanderlaufen.
 */
function boardAlsMensch(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs], { KIT_AGENT_MODEL: "" });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-reviewgate-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function readyIssue(dir, titel, body) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Faehrt genau eine Runde mit einer Session, die nichts tut. */
function nightRun(dir) {
  return run(dir, process.execPath, [NIGHT, "--max", "1", "--label", "none"], {
    NIGHT_CLAUDE_CMD: "true",
  });
}

/** Zeigt nur die Bewertung: kein Board-Move, keine Session (Issue #304). */
function nightDryRun(dir) {
  return run(dir, process.execPath, [NIGHT, "--max", "5", "--label", "none", "--dry-run"]);
}

// Die Titel tragen bewusst nicht das Wort, auf das die Assertions pruefen: Der Runner
// loggt den Titel mit, und ein Titel wie "Ungeprueft" liess zwei Tests aus dem falschen
// Grund bestehen.
const OHNE_MARKER = "## Kontext\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\nKeine.";
const MIT_MARKER = "## Kontext\nAutor-Modell: claude-opus-5\nIssue-Review: sonnet, codex (2026-08-06)\n\n## Abhaengigkeiten\nKeine.";

const GATE_AN = { issueReview: { requiredBeforeReady: true, reviewers: [] } };

test("Gate an: ungepruftes Ready-Issue wandert kommentiert ins Backlog", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    const id = readyIssue(dir, "Ein Issue ohne Marker", OHNE_MARKER);
    const res = nightRun(dir);

    const backlog = board(dir, "issue", "list", "--status", "backlog");
    assert.ok(backlog.some((i) => String(i.id) === id), "das Issue muss im Backlog liegen");
    assert.match(res.stdout, /kein Issue-Review-Marker/i);
    const full = board(dir, "issue", "get", id);
    assert.match(JSON.stringify(full), /issue-review/i, "der Kommentar muss den Skill nennen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gate an: geprueftes Issue wird normal verarbeitet", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    readyIssue(dir, "Ein Issue mit Marker", MIT_MARKER);
    const res = nightRun(dir);
    // Nicht die Spalte pruefen: Die Fake-Session tut nichts, das Issue landet danach
    // regulaer als Fehlschlag im Backlog. Signal ist allein, ob das GATE gegriffen hat.
    assert.doesNotMatch(res.stdout, /kein Issue-Review-Marker/i,
      "ein geprueftes Issue darf nicht am Gate haengenbleiben");
    assert.match(res.stdout, /Session 1\/1/, "die Session muss ueberhaupt gestartet sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gate an: eine aehnliche Zeile zaehlt nicht als Marker", NUR_POSIX, () => {
  // 'Issue-Review folgt noch' ist genau das Gegenteil einer Freigabe.
  const dir = setupProjekt(GATE_AN);
  try {
    const id = readyIssue(dir, "Ein Issue mit aehnlicher Zeile",
      "## Kontext\nIssue-Review folgt noch\n\n## Abhaengigkeiten\nKeine.");
    nightRun(dir);
    const backlog = board(dir, "issue", "list", "--status", "backlog");
    assert.ok(backlog.some((i) => String(i.id) === id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Default: ohne requiredBeforeReady aendert sich nichts", NUR_POSIX, () => {
  // Ein Kit-Update darf keinem Bestandsprojekt ueber Nacht den Runner anhalten.
  const dir = setupProjekt();
  try {
    readyIssue(dir, "Ein Issue ohne Marker", OHNE_MARKER);
    const res = nightRun(dir);
    assert.doesNotMatch(res.stdout, /kein Issue-Review-Marker/i, "beim Default darf das Gate nicht greifen");
    assert.match(res.stdout, /Session 1\/1/, "die Session muss ueberhaupt gestartet sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Stufen-Marker (Issue #279) -------------------------------------------
//
// Der Anker `Issue-Review:` ist die Bedingung fuer die Freigabe zur Umsetzung.
// Seit #279 gibt es zwei weitere Marker fuer die vorgelagerten Pruefstufen. Truege
// ein Dokument mit `Fachplan-Review:` oder `Plan-Review:` denselben Nachweis,
// hielte der Runner es fuer freigabereif und zoege es in die Implementierung —
// obwohl niemand das Arbeitspaket geprueft hat, weil es gar keines ist.

const MIT_FACHPLAN_MARKER =
  "## Kontext\nAutor-Modell: claude-opus-5\nFachplan-Review: opus (2026-08-08)\n\n## Abhaengigkeiten\nKeine.";
const MIT_PLAN_MARKER =
  "## Kontext\nAutor-Modell: claude-opus-5\nPlan-Review: opus, codex (2026-08-08)\n\n## Abhaengigkeiten\nKeine.";

for (const [name, body] of [["Fachplan-Review", MIT_FACHPLAN_MARKER], ["Plan-Review", MIT_PLAN_MARKER]]) {
  test(`Gate an: ein ${name}-Marker zaehlt nicht als Freigabe-Nachweis`, NUR_POSIX, () => {
    const dir = setupProjekt(GATE_AN);
    try {
      const id = readyIssue(dir, `Ein Dokument mit fremdem Marker (${name})`, body);
      const res = nightRun(dir);

      const backlog = board(dir, "issue", "list", "--status", "backlog");
      assert.ok(
        backlog.some((i) => String(i.id) === id),
        `${name} darf das Implementierungs-Gate nicht passieren`
      );
      assert.match(res.stdout, /kein Issue-Review-Marker/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// --- Verzicht als zweiter Freigabegrund (Issue #304) -----------------------
//
// Ein Ticket mit bewusstem Verzicht traegt keinen Marker — und wurde bis hier vom
// Gate wie ein ungeprueftes zurueckgestellt. Genau das war die Beschwerde (#285):
// Der Mensch entscheidet ausdruecklich "ohne Pruefung", und nachts passiert trotzdem
// nichts. Der Marker bleibt unangetastet (Issue #279); der Verzicht ist ein eigener,
// zweiter Grund.
//
// Die drei Ablehnungsgruende bleiben unterscheidbar, weil sie morgens verschiedene
// Dinge bedeuten: "nie geprueft", "entschieden, aber ueberholt" und "die Zeile ist
// kaputt" verlangen verschiedene Handgriffe.

const KOPF = "## Kontext\nAutor-Modell: claude-opus-5\n";
const MIT_VERZICHT = `${KOPF}Pruefung: Verzicht\n\n## Abhaengigkeiten\nKeine.`;
const VERZICHT_VERFALLEN = `${KOPF}Pruefung: Verzicht\nPruefung-Stand: ${"b".repeat(64)}\n\n## Abhaengigkeiten\nKeine.`;
const VORGABE_KAPUTT = `${KOPF}Pruefung: vielleicht\n\n## Abhaengigkeiten\nKeine.`;

/** Legt das Ticket an und laesst den Bezugsstand vom Adapter setzen (wie von Hand). */
function readyMitVorgabe(dir, titel, body) {
  const id = readyIssue(dir, titel, body);
  boardAlsMensch(dir, "issue", "update", id, "--body", body);
  const full = board(dir, "issue", "get", id);
  assert.match(full.body, /Pruefung-Stand: [0-9a-f]{64}/,
    "ohne gesetzten Stand pruefte der Test den Fall 'Vorgabe ohne Bezugsstand'");
  return id;
}

test("Gate an: gueltiger Verzicht wird implementiert, obwohl kein Marker da ist", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    readyMitVorgabe(dir, "Ein Issue mit bewusster Freigabe", MIT_VERZICHT);
    const res = nightRun(dir);

    assert.doesNotMatch(res.stdout, /kein Issue-Review-Marker/i,
      "ein bewusst freigegebenes Issue darf nicht am Gate haengenbleiben");
    assert.match(res.stdout, /bewusst ohne Pruefung freigegeben/i,
      "der Grund der Freigabe muss im Protokoll stehen");
    assert.match(res.stdout, /Session 1\/1/, "die Session muss ueberhaupt gestartet sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gate an: ohne Marker und ohne Verzicht bleibt es beim Zurueckstellen", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    const id = readyIssue(dir, "Ein Issue ohne alles", OHNE_MARKER);
    const res = nightRun(dir);

    assert.ok(board(dir, "issue", "list", "--status", "backlog").some((i) => String(i.id) === id));
    assert.match(res.stdout, /kein Issue-Review-Marker/i);
    assert.doesNotMatch(res.stdout, /bewusst ohne Pruefung freigegeben/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gate an: eine verfallene Vorgabe wird als verfallen zurueckgestellt", NUR_POSIX, () => {
  // Der Unterschied zu "ungeprueft" ist die ganze Aussage: Hier hatte jemand etwas
  // entschieden, und die Entscheidung ist durch eine inhaltliche Aenderung ueberholt.
  const dir = setupProjekt(GATE_AN);
  try {
    const id = readyIssue(dir, "Ein Issue mit ueberholter Vorgabe", VERZICHT_VERFALLEN);
    const res = nightRun(dir);

    assert.ok(board(dir, "issue", "list", "--status", "backlog").some((i) => String(i.id) === id),
      "eine verfallene Vorgabe darf nicht durchlassen");
    assert.match(res.stdout, /verfallen/i, "der Verfall muss ausdruecklich benannt sein");
    assert.doesNotMatch(res.stdout, /kein Issue-Review-Marker/i,
      "ein Verfall ist etwas anderes als ein fehlender Marker");
    assert.match(JSON.stringify(board(dir, "issue", "get", id)), /verfallen/i,
      "auch der Board-Kommentar muss den Verfall nennen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gate an: eine ungueltige Vorgabe wird mit ihrem Grund zurueckgestellt", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    const id = readyIssue(dir, "Ein Issue mit Tippfehler in der Zeile", VORGABE_KAPUTT);
    const res = nightRun(dir);

    assert.ok(board(dir, "issue", "list", "--status", "backlog").some((i) => String(i.id) === id),
      "eine kaputte Vorgabe darf nicht wie ein Verzicht wirken");
    assert.match(res.stdout, /ungueltige Pruefvorgabe/i);
    assert.match(JSON.stringify(board(dir, "issue", "get", id)), /ungueltige Pruefvorgabe/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Der Dry-Run prueft das Gate bis Issue #304 gar nicht — er bildet nur Praefixe,
// Abhaengigkeiten und --max ab. Ein Verzicht-Test ueber den Dry-Run waere deshalb
// auch bei vollstaendig kaputter Erkennung gruen gewesen. Das Paar unten misst
// beide Seiten in EINEM Lauf: Nur wenn das Gate dort mitlaeuft, gehen die zwei
// sonst identischen Tickets auseinander.
test("Dry-Run: das Gate laeuft mit — Verzicht wird Session, ungeprueft geht ins Backlog", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    const frei = readyMitVorgabe(dir, "Erstes Ticket mit bewusster Freigabe", MIT_VERZICHT);
    const offen = readyIssue(dir, "Zweites Ticket ohne alles", OHNE_MARKER);
    const res = nightDryRun(dir);

    assert.match(res.stdout, new RegExp(`#${frei}[^\\n]*-> Session`),
      "das bewusst freigegebene Ticket muss als Session ausgewiesen werden");
    assert.match(res.stdout, new RegExp(`#${offen}[^\\n]*wuerde ins Backlog`),
      "das ungeprufte Ticket darf im Dry-Run nicht als Session erscheinen");
    // Der Dry-Run bewegt nichts: beide bleiben in Ready.
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.deepEqual(ready.sort(), [frei, offen].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dry-Run: ohne requiredBeforeReady bleibt der Dry-Run unveraendert", NUR_POSIX, () => {
  // Dieselbe Zurueckhaltung wie im echten Lauf: Ein Kit-Update darf keinem
  // Bestandsprojekt den Dry-Run umschreiben.
  const dir = setupProjekt();
  try {
    const offen = readyIssue(dir, "Ein Ticket ohne alles", OHNE_MARKER);
    const res = nightDryRun(dir);
    assert.match(res.stdout, new RegExp(`#${offen}[^\\n]*-> Session`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
