// Die eigenen Board-Aufrufe des Nacht-Runners bekommen das Nacht-Budget (Issue #1067).
//
// `board()` und `boardRoh()` starten board.mjs mit der Umgebung des Runners. Dort ist
// KIT_AGENT_MODEL nicht gesetzt — das tragen nur die Sessions —, also galt das
// interaktive Budget von 30 s, und eine einzelne haengende Ready-Abfrage bei langsamer
// Leitung beendete den Lauf als harterStopp. Die Umgebung setzt deshalb
// KIT_TOOLBOX_BUDGET_MS, die dokumentierte Stellschraube aus Issue #842, und laesst
// einen vom Aufrufer gesetzten Wert stehen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boardUmgebung } from "../kit/night.mjs";

test("Die Umgebung der Board-Aufrufe traegt das Nacht-Budget", () => {
  const env = boardUmgebung({ PATH: "/usr/bin" });
  assert.equal(env.KIT_TOOLBOX_BUDGET_MS, "120000");
  assert.equal(env.PATH, "/usr/bin");
});

test("Ein vorab gesetzter Wert wird nicht ueberschrieben", () => {
  assert.equal(boardUmgebung({ KIT_TOOLBOX_BUDGET_MS: "200" }).KIT_TOOLBOX_BUDGET_MS, "200");
});

test("Ein leerer Wert gilt als nicht gesetzt", () => {
  assert.equal(boardUmgebung({ KIT_TOOLBOX_BUDGET_MS: " " }).KIT_TOOLBOX_BUDGET_MS, "120000");
});

test("Die Umgebung setzt kein KIT_AGENT_MODEL und aendert das Original nicht", () => {
  const original = { PATH: "/usr/bin" };
  const env = boardUmgebung(original);
  assert.equal("KIT_AGENT_MODEL" in env, false);
  assert.deepEqual(original, { PATH: "/usr/bin" });
});
