// Die Modell-Empfehlung wandert in das Arbeitspaket (Issue #666, Plan #663).
//
// `/issues` traf die Empfehlung schon vorher und begruendete sie — aber nur in der
// Tabelle am Ende des Laufs. Wo sie am Board stand, stand sie, weil eine einzelne
// Sitzung sie aus eigenem Antrieb kommentiert hat; vorgeschrieben war das nirgends, und
// der Nacht-Runner findet sie so nicht.
//
// Seit diesem Paket schreibt der Skill sie dorthin, wo der Runner ohnehin liest: in den
// Kontext-Abschnitt des Pakets. Die Tabelle bleibt daneben — sie traegt die Begruendung
// fuer den Menschen, die Zeile den Wert fuer die Maschine.
//
// Geprueft wird die QUELLE unter `skills/`, nicht die Dogfooding-Kopie: Die ist per
// `.gitignore` ausgeschlossen und fehlt in jedem frischen Checkout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issues", "SKILL.md"), "utf-8");

test("[skills-22] der Skill nennt die Zeile als Bestandteil des Kontext-Abschnitts", () => {
  assert.match(SKILL, /Empfohlenes Modell:/, "die Zeile kommt im Skill nicht vor");
  // Sie muss im Kontext-Abschnitt landen, nicht irgendwo im Body: Der Runner liest sie
  // ueber eine am Zeilenanfang verankerte Regex, und `/issues` schreibt die uebrigen
  // Modell-Zeilen (Autor-Modell, Plan-Modell) ebenfalls dorthin.
  const absatz = SKILL.split(/\n\n/).find((a) => /Empfohlenes Modell:/.test(a) && /Kontext/.test(a));
  assert.ok(absatz, "kein Absatz verbindet die Zeile mit dem Kontext-Abschnitt");
});

test("[skills-22] der Skill nennt night.modelle als Quelle und die Ordnung der Liste", () => {
  assert.match(SKILL, /night\.modelle/, "die Quelle des Namens fehlt");
  const absatz = SKILL.split(/\n\n/).find((a) => /night\.modelle/.test(a));
  assert.match(absatz, /erste/i, "die Rolle des ersten Eintrags steht nicht da");
  assert.match(absatz, /letzte/i, "die Rolle des letzten Eintrags steht nicht da");
});

test("[skills-22] der Skill sagt, dass die Zeile ohne Liste ersatzlos entfaellt", () => {
  // Eine erfundene Angabe waere schlechter als keine: Der Runner faellt bei fehlender
  // Zeile ohnehin auf das Modell des Laufs zurueck.
  const absatz = SKILL.split(/\n\n/).find((a) => /night\.modelle/.test(a) && /entf(ä|ae)llt/i.test(a));
  assert.ok(absatz, "es steht nicht, dass die Zeile ohne Liste entfaellt");
});

test("[skills-22] der Skill bleibt unter 200 Zeilen", () => {
  // Die Grenze gehoert zu skills-14 und wird von test/skills-issues-kern.test.mjs
  // gemessen. Sie steht hier mit, weil dieses Paket den Absatz ERSETZT statt ihn zu
  // ergaenzen — genau deshalb.
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 200, `der Skill hat ${zeilen} Zeilen`);
});
