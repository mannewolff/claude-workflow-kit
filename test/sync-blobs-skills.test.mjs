// Die Skill-Kopien unter .claude/skills/ (Issue #405).
//
// sync-blobs.mjs frischt neben den Kit-Dateien auch die lokalen Skill-Kopien auf.
// Geprueft war bisher nur der Kit-Teil; der Skill-Teil bringt drei eigene Wege mit:
// was uebersprungen wird (Dateien statt Ordner, Ordner ohne SKILL.md) und was
// passiert, wenn das Ziel nicht beschreibbar ist.
//
// Der Schreibschutz ist kein konstruierter Fall: Genau diese Sperre war der Anlass
// von Issue #186 — die Sandbox schuetzt `.claude/skills/`, und ein sync-blobs, das
// den Fehler verschluckt, meldet danach "aufgefrischt", waehrend die Kopie alt ist.
//
// Aufbau wie in sync-blobs-stamp: das ECHTE Script aus dem Repo, das ueber den
// Test-Hook KIT_ROOT ins Fixture zeigt (Issue #186) — so landet die Coverage unter
// der Repo-Datei statt unter einem Temp-Pfad.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Unter Windows uebersprungen: Der Schreibschutz-Test haengt an POSIX-Dateirechten;
// `chmod` hat dort auf Verzeichnisse nicht dieselbe Wirkung.
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Schreibschutz haengt an POSIX-Dateirechten, chmod wirkt dort anders." }
  : {};

function setupFixture({ skills = { beispiel: "# Beispiel-Skill\n" }, kopien = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-skills-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "kit"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });

  writeFileSync(join(dir, "templates", "CLAUDE-workflow.md"), "# Vorlage\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Fachplan.md"), "# Fachplan-Gates\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Plan.md"), "# Plan-Gates\n");
  writeFileSync(join(dir, "templates", "workflow.config.json"), `${JSON.stringify({ codeHost: "github" })}\n`);
  for (const datei of ["board.mjs", "night.mjs", "checks.mjs", "spec.mjs"]) {
    writeFileSync(join(dir, "kit", datei), `const KIT_VERSION = "1.0.0";\nconsole.log("${datei}");\n`);
  }
  writeFileSync(join(dir, "install.mjs"), [
    'const VERSION = "1.0.0";',
    'const CONFIG_EXAMPLE_B64 = "";',
    'const CLAUDE_WORKFLOW_MD_B64 = "";',
    'const CLAUDE_FACHPLAN_MD_B64 = "";',
    'const CLAUDE_PLAN_MD_B64 = "";',
    'const BOARD_MJS_B64 = "";',
    'const NIGHT_MJS_B64 = "";',
    'const CHECKS_MJS_B64 = "";',
    'const SPEC_MJS_B64 = "";',
    'const SKILLS_B64 = "";',
    "",
  ].join("\n"));

  for (const [name, inhalt] of Object.entries(skills)) {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    if (inhalt !== null) writeFileSync(join(dir, "skills", name, "SKILL.md"), inhalt);
  }
  if (kopien) {
    mkdirSync(join(dir, ".claude", "skills"), { recursive: true });
    for (const [name, inhalt] of Object.entries(kopien)) {
      mkdirSync(join(dir, ".claude", "skills", name), { recursive: true });
      if (inhalt !== null) writeFileSync(join(dir, ".claude", "skills", name, "SKILL.md"), inhalt);
    }
  }
  return dir;
}

function syncBlobs(dir, ...cliArgs) {
  return spawnSync(process.execPath, [join(repoRoot, "tools", "sync-blobs.mjs"), ...cliArgs],
    { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
}

function mitFixture(fn, optionen) {
  const dir = setupFixture(optionen);
  try {
    fn(dir);
  } finally {
    // Schreibrechte zuruecksetzen, sonst scheitert das Aufraeumen am eigenen Test.
    const geschuetzt = join(dir, ".claude", "skills", "beispiel");
    if (existsSync(geschuetzt)) chmodSync(geschuetzt, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("eine Datei neben den Skill-Ordnern wird uebersprungen", () => {
  mitFixture((dir) => {
    // Eine lose Datei in skills/ ist kein Skill — sie darf den Lauf nicht kippen
    // und nichts unter .claude/skills/ erzeugen.
    writeFileSync(join(dir, "skills", "LIESMICH.md"), "kein Skill\n");

    const res = syncBlobs(dir);

    assert.equal(res.status, 0, `sync-blobs schlug fehl: ${res.stderr}`);
    assert.equal(existsSync(join(dir, ".claude", "skills", "LIESMICH.md")), false,
      "eine lose Datei wurde als Skill behandelt");
  }, { kopien: { beispiel: "alt\n" } });
});

test("ein Skill-Ordner ohne SKILL.md wird uebersprungen", () => {
  mitFixture((dir) => {
    const res = syncBlobs(dir);

    assert.equal(res.status, 0, `sync-blobs schlug fehl: ${res.stderr}`);
    assert.equal(existsSync(join(dir, ".claude", "skills", "leer", "SKILL.md")), false,
      "ein Ordner ohne Quelle darf kein Ziel erzeugen");
    // Der vollstaendige Skill daneben wird trotzdem aufgefrischt.
    assert.equal(readFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), "utf-8"),
      "# Beispiel-Skill\n", "der vollstaendige Skill wurde nicht aufgefrischt");
  }, { skills: { beispiel: "# Beispiel-Skill\n", leer: null }, kopien: { beispiel: "alt\n" } });
});

test("eine bereits gleiche Kopie wird nicht angefasst und nicht gemeldet", () => {
  mitFixture((dir) => {
    // Die Blobs des Fixtures sind leer, --check meldet dafuer ohnehin Drift. Geprueft
    // wird deshalb gezielt, dass die SKILL-Kopie NICHT darunter ist.
    const res = syncBlobs(dir, "--check");

    assert.doesNotMatch(res.stdout + res.stderr, /skills\/beispiel/,
      "eine identische Kopie darf nicht als Drift gemeldet werden");
  }, { kopien: { beispiel: "# Beispiel-Skill\n" } });
});

test("ein schreibgeschuetztes Ziel bricht sichtbar ab, statt still weiterzulaufen", NUR_POSIX, () => {
  mitFixture((dir) => {
    // Ordner UND Datei schreibgeschuetzt: genau die Sandbox-Sperre aus Issue #186.
    // Der Ordner allein genuegt nicht — zum Ueberschreiben einer vorhandenen Datei
    // braucht es nur deren eigenes Schreibrecht, nicht das des Verzeichnisses.
    // Ein verschluckter Fehler waere derselbe Fehler eine Ebene tiefer: sync-blobs
    // meldete "aufgefrischt", waehrend die Kopie alt bleibt.
    chmodSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), 0o444);
    chmodSync(join(dir, ".claude", "skills", "beispiel"), 0o555);

    const res = syncBlobs(dir);

    assert.equal(res.status, 1, `sync-blobs haette mit Exit 1 abbrechen muessen: ${res.stdout}`);
    assert.match(res.stderr, /liess sich nicht schreiben/, "der Schreibfehler wird nicht benannt");
    assert.match(res.stderr, /EACCES|EPERM/, "der Systemfehler fehlt — ohne ihn ist die Ursache unklar");
    assert.match(res.stderr, /Schreibschutz|Sandbox/,
      "die Meldung nennt die wahrscheinliche Ursache nicht");
    // Die alte Kopie bleibt unveraendert — es wird nichts halb geschrieben.
    assert.equal(readFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), "utf-8"), "alt\n",
      "die Kopie wurde trotz Fehler veraendert");
  }, { kopien: { beispiel: "alt\n" } });
});

test("--check meldet die abweichende Skill-Kopie, ohne sie zu schreiben", () => {
  mitFixture((dir) => {
    const res = syncBlobs(dir, "--check");

    assert.equal(res.status, 1, "--check haette die Drift melden muessen");
    assert.match(res.stdout + res.stderr, /\.claude\/skills\/beispiel\/SKILL\.md/,
      "die abweichende Kopie wird nicht benannt");
    assert.equal(readFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), "utf-8"), "alt\n",
      "--check darf nichts schreiben");
  }, { kopien: { beispiel: "alt\n" } });
});

test("ohne KIT_ROOT gilt das Repo, aus dem das Script stammt", () => {
  // Der Test-Hook KIT_ROOT verlegt die Suche ins Fixture; ohne ihn muss sync-blobs
  // sein EIGENES Repo finden — unabhaengig davon, von wo es gestartet wird. Genau
  // dieser Weg laeuft im Pflichtcheck, und er ist der einzige, den kein anderer Test
  // betritt.
  //
  // `--check` ist dabei rein lesend: Es vergleicht und schreibt nichts. Ein cwd
  // ausserhalb des Repos belegt zugleich, dass die Aufloesung nicht am
  // Arbeitsverzeichnis haengt.
  const fremd = mkdtempSync(join(tmpdir(), "sync-fremdes-cwd-"));
  try {
    const env = { ...process.env };
    delete env.KIT_ROOT;
    const res = spawnSync(process.execPath, [join(repoRoot, "tools", "sync-blobs.mjs"), "--check"],
      { cwd: fremd, encoding: "utf-8", env });

    assert.equal(res.status, 0,
      `--check gegen das eigene Repo war rot — entweder ist das Repo wirklich unsynchron `
      + `(dann behebt es 'node tools/sync-blobs.mjs'), oder die Root-Aufloesung ohne `
      + `KIT_ROOT ist kaputt: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /synchron mit kit\//,
      "die Meldung bestaetigt den Abgleich nicht");
  } finally {
    rmSync(fremd, { recursive: true, force: true });
  }
});
