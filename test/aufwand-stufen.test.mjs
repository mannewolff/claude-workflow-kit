// Aufwand je Aufgabenstufe und Gruendlichkeit (Issue #848, Plan #843, Fachliche Quelle #837).
//
// Der Fachplan verlangt, dass sich jede Aufgabenstufe vor und nach einer Umstellung der
// Gruendlichkeit vergleichen laesst, ohne dass jemand einen eigenen Vergleichslauf fahren
// muss (AK 5). Die Auswertung gruppiert dafuer die Einheiten der Ergebnisstaende nach dem
// Paar aus `stufeVerwendet` und `effort`.
//
// GEZAEHLT WIRD NUR, WAS EINE SESSION HATTE: eine Einheit mit `art: "implementierung"` und
// einem Feld `endStatus`. Einheiten ohne Session (uebersprungen, liegengeblieben,
// zurueckgestellt) und Ketten-Einheiten tragen weder `endStatus` noch `pruefung` — als
// Nacharbeit gezaehlt waeren sie allesamt eine, und die Quote saehe katastrophal aus.
//
// NACHARBEIT ist eine gezaehlte Einheit, deren `endStatus` nicht `in_review` ist ODER deren
// `pruefung.zustand` `rot` ist. "Nachpruefung rot" aus dem Fachplan meint genau diesen
// Pruefstand der Session, den der Runner liest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, lauf, einheit, pruefstand, auswerten, bericht, stand } from "./helpers/aufwand-fixture.mjs";

/** Die Zeile einer Stufe aus dem Ergebnis — der Zugriff, den fast jeder Test braucht. */
function zeile(e, stufe, effort) {
  return e.jeStufe.find((z) => z.stufe === stufe && z.effort === effort);
}

/** Die Zeilen des Berichtsabschnitts "Nach Aufgabenstufe", ohne Kopf und Trennzeile. */
function tabellenzeilen(text) {
  const abschnitt = text.split("## Nach Aufgabenstufe")[1] ?? "";
  return abschnitt.split("\n").filter((z) => z.startsWith("| ") && !z.startsWith("| ---") && !z.startsWith("| Stufe"));
}

test("[aufwand-848] die Einheiten werden je Paar aus Stufe und Gruendlichkeit gesammelt", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [
        einheit(1, { stufeVerwendet: "mittel", effort: "high" }),
        einheit(2, { stufeVerwendet: "schwer", effort: "high" }),
      ],
    }),
    lauf("2026-09-02-100000", {
      einheiten: [
        einheit(3, { stufeVerwendet: "mittel", effort: "high" }),
        einheit(4, { stufeVerwendet: "mittel", effort: "low" }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.jeStufe.length, 3, `erwartet drei Paare, bekam: ${JSON.stringify(e.jeStufe)}`);
    const mittelHigh = zeile(e, "mittel", "high");
    assert.equal(mittelHigh.einheiten.wert, 2);
    assert.equal(mittelHigh.einheiten.laeufe, 2, "beide Laeufe tragen das Paar mittel/high");
    // Die Vorgabewerte der Fixture: 600.000 ms und 1 USD je Einheit.
    assert.equal(mittelHigh.dauerMs.wert, 1_200_000);
    assert.equal(mittelHigh.kostenUsd.wert, 2);
    assert.equal(zeile(e, "mittel", "low").einheiten.wert, 1);
    assert.equal(zeile(e, "schwer", "high").einheiten.wert, 1);
  });
});

test("[aufwand-848] die Zeilen stehen in fester Reihenfolge, damit zwei Laeufe denselben Bericht ergeben", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [
        einheit(1, { stufeVerwendet: "schwer", effort: "high" }),
        einheit(2, { stufeVerwendet: "mittel", effort: "low" }),
        einheit(3, { stufeVerwendet: "mittel", effort: "high" }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(
      e.jeStufe.map((z) => `${z.stufe}/${z.effort}`),
      ["mittel/high", "mittel/low", "schwer/high"]
    );
  });
});

test("[aufwand-848] Nacharbeit ist ein anderer Endstatus als in_review oder ein roter Pruefstand", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [
        // Sauber durch: kein Fall von Nacharbeit.
        einheit(1, { stufeVerwendet: "mittel", effort: "high" }),
        // Im Backlog gelandet — die Runde hat nichts abgeliefert.
        einheit(2, { stufeVerwendet: "mittel", effort: "high", endStatus: "backlog", ausgang: "fehlschlag" }),
        // In review, aber die Pruefung war rot.
        einheit(3, { stufeVerwendet: "mittel", effort: "high", pruefung: pruefstand({ zustand: "rot" }) }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    const z = zeile(e, "mittel", "high");

    assert.equal(z.einheiten.wert, 3);
    assert.equal(z.rotePruefstaende.wert, 1);
    assert.equal(z.rotePruefstaende.laeufe, 1);
    assert.equal(z.nacharbeit.wert, 2, "der Fehlschlag und der rote Pruefstand zaehlen beide");
    assert.equal(z.nacharbeit.laeufe, 1);
  });
});

test("[aufwand-848] ohne Fall von Nacharbeit stehen dort Nullen und keine Laeufe", () => {
  mitProjekt({ laeufe: [lauf("2026-09-01-100000", { einheiten: [einheit(1, { stufeVerwendet: "mittel", effort: "high" })] })] }, (dir) => {
    const z = zeile(auswerten(dir), "mittel", "high");

    assert.equal(z.nacharbeit.wert, 0);
    assert.equal(z.nacharbeit.laeufe, 0);
    assert.equal(z.rotePruefstaende.wert, 0);
  });
});

test("[aufwand-848] Einheiten ohne Session und Ketten-Einheiten bleiben aussen vor", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [
        einheit(1, { stufeVerwendet: "mittel", effort: "high" }),
        // Uebersprungen: nie eine Session, also weder endStatus noch Pruefstand.
        einheit(2, { stufeVerwendet: "mittel", effort: "high", endStatus: undefined, ausgang: "uebersprungen", zeiten: null, pruefung: null }),
        // Liegengeblieben — dasselbe.
        einheit(3, { stufeVerwendet: null, effort: null, endStatus: undefined, ausgang: "liegengeblieben", zeiten: null, pruefung: null }),
        // Eine Einheit der Kette: andere Art, auch mit Endstatus kein Arbeitspaket.
        einheit(4, { art: "kette", stufeVerwendet: "mittel", effort: "high" }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.einheiten, 4, "der Gesamtzaehler der Einheiten bleibt unberuehrt");
    assert.equal(e.jeStufe.length, 1);
    assert.equal(zeile(e, "mittel", "high").einheiten.wert, 1);
    assert.equal(zeile(e, "mittel", "high").nacharbeit.wert, 0, "die drei Ausgeschlossenen zaehlen nicht als Nacharbeit");
  });
});

test("[aufwand-848] ein alter Stand ohne Feld effort zaehlt zur Voreinstellung", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [
        einheit(1, { stufeVerwendet: "mittel" }),
        einheit(2, { stufeVerwendet: "mittel", effort: null }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.jeStufe.length, 1, "fehlendes Feld und null sind derselbe Fall");
    assert.equal(zeile(e, "mittel", null).einheiten.wert, 2);
    assert.match(bericht(dir), /\| mittel \| Voreinstellung \|/);
  });
});

test("[aufwand-848] die Zeile 'ohne Stufe' steht am Ende, mit dem Satz darunter", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [
        einheit(1, { stufeVerwendet: null, effort: null }),
        einheit(2, { stufeVerwendet: "mittel", effort: "high" }),
        einheit(3, { stufeVerwendet: "schwer", effort: "high" }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.jeStufe.at(-1).stufe, null);

    const text = bericht(dir);
    const zeilen = tabellenzeilen(text);
    assert.equal(zeilen.length, 3);
    assert.ok(zeilen.at(-1).startsWith("| ohne Stufe |"), `letzte Zeile: ${zeilen.at(-1)}`);
    assert.ok(
      text.includes("Einheiten ohne Aufgabenstufe: Modell von der Karte oder vom Lauf, Staende vor #711."),
      "der erklaerende Satz fehlt"
    );
    assert.ok(
      text.indexOf("Einheiten ohne Aufgabenstufe") > text.indexOf("| ohne Stufe |"),
      "der Satz steht nicht unter der Zeile"
    );
  });
});

test("[aufwand-848] ohne Zeile 'ohne Stufe' entfaellt der Satz dazu", () => {
  mitProjekt({ laeufe: [lauf("2026-09-01-100000", { einheiten: [einheit(1, { stufeVerwendet: "mittel", effort: "high" })] })] }, (dir) => {
    auswerten(dir);

    assert.ok(!bericht(dir).includes("Einheiten ohne Aufgabenstufe"),
      "der Satz erklaert eine Zeile, die es nicht gibt");
  });
});

test("[aufwand-848] der Bericht nennt den Abschnitt samt Definition der Nacharbeit", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [einheit(1, { stufeVerwendet: "mittel", effort: "high", endStatus: "backlog" })],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    auswerten(dir);
    const text = bericht(dir);

    assert.ok(text.includes("## Nach Aufgabenstufe"), "der Abschnitt fehlt");
    assert.match(text, /\| Stufe \| Gruendlichkeit \| Einheiten \| Dauer \| Kosten \| Rote Pruefstaende \| Nacharbeit \|/);
    assert.match(text, /Als Nacharbeit zaehlt eine Einheit, deren Endstatus nicht `in_review` ist oder deren Pruefstand rot war/);
    const zeilen = tabellenzeilen(text);
    assert.equal(zeilen.length, 1);
    assert.match(zeilen[0], /^\| mittel \| high \| 1 \(aus einem einzigen Lauf\) \| 10 min 0 s \(aus einem einzigen Lauf\) \|/);
    assert.match(zeilen[0], /\| 0 \| 1 \(aus einem einzigen Lauf\) \|$/);
  });
});

test("[aufwand-848] ohne Einheit mit Session sagt der Abschnitt das ausdruecklich", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [einheit(1, { endStatus: undefined, ausgang: "uebersprungen", zeiten: null, pruefung: null })],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(e.jeStufe, []);
    assert.match(bericht(dir), /## Nach Aufgabenstufe\n\nKeine Einheit mit gestarteter Session/);
  });
});

test("[aufwand-848] der Block jeStufe steht auch in aufwand.json", () => {
  mitProjekt({ laeufe: [lauf("2026-09-01-100000", { einheiten: [einheit(1, { stufeVerwendet: "mittel", effort: "high" })] })] }, (dir) => {
    auswerten(dir);
    const s = stand(dir);

    assert.equal(s.jeStufe.length, 1);
    assert.equal(s.jeStufe[0].stufe, "mittel");
    assert.equal(s.jeStufe[0].effort, "high");
  });
});

test("[aufwand-848] eine Stufe ohne gemessene Dauer und Kosten traegt null, nie 0", () => {
  const laeufe = [
    lauf("2026-09-01-100000", {
      einheiten: [
        einheit(1, {
          stufeVerwendet: "leicht",
          effort: "low",
          zeiten: null,
          kostenUsd: null,
          eingabeTokens: null,
          ausgabeTokens: null,
          cacheErzeugtTokens: null,
          cacheGelesenTokens: null,
        }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const z = zeile(auswerten(dir), "leicht", "low");

    assert.equal(z.einheiten.wert, 1, "die Einheit selbst ist gezaehlt");
    assert.equal(z.dauerMs.wert, null);
    assert.equal(z.kostenUsd.wert, null);
    assert.match(bericht(dir), /\| leicht \| low \| 1 \(aus einem einzigen Lauf\) \| nicht gemessen \| nicht gemessen \|/);
  });
});

test("[aufwand-848] die bisherigen Abschnitte und ihre Reihenfolge bleiben unveraendert", () => {
  const laeufe = [lauf("2026-09-01-100000", { einheiten: [einheit(1, { stufeVerwendet: "mittel", effort: "high" })] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    const text = bericht(dir);

    const reihenfolge = ["# Aufwand des Prozesses", "## Zeit", "## Pruefungen", "## Umfang der Pruefungen", "## Kosten", "## Nach Aufgabenstufe", "## Befund"];
    let zuletzt = -1;
    for (const ueberschrift of reihenfolge) {
      const pos = text.indexOf(ueberschrift);
      assert.ok(pos > zuletzt, `${ueberschrift} steht nicht an seinem Platz`);
      zuletzt = pos;
    }
    // Die alten Bloecke des Stands tragen weiter ihre Werte — der neue haengt an, er ersetzt nichts.
    assert.equal(e.einheiten, 1);
    assert.equal(e.zeit.gesamtMs.wert, 600_000);
    assert.equal(e.pruefungen.kommandos.length, 2);
    assert.equal(e.umfang.voll, 1);
    assert.ok(e.kosten.gesamtUsd.wert > 0);
    // Die Schwellen laufen weiter ueber dieselben Groessen: Die Fixture-Einheit
    // ueberschreitet den Pruefungsanteil, und dieser Befund steht unveraendert da.
    assert.ok(e.befund.some((b) => b.schwelle === "pruefungAnteil"), "der bisherige Befund fehlt");
  });
});
