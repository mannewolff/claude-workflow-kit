// Ablauf-Pruefung: `issue check-form` und `pruefeForm` fuehrt der Einstieg kit/board.mjs; der
// Bestand der Testhinweise kommt aus `git ls-files` im Projekt, und der Befund ist JSON-Ausgabe
// und Exitcode des Prozesses.
//
// `issue check-form` meldet Testhinweise fuer ungenannte Tests eines Plans (Issue #1031,
// Plan #1029). Die Hinweise sind kein Gate: `ok` und Exit-Code haengen weiter allein an
// `verstoesse`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

import { pruefeForm } from "../kit/board.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const PLAN_TITEL = "[Plan] Seitennavigation";

/** Ein formgueltiger Plan; die Abschnitte lassen sich einzeln ersetzen. */
function plan({ kopf = "", ziel = "Etwas bauen.", bereiche = "- Navigation", aenderungen = "- Nichts Genanntes", verifizierung = "- node --test" } = {}) {
  return `Plan-Modell: fixture-modell
${kopf}
## Ziel
${ziel}

## Betroffene Bereiche
${bereiche}

## Architektonische Entscheidungen
- Keine. Die Richtung steht im Fachplan.

## Geplante Änderungen
${aenderungen}

## Offene Fragen
- Keine.

## Verifizierung
${verifizierung}
`;
}

const NAV = "src/app/nav/side-nav.ts";
const NAV_SPEC = "src/app/nav/side-nav.spec.ts";

function hinweisPaare(ergebnis) {
  return (ergebnis.hinweise ?? []).map((h) => [h.baustein, h.test]);
}

test("Hinweise sind kein Gate: ok bleibt wahr, verstoesse leer; ohne Treffer fehlt der Schluessel", () => {
  const mit = pruefeForm(plan({ aenderungen: `- ${NAV}: neu` }), PLAN_TITEL, {}, [NAV, NAV_SPEC]);
  assert.equal(mit.ok, true);
  assert.deepEqual(mit.verstoesse, []);
  assert.equal(mit.hinweise.length, 1);
  const ohne = pruefeForm(plan({ aenderungen: `- ${NAV}: neu` }), PLAN_TITEL, {}, [NAV]);
  assert.equal(ohne.ok, true);
  assert.equal(Object.hasOwn(ohne, "hinweise"), false);
});

test("Arbeitspaket mit gleichem Baustein: kein hinweise", () => {
  const paket = `## Kontext
Warum.

Autor-Modell: fixture-modell

## Aufgabe
- \`${NAV}\`: Fuss wandert nach oben

## Akzeptanzkriterium
- Ein Kommando liefert etwas.

## Abhängigkeiten
Keine.
`;
  const ergebnis = pruefeForm(paket, "[Task] Seitennavigation", {}, [NAV, NAV_SPEC]);
  assert.equal(ergebnis.ok, true);
  assert.equal(Object.hasOwn(ergebnis, "hinweise"), false);
});

/** Ein Fixture-Projekt fuer die Dauer eines Tests, danach restlos weg. */
function mitProjekt(fn) {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-check-form-hinweise-");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
}

test("CLI ueber --body-file: im Git-Repo Exit 0 mit hinweise, auch aus einem Unterverzeichnis; ohne Repo Exit 0 ohne hinweise", () => {
  mitProjekt((dir) => {
    const bodyPfad = join(dir, "plan.md");
    writeFileSync(bodyPfad, plan({ aenderungen: `- ${NAV}: neu` }));
    const aufruf = (cwd, extraEnv = {}) => {
      const res = runBoard(dir, ["issue", "check-form", "--body-file", bodyPfad, "--title", PLAN_TITEL], extraEnv, { cwd });
      return { status: res.status, json: JSON.parse(res.stdout) };
    };

    // Ohne Repo: Die Decke verhindert, dass git ein umgebendes Repo findet.
    const ohneRepo = aufruf(dir, { GIT_CEILING_DIRECTORIES: dirname(dir) });
    assert.equal(ohneRepo.status, 0);
    assert.equal(Object.hasOwn(ohneRepo.json, "hinweise"), false);

    for (const datei of [NAV, NAV_SPEC]) {
      mkdirSync(join(dir, dirname(datei)), { recursive: true });
      writeFileSync(join(dir, datei), "export {};\n");
    }
    lfAttribute(join(dir, ".gitattributes"));
    git(dir, "init", "-q");
    git(dir, "add", NAV, NAV_SPEC);

    for (const cwd of [dir, join(dir, "src", "app")]) {
      const res = aufruf(cwd);
      assert.equal(res.status, 0);
      assert.equal(res.json.ok, true);
      assert.deepEqual(hinweisPaare(res.json), [[NAV, NAV_SPEC]]);
    }
  });
});
