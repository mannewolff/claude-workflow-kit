// Meldungen zweisprachig, Gruppe kit/checks.mjs (Plan #1420 E13/E14).
//
// Das Pruefkommando traegt seine Texte an den Menschen in einer Tabelle TEXTE { de, en } und
// gibt sie ueber den Texthelfer aus kit/board/namen.mjs aus:
//   - Paritaet: dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben: ein englisches Projekt sieht die englische Form.
//   - Die deutschen Wortlaut-Tests (test/checks-*.test.mjs, test/ablauf-checks-*.test.mjs)
//     bleiben, wie sie sind, und laufen mit der Vorgabe Deutsch.
// Vertrag bleibt (E14): die JSON-Felder von plan und der Zusammenfassung, die Ergebniswerte,
// die Stufen- und Achsenwerte der Config und die Marke `Pruefung festgefahren:`.
//
// Das Paket #1451 ist in drei Teile geschnitten. Der erste (#1494) deckt kit/checks.mjs vom
// Dateianfang bis vor `verteilen`; die Teile #1495 und #1496 ergaenzen diese Datei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TEXTE as CHECKS_TEXTE, FESTGEFAHREN_MARKE, aufrufen } from "../kit/checks.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { mitRepo, plan, run, checks, datei, git, eintrag } from "./helpers/checks-repo.mjs";
import { deutschAmHelferVorbei, deutschImEnglischen } from "./helpers/quelltext-texte.mjs";

/** Fuehrt `fn` mit der Prozesssprache `sprache` aus und vergisst sie danach wieder. */
async function inSprache(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return await fn();
  } finally {
    spracheFestlegen(null);
  }
}

/** Der Fehlertext eines gescheiterten Aufrufs ohne den Zeilenumbruch. */
function fehler(res) {
  assert.equal(res.status, 1, `erwartet Exit 1, war ${res.status}: ${res.stdout}`);
  return res.stderr.trim();
}

const GRUEN = (name) => `node -e "process.exit(0)" # ${name}`;

// --- kit/checks.mjs, Teil 1: bis vor verteilen (Issue #1494) --------------------------

test("[1494] die Texttabelle des Pruefkommandos hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(CHECKS_TEXTE), []);
  assert.ok(Object.keys(CHECKS_TEXTE.de).length >= 25, "die Tabelle traegt die Meldungen des ersten Teils");
});

test("[1494] die englische Haelfte der Tabelle traegt keine deutschen Woerter", () => {
  assert.deepEqual(deutschImEnglischen(CHECKS_TEXTE), []);
});

test("[1494] bis vor verteilen geht jeder deutsche Text ueber den Texthelfer", () => {
  assert.deepEqual(deutschAmHelferVorbei("kit/checks.mjs", CHECKS_TEXTE, [FESTGEFAHREN_MARKE, "nicht gestartet", "bereiche | ohne-bereich | ohne-zuordnung | veroeffentlichung | anker"],
    { bis: "function verteilen(" }), []);
});

test("[1494] englisch: die Nutzungshilfe nennt die englischen Befehls- und Optionsnamen", async () => {
  const leer = mkdtempSync(join(tmpdir(), "checks-hilfe-"));
  try {
    const res = await inSprache("en", () => aufrufen(["--help"], { cwd: leer }));
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^checks\.mjs \(claude-workflow-kit v[\d.]+\) — due checks\n/);
    for (const name of ["node checks.mjs areas", "--stage <s>", "--area <n>", "--finish [n]", "--retry", "--fresh", "--in <path>"]) {
      assert.ok(res.stdout.includes(name), `die Hilfe nennt ${name}`);
    }
    assert.ok(res.stdout.includes("notAtCompletion: interplay | fullTestSet"), "die Achse mit ihren englischen Werten");
    assert.ok(res.stdout.includes("'kind': hint"), "die Art mit ihrem englischen Wert");
    assert.ok(res.stdout.includes(`'${FESTGEFAHREN_MARKE} <command> — <error>'`), "die Marke bleibt Vertrag");
    assert.doesNotMatch(res.stdout, /faellige Pruefungen|Gelesen wird/);
  } finally {
    rmSync(leer, { recursive: true, force: true });
  }
});

test("[1494] englisch: die fehlende und die kaputte Config", async () => {
  const leer = mkdtempSync(join(tmpdir(), "checks-ohne-config-"));
  try {
    await inSprache("en", () => {
      assert.equal(fehler(aufrufen(["plan"], { cwd: leer })),
        `Error: No .claude/workflow.config.json under ${leer} — please start in the project root.`);
      mkdirSync(join(leer, ".claude"));
      writeFileSync(join(leer, ".claude", "workflow.config.json"), "{ kaputt");
      assert.match(fehler(aufrufen(["plan"], { cwd: leer })), /^Error: \.claude\/workflow\.config\.json is not valid JSON: /);
    });
  } finally {
    rmSync(leer, { recursive: true, force: true });
  }
});

test("[1494] englisch: unbekannte Werte in buildChecks", async () => {
  const faelle = [
    [{ buildChecks: [{ cmd: "a", nichtBeimAbschluss: "nie" }] },
      "Error: Unknown value 'nie' for notAtCompletion on check 'a'. Expected: interplay, fullTestSet."],
    [{ buildChecks: [{ cmd: "a", art: 3 }] }, "Error: Unknown value 3 for kind on check 'a'. Expected: hint."],
    [{ buildChecks: [{ cmd: "a", areas: ["x"] }], checkAreas: {} },
      "Error: Unknown area 'x' on check 'a'. Known from checkAreas: none."],
    [{ buildChecks: [{ cmd: "a", areas: ["x"] }], checkAreas: { y: ["y/**"] } },
      "Error: Unknown area 'x' on check 'a'. Known from checkAreas: y."],
  ];
  for (const [config, erwartet] of faelle) {
    await mitRepo({ config }, (dir) => inSprache("en", () => assert.equal(fehler(checks(dir, "plan")), erwartet)));
  }
});

test("[1494] englisch: die Grenzen der Guetemessung und der Abschluss-Achse", async () => {
  const guete = { muster: "x", marke: "y" };
  const faelle = [
    [{ buildChecks: [{ cmd: "a", guete }, { cmd: "b", guete }] }, [],
      "Error: More than one quality measurement: 'a', 'b' all carry 'quality' — at most one entry may measure."],
    [{ buildChecks: [{ cmd: "a", guete, stufe: "merge" }, "b"] }, [],
      "Error: The quality measurement 'a' carries stage 'merge' — a measurement only before the release would come too late. "
      + "Allowed: package, push."],
    [{ buildChecks: [{ cmd: "a", stufe: "push", nichtBeimAbschluss: "zusammenspiel" }, "b"] }, [],
      "Error: The check 'a' carries notAtCompletion and stage 'push' — there it does not run at completion anyway. "
      + "The axis applies to the stage 'package'."],
    [{ buildChecks: [{ cmd: "a", nichtBeimAbschluss: "zusammenspiel" }] }, ["--abschluss"],
      "Error: No entry of the stage 'package' runs at completion: each carries notAtCompletion or a quality block. "
      + "So the completion of a work package has no gate."],
  ];
  for (const [config, schalter, erwartet] of faelle) {
    await mitRepo({ config }, (dir) => inSprache("en", () => assert.equal(fehler(checks(dir, "plan", ...schalter)), erwartet)));
  }
});

test("[1494] englisch: zwei Aufrufe zugleich gehen nicht", async () => {
  await mitRepo({ config: { buildChecks: [GRUEN("a")] } }, async (dir) => {
    await inSprache("en", async () => {
      const laufend = run(dir);
      assert.throws(() => aufrufen(["plan"], { cwd: dir }),
        { message: "checks.mjs: aufrufen is already running — two calls at the same time are not possible" });
      await laufend;
    });
  });
});

test("[1494] englisch: die Gruende der Auswahl nach Bereichen", async () => {
  const config = {
    buildChecks: [
      { cmd: GRUEN("immer"), always: true },
      GRUEN("frei"),
      { cmd: GRUEN("a"), areas: ["a"] },
      { cmd: GRUEN("ab"), areas: ["a", "b"] },
      { cmd: GRUEN("b"), areas: ["b"] },
      { cmd: GRUEN("bc"), areas: ["b", "c"] },
    ],
    checkAreas: { a: ["src/a.mjs"], b: ["src/b.mjs"], c: ["src/c.mjs"] },
  };
  await mitRepo({ config }, (dir) => inSprache("en", () => {
    datei(dir, "src/a.mjs", "export const a = 1;\n");
    const ergebnis = plan(dir);
    assert.equal(eintrag(ergebnis.laufen, GRUEN("immer")).grund, "set to always run");
    assert.equal(eintrag(ergebnis.laufen, GRUEN("frei")).grund, "not assigned");
    assert.equal(eintrag(ergebnis.laufen, GRUEN("a")).grund, "area a touched");
    assert.equal(eintrag(ergebnis.laufen, GRUEN("ab")).grund, "area a touched");
    assert.equal(eintrag(ergebnis.ausgelassen, GRUEN("b")).grund, "area b untouched");
    assert.equal(eintrag(ergebnis.ausgelassen, GRUEN("bc")).grund, "areas b, c untouched");
  }));
});

test("[1494] englisch: der volle Umfang wegen Dateien ohne Muster", async () => {
  const config = { buildChecks: [{ cmd: GRUEN("a"), areas: ["a"] }], checkAreas: { a: ["src/a.mjs"] } };
  await mitRepo({ config }, (dir) => inSprache("en", () => {
    datei(dir, "notiz.txt");
    assert.equal(plan(dir).laufen[0].grund, "full scope: 'notiz.txt' matches no pattern");
    for (let i = 0; i < 11; i += 1) datei(dir, `n${String(i).padStart(2, "0")}.txt`);
    assert.match(plan(dir).laufen[0].grund, /^full scope: 'n00\.txt', .+ and 2 more match no pattern$/);
  }));
});

test("[1494] englisch: die Ableitung aus den Importen", async () => {
  const config = {
    buildChecks: [{ cmd: GRUEN("a"), areas: ["a"] }, { cmd: GRUEN("b"), areas: ["b"] }],
    checkAreas: { a: ["src/a.mjs"], b: ["src/b.mjs"] },
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/a.mjs", "export const a = 1;\n");
    datei(dir, "src/b.mjs", 'import { a } from "./a.mjs";\nexport const b = a;\n');
    datei(dir, "src/helfer.mjs", "export const h = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "stand");
    datei(dir, "src/a.mjs", "export const a = 2;\n");
    datei(dir, "src/neu.mjs", "export const n = 1;\n");
    await inSprache("en", async () => {
      const ergebnis = plan(dir);
      assert.deepEqual(ergebnis.ohnePruefung, [{ pfad: "src/neu.mjs", grund: "not imported by any file" }]);
      const res = await run(dir);
      assert.ok(res.stdout.includes("area b touched via import of src/a.mjs"), res.stdout);
      assert.ok(res.stdout.includes("no check: src/neu.mjs — not imported by any file"), res.stdout);
    });
  });
});

test("[1494] ohne Spracheinstellung bleiben die Meldungen deutsch", async () => {
  const leer = mkdtempSync(join(tmpdir(), "checks-deutsch-"));
  try {
    assert.match(aufrufen(["--help"], { cwd: leer }).stdout, /— faellige Pruefungen\n/);
    assert.equal(fehler(aufrufen(["plan"], { cwd: leer })),
      `Fehler: Keine .claude/workflow.config.json unter ${leer} — bitte im Projekt-Root starten.`);
  } finally {
    rmSync(leer, { recursive: true, force: true });
  }
  const config = { buildChecks: [{ cmd: GRUEN("a"), areas: ["a"] }], checkAreas: { a: ["src/a.mjs"] } };
  await mitRepo({ config }, (dir) => {
    datei(dir, "notiz.txt");
    assert.equal(plan(dir).laufen[0].grund, "voller Umfang: 'notiz.txt' trifft kein Muster");
  });
});
