// Das Plan-Dokument als [Plan]-Issue in /plan (Issue #275).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell, das
// ihn liest. Wert haben sie trotzdem: Zwei der Vorgaben scheitern sonst erst zur
// Laufzeit und nur interaktiv. Faellt `--author-model` aus dem Anlege-Kommando,
// lehnt der Adapter den Body ab (kit/board.mjs, Autor-Modell-Leitplanke aus Issue
// #266) — ein Plan-Body traegt `Plan-Modell:`, nicht `Autor-Modell:`. Und faellt der
// praezisierte Stop-Punkt zurueck auf "keine Issues", widerspricht der Skill genau
// dem Schritt, den er selbst beschreibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...pfad) => readFileSync(join(repoRoot, ...pfad), "utf-8");

const SKILL = lies("skills", "plan", "SKILL.md");
const DOKU = lies("docs", "dokumentation.md");

// Der Block, der das Issue anlegt — der einzige ```bash-Block mit `issue create`.
function anlegeKommando(text) {
  const bloecke = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((t) => t[1]);
  const treffer = bloecke.filter((b) => /issue create/.test(b));
  assert.equal(treffer.length, 1,
    `erwartet genau einen bash-Block mit 'issue create', gefunden: ${treffer.length}`);
  return treffer[0];
}

const stopPunkt = () => SKILL.slice(SKILL.indexOf("## Stop-Punkt"));

test("der Skill legt das Plan-Dokument mit dem Titel-Praefix [Plan] an", () => {
  assert.match(SKILL, /\[Plan\] /,
    "das Titel-Praefix fehlt — daran erkennen die uebrigen Skills und der Nacht-Runner Plandokumente");
  assert.match(SKILL, /Plan-Dokument/,
    "der Begriff fehlt — ohne ihn ist unklar, was angelegt wird");
});

test("die Titelherkunft ist festgelegt: Quell-Issue ohne [Fachlich], sonst aus dem Ziel", () => {
  assert.match(SKILL, /ohne dessen `\[Fachlich\]`-Präfix/,
    "die Titelherkunft bei /plan #N fehlt — das Praefix wuerde sonst mitgeschleppt");
  assert.match(SKILL, /`## Ziel`-Abschnitts/,
    "die Titelherkunft ohne Quell-Issue fehlt");
});

test("der Body ist der freigegebene Plan im verbindlichen Format", () => {
  const abschnitt = SKILL.slice(SKILL.indexOf("### 5."));
  assert.match(abschnitt, /freigegebene[nr]? Plan/,
    "der Bezug auf den freigegebenen Plan fehlt");
  assert.match(abschnitt, /alle sechs Abschnitte/i,
    "der Bezug auf das Sechs-Abschnitt-Format aus Schritt 3 fehlt");
});

test("Plan-Modell steht immer im Kopf, Fachliche Quelle nur bei /plan #N", () => {
  const abschnitt = SKILL.slice(SKILL.indexOf("### 5."));
  assert.match(abschnitt, /`Plan-Modell: [^`]*` — \*\*immer\*\*/,
    "die Unbedingtheit von `Plan-Modell:` ist nicht ausgesprochen");
  assert.match(abschnitt, /`Fachliche Quelle: Issue #N` — \*\*nur\*\*/,
    "die Bedingtheit von `Fachliche Quelle:` ist nicht ausgesprochen");
  assert.match(abschnitt, /Bei einem Plan aus dem Chat fehlt diese Zeile/,
    "der Gegenfall fehlt — sonst schreibt der Skill die Zeile auch ohne Quelle");
});

test("das Anlege-Kommando nutzt --body - und --author-model", () => {
  const kommando = anlegeKommando(SKILL);
  assert.match(kommando, /--body -(?:\s|$)/,
    "der Body geht nicht ueber stdin — lange Plaene laufen in die Quoting-Grenze (Issue #271)");
  assert.match(kommando, /--author-model /,
    "ohne --author-model lehnt der Adapter den Body ab: ein Plan-Body traegt `Plan-Modell:`, nicht `Autor-Modell:`");
});

test("die Pflicht zu --author-model ist begruendet, nicht nur im Kommando versteckt", () => {
  assert.match(SKILL, /\*\*`--author-model` ist Pflicht/,
    "die Pflicht steht nur im Kommando — bei einer Umformulierung faellt sie unbemerkt weg");
  assert.match(SKILL, /Autor-Modell:/,
    "die Leitplanke, an der es sonst scheitert, wird nicht benannt");
});

test("bei Bahn 1 entsteht kein Plan-Dokument", () => {
  assert.match(SKILL, /\*\*Bei Bahn 1 entsteht kein Plan-Dokument\.\*\*/,
    "die Ausnahme fuer Bahn 1 fehlt — sonst entsteht je Kleinigkeit ein leeres [Plan]-Ticket");
});

test("der ideaId/pending-Fall des Ideen-Pools ist beschrieben", () => {
  assert.match(SKILL, /ideaId/,
    "der Ideen-Pool-Fall fehlt — der Skill meldete dort 'undefined' statt einer Nummer");
  assert.match(SKILL, /pending/,
    "das Kennzeichen des Ideen-Pool-Falls fehlt");
  assert.match(SKILL, /einplan/i,
    "der Hinweis fehlt, dass der Mensch das Plan-Dokument erst einplanen muss");
});

test("der Fehlerfall beim Anlegen meldet weder Nummer noch Erfolg", () => {
  assert.match(SKILL, /Schlägt das Anlegen fehl/,
    "der Fehlerfall fehlt");
  assert.match(SKILL, /weder eine Nummer noch einen erfolgreichen Abschluss/,
    "die Konsequenz des Fehlerfalls ist nicht benannt");
});

test("der Stop-Punkt traegt die praezisierte Fassung", () => {
  const punkt = stopPunkt();
  assert.match(punkt, /keine \*\*technischen\*\* Issues/,
    "der Stop-Punkt verbietet weiterhin pauschal Issues und widerspricht damit Schritt 5");
  assert.match(punkt, /keine Ready-Bewegung/,
    "die Ready-Grenze fehlt in der neuen Fassung");
  assert.match(punkt, /Das `\[Plan\]`-Dokument ist die einzige Ausnahme/,
    "die Ausnahme fuer das Plan-Dokument ist nicht ausgesprochen");
  assert.match(punkt, /nicht dessen Umsetzung vorwegnimmt/,
    "die Begruendung der Ausnahme fehlt — ohne sie liest sie sich als Aufweichung");
});

test("der alte, widerspruechliche Stop-Punkt-Wortlaut ist weg", () => {
  assert.doesNotMatch(SKILL, /keine Issues — erst nach explizitem GO/,
    "der alte Wortlaut schliesst genau das aus, was Schritt 5 verlangt");
});

test("dokumentation: der /plan-Abschnitt widerspricht dem Anlegen nicht mehr", () => {
  const von = DOKU.indexOf("### /plan");
  assert.ok(von > -1, "der Abschnitt '### /plan' fehlt in docs/dokumentation.md");
  const abschnitt = DOKU.slice(von, DOKU.indexOf("### /issues", von));

  assert.doesNotMatch(abschnitt, /Er stellt keine Issues an/,
    "der Satz ist seit Issue #275 unwahr — bei Bahn 2 legt der Skill das [Plan]-Dokument an");
  assert.match(abschnitt, /\[Plan\]/,
    "das Plan-Dokument wird im /plan-Abschnitt nicht erwaehnt");
  assert.match(abschnitt, /technische Issues/i,
    "die verbleibende Grenze — keine technischen Issues — ist nicht benannt");
});
