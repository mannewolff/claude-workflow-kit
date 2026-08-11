// Drei Pruefstufen in /issue-review (Issue #279, fachliche Quelle #272).
//
// Der Skill prueft heute genau eine Sorte Dokument. Kuenftig sind es drei, und er
// muss erkennen, welche vor ihm liegt — sonst prueft er einen Plan mit den Fragen
// eines Arbeitspakets. Das saehe am Board wie eine bestandene Pruefung aus.
//
// Der heiklere Teil ist der Nachweis: An `Issue-Review:` haengt in kit/night.mjs
// das Implementierungs-Gate `requiredBeforeReady`. Truege ein fachliches Dokument
// denselben Marker, hielte der Runner es fuer freigabereif. Deshalb drei getrennte
// Marker und ein Test, der den Anker gegen die anderen beiden verteidigt.
//
// Geprueft wird Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell,
// das ihn liest. Der mechanische Teil (hasReviewMarker) sitzt weiter unten.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");
const SKILL = lies("skills", "issue-review", "SKILL.md");

test("Schritt 1b ordnet die drei Stufen ihren Titel-Praefixen zu", () => {
  assert.match(SKILL, /###\s*1b\.?\s*Stufe bestimmen/i, "Schritt 1b fehlt");
  const abschnitt = SKILL.split(/###\s*1b\.?\s*Stufe bestimmen/i)[1].split(/\n### /)[0];
  assert.match(abschnitt, /\[Fachlich\][^\n]*fachlich/i, "Zuordnung [Fachlich] -> fachlich fehlt");
  assert.match(abschnitt, /\[Plan\][^\n]*plan/i, "Zuordnung [Plan] -> plan fehlt");
  assert.match(abschnitt, /issue/i, "die Vorgabestufe issue fehlt");
  assert.match(abschnitt, /\[Idee\]/, "der fortbestehende [Idee]-Ausschluss fehlt");
});

test("das roles-Kommando steht woertlich im Skill, samt Paarung", () => {
  assert.match(SKILL, /issue-review roles/, "das Kommando fehlt");
  assert.match(SKILL, /--stufe/, "--stufe fehlt");
  assert.match(SKILL, /--author/, "--author fehlt");
  assert.match(SKILL, /gewaehlt\[i\][^\n]*rollen\[i\]|`gewaehlt`[^\n]*`rollen`/,
    "die Paarung von gewaehlt und rollen ist nicht beschrieben");
});

test("die drei Marker-Formen stehen im Skill", () => {
  for (const marker of ["Fachplan-Review:", "Plan-Review:", "Issue-Review:"]) {
    assert.ok(SKILL.includes(marker), `Marker-Form fehlt: ${marker}`);
  }
});

test("Issue-Review: bleibt ausdruecklich dem Arbeitspaket vorbehalten", () => {
  const absatz = SKILL.split(/\n\n/).find(
    (a) => /Issue-Review:/.test(a) && /(vorbehalten|ausschliesslich|ausschließlich)/i.test(a)
  );
  assert.ok(absatz, "keine Aussage, dass der Anker dem Arbeitspaket vorbehalten bleibt");
  assert.match(absatz, /Freigabe|Umsetzung/i, "der Grund (Freigabe zur Umsetzung) fehlt");
});

// Der Ausschluss stand an vier Stellen. Bleibt eine stehen, waehlt der Skill dort
// weiterhin aus — und die Stufenwahl ist an genau dieser Stelle wirkungslos.
test("weder [Fachlich] noch [Plan] werden noch irgendwo ausgeschlossen", () => {
  // Die Verneinung muss durchgelassen werden: Saetze, die den Nicht-Ausschluss
  // erklaeren ("werden nicht mehr uebersprungen"), sind genau das Gegenteil
  // eines Ausschlusses. Gesucht sind nur Zeilen, die [Fachlich] oder [Plan] in
  // einer AUFZAEHLUNG des Ausschlusses fuehren.
  const verneint = /nicht mehr|bestimmen dagegen|bestimmen die (Prüf|Pruef)stufe|ohnehin nicht vor/i;
  const treffer = SKILL.split("\n").filter(
    (z) =>
      /(uebersprungen|übersprungen|kein Review von|ausgeschlossen)/i.test(z) &&
      /\[Fachlich\]|\[Plan\]/.test(z) &&
      !verneint.test(z)
  );
  assert.deepEqual(treffer, [], `Ausschluss steht noch in: ${treffer.join(" | ")}`);
});

test("[Idee] bleibt ausgeschlossen", () => {
  assert.match(SKILL, /\[Idee\]/, "der [Idee]-Ausschluss ist verschwunden");
});

test("die stufengerechte Markerpruefung ohne Argumente ist beschrieben", () => {
  // Der Skill spricht die Auswahl an zwei Stellen an (Schritt 1 und 1b). Beide
  // duerfen sich nicht widersprechen, und mindestens eine muss die Stufenbindung
  // des Markers aussprechen — genau daran haengt, dass ein geprueftes fachliches
  // Dokument nicht erneut ausgewaehlt wird.
  const absaetze = SKILL.split(/\n\n/).filter((a) => /ohne Argumente/i.test(a) && /Marker/i.test(a));
  assert.ok(absaetze.length > 0, "kein Absatz zur Auswahl ohne Argumente mit Markerbezug");

  const stufenbindung = /(Marker (dieser|ihrer|seiner) Stufe|anderen Stufe|Marker \*\*ihrer Stufe\*\*)/i;
  assert.ok(
    absaetze.some((a) => stufenbindung.test(a)),
    "keiner der Absaetze sagt, dass nur der Marker der eigenen Stufe zaehlt"
  );
  // Kein Absatz darf mehr pauschal auf Issue-Review: filtern, ohne die Stufe zu nennen.
  const pauschal = absaetze.filter((a) => /Issue-Review:/.test(a) && !stufenbindung.test(a));
  assert.deepEqual(pauschal, [], "ein Absatz filtert noch pauschal auf Issue-Review:");
});

test("die Abgrenzungen zu #283 und #280/#281 stehen im Skill", () => {
  assert.match(SKILL, /#283/, "Abgrenzung zum Nacht-Runner (#283) fehlt");
  assert.match(SKILL, /#280/, "Abgrenzung zu den fachlichen Rollen (#280) fehlt");
  assert.match(SKILL, /#281/, "Abgrenzung zu den Plan-Rollen (#281) fehlt");
});
