// Vorschau, `apply` und Gate in `/push-main` (Issue #452, Plan #437).
//
// Die Reihenfolge ist durch W3 bestimmt: „Alle betroffenen `buildChecks` laufen
// gruen, bevor gepusht wird." Weil `apply` Dateien schreibt, die in denselben
// Push gehen, muss es VOR den Pflicht-Checks laufen; das Gate `check --anker`
// misst danach den Batch, wie er gepusht wird (A4).
//
// Geprueft wird Text, nicht Verhalten — wie in `test/skills-local-check.test.mjs`.
// Der Wert liegt darin, dass eine spaetere Umformulierung auffaellt, bevor sie
// die Fortschreibung hinter die Checks schiebt (dann pruefte niemand, was
// hinausgeht) oder die Zustimmung stillschweigend fallen laesst.
//
// Die Reihenfolge wird an der Position der UEBERSCHRIFTENTEXTE gemessen, nicht
// an Schrittnummern: Nummern verschieben sich beim naechsten Einschub wieder,
// die Ueberschrift „Pflicht-Checks" bleibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "push-main", "SKILL.md"), "utf-8");

/** Position der Ueberschrift, die den genannten Text fuehrt. */
function ueberschriftPos(text) {
  const treffer = SKILL.match(new RegExp(`^#{2,4} .*${text}.*$`, "m"));
  assert.ok(treffer, `keine Ueberschrift mit '${text}' im Skill`);
  return treffer.index;
}

// A1: Ohne den Config-Bezug bliebe offen, was den neuen Schritt freischaltet.
test("Schritt 1 nennt den spec-Block als gelesenes Feld", () => {
  const start = SKILL.indexOf("### 1.");
  assert.notEqual(start, -1, "der Abschnitt 'Config lesen' fehlt");
  const abschnitt = SKILL.slice(start).split(/\n### /)[0];
  assert.match(abschnitt, /`spec`/, "das Feld `spec` steht nicht in der Liste der gelesenen Felder");
  assert.match(
    abschnitt,
    /Vorhandensein|gesetzt|schaltet/i,
    "es steht nicht, dass der Block den neuen Schritt freischaltet",
  );
});

// Der Kern des Issues: apply vor den Pflicht-Checks, Gate danach.
test("apply steht vor den Pflicht-Checks, check --anker danach", () => {
  const checks = ueberschriftPos("Pflicht-Checks");

  const apply = SKILL.search(/spec\.mjs apply --anker/);
  assert.notEqual(apply, -1, "der `apply`-Aufruf fehlt im Skill");
  assert.ok(
    apply < checks,
    "`apply` steht hinter den Pflicht-Checks — dann pruefte niemand, was tatsaechlich hinausgeht",
  );

  const gate = SKILL.search(/spec\.mjs check --anker/);
  assert.notEqual(gate, -1, "der Gate-Aufruf `check --anker` fehlt im Skill");
  assert.ok(
    gate > checks,
    "das Gate steht vor den Pflicht-Checks — es misst dann nicht den Batch, wie er gepusht wird",
  );
});

// Die Nummern der bisherigen Schritte 3–6 sind zu 4–7 geworden. Ein Verweis auf
// eine Nummer, die es nicht mehr gibt, schickt den Leser ins Leere.
test("die Schritt-Querverweise zeigen auf vorhandene Schritte", () => {
  const vorhanden = new Set([...SKILL.matchAll(/^### (\d+)\. /gm)].map((m) => m[1]));
  assert.ok(vorhanden.size > 0, "der Skill hat gar keine nummerierten Schritte");

  // „Schritt 8 des 9-Schritt-Prozesses" meint den Prozess, nicht diesen Skill.
  const verweise = [...SKILL.matchAll(/Schritt (\d+)(?! des 9-Schritt-Prozesses)/g)];
  assert.ok(verweise.length > 0, "der Skill verweist auf gar keinen Schritt");
  for (const verweis of verweise) {
    assert.ok(
      vorhanden.has(verweis[1]),
      `Verweis auf 'Schritt ${verweis[1]}', den es im Skill nicht gibt`,
    );
  }
});

// Wie in `/local-check` (Issue #427): der Anker ist der merge-base, nicht HEAD.
// Eine blosse Negativ-Assertion auf `HEAD` waere falsch — das richtige Kommando
// enthaelt das Wort woertlich.
test("jedes --anker im Skill traegt einen merge-base-Anker", () => {
  const zeilen = SKILL.split("\n").filter((z) => z.includes("--anker"));
  assert.ok(zeilen.length > 0, "der Skill uebergibt gar kein `--anker`");
  for (const zeile of zeilen) {
    assert.match(zeile, /git merge-base/, `ein --anker ohne merge-base-Anker: ${zeile.trim()}`);
  }
});

test("der Skill nennt HEAD nirgends als Anker", () => {
  assert.doesNotMatch(
    SKILL,
    /--anker\s+"?HEAD"?/,
    "`--anker HEAD` steht im Skill — der Working-Tree-Diff ist nicht der Batch, der hinausgeht",
  );
});

// Die Zustimmung ist der Punkt, an dem ein Mensch die Fortschreibung seiner
// Beschreibung sieht, bevor sie geschrieben wird.
test("ohne Zustimmung wird nicht gepusht", () => {
  assert.match(
    SKILL,
    /Ohne Zustimmung wird nicht gepusht/,
    "die Zusicherung 'Ohne Zustimmung wird nicht gepusht' fehlt woertlich",
  );
  assert.match(
    SKILL,
    /Kein Push ohne Zustimmung zur Spec-Fortschreibung/,
    "unter 'Was dieser Skill nicht tut' fehlt der Punkt zur Zustimmung",
  );
});

// Der Regelfall unmittelbar nach Ausbaustufe 5: nichts zu schreiben.
test("die leere Vorschau ueberspringt Zustimmung und Commit, das Gate laeuft trotzdem", () => {
  assert.match(
    SKILL,
    /Keine Spec-Fortschreibung in diesem Batch/,
    "die Meldung 'Keine Spec-Fortschreibung in diesem Batch' fehlt woertlich",
  );
  const absatz = SKILL.split(/\n\n/).find((a) => /Keine Spec-Fortschreibung in diesem Batch/.test(a));
  assert.match(
    absatz,
    /entfallen|entf(ä|ae)llt/i,
    "es steht nicht, dass Zustimmung und Commit bei leerer Vorschau entfallen",
  );
  assert.match(
    absatz,
    /trotzdem|dennoch|weiterhin/i,
    "es steht nicht, dass `check --anker` trotzdem laeuft",
  );
});

// Fehlerpfad: ein roter `apply`-Lauf (auch `--dry-run`) haelt alles auf.
test("ein roter apply-Lauf haelt den Push auf", () => {
  const absatz = SKILL.split(/\n\n/).find((a) => /Exitcode ungleich 0|roter? `?apply/i.test(a));
  assert.ok(absatz, "kein Absatz zum Fehlerpfad eines roten `apply`-Laufs");
  assert.match(absatz, /apply/, "der Absatz nennt `apply` nicht");
  assert.match(
    absatz,
    /kein Push|nicht gepusht|h(ä|ae)lt (der Ablauf |)an/i,
    "es steht nicht, dass der Ablauf anhaelt",
  );
  assert.match(
    absatz,
    /leer/i,
    "der leere Anker aus der merge-base-Substitution fehlt als Fehlerfall",
  );
});

// Kriterium 2 des Plans, an diesem Skill: Wer den Schalter nicht setzt, merkt nichts.
test("ohne spec-Block laeuft der Skill unveraendert", () => {
  // `[\s*_]` laesst Markdown-Auszeichnung zwischen den Woertern zu („ohne **`spec`-Block**").
  const absatz = SKILL.split(/\n\n/).find(
    (a) => /ohne[\s*_]*`?spec`?-Block/i.test(a) && /unver(ä|ae)ndert/i.test(a),
  );
  assert.ok(absatz, "kein Satz dazu, dass Projekte ohne `spec`-Block den Skill unveraendert fahren");
  assert.match(
    absatz,
    /nicht|kein/i,
    "es steht nicht, dass der neue Schritt ohne den Block entfaellt",
  );
});
