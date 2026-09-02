// `spec.mjs show <id>` — die Auskunft zu einer einzelnen Aussage (Issue #440).
//
// Alle Fehlerpfade enden mit leerem stdout. Der Grund ist die Verwendung: Wer
// `show` in einer Pipeline oder einem Skript liest, darf eine Fehlermeldung nie
// fuer eine Aussage halten. Also entweder eine Aussage auf stdout und Exit 0 —
// oder nichts auf stdout und Exit ungleich 0.
//
// Eine mehrfach vergebene ID ist hier ausdruecklich ein Abbruch und keine Auswahl:
// Welche der beiden Fundstellen gilt, entscheidet `check` (Ausbaustufe 2). Wuerde
// `show` eine davon ausgeben, verschwiege es genau den Widerspruch, den es sieht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitFixture, spec } from "./helpers/spec-fixture.mjs";

test("show findet eine gueltige Aussage und nennt Bereich und Status", () => {
  mitFixture("zwei-bereiche", (dir) => {
    const res = spec(dir, "show", "alpha-2");

    assert.equal(res.status, 0, `show schlug fehl: ${res.stderr}`);
    assert.match(res.stdout, /Ein leeres Paket wird als solches benannt\./, "die Aussage fehlt");
    assert.match(res.stdout, /alpha/, "der Bereich fehlt");
    assert.match(res.stdout, /gueltig/, "der Status fehlt");
    assert.doesNotMatch(res.stdout, /entfallen/, "eine gueltige Aussage darf nicht als entfallen gelten");
  });
});

test("show findet eine Aussage im Bereich ohne Abschnitt 'Entfallen'", () => {
  mitFixture("zwei-bereiche", (dir) => {
    const res = spec(dir, "show", "beta-1");

    assert.equal(res.status, 0, `show schlug fehl: ${res.stderr}`);
    assert.match(res.stdout, /Die Auskunft antwortet auch ohne Config\./);
    assert.match(res.stdout, /gueltig/);
  });
});

test("show nennt eine entfallene Aussage samt Datum und Paketnummer", () => {
  mitFixture("zwei-bereiche", (dir) => {
    const res = spec(dir, "show", "alpha-4");

    assert.equal(res.status, 0, `show schlug fehl: ${res.stderr}`);
    assert.match(res.stdout, /entfallen/, "der Status fehlt");
    assert.match(res.stdout, /2026-08-14/, "das Datum fehlt");
    assert.match(res.stdout, /123/, "die Paketnummer fehlt");
    assert.match(res.stdout, /Der Lauf schrieb frueher ein Protokoll je Session\./, "die Aussage fehlt");
  });
});

test("show auf eine nie vergebene ID: Exit 1, leeres stdout", () => {
  mitFixture("zwei-bereiche", (dir) => {
    const res = spec(dir, "show", "alpha-99");

    assert.equal(res.status, 1, "eine unbekannte ID haette rot enden muessen");
    assert.equal(res.stdout, "", `stdout haette leer bleiben muessen: ${JSON.stringify(res.stdout)}`);
    assert.match(res.stderr, /alpha-99/, "die Meldung nennt die gesuchte ID nicht");
  });
});

test("show ohne specs/: Exit 1, leeres stdout", () => {
  mitFixture(null, (dir) => {
    const res = spec(dir, "show", "alpha-1");

    assert.equal(res.status, 1, "ohne specs/ haette show rot enden muessen");
    assert.equal(res.stdout, "", `stdout haette leer bleiben muessen: ${JSON.stringify(res.stdout)}`);
    assert.match(res.stderr, /specs/, "die Meldung nennt das fehlende Verzeichnis nicht");
  });
});

test("show ohne Argument: Exit 1, leeres stdout", () => {
  mitFixture("zwei-bereiche", (dir) => {
    const res = spec(dir, "show");

    assert.equal(res.status, 1, "ohne ID haette show rot enden muessen");
    assert.equal(res.stdout, "", `stdout haette leer bleiben muessen: ${JSON.stringify(res.stdout)}`);
    assert.match(res.stderr, /ID/, "die Meldung sagt nicht, was fehlt");
  });
});

test("dieselbe ID in zwei Bereichsdateien: Exit 1, beide Fundstellen benannt", () => {
  mitFixture("doppelte", (dir) => {
    const res = spec(dir, "show", "gemeinsam-1");

    assert.equal(res.status, 1, "eine mehrfach vergebene ID haette rot enden muessen");
    assert.equal(res.stdout, "", `stdout haette leer bleiben muessen: ${JSON.stringify(res.stdout)}`);
    assert.match(res.stderr, /eins\.md/, "die erste Fundstelle fehlt");
    assert.match(res.stderr, /zwei\.md/, "die zweite Fundstelle fehlt");
  });
});

test("dieselbe ID gueltig und entfallen zugleich: Exit 1, beide Fundstellen benannt", () => {
  mitFixture("doppelte", (dir) => {
    const res = spec(dir, "show", "beides-1");

    assert.equal(res.status, 1, "gueltig und entfallen zugleich haette rot enden muessen");
    assert.equal(res.stdout, "", `stdout haette leer bleiben muessen: ${JSON.stringify(res.stdout)}`);
    // Zweimal dieselbe Datei — die Fundstellen unterscheiden sich nur in der Zeile,
    // und ohne Zeilennummer waere die Meldung nicht aufloesbar.
    assert.match(res.stderr, /beides\.md:3\b/, "die gueltige Fundstelle fehlt");
    assert.match(res.stderr, /beides\.md:7\b/, "die entfallene Fundstelle fehlt");
  });
});
