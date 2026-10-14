// Body-Pruefung und Vergleich beim Grooming (Issue #1512, Plan #1510 A2, A3, A6, E8, E9):
// `koerperPruefen` haelt einen neuen Body an, der Kennzeichnungszeilen, bestaetigte Antworten,
// Fragen oder Pflichtabschnitte verliert oder den Vermerk „Keine“ falsch setzt;
// `kriterienVergleich` nennt die geaenderten Kriterien und Nicht-Ziele.

import { test } from "node:test";
import assert from "node:assert/strict";

import { koerperPruefen, kriterienVergleich, TEXTE } from "../kit/board/grooming.mjs";
import { pruefeParitaet } from "../kit/board/namen.mjs";

const ANTWORT = "   **Antwort (PO, 2026-10-10):** Ja.";

const fachplan = ({
  kopf = "Autor-Modell: claude-opus-5-5\nFachplan-Review: fable (2026-10-10)\nVorlage: docs/vorlage.md",
  kriterien = "1. Erstens.\n2. Zweitens.",
  nichtZiele = "- Kein A.\n- Kein B.",
  fragen = `1. Erste Frage?\n${ANTWORT}\n2. Zweite Frage?`,
  szenarien = null,
  ohne = [],
} = {}) => [
  ["Ziel", `Ein Ziel.\n\n${kopf}`],
  ["Fachliche Akzeptanzkriterien", kriterien],
  ...(szenarien === null ? [] : [["Szenarien", szenarien]]),
  ["Nicht-Ziele", nichtZiele],
  ["Offene Fragen an den PO", fragen],
].filter(([titel]) => !ohne.includes(titel)).map(([titel, inhalt]) => `## ${titel}\n${inhalt}\n`).join("\n");

const regeln = (r) => r.verstoesse.map((v) => v.regel);

test("unveraenderter Body und eingearbeitete Antwort sind ok", () => {
  const alt = fachplan();
  assert.deepEqual(koerperPruefen(alt, alt), { ok: true, verstoesse: [] });
  const neu = fachplan({ fragen: `1. Erste Frage?\n${ANTWORT}\n2. Zweite Frage?\n   **Antwort (PO, 2026-10-12):** Nein.` });
  assert.deepEqual(koerperPruefen(alt, neu), { ok: true, verstoesse: [] });
});

test("(a) gestrichene oder geaenderte Kennzeichnungszeile ist ein Verstoss", () => {
  const alt = fachplan();
  for (const kopf of [
    "Fachplan-Review: fable (2026-10-10)\nVorlage: docs/vorlage.md",
    "Autor-Modell: claude-sonnet-5-5\nFachplan-Review: fable (2026-10-10)\nVorlage: docs/vorlage.md",
    "Autor-Modell: claude-opus-5-5\nVorlage: docs/vorlage.md",
    "Autor-Modell: claude-opus-5-5\nFachplan-Review: fable (2026-10-10)",
    "Autor-Modell: claude-opus-5-5\nFachplan-Review: fable (2026-10-10)\nVorlage: docs/andere.md",
  ]) {
    const r = koerperPruefen(alt, fachplan({ kopf }));
    assert.equal(r.ok, false, kopf);
    assert.deepEqual(regeln(r), ["kennzeichnung"], kopf);
    assert.ok(r.verstoesse[0].meldung.length > 0);
  }
});

test("(a) englische Schreibweise zaehlt wie die deutsche, Gegenprobe ohne Verstoss", () => {
  const altEn = fachplan({ kopf: "Author-Model: claude-opus-5-5\nRequirement-Review: fable (2026-10-10)\nTemplate: docs/vorlage.md" });
  assert.deepEqual(regeln(koerperPruefen(altEn, fachplan())), []);
  const r = koerperPruefen(altEn, fachplan({ kopf: "Requirement-Review: fable (2026-10-10)\nTemplate: docs/vorlage.md" }));
  assert.deepEqual(regeln(r), ["kennzeichnung"]);
});

test("(a) eine neu hinzugekommene Kennzeichnungszeile ist kein Verstoss", () => {
  const alt = fachplan({ kopf: "Autor-Modell: claude-opus-5-5" });
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan())), []);
});

test("(b) entschiedene Frage wird offen oder traegt eine andere Antwort", () => {
  const alt = fachplan();
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: "1. Erste Frage?\n2. Zweite Frage?" }))), ["antwort"]);
  const anders = fachplan({ fragen: "1. Erste Frage?\n   **Antwort (PO, 2026-10-10):** Nein.\n2. Zweite Frage?" });
  assert.deepEqual(regeln(koerperPruefen(alt, anders)), ["antwort"]);
});

test("(b) Gegenprobe: entschiedene Frage behaelt ihre Antwort, auch an anderer Stelle", () => {
  const alt = fachplan();
  const verschoben = fachplan({ fragen: `1. Neue Stopp-Frage?\n2. Erste Frage?\n${ANTWORT}\n3. Zweite Frage?` });
  assert.deepEqual(regeln(koerperPruefen(alt, verschoben)), []);
});

test("(c) die Zahl der Fragen sinkt", () => {
  const alt = fachplan();
  const r = koerperPruefen(alt, fachplan({ fragen: `1. Erste Frage?\n${ANTWORT}` }));
  assert.deepEqual(regeln(r), ["fragenzahl"]);
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: `1. Erste Frage?\n${ANTWORT}\n2. Zweite Frage?\n3. Folgefrage?` }))), []);
});

test("(d) Vermerk „Keine“ bei offener Frage ist ein Verstoss", () => {
  const alt = fachplan();
  const neu = fachplan({ fragen: `Keine. Die 2 Fragen hat der PO am 2026-10-12 entschieden.\n\n1. Erste Frage?\n${ANTWORT}\n2. Zweite Frage?` });
  assert.deepEqual(regeln(koerperPruefen(alt, neu)), ["vermerk"]);
});

test("(d) Vermerk nicht als erste nichtleere Zeile ist ein Verstoss", () => {
  const alt = fachplan();
  const fragen = `1. Erste Frage?\n${ANTWORT}\n2. Zweite Frage?\n   **Antwort (PO, 2026-10-12):** Nein.`;
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: `${fragen}\n\nKeine. Die 2 Fragen hat der PO am 2026-10-12 entschieden.` }))), ["vermerk"]);
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: `${fragen}\n- Keine. Die 2 Fragen hat der PO am 2026-10-12 entschieden.` }))), ["vermerk"]);
});

test("(d) falsche oder fehlende Zahl im Vermerk ist ein Verstoss", () => {
  const alt = fachplan();
  const fragen = `1. Erste Frage?\n${ANTWORT}\n2. Zweite Frage?\n   **Antwort (PO, 2026-10-12):** Nein.`;
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: `Keine. Die 3 Fragen hat der PO am 2026-10-12 entschieden.\n\n${fragen}` }))), ["vermerk"]);
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: `Keine.\n\n${fragen}` }))), ["vermerk"]);
});

test("(d) Gegenprobe: richtiger Vermerk als erste Zeile, alle Fragen entschieden", () => {
  const alt = fachplan();
  const fragen = `1. Erste Frage?\n${ANTWORT}\n2. Zweite Frage?\n   **Antwort (PO, 2026-10-12):** Nein.`;
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: `Keine. Die 2 Fragen hat der PO am 2026-10-12 entschieden, die Antworten stehen unter der jeweiligen Frage.\n\n${fragen}` }))), []);
  assert.deepEqual(regeln(koerperPruefen(alt, fachplan({ fragen: `- Keine. Die 2 Fragen hat der PO am 2026-10-12 entschieden.\n\n${fragen}` }))), []);
  const leer = fachplan({ fragen: "Keine." });
  assert.deepEqual(regeln(koerperPruefen(leer, leer)), []);
});

test("(e) fehlender Pflichtabschnitt ist ein Verstoss, je Abschnitt einer", () => {
  const alt = fachplan();
  const r = koerperPruefen(alt, fachplan({ ohne: ["Nicht-Ziele"] }));
  assert.deepEqual(regeln(r), ["pflichtabschnitt"]);
  assert.match(r.verstoesse[0].meldung, /nicht-ziele/i);
  const zwei = koerperPruefen(alt, fachplan({ ohne: ["Ziel", "Fachliche Akzeptanzkriterien"] }));
  assert.ok(regeln(zwei).filter((x) => x === "pflichtabschnitt").length === 2);
});

test("(e) Gegenprobe: englische Abschnittstitel gelten als vorhanden", () => {
  const alt = fachplan();
  const en = alt.replace("## Nicht-Ziele", "## Non-goals").replace("## Fachliche Akzeptanzkriterien", "## Business acceptance criteria");
  assert.deepEqual(regeln(koerperPruefen(alt, en)), []);
});

test("Texte der Body-Pruefung sind in beiden Sprachen vorhanden", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  for (const k of ["kennzeichnung", "antwortOffen", "antwortAnders", "fragenzahl", "vermerkOffen", "vermerkStelle", "vermerkZahl", "pflichtabschnitt"]) {
    assert.ok(Object.hasOwn(TEXTE.de, k), k);
  }
});

// --- kriterienVergleich ---------------------------------------------------------------

const leer = { ergaenzt: [], gestrichen: [], umformuliert: [] };

test("unveraenderte Listen ergeben leere Vergleiche", () => {
  const b = fachplan();
  const ohneAenderung = { kriterien: leer, nichtZiele: leer, szenarien: leer, vorschlag: null };
  assert.deepEqual(kriterienVergleich(b, b, "7"), ohneAenderung);
  const umbruch = fachplan({ kriterien: "1. Erstens.\n2.  Zweitens. " });
  assert.deepEqual(kriterienVergleich(b, umbruch, "7"), ohneAenderung);
});

test("nummerierte Liste: Zuordnung ueber die Nummer", () => {
  const start = fachplan({ kriterien: "1. Erstens.\n2. Zweitens.\n3. Drittens." });
  const ende = fachplan({ kriterien: "1. Erstens.\n3. Drittens, genauer.\n4. Viertens." });
  const r = kriterienVergleich(start, ende);
  assert.deepEqual(r.kriterien, {
    ergaenzt: [{ nr: 4, text: "Viertens." }],
    gestrichen: [{ nr: 2, text: "Zweitens." }],
    umformuliert: [{ nr: 3, vorher: "Drittens.", nachher: "Drittens, genauer." }],
  });
  assert.deepEqual(r.nichtZiele, leer);
});

test("Aufzaehlung ohne Nummer: Zuordnung ueber die Position", () => {
  const start = fachplan({ nichtZiele: "- Kein A.\n- Kein B." });
  const umformuliert = kriterienVergleich(start, fachplan({ nichtZiele: "- Kein A.\n- Kein B, auch kein C." }));
  assert.deepEqual(umformuliert.nichtZiele, { ...leer, umformuliert: [{ nr: 2, vorher: "Kein B.", nachher: "Kein B, auch kein C." }] });
  const ergaenzt = kriterienVergleich(start, fachplan({ nichtZiele: "- Kein A.\n- Kein B.\n- Kein D." }));
  assert.deepEqual(ergaenzt.nichtZiele, { ...leer, ergaenzt: [{ nr: 3, text: "Kein D." }] });
  const gestrichen = kriterienVergleich(start, fachplan({ nichtZiele: "- Kein A." }));
  assert.deepEqual(gestrichen.nichtZiele, { ...leer, gestrichen: [{ nr: 2, text: "Kein B." }] });
  assert.deepEqual(gestrichen.kriterien, leer);
});

test("Folgezeilen gehoeren zum Listenelement, englische Titel zaehlen", () => {
  const start = fachplan({ kriterien: "1. Erstens,\n   mit Folgezeile." });
  const ende = fachplan({ kriterien: "1. Erstens,\n   mit anderer Folgezeile." }).replace("## Fachliche Akzeptanzkriterien", "## Business acceptance criteria");
  assert.deepEqual(kriterienVergleich(start, ende).kriterien.umformuliert, [{ nr: 1, vorher: "Erstens,\nmit Folgezeile.", nachher: "Erstens,\nmit anderer Folgezeile." }]);
});

test("ein geaendertes Kriterium oder Nicht-Ziel fuehrt zum Vorschlag /issue-review", () => {
  const start = fachplan();
  assert.equal(kriterienVergleich(start, fachplan({ kriterien: "1. Erstens.\n2. Zweitens, genauer." }), "7").vorschlag, "/issue-review #7");
  assert.equal(kriterienVergleich(start, fachplan({ nichtZiele: "- Kein A." }), "7").vorschlag, "/issue-review #7");
});

// --- Szenarien im Vergleich (Issue #1592, Plan #1588 E8, A1) ---------------------------

const SZ_A = "### Szenario: Export\n- Angenommen ein Export\n- Wenn er laeuft\n- Dann liegt eine CSV vor";
const SZ_B = "### Szenario: Import\n- Angenommen eine CSV\n- Wenn sie eingelesen wird\n- Dann stehen die Zeilen da";

test("Szenario ergänzt: Vorschlag /issue-review", () => {
  const r = kriterienVergleich(fachplan(), fachplan({ szenarien: SZ_A }), "7");
  assert.deepEqual(r.szenarien, {
    ...leer, ergaenzt: [{ titel: "Export", text: "- Angenommen ein Export\n- Wenn er laeuft\n- Dann liegt eine CSV vor" }],
  });
  assert.deepEqual(r.kriterien, leer, "die Listenzeilen der Szenarien zaehlen nicht als Kriterien (A1)");
  assert.equal(r.vorschlag, "/issue-review #7");
});

test("Szenario gestrichen: Vorschlag /issue-review", () => {
  const r = kriterienVergleich(fachplan({ szenarien: `${SZ_A}\n\n${SZ_B}` }), fachplan({ szenarien: SZ_A }), "7");
  assert.deepEqual(r.szenarien, {
    ...leer, gestrichen: [{ titel: "Import", text: "- Angenommen eine CSV\n- Wenn sie eingelesen wird\n- Dann stehen die Zeilen da" }],
  });
  assert.equal(r.vorschlag, "/issue-review #7");
});

test("Szenario umformuliert: Vorschlag /issue-review", () => {
  const r = kriterienVergleich(fachplan({ szenarien: SZ_A }), fachplan({ szenarien: SZ_A.replace("eine CSV", "eine CSV-Datei") }), "7");
  assert.deepEqual(r.szenarien, {
    ...leer,
    umformuliert: [{
      titel: "Export",
      vorher: "- Angenommen ein Export\n- Wenn er laeuft\n- Dann liegt eine CSV vor",
      nachher: "- Angenommen ein Export\n- Wenn er laeuft\n- Dann liegt eine CSV-Datei vor",
    }],
  });
  assert.equal(r.vorschlag, "/issue-review #7");
});

test("Szenario unverändert: kein Vorschlag, Leerraum zaehlt nicht", () => {
  const start = fachplan({ szenarien: `${SZ_A}\n\n${SZ_B}` });
  const ende = fachplan({ szenarien: `${SZ_A.replace("ein Export", "ein  Export ")}\n\n\n${SZ_B}` });
  const r = kriterienVergleich(start, ende, "7");
  assert.deepEqual(r.szenarien, leer);
  assert.equal(r.vorschlag, null);
});

test("ein umbenanntes Szenario gilt als gestrichen und ergaenzt", () => {
  const r = kriterienVergleich(fachplan({ szenarien: SZ_A }), fachplan({ szenarien: SZ_A.replace("Szenario: Export", "Szenario: Ausfuhr") }), "7");
  assert.deepEqual(r.szenarien.gestrichen.map((s) => s.titel), ["Export"]);
  assert.deepEqual(r.szenarien.ergaenzt.map((s) => s.titel), ["Ausfuhr"]);
});

test("zwei Szenarien mit gleichem Titel werden beide verglichen", () => {
  const r = kriterienVergleich(fachplan({ szenarien: `${SZ_A}\n\n${SZ_A}` }), fachplan({ szenarien: `${SZ_A}\n\n${SZ_A.replace("eine CSV", "zwei CSV")}` }), "7");
  assert.equal(r.szenarien.umformuliert.length, 1);
  assert.equal(r.szenarien.umformuliert[0].titel, "Export (2)");
});

test("ohne Kartennummer nennt der Vorschlag den Platzhalter", () => {
  assert.equal(kriterienVergleich(fachplan(), fachplan({ szenarien: SZ_A })).vorschlag, "/issue-review #?");
});

// --- Regel szenarien (Issue #1626) --------------------------------------------

const SZENARIO = "### Szenario: Ein Fall\n- Angenommen, eine Lage\n- Wenn etwas geschieht\n- Dann ein Ergebnis";

test("(f) neuer Body mit unvollstaendigem Abschnitt Szenarien ist ein Verstoss", () => {
  const alt = fachplan();
  const neu = fachplan({ szenarien: SZENARIO.split("\n").filter((z) => !z.startsWith("- Dann")).join("\n") });
  const r = koerperPruefen(alt, neu);
  assert.equal(r.ok, false);
  assert.deepEqual(regeln(r), ["szenarien"]);
  assert.match(r.verstoesse[0].meldung, /Szenarien/);
});

test("(f) neuer Body mit vollstaendigem oder ohne Abschnitt Szenarien ist ok", () => {
  const alt = fachplan();
  assert.deepEqual(koerperPruefen(alt, fachplan({ szenarien: SZENARIO })), { ok: true, verstoesse: [] });
  assert.deepEqual(koerperPruefen(alt, alt), { ok: true, verstoesse: [] });
});

test("(a) verschwundene oder geaenderte Wartezeile ist ein Verstoss (Issue #1661)", () => {
  const alt = fachplan({ kopf: "Autor-Modell: claude-opus-5-5\nWartet auf Ereignis: Tarif X waehlbar" });
  assert.deepEqual(regeln(koerperPruefen(alt, alt)), []);
  for (const kopf of ["Autor-Modell: claude-opus-5-5", "Autor-Modell: claude-opus-5-5\nWartet auf Ereignis: Tarif Y waehlbar"]) {
    const r = koerperPruefen(alt, fachplan({ kopf }));
    assert.deepEqual(regeln(r), ["kennzeichnung"], kopf);
    assert.match(r.verstoesse[0].meldung, /Wartet auf Ereignis: Tarif X waehlbar/);
  }
});
