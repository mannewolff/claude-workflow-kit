// Die festgefahrene Pruefung (Issue #1388, Plan #1386, E1–E6, E11, E12; fachliche Quelle #1343).
//
// `checks.mjs` zaehlt je Pruefung die gleich gescheiterten echten Laeufe im Feld
// `festgefahren` der Zusammenfassung. Unbeaufsichtigt (`KIT_AGENT_MODEL` gesetzt) faehrt der
// naechste Aufruf nach dem letzten erlaubten gleichen Fehlschlag nichts mehr: Bremsmarke,
// Exitcode 3, die vorige Zusammenfassung bleibt stehen und bekommt allein
// `festgefahren.ausgeloest`. Interaktiv gibt derselbe Stand nur eine Hinweiszeile auf stderr.
//
// Geprueft wird an der Wirkung wie in `checks-rote-zuerst.test.mjs`: Jedes Kommando haengt
// seinen Namen an ein Protokoll unter `.claude/` und scheitert, solange `.claude/rot-<name>`
// liegt — mit dem Inhalt dieser Datei als Ausgabe. So bestimmt der Test, auf welche Weise
// eine Pruefung scheitert, ohne den Stand zu beruehren.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  mitRepo, checksMit, zusammenfassung, datei, eintrag,
} from "./helpers/checks-repo.mjs";
import { fehlschlagAbdruck, festgefahrenNach, FESTGEFAHREN_MARKE } from "../kit/checks.mjs";

// --- fehlschlagAbdruck ------------------------------------------------------

test("Abdruck node:test TAP: die gescheiterten Testnamen, sortiert und ohne Dauer", () => {
  const ausgabe = [
    "TAP version 13",
    "# Subtest: zweiter",
    "not ok 2 - zweiter",
    "  ---",
    "  duration_ms: 12.345",
    "  ...",
    "ok 3 - gruen",
    "    not ok 1 - erster # SKIP",
    "not ok 4 - zweiter",
  ].join("\n");
  assert.equal(fehlschlagAbdruck(ausgabe), "erster | zweiter");
});

test("Abdruck node:test Spec: die Zeilen mit ✖, ohne die Kopfzeile der Zusammenfassung", () => {
  const ausgabe = [
    "▶ gruppe",
    "  ✔ geht (1.2ms)",
    "  ✖ geht nicht (3.456ms)",
    "✖ gruppe (5.1ms)",
    "ℹ tests 2",
    "✖ failing tests:",
    "",
    "test at test/x.test.mjs:3:1",
    "✖ geht nicht (3.456ms)",
  ].join("\n");
  assert.equal(fehlschlagAbdruck(ausgabe), "geht nicht | gruppe");
});

test("Abdruck Jest und Vitest: ✕, × und ●", () => {
  const jest = [
    "FAIL src/a.test.js",
    "  ✓ geht (3 ms)",
    "  ✕ rechnet falsch (12 ms)",
    "  ● Rechner › rechnet falsch",
    "    expect(received).toBe(expected)",
  ].join("\n");
  assert.equal(fehlschlagAbdruck(jest), "Rechner › rechnet falsch | rechnet falsch");
  const vitest = [" × teilt durch null 4ms", " ✓ addiert 1ms"].join("\n");
  assert.equal(fehlschlagAbdruck(vitest), "teilt durch null");
});

test("Abdruck Maven Surefire: <<< FAILURE! und <<< ERROR!", () => {
  const ausgabe = [
    "[INFO] Running org.x.RechnerTest",
    "[ERROR] Tests run: 3, Failures: 1, Errors: 1, Skipped: 0, Time elapsed: 0.123 s <<< FAILURE! -- in org.x.RechnerTest",
    "[ERROR] org.x.RechnerTest.addiert -- Time elapsed: 0.01 s <<< FAILURE!",
    "[ERROR] teilt(org.x.RechnerTest)  Time elapsed: 0.002 s  <<< ERROR!",
    "[ERROR] BUILD FAILURE",
  ].join("\n");
  assert.equal(fehlschlagAbdruck(ausgabe), "org.x.RechnerTest | org.x.RechnerTest.addiert | teilt(org.x.RechnerTest)");
});

test("Abdruck ohne Testnamen: die erste Zeile mit Fehlerkennung, sonst die erste nicht leere", () => {
  assert.equal(fehlschlagAbdruck("baue …\nsrc/a.ts(3,1): error TS2304: Cannot find name 'x'.\nnoch was"),
    "src/a.ts(3,1): error TS2304: Cannot find name 'x'.");
  assert.equal(fehlschlagAbdruck("los\nFehler: kaputt\n"), "Fehler: kaputt");
  assert.equal(fehlschlagAbdruck("los\nlint FAILED\n"), "lint FAILED");
  assert.equal(fehlschlagAbdruck("los\nBUILD FAILURE\n"), "BUILD FAILURE", "ein Treffer aus FEHLERMERKMALE");
  assert.equal(fehlschlagAbdruck("\n\n  erste Zeile  \nzweite\n"), "erste Zeile");
});

test("Abdruck normalisiert Zeitstempel, Uhrzeit, Dauer, temporaere Pfade und Zufallswerte", () => {
  const a = fehlschlagAbdruck(
    "2026-10-09T12:00:01.123Z 12:00:01 error in /tmp/abc123/x.js nach 12ms, "
    + "id 1b4e28ba-2fa1-11d2-883f-0016d3cca427, hash deadbeef01, Datei /var/folders/q1/T/y.js 1.3s",
  );
  const b = fehlschlagAbdruck(
    "2026-10-10T08:59:59Z 08:59:59 error in /tmp/zz9/x.js nach 345ms, "
    + "id 9a4e28ba-2fa1-11d2-883f-0016d3cca999, hash 0123456789abcdef, Datei /var/folders/zz/T/y.js 2.7s",
  );
  assert.equal(a, b);
  assert.doesNotMatch(a, /12ms|deadbeef|1b4e28ba|abc123/);
  const c = fehlschlagAbdruck("error in /eigen/tmpdir/x.js", { tmpdir: "/eigen/tmpdir" });
  const d = fehlschlagAbdruck("error in /eigen/tmpdir/y.js", { tmpdir: "/eigen/tmpdir" });
  assert.equal(c, d, "der Pfad unter $TMPDIR zaehlt nicht");
});

// --- festgefahrenNach -------------------------------------------------------

test("festgefahrenNach: gleicher Abdruck +1, gruen oder anderer Abdruck setzt zurueck, nicht gefahren bleibt", () => {
  const eins = festgefahrenNach(undefined, [
    { cmd: "a", ergebnis: "rot", fehler: "x" },
    { cmd: "b", ergebnis: "rot", fehler: "y" },
  ]);
  assert.deepEqual(eins.folgen, { a: { fehler: "x", versuche: 1 }, b: { fehler: "y", versuche: 1 } });
  const zwei = festgefahrenNach(eins, [
    { cmd: "a", ergebnis: "rot", fehler: "x" },
    { cmd: "b", ergebnis: "nicht gestartet" },
    { cmd: "c", ergebnis: "gruen" },
  ]);
  assert.deepEqual(zwei.folgen, { a: { fehler: "x", versuche: 2 }, b: { fehler: "y", versuche: 1 } });
  const drei = festgefahrenNach({ ...zwei, ausgeloest: { pruefung: "a" } }, [
    { cmd: "a", ergebnis: "rot", fehler: "anders" },
    { cmd: "b", ergebnis: "gruen" },
  ]);
  assert.deepEqual(drei, { folgen: { a: { fehler: "anders", versuche: 1 } } });
});

// --- Laeufe -------------------------------------------------------------------

const A = "node .claude/k.mjs a";
const B = "node .claude/k.mjs b";

const CONFIG = {
  buildChecks: [
    { cmd: A, areas: ["kern"] },
    { cmd: B, areas: ["kern"] },
  ],
  checkAreas: { kern: ["src/**"] },
};

const UNBEAUFSICHTIGT = { KIT_AGENT_MODEL: "claude-sonnet-5-5" };
const INTERAKTIV = { KIT_AGENT_MODEL: "" };

function kommandoAnlegen(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "k.mjs"), [
    "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
    "const name = process.argv[2];",
    String.raw`appendFileSync('.claude/protokoll.txt', name + '\n');`,
    "const rot = '.claude/rot-' + name;",
    "if (existsSync(rot)) { process.stdout.write(readFileSync(rot, 'utf-8')); process.exit(1); }",
    "",
  ].join("\n"), "utf-8");
}

let dauern = 0;
/** `name` scheitert ab jetzt mit dieser Ausgabe; die Dauer wechselt, der Test nicht. */
function scheitert(dir, name, test = "rechnet") {
  dauern += 37;
  const ms = (dauern % 900) + 1;
  writeFileSync(join(dir, ".claude", `rot-${name}`), `not ok 1 - ${test}\n  duration_ms: ${ms}.5\n`, "utf-8");
}

function gruen(dir, name) {
  rmSync(join(dir, ".claude", `rot-${name}`), { force: true });
}

function gefahren(dir) {
  const pfad = join(dir, ".claude", "protokoll.txt");
  let zeilen = [];
  try {
    zeilen = readFileSync(pfad, "utf-8").split("\n").filter(Boolean);
  } catch { /* noch nichts gelaufen */ }
  rmSync(pfad, { force: true });
  return zeilen;
}

let staende = 0;
/** Eine Aenderung am Stand: Ohne sie uebernaehme `run` das vorige Ergebnis. */
function aendern(dir) {
  staende += 1;
  datei(dir, "src/a.txt", `Stand ${staende}\n`);
}

function lauf(dir, env, ...args) {
  return checksMit(dir, { env }, "run", ...args);
}

async function mitAufbau(fn, config = CONFIG) {
  await mitRepo({ config }, async (dir) => {
    kommandoAnlegen(dir);
    datei(dir, "src/a.txt");
    await fn(dir);
  });
}

const folge = (dir, cmd) => zusammenfassung(dir).festgefahren?.folgen?.[cmd];

test("Zaehlung je Pruefung ueber Abschluss-, Bereichs- und Teillauf; laufen[].fehler traegt den Abdruck", async () => {
  await mitAufbau(async (dir) => {
    scheitert(dir, "a");
    const erster = await lauf(dir, INTERAKTIV, "--abschluss", "7");
    assert.equal(erster.status, 1, erster.stdout);
    assert.equal(eintrag(zusammenfassung(dir).laufen, A).fehler, "rechnet");
    assert.deepEqual(folge(dir, A), { fehler: "rechnet", versuche: 1 });

    aendern(dir);
    scheitert(dir, "a");
    await lauf(dir, INTERAKTIV, "--bereich", "kern");
    assert.equal(folge(dir, A).versuche, 2, "der Bereichslauf zaehlt mit");

    aendern(dir);
    scheitert(dir, "a");
    const teil = await lauf(dir, INTERAKTIV, "--bereich", "kern");
    assert.match(teil.stdout, /Teillauf/);
    assert.equal(folge(dir, A).versuche, 3, "der Teillauf zaehlt mit");
    const keys = Object.keys(zusammenfassung(dir));
    assert.equal(keys.at(-1), "festgefahren", "das Feld steht hinten");
  });
});

test("eine Uebernahme zaehlt nicht und reicht das Feld unveraendert weiter", async () => {
  await mitAufbau(async (dir) => {
    scheitert(dir, "a");
    await lauf(dir, INTERAKTIV);
    const vorher = zusammenfassung(dir).festgefahren;
    const zweiter = await lauf(dir, INTERAKTIV);
    assert.match(zweiter.stdout, /Ergebnis uebernommen/);
    assert.deepEqual(zusammenfassung(dir).festgefahren, vorher);
  });
});

test("ein gruenes anderes Kommando unterbricht die Folge nicht; nicht gestartet zaehlt nicht", async () => {
  await mitAufbau(async (dir) => {
    scheitert(dir, "b");
    await lauf(dir, INTERAKTIV, "--frisch");
    aendern(dir);
    await lauf(dir, INTERAKTIV, "--frisch");
    const z = zusammenfassung(dir);
    assert.equal(eintrag(z.laufen, A).ergebnis, "gruen");
    assert.deepEqual(folge(dir, B), { fehler: "rechnet", versuche: 2 });
    assert.equal(folge(dir, A), undefined);

    // a rot bricht vor b ab: b bleibt nicht gestartet und behaelt seine Folge.
    aendern(dir);
    scheitert(dir, "a");
    await lauf(dir, INTERAKTIV, "--frisch");
    assert.equal(eintrag(zusammenfassung(dir).laufen, B).ergebnis, "nicht gestartet");
    assert.deepEqual(folge(dir, B), { fehler: "rechnet", versuche: 2 });
  });
});

test("gruen oder ein anderer gescheiterter Test derselben Pruefung setzt die Folge zurueck", async () => {
  await mitAufbau(async (dir) => {
    scheitert(dir, "a");
    await lauf(dir, INTERAKTIV);
    aendern(dir);
    scheitert(dir, "a");
    await lauf(dir, INTERAKTIV);
    assert.equal(folge(dir, A).versuche, 2);

    aendern(dir);
    scheitert(dir, "a", "anderer Test");
    await lauf(dir, INTERAKTIV);
    assert.deepEqual(folge(dir, A), { fehler: "anderer Test", versuche: 1 });

    aendern(dir);
    gruen(dir, "a");
    await lauf(dir, INTERAKTIV);
    assert.equal(folge(dir, A), undefined);
  });
});

/** Drei gleiche Fehlschlaege von `a`, jeder nach einer Aenderung am Stand. */
async function dreimalGleich(dir, env) {
  const ergebnisse = [];
  for (let i = 0; i < 3; i += 1) {
    aendern(dir);
    scheitert(dir, "a");
    ergebnisse.push(await lauf(dir, env, "--abschluss", "7"));
  }
  return ergebnisse;
}

test("unbeaufsichtigt: der letzte erlaubte Versuch wird angekuendigt, der naechste bremst mit Exit 3", async () => {
  await mitAufbau(async (dir) => {
    const ergebnisse = await dreimalGleich(dir, UNBEAUFSICHTIGT);
    assert.deepEqual(ergebnisse.map((e) => e.status), [1, 1, 1]);
    assert.doesNotMatch(ergebnisse[1].stdout + ergebnisse[1].stderr, /letzter erlaubter Versuch/i);
    assert.match(ergebnisse[2].stderr, /letzter erlaubter Versuch/i);
    gefahren(dir);
    const vorige = zusammenfassung(dir);

    aendern(dir);
    const bremse = await lauf(dir, UNBEAUFSICHTIGT, "--abschluss", "7");
    assert.equal(bremse.status, 3, bremse.stdout + bremse.stderr);
    assert.ok(bremse.stdout.includes(`${FESTGEFAHREN_MARKE} ${A}`), bremse.stdout);
    assert.ok(bremse.stdout.includes("rechnet"), "die Bremsmarke nennt den Fehler");
    assert.deepEqual(gefahren(dir), [], "kein Kommando gefahren");

    const z = zusammenfassung(dir);
    for (const feld of ["laufen", "hashes", "configHash", "zeitpunkt", "abgeschlossen"]) {
      assert.deepEqual(z[feld], vorige[feld], `${feld} bleibt das der vorigen Zusammenfassung`);
    }
    assert.deepEqual(z.festgefahren.folgen, vorige.festgefahren.folgen);
    const { pruefung, fehler, versuche, zeitpunkt } = z.festgefahren.ausgeloest;
    assert.equal(pruefung, A);
    assert.equal(fehler, "rechnet");
    assert.equal(versuche, 3);
    assert.ok(!Number.isNaN(Date.parse(zeitpunkt)));

    const frisch = await lauf(dir, UNBEAUFSICHTIGT, "--frisch");
    assert.equal(frisch.status, 3, "auch --frisch bremst");
    assert.deepEqual(gefahren(dir), []);
  });
});

test("interaktiv: Hinweiszeile auf stderr ab dem letzten erlaubten Fehlschlag, kein Eintrag in hinweise, Exit 1", async () => {
  await mitAufbau(async (dir) => {
    const ergebnisse = await dreimalGleich(dir, INTERAKTIV);
    assert.doesNotMatch(ergebnisse[1].stderr, /festgefahren/);
    const zeile = `Hinweis: festgefahren an ${A} — 3-mal gleich gescheitert (rechnet)`;
    assert.ok(ergebnisse[2].stderr.includes(zeile), ergebnisse[2].stderr);
    assert.equal(ergebnisse[2].status, 1);
    assert.deepEqual(zusammenfassung(dir).hinweise, []);

    aendern(dir);
    scheitert(dir, "a");
    const vierter = await lauf(dir, INTERAKTIV, "--abschluss", "7");
    assert.equal(vierter.status, 1, "interaktiv bremst nichts");
    assert.ok(vierter.stderr.includes(`Hinweis: festgefahren an ${A} — 4-mal gleich gescheitert (rechnet)`));
    assert.equal(zusammenfassung(dir).festgefahren.ausgeloest, undefined);
  });
});

test("die Grenze kommt aus night.festgefahrenNach", async () => {
  await mitAufbau(async (dir) => {
    aendern(dir);
    scheitert(dir, "a");
    await lauf(dir, UNBEAUFSICHTIGT);
    aendern(dir);
    scheitert(dir, "a");
    const zweiter = await lauf(dir, UNBEAUFSICHTIGT);
    assert.equal(zweiter.status, 1);
    assert.match(zweiter.stderr, /letzter erlaubter Versuch/i);
    aendern(dir);
    const bremse = await lauf(dir, UNBEAUFSICHTIGT);
    assert.equal(bremse.status, 3);
  }, { ...CONFIG, night: { festgefahrenNach: 2 } });
});

test("ohne Feld gilt die Vorgabe 3: nach zwei gleichen Fehlschlaegen bremst nichts", async () => {
  await mitAufbau(async (dir) => {
    for (let i = 0; i < 2; i += 1) {
      aendern(dir);
      scheitert(dir, "a");
      await lauf(dir, UNBEAUFSICHTIGT);
    }
    aendern(dir);
    scheitert(dir, "a");
    const dritter = await lauf(dir, UNBEAUFSICHTIGT);
    assert.equal(dritter.status, 1, "der dritte faehrt noch");
    assert.deepEqual(gefahren(dir), ["a", "a", "a"]);
  });
});
