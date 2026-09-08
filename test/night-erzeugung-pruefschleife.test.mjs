// Phase 2 der Erzeugungsschleife: Pruefrunden und Label-Verbrauch (Issue #521).
//
// Ein erzeugtes Dokument ist nichts wert, solange es ungeprueft im Backlog liegt. Phase 2
// laesst jedes Dokument in eigenen Sessions pruefen und verbraucht die Freigabe der Quelle
// — das Routing-Label — erst, wenn wirklich etwas geschehen ist.
//
// Zwei Festlegungen tragen die Tests hier:
//
//   1. Endzustand haengt am ABGELEITETEN Zustand (`reviewZustand` aus board.mjs) und nicht
//      an den `review:*`-Labels. Die schreibt nur `label-sync`, und das braucht
//      `issueReview.statusLabels: true` — ohne Opt-in fiele das Routing-Label nie.
//   2. Der Runner setzt Labels nie, er nimmt nur ab. Deshalb protokolliert ein Test jeden
//      board.mjs-Aufruf des Laufs und weist nach, dass `label add` nicht darunter ist.
//
// Der Lauf faehrt als echter Runner gegen den lokalen Tracker mit einer Fake-Session,
// die wirklich Karten anlegt und wirklich kommentiert — dieselbe Bauart wie
// test/night-erzeugung-signal.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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

/**
 * `vorGitCommit` laeuft, bevor der Ausgangszustand festgeschrieben wird — dort gehoert
 * jede Datei hin, die der Lauf spaeter vorfindet, aber nicht selbst anlegt. Ein
 * nachtraeglich geschriebener board.mjs-Wrapper machte den Working Tree schmutzig, und
 * night.mjs bricht dann vor dem ersten Schritt ab.
 */
function setupProjekt(vorGitCommit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-erzeugung-pruef-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(BOARD, join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
    issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  // Alle Protokolle der Fakes enden auf .log: night.mjs stoppt hart, wenn eine Session
  // den Working Tree veraendert.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
  vorGitCommit(dir);
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function mitProjekt(fn, vorGitCommit) {
  const dir = setupProjekt(vorGitCommit);
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
const ERZEUGE_LABEL = "kit:nightissues";

/** Die Quelle eines `--stufe issue`-Laufs: ein geprueftes Plandokument mit Routing-Label. */
function quelle(dir, titel = "Ein Weg") {
  return karte(dir, `[Plan] ${titel}`, PLAN_GEPRUEFT, ERZEUGE_LABEL);
}

/** Ein Arbeitspaket der Quelle — so, wie eine Erzeugungs-Session es angelegt haette. */
function paket(dir, quelleId, titel, zusatz = "", label = "") {
  return karte(dir, titel, `## Kontext\n\nPlan: Issue #${quelleId}\n${zusatz}`, label);
}

const MARKER_ZEILE = "Issue-Review: fable (2026-09-08)\n";

const BOARD_IM_FAKE = '"$KIT_ROOT/.claude/kit/board.mjs"';
// Nur die erste Prompt-Zeile: Seit dem Modus-Hinweis (Issue #419) ist der Auftrag
// mehrzeilig, und `prompts()` zaehlt Zeilen.
const LOG_PROMPT = 'echo "$NIGHT_PROMPT" | head -1 >> aufrufe.log';

/** Die ersten Prompt-Zeilen der Sessions dieses Laufs, in ihrer Reihenfolge. */
function prompts(dir) {
  const p = join(dir, "aufrufe.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean) : [];
}

/** Wie oft `/issue-review #id` beauftragt wurde. */
function pruefSessions(dir, id = null) {
  return prompts(dir).filter((z) => z.startsWith(id === null ? "/issue-review #" : `/issue-review #${id}`)).length;
}

/**
 * Baut die Fake-Session: Sie unterscheidet die beiden Phasen am Auftrag.
 *
 * `/issues #Quelle` legt Arbeitspakete an (Phase 1), `/issue-review #Dokument` hinterlaesst,
 * was `pruefTeil` vorgibt (Phase 2). Ohne diese Unterscheidung liefe derselbe Fake in
 * beiden Phasen und legte in der Pruefrunde neue Karten an.
 */
function fake(pruefTeil, pakete = 1) {
  const nummern = Array.from({ length: pakete }, (_, i) => i + 1).join(" ");
  const anlegen = `for i in ${nummern}; do node ${BOARD_IM_FAKE} issue create --title "Paket $i" `
    + `--body "## Kontext\n\nPlan: Issue #$NIGHT_ISSUE_ID\n" > /dev/null; done`;
  return `${LOG_PROMPT}
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

// Der Marker geht ueber `issue update`: Beim lokalen Tracker ersetzt das den Body, ein
// zusaetzlich gesetzter Kommentar-Anker fiele weg. Genau deshalb steht die
// Endzustands-Pruefung vor der Anker-Pruefung — sonst gaelte diese Session als "ohne neue
// Runde" und das Label bliebe an einem fertig geprueften Dokument haengen.
const MARKER = `node ${BOARD_IM_FAKE} issue update "$NIGHT_ISSUE_ID" --body "## Kontext

${MARKER_ZEILE}" > /dev/null`;

function erzeuge(dir, sessionFake, extraArgs = []) {
  return run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "issue", ...extraArgs],
    { NIGHT_CLAUDE_CMD: sessionFake });
}

/** Die Labels der Quelle nach dem Lauf. */
function labels(dir, id) {
  return board(dir, "issue", "get", id).labels || [];
}

/** Die Nummer des einzigen Arbeitspakets, das die Quelle hervorgebracht hat. */
function paketIdVon(dir, quelleId) {
  const treffer = board(dir, "issue", "list")
    .filter((i) => !i.title.startsWith("[Plan]") && (i.body || "").includes(`Plan: Issue #${quelleId}\n`));
  assert.equal(treffer.length, 1, `kein eindeutiges Arbeitspaket zu #${quelleId}`);
  return String(treffer[0].id);
}

// --- Die Rundengrenze ---

test("[night-8] nach der dritten Pruefrunde faellt das Routing-Label der Quelle", NUR_POSIX, () => {
  // Drei Runden mit Befund und ohne Marker: `reviewZustand` liefert `grenze`, und das ist
  // ein Endzustand. Weitere Runden braeuchten es nicht — das Dokument wartet auf einen
  // Menschen, nicht auf den vierten Reviewer.
  mitProjekt((dir) => {
    const src = quelle(dir);
    const res = erzeuge(dir, fake(BEFUND));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(pruefSessions(dir), 3, "es liefen nicht genau drei Pruefrunden");
    assert.deepEqual(labels(dir, src), [], `'${ERZEUGE_LABEL}' steht noch an der Quelle`);
  });
});

test("[night-8] ein Marker in Runde 1 beendet die Schleife und das Label faellt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const src = quelle(dir);
    const res = erzeuge(dir, fake(MARKER));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(pruefSessions(dir), 1, "nach dem Marker lief eine weitere Pruefrunde");
    assert.deepEqual(labels(dir, src), []);
  });
});

// --- Die Endzustaende ohne Session ---

test("[night-8] ein Dokument mit kit:klaeren bekommt keine Session und das Label faellt", NUR_POSIX, () => {
  // `kit:klaeren` traegt eine offene Entscheidung fuer einen Menschen. Das ist ein Ende,
  // kein Loch: Der Schritt ist zu Ende gekommen, die Freigabe ist verbraucht.
  mitProjekt((dir) => {
    const src = quelle(dir);
    paket(dir, src, "Paket A", "", "kit:klaeren");

    const res = erzeuge(dir, fake(BEFUND));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(pruefSessions(dir), 0, "ein Dokument mit kit:klaeren wurde geprueft");
    assert.deepEqual(labels(dir, src), []);
  });
});

test("[night-8] ein Dokument mit Marker aus der Vornacht bekommt keine Session", NUR_POSIX, () => {
  // #408: "Ist der Schritt dagegen zu Ende gekommen, wiederholt der Durchlauf ihn nicht
  // von selbst." Ohne die Vorpruefung startete die zweite Nacht eine Session an einem
  // fertigen Dokument.
  mitProjekt((dir) => {
    const src = quelle(dir);
    paket(dir, src, "Paket A", MARKER_ZEILE);

    const res = erzeuge(dir, fake(BEFUND));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(prompts(dir).length, 0, "es lief ueberhaupt eine Session");
    assert.deepEqual(labels(dir, src), []);
  });
});

// --- Die beiden Abbrueche ohne Endzustand ---

test("[night-8] eine Session ohne neuen Anker endet nach genau einer Runde, das Label bleibt", NUR_POSIX, () => {
  // Die vierte Abbruchbedingung. Ohne sie liefe die Schleife endlos: Eine Session, die per
  // Timeout stirbt (ausdruecklich kein harter Stopp) oder nichts schreibt, erhoeht den
  // abgeleiteten Rundenstand nicht — und `--max` zaehlt hier Ausgangsdokumente, nicht
  // Sessions.
  mitProjekt((dir) => {
    const src = quelle(dir);
    paket(dir, src, "Paket A");

    const res = erzeuge(dir, fake("true"));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(pruefSessions(dir), 1, "die Schleife lief weiter, obwohl nichts entstand");
    assert.deepEqual(labels(dir, src), [ERZEUGE_LABEL], "das Label wurde ohne Endzustand verbraucht");
  });
});

test("[night-8] ein Ausfall beendet nur dieses Dokument, das Label bleibt", NUR_POSIX, () => {
  // `ausgefallen` ist kein Endzustand: Es ist ein technisches Scheitern, kein Ergebnis.
  // Die Schleife endet fuer dieses Dokument, die uebrigen werden weiter geprueft, und die
  // Freigabe bleibt stehen — die naechste Nacht nimmt den Schritt ohne neue Geste wieder auf.
  mitProjekt((dir) => {
    const src = quelle(dir);
    const a = paket(dir, src, "Paket A");
    const b = paket(dir, src, "Paket B");

    const res = erzeuge(dir, fake(`if [ "$NIGHT_ISSUE_ID" = "${a}" ]; then ${AUSFALL}; else ${BEFUND}; fi`));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(pruefSessions(dir, a), 1, "nach dem Ausfall lief eine weitere Runde an A");
    assert.equal(pruefSessions(dir, b), 3, "Dokument B wurde nicht weiter geprueft");
    assert.deepEqual(labels(dir, src), [ERZEUGE_LABEL]);
  });
});

test("[night-8] nach einem harten Stopp bleibt das Routing-Label stehen", NUR_POSIX, () => {
  // Exit != 0 ohne Timeout heisst: das CLI selbst ist gescheitert. Der Lauf endet hart,
  // und die Freigabe darf sich nicht verbrauchen — sonst zwaenge jeder technische Ausfall
  // zu einer neuen menschlichen Geste, ohne dass etwas geschehen waere.
  mitProjekt((dir) => {
    const src = quelle(dir);
    paket(dir, src, "Paket A");

    const res = erzeuge(dir, fake("exit 1"));

    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG/);
    assert.deepEqual(labels(dir, src), [ERZEUGE_LABEL]);
  });
});

// --- Alle Dokumente einer Quelle ---

test("[night-8] bei zwei Dokumenten faellt das Label erst, wenn beide einen Endzustand haben", NUR_POSIX, () => {
  // Traegt eines keinen Endzustand, bleibt die Freigabe stehen. Ein Label, das nach dem
  // ersten fertigen Paket faellt, liesse die uebrigen ungeprueft liegen.
  mitProjekt((dir) => {
    const src = quelle(dir);
    paket(dir, src, "Paket A", MARKER_ZEILE);
    paket(dir, src, "Paket B");

    const res = erzeuge(dir, fake("true"));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.deepEqual(labels(dir, src), [ERZEUGE_LABEL], "ein offenes Dokument verbrauchte die Freigabe");
  });

  mitProjekt((dir) => {
    const src = quelle(dir);
    paket(dir, src, "Paket A", MARKER_ZEILE);
    paket(dir, src, "Paket B", MARKER_ZEILE);

    const res = erzeuge(dir, fake("true"));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.deepEqual(labels(dir, src), [], "beide Dokumente sind fertig, das Label steht noch");
  });
});

// --- Der Runner setzt nie ein Routing-Label ---

test("[night-8] das Aufrufprotokoll des Laufs zeigt keinen 'label add'-Aufruf", NUR_POSIX, () => {
  // Der Nachweis am Verhalten statt am Quelltext: Ein Grep uebersaehe
  // `board("issue","label","add",id,args.erzeugeLabel)` — der Labelname steht dort nicht
  // woertlich. Ein Lauf, der Routing-Labels setzen kann, koennte sich selbst freigeben.
  mitProjekt((dir) => {
    const src = quelle(dir);
    const res = erzeuge(dir, fake(BEFUND));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    const aufrufe = readFileSync(join(dir, "board-aufrufe.log"), "utf-8").trim().split("\n");
    assert.deepEqual(aufrufe.filter((z) => /^issue label add\b/.test(z)), []);
    // Ohne diese Gegenprobe waere die Zusicherung oben auch bei einem Lauf gruen, der das
    // Protokoll gar nicht erreicht.
    assert.ok(
      aufrufe.includes(`issue label remove ${src} ${ERZEUGE_LABEL}`),
      `kein 'label remove' im Protokoll: ${aufrufe.join(" | ")}`,
    );
  }, mitschreibendesBoard);
});

/**
 * Ersetzt board.mjs durch einen Wrapper, der jeden Aufruf protokolliert und an die echte
 * Datei durchreicht. Jeder Board-Zugriff des Laufs geht darueber — der Runner startet
 * board.mjs als Subprozess, und auch die Fake-Session ruft sie so auf.
 */
function mitschreibendesBoard(dir) {
  const kit = join(dir, ".claude", "kit");
  copyFileSync(join(kit, "board.mjs"), join(kit, "board-echt.mjs"));
  writeFileSync(join(kit, "board.mjs"), `import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const cliArgs = process.argv.slice(2);
appendFileSync(join(hier, "..", "..", "board-aufrufe.log"), cliArgs.join(" ") + "\\n");
const res = spawnSync(process.execPath, [join(hier, "board-echt.mjs"), ...cliArgs], { stdio: "inherit" });
process.exit(res.status ?? 1);
`, "utf-8");
}

// --- Die Ableitung beim lokalen Tracker ---

test("[night-8] der Rundenstand wird auch aus Body-Kommentaren abgeleitet", NUR_POSIX, () => {
  // `reviewZustand` liest Anker ausschliesslich aus einem `comments`-Array. Der lokale
  // Tracker haengt Kommentare an den Body und liefert kein solches Feld — ohne die
  // Trennung mit LOKALER_KOMMENTARKOPF ergaebe die Ableitung hier nie `grenze`.
  mitProjekt((dir) => {
    const src = quelle(dir);
    erzeuge(dir, fake(BEFUND));

    const dok = board(dir, "issue", "get", paketIdVon(dir, src));
    assert.equal(dok.comments, undefined, "der lokale Tracker liefert doch ein comments-Feld");
    assert.equal((dok.body.match(/\n---\n\*\*Kommentar\*\*/g) || []).length, 3,
      "die drei Runden stehen nicht als Body-Kommentare am Dokument");
    assert.deepEqual(labels(dir, src), [], "aus drei Body-Kommentaren wurde kein 'grenze' abgeleitet");
  });
});
