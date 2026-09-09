// Schritt 3 von `/push-main`: Spec-Fortschreibung UND wartende Vorhaben-Notizen
// (Issue #548, Plan #545).
//
// Geprueft wird Text, nicht Verhalten — wie in `test/skills-push-main-spec.test.mjs`.
// Der Wert liegt darin, dass eine spaetere Umformulierung auffaellt, bevor sie eine
// der beiden Halbheiten wieder einbaut, die dieses Vorhaben abschafft:
//
//   1. Notizen entstehen, aber niemand holt sie ab — dann fehlt der Vorschau-Teil
//      `vorhaben-sichern --dry-run` oder das Aufheben im Schreiben-Block.
//   2. Der Commit sammelt fremde Aenderungen ein — dann steht wieder `git add specs/`
//      statt `git add specs/vorhaben/`, und eine handgefuehrte Aenderung an
//      `specs/board.md` faehrt in einem Commit mit, den niemand angefordert hat.
//
// Die Reihenfolge wird an Positionen im Text gemessen, nicht an Schrittnummern:
// Nummern verschieben sich beim naechsten Einschub, die Woerter bleiben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "push-main", "SKILL.md"), "utf-8");

/** Die Absaetze des Skills, an Leerzeilen geschnitten. */
function absaetze() {
  return SKILL.split(/\n\s*\n/);
}

test("[skills-4] die Ueberschrift von Schritt 3 nennt beide Gegenstaende", () => {
  assert.match(
    SKILL,
    /^### \d+\. Spec-Fortschreibung und wartende Vorhaben-Notizen/m,
    "die Ueberschrift nennt die wartenden Vorhaben-Notizen nicht — dann liest der Schritt sich"
      + " weiter als reine Spec-Fortschreibung und das Aufheben faellt beim Ueberfliegen weg",
  );
});

test("[skills-4] die Vorschau zeigt alle vier Teile vor der einen Frage", () => {
  const zustimmung = SKILL.search(/Zustimmung/);
  assert.notEqual(zustimmung, -1, "der Absatz mit der Zustimmung fehlt");

  for (const [teil, muster] of [
    ["die Vorschau der Notizen", /vorhaben-sichern --dry-run/],
    ["der Blick auf `specs/vorhaben/`", /git status --porcelain -- specs\/vorhaben\//],
    ["der Blick auf schon Gestagetes", /git diff --cached --name-only -- specs\//],
  ]) {
    const pos = SKILL.search(muster);
    assert.notEqual(pos, -1, `${teil} fehlt in der Vorschau`);
    assert.ok(
      pos < zustimmung,
      `${teil} steht hinter der Zustimmung — der Mensch stimmte dann etwas zu, das er nicht gesehen hat`,
    );
  }
});

test("[skills-4] der Commit nimmt `specs/vorhaben/`, nicht pauschal `specs/`", () => {
  assert.match(
    SKILL,
    /git add specs\/vorhaben\//,
    "`git add specs/vorhaben/` fehlt — die aufgehobenen Notizen kaemen nicht in den Commit",
  );
  assert.doesNotMatch(
    SKILL,
    /git add specs\/$/m,
    "`git add specs/` steht noch im Skill — der Commit saugte fremde Aenderungen unter `specs/` mit ein",
  );
});

test("[skills-4] die leere Vorschau nennt alle drei Bedingungen", () => {
  const absatz = absaetze().find((a) => /[Ll]eere Vorschau/.test(a));
  assert.ok(absatz, "kein Absatz zur leeren Vorschau");
  assert.match(absatz, /apply/, "die leere `apply`-Vorschau fehlt als Bedingung");
  assert.match(absatz, /keine Notiz wartet|wartet keine Notiz|wartende Notiz/i,
    "die wartende Notiz fehlt als Bedingung");
  assert.match(absatz, /git status --porcelain -- specs\/vorhaben\//,
    "der Blick auf `specs/vorhaben/` fehlt als dritte Bedingung");
});

test("[skills-4] ein roter `vorhaben-sichern` haelt den Ablauf nicht an", () => {
  const alle = absaetze();
  const idx = alle.findIndex((a) => /vorhaben-sichern/.test(a) && /Exitcode 1 oder 2/.test(a));
  assert.ok(idx >= 0, "kein Absatz, der `vorhaben-sichern` und `Exitcode 1 oder 2` zusammen nennt");
  assert.match(alle[idx], /nicht an|nicht auf/,
    "es steht nicht, dass der Ablauf trotzdem weiterlaeuft");

  // Der Bestand verlangt, dass der ERSTE Absatz zum Muster „Exitcode ungleich 0 /
  // roter apply" der `apply`-Fehlerpfad ist (test/skills-push-main-spec.test.mjs).
  // Steht der neue Absatz davor, faengt er dessen Suche ab und die Zusage zum
  // aufgehaltenen Push waere ungeprueft.
  const applyIdx = alle.findIndex((a) => /Exitcode ungleich 0|roter? `?apply/i.test(a));
  assert.ok(applyIdx >= 0, "der `apply`-Fehlerpfad fehlt");
  assert.ok(
    applyIdx < idx,
    "der neue Fehlerpfad steht vor dem `apply`-Fehlerpfad — er faengt dessen Suche ab",
  );
});

test("[skills-4] `(Issue #N)` steht nur in einem Verbotssatz", () => {
  const treffer = absaetze().filter((a) => a.includes("(Issue #N)"));
  assert.ok(treffer.length > 0,
    "das verbotene Betreff-Suffix `(Issue #N)` wird nirgends ausgeschlossen —"
      + " ohne den Satz haengt eine Session es an und `spec.mjs` liest den Commit als Arbeitspaket");
  for (const absatz of treffer) {
    assert.match(absatz, /[Nn]ie|kein/,
      `\`(Issue #N)\` steht in einem Absatz ohne Verbot:\n${absatz}`);
  }
});

test("[skills-4] ohne `spec`-Block wird keine wartende Notiz abgeholt", () => {
  const start = SKILL.indexOf("## Ohne `spec`-Block");
  assert.notEqual(start, -1, "der Abschnitt 'Ohne `spec`-Block' fehlt");
  const abschnitt = SKILL.slice(start).split(/\n## /)[0];
  assert.match(
    abschnitt,
    /wartende[rn]? Notiz|Vorhaben-Notiz/i,
    "der Abschnitt sagt nicht, dass ohne den Block keine wartende Notiz gelesen oder aufgehoben wird —"
      + " eine Notiz kann dort liegen, etwa nach nachtraeglichem Entfernen des Blocks",
  );
});
