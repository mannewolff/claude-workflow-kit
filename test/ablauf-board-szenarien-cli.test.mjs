// Ablauf-Pruefung: `issue create` weist einen Fachplan ohne vollstaendiges Szenario ab (Gate
// F12, Issue #1590, Plan #1588 E12) — Exitcode, Meldung und Bestand des lokalen Trackers
// zeigt nur ein Programmstart.
//
// Kriterium 3 der fachlichen Quelle #1586 sagt „ueber das Kit angelegt": Darum prueft
// `issue create` selbst und nicht nur der Skill `/requirement`. Bei einem Verstoss entsteht
// keine Karte. Ein Arbeitspaket legt `issue create` ohne diese Pruefung an.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const CONFIG = { issueTracker: "local", codeHost: "local", local: { issuesDir: "issues" } };

const OHNE = `## Ziel
Der Nutzer sieht etwas.

Autor-Modell: fixture-modell

## Fachliche Akzeptanzkriterien
- Der Nutzer sieht es.

## Nicht-Ziele
- Nichts weiter.

## Offene Fragen an den PO
- Keine.
`;

const SZENARIEN = {
  de: "## Szenarien\n\n### Szenario: Der Nutzer sieht es\n- Angenommen ein Nutzer am Board\n- Wenn er die Karte oeffnet\n- Dann sieht er es\n\n",
  en: "## Scenarios\n\n### Scenario: The user sees it\n- Given a user at the board\n- When they open the card\n- Then they see it\n\n",
};

const FORM = {
  de: /### Szenario: <Titel>\n- Angenommen <Ausgangslage>\n- Wenn <Handlung>\n- Dann <beobachtbares Ergebnis>/,
  en: /### Scenario: <title>\n- Given <starting point>\n- When <action>\n- Then <observable result>/,
};

function mitProjekt(language, fn) {
  const dir = setupProjekt({ ...CONFIG, language }, "board-szenarien-cli-");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function anlegen(dir, body, args) {
  const pfad = join(dir, "fachplan.md");
  writeFileSync(pfad, body);
  return runBoard(dir, ["issue", "create", "--body-file", pfad, ...args]);
}

for (const language of ["de", "en"]) {
  test(`[board-1590] issue create --art requirement ohne Abschnitt Szenarien: Exit 1, Form in der Meldung, keine Karte (${language})`, () => {
    mitProjekt(language, (dir) => {
      const res = anlegen(dir, OHNE, ["--title", "Etwas", "--art", "requirement"]);
      assert.equal(res.status, 1, res.stdout);
      assert.equal(res.stdout, "");
      assert.match(res.stderr, /F12/);
      assert.match(res.stderr, FORM[language]);
      assert.deepEqual(board(dir, "issue", "list"), []);
    });
  });

  test(`[board-1590] issue create --art requirement mit vollstaendigem Abschnitt legt an (${language})`, () => {
    mitProjekt(language, (dir) => {
      const body = OHNE.replace("## Nicht-Ziele\n", `${SZENARIEN[language]}## Nicht-Ziele\n`);
      const res = anlegen(dir, body, ["--title", "Etwas", "--art", "requirement"]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(board(dir, "issue", "list").length, 1);
    });
  });
}

test("[board-1590] issue create erkennt den Fachplan auch am Praefix im Titel, in beiden Sprachen", () => {
  mitProjekt("de", (dir) => {
    for (const titel of ["[Fachlich] Etwas", "[Requirement] Etwas"]) {
      const res = anlegen(dir, OHNE, ["--title", titel]);
      assert.equal(res.status, 1, titel);
      assert.match(res.stderr, /F12/);
    }
    assert.deepEqual(board(dir, "issue", "list"), []);
  });
});

test("[board-1590] issue create ohne Body prueft einen Fachplan ebenso", () => {
  mitProjekt("de", (dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Etwas", "--art", "requirement"]);
    assert.equal(res.status, 1, res.stdout);
    assert.deepEqual(board(dir, "issue", "list"), []);
  });
});

test("[board-1590] issue create prueft F12 nicht bei Arbeitspaket, Plan und Idee", () => {
  mitProjekt("de", (dir) => {
    for (const art of ["task", "plan", "idea"]) {
      const res = anlegen(dir, "## Kontext\nAutor-Modell: fixture-modell\n", ["--title", `Etwas ${art}`, "--art", art]);
      assert.equal(res.status, 0, `${art}: ${res.stderr}`);
    }
    assert.equal(board(dir, "issue", "list").length, 3);
  });
});

// `scenarios baseline` (Issue #1591, Plan #1588 E3): die hoechste Nummer am Board plus eins,
// numerisch auch bei den gepolsterten Dateinamen des lokalen Trackers. Es schreibt nichts.
test("[board-1591] scenarios baseline liefert bei gepolsterten Nummern 0009 und 0010 { ab: 11 }", () => {
  mitProjekt("de", (dir) => {
    mkdirSync(join(dir, "issues"), { recursive: true });
    for (const id of ["0009", "0010"]) {
      writeFileSync(join(dir, "issues", `${id}.md`), `---\nid: "${id}"\ntitle: Karte ${id}\nstatus: done\n---\nText\n`);
    }
    const vorher = readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8");
    const res = runBoard(dir, ["scenarios", "baseline"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ab: 11 });
    assert.equal(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"), vorher);
  });
});

test("[board-1591] scenarios baseline auf einem leeren Board liefert { ab: 1 }", () => {
  mitProjekt("de", (dir) => {
    const res = runBoard(dir, ["scenarios", "baseline"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ab: 1 });
  });
});

test("[board-1591] scenarios ohne bekannten Befehl wird abgewiesen", () => {
  mitProjekt("de", (dir) => {
    const res = runBoard(dir, ["scenarios", "irgendwas"]);
    assert.equal(res.status, 1);
  });
});
