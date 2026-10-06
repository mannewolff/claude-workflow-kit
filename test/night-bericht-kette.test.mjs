// Der Nachtbericht am Fachplan als reine Funktion (Plan #638, A10; Issue #645, #980).
//
// `berichtBauen` nummeriert die Entscheidungen der Nacht, nennt Ueberholtes, den
// Sitzungsumfang der Pakete und den Kit-Stand des Laufs. Geprueft am Teil bericht im
// selben Prozess; den Bericht am Fachplan nach einem echten Kettenlauf prueft
// test/ablauf-night-bericht-kette.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { berichtBauen, einarbeitungVon, kommentareVon, BERICHT_SCHLUSS } from "../kit/night/bericht.mjs";
import { kitStandZeile } from "../kit/night/kitstand.mjs";

test("[night-21] berichtBauen nummeriert Entscheidungen aus Plan und Paketen, nennt Ueberholt und liest Kommentare als Array", () => {
  const plan = {
    id: "12", title: "[Plan] X",
    body: "Plan-Modell: a\nPlan-Review: b (2026-09-14)\n\n## Ziel\n\nx\n\n## Architektonische Entscheidungen\n\n- A1 — erstens.\n  - Unterpunkt zaehlt nicht.\n- E1: zweitens.\n\n```\n- im Codeblock zaehlt nicht\n```\n\n## Offene Fragen\n\n- Keine.\n",
    comments: [
      { body: "## Plan-Review, Runde 1\n\nFund: abgelehnt waere hier falsch gelesen." },
      { body: "## Einarbeitung, Runde 1\n\n- F1: übernommen.\n- F2: abgelehnt — Grund." },
    ],
  };
  const pakete = [
    { id: "13", title: "P1", body: "## Kontext\n\nPlan: Issue #12\nEntscheidung: Q? Gewählt: a. Verworfen: b. Grund: c. Rückbau: trivial.\n\n## Aufgabe\n\nx\n" },
    { id: "14", title: "P2", body: "## Kontext\n\nPlan: Issue #12\n\n## Aufgabe\n\nEntscheidung: nicht im Kontext, zaehlt nicht.\n" },
  ];
  const einheit = {
    id: "7", ausgang: "fertig",
    stufen: { plan: { id: "12", dauerMs: 90000, kennzahlen: { kostenUsd: 2.5 }, korrekturrunden: 1 }, review: { marker: true }, pakete: { ids: ["13", "14"], nichtZuordenbar: [], korrekturrunden: 0 }, abdeckung: { text: null, grund: "Zeitbudget abdeckung" } },
    ueberholt: ["9"], abdeckungSchrieb: true, kostenUsd: 3.25, kostenUnbekannt: 1,
  };
  assert.deepEqual(kommentareVon(plan).length, 2);
  assert.match(einarbeitungVon(plan), /^## Einarbeitung, Runde 1/);
  const start = new Date("2026-09-14T22:00:00.000Z");
  const text = berichtBauen(einheit, {
    plan, pakete, einarbeitung: einarbeitungVon(plan), abdeckung: einheit.stufen.abdeckung,
    budget: { kostenUsd: 50 }, start, stempel: "2026-09-14-220000", jetzt: start.getTime() + 30 * 60000,
  });
  assert.ok(text.startsWith("## Nachtbericht, Kette 2026-09-14-220000\n"));
  assert.match(text, /- Plan #12 \(\[Plan\] X\): Dauer 1\.5 min, Kosten der letzten Session 2\.50 \$, Korrekturrunden 1, Pruefer b \(2026-09-14\), Marker gesetzt\./);
  assert.ok(text.includes("1. A1 — erstens. (Plan #12)\n2. E1: zweitens. (Plan #12)\n3. Entscheidung: Q? Gewählt: a. Verworfen: b. Grund: c. Rückbau: trivial. (Paket #13)\n"));
  assert.ok(!text.includes("Unterpunkt"), "nur die erste Ebene");
  assert.ok(!text.includes("im Codeblock"), "nichts aus Codebloecken");
  assert.match(text, /### Abgelehnte Befunde\n\n- F2: abgelehnt — Grund\.\n/);
  assert.ok(!text.includes("falsch gelesen"), "nur der Einarbeitungs-Kommentar zaehlt");
  assert.match(text, /### Abdeckung gegen den Fachplan\n\nKeine Abdeckung: Zeitbudget abdeckung\.\n\nHinweis: die Abdeckungs-Session hat am Board geschrieben/);
  assert.match(text, /- Dauer der Kette: 30\.0 min ab 2026-09-14T22:00:00\.000Z\n- Entscheidungen: 3\n- Stopp-Fragen: 0\n- Kosten: 3\.25 \$ von 50 \$\n- kostenUnbekannt: 1/);
  assert.match(text, /### Ueberholt\n\n- Plan #9\n/);
  assert.ok(text.trimEnd().endsWith(BERICHT_SCHLUSS));
  // Ohne Einarbeitung, ohne abgelehnte Zeile: zwei verschiedene Aussagen.
  assert.match(berichtBauen({ ausgang: "fertig" }, { stempel: "s" }), /- keine Einarbeitung gefunden/);
  assert.match(berichtBauen({ ausgang: "fertig" }, { stempel: "s", einarbeitung: "## Einarbeitung, Runde 1\n\n- alles übernommen." }), /- keine abgelehnten Befunde/);
});

// Die Pakete ueber der Sitzungszeitgrenze im Bericht (Issue #980, Plan #974, fachlich #963).
//
// Die Einschaetzung aus Issue #979 steht im `## Kontext` jedes Pakets. Wer morgens den
// Kettenbericht liest, muesste sonst jede Karte oeffnen, um die Pakete zu finden, die
// voraussichtlich ueber der Sitzungszeitgrenze liegen.

function stufenBlock(text) {
  return text.split("### Stufen\n\n")[1].split("\n\n")[0].split("\n");
}

function berichtMitPaketen(pakete) {
  const ids = pakete.map((k) => k.id);
  const einheit = { id: "7", ausgang: "fertig", stufen: { plan: { id: "12" }, pakete: { ids, korrekturrunden: 0 } } };
  return berichtBauen(einheit, { plan: { id: "12", title: "[Plan] X", body: "" }, pakete, stempel: "s" });
}

function paket(id, kontextZeile) {
  return { id, title: `P${id}`, body: `## Kontext\n\nPlan: Issue #12\n${kontextZeile}\n\n## Aufgabe\n\nx\n` };
}

test("[night-980] die Zeile nennt die Pakete mit `reisst` und laesst die mit `passt` aus", () => {
  const text = berichtMitPaketen([
    paket("13", "Sitzungsumfang: reisst — vier Dateien und ein Migrationsschritt."),
    paket("14", "Sitzungsumfang: passt — eine Berichtszeile."),
  ]);
  const zeilen = stufenBlock(text);
  assert.equal(zeilen.at(-1), "- Voraussichtlich über der Sitzungszeitgrenze: #13");
  assert.match(zeilen.at(-2), /^- Pakete \(2, /, "die neue Zeile steht nach `- Pakete: …`");
});

test("[night-980] ein Paket ohne die Zeile erscheint als nicht eingeschaetzt", () => {
  const text = berichtMitPaketen([
    paket("13", "Aufgabenstufe: leicht"),
    paket("14", "Sitzungsumfang: reisst — gross."),
    paket("15", "Sitzungsumfang: passt — klein."),
  ]);
  assert.equal(stufenBlock(text).at(-1), "- Voraussichtlich über der Sitzungszeitgrenze: #13 nicht eingeschätzt, #14");
});

test("[night-980] ohne einen einzigen Fall steht `keine` — auch ganz ohne Pakete", () => {
  assert.equal(stufenBlock(berichtMitPaketen([paket("13", "Sitzungsumfang: passt — klein.")])).at(-1),
    "- Voraussichtlich über der Sitzungszeitgrenze: keine");
  assert.equal(stufenBlock(berichtBauen({ ausgang: "fertig" }, { stempel: "s" })).at(-1),
    "- Voraussichtlich über der Sitzungszeitgrenze: keine");
});

test("[night-980] die Zeile steht als letzte des Stufen-Blocks, auch hinter `Nicht zuordenbar`", () => {
  const pakete = [paket("13", "Sitzungsumfang: reisst — gross.")];
  const einheit = {
    id: "7", ausgang: "fertig",
    stufen: { plan: { id: "12" }, pakete: { ids: ["13"], nichtZuordenbar: ["99"], korrekturrunden: 0 } },
  };
  const zeilen = stufenBlock(berichtBauen(einheit, { plan: { id: "12", title: "[Plan] X", body: "" }, pakete, stempel: "s" }));
  assert.equal(zeilen.at(-1), "- Voraussichtlich über der Sitzungszeitgrenze: #13");
  assert.match(zeilen.at(-2), /^- Nicht zuordenbar /);
});

// Issue #1103: Der Nachtbericht nennt den Kit-Stand, mit dem die Kette lief. Er steht im
// Text selbst, also traegt auch ein wartender Bericht, den ein spaeterer Lauf nachtraegt,
// die Zeile des Laufs, der ihn schrieb — nicht die des nachtragenden.
test("[kitstand-zeile] der Nachtbericht traegt die Kit-Stand-Zeile des Laufs, ohne Stand keine", () => {
  const kitStand = { commit: "0123456789abcdef0123456789abcdef01234567", ref: "origin/main", commitZeit: "2026-10-01T22:15:00+02:00" };
  const mit = berichtBauen({ ausgang: "fertig" }, { stempel: "s", kitStand });
  assert.ok(mit.includes(`\n${kitStandZeile(kitStand)}\n`), "die Zeile fehlt im Bericht");
  assert.equal(kitStandZeile(kitStand), "Kit-Stand: 0123456789ab (origin/main vom 2026-10-01 22:15)");
  assert.equal(mit.match(/^Kit-Stand: /gm).length, 1, "genau eine Zeile");
  assert.ok(mit.indexOf("Kit-Stand: ") < mit.indexOf(BERICHT_SCHLUSS), "die Zeile steht vor dem Schluss");

  const ohne = berichtBauen({ ausgang: "fertig" }, { stempel: "s", kitStand: null });
  assert.ok(!ohne.includes("Kit-Stand:"), "ohne festen Stand keine Zeile");
});
