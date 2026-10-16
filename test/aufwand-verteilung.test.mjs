// Verteilung je Laufart und Aufgabenstufe (Issue #1339, Anlass Idee #1295).
//
// Die Summen der Auswertung sagen, wie viel Zeit insgesamt verging, nicht, wie sie sich
// ueber die Pakete verteilt. Der Abschnitt "Verteilung" fuehrt je Laufart (`art`) und darin
// je Aufgabenstufe (`stufeVerwendet`) die EINZELWERTE und gibt Median und 90. Perzentil aus
// — nach Nearest-Rank, damit jeder ausgegebene Wert ein tatsaechlich gemessener ist.
//
// Dazu je Gruppe die dominierende Zeitart (der groesste der drei Mediane Nachdenken,
// Werkzeug, Rest), die Pruefläufe je Paket (`prueflaeufe.arbeit.anzahl +
// prueflaeufe.abschluss.anzahl`) und den Anteil der Zeitabbrueche.
//
// Ein fehlender Messwert bleibt `null` und heisst "nicht gemessen" — nie 0.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, lauf, einheit, auswerten, bericht, stand } from "./helpers/aufwand-fixture.mjs";

/** Die Gruppe einer Laufart und Stufe aus dem Ergebnis. */
function gruppe(e, art, stufe) {
  const block = e.verteilung.find((v) => v.art === art);
  return block?.stufen.find((s) => s.stufe === stufe);
}

/** Eine Einheit mit vorgegebenen Zeiten; `dauerMs` der Runde gleich der Session-Dauer. */
function mitZeiten(id, dauerMs, nachdenkenMs, werkzeugMs, felder = {}) {
  return einheit(id, { zeiten: { dauerMs, nachdenkenMs, werkzeugMs }, ...felder });
}

function prueflaeufe(arbeit, abschluss) {
  return { arbeit: { anzahl: arbeit, dauerMs: 1000 }, abschluss: { anzahl: abschluss, dauerMs: 1000 } };
}

test("[aufwand-1339] fuenf Einheiten einer Gruppe ergeben Median und 90. Perzentil nach Nearest-Rank", () => {
  // Dauern bewusst unsortiert: 50, 10, 40, 20, 30 Sekunden.
  const dauern = [50_000, 10_000, 40_000, 20_000, 30_000];
  const laeufe = [
    lauf("2026-10-01-100000", { einheiten: dauern.slice(0, 3).map((d, i) => mitZeiten(i + 1, d, d / 2, d / 4)) }),
    lauf("2026-10-02-100000", { einheiten: dauern.slice(3).map((d, i) => mitZeiten(i + 4, d, d / 2, d / 4)) }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "implementierung", "mittel");
    assert.ok(g, "die Gruppe implementierung/mittel fehlt");
    assert.equal(g.einheiten.wert, 5);
    assert.equal(g.einheiten.laeufe, 2);
    // Nearest-Rank: Median = Rang ceil(0,5 * 5) = 3 -> 30 s; P90 = Rang ceil(0,9 * 5) = 5 -> 50 s.
    assert.deepEqual(g.dauerMs, { anzahl: 5, median: 30_000, p90: 50_000, laeufe: 2 });
    assert.equal(g.nachdenkenMs.median, 15_000);
    assert.equal(g.werkzeugMs.p90, 12_500);
    // Rest = Dauer - Nachdenken - Werkzeug = ein Viertel der Dauer.
    assert.equal(g.restMs.median, 7_500);
  });
});

test("[aufwand-1339] Nearest-Rank liefert bei gerader Anzahl einen gemessenen Wert, keinen Mittelwert", () => {
  const laeufe = [lauf("2026-10-01-100000", {
    einheiten: [10_000, 20_000, 30_000, 40_000].map((d, i) => mitZeiten(i + 1, d, d / 2, d / 4)),
  })];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "implementierung", "mittel");
    // Rang ceil(0,5 * 4) = 2 -> 20 s, nicht 25 s.
    assert.equal(g.dauerMs.median, 20_000);
    assert.equal(g.dauerMs.p90, 40_000);
  });
});

test("[aufwand-1339] Werkzeug null heisst nicht gemessen, die dominierende Zeitart nicht bestimmbar — nie 0", () => {
  const laeufe = [lauf("2026-10-01-100000", {
    einheiten: [mitZeiten(1, 60_000, 30_000, null), mitZeiten(2, 80_000, 40_000, null)],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "implementierung", "mittel");
    assert.deepEqual(g.werkzeugMs, { anzahl: 0, median: null, p90: null, laeufe: 0, text: "nicht gemessen" });
    // Ohne Werkzeugzeit gibt es keinen Rest — er waere sonst die Werkzeugzeit mit.
    assert.equal(g.restMs.median, null);
    assert.equal(g.dominierend.zeitart, null);
    assert.equal(g.dominierend.text, "nicht bestimmbar");
    assert.match(g.dominierend.grund, /^Werkzeug, Rest nicht gemessen$/, "der Rest haengt an der Werkzeugzeit");

    const text = bericht(dir).split("## Verteilung")[1];
    assert.ok(text, "der Abschnitt Verteilung fehlt im Bericht");
    assert.match(text, /nicht gemessen/);
    assert.match(text, /nicht bestimmbar \(Werkzeug, Rest nicht gemessen\)/);
    const zeile = text.split("\n").find((z) => z.startsWith("| mittel"));
    assert.ok(zeile, "die Zeile der Stufe mittel fehlt");
    assert.doesNotMatch(zeile, /\| 0 ms/, "eine fehlende Werkzeugzeit darf nicht als 0 erscheinen");
  });
});

test("[aufwand-1339] klar ueberwiegende Werkzeugzeit wird als Werkzeug benannt", () => {
  const laeufe = [lauf("2026-10-01-100000", {
    einheiten: [
      mitZeiten(1, 100_000, 10_000, 80_000),
      mitZeiten(2, 200_000, 20_000, 170_000),
      mitZeiten(3, 300_000, 30_000, 250_000),
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "implementierung", "mittel");
    assert.equal(g.dominierend.zeitart, "werkzeug");
    assert.equal(g.dominierend.text, "Werkzeug");
    assert.match(bericht(dir).split("## Verteilung")[1], /\| Werkzeug \|/);
  });
});

test("[aufwand-1339] Prueflaeufe je Paket sind arbeit plus abschluss; ohne prueflaeufe zaehlt eine Einheit nicht als 0", () => {
  const laeufe = [lauf("2026-10-01-100000", {
    einheiten: [
      mitZeiten(1, 60_000, 30_000, 20_000, { prueflaeufe: prueflaeufe(4, 2) }),
      mitZeiten(2, 60_000, 30_000, 20_000, { prueflaeufe: prueflaeufe(8, 2) }),
      mitZeiten(3, 60_000, 30_000, 20_000),
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "implementierung", "mittel");
    assert.equal(g.prueflaeufe.anzahl, 2, "die Einheit ohne prueflaeufe darf nicht mitzaehlen");
    // Werte 6 und 10: Median Rang 1 -> 6, P90 Rang 2 -> 10. Eine mitgezaehlte 0 aenderte
    // hier weder Median noch P90 — deshalb belegt die Anzahl, dass sie fehlt.
    assert.equal(g.prueflaeufe.median, 6);
    assert.equal(g.prueflaeufe.p90, 10);
  });
});

test("[aufwand-1339] eine Gruppe ganz ohne prueflaeufe zeigt nicht gemessen", () => {
  const laeufe = [lauf("2026-10-01-100000", { einheiten: [mitZeiten(1, 60_000, 30_000, 20_000)] })];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "implementierung", "mittel");
    assert.equal(g.prueflaeufe.median, null);
    assert.equal(g.prueflaeufe.text, "nicht gemessen");
  });
});

test("[aufwand-1339] gruppiert je Laufart und darin je Stufe, ohne Stufe am Ende", () => {
  const laeufe = [lauf("2026-10-01-100000", {
    einheiten: [
      mitZeiten(1, 60_000, 30_000, 20_000, { stufeVerwendet: null }),
      mitZeiten(2, 60_000, 30_000, 20_000, { stufeVerwendet: "schwer" }),
      mitZeiten(3, 60_000, 30_000, 20_000, { stufeVerwendet: "leicht" }),
      mitZeiten(4, 60_000, 30_000, 20_000, { art: "kette" }),
      mitZeiten(5, 60_000, 30_000, 20_000, { art: "pruefung", stufeVerwendet: undefined }),
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const e = auswerten(dir);
    assert.deepEqual(e.verteilung.map((v) => v.art), ["implementierung", "kette", "pruefung"]);
    assert.deepEqual(e.verteilung[0].stufen.map((s) => s.stufe), ["leicht", "schwer", null]);
    assert.ok(gruppe(e, "pruefung", null));
    const text = bericht(dir).split("## Verteilung")[1];
    assert.match(text, /### Laufart implementierung/);
    assert.match(text, /### Laufart kette/);
    assert.match(text, /\| ohne Stufe \|/);
    assert.match(text, /Kettenstufe/, "der Hinweis auf die nicht erfasste Kettenstufe fehlt");
  });
});

test("[aufwand-1339] der Anteil der Zeitabbrueche wird gezaehlt wie in der Zielmarke", () => {
  const laeufe = [lauf("2026-10-01-100000", {
    einheiten: [
      mitZeiten(1, 60_000, 30_000, 20_000),
      mitZeiten(2, 60_000, 30_000, 20_000),
      mitZeiten(3, 60_000, 30_000, 20_000),
      mitZeiten(4, 60_000, 30_000, 20_000, { zeitlimitBeendet: true }),
      // Ohne Pruefstand keine Umsetzung, die an einer Marke haengt: zaehlt nicht mit.
      mitZeiten(5, 60_000, 30_000, 20_000, { pruefung: null, zeitlimitBeendet: true }),
    ],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "implementierung", "mittel");
    assert.deepEqual(g.zeitabbrueche, { anteil: 0.25, abbrueche: 1, versuche: 4, laeufe: 1 });
  });
});

test("[aufwand-1339] eine Gruppe ohne Umsetzung zeigt den Zeitabbruch-Anteil als nicht gemessen", () => {
  const laeufe = [lauf("2026-10-01-100000", { einheiten: [mitZeiten(1, 60_000, 30_000, 20_000, { art: "kette", pruefung: null })] })];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir), "kette", "mittel");
    assert.equal(g.zeitabbrueche.anteil, null);
    assert.equal(g.zeitabbrueche.text, "nicht gemessen");
  });
});

test("[aufwand-1339] --laeufe begrenzt auch die Verteilung", () => {
  const laeufe = [
    lauf("2026-10-01-100000", { einheiten: [mitZeiten(1, 900_000, 30_000, 20_000)] }),
    lauf("2026-10-02-100000", { einheiten: [mitZeiten(2, 60_000, 30_000, 20_000)] }),
  ];
  mitProjekt({ laeufe }, (dir) => {
    const g = gruppe(auswerten(dir, "--runs", "1"), "implementierung", "mittel");
    assert.equal(g.dauerMs.anzahl, 1);
    assert.equal(g.dauerMs.median, 60_000);
  });
});

test("[aufwand-1339] die Verteilung steht in aufwand.json unter verteilung, die bisherigen Schluessel bleiben", () => {
  const laeufe = [lauf("2026-10-01-100000", { einheiten: [mitZeiten(1, 60_000, 30_000, 20_000)] })];
  mitProjekt({ laeufe }, (dir) => {
    auswerten(dir);
    const s = stand(dir);
    assert.ok(Array.isArray(s.verteilung));
    for (const schluessel of ["zeit", "pruefungen", "umfang", "kosten", "jeStufe", "zielmarke", "auskuenfte", "befund"]) {
      assert.ok(schluessel in s, `der Schluessel ${schluessel} fehlt`);
    }
  });
});

// --- Median je vollstaendiger Ausfuehrung eines Pruefkommandos (Issue #1689) ------------

function kommando(dauern) {
  const einheiten = dauern.map((d, i) => einheit(i + 1, {
    pruefung: { id: "1", zustand: "geprueft", vollerUmfang: true,
      laufen: [d === null
        ? { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen" }
        : { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: d }] },
  }));
  return mitProjekt({ laeufe: [lauf("2026-10-14-100000", { einheiten })] }, (dir) => ({
    k: auswerten(dir).pruefungen.kommandos.find((x) => x.cmd === "node --test"),
    text: bericht(dir),
  }));
}

test("[aufwand-1689] Median je vollstaendiger Ausfuehrung bei ungerader Zahl: der mittlere Wert", () => {
  const { k } = kommando([500_000, 100_000, 300_000, 200_000, 400_000]);
  assert.equal(k.vollstaendig.medianMs, 300_000);
  assert.equal(k.vollstaendig.anzahl, 5);
});

test("[aufwand-1689] Median je vollstaendiger Ausfuehrung bei gerader Zahl: der untere mittlere, ein gemessener Wert", () => {
  const { k } = kommando([400_000, 100_000, 300_000, 200_000]);
  assert.equal(k.vollstaendig.medianMs, 200_000, "Nearest-Rank wie die uebrige Verteilung, kein Interpolieren");
  assert.equal(k.vollstaendig.anzahl, 4);
});

test("[aufwand-1689] ohne vollstaendige Ausfuehrung steht \"nicht gemessen\" statt Null", () => {
  const { k, text } = kommando([null]);
  assert.equal(k.vollstaendig.medianMs, null);
  assert.equal(k.vollstaendig.anzahl, 0);
  assert.match(text, /\| `node --test` \| 1 \| nicht gemessen \| ohne einen einzigen Lauf \| nicht gemessen \| 0 \| 0 \|/);
});
