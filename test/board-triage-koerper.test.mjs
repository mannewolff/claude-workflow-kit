// Pruefung eines neuen Idee-Body fuer /triage (Issue #1628, Plan #1623 A4, E5): Der Text der
// Idee oberhalb von `## Geklärter Stand` bleibt, ein bestaetigter Punkt behaelt seine
// Antwortzeile; Punkte anhaengen und offene Punkte beantworten ist erlaubt.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { triageKoerperPruefen } from "../kit/board/triage.mjs";
import { spracheFestlegen } from "../kit/board/namen.mjs";

afterEach(() => spracheFestlegen(null));

const IDEE = "Ein Export als CSV waere praktisch.\n\nMit Bild im Anhang.";
const ANTWORT = "   **Antwort (Manne, 2026-10-13):** CSV.";
const ALT = `${IDEE}\n\n## Geklärter Stand\n1. Welches Format?\n${ANTWORT}\n2. Wer nutzt ihn?\n`;

const regeln = (r) => r.verstoesse.map((v) => v.regel);

test("unveraendert ist in Ordnung", () => {
  assert.deepEqual(triageKoerperPruefen(ALT, ALT), { ok: true, verstoesse: [] });
});

test("erste Punktliste unter einer Idee ohne Stand ist erlaubt", () => {
  const neu = `${IDEE}\n\n## Geklärter Stand\n1. Welches Format?\n2. Wer nutzt ihn?\n`;
  assert.equal(triageKoerperPruefen(IDEE, neu).ok, true);
});

test("ein angehaengter Punkt und eine neue Antwortzeile sind erlaubt", () => {
  const neu = ALT.replace("2. Wer nutzt ihn?\n", "2. Wer nutzt ihn?\n   **Antwort (Manne, 2026-10-13):** Die Buchhaltung.\n3. Wie oft?\n");
  assert.deepEqual(triageKoerperPruefen(ALT, neu), { ok: true, verstoesse: [] });
});

test("Bahn-, Vorlage- und Ergebnis-Zeile unter dem Stand sind erlaubt", () => {
  const neu = `${ALT}\nBahn: 3 — vorgeschlagen: 2, fachlich; gewählt (Manne, 2026-10-13)\nErgebnis: Issue #12\n`;
  assert.equal(triageKoerperPruefen(ALT, neu).ok, true);
});

test("geaenderter Text der Idee wird abgewiesen", () => {
  const r = triageKoerperPruefen(ALT, ALT.replace("Mit Bild", "Ohne Bild"));
  assert.equal(r.ok, false);
  assert.deepEqual(regeln(r), ["ideentext"]);
  assert.ok(r.verstoesse[0].meldung);
});

test("geaenderter Text auch ohne bisherigen Stand wird abgewiesen", () => {
  const r = triageKoerperPruefen(IDEE, `Neuer Text.\n\n## Geklärter Stand\n1. Punkt?\n`);
  assert.deepEqual(regeln(r), ["ideentext"]);
});

test("Leerraum am Ende des Idee-Texts und Zeilenenden zaehlen nicht", () => {
  const neu = ALT.replace(`${IDEE}\n\n`, `${IDEE}\n\n\n`).replaceAll("\n", "\r\n");
  assert.equal(triageKoerperPruefen(ALT, neu).ok, true);
});

test("ein bestaetigter Punkt verliert seine Antwortzeile: abgewiesen", () => {
  const r = triageKoerperPruefen(ALT, ALT.replace(`${ANTWORT}\n`, ""));
  assert.equal(r.ok, false);
  assert.deepEqual(regeln(r), ["antwort"]);
  assert.match(r.verstoesse[0].meldung, /Welches Format\?/);
});

test("eine geaenderte Antwortzeile ist ein Verlust der bestaetigten", () => {
  const r = triageKoerperPruefen(ALT, ALT.replace("CSV.", "Excel."));
  assert.deepEqual(regeln(r), ["antwort"]);
});

test("ein gestrichener Abschnitt verliert jede Antwortzeile", () => {
  const r = triageKoerperPruefen(ALT, `${IDEE}\n`);
  assert.deepEqual(regeln(r), ["antwort"]);
});

test("ein bestaetigter Punkt an anderer Nummer findet sich ueber seinen Text", () => {
  const neu = ALT.replace("## Geklärter Stand\n", "## Geklärter Stand\n1. Vorweg?\n").replace("1. Welches", "2. Welches").replace("2. Wer", "3. Wer");
  assert.equal(triageKoerperPruefen(ALT, neu).ok, true);
});

test("englische Ueberschrift und Meldung", () => {
  spracheFestlegen("en");
  const alt = ALT.replace("## Geklärter Stand", "## Clarified state");
  const r = triageKoerperPruefen(alt, alt.replace("Mit Bild", "Ohne Bild"));
  assert.match(r.verstoesse[0].meldung, /text of the idea/);
});
