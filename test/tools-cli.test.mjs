// Die CLI- und I/O-Schicht der tools/-Scripts (Issue #189).
//
// Die reine Logik von changelog.mjs (parseVersions, renderChangelog) ist in
// changelog.test.mjs abgedeckt, der Stempel-Weg von sync-blobs.mjs in
// sync-blobs-stamp.test.mjs. Hier stehen die Randfaelle drumherum: fehlende oder
// kaputte Quelldateien, fehlende Startmarke, --check gegen einen veralteten Stand.
//
// Wie dort laufen die ECHTEN Scripts aus dem Repo mit cwd (und wo noetig KIT_ROOT)
// im Fixture — eine Kopie im Temp-Verzeichnis wuerde Coverage unter einem Pfad
// erzeugen, den SonarCloud nicht auf die Repo-Datei abbilden kann (Issue #186).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_TOOL = join(repoRoot, "tools", "version.mjs");
const CHANGELOG_TOOL = join(repoRoot, "tools", "changelog.mjs");
const SYNC_TOOL = join(repoRoot, "tools", "sync-blobs.mjs");

function laufe(dir, tool, cliArgs = [], extraEnv = {}) {
  return spawnSync(process.execPath, [tool, ...cliArgs],
    { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir, ...extraEnv } });
}

function tempDir(praefix) {
  return mkdtempSync(join(tmpdir(), praefix));
}

// ============================================================
// tools/version.mjs
// ============================================================

function mitInstall(praefix, inhalt) {
  const dir = tempDir(praefix);
  if (inhalt !== null) writeFileSync(join(dir, "install.mjs"), inhalt, "utf-8");
  return dir;
}

function installVersionVon(dir) {
  return readFileSync(join(dir, "install.mjs"), "utf-8").match(/const VERSION = "([^"]+)";/)[1];
}

test("version.mjs --get liest die Version, ohne die Datei zu veraendern", () => {
  const dir = mitInstall("version-get-", 'const VERSION = "1.26.0";\n');
  try {
    const res = laufe(dir, VERSION_TOOL, ["--get"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), "1.26.0");
    assert.equal(installVersionVon(dir), "1.26.0", "--get darf nicht schreiben");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("version.mjs erhoeht patch, minor und major nach Semver-Regeln", () => {
  for (const [flag, erwartet] of [["--patch", "1.26.1"], ["--minor", "1.27.0"], ["--major", "2.0.0"]]) {
    const dir = mitInstall(`version-bump-${flag.slice(2)}-`, 'const VERSION = "1.26.0";\nconst REST = "unberuehrt";\n');
    try {
      const res = laufe(dir, VERSION_TOOL, [flag]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout.trim(), erwartet, `${flag} lieferte die falsche Version`);
      assert.equal(installVersionVon(dir), erwartet, `${flag} schrieb die Version nicht zurueck`);
      assert.match(readFileSync(join(dir, "install.mjs"), "utf-8"), /const REST = "unberuehrt";/,
        "der Rest der Datei muss unveraendert bleiben");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("version.mjs bricht ohne gueltiges Flag ab", () => {
  const dir = mitInstall("version-noflag-", 'const VERSION = "1.26.0";\n');
  try {
    for (const args of [[], ["--unfug"]]) {
      const res = laufe(dir, VERSION_TOOL, args);
      assert.equal(res.status, 1, `'${args.join(" ")}' haette abbrechen muessen`);
      assert.match(res.stderr, /Kein gueltiges Flag[\s\S]*--get \| --patch \| --minor \| --major/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("version.mjs bricht bei fehlender oder unlesbarer VERSION-Konstante ab", () => {
  const ohneDatei = mitInstall("version-nofile-", null);
  try {
    const res = laufe(ohneDatei, VERSION_TOOL, ["--get"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /install\.mjs nicht gefunden/);
  } finally {
    rmSync(ohneDatei, { recursive: true, force: true });
  }

  const ohneKonstante = mitInstall("version-noconst-", 'const ETWAS = "anderes";\n');
  try {
    const res = laufe(ohneKonstante, VERSION_TOOL, ["--patch"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /VERSION-Konstante in install\.mjs nicht gefunden/);
  } finally {
    rmSync(ohneKonstante, { recursive: true, force: true });
  }
});

// ============================================================
// tools/sync-blobs.mjs — Fehlerpfade und der Fall "nichts zu tun"
// ============================================================

// Minimales Repo mit allem, was sync-blobs.mjs anfasst (wie in sync-blobs-stamp).
function syncFixture(praefix, { installZeilen, kitVersion = "1.26.0" } = {}) {
  const dir = tempDir(praefix);
  mkdirSync(join(dir, "kit"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  mkdirSync(join(dir, "skills", "beispiel"), { recursive: true });
  writeFileSync(join(dir, "templates", "CLAUDE-workflow.md"), "# Vorlage\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Fachplan.md"), "# Fachplan-Gates\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Plan.md"), "# Plan-Gates\n");
  writeFileSync(join(dir, "templates", "workflow.config.json"), JSON.stringify({ codeHost: "github" }) + "\n");
  writeFileSync(join(dir, "skills", "beispiel", "SKILL.md"), "# Beispiel-Skill\n");
  for (const datei of ["board.mjs", "night.mjs"]) {
    writeFileSync(join(dir, "kit", datei), `const KIT_VERSION = "${kitVersion}";\nconsole.log("${datei}");\n`);
  }
  writeFileSync(join(dir, "install.mjs"), installZeilen.join("\n") + "\n");
  return dir;
}

const BLOB_KONSTANTEN = ["CONFIG_EXAMPLE_B64", "CLAUDE_WORKFLOW_MD_B64", "CLAUDE_FACHPLAN_MD_B64", "CLAUDE_PLAN_MD_B64", "BOARD_MJS_B64", "NIGHT_MJS_B64", "SKILLS_B64"];

test("sync-blobs bricht ab, wenn install.mjs keine VERSION-Konstante hat", () => {
  const dir = syncFixture("sync-noversion-", {
    installZeilen: BLOB_KONSTANTEN.map((k) => `const ${k} = "";`),
  });
  try {
    const res = laufe(dir, SYNC_TOOL);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /VERSION-Konstante nicht in install\.mjs gefunden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-blobs bricht ab, wenn eine Blob-Konstante in install.mjs fehlt", () => {
  const dir = syncFixture("sync-noblob-", {
    installZeilen: [
      'const VERSION = "1.26.0";',
      // BOARD_MJS_B64 fehlt absichtlich
      ...BLOB_KONSTANTEN.filter((k) => k !== "BOARD_MJS_B64").map((k) => `const ${k} = "";`),
    ],
  });
  try {
    const res = laufe(dir, SYNC_TOOL);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Konstante BOARD_MJS_B64 nicht in install\.mjs gefunden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-blobs meldet 'bereits synchron', wenn ein zweiter Lauf nichts findet", () => {
  const dir = syncFixture("sync-idempotent-", {
    installZeilen: ['const VERSION = "1.26.0";', ...BLOB_KONSTANTEN.map((k) => `const ${k} = "";`)],
  });
  try {
    const erster = laufe(dir, SYNC_TOOL);
    assert.equal(erster.status, 0, erster.stderr);
    assert.match(erster.stdout, /Aktualisiert:/, "der erste Lauf muss die leeren Blobs fuellen");

    const zweiter = laufe(dir, SYNC_TOOL);
    assert.equal(zweiter.status, 0, zweiter.stderr);
    assert.equal(zweiter.stdout.trim(), "Blobs bereits synchron.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// tools/changelog.mjs — I/O-Schicht
// ============================================================

// Repo mit der Startmarke 'chore: v1.16.0' und einer kleinen Historie darueber.
// Die Reihenfolge der Commits bestimmt die Zuordnung: Feature-Commits gehoeren zur
// naechsten chore-Marke, alles nach der letzten zur aktuellen Version.
function changelogFixture(praefix, { version = "1.17.0", commits = [] } = {}) {
  const dir = tempDir(praefix);
  writeFileSync(join(dir, "install.mjs"), `const VERSION = "${version}";\n`, "utf-8");
  const git = (...args) => {
    const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Changelog Test");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: v1.16.0");
  for (const betreff of commits) {
    writeFileSync(join(dir, `${betreff.replace(/\W+/g, "-")}.txt`), betreff, "utf-8");
    git("add", "-A");
    git("commit", "-q", "-m", betreff);
  }
  return dir;
}

test("changelog.mjs schreibt CHANGELOG.md aus der git-Historie", () => {
  const dir = changelogFixture("changelog-write-", {
    version: "1.17.0",
    commits: ["Erstes Feature (Issue #1)", "chore: v1.16.1", "Zweites Feature (Issue #2)"],
  });
  try {
    const res = laufe(dir, CHANGELOG_TOOL);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), "CHANGELOG.md geschrieben.");

    const inhalt = readFileSync(join(dir, "CHANGELOG.md"), "utf-8");
    assert.match(inhalt, /## \[Unreleased\]/, "unveroeffentlichte Commits stehen unter [Unreleased] (Issue #265)");
    assert.doesNotMatch(inhalt, /## \[1\.17\.0\]/, "die Version aus install.mjs gehoert nicht mehr in den Changelog");
    assert.match(inhalt, /Zweites Feature/);
    assert.match(inhalt, /## \[1\.16\.1\]/);
    assert.match(inhalt, /Erstes Feature/);
    assert.doesNotMatch(inhalt, /chore: v/, "chore-Commits sind Versionsmarken, keine Eintraege");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changelog.mjs --check bestaetigt einen aktuellen Stand und meldet einen veralteten", () => {
  const dir = changelogFixture("changelog-check-", { commits: ["Ein Feature (Issue #3)"] });
  try {
    laufe(dir, CHANGELOG_TOOL); // erzeugt den aktuellen Stand
    const aktuell = laufe(dir, CHANGELOG_TOOL, ["--check"]);
    assert.equal(aktuell.status, 0, aktuell.stderr);
    assert.equal(aktuell.stdout.trim(), "CHANGELOG.md ist aktuell.");

    writeFileSync(join(dir, "CHANGELOG.md"), "# Von Hand verbogen\n", "utf-8");
    const veraltet = laufe(dir, CHANGELOG_TOOL, ["--check"]);
    assert.equal(veraltet.status, 1, "ein veralteter Stand muss das Gate rot machen");
    assert.match(veraltet.stderr, /CHANGELOG\.md ist nicht aktuell/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changelog.mjs bricht ohne Startmarke in der Historie ab", () => {
  const dir = tempDir("changelog-nostart-");
  try {
    writeFileSync(join(dir, "install.mjs"), 'const VERSION = "1.17.0";\n', "utf-8");
    for (const args of [["init", "-q"], ["config", "user.email", "t@e.invalid"], ["config", "user.name", "T"],
      ["add", "-A"], ["commit", "-q", "-m", "Nur ein Commit ohne Marke"]]) {
      spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
    }
    const res = laufe(dir, CHANGELOG_TOOL);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Startmarke 'chore: v1\.16\.0' nicht in der Historie gefunden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changelog.mjs braucht install.mjs nicht mehr", () => {
  // Bis Issue #265 las das Tool die VERSION aus install.mjs fuer den obersten
  // Block. Seit der Block [Unreleased] heisst, ist die Datei gegenstandslos —
  // changelog.mjs haengt nur noch an der git-Historie.
  const dir = changelogFixture("changelog-noinstall-", { commits: ["Ein Feature (Issue #7)"] });
  try {
    rmSync(join(dir, "install.mjs"));
    const res = laufe(dir, CHANGELOG_TOOL);
    assert.equal(res.status, 0, res.stderr);
    assert.match(readFileSync(join(dir, "CHANGELOG.md"), "utf-8"), /Ein Feature \(#7\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changelog.mjs meldet einen gescheiterten git-Aufruf als solchen", () => {
  // Kein git-Repo: der erste git-Aufruf scheitert, und das muss als git-Fehler
  // erkennbar sein statt als leere Historie durchzurutschen.
  const dir = tempDir("changelog-nogit-");
  try {
    writeFileSync(join(dir, "install.mjs"), 'const VERSION = "1.17.0";\n', "utf-8");
    const res = laufe(dir, CHANGELOG_TOOL, [], { GIT_CEILING_DIRECTORIES: dirname(dir) });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /git log .* schlug fehl/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- sync-blobs: Dogfooding-Kopien unter .claude/skills/ (Issue #213) ---
//
// Der Anlass ist ein Fehlbild vom 2026-08-06: Zwei Skill-Issues liefen in einem
// Nachtlauf in eine Schreibsperre auf .claude/skills/, die Kopien drifteten — und
// `sync-blobs --check` blieb gruen, weil es nur .claude/kit/ abglich. Die Konsistenz
// der Skill-Kopien stand damit allein als Bitte im Issue-Text.

/**
 * Fixture, in dem NUR die Skill-Kopien driften koennen.
 *
 * Der erste sync-Lauf backt die Blobs korrekt — sonst waere `--check` schon wegen
 * Blob-Drift rot und die Tests unten wuerden gar nicht messen, was sie behaupten.
 * Erst danach entsteht .claude/skills mit dem gewuenschten Zustand.
 *
 * kopien: null = Verzeichnis fehlt ganz | undefined = Verzeichnis da, Datei fehlt |
 * String = Datei mit diesem Inhalt.
 */
function skillsFixture(praefix, { kopien }) {
  const dir = syncFixture(praefix, { installZeilen: gueltigeInstallZeilen() });
  const vorlauf = laufe(dir, SYNC_TOOL);
  assert.equal(vorlauf.status, 0, `Vorlauf muss gruen sein: ${vorlauf.stderr}`);
  const sauber = laufe(dir, SYNC_TOOL, ["--check"]);
  assert.equal(sauber.status, 0, `Fixture muss vor der Manipulation synchron sein: ${sauber.stderr}`);

  if (kopien !== null) {
    mkdirSync(join(dir, ".claude", "skills", "beispiel"), { recursive: true });
    if (kopien !== undefined) {
      writeFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), kopien);
    }
  }
  return dir;
}

/** install.mjs-Zeilen mit allen Konstanten, damit sync-blobs bis zu den Kopien kommt. */
function gueltigeInstallZeilen() {
  return [
    'const VERSION = "1.26.0";',
    ...BLOB_KONSTANTEN.map((c) => `const ${c} = "";`),
  ];
}

test("sync-blobs --check wird rot, wenn eine Skill-Kopie von ihrer Quelle abweicht", () => {
  const dir = skillsFixture("sync-skills-drift-", { kopien: "# Alter Stand\n" });
  try {
    const res = laufe(dir, SYNC_TOOL, ["--check"]);
    assert.notEqual(res.status, 0, "Drift in einer Skill-Kopie muss rot sein");
    assert.match(res.stderr, /Lokale Kopie veraltet/);
    assert.match(res.stderr, /\.claude\/skills\/beispiel\/SKILL\.md/,
      "die Meldung muss die abweichende Datei benennen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-blobs --check wird rot, wenn eine Skill-Kopie ganz fehlt", () => {
  // Ein neu angelegter Skill darf nicht unbemerkt aus dem Dogfooding verschwinden.
  const dir = skillsFixture("sync-skills-fehlt-", { kopien: undefined });
  try {
    const res = laufe(dir, SYNC_TOOL, ["--check"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /\.claude\/skills\/beispiel\/SKILL\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-blobs frischt die Skill-Kopie auf und macht --check danach gruen", () => {
  const dir = skillsFixture("sync-skills-fix-", { kopien: "# Alter Stand\n" });
  try {
    const lauf = laufe(dir, SYNC_TOOL);
    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /beispiel/);
    assert.equal(
      readFileSync(join(dir, ".claude", "skills", "beispiel", "SKILL.md"), "utf-8"),
      "# Beispiel-Skill\n"
    );
    const check = laufe(dir, SYNC_TOOL, ["--check"]);
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-blobs: fehlendes .claude/skills/ ist ein stiller Skip, kein Fehler", () => {
  // Frischer Clone ohne lokale Installation — dort gibt es nichts abzugleichen.
  const dir = skillsFixture("sync-skills-leer-", { kopien: null });
  try {
    const res = laufe(dir, SYNC_TOOL, ["--check"]);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /beispiel/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
