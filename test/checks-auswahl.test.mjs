// Die Zuordnung von Pruefung zu Bereich (Issue #423).
//
// Der Regelfall: Was beruehrt ist, laeuft; was unberuehrt ist, wird ausgelassen.
// Mitgeprueft wird der Unterschied, der sich im Verhalten NICHT zeigt: ein
// blosser Kommandostring und `always: true` laufen beide immer, meinen aber
// Verschiedenes — vergessen gegen entschieden. Nur der Grund im Ergebnis haelt
// das auseinander, und deshalb ist er hier ein eigener Assert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, plan, datei, eintrag, kommandos } from "./helpers/checks-repo.mjs";

const CONFIG = {
  buildChecks: [
    { cmd: "npm run build", areas: ["frontend"] },
    { cmd: "mvn verify", areas: ["backend"] },
  ],
  checkAreas: {
    frontend: ["frontend/**"],
    backend: ["backend/**"],
  },
};

test("ein beruehrter Bereich laesst seine Pruefung laufen, ein unberuehrter nicht", async () => {
  await mitRepo({ config: CONFIG }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false);
    assert.equal(ergebnis.leeresPaket, false);
    assert.deepEqual(ergebnis.geaendert, ["frontend/src/App.tsx"]);
    assert.deepEqual(ergebnis.bereiche, ["frontend"]);
    assert.deepEqual(kommandos(ergebnis.laufen), ["npm run build"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["mvn verify"]);
    assert.match(eintrag(ergebnis.laufen, "npm run build").grund, /frontend/);
    assert.match(eintrag(ergebnis.ausgelassen, "mvn verify").grund, /backend/);
    assert.match(eintrag(ergebnis.ausgelassen, "mvn verify").grund, /unberuehrt/);
  });
});

test("Mehrfachzuordnung: ein einziger beruehrter Bereich genuegt", async () => {
  const config = {
    buildChecks: [{ cmd: "npm test", areas: ["frontend", "backend"] }],
    checkAreas: CONFIG.checkAreas,
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "backend/src/Service.java");

    const ergebnis = plan(dir);

    assert.deepEqual(kommandos(ergebnis.laufen), ["npm test"]);
    assert.deepEqual(ergebnis.ausgelassen, []);
    assert.match(eintrag(ergebnis.laufen, "npm test").grund, /backend/);
  });
});

test("ein Muster darf mehrere Bereiche treffen, alle stehen im Ergebnis", async () => {
  const config = {
    buildChecks: [
      { cmd: "npm run build", areas: ["frontend"] },
      { cmd: "npm run docs", areas: ["doku"] },
    ],
    checkAreas: {
      frontend: ["frontend/**"],
      doku: ["**/*.md", "frontend/**"],
    },
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["doku", "frontend"]);
    assert.deepEqual(kommandos(ergebnis.laufen).sort(), ["npm run build", "npm run docs"]);
    assert.equal(ergebnis.vollerUmfang, false);
  });
});

test("String und always laufen gleich, tragen aber verschiedene Gruende", async () => {
  const config = {
    buildChecks: [
      "npx eslint .",
      { cmd: "npm run typecheck", always: true },
      { cmd: "mvn verify", areas: ["backend"] },
    ],
    checkAreas: CONFIG.checkAreas,
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(kommandos(ergebnis.laufen), ["npx eslint .", "npm run typecheck"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["mvn verify"]);

    const ohneZuordnung = eintrag(ergebnis.laufen, "npx eslint .").grund;
    const entschieden = eintrag(ergebnis.laufen, "npm run typecheck").grund;
    assert.match(ohneZuordnung, /nicht zugeordnet/);
    assert.match(entschieden, /immer laufend/);
    assert.notEqual(ohneZuordnung, entschieden);
  });
});

test("ein Objekt nur mit cmd bedeutet dasselbe wie die String-Form", async () => {
  const config = {
    buildChecks: [{ cmd: "npx eslint ." }],
    checkAreas: CONFIG.checkAreas,
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(kommandos(ergebnis.laufen), ["npx eslint ."]);
    assert.match(eintrag(ergebnis.laufen, "npx eslint .").grund, /nicht zugeordnet/);
  });
});

test("leere buildChecks: nichts laeuft, nichts wird ausgelassen, die Bereiche stehen trotzdem da", async () => {
  await mitRepo({ config: { buildChecks: [], checkAreas: CONFIG.checkAreas } }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.laufen, []);
    assert.deepEqual(ergebnis.ausgelassen, []);
    assert.deepEqual(ergebnis.bereiche, ["frontend"]);
    assert.equal(ergebnis.leeresPaket, false);
  });
});

test("Config ohne buildChecks und ohne checkAreas: voller Umfang, aber nichts zu laufen", async () => {
  // Ohne einen einzigen Bereich trifft jede Aenderung kein Muster — das ist der
  // Zweifelsfall, und er zeigt sich als vollerUmfang, nicht als stilles Nichts.
  await mitRepo({ config: {} }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(ergebnis.laufen, []);
    assert.deepEqual(ergebnis.ausgelassen, []);
    assert.deepEqual(ergebnis.bereiche, []);
  });
});
