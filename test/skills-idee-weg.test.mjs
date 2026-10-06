// Eine Idee hat genau zwei Wege, und sie stehen ueberall gleich (Issue #962).
//
// Die Wegwahl fuer eine `[Idee]` stand in fuenf Regeltexten, und sie sagten
// Verschiedenes: dreimal `/task`, zweimal „erst /techplan, dann /issues". Gearbeitet
// wurde nach einer sechsten, ungeschriebenen Regel — Abwaegung noetig geht ueber
// `/fachplan`, sonst ueber `/task`. Solange sich die Texte widersprechen, entscheidet
// jede Sitzung anders; die Widerspruchsfreiheit ist darum das Ergebnis dieses Pakets
// und wird geprueft, nicht nur hergestellt.
//
// Geprueft wird Regel-TEXT, nicht Code: Diese Dateien sind Anweisungen an Sitzungen,
// und was dort nicht steht, passiert nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Stellen, die einem Menschen oder einer Sitzung den Weg einer Idee nennen. */
const STELLEN = [
  "skills/fachplan/SKILL.md",
  "skills/task/SKILL.md",
  "templates/CLAUDE-workflow.md",
  "docs/dokumentation.md",
];

function zeilen(pfad) {
  return readFileSync(join(repoRoot, pfad), "utf-8").split("\n");
}

test("[skills-962] jede Stelle nennt beide Wege einer Idee: Abwaegung -> /fachplan, sonst -> /task", () => {
  for (const pfad of STELLEN) {
    const text = zeilen(pfad).join("\n");
    assert.match(text, /Abw(?:ae|ä)gung/, `${pfad}: die Unterscheidung nach Abwaegung fehlt`);
    assert.match(text, /\/fachplan/, `${pfad}: der Weg /fachplan fehlt`);
    assert.match(text, /\/task/, `${pfad}: der Weg /task fehlt`);
  }
});

test("[skills-962] beide Wege stehen in einem Atemzug, nicht in getrennten Abschnitten", () => {
  // Ein Leser, der die Wegwahl an einer der Stellen nachliest, muss beide Wege dort
  // finden, wo die Frage gestellt wird — zwei Saetze in zwei Kapiteln beantworten sie
  // nicht, und genau so entstand der Widerspruch, den dieses Paket aufloest.
  for (const pfad of STELLEN) {
    const absaetze = readFileSync(join(repoRoot, pfad), "utf-8").split(/\n\s*\n/);
    const treffer = absaetze.filter(
      (a) => /Abw(?:ae|ä)gung/.test(a) && /\/fachplan/.test(a) && /\/task/.test(a),
    );
    assert.ok(
      treffer.length >= 1,
      `${pfad}: kein Absatz nennt Abwaegung, /fachplan und /task zusammen`,
    );
  }
});

test("[skills-962] keine Stelle schickt eine `[Idee]` mehr nach /techplan", () => {
  const funde = [];
  for (const pfad of STELLEN) {
    zeilen(pfad).forEach((zeile, i) => {
      if (zeile.includes("[Idee]") && zeile.includes("/techplan")) {
        funde.push(`${pfad}:${i + 1}: ${zeile.trim().slice(0, 160)}`);
      }
    });
  }
  assert.deepEqual(funde, [], `der gestrichene Weg [Idee] -> /techplan steht noch da:\n${funde.join("\n")}`);
});

// Seit Issue #1025 steht der Rueckgabe-Kommentar nur noch in kit/board.mjs; die
// implement-Skills posten, was `issue auftrag` liefert.
test("[skills-962] der Rueckgabe-Kommentar aus issue auftrag nennt beide Wege", async () => {
  const { AUFTRAG_BACKLOG_TEXTE } = await import("../kit/board/dokumente.mjs");
  const idee = AUFTRAG_BACKLOG_TEXTE.idee("N");
  assert.match(idee, /^Idee —/, "der Kommentar beginnt nicht mit 'Idee —'");
  assert.match(idee, /Abw(?:ae|ä)gung/, "der Kommentar unterscheidet nicht nach Abwaegung");
  assert.match(idee, /\/fachplan/, "der Kommentar nennt /fachplan nicht");
  assert.match(idee, /\/task/, "der Kommentar nennt /task nicht");
  assert.doesNotMatch(idee, /techplan/, "der Kommentar schickt weiter nach /techplan");
});

test("[skills-962] /fachplan nimmt eine `[Idee]` mit Abwaegung an, ohne Herkunftsspur am neuen Issue", () => {
  const text = readFileSync(join(repoRoot, "skills", "fachplan", "SKILL.md"), "utf-8");
  const absaetze = text.split(/\n\s*\n/);
  assert.ok(
    absaetze.some((a) => /Eingang/.test(a) && /`\[Idee\]`/.test(a)),
    "kein Absatz nennt die Idee als Eingang des Skills",
  );
  assert.match(
    text,
    /issue comment <T> --text "Fortsetzung: Issue #N"/,
    "der Spur-Kommentar an der Quellkarte fehlt als Aufruf",
  );
  assert.match(text, /Kein `--derived-from`/, "das Verbot von --derived-from fehlt");
});
