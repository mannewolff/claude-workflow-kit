// Der geklaerte Stand einer Idee fuer /triage (Issue #1628, Plan #1623 A4, A6, A10, E1):
// `standLesen` liest die Punkte unter `## Geklärter Stand` mit dem Leser von /groom, die
// Bahn-Zeile (der gewaehlte Wert zaehlt), die Vorlage-Zeile und das Ergebnis — aus der
// Ergebnis-Zeile oder, fehlt sie, aus dem Spur-Kommentar `Fortsetzung: …` an der Idee.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { standLesen, ablageLesen } from "../kit/board/triage.mjs";
import { spracheFestlegen } from "../kit/board/namen.mjs";

afterEach(() => spracheFestlegen(null));

const IDEE = "Ein Export als CSV waere praktisch.\n";

const stand = (...zeilen) => `${IDEE}\n## Geklärter Stand\n${zeilen.join("\n")}\n`;

const DREI_PUNKTE = [
  "1. Welches Format?",
  "   **Antwort (Manne, 2026-10-13):** CSV.",
  "2. Wer nutzt den Export?",
  "   **Antwort (Manne, 2026-10-13):** Die Buchhaltung.",
  "3. Welches Trennzeichen?",
];

test("Szenario: Der Mensch entscheidet anders als vorgeschlagen", () => {
  const body = stand(...DREI_PUNKTE.slice(0, 4), "", "Bahn: 3 — vorgeschlagen: 2, fachlich; gewählt (Manne, 2026-10-13)");
  const s = standLesen(body, []);
  assert.equal(s.bahn, "3", "der gewaehlte Wert zaehlt, nicht der vorgeschlagene");
});

test("Szenario: Ein abgebrochenes Durchsprechen wird fortgesetzt", () => {
  const wurzel = mkdtempSync(join(tmpdir(), "triage-stand-"));
  try {
    mkdirSync(join(wurzel, ".claude", "ideas", "7"), { recursive: true });
    writeFileSync(join(wurzel, ".claude", "ideas", "7", "skizze.png"), "png");
    const body = stand(...DREI_PUNKTE);

    const s = standLesen(body, []);
    assert.deepEqual(s.punkte.map((p) => [p.nr, p.entschieden]), [[1, true], [2, true], [3, false]]);
    assert.equal(s.offen, 1);
    assert.equal(s.punkte[2].text, "Welches Trennzeichen?");
    assert.equal(s.ergebnis, null);
    assert.equal(ablageLesen(wurzel, "7").vorhanden, true, "die Ablage bleibt ueber den Abbruch");

    const mitIssue = standLesen(body, [{ body: "Fortsetzung: Issue #12" }]);
    assert.deepEqual(mitIssue.ergebnis, { art: "issue", wert: "12", quelle: "kommentar" });
    const mitIdee = standLesen(body, [{ body: "Fortsetzung: Idee 0a1b-2c (noch nicht eingeplant)" }]);
    assert.deepEqual(mitIdee.ergebnis, { art: "idee", wert: "0a1b-2c", quelle: "kommentar" });
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("Punkte und Zaehlung, englische Ueberschrift", () => {
  const body = `${IDEE}\n## Clarified state\n1. Format?\n   **Antwort (Manne, 2026-10-13):** CSV.\n2. Separator?\n`;
  const s = standLesen(body, []);
  assert.equal(s.punkte.length, 2);
  assert.equal(s.offen, 1);
  assert.equal(s.punkte[0].antwortZeile, "**Antwort (Manne, 2026-10-13):** CSV.");
});

test("ohne Abschnitt: keine Punkte, keine Bahn, kein Ergebnis", () => {
  assert.deepEqual(standLesen(IDEE, []), { punkte: [], offen: 0, bahn: null, vorlage: null, ergebnis: null });
  assert.deepEqual(standLesen(undefined, undefined), { punkte: [], offen: 0, bahn: null, vorlage: null, ergebnis: null });
});

test("Bahn-Zeile: alle Werte nach E1, deutsch und englisch", () => {
  const faelle = [
    ["Bahn: 1 — vorgeschlagen: 1; gewählt (Manne, 2026-10-13)", "1"],
    ["Bahn: 2, fachlich — vorgeschlagen: 3; gewählt (Manne, 2026-10-13)", "2, fachlich"],
    ["Bahn: 2, technisch — vorgeschlagen: 2, technisch; gewählt (Manne, 2026-10-13)", "2, technisch"],
    ["Lane: 2, business — proposed: 3; chosen (Manne, 2026-10-13)", "2, fachlich"],
    ["Lane: 2, technical — proposed: 2, business; chosen (Manne, 2026-10-13)", "2, technisch"],
    ["Lane: 3 — proposed: 1; chosen (Manne, 2026-10-13)", "3"],
  ];
  for (const [zeile, bahn] of faelle) assert.equal(standLesen(stand("1. Punkt?", "", zeile), []).bahn, bahn, zeile);
});

test("Bahn-Zeile: unbekannter Wert ist keine Bahn, eine Zeile ausserhalb des Abschnitts zaehlt nicht", () => {
  assert.equal(standLesen(stand("Bahn: 4 — vorgeschlagen: 2; gewählt (M, 2026-10-13)"), []).bahn, null);
  assert.equal(standLesen(`Bahn: 3\n\n## Geklärter Stand\n1. Punkt?\n`, []).bahn, null);
});

test("Vorlage-Zeile wird woertlich gelesen", () => {
  const s = standLesen(stand("1. Punkt?", "", "Vorlage: design/ideas/7/skizze.png — verbindlich"), []);
  assert.equal(s.vorlage, "design/ideas/7/skizze.png — verbindlich");
});

test("Ergebnis-Zeile: Issue, Idee und Commit, deutsch und englisch", () => {
  const faelle = [
    ["Ergebnis: Issue #31", { art: "issue", wert: "31", quelle: "zeile" }],
    ["Ergebnis: Idee 9f3e", { art: "idee", wert: "9f3e", quelle: "zeile" }],
    ["Ergebnis: Commit 8894dae", { art: "commit", wert: "8894dae", quelle: "zeile" }],
    ["Result: Issue #31", { art: "issue", wert: "31", quelle: "zeile" }],
    ["Result: Idea 9f3e", { art: "idee", wert: "9f3e", quelle: "zeile" }],
    ["Result: Commit 8894dae", { art: "commit", wert: "8894dae", quelle: "zeile" }],
  ];
  for (const [zeile, ergebnis] of faelle) assert.deepEqual(standLesen(stand("1. Punkt?", "", zeile), []).ergebnis, ergebnis, zeile);
});

test("die Ergebnis-Zeile geht dem Fortsetzungs-Kommentar vor", () => {
  const s = standLesen(stand("1. Punkt?", "", "Ergebnis: Issue #31"), [{ body: "Fortsetzung: Issue #12" }]);
  assert.deepEqual(s.ergebnis, { art: "issue", wert: "31", quelle: "zeile" });
});

test("Fortsetzungs-Kommentar: der juengste zaehlt, andere Kommentare nicht", () => {
  const s = standLesen(stand("1. Punkt?"), [
    "Fortsetzung: Issue #12",
    { body: "Ein Kommentar ohne Spur.\nFortsetzung: Issue #99" },
    { body: "\nFortsetzung: Issue #13\n" },
    { body: "## Laufstand" },
  ]);
  assert.deepEqual(s.ergebnis, { art: "issue", wert: "13", quelle: "kommentar" });
});

test("eine unlesbare Ergebnis-Zeile faellt auf den Kommentar zurueck", () => {
  const s = standLesen(stand("1. Punkt?", "", "Ergebnis: offen"), [{ body: "Fortsetzung: Issue #12" }]);
  assert.deepEqual(s.ergebnis, { art: "issue", wert: "12", quelle: "kommentar" });
});
