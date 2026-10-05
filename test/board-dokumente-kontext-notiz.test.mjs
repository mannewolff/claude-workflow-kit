// Die reine Auswahl der Projektnotiz (Issue #286), im selben Prozess gegen den Board-Teil
// dokumente (Issue #1218, Plan #1199, E18). Den Dateisystem-Zugriff ueber den CLI-Mantel prueft
// test/ablauf-board-dokumente-kontext-notiz.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pickNoteFile } from "../kit/board/dokumente.mjs";

// --- pickNoteFile: die reine Auswahl ---

test("pickNoteFile: genau eine .md im Ordner ist die Notiz, egal wie sie heisst", () => {
  assert.deepEqual(pickNoteFile(["Shell-App.md"], "shell-app.md"), { name: "Shell-App.md", kollision: null });
});

test("pickNoteFile: keine .md -> kein Name (Erstanlage)", () => {
  assert.deepEqual(pickNoteFile([], "shell-app.md"), { name: null, kollision: null });
  assert.deepEqual(pickNoteFile(["notiz.txt", "bild.png"], "shell-app.md"), { name: null, kollision: null });
});

test("pickNoteFile: bei mehreren zaehlt der case-insensitiv passende Name", () => {
  const dateien = ["Board-App.md", "Shell-App.md", "Users-App.md"];
  assert.equal(pickNoteFile(dateien, "shell-app.md").name, "Shell-App.md");
});

test("pickNoteFile: mehrere Dateien, keine passt -> kein Name", () => {
  assert.deepEqual(
    pickNoteFile(["Board-App.md", "Users-App.md"], "shell-app.md"),
    { name: null, kollision: null },
  );
});

// Zwei Dateien, die sich nur in der Gross-/Kleinschreibung unterscheiden: Welche
// gemeint ist, kann das Werkzeug nicht wissen. Ein stiller Griff ins Ungewisse waere
// genau der Fehler, den dieses Issue behebt.
test("pickNoteFile: zwei case-insensitiv passende Namen sind eine Kollision", () => {
  const ergebnis = pickNoteFile(["Shell-App.md", "shell-app.md"], "shell-app.md");
  assert.equal(ergebnis.name, null);
  assert.deepEqual(ergebnis.kollision, ["Shell-App.md", "shell-app.md"]);
});

// Im Multi-Repo-Fall teilen sich Dach- und Service-Notiz EIN Verzeichnis. Die
// Kulanzregel "die einzige Datei ist es" wuerde beide auf dieselbe Datei zeigen
// lassen — und /document schriebe den Service-Stand in die Dach-Notiz.
test("pickNoteFile: im geteilten Ordner greift die Einzeldatei-Regel nicht", () => {
  assert.deepEqual(
    pickNoteFile(["Shell-App.md"], "mini-jira.md", { alleinstehend: false }),
    { name: null, kollision: null },
  );
  assert.equal(
    pickNoteFile(["Shell-App.md"], "shell-app.md", { alleinstehend: false }).name,
    "Shell-App.md",
  );
});

test("pickNoteFile: Endungen werden case-insensitiv erkannt", () => {
  assert.equal(pickNoteFile(["Shell-App.MD"], "shell-app.md").name, "Shell-App.MD");
});
