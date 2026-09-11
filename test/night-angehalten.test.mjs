// E2E fuer den Rundenausgang `angehalten` des Nacht-Runners (Issue #572).
//
// Ein `[Task]`, bei dem waehrend der Umsetzung doch eine Abwaegung auftaucht, haelt an:
// Die Session zeichnet die Karte mit kit:klaeren, benennt die Entscheidung in einem
// Kommentar mit festem Folgesatz und schiebt das Issue zurueck nach Backlog. Bis
// hierher sah der Runner davon nur "nicht in In review" und verbuchte die Runde als
// Rueckstellung — also genau die Verwechslung mit einem technischen Fehlschlag, die
// der eigene Ausgang ausschliesst.
//
// Der Ausgang setzt einen VOLLSTAENDIG nachgewiesenen Halt voraus: sauberer
// Arbeitsbaum, Label, ein WAEHREND der Session hinzugekommener Kommentar mit dem
// Folgesatz und Status Backlog. Fehlt eine der Spuren, gilt der bisherige
// Rueckstellungsweg — eine Session kann nach dem Label und vor Kommentar oder Move
// abbrechen, und ein halber Uebergang ist kein Halt.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Die Konstante aus dem Runner selbst, nicht abgeschrieben (Issue #572): Der
// Session-Fake soll genau den Satz schreiben, an dem der Runner den Halt erkennt.
// Eine Abschrift im Test bliebe gruen, waehrend Skill und Runner auseinanderliefen.
import { HALT_FOLGESATZ, KLAEREN_LABEL } from "../kit/night.mjs";

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

function setupProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/checks-summary.json\nsessions.log\n");
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

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Der eine Ergebnisstand des Laufs — mehr als einer waere hier ein Fehler. */
function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Die Einheit zu einem Issue — der Zugriff ueber die ID, nicht ueber die Position. */
function einheit(dir, id) {
  const s = stand(dir);
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

// --- Bausteine der Session-Fakes ---

const BOARD = "node .claude/kit/board.mjs";
const PROTOKOLL = (sessionLog) => `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}`;
const LABEL_SETZEN = `${BOARD} issue label add "$NIGHT_ISSUE_ID" ${KLAEREN_LABEL} > /dev/null`;
const NACH_BACKLOG = `${BOARD} issue move "$NIGHT_ISSUE_ID" backlog > /dev/null`;
const NACH_IN_REVIEW = `${BOARD} issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
const kommentar = (text) => `${BOARD} issue comment "$NIGHT_ISSUE_ID" --text ${JSON.stringify(text)} > /dev/null`;
// Die Zusammenfassung schreibt hier der Fake selbst statt checks.mjs: Ohne sie griffe
// am regulaer erfolgreichen Issue der Nachweis-Guard (#471), und der Vergleichsfall
// waere keiner mehr. Der angehaltene Vorgang braucht sie nicht — er hat nichts gebaut.
const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}'`
  + " > .claude/checks-summary.json";

// Der Kommentar, den eine anhaltende Session schreibt: die aufgetauchte Entscheidung
// und der feste Folgesatz, an dem der Runner sie erkennt.
const HALT_TEXT = `Beim Umsetzen tauchte eine Abwaegung auf: zwei vertretbare Schnitte. ${HALT_FOLGESATZ}`;

/** Der vollstaendige Halt: Label, Kommentar mit Folgesatz, Backlog — Baum bleibt sauber. */
function haltFake(sessionLog) {
  return [PROTOKOLL(sessionLog), LABEL_SETZEN, kommentar(HALT_TEXT), NACH_BACKLOG].join(" && ");
}

/** Haelt nur am ersten Issue an; jedes weitere laeuft regulaer durch. */
function nurBeim(ersteId, wennErste, sonst) {
  return `if [ "$NIGHT_ISSUE_ID" = ${JSON.stringify(String(ersteId))} ]; then ${wennErste}; else ${sonst}; fi`;
}

/** Die Kommentare, die am Issue haengen — der lokale Tracker haengt sie an den Body. */
function kommentarZahl(dir, id) {
  const body = board(dir, "issue", "get", String(id)).body || "";
  return (body.match(/\*\*Kommentar\*\*/g) || []).length;
}

test("[night-13] Nachtlauf: ein vollstaendiger Halt wird als angehalten verbucht, der Lauf geht weiter", NUR_POSIX, () => {
  const dir = setupProjekt("night-halt-voll-");
  try {
    const erstes = readyIssue(dir, "[Task] Haelt an");
    const zweites = readyIssue(dir, "Laeuft durch");

    const sessionLog = join(dir, "sessions.log");
    const fake = nurBeim(erstes,
      haltFake(sessionLog),
      [PROTOKOLL(sessionLog), SUMMARY_GRUEN, NACH_IN_REVIEW].join(" && "));

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    // Kein Abbruch: Der Halt ist kein Fehler, der Lauf macht mit dem naechsten Issue weiter.
    assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /angehalten: eine offene Entscheidung wartet auf einen Menschen/,
      "die eigene Log-Zeile des Halts fehlt");
    assert.doesNotMatch(res.stdout, /Session ohne In-review-Ergebnis beendet/,
      "der Halt wurde als Rueckstellung verbucht");
    assert.match(res.stdout, /1 erfolgreich, 0 zurueckgestellt, 0 ohne gueltigen Nachweis, 2 Session\(s\) gestartet, 1 angehalten\./,
      `die Abschlusszeile zaehlt den Halt nicht: ${res.stdout}`);

    // Beide Sessions liefen, das zweite Issue ging regulaer nach In review.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [erstes, zweites], "es liefen nicht beide Sessions");
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.deepEqual(inReview, [zweites], "das zweite Issue haette in In review landen muessen");

    // Die angehaltene Karte liegt genau so da, wie die Session sie hinterlassen hat:
    // Backlog, gezeichnet, mit EINEM Kommentar. Ein zweiter waere die zweite Wahrheit.
    const karte = board(dir, "issue", "get", erstes);
    assert.equal(karte.status, "backlog", "die angehaltene Karte liegt nicht im Backlog");
    assert.ok((karte.labels || []).includes(KLAEREN_LABEL), "das Label wurde entfernt");
    assert.equal(kommentarZahl(dir, erstes), 1, "der Runner hat einen zweiten Kommentar geschrieben");
    assert.doesNotMatch(karte.body || "", /Nachtlauf:/, "der Runner hat an der angehaltenen Karte kommentiert");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-4] Nachtlauf: der Ergebnisstand traegt die angehaltene Einheit mit Ausgang angehalten", NUR_POSIX, () => {
  const dir = setupProjekt("night-halt-stand-");
  try {
    const erstes = readyIssue(dir, "[Task] Haelt an");

    const sessionLog = join(dir, "sessions.log");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: haltFake(sessionLog) });
    assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, erstes);
    assert.equal(e.ausgang, "angehalten", `die Einheit traegt den falschen Ausgang: ${JSON.stringify(e)}`);
    assert.equal(e.endStatus, "backlog", "der End-Status der Einheit stimmt nicht");
    assert.equal(stand(dir).schemaFassung, 1, "die Schemafassung bleibt unveraendert");
    assert.equal(stand(dir).abschluss, "regulaer", "der Lauf haette regulaer abschliessen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-14] Nachtlauf: Halt mit unsauberem Baum loest keinen Salvage aus und stoppt hart", NUR_POSIX, () => {
  const dir = setupProjekt("night-halt-dirty-");
  try {
    const erstes = readyIssue(dir, "[Task] Haelt an, laesst aber liegen");
    const zweites = readyIssue(dir, "Kommt nicht mehr dran");

    const sessionLog = join(dir, "sessions.log");
    // Derselbe Halt wie oben, aber die Session laesst eigene Aenderungen liegen.
    const fake = `${haltFake(sessionLog)} && echo rest > .tmp-report.md`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, `night.mjs haette hart stoppen muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /HALT MIT UNSAUBEREM BAUM nach [\d.]+ min: Issue #\d+ traegt kit:klaeren, aber der Working Tree ist dirty — kein Salvage, harter Stopp\./,
      `die eigene Zeile des Halt-Stopps fehlt: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /SALVAGE-VERSUCH/, "an einer angehaltenen Karte darf kein Salvage laufen");

    // Genau eine Session: Ein Salvage-Versuch wuerde den Fake ein zweites Mal starten.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [erstes], "es lief nicht genau eine Session");
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.deepEqual(ready, [zweites], "das zweite Issue haette unangetastet bleiben muessen");

    // Der harte Stopp verhaelt sich wie jeder andere: Board-Kommentar und hinterlegter Grund.
    const karte = board(dir, "issue", "get", erstes);
    assert.match(karte.body || "", /Nachtlauf: Halt mit unsauberem Working Tree/,
      "der Board-Kommentar des Stopps fehlt");
    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp", "der Lauf haette als harter Stopp abschliessen muessen");
    assert.equal(s.fehlerklasse, "harterStopp", "die Fehlerklasse des Stopps fehlt");
    assert.equal(String(s.fehlerEinheit), erstes, "der Stopp verweist nicht auf die betroffene Einheit");
    assert.match(einheit(dir, erstes).grund || "", /HALT MIT UNSAUBEREM BAUM/,
      "der Grund des Stopps haengt nicht an der Einheit");
    assert.match(einheit(dir, erstes).grund || "", /\.tmp-report\.md/,
      "der Grund nennt die liegengebliebene Datei nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-13] Nachtlauf: ein Abbruch nach dem Label, vor Kommentar und Move, ist kein Halt", NUR_POSIX, () => {
  const dir = setupProjekt("night-halt-halb-");
  try {
    const erstes = readyIssue(dir, "[Task] Bricht nach dem Label ab");

    const sessionLog = join(dir, "sessions.log");
    const fake = [PROTOKOLL(sessionLog), LABEL_SETZEN].join(" && ");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /0 erfolgreich, 1 zurueckgestellt, 0 ohne gueltigen Nachweis, 1 Session\(s\) gestartet, 0 angehalten\./,
      `der halbe Uebergang haette zurueckgestellt werden muessen: ${res.stdout}`);
    assert.equal(einheit(dir, erstes).ausgang, "zurueckgestellt", "die Einheit traegt den falschen Ausgang");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-13] Nachtlauf: ein Kommentar von vor der Session belegt den Halt nicht", NUR_POSIX, () => {
  const dir = setupProjekt("night-halt-alt-");
  try {
    const erstes = readyIssue(dir, "[Task] Trug den Folgesatz schon vorher");
    // Der Folgesatz steht schon vor der Session an der Karte — aus einem frueheren Lauf.
    board(dir, "issue", "comment", erstes, "--text", HALT_TEXT);

    const sessionLog = join(dir, "sessions.log");
    // Diese Session zeichnet und schiebt, schreibt aber nur einen Kommentar OHNE Folgesatz.
    const fake = [PROTOKOLL(sessionLog), LABEL_SETZEN, kommentar("Zwischenstand ohne Folgesatz."), NACH_BACKLOG].join(" && ");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /0 erfolgreich, 1 zurueckgestellt, 0 ohne gueltigen Nachweis, 1 Session\(s\) gestartet, 0 angehalten\./,
      `der alte Kommentar haette den Halt nicht belegen duerfen: ${res.stdout}`);
    assert.equal(einheit(dir, erstes).ausgang, "zurueckgestellt", "die Einheit traegt den falschen Ausgang");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-13] Nachtlauf: ein neuer Kommentar ohne den festen Folgesatz belegt den Halt nicht", NUR_POSIX, () => {
  const dir = setupProjekt("night-halt-ohne-satz-");
  try {
    const erstes = readyIssue(dir, "[Task] Kommentiert ohne Folgesatz");

    const sessionLog = join(dir, "sessions.log");
    const fake = [PROTOKOLL(sessionLog), LABEL_SETZEN, kommentar("Hier ist eine Abwaegung aufgetaucht."), NACH_BACKLOG].join(" && ");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /0 erfolgreich, 1 zurueckgestellt, 0 ohne gueltigen Nachweis, 1 Session\(s\) gestartet, 0 angehalten\./,
      `ein Kommentar ohne Folgesatz haette den Halt nicht belegen duerfen: ${res.stdout}`);
    assert.equal(einheit(dir, erstes).ausgang, "zurueckgestellt", "die Einheit traegt den falschen Ausgang");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
