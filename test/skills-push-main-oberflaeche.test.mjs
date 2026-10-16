// `/push-main` fragt vor jedem Veröffentlichen nach den Oberflächenänderungen des Stands
// (Issue #1674, Plan #1671 E4–E8, fachliche Quelle #1609).
//
// Die Frage steht in Schritt 2, vor dem Worktree: Ein Nein kostet dort nichts. Sie nennt die
// Oberflächenänderungen mit ihren Paketen, nur `ja` geht weiter, und das Ja gilt nur für
// diesen Push. Der Modus `prepare` fragt nicht, die Übernahme am Morgen fragt kein zweites
// Mal. Dazu nennt der Bericht das Ergebnis des Mutationstests.
//
// Geprüft wird Text, nicht Verhalten — wie in test/skills-push-main.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Datei als Text mit LF, damit ein Checkout mit CRLF den Vergleich nicht verfälscht. */
function lies(...teile) {
  return readFileSync(join(repoRoot, ...teile), "utf-8").replaceAll("\r\n", "\n");
}

const PUSH = lies("skills", "push-main", "SKILL.md");

/** Der Abschnitt ab einer Überschrift bis zur nächsten derselben oder höheren Ebene. */
function abschnitt(text, ueberschrift) {
  const start = text.indexOf(ueberschrift);
  if (start < 0) return null;
  const ebene = ueberschrift.match(/^#+/)[0].length;
  const rest = text.slice(start + ueberschrift.length);
  const ende = rest.search(new RegExp(`\\n#{1,${ebene}} `));
  return ende < 0 ? text.slice(start) : text.slice(start, start + ueberschrift.length + ende);
}

/** Text ohne Zeilenumbrüche und Mehrfach-Leerzeichen, damit Sätze über Zeilen hinweg passen. */
const flach = (text) => text.replaceAll(/\s+/g, " ");

const SCHRITT2 = abschnitt(PUSH, "### 2. Stand prüfen");
const SCHRITT3 = abschnitt(PUSH, "### 3. Worktree anlegen und mit `origin` zusammenführen");
const SCHRITT5 = abschnitt(PUSH, "### 5. Der eine Prüflauf (Gate — vor Commit und Push)");
const SCHRITT9 = abschnitt(PUSH, "### 9. Bestätigung");
const MODUS = abschnitt(PUSH, "## Modus `prepare` (unbeaufsichtigt)");

const FRAGE = "Diese Oberflächenänderungen gehen mit diesem Push hinaus: … Hast du sie von Hand geprüft? (ja/nein)";

test("[1609] Veröffentlichen nach einer Oberflächenänderung — push-main fragt in Schritt 2 vor dem Worktree und pusht nur nach ja", () => {
  assert.ok(SCHRITT2, "Abschnitt „### 2. Stand prüfen“ fehlt");
  const s = flach(SCHRITT2);

  // Die Frage mit Paketen, in Schritt 2 und damit vor Schritt 3.
  const log = SCHRITT2.indexOf("git log --name-only origin/<mainBranch>..HEAD");
  const frage = SCHRITT2.indexOf(FRAGE);
  assert.ok(log >= 0, "Schritt 2 liest die Dateien des Stands nicht mit git log --name-only");
  assert.ok(frage >= 0, "Schritt 2 stellt die Frage nicht im Wortlaut");
  assert.ok(log < frage, "die Frage steht vor dem Lesen der Dateien");
  assert.ok(PUSH.indexOf(FRAGE) < PUSH.indexOf("### 3. Worktree"), "die Frage steht nicht vor Schritt 3");
  assert.match(s, /\(Issue #N\)/, "Schritt 2 gruppiert nicht nach dem Paket im Betreff");
  assert.match(s, /node \.claude\/kit\/board\.mjs issue get <N>/, "Schritt 2 holt den Titel je Paket nicht");

  // Das Merkmal der Oberflächendateien, wörtlich.
  assert.match(s, /Dateien der Oberfläche sind Templates, Views, Stylesheets und Client-Code/,
    "das Merkmal der Oberflächendateien fehlt");

  // Nur ja geht weiter, das Ja wird nicht gespeichert, ohne Oberflächenänderung keine Frage.
  assert.match(s, /Nur `ja` geht weiter/, "ja ist nicht die einzige Fortsetzung");
  assert.match(s, /ohne Worktree, Bump und Push/, "ein Nein endet nicht ohne Worktree, Bump und Push");
  assert.match(s, /Das Ja wird nirgends gespeichert/, "das Ja wird nicht als ungespeichert benannt");
  assert.match(s, /Ohne Oberflächenänderung gibt es keine Frage/, "der Fall ohne Oberflächenänderung fehlt");
  assert.match(s, /`### Manuelle Pruefung`[^.]*zählt nicht als Oberflächenänderung/,
    "der Block Manuelle Pruefung wird nicht ausgenommen");

  // Keine UI-Frage in prepare, keine zweite bei der Übernahme.
  const m = flach(MODUS);
  assert.doesNotMatch(m, /UI-Prüfung[^.]*--open/, "prepare übergibt noch eine UI-Prüfung als --open");
  assert.match(m, /fragt nicht/, "prepare sagt nicht, dass er nicht fragt");
  const s3 = flach(SCHRITT3);
  assert.doesNotMatch(s3, /UI-Prüfung[^.]*Frage an den Menschen/, "die Übernahme stellt noch eine eigene UI-Frage");
  assert.match(s3, /Frage aus Schritt 2 gilt auch hier/, "die Übernahme verweist nicht auf die Frage aus Schritt 2");
});

test("die Übernahme nennt das Feld mutation aus check-preparation im Bericht", () => {
  assert.match(flach(SCHRITT3), /Feld `mutation`[^.]*check-preparation|check-preparation[^.]*Feld `mutation`/,
    "die Übernahme nennt das Feld mutation nicht");
});

test("Schritt 5 nennt die längere Dauer durch den Mutationstest", () => {
  assert.match(flach(SCHRITT5), /Mutationstest/, "Schritt 5 nennt den Mutationstest nicht");
});

test("Schritt 9 nennt das Ergebnis des Mutationstests, auf dem Build-Dienst-Weg mit fester Zeile", () => {
  const s = flach(SCHRITT9);
  assert.match(s, /Mutationstest/, "Schritt 9 nennt den Mutationstest nicht");
  assert.ok(PUSH.includes("`Mutationstest: im Build-Dienst gelaufen, Ergebnis im Build-Log`"),
    "die Zeile für den Build-Dienst-Weg fehlt");
});

test("der Skill nennt /local-check nicht mehr", () => {
  assert.doesNotMatch(PUSH, /local-check/, "der Skill nennt /local-check noch");
});
