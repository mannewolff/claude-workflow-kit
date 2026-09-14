// Der Abschnitt "Entscheiden statt fragen" in der Auslieferungsvorlage (Issue #625).
//
// Er ist die Regel, auf die alle umgebauten Skills verweisen: Was nicht in der
// Stopp-Klasse steht, wird entschieden und im festen Format protokolliert. Geprueft
// wird der Vorlagentext, nicht die Kopie unter .claude/ — die ist Installer-Ausgabe
// und in CI nicht vorhanden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");

const UEBERSCHRIFT = "## Entscheiden statt fragen";

/** Der Text eines Abschnitts bis zur naechsten Ueberschrift derselben Ebene. */
function abschnitt(text, ueberschrift) {
  const ebene = ueberschrift.match(/^#+/)[0];
  const start = text.indexOf(`${ueberschrift}\n`);
  if (start === -1) return "";
  const rest = text.slice(start + ueberschrift.length);
  const naechste = rest.search(new RegExp(`^${ebene} `, "m"));
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

/** Die Inhalte aller eingezaeunten Codebloecke eines Textstuecks. */
function codebloecke(text) {
  return [...text.matchAll(/^ {0,3}```[^\n]*\n([\s\S]*?)^ {0,3}```/gm)].map((m) => m[1]);
}

const TEXT = abschnitt(VORLAGE, UEBERSCHRIFT);

test("der Abschnitt steht genau einmal, vor den Mitteilungen des Menschen", () => {
  const treffer = VORLAGE.match(/^## Entscheiden statt fragen$/gm) || [];
  assert.equal(treffer.length, 1, `'${UEBERSCHRIFT}' steht ${treffer.length}-mal in der Vorlage`);
  const hier = VORLAGE.indexOf(UEBERSCHRIFT);
  const mitteilungen = VORLAGE.indexOf("## Mitteilungen des Menschen");
  assert.ok(mitteilungen > hier, "der Abschnitt gehoert vor 'Mitteilungen des Menschen'");
  const stopPunkte = VORLAGE.indexOf("## Die drei Stop-Punkte");
  assert.ok(hier > stopPunkte, "der Abschnitt gehoert hinter 'Die drei Stop-Punkte'");
});

test("der Abschnitt bleibt kurz und traegt keine Vorfallsverweise", () => {
  const zeilen = TEXT.trim().split("\n").length;
  assert.ok(zeilen <= 40, `der Abschnitt hat ${zeilen} Zeilen, erlaubt sind 40`);
  assert.doesNotMatch(TEXT, /Issue #\d/, "kein Issue-Verweis als Begruendung einer Regel");
  assert.doesNotMatch(TEXT, /\b20\d\d\b/, "keine Jahreszahl, keine Vorfallsgeschichte");
});

test("das Entscheidungsformat steht als Codeblock mit den vier Schluesselwoertern", () => {
  const bloecke = codebloecke(TEXT);
  assert.ok(bloecke.length >= 1, "der Abschnitt braucht einen Codeblock mit dem Format");
  const format = bloecke.find((b) => b.includes("E1:"));
  assert.ok(format, "der Codeblock beginnt mit dem Eintrag E1");
  for (const wort of ["Gewählt:", "Verworfen:", "Grund:", "Rückbau:"]) {
    assert.ok(format.includes(wort), `im Format fehlt '${wort}'`);
  }
});

test("die Stopp-Klasse hat genau fuenf nummerierte Punkte", () => {
  const punkte = TEXT.match(/^\d\. /gm) || [];
  assert.deepEqual(punkte, ["1. ", "2. ", "3. ", "4. ", "5. "]);
  for (const stichwort of ["Datenverlust", "Sicherheit", "Verträge nach außen", "Widerspruch im Fachplan", "W1 bis W4"]) {
    assert.ok(TEXT.includes(stichwort), `in der Stopp-Klasse fehlt '${stichwort}'`);
  }
  assert.ok(TEXT.includes("genau eine Frage"), "jeder Halt traegt genau eine Frage");
});

test("die Tabelle nennt die drei Orte der Eintraege", () => {
  const zeilen = TEXT.split("\n").filter((z) => z.startsWith("|") && !/^\|[-\s|]+\|$/.test(z));
  const orte = zeilen.map((z) => z.toLowerCase());
  assert.ok(orte.some((z) => z.includes("plandokument") && z.includes("architektonische entscheidungen")));
  assert.ok(orte.some((z) => z.includes("arbeitspaket") && z.includes("entscheidung:")));
  assert.ok(orte.some((z) => z.includes("abschlussbericht") && z.includes("### entscheidungen")));
});

test("Reviews sind Zuarbeit: kein Modell-Marker gibt eine Stufe frei", () => {
  assert.ok(TEXT.includes("nie ein Modell-Marker"), "der Satz zum Modell-Marker fehlt");
  assert.ok(TEXT.includes("Prioritaeten bei Zielkonflikten"), "der Schiedsrichter wird nicht genannt");
});

test("das Abschlussbericht-Format kennt den Block '### Entscheidungen'", () => {
  const bericht = abschnitt(VORLAGE, "## Abschlussbericht-Format");
  const [block] = codebloecke(bericht);
  assert.ok(block, "das Abschlussbericht-Format hat einen Codeblock");
  assert.ok(block.includes("### Entscheidungen"), "im Codeblock fehlt '### Entscheidungen'");
  const treffer = VORLAGE.match(/^### Entscheidungen$/gm) || [];
  assert.equal(treffer.length, 1, "'### Entscheidungen' steht genau einmal in der Vorlage");
});

test("das Arbeitspaket ist kein Pflichtgegenstand der Pruefung mehr", () => {
  const stop = abschnitt(VORLAGE, "## Die drei Stop-Punkte (nie automatisiert)");
  assert.ok(!stop.includes("das\nArbeitspaket eines") && !stop.includes("das Arbeitspaket eines"),
    "der Stop-Punkte-Absatz zaehlt das Arbeitspaket noch als Pruefgegenstand");
  assert.ok(stop.includes("/issue-review #N"), "der Absatz nennt den Aufruf auf Anforderung");
  assert.ok(stop.includes("requiredBeforeReady"), "der Schalter bleibt beschrieben");
  const bahnen = abschnitt(VORLAGE, "## Drei Bahnen");
  assert.ok(!bahnen.includes("geprueft und freigegeben"), "Bahn 3 nennt die Pruefung noch als Pflicht");
  assert.ok(bahnen.includes("danach freigegeben wie jedes Arbeitspaket"));
});
