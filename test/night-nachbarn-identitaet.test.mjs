// Ohne gesetzten Hook sind die Nachbar-Bindungen die ECHTEN Funktionen (Issue #498).
//
// Die beiden anderen Szenarien (test/night-board-fehlt.test.mjs,
// test/night-checks-fehlt.test.mjs) belegen, dass die Ersatzfunktionen werfen. Ohne
// diesen Nachweis hier bliebe offen, ob im Regelbetrieb ueberhaupt jemals die echten
// Funktionen gebunden werden — ein Verhaltensnachweis allein zeigt das nicht. Deshalb
// wird auf Identitaet geprueft und nicht auf ein Ergebnis.
//
// Eigene Testdatei, weil der Hook beim Laden gelesen wird: In einer Datei, die erst
// mit und dann ohne Hook importiert, liefert `import()` beim zweiten Mal die gecachte
// Instanz — der Test prueft dann zweimal dieselbe und faellt still nicht auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Ausdruecklich abgeraeumt: Dieses Szenario ist der Zustand OHNE Hook, und eine von
// aussen gesetzte Variable wuerde ihn unbemerkt verschieben.
delete process.env.NIGHT_NACHBAR_DIR;
const night = await import(pathToFileURL(join(repoRoot, "kit", "night.mjs")).href);
const board = await import(pathToFileURL(join(repoRoot, "kit", "board.mjs")).href);
const checks = await import(pathToFileURL(join(repoRoot, "kit", "checks.mjs")).href);

test("[night-6] ohne Hook stammen die Board-Bindungen aus board.mjs, nicht aus dem Ersatz", () => {
  assert.equal(night.nachbarn.fenceLauf, board.fenceLauf);
  assert.equal(night.nachbarn.parsePruefvorgabe, board.parsePruefvorgabe);
  assert.equal(night.nachbarn.istFachlich, board.istFachlich);
  assert.equal(night.nachbarn.istPlan, board.istPlan);
  assert.equal(night.nachbarn.istIdee, board.istIdee);
});

test("[night-6] ohne Hook stammt zusammenfassungPfad aus checks.mjs", () => {
  assert.equal(night.nachbarn.zusammenfassungPfad, checks.zusammenfassungPfad);
});
