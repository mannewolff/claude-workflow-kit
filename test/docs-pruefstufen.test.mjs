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

test("die Marker-Beispiele der Doku nennen die Stufe, zu der sie gehoeren", () => {
  for (const ueberschrift of ["Wer entscheidet", "Im Nachtbetrieb"]) {
    const abschnitt = dokuAbschnitt(ueberschrift);
    const beispiel = abschnitt.indexOf("Issue-Review: codex");
    assert.ok(beispiel >= 0, `'${ueberschrift}': kein Issue-Review-Beispiel gefunden`);
    // Der einleitende Text steht VOR dem Beispiel — nur er wird geprueft, damit
    // eine spaetere Erwaehnung weiter unten den Test nicht faelschlich rettet.
    const davor = abschnitt.slice(0, beispiel);
    assert.match(
      davor,
      /Stufe\s+`?issue`?|Arbeitspaket/,
      `'${ueberschrift}': der Text vor dem Issue-Review-Beispiel bindet es nicht an die Stufe issue`
    );
  }
});

// Seit Issue #418 schreibt der unbeaufsichtigte Lauf auf allen drei Stufen. Der
// Test prueft deshalb die neue Fallunterscheidung — und die Schutzregel, die an
// die Stelle des Stufenverbots getreten ist. Die Begruendung bleibt dieselbe:
// PO-Antworten und Architekturentscheidungen hat ein Mensch getroffen. Nur der
// Schutz haengt jetzt am Inhalt statt an der Stufe.
test("der Nachtbetrieb-Abschnitt der Doku erklaert die Fallunterscheidung und die Schutzregel", () => {
  const abschnitt = dokuAbschnitt("Im Nachtbetrieb");
  for (const [was, muster] of [
    ["die Stufe fachlich", /`fachlich`/],
    ["die Stufe plan", /`plan`/],
    ["die Geltung fuer alle drei Stufen", /alle drei Stufen|jede[rn]? Stufe/i],
    ["das Schreiben bei lauter korrektur-Funden", /alle Funde `korrektur`/],
    ["das Ausbleiben des Markers im Klaerungsfall", /kein Marker|Marker bleibt aus|Marker.{0,30}nicht gesetzt/i],
    ["das Zeichnen mit kit:klaeren", /kit:klaeren/],
    ["die PO-Antworten als Begruendung", /Product Owner|PO-Antworten|PO-Antwort/],
    ["die Architekturentscheidungen als Begruendung", /architektonische[nr]? Entscheidungen|Architekturentscheidungen/i],
    ["den Menschen als Entscheider", /ein Mensch|Mensch getroffen/i],
  ]) {
    assert.match(abschnitt, muster, `der Nachtbetrieb-Abschnitt nennt ${was} nicht`);
  }
  // Die eigentliche Aussage von #418: geschuetzt ist der Inhalt, nicht der Ort.
  assert.match(abschnitt, /nicht die Stufen, sondern die Inhalte|nicht die Stufe, sondern/i,
    "die Verlagerung vom Ort auf den Inhalt ist nicht ausgesprochen");
});

// Story- und Plan-Format haben keinen `## Kontext`. Die pauschale Ansage "im
// Kontext-Abschnitt" war deshalb fuer zwei von drei Stufen nicht befolgbar.
// Massgeblich fuer die fachliche Anforderung ist skills/fachplan/SKILL.md: dort
// gehoert `Autor-Modell:` in den Abschnitt `## Ziel`.
test("die Ortsangabe des Markers unterscheidet alle drei Formate", () => {
  const dateien = [
    ["docs/dokumentation.md", DOKU],
    ["templates/CLAUDE-workflow.md", VORLAGE],
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

// --- Issue #307: Pruefvorgabe, Verzicht und Verfall in der Doku ---
//
// Am Ticket stehen zwei Zeilen, die sich zum Verwechseln aehnlich sehen und
// trotzdem verschiedene Besitzer haben: `Pruefung:` schreibt der Mensch,
// `Pruefung-Stand:` die Maschine. Wer die zweite von Hand anfasst, laesst seine
// eigene Vorgabe verfallen — lautlos, denn der Verfall ist kein Fehler, sondern
// der Rueckfall auf den Regelfall. Diese Arbeitsteilung ist nirgends erkennbar,
// wenn sie nirgends steht.

/** Der Doku-Abschnitt zur Pruefvorgabe — ueber seine Ueberschrift gefunden. */
function pruefvorgabeAbschnitt() {
  const treffer = DOKU.split(/\n(?=### )/).find((a) =>
    /^### .*(Verzicht|Prüfvorgabe|Pruefvorgabe|Prüfumfang)/.test(a)
  );
  assert.ok(treffer, "kein ###-Abschnitt zur Pruefvorgabe in docs/dokumentation.md");
  return treffer;
}

test("beide Prozessdateien erklaeren beide Pruefzeilen und ihre Besitzer", () => {
  for (const [name, text] of beide) {
    const idx = text.indexOf("## Issue-Format");
    assert.ok(idx >= 0, `${name}: kein Issue-Format-Abschnitt`);
    // Abgegrenzt am `---`-Trenner, NICHT an der naechsten `## `-Zeile: Der
    // Abschnitt zeigt das Vier-Abschnitt-Format in einem Codeblock, und dessen
    // `## Kontext` wuerde den Abschnitt gleich hinter der Ueberschrift kappen.
    const abschnitt = text.slice(idx).split(/\n---\n/)[0];

    assert.match(abschnitt, /`?Pruefung: *<1\|2\|3\|Verzicht>`?/,
      `${name}: die Vorgabezeile 'Pruefung: <1|2|3|Verzicht>' fehlt`);
    assert.match(abschnitt, /Pruefung-Stand:/,
      `${name}: die Standzeile 'Pruefung-Stand:' fehlt`);

    // Wer schreibt was — ohne diese Zuordnung sind beide Zeilen nur Syntax.
    assert.match(abschnitt, /`?Pruefung:`?[\s\S]{0,200}(setzt der Mensch|schreibt der Mensch|nur der Mensch)/i,
      `${name}: es steht nicht, dass 'Pruefung:' der Mensch setzt`);
    assert.match(abschnitt, /Pruefung-Stand:[\s\S]{0,240}(maschinell|die Maschine|nicht von Hand)/i,
      `${name}: es steht nicht, dass 'Pruefung-Stand:' maschinell gepflegt wird`);

    assert.match(abschnitt, /issueReview\.rounds|`rounds`/,
      `${name}: der Regelfall aus issueReview.rounds ist nicht als Default benannt`);
    assert.match(abschnitt, /Verringerung|verringer/i,
      `${name}: die Regel zur Verringerung fehlt`);
    assert.match(abschnitt, /unbeaufsichtigt|Nachtlauf|Nacht-Runner/i,
      `${name}: es steht nicht, dass ein unbeaufsichtigter Lauf dabei abgewiesen wird`);
    assert.match(abschnitt, /verfall|verfäll/i,
      `${name}: der Verfall bei inhaltlicher Aenderung fehlt`);
    assert.match(abschnitt, /verfall[\s\S]{0,300}Regelfall|Regelfall[\s\S]{0,300}verfall/i,
      `${name}: es steht nicht, dass nach dem Verfall wieder der Regelfall gilt`);
  }
});

test("die Doku nennt die drei Zustaende eines Arbeitspakets", () => {
  const abschnitt = pruefvorgabeAbschnitt();
  for (const [was, muster] of [
    ["geprueft", /geprüft/],
    ["bewusst ohne Pruefung freigegeben", /bewusst ohne Prüfung freigegeben/i],
    ["noch nicht geprueft", /noch nicht geprüft/i],
  ]) {
    assert.match(abschnitt, muster, `der Zustand '${was}' fehlt in der Doku`);
  }
});

test("die Doku erklaert die Arbeitsteilung an den beiden Zeilen", () => {
  const abschnitt = pruefvorgabeAbschnitt();
  assert.match(abschnitt, /`Pruefung: *<1\|2\|3\|Verzicht>`|`Pruefung:`/,
    "die Vorgabezeile ist nicht benannt");
  assert.match(abschnitt, /`Pruefung-Stand:`|`Pruefung-Stand: *<hex>`/,
    "die Standzeile ist nicht benannt");
  assert.match(abschnitt, /(setzt|schreibt) der Mensch|nur der Mensch/i,
    "es steht nicht, welche Zeile der Mensch setzt");
  assert.match(abschnitt, /maschinell|die Maschine|`issue update`/,
    "es steht nicht, dass der Stand maschinell gepflegt wird");
});

test("die Doku bindet den Verfall an Aufgabe, Kriterien und Abhaengigkeiten", () => {
  const abschnitt = pruefvorgabeAbschnitt();
  for (const [was, muster] of [
    ["die Aufgabe", /Aufgabe/],
    ["das Akzeptanzkriterium", /Akzeptanzkriteri|Kriterien/],
    ["die Abhaengigkeiten", /Abhängigkeiten|Abhaengigkeiten/],
  ]) {
    assert.match(abschnitt, muster, `der Umfang des Bezugsstands nennt ${was} nicht`);
  }
  // Die Grenze ist die eigentliche Aussage: Der Kontext zaehlt NICHT mit, weil
  // dort die Kennzeichnungszeilen stehen — sonst waere jede Markierung Verfall.
  assert.match(abschnitt, /nicht[\s\S]{0,80}(der )?Kontext-Abschnitt|Kontext-Abschnitt[\s\S]{0,80}(zählt nicht|bleibt außen vor|nicht mit)/i,
    "es steht nicht, dass der Kontext-Abschnitt nicht zum Bezugsstand gehoert");
  assert.match(abschnitt, /Regelfall/,
    "es steht nicht, was nach dem Verfall gilt");
});

test("die Doku nennt den Randfall des fehlenden Bezugsstands", () => {
  const abschnitt = pruefvorgabeAbschnitt();
  const absatz = abschnitt.split(/\n\n/).find((a) => /Fehlt `Pruefung-Stand:`|ohne (Bezugs)?[Ss]tand|fehlt der Stand/i.test(a));
  assert.ok(absatz, "kein Absatz zum fehlenden Pruefung-Stand");
  assert.match(absatz, /gilt die Vorgabe|Vorgabe gilt|kein Verfall/i,
    "es steht nicht, dass ohne Stand die Vorgabe gilt");
});

test("die Doku benennt die Grenze der Human-only-Regel", () => {
  const abschnitt = pruefvorgabeAbschnitt();
  assert.match(abschnitt, /KIT_AGENT_MODEL/,
    "die Regel haengt an KIT_AGENT_MODEL — das steht nicht da");
  assert.match(abschnitt, /interaktiv/i,
    "die interaktive Session ist als Gegenstueck nicht benannt");
  assert.match(abschnitt, /verlängerter Arm|verlaengerter Arm|auf Ansage/i,
    "es steht nicht, dass eine interaktive Session als verlaengerter Arm des Menschen gilt");
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
