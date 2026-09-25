// Die Buchung verdrahtet: `/issue-review` Schritt 6 und `/push-main` vor dem Commit
// (Issue #805, Plan #797).
//
// `befunde buchen` schreibt nur Funde mit Uebernahmevermerk — gebucht wird also dort,
// wo jemand ueber die Uebernahme entschieden hat: im Einarbeitungsschritt von
// `/issue-review` und bei der Einarbeitung der Code-Review-Befunde vor dem Push.
// `/review` bucht nicht; dass es dabei bleibt, haelt `[skills-37]` fest.
//
// Die Stelle in `/push-main` ist der Punkt NACH dem einen Prueflauf und VOR dem
// Commit: Erst dann deckt `.claude/checks-summary.json` genau den Stand, auf dem
// gebucht wird, und der Vergleichsstand der Code-Stufe kann `gruen` sein.
//
// Geprueft wird Text unter `skills/`, nicht die Dogfooding-Kopie unter `.claude/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ISSUE_REVIEW = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");
const PUSH_MAIN = readFileSync(join(repoRoot, "skills", "push-main", "SKILL.md"), "utf-8");

/** Der Absatz eines Skill-Texts, der eine Zeichenkette traegt — Absaetze sind leerzeilengetrennt. */
function absatzMit(text, zeichenkette) {
  return text.split("\n\n").find((a) => a.includes(zeichenkette));
}

test("[skills-36] /issue-review bucht nach dem Einarbeitungs-Kommentar und vor `review:fertig`", () => {
  const kommentar = ISSUE_REVIEW.indexOf("## Einarbeitung, Runde 1");
  const buchen = ISSUE_REVIEW.indexOf("befunde.mjs buchen");
  const label = ISSUE_REVIEW.indexOf("issue label add <id> review:fertig");

  assert.notEqual(kommentar, -1, "der Kommentar '## Einarbeitung, Runde 1' fehlt");
  assert.notEqual(buchen, -1, "der Skill ruft 'befunde.mjs buchen' nicht");
  assert.notEqual(label, -1, "das Setzen von 'review:fertig' fehlt");
  assert.ok(kommentar < buchen, "gebucht wird vor dem Einarbeitungs-Kommentar");
  assert.ok(buchen < label, "gebucht wird erst nach 'review:fertig'");
});

test("[skills-36] der Aufruf traegt Datei, Stufe des Laufs und Karte", () => {
  assert.match(ISSUE_REVIEW,
    /befunde\.mjs buchen --datei <tmpdir>\/<id>-buchung\.md --stufe <fachlich\|plan\|issue> --karte <id>/,
    "der buchen-Aufruf nennt nicht Datei, Stufe und Karte");
});

test("[skills-36] der Befunde-Text bekommt je Fundblock einen Uebernahmevermerk", () => {
  const absatz = absatzMit(ISSUE_REVIEW, "Uebernahme: uebernommen");
  assert.ok(absatz, "der Skill nennt die Zeile 'Uebernahme: uebernommen' nicht");
  assert.match(absatz, /Uebernahme: abgelehnt/, "derselbe Absatz nennt den abgelehnten Stand nicht");
  assert.match(absatz, /<tmpdir>\/<id>-buchung\.md/,
    "der Absatz sagt nicht, dass der ergaenzte Text als eigene Datei entsteht");
});

test("[skills-36] /issue-review schlaegt je erreichter Art einen Vorschlag vor", () => {
  assert.match(ISSUE_REVIEW, /befunde\.mjs vorschlag --art/,
    "der Skill ruft 'befunde.mjs vorschlag --art' nicht");
  const absatz = absatzMit(ISSUE_REVIEW, "befunde.mjs vorschlag --art");
  assert.match(absatz, /erreicht/,
    "der Skill sagt nicht, dass der Vorschlag je gemeldeter erreichter Art laeuft");
});

test("[skills-36] bei `kit:klaeren` wird nicht gebucht", () => {
  const absatz = ISSUE_REVIEW.split("\n\n").find((a) => a.includes("kit:klaeren") && a.includes("bucht"));
  assert.ok(absatz, "der Skill sagt nicht, dass bei 'kit:klaeren' nicht gebucht wird");
  assert.match(absatz, /nicht gebucht|bucht (die Session )?nicht/,
    "der Absatz verneint die Buchung nicht ausdruecklich");
});

test("[skills-36] der Abschluss von /issue-review nennt gebuchte Funde und Vorschlaege", () => {
  const abschluss = ISSUE_REVIEW.slice(ISSUE_REVIEW.indexOf("### 7. Abschluss"));
  assert.match(abschluss, /gebucht/, "die Zusammenfassung nennt die gebuchten Funde nicht");
  assert.match(abschluss, /Vorschl/, "die Zusammenfassung nennt die Vorschlaege nicht");
});

test("[skills-36] /push-main bucht mit der Stufe `code` nach dem Prueflauf und vor dem Commit", () => {
  const prueflauf = PUSH_MAIN.indexOf("### 5. Der eine Prüflauf");
  const commit = PUSH_MAIN.indexOf("### 6. Der eine Commit");
  const aufruf = PUSH_MAIN.split("\n").find((z) => z.includes("befunde.mjs buchen") && z.includes("--stufe code"));
  const buchen = PUSH_MAIN.indexOf("befunde.mjs buchen");

  assert.notEqual(prueflauf, -1, "der Abschnitt des Prueflaufs fehlt");
  assert.notEqual(commit, -1, "der Abschnitt des Commits fehlt");
  assert.ok(aufruf, "der Skill ruft 'befunde.mjs buchen' nicht mit '--stufe code'");
  assert.match(aufruf, /--datei <tmpdir>\/<id>-buchung\.md/, "der Aufruf nennt die Buchungsdatei nicht");
  assert.match(aufruf, /--karte <id>/, "der Aufruf nennt die Karte nicht");
  assert.ok(prueflauf < buchen, "gebucht wird vor dem Prueflauf — dann deckt die Zusammenfassung den Stand nicht");
  assert.ok(buchen < commit, "gebucht wird erst nach dem Commit");
  assert.match(PUSH_MAIN, /befunde\.mjs vorschlag --art/,
    "/push-main ruft 'befunde.mjs vorschlag --art' nicht");
});

test("[skills-36] der Buchungsblock von /push-main traegt keine eigene Nummer", () => {
  // Neun Schritte seit Issue #929: Der Worktree kam als Schritt 3 dazu, Rueckweg und Abbau
  // als Schritt 8 — beides sind eigene Handlungen mit eigener Wartezeit, kein Anhang.
  const nummern = [...PUSH_MAIN.matchAll(/^### (\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(nummern, [1, 2, 3, 4, 5, 6, 7, 8, 9], "die Schrittnummern des Skills haben sich verschoben");
  assert.equal((PUSH_MAIN.match(/^### /gm) ?? []).length, 9,
    "es gibt eine `###`-Ueberschrift, die keine der neun Schrittnummern traegt");
  assert.equal((PUSH_MAIN.match(/Schritt \d+ von 9/g) ?? []).length, 6,
    "die Zahl der nummerierten Fortschrittszeilen hat sich geaendert");

  const kopf = PUSH_MAIN.match(/^\*\*Befunde buchen.*\*\*/m);
  assert.ok(kopf, "der Block traegt keinen eigenen Kopf 'Befunde buchen'");
  assert.equal(/\d/.test(kopf[0]), false, `der Kopf des Blocks traegt eine Zahl: ${kopf[0]}`);
});

test("[skills-36] ohne Code-Review-Befunde entfaellt der Block ohne Vermerk", () => {
  const absatz = PUSH_MAIN.split("\n\n").find((a) => a.includes("Liegen keine Code-Review-Befunde vor"));
  assert.ok(absatz, "/push-main sagt nicht, was ohne Code-Review-Befunde geschieht");
  assert.match(absatz, /ohne Vermerk|unkommentiert/,
    "der Absatz sagt nicht, dass der entfallene Block keinen Vermerk hinterlaesst");
});

test("[skills-36] in beiden Skills haelt ein Fehlschlag von buchen oder vorschlag nichts auf", () => {
  for (const [name, text] of [["issue-review", ISSUE_REVIEW], ["push-main", PUSH_MAIN]]) {
    const absatz = text.split("\n\n").find((a) => /Fehlschlag/.test(a) && /buchen/.test(a) && /vorschlag/.test(a));
    assert.ok(absatz, `${name} sagt nicht, was ein Fehlschlag von 'buchen' oder 'vorschlag' bedeutet`);
    assert.match(absatz, /[Kk]ein Gate/, `${name} nennt die Buchung nicht ausdruecklich als kein Gate`);
    assert.match(absatz, /einer Zeile/, `${name} sagt nicht, dass der Fehlschlag in einer Zeile vermerkt wird`);
  }
});
