// Maskierung im Ausfuehrungsprotokoll (Issue #822, Review-Fund 3.5).
//
// Das Protokoll ist zeilen- und tabgetrennt, und `cmd` steht roh dazwischen. Ein
// Kommando mit Zeilenumbruch zerriss deshalb seine eigene Zeile: Aus einer Ausfuehrung
// wurden zwei fehlerhafte Zeilen, und die Pruefung stand in der Auswertung als "nicht
// gelaufen" — genau der Zustand, aus dem niemand etwas lernen kann.
//
// Gewaehlt (Issue #822): Tab, Zeilenumbruch, Wagenruecklauf und Backslash werden beim
// Schreiben als `\t`, `\n`, `\r`, `\\` maskiert und beim Lesen zurueckgewandelt.
// Verworfen: JSONL — das Format bleibt so fuer bestehende Protokolle lesbar, und eine
// Zeile ohne Sonderzeichen liest sich wie bisher.
//
// Der letzte Test faehrt die ganze Strecke: schreiben mit checks.mjs, lesen mit
// wirksamkeit.mjs. Nur dort zeigt sich, ob die beiden Seiten dieselbe Sprache sprechen —
// die Kit-Werkzeuge teilen bewusst kein Modul (#440).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, run, datei, ausfuehrungen } from "./helpers/checks-repo.mjs";
import { wirksamkeit } from "./helpers/wirksamkeit-fixture.mjs";

/** Eine Protokollzeile in ihre vier Spalten zerlegt. */
function spalten(zeile) {
  const [zeit, cmd, ergebnis, dauerMs] = zeile.split("\t");
  return { zeit, cmd, ergebnis, dauerMs };
}

/** Ein Wegwerf-Repo mit genau diesem Kommando als einziger Pruefung. */
function mitKommando(cmd, fn) {
  const config = { buildChecks: [{ cmd, always: true }], checkAreas: { kern: ["src/**"] } };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");
    fn(dir);
  });
}

test("[checks-10] ein mehrzeiliges Kommando bleibt genau eine Protokollzeile", () => {
  mitKommando("echo a\necho b", (dir) => {
    run(dir);

    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen.length, 1, "eine Ausfuehrung, eine Zeile");
    const { cmd, ergebnis, dauerMs } = spalten(zeilen[0]);
    assert.equal(cmd, String.raw`echo a\necho b`, "der Zeilenumbruch steht maskiert im Feld");
    assert.equal(ergebnis, "gruen");
    assert.match(dauerMs, /^\d+$/, "die Spalten dahinter stehen weiter an ihrem Platz");
  });
});

test("[checks-10] ein Tabulator im Kommando wird maskiert und macht keine fuenfte Spalte", () => {
  mitKommando("echo a\tb", (dir) => {
    run(dir);

    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].split("\t").length, 4, "die Zeile hat genau vier Spalten");
    assert.equal(spalten(zeilen[0]).cmd, String.raw`echo a\tb`);
  });
});

test("[checks-10] ein Backslash im Kommando wird verdoppelt, damit die Rueckwandlung eindeutig bleibt", () => {
  mitKommando(String.raw`echo a\nb`, (dir) => {
    run(dir);

    assert.equal(
      spalten(ausfuehrungen(dir)[0]).cmd,
      String.raw`echo a\\nb`,
      String.raw`sonst lase sich ein echtes '\n' im Kommando als Zeilenumbruch zurueck`,
    );
  });
});

test("[checks-10] ein Kommando ohne Sonderzeichen steht unveraendert im Protokoll", () => {
  mitKommando("echo eins", (dir) => {
    run(dir);

    assert.equal(spalten(ausfuehrungen(dir)[0]).cmd, "echo eins", "die Form bestehender Protokolle bleibt");
  });
});

test("[checks-10] ein mehrzeiliges Kommando erscheint in der Auswertung als eine Pruefung mit einer Ausfuehrung", () => {
  const cmd = "echo a\necho b";
  mitKommando(cmd, (dir) => {
    assert.equal(run(dir).status, 0, "Vorbedingung: das Kommando laeuft gruen durch");

    const res = wirksamkeit(dir, "auswerten");

    assert.equal(res.status, 0, res.stderr);
    const e = JSON.parse(res.stdout);
    assert.equal(e.protokoll.fehlerhafteZeilen, 0, "keine zerrissene Zeile");
    const p = e.pruefungen.find((x) => x.cmd === cmd);
    assert.ok(p, `die Pruefung steht unter ihrem echten Text: ${JSON.stringify(e.pruefungen.map((x) => x.cmd))}`);
    assert.equal(p.ausfuehrungen, 1);
    assert.equal(p.zustand, "nie beanstandet");
  });
});
