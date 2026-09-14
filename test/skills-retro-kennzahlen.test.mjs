// `/retro` fragt nach den Zahlen (Issue #634).
//
// Die vierte Leitfrage misst den Prozess statt ihn zu fuehlen: gekippte
// Nachtentscheidungen als Quote, Stopp-Fragen, Anforderung bis GO, GO bis Push.
// Eine Zahl, die sich nicht ermitteln laesst, steht als solche da, nie geschaetzt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "retro", "SKILL.md"), "utf-8");
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");

test("[skills-15] die vierte Leitfrage steht woertlich nach der dritten", () => {
  const dritte = SKILL.indexOf("### 3. Welche Workflow-Regel braucht eine Schärfung?");
  const vierte = SKILL.indexOf("### 4. Was sagen die Zahlen?");
  assert.ok(dritte > 0, "die dritte Leitfrage fehlt");
  assert.ok(vierte > dritte, "die vierte Leitfrage fehlt oder steht vor der dritten");
  assert.match(SKILL, /## Vier Leitfragen/, "die Ueberschrift zaehlt noch drei");
});

test("[skills-15] die vier Kennzahlen sind benannt, jede mit Quelle", () => {
  const a = SKILL.indexOf("### 4. Was sagen die Zahlen?");
  const abschnitt = SKILL.slice(a, SKILL.indexOf("\n## ", a));
  for (const kennzahl of ["Gekippte Entscheidungen", "Stopp-Fragen", "Anforderung bis GO", "GO bis Push"]) {
    assert.ok(abschnitt.includes("**" + kennzahl), `Kennzahl fehlt: ${kennzahl}`);
  }
  assert.match(abschnitt, /issue list|issue get|git log/, "die Quellen sind nicht benannt");
  assert.match(abschnitt, /Entscheiden statt fragen/, "der Bezug zum Entscheidungsformat fehlt");
  assert.match(abschnitt, /Stopp-Klasse/, "der Bezug zur Stopp-Klasse fehlt");
});

test("[skills-15] der Output traegt die Kennzahlen als Tabelle und den Stopp-Klasse-Vorschlag", () => {
  const block = SKILL.match(/```\n([\s\S]*?)```/)?.[1] ?? "";
  assert.match(block, /^### Kennzahlen$/m, "der Output-Block hat keinen Kennzahlen-Abschnitt");
  assert.match(block, /^\| Kennzahl \| Wert \| Quelle \|/m, "die Tabelle fehlt");
  assert.match(block, /nicht ermittelbar/, "die Form fuer fehlende Zahlen fehlt im Block");
  assert.match(SKILL, /nicht ermittelbar: <Grund>/, "die Form fuer fehlende Zahlen nennt keinen Grund");
  assert.match(SKILL, /Vorschlag für die Stopp-Klasse/, "der Vorschlag fuer die Stopp-Klasse fehlt");
  assert.match(SKILL, /nicht selbst in `CLAUDE-workflow\.md` eingetragen/, "die Retro darf die Stopp-Klasse nicht selbst aendern");
});

test("[skills-15] der Skill bleibt unter 100 Zeilen und begruendet nichts mit einer Issue-Nummer", () => {
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 100, `der Skill hat ${zeilen} Zeilen, erlaubt sind weniger als 100`);
  assert.doesNotMatch(SKILL, /Issue #\d/, "eine Regel wird mit einer Issue-Nummer begruendet");
});

test("[skills-15] die Vorlage nennt vier Fragen, die vierte woertlich", () => {
  const a = VORLAGE.indexOf("## KI-Retro");
  const abschnitt = VORLAGE.slice(a);
  assert.match(abschnitt, /Vier Fragen/, "die Vorlage zaehlt nicht vier Fragen");
  assert.match(abschnitt, /Was sagen die Zahlen\?/, "die vierte Frage fehlt in der Vorlage");
  assert.match(abschnitt, /gekippte Nachtentscheidungen, Stopp-Fragen, Anforderung bis GO, GO bis Push/);
});
