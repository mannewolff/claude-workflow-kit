// Ablauf-Pruefung: Ein Zeitabbruch entsteht erst, wenn der Runner die Session samt
// Prozessgruppe an der Uhr toetet; Vermerk, Salvage und Einheit haengen an diesem Ablauf.
// Den Vermerkstext selbst prueft night-wartend-zeitlimit-vermerk im selben Prozess.
//
// Der Zeitabbruch an der Karte (Issue #977, Plan #974).
//
// Issue #976 hat den Vermerkstext gebaut, aber niemand schrieb ihn an eine Karte: Im
// sauberen Zweig stand nach einem Zeitabbruch nur `Nachtlauf: <DEFERRED_GRUND>`, im
// unsauberen der Stopp-Grund ohne jede Auskunft ueber den Stand, nach gelungenem Salvage
// gar nichts. Diese Datei haelt fest, was in allen drei Zweigen an der Karte steht und
// welches Feld die Einheit des Ergebnisstands traegt.
//
// Vier Zweige, vier Aussagen:
//   night-977-1 — sauberer Baum am Zeitlimit: Vermerk, Backlog-Move, Rueckstellung
//   night-977-2 — unsauberer Baum: harter Stopp, Vermerk am bestehenden Kommentar
//   night-977-3 — gescheiterter Salvage: derselbe Vermerk, obwohl der Zweig frueher kehrt
//   night-977-4 — gelungener Salvage: EIN Satz, keine Empfehlung, kein Feld
//
// Das Zeitlimit wird ueber `NIGHT_TIMEOUT_MS` erzwungen — es gilt dabei auch fuer die
// Salvage-Session, deren Fake darum nur kurz arbeitet.
//
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD — dieselbe Anlage wie `ablauf-night-wartend-runde.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { ZEITLIMIT_ANKER, WARTEND_ANKER } from "../kit/night/wartend.mjs";

import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

// Das erzwungene Zeitlimit der Runde. Grosszuegig genug, dass die Salvage-Session unter
// demselben Limit ihren Commit und ihren Board-Zug schafft — `NIGHT_TIMEOUT_MS` gilt fuer
// jede Session des Laufs, auch fuer sie.
const TIMEOUT_MS = 2500;

// Der Wortlaut der Konstanten, hier ein zweites Mal — dieselbe Linie wie in
// `ablauf-night-wartend-runde.test.mjs`: Der Test ist die Gegenprobe zur Konstanten.
const ZEITLIMIT_WORTLAUT = "Grund: Session am Zeitlimit beendet";
const DEFERRED_WORTLAUT =
  "Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter.";

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix, buildChecks) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  // Die Salvage-Vorpruefung faehrt `checks.mjs run` im Zielprojekt; ohne die Datei gaebe
  // es keine Pflicht-Pruefung und damit keinen Rettungsversuch.
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/night-run-*.json\n.claude/checks-summary.json\n");
  lfAttribute(join(dir, ".gitattributes"));
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.com"]],
    ["git", ["config", "user.name", "Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-qm", "Fixture"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")}: ${res.stderr}`);
  }
  return dir;
}

function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Die eine Ergebnisstand-Datei des Laufs — mehr als eine waere hier ein Fehler. */
function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Die Einheit zu einem Issue — der Zugriff ueber die ID, nicht ueber die Position. */
function einheit(dir, id) {
  const treffer = stand(dir).einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id}`);
  return treffer;
}

/** Der Body der Karte — beim lokalen Tracker haengen die Kommentare darin. */
function karte(dir, id) {
  return board(dir, "issue", "get", String(id));
}

// Eine `assistant`-Zeile mit einer Fortschrittsmeldung, wie sie eine Sitzung unterwegs
// schreibt (Issue #975, #981). Am Zeitlimit ist sie das Einzige, was vom Stand bleibt.
const fortschrittZeile = (text) =>
  `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]}}`;

const AK1 = "FORTSCHRITT: AK1 — Testdatei liegt rot";

/** Ein `result`-Ereignis mit Schlusstext — fuer die Gegenprobe ohne Zeitabbruch. */
const resultZeileMitText = (stopReason, text) =>
  `{"type":"result","is_error":false,"stop_reason":${JSON.stringify(stopReason)},` +
  `"total_cost_usd":0.5,"duration_api_ms":1000,"num_turns":7,"result":${JSON.stringify(text)}}`;

// --- night-977-1: der saubere Zweig ---

test("[night-977-1] ein Zeitabbruch bei sauberem Baum traegt Vermerk, Grund und Feld — die Karte geht wie bisher ins Backlog", () => {
  const dir = setupProjekt("night-zeit-sauber-", ["true"]);
  try {
    const id = readyIssue(dir, "Laeuft in das Zeitlimit, ohne etwas anzufassen");
    // Meldet erst seinen Stand, dann haengt er: sauberer Baum, erzwungenes Zeitlimit.
    const fake = `echo '${fortschrittZeile(AK1)}'; sleep 30 # haengt`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: fake,
      NIGHT_TIMEOUT_MS: String(TIMEOUT_MS),
      NIGHT_KILL_GRACE_MS: "300",
    });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    // Der Grund steht VOR dem Zustand — dieselbe Ordnung wie beim wartenden Fall.
    assert.ok(res.stdout.includes(ZEITLIMIT_WORTLAUT), `der Grund fehlt im Protokoll:\n${res.stdout}`);
    assert.match(res.stdout, /nicht in In review, Tree sauber/, `der Zustandstext ist verschwunden:\n${res.stdout}`);

    const body = karte(dir, id).body;
    assert.ok(body.includes(ZEITLIMIT_ANKER), `der Anker fehlt am Paket:\n${body}`);
    assert.ok(body.includes(ZEITLIMIT_WORTLAUT), `der Fall steht nicht im Wortlaut am Paket:\n${body}`);
    assert.ok(body.includes(AK1), `der Stand nach eigener Auskunft fehlt am Paket:\n${body}`);
    assert.match(body, /Empfehlung \(keine Vorgabe\)/, `die Empfehlung fehlt am Paket:\n${body}`);
    assert.match(body, /keine Aussage ueber seine Ursache/, `der Ursachen-Vorbehalt fehlt am Paket:\n${body}`);
    assert.ok(!body.includes(DEFERRED_WORTLAUT), `der alte Grund steht noch am Paket:\n${body}`);
    // Die Grenze ist die WIRKSAME der Runde, nicht `--timeout-min`: 2500 ms sind 0,0 min
    // gerundet — darum die eine Nachkommastelle aus `grenzeText`.
    assert.match(body, new RegExp(`die Grenze dieser Runde: ${(TIMEOUT_MS / 60000).toFixed(1)} Minuten`),
      `die wirksame Grenze fehlt am Paket:\n${body}`);
    // Im sauberen Zweig gibt es keine Reste, und eine Meldung ueber nichts ist keine.
    assert.doesNotMatch(body, /Im Arbeitsverzeichnis/, `der Vermerk meldet Reste, die es nicht gibt:\n${body}`);

    assert.equal(karte(dir, id).status, "backlog", "die Karte gehoert weiterhin ins Backlog");
    const e = einheit(dir, id);
    assert.equal(e.ausgang, "zurueckgestellt", "der Ausgang bleibt die Rueckstellung");
    assert.equal(e.zeitlimitBeendet, true, "das Feld des Zeitabbruchs fehlt an der Einheit");
    // Hinten angehaengt: Reihenfolge und Namen der bestehenden Felder sind der Vertrag
    // mit den Auswertungen.
    assert.equal(Object.keys(e).at(-1), "zeitlimitBeendet",
      `das neue Feld steht nicht hinten: ${Object.keys(e).join(", ")}`);
    assert.deepEqual(
      Object.keys(e).slice(0, 7),
      ["id", "titel", "modell", "modellHerkunft", "modellGrund", "stufe", "stufeVerwendet"],
      `die Feldreihenfolge der Einheit hat sich verschoben: ${Object.keys(e).join(", ")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-977-1] dieselbe Rueckstellung ohne Zeitabbruch behaelt den bisherigen Grund, ohne Vermerk und ohne Feld", () => {
  const dir = setupProjekt("night-zeit-sauber-alt-", ["true"]);
  try {
    const id = readyIssue(dir, "Endet regulaer ohne Commit");
    const fake = `echo '${resultZeileMitText("end_turn", "Ich komme nicht weiter und hoere hier auf.")}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const body = karte(dir, id).body;
    assert.ok(body.includes(DEFERRED_WORTLAUT), `der bisherige Grund fehlt am Paket:\n${body}`);
    assert.ok(!body.includes(ZEITLIMIT_ANKER), `ohne den Fall gehoert kein Vermerk ans Paket:\n${body}`);

    const e = einheit(dir, id);
    // Weg statt `false`: Ein `false` behauptete eine Messung, die nicht stattgefunden hat.
    assert.ok(!("zeitlimitBeendet" in e), `das Feld steht da, obwohl der Fall nicht eintrat: ${JSON.stringify(e)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- night-977-2: der unsaubere Zweig ---

test("[night-977-2] ein Zeitabbruch bei unsauberem Baum bricht das Paket ab (Issue #1089) und traegt den Vermerk am bestehenden Kommentar", () => {
  // Rote Vorpruefung: Der Salvage ist nicht moeglich, und die Runde faellt in den
  // regulaeren Fehlschlag-Zweig von `behandleDirtyRunde`.
  const dir = setupProjekt("night-zeit-dirty-", ["false"]);
  try {
    const id = readyIssue(dir, "Laeuft in das Zeitlimit und laesst Arbeit liegen");
    const fake = `echo '${fortschrittZeile(AK1)}'; echo arbeit > arbeit.txt; sleep 30 # haengt`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: fake,
      NIGHT_TIMEOUT_MS: String(TIMEOUT_MS),
      NIGHT_KILL_GRACE_MS: "300",
    });
    assert.equal(res.status, 0, `seit Issue #1089 haelt das gescheiterte Paket nur sich an:\n${res.stdout}\n${res.stderr}`);

    assert.ok(res.stdout.includes(ZEITLIMIT_WORTLAUT), `der Grund fehlt im Protokoll:\n${res.stdout}`);
    assert.match(res.stdout, /nicht in In review UND Working Tree dirty/, `der Zustandstext ist verschwunden:\n${res.stdout}`);

    const body = karte(dir, id).body;
    // Der bestehende Kommentar bleibt stehen, der Vermerk ERWEITERT ihn.
    assert.match(body, /Runde fehlgeschlagen und Working Tree nicht sauber hinterlassen/,
      `der bestehende Kommentar ist verschwunden:\n${body}`);
    assert.ok(body.includes(ZEITLIMIT_ANKER), `der Anker fehlt am Paket:\n${body}`);
    assert.ok(body.includes(AK1), `der Stand nach eigener Auskunft fehlt am Paket:\n${body}`);
    assert.match(body, /Im Arbeitsverzeichnis/, `die Reste fehlen im Vermerk:\n${body}`);
    assert.match(body, /arbeit\.txt/, `die liegengebliebene Datei fehlt im Vermerk:\n${body}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "abgebrochen", `das Paket ist abgebrochen, seine Reste im Stash: ${JSON.stringify(e)}`);
    assert.equal(e.zeitlimitBeendet, true, "das Feld des Zeitabbruchs fehlt an der Einheit");
    assert.equal(Object.keys(e).at(-1), "zeitlimitBeendet",
      `das neue Feld steht nicht hinten: ${Object.keys(e).join(", ")}`);
    assert.ok(String(e.grund).includes(ZEITLIMIT_WORTLAUT), `der Grund fehlt an der Einheit: ${e.grund}`);
    // Die Wartend-Erkennung hat sich nicht verschoben: Am Zeitlimit kommt kein
    // `result`-Ereignis an, `wartendeSession` ist hier nie wahr.
    assert.ok(!body.includes(WARTEND_ANKER), `der Zeitabbruch wird als wartende Sitzung ausgewiesen:\n${body}`);
    assert.ok(!("wartendBeendet" in e), `beide Felder zugleich: ${JSON.stringify(e)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- night-977-3 und night-977-4: die beiden Salvage-Ausgaenge ---

/** Ein Fake, der die regulaere Runde (dirty, Zeitlimit) vom Salvage trennt. */
function salvageFake(salvageTeil) {
  return [
    'if [ -n "$NIGHT_SALVAGE" ]; then',
    salvageTeil,
    "else",
    `  echo '${fortschrittZeile(AK1)}'`,
    '  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"',
    "  sleep 30 # haengt",
    "fi",
  ].join("\n");
}

const SALVAGE_ERFOLG = [
  '  git add "work-$NIGHT_ISSUE_ID.txt" && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"',
  '  node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null',
].join("\n");

test("[night-977-3] ein gescheiterter Salvage nach Zeitabbruch traegt den Vermerk ebenfalls", () => {
  const dir = setupProjekt("night-zeit-salvage-fehl-", ["true"]);
  try {
    const id = readyIssue(dir, "Zeitlimit, der Salvage tut nichts");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: salvageFake("  :"),
      NIGHT_TIMEOUT_MS: String(TIMEOUT_MS),
      NIGHT_KILL_GRACE_MS: "300",
    });
    assert.equal(res.status, 0, `seit Issue #1089 haelt das gescheiterte Paket nur sich an:\n${res.stdout}\n${res.stderr}`);

    const body = karte(dir, id).body;
    assert.ok(body.includes(ZEITLIMIT_ANKER), `der Anker fehlt am Paket:\n${body}`);
    assert.ok(body.includes(AK1), `der Stand nach eigener Auskunft fehlt am Paket:\n${body}`);
    // Der Salvage-Kommentar bleibt daneben stehen — zwei Vorgaenge sind zu berichten.
    assert.match(body, /weder committet noch das Board bewegt/, `der Salvage-Kommentar fehlt:\n${body}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "abgebrochen", `das Paket ist abgebrochen, seine Reste im Stash: ${JSON.stringify(e)}`);
    assert.equal(e.zeitlimitBeendet, true, "das Feld des Zeitabbruchs fehlt an der Einheit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-977-4] nach gelungenem Salvage steht EIN Satz an der Karte — keine Empfehlung, kein Stand, kein Feld", () => {
  const dir = setupProjekt("night-zeit-salvage-erfolg-", ["true"]);
  try {
    const id = readyIssue(dir, "Zeitlimit, der Salvage rettet");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: salvageFake(SALVAGE_ERFOLG),
      NIGHT_TIMEOUT_MS: String(TIMEOUT_MS),
      NIGHT_KILL_GRACE_MS: "300",
    });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const body = karte(dir, id).body;
    // Der Erfolgs-Kommentar bleibt, und der Zeitabbruch steht als EIN Satz daran.
    assert.match(body, /Eine Salvage-Session hat den Zwischenstand geprueft/, `der Erfolgs-Kommentar fehlt:\n${body}`);
    assert.ok(body.includes(ZEITLIMIT_WORTLAUT), `der Zeitabbruch wird an der geretteten Karte verschwiegen:\n${body}`);
    assert.match(body, new RegExp(`${(TIMEOUT_MS / 60000).toFixed(1)} Minuten`), `die Grenze fehlt im Satz:\n${body}`);
    // An einer fertigen Karte ist nichts zu teilen: weder Vermerk-Anker noch Empfehlung
    // noch Stand-Abschnitt.
    assert.ok(!body.includes(ZEITLIMIT_ANKER), `der volle Vermerk steht an der geretteten Karte:\n${body}`);
    assert.doesNotMatch(body, /Empfehlung \(keine Vorgabe\)/, `die Empfehlung steht an der geretteten Karte:\n${body}`);
    assert.doesNotMatch(body, /Stand nach eigener Auskunft/, `der Stand-Abschnitt steht an der geretteten Karte:\n${body}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "erfolg", `der Salvage-Erfolg bleibt ein Erfolg: ${JSON.stringify(e)}`);
    // Ohne das Feld: Eine gerettete Karte ist fertig und zaehlt in keiner Auswertung als
    // Zeitabbruch.
    assert.ok(!("zeitlimitBeendet" in e), `ein Erfolg traegt das Feld nicht: ${JSON.stringify(e)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
