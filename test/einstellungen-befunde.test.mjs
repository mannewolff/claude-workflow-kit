// Der optionale Block `befunde` in der Konfigurationspruefung (Issue #800,
// Plan #797, fachliche Quelle #768).
//
// Die Schwelle sagt, ab wie vielen Vorkommen aus wiederkehrenden Funden ein
// Vorschlag entsteht. Sie steht in einem eigenen Wurzelblock und nicht unter
// `issueReview`, weil sie auch fuer den Code-Review gilt, der dort nicht haengt.
//
// Geprueft wird dasselbe wie beim Muster `wirksamkeit` (einstellungen-17): der
// Wertebereich mit Pfad, die Gueltigkeit einer Konfiguration ohne den Block, der
// eigene Teil im Thema Review statt der Anzeige in Dateischreibweise und die
// Teamweit-Formel — `befunde` steht nicht in der Allowlist der persoenlichen Datei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  aenderungAnwenden, pruefe, pruefeSchema, teilFuer, THEMEN, vorgabeAus,
} from "../kit/einstellungen.mjs";

const fehler = (befunde) => befunde.filter((b) => b.art === "fehler");

/** Eine Config, die ohne den geprueften Block fehlerfrei durchlaeuft. */
const BASIS = { codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5" };

const befundeAmPfad = (wert) =>
  fehler(pruefeSchema({ befunde: { schwelle: wert } })).filter((b) => b.pfad === "befunde.schwelle");

test("[einstellungen-18] befunde.schwelle ist eine ganze Zahl ueber null mit der Vorgabe drei", () => {
  assert.equal(vorgabeAus("befunde.schwelle"), 3);
});

test("[einstellungen-18] eine schwelle ausserhalb der ganzen Zahlen ueber null wird mit Pfad abgewiesen", () => {
  for (const schlecht of [0, -1, 2.5, "drei"]) {
    assert.ok(befundeAmPfad(schlecht).length > 0, `schwelle=${JSON.stringify(schlecht)} nicht abgewiesen`);
  }
  for (const gut of [1, 3, 5]) {
    assert.deepEqual(befundeAmPfad(gut), [], `schwelle=${gut}`);
  }
});

test("[einstellungen-18] eine Config mit befunde.schwelle 5 ist gueltig und gilt als bekannt", () => {
  const befunde = pruefe({ ...BASIS, befunde: { schwelle: 5 } }, null);
  assert.deepEqual(fehler(befunde), []);
  assert.deepEqual(befunde.filter((b) => b.art === "unbekannt" && String(b.pfad).startsWith("befunde")), []);
});

test("[einstellungen-18] eine Config ohne den Block befunde ist gueltig", () => {
  assert.deepEqual(fehler(pruefe(BASIS, null)), []);
});

test("[einstellungen-18] die echte workflow.config.json dieses Repos bleibt ohne den Block gueltig", () => {
  const pfad = fileURLToPath(new URL("../.claude/workflow.config.json", import.meta.url));
  const config = JSON.parse(readFileSync(pfad, "utf8"));
  assert.equal(config.befunde, undefined, "die echte Config traegt den Block bereits");
  assert.deepEqual(fehler(pruefe(config, null)), []);
});

test("[einstellungen-18] ein unbekanntes Feld in befunde wird mit Pfad abgewiesen", () => {
  const befunde = pruefeSchema({ befunde: { erfunden: 1 } });
  assert.ok(befunde.some((b) => b.art === "unbekannt" && b.pfad === "befunde.erfunden"));
});

test("[einstellungen-18] befunde ist ein eigener Teil im Thema Review hinter den Pruefstufen", () => {
  assert.equal(THEMEN.befunde, "Review");
  const teil = teilFuer("befunde");
  assert.notEqual(teil.redaktor, "text", "befunde zeigt noch die Dateischreibweise");
  assert.equal(teil.thema, "Review");
  assert.ok(teil.titel, "der Teil hat keinen Titel");
  assert.ok(
    teil.reihenfolge > teilFuer("reviewStufen").reihenfolge,
    "der Teil steht nicht hinter den Pruefstufen",
  );
});

test("[einstellungen-18] befunde steht nicht in der Allowlist fuer persoenliche Abweichungen", () => {
  const r = aenderungAnwenden({ reviewModel: "claude-opus-5" }, {}, {
    ebene: "persoenlich",
    aenderungen: [{ pfad: "befunde", wert: { schwelle: 5 } }],
  });
  assert.equal(r.ok, false);
  assert.match(r.grund, /befunde/);
});
