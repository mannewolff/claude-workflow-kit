// Der Aufwandsbericht weist jeden Rechner getrennt aus und zeigt die Werkzeugbasis je Stufe (Issue #1688, Plan #1685, E3/E4).
//
// Die Paketkennzahlen gelten auf dem Rechner des Messstands; Laeufe eines zweiten Rechners
// weist der Bericht getrennt aus, sie zaehlen nicht (Fachplan #1603, Frage 4). Ohne Option
// gilt der Rechner, auf dem der Bericht laeuft (E4); ein Stand ohne `rechner` steht als
// "unbekannt" und zaehlt fuer keinen (E3).

import { test } from "node:test";
import assert from "node:assert/strict";

import { RECHNER } from "../kit/effort.mjs";
import { mitProjekt, lauf, einheit, pruefstand, auswerten, bericht } from "./helpers/aufwand-fixture.mjs";

const ANDERER = `${RECHNER}-zwei`;

function zeiten(dauerMs, werkzeugMs) {
  return { dauerMs, nachdenkenMs: 100_000, werkzeugMs, werkzeugSchuebe: 10, nebenlaeufigeSchuebe: 0 };
}

test("[aufwand-1688] Staende zweier Rechner ergeben getrennte Kennzahlen", () => {
  const laeufe = [
    lauf("2026-10-14-030000", { rechner: ANDERER, einheiten: [einheit(3, { dauerMs: 900_000, zeiten: zeiten(900_000, 500_000) })] }),
    lauf("2026-10-14-020000", { einheiten: [einheit(2, { dauerMs: 600_000, zeiten: zeiten(600_000, 200_000) })] }),
    lauf("2026-10-14-010000", { einheiten: [einheit(1, { dauerMs: 400_000, zeiten: zeiten(400_000, 100_000) })] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const eigen = auswerten(dir);
    assert.equal(eigen.rechner.name, RECHNER);
    assert.equal(eigen.rechner.gewaehlt, "eigener");
    assert.deepEqual(eigen.laeufe.stempel, ["2026-10-14-020000", "2026-10-14-010000"]);
    assert.equal(eigen.zeit.werkzeugMs.wert, 300_000, "der Lauf des anderen Rechners darf nicht mitzaehlen");
    assert.deepEqual(eigen.rechner.uebrige, [{ name: ANDERER, laeufe: 1 }]);

    const fremd = auswerten(dir, "--machine", ANDERER);
    assert.equal(fremd.rechner.name, ANDERER);
    assert.equal(fremd.rechner.gewaehlt, "option");
    assert.deepEqual(fremd.laeufe.stempel, ["2026-10-14-030000"]);
    assert.equal(fremd.zeit.werkzeugMs.wert, 500_000);
    assert.deepEqual(fremd.rechner.uebrige, [{ name: RECHNER, laeufe: 2 }]);
  });
});

test("[aufwand-1688] ein Stand ohne `rechner` steht als unbekannt und zaehlt fuer keinen Rechner (E3)", () => {
  const laeufe = [
    lauf("2026-10-14-030000", { rechner: undefined, einheiten: [einheit(3)] }),
    lauf("2026-10-14-020000", { rechner: ANDERER, einheiten: [einheit(2)] }),
    lauf("2026-10-14-010000", { einheiten: [einheit(1)] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const eigen = auswerten(dir);
    assert.deepEqual(eigen.laeufe.stempel, ["2026-10-14-010000"]);
    assert.deepEqual(eigen.rechner.uebrige, [{ name: ANDERER, laeufe: 1 }, { name: null, laeufe: 1 }],
      "der unbekannte Rechner steht am Ende, mit seiner Zahl an Laeufen");

    const fremd = auswerten(dir, "--machine", ANDERER);
    assert.deepEqual(fremd.laeufe.stempel, ["2026-10-14-020000"], "auch der andere Rechner zaehlt den Stand ohne Angabe nicht");

    const text = bericht(dir);
    assert.match(text, /unbekannt \(1 Lauf\)/);
  });
});

test("[aufwand-1688] ohne Option gilt der Rechner des Berichts, die uebrigen stehen in einer eigenen Zeile (E4)", () => {
  const laeufe = [
    lauf("2026-10-14-030000", { rechner: ANDERER, einheiten: [einheit(3)] }),
    lauf("2026-10-14-025000", { rechner: ANDERER, einheiten: [einheit(4)] }),
    lauf("2026-10-14-010000", { einheiten: [einheit(1)] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    auswerten(dir);
    const zeilen = bericht(dir).split("\n");
    const eigen = zeilen.filter((z) => z.includes(`Rechners ${RECHNER}`));
    assert.equal(eigen.length, 1, "der ausgewertete Rechner steht in genau einer Zeile");
    assert.match(eigen[0], /auf dem dieser Bericht laeuft/);
    const uebrige = zeilen.filter((z) => z.startsWith("Nicht einbezogen, weil von einem anderen Rechner:"));
    assert.equal(uebrige.length, 1, "die uebrigen Rechner stehen in einer eigenen Zeile");
    assert.match(uebrige[0], new RegExp(`${ANDERER} \\(2 Laeufe\\)`));
  });
});

test("[aufwand-1688] ohne einen Stand des eigenen Rechners bleibt der Bericht leer und nennt die uebrigen", () => {
  const laeufe = [lauf("2026-10-14-030000", { rechner: ANDERER, einheiten: [einheit(3)] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.laeufe.einbezogen, 0);
    assert.equal(e.laeufe.gefunden, 0);
    assert.deepEqual(e.rechner.uebrige, [{ name: ANDERER, laeufe: 1 }]);
    assert.match(bericht(dir), /Nicht einbezogen, weil von einem anderen Rechner:/);
  });
});

test("[aufwand-1688] die Grenze zaehlt die Laeufe des gewaehlten Rechners", () => {
  const laeufe = [
    lauf("2026-10-14-050000", { rechner: ANDERER, einheiten: [einheit(5)] }),
    lauf("2026-10-14-040000", { einheiten: [einheit(4)] }),
    lauf("2026-10-14-030000", { rechner: ANDERER, einheiten: [einheit(3)] }),
    lauf("2026-10-14-020000", { einheiten: [einheit(2)] }),
    lauf("2026-10-14-010000", { einheiten: [einheit(1)] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir, "--runs", "2");
    assert.deepEqual(e.laeufe.stempel, ["2026-10-14-040000", "2026-10-14-020000"]);
  });
});

test("[aufwand-1688] je Stufe stehen Werkzeugzeit je Paket und ihr Anteil, dazu die Werkzeugbasis", () => {
  const laeufe = [
    lauf("2026-10-14-020000", {
      einheiten: [
        einheit(1, { zeiten: zeiten(600_000, 300_000) }),
        einheit(2, { zeiten: zeiten(400_000, 100_000) }),
        einheit(3, { stufeVerwendet: "schwer", zeiten: zeiten(1_000_000, 250_000) }),
        einheit(4, { zeiten: null }),
      ],
    }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    assert.deepEqual(e.zeit.werkzeugBasis.pakete, { wert: 3, laeufe: 1 });
    assert.deepEqual(e.zeit.werkzeugBasis.paketeMittel, { wert: 2, laeufe: 1 });

    const mittel = e.jeStufe.find((z) => z.stufe === "mittel");
    assert.equal(mittel.werkzeug.pakete, 2, "die Einheit ohne Zeiten zaehlt nicht als Paket mit Werkzeugzeit");
    assert.equal(mittel.werkzeug.jePaketMs, 200_000);
    assert.equal(mittel.werkzeug.anteil, 0.4);
    const schwer = e.jeStufe.find((z) => z.stufe === "schwer");
    assert.equal(schwer.werkzeug.jePaketMs, 250_000);
    assert.equal(schwer.werkzeug.anteil, 0.25);

    const text = bericht(dir);
    assert.match(text, /Pakete mit Werkzeugzeit: 3, davon Stufe mittel: 2/);
    assert.match(text, /3 min 20 s je Paket, 40,0 Prozent der Paketzeit \(2 Pakete\)/);
  });
});

test("[aufwand-1688] eine Stufe ohne Paket mit Werkzeugzeit traegt keine Null, sondern \"nicht gemessen\"", () => {
  const laeufe = [lauf("2026-10-14-020000", { einheiten: [einheit(1, { zeiten: null })] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    const mittel = e.jeStufe.find((z) => z.stufe === "mittel");
    assert.deepEqual(mittel.werkzeug, { pakete: 0, jePaketMs: null, anteil: null, laeufe: 0 });
    assert.deepEqual(e.zeit.werkzeugBasis.pakete, { wert: 0, laeufe: 0 });
  });
});

test("Szenario: Ein mittleres Paket ist früher fertig", () => {
  // Angenommen nach der Aenderung liegen mindestens 10 Pakete der Stufe mittel mit erfasster
  // Werkzeugzeit vor — auf dem Rechner des Berichts; dazu Laeufe eines zweiten Rechners und
  // ein alter Stand ohne Rechner, die nicht zaehlen duerfen.
  const eigene = Array.from({ length: 10 }, (_, i) => lauf(`2026-10-14-1${String(i).padStart(2, "0")}000`, {
    einheiten: [einheit(100 + i, { dauerMs: 600_000 + i * 10_000, zeiten: zeiten(600_000 + i * 10_000, 240_000) })],
  }));
  const laeufe = [
    ...eigene,
    lauf("2026-10-14-200000", { rechner: ANDERER, einheiten: [einheit(1, { dauerMs: 3_000_000, zeiten: zeiten(3_000_000, 2_000_000) })] }),
    lauf("2026-10-13-200000", { rechner: undefined, einheiten: [einheit(2, { dauerMs: 3_000_000, zeiten: zeiten(3_000_000, 2_000_000) })] }),
  ];
  mitProjekt({ laeufe, config: { aufwand: { laeufe: 30 } } }, (dir) => {
    // Wenn der Aufwandsbericht ihren Median mit der Vorher-Messung vergleicht
    const e = auswerten(dir);
    const mittel = e.verteilung.find((b) => b.art === "implementierung").stufen.find((z) => z.stufe === "mittel");
    // Dann liegt der Median bei hoechstens 12 Minuten
    assert.equal(mittel.dauerMs.anzahl, 10);
    assert.ok(mittel.dauerMs.median <= 12 * 60_000, `Median ${mittel.dauerMs.median} ms`);
    // Und der Bericht weist die Werkzeugzeit je Paket und ihren Anteil aus
    assert.deepEqual(e.zeit.werkzeugBasis.pakete, { wert: 10, laeufe: 10 });
    assert.deepEqual(e.zeit.werkzeugBasis.paketeMittel, { wert: 10, laeufe: 10 });
    const stufe = e.jeStufe.find((z) => z.stufe === "mittel");
    assert.equal(stufe.werkzeug.pakete, 10);
    assert.equal(stufe.werkzeug.jePaketMs, 240_000);
    assert.equal(stufe.werkzeug.anteil, 2_400_000 / 6_450_000);

    const text = bericht(dir);
    assert.match(text, new RegExp(`Rechners ${RECHNER}, auf dem dieser Bericht laeuft`));
    assert.match(text, /Pakete mit Werkzeugzeit: 10, davon Stufe mittel: 10/);
    assert.match(text, /4 min 0 s je Paket, 37,2 Prozent der Paketzeit \(10 Pakete\)/);
    assert.match(text, /\| mittel \| 10 \(ueber 10 Laeufe\) \| 10 min 40 s/, "der Median der Stufe mittel steht in der Verteilung");
  });
});

test("Szenario: Die Prüfgruppe der Nacht-Runner-Tests läuft schneller", () => {
  // Angenommen auf zwei Rechnern liegen Staende mit Ausfuehrungen der Pruefgruppe vor — dazu
  // ein Teillauf, eine nicht gestartete und eine ungemessene Ausfuehrung, die nicht zaehlen.
  const gruppe = "node --test test/night-*.test.mjs";
  const ausfuehrung = (id, dauerMs, felder = {}) => einheit(id, {
    pruefung: pruefstand({ laufen: [{ cmd: gruppe, grund: "voller Umfang", ergebnis: "gruen", dauerMs }], ...felder }),
  });
  const laeufe = [
    lauf("2026-10-14-050000", { einheiten: [ausfuehrung(5, 150_000), ausfuehrung(6, 170_000)] }),
    lauf("2026-10-14-040000", { einheiten: [ausfuehrung(4, 160_000), ausfuehrung(7, 20_000, { teillauf: true })] }),
    lauf("2026-10-14-030000", { einheiten: [
      ausfuehrung(3, 180_000, { laufen: [{ cmd: gruppe, grund: "voller Umfang", ergebnis: "gruen" }] }),
      ausfuehrung(8, 140_000, { laufen: [{ cmd: gruppe, grund: "voller Umfang", ergebnis: "nicht gestartet", dauerMs: 1 }] }),
    ] }),
    lauf("2026-10-14-020000", { rechner: ANDERER, einheiten: [ausfuehrung(1, 360_000), ausfuehrung(2, 380_000), ausfuehrung(9, 340_000)] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    // Wenn der Median ihrer verstrichenen Laufzeit je Rechner gelesen wird
    const eigen = auswerten(dir).pruefungen.kommandos.find((k) => k.cmd === gruppe);
    const textEigen = bericht(dir);
    const fremd = auswerten(dir, "--machine", ANDERER).pruefungen.kommandos.find((k) => k.cmd === gruppe);
    const textFremd = bericht(dir);
    // Dann nennt der Bericht ihn fuer jeden Rechner getrennt, nur aus vollstaendigen Ausfuehrungen
    assert.deepEqual(eigen.vollstaendig, { medianMs: 160_000, anzahl: 3, gleichzeitig: 0, laeufe: 2 });
    assert.deepEqual(fremd.vollstaendig, { medianMs: 360_000, anzahl: 3, gleichzeitig: 0, laeufe: 1 });
    assert.match(textEigen, /\| `node --test test\/night-\*\.test\.mjs` \| 5 \| .* \| 2 min 40 s \| 3 \| 0 \|/);
    assert.match(textFremd, /\| `node --test test\/night-\*\.test\.mjs` \| 3 \| .* \| 6 min 0 s \| 3 \| 0 \|/);
    // Und der Median nachher ist hoechstens halb so lang wie vorher — die Abnahme belegt das von Hand
    assert.ok(eigen.vollstaendig.medianMs <= fremd.vollstaendig.medianMs / 2);
  });
});
