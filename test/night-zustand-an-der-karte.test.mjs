// Der Umsetzungspfad liest den Kartenzustand an der Karte (Issue #927).
//
// Ausgangslage, belegt am Lauf `night-run-2026-09-25-061517`: Die Session zu Issue #862
// zog die Karte nach In review, committete und fuhr alle Pflichtpruefungen gruen — und
// der Runner stellte sie dennoch zurueck, weil die Sammelliste
// `issue list --status in_review` sie nicht enthielt. Der Ketten-Pfad fragt denselben
// Zustand seit Plan #638 an der Karte selbst (`leseKarte(id)?.status`); der
// Umsetzungspfad tut das jetzt ebenso.
//
// Drei Aussagen:
//   night-92 — Einzelabruf sagt `in_review` → Erfolg, auch wenn die Sammelliste luegt.
//   night-93 — Einzelabruf liefert nichts → keine Board-Mutation, der Lauf faehrt fort.
//   night-94 — Einzelabruf sagt etwas anderes → Rueckstellung wie bisher.
//
// Erreicht wird das ueber ein Wrapper-`board.mjs` im Fixture: Es delegiert jeden Aufruf
// an das echte Script daneben und weicht nur da ab, wo eine Env-Variable es verlangt.
// Gefahren wird das ECHTE `kit/night.mjs` gegen das Fixture (cwd + KIT_ROOT, Issue #189),
// damit die Treffer dort und nicht in einer Kopie gemessen werden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

// Ein einziger Pflichtcheck im Bereich 'kit' — dasselbe Muster wie in
// `night-nachweis-commit.test.mjs`: Ohne gruenen Nachweis greift der Nachweis-Guard,
// und die Runde waere aus einem anderen Grund kein Erfolg.
const KIT_CHECK = { cmd: "echo kit >> checklauf.log", areas: ["kit"] };
const CHECK_AREAS = { kit: ["kit/**"], board: ["issues/**"] };

// Das Wrapper-Board: es delegiert an `board-echt.mjs` daneben und luegt nur auf Zuruf.
//
// NIGHT_FAKE_LIST_IN_REVIEW_LEER — `issue list --status in_review` liefert `[]`. Das ist
// der Vorfall aus dem Lauf: eine Sammelliste, die die Karte nicht enthaelt.
// NIGHT_FAKE_GET_UNLESBAR — der erste `issue get`, der nach dem Anlegen der dort
// genannten Marker-Datei kommt, scheitert mit Exit 1 ohne JSON; die Marker-Datei wird
// dabei geloescht. Genau einmal, weil `leseKarte` in `werteRunde` der erste Abruf nach
// der Session ist und die Runde danach weiterlaufen soll.
const WRAPPER = `import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const echt = join(dirname(fileURLToPath(import.meta.url)), "board-echt.mjs");

if (process.env.NIGHT_FAKE_LIST_IN_REVIEW_LEER && args[0] === "issue" && args[1] === "list" && args.includes("in_review")) {
  process.stdout.write("[]\\n");
  process.exit(0);
}

const marker = process.env.NIGHT_FAKE_GET_UNLESBAR;
if (marker && args[0] === "issue" && args[1] === "get" && existsSync(marker)) {
  rmSync(marker, { force: true });
  process.stderr.write("Tracker voruebergehend nicht lesbar (Fake)\\n");
  process.exit(1);
}

const res = spawnSync(process.execPath, [echt, ...args], { stdio: "inherit" });
process.exit(res.status ?? 1);
`;

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

// Die Tests selbst fragen das ECHTE Board — ein Test, der durch denselben Luegen-Wrapper
// liest, koennte seine eigene Luege nicht von der Wirklichkeit unterscheiden.
function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board-echt.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board-echt.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-karte-zustand-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board-echt.mjs"));
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), WRAPPER);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: [KIT_CHECK],
    checkAreas: CHECK_AREAS,
    local: { issuesDir: "issues" },
  }, null, 2));
  // `.claude/*` bis auf die Config ausgenommen: Ergebnisstand, Pruefzusammenfassung und
  // der Marker des Fakes entstehen dort und sind kein Rest im Sinne des Rest-Guards.
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\nchecklauf.log\n");
  mkdirSync(join(dir, "kit"), { recursive: true });
  writeFileSync(join(dir, "kit", "bestand.txt"), "Bestand\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0, `git ${a.join(" ")} schlug fehl`);
  }
  return dir;
}

function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  // Den Board-Stand committen: Sonst zaehlten die untrackten issues/*.md zum
  // Arbeitspaket der Session — ein Zustand, den ein installiertes Projekt nicht hat.
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
  assert.equal(run(dir, "git", ["commit", "-q", "-m", "Issues"]).status, 0);
  return String(issue.id);
}

function mitProjekt(fn) {
  const dir = setupProjekt();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Eine Session, die ihre Arbeit tut: etwas im Bereich 'kit' aendern, pruefen,
// committen, die Karte nach In review ziehen — und sich im Session-Log vermerken.
const ARBEIT = 'echo arbeit > "kit/work-$NIGHT_ISSUE_ID.txt"';
const CHECKS_RUN = "node .claude/kit/checks.mjs run > /dev/null 2>&1";
const COMMIT = 'git add -A && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
const NACH_IN_REVIEW = 'node .claude/kit/board-echt.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
const LOG = 'echo "$NIGHT_ISSUE_ID" >> sessions.log';

function sessionen(dir) {
  return readFileSync(join(dir, "sessions.log"), "utf-8").trim().split("\n");
}

/** Der Text der Karte samt der angehaengten Kommentare des lokalen Trackers. */
function kartenText(dir, id) {
  const karte = board(dir, "issue", "get", String(id));
  return `${karte.body ?? ""}`;
}

test("[night-92] Nachtlauf: der Einzelabruf entscheidet — in_review an der Karte ist Erfolg, auch wenn die Sammelliste die Karte nicht fuehrt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir, "Ein Paket");
    const fake = [LOG, ARBEIT, CHECKS_RUN, COMMIT, NACH_IN_REVIEW].join("\n");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], {
      NIGHT_CLAUDE_CMD: fake,
      NIGHT_FAKE_LIST_IN_REVIEW_LEER: "1",
    });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Erfolg nach/, "die Runde haette als Erfolg gemeldet werden muessen");
    assert.doesNotMatch(res.stdout, /nicht in In review/, "die Runde wurde zurueckgestellt");
    assert.equal(board(dir, "issue", "get", id).status, "in_review", "die Karte liegt nicht in In review");
    assert.deepEqual(sessionen(dir), [id], "es lief nicht genau eine Session");
  });
});

test("[night-93] Nachtlauf: ein unlesbarer Kartenzustand aendert am Board nichts — kein Kommentar, kein Move, der Lauf faehrt fort", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const erstes = readyIssue(dir, "Erstes Paket");
    const zweites = readyIssue(dir, "Zweites Paket");

    // Der Marker liegt unter `.claude/` und ist von git ausgenommen: Er darf den
    // Rest-Guard nicht ausloesen, sonst stoppte der Lauf aus einem anderen Grund.
    // Nur die erste Session legt ihn — die zweite laeuft normal und belegt, dass der
    // Lauf weitergeht.
    const marker = join(dir, ".claude", "fake-get-unlesbar");
    const markiere = `if [ "$NIGHT_ISSUE_ID" = "${erstes}" ]; then echo x > ${JSON.stringify(marker)}; fi`;
    const fake = [LOG, ARBEIT, CHECKS_RUN, COMMIT, NACH_IN_REVIEW, markiere].join("\n");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], {
      NIGHT_CLAUDE_CMD: fake,
      NIGHT_FAKE_GET_UNLESBAR: marker,
    });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /nicht lesbar/i, "der Fall wird im Protokoll nicht benannt");

    // Keine Board-Mutation am ersten Paket: Es steht da, wo die Session es hingezogen
    // hat, und traegt keinen Kommentar des Runners.
    assert.equal(board(dir, "issue", "get", erstes).status, "in_review", "die Karte wurde verschoben");
    assert.doesNotMatch(kartenText(dir, erstes), /\*\*Kommentar\*\*/, "der Runner hat die Karte kommentiert");

    // Und der Lauf ging mit dem naechsten Issue weiter.
    assert.deepEqual(sessionen(dir), [erstes, zweites], "es liefen nicht beide Sessions");
  });
});

test("[night-94] Nachtlauf: ein anderer Zustand als in_review stellt zurueck wie bisher — Kommentar, Backlog-Move", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir, "Ein Paket");
    // Die Session zieht die Karte zurueck nach Ready und schliesst nichts ab.
    const fake = [LOG, 'node .claude/kit/board-echt.mjs issue move "$NIGHT_ISSUE_ID" ready > /dev/null'].join("\n");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /nicht in In review/, "der Rueckstellungsweg wurde nicht gemeldet");
    assert.equal(board(dir, "issue", "get", id).status, "backlog", "die Karte liegt nicht im Backlog");
    assert.match(kartenText(dir, id), /Nachtlauf:.*zurueckgestellt/, "der Rueckstellungs-Kommentar fehlt");
  });
});
