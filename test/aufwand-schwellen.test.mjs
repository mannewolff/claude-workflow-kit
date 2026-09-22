// Die vier Schwellen der Auswertung (Issue #750, Plan #745, E11).
//
// Eine Schwelle sagt nur, dass ein Wert auffaellt — nie, was zu tun ist (Nicht-Ziel).
// Und sie sagt es nur, wenn sie ueberschritten ist: Kriterium 11 verlangt Schweigen bei
// Unauffaelligkeit. Ein beruhigender Satz waere derselbe Aufmerksamkeitsverbrauch wie
// ein Befund, nur ohne Anlass.
//
// Jede Schwelle wird an der Grenze, knapp darunter und darueber geprueft. Die Grenze
// selbst loest NICHT aus ("ueber der Haelfte", nicht "ab der Haelfte") — sonst faellt
// ein sauber halbiertes Verhaeltnis jedes Mal auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, lauf, einheit, pruefstand, auswerten, bericht, stand } from "./helpers/aufwand-fixture.mjs";

// Ein Lauf, in dem keine der vier Schwellen anschlaegt. Jeder Test verbiegt genau eine
// Groesse daran — so kann ein Befund nur aus der Schwelle stammen, um die es geht.
function unauffaellig(felder = {}) {
  const {
    zeiten = { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs: 400, werkzeugSchuebe: 5, nebenlaeufigeSchuebe: 0 },
    laufen = [
      { cmd: "a", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 400 },
      { cmd: "b", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 300 },
      { cmd: "c", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 300 },
    ],
    vollerUmfang = false,
    ausgelassen = [{ cmd: "d", grund: "Bereich kern unberuehrt" }],
    // tier_5_25: Eingabe 5, Ausgabe 25 je Million. Lesen 25, Schreiben 25 — genau die
    // Haelfte, also weit unter drei Vierteln.
    eingabeTokens = 5_000_000,
    ausgabeTokens = 1_000_000,
    stempel = "2026-09-01-100000",
  } = felder;
  return lauf(stempel, {
    einheiten: [einheit(1, {
      zeiten,
      eingabeTokens,
      ausgabeTokens,
      cacheErzeugtTokens: 0,
      cacheGelesenTokens: 0,
      pruefung: pruefstand({ laufen, vollerUmfang, ausgelassen }),
    })],
  });
}

function schwellen(ergebnis) {
  return ergebnis.befund.map((b) => b.schwelle).sort();
}

// --- Der Leerfall: keine Schwelle ueberschritten (Kriterium 11) ---------------

test("[aufwand-1] ohne ueberschrittene Schwelle traegt aufwand.json keinen Befund", () => {
  mitProjekt({ laeufe: [unauffaellig()] }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(e.befund, []);
    assert.deepEqual(stand(dir).befund, []);
  });
});

test("[aufwand-1] aufwand.md traegt auch ohne Befund die vollen Zahlen", () => {
  mitProjekt({ laeufe: [unauffaellig()] }, (dir) => {
    auswerten(dir);
    const text = bericht(dir);

    assert.match(text, /^# Aufwand/m);
    assert.match(text, /Nachdenken/);
    assert.match(text, /Werkzeugarbeit/);
    assert.match(text, /Kosten/);
    assert.match(text, /\ba\b/, "die Pruefkommandos fehlen im Bericht");
  });
});

// --- pruefungAnteil ----------------------------------------------------------

test("[aufwand-1] pruefungAnteil: eine Pruefung ueber der Haelfte der Pruefzeit faellt auf", () => {
  const laufen = [
    { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 700 },
    { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 300 },
  ];
  mitProjekt({ laeufe: [unauffaellig({ laufen })] }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(schwellen(e), ["pruefungAnteil"]);
    const b = e.befund[0];
    assert.match(b.text, /node --test/, "der Befund nennt die Pruefung nicht beim Namen");
    assert.equal(b.grenze, 0.5);
    assert.ok(Math.abs(b.wert - 0.7) < 1e-9);
  });
});

test("[aufwand-1] pruefungAnteil: genau die Haelfte loest nicht aus", () => {
  const laufen = [
    { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 500 },
    { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 500 },
  ];
  mitProjekt({ laeufe: [unauffaellig({ laufen })] }, (dir) => {
    assert.deepEqual(auswerten(dir).befund, []);
  });
});

test("[aufwand-1] pruefungAnteil: knapp darunter loest nicht aus, knapp darueber schon", () => {
  const darunter = [
    { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 499 },
    { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 300 },
    { cmd: "mvn verify", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 201 },
  ];
  mitProjekt({ laeufe: [unauffaellig({ laufen: darunter })] }, (dir) => {
    assert.deepEqual(auswerten(dir).befund, [], "499 von 1000 liegt unter der Haelfte");
  });

  const darueber = [
    { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 501 },
    { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 499 },
  ];
  mitProjekt({ laeufe: [unauffaellig({ laufen: darueber })] }, (dir) => {
    const e = auswerten(dir);
    assert.deepEqual(schwellen(e), ["pruefungAnteil"], "501 von 1000 liegt ueber der Haelfte");
    assert.match(e.befund[0].text, /node --test/);
  });
});

// --- eingrenzungOhneWirkung --------------------------------------------------

test("[aufwand-1] eingrenzungOhneWirkung: hat die Eingrenzung nie gegriffen, faellt das auf", () => {
  mitProjekt({ laeufe: [unauffaellig({ vollerUmfang: true, ausgelassen: [] })] }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(schwellen(e), ["eingrenzungOhneWirkung"]);
    assert.match(e.befund[0].text, /voll/i);
  });
});

test("[aufwand-1] eingrenzungOhneWirkung: ein einziger eingegrenzter Lauf genuegt gegen den Befund", () => {
  const laeufe = [
    unauffaellig({ stempel: "2026-09-01-100000", vollerUmfang: true, ausgelassen: [] }),
    unauffaellig({ stempel: "2026-09-02-100000" }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    assert.deepEqual(auswerten(dir).befund, []);
  });
});

test("[aufwand-1] eingrenzungOhneWirkung: ohne einen einzigen Pruefstand gibt es keinen Befund", () => {
  // Nichts gemessen ist kein Beleg dafuer, dass die Eingrenzung nicht greift.
  const laeufe = [lauf("2026-09-01-100000", { einheiten: [einheit(1, { pruefung: null })] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    assert.ok(!schwellen(e).includes("eingrenzungOhneWirkung"));
  });
});

// --- werkzeugAnteil ----------------------------------------------------------

test("[aufwand-1] werkzeugAnteil: Werkzeugarbeit ueber der Haelfte der Gesamtzeit faellt auf", () => {
  const zeiten = { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs: 600, werkzeugSchuebe: 9, nebenlaeufigeSchuebe: 0 };
  mitProjekt({ laeufe: [unauffaellig({ zeiten })] }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(schwellen(e), ["werkzeugAnteil"]);
    assert.equal(e.befund[0].grenze, 0.5);
    assert.ok(Math.abs(e.befund[0].wert - 0.6) < 1e-9);
  });
});

test("[aufwand-1] werkzeugAnteil: genau die Haelfte und knapp darunter loesen nicht aus", () => {
  for (const werkzeugMs of [500, 499]) {
    const zeiten = { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs, werkzeugSchuebe: 9, nebenlaeufigeSchuebe: 0 };
    mitProjekt({ laeufe: [unauffaellig({ zeiten })] }, (dir) => {
      assert.deepEqual(auswerten(dir).befund, [], `werkzeugMs ${werkzeugMs} haette schweigen muessen`);
    });
  }
});

// --- schreibkostenAnteil -----------------------------------------------------

test("[aufwand-1] schreibkostenAnteil: Schreibkosten ueber drei Vierteln fallen auf", () => {
  // Ausgabe 1 Mio zu 25 = 25, Eingabe 1 Mio zu 5 = 5. 25 von 30 sind 83 Prozent.
  mitProjekt({ laeufe: [unauffaellig({ eingabeTokens: 1_000_000, ausgabeTokens: 1_000_000 })] }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(schwellen(e), ["schreibkostenAnteil"]);
    assert.equal(e.befund[0].grenze, 0.75);
  });
});

test("[aufwand-1] schreibkostenAnteil: genau drei Viertel loesen nicht aus", () => {
  // Ausgabe 3 Mio zu 25 = 75, Eingabe 5 Mio zu 5 = 25. 75 von 100 sind exakt 0,75.
  mitProjekt({ laeufe: [unauffaellig({ eingabeTokens: 5_000_000, ausgabeTokens: 3_000_000 })] }, (dir) => {
    assert.deepEqual(auswerten(dir).befund, []);
  });
});

test("[aufwand-1] schreibkostenAnteil: knapp darunter loest nicht aus", () => {
  // Ausgabe 2,9 Mio zu 25 = 72,5. 72,5 von 97,5 sind 74,4 Prozent.
  mitProjekt({ laeufe: [unauffaellig({ eingabeTokens: 5_000_000, ausgabeTokens: 2_900_000 })] }, (dir) => {
    assert.deepEqual(auswerten(dir).befund, []);
  });
});

// --- Config-Block ------------------------------------------------------------

test("[aufwand-1] ein Config-Block ueberschreibt Laufzahl und einzelne Schwellen", () => {
  const laeufe = [
    unauffaellig({ stempel: "2026-09-01-100000" }),
    unauffaellig({ stempel: "2026-09-02-100000" }),
    unauffaellig({ stempel: "2026-09-03-100000" }),
  ];
  const config = { aufwand: { laeufe: 2, schwellen: { werkzeugAnteil: 0.3 } } };
  mitProjekt({ laeufe, config }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.laeufe.grenze, 2);
    assert.equal(e.laeufe.einbezogen, 2);
    // Werkzeugarbeit liegt bei 40 Prozent — unter der Vorgabe 0,5, ueber der 0,3.
    assert.deepEqual(schwellen(e), ["werkzeugAnteil"]);
    assert.equal(e.schwellen.werkzeugAnteil, 0.3);
    assert.equal(e.schwellen.pruefungAnteil, 0.5, "die uebrigen Schwellen behalten ihre Vorgabe");
    assert.equal(e.schwellen.schreibkostenAnteil, 0.75);
    assert.equal(e.schwellen.eingrenzungOhneWirkung, true);
  });
});

test("[aufwand-1] --laeufe sticht den Config-Block", () => {
  const laeufe = [
    unauffaellig({ stempel: "2026-09-01-100000" }),
    unauffaellig({ stempel: "2026-09-02-100000" }),
    unauffaellig({ stempel: "2026-09-03-100000" }),
  ];
  mitProjekt({ laeufe, config: { aufwand: { laeufe: 2 } } }, (dir) => {
    assert.equal(auswerten(dir, "--laeufe", "1").laeufe.einbezogen, 1);
  });
});

test("[aufwand-1] ohne Config-Block und ohne Config gelten die Vorgaben", () => {
  const erwartet = { pruefungAnteil: 0.5, eingrenzungOhneWirkung: true, werkzeugAnteil: 0.5, schreibkostenAnteil: 0.75 };
  // Einmal mit Config ohne den Block, einmal ganz ohne Config.
  mitProjekt({ laeufe: [unauffaellig()], config: { codeHost: "github" } }, (dir) => {
    const e = auswerten(dir);
    assert.deepEqual(e.schwellen, erwartet);
    assert.equal(e.laeufe.grenze, 10);
  });
  mitProjekt({ laeufe: [unauffaellig()] }, (dir) => {
    const e = auswerten(dir);
    assert.deepEqual(e.schwellen, erwartet);
    assert.equal(e.laeufe.grenze, 10);
  });
});

test("[aufwand-1] eingrenzungOhneWirkung laesst sich per Config abschalten", () => {
  const config = { aufwand: { schwellen: { eingrenzungOhneWirkung: false } } };
  mitProjekt({ laeufe: [unauffaellig({ vollerUmfang: true, ausgelassen: [] })], config }, (dir) => {
    assert.deepEqual(auswerten(dir).befund, []);
  });
});

// --- Fehlende Messwerte ------------------------------------------------------

test("[aufwand-1] ein fehlender Messwert unterdrueckt keinen Befund", () => {
  // Zwei Laeufe: einer ohne Zeiten, einer mit auffaelliger Werkzeugarbeit. Wer den
  // Anteil ueber ALLE Laeufe rechnete, verduennte die 60 Prozent auf 30 und schwiege.
  const laeufe = [
    lauf("2026-09-01-100000", { einheiten: [einheit(1, { zeiten: null, pruefung: null })] }),
    unauffaellig({
      stempel: "2026-09-02-100000",
      zeiten: { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs: 600, werkzeugSchuebe: 9, nebenlaeufigeSchuebe: 0 },
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(schwellen(e), ["werkzeugAnteil"]);
    assert.equal(e.befund[0].laeufe, 1, "der Befund sagt, auf wie vielen Laeufen er beruht");
  });
});

test("[aufwand-1] ein nicht bestimmbarer Anteil gilt nie als Beleg fuer Unauffaelligkeit", () => {
  // Gar keine Zeiten: Der Werkzeuganteil ist nicht bestimmbar. Er darf weder einen
  // Befund erzeugen noch als geprueft-und-unauffaellig im Bericht stehen.
  const laeufe = [lauf("2026-09-01-100000", { einheiten: [einheit(1, { zeiten: null, pruefung: null })] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(e.befund, []);
    assert.deepEqual(e.nichtBestimmbar.sort(), ["eingrenzungOhneWirkung", "pruefungAnteil", "werkzeugAnteil"]);
    assert.match(bericht(dir), /nicht bestimmbar/i, "der Bericht verschweigt, was er nicht pruefen konnte");
  });
});

test("[aufwand-1] mehrere ueberschrittene Schwellen stehen alle im Befund", () => {
  const laeufe = [unauffaellig({
    zeiten: { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs: 600, werkzeugSchuebe: 9, nebenlaeufigeSchuebe: 0 },
    vollerUmfang: true,
    ausgelassen: [],
    eingabeTokens: 1_000_000,
    ausgabeTokens: 1_000_000,
    laufen: [
      { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 900 },
      { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 100 },
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(schwellen(e), ["eingrenzungOhneWirkung", "pruefungAnteil", "schreibkostenAnteil", "werkzeugAnteil"]);
    assert.deepEqual(stand(dir).befund.map((b) => b.schwelle).sort(), schwellen(e));
  });
});
