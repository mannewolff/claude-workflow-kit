// kit/spec.mjs bleibt eine eigenstaendig portable Datei (Issue #440).
//
// Muster: test/board-shellfrei.test.mjs — eine strukturelle Leitplanke am
// Quelltext, weil der Verstoss im Betrieb nicht auffiele. Ein Netzzugriff oder
// ein Aufruf von board.mjs funktionierte in diesem Repo tadellos und schluege
// erst dort fehl, wo die Datei allein liegt: in einem fremden Projekt, das nur
// spec.mjs kopiert hat.
//
// Kommentarzeilen bleiben draussen, bevor geprueft wird — die Begruendungen im
// Quelltext duerfen die verbotenen Namen ausdruecklich nennen, das ist ihr Sinn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPEC } from "./helpers/spec-fixture.mjs";

function ohneKommentare(quelltext) {
  return quelltext
    .split("\n")
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join("\n");
}

const QUELLE = ohneKommentare(readFileSync(SPEC, "utf-8"));

test("kit/spec.mjs greift nicht aufs Netz zu", () => {
  for (const modul of ["node:http", "node:https", "node:net"]) {
    assert.ok(!QUELLE.includes(modul),
      `${modul} hat in einer Datei nichts zu suchen, die nur specs/ liest`);
  }
  assert.doesNotMatch(QUELLE, /\bfetch\s*\(/,
    "fetch ist der Netzweg ohne Import — auch er bleibt draussen");
});

test("kit/spec.mjs ruft board.mjs nicht auf", () => {
  assert.doesNotMatch(QUELLE, /board\.mjs/,
    "spec.mjs muss ohne den Adapter auskommen: Bereiche ergeben sich allein aus den Dateien unter specs/");
});

test("kit/spec.mjs startet keine Unterprozesse", () => {
  // Ohne Netz und ohne Adapter bliebe der Kindprozess der letzte Weg nach
  // draussen — und mit ihm die Shell, die board.mjs mit Issue #196 abgeschafft hat.
  assert.doesNotMatch(QUELLE, /node:child_process/,
    "spec.mjs liest Dateien; ein Unterprozess waere ein Weg nach draussen");
});
