// Der Kommando-Reviewer in /review (Issue #434).
//
// `skills/review/SKILL.md` startete den Reviewer ausschliesslich als Subagent
// ueber das Agent-Tool — und das Agent-Tool kennt nur Claude-Modelle. Ein
// `reviewCommand` in der Config waere damit still wirkungslos gewesen: Die
// Installer-Regel aus Issue #433 laesst die Config durch, der Skill haette sie
// anschliessend ignoriert.
//
// Geprueft wird als Textpruefung, dem Muster von skills-issue-review-bestand
// folgend. Die SKILL.md ist Prosa, die eine Session zur Laufzeit ausfuehrt; es
// gibt im Repository keinen Code, der `reviewCommand` startet — also auch keinen
// ausfuehrbaren Testgegenstand (PO-Entscheidung vom 2026-09-01).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "review", "SKILL.md"), "utf-8");

test("der Reviewer-Start unterscheidet nach Reviewer-Art", () => {
  // Ohne Fallunterscheidung reicht der Skill `reviewCommand` an ein Werkzeug
  // durch, das nur Claude-Modelle kennt.
  assert.match(SKILL, /reviewCommand/,
    "der Skill kennt das Feld reviewCommand ueberhaupt nicht");
  assert.match(SKILL, /reviewModel[\s\S]{0,600}Agent-Tool/,
    "der Claude-Pfad ist nicht mehr an reviewModel gebunden");
  assert.match(SKILL, /reviewCommand[\s\S]{0,600}issue-review start --code-review/,
    "der Kommando-Pfad laeuft nicht ueber issue-review start --code-review");
});

// Der Schalter (Issue #1383, Plan #1375 E8, E10): Schritt 2 montiert den Auftrag aus
// kit/rollen/code-review.md und startet den Pruefer nur lesend — Claude als Subagent
// kit-pruefer mit reviewModel, ein fremdes Werkzeug ueber `issue-review start`.
function schritt(nummer) {
  const i = SKILL.indexOf(`### ${nummer}.`);
  assert.ok(i > 0, `Schritt ${nummer} fehlt`);
  return SKILL.slice(i, SKILL.indexOf("\n### ", i + 1));
}
const bash = (text) => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

test("[skills-1383] Schritt 1 schreibt das Material nach <tmpdir>/review-material.txt", () => {
  const eins = schritt(1);
  assert.match(bash(eins), /git diff origin\/<mainBranch>\.\.\.HEAD > <tmpdir>\/review-material\.txt/,
    "der Diff geht nicht in die Materialdatei");
  assert.match(eins, /printenv TMPDIR/, "Schritt 1 bestimmt <tmpdir> nicht");
});

test("[skills-1383] Schritt 2 laeuft ueber pruefauftrag und kit-pruefer bzw. start --code-review", () => {
  const zwei = schritt(2);
  const kommandos = bash(zwei);
  assert.match(kommandos, /^node \.claude\/kit\/board\.mjs issue-review pruefauftrag --rolle code-review --material-datei <tmpdir>\/review-material\.txt --datei <tmpdir>\/review-auftrag\.md$/m,
    "der Aufruf von pruefauftrag fehlt oder weicht ab");
  assert.match(kommandos, /^node \.claude\/kit\/board\.mjs issue-review start --code-review --auftrag <tmpdir>\/review-auftrag\.md --ausgabe <tmpdir>\/review-antwort\.md$/m,
    "der Aufruf von start --code-review fehlt oder weicht ab");
  assert.match(zwei, /`reviewModel`[\s\S]{0,400}`subagent_type: kit-pruefer`/, "reviewModel laeuft nicht ueber kit-pruefer");
  assert.match(zwei, /`Lies <tmpdir>\/review-auftrag\.md`/, "der Auftrag an den Subagenten ist nicht 'Lies <pfad>'");
});

test("[skills-1383] /review traegt keinen Prompt-Block und keinen Weg ueber die Plattform-Shell mehr", () => {
  assert.equal(SKILL.includes("Du bist Code-Reviewer"), false, "der Prompt steht noch im Skill");
  assert.equal(SKILL.includes("{{REVIEW_MATERIAL}}"), false, "der Platzhalter steht noch im Skill");
  assert.equal(SKILL.includes("Plattform-Shell"), false, "der Satz zum Weg ueber die Plattform-Shell steht noch im Skill");
  assert.doesNotMatch(SKILL, /<reviewCommand> </, "das Kommando wird noch selbst mit stdin-Umleitung gestartet");
});

test("der Ausfallpfad steht woertlich da: kein Spaltenwechsel, kein Board-Kommentar", () => {
  // Ein Review, der nicht lief, darf keine Spur hinterlassen, die wie eine
  // Pruefung aussieht.
  const stelle = SKILL.slice(SKILL.search(/Exit ungleich 0/));
  assert.notEqual(stelle, "", "der Ausfall bei Exit ungleich 0 ist nicht benannt");
  assert.match(stelle.slice(0, 800), /stderr/,
    "die Fehlermeldung enthaelt keinen stderr-Ausschnitt");
  assert.match(stelle.slice(0, 800), /nicht\W{0,4}nach In review|kein Spaltenwechsel/,
    "es steht nicht da, dass das Issue nicht nach In review wechselt");
  assert.match(stelle.slice(0, 800), /kein(en)? Board-Kommentar/,
    "es steht nicht da, dass kein Board-Kommentar entsteht");
});

test("die Vorbedingung nennt die Oder-Regel und beide Randfaelle", () => {
  assert.match(SKILL, /genau eines von beiden|Genau eines der beiden|genau eines der beiden/,
    "die Oder-Regel ist nicht benannt");
  // Randfall 1: keines gesetzt — Alt-Configs duerfen nicht brechen.
  assert.match(SKILL, /[Ff]ehlen beide[\s\S]{0,400}claude-opus-4-8/,
    "der Default fuer Alt-Configs ohne beide Felder fehlt");
  // Randfall 2: beide gesetzt — durch Handedit trotz Installer-Validierung moeglich.
  assert.match(SKILL, /[Ss]ind beide[\s\S]{0,400}(bricht|Abbruch)/,
    "der Abbruch bei zwei gesetzten Feldern fehlt");
});

test("reviewCommand steht in der Aufzaehlung der persoenlichen Felder", () => {
  const [, felder = ""] = SKILL.match(/nur persoenliche Felder: ([^)]+)\)/) ?? [];
  assert.match(felder, /reviewCommand/,
    "die Aufzaehlung der lokal ueberschreibbaren Felder kennt reviewCommand nicht (Issue #435)");
});
