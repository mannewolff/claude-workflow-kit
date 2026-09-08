// Kandidatenauswahl und Eintritt des Erzeugungsmodus (Issue #519).
//
// Die Auswahl spiegelt den Review-Modus und kehrt eine Bedingung um: Dort schliesst ein
// vorhandener Stufenmarker aus, hier ist er die EINTRITTSBEDINGUNG. Erzeugt wird aus dem,
// was geprueft IST — und `--stufe` benennt das entstehende Dokument, geprueft wird sein
// Vorgaenger (plan -> Fachplan-Review:, issue -> Plan-Review:).
//
// Zwei Ebenen, wie im Bestand: `erzeugungsEintritt` ist eine reine Funktion an Fixtures,
// der Dry-Run laeuft als echter Runner gegen den lokalen Tracker (Muster
// test/night-review-mode.test.mjs). Die Schleife des Ernstfalls fehlt noch (Issue #520),
// deshalb prueft die Datei zusaetzlich, dass keine Session startet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { erzeugungsEintritt } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const BOARD = join(repoRoot, "kit", "board.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

// --- Fixture-Bausteine ---

// Der Code-Fence als Konstante: In einem Template-Literal waeren drei Backticks nicht
// schreibbar, und die Fixtures sollen als Zeilenlisten lesbar bleiben.
const F = "```";

const KONTEXT_OHNE_MARKER = ["## Kontext", "", "Autor-Modell: claude-opus-5", ""];
const KONTEXT_FACHPLAN_MARKER = ["## Kontext", "", "Autor-Modell: claude-opus-5", "Fachplan-Review: fable (2026-09-08)", ""];
const KONTEXT_PLAN_MARKER = ["## Kontext", "", "Autor-Modell: claude-opus-5", "Plan-Review: fable (2026-09-08)", ""];

const KEINE_FRAGEN = ["## Offene Fragen", "", "- Keine. Der Plan bleibt in kit/night.mjs.", ""];
const OFFENE_FRAGE = ["## Offene Fragen", "", "- Soll der Ergebnisstand schon Einheiten tragen?", ""];
const FRAGEN_KLEIN = ["## Offene Fragen", "", "- keine.", ""];
const SCHLUSS = ["## Verifizierung", "", "- night.mjs laeuft.", ""];

const zusammen = (...teile) => teile.flat().join("\n");

// Ein Plandokument, das alle Eintrittsbedingungen der Stufe `issue` erfuellt.
const PLAN_GEPRUEFT = zusammen(KONTEXT_PLAN_MARKER, KEINE_FRAGEN, SCHLUSS);

// --- Die reine Funktion: erzeugungsEintritt ---

test("erzeugungsEintritt: Plan-Marker und '- Keine.' lassen ein Plandokument durch", () => {
  assert.equal(erzeugungsEintritt(PLAN_GEPRUEFT, "issue"), null);
});

test("erzeugungsEintritt: bei --stufe plan zaehlt der Fachplan-Marker, die Stopp-Fragen nicht", () => {
  // Ein Fachplan fuehrt keinen Abschnitt '## Offene Fragen' — die Pruefung gilt nur der
  // Stufe issue, sonst faende sie an jedem Fachplan eine Luecke, die es nicht gibt.
  assert.equal(erzeugungsEintritt(zusammen(KONTEXT_FACHPLAN_MARKER, SCHLUSS), "plan"), null);
});

test("erzeugungsEintritt: ohne Marker nennt den fehlenden Nachweis der Eingangsstufe", () => {
  const grund = erzeugungsEintritt(zusammen(KONTEXT_OHNE_MARKER, KEINE_FRAGEN, SCHLUSS), "issue");
  assert.match(grund, /kein Plan-Review-Nachweis/);
  assert.match(grund, /ungeprueft/);
  // Und die Gegenprobe: Der Marker der eigenen Stufe traegt den Eintritt nicht — bei
  // --stufe plan zaehlt der Fachplan-Marker, nicht der Plan-Marker.
  assert.match(
    erzeugungsEintritt(zusammen(KONTEXT_PLAN_MARKER, SCHLUSS), "plan"),
    /kein Fachplan-Review-Nachweis/,
  );
});

test("erzeugungsEintritt: ein fehlender Abschnitt '## Offene Fragen' schliesst aus", () => {
  // Der gefaehrliche Ausgang: Ein Plan ohne den Pflichtabschnitt duerfte nicht als
  // "keine Zeile, also keine offene Frage" durchgehen.
  assert.equal(
    erzeugungsEintritt(zusammen(KONTEXT_PLAN_MARKER, SCHLUSS), "issue"),
    "kein Abschnitt ## Offene Fragen",
  );
});

test("erzeugungsEintritt: eine offene Frage steht im Grund", () => {
  const grund = erzeugungsEintritt(zusammen(KONTEXT_PLAN_MARKER, OFFENE_FRAGE, SCHLUSS), "issue");
  assert.match(grund, /^offene Stopp-Frage: - Soll der Ergebnisstand/);
});

test("erzeugungsEintritt: der Grund kuerzt eine lange Frage auf 120 Zeichen", () => {
  const lang = ["## Offene Fragen", "", `- ${"x".repeat(400)}`, ""];
  const grund = erzeugungsEintritt(zusammen(KONTEXT_PLAN_MARKER, lang, SCHLUSS), "issue");
  const zitat = grund.replace(/^offene Stopp-Frage: /, "");
  assert.ok(zitat.length <= 120, `Zitat ist ${zitat.length} Zeichen lang: ${zitat}`);
});

test("erzeugungsEintritt: '- keine.' klein geschrieben gilt als offen", () => {
  // P6 schreibt die Form exakt vor; ein weicher Vergleich liesse jede Schreibweise durch.
  assert.match(
    erzeugungsEintritt(zusammen(KONTEXT_PLAN_MARKER, FRAGEN_KLEIN, SCHLUSS), "issue"),
    /^offene Stopp-Frage: - keine\./,
  );
});

test("erzeugungsEintritt: '- Keine.' innerhalb eines Codeblocks zaehlt nicht", () => {
  const imBlock = ["## Offene Fragen", "", F, "- Keine.", F, "", "- So sieht die Regelform aus, hier ist sie offen.", ""];
  assert.match(
    erzeugungsEintritt(zusammen(KONTEXT_PLAN_MARKER, imBlock, SCHLUSS), "issue"),
    /^offene Stopp-Frage: - So sieht die Regelform aus/,
  );
});

test("erzeugungsEintritt: eine '## Offene Fragen'-Ueberschrift im Codeblock zaehlt nicht", () => {
  const nurImBlock = [F, "## Offene Fragen", "", "- Keine.", F, ""];
  assert.equal(
    erzeugungsEintritt(zusammen(KONTEXT_PLAN_MARKER, nurImBlock, SCHLUSS), "issue"),
    "kein Abschnitt ## Offene Fragen",
  );
});

// --- Der Dry-Run gegen den lokalen Tracker ---

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

// Zeuge dafuer, ob nach dem Vorflug noch irgendeine Session startete.
const SESSION_FAKE = "touch session-lief";

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: {
      ...process.env,
      KIT_AGENT_MODEL: "fixture-modell",
      KIT_ROOT: cwd,
      NIGHT_VORFLUG_CMD: VORFLUG_FAKE,
      NIGHT_CLAUDE_CMD: SESSION_FAKE,
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
  const dir = mkdtempSync(join(tmpdir(), "night-erzeuge-kand-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(BOARD, join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
    issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\nsession-lief\n");
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

/** Legt eine Backlog-Karte an; Labels stehen beim lokalen Tracker als CSV im Frontmatter. */
function karte(dir, titel, body, label) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  if (label) {
    const pfad = join(dir, "issues", `${issue.id}.md`);
    const roh = readFileSync(pfad, "utf-8");
    writeFileSync(pfad, roh.replace(/^status:/m, `labels: ${label}\nstatus:`), "utf-8");
  }
  return String(issue.id);
}

function erzeuge(dir, stufe, extraArgs = []) {
  return run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", stufe, "--dry-run", ...extraArgs]);
}

test("--erzeuge --stufe issue --dry-run nennt je Karte ihren Ausgang", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const gut = karte(dir, "[Plan] Ein geprueftes Plandokument", PLAN_GEPRUEFT, "kit:nightissues");
    const ohneLabel = karte(dir, "[Plan] Ohne Routing-Label", PLAN_GEPRUEFT, "");
    const falschesPraefix = karte(dir, "[Fachlich] Eine Story", PLAN_GEPRUEFT, "kit:nightissues");
    const ohneMarker = karte(dir, "[Plan] Ungeprueft", zusammen(KONTEXT_OHNE_MARKER, KEINE_FRAGEN, SCHLUSS), "kit:nightissues");
    const offen = karte(dir, "[Plan] Mit offener Frage", zusammen(KONTEXT_PLAN_MARKER, OFFENE_FRAGE, SCHLUSS), "kit:nightissues");

    const res = erzeuge(dir, "issue");

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, new RegExp(`#${gut} .*-> Erzeugungs-Session 1`));
    assert.match(res.stdout, new RegExp(`#${ohneLabel} .*uebersprungen \\(kein Label 'kit:nightissues'\\)`));
    assert.match(res.stdout, new RegExp(`#${falschesPraefix} .*uebersprungen \\(kein Plan-Dokument \\(\\[Plan\\]\\)\\)`));
    assert.match(res.stdout, new RegExp(`#${ohneMarker} .*uebersprungen \\(kein Plan-Review-Nachweis`));
    assert.match(res.stdout, new RegExp(`#${offen} .*uebersprungen \\(offene Stopp-Frage:`));
    assert.match(res.stdout, /1 Erzeugungs-Session\(s\) wuerden starten/);
    assert.equal(existsSync(join(dir, "session-lief")), false, "der Dry-Run hat eine Erzeugungs-Session gestartet");
  });
});

test("--erzeuge --stufe plan filtert auf [Fachlich] und den Fachplan-Marker", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const gut = karte(dir, "[Fachlich] Eine gepruefte Story", zusammen(KONTEXT_FACHPLAN_MARKER, SCHLUSS), "kit:nightplan");
    const plan = karte(dir, "[Plan] Ein Plandokument", PLAN_GEPRUEFT, "kit:nightplan");

    const res = erzeuge(dir, "plan");

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, new RegExp(`#${gut} .*-> Erzeugungs-Session 1`));
    assert.match(res.stdout, new RegExp(`#${plan} .*uebersprungen \\(kein fachliches Issue \\(\\[Fachlich\\]\\)\\)`));
    assert.match(res.stdout, /1 Erzeugungs-Session\(s\) wuerden starten/);
  });
});

test("--erzeuge --dry-run markiert Karten ueber --max, statt sie zu verschweigen", NUR_POSIX, () => {
  // Weg (a) aus der Synthese: Alle qualifizierten Karten werden gelistet, die ueber der
  // Grenze mit Liegenbleib-Zeile — das Muster von berichteReviewDryRun.
  mitProjekt((dir) => {
    const eins = karte(dir, "[Plan] Eins", PLAN_GEPRUEFT, "kit:nightissues");
    const zwei = karte(dir, "[Plan] Zwei", PLAN_GEPRUEFT, "kit:nightissues");

    const res = erzeuge(dir, "issue", ["--max", "1"]);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, new RegExp(`#${eins} .*-> Erzeugungs-Session 1`));
    assert.match(res.stdout, new RegExp(`#${zwei} .*ueber --max 1, bliebe liegen`));
    assert.match(res.stdout, /1 Erzeugungs-Session\(s\) wuerden starten/);
  });
});

test("--erzeuge --dry-run ohne passende Karte endet ohne Kandidaten", NUR_POSIX, () => {
  mitProjekt((dir) => {
    karte(dir, "[Plan] Ohne Routing-Label", PLAN_GEPRUEFT, "");

    const res = erzeuge(dir, "issue");

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /Keine Erzeugungs-Kandidaten \(Stufe issue\) — nichts zu tun\./);
  });
});
