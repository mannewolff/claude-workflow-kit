// Das Ausfuehrungsprotokoll `.claude/ausfuehrungen.tsv` (Issue #785, Plan #782, E17).
//
// Die Zusammenfassung `.claude/checks-summary.json` traegt bewusst keine Historie: Der
// Nacht-Runner loescht sie vor jeder Session, und innerhalb einer Session ueberschreibt
// jeder `run` den vorigen. Eine Pruefung, die rot anschlaegt, worauf die Session den
// Mangel behebt und erneut prueft, hinterliesse dort einen gruenen Endstand — sie
// erschiene als "nie beanstandet" und loeste genau den Befund aus, der zu ihrer
// Abschaffung einlaedt.
//
// Das Protokoll ist die Zaehleinheit dagegen: je Ausfuehrung eine ANGEHAENGTE Zeile, nie
// geleert. Drei Eigenschaften entscheiden darueber, ob es zaehlen kann, und werden
// deshalb an der Wirkung geprueft: Es wird angehaengt, ein nicht gestartetes Kommando
// schreibt nichts (es ist keine Ausfuehrung), und ein gescheitertes Schreiben aendert
// weder Ausgang noch Ausgabe von `run` — ein Protokoll ist Buchhaltung, keine Bedingung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  mitRepo, plan, run, zusammenfassung, datei, ausfuehrungen, ausfuehrungenPfad,
} from "./helpers/checks-repo.mjs";

const ZEITSTEMPEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Eine Protokollzeile in ihre vier Spalten zerlegt. */
function spalten(zeile) {
  const [zeit, cmd, ergebnis, dauerMs] = zeile.split("\t");
  return { zeit, cmd, ergebnis, dauerMs };
}

test("[checks-7] ein Lauf haengt je ausgefuehrtem Kommando eine Zeile aus Zeit, Kommando, Ergebnis und Dauer an", () => {
  const config = {
    buildChecks: [
      { cmd: "echo eins", always: true },
      { cmd: "echo zwei", always: true },
      { cmd: "exit 1", always: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.notEqual(res.status, 0, "das rote Kommando muss den Lauf rot faerben");
    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen.length, 3, "drei ausgefuehrte Kommandos, drei Zeilen");
    assert.deepEqual(
      zeilen.map((z) => [spalten(z).cmd, spalten(z).ergebnis]),
      [["echo eins", "gruen"], ["echo zwei", "gruen"], ["exit 1", "rot"]],
    );
    for (const zeile of zeilen) {
      const { zeit, dauerMs } = spalten(zeile);
      assert.match(zeit, ZEITSTEMPEL, "der Zeitstempel ist ISO-8601 in UTC");
      assert.match(dauerMs, /^\d+$/, "die Dauer steht als ganze Zahl in Millisekunden");
    }
  });
});

test("[checks-7] ein nach dem roten Kommando nicht gestartetes schreibt keine Zeile", () => {
  const config = {
    buildChecks: [
      { cmd: "exit 1", always: true },
      { cmd: "echo nie", always: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir);

    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen.length, 1, "'nicht gestartet' ist keine Ausfuehrung");
    assert.equal(spalten(zeilen[0]).cmd, "exit 1");
    assert.equal(zusammenfassung(dir).laufen[1].ergebnis, "nicht gestartet", "Vorbedingung des Falls");
  });
});

test("[checks-7] zwei run-Runden einer Sitzung ergeben zwei Zeilensaetze — genau der Fall, den die Zusammenfassung verliert", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir);
    // `--frisch`, weil der Stand zwischen den Runden derselbe ist: Ohne den
    // Schalter uebernaehme die zweite Runde das Ergebnis der ersten (Issue #863)
    // und waere keine Ausfuehrung mehr. Gemeint ist hier die echte zweite Runde,
    // wie sie nach einem Fix entsteht.
    run(dir, "--frisch");

    assert.equal(ausfuehrungen(dir).length, 2, "die zweite Runde haengt an, statt die erste zu ersetzen");
    assert.equal(zusammenfassung(dir).laufen.length, 1, "die Zusammenfassung kennt nur die letzte Runde");
  });
});

test("[checks-7] eine bestehende Datei wird ergaenzt, nicht ueberschrieben", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");
    const frueher = "2026-01-01T00:00:00.000Z\techo frueher\tgruen\t7";
    writeFileSync(ausfuehrungenPfad(dir), `${frueher}\n`, "utf-8");

    run(dir);

    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen.length, 2);
    assert.equal(zeilen[0], frueher, "die vorhandene Zeile bleibt unveraendert stehen");
    assert.equal(spalten(zeilen[1]).cmd, "echo eins");
  });
});

test("[checks-7] ist das Protokoll nicht schreibbar, bleiben Ausgang und Ausgabe von run unveraendert", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    // Beide Laeufe mit `--frisch`: Der Stand ist zwischen ihnen derselbe, und ein
    // uebernommenes Ergebnis ruehrte das Protokoll gar nicht erst an (Issue #863) —
    // der Fall, um den es hier geht, entstuende nie.
    const ohneFehler = run(dir, "--frisch");
    assert.equal(ohneFehler.status, 0, ohneFehler.stderr);
    assert.equal(ohneFehler.stderr, "", "Vorbedingung: der ungestoerte Lauf schweigt auf stderr");

    // Ein Verzeichnis an der Stelle der Datei laesst jedes Anhaengen scheitern (EISDIR) —
    // anders als ein Rechte-Entzug wirkt das unabhaengig vom ausfuehrenden Benutzer.
    rmSync(ausfuehrungenPfad(dir), { force: true });
    mkdirSync(ausfuehrungenPfad(dir), { recursive: true });

    const mitFehler = run(dir, "--frisch");

    assert.equal(mitFehler.status, ohneFehler.status, "der Exit-Code bleibt derselbe");
    assert.equal(mitFehler.stdout, ohneFehler.stdout, "die stdout-Ausgabe bleibt unveraendert");
    assert.match(mitFehler.stderr, /Ausfuehrung/, "der Fehlschlag wird als Hinweis gemeldet, nicht verschwiegen");
  });
});

test("[checks-7] checks.mjs plan schreibt keine Zeile", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    plan(dir);

    assert.deepEqual(ausfuehrungen(dir), [], "plan fuehrt nichts aus, also protokolliert es nichts");
  });
});

test("[checks-7] die Zusammenfassung bleibt unveraendert — gruenes, rotes und leeres Paket", () => {
  const FELDER = [
    "abgeschlossen", "ausgelassen", "basis", "bereiche", "configHash", "dauerGesamtMs",
    "geaendert", "hashes", "laufen", "leeresPaket", "stufe", "vollerUmfang", "zeitpunkt",
  ];
  const faelle = [
    { name: "gruen", cmd: "echo eins", leer: false },
    { name: "rot", cmd: "exit 1", leer: false },
    { name: "leer", cmd: "echo eins", leer: true },
  ];
  for (const fall of faelle) {
    const config = {
      buildChecks: [{ cmd: fall.cmd, always: true }],
      checkAreas: { kern: ["src/**"] },
    };
    mitRepo({ config }, (dir) => {
      if (!fall.leer) datei(dir, "src/a.txt");

      run(dir);

      const summary = zusammenfassung(dir);
      assert.deepEqual(Object.keys(summary).sort(), FELDER, `Feldmenge im Fall '${fall.name}'`);
      assert.doesNotMatch(
        JSON.stringify(summary),
        /ausfuehrungen/,
        `die Zusammenfassung im Fall '${fall.name}' kennt das Protokoll nicht`,
      );
    });
  }
});
