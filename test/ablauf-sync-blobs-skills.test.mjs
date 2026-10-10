// Ablauf-Pruefung: tools/sync-blobs.mjs schreibt die Skill-Kopien in einem Wegwerf-Repo; das zeigt nur der Start als Programm.
//
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

function setupFixture({
  skills = { beispiel: "# Beispiel-Skill\n" }, kopien = null,
  agenten = { "kit-pruefer.md": "# Leser\n" }, agentKopien = null,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-skills-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "kit"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, ".githooks"), { recursive: true });

  writeFileSync(join(dir, "templates", "CLAUDE-workflow.md"), "# Vorlage\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Fachplan.md"), "# Fachplan-Gates\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Plan.md"), "# Plan-Gates\n");
  writeFileSync(join(dir, "templates", "workflow.config.json"), `${JSON.stringify({ codeHost: "github" })}\n`);
  for (const datei of ["board.mjs", "night.mjs", "checks.mjs", "preise.mjs", "aufwand.mjs", "wirksamkeit.mjs", "befunde.mjs", "worktree.mjs"]) {
    writeFileSync(join(dir, "kit", datei), `const KIT_VERSION = "1.0.0";\nconsole.log("${datei}");\n`);
  }
  // Seit Issue #676: die Download-Datei mit Stempel und eingebettetem Schema.
  writeFileSync(join(dir, "templates", "workflow.config.schema.json"), "{}\n");
  writeFileSync(join(dir, "kit", "einstellungen.mjs"), `const KIT_VERSION = "1.0.0";\nconst SCHEMA_B64 = "";\n`);
  // Hook und Gate liegen ausserhalb von kit/ und tragen keinen Versions-Stempel
  // (Issue #473): gate.mjs steht bewusst nicht in STAMPED.
  writeFileSync(join(dir, ".githooks", "gate.mjs"), 'console.log("gate");\n');
  writeFileSync(join(dir, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(dir, "install.mjs"), [
    'const VERSION = "1.0.0";',
    'const CONFIG_EXAMPLE_B64 = "";',
    'const CLAUDE_WORKFLOW_MD_B64 = "";',
    'const CLAUDE_FACHPLAN_MD_B64 = "";',
    'const CLAUDE_PLAN_MD_B64 = "";',
    'const BOARD_MJS_B64 = "";',
    'const NIGHT_MJS_B64 = "";',
    'const CHECKS_MJS_B64 = "";',
    'const PREISE_MJS_B64 = "";',
    'const AUFWAND_MJS_B64 = "";',
    'const WIRKSAMKEIT_MJS_B64 = "";',
    'const BEFUNDE_MJS_B64 = "";',
    'const WORKTREE_MJS_B64 = "";',
    'const KIT_NIGHT_B64 = "";',
    'const KIT_BOARD_B64 = "";',
    'const KIT_ROLLEN_B64 = "";',
    'const GATE_MJS_B64 = "";',
    'const PRE_COMMIT_B64 = "";',
    'const SKILLS_B64 = "";',
    'const AGENTS_B64 = "";',
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
  // Der Leser-Agent (Issue #1377): eine flache Quelle agents/, Kopie unter .claude/agents/.
  mkdirSync(join(dir, "agents"), { recursive: true });
  for (const [datei, inhalt] of Object.entries(agenten)) writeFileSync(join(dir, "agents", datei), inhalt);
  if (agentKopien) {
    mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
    for (const [datei, inhalt] of Object.entries(agentKopien)) writeFileSync(join(dir, ".claude", "agents", datei), inhalt);
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
    // Unter Windows haelt das Read-only-Attribut der Datei sonst das Aufraeumen auf.
    if (existsSync(join(geschuetzt, "SKILL.md"))) chmodSync(join(geschuetzt, "SKILL.md"), 0o644);
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

test("ein schreibgeschuetztes Ziel bricht sichtbar ab, statt still weiterzulaufen", () => {
  mitFixture((dir) => {
    // Ordner UND Datei schreibgeschuetzt: genau die Sandbox-Sperre aus Issue #186.
    // Der Ordner allein genuegt nicht — zum Ueberschreiben einer vorhandenen Datei
    // braucht es nur deren eigenes Schreibrecht, nicht das des Verzeichnisses.
    // Unter Windows setzt `chmod 0o444` das Read-only-Attribut der Datei; das traegt den
    // Schreibschutz dort allein, das chmod am Ordner wirkt nicht (Plan #1128 E7).
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

// --- Fester Kit-Stand eines laufenden Laufs (Issue #1102, Plan #1101 A5) ---
//
// Traegt der Baum eine lebende Markierung `.claude/kit-stand.json`, gehoert die Kopie dem
// Lauf: Weder `.claude/kit/` noch `.claude/skills/` werden geschrieben, und `--check` meldet
// ihre Abweichung nicht. Die Blobs in install.mjs bleiben Pruefgegenstand. Eine verwaiste
// Markierung (toter Prozess) gilt nicht, ebenso wenig eine fehlende.

const STAND_COMMIT = "0123456789abcdef0123456789abcdef01234567";

function markieren(dir, pid) {
  writeFileSync(join(dir, ".claude", "kit-stand.json"),
    JSON.stringify({ commit: STAND_COMMIT, pfad: "/irgendwo", pid, seit: new Date().toISOString() }));
}

/** Die PID eines Prozesses, der schon beendet ist. */
function totePid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

test("[kitstand-5] eine lebende Markierung laesst beide Kopien stehen und nennt den Lauf, die Blobs werden trotzdem geschrieben", () => {
  mitFixture((dir) => {
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), "// Stand des Laufs\n");
    markieren(dir, process.pid);

    const res = syncBlobs(dir);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`Kopie gehört dem Lauf auf ${STAND_COMMIT.slice(0, 12)}`));
    assert.equal(readFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), "utf-8"), "alt\n",
      "die Skill-Kopie des Laufs wurde ueberschrieben");
    assert.equal(readFileSync(join(dir, ".claude", "kit", "board.mjs"), "utf-8"), "// Stand des Laufs\n",
      "die Kit-Kopie des Laufs wurde ueberschrieben");
    assert.doesNotMatch(readFileSync(join(dir, "install.mjs"), "utf-8"), /const SKILLS_B64 = "";/,
      "die Blobs in install.mjs gehoeren weiter geschrieben");
  }, { kopien: { beispiel: "alt\n" } });
});

test("[kitstand-5] --check meldet bei lebender Markierung keine Kopie als veraltet, die Blob-Drift aber weiter", () => {
  mitFixture((dir) => {
    markieren(dir, process.pid);

    const res = syncBlobs(dir, "--check");

    assert.equal(res.status, 1, "die leeren Blobs des Fixtures sind Drift");
    assert.match(res.stderr, /Blob-Drift/);
    assert.doesNotMatch(res.stdout + res.stderr, /Lokale Kopie veraltet/);
    assert.match(res.stdout, /Kopie gehört dem Lauf auf/);
  }, { kopien: { beispiel: "alt\n" } });
});

test("[kitstand-5] eine verwaiste Markierung gilt nicht: die Kopie wird aufgefrischt und --check meldet sie", () => {
  mitFixture((dir) => {
    markieren(dir, totePid());

    const check = syncBlobs(dir, "--check");
    assert.match(check.stderr, /Lokale Kopie veraltet: .*\.claude\/skills\/beispiel\/SKILL\.md/);
    assert.doesNotMatch(check.stdout, /Kopie gehört dem Lauf/);

    const res = syncBlobs(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), "utf-8"), "# Beispiel-Skill\n");
  }, { kopien: { beispiel: "alt\n" } });
});

test("[kitstand-5] ohne Markierung bleibt alles beim Alten, auch mit KIT_STAND in der Umgebung", () => {
  mitFixture((dir) => {
    const res = spawnSync(process.execPath, [join(repoRoot, "tools", "sync-blobs.mjs")], {
      cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir, KIT_STAND: STAND_COMMIT, KIT_STAND_PFAD: "/nicht/vorhanden" },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /Kopie gehört dem Lauf/);
    assert.equal(readFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), "utf-8"), "# Beispiel-Skill\n");
  }, { kopien: { beispiel: "alt\n" } });
});

// --- Rollen und Leser-Agent (Issue #1377, Plan #1375) ---
//
// Die Rollen reisen als Teil wie kit/night/ und kit/board/: Blob KIT_ROLLEN_B64 und Kopie
// nach .claude/kit/rollen/. Der Leser-Agent ist eine eigene, flache Quelle agents/: Blob
// AGENTS_B64 und Kopie nach .claude/agents/, bewacht wie die Kopie der Skills.

/** Liest den Blob `name` aus der install.mjs des Fixtures als JSON. */
function blobLesen(dir, name) {
  const m = readFileSync(join(dir, "install.mjs"), "utf-8").match(new RegExp(`const ${name} = "([A-Za-z0-9+/=]*)";`));
  assert.ok(m, `${name} fehlt in install.mjs`);
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf-8"));
}

test("der Teil rollen und der Blob AGENTS_B64 werden erzeugt", () => {
  mitFixture((dir) => {
    mkdirSync(join(dir, "kit", "rollen"), { recursive: true });
    writeFileSync(join(dir, "kit", "rollen", "code-review.md"), "# Code-Review\n");

    const res = syncBlobs(dir);

    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(blobLesen(dir, "KIT_ROLLEN_B64"), { "code-review.md": "# Code-Review\n" });
    assert.deepEqual(blobLesen(dir, "AGENTS_B64"), { "kit-pruefer.md": "# Leser\n" });
    assert.equal(readFileSync(join(dir, ".claude", "kit", "rollen", "code-review.md"), "utf-8"), "# Code-Review\n",
      "die Rollen gehoeren in die Kopie unter .claude/kit/rollen/");
    assert.equal(readFileSync(join(dir, ".claude", "agents", "kit-pruefer.md"), "utf-8"), "# Leser\n",
      "eine fehlende Agenten-Kopie entsteht wie ein fehlender Skill");
  }, { kopien: { beispiel: "# Beispiel-Skill\n" } });
});

test("--check meldet die abweichende Agenten-Kopie, ohne sie zu schreiben", () => {
  mitFixture((dir) => {
    const res = syncBlobs(dir, "--check");

    assert.equal(res.status, 1);
    assert.match(res.stderr, /Lokale Kopie veraltet: .*\.claude\/agents\/kit-pruefer\.md/);
    assert.equal(readFileSync(join(dir, ".claude", "agents", "kit-pruefer.md"), "utf-8"), "alt\n",
      "--check darf nichts schreiben");
  }, { kopien: { beispiel: "# Beispiel-Skill\n" }, agentKopien: { "kit-pruefer.md": "alt\n" } });
});

test("eine gleiche Agenten-Kopie wird nicht gemeldet, ohne installierte Kopie entsteht keine", () => {
  mitFixture((dir) => {
    const res = syncBlobs(dir, "--check");
    assert.doesNotMatch(res.stdout + res.stderr, /\.claude\/agents\//);
  }, { kopien: { beispiel: "# Beispiel-Skill\n" }, agentKopien: { "kit-pruefer.md": "# Leser\n" } });

  mitFixture((dir) => {
    const res = syncBlobs(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(existsSync(join(dir, ".claude", "agents")), false,
      "ein frischer Clone ohne .claude/skills/ bekommt keine Agenten-Kopie");
  });
});

test("[kitstand-5] eine lebende Markierung laesst auch die Agenten-Kopie stehen", () => {
  mitFixture((dir) => {
    markieren(dir, process.pid);

    const res = syncBlobs(dir);

    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(join(dir, ".claude", "agents", "kit-pruefer.md"), "utf-8"), "alt\n");
  }, { kopien: { beispiel: "alt\n" }, agentKopien: { "kit-pruefer.md": "alt\n" } });
});
