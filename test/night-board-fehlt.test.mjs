// Was passiert, wenn board.mjs nicht neben night.mjs liegt (Issue #394, #498).
//
// night.mjs holt sich `fenceLauf` und die drei Praefix-Pruefer
// vom Nachbarn und haelt fuer den Fall, dass dort nichts liegt, Ersatzfunktionen
// bereit, die WERFEN. Der Grund steht in Issue #170: Ein statischer Import scheitert
// vor der ersten Zeile Code und nimmt dem Runner genau die Auskunft, dass board.mjs
// fehlt. Und geworfen wird statt `false` geliefert, weil ein stilles `false` ein
// Plandokument als Arbeitspaket durchliesse.
//
// Erreicht wird der Fall seit Issue #498 ueber den Test-Hook NIGHT_NACHBAR_DIR: Er
// zeigt auf ein leeres Verzeichnis, und die ECHTE Datei kit/night.mjs laeuft — ihre
// Treffer fallen damit in der Abdeckung auf kit/night.mjs. Vorher stand hier eine
// Kopie im Temp-Verzeichnis, deren Treffer SonarCloud nicht abbilden konnte.
//
// Eigene Testdatei je Szenario (Issue #498): Der Hook wird beim Laden gelesen, und
// `import()` derselben URL liefert danach die gecachte Instanz. Ein Testfile, das
// erst mit und dann ohne Hook importiert, prueft zweimal dieselbe Instanz und faellt
// still nicht auf. `node --test` startet je Datei einen Prozess; deshalb wird die
// Variable hier vor dem ersten dynamischen `import` gesetzt — nie ueber eine
// statische `import`-Zeile, die vorher liefe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = mkdtempSync(join(tmpdir(), "night-ohne-board-"));
assert.equal(existsSync(join(leer, "board.mjs")), false, "der Nachbar darf nicht existieren");

process.env.NIGHT_NACHBAR_DIR = leer;
// Die Zusage aus Issue #170 in Reinform: Das Laden gelingt ohne Nachbarn. Waere das
// nicht so, schluege schon diese Zeile fehl — und keiner der Tests unten liefe.
const night = await import(pathToFileURL(join(repoRoot, "kit", "night.mjs")).href);
rmSync(leer, { recursive: true, force: true });

test("[night-6] ohne Nachbarn gelingt das Laden von night.mjs — erst der Aufruf wirft", () => {
  assert.equal(typeof night.nachbarn.fenceLauf, "function");
  assert.throws(() => night.nachbarn.fenceLauf(), /board\.mjs fehlt neben night\.mjs/);
});

test("[night-6] ohne board.mjs wirft der Ersatz fuer istFachlich", () => {
  assert.throws(() => night.nachbarn.istFachlich("[Fachlich] Etwas"), /das Praefix \[Fachlich\] ist nicht erkennbar/);
});

test("[night-6] ohne board.mjs wirft der Ersatz fuer istPlan", () => {
  assert.throws(() => night.nachbarn.istPlan("[Plan] Etwas"), /das Praefix \[Plan\] ist nicht erkennbar/);
});

test("[night-6] ohne board.mjs wirft der Ersatz fuer istIdee", () => {
  assert.throws(() => night.nachbarn.istIdee("[Idee] Etwas"), /das Praefix \[Idee\] ist nicht erkennbar/);
});

test("[night-16] ohne board.mjs braucht reviewFreigabe den Nachbarn nicht: ohne Marker ungeprueft", () => {
  // Seit Plan #638 (A17) liest das Gate nur den Marker; eine Pruefvorgabe-Zeile wird
  // nicht mehr geparst und kann darum auch ohne Nachbarn nichts werfen.
  const freigabe = night.reviewFreigabe("## Kontext\nPruefung: 3\n");
  assert.deepEqual(freigabe, { frei: false, art: "ungeprueft" });
  assert.deepEqual(night.reviewFreigabe("## Kontext\nIssue-Review: x\n"), { frei: true, art: "marker" });
});

