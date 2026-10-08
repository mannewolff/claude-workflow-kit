// Der Pfadvergleich des Installers (Issue #873).
//
// `core.hooksPath` gegen das eigene `.githooks` zu halten, ist ein Vergleich von
// Verzeichnissen und nicht von Zeichenketten: Ein Punkt im Pfad ist kein anderer Ort,
// die Gross-/Kleinschreibung bleibt dagegen Teil des Namens.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pfadeGleich } from "../install.mjs";

test("[installer-2] die Gross-/Kleinschreibung bleibt Teil des Namens", () => {
  assert.equal(pfadeGleich("/a/repo/.githooks", "/a/repo/./.githooks"), true,
    "normalisiert wird trotzdem");
  assert.equal(pfadeGleich("/a/Repo/.githooks", "/a/repo/.githooks"), false,
    "zwei Verzeichnisse, die sich nur in der Schreibweise unterscheiden, sind zwei");
  assert.equal(pfadeGleich("/a/repo/.githooks", "/a/repo/.githooks"), true);
});

test("[installer-2] verschiedene Orte bleiben verschieden", () => {
  assert.equal(pfadeGleich("/a/repo/.githooks", "/a/repo/anderswo/.githooks"), false,
    "der Name allein entscheidet nicht — ein fremdes .githooks bleibt fremd");
});
