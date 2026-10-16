// Ablauf-Pruefung: Der Installer meldet am Ende laut, wenn uncommittete Dateien im Workspace liegen (Issue #1749) — ob der Block die letzte Ausgabe ist, zeigt nur der echte Installer.
//
// Der Runner haelt bei uncommitteten Dateien an (`gitReste` in seinen Grundlagen). Der
// Installer haelt darum den Stand von `git status --porcelain` vor dem ersten Schreiben fest und
// gibt als allerletzte Ausgabe einen abgesetzten Block aus, getrennt in "vom Installer geaendert"
// und "lag schon vorher". Ohne git-Repo entfaellt die Pruefung still; der Exit-Code bleibt 0.
//
// cwd und HOME zeigen in ein Wegwerf-Verzeichnis, dieselbe Vorkehrung wie in
// ablauf-install-flow.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { workspaceBlock } from "../install.mjs";

const INSTALLER = join(dirname(fileURLToPath(import.meta.url)), "..", "install.mjs");
const KOPF_DE = "ACHTUNG: Es liegen uncommittete Dateien im Workspace";
const KOPF_EN = "WARNING: There are uncommitted files in the workspace";

// Bestehendes Projekt (keine Sprachfrage): projektlokal, GitHub, Build-Dienst ja, Schutz nein,
// danach die Defaults; die Hook-Frage im Git-Repo bekommt "n".
const ANTWORTEN = ["projekt", "github", "j", "n", "github", "", "", "", "", "", "n", ""];

function fixture(praefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}

function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

/** Ein git-Repo mit committeter Config; `home/` liegt ausserhalb des Blicks von git. */
function repo(praefix, config = { codeHost: "github", issueTracker: "github", language: "de" }) {
  const dir = fixture(praefix);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n");
  writeFileSync(join(dir, ".gitignore"), "home/\n");
  git(dir, "init", "-q");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "start");
  return dir;
}

function szenarienFake(dir) {
  const skript = join(dir, "home", "szenarien-fake.mjs");
  writeFileSync(skript, `console.log(JSON.stringify({ ab: 1 }));\n`);
  return skript;
}

function installiere(dir) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: ANTWORTEN.join("\n") + "\n",
    encoding: "utf-8",
    env: {
      ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
      INSTALL_SZENARIEN_FAKE: szenarienFake(dir),
    },
  });
}

/** Committet alles, was der erste Lauf hinterliess — danach ist das Repo sauber. */
function allesCommitten(dir) {
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "installiert", "--allow-empty");
}

/** Die Ausgabe ab dem Block; der Block endet mit der Linie und Leerzeilen. */
function block(stdout, kopf) {
  const ab = stdout.lastIndexOf(kopf);
  return ab < 0 ? null : stdout.slice(ab);
}

test("(a) sauberes Repo, der Installer aendert nichts Versioniertes: kein Block", () => {
  const dir = repo("ws-sauber-");
  try {
    assert.equal(installiere(dir).status, 0);
    allesCommitten(dir);
    const res = installiere(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(git(dir, "status", "--porcelain"), "", "der zweite Lauf aendert nichts");
    assert.ok(!res.stdout.includes(KOPF_DE), res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(b) der Installer aendert eine versionierte Datei: Block unter 'vom Installer geaendert', als letzte Ausgabe", () => {
  const dir = repo("ws-geaendert-");
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const b = block(res.stdout, KOPF_DE);
    assert.ok(b, res.stdout);
    const installer = b.slice(b.indexOf("Vom Installer geändert:"), b.indexOf("Lag schon vorher:") >= 0 ? b.indexOf("Lag schon vorher:") : undefined);
    assert.match(installer, /\.claude\/workflow\.config\.json/);
    assert.match(b, /Der Runner hält bei uncommitteten Dateien an/);
    // Letzte Ausgabe: nach der Schlusslinie des Blocks folgt nur noch Leerraum.
    const linie = b.trimEnd().split("\n").at(-1);
    assert.match(linie, /^=+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(c) eine vorher geaenderte Datei steht unter 'lag schon vorher'", () => {
  const dir = repo("ws-vorher-");
  try {
    assert.equal(installiere(dir).status, 0);
    allesCommitten(dir);
    writeFileSync(join(dir, "notiz.txt"), "eigene Arbeit\n");
    const res = installiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const b = block(res.stdout, KOPF_DE);
    assert.ok(b, res.stdout);
    const vorher = b.slice(b.indexOf("Lag schon vorher:"));
    assert.match(vorher, /notiz\.txt/);
    assert.ok(!b.includes("Vom Installer geändert:"), b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(d) kein git-Repo: kein Block, kein Fehler", () => {
  const dir = fixture("ws-ohne-git-");
  try {
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({ codeHost: "github", language: "de" }) + "\n");
    const res = installiere(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!res.stdout.includes(KOPF_DE), res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(e) englische Projektsprache: englischer Block", () => {
  const dir = repo("ws-englisch-", { codeHost: "github", issueTracker: "github", language: "en" });
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const b = block(res.stdout, KOPF_EN);
    assert.ok(b, res.stdout);
    assert.match(b, /Changed by the installer:/);
    assert.ok(!res.stdout.includes(KOPF_DE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspaceBlock trennt beide Staende und baut bei leerem Stand keinen Block", () => {
  assert.equal(workspaceBlock(null, null), null, "ohne git keine Pruefung");
  assert.equal(workspaceBlock([], []), null, "sauber: kein Block");
  const b = workspaceBlock(["?? alt.txt"], ["?? alt.txt", " M .claude/workflow.config.json"]);
  assert.ok(b.includes(KOPF_DE));
  assert.ok(b.indexOf("Vom Installer geändert:") < b.indexOf(" M .claude/workflow.config.json"));
  assert.ok(b.indexOf("Lag schon vorher:") < b.indexOf("?? alt.txt"));
  assert.ok(!b.includes("\x1b["), "ohne Terminal keine Farbe");
  assert.ok(workspaceBlock([], ["?? x"], true).includes("\x1b["), "im Terminal mit Farbe");
});
