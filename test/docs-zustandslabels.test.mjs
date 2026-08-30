/**
 * docs-zustandslabels.test.mjs — die Doku zu den Zustandslabels (Issue #388).
 *
 * Zwei Labelsorten mit verschiedener Bedeutung stehen jetzt am Board: `review:*`
 * **beschreibt** einen abgeleiteten Zustand und ist jederzeit neu berechenbar,
 * `kit:klaeren` **entscheidet** und bleibt stehen, bis ein Mensch es abnimmt. Wer
 * das verwechselt, entfernt das falsche Label von Hand.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOKU = readFileSync(join(root, "docs", "dokumentation.md"), "utf-8");
const VORLAGE = readFileSync(join(root, "templates", "CLAUDE-workflow.md"), "utf-8");

test("Die Doku nennt alle vier Zustaende", () => {
  for (const z of ["offen", "befunde", "fertig", "ausgefallen"]) {
    assert.match(DOKU, new RegExp("`" + z + "`"), `Zustand ${z} fehlt`);
  }
});

test("Die Doku nennt alle drei Klassen", () => {
  for (const k of ["gate", "alternativen", "korrektur"]) {
    assert.match(DOKU, new RegExp("`" + k + "`"), `Klasse ${k} fehlt`);
  }
});

// Der einzige Zustand, dessen Label nicht gleich heisst — genau deshalb muss er
// in der Tabelle sichtbar sein und nicht nur im Fliesstext.
test("Die Tabelle zeigt ausgefallen -> review:offen", () => {
  const zeile = DOKU.split("\n").find((z) => /^\|.*`ausgefallen`/.test(z));
  assert.ok(zeile, "keine Tabellenzeile fuer `ausgefallen`");
  assert.match(zeile, /`review:offen`/, "die Zeile bildet nicht auf review:offen ab");
});

test("Jede Zustandszeile nennt Ableitungsregel und Label", () => {
  const zeilen = DOKU.split("\n").filter((z) => /^\|\s*`(offen|befunde|fertig|ausgefallen)`/.test(z));
  assert.equal(zeilen.length, 4, `${zeilen.length} Zustandszeilen statt 4`);
  for (const z of zeilen) {
    assert.match(z, /`review:(offen|befunde|fertig)`/, `Zeile ohne Label: ${z}`);
    assert.ok(z.split("|").filter((s) => s.trim()).length >= 3, `Zeile ohne Ableitungsregel: ${z}`);
  }
});

test("Die Doku grenzt beide Labelsorten gegeneinander ab", () => {
  assert.match(DOKU, /beschreib/i, "review:* wird nicht als beschreibend gekennzeichnet");
  assert.match(DOKU, /entscheid/i, "kit:klaeren wird nicht als entscheidend gekennzeichnet");
  assert.match(DOKU, /nur der Mensch|vom Menschen|ein Mensch.{0,40}abnimmt/i,
    "die Abnahme durch den Menschen fehlt");
});

test("Die Doku nennt den Schalter und seinen Default", () => {
  assert.match(DOKU, /issueReview\.statusLabels|"statusLabels"/);
  assert.match(DOKU, /statusLabels[\s\S]{0,400}?(Default|Voreinstellung)[\s\S]{0,40}`?false`?/i);
});

test("Die Doku nennt die Einrichtung je Board fuer alle drei Tracker", () => {
  assert.match(DOKU, /api\/boards\/\{?boardId\}?\/labels|POST \/api\/boards/);
  assert.match(DOKU, /gh label create|GitHub/);
  assert.match(DOKU, /glab label create|GitLab/);
});

test("Die Vorlage nennt Schalter und Einrichtungsschritt in knapper Fassung", () => {
  assert.match(VORLAGE, /statusLabels/);
  assert.match(VORLAGE, /review:offen/);
});
