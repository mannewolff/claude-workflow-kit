// Der Nachtbericht nennt Ziel und Projektgrenze (Plan #1243, E6; Issue #1251).
//
// `- Ziel:` steht unmittelbar nach `- Variante:` und nur mit gesetztem Ziel; `- Pakete`
// bleibt die vorletzte, die Sitzungsumfang-Zeile die letzte Zeile des Blocks (Issue #980).
// Blieb die Kette an der Projektgrenze vor ihrem Ziel stehen, steht unter `### Ausgang`
// zusaetzlich `an der Projektgrenze stehen geblieben, nicht am Ziel <z>` — ohne fuenften
// Ausgang. Reine Funktion am Teil bericht, im selben Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { berichtBauen } from "../kit/night/bericht.mjs";

const WARTET = "wartet: Übergang paketeAbdeckung im Projekt nicht freigegeben — weiter mit kit:night";

function stufenBlock(text) {
  return text.split("### Stufen\n\n")[1].split("\n\n")[0].split("\n");
}

function ausgangBlock(text) {
  return text.split("### Ausgang\n\n")[1].split("\n\n")[0].split("\n");
}

function bericht(felder = {}) {
  const einheit = {
    id: "7", ausgang: "fertig", variante: "A",
    stufen: { plan: { id: "12" }, pakete: { ids: ["13"], korrekturrunden: 0 } },
    ...felder,
  };
  const pakete = [{ id: "13", title: "P13", body: "## Kontext\n\nPlan: Issue #12\nSitzungsumfang: passt — klein.\n\n## Aufgabe\n\nx\n" }];
  return berichtBauen(einheit, { plan: { id: "12", title: "[Plan] X", body: "" }, pakete, stempel: "s" });
}

test("E5: - Ziel: steht unmittelbar nach - Variante:, - Pakete vorletzte, Sitzungsumfang letzte Zeile", () => {
  const zeilen = stufenBlock(bericht({ ziel: "pakete" }));
  const variante = zeilen.indexOf("- Variante: A");
  assert.ok(variante >= 0, zeilen.join("\n"));
  assert.equal(zeilen[variante + 1], "- Ziel: pakete");
  assert.match(zeilen.at(-2), /^- Pakete \(1, /);
  assert.equal(zeilen.at(-1), "- Voraussichtlich über der Sitzungszeitgrenze: keine");
});

test("ohne Ziel keine Zeile - Ziel: und der Block wie heute", () => {
  const ohne = bericht();
  assert.doesNotMatch(ohne, /- Ziel:/);
  assert.doesNotMatch(ohne, /Projektgrenze/);
  const zeilen = stufenBlock(ohne);
  assert.equal(zeilen[zeilen.indexOf("- Variante: A") + 1], "- Plan #12 ([Plan] X): Dauer 0.0 min, Kosten der letzten Session unbekannt, Korrekturrunden 0, Pruefer keiner, Marker fehlt.");
});

test("E6: an der Projektgrenze vor dem Ziel steht die Zeile unter ### Ausgang, der Wartetext bleibt", () => {
  const text = bericht({ ausgang: "unvollstaendig", grund: WARTET, ziel: "umsetzung", projektgrenze: true });
  assert.deepEqual(ausgangBlock(text), [
    `unvollstaendig — ${WARTET}`,
    "an der Projektgrenze stehen geblieben, nicht am Ziel umsetzung",
  ]);
});

test("E6: ohne Ziel bleibt der Ausgang beim Wartetext allein", () => {
  const text = bericht({ ausgang: "unvollstaendig", grund: WARTET, projektgrenze: true });
  assert.deepEqual(ausgangBlock(text), [`unvollstaendig — ${WARTET}`]);
});

test("E6: am Ziel steht keine Grenzzeile", () => {
  const text = bericht({ ziel: "pakete" });
  assert.deepEqual(ausgangBlock(text), ["fertig"]);
});
