// Das vierte Titel-Praefix `[Mensch]` (Issue #984).
//
// Eine Karte, deren Aufgabe ausserhalb des Repositories liegt — eine Einstellung in einer
// Weboberflaeche, ein Konto, ein Zugang, eine Freigabe —, kann keine Sitzung erledigen. Ohne
// Gate startete der Runner eine Session, die den Fall richtig erkennt und nichts tut; er
// wertete das als Fehlschlag und schob die Karte ins Backlog, wo sie wie ein gescheitertes
// Paket aussieht (belegter Fall: kanban-kit #1256 im Lauf night-run-2026-09-28).
//
// Geprueft wird hier die Erkennung, nicht das Gate — das fuehrt test/night-mensch.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { istMensch, istFachlich, istIdee, istPlan, stufeAusTitel, pruefeForm } from "../kit/board.mjs";

test("[board-984] `[Mensch]` wird so streng erkannt wie die drei anderen Praefixe", () => {
  for (const titel of [
    "[Mensch] Private Vulnerability Reporting aktivieren",
    "[mensch] kleingeschrieben",
    "[MENSCH] grossgeschrieben",
    "  [Mensch] mit fuehrendem Leerraum",
    "[Mensch]ohne Leerzeichen",
  ]) {
    assert.equal(istMensch(titel), true, `Titel "${titel}" wurde nicht als Menschenschritt erkannt`);
  }
});

test("[board-984] ein `[Mensch]` mitten im Titel zaehlt nicht", () => {
  for (const titel of [
    "Text ueber [Mensch] im Titel",
    "[Task] Etwas fuer [Mensch] vorbereiten",
    "Mensch: ohne Klammern",
    "[Menschlich] anderes Wort",
  ]) {
    assert.equal(istMensch(titel), false, `Titel "${titel}" wurde faelschlich als Menschenschritt erkannt`);
  }
});

test("[board-984] leerer und fehlender Titel sind kein Menschenschritt", () => {
  assert.equal(istMensch(""), false);
  assert.equal(istMensch(null), false);
  assert.equal(istMensch(undefined), false);
});

test("[board-984] die drei anderen Praedikate bleiben unberuehrt", () => {
  const titel = "[Mensch] Ein Klick in den Einstellungen";
  assert.equal(istFachlich(titel), false);
  assert.equal(istIdee(titel), false);
  assert.equal(istPlan(titel), false);
});

// Erhebung zu Aufgabe 6 des Pakets: Ob das Formgate an einem `[Mensch]`-Paket etwas anderes
// verlangt, wurde an I1 bis I6 erhoben, nicht geraten — es verlangt dasselbe. Ein
// Menschenschritt ist ein Arbeitspaket und traegt die vier Abschnitte, das Autor-Modell und
// seine Abhaengigkeiten wie jedes andere; nur umsetzen kann ihn keine Sitzung. Der Test haelt
// das fest, damit die Erhebung nicht bei der naechsten Aenderung still verfaellt.
test("[board-984] ein `[Mensch]`-Paket faellt in die Stufe issue und besteht die Formpruefung", () => {
  const titel = "[Mensch] Private Vulnerability Reporting aktivieren";
  assert.equal(stufeAusTitel(titel), "issue");
  const body = [
    "## Kontext", "", "Autor-Modell: claude-opus-5", "",
    "## Aufgabe", "", "In den GitHub-Einstellungen den Schalter setzen.", "",
    "## Akzeptanzkriterium", "", "Der Schalter ist gesetzt.", "",
    "## Abhaengigkeiten", "", "Keine.", "",
  ].join("\n");
  const r = pruefeForm(body, titel, {});
  assert.equal(r.stufe, "issue");
  assert.deepEqual(r.verstoesse, []);
  assert.equal(r.ok, true);
});
