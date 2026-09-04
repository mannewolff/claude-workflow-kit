// Versions-Stempel durch sync-blobs.mjs (Issue #171).
//
// Issue #170 hat die KIT_VERSION-Konstante angelegt, zunaechst von Hand gesetzt.
// Von Hand gepflegt waere sie wertlos: Man vergisst sie, und dann behauptet eine
// Datei einen Stand, den sie nicht hat — schlimmer als gar keine Angabe.
//
// sync-blobs.mjs stempelt sie deshalb selbst. Dass ausgerechnet dieses Tool
// zustaendig ist, hat einen Grund: Wuerde version.mjs stempeln, waeren nach dem
// Bump die Blobs veraltet und `sync-blobs --check` — ein buildCheck dieses Repos —
// ginge zwischenzeitlich rot. So bleibt es ein atomarer Schritt.
//
// Getestet wird gegen ein Fixture-Repo im Temp-Verzeichnis. sync-blobs.mjs laeuft
// dabei aus dem Repo und bekommt den Fixture-Pfad ueber den Test-Hook KIT_ROOT
// (Issue #186) — vollstaendig isoliert, und die Coverage landet unter der
// Repo-Datei statt unter einem Temp-Pfad.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Die gestempelten Kit-Dateien (STAMPED in sync-blobs.mjs). Bewusst eine Konstante:
// Kommt ein Werkzeug dazu (checks.mjs mit Issue #425, spec.mjs mit Issue #441),
// faellt hier genau eine Stelle an statt drei ueber die Datei verteilte Literale.
const KIT_DATEIEN = ["board.mjs", "night.mjs", "checks.mjs", "spec.mjs"];

// Minimales Repo mit allem, was sync-blobs.mjs anfasst: die Blob-Quellen und
// eine install.mjs mit allen Konstanten plus VERSION.
function setupFixture(installVersion, kitVersion, { lokaleKopie = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-stamp-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "kit"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  mkdirSync(join(dir, "skills", "beispiel"), { recursive: true });
  if (lokaleKopie) mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, ".githooks"), { recursive: true });
  // Hook und Gate stehen seit Issue #473 im Blob-Register; gate.mjs bewusst
  // ohne Versions-Stempel (nicht in STAMPED).
  writeFileSync(join(dir, ".githooks", "gate.mjs"), 'console.log("gate");\n');
  writeFileSync(join(dir, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");

  writeFileSync(join(dir, "templates", "CLAUDE-workflow.md"), "# Vorlage\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Fachplan.md"), "# Fachplan-Gates\n");
  writeFileSync(join(dir, "templates", "CLAUDE-Plan.md"), "# Plan-Gates\n");
  writeFileSync(join(dir, "templates", "workflow.config.json"), JSON.stringify({ codeHost: "github" }) + "\n");
  writeFileSync(join(dir, "skills", "beispiel", "SKILL.md"), "# Beispiel-Skill\n");
  for (const datei of KIT_DATEIEN) {
    writeFileSync(join(dir, "kit", datei),
      `const KIT_VERSION = "${kitVersion}";\nconsole.log("${datei}");\n`);
  }
  writeFileSync(join(dir, "install.mjs"), [
    `const VERSION = "${installVersion}";`,
    `const CONFIG_EXAMPLE_B64 = "";`,
    `const CLAUDE_WORKFLOW_MD_B64 = "";`,
    `const CLAUDE_FACHPLAN_MD_B64 = "";`,
    `const CLAUDE_PLAN_MD_B64 = "";`,
    `const BOARD_MJS_B64 = "";`,
    `const NIGHT_MJS_B64 = "";`,
    `const CHECKS_MJS_B64 = "";`,
    `const SPEC_MJS_B64 = "";`,
    `const GATE_MJS_B64 = "";\nconst PRE_COMMIT_B64 = "";\nconst SKILLS_B64 = "";`,
    "",
  ].join("\n"));
  return dir;
}

// Fuehrt das ECHTE Script aus dem Repo aus und zeigt nur mit KIT_ROOT ins Fixture
// (Issue #186). Eine Kopie im Temp-Verzeichnis wuerde Coverage unter einem Pfad
// erzeugen, den SonarCloud nicht auf die Repo-Datei abbilden kann.
function syncBlobs(dir, ...cliArgs) {
  return spawnSync(process.execPath, [join(repoRoot, "tools", "sync-blobs.mjs"), ...cliArgs],
    { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
}

function stempel(dir, datei) {
  const m = readFileSync(join(dir, "kit", datei), "utf-8").match(/const KIT_VERSION = "([^"]*)";/);
  return m ? m[1] : null;
}

test("Stempel: sync-blobs schreibt die install.mjs-VERSION in alle Kit-Dateien", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    const res = syncBlobs(dir);
    assert.equal(res.status, 0, `sync-blobs schlug fehl: ${res.stderr}${res.stdout}`);

    for (const datei of KIT_DATEIEN) {
      assert.equal(stempel(dir, datei), "2.5.0", `${datei} wurde nicht gestempelt`);
    }
    assert.equal(syncBlobs(dir, "--check").status, 0, "--check haette danach gruen sein muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: der Blob enthaelt die GESTEMPELTE Fassung, nicht die alte", () => {
  // Reihenfolge-Falle: wird erst der Blob gebacken und dann gestempelt, traegt
  // install.mjs die Datei mit dem alten Stempel — und jede Neuinstallation
  // verteilt eine Kopie, die eine falsche Version behauptet.
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    assert.equal(syncBlobs(dir).status, 0);

    const installSrc = readFileSync(join(dir, "install.mjs"), "utf-8");
    const b64 = installSrc.match(/const BOARD_MJS_B64 = "([^"]*)";/)[1];
    const eingebettet = Buffer.from(b64, "base64").toString("utf-8");
    assert.match(eingebettet, /const KIT_VERSION = "2\.5\.0";/,
      "der eingebettete Blob traegt noch den alten Stempel");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: --check meldet Stempel-Drift getrennt vom Blob-Drift", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    assert.equal(syncBlobs(dir).status, 0);
    // Nur den Stempel verfaelschen; die Blobs bleiben zur Datei auf Platte konsistent.
    const pfad = join(dir, "kit", "night.mjs");
    writeFileSync(pfad, readFileSync(pfad, "utf-8").replace('"2.5.0"', '"1.9.9"'));

    const res = syncBlobs(dir, "--check");
    assert.equal(res.status, 1, "--check haette bei Stempel-Drift fehlschlagen muessen");
    const meldung = res.stderr + res.stdout;
    assert.match(meldung, /night\.mjs/, "die Meldung nennt die betroffene Datei nicht");
    assert.match(meldung, /1\.9\.9/, "die Meldung nennt den vorgefundenen Wert nicht");
    assert.match(meldung, /2\.5\.0/, "die Meldung nennt den erwarteten Wert nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: nach einem Versions-Bump zieht sync-blobs alle Dateien nach", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    assert.equal(syncBlobs(dir).status, 0);
    // Bump wie durch tools/version.mjs --patch.
    const install = join(dir, "install.mjs");
    writeFileSync(install, readFileSync(install, "utf-8").replace('const VERSION = "2.5.0";', 'const VERSION = "2.5.1";'));

    assert.equal(syncBlobs(dir, "--check").status, 1, "--check haette den Bump als Drift melden muessen");
    assert.equal(syncBlobs(dir).status, 0, "sync-blobs haette den Bump nachziehen muessen");
    for (const datei of KIT_DATEIEN) assert.equal(stempel(dir, datei), "2.5.1");
    assert.equal(syncBlobs(dir, "--check").status, 0, "--check haette danach gruen sein muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: fehlende KIT_VERSION-Konstante ist ein harter Fehler, kein stiller Skip", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    writeFileSync(join(dir, "kit", "board.mjs"), "console.log('ohne Konstante');\n");

    const res = syncBlobs(dir);
    assert.equal(res.status, 1, "eine fehlende Konstante haette abbrechen muessen");
    assert.match(res.stderr, /KIT_VERSION/, "die Fehlermeldung nennt die Konstante nicht");
    assert.match(res.stderr, /board\.mjs/, "die Fehlermeldung nennt die Datei nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Blob-Drift: eine Aenderung an kit/spec.mjs ohne Sync macht --check rot", () => {
  // Der Beleg fuer den BLOBS-Eintrag von spec.mjs (Issue #441). Mit STAMPED allein
  // bliebe SPEC_MJS_B64 leer und dieser Lauf gruen — genau der Drift, gegen den das
  // Werkzeug existiert.
  //
  // Bewusst ohne lokale Kopie: Sonst schluege auch der copyDrift an, und der Lauf
  // waere ebenso rot, wenn spec.mjs nur in STAMPED stuende.
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    assert.equal(syncBlobs(dir).status, 0);
    assert.equal(syncBlobs(dir, "--check").status, 0, "--check haette gruen sein muessen");

    // Nur den Inhalt aendern, den Stempel unberuehrt lassen: So kann allein der Blob
    // driften.
    const pfad = join(dir, "kit", "spec.mjs");
    writeFileSync(pfad, readFileSync(pfad, "utf-8") + 'console.log("nachtraeglich");\n');

    const res = syncBlobs(dir, "--check");
    assert.equal(res.status, 1, "--check haette den Blob-Drift melden muessen");
    const meldung = res.stderr + res.stdout;
    assert.match(meldung, /Blob-Drift/, "die Meldung nennt den Blob-Drift nicht");
    assert.match(meldung, /SPEC_MJS_B64/, "die Meldung nennt die betroffene Konstante nicht");
    assert.doesNotMatch(meldung, /Versions-Stempel/, "Stempel-Drift faelschlich gemeldet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Dogfooding-Kopie unter .claude/kit/ (Issue #173) ---
//
// Das Kit betreibt eine eigene Kopie seiner Kit-Werkzeuge unter
// .claude/kit/ und liess sie bis #173 von Hand per cp auffrischen — ein Schritt,
// den man vergisst (bei Issue #167 waere er beinahe untergegangen). Mit den
// Versionsstempeln wuerde eine vergessene Kopie eine falsche Version behaupten.
//
// Besonderheit: .claude/ ist gitignored. sync-blobs schreibt hier also bewusst
// eine nicht versionierte Datei — deshalb auch der stille Skip, wenn es die
// lokale Installation gar nicht gibt (frischer Clone).

test("Lokale Kopie: sync-blobs frischt .claude/kit/ mit der gestempelten Fassung auf", () => {
  const dir = setupFixture("2.5.0", "1.0.0", { lokaleKopie: true });
  try {
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), "veralteter Inhalt\n");

    const res = syncBlobs(dir);
    assert.equal(res.status, 0, `sync-blobs schlug fehl: ${res.stderr}${res.stdout}`);

    for (const datei of KIT_DATEIEN) {
      assert.equal(
        readFileSync(join(dir, ".claude", "kit", datei), "utf-8"),
        readFileSync(join(dir, "kit", datei), "utf-8"),
        `.claude/kit/${datei} weicht nach dem Lauf noch von der Quelle ab`
      );
    }
    // Die Kopie traegt den frischen Stempel, nicht den alten.
    assert.match(readFileSync(join(dir, ".claude", "kit", "night.mjs"), "utf-8"),
      /const KIT_VERSION = "2\.5\.0";/, "die Kopie traegt nicht die gestempelte Fassung");
    assert.equal(syncBlobs(dir, "--check").status, 0, "--check haette danach gruen sein muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Lokale Kopie: --check meldet eine abweichende Kopie getrennt", () => {
  const dir = setupFixture("2.5.0", "1.0.0", { lokaleKopie: true });
  try {
    assert.equal(syncBlobs(dir).status, 0);
    writeFileSync(join(dir, ".claude", "kit", "night.mjs"), "von Hand verbogen\n");

    const res = syncBlobs(dir, "--check");
    assert.equal(res.status, 1, "--check haette die abweichende Kopie melden muessen");
    const meldung = res.stderr + res.stdout;
    assert.match(meldung, /\.claude\/kit\/night\.mjs/, "die Meldung nennt die Kopie nicht");
    // Stempel und Blob sind unberuehrt — die Meldung darf sie nicht mitbeschuldigen.
    assert.doesNotMatch(meldung, /Versions-Stempel/, "Stempel-Drift faelschlich gemeldet");
    assert.doesNotMatch(meldung, /Blob-Drift/, "Blob-Drift faelschlich gemeldet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Lokale Kopie: ohne .claude/kit/ laeuft sync-blobs durch und legt nichts an", () => {
  // Frischer Clone ohne lokale Installation: .claude/kit/ ist Laufzeitzustand,
  // kein Repo-Inhalt — es anzulegen waere ein Uebergriff.
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    const res = syncBlobs(dir);
    assert.equal(res.status, 0, `sync-blobs schlug fehl: ${res.stderr}${res.stdout}`);
    assert.equal(existsSync(join(dir, ".claude")), false,
      "sync-blobs haette .claude/ nicht anlegen duerfen");
    assert.equal(syncBlobs(dir, "--check").status, 0, "--check haette gruen sein muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
