// Die Raender der Argumentpruefung und der Ausgabe von `spec.mjs` (Issue #500).
//
// Was hier steht, ist einzeln unspektakulaer und zusammen der Unterschied
// zwischen "geprueft" und "noch nie gelaufen": ein vertipptes Argument, ein
// Schalter ohne Wert, die Einzahl im Ergebnissatz, eine gestrichene Aussage ohne
// Klammerzusatz. Jeder dieser Pfade ist ein Weg, auf dem ein Aufruf falsch
// verstanden werden koennte — und genau deshalb sind sie Fehler und keine stille
// Auslassung.
//
// Gemessen wird an Exit-Code und Meldung, ueber die CLI. Die eine Ausnahme ist
// `vergleicheText`: Die Funktion ist exportiert (#493), und ihr Gleichheitsfall
// laesst sich ueber eine sortierte Liste nicht sichtbar machen — zwei gleiche
// Bereichsnamen gibt es im Dateisystem nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitFixture, spec, configSchreiben, dateiSchreiben, paketSchreiben } from "./helpers/spec-fixture.mjs";
import { vergleicheText } from "../kit/spec.mjs";

const SPEC_BLOCK = { seit: "2026-09-02", bereiche: { alpha: ["kit/**"] } };

/** Ein Wegwerf-Verzeichnis mit Config, ohne specs/. */
function mitProjekt(specBlock, fn) {
  mitFixture(null, (dir) => {
    configSchreiben(dir, specBlock === null ? {} : { spec: specBlock });
    fn(dir);
  });
}

// --- vergleicheText ---------------------------------------------------------

test("vergleicheText kennt drei Ausgaenge, auch die Gleichheit", () => {
  assert.equal(vergleicheText("a", "b"), -1);
  assert.equal(vergleicheText("b", "a"), 1);
  assert.equal(vergleicheText("a", "a"), 0,
    "zwei gleiche Texte sind gleich — ohne diesen Ausgang waere die Sortierung nicht stabil definiert");
});

// --- check: die Schalter ----------------------------------------------------

test("check mit einem unbekannten Schalter: Exit 1 und die Meldung nennt die erwarteten", () => {
  mitProjekt(SPEC_BLOCK, (dir) => {
    const res = spec(dir, "check", "--pakett", "irgendwas.md");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unerwartetes Argument: '--pakett'/);
    assert.match(res.stderr, /--paket oder --anker/,
      "wer sich vertippt hat, soll die richtige Schreibweise sehen, ohne die Hilfe zu suchen");
  });
});

test("check --paket ohne Wert: Exit 1, der Folgeschalter gilt nicht als Wert", () => {
  mitProjekt(SPEC_BLOCK, (dir) => {
    const res = spec(dir, "check", "--paket", "--anker");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /'--paket' braucht einen Wert/);
  });
});

// --- check --paket ohne 'spec.bereiche' -------------------------------------

test("ein spec-Block ohne 'bereiche': NEU wird abgewiesen und die Meldung sagt 'keiner'", () => {
  // 'bereiche' ist im Schema optional. Fehlt es, ist kein Bereich bekannt — dann
  // darf keine NEU-Zeile durchgehen, und die Aufzaehlung der bekannten Bereiche
  // darf nicht als leerer Rest dastehen, sondern sagt, dass es keinen gibt.
  mitProjekt({ seit: "2026-09-02" }, (dir) => {
    const pfad = paketSchreiben(dir, "## Spec-Wirkung\n\nNEU alpha alpha-1 — Der Lauf meldet den Grund.\n");
    const res = spec(dir, "check", "--paket", pfad);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unbekannter Bereich 'alpha'/);
    assert.match(res.stderr, /Bekannt sind: keiner\./,
      "eine leere Aufzaehlung saehe aus wie ein abgeschnittener Satz");
  });
});

// --- check --paket: die Abschnittsgrenze ------------------------------------

test("der Abschnitt reicht bis zum Dateiende, wenn keine weitere '## '-Zeile folgt", () => {
  mitProjekt(SPEC_BLOCK, (dir) => {
    const pfad = paketSchreiben(dir, "## Aufgabe\n\nEtwas tun.\n\n## Spec-Wirkung\n\nKEINE — reines Aufraeumen.\n");
    const res = spec(dir, "check", "--paket", pfad);
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
    assert.match(res.stdout, /ohne Befund/);
  });
});

// --- vorhaben: die Schalter -------------------------------------------------

test("vorhaben mit einem vertippten Schalter: Exit 1 statt stiller Auslassung", () => {
  // Ein vertipptes '--kuerzl' saehe sonst aus wie ein fehlendes Kuerzel, und die
  // Meldung wiese in die falsche Richtung.
  mitProjekt(SPEC_BLOCK, (dir) => {
    const res = spec(dir, "vorhaben", "--kuerzl", "umbau", "--code-gelesen", "ja");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unerwartetes Argument: '--kuerzl'/);
    assert.match(res.stderr, /--kuerzel, --code-gelesen, --grund/);
  });
});

test("vorhaben --kuerzel ohne Wert: der folgende Schalter gilt nicht als Kuerzel", () => {
  mitProjekt(SPEC_BLOCK, (dir) => {
    const res = spec(dir, "vorhaben", "--kuerzel", "--code-gelesen");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /'--kuerzel' braucht einen Wert/);
  });
});

// --- index: die Einzahl -----------------------------------------------------

test("index bei genau einem Bereich sagt 'Bereich', nicht 'Bereiche'", () => {
  mitFixture(null, (dir) => {
    dateiSchreiben(dir, "specs/alpha.md", "# Alpha\n\n- alpha-1 — Der Lauf meldet den Grund.\n");
    const res = spec(dir, "index");
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
    assert.match(res.stdout, /geschrieben: 1 Bereich\./);
  });
});

// --- show: die entfallene Aussage ohne Klammerzusatz -------------------------

test("show nennt eine gestrichene Aussage ohne Zusatz als 'ohne Datum und Paketnummer'", () => {
  // Ueber den Status entscheidet die Position zur Ueberschrift, nie das Suffix:
  // Eine Zeile unter '## Entfallen' ohne Klammerzusatz ist gestrichen. `show`
  // sagt dann, was es nicht weiss, statt Datum und Paket zu erfinden.
  mitFixture(null, (dir) => {
    dateiSchreiben(dir, "specs/alpha.md",
      "# Alpha\n\n- alpha-1 — Der Lauf meldet den Grund.\n\n## Entfallen\n\n- alpha-2 — Das galt einmal.\n");
    const res = spec(dir, "show", "alpha-2");
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
    assert.match(res.stdout, /Status: {2}entfallen \(ohne Datum und Paketnummer\)/);
    assert.match(res.stdout, /alpha-2 — Das galt einmal\./,
      "der Aussagetext bleibt vollstaendig, auch ohne Zusatz");
  });
});

// --- Der unerwartete Fehler -------------------------------------------------

test("ein Fehler, der nicht aus spec.mjs stammt, wird als 'Unerwarteter Fehler' gemeldet", () => {
  // specs/ als Datei statt als Verzeichnis: existsSync sagt ja, readdirSync
  // scheitert mit ENOTDIR. Das ist kein Befund des Werkzeugs, und die Meldung
  // sagt genau das — ein 'Fehler:' davor behauptete eine gepruefte Lage.
  mitFixture(null, (dir) => {
    dateiSchreiben(dir, "specs", "keine Beschreibung, sondern eine Datei\n");
    const res = spec(dir, "index");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Unerwarteter Fehler: /);
    assert.equal(res.stdout, "", "auf stdout gehoert nur ein Ergebnis");
  });
});
