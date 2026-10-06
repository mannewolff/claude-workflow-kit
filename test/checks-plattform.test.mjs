// Das Pruefwerkzeug startet und beendet Kommandos je Plattform (Issue #1123, Teil von #1122).
//
// Seit Issue #1077 laufen Kommandos in einer eigenen Prozessgruppe (`detached: true`), damit
// ein Haenger samt Enkeln abgebrochen werden kann. Unter Windows gibt es keine Gruppen: Ein
// abgekoppelter Prozess bekommt dort ein eigenes Konsolenfenster, seine Ausgabe erreicht die
// Pipe nicht zuverlaessig, und das Signal an die PID beendet nur die `cmd.exe`. In der CI zu
// `ae1d865` waren deshalb 13 Tests des Werkzeugs unter Windows rot.
//
// Belegt wird hier ueber die beiden reinen Funktionen mit Plattformparameter; ob der
// Windows-Job gruen wird, zeigt erst die CI.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as boardModul from "../kit/board/wiederholung.mjs";
import { startOptionen, baumBeendenAufruf, kommandoStart } from "../kit/checks.mjs";

test("[1123] unter Windows startet ein Kommando ohne Abkoppeln, auf POSIX in eigener Gruppe", () => {
  assert.equal(startOptionen("win32").detached, false);
  assert.equal(startOptionen("linux").detached, true);
  assert.equal(startOptionen("darwin").detached, true);
  for (const plattform of ["win32", "linux", "darwin"]) {
    const o = startOptionen(plattform);
    assert.deepEqual(o.stdio, ["ignore", "pipe", "pipe"], `${plattform}: stdin ignore (Issue #1076), Ausgabe als Pipe`);
  }
});

test("[1123] unter Windows beendet taskkill den ganzen Baum, fuer SIGTERM wie fuer SIGKILL", () => {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    assert.deepEqual(baumBeendenAufruf(4711, signal, "win32"), { taskkill: ["/pid", "4711", "/T", "/F"] });
  }
});

test("[1123] auf POSIX geht das Signal an die Prozessgruppe", () => {
  assert.deepEqual(baumBeendenAufruf(4711, "SIGTERM", "linux"), { pid: -4711, signal: "SIGTERM" });
  assert.deepEqual(baumBeendenAufruf(4711, "SIGKILL", "darwin"), { pid: -4711, signal: "SIGKILL" });
});

// --- Die Shell der konfigurierten Kommandozeilen (Issue #1176) ---
//
// Unter Windows laufen die buildChecks ueber die Git Bash statt ueber `cmd.exe`, mit der
// Kommandozeile als `-c`-Argument; auf POSIX bleibt `/bin/sh`. Ohne Git Bash startet nichts,
// und die Pruefung endet rot mit der Meldung von `gitBashPfad`.

const BASH_1176 = String.raw`C:\Program Files\Git\bin\bash.exe`;

test("[1176] unter Windows startet eine Kommandozeile in der Git Bash mit -c", () => {
  const start = kommandoStart("npm test && echo ok", {
    plattform: "win32",
    board: boardModul,
    env: { CLAUDE_CODE_GIT_BASH_PATH: BASH_1176 },
    existiert: (p) => p === BASH_1176,
  });
  assert.equal(start.fehler, null);
  assert.equal(start.befehl, BASH_1176);
  assert.equal(start.args.length, 2);
  assert.match(start.args[0], /^"?-c"?$/);
  assert.match(start.args[1], /npm test && echo ok/);
  assert.deepEqual(start.umgebung, { ...boardModul.GIT_BASH_UMGEBUNG });
});

test("[1176] unter Windows ohne Git Bash startet nichts, die Meldung kommt von gitBashPfad", () => {
  const start = kommandoStart("npm test", { plattform: "win32", board: boardModul, env: { PATH: "" }, existiert: () => false });
  assert.equal(start.befehl, null);
  assert.equal(start.fehler, boardModul.gitBashPfad({ env: { PATH: "" }, existiert: () => false }).fehler);
  assert.ok(start.fehler);
});

test("[1176] unter Windows ohne den Board-Teil wiederholung daneben startet nichts und sagt warum", () => {
  const start = kommandoStart("npm test", { plattform: "win32", board: null });
  assert.equal(start.befehl, null);
  assert.match(start.fehler, /wiederholung\.mjs/);
});

test("[1176] auf POSIX bleibt /bin/sh mit -c", () => {
  for (const plattform of ["linux", "darwin"]) {
    const start = kommandoStart("npm test && echo ok", { plattform, board: null });
    assert.deepEqual(start, { befehl: "/bin/sh", args: ["-c", "npm test && echo ok"], optionen: {}, umgebung: {}, fehler: null });
  }
});

test("[1176] die spawn-Optionen tragen keine Shell mehr", () => {
  for (const plattform of ["win32", "linux", "darwin"]) {
    assert.equal(startOptionen(plattform).shell, undefined, `${plattform}: die Shell waehlt kommandoStart`);
  }
});
