// Der Umfang des Session-Starts (Issue #647, Plan #578, fachlich #559).
//
// Text-Tests, kein Verhalten — was ein Skill tut, entscheidet das Modell, das
// ihn liest. Was `/kontext` ausgibt, steht danach im Kontextfenster der ganzen
// Sitzung und fehlt dort fuer die eigentliche Arbeit. Geprueft wird deshalb,
// dass die Anweisungen zum Laden und Ausgeben einzelner Arbeitspakete weg sind
// und die Regel, welche Vorhaben erscheinen, im Skill steht statt nur in der
// Gewohnheit des Modells.
//
// Umlaute werden in beiden Schreibweisen akzeptiert: Der Skill schreibt
// gemischt, und eine Umstellung von `naechstes` auf `nächstes` ist keine
// Verhaltensaenderung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "kontext", "SKILL.md"), "utf-8");

/** Absaetze des Skills (durch Leerzeilen getrennt). */
function absaetze() {
  return SKILL.split(/\n\s*\n/);
}

/**
 * Der Schritt mit der Zusammenfassung, unabhaengig von seiner Nummer — die
 * verschiebt sich, sobald ein Schritt davor dazukommt. Die Grenze wird
 * zeilenweise gesucht und Code-Bloecke werden dabei uebersprungen: Die
 * Vorlagen enthalten selbst `##`-Ueberschriften, an denen ein naiver Schnitt
 * mitten im ersten Block landete.
 */
function zusammenfassung() {
  const zeilen = SKILL.split("\n");
  const start = zeilen.findIndex((z) => /^### \d+\. Zusammenfassung ausgeben/.test(z));
  assert.ok(start >= 0, "der Schritt 'Zusammenfassung ausgeben' fehlt");
  const gesammelt = [];
  let imBlock = false;
  for (const zeile of zeilen.slice(start + 1)) {
    if (zeile.startsWith("```")) imBlock = !imBlock;
    if (!imBlock && /^#{2,3} /.test(zeile)) break;
    gesammelt.push(zeile);
  }
  return gesammelt.join("\n");
}

/** Die beiden Ausgabe-Vorlagen (Code-Bloecke) des Zusammenfassungs-Schritts. */
function vorlagen() {
  const bloecke = [...zusammenfassung().matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(bloecke.length, 2, "die Zusammenfassung hat nicht genau zwei Vorlagen");
  return bloecke;
}

// --- 1. Keine Arbeitspakete in der Ausgabe ----------------------------------

test("[skills-16] keine Vorlage nennt `### Aktive Issues`", () => {
  for (const [i, vorlage] of vorlagen().entries()) {
    assert.doesNotMatch(
      vorlage,
      /### Aktive Issues/,
      `Vorlage ${i + 1} gibt einzelne Arbeitspakete aus — die stehen auf dem Board`,
    );
  }
});

// --- 2. Die Filterregel steht im Skill --------------------------------------

test("[skills-16] die Filterregel fuer Vorhaben steht im Skill", () => {
  const treffer = absaetze().filter(
    (a) => /`?total`?/.test(a) && /`?done`?/.test(a) && a.includes("0/0"),
  );
  assert.ok(
    treffer.length >= 1,
    "kein Absatz nennt `total`, `done` und den Fall `0/0` zusammen — die Regel, " +
      "welche Vorhaben erscheinen, stuende nirgends und wuerde nur angewendet",
  );
});

// --- 3. `issue list` wird nicht mehr geladen --------------------------------

test("[skills-16] `issue list` kommt im Skill nicht mehr vor", () => {
  assert.doesNotMatch(
    SKILL,
    /issue list/,
    "der Skill ruft `issue list` noch auf — ein Kommando, dessen Ergebnis nie " +
      "ausgegeben wird, kostet das Kontextfenster trotzdem",
  );
});

// --- 4. Keine Rede mehr von offenen Issues ----------------------------------

test("[skills-16] 'offene Issues' kommt im Skill nicht mehr vor", () => {
  assert.doesNotMatch(
    SKILL,
    /offene Issues/i,
    "der Skill spricht noch von offenen Issues — er laedt und zeigt keine mehr",
  );
});

// --- 5. Die Hinweiszeile ist alles, was vom Index bleibt --------------------

test("[skills-17] die Hinweiszeile zum Index steht in beiden Vorlagen, ohne Ueberschrift", () => {
  for (const [i, vorlage] of vorlagen().entries()) {
    const zeilen = vorlage.split("\n");
    const hinweis = zeilen.findIndex((z) => z.includes("Index veraltet — neu bauen mit"));
    assert.ok(hinweis >= 0, `Vorlage ${i + 1} traegt die Hinweiszeile zum Index nicht`);
    const davor = zeilen.slice(0, hinweis).findLast((z) => z.trim() !== "") ?? "";
    assert.doesNotMatch(
      davor,
      /^###/,
      `in Vorlage ${i + 1} steht eine Ueberschrift ueber der Hinweiszeile — eine ` +
        "Ueberschrift fuer eine Zeile, die im Normalfall gar nicht erscheint, waere " +
        "entweder ein leerer Abschnitt oder einer, der mal da ist und mal nicht",
    );
  }
});

// --- 6. Die Tagesgrenze der letzten Entscheidungen --------------------------

test("[skills-18] die Tagesregel steht im Skill", () => {
  const treffer = absaetze().filter(
    (a) =>
      a.includes("JJJJ-MM-TT") &&
      /je Notiz getrennt/.test(a) &&
      /Flie(ß|ss)text/.test(a) &&
      /keine Datumsangabe/.test(a),
  );
  assert.ok(
    treffer.length >= 1,
    "kein Absatz nennt `JJJJ-MM-TT`, 'je Notiz getrennt', den Ausschluss der " +
      "Datumsnennung im Fliesstext und den Fall ohne Datumsangabe zusammen — ohne " +
      "diese vier Stellen waechst der Abschnitt mit jeder Sitzung weiter",
  );
});

// --- 7. Der Ausblick kommt aus der Projektnotiz -----------------------------

test("[skills-16] 'Was als naechstes kommt' nennt die Projektnotiz, nicht die Ready-Spalte", () => {
  for (const [i, vorlage] of vorlagen().entries()) {
    const zeilen = vorlage.split("\n");
    const kopf = zeilen.findIndex((z) => /^### Was als n(ä|ae)chstes kommt/.test(z));
    assert.ok(kopf >= 0, `Vorlage ${i + 1} hat keinen Abschnitt 'Was als naechstes kommt'`);
    const quelle = zeilen[kopf + 1] ?? "";
    assert.match(
      quelle,
      /Projektnotiz/,
      `Vorlage ${i + 1} nennt die Projektnotiz nicht als Quelle des Ausblicks`,
    );
    assert.doesNotMatch(
      quelle,
      /Ready/,
      `Vorlage ${i + 1} verweist noch auf die Ready-Spalte — der Session-Start liest das Board nicht mehr nach Arbeitspaketen ab`,
    );
  }
});
