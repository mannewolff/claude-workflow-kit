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

/**
 * Eine Protokollzeile in ihre Spalten zerlegt (Issue #948).
 *
 * Die drei hinteren Spalten `anlass`, `lauf` und `karte` stehen HINTEN, damit eine
 * aeltere Zeile ohne sie unveraendert lesbar bleibt: Die vier vorderen behalten
 * Stellung und Bedeutung, und die fehlenden hinteren kommen als `undefined` zurueck.
 */
function spalten(zeile) {
  const [zeit, cmd, ergebnis, dauerMs, anlass, lauf, karte] = zeile.split("\t");
  return { zeit, cmd, ergebnis, dauerMs, anlass, lauf, karte };
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
    "abgeschlossen", "abschluss", "ausgelassen", "basis", "bereichWahl", "bereiche", "configHash",
    "dauerGesamtMs", "geaendert", "hashes", "laufen", "leeresPaket", "ohnePruefung", "ohneZuordnung",
    "stufe", "vollerUmfang", "zeitpunkt",
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

// Anlass, Lauf und Karte (Issue #948, Plan #944).
//
// Die drei Spalten entscheiden darueber, ob sich mit dem Protokoll ueberhaupt rechnen
// laesst. Der `anlass` trennt den Abschluss einer Karte von einem Paket-, Push- oder
// Merge-Lauf; die Laufkennung trennt "je Lauf" von "je Kommando" — ein Abschlusslauf
// schreibt mehrere Zeilen, und ohne sie waere der Nenner falsch; die `karte` bindet den
// Lauf an das Arbeitspaket, das er abschliesst.
//
// Geprueft wird an der Wirkung, also an den geschriebenen Zeilen: Die Werte kommen aus
// Auswahl und Aufruf, und genau diese Zuordnung soll nicht unbemerkt kippen.

const DREI_CMD = {
  buildChecks: [
    { cmd: "echo eins", always: true },
    { cmd: "echo zwei", always: true },
  ],
  checkAreas: { kern: ["src/**"] },
};

test("[checks-7] ein Abschlusslauf mit Kartennummer traegt anlass, Laufkennung und Karte", () => {
  mitRepo({ config: DREI_CMD }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir, "--abschluss", "948");

    assert.equal(res.status, 0, res.stderr);
    const zeilen = ausfuehrungen(dir).map(spalten);
    assert.equal(zeilen.length, 2, "Vorbedingung: zwei ausgefuehrte Kommandos");
    for (const z of zeilen) {
      assert.equal(z.anlass, "abschluss", "der Schalter am Aufruf bestimmt den Anlass");
      assert.equal(z.karte, "948", "die Nummer hinter --abschluss steht als Karte");
    }
    // Dieselbe Kennung fuer alle Zeilen EINES run-Aufrufs — sonst liesse sich
    // "je Lauf" nicht von "je Kommando" trennen.
    assert.equal(zeilen[0].lauf, zeilen[1].lauf, "alle Zeilen eines Laufs tragen dieselbe Kennung");
    assert.equal(
      zeilen[0].lauf, zusammenfassung(dir).zeitpunkt,
      "die Laufkennung ist der Zeitpunkt der Zusammenfassung, also der Stand, der in die Pruefung ging",
    );
  });
});

test("[checks-7] ein Abschlusslauf ohne Kartennummer laesst die Kartenspalte leer", () => {
  mitRepo({ config: DREI_CMD }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir, "--abschluss");

    assert.equal(res.status, 0, res.stderr);
    const zeilen = ausfuehrungen(dir).map(spalten);
    for (const z of zeilen) {
      assert.equal(z.anlass, "abschluss", "der Schalter wirkt auch ohne Nummer");
      // Leer und nicht 0 oder '-': "nicht gemessen" ist hier wie ueberall kein Nullwert.
      assert.equal(z.karte, "", "ohne Nummer bleibt die Spalte leer");
    }
    assert.match(zeilen[0].lauf, ZEITSTEMPEL, "die Laufkennung steht trotzdem");
  });
});

test("[checks-7] ohne --abschluss steht die Stufe des Laufs als Anlass", () => {
  for (const [cliArgs, anlass] of [[[], "paket"], [["--stufe", "push"], "push"], [["--stufe", "merge"], "merge"]]) {
    mitRepo({ config: DREI_CMD }, (dir) => {
      datei(dir, "src/a.txt");

      const res = run(dir, ...cliArgs);

      assert.equal(res.status, 0, res.stderr);
      const zeilen = ausfuehrungen(dir).map(spalten);
      assert.ok(zeilen.length > 0, `Vorbedingung im Fall '${anlass}': es lief etwas`);
      for (const z of zeilen) {
        assert.equal(z.anlass, anlass, `Anlass im Fall '${anlass}'`);
        assert.equal(z.karte, "", "ohne --abschluss gibt es keine Karte");
      }
      assert.equal(zeilen[0].lauf, zusammenfassung(dir).zeitpunkt, `Laufkennung im Fall '${anlass}'`);
    });
  }
});

test("[checks-7] ein Protokoll mit alten Zeilen ohne die drei Spalten bleibt lesbar", () => {
  mitRepo({ config: DREI_CMD }, (dir) => {
    datei(dir, "src/a.txt");
    // Eine Zeile, wie sie vor Issue #948 entstand: vier Spalten, nichts dahinter.
    const alt = "2026-01-01T00:00:00.000Z\techo frueher\tgruen\t7";
    writeFileSync(ausfuehrungenPfad(dir), `${alt}\n`, "utf-8");

    run(dir, "--abschluss", "948");

    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen[0], alt, "die alte Zeile bleibt Zeichen fuer Zeichen stehen");
    const frueher = spalten(zeilen[0]);
    assert.equal(frueher.cmd, "echo frueher", "ihre vier Spalten behalten Stellung und Bedeutung");
    assert.equal(frueher.dauerMs, "7");
    assert.equal(frueher.anlass, undefined, "die drei neuen Spalten sind beim Lesen optional");
    assert.equal(spalten(zeilen[1]).anlass, "abschluss", "die neue Zeile daneben traegt sie");
  });
});
