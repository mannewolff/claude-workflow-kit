// `spec.mjs index` — der Index ueber die Bereiche (Issue #440).
//
// Der Index wird VOLLSTAENDIG neu geschrieben, nie gemergt: Ein zusammengefuehrter
// Index behielte die Zeile eines geloeschten Bereichs, und ein Verzeichnis, das
// es nicht mehr gibt, bliebe als Eintrag stehen — schlimmer als kein Index.
//
// Die zweite Eigenschaft ist die Wiederholbarkeit: Zwei Laeufe ohne Aenderung
// erzeugen byte-gleiche Dateien. Ohne sie erschiene der Index nach jedem Lauf
// als Aenderung im Working Tree und der harte Stopp auf dirty (Issue #152)
// griffe bei jedem Nachtlauf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mitFixture, spec, indexText } from "./helpers/spec-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Nur die Datenzeilen der Tabelle — ohne Kopf-, Trenn- und Leerzeilen. */
function bereichsZeilen(text) {
  return text
    .split("\n")
    .filter((z) => z.startsWith("|"))
    .filter((z) => !z.includes("Bereich") && !/^\|\s*-/.test(z));
}

test("ohne specs/: index sagt das und endet mit Exit 0", () => {
  mitFixture(null, (dir) => {
    const res = spec(dir, "index");

    assert.equal(res.status, 0, `ein fehlendes specs/ ist kein Fehler: ${res.stderr}`);
    assert.match(res.stdout + res.stderr, /specs/, "die Meldung nennt das fehlende Verzeichnis nicht");
    assert.equal(existsSync(join(dir, "specs")), false,
      "index haette specs/ nicht anlegen duerfen — das Verzeichnis entsteht erst mit dem ersten Bereich");
  });
});

test("zwei Bereiche: je eine Zeile mit den richtigen Zahlen, alphabetisch", () => {
  mitFixture("zwei-bereiche", (dir) => {
    const res = spec(dir, "index");
    assert.equal(res.status, 0, `index schlug fehl: ${res.stderr}`);

    const text = indexText(dir);
    assert.match(text, /^# Spec-Index$/m, "die Kopfzeile fehlt");
    assert.match(text, /^\| Bereich \| Datei \| Gueltig \| Entfallen \|$/m, "die Tabellen-Kopfzeile fehlt");

    assert.deepEqual(bereichsZeilen(text), [
      "| alpha | specs/alpha.md | 3 | 1 |",
      "| beta | specs/beta.md | 1 | 0 |",
    ]);
  });
});

test("INDEX.md und specs/vorhaben/ sind keine Bereiche", () => {
  mitFixture("zwei-bereiche", (dir) => {
    assert.equal(spec(dir, "index").status, 0);

    const text = indexText(dir);
    assert.doesNotMatch(text, /\| INDEX \|/, "INDEX.md wurde als Bereich gezaehlt");
    assert.doesNotMatch(text, /vorhaben/, "specs/vorhaben/ wurde als Bereich gezaehlt");
  });
});

test("der Index wird vollstaendig neu geschrieben: ein entfernter Bereich verschwindet", () => {
  mitFixture("zwei-bereiche", (dir) => {
    // Die Fixture bringt eine veraltete INDEX.md mit, die einen Bereich 'gamma'
    // nennt, den es nicht mehr gibt.
    assert.match(indexText(dir), /gamma/, "die Fixture bringt den veralteten Eintrag nicht mit");

    assert.equal(spec(dir, "index").status, 0);
    assert.doesNotMatch(indexText(dir), /gamma/,
      "der Eintrag des entfernten Bereichs steht noch im Index — es wurde gemergt statt neu geschrieben");
  });
});

test("zwei Laeufe ohne Aenderung erzeugen byte-gleiche Dateien", () => {
  mitFixture("zwei-bereiche", (dir) => {
    assert.equal(spec(dir, "index").status, 0);
    const ersterLauf = indexText(dir);

    assert.equal(spec(dir, "index").status, 0);
    assert.equal(indexText(dir), ersterLauf, "der zweite Lauf hat die Datei veraendert");
  });
});

test("specs/ ohne Bereichsdatei: der Index entsteht mit leerer Tabelle", () => {
  mitFixture("leer", (dir) => {
    const res = spec(dir, "index");

    assert.equal(res.status, 0, `index schlug fehl: ${res.stderr}`);
    const text = indexText(dir);
    assert.match(text, /^\| Bereich \| Datei \| Gueltig \| Entfallen \|$/m, "die Tabellen-Kopfzeile fehlt");
    assert.deepEqual(bereichsZeilen(text), [], "die Tabelle haette leer bleiben muessen");
  });
});

test("index schreibt ausschliesslich ins Arbeitsverzeichnis, nie in den Repo-Baum", () => {
  // Die Leitplanke zu diesen Tests selbst: `index` ist das einzige schreibende
  // Kommando des Kits, das ohne Anker arbeitet. Veraenderte ein Testlauf specs/ im
  // Repo, meldete der naechste git status eine Aenderung, die niemand gemacht hat.
  //
  // Geprueft wird der ZUSTAND VORHER GEGEN NACHHER, nicht die Abwesenheit von specs/:
  // Seit Issue #453 fuehrt dieses Repo ein eigenes, versioniertes specs/. Ein Test auf
  // `existsSync(...) === false` wuerde ab da rot, ohne dass ein Testlauf etwas
  // angefasst haette — er verwechselte "der Test hat geschrieben" mit "es gibt es".
  const vorher = existsSync(join(repoRoot, "specs"));

  mitFixture("zwei-bereiche", (dir) => {
    assert.equal(spec(dir, "index").status, 0);
    assert.ok(readdirSync(join(dir, "specs")).includes("INDEX.md"), "im Fixture entstand kein Index");
  });

  assert.equal(existsSync(join(repoRoot, "specs")), vorher,
    "die Testlaeufe haben den Zustand von specs/ im Repo-Baum veraendert");
});
