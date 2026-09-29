// Der Ausloeser im Ausfuehrungsprotokoll (Issue #1004, Plan #1001, E5).
//
// Die Wirksamkeits-Auswertung soll je Bereich Laeufe und Minuten zeigen. Dafuer muss jede
// Zeile sagen, WARUM ihr Kommando lief — und zwar als Daten, nicht als Freitext: Ein
// Parser am Grundtext koppelte die Auswertung an eine Formulierung. Drei Spalten stehen
// dafuer HINTEN, hinter `anlass`, `lauf` und `karte`, damit jede aeltere Zeile lesbar
// bleibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mitRepo, run, datei, ausfuehrungen, ausfuehrungenPfad } from "./helpers/checks-repo.mjs";

/** Eine Protokollzeile in ihre Spalten zerlegt, die drei hinteren seit Issue #1004. */
function spalten(zeile) {
  const [zeit, cmd, ergebnis, dauerMs, anlass, lauf, karte, ausloeser, bereiche, dateien] = zeile.split("\t");
  return { zeit, cmd, ergebnis, dauerMs, anlass, lauf, karte, ausloeser, bereiche, dateien };
}

/** Die Zeile eines Kommandos. */
function zeileVon(dir, cmd) {
  const treffer = ausfuehrungen(dir).map((z) => spalten(z)).filter((z) => z.cmd === cmd);
  assert.equal(treffer.length, 1, `genau eine Zeile fuer '${cmd}'`);
  return treffer[0];
}

const CONFIG = {
  buildChecks: [
    "echo string",
    { cmd: "echo immer", always: true },
    { cmd: "echo kern", areas: ["kern"] },
    { cmd: "echo doku", areas: ["doku"] },
    { cmd: "echo beide", areas: ["kern", "doku"] },
    { cmd: "echo push", areas: ["kern"], stufe: "push" },
    { cmd: "echo merge", areas: ["kern"], stufe: "merge" },
  ],
  checkAreas: { kern: ["src/**"], doku: ["docs/**"] },
};

test("[checks-1004] bereichsgebundene Kommandos tragen 'bereiche' mit den ausloesenden Bereichen", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "src/a.txt");
    datei(dir, "docs/b.md");

    const res = run(dir);

    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(
      [zeileVon(dir, "echo kern").ausloeser, zeileVon(dir, "echo kern").bereiche, zeileVon(dir, "echo kern").dateien],
      ["bereiche", "kern", ""],
    );
    assert.equal(zeileVon(dir, "echo beide").bereiche, "doku,kern", "alle ausloesenden Bereiche, kommagetrennt");
    assert.equal(zeileVon(dir, "echo beide").ausloeser, "bereiche");
  });
});

test("[checks-1004] ein Kommando ohne areas zaehlt als 'ohne-bereich', String wie always", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir);

    for (const cmd of ["echo string", "echo immer"]) {
      const z = zeileVon(dir, cmd);
      assert.deepEqual([z.ausloeser, z.bereiche, z.dateien], ["ohne-bereich", "", ""], cmd);
    }
  });
});

test("[checks-1004] im vollen Umfang zaehlen nur bereichsgebundene Kommandos als 'ohne-zuordnung', mit den Dateien", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "src/a.txt");
    datei(dir, "lose.txt");
    datei(dir, "mit,komma.txt");

    run(dir);

    const kern = zeileVon(dir, "echo kern");
    assert.equal(kern.ausloeser, "ohne-zuordnung");
    assert.equal(kern.bereiche, "");
    assert.equal(kern.dateien, String.raw`lose.txt,mit\,komma.txt`, "ein Komma im Pfad steht maskiert");
    assert.equal(ausfuehrungen(dir)[0].split("\t").length, 10, "die Zeile hat genau zehn Spalten");
    assert.equal(zeileVon(dir, "echo doku").ausloeser, "ohne-zuordnung", "auch der unberuehrte Bereich lief nur wegen der Luecke");
    // Es waere auch ohne die fehlende Zuordnung gelaufen — die Minuten gehoeren nicht der Luecke.
    const string = zeileVon(dir, "echo string");
    assert.deepEqual([string.ausloeser, string.dateien], ["ohne-bereich", ""]);
  });
});

test("[checks-1004] an der Push-Stufe zaehlen bereichsgebundene Kommandos als 'veroeffentlichung'", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir, "--stufe", "push");

    for (const cmd of ["echo kern", "echo doku", "echo push"]) {
      const z = zeileVon(dir, cmd);
      assert.deepEqual([z.ausloeser, z.bereiche, z.dateien], ["veroeffentlichung", "", ""], cmd);
    }
    assert.equal(zeileVon(dir, "echo string").ausloeser, "ohne-bereich");
  });
});

test("[checks-1004] an der Freigabestufe zaehlt die Stufe merge als 'veroeffentlichung', die Paketstufe nach Bereichen", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir, "--stufe", "merge");

    assert.equal(zeileVon(dir, "echo merge").ausloeser, "veroeffentlichung");
    const kern = zeileVon(dir, "echo kern");
    assert.deepEqual([kern.ausloeser, kern.bereiche], ["bereiche", "kern"]);
  });
});

test("[checks-1004] ein nicht aufloesbarer Anker zaehlt als 'anker'", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    run(dir, "--since", "gibt-es-nicht");

    const kern = zeileVon(dir, "echo kern");
    assert.deepEqual([kern.ausloeser, kern.bereiche, kern.dateien], ["anker", "", ""]);
    assert.equal(zeileVon(dir, "echo string").ausloeser, "ohne-bereich");
  });
});

test("[checks-1004] --bereich zaehlt als 'bereiche' mit genau diesem Bereich", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir, "--bereich", "doku");

    const doku = zeileVon(dir, "echo doku");
    assert.deepEqual([doku.ausloeser, doku.bereiche], ["bereiche", "doku"]);
    assert.equal(zeileVon(dir, "echo beide").bereiche, "doku", "nur der gewaehlte Bereich, nicht der beruehrte");
  });
});

test("[checks-1004] eine aeltere siebenspaltige Zeile bleibt neben den neuen stehen und lesbar", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "src/a.txt");
    const alt = "2026-09-01T00:00:00.000Z\techo frueher\tgruen\t7\tabschluss\t2026-09-01T00:00:00.000Z\t948";
    writeFileSync(ausfuehrungenPfad(dir), `${alt}\n`, "utf-8");

    run(dir);

    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen[0], alt, "die alte Zeile bleibt Zeichen fuer Zeichen stehen");
    const frueher = spalten(zeilen[0]);
    assert.equal(frueher.karte, "948", "ihre sieben Spalten behalten Stellung und Bedeutung");
    assert.equal(frueher.ausloeser, undefined, "die drei neuen Spalten sind beim Lesen optional");
    assert.equal(spalten(zeilen[1]).ausloeser, "ohne-bereich", "die neue Zeile daneben traegt sie");
  });
});
