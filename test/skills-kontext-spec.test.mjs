// Die Beschreibung im Session-Start (Issue #448, Plan #437).
//
// Text-Tests, kein Verhalten — was ein Skill tut, entscheidet das Modell, das
// ihn liest. Zwei Stellen tragen den Wert des Pakets und wuerden bei einer
// Umformulierung lautlos verschwinden:
//
// 1. Die Config. `/kontext` liest sonst ausschliesslich `kontext.config.json`;
//    der `spec`-Block steht aber in `.claude/workflow.config.json`. Rutscht der
//    falsche Dateiname in den Absatz, sucht der Skill den Schalter dort, wo er
//    nie liegt — und der Abschnitt entfaellt still, als gaebe es keine Specs.
// 2. Die Ausnahme `specs/vorhaben/`. Ohne sie meldete `/kontext` nach jedem
//    `/plan` einen Index als veraltet, der stimmt. Eine Meldung, die immer
//    kommt, liest bald niemand mehr — auch dann nicht, wenn sie zutrifft.

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

// --- 1. Die richtige Config -------------------------------------------------

test("`specs/INDEX.md` haengt am `spec`-Block in `.claude/workflow.config.json`", () => {
  const treffer = absaetze().filter(
    (a) =>
      a.includes("specs/INDEX.md") &&
      a.includes(".claude/workflow.config.json") &&
      /`spec`/.test(a),
  );
  assert.ok(
    treffer.length >= 1,
    "kein Absatz nennt `specs/INDEX.md`, `.claude/workflow.config.json` und den `spec`-Block zusammen",
  );
  for (const absatz of treffer) {
    assert.doesNotMatch(
      absatz,
      /kontext\.config\.json/,
      "`kontext.config.json` steht im selben Absatz — dort liegt der `spec`-Block nicht",
    );
  }
});

// --- 2. Das Neubau-Kommando -------------------------------------------------

test("das Neubau-Kommando steht woertlich im Skill", () => {
  assert.ok(
    SKILL.includes("node .claude/kit/spec.mjs index"),
    "die Zeichenkette `node .claude/kit/spec.mjs index` fehlt — die Meldung nennt sonst keinen Ausweg",
  );
});

// --- 3. Der Abschnitt in beiden Vorlagen ------------------------------------

test("`### Beschriebenes Verhalten` steht in beiden Vorlagen", () => {
  for (const [i, vorlage] of vorlagen().entries()) {
    assert.ok(
      vorlage.includes("### Beschriebenes Verhalten"),
      `Vorlage ${i + 1} hat keinen Abschnitt '### Beschriebenes Verhalten'`,
    );
    assert.ok(
      vorlage.indexOf("### Aktive Issues") < vorlage.indexOf("### Beschriebenes Verhalten"),
      `in Vorlage ${i + 1} steht der Abschnitt nicht nach '### Aktive Issues'`,
    );
  }
});

test("die Zeilenform je Bereich steht in beiden Vorlagen", () => {
  for (const [i, vorlage] of vorlagen().entries()) {
    assert.match(
      vorlage,
      /- <Bereich> — <n> gueltig, <m> entfallen/,
      `Vorlage ${i + 1} nennt die Zeilenform je Bereich nicht`,
    );
  }
});

// --- 4. Die Ausnahme specs/vorhaben/ ----------------------------------------

test("der Veraltet-Vergleich nimmt `specs/vorhaben/` aus", () => {
  const zeile = SKILL.split("\n").find((z) => z.startsWith("find specs "));
  assert.ok(zeile, "die `find`-Zeile fehlt — ohne sie ist nicht gemessen, sondern geschaetzt");
  assert.ok(
    zeile.includes("-not -path 'specs/vorhaben/*'"),
    "die Ausnahme `-not -path 'specs/vorhaben/*'` fehlt in der `find`-Zeile",
  );
  assert.ok(
    zeile.includes("-newer specs/INDEX.md"),
    "der Vergleich gegen `specs/INDEX.md` fehlt in der `find`-Zeile",
  );
});

// --- 5. Der Leerfall ist leise ----------------------------------------------

test("ohne Block oder ohne `specs/` entfaellt der Schritt leise", () => {
  const absatz = absaetze().find((a) => /leise/.test(a) && /`spec`-Block/.test(a));
  assert.ok(absatz, "kein Absatz, der den Leerfall als leise beschreibt");
  assert.match(absatz, /specs\//, "der fehlende Ordner `specs/` ist im Absatz nicht benannt");
  assert.doesNotMatch(
    absatz,
    /Hinweis|Warnung/,
    "der Leerfall nennt einen Hinweis oder eine Warnung — er ist leise, es wird nichts gemeldet",
  );
});
