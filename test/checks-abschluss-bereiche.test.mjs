// Die Auswahl beim Abschluss mit `abschlussBereiche` (Issue #1531, Plan #1529, E3–E5).
//
// Ein Eintrag mit `nichtBeimAbschluss` faellt beim Abschluss einer Karte heraus. Traegt er
// `abschlussBereiche`, laeuft er dort doch, wenn das Paket einen dieser Bereiche DIREKT
// beruehrt: ueber ein Muster oder ueber die Ableitung einer Datei ohne Muster aus ihren
// Importeuren. Ein Bereich, der nur ueber die abhaengigen Bereiche (Issue #1208)
// dazukommt, zaehlt nicht, ebenso wenig eine Datei, die nur Blobs und Stempel aendert.
// Ohne Dateiliste (Anker nicht aufloesbar) und beim leeren Paket entscheidet die normale
// Auswahl.
//
// Die Fixture: Bereich a importiert c, und a importiert einen Helfer ohne Muster.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, plan, run, datei, git, eintrag, kommandos } from "./helpers/checks-repo.mjs";

const ZUSAMMENSPIEL = "echo zusammenspiel";

function config({ mitFeld = true } = {}) {
  const zusammenspiel = { cmd: ZUSAMMENSPIEL, areas: ["a", "b"], nichtBeimAbschluss: "zusammenspiel" };
  if (mitFeld) zusammenspiel.abschlussBereiche = ["a"];
  return {
    buildChecks: [
      { cmd: "echo einheit", always: true },
      { cmd: "echo c", areas: ["c"] },
      zusammenspiel,
    ],
    checkAreas: { a: ["src/a/**"], b: ["src/b/**"], c: ["src/c/**"] },
  };
}

const A_TEXT = 'import { c } from "../c/c.mjs";\nimport { h } from "../../lib/hilfe.mjs";\nexport const KIT_VERSION = "1.0.0";\nexport const a = c + h;\n';

/** Der Ausgangsstand: a importiert c und den Helfer ohne Muster. */
function stand(dir) {
  datei(dir, "src/c/c.mjs", "export const c = 1;\n");
  datei(dir, "lib/hilfe.mjs", "export const h = 1;\n");
  datei(dir, "src/a/a.mjs", A_TEXT);
  datei(dir, "src/b/b.mjs", "export const b = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "stand");
}

const NICHT_DIREKT = "Abschlusslauf: zusammenspiel, keiner der Bereiche aus abschlussBereiche (a) direkt beruehrt, laeuft beim Veroeffentlichen";

async function mitStand(optionen, fn) {
  await mitRepo({ config: config(optionen) }, async (dir) => {
    stand(dir);
    await fn(dir);
  });
}

test("(a) eine Datei im Muster von a laesst den Eintrag beim Abschluss laufen", async () => {
  await mitStand({}, async (dir) => {
    datei(dir, "src/a/a.mjs", A_TEXT.replace("c + h", "c + h + 1"));

    const ergebnis = plan(dir, "--finish", "1531");

    assert.equal(eintrag(ergebnis.laufen, ZUSAMMENSPIEL)?.grund, "Abschlusslauf: Bereich a direkt beruehrt");
    const res = await run(dir, "--finish", "1531");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /echo zusammenspiel[^\n]*Bereich a direkt beruehrt/);
  });
});

test("(b) a nur ueber die abhaengigen Bereiche beruehrt: ausgelassen mit eigenem Grund", async () => {
  await mitStand({}, async (dir) => {
    datei(dir, "src/c/c.mjs", "export const c = 2;\n");

    const ergebnis = plan(dir, "--finish", "1531");

    assert.ok(ergebnis.bereiche.includes("a"), JSON.stringify(ergebnis.bereiche));
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit", "echo c"]);
    assert.equal(eintrag(ergebnis.ausgelassen, ZUSAMMENSPIEL)?.grund, NICHT_DIREKT);
  });
});

test("(c) eine Datei ohne Muster ausserhalb von test/helpers traegt a ueber ihre Importeure: laeuft", async () => {
  await mitStand({}, async (dir) => {
    datei(dir, "lib/hilfe.mjs", "export const h = 2;\n");

    const ergebnis = plan(dir, "--finish", "1531");

    assert.deepEqual(ergebnis.abgeleitet?.map((a) => a.pfad), ["lib/hilfe.mjs"]);
    assert.equal(eintrag(ergebnis.laufen, ZUSAMMENSPIEL)?.grund, "Abschlusslauf: Bereich a direkt beruehrt");
  });
});

test("(c2) eine Datei in a, die nur ihren Stempel aendert, beruehrt a nicht direkt", async () => {
  await mitStand({}, async (dir) => {
    datei(dir, "src/a/a.mjs", A_TEXT.replace('"1.0.0"', '"1.0.1"'));

    const ergebnis = plan(dir, "--finish", "1531");

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit"]);
    assert.equal(eintrag(ergebnis.ausgelassen, ZUSAMMENSPIEL)?.grund, NICHT_DIREKT);
  });
});

test("(d) ist der Anker nicht aufloesbar, laeuft der Eintrag mit dem Grund der normalen Auswahl", async () => {
  await mitStand({}, async (dir) => {
    const ergebnis = plan(dir, "--finish", "1531", "--since", "gibt-es-nicht");

    assert.equal(ergebnis.vollerUmfang, true);
    assert.equal(eintrag(ergebnis.laufen, ZUSAMMENSPIEL)?.grund, "voller Umfang: Anker 'gibt-es-nicht' laesst sich nicht aufloesen");
  });
});

test("(d2) beim leeren Paket traegt der Eintrag den Grund des leeren Pakets", async () => {
  await mitStand({}, async (dir) => {
    const ergebnis = plan(dir, "--finish", "1531");

    assert.equal(ergebnis.leeresPaket, true);
    assert.match(eintrag(ergebnis.ausgelassen, ZUSAMMENSPIEL)?.grund ?? "", /^leeres Paket: keine Aenderung seit /);
  });
});

test("(e) ohne --finish waehlt der Lauf wie ohne das Feld", async () => {
  for (const aenderung of [["src/c/c.mjs", "export const c = 2;\n"], ["src/b/b.mjs", "export const b = 2;\n"]]) {
    const auswahl = [];
    for (const mitFeld of [true, false]) {
      await mitStand({ mitFeld }, async (dir) => {
        datei(dir, ...aenderung);
        const ergebnis = plan(dir);
        auswahl.push({ laufen: ergebnis.laufen, ausgelassen: ergebnis.ausgelassen });
      });
    }
    assert.deepEqual(auswahl[0], auswahl[1]);
    assert.ok(eintrag(auswahl[0].laufen, ZUSAMMENSPIEL), JSON.stringify(auswahl[0]));
  }
});

test("(f) an der Stufe push laeuft der Eintrag", async () => {
  await mitStand({}, async (dir) => {
    datei(dir, "src/c/c.mjs", "export const c = 2;\n");

    const ergebnis = plan(dir, "--stage", "push");

    assert.equal(eintrag(ergebnis.laufen, ZUSAMMENSPIEL)?.grund, "Veroeffentlichungsstufe: voller Umfang");
  });
});
