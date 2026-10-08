// `checks.mjs run --in <pfad>` (Issue #1372): Der Lauf misst im genannten Verzeichnis,
// nicht im Arbeitsverzeichnis des Prozesses.
//
// Grund: Die Release-Skills pruefen in einem Worktree unter dem Temp-Verzeichnis. Claude
// Code setzt das Arbeitsverzeichnis dorthin nach jedem Aufruf zurueck, und `cd <pfad> &&
// node .claude/kit/checks.mjs …` faellt nicht mehr unter `sandbox.excludedCommands` — der
// Prueflauf liefe in der Sandbox. Mit `--in` steht der Aufruf allein.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { mitRepo, checks, zusammenfassung, git, datei } from "./helpers/checks-repo.mjs";

const config = {
  buildChecks: [{ cmd: "echo x > lief.txt", always: true }],
  checkAreas: { kern: ["src/**"] },
};

test("run --in misst im angegebenen Verzeichnis: Zusammenfassung, basis und Kommando stammen aus dem Fixture", async () => {
  await mitRepo({ config }, async (prozessCwd) => {
    await mitRepo({ config }, async (fixture) => {
      // Ein eigener Commit, damit sich die beiden HEADs sicher unterscheiden.
      git(fixture, "commit", "-q", "--allow-empty", "-m", "fixture");
      const kopfFixture = git(fixture, "rev-parse", "HEAD");
      assert.notEqual(kopfFixture, git(prozessCwd, "rev-parse", "HEAD"));
      // Nur im Fixture gibt es etwas zu pruefen: Ein Lauf im Prozess-cwd waere ein leeres Paket.
      datei(fixture, "src/a.txt");

      const res = await checks(prozessCwd, "run", "--in", fixture);

      assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stderr}`);
      assert.ok(existsSync(join(fixture, "lief.txt")), "das Kommando lief nicht im Fixture");
      assert.ok(!existsSync(join(prozessCwd, "lief.txt")), "das Kommando lief im Prozess-cwd");
      assert.ok(!existsSync(join(prozessCwd, ".claude", "checks-summary.json")),
        "die Zusammenfassung liegt im Prozess-cwd statt im Fixture");
      // `basis` ist der Kurzhash des Ankers — der des Fixtures.
      const { basis } = zusammenfassung(fixture);
      assert.ok(basis.length >= 7 && kopfFixture.startsWith(basis), `basis ${basis} stammt nicht aus dem Fixture`);
    });
  });
});

test("run --in mit relativem Pfad loest gegen das Arbeitsverzeichnis auf", async () => {
  await mitRepo({ config }, async (prozessCwd) => {
    await mitRepo({ config }, async (fixture) => {
      const res = await checks(prozessCwd, "run", "--in", relative(prozessCwd, fixture));

      assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stderr}`);
      assert.ok(existsSync(join(fixture, ".claude", "checks-summary.json")));
    });
  });
});

test("run --in ohne gueltiges Verzeichnis bricht mit Fehler ab", async () => {
  await mitRepo({ config }, async (prozessCwd) => {
    const fehlt = await checks(prozessCwd, "run", "--in", join(prozessCwd, "gibt-es-nicht"));
    assert.equal(fehlt.status, 1);
    assert.match(fehlt.stderr, /--in/);

    const leer = await checks(prozessCwd, "run", "--in");
    assert.equal(leer.status, 1);
    assert.match(leer.stderr, /--in/);
    assert.ok(!existsSync(join(prozessCwd, "lief.txt")), "nach dem Fehler lief trotzdem ein Kommando");
  });
});
