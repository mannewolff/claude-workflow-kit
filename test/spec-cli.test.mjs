// Die Kommandozeile von kit/spec.mjs (Issue #440).
//
// Zwei Ausgaenge, die auseinandergehalten werden muessen: Ein Aufruf ohne
// Argument ist eine Frage ("was kann das Ding?") und wird mit der Hilfe und
// Exit 0 beantwortet — dasselbe Muster wie checks.mjs. Ein unbekanntes Kommando
// ist ein Irrtum und muss rot enden; ginge es gruen durch, saehe ein Vertipper
// in einem Skript wie ein erledigter Lauf aus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitFixture, spec } from "./helpers/spec-fixture.mjs";

test("ohne Argument: Hilfe auf stdout, Exit 0", () => {
  mitFixture(null, (dir) => {
    const res = spec(dir);

    assert.equal(res.status, 0, `Aufruf ohne Argument haette gruen enden muessen: ${res.stderr}`);
    assert.match(res.stdout, /\bindex\b/, "die Hilfe nennt 'index' nicht");
    assert.match(res.stdout, /\bshow\b/, "die Hilfe nennt 'show' nicht");
    assert.match(res.stdout, /--version/, "die Hilfe nennt '--version' nicht");
  });
});

for (const flag of ["--help", "-h"]) {
  test(`${flag}: dieselbe Hilfe, Exit 0`, () => {
    mitFixture(null, (dir) => {
      const res = spec(dir, flag);

      assert.equal(res.status, 0, `${flag} haette gruen enden muessen: ${res.stderr}`);
      assert.equal(res.stdout, spec(dir).stdout, `${flag} zeigt eine andere Hilfe als der Aufruf ohne Argument`);
    });
  });
}

test("unbekanntes Kommando: Exit 1 und ein Verweis auf --help", () => {
  mitFixture(null, (dir) => {
    const res = spec(dir, "aufraeumen");

    assert.equal(res.status, 1, "ein unbekanntes Kommando haette rot enden muessen");
    assert.match(res.stderr, /aufraeumen/, "die Meldung nennt das unbekannte Kommando nicht");
    assert.match(res.stderr, /--help/, "die Meldung verweist nicht auf --help");
  });
});
