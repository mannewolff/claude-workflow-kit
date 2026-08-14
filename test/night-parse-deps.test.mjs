// `parseDeps` erkennt die Abhaengigkeits-Ueberschrift zuverlaessig (Issue #308).
//
// Die alte Regex war weder zeilenverankert noch fence-bewusst und nahm die ERSTE
// Fundstelle. Ein Issue, das ueber das Issue-Format selbst handelt, nennt die
// Ueberschrift im Aufgabentext — der Parser las dann von dort bis zur naechsten
// `##`-Zeile, also einen Teil des Aufgabentextes statt des echten Abschnitts.
//
// Das Schadensbild geht in beide Richtungen und faellt am Board nie auf: Eine echte
// `#N` im richtigen Abschnitt wird unsichtbar (der Runner implementiert zu frueh),
// oder eine `#N` im faelschlich gelesenen Bereich erfindet eine Abhaengigkeit (das
// Issue bleibt dauerhaft liegen). Belegt an Issue #301 am 2026-08-11 — der erste
// Korrekturversuch loeste denselben Fehler erneut aus.
//
// Geprueft wird die reine, exportierte Funktion. Die integrative Abdeckung ueber
// echte Board-Issues bleibt in night-guards.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDeps } from "../kit/night.mjs";
import { FENCE_ZEILE, fenceLauf } from "../kit/board.mjs";

const ZEILEN = (...z) => z.join("\n");

// --- Der reale Fall aus Issue #301 ---

test("die Ueberschrift im Aufgabentext verdeckt den echten Abschnitt nicht", () => {
  const body = ZEILEN(
    "## Aufgabe",
    "",
    "Der Parser liest den Abschnitt ## Abhaengigkeiten und wertet ihn aus.",
    "Dabei zaehlt Issue #99 als Beispiel im Fliesstext.",
    "",
    "## Abhaengigkeiten",
    "",
    "Issue #7 muss vorher fertig sein.",
  );
  assert.deepEqual(parseDeps(body), [7]);
});

test("die Ueberschrift ausschliesslich im Fliesstext liefert nichts", () => {
  const body = ZEILEN(
    "## Aufgabe",
    "",
    "Wir aendern, wie ## Abhaengigkeiten gelesen wird.",
    "Betroffen ist auch Issue #99.",
    "",
    "## Akzeptanzkriterium",
    "",
    "Gruen.",
  );
  assert.deepEqual(parseDeps(body), []);
});

// --- Fences ---

// Isolierender Fall: Die Ueberschrift steht NUR im Fence. Eine Implementierung, die
// bloss "die letzte Ueberschrift" nimmt, bestuende diesen Test nicht.
test("eine Ueberschrift im Backtick-Fence zaehlt nicht", () => {
  const body = ZEILEN(
    "## Aufgabe",
    "",
    "Das Format sieht so aus:",
    "",
    "```markdown",
    "## Abhaengigkeiten",
    "Issue #41 muss vorher fertig sein.",
    "```",
    "",
    "## Abhaengigkeiten",
    "Issue #42 muss vorher fertig sein.",
  );
  assert.deepEqual(parseDeps(body), [42]);
});

test("dasselbe gilt fuer einen Tilde-Fence", () => {
  const body = ZEILEN(
    "## Aufgabe",
    "",
    "~~~markdown",
    "## Abhaengigkeiten",
    "Issue #41 muss vorher fertig sein.",
    "~~~",
    "",
    "## Abhaengigkeiten",
    "Issue #42 muss vorher fertig sein.",
  );
  assert.deepEqual(parseDeps(body), [42]);
});

// Beide Enden: Auch das ENDE des Abschnitts zaehlt nur ausserhalb eines Fence.
// Sonst haette ein Beispielblock im Abschnitt selbst ihn vorzeitig beendet.
test("eine ##-Zeile innerhalb eines Fence beendet den Abschnitt nicht", () => {
  const body = ZEILEN(
    "## Abhaengigkeiten",
    "",
    "Zur Erinnerung das Format:",
    "",
    "```markdown",
    "## Akzeptanzkriterium",
    "```",
    "",
    "Issue #42 muss vorher fertig sein.",
    "",
    "## Nachtrag",
    "Issue #99 steht ausserhalb.",
  );
  assert.deepEqual(parseDeps(body), [42]);
});

// --- Mehrere echte Ueberschriften ---

// Trennscharf: Eine Implementierung, die nur verankert und weiter den ERSTEN
// Treffer nimmt, bestuende jeden anderen Test hier.
test("bei zwei echten Ueberschriften gilt die letzte", () => {
  const body = ZEILEN(
    "## Abhaengigkeiten",
    "Issue #41 muss vorher fertig sein.",
    "",
    "## Aufgabe",
    "Irgendwas.",
    "",
    "## Abhaengigkeiten",
    "Issue #42 muss vorher fertig sein.",
  );
  assert.deepEqual(parseDeps(body), [42]);
});

test("fuehrender Leerraum vor der Ueberschrift ist erlaubt", () => {
  assert.deepEqual(parseDeps(ZEILEN("  ## Abhaengigkeiten", "Issue #7 muss vorher fertig sein.")), [7]);
});

// Eine `##`-Zeile mit Text dahinter ist keine Abschnitts-Ueberschrift, sondern eine
// andere. Ohne `$` waere `## Abhaengigkeiten der Migration` ein Treffer gewesen.
test("eine Ueberschrift mit Zusatztext ist nicht der Abschnitt", () => {
  const body = ZEILEN(
    "## Abhaengigkeiten der Migration",
    "Issue #41 gehoert dazu.",
    "",
    "## Abhaengigkeiten",
    "Keine.",
  );
  assert.deepEqual(parseDeps(body), []);
});

// --- Vier Zusagen des Bestands ---

test("Bestand: beide Schreibweisen der Ueberschrift werden erkannt", () => {
  assert.deepEqual(parseDeps("## Abhängigkeiten\nIssue #7 muss vorher fertig sein."), [7]);
  assert.deepEqual(parseDeps("## Abhaengigkeiten\nIssue #7 muss vorher fertig sein."), [7]);
});

test("Bestand: Gross- und Kleinschreibung der Ueberschrift bleibt unerheblich", () => {
  assert.deepEqual(parseDeps("## ABHAENGIGKEITEN\nIssue #7 muss vorher fertig sein."), [7]);
  assert.deepEqual(parseDeps("## abhängigkeiten\nIssue #7 muss vorher fertig sein."), [7]);
});

test("Bestand: mehrfach genannte Referenzen werden dedupliziert, erstes Auftreten zaehlt", () => {
  const body = ZEILEN("## Abhaengigkeiten", "Issue #9, Issue #7 und nochmal Issue #9.");
  assert.deepEqual(parseDeps(body), [9, 7]);
});

test("Bestand: owner/repo#N und Referenzen in Backticks zaehlen nicht", () => {
  const body = ZEILEN(
    "## Abhaengigkeiten",
    "Fremdes Repo: mannewolff/kanban-kit#457.",
    "In Backticks: `#123`.",
    "Echt: Issue #7.",
  );
  assert.deepEqual(parseDeps(body), [7]);
});

test("Bestand: leerer oder fehlender Body liefert nichts", () => {
  assert.deepEqual(parseDeps(""), []);
  assert.deepEqual(parseDeps(null), []);
  assert.deepEqual(parseDeps(undefined), []);
});

test("Bestand: 'Keine.' liefert eine leere Liste", () => {
  assert.deepEqual(parseDeps("## Abhaengigkeiten\n\nKeine.\n"), []);
});

test("Windows-Zeilenenden aendern nichts", () => {
  assert.deepEqual(parseDeps("## Abhaengigkeiten\r\nIssue #7 muss vorher fertig sein.\r\n"), [7]);
});

// --- Die geteilte Fence-Regel ---

// Der Kommentar an fenceLauf verbietet die Kopie der Sache nach: Drei Stellen
// brauchen dieselbe Auslegung. night.mjs importiert sie deshalb aus board.mjs,
// statt eine dritte zu schreiben.
test("FENCE_ZEILE und fenceLauf sind aus board.mjs benutzbar", () => {
  assert.ok(FENCE_ZEILE instanceof RegExp);
  assert.match("```markdown", FENCE_ZEILE);
  assert.match("~~~", FENCE_ZEILE);
  assert.doesNotMatch("`` zu kurz", FENCE_ZEILE);

  const imFence = fenceLauf();
  assert.equal(imFence("Text"), false);
  assert.equal(imFence("```"), true, "die oeffnende Zeile gehoert zum Fence");
  assert.equal(imFence("## Drin"), true);
  assert.equal(imFence("```"), true, "die schliessende Zeile gehoert zum Fence");
  assert.equal(imFence("## Draussen"), false);
});
