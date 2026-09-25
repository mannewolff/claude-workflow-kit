// Die Dateien ohne Zuordnung und der Bereichslauf (Issue #922, Plan #917).
//
// Zwei Stuecke, die beide an der Bereichsachse haengen:
//
//   - `ohneZuordnung` sammelt JEDE geaenderte Datei, die kein Muster trifft
//     (Kriterium 9 der fachlichen Quelle #913). Der Grund-Text nennt weiter nur
//     die erste — er ist Text fuer Menschen und wird anderswo woertlich gelesen,
//     also darf er sich nicht mitbewegen. Beides zusammen ist der Punkt: Der
//     Beobachter braucht die volle Liste als Daten, ohne einen Satz zu parsen.
//   - `--bereich <name>` ist der sanktionierte Weg fuer den notwendigen
//     Gruppenlauf. Ohne ihn liesse sich am Lauf nicht ablesen, ob jemand die
//     Auswahl umgangen hat oder ob fuer die geaenderte Datei nur die ganze
//     Gruppe existiert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, plan, run, checks, datei, kommandos, eintrag } from "./helpers/checks-repo.mjs";

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

test("jede Datei ohne Muster steht in ohneZuordnung, der Grund nennt weiter die erste", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "a-ohne-muster.txt");
    datei(dir, "b-ohne-muster.txt");
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(ergebnis.ohneZuordnung, ["a-ohne-muster.txt", "b-ohne-muster.txt"]);
    assert.equal(
      eintrag(ergebnis.laufen, "npm run build").grund,
      "voller Umfang: 'a-ohne-muster.txt' trifft kein Muster",
    );
  });
});

test("trifft jede Datei ein Muster, bleibt ohneZuordnung leer", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.ohneZuordnung, []);
  });
});

test("ein nicht aufloesbarer Anker erfindet keinen Eintrag in ohneZuordnung", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--since", "gibt-es-nicht");

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(ergebnis.ohneZuordnung, []);
  });
});

test("--bereich faehrt die Pruefgruppen genau dieses Bereichs", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    // Eine Datei ohne Muster: ohne das Flag zoege sie den vollen Umfang nach sich.
    datei(dir, "notizen.txt");

    const ergebnis = plan(dir, "--bereich", "frontend");

    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(kommandos(ergebnis.laufen), ["npm run build"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["mvn verify"]);
    assert.match(eintrag(ergebnis.laufen, "npm run build").grund, /Bereichslauf/);
    assert.match(eintrag(ergebnis.ausgelassen, "mvn verify").grund, /Bereichslauf/);
  });
});

test("run --bereich fuehrt genau die Kommandos dieses Bereichs aus", () => {
  const config = {
    buildChecks: [
      { cmd: "echo x > lief-frontend.txt", areas: ["frontend"] },
      { cmd: "echo x > lief-backend.txt", areas: ["backend"] },
    ],
    checkAreas: CONFIG.checkAreas,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "backend/src/Service.java");

    const res = run(dir, "--bereich", "frontend");

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stderr}`);
    assert.ok(existsSync(join(dir, "lief-frontend.txt")), "die Pruefung des Bereichs ist nicht gelaufen");
    assert.ok(!existsSync(join(dir, "lief-backend.txt")), "eine fremde Pruefung ist trotzdem gelaufen");
  });
});

test("ein unbekannter Bereichsname schlaegt fehl und nennt die konfigurierten Bereiche", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const res = checks(dir, "run", "--bereich", "fronend");

    assert.notEqual(res.status, 0, "der unbekannte Bereich lief durch");
    assert.match(res.stderr, /fronend/);
    assert.match(res.stderr, /frontend/);
    assert.match(res.stderr, /backend/);
  });
});

test("ein fehlender Wert hinter --bereich ist derselbe Fehler wie ein falscher", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const res = checks(dir, "plan", "--bereich");

    assert.notEqual(res.status, 0, "--bereich ohne Wert lief durch");
    assert.match(res.stderr, /frontend/);
  });
});

test("--bereich bleibt mit --stufe kombinierbar: die Kumulation gilt weiter", () => {
  const config = {
    buildChecks: [
      { cmd: "npm run build", areas: ["frontend"] },
      { cmd: "npm run e2e", areas: ["frontend"], stufe: "push" },
      { cmd: "mvn verify", areas: ["backend"] },
    ],
    checkAreas: CONFIG.checkAreas,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const paket = plan(dir, "--bereich", "frontend");
    assert.deepEqual(kommandos(paket.laufen), ["npm run build"]);
    assert.match(eintrag(paket.ausgelassen, "npm run e2e").grund, /Stufe push/);

    const push = plan(dir, "--bereich", "frontend", "--stufe", "push");
    assert.deepEqual(kommandos(push.laufen), ["npm run build", "npm run e2e"]);
    assert.deepEqual(kommandos(push.ausgelassen), ["mvn verify"]);
  });
});

test("--bereich laesst --since unberuehrt: der Anker bestimmt weiter die Dateiliste", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--bereich", "backend", "--since", "HEAD");

    assert.deepEqual(ergebnis.geaendert, ["frontend/src/App.tsx"]);
    assert.deepEqual(kommandos(ergebnis.laufen), ["mvn verify"]);
  });
});
