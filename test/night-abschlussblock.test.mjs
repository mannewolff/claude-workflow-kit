// Der Abschlussblock des Laufprotokolls (Issue #752, Plan #745, Fachliche Quelle #737).
//
// Die erste der zwei Ausgabestellen: Am Ende jedes unbeaufsichtigten Laufs ruft
// `laufAbschliessen()` die Aufwands-Auswertung als Kindprozess, legt ihr Ergebnis am
// Lauf-Kopf ab und schreibt den Befundblock in das Laufprotokoll.
//
// DIE REIHENFOLGE IST DER KERN (W6 aus dem Plan-Review): `abschluss` und `complete`
// standen bisher nur im Speicher, als der Lauf endete. Wertete die Auswertung in dem
// Moment aus, laese sie auf der Platte `abschluss: null, complete: false` — der frischeste
// Lauf, um den es im Block gerade geht, ginge als unvollstaendig ein. Deshalb: erst
// schreiben, dann auswerten, dann erneut schreiben.
//
// KRITERIUM 11: Liegt kein Befund vor, steht im Protokoll NICHTS dazu — keine
// Ueberschrift, keine leere Tabelle, kein beruhigender Satz.
//
// KRITERIUM 10 (E15): Die Auswertung ist kein Gate. Ein Fehlschlag — Exit ungleich 0,
// unlesbare Ausgabe, fehlende Datei — ist eine Protokollzeile und kein `fail()`.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture). Die Auswertung selbst ist ein Stellvertreter
// unter `.claude/kit/aufwand.mjs`: Gemessen wird, was der Runner mit ihrem Ergebnis
// macht, nicht wie es entsteht — das steht in den aufwand-*-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { worktreeAnlegen } from "../kit/night.mjs";

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

// --- Die Stellvertreter der Auswertung ---------------------------------------
//
// Jeder schreibt zuerst mit, WAS er beim Aufruf auf der Platte vorfindet — daran haengt
// der Reihenfolge-Nachweis — und verhaelt sich danach wie der jeweilige Fall.

const CAPTURE_KOPF = [
  'import { readdirSync, readFileSync, appendFileSync } from "node:fs";',
  'import { join } from "node:path";',
  "",
  'const dir = join(process.cwd(), ".claude");',
  String.raw`const staende = readdirSync(dir).filter((n) => /^night-run-.*\.json$/.test(n)).sort();`,
  "const gesehen = staende.map((n) => {",
  '  const s = JSON.parse(readFileSync(join(dir, n), "utf-8"));',
  "  return { datei: n, abschluss: s.abschluss, complete: s.complete };",
  "});",
  String.raw`appendFileSync(process.env.AUFWAND_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), gesehen }) + "\n");`,
  "",
].join("\n");

// Der Befundtext ist absichtlich unverwechselbar: Im Protokoll wird nach genau ihm
// gesucht, und kein anderer Lauf-Text kann ihn zufaellig tragen.
const BEFUND_TEXT = "Werkzeugarbeit macht 61,0 Prozent der gemessenen Gesamtzeit aus (Probefall).";
const ERGEBNIS_MIT_BEFUND = {
  erzeugtAm: "2026-09-19T01:02:03.456Z",
  juengsterLauf: "2026-09-19-010203",
  laeufe: { gefunden: 2, einbezogen: 2, grenze: 10 },
  befund: [{ schwelle: "werkzeugAnteil", wert: 0.61, grenze: 0.5, laeufe: 2, text: BEFUND_TEXT }],
};
const ERGEBNIS_OHNE_BEFUND = { ...ERGEBNIS_MIT_BEFUND, befund: [] };

/** Gibt ein vollstaendiges Ergebnis aus — der Regelfall. */
function stubMitErgebnis(ergebnis) {
  return `${CAPTURE_KOPF}process.stdout.write(${JSON.stringify(JSON.stringify(ergebnis, null, 2))});\n`;
}

// Der Fehlerfall des echten Werkzeugs: JSON auf stdout, Exit 1 (kit/aufwand.mjs, main()).
const STUB_EXIT_UNGLEICH_NULL = `${CAPTURE_KOPF}`
  + `process.stdout.write(${JSON.stringify(JSON.stringify({ ok: false, fehler: "Probefehler beim Auswerten" }))});\n`
  + "process.exit(1);\n";

// Eine Ausgabe, die kein JSON ist — der Fall, in dem das Werkzeug zwar laeuft, aber
// etwas anderes schreibt als abgemacht.
const STUB_UNLESBAR = `${CAPTURE_KOPF}process.stdout.write("kein JSON, sondern Fliesstext\\n");\n`;

// Ein Werkzeug, das nicht zurueckkehrt (Issue #824, night-67). Ohne CAPTURE_KOPF: Der
// Stub soll nichts voraussetzen, nur haengen. Der Timer haelt den Prozess am Leben, bis
// das Zeitlimit des Runners ihn abraeumt.
const STUB_HAENGT = "setTimeout(() => {}, 600000);\n";

function setupProjekt(praefix, { aufwandStub = stubMitErgebnis(ERGEBNIS_MIT_BEFUND), buildChecks = ["true"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  if (aufwandStub !== null) writeFileSync(join(dir, ".claude", "kit", "aufwand.mjs"), aufwandStub);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks,
    local: { issuesDir: "issues" },
  }, null, 2));
  // Bewusst OHNE `.claude/*`: Die Auswertung und der Ergebnisstand muessen fuer git
  // sichtbar bleiben, sonst bewiese der Rest-Guard-Test unten nichts. Nur das
  // Textprotokoll und die Pruef-Zusammenfassung sind ignoriert.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nsessions.log\n");
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

/** Fixture, Capture-Datei ausserhalb des Repos, und beides wird hinterher geraeumt. */
function mitProjekt(praefix, optionen, fn) {
  const dir = setupProjekt(praefix, optionen);
  const aussen = mkdtempSync(join(tmpdir(), `${praefix}capture-`));
  const capture = join(aussen, "aufwand-aufrufe.jsonl");
  try {
    fn(dir, capture);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(aussen, { recursive: true, force: true });
  }
}

/** Die mitgeschriebenen Aufrufe der Auswertung, einer je Zeile. */
function aufrufe(capture) {
  if (!existsSync(capture)) return [];
  return readFileSync(capture, "utf-8").split("\n").filter((z) => z.trim() !== "").map((z) => JSON.parse(z));
}

/** Der eine Ergebnisstand des Laufs — mehr als einer waere hier ein Fehler. */
function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n));
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Das Laufprotokoll des Tages — die Datei, in die der Abschlussblock geht. */
function protokoll(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}\.log$/.test(n));
  assert.equal(dateien.length, 1, `genau ein Laufprotokoll erwartet, gefunden: ${dateien.join(", ")}`);
  return readFileSync(join(dir, ".claude", dateien[0]), "utf-8");
}

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

// Ein Session-Fake, der die Karte nach In review bringt und nichts liegen laesst.
const FAKE_ERFOLG = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';

// --- Die Reihenfolge ----------------------------------------------------------

test("[night-47] die Auswertung sieht den eigenen Lauf abgeschlossen: abschluss und complete stehen schon auf der Platte", NUR_POSIX, () => {
  mitProjekt("night-abschluss-reihenfolge-", {}, (dir, capture) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const gerufen = aufrufe(capture);
    assert.equal(gerufen.length, 1, `genau ein Aufruf der Auswertung erwartet: ${JSON.stringify(gerufen)}`);
    assert.deepEqual(gerufen[0].argv, ["auswerten"], "die Auswertung wird mit 'auswerten' gerufen");
    assert.equal(gerufen[0].gesehen.length, 1, `genau ein Ergebnisstand zum Zeitpunkt des Aufrufs: ${JSON.stringify(gerufen[0].gesehen)}`);
    assert.equal(gerufen[0].gesehen[0].abschluss, "regulaer",
      "die Auswertung las den eigenen Lauf ohne Abschlussart — dann ginge der frischeste Lauf als unvollstaendig ein");
    assert.equal(gerufen[0].gesehen[0].complete, true,
      "die Auswertung las den eigenen Lauf als unvollstaendig — erst schreiben, dann auswerten");
  });
});

test("[night-47] der Befund steht am Lauf-Kopf und als Abschlussblock im Laufprotokoll", NUR_POSIX, () => {
  mitProjekt("night-abschluss-befund-", {}, (dir, capture) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    assert.ok(s.aufwand, "der Ergebnisstand traegt kein Feld 'aufwand' am Lauf-Kopf");
    assert.equal(s.aufwand.befund[0].text, BEFUND_TEXT, "das Feld traegt nicht das Ergebnis der Auswertung");
    // Der zweite Schreibvorgang ist der Beweis: Ohne ihn stuende das Feld nur im Speicher.
    assert.equal(s.abschluss, "regulaer", "die Abschlussart darf der zweite Schreibvorgang nicht verlieren");
    assert.equal(s.complete, true, "die Vollstaendigkeit darf der zweite Schreibvorgang nicht verlieren");

    const log = protokoll(dir);
    assert.ok(log.includes(BEFUND_TEXT), `der Befund fehlt im Laufprotokoll:\n${log}`);
    assert.ok(log.includes("Auswertung vom 2026-09-19T01:02:03.456Z"),
      `die Kopfzeile des Befundblocks fehlt im Laufprotokoll:\n${log}`);
  });
});

test("[night-47] ohne Befund steht nichts im Protokoll — keine Ueberschrift, keine leere Tabelle, kein beruhigender Satz", NUR_POSIX, () => {
  mitProjekt("night-abschluss-stumm-", { aufwandStub: stubMitErgebnis(ERGEBNIS_OHNE_BEFUND) }, (dir, capture) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.equal(aufrufe(capture).length, 1, "die Auswertung lief auch ohne Befund");
    const s = stand(dir);
    assert.deepEqual(s.aufwand.befund, [], "der Lauf-Kopf traegt den leeren Befund — er ist gemessen, nicht ausgelassen");

    const log = protokoll(dir);
    assert.ok(!/Auswertung vom/.test(log), `ohne Befund darf keine Kopfzeile im Protokoll stehen:\n${log}`);
    assert.ok(!/Befund|Schwelle|unauffaellig/i.test(log), `ohne Befund darf kein beruhigender Satz im Protokoll stehen:\n${log}`);
  });
});

// --- Kriterium 10: kein Gate --------------------------------------------------

/** Die Protokollzeilen, die den Fehlschlag der Auswertung melden. */
function fehlerzeilen(dir) {
  return protokoll(dir).split("\n").filter((z) => z.includes("Aufwands-Auswertung"));
}

test("[night-47] ein Kindprozess mit Exit ungleich 0 ist eine Protokollzeile und kein Abbruch", NUR_POSIX, () => {
  mitProjekt("night-abschluss-exit-", { aufwandStub: STUB_EXIT_UNGLEICH_NULL }, (dir, capture) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    assert.match(zeilen[0], /Probefehler beim Auswerten/, "die Zeile nennt den Grund des Werkzeugs nicht");
    // Der Lauf selbst bleibt vollstaendig: Die Auswertung ist Beiwerk, kein Gate.
    const s = stand(dir);
    assert.equal(s.abschluss, "regulaer");
    assert.equal(s.complete, true);
  });
});

test("[night-47] eine unlesbare Ausgabe ist eine Protokollzeile und kein Abbruch", NUR_POSIX, () => {
  mitProjekt("night-abschluss-unlesbar-", { aufwandStub: STUB_UNLESBAR }, (dir, capture) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    assert.equal(stand(dir).complete, true, "der Lauf selbst bleibt vollstaendig");
  });
});

test("[night-47] fehlt aufwand.mjs ganz, endet der Lauf mit unveraendertem Exit-Code und einer Zeile", NUR_POSIX, () => {
  mitProjekt("night-abschluss-fehlt-", { aufwandStub: null }, (dir) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG });
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    // Der Ergebnisstand entsteht trotzdem und ist vollstaendig — er ist der Bericht des
    // Laufs, und der haengt nicht an seiner Auswertung.
    assert.equal(stand(dir).complete, true);
  });
});

test("[night-67] eine Auswertung, die nicht zurueckkehrt, endet am Zeitlimit als Protokollzeile — der Lauf meldet", NUR_POSIX, () => {
  // Die Wirksamkeits-Auswertung ruft `board.mjs issue activity`, also das Netz. Haengt
  // der Aufruf, erreichte der Lauf ohne Zeitlimit `laufMelden()` nie.
  mitProjekt("night-abschluss-timeout-", { aufwandStub: STUB_HAENGT }, (dir) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], {
      NIGHT_CLAUDE_CMD: FAKE_ERFOLG,
      NIGHT_AUSWERTUNG_TIMEOUT_MS: "1500",
    });
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    assert.match(zeilen[0], /fehlgeschlagen/, "die Zeile meldet den Fehlschlag nicht");
    assert.match(zeilen[0], /Zeitlimit/, "die Zeile nennt das Zeitlimit als Grund nicht");
    // Und danach geht der Abschluss weiter: Der Ergebnisstand ist vollstaendig.
    const s = stand(dir);
    assert.equal(s.abschluss, "regulaer");
    assert.equal(s.complete, true);
    assert.equal(s.aufwand.ok, false, "der Lauf-Kopf traegt den Fehlschlag der Auswertung");
  });
});

test("[night-47] im Dry-Run entfaellt der Aufruf ganz", NUR_POSIX, () => {
  mitProjekt("night-abschluss-dryrun-", {}, (dir, capture) => {
    readyIssue(dir, "Erstes Issue");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(aufrufe(capture), [], "der Dry-Run hat die Auswertung gerufen — er wertet nichts aus und schreibt nichts");
  });
});

// --- Der harte Stopp ----------------------------------------------------------

test("[night-47] auch ein harter Stopp durchlaeuft den Weg: Abschlussart, Fehlerklasse und Grund bleiben unveraendert", NUR_POSIX, () => {
  // Rote Pflichtchecks schliessen den Salvage-Versuch aus; der Fake laesst die Karte
  // liegen und den Baum schmutzig — der vierte hardStop-Ausgang (Issue #404).
  mitProjekt("night-abschluss-hartstopp-", { buildChecks: ["false"] }, (dir, capture) => {
    readyIssue(dir, "Erstes Issue");
    const fake = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt"';
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 1, `der harte Stopp haette mit Exit 1 enden muessen: ${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp", "die Abschlussart darf die Auswertung nicht verstellen");
    assert.equal(s.complete, false, "ein harter Stopp bleibt unvollstaendig");
    assert.ok(typeof s.fehlerklasse === "string" && s.fehlerklasse.length > 0, "die Fehlerklasse fehlt");
    // Der Grund steht dort, wo ihn das Sicherheitsnetz aus Issue #558 sucht: am Lauf oder
    // an der ueber `fehlerEinheit` benannten Einheit. Welcher der beiden Orte es ist,
    // entscheidet der Abbruchweg — beide zaehlen, und keiner darf leer bleiben.
    const betroffen = (s.einheiten || []).find((e) => String(e.id) === String(s.fehlerEinheit));
    const grund = s.fehlerText || betroffen?.grund || "";
    assert.ok(grund.length > 0, `der Grund fehlt: ${JSON.stringify({ fehlerText: s.fehlerText, betroffen })}`);
    assert.equal(s.aufwand.befund[0].text, BEFUND_TEXT, "auch der harte Stopp legt das Ergebnis am Lauf-Kopf ab");

    const gerufen = aufrufe(capture);
    assert.equal(gerufen.length, 1, `genau ein Aufruf der Auswertung erwartet: ${JSON.stringify(gerufen)}`);
    assert.equal(gerufen[0].gesehen[0].abschluss, "harterStopp", "die Auswertung las den Stand vor seinem Abschluss");
    assert.ok(protokoll(dir).includes(BEFUND_TEXT), "der Befundblock fehlt im Protokoll des harten Stopps");
  });
});

// --- Die Auswertung ist kein unkommittierter Rest -----------------------------

// Der Gegenpol zum Rest-Stopp (#152), wie bei der Vorhaben-Notiz und den Wegmarken:
// `.claude/aufwand.md` und `.claude/aufwand.json` entstehen am Ende JEDES Laufs im
// Arbeitsbaum. Waeren sie ein Rest, stoppte der naechste Lauf nach seiner ersten
// erfolgreichen Runde hart — die Auswertung machte die Arbeit unmoeglich, die sie misst.
//
// Die `.gitignore` des Fixtures fuehrt `.claude/*` bewusst nicht; nur der Ausschluss im
// Code kann die beiden Dateien entschaerfen.
test("[night-47] eine vorliegende Aufwands-Auswertung ist kein unkommittierter Rest", NUR_POSIX, () => {
  mitProjekt("night-abschluss-rest-", {}, (dir, capture) => {
    const erstes = readyIssue(dir, "Erstes Issue");
    const zweites = readyIssue(dir, "Zweites Issue");
    // Der Fake schreibt beide Dateien, wie die Auswertung des vorigen Laufs es taete.
    const fake = `${FAKE_ERFOLG}`
      + " && echo bericht > .claude/aufwand.md"
      + " && echo '{}' > .claude/aufwand.json";

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake, AUFWAND_CAPTURE: capture });
    assert.equal(res.status, 0, `der Lauf haette weiterlaufen muessen: ${res.stderr}\n${res.stdout}`);

    const inReview = new Set(board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id)));
    assert.ok(inReview.has(erstes) && inReview.has(zweites), "beide Issues haetten in In review landen muessen");

    // Ohne diesen Nachweis waere der Fall auch ohne den Ausschluss gruen.
    const porcelain = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" }).stdout;
    assert.match(porcelain, /\.claude\/aufwand\.md/, "git sieht die Auswertung nicht");
    assert.match(porcelain, /\.claude\/aufwand\.json/, "git sieht den Auswertungsstand nicht");
  });
});

// --- Der Spiegel in den Worktree ----------------------------------------------

// Ein Kette-Worktree bekommt die Auswertung der Hauptkopie nicht: Sie gehoert dem Lauf,
// der sie geschrieben hat. Mitgespiegelt laege sie dort als fremder Stand herum und ginge
// beim Entfernen des Worktrees verloren — derselbe Grund wie bei `night-run-*`.
test("[night-47] der Spiegel nach .claude eines Worktrees laesst die Auswertung zurueck", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-abschluss-spiegel-"));
  const angelegt = [];
  try {
    mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
    writeFileSync(join(dir, ".claude", "workflow.config.json"), '{"codeHost":"local","issueTracker":"local"}\n');
    writeFileSync(join(dir, "README.md"), "hallo\n");
    for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
      const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
    }
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), "// kopie\n");
    writeFileSync(join(dir, ".claude", "aufwand.md"), "# Aufwand\n");
    writeFileSync(join(dir, ".claude", "aufwand.json"), "{}\n");
    writeFileSync(join(dir, ".claude", "night-run-2026-09-19-010203.json"), "{}\n");

    const pfad = worktreeAnlegen({ repoRoot: dir, issueId: "752", stempel: "2026-09-19-010203" });
    angelegt.push(pfad);
    for (const datei of ["kit/board.mjs", "workflow.config.json"]) {
      assert.ok(existsSync(join(pfad, ".claude", datei)), `.claude/${datei} fehlt im Worktree`);
    }
    for (const datei of ["aufwand.md", "aufwand.json", "night-run-2026-09-19-010203.json"]) {
      assert.ok(!existsSync(join(pfad, ".claude", datei)), `.claude/${datei} darf nicht mitkommen`);
    }
    assert.ok(basename(pfad).includes("752"), `unerwarteter Worktree-Pfad: ${pfad}`);
  } finally {
    for (const p of angelegt) {
      spawnSync("git", ["worktree", "remove", "--force", p], { cwd: dir, encoding: "utf-8" });
      rmSync(p, { recursive: true, force: true });
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
