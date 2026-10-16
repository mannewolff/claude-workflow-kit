// Das [Plan]-Gate in Skills und Dokumentation (Issue #276).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell, das
// ihn liest. Wert haben sie trotzdem: Der mechanische Teil des Gates sitzt im
// Nacht-Runner (test/ablauf-night-plan.test.mjs), der interaktive allein in diesen Texten.
// Faellt die Passage bei einer Umformulierung heraus, implementiert /implement-next
// wieder Plandokumente — und niemand merkt es, weil kein Code kaputtgeht.
//
// Absichtlich NICHT geprueft: implement-test und implement-done. Sie tragen heute
// keinerlei [Requirement]/[Idea]-Erwaehnung, und docs/runner.md nennt ausdruecklich
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
  // Seit Issue #1025 prueft `issue brief` das Praefix und liefert den Kommentar; der
  // Skill nennt das Praefix und handelt nach der Folge, der Wortlaut steht in kit/board.mjs.
  test(`${name}: nennt [Plan] und laesst den Auftrag das Urteil sprechen`, () => {
    assert.match(text, /\[Plan\]/, "das Praefix wird nicht genannt");
    assert.match(text, /board\.mjs issue brief <id>/, "der Auftrag, der das Gate prueft, fehlt");
  });

  test(`${name}: fuehrt [Plan] in den Stop-Punkten`, () => {
    const stopPunkte = text.slice(text.indexOf("## Stop-Punkte"));
    assert.ok(stopPunkte.length > 0, "der Abschnitt '## Stop-Punkte' fehlt");
    assert.match(stopPunkte, /\[Plan\]/,
      "die Stop-Punkte nennen [Plan] nicht — dort steht die Liste, an der sich der Skill misst");
  });
}

// Das Gate zaehlt vier Sorten, [Human] ist ein Arbeitspaket, das nur ein Mensch erledigen
// kann. Die Zaehlung ist gepruefte Zusicherung — eine Doku, die drei nennt und vier
// aufzaehlt, laesst den Leser die fehlende selbst suchen.
test("prozess: das Gate kennt vier Sorten, [Plan] und [Human] eingeschlossen", () => {
  const doku = lies("docs", "prozess.md");
  for (const veraltet of [/Zwei Sorten/, /Drei Sorten/]) {
    assert.doesNotMatch(doku, veraltet, "die Zaehlung stimmt nicht mehr — es sind vier Sorten");
  }
  assert.match(doku, /Vier Sorten/, "die neue Zaehlung fehlt");
  assert.match(doku, /\[Plan\]/, "das Praefix [Plan] wird nicht genannt");
  assert.match(doku, /\[Human\]/, "das Praefix [Human] wird nicht genannt");
});

// Seit Stufe 2 des Prozess-Umbaus (Plan #638, Issue #646) gibt es keine Stufenwahl
// mehr: Die Nacht-Kette nimmt genau [Requirement]-Issues als Eingang; [Idea] und [Plan]
// sind damit keine Kandidaten, ohne dass ein eigener Ausschluss noetig waere. Die Doku
// muss den Eingang nennen und keinen der entfallenen Stufen-Schalter mehr.
test("dokumentation: der Abschnitt zur Kette nennt [Requirement] als einzigen Eingang", () => {
  const doku = lies("docs", "runner.md");
  const idx = doku.indexOf("## Die Kette\n");
  assert.ok(idx >= 0, "der Abschnitt zur Kette fehlt");
  const kette = doku.slice(idx).split(/\n## /)[0];
  // Die Doku nennt den Eingang bis zu ihrer Umstellung (Plan #1548, Issue #1573) unter dem deutschen Praefix.
  assert.match(kette, /hat den Titel `\[(?:Requirement|Fachlich)\]`/, "der Eingang [Requirement] fehlt");
  assert.doesNotMatch(doku, /--stufe <fachlich\|plan\|issue>/, "der entfallene Stufen-Schalter steht noch in der Doku");
});

// Seit Issue #279 schliesst /issue-review [Requirement] und [Plan] NICHT mehr aus --
// sie bestimmen dort die Pruefstufe. Der frueher hier gepruefte Gleichlauf der
// Ausschlussliste gilt deshalb nur noch fuer den [Idea]-Fall. Was das Gate
// tatsaechlich schuetzt, prueft test/skills-issue-review-stufen.test.mjs: dass
// kein Ausschluss von [Requirement]/[Plan] stehen geblieben ist, und dass der Anker
// `Issue-Review:` dem Arbeitspaket vorbehalten bleibt.
test("issue-review: schliesst nur noch [Idea] aus, [Plan] bestimmt die Stufe", () => {
  const skill = lies("skills", "issue-review", "SKILL.md");
  assert.match(skill, /\[Idea\]/, "der [Idea]-Ausschluss fehlt");
  const ausschluss = skill
    .split("\n")
    .filter(
      (z) =>
        /(uebersprungen|übersprungen|kein Review von)/i.test(z) &&
        /\[Requirement\]|\[Plan\]/.test(z) &&
        !/nicht mehr|bestimmen dagegen|bestimmen die (Prüf|Pruef)stufe|ohnehin nicht vor/i.test(z)
    );
  assert.deepEqual(ausschluss, [], `[Requirement]/[Plan] werden noch ausgeschlossen: ${ausschluss.join(" | ")}`);
});

// Das Szenarien-Gate F12 am Eingang von /techplan (Issue #1594, Plan #1588 E6): Es steht
// vor dem Anlegen des Plandokuments, sonst entsteht der Plan, bevor der Grund fehlt.
test("techplan: das Gate F12 steht vor dem Anlegen des Plandokuments", () => {
  const techplan = lies("skills", "techplan", "SKILL.md");
  const gate = techplan.indexOf("issue check-form <N>");
  assert.ok(gate > -1, "die Formpruefung am Eingang fehlt");
  assert.ok(gate < techplan.indexOf("### 5. Plan-Dokument anlegen"), "das Gate steht hinter dem Anlegen");
});
