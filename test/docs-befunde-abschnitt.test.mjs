// Regeltext der Befund-Form (Issue #798, Plan #797, fachliche Quelle #768).
//
// Erstes Paket und bindende Quelle: Bevor ein Kommando Funde prueft, ein
// Protokoll sie zaehlt oder ein Skill-Prompt die neue Form verlangt, muss die
// Form selbst niedergeschrieben sein (Plan #797, E19). Ein Protokoll ohne
// festgelegte Form buchte Arten, die es noch nicht gibt.
//
// Der heikelste Punkt ist die Abgrenzung gegen ein Gate. Eine Form, die
// Angaben verlangt, liest sich wie eine Pflicht mit Durchsetzung; ohne den
// ausdruecklichen Satz baut die naechste Session ihr eine Sperre. Darum
// verlangt dieser Test den Satz als eigene Aussage, nicht nur das Wort.
//
// Der zweite Punkt ist der eine Wortlaut der Artenliste. Nennt der Regeltext
// die Arten selbst, gibt es zwei Orte — und der Regeltext driftet gegen
// `befunde.mjs arten`, sobald eine Art hinzukommt. Die Gegenprobe dazu ist
// hart: Kein Artname steht im Abschnitt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Auslieferungsvorlage. Die Kopie unter .claude/ ist Installer-Ausgabe und
 *  nicht versioniert — in CI existiert sie nicht. */
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");

/** Ein `##`-Abschnitt der Vorlage, bis zur naechsten Trennlinie. */
function abschnitt(ueberschrift) {
  const idx = VORLAGE.indexOf(ueberschrift);
  assert.ok(idx >= 0, `'${ueberschrift}' fehlt in templates/CLAUDE-workflow.md`);
  return VORLAGE.slice(idx).split(/\n---/)[0];
}

const BEFUNDE = "## Befunde der Modell-Pruefungen";

// --- Der Ort des Abschnitts ---

test("der Abschnitt steht zwischen Wirksamkeit der Pruefungen und Drei Bahnen", () => {
  // Der Ort ist Teil der Aussage: Die Befund-Form gehoert zu dem, was das Kit
  // ueber seine Pruefungen sagt — nicht zu den Bahnen, die den Weg eines
  // Vorhabens beschreiben.
  const ueberschriften = VORLAGE.split("\n")
    .filter((z) => z.startsWith("## "))
    .map((z) => z.trim());
  const i = ueberschriften.indexOf("## Wirksamkeit der Pruefungen");
  assert.ok(i >= 0, "der Abschnitt '## Wirksamkeit der Pruefungen' fehlt");
  assert.equal(ueberschriften[i + 1], BEFUNDE,
    "'## Befunde der Modell-Pruefungen' folgt nicht unmittelbar auf '## Wirksamkeit der Pruefungen'");
  assert.equal(ueberschriften[i + 2], "## Drei Bahnen",
    "'## Drei Bahnen' folgt nicht unmittelbar auf '## Befunde der Modell-Pruefungen'");
});

// --- Aufbau eines Funds ---

test("der Abschnitt nennt die drei zusaetzlichen Angaben eines Funds", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /Gegenprobe/, "die Gegenprobe fehlt im Abschnitt");
  assert.match(text, /widerlegen w(ü|ue)rde/,
    "dass die Gegenprobe die Beobachtung ist, die den Fund widerlegen wuerde, steht nicht im Abschnitt");
  assert.match(text, /`geprueft, bestaetigt`/,
    "der Stand `geprueft, bestaetigt` steht nicht im Abschnitt");
  assert.match(text, /`nicht geprueft`/,
    "der Stand `nicht geprueft` steht nicht im Abschnitt");
  assert.match(text, /Mangel-Art/, "die Mangel-Art fehlt im Abschnitt");
});

test("der Abschnitt nennt die vier Angaben, die ein Fund schon heute traegt", () => {
  // Die drei neuen Angaben kommen zu Schweregrad, Fundstelle und Vorschlag
  // hinzu; ohne den Bestand liest sich die Aufzaehlung als vollstaendige Form.
  const text = abschnitt(BEFUNDE);
  assert.match(text, /Schweregrad/, "der Schweregrad fehlt im Abschnitt");
  assert.match(text, /Fundstelle/, "die Fundstelle fehlt im Abschnitt");
  assert.match(text, /Vorschlag/, "der Vorschlag fehlt im Abschnitt");
});

test("der Abschnitt gilt fuer alle vier vom Kit vorgesehenen Modell-Pruefungen", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /fachliche Anforderung/, "die fachliche Anforderung fehlt in der Aufzaehlung");
  assert.match(text, /Plan/, "der Plan fehlt in der Aufzaehlung");
  assert.match(text, /Arbeitspaket/, "das Arbeitspaket fehlt in der Aufzaehlung");
  assert.match(text, /Code/, "der Code fehlt in der Aufzaehlung");
});

test("der Abschnitt sagt, dass ein widerlegter Fund nicht gemeldet wird", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /widerlegt hat, wird nicht gemeldet|nicht gemeldet/,
    "dass ein von der eigenen Gegenprobe widerlegter Fund nicht gemeldet wird, steht nicht im Abschnitt");
});

// --- Die Artenliste hat genau einen Wortlaut ---

test("der Abschnitt verweist fuer die Arten auf das Kommando", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /befunde\.mjs arten/,
    "der Verweis auf `node .claude/kit/befunde.mjs arten` fehlt im Abschnitt");
});

test("der Abschnitt nennt keine einzelne Mangel-Art im eigenen Wortlaut", () => {
  // Die Gegenprobe zum Verweis: Zwei Orte driften auseinander, sobald eine Art
  // hinzukommt. Darum steht im Regeltext kein Artname.
  const text = abschnitt(BEFUNDE);
  assert.doesNotMatch(text, /bestandsbehauptung|unbeobachtbar|Auffang-Art/i,
    "der Abschnitt nennt eine Mangel-Art im eigenen Wortlaut statt nur das Kommando");
});

test("der Abschnitt schliesst eigene Arten eines Projekts aus", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /[Ee]rg(ä|ae)nzt keine eigenen Arten|keine eigenen Arten/,
    "dass ein Projekt keine eigenen Arten ergaenzt, steht nicht im Abschnitt");
});

// --- Kein Gate ---

test("der Abschnitt nimmt die Form ausdruecklich vom Gate aus", () => {
  // Der Lesepunkt der Verifizierung: ein eigener Satz, nicht nur das Wort.
  const text = abschnitt(BEFUNDE);
  const satz = text.split(/(?<=[.!?])\s/).find((s) => /Gate/.test(s));
  assert.ok(satz, "kein Satz mit dem Wort 'Gate' im Abschnitt");
  assert.match(satz, /kein/i, "der Satz mit 'Gate' nimmt die Form nicht davon aus");
});

test("der Abschnitt regelt die fehlende Angabe ohne Halt", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /genau einmal/,
    "dass eine fehlende Angabe genau einmal nachgefordert wird, steht nicht im Abschnitt");
  assert.match(text, /`Angaben: unvollstaendig`/,
    "der Vermerk `Angaben: unvollstaendig` steht nicht im Abschnitt");
  assert.match(text, /trotzdem eingearbeitet/,
    "dass der Fund trotzdem eingearbeitet wird, steht nicht im Abschnitt");
});

// --- Die vier Begriffe ---

test("der Abschnitt fuehrt die vier Begriffe Fund, Gegenprobe, Art und Vorkommen", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /\*\*Fund\*\*/, "der Begriff **Fund** fehlt");
  assert.match(text, /\*\*Gegenprobe\*\*/, "der Begriff **Gegenprobe** fehlt");
  assert.match(text, /\*\*Art\*\*/, "der Begriff **Art** fehlt");
  assert.match(text, /\*\*Vorkommen\*\*/, "der Begriff **Vorkommen** fehlt");
});

test("der Abschnitt sagt, welche Funde keine Vorkommen sind", () => {
  // Der Unterschied, auf den es bei der Auswertung ankommt: Nur ein
  // uebernommener Fund mit bestaetigter Gegenprobe zaehlt.
  const text = abschnitt(BEFUNDE);
  assert.match(text, /keine Vorkommen/,
    "dass nicht gepruefte, unvollstaendige und abgelehnte Funde keine Vorkommen sind, fehlt");
});

// --- Die beiden Messgrenzen ---

test("der Abschnitt nennt die Grenze fuer Funde vor der Einfuehrung", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /[Vv]or der Einf(ü|ue)hrung[\s\S]{0,160}z(ä|ae)hlen nicht|z(ä|ae)hlen nicht[\s\S]{0,160}nachtr(ä|ae)glich/,
    "die Messgrenze fuer Altfunde fehlt im Abschnitt");
  assert.match(text, /nachtr(ä|ae)glich/,
    "dass Altfunde nicht nachtraeglich eingeordnet werden, steht nicht im Abschnitt");
});

test("der Abschnitt nennt den Verlust aus einem abgestuerzten Nacht-Worktree", () => {
  const text = abschnitt(BEFUNDE);
  assert.match(text, /worktreesAufraeumen/,
    "`worktreesAufraeumen` fehlt im Abschnitt — die zweite Messgrenze ist unverortet");
  assert.match(text, /ungesichert wartet/,
    "dass die Worktrees samt allem darin ungesichert Wartenden weggeraeumt werden, steht nicht da");
});

// --- Der Anschluss an „Reviews sind Zuarbeit." ---

test("der Absatz 'Reviews sind Zuarbeit' nennt die drei zusaetzlichen Angaben", () => {
  // Dort steht, was der Autor der Stufe mit einem Befund tut; ohne den Zusatz
  // liest er die neuen Angaben nicht mit.
  const text = abschnitt("## Entscheiden statt fragen");
  const idx = text.indexOf("**Reviews sind Zuarbeit.**");
  assert.ok(idx >= 0, "der Absatz '**Reviews sind Zuarbeit.**' fehlt");
  const absatz = text.slice(idx).split("\n\n")[0];
  assert.match(absatz, /drei zus(ä|ae)tzliche[n]? Angaben|Gegenprobe/,
    "der Absatz nennt die zusaetzlichen Angaben eines Funds nicht");
  assert.match(absatz, /liest sie mit|bevor er (ü|ue)bernimmt/,
    "dass der Autor der Stufe die Angaben mitliest, bevor er uebernimmt oder ablehnt, fehlt");
});
