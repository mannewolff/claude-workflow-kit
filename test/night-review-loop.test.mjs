// Review-Schleife des Nacht-Runners (Issue #235).
//
// Der bestehende Apparat misst Erfolg als "Issue in In review UND git clean". Eine
// Review-Session bewegt das Board nicht und fasst kein git an — nach jener Logik waere
// sie immer ein Fehlschlag. Hier ist Erfolg dreistufig:
//
//   1. Marker im Body                -> geprueft, ohne gewichtigen Befund
//   2. kein Marker, aber neue Spur   -> geprueft, MIT Befund (ebenfalls Erfolg)
//   3. weder noch                    -> Fehlschlag
//
// Stufe 2 als Fehlschlag zu werten waere der teuerste Denkfehler des Features: Genau
// die Issues, bei denen der Review sich gelohnt hat, wuerden als gescheitert gemeldet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

// Seit Issue #269 laeuft der Vorflug als eigene Session. Ohne diesen Hook wuerde jeder
// Test hier eine echte claude-Session starten; der Fake meldet "alles steht".
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

/**
 * `vorGitCommit` laeuft, bevor der Ausgangszustand festgeschrieben wird — dort gehoert
 * jede Datei hin, die der Lauf spaeter vorfindet, aber nicht selbst anlegt. Eine
 * nachtraeglich geschriebene Datei machte den Working Tree schmutzig, und der
 * Rest-Guard stoppte den Lauf vor der ersten Bewertung.
 */
function setupProjekt(config = {}, vorGitCommit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-reviewloop-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, issueReview: { reviewers: NUR_CLAUDE }, ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\naufrufe.log\n");
  vorGitCommit(dir);
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";
const MIT_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\nIssue-Review: sonnet, fable (2026-08-06)\n\n## Abhaengigkeiten\n\nKeine.\n";

function backlogIssue(dir, titel, body) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  const pfad = join(dir, "issues", `${issue.id}.md`);
  const roh = readFileSync(pfad, "utf-8");
  writeFileSync(pfad, roh.replace(/^status:/m, "labels: kit:nightreview\nstatus:"), "utf-8");
  return String(issue.id);
}

function mitProjekt(fn, config = {}, vorGitCommit) {
  const dir = setupProjekt(config, vorGitCommit);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Fakes fuer die drei Ausgaenge. NIGHT_ISSUE_ID nennt das beauftragte Issue.
//
// Geloggt wird nur die ERSTE Prompt-Zeile (Issue #419): Seit dem Modus-Hinweis ist
// der Auftrag mehrzeilig, und `aufrufe()` unten zaehlt Zeilen. Ohne head -1 wuerde
// ein Session-Aufruf als zwei Aufrufe erscheinen. Der volle Wortlaut wird in
// night-review-prompt.test.mjs geprueft — hier zaehlt, DASS und WIE OFT beauftragt
// wurde.
const BOARD = '"$KIT_ROOT/.claude/kit/board.mjs"';
const LOG_PROMPT = 'echo "$NIGHT_PROMPT" | head -1 >> aufrufe.log';
const FAKE_MARKER = `${LOG_PROMPT}; node ${BOARD} issue update "$NIGHT_ISSUE_ID" --body "## Kontext

Autor-Modell: claude-opus-5
Issue-Review: opus, sonnet (2026-08-06, Nachtlauf)

## Abhaengigkeiten

Keine."`;
// Zwei Kommentare: Befunde und der uebernehmbare Body-Vorschlag. Seit Issue #310
// verlangt das Gate beides — einfache Quotes, damit sh die Zeilenumbrueche nicht
// literal weitergibt.
const FAKE_KOMMENTAR = `${LOG_PROMPT}; node ${BOARD} issue comment "$NIGHT_ISSUE_ID" --text "BLOCKER: fehlt was"; node ${BOARD} issue comment "$NIGHT_ISSUE_ID" --text '## Body-Vorschlag, Runde 1

## Kontext

Geschaerfter Text.'`;
const FAKE_STUMM = LOG_PROMPT;

// Ein Eintrag je Session — der Fake logt dafuer nur die erste Prompt-Zeile.
function aufrufe(dir) {
  const p = join(dir, "aufrufe.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean) : [];
}

// --- Die drei Stufen ---

test("Marker gesetzt -> geprueft ohne Befund, Exit 0", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /geprueft ohne Befund/);
    assert.match(res.stdout, /1 ohne Befund/);
    assert.equal(board(dir, "issue", "get", id).status, "backlog");
  });
});

// Seit Issue #310 gehoert zu "mit Befund" auch der uebernehmbare Body-Vorschlag:
// Befunde ohne ihn sind die halbe Arbeit und zaehlen als "Schaerfung fehlt" (eigene
// Tests in night-body-vorschlag.test.mjs). Der Fake schreibt ihn deshalb mit.
test("Kommentare mit Body-Vorschlag -> geprueft mit Befund, Exit 0, kein Fehlschlag", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_KOMMENTAR });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /geprueft mit Befund/);
    // Nicht als Fehlschlag gewertet: Die Zaehlzeile muss null "ohne Ergebnis" nennen
    // (ein blosses doesNotMatch(/ohne Ergebnis/) traefe genau diese Zeile).
    assert.match(res.stdout, /0 ohne Ergebnis/);
    assert.doesNotMatch(res.stdout, /Fehlschlag/);
    assert.equal(board(dir, "issue", "get", id).status, "backlog");
  });
});

test("keine Spur -> ohne Ergebnis, Lauf geht mit dem naechsten Kandidaten weiter", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const eins = backlogIssue(dir, "Eins", OHNE_MARKER);
    const zwei = backlogIssue(dir, "Zwei", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /ohne Ergebnis/);
    // Beide Kandidaten wurden beauftragt — kein harter Stopp nach dem ersten.
    assert.equal(aufrufe(dir).length, 2);
    assert.match(res.stdout, /2 ohne Ergebnis/);
    // Beide bleiben im Backlog, beide bekamen einen Kommentar.
    for (const id of [eins, zwei]) {
      assert.equal(board(dir, "issue", "get", id).status, "backlog");
      assert.match(readFileSync(join(dir, "issues", `${id}.md`), "utf-8"), /Nachtlauf/);
    }
  });
});

// --- Guards ---

test("dirty Working Tree -> harter Stopp, kein Salvage-Versuch", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const dreckig = `${FAKE_STUMM}; echo rest > uebrig.txt`;
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: dreckig });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /HARTER STOPP/);
    assert.match(res.stdout, /Working Tree|nicht sauber|dirty/i);
    assert.doesNotMatch(res.stdout, /SALVAGE/i);
  });
});

test("Session-Exit != 0 -> harter Stopp, Issue unangetastet", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const vorher = readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: "exit 1" });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /INFRASTRUKTUR/i);
    assert.equal(readFileSync(join(dir, "issues", `${id}.md`), "utf-8"), vorher, "Issue wurde angetastet");
  });
});

// --- Auswahl und Auftrag ---

test("ein Issue mit vorhandenem Marker bekommt keine Session", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Schon geprueft", MIT_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(aufrufe(dir).length, 0, "es lief eine Session fuer ein bereits geprueftes Issue");
    assert.match(res.stdout, /1 uebersprungen/);
  });
});

// Seit Issue #419 traegt der Auftrag hinter dem Skill-Aufruf den Modus-Hinweis. Die
// erste Zeile bleibt der Aufruf — sie startet den Skill; was dahinter steht, prueft
// night-review-prompt.test.mjs.
test("der Auftrag beginnt mit /issue-review #<id>", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });
    assert.deepEqual(aufrufe(dir), [`/issue-review #${id}`]);
  });
});

test("--max 1 startet genau eine Session bei zwei Kandidaten", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Eins", OHNE_MARKER);
    backlogIssue(dir, "Zwei", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--max", "1"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(aufrufe(dir).length, 1);
  });
});

test("in keinem Ausgang aendert sich die Board-Spalte", NUR_POSIX, () => {
  // Die Kandidaten liegen bereits im Backlog; ein Move waere in jedem Ausgang falsch —
  // anders als in der Implementierungsschleife, die Fehlschlaege dorthin schiebt.
  for (const fake of [FAKE_MARKER, FAKE_KOMMENTAR, FAKE_STUMM]) {
    mitProjekt((dir) => {
      const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
      run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: fake });
      assert.equal(board(dir, "issue", "get", id).status, "backlog");
    });
  }
});

// --- Der fuenfte Ausgang: Synthese ohne Beleg (Issue #594) ---
//
// Der Skill ruft den Abgleich seit Issue #593 selbst auf — verlassen darf sich der
// Runner darauf nicht: Die Warnung gegen genau diesen Fehler stand am 2026-08-12 schon
// im Skill und wurde neunmal in einem Lauf uebergangen. Der Ausgang greift deshalb VOR
// der Marker-Pruefung. Setzte eine Session den Marker entgegen der Regel trotz eines
// negativen Abgleichs, bliebe der Befund sonst unsichtbar, und das Ticket ginge als
// geprueft durchs Ready-Gate.

const KONTEXT_BODY = "## Kontext\n\nAutor-Modell: claude-opus-5\n";
// Der Marker wird ANGEHAENGT, nicht in einen neuen Body geschrieben: Beim lokalen
// Tracker haengen Kommentare am Body, und `neueKommentare` grenzt den Anhang dieser
// Session ueber den alten Body als Praefix ab. Ein frei neu geschriebener Body waere
// beim echten Board (eigenes comments-Array) unauffaellig, hier aber der Fall
// „Body geaendert" — und die Session haette scheinbar keinen Kommentar hinterlassen.
const MARKER_ANHANG = "Issue-Review: opus, sonnet (2026-09-10, Nachtlauf)\n";

const SYNTHESE_DATEI = "synthese-fixture.md";
const VORSCHLAG_DATEI = "vorschlag-fixture.md";

// Die Fake-Session ruft das ECHTE board.mjs unter seinem zweiten Namen auf und geht am
// mitschreibenden Wrapper vorbei. So steht im Protokoll nur, was der Runner (und der
// Testaufbau) getan hat — und genau das ist die Frage dieses Ausgangs. Eine Unterscheidung
// ueber NIGHT_ISSUE_ID im Environment traegt nicht: Laeuft die Testsuite selbst in einer
// Nacht-Session, ist die Variable auch im Testprozess gesetzt.
const BOARD_ECHT = '"$KIT_ROOT/.claude/kit/board-echt.mjs"';

// Was am Board steht, entscheidet den Ausgang nicht — es entscheidet, OB geprueft wird.
// Die Pruefung selbst laeuft ueber den Datei-Weg desselben Kommandos (siehe
// boardMitSyntheseAkte): Der lokale Tracker liefert kein comments-Array, und
// `synthese-check <id>` faende dort nie eine Synthese.
const SYNTHESE_KOMMENTAR = `node ${BOARD_ECHT} issue comment "$NIGHT_ISSUE_ID" --text '## Synthese, Runde 1

- fable, "Kontext fehlt" — uebernommen'`;
const MARKER_ANHAENGEN = `node ${BOARD_ECHT} issue update "$NIGHT_ISSUE_ID" --body '${KONTEXT_BODY}${MARKER_ANHANG}'`;

const OHNE_BELEG = '## Synthese, Runde 1\n\n- fable, "Kontext fehlt" — uebernommen\n';
const NUR_VERWORFEN = '## Synthese, Runde 1\n\n- fable, "Kontext fehlt" — verworfen, der Satz steht bereits da\n';
const VORSCHLAG_TEXT = "## Body-Vorschlag, Runde 1\n\n## Kontext\n\nDer neue Satz.\n";

/**
 * Ersetzt board.mjs durch einen Wrapper mit zwei Aufgaben.
 *
 * 1. Er protokolliert jeden Aufruf, der ueber ihn laeuft. Die Fake-Session ruft
 *    `board-echt.mjs` unmittelbar auf und erscheint deshalb nicht im Protokoll — was
 *    dort steht, hat der Runner getan (oder der Testaufbau, der nur anlegt und liest).
 * 2. Er leitet `issue-review synthese-check <id>` auf den Datei-Weg desselben Kommandos
 *    um. Damit laeuft die ECHTE Pruefung aus Issue #591/#592 gegen echten Synthese- und
 *    Vorschlagstext; ersetzt ist allein der Eingabeweg, den der lokale Tracker mangels
 *    comments-Array nicht bedienen kann.
 */
function boardMitSyntheseAkte(synthese, vorschlag) {
  return (dir) => {
    const kit = join(dir, ".claude", "kit");
    copyFileSync(join(kit, "board.mjs"), join(kit, "board-echt.mjs"));
    writeFileSync(join(dir, SYNTHESE_DATEI), synthese, "utf-8");
    writeFileSync(join(dir, VORSCHLAG_DATEI), vorschlag, "utf-8");
    writeFileSync(join(kit, "board.mjs"), `import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const wurzel = join(hier, "..", "..");
const roh = process.argv.slice(2);
// Ein Aufruf, eine Zeile: Kommentartexte sind mehrzeilig und ergaeben sonst mehrere.
appendFileSync(join(wurzel, "board-aufrufe.log"), roh.join(" ").replace(/\\s+/g, " ") + "\\n");

const synthese = join(wurzel, ${JSON.stringify(SYNTHESE_DATEI)});
const vorschlag = join(wurzel, ${JSON.stringify(VORSCHLAG_DATEI)});
const umleiten = roh[0] === "issue-review" && roh[1] === "synthese-check" && existsSync(synthese);
const cliArgs = umleiten
  ? ["issue-review", "synthese-check", "--synthese-file", synthese, "--vorschlag-file", vorschlag]
  : roh;
const res = spawnSync(process.execPath, [join(hier, "board-echt.mjs"), ...cliArgs], { stdio: "inherit" });
process.exit(res.status ?? 1);
`, "utf-8");
  };
}

/** Die Board-Aufrufe, die nicht aus der Fake-Session stammen — je Zeile einer. */
function boardAufrufe(dir) {
  const p = join(dir, "board-aufrufe.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean) : [];
}

test("[night-12] Marker gesetzt, Synthese unbelegt -> syntheseOhneBeleg, nicht ohneBefund", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", KONTEXT_BODY);
    const fake = [LOG_PROMPT, MARKER_ANHAENGEN, SYNTHESE_KOMMENTAR].join("; ");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /1 Synthese ohne Beleg/);
    assert.match(res.stdout, /0 ohne Befund/, "der Marker darf den Ausgang nicht mehr entscheiden");
    // Die Reihenfolge der Abschlusszeile ist Teil der Zusage: zwischen Schaerfung und
    // uebersprungen. Wer sie ans Ende haengt, verschiebt die Spalten jeder Auswertung.
    assert.match(res.stdout, /Schaerfung fehlt, 1 Synthese ohne Beleg, \d+ uebersprungen/);
    assert.ok((board(dir, "issue", "get", id).labels || []).includes("kit:klaeren"),
      "der Ausgang zeichnet das Dokument nicht");
    assert.equal(board(dir, "issue", "get", id).status, "backlog");
  }, {}, boardMitSyntheseAkte(OHNE_BELEG, VORSCHLAG_TEXT));
});

test("[night-12] der Ausgang setzt genau ein Label und schreibt keinen Kommentar des Runners", NUR_POSIX, () => {
  // Den Abgleich-Kommentar schreibt der Skill (Issue #593). Ein zweiter Kommentar des
  // Runners doppelte ihn; das Label ist die einzige Board-Schreibung dieses Ausgangs,
  // und es haelt Ready-Gate und Folgenacht von selbst zurueck.
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", KONTEXT_BODY);
    const fake = [LOG_PROMPT, MARKER_ANHAENGEN, SYNTHESE_KOMMENTAR].join("; ");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    // Der Testaufbau legt nur an und liest; jede Schreibung im Protokoll stammt vom
    // Runner, die der Fake-Session laeuft am Wrapper vorbei.
    const runner = boardAufrufe(dir);
    assert.deepEqual(runner.filter((z) => /^issue label /.test(z)), [`issue label add ${id} kit:klaeren`],
      `Protokoll: ${runner.join(" | ")}`);
    assert.deepEqual(runner.filter((z) => /^issue comment\b/.test(z)), []);
    // Gegenprobe: Ohne einen erreichten synthese-check waeren beide Zusagen auch bei
    // einem Lauf gruen, der den Ausgang gar nicht genommen hat.
    assert.deepEqual(runner.filter((z) => /^issue-review synthese-check\b/.test(z)),
      [`issue-review synthese-check ${id}`]);
  }, {}, boardMitSyntheseAkte(OHNE_BELEG, VORSCHLAG_TEXT));
});

test("[night-12] Altsynthese am Board, Session ohne Spur -> ohneErgebnis, kein synthese-check", NUR_POSIX, () => {
  // Ohne die Bedingung „neue Synthese dieser Session" pruefte der Runner die Synthese
  // einer frueheren Nacht und meldete einen Befund, den diese Nacht nicht verursacht
  // hat — waehrend ohneErgebnis, der eigentliche Befund, verschwaende.
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", KONTEXT_BODY);
    board(dir, "issue", "comment", id, "--text", OHNE_BELEG);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /1 ohne Ergebnis/);
    assert.match(res.stdout, /0 Synthese ohne Beleg/);
    assert.deepEqual(boardAufrufe(dir).filter((z) => /synthese-check/.test(z)), []);
  }, {}, boardMitSyntheseAkte(OHNE_BELEG, VORSCHLAG_TEXT));
});

test("[night-12] gepruefte 0 ist kein Ausgang und faellt in die bisherige Wertung", NUR_POSIX, () => {
  // Eine Synthese, die nichts als uebernommen bezeichnet, behauptet keine Textaenderung
  // — da ist nichts zu belegen. Wer `gepruefte: 0` als Befund lese, straft den Lauf fuer
  // eine Abwaegung, die korrekt verworfen hat.
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", KONTEXT_BODY);
    const fake = [LOG_PROMPT, SYNTHESE_KOMMENTAR].join("; ");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /0 Synthese ohne Beleg/);
    assert.match(res.stdout, /1 Schaerfung fehlt/, "erwartet wird die Bestandswertung: Befunde ohne Vorschlag");
  }, {}, boardMitSyntheseAkte(NUR_VERWORFEN, VORSCHLAG_TEXT));
});

test("das Morgen-Ritual des Review-Modus nennt nicht push main", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.doesNotMatch(res.stdout, /push main/);
    assert.match(res.stdout, /Ready/);
  });
});
