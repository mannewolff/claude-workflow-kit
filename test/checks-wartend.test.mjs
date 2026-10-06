// Wartende Vorhaben-Notizen in der Pruef-Auswahl (Issue #546, Plan #545).
//
// Altlast aus SDD (Plan #825, A5): Bis zum Rueckbau legte `/techplan` Notizen unter
// `.claude/vorhaben-wartend-` ab. Heute entsteht keine mehr, aber in Zielprojekten
// kann noch eine liegen, und kein Nebenlauf darf sich an ihr stoeren: Sie ist keine
// geaenderte Datei des Arbeitspakets, sie beruehrt keinen Bereich und sie darf
// keine Pruefung ausloesen, zu der sie nicht gehoert.
//
// Jeder Fall macht die Datei fuer git SICHTBAR (`wartendSichtbar`). Das ist der
// Punkt der Uebung: Waere sie durch `.gitignore` verdeckt, waere jeder Test hier
// gruen — auch ohne den Filter im Code. Genau diese Lage gibt es aber in echten
// Projekten, weil der Installer eine vorhandene eigene `.claude`-Regel
// unangetastet laesst (Plan #545, A2).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mitRepo, git, datei, plan, run, zusammenfassung, treeStand, kommandos, eintrag,
} from "./helpers/checks-repo.mjs";

const WARTEND = ".claude/vorhaben-wartend-probe.md";

const QUELLE_CMD = "node -e \"process.exit(0)\"";
const LOKAL_CMD = "node -e \"process.exit(0)\" # lokal";

// Zwei Bereiche, und `lokal` deckt `.claude/**` ausdruecklich mit ab. Ohne den
// Filter faende die wartende Notiz dort ihr Muster, `lokal` waere beruehrt und der
// zweite Check liefe — die beobachtbare Differenz, um die es geht. Ein checkAreas
// ohne `.claude/`-Muster wuerde die Notiz stattdessen in `vollerUmfang` kippen;
// beide Gegenproben stecken in den Faellen unten.
const CONFIG = {
  buildChecks: [
    { cmd: QUELLE_CMD, areas: ["quelle"] },
    { cmd: LOKAL_CMD, areas: ["lokal"] },
  ],
  checkAreas: { quelle: ["src/**"], lokal: [".claude/**"] },
};

// Dasselbe ohne `.claude/`-Muster: Hier ist die Notiz eine Datei, die kein Muster
// trifft — ohne den Filter zieht sie den Lauf in den vollen Umfang.
const CONFIG_OHNE_CLAUDE = {
  buildChecks: [{ cmd: QUELLE_CMD, areas: ["quelle"] }],
  checkAreas: { quelle: ["src/**"] },
};

/**
 * Macht `.claude/vorhaben-wartend-*` fuer git sichtbar.
 *
 * Die Regel wird committet: Ungetrackt zaehlte die `.gitignore` selbst als
 * geaenderte Datei und zoege jeden Lauf in den vollen Umfang — also genau in den
 * Zustand, den die Faelle hier auseinanderhalten sollen. Was das Commit-Gate mit der
 * Notiz macht, belegt `ablauf-checks-gate.test.mjs` (Issue #1212).
 */
function wartendSichtbar(dir) {
  datei(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\n!.claude/vorhaben-wartend-*\nfakebin/\n");
  git(dir, "add", ".gitignore");
  git(dir, "commit", "-q", "-m", "sichtbare wartende Notizen");
}

/** Der Nachweis, dass git die Datei sieht — sonst prueft der Fall nichts. */
function gitSiehtNotiz(dir) {
  assert.match(treeStand(dir), /vorhaben-wartend-probe\.md/,
    "git sieht die wartende Notiz nicht — der Fall waere auch ohne den Filter gruen");
}

test("[checks-2] eine wartende Vorhaben-Notiz steht weder in geaendert noch in hashes", async () => {
  await mitRepo({ config: CONFIG }, async (dir) => {
    wartendSichtbar(dir);
    datei(dir, "src/a.js", "// A\n");
    datei(dir, WARTEND, "# wartet\n");
    gitSiehtNotiz(dir);

    assert.deepEqual(plan(dir).geaendert, ["src/a.js"]);

    const res = await run(dir);
    assert.equal(res.status, 0, `checks.mjs run schlug fehl: ${res.stdout}${res.stderr}`);
    assert.deepEqual(Object.keys(zusammenfassung(dir).hashes), ["src/a.js"]);
  });
});

test("[checks-2] eine wartende Vorhaben-Notiz beruehrt keinen Bereich und loest keinen Bereichs-Check aus", async () => {
  await mitRepo({ config: CONFIG }, async (dir) => {
    wartendSichtbar(dir);
    datei(dir, "src/a.js", "// A\n");
    datei(dir, WARTEND, "# wartet\n");
    gitSiehtNotiz(dir);

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.bereiche, ["quelle"], "die Notiz haette keinen Bereich beruehren duerfen");
    assert.deepEqual(kommandos(ergebnis.laufen), [QUELLE_CMD]);
    assert.match(eintrag(ergebnis.ausgelassen, LOKAL_CMD).grund, /lokal unberuehrt/);
  });
});

test("[checks-2] ist die wartende Notiz die einzige Aenderung, ist das Paket leer", async () => {
  await mitRepo({ config: CONFIG }, async (dir) => {
    wartendSichtbar(dir);
    datei(dir, WARTEND, "# wartet\n");
    gitSiehtNotiz(dir);

    const ergebnis = plan(dir);

    assert.equal(ergebnis.leeresPaket, true, "die Notiz allein ist kein Arbeitspaket");
    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.geaendert, []);
    assert.deepEqual(kommandos(ergebnis.laufen), [], "auf einem leeren Paket laeuft nichts");

    const res = await run(dir);
    assert.equal(res.status, 0, `checks.mjs run schlug fehl: ${res.stdout}${res.stderr}`);
    assert.deepEqual(zusammenfassung(dir).hashes, {}, "ein leeres Paket bezeugt keinen Stand");
  });
});

test("[checks-2] neben einer regulaeren Aenderung bleibt der Umfang eng", async () => {
  await mitRepo({ config: CONFIG_OHNE_CLAUDE }, async (dir) => {
    wartendSichtbar(dir);
    datei(dir, "src/a.js", "// A\n");
    datei(dir, WARTEND, "# wartet\n");
    gitSiehtNotiz(dir);

    const res = await run(dir);
    assert.equal(res.status, 0, `checks.mjs run schlug fehl: ${res.stdout}${res.stderr}`);

    // Ohne den Filter trifft die Notiz kein Muster, `planen` kippt in den vollen
    // Umfang und liesse alle Checks laufen. Das ist die messbare Differenz.
    const summary = zusammenfassung(dir);
    assert.equal(summary.vollerUmfang, false, "die Notiz haette den vollen Umfang nicht ausloesen duerfen");
    assert.deepEqual(kommandos(summary.laufen), [QUELLE_CMD]);
  });
});

test("[checks-2] der Filter greift am Praefix und nicht als Teilstring", async () => {
  await mitRepo({ config: CONFIG }, async (dir) => {
    wartendSichtbar(dir);
    // Dieselbe Namensform in einem Unterprojekt: Der Ausschluss in night.mjs
    // (`:(exclude).claude/vorhaben-wartend-*`) nimmt sie NICHT aus, also darf sie
    // hier auch nicht unsichtbar werden — sonst waere sie in der Auswahl fort und
    // im Rest-Guard ein Rest.
    datei(dir, "sub/.claude/vorhaben-wartend-x.md", "# kein wartender Ablageort\n");
    datei(dir, WARTEND, "# wartet\n");

    assert.deepEqual(plan(dir).geaendert, ["sub/.claude/vorhaben-wartend-x.md"]);
  });
});
