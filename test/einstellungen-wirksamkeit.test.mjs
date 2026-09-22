// Der optionale Block `wirksamkeit` in der Konfigurationspruefung (Issue #789,
// Plan #782, fachliche Quelle #767).
//
// Fenster, Quote und Mindestmengen der Wirksamkeits-Auswertung stehen in einem
// eigenen Block und nicht in `aufwand`: Ein Block, der zwei Auswertungen mit zwei
// Fenstern traegt, waere nicht mehr zuzuordnen.
//
// Geprueft wird dasselbe wie beim Nachbarblock `aufwand` (einstellungen-14): die
// Wertebereiche je Feld mit Pfad, die Gueltigkeit einer Konfiguration ohne den
// Block, der eigene Teil im Thema Nachtbetrieb statt der Anzeige in
// Dateischreibweise und die Teamweit-Formel — `wirksamkeit` steht nicht in der
// Allowlist der persoenlichen Datei.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aenderungAnwenden, pruefe, pruefeSchema, teilFuer, THEMEN, vorgabeAus,
} from "../kit/einstellungen.mjs";

const fehler = (befunde) => befunde.filter((b) => b.art === "fehler");

/** Eine Config, die ohne den geprueften Block fehlerfrei durchlaeuft. */
const BASIS = { codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5" };

/** Die vier ganzen Zahlen ueber null, je mit ihrer Vorgabe aus dem Schema. */
const GANZE_FELDER = [
  ["fensterTage", 30],
  ["nieBeanstandetAbAusfuehrungen", 10],
  ["quoteAbPaketen", 10],
  ["kandidatenMax", 200],
];

const befundeAm = (feld, wert) =>
  fehler(pruefeSchema({ wirksamkeit: { [feld]: wert } })).filter((b) => b.pfad === `wirksamkeit.${feld}`);

test("[einstellungen-17] der Block wirksamkeit traegt genau die fuenf Felder mit ihren Vorgaben", () => {
  for (const [feld, vorgabe] of GANZE_FELDER) {
    assert.equal(vorgabeAus(`wirksamkeit.${feld}`), vorgabe, feld);
  }
  assert.equal(vorgabeAus("wirksamkeit.quoteSchwelle"), 0.2);
});

for (const [feld] of GANZE_FELDER) {
  test(`[einstellungen-17] wirksamkeit.${feld} ausserhalb ganzer Zahlen ueber null wird mit Pfad abgewiesen`, () => {
    for (const schlecht of [0, -1, 1.5, "10"]) {
      assert.ok(befundeAm(feld, schlecht).length > 0, `${feld}=${JSON.stringify(schlecht)} nicht abgewiesen`);
    }
    for (const gut of [1, 30]) {
      assert.deepEqual(befundeAm(feld, gut), [], `${feld}=${gut}`);
    }
  });
}

test("[einstellungen-17] wirksamkeit.quoteSchwelle ausserhalb von 0 bis 1 wird mit Pfad abgewiesen", () => {
  for (const schlecht of [-0.1, 1.1, 2, "0.2"]) {
    assert.ok(befundeAm("quoteSchwelle", schlecht).length > 0, `quoteSchwelle=${JSON.stringify(schlecht)} nicht abgewiesen`);
  }
  for (const gut of [0, 0.2, 1]) {
    assert.deepEqual(befundeAm("quoteSchwelle", gut), [], `quoteSchwelle=${gut}`);
  }
});

test("[einstellungen-17] eine Config ohne den Block wirksamkeit ist gueltig", () => {
  assert.deepEqual(fehler(pruefe(BASIS, null)), []);
});

test("[einstellungen-17] ein wirksamkeit-Block mit fensterTage: 14 laesst die uebrigen Vorgaben unberuehrt", () => {
  assert.deepEqual(fehler(pruefe({ ...BASIS, wirksamkeit: { fensterTage: 14 } }, null)), []);
});

test("[einstellungen-17] ein unbekanntes Feld in wirksamkeit ist eine Warnung mit Pfad, kein Fehler", () => {
  const befunde = pruefeSchema({ wirksamkeit: { erfunden: 1 } });
  assert.ok(befunde.some((b) => b.art === "unbekannt" && b.pfad === "wirksamkeit.erfunden"));
  assert.deepEqual(fehler(befunde).filter((b) => b.pfad === "wirksamkeit.erfunden"), []);
});

test("[einstellungen-17] wirksamkeit ist ein eigener Teil im Thema Nachtbetrieb, nicht in Dateischreibweise", () => {
  assert.equal(THEMEN.wirksamkeit, "Nachtbetrieb");
  const teil = teilFuer("wirksamkeit");
  assert.notEqual(teil.redaktor, "text", "wirksamkeit zeigt noch die Dateischreibweise");
  assert.equal(teil.thema, "Nachtbetrieb");
  assert.ok(teil.titel, "der Teil hat keinen Titel");
  assert.notEqual(teil.kennung, teilFuer("aufwand").kennung, "wirksamkeit teilt sich den Teil mit aufwand");
});

test("[einstellungen-17] wirksamkeit steht nicht in der Allowlist fuer persoenliche Abweichungen", () => {
  const r = aenderungAnwenden({ reviewModel: "claude-opus-5" }, {}, {
    ebene: "persoenlich",
    aenderungen: [{ pfad: "wirksamkeit", wert: { fensterTage: 14 } }],
  });
  assert.equal(r.ok, false);
  assert.match(r.grund, /wirksamkeit/);
});
