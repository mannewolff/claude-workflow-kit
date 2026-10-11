// Versionsstempel loesen keine Bereiche aus (Issue #1521, Erweiterung von #1178).
//
// `node tools/sync-blobs.mjs` aendert beim Release in jeder gestempelten Kit-Datei die
// Zeile `const KIT_VERSION = "x.y.z";` und in `install.mjs` die Zeile
// `const VERSION = "x.y.z";`. Eine solche Zeile aendert kein Verhalten; `sync-blobs
// --check` prueft die Uebereinstimmung ohnehin bei jedem Lauf. Darum beruehrt eine
// Datei, deren jede geaenderte Zeile eine Blob-Konstante oder ein Stempel ist, ihre
// Bereiche nicht und zieht keine Importeure nach. Eine echte Zeile daneben, eine neue
// Datei ohne Stand am Anker: wie bisher.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, plan, datei, git, kommandos, eintrag } from "./helpers/checks-repo.mjs";

function kommando(bereich) {
  return `node -e "process.exit(0)" # ${bereich}`;
}

const CONFIG = {
  buildChecks: ["kern", "nutzer", "installer"].map((bereich) => ({ cmd: kommando(bereich), areas: [bereich] })),
  checkAreas: {
    kern: ["kit/kern.mjs"],
    nutzer: ["kit/nutzer.mjs"],
    installer: ["install.mjs"],
  },
};

const KERN = 'const KIT_VERSION = "1.0.0";\nexport const kern = 1;\n';
const NUTZER = 'import { kern } from "./kern.mjs";\nexport const nutzer = kern;\n';
const INSTALLER = [
  "#!/usr/bin/env node",
  'const VERSION = "1.0.0";',
  'const SKILL_A_B64 = "QUFB";',
  "function installieren() {",
  "  return 1;",
  "}",
  "",
].join("\n");

/** Legt die Kit-Datei, ihren Importeur und den Installer an und committet sie als Anker. */
async function mitStand(fn) {
  await mitRepo({ config: CONFIG }, async (dir) => {
    datei(dir, "kit/kern.mjs", KERN);
    datei(dir, "kit/nutzer.mjs", NUTZER);
    datei(dir, "install.mjs", INSTALLER);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "stand");
    await fn(dir);
  });
}

test("(a) nur KIT_VERSION geaendert: kein Bereich beruehrt, kein Importeur nachgezogen", async () => {
  await mitStand(async (dir) => {
    datei(dir, "kit/kern.mjs", KERN.replace("1.0.0", "1.0.1"));

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.bereiche, []);
    assert.deepEqual(kommandos(ergebnis.laufen), []);
    assert.equal(ergebnis.abhaengig, undefined);
    assert.ok(ergebnis.geaendert.includes("kit/kern.mjs"), "die Datei bleibt im Nachweis");
  });
});

test("(b) install.mjs mit VERSION und Blobs geaendert: installer unberuehrt", async () => {
  await mitStand(async (dir) => {
    datei(dir, "install.mjs", INSTALLER.replace("1.0.0", "1.0.1").replace("QUFB", "WFhY"));

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, []);
    assert.deepEqual(kommandos(ergebnis.laufen), []);
  });
});

test("(c) eine echte Zeile neben dem Stempel: Bereich und Importeure wie bisher", async () => {
  await mitStand(async (dir) => {
    datei(dir, "kit/kern.mjs", KERN.replace("1.0.0", "1.0.1").replace("kern = 1", "kern = 2"));
    datei(dir, "install.mjs", INSTALLER.replace("1.0.0", "1.0.1").replace("return 1;", "return 2;"));

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["installer", "kern", "nutzer"]);
    assert.deepEqual(ergebnis.abhaengig, [{ bereich: "nutzer", ueber: "kit/kern.mjs" }]);
  });
});

test("(d) eine neue Datei ohne Stand am Anker beruehrt ihren Bereich, auch wenn sie nur einen Stempel traegt", async () => {
  await mitRepo({ config: CONFIG }, async (dir) => {
    datei(dir, "kit/kern.mjs", 'const KIT_VERSION = "1.0.0";\n');

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["kern"]);
  });
});

test("(e) der Grund der Auslassung nennt die Stempel", async () => {
  await mitStand(async (dir) => {
    datei(dir, "kit/kern.mjs", KERN.replace("1.0.0", "1.0.1"));
    datei(dir, "install.mjs", INSTALLER.replace("1.0.0", "1.0.1"));

    const ergebnis = plan(dir);

    assert.equal(
      eintrag(ergebnis.ausgelassen, kommando("kern")).grund,
      "Bereich kern unberuehrt (kit/kern.mjs: nur Blobs und Stempel)",
    );
    assert.equal(
      eintrag(ergebnis.ausgelassen, kommando("installer")).grund,
      "Bereich installer unberuehrt (install.mjs: nur Blobs und Stempel)",
    );
    // Der Importeur war nie beruehrt: Sein Grund traegt keinen Vermerk.
    assert.equal(eintrag(ergebnis.ausgelassen, kommando("nutzer")).grund, "Bereich nutzer unberuehrt");
  });
});

test("VERSION ausserhalb von install.mjs ist kein Stempel", async () => {
  await mitStand(async (dir) => {
    datei(dir, "kit/kern.mjs", 'const VERSION = "2";\n' + KERN);

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["kern", "nutzer"]);
  });
});
