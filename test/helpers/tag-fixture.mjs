// Der Prueflauf am Tag im selben Prozess (Issue #1234, Plan #1199, E6).
//
// `pruefLaufImProzess` faehrt `laufePrueflauf` aus dem Teil kit/night/tag.mjs mit injizierten
// Abhaengigkeiten `{ spawn, jetzt, board }` statt des Nacht-Runners als Kindprozess: Das Board
// ist die Attrappe der Kette ueber einer Kartenliste, git legt Worktrees als leere Ordner an,
// jede Session spielt ein Drehbuch ab, das der Test als Funktion der Karte schreibt, und die
// Uhr steht, bis jemand sie stellt. Die Teile, die der Prueflauf ruft (Laufstand, Karte,
// Worktree, Beanspruchen), bekommen dieselben Attrappen ueber ihre Setzer; danach gelten wieder
// die Vorgaben.
//
// Was der Einstieg vor dem Prueflauf tut, steht hier verkuerzt: Config, Lauf-Kopf und
// Ergebnisstand im Zustand, der Reviewer-Vorflug und der Abschluss des Laufs als Haken ueber
// `tagAnbinden`. Was nur der Einstieg belegen kann — Argumente, Vorflug-Session, echter
// Worktree, Meldung des Laufs —, bleibt Sache der Ablauf-Pruefung `ablauf-night-tag-*`.
//
// Bewusst ohne Kindprozess und ohne Import aus `kette-ablauf.mjs`: Wer dieses Fixture laedt,
// bleibt fuer den Waechter (`test/checks-leichtigkeit.test.mjs`, Regel 1) ein leichter Test.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ZUSTAND, parseArgs } from "../../kit/night/grundlagen.mjs";
import { laufstandAbhaengigkeiten } from "../../kit/night/laufstand.mjs";
import { abhaengigkeitenAbhaengigkeiten } from "../../kit/night/abhaengigkeiten.mjs";
import { kitstandAbhaengigkeiten } from "../../kit/night/kitstand.mjs";
import { verbrauchLeer } from "../../kit/night/session.mjs";
import { ketteAbhaengigkeiten } from "../../kit/night/kette.mjs";
import { PRUEFLAUF_BEFUNDE_ANKER, PRUEFLAUF_EINARBEITUNG_ANKER, laufePrueflauf, pruefLaufBudgetSetzen,
  tagAnbinden } from "../../kit/night/tag.mjs";
import { KLAEREN_LABEL } from "../../kit/night/wartend.mjs";
import { REVIEW_FERTIG_LABEL } from "../../kit/night/kette.mjs";
import { psLeer, spawnAttrappe, stdoutFangen, uhrAttrappe } from "./session-attrappe.mjs";
import { UHR_START, fachplanKarte, gitAttrappe, ketteBoard, resultZeile } from "./kette-fixture.mjs";
import { fachplanBody } from "./kette-texte.mjs";

/** Das Kennzeichen des Prueflaufs und ein Budget, das jedes Feld setzt. */
export const PRUEF_LABEL = "kit:pruefen";
export const BUDGET = Object.freeze({ label: PRUEF_LABEL, pruefungMin: 25, kostenUsd: 25 });

/** Der Marker, den eine gelaufene Pruefung im Kopf der fachlichen Anforderung hinterlaesst. */
export const FACHPLAN_MARKER = "Fachplan-Review: opus, gpt-astra (2026-09-24, Prueflauf)";

/** Die Frage, mit der eine Pruefung an einer Entscheidung der Stopp-Klasse anhaelt. */
export const PRUEFUNG_FRAGE = "Halt: Welche der beiden Zielgruppen gilt?";

const BEFUNDE_TEXT = `${PRUEFLAUF_BEFUNDE_ANKER}\n\n- Fund 1 (opus, WICHTIG): Die Zielgruppe bleibt offen.`;
const EINARBEITUNG_TEXT = `${PRUEFLAUF_EINARBEITUNG_ANKER}\n\n- Fund 1 (opus, WICHTIG): übernommen.`;

/** Eine fachliche Anforderung mit dem Kennzeichen des Prueflaufs, ungeprueft, wenn nicht anders gesagt. */
export function pruefKarte(id, { titel = "[Fachlich] Ein Anliegen", labels = [PRUEF_LABEL], body = fachplanBody(), status = "backlog" } = {}) {
  return fachplanKarte(id, { titel, labels, body, status });
}

// --- Bausteine der Session je Karte ---
//
// Was die Shell-Fakes in `kette-ablauf.mjs` am Board hinterlassen, hier als Funktion der
// Session `s` (`issue`, `board`, `cwd`).

/** Eine vollstaendige Pruefung: Marker in den Kopf, beide Kommentare, `review:fertig` dran. */
export function pruefungGeprueft(s) {
  s.board("issue", "update", s.issue, "--body", fachplanBody({ marker: FACHPLAN_MARKER }));
  s.board("issue", "comment", s.issue, "--text", BEFUNDE_TEXT);
  s.board("issue", "comment", s.issue, "--text", EINARBEITUNG_TEXT);
  s.board("issue", "label", "add", s.issue, REVIEW_FERTIG_LABEL);
}

/** Eine Pruefung, die mit einer Entscheidung der Stopp-Klasse anhaelt. */
export function pruefungHalt(s) {
  s.board("issue", "comment", s.issue, "--text", BEFUNDE_TEXT);
  s.board("issue", "comment", s.issue, "--text", PRUEFUNG_FRAGE);
  s.board("issue", "label", "add", s.issue, KLAEREN_LABEL);
}

/** Eine Pruefung, die ihre Befunde hinterlaesst und dann nicht weiterkommt. */
export function pruefungBefunde(s) {
  s.board("issue", "comment", s.issue, "--text", BEFUNDE_TEXT);
}

/** Verzweigt nach der Karte der Session; eine nicht genannte Karte tut nichts. */
export function jeKarte(faelle) {
  return (s) => faelle[s.issue]?.(s) ?? {};
}

/** Die Zeilen des Journals unter `.claude/lauf/`, als Objekte. */
function journalLesen(dir) {
  const ordner = join(dir, ".claude", "lauf");
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner).filter((n) => n.endsWith(".jsonl"))
    .flatMap((n) => readFileSync(join(ordner, n), "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z)));
}

/** Der harte Stopp des Vorflugs: Der Einstieg beendete den Prozess, hier endet der Lauf mit Exit 1. */
class HarterStopp extends Error {}

/**
 * Faehrt `laufePrueflauf` im selben Prozess.
 *
 * - `karten`: das Board zu Beginn (Reihenfolge = Board-Reihenfolge)
 * - `argv`: Argumente hinter `--pruefen`, etwa `["--max", "2"]`
 * - `budget`: der Block `pruefLauf` der Config
 * - `sitzung(s)`: das Drehbuch je Session; `s` traegt `stufe`, `issue`, `prompt`, `cwd` und das
 *   Board der Attrappe. Rueckgabe `{ zeilen, kosten, ergebnis, ende }`, alles wahlweise; den
 *   Zeilen folgt das result-Ereignis.
 * - `vorflug`: `null` fuer einen gruenen Reviewer-Vorflug, sonst der Grund seines Scheiterns
 * - `spawnSync`: das `spawnSync` des Teils kitstand (Vorgabe: leere Prozessgruppe)
 * - `vorher({ dir, board })`: laeuft nach dem Aufbau und vor dem Lauf
 * - `nachher({ dir })`: laeuft nach dem Lauf und vor dem Aufraeumen; ihre Rueckgabe steht in `nachher`
 *
 * Liefert `{ code, ausgabe, karten, karte(id), aufrufe, sitzungen, lauf, journal, vorflug,
 * abschluss, gitAufrufe, nachher, dir }`; das Temp-Verzeichnis ist danach geraeumt, `dir` nennt es nur.
 */
export async function pruefLaufImProzess({
  karten = [], argv = [], budget = BUDGET, sitzung = () => ({}), vorflug = null, spawnSync = psLeer, vorher = null, nachher = null,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-tag-prozess-"));
  const cwdVorher = process.cwd();
  const zustandVorher = { ...ZUSTAND };
  const uhr = uhrAttrappe(UHR_START);
  const jetzt = () => new Date(uhr.jetzt());
  const schlaf = (ms) => { uhr.vor(ms); };
  const kb = ketteBoard(karten, { jetzt, formPruefung: () => ({ ok: true }) });
  const { git, aufrufe: gitAufrufe } = gitAttrappe();
  const sitzungen = [];
  const { spawn } = spawnAttrappe((aufruf) => {
    const s = { stufe: aufruf.env.NIGHT_KETTE_STUFE, issue: aufruf.env.NIGHT_ISSUE_ID, prompt: aufruf.env.NIGHT_PROMPT, cwd: aufruf.cwd };
    sitzungen.push(s);
    const antwort = sitzung({ ...s, board: kb.board }) ?? {};
    return [
      ...(antwort.zeilen ?? []),
      resultZeile(antwort),
      ...(antwort.ende === undefined ? [] : [{ ende: antwort.ende }]),
    ];
  }, { uhr });
  const vorflugStand = { aufgerufen: false, kandidaten: null, journal: null };
  const abschluss = [];

  const cfg = { codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" }, pruefLauf: budget };
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(cfg, null, 2));
  const args = parseArgs(["--pruefen", ...argv]);
  const stempel = "2026-10-06-020000";

  try {
    process.chdir(dir);
    Object.assign(ZUSTAND, {
      config: cfg, CONFIG_PATH: join(dir, ".claude", "workflow.config.json"), STOPP_GRUND: "", LOG_KENNUNG: null,
      LOG_FILE: join(dir, ".claude", "night-run-2026-10-06.log"),
      LAUF_STEMPEL: stempel,
      ERGEBNIS_FILE: join(dir, ".claude", `night-run-${stempel}.json`),
      LAUF: {
        schemaFassung: 1, start: jetzt().toISOString(), art: "pruefung", modell: args.model, max: args.max,
        einheiten: [], abschluss: null, complete: false, verbrauch: verbrauchLeer(), verbrauchOhneEinheit: verbrauchLeer(),
      },
    });
    pruefLaufBudgetSetzen(cfg);
    laufstandAbhaengigkeiten({ board: kb.boardRoh, jetzt, schlaf });
    abhaengigkeitenAbhaengigkeiten({ board: kb.board, boardRoh: kb.boardRoh });
    kitstandAbhaengigkeiten({ git, jetzt, schlaf, spawnSync });
    ketteAbhaengigkeiten({ board: kb.board, boardRoh: kb.boardRoh, jetzt, schlaf });
    tagAnbinden({
      fuehreVorflug: async (_args, kandidaten, _flags, nichtGestartet) => {
        Object.assign(vorflugStand, { aufgerufen: true, kandidaten: kandidaten.map((k) => String(k.id)), journal: journalLesen(dir) });
        if (vorflug === null) return;
        nichtGestartet(vorflug);
        throw new HarterStopp(vorflug);
      },
      laufAbschliessen: (art) => { abschluss.push(art); },
    });
    if (vorher) vorher({ dir, board: kb.board });

    let code;
    const { text: ausgabe } = await stdoutFangen(async () => {
      try {
        code = await laufePrueflauf(args, {
          spawn, spawnSync: psLeer, jetzt, board: kb.board, boardRoh: kb.boardRoh, beenden: (c) => c,
        });
      } catch (e) {
        if (!(e instanceof HarterStopp)) throw e;
        code = 1;
      }
    });
    return {
      code, ausgabe, karten: kb.karten, karte: kb.karte, aufrufe: kb.aufrufe, sitzungen,
      lauf: ZUSTAND.LAUF, journal: journalLesen(dir), vorflug: vorflugStand, abschluss, gitAufrufe,
      nachher: nachher ? nachher({ dir }) : undefined, dir,
    };
  } finally {
    process.chdir(cwdVorher);
    Object.assign(ZUSTAND, zustandVorher);
    for (const zuruecksetzen of [laufstandAbhaengigkeiten, abhaengigkeitenAbhaengigkeiten, kitstandAbhaengigkeiten,
      ketteAbhaengigkeiten]) zuruecksetzen();
    const nichtAngebunden = (name) => () => { throw new Error(`${name} ist nicht angebunden`); };
    tagAnbinden({ fuehreVorflug: nichtAngebunden("fuehreVorflug"), laufAbschliessen: nichtAngebunden("laufAbschliessen") });
    rmSync(dir, { recursive: true, force: true });
  }
}
