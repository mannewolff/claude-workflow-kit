// Tests fuer die Modell-Angabe in /plan und /issues (Issue #266).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell,
// das ihn liest. Wert haben sie trotzdem: Sie halten die Formulierungen fest, an
// denen andere Teile haengen (der Anker `Autor-Modell:` fuer /issue-review, die
// Zeile `Plan-Modell:` fuer die Uebernahme in /issues) und schlagen an, wenn
// jemand sie sinngemaess umschreibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (skill) => readFileSync(join(repoRoot, "skills", skill, "SKILL.md"), "utf-8");

test("/plan schreibt eine Plan-Modell-Zeile vor", () => {
  const text = lies("plan");
  assert.match(text, /Plan-Modell: /, "die Zeilenform fehlt");
  assert.match(text, /KIT_AGENT_MODEL/, "die Herkunft des Werts ist nicht benannt");
});

test("/plan #N hinterlaesst den Plan-Autor am fachlichen Issue", () => {
  const text = lies("plan");
  assert.match(text, /issue comment/, "das Kommando fuer den Kommentar fehlt");
  assert.match(text, /Plan erstellt von/, "der vorgeschriebene Kommentartext fehlt");
});

test("/issues nennt die Leitplanke statt nur der Konvention", () => {
  const text = lies("issues");
  assert.match(text, /--author-model/, "das Flag ist nicht dokumentiert");
  assert.match(text, /legt kein Issue an/, "die Wirkung der Leitplanke ist nicht benannt");
});

test("/issues uebernimmt das Plan-Modell und nennt die Abweichungsregel", () => {
  const text = lies("issues");
  assert.match(text, /Plan-Modell: /, "die uebernommene Zeile fehlt");
  assert.match(text, /Weichen sie ab, stehen beide/, "die Regel bei Abweichung fehlt");
});

test("die Autor-Modell-Zeile bleibt als Anker unveraendert", () => {
  // /issue-review sucht genau diesen Praefix. Wird er umformuliert, waehlt der
  // Review stillschweigend die falschen Pruefer.
  assert.match(lies("issues"), /`Autor-Modell: <wert>`/);
});
