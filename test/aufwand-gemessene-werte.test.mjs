// Die Auswertung rechnet nur mit gemessenen Werten (Issue #821).
//
// Vier Stellen in kit/aufwand.mjs haben eine fehlende Messung wie eine gemessene Null
// behandelt oder eine Grundlage mit einer anderen verglichen. Jede verfaelschte eine
// Kennzahl, ohne dass es auffiel — genau die Klasse Fehler, gegen die die Leitregel der
// Datei steht: Ein fehlender Messwert bleibt `null` und heisst "nicht gemessen", nie 0.
//
// Die vier Faelle, je eine eigene Fixture:
//   - fehlende Token-Mengen als Nullkosten (der gemeldete Betrag verschwand),
//   - `vollerUmfang === false` als Beleg einer gegriffenen Eingrenzung,
//   - Werkzeuganteil aus zwei verschiedenen Grundlagen,
//   - "nicht gestartet" als Ausfuehrung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, lauf, einheit, pruefstand, auswerten, bericht } from "./helpers/aufwand-fixture.mjs";

/** Eine Einheit ohne jede Token-Menge — nur der gemeldete Betrag steht da. */
function ohneMengen(id, felder = {}) {
  return einheit(id, {
    eingabeTokens: null,
    ausgabeTokens: null,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
    ...felder,
  });
}

// --- Fehlende Token-Mengen ---------------------------------------------------

test("[aufwand-4] eine Einheit mit bekanntem Modell und nur kostenUsd bucht den Betrag als nicht zuordenbar", () => {
  // Bisher ergaben sich Lesen, Schreiben und Gesamt je 0 — die gemeldeten 7 USD
  // verschwanden zwischen den Posten, und der Betrag sah aus wie gemessen.
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [ohneMengen(1, { modell: "claude-opus-5", kostenUsd: 7 })],
    verbrauchOhneEinheit: { kostenUsd: null, eingabeTokens: null, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null },
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.kosten.nichtZuordenbarUsd.wert, 7);
    assert.equal(e.kosten.gesamtUsd.wert, 7);
    assert.equal(e.kosten.lesenUsd.wert, null, "ohne Menge darf keine Lesekost behauptet werden");
    assert.equal(e.kosten.schreibenUsd.wert, null);
    assert.equal(e.kosten.ohneMengen.einheiten, 1);
    assert.equal(e.kosten.ohnePreissatz.einheiten, 0, "der Preissatz war bekannt, die Menge fehlte");
    assert.match(bericht(dir), /Token-Menge/i, "der Bericht verschweigt die fehlenden Mengen");
  });
});

test("[aufwand-4] eine Einheit ganz ohne verbrauch zaehlt als nicht gemessen, nicht als 0 USD", () => {
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [einheit(1, { verbrauch: undefined })],
    verbrauchOhneEinheit: { kostenUsd: null, eingabeTokens: null, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null },
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.kosten.lesenUsd.wert, null);
    assert.equal(e.kosten.schreibenUsd.wert, null);
    assert.equal(e.kosten.nichtZuordenbarUsd.wert, null);
    assert.equal(e.kosten.gesamtUsd.wert, null, "eine Einheit ohne Verbrauch traegt keine Kosten bei");
    assert.equal(e.kosten.lesenUsd.laeufe, 0, "sie zaehlt auch nicht als tragender Lauf");
    assert.equal(e.kosten.ohneMengen.einheiten, 1);
  });
});

test("[aufwand-4] eine fehlende Menge wird nicht als 0 gerechnet, die gemessenen zaehlen weiter", () => {
  // tier_5_25: Eingabe 5, Ausgabe 25 je Million. Die Ausgabe fehlt — die Schreibkosten
  // sind damit nicht gemessen, die Lesekosten stehen trotzdem.
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [einheit(1, {
      modell: "claude-opus-5",
      eingabeTokens: 1_000_000,
      ausgabeTokens: null,
      cacheErzeugtTokens: null,
      cacheGelesenTokens: null,
    })],
    verbrauchOhneEinheit: { kostenUsd: null, eingabeTokens: null, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null },
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.kosten.lesenUsd.wert, 5);
    assert.equal(e.kosten.schreibenUsd.wert, null, "die fehlende Ausgabe darf keine 0 USD Schreibkosten ergeben");
    assert.equal(e.kosten.gesamtUsd.wert, 5);
    assert.equal(e.kosten.ohneMengen.einheiten, 0, "eine gemessene Menge genuegt");
  });
});

// --- Gegriffene Eingrenzung --------------------------------------------------

/** Ein Lauf mit genau einem Pruefstand — alles andere bleibt unauffaellig. */
function mitPruefstand(stempel, felder) {
  return lauf(stempel, { einheiten: [einheit(1, { pruefung: pruefstand(felder) })] });
}

function eingrenzungsBefund(e) {
  return e.befund.find((b) => b.schwelle === "eingrenzungOhneWirkung") ?? null;
}

test("[aufwand-4] eine Auslassung wegen der Stufe belegt keine gegriffene Eingrenzung", () => {
  // `checks.mjs` legt Auslassungen spaeterer Stufen auch im vollen Umfang an. Sie als
  // Beleg zu nehmen liesse den Befund verschwinden, sobald ein Projekt eine Pruefung
  // auf die Push- oder Merge-Stufe legt — ohne dass sich an der Eingrenzung etwas
  // geaendert haette.
  const laeufe = [mitPruefstand("2026-09-01-100000", {
    vollerUmfang: true,
    ausgelassen: [{ cmd: "mvn verify", grund: "Stufe push, gefahren wird paket" }],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.eingrenzung.gegriffen, 0);
    assert.equal(e.eingrenzung.gemessen, 1);
    assert.ok(eingrenzungsBefund(e), "der Befund zur Eingrenzung fehlt");
  });
});

test("[aufwand-4] vollerUmfang false allein belegt keine gegriffene Eingrenzung", () => {
  // `checks.mjs` setzt das Feld standardmaessig auf false, an der Merge-Stufe sogar
  // bewusst — es markiert den Zweifelsfall, nicht die Eingrenzung.
  const laeufe = [mitPruefstand("2026-09-01-100000", { vollerUmfang: false, ausgelassen: [] })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.eingrenzung.gegriffen, 0);
    assert.ok(eingrenzungsBefund(e), "der Befund zur Eingrenzung fehlt");
  });
});

test("[aufwand-4] das leere Paket belegt keine gegriffene Eingrenzung", () => {
  const laeufe = [mitPruefstand("2026-09-01-100000", {
    zustand: "leeresPaket",
    leeresPaket: true,
    vollerUmfang: false,
    laufen: [],
    ausgelassen: [{ cmd: "node --test", grund: "leeres Paket: keine Aenderung seit abc1234" }],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.eingrenzung.gegriffen, 0);
    assert.ok(eingrenzungsBefund(e), "der Befund zur Eingrenzung fehlt");
  });
});

test("[aufwand-4] eine Auslassung wegen unberuehrten Bereichs belegt die gegriffene Eingrenzung", () => {
  // Die Gegenprobe: Genau dieser Grund — und nur er — stammt aus der Bereichsauswahl.
  for (const grund of ["Bereich kern unberuehrt", "Bereiche kern, doku unberuehrt"]) {
    const laeufe = [mitPruefstand("2026-09-01-100000", {
      vollerUmfang: false,
      ausgelassen: [{ cmd: "npx eslint .", grund }],
    })];
    mitProjekt({ laeufe }, (dir) => {
      const e = auswerten(dir);

      assert.equal(e.eingrenzung.gegriffen, 1, `'${grund}' haette als Eingrenzung zaehlen muessen`);
      assert.equal(eingrenzungsBefund(e), null, `'${grund}' haette den Befund verhindern muessen`);
    });
  }
});

// --- Werkzeuganteil auf einer Grundlage --------------------------------------

test("[aufwand-4] der Werkzeuganteil wird nur ueber Einheiten mit beiden Zeiten gebildet", () => {
  // Eine Einheit mit 600 von 1.000 ms, eine mit 9.000 ms ohne Werkzeugmessung. Ueber
  // beide Nenner gerechnet waeren es 6 Prozent, und der Befund verschwaende — obwohl die
  // einzige Einheit, die beides misst, bei 60 Prozent liegt.
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [
      einheit(1, { zeiten: { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs: 600, werkzeugSchuebe: 9, nebenlaeufigeSchuebe: 0 } }),
      einheit(2, { zeiten: { dauerMs: 9000, nachdenkenMs: null, werkzeugMs: null, werkzeugSchuebe: null, nebenlaeufigeSchuebe: null } }),
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zeit.gesamtMs.wert, 10_000, "die Gesamtzeit bleibt die Summe ueber alle Einheiten");
    assert.equal(e.zeit.werkzeugBasis.gesamtMs.wert, 1000, "die Grundlage des Anteils ist die Einheit mit beiden Zeiten");
    assert.equal(e.zeit.werkzeugBasis.werkzeugMs.wert, 600);
    assert.equal(e.zeit.werkzeugBasis.ohneBeideZeiten.einheiten, 1);

    const befund = e.befund.find((b) => b.schwelle === "werkzeugAnteil");
    assert.ok(befund, "der Werkzeug-Befund fehlt");
    assert.ok(Math.abs(befund.wert - 0.6) < 1e-9, `erwartet 60 Prozent, bekam ${befund.wert}`);
    assert.match(bericht(dir), /beide Zeiten|beiden Zeiten/i, "der Bericht nennt die Grundlage des Anteils nicht");
  });
});

test("[aufwand-4] eine Einheit ganz ohne Zeiten traegt den Anteil nicht und wird ausgewiesen", () => {
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [
      einheit(1, { zeiten: { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs: 400, werkzeugSchuebe: 5, nebenlaeufigeSchuebe: 0 } }),
      einheit(2, { zeiten: null }),
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.zeit.werkzeugBasis.gesamtMs.wert, 1000);
    assert.equal(e.zeit.werkzeugBasis.ohneBeideZeiten.einheiten, 1);
    assert.equal(e.zeit.werkzeugBasis.ohneBeideZeiten.laeufe, 1);
  });
});

// --- "nicht gestartet" -------------------------------------------------------

test("[aufwand-4] ein nicht gestarteter Eintrag zaehlt nicht als Ausfuehrung", () => {
  // `checks.mjs` setzt jedes Kommando nach dem ersten roten auf "nicht gestartet" und
  // begruendet fuer das Ausfuehrungsprotokoll selbst, dass das keine Ausfuehrung ist.
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [einheit(1, {
      pruefung: pruefstand({
        laufen: [
          { cmd: "node --test", grund: "voller Umfang", ergebnis: "rot", dauerMs: 5_000 },
          { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "nicht gestartet", dauerMs: null },
        ],
      }),
    })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    const rot = e.pruefungen.kommandos.find((k) => k.cmd === "node --test");
    assert.equal(rot.anzahl, 1, "der rote Lauf ist eine Ausfuehrung");
    assert.equal(rot.dauerMs, 5_000);
    assert.equal(e.pruefungen.kommandos.find((k) => k.cmd === "npx eslint ."), undefined,
      "ein nie gestartetes Kommando gehoert nicht in die Liste der Ausfuehrungen");
    assert.equal(e.pruefungen.kommandos.length, 1);
    assert.equal(e.pruefungen.gesamtMs.wert, 5_000);
  });
});

test("[aufwand-4] ein spaeter doch gelaufenes Kommando zaehlt nur seine echten Ausfuehrungen", () => {
  // Der haeufige Fall: erste Runde rot, der Rest bleibt liegen, zweite Runde gruen.
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [einheit(1, {
      pruefung: pruefstand({
        laufen: [
          { cmd: "node --test", grund: "voller Umfang", ergebnis: "rot", dauerMs: 5_000 },
          { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "nicht gestartet", dauerMs: null },
          { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 6_000 },
          { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 1_000 },
        ],
      }),
    })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.pruefungen.kommandos.find((k) => k.cmd === "node --test").anzahl, 2);
    assert.equal(e.pruefungen.kommandos.find((k) => k.cmd === "npx eslint .").anzahl, 1,
      "die nicht gestartete Runde zaehlt nicht mit");
    assert.equal(e.pruefungen.gesamtMs.wert, 12_000);
  });
});
