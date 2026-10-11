// Die Achse `vorab` in `checks.mjs run` (Issue #1519).
//
// Ein schnelles Rot soll nach Sekunden bekannt sein und nicht erst nach den langen
// gleichzeitigen Testgruppen. Mit `vorab` gekennzeichnete Pruefungen laufen darum vor
// der gleichzeitigen Phase nacheinander in Config-Reihenfolge; ein Rot dort startet keine
// weitere Pruefung. Ohne `vorab` bleibt der Ablauf der bisherige: zuerst die
// gleichzeitigen, dann die uebrigen.
//
// Die Reihenfolge belegt eine Datei, an die jedes Kommando seinen Namen anhaengt — die
// Zusammenfassung kennt nur Ergebnisse und Dauern, nicht den Startzeitpunkt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checksMit, mitRepo, zusammenfassung, datei, eintrag,
} from "./helpers/checks-repo.mjs";

/** Ein Kommando, das nach `ms` Millisekunden `name` an reihe.txt anhaengt. */
function schreibt(name, ms = 0) {
  return `node -e "setTimeout(() => require('fs').appendFileSync('reihe.txt', '${name}\\n'), ${ms})"`;
}

/** Ein rotes Kommando, das sich vorher in reihe.txt eintraegt. */
function rot(name) {
  return `node -e "require('fs').appendFileSync('reihe.txt', '${name}\\n'); process.exit(1)"`;
}

/** `run` mit festgelegter Grenze gleichzeitiger Pruefungen, unabhaengig von der Umgebung. */
function runMit(dir) {
  return checksMit(dir, { env: { KIT_CHECKS_GLEICHZEITIG: "2" } }, "run");
}

function reihe(dir) {
  const pfad = join(dir, "reihe.txt");
  return existsSync(pfad) ? readFileSync(pfad, "utf-8").trim().split("\n") : [];
}

test("vorab gekennzeichnete laufen vor allen gleichzeitigen, nacheinander in Config-Reihenfolge", async () => {
  const g1 = schreibt("g1", 200);
  const g2 = schreibt("g2", 200);
  const v1 = schreibt("v1", 150);
  const v2 = schreibt("v2");
  const config = {
    buildChecks: [{ cmd: g1, gleichzeitig: true }, { cmd: g2, gleichzeitig: true }, { cmd: v1, vorab: true }, { cmd: v2, vorab: true }],
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await runMit(dir);

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    const r = reihe(dir);
    assert.deepEqual(r.slice(0, 2), ["v1", "v2"], `die Vorphase lief nicht zuerst: ${r.join(", ")}`);
    assert.deepEqual([...r.slice(2)].sort(), ["g1", "g2"]);
    assert.ok(!eintrag(zusammenfassung(dir).laufen, v1).gleichzeitig, "eine vorab gelaufene Pruefung lief allein");
  });
});

test("ein Rot in der Vorphase startet keine weitere Pruefung und endet mit Exit ungleich 0", async () => {
  const v1 = rot("v1");
  const v2 = schreibt("v2");
  const g = schreibt("g");
  const danach = schreibt("danach");
  const config = {
    buildChecks: [{ cmd: g, gleichzeitig: true }, danach, { cmd: v1, vorab: true }, { cmd: v2, vorab: true }],
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await runMit(dir);

    assert.notEqual(res.status, 0, "ein roter Lauf endet nicht mit 0");
    assert.deepEqual(reihe(dir), ["v1"]);
    const z = zusammenfassung(dir);
    assert.equal(eintrag(z.laufen, v1).ergebnis, "rot");
    for (const cmd of [v2, g, danach]) assert.equal(eintrag(z.laufen, cmd).ergebnis, "nicht gestartet");
    assert.equal(z.abgeschlossen, true);
  });
});

test("ohne vorab bleibt die Reihenfolge: zuerst die gleichzeitigen, dann die uebrigen", async () => {
  const danach = schreibt("danach");
  const g = schreibt("g", 100);
  const config = { buildChecks: [danach, { cmd: g, gleichzeitig: true }] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await runMit(dir);

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    assert.deepEqual(reihe(dir), ["g", "danach"]);
  });
});

test("upfront wirkt wie vorab", async () => {
  const g = schreibt("g");
  const v = schreibt("v", 150);
  const config = { buildChecks: [{ cmd: g, concurrent: true }, { cmd: v, upfront: true }] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await runMit(dir);

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    assert.deepEqual(reihe(dir), ["v", "g"]);
  });
});

test("ein Wert ausser true und false ist ein Fehler mit dem Namen der Pruefung", async () => {
  const v = schreibt("v");
  await mitRepo({ config: { buildChecks: [{ cmd: v, vorab: "ja" }] } }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await runMit(dir);

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /vorab/);
    assert.ok(res.stderr.includes(v), `der Fehler nennt die Pruefung nicht: ${res.stderr}`);
    assert.deepEqual(reihe(dir), []);
  });
});

test("vorab und gleichzeitig zugleich ist ein Fehler mit dem Namen der Pruefung", async () => {
  const v = schreibt("v");
  await mitRepo({ config: { buildChecks: [{ cmd: v, vorab: true, gleichzeitig: true }] } }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await runMit(dir);

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /vorab/);
    assert.match(res.stderr, /gleichzeitig/);
    assert.ok(res.stderr.includes(v), `der Fehler nennt die Pruefung nicht: ${res.stderr}`);
    assert.deepEqual(reihe(dir), []);
  });
});
