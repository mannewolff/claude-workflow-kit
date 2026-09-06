// E2E fuer den maschinenlesbaren Ergebnisstand des Nacht-Runners (Issue #486).
//
// Der Runner gibt sein Ergebnis bisher nur als Fliesstext aus; jede Umformulierung
// bricht eine Auswertung still. Dieses Paket legt Schema, Pfad und Schreiber an:
// Bei --verbose (und ohne --dry-run) entsteht nach den Vorflug-Pruefungen eine Datei
// .claude/night-run-<YYYY-MM-DD>-<HHMMSS>.json, deren erstes Feld die Schemafassung
// traegt. Ein Schreibfehler geht ins Textprotokoll und bricht den Lauf nie ab.
//
// Zweiter Teil und Voraussetzung: gitClean() nimmt .claude/night-run-* aus, sonst
// stoppte der Rest-Guard (#152) nach jeder erfolgreichen Runde hart.
//
// Issue #488 fuellt die Huelle: je Arbeitspaket eine Einheit — beim Ziehen mit
// unbekanntem Ausgang, nach der Runde ergaenzt um Ausgang, Dauer, Commit, End-Status,
// Pruefstand und Session-Kennzahlen. Dazu der Abschluss des Laufs (`regulaer` oder
// `harterStopp`) mit Fehlerklasse, den auch ein `fail()` noch setzt.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync } from "node:fs";
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

function setupProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
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

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Die Ergebnisstand-Dateien im Fixture, nach Namen sortiert. */
function staende(dir) {
  return readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
}

/** Der eine Ergebnisstand des Laufs — mehr als einer waere hier ein Fehler. */
function stand(dir) {
  const dateien = staende(dir);
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

/** Das Textprotokoll des Laufs liegt daneben und bleibt der Weg ins Detail. */
function textprotokollDa(dir) {
  return readdirSync(join(dir, ".claude")).some((n) => /^night-run-\d{4}-\d{2}-\d{2}\.log$/.test(n));
}

// --- Bausteine der Session-Fakes ---

const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
// Gezielt stagen statt `git add -A`: Die Board-Dateien und der Ergebnisstand sollen
// untracked bleiben, so wie sie es im echten Projekt sind.
const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
// Die Zusammenfassung schreibt hier der Fake selbst statt checks.mjs: Der Test misst,
// was der Runner aus der Datei macht, nicht wie sie entsteht.
const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}'`
  + " > .claude/checks-summary.json";
const SUMMARY_LEER = `printf '%s' '{"leeresPaket":true}' > .claude/checks-summary.json`;

// Die `result`-Zeile aus dem Fixture von test/night-kennzahlen.test.mjs — echte
// Feldnamen aus einer echten Session, gekuerzt in den Textfeldern. Sie enthaelt keine
// einfachen Anfuehrungszeichen und laesst sich darum im sh-Fake als Literal echoen.
const RESULT_ZEILE =
  '{"is_error":false,"duration_api_ms":296247,"num_turns":37,"stop_reason":"end_turn",' +
  '"session_id":"8945efcc","total_cost_usd":2.4124460000000005,' +
  '"usage":{"input_tokens":70,"output_tokens":17688,"service_tier":"standard"},' +
  '"modelUsage":{"claude-opus-5":{"costUSD":2.4124460000000005}},"permission_denials":[],' +
  '"result":"Abschlussbericht gekuerzt.","ttft_ms":2744,"time_to_request_ms":35,' +
  '"type":"result","duration_ms":382540,"uuid":"d967193f"}';
const RESULT_AUSGEBEN = `echo '${RESULT_ZEILE}'`;

test("[night-2] --verbose legt den Ergebnisstand an: schemaFassung 1 als erstes Feld, dazu erzeugtVon", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-neu-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);

    const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
    assert.equal(Object.keys(stand)[0], "schemaFassung", "schemaFassung muss das erste Feld sein");
    assert.equal(stand.schemaFassung, 1, "schemaFassung traegt die Zahl 1");
    assert.ok(typeof stand.erzeugtVon === "string" && stand.erzeugtVon.length > 0, "erzeugtVon nennt den Kit-Stand");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne --verbose entsteht keine Ergebnisstand-Datei", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-still-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(staende(dir), [], "ohne --verbose darf nichts geschrieben werden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mit --dry-run --verbose entsteht keine Ergebnisstand-Datei", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-dry-");
  try {
    readyIssue(dir, "Wird nur angezeigt");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(staende(dir), [], "ein Dry-Run schreibt nichts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zwei Laeufe am selben Tag hinterlassen zwei Ergebnisstand-Dateien", NUR_POSIX, async () => {
  const dir = setupProjekt("night-stand-zwei-");
  try {
    const erst = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(erst.status, 0, `${erst.stderr}\n${erst.stdout}`);
    // Die Uhrzeit im Namen loest auf Sekunden auf — ohne Wartezeit koennten beide
    // Laeufe denselben Namen treffen.
    await new Promise((fertig) => setTimeout(fertig, 1100));
    const zweit = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(zweit.status, 0, `${zweit.stderr}\n${zweit.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 2, `zwei Dateien erwartet, gefunden: ${dateien.join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein Schreibfehler des Ergebnisstands bricht den Lauf nicht ab, das Textprotokoll nennt ihn", NUR_POSIX, () => {
  // root ignoriert Verzeichnisrechte — der Schreibfehler waere nicht herstellbar.
  if (process.getuid?.() === 0) return;
  const dir = setupProjekt("night-stand-eacces-");
  const claudeDir = join(dir, ".claude");
  try {
    const id = readyIssue(dir, "Laeuft trotz Schreibfehler");
    // Die Tagesdatei des Textprotokolls vorab anlegen: Ihr Name ist vorhersagbar,
    // und POSIX erlaubt das Anhaengen an eine bestehende Datei auch in einem nicht
    // beschreibbaren Verzeichnis. Nur das Anlegen der JSON-Datei scheitert (EACCES).
    const logPfad = join(claudeDir, `night-run-${new Date().toISOString().slice(0, 10)}.log`);
    writeFileSync(logPfad, "", "utf-8");
    chmodSync(claudeDir, 0o555);

    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Schreibfehler darf den Lauf nicht abbrechen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Ergebnisstand konnte nicht geschrieben werden:/, "die Fehlerzeile fehlt auf der Konsole");
    assert.match(readFileSync(logPfad, "utf-8"), /Ergebnisstand konnte nicht geschrieben werden:/,
      "die Fehlerzeile fehlt im Textprotokoll");
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(id), "die Runde haette trotzdem durchlaufen muessen");
  } finally {
    chmodSync(claudeDir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-3] eine erfolgreiche Runde endet trotz untracked Ergebnisstand mit Exit 0", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-clean-");
  try {
    const id = readyIssue(dir, "Erfolgreiche Runde");
    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der untracked Ergebnisstand darf keinen harten Stopp ausloesen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /HARTER STOPP/, "der Rest-Guard haette nicht anschlagen duerfen");
    assert.match(res.stdout, new RegExp(`Erfolg[\\s\\S]*Issue #${id} in In review`), "die Runde haette als Erfolg gemeldet werden muessen");

    // Die Datei liegt wirklich untracked im Arbeitsbaum — sonst bewiese der Test nichts.
    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
    const status = run(dir, "git", ["status", "--porcelain"]);
    assert.match(status.stdout, new RegExp(`\\?\\? \\.claude/${dateien[0]}`), "die Datei muesste untracked sichtbar sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Die Einheiten je Arbeitspaket (Issue #488) ---

test("[night-4] ein erfolgreiches Paket steht mit Ausgang, Dauer, Commit, Pruefstand und Kennzahlen im Stand", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-erfolg-");
  try {
    const id = readyIssue(dir, "Erfolgreiches Paket");
    const fake = [RESULT_AUSGEBEN, SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "erfolg");
    assert.equal(e.titel, "Erfolgreiches Paket", "die Einheit nennt den Titel des Pakets");
    assert.equal(typeof e.dauerMs, "number", `dauerMs muss eine Zahl sein, ist ${JSON.stringify(e.dauerMs)}`);
    assert.ok(typeof e.commit === "string" && e.commit.length > 0, "der Commit-Hash fehlt");
    assert.equal(e.endStatus, "in_review", "der End-Status kommt vom Board");
    assert.equal(e.pruefung.zustand, "geprueft");
    // Ohne diesen Fall saehe ein vergessener leseKennzahlen-Aufruf aus wie ein korrekter.
    assert.equal(e.kennzahlen.kostenUsd, 2.4124460000000005, "die Kosten stammen aus der result-Zeile");
    assert.equal(e.kennzahlen.zuege, 37);
    assert.equal(stand(dir).abschluss, "regulaer", "ein sauber beendeter Lauf traegt regulaer");
    assert.ok(textprotokollDa(dir), "das Textprotokoll liegt weiterhin daneben");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne result-Zeile bleiben die Kennzahlen null", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-ohnekennzahlen-");
  try {
    const id = readyIssue(dir, "Session ohne result-Ereignis");
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(einheit(dir, id).kennzahlen, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Der Kernfall des Pakets: Ein Erfolg deckt den Pruefstand nicht zu. Bewusst zwei
// GRUENE Ausgaenge — ein Paar aus gruen und rot bewiese nichts, weil ein roter
// Nachweis seit Issue #471 ohnehin als Fehlschlag endet und die Ausgaenge sich
// schon dadurch unterschieden.
test("zwei erfolgreiche Pakete mit verschiedenem Pruefstand: gleicher Ausgang, verschiedener Zustand", NUR_POSIX, () => {
  const laeufe = [
    { praefix: "night-stand-kern-gruen-", summary: SUMMARY_GRUEN, zustand: "geprueft" },
    { praefix: "night-stand-kern-leer-", summary: SUMMARY_LEER, zustand: "leeresPaket" },
  ];
  const beobachtet = [];
  for (const lauf of laeufe) {
    const dir = setupProjekt(lauf.praefix);
    try {
      const id = readyIssue(dir, "Paket");
      const fake = [lauf.summary, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
      const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
      assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
      const e = einheit(dir, id);
      beobachtet.push({ ausgang: e.ausgang, zustand: e.pruefung.zustand });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  assert.equal(beobachtet[0].ausgang, "erfolg");
  assert.equal(beobachtet[1].ausgang, beobachtet[0].ausgang, "beide Pakete sind ein Erfolg");
  assert.equal(beobachtet[0].zustand, "geprueft");
  assert.equal(beobachtet[1].zustand, "leeresPaket");
  assert.notEqual(beobachtet[1].zustand, beobachtet[0].zustand, "der Pruefstand unterscheidet sie");
});

test("ein zurueckgestelltes Paket erscheint als eigene Einheit mit Grund, nicht nur als Zaehler", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-gate-");
  try {
    const id = readyIssue(dir, "[Idee] Roher Einfall");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "zurueckgestellt");
    assert.match(e.grund, /Idee/, `der Grund nennt das Gate nicht: ${e.grund}`);
    assert.equal(stand(dir).abschluss, "regulaer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der abgeschlossene harte Stopp (Issue #488) ---

test("ein Abbruch waehrend der Runde hinterlaesst harterStopp, Fehlerklasse tracker und das gezogene Paket unbekannt", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-tracker-");
  try {
    const id = readyIssue(dir, "Abbruch mitten in der Runde");
    // Board bewegen, dann den Tracker unter dem Runner wegziehen: Der erste
    // board()-Aufruf in werteRunde scheitert, fail() greift.
    const fake = [NACH_IN_REVIEW, "rm .claude/kit/board.mjs"].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.notEqual(res.status, 0, `der Lauf haette abbrechen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp", "ein erkannter Stopp darf nicht wie ein Absturz aussehen");
    assert.equal(s.fehlerklasse, "tracker");
    assert.ok(typeof s.fehlerText === "string" && s.fehlerText.length > 0, "der Fehlertext fehlt");
    const e = einheit(dir, id);
    assert.equal(e.ausgang, "unbekannt", "die Runde wurde nie bewertet");
    assert.equal(e.commit ?? null, null, "ohne Bewertung gibt es keinen Commit im Stand");
    assert.ok(textprotokollDa(dir), "das Textprotokoll liegt weiterhin daneben");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("der Rest-Guard hinterlaesst harterStopp und das Paket mit Ausgang harterStopp, Commit und Pruefstand", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-restguard-");
  try {
    const id = readyIssue(dir, "Runde mit Resten");
    // Erfolgreiche Runde, danach ein unkommittierter Rest: Der Rest-Guard (#152)
    // stoppt hart, obwohl die Runde selbst bewertet wurde.
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW, "echo rest > rest.txt"].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.notEqual(res.status, 0, `der Rest-Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp");
    assert.equal(s.fehlerklasse, "harterStopp");
    const e = einheit(dir, id);
    assert.equal(e.ausgang, "harterStopp", "hier wurde die Runde bewertet — nicht unbekannt");
    assert.ok(typeof e.commit === "string" && e.commit.length > 0, "der Commit der Runde fehlt");
    assert.equal(e.pruefung.zustand, "geprueft", "der Pruefstand der Runde fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein Vorflug-Abbruch traegt die Fehlerklasse zustand", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-vorflug-");
  try {
    // Ein unsauberer Baum vor dem Lauf: vorbereiten() bricht ab, noch bevor eine
    // Session startet. Der Stand existiert trotzdem und benennt den Grund.
    writeFileSync(join(dir, "unsauber.txt"), "schon vorher da\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.notEqual(res.status, 0, `der Vorflug haette abbrechen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp");
    assert.equal(s.fehlerklasse, "zustand");
    assert.deepEqual(s.einheiten, [], "vor der ersten Session gibt es keine Einheiten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
