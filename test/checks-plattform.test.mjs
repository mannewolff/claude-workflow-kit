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

import { startOptionen, baumBeendenAufruf } from "../kit/checks.mjs";

test("[1123] unter Windows startet ein Kommando ohne Abkoppeln, auf POSIX in eigener Gruppe", () => {
  assert.equal(startOptionen("win32").detached, false);
  assert.equal(startOptionen("linux").detached, true);
  assert.equal(startOptionen("darwin").detached, true);
  for (const plattform of ["win32", "linux", "darwin"]) {
    const o = startOptionen(plattform);
    assert.equal(o.shell, true, `${plattform}: ohne Shell gaebe es konfigurierte Kommandozeilen nicht`);
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
