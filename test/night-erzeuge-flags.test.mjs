// Die Argumentschicht des Erzeugungsmodus (Issue #517, Plan #513, fachliche Quelle #408).
//
// Drei Stellen sind hier nicht mechanisch, und genau sie stehen unten:
// `--max` bedeutet in zwei Modi Verschiedenes (Session-Starts vs. Ausgangsdokumente),
// `--stufe` benennt im Erzeugungsmodus das ENTSTEHENDE Dokument und ist dort Pflicht,
// und `--erzeuge-label` erbt das `none` von `--review-label` ausdruecklich NICHT — das
// Routing-Label ist die menschliche Freigabe-Geste und laesst sich nicht abschalten.
//
// Die modusabhaengige Aufloesung wird als reine Funktion geprueft (`loeseModusDefaults`),
// die Abweisungen ueber den echten Prozess: Sie muessen VOR jedem Board-Zugriff greifen,
// und genau das ist an einer importierten Funktion nicht zu sehen. Die Erzeugungs-Laeufe
// starten deshalb in einem LEEREN Verzeichnis — faellt die Argumentpruefung hinter
// `vorbereiten`, meldet der Lauf den fehlenden Board-Adapter statt der erwarteten Zeile.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { loeseModusDefaults } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cliArgs) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd },
  });
}

/** Leeres Verzeichnis: kein board.mjs, keine Config — `vorbereiten` scheitert dort sofort. */
function inLeeremVerzeichnis(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-erzeuge-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
}

/** Ein lauffaehiges Fixture-Projekt — nur der Implementierungsmodus kommt bis `vorbereiten`. */
function inProjekt(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-erzeuge-projekt-"));
  try {
    mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
    copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
      codeHost: "local", issueTracker: "local", buildChecks: ["true"],
      local: { issuesDir: "issues" },
    }, null, 2));
    writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n");
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.invalid");
    git(dir, "config", "user.name", "T");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "setup");
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// --max: zwei Bedeutungen, zwei Defaults
// ============================================================

test("--max ohne Angabe ergibt 3 im Erzeugungsmodus und 10 sonst", () => {
  assert.equal(loeseModusDefaults({ max: null, erzeuge: true, stufe: "plan" }).max, 3,
    "im Erzeugungsmodus zaehlt --max Ausgangsdokumente (Default 3)");
  assert.equal(loeseModusDefaults({ max: null, erzeuge: false }).max, 10,
    "ohne --erzeuge zaehlt --max wie bisher Session-Starts (Default 10)");
});

test("ein gesetztes --max gewinnt in beiden Modi", () => {
  assert.equal(loeseModusDefaults({ max: 7, erzeuge: true, stufe: "plan" }).max, 7);
  assert.equal(loeseModusDefaults({ max: 7, erzeuge: false }).max, 7);
});

// Die Vorbelegung `null` ist die Falle dieses Pakets: Steht die Aufloesung hinter der
// Zahlenpruefung, scheitert JEDER Aufruf ohne --max. Beide Modi belegen sie von aussen.
test("ohne --max laeuft der Implementierungsmodus weiter mit 10 Sessions", () => {
  inProjekt((dir) => {
    const res = run(dir, ["--dry-run", "--label", "none", "--no-checks-ok"]);
    assert.equal(res.status, 0, `der Dry-Run haette durchlaufen muessen: ${res.stderr}`);
    assert.match(res.stdout, /max 10 Sessions/, "der bisherige Default ist verlorengegangen");
  });
});

test("ein gesetztes --max erreicht den Lauf unveraendert", () => {
  inProjekt((dir) => {
    const res = run(dir, ["--max", "5", "--dry-run", "--label", "none", "--no-checks-ok"]);
    assert.equal(res.status, 0, `der Dry-Run haette durchlaufen muessen: ${res.stderr}`);
    assert.match(res.stdout, /max 5 Sessions/);
  });
});

for (const wert of ["0", "abc"]) {
  test(`--max ${wert} wird im Erzeugungsmodus abgewiesen`, () => {
    inLeeremVerzeichnis((dir) => {
      const res = run(dir, ["--erzeuge", "--stufe", "plan", "--max", wert, "--dry-run"]);
      assert.equal(res.status, 1, "ein unbrauchbarer Wert haette abbrechen muessen");
      assert.match(res.stderr, /--max braucht eine Zahl >= 1/);
    });
  });

  test(`--max ${wert} wird ohne --erzeuge weiterhin abgewiesen`, () => {
    inProjekt((dir) => {
      const res = run(dir, ["--max", wert, "--dry-run"]);
      assert.equal(res.status, 1, "ein unbrauchbarer Wert haette abbrechen muessen");
      assert.match(res.stderr, /--max braucht eine Zahl >= 1/);
    });
  });
}

// ============================================================
// --stufe: im Erzeugungsmodus Pflicht, und nur plan | issue
// ============================================================

test("--erzeuge ohne --stufe wird abgewiesen", () => {
  inLeeremVerzeichnis((dir) => {
    const res = run(dir, ["--erzeuge", "--dry-run"]);
    assert.equal(res.status, 1, "ein stiller Default entschiede, ob eine Nacht Plan oder Pakete erzeugt");
    assert.match(res.stderr, /--erzeuge braucht --stufe/);
    assert.match(res.stderr, /plan \| issue/, "die erlaubten Werte fehlen in der Meldung");
  });
});

test("--stufe fachlich gibt es im Erzeugungsmodus nicht", () => {
  inLeeremVerzeichnis((dir) => {
    const res = run(dir, ["--erzeuge", "--stufe", "fachlich", "--dry-run"]);
    assert.equal(res.status, 1, "fachlich ist keine erzeugbare Stufe");
    assert.match(res.stderr, /plan \| issue/, "die erlaubten Werte fehlen in der Meldung");
  });
});

for (const stufe of ["plan", "issue"]) {
  test(`--erzeuge --stufe ${stufe} wird angenommen und kommt bis vorbereiten`, () => {
    // Seit Issue #518 traegt der Erzeugungsmodus seinen eigenen Zweig in main(); die
    // Uebergangsmeldung aus #517 ist fort. Was hier bleibt, ist die Aussage der
    // Argumentschicht: Diese Kombination gilt. Belegt durch die Vorbedingung, an der ein
    // leeres Verzeichnis scheitert — sie liegt hinter jeder Argumentpruefung. Was der
    // Zweig dann tut, prueft test/night-erzeuge-geruest.test.mjs gegen ein Fixture.
    inLeeremVerzeichnis((dir) => {
      const res = run(dir, ["--erzeuge", "--stufe", stufe, "--dry-run"]);
      assert.equal(res.status, 1, "ohne board.mjs muss der Lauf an der Vorbedingung scheitern");
      assert.match(res.stderr, /board\.mjs nicht gefunden/,
        "ein anderer Abbruchgrund hiesse, die Argumente haetten nicht gegolten");
      assert.doesNotMatch(res.stdout, /Nacht-Runner startet/,
        "vor der Vorbedingung darf noch kein Lauf beginnen");
    });
  });
}

test("--stufe ohne --review und ohne --erzeuge bleibt der alte Fehler", () => {
  inLeeremVerzeichnis((dir) => {
    const res = run(dir, ["--stufe", "issue", "--dry-run"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /nur im Review-Modus/, "der bestehende Wortlaut ist gepinnt");
    assert.match(res.stderr, /--erzeuge/, "der zweite Modus wird nicht genannt");
  });
});

// ============================================================
// --erzeuge-label: Name ueberschreibbar, Filter nicht abschaltbar
// ============================================================

test("der Label-Default folgt der Stufe", () => {
  assert.equal(loeseModusDefaults({ max: null, erzeuge: true, stufe: "plan" }).erzeugeLabel, "kit:nightplan");
  assert.equal(loeseModusDefaults({ max: null, erzeuge: true, stufe: "issue" }).erzeugeLabel, "kit:nightissues");
  assert.equal(
    loeseModusDefaults({ max: null, erzeuge: true, stufe: "plan", erzeugeLabel: "kit:eigenes" }).erzeugeLabel,
    "kit:eigenes",
    "ein gesetzter Name muss den Stufen-Default schlagen");
});

test("--erzeuge-label none wird abgewiesen", () => {
  inLeeremVerzeichnis((dir) => {
    const res = run(dir, ["--erzeuge", "--stufe", "plan", "--erzeuge-label", "none", "--dry-run"]);
    assert.equal(res.status, 1, "ein abgeschalteter Filter zoege jedes Dokument ohne Freigabe durch");
    assert.match(res.stderr, /--erzeuge-label/, "die Meldung nennt das Flag nicht");
    assert.match(res.stderr, /none/, "die Meldung nennt den abgewiesenen Wert nicht");
  });
});

test("--erzeuge-label ohne --erzeuge bleibt wirkungslos", () => {
  inProjekt((dir) => {
    const res = run(dir, ["--erzeuge-label", "none", "--dry-run", "--label", "none", "--no-checks-ok"]);
    assert.equal(res.status, 0, `analog --review-label ohne --review: ${res.stderr}`);
  });
});

// ============================================================
// Ein Modus pro Lauf
// ============================================================

test("--review und --erzeuge zusammen werden abgewiesen", () => {
  inLeeremVerzeichnis((dir) => {
    const res = run(dir, ["--review", "--erzeuge", "--dry-run"]);
    assert.equal(res.status, 1, "zwei Modi haetten --stufe zwei Bedeutungen gegeben");
    assert.match(res.stderr, /--review und --erzeuge schliessen sich aus/);
  });
});

// ============================================================
// Auskunft und Rundengrenze
// ============================================================

test("--help und Kopf-Kommentar nennen beide neuen Flags", () => {
  const help = spawnSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" }).stdout;
  const kopf = readFileSync(NIGHT, "utf-8").split("*/")[0];
  for (const flag of ["--erzeuge", "--erzeuge-label"]) {
    assert.match(help, new RegExp(flag), `--help nennt ${flag} nicht`);
    assert.match(kopf, new RegExp(flag), `der Kopf-Kommentar nennt ${flag} nicht`);
  }
});

// Die Rundengrenze ist GRENZE_RUNDEN aus board.mjs (Issue #516). Eine zweite Konstante
// hier waere die zweite Wahrheit, die der Plan ausdruecklich vermeidet.
test("night.mjs fuehrt keine eigene Rundengrenze", () => {
  assert.doesNotMatch(readFileSync(NIGHT, "utf-8"), /ERZEUGUNG_RUNDEN/,
    "die Rundengrenze gehoert nach board.mjs, nicht hierher");
});
