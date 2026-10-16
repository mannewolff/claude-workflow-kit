// Die Messung der Verflechtung liest JavaScript, TypeScript und Java, auch gemischt
// (Issue #1715, Plan #1713 A3, A4, A6, P13).
//
// Der PO verlangt die drei Sprachen von Beginn an (Issue #1706, Kriterium 10). Geprueft wird
// an Wegwerf-Projekten, je Sprache die Lesart aus A3: wie aus einem Import ein Pfad wird. Dazu
// die Durchgangsstationen aus A4 und der Vermerk „unvollstaendig" aus A6, auf dem das Urteil
// „nicht beurteilbar" (Kriterium 8) aufsetzt: Ein Alias ohne Treffer ist keine Entwarnung.

import { test } from "node:test";
import assert from "node:assert/strict";

import { verflechtungErheben } from "../kit/checks/verflechtung.mjs";
import { mitRepo, datei } from "./helpers/checks-repo.mjs";

/** Die Messung eines Tests im Wegwerf-Projekt `dir`. */
function messen(dir, testdatei, optionen = {}) {
  return verflechtungErheben({ repoRoot: dir, testdateien: [testdatei], ...optionen }).get(testdatei);
}

// --- JavaScript: die Lesart von Issue #1714 bleibt, wie sie war ---

test("[1715] JavaScript: relative Importe laden, Nennungen zaehlen, Quelle zu Quelle laeuft nicht weiter", () => {
  mitRepo({}, (dir) => {
    datei(dir, "kit/a.mjs", 'import { b } from "./b.mjs";\nexport const a = b;\n');
    datei(dir, "kit/b.mjs", "export const b = 1;\n");
    datei(dir, "kit/c.mjs", "console.log(1);\n");
    datei(dir, "test/a.test.mjs", 'import { a } from "../kit/a.mjs";\nconst start = "kit/c.mjs";\nconsole.log(a, start);\n');

    assert.deepEqual(messen(dir, "test/a.test.mjs"), { laedt: ["kit/a.mjs"], nennt: ["kit/c.mjs"] });
  });
});

test("[1715] JavaScript: ein Import ohne Endung bleibt ohne Kopplung wie bisher", () => {
  mitRepo({}, (dir) => {
    datei(dir, "kit/a.mjs", "export const a = 1;\n");
    datei(dir, "test/a.test.mjs", 'import { a } from "../kit/a";\nconsole.log(a);\n');

    assert.deepEqual(messen(dir, "test/a.test.mjs"), { laedt: [], nennt: [] });
  });
});

// --- TypeScript ---

test("[1715] TypeScript: ohne Endung, .js nach .ts, index-Datei", () => {
  mitRepo({}, (dir) => {
    datei(dir, "src/ohne.ts", "export const o = 1;\n");
    datei(dir, "src/endung.ts", "export const e = 1;\n");
    datei(dir, "src/komponente.tsx", "export const k = 1;\n");
    datei(dir, "src/modul/index.ts", "export const m = 1;\n");
    datei(dir, "test/t.test.ts", [
      'import { o } from "../src/ohne";',
      'import { e } from "../src/endung.js";',
      'import { k } from "../src/komponente";',
      'import { m } from "../src/modul";',
      "console.log(o, e, k, m);",
      "",
    ].join("\n"));

    assert.deepEqual(messen(dir, "test/t.test.ts"), {
      laedt: ["src/endung.ts", "src/komponente.tsx", "src/modul/index.ts", "src/ohne.ts"],
      nennt: [],
    });
  });
});

test("[1715] TypeScript: Alias ueber paths und baseUrl der naechsten tsconfig.json mit relativem extends", () => {
  mitRepo({}, (dir) => {
    datei(dir, "tsconfig.base.json", [
      "{",
      "  // Kommentare und ein Komma am Ende sind in einer tsconfig erlaubt",
      '  "compilerOptions": {',
      '    "baseUrl": "./web",',
      '    "paths": { "@app/*": ["src/*"], "@geteilt": ["libs/geteilt/index.ts"], },',
      "  },",
      "}",
      "",
    ].join("\n"));
    datei(dir, "web/tsconfig.json", '{ "extends": "../tsconfig.base", "compilerOptions": { "strict": true } }\n');
    datei(dir, "web/src/dienst.ts", "export const d = 1;\n");
    datei(dir, "web/libs/geteilt/index.ts", "export const g = 1;\n");
    datei(dir, "web/src/basis.ts", "export const b = 1;\n");
    datei(dir, "web/test/t.test.ts", [
      'import { d } from "@app/dienst";',
      'import { g } from "@geteilt";',
      'import { b } from "src/basis";',
      'import { readFileSync } from "node:fs";',
      'import { describe } from "vitest";',
      "console.log(d, g, b, readFileSync, describe);",
      "",
    ].join("\n"));

    assert.deepEqual(messen(dir, "web/test/t.test.ts"), {
      laedt: ["web/libs/geteilt/index.ts", "web/src/basis.ts", "web/src/dienst.ts"],
      nennt: [],
    });
  });
});

test("[1715] TypeScript: ein Alias ohne Treffer setzt den Vermerk unvollstaendig mit Grund", () => {
  mitRepo({}, (dir) => {
    datei(dir, "tsconfig.json", '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }\n');
    datei(dir, "src/da.ts", "export const d = 1;\n");
    datei(dir, "test/t.test.ts", 'import { d } from "@app/da";\nimport { f } from "@app/fehlt";\nconsole.log(d, f);\n');

    const messung = messen(dir, "test/t.test.ts");
    assert.deepEqual(messung.laedt, ["src/da.ts"]);
    assert.equal(typeof messung.unvollstaendig, "string", "der Vermerk fehlt");
    assert.match(messung.unvollstaendig, /@app\/fehlt/, "der Grund nennt den Import nicht");
    assert.match(messung.unvollstaendig, /test\/t\.test\.ts/, "der Grund nennt die Datei nicht");
    assert.match(messung.unvollstaendig, /tsconfig\.json/, "der Grund nennt die tsconfig nicht");
  });
});

test("[1715] TypeScript: eine unlesbare tsconfig.json setzt den Vermerk, ein relativer Import zaehlt weiter", () => {
  mitRepo({}, (dir) => {
    datei(dir, "tsconfig.json", '{ "compilerOptions": { "paths": \n');
    datei(dir, "src/da.ts", "export const d = 1;\n");
    datei(dir, "test/t.test.ts", 'import { d } from "../src/da";\nimport { x } from "@app/x";\nconsole.log(d, x);\n');

    const messung = messen(dir, "test/t.test.ts");
    assert.deepEqual(messung.laedt, ["src/da.ts"]);
    assert.match(messung.unvollstaendig ?? "", /tsconfig\.json/);
  });
});

test("[1715] ohne nicht aufloesbaren Import traegt ein Test keinen Vermerk", () => {
  mitRepo({}, (dir) => {
    datei(dir, "src/da.ts", "export const d = 1;\n");
    datei(dir, "test/t.test.ts", 'import { d } from "../src/da";\nimport { x } from "extern";\nconsole.log(d, x);\n');

    assert.ok(!("unvollstaendig" in messen(dir, "test/t.test.ts")));
  });
});

test("[1715] TypeScript: die Kette laeuft von Quelle zu Quelle weiter", () => {
  mitRepo({}, (dir) => {
    datei(dir, "src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    datei(dir, "src/b.ts", 'import { c } from "./tief/c.js";\nexport const b = c;\n');
    datei(dir, "src/tief/c.ts", 'import { a } from "../a";\nexport const c = 1;\nconsole.log(a);\n');
    datei(dir, "test/t.test.ts", 'import { a } from "../src/a";\nconsole.log(a);\n');

    assert.deepEqual(messen(dir, "test/t.test.ts").laedt, ["src/a.ts", "src/b.ts", "src/tief/c.ts"]);
  });
});

// --- Java ---

test("[1715] Java: Einzel-, Stern- und statischer Import gegen mehrere Quellwurzeln", () => {
  mitRepo({}, (dir) => {
    datei(dir, "kern/src/main/java/de/kern/Konto.java", "package de.kern;\npublic class Konto {}\n");
    datei(dir, "kern/src/main/java/de/kern/Werte.java", "package de.kern;\npublic class Werte { public static int EINS = 1; }\n");
    datei(dir, "dienst/src/main/java/de/dienst/Buchung.java", "package de.dienst;\npublic class Buchung {}\n");
    datei(dir, "dienst/src/main/java/de/dienst/Storno.java", "package de.dienst;\npublic class Storno {}\n");
    datei(dir, "dienst/src/main/java/de/dienst/Unbenutzt.java", "package de.dienst;\npublic class Unbenutzt {}\n");
    datei(dir, "app/src/test/java/de/app/KontoTest.java", [
      "package de.app;",
      "import de.kern.Konto;",
      "import de.dienst.*;",
      "import static de.kern.Werte.EINS;",
      "import java.util.List;",
      "class KontoTest { Konto k; Buchung b; Storno s; int e = EINS; List<String> l; }",
      "",
    ].join("\n"));

    assert.deepEqual(messen(dir, "app/src/test/java/de/app/KontoTest.java"), {
      laedt: [
        "dienst/src/main/java/de/dienst/Buchung.java",
        "dienst/src/main/java/de/dienst/Storno.java",
        "kern/src/main/java/de/kern/Konto.java",
        "kern/src/main/java/de/kern/Werte.java",
      ],
      nennt: [],
    });
  });
});

test("[1715] Java: ein Name aus dem eigenen Paket ohne Import und ein voll qualifizierter Name im Text", () => {
  mitRepo({}, (dir) => {
    datei(dir, "src/main/java/de/app/Rechner.java", "package de.app;\npublic class Rechner {}\n");
    datei(dir, "src/main/java/de/app/Fremd.java", "package de.app;\npublic class Fremd {}\n");
    datei(dir, "src/main/java/de/util/Hilfe.java", "package de.util;\npublic class Hilfe { public static class Innen {} }\n");
    datei(dir, "src/test/java/de/app/RechnerTest.java", [
      "package de.app;",
      "class RechnerTest {",
      "  Rechner r = new Rechner();",
      "  Object h = new de.util.Hilfe.Innen();",
      "}",
      "",
    ].join("\n"));

    assert.deepEqual(messen(dir, "src/test/java/de/app/RechnerTest.java").laedt, [
      "src/main/java/de/app/Rechner.java",
      "src/main/java/de/util/Hilfe.java",
    ]);
  });
});

test("[1715] Java: die Kette laeuft von Quelle zu Quelle und durch Testhilfen unter src/test/ weiter", () => {
  mitRepo({}, (dir) => {
    datei(dir, "src/main/java/de/app/Dienst.java", "package de.app;\nimport de.app.repo.Ablage;\npublic class Dienst { Ablage a; }\n");
    datei(dir, "src/main/java/de/app/repo/Ablage.java", "package de.app.repo;\npublic class Ablage { Eintrag e; }\n");
    datei(dir, "src/main/java/de/app/repo/Eintrag.java", "package de.app.repo;\npublic class Eintrag {}\n");
    datei(dir, "src/test/java/de/app/hilfe/Fabrik.java", "package de.app.hilfe;\nimport de.app.Dienst;\npublic class Fabrik { Dienst d; }\n");
    datei(dir, "src/test/java/de/app/DienstTest.java", "package de.app;\nimport de.app.hilfe.Fabrik;\nclass DienstTest { Fabrik f; }\n");

    assert.deepEqual(messen(dir, "src/test/java/de/app/DienstTest.java").laedt, [
      "src/main/java/de/app/Dienst.java",
      "src/main/java/de/app/repo/Ablage.java",
      "src/main/java/de/app/repo/Eintrag.java",
    ]);
  });
});

// --- Bare Specifier ---

test("[1715] ein Bare Specifier ist extern, ausser er traegt den Namen einer versionierten package.json", () => {
  mitRepo({}, (dir) => {
    datei(dir, "pakete/geteilt/package.json", '{ "name": "@firma/geteilt", "main": "index.js" }\n');
    datei(dir, "pakete/geteilt/index.js", "export const g = 1;\n");
    datei(dir, "pakete/geteilt/teil.js", "export const t = 1;\n");
    datei(dir, "kit/a.mjs", "export const a = 1;\n");
    datei(dir, "test/a.test.mjs", [
      'import { g } from "@firma/geteilt";',
      'import { t } from "@firma/geteilt/teil.js";',
      'import { x } from "@firma/geteilt-nicht";',
      'import { y } from "lodash";',
      "console.log(g, t, x, y);",
      "",
    ].join("\n"));

    assert.deepEqual(messen(dir, "test/a.test.mjs"), {
      laedt: ["pakete/geteilt/index.js", "pakete/geteilt/package.json", "pakete/geteilt/teil.js"],
      nennt: [],
    });
  });
});

// --- Durchgangsstationen ---

test("[1715] die Kette laeuft durch test/, tests/ und __tests__/ weiter, auch unterhalb eines Ordners", () => {
  mitRepo({}, (dir) => {
    datei(dir, "src/eins.mjs", "export const e = 1;\n");
    datei(dir, "src/zwei.ts", "export const z = 1;\n");
    datei(dir, "src/drei.mjs", "export const d = 1;\n");
    datei(dir, "tests/hilfe.mjs", 'export { e } from "../src/eins.mjs";\nexport { h } from "./tiefer/__tests__/noch.ts";\n');
    datei(dir, "tests/tiefer/__tests__/noch.ts", 'export { z as h } from "../../../src/zwei";\nexport { d } from "../../../web/test/helfer.mjs";\n');
    datei(dir, "web/test/helfer.mjs", 'export { d } from "../../src/drei.mjs";\n');
    datei(dir, "tests/a.test.mjs", 'import { e, h } from "./hilfe.mjs";\nconsole.log(e, h);\n');

    assert.deepEqual(messen(dir, "tests/a.test.mjs").laedt, ["src/drei.mjs", "src/eins.mjs", "src/zwei.ts"]);
  });
});

test("[1715] Dateien unter den Testhilfe-Ordnern sind nie Quellen", () => {
  mitRepo({}, (dir) => {
    datei(dir, "__tests__/fixture.ts", "export const f = 1;\n");
    datei(dir, "__tests__/a.test.ts", 'import { f } from "./fixture";\nconst p = "__tests__/fixture.ts";\nconsole.log(f, p);\n');

    assert.deepEqual(messen(dir, "__tests__/a.test.ts"), { laedt: [], nennt: [] });
  });
});

// --- Gemischtes Projekt ---

test("[1715] gemischtes Projekt: Java unter backend/ und TypeScript unter frontend/ in einem Lauf", () => {
  mitRepo({}, (dir) => {
    datei(dir, "backend/src/main/java/de/shop/Warenkorb.java", "package de.shop;\nimport de.shop.preis.Preis;\npublic class Warenkorb { Preis p; }\n");
    datei(dir, "backend/src/main/java/de/shop/preis/Preis.java", "package de.shop.preis;\npublic class Preis {}\n");
    datei(dir, "backend/src/test/java/de/shop/WarenkorbTest.java", "package de.shop;\nclass WarenkorbTest { Warenkorb w; }\n");
    datei(dir, "frontend/tsconfig.json", '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }\n');
    datei(dir, "frontend/src/warenkorb.ts", 'import { preis } from "./preis";\nexport const w = preis;\n');
    datei(dir, "frontend/src/preis.ts", "export const preis = 1;\n");
    datei(dir, "frontend/src/__tests__/warenkorb.test.ts", 'import { w } from "@/warenkorb";\nconsole.log(w);\n');

    const tests = ["backend/src/test/java/de/shop/WarenkorbTest.java", "frontend/src/__tests__/warenkorb.test.ts"];
    const messung = verflechtungErheben({ repoRoot: dir, testdateien: tests });
    assert.deepEqual([...messung.keys()], tests);
    assert.deepEqual(messung.get(tests[0]), {
      laedt: ["backend/src/main/java/de/shop/Warenkorb.java", "backend/src/main/java/de/shop/preis/Preis.java"],
      nennt: [],
    });
    assert.deepEqual(messung.get(tests[1]), {
      laedt: ["frontend/src/preis.ts", "frontend/src/warenkorb.ts"],
      nennt: [],
    });
  });
});
