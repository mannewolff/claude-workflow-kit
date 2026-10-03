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
  assert.equal(night.nachbarn.istFachlich, board.istFachlich);
  assert.equal(night.nachbarn.istPlan, board.istPlan);
  assert.equal(night.nachbarn.istIdee, board.istIdee);
  assert.equal(night.nachbarn.istMensch, board.istMensch);
  // Seit Issue #1062 (Plan #1057, E1) liest der Runner die Herkunft seiner Abhaengigkeiten
  // mit derselben Funktion wie die Schreibwege in board.mjs — eine Kopie liefe auseinander.
  assert.equal(night.nachbarn.abhaengigkeitenMitHerkunft, board.abhaengigkeitenMitHerkunft);
  // Seit Issue #1046 (Plan #987, E1) erkennt das Gate geschuetzte Dateien mit denselben
  // Funktionen wie `issue check-geschuetzt` — Treffer, Halt-Text und Freigabe. Der Halt-Text
  // ist zugleich das Leseformat der Freigabe; eine Kopie hier liesse die Karte gesperrt.
  assert.equal(night.nachbarn.geschuetzteTreffer, board.geschuetzteTreffer);
  assert.equal(night.nachbarn.geschuetztKommentar, board.geschuetztKommentar);
  assert.equal(night.nachbarn.geschuetztFreigabe, board.geschuetztFreigabe);
  // Seit Plan #638 sind das die einzigen Bindungen an board.mjs: Pruefvorgabe,
  // Pruefzustand, Rundengrenze und Kopfzeilen-Muster sind mit den Nachtmodi entfallen.
  assert.deepEqual(Object.keys(night.nachbarn).sort(),
    ["abhaengigkeitenMitHerkunft", "fenceLauf", "geschuetztFreigabe", "geschuetztKommentar", "geschuetzteTreffer",
      "istFachlich", "istIdee", "istMensch", "istPlan", "zusammenfassungPfad"]);
});

test("[night-6] ohne Hook stammt zusammenfassungPfad aus checks.mjs", () => {
  assert.equal(night.nachbarn.zusammenfassungPfad, checks.zusammenfassungPfad);
});
