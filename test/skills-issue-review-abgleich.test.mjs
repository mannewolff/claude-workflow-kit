// Tests fuer den Synthese-Abgleich im issue-review-Skill (Issue #593).
//
// Das Kommando aus Issue #592 wirkt erst, wenn der Skill es aufruft und die
// Synthese die Belege ueberhaupt traegt. Beides ist Text im Skill, also wird
// hier Text geprueft — wie in den uebrigen Skill-Tests des Repos. Der Wert
// liegt darin, dass eine spaetere Umformulierung auffaellt.
//
// Der Zeitpunkt ist die Sache, nicht der Aufruf: Interaktiv laeuft der Abgleich
// auf den Entwuerfen, VOR der Zustimmung — danach ist der Body geschrieben, und
// eine Pruefung hinter der Schreibung kommt zu spaet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

// Schritt 5b allein — dort entsteht die Zeile, die der Abgleich spaeter liest.
const schritt5b = SKILL.slice(
  SKILL.indexOf("### 5b. Synthese protokollieren"),
  SKILL.indexOf("### 6. Body schärfen")
);

// Schritt 6 allein — von seiner Ueberschrift bis zum Nachtbetriebs-Abschnitt.
const schritt6 = SKILL.slice(
  SKILL.indexOf("### 6. Body schärfen"),
  SKILL.indexOf("## Im Nachtbetrieb")
);

// Der Abgleich-Absatz allein: ab seiner Ueberschrift bis zu der Stelle, an der
// die unbeaufsichtigte Fallunterscheidung wieder uebernimmt.
const abgleich = schritt6.slice(
  schritt6.indexOf("**Der Abgleich vor der ersten Schreibung"),
  schritt6.indexOf("**Unbeaufsichtigt gilt im Einzelnen:**")
);

test("[skills-11] Schritt 5b nennt beide Belegformen woertlich", () => {
  assert.notEqual(schritt5b, "", "der Schritt-5b-Abschnitt wurde nicht gefunden");
  // Ohne Beleg nennt die Zeile den Fund, nicht die Textaenderung — der Abgleich
  // haette keinen Suchbegriff und meldete zwangslaeufig `beleg-fehlt`.
  assert.ok(schritt5b.includes('→ <Abschnitt>: "'),
    "die einfache Belegform fehlt — ohne sie hat der Abgleich keinen Suchbegriff");
  // Jede Reviewer-Rolle fragt "Was kann RAUS?". Ohne eigene Form fuer die
  // Streichung riefe jede uebernommene Kuerzung einen Menschen.
  assert.ok(schritt5b.includes('→ <Abschnitt>: gestrichen "'),
    "die Belegform fuer eine uebernommene Streichung fehlt");
});

test("[skills-11] Schritt 5b sagt, woher das Zitat stammt", () => {
  assert.match(schritt5b, /wörtlich aus dem Body-Vorschlag/i,
    "dass das Zitat kopiert und nicht formuliert wird, muss dastehen");
  assert.match(schritt5b, /alten Body/i,
    "bei `gestrichen` stammt das Zitat aus dem alten Body — sonst gibt es nichts zu zitieren");
});

test("[skills-11] der Abgleich steht vor der ersten Schreibung und vor der Zustimmungsfrage", () => {
  const kommando = schritt6.indexOf("synthese-check");
  const reihenfolge = schritt6.indexOf("Reihenfolge der Schreibbefehle");
  const frage = schritt6.indexOf("Übernehmen? (ja / nein");

  assert.notEqual(kommando, -1, "Schritt 6 ruft `synthese-check` nicht auf");
  assert.notEqual(reihenfolge, -1, "die Liste der Schreibbefehle fehlt");
  assert.notEqual(frage, -1, "die Zustimmungsfrage fehlt");

  assert.ok(kommando < reihenfolge,
    "der Abgleich muss vor der Liste der Schreibbefehle stehen — danach steht der erste Kommentar schon am Board");
  assert.ok(kommando < frage,
    "der Abgleich muss vor der Zustimmungsfrage stehen — danach ist der Body geschrieben");
});

test("[skills-11] der Abgleich-Absatz nennt die unbeaufsichtigte Betriebsart zuerst", () => {
  assert.notEqual(abgleich, "", "der Abgleich-Absatz wurde nicht gefunden");

  const unbeaufsichtigt = abgleich.indexOf("Unbeaufsichtigt");
  const interaktiv = abgleich.indexOf("Interaktiv");
  assert.notEqual(unbeaufsichtigt, -1, "die unbeaufsichtigte Betriebsart fehlt im Abgleich-Absatz");
  assert.notEqual(interaktiv, -1, "die interaktive Betriebsart fehlt im Abgleich-Absatz");
  assert.ok(unbeaufsichtigt < interaktiv,
    "dieselbe Ordnung wie an den uebrigen Stellen des Skills — wer von oben liest, handelt nach dem ersten Fall");
});

test("[skills-11] der Abgleich laeuft ueber die beiden Datei-Schalter", () => {
  assert.match(abgleich, /--synthese-file/,
    "ohne den Schalter faende der Aufruf interaktiv nichts am Board — dort steht zu diesem Zeitpunkt noch nichts");
  assert.match(abgleich, /--vorschlag-file/);
  assert.match(abgleich, /<tmpdir>\/<id>-synthese\.md/,
    "wo die Synthese vor dem Abgleich liegt, muss dastehen");
  assert.match(abgleich, /<tmpdir>\/<id>-vorschlag\.md/,
    "wo der Body-Vorschlag vor dem Abgleich liegt, muss dastehen");
});

test("[skills-11] `ok: false` wirkt wie ein gate-Fund", () => {
  assert.match(abgleich, /`ok: false`/,
    "der Befund-Fall des Kommandos ist nicht benannt");
  assert.match(abgleich, /kit:klaeren/,
    "ein nicht belegter Fund zeichnet das Ticket");
  assert.match(abgleich, /Marker bleibt aus|kein Marker/i,
    "dass der Marker bei einem Befund ausbleibt, fehlt");
});

test("[skills-11] der Ausfall des Abgleichs selbst ist geregelt", () => {
  assert.match(abgleich, /Abgleich ausgefallen:/,
    "die Zeile, die den Grund ans Dokument bringt, fehlt");
  assert.match(abgleich, /Kein zweiter Versuch/i,
    "dass nicht automatisch wiederholt wird, muss dastehen");
});

// Seit Issue #598 traegt derselbe Kommentar auch die Befunde der Synthese-
// Pruefung, und die laeuft gerade bei `ok: true`. Die Zusicherung "nur bei
// `ok: false`" ist deshalb umgebaut und nicht ergaenzt: Angehaengt haette sie
// einen roten Bestandstest neben dem neuen stehen lassen.
test("[skills-11] der Abgleich-Kommentar traegt die Kopfzeile woertlich", () => {
  assert.ok(SKILL.includes("## Synthese-Abgleich, Runde"),
    "die Kopfzeile ist der Anker, an dem der Kommentar erkannt wird");
  assert.match(abgleich, /Runde des geprüften Synthese-Kommentars/i,
    "ohne diesen Satz zaehlt eine Session den Abgleich eigenstaendig");
});

test("[skills-11] die Beleg-Befunde stehen nur bei `ok: false` im Kommentar", () => {
  assert.match(abgleich, /`ok: false`/,
    "der Befund-Fall des Kommandos ist nicht benannt");
  assert.match(abgleich, /ohneBeleg/,
    "welche Eintraege den Kommentar fuellen, muss dastehen — ein gruener Abgleich liefert keine");
});

test("[skills-11] der Abgleich-Kommentar entsteht interaktiv unabhaengig von der Antwort", () => {
  assert.match(abgleich, /unabhängig von der Antwort/i,
    "Kriterium 5 verlangt den Befund am Dokument gerade dann, wenn der Mensch nicht uebernimmt");
  assert.match(abgleich, /auch bei Ablehnung/i,
    "der Fall der Ablehnung muss ausdruecklich dastehen");
});

test("[skills-11] interaktiv wird kit:klaeren ohne Rueckfrage gesetzt", () => {
  assert.match(abgleich, /ohne Rückfrage/i,
    "ein Label ist weder Body noch Marker — dafuer wird nicht gefragt");
  assert.match(abgleich, /Neu-Abgleich wird nicht angeboten/i,
    "ohne diesen Satz verhandelt eine Session den Befund nach");
});

test("[skills-11] die Stop-Punkte nennen den ausgefallenen Abgleich", () => {
  const stopPunkte = SKILL.slice(SKILL.indexOf("## Stop-Punkte"));
  assert.match(stopPunkte, /Abgleich/,
    "der Stop-Punkt zum Abgleich fehlt");
  assert.match(stopPunkte, /nie befundfrei/i,
    "ein ausgefallener Abgleich ist nie befundfrei — genau das haelt den Marker zurueck");
});
