// Wie das Pruefwerkzeug Kommandos startet und beendet (Issue #1123, #1176).
//
// Seit Issue #1077 laufen Kommandos in einer eigenen Prozessgruppe (`detached: true`), damit
// ein Haenger samt Enkeln abgebrochen werden kann; das Signal geht an die Gruppe. Die
// Kommandozeile laeuft ueber `/bin/sh -c`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { startOptionen, baumBeendenAufruf, kommandoStart } from "../kit/checks.mjs";

test("[1123] ein Kommando startet in eigener Gruppe, stdin ignore, Ausgabe als Pipe", () => {
  const o = startOptionen();
  assert.equal(o.detached, true);
  assert.deepEqual(o.stdio, ["ignore", "pipe", "pipe"], "stdin ignore (Issue #1076), Ausgabe als Pipe");
});

test("[1123] das Signal geht an die Prozessgruppe", () => {
  assert.deepEqual(baumBeendenAufruf(4711, "SIGTERM"), { pid: -4711, signal: "SIGTERM" });
  assert.deepEqual(baumBeendenAufruf(4711, "SIGKILL"), { pid: -4711, signal: "SIGKILL" });
});

test("[1176] eine Kommandozeile startet ueber /bin/sh mit -c", () => {
  assert.deepEqual(kommandoStart("npm test && echo ok"), { befehl: "/bin/sh", args: ["-c", "npm test && echo ok"] });
});

test("[1176] die spawn-Optionen tragen keine Shell", () => {
  assert.equal(startOptionen().shell, undefined, "die Shell waehlt kommandoStart");
});
