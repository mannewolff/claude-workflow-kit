// Die Aggregation der Ergebnisstaende (Issue #750, Plan #745, E5 bis E8).
//
// `aufwand.mjs auswerten` macht aus den Ergebnisstaenden `.claude/night-run-*.json`
// eine Aussage ueber Zeit, Pruefungen, Umfang und Kosten. Die Staende sind die einzige
// Quelle — sie tragen seit Issue #749 alles Noetige, bleiben liegen und schliessen
// fehlgeschlagene wie abgebrochene Laeufe ein. Eine zweite Ablage waere dieselbe
// Wahrheit an einem zweiten Ort.
//
// Die Leitplanke ueber allem: Ein fehlender Messwert bleibt `null` und erscheint als
// "nicht gemessen", nie als 0 — dieselbe Regel, nach der `verbrauchLeer()` in night.mjs
// gebaut ist. Eine 0 behauptete, es sei nichts verbraucht worden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mitProjekt, lauf, einheit, pruefstand, auswerten, aufwand, bericht, stand } from "./helpers/aufwand-fixture.mjs";

/** Zehn Staende mit den vier Sonderfaellen, die das Paket ausdruecklich verlangt. */
function zehnStaende() {
  return [
    // Sechs gewoehnliche Laeufe mit vollstaendigen Messwerten.
    ...[1, 2, 3, 4, 5, 6].map((n) =>
      lauf(`2026-09-0${n}-100000`, { einheiten: [einheit(600 + n)] })),
    // Ein abgebrochener Lauf — er geht mit dem ein, was er traegt.
    lauf("2026-09-07-100000", {
      abschluss: "harterStopp",
      complete: false,
      fehlerText: "Arbeitsbaum nicht sauber",
      einheiten: [einheit(607, { ausgang: "abgebrochen" })],
    }),
    // Ein unvollstaendiger Lauf ohne `zeiten` (ein Stand aus der Zeit vor Issue #749).
    lauf("2026-09-08-100000", { einheiten: [einheit(608, { zeiten: null })] }),
    // Ein Lauf mit einem Modell, das preisFuer() nicht kennt.
    lauf("2026-09-09-100000", { einheiten: [einheit(609, { modell: "qwen-kit", kostenUsd: 3 })] }),
    // Ein Lauf mit Verbrauch, der zu keiner Einheit gehoert (Vorflug, Kette).
    lauf("2026-09-10-100000", {
      einheiten: [einheit(610)],
      verbrauchOhneEinheit: { kostenUsd: 2.5, eingabeTokens: 10, ausgabeTokens: 20, cacheErzeugtTokens: 30, cacheGelesenTokens: 40 },
    }),
  ];
}

test("[aufwand-1] auswerten bezieht alle zehn Staende ein und nennt den juengsten", () => {
  mitProjekt({ laeufe: zehnStaende() }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.laeufe.gefunden, 10);
    assert.equal(e.laeufe.einbezogen, 10);
    assert.equal(e.laeufe.grenze, 10, "die Vorgabe der Laufzahl ist zehn");
    assert.equal(e.juengsterLauf, "2026-09-10-100000");
    assert.match(e.erzeugtAm, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("[aufwand-1] der abgebrochene und der Lauf ohne Zeiten stehen in der Liste der unvollstaendigen", () => {
  mitProjekt({ laeufe: zehnStaende() }, (dir) => {
    const e = auswerten(dir);

    const stempel = new Set(e.laeufe.unvollstaendig.map((u) => u.stempel));
    assert.ok(stempel.has("2026-09-07-100000"), "der abgebrochene Lauf fehlt in der Liste");
    assert.ok(stempel.has("2026-09-08-100000"), "der Lauf ohne Zeiten fehlt in der Liste");

    const ohneZeiten = e.laeufe.unvollstaendig.find((u) => u.stempel === "2026-09-08-100000");
    assert.ok(ohneZeiten.gruende.some((g) => /Zeiten/i.test(g)),
      `die Gruende nennen die fehlenden Zeiten nicht: ${ohneZeiten.gruende}`);
    const abgebrochen = e.laeufe.unvollstaendig.find((u) => u.stempel === "2026-09-07-100000");
    assert.ok(abgebrochen.gruende.some((g) => /abgeschlossen|Stopp/i.test(g)),
      `die Gruende nennen den Abbruch nicht: ${abgebrochen.gruende}`);
  });
});

test("[aufwand-1] ein Lauf ohne Messwerte geht trotzdem mit dem ein, was er traegt", () => {
  // Der Lauf ohne `zeiten` traegt weiter Verbrauch und Pruefstand. Ihn ganz zu
  // verwerfen waere der bequeme Fehler: Die Summen saehen vollstaendig aus und
  // waeren zu klein.
  const nurUnvollstaendig = [lauf("2026-09-01-100000", { einheiten: [einheit(1, { zeiten: null })] })];
  mitProjekt({ laeufe: nurUnvollstaendig }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.laeufe.einbezogen, 1);
    assert.equal(e.zeit.nachdenkenMs.wert, null, "ohne zeiten darf keine Zeit behauptet werden");
    assert.equal(e.zeit.nachdenkenMs.laeufe, 0);
    assert.equal(e.pruefungen.gesamtMs.wert, 51_300, "der Pruefstand des Laufs zaehlt weiter");
    assert.ok(e.kosten.gesamtUsd.wert > 0, "der Verbrauch des Laufs zaehlt weiter");
  });
});

test("[aufwand-1] Zeit: Nachdenken, Werkzeugarbeit und der Rest je Einheit summieren sich", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [einheit(1, { zeiten: { dauerMs: 1000, nachdenkenMs: 600, werkzeugMs: 300, werkzeugSchuebe: 5, nebenlaeufigeSchuebe: 0 } })],
    }),
    lauf("2026-09-02-100000", {
      einheiten: [einheit(2, { zeiten: { dauerMs: 2000, nachdenkenMs: 900, werkzeugMs: 500, werkzeugSchuebe: 7, nebenlaeufigeSchuebe: 0 } })],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zeit.gesamtMs.wert, 3000);
    assert.equal(e.zeit.nachdenkenMs.wert, 1500);
    assert.equal(e.zeit.werkzeugMs.wert, 800);
    // Der Rest ist der dritte Posten je Einheit: 1000-600-300 plus 2000-900-500.
    assert.equal(e.zeit.restMs.wert, 700);
    assert.equal(e.zeit.gesamtMs.laeufe, 2);
    assert.equal(e.zeit.restMs.laeufe, 2);
  });
});

test("[aufwand-1] ein negativer Rest wird als nebenlaeufig gemeldet, nicht als Zahl", () => {
  // Nachdenken und Werkzeugarbeit ueberlappen sich (Hintergrundaufrufe). Ihre Summe
  // ueberschreitet dann die Gesamtdauer — eine negative Zeit waere Unsinn.
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [einheit(1, { zeiten: { dauerMs: 1000, nachdenkenMs: 800, werkzeugMs: 700, werkzeugSchuebe: 9, nebenlaeufigeSchuebe: 3 } })],
    }),
    lauf("2026-09-02-100000", {
      einheiten: [einheit(2, { zeiten: { dauerMs: 2000, nachdenkenMs: 900, werkzeugMs: 500, werkzeugSchuebe: 7, nebenlaeufigeSchuebe: 0 } })],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zeit.restMs.wert, 600, "nur die Einheit mit positivem Rest zaehlt");
    assert.equal(e.zeit.restMs.laeufe, 1);
    assert.equal(e.zeit.nebenlaeufig.einheiten, 1);
    assert.equal(e.zeit.nebenlaeufig.laeufe, 1);
    assert.match(bericht(dir), /nebenl(ae|ä)ufig/i, "der Bericht schweigt zur Nebenlaeufigkeit");
  });
});

test("[aufwand-1] Pruefungen: je cmd Anzahl und Summe, wiederholte Ausfuehrungen zusammengefasst", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [einheit(1, {
        pruefung: pruefstand({
          laufen: [
            { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 40_000 },
            { cmd: "node --test", grund: "voller Umfang", ergebnis: "rot", dauerMs: 10_000 },
            { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 1_000 },
          ],
        }),
      })],
    }),
    lauf("2026-09-02-100000", {
      einheiten: [einheit(2, {
        pruefung: pruefstand({
          laufen: [{ cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 30_000 }],
        }),
      })],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    const knoten = e.pruefungen.kommandos.find((k) => k.cmd === "node --test");
    assert.equal(knoten.anzahl, 3, "drei Ausfuehrungen desselben Kommandos, auch die rote");
    assert.equal(knoten.dauerMs, 80_000);
    assert.equal(knoten.laeufe, 2);

    const eslint = e.pruefungen.kommandos.find((k) => k.cmd === "npx eslint .");
    assert.equal(eslint.anzahl, 1);
    assert.equal(eslint.dauerMs, 1_000);
    assert.equal(eslint.laeufe, 1);

    assert.equal(e.pruefungen.gesamtMs.wert, 81_000);
    assert.equal(e.pruefungen.kommandos[0].cmd, "node --test", "die teuerste Pruefung steht oben");
  });
});

test("[aufwand-1] Umfang: voll, eingegrenzt und unbekannt werden getrennt gezaehlt", () => {
  const laeufe = [
    lauf("2026-09-01-100000", { einheiten: [einheit(1, { pruefung: pruefstand({ vollerUmfang: true }) })] }),
    lauf("2026-09-02-100000", {
      einheiten: [einheit(2, {
        pruefung: pruefstand({ vollerUmfang: false, ausgelassen: [{ cmd: "npx eslint .", grund: "Bereich kern unberuehrt" }] }),
      })],
    }),
    // Ein Stand ohne das Feld — aus der Zeit vor Issue #749. `unbekannt`, nie `eingegrenzt`.
    lauf("2026-09-03-100000", { einheiten: [einheit(3, { pruefung: pruefstand({ vollerUmfang: null }) })] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.umfang.voll, 1);
    assert.equal(e.umfang.eingegrenzt, 1);
    assert.equal(e.umfang.unbekannt, 1, "ein fehlendes Feld gilt nie als eingegrenzt");
    assert.equal(e.umfang.laeufe, 3);
  });
});

test("[aufwand-1] Kosten: Lesen ist Eingabe, Cache-Erzeugung und Cache-Lesen, Schreiben allein die Ausgabe", () => {
  // claude-opus-5 liegt in tier_5_25: Eingabe 5, Ausgabe 25, cacheSchreiben1h 10,
  // cacheLesen 0,5 — je Million Token.
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [einheit(1, {
        modell: "claude-opus-5",
        eingabeTokens: 1_000_000,
        ausgabeTokens: 1_000_000,
        cacheErzeugtTokens: 1_000_000,
        cacheGelesenTokens: 1_000_000,
      })],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    // Ohne Teilung faellt die Cache-Erzeugung auf den Stunden-Satz: 5 + 10 + 0,5.
    assert.equal(e.kosten.lesenUsd.wert, 15.5);
    assert.equal(e.kosten.schreibenUsd.wert, 25);
    assert.equal(e.kosten.gesamtUsd.wert, 40.5);
    assert.equal(e.kosten.lesenUsd.laeufe, 1);
  });
});

test("[aufwand-1] Einheiten ohne Preissatz und der Verbrauch ohne Einheit bilden 'nicht zuordenbar'", () => {
  const laeufe = [
    lauf("2026-09-01-100000", { einheiten: [einheit(1, { modell: "qwen-kit", kostenUsd: 3 })] }),
    lauf("2026-09-02-100000", {
      einheiten: [],
      verbrauchOhneEinheit: { kostenUsd: 2.5, eingabeTokens: 10, ausgabeTokens: 20, cacheErzeugtTokens: 30, cacheGelesenTokens: 40 },
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.kosten.nichtZuordenbarUsd.wert, 5.5, "3 aus der Einheit ohne Preissatz, 2,50 ohne Einheit");
    assert.equal(e.kosten.nichtZuordenbarUsd.laeufe, 2);
    assert.equal(e.kosten.lesenUsd.wert, null, "ohne Preissatz darf keine Teilung behauptet werden");
    assert.equal(e.kosten.schreibenUsd.wert, null);
    assert.equal(e.kosten.gesamtUsd.wert, 5.5);
    assert.deepEqual(e.kosten.ohnePreissatz.modelle, ["qwen-kit"]);
    assert.equal(e.kosten.ohnePreissatz.einheiten, 1);
  });
});

test("[aufwand-1] jede Kennzahl traegt die Zahl der Laeufe, die sie getragen haben", () => {
  // Zwei Laeufe tragen Zeiten, nur einer traegt einen Pruefstand: Die Kennzahlen
  // duerfen nicht so tun, als staenden beide auf derselben Grundlage.
  const laeufe = [
    lauf("2026-09-01-100000", { einheiten: [einheit(1)] }),
    lauf("2026-09-02-100000", { einheiten: [einheit(2, { pruefung: null })] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zeit.nachdenkenMs.laeufe, 2);
    assert.equal(e.pruefungen.gesamtMs.laeufe, 1, "nur ein Lauf hat einen Pruefstand getragen");
    assert.match(bericht(dir), /ueber 2 Laeufe|über 2 Läufe/, "der Bericht nennt die Zahl der Laeufe nicht");
  });
});

test("[aufwand-1] bei genau einem Lauf sagt der Text das ausdruecklich", () => {
  // Kriterium 6: Eine Aussage aus einem einzigen Lauf ist keine Tendenz. Wer das
  // nicht liest, haelt eine Momentaufnahme fuer einen Durchschnitt.
  mitProjekt({ laeufe: [lauf("2026-09-01-100000", { einheiten: [einheit(1)] })] }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.laeufe.einbezogen, 1);
    assert.match(bericht(dir), /einem einzigen Lauf/i, "der Bericht weist den einzigen Lauf nicht aus");
  });
});

test("[aufwand-1] ein fehlender Messwert bleibt null und erscheint als 'nicht gemessen', nie als 0", () => {
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [einheit(1, {
      zeiten: { dauerMs: 1000, nachdenkenMs: null, werkzeugMs: null, werkzeugSchuebe: null, nebenlaeufigeSchuebe: null },
      pruefung: pruefstand({ laufen: [{ cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: null }] }),
    })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zeit.nachdenkenMs.wert, null);
    assert.equal(e.zeit.werkzeugMs.wert, null);
    assert.equal(e.pruefungen.gesamtMs.wert, null, "eine Pruefung ohne gemessene Dauer ergibt keine 0");
    assert.equal(e.pruefungen.kommandos[0].dauerMs, null);
    assert.equal(e.pruefungen.kommandos[0].anzahl, 1, "gezaehlt wird sie trotzdem");
    assert.match(bericht(dir), /nicht gemessen/, "der Bericht nennt den fehlenden Messwert nicht beim Namen");
  });
});

test("[aufwand-1] --laeufe 3 begrenzt auf die drei juengsten Staende, absteigend nach Stempel", () => {
  mitProjekt({ laeufe: zehnStaende() }, (dir) => {
    const e = auswerten(dir, "--laeufe", "3");

    assert.equal(e.laeufe.gefunden, 10);
    assert.equal(e.laeufe.einbezogen, 3);
    assert.equal(e.laeufe.grenze, 3);
    assert.deepEqual(e.laeufe.stempel, ["2026-09-10-100000", "2026-09-09-100000", "2026-09-08-100000"]);
  });
});

test("[aufwand-1] auswerten schreibt aufwand.md und aufwand.json und gibt JSON auf stdout", () => {
  mitProjekt({ laeufe: zehnStaende() }, (dir) => {
    const res = aufwand(dir, "auswerten");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).laeufe.einbezogen, 10);
    assert.match(bericht(dir), /^# Aufwand/m);
    assert.equal(stand(dir).juengsterLauf, "2026-09-10-100000");
    assert.match(stand(dir).erzeugtAm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

test("[aufwand-1] der Leerfall gibt JSON aus, schreibt den Bericht und endet gruen", () => {
  mitProjekt({ laeufe: [] }, (dir) => {
    const res = aufwand(dir, "auswerten");

    assert.equal(res.status, 0, res.stderr);
    const e = JSON.parse(res.stdout);
    assert.equal(e.laeufe.gefunden, 0);
    assert.equal(e.laeufe.einbezogen, 0);
    assert.equal(e.juengsterLauf, null);
    assert.equal(e.zeit.gesamtMs.wert, null, "ohne Lauf gibt es keine Zeit, auch keine 0");
    assert.match(bericht(dir), /kein(en)? Ergebnisstand/i);
  });
});

test("[aufwand-1] ein abgewiesener Aufruf gibt trotzdem JSON auf stdout aus", () => {
  mitProjekt({ laeufe: [] }, (dir) => {
    for (const args of [["auswerten", "--laeufe", "0"], ["auswerten", "--laeufe", "zwei"], ["auswerten", "--was"]]) {
      const res = aufwand(dir, ...args);
      assert.notEqual(res.status, 0, `'${args.join(" ")}' haette abgewiesen werden muessen`);
      const json = JSON.parse(res.stdout);
      assert.equal(json.ok, false);
      assert.ok(typeof json.fehler === "string" && json.fehler.length > 0, "der Grund fehlt");
    }
  });
});

test("[aufwand-1] ohne Argument gibt aufwand.mjs die Hilfe aus, --version den Kit-Stand", () => {
  mitProjekt({ laeufe: [] }, (dir) => {
    const hilfe = aufwand(dir);
    assert.equal(hilfe.status, 0, hilfe.stderr);
    assert.match(hilfe.stdout, /auswerten/);
    assert.match(hilfe.stdout, /befund/);

    const version = aufwand(dir, "--version");
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

    const unbekannt = aufwand(dir, "quatsch");
    assert.notEqual(unbekannt.status, 0, "ein unbekannter Befehl gehoert abgewiesen");
    assert.match(unbekannt.stderr, /quatsch/);
  });
});

test("[aufwand-3] die wartend beendeten Sitzungen werden ueber die Staende gezaehlt und ausgewiesen", () => {
  // Die Einheiten tragen `wartendBeendet: true` (Issue #776). Gezaehlt werden die
  // Einheiten, gemerkt werden die Laeufe, die den Fall ueberhaupt getragen haben —
  // dieselbe Buchfuehrung wie bei den uebrigen Kennzahlen.
  const laeufe = [
    lauf("2026-09-01-100000", { einheiten: [einheit(1, { wartendBeendet: true }), einheit(2)] }),
    lauf("2026-09-02-100000", { einheiten: [einheit(3, { wartendBeendet: true })] }),
    lauf("2026-09-03-100000", { einheiten: [einheit(4)] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.wartendBeendet.einheiten, 2);
    assert.equal(e.wartendBeendet.laeufe, 2, "nur die zwei Laeufe, die den Fall getragen haben");
    assert.equal(stand(dir).wartendBeendet.einheiten, 2, "aufwand.json fuehrt die Groesse nicht");
    assert.match(bericht(dir), /^2 Sitzungen haben .*gewartet.* ohne Ergebnis beendet.*\(ueber 2 Laeufe\)/m,
      "der Bericht nennt die Zahl und die Zahl der Laeufe nicht in Worten");
  });
});

test("[aufwand-3] ein Lauf ohne das Feld traegt 0 bei und gilt nicht als unvollstaendig", () => {
  // Die allermeisten Naechte haben den Fall schlicht nicht. Er fehlt dort, weil er
  // nicht eintrat — nicht, weil nicht gemessen wurde.
  mitProjekt({ laeufe: [lauf("2026-09-01-100000", { einheiten: [einheit(1)] })] }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.wartendBeendet.einheiten, 0);
    assert.equal(e.wartendBeendet.laeufe, 0);
    assert.deepEqual(e.laeufe.unvollstaendig, [], "ein fehlendes Feld macht keinen Lauf unvollstaendig");
    assert.match(bericht(dir), /Keine Sitzung hat .*gewartet/,
      "der Bericht schweigt zum Fall, statt die Null zu nennen");
  });
});

test("[aufwand-1] ein unlesbarer Ergebnisstand kostet keine Auswertung, sondern einen Vermerk", () => {
  // Eine halbe Datei entsteht, wenn ein Lauf gerade schreibt — sie darf die
  // Auswertung nicht kosten.
  mitProjekt({ laeufe: [lauf("2026-09-01-100000", { einheiten: [einheit(1)] })] }, (dir) => {
    writeFileSync(join(dir, ".claude", "night-run-2026-09-02-100000.json"), "{ kaputt", "utf-8");

    const e = auswerten(dir);

    assert.equal(e.laeufe.einbezogen, 1);
    assert.equal(e.laeufe.unlesbar.length, 1);
    assert.match(e.laeufe.unlesbar[0].datei, /night-run-2026-09-02-100000\.json$/);
  });
});
