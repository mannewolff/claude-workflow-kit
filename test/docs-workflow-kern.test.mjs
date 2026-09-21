// Die halbierte Prozessvorlage (Issue #633).
//
// Was Review-Mechanik und Nachtbetrieb beschrieb, ist raus; was jede Session braucht,
// bleibt. Geprueft wird die Vorlage unter templates/, nicht die Installer-Kopie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");

// Die Grenze wandert nur mit einer beschlossenen Regel mit, nicht mit Zuwachs nebenbei:
// Wer sie anhebt, fasst diesen Test an und begruendet es. Zuletzt +5 fuer die Regel zur
// wartenden Sitzung im Nachtbetrieb-Abschnitt (Issue #774).
test("die Vorlage bleibt unter 355 Zeilen", () => {
  const zeilen = VORLAGE.split("\n").length;
  assert.ok(zeilen <= 355, `die Vorlage hat ${zeilen} Zeilen, erlaubt sind 355`);
});

test("die gestrichenen Abschnitte sind weg", () => {
  for (const ueberschrift of ["## Zustandslabels", "### Die drei Pruefstufen", "### Wie viel geprueft wird", "### Ausdruecklich kein prozessweites Gate"]) {
    assert.ok(!VORLAGE.includes(ueberschrift), `'${ueberschrift}' steht noch in der Vorlage`);
  }
  for (const wort of ["Pruefung-Stand:", "review:offen", "review:befunde", "Opus-Reviewer"]) {
    assert.ok(!VORLAGE.includes(wort), `'${wort}' steht noch in der Vorlage`);
  }
});

test("review:fertig steht zweimal im selben Absatz: als Spur und als Voraussetzung der Nacht-Kette", () => {
  assert.equal(VORLAGE.split("review:fertig").length, 3, "review:fertig steht nicht genau zweimal");
  const zeilen = VORLAGE.split("\n");
  const start = zeilen.findIndex((z) => z.startsWith("**Der Aufruf ist immer derselbe: `/issue-review #N`.**"));
  assert.ok(start >= 0, "der Absatz zu /issue-review fehlt");
  let ende = start;
  while (zeilen[ende + 1] !== undefined && zeilen[ende + 1].trim() !== "") ende++;
  const absatz = zeilen.slice(start, ende + 1).join("\n");
  assert.equal(absatz.split("review:fertig").length, 3, "beide Vorkommen stehen nicht im selben Absatz");
  assert.match(absatz, /`review:fertig` als sichtbare Spur am Board/);
  assert.match(absatz, /je Board einmal angelegt/);
  assert.match(absatz, /Nacht-Kette verlangt diese Spur aber als Voraussetzung/);
  assert.match(absatz, /wird uebersprungen, auch wenn er das Kettenlabel traegt/);
});

test("die bleibenden Abschnitte stehen je einmal", () => {
  for (const ueberschrift of ["## Entscheiden statt fragen", "## Mitteilungen des Menschen", "## Lange Texte ans Board", "## Nachtbetrieb", "## Drei Bahnen", "## Issue-Format", "## Abschlussbericht-Format", "## KI-Retro"]) {
    const treffer = VORLAGE.split("\n").filter((z) => z.startsWith(ueberschrift));
    assert.equal(treffer.length, 1, `'${ueberschrift}' steht ${treffer.length}-mal`);
  }
  for (const gate of ["### W1 —", "### W2 —", "### W3 —", "### W4 —"]) {
    const treffer = VORLAGE.split("\n").filter((z) => z.startsWith(gate));
    assert.equal(treffer.length, 1, `${gate} steht nicht genau einmal`);
  }
});

test("Schritt 7 nennt reviewCommand statt eines festen Modells", () => {
  const zeile = VORLAGE.split("\n").find((z) => z.startsWith("| 7. Code-Review"));
  assert.ok(zeile, "die Zeile zu Schritt 7 fehlt");
  assert.match(zeile, /reviewCommand/);
});

test("der Transport-Abschnitt traegt seine Belege und keinen Logdatei-Verweis", () => {
  const a = VORLAGE.indexOf("## Lange Texte ans Board");
  const abschnitt = VORLAGE.slice(a).split(/\n## /)[0];
  for (const beleg of ["6.000", "printenv TMPDIR", "9.722", "10.154", "Beobachtung"]) {
    assert.ok(abschnitt.includes(beleg), `Beleg fehlt: ${beleg}`);
  }
  assert.doesNotMatch(abschnitt, /night-run/);
});
