// Testfaelle einer Pruefgruppe festhalten und vergleichen (Issue #1690, Plan #1685, E5).
//
// `tools/testfaelle.mjs list` faehrt jede Datei der Gruppe mit `--test-reporter=tap` und
// schreibt die Liste; `compare` nennt jede Abweichung zweier Listen. Diese Datei prueft das
// Werkzeug im selben Prozess gegen einen injizierten Starter, der TAP-Text liefert — keine
// echte Testgruppe, kein Kindprozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertStellen, liste, tapLesen, vergleich, vergleichen } from "../tools/testfaelle.mjs";

function tapDatei(zeilen, dauerMs) {
  return ["TAP version 13", ...zeilen, `# duration_ms ${dauerMs}`, ""].join("\n");
}

function eintrag(einrueckung, nr, name, { art = "test", direktive = "", ok = true } = {}) {
  const pad = " ".repeat(einrueckung);
  const zusatz = direktive ? ` # ${direktive}` : "";
  return [
    `${pad}# Subtest: ${name}`,
    `${pad}${ok ? "ok" : "not ok"} ${nr} - ${name}${zusatz}`,
    `${pad}  ---`,
    `${pad}  duration_ms: 0.2`,
    `${pad}  type: '${art}'`,
    `${pad}  ...`,
  ];
}

const TAP_A = tapDatei([
  "# Subtest: Gruppe",
  ...eintrag(4, 1, "eins").slice(1),
  ...eintrag(4, 2, "zwei", { direktive: "SKIP" }),
  "    1..2",
  ...eintrag(0, 1, "Gruppe", { art: "suite" }).slice(1),
  ...eintrag(0, 2, "drei", { direktive: "TODO" }),
  ...eintrag(0, 3, String.raw`vier \# mit Raute`),
  "1..3",
], 41.5);

const TAP_B = tapDatei([...eintrag(0, 1, "allein"), "1..1"], 12.25);

function aufbau(quellen) {
  const basis = mkdtempSync(join(tmpdir(), "testfaelle-test-"));
  mkdirSync(join(basis, "test"));
  mkdirSync(join(basis, "ablage"));
  for (const [datei, text] of Object.entries(quellen)) writeFileSync(join(basis, datei), text);
  const aufrufe = [];
  const zeilen = [];
  const abh = {
    wurzel: basis,
    ablage: join(basis, "ablage"),
    jetzt: () => Date.UTC(2026, 9, 14, 12, 0, 0),
    dateienZu: (muster) => muster.flatMap((m) => (m === "test/*.test.mjs" ? ["test/b.test.mjs", "test/a.test.mjs"] : [])),
    starter: async (aufruf) => {
      aufrufe.push(aufruf);
      return { code: 0, ausgabe: aufruf.datei === "test/a.test.mjs" ? TAP_A : TAP_B };
    },
    ausgabe: (z) => zeilen.push(z),
  };
  return { basis, abh, aufrufe, zeilen, aufraeumen: () => rmSync(basis, { recursive: true, force: true }) };
}

test("tapLesen nennt je Test den vollen Namen, das Ergebnis und die Laufzeit der Datei", () => {
  const { tests, laufzeitMs } = tapLesen(TAP_A);
  assert.deepEqual(tests, [
    { name: "Gruppe > eins", ergebnis: "ok" },
    { name: "Gruppe > zwei", ergebnis: "skip" },
    { name: "drei", ergebnis: "todo" },
    { name: "vier # mit Raute", ergebnis: "ok" },
  ]);
  assert.equal(laufzeitMs, 41.5);
});

test("tapLesen nennt einen roten Test als fehler", () => {
  const { tests } = tapLesen(tapDatei([...eintrag(0, 1, "kaputt", { ok: false }), "1..1"], 3));
  assert.deepEqual(tests, [{ name: "kaputt", ergebnis: "fehler" }]);
});

test("assertStellen zaehlt die assert.-Aufrufstellen im Quelltext", () => {
  assert.equal(assertStellen("assert.equal(a, 1);\nassert.deepEqual (b, c); assert.ok(x)\nassert(y);\nconst assertx = 1;"), 3);
});

test("list faehrt jede Datei mit dem TAP-Reporter und schreibt eine sortierte Liste", async () => {
  const a = aufbau({
    "test/a.test.mjs": "assert.ok(1);\nassert.equal(2, 2);\n",
    "test/b.test.mjs": "assert.ok(1);\n",
  });
  try {
    const { exitCode, pfad } = await liste(["test/*.test.mjs"], a.abh);
    assert.equal(exitCode, 0);
    assert.deepEqual(a.aufrufe.map((x) => x.datei), ["test/a.test.mjs", "test/b.test.mjs"]);
    assert.ok(a.aufrufe.every((x) => x.cmd.includes("--test-reporter=tap")));
    assert.ok(pfad.startsWith(a.abh.ablage));
    assert.ok(a.zeilen.some((z) => z.includes(pfad)));
    const daten = JSON.parse(readFileSync(pfad, "utf-8"));
    assert.deepEqual(daten.dateien, [
      { datei: "test/a.test.mjs", laufzeitMs: 41.5, assertStellen: 2 },
      { datei: "test/b.test.mjs", laufzeitMs: 12.25, assertStellen: 1 },
    ]);
    assert.deepEqual(daten.tests.map((t) => `${t.datei}|${t.name}|${t.ergebnis}`), [
      "test/a.test.mjs|Gruppe > eins|ok",
      "test/a.test.mjs|Gruppe > zwei|skip",
      "test/a.test.mjs|drei|todo",
      "test/a.test.mjs|vier # mit Raute|ok",
      "test/b.test.mjs|allein|ok",
    ]);
    assert.equal(daten.skip, 1);
    assert.equal(daten.todo, 1);
  } finally {
    a.aufraeumen();
  }
});

test("list endet mit Exit 1, wenn ein Muster keine Datei trifft", async () => {
  const a = aufbau({});
  try {
    const { exitCode } = await liste(["gibt/es/nicht"], a.abh);
    assert.equal(exitCode, 1);
    assert.equal(a.aufrufe.length, 0);
  } finally {
    a.aufraeumen();
  }
});

test("list endet mit Exit 1, wenn eine Datei rot ist oder keinen Test nennt", async () => {
  const a = aufbau({ "test/a.test.mjs": "", "test/b.test.mjs": "" });
  a.abh.starter = async ({ datei }) => (datei === "test/a.test.mjs"
    ? { code: 1, ausgabe: tapDatei([...eintrag(0, 1, "kaputt", { ok: false }), "1..1"], 3) }
    : { code: 1, ausgabe: "SyntaxError: nichts" });
  try {
    const { exitCode, pfad } = await liste(["test/*.test.mjs"], a.abh);
    assert.equal(exitCode, 1);
    assert.ok(pfad, "die Liste wird trotzdem geschrieben");
    assert.ok(a.zeilen.some((z) => z.includes("test/a.test.mjs") && z.includes("kaputt")));
    assert.ok(a.zeilen.some((z) => z.includes("test/b.test.mjs") && z.includes("keinen Test")));
  } finally {
    a.aufraeumen();
  }
});

function listeVon(tests, dateien) {
  return {
    dateien,
    tests,
    skip: tests.filter((t) => t.ergebnis === "skip").length,
    todo: tests.filter((t) => t.ergebnis === "todo").length,
  };
}

const VORHER = listeVon(
  [
    { datei: "test/a.test.mjs", name: "eins", ergebnis: "ok" },
    { datei: "test/a.test.mjs", name: "zwei", ergebnis: "ok" },
    { datei: "test/b.test.mjs", name: "drei", ergebnis: "ok" },
  ],
  [
    { datei: "test/a.test.mjs", laufzeitMs: 100, assertStellen: 5 },
    { datei: "test/b.test.mjs", laufzeitMs: 50, assertStellen: 3 },
  ],
);

test("Szenario: Es wird nicht weniger geprüft", async (t) => {
  const basis = mkdtempSync(join(tmpdir(), "testfaelle-compare-"));
  const zeilen = [];
  const schreib = (name, daten) => {
    const pfad = join(basis, name);
    writeFileSync(pfad, JSON.stringify(daten));
    return pfad;
  };
  const vorher = schreib("vorher.json", VORHER);
  const lauf = (nachher) => {
    zeilen.length = 0;
    return vergleichen(vorher, schreib("nachher.json", nachher), { ausgabe: (z) => zeilen.push(z) });
  };
  try {
    await t.test("gleiche Listen enden mit Exit 0", () => {
      // Andere Laufzeit ist keine Abweichung, sie ist der Zweck der Beschleunigung.
      const nachher = structuredClone(VORHER);
      nachher.dateien[0].laufzeitMs = 10;
      assert.equal(lauf(nachher), 0);
    });

    await t.test("ein fehlender Test endet mit Exit 1", () => {
      const nachher = structuredClone(VORHER);
      nachher.tests.splice(1, 1);
      assert.equal(lauf(nachher), 1);
      assert.ok(zeilen.some((z) => z.includes("fehlt") && z.includes("test/a.test.mjs") && z.includes("zwei")));
    });

    await t.test("ein neu uebersprungener Test endet mit Exit 1", () => {
      const nachher = structuredClone(VORHER);
      nachher.tests[2].ergebnis = "skip";
      nachher.skip = 1;
      assert.equal(lauf(nachher), 1);
      assert.ok(zeilen.some((z) => z.includes("übersprungen") && z.includes("drei")));
    });

    await t.test("ein neu als offen markierter Test endet mit Exit 1", () => {
      const nachher = structuredClone(VORHER);
      nachher.tests[0].ergebnis = "todo";
      nachher.todo = 1;
      assert.equal(lauf(nachher), 1);
      assert.ok(zeilen.some((z) => z.includes("offen") && z.includes("eins")));
    });

    await t.test("eine Datei mit weniger assert.-Aufrufstellen endet mit Exit 1", () => {
      const nachher = structuredClone(VORHER);
      nachher.dateien[1].assertStellen = 2;
      assert.equal(lauf(nachher), 1);
      assert.ok(zeilen.some((z) => z.includes("test/b.test.mjs") && z.includes("3") && z.includes("2")));
    });
  } finally {
    rmSync(basis, { recursive: true, force: true });
  }
});

test("vergleich nennt jede Abweichung, auch einen neuen Test und einen roten", () => {
  const nachher = structuredClone(VORHER);
  nachher.tests.push({ datei: "test/b.test.mjs", name: "neu", ergebnis: "ok" });
  nachher.tests[0].ergebnis = "fehler";
  nachher.dateien[0].assertStellen = 9;
  const abweichungen = vergleich(VORHER, nachher);
  assert.equal(abweichungen.length, 2);
  assert.ok(abweichungen.some((z) => z.includes("neu") && z.includes("test/b.test.mjs")));
  assert.ok(abweichungen.some((z) => z.includes("rot") && z.includes("eins")));
});

test("vergleich zaehlt gleichnamige Tests einer Datei einzeln", () => {
  const vorher = listeVon(
    [
      { datei: "test/a.test.mjs", name: "doppelt", ergebnis: "ok" },
      { datei: "test/a.test.mjs", name: "doppelt", ergebnis: "ok" },
    ],
    [{ datei: "test/a.test.mjs", laufzeitMs: 1, assertStellen: 1 }],
  );
  const nachher = structuredClone(vorher);
  nachher.tests.pop();
  assert.equal(vergleich(vorher, nachher).length, 1);
});
