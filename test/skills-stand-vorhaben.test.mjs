// Die Schlussmeldung eines Vorhabens (Issue #686).
//
// Nach zwoelf gruenen Paketen hielt der Mensch in kanban-kit ein Vorhaben fuer fertig, das
// sein Ziel verfehlt hatte — das Fehlende stand weiter unten. Gruen heisst "erfuellt, was
// aufgeschrieben wurde", nicht "erfuellt, was gemeint war". Deshalb steht es jetzt oben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (name) => readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");

function abschnitt(text) {
  const a = text.indexOf("### Stand des Vorhabens");
  assert.ok(a > 0, "der Abschnitt 'Stand des Vorhabens' fehlt");
  const e = text.indexOf("\n## ", a);
  return text.slice(a, e > a ? e : undefined);
}

for (const skill of ["implement-ready", "implement-next"]) {
  test(`[skills-26] ${skill}: Sichtbares und Fehlendes vor Commits und Checks`, () => {
    const s = abschnitt(lies(skill));
    const sieht = s.indexOf("Was der Mensch jetzt sieht");
    const fehlt = s.indexOf("Was vom Anlass nicht enthalten ist");
    const technik = s.indexOf("Erst danach Commits, Checks und Hinweise");
    assert.ok(sieht > 0 && fehlt > sieht && technik > fehlt, "die Reihenfolge Sichtbares, Fehlendes, Technik stimmt nicht");
    assert.match(s, /`## Stand des Vorhabens`/);
  });

  test(`[skills-26] ${skill}: die Quelle kommt vom Board, und der Abschnitt gilt nur fuer das letzte Paket`, () => {
    const s = abschnitt(lies(skill));
    assert.match(s, /node \.claude\/kit\/board\.mjs issue get <N>/);
    assert.match(s, /nie aus dem Gespräch/);
    assert.match(s, /letzte offene Paket eines Vorhabens/);
    assert.match(s, /`Plan: Issue #M`/);
    assert.match(s, /`Vorlage:`/);
    assert.match(s, /Unbeaufsichtigt steht derselbe Abschnitt am Anfang des Abschlussberichts/);
  });
}

test("[skills-26] beide Skills tragen den Abschnitt wortgleich", () => {
  assert.equal(abschnitt(lies("implement-next")), abschnitt(lies("implement-ready")));
});

// Die Ursprungsdokumente zieht issue melden selbst nach (Issue #1288, Plan #1283, A9).
const URSPRUNG_SATZ = "Die Ursprungsdokumente zieht `issue melden` selbst nach: Die Abschlussmeldung nennt die Zeilen aus dem Feld `ursprung` seiner Ausgabe (gewandert, lag bereits, nicht nachgezogen samt Kommando), und die Session bewegt Plan und fachliche Anforderung nie selbst.";

for (const skill of ["implement-ready", "implement-next"]) {
  test(`[skills-26] ${skill}: der Abschnitt nennt das Feld ursprung und das Verhaeltnis der Urteile`, () => {
    const s = abschnitt(lies(skill));
    assert.ok(s.includes(URSPRUNG_SATZ), "der Satz zum Feld ursprung fehlt");
    assert.match(s, /`ursprung\.durch`/);
  });
}

test("[skills-26] implement-done: der Satz zum Feld ursprung steht nach issue melden", () => {
  const t = lies("implement-done");
  const melden = t.indexOf("node .claude/kit/board.mjs issue melden <id>");
  const satz = t.indexOf(URSPRUNG_SATZ);
  assert.ok(melden > 0 && satz > melden, "der Satz fehlt oder steht vor issue melden");
});
