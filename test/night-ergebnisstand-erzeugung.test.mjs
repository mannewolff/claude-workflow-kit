// Der Ergebnisstand einer Erzeugungsnacht (Issue #522).
//
// Dieselbe Datei, dasselbe Schema wie im Implementierungs- und im Review-Lauf (#486 bis
// #489) — unterschieden allein durch das Feld `art` mit dem Wert `erzeugung`. Ohne dieses
// Gegenstueck waere eine Erzeugungsnacht die einzige, die sich morgens nicht auswerten
// laesst.
//
// Zwei Stellen tragen die Tests hier:
//
//   1. Das Grundgeruest. `art`, `label` und die Log-Zeile `modus` hingen an Ternaeren mit
//      zwei Aesten; im Erzeugungslauf schrieben sie `implementierung` und `kit:night`.
//      Dazu die `stufe` — aus `label` ist sie nicht ableitbar, weil `--erzeuge-label` den
//      Namen ueberschreiben kann.
//   2. Die Einheit je Ausgangsdokument: die erzeugten Dokumente mit Zustand und
//      Rundenzahl, der Verbrauch des Routing-Labels und der Ausgang aus fester Liste.
//
// Der Lauf faehrt als echter Runner gegen den lokalen Tracker mit einer Fake-Session, die
// wirklich Karten anlegt und wirklich kommentiert — dieselbe Bauart wie
// test/night-erzeugung-pruefschleife.test.mjs.
//
// Issue #557: Die Entstehung haengt nur noch an `--dry-run`, nicht mehr an `--verbose`.
// Ohne das Flag entsteht der Stand ebenfalls, nur ohne Session-Kennzahlen — den Grund
// nennt `kennzahlenHinweis` am Lauf-Kopf.

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
const BOARD = join(repoRoot, "kit", "board.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

/** Fake fuer die Vorflug-Session (Issue #269) — sonst startete jeder Lauf hier eine echte. */
const VORFLUG_FAKE = `cat <<'EOF'
<<<VORFLUG
${JSON.stringify({ reviewers: [], tracker: { erreichbar: true, geprueft: "issue list" } })}
VORFLUG>>>
EOF`;

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: {
      ...process.env,
      KIT_AGENT_MODEL: "fixture-modell",
      KIT_ROOT: cwd,
      NIGHT_VORFLUG_CMD: VORFLUG_FAKE,
      ...env,
    },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-erzeugung-stand-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(BOARD, join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
    issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  // Bewusst OHNE `.claude/*`: Der Ergebnisstand muss untracked sichtbar bleiben, sonst
  // pruefte der Dirty-Test die falsche Datei. Das Textprotokoll bleibt ignoriert.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\naufrufe.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function mitProjekt(fn) {
  const dir = setupProjekt();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Legt eine Karte an; Labels stehen beim lokalen Tracker als CSV im Frontmatter. */
function karte(dir, titel, body, label = "") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  if (label) {
    const pfad = join(dir, "issues", `${issue.id}.md`);
    const roh = readFileSync(pfad, "utf-8");
    writeFileSync(pfad, roh.replace(/^status:/m, `labels: ${label}\nstatus:`), "utf-8");
  }
  return String(issue.id);
}

const PLAN_GEPRUEFT = "## Kontext\n\nAutor-Modell: claude-opus-5\nPlan-Review: fable (2026-09-08)\n\n"
  + "## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- night.mjs laeuft.\n";
const PLAN_UNGEPRUEFT = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n"
  + "## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- night.mjs laeuft.\n";
const ERZEUGE_LABEL = "kit:nightissues";

/** Die Quelle eines `--stufe issue`-Laufs: ein geprueftes Plandokument mit Routing-Label. */
function quelle(dir, titel = "Ein Weg", body = PLAN_GEPRUEFT) {
  return karte(dir, `[Plan] ${titel}`, body, ERZEUGE_LABEL);
}

/** Ein Arbeitspaket der Quelle — so, wie eine Erzeugungs-Session es angelegt haette. */
function paket(dir, quelleId, titel) {
  return karte(dir, titel, `## Kontext\n\nPlan: Issue #${quelleId}\n`);
}

const BOARD_IM_FAKE = '"$KIT_ROOT/.claude/kit/board.mjs"';

// Die `result`-Zeile aus dem Fixture von test/night-kennzahlen.test.mjs — echte Feldnamen
// aus einer echten Session, gekuerzt in den Textfeldern.
const RESULT_ZEILE =
  '{"is_error":false,"duration_api_ms":296247,"num_turns":37,"stop_reason":"end_turn",'
  + '"session_id":"8945efcc","total_cost_usd":2.4124460000000005,'
  + '"usage":{"input_tokens":70,"output_tokens":17688,"service_tier":"standard"},'
  + '"modelUsage":{"claude-opus-5":{"costUSD":2.4124460000000005}},"permission_denials":[],'
  + '"result":"Abschlussbericht gekuerzt.","ttft_ms":2744,"time_to_request_ms":35,'
  + '"type":"result","duration_ms":382540,"uuid":"d967193f"}';
const RESULT_AUSGEBEN = `echo '${RESULT_ZEILE}'`;

/**
 * Baut die Fake-Session: Sie unterscheidet die beiden Phasen am Auftrag.
 *
 * `/issues #Quelle` legt Arbeitspakete an (Phase 1), `/issue-review #Dokument` hinterlaesst,
 * was `pruefTeil` vorgibt (Phase 2). Beide Zweige geben die `result`-Zeile aus — sonst
 * saehe ein vergessener leseKennzahlen-Aufruf aus wie ein korrekter.
 */
function fake(pruefTeil, pakete = 1) {
  const nummern = Array.from({ length: pakete }, (_, i) => i + 1).join(" ");
  const anlegen = pakete === 0
    ? "true"
    : `for i in ${nummern}; do node ${BOARD_IM_FAKE} issue create --title "Paket $i" `
      + `--body "## Kontext\n\nPlan: Issue #$NIGHT_ISSUE_ID\n" > /dev/null; done`;
  return `${RESULT_AUSGEBEN}
case "$NIGHT_PROMPT" in
  /issue-review*) ${pruefTeil} ;;
  *) ${anlegen} ;;
esac`;
}

/** Ein Kommentar mit dem Runden-Anker der Stufe issue — eine gelaufene Pruefrunde. */
const BEFUND = `node ${BOARD_IM_FAKE} issue comment "$NIGHT_ISSUE_ID" --text '## Issue-Review, Runde 1

Ein Befund.' > /dev/null`;

// Der Ausfall steht in Zeile ZWEI: Zeile 1 traegt den Anker, und beides zugleich geht
// nicht (Festlegung aus Issue #381, gelesen von reviewZustand).
const AUSFALL = `node ${BOARD_IM_FAKE} issue comment "$NIGHT_ISSUE_ID" --text '## Issue-Review, Runde 1
Reviewer fable ausgefallen.

Kein Befund.' > /dev/null`;

function erzeuge(dir, sessionFake, extraArgs = []) {
  return run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "issue", "--verbose", ...extraArgs],
    { NIGHT_CLAUDE_CMD: sessionFake });
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

/** Die Einheit zu einer Quelle — der Zugriff ueber die ID, nicht ueber die Position. */
function einheit(s, id) {
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

// --- Das Grundgeruest ---

test("[night-9] ein Erzeugungslauf hinterlaesst art erzeugung, das Routing-Label, die Stufe und abschluss regulaer", NUR_POSIX, () => {
  mitProjekt((dir) => {
    quelle(dir);
    const res = erzeuge(dir, fake(BEFUND));
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const s = stand(dir);
    assert.equal(Object.keys(s)[0], "schemaFassung", "die Fassung steht nicht zuerst");
    assert.equal(s.schemaFassung, 1, "alle Felder sind additiv, die Fassung bleibt");
    assert.equal(s.art, "erzeugung", "die dritte Betriebsart unterscheidet den Lauf");
    // Ohne den Lookup in vorbereiten stuende hier DEFAULT_LABEL statt des Routing-Labels.
    assert.equal(s.label, ERZEUGE_LABEL);
    assert.equal(s.stufe, "issue", "aus dem Label allein ist die Stufe nicht ableitbar");
    assert.equal(s.abschluss, "regulaer", "ein sauber beendeter Lauf darf nicht wie ein Absturz aussehen");
  });
});

test("[night-9] die Log-Zeile nennt den Modus Erzeugung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    quelle(dir);
    const res = erzeuge(dir, fake(BEFUND));
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /Nacht-Runner startet \(Modus Erzeugung/);
  });
});

// --- Die Einheit je Ausgangsdokument ---

test("[night-9] die Einheit nennt das erzeugte Dokument mit Zustand, Runden und Sessions und meldet den Label-Verbrauch", NUR_POSIX, () => {
  // Drei Runden mit Befund und ohne Marker: `reviewZustand` liefert `grenze`, und das ist
  // ein Endzustand — das Routing-Label faellt.
  mitProjekt((dir) => {
    const src = quelle(dir);
    const res = erzeuge(dir, fake(BEFUND));
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const e = einheit(stand(dir), src);
    assert.equal(e.titel, "[Plan] Ein Weg", "die Einheit nennt den Titel der Quelle");
    assert.equal(e.ausgang, "verbraucht");
    assert.equal(e.labelEntfernt, true, "der Verbrauch steht als eigenes Feld");
    assert.equal(e.fortgesetzt, false, "die Erzeugungs-Session lief");
    assert.equal(e.erzeugt.length, 1, `genau ein Dokument erwartet: ${JSON.stringify(e.erzeugt)}`);

    const dok = e.erzeugt[0];
    assert.equal(dok.id, String(board(dir, "issue", "list")
      .find((i) => !i.title.startsWith("[Plan]")).id), "die Kartennummer als String");
    // Woertlich der Rueckgabewert von reviewZustand — kein eigenes Vokabular.
    assert.equal(dok.zustand, "grenze");
    assert.equal(dok.runden, 3, "die Rundenzahl stammt aus den Kommentar-Ankern");
    assert.equal(dok.sessions.length, 3, "ein Eintrag je Pruefrunde");
    assert.equal(dok.sessions[0].kennzahlen.kostenUsd, 2.4124460000000005, "die Kosten stammen aus der result-Zeile");

    // Die Kennzahlen der Einheit bleiben die der Erzeugungs-Session, die Dauer summiert.
    assert.equal(e.kennzahlen.zuege, 37);
    const summe = dok.sessions.reduce((n, s) => n + s.dauerMs, 0);
    assert.ok(e.dauerMs >= summe, `dauerMs (${e.dauerMs}) ist nicht die Summe ueber alle Sessions (>= ${summe})`);
  });
});

test("[night-9] eine Session ohne Dokument endet mit ohneErgebnis und labelEntfernt false", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const src = quelle(dir);
    const res = erzeuge(dir, fake(BEFUND, 0));
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const e = einheit(stand(dir), src);
    assert.equal(e.ausgang, "ohneErgebnis");
    assert.equal(e.labelEntfernt, false, "ohne Dokument darf sich die Freigabe nicht verbrauchen");
    assert.deepEqual(e.erzeugt, []);
  });
});

test("[night-9] ein Dokument ohne Endzustand laesst die Einheit offen", NUR_POSIX, () => {
  // `ausgefallen` ist kein Endzustand: ein technisches Scheitern, kein Ergebnis. Die
  // Freigabe bleibt stehen — und das ist etwas anderes als `ohneErgebnis`.
  mitProjekt((dir) => {
    const src = quelle(dir);
    paket(dir, src, "Paket A");
    const res = erzeuge(dir, fake(AUSFALL));
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const e = einheit(stand(dir), src);
    assert.equal(e.ausgang, "offen");
    assert.equal(e.labelEntfernt, false);
    assert.equal(e.erzeugt[0].zustand, "ausgefallen");
  });
});

test("[night-9] entfaellt die Erzeugungs-Session, traegt die Einheit fortgesetzt true", NUR_POSIX, () => {
  // Am Morgen ist genau das die Frage: hat die Nacht etwas angelegt oder nur weitergeprueft?
  mitProjekt((dir) => {
    const src = quelle(dir);
    const a = paket(dir, src, "Paket A");
    const res = erzeuge(dir, fake(BEFUND));
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const e = einheit(stand(dir), src);
    assert.equal(e.fortgesetzt, true);
    assert.equal(e.erzeugt.length, 1, "das vorgefundene Dokument gehoert in die Liste");
    assert.equal(e.erzeugt[0].id, a);
    // Ohne Erzeugungs-Session gibt es keine Kennzahlen — eine erfundene Null waere falsch.
    assert.equal(e.kennzahlen, null);
    assert.equal(e.ausgang, "verbraucht");
  });
});

// --- Die uebersprungenen Quellen ---

test("[night-9] eine Quelle ohne Stufenmarker steht als uebersprungen mit Grund in der Datei", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const src = quelle(dir);
    const ohne = quelle(dir, "Ungeprueft", PLAN_UNGEPRUEFT);
    const res = erzeuge(dir, fake(BEFUND));
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const s = stand(dir);
    const e = einheit(s, ohne);
    assert.equal(e.ausgang, "uebersprungen");
    assert.match(e.grund, /Plan-Review/, `der Grund nennt den Marker nicht: ${e.grund}`);
    // Die Summe: keine Quelle faellt unter den Tisch.
    assert.equal(einheit(s, src).ausgang, "verbraucht");
    assert.equal(s.einheiten.length, 2, `zwei Einheiten erwartet: ${JSON.stringify(s.einheiten)}`);
  });
});

test("[night-9] eine Quelle ueber --max bleibt als liegengeblieben in der Datei stehen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const erste = quelle(dir, "Kommt dran");
    const zweite = quelle(dir, "Bleibt liegen");
    const res = erzeuge(dir, fake(BEFUND), ["--max", "1"]);
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const s = stand(dir);
    assert.equal(einheit(s, erste).ausgang, "verbraucht");
    assert.equal(einheit(s, zweite).ausgang, "liegengeblieben");
  });
});

// --- Die Ausstiege ---

test("[night-9] eine Session, die den Working Tree veraendert, hinterlaesst harterStopp mit Fehlerklasse", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const src = quelle(dir);
    const res = erzeuge(dir, `${fake(BEFUND)}\necho rest > uebrig.txt`);
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp", "ein erkannter Stopp darf nicht wie ein Absturz aussehen");
    assert.equal(s.fehlerklasse, "harterStopp");
    // Der Guard bricht VOR jeder Bewertung ab — die Quelle blieb unbeurteilt.
    assert.equal(einheit(s, src).ausgang, "unbekannt");
  });
});

test("[night-9] ein Erzeugungslauf ohne Kandidaten endet regulaer", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = erzeuge(dir, fake(BEFUND));
    assert.equal(res.status, 0, res.stderr + res.stdout);
    const s = stand(dir);
    assert.equal(s.art, "erzeugung");
    assert.equal(s.abschluss, "regulaer");
    assert.deepEqual(s.einheiten, [], "ohne Kandidaten gibt es nichts zu berichten");
  });
});

test("[night-9] ohne --verbose entsteht auch im Erzeugungsmodus der Stand, mit kennzahlenHinweis", NUR_POSIX, () => {
  mitProjekt((dir) => {
    quelle(dir);
    const res = run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "issue"],
      { NIGHT_CLAUDE_CMD: fake(BEFUND) });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    const s = stand(dir);
    assert.equal(s.art, "erzeugung", "die Betriebsart steht auch ohne das Flag in der Datei");
    assert.ok(
      typeof s.kennzahlenHinweis === "string" && s.kennzahlenHinweis.length > 0,
      `kennzahlenHinweis muss den Grund nennen, ist ${JSON.stringify(s.kennzahlenHinweis)}`,
    );
  });
});

test("[night-9] mit --dry-run entsteht im Erzeugungsmodus weiterhin keine Datei", NUR_POSIX, () => {
  mitProjekt((dir) => {
    quelle(dir);
    const res = erzeuge(dir, fake(BEFUND), ["--dry-run"]);
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.deepEqual(staende(dir), [], "ein Dry-Run arbeitet nichts ab und hat nichts zu berichten");
  });
});
