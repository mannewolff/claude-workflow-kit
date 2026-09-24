// Der Fundblock in den Prompts von /issue-review und /review (Issue #801).
//
// `befunde.mjs` kennt die Form eines Funds, aber ein Reviewer liefert sie nur, wenn sein
// Prompt sie verlangt. Diese Datei prueft den Skill-TEXT unter `skills/`, nicht die
// Dogfooding-Kopie: Beide Skills geben denselben Block vor — Gegenprobe mit Stand und
// Art aus der ueber `befunde arten` eingesetzten Liste —, keiner schreibt eine Art ab,
// und beide pruefen die Form, bevor der Kommentar ans Board geht.
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

/** Alle Codebloecke eines Skill-Texts in Dokumentreihenfolge. */
function codebloecke(text) {
  return [...text.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].map((m) => m[2]);
}

const ROLLEN_PROMPTS = codebloecke(ISSUE_REVIEW).filter((b) => b.includes("{{ISSUE_BODY}}"));
const CODE_PROMPT = codebloecke(REVIEW).find((b) => b.includes("{{REVIEW_MATERIAL}}"));
const ALLE_PROMPTS = [...ROLLEN_PROMPTS, CODE_PROMPT];

test("[skills-37] der alte Satz steht in keinem der vier Rollen-Prompts mehr", () => {
  assert.equal(ISSUE_REVIEW.includes("Für jeden Fund: Schweregrad"), false,
    "der alte Satz 'Für jeden Fund: Schweregrad …' steht noch im Skill");
});

test("[skills-37] fuenf Prompts tragen den Fundblock", () => {
  assert.equal(ROLLEN_PROMPTS.length, 4, `es sind ${ROLLEN_PROMPTS.length} Rollen-Prompts statt vier`);
  assert.ok(CODE_PROMPT, "der Review-Prompt mit {{REVIEW_MATERIAL}} fehlt");
  for (const p of ALLE_PROMPTS) {
    assert.match(p, /^-?\s*Gegenprobe:/m, "ein Prompt verlangt keine Gegenprobe-Zeile");
    assert.match(p, /widerlegen würde/, "ein Prompt sagt nicht, was die Gegenprobe ist");
    assert.match(p, /geprüft, bestätigt/, "ein Prompt nennt den bestaetigten Stand nicht");
    assert.match(p, /nicht geprüft/, "ein Prompt nennt den ungeprueften Stand nicht");
    assert.match(p, /^-?\s*Art:/m, "ein Prompt verlangt keine Art-Zeile");
    assert.match(p, /\{\{ARTEN\}\}/, "ein Prompt setzt die Artenliste nicht ueber den Platzhalter ein");
    assert.match(p, /eigene Gegenprobe widerlegt hat, meldest du nicht/,
      "ein Prompt sagt nicht, dass ein widerlegter Fund nicht gemeldet wird");
  }
});

test("[skills-37] jede Zeichenkette des Blocks trifft genau fuenfmal ueber beide Skills", () => {
  const beide = ISSUE_REVIEW + REVIEW;
  for (const zeichenkette of ["Art:", "eigene Gegenprobe widerlegt hat, meldest du nicht"]) {
    assert.equal(beide.split(zeichenkette).length - 1, 5,
      `'${zeichenkette}' steht nicht genau fuenfmal — fuenf Prompts, fuenf Treffer`);
  }
  // 'Gegenprobe:' steht einmal mehr: im Beispiel der Formregel von `/issue-review`, das
  // zeigt, wie eine tragende Zeile aussieht. Ein sechster Ort ist die Grenze — was
  // darueber hinausgeht, waere wieder ein Wortlaut an mehreren Stellen.
  assert.equal(beide.split("Gegenprobe:").length - 1, 6,
    "'Gegenprobe:' steht nicht fuenfmal in den Prompts plus einmal im Beispiel der Formregel");
  // Der Platzhalter steht je Skill einmal mehr: im Absatz, der sagt, woraus er gefuellt wird.
  assert.equal(beide.split("{{ARTEN}}").length - 1, 7,
    "'{{ARTEN}}' steht nicht fuenfmal in den Prompts plus einmal je Fuell-Absatz");
});

test("[skills-37] keiner der Skills nennt eine Mangel-Art im eigenen Wortlaut", () => {
  for (const [name, text] of [["issue-review", ISSUE_REVIEW], ["review", REVIEW]]) {
    for (const art of ["bestandsbehauptung", "unbeobachtbar", "widerspruch", "doppelung"]) {
      assert.equal(text.includes(art), false,
        `${name} schreibt die Art '${art}' ab, statt den Platzhalter zu setzen`);
    }
  }
});

test("[skills-37] beide Skills sagen, dass der Platzhalter aus `befunde arten` gefuellt wird", () => {
  for (const [name, text] of [["issue-review", ISSUE_REVIEW], ["review", REVIEW]]) {
    const absatz = text.split("\n").find((z) => z.includes("{{ARTEN}}") && z.includes("befunde.mjs arten"));
    assert.ok(absatz, `${name} sagt nicht, dass {{ARTEN}} aus 'befunde.mjs arten' gefuellt wird`);
  }
});

test("[skills-37] der gefuellte Platzhalter traegt alle zwoelf Arten woertlich", () => {
  const liste = arten().arten.map((a) => `- ${a.name} — ${a.erklaerung}`).join("\n");
  const gefuellt = ROLLEN_PROMPTS[0].replace("{{ARTEN}}", liste);
  for (const a of arten().arten) {
    assert.ok(gefuellt.includes(a.name), `die Art '${a.name}' fehlt im gefuellten Prompt`);
  }
  assert.equal(arten().anzahl, 12, "die Artenliste zaehlt nicht mehr zwoelf Arten");
});

test("[skills-37] die fuenfte Rolle erbt den Block ueber den unveraenderten Verweis", () => {
  assert.match(ISSUE_REVIEW,
    /\*\*Rolle `schnitt-abhaengigkeiten`\*\*[\s\S]{0,200}derselbe Prompt wie `architektur-bestand`/,
    "der Verweis der Rolle schnitt-abhaengigkeiten auf architektur-bestand ist gebrochen");
  assert.equal(ISSUE_REVIEW.split("derselbe Prompt wie `architektur-bestand`").length - 1, 1,
    "der Verweis steht nicht genau einmal");
});

test("[skills-37] beide Skills pruefen die Form genau einmal, vor ihrem Board-Kommentar", () => {
  for (const [name, text, kommentar] of [
    ["issue-review", ISSUE_REVIEW, "issue comment <id> --text-file <tmpdir>/<id>-befunde.md"],
    ["review", REVIEW, "issue comment <ISSUE-NUMMER> --text-file <tmpdir>/id-review.md"],
  ]) {
    const treffer = text.split("befunde.mjs pruefen").length - 1;
    assert.equal(treffer, 1, `${name} ruft 'befunde.mjs pruefen' ${treffer}-mal statt genau einmal`);
    assert.ok(text.indexOf("befunde.mjs pruefen") < text.indexOf(kommentar),
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
