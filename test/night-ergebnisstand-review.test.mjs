// Der Ergebnisstand eines Review-Laufs (Issue #489).
//
// Dieselbe Datei, dasselbe Schema wie im Implementierungslauf (#486 bis #488) —
// unterschieden allein durch das Feld `art` mit dem Wert `review`. Der Leitstand soll
// beide Betriebsarten gleich auswerten koennen.
//
// Die Klemmstelle sind die Ausstiege: Der Review-Modus beendet den Prozess selbst und
// kaeme an einem Abschluss in main() nie an. Ein Review-Lauf ohne `abschluss` saehe
// aus wie ein Absturz — deshalb setzt ihn hier jeder Ausgang selbst.
//
// Issue #557: Die Entstehung haengt nur noch an `--dry-run`, nicht mehr an `--verbose`.
// Ein Review-Lauf ohne das Flag hinterlaesst denselben Stand, nur ohne Session-Kennzahlen
// — den Grund nennt `kennzahlenHinweis` am Lauf-Kopf.
//
// Muster wie test/night-review-loop.test.mjs: Subprozess ueber spawnSync, kein Import,
// Session-Fake ueber NIGHT_CLAUDE_CMD, Vorflug-Fake ueber NIGHT_VORFLUG_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

// Ohne diesen Hook startete jeder Test hier eine echte claude-Session; der Fake
// meldet "alles steht" (Muster aus night-review-loop.test.mjs).
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

function setupProjekt(praefix, vorGitCommit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  // Bewusst OHNE `.claude/*`: Der Ergebnisstand muss untracked sichtbar bleiben, sonst
  // pruefte der Dirty-Test die falsche Datei. Das Textprotokoll bleibt ignoriert.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\naufrufe.log\n");
  // Alles, was der Lauf vorfindet, aber nicht selbst anlegt, gehoert VOR den Commit —
  // sonst schlaegt der Rest-Guard an, bevor eine Runde bewertet wird.
  vorGitCommit(dir);
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";
const MIT_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\nIssue-Review: sonnet, fable (2026-08-06)\n\n## Abhaengigkeiten\n\nKeine.\n";

/** Erzeugt ein Backlog-Issue mit dem Review-Label und liefert seine ID als String. */
function backlogIssue(dir, titel, body) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  const pfad = join(dir, "issues", `${issue.id}.md`);
  const roh = readFileSync(pfad, "utf-8");
  writeFileSync(pfad, roh.replace(/^status:/m, "labels: kit:nightreview\nstatus:"), "utf-8");
  return String(issue.id);
}

function mitProjekt(praefix, fn, vorGitCommit) {
  const dir = setupProjekt(praefix, vorGitCommit);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
function einheit(s, id) {
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

// --- Session-Fakes ---

const BOARD = '"$KIT_ROOT/.claude/kit/board.mjs"';
const FAKE_MARKER = `node ${BOARD} issue update "$NIGHT_ISSUE_ID" --body "## Kontext

Autor-Modell: claude-opus-5
Issue-Review: opus, sonnet (2026-08-06, Nachtlauf)

## Abhaengigkeiten

Keine."`;
const FAKE_STUMM = "true";

// Die `result`-Zeile aus dem Fixture von test/night-kennzahlen.test.mjs — echte
// Feldnamen aus einer echten Session, gekuerzt in den Textfeldern.
const RESULT_ZEILE =
  '{"is_error":false,"duration_api_ms":296247,"num_turns":37,"stop_reason":"end_turn",' +
  '"session_id":"8945efcc","total_cost_usd":2.4124460000000005,' +
  '"usage":{"input_tokens":70,"output_tokens":17688,"service_tier":"standard"},' +
  '"modelUsage":{"claude-opus-5":{"costUSD":2.4124460000000005}},"permission_denials":[],' +
  '"result":"Abschlussbericht gekuerzt.","ttft_ms":2744,"time_to_request_ms":35,' +
  '"type":"result","duration_ms":382540,"uuid":"d967193f"}';
const RESULT_AUSGEBEN = `echo '${RESULT_ZEILE}'`;

test("[night-5] ein Review-Lauf hinterlaesst art review, abschluss regulaer und den Kandidaten mit Ausgang, Dauer und Kennzahlen", NUR_POSIX, () => {
  mitProjekt("night-review-stand-", (dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const fake = [RESULT_AUSGEBEN, FAKE_MARKER].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.art, "review", "die Betriebsart unterscheidet die beiden Laeufe");
    assert.equal(s.abschluss, "regulaer", "ein sauber beendeter Lauf darf nicht wie ein Absturz aussehen");

    const e = einheit(s, id);
    // Woertlich der Rueckgabewert von werteReviewSession — kein eigenes Vokabular.
    assert.equal(e.ausgang, "ohneBefund");
    assert.equal(e.titel, "Ein Issue", "die Einheit nennt den Titel des Kandidaten");
    assert.equal(typeof e.dauerMs, "number", `dauerMs muss eine Zahl sein, ist ${JSON.stringify(e.dauerMs)}`);
    // Ohne diesen Fall saehe ein vergessener leseKennzahlen-Aufruf aus wie ein korrekter.
    assert.equal(e.kennzahlen.kostenUsd, 2.4124460000000005, "die Kosten stammen aus der result-Zeile");
    assert.equal(e.kennzahlen.zuege, 37);
    // Ein Review-Lauf faehrt keine Pflicht-Checks — ein Pruefstand waere hier erfunden.
    assert.equal(e.pruefung ?? null, null, "der Review-Lauf hat keinen Pruefstand zu melden");
  });
});

test("ein Kandidat mit Befund traegt den Ausgang mitBefund", NUR_POSIX, () => {
  mitProjekt("night-review-stand-befund-", (dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const fake = `node ${BOARD} issue comment "$NIGHT_ISSUE_ID" --text "BLOCKER: fehlt was"; `
      + `node ${BOARD} issue comment "$NIGHT_ISSUE_ID" --text '## Body-Vorschlag, Runde 1\n\n## Kontext\n\nGeschaerfter Text.'`;
    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(einheit(stand(dir), id).ausgang, "mitBefund");
  });
});

test("uebersprungene, ausgelassene und liegengebliebene Kandidaten stehen als eigene Einheiten in der Datei", NUR_POSIX, () => {
  mitProjekt("night-review-stand-summe-", (dir) => {
    // Die Reihenfolge ist Teil des Falls: Der --max-Zweig greift VOR dem Marker-Check,
    // das Marker-Issue muss also vor der einen erlaubten Session liegen.
    const mitMarker = backlogIssue(dir, "Schon geprueft", MIT_MARKER);
    const geprueft = backlogIssue(dir, "Kommt dran", OHNE_MARKER);
    const liegt = backlogIssue(dir, "Bleibt liegen", OHNE_MARKER);
    const idee = backlogIssue(dir, "[Idee] Roher Einfall", OHNE_MARKER);

    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose", "--max", "1"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    // Die Idee fliegt schon in selectReviewCandidates raus — mit ihrem Grund.
    const eIdee = einheit(s, idee);
    assert.equal(eIdee.ausgang, "uebersprungen");
    assert.match(eIdee.grund, /Idee/, `der Grund nennt den Ausschluss nicht: ${eIdee.grund}`);

    // Die dritte Kategorie: in der Schleife wegen eines vorhandenen Stufen-Markers
    // ausgelassen. Ohne sie zaehlte der Stand weniger Kandidaten als das Protokoll.
    const eMarker = einheit(s, mitMarker);
    assert.equal(eMarker.ausgang, "uebersprungen");
    assert.match(eMarker.grund, /Marker/, `der Grund nennt den Marker nicht: ${eMarker.grund}`);

    assert.equal(einheit(s, geprueft).ausgang, "ohneBefund");
    assert.equal(einheit(s, liegt).ausgang, "liegengeblieben");

    // Die Summe: geprueft + uebersprungen + liegengeblieben, keiner faellt unter den Tisch.
    assert.equal(s.einheiten.length, 4, `vier Einheiten erwartet: ${JSON.stringify(s.einheiten)}`);
    assert.equal(s.abschluss, "regulaer");
  });
});

test("ein Review-Lauf, der am Working-Tree-Guard stoppt, traegt harterStopp und den laufenden Kandidaten als unbekannt", NUR_POSIX, () => {
  mitProjekt("night-review-stand-dirty-", (dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const dreckig = `${FAKE_STUMM}; echo rest > uebrig.txt`;
    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose"], { NIGHT_CLAUDE_CMD: dreckig });
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp", "ein erkannter Stopp darf nicht wie ein Absturz aussehen");
    assert.equal(s.fehlerklasse, "harterStopp");
    // Der Guard bricht VOR werteReviewSession ab — die Runde wurde nie bewertet.
    assert.equal(einheit(s, id).ausgang, "unbekannt");
  });
});

test("ein gescheiterter Session-Start traegt die Fehlerklasse umgebung", NUR_POSIX, () => {
  mitProjekt("night-review-stand-infra-", (dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose"], { NIGHT_CLAUDE_CMD: "exit 1" });
    assert.notEqual(res.status, 0, `der Infrastruktur-Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp");
    assert.equal(s.fehlerklasse, "umgebung", "mit dem Issue ist nichts falsch — die Umgebung ist es");
    assert.equal(einheit(s, id).ausgang, "unbekannt");
  });
});

test("ein Vorflug-Abbruch im Review-Modus schliesst den Stand ebenfalls ab", NUR_POSIX, () => {
  mitProjekt("night-review-stand-vorflug-", (dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    // Die Vorflug-Session fasst den Arbeitsbaum an — der Lauf endet vor der ersten
    // Review-Session, und zwar ueber den eigenen Guard, nicht ueber fail().
    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose"],
      { NIGHT_CLAUDE_CMD: FAKE_STUMM, NIGHT_VORFLUG_CMD: `${VORFLUG_OK}\necho rest > uebrig.txt` });
    assert.notEqual(res.status, 0, `der Vorflug-Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp");
    assert.equal(s.fehlerklasse, "harterStopp");
  });
});

test("ein Review-Lauf ohne Kandidaten endet regulaer", NUR_POSIX, () => {
  mitProjekt("night-review-stand-leer-", (dir) => {
    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const s = stand(dir);
    assert.equal(s.abschluss, "regulaer");
    assert.deepEqual(s.einheiten, [], "ohne Kandidaten gibt es nichts zu berichten");
  });
});

test("[night-5] ohne --verbose entsteht auch im Review-Modus der Stand, mit kennzahlenHinweis", NUR_POSIX, () => {
  mitProjekt("night-review-stand-still-", (dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const s = stand(dir);
    assert.equal(s.art, "review", "die Betriebsart steht auch ohne das Flag in der Datei");
    assert.ok(
      typeof s.kennzahlenHinweis === "string" && s.kennzahlenHinweis.length > 0,
      `kennzahlenHinweis muss den Grund nennen, ist ${JSON.stringify(s.kennzahlenHinweis)}`,
    );
  });
});

// --- Der fuenfte Ausgang (Issue #594) ---
//
// Der Ausgang traegt als einziger einen Grund an der Einheit: Am Board steht nur das
// Label, den Abgleich-Kommentar schreibt der Skill. Ohne den Text im Stand muesste ein
// Leitstand morgens raten, WELCHE Behauptung unbelegt blieb.

const SYNTHESE_DATEI = "synthese-fixture.md";
const VORSCHLAG_DATEI = "vorschlag-fixture.md";

// Zwei Uebernahmen, zwei verschiedene Gruende: eine ohne jede Beleg-Angabe, eine mit
// einem Zitat, das im Vorschlag nicht vorkommt.
const ZWEI_OHNE_BELEG = '## Synthese, Runde 1\n\n'
  + '- fable, "Kontext fehlt" — uebernommen\n'
  + '- gpt-astra, "Kriterium unscharf" — uebernommen → Akzeptanzkriterium: "steht so nirgends"\n';
const VORSCHLAG_TEXT = "## Body-Vorschlag, Runde 1\n\n## Kontext\n\nDer neue Satz.\n";

const KONTEXT_BODY = "## Kontext\n\nAutor-Modell: claude-opus-5\n";
const SYNTHESE_KOMMENTAR = `node ${BOARD} issue comment "$NIGHT_ISSUE_ID" --text '## Synthese, Runde 1

- fable, "Kontext fehlt" — uebernommen'`;

/**
 * Wie in test/night-review-loop.test.mjs: board.mjs wird zum Wrapper, der
 * `issue-review synthese-check <id>` auf den Datei-Weg desselben Kommandos umlegt. Der
 * lokale Tracker haengt Kommentare an den Body und liefert kein comments-Array — ueber
 * die Kartennummer faende die echte Pruefung dort nie eine Synthese.
 */
function boardMitSyntheseAkte(dir) {
  const kit = join(dir, ".claude", "kit");
  copyFileSync(join(kit, "board.mjs"), join(kit, "board-echt.mjs"));
  writeFileSync(join(dir, SYNTHESE_DATEI), ZWEI_OHNE_BELEG, "utf-8");
  writeFileSync(join(dir, VORSCHLAG_DATEI), VORSCHLAG_TEXT, "utf-8");
  writeFileSync(join(kit, "board.mjs"), `import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const wurzel = join(hier, "..", "..");
const roh = process.argv.slice(2);
const synthese = join(wurzel, ${JSON.stringify(SYNTHESE_DATEI)});
const vorschlag = join(wurzel, ${JSON.stringify(VORSCHLAG_DATEI)});
const umleiten = roh[0] === "issue-review" && roh[1] === "synthese-check" && existsSync(synthese);
const cliArgs = umleiten
  ? ["issue-review", "synthese-check", "--synthese-file", synthese, "--vorschlag-file", vorschlag]
  : roh;
const res = spawnSync(process.execPath, [join(hier, "board-echt.mjs"), ...cliArgs], { stdio: "inherit" });
process.exit(res.status ?? 1);
`, "utf-8");
}

test("[night-12] der Ausgang syntheseOhneBeleg traegt je unbelegtem Fund eine Grundzeile", NUR_POSIX, () => {
  mitProjekt("night-review-stand-synthese-", (dir) => {
    const id = backlogIssue(dir, "Ein Issue", KONTEXT_BODY);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--verbose"], { NIGHT_CLAUDE_CMD: SYNTHESE_KOMMENTAR });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    // Die Schemafassung bleibt unveraendert: Der Ausgang nutzt das vorhandene Feld
    // `grund`, statt der Einheit ein neues anzuhaengen.
    assert.equal(s.schemaFassung, 1);
    const e = einheit(s, id);
    assert.equal(e.ausgang, "syntheseOhneBeleg");
    assert.deepEqual(e.grund.split("\n"), [
      'fable: „Kontext fehlt" — beleg-fehlt',
      'gpt-astra: „Kriterium unscharf" — zitat-nicht-gefunden',
    ]);
  }, boardMitSyntheseAkte);
});

test("[night-5] mit --dry-run entsteht im Review-Modus weiterhin keine Datei", NUR_POSIX, () => {
  mitProjekt("night-review-stand-dry-", (dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run", "--verbose"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(staende(dir), [], "ein Dry-Run arbeitet nichts ab und hat nichts zu berichten");
  });
});
