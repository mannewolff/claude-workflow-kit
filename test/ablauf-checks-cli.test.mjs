// Ablauf-Pruefung: Ob checks.mjs als Einzeldatei von der Kommandozeile startet und beim Import kein CLI startet, sieht nur ein eigener Node-Prozess.
//
// Die Kommandozeile von kit/checks.mjs (Issue #423, #424, #504; seit Issue #1212 hier
// gesammelt). Alles andere an `plan` und `run` pruefen die Tests im selben Prozess, ueber
// `helpers/checks-repo.mjs`. Hier bleibt, was nur ein Prozess belegt: die Datei allein,
// ohne Repo-Kontext, und der Guard, der beim Import kein CLI startet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CHECKS } from "./helpers/checks-ablauf.mjs";

test("die Nutzungshilfe laeuft in einem leeren Verzeichnis ohne Config und ohne Repo", () => {
  // Das Kit liefert seine Werkzeuge als eigenstaendig portable Einzeldateien aus:
  // die Datei allein, ohne Repo-Kontext, muss antworten koennen.
  const dir = mkdtempSync(join(tmpdir(), "checks-nackt-"));
  try {
    const kopie = join(dir, "checks.mjs");
    copyFileSync(CHECKS, kopie);
    for (const cliArgs of [[], ["--help"], ["-h"]]) {
      const res = spawnSync(process.execPath, [kopie, ...cliArgs], { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `checks.mjs ${cliArgs.join(" ")} endete mit ${res.status}: ${res.stderr}`);
      assert.match(res.stdout, /plan/, "die Nutzungshilfe nennt das Unterkommando nicht");
      assert.match(res.stdout, /\brun\b/, "die Nutzungshilfe nennt das Unterkommando run nicht");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein unbekannter Befehl endet mit Exit 1 und 'Fehler:' auf stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "checks-nackt-"));
  try {
    const res = spawnSync(process.execPath, [CHECKS, "planx"], { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Fehler: Unbekannter Befehl: 'planx'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ist argv[1] nicht aufloesbar, laedt das Modul trotzdem und startet kein CLI", () => {
  // Der Guard rechnet mit dem Symlink-Fall (macOS: /var -> /private/var). Loest
  // sich argv[1] gar nicht auf, darf er nicht werfen: Das Modul steckte dann in
  // einem Ladefehler, und ein Import — etwa aus der Testsuite — kaeme nie an.
  const dir = mkdtempSync(join(tmpdir(), "checks-argv-"));
  try {
    const loader = join(dir, "loader.mjs");
    writeFileSync(loader, [
      "// Generiert von test/ablauf-checks-cli.test.mjs (Issue #504) — kein Produktivcode.",
      String.raw`import { rmSync } from "node:fs";`,
      String.raw`import { pathToFileURL } from "node:url";`,
      // Sich selbst loeschen: Das Modul ist gelesen, argv[1] zeigt danach ins
      // Leere — genau die Lage, die realpathSync scheitern laesst.
      "rmSync(process.argv[1]);",
      "await import(pathToFileURL(process.argv[2]).href);",
      String.raw`process.stdout.write("geladen\n");`,
      "",
    ].join("\n"), "utf-8");

    const res = spawnSync(process.execPath, [loader, CHECKS], { cwd: dir, encoding: "utf-8" });

    assert.equal(res.status, 0, `der Import scheiterte: ${res.stderr}`);
    assert.match(res.stdout, /geladen/);
    assert.doesNotMatch(res.stdout, /node checks\.mjs/, "das Modul hat als CLI gestartet statt nur zu laden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
