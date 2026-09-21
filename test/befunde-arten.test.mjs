// Die feste Liste der Mangel-Arten und die Aufrufkanten von kit/befunde.mjs
// (Issue #799, Plan #797, Fachliche Quelle #768).
//
// Die Liste hat genau einen Wortlaut im Kit (Plan E4): dieses Kommando. Der Regeltext
// in templates/CLAUDE-workflow.md zaehlt die Arten deshalb bewusst nicht auf, sondern
// verweist auf `befunde arten` — zwei Orte driften auseinander, sobald eine Art
// hinzukommt oder ihren Namen wechselt, und die Formpruefung laege dann gegen einen
// anderen Wortlaut als der Prompt.
//
// Die zweite Zusage dieser Datei ist die Ausgabeform: JEDES Kommando gibt JSON auf
// stdout aus, auch im Leerfall und auch bei einem abgewiesenen Aufruf. Ein
// Fliesstext-Fehler mittendrin machte aus jedem Fehlerfall einen Parse-Fehler beim
// Aufrufer — dieselbe Zusage wie in kit/aufwand.mjs und kit/wirksamkeit.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFUNDE = join(repoRoot, "kit", "befunde.mjs");

// Die zwoelf Arten in der Reihenfolge des Arbeitspakets. Bewusst hier ausgeschrieben
// und nicht aus dem Modul importiert: Ein Test, der seine Erwartung aus dem Pruefling
// zieht, belegt nur, dass der Pruefling mit sich selbst uebereinstimmt.
const ERWARTET = [
  "bestandsbehauptung",
  "unbeobachtbar",
  "widerspruch",
  "luecke",
  "unbestimmt",
  "form",
  "doppelung",
  "korrektheit",
  "sicherheit",
  "test",
  "konvention",
  "sonstiges",
];

function befunde(...args) {
  return spawnSync(process.execPath, [BEFUNDE, ...args], { cwd: repoRoot, encoding: "utf-8" });
}

test("arten gibt genau die zwoelf Arten mit je einem erklaerenden Satz aus", () => {
  const res = befunde("arten");

  assert.equal(res.status, 0, `arten schlug fehl: ${res.stderr}`);
  const json = JSON.parse(res.stdout);
  assert.equal(json.ok, true);
  assert.deepEqual(json.arten.map((a) => a.name), ERWARTET);
  assert.equal(json.anzahl, 12);
  for (const art of json.arten) {
    assert.ok(art.erklaerung && art.erklaerung.trim().length > 10,
      `die Art '${art.name}' traegt keinen erklaerenden Satz`);
  }
});

test("arten fuehrt die Auffang-Art 'sonstiges'", () => {
  // Ohne Auffang-Art muesste ein Reviewer bei einem unpassenden Fund raten oder eine
  // eigene Art erfinden — und genau das soll die feste Liste verhindern.
  const json = JSON.parse(befunde("arten").stdout);
  const sonstiges = json.arten.find((a) => a.name === "sonstiges");
  assert.ok(sonstiges, "die Auffang-Art fehlt");
});

test("arten nimmt keine Argumente an und weist den Aufruf als JSON ab", () => {
  const res = befunde("arten", "--alles");

  assert.notEqual(res.status, 0, "ein abgewiesener Aufruf endet ungleich 0");
  const json = JSON.parse(res.stdout);
  assert.equal(json.ok, false);
  assert.match(json.fehler, /--alles/);
});

test("ohne Kommando steht JSON auf stdout und der Exit-Code ist ungleich 0", () => {
  const res = befunde();

  assert.notEqual(res.status, 0, "ein Aufruf ohne Kommando ist ein Fehler");
  const json = JSON.parse(res.stdout);
  assert.equal(json.ok, false);
  assert.match(json.fehler, /Kommando/);
});

test("ein unbekanntes Kommando steht als JSON auf stdout und endet ungleich 0", () => {
  const res = befunde("buchen");

  assert.notEqual(res.status, 0);
  const json = JSON.parse(res.stdout);
  assert.equal(json.ok, false);
  assert.match(json.fehler, /buchen/);
});

test("--help und --version bleiben Textausgaben mit Exit 0", () => {
  // Die Ausnahme von der JSON-Regel, und die einzige: Beide richten sich an einen
  // Menschen am Terminal, nicht an einen Aufrufer — wie in kit/wirksamkeit.mjs.
  const hilfe = befunde("--help");
  assert.equal(hilfe.status, 0, hilfe.stderr);
  assert.match(hilfe.stdout, /befunde\.mjs/);
  assert.match(hilfe.stdout, /pruefen/);

  const version = befunde("--version");
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});
