/**
 * night/grundlagen.mjs — gemeinsame Grundlagen des Nacht-Runners (Issue #1224, Plan #1199,
 * E16, E17): Argumente, Logging, Board-Adapter als Kind-Prozess, Git-Helfer und die Config
 * mit persoenlichen Overrides, dazu die Pfade der Nachbarn und der geteilte Laufzustand.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus. Wo eine Grundlage etwas braucht, das ein spaeterer Teil fuehrt — den Puls
 * und den Abbruch des Laufstands, den zweiten Versuch eines Board-Aufrufs —, bindet der
 * Einstieg es ueber `grundlagenAnbinden` an.
 *
 * Abschnitte, die E17 nicht nennt, aber hier stehen: die Pfade der Nachbarn (NACHBAR_DIR
 * und die *_PATH-Konstanten) und die beiden Laufzeitpfade UMSETZUNG_LOCK und
 * KIT_STAND_MARKIERUNG, die `gitResteAusnahmen` braucht, und der Textvergleich
 * `vergleicheText`, den der Teil laufstand und der Einstieg teilen (Issue #1225).
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Das Kit-Verzeichnis, in dem night.mjs liegt — dieser Teil liegt eine Ebene tiefer.
const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Woher der Runner seine Nachbarn holt — board.mjs und checks.mjs. Der Pfad steht hier,
// weil schon die ersten dynamischen Importe ihn brauchen, im Einstieg wie in den Teilen.
//
// Bewusst der Nachbarpfad und nicht BOARD_PATH: KIT_ROOT verlegt die CLI-AUFRUFE in ein
// fremdes Projekt (Test-Hook); eine reine Funktion holt man sich dort nicht her, sondern
// aus dem board.mjs, das zu dieser Datei gehoert.
//
// NIGHT_NACHBAR_DIR ist die eine Ausnahme, und auch sie ist ein reiner Test-Hook
// (Issue #498): Er verlegt die Suche nach den Nachbarn, aufgeloest mit resolve() wie
// KIT_ROOT. Ohne ihn ergibt sich dieselbe Modul-URL wie bei einem literalen
// "./board.mjs" neben night.mjs. Es gibt ihn, weil die Ersatzfunktionen sonst
// unerreichbar sind: Sie laufen nur, wenn der Nachbar fehlt, und das war bisher nur
// mit einer Kopie im Temp-Verzeichnis herstellbar — deren Treffer bildet SonarCloud
// nicht auf kit/night.mjs ab. Zeigt der Hook auf ein Verzeichnis mit einem eigenen
// board.mjs, wird dieses geladen; das ist Absicht und nicht zu verhindern.
export const NACHBAR_DIR = process.env.NIGHT_NACHBAR_DIR ? resolve(process.env.NIGHT_NACHBAR_DIR) : KIT_DIR;
export const NACHBAR_BOARD = join(NACHBAR_DIR, "board.mjs");
export const NACHBAR_CHECKS = join(NACHBAR_DIR, "checks.mjs");
export const NACHBAR_AUFWAND = join(NACHBAR_DIR, "aufwand.mjs");
export const NACHBAR_WIRKSAMKEIT = join(NACHBAR_DIR, "wirksamkeit.mjs");
export const NACHBAR_BEFUNDE = join(NACHBAR_DIR, "befunde.mjs");

// Das Budget der Board-Aufrufe im Nachtbetrieb, aus dem Board-Teil adapter (Issue #1217):
// Es gehoert zu den Toolbox-Aufrufen der Adapter. Der Pfad ist nicht literal, deshalb nennen
// die Pruefgruppen dieses Teils den Bereich board-adapter von Hand (Plan #1199, E3). Fehlt
// der Teil, bleibt das Budget offen, und boardUmgebung setzt keines. Bewusst dynamisch und
// abgefangen: night.mjs beantwortet --version und --help auch ohne Nachbarn (Issue #170).
const { TOOLBOX_BUDGET_NACHT_MS } = await import(pathToFileURL(join(NACHBAR_DIR, "board", "adapter.mjs")).href).catch(() => ({}));

// Normalerweise liegt board.mjs neben night.mjs in .claude/kit/. KIT_ROOT
// verlegt die Suche in ein anderes Projekt und ist ein Test-Hook (Issue #189,
// dasselbe Muster wie in kit/board.mjs und tools/sync-blobs.mjs): Nur so koennen
// die E2E-Tests das ECHTE Script aus dem Repo gegen ein Fixture-Projekt fahren
// statt eine Kopie im Temp-Verzeichnis — deren Coverage liesse sich nicht auf
// kit/night.mjs abbilden. Genau daran lag es, dass die acht night-Testdateien
// trotz voller E2E-Laeufe null Prozent zur gemessenen Abdeckung beitrugen.
const kitPfad = (datei) => process.env.KIT_ROOT
  ? join(resolve(process.env.KIT_ROOT), ".claude", "kit", datei)
  : join(KIT_DIR, datei);
export const BOARD_PATH = kitPfad("board.mjs");

// Dasselbe fuer die Aufwands-Auswertung (Issue #752): Sie wird als Kindprozess gerufen,
// nicht importiert, und misst das Projekt, in dem der Runner arbeitet — also derselbe
// KIT_ROOT-Weg wie beim Board. Die reine Textform kommt dagegen ueber NACHBAR_AUFWAND,
// genau wie board.mjs zweimal auftaucht: einmal als CLI, einmal als Funktion.
export const AUFWAND_PATH = kitPfad("aufwand.mjs");

// Und dasselbe noch einmal fuer die Wirksamkeits-Auswertung (Issue #790): Sie misst mit
// `.claude/ausfuehrungen.tsv` und `.claude/bewegungen.tsv` ebenfalls das Projekt, in dem
// der Runner arbeitet, und schreibt ihre Berichte dorthin — also derselbe KIT_ROOT-Weg.
export const WIRKSAMKEIT_PATH = kitPfad("wirksamkeit.mjs");

// Und dasselbe fuer die Befunde (Issue #804, #806): Nach dem Rueckweg aus dem Worktree
// ruft die Kette `befunde.mjs vorschlag --art <a>` je zurueckgegebener Mangel-Art, und
// der Lauf-Abschluss ruft `befunde.mjs auswerten`. Beides ist ein Kindprozess und kein
// Import — die Kommandos schreiben ueber board.mjs ans Board beziehungsweise nach
// `.claude/` und loesen ihre Pfade gegen das Projekt auf, in dem der Runner arbeitet.
export const BEFUNDE_PATH = kitPfad("befunde.mjs");

// Und dasselbe fuer die Pruefungen (Issue #919): Die Vorpruefung des Salvage
// faehrt sie als Kindprozess `checks.mjs run` im Zielprojekt, damit dort der Nachweis
// entsteht, den das Commit-Gate liest. NACHBAR_CHECKS daneben bleibt, was es war — der
// Import fuer `zusammenfassungPfad`; dieselbe Doppelung wie beim Board, einmal als CLI
// und einmal als Funktion.
export const CHECKS_PATH = kitPfad("checks.mjs");

/** Der Pfad der Lock-Datei der Umsetzung (Issue #696), relativ zur Hauptkopie. */
export const UMSETZUNG_LOCK = ".claude/night-umsetzung.lock";

/** Die Markierung eines eingesetzten Baums (Issue #1102, A4), relativ zu seiner Wurzel — mit `/` wie UMSETZUNG_LOCK. */
export const KIT_STAND_MARKIERUNG = ".claude/kit-stand.json";

// SYNC: Die Vorgaben stehen auch im Hilfetext von kit/night.mjs. Der Einstieg beantwortet
// --help, bevor dieser Teil geladen ist, und kann sie darum nicht von hier holen;
// test/night-grundlagen-argumente.test.mjs haelt die beiden Stellen gleich.
export const DEFAULT_MODEL = "claude-opus-5";
export const DEFAULT_LABEL = "kit:nightrun";
export const DEFAULT_MAX_SESSIONS = 10;
// --max der Kette zaehlt Ketten (Plan #638, A13): dieselben drei wie fruehere
// Ausgangsdokumente je Nacht.
export const DEFAULT_MAX_KETTEN = 3;

// --- Textvergleich ---

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt.
 *
 * Ausgeschrieben statt weggelassen, damit an jeder Fundstelle steht, dass die
 * Reihenfolge Absicht ist (S2871). Bewusst **nicht** `localeCompare`: Dessen
 * Reihenfolge haengt an der Locale der Maschine, und zwei Laeufe muessen
 * ueberall dieselbe Liste ergeben — die Artnamen stehen im Nacht-Bericht.
 *
 * SYNC: dieselbe Funktion steckt in kit/checks.mjs, kit/befunde.mjs und
 * kit/wirksamkeit.mjs — Aenderungen dort nachziehen. Die Kit-Werkzeuge sind
 * bewusst eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440);
 * geteilte Logik wird dupliziert und hier markiert.
 *
 * Exportiert, damit der Locale-Test sie direkt pruefen kann (Issue #493). Seit Issue #1225
 * steht sie in den Grundlagen, weil der Teil laufstand sie braucht; der Einstieg
 * exportiert sie unveraendert weiter.
 */
export function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// --- Anbindung an spaetere Teile ---

/**
 * Was die Grundlagen aus Teilen brauchen, die auf ihnen aufbauen (Plan #1199, E16): den
 * Puls und den Abbruch des Laufstands, den zweiten Versuch eines Board-Aufrufs samt Vermerk
 * und das Anhalten. Ein Import waere ein Zyklus — jene Teile importieren die Grundlagen —,
 * darum setzt der Einstieg sie beim Laden ein. Die Vorgaben gelten fuer einen Teil, der
 * allein geladen ist, etwa im Test: kein Puls, ein Abbruch beendet den Prozess mit seinem
 * Exit-Code, und ein Board-Aufruf haelt nicht an, sondern scheitert wie ohne Stempel.
 */
const anbindung = {
  pulsSchreiben: () => {},
  laufAbbrechen: (_grund, { exitCode = 1 } = {}) => process.exit(exitCode),
  anhaltenLaeuft: () => false,
  zweiterVersuch: () => {},
  vermerkAnDieKarte: () => {},
  laufAnhalten: (text, klasse) => fail(text, klasse),
};

/** Setzt die Haken aus `anbindung`; nicht genannte behalten ihren Wert. */
export function grundlagenAnbinden(haken) {
  for (const [name, fn] of Object.entries(haken)) {
    if (!Object.hasOwn(anbindung, name)) throw new Error(`grundlagenAnbinden kennt keinen Haken '${name}'`);
    anbindung[name] = fn;
  }
}

// --- Argumente ---

// Die drei Sorten Argument als Tabellen statt als Kette (Issue #404). Der Schnitt
// folgt dem, was ein Flag mit dem Lauf macht, nicht seinem Namen: Auskunft geben und
// enden, einen Wert mitbringen, oder einen Schalter umlegen. Wer ein Flag ergaenzt,
// traegt es in genau eine Tabelle ein und aendert die Schleife nicht mehr.
//
// Die Auskunftsflags --help, -h und --version beantwortet der Einstieg, bevor ein Teil
// geladen ist (Plan #1199, E2) — sie erreichen diesen Parser nicht.

// Flags mit Wert: der jeweils naechste argv-Eintrag, bei Zahlen konvertiert. Ob der
// Wert plausibel ist, entscheidet pruefeArgs — nicht diese Tabelle.
const WERT_FLAGS = {
  "--max": (args, wert) => { args.max = Number(wert); },
  "--model": (args, wert) => { args.model = wert; args.modelGesetzt = true; },
  "--label": (args, wert) => { args.label = wert; args.labelGesetzt = true; },
  "--timeout-min": (args, wert) => { args.timeoutMin = Number(wert); },
};

// Schalter ohne Wert: Flag -> Feldname, immer auf true.
const SCHALTER_FLAGS = {
  "--kette": "kette",
  "--pruefen": "pruefen",
  "--dry-run": "dryRun",
  "--yolo": "yolo",
  "--no-checks-ok": "noChecksOk",
};

// --verbose ist seit Issue #867 ein Flag mit OPTIONALEM Wert: Das Live-Verlaufsprotokoll
// ist die Vorbelegung, `--verbose no` schaltet es ab, `--verbose yes` ausdruecklich an,
// `--verbose` allein bleibt zulaessig und wirkungslos. Gelesen werden genau diese beiden
// Schreibweisen — eine Synonymliste (off/false/0/1) vergroesserte die Oberflaeche, ohne
// dass man sich die eine Schreibweise aus der Hilfe falsch merken koennte.
const VERBOSE_WERTE = { no: false, yes: true };

/**
 * Liest den optionalen Wert von --verbose aus `argv` ab Position `i+1`.
 *
 * Der naechste Eintrag zaehlt nur dann als Wert, wenn er nicht mit `-` beginnt; sonst
 * bleibt er unangetastet. Darum steht --verbose NICHT in WERT_FLAGS: Jene Tabelle
 * verschlingt den naechsten Eintrag bedingungslos, und `--verbose --max 5` verloere
 * damit sein `--max`. Gibt den neuen Stand von `i` zurueck (verbraucht oder nicht).
 */
function liesVerbose(args, argv, i) {
  const naechster = argv[i + 1];
  if (naechster === undefined || naechster.startsWith("-")) return i;
  if (!Object.hasOwn(VERBOSE_WERTE, naechster)) {
    fail(`--verbose kennt nur die Werte no und yes (gelesen: ${naechster}) — ohne Wert bleibt es beim Vorgabewert yes.`);
  }
  args.verbose = VERBOSE_WERTE[naechster];
  return i + 1;
}

// Die Flags der beiden entfallenen Betriebsarten (Plan #638, A1). Sie bleiben dem Parser
// bekannt, damit die Meldung sagt, WAS es nicht mehr gibt: Ein "unbekanntes Argument"
// liesse den Menschen raten, ob er sich vertippt hat. Die Meldung faellt vor jedem
// Board-Zugriff und vor dem Ergebnisstand — es gibt keinen Lauf, der zu berichten haette.
const ENTFALLENE_FLAGS = new Set(["--review", "--erzeuge", "--stufe", "--review-label", "--erzeuge-label"]);

function entfallenesFlag(a) {
  const zusatz = a === "--stufe" ? ", und die Kette hat keine Stufen" : "";
  fail(`${a} gibt es seit Stufe 2 nicht mehr; die Nacht-Kette ist --kette${zusatz}.`);
}

/**
 * Liest das Argument an Position `i` und gibt die Position des naechsten zurueck.
 *
 * Wie weit der Cursor rueckt, weiss nur die Regel selbst: ein Schalter um eins, ein
 * Flag mit Wert um zwei, `--verbose` um eins oder zwei — je nachdem, ob ein Wert
 * dasteht. Genau darum steht das Weiterruecken hier und nicht im Kopf einer
 * for-Schleife, deren Zaehler der Rumpf dann verschieben muesste.
 */
function liesArgument(args, argv, i) {
  const a = argv[i];
  if (ENTFALLENE_FLAGS.has(a)) entfallenesFlag(a);
  if (a === "--verbose") return liesVerbose(args, argv, i) + 1;
  if (Object.hasOwn(WERT_FLAGS, a)) {
    WERT_FLAGS[a](args, argv[i + 1]);
    return i + 2;
  }
  if (Object.hasOwn(SCHALTER_FLAGS, a)) {
    args[SCHALTER_FLAGS[a]] = true;
    return i + 1;
  }
  fail(`Unbekanntes Argument: ${a} — siehe --help`);
}

export function parseArgs(argv) {
  // max bleibt bewusst null: Der Default haengt am Modus, und der steht erst fest,
  // wenn alle Flags gelesen sind. Ein unbedingtes 10 hier machte einen modusabhaengigen
  // Wert von einem gesetzten ununterscheidbar (Issue #517). pruefeArgs loest ihn auf.
  const args = { max: null, model: DEFAULT_MODEL, modelGesetzt: false, timeoutMin: 60, dryRun: false, yolo: false, noChecksOk: false, verbose: true, label: DEFAULT_LABEL, labelGesetzt: false, kette: false, pruefen: false };
  let i = 0;
  while (i < argv.length) {
    i = liesArgument(args, argv, i);
  }
  pruefeArgs(args);
  return args;
}

/**
 * Loest den Default von `max` auf (Issue #517, seit Plan #638 nur noch ein Feld).
 *
 * `max` ist beim Einlesen null, damit ein gesetzter Wert von einem Default unterscheidbar
 * bleibt. Ein gesetzter Wert gewinnt — auch ein unbrauchbarer: `--max abc` faellt hier NICHT
 * auf den Default zurueck, sondern geht als NaN in die Zahlenpruefung und wird dort
 * abgewiesen. Exportiert, weil `parseArgs`/`pruefeArgs` es nicht sind.
 */
export function loeseModusDefaults(args) {
  if (args.kette) {
    // Die Kette baut nichts und committet nichts: Die buildChecks-Pflicht gilt ihr
    // nicht, und --max zaehlt Ketten, nicht Sessions (Plan #638, A13).
    return { max: args.max ?? DEFAULT_MAX_KETTEN, noChecksOk: true };
  }
  if (args.pruefen) {
    // Der Prueflauf baut so wenig wie die Kette, und er bekommt KEINEN Vorgabewert fuer
    // `max` (Plan #904, E9): Begrenzt wird er ueber die Budgets in `pruefLauf`, nicht ueber
    // eine Zahl. `null` heisst hier "kein Zahlendeckel" und ist ein gueltiger Zustand —
    // ein Vorgabewert waere eine zweite, stille Grenze neben den Budgets.
    return { max: args.max ?? null, noChecksOk: true };
  }
  return { max: args.max ?? DEFAULT_MAX_SESSIONS };
}

/**
 * Prueft die eingelesenen Argumente auf Plausibilitaet und bricht bei Verstoss ab.
 *
 * Getrennt vom Einlesen, weil es eine andere Frage ist: parseArgs uebersetzt argv in
 * ein Objekt, diese Funktion entscheidet, ob damit gearbeitet werden darf.
 *
 */
function pruefeArgs(args) {
  // Zuerst die beiden Laeufe gegeneinander (Plan #904, E17): Sie haben verschiedene
  // Budgets, verschiedene Labels und verschiedene Worktree-Praefixe, und `laufArt` kann nur
  // eine Art nennen. Ein Aufruf mit beiden Flags waere ein Lauf, der nicht sagen kann,
  // welcher er ist.
  if (args.kette && args.pruefen) {
    fail("--kette und --pruefen sind zwei Laeufe mit eigenen Budgets — bitte einzeln starten.");
  }
  // Der Prueflauf hat keine Vorschau (Plan #904, E10): Was er tun wuerde, steht in der
  // Kandidatenliste, die er vor der ersten Session protokolliert.
  if (args.pruefen && args.dryRun) {
    fail("Der Prueflauf hat keine Vorschau — `/issue-review --dry-run` zeigt Dokumente und Reviewer.");
  }
  // Der Abend hat genau eine Geste: Das Kettenlabel kommt aus night.kette.label, ein
  // zweiter Weg zum selben Wert waere eine zweite Wahrheit (Plan #638, E6).
  if (args.kette && args.labelGesetzt) {
    fail("--kette kennt kein --label — das Kettenlabel steht in night.kette.label der workflow.config.json.");
  }
  // Dieselbe Begruendung fuer den Prueflauf, nur mit seinem eigenen Block.
  if (args.pruefen && args.labelGesetzt) {
    fail("--pruefen kennt kein --label — das Kennzeichen steht in pruefLauf.label der workflow.config.json.");
  }
  // Die Aufloesung steht VOR der Zahlenpruefung: Die Vorbelegung ist null, und die
  // Pruefung wiese sonst jeden Aufruf ohne --max ab.
  Object.assign(args, loeseModusDefaults(args));

  // Der Prueflauf darf ohne Zahlendeckel fahren (E9): Dort ist `null` das Ergebnis der
  // Aufloesung und keine fehlende Angabe. Ein gesetztes `--max` prueft auch er.
  const ohneDeckel = args.pruefen && args.max === null;
  if (!ohneDeckel && (!Number.isFinite(args.max) || args.max < 1)) fail("--max braucht eine Zahl >= 1");
  if (!Number.isFinite(args.timeoutMin) || args.timeoutMin < 1) fail("--timeout-min braucht eine Zahl >= 1");
}

// --- Logging ---

/**
 * Der Laufzustand, den alle Teile teilen (Plan #1199, E16). Bis zur Zerlegung waren das
 * Modul-Variablen von kit/night.mjs; ein importierter `let` laesst sich aber in einem
 * anderen Modul nicht zuweisen. Darum stehen die Felder an einem Objekt, das jeder Teil
 * liest und schreibt — unter ihren bisherigen Namen. Gross geschrieben wie die Variablen davor
 * und damit verschieden vom haeufigen Parameter `zustand` (der Laufstand einer Karte), der es
 * sonst verdeckte.
 */
export const ZUSTAND = {
  LOG_FILE: null,

  // Der maschinenlesbare Ergebnisstand (Issue #486): Pfad und Objekt liegen im
  // Modul-Zustand wie LOG_FILE darueber, nicht im Kontext — nur so erreicht auch
  // fail() sie, das von ueberall her abbricht. Beide bleiben null, solange der Lauf
  // --dry-run faehrt; dann schreibt schreibeErgebnisstand() nichts.
  ERGEBNIS_FILE: null,
  LAUF: null,
  // Der Zeitstempel des Laufs, wie er im Dateinamen des Ergebnisstands steht: Die Kette
  // nennt ihn im Worktree-Namen und im Bericht.
  LAUF_STEMPEL: null,

  // Der Grund des zuletzt gemerkten harten Stopps (Issue #558). Er nimmt denselben Weg
  // wie die Fehlerklasse — Modul-Zustand statt neuem Rueckgabewert —, damit die
  // Rueckgabewerte der hardStop-Pfade unveraendert bleiben (Issue #488). Gebraucht wird
  // er zweimal: beim Anheften an die betroffene Einheit und, falls das ausbleibt, vom
  // Sicherheitsnetz in laufAbschliessen().
  STOPP_GRUND: "",

  // Die geladene Config, zugewiesen in main() (Issue #232). Dasselbe Muster wie LOG_FILE
  // darueber, und aus demselben Grund: gitReste() braucht sie, wird aber aus der
  // Hauptschleife heraus aufgerufen.
  config: null,

  // Die Kennung des Laufs in jeder Zeile des Tagesprotokolls (Issue #1090, E16). Laufen Kette
  // und Prueflauf gleichzeitig, schreiben sie in dieselbe Tagesdatei; erst die Kennung trennt
  // ihre Zeilen. Gesetzt nur im Waechter, der einen fremden Lauf beobachtet — sonst ist sie
  // der Stempel des Laufs, im Trockenlauf ohne Stempel die Prozess-Id.
  LOG_KENNUNG: null,
};

// Das Protokoll des laufenden Schritts (Issue #1090, E16): `{ karte, stufe, rel }` oder
// null. Solange es gesetzt ist, gehen die Runner-Zeilen und der Session-Output zusaetzlich
// nach `.claude/protokolle/<lauf>/<karte>-<stufe>[-v2].log`.
let SCHRITT_LOG = null;
// Das zuletzt begonnene Schrittprotokoll je Karte: Der Laufstand nennt es auch nach dem
// Ende des Schritts, etwa im Halt, der erst nach der Stufe an die Karte geht.
export const LETZTES_PROTOKOLL = new Map();

function logKennung() {
  return ZUSTAND.LOG_KENNUNG ?? ZUSTAND.LAUF_STEMPEL ?? `pid-${process.pid}`;
}

// Die Kennung steht in derselben Klammer wie der Zeitstempel, nicht in einer zweiten: Wer
// genau eine fuehrende Klammer abstreift, liest die Zeile weiter wie vorher.
export function log(msg) {
  const line = `[${new Date().toISOString()} ${logKennung()}] ${msg}`;
  process.stdout.write(line + "\n");
  if (ZUSTAND.LOG_FILE) appendFileSync(ZUSTAND.LOG_FILE, line + "\n", "utf-8");
  schrittProtokollieren(line + "\n");
}

/** Der Pfad eines Schrittprotokolls relativ zum Projekt, mit `/` wie im Laufstand. */
export function schrittProtokollPfad(lauf, karte, stufe, versuch = 1) {
  const zusatz = versuch > 1 ? `-v${versuch}` : "";
  return [".claude", "protokolle", lauf, `${karte}-${stufe}${zusatz}.log`].join("/");
}

/**
 * Beginnt das Protokoll eines Schritts und gibt das vorige zurueck, das `schrittEnden`
 * wiederherstellt: Die Stufe umsetzung der Kette faehrt die Runden ihrer Pakete, und jede
 * Runde ist ein eigener Schritt ihres Pakets. Ohne Stempel (Trockenlauf) kein Protokoll.
 */
export function schrittBeginnen(karte, stufe) {
  const vorher = SCHRITT_LOG;
  SCHRITT_LOG = ZUSTAND.LAUF_STEMPEL ? { karte: String(karte), stufe, rel: schrittProtokollPfad(ZUSTAND.LAUF_STEMPEL, karte, stufe) } : null;
  if (SCHRITT_LOG) LETZTES_PROTOKOLL.set(SCHRITT_LOG.karte, SCHRITT_LOG.rel);
  return vorher;
}

export function schrittEnden(vorher) {
  SCHRITT_LOG = vorher;
}

/** Der zweite Versuch eines Schritts (Issue #1088) schreibt in eine eigene Datei `-v2`. */
export function schrittZweiterVersuch() {
  if (!SCHRITT_LOG) return;
  SCHRITT_LOG = { ...SCHRITT_LOG, rel: schrittProtokollPfad(ZUSTAND.LAUF_STEMPEL, SCHRITT_LOG.karte, SCHRITT_LOG.stufe, 2) };
  LETZTES_PROTOKOLL.set(SCHRITT_LOG.karte, SCHRITT_LOG.rel);
}

// Ein Schreibfehler haelt den Lauf nicht an: Das Tagesprotokoll traegt dieselben Zeilen.
// Gemeldet wird er dort einmal je Schritt, und der Laufstand nennt die Datei nicht mehr.
export function schrittProtokollieren(text) {
  if (!SCHRITT_LOG) return;
  const pfad = join(process.cwd(), SCHRITT_LOG.rel);
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    appendFileSync(pfad, text, "utf-8");
  } catch (err) {
    LETZTES_PROTOKOLL.delete(SCHRITT_LOG.karte);
    SCHRITT_LOG = null;
    log(`Schrittprotokoll konnte nicht geschrieben werden: ${err.message} — die Zeilen stehen weiter im Tagesprotokoll.`);
  }
}

/**
 * Bricht den Lauf ab und schliesst den Ergebnisstand ab (Issue #488).
 *
 * Die Klasse sagt, WO es gerissen ist: `umgebung`, `tracker`, `zustand`,
 * `harterStopp` oder `unbekannt`. Sie steht hier und nicht nur im Fehlertext, weil eine Auswertung sonst
 * Meldungen parsen muesste; der Text bleibt trotzdem erhalten, damit der Mensch die
 * Einordnung nachpruefen kann.
 *
 * Der Abschluss gehoert an genau diese Stelle: Die Datei kennt kein try/finally und
 * keinen exit-Handler, und ein Stand, der erst am regulaeren Ende entstuende, fehlte
 * im interessantesten Fall. Ohne ihn saehe ein erkannter Stopp aus wie ein Absturz.
 *
 * Seit Issue #1084 (E8) laeuft fail() ueber denselben Weg wie die Signal-Handler: Das
 * Journal haelt den Abbruch fest, und jede laufende Karte zeigt ihn. Der Abschluss bleibt
 * `harterStopp` — ein erkannter Stopp ist kein Abbruch von aussen.
 */
export function fail(msg, klasse = "unbekannt") {
  const line = `Fehler: ${msg}`;
  process.stderr.write(line + "\n");
  if (ZUSTAND.LOG_FILE) appendFileSync(ZUSTAND.LOG_FILE, line + "\n", "utf-8");
  if (ZUSTAND.LAUF) {
    ZUSTAND.LAUF.fehlerklasse = klasse;
    ZUSTAND.LAUF.fehlerText = msg;
  }
  anbindung.laufAbbrechen(msg, { abschluss: "harterStopp", exitCode: 1 });
}

/**
 * Vermerkt Fehlerklasse UND Grund eines harten Stopps, der NICHT ueber fail() laeuft
 * (Issue #488, um den Grund erweitert in #558).
 *
 * Die hardStop-Pfade in werteRunde, behandleDirtyRunde, versucheSalvage,
 * reviewRundeGestoppt und fuehreVorflug geben einen String oder ein Ja/Nein zurueck und
 * beenden den Prozess nicht selbst — sie hinterlegen beides hier, bevor sie
 * zurueckkehren. Ihre Rueckgabewerte bleiben dadurch unveraendert.
 *
 * Der Grund ist Pflichtparameter und keine Option: Eine Fehlerklasse ohne Grund ist
 * genau der Zustand, den Issue #558 abgeschafft hat. Er ist woertlich der Text, der
 * ohnehin ins Protokoll geht — dieser Weg reicht ihn weiter, er ermittelt ihn nicht neu.
 */
export function merkeHartenStopp(klasse, grund) {
  ZUSTAND.STOPP_GRUND = grund;
  if (ZUSTAND.LAUF) {
    ZUSTAND.LAUF.fehlerklasse = klasse;
    schreibeErgebnisstand();
  }
}

/**
 * Heftet den gemerkten Stoppgrund an die betroffene Einheit (Issue #558).
 *
 * Getrennt vom Merken, weil beides an verschiedenen Stellen faellig ist: Die Klasse
 * kennt der Guard, die Einheit kennt erst sein Aufrufer. `fehlerEinheit` am Lauf ist
 * der Verweis darauf — ohne ihn muesste eine Auswertung raten, welche der Einheiten
 * die gestoppte war.
 */
export function hefteStoppGrund(einheit) {
  einheit.grund = ZUSTAND.STOPP_GRUND;
  if (ZUSTAND.LAUF) {
    ZUSTAND.LAUF.fehlerEinheit = einheit.id;
    schreibeErgebnisstand();
  }
}

/**
 * Heftet den gemerkten Stoppgrund an den LAUF — fuer den einen Weg ohne Karte.
 *
 * Der Vorflug-Guard laeuft, bevor ein Kandidat gezogen ist. Ein `fehlerEinheit`, der
 * auf nichts zeigt, waere schlimmer als keiner; der Grund gehoert deshalb an
 * `fehlerText`, dieselbe Stelle, an der ihn auch fail() ablegt.
 */
export function hefteStoppGrundAnLauf() {
  if (!ZUSTAND.LAUF) return;
  ZUSTAND.LAUF.fehlerText = ZUSTAND.STOPP_GRUND;
  schreibeErgebnisstand();
}

/**
 * Die liegengebliebenen Dateien als ein Satz — ab dem elften Eintrag gekuerzt.
 *
 * Bis zehn Eintraege vollstaendig, darueber die Anzahl und die ersten zehn, in genau
 * der Reihenfolge von `git status --porcelain`. Die Grenze ist Absicht: Ein Grund, der
 * hundert Zeilen fuehrt, ist morgens nicht mehr das, was man zuerst liest — und die
 * Anzahl sagt bereits alles, was die Liste dann noch sagen wuerde.
 *
 * Die leere Liste hat ihren eigenen Text statt eines Sonderfalls beim Aufrufer: Ein
 * gescheiterter Salvage kann einen sauberen Baum hinterlassen, und "keine" ist dort
 * eine Auskunft und kein Mangel.
 */
export function resteText(reste) {
  if (reste.length === 0) return "keine unkommittierten Reste";
  const gezeigt = reste.slice(0, 10).join(" | ");
  return reste.length > 10
    ? `${reste.length} unkommittierte Reste, die ersten zehn: ${gezeigt}`
    : `unkommittierte Reste: ${gezeigt}`;
}

/**
 * Der Ersatztext, wenn kein Abbruchweg einen Grund hinterlegt hat (Issue #558).
 *
 * Er sagt ausdruecklich, dass hier etwas fehlt, und bittet um Meldung: Ein leeres Feld
 * liesse offen, ob der Lauf nichts zu sagen hatte oder ob die Uebergabe gerissen ist.
 */
export const ERSATZ_GRUND = "Kein Grund ermittelbar — der Lauf ist hart gestoppt, ohne dass ein Abbruchweg "
  + "seinen Grund hinterlegt hat. Der Weg steht im Textprotokoll daneben; bitte melden.";

/** Der Zusatz, wenn der Grund nur ueber den Modul-Zustand kam und nicht ueber die Uebergabe. */
export const ANKER_FEHLT = "(Der Uebergabe-Anker fehlte: Dieser Text stammt aus dem zuletzt gemerkten harten "
  + "Stopp, nicht von der betroffenen Einheit und nicht vom Lauf. Bitte melden.)";

// Die Gruende eines Laufs ohne Arbeitspaket (Issue #744) — derselbe Wortlaut steht im
// Textprotokoll und am Lauf-Kopf (`LAUF.noWorkReason`), damit beide nie auseinanderlaufen.
// Sie stehen alle als Literal in `grundOhneArbeit` (Issue #887): Eine Konstante daneben
// waere eine zweite Stelle, an der ein Satz dieser Familie zu suchen ist.

/** Auf so viele Zeichen gehen variable Namen (Label, Lock-Grund) gekuerzt in den Satz. */
const OHNE_ARBEIT_NAME_MAX = 80;

/**
 * Der Rueckfall, wenn ein Lauf ohne Session endete, ohne dass ein benannter Fall zutraf
 * (Fachliche Quelle #880).
 *
 * Er sagt ausdruecklich, dass hier ein Fall fehlt: Ein leeres Feld liesse offen, ob der
 * Lauf nichts zu sagen hatte oder ob eine Lage unbenannt geblieben ist.
 */
export const OHNE_ARBEIT_UNBEKANNT = "Kein Grund ermittelbar — der Lauf endete ohne eine Session, ohne dass ein "
  + "benannter Fall zutraf. Der Weg steht im Textprotokoll daneben; bitte melden.";

/** Kuerzt einen variablen Namen, damit der Satz am Lauf-Kopf nicht gekappt wird. */
function ohneArbeitName(wert) {
  const text = String(wert ?? "");
  return text.length > OHNE_ARBEIT_NAME_MAX ? `${text.slice(0, OHNE_ARBEIT_NAME_MAX - 1)}…` : text;
}

/**
 * Der eine Satz zu einem Lauf ohne Arbeitspaket — rein, ohne Zustand (Issue #885).
 *
 * An EINER Stelle statt an dreien: Jede weitere Fundstelle waere eine weitere
 * Gelegenheit, die Saetze auseinanderlaufen zu lassen. Jeder Satz benennt seinen Fall
 * und traegt die beteiligten Namen und Zahlen mit, damit er ohne das Textprotokoll
 * daneben zu lesen ist.
 *
 * Die beiden Kettensaetze teilen das Praefix `Keine Kette zu fahren:` — daran haengen
 * die Matcher der Ketten-Tests, die den Fall selbst nicht unterscheiden. Die beiden
 * Pruefsaetze (Issue #909) teilen ebenso ihr eigenes Praefix.
 */
export function grundOhneArbeit(fall, daten) {
  const d = daten || {};
  switch (fall) {
    case "readyLeer":
      return "Ready ist leer — nichts zu tun.";
    case "keinLabel":
      return `Keine der ${d.anzahl} Karten in Ready traegt das Label '${ohneArbeitName(d.label)}' — nichts zu tun.`;
    case "alleZurueckgestellt":
      return `Alle ${d.anzahl} Karten in Ready wurden am Gate zurueckgestellt — der Lauf hat Ready selbst `
        + "geleert, es blieb nichts zu tun.";
    case "umsetzungBelegt":
      return `Die Umsetzung ist belegt: ${ohneArbeitName(d.grund)} — der Lauf endet ohne Paket.`;
    // Karte statt Fachplan seit Issue #896: Auftrag der Kette ist die fachliche
    // Anforderung ODER das Plandokument, und ein Satz, der nur den Fachplan kennt,
    // liesse den Morgen das Kennzeichen an der falschen Karte suchen.
    case "ketteKeinLabel":
      return `Keine Kette zu fahren: keine Karte traegt das Label '${ohneArbeitName(d.label)}'.`;
    case "ketteAlleUebersprungen":
      return `Keine Kette zu fahren: alle ${d.anzahl} gekennzeichneten Karten mit dem Label '${ohneArbeitName(d.label)}' `
        + "wurden uebersprungen, weil eine Voraussetzung fehlt.";
    // Die beiden Pruefsaetze teilen das Praefix `Nichts zu pruefen:` — wie die beiden
    // Kettensaetze darueber, und aus demselben Grund: Ein Matcher, der den Fall selbst nicht
    // unterscheidet, soll sich an eine Stelle haengen koennen.
    case "pruefLaufKeinLabel":
      return `Nichts zu pruefen: keine Karte traegt das Label '${ohneArbeitName(d.label)}'.`;
    case "pruefLaufAlleUebersprungen":
      return `Nichts zu pruefen: alle ${d.anzahl} gekennzeichneten Karten mit dem Label '${ohneArbeitName(d.label)}' `
        + "wurden uebersprungen, weil sie keine fachliche Anforderung sind oder eine Entscheidung wartet.";
    default:
      return OHNE_ARBEIT_UNBEKANNT;
  }
}

/**
 * Bildet den Satz, schreibt ihn ins Textprotokoll und an den Lauf-Kopf.
 *
 * Seit Issue #887 die einzige Stelle, die `noWorkReason` setzt: Protokoll und
 * Lauf-Kopf bekommen denselben Wortlaut, weil sie ihn aus demselben Aufruf beziehen.
 */
export function vermerkeOhneArbeit(fall, daten) {
  const satz = grundOhneArbeit(fall, daten);
  log(satz);
  if (ZUSTAND.LAUF) ZUSTAND.LAUF.noWorkReason = satz;
}

/**
 * Das Sicherheitsnetz fuer einen harten Stopp ohne Grund — der Text, oder `null`
 * (Issue #558).
 *
 * An EINER Stelle statt an sieben: Ein Netz je Abbruchweg waere sieben Stellen, an
 * denen dieselbe Entscheidung getroffen wird, und die achte vergaesse man.
 *
 * Als vorhandener Grund zaehlt ausschliesslich ein nicht leerer `fehlerText` des Laufs
 * oder ein nicht leerer `grund` der ueber `fehlerEinheit` referenzierten Einheit.
 * Gruende ANDERER Einheiten zaehlen ausdruecklich nicht: Eine begruendet
 * zurueckgestellte oder uebersprungene Einheit hat mit dem spaeteren Stopp nichts zu
 * tun, und wuerde sie das Netz unterdruecken, saehe der Stand vollstaendig aus,
 * waehrend der eigentliche Grund fehlt.
 *
 * Rein und mit explizitem Laufzustand, damit die Fallunterscheidung ohne einen
 * kompletten Nachtlauf pruefbar ist — `laufAbschliessen` selbst ist nicht exportiert.
 */
export function sicherheitsnetzGrund(lauf, stoppGrund) {
  const gefuellt = (text) => typeof text === "string" && text.trim() !== "";
  if (gefuellt(lauf.fehlerText)) return null;
  const betroffen = lauf.fehlerEinheit == null
    ? null
    : (lauf.einheiten || []).find((e) => String(e.id) === String(lauf.fehlerEinheit));
  if (betroffen && gefuellt(betroffen.grund)) return null;
  return gefuellt(stoppGrund) ? `${stoppGrund} ${ANKER_FEHLT}` : ERSATZ_GRUND;
}

/**
 * Legt die Einheit eines Pakets an und schreibt sofort — auch ohne Ergebnisstand.
 *
 * Exportiert fuer den Test der Feldreihenfolge (Issue #1026): Ohne laufenden Lauf haengt
 * das Objekt an nichts und wird nicht geschrieben.
 */
export function einheitAnlegen(id, titel, modellStand = null) {
  // Das Objekt entsteht immer, damit der Aufrufer nicht zwei Wege kennen muss. Im
  // Dry-Run haengt es an nichts und wird nie geschrieben.
  //
  // `modell`, `modellHerkunft` und `modellGrund` stehen direkt nach `titel` (Issue #665),
  // dahinter `stufe` und `stufeVerwendet` (Issue #711) und `effort` (Issue #846, die
  // Gruendlichkeit der verwendeten Stufe). Die Feldreihenfolge ist der Vertrag
  // mit den Auswertungen: Die fuenf alten Namen behalten ihre Plaetze, die neuen kommen
  // hinten an. `schemaFassung` bleibt 1, weil nur Felder hinzukommen. Ohne uebergebenen
  // Stand — die Kette, ein Gate-Rueckfall — tragen sie `null` statt zu fehlen: Ein fehlendes
  // Feld liesse offen, ob niemand gemessen hat oder ob die Frage sich nicht stellte.
  //
  // `stufe` ist die Stufe, die das Paket sich selbst gegeben hat; `stufeVerwendet` die, die
  // das Modell wirklich gestellt hat. Beide getrennt, weil das Ausweichen nach oben genau
  // der Unterschied zwischen ihnen ist — ein Feld liesse ihn verschwinden.
  const einheit = {
    id: String(id),
    titel,
    modell: modellStand?.modell ?? null,
    modellHerkunft: modellStand?.herkunft ?? null,
    modellGrund: modellStand?.grund ?? null,
    stufe: modellStand?.stufe ?? null,
    stufeVerwendet: modellStand?.stufeVerwendet ?? null,
    effort: modellStand?.effort ?? null,
    // Die Lauf-Art je Einheit (Issue #669): Die auswertende Seite ordnet ihr den
    // Arbeitsschritt an der Karte zu und sieht den Dateikopf dort nicht mehr.
    art: ZUSTAND.LAUF?.art ?? null,
    ausgang: "unbekannt",
    // Ob eine Session der Einheit mit /implement-* startete (Issue #1026, Plan #1015, E12).
    // Nicht nach `art`: Eine Kette enthaelt Umsetzungs- und andere Einheiten.
    umsetzung: false,
    // Die Zeit fuer Board-Auskuenfte (Issue #1026, E15), `{ ms, aufrufe }` sobald eine
    // Session beobachtet wurde. `null` heisst nicht gemessen, nie 0. Hinten, weil die
    // Feldreihenfolge der Vertrag mit den Auswertungen ist.
    auskunft: null,
  };
  if (ZUSTAND.LAUF) {
    ZUSTAND.LAUF.einheiten.push(einheit);
    schreibeErgebnisstand();
  }
  return einheit;
}

/** Ergaenzt eine Einheit um das Ergebnis ihrer Runde und schreibt erneut. */
export function einheitErgaenzen(einheit, felder) {
  Object.assign(einheit, felder);
  schreibeErgebnisstand();
  // Fortschreibend eingeliefert (Issue #669): Ein harter Stopp nimmt sonst die Daten der
  // ganzen Nacht mit. Der Server ersetzt denselben Lauf bei jeder Meldung.
  if (felder.ausgang !== undefined) laufMelden();
}

// Die zuletzt protokollierte Einliefer-Meldung — dieselbe Zeile steht nur einmal im
// Protokoll, auch wenn fortschreibend nach jeder Einheit gemeldet wird.
let LETZTE_MELDEZEILE = null;

function meldezeile(zeile) {
  if (zeile === LETZTE_MELDEZEILE) return;
  LETZTE_MELDEZEILE = zeile;
  log(zeile);
}

/**
 * Liefert den Ergebnisstand ueber `board.mjs nightrun melden` an kanban-kit ein (Issue #669).
 *
 * Nie ein Abbruch: Faellt die Einlieferung aus, bleibt die Datei der Rueckfall, und das
 * Protokoll nennt den Grund. Nur der toolbox-Tracker kennt die Schnittstelle; bei jedem
 * anderen entfaellt der Aufruf mit einer Zeile. `NIGHT_MELDEN_ERZWINGEN` ist ein Test-Hook,
 * der den Aufruf auch ohne toolbox erzwingt, damit der Fehlerpfad pruefbar ist.
 */
// `budgetMs` begrenzt die Einlieferung im Abbruch (Issue #1084, E8): Ein Ctrl-C soll
// nicht zwei Minuten auf ein langsames Board warten. `datei` und `stand` nennen einen
// fremden Laufbericht — den eines verstummten Laufs, den der Waechter oder der Rueckfall
// beim Start abschliesst (Issue #1085, E7, E18).
// `spawn` reicht den Start an boardRoh weiter (Plan #1199, E6), damit ein Test die Einlieferung im
// selben Prozess sieht.
export function laufMelden({ budgetMs, datei = ZUSTAND.ERGEBNIS_FILE, stand = ZUSTAND.LAUF, spawn } = {}) {
  if (!datei || !stand) return;
  // Die Art `pruefung` wird nicht eingeliefert (Plan #904, E15): `NACHTLAUF_MODUS` in
  // kit/board.mjs kennt sie nicht und wirft dafuer — fortschreibend gemeldet waere das je
  // Karte eine Fehlzeile im Protokoll, und der Ergebnisstand liegt ohnehin als Datei. Die
  // Ausnahme steht HIER und nicht als Zweig in board.mjs: Der Prueflauf gehoert dem Tag,
  // und die Schnittstelle beschreibt Nachtlaeufe.
  if (stand.art === "pruefung") {
    meldezeile("Einlieferung entfaellt: die Lauf-Art 'pruefung' hat keine Nachtlauf-Schnittstelle — der Ergebnisstand bleibt als Datei.");
    return;
  }
  const tracker = ZUSTAND.config?.issueTracker;
  if (tracker !== "toolbox" && !process.env.NIGHT_MELDEN_ERZWINGEN) {
    meldezeile(`Einlieferung entfaellt: issueTracker '${tracker}' kennt keine Nachtlauf-Schnittstelle — der Ergebnisstand bleibt als Datei.`);
    return;
  }
  const res = boardRoh("nightrun", "melden", "--datei", datei, { budgetMs, spawn });
  if (res.status !== 0) {
    meldezeile(`Einlieferung fehlgeschlagen: ${res.text.trim().slice(0, 300)} — der Ergebnisstand bleibt als Datei.`);
    return;
  }
  if (stand.abschluss !== null) meldezeile(`Nachtlauf eingeliefert (${res.json?.outcome ?? "ohne Rueckmeldung"}).`);
}

/** Die erste Zeile eines Fremdtextes, gekuerzt — damit eine Meldung eine Zeile bleibt. */
export function ersteZeile(text) {
  const zeile = (text || "").split(/\r?\n/).find((z) => z.trim() !== "") ?? "";
  return boardZitat(zeile.trim());
}

/** Wie oft ein Start den Stempel nach einer Kollision hoechstens neu bildet (Plan #1113, E11). */
const STEMPEL_NEUBILDUNGEN = 5;

/**
 * Reserviert den Lauf-Stempel, indem `.claude/night-run-<stempel>.json` exklusiv angelegt
 * wird (Plan #1113, E11; Issue #1190). Findet ein Start die Datei schon vor, hat ein
 * anderer Runner in derselben Sekunde begonnen: Er wartet bis zur naechsten vollen Sekunde
 * und bildet den Stempel neu, hoechstens `STEMPEL_NEUBILDUNGEN`-mal. Das Format bleibt —
 * es steht in Dateinamen, im Bericht-Lauf-Stempel und in Tests.
 *
 * Liefert Stempel, Pfad und die Zeit, aus der der Stempel gebildet wurde: Der Lauf-Kopf
 * traegt sie als Start, damit beide nicht auseinanderfallen. Gelingt die Reservierung
 * nicht — anderer Fehler als `EEXIST`, oder alle Neubildungen vergeben —, traegt das
 * Ergebnis `fehler` und den zuletzt gebildeten Stempel; der Aufrufer bricht deshalb nicht
 * ab. Uhr und Schlaf sind fuer die Tests einspeisbar.
 */
export function laufStempelReservieren(repoRoot, jetzt, {
  uhr = () => new Date(),
  warten = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
} = {}) {
  mkdirSync(join(repoRoot, ".claude"), { recursive: true });
  for (let versuch = 0; ; versuch++) {
    const iso = jetzt.toISOString();
    const stempel = `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(":", "")}`;
    const pfad = join(repoRoot, ".claude", `night-run-${stempel}.json`);
    try {
      writeFileSync(pfad, "{}\n", { encoding: "utf-8", flag: "wx" });
      return { stempel, jetzt, pfad, fehler: null };
    } catch (err) {
      if (err.code !== "EEXIST") return { stempel, jetzt, pfad, fehler: `Lauf-Stempel ${stempel}: ${err.message}` };
      if (versuch >= STEMPEL_NEUBILDUNGEN) {
        return { stempel, jetzt, pfad, fehler: `Lauf-Stempel ${stempel} auch nach ${STEMPEL_NEUBILDUNGEN} Neubildungen schon vergeben` };
      }
      warten(1000 - (jetzt.getTime() % 1000));
      jetzt = uhr();
    }
  }
}

/**
 * Schreibt den Ergebnisstand vollstaendig neu (Issue #486).
 *
 * Idempotent und ohne Anhaengen: JSON kennt kein Append, die Datei traegt immer den
 * ganzen Stand. Sie darf den Lauf nie abbrechen — ein Schreibfehler ist eine Zeile
 * im Textprotokoll und kein fail(): Der Ergebnisstand ist Protokoll, nicht Auftrag,
 * und eine Nacht wegen eines vollen Datentraegers zu beenden hiesse, das Protokoll
 * ueber die Arbeit zu stellen.
 */
export function schreibeErgebnisstand() {
  if (!ZUSTAND.ERGEBNIS_FILE || !ZUSTAND.LAUF) return;
  try {
    writeFileSync(ZUSTAND.ERGEBNIS_FILE, JSON.stringify(ZUSTAND.LAUF, null, 2) + "\n", "utf-8");
  } catch (err) {
    log(`Ergebnisstand konnte nicht geschrieben werden: ${err.message}`);
  }
}

// --- Board-Adapter als Kind-Prozess (keine Logik-Duplikation) ---

// Ohne `maxBuffer` puffert Node hoechstens 1 MB stdout/stderr, beendet den Kindprozess
// mit SIGTERM (ENOBUFS) und die Fehlermeldung traegt die halb gelesene Ausgabe statt
// eines Befunds (Issue #699): `issue list` ohne Statusfilter lag im kanban-kit bei
// 1.110 KB, die Done-Spalte allein bei 801 KB. 256 MB ist grosszuegig bemessen und gilt
// fuer beide Board-Helfer.
export const BOARD_MAX_BUFFER = 256 * 1024 * 1024;

// Eine zitierte Board-Ausgabe traegt hoechstens so viele Zeichen (Issue #699) — eine
// echte Fehlermeldung von board.mjs steht fast immer in den ersten Zeilen.
const BOARD_ZITAT_MAX = 500;

function boardZitat(text) {
  if (text.length <= BOARD_ZITAT_MAX) return text;
  return `${text.slice(0, BOARD_ZITAT_MAX)}… (${text.length - BOARD_ZITAT_MAX} Zeichen gekürzt)`;
}

/**
 * Reine Funktion (Issue #699): baut die Fehlermeldung eines gescheiterten board()-Aufrufs.
 * Nennt Fehlercode bzw. Signal des Kindprozesses, sofern gesetzt, und zitiert
 * `stderr || stdout` gekuerzt auf `BOARD_ZITAT_MAX` Zeichen.
 */
export function boardFehlertext(cliArgs, res) {
  const hinweise = [];
  if (res.error?.code) hinweise.push(res.error.code);
  if (res.signal) hinweise.push(`Signal ${res.signal}`);
  const praefix = hinweise.length ? ` (${hinweise.join(", ")})` : "";
  const zitat = boardZitat((res.stderr || res.stdout || "").trim());
  return `board.mjs ${cliArgs.join(" ")} schlug fehl${praefix}: ${zitat}`;
}

/**
 * Die Umgebung, mit der `board()` und `boardRoh()` board.mjs starten (Issue #1067).
 * Der Runner traegt kein KIT_AGENT_MODEL — das bekommen nur seine Sessions —, und ohne
 * diese Funktion liefen seine eigenen Board-Aufrufe mit dem interaktiven Budget von
 * 30 s. Bei langsamer Leitung beendete eine einzige haengende Ready-Abfrage so den
 * ganzen Lauf. Gesetzt wird die dokumentierte Stellschraube KIT_TOOLBOX_BUDGET_MS aus
 * Issue #842, nicht KIT_AGENT_MODEL: Das ist das Erkennungsmerkmal unbeaufsichtigter
 * Skills und steuert den Modell-Header, und der Runner ist kein Modell. Ein vom
 * Aufrufer gesetzter Wert bleibt stehen; ein leerer gilt als nicht gesetzt.
 * Fehlt der Nachbar board.mjs, fehlt auch die Konstante; dann bleibt die Umgebung,
 * wie sie ist — statt eines Werts "undefined", und ohne zweite Zahl in dieser Datei.
 *
 * Ein ausdrueckliches `budgetMs` steht vor allem anderen (Issue #1084, E8): Die
 * Abbruch-Handler geben ihren Board-Aufrufen ein kurzes Budget, und gerade dort darf
 * weder der Nachtwert noch ein gesetzter Wert sie zwei Minuten warten lassen.
 */
export function boardUmgebung(env = process.env, budgetMs = undefined) {
  if (budgetMs !== undefined) return { ...env, KIT_TOOLBOX_BUDGET_MS: String(budgetMs) };
  if (TOOLBOX_BUDGET_NACHT_MS === undefined || String(env.KIT_TOOLBOX_BUDGET_MS ?? "").trim()) return { ...env };
  return { ...env, KIT_TOOLBOX_BUDGET_MS: String(TOOLBOX_BUDGET_NACHT_MS) };
}

/**
 * Der eine Kindprozess-Aufruf beider Board-Helfer — mit dem Puls davor und danach
 * (Issue #1084, E6): Ein Board-Aufruf kann bis zum vollen Budget blockieren, und waehrend
 * er laeuft, schweigt der Takt des Pulses.
 *
 * `opts.spawn` ersetzt den Start (Plan #1199, E6): So belegt ein Test im selben Prozess,
 * was board() mit Exit-Code und Ausgabe macht, statt board.mjs als Kindprozess zu faelschen.
 */
function boardAufruf(cliArgs, opts) {
  const spawn = opts.spawn ?? spawnSync;
  anbindung.pulsSchreiben();
  const res = spawn(process.execPath, [BOARD_PATH, ...cliArgs], { encoding: "utf-8", cwd: opts.cwd ?? process.cwd(), maxBuffer: BOARD_MAX_BUFFER, env: boardUmgebung(process.env, opts.budgetMs) });
  anbindung.pulsSchreiben();
  return res;
}

// Das letzte Argument darf ein Optionsobjekt sein — `cwd` (Plan #638, A4), `budgetMs`
// (Issue #1084, E8) und `spawn` (Plan #1199, E6): Die Kette arbeitet in einem eigenen
// Worktree, und ein Board-Aufruf dort liest die Config des Worktrees; das Budget kuerzt die
// Aufrufe im Abbruch. Ohne Objekt bleibt alles, wie es war.
export function board(...cliArgs) {
  const letztes = cliArgs.at(-1);
  const opts = letztes && typeof letztes === "object" ? cliArgs.pop() : {};
  let res = boardAufruf(cliArgs, opts);
  // Ein gescheiterter Aufruf des lebenden Laufs bekommt genau einen Versuch nach der Pause
  // (Issue #1088, E13); scheitert auch er, haelt der Lauf an. Ohne Stempel — Trockenlauf,
  // Vorbereitung — gibt es noch keinen Lauf, und es bleibt beim sofortigen Ende.
  if (res.status !== 0) {
    const text = boardFehlertext(cliArgs, res);
    if (anbindung.anhaltenLaeuft()) throw new Error(text);
    if (!ZUSTAND.LAUF_STEMPEL) fail(text, "tracker");
    anbindung.zweiterVersuch(text);
    res = boardAufruf(cliArgs, opts);
    if (res.status !== 0) anbindung.laufAnhalten(`${boardFehlertext(cliArgs, res)} (auch im 2. Versuch)`, "tracker");
    anbindung.vermerkAnDieKarte();
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    fail(`board.mjs ${cliArgs.join(" ")} lieferte kein JSON: ${res.stdout.slice(0, 200)}`, "tracker");
  }
}

/**
 * Ein Board-Aufruf, der NICHT abbricht (Plan #638, A7): `issue check-form` endet bei
 * Verstoessen mit Exit 1 und JSON — fuer die Kette ist das ein Befund, kein Ausfall.
 * Rueckgabe `{ status, json, text }`; `json` ist null, wenn stdout kein JSON traegt.
 *
 * Das letzte Argument darf wie bei `board` ein Optionsobjekt `{ cwd, budgetMs }` sein
 * (Issue #1033, #1084): Die Testhinweise der Formpruefung entstehen gegen die Dateien des
 * Worktrees.
 */
export function boardRoh(...cliArgs) {
  const letztes = cliArgs.at(-1);
  const opts = letztes && typeof letztes === "object" ? cliArgs.pop() : {};
  const res = boardAufruf(cliArgs, opts);
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, json, text: boardZitat((res.stderr || res.stdout || "").trim()) };
}

// --- Git-Helfer ---

// PATH-Aufloesung bei den git- und sh-Aufrufen dieser Datei: bewusst so (Issue #183).
//
// SonarQube S4036 ("OS commands should not rely on PATH resolution") markiert jeden
// Start eines Kommandos ohne absoluten Pfad. Die Regel ist hier nicht erfuellbar,
// ohne mehr kaputtzumachen als sie schuetzt:
//
//   - Absolute Pfade brechen die zugesagte Portabilitaet. Das Kit laeuft auf Mac,
//     Windows und Linux; /usr/bin/git existiert unter Windows nicht, und je nach
//     Installation liegt git auch unter /opt/homebrew/bin.
//   - Ein kontrollierter env.PATH ist kein Fix: Die Regel beanstandet nicht, WELCHEN
//     PATH der Prozess bekommt, sondern DASS ueber PATH aufgeloest wird.
//   - Die sh -c-Aufrufe (runBuildChecksSync, Format-Fix) fuehren frei konfigurierte
//     Kommandozeilen aus der workflow.config.json aus. Die brauchen zwingend eine
//     Shell — ohne sie gibt es das Feature nicht.
//
// Zur Risikobewertung: Das sind lokale Entwickler-Werkzeuge, die der Nutzer auf seiner
// eigenen Maschine startet. Wer dort ein PATH-Verzeichnis beschreiben kann, hat bereits
// Codeausfuehrung unter derselben Kennung — der Angriff setzt voraus, was er erreichen
// soll. Die Findings sind in SonarCloud als accepted markiert, mit derselben Begruendung.
/**
 * Die Pfade, die kein Rest sind — eine Liste mit zwei Lesern (Issue #818).
 *
 * `gitReste()` misst damit, was als unkommittete Arbeit zaehlt, und
 * `salvageSauberkeitsKommando()` baut daraus das Kommando, das der Salvage-Prompt
 * der Session nennt. Bis #818 stand im Prompt ein nacktes `git status --porcelain`,
 * und damit urteilten Session und Runner in einem Projekt ohne den `.claude/*`-Block
 * in `.gitignore` verschieden: Die Session sah `night-run-*`, den Umsetzungs-Lock und
 * die Protokolle, liess das Board darum unberuehrt, und der Runner meldete danach
 * "SALVAGE UNVOLLSTAENDIG" mit hartem Stopp. Die Rettung scheiterte an einem
 * Widerspruch zwischen zwei Regeln desselben Werkzeugs. Eine Liste kann nicht
 * auseinanderlaufen, zwei Aufzaehlungen koennen es.
 *
 * `cfg` ist aus demselben Grund ein Parameter wie `config` ein Modul-Let ist: Die
 * Funktion wird aus der Hauptschleife heraus gerufen, aber auch fuer sich getestet.
 */
export function gitResteAusnahmen(cfg = ZUSTAND.config) {
  return [
    // Beim lokalen Tracker sind Board-Moves Dateiaenderungen unter issuesDir —
    // Board-Zustand ist kein Code-Zustand und zaehlt nicht als dirty.
    ...(cfg?.issueTracker === "local" ? [cfg.local?.issuesDir || "issues"] : []),
    // Das Nacht-Protokoll (Textdatei und Ergebnisstand, Issue #486) entsteht waehrend
    // des Laufs im Arbeitsbaum: Protokoll-Zustand ist kein Code-Zustand. Anders als die
    // issuesDir-Ausnahme gilt diese unabhaengig vom Tracker — der Runner legt seine
    // Dateien in jedem Projekt an, und ohne die Ausnahme stoppte der Rest-Guard (#152)
    // nach jeder erfolgreichen Runde hart, sobald .gitignore .claude/* nicht fuehrt.
    ".claude/night-run-*",
    // Altlast aus SDD, Rueckbau mit dem uebernaechsten Major (Plan #825, A5): Bis zum
    // Rueckbau von Spec-Driven Development legte `/techplan` wartende Vorhaben-Notizen unter
    // `.claude/vorhaben-wartend-*` ab. Heute entsteht keine mehr, aber in Zielprojekten kann
    // noch eine liegen. Ohne den `.claude/*`-Block in `.gitignore` (der Installer laesst eine
    // eigene `.claude`-Regel unangetastet) hielte sie den Lauf sonst hart an.
    ".claude/vorhaben-wartend-*",
    // Ein wartender Nachtbericht (Issue #645) liegt in der Hauptkopie, bis der Tracker ihn
    // annimmt — Protokoll-Zustand wie `night-run-*`, und aus demselben Grund hier ausgeschlossen.
    ".claude/night-bericht-*",
    // Der Umsetzungs-Lock (Issue #696) liegt waehrend jeder Umsetzung in der Hauptkopie:
    // Laufzeit-Zustand, kein Code-Zustand. Der Ausschluss steht hier aus demselben Grund wie
    // das Protokoll darueber — nachgewiesen, nicht angenommen: Ohne ihn stoppte der
    // Rest-Guard (#152) in jedem Projekt ohne den `.claude/*`-Block nach der ersten
    // erfolgreichen Runde hart, und die Umsetzungsstufe saehe die Hauptkopie schon vor ihrem
    // ersten Paket als unsauber.
    UMSETZUNG_LOCK,
    // Die Markierung des festen Kit-Stands (Issue #1102, A4) liegt waehrend des Laufs in der
    // Hauptkopie: Laufzeit-Zustand wie der Lock darueber, kein Code-Zustand.
    KIT_STAND_MARKIERUNG,
    // Die Wegmarken (Issue #733) entstehen bei JEDEM Zug nach In progress oder In review —
    // der Runner schreibt zwei je Runde, die Session weitere. Buchhaltung, kein
    // Code-Zustand, und aus demselben Grund hier ausgeschlossen wie das Protokoll darueber:
    // Ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt ohne den
    // `.claude/*`-Block nach der ersten erfolgreichen Runde hart. Damit waere die Wegmarke
    // eine Bedingung der Arbeit statt ihrer Buchhaltung.
    // SYNC: derselbe Pfad steckt als WEGMARKEN_DATEI in kit/board.mjs, das ihn schreibt;
    // die Kit-Werkzeuge sind bewusst eigenstaendige Single-File-Tools ohne gemeinsames
    // Modul (#440), geteilte Konstanten werden dupliziert und hier markiert.
    ".claude/wegmarken.tsv",
    // Die Aufwands-Auswertung (Issue #752) entsteht am Ende JEDES Laufs im Arbeitsbaum —
    // `.claude/aufwand.md` fuer Menschen, `.claude/aufwand.json` fuer die zwei
    // Ausgabestellen. Protokoll-Zustand, kein Code-Zustand, und aus demselben Grund
    // ausgeschlossen wie `night-run-*` darueber: Ohne den Ausschluss stoppte der Rest-Guard
    // (#152) im naechsten Lauf nach der ersten erfolgreichen Runde hart, sobald `.gitignore`
    // den `.claude/*`-Block nicht fuehrt. Die Messung machte dann die Arbeit unmoeglich,
    // die sie misst.
    ".claude/aufwand.*",
    // Die Wirksamkeits-Auswertung (Plan #782, E12) legt vier weitere Dateien im Arbeitsbaum
    // an: die Protokolle `bewegungen.tsv` und `ausfuehrungen.tsv`, die in JEDEM Lauf
    // mitschreiben, und die beiden Berichte `wirksamkeit.md` (fuer Menschen) und
    // `wirksamkeit.json` (fuer die Weiterverarbeitung). Erhebung und Auswertung, kein
    // Code-Zustand — und aus demselben Grund ausgeschlossen wie `aufwand.*` darueber:
    // Ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt, dessen
    // `.gitignore` den `.claude/*`-Block nicht fuehrt, nach der ersten erfolgreichen Runde
    // hart. Die Messung machte dann die Arbeit unmoeglich, die sie misst. Dieses Repo
    // fuehrt den Block und ist darum nicht selbst betroffen; ein frisch installiertes
    // Projekt ohne ihn waere es.
    // SYNC: die schreibenden Stellen liegen anderswo — `bewegungen.tsv` in kit/board.mjs,
    // `ausfuehrungen.tsv` in kit/checks.mjs, `wirksamkeit.md` und `wirksamkeit.json` in
    // kit/wirksamkeit.mjs; die Kit-Werkzeuge sind bewusst eigenstaendige Single-File-Tools
    // ohne gemeinsames Modul (#440), geteilte Konstanten werden dupliziert und hier markiert.
    ".claude/bewegungen.tsv", // SYNC: kit/board.mjs schreibt sie
    ".claude/ausfuehrungen.tsv", // SYNC: kit/checks.mjs schreibt sie
    // Der Pruef-Nachweis, aus demselben Grund und mit demselben Schadensbild (Issue #919):
    // Seit die Salvage-Vorpruefung ueber `checks.mjs run` geht, legt der RUNNER die Datei
    // selbst an. In einem Projekt ohne den `.claude/*`-Block zaehlte sie danach als
    // liegengebliebene Arbeit, und die geglueckte Rettung endete als "SALVAGE
    // WIDERSPRUECHLICH" — der Nachweis der Pruefung machte die Rettung unmoeglich, die er
    // belegt. Nachweis einer Pruefung, kein Code-Zustand.
    ".claude/checks-summary.json", // SYNC: kit/checks.mjs schreibt ihn (SUMMARY_DATEI)
    // Die abgelegten Ausgaben roter Pruefungen (Issue #1196), aus demselben Grund: Ohne den
    // Ausschluss stoppte der Rest-Guard nach jedem roten Lauf in einem Projekt ohne den
    // `.claude/*`-Block hart.
    ".claude/checks-protokolle", // SYNC: kit/checks.mjs schreibt ihn (PROTOKOLL_ORDNER)
    ".claude/wirksamkeit.md", // SYNC: kit/wirksamkeit.mjs schreibt ihn
    ".claude/wirksamkeit.json", // SYNC: kit/wirksamkeit.mjs schreibt ihn
    // Die Befunde der Modell-Pruefungen (Plan #797; Issue #803) legen vier weitere Dateien
    // an: das Protokoll `befunde.tsv` (`befunde buchen` schreibt es, `befundeZurueck` holt
    // es aus dem Worktree zurueck), die Nullpunkte `befunde-vorschlaege.json` und die
    // Berichte `befunde.md` und `befunde.json`. Buchhaltung, kein Code-Zustand — und aus
    // demselben Grund ausgeschlossen wie die vier Dateien der Wirksamkeits-Auswertung
    // darueber: Ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt ohne
    // den `.claude/*`-Block nach der ersten Buchung hart.
    ".claude/befunde.tsv", // SYNC: kit/befunde.mjs schreibt sie
    ".claude/befunde-vorschlaege.json", // SYNC: kit/befunde.mjs liest sie
    ".claude/befunde.md",
    ".claude/befunde.json",
    // Die Stuecke eines gestueckelten Abschlussberichts (Issue #1022): `issue melden
    // --teil` legt sie ab, der Abschlussaufruf raeumt sie erst nach Ablage und Zug.
    // Scheitert er, liegen sie bis zur Wiederholung dort — Zwischenstand einer Meldung,
    // kein Code-Zustand, und ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem
    // Projekt ohne den `.claude/*`-Block hart, obwohl die Wiederholung alles aufraeumt.
    ".claude/berichte/", // SYNC: kit/board.mjs schreibt sie (BERICHTE_ORDNER)
    // Journal und Puls jedes Laufs (Issue #1084): Laufzeit-Zustand, kein Code-Zustand —
    // und ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt ohne den
    // `.claude/*`-Block schon nach der ersten Runde hart, weil der Runner beide selbst anlegt.
    ".claude/lauf/",
    // Die Protokolle je Schritt (Issue #1090, E16) aus demselben Grund: Der Runner legt sie
    // waehrend jeder Runde selbst an.
    ".claude/protokolle/",
  ];
}

/**
 * Die Ausnahmen als git-Pathspec (Issue #818). Eine Herleitung, zwei Verwendungen:
 * `gitReste()` uebergibt sie als Argumente, das Salvage-Kommando setzt sie als Text
 * zusammen. Zwei Herleitungen desselben Pathspec liefen bei der ersten Aenderung
 * auseinander — und genau das war der Fehler, den #818 behebt.
 */
export function gitRestePathspec(ausnahmen = gitResteAusnahmen()) {
  return ["--", ".", ...ausnahmen.map((pfad) => `:(exclude)${pfad}`)];
}

/**
 * Das Kommando, mit dem eine Session ihren Arbeitsbaum genauso misst wie der Runner
 * (Issue #818). Es geht als Text in den Salvage-Prompt und wird dort von einer Shell
 * ausgefuehrt, darum die Anfuehrungszeichen: Ein `:(exclude).claude/night-run-*` ohne
 * sie waere ein Glob, das die Shell vorher aufloeste.
 */
export function salvageSauberkeitsKommando(ausnahmen = gitResteAusnahmen()) {
  // Ein Apostroph im Pfad beendet die Quotierung; die Shell-uebliche Folge setzt ihn
  // ausserhalb wieder ein. Unwahrscheinlich in einem issuesDir, aber billiger als die
  // Annahme, dass es ihn nie gibt.
  const apostroph = String.raw`'\''`;
  const teile = gitRestePathspec(ausnahmen).map((teil) =>
    /^[A-Za-z0-9._/-]+$/.test(teil) ? teil : `'${teil.replaceAll("'", apostroph)}'`);
  return `git status --porcelain ${teile.join(" ")}`;
}

// `spawn` ersetzt den git-Aufruf im Test (Plan #1199, E6).
export function gitReste(cwd = process.cwd(), cfg = ZUSTAND.config, { spawn = spawnSync } = {}) {
  const res = spawn("git", ["status", "--porcelain", ...gitRestePathspec(gitResteAusnahmen(cfg))], { encoding: "utf-8", cwd });
  if (res.status !== 0) fail("git status schlug fehl — bin ich im Projekt-Root eines git-Repos?");
  return res.stdout.split(/\r?\n/).filter((zeile) => zeile.trim() !== "");
}

/**
 * Ist der Arbeitsbaum sauber? Die Leerheit von gitReste() — eine Quelle, nicht zwei.
 *
 * Seit Issue #558 braucht jeder Guard, der hier anschlaegt, auch die Namen der
 * liegengebliebenen Dateien fuer seinen Grund. Zwei getrennte git-Aufrufe mit
 * getrennten Ausschluessen waeren zwei Wahrheiten darueber, was als Rest zaehlt.
 */
export function gitClean(cwd = process.cwd(), { spawn = spawnSync } = {}) {
  return gitReste(cwd, ZUSTAND.config, { spawn }).length === 0;
}

export function lastCommitHash(cwd = process.cwd(), { spawn = spawnSync } = {}) {
  // PATH-Aufloesung bewusst, siehe Begruendung ueber gitReste() (S4036, Issue #183).
  const res = spawn("git", ["log", "-1", "--format=%h"], { encoding: "utf-8", cwd });
  return res.status === 0 ? res.stdout.trim() : "?";
}

// --- Config mit persoenlichen Overrides (Issue #207) ---

// SYNC: Allowlist und Merge-Logik stehen identisch in kit/board/grundlagen.mjs und kit/einstellungen.mjs
// (LOCAL_OVERRIDE_ALLOWLIST, mergeWorkflowConfig) — Aenderungen dort nachziehen.
// board.mjs und night.mjs sind bewusst eigenstaendige Single-File-Tools ohne
// gemeinsames Modul; geteilte Logik wird dupliziert und hier markiert.
//
// Fuer den Runner ist die Allowlist besonders wichtig: Die Pruefung auf leere
// buildChecks weiter unten ist sein einziges Gate. Waere das Feld lokal
// ueberschreibbar, koennte ein Nachtlauf ohne jede Absicherung durchlaufen.
const LOCAL_OVERRIDE_ALLOWLIST = ["reviewModel", "reviewCommand", "reviewScope", "triggers", "toolbox.tokenFile"];

// Das Reviewer-Paar (Issue #432): genau eines von reviewModel und reviewCommand gilt.
// Beide sind persoenlich ueberschreibbar — sonst koennte jemand seinen Claude-Reviewer
// lokal setzen, seinen Kommando-Reviewer aber nicht.
// SYNC: dieselbe Zuordnung steckt in kit/board/grundlagen.mjs und kit/einstellungen.mjs.
const REVIEWER_PAAR = { reviewModel: "reviewCommand", reviewCommand: "reviewModel" };

// SYNC: strukturgleich zu zerlegeAllowlist in kit/board.mjs.
// Zerlegt die Allowlist in die zwei Formen, in denen sie abgefragt wird: ganze Felder
// (`reviewModel`) und einzelne Blaetter unter einem Kopf (`toolbox.tokenFile`). Eigene
// Funktion, weil das eine andere Frage beantwortet als das Mischen darunter.
function zerlegeAllowlist(allowlist) {
  const erlaubteBlaetter = new Map();
  const erlaubteFelder = new Set();
  for (const pfad of allowlist) {
    const [kopf, blatt] = pfad.split(".");
    if (blatt) {
      if (!erlaubteBlaetter.has(kopf)) erlaubteBlaetter.set(kopf, new Set());
      erlaubteBlaetter.get(kopf).add(blatt);
    } else {
      erlaubteFelder.add(kopf);
    }
  }
  return { erlaubteFelder, erlaubteBlaetter };
}

export function ladeConfigMitOverrides(sharedPfad) {
  const shared = JSON.parse(readFileSync(sharedPfad, "utf-8"));
  const lokalPfad = join(dirname(sharedPfad), "workflow.config.local.json");
  if (!existsSync(lokalPfad)) return shared;

  let local;
  try {
    local = JSON.parse(readFileSync(lokalPfad, "utf-8"));
  } catch {
    // Eine persoenliche Datei mit Tippfehler darf den Lauf nicht kippen.
    process.stderr.write(`Hinweis: ${lokalPfad} ist kein gueltiges JSON und wird ignoriert.\n`);
    return shared;
  }

  return mischeErlaubteFelder(shared, local);
}

/**
 * Legt die erlaubten Felder der persoenlichen Config ueber die geteilte (Issue #404).
 *
 * Getrennt vom Laden, weil es eine andere Frage ist: ladeConfigMitOverrides
 * beschafft die beiden Dateien und entscheidet, ob es ueberhaupt etwas zu mischen
 * gibt; diese Funktion entscheidet Feld fuer Feld, was uebernommen wird.
 */
/**
 * Setzt ein persoenliches Feld und raeumt beim Reviewer-Paar das Gegenstueck weg.
 *
 * Von reviewModel und reviewCommand darf genau eines gelten (Issue #432); striktes
 * feldweises Mischen liesse sonst beide stehen, sobald das Team den Claude-Default
 * faehrt und einer lokal mit fremder CLI reviewt. Stehen beide Felder in der lokalen
 * Datei, bleiben beide — die Datei ist dann schon fuer sich ungueltig.
 *
 * SYNC: strukturgleich zu setzePersoenlichesFeld in kit/board.mjs.
 */
function setzePersoenlichesFeld(config, feld, wert, local) {
  config[feld] = wert;
  const gegenstueck = REVIEWER_PAAR[feld];
  if (gegenstueck && !(gegenstueck in local)) delete config[gegenstueck];
}

function mischeErlaubteFelder(shared, local) {
  const config = { ...shared };
  const { erlaubteFelder, erlaubteBlaetter } = zerlegeAllowlist(LOCAL_OVERRIDE_ALLOWLIST);

  for (const [feld, wert] of Object.entries(local)) {
    if (erlaubteFelder.has(feld)) {
      setzePersoenlichesFeld(config, feld, wert, local);
    } else if (erlaubteBlaetter.has(feld) && wert && typeof wert === "object") {
      config[feld] = mischeBlattfelder(config[feld], wert, erlaubteBlaetter.get(feld), feld);
    } else {
      process.stderr.write(`Hinweis: '${feld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`);
    }
  }
  return config;
}

/**
 * Mischt die erlaubten Unterfelder eines Blocks (etwa `toolbox.tokenFile`).
 *
 * Eigene Funktion, weil hier eine zweite Allowlist gilt: Nicht der Block ist
 * freigegeben, sondern einzelne Blaetter darin. Ein nicht freigegebenes Unterfeld
 * wird gemeldet und faellt weg — es teamweit zu ueberschreiben waere genau das,
 * was die Trennung der beiden Dateien verhindern soll.
 */
function mischeBlattfelder(bisher, wert, blaetter, feld) {
  const zusammen = { ...bisher };
  for (const [unterfeld, unterwert] of Object.entries(wert)) {
    if (blaetter.has(unterfeld)) zusammen[unterfeld] = unterwert;
    else process.stderr.write(`Hinweis: '${feld}.${unterfeld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`);
  }
  return zusammen;
}
