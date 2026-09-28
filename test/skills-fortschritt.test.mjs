// Der Fortschritts-Anker der Sitzung (Issue #981, Plan #974, fachliche Quelle #963).
//
// Der Beobachter aus Issue #975 sammelt Zeilen mit dem Anker `FORTSCHRITT:`. Schreiben kann
// sie nur die Sitzung selbst — kein Werkzeug spricht fuer sie ueber ihren eigenen Stand —,
// darum steht der Auftrag im Skilltext und wird hier geprueft.
//
// Geprueft wird die Quelle unter skills/, nicht die Kopie unter .claude/: Die ist
// Installer-Ausgabe und in CI nicht vorhanden (siehe docs-entscheiden.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const NEXT = lies("skills", "implement-next", "SKILL.md");
const DONE = lies("skills", "implement-done", "SKILL.md");

const ANKER = "FORTSCHRITT:";

test("[skills-36] implement-next verlangt die Fortschrittszeile je erledigtem Akzeptanzkriterium", () => {
  const absatz = NEXT.split(/\n\n/).find((a) => a.includes(ANKER));
  assert.ok(absatz, `implement-next nennt den Anker '${ANKER}' nicht`);

  for (const [was, muster] of [
    ["die Form der Zeile", /FORTSCHRITT: AK<n> — /],
    ["die eigene Ausgabezeile", /eigene Ausgabezeile/],
    ["das laufende Schreiben statt am Ende gesammelt", /nicht am Ende gesammelt/],
    ["die Herleitung von <n> aus der Position in der Aufzaehlung", /Position[^.]*Aufzaehlung|Position[^.]*Aufzählung/],
    ["den Abschnitt, in dem gezaehlt wird", /## Akzeptanzkriterium/],
    ["den ausgenommenen Block", /### Manuelle Pruefung/],
    ["den Grund: nur Gesagtes erreicht den Morgen", /Zeitlimit[\s\S]*Morgen/],
  ]) {
    assert.match(absatz, muster, `implement-next: der Fortschritts-Absatz nennt ${was} nicht`);
  }
});

test("[skills-37] der Auftrag steht als Listenpunkt in Schritt 3 von implement-next", () => {
  const zeilen = NEXT.split("\n");
  const i = zeilen.findIndex((z) => z.includes(ANKER));
  assert.ok(i >= 0, `implement-next nennt den Anker '${ANKER}' nicht`);
  assert.match(zeilen[i], /^- /, "der Fortschritts-Auftrag steht nicht als Listenpunkt");

  const davor = NEXT.slice(0, NEXT.indexOf(ANKER));
  assert.ok(
    davor.lastIndexOf("### 3. Implementieren") > davor.lastIndexOf("### 4."),
    "der Fortschritts-Auftrag steht nicht in Schritt 3 (Implementieren)"
  );
});

// Kleinster rueckbaubarer Eingriff (E2): Der Nacht-Runner startet ausschliesslich
// /implement-next, nur dort liest ein Strom-Beobachter mit.
test("[skills-38] implement-done nennt den Fortschritts-Anker nicht", () => {
  assert.ok(!DONE.includes(ANKER), `implement-done nennt den Anker '${ANKER}', soll es aber nicht`);
});
