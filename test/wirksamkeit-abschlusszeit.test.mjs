// Die mittlere Pruefzeit je Karte und ihr Vergleichswert (Issue #951, Plan #944, E8).
//
// Die Einheit ist die KARTE, nicht der Lauf: Der Fachplan begruendet die Zahl mit
// "zwischen zwei und sechzehn Mal je Karte" — die Wiederholung gehoert in den Zaehler.
// Gemessen wird allein, was ein Abschlusslauf gekostet hat (`anlass` = `abschluss`);
// der Vergleichswert legt die mittlere Dauer jeder beim Abschluss ausgelassenen
// Pruefung aus demselben Fenster obendrauf — ein einmal vor der Umstellung gemessener
// Wert waere nach der ersten Aenderung an einem Pruefkommando falsch.
//
// "Nicht gemessen" ist nie 0: Ohne eine einzige Abschlusszeile mit Kartennummer steht
// `null`, und ebenso bleibt der Vergleichswert `null`, solange eine ausgelassene
// Pruefung im Fenster nie lief — dieselbe Regel wie im uebrigen Werkzeug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, zeile, auswerten, bericht } from "./helpers/wirksamkeit-fixture.mjs";

// surefire traegt den Abschluss, failsafe ist die beim Abschluss ausgelassene Pruefung.
const CONFIG = {
  buildChecks: [
    "mvn surefire",
    { cmd: "mvn failsafe", nichtBeimAbschluss: "zusammenspiel" },
  ],
};

/** Eine Abschlusszeile: Anlass `abschluss`, mit Laufkennung und Kartennummer. */
function abschluss({ karte, lauf, cmd = "mvn surefire", dauerMs, tage = 2 }) {
  return zeile({ tage, cmd, dauerMs, anlass: "abschluss", lauf, karte });
}

/** Eine Zeile eines Veroeffentlichungslaufs — der Grund des Vergleichswerts. */
function veroeffentlichung({ cmd = "mvn failsafe", dauerMs, anlass = "push", tage = 2 }) {
  return zeile({ tage, cmd, dauerMs, anlass, lauf: `lauf-${anlass}-${dauerMs}`, karte: "" });
}

test("[wirksamkeit-951] die Kennzahl rechnet je Karte ueber mehrere Abschlusslaeufe und nennt beide Werte", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      // Karte 100 wurde zweimal abgeschlossen, Karte 200 einmal: 60 s auf zwei Karten.
      abschluss({ karte: "100", lauf: "A", dauerMs: 10_000 }),
      abschluss({ karte: "100", lauf: "B", dauerMs: 20_000 }),
      abschluss({ karte: "200", lauf: "C", dauerMs: 30_000 }),
      // failsafe lief im Fenster zweimal beim Veroeffentlichen: Mittel 50 s.
      veroeffentlichung({ dauerMs: 40_000 }),
      veroeffentlichung({ dauerMs: 60_000, anlass: "merge" }),
    ],
  }, (dir) => {
    const a = auswerten(dir).abschlusszeit;

    assert.equal(a.karten, 2, "zwei Kartennummern tragen die Zahl");
    assert.equal(a.laeufe, 3, "drei Abschlusslaeufe, zwei davon an derselben Karte");
    assert.equal(a.gemessenMs, 60_000);
    assert.equal(a.mittelMs, 30_000, "60 s auf zwei Karten");
    assert.equal(a.vergleichMs, 80_000, "30 s gemessen plus 50 s mittlere failsafe-Dauer");
    assert.deepEqual(
      a.ausgelassen,
      [{ cmd: "mvn failsafe", grund: "zusammenspiel", ausfuehrungen: 2, mittelMs: 50_000 }],
    );

    const text = bericht(dir);
    assert.match(text, /## Mittlere Pruefzeit je Karte/);
    assert.match(text, /30 s/, "der gemessene Wert fehlt im Bericht");
    assert.match(text, /1 min 20 s/, "der Vergleichswert fehlt im Bericht");
    assert.match(text, /2 Karten/, "die Zahl der tragenden Karten fehlt");
    assert.match(text, /3 Abschlusslaeufe/, "die Zahl der Abschlusslaeufe fehlt");
    assert.match(
      text,
      /waehrend der Arbeit.*Veroeffentlichen.*nicht mit|nicht mit.*waehrend der Arbeit/s,
      "die Messgrenze des Abschnitts fehlt (AK 6)",
    );
  });
});

test("[wirksamkeit-951] alte Zeilen ohne die drei Spalten zaehlen nicht mit", () => {
  mitProjekt({
    config: CONFIG,
    // Genau die Vierspalten-Form aus der Zeit vor Issue #948.
    zeilen: [
      zeile({ tage: 2, cmd: "mvn surefire", dauerMs: 10_000 }),
      zeile({ tage: 1, cmd: "mvn surefire", dauerMs: 20_000 }),
    ],
  }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.protokoll.fehlerhafteZeilen, 0, "eine alte Zeile ist keine fehlerhafte Zeile");
    assert.equal(e.abschlusszeit.karten, 0);
    assert.equal(e.abschlusszeit.laeufe, 0);
    assert.equal(e.abschlusszeit.mittelMs, null, "ohne Grundlage 'nicht gemessen', nie 0");
    assert.equal(e.abschlusszeit.vergleichMs, null);
    assert.match(bericht(dir), /nicht gemessen/);
  });
});

test("[wirksamkeit-951] eine Abschlusszeile ohne Kartennummer zaehlt nicht mit", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      abschluss({ karte: "", lauf: "ohne", dauerMs: 99_000 }),
      abschluss({ karte: "300", lauf: "mit", dauerMs: 12_000 }),
      // Ein Paketlauf waehrend der Arbeit ist kein Abschluss und zaehlt auch nicht.
      zeile({ tage: 2, cmd: "mvn surefire", dauerMs: 77_000, anlass: "paket", lauf: "arbeit", karte: "300" }),
    ],
  }, (dir) => {
    const a = auswerten(dir).abschlusszeit;

    assert.equal(a.karten, 1);
    assert.equal(a.laeufe, 1);
    assert.equal(a.gemessenMs, 12_000, "weder die kartenlose Zeile noch der Paketlauf gehen ein");
    assert.equal(a.mittelMs, 12_000);
  });
});

test("[wirksamkeit-951] ohne jede Abschlusszeile steht 'nicht gemessen' und kein Mittel je Lauf", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [veroeffentlichung({ dauerMs: 40_000 })],
  }, (dir) => {
    const a = auswerten(dir).abschlusszeit;

    assert.equal(a.karten, 0);
    assert.equal(a.mittelMs, null);
    assert.equal(a.vergleichMs, null, "ohne gemessene Zeit gibt es auch keinen Vergleichswert");
    assert.equal(a.ausgelassen[0].mittelMs, 40_000, "die ausgelassene Pruefung ist dennoch gemessen");
  });
});

test("[wirksamkeit-951] eine ausgelassene Pruefung ohne Veroeffentlichungslauf im Fenster laesst den Vergleichswert null", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [abschluss({ karte: "400", lauf: "A", dauerMs: 25_000 })],
  }, (dir) => {
    const a = auswerten(dir).abschlusszeit;

    assert.equal(a.mittelMs, 25_000, "die gemessene Zeit steht");
    assert.equal(a.ausgelassen[0].ausfuehrungen, 0);
    assert.equal(a.ausgelassen[0].mittelMs, null, "nie gelaufen heisst 'nicht gemessen', nicht 0");
    assert.equal(a.vergleichMs, null, "ein Vergleichswert ohne die fehlende Dauer waere zu klein");
    assert.match(bericht(dir), /mvn failsafe/, "der Bericht nennt die Pruefung, deren Dauer fehlt");
  });
});

test("[wirksamkeit-951] ohne ausgelassene Pruefung ist der Vergleichswert die gemessene Zeit", () => {
  mitProjekt({
    config: { buildChecks: ["mvn surefire"] },
    zeilen: [
      abschluss({ karte: "500", lauf: "A", dauerMs: 10_000 }),
      abschluss({ karte: "600", lauf: "B", dauerMs: 30_000 }),
    ],
  }, (dir) => {
    const a = auswerten(dir).abschlusszeit;

    assert.deepEqual(a.ausgelassen, []);
    assert.equal(a.mittelMs, 20_000);
    assert.equal(a.vergleichMs, 20_000, "ohne Auslassung ist nichts aufzuschlagen");
  });
});

test("[wirksamkeit-951] eine Zeile ausserhalb des Fensters zaehlt in keinem der beiden Werte", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      abschluss({ karte: "700", lauf: "alt", dauerMs: 90_000, tage: 40 }),
      abschluss({ karte: "800", lauf: "neu", dauerMs: 10_000, tage: 1 }),
      veroeffentlichung({ dauerMs: 90_000, tage: 40 }),
      veroeffentlichung({ dauerMs: 20_000, tage: 1 }),
    ],
  }, (dir) => {
    const a = auswerten(dir, "--fenster", "7").abschlusszeit;

    assert.equal(a.karten, 1, "die 40 Tage alte Karte liegt ausserhalb");
    assert.equal(a.mittelMs, 10_000);
    assert.equal(a.ausgelassen[0].ausfuehrungen, 1, "nur der Veroeffentlichungslauf im Fenster zaehlt");
    assert.equal(a.vergleichMs, 30_000);
  });
});
