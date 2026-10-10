// Titel-Praefixe unter beiden Namen (Issue #1423, Plan #1420 E3, E4): Eine Karte
// `[Requirement]`, `[Idea]` oder `[Human]` wird gelesen wie `[Fachlich]`, `[Idee]` oder
// `[Mensch]` — gleich, welche Sprache das Projekt hat. Geschrieben wird noch nichts
// Englisches: Die Dokumentsaetze nennen das Praefix weiter mit seinem deutschen Namen.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { istFachlich, istPlan, istIdee, istMensch, abhaengigkeitsHinweise } from "../kit/board/dokumente.mjs";
import { stufeAusTitel } from "../kit/board/issue-review.mjs";
import { abhaengigkeitenAbhaengigkeiten, abhaengigkeitsBefund, satisfiedIds } from "../kit/night/abhaengigkeiten.mjs";

afterEach(() => abhaengigkeitenAbhaengigkeiten());

test("[board-1423] istFachlich, istIdee und istMensch erkennen beide Namen", () => {
  for (const titel of ["[Fachlich] A", "[Requirement] A", "  [requirement] A", "[FACHLICH] A"]) {
    assert.equal(istFachlich(titel), true, titel);
  }
  for (const titel of ["[Idee] A", "[Idea] A", " [idea] A"]) assert.equal(istIdee(titel), true, titel);
  for (const titel of ["[Mensch] A", "[Human] A", "[human] A"]) assert.equal(istMensch(titel), true, titel);
  assert.equal(istPlan("[Plan] A"), true);
  assert.equal(istPlan(" [plan] A"), true);
});

test("[board-1423] ein Praefix gilt nur am Titelanfang und nur fuer seine Art", () => {
  assert.equal(istFachlich("Paket zu [Requirement] X"), false);
  assert.equal(istFachlich("[Requirements] X"), false);
  assert.equal(istFachlich("[Fachplan] X"), false);
  assert.equal(istFachlich("[Idea] X"), false);
  assert.equal(istIdee("[Requirement] X"), false);
  assert.equal(istMensch("[Idea] X"), false);
  assert.equal(istPlan("[Human] X"), false);
  for (const leer of [undefined, null, ""]) {
    assert.equal(istFachlich(leer), false);
    assert.equal(istPlan(leer), false);
    assert.equal(istIdee(leer), false);
    assert.equal(istMensch(leer), false);
  }
});

test("[board-1423] stufeAusTitel liest [Requirement] wie [Fachlich]", () => {
  assert.equal(stufeAusTitel("[Fachlich] A"), "fachlich");
  assert.equal(stufeAusTitel("[Requirement] A"), "fachlich");
  assert.equal(stufeAusTitel("[Plan] A"), "plan");
  assert.equal(stufeAusTitel("[Idea] A"), "issue");
  assert.equal(stufeAusTitel("Paket"), "issue");
});

test("[board-1423] der Dokumenthinweis beim Schreiben erkennt englische Praefixe und nennt den deutschen Namen", async () => {
  const titel = { 7: "[Requirement] Anforderung", 8: "[Idea] Einfall", 9: "[Human] Schritt" };
  const tracker = { getIssue: async (id) => ({ id, title: titel[id] }) };
  const hinweise = await abhaengigkeitsHinweise("## Abhaengigkeiten\nIssue #7\nIssue #8\nIssue #9", tracker);
  const dokumente = hinweise.filter((h) => h.art === "dokument");
  assert.deepEqual(dokumente.map((h) => h.nummer), [7, 8]);
  assert.match(dokumente[0].meldung, /^#7 ist ein Dokument \(\[Fachlich\]\), kein Arbeitspaket — eine fachliche Anforderung oder Idee ist erst erledigt/);
  assert.match(dokumente[1].meldung, /^#8 ist ein Dokument \(\[Idee\]\), kein Arbeitspaket — /);
});

test("[night-1423] der Abhaengigkeitsbefund nennt fuer englische Praefixe die deutsche Dokument-Art", () => {
  const karten = [
    { id: 5, title: "[Requirement] Anforderung", body: "", status: "backlog" },
    { id: 6, title: "[Idea] Einfall", body: "", status: "backlog" },
  ];
  abhaengigkeitenAbhaengigkeiten({
    board: (...a) => (a[1] === "list" ? karten.filter((k) => k.status === a[3]) : karten.find((k) => String(k.id) === String(a[2]))),
    boardRoh: (...a) => ({ status: 0, json: karten.find((k) => String(k.id) === String(a[2])) }),
  });
  const befund = abhaengigkeitsBefund({ id: 9 }, "## Abhaengigkeiten\nIssue #5\nIssue #6", satisfiedIds());
  assert.deepEqual(befund.abhaengigkeiten.map((a) => a.dokument), ["[Fachlich]", "[Idee]"]);
});
