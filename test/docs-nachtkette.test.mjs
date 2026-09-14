// Dokumentation der Nacht-Kette (Issue #646, Plan #638, fachliche Quelle #635;
// zuvor Issue #525 fuer die Erzeugungsnacht, die die Kette ersetzt).
//
// #408 machte die Dokumentation zu einem eigenen Akzeptanzkriterium, nicht zur
// Zugabe am Ende: Der fruehere Anlauf hatte eine Doku-Karte auf Done stehen,
// ohne dass je eine Zeile geschrieben wurde.
//
// Geprueft wird nicht der Wortlaut, sondern dass im Abschnitt steht, was man zum
// Starten einer Kette und zum Lesen des Morgens braucht — Geste, Bedingung,
// Ausgaenge, Rueckweg, Budgets, Bericht — und dass der dokumentierte Aufruf und die
// Budget-Felder dem Programm entsprechen. Der Kopf von test/docs-pruefstufen.test.mjs
// sagt, warum: "Eine Doku, die Werte nennt, die das Programm nicht kennt, ist
// schlimmer als keine."

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KETTE_BUDGET_DEFAULTS, BERICHT_ANKER, KETTE_HALT_ANKER } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const DOKU = lies("docs", "dokumentation.md");
const SKILL = lies("skills", "techplan", "SKILL.md");

const ABSCHNITT = "Zweiter Modus: die Nacht-Kette";

/** Ein `###`-Abschnitt aus der Doku, bis zur naechsten Ueberschrift gleicher
 *  Ebene. Gleiche Bauart wie `dokuAbschnitt` in docs-pruefstufen.test.mjs. */
function dokuAbschnitt(ueberschrift) {
  const idx = DOKU.indexOf(`### ${ueberschrift}`);
  assert.ok(idx >= 0, `Abschnitt '### ${ueberschrift}' fehlt in docs/dokumentation.md`);
  return DOKU.slice(idx).split(/\n### /)[0];
}

test("die Doku fuehrt genau einen Abschnitt zur Nacht-Kette und die Einleitung nennt zwei Betriebsarten", () => {
  assert.equal(DOKU.split(`### ${ABSCHNITT}`).length - 1, 1);
  const kapitel = DOKU.slice(DOKU.indexOf("## Nachtbetrieb")).split(/\n## /)[0];
  assert.match(kapitel.split(/\n\n/)[1], /zwei Betriebsarten/, "die Einleitung des Kapitels nennt die zwei Betriebsarten nicht");
});

// Die Anker sind die Namen, nach denen morgens jemand sucht: Wer ein Label, einen
// Kommentar oder einen Ausgang am Board oder im Ergebnisstand sieht, muss ihn in der
// Doku wiederfinden. Umschreibungen leisten das nicht.
test("der Abschnitt nennt Geste, Bedingung, Ausgaenge, Rueckweg, Budget-Felder und den Bericht-Anker beim Namen", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  const erwartet = [
    ["die Geste", "`kit:night`"],
    ["die Spalte der Kandidaten", "Backlog"],
    ["den Ausschluss durch eine offene Entscheidung", "`kit:klaeren`"],
    ["den Ausgang fertig", "`fertig`"],
    ["den Ausgang angehalten", "`angehalten`"],
    ["den Ausgang abgebrochen", "`abgebrochen`"],
    ["das Flag des Modus", "--kette"],
    ["den Halt-Kommentar", `\`${KETTE_HALT_ANKER}\``],
    ["den Anker des Berichts", `\`${BERICHT_ANKER} <stempel>\``],
    ["den Config-Block", "`night.kette`"],
    ["den Rueckweg", "von vorn"],
    ["die ueberholten Plaene", "Ueberholt durch Plan"],
    ["die wartenden Berichte", ".claude/night-bericht-"],
    ["den Kommentar bei gescheitertem Vorflug", "Kette nicht gestartet"],
    ["den Satz zum Verlauf", "Dieser Bericht ist Verlauf"],
  ];
  for (const [was, anker] of erwartet) {
    assert.ok(abschnitt.includes(anker), `der Abschnitt nennt ${was} ('${anker}') nicht`);
  }
  for (const feld of Object.keys(KETTE_BUDGET_DEFAULTS)) {
    assert.ok(abschnitt.includes(`"${feld}"`), `das Budget-Feld ${feld} fehlt im Config-Beispiel`);
  }
});

// Der dokumentierte Startwert muss der sein, den der Runner ohne Config nimmt.
test("die dokumentierten Startwerte der Budgets sind die des Programms", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  const block = abschnitt.slice(abschnitt.indexOf("```json"), abschnitt.indexOf("```", abschnitt.indexOf("```json") + 7));
  const json = JSON.parse(block.replace(/^```json\n/, ""));
  assert.deepEqual(json.night.kette, KETTE_BUDGET_DEFAULTS);
});

// Der Label-Verbrauch ist die eine Regel, die man nicht raten kann: Das Label ist
// beim Start verbraucht — ein Abbruch braucht eine neue Geste, kein Nachlabeln.
test("ein Absatz erklaert, dass das Label beim Start verbraucht ist", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  const absatz = abschnitt.split(/\n\n/).find((a) => /verbraucht/.test(a) && /Label/.test(a) && /Start/.test(a));
  assert.ok(absatz, "kein Absatz nennt 'verbraucht' zusammen mit 'Label' und 'Start'");
});

test("der Abschnitt sagt, dass Kette und Umsetzung nebeneinander laufen, und behauptet keinen Ausschluss", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  assert.match(abschnitt, /nebeneinander/);
  assert.doesNotMatch(abschnitt, /exklusiv|schliess(en|t) sich aus/i);
});

test("die Allowlist fuer fremde Reviewer steht unter dem Abschnitt zur Kette", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  assert.ok(abschnitt.includes("#### Allowlist für fremde Reviewer"));
});

test("der dokumentierte Aufruf entspricht dem Programm: --help kennt --kette", () => {
  const hilfe = execFileSync(process.execPath, [join(repoRoot, "kit", "night.mjs"), "--help"], { encoding: "utf-8" });
  assert.match(hilfe, /^\s+--kette\s/m, "night.mjs --help nennt --kette nicht");
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  assert.ok(abschnitt.includes("node .claude/kit/night.mjs --kette"), "der Aufruf steht nicht in der Doku");
});

// Die entfallenen Modi duerfen nirgends mehr als Weg genannt werden — eine Doku,
// die einen Schalter nennt, den der Runner abweist, schickt den Leser in die Irre.
test("kein Dokument nennt die entfallenen Modi, Flags oder Routing-Labels", () => {
  const alt = /Nacht-Review|Erzeugungsnacht|--erzeuge|--review-label|kit:nightreview|kit:nightplan|kit:nightissues/;
  for (const [name, text] of [["docs/dokumentation.md", DOKU], ["templates/CLAUDE-workflow.md", VORLAGE], ["skills/techplan/SKILL.md", SKILL]]) {
    assert.doesNotMatch(text, alt, `${name} nennt einen entfallenen Modus`);
  }
});

test("der Nachtbetrieb-Block der Vorlage nennt beide Routing-Labels und den Bericht", () => {
  const idx = VORLAGE.indexOf("## Nachtbetrieb");
  assert.ok(idx >= 0, "kein Nachtbetrieb-Abschnitt in der Vorlage");
  const abschnitt = VORLAGE.slice(idx).split(/\n## /)[0];
  for (const anker of ["`kit:night`", "`kit:nightrun`", "--kette", "Nachtbericht", "`night.kette`", "nebeneinander"]) {
    assert.ok(abschnitt.includes(anker), `der Nachtbetrieb-Block der Vorlage nennt '${anker}' nicht`);
  }
  // Die Kopie unter .claude/ ist Installer-Ausgabe und nicht versioniert — in CI existiert
  // sie nicht (wie in docs-pruefstufen.test.mjs). Lokal muss sie bytegleich sein.
  if (existsSync(join(repoRoot, ".claude", "CLAUDE-workflow.md"))) {
    assert.equal(VORLAGE, lies(".claude", "CLAUDE-workflow.md"), "die Kopie unter .claude/ ist nicht bytegleich");
  }
});

test("der /techplan-Skill nennt den Runner-Aufruf --kette", () => {
  assert.match(SKILL, /node \.claude\/kit\/night\.mjs --kette/);
  assert.doesNotMatch(SKILL, /--stufe plan/);
});
