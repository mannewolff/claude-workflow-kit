// Tests fuer die Changelog-Ableitung aus der Git-Historie (Issue #161).
// parseVersions und renderChangelog sind reine, exportierte Funktionen (das
// git-Lesen und Schreiben lebt in main()); getestet wird wie bei board-labels
// die Logik, nicht die I/O-Schicht.
// Laeuft mit dem eingebauten node:test — keine Dependency: node --test

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseVersions, renderChangelog } from "../tools/changelog.mjs";

// entries chronologisch (aelteste zuerst), wie `git log --reverse` sie liefert.
const entries = [
  { date: "2026-07-01", subject: "chore: v1.16.0" },
  { date: "2026-07-02", subject: "Erstes Feature (Issue #10)" },
  { date: "2026-07-02", subject: "Zweites Feature (Issue #11)" },
  { date: "2026-07-03", subject: "chore: v1.16.1" },
  { date: "2026-07-04", subject: "chore: v1.17.0" }, // leerer Minor-Bump: keine Features davor
  { date: "2026-07-05", subject: "Drittes Feature (Issue #12)" },
  { date: "2026-07-06", subject: "chore: v1.17.1" },
];

test("Features werden dem chore-Bump zugeordnet, der chronologisch auf sie folgt", () => {
  const blocks = parseVersions(entries, "1.17.1", "2026-07-06");
  // Neueste Version zuerst.
  assert.equal(blocks[0].version, "1.17.1");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["12"]);
  assert.equal(blocks[1].version, "1.16.1");
  // Innerhalb einer Version: neueste zuerst.
  assert.deepEqual(blocks[1].items.map((i) => i.ref), ["11", "10"]);
});

test("leere Versionen (kein Feature-Commit davor) erscheinen nicht", () => {
  const blocks = parseVersions(entries, "1.17.1", "2026-07-06");
  assert.ok(!blocks.some((b) => b.version === "1.17.0"), "leerer Minor-Bump v1.17.0 haette uebersprungen werden muessen");
});

test("(Issue #N) wird aus dem Text geloest und als ref extrahiert", () => {
  const blocks = parseVersions([
    { date: "2026-07-02", subject: "Nacht-Runner: harter Stopp (Issue #149)" },
    { date: "2026-07-03", subject: "chore: v1.17.1" },
  ], "1.17.1", "2026-07-03");
  assert.equal(blocks[0].items[0].text, "Nacht-Runner: harter Stopp");
  assert.equal(blocks[0].items[0].ref, "149");
});

test("Commits nach dem letzten chore-Bump landen im obersten Block mit aktueller Version + heute", () => {
  const blocks = parseVersions([
    { date: "2026-07-02", subject: "chore: v1.19.0" },
    { date: "2026-07-03", subject: "Noch nicht gebumpt (Issue #99)" },
  ], "1.19.1", "2026-07-27");
  assert.equal(blocks[0].version, "1.19.1");
  assert.equal(blocks[0].date, "2026-07-27");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["99"]);
});

test("Merge-Commits werden defensiv gefiltert (falls sie durchrutschen)", () => {
  const blocks = parseVersions([
    { date: "2026-07-02", subject: "Merge pull request #148 from mannewolff/main" },
    { date: "2026-07-02", subject: "Echtes Feature (Issue #50)" },
    { date: "2026-07-03", subject: "chore: v1.18.0" },
  ], "1.18.0", "2026-07-03");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["50"]);
});

test("renderChangelog erzeugt Keep-a-Changelog-Format mit verlinkten #N", () => {
  const md = renderChangelog([
    { version: "1.17.1", date: "2026-07-06", items: [{ text: "Drittes Feature", ref: "12" }] },
  ]);
  assert.match(md, /^# Changelog/);
  assert.match(md, /## \[1\.17\.1\] - 2026-07-06/);
  assert.match(md, /- Drittes Feature \(#12\)/);
});
