// Der Unterbefehl `bereiche` (Issue #1004, Plan #1001, E7, E8, E14).
//
// Er rechnet zwei Dinge, die die Wirksamkeits-Auswertung braucht und nicht selbst rechnen
// soll: je Bereich, in wie vielen bereichsgebundenen Paketstufen-Kommandos er steht, und
// das Inventar der versionierten Dateien ohne Bereich. Das Inventar muss exakt die Auswahl
// von `zuordnen` spiegeln — darum rechnet es hier und nicht in einer zweiten Glob-Logik.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, checks, datei, git } from "./helpers/checks-repo.mjs";

/** Erfolgreicher `bereiche`-Aufruf, JSON geparst. */
function bereiche(dir) {
  const res = checks(dir, "bereiche");
  assert.equal(res.status, 0, `checks.mjs bereiche schlug fehl (${res.status}): ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function bereich(ausgabe, name) {
  const treffer = ausgabe.bereiche.find((b) => b.name === name);
  assert.ok(treffer, `Bereich '${name}' fehlt in der Ausgabe`);
  return treffer;
}

test("[checks-1004] bereiche nennt je Bereich Muster und die Zahl der nennenden Paketstufen-Kommandos", () => {
  const config = {
    buildChecks: [
      "echo string",
      { cmd: "echo immer", always: true },
      { cmd: "echo a", areas: ["kern"] },
      { cmd: "echo b", areas: ["kern", "doku"] },
      { cmd: "echo push", areas: ["kern", "doku"], stufe: "push" },
    ],
    checkAreas: { kern: ["src/**", "lib/*.js"], doku: ["docs/**"], leer: ["nie/**"] },
  };
  mitRepo({ config }, (dir) => {
    const ausgabe = bereiche(dir);

    assert.equal(ausgabe.kommandos, 2, "nur bereichsgebundene Kommandos der Paketstufe zaehlen");
    assert.deepEqual(ausgabe.bereiche.map((b) => b.name), ["kern", "doku", "leer"], "Reihenfolge der Config");
    assert.deepEqual(bereich(ausgabe, "kern").muster, ["src/**", "lib/*.js"]);
    assert.deepEqual([bereich(ausgabe, "kern").nennend, bereich(ausgabe, "kern").von], [2, 2]);
    assert.equal(bereich(ausgabe, "doku").nennend, 1);
    assert.equal(bereich(ausgabe, "leer").nennend, 0);
  });
});

test("[checks-1004] bei zwei Kommandos ist kein Bereich hervorgehoben, auch einer in beiden nicht", () => {
  const config = {
    buildChecks: [{ cmd: "echo a", areas: ["kern"] }, { cmd: "echo b", areas: ["kern"] }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    assert.equal(bereich(bereiche(dir), "kern").hervorgehoben, false);
  });
});

test("[checks-1004] ab drei Kommandos ist ein Bereich in allen oder allen bis auf eines hervorgehoben", () => {
  const config = {
    buildChecks: [
      { cmd: "echo a", areas: ["kern", "breit"] },
      { cmd: "echo b", areas: ["kern", "breit"] },
      { cmd: "echo c", areas: ["breit", "doku"] },
    ],
    checkAreas: { kern: ["src/**"], breit: ["**/*.mjs"], doku: ["docs/**"] },
  };
  mitRepo({ config }, (dir) => {
    const ausgabe = bereiche(dir);
    assert.equal(bereich(ausgabe, "breit").hervorgehoben, true, "3 von 3");
    assert.equal(bereich(ausgabe, "kern").hervorgehoben, true, "2 von 3 ist alle bis auf eines");
    assert.equal(bereich(ausgabe, "doku").hervorgehoben, false, "1 von 3");
    assert.equal(bereich(ausgabe, "doku").kopplungsgrund, null, "ohne Eintrag kein Grund");
  });
});

test("[checks-1004] ein gekoppelter Bereich bleibt hervorgehoben und traegt seinen Grund", () => {
  const config = {
    buildChecks: [
      { cmd: "echo a", areas: ["board"] },
      { cmd: "echo b", areas: ["board"] },
      { cmd: "echo c", areas: ["board", "doku"] },
    ],
    checkAreas: { board: ["kit/board.mjs"], doku: ["docs/**"] },
    gekoppelteBereiche: [{ bereich: "board", grund: "Fast jede Testgruppe laedt kit/board.mjs." }],
  };
  mitRepo({ config }, (dir) => {
    const board = bereich(bereiche(dir), "board");
    assert.equal(board.hervorgehoben, true);
    assert.equal(board.kopplungsgrund, "Fast jede Testgruppe laedt kit/board.mjs.");
  });
});

test("[checks-1004] das Inventar trennt freigestellte von unzugeordneten versionierten Dateien", () => {
  const config = {
    buildChecks: [{ cmd: "echo a", areas: ["kern"] }],
    checkAreas: { kern: ["src/**", ".claude/workflow.config.json"] },
    ohnePruefung: [{ muster: "docs/**", grund: "reine Doku" }, { muster: "src/**", grund: "wirkungslos" }],
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");
    datei(dir, "docs/x.md");
    datei(dir, "lose.txt");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "mehr");
    datei(dir, "unversioniert.txt");

    const { inventar } = bereiche(dir);

    // Versioniert: .gitattributes, .gitignore, README.md, .claude/workflow.config.json, src/a.txt, docs/x.md, lose.txt.
    assert.equal(inventar.dateien, 7, "gezaehlt wird, was git versioniert — die ungetrackte Datei nicht");
    assert.deepEqual(inventar.freigestellt, [{ pfad: "docs/x.md", grund: "reine Doku" }]);
    assert.deepEqual(inventar.ohneZuordnung, [".gitattributes", ".gitignore", "README.md", "lose.txt"]);
    assert.equal(inventar.ohneTreffer, 5, "freigestellte und unzugeordnete zusammen");
  });
});

test("[checks-1004] bereiche ohne Config bricht ab wie plan und run", () => {
  mitRepo({ ohneConfig: true }, (dir) => {
    const res = checks(dir, "bereiche");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /workflow\.config\.json/);
  });
});
