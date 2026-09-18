// Team- und persönliche Ebene in kit/einstellungen.mjs (Issue #676, Plan #674 E6).

import { test } from "node:test";
import assert from "node:assert/strict";

import { ebenen, aenderungAnwenden } from "../kit/einstellungen.mjs";

const TEAM = { codeHost: "github", reviewModel: "claude-opus-5", reviewScope: "diff", buildChecks: ["node --test"], toolbox: { host: "https://x" } };

test("[einstellungen-3] je Einstellung stehen Teamwert, persönliche Abweichung und geltender Wert", () => {
  const e = ebenen(TEAM, { reviewScope: "full", toolbox: { tokenFile: ".tok" } });
  assert.deepEqual(e.reviewScope, { team: "diff", persoenlich: "full", gilt: "full", persoenlichErlaubt: true });
  assert.deepEqual(e.codeHost, { team: "github", persoenlich: undefined, gilt: "github", persoenlichErlaubt: false });
  assert.deepEqual(e["toolbox.tokenFile"], { team: undefined, persoenlich: ".tok", gilt: ".tok", persoenlichErlaubt: true });
});

test("[einstellungen-3] persönlich speichern geht nur für Felder der Allowlist", () => {
  const r = aenderungAnwenden(TEAM, {}, { ebene: "persoenlich", aenderungen: [{ pfad: "buildChecks", wert: [] }] });
  assert.equal(r.ok, false);
  assert.match(r.grund, /buildChecks/);
  const gut = aenderungAnwenden(TEAM, {}, { ebene: "persoenlich", aenderungen: [{ pfad: "toolbox.tokenFile", wert: ".t" }] });
  assert.equal(gut.ok, true);
  assert.deepEqual(gut.lokal, { toolbox: { tokenFile: ".t" } });
  assert.deepEqual(gut.team, TEAM, "die Team-Datei bleibt unberührt");
});

test("[einstellungen-3] eine Team-Änderung lässt die persönliche Datei unberührt", () => {
  const lokal = { reviewScope: "full" };
  const r = aenderungAnwenden(TEAM, lokal, { ebene: "team", aenderungen: [{ pfad: "codeHost", wert: "gitlab" }] });
  assert.equal(r.ok, true);
  assert.equal(r.team.codeHost, "gitlab");
  assert.deepEqual(r.lokal, lokal);
});

test("[einstellungen-3] nach dem Entfernen einer Abweichung gilt wieder der Teamwert, auch beim Reviewer-Paar", () => {
  const lokal = { reviewScope: "full", reviewCommand: "codex exec" };
  assert.equal(ebenen(TEAM, lokal).reviewModel.gilt, undefined, "lokales reviewCommand verdrängt reviewModel");
  const r = aenderungAnwenden(TEAM, lokal, { ebene: "persoenlich", entfernt: ["reviewScope", "reviewCommand"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lokal, {});
  const e = ebenen(r.team, r.lokal);
  assert.equal(e.reviewScope.gilt, "diff");
  assert.equal(e.reviewModel.gilt, "claude-opus-5");
  const blatt = aenderungAnwenden(TEAM, { toolbox: { tokenFile: ".t" } }, { ebene: "persoenlich", entfernt: ["toolbox.tokenFile"] });
  assert.deepEqual(blatt.lokal, {}, "ein leerer Kopf fällt mit weg");
});
