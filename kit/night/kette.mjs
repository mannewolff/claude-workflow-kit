/**
 * night/kette.mjs — die Nacht-Kette (Issue #1232, Plan #1199, E17): Auswahl und Ausschluss
 * der Auftraege, die Stufen plan, review, pakete und abdeckung, die Stufe umsetzung unter
 * Variante B, das vorhandene Ergebnis einer Stufe, die freigegebenen Uebergaenge, das
 * Beanspruchen der Wurzeln und der Lauf der Kette.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus Teilen unter kit/night/ und kit/board/, nie aus dem Einstieg:
 * Der Einstieg laedt die Teile, ein Rueckimport waere ein Zyklus.
 *
 * Mitgezogen, weil die Kette ihr Hauptaufrufer ist: die Stopp-Fragen und die Herkunft
 * erzeugter Dokumente, das Erfolgssignal der Erzeugung, die belegte Wurzel
 * (`wurzelBelegt`), das Kennzeichen `review:fertig`, was im Abschnitt des Nachtberichts
 * allein die Kette ruft, die Budgets der Kette samt ihrer Protokollzeile und das
 * Beanspruchen. Prueflauf und Probelauf nehmen sie von hier. Die Bausteine des Prueflaufs,
 * die im Abschnitt der Kette standen, stehen seit Issue #1234 im Teil kit/night/tag.mjs.
 *
 * Den Abschluss des Laufs (`laufAbschliessen`) und den Reviewer-Vorflug (`fuehreVorflug`)
 * ruft die Kette, ohne sie zu importieren: Beide stehen im Einstieg, und ein Import waere ein
 * Zyklus. Der Einstieg bindet sie ueber `ketteAnbinden` an (Plan #1199, E16).
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { ZUSTAND, NACHBAR_DIR, log, board, boardRoh, einheitAnlegen, einheitErgaenzen, gitClean, gitReste,
  laufMelden, resteText, schreibeErgebnisstand, schrittBeginnen, schrittEnden, vergleicheText,
  vermerkeOhneArbeit } from "./grundlagen.mjs";
import { ABBRUCH_BUDGET_MS, LAUF_KONTEXT, LAUF_ORDNER, RECHNER, abgeben, exitText, journalLesen, laufAnhalten,
  laufLebt, laufPositionSetzen, pulsZustandSetzen, standSetzen } from "./laufstand.mjs";
import { UMSETZUNG_WARTEN_MS, VORBEREITUNG_DATEI, aufUmsetzungWarten, befundeZurueckUndVorschlagen, kitStandAbgeben, kitStandInBaum, prozessLaeuft,
  umsetzungLockNehmen, worktreeAnlegen, worktreeEntfernen, worktreesAufraeumen } from "./kitstand.mjs";
import { ENTSCHEIDUNGEN_NAME, OFFENE_FRAGEN_NAME, OFFENE_FRAGEN_UEBERSCHRIFT, PO_FRAGEN_NAME, PO_FRAGEN_UEBERSCHRIFT,
  abschnittLesen, leseKarte, wartetAufPush } from "./abhaengigkeiten.mjs";
import { flatten, kennzahlenAddieren, ketteBudgetDefaults, kostenAddieren, KETTE_BUDGET_DEFAULTS, ladeKetteBudget,
  ladeKetteUebergaenge, ladePruefLaufBudget, leseErgebnisText, leseKennzahlen, neueKommentare, runSession,
  KETTE_ZIELE, PLANREVIEW_LABELS, pruefreihenVon, SESSION_ABHAENGIGKEITEN, varianteVon, zielVon, ZIEL_LABEL_PRAEFIX } from "./session.mjs";
import { berichtFuerKette, berichtSchreiben, hatPlanReviewMarker, kommentareVon, planReviewWert,
  pruefBericht, vorbereitungsBericht, wartendeMenschenschritte } from "./bericht.mjs";
import { GRUND_WARTEND, KLAEREN_LABEL, WARTEND_ANKER, geschuetztAmBoardVermerken, hatKlaerenLabel, laufeRunde,
  pruefeIssueGates, rundenMerker, wartendVermerk, wartendeSession } from "./wartend.mjs";

// Die Praefixe kommen aus dem Board-Teil dokumente (Issue #1218). Abgefangen wie im Einstieg:
// Fehlt der Teil, wirft jede Funktion erst, wenn jemand sie braucht — ein stilles `false`
// liesse ein Plandokument als Arbeitspaket durch. Der Pfad ist nicht literal, deshalb nennt
// die Gruppe dieses Teils den Bereich board-dokumente von Hand (E3).
const praefixFehlt = (was) => () => {
  throw new Error(`board/dokumente.mjs fehlt neben night.mjs (${join(NACHBAR_DIR, "board")}) — das Praefix ${was} ist nicht erkennbar.`);
};
const {
  istFachlich: isFachlich,
  istPlan: isPlan,
  istIdee: isIdee,
  istMensch: isMensch,
} = await import(pathToFileURL(join(NACHBAR_DIR, "board", "dokumente.mjs")).href).catch(() => ({
  istFachlich: praefixFehlt("[Fachlich]"),
  istPlan: praefixFehlt("[Plan]"),
  istIdee: praefixFehlt("[Idee]"),
  istMensch: praefixFehlt("[Mensch]"),
}));

// --- Anbindung an den Einstieg (Plan #1199, E16) ---

// Abschluss des Laufs und Reviewer-Vorflug stehen im Einstieg; ein Teil, der allein geladen
// ist, hat keinen.
const anbindung = {
  laufAbschliessen: () => {
    throw new Error("laufAbschliessen ist nicht angebunden — der Einstieg kit/night.mjs setzt es beim Laden.");
  },
  fuehreVorflug: () => {
    throw new Error("fuehreVorflug ist nicht angebunden — der Einstieg kit/night.mjs setzt es beim Laden.");
  },
};

/** Setzt die Haken aus `anbindung`; nicht genannte behalten ihren Wert. */
export function ketteAnbinden(haken) {
  for (const [name, fn] of Object.entries(haken)) {
    if (!Object.hasOwn(anbindung, name)) throw new Error(`ketteAnbinden kennt keinen Haken '${name}'`);
    anbindung[name] = fn;
  }
}

// --- Die Abhaengigkeiten des Kettenlaufs (Issue #1233, Plan #1199, E6) ---

/**
 * Was der Lauf der Kette von aussen braucht, jeweils mit der echten Implementierung als
 * Vorgabe: `spawn` startet die Session einer Stufe und `spawnSync` fragt danach ihre
 * Prozessgruppe ab (beide gehen an `runSession`), `jetzt` und `schlaf` sind Uhr und Warten
 * (Budgets der Stufen, Bestaetigungsfrist des Beanspruchens), `schlafen` das asynchrone
 * Warten auf Umsetzungssperre und Vorbereitung, `board` und `boardRoh` die
 * Aufrufe des Board-Werkzeugs, `gitClean` und `gitReste` der Blick auf die Hauptkopie vor
 * der Umsetzung, `beenden` das Ende des Prozesses.
 *
 * `laufeKette` nimmt sie als Parameter, nach dem Muster von `ToolboxIssueTracker({ jetzt,
 * schlaf, zufall })`: Ein Test im selben Prozess setzt Attrappen ein, der Runner ruft ohne.
 * Die Teile, die die Kette ruft (Laufstand, Worktree, Bericht), haben ihre eigenen.
 */
export const KETTE_ABHAENGIGKEITEN = Object.freeze({
  spawn: SESSION_ABHAENGIGKEITEN.spawn,
  spawnSync: SESSION_ABHAENGIGKEITEN.spawnSync,
  jetzt: () => new Date(),
  schlaf: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  // Das Warten ueber Minuten (Plan #1243, E8): asynchron, damit Puls-Takt, Abbruch-Handler
  // und Laufmeldung waehrenddessen weiterlaufen. `schlaf` bleibt der Bestaetigungsfrist.
  schlafen: (ms) => new Promise((r) => setTimeout(r, ms)),
  board,
  boardRoh,
  gitClean,
  gitReste,
  beenden: (code) => process.exit(code),
});

// Die Abhaengigkeiten des laufenden Laufs; `laufeKette` setzt sie fuer seine Dauer. Modul-
// Zustand wie `anbindung`, weil die Stufen sie brauchen, ohne dass jede Funktion sie
// durchreicht. Ausserhalb eines Laufs gelten die Vorgaben.
const abh = { ...KETTE_ABHAENGIGKEITEN };

/**
 * Setzt Abhaengigkeiten des Teils ausserhalb eines Kettenlaufs ein; nicht genannte behalten
 * ihren Wert, ohne Argument gelten wieder alle Vorgaben. Nur fuer Tests: Der Prueflauf am Tag
 * (kit/night/tag.mjs) ruft Beanspruchen, belegte Wurzel und Wartend-Vermerk von hier, und sein
 * Test im selben Prozess braucht dafuer dieselben Attrappen (Issue #1234, E6).
 */
export function ketteAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, KETTE_ABHAENGIGKEITEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(KETTE_ABHAENGIGKEITEN, name)) throw new Error(`ketteAbhaengigkeiten kennt keine Abhaengigkeit '${name}'`);
    abh[name] = fn;
  }
}

// --- Die Budgets der Kette ---

// Geladen in vorbereiten() des Einstiegs ueber ketteBudgetSetzen() — Modul-Zustand wie
// `config`, weil ART_LABEL und die Stufen sie brauchen, ohne dass jede Funktion sie
// durchreicht.
let KETTE_BUDGET = null;
// Die Budget-Felder, die aus den Defaults stammen (Issue #659) — geladen zusammen mit
// KETTE_BUDGET, gezeigt im Protokoll und am Lauf-Kopf.
let KETTE_BUDGET_AUS_DEFAULT = [];
// Die freigegebenen Uebergaenge der Kette (Issue #1087), geladen zusammen mit KETTE_BUDGET.
let KETTE_UEBERGAENGE = null;

/**
 * Laedt Budgets und Uebergaenge der Kette aus der Config. Eine kaputte Zahl wirft; der
 * Einstieg macht daraus den Config-Fehler, mit dem der Lauf gar nicht erst beginnt.
 */
export function ketteBudgetSetzen(config) {
  KETTE_BUDGET = ladeKetteBudget(config);
  KETTE_UEBERGAENGE = ladeKetteUebergaenge(config);
  KETTE_BUDGET_AUS_DEFAULT = ketteBudgetDefaults(config);
}

/** Die geladenen Budgets der Kette und die Felder daraus, die aus den Defaults stammen. */
export function ketteBudgetStand() {
  return { budget: KETTE_BUDGET, ausDefault: KETTE_BUDGET_AUS_DEFAULT };
}

// Was die Protokollzeile je Lauf-Art ueber ihren Config-Block sagen muss. Getrennt von der
// Zeile selbst, weil nur diese drei Angaben sich unterscheiden — der Satzbau nicht.
const KETTE_BUDGET_TEXT = { name: "der Kette", block: "night.kette", defaults: KETTE_BUDGET_DEFAULTS };

/**
 * Die Protokollzeile zu den Budgets aus den Defaults (Issue #659), `null` ohne solche.
 * Setzt der Block kein einziges Feld, sagt die Zeile das dazu: Ob er fehlt oder leer ist,
 * macht fuer den Leser keinen Unterschied — beide Male gilt kein eigener Wert.
 *
 * `text` nennt den Lauf und seinen Block (Issue #909): Kette und Prueflauf bilden dieselbe
 * Zeile, und zwei Fassungen desselben Satzes liefen bei der ersten Aenderung auseinander.
 */
export function budgetDefaultsZeile(budget, ausDefault, text = KETTE_BUDGET_TEXT) {
  if (ausDefault.length === 0) return null;
  const werte = ausDefault.map((feld) => `${feld}=${budget[feld]}`).join(", ");
  const ganz = ausDefault.length === Object.keys(text.defaults).length
    ? ` — ${text.block} in .claude/workflow.config.json fehlt oder setzt kein Feld.`
    : "";
  return `Budget ${text.name} aus den Defaults: ${werte}${ganz}`;
}

// --- Wurzel belegt (Plan #1113, E5, E6) ---
//
// Was aus dem Laufstand-Text liest, ob ein anderer Runner eine fachliche Wurzel haelt. Der
// Laufstand selbst steht in kit/night/laufstand.mjs (Issue #1225).

/** Reserve auf die Gesamtzeit-Obergrenze, bevor ein fremder Laufstand als verwaist gilt (E5). */
const WURZEL_RESERVE_MS = 15 * 60_000;

/**
 * Die Gesamtzeit-Obergrenze einer Karte in Millisekunden (E5): die Summe der Kettenstufen
 * oder das Budget des Prueflaufs. Der Laufstand nennt seine Laufart nicht; darum gilt die
 * groessere — ein lebender Lauf darf nie als tot gelten, ein toter wartet nur laenger.
 */
function wurzelObergrenzeMs({ kette, pruefLauf }) {
  const ketteMin = kette.planMin + kette.paketeMin + kette.reviewMin + kette.abdeckungMin + kette.umsetzungMin;
  return Math.max(ketteMin, pruefLauf.pruefungMin) * 60_000;
}

/** Lauf-ID, Stand und Position aus einem Laufstand-Text (#1186) — `null` ohne Lauf-ID. */
function laufstandKopf(text) {
  const t = String(text ?? "");
  const laufId = /^Lauf-ID:[^\S\n]*(\S+)[^\S\n]*$/m.exec(t)?.[1];
  if (!laufId) return null;
  const [host, pid] = laufId.split("/");
  const stand = Date.parse(/^Stand:[^\S\n]*(\S+)[^\S\n]*$/m.exec(t)?.[1] ?? "");
  const k = Number(/^Position:[^\S\n]*(\d+)[^\S\n]+von[^\S\n]+\d+[^\S\n]*$/m.exec(t)?.[1]);
  return { laufId, host, pid: Number(pid), stand, k: k > 0 ? k : 1 };
}

/**
 * Haelt ein lebender Runner die fachliche Wurzel `F` (Plan #1113, E5, E6)? Rein bis auf die
 * Prozess-Probe auf demselben Rechner.
 *
 * Gewertet werden F selbst und jeder Plan (`isPlan`) mit `Fachliche Quelle:` F; Arbeitspakete
 * tragen dieselbe Zeile, ihre Konkurrenz regelt aber die Umsetzungssperre. `staende` ordnet
 * Kartennummern ihren Laufstand `{ zustand, text }` zu (Map oder Objekt). Nur `laeuft` mit
 * Lauf-ID belegt; lebend heisst auf demselben Rechner (`host` wie in der Lauf-ID) ein
 * laufender Prozess, von einem anderen Rechner aus ein `Stand:`, der juenger ist als Position
 * mal Gesamtzeit-Obergrenze plus Reserve — Karte k kommt fruehestens nach k−1 Budgets dran.
 *
 * Rueckgabe `{ karte, laufId }` des ersten lebenden Halters, sonst `null`.
 */
export function wurzelBelegt(F, issues, staende, jetzt, host, { budgets = { kette: ladeKetteBudget({}), pruefLauf: ladePruefLaufBudget({}) } } = {}) {
  const wurzel = String(F);
  const standVon = (id) => (staende instanceof Map ? staende.get(id) : staende?.[id]);
  const obergrenzeMs = wurzelObergrenzeMs(budgets);
  const karten = (issues || [])
    .filter((i) => String(i?.id) === wurzel || (isPlan(i?.title ?? "") && fachlicheQuelleVon(i?.body || "") === wurzel))
    .map((i) => String(i.id));
  for (const karte of karten) {
    const stand = standVon(karte);
    if (stand?.zustand !== "laeuft") continue;
    const kopf = laufstandKopf(stand.text);
    if (!kopf) continue;
    const lebt = kopf.host === host
      ? Number.isInteger(kopf.pid) && kopf.pid > 0 && prozessLaeuft(kopf.pid)
      : Number.isFinite(kopf.stand) && jetzt.getTime() - kopf.stand < kopf.k * obergrenzeMs + WURZEL_RESERVE_MS;
    if (lebt) return { karte, laufId: kopf.laufId };
  }
  return null;
}


// --- Die Pruefung vor der Kette (Fachplan #702, Plan #716) ---


/**
 * Die Spur einer gelaufenen Pruefung, die die Nacht-Kette voraussetzt (Fachplan #702,
 * Plan #716, E2).
 *
 * Der Name ist eine feste Konstante und kommt bewusst NICHT aus der Config: Die Regel
 * soll in jedem Projekt ohne Einstellung gelten, und ein Config-Feld waere ueber einen
 * leeren Wert genau die Abschaltung, die es nicht geben soll. `/issue-review` setzt das
 * Label; die Kette liest es nur.
 */
export const REVIEW_FERTIG_LABEL = "review:fertig";

export function hatReviewFertigLabel(issue) {
  return (issue?.labels || []).includes(REVIEW_FERTIG_LABEL);
}

/**
 * Das feste Praefix jedes Grundes „Pruefung fehlt" (Plan #716).
 *
 * Fest, weil der ganze Grundtext je Karte verschieden ist — er nennt ihre Nummer. Wer
 * die Faelle wiedererkennen will (der Kommentar an der abgelehnten Anforderung), prueft
 * auf dieses Praefix und nicht auf den ganzen Text.
 */
export const UNGEPRUEFT_PRAEFIX = `ungeprueft: Label '${REVIEW_FERTIG_LABEL}' fehlt`;

/**
 * Grund und naechster Schritt fuer eine Karte ohne `review:fertig` — getrennt geliefert.
 *
 * Das Kettenlabel kommt als Argument aus `night.kette.label` und wird nicht fest
 * geschrieben: Der Bestand nennt es ueberall dynamisch, und in einem Projekt mit anderem
 * Label waere `kit:night` im Text schlicht falsch (Plan #716, E8).
 */
export function pruefungFehltGrund(id, kettenLabel) {
  const schritt = `mit /issue-review #${id} pruefen lassen, das setzt ${REVIEW_FERTIG_LABEL}; das Label ${kettenLabel} bleibt dran`;
  return { praefix: UNGEPRUEFT_PRAEFIX, schritt, text: `${UNGEPRUEFT_PRAEFIX} — ${schritt}` };
}

/**
 * Der Anker des Kommentars an der wegen fehlender Pruefung abgelehnten Anforderung
 * (Fachplan #702, Kriterium 4; Plan #716, E3).
 *
 * Er steht als erste Zeile des Kommentars und traegt keinen Laufstempel: Genau daran
 * erkennt der naechste Lauf, dass der Hinweis schon dasteht, und schreibt keinen
 * zweiten. Ein Label als Merker verlangte ein weiteres Kennzeichen am Board, eine
 * lokale Datei ueberlebte den Worktree nicht.
 *
 * Aehnlich, aber nicht dasselbe wie der Kommentar `Kette nicht gestartet` bei
 * gescheitertem Reviewer-Vorflug: Der eine sagt, die Pruefung der Anforderung fehlt,
 * der andere, die Reviewer waren nicht erreichbar.
 */
export const KETTE_UNGEPRUEFT_ANKER = "## Kette nicht gestartet: Pruefung fehlt";

/**
 * Das feste Praefix jedes Grundes einer unpassenden Ziel- oder Pruefer-Einstellung (Plan
 * #1243, A9; Issue #1244) — wie `UNGEPRUEFT_PRAEFIX` erkennt `uebersprungeneVerbuchen`
 * daran die Karten, die einen Hinweis bekommen.
 */
export const ZIEL_UNPASSEND_PRAEFIX = "unpassende Einstellung: ";

/** Der Anker des einmaligen Hinweises an einer solchen Karte, gebaut wie `KETTE_UNGEPRUEFT_ANKER`. */
export const KETTE_ZIEL_ANKER = "## Kette nicht gestartet: unpassende Einstellung";


// --- Stopp-Fragen und Herkunft erzeugter Dokumente ---

// Die vorgeschriebene Form eines Plandokuments ohne offene Punkte (Regel P6): erste
// nichtleere Zeile des Abschnitts, ein Zusatz dahinter ist der Regelfall.
const KEINE_STOPP_FRAGEN = "- Keine.";
// Wie viel von einer offenen Frage in den Grund wandert. Kurz genug fuer eine Log-Zeile,
// lang genug, um die Frage wiederzuerkennen.
const STOPP_FRAGE_ZITAT = 120;

/**
 * Die Stopp-Fragen-Pruefung eines Plandokuments (Issue #519) — `null`, wenn keine offen ist.
 *
 * Sie ersetzt die am 28. August gestrichene Regel P8 (Begruendung: Plan #513, A5); P8
 * selbst wird nicht wiederbelebt.
 *
 * Ein FEHLENDER Abschnitt ist ein Ausschluss, keine Erlaubnis: Das `parseDeps`-Muster
 * liefert bei fehlender Ueberschrift eine leere Liste, und "keine Zeile, also keine offene
 * Frage" liesse ausgerechnet einen Plan ohne den Pflichtabschnitt durch.
 */
export function stoppFragenGrund(body) {
  const abschnitt = abschnittLesen(body, OFFENE_FRAGEN_UEBERSCHRIFT);
  if (abschnitt === null) return `kein Abschnitt ## ${OFFENE_FRAGEN_NAME}`;
  // Nur Zeilen ausserhalb eines Fence: Ein Plan, der die Regelform als Beispiel zeigt,
  // haette sich sonst mit seinem eigenen Codeblock freigegeben.
  const erste = abschnitt.zeilen.find((z, i) => abschnitt.ausserhalb[i] && z.trim() !== "");
  if (erste === undefined) return `Abschnitt ## ${OFFENE_FRAGEN_NAME} ist leer`;
  if (erste.trim().startsWith(KEINE_STOPP_FRAGEN)) return null;
  return `offene Stopp-Frage: ${flatten(erste, STOPP_FRAGE_ZITAT)}`;
}

// Wie eine fachliche Anforderung sagt, dass keine Frage mehr offen ist: die erste
// nichtleere Zeile beginnt mit "Keine" — ein fuehrender Listenstrich davor und ein
// beliebiger Zusatz dahinter sind erlaubt. Bewusst laxer als `KEINE_STOPP_FRAGEN`:
// `/fachplan` schreibt keine Listenform vor, und die vorhandenen Anforderungen tragen
// dort Fliesstext ("Keine. Die vier Fragen hat der PO entschieden …").
const KEINE_PO_FRAGEN = /^(?:[-*+]\s+)?Keine/;

/**
 * Traegt eine fachliche Anforderung offene Fragen an den PO (Issue #916)? — `null`, wenn
 * nicht.
 *
 * Eigene Funktion neben `stoppFragenGrund` und mit eigener Ueberschrift-Konstante: Die
 * beiden Faelle unterscheiden sich in Ueberschrift, erlaubter Schreibweise und Wirkung
 * (Halt mitten in der Kette gegen Ausschluss vor dem Start). Ein gemeinsamer Parameter
 * verbaende zwei Regeln, die getrennt wandern koennen.
 *
 * Ein FEHLENDER Abschnitt laeuft, anders als beim Plandokument: Ob eine fachliche
 * Anforderung ihren Pflichtabschnitt traegt, prueft Gate F7 in board.mjs; die Kette misst
 * sie nicht ein zweites Mal daran.
 */
export function offeneFragenGrund(body) {
  const abschnitt = abschnittLesen(body, PO_FRAGEN_UEBERSCHRIFT);
  if (abschnitt === null) return null;
  // Nur Zeilen ausserhalb eines Fence, aus demselben Grund wie bei `stoppFragenGrund`:
  // Eine im Codeblock gezeigte Beispielfrage ist keine offene Frage.
  const erste = abschnitt.zeilen.find((z, i) => abschnitt.ausserhalb[i] && z.trim() !== "");
  if (erste === undefined) return null;
  if (KEINE_PO_FRAGEN.test(erste.trim())) return null;
  return `offene Frage an den PO: ${flatten(erste, STOPP_FRAGE_ZITAT)}`;
}

// --- Das Erfolgssignal der Erzeugung (Issue #520) ---

// Welche Herkunftszeile ein erzeugtes Dokument seiner Quelle traegt: Ein Plandokument
// nennt die `Fachliche Quelle`, ein Arbeitspaket den `Plan`. Nicht `derivedFrom` — das
// Feld wertet allein der toolbox-Adapter aus, die uebrigen Tracker nehmen es folgenlos
// an; die Zeilen stehen im Body und tragen ueberall.
export const HERKUNFT_FELD = { plan: "Fachliche Quelle", issue: "Plan" };

/**
 * Traegt dieses Dokument die Zielstufe des Laufs (Issue #520)?
 *
 * `plan` erzeugt ein `[Plan]`-Dokument, `issue` erzeugt Arbeitspakete — und die tragen
 * keines der drei Praefixe.
 */
function zielstufePasst(title, stufe) {
  if (stufe === "plan") return isPlan(title);
  return !isPlan(title) && !isFachlich(title) && !isIdee(title);
}

/**
 * Ist dieses Dokument in diesem Lauf aus dieser Quelle entstanden (Issue #520)?
 *
 * Zwei Bedingungen, und beide muessen tragen:
 *
 *   1. eine GANZE Zeile `Fachliche Quelle: Issue #N` bzw. `Plan: Issue #M` mit exakt
 *      dieser Nummer. Das Zeilenende hinter der Nummer ist der Kern: Ohne es zaehlte ein
 *      Lauf zu Quelle #40 jedes Dokument aus #408 als sein eigenes Ergebnis. Eine
 *      Erwaehnung im Fliesstext oder in Fettung ist keine Herkunftszeile.
 *   2. die Zielstufe am Titel. Ohne sie unterdrueckten Arbeitspakete eines frueheren
 *      Laufs die Plan-Session, weil sie dieselbe `Fachliche Quelle` tragen — und das
 *      "vorhandene Dokument" waere dann ein Arbeitspaket statt eines Plans.
 *
 * Reine Funktion: Sie beantwortet dieselbe Frage fuer den
 * Fortsetzen-Check VOR der Session und fuer die Backlog-Differenz DANACH — zwei
 * Rechenwege liefen auseinander, und der Lauf legte Dokumente doppelt an.
 */
export function stammtAusErzeugung(issue, quelleId, stufe) {
  // `Object.hasOwn` wie in `erzeugungsEingangsstufe`: 'constructor' als Stufe lieferte
  // sonst eine Funktion statt eines Feldnamens.
  if (!Object.hasOwn(HERKUNFT_FELD, stufe ?? "")) return false;
  if (!zielstufePasst(issue?.title ?? "", stufe)) return false;
  // Nur Ziffern, und die Nummer geht unveraendert in den Ausdruck: Kartennummern sind
  // numerisch, und ein Sonderzeichen aus einer fremden Id wuerde hier zum Metazeichen.
  // Die Session schreibt die Nummer so, wie der Auftrag sie ihr genannt hat — beim
  // lokalen Tracker also mitsamt fuehrenden Nullen.
  const nummer = String(quelleId ?? "");
  if (!/^\d+$/.test(nummer)) return false;
  // `[^\S\n]` statt `\s`: `\s*$` duerfte mit dem m-Flag ueber Zeilenumbrueche laufen und
  // haette das Zeilenende damit wieder aufgeweicht.
  const zeile = new RegExp(
    String.raw`^[^\S\n]*${HERKUNFT_FELD[stufe]}:[^\S\n]*Issue[^\S\n]*#${nummer}[^\S\n]*$`,
    "m",
  );
  return zeile.test(issue?.body || "");
}

/**
 * Die fachliche Wurzel eines Plandokuments (Fachplan #883, Plan #890) — `null` ohne sie.
 *
 * Dieselbe Zeilenform wie in `stammtAusErzeugung`, nur ohne vorgegebene Nummer: Dort
 * wird gefragt „traegt dieses Dokument Quelle #N?", hier „welche Quelle traegt es?".
 * Der Feldname kommt aus `HERKUNFT_FELD.plan`, damit die Schreibweise nicht an zwei
 * Stellen gepflegt wird.
 *
 * Die Nummer geht UNVERAENDERT zurueck, ohne fuehrende Nullen zu streichen: Der lokale
 * Tracker nummeriert `0001`, und eine normalisierte `1` traefe dort keine Karte. Wer
 * vergleicht, vergleicht zeichengleich.
 */
export function fachlicheQuelleVon(body) {
  const zeile = new RegExp(
    String.raw`^[^\S\n]*${HERKUNFT_FELD.plan}:[^\S\n]*Issue[^\S\n]*#(\d+)[^\S\n]*$`,
    "m",
  );
  return zeile.exec(String(body ?? ""))?.[1] ?? null;
}


// --- Die Nacht-Kette (Plan #638; Issue #643) ---
//
// Ein Fachplan geht abends hinein, morgens liegen Plan, Pakete und der Nachtbericht am
// Fachplan vor (#643 bis zum geprueften Plan, #644 Pakete und Abdeckung, #645 Bericht).

// Der Zusatz, der einer Kette-Session die Betriebsart nennt. Massgeblich bleibt allein
// KIT_AGENT_MODEL — der Satz wiederholt es nur an der Stelle, an der es ankommt.
//
// Der zweite Teil ist die Regel aus `CLAUDE-workflow.md` („Keine Session endet mit
// laufender eigener Arbeit", Issue #774), fuer die Stufen-Sessions ausgeschrieben: Sie
// haben keinen Skill, der sie ihnen sagt — `/techplan`, `/issue-review` und `/issues`
// fuehren sie nicht, und die Korrektur- und Abdeckungs-Sessions laufen ohne Skill. Die
// Implementierungs-Runde bekommt den Zusatz ausdruecklich NICHT: Ihre Anweisung steht in
// `implement-next` und `implement-done`, und zwei Orte fuer dieselbe Regel liefen
// auseinander.
//
// Ausnahme ist die Abdeckungs-Session: Sie aendert nichts und gibt ihr Ergebnis als letzte
// Nachricht aus. Der Satz ueber das Board widersprach ihrem Auftrag, darum bekommt sie
// `ABDECKUNG_ZUSATZ` — dieselben Saetze ohne ihn (Issue #1106).
//
// Exportiert fuer die Tests.
export const KETTE_ZUSATZ = "Dieser Lauf ist unbeaufsichtigt: Es sieht niemand zu, und es wird nicht gefragt. "
  + "Schreibe dein Ergebnis ans Board, bevor die Session endet. "
  + "Beende deine Arbeit nicht, solange eine von dir angestossene lange Arbeit laeuft: "
  + "Warte auf ihr Ergebnis oder brich sie ab und melde den Abbruch als Fehlschlag.";
export const ABDECKUNG_ZUSATZ = "Dieser Lauf ist unbeaufsichtigt: Es sieht niemand zu, und es wird nicht gefragt. "
  + "Gib dein Ergebnis als letzte Nachricht aus, bevor die Session endet. "
  + "Beende deine Arbeit nicht, solange eine von dir angestossene lange Arbeit laeuft: "
  + "Warte auf ihr Ergebnis oder brich sie ab und melde den Abbruch als Fehlschlag.";
// Der Anker des Halt-Kommentars am Fachplan.
export const KETTE_HALT_ANKER = "## Kette angehalten";
// Die Routing-Labels der beiden entfallenen Betriebsarten: Wer sie noch setzt, bekommt
// eine Zeile im Protokoll statt einer stillen Nacht (Fachplan #635, Kriterium 12).
const ALTE_ROUTING_LABELS = ["kit:nightreview", "kit:nightplan", "kit:nightissues"];
// Unter dieser Restzeit startet keine Session mehr: Eine Minute reicht fuer keinen Plan.
const KETTE_MINDEST_REST_MS = 60 * 1000;
// Die Ausgaenge einer Stufe und einer Kette (Fachplan #635, Kriterium 2; erweitert um
// `unvollstaendig`, Issue #862). `unvollstaendig` steht zwischen `fertig` und den beiden
// Stoerungen: Die Kette lief durch, hat aber etwas Bestelltes nicht getan. Sie haelt
// niemanden auf — anders als `angehalten` wartet keine Frage auf einen Menschen —, und
// sie ist kein Fehler — anders als `abgebrochen` ist nichts schiefgegangen.
const KETTE_AUSGAENGE = ["fertig", "unvollstaendig", "angehalten", "abgebrochen"];

/**
 * Der Anfang des Grundes, den eine Kette traegt, deren bestellte Umsetzung ausblieb
 * (Issue #862) — woertlich aus dem Arbeitspaket. Exportiert fuer die Tests.
 */
export const UMSETZUNG_AUSGELASSEN_PRAEFIX = "Umsetzung ausgelassen: ";
// Woran der Runner den Halt von /issues erkennt: der Kommentar, den der Skill
// unbeaufsichtigt an den Plan schreibt, wenn er kein Paket anlegt (skills-14).
export const ISSUES_HALT_KOPF = "Kein Eingang für /issues";

/**
 * Der Prompt der Abdeckungs-Session (Plan #638, A9): Sie liest Fachplan, Plan und Pakete,
 * aendert nichts und gibt als letzte Nachricht die Zuordnung zurueck. Ihr Text landet im
 * Ergebnisstand und im Bericht — kein eigener Kommentar, kein Tor (Kriterium 5).
 */
export const ABDECKUNG_PROMPT = [
  "Aendere dabei NICHTS: kein Kommentar, keine Karte, kein Label, keine Datei.",
  "",
  "Gib als letzte Nachricht genau diese drei Abschnitte aus, in Markdown:",
    "",
    "### Zuordnung",
    "Je fachlichem Akzeptanzkriterium des Fachplans eine Zeile: das Kriterium (Nummer und Anfang des Wortlauts) und das Paket oder die Pakete, in denen es abgebildet ist, oder \"kein Paket\".",
    "",
    "### Ohne Paket",
    "Jedes Kriterium, das in keinem Paket abgebildet ist, mit seinem Wortlaut. Sonst der Satz: Alle Kriterien sind abgebildet.",
    "",
  "### Zuwachs",
  "Was in den Paketen steht, ohne im Fachplan zu stehen — je Punkt das Paket und ein Satz. Sonst der Satz: Nichts Zusaetzliches.",
].join("\n");

export function abdeckungPrompt(fachplanId, planId, paketIds) {
  const pakete = paketIds.map((id) => `#${id}`).join(", ");
  return `Du haeltst die Arbeitspakete gegen die fachliche Anforderung. Lies mit \`node .claude/kit/board.mjs issue get <nummer>\` den Fachplan #${fachplanId}, den Plan #${planId} und die Pakete ${pakete}.\n${ABDECKUNG_PROMPT}`;
}

/**
 * Der Grund, aus dem eine gekennzeichnete fachliche Anforderung nicht laeuft — `null`,
 * wenn sie laeuft.
 *
 * Die Reihenfolge ist die Antwort: Erst die Spalte (E4: ausserhalb von Backlog ist ein
 * Versehen), dann `kit:klaeren` (A2: die Antwort auf die Stopp-Frage muss vorher am
 * Fachplan stehen), dann die fehlende Pruefung (Fachplan #702), zuletzt die offenen
 * Fragen an den PO (Issue #916). Die Pruefung steht hinter `kit:klaeren`, damit ein
 * Fachplan mit offener Frage den spezifischeren Grund behaelt: Wer die Frage beantwortet,
 * kommt weiter, wer nur pruefen laesst, nicht.
 *
 * Die Praefix-Probe steht seit Issue #895 NICHT mehr hier, sondern in
 * `waehleKettenKandidaten`: Dort entscheidet sie ueber die Auftragsart, und eine Karte
 * ohne beide Praefixe bekommt dort ihren Grund. Zwei Praefix-Proben — eine je Art —
 * liefen bei der ersten Aenderung auseinander.
 */
function kettenAusschluss(issue, kettenLabel) {
  if (issue.status !== "backlog") return `steht in ${issue.status ?? "unbekannt"}, nicht in Backlog`;
  if (hatKlaerenLabel(issue)) return `traegt ${KLAEREN_LABEL} — die Antwort auf die Stopp-Frage muss vorher am Fachplan stehen, dann das Label abnehmen`;
  if (!hatReviewFertigLabel(issue)) return pruefungFehltGrund(issue.id, kettenLabel).text;
  // Zuletzt die offenen Fragen an den PO (Issue #916): Wer die Pruefung noch gar nicht
  // laufen liess, soll das zuerst erfahren; die Fragen sind der naechste Schritt danach.
  // `review:fertig` bezeugt die Pruefung durch fremde Modelle — die Reviewer duerfen die
  // PO-Fragen ausdruecklich nicht beantworten, also sagt das Label darueber nichts.
  const poFrage = offeneFragenGrund(issue?.body || "");
  if (poFrage !== null) {
    return `${poFrage}; die Fragen im Body beantworten und '## ${PO_FRAGEN_NAME}' auf 'Keine' setzen`;
  }
  return null;
}

/**
 * Der Grund, aus dem ein gekennzeichneter Plan nicht laeuft — `null`, wenn er laeuft
 * (Fachplan #883, Plan #890, E6).
 *
 * Die Reihenfolge folgt derselben Regel wie die von `kettenAusschluss`: Der
 * spezifischere Grund gewinnt, damit die Karte morgens den Satz traegt, der den
 * naechsten Schritt nennt. Erst die Spalte (ausserhalb von Backlog ist ein Versehen),
 * dann die fachliche Herkunft (ohne sie hat die Kette nichts, wogegen sie die Pakete
 * halten koennte), dann `kit:klaeren` (die Entscheidung gehoert in den Plan), dann die
 * offene Frage im Plan, zuletzt die fehlende Pruefung. Die beiden letzten stehen in
 * dieser Folge, weil wer die Frage beantwortet weiterkommt, wer nur pruefen laesst
 * nicht.
 *
 * `karten` ist die Liste aus `issue list`: Die Herkunftsnummer muss eine Karte DIESES
 * Boards treffen, zeichengleich — siehe `fachlicheQuelleVon`.
 */
export function planAusschluss(issue, kettenLabel, karten) {
  if (issue?.status !== "backlog") return `steht in ${issue?.status ?? "unbekannt"}, nicht in Backlog`;
  const quelle = fachlicheQuelleVon(issue?.body || "");
  if (quelle === null || !(karten || []).some((k) => String(k?.id) === quelle)) {
    return `die fachliche Herkunft ist nicht erkennbar — die Zeile '${HERKUNFT_FELD.plan}: Issue #N' fehlt im Plan oder nennt keine Karte dieses Boards (die Nummer wird zeichengleich verglichen, fuehrende Nullen zaehlen mit)`;
  }
  if (hatKlaerenLabel(issue)) return `traegt ${KLAEREN_LABEL} — die Entscheidung gehoert in den Plan, danach nimmt ein Mensch das Label ab`;
  const frage = stoppFragenGrund(issue?.body || "");
  if (frage !== null) {
    return `eine Entscheidung wartet: ${frage}; sie gehoert als Eintrag unter '## ${ENTSCHEIDUNGEN_NAME}' des Plans, danach traegt '## ${OFFENE_FRAGEN_NAME}' wieder '${KEINE_STOPP_FRAGEN}' — ein Satz in der fachlichen Anforderung genuegt nicht`;
  }
  if (!hatReviewFertigLabel(issue)) return pruefungFehltGrund(issue.id, kettenLabel).text;
  return null;
}

/**
 * Der Grund, aus dem Ziel- oder Pruefer-Labels an einer Karte nicht passen — `null`, wenn
 * sie passen (Plan #1243, A9, E3; Issue #1244).
 *
 * `art` ist die Auftragsart aus `auftragsartVon`, `plan` beim Fachplan-Auftrag das
 * Plandokument zur Anforderung (sonst `null`). Die Regeln sind die aus E3, in ihrer
 * Reihenfolge: Widersprueche an der Karte selbst zuerst, dann was an der Kartenart nicht
 * passt. Jeder Grund nennt den naechsten Schritt; die Labels nimmt nur der Mensch ab.
 */
export function zielAusschluss(karte, art, plan) {
  const labels = karte?.labels || [];
  const schritt = "die Karte behaelt ihre Labels";
  const ziele = labels.filter((l) => String(l).startsWith(ZIEL_LABEL_PRAEFIX));
  if (ziele.length > 1) {
    return `${ZIEL_UNPASSEND_PRAEFIX}mehr als ein Ziel (${ziele.join(", ")}) — alle bis auf eines abnehmen; ${schritt}`;
  }
  const pruefer = PLANREVIEW_LABELS.filter((l) => labels.includes(l));
  if (pruefer.length > 1) {
    return `${ZIEL_UNPASSEND_PRAEFIX}${pruefer.join(" und ")} zugleich — eines abnehmen; ${schritt}`;
  }
  if (art === "plan" && labels.includes(`${ZIEL_LABEL_PRAEFIX}plan`)) {
    return `${ZIEL_UNPASSEND_PRAEFIX}${ZIEL_LABEL_PRAEFIX}plan an einem Plandokument — der Plan steht schon; ein weiter reichendes Ziel setzen oder das Label abnehmen; ${schritt}`;
  }
  if (art === "plan" && pruefer.length === 1) {
    return `${ZIEL_UNPASSEND_PRAEFIX}${pruefer[0]} an einem Plandokument — die Prueferzahl gilt nur an der fachlichen Anforderung; das Label abnehmen; ${schritt}`;
  }
  if (art === "fachplan" && pruefer.length === 1 && plan && hatPlanReviewMarker(plan.body || "")) {
    return `${ZIEL_UNPASSEND_PRAEFIX}${pruefer[0]}, aber Plan #${plan.id} ist schon geprueft — das Label abnehmen oder das Kettenlabel an den Plan setzen; ${schritt}`;
  }
  return null;
}

/** Der Grund an einer gekennzeichneten Karte, die keine der beiden Auftragsarten traegt. */
const KEINE_AUFTRAGSART_GRUND = "weder [Fachlich] noch [Plan] — das Kennzeichen gilt an der fachlichen Anforderung oder am Plandokument";

/** Die Auftragsart am Titel-Praefix — `null`, wenn die Karte keine der beiden traegt. */
function auftragsartVon(titel) {
  if (isPlan(titel)) return "plan";
  if (isFachlich(titel)) return "fachplan";
  return null;
}

/**
 * Der Auftrag zu einer Karte: Wurzel und Plannummer stehen je Art woanders.
 *
 * Beim Fachplan-Auftrag ist die Karte selbst die Wurzel und es gibt keinen Plan; beim
 * Plan-Auftrag kommt die Wurzel aus der Herkunftszeile — dass sie dort steht und eine
 * Karte des Boards trifft, hat `planAusschluss` schon geprueft.
 */
function auftragAus(issue, art) {
  return art === "plan"
    ? { karte: issue, art, F: fachlicheQuelleVon(issue.body || ""), planId: String(issue.id) }
    : { karte: issue, art, F: String(issue.id), planId: null };
}

/**
 * Der Grund, aus dem ein Auftrag einer anderen Karte weicht — `null`, wenn er bleibt
 * (Issue #895).
 *
 * Beide Kollisionen haengen am selben Wert: dem juengsten gekennzeichneten Plan zur
 * Wurzel des Auftrags. Eine Anforderung weicht ihm immer, ein Plan nur einem juengeren
 * als er selbst.
 */
function kollisionsGrund(auftrag, juengster) {
  if (juengster === null) return null;
  if (auftrag.art === "fachplan") {
    return `zu dieser Anforderung ist Plan #${juengster.id} gekennzeichnet — er laeuft an ihrer Stelle, ein zweiter Plan entstuende sonst daneben`;
  }
  if (juengster.id !== auftrag.planId) {
    return `zur fachlichen Quelle #${auftrag.F} ist ein juengerer Plan gekennzeichnet — #${juengster.id} laeuft an seiner Stelle`;
  }
  return null;
}

/**
 * Der juengste Plan des Boards zur fachlichen Anforderung `F`, gekennzeichnet oder nicht —
 * `null`, wenn es keinen gibt. Fuer `zielAusschluss`: Ob ein Plan schon geprueft ist, haengt
 * nicht an seinem Kettenlabel.
 */
function juengsterPlanAmBoard(issues, F) {
  return (issues || [])
    .filter((i) => isPlan(i?.title ?? "") && fachlicheQuelleVon(i?.body || "") === String(F))
    .sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;
}

/** Der Ausschluss je Auftragsart, danach die unpassende Einstellung (Issue #1244) — `null`, wenn die Karte laeuft. */
function ausschlussGrund(issue, art, label, issues) {
  const grund = art === "plan" ? planAusschluss(issue, label, issues) : kettenAusschluss(issue, label);
  return grund ?? zielAusschluss(issue, art, art === "fachplan" ? juengsterPlanAmBoard(issues, issue.id) : null);
}

/**
 * Waehlt die Ketten einer Nacht aus allen Karten (Plan #638, A2, A13, E4, W5; zwei
 * Auftragsarten seit Fachplan #883, Plan #890, Issue #895).
 *
 * Reine Funktion ueber `issue list` OHNE Status-Filter: Was das Label traegt, aber nicht
 * laufen darf, geht mit Grund in `uebersprungen` — im Ergebnisstand sichtbar, das Label
 * bleibt stehen. Kandidaten laufen in Listenreihenfolge; ab `max` bleiben sie liegen.
 *
 * Ein Kandidat ist seit #895 kein rohes Issue mehr, sondern ein Auftrag
 * `{ karte, art, F, planId }`: `art` kommt aus dem Titel-Praefix, `F` ist immer die
 * fachliche Wurzel (beim Plan-Auftrag aus `fachlicheQuelleVon`, sonst die Karte selbst),
 * `planId` nur beim Plan-Auftrag. Die Kette braucht beide Nummern — die gekennzeichnete
 * Karte fuer Label und Einheit, die Wurzel fuer Abdeckung und Bericht.
 *
 * Die Kollisionen stehen zwischen Ausschluss und `max` (Kriterium 10 der fachlichen
 * Quelle): Eine Karte, die einer anderen weicht, soll keinen der knappen Plaetze
 * verbrauchen. Massgeblich fuer beide Regeln ist die Menge der GEKENNZEICHNETEN Plaene,
 * nicht die der laufenden — das Kennzeichen hat der Mensch gesetzt, und eine Anforderung
 * soll auch dann nicht ersatzweise neu geplant werden, wenn der Plan daneben an einer
 * eigenen Voraussetzung scheitert.
 *
 * Vor den Kollisionen steht die belegte Wurzel (Plan #1113, E7; Issue #1188): `belegt(F)`
 * liefert den lebenden Halter `{ karte, laufId }` oder `null`, wie `wurzelBelegt`. Auch sie
 * verbraucht keinen Platz.
 */
export function waehleKettenKandidaten(issues, label, max, { belegt = () => null } = {}) {
  const alle = (issues || []).filter((i) => (i?.labels || []).includes(label));
  const gruende = new Map();
  const auftraege = [];

  // Jeder gekennzeichnete Plan mit erkennbarer Wurzel, unabhaengig von seinem Ausschluss.
  const gekennzeichnetePlaene = alle
    .filter((i) => isPlan(i?.title ?? ""))
    .map((i) => ({ id: String(i.id), F: fachlicheQuelleVon(i?.body || "") }))
    .filter((p) => p.F !== null);
  /** Der juengste gekennzeichnete Plan zu einer Wurzel — `null`, wenn es keinen gibt. */
  const juengsterPlanZu = (F) => gekennzeichnetePlaene
    .filter((p) => p.F === F)
    .sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;

  for (const issue of alle) {
    const art = auftragsartVon(issue?.title ?? "");
    if (art === null) {
      gruende.set(String(issue.id), KEINE_AUFTRAGSART_GRUND);
      continue;
    }
    const grund = ausschlussGrund(issue, art, label, issues || []);
    if (grund === null) auftraege.push(auftragAus(issue, art));
    else gruende.set(String(issue.id), grund);
  }

  const kandidaten = [];
  const liegengeblieben = [];
  for (const auftrag of auftraege) {
    const id = String(auftrag.karte.id);
    const halter = belegt(auftrag.F);
    const kollision = kollisionsGrund(auftrag, juengsterPlanZu(auftrag.F));
    if (halter) gruende.set(id, beanspruchtGrund(halter.laufId));
    else if (kollision !== null) gruende.set(id, kollision);
    else if (kandidaten.length >= max) liegengeblieben.push({ id, title: auftrag.karte.title ?? "" });
    else kandidaten.push(auftrag);
  }

  // `uebersprungen` in Board-Reihenfolge, nicht in der Reihenfolge der beiden Durchgaenge:
  // Wer morgens das Protokoll liest, liest es neben dem Board.
  const uebersprungen = alle
    .filter((i) => gruende.has(String(i.id)))
    .map((i) => ({ id: String(i.id), title: i.title ?? "", grund: gruende.get(String(i.id)) }));
  return { kandidaten, uebersprungen, liegengeblieben };
}

/**
 * Der Prompt einer Korrektursession (Plan #638, A7): genau die Verstoesse, nichts sonst.
 */
export function korrekturPrompt(dokId, verstoesse) {
  const liste = (verstoesse || []).map((v) => {
    const gate = v.gate ? `${v.gate}: ` : "";
    return `- ${gate}${v.meldung ?? JSON.stringify(v)}`;
  }).join("\n");
  return [
    `Das Dokument #${dokId} hat die Formpruefung nicht bestanden (\`node .claude/kit/board.mjs issue check-form ${dokId}\`):`,
    liste,
    "",
    `Behebe genau diese Verstoesse im Body von #${dokId}. Lies den Body mit \`node .claude/kit/board.mjs issue get ${dokId}\`,`,
    "schreibe den vollstaendigen korrigierten Body stueckweise in eine Datei ausserhalb des Projektverzeichnisses",
    `und uebertrage ihn mit \`node .claude/kit/board.mjs issue update ${dokId} --body-file <pfad>\`.`,
    "Aendere sonst nichts: keinen Inhalt, keine anderen Karten, keine Dateien im Projekt.",
    "",
    KETTE_ZUSATZ,
  ].join("\n");
}

/** Der Text eines Abschnitts ohne Ueberschrift, fuer den Halt-Kommentar. */
function abschnittText(body, ueberschrift) {
  const abschnitt = abschnittLesen(body, ueberschrift);
  return abschnitt ? abschnitt.zeilen.join("\n").trim() : "";
}

/**
 * Beim lokalen Tracker liegt das Board als Dateien im Repo — im Worktree also als Kopie.
 * Eine Session dort schriebe Karten in den Worktree, und die Hauptkopie saehe nichts.
 * Deshalb zeigt die Config im Worktree auf das issues-Verzeichnis der Hauptkopie
 * (`board.mjs` loest den Pfad mit `resolve` auf, ein absoluter traegt). GitHub, GitLab
 * und Toolbox sind nicht betroffen: Ihr Board liegt nicht im Repo.
 */
export function trackerImWorktreeUmleiten(wt, repoRoot) {
  if (ZUSTAND.config.issueTracker !== "local") return;
  const pfad = join(wt, ".claude", "workflow.config.json");
  if (!existsSync(pfad)) return;
  const wtConfig = JSON.parse(readFileSync(pfad, "utf-8"));
  wtConfig.local = { ...wtConfig.local, issuesDir: resolve(repoRoot, ZUSTAND.config.local?.issuesDir || "issues") };
  writeFileSync(pfad, JSON.stringify(wtConfig, null, 2) + "\n", "utf-8");
}

/**
 * Die eine Stufe ohne Erkennung der wartenden Sitzung (Issue #778).
 *
 * Der Schlusstext der Abdeckung ist kein Abschlussbericht, sondern das Arbeitsergebnis
 * selbst: `stufeAbdeckung` liest ihn mit `leseErgebnisText` als Befundliste ein, und bei
 * einem anderen Ausgang als `fertig` faellt der Befund weg. Ein Befundsatz wie
 * "Kriterium 3: Ergebnis steht noch aus" traefe die Musterliste und liesse die Stufe als
 * wartend abbrechen — der Befund waere verworfen, und zwar genau dann, wenn er etwas zu
 * sagen hat.
 */
const STUFE_OHNE_WARTEND_ERKENNUNG = "abdeckung";

/**
 * Der Vermerk einer wartenden Stufen-Session am Dokument ihrer Stufe (Issue #778).
 *
 * Derselbe Text wie am Arbeitspaket — `wartendVermerk` ist die eine Fassung —, nur OHNE
 * die Pfade aus `gitReste()`: Die Stufen-Session arbeitet im Worktree der Kette, und die
 * Reste der Hauptkopie sagten ueber sie nichts.
 *
 * Ueber eine Datei wie `reviewRestVermerken`, und aus demselben Grund: Der Vermerk traegt
 * bis zu 2.000 Zeichen fremden Schlusstext, und der geht nicht als Argument an eine
 * Kommandozeile.
 */
export function wartendVermerken(dokId, stufe, schlusstext) {
  const pfad = join(tmpdir(), `night-wartend-${process.pid}-${dokId}-${ZUSTAND.LAUF_STEMPEL ?? abh.jetzt().getTime()}.md`);
  writeFileSync(pfad, wartendVermerk(schlusstext), "utf-8");
  try {
    abh.board("issue", "comment", String(dokId), "--text-file", pfad);
    log(`  Stufe ${stufe}: ${GRUND_WARTEND} — Vermerk '${WARTEND_ANKER}' an #${dokId} geschrieben.`);
  } finally {
    rmSync(pfad, { force: true });
  }
}

/**
 * Ob eine Stufen-Session als wartend endet — und wenn ja, mit Vermerk am Dokument der Stufe.
 *
 * Klingt der Schlusstext nach Warten, entscheidet `ergebnisDa` (Issue #1207): Liegt das
 * Ergebnis der Stufe vor, endet die Session nicht als wartend, und eine Protokollzeile
 * sagt, dass der Schlusstext nach Warten klang.
 */
export function wartendBeendet(stufe, schlusstext, dokId, ergebnisDa) {
  if (stufe === STUFE_OHNE_WARTEND_ERKENNUNG || !wartendeSession(schlusstext)) return false;
  if (ergebnisDa?.()) {
    log(`  Stufe ${stufe}: Schlusstext klang nach Warten, das Ergebnis liegt aber vor — die Session gilt als fertig.`);
    return false;
  }
  if (dokId) wartendVermerken(dokId, stufe, schlusstext);
  return true;
}

/**
 * Eine Session der Kette mit Zeit- und Kostenbudget (Plan #638, A5, A6).
 *
 * `stufeStart` und `budgetMs` beschreiben die Stufe: Jede Session bekommt als Timeout,
 * was von der Stufe noch uebrig ist — Korrekturrunden zaehlen gegen dieselbe Stufe.
 * Nach der Session werden die Kosten addiert und gegen das Kettenbudget gehalten; ein
 * Ueberschreiten endet NACH der Session, nicht mittendrin (ein halb geschriebenes
 * Dokument waere der teurere Fehler). Rueckgabe: `{ ausgang, grund, dauerMs, kennzahlen, res }`.
 *
 * `dokId` ist das Dokument der Stufe — der Fachplan, solange es keinen Plan gibt, sonst
 * der Plan oder das Paket in der Formpruefung. Nur eine wartende Sitzung braucht es
 * (Issue #778); eine Stufe ohne Dokument uebergibt nichts und bekommt keinen Vermerk.
 *
 * `ergebnisDa` prueft, ob das Ergebnis der Stufe nach der Session vorliegt (Issue #1207).
 * Aufgerufen wird es nur, wenn der Schlusstext nach Warten klingt: Das Ergebnis ist ein
 * Beleg, der Schlusstext nur ein Indiz. Liefert es `true`, endet die Session `fertig`,
 * ohne Vermerk am Dokument.
 *
 * `extraEnv` geht unveraendert an `runSession` (Plan #1243, A6, A8; Issue #1252). Es traegt
 * nur `KIT_PLAN_REVIEWER` der Review-Stufe; `KIT_NIGHT_RUN` und `KIT_STAND` setzt
 * `runSession` fuer jede Session selbst.
 */
async function ketteSession(kette, stufe, prompt, stufeStart, budgetMs, { dokId = null, ergebnisDa = null, extraEnv } = {}) {
  const rest = budgetMs - (abh.jetzt().getTime() - stufeStart);
  if (rest < KETTE_MINDEST_REST_MS) {
    return { ausgang: "abgebrochen", grund: `Zeitbudget ${stufe} erschoepft, bevor eine weitere Session starten konnte`, dauerMs: 0, kennzahlen: null, sitzungsAbbruch: true };
  }
  const t = abh.jetzt().getTime();
  const res = await runSession(kette.F, kette.args, {
    prompt: `${prompt}\n\n${stufe === "abdeckung" ? ABDECKUNG_ZUSATZ : KETTE_ZUSATZ}`, cwd: kette.wt, stream: true, stufe, timeoutMs: rest,
    ...(extraEnv ? { extraEnv } : {}),
  }, { spawn: abh.spawn, spawnSync: abh.spawnSync });
  const dauerMs = abh.jetzt().getTime() - t;
  const minuten = (dauerMs / 60000).toFixed(1);
  const kennzahlen = leseKennzahlen(res.stdout);
  kostenAddieren(kette.kosten, kennzahlen);
  if (ZUSTAND.LAUF) kostenAddieren(ZUSTAND.LAUF, kennzahlen);
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  if (timedOut) {
    return { ausgang: "abgebrochen", grund: `Zeitbudget ${stufe}: die Session wurde nach ${minuten} min am Limit beendet`, dauerMs, kennzahlen, sitzungsAbbruch: true };
  }
  if (res.umgebungGescheitert) laufAnhalten(`Sitzungsstart der Stufe ${stufe} zu #${kette.F} auch im 2. Versuch gescheitert (${exitText(res)})`);
  if (res.error || res.status !== 0) {
    const exitInfo = exitText(res);
    return { ausgang: "abgebrochen", grund: `technischer Fehler: die Session der Stufe ${stufe} endete mit ${exitInfo}`, dauerMs, kennzahlen, sitzungsAbbruch: true };
  }
  // Die wartende Sitzung (Plan #773, Issue #778) — hinter Zeitbudget und technischem
  // Fehler, weil sie ein REGULAERES Ende verfeinert: Die Session hat eine lange Arbeit
  // angestossen, darauf gewartet und damit ihren Zug beendet. Ohne diesen Zweig zaehlte
  // sie als `fertig`, obwohl sie nichts hinterlassen hat.
  //
  // Vor dem Kostendeckel, weil der Grund der konkretere ist: Eine Kette, die beides
  // zugleich erreicht, soll morgens den Fall benennen und nicht den Betrag.
  if (wartendBeendet(stufe, leseErgebnisText(res.stdout), dokId, ergebnisDa)) {
    // `wartend` reist am Ergebnis mit, statt ueber den Modul-Merker WARTEND_BEENDET zu
    // laufen: Der gehoert einer Implementierungs-RUNDE und wird vor jeder zurueckgesetzt
    // — unter Variante B saehe die Ketten-Einheit sonst den Befund einer Paket-Session.
    return { ausgang: "abgebrochen", grund: GRUND_WARTEND, wartend: true, dauerMs, kennzahlen };
  }
  // Das Kostenbudget wird hier nur gemerkt: Die Stufe verbucht erst, was die Session
  // hinterlassen hat (den Plan, die Korrektur), und bricht dann ab — sonst stuende ein
  // angelegter Plan nicht im Ergebnisstand.
  const deckel = kettenKostendeckel(kette);
  if (kette.kosten.kostenSumme > deckel && !kette.kostenGrund) {
    kette.kostenGrund = `Kostenbudget: ${kette.kosten.kostenSumme.toFixed(2)} $ von ${deckel} $ nach der Stufe ${stufe}`;
  }
  return { ausgang: "fertig", dauerMs, kennzahlen, res };
}

/**
 * Der Kostendeckel DIESER Kette (Plan #691): unter Variante B `kostenUsdB` an der Stelle
 * von `kostenUsd`.
 *
 * Der Deckel gilt der ganzen Kette und nicht nur der Umsetzungsstufe: Eine B-Kette, die
 * in der Plan-Stufe am Deckel einer A-Nacht abbraeche, erreichte die Umsetzung nie — und
 * der groessere Betrag stuende in der Config fuer eine Stufe, die dann nicht laeuft.
 */
function kettenKostendeckel(kette) {
  return kette.variante === "B" ? kette.budget.kostenUsdB : kette.budget.kostenUsd;
}

/** Der Abbruch wegen Kosten — `null`, solange das Budget reicht. */
function kostenErschoepft(kette) {
  return kette.kostenGrund ? { ausgang: "abgebrochen", grund: kette.kostenGrund } : null;
}

/**
 * Stufe Plan: /techplan, Formpruefung mit Korrekturrunden, Stopp-Frage (Plan #638, A7, A8, E2).
 */
async function stufePlan(kette) {
  const { F, budget } = kette;
  const stufeStart = abh.jetzt().getTime();
  const budgetMs = budget.planMin * 60 * 1000;
  const stand = { id: null, dauerMs: 0, kennzahlen: null, korrekturrunden: 0, weitere: [] };
  kette.stufen.plan = stand;
  const summe = (s) => { stand.dauerMs += s.dauerMs; stand.kennzahlen = kennzahlenAddieren(stand.kennzahlen, s.kennzahlen); };

  const vorher = new Set(abh.board("issue", "list").map((i) => String(i.id)));
  log(`  Stufe plan: /techplan #${F} (Budget ${budget.planMin} min).`);
  // Das Ergebnis ist die Herkunftszeile, nicht der Session-Text (E2): nur neue
  // [Plan]-Karten mit `Fachliche Quelle: Issue #F`; bei mehreren die hoechste Nummer.
  const neuePlaene = () => abh.board("issue", "list")
    .filter((i) => !vorher.has(String(i.id)) && stammtAusErzeugung(i, F, "plan"))
    .sort((a, b) => Number(b.id) - Number(a.id));
  // Dokument der Stufe ist der Fachplan: Der Plan entsteht erst in dieser Session.
  const s = await ketteSession(kette, "plan", `/techplan #${F}`, stufeStart, budgetMs, { dokId: F, ergebnisDa: () => neuePlaene().length > 0 });
  summe(s);
  if (s.ausgang !== "fertig") return s;

  const neue = neuePlaene();
  if (neue.length === 0) return { ausgang: "abgebrochen", grund: "kein Plan entstanden — die Session hat kein [Plan]-Dokument mit der Herkunftszeile angelegt" };
  stand.id = String(neue[0].id);
  stand.weitere = neue.slice(1).map((i) => String(i.id));
  const weitere = stand.weitere.length ? ` (weitere: ${stand.weitere.map((i) => "#" + i).join(", ")})` : "";
  log(`  Plan #${stand.id} entstanden aus Issue #${F}${weitere}.`);
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);

  const form = await formSicherstellen(kette, stand, stufeStart, budgetMs, summe);
  if (form !== null) return form;

  // Die Stopp-Frage steht im Plan (A8): `## Offene Fragen` ohne `- Keine.`.
  const body = abh.board("issue", "get", stand.id).body;
  const grund = stoppFragenGrund(body);
  if (grund !== null) {
    return { ausgang: "angehalten", grund: `Stopp-Frage im Plan #${stand.id}`, dokId: stand.id, frage: abschnittText(body, OFFENE_FRAGEN_UEBERSCHRIFT) || grund };
  }
  return { ausgang: "fertig", id: stand.id };
}

/**
 * Formpruefung mit Korrekturrunden (Plan #638, A7) — `null`, wenn die Form gruen ist,
 * sonst der Ausgang der Stufe.
 *
 * Das Kommando sagt "fertig", nicht die Selbstauskunft der Session, obwohl der Skill
 * selbst prueft. Jede Korrekturrunde ist eine frische Session mit genau den Verstoessen;
 * ihre Zeit zaehlt gegen dieselbe Stufe.
 */
async function formSicherstellen(kette, stand, stufeStart, budgetMs, summe) {
  const { budget } = kette;
  for (;;) {
    const form = abh.boardRoh("issue", "check-form", stand.id, { cwd: kette.wt });
    if (!form.json) return { ausgang: "abgebrochen", grund: `technischer Fehler: check-form #${stand.id} lieferte kein JSON (${form.text.slice(0, 200)})` };
    // I8 ist kein Korrekturfall (Plan #987, E15): Die geschuetzte Datei verlangt eine
    // [Mensch]-Karte und eine Teilung, und der korrekturPrompt verbietet beides. Der Verstoss
    // steht im Protokoll, die Karte laeuft ins Gate der Umsetzungsstufe.
    const geschuetzt = (form.json.verstoesse || []).filter((v) => v.gate === "I8");
    const zuKorrigieren = (form.json.verstoesse || []).filter((v) => v.gate !== "I8");
    if (geschuetzt.length > 0) {
      const meldungen = geschuetzt.map((v) => `${v.gate}: ${v.meldung}`).join("; ");
      log(`  Formpruefung #${stand.id}: ${meldungen} — kein Korrekturfall, das Paket haelt in der Umsetzungsstufe an.`);
    }
    if (form.json.ok || zuKorrigieren.length === 0) {
      log(`  Formpruefung #${stand.id} gruen.`);
      // Nur Eintraege mit Baustein und Test sind Testhinweise; Abhaengigkeits-Hinweise der
      // Pakete (Plan #1057 E4) tragen keine und bleiben hier ohne Kommentar (Issue #1059).
      testhinweiseVermerken(stand.id, (form.json.hinweise || []).filter((h) => h.baustein && h.test));
      return null;
    }
    const verstoesse = zuKorrigieren.map((v) => `${v.gate}: ${v.meldung}`).join("; ");
    if (stand.korrekturrunden >= budget.korrekturrunden) {
      return { ausgang: "abgebrochen", grund: `Form nach ${stand.korrekturrunden} Korrekturrunde(n) weiterhin verletzt (#${stand.id}): ${verstoesse}` };
    }
    stand.korrekturrunden++;
    log(`  Formpruefung #${stand.id} rot (${verstoesse}) — Korrekturrunde ${stand.korrekturrunden} von ${budget.korrekturrunden}.`);
    const k = await ketteSession(kette, "form", korrekturPrompt(stand.id, zuKorrigieren), stufeStart, budgetMs, { dokId: stand.id });
    summe(k);
    if (k.ausgang !== "fertig") return k;
    if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  }
}

/** Der Anker des Kommentars mit den Testhinweisen, die nach der Planungssitzung stehen bleiben. */
export const TESTHINWEIS_ANKER = "## Testhinweise der Formpruefung";

/**
 * Die Testhinweise der Formpruefung als Kommentar am Plan (Issue #1033, Plan #1029 A10, E1).
 *
 * Nachts reagiert die planende Sitzung selbst auf die Hinweise; was danach stehen bleibt,
 * schreibt der Runner an den Plan — nicht die Sitzung, damit der Kommentar nicht an ihrer
 * Disziplin haengt. Ein Hinweis haelt nichts an: Scheitert das Kommentieren, steht das im
 * Protokoll, und die Kette laeuft weiter. Pakete koennen Abhaengigkeits-Hinweise tragen
 * (Plan #1057 E4); die sind keine Testhinweise und werden hier nicht vermerkt — der Aufrufer
 * reicht nur Eintraege mit `baustein` und `test` weiter (Issue #1059).
 */
function testhinweiseVermerken(dokId, hinweise) {
  if (!Array.isArray(hinweise) || hinweise.length === 0) return;
  const pfad = join(tmpdir(), `night-testhinweise-${process.pid}-${dokId}-${ZUSTAND.LAUF_STEMPEL ?? abh.jetzt().getTime()}.md`);
  const text = [TESTHINWEIS_ANKER, "", ...hinweise.map((h) => `- ${h.meldung}`), ""].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    const res = abh.boardRoh("issue", "comment", dokId, "--text-file", pfad);
    if (res.status === 0) log(`  ${hinweise.length} Testhinweis(e) als Kommentar '${TESTHINWEIS_ANKER}' an Plan #${dokId} geschrieben.`);
    else log(`  Testhinweise an Plan #${dokId} nicht geschrieben (${res.text.slice(0, 200)}) — die Kette laeuft weiter.`);
  } finally {
    rmSync(pfad, { force: true });
  }
}

/** Der Anker des Vermerks, den ein Abbruch der Review-Stufe am Plandokument hinterlaesst. */
export const REVIEW_REST_ANKER = "## Review unvollstaendig";

/**
 * Der Vermerk am Plan, wenn die Review-Stufe zwischen Befunden und Einarbeitung abbricht
 * (Issue #654).
 *
 * Die Einarbeitung steht am Ende der Stufe, hinter Reviewer-Laeufen und Befunde-Kommentar
 * — ein Abbruch trifft deshalb fast immer genau diese Luecke. Zurueck bleibt der teuerste
 * aller Zustaende: Die Pruefung ist bezahlt, ihre Befunde stehen am Board, der Body ist
 * unveraendert und traegt keinen Marker. Wer das Dokument spaeter sichtet, sieht ein
 * ungeprueftes und prueft erneut; genau so blieb Issue #316 einen Monat lang liegen.
 *
 * Ein groesseres Zeitbudget verschiebt die Grenze, es beseitigt sie nicht — eine Spur am
 * Dokument schon. Sie aendert den Ausgang nicht: Der Abbruch bleibt ein Abbruch mit
 * seinem Grund, die Spur ist Hinweis, kein Zustand.
 */
function reviewRestVermerken(kette, planId, grund) {
  const pfad = join(tmpdir(), `night-review-rest-${process.pid}-${planId}-${ZUSTAND.LAUF_STEMPEL ?? abh.jetzt().getTime()}.md`);
  const text = [
    REVIEW_REST_ANKER,
    "",
    `Kette ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}, Stufe review: Die Pruefung ist gelaufen, ihre Befunde stehen als Kommentar an diesem Dokument.`,
    "",
    `Die Einarbeitung fehlt — der Lauf endete davor (${grund}) —, und der Body ist deshalb unveraendert: Er traegt keinen Plan-Review-Marker, obwohl geprueft wurde.`,
    "",
    `Weg nach vorn: /issue-review #${planId} von Hand fahren.`,
    "",
  ].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    abh.board("issue", "comment", planId, "--text-file", pfad);
    log(`  Review #${planId} abgebrochen, Befunde ohne Einarbeitung — Vermerk '${REVIEW_REST_ANKER}' an Plan #${planId} geschrieben.`);
  } finally {
    rmSync(pfad, { force: true });
  }
}

/**
 * Stufe Review: /issue-review am Plan, Halt an kit:klaeren (Plan #638, A8, A16).
 */
async function stufeReview(kette, planId) {
  const { budget } = kette;
  const stand = { dauerMs: 0, kennzahlen: null, marker: false };
  kette.stufen.review = stand;
  const vorher = abh.board("issue", "get", planId);
  log(`  Stufe review: /issue-review #${planId} (Budget ${budget.reviewMin} min).`);
  // Ergebnis der Stufe ist eine Marker-Zeile, die nach der Session da und anders als vorher
  // ist — neu oder mit neuem Datum (Issue #1207). Das Label `review:fertig` taugt dafuer
  // nicht: Es kann von einer frueheren Pruefung stehen.
  const markerNeu = () => {
    const wert = planReviewWert(abh.board("issue", "get", planId).body);
    return wert !== null && wert !== planReviewWert(vorher.body);
  };
  const s = await ketteSession(kette, "review", `/issue-review #${planId}`, abh.jetzt().getTime(), budget.reviewMin * 60 * 1000, {
    dokId: planId, ergebnisDa: markerNeu, extraEnv: kette.planReviewer ? { KIT_PLAN_REVIEWER: String(kette.planReviewer) } : undefined,
  });
  stand.dauerMs = s.dauerMs;
  stand.kennzahlen = s.kennzahlen;
  if (s.ausgang !== "fertig") {
    // Auch beim Abbruch wird nachgesehen, was in der bezahlten Zeit entstanden ist.
    const rest = abh.board("issue", "get", planId);
    stand.marker = hatPlanReviewMarker(rest.body);
    // Der eigene Vermerk der wartenden Sitzung zaehlt hier nicht (Issue #778): Er ist in
    // genau diesem Zweig kurz zuvor an den Plan gegangen, und ohne den Ausschluss
    // behauptete die Spur daneben, es lägen Reviewer-Befunde am Dokument.
    const fremde = neueKommentare(vorher, rest).filter((k) => !String(k).includes(WARTEND_ANKER));
    if (!stand.marker && fremde.length > 0) reviewRestVermerken(kette, planId, s.grund);
    return s;
  }
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  const nachher = abh.board("issue", "get", planId);
  stand.marker = hatPlanReviewMarker(nachher.body);
  if (hatKlaerenLabel(nachher)) {
    const neue = neueKommentare(vorher, nachher);
    return { ausgang: "angehalten", grund: `Stopp-Frage aus dem Review von #${planId}`, dokId: planId, frage: neue.at(-1) ?? `siehe den letzten Kommentar an #${planId}` };
  }
  log(`  Review #${planId} durch${stand.marker ? ", Marker gesetzt" : ""}.`);
  return { ausgang: "fertig" };
}

/**
 * Stufe Pakete: /issues am Plan, Formpruefung je Paket, Halt am Kommentar (Plan #638, A7, E2).
 *
 * Ergebnis sind nur Karten mit `Plan: Issue #M` (E2); andere neue Karten stehen als
 * `nichtZuordenbar` in der Einheit. Kein Paket und ein Kommentar `Kein Eingang für
 * /issues` am Plan heisst angehalten; kein Paket ohne den Kommentar heisst abgebrochen.
 */
async function stufePakete(kette, planId) {
  const { budget } = kette;
  const stufeStart = abh.jetzt().getTime();
  const budgetMs = budget.paketeMin * 60 * 1000;
  const stand = { ids: [], nichtZuordenbar: [], dauerMs: 0, kennzahlen: null, korrekturrunden: 0 };
  kette.stufen.pakete = stand;
  const summe = (s) => { stand.dauerMs += s.dauerMs; stand.kennzahlen = kennzahlenAddieren(stand.kennzahlen, s.kennzahlen); };

  const vorherIds = new Set(abh.board("issue", "list").map((i) => String(i.id)));
  const vorherPlan = abh.board("issue", "get", planId);
  log(`  Stufe pakete: /issues #${planId} (Budget ${budget.paketeMin} min).`);
  const paketeEntstanden = () => abh.board("issue", "list").some((i) => !vorherIds.has(String(i.id)) && stammtAusErzeugung(i, planId, "issue"));
  const s = await ketteSession(kette, "pakete", `/issues #${planId}`, stufeStart, budgetMs, { dokId: planId, ergebnisDa: paketeEntstanden });
  summe(s);
  if (s.ausgang !== "fertig") return s;

  const neue = abh.board("issue", "list").filter((i) => !vorherIds.has(String(i.id)));
  const pakete = neue.filter((i) => stammtAusErzeugung(i, planId, "issue"));
  stand.ids = pakete.map((i) => String(i.id));
  stand.nichtZuordenbar = neue.filter((i) => !stammtAusErzeugung(i, planId, "issue")).map((i) => String(i.id));
  if (stand.nichtZuordenbar.length > 0) {
    log(`  Neue Karten ohne Herkunftszeile 'Plan: Issue #${planId}', nicht zuordenbar: ${stand.nichtZuordenbar.map((i) => "#" + i).join(", ")}.`);
  }
  if (pakete.length === 0) {
    const nachherPlan = abh.board("issue", "get", planId);
    const halt = neueKommentare(vorherPlan, nachherPlan).find((k) => String(k).startsWith(ISSUES_HALT_KOPF));
    if (halt) {
      return { ausgang: "angehalten", grund: `Stopp-Frage beim Schneiden von #${planId}`, dokId: planId, frage: halt };
    }
    return { ausgang: "abgebrochen", grund: `kein Paket entstanden — die Session hat keine Karte mit 'Plan: Issue #${planId}' angelegt` };
  }
  log(`  Pakete aus Plan #${planId}: ${stand.ids.map((i) => "#" + i).join(", ")}.`);
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);

  // Formpruefung je Paket, mit demselben Korrekturbudget je Dokument wie beim Plan.
  for (const id of stand.ids) {
    const paketStand = { id, korrekturrunden: 0 };
    const form = await formSicherstellen(kette, paketStand, stufeStart, budgetMs, summe);
    stand.korrekturrunden += paketStand.korrekturrunden;
    if (form !== null) return form;
  }
  return { ausgang: "fertig", ids: stand.ids };
}

/**
 * Stufe Abdeckung: eine lesende Session haelt die Pakete gegen den Fachplan (Plan #638, A9).
 *
 * Ihr Text kommt aus dem `result`-Ereignis. Zeitbudget, Fehlstart oder fehlender Text
 * lassen die Kette trotzdem `fertig` enden — die Abdeckung ist eine Auskunft, kein Tor
 * (Kriterium 5); der Grund steht an der Stufe. Nur das Kostenbudget bricht ab.
 */
async function stufeAbdeckung(kette, fachplanId, planId, paketIds) {
  const { budget } = kette;
  const stand = { dauerMs: 0, kennzahlen: null, text: null };
  kette.stufen.abdeckung = stand;
  const vorherKarten = abh.board("issue", "list").length;
  const vorherFachplan = abh.board("issue", "get", fachplanId);
  log(`  Stufe abdeckung: Pakete gegen Fachplan #${fachplanId} (Budget ${budget.abdeckungMin} min).`);
  const s = await ketteSession(kette, "abdeckung", abdeckungPrompt(fachplanId, planId, paketIds), abh.jetzt().getTime(), budget.abdeckungMin * 60 * 1000);
  stand.dauerMs = s.dauerMs;
  stand.kennzahlen = s.kennzahlen;
  if (s.ausgang !== "fertig") {
    stand.grund = s.grund;
    log(`  Abdeckung ohne Text: ${s.grund}.`);
    return { ausgang: "fertig" };
  }
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  stand.text = leseErgebnisText(s.res.stdout);
  if (stand.text === null) {
    stand.grund = "die Abdeckungs-Session lieferte keinen Text";
    log(`  Abdeckung ohne Text: ${stand.grund}.`);
  }
  // Der Prompt verbietet Schreiben; ein Verstoss ist ein Befund fuer den Morgen, kein
  // Grund, die Pakete zu verwerfen.
  const nachherKarten = abh.board("issue", "list").length;
  const nachherFachplan = abh.board("issue", "get", fachplanId);
  if (nachherKarten !== vorherKarten || neueKommentare(vorherFachplan, nachherFachplan).length > 0) {
    kette.abdeckungSchrieb = true;
    log("  Hinweis: die Abdeckungs-Session hat am Board geschrieben, obwohl sie nur lesen soll — steht im Ergebnisstand.");
  }
  return { ausgang: "fertig" };
}

// --- Stufe Umsetzung, nur unter Variante B (Plan #691, E4-E8, E11, E14, E16-E18) ---

/** Der Kommentar an einem selbst gezogenen Paket, das nicht in In review endet (E7). */
const UMSETZUNG_RUECKSTELLUNG = "Nacht-Kette, Variante B: Der Runner hatte dieses Paket fuer die Umsetzungsstufe "
  + "selbst nach Ready gezogen; die Runde endete nicht in In review. Es geht zurueck nach Backlog — ein Paket in "
  + "Ready waere fuer die naechste Nacht und fuer /implement-ready ein GO, das niemand gegeben hat.";

/** Der Grund, mit dem ein bereits von der Session zurueckgelegtes Paket im Bericht steht. */
const UMSETZUNG_SCHON_ZURUECK = "die Runde endete ohne In-review-Ergebnis; die Session hatte das Paket selbst zurueckgelegt";

/**
 * Bucht die Kosten der eben gelaufenen Runde auf die Kette.
 *
 * Die Kennzahlen stehen in der Einheit, die `laufeRunde` ohnehin anlegt — der
 * Session-Strom wird kein zweites Mal gelesen, und `laufeRunde` bleibt unveraendert (E8).
 * Ohne Ergebnisstand zaehlt die Runde als nicht gemessen, wie jede Session ohne Kennzahl.
 */
function rundeVerbuchen(kette, id) {
  const einheit = ZUSTAND.LAUF?.einheiten.findLast((e) => e.id === String(id));
  kostenAddieren(kette.kosten, einheit?.kennzahlen);
}

/**
 * Der Endstand jedes selbst gezogenen Pakets — die Rueckstellpflicht aus E7.
 *
 * Genau eine Stelle entscheidet, in welche Liste ein gezogenes Paket faellt, und sie
 * fragt dafuer das Board, nicht den Rueckgabewert der Runde: Sie laeuft auch nach einem
 * Wurf und nach einem harten Stopp, wo es keinen Rueckgabewert gibt.
 *
 * Was in Backlog liegt, bleibt liegen — ein angehaltenes Paket hat die Session selbst
 * dorthin geschoben und kommentiert, ein zweiter Kommentar waere die zweite Wahrheit
 * ueber denselben Vorgang. Pakete, die der Runner nicht gezogen hat, sind hier nie
 * dabei. `boardRoh` statt `board`: Ein toter Tracker darf diesen Aufraeumschritt nicht
 * in einen Prozessabbruch verwandeln, der den eigentlichen Fehler verschluckt.
 *
 * Ein umgesetztes Paket traegt zusaetzlich `stufe`, `stufeVerwendet` und `modell` —
 * dieselben Werte, die `laufeRunde` in der Paket-Einheit ablegt (Issue #713). Die
 * Paket-Einheit steht in `LAUF.einheiten`; ohne sie (Dry-Run, toter Ergebnisstand)
 * tragen alle drei `null`.
 */
function paketeAbschliessen(stand, gezogen) {
  for (const id of gezogen) {
    const status = leseKarte(id)?.status ?? null;
    if (status === "in_review") {
      const einheit = ZUSTAND.LAUF?.einheiten.findLast((e) => e.id === String(id));
      stand.umgesetzt.push({
        id, stufe: einheit?.stufe ?? null, stufeVerwendet: einheit?.stufeVerwendet ?? null, modell: einheit?.modell ?? null,
        effort: einheit?.effort ?? null,
      });
      continue;
    }
    if (stand.angehalten.includes(id)) continue;
    if (status === "backlog") {
      stand.zurueckgestellt.push({ id, grund: UMSETZUNG_SCHON_ZURUECK });
      continue;
    }
    stand.zurueckgestellt.push({ id, grund: `die Runde endete in ${status ?? "unbekanntem Zustand"} statt in In review` });
    abh.boardRoh("issue", "comment", id, "--text", UMSETZUNG_RUECKSTELLUNG);
    const move = abh.boardRoh("issue", "move", id, "backlog");
    log(move.status === 0
      ? `  Paket #${id} nach Backlog zurueckgestellt — es steht nicht in In review.`
      : `  Paket #${id} liess sich nicht zurueckstellen (${move.text.slice(0, 200)}) — bitte morgens sichten.`);
  }
}

/** Die nicht begonnenen Pakete ueber alle Ketten des Laufs — fuer die Schlusszeile (Issue #1170). */
let NICHT_BEGONNEN_GESAMT = 0;

/** Die offenen Menschenschritte ueber alle Ketten des Laufs — fuer die Schlusszeile (Issue #1281). */
const MENSCHENSCHRITTE_OFFEN = new Set();

/**
 * Fuehrt Pakete als nicht begonnen mit ihrem Grund — im Bericht und im Protokoll. `zusatz`
 * traegt, was `wartendeMenschenschritte` liest (Issue #1281): `mensch` beim Menschenschritt,
 * `unmet` bei unerfuellten Abhaengigkeiten.
 */
function paketeNichtBegonnen(stand, ids, grund, zusatz = {}) {
  for (const id of ids) {
    stand.nichtBegonnen.push({ id: String(id), grund, ...zusatz });
    NICHT_BEGONNEN_GESAMT++;
    if (zusatz.mensch) MENSCHENSCHRITTE_OFFEN.add(String(id));
    log(`  Paket #${id} nicht begonnen: ${grund}.`);
  }
}

/**
 * Was ein Gate fuer `wartendeMenschenschritte` am Eintrag hinterlaesst (Issue #1281): den
 * Menschenschritt an derselben Pruefung wie das Gate, nicht am Grundtext, sonst die
 * unerfuellten Abhaengigkeiten.
 */
function gateZusatz(karte, gate) {
  if (isMensch(karte.title)) return { mensch: true };
  return gate.unmet ? { unmet: gate.unmet.map(String) } : {};
}

/**
 * Der Grund, aus dem vor dem naechsten Paket keine Session mehr startet — `null`,
 * solange beide Budgets reichen.
 *
 * Die Mindestrestzeit ist dieselbe wie bei den erzeugenden Stufen: Was darunter liegt,
 * reicht fuer kein Arbeitspaket, und eine Session, die sofort ins Limit laeuft, kostet
 * nur. Der Kostendeckel ist unter Variante B `kostenUsdB`.
 */
function umsetzungBudgetGrund(kette, lauf) {
  const restMs = lauf.budgetMs - (abh.jetzt().getTime() - lauf.stufeStart);
  if (restMs < KETTE_MINDEST_REST_MS) {
    return `Zeitbudget umsetzung (${kette.budget.umsetzungMin} min) erschoepft, bevor eine weitere Session starten konnte`;
  }
  const deckel = kettenKostendeckel(kette);
  if (kette.kosten.kostenSumme > deckel) {
    return `Kostenbudget: ${kette.kosten.kostenSumme.toFixed(2)} $ von ${deckel} $ erschoepft`;
  }
  return null;
}

/**
 * Der Vermerk am Paket, das auf einen Push wartet (Issue #1170) — sonst saehe der Mensch am
 * Board nur ein ausgelassenes Paket. Je Lauf hoechstens einer: Traegt der letzte Kommentar
 * der Karte schon denselben Vermerk, liefert die Funktion `null`.
 */
export function pushVermerk(karte, verweise) {
  const text = `Nachtlauf: Paket wartet auf einen Push (${verweise}). Nach \`push main\` kann es nach Ready gezogen werden.`;
  return kommentareVon(karte).at(-1)?.trim() === text ? null : text;
}

/** Schreibt den Push-Vermerk an die Karte; ein Fehlschlag haelt den Lauf nicht an. */
function wartenAmBoardVermerken(karte, verweise) {
  const text = pushVermerk(karte, verweise);
  if (text === null) return;
  const res = abh.boardRoh("issue", "comment", String(karte.id), "--text", text);
  if (res.status !== 0) log(`  Paket #${karte.id}: Push-Vermerk nicht geschrieben (${res.text.slice(0, 200)}) — bitte morgens sichten.`);
}

/**
 * Ein Paket der Stufe umsetzung: pruefen, ziehen, Runde fahren, verbuchen.
 *
 * Rueckgabe ist `null`, solange die Stufe weiterlaufen kann — sonst der Grund ihres
 * Abbruchs. Das Paket wird erst UNMITTELBAR vor seiner Session gezogen (E5), und die
 * Gates laufen VOR dem Zug (E6): Ein angehaltenes oder gescheitertes Paket steht in
 * Backlog, damit ist jede `Issue #N`-Referenz auf es unerfuellt und die abhaengigen
 * fallen hier von selbst heraus. Bei `issueReview.requiredBeforeReady` faellt so jedes
 * Paket heraus und die Kette auf Variante A zurueck (E18).
 */
async function umsetzePaket(kette, id, lauf, zaehler) {
  const karte = leseKarte(id);
  if (!karte) {
    paketeNichtBegonnen(lauf.stand, [id], "die Karte war am Board nicht lesbar");
    return null;
  }
  const gate = pruefeIssueGates(karte);
  if (gate) {
    // Am Board wie im Einzellauf (E9, E14), nur ohne Move — das Paket steht schon in
    // Backlog. Der Bericht fuehrt es zusaetzlich als nicht begonnen.
    if (gate.art === "geschuetzt") {
      log(gate.log);
      geschuetztAmBoardVermerken(karte, gate);
    } else if (gate.unmet) {
      const text = gate.block ? `${gate.kommentar}\n\n${gate.block}` : gate.kommentar;
      const res = abh.boardRoh("issue", "comment", id, "--text", text);
      if (res.status !== 0) log(`  Paket #${id}: Abhaengigkeits-Kommentar nicht geschrieben (${res.text.slice(0, 200)}) — bitte morgens sichten.`);
    }
    paketeNichtBegonnen(lauf.stand, [id], gate.kommentar.replace(/^Nachtlauf:\s*/, ""), gateZusatz(karte, gate));
    return null;
  }
  // Wartet das Paket auf einen Push (Issue #1104), zieht die Kette es nicht nach Ready: Es
  // bleibt sichtbar wartend in Backlog, und Pakete, die von ihm abhaengen, fallen ueber
  // ihre Gates von selbst heraus.
  const push = wartetAufPush(karte.body);
  if (push.length > 0) {
    const verweise = push.map((n) => "Issue #" + n).join(", ");
    paketeNichtBegonnen(lauf.stand, [id], `wartet auf einen Push (${verweise})`);
    wartenAmBoardVermerken(karte, verweise);
    return null;
  }

  abh.board("issue", "move", id, "ready");
  lauf.gezogen.add(id);
  log(`  Paket #${id} nach Ready gezogen — Session ${zaehler} der Stufe umsetzung.`);
  // Test-Hook wie NIGHT_MELDEN_ERZWINGEN: Von aussen laesst sich hier sonst keine
  // Ausnahme ausloesen, und der Wurf-Pfad der Rueckstellpflicht bliebe ungeprueft —
  // genau der Pfad, der ein Paket in Ready zuruecklassen wuerde.
  if (process.env.NIGHT_KETTE_WURF === id) throw new Error(`Test-Hook NIGHT_KETTE_WURF bei Paket #${id}`);

  const ausgang = await laufeRunde({ id, title: karte.title, labels: karte.labels }, kette.args, lauf.salvageAttempted, lauf.pruefungen);
  rundeVerbuchen(kette, id);
  if (ausgang === "angehalten") {
    lauf.stand.angehalten.push(id);
    // Die Art je Paket (Issue #1050): Stufengrund und Bericht nennen sie.
    lauf.stand.haltArten[id] = rundenMerker().haltArt ?? "klaeren";
  }
  return ausgang === "hardStop" ? `Stufe umsetzung: harter Stopp in der Runde zu Paket #${id}` : null;
}

/**
 * Der Stufengrund einer Umsetzung mit angehaltenen Paketen, je Art des Halts (Issue #1050,
 * E12) — dazu die Art der Stufe: `klaeren`, sobald ein Paket an einer Stopp-Frage haelt,
 * sonst `geschuetzt`. Ein Paket ohne vermerkte Art (Stand von vor #1050) zaehlt als
 * Stopp-Frage, wie es damals verbucht wurde.
 */
export function umsetzungHaltGrund(stand) {
  const art = (id) => stand.haltArten?.[id] ?? "klaeren";
  const teile = [];
  for (const [a, text] of [["klaeren", "haelt an einer Stopp-Frage"], ["geschuetzt", "haelt an einer geschuetzten Datei"]]) {
    const ids = stand.angehalten.filter((id) => art(id) === a);
    if (ids.length > 0) teile.push(`${ids.map((id) => "#" + id).join(", ")} ${text}`);
  }
  return {
    grund: `Stufe umsetzung: ${teile.join("; ")}`,
    haltArt: stand.angehalten.some((id) => art(id) === "klaeren") ? "klaeren" : "geschuetzt",
  };
}

/** Die Pakete der Reihe nach (E16), bis eines hart stoppt oder ein Budget endet. */
async function umsetzungSchleife(kette, paketIds, lauf) {
  for (let i = 0; i < paketIds.length; i++) {
    const budgetGrund = umsetzungBudgetGrund(kette, lauf);
    if (budgetGrund) {
      paketeNichtBegonnen(lauf.stand, paketIds.slice(i), budgetGrund);
      break;
    }
    const stopp = await umsetzePaket(kette, String(paketIds[i]), lauf, `${i + 1}/${paketIds.length}`);
    if (stopp) {
      paketeNichtBegonnen(lauf.stand, paketIds.slice(i + 1), "der Lauf ist an einem frueheren Paket hart gestoppt");
      return { ausgang: "abgebrochen", grund: stopp };
    }
  }
  return { ausgang: "fertig" };
}

/**
 * Stufe Umsetzung: die Pakete des gekennzeichneten Fachplans in derselben Nacht bauen.
 *
 * Sie baut zuerst den Worktree ab und arbeitet in der Hauptkopie (E4) — seine Commits
 * traegen kein Ref und waeren am Morgen verloren. Die Pakete kommen aus
 * `kette.stufen.pakete.ids` (E16); gewertet wird mit `laufeRunde` unveraendert (E8), und
 * die Session erfaehrt von der Variante nichts — sie sieht ein regulaeres Ready-Paket (E11).
 *
 * Ausgaenge: `fertig` auch bei erschoepftem Zeit- oder Kostenbudget (E14, die uebrigen
 * Pakete stehen als nicht begonnen im Bericht), `unvollstaendig` bei einem Umsetzungs-Lock,
 * der bis zum Ende des Umsetzungsbudgets gehalten blieb (Issue #696, #1185, der Rueckfall
 * auf Variante A), und bei einer unsauberen
 * Hauptkopie vor dem ersten Paket (Issue #878, derselbe Rueckfall) — beide liefen gar
 * nicht erst an, siehe `umsetzungAusgelassen` (Issue #862) —, `angehalten` bei mindestens
 * einem angehaltenen Paket — aber ohne `haltAmAuftrag` (E17) —, `abgebrochen` nur beim
 * harten Stopp.
 */
/**
 * Die Stufe umsetzung hat ihre Arbeit ausgelassen (Issue #862) — der gemeinsame Ausgang
 * der beiden Rueckfaelle auf Variante A: gehaltener Lock und unsaubere Hauptkopie.
 *
 * Beide sind aus Sicht des Menschen derselbe Befund: Er hat abends "zieh die Pakete gleich
 * durch" bestellt, und die Bestellung wurde nicht ausgefuehrt. Sie auseinanderzuziehen
 * ergaebe zwei Wahrheiten ueber eine Lage; was sie unterscheidet, steht im `grund`.
 *
 * `stand.ausgelassen` ist der Befund fuer den Bericht — nur daran, nicht an einer leeren
 * `umgesetzt`-Liste, ist "gar nicht erst gelaufen" von "gelaufen und nichts geschafft" zu
 * unterscheiden.
 */
function umsetzungAusgelassen(kette, stand, paketIds, stufeStart, grund, zusatz = "") {
  paketeNichtBegonnen(stand, paketIds, grund);
  stand.ausgelassen = grund;
  stand.dauerMs = abh.jetzt().getTime() - stufeStart;
  log(`  Stufe umsetzung ausgelassen: ${grund} — Rueckfall auf Variante A, die Pakete bleiben in Backlog.${zusatz}`);
  return { ausgang: "unvollstaendig", grund: `${UMSETZUNG_AUSGELASSEN_PRAEFIX}${grund}` };
}

async function stufeUmsetzung(kette, paketIds) {
  const { budget } = kette;
  const stufeStart = abh.jetzt().getTime();
  const stand = { umgesetzt: [], angehalten: [], haltArten: {}, zurueckgestellt: [], nichtBegonnen: [], dauerMs: 0 };
  kette.stufen.umsetzung = stand;
  const lauf = {
    stand, gezogen: new Set(), salvageAttempted: new Set(), pruefungen: [],
    stufeStart, budgetMs: budget.umsetzungMin * 60 * 1000,
  };

  // Der Lock steht vor allem anderen — auch vor dem Worktree-Abbau und vor dem
  // Sauberkeits-Guard. Haelt ihn ein lebender Lauf, verhaelt sich die Kette wie eine unter
  // Variante A und laesst den Worktree bis zu ihrem eigenen Ende stehen. Und eine
  // Hauptkopie, in der gerade ein anderer Lauf baut, ist erwartbar unsauber: Der Lock ist
  // dafuer die genauere Auskunft als "nicht sauber" und der freundlichere Ausgang.
  // Belegt wartet die Kette im Rahmen ihres Umsetzungsbudgets darauf (E10).
  const lock = await aufUmsetzungWarten({
    nehmen: () => umsetzungLockNehmen(kette.repoRoot),
    jetzt: Date.now,
    schlafen: abh.schlafen,
    budgetMs: lauf.budgetMs,
    standSetzen: (zustand, text) => ketteStand(kette, zustand, text),
  });
  if (!lock.ok) return umsetzungAusgelassen(kette, stand, paketIds, stufeStart, lock.grund);
  if (lock.hinweis) log(`  ${lock.hinweis}`);

  try {
    if (kette.wt) {
      befundeZurueckUndVorschlagen(kette);
      worktreeEntfernen(kette.wt, kette.repoRoot);
      kette.wt = null;
      log(`  Worktree abgebaut — die Stufe umsetzung baut in der Hauptkopie ${kette.repoRoot}.`);
    }
    // Variante B baut in der Hauptkopie: Auch dort arbeiten die Sessions mit dem festen
    // Kit-Stand (Issue #1102, A3). Die Markierung ist vom Sauberkeits-Guard ausgenommen.
    kitStandInBaum(kette.repoRoot);
    log(`  Stufe umsetzung: ${paketIds.length} Paket(e) (Budget ${budget.umsetzungMin} min, Kostendeckel ${kettenKostendeckel(kette)} $).`);

    // Einmal vor dem ersten Paket: Was die Sessions selbst hinterlassen, pruefen danach
    // Rest-Guard und Dirty-Guard in `werteRunde`.
    //
    // Ausgang `unvollstaendig` wie beim gehaltenen Lock darueber (Issue #878, #862): Eine
    // unsaubere Hauptkopie ist kein technischer Fehler, sondern ein Zustand, den nur ein
    // Mensch bereinigen kann. Die Arbeitspakete stehen fertig da, sie lassen sich heute
    // nacht nur nicht bauen — derselbe Rueckfall auf Variante A, und derselbe Ausgang.
    if (!abh.gitClean(kette.repoRoot)) {
      const grund = `die Hauptkopie ist vor dem ersten Paket nicht sauber (${resteText(abh.gitReste(kette.repoRoot))})`;
      return umsetzungAusgelassen(kette, stand, paketIds, stufeStart, grund,
        " Bitte bereinigen und die Pakete selbst nach Ready ziehen.");
    }

    let ergebnis;
    try {
      ergebnis = await umsetzungSchleife(kette, paketIds, lauf);
    } finally {
      // Auch nach einem Wurf: Die Rueckstellpflicht ist der Grund fuer dieses finally.
      paketeAbschliessen(stand, lauf.gezogen);
      stand.dauerMs = abh.jetzt().getTime() - stufeStart;
      for (const zeile of pruefBericht(lauf.pruefungen, ZUSTAND.LAUF?.einheiten ?? [], ZUSTAND.config?.night?.zielUmsetzungMin)) log(`  ${zeile}`);
    }
    if (ergebnis.ausgang === "fertig" && stand.angehalten.length > 0) {
      // Das kit:klaeren traegt bereits das Paket; ein zweites am Fachplan schloesse ihn aus
      // `waehleKettenKandidaten` aus und blockierte die naechste Kette (E17).
      return { ausgang: "angehalten", ...umsetzungHaltGrund(stand), ohneHaltAmFachplan: true };
    }
    return ergebnis;
  } finally {
    // Auch nach einem Wurf aus der Stufe heraus: Ein liegengebliebener Lock haelt die
    // naechste Nacht ab, bis sein Prozess als tot erkannt wird.
    lock.freigeben();
    kitStandAbgeben(kette.repoRoot);
  }
}

/** Der Grund, der im Bericht hinter einem nicht bestaetigten Ueberholt-Kommentar steht. */
export const UEBERHOLT_UNBESTAETIGT_GRUND = "der Kommentar wurde geschrieben, war danach aber an der Karte nicht auffindbar";

/**
 * Aeltere Plandokumente zum selben Fachplan sind mit dem neuen Plan ueberholt (Plan
 * #638, A8): ein Kommentar je Karte, kein Label, kein Move.
 *
 * Jeder Kommentar wird danach einmal zurueckgelesen (Issue #653). Ein erfolgreicher
 * POST ist kein Beweis, dass der Kommentar am Board steht — am 2026-09-14 fehlte er an
 * Plan #577, obwohl der Bericht ihn auswies. Ein Bericht, der eine Handlung behauptet,
 * die niemand sieht, ist schlimmer als keiner: Wer ihn liest, sieht nicht nach.
 *
 * Nicht bestaetigt heisst getrennt ausweisen, nicht abbrechen: Der Kommentar ist
 * Hinweis, kein Gate. Rueckgabe sind beide Listen — die Funktion setzt nichts an
 * `kette`, sie wird an genau einer Stelle gerufen.
 */
function aeltereUeberholen(kette, aeltere, neuerPlan) {
  const ueberholt = [];
  const ueberholtUnbestaetigt = [];
  for (const id of aeltere) {
    // Der Anker steht am Zeilenanfang des geschriebenen Textes und traegt den
    // Kettenstempel nicht — er bleibt ueber Laeufe hinweg wiedererkennbar.
    const anker = `Ueberholt durch Plan #${neuerPlan}`;
    abh.board("issue", "comment", id, "--text", `${anker} (Kette ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}). Die naechste Kette begann von vorn; dieser Entwurf bleibt nur als Verlauf.`);
    if (kommentareVon(abh.board("issue", "get", id)).some((k) => k.includes(anker))) {
      ueberholt.push(id);
      log(`  Plan #${id} als ueberholt kommentiert (neuer Plan #${neuerPlan}).`);
    } else {
      ueberholtUnbestaetigt.push({ id, grund: UEBERHOLT_UNBESTAETIGT_GRUND });
      log(`  Plan #${id}: der Ueberholt-Kommentar ist am Board nicht auffindbar — im Bericht als nicht bestaetigt gefuehrt.`);
    }
  }
  return { ueberholt, ueberholtUnbestaetigt };
}

/**
 * Der Weg nach vorn im Halt-Kommentar: die Schritte, nach denen der Plan am naechsten
 * Abend als Plan-Auftrag wieder anlaeuft (Issue #896).
 *
 * Der Ort der Entscheidung ist seit Issue #895 der Plan, nicht die fachliche Anforderung:
 * Die naechste Kette uebernimmt das Dokument und faehrt von der Stufe `pakete` an weiter,
 * statt von vorn zu beginnen. Die Schritte nennen darum genau die Form, die
 * `planAusschluss` wieder durchlaesst.
 *
 * Der frueher hier stehende Satz "Antwort bitte in den Fachplan schreiben" fuehrte an
 * diesem Weg vorbei — und der naheliegende Griff, die Antwort unter die Frage zu setzen,
 * war der teuerste: `stoppFragenGrund` liest die erste nichtleere Zeile unter `## Offene
 * Fragen` und liesse den Plan allein bei `- Keine.` durch. Der Antworttext selbst waere
 * am naechsten Abend der Ausschlussgrund gewesen.
 *
 * `/issue-review` entfaellt beim Plan-Auftrag: Dort traegt der Plan sein
 * `review:fertig` schon, sonst haette `planAusschluss` ihn nie als Auftrag durchgelassen.
 */
function haltWegNachVorn(kette, planId) {
  const P = `Plan #${planId}`;
  const schritte = [
    `1. Die Antwort als Eintrag unter '## ${ENTSCHEIDUNGEN_NAME}' von ${P} schreiben.`,
    `2. '## ${OFFENE_FRAGEN_NAME}' von ${P} wieder auf '${KEINE_STOPP_FRAGEN}' setzen (ein Zusatz dahinter ist erlaubt).`
      + " Die Antwort gehoert NICHT in diesen Abschnitt: Dort liest die naechste Kette sie als weitere offene Frage und ueberspringt den Plan.",
  ];
  if (kette.art !== "plan") schritte.push(`3. /issue-review #${planId} laufen lassen.`);
  schritte.push(
    `${schritte.length + 1}. ${KLAEREN_LABEL} an ${P} abnehmen — und an der fachlichen Anforderung #${kette.F}, wenn es dort noch haengt.`,
    `${schritte.length + 2}. Zuletzt das Label ${kette.budget.label} an ${P} setzen.`,
  );
  return [
    `Die Entscheidung gehoert in ${P}, nicht in die fachliche Anforderung #${kette.F}: Die naechste Kette nimmt den Plan als Auftrag und faehrt von der Stufe pakete an weiter. Der Weg nach vorn:`,
    "",
    ...schritte,
    "",
    "Bis dahin geschnittene Pakete bleiben als Entwurf stehen.",
  ];
}

/**
 * Der Halt der Kette (Plan #638, A8): die eine Frage als Kommentar an der gekennzeichneten
 * Karte und kit:klaeren dort. Der Plan bleibt als Entwurf stehen. Das Label abnehmen darf
 * nur der Mensch — dieselbe Regel wie im Implementierungslauf.
 *
 * Adressat ist die Karte, die das Kennzeichen trug (Issue #896), nicht die Wurzel: Beim
 * Plan-Auftrag ist das der Plan selbst, und ein `kit:klaeren` an der fachlichen
 * Anforderung sperrte dort eine Karte, die diese Nacht nichts beauftragt hat.
 */
function haltAmAuftrag(kette, ergebnis) {
  const ziel = String(kette.karte.id);
  // Bei jedem `angehalten` steht der Plan schon fest: Die Stufe `plan` setzt ihre Nummer,
  // bevor sie an einer Stopp-Frage halten kann, und der Plan-Auftrag bringt sie mit.
  const planId = kette.stufen.plan?.id ?? ergebnis.dokId;
  const pfad = join(tmpdir(), `night-halt-${process.pid}-${ziel}-${ZUSTAND.LAUF_STEMPEL ?? abh.jetzt().getTime()}.md`);
  const text = [
    KETTE_HALT_ANKER,
    "",
    `Kette ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}, Stufe ${ergebnis.stufe}, Dokument #${ergebnis.dokId}: ${ergebnis.grund}.`,
    "",
    ergebnis.frage,
    "",
    ...haltWegNachVorn(kette, planId),
    "",
  ].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    abh.board("issue", "comment", ziel, "--text-file", pfad);
    abh.board("issue", "label", "add", ziel, KLAEREN_LABEL);
  } finally {
    rmSync(pfad, { force: true });
  }
  // Der Halt-Stand (Issue #1090, E1): Erst mit ihm ist am Board ohne Deutung zu sehen, dass
  // eine Frage wartet und kein technischer Abbruch vorliegt — auch wenn die Kette ausserhalb
  // einer Stufe anhielt.
  ketteStand(kette, "wartet", HALT_WARTET);
}

// --- Warten auf die Vorbereitung der Veroeffentlichung (Plan #1243, E8; Issue #1250) ---

// Die Phase im Puls, solange ein Lauf in seiner Vorbereitung wartet. Ein solcher Lauf baut
// nicht und zaehlt fuer andere Wartende nicht mit, sonst verklemmten sich zwei Vorbereitungen.
const PHASE_VORBEREITUNG_WARTET = "vorbereitung-wartet";

/**
 * Die fremden Laeufe dieses Projekts, die gerade bauen: lebende Pulse unter `.claude/lauf/`,
 * ohne den eigenen, ohne Prueflauf (`art: pruefung`, er baut nicht) und ohne einen Lauf, der
 * selbst in seiner Vorbereitung wartet.
 */
function bauendeLaeufe(repoRoot) {
  const ordner = join(repoRoot, LAUF_ORDNER);
  if (!existsSync(ordner)) return [];
  const bauend = [];
  for (const name of readdirSync(ordner).filter((n) => n.endsWith(".puls")).sort(vergleicheText)) {
    const lauf = name.slice(0, -".puls".length);
    if (lauf === ZUSTAND.LAUF_STEMPEL) continue;
    let puls;
    try {
      puls = JSON.parse(readFileSync(join(ordner, name), "utf-8"));
    } catch {
      continue;
    }
    if (puls?.art === "pruefung" || puls?.phase === PHASE_VORBEREITUNG_WARTET) continue;
    if (laufLebt(repoRoot, lauf)) bauend.push(`${lauf} (Prozess ${puls.pid})`);
  }
  return bauend;
}

/**
 * Wartet, bis in der Nacht nichts mehr baut (Kriterium 13): bis dieser Lauf die
 * Umsetzungssperre haelt und kein fremder Lauf dieses Projekts mehr baut — im Takt der
 * Umsetzungssperre, hoechstens `fristMin` (Vorgabe `vorbereitungMin` der Kette).
 *
 * Erst die Pulse, dann die Sperre, dann noch einmal die Pulse: Wer die Sperre haelt, waehrend
 * er auf eine andere Kette wartet, hielte sie von ihrer Umsetzung ab, und ein Lauf, der
 * zwischen erstem Blick und Sperre beginnt, faellt erst beim zweiten auf. Baut dann doch
 * einer, geht die Sperre zurueck.
 *
 * Fuer die Dauer des Wartens steht `phase: vorbereitung-wartet` im eigenen Puls, danach nicht
 * mehr, auch nach Fristablauf. Bei Erfolg kommt die Sperre wie aus `umsetzungLockNehmen`
 * zurueck und bleibt gehalten; frei gibt sie der Aufrufer nach der Vorbereitung — so laufen
 * zwei Vorbereitungen nacheinander. Nach Fristablauf `{ ok: false, grund }` ohne Sperre, ein
 * Schreibfehler der Sperre kommt sofort zurueck.
 */
export async function aufVorbereitungWarten(kette, { fristMin = kette.budget?.vorbereitungMin ?? KETTE_BUDGET_DEFAULTS.vorbereitungMin } = {}) {
  const fristMs = fristMin * 60 * 1000;
  const start = abh.jetzt().getTime();
  pulsZustandSetzen({ phase: PHASE_VORBEREITUNG_WARTET });
  try {
    for (;;) {
      const versuch = vorbereitungVersuchen(kette.repoRoot);
      if (versuch.lock) return versuch.lock;
      const rest = fristMs - (abh.jetzt().getTime() - start);
      if (rest <= 0) return { ok: false, grund: `${versuch.hindernis} — Frist ${fristMin} min fuer die Vorbereitung abgelaufen` };
      await abh.schlafen(Math.min(UMSETZUNG_WARTEN_MS, rest));
    }
  } finally {
    pulsZustandSetzen({ phase: undefined });
  }
}

/**
 * Ein Versuch von `aufVorbereitungWarten`: `{ lock }` mit der gehaltenen Sperre oder einem
 * Schreibfehler, der nicht wartet, sonst `{ hindernis }` mit dem Grund, weiter zu warten.
 */
function vorbereitungVersuchen(repoRoot) {
  const bauendText = (bauend) => `es baut noch: ${bauend.join(", ")}`;
  let bauend = bauendeLaeufe(repoRoot);
  if (bauend.length > 0) return { hindernis: bauendText(bauend) };
  const lock = umsetzungLockNehmen(repoRoot);
  if (!lock.ok) return lock.art === "belegt" ? { hindernis: lock.grund } : { lock };
  bauend = bauendeLaeufe(repoRoot);
  if (bauend.length > 0) {
    lock.freigeben();
    return { hindernis: bauendText(bauend) };
  }
  if (lock.hinweis) log(`  ${lock.hinweis}`);
  return { lock };
}

// --- Die Vorbereitung der Veroeffentlichung (Plan #1243, A4, A5, A6, E12, E17; Issue #1254) ---

// Der Auftrag der Session: der Modus `vorbereiten` von /push-main (#1253). Er legt seinen
// Worktree selbst an und haelt das Ergebnis ueber `worktree.mjs vorbereitung-festhalten` fest.
const VORBEREITUNG_PROMPT = "/push-main vorbereiten";

/** Das Ergebnis einer Vorbereitung, die keinen Stand dieses Laufs festhielt. */
const nichtVorbereitet = (grund) => ({ ergebnis: "nicht-vorbereitet", grund });

/**
 * Liest `.claude/push-vorbereitung.json` aus der Hauptkopie und prueft, dass sie aus diesem
 * Lauf stammt: dieselbe Laufkennung (`KIT_NIGHT_RUN`, der `start` des Ergebnisstands) und ein
 * Zeitpunkt nicht vor dem Beginn der Vorbereitung. Fehlt sie oder ist sie fremd, heisst das
 * Ergebnis `nicht-vorbereitet` mit Grund — eine Datei aus einer frueheren Nacht ist keine
 * Aussage ueber diesen Stand.
 */
function vorbereitungLesen(repoRoot, seit) {
  let daten;
  try {
    daten = JSON.parse(readFileSync(join(repoRoot, ...VORBEREITUNG_DATEI.split("/")), "utf-8"));
  } catch {
    return nichtVorbereitet(`${VORBEREITUNG_DATEI} fehlt oder ist unlesbar — die Session hat keinen Stand festgehalten`);
  }
  const laufId = ZUSTAND.LAUF?.start ?? null;
  if (daten?.laufId !== laufId) {
    return nichtVorbereitet(`${VORBEREITUNG_DATEI} stammt aus einem anderen Lauf (laufId ${daten?.laufId ?? "keine"}, erwartet ${laufId})`);
  }
  const zeit = Date.parse(daten.zeitpunkt);
  if (Number.isNaN(zeit) || zeit < seit.getTime()) {
    return nichtVorbereitet(`${VORBEREITUNG_DATEI} traegt den Zeitpunkt ${daten.zeitpunkt ?? "keiner"}, vor dem Beginn der Vorbereitung um ${seit.toISOString()}`);
  }
  return daten;
}

/**
 * Wartet, faehrt die Session und liest ihr Ergebnis — alles innerhalb von `fristMin` ab
 * `start` (E8: Warten und Pruefung eingeschlossen). Die Umsetzungssperre haelt sie vom Ende
 * des Wartens bis nach dem Lesen und gibt sie in jedem Fall frei, auch nach einem Wurf.
 */
async function vorbereitungFahren(kette, start, fristMin) {
  const lock = await aufVorbereitungWarten(kette, { fristMin });
  if (!lock.ok) return nichtVorbereitet(lock.grund);
  try {
    // In der Hauptkopie (A5): Den Worktree legt der Skill an. KIT_NIGHT_RUN und KIT_STAND
    // setzt `runSession` wie fuer jede Session, ohne eigenes `extraEnv` (A6).
    const session = await ketteSession({ ...kette, wt: kette.repoRoot }, "vorbereitung", VORBEREITUNG_PROMPT, start.getTime(), fristMin * 60 * 1000);
    const daten = vorbereitungLesen(kette.repoRoot, start);
    if (daten.ergebnis === "nicht-vorbereitet" && session.ausgang !== "fertig") return nichtVorbereitet(`${session.grund}; ${daten.grund}`);
    return daten;
  } catch (e) {
    return nichtVorbereitet(`technischer Fehler: ${e.message}`);
  } finally {
    lock.freigeben();
  }
}

/**
 * Die Stufe `vorbereitung` des Laufs (A4): einmal nach allen Ketten, fuer alle Ketten, deren
 * Umsetzung mit Ziel `push-vorbereitet` fertig wurde. Sie wartet, bis nichts mehr baut, faehrt
 * die Session `/push-main vorbereiten` in der Hauptkopie und prueft deren Datei. Jede
 * ausloesende Karte bekommt die Stufenzeilen im Laufstand und einen eigenen Nachtbericht
 * `— Vorbereitung` mit derselben Meldung (E12); das Ergebnis steht als `vorbereitung` im
 * Ergebnisstand. Ein `gruen-offen` mit dem Build-Dienst-Punkt geht unveraendert weiter, und
 * gepusht wird nie (E17).
 */
export async function vorbereitungLaufen(ketten) {
  const erste = ketten[0];
  const start = abh.jetzt();
  const fristMin = erste.budget?.vorbereitungMin ?? KETTE_BUDGET_DEFAULTS.vorbereitungMin;
  const karten = ketten.map((k) => String(k.karte.id));
  log(`Vorbereitung der Veroeffentlichung fuer ${karten.map((id) => "#" + id).join(", ")}: hoechstens ${fristMin} min, Warten eingeschlossen.`);
  for (const k of ketten) stufeBeginnt(k, "vorbereitung", k.karte.id);
  const vorbereitung = { ...(await vorbereitungFahren(erste, start, fristMin)), karten };
  const vorbereitet = vorbereitung.ergebnis !== "nicht-vorbereitet";
  const grund = vorbereitung.grund ? ` — ${vorbereitung.grund}` : "";
  log(`  Vorbereitung: ${vorbereitung.ergebnis}${grund}.`);
  for (const k of ketten) {
    stufeEndet(k, "vorbereitung", k.karte.id, vorbereitet ? { ausgang: "fertig" } : { ausgang: "abgebrochen", grund: vorbereitung.grund });
    if (vorbereitet) log(`  Ziel ${k.ziel} erreicht nach vorbereitung — #${k.karte.id}.`);
    // Mit eigenem Stempel: Ein wartender Bericht der Kette liegt sonst unter demselben Namen.
    berichtSchreiben(String(k.karte.id), vorbereitungsBericht(k.karte, vorbereitung),
      { stempel: `${ZUSTAND.LAUF_STEMPEL}-vorbereitung`, repoRoot: k.repoRoot });
  }
  if (ZUSTAND.LAUF) ZUSTAND.LAUF.vorbereitung = vorbereitung;
  schreibeErgebnisstand();
  return vorbereitung;
}

// --- Der Nachtbericht am Fachplan (Plan #638, A10, A11; Issue #645) ---
//
// Der Bericht selbst steht seit Issue #1230 im Teil kit/night/bericht.mjs (Plan #1199,
// E17). Was hier steht, ruft allein die Nacht-Kette.

/**
 * Der Vorflug ist vor der ersten Kette gescheitert: Der Vorab-Stand jedes Kandidaten wird
 * `abgebrochen` mit `Kette nicht gestartet` und dem Befund (Issue #1090, E17) — der
 * fruehere eigene Kommentar geht darin auf. Das Label bleibt, die Geste ist nicht
 * verbraucht, denn es lief nichts. Ohne `fail`, weil der Aufrufer gleich selbst hart stoppt.
 */
function ketteNichtGestartet(kandidaten, grund) {
  const zeit = abh.jetzt().toISOString();
  for (const k of kandidaten) {
    const ergebnis = standSetzen(k.id, "abgebrochen", `Kette nicht gestartet um ${zeit}: ${grund}`, { budgetMs: ABBRUCH_BUDGET_MS });
    log(ergebnis === "geschrieben"
      ? `  #${k.id}: Laufstand 'Kette nicht gestartet' geschrieben, Label bleibt.`
      : `  #${k.id}: Laufstand 'Kette nicht gestartet' nicht geschrieben — bleibt offen im Journal.`);
  }
}

/**
 * Der einmalige Hinweis an einer Anforderung, die die Kette wegen fehlender Pruefung
 * abgelehnt hat (Fachplan #702, Kriterium 4; Issue #719).
 *
 * Grund und naechster Schritt stehen im Wortlaut des Protokolls: Wer morgens die Karte
 * liest, soll nicht erst im Protokoll nachsehen muessen. Einmalig wird der Kommentar
 * ueber den Anker — die Karte wird vorher zurueckgelesen, wie die Kette es mit ihren
 * Ueberholt-Kommentaren haelt (Plan #716, E3).
 *
 * Nicht lesbar heisst nicht schreiben: Ohne die vorhandenen Kommentare ist nicht zu
 * entscheiden, ob der Hinweis schon dasteht, und ein Lauf, der das jede Nacht neu
 * versucht, haengte der Karte den Hinweis mehrfach an. Ein gescheiterter Board-Aufruf
 * wird protokolliert und haelt den Lauf nicht auf — der Kommentar ist Hinweis, kein Gate.
 */
function pruefungFehltKommentieren(u, anker = KETTE_UNGEPRUEFT_ANKER) {
  const karte = leseKarte(u.id);
  if (!karte) {
    log(`  #${u.id}: Hinweis-Kommentar nicht geschrieben (Karte nicht lesbar).`);
    return;
  }
  if (kommentareVon(karte).some((k) => k.includes(anker))) {
    log(`  #${u.id}: Hinweis-Kommentar steht schon am Board — kein zweiter.`);
    return;
  }
  const res = abh.boardRoh("issue", "comment", String(u.id), "--text", `${anker}\n\n${u.grund}.\n`);
  log(res.status === 0
    ? `  #${u.id}: Hinweis-Kommentar geschrieben, Label bleibt.`
    : `  #${u.id}: Hinweis-Kommentar nicht geschrieben (${res.text.slice(0, 120)}).`);
}

/**
 * Der Hinweis, dass das Board `review:fertig` offenbar gar nicht kennt (Fachplan #702,
 * Kriterium 8; Plan #716, E4).
 *
 * Ob das Kennzeichen am Board definiert ist, kann der Runner nicht fragen — kein
 * Kommando liest die dort angelegten Labels. Der Hinweis entsteht deshalb als Heuristik
 * ueber die ohnehin geholte Liste: Traegt keine einzige Karte das Label, ist er in
 * beiden Lesarten wahr, und sein Text nennt beide Wege.
 *
 * Er erscheint nur, wenn mindestens eine Anforderung deshalb abgelehnt wurde — ohne
 * Adressaten waere er Rauschen in jedem Protokoll. In Vorschau und Lauf gleichermassen:
 * Er schreibt nichts, er sagt nur etwas.
 */
function hinweisAufUnbekanntesKennzeichen(alle, abgelehnt, kettenLabel) {
  if (abgelehnt.length === 0 || (alle || []).some(hatReviewFertigLabel)) return;
  log(`Hinweis: keine Karte am Board traegt '${REVIEW_FERTIG_LABEL}' — deshalb wird jeder Auftrag abgelehnt.`);
  log(`  Entweder ist das Kennzeichen am Board noch nicht angelegt — dann einmal anlegen, wie das Label '${kettenLabel}' —, oder es hat noch keine Anforderung eine Pruefung hinter sich (/issue-review <Nummer> setzt es).`);
}

/**
 * Die uebersprungenen Karten einer Nacht: Protokollzeile und Einheit im Ergebnisstand
 * wie bisher, dazu der Hinweis an den wegen fehlender Pruefung abgelehnten Anforderungen
 * (Issue #719).
 *
 * Beides steht VOR dem Reviewer-Vorflug (Plan #716, E7): Der Vorflug betrifft nur die
 * laufenden Ketten; scheitert er, sollen die abgelehnten Fachplaene ihren Kommentar
 * trotzdem schon haben.
 */
function uebersprungeneVerbuchen(uebersprungen, alle, kettenLabel, dryRun) {
  // Erkannt am festen Praefix, nicht am ganzen Grundtext: Der traegt je Karte ihre
  // Nummer und ist deshalb kein Vergleichswert.
  const abgelehnt = uebersprungen.filter((u) => String(u.grund).startsWith(UNGEPRUEFT_PRAEFIX));
  for (const u of uebersprungen) {
    log(`  #${u.id} ${u.title} -> uebersprungen (${u.grund})`);
    einheitErgaenzen(einheitAnlegen(u.id, u.title), { ausgang: "uebersprungen", grund: u.grund });
    // Der Dry-Run schreibt nichts ans Board; der Hinweis auf das Kennzeichen kommt
    // auch dort, er ist nur eine Protokollzeile.
    if (!dryRun && abgelehnt.includes(u)) pruefungFehltKommentieren(u);
    // Die unpassende Einstellung (Issue #1244, A9) auf demselben Weg, mit eigenem Anker.
    if (!dryRun && String(u.grund).startsWith(ZIEL_UNPASSEND_PRAEFIX)) pruefungFehltKommentieren(u, KETTE_ZIEL_ANKER);
  }
  hinweisAufUnbekanntesKennzeichen(alle, abgelehnt, kettenLabel);
}

/**
 * Fuehrt eine Stufe der Kette aus und meldet danach den Lauf (Issue #794).
 *
 * Der Grund liegt bei der Gegenstelle: kanban-kit erklaert einen nicht abgeschlossenen
 * Lauf fuer verstummt, wenn laenger als seine Stillefrist keine neue Meldung kam, und
 * als Lebenszeichen zaehlt allein eine Meldung (kanban-kit #1086, AK 6; ein eigenes
 * Lebenszeichen hat es mit #1074 bewusst abgelehnt). Zwischen der Startmeldung (Issue
 * #743) und der ersten Paket-Meldung lag bis hierher die ganze Planungsphase — mit den
 * Budgets dieses Repos bis zu 95 Minuten, mehr als die Frist. Ein gesunder Kettenlauf
 * fiel dort mitten in der Planung aus den aktiven Laeufen.
 *
 * Die Stufe meldet, nicht ihr Ausgang: Jede Stufe hat ein Budget von hoechstens 30
 * Minuten, und weil dieser Wrapper JEDEN Aufruf in `stufenDerKette` umschliesst, fuehrt
 * kein Weg durch die Kette ueber zwei Stufen ohne Meldung — gleich, ob eine Stufe fertig
 * wird, anhaelt oder abbricht. Stuende der Aufruf stattdessen an den Rueckgabepunkten der
 * Stufen selbst, waere er an jedem neuen `return` erneut zu bedenken.
 *
 * Erst schreiben, dann melden, wie beim Start: `laufMelden()` liest ERGEBNIS_FILE ueber
 * einen eigenen Prozess von der Platte. Ohne eigene Protokollzeile — `laufMelden()`
 * bringt seine eigene mit, und `meldezeile()` fasst sie ueber den ganzen Lauf zu einer
 * zusammen.
 */
async function mitMeldung(stufe) {
  const ergebnis = await stufe();
  schreibeErgebnisstand();
  laufMelden();
  return ergebnis;
}

// --- Vorhandenes Ergebnis einer Stufe (Issue #1086, Plan #1079 E2, E9, E10, E11) ---
//
// Eine Stufe prueft vor ihrem Start und nach jedem Abbruch am Board, ob ihr Ergebnis
// schon vorliegt, statt vorher und nachher zu vergleichen: Der Vergleich sieht nach einem
// Absturz nichts mehr. So gilt ein Pruefvermerk, der vor dem Zeitlimit im Plan stand, als
// Ergebnis (Belegfall 2 aus #1075), und `kit:night` an der Karte setzt bei der ersten
// Stufe ohne Ergebnis an.

// Ein Plan in Done zaehlt nicht: Wer einen frischen Plan will, schliesst den alten (E9).
const PLAN_VORHANDEN_SPALTEN = new Set(["backlog", "ready", "in_review"]);
const PAKET_UMGESETZT_SPALTEN = new Set(["in_review", "done"]);
// Der Kopf des Kommentars, den `werteInReview` an ein Paket mit Nachweis-Mangel schreibt.
const NACHWEIS_MANGEL_KOPF = "Nachtlauf: Nachweis ";
// Der Wortlaut des Teilschnitts (E10) — hinter der Liste der angelegten Pakete.
const TEILSCHNITT_FOLGE = "eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night";

/** Ein Laufstand-Eintrag einer Stufe: `<stufe> begonnen|fertig für #<ziel>`. */
const stufenEintrag = (stufe, was, ziel) => `${stufe} ${was} für #${ziel}`;

/** Traegt einer der Texte den Eintrag — mit Zahlgrenze, sonst passte #12 auf #123. */
function eintragDa(texte, stufe, was, ziel) {
  const muster = new RegExp(`(?:^|[^\\w])${stufe} ${was} für #${ziel}(?!\\d)`, "m");
  return texte.some((t) => muster.test(t));
}

/**
 * Der Kommentar `## Laufstand` einer Karte, wie er jetzt am Board steht — leer ohne ihn.
 */
const laufstandAmBoard = (karteId) => kommentareVon(leseKarte(karteId)).filter((k) => k.startsWith("## Laufstand"));

/**
 * Der Laufstand-Text der tragenden Karte aus allen Quellen (E10): der Kommentar, wie ihn
 * die Kette beim Start vorfand (`auftrag.laufstandVorher`), wie er jetzt steht, und die
 * Standzeilen dieser Karte in jedem Journal unter `.claude/lauf/`. Der Kommentar wird bei
 * jedem Wechsel ersetzt — von den eigenen Stufen dieses Laufs, von einem Abbruch oder vom
 * Waechter —, das Journal haengt nur an und haelt die Stufenzeilen fest.
 */
function laufstandTexte(auftrag) {
  const karteId = auftrag.karte.id;
  const texte = [...(auftrag.laufstandVorher ?? []), ...laufstandAmBoard(karteId)];
  const ordner = join(auftrag.repoRoot, LAUF_ORDNER);
  if (existsSync(ordner)) {
    for (const name of readdirSync(ordner).filter((n) => n.endsWith(".jsonl")).sort(vergleicheText)) {
      for (const s of journalLesen(join(ordner, name)).staende) {
        if (s.karte === String(karteId)) texte.push(String(s.text ?? ""));
      }
    }
  }
  return texte;
}

/**
 * Ist dieses Paket umgesetzt (E9)? In In review oder Done und ohne den Kommentar, den
 * `werteInReview` bei fehlendem, unlesbarem oder rotem Nachweis schreibt — derselbe Guard
 * wie dort (Issue #471). Exportiert fuer die Tests.
 */
export function paketUmgesetzt(issue) {
  if (!issue || !PAKET_UMGESETZT_SPALTEN.has(issue.status)) return false;
  return !kommentareVon(issue).some((k) => k.startsWith(NACHWEIS_MANGEL_KOPF));
}

/** Die Arbeitspakete zum Plan am Board, aufsteigend nach Nummer. */
function paketeZumPlan(planId) {
  return abh.board("issue", "list")
    .filter((i) => stammtAusErzeugung(i, planId, "issue"))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((i) => String(i.id));
}

/**
 * Liegt das Ergebnis dieser Stufe schon vor (E9)? `null`, wenn nicht, sonst ein Objekt mit
 * dem, was die folgenden Stufen brauchen.
 *
 * `auftrag` traegt `karte` (die Karte, die die Kette traegt), `F`, `repoRoot`, dazu je
 * nach Stufe `planId` und `paketIds`. Die Eintraege von pakete und abdeckung stehen an der
 * tragenden Karte (E2). `abdeckung fertig` deckt `pakete fertig` mit: Der Laufstand-
 * Kommentar nennt nur den zuletzt abgeschlossenen Schritt, und die Abdeckung kommt nach
 * den Paketen.
 */
export function ergebnisVorhanden(stufe, auftrag) {
  return Object.hasOwn(ERGEBNIS_REGELN, stufe) ? ERGEBNIS_REGELN[stufe](auftrag) : null;
}

/** Die fuenf Ergebnisregeln aus E9, je Stufe eine. */
const ERGEBNIS_REGELN = {
  plan: (auftrag) => {
    const plan = abh.board("issue", "list")
      .filter((i) => PLAN_VORHANDEN_SPALTEN.has(i.status) && stammtAusErzeugung(i, auftrag.F, "plan"))
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    return plan ? { id: String(plan.id) } : null;
  },
  review: (auftrag) => (hatPlanReviewMarker(leseKarte(auftrag.planId)?.body) ? {} : null),
  pakete: (auftrag) => {
    const texte = laufstandTexte(auftrag);
    const fertig = eintragDa(texte, "pakete", "fertig", auftrag.planId) || eintragDa(texte, "abdeckung", "fertig", auftrag.planId);
    return fertig ? { ids: paketeZumPlan(auftrag.planId) } : null;
  },
  abdeckung: (auftrag) => (eintragDa(laufstandTexte(auftrag), "abdeckung", "fertig", auftrag.planId) ? {} : null),
  umsetzung: (auftrag) => {
    const ids = auftrag.paketIds ?? [];
    return ids.length > 0 && ids.every((id) => paketUmgesetzt(leseKarte(id))) ? { ids } : null;
  },
};

/**
 * Der Teilschnitt (E10): Der Laufstand dieser Karte traegt `pakete begonnen für #M` ohne
 * `pakete fertig für #M`, und am Board liegen schon Pakete zum Plan. Die Stufe startet
 * dann nicht — `/issues` kennt keinen Wiedereinstieg, und eine Wiederholung legte doppelt
 * an. Pakete ohne jeden Laufstand-Eintrag zaehlen wie bisher (Issue #895): Die Stufe
 * laeuft. `null` ohne Teilschnitt.
 */
function teilschnitt(auftrag, planId) {
  if (!eintragDa(laufstandTexte(auftrag), "pakete", "begonnen", planId)) return null;
  const ids = paketeZumPlan(planId);
  if (ids.length === 0) return null;
  return { ausgang: "abgebrochen", grund: `Teilschnitt vorhanden (${ids.map((id) => "#" + id).join(", ")}) — ${TEILSCHNITT_FOLGE}` };
}

// Der Wortlaut von `wartet` bei einem inhaltlichen Halt (E1), wie er im Regeltext steht.
const HALT_WARTET = `Halt: Frage wartet auf den Menschen — siehe \`${KETTE_HALT_ANKER}\``;

/**
 * Schreibt den Laufstand der tragenden Karte (E2): zuletzt begonnener und zuletzt
 * abgeschlossener Schritt, darueber bei einem Abbruch oder Halt dessen Grund. Ein Board,
 * das nicht annimmt, haelt nichts an — `standSetzen` laesst die Zeile offen im Journal.
 */
function ketteStand(kette, zustand, kopf = null) {
  const s = kette.laufstand;
  const zuletzt = [
    ...(s.begonnen ? [`zuletzt begonnen: ${s.begonnen}`] : []),
    ...(s.abgeschlossen ? [`zuletzt abgeschlossen: ${s.abgeschlossen}`] : []),
  ];
  const bloecke = [kopf, zielZeilen(kette).join("\n"), zuletzt.join("\n")].filter(Boolean);
  standSetzen(kette.karte.id, zustand, bloecke.join("\n\n"), { repoRoot: kette.repoRoot });
  kette.standGesetzt = true;
}

/**
 * Die Zeilen unter dem Kopf jeder Fassung (Plan #1243, E5, E16): Nach dem Verbrauch der
 * Labels beim Start liest das Board Ziel und Prueferzahl nur noch hier. Ohne Ziel und ohne
 * `planreview:*` leer — dann bleibt der Laufstand wie vor #1251.
 */
function zielZeilen(kette) {
  const grenze = grenzeVorZiel(kette);
  return [
    ...(kette.ziel ? [`Ziel: ${kette.ziel}`] : []),
    ...(kette.planReviewer ? [`Prüfer: ${kette.planReviewer}`] : []),
    ...(grenze ? [`Grenze: ${grenze}`] : []),
  ];
}

// Die Stufen der Kette in fester Folge, je mit dem Uebergang, ueber den sie folgt (E5).
const STUFEN_FOLGE = Object.freeze([
  ["plan", null], ["review", "planReview"], ["pakete", "reviewPakete"], ["abdeckung", "paketeAbdeckung"],
  ["umsetzung", "abdeckungUmsetzung"], ["vorbereitung", "umsetzungVorbereitung"],
]);

/**
 * Die letzte erreichbare Stufe, wenn ein im Projekt gesperrter Uebergang (ausdrueckliches
 * `false`) vor der Endstufe des Ziels liegt — sonst `null`. Beim Plan-Auftrag beginnt die
 * Kette bei `pakete`; die Uebergaenge davor betreffen sie nicht.
 */
function grenzeVorZiel(kette) {
  const endstufe = KETTE_ZIELE.find((z) => z.ziel === kette.ziel)?.endstufe;
  if (!endstufe) return null;
  const erste = STUFEN_FOLGE.findIndex(([stufe]) => stufe === (kette.art === "plan" ? "pakete" : "plan"));
  for (let i = erste + 1; i < STUFEN_FOLGE.length; i++) {
    if (kette.uebergaenge?.[STUFEN_FOLGE[i][1]] === false) return STUFEN_FOLGE[i - 1][0];
    if (STUFEN_FOLGE[i][0] === endstufe) return null;
  }
  return null;
}

// Was nach dem Ende am Ziel dem Menschen gehoert (E5), je Ziel.
const ALS_NAECHSTES = Object.freeze({
  plan: "Plan lesen, dann `kit:night` an den Plan.",
  pakete: "Pakete nach Ready ziehen.",
  umsetzung: "Pakete in In review testen, dann `push main`.",
  "push-vorbereitet": "Meldung der Vorbereitung lesen, dann `push main`.",
});

/**
 * Die Zeile `Als Nächstes:` am Ziel. Wartet ein Menschenschritt (Issue #1281), ist er der
 * naechste Handgriff — nicht der Text aus ALS_NAECHSTES, der die Kette fuer erledigt ausgibt.
 */
function alsNaechstes(kette) {
  const wartend = wartendeMenschenschritte(kette.stufen?.umsetzung);
  if (wartend.length === 0) return ALS_NAECHSTES[kette.ziel];
  const haengen = new Set(wartend.flatMap((w) => w.haengen));
  return `Menschenschritt ${wartend.map((w) => "#" + w.id).join(", ")} erledigen, dann kit:night an #${kette.karte.id} — ${haengen.size} Paket(e) hängen daran.`;
}

/** Der Laufstand zum Beginn einer Stufe. `ziel` ist die Karte, an der sie arbeitet. */
function stufeBeginnt(kette, stufe, ziel) {
  kette.laufstand.begonnen = `${stufenEintrag(stufe, "begonnen", ziel)} um ${abh.jetzt().toISOString()}`;
  ketteStand(kette, "laeuft");
}

/** Der Laufstand zum Ende einer Stufe — `fertig`, oder ihr Abbruch beziehungsweise Halt. */
function stufeEndet(kette, stufe, ziel, ergebnis) {
  if (ergebnis.ausgang === "fertig") {
    kette.laufstand.abgeschlossen = `${stufenEintrag(stufe, "fertig", ziel)} um ${abh.jetzt().toISOString()}`;
    ketteStand(kette, "fertig", endetAmZiel(kette, stufe) ? `fertig bis ${kette.ziel}\nAls Nächstes: ${alsNaechstes(kette)}` : null);
  } else if (ergebnis.ausgang === "angehalten") {
    // Haelt ein Paket der Umsetzung an, steht die Frage am Paket, nicht an dieser Karte (E17).
    ketteStand(kette, "wartet", ergebnis.ohneHaltAmFachplan ? `Halt: ${ergebnis.grund}` : HALT_WARTET);
  } else {
    ketteStand(kette, ergebnis.ausgang === "abgebrochen" ? "abgebrochen" : "fertig", `${ergebnis.ausgang}: Stufe ${stufe}: ${ergebnis.grund ?? "ohne Grund"}`);
  }
}

/**
 * Eine Stufe mit Ergebnispruefung (E9): vorher am Board nachsehen und ohne Session
 * `fertig` mit `vorgefunden: true` melden; sonst laufen lassen und nach dem Abbruch
 * einer Session noch einmal nachsehen. `vorfinden` setzt den Stand der Stufe fuer den vorgefundenen
 * Fall und liefert das Ergebnis der Stufe.
 */
async function stufeMitErgebnis(kette, stufe, ziel, { auftrag, laufen, vorfinden, vorab = null }) {
  const vorhanden = ergebnisVorhanden(stufe, auftrag);
  if (vorhanden) {
    log(`  Stufe ${stufe}: Ergebnis liegt vor — keine Session, die Stufe gilt als fertig.`);
    const ergebnis = vorfinden(vorhanden);
    stufeEndet(kette, stufe, ziel, ergebnis);
    return ergebnis;
  }
  const sperre = vorab?.();
  if (sperre) {
    log(`  Stufe ${stufe}: ${sperre.grund}.`);
    stufeEndet(kette, stufe, ziel, sperre);
    return sperre;
  }
  const vorherLog = schrittBeginnen(kette.karte.id, stufe);
  try {
    return await stufeLaufen(kette, stufe, ziel, { auftrag, laufen, vorfinden });
  } finally {
    schrittEnden(vorherLog);
  }
}

/** Der laufende Teil von `stufeMitErgebnis`, ganz im Protokoll seines Schritts. */
async function stufeLaufen(kette, stufe, ziel, { auftrag, laufen, vorfinden }) {
  stufeBeginnt(kette, stufe, ziel);
  let ergebnis = await laufen();
  // Nur nach dem Abbruch einer SESSION von aussen (Zeitlimit, technischer Fehler): Dort ist
  // offen, was sie hinterlassen hat. Eine rote Form, ein erschoepftes Kostenbudget oder ein
  // harter Stopp sind dagegen ein Urteil ueber das Ergebnis — ein vorgefundener Plan
  // ueberginge die Form, eine vorgefundene Stufe das Budget. Die wartende Sitzung ebenso:
  // Sie sagt selbst, dass ihre Arbeit noch nicht durch ist (Issue #778).
  if (ergebnis.ausgang === "abgebrochen" && ergebnis.sitzungsAbbruch && !kette.kostenGrund) {
    const nachher = ergebnisVorhanden(stufe, auftrag);
    if (nachher) {
      log(`  Stufe ${stufe}: abgebrochen (${ergebnis.grund}), das Ergebnis liegt aber vor — die Stufe gilt als fertig.`);
      ergebnis = vorfinden(nachher, kette.stufen[stufe]);
    }
  }
  stufeEndet(kette, stufe, ziel, ergebnis);
  return ergebnis;
}

// --- Freigegebene Uebergaenge (Issue #1087, Plan #1079 E1, E12) ---

// Die beiden Wortlaute von `wartet` aus E1, wie sie im Regeltext stehen.
const uebergangNichtFreigegeben = (uebergang) => `wartet: Übergang ${uebergang} im Projekt nicht freigegeben — weiter mit kit:night`;
const OHNE_FREIGABE_ZUR_UMSETZUNG = "wartet: Karte ohne Freigabe zur Umsetzung";

/**
 * Folgt die naechste Stufe automatisch? Gesperrt wird nur das Folgen auf eine Stufe, die in
 * DIESEM Lauf lief. War die vorige vorgefunden, ist die naechste die erste offene, und dort
 * hat der Mensch mit `kit:night` selbst angestossen — sonst setzte die Geste, die der
 * Wartetext nennt, nie bei der wartenden Stufe an. Gesperrt ist nur ein ausdrueckliches
 * `false`; ein nicht gesetzter `abdeckungUmsetzung` (`null`) sperrt nicht (Issue #1105).
 */
const uebergangGesperrt = (kette, uebergang, vorige) => !vorige.vorgefunden && kette.uebergaenge[uebergang] === false;

/** Ende der Kette vor `stufe`: Laufstand `wartet` mit dem Wortlaut, Ausgang `unvollstaendig`. */
function ketteWartet(kette, stufe, text) {
  log(`  Stufe ${stufe}: ${text}.`);
  ketteStand(kette, "wartet", text);
  return { ausgang: "unvollstaendig", grund: text, stufe };
}

/**
 * Ende an der Projektgrenze vor `stufe`: derselbe Wartetext wie bisher, dazu der Vermerk
 * `projektgrenze` fuer den Nachtbericht (E6) — kein eigener Ausgang.
 */
function anDerGrenze(kette, stufe, uebergang) {
  return { ...ketteWartet(kette, stufe, uebergangNichtFreigegeben(uebergang)), projektgrenze: true };
}

/**
 * Endet die Kette nach der Abdeckung? Das GO steht an der Karte (`kit:durchziehen`), das
 * Projekt kann es nur zulassen (E12). Ohne Label endet sie `fertig`, nur ein gesetztes `true`
 * laesst sie auf die Freigabe der Karte warten; mit Label sperrt nur ein gesetztes `false`
 * (Issue #1105). `null`, wenn die Umsetzung folgt.
 */
function vorDerUmsetzung(kette, abdeckung) {
  if (kette.variante !== "B") {
    return kette.uebergaenge.abdeckungUmsetzung === true ? ketteWartet(kette, "umsetzung", OHNE_FREIGABE_ZUR_UMSETZUNG) : { ausgang: "fertig" };
  }
  return uebergangGesperrt(kette, "abdeckungUmsetzung", abdeckung)
    ? anDerGrenze(kette, "umsetzung", "abdeckungUmsetzung")
    : null;
}

/**
 * Endet die Kette nach `stufe` an ihrem Ziel (Plan #1243, A2)? Dann Ausgang `fertig` mit
 * dem Vermerk `zielErreicht`, sonst `null`. Ohne Ziel nie. `push-vorbereitet` endet nach
 * der Stufe `vorbereitung`, die der Lauf nach allen Ketten faehrt (`vorbereitungLaufen`).
 */
function amZiel(kette, stufe) {
  if (!endetAmZiel(kette, stufe)) return null;
  log(`  Ziel ${kette.ziel} erreicht nach ${stufe} — die Kette endet hier.`);
  return { ausgang: "fertig", zielErreicht: true };
}

/** Ist `stufe` die letzte Stufe zum Ziel der Kette? Eine Regel fuer `amZiel` und den Laufstand. */
function endetAmZiel(kette, stufe) {
  if (!kette.ziel) return false;
  const endstufe = KETTE_ZIELE.find((z) => z.ziel === kette.ziel)?.endstufe;
  return endstufe === stufe;
}

/**
 * Nach der fertigen Umsetzung (Plan #1243, A4, E7): Mit Ziel `push-vorbereitet` meldet die
 * Kette `vorbereitung: true` — die Stufe selbst laeuft einmal je Lauf nach allen Ketten —,
 * oder sie wartet vor einem im Projekt gesperrten Uebergang. Sonst endet sie wie bisher.
 */
function nachDerUmsetzung(kette, umsetzung) {
  if (KETTE_ZIELE.find((z) => z.ziel === kette.ziel)?.endstufe !== "vorbereitung") {
    return amZiel(kette, "umsetzung") ?? { ausgang: "fertig" };
  }
  if (uebergangGesperrt(kette, "umsetzungVorbereitung", umsetzung)) return anDerGrenze(kette, "vorbereitung", "umsetzungVorbereitung");
  return { ausgang: "fertig", vorbereitung: true };
}

/** Endet die Kette nach `review`: am Ziel `plan` oder vor einem gesperrten Uebergang zu `pakete`. */
function nachDemReview(kette, review) {
  const amEnde = amZiel(kette, "review");
  if (amEnde) return amEnde;
  return uebergangGesperrt(kette, "reviewPakete", review) ? anDerGrenze(kette, "pakete", "reviewPakete") : null;
}

/**
 * Die Stufen einer Kette in Reihenfolge; die erste, die nicht fertig wird, ist der
 * Ausgang der Kette (mit ihrem Namen fuer den Halt-Kommentar). Unter Variante B kommt
 * hinter `abdeckung` die fuenfte Stufe `umsetzung` dazu (Plan #691, E12).
 *
 * Jede der vier erzeugenden Stufen laeuft durch `mitMeldung` (Issue #794). Die Stufe
 * `umsetzung` nicht: Sie meldet ueber `laufeRunde` schon nach jedem fertigen Paket.
 *
 * Jede Stufe laeuft durch `stufeMitErgebnis` (Issue #1086): Liegt ihr Ergebnis schon vor,
 * startet keine Session, und ihr Laufstand steht an der Karte, die die Kette traegt.
 */
async function stufenDerKette(kette) {
  // Der Laufstand, den die Kette vorfand — VOR ihrem ersten eigenen, der ihn ersetzt.
  const auftrag = { F: kette.F, karte: kette.karte, repoRoot: kette.repoRoot, laufstandVorher: kette.laufstandVorher ?? laufstandAmBoard(kette.karte.id) };
  kette.laufstand ??= { begonnen: null, abgeschlossen: null };
  let planId;
  if (kette.art === "plan") {
    // Der Plan ist der Auftrag: Er steht schon da, geprueft und ohne offene Frage.
    // Traegt er aus einem frueheren Lauf bereits Arbeitspakete OHNE Laufstand-Eintrag,
    // laeuft die Stufe trotzdem unveraendert und zaehlt nur die neu entstandenen Karten —
    // ein hingenommener Fall (Issue #895): Die aelteren Pakete bleiben in Backlog stehen,
    // und ein weiteres Tor davor sperrte den haeufigen Fall aus, um den seltenen zu
    // verhindern. Mit Eintrag gelten sie als vorgefunden oder als Teilschnitt (#1086).
    planId = kette.stufen.plan.id;
  } else {
    const plan = await mitMeldung(() => stufeMitErgebnis(kette, "plan", kette.F, {
      auftrag,
      laufen: () => stufePlan(kette),
      vorfinden: (v, vorher) => {
        kette.stufen.plan = { dauerMs: 0, kennzahlen: null, korrekturrunden: 0, weitere: [], ...vorher, id: v.id, vorgefunden: true };
        return { ausgang: "fertig", id: v.id, vorgefunden: true };
      },
    }));
    if (plan.ausgang !== "fertig") return { ...plan, stufe: "plan" };
    planId = plan.id;
    if (uebergangGesperrt(kette, "planReview", plan)) return anDerGrenze(kette, "review", "planReview");
    const review = await mitMeldung(() => stufeMitErgebnis(kette, "review", planId, {
      auftrag: { ...auftrag, planId },
      laufen: () => stufeReview(kette, planId),
      vorfinden: (v, vorher) => {
        kette.stufen.review = { dauerMs: 0, kennzahlen: null, ...vorher, marker: true, vorgefunden: true };
        return { ausgang: "fertig", vorgefunden: true };
      },
    }));
    if (review.ausgang !== "fertig") return { ...review, stufe: "review" };
    const endeNachReview = nachDemReview(kette, review);
    if (endeNachReview) return endeNachReview;
  }
  const pakete = await mitMeldung(() => stufeMitErgebnis(kette, "pakete", planId, {
    auftrag: { ...auftrag, planId },
    laufen: () => stufePakete(kette, planId),
    vorab: () => teilschnitt(auftrag, planId),
    vorfinden: (v, vorher) => {
      kette.stufen.pakete = { nichtZuordenbar: [], dauerMs: 0, kennzahlen: null, korrekturrunden: 0, ...vorher, ids: v.ids, vorgefunden: true };
      return { ausgang: "fertig", ids: v.ids, vorgefunden: true };
    },
  }));
  if (pakete.ausgang !== "fertig") return { ...pakete, stufe: "pakete" };
  if (uebergangGesperrt(kette, "paketeAbdeckung", pakete)) return anDerGrenze(kette, "abdeckung", "paketeAbdeckung");
  const abdeckung = await mitMeldung(() => stufeMitErgebnis(kette, "abdeckung", planId, {
    auftrag: { ...auftrag, planId },
    laufen: () => stufeAbdeckung(kette, kette.F, planId, pakete.ids),
    vorfinden: () => {
      kette.stufen.abdeckung = { dauerMs: 0, kennzahlen: null, text: null, grund: "aus einem frueheren Lauf vorgefunden — der Text steht in dessen Bericht", vorgefunden: true };
      return { ausgang: "fertig", vorgefunden: true };
    },
  }));
  if (abdeckung.ausgang !== "fertig") return { ...abdeckung, stufe: "abdeckung" };
  // Vor `vorDerUmsetzung`: Sonst wartete `ziel:pakete` bei `abdeckungUmsetzung: true` als
  // Variante A auf eine Freigabe, statt an seinem Ziel zu enden.
  const ohneUmsetzung = amZiel(kette, "abdeckung") ?? vorDerUmsetzung(kette, abdeckung);
  if (ohneUmsetzung) return ohneUmsetzung;
  // Die Paketliste kommt aus dem Stand der Stufe pakete (E16), nicht aus der
  // Ready-Spalte und nicht aus einer erneuten Abfrage nach Herkunft. Was davon schon
  // umgesetzt ist, laeuft nicht noch einmal (E9).
  const paketIds = kette.stufen.pakete?.ids ?? [];
  const umsetzung = await stufeMitErgebnis(kette, "umsetzung", planId, {
    auftrag: { ...auftrag, planId, paketIds },
    laufen: async () => {
      const vorgefunden = paketIds.filter((id) => paketUmgesetzt(leseKarte(id)));
      const ergebnis = await stufeUmsetzung(kette, paketIds.filter((id) => !vorgefunden.includes(id)));
      if (vorgefunden.length > 0) kette.stufen.umsetzung.vorgefundenePakete = vorgefunden;
      return ergebnis;
    },
    vorfinden: (v, vorher) => {
      kette.stufen.umsetzung = { umgesetzt: [], angehalten: [], zurueckgestellt: [], nichtBegonnen: [], dauerMs: 0, ...vorher, vorgefundenePakete: v.ids, vorgefunden: true };
      return { ausgang: "fertig", vorgefunden: true };
    },
  });
  if (umsetzung.ausgang !== "fertig") return { ...umsetzung, stufe: "umsetzung" };
  return nachDerUmsetzung(kette, umsetzung);
}

/**
 * Der Auftakt einer Kette: Protokollzeile, verbrauchtes Kennzeichen, Ausgangslage.
 *
 * Rueckgabe sind die aelteren Plaene zur Wurzel, die nach einem NEUEN Plan den
 * Ueberholt-Kommentar bekommen (A8). Beim Plan-Auftrag ist die Liste leer und die Stufe
 * `plan` stattdessen vorbelegt: Es entsteht kein neuer Plan, und der uebernommene ist
 * keiner, der einen anderen ueberholte — er ist der, den der Mensch gewaehlt hat. Leer
 * ist sie auch, wenn ein Plan vorgefunden wird (Issue #1086, E9): Die Stufe plan legt
 * dann keinen neuen an.
 */
function ketteBeginnen(kette, auftrag, nummer, args) {
  const karte = auftrag.karte;
  log(auftrag.art === "plan"
    ? `Kette ${nummer}/${args.max}: Plan #${auftrag.planId} (fachliche Quelle #${kette.F}) — ${karte.title}`
    : `Kette ${nummer}/${args.max}: Issue #${kette.F} — ${karte.title}`);
  // Das Kennzeichen ist mit dem Start verbraucht (A2): Ein Abbruch fuehrt zu einem
  // Bericht mit Grund und einer neuen Geste, nicht zur stillen Wiederholung.
  abh.board("issue", "label", "remove", String(karte.id), kette.budget.label);
  log(`  Label '${kette.budget.label}' entfernt — jedes Setzen autorisiert genau eine Kette.`);
  // Ziel und Prueferzahl gelten ebenso fuer genau diesen Lauf (E1): Sie stehen danach nur
  // noch in der Kette, eine stehengebliebene Angabe wirkte sonst still in der naechsten.
  kette.ziel = zielVon(karte, kette.budget);
  kette.planReviewer = pruefreihenVon(karte);
  const verbraucht = (karte.labels || []).filter((l) => String(l).startsWith(ZIEL_LABEL_PRAEFIX) || PLANREVIEW_LABELS.includes(l));
  for (const label of verbraucht) abh.board("issue", "label", "remove", String(karte.id), label);
  if (verbraucht.length > 0) {
    const namen = verbraucht.map((l) => "'" + l + "'").join(", ");
    log(`  Label ${namen} entfernt — Ziel ${kette.ziel ?? "keins"}, Pruefer ${kette.planReviewer ?? "nach Projekt"} festgehalten.`);
  }

  if (auftrag.art === "plan") {
    kette.stufen.plan = { id: auftrag.planId, uebernommen: true, dauerMs: 0, kennzahlen: null, korrekturrunden: 0, weitere: [] };
    log(`  Plan #${auftrag.planId} uebernommen — die Stufen plan und review entfallen.`);
    return [];
  }
  // Ein vorgefundener Plan (E9) ist das Ergebnis der Stufe plan, kein neuer: Er ueberholt
  // keinen anderen, und der Ueberholt-Kommentar entfaellt.
  if (ergebnisVorhanden("plan", { F: kette.F })) return [];
  // VOR der Plan-Stufe gesammelt: Danach stuende der neue Plan mit in der Liste.
  return abh.board("issue", "list")
    .filter((i) => stammtAusErzeugung(i, kette.F, "plan"))
    .map((i) => String(i.id));
}

/** Der Grund einer Kette, deren Karte beim Start das Startkennzeichen nicht mehr traegt (Issue #1263). */
export const KENNZEICHEN_ZURUECK_GRUND = "Startkennzeichen nach Laufbeginn zurückgenommen";

/**
 * Die gekennzeichnete Karte, wie sie beim Start der Kette am Board steht (Issue #1263):
 * `{ karte }` zum Fahren oder `{ grund }`, wenn die Kette nicht laufen darf.
 *
 * Die Auswahl gehoert dem Laufbeginn, die Labels dem Kettenstart: Die zweite Kette eines
 * Laufs startet oft eine Stunde spaeter, und was der Mensch bis dahin an Kennzeichen, Ziel
 * oder Prueferzahl aendert, gilt (Plan #1243, E1). Nimmt er das Kennzeichen zurueck oder
 * ist die Einstellung jetzt unpassend (E3), hat er das GO fuer diesen Stand zurueckgezogen.
 * Scheitert das Lesen, gilt der Stand vom Laufbeginn — ein Board-Fehler verhindert keine
 * Kette, die sonst liefe.
 */
function karteBeimStart(auftrag) {
  const alt = auftrag.karte;
  let karte;
  let plan = null;
  try {
    karte = abh.board("issue", "get", String(alt.id));
    const labels = karte?.labels || [];
    // Den Plan braucht `zielAusschluss` nur fuer `planreview:*` an einer Anforderung.
    if (auftrag.art === "fachplan" && PLANREVIEW_LABELS.some((l) => labels.includes(l))) {
      plan = juengsterPlanAmBoard(abh.board("issue", "list"), alt.id);
    }
  } catch (e) {
    log(`  #${alt.id} nicht frisch lesbar (${e.message}) — die Kette faehrt mit dem Stand vom Laufbeginn.`);
    return { karte: alt };
  }
  if (!(karte?.labels || []).includes(KETTE_BUDGET.label)) return { grund: KENNZEICHEN_ZURUECK_GRUND };
  const grund = zielAusschluss(karte, auftrag.art, plan);
  return grund ? { grund } : { karte: { ...alt, ...karte } };
}

/**
 * Eine Kette, die beim Start nicht mehr laufen darf (Issue #1263): verbucht wie eine beim
 * Laufbeginn uebersprungene Karte, mit dem Hinweis nach A9, ohne Label-Abnahme und ohne
 * Worktree. Der Vorab-Stand `laeuft` aus dem Beanspruchen wird zu `Kette nicht gestartet`
 * wie nach einem gescheiterten Vorflug; die `zuletzt`-Zeilen des Laufstands davor bleiben,
 * denn an ihnen findet der naechste Lauf vorhandene Ergebnisse (`ergebnisVorhanden`).
 */
function ketteNichtMehrFreigegeben(auftrag, nummer, args, grund) {
  const { id, title } = auftrag.karte;
  log(`Kette ${nummer}/${args.max}: #${id} beim Start nicht mehr freigegeben.`);
  uebersprungeneVerbuchen([{ id: String(id), title: title ?? "", grund }], [], KETTE_BUDGET.label, false);
  const zuletzt = String((auftrag.laufstandVorher ?? []).at(-1) ?? "").split("\n").filter((z) => z.startsWith("zuletzt "));
  const text = [`Kette nicht gestartet um ${abh.jetzt().toISOString()}: ${grund}`, zuletzt.join("\n")].filter(Boolean).join("\n\n");
  standSetzen(id, "abgebrochen", text, { budgetMs: ABBRUCH_BUDGET_MS });
  return { ausgang: "uebersprungen", vorbereitung: false, kette: null };
}

/**
 * Eine Kette zu einem Auftrag: Label verbrauchen, Worktree, Stufen, Einheit.
 *
 * Rueckgabe ist `{ ausgang, vorbereitung, kette }` (Plan #1243, Plan-Review Runde 2, Fund 2):
 * der Ausgang der Kette, ob sie die Vorbereitung des Laufs ausloest, und die Kette selbst,
 * deren Karte und Laufstand die Vorbereitung danach fortschreibt. Der Worktree wird in jedem
 * Fall entfernt — auch nach einem Wurf mitten in einer Stufe; ein liegengebliebener raeumt
 * der naechste Start.
 *
 * Ziel, Variante, Prueferzahl und die abzunehmenden Labels kommen aus dem Stand beim Start,
 * nicht aus der Liste des Laufbeginns (Issue #1263); ist die Karte dann nicht mehr
 * freigegeben, ist der Ausgang `uebersprungen` und `kette` ist `null`.
 */
async function laufeEineKette(auftrag, nummer, args) {
  const start = karteBeimStart(auftrag);
  if (start.grund) return ketteNichtMehrFreigegeben(auftrag, nummer, args, start.grund);
  return ketteMitKarte({ ...auftrag, karte: start.karte }, nummer, args);
}

/** Der Rumpf von `laufeEineKette`, mit der Karte vom Kettenstart. */
async function ketteMitKarte(auftrag, nummer, args) {
  const karte = auftrag.karte;
  const F = String(auftrag.F);
  const einheit = einheitAnlegen(String(karte.id), karte.title);
  const kette = {
    F, art: auftrag.art, karte, args, budget: KETTE_BUDGET, repoRoot: process.cwd(), wt: null, start: abh.jetzt(),
    kosten: { kostenSumme: 0, kostenUnbekannt: 0 }, kostenGrund: null, stufen: {},
    // Die Variante steht an der gekennzeichneten Karte, nicht an der Wurzel: Wer den
    // Plan durchziehen lassen will, zeichnet den Plan (Issue #895).
    variante: varianteVon(karte, KETTE_BUDGET),
    uebergaenge: KETTE_UEBERGAENGE,
    // Der Laufstand vor dem Vorab-Stand dieses Laufs (Issue #1090) — fuer die Ergebnispruefung.
    laufstandVorher: auftrag.laufstandVorher,
  };
  // Haelt der Lauf wegen der Umgebung an, sind die naechsten die Pakete des Auftrags ohne
  // Ergebnis (E15).
  Object.assign(LAUF_KONTEXT, {
    karte: String(karte.id),
    kandidaten: () => (kette.stufen.pakete?.ids ?? []).map(String).filter((id) => !paketUmgesetzt(leseKarte(id))),
  });
  const aeltere = ketteBeginnen(kette, auftrag, nummer, args);

  let ergebnis;
  try {
    kette.wt = worktreeAnlegen({ repoRoot: kette.repoRoot, issueId: F, stempel: ZUSTAND.LAUF_STEMPEL ?? String(abh.jetzt().getTime()) });
    // Nach dem Spiegel: Der Stand ueberschreibt die gespiegelte Kopie der Hauptkopie (Issue #1102, A3).
    kitStandInBaum(kette.wt);
    trackerImWorktreeUmleiten(kette.wt, kette.repoRoot);
    log(`  Worktree: ${kette.wt}`);
  } catch (e) {
    ergebnis = { ausgang: "abgebrochen", grund: `technischer Fehler: ${e.message}` };
  }
  try {
    if (!ergebnis) ergebnis = await stufenDerKette(kette);
    // `ohneHaltAmFachplan` setzt allein die Stufe umsetzung (E17): Dort traegt das
    // angehaltene PAKET bereits kit:klaeren, und ein zweites an der gekennzeichneten Karte
    // schloesse sie aus der naechsten Kette aus. Der Feldname bleibt der von E17.
    if (ergebnis.ausgang === "angehalten" && !ergebnis.ohneHaltAmFachplan) haltAmAuftrag(kette, ergebnis);
    // Endet die Kette, bevor sie einen Stand setzte — etwa am Worktree —, stuende sonst der
    // Vorab-Stand `laeuft` weiter an der Karte (Issue #1090, E17).
    if (!kette.standGesetzt) {
      const zustand = { abgebrochen: "abgebrochen", angehalten: "wartet" }[ergebnis.ausgang] ?? "fertig";
      ketteStand(kette, zustand, `${ergebnis.ausgang}: ${ergebnis.grund ?? "ohne Grund"}`);
    }
    const neuerPlan = kette.stufen.plan?.id;
    const ueberholung = neuerPlan && aeltere.length > 0
      ? aeltereUeberholen(kette, aeltere, neuerPlan)
      : { ueberholt: [], ueberholtUnbestaetigt: [] };
    einheitErgaenzen(einheit, {
      ausgang: ergebnis.ausgang,
      ...(ergebnis.grund ? { grund: ergebnis.grund } : {}),
      // Die Auftragsart und — nur beim Plan-Auftrag — die fachliche Wurzel (Issue #895):
      // Die Einheit traegt die Nummer der gekennzeichneten Karte, und ohne `fachplan`
      // waere von aussen nicht zu sehen, wogegen die Abdeckung gehalten hat.
      auftrag: kette.art,
      ...(kette.art === "plan" ? { fachplan: kette.F } : {}),
      variante: kette.variante,
      ...zielFelder(kette, ergebnis),
      stufen: kette.stufen,
      ...(ueberholung.ueberholt.length > 0 ? { ueberholt: ueberholung.ueberholt } : {}),
      ...(ueberholung.ueberholtUnbestaetigt.length > 0 ? { ueberholtUnbestaetigt: ueberholung.ueberholtUnbestaetigt } : {}),
      ...(kette.abdeckungSchrieb ? { abdeckungSchrieb: true } : {}),
      // Derselbe Feldname wie an der Einheit einer Implementierungsrunde (Issue #776) und
      // aus demselben Grund WEG statt `false`, wenn der Fall nicht eintrat: Ein `false`
      // behauptete eine Messung, die es nicht gab. Der Befund kommt aus dem Ergebnis der
      // Stufe und nicht aus dem Modul-Merker — die Begruendung steht in `ketteSession`.
      ...(ergebnis.wartend ? { wartendBeendet: true } : {}),
      kostenUsd: kette.kosten.kostenSumme,
      kostenUnbekannt: kette.kosten.kostenUnbekannt,
    });
    // Der Bericht ist der letzte Schritt jeder Kette, bei jedem Ausgang (A10) — nach dem
    // Halt-Kommentar, damit er hinter der Frage steht, und vor dem Abbau des Worktrees.
    // Adressat ist die gekennzeichnete Karte, wie beim Halt (Issue #896).
    einheitErgaenzen(einheit, { bericht: berichtSchreiben(String(karte.id), berichtFuerKette(kette, einheit, ergebnis)) });
  } finally {
    if (kette.wt) {
      befundeZurueckUndVorschlagen(kette);
      worktreeEntfernen(kette.wt, kette.repoRoot);
    }
  }
  const zusatz = ergebnis.grund ? ` — ${ergebnis.grund}` : "";
  log(`  Kette zu Issue #${F}: ${ergebnis.ausgang}${zusatz} (${kette.kosten.kostenSumme.toFixed(2)} $).`);
  return { ausgang: ergebnis.ausgang, vorbereitung: ergebnis.vorbereitung === true, kette };
}

/** Ziel und Projektgrenze fuer die Einheit, nur wenn gesetzt (E5, E6): Ohne Ziel bleibt der Bericht wie bisher. */
function zielFelder(kette, ergebnis) {
  if (!kette.ziel) return {};
  return { ziel: kette.ziel, ...(ergebnis.projektgrenze ? { projektgrenze: true } : {}) };
}

/** Die Hinweise zu Labels, die es nicht mehr gibt (Fachplan #635, Kriterium 12). */
function warneVorAltenLabels(issues) {
  for (const issue of issues) {
    for (const alt of ALTE_ROUTING_LABELS) {
      if ((issue.labels || []).includes(alt)) {
        log(`Hinweis: #${issue.id} traegt das Label '${alt}', das es seit Stufe 2 nicht mehr gibt — es hat keine Wirkung. Die Nacht-Kette startet ueber '${KETTE_BUDGET.label}' an der fachlichen Anforderung oder am Plandokument.`);
      }
    }
  }
}

/** Die Bestaetigungsfrist des Beanspruchens (Plan #1113, E4), ab dem eigenen Schreiben. */
export const BESTAETIGUNGSFRIST_MS = 10_000;

const bestaetigungsfristMs = () => (process.env.NIGHT_BESTAETIGUNG_MS !== undefined
  ? Number(process.env.NIGHT_BESTAETIGUNG_MS)
  : BESTAETIGUNGSFRIST_MS);

/** Der Grund, mit dem ein Runner eine Wurzel auslaesst, die ein anderer haelt (Kriterium 3 aus #1014). */
export const beanspruchtGrund = (laufId) => `bereits von einem laufenden Runner beansprucht (${laufId})`;

/** Der Name des Labels `laeuft` aus `night.stand.labels` — dieselbe Vorgabe wie in kit/board.mjs. */
const laeuftLabel = () => ZUSTAND.config?.night?.stand?.labels?.laeuft?.trim() || "lauf:laeuft";

/**
 * Die Laufstand-Kommentare einer gelesenen Karte und ihr juengster Stand fuer
 * `wurzelBelegt` — `zustand` ist `laeuft`, wenn die Karte das Label traegt.
 */
function laufstandDerKarte(karte) {
  const texte = kommentareVon(karte).filter((k) => k.startsWith("## Laufstand"));
  const zustand = (karte?.labels || []).includes(laeuftLabel()) ? "laeuft" : null;
  return { texte, stand: texte.length > 0 ? { zustand, text: texte.at(-1) } : null };
}

/**
 * Die erste Haelfte des Beanspruchens fuer eine Karte: lesen und, wenn kein lebender Runner
 * sie haelt, unmittelbar danach `laeuft` schreiben. Rueckgabe `{ grund }` fuer eine
 * ausgelassene Karte, sonst `{}`, mit `uebernommen`, wenn ein toter Halter abgeloest wurde.
 */
function lesenUndSchreiben(a, { lesen, schreiben, host, eintrag }) {
  const id = String(a.karte.id);
  const karte = lesen(id);
  if (!karte) return { grund: "Laufstand nicht lesbar — nicht beansprucht" };
  const { texte, stand } = laufstandDerKarte(karte);
  const halter = wurzelBelegt(a.F, [karte], stand ? { [id]: stand } : {}, abh.jetzt(), host);
  if (halter) return { grund: beanspruchtGrund(halter.laufId) };
  const alt = stand?.zustand === "laeuft" ? laufstandKopf(stand.text) : null;
  if (alt) log(`  #${id}: Wurzel #${a.F} uebernommen — der Runner ${alt.laufId} laeuft nicht mehr.`);
  a.laufstandVorher = texte;
  schreiben(id, "laeuft", eintrag);
  return alt ? { uebernommen: { id, laufId: alt.laufId } } : {};
}

/**
 * Beansprucht die Wurzeln der ausgewaehlten Auftraege am Board (Plan #1113, E3, E4, E7;
 * Issue #1188). Das Board kennt kein bedingtes Schreiben, darum je Karte: lesen, schreiben,
 * warten, wiederlesen.
 *
 * Traegt der gelesene Laufstand eine lebende Lauf-ID (`wurzelBelegt`), schreibt der Runner
 * nicht und laesst die Karte aus. Sonst schreibt er unmittelbar `laeuft`; der gelesene
 * Laufstand wird zu `laufstandVorher` (Grundlage von `ergebnisVorhanden`), nie einer mit
 * lebender Lauf-ID. Haelt ihn ein Runner, der nicht mehr laeuft (E5), nennt das Protokoll
 * die Uebernahme mit der alten Lauf-ID. Nach dem letzten Schreiben wartet er die Frist
 * einmal fuer alle Karten ab — jede liegt so mindestens die Frist hinter ihrem Schreiben —
 * und liest wieder: Gehoert der juengste Laufstand dann ihm, ist die Wurzel seine, denn
 * `issue stand` ersetzt immer den juengsten und der letzte Schreiber gewinnt. Sonst traegt
 * er die Karte im Journal als `abgegeben` aus und schreibt nichts mehr an sie.
 *
 * Eingespeist fuer die Tests: `lesen` (`issue get`), `schreiben` (`standSetzen`), `warten`,
 * `abgeben`, die eigene `laufId` und der Rechner `host`. Rueckgabe `{ beansprucht,
 * abgegeben, uebernommen }`; `abgegeben` traegt `{ id, title, grund }` wie `uebersprungen`.
 */
export function beanspruchen(auftraege, {
  lesen = leseKarte,
  schreiben = (karte, zustand, text) => standSetzen(karte, zustand, text),
  warten = abh.schlaf,
  abgeben: austragen = (karte) => abgeben(karte),
  laufId = `${RECHNER}/${process.pid}/${ZUSTAND.LAUF_STEMPEL}`,
  host = RECHNER,
  frist = bestaetigungsfristMs(),
} = {}) {
  const eintrag = `Lauf angenommen um ${abh.jetzt().toISOString()}, Vorabprüfung läuft`;
  const geschrieben = [];
  const abgegeben = [];
  const uebernommen = [];
  const auslassen = (a, grund) => abgegeben.push({ id: String(a.karte.id), title: a.karte.title ?? "", grund });
  for (const a of auftraege) {
    const gelesen = lesenUndSchreiben(a, { lesen, schreiben, host, eintrag });
    if (gelesen.grund) auslassen(a, gelesen.grund);
    else geschrieben.push(a);
    if (gelesen.uebernommen) uebernommen.push(gelesen.uebernommen);
  }
  if (geschrieben.length > 0) warten(frist);
  const beansprucht = [];
  for (const a of geschrieben) {
    const id = String(a.karte.id);
    const karte = lesen(id);
    const juengster = karte ? laufstandKopf(laufstandDerKarte(karte).stand?.text) : null;
    if (juengster?.laufId === laufId) {
      beansprucht.push(a);
      continue;
    }
    austragen(id);
    auslassen(a, karte ? beanspruchtGrund(juengster?.laufId ?? "ohne Lauf-ID") : "Bestaetigung nicht lesbar — nicht beansprucht");
  }
  return { beansprucht, abgegeben, uebernommen };
}

/**
 * Wer haelt welche Wurzel (Issue #1188)? Gelesen werden nur Karten mit dem Label `laeuft`,
 * die eine Wurzel tragen koennen: eine gekennzeichnete Karte, ihre fachliche Quelle und
 * die Plaene zu ihr. Rueckgabe ist `belegt(F)` fuer `waehleKettenKandidaten` und
 * `waehlePruefLaufKandidaten`.
 */
export function belegteWurzeln(alle, label) {
  const wurzeln = new Set();
  for (const i of alle.filter((k) => (k?.labels || []).includes(label))) {
    wurzeln.add(String(i.id));
    const quelle = isPlan(i?.title ?? "") ? fachlicheQuelleVon(i?.body || "") : null;
    if (quelle) wurzeln.add(quelle);
  }
  const lesbar = (i) => wurzeln.has(String(i.id)) || (isPlan(i?.title ?? "") && wurzeln.has(fachlicheQuelleVon(i?.body || "")));
  const staende = new Map();
  for (const i of alle.filter((k) => (k?.labels || []).includes(laeuftLabel()) && lesbar(k))) {
    const karte = leseKarte(i.id);
    const stand = karte ? laufstandDerKarte(karte).stand : null;
    if (stand) staende.set(String(i.id), stand);
  }
  const jetzt = abh.jetzt();
  return (F) => wurzelBelegt(F, alle, staende, jetzt, RECHNER);
}

/**
 * Der Vorab-Stand (Issue #1090, E17), seit #1188 das Beanspruchen mit Bestaetigung: Stirbt
 * der Lauf in der Vorabpruefung, zeigt die Karte, dass er sie angenommen hatte
 * (Belegfall 1). Nicht im Trockenlauf — er veraendert kein Label. Seit #1189 geht auch der
 * Prueflauf diesen Weg, mit seinen Karten als eigene Wurzel. Der Laufstand vorher steht
 * danach am Auftrag (E10).
 */
export function vorabStandSetzen(args, auftraege) {
  if (args.dryRun) return { beansprucht: auftraege, abgegeben: [] };
  auftraege.forEach((a, i) => laufPositionSetzen(a.karte.id, { k: i + 1, n: auftraege.length }));
  return beanspruchen(auftraege);
}

/**
 * Programm Kette (Plan #638): Kandidaten, Vorflug, Dry-Run, dann Kette fuer Kette.
 * Beendet den Prozess selbst, wie der Dry-Run der Implementierung — ueber `beenden`, und
 * gibt dessen Rueckgabe zurueck.
 *
 * `abhaengigkeiten` ersetzt Eintraege aus `KETTE_ABHAENGIGKEITEN` fuer die Dauer des Laufs
 * (Issue #1233, Plan #1199, E6); nicht genannte bleiben die echten. Danach gilt wieder der
 * Stand davor.
 */
export async function laufeKette(args, abhaengigkeiten = {}) {
  for (const name of Object.keys(abhaengigkeiten)) {
    if (!Object.hasOwn(KETTE_ABHAENGIGKEITEN, name)) throw new Error(`laufeKette kennt keine Abhaengigkeit '${name}'`);
  }
  const vorher = { ...abh };
  Object.assign(abh, abhaengigkeiten);
  try {
    return await ketteFahren(args);
  } finally {
    Object.assign(abh, vorher);
  }
}

/**
 * Die Ketten nacheinander, danach einmal die Vorbereitung fuer die, die sie ausloesen
 * (Plan #1243, A4) — erst dann baut dieser Runner nichts mehr. Rueckgabe sind die Ausgaenge
 * gezaehlt.
 */
async function kettenUndVorbereitung(auftraege, args) {
  // `uebersprungen` zaehlt die Ketten, die beim Start nicht mehr freigegeben waren (Issue #1263).
  const zaehler = Object.fromEntries([...KETTE_AUSGAENGE, "uebersprungen"].map((a) => [a, 0]));
  const ausloesend = [];
  let nummer = 0;
  for (const auftrag of auftraege) {
    nummer++;
    const { ausgang, vorbereitung, kette } = await laufeEineKette(auftrag, nummer, args);  // NOSONAR S9382: Ketten laufen einzeln, sonst raeumen sie sich die Worktrees weg
    zaehler[ausgang]++;
    if (vorbereitung) ausloesend.push(kette);
  }
  if (ausloesend.length > 0) await vorbereitungLaufen(ausloesend);
  return zaehler;
}

async function ketteFahren(args) {
  const budget = KETTE_BUDGET;
  const repoRoot = process.cwd();
  const defaultsZeile = budgetDefaultsZeile(budget, KETTE_BUDGET_AUS_DEFAULT);
  if (defaultsZeile) log(defaultsZeile);
  if (!args.dryRun) {
    for (const p of worktreesAufraeumen(repoRoot)) log(`Liegengebliebenen Worktree entfernt: ${p}`);
  }
  const alle = abh.board("issue", "list");
  warneVorAltenLabels(alle);
  const auswahl = waehleKettenKandidaten(alle, budget.label, args.max, { belegt: belegteWurzeln(alle, budget.label) });
  const { liegengeblieben } = auswahl;
  uebersprungeneVerbuchen(auswahl.uebersprungen, alle, budget.label, args.dryRun);
  for (const l of liegengeblieben) {
    log(`  #${l.id} ${l.title} -> ueber --max ${args.max}, bleibt liegen.`);
    einheitErgaenzen(einheitAnlegen(l.id, l.title), { ausgang: "liegengeblieben" });
  }

  // Direkt nach der Auswahl beanspruchen (E7): Wer die Bestaetigung verliert, weicht wie
  // eine belegte Wurzel aus der Auswahl.
  const { beansprucht: auftraege, abgegeben } = vorabStandSetzen(args, auswahl.kandidaten);
  uebersprungeneVerbuchen(abgegeben, alle, budget.label, args.dryRun);
  const uebersprungen = [...auswahl.uebersprungen, ...abgegeben];
  // Vorflug, Nicht-gestartet-Kommentar und Tracker-Probe arbeiten mit Karten, nicht mit
  // Auftraegen (Issue #895): Ihr Verhalten haengt an keiner der beiden Auftragsarten.
  const kandidaten = auftraege.map((a) => a.karte);
  if (kandidaten.length === 0 && uebersprungen.length === 0 && !alle.some((i) => (i.labels || []).includes(budget.label))) {
    const vorhanden = [...new Set(alle.flatMap((i) => i.labels || []))];
    log(`WARNUNG: keine Karte traegt das Label '${budget.label}' — es wird nichts verarbeitet.`);
    log(`  Vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
  }

  // Der Reviewer-Vorflug bleibt (A16): Die Pruefer-Session braucht die Reviewer in ihrer
  // eigenen Sandbox, und die Vorflug-Session ist die einzige Probe dafuer.
  await anbindung.fuehreVorflug(args, kandidaten, "--kette --dry-run", (grund) => ketteNichtGestartet(kandidaten, grund));

  if (kandidaten.length === 0) {
    if (uebersprungen.length > 0) {
      vermerkeOhneArbeit("ketteAlleUebersprungen", { anzahl: uebersprungen.length, label: budget.label });
    } else {
      vermerkeOhneArbeit("ketteKeinLabel", { label: budget.label });
    }
    anbindung.laufAbschliessen("regulaer");
    return abh.beenden(0);
  }

  if (args.dryRun) {
    log(`Budget: Plan ${budget.planMin} min, Pakete ${budget.paketeMin} min, Review ${budget.reviewMin} min, Abdeckung ${budget.abdeckungMin} min, ${budget.kostenUsd} $ je Kette, ${budget.korrekturrunden} Korrekturrunde(n).`);
    auftraege.forEach((a, i) => {
      const art = a.art === "plan" ? `Plan-Auftrag, fachliche Quelle #${a.F}, ` : "";
      log(`  #${a.karte.id} ${a.karte.title} -> Kette ${i + 1} (${art}Variante ${varianteVon(a.karte, budget)})`);
    });
    log(`Dry-Run beendet: ${auftraege.length} Kette(n) wuerden laufen — kein Worktree, kein Label veraendert.`);
    return abh.beenden(0);
  }

  MENSCHENSCHRITTE_OFFEN.clear();
  const zaehler = await kettenUndVorbereitung(auftraege, args);
  const menschenschritte = MENSCHENSCHRITTE_OFFEN.size > 0 ? `, ${MENSCHENSCHRITTE_OFFEN.size} Menschenschritt(e) offen` : "";
  log(`Nacht-Kette beendet: ${zaehler.fertig} fertig, ${zaehler.unvollstaendig} unvollstaendig, ${zaehler.angehalten} angehalten, ${zaehler.abgebrochen} abgebrochen, ${uebersprungen.length + zaehler.uebersprungen} uebersprungen, ${liegengeblieben.length} liegengeblieben, ${NICHT_BEGONNEN_GESAMT} Paket(e) nicht begonnen${menschenschritte}.`);
  log(`Morgen-Ritual: Plaene und Pakete sichten, Abdeckung lesen, Pakete nach Ready ziehen — das GO bleibt deins. Nach Variante A liegen die Pakete morgens in Backlog; Variante B (Label '${budget.varianteBLabel}') hat sie in derselben Nacht umgesetzt, sie stehen dann in In review. Protokoll: ${ZUSTAND.LOG_FILE}`);
  anbindung.laufAbschliessen("regulaer");
  return abh.beenden(0);
}
