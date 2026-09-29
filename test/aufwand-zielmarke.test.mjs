// Die Zielmarke in der Aufwands-Auswertung (Issue #978, Plan #974, E7 bis E10).
//
// Ueber mehrere Laeufe hinweg soll ablesbar sein, wie viele Umsetzungen die Zielmarke
// reissen und wie weit sie darueber liegen. Drei Regeln tragen den Block:
//
//   Die Marke kommt aus dem LAUF-KOPF des Ergebnisstands und nicht aus der Config (E7):
//   Sie kann zwischen zwei Laeufen eine andere gewesen sein, und eine Vorgabe an einem
//   dritten Ort driftet gegen beide.
//
//   Ein Zeitabbruch (`zeitlimitBeendet`) ist keine Messung (E8): Seine
//   Fertigstellungsdauer ist unbekannt. Er steht getrennt und geht in keinen Mittelwert.
//
//   Kein Befund und keine Schwelle (E10): Wieviele Umsetzungen die Marke reissen, ist
//   eine Zahl und keine Ursachenaussage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, lauf, einheit, auswerten, bericht, stand } from "./helpers/aufwand-fixture.mjs";

const MIN = 60_000;

/** Eine Umsetzung mit gemessener Dauer — der Pruefstand macht sie zum gewerteten Versuch. */
function umsetzung(id, minuten, felder = {}) {
  return einheit(id, { zeiten: { dauerMs: minuten * MIN, nachdenkenMs: 1000, werkzeugMs: 1000, werkzeugSchuebe: 1, nebenlaeufigeSchuebe: 0 }, ...felder });
}

/** Ein Lauf mit Zielmarke im Kopf — so, wie night.mjs ihn seit Issue #978 anlegt. */
function laufMitMarke(stempel, marke, einheiten) {
  return lauf(stempel, { zielUmsetzungMin: marke, einheiten });
}

test("[aufwand-978] gezaehlt wird je Versuch und nicht je Paket", () => {
  // Zwei Einheiten mit derselben Id: dasselbe Paket in zwei Anlaeufen. Dieselbe
  // Filterregel wie `pruefungErfassen` — wer je Paket zaehlte, verloere den zweiten
  // Anlauf, und gerade der ist der teure.
  const laeufe = [laufMitMarke("2026-09-01-100000", 10, [umsetzung(500, 4), umsetzung(500, 30)])];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.versuche, 2, "beide Anlaeufe desselben Pakets zaehlen");
    assert.equal(e.zielmarke.ueber, 1, "nur der zweite Anlauf liegt ueber der Marke");
  });
});

test("[aufwand-978] eine Einheit ohne Pruefstand ist keine gemessene Umsetzung", () => {
  const laeufe = [laufMitMarke("2026-09-01-100000", 10, [umsetzung(501, 4), umsetzung(502, 40, { pruefung: null })])];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.versuche, 1, "die Einheit ohne Pruefstand hat keine Umsetzung, die sich messen liesse");
    assert.equal(e.zielmarke.ueber, 0);
  });
});

test("[aufwand-978] eine Einheit mit zeitlimitBeendet zaehlt allein als Zeitabbruch", () => {
  // Sie geht in kein Mittel und in keine Reihe: Wie lange sie gebraucht HAETTE, weiss
  // niemand. Eine Schaetzung als Messung auszuweisen waere falsch (E8).
  const laeufe = [laufMitMarke("2026-09-01-100000", 10, [
    umsetzung(510, 4),
    umsetzung(511, 60, { zeitlimitBeendet: true }),
  ])];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.zeitabbrueche, 1);
    assert.equal(e.zielmarke.versuche, 1, "der Zeitabbruch ist kein gewerteter Versuch");
    assert.equal(e.zielmarke.ueber, 0, "der Zeitabbruch zaehlt nicht als Ueberschreitung");
    assert.equal(e.zielmarke.ueberschreitungMittelMs, null, "ohne Ueberschreitung gibt es kein Mittel");
    assert.equal(e.zielmarke.ueberschreitungMaxMs, null);

    assert.match(bericht(dir), /Fertigstellungsdauer/,
      "der Bericht sagt nicht, dass die Fertigstellungsdauer eines Zeitabbruchs unbekannt ist");
  });
});

test("[aufwand-978] ein Stand ohne Marke zaehlt in ohneMarke und in keine Reihe", () => {
  const laeufe = [lauf("2026-09-01-100000", { einheiten: [umsetzung(520, 40)] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.ohneMarke.einheiten, 1);
    assert.equal(e.zielmarke.ohneMarke.laeufe, 1);
    assert.equal(e.zielmarke.versuche, 0, "ohne Marke gibt es nichts, wogegen gemessen wuerde");
    assert.equal(e.zielmarke.ueberschreitungMittelMs, null);
    assert.match(bericht(dir), /ohne Zielmarke/i, "der Bericht nennt die Einheiten ohne Marke nicht");
  });
});

test("[aufwand-978] die Marke stammt aus dem Lauf-Kopf und nicht aus der Config", () => {
  // Der Stand sagt 10 Minuten, die Config sagt 60. Nach dem Kopf ist die Umsetzung von
  // 20 Minuten eine Ueberschreitung, nach der Config waere sie unauffaellig (E7).
  const laeufe = [laufMitMarke("2026-09-01-100000", 10, [umsetzung(530, 20)])];
  const config = { night: { zielUmsetzungMin: 60 }, aufwand: { laeufe: 10 } };
  mitProjekt({ laeufe, config }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.ueber, 1, "gewertet wird gegen die Marke des Stands, nicht gegen die der Config");
    assert.deepEqual(e.zielmarke.marken, [10], "die Auswertung weist die Marken der Staende aus");
    assert.equal(e.zielmarke.ueberschreitungMaxMs, 10 * MIN);
  });
});

test("[aufwand-978] zwei Staende mit verschiedenen Marken werden jeder nach seinem Kopf gewertet", () => {
  const laeufe = [
    laufMitMarke("2026-09-02-100000", 30, [umsetzung(541, 20)]),
    laufMitMarke("2026-09-01-100000", 10, [umsetzung(540, 20)]),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.versuche, 2);
    assert.equal(e.zielmarke.ueber, 1, "nur die Umsetzung des Stands mit der Marke 10 reisst sie");
    assert.deepEqual(e.zielmarke.marken, [10, 30]);
    assert.equal(e.zielmarke.laeufe, 2, "beide Laeufe tragen die Kennzahl");
  });
});

test("[aufwand-978] Mittel und Maximum der Ueberschreitung stimmen an bekannten Dauern", () => {
  // Marke 10 min; 12, 22 und 4 Minuten Dauer: zwei Ueberschreitungen um 2 und 12
  // Minuten — Mittel 7, Maximum 12. Gemittelt wird ueber die Ueberschreitungen, nicht
  // ueber alle Versuche: Wer unter der Marke bleibt, verduennte sonst den Befund.
  const laeufe = [laufMitMarke("2026-09-01-100000", 10, [umsetzung(550, 12), umsetzung(551, 22), umsetzung(552, 4)])];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.versuche, 3);
    assert.equal(e.zielmarke.ueber, 2);
    assert.equal(e.zielmarke.ueberschreitungMittelMs, 7 * MIN);
    assert.equal(e.zielmarke.ueberschreitungMaxMs, 12 * MIN);
    assert.deepEqual(stand(dir).zielmarke, e.zielmarke, "der geschriebene Stand traegt denselben Block");

    const text = bericht(dir);
    assert.match(text, /2 von 3/, "der Bericht nennt die Zahl der Ueberschreitungen an den Versuchen");
  });
});

test("[aufwand-978] ohne jede Grundlage steht 'nicht gemessen' und keine 0", () => {
  // Ein Lauf ohne Einheiten: keine Umsetzung, kein Zeitabbruch, keine Marke im Spiel.
  const laeufe = [lauf("2026-09-01-100000", { einheiten: [] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zielmarke.versuche, 0);
    assert.equal(e.zielmarke.ueberschreitungMittelMs, null);

    const abschnitt = zielmarkeAbschnitt(bericht(dir));
    assert.match(abschnitt, /nicht gemessen/, `der Leerfall steht nicht als "nicht gemessen" da:\n${abschnitt}`);
    assert.ok(!/0 von 0/.test(abschnitt), `der Leerfall behauptet eine gemessene Null:\n${abschnitt}`);
  });
});

test("[aufwand-978] Befunde und Schwellen wachsen um keinen Eintrag zur Zielmarke", () => {
  // E10: Ein Befund ueber zu viele Ueberschreitungen waere eine Ursachenaussage, und der
  // Config-Block `aufwand` bekommt keinen neuen Eintrag. Der Fixture-Stand reisst die
  // Marke in jedem einzelnen Versuch — auffaelliger wird es nicht.
  const laeufe = [laufMitMarke("2026-09-01-100000", 10, [umsetzung(560, 90), umsetzung(561, 120)])];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.deepEqual(Object.keys(e.schwellen).sort(),
      ["eingrenzungOhneWirkung", "pruefungAnteil", "schreibkostenAnteil", "werkzeugAnteil"],
      "die Schwellen haben einen Eintrag bekommen");
    assert.equal(e.zielmarke.ueber, 2, "der Fixture-Stand reisst die Marke tatsaechlich");
    for (const b of e.befund) {
      assert.ok(!/marke|ueberschreitung|zielmarke/i.test(b.text), `ein Befund spricht von der Zielmarke: ${b.text}`);
    }
    for (const name of e.nichtBestimmbar) {
      assert.ok(!/marke/i.test(name), `eine nicht bestimmbare Schwelle spricht von der Marke: ${name}`);
    }
  });
});

/** Der Abschnitt zur Zielmarke aus dem Bericht — bis zur naechsten Ueberschrift. */
function zielmarkeAbschnitt(text) {
  const teile = text.split(/^## /m).filter((t) => /^Zielmarke/.test(t));
  assert.equal(teile.length, 1, `genau ein Abschnitt "## Zielmarke ..." erwartet:\n${text}`);
  return teile[0];
}
