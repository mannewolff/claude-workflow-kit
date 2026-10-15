// Das Kit leitet Pruefbereiche aus der Messung ab (Issue #1717, Plan #1713 A6 bis A9, E5, E6).
//
// `vorschlagErheben` rechnet allein ueber Config und Messung, ohne Dateisystem und ohne
// Kommandozeile. Die Fixtures stellen die Messung darum von Hand: die Dateien des
// Arbeitsstands, je Test die geladenen und genannten Dateien und je Kommando das Urteil der
// Testauswahl. So steht jede Regel des Plans fuer sich, und kein Test haengt an der Lesart
// einer Sprache.

import { test } from "node:test";
import assert from "node:assert/strict";

import { vorschlagErheben, vorschlagText, alsJson } from "../kit/checks/bereiche.mjs";
import { URTEIL } from "../kit/checks/testauswahl.mjs";

const beurteilbar = (tests) => ({ urteil: URTEIL.beurteilbar, grund: null, ort: ".", tests });

/** Eine Messung aus Dateiliste, Tabelle (Test → { laedt, nennt }) und Urteilen je Kommando. */
function messung(dateien, tabelle, kommandos) {
  const zeilen = Object.entries(tabelle).map(([testdatei, z]) => [testdatei, { laedt: [], nennt: [], ...z }]);
  return { dateien, tabelle: new Map(zeilen), kommandos };
}

// Zwei Kommandos, je ein Test; eine Datei laden beide, zwei laedt keiner.
const K1 = "node --test test/a*.test.mjs";
const K2 = "node --test test/b*.test.mjs";
const GRUNDFALL = {
  config: { buildChecks: [{ cmd: K1, areas: ["alt"] }, { cmd: K2, areas: ["alt"] }], checkAreas: {} },
  messung: messung(
    [
      "docs/x.md", "src/a/eins.mjs", "src/a/zwei.mjs", "src/b/drei.mjs", "src/frei.mjs",
      "src/gemeinsam.mjs", "test/a.test.mjs", "test/b.test.mjs",
    ],
    {
      "test/a.test.mjs": { laedt: ["src/a/eins.mjs", "src/a/zwei.mjs", "src/gemeinsam.mjs"] },
      "test/b.test.mjs": { laedt: ["src/b/drei.mjs", "src/gemeinsam.mjs"] },
    },
    [beurteilbar(["test/a.test.mjs"]), beurteilbar(["test/b.test.mjs"])],
  ),
};

const bereichMit = (vorschlag, pfad) => vorschlag.bereiche.find((b) => b.dateien.includes(pfad));

test("A7: Dateien gleicher Signatur bilden einen Bereich, die Testdatei gehoert zur Signatur ihres Kommandos", () => {
  const vorschlag = vorschlagErheben(GRUNDFALL.config, GRUNDFALL.messung);

  assert.equal(vorschlag.gruppenArt, "kommandos");
  assert.deepEqual(
    vorschlag.bereiche.map((b) => [b.name, b.dateien]),
    [
      ["src", ["src/gemeinsam.mjs"]],
      ["src-a", ["src/a/eins.mjs", "src/a/zwei.mjs", "test/a.test.mjs"]],
      ["src-b", ["src/b/drei.mjs", "test/b.test.mjs"]],
    ],
  );
  assert.deepEqual(bereichMit(vorschlag, "src/gemeinsam.mjs").gruppen, [K1, K2]);
  assert.deepEqual(bereichMit(vorschlag, "test/a.test.mjs").gruppen, [K1]);
});

test("A7: Ordnermuster nur bei einheitlicher Signatur darunter, sonst Einzelpfade", () => {
  const vorschlag = vorschlagErheben(GRUNDFALL.config, GRUNDFALL.messung);

  // Unter src/a/ tragen alle Dateien dieselbe Signatur; unter test/ und src/ nicht.
  assert.deepEqual(bereichMit(vorschlag, "src/a/eins.mjs").muster, ["src/a/**", "test/a.test.mjs"]);
  assert.deepEqual(bereichMit(vorschlag, "src/gemeinsam.mjs").muster, ["src/gemeinsam.mjs"]);
});

test("A7: Dateien ohne ladenden Test stehen unter ‚von keinem Test geladen' und in keinem Bereich", () => {
  const vorschlag = vorschlagErheben(GRUNDFALL.config, GRUNDFALL.messung);

  assert.deepEqual(vorschlag.ohneTest, ["docs/x.md", "src/frei.mjs"]);
  for (const pfad of vorschlag.ohneTest) assert.equal(bereichMit(vorschlag, pfad), undefined, pfad);
});

test("A7: je Bereich die begruendenden Tests und Dateien", () => {
  const vorschlag = vorschlagErheben(GRUNDFALL.config, GRUNDFALL.messung);

  const gemeinsam = bereichMit(vorschlag, "src/gemeinsam.mjs");
  assert.deepEqual(gemeinsam.tests, ["test/a.test.mjs", "test/b.test.mjs"]);
  assert.deepEqual(gemeinsam.dateien, ["src/gemeinsam.mjs"]);
  assert.deepEqual(bereichMit(vorschlag, "src/b/drei.mjs").tests, ["test/b.test.mjs"]);
});

test("A7: je Kommando die Bereiche, deren Signatur es enthaelt", () => {
  const vorschlag = vorschlagErheben(GRUNDFALL.config, GRUNDFALL.messung);

  assert.deepEqual(
    vorschlag.kommandos.map((k) => [k.cmd, k.urteil, k.areas]),
    [[K1, URTEIL.beurteilbar, ["src", "src-a"]], [K2, URTEIL.beurteilbar, ["src", "src-b"]]],
  );
  assert.deepEqual(vorschlag.ausschnitt.buildChecks, [{ cmd: K1, areas: ["src", "src-a"] }, { cmd: K2, areas: ["src", "src-b"] }]);
  assert.deepEqual(vorschlag.ausschnitt.checkAreas, {
    src: ["src/gemeinsam.mjs"],
    "src-a": ["src/a/**", "test/a.test.mjs"],
    "src-b": ["src/b/**", "test/b.test.mjs"],
  });
});

test("A7: ohne beurteilbares Kommando sind die Gruppen die Ordner der Testdateien", () => {
  const config = { buildChecks: [{ cmd: "pytest", areas: ["py"] }] };
  const m = messung(
    ["lib/a.mjs", "lib/b.mjs", "test/eins/a.test.mjs", "test/zwei/b.test.mjs"],
    {
      "test/eins/a.test.mjs": { laedt: ["lib/a.mjs"] },
      "test/zwei/b.test.mjs": { laedt: ["lib/b.mjs"] },
    },
    [{ urteil: URTEIL.nichtBeurteilbar, grund: "Testlaeufer einer anderen Sprache: pytest", ort: ".", tests: [] }],
  );

  const vorschlag = vorschlagErheben(config, m);

  assert.equal(vorschlag.gruppenArt, "ordner");
  assert.deepEqual(
    vorschlag.bereiche.map((b) => [b.gruppen, b.muster]),
    [[["test/eins"], ["lib/a.mjs", "test/eins/**"]], [["test/zwei"], ["lib/b.mjs", "test/zwei/**"]]],
  );
  // Das Kommando bleibt, wie es ist (A6).
  assert.deepEqual(vorschlag.kommandos, [
    { cmd: "pytest", urteil: URTEIL.nichtBeurteilbar, grund: "Testlaeufer einer anderen Sprache: pytest", areas: ["py"] },
  ]);
});

test("A6: nicht beurteilbar und nicht abgeleitet bleiben unveraendert, ohne vorgeschlagene Einschraenkung", () => {
  const config = {
    buildChecks: [
      { cmd: K1, areas: ["src-a"] },
      { cmd: "npx eslint .", always: true },
      { cmd: "pytest", areas: ["py", "rest"] },
    ],
  };
  const m = messung(
    GRUNDFALL.messung.dateien,
    { "test/a.test.mjs": { laedt: ["src/a/eins.mjs"] } },
    [
      beurteilbar(["test/a.test.mjs"]),
      { urteil: URTEIL.nichtAbgeleitet, grund: "always: true, laeuft immer", ort: ".", tests: [] },
      { urteil: URTEIL.nichtBeurteilbar, grund: "Testlaeufer einer anderen Sprache: pytest", ort: ".", tests: [] },
    ],
  );

  const vorschlag = vorschlagErheben(config, m);

  assert.deepEqual(vorschlag.kommandos.slice(1), [
    { cmd: "npx eslint .", urteil: URTEIL.nichtAbgeleitet, grund: "always: true, laeuft immer", areas: [] },
    { cmd: "pytest", urteil: URTEIL.nichtBeurteilbar, grund: "Testlaeufer einer anderen Sprache: pytest", areas: ["py", "rest"] },
  ]);
  // Im Ausschnitt stehen sie mit ihren eingerichteten Bereichen, nicht eingeschraenkt.
  assert.deepEqual(vorschlag.ausschnitt.buildChecks.slice(1), [
    { cmd: "npx eslint .", areas: [] },
    { cmd: "pytest", areas: ["py", "rest"] },
  ]);
});

test("A6: ein Test mit Vermerk unvollstaendig macht sein Kommando nicht beurteilbar", () => {
  const m = messung(
    GRUNDFALL.messung.dateien,
    {
      "test/a.test.mjs": { laedt: ["src/a/eins.mjs"] },
      "test/b.test.mjs": { laedt: ["src/b/drei.mjs"], unvollstaendig: "test/b.test.mjs: Import \"@/x\" trifft keine Datei" },
    },
    GRUNDFALL.messung.kommandos,
  );

  const vorschlag = vorschlagErheben(GRUNDFALL.config, m);

  const zweites = vorschlag.kommandos[1];
  assert.equal(zweites.urteil, URTEIL.nichtBeurteilbar);
  assert.match(zweites.grund, /Import "@\/x" trifft keine Datei/);
  assert.deepEqual(zweites.areas, ["alt"]);
  // Seine Tests leiten keinen Bereich mehr ab.
  assert.equal(bereichMit(vorschlag, "src/b/drei.mjs"), undefined);
  assert.ok(vorschlag.ohneTest.includes("src/b/drei.mjs"));
});

test("A8: ein bestehender Bereich mit Dateien verschiedener Signatur wird zur Teilung vorgeschlagen", () => {
  const config = { ...GRUNDFALL.config, checkAreas: { alt: ["src/**"] } };

  const vorschlag = vorschlagErheben(config, GRUNDFALL.messung);

  assert.equal(vorschlag.teilungen.length, 1);
  const [teilung] = vorschlag.teilungen;
  assert.equal(teilung.bereich, "alt");
  assert.deepEqual(
    teilung.teile.map((teil) => [teil.gruppen, teil.dateien, teil.tests]),
    [
      [[K1], ["src/a/eins.mjs", "src/a/zwei.mjs"], ["test/a.test.mjs"]],
      [[K1, K2], ["src/gemeinsam.mjs"], ["test/a.test.mjs", "test/b.test.mjs"]],
      [[K2], ["src/b/drei.mjs"], ["test/b.test.mjs"]],
    ],
  );
});

test("A8: zwei bestehende Bereiche gleicher Signatur werden zur Zusammenlegung vorgeschlagen", () => {
  const config = { ...GRUNDFALL.config, checkAreas: { p: ["src/a/eins.mjs"], q: ["src/a/zwei.mjs"], r: ["src/b/**"] } };

  const vorschlag = vorschlagErheben(config, GRUNDFALL.messung);

  assert.deepEqual(vorschlag.teilungen, []);
  assert.deepEqual(vorschlag.zusammenlegungen, [
    { bereiche: ["p", "q"], gruppen: [K1], dateien: ["src/a/eins.mjs", "src/a/zwei.mjs"], tests: ["test/a.test.mjs"] },
  ]);
});

/** Ein Kommando mit vier Tests; `hilfeVon` laedt zusaetzlich die gemeinsame Hilfe. */
function vierTests(hilfeVon) {
  const tests = ["test/x1.test.mjs", "test/x2.test.mjs", "test/y1.test.mjs", "test/y2.test.mjs"];
  const tabelle = Object.fromEntries(tests.map((testdatei) => {
    const teil = testdatei.includes("/x") ? "src/x/teil.mjs" : "src/y/teil.mjs";
    return [testdatei, { laedt: hilfeVon.includes(testdatei) ? [teil, "src/hilfe.mjs"] : [teil] }];
  }));
  return {
    config: { buildChecks: [{ cmd: "npm test", areas: ["alles"] }] },
    messung: messung(["src/hilfe.mjs", "src/x/teil.mjs", "src/y/teil.mjs", ...tests], tabelle, [beurteilbar(tests)]),
  };
}

test("E6: Dateien, die mehr als die Haelfte der Tests laedt, trennen nicht; genannt die Testdateien je Teil", () => {
  const { config, messung: m } = vierTests(["test/x1.test.mjs", "test/x2.test.mjs", "test/y1.test.mjs"]);

  const vorschlag = vorschlagErheben(config, m);

  assert.equal(vorschlag.teilbareKommandos.length, 1);
  const [teilbar] = vorschlag.teilbareKommandos;
  assert.equal(teilbar.cmd, "npm test");
  assert.deepEqual(teilbar.gemeinsam, ["src/hilfe.mjs"]);
  assert.deepEqual(teilbar.teile, [
    { tests: ["test/x1.test.mjs", "test/x2.test.mjs"], dateien: ["src/x/teil.mjs", "test/x1.test.mjs", "test/x2.test.mjs"] },
    { tests: ["test/y1.test.mjs", "test/y2.test.mjs"], dateien: ["src/y/teil.mjs", "test/y1.test.mjs", "test/y2.test.mjs"] },
  ]);
});

test("E6: Gegenprobe — eine Datei, die genau die Haelfte der Tests laedt, verbindet die Teile", () => {
  const { config, messung: m } = vierTests(["test/x1.test.mjs", "test/y1.test.mjs"]);

  assert.deepEqual(vorschlagErheben(config, m).teilbareKommandos, []);
});

test("E6: die Teilung schreibt keine Kommandozeile", () => {
  const { config, messung: m } = vierTests(["test/x1.test.mjs", "test/x2.test.mjs", "test/y1.test.mjs"]);

  const vorschlag = vorschlagErheben(config, m);

  for (const teil of vorschlag.teilbareKommandos[0].teile) assert.deepEqual(Object.keys(teil).sort(), ["dateien", "tests"]);
  const text = vorschlagText(vorschlag);
  assert.doesNotMatch(text, /node --test|npm test test\/|npm run/);
});

/** `anzahl` Tests, von denen die ersten `nenner` README.md nennen; `lader` laedt sie zusaetzlich. */
function nennungen(anzahl, nenner, lader = null) {
  const tests = Array.from({ length: anzahl }, (_, i) => `test/t${String(i).padStart(2, "0")}.test.mjs`);
  const tabelle = Object.fromEntries(tests.map((testdatei, i) => [testdatei, {
    laedt: ["src/a.mjs", ...(testdatei === lader ? ["README.md"] : [])],
    nennt: i < nenner && testdatei !== lader ? ["README.md"] : [],
  }]));
  return vorschlagErheben(
    { buildChecks: [{ cmd: "npm test", areas: ["a"] }] },
    messung(["README.md", "src/a.mjs", ...tests], tabelle, [beurteilbar(tests)]),
  );
}

test("E5: ein Pfad, den ein Viertel aller Tests und mindestens drei nennen und keiner laedt, ist Geruest-Kandidat", () => {
  assert.deepEqual(nennungen(8, 3).geruestKandidaten, [
    { pfad: "README.md", tests: ["test/t00.test.mjs", "test/t01.test.mjs", "test/t02.test.mjs"] },
  ]);
});

test("E5: Gegenprobe — zwei nennende Tests ergeben keinen Kandidaten", () => {
  assert.deepEqual(nennungen(4, 2).geruestKandidaten, []);
});

test("E5: Gegenprobe — weniger als ein Viertel oder ein ladender Test ergeben keinen Kandidaten", () => {
  assert.deepEqual(nennungen(16, 3).geruestKandidaten, []);
  assert.deepEqual(nennungen(8, 4, "test/t07.test.mjs").geruestKandidaten, []);
});

test("Darstellung: der Text endet mit einem kopierbaren JSON-Ausschnitt, JSON traegt dieselben Daten", () => {
  const vorschlag = vorschlagErheben(GRUNDFALL.config, GRUNDFALL.messung);

  const text = vorschlagText(vorschlag);
  const ausschnitt = text.slice(text.lastIndexOf("\n{\n") + 1);
  assert.deepEqual(JSON.parse(ausschnitt), vorschlag.ausschnitt);
  for (const bereich of vorschlag.bereiche) assert.ok(text.includes(bereich.name), bereich.name);

  assert.deepEqual(JSON.parse(alsJson(vorschlag)), JSON.parse(JSON.stringify(vorschlag)));
});

test("die Messung darf als Objekt statt als Map kommen", () => {
  const m = { ...GRUNDFALL.messung, tabelle: Object.fromEntries(GRUNDFALL.messung.tabelle) };

  assert.deepEqual(vorschlagErheben(GRUNDFALL.config, m), vorschlagErheben(GRUNDFALL.config, GRUNDFALL.messung));
});
