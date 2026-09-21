// Die Regel "keine Session endet mit laufender eigener Arbeit" (Issue #774, Plan #773,
// fachliche Quelle #754).
//
// Sie steht vor dem Runner-Code: Ein Runner, der Verhalten mit eigenem Grund und Vermerk
// quittiert, das keine Anweisung verbietet, bestraft, was nirgends untersagt war (Plan A11).
// Geprueft wird deshalb der Regeltext — der Vorlagenabschnitt zum Nachtbetrieb und die
// beiden Implementierungs-Skills —, nicht die Kopie unter .claude/: Die ist
// Installer-Ausgabe und in CI nicht vorhanden (siehe docs-entscheiden.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const SKILLS = [
  ["implement-next", lies("skills", "implement-next", "SKILL.md")],
  ["implement-ready", lies("skills", "implement-ready", "SKILL.md")],
];

// Der Anker des Vermerks. Er steht hier woertlich, weil ihn das Folgepaket als Konstante
// in kit/night.mjs bekommt und beide Seiten denselben Text treffen muessen — eine
// Umschreibung findet der Leser am Board nicht wieder.
const ANKER = "## Nachtlauf: wartende Sitzung";

// Die Zeile, an der die neue Leitplanke haengt: die vorhandene Regel zum im Hintergrund
// gestarteten Pflichtcheck, die sie verallgemeinert.
const HINTERGRUND_CHECK = "ich melde mich, sobald der Lauf durch ist";

/** Der Text eines Abschnitts bis zur naechsten Ueberschrift derselben Ebene.
 *  Gleiche Bauart wie `abschnitt` in docs-entscheiden.test.mjs. */
function abschnitt(text, ueberschrift) {
  const ebene = ueberschrift.match(/^#+/)[0];
  const start = text.indexOf(`${ueberschrift}\n`);
  if (start === -1) return "";
  const rest = text.slice(start + ueberschrift.length);
  const naechste = rest.search(new RegExp(`^${ebene} `, "m"));
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

test("der Nachtbetrieb-Abschnitt der Vorlage nennt Regel und Folge der wartenden Sitzung", () => {
  const text = abschnitt(VORLAGE, "## Nachtbetrieb (optional)");
  assert.ok(text, "der Abschnitt '## Nachtbetrieb (optional)' fehlt in der Vorlage");

  const absatz = text.split(/\n\n/).find((a) => /Keine Session endet mit laufender eigener Arbeit/.test(a));
  assert.ok(absatz, "kein Absatz traegt die Regel 'Keine Session endet mit laufender eigener Arbeit'");

  // Regel: warten oder abbrechen und den Abbruch als Fehlschlag melden — und
  // Hintergrundarbeit ausdruecklich weiter erlaubt, sonst liest sich die Regel als Verbot
  // jeder Nebenlaeufigkeit.
  for (const [was, muster] of [
    ["das Warten auf das Ergebnis", /wartet auf das Ergebnis/],
    ["den Abbruch als Ausweg", /bricht/],
    ["den Fehlschlag als Meldung", /Fehlschlag/],
    ["die weiter erlaubte Hintergrundarbeit", /Hintergrundarbeit bleibt/],
  ]) {
    assert.match(absatz, muster, `die Regel nennt ${was} nicht`);
  }

  // Folge: eigener Grund, eigene Groesse, Vermerk am Paket — und das Paket gilt nicht als
  // erledigt. Ohne den letzten Halbsatz waere der Vermerk eine Notiz ohne Wirkung.
  for (const [was, muster] of [
    ["den eigenen Grund", /eigenem Grund/],
    ["die eigene Groesse", /eigene Groesse/],
    ["den Vermerk am Arbeitspaket", /Vermerk[^.]*Arbeitspaket/],
    ["dass das Paket nicht erledigt ist", /erledigt ist das Paket/],
  ]) {
    assert.match(absatz, muster, `die Folge nennt ${was} nicht`);
  }
});

test("[skills-33] beide Implementierungs-Skills verbieten das Enden mit laufender eigener Arbeit", () => {
  for (const [name, text] of SKILLS) {
    const zeilen = text.split("\n");
    const i = zeilen.findIndex((z) => z.includes(HINTERGRUND_CHECK));
    assert.ok(i >= 0, `${name}: die Leitplanke zum Hintergrund-Check fehlt`);

    // Die verallgemeinerte Regel steht direkt bei der Leitplanke, die sie verallgemeinert
    // — als naechster Punkt derselben Liste, nicht irgendwo im Dokument.
    const naechste = zeilen[i + 1] || "";
    assert.match(naechste, /^- /, `${name}: die neue Regel steht nicht als naechster Listenpunkt`);
    assert.match(
      naechste,
      /[Kk]eine Session endet mit laufender eigener Arbeit/,
      `${name}: der naechste Listenpunkt traegt die Regel nicht`
    );
    for (const [was, muster] of [
      ["die Ausweitung ueber den Pflichtcheck hinaus", /nicht nur bei einem Pflichtcheck/],
      ["das Warten auf das Ergebnis", /wartet auf sein Ergebnis/],
      ["den Abbruch als Fehlschlag", /Fehlschlag/],
      ["die blosse Warte-Schlussmeldung als Fehlschlag", /Schlussmeldung/],
    ]) {
      assert.match(naechste, muster, `${name}: die Regel nennt ${was} nicht`);
    }
  }
});

test("[skills-34] beide Implementierungs-Skills melden einen Vermerk der wartenden Sitzung, ohne anzuhalten", () => {
  for (const [name, text] of SKILLS) {
    const lesen = abschnitt(text, "### 2. Issue vollständig lesen");
    assert.ok(lesen, `${name}: der Schritt '### 2. Issue vollständig lesen' fehlt`);

    const absatz = lesen.split(/\n\n/).find((a) => a.includes(ANKER));
    assert.ok(absatz, `${name}: kein Absatz in Schritt 2 nennt den Anker '${ANKER}'`);
    assert.match(absatz, /Kein Halt/, `${name}: der Vermerk-Absatz sagt nicht, dass nichts anhaelt`);
    assert.match(absatz, /Ruecksprache|Rückfrage/, `${name}: der Vermerk-Absatz schliesst die Ruecksprache nicht aus`);
    assert.match(
      absatz,
      /schon einmal angefangen/,
      `${name}: der Vermerk-Absatz sagt nicht, dass das Paket schon einmal angefangen wurde`
    );
  }
});
