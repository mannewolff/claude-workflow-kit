// Pruef-Zusammenfassungen im Lauf-Bericht des Nacht-Runners (Issue #428).
//
// Kriterium 11 aus Issue #420 verlangt die ausgelassenen Pruefungen an zwei Stellen:
// am Arbeitspaket (Abschlussbericht, Issue #426) und im Bericht des Durchgangs. Der
// Runner sieht von einer Session nur Exit-Code, Board-Zustand und Working Tree —
// was INNERHALB der Session geprueft wurde, erfaehrt er ausschliesslich ueber die
// Zusammenfassung, die `checks.mjs run` hinterlaesst (Issue #424).
//
// Die Tests fahren deshalb den ECHTEN `checks.mjs run` aus dem Session-Fake: Ein
// von Hand geschriebenes JSON wuerde das Format einfrieren, das die andere Datei
// pflegt — und genau die Kopplung, um die es geht, nicht pruefen. Nur der Fall
// "alte Zusammenfassung" schreibt selbst, weil dort eine Datei gebraucht wird, die
// KEINE Session dieses Laufs erzeugt hat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
// Die Isolation leistet cwd + KIT_ROOT auf das Fixture-Verzeichnis (Issue #189).
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

// Zwei Pruefungen mit Bereichszuordnung. Der Bereich 'board' ist bewusst KEINER
// Pruefung zugeordnet: Beim lokalen Tracker sind Board-Moves Dateiaenderungen unter
// issues/, und eine Datei ohne Muster loest in checks.mjs den vollen Umfang aus —
// dann liefe die Auswahl im Test nie, um die es hier geht.
const KIT_CHECK = { cmd: "echo kit-check", areas: ["kit"] };
const FRONTEND_CHECK = { cmd: "echo frontend-check", areas: ["frontend"] };
const CHECK_AREAS = { kit: ["kit/**"], frontend: ["frontend/**"], board: ["issues/**"] };

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt({ buildChecks = [KIT_CHECK, FRONTEND_CHECK], extraConfig = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-checksbericht-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  // checks.mjs wird seit Issue #425 neben board.mjs und night.mjs ausgeliefert — der
  // Session-Fake ruft es genauso auf wie ein echter /implement-next-Lauf.
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    checkAreas: CHECK_AREAS,
    local: { issuesDir: "issues" },
    ...extraConfig,
  }, null, 2));
  // Dieselbe Ignore-Regel wie ein installiertes Projekt (Issue #208/#209): alles
  // unter .claude/ ist lokaler Zustand. Ohne sie erschiene die Zusammenfassung als
  // Tree-Aenderung, waehrend sie es im echten Projekt nie tut.
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\nchecklauf.log\n");
  // Eine getrackte Datei im Bereich 'kit', damit es dort etwas zu aendern gibt.
  mkdirSync(join(dir, "kit"), { recursive: true });
  writeFileSync(join(dir, "kit", "bestand.txt"), "Bestand\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function readyIssue(dir, titel = "Ein Issue") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

// Die angelegten Issues committen: Sonst zaehlt checks.mjs die untrackten
// issues/*.md zum Arbeitspaket der ersten Session — ein Zustand, den ein echtes
// Projekt nicht hat, weil der Board-Stand dort laengst im Repo liegt.
function issuesCommitten(dir) {
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
  assert.equal(run(dir, "git", ["commit", "-q", "-m", "Issues"]).status, 0);
}

function mitProjekt(fn, optionen = {}) {
  const dir = setupProjekt(optionen);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LOG_SESSION = 'echo "$NIGHT_ISSUE_ID" >> sessions.log';
const CHECKS_RUN = "node .claude/kit/checks.mjs run > /dev/null 2>&1";
const COMMIT = 'git add -A && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';

// Der Regelfall einer /implement-next-Session: arbeiten, pruefen, committen, Board
// bewegen — in genau dieser Reihenfolge, denn die Pruefung misst gegen HEAD und
// damit dieses eine Arbeitspaket (Issue #426).
const FAKE_MIT_PRUEFUNG = [
  LOG_SESSION,
  'echo arbeit > "kit/work-$NIGHT_ISSUE_ID.txt"',
  CHECKS_RUN,
  COMMIT,
  NACH_IN_REVIEW,
].join("\n");

// Dieselbe Runde ohne jede Pruefung — die Session hat `run` schlicht nicht gefahren.
const FAKE_OHNE_PRUEFUNG = [LOG_SESSION, 'echo arbeit > "kit/work-$NIGHT_ISSUE_ID.txt"', COMMIT, NACH_IN_REVIEW].join("\n");

// Eine Session, die nichts veraendert und trotzdem prueft: checks.mjs meldet
// leeresPaket.
const FAKE_LEERES_PAKET = [LOG_SESSION, CHECKS_RUN, NACH_IN_REVIEW].join("\n");

function sessions(dir) {
  const p = join(dir, "sessions.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean) : [];
}

// --- Die drei Zustaende einer Session ---

test("eine Session mit Zusammenfassung erscheint mit ihren Auslassungen im Lauf-Bericht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_MIT_PRUEFUNG });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const zeile = res.stdout.split("\n").find((z) => z.includes(`Issue #${id}`) && z.includes("kit-check"));
    assert.ok(zeile, `keine Pruef-Zeile fuer Issue #${id} im Bericht:\n${res.stdout}`);
    assert.match(zeile, /echo kit-check/, "die gelaufene Pruefung fehlt in der Zeile");
    assert.match(zeile, /gruen/, "das Ergebnis der gelaufenen Pruefung fehlt");
    assert.match(zeile, /echo frontend-check/, "die ausgelassene Pruefung fehlt in der Zeile");
    assert.match(zeile, /unberuehrt/, "der Grund der Auslassung fehlt in der Zeile");
  });
});

test("eine Session ohne Zusammenfassung bricht den Lauf nicht ab, wird aber als ungeprueft ausgewiesen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const eins = readyIssue(dir, "Eins");
    const zwei = readyIssue(dir, "Zwei");
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });

    assert.equal(res.status, 0, `eine fehlende Zusammenfassung darf den Lauf nicht abbrechen: ${res.stdout}`);
    assert.equal(sessions(dir).length, 2, "der Lauf haette mit dem zweiten Issue weitergehen muessen");
    for (const id of [eins, zwei]) {
      const zeile = res.stdout.split("\n").find((z) => z.includes(`Issue #${id}`) && /ungeprueft/.test(z));
      assert.ok(zeile, `Issue #${id} wird nicht als ungeprueft ausgewiesen:\n${res.stdout}`);
    }
  });
});

test("eine Session mit leerem Paket erscheint ausdruecklich als solche, nicht als Leerzeile", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_LEERES_PAKET });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const zeile = res.stdout.split("\n").find((z) => z.includes(`Issue #${id}`) && /leeres Paket|leeresPaket/.test(z));
    assert.ok(zeile, `Issue #${id} wird nicht als leeres Paket ausgewiesen:\n${res.stdout}`);
    assert.match(zeile, /nichts veraendert/, "der Grund 'nichts veraendert' fehlt");
    assert.doesNotMatch(zeile, /ungeprueft/, "ein leeres Paket ist nicht dasselbe wie eine ungepruefte Session");
  });
});

test("eine vor Session-Start liegende alte Zusammenfassung wird der neuen Session nicht zugerechnet", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    // Der Rest eines frueheren Laufs: eine Session, die vor ihrer Pruefung starb,
    // oder schlicht der Vortag. Ohne Loeschen vor dem Start liesse sie die neue
    // Session als geprueft erscheinen — das Gegenteil von Kriterium 11.
    writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify({
      basis: "abc1234", geaendert: ["kit/altlast.txt"], bereiche: ["kit"],
      laufen: [{ cmd: "echo altlast-vom-vortag", grund: "Bereich kit beruehrt", ergebnis: "gruen" }],
      ausgelassen: [], vollerUmfang: false, leeresPaket: false,
    }, null, 2) + "\n");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /altlast-vom-vortag/,
      "die Zusammenfassung eines frueheren Laufs wurde der neuen Session zugerechnet");
    const zeile = res.stdout.split("\n").find((z) => z.includes(`Issue #${id}`) && /ungeprueft/.test(z));
    assert.ok(zeile, `Issue #${id} haette als ungeprueft erscheinen muessen:\n${res.stdout}`);
  });
});

// --- Der Bericht als Ganzes ---

test("der Lauf-Bericht traegt je Session eine Zeile und darunter eine Summenzeile", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const eins = readyIssue(dir, "Eins");
    const zwei = readyIssue(dir, "Zwei");
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_MIT_PRUEFUNG });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const zeilen = res.stdout.split("\n");
    const idxEins = zeilen.findIndex((z) => z.includes(`Issue #${eins}`) && z.includes("kit-check"));
    const idxZwei = zeilen.findIndex((z) => z.includes(`Issue #${zwei}`) && z.includes("kit-check"));
    const idxSumme = zeilen.findIndex((z) => /Summe/.test(z));
    assert.ok(idxEins >= 0 && idxZwei >= 0, `nicht beide Sessions haben eine Zeile:\n${res.stdout}`);
    assert.ok(idxSumme > idxEins && idxSumme > idxZwei,
      `die Summenzeile fehlt oder steht nicht unter den Session-Zeilen:\n${res.stdout}`);
    assert.match(zeilen[idxSumme], /2 Session/, "die Summenzeile nennt nicht beide Sessions");
  });
});

// --- Salvage: unveraendert der volle Umfang (Entscheidung A6 des Plans #421) ---

test("Salvage prueft weiterhin die volle Liste, unabhaengig von den geaenderten Bereichen", NUR_POSIX, () => {
  // Verhaltensnachweis statt Quelltext-Grep: verifyChecksForSalvage ist nicht
  // exportiert, und eine Auswahl gibt es in night.mjs gar nicht. Beide Pruefungen
  // protokollieren ihre Ausfuehrung; die Session fasst nur den Bereich 'kit' an.
  const buildChecks = [
    { cmd: "echo kit >> checklauf.log", areas: ["kit"] },
    { cmd: "echo frontend >> checklauf.log", areas: ["frontend"] },
  ];
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    // Die regulaere Runde hinterlaesst unkommittete Arbeit und bewegt das Board
    // nicht — das Schadensbild aus Issue #167, das den Salvage ausloest.
    const fake = [
      LOG_SESSION,
      'if [ -n "$NIGHT_SALVAGE" ]; then',
      `  ${COMMIT} && ${NACH_IN_REVIEW}`,
      "else",
      '  echo arbeit > "kit/work-$NIGHT_ISSUE_ID.txt"',
      "fi",
    ].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/, "der Salvage-Pfad lief nicht");
    const laeufe = readFileSync(join(dir, "checklauf.log"), "utf-8").trim().split("\n");
    assert.deepEqual(laeufe, ["kit", "frontend"],
      `beide Pruefungen haetten laufen muessen, tatsaechlich: ${laeufe.join(", ")}`);
    assert.ok(board(dir, "issue", "list", "--status", "in_review").some((i) => String(i.id) === id),
      "das gerettete Issue haette in In review landen muessen");
  }, { buildChecks });
});
