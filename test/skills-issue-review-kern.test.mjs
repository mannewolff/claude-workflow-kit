// Der Kern von `/issue-review` nach dem Prozess-Umbau Stufe 1 (Issue #629).
//
// Eine Runde, Befunde als Zuarbeit, die aufrufende Session arbeitet ein, der
// Marker ist eine Spur und kein Gate. Was gestrichen ist — Fundklassen, Synthese,
// Beleg-Abgleich, Rundengrenze, Pruefvorgabe, Zustandslabels — darf im Skill nicht
// wieder auftauchen; genau darauf prueft diese Datei zuerst.
//
// Geprueft wird der Skill-TEXT unter `skills/`, nicht die Dogfooding-Kopie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

/** Alle Codebloecke in Dokumentreihenfolge; `sprache` filtert auf die Kennung nach dem Fence. */
function codebloecke(sprache = null) {
  return [...SKILL.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)]
    .filter((m) => sprache === null || m[1] === sprache)
    .map((m) => m[2]);
}

test("[skills-13] der Skill bleibt unter 150 Zeilen", () => {
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 150, `der Skill hat ${zeilen} Zeilen, erlaubt sind weniger als 150`);
});

test("[skills-13] gestrichene Regeln kommen im Skill nicht mehr vor", () => {
  for (const wort of ["Synthese", "Abgleich", "Rundengrenze", "label-sync", "Pruefung:"]) {
    assert.ok(!SKILL.includes(wort), `'${wort}' steht noch im Skill`);
  }
  // Die Fundklasse ist weg; die Stopp-Klasse aus CLAUDE-workflow.md bleibt genannt.
  assert.doesNotMatch(SKILL, /(?<!Stopp-)Klasse/, "die Fundklasse steht noch im Skill");
  assert.doesNotMatch(SKILL, /Issue #\d/, "eine Regel wird mit einer Issue-Nummer begruendet");
  assert.doesNotMatch(SKILL, /\$TMPDIR|\$\{TMPDIR\}/, "ein Variablen-Redirect wird unbeaufsichtigt abgewiesen");
});

test("[skills-13] die Form prueft ein Kommando vor dem Reviewer-Start", () => {
  const bash = codebloecke("bash").join("\n");
  assert.match(bash, /issue check-form <id>/, "check-form fehlt als Kommando");
  assert.ok(SKILL.indexOf("issue check-form <id>") < SKILL.indexOf("### 4. Reviewer starten"),
    "check-form steht nicht vor dem Reviewer-Start");
  assert.match(SKILL, /Ein Reviewer prüft keine Form/);
});

test("[skills-13] die Stufe steht unter 1b und kennt [Task]", () => {
  const i = SKILL.indexOf("### 1b. Stufe bestimmen");
  assert.ok(i > 0, "Schritt 1b fehlt");
  const abschnitt = SKILL.slice(i, SKILL.indexOf("\n### ", i + 1));
  const zeile = abschnitt.split("\n").find((z) => /^\|/.test(z) && /\[Task\]/.test(z));
  assert.ok(zeile, "die Tabelle fuehrt [Task] nicht");
  assert.match(zeile, /`issue`/);
  assert.match(zeile, /\/task/);
});

test("[skills-13] die Reviewer kommen aus roles mit Stufe, Autor und Nummer", () => {
  const bash = codebloecke("bash").join("\n");
  assert.match(bash, /issue-review roles --stufe <fachlich\|plan\|issue> --author <modell> --issue <N>/);
  assert.match(SKILL, /gestartet wird ausschließlich, was in `gewaehlt` steht/);
});

test("[skills-13] die vier Rollen stehen als Prompt-Bloecke mit Streich-Frage und Platzhalter", () => {
  const prompts = codebloecke().filter((b) => b.includes("{{ISSUE_BODY}}"));
  assert.ok(prompts.length >= 4, `nur ${prompts.length} Prompt-Bloecke mit {{ISSUE_BODY}}`);
  for (const rolle of ["pruefbarkeit", "form-beobachtbarkeit", "abgrenzung", "architektur-bestand"]) {
    assert.match(SKILL, new RegExp("\\*\\*Rolle `" + rolle + "`\\*\\*"), `Rolle ${rolle} fehlt`);
  }
  for (const p of prompts) {
    assert.match(p, /RAUS/, "ein Prompt traegt die Streich-Frage nicht");
    assert.match(p, /BLOCKER \/ WICHTIG \/ HINWEIS/, "ein Prompt nennt die Schweregrade nicht");
    assert.doesNotMatch(p, /Klasse|gate|alternativen|korrektur/, "ein Prompt verlangt noch eine Fundklasse");
    assert.ok(p.split("\n").length <= 25, "ein Prompt ist laenger als 25 Zeilen");
  }
});

test("[skills-13] [skills-9] Befunde, Body und Einarbeitung gehen ueber Dateien mit festen Platzhaltern", () => {
  const bash = codebloecke("bash").join("\n");
  assert.match(bash, /issue comment <id> --text-file <tmpdir>\/<id>-befunde\.md/);
  assert.match(bash, /issue update <id> --body-file <tmpdir>\/<id>-body\.md/);
  assert.match(bash, /issue comment <id> --text-file <tmpdir>\/<id>-einarbeitung\.md/);
  assert.match(SKILL, /\*\*eigener\*\* Werkzeugaufruf/);
  assert.match(SKILL, /unvollständige Datei nicht übertragen/);
  assert.match(SKILL, /Kommt dieser Kommentar nicht an, endet der Skill ohne weitere Mutation/);
});

test("[skills-13] der Befunde-Kommentar traegt den Anker Runde 1, die Einarbeitung ihren eigenen", () => {
  assert.match(SKILL, /`## <Stufe>-Review, Runde 1`/);
  assert.match(SKILL, /`## Einarbeitung, Runde 1`/);
});

test("[skills-13] der Marker ist eine Spur je Stufe, kein Gate", () => {
  assert.match(SKILL, /Arbeitspaket[\s\S]{0,160}`## Kontext`/);
  assert.match(SKILL, /fachliche[rn]? Anforderung[\s\S]{0,160}`## Ziel`/);
  assert.match(SKILL, /Plandokument[\s\S]{0,200}`Plan-Modell:`/);
  assert.match(SKILL, /Issue-Review: codex \(2026-09-13\)/);
  assert.match(SKILL, /Plan-Review: fable \(2026-09-13, Nachtlauf\)/);
  assert.match(SKILL, /nie ein Modell-Marker/);
  assert.match(SKILL, /Kein Marker gibt einen Schritt frei/);
});

test("[skills-13] die Session arbeitet ein oder lehnt ab; die Stopp-Klasse haelt an", () => {
  assert.match(SKILL, /Entscheiden statt fragen/);
  assert.match(SKILL, /übernehmen oder mit einem Satz ablehnen/);
  assert.match(SKILL, /Stopp-Klasse/);
  const bash = codebloecke("bash").join("\n");
  assert.match(bash, /issue label add <id> kit:klaeren/);
  assert.match(SKILL, /unbeaufsichtigt zeichnet die Session das Dokument, schreibt keinen Body/);
  assert.match(SKILL, /wartet auf ein Wort, bevor sie schreibt/);
});

test("[skills-13] unbeaufsichtigt wird an keiner Stelle gefragt", () => {
  assert.match(SKILL, /KIT_AGENT_MODEL/);
  assert.match(SKILL, /Unbeaufsichtigt\*\* \(gesetztes `KIT_AGENT_MODEL`\) wird nicht gefragt/);
  assert.match(SKILL, /unbeaufsichtigt gilt der Regelvorschlag/);
  assert.match(SKILL, /unbeaufsichtigt schreibt sie direkt/);
});
