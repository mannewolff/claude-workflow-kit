// Die In-Process-Attrappe des Board-Adapters (Issue #1211, Plan #1199, E6).
//
// Spaetere Tests ersetzen mit ihr den Einstieg des Board-Werkzeugs als Kindprozess. Damit
// ihr Gruen etwas heisst, belegt diese Datei, dass die Attrappe antwortet wie die
// Kommandozeile, an denselben Stellen scheitert wie die Grundlagen und Unbekanntes nicht
// still beantwortet. Die Attrappe selbst importiert nichts aus kit/ (siehe dort); dass ihre
// Statuswerte und Meldungen zu den Grundlagen passen, haelt dieser Test fest.

import { test } from "node:test";
import assert from "node:assert/strict";

import { VALID_STATUSES } from "../kit/board/grundlagen.mjs";
import { boardAttrappe } from "./helpers/board-attrappe.mjs";

const KARTEN = [
  { id: 7, title: "Erste", status: "ready", labels: ["kit:nightrun"] },
  { id: 8, title: "Zweite", status: "backlog" },
  { id: 9, title: "Dritte", status: "ready", body: "## Aufgabe\nx" },
];

test("issue list liefert die Karten in Board-Reihenfolge, mit --status gefiltert", () => {
  const { board } = boardAttrappe(KARTEN);
  assert.deepEqual(board("issue", "list", "--status", "ready").map((k) => k.id), ["7", "9"]);
  assert.deepEqual(board("issue", "list").map((k) => k.id), ["7", "8", "9"]);
  assert.deepEqual(board("issue", "list", "--status", "ready")[0], { id: "7", title: "Erste", status: "ready", labels: ["kit:nightrun"] });
});

test("issue get liefert eine Kopie der Karte mit Body und Kommentaren", () => {
  const { board } = boardAttrappe(KARTEN);
  const karte = board("issue", "get", "9");
  assert.deepEqual(karte, { id: "9", title: "Dritte", body: "## Aufgabe\nx", status: "ready", labels: [], comments: [] });
  karte.labels.push("veraendert");
  assert.deepEqual(board("issue", "get", "9").labels, [], "get darf den Stand nicht nach aussen geben");
});

test("issue move zieht die Karte und scheitert an einem ungueltigen Status wie der Adapter", () => {
  const { board, karten } = boardAttrappe(KARTEN);
  assert.deepEqual(board("issue", "move", "7", "in_progress"), { ok: true, id: "7", status: "in_progress" });
  assert.equal(karten[0].status, "in_progress");
  assert.throws(() => board("issue", "move", "7", "fertig"),
    { message: `Ungueltiger Status 'fertig'. Gueltig: ${VALID_STATUSES.join(", ")}` });
});

test("die Attrappe kennt genau die Statuswerte der Grundlagen", () => {
  const { board } = boardAttrappe([{ id: 1 }]);
  for (const status of VALID_STATUSES) assert.equal(board("issue", "move", "1", status).status, status);
});

test("issue comment haengt den Text mit der injizierten Uhr an", () => {
  const { board } = boardAttrappe(KARTEN, { jetzt: () => new Date("2026-10-05T12:00:00Z") });
  assert.deepEqual(board("issue", "comment", "8", "--text", "## Laufstand\nlaeuft"), { ok: true, id: "8" });
  assert.deepEqual(board("issue", "get", "8").comments, [
    { author: "attrappe", body: "## Laufstand\nlaeuft", createdAt: "2026-10-05T12:00:00.000Z", id: "1" },
  ]);
  assert.throws(() => board("issue", "comment", "8", "--text-file", "bericht.md"), /kennt nur/);
});

test("issue label add und remove zeichnen die Karte, doppelt Gesetztes bleibt einmal", () => {
  const { board } = boardAttrappe(KARTEN);
  board("issue", "label", "add", "8", "kit:klaeren");
  board("issue", "label", "add", "8", "kit:klaeren");
  assert.deepEqual(board("issue", "get", "8").labels, ["kit:klaeren"]);
  assert.deepEqual(board("issue", "label", "remove", "8", "kit:klaeren"), { ok: true, id: "8", label: "kit:klaeren", aktion: "remove" });
  assert.deepEqual(board("issue", "get", "8").labels, []);
  assert.throws(() => board("issue", "label", "setze", "8", "x"), /Unbekannter label-Befehl/);
});

test("eine unbekannte Karte und ein unbekannter Befehl scheitern laut", () => {
  const { board, aufrufe } = boardAttrappe(KARTEN);
  assert.throws(() => board("issue", "get", "99"), /Issue #99 nicht gefunden/);
  assert.throws(() => board("issue", "melden", "7"), /kennt 'issue melden' nicht/);
  assert.throws(() => board("code", "repo-name"), /kennt 'code repo-name' nicht/);
  assert.deepEqual(aufrufe, [["issue", "get", "99"], ["issue", "melden", "7"], ["code", "repo-name"]]);
});
