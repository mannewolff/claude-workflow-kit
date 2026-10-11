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

// `labelAbbilden` (Issue #1428, Plan #1420 E6, E7): `issue label add|remove` bildet Kit-Labels
// auf den Namen der Projektsprache ab. `add` faellt nur bei am Board fehlendem Label auf den
// anderen Namen zurueck, `remove` nimmt den Namen ab, den die Karte traegt. Fremde Labels
// gehen unveraendert durch. Die Kommandozeile mit den echten Adaptern prueft
// test/ablauf-board-dokumente-label-set.test.mjs.

import { labelAbbilden, standLabels, STAND_LABEL_VORGABEN } from "../kit/board/dokumente.mjs";
import { LabelFehltError } from "../kit/board/adapter.mjs";

const DE = { language: "de" };
const EN = { language: "en" };

/** Ein Tracker, der Aufrufe festhaelt; `amBoard` begrenzt die definierten Labels. */
function fakeTracker({ amBoard = null, karte = [] } = {}) {
  const aufrufe = [];
  return {
    aufrufe,
    gelesen: 0,
    async labelIssue(id, name, aktion) {
      if (amBoard && !amBoard.includes(name)) throw new LabelFehltError(`Label '${name}' ist am Board nicht definiert.`);
      aufrufe.push([aktion, id, name]);
    },
    async getIssue(id) {
      this.gelesen += 1;
      return { id: String(id), labels: karte };
    },
  };
}

test("[board-1428] add setzt den Namen der Projektsprache, gleich unter welchem Namen gerufen", async () => {
  for (const [config, gerufen, erwartet] of [
    [EN, "kit:klaeren", "kit:clarify"], [EN, "kit:clarify", "kit:clarify"],
    [DE, "kit:clarify", "kit:klaeren"], [DE, "kit:geschuetzt", "kit:geschuetzt"],
    [EN, "lauf:wartet", "run:waiting"], [{}, "kit:protected", "kit:geschuetzt"],
  ]) {
    const tracker = fakeTracker();
    const ergebnis = await labelAbbilden(tracker, config, "add", "7", gerufen);
    assert.deepEqual(ergebnis, { label: erwartet }, `${gerufen} in ${config.language ?? "ohne Sprache"}`);
    assert.deepEqual(tracker.aufrufe, [["add", "7", erwartet]]);
  }
});

test("[board-1428] add faellt bei am Board fehlendem Label auf den anderen Namen zurueck, mit Hinweis", async () => {
  const tracker = fakeTracker({ amBoard: ["kit:klaeren"] });
  const ergebnis = await labelAbbilden(tracker, EN, "add", "7", "kit:klaeren");
  assert.equal(ergebnis.label, "kit:klaeren");
  assert.deepEqual(tracker.aufrufe, [["add", "7", "kit:klaeren"]]);
  assert.equal(ergebnis.hinweise.length, 1);
  assert.equal(ergebnis.hinweise[0].art, "rueckfall");
  assert.match(ergebnis.hinweise[0].meldung, /kit:clarify/);
  assert.match(ergebnis.hinweise[0].meldung, /kit:klaeren/);
});

test("[board-1428] add ohne beide Namen am Board scheitert und setzt nichts", async () => {
  const tracker = fakeTracker({ amBoard: ["fix"] });
  await assert.rejects(labelAbbilden(tracker, EN, "add", "7", "kit:clarify"), LabelFehltError);
  assert.deepEqual(tracker.aufrufe, []);
});

test("[board-1428] remove nimmt den Namen ab, den die Karte traegt, nicht den der Projektsprache", async () => {
  for (const gerufen of ["kit:klaeren", "kit:clarify"]) {
    const tracker = fakeTracker({ karte: ["kit:nightrun", "kit:klaeren"] });
    const ergebnis = await labelAbbilden(tracker, EN, "remove", "7", gerufen);
    assert.deepEqual(ergebnis, { label: "kit:klaeren" }, gerufen);
    assert.deepEqual(tracker.aufrufe, [["remove", "7", "kit:klaeren"]]);
  }
});

test("[board-1428] remove ohne einen der beiden Namen an der Karte nimmt nichts ab und meldet es", async () => {
  const tracker = fakeTracker({ karte: ["kit:nightrun"] });
  const ergebnis = await labelAbbilden(tracker, DE, "remove", "7", "kit:klaeren");
  assert.deepEqual(tracker.aufrufe, []);
  assert.equal(ergebnis.label, "kit:klaeren");
  assert.equal(ergebnis.hinweise.length, 1);
  assert.equal(ergebnis.hinweise[0].art, "nicht-getragen");
  assert.match(ergebnis.hinweise[0].meldung, /kit:klaeren.*kit:clarify/);
});

test("[board-1428] remove nimmt beide Namen ab, wenn die Karte beide traegt, mit Hinweis", async () => {
  const tracker = fakeTracker({ karte: ["kit:clarify", "kit:klaeren"] });
  const ergebnis = await labelAbbilden(tracker, EN, "remove", "7", "kit:clarify");
  assert.deepEqual(tracker.aufrufe, [["remove", "7", "kit:clarify"], ["remove", "7", "kit:klaeren"]]);
  assert.equal(ergebnis.label, "kit:clarify");
  assert.equal(ergebnis.hinweise[0].art, "beide");
});

test("[board-1428] fremde Labels und gleichnamige Kit-Labels gehen unveraendert durch, ohne die Karte zu lesen", async () => {
  for (const name of ["fix", "needs: triage", "kit:nightrun", "planreview:1"]) {
    for (const aktion of ["add", "remove"]) {
      const tracker = fakeTracker();
      assert.deepEqual(await labelAbbilden(tracker, EN, aktion, "7", name), { label: name }, `${aktion} ${name}`);
      assert.deepEqual(tracker.aufrufe, [[aktion, "7", name]]);
      assert.equal(tracker.gelesen, 0);
    }
  }
});

test("[board-1428] night.stand.labels: die Vorgabe haengt an der Projektsprache, ein gesetzter Wert gilt unveraendert", () => {
  assert.deepEqual(STAND_LABEL_VORGABEN, { laeuft: "lauf:laeuft", abgebrochen: "lauf:abgebrochen", wartet: "lauf:wartet" });
  assert.deepEqual(standLabels(DE), STAND_LABEL_VORGABEN);
  assert.deepEqual(standLabels({}), STAND_LABEL_VORGABEN);
  assert.deepEqual(standLabels(EN), { laeuft: "run:running", abgebrochen: "run:aborted", wartet: "run:waiting" });
  const gesetzt = { ...EN, night: { stand: { labels: { laeuft: "lauf:laeuft", wartet: "x:wart" } } } };
  assert.deepEqual(standLabels(gesetzt), { laeuft: "lauf:laeuft", abgebrochen: "run:aborted", wartet: "x:wart" });
});
