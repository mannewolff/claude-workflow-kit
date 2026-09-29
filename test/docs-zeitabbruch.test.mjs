// Der gekennzeichnete Zeitabbruch in Doku und Prozessvorlage (Issue #982, Plan #974,
// fachliche Quelle #963).
//
// Geprueft werden `docs/dokumentation.md` und `templates/CLAUDE-workflow.md` — die
// Vorlage und nicht die Kopie unter `.claude/`: Die ist Installer-Ausgabe und in CI nicht
// vorhanden (siehe docs-wartende-sitzung.test.mjs).
//
// Der dritte Block ist der eigentliche Anlass: Der Vermerk aus Issue #977 traegt einen
// Ursachen-Vorbehalt, und drei Stellen im Bestand behaupteten die Ursache woertlich. Aus
// einem Zeitabbruch folgt keine Aussage ueber seine Ursache — der Test haelt fest, dass
// keine der drei Wendungen zurueckkehrt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const DOKU = lies("docs", "dokumentation.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const NIGHT = lies("kit", "night.mjs");

/** Der Text eines Abschnitts bis zur naechsten Ueberschrift derselben Ebene. */
function abschnitt(text, ueberschrift) {
  const ebene = ueberschrift.match(/^#+/)[0];
  const start = text.indexOf(`${ueberschrift}\n`);
  if (start === -1) return "";
  const rest = text.slice(start + ueberschrift.length);
  const naechste = rest.search(new RegExp(`^${ebene} `, "m"));
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

test("[docs-zeitabbruch-1] das Nachtbetrieb-Kapitel beschreibt Vermerk, Felder und Berichtszeile", () => {
  const text = abschnitt(DOKU, "## Nachtbetrieb");
  assert.ok(text, "das Kapitel '## Nachtbetrieb' fehlt in der Dokumentation");

  for (const [was, muster] of [
    ["den Anker des Vermerks", /`## Nachtlauf: Zeitgrenze erreicht`/],
    ["den Stand nach eigener Auskunft der Sitzung", /Auskunft der Sitzung/],
    ["die Empfehlung ohne Vorgabe", /Empfehlung[^.]*keine Vorgabe/],
    ["den Ursachen-Vorbehalt des Vermerks", /keine Aussage ueber seine Ursache|keine Aussage über seine Ursache/],
    ["das Feld an der Einheit", /`zeitlimitBeendet[:`]/],
    ["das Feld im Lauf-Kopf", /`zielUmsetzungMin`/],
    ["die Berichtszeile der Kette", /Voraussichtlich über der Sitzungszeitgrenze/],
    ["den Massstab der Einschaetzung", /`--timeout-min`/],
    ["die Abgrenzung gegen das Stufenbudget", /`night\.kette\.umsetzungMin`/],
  ]) {
    assert.match(text, muster, `das Nachtbetrieb-Kapitel nennt ${was} nicht`);
  }

  // Der Massstab und seine Abgrenzung stehen in EINEM Absatz: getrennt liest man die
  // Grenze, ohne zu erfahren, welche Zahl gerade nicht gemeint ist.
  const absatz = text.split(/\n\n/).find((a) => a.includes("--timeout-min") && a.includes("night.kette.umsetzungMin"));
  assert.ok(absatz, "Massstab und Abgrenzung stehen nicht im selben Absatz");
  assert.match(absatz, /nicht/, "die Abgrenzung sagt nicht, dass das Stufenbudget nicht gemeint ist");
});

test("[docs-zeitabbruch-2] das Aufwand-Kapitel beschreibt den Kennzahlblock samt getrennten Zeitabbruechen", () => {
  const text = abschnitt(DOKU, "## Aufwand des Prozesses");
  assert.ok(text, "das Kapitel '## Aufwand des Prozesses' fehlt in der Dokumentation");

  for (const [was, muster] of [
    ["den Kennzahlblock beim Namen", /Zielmarke der Umsetzung/],
    ["den JSON-Block", /`zielmarke`/],
    ["die Marke aus dem Lauf-Kopf", /Lauf-Kopf/],
    ["die Mittelung ueber die Ueberschreitungen", /Überschreitung|Ueberschreitung/],
    ["die getrennt stehenden Zeitabbrüche", /Zeitabbrüche|Zeitabbrueche/],
    ["die unbekannte Fertigstellungsdauer", /Fertigstellungsdauer ist unbekannt/],
    ["dass sie in keinen Mittelwert eingehen", /keinen Mittelwert/],
  ]) {
    assert.match(text, muster, `das Aufwand-Kapitel nennt ${was} nicht`);
  }
});

test("[docs-zeitabbruch-3] die Prozessvorlage nennt Kennzahl und gekennzeichneten Zeitabbruch", () => {
  const aufwand = abschnitt(VORLAGE, "## Aufwand des Prozesses");
  assert.ok(aufwand, "der Abschnitt '## Aufwand des Prozesses' fehlt in der Vorlage");
  assert.match(aufwand, /Zielmarke/, "der Aufwand-Abschnitt nennt die Zielmarke nicht");
  assert.match(
    aufwand,
    /Zeitabbrueche|Zeitabbrüche/,
    "der Aufwand-Abschnitt sagt nicht, dass Zeitabbrueche getrennt stehen"
  );
  assert.match(aufwand, /Mittel/, "der Aufwand-Abschnitt sagt nicht, dass sie in kein Mittel eingehen");

  const nacht = abschnitt(VORLAGE, "## Nachtbetrieb (optional)");
  assert.ok(nacht, "der Abschnitt '## Nachtbetrieb (optional)' fehlt in der Vorlage");
  const satz = nacht.split(/\n\n/).find((a) => a.includes("## Nachtlauf: Zeitgrenze erreicht"));
  assert.ok(satz, "kein Absatz der Vorlage nennt den Anker '## Nachtlauf: Zeitgrenze erreicht'");
  for (const [was, muster] of [
    ["die Sitzungszeitgrenze als Massstab", /`--timeout-min`/],
    ["die Abgrenzung gegen das Stufenbudget", /`night\.kette\.umsetzungMin`/],
    ["das Feld an der Einheit", /`zeitlimitBeendet[:`]/],
    ["dass der Abbruch kein inhaltlicher Fehlschlag ist", /kein inhaltlicher Fehlschlag/],
  ]) {
    assert.match(satz, muster, `der Zeitabbruch-Satz der Vorlage nennt ${was} nicht`);
  }
});

// Die drei Stellen, die bis Issue #982 die Ursache eines Zeitabbruchs behaupteten. Sie
// stehen hier als Wendung und nicht als Zeilennummer: Die Nummer verschiebt sich mit
// jedem Absatz darueber, der Satz kehrt nur zurueck, wenn ihn jemand neu schreibt.
const URSACHENBEHAUPTUNGEN = [
  ["die Tabellenzeile zum Zeitlimit", /zu gro(?:ß|ss) f(?:ü|ue)r die Runde/i],
  ["der Timeout-Absatz in 'Wenn etwas schiefgeht'", /Aufgabe zu gro(?:ß|ss)/i],
  ["der Kommentar ueber den Grund-Konstanten", /Zeitlimit ist ein zu gro(?:ß|ss)es Paket/i],
];

test("[docs-zeitabbruch-4] keine der drei Stellen behauptet die Ursache eines Zeitabbruchs", () => {
  for (const [name, datei, text] of [
    ["Dokumentation", "docs/dokumentation.md", DOKU],
    ["Runner", "kit/night.mjs", NIGHT],
  ]) {
    for (const [stelle, muster] of URSACHENBEHAUPTUNGEN) {
      assert.ok(
        !muster.test(text),
        `${name} (${datei}): ${stelle} behauptet weiterhin die Ursache (${muster})`
      );
    }
  }
});
