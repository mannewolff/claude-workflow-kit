// Der Fundblock in den Prompts von /issue-review und /review (Issue #801).
//
// `befunde.mjs` kennt die Form eines Funds, aber ein Reviewer liefert sie nur, wenn sein
// Prompt sie verlangt. Seit dem Schalter (Issue #1383) stehen die Prompts als Rollendateien
// unter `kit/rollen/`, und `issue-review pruefauftrag` setzt die Artenliste ein. Diese Datei
// prueft beides: Jede Rolle traegt denselben Block — Gegenprobe mit Stand und Art aus der
// eingesetzten Liste —, keine Rolle und kein Skill schreibt eine Art ab, die Skills tragen
// keinen Prompt mehr, und beide pruefen die Form, bevor der Kommentar ans Board geht.
//
// Dass ein Prompt ein Modell tatsaechlich dazu bringt, die Angaben zu liefern, ist ein
// Urteil ueber Textwirkung und steht als manueller Pruefpunkt am Arbeitspaket.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { arten } from "../kit/befunde.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ISSUE_REVIEW = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");
const REVIEW = readFileSync(join(repoRoot, "skills", "review", "SKILL.md"), "utf-8");
const rolle = (name) => readFileSync(join(repoRoot, "kit", "rollen", `${name}.md`), "utf-8");

const DOKUMENT_ROLLEN = ["pruefbarkeit", "form-beobachtbarkeit", "abgrenzung", "architektur-bestand", "schnitt-abhaengigkeiten"];
const ROLLEN_PROMPTS = DOKUMENT_ROLLEN.map((name) => [name, rolle(name)]);
const CODE_PROMPT = rolle("code-review");
const ALLE_PROMPTS = [...ROLLEN_PROMPTS, ["code-review", CODE_PROMPT]];

test("[skills-37] der alte Satz steht in keiner Rolle und keinem Skill mehr", () => {
  for (const [name, text] of [...ALLE_PROMPTS, ["issue-review", ISSUE_REVIEW]]) {
    assert.equal(text.includes("Für jeden Fund: Schweregrad"), false,
      `${name}: der alte Satz 'Für jeden Fund: Schweregrad …' steht noch da`);
  }
});

test("[skills-37] sechs Rollendateien tragen den Fundblock", () => {
  assert.match(CODE_PROMPT, /\{\{REVIEW_MATERIAL\}\}/, "die Rolle code-review traegt {{REVIEW_MATERIAL}} nicht");
  for (const [name, p] of ALLE_PROMPTS) {
    assert.match(p, /^-?[ \t]*Gegenprobe:/m, `${name}: verlangt keine Gegenprobe-Zeile`);
    assert.match(p, /widerlegen würde/, `${name}: sagt nicht, was die Gegenprobe ist`);
    assert.match(p, /geprüft, bestätigt/, `${name}: nennt den bestaetigten Stand nicht`);
    assert.match(p, /nicht geprüft/, `${name}: nennt den ungeprueften Stand nicht`);
    assert.match(p, /^-?[ \t]*Art:/m, `${name}: verlangt keine Art-Zeile`);
    assert.match(p, /\{\{ARTEN\}\}/, `${name}: setzt die Artenliste nicht ueber den Platzhalter ein`);
    assert.match(p, /eigene Gegenprobe widerlegt hat, meldest du nicht/,
      `${name}: sagt nicht, dass ein widerlegter Fund nicht gemeldet wird`);
  }
});

test("[skills-37] jede Zeichenkette des Blocks steht je Rolle genau einmal und in keinem Skill", () => {
  for (const zeichenkette of ["Art:", "eigene Gegenprobe widerlegt hat, meldest du nicht", "{{ARTEN}}"]) {
    for (const [name, p] of ALLE_PROMPTS) {
      assert.equal(p.split(zeichenkette).length - 1, 1, `${name}: '${zeichenkette}' steht nicht genau einmal`);
    }
    for (const [name, text] of [["issue-review", ISSUE_REVIEW], ["review", REVIEW]]) {
      assert.equal(text.includes(zeichenkette), false, `${name}: '${zeichenkette}' steht noch im Skill`);
    }
  }
});

test("[skills-37] weder Skill noch Rolle nennt eine Mangel-Art im eigenen Wortlaut", () => {
  for (const [name, text] of [["issue-review", ISSUE_REVIEW], ["review", REVIEW], ...ALLE_PROMPTS]) {
    for (const art of ["bestandsbehauptung", "unbeobachtbar", "widerspruch", "doppelung"]) {
      assert.equal(text.includes(art), false,
        `${name} schreibt die Art '${art}' ab, statt den Platzhalter zu setzen`);
    }
  }
});

test("[skills-1383] beide Skills lassen den Auftrag von pruefauftrag montieren, statt ihn selbst zu fuellen", () => {
  for (const [name, text] of [["issue-review", ISSUE_REVIEW], ["review", REVIEW]]) {
    assert.match(text, /issue-review pruefauftrag --rolle /, `${name}: ruft pruefauftrag nicht auf`);
    assert.equal(text.includes("befunde.mjs arten"), false, `${name}: fuellt die Artenliste noch selbst`);
  }
});

test("[skills-37] der gefuellte Platzhalter traegt alle zwoelf Arten woertlich", () => {
  const liste = arten().arten.map((a) => `- ${a.name} — ${a.erklaerung}`).join("\n");
  const gefuellt = ROLLEN_PROMPTS[0][1].replace("{{ARTEN}}", liste);
  for (const a of arten().arten) {
    assert.ok(gefuellt.includes(a.name), `die Art '${a.name}' fehlt im gefuellten Prompt`);
  }
  assert.equal(arten().anzahl, 12, "die Artenliste zaehlt nicht mehr zwoelf Arten");
});

test("[skills-1383] schnitt-abhaengigkeiten traegt den Block selbst, nicht ueber einen Verweis", () => {
  assert.equal(ISSUE_REVIEW.includes("derselbe Prompt wie `architektur-bestand`"), false,
    "der Verweis der Rolle schnitt-abhaengigkeiten auf architektur-bestand steht noch im Skill");
  assert.doesNotMatch(rolle("schnitt-abhaengigkeiten"), /architektur-bestand/, "die Rolle verweist noch auf architektur-bestand");
});

test("[skills-37] beide Skills pruefen die Form genau einmal, vor ihrem Board-Kommentar", () => {
  for (const [name, text, kommentar] of [
    ["issue-review", ISSUE_REVIEW, "issue comment <id> --text-file <tmpdir>/<id>-befunde.md"],
    ["review", REVIEW, "issue comment <ISSUE-NUMMER> --text-file <tmpdir>/id-review.md"],
  ]) {
    // Gezaehlt wird der Aufruf, nicht jede Nennung: Schritt 6 von /issue-review nennt das
    // Kommando noch einmal, wenn er auf seine Meldung `keine-pruefer` verweist (Issue #1383).
    const treffer = text.split("befunde.mjs pruefen --datei").length - 1;
    assert.equal(treffer, 1, `${name} ruft 'befunde.mjs pruefen' ${treffer}-mal statt genau einmal`);
    assert.ok(text.indexOf("befunde.mjs pruefen --datei") < text.indexOf(kommentar),
      `${name} prueft die Form erst nach dem Board-Kommentar`);
    assert.match(text, /befunde\.mjs pruefen --datei/, `${name} ruft 'pruefen' ohne --datei`);
  }
});

test("[skills-37] die Nachforderung laeuft genau einmal und kennzeichnet danach", () => {
  for (const [name, text] of [["issue-review", ISSUE_REVIEW], ["review", REVIEW]]) {
    const absatz = text.split("\n\n").find((a) => a.includes("Angaben: unvollstaendig"));
    assert.ok(absatz, `${name} nennt die Zeile 'Angaben: unvollstaendig' nicht`);
    assert.match(absatz, /einmal/, `${name} sagt im selben Absatz nicht, dass genau einmal nachgefordert wird`);
    assert.match(absatz, /[Kk]ein Gate/, `${name} sagt nicht, dass aus der Form kein Gate wird`);
  }
});

test("[skills-37] /review bucht nicht und behaelt seinen Stop-Punkt", () => {
  assert.equal(REVIEW.includes("befunde.mjs buchen"), false,
    "/review bucht — gebucht wird erst, wenn der Mensch entschieden hat");
  const stopp = REVIEW.slice(REVIEW.indexOf("## Stop-Punkt"));
  assert.equal(stopp.trim(), [
    "## Stop-Punkt",
    "",
    "Nach dem Review wartet der Prozess auf den Menschen. Claude setzt das Issue auf **In review** — der Commit-Push (Schritt 8) erfolgt nur auf explizite Trigger-Phrase `push main`.",
  ].join("\n"), "der Abschnitt '## Stop-Punkt' ist nicht mehr der alte");
  assert.match(REVIEW, /Ein Review, der nicht lief, darf keine Spur hinterlassen/,
    "der Ausfallpfad ist nicht mehr der alte");
});
