// Register der zurueckgelesenen Marker und gemeinsamer Texthelfer in kit/board/namen.mjs
// (Issue #1440, Plan #1420 E4, E13, E15): je Marker ein deutscher und ein englischer Name,
// erkannt werden beide; Meldungstexte kommen aus einer Tabelle { de, en } in der Projektsprache.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MARKER,
  erkenneMarker,
  markerName,
  text,
  pruefeParitaet,
  spracheFestlegen,
  prozessSprache,
} from "../kit/board/namen.mjs";

// Die Paare, hier bewusst noch einmal ausgeschrieben: Der Test haelt das Register fest.
const MARKER_PAARE = [
  ["## Laufstand", "## Run status"],
  ["Lauf-ID:", "Run-ID:"],
  ["Stand:", "Updated:"],
  ["Position:", "Position:"],
  ["Protokoll:", "Log:"],
  ["Ziel:", "Goal:"],
  ["Prüfer:", "Reviewers:"],
  ["Grenze:", "Limit:"],
  ["## Geschuetzte Datei", "## Protected file"],
  ["Bericht-Lauf:", "Report-Run:"],
  ["Kit-Stand:", "Kit-Revision:"],
  ["Autor-Modell:", "Author-Model:"],
  ["Plan-Modell:", "Plan-Model:"],
  ["## Kontext", "## Context"],
  ["Plan:", "Plan:"],
  ["Fachliche Quelle:", "Requirement:"],
  ["Plan-Entscheidungen:", "Plan-Decisions:"],
  ["Entscheidung:", "Decision:"],
  ["Aufgabenstufe:", "Task-Tier:"],
  ["Empfohlenes Modell:", "Recommended model:"],
  ["Sitzungsumfang:", "Session scope:"],
  ["Vorlage:", "Template:"],
  ["Plan-Review:", "Plan-Review:"],
  ["Fachplan-Review:", "Requirement-Review:"],
  ["Wartet auf Ereignis:", "Waiting for event:"],
  ["Issue-Review:", "Issue-Review:"],
  // Fundblock-Zeilen (Issue #1558, Plan #1548 E19).
  ["Gegenprobe:", "Counter-check:"],
  ["Art:", "Kind:"],
  ["— geprueft, bestaetigt", "— checked, confirmed"],
  ["## Plan-Review, Runde", "## Plan-Review, Round"],
  ["## Fachplan-Review, Runde", "## Requirement-Review, Round"],
  ["## Issue-Review, Runde", "## Issue-Review, Round"],
  ["## Einarbeitung, Runde", "## Incorporation, Round"],
  ["## Nachtlauf: wartende Sitzung", "## Night run: waiting session"],
  ["## Nachtlauf: Zeitgrenze erreicht", "## Night run: time limit reached"],
  ["## Nachtlauf: an einer Pruefung festgefahren", "## Night run: stuck on a check"],
  ["Nachtlauf: Nachweis", "Night run: evidence"],
  ["## Kette nicht gestartet: Pruefung fehlt", "## Chain not started: check missing"],
  ["## Kette nicht gestartet: unpassende Einstellung", "## Chain not started: unsuitable setting"],
  ["Kein Eingang für /issues", "No input for /issues"],
  ["## Nachtbericht, Kette", "## Night report, chain"],
  ["Daraus soll per /requirement eine fachliche Anforderung entstehen.", "A requirement is to be created from this via /requirement."],
  ["Ueberholt durch Plan #", "Superseded by plan #"],
  // Feste Zeilen der Skills (Issue #1568).
  ["Uebernahme: uebernommen", "Adoption: adopted"],
  ["Uebernahme: abgelehnt", "Adoption: rejected"],
  ["Angaben: unvollstaendig", "Details: incomplete"],
  ["## Abschlussbericht Issue #", "## Completion report issue #"],
  ["### Tests geschrieben (rot) — Issue #", "### Tests written (red) — issue #"],
  ["## Code-Review (Schritt 6)", "## Code review (step 6)"],
  ["### Reviewer", "### Reviewer"],
  ["Suchbegriffe:", "Search terms:"],
  ["Dateien:", "Files:"],
  ["Bahn:", "Lane:"],
  ["Ergebnis:", "Result:"],
];

test("das Register traegt genau die Marker mit beiden Namen", () => {
  const marker = Object.values(MARKER).map((e) => [e.de, e.en]);
  assert.deepEqual(marker.slice().sort(), MARKER_PAARE.slice().sort());
});

test("markerName liefert je Sache den Namen der Sprache", () => {
  for (const [de, en] of MARKER_PAARE) {
    const sache = erkenneMarker(de);
    assert.ok(sache, `keine Sache fuer ${de}`);
    assert.equal(markerName(sache, "de"), de);
    assert.equal(markerName(sache, "en"), en);
  }
});

test("markerName: unbekannte Sprache faellt auf de, unbekannte Sache wirft", () => {
  assert.equal(markerName(erkenneMarker("## Laufstand"), "fr"), "## Laufstand");
  assert.throws(() => markerName("gibtsnicht", "en"), /gibtsnicht/);
});

test("erkenneMarker: beide Namen derselben Sache ergeben dieselbe Sache", () => {
  for (const [de, en] of MARKER_PAARE) {
    const sache = erkenneMarker(de);
    assert.ok(sache, de);
    assert.equal(erkenneMarker(en), sache, `${en} ist nicht dieselbe Sache wie ${de}`);
  }
});

test("erkenneMarker: verschiedene Sachen bleiben verschieden", () => {
  const sachen = MARKER_PAARE.map(([de]) => erkenneMarker(de));
  assert.equal(new Set(sachen).size, sachen.length);
});

test("erkenneMarker: Zeile mit Wert, fuehrender Leerraum und Schreibweise", () => {
  assert.equal(erkenneMarker("Autor-Modell: claude-opus-5-5"), erkenneMarker("Author-Model: x"));
  assert.equal(erkenneMarker("  Plan: Issue #1420"), "plan");
  assert.equal(erkenneMarker("Fachliche Quelle: Issue #1416"), erkenneMarker("Requirement: Issue #1416"));
  assert.equal(erkenneMarker("## Einarbeitung, Runde 2"), erkenneMarker("## Incorporation, Round 3"));
  assert.equal(erkenneMarker("## Plan-Review, Runde 1"), erkenneMarker("## Plan-Review, Round 1"));
  assert.equal(erkenneMarker("issue-review: fable"), erkenneMarker("Issue-Review: fable"));
  assert.equal(erkenneMarker("## Kontext"), erkenneMarker("## context"));
  assert.equal(erkenneMarker("Nachtlauf: Nachweis fehlt"), erkenneMarker("Night run: evidence missing"));
});

test("erkenneMarker: der laengste Name gewinnt", () => {
  assert.notEqual(erkenneMarker("Plan-Review: fable"), erkenneMarker("Plan: Issue #1"));
  assert.notEqual(erkenneMarker("Plan-Entscheidungen: E1"), erkenneMarker("Plan: Issue #1"));
  assert.notEqual(erkenneMarker("## Nachtlauf: Zeitgrenze erreicht"), erkenneMarker("Nachtlauf: Nachweis x"));
});

test("erkenneMarker: fremde Zeilen und Unsinn ergeben null", () => {
  for (const zeile of [
    "## Kontextwechsel", "## Laufstandort", "Planung: x", "Planziel: x", "Stand der Dinge",
    "x Plan: Issue #1", "## Aufgabe", "Bericht-Laufzeit: 3", "", undefined, null, 7,
  ]) {
    assert.equal(erkenneMarker(zeile), null, String(zeile));
  }
});

// --- Texthelfer -------------------------------------------------------------------

const TEXTE = {
  de: { gruss: "Hallo {name}, {anzahl} Karten", leer: "Nichts zu tun." },
  en: { gruss: "Hello {name}, {anzahl} cards", leer: "Nothing to do." },
};

afterEach(() => spracheFestlegen(null));

test("text setzt Platzhalter ein, in der festgelegten Sprache", () => {
  spracheFestlegen("de");
  assert.equal(text(TEXTE, "gruss", { name: "Manne", anzahl: 3 }), "Hallo Manne, 3 Karten");
  assert.equal(text(TEXTE, "leer"), "Nichts zu tun.");
  spracheFestlegen("en");
  assert.equal(text(TEXTE, "gruss", { name: "Manne", anzahl: 0 }), "Hello Manne, 0 cards");
});

test("text: derselbe Platzhalter mehrfach und Werte mit Sonderzeichen", () => {
  spracheFestlegen("de");
  const t = { de: { x: "{a}-{a} $& {b}" }, en: { x: "{a}-{a} $& {b}" } };
  assert.equal(text(t, "x", { a: "$1", b: "{a}" }), "$1-$1 $& {a}");
});

test("text: fehlender englischer Text faellt nie still auf Deutsch zurueck", () => {
  spracheFestlegen("en");
  const t = { de: { nur: "nur deutsch" }, en: {} };
  assert.throws(() => text(t, "nur"), /nur.*en|en.*nur/);
  assert.throws(() => text({ de: { nur: "x" } }, "nur"), /en/);
});

test("text: unbekannter Schluessel und fehlender Wert werfen", () => {
  spracheFestlegen("de");
  assert.throws(() => text(TEXTE, "gibtsnicht"), /gibtsnicht/);
  assert.throws(() => text(TEXTE, "gruss", { name: "x" }), /anzahl/);
});

test("text waehlt die Sprache einmal aus der Config des Projekts", (t) => {
  const wurzel = mkdtempSync(join(tmpdir(), "namen-sprache-"));
  t.after(() => rmSync(wurzel, { recursive: true, force: true }));
  mkdirSync(join(wurzel, ".claude"));
  const datei = join(wurzel, ".claude", "workflow.config.json");
  writeFileSync(datei, JSON.stringify({ language: "en" }));
  const vorher = process.cwd();
  t.after(() => process.chdir(vorher));
  process.chdir(wurzel);

  spracheFestlegen(null);
  assert.equal(prozessSprache(), "en");
  assert.equal(text(TEXTE, "leer"), "Nothing to do.");
  // Einmal je Prozess: Eine spaetere Aenderung der Datei wirkt nicht mehr.
  writeFileSync(datei, JSON.stringify({ language: "de" }));
  assert.equal(text(TEXTE, "leer"), "Nothing to do.");
});

test("prozessSprache: Altname sprache, fehlende und kaputte Config", (t) => {
  const wurzel = mkdtempSync(join(tmpdir(), "namen-sprache-"));
  t.after(() => rmSync(wurzel, { recursive: true, force: true }));
  const vorher = process.cwd();
  t.after(() => process.chdir(vorher));
  process.chdir(wurzel);

  spracheFestlegen(null);
  assert.equal(prozessSprache(), "de", "ohne Config");
  mkdirSync(join(wurzel, ".claude"));
  writeFileSync(join(wurzel, ".claude", "workflow.config.json"), "{ kaputt");
  spracheFestlegen(null);
  assert.equal(prozessSprache(), "de", "kaputte Config");
  writeFileSync(join(wurzel, ".claude", "workflow.config.json"), JSON.stringify({ sprache: "en" }));
  spracheFestlegen(null);
  assert.equal(prozessSprache(), "en", "Altname");
});

test("spracheFestlegen: unbekannte Sprache wirft", () => {
  assert.throws(() => spracheFestlegen("fr"), /fr/);
});

// --- Paritaetspruefung ------------------------------------------------------------

test("pruefeParitaet: gleiche Schluessel und Platzhalter ergeben keinen Befund", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
});

test("pruefeParitaet meldet fehlende Schluessel in jeder Richtung", () => {
  const befunde = pruefeParitaet({ de: { a: "x", b: "y" }, en: { a: "x", c: "z" } });
  assert.equal(befunde.length, 2);
  assert.ok(befunde.some((b) => b.includes("b") && b.includes("en")), befunde.join(" | "));
  assert.ok(befunde.some((b) => b.includes("c") && b.includes("de")), befunde.join(" | "));
});

test("pruefeParitaet meldet abweichende Platzhalter", () => {
  const befunde = pruefeParitaet({
    de: { a: "{x} und {y}", b: "{z}" },
    en: { a: "{x} and {w}", b: "{z} {z}" },
  });
  assert.equal(befunde.length, 1, befunde.join(" | "));
  assert.match(befunde[0], /a/);
  assert.match(befunde[0], /y/);
  assert.match(befunde[0], /w/);
});

test("pruefeParitaet meldet eine fehlende Sprache und Werte, die kein Text sind", () => {
  assert.ok(pruefeParitaet({ de: { a: "x" } }).some((b) => b.includes("en")));
  assert.ok(pruefeParitaet({ de: { a: 1 }, en: { a: "x" } }).some((b) => b.includes("a")));
});

test("haltFolgesatz: der alte Wortlaut mit /fachplan wird weiter erkannt (Issue #1552, E15)", () => {
  assert.equal(erkenneMarker("Daraus soll per /fachplan eine fachliche Anforderung entstehen."), "haltFolgesatz");
  assert.equal(markerName("haltFolgesatz", "de"), "Daraus soll per /requirement eine fachliche Anforderung entstehen.");
});

test("codeReview: der alte Kopf mit Schritt 7 wird weiter erkannt (Issue #1676, Plan #1671 E11)", () => {
  assert.equal(erkenneMarker("## Code-Review (Schritt 7)"), "codeReview");
  assert.equal(erkenneMarker("## Code review (step 7)"), "codeReview");
  assert.equal(markerName("codeReview", "de"), "## Code-Review (Schritt 6)");
  assert.equal(markerName("codeReview", "en"), "## Code review (step 6)");
});
