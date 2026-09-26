// Der Pruefnachweis gilt nur, wenn er zum Commit des Pakets gehoert (Issue #865).
//
// Lauf #118 meldete ein Paket als Fehlschlag ("in In review, aber Nachweis rot"),
// obwohl der Commit gruen geprueft war: Die Session hatte NACH dem Commit eine
// weitere Pruefung angestossen und abgebrochen, und deren Zwischenfassung stand
// danach in `.claude/checks-summary.json`. Der Runner las die AKTUELLE Datei, ohne
// zu fragen, ob sie den abgelieferten Stand gemessen hat.
//
// E2E wie test/night-checks-bericht.test.mjs, und aus demselben Grund mit dem
// ECHTEN checks.mjs: Die Kopplung zwischen der Datei, die checks.mjs schreibt, und
// dem, was der Runner daraus macht, ist genau der Gegenstand dieser Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

// Ein einziger Pflichtcheck, der drei Dinge kann: hinhalten (`.probe`), scheitern
// (`.rot`) und sich protokollieren. Die Protokolldatei ist das Mass dafuer, wie oft
// geprueft wurde — daran haengt die Aussage "es wurde NICHT nachgeprueft".
//
// Der Hinhalte-Zweig endet mit `exit 0`, statt danach weiterzulaufen: Der Abbruch
// toetet checks.mjs, nicht das Kommando — ein durchlaufender Zweig traege seinen
// Eintrag verwaist nach und verfaelschte die Zaehlung.
const KIT_CHECK = {
  cmd: "if [ -f .probe ]; then sleep 5; exit 0; fi; if [ -f .rot ]; then exit 1; fi; echo kit >> checklauf.log",
  areas: ["kit"],
};
// Der Bereich 'board' ist bewusst keinem Check zugeordnet: Board-Moves sind beim
// lokalen Tracker Dateiaenderungen unter issues/, und eine Datei ohne Muster loeste
// in checks.mjs den vollen Umfang aus.
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

function setupProjekt(buildChecks = [KIT_CHECK]) {
  const dir = mkdtempSync(join(tmpdir(), "night-nachweis-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    checkAreas: CHECK_AREAS,
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"),
    ".claude/*\n!.claude/workflow.config.json\nsessions.log\nchecklauf.log\nspaet.log\nguete.log\n.probe\n.rot\n");
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
  // Den Board-Stand committen: Sonst zaehlten die untrackten issues/*.md zum
  // Arbeitspaket der Session — ein Zustand, den ein installiertes Projekt nicht hat.
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
  assert.equal(run(dir, "git", ["commit", "-q", "-m", "Issues"]).status, 0);
  return String(issue.id);
}

function mitProjekt(fn, buildChecks) {
  const dir = setupProjekt(buildChecks);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Die Einheit zu einem Issue aus dem einen Ergebnisstand des Laufs. */
function einheit(dir, id) {
  const dateien = readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet: ${dateien.join(", ")}`);
  const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
  const treffer = stand.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id}: ${JSON.stringify(stand.einheiten)}`);
  return treffer;
}

/** Wie oft der Pflichtcheck gelaufen ist. */
function checklaeufe(dir) {
  const p = join(dir, "checklauf.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean).length : 0;
}

const ARBEIT = 'echo arbeit > "kit/work-$NIGHT_ISSUE_ID.txt"';
const CHECKS_RUN = "node .claude/kit/checks.mjs run > /dev/null 2>&1";
const COMMIT = 'git add -A && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';

// Der Ablauf aus Issue #857: nach dem Commit noch einmal `checks.mjs run` starten und
// abbrechen. `.probe` laesst den Pflichtcheck hinhalten, damit der Abbruch den Lauf
// zuverlaessig mittendrin trifft — checks.mjs hat dann bereits eine Fassung mit
// `abgeschlossen: false` und `nicht gestartet` hinterlassen.
const ABGEBROCHENE_PROBE = [
  "touch .probe",
  // Etwas im Bereich 'kit', damit die Probe ueberhaupt ein Kommando waehlt: Nach dem
  // Commit ist sonst nichts veraendert, und checks.mjs endete sofort mit leeresPaket.
  "touch kit/probe.txt",
  "node .claude/kit/checks.mjs run > /dev/null 2>&1 &",
  "PROBE_PID=$!",
  "sleep 1",
  "kill -9 $PROBE_PID",
  "rm -f .probe kit/probe.txt",
].join("\n");

test("[night-865] ein gruen gepruefter Commit gilt auch dann, wenn danach eine abgebrochene Probe die Zusammenfassung ueberschreibt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = [ARBEIT, CHECKS_RUN, COMMIT, ABGEBROCHENE_PROBE, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /Fehlschlag/, `die Runde haette Erfolg sein muessen:\n${res.stdout}`);
    assert.ok(board(dir, "issue", "list", "--status", "in_review").some((i) => String(i.id) === id),
      "das Issue haette in In review bleiben muessen");

    const e = einheit(dir, id);
    assert.equal(e.pruefung.zustand, "nachgeprueft", `Pruefstand: ${JSON.stringify(e.pruefung)}`);
    assert.equal(e.pruefung.nachweisFremd, true, "die Einheit weist den fremden Nachweis nicht aus");
    const zeile = res.stdout.split("\n").find((z) => z.includes(`Issue #${id}`) && /nachgeprueft/.test(z));
    assert.ok(zeile, `keine Pruefzeile mit dem neuen Zustand:\n${res.stdout}`);
    assert.match(zeile, /Nachweis gehoerte nicht zum Commit/, `der Grund fehlt in der Zeile: ${zeile}`);
    assert.equal(checklaeufe(dir), 2, "die Nachpruefung haette den Pflichtcheck genau einmal zusaetzlich fahren muessen");
  });
});

test("[night-865] ein Nachweis, der zum Commit passt, bleibt 'geprueft' und wird nicht nachgeprueft", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = [ARBEIT, CHECKS_RUN, COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const e = einheit(dir, id);
    assert.equal(e.pruefung.zustand, "geprueft", `Pruefstand: ${JSON.stringify(e.pruefung)}`);
    assert.equal(e.pruefung.nachweisFremd, undefined, "ein passender Nachweis traegt keinen Vermerk");
    assert.equal(checklaeufe(dir), 1, "der Pflichtcheck haette genau einmal laufen duerfen (keine Nachpruefung)");
  });
});

test("[night-865] eine rote Nachpruefung macht die Runde zum Fehlschlag und nennt den fremden Nachweis", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    // `.rot` wirkt erst auf die Nachpruefung — der Lauf der Session selbst war gruen.
    const fake = [ARBEIT, CHECKS_RUN, COMMIT, ABGEBROCHENE_PROBE, "touch .rot", NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const e = einheit(dir, id);
    assert.equal(e.pruefung.zustand, "rot", `Pruefstand: ${JSON.stringify(e.pruefung)}`);
    assert.equal(e.pruefung.nachweisFremd, true, "die Einheit weist den fremden Nachweis nicht aus");
    assert.match(res.stdout, /Fehlschlag/, `die Runde haette Fehlschlag sein muessen:\n${res.stdout}`);
  });
});

test("[night-865] ohne Commit bleibt der Pruefstand, was er war — es gibt nichts zu vergleichen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    // Keine Arbeit, kein Commit: Die Session prueft und bewegt nur das Board.
    const fake = [CHECKS_RUN, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const e = einheit(dir, id);
    assert.equal(e.commit, null, "ohne eigenen Commit traegt die Einheit keinen");
    assert.ok(["geprueft", "leeresPaket"].includes(e.pruefung.zustand), `Pruefstand: ${JSON.stringify(e.pruefung)}`);
    assert.equal(e.pruefung.nachweisFremd, undefined, "ohne Commit wird nichts als fremd vermerkt");
    assert.equal(checklaeufe(dir), 0, "ohne beruehrten Bereich haette gar nichts laufen duerfen");
  });
});

test("[night-865] eine Loeschung im Commit wird als geprueft erkannt und loest keine Nachpruefung aus", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = ['git rm -q "kit/bestand.txt"', CHECKS_RUN, COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const e = einheit(dir, id);
    assert.equal(e.pruefung.zustand, "geprueft", `Pruefstand: ${JSON.stringify(e.pruefung)}`);
    assert.equal(e.pruefung.nachweisFremd, undefined, "eine geloeschte Datei ist kein fremder Nachweis");
    assert.equal(checklaeufe(dir), 1, "der Pflichtcheck haette genau einmal laufen duerfen (keine Nachpruefung)");
  });
});

// Der Umfang der Nachpruefung (Issue #950, Plan #944, E14).
//
// Die Nachpruefung vollzieht den Abschluss der Karte nach, den sie nicht glauben kann —
// also faehrt sie genau dessen Umfang. Eine Nachpruefung, die MEHR faehrt, waere ein
// zweiter Weg ueber denselben Vorgang, und sie kostete nachts gerade die teuerste
// Gruppe: die, die wegen ihrer Laufzeit vom Abschluss ausgenommen wurde.
//
// Die beiden ausgelassenen Eintraege liegen im Bereich 'frontend', den die Session nicht
// anfasst — so kann ihre Protokolldatei nur von der Nachpruefung stammen, und ihr Fehlen
// belegt die Auslassung ohne Quelltext-Grep (verifyChecksForSalvage und nachpruefLaufen
// sind nicht exportiert).
const SPAETER_CHECK = { cmd: "echo spaet >> spaet.log", areas: ["frontend"], nichtBeimAbschluss: "zusammenspiel" };
const GUETE_CHECK = {
  cmd: "echo 'Killed 42 (84%)' >> guete.log",
  areas: ["frontend"],
  guete: { muster: String.raw`\((\d+)%\)`, marke: 80 },
};

test("[night-950] die Nachpruefung laesst nichtBeimAbschluss und Guetemessung aus — der Abschlussumfang", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = [ARBEIT, CHECKS_RUN, COMMIT, ABGEBROCHENE_PROBE, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    const e = einheit(dir, id);
    assert.equal(e.pruefung.nachweisFremd, true, "ohne Nachpruefung sagt dieser Test nichts");
    assert.equal(e.pruefung.zustand, "nachgeprueft", `Pruefstand: ${JSON.stringify(e.pruefung)}`);

    const gefahren = e.pruefung.laufen.map((l) => l.cmd);
    assert.deepEqual(gefahren, [KIT_CHECK.cmd],
      `die Nachpruefung haette nur den Abschlussumfang fahren duerfen, tatsaechlich: ${gefahren.join(" | ")}`);
    assert.ok(!existsSync(join(dir, "spaet.log")),
      "die Pruefung mit nichtBeimAbschluss ist in der Nachpruefung gelaufen");
    assert.ok(!existsSync(join(dir, "guete.log")),
      "die Guetemessung ist in der Nachpruefung gelaufen — ihr Anteil braucht die vollstaendige Testmenge");
    assert.equal(checklaeufe(dir), 2, "der Abschluss-Check haette genau einmal zusaetzlich laufen muessen");
  }, [KIT_CHECK, SPAETER_CHECK, GUETE_CHECK]);
});
