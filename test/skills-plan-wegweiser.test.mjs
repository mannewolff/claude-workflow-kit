// Tests fuer den Wegweiser unter dem alten Skill-Namen (Issue #478, Paket #514).
//
// Der Planungsschritt heisst seit 2026-09-07 `techplan`. Der alte Name bleibt als
// Wegweiser stehen — das loest die Spannung zwischen zwei Kriterien der fachlichen
// Anforderung: Der alte Name soll nicht ins Leere fuehren (Kriterium 2), und den
// Schritt soll es genau einmal geben (Kriterium 4). Ein Wegweiser fuehrt den Schritt
// nicht aus, also gilt beides zugleich.
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell, das
// ihn liest. Wert haben sie trotzdem: Wer den Wegweiser versehentlich mit dem Ablauf
// des Schritts fuellt, macht ihn zum zweiten Planungs-Skill, und dann steht wieder
// zur Auswahl, was eindeutig sein sollte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEGWEISER = readFileSync(join(repoRoot, "skills", "plan", "SKILL.md"), "utf-8");

test("der Wegweiser traegt den alten Namen im Frontmatter", () => {
  assert.match(WEGWEISER, /^name: plan$/m, "der Wegweiser heisst nicht mehr `plan`");
  assert.match(WEGWEISER, /^user-invocable: true$/m,
    "der Wegweiser ist nicht aufrufbar — dann findet ihn niemand, der den alten Namen tippt");
});

test("der Wegweiser nennt den neuen Namen", () => {
  assert.match(WEGWEISER, /\/techplan/,
    "der Wegweiser verweist nicht auf /techplan — der alte Name fuehrt dann ins Leere");
});

test("die description sagt, dass hier kein Plan entsteht", () => {
  const zeile = WEGWEISER.split("\n").find((z) => z.startsWith("description:"));
  assert.ok(zeile, "dem Wegweiser fehlt die description");
  assert.match(zeile, /techplan/,
    "die description nennt den neuen Namen nicht — sie ist das, was die Umgebung im Menue zeigt");
});

// Der eigentliche Punkt: Der Wegweiser darf den Schritt nicht ausfuehren. Traegt er
// die Abschnitte des Plan-Formats, ist er kein Wegweiser mehr, sondern eine zweite
// Kopie des Skills — genau der Zustand, den Kriterium 4 ausschliesst.
test("der Wegweiser traegt keinen Ablauf", () => {
  for (const ueberschrift of [
    "## Ziel",
    "## Betroffene Bereiche",
    "## Architektonische Entscheidungen",
    "## Geplante",
    "## Offene Fragen",
    "## Verifizierung",
    "## Ablauf",
    "## Stop-Punkt",
  ]) {
    assert.ok(!WEGWEISER.includes(ueberschrift),
      `der Wegweiser traegt "${ueberschrift}" — er soll den Schritt nicht ausfuehren, nur auf ihn zeigen`);
  }
});

test("der Wegweiser bleibt kurz", () => {
  const zeilen = WEGWEISER.split("\n").length;
  assert.ok(zeilen < 60,
    `der Wegweiser hat ${zeilen} Zeilen — er soll auf den Schritt zeigen, ihn nicht beschreiben`);
});
