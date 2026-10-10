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
const rolle = (name) => readFileSync(join(repoRoot, "kit", "rollen", `${name}.md`), "utf-8");
const DOKUMENT_ROLLEN = ["pruefbarkeit", "form-beobachtbarkeit", "abgrenzung", "architektur-bestand", "schnitt-abhaengigkeiten"];

/** Alle Codebloecke in Dokumentreihenfolge; `sprache` filtert auf die Kennung nach dem Fence. */
function codebloecke(sprache = null) {
  return [...SKILL.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)]
    .filter((m) => sprache === null || m[1] === sprache)
    .map((m) => m[2]);
}

// Die Schranke haelt den Skill knapp; sie ist keine feste Zahl. Sie stieg von 160 auf
// 200, als der Fundblock dazukam: Er steht in jedem der vier Rollen-Prompts woertlich
// (nicht als Verweis, damit ein Reviewer ihn im eigenen Prompt liest) und kostet damit
// rund 35 Zeilen. Sie stieg von 200 auf 205 fuer die Formregel zum Stand der Gegenprobe:
// Sie steht an einer Stelle statt in vier Prompts und spart einen Nachforderungs-Umlauf.
// Wer den Skill ohne solchen Anlass ueber 205 Zeilen treibt, kuerzt.
test("[skills-13] der Skill bleibt unter 205 Zeilen", () => {
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 205, `der Skill hat ${zeilen} Zeilen, erlaubt sind weniger als 205`);
});

// Die Form des Stands (Issue #915) stand bis Issue #1383 als Absatz im Skill, den die
// Session in jeden Prompt mitgab. Seit dem Schalter traegt jede Rollendatei sie selbst
// (test/rollen-rahmen.test.mjs prueft den gemeinsamen Wortlaut); der Skill sagt nichts mehr dazu.
test("[skills-13] die Form des Stands steht in den Rollendateien, nicht im Skill", () => {
  assert.equal(SKILL.includes("**Die Form des Stands wird mitgegeben.**"), false, "der Absatz zur Form des Stands steht noch im Skill");
  for (const name of DOKUMENT_ROLLEN) {
    const text = rolle(name);
    assert.match(text, /am Zeilenende/, `${name}: die Formregel fehlt`);
    assert.match(text, /`— geprueft, bestaetigt`/, `${name}: der bestaetigte Stand fehlt`);
    assert.match(text, /`— nicht geprueft`/, `${name}: der ungepruefte Stand fehlt`);
  }
});

// Der Schalter (Issue #1383, Plan #1375 E8): Ab hier traegt der Skill keinen Rollentext
// mehr. Die Rollen stehen allein unter kit/rollen/, montiert wird der Auftrag vom Kit.
test("[skills-1383] der Skill traegt keinen Rollentext mehr", () => {
  assert.equal(SKILL.includes("Du prüfst"), false, "ein Rollentext 'Du prüfst …' steht noch im Skill");
  assert.doesNotMatch(SKILL, /\*\*Rolle `[a-z-]+`\*\*/, "ein Block 'Rolle `…`' steht noch im Skill");
  for (const platzhalter of ["{{ARTEN}}", "{{ISSUE_BODY}}", "{{QUELLE_BODY}}", "{{VORLAGE_PFAD}}"]) {
    assert.equal(SKILL.includes(platzhalter), false, `der Platzhalter ${platzhalter} steht noch im Skill`);
  }
  assert.equal(SKILL.includes("befunde.mjs arten"), false, "die Anweisung, {{ARTEN}} selbst zu fuellen, steht noch im Skill");
  assert.equal(SKILL.includes("**Die fachliche Quelle im Plan-Review.**"), false, "der Absatz zur fachlichen Quelle steht noch im Skill");
});

test("[skills-1383] Schritt 4 montiert je Reviewer den Auftrag und startet ueber kit-pruefer oder start", () => {
  const i = SKILL.indexOf("### 4. Reviewer starten");
  assert.ok(i > 0, "Schritt 4 fehlt");
  const schritt = SKILL.slice(i, SKILL.indexOf("\n### 5.", i));
  const bash = [...schritt.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  assert.match(bash, /^node \.claude\/kit\/board\.mjs issue-review pruefauftrag --rolle <rolle> --id <id> --datei <tmpdir>\/<id>-auftrag-<n>\.md$/m,
    "der Aufruf von pruefauftrag fehlt oder weicht ab");
  assert.match(bash, /^node \.claude\/kit\/board\.mjs issue-review start --reviewer <name> --auftrag <tmpdir>\/<id>-auftrag-<n>\.md --ausgabe <tmpdir>\/<id>-antwort-<n>\.md$/m,
    "der Aufruf von start fuer kind command fehlt oder weicht ab");
  assert.match(schritt, /`kind: claude`[\s\S]{0,300}`subagent_type: kit-pruefer`/, "kind claude laeuft nicht ueber kit-pruefer");
  assert.match(schritt, /`reviewers\[\]\.model`/, "das Modell kommt nicht aus reviewers[].model");
  assert.match(schritt, /`Lies <tmpdir>\/<id>-auftrag-<n>\.md`/, "der Auftrag an den Subagenten ist nicht 'Lies <pfad>'");
  assert.match(schritt, /`kind: command`/, "kind command ist nicht genannt");
  assert.match(schritt, /Scheitert `pruefauftrag` oder `start`[\s\S]{0,300}Ausfall[\s\S]{0,200}Zeile 2/,
    "ein Fehlschlag von pruefauftrag oder start ist kein Ausfall in Zeile 2");
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

test("[skills-13] die Reviewer kommen aus roles mit Stufe und Autor", () => {
  const bash = codebloecke("bash").join("\n");
  assert.match(bash, /issue-review roles --stufe <fachlich\|plan\|issue> --author <modell>$/m);
  assert.doesNotMatch(bash, /--issue <N>/, "roles kennt --issue seit Stufe 2 nicht mehr");
  assert.match(SKILL, /gestartet wird ausschließlich, was in `gewaehlt` steht/);
});

test("[skills-13] jede Dokument-Rolle steht als Datei mit Streich-Frage und Platzhalter", () => {
  for (const name of DOKUMENT_ROLLEN) {
    const p = rolle(name);
    assert.match(p, /\{\{ISSUE_BODY\}\}/, `${name}: der Platzhalter fuer das Dokument fehlt`);
    assert.match(p, /RAUS/, `${name}: die Streich-Frage fehlt`);
    assert.match(p, /BLOCKER \/ WICHTIG \/ HINWEIS/, `${name}: die Schweregrade fehlen`);
    assert.doesNotMatch(p, /Klasse|gate|alternativen|korrektur/, `${name}: verlangt noch eine Fundklasse`);
    assert.ok(p.split("\n").length <= 25, `${name}: laenger als 25 Zeilen`);
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

test("[skills-13] review:fertig ist eine sichtbare Spur am Board, abgenommen vor dem Start, gesetzt nach der Einarbeitung", () => {
  const remove = SKILL.indexOf("issue label remove <id> review:fertig");
  const add = SKILL.indexOf("issue label add <id> review:fertig");
  assert.ok(remove > 0, "das Abnehmen fehlt");
  assert.ok(add > 0, "das Setzen fehlt");
  assert.ok(remove > SKILL.indexOf("### 4. Reviewer starten") && remove < SKILL.indexOf("issue-review pruefauftrag"),
    "das Abnehmen steht nicht unmittelbar vor dem Reviewer-Start");
  assert.ok(add > SKILL.indexOf("issue comment <id> --text-file <tmpdir>/<id>-einarbeitung.md"),
    "das Setzen steht nicht nach dem Einarbeitungs-Kommentar");
  assert.equal(SKILL.split("issue label add <id> review:fertig").length, 2, "das Setzen steht nicht genau einmal");
  assert.equal(SKILL.split("issue label remove <id> review:fertig").length, 2, "das Abnehmen steht nicht genau einmal");
  assert.match(SKILL, /Trifft ein Fund die Stopp-Klasse und wird `kit:klaeren` gesetzt, entfaellt `review:fertig`\./);
  assert.match(SKILL, /Endet der Lauf danach vorzeitig, bleibt das Label ab/);
  assert.match(SKILL, /am Board nicht definiert/);
  assert.match(SKILL, /Kein Marker gibt einen Schritt frei; er ist eine Spur\. Auch `review:fertig` ist Spur, keine Freigabe\./);
  assert.match(SKILL, /Nacht-Kette verlangt dieses Label als Voraussetzung/);
  // Seit Issue #898 nimmt die Kette zwei Auftragsarten an; das Label ist fuer beide
  // Voraussetzung, und der Satz muss auch das Plandokument nennen.
  assert.match(SKILL, /Nacht-Kette verlangt dieses Label als Voraussetzung, bevor sie eine fachliche Anforderung oder ein Plandokument aufnimmt/);
  assert.match(SKILL, /Wird eine Anforderung nach der Pruefung wesentlich geaendert, das Label abnehmen oder neu pruefen lassen/);
});

// Die fachliche Quelle im Plan-Review (Issue #684): Der Reviewer prueft nicht nur, ob der
// Plan zum Code passt, sondern ob er herstellt, was die Quelle verlangt. Seit Issue #1383
// steht das in der Rollendatei, und `pruefauftrag --id` loest Quelle und Vorlage selbst auf.
test("[skills-25] die Rolle architektur-bestand traegt die fachliche Quelle, die Vorlage und eine sechste Frage", () => {
  const plan = rolle("architektur-bestand");
  assert.match(plan, /6\. Stellt der Plan her, was die fachliche Quelle verlangt/);
  assert.match(plan, /jedes Ziel, jedes Akzeptanzkriterium, jede beantwortete Frage/);
  assert.match(plan, /\{\{VORLAGE_PFAD\}\}/);
  assert.match(plan, /--- FACHLICHE QUELLE ---\n\{\{QUELLE_BODY\}\}/);
  assert.ok(plan.indexOf("--- PLAN ---") < plan.indexOf("--- FACHLICHE QUELLE ---"), "die Quelle steht hinter dem Plan");
});

test("[skills-25] der Skill holt die Quelle nicht selbst, das montiert pruefauftrag", () => {
  const i = SKILL.indexOf("### 4. Reviewer starten");
  const schritt = SKILL.slice(i, SKILL.indexOf("\n### 5.", i));
  assert.match(schritt, /`Fachliche Quelle:`/, "Schritt 4 sagt nicht, dass die fachliche Quelle mitkommt");
  assert.match(schritt, /`Vorlage:`/, "Schritt 4 sagt nicht, dass die Vorlage mitkommt");
  assert.doesNotMatch(SKILL, /issue get <N>/, "der Skill holt die Quelle noch selbst");
});

test("[skills-1383] Schritt 6 setzt review:fertig nicht, wenn pruefen keine-pruefer meldet", () => {
  const i = SKILL.indexOf("### 6. Einarbeiten");
  const schritt = SKILL.slice(i, SKILL.indexOf("\n### 7.", i));
  assert.match(schritt, /Meldet `befunde\.mjs pruefen` den Eintrag `keine-pruefer`, wird `review:fertig` nicht gesetzt/);
});
