// Die drei erzeugenden Skills setzen `--derived-from` (Issue #357).
//
// Der Sender aus Issue #356 wirkt erst, wenn die Skills ihn benutzen — sonst bleibt
// das Feld am Board leer, obwohl die Option existiert. Jede Stufe hat eine andere
// Stellung in der Kette: /fachplan legt die Wurzel an (nie ein Verweis), /plan das
// Plandokument darunter, /issues die Arbeitspakete.
//
// Der heikelste Test ist die KOPPLUNG an board.mjs: Die Skills nennen eine
// Options-Schreibweise, die kein Texttest gegen den Bestand prueft. Landete der
// Sender unter einem anderen Namen, blieben alle Texttests gruen und die Skills
// waeren trotzdem falsch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const ISSUES = lies("skills", "issues", "SKILL.md");
const PLAN = lies("skills", "plan", "SKILL.md");
const FACHPLAN = lies("skills", "fachplan", "SKILL.md");
const BOARD = lies("kit", "board.mjs");

/**
 * Der Rueckverweis-Abschnitt von skills/issues/SKILL.md, nach demselben Schnitt wie
 * in skills-issues-planverweis.test.mjs. Bewusst hier dupliziert statt dort
 * importiert: Jene Datei bleibt in diesem Issue unberuehrt, und ein Export haette
 * sie editiert.
 */
function rueckverweisAbschnitt() {
  const treffer = ISSUES.split(/\n\n/).filter((a) => /\*\*Rückverweise?\b/.test(a));
  assert.equal(treffer.length, 1, "genau ein Rueckverweis-Abschnitt erwartet");
  const rest = ISSUES.slice(ISSUES.indexOf(treffer[0]));
  const marken = ["\n### ", "\n## ", "\nIssue anlegen ueber den Board-Adapter"]
    .map((m) => rest.indexOf(m))
    .filter((x) => x >= 0);
  return marken.length ? rest.slice(0, Math.min(...marken)) : rest;
}

// --- /issues ---

test("issues-Skill nennt die Option, den Rueckfall und den Fall 'beides fehlt'", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /--derived-from/, "die Option fehlt");
  assert.match(a, /Rückfall auf .*fachliche/i, "der Rueckfall auf das fachliche Issue fehlt");
  assert.match(a, /Fehlt beides/i, "der Fall 'beides fehlt' ist nicht benannt");
});

// Ohne diesen Test waere der Absatz zwar da, aber ausserhalb des Abschnitts, den
// skills-issues-planverweis.test.mjs als Einheit prueft — und driftete davon ab.
test("die Haltbarkeits-Begruendung steht INNERHALB des Rueckverweis-Abschnitts", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /verschieden haltbar/, "die verschiedene Haltbarkeit ist nicht benannt");
  assert.match(a, /Projektwechsel/, "der Projektwechsel als Ursache fehlt");
  assert.match(a, /abfragbare/, "das Feld ist nicht als die abfragbare Form benannt");
  assert.match(a, /dauerhafte/, "die Zeile ist nicht als die dauerhafte Form benannt");
});

test("der Pool-Fall ist ausdruecklich dem bestehenden Rueckfall zugeordnet", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /pending/, "der Pool-Fall ist nicht benannt");
  assert.match(
    a,
    /derselbe[nrs]? Rückfall|kein eigener Zweig/i,
    "der Pool-Fall muss als DERSELBE Rueckfall ausgewiesen sein, nicht als neuer Zweig"
  );
});

// Die Regel ist der Grund, warum die Kinder nachts nicht dauerhaft zurueckgestellt
// werden. Sie wird hier als exakter String geprueft, nicht als Regex: Ein Umbau der
// Formulierung soll auffallen.
test("die Abhaengigkeiten-Regel steht woertlich unveraendert da", () => {
  assert.ok(
    ISSUES.includes("**Niemals in den Abhängigkeiten-Abschnitt — beide nicht.**"),
    "der Satz ist umformuliert worden — er ist der Anker gegen die Henne-Ei-Falle"
  );
});

test("der Halbsatz erklaert, warum die Regel trotz des neuen Feldes gilt", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /derivedFrom ist keine Body-Zeile|`derivedFrom` ist keine Body-Zeile/,
    "es fehlt, dass das Feld gar nicht in einem Abschnitt stehen kann");
  assert.match(a, /parseDeps/, "die Begruendung ueber parseDeps fehlt");
});

// --- /plan ---

test("plan-Skill bindet die Option an die Bedingung '/plan #N gegen [Fachlich]'", () => {
  assert.match(PLAN, /--derived-from/, "die Option fehlt");
  // Ko-Okkurrenz im selben Absatz, nach dem Muster aus skills-plan-ticket.test.mjs:
  // Option und Bedingung duerfen nicht in getrennten Teilen der Datei stehen.
  const absatz = PLAN.split(/\n\n/).find((a) => /--derived-from/.test(a) && /genau dann/i.test(a));
  assert.ok(absatz, "kein Absatz verbindet die Option mit einer 'genau dann'-Bedingung");
  assert.match(absatz, /\[Fachlich\]/, "die Bedingung nennt das [Fachlich]-Issue nicht");
  assert.match(absatz, /\/plan #N/, "die Bedingung nennt den Aufruf /plan #N nicht");
});

test("plan-Skill sagt, dass die Option beim Plan aus dem Chat entfaellt", () => {
  const absatz = PLAN.split(/\n\n/).find((a) => /--derived-from/.test(a) && /entfällt|entfaellt/.test(a));
  assert.ok(absatz, "der Fall 'Plan aus dem Chat' ist nicht behandelt");
});

// --- /fachplan ---

test("fachplan-Skill schliesst die Option an der Wurzel ausdruecklich aus", () => {
  assert.match(FACHPLAN, /--derived-from/, "die Option wird nicht erwaehnt");
  const absatz = FACHPLAN.split(/\n\n/).find((a) => /--derived-from/.test(a));
  assert.match(absatz, /nie/i, "das Nicht-Setzen ist nicht als 'nie' ausgewiesen");
  assert.match(absatz, /Wurzel/i, "die Begruendung ueber die Wurzel der Kette fehlt");
});

// --- Kopplung an den Bestand ---

test("die in den Skills genannte Schreibweise kennt board.mjs wirklich", () => {
  // Ohne diese Kopplung blieben alle Texttests oben gruen, waehrend die Skills eine
  // Option nennen, die der Sender anders schreibt — und jeder Aufruf zur Laufzeit
  // scheiterte.
  assert.match(BOARD, /args\["derived-from"\]/,
    "board.mjs liest kein args[\"derived-from\"] — Skill-Text und Sender sind auseinander");
  for (const [name, text] of [["issues", ISSUES], ["plan", PLAN], ["fachplan", FACHPLAN]]) {
    assert.match(text, /--derived-from/, `${name}: Schreibweise weicht ab`);
  }
});
