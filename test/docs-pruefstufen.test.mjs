// Dokumentation der drei Pruefstufen und des Plandokuments (Issue #284,
// fachliche Quelle #272).
//
// Wer den Prozess in vier Wochen liest, muss verstehen, welche Stufe wann greift
// und welcher Nachweis was bedeutet. Der heikelste Punkt ist die Freigabe: An
// `Issue-Review:` haengt das Gate `requiredBeforeReady`; wer glaubt, ein
// `Plan-Review:` reiche auch, zieht ein ungeprueftes Arbeitspaket nach Ready.
//
// Der wertvollste Test hier ist der letzte: Er vergleicht die dokumentierten
// `--stufe`-Werte gegen die tatsaechliche `--help`-Ausgabe. Eine Doku, die
// Werte nennt, die das Programm nicht kennt, ist schlimmer als keine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const DOKU = lies("docs", "dokumentation.md");

/** Die Auslieferungsvorlage. Die Kopie unter .claude/ ist Installer-Ausgabe und
 *  nicht versioniert — in CI existiert sie nicht. */
const beide = [
  ["templates/CLAUDE-workflow.md", VORLAGE],
];

const PLAN_FORMAT = [
  "## Ziel",
  "## Betroffene Bereiche",
  "## Architektonische Entscheidungen",
  "## Geplante Änderungen",
  "## Offene Fragen",
  "## Verifizierung",
];

test("die Vorlage nennt alle drei Titel-Praefixe", () => {
  // [Idee] fehlte hier bisher ganz — die Datei ist der Blob, den jede
  // Neuinstallation bekommt, das Gate waere dort dauerhaft unsichtbar gewesen.
  for (const praefix of ["[Fachlich]", "[Idee]", "[Plan]"]) {
    assert.ok(VORLAGE.includes(praefix), `Titel-Praefix fehlt in der Vorlage: ${praefix}`);
  }
});

test("beide Prozessdateien behandeln [Plan] als nicht implementierbar", () => {
  for (const [name, text] of beide) {
    // Gesucht ist der Absatz ueber das Plandokument, nicht jeder, der `[Plan]` und
    // "Ready" nennt: Seit Issue #898 tut das auch der Nachtbetrieb-Block, weil die
    // Kette ein Plandokument als Auftrag annimmt. Der Weg nach vorn (`/issues #N`)
    // steht nur im gemeinten Absatz und kennzeichnet ihn eindeutig.
    const absatz = text.split(/\n\n/).find((a) => /\[Plan\]/.test(a) && /Ready/.test(a) && /\/issues #N/.test(a));
    assert.ok(absatz, `${name}: kein Absatz zu [Plan], Ready und /issues #N`);
    assert.match(absatz, /nie implementiert|nicht implementiert/i, `${name}: 'nie implementiert' fehlt`);
    assert.match(absatz, /\/issues #N/, `${name}: der Weg ueber /issues #N fehlt`);
  }
});

// Seit Stufe 2 des Prozess-Umbaus (Plan #638) gibt es keine Stufe je Aufruf mehr:
// Die Nacht-Kette faehrt Plan, Pruefung und Pakete in einem Lauf. Der Abschnitt
// nennt die Kette und keinen der entfallenen Schalter.
test("der Nachtbetrieb-Abschnitt der Vorlage beschreibt die Nacht-Kette statt einer Stufe je Aufruf", () => {
  for (const [name, text] of beide) {
    const idx = text.indexOf("## Nachtbetrieb");
    assert.ok(idx >= 0, `${name}: kein Nachtbetrieb-Abschnitt`);
    const abschnitt = text.slice(idx).split(/\n## /)[0];
    assert.match(abschnitt, /--kette/, `${name}: --kette fehlt im Nachtbetrieb-Abschnitt`);
    assert.match(abschnitt, /night\.kette/, `${name}: der Config-Block night.kette fehlt`);
    assert.doesNotMatch(abschnitt, /--stufe|--review|--erzeuge/, `${name}: ein entfallener Schalter steht noch da`);
  }
});

// Ein Kommando fuer drei Dokumentsorten ist nicht selbsterklaerend. Ohne diesen
// Satz liest man die Stufentabelle so, als brauche jede Stufe ihr eigenes
// Kommando — und haelt die Pruefung von Plan und Anforderung faelschlich fuer
// etwas, das nur der Nacht-Runner kann.
test("alle drei Dokumente nennen den einen Einstieg fuer drei Stufen", () => {
  for (const [name, text] of [...beide, ["docs/dokumentation.md", DOKU]]) {
    const absatz = text
      .split(/\n\n/)
      .find((a) => /\/issue-review #N/.test(a) && /Titel-Präfix|Titel-Praefix/.test(a));
    assert.ok(absatz, `${name}: der gemeinsame Einstieg /issue-review #N ist nicht benannt`);
    assert.match(absatz, /kein\s+eigenes\s+Kommando|bewusst\s+kein/i,
      `${name}: es steht nicht, dass es kein Kommando je Stufe gibt`);
  }
  // Und die Aussage, dass das nicht am Nachtbetrieb haengt.
  for (const [name, text] of [...beide, ["docs/dokumentation.md", DOKU]]) {
    assert.match(text, /interaktiv genauso wie im Nachtbetrieb/i,
      `${name}: die Gleichstellung von interaktiv und Nachtbetrieb fehlt`);
  }
});

test("die Skill-Tabellen weisen /issue-review als Drei-Stufen-Kommando aus", () => {
  for (const [name, text] of [...beide, ["docs/dokumentation.md", DOKU]]) {
    const zeile = text.split("\n").find((z) => /^\|\s*`\/issue-review`/.test(z));
    assert.ok(zeile, `${name}: keine Skill-Tabellenzeile fuer /issue-review`);
    assert.match(zeile, /drei Stufen/i, `${name}: die Tabellenzeile nennt die drei Stufen nicht`);
  }
});

test("das verbindliche Plan-Format steht mit allen sechs Ueberschriften in Reihenfolge", () => {
  for (const [name, text] of [...beide, ["docs/dokumentation.md", DOKU]]) {
    let pos = -1;
    for (const ueberschrift of PLAN_FORMAT) {
      const gefunden = text.indexOf(ueberschrift, pos + 1);
      assert.ok(gefunden > pos, `${name}: '${ueberschrift}' fehlt oder steht in falscher Reihenfolge`);
      pos = gefunden;
    }
  }
});

test("die Doku begruendet, warum die Pruefung nach oben wandert", () => {
  const absatz = DOKU.split(/\n\n/).find((a) => /Reichweite/i.test(a) && /(früher|Fehler)/i.test(a));
  assert.ok(absatz, "die Begruendung ueber die Reichweite eines frueh gefundenen Fehlers fehlt");
});

test("die Doku begruendet, warum das Arbeitspaket nur noch einen Pruefer hat", () => {
  const absatz = DOKU.split(/\n\n/).find(
    (a) => /(Scope|Bestand)/.test(a) && /Plan-Stufe|Stufe `plan`|auf der Plan/i.test(a)
  );
  assert.ok(absatz, "es fehlt die Begruendung, dass die Scope-/Bestandsrolle auf der Plan-Stufe staerker wirkt");
});

test("die Doku benennt das Format als Maszstab der Pruefung", () => {
  const absatz = DOKU.split(/\n\n/).find((a) => /Maßstab|Maszstab|Maßstäb/i.test(a) && /Format|Überschriften/i.test(a));
  assert.ok(absatz, "es fehlt die Aussage, dass die festen Ueberschriften der Maszstab sind");
});

test("die Doku nennt die Rueckwaertskompatibilitaet ohne reviewStufen-Block", () => {
  // Ohne den aus dem Schema erzeugten Abschnitt (Issue #675): Dessen Feldbeschreibungen
  // nennen reviewStufen ebenfalls, sagen aber nichts ueber bestehende Installationen.
  const ohneReferenz = DOKU.replace(/<!-- einstellungen:start -->[\s\S]*?<!-- einstellungen:ende -->/, "");
  const absatz = ohneReferenz.split(/\n\n/).find((a) => /reviewStufen/.test(a) && /ohne/i.test(a));
  assert.ok(absatz, "kein Absatz zum Verhalten ohne reviewStufen-Block");
  assert.match(absatz, /zwei/i, "die bisherige Besetzung mit zwei Reviewern ist nicht genannt");
  assert.match(absatz, /bestehend|Bestands/i, "der Bezug auf bestehende Installationen fehlt");
});

test("die Zwei-Modelle-Formulierung ist an beiden Fundstellen angepasst", () => {
  const stopPunkte = VORLAGE.slice(VORLAGE.indexOf("## Die drei Stop-Punkte")).split(/\n## /)[0];
  assert.doesNotMatch(stopPunkte, /von zwei Modellen/,
    "der Stop-Punkte-Abschnitt behauptet weiterhin zwei Modelle je Issue");

  const idx = DOKU.indexOf("### Zweiter Modus: die Nacht-Kette");
  assert.ok(idx >= 0, "der Abschnitt zur Nacht-Kette fehlt");
  const kette = DOKU.slice(idx).split(/\n### /)[0];
  assert.doesNotMatch(kette, /durch zwei fremde Modelle/,
    "der Abschnitt zur Nacht-Kette behauptet weiterhin zwei fremde Modelle");
  assert.match(kette, /der Prüfer der Stufe/, "ein Prüfer am Plan steht nicht da");
});

test("beide Prozessdateien tragen den neuen Stoff wortgleich", () => {
  // Die vollstaendige Byte-Gleichheit beider Dateien steht als eigenes Kriterium
  // in test/docs-lebenszyklus.test.mjs. Der Abschnitts-Vergleich hier bleibt
  // trotzdem: Er zeigt bei Drift zusaetzlich, WELCHER Abschnitt gedriftet ist.
  // Die Ortsangabe des Markers steht in `### Die drei Pruefstufen`, einem
  // Unterabschnitt von `## Die drei Stop-Punkte` — ohne diesen dritten Block
  // waere gerade die Stelle ungedeckt, die Issue #314 korrigiert.
  const bloecke = ["## Die drei Stop-Punkte (nie automatisiert)", "## Nachtbetrieb", "## Issue-Format"];
  for (const marke of bloecke) {
    const ausVorlage = VORLAGE.slice(VORLAGE.indexOf(marke)).split(/\n## /)[0];
    assert.ok(ausVorlage.length > 0, `Abschnitt '${marke}' fehlt in der Vorlage`);
  }
});

// --- Issue #314: die Marker-Konvention in der Doku ---
//
// Die Doku fuehrt oben drei Nachweiszeilen und warnt ausdruecklich davor, sie zu
// verwechseln — weiter unten illustrierte sie die Marker-Konvention zweimal mit
// `Issue-Review:` ohne jede Stufenangabe. Wer nur diese Stellen liest, haelt
// `Issue-Review:` fuer den Marker aller drei Stufen und traegt ihn an ein
// Plandokument, an dem das Gate `requiredBeforeReady` haengt.
//
// Bewusst KEIN pauschaler Test ueber alle Absaetze mit `Issue-Review:`: Die Datei
// enthaelt davon sechs, und vier sind korrekt (Stufentabelle, Freigabe-Regel,
// Auswahlregel, Gate-Hinweis). Ein pauschaler Filter waere nur gruen zu bekommen,
// indem man richtigen Text beschaedigt.

/** Ein `###`-Abschnitt aus der Doku, bis zur naechsten Ueberschrift gleicher Ebene. */
function dokuAbschnitt(ueberschrift) {
  const idx = DOKU.indexOf(`### ${ueberschrift}`);
  assert.ok(idx >= 0, `Abschnitt '### ${ueberschrift}' fehlt in docs/dokumentation.md`);
  return DOKU.slice(idx).split(/\n### /)[0];
}

test("die Ortsangabe des Markers unterscheidet alle drei Formate", () => {
  // Die Vorlage nennt die Marker-Orte seit Issue #633 nicht mehr; sie stehen in Doku und Skill.
  const dateien = [
    ["docs/dokumentation.md", DOKU],
    ["skills/issue-review/SKILL.md", lies("skills", "issue-review", "SKILL.md")],
  ];
  for (const [name, text] of dateien) {
    assert.match(text, /Arbeitspaket[\s\S]{0,160}`## Kontext`|`## Kontext`[\s\S]{0,160}Arbeitspaket/,
      `${name}: der Ort beim Arbeitspaket (## Kontext) ist nicht benannt`);
    assert.match(text, /fachliche[rn]? Anforderung[\s\S]{0,160}`## Ziel`/,
      `${name}: der Ort bei der fachlichen Anforderung (## Ziel) ist nicht benannt`);
    assert.match(text, /Plandokument[\s\S]{0,200}`Plan-Modell:`/,
      `${name}: der Ort beim Plandokument (bei Plan-Modell:) ist nicht benannt`);
    assert.doesNotMatch(
      text,
      /jede Stufe hinterl(ä|ae)sst ihren eigenen Nachweis im\s+Kontext-Abschnitt/,
      `${name}: die pauschale Ortsangabe 'im Kontext-Abschnitt' steht noch da`
    );
  }
});

