// Dokumentation der bereichsbezogenen Pruefungen (Issue #429, Plan #421,
// fachliche Quelle #420).
//
// Die Pruefungen waehlen sich seit Issue #424 nach Betroffenheit aus. Eine Doku,
// die weiterhin "alle buildChecks laufen" behauptet, ist nicht bloss unvollstaendig
// — sie widerspricht dem ausgelieferten Verhalten. Das Prozessregister ist dabei
// der heikelste Ort: An W3 misst jeder Review, ob ein Vorschlag ein Gate aufweicht;
// steht dort weiter "alle", muesste ein Reviewer die eingebaute Auswahl als
// Gate-Verstoss werten.
//
// Der zweite Schwerpunkt sind die beiden Anker. Sie sehen aus wie ein Detail und
// sind es nicht: Vertauscht man sie, prueft der eine Ort zu viel und der andere
// gar nichts — und der Bericht weist beides als korrekt aus. Deshalb verlangen die
// Tests hier nicht nur die Anker, sondern beide Fehlbilder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const DOKU = lies("docs", "dokumentation.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const README = lies("README.md");

/** Ein `###`-Abschnitt der Doku, bis zur naechsten Ueberschrift gleicher oder hoeherer Ebene. */
function dokuAbschnitt(ueberschrift) {
  const idx = DOKU.indexOf(`### ${ueberschrift}`);
  assert.ok(idx >= 0, `Abschnitt '### ${ueberschrift}' fehlt in docs/dokumentation.md`);
  return DOKU.slice(idx).split(/\n#{2,3} /)[0];
}

/** Der Doku-Abschnitt zu den bereichsbezogenen Pruefungen — ueber seine Ueberschrift gefunden. */
function bereichsAbschnitt() {
  const treffer = DOKU.split(/\n(?=### )/).find((a) => /^### .*(checkAreas|Bereich)/.test(a));
  assert.ok(treffer, "kein ###-Abschnitt zu den bereichsbezogenen Pruefungen in docs/dokumentation.md");
  return treffer.split(/\n#{2,3} /)[0];
}

/** Der Absatz eines Textes, der alle Muster enthaelt. */
function absatzMit(text, ...muster) {
  return text.split(/\n\n/).find((a) => muster.every((m) => m.test(a)));
}

// --- Punkt 2: die drei Eintragsformen -------------------------------------

test("die Doku nennt alle drei Formen eines buildChecks-Eintrags", () => {
  const abschnitt = bereichsAbschnitt();
  for (const [was, muster] of [
    ["die blosse String-Form", /Kommandostring|String-Form|blosser? String|bloße[rn]? String/i],
    ["die Objektform mit areas", /`areas`|"areas"/],
    ["die Objektform mit always", /`always(: ?true)?`|"always"/],
  ]) {
    assert.match(abschnitt, muster, `die Doku nennt ${was} nicht`);
  }
});

// Der Unterschied ist die eigentliche Aussage der Konfigurationsform: Beide Formen
// verhalten sich gleich, und genau deshalb ist nur an der Absicht zu erkennen, ob
// jemand eine Zuordnung getroffen oder vergessen hat.
test("die Doku spricht den Unterschied zwischen String und always: true aus", () => {
  const abschnitt = bereichsAbschnitt();
  const absatz = absatzMit(abschnitt, /always/, /vergessen/i, /entschieden/i);
  assert.ok(absatz, "kein Absatz stellt 'vergessen' und 'entschieden' gegenueber");
  assert.match(absatz, /gleich(es)? Verhalten|verhalten sich gleich|dasselbe/i,
    "es steht nicht, dass sich beide Formen gleich verhalten");
});

test("die Doku nennt den Ausschluss von areas und always und das nicht leere areas", () => {
  const abschnitt = bereichsAbschnitt();
  assert.match(abschnitt, /schließen sich aus|schliessen sich aus|nicht zusammen/i,
    "es steht nicht, dass areas und always sich ausschliessen");
  assert.match(abschnitt, /`areas`[^.]{0,120}(nicht leer|mindestens ein)|(nicht leer|mindestens ein)[^.]{0,120}`areas`/i,
    "es steht nicht, dass areas nicht leer sein darf");
});

// --- Punkt 3: checkAreas und die Glob-Semantik ----------------------------

test("die Doku erklaert die Glob-Semantik von checkAreas ohne externe Abhaengigkeit", () => {
  const abschnitt = bereichsAbschnitt();
  assert.match(abschnitt, /`checkAreas`/, "der Block checkAreas ist nicht benannt");
  assert.match(abschnitt, /`\*`[\s\S]{0,200}Pfadsegment/,
    "die Bedeutung von '*' innerhalb eines Pfadsegments fehlt");
  assert.match(abschnitt, /`\*\*`[\s\S]{0,200}Segmentgrenz/,
    "die Bedeutung von '**' ueber Segmentgrenzen fehlt");
  assert.match(abschnitt, /`\/`[\s\S]{0,160}(Trenner|normalisiert)/,
    "der '/' als normalisierter Trenner fehlt");
  assert.match(abschnitt, /(keine|ohne)[\s\S]{0,120}(Laufzeitabhängigkeit|Abhängigkeit|Paket)/i,
    "es steht nicht, dass die Auswertung ohne externe Laufzeitabhaengigkeit auskommt");
});

// --- Punkt 4: die beiden Anker und ihre Fehlbilder ------------------------

test("die Doku ordnet jedem Anker seinen Ort zu", () => {
  const abschnitt = bereichsAbschnitt();
  const vorCommit = absatzMit(abschnitt, /`HEAD`/, /implement-/, /Commit/);
  assert.ok(vorCommit, "kein Absatz bindet HEAD an die implement-Skills vor dem Commit");
  assert.match(vorCommit, /Arbeitspaket/i, "es steht nicht, dass HEAD genau das eine Arbeitspaket misst");

  const vorPush = absatzMit(abschnitt, /merge-base/, /local-check/, /Push/);
  assert.ok(vorPush, "kein Absatz bindet merge-base an /local-check vor dem Push");
  assert.match(vorPush, /seit dem letzten Push/i,
    "es steht nicht, dass merge-base alles seit dem letzten Push misst");
});

// Ohne die Fehlbilder liest sich die Ankerwahl wie Geschmackssache. Sie ist keine:
// Beide Vertauschungen fuehren zu einem Bericht, der korrekt aussieht.
test("die Doku benennt beide Fehlbilder der vertauschten Anker", () => {
  const abschnitt = bereichsAbschnitt();

  const falschVorCommit = absatzMit(abschnitt, /merge-base/, /(vor dem Commit|beim Commit)/i, /fremde/i);
  assert.ok(falschVorCommit,
    "das Fehlbild 'merge-base vor dem Commit sammelt fremde Pakete ein' fehlt");

  const falschVorPush = absatzMit(abschnitt, /`HEAD`/, /(vor dem Push|beim Push)/i, /leeresPaket/);
  assert.ok(falschVorPush,
    "das Fehlbild 'HEAD vor dem Push meldet leeresPaket' fehlt");
  assert.match(falschVorPush, /(ließe|liesse|lässt|laesst)[\s\S]{0,80}aus|keine (einzige )?Prüfung/i,
    "es steht nicht, dass dabei jede Pruefung ausgelassen wuerde");
});

// --- Punkt 5: die Zweifelsregel -------------------------------------------

test("die Doku nennt die drei Wege in den vollen Umfang und ihre Unabschaltbarkeit", () => {
  const abschnitt = bereichsAbschnitt();
  for (const [was, muster] of [
    ["die nicht zuordenbare Datei", /keinem Bereich|kein Muster|nicht zuordnen/i],
    ["die nicht zugeordnete Pruefung", /nicht zugeordnete? (Prüfung|Check)/i],
    ["den leeren oder nicht aufloesbaren Anker", /(leerer|leeren)[\s\S]{0,60}Anker|Anker[\s\S]{0,60}(nicht auflösbar|nicht aufgelöst)/i],
  ]) {
    assert.match(abschnitt, muster, `die Zweifelsregel nennt ${was} nicht`);
  }
  assert.match(abschnitt, /[Nn]icht abschaltbar/, "es steht nicht, dass die Zweifelsregel nicht abschaltbar ist");
});

// Die Regel laedt zum Aufweichen ein, sobald sie oft greift. Der Hinweis dreht das
// um: Haeufige Zweifelsfaelle sind ein Befund ueber die Zuordnung, nicht ueber die Regel.
test("die Doku deutet haeufige Zweifelsfaelle als Signal fuer die Zuordnung", () => {
  const abschnitt = bereichsAbschnitt();
  const absatz = absatzMit(abschnitt, /häufig|oft/i, /Zuordnung/);
  assert.ok(absatz, "kein Absatz deutet haeufige Zweifelsfaelle");
  assert.match(absatz, /(Zuordnung)[\s\S]{0,140}(verbessert|verbessern|nachschärfen)|nicht die Regel/i,
    "es steht nicht, dass dann die Zuordnung gehoert verbessert und nicht die Regel aufgeweicht");
});

// --- Punkt 6: Projekte ohne checkAreas und mutationCommand ----------------

test("die Doku sagt, was ein Projekt ohne checkAreas erlebt", () => {
  const abschnitt = bereichsAbschnitt();
  const absatz = absatzMit(abschnitt, /ohne\s+`?checkAreas`?/i, /(unverändert|wie bisher|alle)/i);
  assert.ok(absatz, "kein Absatz zum Verhalten ohne checkAreas");
  assert.match(absatz, /alle (Prüfungen|Checks|Kommandos)/i,
    "es steht nicht, dass dann alle Pruefungen laufen");
  assert.match(absatz, /still|heimlich|unbemerkt/i,
    "es steht nicht, dass die Umstellung niemandem still Pruefung wegnimmt");
});

test("die Doku weist mutationCommand als ausserhalb der Auswahl aus", () => {
  const abschnitt = bereichsAbschnitt();
  const absatz = absatzMit(abschnitt, /`mutationCommand`/, /(Auswahl|immer)/i);
  assert.ok(absatz, "kein Absatz zu mutationCommand");
  assert.match(absatz, /nicht Teil der Auswahl|außerhalb der Auswahl|nicht in die Auswahl/i,
    "es steht nicht, dass mutationCommand nicht Teil der Auswahl ist");
  assert.match(absatz, /(läuft|laeuft)[\s\S]{0,60}immer|immer[\s\S]{0,60}(läuft|laeuft)/i,
    "es steht nicht, dass mutationCommand unveraendert immer laeuft");
});

// --- Punkt 7: die bestehenden Aussagen ueber den vollen Lauf --------------

test("das Konfigurationskapitel behauptet nicht mehr den vollen Lauf", () => {
  const kapitel = DOKU.slice(DOKU.indexOf("## Die Config-Datei")).split(/\n## /)[0];
  const absatz = absatzMit(kapitel, /`buildChecks`/, /local-check/);
  assert.ok(absatz, "kein buildChecks-Absatz im Konfigurationskapitel");
  assert.doesNotMatch(absatz, /Alle müssen grün sein/,
    "der buildChecks-Absatz behauptet weiterhin, dass alle Kommandos gruen sein muessen");
  assert.match(absatz, /betroffen/i, "der buildChecks-Absatz nennt die Betroffenheit nicht");
});

test("der /local-check-Abschnitt beschreibt die Auswahl statt des vollen Laufs", () => {
  const abschnitt = dokuAbschnitt("/local-check");
  assert.doesNotMatch(abschnitt, /führt alle Kommandos aus `buildChecks` sequenziell aus/,
    "der Abschnitt behauptet weiterhin den vollen sequenziellen Lauf");
  assert.match(abschnitt, /checks\.mjs/, "der Abschnitt nennt das Kommando checks.mjs nicht");
  assert.match(abschnitt, /betroffen/i, "der Abschnitt nennt die betroffenen Pruefungen nicht");
});

test("die implement-Abschnitte erwaehnen die Pruefung vor dem Commit", () => {
  for (const ueberschrift of ["/implement-ready", "/implement-next", "/implement-test und /implement-done"]) {
    const abschnitt = dokuAbschnitt(ueberschrift);
    assert.match(abschnitt, /(Prüfung|Prüfungen|Checks)[\s\S]{0,120}vor dem Commit|vor dem Commit[\s\S]{0,120}(Prüfung|Prüfungen|Checks)/i,
      `'${ueberschrift}': die Pruefung vor dem Commit ist nicht erwaehnt`);
  }
});

// --- Punkte 8 und 9: Nachtbetrieb ----------------------------------------

test("das Nachtbetriebs-Kapitel nennt beide Stellen, an denen Auslassungen sichtbar sind", () => {
  const kapitel = DOKU.slice(DOKU.indexOf("## Nachtbetrieb")).split(/\n## /)[0];
  const absatz = absatzMit(kapitel, /Abschlussbericht/, /Lauf-Bericht|Bericht des Durchgangs/);
  assert.ok(absatz, "kein Absatz nennt Abschlussbericht und Lauf-Bericht gemeinsam");
  assert.match(absatz, /ausgelassen/i, "die Auslassungen sind nicht benannt");
  assert.match(absatz, /je Session eine Zeile|pro Session eine Zeile/i,
    "die Zeile je Session fehlt");
  assert.match(absatz, /Summenzeile|Summe/i, "die Summenzeile fehlt");
});

// Der Salvage-Pfad ist die eine Stelle, an der bewusst weiterhin alles laeuft. Ohne
// die Begruendung im Text liest ein spaeterer Leser das als vergessene Umstellung.
test("der Salvage-Absatz weist den vollen Lauf mit Begruendung aus", () => {
  const kapitel = DOKU.slice(DOKU.indexOf("## Nachtbetrieb")).split(/\n## /)[0];
  const absatz = absatzMit(kapitel, /Salvage/, /buildChecks/);
  assert.ok(absatz, "kein Salvage-Absatz mit buildChecks");
  assert.match(absatz, /volle[nrs]? (Liste|Umfang)|alle `buildChecks`/i,
    "es steht nicht, dass im Salvage-Pfad die volle Liste laeuft");
  assert.match(absatz, /kaputt|beschädigt/i,
    "die Frage nach einem sauberen Paket ('hat diese Arbeit etwas kaputtgemacht?') fehlt");
  assert.match(absatz, /brauchbar|Zwischenstand überhaupt/i,
    "die Frage beim Retten ('ist dieser Zwischenstand ueberhaupt brauchbar?') fehlt");
  // Ein Leser der ausgelieferten Doku hat kein Board — eine Board-Nummer waere dort
  // ein Verweis ins Leere.
  assert.doesNotMatch(absatz, /Issue #\d+|Plan #\d+/,
    "der Salvage-Absatz verweist auf eine Board-Nummer");
});

// --- Vorlage: Pflichtchecks und W3 ---------------------------------------

test("die Vorlage nennt in 'Pflichtchecks vor Push' die betroffenen Checks", () => {
  const idx = VORLAGE.indexOf("## Pflichtchecks vor Push");
  assert.ok(idx >= 0, "der Abschnitt 'Pflichtchecks vor Push' fehlt in der Vorlage");
  const abschnitt = VORLAGE.slice(idx).split(/\n---/)[0];
  assert.doesNotMatch(abschnitt, /Alle `buildChecks` aus der Config laufen gruen\./,
    "der Abschnitt behauptet weiterhin, dass alle buildChecks gruen laufen");
  // Die Hervorhebung darf zwischen den Woertern stehen ("**betroffenen** `buildChecks`").
  assert.match(abschnitt, /betroffene[nr]?\*{0,2}\s*`buildChecks`/i,
    "der Abschnitt nennt die betroffenen buildChecks nicht");
  assert.match(abschnitt, /Nachweis|ausgelassen/i,
    "der Nachweis fuer ausgelassene Bereiche fehlt");
  assert.match(abschnitt, /mechanisch/,
    "die mechanische Blockade durch rote Checks ist entfallen");
  // Der zweite Halbsatz bleibt unveraendert.
  assert.match(abschnitt, /nicht lokal ausfuehrbar[\s\S]{0,120}Abschlussbericht/,
    "der Hinweis auf nicht lokal ausfuehrbare Checks im Abschlussbericht fehlt");
});

test("die Vorlage nennt in Regel W3 die betroffenen Checks", () => {
  const idx = VORLAGE.indexOf("### W3 —");
  assert.ok(idx >= 0, "Regel W3 fehlt in der Vorlage");
  const regel = VORLAGE.slice(idx).split(/\n### /)[0];
  assert.doesNotMatch(regel, /Alle `buildChecks` laufen gruen, bevor gepusht wird/,
    "W3 behauptet weiterhin, dass alle buildChecks gruen laufen");
  assert.match(regel, /betroffene[nr]?\*{0,2}\s*`buildChecks`/i,
    "W3 nennt die betroffenen buildChecks nicht");
  assert.match(regel, /Nachweis|ausgelassen/i, "W3 nennt den Nachweis fuer Auslassungen nicht");
  assert.match(regel, /mechanisch/, "W3 hat die Mechanik der roten Checks verloren");
  assert.match(regel, /nicht lokal ausfuehrbar[\s\S]{0,120}Abschlussbericht/,
    "W3 verliert den Hinweis auf nicht lokal ausfuehrbare Checks");
});

// --- README ---------------------------------------------------------------

test("das README nennt checkAreas und verweist im selben Absatz auf die Doku", () => {
  const absatz = absatzMit(README, /checkAreas/);
  assert.ok(absatz, "das README nennt checkAreas nicht");
  assert.match(absatz, /docs\/dokumentation\.md|docs\.mwolff\.org/,
    "der Verweis auf das Doku-Kapitel fehlt im selben Absatz");
});
