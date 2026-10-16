// Das Kit liest aus einem Pruefkommando, welche Testdateien es faehrt, oder nennt es nicht
// beurteilbar (Issue #1716, Plan #1713 A5, A6, E8).
//
// Vorschlag und Abgleich ordnen die Messung je Test einem Kommando zu. Welche Tests ein
// Kommando faehrt, steht nicht in einer eigenen Einstellung (E8), sondern in seiner
// Kommandozeile und den Vorgaben seines Laeufers. Geprueft wird an Wegwerf-Projekten: Eine
// geratene Testmenge waere eine stille Entwarnung, darum heisst jede eigene Testauswahl eines
// Laeufers „nicht beurteilbar" (Kriterium 8), und ein Kommando ohne erkannte Tests „nicht aus
// der Auswertung abgeleitet" (Kriterium 9).

import { test } from "node:test";
import assert from "node:assert/strict";

import { testsVon, URTEIL } from "../kit/checks/testauswahl.mjs";
import { mitRepo, datei } from "./helpers/checks-repo.mjs";

/** Das Ergebnis fuer `kommando` im Wegwerf-Projekt `dir`. */
function auswahl(dir, kommando) {
  return testsVon(kommando, { repoRoot: dir });
}

/** Legt die Dateien aus `dateien` (Pfad → Inhalt) im Wegwerf-Projekt an. */
function anlegen(dir, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) datei(dir, pfad, inhalt);
}

const pkg = (scripts, mehr = {}) => JSON.stringify({ name: "frontend", scripts, ...mehr }, null, 2);

const pom = (plugins = "") => [
  "<project>",
  "  <modelVersion>4.0.0</modelVersion>",
  "  <artifactId>app</artifactId>",
  "  <build><plugins>",
  plugins,
  "  </plugins></build>",
  "</project>",
  "",
].join("\n");

const FAILSAFE = "    <plugin><artifactId>maven-failsafe-plugin</artifactId></plugin>";

// --- Die Kommandos von kanban-kit ---

test("[1716] kanban-kit: mvn … -Dit.test=OpenApiIT verify faehrt die Unit-Tests und genau diesen IT", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "backend/pom.xml": pom(FAILSAFE),
      "backend/src/main/java/de/kk/Board.java": "class Board {}\n",
      "backend/src/test/java/de/kk/BoardTest.java": "class BoardTest {}\n",
      "backend/src/test/java/de/kk/OpenApiIT.java": "class OpenApiIT {}\n",
      "backend/src/test/java/de/kk/DatenbankIT.java": "class DatenbankIT {}\n",
      "backend/src/test/java/de/kk/Hilfe.java": "class Hilfe {}\n",
    });

    const ergebnis = auswahl(dir, { cmd: "mvn -B -q -f backend/pom.xml -Dit.test=OpenApiIT verify", areas: ["backend"] });

    assert.equal(ergebnis.urteil, URTEIL.beurteilbar);
    assert.equal(ergebnis.ort, "backend");
    assert.deepEqual(ergebnis.tests, [
      "backend/src/test/java/de/kk/BoardTest.java",
      "backend/src/test/java/de/kk/OpenApiIT.java",
    ]);
  });
});

test("[1716] kanban-kit: npm --prefix frontend run test:coverage loest das Skript auf und faehrt Vitest mit Vorgabesuche", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "frontend/package.json": pkg({ "test:coverage": "vitest run --coverage" }),
      "frontend/vitest.config.ts": [
        "export default {",
        "  test: {",
        "    environment: 'jsdom',",
        "    coverage: { include: ['src/**'], reporter: ['text'] },",
        "  },",
        "};",
        "",
      ].join("\n"),
      "frontend/src/board.ts": "export const b = 1;\n",
      "frontend/src/board.test.ts": "import { b } from './board';\n",
      "frontend/src/karte.spec.tsx": "export {};\n",
      "frontend/node_modules/x/y.test.js": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "npm --prefix frontend run test:coverage", areas: ["frontend"] });

    assert.equal(ergebnis.urteil, URTEIL.beurteilbar);
    assert.equal(ergebnis.ort, "frontend");
    assert.deepEqual(ergebnis.tests, ["frontend/src/board.test.ts", "frontend/src/karte.spec.tsx"]);
  });
});

test("[1716] kanban-kit: node --test scripts/*.test.mjs faehrt genau die Treffer des Globs", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "scripts/a.test.mjs": "export {};\n",
      "scripts/b.test.mjs": "export {};\n",
      "scripts/unter/c.test.mjs": "export {};\n",
      "scripts/hilfe.mjs": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "node --test scripts/*.test.mjs", areas: ["skripte"] });

    assert.equal(ergebnis.urteil, URTEIL.beurteilbar);
    assert.equal(ergebnis.ort, ".");
    assert.deepEqual(ergebnis.tests, ["scripts/a.test.mjs", "scripts/b.test.mjs"]);
  });
});

// --- Segmente und Ort ---

test("[1716] Segmente an && und ;: cd wirkt als Ort fuer die folgenden Segmente, Linter-Segmente zaehlen nicht", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "app/test/a.test.mjs": "export {};\n",
      "test/wurzel.test.mjs": "export {};\n",
      "werkzeug/b.test.mjs": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "npx eslint . && cd app && node --test test/a.test.mjs ; node --test ../werkzeug/b.test.mjs", areas: ["app"] });

    assert.equal(ergebnis.urteil, URTEIL.beurteilbar);
    assert.equal(ergebnis.ort, "app");
    assert.deepEqual(ergebnis.tests, ["app/test/a.test.mjs", "werkzeug/b.test.mjs"]);
  });
});

test("[1716] npm test und npm run <skript> loesen die package.json eine Stufe weit auf, Argumente hinter -- gehen mit", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "package.json": pkg({ test: "node --test test/a.test.mjs", "test:b": "node --test" }),
      "test/a.test.mjs": "export {};\n",
      "test/b.test.mjs": "export {};\n",
    });

    assert.deepEqual(auswahl(dir, { cmd: "npm test", areas: ["x"] }).tests, ["test/a.test.mjs"]);
    assert.deepEqual(auswahl(dir, { cmd: "npm run test:b -- test/b.test.mjs", areas: ["x"] }).tests, ["test/b.test.mjs"]);
  });
});

test("[1716] npm: ein Skript, das selbst npm run aufruft, wird nicht weiter verfolgt und ist nicht beurteilbar", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "package.json": pkg({ test: "npm run unit", unit: "node --test" }),
      "test/a.test.mjs": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "npm test", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /npm run unit/);
    assert.deepEqual(ergebnis.tests, []);
  });
});

test("[1716] npm: ein fehlendes Skript ist nicht beurteilbar und nennt die package.json", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, { "frontend/package.json": pkg({ lint: "eslint ." }) });

    const ergebnis = auswahl(dir, { cmd: "npm --prefix frontend test", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /frontend\/package\.json/);
  });
});

test("[1716] Ort ausserhalb des Repos ist nicht beurteilbar", () => {
  mitRepo({}, (dir) => {
    const ergebnis = auswahl(dir, { cmd: "cd .. && node --test", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /\.\./);
  });
});

// --- node --test ---

test("[1716] node --test mit Pfaden faehrt genau diese Dateien, ein Ordner seine Vorgabesuche", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "test/a.test.mjs": "export {};\n",
      "test/b.test.mjs": "export {};\n",
      "werkzeug/c.test.mjs": "export {};\n",
      "werkzeug/hilfe.mjs": "export {};\n",
    });

    assert.deepEqual(
      auswahl(dir, { cmd: "node --test --test-reporter=dot test/a.test.mjs", areas: ["x"] }).tests,
      ["test/a.test.mjs"],
    );
    assert.deepEqual(auswahl(dir, { cmd: "node --test werkzeug", areas: ["x"] }).tests, ["werkzeug/c.test.mjs"]);
  });
});

test("[1716] node --test ohne Argument: die Vorgabesuche von Node, ohne node_modules", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "src/a.test.mjs": "export {};\n",
      "src/b-test.js": "export {};\n",
      "src/c_test.cjs": "export {};\n",
      "src/test-d.mjs": "export {};\n",
      "test/hilfe.mjs": "export {};\n",
      "src/quelle.mjs": "export {};\n",
      "src/e.test.ts": "export {};\n",
      "node_modules/p/x.test.js": "export {};\n",
    });

    assert.deepEqual(auswahl(dir, { cmd: "node --test", areas: ["x"] }).tests, [
      "src/a.test.mjs", "src/b-test.js", "src/c_test.cjs", "src/test-d.mjs", "test/hilfe.mjs",
    ]);
  });
});

test("[1716] node ohne --test faehrt keine Tests", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, { "tools/pruefe.mjs": "export {};\n" });

    const ergebnis = auswahl(dir, { cmd: "node tools/pruefe.mjs --check", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtAbgeleitet);
  });
});

// --- Vitest und Jest ---

test("[1716] Vitest ohne Konfiguration: Vorgabesuche, ein Dateifilter engt ein", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "src/a.test.ts": "export {};\n",
      "src/b.spec.js": "export {};\n",
      "src/c.ts": "export {};\n",
      "dist/d.test.js": "export {};\n",
    });

    assert.deepEqual(auswahl(dir, { cmd: "npx vitest run", areas: ["x"] }).tests, ["src/a.test.ts", "src/b.spec.js"]);
    assert.deepEqual(auswahl(dir, { cmd: "npx vitest run b.spec", areas: ["x"] }).tests, ["src/b.spec.js"]);
  });
});

test("[1716] Jest ohne Konfiguration: Vorgabesuche mit __tests__", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "package.json": pkg({ test: "jest --coverage" }),
      "src/__tests__/a.js": "export {};\n",
      "src/b.test.jsx": "export {};\n",
      "src/c.spec.ts": "export {};\n",
      "src/d.js": "export {};\n",
      "node_modules/e/f.test.js": "export {};\n",
    });

    assert.deepEqual(auswahl(dir, { cmd: "npm test", areas: ["x"] }).tests, [
      "src/__tests__/a.js", "src/b.test.jsx", "src/c.spec.ts",
    ]);
  });
});

for (const [schluessel, zeile] of [
  ["include", "include: ['src/**/*.test.ts'],"],
  ["testMatch", "testMatch: ['**/*.pruef.ts'],"],
  ["testRegex", "testRegex: 'pruef',"],
  ["roots", "roots: ['<rootDir>/src'],"],
]) {
  test(`[1716] Vitest mit ${schluessel} ausserhalb des coverage-Blocks ist nicht beurteilbar`, () => {
    mitRepo({}, (dir) => {
      anlegen(dir, {
        "vitest.config.mjs": `export default {\n  test: {\n    ${zeile}\n    coverage: { reporter: ['text'] },\n  },\n};\n`,
        "src/a.test.ts": "export {};\n",
      });

      const ergebnis = auswahl(dir, { cmd: "vitest run", areas: ["x"] });

      assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
      assert.match(ergebnis.grund, new RegExp(`vitest\\.config\\.mjs.*${schluessel}`));
      assert.deepEqual(ergebnis.tests, []);
    });
  });
}

test("[1716] Jest mit testMatch in jest.config.js ist nicht beurteilbar", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "jest.config.js": "module.exports = { testMatch: ['**/*.pruef.js'] };\n",
      "src/a.test.js": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "npx jest", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /jest\.config\.js.*testMatch/);
  });
});

test("[1716] Jest mit roots im Schluessel jest der package.json ist nicht beurteilbar", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "package.json": pkg({ test: "jest" }, { jest: { roots: ["<rootDir>/src"], collectCoverage: true } }),
      "src/a.test.js": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "npm test", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /package\.json.*roots/);
  });
});

test("[1716] Gegenprobe: include nur im coverage-Block bleibt beurteilbar", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "vite.config.ts": [
        "// include: ['nur im Kommentar']",
        "export default defineConfig({",
        "  test: {",
        "    coverage: {",
        "      include: ['src/**'],",
        "      thresholds: { lines: 80 },",
        "    },",
        "  },",
        "});",
        "",
      ].join("\n"),
      "src/a.test.ts": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "vitest run --coverage", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.beurteilbar);
    assert.deepEqual(ergebnis.tests, ["src/a.test.ts"]);
  });
});

test("[1716] Vitest mit eigener Konfiguration ueber --config wird dort gelesen", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "konfig/vitest.unit.mjs": "export default { test: { include: ['src/**/*.unit.ts'] } };\n",
      "src/a.test.ts": "export {};\n",
    });

    const ergebnis = auswahl(dir, { cmd: "vitest run --config konfig/vitest.unit.mjs", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /konfig\/vitest\.unit\.mjs.*include/);
  });
});

// --- Maven und Gradle ---

test("[1716] Maven test: Surefire-Vorgaben unter src/test/java, ohne Failsafe", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "pom.xml": pom(FAILSAFE),
      "src/test/java/de/a/ATest.java": "class ATest {}\n",
      "src/test/java/de/a/TestB.java": "class TestB {}\n",
      "src/test/java/de/a/CTests.java": "class CTests {}\n",
      "src/test/java/de/a/DTestCase.java": "class DTestCase {}\n",
      "src/test/java/de/a/EIT.java": "class EIT {}\n",
      "src/test/java/de/a/Hilfe.java": "class Hilfe {}\n",
    });

    assert.deepEqual(auswahl(dir, { cmd: "mvn test", areas: ["x"] }).tests, [
      "src/test/java/de/a/ATest.java",
      "src/test/java/de/a/CTests.java",
      "src/test/java/de/a/DTestCase.java",
      "src/test/java/de/a/TestB.java",
    ]);
  });
});

test("[1716] Maven verify und install: dazu Failsafe, wenn das pom es bindet", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "pom.xml": pom(FAILSAFE),
      "src/test/java/de/a/ATest.java": "class ATest {}\n",
      "src/test/java/de/a/BIT.java": "class BIT {}\n",
      "src/test/java/de/a/ITC.java": "class ITC {}\n",
      "src/test/java/de/a/DITCase.java": "class DITCase {}\n",
    });

    const erwartet = [
      "src/test/java/de/a/ATest.java",
      "src/test/java/de/a/BIT.java",
      "src/test/java/de/a/DITCase.java",
      "src/test/java/de/a/ITC.java",
    ];
    assert.deepEqual(auswahl(dir, { cmd: "mvn clean verify", areas: ["x"] }).tests, erwartet);
    assert.deepEqual(auswahl(dir, { cmd: "./mvnw install", areas: ["x"] }).tests, erwartet);
  });
});

test("[1716] Maven verify ohne Failsafe im pom faehrt nur Surefire", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "pom.xml": pom(),
      "src/test/java/de/a/ATest.java": "class ATest {}\n",
      "src/test/java/de/a/BIT.java": "class BIT {}\n",
    });

    assert.deepEqual(auswahl(dir, { cmd: "mvn verify", areas: ["x"] }).tests, ["src/test/java/de/a/ATest.java"]);
  });
});

test("[1716] Maven: -Dtest= und -Dit.test= engen ein, -DskipTests ergibt keine Tests", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "pom.xml": pom(FAILSAFE),
      "src/test/java/de/a/ATest.java": "class ATest {}\n",
      "src/test/java/de/a/BTest.java": "class BTest {}\n",
      "src/test/java/de/a/CIT.java": "class CIT {}\n",
      "src/test/java/de/a/DIT.java": "class DIT {}\n",
    });

    assert.deepEqual(
      auswahl(dir, { cmd: "mvn -Dtest=ATest#methode -Dit.test=de.a.DIT verify", areas: ["x"] }).tests,
      ["src/test/java/de/a/ATest.java", "src/test/java/de/a/DIT.java"],
    );
    assert.deepEqual(
      auswahl(dir, { cmd: "mvn '-Dtest=B*,!BX*' -DskipITs test", areas: ["x"] }).tests,
      ["src/test/java/de/a/BTest.java"],
    );

    const ohne = auswahl(dir, { cmd: "mvn -DskipTests install", areas: ["x"] });
    assert.equal(ohne.urteil, URTEIL.nichtAbgeleitet);
    assert.deepEqual(ohne.tests, []);
  });
});

test("[1716] Maven: -pl waehlt Module als Ort, -f das pom", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "pom.xml": pom(),
      "kern/pom.xml": pom(),
      "kern/src/test/java/de/k/KTest.java": "class KTest {}\n",
      "web/pom.xml": pom(),
      "web/src/test/java/de/w/WTest.java": "class WTest {}\n",
    });

    const ergebnis = auswahl(dir, { cmd: "mvn -pl web test", areas: ["x"] });
    assert.equal(ergebnis.ort, "web");
    assert.deepEqual(ergebnis.tests, ["web/src/test/java/de/w/WTest.java"]);

    assert.deepEqual(auswahl(dir, { cmd: "mvn test", areas: ["x"] }).tests, [
      "kern/src/test/java/de/k/KTest.java", "web/src/test/java/de/w/WTest.java",
    ]);
    assert.deepEqual(auswahl(dir, { cmd: "mvn -f kern test", areas: ["x"] }).tests, ["kern/src/test/java/de/k/KTest.java"]);
  });
});

test("[1716] Maven: -pl mit -am baut weitere Module mit und ist nicht beurteilbar", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, { "pom.xml": pom(), "web/pom.xml": pom(), "web/src/test/java/de/w/WTest.java": "class WTest {}\n" });

    const ergebnis = auswahl(dir, { cmd: "mvn -pl web -am test", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /-am/);
  });
});

for (const [plugin, eintrag] of [
  ["maven-surefire-plugin", "<includes><include>**/*Pruefung.java</include></includes>"],
  ["maven-failsafe-plugin", "<testSourceDirectory>src/it/java</testSourceDirectory>"],
]) {
  test(`[1716] ${plugin} mit eigener Testauswahl ist nicht beurteilbar`, () => {
    mitRepo({}, (dir) => {
      anlegen(dir, {
        "pom.xml": pom(`    <plugin><artifactId>${plugin}</artifactId><configuration>${eintrag}</configuration></plugin>`),
        "src/test/java/de/a/ATest.java": "class ATest {}\n",
      });

      const ergebnis = auswahl(dir, { cmd: "mvn verify", areas: ["x"] });

      assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
      assert.match(ergebnis.grund, new RegExp(`pom\\.xml.*${plugin}`));
    });
  });
}

test("[1716] Gradle test: alle Testquellen, eingeengt durch --tests", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, {
      "build.gradle": "plugins { id 'java' }\n",
      "src/test/java/de/g/ATest.java": "class ATest {}\n",
      "src/test/java/de/g/BPruefung.java": "class BPruefung {}\n",
    });

    assert.deepEqual(auswahl(dir, { cmd: "./gradlew test", areas: ["x"] }).tests, [
      "src/test/java/de/g/ATest.java", "src/test/java/de/g/BPruefung.java",
    ]);
    assert.deepEqual(
      auswahl(dir, { cmd: "./gradlew test --tests 'de.g.B*'", areas: ["x"] }).tests,
      ["src/test/java/de/g/BPruefung.java"],
    );
    assert.deepEqual(
      auswahl(dir, { cmd: "gradle test --tests ATest.methode", areas: ["x"] }).tests,
      ["src/test/java/de/g/ATest.java"],
    );
  });
});

// --- Fremde Sprache ---

for (const kommando of ["pytest -q", "python -m pytest", "go test ./...", "cargo test", "dotnet test", "bundle exec rspec", "vendor/bin/phpunit", "bats test/"]) {
  test(`[1716] fremde Sprache: ${kommando} ist nicht beurteilbar`, () => {
    mitRepo({}, (dir) => {
      const ergebnis = auswahl(dir, { cmd: kommando, areas: ["x"] });

      assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
      assert.ok(ergebnis.grund.length > 0);
      assert.deepEqual(ergebnis.tests, []);
    });
  });
}

test("[1716] fremde Sprache neben einem beurteilbaren Segment macht das ganze Kommando nicht beurteilbar", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, { "test/a.test.mjs": "export {};\n" });

    const ergebnis = auswahl(dir, { cmd: "node --test && pytest", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtBeurteilbar);
    assert.match(ergebnis.grund, /pytest/);
  });
});

// --- Nicht aus der Auswertung abgeleitet ---

test("[1716] ein Linter ohne erkannte Tests ist nicht aus der Auswertung abgeleitet", () => {
  mitRepo({}, (dir) => {
    const ergebnis = auswahl(dir, { cmd: "npx eslint .", areas: ["x"] });

    assert.equal(ergebnis.urteil, URTEIL.nichtAbgeleitet);
    assert.ok(ergebnis.grund.length > 0);
    assert.deepEqual(ergebnis.tests, []);
  });
});

test("[1716] always: true, die Stringform und die Stufen push und merge sind nicht aus der Auswertung abgeleitet", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, { "test/a.test.mjs": "export {};\n" });

    for (const eintrag of [
      { cmd: "node --test", always: true },
      "node --test",
      { cmd: "node --test" },
      { cmd: "node --test", areas: ["x"], stufe: "push" },
      { cmd: "node --test", areas: ["x"], stufe: "merge" },
    ]) {
      const ergebnis = auswahl(dir, eintrag);
      assert.equal(ergebnis.urteil, URTEIL.nichtAbgeleitet, JSON.stringify(eintrag));
      assert.ok(ergebnis.grund.length > 0);
      assert.deepEqual(ergebnis.tests, []);
    }
  });
});

test("[1716] die Stufe paket ist die Vorgabe und bleibt beurteilbar", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, { "test/a.test.mjs": "export {};\n" });

    const ergebnis = auswahl(dir, { cmd: "node --test", areas: ["x"], stufe: "paket" });

    assert.equal(ergebnis.urteil, URTEIL.beurteilbar);
    assert.equal(ergebnis.grund, null);
  });
});

test("[1716] dateien ersetzt die Suche im Arbeitsstand", () => {
  mitRepo({}, (dir) => {
    anlegen(dir, { "test/a.test.mjs": "export {};\n", "test/b.test.mjs": "export {};\n" });

    const ergebnis = testsVon({ cmd: "node --test", areas: ["x"] }, { repoRoot: dir, dateien: ["test/b.test.mjs"] });

    assert.deepEqual(ergebnis.tests, ["test/b.test.mjs"]);
  });
});

test("[1716] die Gruende stehen in beiden Sprachen", async () => {
  const { TEXTE } = await import("../kit/texte/checks-testauswahl.mjs");
  assert.deepEqual(Object.keys(TEXTE.en).sort(), Object.keys(TEXTE.de).sort());
});
