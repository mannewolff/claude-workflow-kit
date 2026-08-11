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
const KOPIE = lies(".claude", "CLAUDE-workflow.md");
const DOKU = lies("docs", "dokumentation.md");

/** Beide Prozessdateien — die Auslieferungsvorlage und die gelebte Kopie. */
const beide = [
  ["templates/CLAUDE-workflow.md", VORLAGE],
  [".claude/CLAUDE-workflow.md", KOPIE],
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

test("beide Prozessdateien ordnen jeder Stufe ihren Nachweis zu", () => {
  for (const [name, text] of beide) {
    for (const [stufe, marker] of [
      ["fachlich", "Fachplan-Review:"],
      ["plan", "Plan-Review:"],
      ["issue", "Issue-Review:"],
    ]) {
      const zeile = text.split("\n").find((z) => z.includes(marker) && new RegExp(`\`?${stufe}\`?`).test(z));
      assert.ok(zeile, `${name}: keine Zeile ordnet der Stufe '${stufe}' den Nachweis '${marker}' zu`);
    }
  }
});

test("beide Prozessdateien sagen, dass nur Issue-Review die Umsetzung freigibt", () => {
  for (const [name, text] of beide) {
    const absatz = text
      .split(/\n\n/)
      .find((a) => /Issue-Review:/.test(a) && /freigibt|freigegeben|gibt die Umsetzung frei/i.test(a));
    assert.ok(absatz, `${name}: die Freigabe-Regel fehlt`);
    assert.match(
      absatz,
      /Fachplan-Review:[\s\S]{0,120}Plan-Review:|Plan-Review:[\s\S]{0,120}Fachplan-Review:/,
      `${name}: der Absatz sagt nicht, dass die anderen beiden Marker sie nicht ersetzen`
    );
  }
});

test("beide Prozessdateien behandeln [Plan] als nicht implementierbar", () => {
  for (const [name, text] of beide) {
    const absatz = text.split(/\n\n/).find((a) => /\[Plan\]/.test(a) && /Ready/.test(a));
    assert.ok(absatz, `${name}: kein Absatz zu [Plan] und Ready`);
    assert.match(absatz, /nie implementiert|nicht implementiert/i, `${name}: 'nie implementiert' fehlt`);
    assert.match(absatz, /\/issues #N/, `${name}: der Weg ueber /issues #N fehlt`);
  }
});

test("beide Nachtbetrieb-Abschnitte erklaeren eine Stufe pro Aufruf samt Default", () => {
  for (const [name, text] of beide) {
    const idx = text.indexOf("## Nachtbetrieb");
    assert.ok(idx >= 0, `${name}: kein Nachtbetrieb-Abschnitt`);
    const abschnitt = text.slice(idx).split(/\n## /)[0];
    assert.match(abschnitt, /--stufe/, `${name}: --stufe fehlt im Nachtbetrieb-Abschnitt`);
    assert.match(
      abschnitt,
      /genau eine (Pruef)?[Ss]tufe|eine Stufe pro Aufruf|ein Aufruf, eine Stufe/i,
      `${name}: die Regel 'ein Aufruf, eine Stufe' fehlt`
    );
    // Zeilenumbrueche sind in diesen Dateien hart gesetzt — \s+ statt " ".
    assert.match(abschnitt, /Default\s+`?issue`?|ohne Angabe gilt\s+`?issue`?/i,
      `${name}: der Default 'issue' fehlt`);
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
  const absatz = DOKU.split(/\n\n/).find((a) => /reviewStufen/.test(a) && /ohne/i.test(a));
  assert.ok(absatz, "kein Absatz zum Verhalten ohne reviewStufen-Block");
  assert.match(absatz, /zwei/i, "die bisherige Besetzung mit zwei Reviewern ist nicht genannt");
  assert.match(absatz, /bestehend|Bestands/i, "der Bezug auf bestehende Installationen fehlt");
});

test("die Zwei-Modelle-Formulierung ist an beiden Fundstellen angepasst", () => {
  const stopPunkte = VORLAGE.slice(VORLAGE.indexOf("## Die drei Stop-Punkte")).split(/\n## /)[0];
  assert.doesNotMatch(stopPunkte, /von zwei Modellen/,
    "der Stop-Punkte-Abschnitt behauptet weiterhin zwei Modelle je Issue");

  const idx = DOKU.indexOf("### Zweiter Modus: der Nacht-Review");
  assert.ok(idx >= 0, "der Nacht-Review-Abschnitt fehlt");
  const nachtReview = DOKU.slice(idx).split(/\n### /)[0];
  assert.doesNotMatch(nachtReview, /durch zwei fremde Modelle/,
    "der Nacht-Review-Abschnitt behauptet weiterhin zwei fremde Modelle");
});

test("beide Prozessdateien tragen den neuen Stoff wortgleich", () => {
  // Byte-Gleichheit der ganzen Dateien gibt es seit dem Tracker-Umzug am
  // 2026-08-11 nicht mehr: Die Kopie dokumentiert den projekteigenen Tracker,
  // die Vorlage liefert den Auslieferungsdefault. Was gleich sein MUSS, ist der
  // Stoff dieses Issues — sonst driftet die Auslieferung von der gelebten Datei.
  const bloecke = ["## Nachtbetrieb", "## Issue-Format"];
  for (const marke of bloecke) {
    const ausVorlage = VORLAGE.slice(VORLAGE.indexOf(marke)).split(/\n## /)[0];
    const ausKopie = KOPIE.slice(KOPIE.indexOf(marke)).split(/\n## /)[0];
    assert.equal(ausKopie, ausVorlage, `Abschnitt '${marke}' ist zwischen Vorlage und Kopie gedriftet`);
  }
});

test("die dokumentierten --stufe-Werte stimmen mit night.mjs --help ueberein", () => {
  const help = execFileSync(process.execPath, [join(repoRoot, "kit", "night.mjs"), "--help"], {
    encoding: "utf-8",
  });

  const ausHelp = /Pruefstufe des Review-Modus:\s*([a-z |]+)/.exec(help);
  assert.ok(ausHelp, "--help weist keine Pruefstufen aus — ist Issue #283 umgesetzt?");
  const erwartet = ausHelp[1].split("|").map((s) => s.trim()).filter(Boolean).sort();
  assert.ok(erwartet.length > 0, "keine Stufenwerte in --help");
  assert.match(help, /Default issue/, "--help nennt den Default 'issue' nicht");

  for (const [name, text] of [["templates/CLAUDE-workflow.md", VORLAGE], ["docs/dokumentation.md", DOKU]]) {
    const treffer = /--stufe\s*<([a-z|]+)>/.exec(text);
    assert.ok(treffer, `${name}: keine --stufe-Werte dokumentiert`);
    const dokumentiert = treffer[1].split("|").map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(dokumentiert, erwartet,
      `${name}: dokumentierte Stufen weichen von --help ab`);
  }
});
