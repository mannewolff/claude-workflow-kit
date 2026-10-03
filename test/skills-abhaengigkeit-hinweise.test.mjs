// Skills, Vorlage und Dokumentation erklaeren, was der Nachtlauf als Abhaengigkeit liest
// (Issue #1065, Plan #1057 Verifizierung 7).
//
// Die Pakete #1058 bis #1064 machen sichtbar, was im Abschnitt `## Abhaengigkeiten`
// gelesen wird: `hinweise` beim Schreiben, Herkunft in Probelauf und Rueckstell-Kommentar,
// Kreis-Befund und Dokument-Hinweis. Wirken tut das erst, wenn die schneidenden Skills die
// `hinweise` lesen und Vorlage und Dokumentation die Konvention nennen.
//
// Geprueft wird der TEXT der Quellen, nicht die Dogfooding-Kopie unter `.claude/`. Jede
// Pruefung laeuft zusaetzlich gegen eine abgewandelte Kopie, aus der genau ihre Angabe
// entfernt ist — sonst bliebe ein Muster gruen, das auf alles passt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const TEXTE = {
  issues: lies("skills", "issues", "SKILL.md"),
  task: lies("skills", "task", "SKILL.md"),
  vorlage: lies("templates", "CLAUDE-workflow.md"),
  doku: lies("docs", "dokumentation.md"),
};

/** Der Absatz, der die `hinweise` beim Schreiben behandelt — genau einer je Skill. */
function hinweisAbsatz(text) {
  return text.split(/\n\n/).filter((a) => /`hinweise`/.test(a) && /schreibweise/.test(a));
}

// Je Skill: der Hinweis-Absatz nennt beide Arten, die Korrektur vor dem Anlegen, den
// Abschluss fuer gemeinte Nummern und den unbeaufsichtigten Fall.
const SKILL_ANGABEN = [
  ["schreibweise", /`?art: schreibweise`?/],
  ["dokument", /`?art: dokument`?/],
  ["Korrektur vor dem Anlegen", /vor dem Anlegen korrigiert/],
  ["Abschluss nennt den Hinweis", /Abschluss nennt den Hinweis/],
  ["unbeaufsichtigt ohne Rueckfrage", /Unbeaufsichtigt gilt dasselbe ohne Rückfrage/],
];

function skillFehlt(text) {
  const absaetze = hinweisAbsatz(text);
  if (absaetze.length !== 1) return [`genau ein Hinweis-Absatz erwartet, gefunden: ${absaetze.length}`];
  return SKILL_ANGABEN.filter(([, re]) => !re.test(absaetze[0])).map(([name]) => name);
}

// Vorlage und Dokumentation: die Konvention samt allem, was die Pakete sichtbar machen.
const UE = "(?:ä|ae)";
const KONVENTION_ANGABEN = [
  ["jede lokale #N zaehlt", new RegExp(`[Jj]ede lokale \`#N\` im Abschnitt z${UE}hlt`)],
  ["auch in Erlaeuterungen", new RegExp(`auch in Erl${UE}uterungen`)],
  ["owner/repo#N zaehlt nicht", new RegExp(`\`owner/repo#N\`[^.]*z${UE}hlen nicht`)],
  ["Verweiszeile", /Verweiszeile beginnt/],
  ["Hinweise beim Schreiben", /`issue check-form`, `issue create` und `issue update`/],
  ["Herkunft in Probelauf und Rueckstell-Kommentar", new RegExp(`Probelauf[^\\n]{0,40}R(?:ü|ue)ckstell-Kommentar nennen je Abh${UE}ngigkeit`)],
  ["Kreis-Befund", /Kreis: #A -> #B -> #A/],
  ["wartet auf einen Kreis", /wartet auf einen Kreis/],
  ["Dokument-Hinweis", /kein Arbeitspaket/],
];

// Nur die Dokumentation: das Kapitel Nachtbetrieb nennt Block und eingerueckte Zeilen.
const NACHT_ANGABEN = [
  ["Block unter dem Rueckstell-Kommentar", /`Abhaengigkeiten, wie der Nachtlauf sie liest:`/],
  ["eingerueckte Zeilen im Probelauf", /eingerückt unter der Zeile jedes Pakets/],
];

function konventionFehlt(text) {
  return KONVENTION_ANGABEN.filter(([, re]) => !re.test(text)).map(([name]) => name);
}

/** Das Kapitel `## Nachtbetrieb` bis zur naechsten `## `-Ueberschrift. */
function nachtKapitel(text) {
  const start = text.indexOf("\n## Nachtbetrieb\n");
  assert.ok(start >= 0, "Kapitel Nachtbetrieb fehlt");
  const ende = text.indexOf("\n## ", start + 5);
  return text.slice(start, ende < 0 ? undefined : ende);
}

function nachtFehlt(text) {
  const kapitel = nachtKapitel(text);
  return NACHT_ANGABEN.filter(([, re]) => !re.test(kapitel)).map(([name]) => name);
}

/** Die Kopie ohne jede Fundstelle eines Musters. */
function ohne(text, re) {
  return text.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "");
}

for (const name of ["issues", "task"]) {
  test(`/${name} nennt hinweise samt schreibweise und dokument`, () => {
    assert.deepEqual(skillFehlt(TEXTE[name]), []);
  });

  test(`/${name}: jede abgewandelte Kopie ohne eine Angabe wird rot`, () => {
    for (const [angabe, re] of SKILL_ANGABEN) {
      assert.ok(skillFehlt(ohne(TEXTE[name], re)).length > 0, `Kopie ohne '${angabe}' bliebe gruen`);
    }
  });
}

for (const name of ["vorlage", "doku"]) {
  test(`${name} nennt die Konvention, Verweiszeile, Kreis-Befund und Dokument-Hinweis`, () => {
    assert.deepEqual(konventionFehlt(TEXTE[name]), []);
  });

  test(`${name}: jede abgewandelte Kopie ohne eine Angabe wird rot`, () => {
    for (const [angabe, re] of KONVENTION_ANGABEN) {
      assert.ok(konventionFehlt(ohne(TEXTE[name], re)).length > 0, `Kopie ohne '${angabe}' bliebe gruen`);
    }
  });
}

test("Dokumentation nennt im Nachtbetrieb den Block und die eingerueckten Zeilen", () => {
  assert.deepEqual(nachtFehlt(TEXTE.doku), []);
});

test("Dokumentation: Kopie ohne Block oder eingerueckte Zeilen wird rot", () => {
  for (const [angabe, re] of NACHT_ANGABEN) {
    assert.ok(nachtFehlt(ohne(TEXTE.doku, re)).length > 0, `Kopie ohne '${angabe}' bliebe gruen`);
  }
});
