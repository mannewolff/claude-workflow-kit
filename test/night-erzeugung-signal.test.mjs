// Phase 1 der Erzeugungsschleife: Session, Erfolgssignal, Fortsetzen (Issue #520).
//
// Der bestehende Apparat kennt zwei Erfolgssignale, und beide tragen hier nicht: Die
// Implementierungsschleife misst "Issue in In review", der Review-Modus "Marker im Body".
// Eine Erzeugungs-Session legt statt dessen NEUE Karten an — und der Runner muss wissen,
// welche. Naheliegend waere `derivedFrom`, das aber nur der toolbox-Adapter auswertet.
// Die Zeilen `Fachliche Quelle: Issue #N` und `Plan: Issue #M` stehen im Body und tragen
// bei jedem Tracker.
//
// Zwei Ebenen wie in night-erzeuge-kandidaten.test.mjs: `stammtAusErzeugung` ist eine
// reine Funktion an Fixtures, die Schleife laeuft als echter Runner gegen den lokalen
// Tracker mit einer Fake-Session, die Karten wirklich anlegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { stammtAusErzeugung } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const BOARD = join(repoRoot, "kit", "board.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

// --- Die reine Funktion: stammtAusErzeugung ---

const planDoku = (body) => ({ id: "0002", title: "[Plan] Ein Weg", body });
const arbeitspaket = (body) => ({ id: "0002", title: "night.mjs: Ein Paket", body });

test("stammtAusErzeugung: ein [Plan] mit der Herkunftszeile der Quelle zaehlt bei --stufe plan", () => {
  assert.equal(stammtAusErzeugung(planDoku("## Kontext\n\nFachliche Quelle: Issue #408\n"), "408", "plan"), true);
});

test("stammtAusErzeugung: ein Arbeitspaket mit 'Plan: Issue #M' zaehlt bei --stufe issue", () => {
  assert.equal(stammtAusErzeugung(arbeitspaket("## Kontext\n\nPlan: Issue #513\n"), "513", "issue"), true);
});

test("stammtAusErzeugung: #40 trifft #408 nicht", () => {
  // Der Fund aus dem Issue-Review: Ohne Zeilenende hinter der Nummer verbuchte ein Lauf
  // zu Quelle #40 jedes Dokument aus #408 als sein eigenes Ergebnis.
  const doku = planDoku("## Kontext\n\nFachliche Quelle: Issue #408\n");
  assert.equal(stammtAusErzeugung(doku, "40", "plan"), false);
  assert.equal(stammtAusErzeugung(doku, "4080", "plan"), false);
});

test("stammtAusErzeugung: die Herkunftszeile muss eine ganze Zeile sein", () => {
  // Fettung oder Fliesstext sind keine Herkunftszeile — sonst zaehlte jede Erwaehnung.
  assert.equal(stammtAusErzeugung(planDoku("Er nennt **Fachliche Quelle: Issue #408** im Text.\n"), "408", "plan"), false);
  assert.equal(stammtAusErzeugung(planDoku("Siehe Fachliche Quelle: Issue #408\n"), "408", "plan"), false);
});

test("stammtAusErzeugung: bei --stufe plan zaehlt nur ein [Plan]-Dokument", () => {
  // Der gewichtigste Fund des Reviews: `Fachliche Quelle: Issue #N` steht auch in jedem
  // Arbeitspaket. Ohne die Praefix-Bedingung unterdrueckten Pakete eines frueheren Laufs
  // die Plan-Session, und das "vorhandene Dokument" waere ein Arbeitspaket.
  const body = "## Kontext\n\nFachliche Quelle: Issue #408\n";
  assert.equal(stammtAusErzeugung(arbeitspaket(body), "408", "plan"), false);
  assert.equal(stammtAusErzeugung({ id: "0003", title: "[Fachlich] Eine Story", body }, "408", "plan"), false);
});

test("stammtAusErzeugung: bei --stufe issue zaehlt kein [Plan], [Fachlich] oder [Idee]", () => {
  const body = "## Kontext\n\nPlan: Issue #513\n";
  for (const titel of ["[Plan] Ein Weg", "[Fachlich] Eine Story", "[Idee] Ein Einfall"]) {
    assert.equal(stammtAusErzeugung({ id: "0002", title: titel, body }, "513", "issue"), false, titel);
  }
});

test("stammtAusErzeugung: die Herkunftszeile der anderen Stufe zaehlt nicht", () => {
  // Ein Arbeitspaket traegt beide Zeilen. Bei --stufe issue ist `Plan:` massgeblich; die
  // fachliche Quelle daneben gehoert zum Plan, nicht zu diesem Lauf.
  const beide = arbeitspaket("## Kontext\n\nPlan: Issue #513\nFachliche Quelle: Issue #408\n");
  assert.equal(stammtAusErzeugung(beide, "408", "issue"), false);
  assert.equal(stammtAusErzeugung(beide, "513", "issue"), true);
});

test("stammtAusErzeugung: eine unbekannte Stufe zaehlt nichts", () => {
  assert.equal(stammtAusErzeugung(planDoku("Fachliche Quelle: Issue #408\n"), "408", "fachlich"), false);
  assert.equal(stammtAusErzeugung(planDoku("Fachliche Quelle: Issue #408\n"), "408", "constructor"), false);
});

// --- Der Ernstfall gegen den lokalen Tracker ---

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
  const dir = mkdtempSync(join(tmpdir(), "night-erzeugung-signal-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(BOARD, join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
    issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  // prompt.log muss ignoriert sein: night.mjs stoppt hart, wenn eine Session den
  // Working Tree veraendert.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
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

const FACHPLAN_GEPRUEFT = "## Kontext\n\nAutor-Modell: claude-opus-5\nFachplan-Review: fable (2026-09-08)\n\n## Nutzerwirkung\n\nEs wirkt.\n";
const PLAN_GEPRUEFT = "## Kontext\n\nAutor-Modell: claude-opus-5\nPlan-Review: fable (2026-09-08)\n\n## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- night.mjs laeuft.\n";

/** Legt die Quelle eines Erzeugungslaufs an — je Stufe das passende Dokument. */
function quelle(dir, stufe, titel = "Eine Quelle") {
  return stufe === "plan"
    ? karte(dir, `[Fachlich] ${titel}`, FACHPLAN_GEPRUEFT, "kit:nightplan")
    : karte(dir, `[Plan] ${titel}`, PLAN_GEPRUEFT, "kit:nightissues");
}

const BOARD_IM_FAKE = '"$KIT_ROOT/.claude/kit/board.mjs"';
// Schreibt den Prompt ungekuerzt weg, ein Block je Session — die Zahl der Bloecke ist
// die Zahl der Sessions.
const MITSCHRIFT = String.raw`printf "%s\n<<<ENDE>>>\n" "$NIGHT_PROMPT" >> prompt.log`;

/**
 * Laesst den Fake nur in der Erzeugungsphase handeln.
 *
 * Seit Issue #521 folgt Phase 2 mit `/issue-review`-Sessions, und die laufen gegen
 * denselben Fake. Ohne diese Weiche legte er auch dort Karten an — die Ergebnisse von
 * Phase 1 waeren dann nicht mehr abzaehlbar.
 */
function nurErzeugung(aktion) {
  return `case "$NIGHT_PROMPT" in /issue-review*) ;; *) ${aktion} ;; esac`;
}

/** Fake-Session, die eine Karte mit Titel und Body anlegt. */
function legtAn(titel, body) {
  const anlegen = `node ${BOARD_IM_FAKE} issue create --title '${titel}' --body '${body}' > /dev/null`;
  return `${MITSCHRIFT}; ${nurErzeugung(anlegen)}`;
}

const FAKE_STUMM = MITSCHRIFT;

/** Die Prompts der Sessions dieses Laufs, in ihrer Reihenfolge. */
function prompts(dir) {
  const p = join(dir, "prompt.log");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8").split("<<<ENDE>>>\n").map((t) => t.replace(/\n$/, "")).filter(Boolean);
}

/**
 * Nur die Auftraege der Erzeugungsphase.
 *
 * Phase 2 (Issue #521) beauftragt danach `/issue-review` je erzeugtem Dokument. Die
 * Tests hier messen Phase 1 — `prompts(dir).length` zaehlte sonst beide Phasen zusammen
 * und schluege bei jeder Aenderung an der Pruefschleife fehl.
 */
function erzeugungsPrompts(dir) {
  return prompts(dir).filter((p) => !p.startsWith("/issue-review"));
}

function erzeuge(dir, stufe, fake, extraArgs = []) {
  return run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", stufe, ...extraArgs], { NIGHT_CLAUDE_CMD: fake });
}

// --- Der Auftrag der Session ---

test("bei --stufe plan beginnt der Auftrag mit /techplan #N", NUR_POSIX, () => {
  // `/plan` ist seit Issue #514 ein Wegweiser und erzeugt kein Dokument.
  mitProjekt((dir) => {
    const id = quelle(dir, "plan");
    const res = erzeuge(dir, "plan", FAKE_STUMM);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(prompts(dir).length, 1);
    assert.equal(prompts(dir)[0].split("\n")[0], `/techplan #${id}`);
  });
});

test("bei --stufe issue beginnt der Auftrag mit /issues #N", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = quelle(dir, "issue");
    const res = erzeuge(dir, "issue", FAKE_STUMM);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(prompts(dir)[0].split("\n")[0], `/issues #${id}`);
  });
});

test("der Auftrag traegt denselben Unbeaufsichtigt-Zusatz wie der Review-Modus", NUR_POSIX, () => {
  mitProjekt((dir) => {
    quelle(dir, "plan");
    erzeuge(dir, "plan", FAKE_STUMM);

    const prompt = prompts(dir)[0];
    assert.match(prompt, /unbeaufsichtigt/i);
    assert.match(prompt, /Es sieht niemand zu/i);
    assert.match(prompt, /wird nicht gefragt/i);
    assert.match(prompt, /bevor die Session endet/i);
  });
});

// --- Das Erfolgssignal ---

test("ein neues [Plan]-Dokument mit der Herkunftszeile steht in der Protokollzeile", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = quelle(dir, "plan");
    const res = erzeuge(dir, "plan", legtAn("[Plan] Der Weg", `## Kontext\n\nFachliche Quelle: Issue #${id}\n`));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    // Die angelegte Karte ist die naechste Nummer nach der Quelle.
    const neu = board(dir, "issue", "list", "--status", "backlog").find((i) => i.title === "[Plan] Der Weg");
    assert.ok(neu, "die Fake-Session hat keine Karte angelegt");
    assert.match(res.stdout, new RegExp(`Erzeugt aus Issue #${id}: #${neu.id}`));
    // Nicht als ergebnislos gewertet: Die Zaehlzeile muss null nennen (ein blosses
    // doesNotMatch(/ohne Dokument/) traefe genau diese Zeile).
    assert.match(res.stdout, /0 ohne Dokument/);
  });
});

test("mehrere neue Dokumente werden alle gefunden", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = quelle(dir, "issue");
    const kopf = `## Kontext\n\nPlan: Issue #${id}\n`;
    const schleife = `for n in A B; do node ${BOARD_IM_FAKE} issue create --title "Paket $n" --body '${kopf}' > /dev/null; done`;
    const fake = `${MITSCHRIFT}; ${nurErzeugung(schleife)}`;
    const res = erzeuge(dir, "issue", fake);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    const neu = board(dir, "issue", "list", "--status", "backlog")
      .filter((i) => i.title.startsWith("Paket ")).map((i) => `#${i.id}`);
    assert.equal(neu.length, 2);
    assert.match(res.stdout, new RegExp(`Erzeugt aus Issue #${id}: ${neu.join(", ")}`));
  });
});

test("eine Karte mit der Nummer als Praefix zaehlt nicht als Ergebnis", NUR_POSIX, () => {
  // Dieselbe Falle wie #40 gegen #408, hier im Lauf: Die Zeile muss nach der Nummer enden.
  mitProjekt((dir) => {
    const id = quelle(dir, "plan");
    const res = erzeuge(dir, "plan", legtAn("[Plan] Fremder Weg", `## Kontext\n\nFachliche Quelle: Issue #${id}7\n`));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.doesNotMatch(res.stdout, new RegExp(`Erzeugt aus Issue #${id}:`));
    assert.match(res.stdout, /endete ohne Dokument/);
  });
});

// --- Der Fortsetzen-Check ---

test("ein Arbeitspaket mit derselben Herkunftszeile verhindert die Plan-Session nicht", NUR_POSIX, () => {
  // Arbeitspakete tragen `Fachliche Quelle: Issue #N` genauso wie das Plandokument.
  // Ohne die Praefix-Bedingung haetten sie die Plan-Session unterdrueckt.
  mitProjekt((dir) => {
    const id = quelle(dir, "plan");
    karte(dir, "night.mjs: Ein altes Paket", `## Kontext\n\nFachliche Quelle: Issue #${id}\n`);
    const res = erzeuge(dir, "plan", legtAn("[Plan] Der Weg", `## Kontext\n\nFachliche Quelle: Issue #${id}\n`));

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(erzeugungsPrompts(dir).length, 1, "die Plan-Session ist nicht gelaufen");
    assert.doesNotMatch(res.stdout, /schon vorhanden/);
  });
});

test("ein Paket in Ready verhindert die /issues-Session", NUR_POSIX, () => {
  // Der Fortsetzen-Check liest ohne Status-Filter: Sind die Pakete des Plans schon aus
  // dem Backlog gezogen, legte /issues sie sonst alle erneut an.
  mitProjekt((dir) => {
    const id = quelle(dir, "issue");
    const paket = karte(dir, "night.mjs: Ein Paket", `## Kontext\n\nPlan: Issue #${id}\n`);
    board(dir, "issue", "move", paket, "ready");

    const res = erzeuge(dir, "issue", FAKE_STUMM);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(erzeugungsPrompts(dir).length, 0, "es lief eine Session, obwohl Pakete des Plans vorliegen");
    assert.match(res.stdout, new RegExp(`Erzeugt aus Issue #${id}: #${paket}`));
    assert.match(res.stdout, /schon vorhanden/);
  });
});

// --- Die Session ohne Dokument ---

test("ohne neues Dokument: Kommentar an die Quelle, Label bleibt, der Lauf faehrt fort", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const eins = quelle(dir, "plan", "Erste");
    const zwei = quelle(dir, "plan", "Zweite");

    const res = erzeuge(dir, "plan", FAKE_STUMM);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(prompts(dir).length, 2, "der Lauf ist nach der ersten ergebnislosen Session stehengeblieben");
    for (const id of [eins, zwei]) {
      const voll = board(dir, "issue", "get", id);
      assert.match(voll.body, /Nachtlauf: Die Erzeugungs-Session endete ohne Dokument/);
      assert.match(voll.body, /morgens sichten oder \/techplan bzw\. \/issues von Hand fahren/);
      assert.deepEqual(voll.labels, ["kit:nightplan"], "das Routing-Label wurde entfernt");
      assert.equal(voll.status, "backlog");
    }
  });
});

// --- Der harte Stopp ---

test("ein veraenderter Arbeitsbaum stoppt den Lauf und nennt die Erzeugungs-Session", NUR_POSIX, () => {
  // Die Meldung nannte fest die Review-Session; morgens stuende die falsche Sessionart
  // im Protokoll.
  mitProjekt((dir) => {
    quelle(dir, "plan");
    const res = erzeuge(dir, "plan", `${FAKE_STUMM}; echo rest > uebrig.txt`);

    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /HARTER STOPP/);
    assert.match(res.stdout, /Erzeugungs-Session/);
    assert.doesNotMatch(res.stdout, /die Review-Session zu Issue/);
  });
});
