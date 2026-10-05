// Die Board-Aufrufe des Nacht-Runners im selben Prozess (Issue #699, #1088, #1224).
//
// `board()` und `boardRoh()` starteten `board.mjs` per spawnSync ohne `maxBuffer` —
// Node puffert dann hoechstens 1 MB, beendet den Kindprozess mit SIGTERM und die
// Fehlermeldung traegt die komplette bis dahin gelesene Ausgabe statt eines Befunds.
//
// Bis Issue #1224 belegte das ein Kettenlauf im Trockenlauf gegen ein gefaelschtes
// board.mjs, zwei Nachtlaeufe als Kindprozess. Seit die Grundlagen ein eigener Teil sind,
// nimmt `board()` den Start als `spawn` im Optionsobjekt (Plan #1199, E6): Der Test sieht
// die Optionen des Starts und gibt die Antwort selbst vor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { board, boardRoh, boardFehlertext, grundlagenAnbinden, ZUSTAND, BOARD_PATH } from "../kit/night/grundlagen.mjs";

/** Ein Start, der jeden Aufruf mitschreibt und die vorgegebenen Antworten der Reihe nach liefert. */
function startAttrappe(...antworten) {
  const aufrufe = [];
  const spawn = (befehl, args, optionen) => {
    aufrufe.push({ befehl, args, optionen });
    return { status: 0, stdout: "", stderr: "", ...antworten[Math.min(aufrufe.length - 1, antworten.length - 1)] };
  };
  return { spawn, aufrufe };
}

/** Ein Abbruch, der wirft statt den Prozess zu beenden — so bleibt der Test im Prozess. */
class Abbruch extends Error {}

function mitAnbindung(haken, fn) {
  const puls = [];
  grundlagenAnbinden({
    pulsSchreiben: () => puls.push("puls"),
    laufAbbrechen: (grund) => { throw new Abbruch(grund); },
    anhaltenLaeuft: () => false,
    zweiterVersuch: () => {},
    vermerkAnDieKarte: () => {},
    laufAnhalten: (text) => { throw new Abbruch(`angehalten: ${text}`); },
    ...haken,
  });
  const vorher = ZUSTAND.LAUF_STEMPEL;
  try {
    return fn(puls);
  } finally {
    ZUSTAND.LAUF_STEMPEL = vorher;
  }
}

test("[night-32] board() startet board.mjs mit grossem Puffer und liest eine Ausgabe ueber 1,5 MB", () => {
  const karten = Array.from({ length: 800 }, (_, i) => ({ id: String(i + 1), body: "x".repeat(2000) }));
  const ausgabe = JSON.stringify(karten);
  assert.ok(ausgabe.length > 1_500_000);
  const { spawn, aufrufe } = startAttrappe({ stdout: ausgabe });
  mitAnbindung({}, (puls) => {
    const ergebnis = board("issue", "list", { spawn, cwd: "/projekt" });
    assert.equal(ergebnis.length, 800);
    assert.deepEqual(puls, ["puls", "puls"], "der Puls schlaegt vor und nach dem Aufruf");
  });
  assert.equal(aufrufe.length, 1);
  const { befehl, args, optionen } = aufrufe[0];
  assert.equal(befehl, process.execPath);
  assert.deepEqual(args, [BOARD_PATH, "issue", "list"]);
  assert.equal(optionen.cwd, "/projekt");
  assert.ok(optionen.maxBuffer >= 256 * 1024 * 1024, `maxBuffer zu klein: ${optionen.maxBuffer}`);
  assert.ok(optionen.env.KIT_TOOLBOX_BUDGET_MS, "die Board-Aufrufe tragen das Nacht-Budget");
});

test("[night-32] scheitert board.mjs mit grosser Ausgabe ohne Lauf, bricht board() mit kurzer Meldung ab", () => {
  const { spawn } = startAttrappe({ status: 1, stdout: "x".repeat(1_600_000) });
  mitAnbindung({}, () => {
    ZUSTAND.LAUF_STEMPEL = null;
    assert.throws(() => board("issue", "list", { spawn }), (err) => {
      assert.ok(err instanceof Abbruch);
      assert.ok(err.message.length < 2000, `Meldung zu lang: ${err.message.length} Zeichen`);
      assert.match(err.message, /^board\.mjs issue list schlug fehl/);
      return true;
    });
  });
});

test("[night-32] im laufenden Lauf bekommt ein gescheiterter Aufruf genau einen zweiten Versuch (Issue #1088)", () => {
  const { spawn, aufrufe } = startAttrappe({ status: 1, stderr: "kurz weg" }, { stdout: "[]" });
  const vermerke = [];
  mitAnbindung({
    zweiterVersuch: (text) => vermerke.push(`versuch: ${text}`),
    vermerkAnDieKarte: () => vermerke.push("vermerk"),
  }, () => {
    ZUSTAND.LAUF_STEMPEL = "2026-10-05-000000";
    assert.deepEqual(board("issue", "list", { spawn }), []);
  });
  assert.equal(aufrufe.length, 2);
  assert.deepEqual(vermerke, ["versuch: board.mjs issue list schlug fehl: kurz weg", "vermerk"]);
});

test("[night-32] scheitert auch der zweite Versuch, haelt der Lauf an", () => {
  const { spawn } = startAttrappe({ status: 1, stderr: "weg" });
  mitAnbindung({}, () => {
    ZUSTAND.LAUF_STEMPEL = "2026-10-05-000000";
    assert.throws(() => board("issue", "list", { spawn }), /angehalten: board\.mjs issue list schlug fehl: weg \(auch im 2\. Versuch\)/);
  });
});

test("[night-32] waehrend eines Anhaltens wirft board() statt erneut anzuhalten", () => {
  const { spawn, aufrufe } = startAttrappe({ status: 1, stderr: "weg" });
  mitAnbindung({ anhaltenLaeuft: () => true }, () => {
    ZUSTAND.LAUF_STEMPEL = "2026-10-05-000000";
    assert.throws(() => board("issue", "list", { spawn }), (err) => !(err instanceof Abbruch) && /schlug fehl: weg/.test(err.message));
  });
  assert.equal(aufrufe.length, 1, "kein zweiter Versuch im Anhalten");
});

test("[night-32] eine Ausgabe ohne JSON bricht board() mit Ausschnitt ab", () => {
  const { spawn } = startAttrappe({ stdout: "kein json" });
  mitAnbindung({}, () => {
    assert.throws(() => board("issue", "get", "7", { spawn }), /board\.mjs issue get 7 lieferte kein JSON: kein json/);
  });
});

test("[night-32] boardRoh() bricht nie ab und liefert Status, JSON und gekuerzten Text", () => {
  const { spawn } = startAttrappe({ status: 1, stdout: JSON.stringify({ ok: false }), stderr: "y".repeat(2000) });
  mitAnbindung({}, () => {
    const res = boardRoh("issue", "check-form", "7", { spawn, budgetMs: 500 });
    assert.equal(res.status, 1);
    assert.deepEqual(res.json, { ok: false });
    assert.match(res.text, /… \(1500 Zeichen gekürzt\)$/);
  });
  const ohneJson = startAttrappe({ stdout: "text" });
  mitAnbindung({}, () => assert.equal(boardRoh("x", { spawn: ohneJson.spawn }).json, null));
});

test("[night-32] boardRoh() gibt ein Budget als KIT_TOOLBOX_BUDGET_MS mit", () => {
  const { spawn, aufrufe } = startAttrappe({ stdout: "{}" });
  mitAnbindung({}, () => boardRoh("issue", "get", "1", { spawn, budgetMs: 500 }));
  assert.equal(aufrufe[0].optionen.env.KIT_TOOLBOX_BUDGET_MS, "500");
});

test("[night-32] boardFehlertext nennt Fehlercode, Signal und kuerzt eine grosse Ausgabe", () => {
  const mitCode = boardFehlertext(["issue", "list"], { error: { code: "ENOBUFS" }, stdout: "", stderr: "" });
  assert.match(mitCode, /ENOBUFS/);

  const mitSignal = boardFehlertext(["issue", "list"], { signal: "SIGTERM", stdout: "", stderr: "" });
  assert.match(mitSignal, /SIGTERM/);

  const grosserText = "y".repeat(1_500_000);
  const gekuerzt = boardFehlertext(["issue", "list"], { stdout: grosserText, stderr: "" });
  assert.ok(gekuerzt.length < 1000, `Text zu lang: ${gekuerzt.length} Zeichen`);
  assert.match(gekuerzt, /… \(1499500 Zeichen gekürzt\)/);
});
