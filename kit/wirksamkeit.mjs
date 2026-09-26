#!/usr/bin/env node
/**
 * claude-workflow-kit Wirksamkeits-Auswertung (Issue #787, Plan #782, Fachliche Quelle #767)
 *
 * Macht aus dem Ausfuehrungsprotokoll der Pruefungen eine Aussage darueber, ob eine
 * Pruefung etwas taugt: `auswerten` liest `.claude/ausfuehrungen.tsv`, aggregiert je
 * Pruefkommando Ausfuehrungen, Beanstandungen und Dauer ueber ein Zeitfenster und
 * schreibt `.claude/wirksamkeit.md` (fuer Menschen) und `.claude/wirksamkeit.json`
 * (fuer die Ausgabestellen). `befund` gibt allein den Befundblock als Text aus.
 *
 * WARUM EIN EIGENES WERKZEUG UND KEIN ANBAU (Plan #782, E1): nach dem Muster von
 * kit/aufwand.mjs — die Pruefungs-Kennzahlen sind eine reine Leseoperation ueber
 * Dateien und vollstaendig an Fixtures pruefbar. Die Ruecklaeuferquote (Issue #788)
 * kommt dazu: Sie paart den Kandidatenfilter aus `.claude/bewegungen.tsv` mit dem
 * Aktivitaetsverlauf der Karten — der einzige Board-Zugriff des Werkzeugs, und jeder
 * seiner Fehlschlaege ist ein Vermerk im Bericht, kein Abbruch (E9).
 *
 * MITTLERE PRUEFZEIT JE KARTE (Issue #951, Plan #944, E8): die Zeit der Abschlusslaeufe
 * einer Karte, und daneben der Vergleichswert — dieselbe Zeit plus die mittlere Dauer
 * jeder beim Abschluss ausgelassenen Pruefung aus demselben Fenster. Die Einheit ist die
 * KARTE, nicht der Lauf: Ein Paket wird mehrfach abgeschlossen, und die Wiederholung
 * gehoert in den Zaehler.
 *
 * ZAEHLWEISE DER QUOTE (Fund 8): Der Nenner zaehlt KARTEN mit mindestens einem
 * Eintritt nach "In review" im Fenster, der Zaehler zaehlt RUECKLAUFBEWEGUNGEN im
 * Fenster — die Quote kann ueber 100 % liegen und wird nicht gekappt.
 *
 * RESTLUECKE (Fund 6): Eine Karte, die ein Mensch am Board-UI nach "In review"
 * zieht, ohne dass das Kit sie je bewegt hat, erzeugt keine Protokollzeile und wird
 * nie Kandidat — sie fehlt in Zaehler und Nenner. Der Bericht nennt das sichtbar.
 *
 * DREI ZUSTAENDE JE PRUEFUNG, streng getrennt: ausgefuehrt mit Beanstandungen,
 * ausgefuehrt und nie beanstandet, nicht gelaufen. "Nicht gelaufen" loest nie einen
 * Befund aus und wird nie als "nie beanstandet" dargestellt — eine Pruefung, die gar
 * nicht lief, hat weder Wirksamkeit noch Wirkungslosigkeit bewiesen.
 *
 * DAS FENSTER traegt seinen eigenen Anfang (E2): `jetzt − fensterTage`, nach vorne
 * abgeschnitten am Erhebungsbeginn — dem fruehesten Zeitstempel im Protokoll. Beginnt
 * die Erhebung spaeter als das Fenster, nennt der Bericht diesen Anfang als Teil der
 * Traglast; sonst laese sich eine junge Erhebung als duenne Datenlage.
 *
 * MESSGRENZE (E17): Die Salvage-Pruefungen des Nacht-Runners rufen die Kommandos roh
 * ueber spawnSync auf und laufen an checks.mjs vorbei; ihre Ausfuehrungen stehen nicht
 * im Protokoll. Der Bericht nennt das sichtbar.
 *
 * NICHT-ZIEL: keine Handlungsempfehlung. Das Werkzeug sagt, was auffaellt, nicht was
 * zu tun ist — dieselbe Haltung wie in kit/aufwand.mjs.
 *
 * Aufruf im Projekt-Root:  node .claude/kit/wirksamkeit.mjs auswerten [--fenster <tage>]
 *                          node .claude/kit/wirksamkeit.mjs befund
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit liefert
 * seine Werkzeuge als eigenstaendig portable Einzeldateien aus.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.3.3";

const CLAUDE_DIR = ".claude";
const STAND_DATEI = "wirksamkeit.json";
const BERICHT_DATEI = "wirksamkeit.md";
const CONFIG_DATEI = "workflow.config.json";

// SYNC: kit/checks.mjs schreibt diese Datei (`ausfuehrungSchreiben`, Issue #785).
// Die Kit-Werkzeuge sind bewusst eigenstaendige Single-File-Tools ohne gemeinsames
// Modul (#440); geteilte Konstanten werden dupliziert und hier markiert.
const AUSFUEHRUNGEN_DATEI = "ausfuehrungen.tsv";

// SYNC: kit/board.mjs schreibt diese Datei (`bewegungSchreiben`, Issue #786) —
// eine Zeile je gegluecktem `issue move`: Zeitpunkt, Kartennummer, Status.
const BEWEGUNGEN_DATEI = "bewegungen.tsv";

// Die Auswertung ruft die installierte Kopie des Adapters auf, nie die Quelle.
const BOARD_KOMMANDO = [".claude", "kit", "board.mjs"];

// SYNC: COLUMN_DEFAULTS aus kit/board.mjs — die Anzeigenamen der Spalten, gegen die
// das Ziel einer Verlaufsbewegung gehalten wird, wenn die Config schweigt.
const SPALTEN_VORGABE = {
  backlog:     "Backlog",
  ready:       "Ready",
  in_progress: "In progress",
  in_review:   "In review",
  done:        "Done",
};

// Das Praefix der MOVED-Detailzeile, wie das Board sie fuehrt (E6): Dahinter steht
// der ANZEIGENAME der Zielspalte, nicht der Statusschluessel.
const VERSCHOBEN_PRAEFIX = "Verschoben nach ";

/**
 * Die eingebauten Vorgaben. Sie gelten, solange die Config schweigt — damit ein
 * bestehendes Projekt die Auswertung bekommt, sobald es die neue Fassung des
 * Werkzeugkastens erhaelt, ohne weitere Einrichtung. Jeder Wert aus dem Config-Block
 * `wirksamkeit` sticht seine Vorgabe.
 */
const VORGABE_FENSTER_TAGE = 30;
const VORGABE_NIE_BEANSTANDET_AB = 10;
const VORGABE_KANDIDATEN_MAX = 200;
const VORGABE_QUOTE_SCHWELLE = 0.2;
const VORGABE_QUOTE_AB_PAKETEN = 10;

const TAG_MS = 24 * 60 * 60 * 1000;

// Was im Protokoll als Ausfuehrung zaehlt (E4): eine Zeile mit `gruen` oder `rot`.
// Beanstandet heisst `rot`. Jede andere Zeile ist fehlerhaft und wird gezaehlt statt
// gedeutet — auch ein kuenftiger dritter Ergebniswert faellt so auf, statt still eine
// Kennzahl zu verschieben.
const ERGEBNISSE = new Set(["gruen", "rot"]);

// Der Platzhalter fuer eine fehlende oder leere Herkunftsspalte (Issue #951). Bewusst
// ein Wert und nicht `null`: Er steht so in der Zeile, laesst sich zaehlen und kann in
// keiner Kennzahl versehentlich als gemessene 0 gelten.
const UNBEKANNT = "unbekannt";

// SYNC: `herkunft` in kit/checks.mjs setzt diese Anlaesse (Issue #948) — `abschluss`
// fuer einen Lauf mit `--abschluss`, sonst die gefahrene Stufe. Der Abschluss einer
// Karte ist der Zaehler der Kennzahl je Karte, die Veroeffentlichungslaeufe liefern die
// Dauer der beim Abschluss ausgelassenen Pruefungen (Issue #951, Plan #944, E8).
const ANLASS_ABSCHLUSS = "abschluss";
const ANLAESSE_VEROEFFENTLICHUNG = new Set(["push", "merge"]);

// SYNC: `kommandoMaskieren` in kit/checks.mjs setzt diese Maskierungen (Issue #822).
// Jedes andere Zeichen hinter einem Backslash bleibt, was es ist — eine alte, vor der
// Maskierung geschriebene Zeile liest sich damit unveraendert.
const MASKIERUNGEN = new Map([["t", "\t"], ["n", "\n"], ["r", "\r"], ["\\", "\\"]]);

const HELP = `wirksamkeit.mjs (claude-workflow-kit v${KIT_VERSION}) — Wirksamkeit der Pruefungen

  node wirksamkeit.mjs auswerten [--fenster <tage>]
  node wirksamkeit.mjs befund

auswerten  Liest ${CLAUDE_DIR}/${AUSFUEHRUNGEN_DATEI}, aggregiert je Pruefkommando
           Ausfuehrungen, Beanstandungen und Dauer ueber das Zeitfenster, rechnet die
           mittlere Pruefzeit je Karte aus den Abschlusslaeufen samt Vergleichswert,
           ermittelt
           die Ruecklaeuferquote (Kandidaten aus ${CLAUDE_DIR}/${BEWEGUNGEN_DATEI},
           Verlauf ueber board.mjs issue activity) und schreibt
           ${CLAUDE_DIR}/${BERICHT_DATEI} sowie ${CLAUDE_DIR}/${STAND_DATEI}. Die
           Ausgabe auf stdout ist immer JSON — auch im Leerfall und auch bei einem
           abgewiesenen Aufruf. Ein Fehlschlag des Board-Teils ist ein Vermerk im
           Bericht, kein Abbruch.
befund     Gibt den Befundblock aus ${CLAUDE_DIR}/${STAND_DATEI} als Text aus, mit
           Datum der Auswertung und Fenster in der Kopfzeile. Liegt kein Befund vor,
           fehlt die Datei oder ist sie unlesbar, bleibt die Ausgabe leer. Exit immer
           0 — der Befund ist kein Gate.

  --fenster <tage>  Laenge des Zeitfensters in Tagen (Vorgabe ${VORGABE_FENSTER_TAGE}).
                    Sticht den Config-Block.
  --version         Kit-Stand dieser Datei.
  --help, -h        Diese Uebersicht.

Gelesen wird ${CLAUDE_DIR}/${CONFIG_DATEI} im Arbeitsverzeichnis: 'buildChecks' (fuer
die Menge der vorgeschriebenen Pruefungen und ihr 'nichtBeimAbschluss' fuer den
Vergleichswert der Pruefzeit je Karte), 'columns' und 'issueTracker' (fuer die
Ruecklaeuferquote) und der optionale Block 'wirksamkeit' mit 'fensterTage',
'nieBeanstandetAbAusfuehrungen', 'kandidatenMax' (Vorgabe ${VORGABE_KANDIDATEN_MAX}),
'quoteSchwelle' (Vorgabe ${VORGABE_QUOTE_SCHWELLE}) und 'quoteAbPaketen' (Vorgabe
${VORGABE_QUOTE_AB_PAKETEN}). Fehlt der Block oder ein Feld darin, gelten die Vorgaben.
`;

class WirksamkeitError extends Error {}

function fail(nachricht) {
  throw new WirksamkeitError(nachricht);
}

/** Eine Zahl oder `null` — dieselbe Regel wie `zahl` in kit/aufwand.mjs. */
function zahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt. Bewusst
 * **nicht** `localeCompare` — dessen Reihenfolge haengt an der Locale der Maschine,
 * und zwei Laeufe muessen ueberall dieselbe Liste ergeben.
 *
 * SYNC: dieselbe Funktion steckt in kit/checks.mjs, kit/befunde.mjs und kit/night.mjs
 * (#440: eigenstaendige Single-File-Tools, geteilte Logik wird dupliziert und markiert).
 */
function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// --- Config ------------------------------------------------------------------

/**
 * Der Block `wirksamkeit` aus der Config, gegen die Vorgaben aufgefuellt, dazu die
 * `cmd`-Werte der heutigen buildChecks.
 *
 * Eine fehlende oder kaputte Config ist hier KEIN Abbruch — dieselbe Haltung wie in
 * kit/aufwand.mjs: Es steht nichts auf dem Spiel als die Abweichung von den Vorgaben,
 * und die Auswertung soll auch in einem halb eingerichteten Projekt lesbar bleiben.
 * Was ausfiel, steht im Bericht.
 */
function ladeEinstellungen(root) {
  const pfad = join(root, CLAUDE_DIR, CONFIG_DATEI);
  const vorgabe = {
    fensterTage: VORGABE_FENSTER_TAGE,
    nieBeanstandetAb: VORGABE_NIE_BEANSTANDET_AB,
    kandidatenMax: VORGABE_KANDIDATEN_MAX,
    quoteSchwelle: VORGABE_QUOTE_SCHWELLE,
    quoteAbPaketen: VORGABE_QUOTE_AB_PAKETEN,
    spalten: SPALTEN_VORGABE,
    issueTracker: null,
    buildCmds: [],
    abschlussAusgelassen: [],
    configGelesen: null,
  };
  if (!existsSync(pfad)) return vorgabe;
  let config;
  try {
    config = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (err) {
    return { ...vorgabe, configGelesen: `nicht lesbar (${err.message})` };
  }
  const { buildCmds, abschlussAusgelassen } = pruefungenAusConfig(config);
  const block = config?.wirksamkeit && typeof config.wirksamkeit === "object" ? config.wirksamkeit : {};
  return {
    fensterTage: ganzzahl(block.fensterTage) ?? VORGABE_FENSTER_TAGE,
    nieBeanstandetAb: ganzzahl(block.nieBeanstandetAbAusfuehrungen) ?? VORGABE_NIE_BEANSTANDET_AB,
    kandidatenMax: ganzzahl(block.kandidatenMax) ?? VORGABE_KANDIDATEN_MAX,
    quoteSchwelle: bruchzahl(block.quoteSchwelle) ?? VORGABE_QUOTE_SCHWELLE,
    quoteAbPaketen: ganzzahl(block.quoteAbPaketen) ?? VORGABE_QUOTE_AB_PAKETEN,
    spalten: config?.columns && typeof config.columns === "object" ? config.columns : SPALTEN_VORGABE,
    issueTracker: typeof config?.issueTracker === "string" ? config.issueTracker : null,
    buildCmds,
    abschlussAusgelassen,
    configGelesen: null,
  };
}

/**
 * Die Pruefungen aus der Config in den zwei Formen, die dieses Werkzeug braucht: die
 * Kommandos der vorgeschriebenen Pruefungen (E3) und die, die der Abschluss einer Karte
 * auslaesst (Issue #946) — ihre Dauer ist der Aufschlag des Vergleichswerts (E8).
 *
 * Die drei Formen eines buildChecks-Eintrags (String, { cmd, areas }, { cmd, ... })
 * interessieren hier nur als Kommando und als `nichtBeimAbschluss`. Ohne Stufenfilter —
 * checks.mjs weist eine Config ab, die `nichtBeimAbschluss` mit `push` oder `merge`
 * paart, und ein zweiter Filter hier waere eine zweite Wahrheit ueber dieselbe Regel.
 */
function pruefungenAusConfig(config) {
  const buildCmds = [];
  const abschlussAusgelassen = [];
  for (const eintrag of Array.isArray(config?.buildChecks) ? config.buildChecks : []) {
    const objekt = typeof eintrag === "string" ? { cmd: eintrag } : eintrag;
    const cmd = objekt?.cmd;
    if (typeof cmd !== "string" || cmd.length === 0) continue;
    buildCmds.push(cmd);
    const grund = objekt.nichtBeimAbschluss;
    if (typeof grund === "string" && grund.length > 0) abschlussAusgelassen.push({ cmd, grund });
  }
  return { buildCmds, abschlussAusgelassen };
}

/** Eine ganze Zahl groesser null oder `null` — ein unbrauchbarer Wert faellt auf die Vorgabe zurueck. */
function ganzzahl(wert) {
  return Number.isInteger(wert) && wert > 0 ? wert : null;
}

/** Eine endliche Zahl groesser null oder `null` — die Quoten-Schwelle darf gebrochen sein. */
function bruchzahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) && wert > 0 ? wert : null;
}

// --- Protokoll lesen ---------------------------------------------------------

/**
 * Wandelt die Maskierung aus `kommandoMaskieren` (kit/checks.mjs) zurueck: `\t`, `\n`,
 * `\r` und `\\` werden wieder Tabulator, Zeilenumbruch, Wagenruecklauf und Backslash.
 *
 * Von links nach rechts und in EINEM Durchgang — nacheinander ausgefuehrte
 * Ersetzungen laesen ein maskiertes `\\n` (ein echter Backslash, gefolgt von einem n)
 * als Zeilenumbruch.
 *
 * Ein Backslash vor einem anderen Zeichen bleibt stehen, samt Zeichen: Genau daran
 * liest sich eine alte Zeile aus der Zeit vor der Maskierung unveraendert.
 */
function kommandoLesen(feld) {
  let text = "";
  for (let i = 0; i < feld.length; i += 1) {
    const ersatz = feld[i] === "\\" ? MASKIERUNGEN.get(feld[i + 1]) : undefined;
    if (ersatz === undefined) {
      text += feld[i];
      continue;
    }
    text += ersatz;
    i += 1;
  }
  return text;
}

/**
 * Liest `.claude/ausfuehrungen.tsv` und parst jede Zeile: Zeitpunkt, Kommando,
 * Ergebnis, Dauer — durch Tabs getrennt, wie `ausfuehrungSchreiben` in kit/checks.mjs
 * sie anhaengt. Das Kommando steht dort maskiert und wird zurueckgewandelt.
 *
 * Vier Spalten sind das MINDESTE, nicht die genaue Zahl (Issue #948): Dahinter stehen
 * Anlass, Laufkennung und Karte, und weitere koennen folgen. Eine Zeile mit den hinteren
 * Spalten ist keine fehlerhafte Zeile — als solche gezaehlt saehe jedes neue Protokoll
 * kaputt aus.
 *
 * FEHLT eine der hinteren Spalten oder ist sie leer, steht `unbekannt` (Issue #951) —
 * fuer alle drei derselbe Wert: Eine Zeile aus der Zeit vor Issue #948 traegt keinen
 * Anlass, und ein Lauf ohne `--abschluss <nummer>` keine Karte. Eine Vorgabe wie
 * `paket` an dieser Stelle waere geraten und ginge als gemessene Groesse in eine
 * Kennzahl ein; `unbekannt` faellt aus jeder Kennzahl heraus, die eine Karte braucht.
 *
 * Eine unlesbare oder fehlerhafte Zeile wird uebersprungen und GEZAEHLT, nicht zum
 * Abbruch: Das Protokoll waechst ueber Monate, und eine halbe Zeile am Dateiende darf
 * keine Auswertung kosten. Dass sie gezaehlt wird, steht im Bericht — sonst saehe ein
 * kaputtes Protokoll aus wie ein duennes.
 */
function protokollLesen(root) {
  const pfad = join(root, CLAUDE_DIR, AUSFUEHRUNGEN_DATEI);
  if (!existsSync(pfad)) return { vorhanden: false, zeilen: [], fehlerhaft: 0 };
  let inhalt;
  try {
    inhalt = readFileSync(pfad, "utf-8");
  } catch {
    return { vorhanden: false, zeilen: [], fehlerhaft: 0 };
  }
  const zeilen = [];
  let fehlerhaft = 0;
  for (const roh of inhalt.split("\n")) {
    if (roh === "") continue;
    const teile = roh.split("\t");
    const zeitMs = Date.parse(teile[0]);
    const dauerMs = teile.length >= 4 ? Number(teile[3]) : Number.NaN;
    if (teile.length < 4 || Number.isNaN(zeitMs) || !ERGEBNISSE.has(teile[2]) || !Number.isFinite(dauerMs)) {
      fehlerhaft += 1;
      continue;
    }
    zeilen.push({
      zeitMs,
      tag: teile[0].slice(0, 10),
      cmd: kommandoLesen(teile[1]),
      ergebnis: teile[2],
      dauerMs,
      anlass: herkunftsfeld(teile[4]),
      lauf: herkunftsfeld(teile[5]),
      karte: herkunftsfeld(teile[6]),
    });
  }
  return { vorhanden: true, zeilen, fehlerhaft };
}

/** Eine der hinteren Protokollspalten — fehlend oder leer heisst `unbekannt`. */
function herkunftsfeld(feld) {
  return typeof feld === "string" && feld !== "" ? feld : UNBEKANNT;
}

// --- Aggregation -------------------------------------------------------------

/**
 * Das Fenster (E2): `jetzt − fensterTage`, nach vorne abgeschnitten am
 * Erhebungsbeginn — dem fruehesten Zeitstempel im Protokoll, auch wenn er ausserhalb
 * des Fensters liegt. Das Protokoll traegt seinen eigenen Anfang; eine Konstante im
 * Werkzeug oder ein Config-Feld waere eine zweite Wahrheit darueber.
 *
 * NACH HINTEN begrenzt `jetzt` das Fenster (Issue #822): Eine Zeile aus der Zukunft —
 * eine falsch gehende Uhr genuegt als Ausloeser — zaehlt weder als Ausfuehrung noch
 * bildet sie den Erhebungsbeginn; sie ist eine fehlerhafte Zeile wie jede andere, die
 * sich nicht deuten laesst. Ohne diese Grenze stuende im Bericht `von 2099, bis heute`.
 *
 * Das Minimum entsteht in einer SCHLEIFE und nicht per `Math.min(...zeilen)`: Der
 * Spread legt jede Zeile als eigenes Argument auf den Aufrufstapel, und ab etwa
 * 150.000 Zeilen endet die Auswertung mit `RangeError`. Das Protokoll wird nie geleert.
 */
function fensterBestimmen(zeilen, fensterTage, jetztMs) {
  const roh = jetztMs - fensterTage * TAG_MS;
  let erhebungsbeginn = null;
  let zukunft = 0;
  for (const z of zeilen) {
    if (z.zeitMs > jetztMs) {
      zukunft += 1;
      continue;
    }
    if (erhebungsbeginn === null || z.zeitMs < erhebungsbeginn) erhebungsbeginn = z.zeitMs;
  }
  const abgeschnitten = erhebungsbeginn !== null && erhebungsbeginn > roh;
  return {
    tage: fensterTage,
    von: new Date(abgeschnitten ? erhebungsbeginn : roh).toISOString(),
    bis: new Date(jetztMs).toISOString(),
    erhebungsbeginn: erhebungsbeginn === null ? null : new Date(erhebungsbeginn).toISOString(),
    abgeschnitten,
    // Die Grenze fuer die Auswahl bleibt die rohe: Vor dem Erhebungsbeginn liegt
    // ohnehin keine Zeile, und so haengt die Auswahl nicht an der Abschneide-Frage.
    grenzeMs: roh,
    obergrenzeMs: jetztMs,
    zukunft,
  };
}

/** Liegt ein Zeitpunkt im Fenster? Beide Grenzen zaehlen mit. */
function imFenster(zeitMs, fenster) {
  return zeitMs >= fenster.grenzeMs && zeitMs <= fenster.obergrenzeMs;
}

/**
 * Die Zeilenbilanz eines Protokolls fuer den Bericht: gueltige und fehlerhafte Zeilen.
 * Eine Zeile aus der Zukunft steht bei den fehlerhaften und nicht bei den gueltigen —
 * zusammen ergeben beide Zahlen weiter die Zahl der Zeilen in der Datei.
 */
function zeilenbilanz(protokoll, fenster) {
  return {
    zeilen: protokoll.zeilen.length - fenster.zukunft,
    fehlerhafteZeilen: protokoll.fehlerhaft + fenster.zukunft,
  };
}

/**
 * Aggregiert je Pruefkommando ueber die Zeilen im Fenster. Die Menge der Pruefungen
 * ist die VEREINIGUNG aus den `cmd`-Werten der heutigen buildChecks und allen
 * Kommandos mit einer Protokollzeile im Fenster (E3): Eine im Fenster entfernte
 * Pruefung faellt damit nicht aus der Zeitbilanz, eine vorgeschriebene ohne jede
 * Ausfuehrung erscheint als "nicht gelaufen".
 *
 * `dauerMs` bleibt ohne Ausfuehrung `null` und heisst "nicht gemessen" — nie 0. Eine
 * 0 behauptete, es sei nichts verbraucht worden, und saehe aus wie gemessen (dieselbe
 * Regel wie in kit/aufwand.mjs).
 */
function aggregieren(zeilen, buildCmds, fenster) {
  const jeCmd = new Map();
  for (const cmd of buildCmds) {
    jeCmd.set(cmd, { cmd, vorgeschrieben: true, ausfuehrungen: 0, beanstandungen: 0, dauerMs: null, tage: new Set() });
  }
  for (const z of zeilen) {
    if (!imFenster(z.zeitMs, fenster)) continue;
    const p = jeCmd.get(z.cmd)
      ?? { cmd: z.cmd, vorgeschrieben: false, ausfuehrungen: 0, beanstandungen: 0, dauerMs: null, tage: new Set() };
    p.ausfuehrungen += 1;
    if (z.ergebnis === "rot") p.beanstandungen += 1;
    p.dauerMs = (p.dauerMs ?? 0) + z.dauerMs;
    p.tage.add(z.tag);
    jeCmd.set(z.cmd, p);
  }

  // Absteigend nach Ausfuehrungen, gleiche Zahl entscheidet der Name — damit die
  // Reihenfolge ueberall dieselbe ist und die meistgefahrene Pruefung oben steht.
  return [...jeCmd.values()]
    .map((p) => ({
      cmd: p.cmd,
      zustand: zustandVon(p),
      vorgeschrieben: p.vorgeschrieben,
      ausfuehrungen: p.ausfuehrungen,
      beanstandungen: p.beanstandungen,
      dauerMs: p.dauerMs,
      lauftage: p.tage.size,
    }))
    .sort((a, b) => b.ausfuehrungen - a.ausfuehrungen || vergleicheText(a.cmd, b.cmd));
}

/** Der Zustand einer Pruefung — genau einer der drei, "nicht gelaufen" zuerst geprueft. */
function zustandVon(p) {
  if (p.ausfuehrungen === 0) return "nicht gelaufen";
  return p.beanstandungen > 0 ? "beanstandet" : "nie beanstandet";
}

/**
 * Der Befund: eine Pruefung, die oft genug lief und dabei NIE etwas beanstandet hat.
 * "Nicht gelaufen" loest nie aus — sie hat nichts bewiesen. Die Schwelle schuetzt vor
 * der Momentaufnahme: Unterhalb von `nieBeanstandetAb` Ausfuehrungen ist "nichts
 * gefunden" keine Aussage ueber die Pruefung.
 */
function befundBestimmen(pruefungen, nieBeanstandetAb) {
  const befund = [];
  for (const p of pruefungen) {
    if (p.zustand !== "nie beanstandet" || p.ausfuehrungen < nieBeanstandetAb) continue;
    befund.push({
      schwelle: "nieBeanstandet",
      cmd: p.cmd,
      text: `Die Pruefung '${p.cmd}' lief ${ausfuehrungsText(p.ausfuehrungen)} (${lauftagText(p.lauftage)}, `
        + `${dauer(p.dauerMs)}) und hat dabei kein einziges Mal etwas beanstandet.`,
    });
  }
  return befund;
}

// --- Mittlere Pruefzeit je Karte (Issue #951, Plan #944, E8) -----------------

/**
 * Die mittlere Pruefzeit je Karte und ihr Vergleichswert.
 *
 * DIE EINHEIT IST DIE KARTE, nicht der Lauf: Der Fachplan begruendet die Zahl mit
 * "zwischen zwei und sechzehn Mal je Karte" — die Wiederholung gehoert in den Zaehler,
 * nicht aus ihm heraus. Eine Karte, die dreimal abgeschlossen wurde, traegt die Summe
 * ihrer drei Laeufe und zaehlt einmal im Nenner.
 *
 * GEZAEHLT wird allein der Abschlusslauf (`anlass` = `abschluss`) mit Kartennummer.
 * Eine Zeile ohne Nummer geht nicht ein, und ohne eine einzige steht `null` —
 * ausdruecklich NICHT ein Mittel je Lauf, das eine andere Groesse waere und sich
 * daneben wie derselbe Wert laese.
 *
 * DER VERGLEICHSWERT entsteht aus DENSELBEN Laeufen desselben Fensters: gemessene Zeit
 * plus die mittlere Dauer jeder beim Abschluss ausgelassenen Pruefung aus den
 * Veroeffentlichungslaeufen. Ein einmal vor der Umstellung gemessener Wert waere nach
 * der ersten Aenderung an einem Pruefkommando falsch. Lief eine ausgelassene Pruefung
 * im Fenster nie, bleibt der Vergleichswert `null` — ein Wert ohne ihren Aufschlag
 * waere zu klein und saehe dennoch aus wie gemessen (dieselbe Regel wie ueberall hier).
 */
function abschlusszeitErmitteln(zeilen, fenster, ausgelassenChecks) {
  const jeKarte = new Map();
  const laeufe = new Set();
  const dauern = new Map(ausgelassenChecks.map((c) => [c.cmd, { summe: 0, ausfuehrungen: 0 }]));

  for (const z of zeilen) {
    if (!imFenster(z.zeitMs, fenster)) continue;
    if (z.anlass === ANLASS_ABSCHLUSS) {
      if (z.karte === UNBEKANNT) continue;
      jeKarte.set(z.karte, (jeKarte.get(z.karte) ?? 0) + z.dauerMs);
      laeufe.add(`${z.karte}\t${z.lauf}`);
      continue;
    }
    const gesammelt = ANLAESSE_VEROEFFENTLICHUNG.has(z.anlass) ? dauern.get(z.cmd) : undefined;
    if (gesammelt === undefined) continue;
    gesammelt.summe += z.dauerMs;
    gesammelt.ausfuehrungen += 1;
  }

  const ausgelassen = ausgelassenChecks.map(({ cmd, grund }) => {
    const { summe, ausfuehrungen } = dauern.get(cmd);
    return { cmd, grund, ausfuehrungen, mittelMs: ausfuehrungen > 0 ? summe / ausfuehrungen : null };
  });
  const karten = jeKarte.size;
  const gemessenMs = karten > 0 ? [...jeKarte.values()].reduce((summe, ms) => summe + ms, 0) : null;
  const mittelMs = karten > 0 ? gemessenMs / karten : null;
  const fehlendeDauer = ausgelassen.some((a) => a.mittelMs === null);

  return {
    karten,
    laeufe: laeufe.size,
    gemessenMs,
    mittelMs,
    vergleichMs: mittelMs === null || fehlendeDauer
      ? null
      : ausgelassen.reduce((summe, a) => summe + a.mittelMs, mittelMs),
    ausgelassen,
  };
}

// --- Ruecklaeuferquote (Issue #788) ------------------------------------------

/**
 * Liest `.claude/bewegungen.tsv`: Zeitpunkt, Kartennummer, Status — durch Tabs
 * getrennt, wie `bewegungSchreiben` in kit/board.mjs sie anhaengt. Der Status wird
 * hier nicht gebraucht: Das Protokoll ist nur der KANDIDATENFILTER (E5), die
 * Wahrheit ueber Eintritte und Ruecklaeufe kommt aus dem Aktivitaetsverlauf.
 *
 * Fehlerhafte Zeilen werden uebersprungen und gezaehlt, wie beim
 * Ausfuehrungsprotokoll — eine halbe Zeile darf keine Auswertung kosten.
 */
function bewegungenLesen(root) {
  const pfad = join(root, CLAUDE_DIR, BEWEGUNGEN_DATEI);
  if (!existsSync(pfad)) return { vorhanden: false, zeilen: [], fehlerhaft: 0 };
  let inhalt;
  try {
    inhalt = readFileSync(pfad, "utf-8");
  } catch {
    return { vorhanden: false, zeilen: [], fehlerhaft: 0 };
  }
  const zeilen = [];
  let fehlerhaft = 0;
  for (const roh of inhalt.split("\n")) {
    if (roh === "") continue;
    const teile = roh.split("\t");
    const zeitMs = Date.parse(teile[0]);
    if (teile.length !== 3 || Number.isNaN(zeitMs) || teile[1] === "") {
      fehlerhaft += 1;
      continue;
    }
    zeilen.push({ zeitMs, id: teile[1] });
  }
  return { vorhanden: true, zeilen, fehlerhaft };
}

/**
 * Die Zuordnung Anzeigename -> Statusschluessel, ohne Ruecksicht auf Gross- und
 * Kleinschreibung (E6): Der Verlauf traegt den Anzeigenamen der Zielspalte, und der
 * weicht projektweise vom Schluessel ab (am Board dieser Instanz etwa "Anstehend"
 * fuer backlog).
 */
function spaltenZuordnung(spalten) {
  const map = new Map();
  for (const [schluessel, name] of Object.entries(spalten)) {
    if (typeof name === "string" && name !== "") map.set(name.toLowerCase(), schluessel);
  }
  return map;
}

/** Das Ziel einer Verlaufsbewegung als Statusschluessel, oder `null` fuer "nicht zuordenbar". */
function zielVon(detail, zuordnung) {
  if (typeof detail !== "string" || !detail.startsWith(VERSCHOBEN_PRAEFIX)) return null;
  return zuordnung.get(detail.slice(VERSCHOBEN_PRAEFIX.length).trim().toLowerCase()) ?? null;
}

/**
 * Der Aktivitaetsverlauf aller Kandidaten ueber genau EINEN Kindprozess (E13):
 * `issue activity --ids` holt die Kartenliste des Boards einmal statt je Karte —
 * gegen eine API, die drosselt. Ein Fehlschlag ist ein VERMERK, kein Abbruch (E9) —
 * auf dem Spiel steht eine Kennzahl, nicht ein Gate.
 */
function verlaeufeHolen(root, ids) {
  const res = spawnSync(
    process.execPath,
    [join(root, ...BOARD_KOMMANDO), "issue", "activity", "--ids", ids.join(",")],
    { cwd: root, encoding: "utf-8" }
  );
  if (res.status !== 0) {
    const grund = (res.stderr || "").trim() || `der Adapter endete mit ${res.status ?? res.error?.message ?? "?"}`;
    return { fehler: grund };
  }
  try {
    return { verlaeufe: JSON.parse(res.stdout) };
  } catch (err) {
    return { fehler: `der Adapter lieferte kein JSON (${err.message})` };
  }
}

/**
 * Die Ruecklaeuferquote (E5): Kandidaten aus dem Bewegungsprotokoll, Wahrheit aus
 * dem Verlauf. Ein Ruecklaeufer ist jedes Verlassen von "In review" in ein anderes
 * Ziel als "Done" — auch in ein nicht zuordenbares: Wo die Karte hinging, ist fuer
 * die Frage "kam sie aus dem Review zurueck?" zweitrangig.
 *
 * Drei Endzustaende, streng getrennt: `berechnet` (mindestens ein Eintritt im
 * Fenster), `nichtBerechenbar` (kein zuordenbarer Eintritt — die Quote ist dann
 * NICHT null, E7) und `entfallen` (der Tracker fuehrt keinen Verlauf oder der
 * Board-Aufruf schlug fehl — mit Grund, E15/E9).
 */
function ruecklaufErmitteln(root, einstellungen, fensterTage, jetztMs) {
  const protokoll = bewegungenLesen(root);
  const fenster = fensterBestimmen(protokoll.zeilen, fensterTage, jetztMs);
  const basis = {
    protokoll: { vorhanden: protokoll.vorhanden, ...zeilenbilanz(protokoll, fenster) },
    erhebungsbeginn: fenster.erhebungsbeginn,
    abgeschnitten: fenster.abgeschnitten,
    quote: null,
    zaehler: 0,
    nenner: 0,
    nichtZuordenbareBewegungen: 0,
    fehlerKarten: 0,
    kandidaten: { imFenster: 0, gewertet: 0, weggefallen: 0 },
    grund: null,
  };

  // Der Tracker `local` fuehrt keinen Verlauf: `listActivity` liefert genau einen
  // synthetischen CREATED-Eintrag und nie ein MOVED (E15). Ohne diesen Vermerk liefe
  // er formal durch und wiese die Quote auf ewig als "nicht berechenbar" aus, ohne
  // den Grund zu nennen — deshalb entfaellt sie hier ausdruecklich, ohne Kindprozess.
  if (einstellungen.issueTracker === "local") {
    return {
      ...basis,
      status: "entfallen",
      grund: "der Tracker 'local' fuehrt keinen Verlauf (nur ein synthetischer CREATED-Eintrag, nie eine Bewegung)",
    };
  }

  const gewertet = kandidatenBestimmen(protokoll.zeilen, fenster, einstellungen.kandidatenMax);
  basis.kandidaten = gewertet.kandidaten;
  if (gewertet.ids.length === 0) return { ...basis, status: "nichtBerechenbar" };

  const geholt = verlaeufeHolen(root, gewertet.ids);
  if (geholt.fehler) {
    return { ...basis, status: "entfallen", grund: `der Verlaufs-Aufruf des Boards schlug fehl: ${geholt.fehler}` };
  }

  const gezaehlt = kartenZaehlen(geholt.verlaeufe, gewertet.ids, einstellungen.spalten, fenster);
  return {
    ...basis,
    ...gezaehlt,
    status: gezaehlt.nenner > 0 ? "berechnet" : "nichtBerechenbar",
    quote: gezaehlt.nenner > 0 ? gezaehlt.zaehler / gezaehlt.nenner : null,
  };
}

/**
 * Die Kandidaten (E5): jede Kartennummer mit mindestens einer Zeile im Fenster,
 * gedeckelt (E14) auf hoechstens `kandidatenMax` Karten, die juengsten Eintritte
 * zuerst. Was wegfaellt, steht im Bericht und in der Traglast — nie stilles
 * Abschneiden.
 */
function kandidatenBestimmen(zeilen, fenster, kandidatenMax) {
  const juengste = new Map();
  for (const z of zeilen) {
    if (!imFenster(z.zeitMs, fenster)) continue;
    juengste.set(z.id, Math.max(juengste.get(z.id) ?? 0, z.zeitMs));
  }
  const sortiert = [...juengste.entries()].sort((a, b) => b[1] - a[1] || vergleicheText(a[0], b[0]));
  const ids = sortiert.slice(0, kandidatenMax).map(([id]) => id);
  return {
    ids,
    kandidaten: { imFenster: sortiert.length, gewertet: ids.length, weggefallen: sortiert.length - ids.length },
  };
}

/**
 * Zaehlt Nenner (Karten mit Eintritt nach "In review" im Fenster), Zaehler
 * (Ruecklaufbewegungen im Fenster), nicht zuordenbare Bewegungen und Karten ohne
 * Verlauf. Eine Nummer mit Fehlereintrag der Sammelform kostet einen Kandidaten,
 * nicht die Auswertung — sie wird gezaehlt und im Bericht genannt.
 */
function kartenZaehlen(verlaeufe, ids, spalten, fenster) {
  const zuordnung = spaltenZuordnung(spalten);
  const summe = { zaehler: 0, nenner: 0, nichtZuordenbareBewegungen: 0, fehlerKarten: 0 };
  for (const id of ids) {
    const verlauf = verlaeufe[id];
    if (!Array.isArray(verlauf)) {
      summe.fehlerKarten += 1;
      continue;
    }
    const karte = karteZaehlen(verlauf, zuordnung, fenster);
    summe.zaehler += karte.ruecklaeufe;
    summe.nichtZuordenbareBewegungen += karte.nichtZuordenbar;
    if (karte.eintritt) summe.nenner += 1;
  }
  return summe;
}

/**
 * Die Zaehlung EINER Karte. Der Zustand VOR einer Bewegung ist das Ziel der
 * vorigen — auch einer vor dem Fenster: Ein Eintritt von letzter Woche macht den
 * Ruecklauf von heute erst erkennbar. Gezaehlt (Eintritt wie Ruecklauf) wird nur,
 * was im Fenster liegt; genau deshalb kann die Quote ueber 100 % liegen.
 */
function karteZaehlen(verlauf, zuordnung, fenster) {
  const karte = { ruecklaeufe: 0, eintritt: false, nichtZuordenbar: 0 };
  let zustand = null;
  for (const b of kartenBewegungen(verlauf, zuordnung)) {
    if (imFenster(b.zeitMs, fenster)) {
      if (b.ziel === null) karte.nichtZuordenbar += 1;
      if (zustand === "in_review" && b.ziel !== "in_review" && b.ziel !== "done") karte.ruecklaeufe += 1;
      if (b.ziel === "in_review") karte.eintritt = true;
    }
    zustand = b.ziel;
  }
  return karte;
}

/** Die MOVED-Eintraege eines Verlaufs als {zeitMs, ziel}, zeitlich aufsteigend. */
function kartenBewegungen(verlauf, zuordnung) {
  return verlauf
    .filter((e) => e?.type === "MOVED" && typeof e.createdAt === "string" && !Number.isNaN(Date.parse(e.createdAt)))
    .map((e) => ({ zeitMs: Date.parse(e.createdAt), ziel: zielVon(e.detail, zuordnung) }))
    .sort((a, b) => a.zeitMs - b.zeitMs);
}

/**
 * Der Befund der Quote: ab `quoteSchwelle` bei mindestens `quoteAbPaketen` Karten.
 * Unterhalb der Kartenzahl ist die Quote eine Momentaufnahme, kein Befund — dieselbe
 * Schutzlogik wie die Ausfuehrungs-Schwelle bei "nie beanstandet".
 */
function ruecklaufBefund(r, einstellungen) {
  if (r.status !== "berechnet") return [];
  if (r.nenner < einstellungen.quoteAbPaketen || r.quote < einstellungen.quoteSchwelle) return [];
  return [{
    schwelle: "ruecklaufquote",
    text: `Von ${r.nenner} Karten, die im Fenster nach 'In review' kamen, gingen ${r.zaehler} Bewegungen `
      + `zurueck in die Arbeit — Ruecklaeuferquote ${prozent(r.quote)}.`,
  }];
}

// --- Textformen --------------------------------------------------------------

/**
 * Deutsche Zahlform: Komma als Dezimaltrenner, Punkt als Tausendertrenner. Von Hand
 * und NICHT ueber `toLocaleString`: Dessen Ergebnis haengt an der Locale der Maschine.
 *
 * SYNC: dieselben Textformen (`zahlform`, `dauer`) stehen in kit/aufwand.mjs (#440).
 */
// Nur eine reine Ziffernfolge wird gruppiert. `toFixed` liefert bei nicht endlichen
// Zahlen 'Infinity' und 'NaN'; der alte Ausdruck fand dort keine Stelle und liess den
// Text stehen, und 'Inf.ini.ty' waere eine neue, falsche Ausgabe. Der Anker macht den
// Ausdruck selbst linear: `^` ohne m-Flag laesst genau eine Startposition zu.
const NUR_ZIFFERN = /^\d+$/;

/**
 * Eine Ziffernfolge mit Punkten als Tausendertrenner.
 *
 * Gezaehlt statt gesucht (Issue #877): Im alten `\B(?=(\d{3})+$)` probierte die Engine an
 * JEDER Position jede Aufteilung des Rests in Dreiergruppen durch — 32.000 Ziffern
 * brauchten so 390 ms. Von hinten in Dreierschritten zu schneiden kostet einen Durchlauf.
 *
 * SYNC: dieselbe Funktion steht in kit/aufwand.mjs (#440).
 */
export function tausenderPunkte(ziffern) {
  if (!NUR_ZIFFERN.test(ziffern)) return ziffern;
  const gruppen = [];
  for (let ende = ziffern.length; ende > 0; ende -= 3) {
    gruppen.unshift(ziffern.slice(Math.max(0, ende - 3), ende));
  }
  return gruppen.join(".");
}

export function zahlform(wert, stellen) {
  const fest = wert.toFixed(stellen);
  const [ganz, bruch] = fest.split(".");
  const vorzeichen = ganz.startsWith("-") ? "-" : "";
  const ziffern = vorzeichen ? ganz.slice(1) : ganz;
  const gruppiert = tausenderPunkte(ziffern);
  return bruch ? `${vorzeichen}${gruppiert},${bruch}` : `${vorzeichen}${gruppiert}`;
}

/**
 * Eine Quote als Prozentzahl — ganzzahlig ohne, sonst mit einer Nachkommastelle.
 * Nie gekappt: 200 % ist eine wahre Aussage ueber zwei Ruecklaeufe je Karte.
 */
function prozent(quote) {
  const p = quote * 100;
  return `${zahlform(p, Number.isInteger(p) ? 0 : 1)} %`;
}

/** Eine Dauer in Millisekunden als lesbare Spanne; `null` sagt "nicht gemessen". */
function dauer(ms) {
  if (ms === null) return "nicht gemessen";
  if (ms < 1000) return `${zahlform(ms, 0)} ms`;
  const sekunden = Math.round(ms / 1000);
  if (sekunden < 60) return `${sekunden} s`;
  const minuten = Math.floor(sekunden / 60);
  if (minuten < 60) return `${minuten} min ${sekunden % 60} s`;
  return `${zahlform(Math.floor(minuten / 60), 0)} h ${minuten % 60} min`;
}

/**
 * Die Traglast in Worten — und bei genau einer Ausfuehrung bzw. einem Lauftag
 * ausdruecklich, dass es einer ist (AK 7): Eine Aussage aus einem einzigen Lauf ist
 * keine Tendenz, wie `laufText` in kit/aufwand.mjs es sagt.
 */
function ausfuehrungsText(n) {
  if (n === 0) return "kein einziges Mal";
  return n === 1 ? "ein einziges Mal" : `${n}-mal`;
}

/** Eine Zahl mit ihrem Wort — Einzahl bei genau einem, sonst die genannte Mehrzahl. */
function anzahlText(n, einzahl, mehrzahl) {
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}

function lauftagText(n) {
  if (n === 0) return "an keinem Lauftag";
  return n === 1 ? "an einem einzigen Lauftag" : `an ${n} Lauftagen`;
}

/** Der Zustand einer Pruefung, wie er in der Tabelle steht. */
function zustandText(p) {
  if (p.zustand === "nicht gelaufen") return "nicht gelaufen";
  return p.zustand === "beanstandet" ? "ausgefuehrt, mit Beanstandungen" : "ausgefuehrt, nie beanstandet";
}

/**
 * Der Bericht fuer Menschen, nach jedem Aufruf neu geschrieben. Die Befunde stehen in
 * Worten und ohne Handlungsempfehlung; was zu tun ist, entscheidet ein Mensch.
 */
export function berichtText(e) {
  return [
    ...berichtKopf(e),
    ...berichtPruefungen(e),
    ...berichtAbschlusszeit(e),
    ...berichtRuecklauf(e),
    ...berichtBefund(e),
    // Die Messgrenze aus E17 steht in JEDEM Bericht, auch im Leerfall: Wer die Datei
    // liest, soll wissen, was sie systematisch nicht sieht.
    "## Messgrenze", "",
    "Die Salvage-Pruefungen des Nacht-Runners laufen an checks.mjs vorbei und sind hier nicht erfasst.",
    "",
    ...berichtFuss(e),
  ].join("\n");
}

function berichtKopf(e) {
  const zeilen = [
    "# Wirksamkeit der Pruefungen", "",
    `Auswertung vom ${e.erzeugtAm}.`,
    `Fenster: ${e.fenster.tage} Tage, von ${e.fenster.von} bis ${e.fenster.bis}.`,
  ];
  if (e.fenster.abgeschnitten) {
    zeilen.push(
      `Das Ausfuehrungsprotokoll beginnt erst am ${e.fenster.erhebungsbeginn} — die Zahlen tragen `
      + "nur den Zeitraum seit diesem Anfang, nicht das volle Fenster."
    );
  }
  zeilen.push("");
  if (!e.protokoll.vorhanden) {
    zeilen.push(
      `Es liegt kein Ausfuehrungsprotokoll vor (${CLAUDE_DIR}/${AUSFUEHRUNGEN_DATEI} fehlt) — `
      + "keine Pruefung traegt eine gemessene Ausfuehrung.",
      ""
    );
  }
  return zeilen;
}

function berichtPruefungen(e) {
  if (e.pruefungen.length === 0) {
    return ["## Pruefungen", "", "Keine einzige Pruefung im Fenster — weder eine vorgeschriebene noch eine protokollierte.", ""];
  }
  const zeilen = [
    "## Pruefungen", "",
    "| Kommando | Zustand | Ausfuehrungen | Beanstandungen | Dauer | Lauftage |",
    "| --- | --- | --- | --- | --- | --- |",
    ...e.pruefungen.map((p) =>
      `| \`${p.cmd}\` | ${zustandText(p)} | ${p.ausfuehrungen} | ${p.beanstandungen} | ${dauer(p.dauerMs)} | ${p.lauftage} |`),
    "",
  ];
  // Die Traglast in Worten (AK 7): Eine Zeile aus einem einzigen Lauftag ist eine
  // Momentaufnahme — das steht ausdruecklich da, nicht nur als 1 in einer Spalte.
  for (const p of e.pruefungen.filter((p) => p.ausfuehrungen > 0 && p.lauftage === 1)) {
    zeilen.push(`Die Zeile zu \`${p.cmd}\` stammt aus einem einzigen Lauftag — eine Momentaufnahme, keine Tendenz.`);
  }
  // Eine im Fenster entfernte Pruefung bleibt in der Zeitbilanz (E3) und wird benannt:
  // Ihre Zahlen sagen sonst nichts darueber, warum sie kuenftig fehlen werden.
  for (const p of e.pruefungen.filter((p) => !p.vorgeschrieben)) {
    zeilen.push(`Die Pruefung \`${p.cmd}\` steht nicht (mehr) in den buildChecks; ihre Zahlen stammen aus dem Fenster.`);
  }
  if (zeilen.at(-1) !== "") zeilen.push("");
  return zeilen;
}

/**
 * Der Abschnitt zur mittleren Pruefzeit je Karte (Issue #951, AK 6): beide Werte
 * NEBENEINANDER, dazu die Traglast — die Zahl der tragenden Karten und ihrer
 * Abschlusslaeufe — und die Messgrenze. Ohne die Messgrenze laese sich die Zahl als
 * gesamte Pruefzeit einer Karte; sie ist die Zeit ihrer Abschlusslaeufe.
 */
function berichtAbschlusszeit(e) {
  const a = e.abschlusszeit;
  const zeilen = ["## Mittlere Pruefzeit je Karte", ""];
  if (a.karten === 0) {
    zeilen.push(
      "Keine Abschlusszeile mit Kartennummer im Fenster — die mittlere Pruefzeit je Karte ist nicht gemessen. "
      + "Ein Mittel je Lauf steht hier ausdruecklich nicht: Das waere eine andere Groesse.",
    );
  } else {
    const karten = anzahlText(a.karten, "Karte", "Karten");
    const laeufe = anzahlText(a.laeufe, "Abschlusslauf", "Abschlusslaeufen");
    zeilen.push(
      `Gemessen ${dauer(a.mittelMs)} je Karte, zum Vergleich ohne die Auslassungen des Abschlusses `
      + `${dauer(a.vergleichMs)} — getragen von ${karten} und ${laeufe}.`,
    );
  }
  zeilen.push(...abschlusszeitVermerke(a), "");
  // Die Messgrenze der Zahl (AK 6): Sie steht in JEDEM Fall da, auch im Leerfall.
  zeilen.push(
    "Messgrenze dieser Zahl: Nur Abschlusslaeufe zaehlen — Pruefzeiten waehrend der Arbeit und beim "
    + "Veroeffentlichen zaehlen nicht mit.",
    "",
  );
  return zeilen;
}

/** Die Vermerke zur Traglast des Vergleichswerts: je ausgelassener Pruefung eine Zeile. */
function abschlusszeitVermerke(a) {
  if (a.ausgelassen.length === 0) {
    return ["Keine Pruefung traegt 'nichtBeimAbschluss' — der Vergleichswert ist die gemessene Zeit."];
  }
  return a.ausgelassen.map((p) => (p.mittelMs === null
    ? `Die beim Abschluss ausgelassene Pruefung \`${p.cmd}\` (${p.grund}) lief im Fenster nie beim `
      + "Veroeffentlichen — ihre Dauer ist nicht gemessen, und darum bleibt der Vergleichswert offen."
    : `Die beim Abschluss ausgelassene Pruefung \`${p.cmd}\` (${p.grund}) kostete beim Veroeffentlichen `
      + `im Mittel ${dauer(p.mittelMs)} (${ausfuehrungsText(p.ausfuehrungen)} gelaufen).`));
}

/**
 * Der Abschnitt zur Ruecklaeuferquote. Bei `entfallen` steht dort NUR der Vermerk
 * mit dem Grund — die Pruefungs-Kennzahlen daneben bleiben vollstaendig (E15). In
 * jedem anderen Fall nennt er neben der Quote (oder ihrer Nichtberechenbarkeit, E7)
 * die Traglast: nicht zuordenbare Bewegungen, Deckel-Wegfaelle, den Erhebungsbeginn
 * des Bewegungsprotokolls und die Restluecke aus Fund 6.
 */
function berichtRuecklauf(e) {
  const r = e.ruecklauf;
  if (r.status === "entfallen") {
    return [
      "## Ruecklaeuferquote", "",
      `Die Ruecklaeuferquote entfaellt: ${r.grund}. Die Pruefungs-Kennzahlen oben bleiben davon unberuehrt.`,
      "",
    ];
  }
  return [
    "## Ruecklaeuferquote", "",
    ruecklaufKernsatz(r),
    `Nicht zuordenbare Bewegungen im Fenster: ${r.nichtZuordenbareBewegungen}.`,
    ...ruecklaufVermerke(r, e.schwellen),
    "Restluecke: Karten, die das Kit nie bewegt hat, stehen nicht im Nenner — eine von Hand am Board "
    + "nach 'In review' gezogene Karte fehlt in Zaehler und Nenner.",
    "",
  ];
}

/** Die erste Aussage des Quote-Abschnitts: die Quote selbst oder ihr Nicht-Berechenbar-Grund. */
function ruecklaufKernsatz(r) {
  if (r.status !== "berechnet") {
    return r.kandidaten.gewertet === 0
      ? "Im Fenster traegt keine Karte eine Kit-Bewegung — die Quote ist nicht berechenbar."
      : "Kein Eintritt nach 'In review' ist im Fenster zuordenbar — die Quote ist nicht berechenbar, nicht null.";
  }
  const karten = `${r.nenner} ${r.nenner === 1 ? "Karte" : "Karten"}`;
  const kam = r.nenner === 1 ? "kam" : "kamen";
  const bewegungen = r.zaehler === 1 ? "ging 1 Bewegung" : `gingen ${r.zaehler} Bewegungen`;
  return `Von ${karten}, die im Fenster nach 'In review' ${kam}, ${bewegungen} zurueck in die Arbeit — `
    + `Ruecklaeuferquote ${prozent(r.quote)}.`;
}

/** Die Traglast-Vermerke der Quote — nur die Zeilen, deren Anlass eingetreten ist. */
function ruecklaufVermerke(r, schwellen) {
  const zeilen = [];
  if (r.kandidaten.weggefallen > 0) {
    zeilen.push(
      `Der Deckel von ${schwellen.kandidatenMax} Karten griff: `
      + `${r.kandidaten.weggefallen} ${r.kandidaten.weggefallen === 1 ? "Karte ist" : "Karten sind"} weggefallen — `
      + `gewertet wurden die ${r.kandidaten.gewertet} juengsten.`
    );
  }
  if (r.abgeschnitten) {
    zeilen.push(
      `Das Bewegungsprotokoll beginnt erst am ${r.erhebungsbeginn} — die Quote traegt nur den Zeitraum seit diesem Anfang.`
    );
  }
  if (r.fehlerKarten > 0) {
    zeilen.push(
      `${r.fehlerKarten} ${r.fehlerKarten === 1 ? "Karte lieferte" : "Karten lieferten"} keinen Verlauf `
      + "(Fehlereintrag des Boards) und fehlen in der Zaehlung."
    );
  }
  if (r.protokoll.fehlerhafteZeilen > 0) {
    zeilen.push(`${r.protokoll.fehlerhafteZeilen} Zeilen des Bewegungsprotokolls waren unlesbar und wurden uebersprungen.`);
  }
  return zeilen;
}

function berichtBefund(e) {
  const zeilen = ["## Befund", ""];
  if (e.befund.length === 0) zeilen.push("Keine Pruefung liegt ueber der Schwelle.", "");
  else zeilen.push(...e.befund.map((b) => `- ${b.text}`), "");
  zeilen.push(
    `Schwellen dieses Laufs: nie beanstandet ab ${e.schwellen.nieBeanstandetAbAusfuehrungen} Ausfuehrungen, `
    + `Ruecklaeuferquote ab ${prozent(e.schwellen.quoteSchwelle)} bei mindestens ${e.schwellen.quoteAbPaketen} Karten, `
    + `Fenster ${e.schwellen.fensterTage} Tage. Eine nicht gelaufene Pruefung loest nie einen Befund aus.`,
    ""
  );
  return zeilen;
}

function berichtFuss(e) {
  const zeilen = [];
  if (e.protokoll.fehlerhafteZeilen > 0) {
    zeilen.push(
      `${e.protokoll.fehlerhafteZeilen} Protokollzeilen waren unlesbar oder fehlerhaft und wurden uebersprungen.`,
      ""
    );
  }
  if (e.configGelesen) zeilen.push(`Hinweis zur Konfiguration: ${e.configGelesen} — es gelten die Vorgaben.`, "");
  return zeilen;
}

/**
 * Der Befundblock als Text — mit Datum der Auswertung und Fenster in der Kopfzeile.
 *
 * Ohne Befund eine LEERE Zeichenkette, nicht eine mit Kopfzeile: Die Kopfzeile allein
 * waere schon der beruhigende Satz, den das Schweigen bei Unauffaelligkeit
 * ausschliesst (dieselbe Zusage wie `befundText` in kit/aufwand.mjs).
 */
export function befundText(stand) {
  const befund = Array.isArray(stand?.befund) ? stand.befund : [];
  if (befund.length === 0) return "";
  const kopf = `Auswertung vom ${stand.erzeugtAm}, Fenster ${stand.fenster?.tage ?? "?"} Tage seit ${stand.fenster?.von ?? "?"}.`;
  return [kopf, ...befund.map((b) => `- ${b.text}`)].join("\n") + "\n";
}

// --- Kommandos ---------------------------------------------------------------

function schreibeDatei(pfad, inhalt) {
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, inhalt, "utf-8");
  } catch (err) {
    fail(`${pfad} konnte nicht geschrieben werden: ${err.message}`);
  }
}

/**
 * Die Auswertung. Rueckgabe ist der vollstaendige Stand — dieselbe Struktur, die nach
 * `.claude/wirksamkeit.json` geht und auf stdout steht: eine Form, nicht zwei.
 */
export function auswerten(root, { fenster: fensterArg } = {}) {
  const einstellungen = ladeEinstellungen(root);
  const fensterTage = fensterArg ?? einstellungen.fensterTage;
  const jetztMs = Date.now();
  const protokoll = protokollLesen(root);
  const fenster = fensterBestimmen(protokoll.zeilen, fensterTage, jetztMs);
  const pruefungen = aggregieren(protokoll.zeilen, einstellungen.buildCmds, fenster);
  const abschlusszeit = abschlusszeitErmitteln(protokoll.zeilen, fenster, einstellungen.abschlussAusgelassen);
  const ruecklauf = ruecklaufErmitteln(root, einstellungen, fensterTage, jetztMs);
  const befund = [
    ...befundBestimmen(pruefungen, einstellungen.nieBeanstandetAb),
    ...ruecklaufBefund(ruecklauf, einstellungen),
  ];

  const ergebnis = {
    erzeugtAm: new Date(jetztMs).toISOString(),
    kitVersion: KIT_VERSION,
    fenster: {
      tage: fenster.tage,
      von: fenster.von,
      bis: fenster.bis,
      erhebungsbeginn: fenster.erhebungsbeginn,
      abgeschnitten: fenster.abgeschnitten,
    },
    protokoll: {
      vorhanden: protokoll.vorhanden,
      ...zeilenbilanz(protokoll, fenster),
    },
    pruefungen,
    abschlusszeit,
    ruecklauf,
    schwellen: {
      fensterTage,
      nieBeanstandetAbAusfuehrungen: einstellungen.nieBeanstandetAb,
      kandidatenMax: einstellungen.kandidatenMax,
      quoteSchwelle: einstellungen.quoteSchwelle,
      quoteAbPaketen: einstellungen.quoteAbPaketen,
    },
    // Immer gesetzt, auch leer: Eine neuere Auswertung ohne Befund loescht damit den
    // alten Stand — ein ausgelassenes Feld liesse den Befund von gestern stehen.
    befund,
    configGelesen: einstellungen.configGelesen,
  };

  schreibeDatei(join(root, CLAUDE_DIR, BERICHT_DATEI), berichtText(ergebnis));
  schreibeDatei(join(root, CLAUDE_DIR, STAND_DATEI), JSON.stringify(ergebnis, null, 2) + "\n");
  return ergebnis;
}

/**
 * Der Befund als Text. Nie ein Fehler: Eine fehlende, leere oder unlesbare Datei ist
 * dasselbe wie kein Befund — es soll dann nichts dastehen und nichts aufgehalten
 * werden.
 */
export function befund(root) {
  const pfad = join(root, CLAUDE_DIR, STAND_DATEI);
  try {
    return befundText(JSON.parse(readFileSync(pfad, "utf-8")));
  } catch {
    return "";
  }
}

// --- CLI ---------------------------------------------------------------------

function parseAuswertenArgs(rest) {
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] !== "--fenster") fail(`Unbekanntes Argument: '${rest[i]}'`);
    const wert = Number(rest[i + 1]);
    if (!Number.isInteger(wert) || wert <= 0) {
      fail(`--fenster erwartet eine ganze Zahl groesser null, bekam '${rest[i + 1] ?? ""}'.`);
    }
    args.fenster = wert;
    i += 1;
  }
  return args;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === "--version") {
    process.stdout.write(`${KIT_VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === "auswerten") {
    // Immer JSON auf stdout, auch wenn der Aufruf abgewiesen wird: Die Ausgabe dieses
    // Kommandos wird maschinell gelesen. Ein Fliesstext-Fehler mittendrin machte aus
    // jedem Fehlerfall einen Parse-Fehler beim Aufrufer (wie in kit/aufwand.mjs).
    try {
      process.stdout.write(JSON.stringify(auswerten(process.cwd(), parseAuswertenArgs(rest)), null, 2) + "\n");
      return 0;
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, fehler: err.message }, null, 2) + "\n");
      return 1;
    }
  }
  if (command === "befund") {
    // Hier gilt das Gegenteil: Was auf stdout steht, reicht ein Skill unveraendert
    // weiter. Ein abgewiesener Aufruf schreibt deshalb nach stderr und laesst stdout
    // leer — sonst stuende eine Fehlermeldung dort, wo ein Befund hingehoert.
    if (rest.length > 0) fail(`'befund' nimmt keine Argumente, bekam '${rest[0]}'.`);
    process.stdout.write(befund(process.cwd()));
    return 0;
  }

  process.stdout.write(HELP);
  return fail(`Unbekannter Befehl: '${command}'. Erwartet: auswerten oder befund`);
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
    process.exitCode = main();
  } catch (err) {
    const prefix = err instanceof WirksamkeitError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
