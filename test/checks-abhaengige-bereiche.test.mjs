// Abhaengige Bereiche aus dem Importgraphen (Issue #1208, Plan #1199, E3, E16).
//
// Zerfallen Nacht-Runner und Board-Werkzeug in Teile, muss eine Aenderung an Teil A auch
// die Pruefungen der Teile ausloesen, die A importieren — sonst wird zu wenig geprueft,
// und das ist die unsichere Richtung. Die Kette laeuft transitiv und Datei fuer Datei:
// Wer eine geaenderte Datei importiert, ob direkt oder ueber andere, ist betroffen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, plan, run, datei, git, kommandos, zusammenfassung } from "./helpers/checks-repo.mjs";

/** Ein gruenes Kommando, das nur seinen Bereich traegt. */
function kommando(bereich) {
  return `node -e "process.exit(0)" # ${bereich}`;
}

function config(bereiche) {
  return {
    buildChecks: bereiche.map((bereich) => ({ cmd: kommando(bereich), areas: [bereich] })),
    checkAreas: Object.fromEntries(bereiche.map((bereich) => [bereich, [`src/${bereich}.mjs`]])),
  };
}

const KETTE = config(["a", "b", "c"]);

function committen(dir) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "stand");
}

/** Die Kette A ← B ← C: C importiert B, B importiert A. */
function kette(dir, { cDynamisch = false } = {}) {
  datei(dir, "src/a.mjs", "export const a = 1;\n");
  datei(dir, "src/b.mjs", 'import { a } from "./a.mjs";\nexport const b = a;\n');
  datei(dir, "src/c.mjs", cDynamisch
    ? 'const { b } = await import("./b.mjs");\nexport const c = b;\n'
    : 'import { b } from "./b.mjs";\nexport const c = b;\n');
  committen(dir);
}

test("eine Aenderung an A trifft A, B und C", () => {
  mitRepo({ config: KETTE }, (dir) => {
    kette(dir);
    datei(dir, "src/a.mjs", "export const a = 2;\n");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.bereiche, ["a", "b", "c"]);
    assert.deepEqual(kommandos(ergebnis.laufen), [kommando("a"), kommando("b"), kommando("c")]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), []);
    assert.deepEqual(ergebnis.abhaengig, [
      { bereich: "b", ueber: "src/a.mjs" },
      { bereich: "c", ueber: "src/b.mjs" },
    ]);
  });
});

test("eine Aenderung an C trifft nur C", () => {
  mitRepo({ config: KETTE }, (dir) => {
    kette(dir);
    datei(dir, "src/c.mjs", 'import { b } from "./b.mjs";\nexport const c = b + 1;\n');

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["c"]);
    assert.deepEqual(kommandos(ergebnis.laufen), [kommando("c")]);
    assert.equal(ergebnis.abhaengig, undefined);
  });
});

test("ein Zyklus zwischen zwei Bereichen terminiert", () => {
  mitRepo({ config: KETTE }, (dir) => {
    datei(dir, "src/a.mjs", 'import { b } from "./b.mjs";\nexport const a = 1;\n');
    datei(dir, "src/b.mjs", 'import { a } from "./a.mjs";\nexport const b = 1;\n');
    datei(dir, "src/c.mjs", "export const c = 1;\n");
    committen(dir);
    datei(dir, "src/a.mjs", 'import { b } from "./b.mjs";\nexport const a = 2;\n');

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["a", "b"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), [kommando("c")]);
  });
});

test("ein literaler dynamischer Import zaehlt", () => {
  mitRepo({ config: KETTE }, (dir) => {
    kette(dir, { cDynamisch: true });
    datei(dir, "src/b.mjs", 'import { a } from "./a.mjs";\nexport const b = a + 1;\n');

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["b", "c"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), [kommando("a")]);
  });
});

test("ein gemeinsamer Teil waehlt alle, und jede Berichtszeile nennt den Importweg", () => {
  mitRepo({ config: config(["grundlagen", "x", "y", "z"]) }, (dir) => {
    datei(dir, "src/grundlagen.mjs", "export const g = 1;\n");
    for (const teil of ["x", "y", "z"]) {
      datei(dir, `src/${teil}.mjs`, `import { g } from "./grundlagen.mjs";\nexport const ${teil} = g;\n`);
    }
    committen(dir);
    datei(dir, "src/grundlagen.mjs", "export const g = 2;\n");

    const ergebnis = plan(dir);
    assert.deepEqual(ergebnis.bereiche, ["grundlagen", "x", "y", "z"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), []);

    const res = run(dir);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const zeilen = zusammenfassung(dir).berichtszeilen;
    for (const teil of ["x", "y", "z"]) {
      assert.ok(zeilen.includes(`Bereich ${teil} beruehrt ueber Import von src/grundlagen.mjs`), JSON.stringify(zeilen));
    }
    assert.match(res.stdout, /Fuer den Abschlussbericht:[\s\S]*Bereich x beruehrt ueber Import von src\/grundlagen\.mjs/);
  });
});

test("eine Datei ohne Muster bleibt beim vollen Umfang mit Grund", () => {
  mitRepo({ config: KETTE }, (dir) => {
    kette(dir);
    datei(dir, "src/c.mjs", 'import { b } from "./b.mjs";\nexport const c = b + 1;\n');
    datei(dir, "daten.txt", "ohne Muster\n");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(kommandos(ergebnis.laufen), [kommando("a"), kommando("b"), kommando("c")]);
    for (const eintrag of ergebnis.laufen) {
      assert.equal(eintrag.grund, "voller Umfang: 'daten.txt' trifft kein Muster");
    }
  });
});
