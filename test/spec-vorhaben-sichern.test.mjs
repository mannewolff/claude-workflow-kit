// `spec.mjs vorhaben-sichern` — wartende Vorhaben-Notizen aufheben (Issue #547).
//
// Der Fehlervertrag dieses Kommandos reicht bis zum **Dateizustand** und nicht nur
// bis zum Exitcode (A7 in Plan #545). Deshalb prueft hier fast jeder Test zweierlei:
// was das Kommando meldet, und was der naechste Lauf vorfindet.
//
// Drei Zusagen tragen die Suite:
//
//   1. **Exit 1 heisst: keine Datei angefasst.** Jede Ausnahme im Je-Datei-Schritt
//      wird zum Ausgang `liegengeblieben` (Exit 2). Ohne diese Regel beendete der
//      aeussere catch in main() eine unerwartete Ausnahme mit Exit 1, nachdem schon
//      Dateien verschoben wurden — und der Vertrag waere gebrochen, ohne dass es
//      jemand merkt.
//   2. **Immer JSON auf stdout**, auch ohne `spec`-Block. Die Zusage ist nur etwas
//      wert, wenn ein Aufrufer sie bedingungslos parsen kann; Paket #548 tut das.
//   3. **Das Ziel wird atomar ersetzt.** Ein gescheiterter Schreibvorgang laesst den
//      alten Stand stehen und keine halbe Datei zurueck.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { mitFixture, spec, configSchreiben } from "./helpers/spec-fixture.mjs";

const SPEC_BLOCK = { seit: "2026-09-02", bereiche: { alpha: ["kit/**"] } };

// Auf Windows und als root greifen Verzeichnisrechte nicht — derselbe Skip wie in
// test/checks-hash.test.mjs.
const OHNE_RECHTE = { skip: process.platform === "win32" || process.getuid?.() === 0 };

/** Legt ein Wegwerf-Verzeichnis ohne specs/ an und schreibt die Config. */
function mitProjekt(fn, { specBlock = SPEC_BLOCK } = {}) {
  mitFixture(null, (dir) => {
    configSchreiben(dir, specBlock === null ? {} : { spec: specBlock });
    fn(dir);
  });
}

/** Legt eine wartende Notiz ab und gibt ihren Pfad zurueck. */
function wartendSchreiben(dir, kuerzel, text = `# Vorhaben-Notiz ${kuerzel}\n`) {
  const pfad = join(dir, ".claude", `vorhaben-wartend-${kuerzel}.md`);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(pfad, text, "utf-8");
  return pfad;
}

function wartendPfad(dir, kuerzel) {
  return join(dir, ".claude", `vorhaben-wartend-${kuerzel}.md`);
}

function zielPfad(dir, kuerzel) {
  return join(dir, "specs", "vorhaben", `${kuerzel}.md`);
}

/** Ruft das Kommando auf und parst die JSON-Ausgabe — beides gehoert zusammen. */
function sichern(dir, ...args) {
  const res = spec(dir, "vorhaben-sichern", ...args);
  let bericht;
  try {
    bericht = JSON.parse(res.stdout);
  } catch (err) {
    assert.fail(`stdout ist kein JSON (${err.message}): ${JSON.stringify(res.stdout)}, stderr: ${res.stderr}`);
  }
  return { ...res, bericht };
}

/** Der Eintrag zu einem Kuerzel, mit sprechender Meldung wenn er fehlt. */
function eintrag(bericht, kuerzel) {
  const treffer = bericht.notizen.find((n) => n.kuerzel === kuerzel);
  assert.ok(treffer, `kein Eintrag fuer '${kuerzel}' in ${JSON.stringify(bericht)}`);
  return treffer;
}

// --- Nichts zu tun ----------------------------------------------------------

test("[spec-1] ohne wartende Notiz: leere Liste als JSON, Exit 0", () => {
  mitProjekt((dir) => {
    const res = sichern(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.bericht, { notizen: [] });
    assert.equal(existsSync(join(dir, "specs")), false, "ohne Notiz wird nichts angelegt");
  });
});

// --- Der Regelfall ----------------------------------------------------------

test("[spec-1] eine wartende Notiz wandert nach specs/vorhaben/ und ist danach fort", () => {
  mitProjekt((dir) => {
    wartendSchreiben(dir, "VER", "# Vorhaben-Notiz VER\n- Code gelesen: ja\n");

    const res = sichern(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(eintrag(res.bericht, "VER"), {
      quelle: ".claude/vorhaben-wartend-VER.md",
      ziel: "specs/vorhaben/VER.md",
      kuerzel: "VER",
      ausgang: "uebernommen",
    });

    assert.equal(readFileSync(zielPfad(dir, "VER"), "utf-8"), "# Vorhaben-Notiz VER\n- Code gelesen: ja\n");
    assert.equal(existsSync(wartendPfad(dir, "VER")), false, "die wartende Datei bleibt liegen");
  });
});

test("[spec-1] mehrere wartende Notizen werden alle uebernommen", () => {
  mitProjekt((dir) => {
    for (const k of ["alpha", "beta", "plan-545"]) wartendSchreiben(dir, k);

    const res = sichern(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.bericht.notizen.length, 3, JSON.stringify(res.bericht));
    for (const k of ["alpha", "beta", "plan-545"]) {
      assert.equal(eintrag(res.bericht, k).ausgang, "uebernommen");
      assert.ok(existsSync(zielPfad(dir, k)), `${k} ist nicht angekommen`);
      assert.equal(existsSync(wartendPfad(dir, k)), false, `${k} liegt noch`);
    }
  });
});

test("[spec-1] specs/vorhaben/ wird angelegt, wenn es fehlt", () => {
  mitProjekt((dir) => {
    wartendSchreiben(dir, "VER");
    assert.equal(existsSync(join(dir, "specs")), false, "Vorbedingung: specs/ fehlt");

    assert.equal(sichern(dir).status, 0);
    assert.ok(existsSync(zielPfad(dir, "VER")));
  });
});

test("[spec-1] ein vorhandenes Ziel wird ersetzt, nicht ergaenzt", () => {
  mitProjekt((dir) => {
    mkdirSync(join(dir, "specs", "vorhaben"), { recursive: true });
    writeFileSync(zielPfad(dir, "VER"), "# alter Stand\n", "utf-8");
    wartendSchreiben(dir, "VER", "# neuer Stand\n");

    assert.equal(sichern(dir).status, 0);
    assert.equal(readFileSync(zielPfad(dir, "VER"), "utf-8"), "# neuer Stand\n");
  });
});

// --- --dry-run --------------------------------------------------------------

test("[spec-1] --dry-run verschiebt nichts und meldet jeden Eintrag als 'vorgesehen'", () => {
  mitProjekt((dir) => {
    wartendSchreiben(dir, "VER");

    const res = sichern(dir, "--dry-run");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(eintrag(res.bericht, "VER").ausgang, "vorgesehen");
    assert.equal(eintrag(res.bericht, "VER").ziel, "specs/vorhaben/VER.md");

    assert.ok(existsSync(wartendPfad(dir, "VER")), "--dry-run hat die Quelle angefasst");
    assert.equal(existsSync(join(dir, "specs")), false, "--dry-run hat specs/ angelegt");
  });
});

// --- Der Dateizustand nach einem Fehlschlag ---------------------------------

test("[spec-1] Schreibfehler: liegengeblieben mit Grund, Exit 2, altes Ziel unveraendert", OHNE_RECHTE, () => {
  mitProjekt((dir) => {
    const verzeichnis = join(dir, "specs", "vorhaben");
    mkdirSync(verzeichnis, { recursive: true });
    writeFileSync(join(verzeichnis, "probe.md"), "# alter Stand\n", "utf-8");
    wartendSchreiben(dir, "probe", "# neuer Stand\n");
    chmodSync(verzeichnis, 0o500);

    try {
      const res = sichern(dir);
      assert.equal(res.status, 2, `Exit ${res.status}, stderr: ${res.stderr}`);

      const notiz = eintrag(res.bericht, "probe");
      assert.equal(notiz.ausgang, "liegengeblieben");
      assert.ok(notiz.grund, "der Grund fehlt");

      assert.equal(readFileSync(join(verzeichnis, "probe.md"), "utf-8"), "# alter Stand\n",
        "das Ziel wurde halb geschrieben — die Ersetzung war nicht atomar");
      assert.ok(existsSync(wartendPfad(dir, "probe")), "die wartende Datei wurde trotz Fehlschlag geloescht");
    } finally {
      chmodSync(verzeichnis, 0o700);
    }
  });
});

test("[spec-1] Loeschfehler: Ziel steht, Ausgang 'uebernommen, Bereinigung ausstehend', Exit 0", OHNE_RECHTE, () => {
  mitProjekt((dir) => {
    wartendSchreiben(dir, "probe", "# neuer Stand\n");
    const claude = join(dir, ".claude");
    chmodSync(claude, 0o500);

    try {
      const res = sichern(dir);
      assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);

      const notiz = eintrag(res.bericht, "probe");
      assert.equal(notiz.ausgang, "uebernommen, Bereinigung ausstehend");
      assert.ok(notiz.grund, "der Grund fehlt");

      assert.equal(readFileSync(zielPfad(dir, "probe"), "utf-8"), "# neuer Stand\n");
      assert.ok(existsSync(wartendPfad(dir, "probe")), "die Quelle ist doch fort");

      // Wiederholung ist idempotent: derselbe Ausgang, dieselben Dateien.
      const zweiter = sichern(dir);
      assert.equal(zweiter.status, 0, zweiter.stderr);
      assert.equal(eintrag(zweiter.bericht, "probe").ausgang, "uebernommen, Bereinigung ausstehend");
      assert.equal(readFileSync(zielPfad(dir, "probe"), "utf-8"), "# neuer Stand\n");
      assert.ok(existsSync(wartendPfad(dir, "probe")));
    } finally {
      chmodSync(claude, 0o700);
    }
  });
});

test("[spec-1] eine unerwartete Ausnahme im Je-Datei-Schritt endet als liegengeblieben, nicht als Exit 1", () => {
  mitProjekt((dir) => {
    // Das Ziel ist ein Verzeichnis: renameSync scheitert, ohne dass Rechte im Spiel
    // sind. Genau dafuer gibt es den Fang je Datei — sonst brechen Ausnahmen dieser
    // Art den ganzen Lauf mit Exit 1 ab, obwohl schon Dateien verschoben wurden.
    mkdirSync(zielPfad(dir, "sperre"), { recursive: true });
    wartendSchreiben(dir, "sperre");
    wartendSchreiben(dir, "frei");

    const res = sichern(dir);
    assert.equal(res.status, 2, `Exit ${res.status}, stderr: ${res.stderr}`);
    assert.equal(eintrag(res.bericht, "sperre").ausgang, "liegengeblieben");
    assert.ok(eintrag(res.bericht, "sperre").grund, "der Grund fehlt");
    assert.ok(existsSync(wartendPfad(dir, "sperre")), "die gescheiterte Quelle wurde geloescht");

    // Die anderen Dateien laufen weiter durch — je Datei einzeln.
    assert.equal(eintrag(res.bericht, "frei").ausgang, "uebernommen");

    const reste = readdirSync(join(dir, "specs", "vorhaben")).filter((n) => n.endsWith(".tmp"));
    assert.deepEqual(reste, [], "die temporaere Datei blieb nach dem gescheiterten Umbenennen liegen");
  });
});

// --- Ein Kuerzel, das keines ist --------------------------------------------

test("[spec-1] ein Dateiname ohne gueltiges Kuerzel bleibt liegen und wird nicht angefasst", () => {
  mitProjekt((dir) => {
    // Von Hand abgelegt: leeres Kuerzel und eines mit einem Punkt.
    for (const name of ["vorhaben-wartend-.md", "vorhaben-wartend-a.b.md"]) {
      writeFileSync(join(dir, ".claude", name), "# von Hand\n", "utf-8");
    }

    const res = sichern(dir);
    assert.equal(res.status, 2, `Exit ${res.status}, stderr: ${res.stderr}`);
    assert.equal(res.bericht.notizen.length, 2, JSON.stringify(res.bericht));
    for (const notiz of res.bericht.notizen) {
      assert.equal(notiz.ausgang, "liegengeblieben");
      assert.ok(notiz.grund, "der Grund fehlt");
      assert.equal(notiz.ziel, null, "fuer ein ungueltiges Kuerzel darf kein Ziel gebildet werden");
    }

    for (const name of ["vorhaben-wartend-.md", "vorhaben-wartend-a.b.md"]) {
      assert.ok(existsSync(join(dir, ".claude", name)), `${name} wurde angefasst`);
    }
    assert.equal(existsSync(join(dir, "specs")), false, "specs/ wurde angelegt");
  });
});

// --- Ohne spec-Block --------------------------------------------------------

test("[spec-1] ohne 'spec'-Block: leere Liste als JSON, Exit 0, die wartende Datei bleibt liegen", () => {
  mitProjekt((dir) => {
    wartendSchreiben(dir, "probe", "# unangetastet\n");

    const res = sichern(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.bericht, { notizen: [] });
    assert.equal(readFileSync(wartendPfad(dir, "probe"), "utf-8"), "# unangetastet\n");
    assert.equal(existsSync(join(dir, "specs")), false, "ohne Block wird specs/ nicht angelegt");
  }, { specBlock: null });
});

// --- Aufruffehler enden vor jeder Datei -------------------------------------

test("[spec-1] ein unbekanntes Argument endet mit Exit 1, ohne eine Datei anzufassen", () => {
  mitProjekt((dir) => {
    wartendSchreiben(dir, "probe", "# unangetastet\n");

    const res = spec(dir, "vorhaben-sichern", "--was-auch-immer");
    assert.equal(res.status, 1, `Exit ${res.status}, stdout: ${res.stdout}`);
    assert.equal(res.stdout, "", "bei Exit 1 bleibt stdout leer");
    assert.equal(readFileSync(wartendPfad(dir, "probe"), "utf-8"), "# unangetastet\n");
  });
});
