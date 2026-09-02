// Das Reviewer-Paar im Installer: genau eines von reviewModel und reviewCommand (Issue #433).
//
// Ausloeser war ein Re-Install, der sich nicht bestaetigen liess: `askWithDefault` prueft
// auch den UEBERNOMMENEN Default, und die `^claude-`-Regel wies eine gepflegte
// Bestandsconfig mit fremdem Reviewer ab — interaktiv ohne Ausweg, im Pipe-Modus als
// harter Abbruch. Zu eng war die Regel, nicht der Zeitpunkt ihrer Anwendung (Plan #348).
//
// Jeder Fall unten nennt, WOHER die Felder kommen — aus einer vorbereiteten
// Bestandsconfig oder aus den gepipten Antwortzeilen. Das ist nicht dasselbe: Ohne
// Bestandsconfig fuellt der DEFAULTS-Spread `reviewModel` immer auf, ein frischer
// Default-Install darf also gerade NICHT abbrechen.
//
// Gefahren wird das ECHTE install.mjs aus dem Repo im Piped-Modus; cwd und HOME zeigen
// wie in den uebrigen Installer-Tests in ein Wegwerf-Verzeichnis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function installiere(dir, antworten) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
  });
}

function config(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
}

function schreibeConfig(dir, werte) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(werte, null, 2) + "\n", "utf-8");
}

// Scope, codeHost, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel, reviewCommand — alles ab Frage 4 leer, also Default uebernehmen.
const ALLES_DEFAULT = ["projekt", "github", "github", "", "", "", "", ""];

// --- Frischer Install: der DEFAULTS-Spread setzt den Claude-Reviewer ---

test("frischer Install ohne jede Eingabe schreibt den Claude-Default und kein reviewCommand", () => {
  const dir = fixture("paar-frisch-default-");
  try {
    const res = installiere(dir, ALLES_DEFAULT);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const c = config(dir);
    assert.equal(c.reviewModel, "claude-opus-4-8",
      "der frische Default-Install muss den Claude-Reviewer schreiben");
    assert.equal("reviewCommand" in c, false,
      "ohne Kommando-Reviewer darf kein leeres reviewCommand in der Datei stehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Frischer Install mit Kommando-Reviewer: reviewModel muss LOESCHBAR sein ---
//
// Der Knackpunkt: `schema.defaults.reviewModel` ist immer gesetzt, und eine leere
// Eingabe heisst in askWithDefault "Default uebernehmen". "Kein reviewModel" braucht
// deshalb eine eigene Eingabe — sonst schleppt der DEFAULTS-Spread das Feld zurueck in
// die Datei und die Oder-Regel ist verletzt, kaum dass sie geschrieben wurde.

test("frischer Install mit Kommando-Reviewer schreibt reviewCommand und KEIN reviewModel", () => {
  const dir = fixture("paar-frisch-kommando-");
  try {
    const res = installiere(dir,
      ["projekt", "github", "github", "", "", "", "-", "codex exec --model gpt-5"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const c = config(dir);
    assert.equal(c.reviewCommand, "codex exec --model gpt-5");
    assert.equal("reviewModel" in c, false,
      "der DEFAULTS-Spread hat das geleerte reviewModel wieder aufgefuellt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Beide Felder gesetzt: Abbruch mit selbsterklaerender Meldung ---

test("Bestandsconfig mit beiden Reviewer-Feldern bricht ab und erklaert beide Felder", () => {
  const dir = fixture("paar-beide-");
  try {
    schreibeConfig(dir, {
      codeHost: "github",
      issueTracker: "github",
      reviewModel: "claude-opus-4-8",
      reviewCommand: "codex exec --model gpt-5",
    });

    const res = installiere(dir, ALLES_DEFAULT);
    assert.equal(res.status, 1, "zwei gesetzte Reviewer duerfen nicht stillschweigend durchgehen");

    const meldung = res.stdout + res.stderr;
    assert.match(meldung, /reviewModel/, "die Meldung nennt reviewModel nicht");
    assert.match(meldung, /reviewCommand/, "die Meldung nennt reviewCommand nicht");
    // Nicht nur DASS etwas falsch ist, sondern was die Felder bedeuten und was zu tun ist.
    assert.match(meldung, /claude-/i, "die Meldung erklaert reviewModel nicht als Claude-Modell");
    assert.match(meldung, /stdin/i, "die Meldung erklaert reviewCommand nicht als fremde CLI mit stdin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("werden beide Felder aktiv geleert, bricht der Installer ab", () => {
  const dir = fixture("paar-keins-");
  try {
    const res = installiere(dir, ["projekt", "github", "github", "", "", "", "-", "-"]);
    assert.equal(res.status, 1, "ohne Reviewer laeuft /review ins Leere — das darf nicht durchgehen");
    assert.match(res.stdout + res.stderr, /reviewModel[\s\S]*reviewCommand|reviewCommand[\s\S]*reviewModel/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der ausloesende Fall: Re-Install eines Kommando-Reviewers per Enter ---

test("Re-Install gegen einen Kommando-Reviewer laesst sich durch blosses Bestaetigen abschliessen", () => {
  const dir = fixture("paar-reinstall-");
  try {
    schreibeConfig(dir, {
      codeHost: "github",
      issueTracker: "github",
      mainBranch: "main",
      productionBranch: "production",
      reviewScope: "diff",
      reviewCommand: "codex exec --model gpt-5.6-sol",
      buildChecks: ["npm test"],
    });

    // Alle Fragen mit Enter bestaetigen — genau der Weg, der bisher abbrach.
    const res = installiere(dir, ALLES_DEFAULT);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const c = config(dir);
    assert.equal(c.reviewCommand, "codex exec --model gpt-5.6-sol",
      "der Reviewer-Eintrag muss den Re-Install unveraendert ueberstehen");
    assert.equal("reviewModel" in c, false,
      "der Installer hat den Claude-Default neben den Kommando-Reviewer geschrieben");
    assert.deepEqual(c.buildChecks, ["npm test"], "nicht abgefragte Felder bleiben erhalten (#125)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
