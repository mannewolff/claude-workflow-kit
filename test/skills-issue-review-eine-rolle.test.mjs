// Das Arbeitspaket wird nur noch von EINEM fremden Modell geprueft (Issue #282,
// fachliche Quelle #272).
//
// Der Grund ist kein Sparzwang: Zuschnitt, Abhaengigkeiten und Kollateralschaeden
// entscheiden sich im Plan und werden dort geprueft. Ein Pruefer, der nur ein
// einzelnes Paket sieht, kann sie ohnehin nicht beurteilen — belegt am 2026-08-08,
// wo drei der vier Scope-Befunde Fehlalarme an Abhaengigkeitsgrenzen waren.
//
// Was bleibt, ist die maschinelle Pruefbarkeit der Akzeptanzkriterien. Sie hat auf
// den oberen Stufen kein Gegenstueck — Akzeptanzkriterien entstehen erst beim
// Schreiben der Arbeitspakete.
//
// Geprueft wird Text, nicht Verhalten. Der Wert liegt darin, dass eine spaetere
// Umformulierung auffaellt, bevor wieder zwei Reviewer auf ein Arbeitspaket laufen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

/** Der Abschnitt einer Stufe: ab seiner `#### `-Ueberschrift bis zur naechsten Marke. */
function stufenAbschnitt(ueberschrift) {
  const idx = SKILL.indexOf(ueberschrift);
  assert.ok(idx >= 0, `Unterabschnitt '${ueberschrift}' fehlt`);
  const rest = SKILL.slice(idx + ueberschrift.length);
  const marken = ["\n#### ", "\n### ", "\n## ", "\n**Zuordnung und Fehlerpfad:**"]
    .map((m) => rest.indexOf(m))
    .filter((x) => x >= 0);
  const grenze = marken.length ? Math.min(...marken) : -1;
  return grenze >= 0 ? rest.slice(0, grenze) : rest;
}

const issueAbschnitt = () => stufenAbschnitt("#### Stufe `issue`");
const planAbschnitt = () => stufenAbschnitt("#### Stufe `plan`");

/** Der erste ```-Block nach einer Fundstelle innerhalb eines Abschnitts. */
function promptBlock(abschnitt, marke) {
  const idx = abschnitt.indexOf(marke);
  assert.ok(idx >= 0, `'${marke}' fehlt im Abschnitt`);
  const treffer = /```\n([\s\S]*?)```/.exec(abschnitt.slice(idx));
  assert.ok(treffer, `kein Promptblock nach '${marke}'`);
  return treffer[1];
}

test("der Ablauf ruft das stufenbezogene roles-Kommando fuer die Stufe issue", () => {
  assert.match(
    SKILL,
    /issue-review roles --stufe issue --author/,
    "das stufenbezogene Kommando fuer das Arbeitspaket steht nicht im Skill"
  );
});

test("das stufenlose reviewers-Kommando wird nirgends mehr aufgerufen", () => {
  // Es liefert per Definition zwei Reviewer. Solange es aufgerufen wird, laeuft
  // die Kernaussage dieses Issues ins Leere.
  const aufrufe = SKILL.split("\n").filter(
    (z) => /^\s*node\b/.test(z) && /issue-review reviewers/.test(z)
  );
  assert.deepEqual(aufrufe, [], `reviewers wird noch aufgerufen: ${aufrufe.join(" | ")}`);
});

test("die Stufe issue hat einen eigenen Unterabschnitt mit genau einer Rolle", () => {
  const a = issueAbschnitt();
  assert.match(
    a,
    /\*\*Rolle `pruefbarkeit`:\*\*/,
    "die vorgeschriebene Ueberschrift **Rolle `pruefbarkeit`:** fehlt"
  );
  // Die Rollen der anderen Stufen duerfen nicht hineinragen.
  for (const fremd of ["form-beobachtbarkeit", "abgrenzung", "architektur-bestand"]) {
    assert.ok(!a.includes(fremd), `der Issue-Abschnitt greift auf die Rolle '${fremd}' hinueber`);
  }
});

test("der Prompt der Rolle pruefbarkeit ist ausfuehrbar und vollstaendig", () => {
  const p = promptBlock(issueAbschnitt(), "**Rolle `pruefbarkeit`:**");
  assert.match(p, /maschinell prüfbar|maschinell pruefbar/i, "die maschinelle Pruefbarkeit fehlt");
  assert.match(
    p,
    /Manuelle Prüfung|Manuelle Pruefung/,
    "der Verweis auf den Block fuer manuelle Punkte fehlt — genau daran scheiterten am 2026-08-06 zwei Nacht-Sessions"
  );
  assert.match(p, /Was kann RAUS/i, "die Streich-Frage fehlt");
  assert.match(p, /BLOCKER \/ WICHTIG \/ HINWEIS/, "das Ausgabeformat fehlt");
  const platzhalter = [...p.matchAll(/\{\{ISSUE_BODY\}\}/g)];
  assert.equal(platzhalter.length, 1, `genau ein {{ISSUE_BODY}} erwartet, gefunden ${platzhalter.length}`);
});

test("der Scope-Prompt steht unter der Stufe plan und nicht mehr unter der Stufe issue", () => {
  const plan = planAbschnitt();
  const issue = issueAbschnitt();
  assert.match(plan, /schnitt-abhaengigkeiten|schnitt-abhängigkeiten/,
    "die Rolle schnitt-abhaengigkeiten fehlt unter der Stufe plan");
  const p = promptBlock(plan, "schnitt-abhaengigkeiten");
  assert.match(p, /\{\{ISSUE_BODY\}\}/, "der Plan-Prompt ist nicht ausfuehrbar");

  // Der Verweis auf die gewanderte Rolle gehoert ausdruecklich in den
  // Issue-Abschnitt; verboten ist nur der ausfuehrbare Prompt. Deshalb wird der
  // Inhalt geprueft, nicht die Nennung des Namens.
  assert.ok(!/Prüfe auf Scope und Risiko|Pruefe auf Scope und Risiko/i.test(issue),
    "die Scope-Pruefung steht noch im Issue-Abschnitt");
  assert.ok(!/Was bricht, das im Issue nicht steht\?/.test(issue),
    "die Bestandsfrage der alten Rolle B steht noch im Issue-Abschnitt");
  const bloecke = [...issue.matchAll(/```\n[\s\S]*?```/g)];
  assert.equal(bloecke.length, 1,
    `die Stufe issue hat genau einen Prompt, gefunden ${bloecke.length}`);
});

test("der Skill sagt, dass Rolle B gewandert und nicht gestrichen ist", () => {
  const satz = SKILL.split("\n").find(
    (z) => /Rolle B/.test(z) && /(gewandert|wandert)/i.test(z) && /(nicht gestrichen|kein Verlust|nicht verloren)/i.test(z)
  );
  assert.ok(satz, "ohne diesen Satz liest sich die Streichung wie ein Verlust");
  assert.match(satz, /plan|Plan/, "die Zielstufe der gewanderten Rolle ist nicht benannt");
});

test("der Ausfall des einen Reviewers ist als Sackgasse geregelt", () => {
  const a = issueAbschnitt();
  assert.match(a, /ausgefallen|ausfäll|ausfaell|Ausfall/i, "der Ausfall ist im Issue-Abschnitt nicht geregelt");
  assert.match(a, /Protokoll/i, "die Session laeuft nur noch zur Protokollierung — das fehlt");
  for (const [was, muster] of [
    ["keine Befunde", /keine\s+(Reviewer-)?Befunde/i],
    ["keine Synthese", /keine\s+Synthese/i],
    ["kein Body-Vorschlag", /kein(en)?\s+Body-Vorschlag/i],
    ["kein Marker", /nie ein Marker|kein Marker/i],
  ]) {
    assert.match(a, muster, `die Folge '${was}' ist nicht benannt`);
  }
});

test("der Legacy-Fallback ohne reviewStufen ist als solcher benannt", () => {
  assert.match(SKILL, /Legacy-Fallback ohne `?reviewStufen`?/,
    "der Fallback fuer Bestandsprojekte ist nicht benannt");
  const a = stufenAbschnitt("#### Legacy-Fallback ohne `reviewStufen`");
  assert.match(a, /stufenQuelle.*default|`default`/,
    "die ausloesende Bedingung (stufenQuelle: default) fehlt");
  // Der Scope-Prompt bleibt fuer diesen Fall erhalten — sonst waere fuer
  // Bestandsprojekte undefiniert, was mit der zweiten Rolle geschieht.
  assert.match(a, /scope-risiko-bestand/, "die zweite Legacy-Rolle fehlt");
  assert.match(a, /Was bricht, das im Issue nicht steht\?/,
    "der Scope-Prompt ist im Legacy-Fall verlorengegangen");
});

test("ein Rollenname ohne Prompt bricht vor dem Reviewer-Start ab", () => {
  const absatz = SKILL.split(/\n\n/).find(
    (a) => /Rollennamen?, zu dem es keinen Prompt gibt|Rollennamen ohne passenden Prompt/i.test(a)
  );
  assert.ok(absatz, "der Fehlerpfad fuer einen unbekannten Rollennamen fehlt");
  assert.match(absatz, /vor dem Reviewer-Start/i, "der Abbruchzeitpunkt ist nicht benannt");
});

test("keine issue-spezifische Stelle spricht mehr von zwei Reviewern", () => {
  // Aussagen zur zweifachen Pruefung sind auf den Stufen fachlich und plan sowie
  // im Legacy-Fallback weiterhin richtig — sie muessen den Bezug aber tragen.
  // Kein Satzzeichen zwischen Zahlwort und Nomen: sonst zaehlt "zwei Lagen ab:
  // Reviewer fehlt beim Vorflug" als Besetzungsaussage, obwohl es keine ist.
  const zwei = /\b(zwei|beide|beiden|beider)\b[^\n:,.;–—]{0,30}\b(Reviewer|Modelle|Rollen|Listen)\b/i;
  const zweiModelle = /\bZwei Modelle\b/;
  const erlaubt = /fachlich|`?plan`?|Legacy|Plandokument|Anforderung|Stufen/i;

  const treffer = SKILL.split("\n").filter(
    (z) => (zwei.test(z) || zweiModelle.test(z)) && !erlaubt.test(z)
  );
  assert.deepEqual(treffer, [], `Zwei-Reviewer-Annahme ohne Stufenbezug in: ${treffer.join(" | ")}`);
});

test("das Markerbeispiel des Arbeitspakets nennt einen Reviewer", () => {
  const beispiele = SKILL.split("\n").filter((z) => /^Issue-Review:\s+\w/.test(z.trim()));
  assert.ok(beispiele.length > 0, "kein Markerbeispiel fuer das Arbeitspaket");
  for (const z of beispiele) {
    const namen = z.replace(/^.*Issue-Review:\s*/, "").replace(/\(.*$/, "").trim();
    assert.ok(!namen.includes(","), `Markerbeispiel nennt mehrere Reviewer: ${z.trim()}`);
  }
});
