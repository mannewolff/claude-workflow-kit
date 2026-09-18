// Die Vorlage als Spur durch Fachplan, Plan und Arbeitspakete (Issue #683).
//
// Ein mitgebrachter Gestaltungsentwurf ist in kanban-kit zwischen den Stufen verdunstet:
// Der Fachplan nannte ihn "Zielbild", der Plan entschied gegen ihn, kein Paket verwies
// darauf. Die drei Skills fuehren ihn deshalb als Zeile weiter — mit demselben Wortlaut,
// damit keine Stufe eine eigene Lesart bekommt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (name) => readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");

/** Der gemeinsame Satz: beginnt mit "Bringt der Mensch eine Vorlage mit" und endet mit "(I5)." */
function vorlageAbsatz(text) {
  const a = text.indexOf("Bringt der Mensch eine Vorlage mit");
  assert.ok(a >= 0, "der Vorlage-Absatz fehlt");
  const e = text.indexOf("(I5).", a);
  assert.ok(e > a, "der Vorlage-Absatz endet nicht mit dem Verweis auf I5");
  return text.slice(a, e + 5);
}

test("[skills-24] fachplan, techplan und issues tragen den Vorlage-Absatz wortgleich", () => {
  const fachplan = vorlageAbsatz(lies("fachplan"));
  assert.equal(vorlageAbsatz(lies("techplan")), fachplan);
  assert.equal(vorlageAbsatz(lies("issues")), fachplan);
});

test("[skills-24] der Absatz nennt die Zeile, ihre Weitergabe und die Wirkung von verbindlich", () => {
  const absatz = vorlageAbsatz(lies("fachplan"));
  for (const teil of ["`Vorlage: <Pfad> — verbindlich | Anregung`", "`## Ziel`", "Kopf des Plans", "`## Kontext`", "keine offene Gestaltungsfrage gegen die Vorlage", "Stopp-Frage", "Stelle der Vorlage", "Bildschirmfoto", "`issue check-form`"]) {
    assert.notEqual(absatz.indexOf(teil), -1, `der Absatz nennt nicht: ${teil}`);
  }
});

test("[skills-24] /fachplan fragt bei einer verbindlichen Vorlage nach der Designquelle", () => {
  const text = lies("fachplan");
  assert.match(text, /Designquelle des Projekts/);
  assert.match(text, /das erste Paket/);
});
