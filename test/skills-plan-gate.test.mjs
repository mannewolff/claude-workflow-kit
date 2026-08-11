// Das [Plan]-Gate in Skills und Dokumentation (Issue #276).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell, das
// ihn liest. Wert haben sie trotzdem: Der mechanische Teil des Gates sitzt im
// Nacht-Runner (test/night-plan.test.mjs), der interaktive allein in diesen Texten.
// Faellt die Passage bei einer Umformulierung heraus, implementiert /implement-next
// wieder Plandokumente — und niemand merkt es, weil kein Code kaputtgeht.
//
// Absichtlich NICHT geprueft: implement-test und implement-done. Sie tragen heute
// keinerlei [Fachlich]/[Idee]-Erwaehnung, und docs/dokumentation.md nennt ausdruecklich
// nur /implement-ready, /implement-next und den Nacht-Runner als Traeger der
// mechanischen Leitplanke. Die Auslassung ist Konvention, kein Versehen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...pfad) => readFileSync(join(repoRoot, ...pfad), "utf-8");

const SKILLS = [
  ["implement-ready", lies("skills", "implement-ready", "SKILL.md")],
  ["implement-next", lies("skills", "implement-next", "SKILL.md")],
];

for (const [name, text] of SKILLS) {
  test(`${name}: nennt [Plan], begruendet es und untersagt die Implementierung`, () => {
    assert.match(text, /\[Plan\]/, "das Praefix wird nicht genannt");
    assert.match(text, /beschreibt (?:nur )?einen Weg/i,
      "die Begruendung fehlt — ein Plan beschreibt einen Weg, er ist keine Aufgabe");
    assert.match(text, /\/issues #N/, "der Hinweis auf die Zerlegung per /issues #N fehlt");
    assert.match(text, /Plan-Dokument — wird nicht implementiert, bitte per \/issues #N in Arbeitspakete ueberfuehren\./,
      "der woertliche Kommentartext fuer die Rueckstellung fehlt");
  });

  test(`${name}: fuehrt [Plan] in den Stop-Punkten`, () => {
    const stopPunkte = text.slice(text.indexOf("## Stop-Punkte"));
    assert.ok(stopPunkte.length > 0, "der Abschnitt '## Stop-Punkte' fehlt");
    assert.match(stopPunkte, /\[Plan\]/,
      "die Stop-Punkte nennen [Plan] nicht — dort steht die Liste, an der sich der Skill misst");
  });
}

test("dokumentation: das Gate kennt drei Sorten, [Plan] eingeschlossen", () => {
  const doku = lies("docs", "dokumentation.md");
  assert.doesNotMatch(doku, /Zwei Sorten/,
    "die Zaehlung stimmt nicht mehr — mit [Plan] sind es drei Sorten");
  assert.match(doku, /Drei Sorten/, "die neue Zaehlung fehlt");
  assert.match(doku, /\[Plan\]/, "das Praefix wird nicht genannt");
});

// Seit Issue #283 haengt es von --stufe ab, was der Nacht-Review nimmt: [Plan] ist
// nur in der Default-Stufe uebersprungen, in der Stufe `plan` ist es genau das
// Ziel. Der frueher hier gepruefte Pauschalsatz waere jetzt falsch. Was bleibt:
// [Idee] ist in JEDER Stufe ausgeschlossen, und die Doku muss die Stufen nennen.
test("dokumentation: der --review-Abschnitt nennt die drei Stufen und den [Idee]-Ausschluss", () => {
  const doku = lies("docs", "dokumentation.md");
  assert.match(doku, /--stufe <fachlich\|plan\|issue>/, "das Flag fehlt in der Doku");
  assert.match(doku, /Default `issue`/, "der Default fehlt");
  assert.match(doku, /`\[Idee\]` bleibt in jeder Stufe ausgeschlossen/,
    "der stufenuebergreifende [Idee]-Ausschluss fehlt");
});

// Seit Issue #279 schliesst /issue-review [Fachlich] und [Plan] NICHT mehr aus --
// sie bestimmen dort die Pruefstufe. Der frueher hier gepruefte Gleichlauf der
// Ausschlussliste gilt deshalb nur noch fuer den [Idee]-Fall. Was das Gate
// tatsaechlich schuetzt, prueft test/skills-issue-review-stufen.test.mjs: dass
// kein Ausschluss von [Fachlich]/[Plan] stehen geblieben ist, und dass der Anker
// `Issue-Review:` dem Arbeitspaket vorbehalten bleibt.
test("issue-review: schliesst nur noch [Idee] aus, [Plan] bestimmt die Stufe", () => {
  const skill = lies("skills", "issue-review", "SKILL.md");
  assert.match(skill, /\[Idee\]/, "der [Idee]-Ausschluss fehlt");
  const ausschluss = skill
    .split("\n")
    .filter(
      (z) =>
        /(uebersprungen|übersprungen|kein Review von)/i.test(z) &&
        /\[Fachlich\]|\[Plan\]/.test(z) &&
        !/nicht mehr|bestimmen dagegen|bestimmen die (Prüf|Pruef)stufe|ohnehin nicht vor/i.test(z)
    );
  assert.deepEqual(ausschluss, [], `[Fachlich]/[Plan] werden noch ausgeschlossen: ${ausschluss.join(" | ")}`);
});
