// Die Szenarien zu `areas suggest` (Issue #1718, Plan #1713, fachliche Quelle #1706).
//
// Je Szenario ein Test mit dem Titel im Namen. Jeder laeuft an einem Wegwerf-Projekt und ruft
// `checks.mjs areas suggest` im selben Prozess, wie es der Anwender auf der Kommandozeile tut:
// Kommandozeile lesen, messen, vorschlagen. Die Config muss danach byte-gleich sein, denn der
// Vorschlag aendert die Einstellungen nie von selbst (Kriterium 2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mitRepo, checks, datei } from "./helpers/checks-repo.mjs";

const CONFIG = join(".claude", "workflow.config.json");

/** `areas suggest` als Text und als JSON; beide muessen mit Exit 0 enden. */
async function vorschlagen(dir) {
  const text = await checks(dir, "areas", "suggest");
  assert.equal(text.status, 0, `areas suggest schlug fehl: ${text.stderr}`);
  const json = await checks(dir, "areas", "suggest", "--json");
  assert.equal(json.status, 0, `areas suggest --json schlug fehl: ${json.stderr}`);
  return { text: text.stdout, vorschlag: JSON.parse(json.stdout) };
}

/** Die Config als Bytes, zum Vergleich vor und nach dem Lauf. */
const configBytes = (dir) => readFileSync(join(dir, CONFIG));

const bereichMit = (vorschlag, pfad) => vorschlag.bereiche.find((b) => b.dateien.includes(pfad));

test("Szenario: Bereiche für ein neues Projekt vorschlagen lassen", async () => {
  const config = { buildChecks: [{ cmd: "node --test test/a.test.mjs" }, "node --test test/b.test.mjs"] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/a/eins.mjs", "export const eins = 1;\n");
    datei(dir, "src/b/zwei.mjs", "export const zwei = 2;\n");
    datei(dir, "test/a.test.mjs", 'import { eins } from "../src/a/eins.mjs";\nconsole.log(eins);\n');
    datei(dir, "test/b.test.mjs", 'import { zwei } from "../src/b/zwei.mjs";\nconsole.log(zwei);\n');
    const vorher = configBytes(dir);

    const { text, vorschlag } = await vorschlagen(dir);

    assert.equal(vorschlag.gruppenArt, "kommandos");
    const a = bereichMit(vorschlag, "src/a/eins.mjs");
    const b = bereichMit(vorschlag, "src/b/zwei.mjs");
    assert.ok(a && b && a.name !== b.name, JSON.stringify(vorschlag.bereiche));
    assert.deepEqual(a.tests, ["test/a.test.mjs"]);
    assert.deepEqual(b.tests, ["test/b.test.mjs"]);
    assert.deepEqual(vorschlag.kommandos.map((k) => k.areas), [[a.name], [b.name]]);
    for (const zeile of [`- ${a.name}: `, "    Tests: test/a.test.mjs", "src/a/eins.mjs", `node --test test/a.test.mjs → areas ${a.name}`]) {
      assert.ok(text.includes(zeile), `fehlt im Text: ${zeile}\n${text}`);
    }
    assert.deepEqual(configBytes(dir), vorher, "die Config ist nach dem Vorschlag unveraendert");
  });
});

test("Szenario: Projekt in einer nicht unterstützten Sprache", async () => {
  const config = { buildChecks: [{ cmd: "pytest" }] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "app/rechner.py", "def plus(a, b):\n    return a + b\n");
    datei(dir, "tests/test_rechner.py", "from app.rechner import plus\n\ndef test_plus():\n    assert plus(1, 2) == 3\n");

    const { text, vorschlag } = await vorschlagen(dir);

    const [kommando] = vorschlag.kommandos;
    assert.equal(kommando.urteil, "nichtBeurteilbar");
    assert.match(kommando.grund, /pytest/);
    assert.deepEqual(kommando.areas, [], "keine Einschraenkung vorgeschlagen");
    assert.match(text, /- pytest: nicht beurteilbar \([^)]*pytest[^)]*\)/);
  });
});

test("Szenario: Java-Projekt mit TypeScript-Frontend", async () => {
  const config = { buildChecks: [{ cmd: "mvn -B verify" }, { cmd: "npm --prefix frontend test" }] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "pom.xml", "<project><modelVersion>4.0.0</modelVersion></project>\n");
    datei(dir, "src/main/java/de/bank/Konto.java", "package de.bank;\npublic class Konto {}\n");
    datei(dir, "src/test/java/de/bank/KontoTest.java", [
      "package de.bank;",
      "import de.bank.Konto;",
      "class KontoTest { Konto konto = new Konto(); }",
      "",
    ].join("\n"));
    datei(dir, "frontend/package.json", JSON.stringify({ name: "frontend", scripts: { test: "vitest run" } }, null, 2) + "\n");
    datei(dir, "frontend/src/rechner.ts", "export const plus = (a: number, b: number) => a + b;\n");
    datei(dir, "frontend/src/rechner.test.ts", 'import { plus } from "./rechner";\nconsole.log(plus(1, 2));\n');

    const { text, vorschlag } = await vorschlagen(dir);

    assert.deepEqual(vorschlag.kommandos.map((k) => k.urteil), ["beurteilbar", "beurteilbar"], JSON.stringify(vorschlag.kommandos));
    const java = bereichMit(vorschlag, "src/main/java/de/bank/Konto.java");
    const ts = bereichMit(vorschlag, "frontend/src/rechner.ts");
    assert.ok(java && ts && java.name !== ts.name, JSON.stringify(vorschlag.bereiche));
    assert.deepEqual(java.tests, ["src/test/java/de/bank/KontoTest.java"]);
    assert.deepEqual(ts.tests, ["frontend/src/rechner.test.ts"]);
    assert.deepEqual(vorschlag.kommandos.map((k) => k.areas), [[java.name], [ts.name]]);
    assert.ok(text.includes("    Tests: src/test/java/de/bank/KontoTest.java"), text);
    assert.ok(text.includes("    Tests: frontend/src/rechner.test.ts"), text);
  });
});

test("Szenario: Ein großes Prüfkommando prüft getrennte Teile", async () => {
  const config = { buildChecks: [{ cmd: "node --test" }] };
  await mitRepo({ config }, async (dir) => {
    for (const teil of ["konto", "kunde"]) {
      datei(dir, `src/${teil}/kern.mjs`, "export const kern = 1;\n");
      for (const n of [1, 2]) {
        datei(dir, `test/${teil}-${n}.test.mjs`, `import { kern } from "../src/${teil}/kern.mjs";\nconsole.log(kern);\n`);
      }
    }

    const { text, vorschlag } = await vorschlagen(dir);

    assert.equal(vorschlag.teilbareKommandos.length, 1, JSON.stringify(vorschlag.teilbareKommandos));
    assert.deepEqual(vorschlag.teilbareKommandos[0].teile.map((teil) => teil.tests), [
      ["test/konto-1.test.mjs", "test/konto-2.test.mjs"],
      ["test/kunde-1.test.mjs", "test/kunde-2.test.mjs"],
    ]);
    assert.ok(text.includes("Teilbare Pruefkommandos (ohne Kommandozeile):"), text);
    assert.ok(text.includes("    Teil 1: Tests test/konto-1.test.mjs, test/konto-2.test.mjs"), text);
    assert.ok(text.includes("    Teil 2: Tests test/kunde-1.test.mjs, test/kunde-2.test.mjs"), text);
    // Genannt wird das Kommando selbst; eine Kommandozeile fuer einen Teil schreibt der Vorschlag nicht.
    assert.doesNotMatch(text, /node --test test\//);
  });
});

test("Szenario: Eine nur erwähnte Datei koppelt alle Bereiche", async () => {
  const config = { buildChecks: [{ cmd: "node --test" }] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "vorlagen/projekt.json", "{}\n");
    const tests = [];
    for (const name of ["a", "b", "c", "d"]) {
      datei(dir, `src/${name}.mjs`, "export const x = 1;\n");
      const testdatei = `test/${name}.test.mjs`;
      datei(dir, testdatei, `import { x } from "../src/${name}.mjs";\nconst vorlage = "vorlagen/projekt.json";\nconsole.log(x, vorlage);\n`);
      tests.push(testdatei);
    }
    const vorher = configBytes(dir);

    const { text, vorschlag } = await vorschlagen(dir);

    assert.deepEqual(vorschlag.geruestKandidaten, [{ pfad: "vorlagen/projekt.json", tests }]);
    assert.ok(text.includes(`- vorlagen/projekt.json, genannt von 4 Tests: ${tests.join(", ")}`), text);
    assert.deepEqual(configBytes(dir), vorher, "die Config ist nach dem Vorschlag unveraendert");
  });
});
