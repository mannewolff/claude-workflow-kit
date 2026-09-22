// Die Kostenteilung ueber zwei Cache-Saetze (Issue #750, Plan #745).
//
// Der Zwischenspeicher wird nach Haltedauer getrennt bepreist: Der Stunden-Speicher
// kostet das Doppelte der Eingabe, der Fuenf-Minuten-Speicher das 1,25-fache. Beide in
// einen Satz zu werfen verfehlte den Betrag um bis zu 60 Prozent (kit/preise.mjs).
// Issue #749 hat die Teilung deshalb in den Ergebnisstand geholt — hier wird sie
// gerechnet.
//
// Der Fall OHNE Teilung ist der wichtigere: Jeder Stand aus der Zeit vor Issue #749
// traegt sie nicht. Dann gilt der teurere Stunden-Satz — Claude Code faehrt fuer lange
// Sitzungen den Stunden-Speicher —, und die Auswertung sagt, dass sie das getan hat.
// Ein stillschweigend gewaehlter Satz waere ein geratener Betrag, der aussaehe wie
// gemessen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, lauf, einheit, auswerten, aufwandOhnePreise, bericht } from "./helpers/aufwand-fixture.mjs";

// claude-opus-5 liegt in tier_5_25: cacheSchreiben5m 6,25 und cacheSchreiben1h 10 je
// Million Token. Eingabe und Ausgabe stehen hier auf 0, damit allein der Cache zaehlt.
function nurCache(felder) {
  return einheit(1, { eingabeTokens: 0, ausgabeTokens: 0, cacheGelesenTokens: 0, ...felder });
}

test("[aufwand-1] mit Cache-Teilung werden 5m und 1h mit ihrem eigenen Satz bepreist", () => {
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [nurCache({ cacheErzeugtTokens: 3_000_000, cache5mTokens: 2_000_000, cache1hTokens: 1_000_000 })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    // 2 Mio zu 6,25 plus 1 Mio zu 10.
    assert.equal(e.kosten.lesenUsd.wert, 22.5);
    assert.equal(e.kosten.ohneTeilung.einheiten, 0, "diese Einheit trug ihre Teilung");
    assert.equal(e.kosten.ohneTeilung.tokens, 0);
  });
});

test("[aufwand-1] ohne Cache-Teilung gilt der Stunden-Satz, und die Unschaerfe steht im Bericht", () => {
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [nurCache({ cacheErzeugtTokens: 3_000_000, cache5mTokens: null, cache1hTokens: null })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.kosten.lesenUsd.wert, 30, "3 Mio zum Stunden-Satz von 10");
    assert.equal(e.kosten.ohneTeilung.einheiten, 1);
    assert.equal(e.kosten.ohneTeilung.tokens, 3_000_000);
    assert.match(bericht(dir), /ohne (Cache-)?Teilung|Stunden-Satz/i,
      "der Bericht weist die Unschaerfe nicht aus");
  });
});

test("[aufwand-1] was die Teilung nicht deckt, faellt auf den Stunden-Satz und zaehlt als ungeteilt", () => {
  // Mehrere Sessions an derselben Karte: `verbrauch` summiert, `kennzahlen` traegt nur
  // die letzte. Der Rest darf nicht verschwinden — und nicht zum guenstigeren Satz
  // geraten werden.
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [nurCache({ cacheErzeugtTokens: 3_000_000, cache5mTokens: 1_000_000, cache1hTokens: 0 })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    // 1 Mio zu 6,25 plus 2 Mio ungeteilt zu 10.
    assert.equal(e.kosten.lesenUsd.wert, 26.25);
    assert.equal(e.kosten.ohneTeilung.einheiten, 1);
    assert.equal(e.kosten.ohneTeilung.tokens, 2_000_000);
  });
});

test("[aufwand-1] fehlt kit/preise.mjs als Nachbardatei, entfaellt die Kostenteilung mit Vermerk", () => {
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [einheit(1, { kostenUsd: 4.25 })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const res = aufwandOhnePreise(dir, "auswerten");

    assert.equal(res.status, 0, `ohne Preistabelle darf nichts abstuerzen: ${res.stderr}`);
    const e = JSON.parse(res.stdout);
    assert.equal(e.kosten.preistabelle, null, "ohne Nachbardatei gibt es keinen Stand der Tabelle");
    assert.equal(e.kosten.lesenUsd.wert, null, "ohne Preise darf kein Satz geraten werden");
    assert.equal(e.kosten.schreibenUsd.wert, null);
    assert.equal(e.kosten.gesamtUsd.wert, 4.25, "der gemeldete Betrag bleibt bestimmbar");
    assert.equal(e.kosten.nichtZuordenbarUsd.wert, 4.25);
    assert.match(bericht(dir), /Preistabelle/i, "der Bericht nennt die fehlende Preistabelle nicht");
  });
});

test("[aufwand-1] liegt kit/preise.mjs daneben, nennt die Auswertung ihren Stand", () => {
  mitProjekt({ laeufe: [lauf("2026-09-01-100000", { einheiten: [einheit(1)] })] }, (dir) => {
    const e = auswerten(dir);

    assert.match(e.kosten.preistabelle, /^\d{4}-\d{2}-\d{2}$/,
      "der Stand der Preistabelle gehoert in die Auswertung — Preise veralten");
  });
});
