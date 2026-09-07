// Die letzten offenen Zweige der tools/-Scripts (Issue #505).
//
// Vier Dateien standen dicht unter 100 %, jede mit ein bis zwei Bedingungen, die
// keine der bestehenden Suiten je betreten hat. Es sind durchweg Rueckfaelle fuer
// den Fall, dass die Umgebung nicht mitspielt: ein git, das gar nicht startet; ein
// argv[1], das sich nicht aufloesen laesst; ein Zielverzeichnis ohne Schreibrecht;
// ein Fehler, der kein erwarteter Nutzerfehler ist.
//
// Genau diese Zweige laufen im Ernstfall — und nur dort. Bleiben sie ungetestet,
// faellt ein Fehler in ihnen erst dann auf, wenn ohnehin schon etwas kaputt ist.
//
// Wie in tools-cli.test.mjs laufen die ECHTEN Scripts aus dem Repo; Fixtures
// bekommen sie ueber cwd und KIT_ROOT (Issue #186/#189). Eine Kopie im
// Temp-Verzeichnis erzeugte Coverage unter einem Pfad, den SonarCloud nicht auf die
// Repo-Datei abbilden kann.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { setupProjekt, fakeCli } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG_TOOL = join(repoRoot, "tools", "changelog.mjs");
const COPY_TOOL = join(repoRoot, "tools", "copy-downloads-for-docs.mjs");
const REPORT_TOOL = join(repoRoot, "tools", "derived-from-report.mjs");
const MIGRATE_TOOL = join(repoRoot, "tools", "migrate-issues.mjs");

// Das Fake-gh ist eine endungslose Datei mit sh-Wrapper — startbar sind unter
// Windows nur .cmd/.bat/.exe (Issue #197, #231). chmod-Rechte wirken dort ebenfalls
// nicht, weshalb derselbe Vermerk fuer den Schreibrecht-Test gilt.
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: kein startbares Fake-Binary ohne Endung, und chmod ohne Wirkung. Siehe Issue #197 und #231." }
  : {};

function tempDir(praefix) {
  return mkdtempSync(join(tmpdir(), praefix));
}

/**
 * Laedt `modul` in einem Prozess, dessen argv[1] es nicht mehr gibt.
 *
 * Der Loader loescht sich selbst, nachdem Node ihn gelesen hat — danach zeigt
 * argv[1] ins Leere und realpathSync scheitert. Muster aus
 * test/checks-luecken.test.mjs (Issue #504).
 */
function ladeOhneArgv1(praefix, modul) {
  const dir = tempDir(praefix);
  try {
    const loader = join(dir, "loader.mjs");
    writeFileSync(loader, [
      "// Generiert von test/tools-offene-zweige.test.mjs (Issue #505) — kein Produktivcode.",
      String.raw`import { rmSync } from "node:fs";`,
      String.raw`import { pathToFileURL } from "node:url";`,
      "rmSync(process.argv[1]);",
      "await import(pathToFileURL(process.argv[2]).href);",
      String.raw`process.stdout.write("geladen\n");`,
      "",
    ].join("\n"), "utf-8");

    return spawnSync(process.execPath, [loader, modul], { cwd: dir, encoding: "utf-8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// tools/changelog.mjs
// ============================================================

test("changelog.mjs: ein git, das gar nicht startet, wird ohne 'null' im Text gemeldet", () => {
  // Bisher war nur der Fall geprueft, in dem git laeuft und mit einer Meldung auf
  // stderr scheitert. Startet es gar nicht — kein git im PATH —, liefert spawnSync
  // status null und stderr null. Ohne den Rueckfall auf "" stuende dann
  // "schlug fehl: null" da, und der Leser suchte einen git-Fehler namens null.
  const dir = tempDir("changelog-kein-git-");
  try {
    writeFileSync(join(dir, "install.mjs"), 'const VERSION = "1.17.0";\n', "utf-8");
    const res = spawnSync(process.execPath, [CHANGELOG_TOOL], {
      cwd: dir, encoding: "utf-8", env: { ...process.env, PATH: join(dir, "leer") },
    });

    assert.equal(res.status, 1, "ein nicht startbares git muss abbrechen");
    assert.match(res.stderr, /git log .* schlug fehl:/);
    assert.doesNotMatch(res.stderr, /null/, "ohne stderr darf kein 'null' in der Meldung stehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changelog.mjs: ein unaufloesbares argv[1] laedt das Modul, ohne zu schreiben", () => {
  // Der CLI-Guard vergleicht realpath(argv[1]) mit dem eigenen Modulpfad. Loest sich
  // argv[1] nicht auf, darf er nicht werfen — sonst steckte jeder Import in einem
  // Ladefehler. Und starten darf er erst recht nicht: changelog.mjs schriebe dann
  // ungefragt eine CHANGELOG.md ins Arbeitsverzeichnis des Aufrufers.
  const res = ladeOhneArgv1("changelog-argv-", CHANGELOG_TOOL);

  assert.equal(res.status, 0, `der Import scheiterte: ${res.stderr}`);
  assert.match(res.stdout, /geladen/);
  assert.doesNotMatch(res.stdout, /CHANGELOG\.md geschrieben/, "das Modul hat als CLI gestartet statt nur zu laden");
});

// ============================================================
// tools/copy-downloads-for-docs.mjs
// ============================================================

test("copy-downloads: ohne KIT_ROOT gilt das Repo, aus dem das Script stammt", () => {
  // Der Regelpfad — jeder andere Test umgeht ihn ueber den Hook KIT_ROOT. Als
  // predev/prebuild-Hook laeuft das Script genau so: ohne Hook, gegen das eigene
  // Repo. Waere der Ortsbezug dort falsch, faende docs-site seine Downloads nicht.
  //
  // Die beiden geschriebenen Dateien unter docs/public/ sind Generate und stehen in
  // .gitignore (Vorbild: test/sync-blobs-skills.test.mjs) — der Working Tree bleibt
  // sauber.
  const env = { ...process.env };
  delete env.KIT_ROOT;
  const res = spawnSync(process.execPath, [COPY_TOOL], { cwd: tmpdir(), encoding: "utf-8", env });

  assert.equal(res.status, 0, `Script schlug fehl: ${res.stderr}${res.stdout}`);
  // cwd zeigt bewusst woandershin: Der Ort ergibt sich aus dem Modulpfad, nicht aus
  // dem Arbeitsverzeichnis.
  for (const [quelle, ziel] of [
    [["install.mjs"], ["docs", "public", "install.mjs"]],
    [["kit", "board-ui.mjs"], ["docs", "public", "board-ui.mjs"]],
  ]) {
    assert.ok(
      readFileSync(join(repoRoot, ...quelle)).equals(readFileSync(join(repoRoot, ...ziel))),
      `${ziel.join("/")} weicht von der Quelle ab`
    );
  }
});

// ============================================================
// tools/derived-from-report.mjs
// ============================================================

test("derived-from-report: ein unerwarteter Fehler wird nicht als Nutzerfehler verkleidet", () => {
  // Ein JSON-Array aus Nicht-Karten ist syntaktisch gueltig; erst das Lesen faellt
  // darueber. Dieser Fehler ist KEIN ReportError, und genau deshalb muss er
  // durchschlagen: Eine ruhige "Fehler: ..."-Zeile liesse einen Programmfehler wie
  // einen Tippfehler in der Pipe aussehen.
  const res = spawnSync(process.execPath, [REPORT_TOOL], {
    input: "[null]", encoding: "utf-8", cwd: repoRoot,
  });

  assert.notEqual(res.status, 0, "ein unerwarteter Fehler darf nicht mit Exit 0 enden");
  assert.match(res.stderr, /TypeError/, "der Fehlertyp muss sichtbar bleiben");
  assert.match(res.stderr, /\n\s+at /, "ein unerwarteter Fehler behaelt seinen Stacktrace");
  assert.doesNotMatch(res.stderr, /^Fehler: /m, "er darf nicht als gemeldeter Nutzerfehler erscheinen");
});

test("derived-from-report: ein unaufloesbares argv[1] laedt das Modul, ohne die CLI zu starten", () => {
  // Das Werkzeug wird auch importiert (bestandsPruefung in den Regressionstests).
  // Ein werfender Guard machte jeden dieser Importe unmoeglich; ein startender
  // haenge am fehlenden stdin.
  const res = ladeOhneArgv1("report-argv-", REPORT_TOOL);

  assert.equal(res.status, 0, `der Import scheiterte: ${res.stderr}`);
  assert.match(res.stdout, /geladen/);
  assert.doesNotMatch(res.stdout, /Karten: /, "das Modul hat als CLI gestartet statt nur zu laden");
});

// ============================================================
// tools/migrate-issues.mjs
// ============================================================

test("migrate-issues: ein unaufloesbares argv[1] laedt das Modul, ohne die CLI zu starten", () => {
  const res = ladeOhneArgv1("migrate-argv-", MIGRATE_TOOL);

  assert.equal(res.status, 0, `der Import scheiterte: ${res.stderr}`);
  assert.match(res.stdout, /geladen/);
  assert.doesNotMatch(res.stderr, /Nutzung:/, "das Modul hat als CLI gestartet statt nur zu laden");
});

const LEERES_PROJEKT = {
  data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } },
};

const KEINE_ISSUES = {
  data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } },
};

test("migrate-issues: ein gesperrtes Zielverzeichnis meldet Klartext statt Stacktrace", NUR_POSIX, () => {
  // schreibeAtomar schreibt erst eine Nachbardatei und benennt sie um. Scheitert das
  // Schreiben, raeumt es beide Pfade weg — und dieses Aufraeumen darf den eigentlichen
  // Fehler nicht ueberdecken, auch wenn es selbst scheitert. Genau das ist hier der
  // Fall: In einem Verzeichnis ohne jedes Recht scheitert schon das Nachsehen.
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, "migrate-out-gesperrt-");
  const out = join(dir, "raus");
  mkdirSync(out, { recursive: true });
  fakeCli(dir, "gh", [
    { match: "repo view", stdout: "mannewolff/claude-workflow-kit\n" },
    { match: "projectV2", stdout: LEERES_PROJEKT },
    { match: "states:OPEN", stdout: KEINE_ISSUES },
  ]);
  try {
    chmodSync(out, 0o000);
    const res = spawnSync(process.execPath, [MIGRATE_TOOL, "export", "--out", out], {
      cwd: dir, encoding: "utf-8",
      env: { ...process.env, PATH: `${join(dir, "fakebin")}:${process.env.PATH}` },
    });

    assert.equal(res.status, 1, "ein unbeschreibbares Ziel muss mit Exit 1 enden");
    assert.match(res.stderr, /Zieldatei konnte nicht geschrieben werden:/);
    assert.doesNotMatch(res.stderr, /\n\s+at /, "ein Umgebungsfehler braucht keinen Stacktrace");

    chmodSync(out, 0o700);
    assert.deepEqual(readdirSync(out), [],
      "weder Ziel- noch .tmp-Datei duerfen zurueckbleiben");
  } finally {
    chmodSync(out, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});
