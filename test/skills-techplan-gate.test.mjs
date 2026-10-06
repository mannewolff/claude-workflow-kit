// Das [Plan]-Gate in Skills und Dokumentation (Issue #276).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell, das
// ihn liest. Wert haben sie trotzdem: Der mechanische Teil des Gates sitzt im
// Nacht-Runner (test/ablauf-night-plan.test.mjs), der interaktive allein in diesen Texten.
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

test("kit/board.mjs: der Rueckstellungs-Kommentar begruendet [Plan] mit /issues #N", async () => {
  const { AUFTRAG_BACKLOG_TEXTE } = await import("../kit/board/dokumente.mjs");
  assert.equal(AUFTRAG_BACKLOG_TEXTE.plan("N"),
    "Plan-Dokument — wird nicht implementiert, bitte per /issues #N in Arbeitspakete ueberfuehren.");
});

for (const [name, text] of SKILLS) {
  // Seit Issue #1025 prueft `issue auftrag` das Praefix und liefert den Kommentar; der
  // Skill nennt das Praefix und handelt nach der Folge, der Wortlaut steht in kit/board.mjs.
  test(`${name}: nennt [Plan] und laesst den Auftrag das Urteil sprechen`, () => {
    assert.match(text, /\[Plan\]/, "das Praefix wird nicht genannt");
    assert.match(text, /board\.mjs issue auftrag <id>/, "der Auftrag, der das Gate prueft, fehlt");
  });

  test(`${name}: fuehrt [Plan] in den Stop-Punkten`, () => {
    const stopPunkte = text.slice(text.indexOf("## Stop-Punkte"));
    assert.ok(stopPunkte.length > 0, "der Abschnitt '## Stop-Punkte' fehlt");
    assert.match(stopPunkte, /\[Plan\]/,
      "die Stop-Punkte nennen [Plan] nicht — dort steht die Liste, an der sich der Skill misst");
  });
}

// Seit Issue #984 zaehlt das Gate vier Sorten: [Mensch] kam als Arbeitspaket hinzu, das
// nur ein Mensch erledigen kann. Die Zaehlung bleibt gepruefte Zusicherung — eine Doku, die
// drei nennt und vier aufzaehlt, laesst den Leser die fehlende selbst suchen.
test("dokumentation: das Gate kennt vier Sorten, [Plan] und [Mensch] eingeschlossen", () => {
  const doku = lies("docs", "dokumentation.md");
  for (const veraltet of [/Zwei Sorten/, /Drei Sorten/]) {
    assert.doesNotMatch(doku, veraltet, "die Zaehlung stimmt nicht mehr — es sind vier Sorten");
  }
  assert.match(doku, /Vier Sorten/, "die neue Zaehlung fehlt");
  assert.match(doku, /\[Plan\]/, "das Praefix [Plan] wird nicht genannt");
  assert.match(doku, /\[Mensch\]/, "das Praefix [Mensch] wird nicht genannt");
});

// Seit Stufe 2 des Prozess-Umbaus (Plan #638, Issue #646) gibt es keine Stufenwahl
// mehr: Die Nacht-Kette nimmt genau [Fachlich]-Issues als Eingang; [Idee] und [Plan]
// sind damit keine Kandidaten, ohne dass ein eigener Ausschluss noetig waere. Die Doku
// muss den Eingang nennen und keinen der entfallenen Stufen-Schalter mehr.
test("dokumentation: der Abschnitt zur Nacht-Kette nennt [Fachlich] als einzigen Eingang", () => {
  const doku = lies("docs", "dokumentation.md");
  const idx = doku.indexOf("### Zweiter Modus: die Nacht-Kette");
  assert.ok(idx >= 0, "der Abschnitt zur Nacht-Kette fehlt");
  const kette = doku.slice(idx).split(/\n### /)[0];
  assert.match(kette, /hat den Titel `\[Fachlich\]`/, "der Eingang [Fachlich] fehlt");
  assert.doesNotMatch(doku, /--stufe <fachlich\|plan\|issue>/, "der entfallene Stufen-Schalter steht noch in der Doku");
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
