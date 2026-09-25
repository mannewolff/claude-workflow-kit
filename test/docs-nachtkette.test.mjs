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
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KETTE_BUDGET_DEFAULTS,
  BERICHT_ANKER,
  KETTE_HALT_ANKER,
  REVIEW_FERTIG_LABEL,
  KETTE_UNGEPRUEFT_ANKER,
  grundOhneArbeit,
} from "../kit/night.mjs";

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
    // Issue #862: Eine Kette, deren bestellte Umsetzung ausblieb, ist weder gelungen noch
    // gescheitert. Wer den gelben Vorgang morgens am Brett sieht, sucht hier nach dem Wort.
    ["den Ausgang unvollstaendig", "`unvollstaendig`"],
    ["den Ausgang angehalten", "`angehalten`"],
    ["den Ausgang abgebrochen", "`abgebrochen`"],
    ["das Flag des Modus", "--kette"],
    ["den Halt-Kommentar", `\`${KETTE_HALT_ANKER}\``],
    ["den Anker des Berichts", `\`${BERICHT_ANKER} <stempel>\``],
    ["den Config-Block", "`night.kette`"],
    // Der Rueckweg fuehrt seit Issue #896 ueber den Plan, nicht mehr 'von vorn' ueber
    // einen neuen: Die naechste Kette uebernimmt das angehaltene Dokument als Auftrag.
    ["den Rueckweg", "Plan-Auftrag"],
    ["die ueberholten Plaene", "Ueberholt durch Plan"],
    ["die wartenden Berichte", ".claude/night-bericht-"],
    ["den Kommentar bei gescheitertem Vorflug", "Kette nicht gestartet"],
    ["die Pruefung als Voraussetzung", `\`${REVIEW_FERTIG_LABEL}\``],
    ["den Anker der uebersprungenen Pruefung", `\`${KETTE_UNGEPRUEFT_ANKER}\``],
    ["den Satz zum Verlauf", "Dieser Bericht ist Verlauf"],
    ["das Label der Umsetzungsstufe", "`kit:durchziehen`"],
    ["die Umsetzungsstufe", "Variante B"],
    ["den Umsetzungs-Lock", "night-umsetzung.lock"],
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

// Seit Variante B ist der Ausschluss kein Bug mehr, sondern die Aussage selbst: Die
// Umsetzungsstufe der Kette und die Umsetzungsnacht bauen beide in der Hauptkopie und
// teilen sich dafuer einen Lock. Geprueft wird deshalb nicht mehr die Abwesenheit eines
// Ausschlusses, sondern dass er samt Variante und Lock beim Namen genannt ist.
test("der Abschnitt sagt, dass Kette und Umsetzung nebeneinander laufen, und nennt die Einschraenkung unter Variante B", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  assert.match(abschnitt, /nebeneinander/);
  assert.match(abschnitt, /Variante B/);
  assert.match(abschnitt, /night-umsetzung\.lock/);
});

// Seit Issue #898 kennt die Doku zwei Auftragsarten. Wer morgens einen Plan kennzeichnen
// will, muss die Bedingungen und die beiden Kollisionsregeln lesen koennen, ohne den
// Runner zu lesen — sonst kennzeichnet er eine Karte, die stillschweigend weicht.
const PLAN_AUFTRAG = "Ein fertiger Plan als Auftrag";

test("der Abschnitt fuehrt den Plan als zweite Auftragsart mit Geste, Bedingungen und entfallenden Stufen", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  assert.ok(abschnitt.includes(`#### ${PLAN_AUFTRAG}`), `der Unterabschnitt '${PLAN_AUFTRAG}' fehlt`);
  const unter = abschnitt.slice(abschnitt.indexOf(`#### ${PLAN_AUFTRAG}`)).split(/\n#### /)[0];
  const erwartet = [
    ["die Geste am Plan", "`[Plan]`"],
    ["die Spalte der Kandidaten", "Backlog"],
    ["die erkennbare fachliche Herkunft", "Fachliche Quelle: Issue #"],
    ["die wartende Entscheidung als Ausschluss", "`kit:klaeren`"],
    ["die Pruefung als Bedingung", `\`${REVIEW_FERTIG_LABEL}\``],
    ["die entfallende Stufe plan", "`plan`"],
    ["die entfallende Stufe review", "`review`"],
    ["die Stufe, mit der der Lauf beginnt", "`pakete`"],
    ["die Variante am Plan", "Variante B"],
  ];
  for (const [was, anker] of erwartet) {
    assert.ok(unter.includes(anker), `der Unterabschnitt nennt ${was} ('${anker}') nicht`);
  }
});

test("die Pruefung als Voraussetzung gilt beiden Auftragsarten", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  const absatz = abschnitt.split(/\n\n/).find((a) => a.startsWith("**Die Pruefung als Voraussetzung.**"));
  assert.ok(absatz, "der Absatz zur Pruefung als Voraussetzung fehlt");
  assert.match(absatz, /Plandokument|Plan-Auftrag|gekennzeichnete Karte/,
    "der Absatz nennt nur die fachliche Anforderung, nicht beide Auftragsarten");
});

test("der Unterabschnitt nennt beide Kollisionsregeln", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  const unter = abschnitt.slice(abschnitt.indexOf(`#### ${PLAN_AUFTRAG}`)).split(/\n#### /)[0];
  const absaetze = unter.split(/\n\n/);
  const weicht = absaetze.find((a) => /weicht/.test(a) && /Anforderung/.test(a) && /Plan/.test(a));
  assert.ok(weicht, "keine Regel sagt, dass die fachliche Anforderung dem gekennzeichneten Plan weicht");
  const juengere = absaetze.find((a) => /j(ü|ue)ngere/.test(a) && /Wurzel|selben fachlichen/.test(a));
  assert.ok(juengere, "keine Regel sagt, dass von zwei Plaenen derselben Wurzel der juengere laeuft");
});

// Der Rueckweg aus `angehalten` fuehrt seit Issue #896 ueber den Plan und muendet in
// genau diese zweite Auftragsart. Geprueft werden die Schritte, die man nicht raten kann.
test("der Rueckweg aus dem Halt nennt seine Schritte und muendet im Plan-Auftrag", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  const absatz = abschnitt.split(/\n\n/).find((a) => a.startsWith("**Der Rückweg nach `angehalten`.**"));
  assert.ok(absatz, "der Absatz zum Rueckweg fehlt");
  for (const [was, anker] of [
    ["die Entscheidung im Plan", "## Architektonische Entscheidungen"],
    ["den Sollwert der offenen Fragen", "`- Keine.`"],
    ["die erneute Pruefung", "/issue-review"],
    ["das Abnehmen des Labels", "`kit:klaeren`"],
    ["das Kettenlabel am Plan", "an den Plan"],
    ["die Auftragsart der naechsten Kette", "Plan-Auftrag"],
  ]) {
    assert.ok(absatz.includes(anker), `der Rueckweg nennt ${was} ('${anker}') nicht`);
  }
});

// Ein Satz, den die Doku woertlich zitiert, muss der Satz des Programms sein — sonst
// sucht der Morgen einen Wortlaut, den der Runner nie schreibt.
test("der zitierte Satz ohne Arbeit entspricht dem Satz aus grundOhneArbeit", () => {
  const satz = grundOhneArbeit("ketteAlleUebersprungen", { anzahl: 1, label: "kit:night" });
  // Ohne Zahl und Labelnamen: Die Doku fuehrt dort ihre Platzhalter `<N>` und `<name>`.
  const festerTeil = satz.slice(satz.indexOf("gekennzeichneten"), satz.indexOf(" '"));
  assert.ok(DOKU.includes(festerTeil), `die Doku zitiert den Satz ohne Arbeit nicht (${festerTeil})`);
  assert.ok(!DOKU.includes("Fachplaene mit dem Label"), "die Doku fuehrt noch den ueberholten Satz mit 'Fachplaene'");
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
  for (const anker of ["`kit:night`", "`kit:nightrun`", "`kit:durchziehen`", "--kette", "Nachtbericht", "`night.kette`", "nebeneinander",
    // Seit Issue #898 nennt der Block auch die zweite Auftragsart.
    "`[Plan]`", "Plan-Auftrag"]) {
    assert.ok(abschnitt.includes(anker), `der Nachtbetrieb-Block der Vorlage nennt '${anker}' nicht`);
  }
});

// Kein Drift-Test mehr zwischen Vorlage und Kopie (wie in docs-lebenszyklus.test.mjs):
// Die Kopie unter .claude/ ist Installer-Ausgabe und liegt nicht im Repo. Ein Vergleich
// hier waere lokal rot, bis jemand den Installer laeuft — und zwaenge eine Session, unter
// .claude/ zu schreiben, was CLAUDE.md verbietet. Dass der Installer die Vorlage bytegleich
// ausliefert, prueft install-flow.test.mjs ([installer-7]); dass der Blob in install.mjs
// zur Quelle passt, `node tools/sync-blobs.mjs --check`.

test("der /techplan-Skill nennt den Runner-Aufruf --kette", () => {
  assert.match(SKILL, /node \.claude\/kit\/night\.mjs --kette/);
  assert.doesNotMatch(SKILL, /--stufe plan/);
});
