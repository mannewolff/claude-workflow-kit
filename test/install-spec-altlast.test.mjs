// Der spec-Block als Altlast im Installer (Issue #828, Plan #825 A4).
//
// Seit dem Rueckbau von Spec-Driven Development stellt der Installer keine
// Spec-Frage mehr und schreibt kein spec.mjs aus. Ein Zielprojekt, dessen
// Bestandsconfig den `spec`-Block noch traegt, laeuft trotzdem weiter: Der
// Installer uebernimmt den Block unveraendert und nennt genau einmal den
// Hinweis, dass er nicht mehr ausgewertet wird und samt specs/ entfernt
// werden kann. Eine alte Kopie .claude/kit/spec.mjs bleibt harmlos liegen.
//
// Gefahren wird das ECHTE install.mjs im Piped-Modus, mit cwd UND
// HOME/USERPROFILE im Wegwerf-Verzeichnis (dieselbe Vorkehrung wie in
// install-flow.test.mjs): Ohne die Umlenkung wuerde ein Testlauf die echte
// Konfiguration ueberschreiben. Die Portabilitaets-Probe kopiert install.mjs
// zusaetzlich allein in ein leeres Verzeichnis ausserhalb des Repos — ein
// Installer, der den Hinweis aus einer Repo-Datei zoege, fiele nur so auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

// Woertlich so, wie der Installer ihn ausgibt. Als Konstante im Test, nicht als
// Inline-Regex: Ein umformulierter Hinweis soll hier auffallen, nicht stumm
// durchgehen.
const HINWEIS = "Der spec-Block wird nicht mehr ausgewertet und kann samt specs/ entfernt werden.";

// Die alte Frage 9 — mit ihrer Abwesenheit belegt der Test, dass sie nicht mehr
// gestellt wird (frueher kam sie genau bei toolbox, Issue #439/#461).
const ALTE_FRAGE = "Soll dieses Projekt eine Spec fuehren";

// Der Block, wie ihn ein Zielprojekt aus der Zeit vor dem Rueckbau traegt.
const SPEC = { seit: "2026-09-02", bereiche: { kit: ["kit/**"] } };

// Scope, codeHost, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel, reviewCommand — die Spec-Frage gibt es nicht mehr, und ohne
// Git-Repo im Fixture entfaellt auch die Gate-Frage. Tracker 'toolbox', weil
// genau dort die alte Frage gestellt wurde.
const ANTWORTEN = ["projekt", "github", "toolbox", "", "", "", "", ""];

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function schreibeConfig(dir, werte) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(werte, null, 2) + "\n", "utf-8");
}

function installiere(dir, installer = INSTALLER) {
  return spawnSync(process.execPath, [installer], {
    cwd: dir,
    input: ANTWORTEN.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
  });
}

function config(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
}

function vorkommen(text, teil) {
  return text.split(teil).length - 1;
}

test("Eine Bestandsconfig mit spec-Block wird unveraendert uebernommen, der Hinweis faellt genau einmal", () => {
  const dir = fixture("install-spec-altlast-");
  try {
    schreibeConfig(dir, { issueTracker: "toolbox", spec: SPEC });
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(config(dir).spec, SPEC, "der Block muss unveraendert in der Config stehen");
    assert.equal(vorkommen(res.stdout, HINWEIS), 1, `der Hinweis muss genau einmal fallen:\n${res.stdout}`);
    assert.ok(!res.stdout.includes(ALTE_FRAGE), "die Spec-Frage darf nicht mehr gestellt werden");
    assert.equal(existsSync(join(dir, ".claude", "kit", "spec.mjs")), false, "spec.mjs darf nicht mehr ausgeschrieben werden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ohne spec-Block in der Bestandsconfig faellt der Hinweis nicht", () => {
  const dir = fixture("install-spec-altlast-ohne-");
  try {
    schreibeConfig(dir, { issueTracker: "toolbox" });
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(!res.stdout.includes(HINWEIS), "ohne Block gibt es nichts hinzuweisen");
    assert.equal("spec" in config(dir), false, "ein spec-Block darf nicht neu entstehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs allein kopiert laeuft gegen eine Bestandsconfig mit spec-Block ohne Repo-Kontext", () => {
  // Das Portabilitaets-Kriterium aus dem Issue: Single-File, leeres Verzeichnis,
  // Exit 0, Block unveraendert, Hinweis genannt.
  const dir = fixture("install-spec-altlast-portabel-");
  try {
    const kopie = join(dir, "install.mjs");
    copyFileSync(INSTALLER, kopie);
    schreibeConfig(dir, { issueTracker: "toolbox", spec: SPEC });
    const res = installiere(dir, kopie);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(config(dir).spec, SPEC);
    assert.equal(vorkommen(res.stdout, HINWEIS), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
