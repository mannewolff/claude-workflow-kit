#!/usr/bin/env node
/**
 * claude-workflow-kit Pruef-Auswahl und -Ausfuehrung (Issues #423, #424)
 *
 * `plan` entscheidet, welche Pruefungen nach einem Arbeitspaket laufen muessen —
 * und gibt die Entscheidung als Daten zurueck, ohne sie auszufuehren. `run` fuehrt
 * genau diese Auswahl aus und hinterlaesst das Ergebnis als Zusammenfassung, aus
 * der der Nacht-Runner liest.
 *
 * Die Zusammenfassung BEGLEITET den Lauf (Issue #857): geschrieben vor dem ersten
 * Kommando, erneut vor jedem weiteren, ein letztes Mal am Ende — und nur diese
 * letzte Fassung traegt `abgeschlossen: true`. Daraus folgt, was ein Abbruch
 * hinterlaesst: einen Stand, in dem das Kommando, waehrend dessen der Lauf starb,
 * noch `nicht gestartet` ist. Der Lauf ist dann nie ganz gruen, und das ist dieselbe
 * sichere Richtung wie ueberall hier — ein gestorbener Pruefer gilt als
 * beanstandend, nicht als ungemessen.
 *
 * Warum ein Kommando und keine Regel im Skilltext: Die Sessions dieses Projekts
 * haben dreimal belegt, dass eine Regel im Prompt nicht wirkt, wenn sie unter
 * Druck steht (Issue #267, 2026-08-12, Issue #410). Eine Auswahl, die falsch
 * ausfaellt, nimmt Pruefung weg — der Fehler geht in die unsichere Richtung und
 * faellt niemandem auf.
 *
 * Deshalb irrt dieses Kommando nur in eine Richtung: mehr pruefen. Drei Ausgaenge
 * setzen das durch:
 *   - Eine geaenderte Datei, die kein Muster trifft -> `vollerUmfang: true`,
 *     alles laeuft. Nicht abschaltbar.
 *   - Ein Anker, der sich nicht aufloesen laesst -> ebenso voller Umfang. Ein
 *     LEERER `--since`-Wert zaehlt dabei wie ein nicht aufloesbarer, nie wie ein
 *     fehlender: Er entsteht, wenn im /local-check-Skill die
 *     merge-base-Substitution fehlschlaegt. Als "nicht angegeben" gelesen griffe
 *     der Default HEAD, und auf sauberem Tree liefe keine einzige Pruefung.
 *   - Eine fehlende Config -> Abbruch mit Exit ungleich 0. Ein Kommando, das
 *     ohne Config stillschweigend "nichts zu pruefen" meldet, zeigt genau dorthin,
 *     wo der Fehler niemandem auffaellt.
 *
 * `run` UEBERNIMMT sein eigenes Ergebnis, wenn sich der Stand seit dem letzten Lauf
 * nicht geaendert hat (Issue #863): gleicher Anker, gleiche Stufe, dieselbe
 * Dateiliste mit denselben Blob-Hashes, dieselbe Config — und eine abgeschlossene
 * Zusammenfassung. Dann laeuft kein Kommando, und `run` schreibt denselben Befund
 * mit frischem Zeitpunkt erneut, damit das Commit-Gate seinen Nachweis behaelt.
 * `--frisch` erzwingt den echten Lauf. Das ist keine Bequemlichkeit, sondern
 * dieselbe Erfahrung wie oben: Die Regel „Ausgabe einmal in eine Datei, daraus
 * lesen" (Issue #835) steht seit Langem im Skilltext, und die Sessions starteten
 * denselben gruenen Lauf trotzdem drei- bis neunmal je Paket. Ein Ergebnis
 * wiederzuverwenden nimmt dabei keine Pruefung weg: Derselbe Inhalt liefert
 * dasselbe Urteil, und schon ein einziges abweichendes Byte faellt zurueck in den
 * vollen Weg.
 *
 * In dieselbe Richtung irrt die MERKMAL-PRUEFUNG von `run` (Issue #858): Es liest
 * nicht nur den Rueckgabewert, sondern prueft die Ausgabe jedes Kommandos auf eine
 * feste Liste allgemeiner Fehlermerkmale (`FEHLERMERKMALE`). Ein
 * Treffer laesst die Pruefung fehlschlagen, auch bei Rueckgabewert 0 — und ein
 * falsches Rot ist hier die sichere Richtung: Es kostet eine Nachfrage, waehrend
 * ein falsches Gruen ein gescheitertes Paket nach In review traegt.
 *
 * Neben den Bereichen waehlt das Kommando nach einer STUFE aus (Issue #758):
 * `--stufe paket|push|merge` sagt, welcher Zeitpunkt gefahren wird. Die Stufen
 * sind kumulativ — `push` faehrt `paket` mit, `merge` alle drei —, ein Eintrag
 * ohne `stufe` gilt als Paketstufe, und damit bleibt jede bestehende Config
 * unveraendert. Die beiden Achsen beantworten Verschiedenes: `areas`/`always`
 * sagen, OB eine Pruefung betroffen ist, `stufe` sagt, WANN sie an der Reihe ist.
 *
 * An den beiden VEROEFFENTLICHUNGSSTUFEN `push` und `merge` faellt die erste
 * Achse weg: Dort laeuft jede faellige Pruefung, auch bei leerem Paket und
 * unberuehrten Bereichen (Plan #843, E9). Gemessen wird der Stand, der hinausgeht
 * — und der besteht aus mehr als dem letzten Arbeitspaket.
 *
 * `--bereich <name>` faehrt die Pruefgruppen genau eines `checkAreas`-Bereichs
 * (Issue #922, Plan #917, E3). Es ist der vorgesehene Weg, wenn fuer die
 * geaenderte Datei nur die vollstaendige Gruppe existiert — dann ist der
 * Gruppenlauf kein Verstoss gegen die Zehn-Minuten-Marke, sondern der Fall, fuer
 * den das Flag da ist. Ohne es waere derselbe Lauf von Hand am Kommando vorbei
 * gefahren, und aus den Daten liesse sich Notwendigkeit nicht von Umgehung
 * trennen.
 *
 * Aufruf im Projekt-Root:  node .claude/kit/checks.mjs plan [--since <ref>] [--stufe <s>] [--bereich <name>]
 *                          node .claude/kit/checks.mjs run  [--since <ref>] [--stufe <s>] [--bereich <name>] [--frisch]
 *
 * Die Ausgabe von `plan` ist immer JSON, es gibt kein --json-Flag: `board.mjs
 * issue get` liefert ebenfalls JSON ohne Flag, und eine zweite Ausgabeform waere
 * zweite Pflege. `run` schreibt fuer Menschen und legt seine maschinenlesbare
 * Fassung in der Zusammenfassung ab.
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit
 * liefert seine Werkzeuge als eigenstaendig portable Einzeldateien aus. Deshalb
 * traegt die Datei auch ihre eigene Minimal-Glob-Fassung statt eines Pakets.
 */

import { lstatSync, existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.3.2";

// Ort der Zusammenfassung, die `run` hinterlaesst (Issue #424, Entscheidung A4 des
// Plans #421): derselbe Ort wie das Nachtprotokoll (`LOG_FILE` in night.mjs) — im
// Projekt, aber hinter der Ignore-Regel `.claude/*`. Damit bleibt der Working Tree
// sauber und der harte Stopp auf dirty (Issue #152) greift nicht.
//
// Fester Dateiname, kein Zeitstempel: Der Nacht-Runner loescht die Datei vor jeder
// Session (Issue #428), es zaehlt also immer nur der Lauf der laufenden Session —
// und innerhalb einer Session der letzte. Eine Session darf `run` mehrfach fahren
// (rot, Fix, erneut), daraus entsteht bewusst keine Historie.
const SUMMARY_DATEI = ".claude/checks-summary.json";

// Das Ausfuehrungsprotokoll (Issue #785, Plan #782, E17) — die Zaehleinheit, die der
// Zusammenfassung daneben fehlt.
//
// Die Zusammenfassung traegt bewusst keine Historie (Kommentar zu SUMMARY_DATEI): Der
// Nacht-Runner loescht sie vor jeder Session, und innerhalb einer Session ueberschreibt
// jeder `run` den vorigen. Die Wirksamkeits-Auswertung fragt aber, wie oft eine Pruefung
// lief und wie oft sie beanstandet hat — und genau diese Zahl verliert die
// Zusammenfassung: Eine Pruefung, die rot anschlaegt, worauf die Session den Mangel
// behebt und erneut prueft, hinterliesse dort einen gruenen Endstand. Sie erschiene als
// "nie beanstandet" und loeste damit genau den Befund aus, der zu ihrer Abschaffung
// einlaedt — die Kennzahl truege systematisch das falsche Vorzeichen.
//
// Deshalb eine eigene Datei, angehaengt und nie geleert, nach dem Muster der Wegmarken
// (board-9). Derselbe Ort wie die Zusammenfassung: im Projekt, aber hinter der
// Ignore-Regel `.claude/*`.
//
// MESSGRENZE (E17): Die Salvage-Pruefungen des Nacht-Runners rufen die Kommandos roh
// ueber spawnSync auf und laufen an checks.mjs vorbei; ihre Ausfuehrungen stehen hier
// nicht. Der Salvage ist ein Rettungsversuch am Rand eines gescheiterten Pakets, keine
// Pruefung eines Arbeitspakets — ihn mitzuzaehlen mischte zwei Zaehleinheiten.
//
// SYNC: kit/night.mjs nimmt denselben Pfad im Rest-Guard aus (`:(exclude)` in gitReste,
// dazu der Worktree-Spiegel), kit/wirksamkeit.mjs liest die Datei. Die Kit-Werkzeuge sind
// bewusst eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440), geteilte
// Konstanten werden dupliziert und hier markiert.
const AUSFUEHRUNGEN_DATEI = ".claude/ausfuehrungen.tsv";

// Altlast aus SDD, Rueckbau mit dem uebernaechsten Major (Plan #825, A5): Bis zum
// Rueckbau von Spec-Driven Development legte `/techplan` wartende Vorhaben-Notizen hier
// ab. Heute entsteht keine mehr, aber in Zielprojekten kann noch eine liegen — kein
// Code-Zustand, also keine geaenderte Datei eines Arbeitspakets.
//
// Der Ausschluss steht ausdruecklich im Code, obwohl `.gitignore` den Pfad meist
// schon deckt: Der Installer laesst eine vorhandene eigene `.claude`-Regel
// unangetastet, also gibt es Projekte ohne den Block. Dort waere die Notiz sonst
// sichtbar und wuerde eine Pruefung ausloesen, zu der sie nicht gehoert.
//
// Praefix, kein Teilstring: Genau diese Menge nimmt `:(exclude).claude/vorhaben-wartend-*`
// in `gitClean()` von night.mjs aus. Ein Teilstring-Match traefe zusaetzlich
// `sub/.claude/vorhaben-wartend-x.md` in einem Unterprojekt — die Datei waere hier
// unsichtbar und im Rest-Guard ein Rest.
const WARTEND_PRAEFIX = ".claude/vorhaben-wartend-";

/**
 * Der Pfad der Zusammenfassung. Exportiert, damit night.mjs ihn importieren kann,
 * statt ihn ein zweites Mal auszurechnen (Issue #428) — derselbe Grund, aus dem
 * `run` seine Auswahl von `plan` bezieht und nicht neu berechnet.
 */
export function zusammenfassungPfad(root = process.cwd()) {
  return join(root, ...SUMMARY_DATEI.split("/"));
}

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt.
 *
 * Ausgeschrieben statt weggelassen, damit an jeder Fundstelle steht, dass die
 * Reihenfolge Absicht ist (S2871). Bewusst **nicht** `localeCompare`: Dessen
 * Reihenfolge haengt an der Locale der Maschine, und zwei Laeufe muessen
 * ueberall dieselbe Liste ergeben — Dateiliste und Bereichsnamen stehen im
 * Bericht und in der Zusammenfassung.
 *
 * SYNC: dieselbe Funktion steckt in kit/befunde.mjs, kit/night.mjs und
 * kit/wirksamkeit.mjs — Aenderungen dort nachziehen. Die Kit-Werkzeuge sind bewusst eigenstaendige
 * Single-File-Tools ohne gemeinsames Modul (#440); geteilte Logik wird dupliziert
 * und hier markiert.
 *
 * Exportiert, damit der Locale-Test sie direkt pruefen kann (Issue #493).
 */
export function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Rangfolge der Pruefzeitpunkte (Issue #758). Die Reihenfolge IST die Regel: Eine
// Pruefung ist faellig, sobald der Index ihrer Stufe den der gefahrenen nicht
// uebersteigt — daraus folgt die Kumulation, ohne sie zweitens aufzuschreiben.
const STUFEN = ["paket", "push", "merge"];

/**
 * Die allgemeinen Fehlermerkmale (Issue #858, Fachplan #769, AK 2): Merkmale, an
 * denen eine Ausgabe ihr Scheitern selbst ausweist, auch wenn der Rueckgabewert 0
 * ist. Genau der Fall kommt vor — eine Maven-Kette, deren letztes Glied den
 * Rueckgabewert verschluckt, meldet `BUILD FAILURE` in der Ausgabe und endet mit 0.
 *
 * Die Liste ist FEST und hat kein Config-Feld (Plan #810, E3). Ein Feld waere die
 * Einladung, sie in dem Projekt zu leeren, in dem sie gerade stoert — also an genau
 * der Stelle, an der sie gebraucht wird. Ein Projekt, dessen gruene Ausgabe legitim
 * eines der Merkmale traegt, filtert es in seinem `cmd` selbst heraus (die Doku
 * nennt den Weg): eine Entscheidung, die im Projekt sichtbar bleibt, statt die
 * Pruefung fuer alle abzuschalten.
 *
 * Steht hier oben und nicht bei `fehlermerkmal`, weil `HELP` die Liste nennt — ein
 * `const` weiter unten waere dort noch nicht initialisiert.
 */
const FEHLERMERKMALE = ["[ERROR]", "BUILD FAILURE"];

const HELP = `checks.mjs (claude-workflow-kit v${KIT_VERSION}) — faellige Pruefungen

  node checks.mjs plan [--since <ref>] [--stufe <stufe>] [--bereich <name>]
  node checks.mjs run  [--since <ref>] [--stufe <stufe>] [--bereich <name>] [--frisch]

plan  Gibt als JSON aus, welche buildChecks nach dem aktuellen Arbeitspaket
      laufen muessen und welche ausgelassen werden koennen — jede Entscheidung
      mit Grund. Ausgefuehrt wird nichts.
run   Fuehrt genau diese Auswahl sequenziell aus, bricht beim ersten roten Check
      ab (Exit ungleich 0) und schreibt die Zusammenfassung nach
      ${SUMMARY_DATEI}.
      Neben dem Rueckgabewert prueft 'run' die Ausgabe jedes Kommandos auf eine
      feste Liste allgemeiner Fehlermerkmale (${FEHLERMERKMALE.join(", ")}). Ein
      Treffer faerbt die Pruefung rot, auch bei Rueckgabewert 0 — kein
      Config-Feld schaltet das ab. Ein falsches Rot ist die sichere Richtung:
      Das Kommando irrt nur in eine Richtung, mehr pruefen.
      Die Zusammenfassung BEGLEITET den Lauf: Sie entsteht vor dem ersten
      Kommando und wird vor jedem weiteren ueberschrieben; das laufende
      Kommando steht darin noch auf 'nicht gestartet'. Erst die letzte Fassung
      traegt 'abgeschlossen': true. Ein Lauf, der an der Uhr oder mit seiner
      Session stirbt, hinterlaesst damit einen Stand, der nie ganz gruen ist.
      Hat sich der Stand seit dem letzten Lauf nicht geaendert — gleicher Anker,
      gleiche Stufe, dieselben Dateien mit denselben Blob-Hashes, dieselbe
      Config —, laeuft kein Kommando: 'run' uebernimmt das Ergebnis des
      vorigen Laufs (auch ein rotes) samt Exitcode und schreibt den Nachweis
      mit frischem Zeitpunkt neu. '--frisch' erzwingt den echten Lauf.

  --since <ref>   Anker, gegen den die Aenderungen ermittelt werden (Default HEAD).
                  Laesst sich der Anker nicht aufloesen — auch bei leerem Wert —,
                  laufen alle Pruefungen.
  --stufe <s>     Gefahrener Zeitpunkt: ${STUFEN.join(" | ")} (Default ${STUFEN[0]}).
                  Kumulativ — push faehrt paket mit, merge alle drei. Pruefungen
                  spaeterer Stufen erscheinen mit Grund als ausgelassen. Die
                  Veroeffentlichungsstufen (push, merge) fahren jede faellige
                  Pruefung, auch bei leerem Paket und unberuehrten Bereichen.
  --bereich <n>   Faehrt die Pruefgruppen genau eines checkAreas-Bereichs, statt
                  die beruehrten aus den geaenderten Dateien zu bestimmen. Der
                  vorgesehene Weg, wenn fuer die geaenderte Datei nur die
                  vollstaendige Gruppe existiert — ein so begruendeter
                  Gruppenlauf ist kein Verstoss gegen die Zehn-Minuten-Marke,
                  sondern sein sanktionierter Fall. Ein unbekannter Name bricht
                  ab und nennt die konfigurierten Bereiche. Kombinierbar mit
                  --since, --stufe und --frisch: '--bereich' sagt, OB eine
                  Pruefung betroffen ist, '--stufe' weiter, WANN sie dran ist.
  --frisch        Nur fuer 'run': kein Ergebnis uebernehmen, alle faelligen
                  Kommandos wirklich fahren — etwa beim Verdacht auf einen
                  wackligen Test.
  --help, -h      Diese Uebersicht (laeuft als einziger Aufruf ohne Config).

Gelesen wird .claude/workflow.config.json im Arbeitsverzeichnis: 'buildChecks'
(Kommandostring, { cmd, areas }, { cmd, always } oder { cmd, stufe }) und
'checkAreas' (Bereichsname -> Pfadmuster). Muster kennen '*' innerhalb eines
Pfadsegments und '**' ueber Segmentgrenzen; ein Verzeichnis erfasst man als
'frontend/**'.
`;

class ChecksError extends Error {}

function fail(nachricht) {
  throw new ChecksError(nachricht);
}

function git(...args) {
  return spawnSync("git", args, { cwd: process.cwd(), encoding: "utf-8" });
}

// --- Config ----------------------------------------------------------------

function ladeConfig() {
  const pfad = join(process.cwd(), ".claude", "workflow.config.json");
  if (!existsSync(pfad)) {
    fail(`Keine .claude/workflow.config.json unter ${process.cwd()} — bitte im Projekt-Root starten.`);
  }
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (err) {
    return fail(`.claude/workflow.config.json ist kein gueltiges JSON: ${err.message}`);
  }
}

/**
 * Die String-Form und das Objekt nur mit `cmd` bedeuten dasselbe.
 *
 * Die fehlende `stufe` wird hier auf `paket` gesetzt und nicht erst bei der
 * Auswahl (Issue #758): So laufen die String-Form, das Objekt ohne `stufe` und
 * das Objekt mit `stufe: "paket"` durch dieselbe Bahn, und jede bestehende
 * Config behaelt ihr Verhalten. Ein Default, der an jeder Lesestelle einzeln
 * nachgezogen wuerde, waere die naechste Stelle, an der er einmal fehlt.
 */
function normalisiere(check) {
  const objekt = typeof check === "string" ? { cmd: check } : check;
  return { ...objekt, stufe: objekt.stufe ?? STUFEN[0] };
}

/**
 * Ein vertippter Bereichsname wuerde eine Pruefung still nie laufen lassen —
 * genau der Fehler, den dieses Kommando verhindern soll. Also Abbruch.
 *
 * Ein LEERES `areas`-Array und die Kombination `areas` + `always` sind hier
 * nicht zu pruefen: Das Schema schliesst beide aus (minItems 1, not). Was das
 * Schema verhindert, muss die Laufzeit nicht erklaeren (Issue #422).
 */
// SYNC: dieselbe Regel prueft kit/einstellungen.mjs (regelBereiche) vor dem Speichern.
function pruefeBereichsnamen(checks, checkAreas) {
  const bekannt = new Set(Object.keys(checkAreas));
  for (const check of checks) {
    for (const name of check.areas ?? []) {
      if (!bekannt.has(name)) {
        const liste = bekannt.size > 0 ? [...bekannt].join(", ") : "keine";
        fail(`Unbekannter Bereich '${name}' bei Pruefung '${check.cmd}'. Bekannt aus checkAreas: ${liste}.`);
      }
    }
  }
}

/**
 * Die Grenzen der Guetemessung (Issue #763, Plan #753): hoechstens ein Eintrag
 * traegt `guete`, und nie mit `stufe: "merge"` — eine Messung erst vor der
 * Freigabe kaeme zu spaet, um noch etwas zu aendern. Beides prueft das Schema
 * nicht: Es sind Aussagen ueber die Liste bzw. ueber zwei Felder zusammen.
 * Derselbe Weg wie beim unbekannten Bereichsnamen: Abbruch statt stiller Wahl.
 */
// SYNC: dieselbe Regel prueft kit/einstellungen.mjs vor dem Speichern (Issue #764).
function pruefeGuete(checks) {
  const traeger = checks.filter((check) => check.guete);
  if (traeger.length > 1) {
    const liste = traeger.map((check) => `'${check.cmd}'`).join(", ");
    fail(`Mehr als eine Guetemessung: ${liste} tragen alle 'guete' — hoechstens ein Eintrag darf messen.`);
  }
  if (traeger[0]?.stufe === "merge") {
    fail(`Die Guetemessung '${traeger[0].cmd}' traegt stufe 'merge' — eine Messung erst vor der Freigabe kaeme zu spaet. Zulaessig: paket oder push.`);
  }
}

// --- Muster ----------------------------------------------------------------

const REGEX_SONDERZEICHEN = /[.+?^${}()|[\]\\]/;

/**
 * Minimal-Glob: '*' innerhalb eines Pfadsegments, '**' ueber Segmentgrenzen,
 * '/' als Trenner. Ein '**' samt folgendem Trenner darf ganz verschwinden, damit
 * ein Muster wie "doppelstern, Trenner, *.md" auch eine Datei im
 * Wurzelverzeichnis trifft und nicht erst eine in einem Unterverzeichnis.
 *
 * Exportiert, damit test/config-teile.test.mjs die Teile dieses Repos gegen
 * `git ls-files` prueft, ohne die Aufloesung ein zweites Mal zu schreiben
 * (Issue #850) — derselbe Grund wie bei `blobHashes` fuer befunde.mjs: Ab der
 * ersten Abweichung bescheinigte die zweite Fassung eine Abdeckung, die das
 * ausfuehrende Kommando nicht sieht.
 */
export function globZuRegex(muster) {
  let quelle = "";
  let i = 0;
  while (i < muster.length) {
    const zeichen = muster[i];
    if (zeichen !== "*") {
      quelle += REGEX_SONDERZEICHEN.test(zeichen) ? `\\${zeichen}` : zeichen;
      i += 1;
    } else if (muster[i + 1] === "*") {
      const mitTrenner = muster[i + 2] === "/";
      quelle += mitTrenner ? "(?:.*/)?" : ".*";
      i += mitTrenner ? 3 : 2;
    } else {
      quelle += "[^/]*";
      i += 1;
    }
  }
  return new RegExp(`^${quelle}$`);
}

/** Die Teile aus der Config als fertige Regexe. Exportiert aus demselben Grund wie `globZuRegex`. */
export function bereicheVorbereiten(checkAreas) {
  return Object.entries(checkAreas).map(([name, muster]) => ({
    name,
    regexe: (muster ?? []).map((m) => globZuRegex(m)),
  }));
}

/**
 * Ordnet jede geaenderte Datei ihren Bereichen zu. Die erste Datei, die kein
 * einziges Muster trifft, wird als `ohneMuster` gemeldet — sie loest den vollen
 * Umfang aus und gehoert in den Grund, sonst weiss niemand, welches Muster fehlt.
 *
 * Daneben steht `ohneZuordnung` mit ALLEN solchen Dateien (Issue #922, Plan
 * #917, E8): Der Beobachter fragt, welche Dateien kein Muster finden — nicht,
 * welche es als erste tat. Beides nebeneinander und nicht das eine aus dem
 * anderen: Der Grund-Text ist Text fuer Menschen und wird woertlich gelesen, die
 * Liste sind Daten. Wer die Liste aus dem Satz parsen muesste, haette beim ersten
 * Umformulieren des Satzes eine stille Fehlmessung.
 */
function zuordnen(dateien, bereichsdefinition) {
  const beruehrt = new Set();
  const ohneZuordnung = [];
  for (const pfad of dateien) {
    const treffer = bereichsdefinition.filter((b) => b.regexe.some((r) => r.test(pfad)));
    if (treffer.length === 0) {
      ohneZuordnung.push(pfad);
      continue;
    }
    for (const bereich of treffer) beruehrt.add(bereich.name);
  }
  return { beruehrt, ohneMuster: ohneZuordnung[0] ?? null, ohneZuordnung };
}

// --- Aenderungen -----------------------------------------------------------

function ankerAufloesen(refText) {
  // Der leere Wert wird gar nicht erst gefragt: Er ist die Spur einer
  // fehlgeschlagenen merge-base-Substitution und gilt als nicht aufloesbar.
  if (refText === "") return null;
  const res = git("rev-parse", "--verify", "--short", `${refText}^{commit}`);
  const basis = res.stdout.trim();
  return res.status === 0 && basis ? basis : null;
}

/**
 * Zerlegt die NUL-getrennte Ausgabe von `git diff --name-status -z`. Eine
 * Umbenennung (R) und eine Kopie (C) tragen zwei Pfade — beide zaehlen, denn eine
 * verschobene Datei aendert an beiden Enden etwas.
 */
function* diffPfade(roh) {
  const felder = roh.split("\0");
  let i = 0;
  while (i < felder.length) {
    const status = felder[i];
    i += 1;
    if (!status) continue;
    const anzahl = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let n = 0; n < anzahl && i < felder.length; n += 1, i += 1) {
      if (felder[i]) yield felder[i];
    }
  }
}

function* untracktePfade(roh) {
  for (const eintrag of roh.split("\0")) {
    if (eintrag.startsWith("?? ")) yield eintrag.slice(3);
  }
}

/**
 * Alles, was das Arbeitspaket beruehrt hat: getrackte Aenderungen gegen den
 * Anker (angelegt, geaendert, geloescht, umbenannt) plus Ungetracktes.
 * `--untracked-files=all` ist Pflicht — sonst meldet git ein neues Verzeichnis
 * als einen einzigen Eintrag, und die Datei darin faende nie ihr Muster.
 *
 * Wartende Vorhaben-Notizen fallen hier heraus und nicht erst in `blobHashes`
 * (Issue #546): So beruehrt eine Notiz auch keine `checkAreas` und loest keinen
 * Bereichs-Check aus, zu dem sie nicht gehoert. Der Filter greift damit zugleich
 * fuer `hashes`, die Bereichszuordnung und die Zusammenfassung — alle leiten sich
 * aus `geaendert` ab. Bleibt danach nichts uebrig, ist das Paket leer: Was nicht
 * gestagt werden darf, muss auch nicht geprueft werden.
 */
function geaenderteDateien(basis) {
  const dateien = new Set();

  const diff = git("diff", "--name-status", "-z", basis);
  if (diff.status !== 0) fail(`git diff gegen '${basis}' schlug fehl: ${diff.stderr.trim()}`);
  for (const pfad of diffPfade(diff.stdout)) dateien.add(pfad);

  const status = git("status", "--porcelain", "-z", "--untracked-files=all");
  if (status.status !== 0) fail(`git status schlug fehl: ${status.stderr.trim()}`);
  for (const pfad of untracktePfade(status.stdout)) dateien.add(pfad);

  // Nach dem Trenner-Normalisieren gefiltert: Unter Windows kaeme der Pfad sonst
  // mit Backslash und der Praefix-Vergleich ginge daneben.
  return [...dateien]
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => !p.startsWith(WARTEND_PRAEFIX))
    .sort(vergleicheText);
}

// --- Auswahl ---------------------------------------------------------------

function bereichsText(namen) {
  return `${namen.length === 1 ? "Bereich" : "Bereiche"} ${namen.join(", ")}`;
}

/**
 * String und `always: true` laufen beide immer, meinen aber Verschiedenes —
 * vergessen gegen entschieden. Nur der Grund haelt das auseinander.
 */
function entscheidung(check, beruehrt) {
  if (check.always) return { laeuft: true, grund: "als immer laufend festgelegt" };
  if (!check.areas) return { laeuft: true, grund: "nicht zugeordnet" };
  const treffer = check.areas.filter((name) => beruehrt.has(name));
  return treffer.length > 0
    ? { laeuft: true, grund: `${bereichsText(treffer)} beruehrt` }
    : { laeuft: false, grund: `${bereichsText(check.areas)} unberuehrt` };
}

/**
 * Verteilt jede Pruefung auf `laufen` oder `ausgelassen` — in der Reihenfolge der
 * Config, damit beide Listen so lesbar bleiben wie die Datei.
 *
 * Die STUFENAUSWAHL GREIFT VOR der Bereichsauswahl (Issue #758): Wer nicht dran
 * ist, wird gar nicht erst gefragt, ob er betroffen waere. Andersherum stuende im
 * Grund einer ausgelassenen Push-Pruefung „Bereich unberuehrt", obwohl sie auch
 * im beruehrten Bereich nicht gelaufen waere — ein Grund, der auf die falsche
 * Ursache zeigt, kostet beim naechsten Lesen mehr, als er erklaert.
 *
 * `entscheiden` bekommt nur die faelligen Pruefungen und beantwortet die zweite
 * Frage: die des jeweiligen Auswahlfalls (Anker, leeres Paket, Bereiche).
 *
 * Die GUETEMESSUNG laeuft oberhalb der Paketstufe IMMER (Issue #763, E11): AK 8
 * des Fachplans (#738) macht ihr Ergebnis fuer den Stand massgeblich, der
 * veroeffentlicht werden soll — eine wegen leeren Pakets oder unberuehrten
 * Bereichs ausgelassene Messung liesse den Halt ins Leere laufen, und das faellt
 * niemandem auf. An der Paketstufe gilt die normale Auswahl: Dort wird ein
 * Arbeitspaket gemessen, kein Veroeffentlichungsstand. Der Eintrag behaelt
 * seinen `guete`-Block, damit `ausfuehren` die Auswertung nicht ein zweites Mal
 * aus der Config lesen muss.
 */
function verteilen(checks, stufe, entscheiden) {
  const laufen = [];
  const ausgelassen = [];
  const gefahren = STUFEN.indexOf(stufe);
  for (const check of checks) {
    let ergebnis;
    if (check.guete && stufe !== STUFEN[0]) {
      ergebnis = { laeuft: true, grund: "Guetemessung: laeuft vor dem Veroeffentlichen immer" };
    } else if (STUFEN.indexOf(check.stufe) <= gefahren) {
      ergebnis = entscheiden(check);
    } else {
      ergebnis = { laeuft: false, grund: `Stufe ${check.stufe}, gefahren wird ${stufe}` };
    }
    const eintrag = { cmd: check.cmd, stufe: check.stufe, grund: ergebnis.grund };
    if (check.guete) eintrag.guete = check.guete;
    (ergebnis.laeuft ? laufen : ausgelassen).push(eintrag);
  }
  return { laufen, ausgelassen };
}

/**
 * `ohneZuordnung` hat die Vorgabe `[]` und wird nie aus etwas anderem erschlossen
 * (Issue #922): Ein voller Umfang wegen eines nicht aufloesbaren Ankers kennt gar
 * keine Dateiliste — dort stuende sonst ein erfundener Eintrag, und der Beobachter
 * zaehlte eine Luecke, die es nicht gibt.
 */
function bauen({ basis, stufe, geaendert = [], bereiche = [], ohneZuordnung = [], laufen = [],
  ausgelassen = [], vollerUmfang = false, leeresPaket = false, bereichWahl = null }) {
  // `bereichWahl` traegt den Namen des Bereichs, auf den `--bereich` die Auswahl
  // eingegrenzt hat, sonst null. Das Feld ist kein Schmuck, sondern die Marke eines
  // TEILNACHWEISES: Ein Bereichslauf bestimmt `geaendert` und `hashes` weiterhin aus
  // dem Anker und saehe darum aus wie ein vollstaendiger Lauf. Zwei Leser brauchen den
  // Unterschied — die Wiederverwendung darf ein eingegrenztes Ergebnis nicht fuer einen
  // vollen Lauf ausgeben (frueheresErgebnis), und das Commit-Gate darf auf ihm nicht
  // committen lassen (.githooks/gate.mjs).
  return { basis, stufe, geaendert, bereiche, ohneZuordnung, laufen, ausgelassen, vollerUmfang, leeresPaket, bereichWahl };
}

function planen(args) {
  const config = ladeConfig();
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const checkAreas = config.checkAreas ?? {};
  pruefeBereichsnamen(checks, checkAreas);
  pruefeGuete(checks);

  // Derselbe Weg wie beim vertippten Bereichsnamen einer Pruefung: Abbruch statt
  // stiller Wahl. Ein Tippfehler im Flag liefe sonst auf einen Bereich, den keine
  // Pruefung kennt — es liefe nichts ausser `always`, und der Aufrufer hielte die
  // Gruppe fuer gefahren.
  const bereichWahl = args.bereich ?? null;
  if (bereichWahl !== null && !Object.hasOwn(checkAreas, bereichWahl)) {
    const namen = Object.keys(checkAreas);
    fail(`Unbekannter Bereich '${bereichWahl}'. Konfiguriert in checkAreas: ${namen.length > 0 ? namen.join(", ") : "keiner"}.`);
  }

  const stufe = args.stufe ?? STUFEN[0];
  const refText = args.since ?? "HEAD";
  const basis = ankerAufloesen(refText);
  if (basis === null) {
    // Der Zweifelsfall behaelt seinen eigenen Grund, auch an der Freigabestufe:
    // Dort laeuft ohnehin alles, aber WARUM ist verschieden — entschieden gegen
    // nicht gewusst.
    const grund = `voller Umfang: Anker '${refText}' laesst sich nicht aufloesen`;
    return bauen({
      basis: refText, stufe, vollerUmfang: true,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund })),
    });
  }

  const geaendert = geaenderteDateien(basis);
  const { beruehrt, ohneMuster, ohneZuordnung } = zuordnen(geaendert, bereicheVorbereiten(checkAreas));
  const bereiche = [...beruehrt].sort(vergleicheText);

  // Der BEREICHSLAUF (Issue #922, Plan #917, E3): Nicht der Diff sagt, welche
  // Bereiche beruehrt sind, sondern der Aufrufer. Das ist der sanktionierte Weg
  // fuer den Fall, dass fuer die geaenderte Datei nur die vollstaendige Gruppe
  // existiert — ohne ihn liefe dieselbe Gruppe von Hand am Kommando vorbei, und
  // niemand koennte Verstoss und Notwendigkeit auseinanderhalten.
  //
  // Die Wahl steht VOR den Sonderwegen darunter (Veroeffentlichungsstufe, leeres
  // Paket, Datei ohne Muster): Jeder von ihnen wuerde die Eingrenzung wieder
  // aufheben, um die es beim Aufruf gerade ging. Nicht davor steht der
  // Zweifelsfall des nicht aufloesbaren Ankers — dort ist gar nichts bekannt, und
  // dieses Kommando irrt in diese Richtung nie.
  //
  // Die STUFENACHSE bleibt unberuehrt: `--bereich` beantwortet, OB eine Pruefung
  // betroffen ist, `--stufe` weiter, WANN sie an der Reihe ist. Der Grund traegt
  // das Praefix, damit im Bericht steht, warum die Auswahl so ausfiel.
  if (bereichWahl !== null) {
    const gewaehlt = new Set([bereichWahl]);
    return bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung, bereichWahl,
      ...verteilen(checks, stufe, (check) => {
        const ergebnis = entscheidung(check, gewaehlt);
        return { laeuft: ergebnis.laeuft, grund: `Bereichslauf ${bereichWahl}: ${ergebnis.grund}` };
      }),
    });
  }

  // Die Veroeffentlichungsstufen faehren jede faellige Pruefung (Plan #753, E12;
  // fuer die Push-Stufe Plan #843, E9 nach Fachplan #837, AK 11): Ihr Ergebnis
  // gilt fuer den Stand, der hinausgeht, und der besteht aus mehr als dem letzten
  // Arbeitspaket. Eine Auslassung wegen leeren Pakets oder unberuehrten Bereichs
  // zeigte hier auf den falschen Vergleich — deshalb greift keine von beiden.
  // `basis`, `geaendert`, `bereiche` und (in `run`) `hashes` bleiben trotzdem aus
  // dem Anker bestimmt: Sie sind der Nachweis, gegen den das Commit-Gate den Index
  // prueft (gate-1), und nicht Teil der Auswahl.
  //
  // Die Kumulation bleibt davon unberuehrt: Was spaeter dran ist, bleibt aus. Die
  // Stufe sagt weiter, WANN eine Pruefung laeuft — nur die Eingrenzung unter den
  // faelligen entfaellt.
  //
  // `vollerUmfang` bleibt dabei false — das Feld markiert den Zweifelsfall
  // („wir wissen es nicht, also alles"), und diese Stufen sind das Gegenteil
  // davon: eine Entscheidung. Denselben Unterschied halten String-Form und
  // `always: true` auseinander.
  if (stufe === "push" || stufe === "merge") {
    const grund = "Veroeffentlichungsstufe: voller Umfang";
    return bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund })),
    });
  }

  if (geaendert.length === 0) {
    const grund = `leeres Paket: keine Aenderung seit ${basis}`;
    return bauen({
      basis, stufe, leeresPaket: true,
      ...verteilen(checks, stufe, () => ({ laeuft: false, grund })),
    });
  }

  if (ohneMuster !== null) {
    const grund = `voller Umfang: '${ohneMuster}' trifft kein Muster`;
    return bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung, vollerUmfang: true,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund })),
    });
  }

  return bauen({
    basis, stufe, geaendert, bereiche, ohneZuordnung,
    ...verteilen(checks, stufe, (check) => entscheidung(check, beruehrt)),
  });
}

// --- Ausfuehrung (Issue #424) ----------------------------------------------

/**
 * Liest den env-Block aus .claude/settings.json (falls vorhanden) — uebernommen
 * aus `settingsEnv` in night.mjs, nicht neu erfunden.
 *
 * Dort stehen projektspezifische Variablen (z.B. DOCKER_HOST /
 * TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE fuer Testcontainers unter Colima), die
 * Claude Code seinen eigenen Bash-Aufrufen automatisch mitgibt. checks.mjs ist
 * aber ein eigener Node-Prozess ausserhalb von Claude Code und bekommt sie sonst
 * nicht — ohne sie ein falsches Rot (beobachtet bei kanban-kit #445: mvn verify
 * schlug ohne die beiden Variablen mit Mockito-MockMaker-Fehlern fehl).
 *
 * Precedence wie in Claude Code: settings.json zuerst, settings.local.json
 * gewinnt. Die local-Datei ist gitignored und damit der uebliche Ort fuer
 * maschinenspezifische Werte — genau die, die hier fehlen wuerden (Issue #168).
 */
function settingsEnv() {
  const merged = {};
  for (const name of ["settings.json", "settings.local.json"]) {
    const pfad = join(process.cwd(), ".claude", name);
    if (!existsSync(pfad)) continue;
    try {
      const settings = JSON.parse(readFileSync(pfad, "utf-8"));
      if (settings.env && typeof settings.env === "object") Object.assign(merged, settings.env);
    } catch {
      // Kaputtes JSON blockiert den Lauf nicht — nur diese eine Quelle faellt aus.
    }
  }
  return merged;
}

/**
 * Fuehrt ein konfiguriertes Kommando aus.
 *
 * Eine Shell ist hier zwingend — anders als in board.mjs, wo Issue #196 sie gerade
 * abgeschafft hat. Der Unterschied: Dort stehen die Kommandos fest im Code und
 * lassen sich als Argument-Array uebergeben. Hier ist `cmd` eine frei konfigurierte
 * Kommandozeile aus der workflow.config.json ("mvn verify", "npm --prefix frontend
 * run build"), die Operatoren und Umleitungen enthalten darf. Ohne Shell gaebe es
 * das Feature nicht.
 *
 * Statt fest "sh" zu starten (das es unter Windows nicht gibt, Issue #199) waehlt
 * Node mit shell:true die Shell der Plattform: /bin/sh auf POSIX, die ComSpec-Shell
 * (im Regelfall cmd.exe) unter Windows. Bewusst nicht PowerShell: Der Wert ist eine
 * Nutzer-Konfiguration, und cmd.exe ist das, was ein Windows-Nutzer beim Eintragen
 * eines Build-Kommandos erwartet; PowerShell haette zudem eine eigene
 * Operator-Syntax (kein && vor Version 7).
 *
 * PATH-Aufloesung bewusst (S4036, Issue #183).
 *
 * Die Ausgabe wird eingesammelt und von uns geschrieben statt via stdio:"inherit"
 * durchgereicht: nur so steht sie garantiert zwischen der eigenen Kopf- und
 * Fusszeile und nicht irgendwo dazwischen.
 */
function kommandoAusfuehren(cmd, env) {
  const res = spawnSync(cmd, { cwd: process.cwd(), encoding: "utf-8", env, shell: true });
  // status ist null, wenn der Prozess durch ein Signal endete oder gar nicht erst
  // startete — beides ist rot, nie gruen.
  return { gruen: res.status === 0, ausgabe: `${res.stdout || ""}${res.stderr || ""}` };
}

/**
 * Das erste getroffene Merkmal der festen Liste oder `null`.
 *
 * Exportiert, damit die Gegenprobe an echten Maven-Logs
 * (`test/checks-fehlermerkmal.test.mjs`, Fixtures unter `test/fixtures/`) DIESE
 * Funktion trifft und keine Kopie: Eine zweite Fassung im Test bescheinigte ab der
 * ersten Abweichung eine Pruefung, die das ausfuehrende Kommando nicht macht —
 * derselbe Grund wie bei `globZuRegex` und `blobHashes`.
 *
 * Erst getroffen heisst: erstes Merkmal der LISTE, nicht der Ausgabe. Welches von
 * zwei Merkmalen weiter oben in einem Log steht, sagt ueber die Ursache nichts.
 */
// SYNC: dieselbe Pruefung traegt kit/night.mjs (fehlermerkmal samt FEHLERMERKMALE)
// fuer die Salvage-Vorpruefung des Runners; test/guete-wertung-sync.test.mjs haelt
// beide an derselben Fallliste gegeneinander.
export function fehlermerkmal(ausgabe) {
  return FEHLERMERKMALE.find((merkmal) => ausgabe.includes(merkmal)) ?? null;
}

/**
 * Blob-Hash je Pfad — der Nachweis, gegen den das Commit-Gate den Index prueft.
 *
 * Zwei Entscheidungen stecken hier drin, beide aus Issue #469:
 *
 * `null` haengt an der NICHTEXISTENZ (`lstat` -> ENOENT), nicht am Exit-Code von
 * `git hash-object`. Waere es der Exit-Code, bekaeme eine vorhandene, nur
 * unlesbare Datei denselben Tombstone wie eine geloeschte — und das Gate liest
 * ihn als "geprufte Loeschung". `lstat` statt `stat`, damit ein toter Symlink als
 * vorhanden gilt und nicht stillschweigend zum Tombstone wird.
 *
 * Gehasht wird ueber `git hash-object --stdin-paths`, also EIN Prozess statt einer
 * je Datei: Bei vollem Umfang stehen leicht hundert Pfade in `geaendert`, und die
 * CI faehrt eine Windows-Matrix, wo Prozessstarts teuer sind. Der Aufruf traegt
 * die Pfade und nicht den Inhalt, damit gits Filterkette (`autocrlf`, `clean`)
 * greift — sonst passte der Hash nicht zu dem Blob, den `git ls-files --stage`
 * dem Gate zeigt.
 *
 * Exportiert, damit befunde.mjs denselben Blob-Hash ermitteln kann, statt die
 * Frage ein zweites Mal zu implementieren (Issue #802) — derselbe Grund, aus dem
 * `zusammenfassungPfad` fuer night.mjs exportiert ist (Issue #428).
 */
export function blobHashes(pfade) {
  const hashes = {};
  const vorhanden = [];
  for (const pfad of pfade) {
    try {
      lstatSync(join(process.cwd(), pfad));
      vorhanden.push(pfad);
    } catch (err) {
      if (err.code !== "ENOENT") {
        fail(`Der Stand von '${pfad}' liess sich nicht lesen: ${err.message}`);
      }
      hashes[pfad] = null;
    }
  }
  if (vorhanden.length === 0) return hashes;

  const res = spawnSync("git", ["hash-object", "--stdin-paths"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    input: `${vorhanden.join("\n")}\n`,
  });
  if (res.status !== 0) {
    fail(`git hash-object schlug fehl: ${(res.stderr || "").trim()}`);
  }
  const zeilen = res.stdout.split("\n").filter((z) => z.length > 0);
  if (zeilen.length !== vorhanden.length) {
    fail(`git hash-object lieferte ${zeilen.length} Hashes fuer ${vorhanden.length} Pfade.`);
  }
  vorhanden.forEach((pfad, i) => {
    hashes[pfad] = zeilen[i];
  });
  return hashes;
}

/**
 * Liest den Anteil aus der Ausgabe der Guetemessung (Issue #763, Plan #753).
 *
 * Das Muster ist Pflicht, weil die Werkzeuge Verschiedenes melden — PIT
 * schreibt `Killed 42 (84%)`, Stryker `Mutation score: 84.21`. Die erste
 * Gruppe gilt als Prozentwert, wie die Marke: eine Einheit, keine zwei.
 *
 * Jeder Weg ohne Zahl endet mit `erfuellt: false` und einem Grund (E10):
 * "Ein fehlendes Ergebnis gilt nie als bestandene Pruefung" (AK 11, #738) —
 * dieselbe Richtung, in die dieses Kommando ueberall irrt: mehr pruefen, nie
 * weniger. Das gilt auch fuer ein Muster, das sich nicht uebersetzen laesst:
 * Die Konfigurationspruefung faengt es frueher (Issue #764), aber hier darf es
 * trotzdem nicht als bestanden durchrutschen.
 *
 * Zwei dieser Wege sahen bis Issue #817 nach einer Zahl aus, ohne eine zu sein:
 * `Number("")` und `Number("   ")` sind 0, und 0 genuegt der Marke 0 — eine
 * leere Gruppe bescheinigte so eine Messung, die es nie gab. Und ein Anteil
 * ausserhalb von 0 bis 100 ist keiner: Kein Werkzeug meldet 184 Prozent, der
 * Wert entsteht aus einem verbogenen Muster und sagt ueber die Guete nichts.
 * Beides ist ein nicht auswertbares Ergebnis und damit rot.
 */
// SYNC: dieselbe Wertung traegt kit/night.mjs (gueteAuswerten) fuer die
// Salvage-Vorpruefung des Runners; test/guete-wertung-sync.test.mjs haelt beide
// an derselben Fallliste gegeneinander.
export function gueteAuswerten(guete, ausgabe) {
  let regex;
  try {
    regex = new RegExp(guete.muster);
  } catch (err) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' ist kein regulaerer Ausdruck: ${err.message}` };
  }
  const treffer = regex.exec(ausgabe);
  if (treffer === null) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' trifft die Ausgabe nicht` };
  }
  if (treffer[1] === undefined) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' hat keine Gruppe` };
  }
  if (treffer[1].trim() === "") {
    return { anteil: null, erfuellt: false, grund: `Gruppe '${treffer[1]}' ist leer` };
  }
  const anteil = Number(treffer[1]);
  if (!Number.isFinite(anteil)) {
    return { anteil: null, erfuellt: false, grund: `Gruppe '${treffer[1]}' ist keine Zahl` };
  }
  if (anteil < 0 || anteil > 100) {
    return { anteil: null, erfuellt: false, grund: `Anteil ${anteil} liegt ausserhalb von 0 bis 100 Prozent` };
  }
  const erfuellt = anteil >= guete.marke;
  return { anteil, erfuellt, grund: erfuellt ? "genuegt" : "unter der Marke" };
}

/**
 * Das Ergebnisfeld der Zusammenfassung fuer einen gelaufenen Guete-Eintrag.
 * Ein rotes Kommando wird nicht ausgewertet: Seine Ausgabe ist der Stand eines
 * Abbruchs, und ein darin zufaellig gefundener Anteil bescheinigte eine
 * Messung, die es nicht gab.
 *
 * WARUM der Lauf rot war, weiss der Aufrufer und nicht diese Funktion — der
 * Rueckgabewert oder ein Fehlermerkmal in der Ausgabe (Issue #858). Deshalb kommt
 * `grund` von dort: Ein hier festverdrahteter Satz behauptete bei einem Kommando
 * mit Rueckgabewert 0 das Falsche, und der Grund steht in der Zusammenfassung,
 * aus der der Nacht-Runner liest.
 */
function gueteErgebnis(eintrag, gruen, ausgabe, grund) {
  const auswertung = gruen
    ? gueteAuswerten(eintrag.guete, ausgabe)
    : { anteil: null, erfuellt: false, grund };
  return {
    cmd: eintrag.cmd,
    anteil: auswertung.anteil,
    marke: eintrag.guete.marke,
    erfuellt: auswertung.erfuellt,
    grund: auswertung.grund,
  };
}

function gueteZeile(ergebnis) {
  return ergebnis.anteil === null
    ? `Guete: kein auswertbares Ergebnis (${ergebnis.grund})`
    : `Guete: ${ergebnis.anteil} % erreicht, Marke ${ergebnis.marke} % — ${ergebnis.grund}`;
}

/**
 * Das Ergebnisfeld, wenn die Messung nicht lief — nicht gestartet (ein
 * frueheres Kommando war rot) oder an der Paketstufe ausgelassen. Auch das
 * steht in der Zusammenfassung: "kein Ergebnis" ist ein Ergebnis und nie ein
 * Bestehen, und wer die Datei liest, sieht, dass kein Anteil erhoben wurde.
 */
function gueteOhneLauf(laufen, ausgelassen) {
  const geplant = laufen.find((e) => e.guete);
  if (geplant) {
    return { cmd: geplant.cmd, anteil: null, marke: geplant.guete.marke, erfuellt: false, grund: "nicht gestartet: ein frueheres Kommando war rot" };
  }
  const eintrag = ausgelassen.find((e) => e.guete);
  if (eintrag) {
    return { cmd: eintrag.cmd, anteil: null, marke: eintrag.guete.marke, erfuellt: false, grund: `ausgelassen: ${eintrag.grund}` };
  }
  return null;
}

/**
 * Maskiert die Trennzeichen des Protokolls im Kommando (Issue #822).
 *
 * Eine Zeile des Protokolls ist zeilen- und tabgetrennt, und `cmd` steht frei
 * konfiguriert dazwischen: Ein Kommando mit Zeilenumbruch zerriss ohne Maskierung
 * seine eigene Zeile, und die Auswertung sah zwei fehlerhafte Zeilen statt einer
 * Ausfuehrung — die Pruefung stuende dort als "nicht gelaufen".
 *
 * Der Backslash wird ZUERST verdoppelt: sonst liesse sich ein echtes `\n` im Kommando
 * nach dem Lesen nicht mehr von einem maskierten Zeilenumbruch unterscheiden.
 *
 * SYNC: kit/wirksamkeit.mjs wandelt in `kommandoLesen` zurueck. Die Kit-Werkzeuge sind
 * eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440); geteilte Logik wird
 * dupliziert und an beiden Enden markiert.
 */
function kommandoMaskieren(cmd) {
  return cmd
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("\t", String.raw`\t`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll("\r", String.raw`\r`);
}

/**
 * Haengt eine Ausfuehrung an `.claude/ausfuehrungen.tsv` an (Issue #785).
 *
 * Eine Zeile je BEENDETEM Kommando: Zeitpunkt, Kommando, Ergebnis, Dauer. Ein Kommando
 * mit dem Ergebnis `nicht gestartet` bekommt keine — es ist keine Ausfuehrung, und als
 * Zeile gezaehlt senkte es den Anteil der Beanstandungen einer Pruefung, die gar nicht
 * lief.
 *
 * Angehaengt, nie geleert — sonst saehe die Auswertung nur die letzte Runde, und genau
 * die zweite Runde nach einem Fix ist der Fall, um den es geht.
 *
 * Scheitert das Schreiben, bleibt es bei einem Hinweis auf stderr: Das Protokoll ist
 * Buchhaltung, keine Bedingung — dieselbe Haltung wie bei der Wegmarke in board.mjs.
 * Ausgang und Ausgabe von `run` bleiben davon unberuehrt; anders als die Zusammenfassung,
 * deren Ausfall `fail` ausloest, weil der Nacht-Runner aus ihr seine Entscheidung liest.
 */
function ausfuehrungSchreiben(cmd, ergebnis, dauerMs, jetzt = new Date()) {
  const pfad = join(process.cwd(), ...AUSFUEHRUNGEN_DATEI.split("/"));
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    appendFileSync(pfad, `${jetzt.toISOString()}\t${kommandoMaskieren(cmd)}\t${ergebnis}\t${dauerMs}\n`, "utf-8");
  } catch (err) {
    process.stderr.write(`Hinweis: Ausfuehrung nicht protokolliert (${pfad}): ${err.message}\n`);
  }
}

/**
 * Die Summe der gemessenen Dauern — `null`, wenn nichts gemessen wurde.
 *
 * Steht als eigene Funktion, seit die Zusammenfassung mehrfach im Lauf geschrieben
 * wird (Issue #857): Jede Fassung traegt den Stand, den sie bezeugt, und "nichts
 * gemessen" ist kein Nullbetrag — weder beim leeren Paket noch vor dem ersten
 * Kommando.
 */
function dauerGesamt(laufen) {
  const gemessen = laufen.filter((e) => e.dauerMs !== null);
  return gemessen.length > 0 ? gemessen.reduce((summe, e) => summe + e.dauerMs, 0) : null;
}

function schreibeZusammenfassung(daten) {
  const pfad = zusammenfassungPfad();
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, JSON.stringify(daten, null, 2) + "\n", "utf-8");
  } catch (err) {
    // Die Datei ist die Datenquelle des Nacht-Runners; ihr Ausfall darf nicht
    // stillschweigend durchgehen, auch nicht bei gruenen Checks.
    fail(`Zusammenfassung konnte nicht geschrieben werden (${pfad}): ${err.message}`);
  }
  return pfad;
}

/**
 * Der Fingerabdruck der Pruefkonfiguration (Issue #863).
 *
 * Er steht in der Zusammenfassung, weil sich ohne ihn die Gleichheit der Config
 * nicht feststellen laesst: Eine Config aendert nicht zwangslaeufig den
 * Arbeitsbaum — im Kit-Repo ist sie versioniert, in anderen Projekten liegt sie
 * hinter der Ignore-Regel und erschiene dann in `geaendert` gar nicht. Ein
 * uebernommenes Ergebnis bezoege sich dort auf eine Auswahl, die es nicht mehr
 * gibt.
 *
 * Gehasht werden die NORMALISIERTEN Eintraege und die Bereiche, also genau das,
 * woraus die Auswahl entsteht. Ueber die normalisierte Form, damit der Wechsel
 * von der String-Form zu `{ cmd }` — der nichts bedeutet — keinen Lauf erzwingt.
 * Alles uebrige in der Config (Trigger, Modelle, Pfade) bleibt draussen: Es
 * aendert an den Pruefungen nichts.
 */
function configFingerabdruck() {
  const config = ladeConfig();
  const inhalt = JSON.stringify({
    buildChecks: (config.buildChecks ?? []).map((c) => normalisiere(c)),
    checkAreas: config.checkAreas ?? {},
  });
  return createHash("sha256").update(inhalt).digest("hex");
}

function listenGleich(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((wert, i) => wert === b[i]);
}

function hashesGleich(a, b) {
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") return false;
  const alt = Object.keys(a);
  const neu = Object.keys(b);
  return alt.length === neu.length && neu.every((pfad) => Object.hasOwn(a, pfad) && a[pfad] === b[pfad]);
}

/**
 * Die Zusammenfassung des letzten Laufs, WENN sie denselben Stand bezeugt wie der
 * jetzige — sonst `null` (Issue #863).
 *
 * Derselbe Stand heisst: derselbe Anker, dieselbe Stufe, dieselbe Dateiliste mit
 * denselben Blob-Hashes und dieselbe Config. Die Liste steht neben den Hashes,
 * obwohl deren Schluessel sie wiederholen — eine Datei, die ohne Aenderung aus
 * `geaendert` verschwindet, gibt es nicht, und ein Vergleich, der sich auf diese
 * Ableitung verlaesst, muesste sie bei jeder kuenftigen Aenderung an
 * `geaenderteDateien` neu belegen.
 *
 * Bewusst KEIN Zeitfenster („juenger als n Minuten"): Nur der Inhalt macht ein
 * Ergebnis gueltig, nicht die Uhr. Und bewusst nur eine ABGESCHLOSSENE
 * Zusammenfassung — die eines abgebrochenen Laufs bezeugt keinen fertigen Stand,
 * sie ist gerade der Nachweis, dass eine Pruefung ihr Ende nicht erreicht hat.
 *
 * Jeder Zweifel faellt auf `null` zurueck und damit in den vollen Weg: fehlende
 * Datei, kaputtes JSON, fehlendes Feld, ein Stand aus einer aelteren Fassung ohne
 * `configHash`. Das ist dieselbe Richtung, in die dieses Kommando ueberall irrt —
 * lieber einmal zu viel pruefen.
 */
function frueheresErgebnis(auswahl, hashes, configHash) {
  let alt;
  try {
    alt = JSON.parse(readFileSync(zusammenfassungPfad(), "utf-8"));
  } catch {
    return null;
  }
  if (alt === null || typeof alt !== "object") return null;
  if (alt.abgeschlossen !== true || !Array.isArray(alt.laufen)) return null;
  if (alt.basis !== auswahl.basis || alt.stufe !== auswahl.stufe) return null;
  // Die Eingrenzung gehoert in den Vergleich (Issue #922, Code-Review): Ohne sie
  // uebernimmt ein uneingeschraenkter Lauf das Ergebnis eines vorangegangenen
  // `--bereich`-Laufs, weil Basis, Stufe, Dateien und Hashes identisch sind — die
  // faelligen Pruefungen der uebrigen Bereiche liefen dann nie. `?? null` liest eine
  // Zusammenfassung aus einer Fassung vor diesem Feld als uneingeschraenkt.
  if ((alt.bereichWahl ?? null) !== (auswahl.bereichWahl ?? null)) return null;
  if (typeof alt.configHash !== "string" || alt.configHash !== configHash) return null;
  if (typeof alt.zeitpunkt !== "string") return null;
  if (!listenGleich(alt.geaendert, auswahl.geaendert)) return null;
  if (!hashesGleich(alt.hashes, hashes)) return null;
  return alt;
}

/**
 * Der Satzteil, an dem eine Uebernahme in der Ausgabe erkennbar ist (Issue #926).
 *
 * Er steht als Konstante, weil ihn ein zweiter Leser braucht: Der Prueflauf-Zaehler des
 * Nacht-Runners sieht vom Abschlussversuch nur den Bash-Aufruf und seine Ausgabe, und ein
 * uebernommener Lauf soll dort als Versuch OHNE Dauer zaehlen — `uebernehmen` reicht die
 * Werte des frueheren Laufs weiter, eine Spanne waere geerbt und nicht gemessen.
 */
// SYNC: dieselbe Marke steht in kit/night.mjs als UEBERNAHME_MARKE; der Abgleich ist ein
// Test in test/night-prueflaeufe.test.mjs. Ein Import waere die bessere Kopplung, aber
// night.mjs laeuft in Projekten, die checks.mjs nicht mitinstalliert haben muessen.
export const UEBERNAHME_MARKE = "Ergebnis uebernommen";

/**
 * Schreibt das uebernommene Ergebnis als frischen Nachweis und gibt den Exit-Code
 * des Originals zurueck (Issue #863).
 *
 * Die Datei entsteht NEU, obwohl sie inhaltlich gleich bliebe: Das Commit-Gate
 * verlangt einen Nachweis fuer genau den Stand, der committet wird, und eine
 * liegengebliebene Datei waere kein Nachweis dieses Aufrufs. `uebernommen` traegt
 * dabei den Zeitpunkt des ECHTEN Laufs und wird ueber mehrere Uebernahmen hinweg
 * weitergereicht — er sagt, wann zuletzt wirklich geprueft wurde, und genau das
 * will lesen, wer der Datei misstraut.
 *
 * Rot wird ebenso uebernommen wie gruen: Derselbe Stand liefert dasselbe Rot, und
 * ein erneuter Lauf kostete dieselben Minuten fuer dieselbe Antwort. Ungruen zaehlt
 * dabei wie ueberall hier alles, was nicht `gruen` ist — auch ein `nicht
 * gestartet` nach rotem Abbruch.
 */
function uebernehmen(auswahl, frueher, { zeitpunkt, hashes, configHash }) {
  const ungruen = frueher.laufen.find((e) => e.ergebnis !== "gruen") ?? null;
  const original = typeof frueher.uebernommen === "string" ? frueher.uebernommen : frueher.zeitpunkt;
  const pfad = schreibeZusammenfassung({
    ...auswahl,
    laufen: frueher.laufen,
    zeitpunkt,
    hashes,
    configHash,
    abgeschlossen: true,
    dauerGesamtMs: frueher.dauerGesamtMs ?? null,
    ...(frueher.guete ? { guete: frueher.guete } : {}),
    uebernommen: original,
  });
  const befund = ungruen === null ? "gruen" : `rot: ${ungruen.cmd}`;
  process.stdout.write(
    `Stand unveraendert seit ${original}: ${UEBERNAHME_MARKE} (${befund}). Neu pruefen mit --frisch.\n`,
  );
  process.stdout.write(`\nZusammenfassung: ${pfad}\n`);
  return ungruen === null ? 0 : 1;
}

/**
 * Das Urteil ueber ein gelaufenes Kommando — aus drei Quellen, in dieser
 * Reihenfolge: Rueckgabewert, Fehlermerkmal in der Ausgabe (Issue #858) und, wo
 * das Projekt eine Messung benannt hat, die Guete. Die Zeilen, die zum Befund
 * gehoeren, schreibt die Funktion selbst.
 *
 * Die MERKMAL-PRUEFUNG steht VOR dem guete-Zweig (Plan #810, E4): Eine Ausgabe,
 * die ihr Scheitern selbst ausweist, ist kein Messstand — ein darin gefundener
 * Anteil bescheinigte eine Messung, die es nicht gab. Das Ergebnis bleibt `rot`,
 * es gibt keinen dritten Ergebniswert (E5): Gate und Runner lesen
 * `ergebnis !== "gruen"`, und ein neuer Wert brauchte an jeder dieser Stellen
 * eine zweite Bahn.
 *
 * Eigene Funktion und nicht in der Schleife von `ausfuehren`, damit die Schleife
 * ihren Ablauf zeigt (ausfuehren, bewerten, festhalten) und nicht drei Urteile in
 * einer Verzweigungskette traegt.
 */
function bewerten(eintrag, gruen, ausgabe) {
  const merkmal = fehlermerkmal(ausgabe);
  if (merkmal !== null) {
    eintrag.fehlermerkmal = merkmal;
    process.stdout.write(`Fehlermerkmal in der Ausgabe: '${merkmal}' — der Lauf gilt als rot\n`);
  }
  const bestanden = gruen && merkmal === null;
  if (!eintrag.guete) return { bestanden, guete: null };

  // Die Guetemessung faerbt ihr eigenes Kommando: Ein Anteil unter der Marke oder
  // ein nicht auswertbares Ergebnis ist derselbe rote Lauf wie jeder rote
  // Pflichtcheck — kein eigener Stop-Punkt (Issue #763).
  const grund = merkmal === null
    ? "kein Anteil erhoben — das Kommando selbst war rot"
    : `kein Anteil erhoben — Fehlermerkmal '${merkmal}' in der Ausgabe`;
  const guete = gueteErgebnis(eintrag, bestanden, ausgabe, grund);
  process.stdout.write(`${gueteZeile(guete)}\n`);
  return { bestanden: bestanden && guete.erfuellt, guete };
}

/**
 * Fuehrt die Auswahl aus `planen` aus und gibt den Exit-Code zurueck.
 *
 * Der Rueckgabewert je gelaufenem Kommando steht in der Zusammenfassung: `gruen`,
 * `rot` oder `nicht gestartet`. Ohne dieses Feld koennte der Runner einen
 * Fehlschlag nicht dem ausloesenden Paket zuordnen (Kriterium 9 aus Issue #420).
 *
 * Die Dauer je Kommando entsteht hier und nicht aus der Werkzeugzeit des
 * Session-Stroms (Issue #747, Plan #745, E3): Der Strom kennt nur "ein
 * Bash-Aufruf dauerte n Sekunden", nicht welches konfigurierte Kommando darin
 * lief — die Zuordnung braeuchte genau die inhaltliche Deutung, die das
 * Nicht-Ziel "Keine inhaltliche Deutung der Aufrufe" ausschliesst. `checks.mjs`
 * kennt seine Kommandos dagegen beim Namen.
 */
function ausfuehren(args) {
  const auswahl = planen(args);
  const env = { ...process.env, ...settingsEnv() };

  // VOR dem ersten Kommando (Issue #469): Der Hash bezeugt den Inhalt, der in die
  // Pruefung ging. Danach gehasht, bescheinigte er einen Stand, den kein Check
  // gesehen hat, sobald ein Kommando eine Datei anfasst — ein Formatter mit
  // `--fix` genuegt. Veraendert ein Check die Datei, passt der Hash beim Commit
  // nicht mehr und das Gate weist ab: die sichere Richtung.
  //
  // Der Zeitstempel steht unmittelbar daneben und aus demselben Grund (Issue #655):
  // Er bezeugt denselben Moment wie die Hashes — den Stand, der in die Pruefung
  // ging, nicht den Zeitpunkt, zu dem sie endete. Die Nachweiszeile der
  // Release-Skills nennt Hash und Zeitpunkt gemeinsam; stammte der eine aus dem
  // Lauf und der andere aus der Sitzung, bezeugten sie Verschiedenes.
  const zeitpunkt = new Date().toISOString();
  const hashes = blobHashes(auswahl.geaendert);
  const configHash = configFingerabdruck();

  // Die Ankuendigung steht im Kommando und nicht in den Skills (Issue #758): Eine
  // Regel im Prompt wirkt nicht unter Druck — dieselbe Begruendung, aus der
  // checks.mjs ueberhaupt entstand. Das Kommando kennt die Liste ohnehin.
  //
  // Nur oberhalb der Paketstufe: Dort kommt nichts hinzu, und der haeufigste Lauf
  // bleibt still. Eine Zeile, die in jedem Lauf steht, liest bald niemand mehr.
  if (auswahl.stufe !== STUFEN[0]) {
    const hinzu = auswahl.laufen.filter((e) => e.stufe !== STUFEN[0]).map((e) => e.cmd);
    const liste = hinzu.length > 0 ? hinzu.join(", ") : "keine weitere Pruefung";
    process.stdout.write(`Stufe ${auswahl.stufe}: zusaetzlich zur Paketstufe laeuft ${liste}\n`);
  }

  // Vorab in den Bericht: Was nicht laeuft, ist genauso ein Ergebnis wie was laeuft.
  for (const e of auswahl.ausgelassen) {
    process.stdout.write(`ausgelassen: ${e.cmd} — ${e.grund}\n`);
  }

  // Nach den Auslassungen und vor dem ersten Kommando (Issue #863): Was nicht
  // laeuft, steht auch im uebernommenen Bericht — sonst saehe ein uebernommener
  // Lauf aus wie ein verkuerzter. Hier und nicht vor `blobHashes`, weil der
  // Vergleich genau diese Hashes braucht.
  const frueher = args.frisch ? null : frueheresErgebnis(auswahl, hashes, configHash);
  if (frueher !== null) return uebernehmen(auswahl, frueher, { zeitpunkt, hashes, configHash });

  const laufen = auswahl.laufen.map((e) => ({ ...e, ergebnis: "nicht gestartet", dauerMs: null }));
  let rot = false;
  let guete = null;

  // Die Zusammenfassung BEGLEITET den Lauf (Issue #857, Plan #810, E1): Sie entsteht
  // vor dem ersten Kommando und wird vor jedem weiteren ueberschrieben, statt erst am
  // Ende zu entstehen.
  //
  // Der Grund ist der Abbruch. Ein Lauf, der an der Uhr, durch ein Signal oder mit der
  // Session endet, hinterliess vorher keine Datei — und eine fehlende Datei ist fuer
  // den Nacht-Runner "ungeprueft", also ungemessen statt beanstandet. Oder es blieb
  // eine aeltere liegen, die wie das Ergebnis dieses Laufs aussah. Jetzt liegt in jedem
  // Moment eine Fassung, und jede, die ein Abbruch hinterlassen kann, traegt mindestens
  // einen Eintrag `nicht gestartet` (Fachplan #769, AK 3 und 4).
  //
  // VOR dem Kommando und nicht danach, weil Gate (.githooks/gate.mjs) und Runner
  // (`lesePruefung` in night.mjs) allein `ergebnis !== "gruen"` auswerten und
  // `abgeschlossen` nicht sehen: Das laufende Kommando muss in der Datei noch
  // ungruen stehen, sonst saehe ein Abbruch mittendrin gruen aus.
  const schreibeStand = (abgeschlossen) => schreibeZusammenfassung({
    ...auswahl, laufen, zeitpunkt, hashes, configHash, abgeschlossen,
    dauerGesamtMs: dauerGesamt(laufen), ...(guete ? { guete } : {}),
  });
  schreibeStand(false);

  for (const eintrag of laufen) {
    if (rot) break; // Beim ersten roten ist Schluss; der Rest bleibt "nicht gestartet".
    schreibeStand(false);
    process.stdout.write(`\n$ ${eintrag.cmd} — ${eintrag.grund}\n`);
    const start = process.hrtime.bigint();
    const { gruen, ausgabe } = kommandoAusfuehren(eintrag.cmd, env);
    eintrag.dauerMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    process.stdout.write(ausgabe);
    const bewertung = bewerten(eintrag, gruen, ausgabe);
    guete = bewertung.guete ?? guete;
    eintrag.ergebnis = bewertung.bestanden ? "gruen" : "rot";
    process.stdout.write(`-> ${eintrag.ergebnis}\n`);
    // In der Schleife und nicht danach (Issue #785): So traegt auch das rote Kommando
    // seine Zeile, das den Rest abbricht — es ist die Ausfuehrung, um die es der
    // Auswertung zu allererst geht.
    ausfuehrungSchreiben(eintrag.cmd, eintrag.ergebnis, eintrag.dauerMs);
    rot = !bewertung.bestanden;
  }
  guete ??= gueteOhneLauf(laufen, auswahl.ausgelassen);

  // Die letzte Fassung, und die einzige mit `abgeschlossen: true`: Hier ist der Lauf
  // zu Ende gefahren. Auch bei rotem Abbruch geschrieben — und beim leeren Paket
  // ebenso: "keine Pruefung, weil nichts veraendert wurde" ist ein Ergebnis und kein
  // Loch. Rot und abgeschlossen sind Verschiedenes: Das eine sagt, wie die Pruefung
  // ausging, das andere, ob sie ihr Ende erreicht hat.
  //
  // Das guete-Feld steht nur da, wenn das Projekt eine Messung benannt hat — dann
  // aber immer, auch beim gruenen Lauf (Issue #763).
  const pfad = schreibeStand(true);
  process.stdout.write(`\nZusammenfassung: ${pfad}\n`);
  return rot ? 1 : 0;
}

// --- CLI -------------------------------------------------------------------

function parseArgs(rest) {
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--since") {
      // Fehlt der Wert ganz, ist das derselbe Fall wie ein leerer: nicht
      // aufloesbar, also voller Umfang.
      args.since = rest[i + 1] ?? "";
      i += 1;
    } else if (rest[i] === "--stufe") {
      // Ein unbekannter Wert ist ein Fehler und nicht stillschweigend die
      // Paketstufe (Issue #758): Ein Tippfehler liesse sonst genau die
      // Pruefungen aus, um deren Zeitpunkt es beim Aufruf ging — weniger
      // pruefen, ohne dass es auffaellt. Der fehlende Wert zaehlt wie ein
      // falscher; anders als bei `--since` gibt es hier keine sichere Deutung.
      const wert = rest[i + 1] ?? "";
      if (!STUFEN.includes(wert)) {
        fail(`Unbekannte Stufe '${wert}'. Erwartet: ${STUFEN.join(", ")}.`);
      }
      args.stufe = wert;
      i += 1;
    } else if (rest[i] === "--bereich") {
      // Der fehlende Wert zaehlt wie ein falscher (wie bei `--stufe`): Die
      // Pruefung gegen `checkAreas` steht in `planen`, wo die Config liegt, und
      // der leere Name faellt dort mit derselben nennenden Meldung durch.
      args.bereich = rest[i + 1] ?? "";
      i += 1;
    } else if (rest[i] === "--frisch") {
      // Wirkt nur bei `run`; bei `plan` laeuft ohnehin nichts. Kein Fehler dort,
      // weil der Schalter nur in die sichere Richtung zeigt — mehr pruefen.
      args.frisch = true;
    } else {
      fail(`Unbekanntes Argument: '${rest[i]}'`);
    }
  }
  return args;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const [command, ...rest] = argv;
  if (command === "plan") {
    process.stdout.write(JSON.stringify(planen(parseArgs(rest)), null, 2) + "\n");
    return 0;
  }
  if (command === "run") return ausfuehren(parseArgs(rest));

  process.stdout.write(HELP);
  return fail(`Unbekannter Befehl: '${command}'. Erwartet: plan oder run`);
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  try {
    // exitCode statt process.exit: `run` faerbt den Lauf rot, ohne ihn abzuschneiden.
    process.exitCode = main();
  } catch (err) {
    const prefix = err instanceof ChecksError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
