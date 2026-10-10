// Ablauf-Pruefung: die Schutzfragen des Installers und der Modus --schutz (Issue #1409, Plan #1405) — sichtbar nur am echten Installer mit gepipten Antworten.
//
// Der Installer schlaegt bei GitHub mit Build-Dienst vor, Haupt- und Veroeffentlichungszweig
// zu schuetzen (Kriterium 3), und `node install.mjs --schutz` schaltet den Schutz in einem
// bestehenden Projekt nachtraeglich ein (Kriterium 6). Die Einrichtung selbst macht
// `board.mjs code schutz einrichten`; hier steht statt ihrer eine Attrappe ueber den Test-Hook
// INSTALL_SCHUTZ_FAKE (E12, wie INSTALL_GLAB_FAKE) — kein Netz, kein echtes GitHub.
//
// cwd und HOME zeigen in ein Wegwerf-Verzeichnis, dieselbe Vorkehrung wie in
// ablauf-install-flow.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

const SCHUTZFRAGE = /Haupt- und Veröffentlichungszweig schützen/;
const BUILD_DIENST_FRAGE = /Hat das Projekt einen Build-Dienst \(GitHub Actions\)\? \[J\/n\]/;
const UNGESCHUETZT = /Haupt- und Veröffentlichungszweig bleiben ungeschützt/;

// realpathSync: Der Installer sieht cwd aufgeloest (macOS: /tmp -> /private/tmp).
function fixture(praefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

/**
 * Die Attrappe fuer `node <kitDir>/board.mjs code schutz einrichten`: schreibt ihre Argumente
 * ins Log und gibt das Ergebnis aus SCHUTZ_FAKE_ERGEBNIS als JSON aus, wie `code schutz` es tut.
 */
function schutzFake(dir, ergebnis) {
  const skript = join(dir, "schutz-fake.mjs");
  const log = join(dir, "schutz-fake.log");
  writeFileSync(skript, [
    'import { appendFileSync } from "node:fs";',
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    `console.log(JSON.stringify({ ergebnis: ${JSON.stringify(ergebnis)}, grund: "Attrappe" }, null, 2));`,
    "",
  ].join("\n"));
  return { env: { INSTALL_SCHUTZ_FAKE: skript }, log };
}

function aufrufe(log) {
  return existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").map((z) => JSON.parse(z)) : [];
}

function installiere(dir, antworten, extraEnv = {}, argv = []) {
  return spawnSync(process.execPath, [INSTALLER, ...argv], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), ...extraEnv },
  });
}

function config(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
}

// Projektlokal, GitHub, danach die Schutzfragen, dann der Rest mit Defaults.
const REST = ["github", "", "", "", "", "", "", ""];
const mitSchutz = (zweig) => ["projekt", "github", "j", "j", zweig, ...REST];

for (const [ergebnis, schreibt] of [["scharf", true], ["anleitung", true], ["offen", false], ["nicht moeglich", false]]) {
  test(`Zustimmung mit Ergebnis '${ergebnis}' ${schreibt ? "schreibt" : "schreibt kein"} pushPruefung`, () => {
    const dir = fixture("install-schutz-");
    try {
      const fake = schutzFake(dir, ergebnis);
      const res = installiere(dir, mitSchutz("mein-pruefzweig"), fake.env);
      assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
      assert.match(res.stdout, BUILD_DIENST_FRAGE);
      assert.match(res.stdout, SCHUTZFRAGE);

      const kitBoard = join(dir, ".claude", "kit", "board.mjs");
      assert.deepEqual(aufrufe(fake.log),
        [[kitBoard, "code", "schutz", "einrichten", "--zweig", "mein-pruefzweig"]]);
      // Die Ausgabe von `code schutz einrichten` geht woertlich weiter.
      assert.match(res.stdout, /"grund": "Attrappe"/);

      const c = config(dir);
      if (schreibt) assert.deepEqual(c.pushPruefung, { ort: "buildDienst", zweig: "mein-pruefzweig" });
      else assert.equal(c.pushPruefung, undefined);
      if (ergebnis === "nicht moeglich") assert.match(res.stdout, /node install\.mjs --schutz/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("Abwahl des Schutzes ruft code schutz nicht auf und laesst die Config ohne pushPruefung", () => {
  const dir = fixture("install-schutz-ab-");
  try {
    const fake = schutzFake(dir, "scharf");
    const res = installiere(dir, ["projekt", "github", "j", "n", ...REST], fake.env);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(aufrufe(fake.log), []);
    assert.equal(config(dir).pushPruefung, undefined);
    assert.equal(config(dir).issueTracker, "github", "die Antworten danach muessen ankommen");
    assert.match(res.stdout, UNGESCHUETZT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Nein beim Build-Dienst nennt die ungeschuetzten Zweige und stellt keine Schutzfrage", () => {
  const dir = fixture("install-schutz-ohne-ci-");
  try {
    const fake = schutzFake(dir, "scharf");
    const res = installiere(dir, ["projekt", "github", "n", ...REST], fake.env);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, UNGESCHUETZT);
    assert.doesNotMatch(res.stdout, SCHUTZFRAGE);
    assert.deepEqual(aufrufe(fake.log), []);
    assert.equal(config(dir).issueTracker, "github");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [codeHost, satz] of [["gitlab", /GitLab.*Schutz.*noch nicht eingerichtet/], ["local", /Schutz bleibt lokal/]]) {
  test(`codeHost '${codeHost}' nennt seinen Satz und stellt keine Schutzfrage`, () => {
    const dir = fixture(`install-schutz-${codeHost}-`);
    try {
      const fake = schutzFake(dir, "scharf");
      const res = installiere(dir, ["projekt", codeHost, "local", "", "", "", "", "", "", ""], fake.env);
      assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
      assert.match(res.stdout, satz);
      assert.doesNotMatch(res.stdout, BUILD_DIENST_FRAGE);
      assert.doesNotMatch(res.stdout, SCHUTZFRAGE);
      assert.deepEqual(aufrufe(fake.log), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("Globale Installation stellt keine Schutzfrage und nennt node install.mjs --schutz", () => {
  const dir = fixture("install-schutz-global-");
  try {
    const fake = schutzFake(dir, "scharf");
    const res = installiere(dir, ["global", "github", "github", "", "", "", "", "", ""], fake.env);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, BUILD_DIENST_FRAGE);
    assert.doesNotMatch(res.stdout, SCHUTZFRAGE);
    assert.match(res.stdout, /node install\.mjs --schutz/);
    assert.deepEqual(aufrufe(fake.log), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Modus --schutz (E2, E3) ---

const BESTAND = {
  codeHost: "github",
  issueTracker: "github",
  mainBranch: "main",
  productionBranch: "production",
  buildChecks: [{ name: "Tests", command: "npm test", required: true }],
  eigenesFeld: { bleibt: true },
};

/** Ein bestehendes Projekt: Config und eine installierte board.mjs mit oder ohne `code schutz`. */
function bestehendesProjekt(dir, { kenntSchutz = true, config: cfg = BESTAND } = {}) {
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(cfg, null, 2) + "\n");
  const board = kenntSchutz
    ? "// node board.mjs code schutz einrichten --zweig <z>\n"
    : "// node board.mjs code ci-status --commit <sha>\n";
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), board);
}

function dateienUnter(dir) {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

test("--schutz aendert in der Config nur pushPruefung und schreibt keine Kit-Datei", () => {
  const dir = fixture("install-schutz-modus-");
  try {
    bestehendesProjekt(dir);
    const vorher = config(dir);
    const dateienVorher = dateienUnter(join(dir, ".claude"));
    const boardVorher = readFileSync(join(dir, ".claude", "kit", "board.mjs"), "utf-8");
    const fake = schutzFake(dir, "scharf");

    const res = installiere(dir, ["j", "j", ""], fake.env, ["--schutz"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const nachher = config(dir);
    assert.deepEqual(nachher.pushPruefung, { ort: "buildDienst", zweig: "kit-pruefung" });
    delete nachher.pushPruefung;
    assert.deepEqual(nachher, vorher);
    assert.deepEqual(dateienUnter(join(dir, ".claude")), dateienVorher);
    assert.equal(readFileSync(join(dir, ".claude", "kit", "board.mjs"), "utf-8"), boardVorher);
    assert.ok(!existsSync(join(dir, ".gitignore")), "--schutz fasst die .gitignore nicht an");
    assert.deepEqual(aufrufe(fake.log),
      [[join(dir, ".claude", "kit", "board.mjs"), "code", "schutz", "einrichten", "--zweig", "kit-pruefung"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--schutz bietet den vorhandenen pushPruefung.zweig als Vorgabe an", () => {
  const dir = fixture("install-schutz-zweig-");
  try {
    bestehendesProjekt(dir, { config: { ...BESTAND, pushPruefung: { ort: "buildDienst", zweig: "alter-zweig" } } });
    const fake = schutzFake(dir, "offen");
    const res = installiere(dir, ["j", "j", ""], fake.env, ["--schutz"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /\[alter-zweig\]/);
    assert.equal(aufrufe(fake.log)[0].at(-1), "alter-zweig");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--schutz mit einer board.mjs ohne code schutz bricht mit dem Aktualisierungssatz ab", () => {
  const dir = fixture("install-schutz-alt-");
  try {
    bestehendesProjekt(dir, { kenntSchutz: false });
    const vorher = readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8");
    const fake = schutzFake(dir, "scharf");
    const res = installiere(dir, ["j", "j", ""], fake.env, ["--schutz"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /erst das Kit mit `node install\.mjs` aktualisieren/i);
    assert.doesNotMatch(res.stdout, BUILD_DIENST_FRAGE);
    assert.deepEqual(aufrufe(fake.log), []);
    assert.equal(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"), vorher);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
