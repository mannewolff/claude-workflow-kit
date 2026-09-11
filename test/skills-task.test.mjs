// Der Einstieg in Bahn 3: der Skill `/task` (Issue #574, Plan #562).
//
// Ein `[Task]` ist genau ein Arbeitspaket ohne Vorfahren — kein Fachkonzept, kein Plan,
// keine Zerlegung. Der Skill ersetzt die Schritte 2 und 3, statt einen weiteren
// danebenzustellen; deshalb traegt er keine Prozessnummer.
//
// Geprueft wird der Skill-TEXT, nicht die Laufzeit — was ein Skill tut, entscheidet das
// Modell, das ihn liest. Und ausschliesslich die Quelle unter `skills/`, nicht die
// Dogfooding-Kopie unter `.claude/skills/`: Die ist per `.gitignore` ausgeschlossen und
// fehlt in jedem frischen Checkout; dass Quelle und Kopie zusammenpassen, prueft
// `tools/sync-blobs.mjs --check`.
//
// Die heikelste Stelle ist die Verneinung von `--derived-from`. Ein Test, der nur die
// Abwesenheit des Flags prueft, bliebe auch an einem Skill gruen, der die Frage gar nicht
// stellt — und die naechste Sitzung setzte es aus Gewohnheit. Deshalb wird BEIDES
// verlangt: die ausgeschriebene Verneinung im Text UND kein Aufrufbeispiel mit dem Flag.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

const SKILL = lies("skills", "task", "SKILL.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const DOKU = lies("docs", "dokumentation.md");
const ISSUE_REVIEW = lies("skills", "issue-review", "SKILL.md");

/** Der Inhalt aller Codebloecke — dort stehen Aufrufe und der vorgeschriebene Body. */
function codebloecke() {
  return [...SKILL.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((treffer) => treffer[1]);
}

// --- Frontmatter -------------------------------------------------------------

test("[skills-7] der Skill traegt Frontmatter wie die uebrigen Skills", () => {
  assert.match(SKILL, /^---\n/, "der Frontmatter-Block fehlt");
  assert.match(SKILL, /^name: task$/m, "der Name fehlt oder heisst anders");
  assert.match(SKILL, /^description: .+/m, "die Beschreibung fehlt");
  assert.match(SKILL, /^user-invocable: true$/m, "der Skill ist nicht als aufrufbar gekennzeichnet");
});

test("[skills-7] der Skill traegt keine Prozessnummer", () => {
  // Der `[Task]`-Weg ist kein zusaetzlicher Schritt, er ersetzt die Schritte 2 und 3.
  // Eine Nummer behauptete eine Stelle in der Neunerkette, die es nicht gibt.
  assert.match(
    SKILL,
    /ersetzt .{0,30}Schritte? 2 und 3|Schritt 2 und 3/i,
    "es steht nicht da, dass der Skill die Schritte 2 und 3 ersetzt",
  );
  assert.doesNotMatch(
    SKILL,
    /Schritt \d+ des 9-Schritt-Prozesses/,
    "der Skill gibt sich eine Prozessnummer",
  );
});

// --- Schritt 0: die Bestaetigung ---------------------------------------------

test("[skills-7] der Weg wird benannt und bestaetigt, bevor etwas entsteht", () => {
  assert.match(
    SKILL,
    /Bahn-1-Regel/,
    "es steht nicht da, welche Bahn-1-Regel der Vorgang verfehlt",
  );
  assert.match(
    SKILL,
    /nichts abzuw(?:ae|ä)gen/,
    "das zweite Merkmal (nichts abzuwaegen) fehlt",
  );
  assert.match(
    SKILL,
    /Erst danach entsteht etwas|wartet auf die Best(?:ae|ä)tigung/,
    "dass vor der Bestaetigung nichts entsteht, steht nicht da",
  );
});

test("[skills-7] unbeaufsichtigt endet der Skill und legt nichts an", () => {
  assert.match(SKILL, /KIT_AGENT_MODEL/, "das Erkennungsmerkmal der Betriebsart fehlt");
  assert.match(
    SKILL,
    /legt \*{0,2}nichts\*{0,2} an/,
    "es steht nicht da, dass unbeaufsichtigt nichts angelegt wird",
  );
  // Der Rueckfall waere die naheliegende Bequemlichkeit — und genau er ist verboten.
  assert.match(
    SKILL,
    /Kein R(?:ue|ü)ckfall/,
    "der Rueckfall 'unbeaufsichtigt gilt der Weg als bestaetigt' ist nicht ausdruecklich ausgeschlossen",
  );
});

// --- Schritt 1: welche Quelle zaehlt ------------------------------------------

test("[skills-7] eine `[Idee]` ist ein zulaessiger Eingang, mit Spur zurueck", () => {
  assert.match(SKILL, /\/task #N/, "der Aufruf mit Nummer fehlt");
  assert.match(
    SKILL,
    /issue comment <N> --text "Fortsetzung: Issue #T"/,
    "der Fortsetzungs-Kommentar an der Quell-Idee fehlt als Aufruf",
  );
  assert.match(
    SKILL,
    /Fortsetzung: Idee <ideaId> \(noch nicht eingeplant\)/,
    "der Wortlaut fuer den Ideen-Pool-Fall fehlt — ohne ihn erfindet jede Sitzung einen eigenen",
  );
});

test("[skills-7] `[Fachlich]` und `[Plan]` werden als Quelle abgelehnt, ohne anzulegen", () => {
  assert.match(SKILL, /\[Fachlich\]/, "das Praefix [Fachlich] ist nicht genannt");
  assert.match(SKILL, /\[Plan\]/, "das Praefix [Plan] ist nicht genannt");
  assert.match(
    SKILL,
    /lehnt .{0,80}ab und legt nichts an|Ablehnung.{0,80}legt nichts an/s,
    "die Ablehnung ohne Anlegen ist nicht ausgesprochen",
  );
  assert.match(
    SKILL,
    /volle Weg .{0,20}bereits begonnen|bereits begonnen/,
    "der Grund fehlt: dort ist der volle Weg schon begonnen",
  );
});

// --- Schritt 3/4: Body und Anlegen --------------------------------------------

test("[skills-7] der Titel traegt das Praefix `[Task]` und das Anlegen nennt --author-model", () => {
  const aufrufe = codebloecke().filter((block) => /board\.mjs issue create/.test(block));
  assert.ok(aufrufe.length > 0, "kein `issue create`-Aufruf im Skill");
  const zusammen = aufrufe.join("\n");
  assert.match(zusammen, /--title "\[Task\] /, "der Titel traegt das Praefix [Task] nicht");
  assert.match(zusammen, /--author-model/, "--author-model fehlt im Aufruf");
  assert.match(zusammen, /--body-file/, "der Body geht nicht ueber eine Datei");
});

test("[skills-7] der Body geht nie als Argument durch den Befehls-Parser", () => {
  for (const block of codebloecke()) {
    for (const zeile of block.replaceAll(/\\\n\s*/g, " ").split("\n")) {
      if (!/board\.mjs issue (?:create|update|comment)\b/.test(zeile)) continue;
      assert.ok(!/<</.test(zeile), `Heredoc am Board-Aufruf: ${zeile.trim()}`);
      assert.ok(!/--body\s+"/.test(zeile), `Body als Argument: ${zeile.trim()}`);
    }
  }
});

test("[skills-7] der vorgeschriebene Body traegt keine Plan- und keine Quelle-Zeile", () => {
  // Ein `[Task]` hat keinen Vorfahren. Die beiden Herkunftszeilen zu erfinden
  // behauptete eine Kette, die es nicht gibt. Geprueft wird in den Codebloecken:
  // Dort steht das Format, und nur dort waere die Zeile eine Vorschrift.
  for (const block of codebloecke()) {
    assert.doesNotMatch(block, /^Plan: /m, "der vorgeschriebene Body traegt eine `Plan:`-Zeile");
    assert.doesNotMatch(
      block,
      /^Fachliche Quelle: /m,
      "der vorgeschriebene Body traegt eine `Fachliche Quelle:`-Zeile",
    );
  }
});

test("[skills-7] das Vier-Abschnitt-Format steht mit Abhaengigkeiten als letztem Abschnitt", () => {
  for (const abschnitt of ["## Kontext", "## Aufgabe", "## Akzeptanzkriterium", "## Spec-Wirkung"]) {
    assert.ok(SKILL.includes(abschnitt), `der Abschnitt ${abschnitt} ist nicht genannt`);
  }
  assert.match(
    SKILL,
    /`## Abh(?:ae|ä)ngigkeiten` als\s+\*{0,2}letzter\*{0,2} Abschnitt/,
    "dass `## Abhängigkeiten` der letzte Abschnitt ist, steht nicht da",
  );
  assert.match(SKILL, /Autor-Modell:/, "die Autor-Modell-Zeile fehlt");
});

test("[skills-7] die ID-Vergabe wird auf /issues verwiesen, nicht wiederholt", () => {
  assert.match(
    SKILL,
    /\/issues/,
    "der Verweis auf die ID-Konvention in /issues fehlt",
  );
  // Die Grammatik selbst steht in /issues. Eine zweite Fassung hier waere eine zweite
  // Wahrheit ueber die Nummernvergabe.
  assert.doesNotMatch(
    SKILL,
    /h(?:oe|ö)chste je vergebene plus eins/,
    "die ID-Vergaberegel ist hier wiederholt statt verwiesen",
  );
});

test("[skills-7] nach dem Anlegen laeuft label-sync, der Status bleibt Backlog", () => {
  assert.match(
    SKILL,
    /issue-review label-sync <id>/,
    "der label-sync-Aufruf fehlt",
  );
  assert.match(SKILL, /Backlog/, "es steht nicht da, dass die Karte in Backlog bleibt");
  assert.match(SKILL, /\/issue-review #N/, "der Hinweis auf die Pruefung fehlt");
  assert.match(SKILL, /`ideaId`/, "der Sonderfall Ideen-Pool fehlt");
  assert.match(
    SKILL,
    /weder eine Nummer noch|keine Nummer, keine Erfolgsmeldung/,
    "der Fehlerfall beim Anlegen fehlt",
  );
});

// --- Die Verneinung von --derived-from ----------------------------------------

test("[skills-7] der Skill schreibt das Anlegen ohne --derived-from ausdruecklich vor", () => {
  assert.match(
    SKILL,
    /(?:Kein|ohne) `--derived-from`/,
    "die Verneinung steht nicht ausgeschrieben im Text",
  );
  assert.match(
    SKILL,
    /kein(?:en)? Vorfahr/,
    "der Grund fehlt: ein [Task] hat keinen Vorfahren",
  );
});

test("[skills-7] kein Aufrufbeispiel traegt das Flag --derived-from", () => {
  for (const block of codebloecke()) {
    assert.doesNotMatch(
      block,
      /--derived-from/,
      "ein Aufrufbeispiel traegt `--derived-from` — die naechste Sitzung kopiert es",
    );
  }
});

// --- Der abgelehnte Befund -----------------------------------------------------

test("[skills-7] ein `[Task]`, der einen Befund ablehnt, hat die Regel als Kriterium", () => {
  assert.match(
    SKILL,
    /versionierte[n]? Unterdrueckungsregel|versionierte Unterdr(?:ue|ü)ckungsregel/,
    "das Akzeptanzkriterium (die versionierte Unterdrueckungsregel) fehlt",
  );
  assert.match(
    SKILL,
    /sonar-project\.properties/,
    "das Beispiel aus dem Bestand fehlt",
  );
  assert.match(
    SKILL,
    /Begr(?:ue|ü)ndung unmittelbar daneben|Begr(?:ue|ü)ndung .{0,30}daneben/,
    "dass die Begruendung daneben steht, fehlt",
  );
  assert.match(
    SKILL,
    /eigenes Vorhaben/,
    "die Grenze fehlt: ein Werkzeug ohne versionierbaren Weg gehoert in ein eigenes Vorhaben",
  );
  assert.match(
    SKILL,
    /werkzeug(?:ue|ü)bergreifendes Register entsteht nicht/,
    "der ausgeschlossene Gegenentwurf (ein Register) fehlt",
  );
  assert.match(
    SKILL,
    /unabh(?:ae|ä)ngiger Kontrollbefund|Kontrollbefund/,
    "die Verifikation ueber einen Kontrollbefund fehlt",
  );
});

// --- Was der Weg einspart ------------------------------------------------------

test("[skills-7] auf dem Task-Weg entsteht keine Vorhaben-Notiz", () => {
  assert.match(
    SKILL,
    /Keine Vorhaben-Notiz/i,
    "der Entfall der Vorhaben-Notiz ist nicht benannt",
  );
  assert.match(
    SKILL,
    /spec\.mjs vorhaben/,
    "das Kommando, das hier entfaellt, ist nicht benannt",
  );
});

// --- Stop-Punkte ---------------------------------------------------------------

test("[skills-7] der Stop-Punkt verbietet Code, Commit, Ready und das Anlegen ohne Bestaetigung", () => {
  const i = SKILL.search(/^#+ Stop-Punkt/m);
  assert.ok(i > 0, "der Stop-Punkt-Abschnitt fehlt");
  const abschnitt = SKILL.slice(i);
  assert.match(abschnitt, /kein Code/i, "kein Code fehlt");
  assert.match(abschnitt, /kein Commit/i, "kein Commit fehlt");
  assert.match(abschnitt, /Ready/, "die Ready-Bewegung fehlt");
  assert.match(
    abschnitt,
    /ohne Best(?:ae|ä)tigung/,
    "das Anlegen ohne Bestaetigung ist nicht als Stop-Punkt benannt",
  );
});

// --- Wo `[Task]` sonst noch stehen muss ----------------------------------------
//
// Drei Register fuehren die Titel-Praefixe, und alle drei lesen sich als
// abschliessend. Fehlt `[Task]` in einem davon, erfindet die naechste Sitzung dort
// eine vierte Pruefstufe oder haelt den Task fuer ein Dokument, das nie implementiert
// wird — das Gegenteil dessen, wofuer der Weg gebaut wurde.

for (const [name, text] of [["templates/CLAUDE-workflow.md", VORLAGE], ["docs/dokumentation.md", DOKU]]) {
  test(`[skills-7] ${name}: die Pruefstufen-Tabelle zaehlt [Task] zur Stufe \`issue\``, () => {
    const zeile = text.split("\n").find((z) => /^\|/.test(z) && /\[Task\]/.test(z) && /`issue`/.test(z));
    assert.ok(zeile, `${name}: keine Tabellenzeile ordnet [Task] der Stufe \`issue\` zu`);
    assert.match(
      zeile,
      /kein Dokument-Praefix|kein Dokument-Präfix/,
      `${name}: die Zeile sagt nicht, dass [Task] kein Dokument-Praefix ist`,
    );
  });
}

test("[skills-7] die Vorlage fuehrt [Task] als einziges Praefix eines Arbeitspakets", () => {
  const absatz = VORLAGE.split(/\n\n/).find((a) => /Drei Titel-Praefixe|\[Task\]` ist das einzige/.test(a) && /\[Task\]/.test(a));
  assert.ok(absatz, "kein Absatz im Praefix-Abschnitt nennt [Task]");
  assert.match(absatz, /einzige/, "dass [Task] das einzige Paket-Praefix ist, steht nicht da");
  assert.match(
    absatz,
    /implementiert und nach Ready gezogen|wie ein Paket ohne Praefix/,
    "dass ein [Task] implementiert und nach Ready gezogen wird, steht nicht da",
  );
});

test("[skills-7] die Praefix-Tabelle in /issue-review Schritt 1b kennt [Task]", () => {
  const i = ISSUE_REVIEW.indexOf("### 1b. Stufe bestimmen");
  assert.ok(i > 0, "Schritt 1b fehlt");
  const abschnitt = ISSUE_REVIEW.slice(i, ISSUE_REVIEW.indexOf("\n### ", i + 1));
  const zeile = abschnitt.split("\n").find((z) => /^\|/.test(z) && /\[Task\]/.test(z));
  assert.ok(zeile, "die Tabelle in Schritt 1b fuehrt [Task] nicht — sie liest sich als abschliessend");
  assert.match(zeile, /`issue`/, "die [Task]-Zeile nennt die Stufe `issue` nicht");
  assert.match(zeile, /\/task/, "die [Task]-Zeile nennt nicht, woher das Dokument stammt");
});

test("[skills-7] beide Skill-Tabellen fuehren /task unter 'Ersetzt Schritt 2 und 3'", () => {
  for (const [name, text] of [["templates/CLAUDE-workflow.md", VORLAGE], ["docs/dokumentation.md", DOKU]]) {
    assert.match(
      text,
      /Ersetzt Schritt 2 und 3/,
      `${name}: die eigene Werkzeugzeile 'Ersetzt Schritt 2 und 3' fehlt`,
    );
    const zeile = text.split("\n").find((z) => /^\|\s*`\/task`/.test(z));
    assert.ok(zeile, `${name}: keine Tabellenzeile fuer \`/task\``);
    assert.match(
      zeile,
      /ohne Abw(?:ae|ä)gungsbedarf/,
      `${name}: die Zeile zu \`/task\` nennt die Bedingung nicht`,
    );
  }
});

test("[skills-7] /task steht nicht in der Tabelle 'Ergaenzen den Prozess'", () => {
  // Der Skill ergaenzt nichts, er ersetzt Fachkonzept und Plan. Stuende er dort,
  // laese sich der `[Task]`-Weg als zusaetzlicher Schritt neben dem vollen.
  for (const [name, text, anker] of [
    ["templates/CLAUDE-workflow.md", VORLAGE, "**Ergaenzen den Prozess**"],
    ["docs/dokumentation.md", DOKU, "**Ergänzen den Prozess**"],
  ]) {
    const i = text.indexOf(anker);
    assert.ok(i > 0, `${name}: der Anker '${anker}' fehlt`);
    const rest = text.slice(i + anker.length);
    const tabelle = rest.slice(0, rest.indexOf("\n\n", rest.indexOf("|")));
    assert.doesNotMatch(tabelle, /`\/task`/, `${name}: \`/task\` steht in 'Ergaenzen den Prozess'`);
  }
});
