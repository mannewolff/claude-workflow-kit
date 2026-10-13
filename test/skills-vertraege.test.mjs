// Verträge mit dem anderen Repo im Prozess (Issue #1616, Plan #1611 E5, E6, E10 bis E13).
//
// Gate P14 (Issue #1612) prueft die Form, `code contract-repo` (Issue #1615) holt den
// gebauten Stand. Diese Datei prueft die Kernsaetze, mit denen Regeltext und Skills beides
// fuehren: die Stopp-Klasse nennt Vertraege zwischen Kit und kanban-kit, `/techplan` holt den
// Stand und fragt vor dem Anlegen, `/issues` erkennt einen offenen Vertrag am Eingang,
// `/issue-review` arbeitet einen nicht erklaerten Vertrag ein.
//
// Geprueft wird der Text unter `templates/`, `en/templates/` und `skills/`, nicht die
// installierte Kopie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");
const REGEL_DE = lies("templates", "CLAUDE-workflow.md");
const REGEL_EN = lies("en", "templates", "CLAUDE-workflow.md");
const TECHPLAN = lies("skills", "techplan", "SKILL.md");
const ISSUES = lies("skills", "issues", "SKILL.md");
const REVIEW = lies("skills", "issue-review", "SKILL.md");

/**
 * Der Text ab der Ueberschrift bis zur naechsten Ueberschrift derselben oder hoeherer Ebene;
 * Zeilen in Codebloecken zaehlen nicht als Ueberschrift.
 */
function abschnitt(text, ueberschrift) {
  const zeilen = text.split("\n");
  const start = zeilen.indexOf(ueberschrift);
  assert.ok(start >= 0, `Abschnitt fehlt: ${ueberschrift}`);
  const ebene = ueberschrift.match(/^#+/)[0].length;
  const kopf = new RegExp(`^#{1,${ebene}} `);
  let imCode = false;
  let ende = zeilen.length;
  for (let i = start + 1; i < zeilen.length; i++) {
    if (zeilen[i].startsWith("```")) imCode = !imCode;
    else if (!imCode && kopf.test(zeilen[i])) { ende = i; break; }
  }
  return zeilen.slice(start + 1, ende).join("\n");
}

test("[vertraege-1] Stopp-Klasse Punkt 3 nennt den Vertrag zwischen Kit und kanban-kit (de)", () => {
  const punkt3 = REGEL_DE.split("\n").find((z) => z.startsWith("3. Verträge nach außen"));
  assert.ok(punkt3, "Punkt 3 der Stopp-Klasse fehlt");
  assert.match(punkt3, /etwa ein Name, ein Kennzeichen oder ein Format, das Kit und kanban-kit beide lesen oder schreiben \(Form in `CLAUDE-Plan\.md`, P14\)/);
});

test("[vertraege-2] Stopp-Klasse Punkt 3 nennt den Vertrag zwischen Kit und kanban-kit (en)", () => {
  const punkt3 = REGEL_EN.split("\n").find((z) => z.startsWith("3. Contracts to the outside"));
  assert.ok(punkt3, "item 3 of the stop class is missing");
  assert.match(punkt3, /for instance a name, a marker or a format that the kit and kanban-kit both read or write \(form in `CLAUDE-Plan\.md`, P14\)/);
});

test("[vertraege-3] der Satz zu Namensfragen nimmt Namen eines Vertrags aus (de und en)", () => {
  assert.match(REGEL_DE, /Namensfragen \(ausser Namen, die ein solcher Vertrag festlegt\)/);
  assert.match(REGEL_EN, /naming questions \(except names that such a contract fixes\)/);
});

test("[vertraege-4] /techplan holt den gebauten Stand mit code contract-repo und sucht im Klon", () => {
  const schritt2 = abschnitt(TECHPLAN, "### 2. Relevante Dateien lesen");
  assert.match(schritt2, /node \.claude\/kit\/board\.mjs code contract-repo <name>/);
  assert.match(schritt2, /Grep/);
  assert.match(schritt2, /`ok: false`[^\n]*`nicht prüfbar`/);
});

test("[vertraege-5] /techplan schreibt ### Verträge in der Fassung aus names (Tabelle VERTRAG)", () => {
  const schritt3 = abschnitt(TECHPLAN, "### 3. Plan erstellen");
  assert.match(schritt3, /`### Verträge`/);
  assert.match(schritt3, /`names`[^\n]*`VERTRAG`/);
  assert.match(schritt3, /P14/);
  assert.match(schritt3, /am Ende von `## Architektonische Entscheidungen`/);
});

test("[vertraege-6] /techplan fragt tagsüber vor dem Anlegen über alle offenen Verträge", () => {
  const schritt4 = abschnitt(TECHPLAN, "### 4. Plan zur Diskussion stellen");
  assert.match(schritt4, /offenen Vertrag/);
  assert.match(schritt4, /alle offenen Verträge/);
  assert.match(schritt4, /vor dem Anlegen in Schritt 5/);
  assert.match(schritt4, /`Entschieden:`/);
  assert.match(schritt4, /`## Offene Fragen`/);
});

test("[vertraege-7] /techplan stellt nachts die Vertragsfrage als erste Zeile unter ## Offene Fragen", () => {
  const nacht = abschnitt(TECHPLAN, "## Im Nachtbetrieb");
  assert.match(nacht, /Vertragsfrage[^\n]*erste Zeile unter `## Offene Fragen`/);
  assert.match(nacht, /andere Stopp-Frage[^\n]*weiterer Eintrag[^\n]*nächsten Halt/);
  assert.match(nacht, /`Entschieden:` schreibt nur, wer die Antwort des Menschen hat/);
});

test("[vertraege-8] /issues ruft am Eingang issue check-form und erkennt den offenen Vertrag", () => {
  const eingang = abschnitt(ISSUES, "### 1. Plan prüfen");
  assert.match(eingang, /node \.claude\/kit\/board\.mjs issue check-form <N>/);
  assert.match(eingang, /`P14`/);
  assert.match(eingang, /Kein Eingang für \/issues: offener Vertrag/);
  assert.match(eingang, /STOPP/);
});

test("[vertraege-9] /issue-review arbeitet einen nicht erklärten Vertrag ein", () => {
  const einarbeiten = abschnitt(REVIEW, "### 6. Einarbeiten");
  assert.match(einarbeiten, /nicht erklärter Vertrag/);
  assert.match(einarbeiten, /code contract-repo/);
  assert.match(einarbeiten, /`stimmt`[^\n]*ohne Halt/);
  assert.match(einarbeiten, /`kit:clarify`/);
  assert.match(einarbeiten, /`Gebauter Stand:`[^\n]*`Abgleich:`/);
  assert.match(einarbeiten, /alle offenen Verträge/);
});
