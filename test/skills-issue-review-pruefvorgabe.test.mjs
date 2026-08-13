// Die Pruefvorgabe im Skill /issue-review (Issue #305, Plan #300, fachliche Quelle #285).
//
// Der Skill muss die Vorgabe am Ticket an drei Stellen kennen: bei der Auswahl
// (ein gueltiger Verzicht schliesst aus), bei der Rundenzahl (sie kommt aus dem
// Feld `runden` der roles-Antwort, nicht aus der Config) und beim Schreiben des
// Bodys.
//
// Die dritte ist die gefaehrlichste: Schritt 6 schreibt bei Stufe `issue` den
// geschaerften Body — nachts mit gesetztem KIT_AGENT_MODEL. Vergisst die
// schaerfende Session die `Pruefung:`-Zeile, schlaegt die Leitplanke aus Issue
// #303 zu und der fertige Review verliert seinen Marker. Dieselbe Fehlerklasse ist
// fuer `Autor-Modell:` in skills/fachplan/SKILL.md bereits dokumentiert.
//
// Geprueft wird Skill-TEXT, nicht Verhalten: Was dort nicht steht, tut die Session
// nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(repoRoot, "skills", "issue-review", "SKILL.md");
const KOPIE = join(repoRoot, ".claude", "skills", "issue-review", "SKILL.md");

const text = () => readFileSync(SKILL, "utf-8");

/** Ein nummerierter Schritt bis zur naechsten Ueberschrift gleicher oder hoeherer Ebene. */
function abschnitt(ueberschrift) {
  const muster = new RegExp(`\\n#{2,3} *${ueberschrift.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  const teile = text().split(muster);
  assert.equal(teile.length, 2, `Abschnitt "${ueberschrift}" nicht genau einmal gefunden`);
  return teile[1].split(/\n#{2,4} /)[0];
}

test("das roles-Kommando wird mit --issue aufgerufen", () => {
  const bashBloecke = [...text().matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const rollen = bashBloecke.filter((b) => /issue-review roles/.test(b));
  assert.ok(rollen.length >= 1, "kein roles-Kommando im Skill");
  assert.ok(
    rollen.every((b) => /--issue/.test(b)),
    "ein roles-Aufruf ohne --issue steht noch im Skill — dann bliebe die Vorgabe am Ticket unsichtbar"
  );
});

test("die Rundenzahl kommt aus dem Feld runden, nicht aus der Config", () => {
  const a = abschnitt("4. Runden");
  assert.match(a, /`runden`/, "das Feld `runden` wird nicht als Quelle genannt");
  assert.match(a, /nicht aus der Config|nicht (mehr )?aus `?issueReview/i,
    "die Abgrenzung zur Config fehlt — sie ist der Kern des Issues");

  // Die alte Fassung begann mit "`issueReview.rounds` aus der Config, **Default 1**".
  // Bleibt die Config als QUELLE stehen, gibt es zwei Wahrheiten ueber die Rundenzahl.
  const configZeilen = a.split("\n").filter((z) => /issueReview\.rounds/.test(z));
  for (const z of configZeilen) {
    assert.match(z, /nicht|Regelfall|verrechnet/i,
      `der Abschnitt nennt die Config noch als Quelle der Rundenzahl: ${z.trim()}`);
  }
});

test("Schritt 1 nennt den gueltigen Verzicht als eigenen Ausschlussgrund", () => {
  const a = abschnitt("1. Issues bestimmen");
  assert.match(a, /Verzicht/, "der Verzicht fehlt als Ausschlussgrund");
  assert.match(a, /\[Idee\]/, "der bestehende [Idee]-Ausschluss ist verschwunden");
  assert.match(a, /verfallen/i,
    "ohne den Verfall waere unklar, welcher Verzicht ausschliesst und welcher nicht");
  assert.match(a, /Zusammenfassung/i,
    "der Verzicht muss in der Zusammenfassung genannt werden, sonst gilt das Dokument als geprueft");
});

test("mit expliziter Nummer wird der Verzicht gemeldet und kein Reviewer gestartet", () => {
  const a = abschnitt("1. Issues bestimmen");
  const absatz = a.split(/\n\n/).find((p) => /Verzicht/.test(p) && /Nummer/i.test(p));
  assert.ok(absatz, "kein Absatz verbindet den Verzicht mit dem Aufruf per Nummer");
  assert.match(absatz, /kein(en)? Reviewer|ohne Reviewer/i,
    "der Absatz muss sagen, dass kein Reviewer startet");
});

test("Schritt 4 beschreibt das Verhalten bei verzicht: true", () => {
  const a = abschnitt("4. Runden");
  assert.match(a, /`verzicht`|verzicht: true/i, "das Feld `verzicht` wird nicht ausgewertet");
  const stelle = a.split(/\n\n/).filter((p) => /verzicht/i.test(p));
  assert.ok(
    stelle.some((p) => /kein(en)? Reviewer|kein Review\b/i.test(p)),
    "bei Verzicht muss ausdruecklich kein Reviewer starten"
  );
  assert.ok(
    stelle.some((p) => /Kommentar/i.test(p)),
    "der Board-Kommentar muss den Verzicht benennen — sonst fehlt jede Spur am Board"
  );
});

test("Schritt 4 benennt den Fall vorgabeQuelle: verfallen", () => {
  const a = abschnitt("4. Runden");
  assert.match(a, /vorgabeQuelle/, "das Feld `vorgabeQuelle` fehlt");
  assert.match(a, /verfallen/i, "der Wert \"verfallen\" fehlt");
  const stelle = a.split(/\n\n/).filter((p) => /verfallen/i.test(p));
  assert.ok(
    stelle.some((p) => /normal|Regel-?rundenzahl|Regelfall/i.test(p)),
    "bei verfallener Vorgabe muss der Review normal mit der Regel-Rundenzahl laufen"
  );
  assert.ok(
    stelle.some((p) => /Kommentar/i.test(p)),
    "der Verfall gehoert in den Kommentar — \"nie entschieden\" ist etwas anderes als \"ueberholt\""
  );
});

// Der gefaehrlichste Teil des Issues: `issue update` schreibt den Body durch, wie er
// kommt. Faellt `Pruefung:` dabei weg und waere das eine Verringerung, weist die
// Leitplanke aus Issue #303 den Schreibzugriff nachts ab — der fertige Review
// verliert seinen Marker.
test("Schritt 6 verlangt die Erhaltung von Pruefung: und Pruefung-Stand:", () => {
  const a = abschnitt("6. Body schärfen");
  const absatz = a.split(/\n\n/).find((p) => /Pruefung:/.test(p) && /Pruefung-Stand:/.test(p));
  assert.ok(absatz, "kein Absatz nennt beide Zeilen zusammen");
  assert.match(absatz, /erhalten|uebernimm|übernimm|verliert/i,
    "der Absatz muss die Erhaltungspflicht aussprechen, nicht nur die Zeilen erwaehnen");
  assert.match(a, /#303|alten Stand/i,
    "der Grund (Leitplanke aus Issue #303 bzw. Uebernahme aus dem alten Stand) fehlt");
});

test("die Dogfooding-Kopie unter .claude ist identisch", () => {
  assert.equal(readFileSync(KOPIE, "utf-8"), text(), "sync-blobs wurde nicht ausgefuehrt");
});
