// Der Hook, der Kit-Aufrufe mit Pipe oder Umleitung abweist (Issue #995).
//
// Seit Claude Code 2.1.277 nimmt `sandbox.excludedCommands` eine zusammengesetzte
// Zeile nur noch aus der Sandbox, wenn JEDER Teil zu einem Eintrag passt. Ein
// `node .claude/kit/board.mjs … | head` laeuft darum komplett in der Sandbox — samt
// dem codex, das board.mjs startet. Der Hook sagt das der Session, bevor es passiert.
//
// Zwei Ebenen: die reine Pruefung `pruefeBashZeile` (Faelle der Shell-Zerlegung) und
// das Unterkommando `hook bash-pruefen` (stdin-JSON, Exitcodes, Settings-Dateien).

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { pruefeBashZeile } from "../kit/board.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const MUSTER = ["node .claude/kit/board.mjs*", "mvn *", "codex *"];
const BOARD = "node .claude/kit/board.mjs issue list";

function abgewiesen(zeile, muster = MUSTER) {
  const r = pruefeBashZeile(zeile, muster);
  assert.equal(r.abweisen, true, `erwartet abgewiesen: ${zeile}`);
  assert.equal(typeof r.grund, "string");
  return r.grund;
}

function erlaubt(zeile, muster = MUSTER) {
  const r = pruefeBashZeile(zeile, muster);
  assert.deepEqual(r, { abweisen: false, grund: null }, `erwartet erlaubt: ${zeile}`);
}

// --- pruefeBashZeile --------------------------------------------------------

test("[bash-pruefen] das reine Kommando ist erlaubt", () => {
  erlaubt(BOARD);
  erlaubt("  node .claude/kit/board.mjs issue get 995  ");
});

test("[bash-pruefen] Pipe, Umleitung und Folgebefehl heben die Ausnahme auf und werden abgewiesen", () => {
  abgewiesen(`${BOARD} | head -5`);
  abgewiesen(`${BOARD} 2>&1 | head -40`);
  abgewiesen(`codex exec --model m < prompt.txt`);
  abgewiesen(`${BOARD} > liste.json`);
  abgewiesen(`${BOARD} >> liste.json`);
  abgewiesen(`${BOARD} && grep 995`);
  abgewiesen(`cd /repo && ${BOARD}`);
  abgewiesen(`${BOARD} ; echo fertig`);
  abgewiesen(`${BOARD} || echo kaputt`);
  abgewiesen(`${BOARD}\necho zweite Zeile`);
});

test("[bash-pruefen] Umleitung in eine Datei wird auch dann abgewiesen, wenn alle Teile passen", () => {
  // Gemessen in Issue #986: Schon `codex exec … < datei` allein lief in der Sandbox.
  abgewiesen("codex exec --model m 'OK' < prompt.txt");
  abgewiesen(`${BOARD} 2>/dev/null`);
  abgewiesen(`${BOARD} &> alles.log`);
});

test("[bash-pruefen] 2>&1 allein laesst die Ausnahme stehen (gemessen unter 2.1.283) und ist erlaubt", () => {
  erlaubt(`${BOARD} 2>&1`);
  erlaubt(`${BOARD} >&2`);
  erlaubt(`${BOARD} 1>&2`);
});

test("[bash-pruefen] Pipe- und Umleitungszeichen in Anfuehrungszeichen sind Text, kein Operator", () => {
  erlaubt(`node .claude/kit/board.mjs issue comment 1 --text "a > b | c && d; e < f"`);
  erlaubt(`node .claude/kit/board.mjs issue comment 1 --text 'a > b | c'`);
  erlaubt(`node .claude/kit/board.mjs issue comment 1 --text a\\>b\\|c`);
  erlaubt(`node .claude/kit/board.mjs issue comment 1 --text "zitat \\" | noch im Text"`);
});

test("[bash-pruefen] eine Zeile, deren Teile alle passen, ist erlaubt", () => {
  erlaubt(`mvn -q test && ${BOARD}`);
  erlaubt(`${BOARD} | codex exec --model m`);
  erlaubt(`mvn clean; mvn verify`);
});

test("[bash-pruefen] ohne passendes Muster wird nie abgewiesen", () => {
  erlaubt("ls -la | head -5");
  erlaubt("git log --oneline > log.txt && cat log.txt");
  erlaubt(`${BOARD} | head -5`, []);
  erlaubt("node .claude/kit/checks.mjs run | tail -3");
  // `mvn *` verlangt ein Leerzeichen nach mvn — `mvnw` ist ein anderes Kommando.
  erlaubt("mvnw verify | tail");
});

test("[bash-pruefen] die Begruendung nennt Muster, Ursache und die richtige Form", () => {
  const grund = abgewiesen(`${BOARD} | head -5`);
  assert.match(grund, /node \.claude\/kit\/board\.mjs\*/, "das betroffene Muster");
  assert.match(grund, /Sandbox/);
  assert.match(grund, /Pipe|Umleitung/);
  assert.match(grund, /allein/, "die richtige Form: das Kommando allein aufrufen");
  assert.match(grund, /Datei/, "grosse Ausgaben legt Claude Code selbst in einer Datei ab");
});

test("[bash-pruefen] Muster mit Stern in der Mitte und ohne Stern", () => {
  erlaubt("gh pr view 12", ["gh * view*"]);
  abgewiesen("gh pr view 12 | head", ["gh * view*"]);
  abgewiesen("make | tail", ["make"]);
  erlaubt("make install | tail", ["make"]);
});

// --- Unterkommando hook bash-pruefen ---------------------------------------

function projektMitSettings(settings, lokal) {
  const dir = setupProjekt(null, "bash-pruefen-");
  if (settings !== undefined) {
    writeFileSync(join(dir, ".claude", "settings.json"),
      typeof settings === "string" ? settings : JSON.stringify(settings), "utf-8");
  }
  if (lokal !== undefined) {
    writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify(lokal), "utf-8");
  }
  return dir;
}

function hook(dir, eingabe) {
  const text = typeof eingabe === "string" ? eingabe : JSON.stringify(eingabe);
  return runBoard(dir, ["hook", "bash-pruefen"], { CLAUDE_PROJECT_DIR: "" }, { input: text });
}

const SANDBOX = { sandbox: { excludedCommands: ["mvn *"], network: { excludedCommands: ["node .claude/kit/board.mjs*"] } } };

function mitProjekt(settings, lokal, fn) {
  const dir = projektMitSettings(settings, lokal);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("[bash-pruefen] Hook: Pipe hinter einem ausgenommenen Kommando endet mit Exit 2 und Begruendung", () => {
  mitProjekt(SANDBOX, undefined, (dir) => {
    const res = hook(dir, { tool_name: "Bash", tool_input: { command: `${BOARD} | head -5` } });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /node \.claude\/kit\/board\.mjs\*/);
    assert.match(res.stderr, /allein/);
  });
});

test("[bash-pruefen] Hook: das reine Kommando endet mit Exit 0 und ohne Ausgabe", () => {
  mitProjekt(SANDBOX, undefined, (dir) => {
    const res = hook(dir, { tool_name: "Bash", tool_input: { command: BOARD } });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
  });
});

test("[bash-pruefen] Hook: Muster aus settings.local.json zaehlen mit", () => {
  mitProjekt(undefined, { sandbox: { excludedCommands: ["codex *"] } }, (dir) => {
    const res = hook(dir, { tool_name: "Bash", tool_input: { command: "codex exec x < p.txt" } });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /codex \*/);
  });
});

test("[bash-pruefen] Hook: CLAUDE_PROJECT_DIR bestimmt, wo die Settings liegen", () => {
  mitProjekt(SANDBOX, undefined, (dir) => {
    const leer = projektMitSettings(undefined);
    try {
      const res = runBoard(leer, ["hook", "bash-pruefen"], { CLAUDE_PROJECT_DIR: dir },
        { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: `${BOARD} | head` } }) });
      assert.equal(res.status, 2, res.stderr);
    } finally {
      rmSync(leer, { recursive: true, force: true });
    }
  });
});

test("[bash-pruefen] Hook: ein anderes Werkzeug als Bash wird durchgelassen", () => {
  mitProjekt(SANDBOX, undefined, (dir) => {
    const res = hook(dir, { tool_name: "Read", tool_input: { command: `${BOARD} | head` } });
    assert.equal(res.status, 0, res.stderr);
  });
});

test("[bash-pruefen] Hook: kaputte Eingabe wird mit einer Zeile auf stderr durchgelassen", () => {
  mitProjekt(SANDBOX, undefined, (dir) => {
    const res = hook(dir, "{ kein json");
    assert.equal(res.status, 0);
    assert.match(res.stderr, /bash-pruefen/);
    assert.equal(res.stderr.trim().split("\n").length, 1, "genau eine Zeile");
  });
});

test("[bash-pruefen] Hook: kaputte settings.json wird mit einer Zeile auf stderr durchgelassen", () => {
  mitProjekt("{ kaputt", undefined, (dir) => {
    const res = hook(dir, { tool_name: "Bash", tool_input: { command: `${BOARD} | head` } });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /settings\.json/);
  });
});

test("[bash-pruefen] Hook: ohne Settings gibt es keine Muster und nichts wird abgewiesen", () => {
  mitProjekt(undefined, undefined, (dir) => {
    const res = hook(dir, { tool_name: "Bash", tool_input: { command: `${BOARD} | head` } });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
  });
});
