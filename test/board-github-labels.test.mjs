// Labels des GitHub-Trackers (Issue #180).
//
// `gh project item-list` liefert pro Item nur body, number, repository, title, type
// und url — kein labels-Feld, und ein Flag zur Feldauswahl gibt es nicht. Die Labels
// muessen deshalb ueber einen zweiten Aufruf nachbeschafft und den Items zugeordnet
// werden. Genau diese Zuordnung ist die einzige nicht-triviale Logik daran.
//
// Die Adapter-Klassen sind bewusst nicht exportiert (CLI-Nebenwirkungen); getestet
// wird wie bei board-labels/board-auth die reine, exportierte Funktion.

import { test } from "node:test";
import assert from "node:assert/strict";

import { labelMapFrom, withLabels } from "../kit/board.mjs";

// --- labelMapFrom: Rohantwort von `gh issue list --json number,labels` -> Map ---

test("labelMapFrom: gh-Form (Array von {name}-Objekten) wird zu Namen normalisiert", () => {
  const map = labelMapFrom([{ number: 7, labels: [{ name: "kit:nightrun" }, { name: "fix" }] }]);
  assert.deepEqual(map.get("7"), ["kit:nightrun", "fix"]);
});

test("labelMapFrom: Nummern werden als Strings geschluesselt", () => {
  // Die Items tragen ihre id als String; ein Zahlen-Schluessel wuerde nie treffen.
  const map = labelMapFrom([{ number: 42, labels: [] }]);
  assert.ok(map.has("42"), "Schluessel 42 fehlt als String");
});

test("labelMapFrom: Issue ohne Labels -> leeres Array, nicht undefined", () => {
  const map = labelMapFrom([{ number: 1, labels: [] }, { number: 2 }]);
  assert.deepEqual(map.get("1"), []);
  assert.deepEqual(map.get("2"), []);
});

test("labelMapFrom: leere oder fehlende Antwort -> leere Map", () => {
  assert.equal(labelMapFrom([]).size, 0);
  assert.equal(labelMapFrom(undefined).size, 0);
  assert.equal(labelMapFrom(null).size, 0);
});

test("labelMapFrom: Eintraege ohne Nummer werden uebersprungen", () => {
  const map = labelMapFrom([null, {}, { labels: [{ name: "x" }] }, { number: 3, labels: [] }]);
  assert.equal(map.size, 1);
  assert.ok(map.has("3"));
});

// --- withLabels: Items anreichern ---

test("withLabels: Treffer wird uebernommen", () => {
  const items = [{ id: "7", title: "A", labels: [] }];
  const map = new Map([["7", ["kit:nightrun"]]]);
  assert.deepEqual(withLabels(items, map)[0].labels, ["kit:nightrun"]);
});

test("withLabels: fehlende Nummer bleibt bei leerem Array", () => {
  // Der Nachschlag darf nie zu undefined fuehren — hasLabel im Nacht-Runner
  // wuerde sonst auf einem fehlenden Feld arbeiten.
  const items = [{ id: "9", title: "B", labels: [] }];
  assert.deepEqual(withLabels(items, new Map())[0].labels, []);
});

test("withLabels: die Reihenfolge der Items bleibt erhalten", () => {
  // Board-Reihenfolge aus dem Project (Issue #128) — ein Re-Sort durch den
  // Nachschlag wuerde die Abarbeitungsreihenfolge des Nacht-Runners kippen.
  const items = [{ id: "5" }, { id: "3" }, { id: "9" }];
  const map = new Map([["3", ["a"]], ["9", ["b"]], ["5", ["c"]]]);
  assert.deepEqual(withLabels(items, map).map((i) => i.id), ["5", "3", "9"]);
});

test("withLabels: die uebrigen Felder bleiben unangetastet", () => {
  const items = [{ id: "7", title: "A", body: null, status: "ready", labels: [] }];
  const angereichert = withLabels(items, new Map([["7", ["fix"]]]))[0];
  assert.equal(angereichert.title, "A");
  assert.equal(angereichert.status, "ready");
  assert.equal(angereichert.body, null);
});

test("withLabels: leere Item-Liste -> leere Liste", () => {
  assert.deepEqual(withLabels([], new Map()), []);
  assert.deepEqual(withLabels(undefined, new Map()), []);
});
