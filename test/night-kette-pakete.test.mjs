// Stufe Pakete der Nacht-Kette (Plan #638, A7, E2; Issue #644).
//
// Nach dem Review faehrt die Kette /issues am Plan. Ergebnis sind nur Karten mit
// `Plan: Issue #M`; andere neue Karten stehen als nicht zuordenbar in der Einheit. Kein
// Paket mit dem Halt-Kommentar von /issues heisst angehalten, ohne ihn abgebrochen. Jedes
// Paket geht durch die Formpruefung mit Korrekturrunden.
//
// Seit Issue #1233 laufen diese Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6);
// Ablauf-Pruefungen der Stufe gibt es keine, der glatte Lauf als Prozess steht in
// `ablauf-night-kette-ablauf.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, reviewMarker, paketeAnlegen, paketeHalt,
  paketOhneAbhaengigkeiten, paketReparieren,
} from "./helpers/kette-fixture.mjs";

const RESULT_TEXT = "### Zuordnung ... ### Ohne Paket Alle Kriterien sind abgebildet. ### Zuwachs Nichts Zusaetzliches.";

/** Jede Session liefert den Schlusstext, wie KETTE_RESULT_TEXT im Prozess. */
const mitText = (stufen) => (s) => ({ ...stufen(s), ergebnis: RESULT_TEXT });

/** Body und Kommentare einer Karte als ein Text, wie die Datei des lokalen Trackers. */
const kartenText = (r, id) => [r.karte(id).body, ...r.karte(id).comments.map((c) => c.body)].join("\n\n");

test("[night-20] zwei Pakete mit Herkunftszeile zaehlen, die fremde Karte steht als nicht zuordenbar", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: mitText(jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen })),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.deepEqual(einheit.stufen.pakete.ids, ["3", "4"]);
  assert.deepEqual(einheit.stufen.pakete.nichtZuordenbar, ["5"]);
  assert.equal(einheit.stufen.pakete.korrekturrunden, 0);
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
  for (const id of ["3", "4"]) {
    const p = r.karte(id);
    assert.equal(p.status, "backlog", "Pakete bleiben im Backlog — Ready ist das GO des Menschen");
    assert.match(p.body, /^Plan: Issue #2$/m);
  }
  assert.match(r.ausgabe, /Pakete aus Plan #2: #3, #4\./);
  assert.match(r.ausgabe, /nicht zuordenbar: #5/);
  assert.match(r.ausgabe, /Morgen-Ritual: Plaene und Pakete sichten/);
});

test("[night-20] kein Paket mit Halt-Kommentar von /issues heisst angehalten: Frage und kit:klaeren am Fachplan", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeHalt }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "angehalten");
  assert.match(einheit.grund, /Stopp-Frage beim Schneiden von #2/);
  assert.deepEqual(einheit.stufen.pakete.ids, []);
  assert.ok(r.karte("1").labels.includes("kit:klaeren"));
  const text = kartenText(r, "1");
  assert.match(text, /## Kette angehalten/);
  assert.match(text, /Stufe pakete, Dokument #2/);
  assert.match(text, /Ist der Endpunkt ein Vertrag nach aussen\?/);
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "review", "pakete"], "keine Abdeckung nach dem Halt");
});

test("[night-20] kein Paket und kein Halt-Kommentar heisst abgebrochen", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: reviewMarker }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /kein Paket entstanden/);
  assert.ok(!r.karte("1").labels.includes("kit:klaeren"));
});

test("[night-20] ein Paket ohne Abhaengigkeiten-Abschnitt loest eine Korrekturrunde aus, dann ist die Kette fertig", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: mitText(jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketOhneAbhaengigkeiten, form: paketReparieren })),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.deepEqual(einheit.stufen.pakete.ids, ["3"]);
  assert.equal(einheit.stufen.pakete.korrekturrunden, 1);
  assert.match(r.karte("3").body, /## Abhängigkeiten\n\nKeine\./);
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "review", "pakete", "form", "abdeckung"]);
  assert.match(r.ausgabe, /Formpruefung #3 rot .*Korrekturrunde 1 von 2/);
});
