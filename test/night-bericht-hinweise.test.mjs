// Die Hinweis-Zeilen im Bericht des Nacht-Runners (Issue #1156, Plan #1150, E11/E12).
//
// Je Hinweis der Pruef-Zusammenfassung eine Zeile im Pruefblock und unter `### Umsetzung`
// des Nachtberichts — gemeldet, nicht gewertet. Geprueft an den Funktionen des Teils
// bericht im selben Prozess; wie der Runner die Hinweise aus der Zusammenfassung in den
// Pruefstand uebernimmt, steht in test/night-hinweise.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { berichtBauen, prueflaufZeilen } from "../kit/night/bericht.mjs";

const HINWEISE = [
  { cmd: "npx hinweis-pruefung", zeilen: ["test/a.test.mjs:12 — Plattform-Skip ohne Vermerk", "kit/b.mjs:3 — Pfad in Mac-Schreibweise"] },
];

test("[night-1156] der Nachtbericht nennt je Hinweis eine Zeile unter ### Umsetzung", () => {
  const pakete = [{ id: "10", title: "P1" }];
  const kette = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [{ id: "10", stufe: "leicht" }], angehalten: [], nichtBegonnen: [] } },
  };
  const einheiten = [{ id: "10", dauerMs: 60000, pruefung: { zustand: "geprueft", hinweise: HINWEISE } }];
  const text = berichtBauen(kette, { pakete, einheiten, stempel: "s" });
  const umsetzung = text.slice(text.indexOf("### Umsetzung"), text.indexOf("### Entscheidungen der Nacht"));
  assert.match(umsetzung, /- Issue #10: hinweis: test\/a\.test\.mjs:12 — Plattform-Skip ohne Vermerk\n/);
  assert.match(umsetzung, /- Issue #10: hinweis: kit\/b\.mjs:3 — Pfad in Mac-Schreibweise\n/);
});

test("[night-1156] ohne hinweise traegt der Pruefblock keine Hinweis-Zeile", () => {
  for (const pruefung of [{ zustand: "geprueft" }, { zustand: "geprueft", hinweise: null }, { zustand: "geprueft", hinweise: [] }]) {
    const zeilen = prueflaufZeilen([{ id: "10", dauerMs: 60000, pruefung }]);
    assert.ok(!zeilen.some((z) => z.includes("hinweis:")), JSON.stringify(zeilen));
  }
});
