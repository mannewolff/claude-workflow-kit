// Config-Vorgaben nennen englische Labelnamen (Issue #1554, Plan #1548 E4): Schema und
// Beispiel-Config tragen keinen deutschen Labelnamen aus LABELS; ein vom Menschen
// eingetragener deutscher Wert bleibt, wie er steht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LABELS } from "../kit/board/namen.mjs";
import { ladeKetteBudget, ladePruefLaufBudget } from "../kit/night/session.mjs";
import { vorgabeAus } from "../kit/einstellungen.mjs";

const ROOT = join(import.meta.dirname, "..");
const lies = (pfad) => readFileSync(join(ROOT, pfad), "utf-8");

// Nur Namen, die sich von ihrem englischen unterscheiden, sind deutsche Namen.
const DEUTSCHE = Object.values(LABELS).filter(({ de, en }) => de !== en).map(({ de }) => de);

// Alle "default"-Werte des Schemas, rekursiv eingesammelt.
function vorgaben(knoten, aus = []) {
  if (Array.isArray(knoten)) knoten.forEach((k) => vorgaben(k, aus));
  else if (knoten && typeof knoten === "object") {
    for (const [schluessel, wert] of Object.entries(knoten)) {
      if (schluessel === "default") aus.push(JSON.stringify(wert));
      vorgaben(wert, aus);
    }
  }
  return aus;
}

test("Schema-Vorgaben enthalten keinen deutschen Labelnamen", () => {
  const alle = vorgaben(JSON.parse(lies("templates/workflow.config.schema.json"))).join("\n");
  for (const name of DEUTSCHE) assert.ok(!alle.includes(`"${name}"`), `Schema-Vorgabe ${name}`);
});

test("Beispiel-Config enthaelt keinen deutschen Labelnamen", () => {
  const text = lies("templates/workflow.config.json");
  for (const name of DEUTSCHE) assert.ok(!text.includes(`"${name}"`), `Beispiel-Config ${name}`);
});

test("Einstellungen zeigen die englischen Vorgaben", () => {
  assert.equal(vorgabeAus("night.kette.varianteBLabel"), "kit:carry-through");
  assert.equal(vorgabeAus("pruefLauf.label"), "kit:check");
  assert.equal(vorgabeAus("night.stand.labels.laeuft"), "run:running");
});

test("Ohne Eintrag gelten die englischen Vorgaben", () => {
  assert.equal(ladeKetteBudget({}).varianteBLabel, "kit:carry-through");
  assert.equal(ladePruefLaufBudget({}).label, "kit:check");
});

test("Ein selbst gewaehlter deutscher Wert bleibt, wie er steht", () => {
  assert.equal(ladeKetteBudget({ night: { kette: { varianteBLabel: "kit:durchziehen" } } }).varianteBLabel, "kit:durchziehen");
  assert.equal(ladePruefLaufBudget({ pruefLauf: { label: "kit:pruefen" } }).label, "kit:pruefen");
});
