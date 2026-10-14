// Dokumentation des Prueflaufs (Issue #910, Plan #904, fachliche Quelle #899).
//
// Gleiche Bauart und gleiche Begruendung wie test/docs-nachtkette.test.mjs: Geprueft wird
// nicht der Wortlaut, sondern dass im Kapitel steht, was man zum Starten eines Prueflaufs
// und zum Lesen seines Ergebnisses braucht — Geste, Bedingungen, Ausgaenge, Vermerke,
// Budgets, Grenzen — und dass der dokumentierte Aufruf und die Budget-Werte dem Programm
// entsprechen. Eine Doku, die Werte nennt, die das Programm nicht kennt, ist schlimmer als
// keine.
//
// Das Kapitel steht auf der Prozessseite (Plan #1652, A1): Der Prueflauf gehoert dem Tag.
// Die Startwerte der Budgets nennt docs/einstellungen.md; das Kapitel verweist auf den
// Block `checkRun`, statt sie ein zweites Mal zu erklaeren.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PRUEFLAUF_REST_ANKER } from "../kit/night/tag.mjs";
import { LABELS } from "../kit/board/namen.mjs";
import { englisch } from "./helpers/labels.mjs";

// Skills und Doku nennen das Label bis zu ihrer Umstellung (Plan #1548, eigene Pakete) unter dem
// deutschen Namen; das Kit schreibt seit Issue #1552 den englischen.
const KLAEREN_LABEL = LABELS.klaeren.en;
const PRUEFLAUF_LABEL = LABELS.pruefen.en;
const REVIEW_FERTIG_LABEL = LABELS.reviewFertig.en;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const DOKU = lies("docs", "dokumentation.md");
const PROZESS = lies("docs", "prozess.md");

const KAPITEL = "Der Prüflauf";

/** Das `##`-Kapitel aus der Prozessseite, bis zur naechsten Ueberschrift gleicher Ebene. */
function dokuKapitel(ueberschrift) {
  const idx = PROZESS.indexOf(`\n## ${ueberschrift}\n`);
  assert.ok(idx >= 0, `Kapitel '## ${ueberschrift}' fehlt in docs/prozess.md`);
  return PROZESS.slice(idx + 1).split(/\n## /)[0];
}

test("die Prozessseite fuehrt genau ein Kapitel zum Prueflauf", () => {
  assert.equal(PROZESS.split(`\n## ${KAPITEL}\n`).length - 1, 1);
});

// Die Anker sind die Namen, nach denen jemand sucht, der ein Label, einen Kommentar oder
// eine Zeile der Ergebnisliste vor sich hat. Umschreibungen leisten das nicht.
test("das Kapitel nennt Geste, Aufruf, Bedingungen, Ausgaenge und Vermerke beim Namen", () => {
  const kapitel = dokuKapitel(KAPITEL);
  const erwartet = [
    ["die Geste", `\`${PRUEFLAUF_LABEL}\``],
    ["den Aufruf", "node .claude/kit/night.mjs --check"],
    ["den Config-Block", "[`checkRun`](/einstellungen)"],
    ["die Art der Kandidaten", "`[Requirement]`"],
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
});

// Die eine Regel, die man nicht raten kann: Das Kennzeichen ist mit dem Start verbraucht,
// und `kit:clarify` nimmt nur ein Mensch ab — ein Lauf, der es selbst abnahm, gaebe sich
// seine eigene Freigabe.
test("ein Absatz erklaert den Verbrauch des Kennzeichens und das Label, das nur ein Mensch abnimmt", () => {
  const kapitel = dokuKapitel(KAPITEL);
  const absaetze = kapitel.split(/\n\n/);
  const verbraucht = absaetze.find((a) => /verbraucht/.test(a) && /genau eine Prüfung/.test(a));
  assert.ok(verbraucht, "kein Absatz sagt, dass jedes Setzen genau eine Pruefung autorisiert");
  const klaeren = absaetze.find((a) => a.includes(KLAEREN_LABEL) && /nur ein Mensch|allein ein Mensch/.test(a));
  assert.ok(klaeren, `kein Absatz sagt, dass ${KLAEREN_LABEL} nur ein Mensch abnimmt`);
});

// Beim Tracker `local` liegt das Board im Repo, und die Karten aendern sich — das ist das
// Ergebnis und kein Rest.
test("ein Absatz nennt die Grenze der Unberuehrtheit beim Tracker local", () => {
  const kapitel = dokuKapitel(KAPITEL);
  const absatz = kapitel.split(/\n\n/).find((a) => /`local`/.test(a) && /`issues\//.test(a));
  assert.ok(absatz, "kein Absatz nennt die Grenze beim Tracker local samt dem issues-Verzeichnis");
  assert.match(absatz, /Ergebnis und kein Rest|kein Rest/, "der Absatz sagt nicht, dass die Kartenaenderung das Ergebnis und kein Rest ist");
});

// Dass night.mjs --help die Option --check nennt, prueft ablauf-night-grundlagen-hilfe am
// Programm (Issue #1235); den Aufruf in der Vorlage prueft der Fall darunter.

test("der Prueflauf-Block der Vorlage nennt Geste, Aufruf, Ausgaenge und das Verhaeltnis zur Kette", () => {
  const idx = VORLAGE.indexOf("## Der Prueflauf");
  assert.ok(idx >= 0, "kein Prueflauf-Abschnitt in der Vorlage");
  const abschnitt = VORLAGE.slice(idx).split(/\n## /)[0];
  for (const anker of [
    `\`${PRUEFLAUF_LABEL}\``,
    "node .claude/kit/night.mjs --check",
    "`pruefLauf`",
    `\`${REVIEW_FERTIG_LABEL}\``,
    `\`${KLAEREN_LABEL}\``,
    PRUEFLAUF_REST_ANKER,
    "Kettenlabel",
  ]) {
    // Der Regeltext nennt die Labels seit Issue #1571 englisch.
    assert.ok(abschnitt.includes(englisch(anker)), `der Prueflauf-Block der Vorlage nennt '${englisch(anker)}' nicht`);
  }
  // Der Abschnitt steht neben dem Nachtbetrieb, nicht darin: Der Lauf gehoert dem Tag.
  assert.ok(idx < VORLAGE.indexOf("## Nachtbetrieb"), "der Prueflauf-Block steht nicht vor dem Nachtbetrieb-Block");
});

// Die Einleitung des Nachtbetrieb-Kapitels bleibt bei zwei Betriebsarten (das prueft
// docs-nachtkette.test.mjs) — hier geprueft wird nur der Verweis auf das Kapitel der Prozessseite.
test("die Einleitung des Nachtbetrieb-Kapitels verweist auf das Kapitel zum Prueflauf", () => {
  const kapitel = DOKU.slice(DOKU.indexOf("\n## Nachtbetrieb\n") + 1).split(/\n## /)[0];
  assert.match(kapitel.split(/\n\n/)[1], /zwei Betriebsarten/, "die Einleitung nennt die zwei Betriebsarten nicht");
  assert.ok(kapitel.includes("/prozess#der-pruflauf"), "die Einleitung verlinkt das Kapitel zum Prueflauf nicht");
});
