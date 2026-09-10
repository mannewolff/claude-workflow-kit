// Synthese-Parser und Beleg-Abgleich (Issue #591, Plan #589 A2/A9).
//
// Geprueft wird gegen die echten Paare aus test/fixtures/synthese (Issue #590),
// nicht gegen selbstgebaute Synthesen: Die Form ist gewachsen, und eine
// nachgebaute Zeile prueft nur die eigene Annahme darueber, wie sie aussieht.
// Selbstgebaute Eingaben stehen hier nur dort, wo der Bestand den Fall (noch)
// nicht hergibt — Normalisierung, Streichung, Pfeil ohne Zitat.
//
// Massstab der Zaehlung ist `uebernommenErwartet` aus der herkunft.json, nicht
// die Schlusszeile `Übernommen: n` der Synthese. Die ist eine Selbstauskunft der
// damaligen Session und in sechs von sieben Karten falsch (Issue #590); ein
// Nachweis, der darauf stuende, pruefte Text gegen Text statt Parser gegen Text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VORSCHLAG_KOPF,
  SYNTHESE_KOPF,
  parseSyntheseZeilen,
  syntheseBelegt,
} from "../kit/board.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(repoRoot, "test", "fixtures", "synthese");

const KARTEN = ["579", "580", "583", "584", "585", "587", "589"];

function lies(verzeichnis, datei) {
  return readFileSync(join(FIXTURES, verzeichnis, datei), "utf-8");
}

function herkunft(verzeichnis) {
  return JSON.parse(lies(verzeichnis, "herkunft.json"));
}

const mitVorschlag = KARTEN.filter((id) => herkunft(id).vorschlagIndex !== null);

function uebernommen(text) {
  return parseSyntheseZeilen(text).filter((p) => p.ausgang === "uebernommen");
}

/** Der Text ab einer Ueberschrift bis zur naechsten gleicher oder hoeherer Stufe. */
function abschnittText(text, ueberschrift) {
  const zeilen = text.split("\n");
  const start = zeilen.findIndex((z) => z.trim() === ueberschrift);
  assert.notEqual(start, -1, `Abschnitt '${ueberschrift}' fehlt`);
  const rest = zeilen.slice(start + 1);
  const ende = rest.findIndex((z) => /^#{1,3} /.test(z));
  return (ende === -1 ? rest : rest.slice(0, ende)).join("\n");
}

// --- parseSyntheseZeilen ---

test("parseSyntheseZeilen liest aus jedem unaufbereiteten Fixture so viele uebernommen-Punkte wie erwartet, alle ohne Zitat", () => {
  for (const id of KARTEN) {
    const punkte = uebernommen(lies(id, "synthese.md"));
    assert.equal(punkte.length, herkunft(id).uebernommenErwartet, `${id}: andere Zahl als uebernommenErwartet`);
    for (const p of punkte) {
      assert.equal(p.zitat, null, `${id}: unerwartetes Zitat in "${p.fund.slice(0, 60)}"`);
      assert.equal(p.abschnitt, null, `${id}: unerwarteter Abschnitt in "${p.fund.slice(0, 60)}"`);
    }
  }
});

test("parseSyntheseZeilen liest aus jedem aufbereiteten Fixture zu jedem uebernommen-Punkt Abschnitt und Zitat", () => {
  for (const id of mitVorschlag) {
    const punkte = uebernommen(lies(`${id}-aufbereitet`, "synthese.md"));
    assert.equal(punkte.length, herkunft(`${id}-aufbereitet`).uebernommenErwartet);
    for (const p of punkte) {
      assert.ok(p.zitat && p.zitat.trim() !== "", `${id}-aufbereitet: Zitat fehlt in "${p.fund.slice(0, 60)}"`);
      assert.ok(
        p.abschnitt && p.abschnitt.trim() !== "",
        `${id}-aufbereitet: Abschnitt fehlt in "${p.fund.slice(0, 60)}"`
      );
    }
  }
});

// Der Fund heisst "Weg (a): Kriterium 8 um übernommene Funde erweitern" und ist
// verworfen. Das Issue verortet die Zeile im #589-Fixture; sie steht in #587.
test("die Kurzbezeichnung bestimmt den Ausgang nicht — ein verworfener Fund mit 'übernommene' im Titel bleibt verworfen", () => {
  const punkte = parseSyntheseZeilen(lies("587", "synthese.md"));
  const falle = punkte.find((p) => p.fund.startsWith("Weg (a): Kriterium 8"));
  assert.ok(falle, "die Fallen-Zeile aus dem 587-Fixture wurde nicht gelesen");
  assert.match(falle.fund, /übernommene/);
  assert.equal(falle.ausgang, "verworfen");
  assert.equal(falle.reviewer, "fable");
});

test("Dissens-Punkte und die Schlusszeile liefern keine Eintraege", () => {
  for (const id of ["579", "580", "587", "589"]) {
    const text = lies(id, "synthese.md");
    const dissens = abschnittText(text, "### Dissens");
    assert.ok(dissens.includes("- "), `${id}: Dissens-Abschnitt ohne Listenpunkt`);
    assert.deepEqual(parseSyntheseZeilen(dissens), [], `${id}: Dissens liefert Eintraege`);
  }
  const schlusszeilen = [
    "Übernommen: 17 · Verworfen: 2 (ein halber Fund, ein Teilvorschlag)",
    "Uebernommen: 13 · Verworfen: 0 · Zur Entscheidung vorgelegt und entschieden: 3",
  ];
  assert.deepEqual(parseSyntheseZeilen(schlusszeilen.join("\n")), []);
});

test("ein Punkt traegt Reviewer und Fund ohne die umschliessenden Anfuehrungszeichen", () => {
  const [erster] = parseSyntheseZeilen(lies("584", "synthese.md"));
  assert.equal(erster.reviewer, "fable");
  assert.equal(
    erster.fund,
    "Akzeptanzkriterium 4 ist heute schon erfuellt, weil das Suchmuster am Umlaut vorbeigeht"
  );
  assert.equal(erster.ausgang, "uebernommen");
  assert.equal(erster.gestrichen, false);
});

test("ein Pfeil ohne Doppelpunkt oder ohne Anfuehrungszeichen-Paar liefert Abschnitt und Zitat null", () => {
  const ohneDoppelpunkt = parseSyntheseZeilen('- fable, "Ein Fund" — uebernommen → Ziel ohne Doppelpunkt');
  assert.equal(ohneDoppelpunkt.length, 1);
  assert.equal(ohneDoppelpunkt[0].abschnitt, null);
  assert.equal(ohneDoppelpunkt[0].zitat, null);

  const ohneZitat = parseSyntheseZeilen('- fable, "Ein Fund" — uebernommen → Ziel: ohne Zitat');
  assert.equal(ohneZitat.length, 1);
  assert.equal(ohneZitat[0].abschnitt, null);
  assert.equal(ohneZitat[0].zitat, null);
});

test("parseSyntheseZeilen liest eine Streichung als gestrichen mit dem Zitat aus dem alten Body", () => {
  const punkte = parseSyntheseZeilen(
    '- fable, "A7 alt traegt nichts" (RAUS) — uebernommen → Architektonische Entscheidungen: gestrichen "der alte Satz"'
  );
  assert.equal(punkte.length, 1);
  assert.equal(punkte[0].gestrichen, true);
  assert.equal(punkte[0].abschnitt, "Architektonische Entscheidungen");
  assert.equal(punkte[0].zitat, "der alte Satz");
});

test("parseSyntheseZeilen kennt den Ausgang 'zur Entscheidung' und wertet ihn nicht als Uebernahme", () => {
  const punkte = parseSyntheseZeilen(lies("579", "synthese.md"));
  const vorgelegt = punkte.filter((p) => p.ausgang === "zurEntscheidung");
  assert.equal(vorgelegt.length, 3);
  assert.equal(punkte.filter((p) => p.ausgang === "uebernommen").length, 9);
});

// --- syntheseBelegt ---

test("syntheseBelegt liefert auf jedem aufbereiteten Paar keinen Befund", () => {
  for (const id of mitVorschlag) {
    const synthese = lies(`${id}-aufbereitet`, "synthese.md");
    const ergebnis = syntheseBelegt(synthese, lies(`${id}-aufbereitet`, "vorschlag.md"));
    assert.deepEqual(ergebnis.ohneBeleg, [], `${id}-aufbereitet: unerwartete Befunde`);
    assert.equal(ergebnis.gepruefte, uebernommen(synthese).length);
  }
});

test("syntheseBelegt liefert auf jedem unaufbereiteten Paar genau einen beleg-fehlt je uebernommen-Punkt", () => {
  for (const id of KARTEN) {
    const synthese = lies(id, "synthese.md");
    const ergebnis = syntheseBelegt(synthese, lies(id, "vorschlag.md"));
    const anzahl = uebernommen(synthese).length;
    assert.equal(ergebnis.gepruefte, anzahl, `${id}: gepruefte`);
    assert.equal(ergebnis.ohneBeleg.length, anzahl, `${id}: ohneBeleg.length`);
    for (const b of ergebnis.ohneBeleg) {
      assert.equal(b.grund, "beleg-fehlt", `${id}: ${b.fund.slice(0, 60)}`);
      assert.deepEqual(Object.keys(b).sort(), ["fund", "grund", "reviewer"]);
    }
  }
});

test("eine entfernte Belegstelle im Vorschlag ergibt genau einen zitat-nicht-gefunden", () => {
  for (const id of mitVorschlag) {
    const synthese = lies(`${id}-aufbereitet`, "synthese.md");
    const vorschlag = lies(`${id}-aufbereitet`, "vorschlag.md");
    const ziel = uebernommen(synthese).find((p) => !p.gestrichen && p.zitat);
    assert.ok(ziel, `${id}-aufbereitet: kein Punkt mit Zitat`);
    const ergebnis = syntheseBelegt(synthese, vorschlag.replace(ziel.zitat, ""));
    assert.equal(ergebnis.ohneBeleg.length, 1, `${id}-aufbereitet: nicht genau ein Befund`);
    assert.equal(ergebnis.ohneBeleg[0].grund, "zitat-nicht-gefunden");
    assert.equal(ergebnis.ohneBeleg[0].fund, ziel.fund);
  }
});

// `vorschlag-fehlt` entsteht erst im Kommando aus der Paarung (Plan #589, A7),
// nicht hier: syntheseBelegt kennt nur Text.
test("ohne Body-Vorschlag zaehlt jeder uebernommen-Punkt — mit Zitat als zitat-nicht-gefunden, ohne als beleg-fehlt", () => {
  const ohneVorschlag = KARTEN.filter((id) => !mitVorschlag.includes(id));
  assert.deepEqual(ohneVorschlag, ["579", "580", "583", "584", "585"]);
  for (const id of ohneVorschlag) {
    const synthese = lies(id, "synthese.md");
    const punkte = uebernommen(synthese);
    const ergebnis = syntheseBelegt(synthese, "");
    assert.equal(ergebnis.gepruefte, punkte.length);
    assert.deepEqual(
      ergebnis.ohneBeleg.map((b) => b.grund),
      punkte.map((p) => (p.zitat ? "zitat-nicht-gefunden" : "beleg-fehlt")),
      `${id}: Gruende`
    );
  }
});

test("eine Streichung ist belegt, wenn ihr Zitat im Vorschlag fehlt", () => {
  const synthese = '- fable, "A7 alt traegt nichts" — uebernommen → Ziel: gestrichen "der alte Satz"';
  assert.deepEqual(syntheseBelegt(synthese, "Der neue Text ohne den alten Satzbau."), {
    gepruefte: 1,
    ohneBeleg: [],
  });
});

test("eine Streichung ist nicht belegt, wenn ihr Zitat noch im Vorschlag steht", () => {
  const synthese = '- fable, "A7 alt traegt nichts" — uebernommen → Ziel: gestrichen "der alte Satz"';
  const ergebnis = syntheseBelegt(synthese, "Hier steht der alte Satz immer noch.");
  assert.deepEqual(ergebnis.ohneBeleg, [
    { reviewer: "fable", fund: "A7 alt traegt nichts", grund: "zitat-nicht-gefunden" },
  ]);
});

test("der Vergleich normalisiert beide Seiten: Auszeichnung, Anfuehrungszeichen und Zeilenumbrueche", () => {
  const faelle = [
    {
      name: "(a) Zitat ohne die Sternchen des Vorschlags",
      zitat: "Der Beleg steht ausdruecklich im Vorschlag",
      vorschlag: "Absatz. **Der Beleg steht ausdruecklich im Vorschlag** und danach mehr.",
    },
    {
      name: "(b) gerade Anfuehrungszeichen treffen die typografische Form",
      zitat: 'Das Kriterium nennt "Grenze" ausdruecklich',
      vorschlag: "Absatz. Das Kriterium nennt „Grenze“ ausdruecklich und danach mehr.",
      klammer: "„",
    },
    {
      name: "(c) einzeiliges Zitat trifft die umbrochene Passage",
      zitat: "Der Befund steht vor der Frage nach der Zustimmung",
      vorschlag: "Absatz. Der Befund steht vor der\n  Frage nach der Zustimmung und danach mehr.",
    },
    {
      name: "(d) Zitat mit Backticks trifft den Vorschlag ohne",
      zitat: "die Konstante `VORSCHLAG_KOPF` zieht um",
      vorschlag: "Absatz. die Konstante VORSCHLAG_KOPF zieht um und danach mehr.",
    },
  ];

  for (const fall of faelle) {
    const auf = fall.klammer === "„" ? "„" : '"';
    const zu = fall.klammer === "„" ? "“" : '"';
    const synthese = `- fable, "Ein Fund" — uebernommen → Ziel: ${auf}${fall.zitat}${zu}`;
    const [punkt] = parseSyntheseZeilen(synthese);
    assert.equal(punkt.zitat, fall.zitat, `${fall.name}: Zitat falsch gelesen`);
    assert.deepEqual(syntheseBelegt(synthese, fall.vorschlag).ohneBeleg, [], fall.name);
  }
});

test("leerer Text und eine Synthese ohne uebernommen-Punkt liefern keine Pruefung", () => {
  assert.deepEqual(parseSyntheseZeilen(""), []);
  assert.deepEqual(syntheseBelegt("", ""), { gepruefte: 0, ohneBeleg: [] });
  const nurVerworfen = [
    '- fable, "Ein Fund" — **verworfen**: Begruendung.',
    '- gpt-astra, "Ein zweiter Fund" — zur Entscheidung vorgelegt, **entschieden**.',
    "",
    "Übernommen: 0 · Verworfen: 1",
  ].join("\n");
  assert.deepEqual(syntheseBelegt(nurVerworfen, "irgendein Vorschlag"), { gepruefte: 0, ohneBeleg: [] });
});

// --- VORSCHLAG_KOPF ---

test("VORSCHLAG_KOPF trifft die Kopfzeile in Zeile 1, nicht dieselbe Zeile mit fuehrendem Text", () => {
  assert.equal(VORSCHLAG_KOPF.test("## Body-Vorschlag, Runde 1"), true);
  assert.equal(VORSCHLAG_KOPF.exec("## Body-Vorschlag, Runde 12")[1], "12");
  assert.equal(VORSCHLAG_KOPF.test("Text ## Body-Vorschlag, Runde 1"), false);
  assert.equal(VORSCHLAG_KOPF.test("## Synthese, Runde 1"), false);
});

test("VORSCHLAG_KOPF trifft die erste Zeile eines echten Vorschlags-Kommentars", () => {
  const kopf = "## Body-Vorschlag, Runde 1";
  assert.equal(VORSCHLAG_KOPF.test(kopf), true);
  assert.equal(VORSCHLAG_KOPF.test(`${kopf}\n\n## Kontext`), false);
});

// --- SYNTHESE_KOPF ---

// `## Synthese-Abgleich, Runde n` ist der Kommentar aus Issue #593. Ein Regex
// `^##\s*Synthese\b` traefe ihn mit (Bindestrich ist Wortgrenze) — der Board-Weg
// pruefte dann den Abgleich statt der Synthese, faende keine uebernommen-Zeile und
// meldete gruen. Die Pruefung waere nachts wirkungslos, ohne dass es auffiele.
test("[board-3] SYNTHESE_KOPF trifft die Kopfzeile, nicht den Synthese-Abgleich und nicht dieselbe Zeile mit fuehrendem Text", () => {
  assert.equal(SYNTHESE_KOPF.test("## Synthese, Runde 1"), true);
  assert.equal(SYNTHESE_KOPF.exec("## Synthese, Runde 12")[1], "12");
  assert.equal(SYNTHESE_KOPF.test("## Synthese-Abgleich, Runde 1"), false);
  assert.equal(SYNTHESE_KOPF.test("Text ## Synthese, Runde 1"), false);
  assert.equal(SYNTHESE_KOPF.test("## Body-Vorschlag, Runde 1"), false);
  assert.equal(SYNTHESE_KOPF.test("## Synthese, Runde 1\n\nStufe `issue`"), false);
});

test("[board-3] SYNTHESE_KOPF trifft die erste Zeile jedes Synthese-Fixtures", () => {
  for (const id of KARTEN) {
    const erste = lies(id, "synthese.md").split("\n")[0];
    assert.equal(SYNTHESE_KOPF.test(erste), true, `${id}: '${erste}'`);
  }
});
