// Nach einem roten Abschluss faehrt derselbe Aufruf zuerst die zuletzt roten Pruefungen
// (Issue #1072, Plan #1066, A3, E5; Kriterium 3 der fachlichen Quelle #1040).
//
// Heute laeuft nach einer Korrektur wieder der volle Umfang, bei jeder weiteren Korrektur
// erneut. Jetzt gilt: Bleibt die Auswahl gleich und hat sich nur der Stand geaendert,
// faehrt `run` zuerst nur die zuletzt roten Kommandos und, wenn sie gruen sind, im selben
// Aufruf genau einmal alle. Ein Teillauf steht nie gruen in der Datei.
//
// Geprueft wird an der WIRKUNG: Jedes Kommando haengt seinen Namen an ein Protokoll unter
// `.claude/` (hinter der Ignore-Regel, veraendert also den Stand nicht). Rot wird ein
// Kommando, solange `.claude/rot-<name>` liegt — ebenfalls ausserhalb des Stands, damit
// die Korrektur selbst allein ueber `src/` laeuft.

import "./helpers/checks-sperre.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  mitRepo, run, zusammenfassung, datei, eintrag, gate, gateEinbauen, git,
} from "./helpers/checks-repo.mjs";

const NIGHT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "night.mjs");

const A = "node .claude/k.mjs a";
const B = "node .claude/k.mjs b";
const C = "node .claude/k.mjs c";

const CONFIG = {
  buildChecks: [
    { cmd: A, areas: ["kern"] },
    { cmd: B, areas: ["kern"] },
    { cmd: C, areas: ["andere"] },
  ],
  checkAreas: { kern: ["src/**"], andere: ["andere/**"] },
};

function kommandoAnlegen(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "k.mjs"), [
    "import { appendFileSync, existsSync } from 'node:fs';",
    "const name = process.argv[2];",
    String.raw`appendFileSync('.claude/protokoll.txt', name + '\n');`,
    "process.exit(existsSync('.claude/rot-' + name) ? 1 : 0);",
    "",
  ].join("\n"), "utf-8");
}

function rotMachen(dir, name) {
  writeFileSync(join(dir, ".claude", `rot-${name}`), "", "utf-8");
}

function gruenMachen(dir, name) {
  rmSync(join(dir, ".claude", `rot-${name}`), { force: true });
}

/** Die Kommandos in der Reihenfolge ihrer Ausfuehrung; danach ist das Protokoll leer. */
function gefahren(dir) {
  const pfad = join(dir, ".claude", "protokoll.txt");
  let zeilen = [];
  try {
    zeilen = readFileSync(pfad, "utf-8").split("\n").filter(Boolean);
  } catch { /* noch nichts gelaufen */ }
  rmSync(pfad, { force: true });
  return zeilen;
}

function mitAufbau(fn, config = CONFIG) {
  mitRepo({ config }, (dir) => {
    kommandoAnlegen(dir);
    datei(dir, "src/a.txt");
    fn(dir);
  });
}

test("roter Lauf, Korrektur: derselbe Aufruf faehrt zuerst nur das rote Kommando und danach alle", () => {
  mitAufbau((dir) => {
    rotMachen(dir, "b");
    const erster = run(dir, "--abschluss", "7");
    assert.equal(erster.status, 1, erster.stdout);
    assert.deepEqual(gefahren(dir), ["a", "b"]);

    gruenMachen(dir, "b");
    datei(dir, "src/a.txt", "korrigiert\n");
    const zweiter = run(dir, "--abschluss", "7");

    assert.equal(zweiter.status, 0, zweiter.stdout);
    assert.deepEqual(gefahren(dir), ["b", "a", "b"], "zuerst das rote allein, danach der volle Lauf");
    assert.match(zweiter.stdout, /Teillauf: nur die zuletzt roten Pruefungen/);
    const z = zusammenfassung(dir);
    assert.equal(z.teillauf, undefined, "die Zusammenfassung am Ende ist die des vollen Laufs");
    assert.deepEqual(z.laufen.map((e) => e.ergebnis), ["gruen", "gruen"]);
    assert.equal(z.abgeschlossen, true);
    assert.ok(!z.berichtszeilen.some((zeile) => zeile.startsWith("Teillauf:")));
    assert.equal(z.wartezeitKarte.laeufe, 2, "Teillauf und voller Lauf sind ein Aufruf");
    assert.ok(z.wartezeitMs >= eintrag(z.laufen, A).dauerMs + eintrag(z.laufen, B).dauerMs,
      "die Wartezeit umfasst Teillauf und vollen Lauf");
  });
});

test("bleibt das rote rot, laufen die uebrigen nicht: teillauf true, die uebrigen stehen auf nicht gestartet", () => {
  mitAufbau((dir) => {
    rotMachen(dir, "b");
    run(dir);
    gefahren(dir);

    datei(dir, "src/a.txt", "halb korrigiert\n");
    const zweiter = run(dir);

    assert.equal(zweiter.status, 1, zweiter.stdout);
    assert.deepEqual(gefahren(dir), ["b"]);
    const z = zusammenfassung(dir);
    assert.equal(z.teillauf, true);
    assert.equal(z.abgeschlossen, true);
    assert.equal(eintrag(z.laufen, A).ergebnis, "nicht gestartet");
    assert.equal(eintrag(z.laufen, B).ergebnis, "rot");
    assert.equal(z.berichtszeilen[0], "Teillauf: nur die zuletzt roten Pruefungen");
    const block = zweiter.stdout.slice(zweiter.stdout.indexOf("Fuer den Abschlussbericht:"));
    const zeilen = block.split("\n");
    assert.match(zeilen[1], /^Wartezeit: /);
    assert.equal(zeilen[2], "Teillauf: nur die zuletzt roten Pruefungen");
  });
});

test("eine Korrektur, die eine neue Datei im selben Bereich anlegt, loest den Teillauf aus", () => {
  mitAufbau((dir) => {
    rotMachen(dir, "b");
    run(dir);
    gefahren(dir);

    gruenMachen(dir, "b");
    datei(dir, "src/neu.txt");
    const zweiter = run(dir);

    assert.equal(zweiter.status, 0, zweiter.stdout);
    assert.deepEqual(gefahren(dir), ["b", "a", "b"]);
  });
});

test("eine Aenderung, die die Auswahl aendert, faehrt direkt voll", () => {
  mitAufbau((dir) => {
    rotMachen(dir, "b");
    run(dir);
    gefahren(dir);

    gruenMachen(dir, "b");
    datei(dir, "andere/x.txt");
    const zweiter = run(dir);

    assert.equal(zweiter.status, 0, zweiter.stdout);
    assert.deepEqual(gefahren(dir), ["a", "b", "c"]);
    assert.doesNotMatch(zweiter.stdout, /Teillauf/);
  });
});

test("unveraenderter Stand uebernimmt wie heute; ein gruener Vorlauf loest keinen Teillauf aus", () => {
  mitAufbau((dir) => {
    rotMachen(dir, "b");
    run(dir);
    gefahren(dir);
    const uebernommen = run(dir);
    assert.equal(uebernommen.status, 1);
    assert.deepEqual(gefahren(dir), [], "derselbe Stand faehrt nichts");
    assert.match(uebernommen.stdout, /Ergebnis uebernommen \(rot: node \.claude\/k\.mjs b\)/);

    gruenMachen(dir, "b");
    datei(dir, "src/a.txt", "gruen\n");
    run(dir);
    gefahren(dir);
    datei(dir, "src/a.txt", "noch eine Aenderung\n");
    const nachGruen = run(dir);

    assert.equal(nachGruen.status, 0, nachGruen.stdout);
    assert.deepEqual(gefahren(dir), ["a", "b"], "nach einem gruenen Vorlauf laeuft alles, ohne Teillauf");
    assert.doesNotMatch(nachGruen.stdout, /Teillauf/);
  });
});

test("--frisch faehrt direkt voll, ohne Teillauf", () => {
  mitAufbau((dir) => {
    rotMachen(dir, "b");
    run(dir);
    gefahren(dir);

    gruenMachen(dir, "b");
    datei(dir, "src/a.txt", "korrigiert\n");
    const zweiter = run(dir, "--frisch");

    assert.equal(zweiter.status, 0, zweiter.stdout);
    assert.deepEqual(gefahren(dir), ["a", "b"]);
    assert.doesNotMatch(zweiter.stdout, /Teillauf/);
  });
});

test("nach einem roten Teillauf nennen Gate, lesePruefung und Uebernahme die tatsaechlich rote Gruppe", () => {
  mitAufbau((dir) => {
    // Gate und Hook liegen vor dem ersten Lauf, sonst aenderten sie zwischen den Laeufen die Auswahl.
    gateEinbauen(dir);
    rotMachen(dir, "b");
    run(dir);
    gefahren(dir);

    datei(dir, "src/a.txt", "halb korrigiert\n");
    run(dir);
    assert.deepEqual(gefahren(dir), ["b"], "Vorbedingung: ein roter Teillauf");
    assert.equal(zusammenfassung(dir).laufen[0].ergebnis, "nicht gestartet",
      "Vorbedingung: vor der roten Gruppe steht eine nicht gestartete");

    git(dir, "add", "src/a.txt");
    const g = gate(dir, "pre-commit");
    assert.equal(g.status, 1);
    assert.match(g.stderr, /endete rot \(node \.claude\/k\.mjs b\)/);

    const skript = `import { lesePruefung } from ${JSON.stringify(pathToFileURL(NIGHT).href)};`
      + "process.stdout.write(JSON.stringify(lesePruefung('7')));";
    const n = spawnSync(process.execPath, ["--input-type=module", "-e", skript], { cwd: dir, encoding: "utf-8" });
    assert.equal(n.status, 0, n.stderr);
    const pruefung = JSON.parse(n.stdout);
    assert.equal(pruefung.zustand, "rot");
    assert.equal(pruefung.rotesKommando, B);
    assert.equal(pruefung.rotesErgebnis, "rot");

    const uebernommen = run(dir);
    assert.match(uebernommen.stdout, /Ergebnis uebernommen \(rot: node \.claude\/k\.mjs b\)/);
    assert.equal(zusammenfassung(dir).teillauf, true, "die Uebernahme reicht die Teillauf-Marke weiter");
  });
});
