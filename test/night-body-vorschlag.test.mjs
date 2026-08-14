// Eine Review-Session ohne Body-Vorschlag ist kein Erfolg (Issue #310).
//
// Der Skill verlangt im Nachtbetrieb ausdruecklich den fertig formulierten Body als
// Kommentar, "als uebernehmbarer Text und nicht als Beschreibung dessen, was zu
// aendern waere". Genau die Beschreibung ist entstanden, der uebernehmbare Text
// nicht — neunmal in einem Lauf am 2026-08-12, und in der Nacht darauf noch einmal
// sechsmal, waehrend dieses Issue schon im Backlog lag.
//
// Der Schaden ist die verlorene Haelfte der Arbeit: Die Befunde stehen am Board,
// die Einarbeitung existiert nur als Behauptung im Perfekt. Wer danach
// implementiert, arbeitet gegen den alten Body. Am Board faellt es nicht auf — die
// Marker-Regel greift korrekt, das Issue sieht richtigerweise ungeprueft aus, ist
// aber weder ungeprueft noch geschaerft, sondern etwas Drittes.
//
// Der Skill sagt es woertlich, und neun Sessions haben es trotzdem uebersprungen.
// Das ist das Muster aus Issue #122: Eine Regel, die unter Druck faellt, gehoert
// ins Gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { neueKommentare, bodyVorschlagVorhanden } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

// --- Die reinen Funktionen ---

test("neueKommentare: nur was seit dem Vorher-Stand hinzugekommen ist", () => {
  const vorher = { body: "B", comments: [{ body: "alt" }] };
  const nachher = { body: "B", comments: [{ body: "alt" }, { body: "neu" }] };
  assert.deepEqual(neueKommentare(vorher, nachher), ["neu"]);
});

test("neueKommentare: ohne comments-Feld zaehlt der neu angehaengte Body-Abschnitt", () => {
  // Der lokale Tracker liefert bei `issue get` kein comments-Feld — er haengt
  // Kommentare an den Body.
  const vorher = { body: "Rumpf" };
  const nachher = { body: "Rumpf\n\n---\n**Kommentar** (2026-08-14 10:00)\n\n## Body-Vorschlag, Runde 1\n\nText" };
  assert.deepEqual(neueKommentare(vorher, nachher), ["## Body-Vorschlag, Runde 1\n\nText"]);
});

test("neueKommentare: mehrere lokal angehaengte Kommentare werden getrennt", () => {
  const vorher = { body: "Rumpf" };
  const nachher = {
    body: "Rumpf"
      + "\n\n---\n**Kommentar** (2026-08-14 10:00)\n\n## Issue-Review, Runde 1\n\nBLOCKER"
      + "\n\n---\n**Kommentar** (2026-08-14 10:05)\n\n## Body-Vorschlag, Runde 1\n\nText",
  };
  assert.deepEqual(neueKommentare(vorher, nachher).length, 2);
});

test("neueKommentare: unveraenderter Stand liefert nichts", () => {
  assert.deepEqual(neueKommentare({ body: "B" }, { body: "B" }), []);
  assert.deepEqual(neueKommentare({ body: "B", comments: [] }, { body: "B", comments: [] }), []);
});

test("bodyVorschlagVorhanden: Kopfzeile mit Text darunter zaehlt", () => {
  assert.equal(bodyVorschlagVorhanden(["## Body-Vorschlag, Runde 1\n\n## Kontext\n\nNeuer Text"]), true);
});

// Eine blosse Ueberschrift ist kein uebernehmbarer Text — genau die Luecke, die das
// Gate schliessen soll, waere sonst mit einer Zeile zu umgehen.
test("bodyVorschlagVorhanden: Kopfzeile ohne Textzeile zaehlt nicht", () => {
  assert.equal(bodyVorschlagVorhanden(["## Body-Vorschlag, Runde 1"]), false);
  assert.equal(bodyVorschlagVorhanden(["## Body-Vorschlag, Runde 1\n\n   \n"]), false);
});

// Dass es die ERSTE Zeile eines Kommentars sein muss, schliesst zitierte oder in
// Befunden erwaehnte Treffer aus.
test("bodyVorschlagVorhanden: die Kopfzeile muss die erste Zeile sein", () => {
  assert.equal(
    bodyVorschlagVorhanden(["## Issue-Review, Runde 1\n\nEs fehlt ein\n## Body-Vorschlag, Runde 1\nmit Text"]),
    false,
  );
});

test("bodyVorschlagVorhanden: ohne Vorschlag falsch", () => {
  assert.equal(bodyVorschlagVorhanden(["## Issue-Review, Runde 1\n\nBLOCKER: fehlt"]), false);
  assert.equal(bodyVorschlagVorhanden([]), false);
});

// Bei mehreren Runden ist nur der letzte Vorschlag der uebernehmbare Text. Eine
// Paarungspflicht je Runde bestrafte einen Lauf, der korrekt nur den Endstand
// vorschlaegt — deshalb zaehlt die hoechste geschriebene Runde.
test("bodyVorschlagVorhanden: die hoechste geschriebene Runde braucht ihren Vorschlag", () => {
  const zweiRundenOhne = [
    "## Issue-Review, Runde 1\n\nBLOCKER",
    "## Body-Vorschlag, Runde 1\n\nText",
    "## Synthese, Runde 2\n\nuebernommen",
  ];
  assert.equal(bodyVorschlagVorhanden(zweiRundenOhne), false);

  const zweiRundenMit = [...zweiRundenOhne, "## Body-Vorschlag, Runde 2\n\nText"];
  assert.equal(bodyVorschlagVorhanden(zweiRundenMit), true);
});

test("bodyVorschlagVorhanden: ohne Rundenangabe genuegt irgendein gueltiger Vorschlag", () => {
  assert.equal(bodyVorschlagVorhanden(["## Befunde\n\nBLOCKER", "## Body-Vorschlag, Runde 1\n\nText"]), true);
});

test("bodyVorschlagVorhanden: Runde 0 ist keine positive Rundenzahl", () => {
  assert.equal(bodyVorschlagVorhanden(["## Body-Vorschlag, Runde 0\n\nText"]), false);
});

// --- Die Schleife ---

const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

const VORFLUG_OK = `cat <<'EOF'
<<<VORFLUG
{"reviewers": [], "tracker": {"erreichbar": true, "geprueft": "issue list"}}
VORFLUG>>>
EOF`;

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, NIGHT_VORFLUG_CMD: VORFLUG_OK, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-vorschlag-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\naufrufe.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";

function backlogIssue(dir, titel, body = OHNE_MARKER) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  const pfad = join(dir, "issues", `${issue.id}.md`);
  const roh = readFileSync(pfad, "utf-8");
  writeFileSync(pfad, roh.replace(/^status:/m, "labels: kit:nightreview\nstatus:"), "utf-8");
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

const BOARD = '"$KIT_ROOT/.claude/kit/board.mjs"';

// Einfache Anfuehrungszeichen und ECHTE Zeilenumbrueche: In doppelten Quotes gibt sh
// ein `\n` literal weiter — der Kommentar haette dann gar keine zweite Zeile, und
// die Pruefung auf die erste Zeile liefe ins Leere. Die Texte enthalten kein '.
const kommentiere = (text) => `node ${BOARD} issue comment "$NIGHT_ISSUE_ID" --text '${text}'`;

const FAKE_NUR_BEFUNDE = kommentiere("## Issue-Review, Runde 1\n\nBLOCKER: fehlt was");
const FAKE_MIT_VORSCHLAG = [
  kommentiere("## Issue-Review, Runde 1\n\nBLOCKER: fehlt was"),
  kommentiere("## Body-Vorschlag, Runde 1\n\n## Kontext\n\nGeschaerfter Text.\n"),
].join("; ");
const FAKE_MARKER = `node ${BOARD} issue update "$NIGHT_ISSUE_ID" --body "## Kontext

Autor-Modell: claude-opus-5
Issue-Review: opus, sonnet (2026-08-14, Nachtlauf)

## Abhaengigkeiten

Keine."`;

test("Befunde mit neuem Body-Vorschlag -> Erfolg", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_MIT_VORSCHLAG });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /geprueft mit Befund/);
    assert.match(res.stdout, /1 mit Befund/);
    assert.match(res.stdout, /0 Schaerfung fehlt/);
  });
});

test("Befunde ohne Body-Vorschlag -> Schaerfung fehlt, getrennt gezaehlt, Exit 0", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_NUR_BEFUNDE });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Befunde vorhanden, aber kein Body-Vorschlag — Schaerfung fehlt/);
    assert.match(res.stdout, /1 Schaerfung fehlt/);
    assert.doesNotMatch(res.stdout, /1 mit Befund/, "der Fall darf nicht als Erfolg mitgezaehlt werden");
    assert.doesNotMatch(res.stdout, /1 ohne Ergebnis/, "der Fall ist kein leerer Lauf");
  });
});

// Ein Vorschlag aus einem frueheren Lauf ist kein Ergebnis DIESER Session.
test("alter Body-Vorschlag erfuellt das Gate nicht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue");
    board(dir, "issue", "comment", id, "--text", "## Body-Vorschlag, Runde 1\n\nAus der Vornacht.");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_NUR_BEFUNDE });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Schaerfung fehlt/);
  });
});

test("zwei Runden, Vorschlag nur fuer Runde 1 -> Schaerfung fehlt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const fake = [
      kommentiere("## Issue-Review, Runde 1\n\nBLOCKER"),
      kommentiere("## Body-Vorschlag, Runde 1\n\nErster Stand."),
      kommentiere("## Synthese, Runde 2\n\nuebernommen: alles."),
    ].join("; ");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Schaerfung fehlt/);
  });
});

test("Kopfzeile ohne Textzeile darunter zaehlt nicht als Vorschlag", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const fake = [
      kommentiere("## Issue-Review, Runde 1\n\nBLOCKER"),
      kommentiere("## Body-Vorschlag, Runde 1"),
    ].join("; ");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Schaerfung fehlt/);
  });
});

// Ist nichts zu aendern, gibt es auch nichts vorzuschlagen — der Marker ist dann das
// vollstaendige Ergebnis.
test("Marker der aktiven Stufe ohne Vorschlag bleibt ein Erfolg", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /geprueft ohne Befund/);
    assert.match(res.stdout, /0 Schaerfung fehlt/);
  });
});

// In den Stufen fachlich und plan setzt ein unbeaufsichtigter Lauf grundsaetzlich
// keinen Marker — dort ist der Vorschlag also immer erforderlich.
test("--stufe plan: mit Vorschlag Erfolg, ohne ihn Schaerfung fehlt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "[Plan] Ein Plandokument");
    const ohne = run(dir, process.execPath, [NIGHT, "--review", "--stufe", "plan"], { NIGHT_CLAUDE_CMD: FAKE_NUR_BEFUNDE });
    assert.equal(ohne.status, 0, ohne.stderr);
    assert.match(ohne.stdout, /Schaerfung fehlt/);
  });

  mitProjekt((dir) => {
    backlogIssue(dir, "[Plan] Ein Plandokument");
    const mit = run(dir, process.execPath, [NIGHT, "--review", "--stufe", "plan"], { NIGHT_CLAUDE_CMD: FAKE_MIT_VORSCHLAG });
    assert.equal(mit.status, 0, mit.stderr);
    assert.match(mit.stdout, /geprueft mit Befund/);
    assert.match(mit.stdout, /0 Schaerfung fehlt/);
  });
});

// --- Der Skill ---

test("der Skill gibt die Kopfzeile woertlich vor", () => {
  assert.match(SKILL, /## Body-Vorschlag, Runde <n>/,
    "ohne festen Anker kann der Runner nichts pruefen");
});

test("der Skill nennt die Reihenfolge: erst der Vorschlag, dann die Synthese", () => {
  // Wer die Synthese zuerst schreibt, hat die Abwaegung protokolliert und den Text
  // noch nicht — und genau dann faellt das Aufschreiben aus.
  assert.match(SKILL, /erst der Body-Vorschlag, dann die Synthese/i);
});

test("Schritt 5b sagt, dass die Synthese ueber den Vorschlag entscheidet", () => {
  const idx = SKILL.indexOf("### 5b.");
  assert.ok(idx >= 0, "Schritt 5b fehlt");
  const schritt = SKILL.slice(idx).split(/\n### /)[0];
  assert.match(schritt, /ueber den Vorschlag|über den Vorschlag/,
    "die Perfekt-Formulierung ist der Ort, an dem die Verwechslung entsteht");
});
