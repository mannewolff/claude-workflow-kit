// Dokumentation des Prueflaufs (Issue #910, Plan #904, fachliche Quelle #899).
//
// Gleiche Bauart und gleiche Begruendung wie test/docs-nachtkette.test.mjs: Geprueft wird
// nicht der Wortlaut, sondern dass im Kapitel steht, was man zum Starten eines Prueflaufs
// und zum Lesen seines Ergebnisses braucht — Geste, Bedingungen, Ausgaenge, Vermerke,
// Budgets, Grenzen — und dass der dokumentierte Aufruf und die Budget-Werte dem Programm
// entsprechen. Eine Doku, die Werte nennt, die das Programm nicht kennt, ist schlimmer als
// keine.
//
// Der Ort ist eigens geprueft (Plan #904, E19): ein eigenes `##`-Kapitel VOR
// `## Nachtbetrieb`. Ein `###`-Abschnitt darunter stuende neben dem Satz, dass der
// Nachtbetrieb zwei Betriebsarten kennt — und der Prueflauf gehoert dem Tag (E12).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRUEFLAUF_BUDGET_DEFAULTS,
  PRUEFLAUF_REST_ANKER,
  KLAEREN_LABEL,
  REVIEW_FERTIG_LABEL,
} from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const DOKU = lies("docs", "dokumentation.md");

const KAPITEL = "Der Prüflauf";

/** Das `##`-Kapitel aus der Doku, bis zur naechsten Ueberschrift gleicher Ebene. */
function dokuKapitel(ueberschrift) {
  const idx = DOKU.indexOf(`\n## ${ueberschrift}\n`);
  assert.ok(idx >= 0, `Kapitel '## ${ueberschrift}' fehlt in docs/dokumentation.md`);
  return DOKU.slice(idx + 1).split(/\n## /)[0];
}

test("die Doku fuehrt genau ein Kapitel zum Prueflauf, und es steht vor dem Kapitel Nachtbetrieb", () => {
  assert.equal(DOKU.split(`\n## ${KAPITEL}\n`).length - 1, 1);
  const pruef = DOKU.indexOf(`\n## ${KAPITEL}\n`);
  const nacht = DOKU.indexOf("\n## Nachtbetrieb\n");
  assert.ok(nacht >= 0, "kein Kapitel '## Nachtbetrieb' in docs/dokumentation.md");
  assert.ok(pruef < nacht, "das Kapitel zum Prueflauf steht nicht vor dem Kapitel Nachtbetrieb");
});

// Die Anker sind die Namen, nach denen jemand sucht, der ein Label, einen Kommentar oder
// eine Zeile der Ergebnisliste vor sich hat. Umschreibungen leisten das nicht.
test("das Kapitel nennt Geste, Aufruf, Bedingungen, Ausgaenge und Vermerke beim Namen", () => {
  const kapitel = dokuKapitel(KAPITEL);
  const erwartet = [
    ["die Geste", `\`${PRUEFLAUF_BUDGET_DEFAULTS.label}\``],
    ["den Aufruf", "node .claude/kit/night.mjs --pruefen"],
    ["den Config-Block", "`pruefLauf`"],
    ["die Art der Kandidaten", "`[Fachlich]`"],
    ["den Ausschluss durch eine offene Entscheidung", `\`${KLAEREN_LABEL}\``],
    ["den Ausgang geprueft", "geprüft"],
    ["den Ausgang wartende Entscheidung", "wartende Entscheidung"],
    ["den Ausgang unvollstaendig", "unvollständig"],
    ["den Anker des Vermerks", `\`${PRUEFLAUF_REST_ANKER}\``],
    ["die Spur der fertigen Pruefung", `\`${REVIEW_FERTIG_LABEL}\``],
    ["den Kommentar bei gescheitertem Vorflug", "Pruefung nicht gestartet"],
    ["die gepruefte Fassung", "Fassung"],
    ["den Worktree je Lauf", "Worktree"],
    ["die fehlende Vorschau", "/issue-review --dry-run"],
    ["das Verhaeltnis zur Nacht-Kette", "Kettenlabel"],
  ];
  for (const [was, anker] of erwartet) {
    assert.ok(kapitel.includes(anker), `das Kapitel nennt ${was} ('${anker}') nicht`);
  }
  for (const feld of Object.keys(PRUEFLAUF_BUDGET_DEFAULTS)) {
    assert.ok(kapitel.includes(`"${feld}"`), `das Budget-Feld ${feld} fehlt im Config-Beispiel`);
  }
});

// Der dokumentierte Startwert muss der sein, den der Lauf ohne Config nimmt.
test("die dokumentierten Startwerte der Budgets sind die des Programms", () => {
  const kapitel = dokuKapitel(KAPITEL);
  const start = kapitel.indexOf("```json");
  assert.ok(start >= 0, "kein JSON-Beispiel im Kapitel");
  const block = kapitel.slice(start, kapitel.indexOf("```", start + 7));
  const json = JSON.parse(block.replace(/^```json\n/, ""));
  assert.deepEqual(json.pruefLauf, PRUEFLAUF_BUDGET_DEFAULTS);
});

// Die eine Regel, die man nicht raten kann: Das Kennzeichen ist mit dem Start verbraucht,
// und `kit:klaeren` nimmt nur ein Mensch ab — ein Lauf, der es selbst abnahm, gaebe sich
// seine eigene Freigabe.
test("ein Absatz erklaert den Verbrauch des Kennzeichens und das Label, das nur ein Mensch abnimmt", () => {
  const kapitel = dokuKapitel(KAPITEL);
  const absaetze = kapitel.split(/\n\n/);
  const verbraucht = absaetze.find((a) => /verbraucht/.test(a) && /genau eine Prüfung/.test(a));
  assert.ok(verbraucht, "kein Absatz sagt, dass jedes Setzen genau eine Pruefung autorisiert");
  const klaeren = absaetze.find((a) => a.includes(KLAEREN_LABEL) && /nur ein Mensch|allein ein Mensch/.test(a));
  assert.ok(klaeren, `kein Absatz sagt, dass ${KLAEREN_LABEL} nur ein Mensch abnimmt`);
});

// Die Grenze des Kriteriums 7 der fachlichen Anforderung #899 ("der Lauf hinterlaesst im
// Projekt keine Aenderung"): Beim Tracker `local` liegt das Board im Repo, und die Karten
// aendern sich — das ist das Ergebnis und kein Rest.
test("ein Absatz nennt die Grenze der Unberuehrtheit beim Tracker local", () => {
  const kapitel = dokuKapitel(KAPITEL);
  const absatz = kapitel.split(/\n\n/).find((a) => /`local`/.test(a) && /`issues\//.test(a));
  assert.ok(absatz, "kein Absatz nennt die Grenze beim Tracker local samt dem issues-Verzeichnis");
  assert.match(absatz, /Ergebnis und kein Rest|kein Rest/, "der Absatz sagt nicht, dass die Kartenaenderung das Ergebnis und kein Rest ist");
});

test("der dokumentierte Aufruf entspricht dem Programm: --help kennt --pruefen", () => {
  const hilfe = execFileSync(process.execPath, [join(repoRoot, "kit", "night.mjs"), "--help"], { encoding: "utf-8" });
  assert.match(hilfe, /^\s+--pruefen\s/m, "night.mjs --help nennt --pruefen nicht");
});

test("der Prueflauf-Block der Vorlage nennt Geste, Aufruf, Ausgaenge und das Verhaeltnis zur Kette", () => {
  const idx = VORLAGE.indexOf("## Der Prueflauf");
  assert.ok(idx >= 0, "kein Prueflauf-Abschnitt in der Vorlage");
  const abschnitt = VORLAGE.slice(idx).split(/\n## /)[0];
  for (const anker of [
    `\`${PRUEFLAUF_BUDGET_DEFAULTS.label}\``,
    "node .claude/kit/night.mjs --pruefen",
    "`pruefLauf`",
    `\`${REVIEW_FERTIG_LABEL}\``,
    `\`${KLAEREN_LABEL}\``,
    PRUEFLAUF_REST_ANKER,
    "Kettenlabel",
  ]) {
    assert.ok(abschnitt.includes(anker), `der Prueflauf-Block der Vorlage nennt '${anker}' nicht`);
  }
  // Der Abschnitt steht neben dem Nachtbetrieb, nicht darin: Der Lauf gehoert dem Tag.
  assert.ok(idx < VORLAGE.indexOf("## Nachtbetrieb"), "der Prueflauf-Block steht nicht vor dem Nachtbetrieb-Block");
});

// Die Einleitung des Nachtbetrieb-Kapitels bleibt bei zwei Betriebsarten (das prueft
// docs-nachtkette.test.mjs) — hier geprueft wird nur der Verweis auf das neue Kapitel.
test("die Einleitung des Nachtbetrieb-Kapitels verweist auf das Kapitel zum Prueflauf", () => {
  const kapitel = DOKU.slice(DOKU.indexOf("\n## Nachtbetrieb\n") + 1).split(/\n## /)[0];
  assert.match(kapitel.split(/\n\n/)[1], /zwei Betriebsarten/, "die Einleitung nennt die zwei Betriebsarten nicht");
  assert.ok(kapitel.includes("#der-prüflauf"), "die Einleitung verlinkt das Kapitel zum Prueflauf nicht");
});
