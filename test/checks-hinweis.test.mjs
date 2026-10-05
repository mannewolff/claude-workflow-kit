// Hinweis-Pruefungen in kit/checks.mjs (Issue #1155, Plan #1150, E11, E12).
//
// Ein buildChecks-Eintrag mit `"art": "hinweis"` laeuft wie jeder andere, endet aber
// immer `gruen` — mit Fund, ohne Fund, mit Fehlermerkmal in der Ausgabe und beim
// Absturz des Werkzeugs. Seine Funde reist er als Zeilen `Hinweis: …` aus: Sie stehen
// in `hinweise[]` des Eintrags und der Zusammenfassung und als `hinweis: …` im Bericht.
// Ein drittes Ergebnis gibt es nicht — Gate, Runner und Befunde lesen jedes
// `ergebnis !== "gruen"` als Abweisung.
//
// Das Fehlermerkmal steht hier aus demselben Grund nicht woertlich wie in
// checks-fehlermerkmal.test.mjs: Diese Suite laeuft selbst unter der Merkmal-Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";

import { mitRepo, run, zusammenfassung, datei, eintrag } from "./helpers/checks-repo.mjs";

const MERKMAL = `${String.fromCharCode(91)}ERROR${String.fromCharCode(93)}`;
const BEREICHE = { frontend: ["frontend/**"] };
const WERKZEUG = "node hinweis-werkzeug.mjs";
const DANACH = "node -e \"process.exit(0)\"";

/** Legt ein Werkzeug an, das die Zeilen ausgibt und mit `exit` endet. */
function werkzeug(dir, zeilen, exit = 0) {
  const text = zeilen.map((z) => `${z}\n`).join("");
  datei(dir, "hinweis-werkzeug.mjs", `process.stdout.write(${JSON.stringify(text)});\nprocess.exit(${exit});\n`);
}

function config(extra = {}) {
  return {
    buildChecks: [{ cmd: WERKZEUG, always: true, art: "hinweis", ...extra }, { cmd: DANACH, always: true }],
    checkAreas: BEREICHE,
  };
}

test("ein Hinweis-Eintrag mit Fund endet gruen und traegt die Funde im Eintrag und in der Zusammenfassung", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, ["Pruefe 3 Dateien", "Hinweis: kit/a.mjs:4 — pfade: Schraegstrich", "Hinweis: test/b.test.mjs:9 — skips: Plattform-Skip"]);

    const res = await run(dir);

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const summary = zusammenfassung(dir);
    const gelaufen = eintrag(summary.laufen, WERKZEUG);
    assert.equal(gelaufen.ergebnis, "gruen");
    assert.deepEqual(gelaufen.hinweise, ["kit/a.mjs:4 — pfade: Schraegstrich", "test/b.test.mjs:9 — skips: Plattform-Skip"]);
    assert.deepEqual(summary.hinweise, [
      { cmd: WERKZEUG, zeilen: ["kit/a.mjs:4 — pfade: Schraegstrich", "test/b.test.mjs:9 — skips: Plattform-Skip"] },
    ]);
    assert.equal(eintrag(summary.laufen, DANACH).ergebnis, "gruen", "die naechste Pruefung laeuft weiter");
  });
});

test("die Funde stehen als hinweis-Zeilen in berichtszeilen und im Block fuer den Abschlussbericht", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, ["Hinweis: kit/a.mjs:4 — pfade: Schraegstrich"]);

    const res = await run(dir);

    const zeile = "hinweis: kit/a.mjs:4 — pfade: Schraegstrich";
    assert.ok(zusammenfassung(dir).berichtszeilen.includes(zeile), JSON.stringify(zusammenfassung(dir).berichtszeilen));
    const block = res.stdout.slice(res.stdout.indexOf("Fuer den Abschlussbericht:"));
    assert.ok(block.split("\n").includes(zeile), block);
  });
});

test("ein Hinweis-Eintrag ohne Fund endet gruen mit leeren Hinweisen", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, ["Pruefe 3 Dateien", "keine Funde"]);

    const res = await run(dir);

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const summary = zusammenfassung(dir);
    assert.equal(eintrag(summary.laufen, WERKZEUG).ergebnis, "gruen");
    assert.deepEqual(eintrag(summary.laufen, WERKZEUG).hinweise, []);
    assert.deepEqual(summary.hinweise, []);
    assert.equal(summary.berichtszeilen.some((z) => z.startsWith("hinweis:")), false);
  });
});

test("ein Fehlermerkmal in einer Hinweiszeile faerbt den Eintrag nicht rot", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, [`Hinweis: kit/a.mjs:1 — kommandos: ${MERKMAL} im Text`]);

    const res = await run(dir);

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const gelaufen = eintrag(zusammenfassung(dir).laufen, WERKZEUG);
    assert.equal(gelaufen.ergebnis, "gruen");
    assert.equal(gelaufen.fehlermerkmal, undefined);
    assert.deepEqual(gelaufen.hinweise, [`kit/a.mjs:1 — kommandos: ${MERKMAL} im Text`]);
  });
});

test("Exit 1 eines Hinweis-Werkzeugs bleibt gruen und meldet kein Scheitern", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, ["Hinweis: kit/a.mjs:2 — dateien: Doppelpunkt"], 1);

    const res = await run(dir);

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const gelaufen = eintrag(zusammenfassung(dir).laufen, WERKZEUG);
    assert.equal(gelaufen.ergebnis, "gruen");
    assert.deepEqual(gelaufen.hinweise, ["kit/a.mjs:2 — dateien: Doppelpunkt"]);
  });
});

test("ein Absturz (Exit 2 und mehr) bleibt gruen und erscheint als genau eine Zeile Hinweis-Pruefung gescheitert", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, ["Hinweis: kit/a.mjs:2 — dateien: Doppelpunkt", "TypeError: kaputt"], 3);

    const res = await run(dir);

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const summary = zusammenfassung(dir);
    const gelaufen = eintrag(summary.laufen, WERKZEUG);
    assert.equal(gelaufen.ergebnis, "gruen");
    const gescheitert = gelaufen.hinweise.filter((z) => z.startsWith("Hinweis-Pruefung gescheitert"));
    assert.equal(gescheitert.length, 1, JSON.stringify(gelaufen.hinweise));
    assert.ok(gescheitert[0].includes(WERKZEUG), `das Kommando fehlt: ${gescheitert[0]}`);
    assert.ok(summary.berichtszeilen.includes(`hinweis: ${gescheitert[0]}`));
    assert.equal(eintrag(summary.laufen, DANACH).ergebnis, "gruen", "die naechste Pruefung laeuft weiter");
  });
});

test("der Abschlusslauf faehrt einen Hinweis-Eintrag mit always", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");
    werkzeug(dir, ["Hinweis: kit/a.mjs:4 — pfade: Schraegstrich"]);

    const res = await run(dir, "--abschluss", "1155");

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const summary = zusammenfassung(dir);
    assert.equal(eintrag(summary.laufen, WERKZEUG).ergebnis, "gruen");
    assert.deepEqual(summary.hinweise, [{ cmd: WERKZEUG, zeilen: ["kit/a.mjs:4 — pfade: Schraegstrich"] }]);
  });
});

test("die Push-Stufe faehrt einen Hinweis-Eintrag mit always", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, ["Hinweis: kit/a.mjs:4 — pfade: Schraegstrich"]);

    const res = await run(dir, "--stufe", "push");

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const summary = zusammenfassung(dir);
    assert.equal(eintrag(summary.laufen, WERKZEUG).ergebnis, "gruen");
    assert.deepEqual(summary.hinweise, [{ cmd: WERKZEUG, zeilen: ["kit/a.mjs:4 — pfade: Schraegstrich"] }]);
  });
});

test("ein uebernommener Lauf traegt die Hinweise weiter", async () => {
  await mitRepo({ config: config() }, async (dir) => {
    werkzeug(dir, ["Hinweis: kit/a.mjs:4 — pfade: Schraegstrich"]);
    await run(dir);

    const res = await run(dir);

    assert.match(res.stdout, /Stand unveraendert/);
    const summary = zusammenfassung(dir);
    assert.deepEqual(summary.hinweise, [{ cmd: WERKZEUG, zeilen: ["kit/a.mjs:4 — pfade: Schraegstrich"] }]);
    assert.ok(summary.berichtszeilen.includes("hinweis: kit/a.mjs:4 — pfade: Schraegstrich"));
  });
});

test("ein gewoehnlicher Eintrag sammelt keine Hinweise", async () => {
  const cmd = "node hinweis-werkzeug.mjs";
  await mitRepo({ config: { buildChecks: [{ cmd, always: true }], checkAreas: BEREICHE } }, async (dir) => {
    werkzeug(dir, ["Hinweis: kit/a.mjs:4 — pfade: Schraegstrich"]);

    await run(dir);

    const summary = zusammenfassung(dir);
    assert.equal(eintrag(summary.laufen, cmd).hinweise, undefined);
    assert.deepEqual(summary.hinweise, []);
  });
});

test("ein unbekannter Wert fuer art bricht ab", async () => {
  await mitRepo({ config: { buildChecks: [{ cmd: DANACH, art: "warnung" }], checkAreas: BEREICHE } }, async (dir) => {
    const res = await run(dir);

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /art/);
    assert.match(res.stderr, /hinweis/);
  });
});
