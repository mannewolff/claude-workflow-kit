// Haelt die Bedeutung der vier Ausdruecke aus kit/spec.mjs fest, die SonarCloud
// als super-linear meldet (S8786, Issue #496) — damit das Umschreiben sie nicht
// still verschiebt.
//
// Die Ausdruecke tragen das Lesen der Beschreibung: Was eine Aussage ist, was ihr
// Klammerzusatz bedeutet und welche Wirkungszeilen ein Paket fuehren darf. Eine
// stille Bedeutungsaenderung traefe `spec check` an einer Stelle, an der niemand
// zusieht — ein Paket liefe durch, dessen Wirkungszeile keiner mehr liest.
//
// Zwei Faelle sind besonders heikel und deshalb ausdruecklich festgehalten:
//   1. AUSSAGE_RE trifft auch eine Zeile, deren Aussage nur aus Leerraum besteht.
//      Der alte `(.+?)` nahm dort ein einzelnes Leerzeichen als Aussage. Eine
//      Umschrift nach `(\S…)` haette den Treffer GENOMMEN — die ID waere danach
//      unvergeben gewesen, und `GEAENDERT <ID>` haette sie nicht mehr gefunden.
//      Deshalb faengt der Ausdruck den ROHEN Rest der Zeile; getrimmt wird im
//      Aufrufer, wie bei PRUEFUNG_ZEILE in Issue #403.
//   2. CRLF: kit/spec.mjs entfernt nirgends `\r` und splittet nur an `\n`. Der
//      alte `\s*$` verschluckte ein `\r` am Zeilenende. Jede Ersatzklasse muss
//      `\r` weiter ausschliessen — `[^\S\n]` tut das, `[ \t]` nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { AUSSAGE_RE, ENTFALLEN_RE, NEU_RE, GEAENDERT_RE } from "../kit/spec.mjs";
import { mitFixture, spec } from "./helpers/spec-fixture.mjs";

// --- 1. AUSSAGE_RE ---

test("AUSSAGE_RE: Treffer, Nicht-Treffer und der rohe Capture", () => {
  const treffer = AUSSAGE_RE.exec("- board-7 — Ein Paket ohne Spec-Wirkung wird abgelehnt.");
  assert.equal(treffer[1], "board-7");
  assert.equal(treffer[2].trim(), "Ein Paket ohne Spec-Wirkung wird abgelehnt.");

  // Innen liegender Leerraum gehoert zur Aussage, aussen liegender nicht.
  assert.equal(AUSSAGE_RE.exec("-   board-7   —   zwei  Woerter   ")[2].trim(), "zwei  Woerter");
  // Der Trenner ist der Gedankenstrich, nicht der Bindestrich (A16).
  assert.equal(AUSSAGE_RE.exec("- board-7 - Aussage"), null);
  // Die ID muss der Form <bereich>-<N> genuegen, sonst zaehlte jede Aufzaehlung mit.
  assert.equal(AUSSAGE_RE.exec("- irgendwas — Prosa"), null);
  assert.equal(AUSSAGE_RE.exec("  - board-7 — eingerueckt"), null, "kein fuehrender Leerraum");
  assert.equal(AUSSAGE_RE.exec("- board-7 —"), null, "ohne Trennzeichen danach kein Treffer");
});

test("AUSSAGE_RE: eine Aussage aus reinem Leerraum bleibt ein Treffer", () => {
  // Der Fall aus Kopfpunkt 1. Er ist inhaltlich sinnlos und trotzdem bindend:
  // Die ID gilt danach als vergeben, und genau daran haengt, ob `spec check`
  // ein `GEAENDERT board-7` durchlaesst.
  assert.notEqual(AUSSAGE_RE.exec("- board-7 —   "), null, "die Zeile muss weiter treffen");
  assert.equal(AUSSAGE_RE.exec("- board-7 —   ")[1], "board-7");
});

test("AUSSAGE_RE: der Capture ist roh, das Trimmen macht der Aufrufer", () => {
  // `\r` steht im Capture — der alte `\s*$` hatte es geschluckt. Die Aussage
  // entsteht erst nach `.trim()`, und danach ist sie identisch mit frueher.
  const treffer = AUSSAGE_RE.exec("- board-7 — Aussage mit CRLF\r");
  assert.match(treffer[2], /\r$/, "der Capture traegt den rohen Rest der Zeile");
  assert.equal(treffer[2].trim(), "Aussage mit CRLF", String.raw`getrimmt bleibt kein \r uebrig`);
});

test(String.raw`die gelesene Aussage bleibt bei CRLF ohne \r`, () => {
  // Der Aufrufvertrag end-to-end: eine Beschreibung mit CRLF-Zeilenenden durch
  // `spec show` gelesen. Ohne das Trimmen im Aufrufer stuende hier ein `\r` in
  // der Ausgabe — der Test am Ausdruck allein wuerde das nicht bemerken.
  mitFixture("leer", (dir) => {
    writeFileSync(
      join(dir, "specs", "crlf.md"),
      "# crlf\r\n\r\n- crlf-1 — Eine Aussage mit CRLF-Zeilenenden.\r\n",
      "utf-8"
    );

    const res = spec(dir, "show", "crlf-1");
    assert.equal(res.status, 0, `show schlug fehl: ${res.stderr}`);
    assert.match(res.stdout, /Eine Aussage mit CRLF-Zeilenenden\./);
    assert.doesNotMatch(res.stdout, /\r/, String.raw`die Ausgabe darf kein \r tragen`);
  });
});

// --- 2. ENTFALLEN_RE ---

test("ENTFALLEN_RE: Treffer, Nicht-Treffer und der leere Kopf", () => {
  const treffer = ENTFALLEN_RE.exec("Die alte Aussage. (entfallen 2026-08-14, Paket #123)");
  assert.equal(treffer[1], "Die alte Aussage.");
  assert.equal(treffer[2], "2026-08-14");
  assert.equal(treffer[3], "123");

  // Ohne Text davor bleibt der Capture die leere Zeichenkette — nicht undefined.
  // `show` gibt ihn unveraendert aus; `undefined` stuende dort als Wort.
  assert.equal(ENTFALLEN_RE.exec("(entfallen 2026-08-14, Paket #123)")[1], "");
  assert.equal(ENTFALLEN_RE.exec("   (entfallen 2026-08-14, Paket #123)")[1], "");

  assert.equal(ENTFALLEN_RE.exec("Eine Aussage ohne Zusatz"), null);
  assert.equal(ENTFALLEN_RE.exec("x (entfallen 14.08.2026, Paket #123)"), null, "das Datum ist ISO");
  assert.equal(ENTFALLEN_RE.exec("x (entfallen 2026-08-14, Paket #123) danach"), null, "der Zusatz steht am Ende");
});

test(String.raw`ENTFALLEN_RE: der Kopf endet am letzten Nicht-Leerzeichen, auch mit \r`, () => {
  // `\r` kann hier nur VOR der Klammer stehen — der Zusatz endet auf ')'. Die
  // Ersatzklasse muss es wie der alte `\s*` ueberspringen, ohne es in den
  // Capture zu ziehen.
  assert.equal(ENTFALLEN_RE.exec("Alte Aussage \r (entfallen 2026-08-14, Paket #7)")[1], "Alte Aussage");
  assert.equal(ENTFALLEN_RE.exec("Alte Aussage   (entfallen 2026-08-14, Paket #7)")[1], "Alte Aussage");
});

// --- 3. NEU_RE ---

test("NEU_RE: Treffer, Nicht-Treffer und der Capture-Vertrag", () => {
  const treffer = NEU_RE.exec("NEU board board-7 — Ein Paket ohne Spec-Wirkung wird abgelehnt.");
  assert.equal(treffer[1], "board");
  assert.equal(treffer[2], "board-7");
  assert.equal(treffer[3], "Ein Paket ohne Spec-Wirkung wird abgelehnt.");

  // Der Capture reicht vom ersten bis zum letzten Nicht-Leerzeichen — innen
  // liegender Leerraum gehoert dazu, aussen liegender nicht.
  assert.equal(NEU_RE.exec("NEU  board  board-7  —  zwei  Woerter  ")[3], "zwei  Woerter");
  assert.equal(NEU_RE.exec("NEU board board-7 — x")[3], "x", "ein einzelnes Zeichen");

  assert.equal(NEU_RE.exec("NEU board board-7 - Aussage"), null, "Bindestrich statt Gedankenstrich");
  assert.equal(NEU_RE.exec("NEU board board-7 —   "), null, "ohne Aussage kein Treffer");
  assert.equal(NEU_RE.exec("NEU board-7 — Aussage"), null, "der Bereich fehlt");
});

test(String.raw`NEU_RE: der Capture bleibt bei CRLF ohne \r`, () => {
  assert.equal(NEU_RE.exec("NEU board board-7 — Aussage mit CRLF\r")[3], "Aussage mit CRLF");
  assert.equal(NEU_RE.exec("NEU board board-7 — Aussage  \r")[3], "Aussage");
});

// --- 4. GEAENDERT_RE ---

test("GEAENDERT_RE: Treffer, Nicht-Treffer und der Capture-Vertrag", () => {
  const treffer = GEAENDERT_RE.exec("GEAENDERT board-7 — Der neue Aussage-Text.");
  assert.equal(treffer[1], "board-7");
  assert.equal(treffer[2], "Der neue Aussage-Text.");

  assert.equal(GEAENDERT_RE.exec("GEAENDERT  board-7  —  zwei  Woerter  ")[2], "zwei  Woerter");
  assert.equal(GEAENDERT_RE.exec("GEAENDERT board-7 — x")[2], "x");

  assert.equal(GEAENDERT_RE.exec("GEAENDERT board-7 - Aussage"), null, "Bindestrich statt Gedankenstrich");
  assert.equal(GEAENDERT_RE.exec("GEAENDERT board-7 —   "), null, "ohne Aussage kein Treffer");
  assert.equal(GEAENDERT_RE.exec("GEAENDERT board — Aussage"), null, "die ID braucht ihre Nummer");
});

test(String.raw`GEAENDERT_RE: der Capture bleibt bei CRLF ohne \r`, () => {
  assert.equal(GEAENDERT_RE.exec("GEAENDERT board-7 — Aussage mit CRLF\r")[2], "Aussage mit CRLF");
  assert.equal(GEAENDERT_RE.exec("GEAENDERT board-7 — Aussage  \r")[2], "Aussage");
});
