// Die Pruefgruppe der Nacht-Runner-Tests laeuft mit vier Tests gleichzeitig (Issue #1694,
// Plan #1685, Fachplan #1603 AK 5): kein eigener Nachtweg. Das Kommando steht als
// statischer String in der Config, und die Session-Umgebung des Runners setzt die Grenze
// gleichzeitiger Pruefungen nicht — ein Lauf von Hand am Tag laeuft genauso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAUF_VARIABLEN } from "../kit/night/laufvariablen.mjs";
import { sessionUmgebung } from "../kit/night/session.mjs";

const config = JSON.parse(readFileSync(new URL("../.claude/workflow.config.json", import.meta.url), "utf8"));

test("Szenario: Ein Lauf von Hand am Tag profitiert ebenso", () => {
  const eintraege = config.buildChecks.filter((c) => typeof c.cmd === "string" && c.cmd.includes("test/ablauf-night-*.test.mjs"));
  assert.equal(eintraege.length, 1, "genau ein Eintrag nennt test/ablauf-night-*.test.mjs");
  assert.match(eintraege[0].cmd, /--test-concurrency=4\b/);

  assert.ok(!LAUF_VARIABLEN.includes("KIT_CHECKS_GLEICHZEITIG"));
  const umgebung = sessionUmgebung("1694", {}, {});
  assert.equal(Object.hasOwn(umgebung, "KIT_CHECKS_GLEICHZEITIG"), false);
});
