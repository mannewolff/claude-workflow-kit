// Tests fuer den unbeaufsichtigten Eingang von /issues (Issue #524).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell,
// das ihn liest. Wert haben sie trotzdem: Schritt 1 ist die eine Stelle, an der
// der zweite naechtliche Schritt der Kette (Issue #513) haengt. Ein `[Plan]`-Dokument
// aus der Vornacht ist kein „in dieser Session freigegebener Plan"; faellt die
// unbeaufsichtigte Variante weg oder rutscht sie unter die interaktive, endet jede
// Nacht-Session vor dem ersten Arbeitspaket — die Session liest von oben und handelt
// nach dem ersten Fall, den sie findet (#513, A7).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issues", "SKILL.md"), "utf-8");

// Der Pruefbereich ist Schritt 1 — von seiner Ueberschrift bis zur naechsten.
// Ein Anker, der irgendwo sonst im Skill steht, zaehlt nicht: Was unbeaufsichtigt
// gilt, muss an der Stelle stehen, an der gehandelt wird.
function schrittEins(text) {
  const start = text.indexOf("### 1. Plan prüfen");
  assert.ok(start > -1, "die Ueberschrift `### 1. Plan prüfen` fehlt");
  const ende = text.indexOf("### 2. Issues schneiden", start);
  assert.ok(ende > -1, "die Ueberschrift `### 2. Issues schneiden` fehlt");
  return text.slice(start, ende);
}

const ANKER = [
  ["KIT_AGENT_MODEL", "das Erkennungsmerkmal der unbeaufsichtigten Variante fehlt"],
  ["/issues #N", "der Eingang als Issue-Nummer fehlt — ohne ihn ist unklar, was gelesen wird"],
  ["- Keine.", "die Bedingung an `## Offene Fragen` fehlt"],
  ["Kein Eingang für /issues:", "der Fehlerpfad ohne Ansprache an einen Menschen fehlt"],
];

for (const [anker, warum] of ANKER) {
  test(`Schritt 1 nennt \`${anker}\` woertlich`, () => {
    assert.ok(schrittEins(SKILL).includes(anker), warum);
  });
}

test("die unbeaufsichtigte Variante steht vor der interaktiven", () => {
  const block = schrittEins(SKILL);
  const unbeaufsichtigt = block.indexOf("KIT_AGENT_MODEL");
  const interaktiv = block.indexOf("dieser Session");
  assert.ok(unbeaufsichtigt > -1, "`KIT_AGENT_MODEL` fehlt in Schritt 1");
  assert.ok(interaktiv > -1, "die interaktive Bedingung `dieser Session` fehlt in Schritt 1");
  assert.ok(
    unbeaufsichtigt < interaktiv,
    "die interaktive Variante steht zuerst — eine Session liest von oben und handelt nach dem ersten Fall, den sie findet (#513, A7)",
  );
});

test("das Ready-Ziehen bleibt menschlich", () => {
  // Der erweiterte Eingang aendert nichts am Stop-Punkt: Kein Arbeitspaket landet
  // in Ready, auch nachts nicht.
  assert.match(SKILL, /Status bleibt \*\*Backlog\*\*/,
    "der Satz `Status bleibt **Backlog**` in Schritt 3 fehlt");
});

test("[skills-14] der Eingang ist ein [Plan] ohne offene Stopp-Frage, kein Marker", () => {
  // Seit Issue #631 ist der Marker eine Spur, kein Gate: Ob der Plan geprueft wurde,
  // entscheidet der Mensch mit dem Routing-Label.
  const block = schrittEins(SKILL);
  assert.doesNotMatch(block, /Plan-Review:/, "der Marker steht noch als Bedingung da");
  assert.match(block, /- Keine\./, "die Bedingung an `## Offene Fragen` fehlt");
  assert.match(block, /Routing-Label/, "wer ueber die Freigabe entscheidet, steht nicht da");
  assert.match(block, /offene Stopp-Frage/, "der Fehlerpfad nennt die Stopp-Frage nicht");
});
