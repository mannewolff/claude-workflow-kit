// Die letzten Klasse-1-Zweige des Nacht-Runners (Issue #501).
//
// Klasse 1 heisst hier: ohne den Nachbarpfad-Hook aus Issue #498 erreichbar. Die
// Stubs am Dateianfang und die Else-Zweige der beiden existsSync-Ternaere gehoeren
// nicht hierher; die Plattform-Zweige in runProcess sind auf der Restliste, weil
// sie unter macOS und Linux nie genommen werden.
//
// Wie ueberall im Nachtlauf-Bestand laeuft das ECHTE Script aus dem Repo gegen ein
// Fixture-Projekt (KIT_ROOT, Issue #189) — eine Kopie im Temp-Verzeichnis erzeugte
// Coverage unter einem Pfad, den SonarCloud nicht abbilden kann.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";


const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Die Session-Fakes laufen ueber `sh -c`. Siehe Issue #199." }
  : {};

function run(cwd, cliArgs, env = {}) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env },
  });
}

function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
}

function board(cwd, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd },
  });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(config = {}, praefix = "night-rest-") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

function mitProjekt(fn, config, praefix) {
  const dir = setupProjekt(config, praefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readyIssue(dir, titel = "Ein Issue") {
  const issue = board(dir, "issue", "create", "--title", titel,
    "--body", "## Kontext\n\nIssue-Review: x\n\n## Abhaengigkeiten\n\nKeine.\n");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

const MOVE_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review';

// ============================================================
// Die Pruef-Zusammenfassung einer Session
// ============================================================

test("eine Zusammenfassung ohne laufen- und ausgelassen-Feld wird als leere Listen gemeldet", NUR_POSIX, () => {
  // `checks.mjs` schreibt beide Felder — eine aeltere oder abgeschnittene Datei kann
  // sie aber verlieren. Fehlt `laufen`, ist das etwas anderes als "rot": Es ist eine
  // Session ohne gemeldete Pruefung, und der Bericht muss sie als solche fuehren
  // statt an `undefined.find` zu zerbrechen.
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = [
      `printf '{}' > .claude/checks-summary.json`,
      MOVE_IN_REVIEW,
    ].join("\n");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, new RegExp(`Issue #${id}: gelaufen: keine \\| ausgelassen: keine`),
      "eine Zusammenfassung ohne Felder muss als 'keine' erscheinen, nicht als Fehler");
    assert.doesNotMatch(res.stdout, new RegExp(`Issue #${id}: ungeprueft`),
      "die Datei war lesbar — sie darf nicht als ungeprueft gelten");
  }, {}, "night-rest-summary-leer-");
});

test("eine nicht loeschbare Zusammenfassung meldet einen Hinweis und stoppt den Lauf nicht", NUR_POSIX, () => {
  // Ein Verzeichnis am Pfad der Zusammenfassung laesst rmSync scheitern. Der Runner
  // darf daran keine Nacht beenden — er vermerkt es und faehrt fort. Die Datei gilt
  // danach als nicht vertrauenswuerdig, und genau das steht im Bericht.
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    mkdirSync(join(dir, ".claude", "checks-summary.json"), { recursive: true });

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: MOVE_IN_REVIEW });

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, /Hinweis: die vorherige Pruef-Zusammenfassung liess sich nicht loeschen/,
      "der Hinweis auf die nicht loeschbare Datei fehlt");
    assert.match(res.stdout, new RegExp(`Issue #${id}: ungeprueft — Zusammenfassung nicht lesbar`),
      "eine unlesbare Datei ist keine Pruefung und muss so gemeldet werden");
  }, {}, "night-rest-summary-dir-");
});

// ============================================================
// Der Infrastruktur-Guard ohne Exit-Code
// ============================================================

test("eine per Signal gestorbene Session nennt das Signal statt eines leeren Exit-Codes", NUR_POSIX, () => {
  // Wird die Session hart abgeschossen, liefert der Prozess keinen Exit-Code, nur ein
  // Signal. Ohne den Rueckfall auf `res.signal` stuende in der Meldung `Exit null` —
  // und morgens waere die Ursache nicht mehr zu erkennen.
  mitProjekt((dir) => {
    const id = readyIssue(dir);

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "kill -9 $$" });

    assert.equal(res.status, 1, "ein Fehlstart haette hart stoppen muessen");
    assert.match(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG nach [\d.]+ min \(Exit SIGKILL\)/,
      "das Signal fehlt in der Meldung");
    assert.doesNotMatch(res.stdout, /Exit null|Exit undefined/,
      "ohne Exit-Code darf dort kein leerer Wert stehen");
    // Kein Board-Zug: Das ist der Unterschied zum fachlichen Fehlschlag, bei dem das
    // Issue ins Backlog wandert. Es bleibt liegen, wo es lag.
    assert.equal(board(dir, "issue", "get", id).status, "ready",
      "ein Infrastruktur-Fehlschlag darf das Ticket nicht verschieben");
  }, {}, "night-rest-signal-");
});

// ============================================================
// Der Salvage, der das Issue verschiebt und den Baum liegen laesst
// ============================================================

test("ein Salvage mit Board-Zug, aber dirty Tree nennt beides getrennt", NUR_POSIX, () => {
  // Salvage gilt nur als Erfolg, wenn BEIDES stimmt: Karte in In review UND sauberer
  // Baum. Der halbe Erfolg ist der gefaehrlichste Ausgang — die Karte sieht fertig
  // aus, der Commit fehlt. Die Meldung muss ihn vom "gar nicht verschoben" trennen.
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = [
      'if [ -n "$NIGHT_SALVAGE" ]; then',
      `  ${MOVE_IN_REVIEW}`,
      '  echo rest > "rest.txt"',
      "else",
      '  echo arbeit > "work.txt"',
      "fi",
    ].join("\n");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, "der halbe Salvage haette hart stoppen muessen");
    assert.match(res.stdout, new RegExp(`SALVAGE-VERSUCH gescheitert — harter Stopp\\. Issue #${id} ist in In review, aber der Tree ist weiterhin dirty`),
      "der halbe Erfolg muss ausdruecklich benannt werden");
    assert.doesNotMatch(res.stdout, /weiterhin nicht in In review/,
      "die Karte wurde verschoben — der andere Zweigtext waere falsch");
  }, {}, "night-rest-salvage-halb-");
});

// ============================================================
// Der Review-Modus ohne Kandidaten
// ============================================================

const EIN_REVIEWER = {
  issueReview: { rounds: 1, reviewers: [{ name: "fable", kind: "claude", model: "claude-fable-5" }] },
};

const VORFLUG_OK = 'cat <<\'EOF\'\n<<<VORFLUG\n{"reviewers":[],"tracker":{"erreichbar":true,"geprueft":"issue list"}}\nVORFLUG>>>\nEOF';

// Dieselbe Ausgabe allein mit `echo` — ein sh-Builtin, das auch in einem PATH ohne
// `cat` funktioniert (siehe mitFakeBin).
const VORFLUG_OK_ECHO = [
  "echo '<<<VORFLUG'",
  `echo '{"reviewers":[],"tracker":{"erreichbar":true,"geprueft":"issue list"}}'`,
  "echo 'VORFLUG>>>'",
].join("\n");

// ============================================================
// Eine Session, die gar nicht erst startet
// ============================================================
//
// Ein `claude` ohne Ausfuehrungsrecht: spawn liefert EACCES. Anders als beim
// Fehlstart mit Exit-Code gibt es hier ueberhaupt keinen Prozess — die Meldung muss
// den Systemfehler nennen statt eines erfundenen Exit-Codes.

function mitFakeBin(fn) {
  const echtesGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).stdout.trim();
  const echtesSh = spawnSync("sh", ["-c", "command -v sh"], { encoding: "utf-8" }).stdout.trim();
  // Der bin-Ordner liegt AUSSERHALB des Fixtures, damit der Working Tree sauber bleibt.
  const bin = mkdtempSync(join(tmpdir(), "night-rest-bin-"));
  writeFileSync(join(bin, "git"), `#!/bin/sh\nexec ${echtesGit} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, "sh"), `#!${echtesSh}\nexec ${echtesSh} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\necho hi\n", { mode: 0o644 });
  try {
    fn(bin);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

test("eine Session, die nicht startbar ist, meldet den Systemfehler statt eines Exit-Codes", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    mitFakeBin((bin) => {
      const res = run(dir, ["--label", "none"], { PATH: bin });

      assert.equal(res.status, 1, "ein nicht startbares CLI haette hart stoppen muessen");
      assert.match(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG nach [\d.]+ min \(EACCES\)/,
        "der Systemfehler fehlt — ohne ihn ist die Ursache unklar");
      assert.doesNotMatch(res.stdout, /Exit /,
        "ohne gestarteten Prozess gibt es keinen Exit-Code, der dort stehen duerfte");
      assert.equal(board(dir, "issue", "get", id).status, "ready",
        "ein Infrastruktur-Fehlschlag darf das Ticket nicht verschieben");
    });
  }, {}, "night-rest-eacces-");
});

// ============================================================
// Ein Tracker, der Issues ohne labels-Feld liefert
// ============================================================
//
// Der lokale Tracker haengt an jedes Issue ein `labels`-Array. Fremde Adapter tun das
// nicht zwingend — GitHub liefert die Labels nur, wenn sie angefordert wurden. Fehlt
// das Feld, darf der Label-Filter nicht an `undefined.includes` zerbrechen; er muss
// das Issue behandeln wie eines ganz ohne Label.

const STANDARD_BODY = "## Kontext\n\nAutor-Modell: m\n\n## Abhaengigkeiten\n\nKeine.\n";

// `titel` und `body` werden als JSON-Literale eingesetzt, damit auch `null` moeglich
// ist — GitHub liefert genau das fuer ein Issue ohne Beschreibung.
function attrappe(status, body = STANDARD_BODY) {
  return `#!/usr/bin/env node
// Ein Tracker-Adapter, der Issues OHNE labels-Feld liefert (Issue #501).
const KIT_VERSION = "1.47.0";
const a = process.argv.slice(2);
const ISSUE = { id: "0001", title: "Ein Issue", body: ${JSON.stringify(body)}, status: ${JSON.stringify(status)} };
if (a[0] === "issue" && a[1] === "list") {
  const status = a[2] === "--status" ? a[3] : null;
  process.stdout.write(JSON.stringify(status === null || status === ISSUE.status ? [ISSUE] : []));
} else if (a[0] === "issue" && a[1] === "get") {
  process.stdout.write(JSON.stringify(ISSUE));
} else {
  process.stdout.write("[]");
}
void KIT_VERSION;
`;
}

function mitAttrappe(fn, status, config = {}, praefix = "night-rest-attrappe-", body = STANDARD_BODY) {
  mitProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), attrappe(status, body));
    fn(dir);
  }, config, praefix);
}

test("Dry-Run: ein Ready-Issue ohne labels-Feld gilt als Issue ohne das gesuchte Label", NUR_POSIX, () => {
  // Zwei Stellen lesen die Labels: der Filter je Issue und die Warnung, die alle in
  // Ready vorhandenen Labels aufzaehlt. Beide muessen das fehlende Feld ueberstehen.
  mitAttrappe((dir) => {
    const res = run(dir, ["--dry-run", "--label", "kit:nacht"]);

    assert.equal(res.status, 0, `der Dry-Run haette mit 0 enden muessen: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, /WARNUNG: kein Ready-Issue traegt das Label 'kit:nacht'/,
      "ohne labels-Feld traegt das Issue das Label nicht — die Warnung muss kommen");
    assert.match(res.stdout, /In Ready vorhandene Labels: keine/,
      "ein Issue ohne labels-Feld steuert keine Labels zur Aufzaehlung bei");
    assert.match(res.stdout, /#0001 Ein Issue -> uebersprungen \(kein Label 'kit:nacht'\)/,
      "das Issue muss uebersprungen werden, nicht den Lauf abbrechen");
    assert.doesNotMatch(res.stderr, /Cannot read propert/,
      "das fehlende Feld darf keinen Absturz ausloesen");
  }, "ready");
});

