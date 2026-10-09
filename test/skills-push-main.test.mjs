// Der Weg über den Build-Dienst in `/push-main` (Issue #1216, Plan #1199 E14).
//
// Ein Projekt kann den vollen Lauf vor `push main` in seinen Build-Dienst verlegen
// (`pushPruefung: { "ort": "buildDienst", "zweig": "<name>" }`). Der lokale Weg bleibt die
// Vorgabe — und zwar Wort für Wort: Die Fixtures unter test/fixtures/push-main-lokal-*.md
// tragen den Wortlaut von Prüflauf (Schritt 5) und Push (Schritt 7), wie er vor dem
// zweiten Weg stand. Ändert sich daran ein Zeichen, wird dieser Test rot; eine gewollte
// Änderung am lokalen Weg zieht die Fixture bewusst nach.
//
// Geprüft wird Text, nicht Verhalten — wie in test/skills-ci-gate.test.mjs.

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

const BUILDDIENST = abschnitt(PUSH, "## Weg über den Build-Dienst");

test("der lokale Prüflauf (Schritt 5) steht Wort für Wort wie vor dem Build-Dienst-Weg", () => {
  const vorher = lies("test", "fixtures", "push-main-lokal-pruefung.md");
  assert.ok(PUSH.includes(vorher), "Schritt 5 weicht vom Wortlaut in test/fixtures/push-main-lokal-pruefung.md ab");
});

test("der lokale Push (Schritt 7) steht Wort für Wort wie vor dem Build-Dienst-Weg", () => {
  const vorher = lies("test", "fixtures", "push-main-lokal-push.md");
  assert.ok(PUSH.includes(vorher), "der Push in Schritt 7 weicht vom Wortlaut in test/fixtures/push-main-lokal-push.md ab");
});

test("der Skill liest pushPruefung aus checks.mjs plan --stufe push und nennt lokal als Vorgabe", () => {
  const config = abschnitt(PUSH, "### 1. Config lesen");
  assert.ok(config, "Abschnitt „### 1. Config lesen“ fehlt");
  assert.match(config, /pushPruefung/, "Schritt 1 nennt pushPruefung nicht");
  assert.match(config, /checks\.mjs plan --stufe push/, "Schritt 1 sagt nicht, woher der Wert kommt");
  assert.match(config, /`"lokal"`[^\n]*Vorgabe|Vorgabe[^\n]*`"lokal"`/, "Schritt 1 nennt lokal nicht als Vorgabe");
});

test("der Build-Dienst-Weg hat einen eigenen Abschnitt", () => {
  assert.ok(BUILDDIENST, "Abschnitt „## Weg über den Build-Dienst“ fehlt");
});

test("auf dem Build-Dienst-Weg fährt der Build-Dienst die Stufe push, der Skill nur den Nachweis für die Release-Dateien", () => {
  const laeufe = BUILDDIENST.split("\n").filter((z) => z.startsWith("node ") && z.includes("checks.mjs run"));
  assert.deepEqual(laeufe, [
    'node .claude/kit/checks.mjs run --stufe push --since "$(git merge-base HEAD origin/<mainBranch>)"',
    "node .claude/kit/checks.mjs run --in <pfad> --since HEAD --wiederholen",
  ]);
  assert.match(BUILDDIENST, /Commit-Gate/, "der Grund für den Nachweis-Lauf fehlt");
});

test("der Build-Dienst-Weg pusht erst den Prüfzweig, wartet über code ci-status --commit und pusht mainBranch nur bei Grün", () => {
  const pruefzweig = BUILDDIENST.search(/git -C <pfad> push origin HEAD:<zweig>/);
  const warten = BUILDDIENST.search(/board\.mjs code ci-status --commit/);
  const haupt = BUILDDIENST.search(/git -C <pfad> push origin HEAD:<mainBranch>/);
  assert.notEqual(pruefzweig, -1, "der Push auf den Prüfzweig fehlt");
  assert.notEqual(warten, -1, "das Warten über `code ci-status --commit` fehlt");
  assert.notEqual(haupt, -1, "der Push auf mainBranch fehlt");
  assert.ok(pruefzweig < warten && warten < haupt, "die Reihenfolge Prüfzweig → ci-status → mainBranch stimmt nicht");
  assert.match(BUILDDIENST, /nur bei `gruen`/, "die Bedingung „nur bei Grün“ fehlt");
});

test("bei Rot hält der Build-Dienst-Weg an und nennt die Adresse des Build-Logs", () => {
  assert.match(BUILDDIENST, /`rot`[\s\S]*kein Push auf `<mainBranch>`/, "bei Rot fehlt der Halt ohne Push");
  assert.match(BUILDDIENST, /Adresse des Build-Logs/, "die Adresse des Build-Logs wird nicht genannt");
});

test("der Build-Dienst-Weg kennt eine Frist und den Fall ohne Build-Dienst", () => {
  assert.match(BUILDDIENST, /Frist/, "das Warten hat keine Frist");
  assert.match(BUILDDIENST, /`keine`/, "der Fall `keine` (codeHost local) fehlt");
});

test("der Prüfzweig wird ohne --force gepusht und in Schritt 8 gelöscht", () => {
  assert.doesNotMatch(BUILDDIENST, /git push[^\n]*--force/, "der Build-Dienst-Weg pusht mit --force");
  assert.match(BUILDDIENST, /git -C <pfad> push origin --delete <zweig>/, "der Prüfzweig wird nicht gelöscht");
});

test("[1372] push-main und merge-production verlangen kein cd in den Worktree", () => {
  const merge = lies("skills", "merge-production", "SKILL.md");
  for (const [name, text] of [["push-main", PUSH], ["merge-production", merge]]) {
    assert.doesNotMatch(text, /^cd <pfad>/m, `${name}: ein Schritt verlangt cd <pfad>`);
    assert.doesNotMatch(text, /Arbeitsverzeichnis bleibt/, `${name}: der Satz zum erhaltenen Arbeitsverzeichnis steht noch`);
    assert.match(text, /checks\.mjs run --in <pfad>/, `${name}: der Prüflauf nennt den Worktree nicht über --in`);
  }
});

// --- Wackler vor push main (Issue #1401, Plan #1395 E2, E3, E13, E15, E18) ---

const SCHRITT5 = abschnitt(PUSH, "### 5. Der eine Prüflauf");
const SCHRITT9 = abschnitt(PUSH, "### 9. Bestätigung");

test("[1401] Schritt 5 wiederholt eine rote Prüfung: --wiederholen neben --stufe push", () => {
  assert.match(SCHRITT5, /^node \.claude\/kit\/checks\.mjs run --in <pfad> --stufe push --wiederholen --since /m,
    "der Prüflauf in Schritt 5 trägt --wiederholen nicht neben --stufe push");
});

test("[1401] nach einem Wackler fragt Schritt 5 vor dem Commit und nennt die Reparaturkandidaten", () => {
  const s = SCHRITT5.replaceAll(/\s+/g, " ");
  assert.match(s, /Trotzdem fortfahren\? \(ja\/nein\)/, "die Rückfrage fehlt in Schritt 5");
  assert.match(s, /node \.claude\/kit\/wirksamkeit\.mjs kandidaten/, "Schritt 5 ruft wirksamkeit.mjs kandidaten nicht");
  assert.match(s, /`Gewackelt:`/, "Schritt 5 nennt die Gewackelt-Zeile nicht als Auslöser");
  assert.match(s, /gewackeltKarte/, "Schritt 5 grenzt gewackeltKarte nicht aus");
  assert.match(s, /Nur `ja` fährt fort/, "Schritt 5 sagt nicht, dass nur ja fortfährt");
  assert.match(s, /Reparaturkandidaten ohne Wackler[^.]*halten aber nicht an/, "Kandidaten ohne Wackler halten an");
  assert.ok(PUSH.indexOf("Trotzdem fortfahren? (ja/nein)") < PUSH.indexOf("### 6. Der eine Commit"),
    "die Rückfrage steht nicht vor dem Commit");
});

test("[1401] der Job des Build-Dienstes bleibt ohne --wiederholen", () => {
  const job = BUILDDIENST.split("\n").find((z) => z.includes("checks.mjs run --stufe push"));
  assert.ok(job, "der Job des Build-Dienstes fehlt");
  assert.doesNotMatch(job, /--wiederholen/, "der Job des Build-Dienstes trägt --wiederholen");
});

test("[1401] Schritt 9 nennt Gewackelt und Reparaturkandidaten", () => {
  assert.match(SCHRITT9, /Gewackelt/, "Schritt 9 nennt die Wackler nicht");
  assert.match(SCHRITT9, /Reparaturkandidat/, "Schritt 9 nennt die Reparaturkandidaten nicht");
});
