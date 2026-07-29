// Kommentare in `issue get` (Issue kanban-kit#449).
//
// Damit /plan #N und andere Skills den Verlauf eines Issues sehen (Abschluss-
// berichte, /review-Befunde), liefert getIssue jetzt ein `comments`-Array.
// Die drei Tracker liefern drei verschiedene Formen — GitHub `author.login` +
// `createdAt`, GitLab `author.username` + `created_at` (plus System-Notes, die
// keine echten Kommentare sind), kanbancompat `author` als fertiger String.
// normalizeComments vereinheitlicht das, analog zu labelNamesFrom (#158).
//
// Abgrenzung: Die fachliche PO-Verhandlung bleibt im Body (siehe #155).
// Kommentare tragen Verlauf und Berichte, nicht die Verhandlung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeComments } from "../kit/board.mjs";

test("GitHub-Form: author.login und createdAt werden gemappt", () => {
  const raw = [
    { author: { login: "mannewolff" }, body: "Erster Kommentar", createdAt: "2026-07-28T09:00:00Z" },
  ];
  assert.deepEqual(normalizeComments(raw), [
    { author: "mannewolff", body: "Erster Kommentar", createdAt: "2026-07-28T09:00:00Z" },
  ]);
});

test("GitLab-Form: author.username und created_at werden gemappt", () => {
  const raw = [
    { author: { username: "manne" }, body: "Notiz", created_at: "2026-07-28T10:00:00Z" },
  ];
  assert.deepEqual(normalizeComments(raw), [
    { author: "manne", body: "Notiz", createdAt: "2026-07-28T10:00:00Z" },
  ]);
});

test("GitLab-System-Notes werden gefiltert (keine echten Kommentare)", () => {
  const raw = [
    { author: { username: "manne" }, body: "echter Kommentar", created_at: "2026-07-28T10:00:00Z" },
    { author: { username: "manne" }, body: "changed the description", created_at: "2026-07-28T10:01:00Z", system: true },
  ];
  const result = normalizeComments(raw);
  assert.equal(result.length, 1, "System-Note haette gefiltert werden muessen");
  assert.equal(result[0].body, "echter Kommentar");
});

test("kanbancompat-Form: author ist bereits ein String", () => {
  const raw = [{ author: "Manfred Wolff", body: "Abschlussbericht", createdAt: "2026-07-28T11:00:00Z" }];
  assert.deepEqual(normalizeComments(raw), [
    { author: "Manfred Wolff", body: "Abschlussbericht", createdAt: "2026-07-28T11:00:00Z" },
  ]);
});

test("Reihenfolge bleibt erhalten (chronologischer Verlauf)", () => {
  const raw = [
    { author: "a", body: "eins", createdAt: "2026-07-28T09:00:00Z" },
    { author: "b", body: "zwei", createdAt: "2026-07-28T10:00:00Z" },
    { author: "c", body: "drei", createdAt: "2026-07-28T11:00:00Z" },
  ];
  assert.deepEqual(normalizeComments(raw).map((c) => c.body), ["eins", "zwei", "drei"]);
});

test("leeres Array bleibt leer", () => {
  assert.deepEqual(normalizeComments([]), []);
});

test("fehlendes Feld (undefined/null) ergibt ein leeres Array", () => {
  assert.deepEqual(normalizeComments(undefined), []);
  assert.deepEqual(normalizeComments(null), []);
});

test("Fehlform (kein Array) ergibt ein leeres Array", () => {
  assert.deepEqual(normalizeComments("kaputt"), []);
  assert.deepEqual(normalizeComments({ body: "kein Array" }), []);
  assert.deepEqual(normalizeComments(42), []);
});

test("null-Elemente werden gefiltert", () => {
  const raw = [null, { author: "a", body: "echt", createdAt: "2026-07-28T09:00:00Z" }, undefined];
  const result = normalizeComments(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].body, "echt");
});

test("fehlende Einzelfelder werden zu leeren Strings, nicht zu undefined", () => {
  const raw = [{ body: "nur Text" }];
  assert.deepEqual(normalizeComments(raw), [{ author: "", body: "nur Text", createdAt: "" }]);
});

test("Kommentar ohne Body wird gefiltert (nichts zu zeigen)", () => {
  const raw = [
    { author: "a", body: "", createdAt: "2026-07-28T09:00:00Z" },
    { author: "b", body: "hat Inhalt", createdAt: "2026-07-28T10:00:00Z" },
  ];
  const result = normalizeComments(raw);
  assert.equal(result.length, 1, "leerer Body haette gefiltert werden muessen");
  assert.equal(result[0].author, "b");
});

test("author-Objekt ohne login/username faellt auf leeren String zurueck", () => {
  const raw = [{ author: { id: 7 }, body: "Text", createdAt: "2026-07-28T09:00:00Z" }];
  assert.deepEqual(normalizeComments(raw), [{ author: "", body: "Text", createdAt: "2026-07-28T09:00:00Z" }]);
});
