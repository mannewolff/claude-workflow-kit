// Was passiert, wenn checks.mjs nicht neben night.mjs liegt (Issue #498).
//
// night.mjs holt `zusammenfassungPfad` aus checks.mjs und rechnet den Ort der
// Pruef-Zusammenfassung NICHT nach (Issue #428). Fehlt der Nachbar, bleibt ein
// Ersatz stehen, der wirft — auch hier gilt die Zusage aus Issue #170: Das Laden
// gelingt, erst der Aufruf meldet den fehlenden Nachbarn.
//
// Der Hook NIGHT_NACHBAR_DIR zeigt hier auf ein Verzeichnis, in dem board.mjs liegt
// (als Symlink auf die echte Datei), checks.mjs aber nicht. Damit ist belegt, dass
// die beiden `existsSync`-Ternaere unabhaengig voneinander greifen: Die
// Board-Bindungen sind die echten Funktionen, nur der Checks-Ersatz steht.
//
// Eigene Testdatei je Szenario (Issue #498) — der Hook wird beim Laden gelesen, und
// `import()` derselben URL liefert danach die gecachte Instanz.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const nurBoard = mkdtempSync(join(tmpdir(), "night-ohne-checks-"));
symlinkSync(join(repoRoot, "kit", "board.mjs"), join(nurBoard, "board.mjs"));
assert.equal(existsSync(join(nurBoard, "checks.mjs")), false, "checks.mjs darf nicht existieren");

process.env.NIGHT_NACHBAR_DIR = nurBoard;
const night = await import(pathToFileURL(join(repoRoot, "kit", "night.mjs")).href);
const board = await import(pathToFileURL(join(repoRoot, "kit", "board.mjs")).href);
rmSync(nurBoard, { recursive: true, force: true });

test("[night-6] ohne checks.mjs wirft der Ersatz fuer zusammenfassungPfad", () => {
  assert.throws(() => night.nachbarn.zusammenfassungPfad(repoRoot), /checks\.mjs liegt nicht neben night\.mjs/);
  assert.throws(
    () => night.nachbarn.zusammenfassungPfad(repoRoot),
    /der Ort der Pruef-Zusammenfassung ist unbekannt/,
  );
});

test("[night-6] der Hook laedt board.mjs aus dem angegebenen Verzeichnis, nicht den Ersatz", () => {
  // Der Symlink zeigt auf die echte Datei; Node loest ihn beim Import auf. Waere
  // hier der Ersatz gebunden, waere die Gleichheit verletzt — und der Test wuerde
  // nicht merken, dass beide Ternaere zusammen gefallen sind.
  assert.equal(night.nachbarn.parsePruefvorgabe, board.parsePruefvorgabe);
  assert.equal(night.nachbarn.fenceLauf, board.fenceLauf);
});
