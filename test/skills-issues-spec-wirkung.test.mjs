// Der fuenfte Body-Abschnitt `## Spec-Wirkung` im issues-Skill (Issue #444).
//
// Die Leitplanke aus Issue #443 lehnt jedes Arbeitspaket ohne diesen Abschnitt
// ab — aber nur in Projekten mit `spec`-Block. Damit `/issues` ihn erzeugen
// kann, braucht der Skill drei Dinge: die Grammatik aus A12, den Ort im Body und
// die Regel, wie IDs vergeben werden.
//
// Die ID-Regel ist der heikle Teil: Die naechste Nummer eines Bereichs ist die
// hoechste je vergebene plus eins — einschliesslich der Nummern unter
// `## Entfallen` (A13). Wer nur die gueltigen Aussagen zaehlt, vergibt die
// Nummer einer gestrichenen Aussage neu.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issues", "SKILL.md"), "utf-8");

// Die vier Formen aus A12, woertlich wie in `kit/spec.mjs` (Issue #442). Zwei
// Fassungen derselben Grammatik waeren zwei Wahrheiten darueber, was gilt.
const GRAMMATIK = [
  "NEU       <BEREICH> <ID> — <Aussage>",
  "GEAENDERT <ID> — <neuer Aussage-Text>",
  "ENTFAELLT <ID> — <Grund>",
  "KEINE     — <Begruendung>",
];

/** Der Format-Codeblock aus Schritt 3 — der Ort, der die Abschnittsfolge zeigt. */
function formatCodeblock() {
  const idx = SKILL.indexOf("### 3. Issues im Vier-Abschnitt-Format anlegen");
  assert.ok(idx >= 0, "die Ueberschrift von Schritt 3 fehlt");
  const rest = SKILL.slice(idx);
  const block = /```\n([\s\S]*?)```/.exec(rest);
  assert.ok(block, "in Schritt 3 steht kein Format-Codeblock");
  return block[1];
}

test("die vier Zeilen der Grammatik stehen woertlich im Skill", () => {
  for (const zeile of GRAMMATIK) {
    assert.ok(
      SKILL.includes(zeile),
      `die Zeile '${zeile}' fehlt — Schluesselwort, Platzhalter und Gedankenstrich muessen woertlich stimmen`
    );
  }
});

test("die ID-Regel nennt die entfallenen Nummern ausdruecklich", () => {
  // Der Fehler, den der Plan-Review am 2026-09-01 im Entwurf gefunden hat: Wer
  // nur die gueltigen Aussagen zaehlt, vergibt eine gestrichene Nummer neu.
  assert.ok(
    SKILL.includes("einschliesslich der Nummern unter `## Entfallen`"),
    "die Regel sagt nicht, dass die entfallenen Nummern mitzaehlen"
  );
});

test("der Skill sagt woertlich, was ohne spec-Block gilt", () => {
  assert.ok(
    SKILL.includes("Ohne `spec`-Block gilt das Vier-Abschnitt-Format unveraendert."),
    "der Satz zum Projekt ohne spec-Block fehlt woertlich"
  );
});

test("der Abschnitt steht zwischen Akzeptanzkriterium und Abhaengigkeiten", () => {
  // Gemessen an der Reihenfolge im Format-Codeblock von Schritt 3.
  // `## Abhängigkeiten` bleibt der letzte Abschnitt, weil `parseDeps` in
  // `kit/night.mjs` das voraussetzt.
  const block = formatCodeblock();
  const kriterium = block.indexOf("## Akzeptanzkriterium");
  const wirkung = block.indexOf("## Spec-Wirkung");
  const deps = block.indexOf("## Abhängigkeiten");
  assert.ok(kriterium >= 0, "der Codeblock zeigt kein `## Akzeptanzkriterium`");
  assert.ok(wirkung >= 0, "der Codeblock zeigt kein `## Spec-Wirkung`");
  assert.ok(deps >= 0, "der Codeblock zeigt kein `## Abhängigkeiten`");
  assert.ok(kriterium < wirkung, "`## Spec-Wirkung` steht nicht nach `## Akzeptanzkriterium`");
  assert.ok(wirkung < deps, "`## Spec-Wirkung` steht nicht vor `## Abhängigkeiten`");
});

test("die ID-Form nennt Bereichspraefix und NEU-Beispiel", () => {
  assert.match(SKILL, /`<bereich>-<N>`/, "die ID-Form `<bereich>-<N>` fehlt");
  assert.ok(
    SKILL.includes("NEU board board-7"),
    "das Beispiel mit vorangestelltem Bereich fehlt"
  );
});

test("alle drei Faelle der ID-Vergaberegel sind beschrieben", () => {
  const abschnitt = specWirkungAbschnitt();

  // Fall 1: Bereich ohne einzige Aussage — erste Nummer ist 1.
  assert.match(
    abschnitt,
    /keine? (einzige )?Aussage[\s\S]{0,200}?`1`|erste Nummer ist `1`/,
    "Fall 1 (leerer Bereich, erste Nummer 1) fehlt"
  );

  // Fall 2: Mehrere NEU-Zeilen in einem Lauf — die Session zaehlt fortlaufend weiter.
  assert.match(
    abschnitt,
    /Mehrere `?NEU`?-Zeilen|mehrere `?NEU`?-Zeilen/,
    "Fall 2 (mehrere NEU-Zeilen in einem Lauf) fehlt"
  );
  assert.match(
    abschnitt,
    /fortlaufend|im Lauf bereits vergebenen/,
    "Fall 2 sagt nicht, dass die Session im Lauf weiterzaehlt"
  );

  // Fall 3: Offene Pakete frueherer Laeufe sind unsichtbar — die Kollision
  // erkennt `spec.mjs check`. Ohne diesen Satz sucht jemand nach einem Fehlweg.
  assert.match(
    abschnitt,
    /offene[nr]? Pakete|frueherer Laeufe|früherer Läufe/i,
    "Fall 3 (unsichtbare Nummern offener Pakete) fehlt"
  );
  assert.match(
    abschnitt,
    /spec\.mjs check/,
    "Fall 3 nennt nicht, dass `spec.mjs check` die Kollision erkennt"
  );
});

test("die Quelle der hoechsten Nummer ist benannt", () => {
  const abschnitt = specWirkungAbschnitt();
  assert.match(abschnitt, /specs\/<bereich>\.md/, "die Bereichsdatei als Quelle fehlt");
  assert.match(abschnitt, /## Entfallen/, "der Entfallen-Abschnitt als Teil der Quelle fehlt");
});

test("KEINE verlangt eine Begruendung", () => {
  const abschnitt = specWirkungAbschnitt();
  assert.match(
    abschnitt,
    /Begr(ü|ue)ndung ist Pflicht|Pflicht/,
    "die Pflicht zur Begruendung bei `KEINE` fehlt"
  );
  assert.match(
    abschnitt,
    /keine Wirkung.{0,80}Aussage|Aussage, kein Weglassen/,
    "der Grund („keine Wirkung“ ist eine Aussage) fehlt"
  );
});

test("Ueberschrift von Schritt 3 und Frontmatter-description bleiben unveraendert", () => {
  // Der fuenfte Abschnitt ist ein Zusatz fuer Projekte mit `spec`-Block, keine
  // Umbenennung des Formats — sonst zoege er Skills und Doku hinterher, die das
  // Issue ausdruecklich nicht anfasst (#449).
  assert.ok(
    SKILL.includes("### 3. Issues im Vier-Abschnitt-Format anlegen"),
    "die Ueberschrift von Schritt 3 wurde umbenannt"
  );
  const frontmatter = SKILL.split("---")[1] ?? "";
  assert.match(
    frontmatter,
    /Vier-Abschnitt-Format/,
    "die Frontmatter-description wurde umgeschrieben"
  );
});

/** Der Abschnitt, der den fuenften Body-Abschnitt beschreibt. */
function specWirkungAbschnitt() {
  const idx = SKILL.indexOf("#### Spec-Wirkung");
  assert.ok(idx >= 0, "der Abschnitt zur Spec-Wirkung fehlt");
  const rest = SKILL.slice(idx);
  const grenze = rest.indexOf("\n### ");
  return grenze >= 0 ? rest.slice(0, grenze) : rest;
}
