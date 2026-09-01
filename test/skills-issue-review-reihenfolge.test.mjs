// Tests fuer die Reihenfolge der naechtlichen Schreibbefehle (Issue #415).
//
// Der Marker ist keine eigene Operation, sondern eine Zeile im Body. Die
// Reihenfolge fuehrte ihn bis Issue #415 als eigenen Schritt 5 hinter dem
// Synthese-Kommentar — mechanisch nicht ausfuehrbar, und beide moeglichen
// Lesarten brachen die Garantie "nie einen Marker ohne Synthese":
// stand der Marker im ersten `issue update`, war er vor der Synthese da;
// stand er dahinter, fehlte der Befehl dafuer.
//
// Aufgeloest ueber zwei Body-Schreibungen: erst geschaerft ohne Marker, nach
// erfolgreicher Synthese ein zweites `issue update` mit Marker.
//
// Geprueft wird Text, nicht Verhalten — wie in den uebrigen Skill-Tests des
// Repos. Der Wert liegt darin, dass eine spaetere Umformulierung auffaellt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

// Seit Issue #417 steht die Reihenfolge in Schritt 6 selbst statt im
// Nachtabschnitt — dort, wo die Session sie liest, bevor sie handelt. Der
// Ausschnitt zieht mit; die Zusicherungen darunter sind unveraendert.
const schritt6 = SKILL.slice(
  SKILL.indexOf("### 6. Body schärfen"),
  SKILL.indexOf("## Im Nachtbetrieb")
);

// Die nummerierte Liste allein — sie endet vor dem Fehlerpfad-Absatz.
const listeStart = schritt6.indexOf("Reihenfolge der Schreibbefehle");
const fehlerpfadStart = schritt6.indexOf("**Schlägt", listeStart);
const liste = listeStart === -1 || fehlerpfadStart === -1
  ? ""
  : schritt6.slice(listeStart, fehlerpfadStart);

test("die Reihenfolge steht ueberhaupt noch in Schritt 6", () => {
  assert.notEqual(listeStart, -1, "die Liste der Schreibbefehle fehlt");
  assert.notEqual(fehlerpfadStart, -1, "der Fehlerpfad hinter der Liste fehlt");
});

test("der Marker steht nicht mehr als eigener Schreibbefehl in der Liste", () => {
  assert.doesNotMatch(SKILL, /gegebenenfalls der Marker/,
    "der Marker ist eine Body-Zeile, kein Befehl — als eigener Schritt ist er nicht ausfuehrbar");
});

test("die Liste nennt sechs Schreibschritte", () => {
  const schritte = liste.match(/^\d+\. /gm) ?? [];
  assert.equal(schritte.length, 6,
    `erwartet sind sechs Schreibschritte, gefunden ${schritte.length}`);
});

test("Schritt 2 schreibt den geschaerften Body ohne Marker", () => {
  const schritt2 = liste.match(/^2\. .*(\n {2,}.*)*/m)?.[0] ?? "";
  assert.match(schritt2, /issue update/,
    "Schritt 2 ist die erste Body-Schreibung");
  assert.match(schritt2, /ohne Marker/i,
    "ohne diesen Zusatz stuende der Marker wieder vor der Synthese");
});

test("Schritt 5 ist ein zweites issue update, nicht 'der Marker'", () => {
  const schritt5 = liste.match(/^5\. .*(\n {2,}.*)*/m)?.[0] ?? "";
  assert.match(schritt5, /issue update/,
    "Schritt 5 muss als Body-Schreibung benannt sein — der Marker allein ist kein Befehl");
  assert.match(schritt5, /zweites/i,
    "dass es die zweite Body-Schreibung ist, muss dastehen");
  assert.match(schritt5, /Marker/,
    "was die zweite Schreibung ergaenzt, fehlt");
});

test("Schritt 6 ist label-sync", () => {
  assert.match(liste, /^6\. .*label-sync/m,
    "der Label-Abgleich schliesst die Reihenfolge ab");
});

test("der befundfreie Lauf ist geregelt", () => {
  const nachDerListe = schritt6.slice(listeStart, fehlerpfadStart + 2000);
  assert.match(nachDerListe, /befundfrei/i,
    "ohne diesen Satz schreibt eine Session bei null Funden einen inhaltsgleichen Vorschlag");
  assert.match(nachDerListe, /entfallen/i,
    "welche Schritte dabei entfallen, muss dastehen");
});

test("der Fehlerpfad benennt, was nach einem Fehlschlag der zweiten Body-Schreibung zurueckbleibt", () => {
  const fehlerpfad = schritt6.slice(fehlerpfadStart, fehlerpfadStart + 1200);
  // Die Hervorhebung des "zweite" ist Markup und darf den Treffer nicht kosten.
  assert.match(fehlerpfad, /zweite\w*\*{0,2}\s+Body-Schreibung/i,
    "der Fehlerpfad der zweiten Schreibung ist nicht benannt");
  assert.match(fehlerpfad, /Marker ohne Synthese kann nicht mehr entstehen/i,
    "die Garantie, die die neue Reihenfolge einloest, fehlt");
});

test("der Bestandssatz ueber die zwei angelegten Fehlerpfade bleibt stehen", () => {
  // Er steht im selben Absatz wie der alte Fehlerpfad und wuerde bei woertlicher
  // Ersetzung stillschweigend mitverschwinden.
  assert.match(schritt6, /Zwei Fehlerpfade sind im Bestand angelegt/,
    "der Hinweis auf #303 und die fehlende Label-Definition wurde mitentfernt");
});
