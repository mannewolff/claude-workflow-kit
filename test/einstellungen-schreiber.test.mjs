// Der Schreiber von kit/einstellungen.mjs (Issue #676, Plan #674 E7).
//
// Wer nach dem Speichern `git diff` liest, soll nur die geänderten Werte sehen — keine
// umsortierte oder neu formatierte Datei (Fachplan #671).

import { test } from "node:test";
import assert from "node:assert/strict";

import { schreibeJson } from "../kit/einstellungen.mjs";

const ZWEI = `{
  "codeHost": "github",
  "buildChecks": [
    "node --test",
    "npx eslint ."
  ],
  "night": {
    "kette": {
      "planMin": 30
    }
  },
  "erfunden": { "a": 1 }
}
`;
const TABS = '{\n\t"codeHost": "github",\n\t"night": {\n\t\t"modelle": ["claude-opus-5"]\n\t}\n}\n';
const KOMPAKT = '{\n  "buildChecks": ["node --test", "npx eslint ."],\n  "mainBranch": "main"\n}\n';

const geaenderteZeilen = (a, b) => {
  const x = a.split("\n");
  const y = b.split("\n");
  assert.equal(x.length, y.length, "die Zeilenzahl hat sich geändert");
  return x.map((z, i) => (z === y[i] ? null : i)).filter((i) => i !== null);
};

test("[einstellungen-2] eine unveränderte Datei bleibt bytegleich — zwei Leerzeichen, Tabs, kompakte Liste", () => {
  for (const text of [ZWEI, TABS, KOMPAKT]) {
    assert.equal(schreibeJson(text, JSON.parse(text)), text);
  }
});

test("[einstellungen-2] ein geänderter einfacher Wert ändert genau eine Zeile", () => {
  const neu = JSON.parse(ZWEI);
  neu.night.kette.planMin = 45;
  const text = schreibeJson(ZWEI, neu);
  assert.deepEqual(geaenderteZeilen(ZWEI, text), [8]);
  assert.deepEqual(JSON.parse(text), neu);
  const tabs = JSON.parse(TABS);
  tabs.codeHost = "gitlab";
  assert.deepEqual(geaenderteZeilen(TABS, schreibeJson(TABS, tabs)), [1]);
});

test("[einstellungen-2] eine geänderte Liste ersetzt genau ihren Wertebereich mit erkannter Einrückung", () => {
  const neu = JSON.parse(ZWEI);
  neu.buildChecks = ["node --test"];
  const text = schreibeJson(ZWEI, neu);
  assert.deepEqual(JSON.parse(text), neu);
  assert.ok(text.startsWith('{\n  "codeHost": "github",\n  "buildChecks": [\n    "node --test"\n  ],\n  "night"'), text);
  const kompakt = JSON.parse(KOMPAKT);
  kompakt.buildChecks.push("x");
  const k = schreibeJson(KOMPAKT, kompakt);
  assert.deepEqual(JSON.parse(k), kompakt);
  assert.ok(k.endsWith('  "mainBranch": "main"\n}\n'), "der Rest der Datei bleibt stehen");
});

test("[einstellungen-2] neuer und entfernter Schlüssel ergeben gültiges JSON mit erkannter Einrückung", () => {
  const neu = JSON.parse(ZWEI);
  neu.night.kette.reviewMin = 20;
  neu.mainBranch = "main";
  delete neu.codeHost;
  const text = schreibeJson(ZWEI, neu);
  assert.deepEqual(JSON.parse(text), neu);
  assert.match(text, /\n {6}"reviewMin": 20\n/);
  assert.match(text, /\n {2}"mainBranch": "main"\n\}\n$/);
  assert.doesNotMatch(text, /codeHost/);
  const leer = schreibeJson("{}\n", { a: { b: 1 } });
  assert.deepEqual(JSON.parse(leer), { a: { b: 1 } });
  const tabs = JSON.parse(TABS);
  tabs.night.kette = { planMin: 1 };
  assert.match(schreibeJson(TABS, tabs), /\n\t\t"kette": \{\n\t\t\t"planMin": 1\n\t\t\}\n/);
  const alles = schreibeJson(ZWEI, {});
  assert.deepEqual(JSON.parse(alles), {});
});

test("[einstellungen-2] unbekannte Felder bleiben unverändert erhalten", () => {
  const neu = JSON.parse(ZWEI);
  neu.codeHost = "local";
  assert.match(schreibeJson(ZWEI, neu), /\n {2}"erfunden": \{ "a": 1 \}\n/);
});

test("[einstellungen-2] mehrere entfernte Glieder hintereinander überlappen sich nicht", () => {
  const text = '{\n  "a": 1,\n  "b": 2,\n  "c": 3,\n  "d": 4\n}\n';
  for (const neu of [{ c: 3, d: 4 }, { a: 1, d: 4 }, { a: 1, b: 2 }, { b: 2 }, { e: 5 }, { a: 1, e: 5 }]) {
    const ergebnis = schreibeJson(text, neu);
    assert.deepEqual(JSON.parse(ergebnis), neu, `falsch fuer ${JSON.stringify(neu)}: ${ergebnis}`);
  }
});
