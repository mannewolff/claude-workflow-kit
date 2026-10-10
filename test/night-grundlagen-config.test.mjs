// Die Config des Nacht-Runners mit persoenlichen Overrides im selben Prozess (Issue #207,
// #432, #1224).
//
// Fuer den Runner ist die Allowlist besonders wichtig: Die Pruefung auf leere buildChecks ist
// sein einziges Gate. Was am laufenden Runner sichtbar ist, prueft weiter
// workflow-config-merge; hier steht das Mischen selbst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ladeConfigMitOverrides } from "../kit/night/grundlagen.mjs";

/** Legt workflow.config.json und, wenn gegeben, workflow.config.local.json an; liefert den Pfad der geteilten. */
function configs(geteilt, lokal) {
  const dir = mkdtempSync(join(tmpdir(), "night-grundlagen-config-"));
  const pfad = join(dir, "workflow.config.json");
  writeFileSync(pfad, JSON.stringify(geteilt));
  if (lokal !== undefined) writeFileSync(join(dir, "workflow.config.local.json"), typeof lokal === "string" ? lokal : JSON.stringify(lokal));
  return pfad;
}

/** Laedt und sammelt die Hinweise, die das Mischen auf stderr schreibt. */
function laden(pfad) {
  const hinweise = [];
  const schreiben = process.stderr.write;
  process.stderr.write = (text) => { hinweise.push(String(text)); return true; };
  try {
    return { config: ladeConfigMitOverrides(pfad), hinweise };
  } finally {
    process.stderr.write = schreiben;
  }
}

test("ohne persoenliche Datei gilt die geteilte Config unveraendert", () => {
  const { config, hinweise } = laden(configs({ buildChecks: ["npm test"], reviewModel: "a" }));
  assert.deepEqual(config, { buildChecks: ["npm test"], reviewModel: "a" });
  assert.deepEqual(hinweise, []);
});

test("erlaubte Felder ueberschreiben, buildChecks bleiben teamweit", () => {
  const { config, hinweise } = laden(configs(
    { buildChecks: ["npm test"], reviewModel: "a", triggers: { go: "GO" } },
    { buildChecks: [], reviewModel: "b", triggers: { go: "LOS" } },
  ));
  assert.deepEqual(config.buildChecks, ["npm test"], "lokale buildChecks duerfen das Gate nicht abschalten");
  assert.equal(config.reviewModel, "b");
  assert.deepEqual(config.triggers, { go: "LOS" });
  assert.equal(hinweise.length, 1);
  assert.match(hinweise[0], /'buildChecks' aus workflow\.config\.local\.json wird ignoriert — das Feld gilt teamweit\./);
});

test("vom Reviewer-Paar gilt genau eines (Issue #432)", () => {
  const { config } = laden(configs({ reviewModel: "claude" }, { reviewCommand: "codex review" }));
  assert.equal(config.reviewCommand, "codex review");
  assert.equal("reviewModel" in config, false, "das Gegenstueck haette weichen muessen");
  const beide = laden(configs({ reviewModel: "claude" }, { reviewCommand: "x", reviewModel: "y" })).config;
  assert.equal(beide.reviewCommand, "x");
  assert.equal(beide.reviewModel, "y", "stehen beide lokal, bleiben beide");
});

test("reviewLesegrenze ist persoenlich und weicht mit reviewCommand (Issue #1379, Plan #1375 E11)", () => {
  const team = { reviewCommand: "codex exec", reviewLesegrenze: "--sandbox read-only" };
  const eigen = laden(configs(team, { reviewLesegrenze: "--sandbox x" }));
  assert.equal(eigen.config.reviewLesegrenze, "--sandbox x");
  assert.deepEqual(eigen.hinweise, [], "reviewLesegrenze darf nicht als teamweit gemeldet werden");
  const claude = laden(configs(team, { reviewModel: "claude-sonnet-5" })).config;
  assert.equal("reviewCommand" in claude, false);
  assert.equal("reviewLesegrenze" in claude, false, "die Lesegrenze des Team-Kommandos muss mit weichen");
  const kommando = laden(configs({ reviewModel: "claude" }, { reviewCommand: "codex exec" })).config;
  assert.equal("reviewModel" in kommando, false);
});

test("aus einem Block gilt nur das freigegebene Blatt", () => {
  const { config, hinweise } = laden(configs(
    { toolbox: { baseUrl: "https://team", tokenFile: "team.token" } },
    { toolbox: { tokenFile: "mein.token", baseUrl: "https://privat" } },
  ));
  assert.deepEqual(config.toolbox, { baseUrl: "https://team", tokenFile: "mein.token" });
  assert.match(hinweise.join(""), /'toolbox\.baseUrl' aus workflow\.config\.local\.json wird ignoriert/);
});

test("eine persoenliche Datei mit Tippfehler kippt den Lauf nicht", () => {
  const { config, hinweise } = laden(configs({ reviewModel: "a" }, "{ kein json"));
  assert.deepEqual(config, { reviewModel: "a" });
  assert.match(hinweise.join(""), /workflow\.config\.local\.json ist kein gueltiges JSON und wird ignoriert\./);
});
