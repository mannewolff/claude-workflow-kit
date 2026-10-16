// Das Kit gleicht eine eingerichtete Zuordnung der Pruefbereiche ab (Issue #1717, Plan #1713
// A6, A10).
//
// Eine Luecke hat dieselbe Regel wie die bisherige Invariante in test/config-teile.test.mjs:
// Laedt ein Test eine Datei, braucht jeder Bereich, dessen Muster sie trifft, ein Kommando,
// das den Bereich nennt und diesen Test faehrt. „Zu viel" ist nur ein Hinweis (#914): Ein
// Bereich darf vorsichtiger sein als noetig. Die Messung stellen die Fixtures von Hand, wie im
// Test zum Vorschlag.

import { test } from "node:test";
import assert from "node:assert/strict";

import { abgleichErheben, abgleichText, alsJson } from "../kit/checks/bereiche.mjs";
import { URTEIL } from "../kit/checks/testauswahl.mjs";

const beurteilbar = (tests) => ({ urteil: URTEIL.beurteilbar, grund: null, ort: ".", tests });
const PYTEST = { urteil: URTEIL.nichtBeurteilbar, grund: "Testlaeufer einer anderen Sprache: pytest", ort: ".", tests: [] };

const KERN = "node --test test/k*.test.mjs";
const ZWEI = "node --test test/z*.test.mjs";

/** Die Config des Grundfalls; `**\/*.md` trifft auch eine Datei im Wurzelverzeichnis. */
const CONFIG = {
  checkAreas: {
    doku: ["**/*.md"],
    kern: ["src/kern/**"],
    leer: ["src/leer/**"],
    tests: ["test/**"],
  },
  buildChecks: [
    { cmd: KERN, areas: ["kern", "tests", "leer"] },
    { cmd: ZWEI, areas: ["kern"] },
    { cmd: "pytest", areas: ["doku"] },
  ],
};

function messung(tabelle, kommandos) {
  const zeilen = Object.entries(tabelle).map(([testdatei, z]) => [testdatei, { laedt: [], nennt: [], ...z }]);
  return {
    dateien: ["notiz.md", "README.md", "src/kern/a.mjs", "src/leer/x.mjs", "test/k.test.mjs", "test/z.test.mjs"],
    tabelle: new Map(zeilen),
    kommandos,
  };
}

const GRUNDMESSUNG = messung(
  {
    "test/k.test.mjs": { laedt: ["notiz.md", "src/kern/a.mjs"] },
    "test/z.test.mjs": { laedt: ["src/kern/a.mjs"] },
  },
  [beurteilbar(["test/k.test.mjs"]), beurteilbar(["test/z.test.mjs"]), PYTEST],
);

test("A10: eine geladene Datei, deren Bereich das Kommando des Tests nicht nennt, ist eine Luecke", () => {
  const abgleich = abgleichErheben(CONFIG, GRUNDMESSUNG);

  assert.deepEqual(abgleich.luecken, [
    { test: "test/k.test.mjs", datei: "notiz.md", bereich: "doku", kommando: KERN },
    { test: "test/z.test.mjs", datei: "test/z.test.mjs", bereich: "tests", kommando: ZWEI },
  ]);
});

test("A10: das Muster loest bereicheVorbereiten auf — **/*.md trifft auch die Datei in der Wurzel", () => {
  // Eine Glob-Logik, die ‚**/' als mindestens einen Ordner liest, faende hier keine Luecke.
  const abgleich = abgleichErheben(CONFIG, GRUNDMESSUNG);

  assert.ok(abgleich.luecken.some((l) => l.datei === "notiz.md" && l.bereich === "doku"));
});

test("A10: die Testdatei selbst zaehlt als geladen", () => {
  const abgleich = abgleichErheben(CONFIG, GRUNDMESSUNG);

  // test/k.test.mjs liegt in `tests`, und KERN nennt `tests`: keine Luecke. ZWEI nennt es nicht.
  assert.ok(!abgleich.luecken.some((l) => l.test === "test/k.test.mjs" && l.bereich === "tests"));
  assert.ok(abgleich.luecken.some((l) => l.test === "test/z.test.mjs" && l.datei === "test/z.test.mjs"));
});

test("A10: eine genannte Datei zaehlt wie eine geladene (A2)", () => {
  const m = messung(
    { "test/k.test.mjs": { laedt: ["src/kern/a.mjs"], nennt: ["README.md"] } },
    [beurteilbar(["test/k.test.mjs"]), beurteilbar([]), PYTEST],
  );

  assert.deepEqual(abgleichErheben(CONFIG, m).luecken, [
    { test: "test/k.test.mjs", datei: "README.md", bereich: "doku", kommando: KERN },
  ]);
});

test("A10: ein zweites Kommando, das den Test faehrt und den Bereich nennt, schliesst die Luecke", () => {
  const config = { ...CONFIG, buildChecks: [...CONFIG.buildChecks, { cmd: "node --test", areas: ["doku", "tests"] }] };
  const m = { ...GRUNDMESSUNG, kommandos: [...GRUNDMESSUNG.kommandos, beurteilbar(["test/k.test.mjs", "test/z.test.mjs"])] };

  assert.deepEqual(abgleichErheben(config, m).luecken, []);
});

test("zu viel: ein genannter Bereich, dessen Dateien keiner der Tests des Kommandos laedt, ist ein Hinweis", () => {
  const abgleich = abgleichErheben(CONFIG, GRUNDMESSUNG);

  assert.deepEqual(abgleich.zuViel, [{ kommando: KERN, bereich: "leer" }]);
  assert.ok(!abgleich.luecken.some((l) => l.bereich === "leer"), "zu viel steht nicht unter den Luecken");
});

test("nurTests beschraenkt die Luecken auf die genannten Tests", () => {
  const abgleich = abgleichErheben(CONFIG, GRUNDMESSUNG, { nurTests: ["test/k.test.mjs"] });

  assert.deepEqual(abgleich.luecken.map((l) => l.test), ["test/k.test.mjs"]);
});

test("A6: nicht beurteilbare und nicht abgeleitete Kommandos ergeben keine Luecke", () => {
  const config = {
    ...CONFIG,
    buildChecks: [
      { cmd: "pytest", areas: [] },
      { cmd: "npx eslint .", always: true },
      { cmd: KERN, areas: [] },
    ],
  };
  const m = messung(
    {
      "test/k.test.mjs": { laedt: ["src/kern/a.mjs"], unvollstaendig: "test/k.test.mjs: Import \"@/x\" trifft keine Datei" },
    },
    [PYTEST, { urteil: URTEIL.nichtAbgeleitet, grund: "always: true, laeuft immer", ort: ".", tests: [] }, beurteilbar(["test/k.test.mjs"])],
  );

  const abgleich = abgleichErheben(config, m);

  assert.deepEqual(abgleich.luecken, []);
  assert.deepEqual(abgleich.zuViel, []);
  assert.deepEqual(abgleich.nichtBeurteilbar.map((k) => k.cmd), ["pytest", KERN]);
  assert.match(abgleich.nichtBeurteilbar[1].grund, /Import "@\/x" trifft keine Datei/);
  assert.deepEqual(abgleich.nichtAbgeleitet, [{ cmd: "npx eslint .", grund: "always: true, laeuft immer" }]);
});

test("ein Test, den kein beurteilbares Kommando faehrt, steht gesondert und ergibt keine Luecke", () => {
  const m = messung(
    { "test/x.test.mjs": { laedt: ["notiz.md"] } },
    [beurteilbar([]), beurteilbar([]), PYTEST],
  );

  const abgleich = abgleichErheben(CONFIG, m);

  assert.deepEqual(abgleich.luecken, []);
  assert.deepEqual(abgleich.ohneKommando, ["test/x.test.mjs"]);
});

test("Darstellung: Text nennt Test, Datei, Bereich und Kommando je Luecke; JSON traegt dieselben Daten", () => {
  const abgleich = abgleichErheben(CONFIG, GRUNDMESSUNG);

  const text = abgleichText(abgleich);
  for (const luecke of abgleich.luecken) {
    const zeile = text.split("\n").find((z) => z.includes(luecke.test) && z.includes(luecke.datei) && z.includes(luecke.bereich));
    assert.ok(zeile?.includes(luecke.kommando), `keine Zeile fuer ${JSON.stringify(luecke)}`);
  }
  assert.ok(text.includes("leer"));
  assert.deepEqual(JSON.parse(alsJson(abgleich)), JSON.parse(JSON.stringify(abgleich)));
});
