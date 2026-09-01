// Tests fuer den Pruef-Aufruf in `/local-check` (Issue #427).
//
// Der Skill ist Schritt 6 und laeuft NACH dem lokalen Commit — deshalb ist sein
// Anker ein anderer als der der implement-Skills. Der Default `HEAD` waere hier
// schaedlich: Auf sauberem Tree saehe `git diff HEAD` nichts, das Kommando
// meldete `leeresPaket` und liesse jede Pruefung aus, waehrend der Bericht das
// als korrekt auswiese. Richtig ist `git merge-base HEAD origin/<mainBranch>`:
// alles, was seit dem letzten Push dazugekommen ist.
//
// Geprueft wird Text, nicht Verhalten — wie in
// `test/skills-implement-checks.test.mjs`. Der Wert liegt darin, dass eine
// spaetere Umformulierung auffaellt, bevor sie einen Push ungeprueft durchlaesst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "local-check", "SKILL.md"), "utf-8");

test("der Skill ruft checks.mjs run auf", () => {
  assert.match(SKILL, /node \.claude\/kit\/checks\.mjs run/,
    "der Aufruf `checks.mjs run` fehlt — der Skill arbeitet die buildChecks noch selbst ab");
});

// Der Kern des Issues. Eine blosse Negativ-Assertion auf `HEAD` waere falsch:
// Das gewollte Kommando `git merge-base HEAD origin/main` enthaelt das Wort
// woertlich. Geprueft wird deshalb je Fundstelle.
test("jedes --since im Skill traegt einen merge-base-Anker", () => {
  const zeilen = SKILL.split("\n").filter((z) => z.includes("--since"));
  assert.ok(zeilen.length > 0, "der Skill uebergibt gar kein `--since` — ohne Anker gilt der Default HEAD");
  for (const zeile of zeilen) {
    assert.match(zeile, /git merge-base/,
      `ein --since ohne merge-base-Anker: ${zeile.trim()}`);
  }
});

test("der Skill nennt HEAD nirgends als Anker", () => {
  assert.doesNotMatch(SKILL, /--since\s+"?HEAD"?/,
    "`--since HEAD` steht im Skill — nach dem Commit meldete das leeresPaket und liesse alles aus");
});

// Ohne den Config-Bezug bliebe `<mainBranch>` ein Platzhalter ohne Herkunft.
// Die Push-Skills lesen ihn seit jeher aus derselben Datei.
test("der Skill liest mainBranch aus der Config", () => {
  assert.match(SKILL, /`mainBranch`/,
    "das Feld `mainBranch` wird nirgends genannt");
  assert.match(SKILL, /mainBranch[\s\S]{0,200}workflow\.config\.json|workflow\.config\.json[\s\S]{0,200}mainBranch/,
    "es steht nicht, dass `<mainBranch>` aus `.claude/workflow.config.json` kommt");
});

// Kriterium 11 aus Issue #420, zweite Haelfte am Skill: Nur die Laeufe zu nennen
// genuegt nicht — ein verkuerzter Lauf saehe sonst aus wie ein vollstaendiger.
test("das Berichtsformat nennt gelaufene und ausgelassene Pruefungen", () => {
  const start = SKILL.indexOf("## Ergebnis");
  assert.notEqual(start, -1, "der Abschnitt '## Ergebnis' fehlt");
  const ergebnis = SKILL.slice(start);

  assert.match(ergebnis, /ausgelassen/i,
    "die Ergebnis-Checklist weist ausgelassene Pruefungen nicht aus");
  assert.match(ergebnis, /Grund/i,
    "zu den Auslassungen fehlt der Grund");
  // Das bestehende Checklist-Format bleibt (entschieden am 2026-09-01) — die
  // Auslassung kommt als eigene Zeile mit eigenem Zeichen hinzu.
  assert.match(ergebnis, /^-\s*✅/m,
    "das bestehende Checklist-Format mit ✅ wurde ersetzt statt ergaenzt");
});

// Die Zusicherung selbst steht in Issue #423. Hier wird sie benannt, damit
// niemand sie im Skill "vereinfacht" — etwa indem er den leeren Anker auf HEAD
// zurueckfallen laesst.
test("der Skill benennt den leeren Anker als Fall fuer den vollen Umfang", () => {
  const absatz = SKILL.split(/\n\n/).find((a) => /merge-base/.test(a) && /leer/i.test(a));
  assert.ok(absatz, "kein Absatz zum Randfall des leeren Ankers");
  assert.match(absatz, /voll/i,
    "es steht nicht, dass ein leerer Anker den vollen Umfang faehrt");
  assert.match(absatz, /(nie|nicht) wie eine?n? fehlend/i,
    "die Abgrenzung zum fehlenden Anker fehlt");
  assert.match(absatz, /Default `?HEAD`?/,
    "es steht nicht, wozu ein fehlender Anker fuehren wuerde (Default HEAD)");
});

// Entscheidung A7 des Plans: `mutationCommand` steht nicht in `buildChecks` und
// ist im Bestand nachgelagert. Ohne diesen Satz liest es jemand spaeter als
// Luecke und zieht es in die Auswahl.
test("der Skill weist mutationCommand als unveraendert immer laufend aus", () => {
  // Nicht am blossen Wort "Mutations-Test" ansetzen: Das faellt in die
  // Feldliste der Vorbedingung und schnitte den falschen Abschnitt.
  const start = SKILL.search(/### \d+\. Mutations-Test/);
  assert.notEqual(start, -1, "der Mutations-Test-Abschnitt fehlt");
  const abschnitt = SKILL.slice(start).split(/\n### /)[0];
  assert.match(abschnitt, /nicht Teil der Auswahl|nicht in die Auswahl|nicht Teil der bereichsbezogenen/i,
    "es steht nicht, dass `mutationCommand` ausserhalb der bereichsbezogenen Auswahl liegt");
  assert.match(abschnitt, /unver(ä|ae)ndert|weiterhin|wie bisher/i,
    "es steht nicht, dass `mutationCommand` unveraendert bleibt");
  assert.match(abschnitt, /immer/i,
    "es steht nicht, dass `mutationCommand` immer laeuft");
});

// Der Format-Fix-Pfad bleibt (Punkt 3 des Issues): ein Fix, ein zweiter Lauf —
// derselbe Aufruf mit demselben Anker.
test("der Format-Fix-Pfad wiederholt denselben checks.mjs-Aufruf genau einmal", () => {
  const start = SKILL.indexOf("### 1b.");
  assert.notEqual(start, -1, "der Format-Fix-Abschnitt 1b fehlt");
  const abschnitt = SKILL.slice(start).split(/\n### /)[0];
  assert.match(abschnitt, /genau einmal/,
    "die Grenze 'genau einmal' fehlt im Format-Fix-Abschnitt");
  assert.match(abschnitt, /checks\.mjs run/,
    "der zweite Lauf nennt den checks.mjs-Aufruf nicht");
  assert.match(abschnitt, /demselben Anker|dieselbe[nr]? Anker|gleichen Anker/i,
    "es steht nicht, dass der zweite Lauf denselben Anker verwendet");
});

// Punkt 5 des Issues: der Hinweis bei leerer buildChecks-Liste bleibt.
test("der Hinweis bei leerer buildChecks-Liste bleibt erhalten", () => {
  assert.match(SKILL, /Keine buildChecks konfiguriert/,
    "der Hinweis fuer eine leere buildChecks-Liste wurde entfernt");
});
