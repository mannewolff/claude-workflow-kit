// Wartende Vorhaben-Notizen in der Pruef-Auswahl (Issue #546, Plan #545).
//
// `spec.mjs vorhaben` legt seine Notiz kuenftig unter `.claude/vorhaben-wartend-`
// ab und `push main` hebt sie nach `specs/vorhaben/` auf. Bis dahin liegt sie im
// Arbeitsbaum, und kein Nebenlauf darf sich an ihr stoeren: Sie ist keine
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
  gate, gateEinbauen,
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
 * Macht `.claude/vorhaben-wartend-*` fuer git sichtbar und stellt das Commit-Gate
 * bereit.
 *
 * Beide Vorbereitungen werden committet: Ungetrackt zaehlten die `.githooks`-
 * Dateien selbst als geaenderte Dateien und zogen jeden Lauf in den vollen Umfang
 * — also genau in den Zustand, den die Faelle hier auseinanderhalten sollen.
 */
function wartendSichtbar(dir) {
  gateEinbauen(dir);
  datei(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\n!.claude/vorhaben-wartend-*\nfakebin/\n");
  git(dir, "add", ".gitignore", ".githooks");
  git(dir, "commit", "-q", "-m", "Gate und sichtbare wartende Notizen");
}

/** Der Nachweis, dass git die Datei sieht — sonst prueft der Fall nichts. */
function gitSiehtNotiz(dir) {
  assert.match(treeStand(dir), /vorhaben-wartend-probe\.md/,
    "git sieht die wartende Notiz nicht — der Fall waere auch ohne den Filter gruen");
}

test("[checks-2] eine wartende Vorhaben-Notiz steht weder in geaendert noch in hashes", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    wartendSichtbar(dir);
    datei(dir, "src/a.js", "// A\n");
    datei(dir, WARTEND, "# wartet\n");
    gitSiehtNotiz(dir);

    assert.deepEqual(plan(dir).geaendert, ["src/a.js"]);

    const res = run(dir);
    assert.equal(res.status, 0, `checks.mjs run schlug fehl: ${res.stdout}${res.stderr}`);
    assert.deepEqual(Object.keys(zusammenfassung(dir).hashes), ["src/a.js"]);
  });
});

test("[checks-2] eine wartende Vorhaben-Notiz beruehrt keinen Bereich und loest keinen Bereichs-Check aus", () => {
  mitRepo({ config: CONFIG }, (dir) => {
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

test("[checks-2] ist die wartende Notiz die einzige Aenderung, ist das Paket leer", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    wartendSichtbar(dir);
    datei(dir, WARTEND, "# wartet\n");
    gitSiehtNotiz(dir);

    const ergebnis = plan(dir);

    assert.equal(ergebnis.leeresPaket, true, "die Notiz allein ist kein Arbeitspaket");
    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.geaendert, []);
    assert.deepEqual(kommandos(ergebnis.laufen), [], "auf einem leeren Paket laeuft nichts");

    const res = run(dir);
    assert.equal(res.status, 0, `checks.mjs run schlug fehl: ${res.stdout}${res.stderr}`);
    assert.deepEqual(zusammenfassung(dir).hashes, {}, "ein leeres Paket bezeugt keinen Stand");
  });
});

test("[checks-2] neben einer regulaeren Aenderung bleibt der Umfang eng, und deren Commit passiert das Gate", () => {
  mitRepo({ config: CONFIG_OHNE_CLAUDE }, (dir) => {
    wartendSichtbar(dir);
    datei(dir, "src/a.js", "// A\n");
    datei(dir, WARTEND, "# wartet\n");
    gitSiehtNotiz(dir);

    const res = run(dir);
    assert.equal(res.status, 0, `checks.mjs run schlug fehl: ${res.stdout}${res.stderr}`);

    // Ohne den Filter trifft die Notiz kein Muster, `planen` kippt in den vollen
    // Umfang und liesse alle Checks laufen. Das ist die messbare Differenz.
    const summary = zusammenfassung(dir);
    assert.equal(summary.vollerUmfang, false, "die Notiz haette den vollen Umfang nicht ausloesen duerfen");
    assert.deepEqual(kommandos(summary.laufen), [QUELLE_CMD]);

    // Der Commit der regulaeren Aenderung geht durch — die ungestagte Notiz
    // erreicht das Gate ohnehin nicht, es liest nur `git diff --cached`.
    git(dir, "add", "src/a.js");
    const g = gate(dir, "pre-commit");
    assert.equal(g.status, 0, `das Gate wies ab: ${g.stdout}${g.stderr}`);
  });
});

// Bewusst `[gate-1]` und nicht `[checks-2]`: Der Fall belegt bestehendes
// Gate-Verhalten — ein Hash je gestagter Datei — und kein neues. Er ist der
// Nachweis zu Plan #545, A11: Der Ausschluss traegt nur ausserhalb des Index.
test("[gate-1] eine gestagte wartende Notiz weist das Gate weiterhin als nicht geprueft ab", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    wartendSichtbar(dir);
    datei(dir, WARTEND, "# wartet\n");
    run(dir);
    git(dir, "add", WARTEND);

    const g = gate(dir, "pre-commit");

    assert.notEqual(g.status, 0, "eine gestagte Notiz darf nicht durchgehen");
    assert.match(g.stderr, /vorhaben-wartend-probe\.md/);
    assert.match(g.stderr, /nicht geprueft/);
  });
});

test("[checks-2] der Filter greift am Praefix und nicht als Teilstring", () => {
  mitRepo({ config: CONFIG }, (dir) => {
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
