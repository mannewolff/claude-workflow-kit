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
  const blocks = parseVersions(entries, "2026-07-06");
  // Neueste Version zuerst.
  assert.equal(blocks[0].version, "1.17.1");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["12"]);
  // v1.16.1 und v1.17.0 folgen unmittelbar aufeinander -> ein Block, hoechste
  // Version. Siehe "aufeinanderfolgende Marken" unten.
  assert.equal(blocks[1].version, "1.17.0");
  // Innerhalb einer Version: neueste zuerst.
  assert.deepEqual(blocks[1].items.map((i) => i.ref), ["11", "10"]);
});

// Issue #245: Ein Versionsblock traegt die Version, unter der die Aenderungen
// VEROEFFENTLICHT wurden. Beim `merge production`-Trigger folgt der Minor-Bump
// unmittelbar auf den letzten Patch-Bump; ohne Zusammenfassung blieb der
// Minor-Block leer und verschwand — und damit ausgerechnet jede Version, die
// jemals ausgeliefert wurde.

test("zwei unmittelbar aufeinanderfolgende Marken ergeben einen Block mit der hoeheren Version", () => {
  const blocks = parseVersions([
    { date: "2026-08-06", subject: "Ein Feature (Issue #241)" },
    { date: "2026-08-07", subject: "chore: v1.34.1" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
  ], "2026-08-07");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].version, "1.35.0");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["241"]);
});

test("drei aufeinanderfolgende Marken ergeben ebenfalls einen Block mit der hoechsten", () => {
  const blocks = parseVersions([
    { date: "2026-08-06", subject: "Ein Feature (Issue #241)" },
    { date: "2026-08-07", subject: "chore: v1.33.1" },
    { date: "2026-08-07", subject: "chore: v1.34.0" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
  ], "2026-08-07");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].version, "1.35.0");
});

test("der zusammengefasste Block traegt das Datum des Bump-Commits der hoechsten Version", () => {
  const blocks = parseVersions([
    { date: "2026-08-05", subject: "Ein Feature (Issue #241)" },
    { date: "2026-08-06", subject: "chore: v1.34.1" },
    { date: "2026-08-09", subject: "chore: v1.35.0" },
  ], "2026-08-09");
  assert.equal(blocks[0].date, "2026-08-09");
});

test("Marken mit Commits dazwischen bleiben getrennte Bloecke", () => {
  const blocks = parseVersions([
    { date: "2026-08-05", subject: "Feature A (Issue #10)" },
    { date: "2026-08-06", subject: "chore: v1.34.1" },
    { date: "2026-08-06", subject: "Feature B (Issue #11)" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
  ], "2026-08-07");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.version), ["1.35.0", "1.34.1"]);
});

test("aufeinanderfolgende Marken ganz am Anfang erzeugen keinen leeren Block", () => {
  // Vor der ersten Marke liegen keine Commits — es gibt nichts zuzuordnen, und
  // ein Upgrade duerfte hier nicht auf einen nicht existierenden Block greifen.
  const blocks = parseVersions([
    { date: "2026-08-05", subject: "chore: v1.34.0" },
    { date: "2026-08-05", subject: "chore: v1.34.1" },
    { date: "2026-08-06", subject: "Ein Feature (Issue #12)" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
  ], "2026-08-07");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].version, "1.35.0");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["12"]);
});

test("(Issue #N) wird aus dem Text geloest und als ref extrahiert", () => {
  const blocks = parseVersions([
    { date: "2026-07-02", subject: "Nacht-Runner: harter Stopp (Issue #149)" },
    { date: "2026-07-03", subject: "chore: v1.17.1" },
  ], "2026-07-03");
  assert.equal(blocks[0].items[0].text, "Nacht-Runner: harter Stopp");
  assert.equal(blocks[0].items[0].ref, "149");
});

test("Commits nach dem letzten chore-Bump landen im obersten Block unter [Unreleased]", () => {
  // Bis Issue #265 trug dieser Block die Version aus install.mjs. Das war falsch,
  // sobald sie bereits als Marke vergeben war — und genau das ist sie nach jedem
  // Release, bis der naechste Bump kommt.
  const blocks = parseVersions([
    { date: "2026-07-02", subject: "chore: v1.19.0" },
    { date: "2026-07-03", subject: "Noch nicht gebumpt (Issue #99)" },
  ], "2026-07-27");
  assert.equal(blocks[0].version, "Unreleased");
  assert.equal(blocks[0].date, "2026-07-27");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["99"]);
});

test("Merge-Commits werden defensiv gefiltert (falls sie durchrutschen)", () => {
  const blocks = parseVersions([
    { date: "2026-07-02", subject: "Merge pull request #148 from mannewolff/main" },
    { date: "2026-07-02", subject: "Echtes Feature (Issue #50)" },
    { date: "2026-07-03", subject: "chore: v1.18.0" },
  ], "2026-07-03");
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

// --- Issue #265: unveroeffentlichte Commits bekommen keine vergebene Nummer ---
//
// Der oberste Block trug bisher `currentVersion` aus install.mjs. Steht die
// bereits als Marke in der Historie — der Normalfall direkt nach einem Release —,
// entstanden zwei Bloecke mit derselben Nummer. Beobachtet am 2026-08-08 nach dem
// ersten Commit hinter `chore: v1.35.0`.

test("Commits ohne eigene Marke stehen unter [Unreleased], nicht unter der letzten Version", () => {
  const blocks = parseVersions([
    { date: "2026-08-07", subject: "Fertig veroeffentlicht (Issue #10)" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
    { date: "2026-08-08", subject: "Noch nicht gebumpt (Issue #11)" },
  ], "2026-08-08");
  assert.equal(blocks[0].version, "Unreleased");
  assert.deepEqual(blocks[0].items.map((i) => i.ref), ["11"]);
  assert.equal(blocks[1].version, "1.35.0");
});

test("keine zwei Bloecke tragen dieselbe Versionsnummer", () => {
  const blocks = parseVersions([
    { date: "2026-08-06", subject: "A (Issue #1)" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
    { date: "2026-08-08", subject: "B (Issue #2)" },
  ], "2026-08-08");
  const namen = blocks.map((b) => b.version);
  assert.equal(new Set(namen).size, namen.length, `doppelte Ueberschrift: ${namen.join(", ")}`);
});

test("ohne offene Commits gibt es keinen Unreleased-Block", () => {
  const blocks = parseVersions([
    { date: "2026-08-07", subject: "A (Issue #1)" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
  ], "2026-08-08");
  assert.ok(!blocks.some((b) => b.version === "Unreleased"));
  assert.equal(blocks[0].version, "1.35.0");
});

test("die Zusammenfassung aus Issue #245 bleibt unberuehrt", () => {
  // Regressionsschutz: Der Unreleased-Block darf die Marken-Zusammenfassung nicht
  // aushebeln.
  const blocks = parseVersions([
    { date: "2026-08-06", subject: "Ein Feature (Issue #241)" },
    { date: "2026-08-07", subject: "chore: v1.34.1" },
    { date: "2026-08-07", subject: "chore: v1.35.0" },
  ], "2026-08-07");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].version, "1.35.0");
});

test("renderChangelog schreibt Unreleased ohne Datum", () => {
  const md = renderChangelog([
    { version: "Unreleased", date: "2026-08-08", items: [{ text: "Offen", ref: "11" }] },
    { version: "1.35.0", date: "2026-08-07", items: [{ text: "Drin", ref: "10" }] },
  ]);
  assert.match(md, /## \[Unreleased\]\n/, "Unreleased traegt ein Datum, das nichts bedeutet");
  assert.match(md, /## \[1\.35\.0\] - 2026-08-07/);
});
