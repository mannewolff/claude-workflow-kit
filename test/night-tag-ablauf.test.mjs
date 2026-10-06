// Der Prueflauf am Tag im selben Prozess (Fachplan #899, Plan #904; Issue #909, #1234).
//
// `laufePrueflauf` aus dem Teil kit/night/tag.mjs, gefahren mit injizierten Abhaengigkeiten
// statt des Runners als Kindprozess (Plan #1199, E6). Fuenf gekennzeichnete fachliche
// Anforderungen gehen hinein, eine gekennzeichnete Plan-Karte wird uebersprungen. Geprueft
// werden Labels, Vermerk, Einheiten, die Liste auf stdout und der Worktree des Laufs. Was nur
// der echte Runner zeigt — echter Worktree, unberuehrte Hauptkopie, Aufruf —, steht in
// `ablauf-night-tag-ablauf.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { KLAEREN_LABEL } from "../kit/night/wartend.mjs";
import { REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { PRUEFLAUF_BEFUNDE_ANKER, PRUEFLAUF_REST_ANKER, pruefLaufFassung } from "../kit/night/tag.mjs";
import { kommentareVon } from "../kit/night/bericht.mjs";
import {
  BUDGET, FACHPLAN_MARKER, PRUEF_LABEL, PRUEFUNG_FRAGE, jeKarte, pruefKarte, pruefLaufImProzess,
  pruefungBefunde, pruefungGeprueft, pruefungHalt,
} from "./helpers/tag-fixture.mjs";
import { planKarte } from "./helpers/kette-fixture.mjs";
import { fachplanBody } from "./helpers/kette-texte.mjs";

/**
 * Die sechs Karten des Durchlaufs, in der Reihenfolge des Boards.
 *
 * Vier fachliche Anforderungen decken die vier Ausgaenge ab, die eine Session haben kann; die
 * fuenfte traegt Marker, `review:fertig` und einen Befunde-Kommentar schon aus einem Vorlauf
 * (E16). Die Plan-Karte gehoert nicht in den Prueflauf und wird uebersprungen.
 */
function karten() {
  const vorlauf = pruefKarte(4, { titel: "[Fachlich] Schon geprueft", labels: [PRUEF_LABEL, REVIEW_FERTIG_LABEL], body: fachplanBody({ marker: FACHPLAN_MARKER }) });
  vorlauf.comments = [{ body: `${PRUEFLAUF_BEFUNDE_ANKER}\n\n- Fund 1 (opus, HINWEIS): aus dem Vorlauf.` }];
  return [
    pruefKarte(1, { titel: "[Fachlich] Vollstaendig geprueft" }),
    pruefKarte(2, { titel: "[Fachlich] Mit wartender Entscheidung" }),
    pruefKarte(3, { titel: "[Fachlich] Ohne jede Spur" }),
    vorlauf,
    pruefKarte(5, { titel: "[Fachlich] Nur Befunde" }),
    planKarte(6, 1, { labels: [PRUEF_LABEL] }),
  ];
}

/** Drei Karten tun etwas, zwei tun nichts. */
const SITZUNG = jeKarte({ 1: pruefungGeprueft, 2: pruefungHalt, 5: pruefungBefunde });

test("[night-909] ein Prueflauf ohne --max prueft alle gekennzeichneten Karten", async () => {
  const anfang = karten();
  const fassungen = Object.fromEntries(anfang.map((k) => [k.id, pruefLaufFassung(k.body)]));
  const r = await pruefLaufImProzess({ karten: anfang, sitzung: SITZUNG });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.abschluss, ["regulaer"]);

  // --- Die Karten am Board ---
  for (const id of ["1", "2", "3", "4", "5"]) {
    assert.ok(!r.karte(id).labels.includes(PRUEF_LABEL), `#${id}: das Kennzeichen muss mit dem Start verbraucht sein`);
  }
  assert.ok(r.karte("6").labels.includes(PRUEF_LABEL), "die uebersprungene Karte behaelt ihr Kennzeichen");
  assert.ok(r.karte("1").labels.includes(REVIEW_FERTIG_LABEL), "die gepruefte Karte traegt review:fertig");
  assert.ok(r.karte("1").body.split("\n").includes(FACHPLAN_MARKER), "der Marker steht als eigene Zeile im Kopf");
  assert.ok(r.karte("2").labels.includes(KLAEREN_LABEL), "die angehaltene Karte traegt kit:klaeren");
  // E16: die Karte aus dem Vorlauf hat ihr `review:fertig` verloren und keins bekommen.
  assert.ok(!r.karte("4").labels.includes(REVIEW_FERTIG_LABEL),
    "der Lauf nimmt review:fertig vor der Session ab und die Session setzt es nicht neu");

  // --- Der Vermerk-Kommentar ---
  assert.ok(kommentareVon(r.karte("5")).some((k) => k.includes(PRUEFLAUF_REST_ANKER)),
    "eine Pruefung mit Spur, die nicht fertig wurde, bekommt den Vermerk");
  assert.ok(!kommentareVon(r.karte("3")).some((k) => k.includes(PRUEFLAUF_REST_ANKER)),
    "ohne jede neue Spur gibt es nichts zu vermerken");

  // --- Die Einheiten ---
  const einheit = (id) => r.lauf.einheiten.find((e) => e.id === id);
  assert.equal(einheit("1").ausgang, "geprueft");
  assert.equal(einheit("1").fassung, fassungen["1"], "die gepruefte Fassung steht an der Einheit");
  assert.equal(einheit("1").art, "pruefung");
  assert.equal(einheit("2").ausgang, "klaeren");
  assert.match(einheit("2").frage, /Welche der beiden Zielgruppen/);
  assert.equal(einheit("3").ausgang, "unvollstaendig");
  assert.equal(einheit("3").schritt, "gestartet");
  assert.equal(einheit("4").ausgang, "unvollstaendig", "E16: alte Spuren sind keine neuen");
  assert.equal(einheit("4").schritt, "gestartet");
  assert.equal(einheit("5").ausgang, "unvollstaendig");
  assert.equal(einheit("5").schritt, "befunde");
  assert.equal(einheit("6").ausgang, "uebersprungen");
  assert.match(einheit("6").grund, /\[Plan\]/);
  assert.equal(einheit("1").kostenUsd, 1, "eine Session je Karte zu 1 $");
  assert.equal(r.lauf.kostenSumme, 5, "fuenf Sessions");

  // --- Die Liste auf stdout ---
  assert.match(r.ausgabe, new RegExp(`#1 .*-> Pruefung 1/5 \\(Fassung ${fassungen["1"]}\\)`));
  assert.match(r.ausgabe, /Ergebnisliste des Prueflaufs:/);
  assert.match(r.ausgabe, new RegExp(`#1 .*: geprueft, Fassung ${fassungen["1"]}`));
  assert.match(r.ausgabe, new RegExp(`#2 .*: wartende Entscheidung, .*Frage: ${PRUEFUNG_FRAGE}`));
  assert.match(r.ausgabe, /#3 .*: unvollstaendig, .*erreichter Schritt: gestartet/);
  assert.match(r.ausgabe, /#6 .*: uebersprungen — /);
  assert.match(r.ausgabe, /Prueflauf beendet: 1 geprueft, 1 mit wartender Entscheidung, 3 unvollstaendig, 1 uebersprungen, 0 liegengeblieben\./);

  // --- Sessions und Worktree ---
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["pruefung", "pruefung", "pruefung", "pruefung", "pruefung"]);
  assert.deepEqual(r.sitzungen.map((s) => s.issue), ["1", "2", "3", "4", "5"]);
  assert.match(r.sitzungen[0].prompt, /^\/issue-review #1\n/);
  const wt = new Set(r.sitzungen.map((s) => s.cwd));
  assert.equal(wt.size, 1, "ein Worktree je LAUF, nicht je Karte (E11)");
  const angelegt = r.gitAufrufe.filter((a) => a.args[0] === "worktree" && a.args[1] === "add");
  const entfernt = r.gitAufrufe.filter((a) => a.args[0] === "worktree" && a.args[1] === "remove");
  assert.equal(angelegt.length, 1);
  assert.equal(entfernt.length, 1, "der Worktree wird am Ende entfernt");
  assert.ok(entfernt[0].args.at(-1).includes("pruefung-"), "der Worktree traegt den Praefix des Prueflaufs");
  assert.deepEqual(r.vorflug.kandidaten, ["1", "2", "3", "4", "5"], "der Vorflug sieht genau die Kandidaten");
});

test("[night-909] ist das Kostenbudget erschoepft, gelten die restlichen Karten als uebersprungen und behalten ihr Kennzeichen", async () => {
  // 1,50 $ je Session: Nach der ersten ist der Deckel von 2 $ noch nicht gerissen, nach der
  // zweiten schon — geprueft wird NACH jeder Session, nie mittendrin.
  const sitzung = (s) => ({ ...SITZUNG(s), kosten: 1.5 });
  const r = await pruefLaufImProzess({ karten: karten(), sitzung, budget: { ...BUDGET, kostenUsd: 2 } });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = (id) => r.lauf.einheiten.find((e) => e.id === id);
  assert.equal(einheit("1").ausgang, "geprueft", "die erste Karte lief noch");
  assert.equal(einheit("2").ausgang, "klaeren", "die zweite Karte lief noch");
  for (const id of ["3", "4", "5"]) {
    assert.equal(einheit(id).ausgang, "uebersprungen");
    assert.match(einheit(id).grund, /Kostenbudget: 3\.00 \$ von 2 \$/);
    assert.ok(r.karte(id).labels.includes(PRUEF_LABEL), `#${id}: eine wegen der Kosten uebersprungene Karte behaelt ihr Kennzeichen`);
  }
  assert.equal(r.sitzungen.length, 2, "nach dem Deckel startet keine Session mehr");
  assert.match(r.ausgabe, /Kostenbudget: 3\.00 \$ von 2 \$/);
});

test("[night-909] ein gescheiterter Vorflug kommentiert jeden Kandidaten, das Kennzeichen bleibt", async () => {
  const r = await pruefLaufImProzess({ karten: [pruefKarte(1), pruefKarte(2)], vorflug: "Reviewer fehlt" });
  assert.equal(r.code, 1);
  assert.equal(r.sitzungen.length, 0, "es lief keine Session");
  for (const id of ["1", "2"]) {
    assert.ok(kommentareVon(r.karte(id)).includes("Pruefung nicht gestartet: Reviewer fehlt"), `#${id}`);
    assert.ok(r.karte(id).labels.includes(PRUEF_LABEL), `#${id}: das Kennzeichen bleibt`);
  }
});

test("[night-909] ohne gekennzeichnete Karte endet der Lauf regulaer und sagt, was vorhanden ist", async () => {
  const r = await pruefLaufImProzess({ karten: [pruefKarte(1, { labels: ["kit:anderes"] })] });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.abschluss, ["regulaer"]);
  assert.equal(r.sitzungen.length, 0);
  assert.match(r.ausgabe, /keine Karte traegt das Label 'kit:pruefen'/);
  assert.match(r.ausgabe, /Vorhandene Labels: kit:anderes/);
});

test("[night-909] ueber --max bleiben Karten liegen und behalten ihr Kennzeichen", async () => {
  const r = await pruefLaufImProzess({ karten: [pruefKarte(1), pruefKarte(2)], argv: ["--max", "1"], sitzung: jeKarte({ 1: pruefungGeprueft }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(r.sitzungen.length, 1);
  assert.equal(r.lauf.einheiten.find((e) => e.id === "2").ausgang, "liegengeblieben");
  assert.ok(r.karte("2").labels.includes(PRUEF_LABEL));
  assert.match(r.ausgabe, /0 uebersprungen, 1 liegengeblieben\./);
});
