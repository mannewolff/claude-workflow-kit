// `titelMitArt` (Issue #1427, Plan #1420 E6): die eine Regel, nach der `issue create --art`
// den Titel anlegt und `issue check-form --art` die Pruefstufe waehlt. Das Praefix kommt aus
// dem Namen-Register in der Projektsprache; ein Titel mit Praefix wird nie umgeschrieben,
// `--art` daneben ist ein Fehler. Die Kommandos selbst prueft
// test/ablauf-board-dokumente-art.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ARTEN, titelMitArt } from "../kit/board/dokumente.mjs";
import { stufeAusTitel } from "../kit/board/issue-review.mjs";

test("[board-1427] --art fachlich stellt in einem deutschen Projekt [Fachlich] voran", () => {
  assert.deepEqual(titelMitArt("Etwas", "fachlich", "de"), { titel: "[Fachlich] Etwas" });
  assert.deepEqual(titelMitArt("  Etwas", "idee", "de"), { titel: "[Idee] Etwas" });
});

test("[board-1427] --art fachlich stellt in einem englischen Projekt [Requirement] voran", () => {
  assert.deepEqual(titelMitArt("Something", "fachlich", "en"), { titel: "[Requirement] Something" });
  assert.deepEqual(titelMitArt("Step", "mensch", "en"), { titel: "[Human] Step" });
  assert.deepEqual(titelMitArt("Do it", "task", "en"), { titel: "[Task] Do it" });
});

test("[board-1427] ohne --art bleibt der Titel unveraendert, auch mit Praefix", () => {
  assert.deepEqual(titelMitArt("[Fachlich] Bleibt", undefined, "en"), { titel: "[Fachlich] Bleibt" });
  assert.deepEqual(titelMitArt("Ohne Praefix", undefined, "de"), { titel: "Ohne Praefix" });
});

test("[board-1427] --art neben einem Titel mit Praefix ist ein Fehler, in jeder Sprache des Praefixes", () => {
  for (const titel of ["[Fachlich] Doppelt", "[Requirement] Doppelt", " [plan] Doppelt"]) {
    const { titel: angelegt, fehler } = titelMitArt(titel, "fachlich", "de");
    assert.equal(angelegt, undefined, titel);
    assert.match(fehler, /--art/);
  }
});

test("[board-1427] eine unbekannte Art oder --art ohne Wert ist ein Fehler, der die Arten nennt", () => {
  for (const art of ["epos", true, "Fachlich"]) {
    assert.match(titelMitArt("X", art, "de").fehler, /fachlich\|idee\|mensch\|plan\|task/, String(art));
  }
  assert.deepEqual(ARTEN, ["fachlich", "idee", "mensch", "plan", "task"]);
});

test("[board-1427] der Titel mit Art ergibt die Pruefstufe der Art, wie check-form sie waehlt", () => {
  for (const sprache of ["de", "en"]) {
    assert.equal(stufeAusTitel(titelMitArt("X", "fachlich", sprache).titel), "fachlich", sprache);
    assert.equal(stufeAusTitel(titelMitArt("X", "plan", sprache).titel), "plan", sprache);
    assert.equal(stufeAusTitel(titelMitArt("X", "task", sprache).titel), "issue", sprache);
  }
  assert.equal(stufeAusTitel(titelMitArt("X", undefined, "de").titel), "issue");
});
