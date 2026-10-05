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
// Wer sie anhebt, fasst diesen Test an und begruendet es. Zuletzt +1 fuer den Ort des vollen
// Laufs vor `push main` (Issue #1216, Plan #1199/E14: der Satz steht als eigene Zeile im
// Abschnitt der Pflichtchecks, damit dessen Stufenregel Wort fuer Wort bleibt). Davor +2 fuer den Laufstand
// (Issue #1082, Plan #1079/E20: der Regeltext beschreibt ihn, bevor das Werkzeug ihn baut) —
// ein Absatz im Nachtbetrieb-Block mit Labels, `## Laufstand` und den woertlichen
// `wartet`-Formen, die eine Sitzung an ihrer eigenen Karte liest. Davor +4 fuer den gekennzeichneten
// Zeitabbruch und die Kennzahl der Zielmarke (Issue #982, Plan #974): je ein Absatz im
// Nachtbetrieb- und im Aufwand-Block — der Vermerk am Paket und die getrennt stehenden
// Zeitabbrueche sind Regeln, nach denen eine Sitzung ihren eigenen Abbruch liest. Davor +3 fuer das vierte
// Titel-Praefix `[Mensch]` (Issue #984): eine Tabellenzeile und der Absatz, der es von den
// drei Dokument-Praefixen und von `[Task]` abgrenzt — ein Praefix, das eine Sitzung nicht
// kennt, setzt sie eine Karte um, die nur ein Mensch erledigen kann. Davor +2 fuer den Verweis auf
// den Kopf der Lint-Konfiguration (Issue #971, Plan #968/E3: die Vorlage verweist, das
// Verfahren steht bei den Regeln). Davor +4 fuer die vierte Achse
// der Pflichtchecks und den Kennzahlblock der Wirksamkeit (Issue #953, Plan #944: der
// verkleinerte Abschlussumfang traegt nur mit seinen beiden Zusicherungen). Davor +2 fuer
// die Regel, dass
// Schritt 8 und 9 in einem eigenen Worktree laufen (Issue #929: eine Entscheidung Mannes,
// nachdem zwei Release-Laeufe die Nacht-Kette eines Projekts abgerissen haben). Davor +16
// fuer den Abschnitt
// "Regel im Text oder Regel im Werkzeug" (Issue #856, Plan #810/E7: zuerst der Massstab,
// dann die Werkzeuge, dann die Skills). Davor +14 fuer den Abschnitt
// "Befunde der Modell-Pruefungen" (Issue #798, Plan #797/E19: zuerst der Regeltext, dann
// die Artenliste, dann die Skills). Davor +9 fuer den Abschnitt "Wirksamkeit der
// Pruefungen" (Issue #783, Plan #782/E11: der Regeltext steht vor dem Werkzeug) und +5
// fuer die Regel zur wartenden Sitzung (Issue #774).
test("die Vorlage bleibt unter 412 Zeilen", () => {
  const zeilen = VORLAGE.split("\n").length;
  assert.ok(zeilen <= 412, `die Vorlage hat ${zeilen} Zeilen, erlaubt sind 412`);
});

test("die gestrichenen Abschnitte sind weg", () => {
  for (const ueberschrift of ["## Zustandslabels", "### Die drei Pruefstufen", "### Wie viel geprueft wird", "### Ausdruecklich kein prozessweites Gate"]) {
    assert.ok(!VORLAGE.includes(ueberschrift), `'${ueberschrift}' steht noch in der Vorlage`);
  }
  for (const wort of ["Pruefung-Stand:", "review:offen", "review:befunde", "Opus-Reviewer"]) {
    assert.ok(!VORLAGE.includes(wort), `'${wort}' steht noch in der Vorlage`);
  }
});

// Seit Issue #898 kommt ein drittes Vorkommen dazu: Der Nachtbetrieb-Block nennt die
// Pruefung als Bedingung beider Auftragsarten der Kette. Seit Issue #910 ein viertes: Der
// Prueflauf-Block nennt sie als die Spur, die eine geprueft hinterlassene Karte traegt —
// dort entsteht sie. Die Leitplanke bleibt scharf — genau vier, zwei davon im Absatz zu
// /issue-review, das dritte im Nachtbetrieb-Block, das vierte im Prueflauf-Block.
test("review:fertig steht zweimal im selben Absatz: als Spur und als Voraussetzung der Nacht-Kette", () => {
  assert.equal(VORLAGE.split("review:fertig").length, 5, "review:fertig steht nicht genau viermal");
  const nachtbetrieb = VORLAGE.slice(VORLAGE.indexOf("## Nachtbetrieb (optional)")).split(/\n## /)[0];
  assert.equal(nachtbetrieb.split("review:fertig").length, 2, "der Nachtbetrieb-Block nennt review:fertig nicht genau einmal");
  const prueflauf = VORLAGE.slice(VORLAGE.indexOf("## Der Prueflauf (optional)")).split(/\n## /)[0];
  assert.equal(prueflauf.split("review:fertig").length, 2, "der Prueflauf-Block nennt review:fertig nicht genau einmal");
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
  assert.match(absatz, /wird uebersprungen, auch wenn sie das Kettenlabel traegt/);
  assert.match(absatz, /fuer die fachliche Anforderung wie fuer das Plandokument/);
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
