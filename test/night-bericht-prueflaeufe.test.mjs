// Die Prueflaeufe und die Zielmarke im Bericht des Nacht-Runners (Issue #926, Plan #917,
// E6/E8; Issue #1073).
//
// `prueflaufZeilen` rechnet je Paket die gemessene Dauer und die Prueflaeufe gegen die
// Zielmarke, und derselbe Block steht unter `### Umsetzung` des Nachtberichts. Geprueft an
// den Funktionen des Teils bericht im selben Prozess; wie der Zaehler am Session-Strom die
// Prueflaeufe misst, steht in test/night-prueflaeufe.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { prueflaufZeilen, berichtBauen, ketteEinheiten } from "../kit/night/bericht.mjs";

// ============================================================
// prueflaufZeilen — die Zahlen im Bericht (Issue #926, Plan #917, E6/E8)
// ============================================================

/** Eine Paket-Einheit des Ergebnisstands, so weit der Bericht sie braucht. */
function paketEinheit(id, minuten, prueflaeufe = { arbeit: { anzahl: 3, volle: 0, volleNoetig: 1, dauerMs: 60_000 }, abschluss: { anzahl: 1, dauerMs: 120_000 } }, pruefungZusatz = {}) {
  return {
    id: String(id),
    dauerMs: minuten * 60_000,
    pruefung: { id: String(id), zustand: "geprueft", laufen: [], ausgelassen: [], ...pruefungZusatz },
    prueflaeufe,
  };
}

const DREI_PAKETE = [paketEinheit(101, 8), paketEinheit(102, 12), paketEinheit(103, 43)];

test("[night-926] gemischte Dauern ergeben die Summenzeile gegen die Zielmarke", () => {
  const zeilen = prueflaufZeilen(DREI_PAKETE, 10);
  assert.ok(zeilen.some((z) => z === "- 1 von 3 Paketen unter 10 Minuten."), `Summenzeile fehlt: ${zeilen.join(" | ")}`);
});

test("[night-926] je Paket eine Zeile mit Dauer, Prueflaeufen, volle und volleNoetig", () => {
  const zeilen = prueflaufZeilen([paketEinheit(101, 8)], 10);
  const zeile = zeilen.find((z) => z.includes("#101"));
  assert.ok(zeile, `keine Zeile fuer das Paket: ${zeilen.join(" | ")}`);
  assert.match(zeile, /Dauer 8\.0 min/);
  assert.match(zeile, /Prueflaeufe 3/);
  assert.match(zeile, /volle 0/);
  assert.match(zeile, /Gruppenlaeufe 1/);
  assert.match(zeile, /Abschlussversuche 1/);
});

test("[night-926] eine Einheit ohne pruefung zaehlt nicht mit — sie hat keine Runde durchlaufen", () => {
  const ohneSession = { id: "104", dauerMs: 60_000, ausgang: "uebersprungen" };
  const zeilen = prueflaufZeilen([...DREI_PAKETE, ohneSession], 10);
  assert.ok(zeilen.some((z) => z === "- 1 von 3 Paketen unter 10 Minuten."), zeilen.join(" | "));
  assert.ok(!zeilen.some((z) => z.includes("#104")), "die Einheit ohne Session gehoert nicht in die Liste");
});

test("[night-926] eine Einheit mit pruefung: null (ohne Session gescheitert) zaehlt nicht mit", () => {
  const zeilen = prueflaufZeilen([paketEinheit(101, 8), { id: "105", dauerMs: 1000, pruefung: null }], 10);
  assert.ok(zeilen.some((z) => z === "- 1 von 1 Paketen unter 10 Minuten."), zeilen.join(" | "));
});

test("[night-926] ohne Zielmarke wird mit 10 Minuten gerechnet", () => {
  assert.ok(prueflaufZeilen(DREI_PAKETE).some((z) => z === "- 1 von 3 Paketen unter 10 Minuten."),
    "fehlt night.zielUmsetzungMin, gilt die Vorgabe des Schemas");
  assert.ok(prueflaufZeilen(DREI_PAKETE, 45).some((z) => z === "- 3 von 3 Paketen unter 45 Minuten."),
    "eine gesetzte Marke gilt");
});

test("[night-926] genau auf der Marke gilt als erreicht", () => {
  assert.ok(prueflaufZeilen([paketEinheit(101, 10)], 10).some((z) => z === "- 1 von 1 Paketen unter 10 Minuten."));
});

test("[night-926] prueflaeufe null sagt 'nicht gemessen' und nennt keine Null", () => {
  const zeile = prueflaufZeilen([paketEinheit(101, 8, null)], 10).find((z) => z.includes("#101"));
  assert.match(zeile, /nicht gemessen/);
  assert.ok(!/Prueflaeufe 0/.test(zeile), `eine Null behauptete eine Messung: ${zeile}`);
  assert.ok(!/Abschlussversuche 0/.test(zeile), `dasselbe fuer die Abschlussversuche: ${zeile}`);
  assert.match(zeile, /Dauer 8\.0 min/, "die Dauer ist gemessen und bleibt stehen");
});

test("[night-1073] die Paketzeile nennt letzten Abschluss und Abschluss-Wartezeit zusammen", () => {
  const e = paketEinheit(101, 8, undefined, { wartezeitMs: 95_400 });
  const zeile = prueflaufZeilen([e], 10).find((z) => z.includes("#101"));
  assert.match(zeile, /Abschlussversuche 1, letzter Abschluss 95\.4 s, Abschluss-Wartezeit zusammen 2\.0 min$/);
});

test("[night-1073] ohne wartezeitMs steht nur die Summe der Abschluesse", () => {
  const zeile = prueflaufZeilen([paketEinheit(101, 8)], 10).find((z) => z.includes("#101"));
  assert.match(zeile, /Abschlussversuche 1, Abschluss-Wartezeit zusammen 2\.0 min$/);
  assert.ok(!/letzter Abschluss/.test(zeile), zeile);
});

test("[night-1073] ohne gemessene Abschluesse steht nur der letzte Abschluss", () => {
  const e = paketEinheit(101, 8, { arbeit: { anzahl: 3, volle: 0, volleNoetig: 1, dauerMs: 60_000 } }, { wartezeitMs: 95_400 });
  const zeile = prueflaufZeilen([e], 10).find((z) => z.includes("#101"));
  assert.match(zeile, /Gruppenlaeufe 1\), letzter Abschluss 95\.4 s$/);
  assert.ok(!/Abschluss-Wartezeit/.test(zeile), zeile);
});

test("[night-1073] ohne beide Zahlen bleibt die Zeile wie bisher", () => {
  const e = paketEinheit(101, 8, { arbeit: { anzahl: 3, volle: 0, volleNoetig: 1, dauerMs: 60_000 } });
  const zeile = prueflaufZeilen([e], 10).find((z) => z.includes("#101"));
  assert.match(zeile, /Gruppenlaeufe 1\)$/);
  assert.ok(!/letzter Abschluss|Abschluss-Wartezeit/.test(zeile), zeile);
});

test("[night-926] jede Datei ohne Zuordnung steht mit Namen im Bericht", () => {
  const einheit = paketEinheit(101, 8, undefined, { ohneZuordnung: ["kit/neu.mjs", "docs/neu.md"] });
  const zeilen = prueflaufZeilen([einheit], 10);
  const text = zeilen.join("\n");
  assert.match(text, /kit\/neu\.mjs/);
  assert.match(text, /docs\/neu\.md/);
  assert.ok(zeilen.some((z) => z === "- 1 von 1 Paketen unter 10 Minuten."),
    "die Luecke in der Zuordnung faerbt nichts rot — der Abschluss bleibt unberuehrt");
});

test("[night-926] ohne gemessenes Paket sagt der Block das und rechnet nichts", () => {
  const zeilen = prueflaufZeilen([], 10);
  assert.ok(!zeilen.some((z) => /von 0 Paketen/.test(z)), `keine Rechnung ohne Paket: ${zeilen.join(" | ")}`);
  assert.match(zeilen.join("\n"), /keine Umsetzung gemessen/);
});

test("[night-926] der Umsetzungs-Abschnitt des Nachtberichts nennt dieselben Zeilen", () => {
  const einheit = {
    id: "900", ausgang: "fertig", variante: "B",
    stufen: { plan: { id: "917" }, pakete: { ids: ["101"] }, umsetzung: { umgesetzt: [{ id: "101" }], angehalten: [], zurueckgestellt: [], nichtBegonnen: [] } },
  };
  const text = berichtBauen(einheit, { einheiten: DREI_PAKETE, zielUmsetzungMin: 10, stempel: "s", start: 0, jetzt: 0 });
  const umsetzung = text.split("### Umsetzung")[1].split("###")[0];
  assert.match(umsetzung, /- 1 von 3 Paketen unter 10 Minuten\./, `Summenzeile fehlt unter ### Umsetzung: ${umsetzung}`);
  assert.match(umsetzung, /#101:.*Dauer 8\.0 min/);
  assert.match(umsetzung, /#103:.*Dauer 43\.0 min/);
});

test("[night-926] ohne uebergebene Einheiten bleibt der Umsetzungs-Abschnitt bei seiner Auskunft", () => {
  const einheit = { id: "900", ausgang: "fertig", variante: "B", stufen: { umsetzung: { umgesetzt: [], angehalten: [], zurueckgestellt: [], nichtBegonnen: [] } } };
  const text = berichtBauen(einheit, { stempel: "s", start: 0, jetzt: 0 });
  const umsetzung = text.split("### Umsetzung")[1].split("###")[0];
  assert.match(umsetzung, /keine Umsetzung gemessen/);
});


// --- Der Bericht einer Kette nennt nur ihre eigenen Pakete (Code-Review zu #926) ---
//
// `LAUF.einheiten` fuehrt JEDE Einheit des Nachtlaufs. Ab der zweiten Kette eines Laufs
// stuenden ohne Eingrenzung fremde Pakete im Kommentar dieser Karte, und die Zeile
// "N von M" zaehlte sie mit — der Bericht einer Karte behauptete Arbeit, die zu einer
// anderen gehoert.

test("[night-926] ketteEinheiten liefert nur die Pakete dieser Kette", () => {
  const alle = [paketEinheit(101, 8), paketEinheit(201, 12), paketEinheit(202, 43)];
  const kette = { stufen: { pakete: { ids: ["201", "202"] } } };

  const eigene = ketteEinheiten(kette, alle);

  assert.deepEqual(eigene.map((e) => e.id), ["201", "202"]);
});

test("[night-926] ketteEinheiten vergleicht Nummern unabhaengig vom Typ", () => {
  const alle = [paketEinheit(201, 12)];
  const kette = { stufen: { pakete: { ids: [201] } } };

  assert.deepEqual(ketteEinheiten(kette, alle).map((e) => e.id), ["201"]);
});

test("[night-926] eine Kette ohne Pakete liefert keine Einheiten", () => {
  const alle = [paketEinheit(101, 8)];

  assert.deepEqual(ketteEinheiten({ stufen: {} }, alle), []);
  assert.deepEqual(ketteEinheiten(null, alle), []);
});

test("[night-926] die Summenzeile zaehlt nur die Pakete dieser Kette", () => {
  const alle = [paketEinheit(101, 43), paketEinheit(201, 8)];
  const kette = { stufen: { pakete: { ids: ["201"] } } };

  const zeilen = prueflaufZeilen(ketteEinheiten(kette, alle), 10);

  assert.ok(zeilen.some((z) => z.includes("1 von 1 Paketen unter 10 Minuten")), zeilen.join("\n"));
  assert.ok(!zeilen.some((z) => z.includes("#101")), `fremdes Paket im Bericht: ${zeilen.join("\n")}`);
});
