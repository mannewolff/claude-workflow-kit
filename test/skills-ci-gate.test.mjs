// Das CI-Gate in `/merge-production` und der Hinweis in `/push-main` (Issue #316).
//
// Am 2026-08-13 ging Release v1.38.0 nach production, waehrend der Windows-Job der CI
// rot war; am 2026-08-11 v1.37.0 unter denselben Bedingungen. Die lokalen buildChecks
// messen nicht, was die CI misst — das Gate schliesst genau diese Luecke.
//
// Geprueft wird Text, nicht Verhalten — wie in test/skills-push-main-spec.test.mjs. Der
// Wert liegt darin, dass eine spaetere Umformulierung auffaellt, bevor sie das Gate hinter
// die Release-Schritte schiebt (dann bliebe der Versionsbump bei `rot` zurueck) oder die
// Haerte bei `rot` stillschweigend zu einer Warnung macht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MERGE = readFileSync(join(repoRoot, "skills", "merge-production", "SKILL.md"), "utf-8");
const PUSH = readFileSync(join(repoRoot, "skills", "push-main", "SKILL.md"), "utf-8");

/** Der Absatz, der ein Muster enthaelt — Absaetze sind durch Leerzeilen getrennt. */
function absatzMit(text, muster) {
  return text.split(/\n\s*\n/).find((a) => muster.test(a));
}

test("[skills-19] das Gate steht vor dem PR und vor den Release-Schritten", () => {
  const gate = MERGE.search(/code ci-status --commit/);
  assert.notEqual(gate, -1, "der Aufruf `code ci-status --commit` fehlt im Skill");

  const pr = MERGE.search(/code pr/);
  assert.notEqual(pr, -1, "der Aufruf `code pr` fehlt im Skill");
  assert.ok(gate < pr, "das Gate steht hinter `code pr` — dann entstuende der PR vor der Pruefung");

  // Vor den Release-Schritten, nicht danach: Ein Stopp bei `rot` liesse sonst den
  // Versionsbump auf origin/main zurueck, und `version.mjs --minor` ist nicht idempotent.
  // Seit Issue #658 heisst der Schritt "Release-Dateien erzeugen" — er erzeugt nur noch,
  // Lauf und Commit stehen dahinter. Die Aussage von skills-19 ist dieselbe geblieben:
  // Das Gate steht davor, damit ein Stopp bei `rot` keinen Bump zuruecklaesst.
  const release = MERGE.search(/^#{2,4} .*Release-(Schritte|Dateien)/m);
  assert.notEqual(release, -1, "die Ueberschrift der Release-Schritte fehlt");
  assert.ok(gate < release, "das Gate steht hinter den Release-Schritten");
});

test("[skills-19] das Gate fragt den Stand von origin/<mainBranch> nach einem fetch ab", () => {
  assert.match(MERGE, /git fetch origin/, "das `git fetch` vor der Abfrage fehlt");
  assert.match(MERGE, /git rev-parse origin\//, "der SHA kommt nicht aus `git rev-parse origin/<mainBranch>`");
  // Weicht HEAD ab, liegt etwas Ungepushtes vor — dann misst die CI einen anderen Stand.
  const absatz = absatzMit(MERGE, /git rev-parse HEAD/);
  assert.ok(absatz, "der Abgleich gegen `git rev-parse HEAD` fehlt");
  assert.match(absatz, /ohne PR|kein PR|stoppt|h(ä|ae)lt an/i, "es steht nicht, dass der Skill dann stoppt");
});

test("[skills-19] bei rot entsteht kein PR, und die roten Jobs werden benannt", () => {
  // Beides im SELBEN Absatz: Ein „kein PR" drei Absaetze weiter unten laesst offen,
  // worauf es sich bezieht.
  const absatz = MERGE.split(/\n\s*\n/).find((a) => /\brot\b/.test(a) && /kein PR/.test(a));
  assert.ok(absatz, "'kein PR' steht in keinem Absatz, der auch `rot` nennt");
  assert.match(absatz, /Jobs? .*Namen|mit Namen/i, "die roten Jobs werden nicht namentlich genannt");
  // Ein Adapterfehler darf kein Freifahrtschein sein.
  assert.match(absatz, /Exit-Code 1/, "Exit-Code 1 der Achse wird nicht wie `rot` behandelt");
});

test("[skills-19] bei laeuft steht die Rueckfrage woertlich mit ihrem Default-Stopp", () => {
  assert.match(
    MERGE,
    /CI läuft noch\. PR trotzdem erstellen\? \(ja\/nein\)/,
    "die Rueckfrage fehlt woertlich",
  );
  const absatz = absatzMit(MERGE, /PR trotzdem erstellen/);
  assert.match(absatz, /`?ja`? f(ä|ae)hrt fort|Nur .*`?ja`?/i, "es steht nicht, dass nur `ja` fortfaehrt");
  assert.match(absatz, /jede andere Antwort endet ohne PR/i, "der Default-Stopp fehlt");
});

test("[skills-19] bei keine faehrt der Lauf unveraendert weiter", () => {
  const absatz = absatzMit(MERGE, /\bkeine\b.*unver(ä|ae)ndert|unver(ä|ae)ndert.*\bkeine\b/i);
  assert.ok(absatz, "kein Satz dazu, dass `keine` den Lauf unveraendert weiterfahren laesst");
});

// Der pruefbare Anker dafuer, dass in `push-main` kein Gate steht: Nach dem Push ist der
// Lauf zum eben gepushten Commit noch gar nicht fertig, und `push main` ist der haeufige
// Trigger — ein Gate muesste warten.
test("[skills-19] push-main ruft code ci-status nicht auf", () => {
  assert.doesNotMatch(PUSH, /ci-status/, "`code ci-status` steht in push-main — dort gehoert kein Gate hin");
});

test("[skills-19] push-main nennt stattdessen einen Hinweis auf merge production", () => {
  const absatz = absatzMit(PUSH, /CI-Lauf/);
  assert.ok(absatz, "kein Absatz zum CI-Hinweis in push-main");
  assert.match(absatz, /merge production/, "der Hinweis nennt `merge production` nicht");
  assert.match(absatz, /nicht gegatet|kein Gate/i, "es steht nicht, dass hier nicht gegatet wird");
  // Ohne Code-Host gibt es keine CI, ueber die man hinweisen koennte.
  assert.match(absatz, /codeHost|local/, "der Hinweis haengt nicht am codeHost");
});

// Der Vor-Push-Schritt (Issue #1154, Plan #1150, E6 bis E8): Nennt `RELEASING.md` einen,
// faehrt push-main ihn nach dem Commit und vor dem Push. Das Warten selbst lebt im
// Werkzeug des Repos, nicht im Skill — darum bleibt push-main frei von `ci-status`.

/** Abschnitt `### 7. Pushen` bis zur naechsten Ueberschrift derselben Ebene. */
function schrittPush() {
  const start = PUSH.indexOf("### 7. Pushen");
  assert.notEqual(start, -1, "der Abschnitt `### 7. Pushen` fehlt");
  const ende = PUSH.indexOf("\n### ", start + 1);
  return PUSH.slice(start, ende === -1 ? undefined : ende);
}

test("[skills-19] Schritt 7 faehrt einen Vor-Push-Schritt aus RELEASING.md vor dem Push", () => {
  const schritt = schrittPush();
  const vorPush = schritt.search(/Vor-Push-Schritt/);
  assert.notEqual(vorPush, -1, "Schritt 7 nennt keinen Vor-Push-Schritt");
  const push = schritt.search(/git push origin HEAD:/);
  assert.notEqual(push, -1, "der Push fehlt in Schritt 7");
  assert.ok(vorPush < push, "der Vor-Push-Schritt steht hinter dem Push");
  const absatz = absatzMit(schritt, /Vor-Push-Schritt/);
  assert.match(absatz, /RELEASING\.md/, "es steht nicht, dass der Vor-Push-Schritt aus RELEASING.md kommt");
  assert.match(absatz, /Hintergrund/, "es steht nicht, dass der Schritt im Hintergrund laeuft (E8)");
  assert.match(absatz, /wartet/, "es steht nicht, dass der Skill auf das Ende wartet");
});

test("[skills-19] der Vor-Push-Schritt bewertet Exit 0, 1 und jeden anderen Exit", () => {
  const schritt = schrittPush();
  assert.match(schritt, /Exit 0[^\n]*Push/, "Exit 0 fuehrt nicht zum Push");
  assert.match(
    schritt,
    /Vor-Push-Prüfung rot\. Trotzdem pushen\? \(ja\/nein\)/,
    "die Rueckfrage bei Exit 1 fehlt woertlich",
  );
  const rot = absatzMit(schritt, /Trotzdem pushen/);
  assert.match(rot, /Exit 1/, "die Rueckfrage haengt nicht an Exit 1");
  assert.match(rot, /alles au(ß|ss)er „?`?ja`?“? .*kein Push/i, "der Default ohne `ja` ist nicht `kein Push`");
  assert.match(schritt, /jeder andere Exit[^\n]*Halt ohne Push/i, "ein anderer Exit haelt nicht ohne Push an");
});

test("[skills-19] der Vor-Push-Schritt ist kein eigener Schritt der Fortschrittszeilen", () => {
  assert.doesNotMatch(PUSH, /von 10/, "die Zaehlung ist nicht mehr `von 9` (E7)");
  assert.match(schrittPush(), /Schritt 7 von 9 — Push/, "die Fortschrittszeile von Schritt 7 hat sich veraendert");
});

test("[skills-19] Force-Pushes bleiben verboten, der Vorab-Zweig ist die einzige Ausnahme beim Ziel", () => {
  assert.match(PUSH, /^- Keine Force-Pushes$/m, "„Keine Force-Pushes“ steht nicht mehr woertlich im Skill");
  const zeile = PUSH.split("\n").find((z) => /Kein Push auf .*andere Branches/.test(z));
  assert.ok(zeile, "die Zeile zu anderen Branches fehlt");
  assert.match(zeile, /ausgenommen der Vorab-Zweig/, "der Vorab-Zweig ist nicht als Ausnahme genannt");
  assert.match(zeile, /anlegt und l(ö|oe)scht/, "es steht nicht, dass der Vor-Push-Schritt ihn selbst anlegt und loescht");
});

test("[skills-19] der CI-Hinweis nennt die Vor-Push-Pruefung als einzige Ausnahme", () => {
  const absatz = absatzMit(PUSH, /CI-Lauf/);
  assert.match(absatz, /Vor-Push-Prüfung/, "der CI-Hinweis nennt die Vor-Push-Pruefung nicht");
  assert.match(absatz, /einzige Ausnahme/i, "die Vor-Push-Pruefung ist nicht als einzige Ausnahme genannt");
});
