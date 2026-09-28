// Das vierte Praefix steht in allen Regeltexten, die es nennen muessen (Issue #984).
//
// Geprueft wird Regel-TEXT, nicht Code: Diese Dateien sind Anweisungen an Sitzungen und an
// den Menschen, und was dort nicht steht, passiert nicht. Die drei bestehenden Praefixe
// stehen an jeder dieser Stellen; ein viertes, das nur im Runner existiert, waere fuer eine
// interaktive Sitzung unsichtbar — sie wuerde die Karte umsetzen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Stellen, die einer Sitzung oder einem Menschen das Praefix nennen muessen. */
const STELLEN = [
  "skills/implement-next/SKILL.md",
  "skills/implement-ready/SKILL.md",
  "templates/CLAUDE-workflow.md",
  "skills/issues/SKILL.md",
  "skills/task/SKILL.md",
  "docs/dokumentation.md",
];

function text(pfad) {
  return readFileSync(join(repoRoot, pfad), "utf-8");
}

test("[skills-984] jede Stelle nennt das Praefix `[Mensch]`", () => {
  for (const pfad of STELLEN) {
    assert.match(text(pfad), /\[Mensch\]/, `${pfad}: das Praefix [Mensch] fehlt`);
  }
});

test("[skills-984] beide implement-Skills tragen den Rueckgabe-Kommentar des Menschenschritts", () => {
  for (const pfad of ["skills/implement-next/SKILL.md", "skills/implement-ready/SKILL.md"]) {
    const bloecke = [...text(pfad).matchAll(/^```[a-z]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
    const treffer = bloecke.filter((b) => /^Menschenschritt —/m.test(b));
    assert.equal(treffer.length, 1, `${pfad}: genau ein Rueckgabe-Kommentar fuer den Menschenschritt erwartet`);
    assert.match(treffer[0], /wartet auf einen Menschen/i, `${pfad}: der Kommentar sagt nicht, dass die Karte wartet`);
    assert.match(treffer[0], /nicht gescheitert/i, `${pfad}: der Kommentar sagt nicht, dass die Karte nicht gescheitert ist`);
  }
});

test("[skills-984] die Praefix-Tabelle der Vorlage fuehrt vier Praefixe, und `[Task]` gehoert nicht dazu", () => {
  const vorlage = text("templates/CLAUDE-workflow.md");
  const kopf = /^### Vier Titel-Praefixe, vier Sonderfaelle$/m;
  assert.match(vorlage, kopf, "die Ueberschrift nennt nicht vier Praefixe");
  const abschnitt = vorlage.slice(vorlage.search(kopf)).split(/\n---\n/)[0];
  for (const praefix of ["[Fachlich]", "[Plan]", "[Idee]", "[Mensch]"]) {
    assert.match(abschnitt, new RegExp(`^\\|[^\n]*\`\\${praefix.slice(0, -1)}\\]\``, "m"),
      `die Tabelle fuehrt ${praefix} nicht als Zeile`);
  }
  assert.doesNotMatch(abschnitt, /^\|[^\n]*`\[Task\]`/m, "[Task] steht faelschlich in der Tabelle der Praefixe");
  assert.match(abschnitt, /`\[Task\]` ist \*\*das einzige|\*\*`\[Task\]` ist das einzige/,
    "die Unterscheidung, dass [Task] das einzige implementierbare Praefix ist, fehlt");
});

test("[skills-984] die erzeugenden Skills sagen, wann ein Paket `[Mensch]` traegt", () => {
  for (const pfad of ["skills/issues/SKILL.md", "skills/task/SKILL.md"]) {
    const absaetze = text(pfad).split(/\n\s*\n/);
    const treffer = absaetze.filter((a) => /\[Mensch\]/.test(a) && /ausserhalb des Repositor/i.test(a));
    assert.ok(treffer.length >= 1, `${pfad}: kein Absatz sagt, dass [Mensch] fuer Aufgaben ausserhalb des Repositories gilt`);
    assert.match(treffer.join("\n"), /Einstellung|Konto|Zugang|Freigabe/i,
      `${pfad}: die Beispiele (Einstellung, Konto, Zugang, Freigabe) fehlen`);
  }
});

test("[skills-984] die Doku fuehrt das vierte Gate in der Liste der uebersprungenen Karten", () => {
  const doku = text("docs/dokumentation.md");
  const absaetze = doku.split(/\n\s*\n/);
  const treffer = absaetze.filter(
    (a) => /\[Fachlich\]/.test(a) && /\[Idee\]/.test(a) && /\[Plan\]/.test(a) && /\[Mensch\]/.test(a),
  );
  assert.ok(treffer.length >= 1, "kein Absatz der Doku fuehrt alle vier uebersprungenen Sorten zusammen");
  assert.doesNotMatch(treffer.join("\n"), /Drei Sorten Issue/, "die Doku spricht weiter von drei Sorten");
});
