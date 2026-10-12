#!/usr/bin/env node
/**
 * claude-workflow-kit Wirksamkeits-Auswertung (Issue #787, Plan #782, Fachliche Quelle #767)
 *
 * Macht aus dem Ausfuehrungsprotokoll der Pruefungen eine Aussage darueber, ob eine
 * Pruefung etwas taugt: `evaluate` liest `.claude/ausfuehrungen.tsv`, aggregiert je
 * Pruefkommando Ausfuehrungen, Beanstandungen und Dauer ueber ein Zeitfenster und
 * schreibt `.claude/wirksamkeit.md` (fuer Menschen) und `.claude/wirksamkeit.json`
 * (fuer die Ausgabestellen). `finding` gibt allein den Befundblock als Text aus.
 *
 * WARUM EIN EIGENES WERKZEUG UND KEIN ANBAU (Plan #782, E1): nach dem Muster von
 * kit/effort.mjs — die Pruefungs-Kennzahlen sind eine reine Leseoperation ueber
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
 * VIER ZUSTAENDE JE PRUEFUNG, streng getrennt: ausgefuehrt mit Beanstandungen,
 * ausgefuehrt und gewackelt, ausgefuehrt und nie beanstandet, nicht gelaufen. "Nicht
 * gelaufen" loest nie einen Befund aus und wird nie als "nie beanstandet" dargestellt —
 * eine Pruefung, die gar nicht lief, hat weder Wirksamkeit noch Wirkungslosigkeit
 * bewiesen. "Gewackelt" (Issue #1398) heisst: mindestens ein Wackler, keine Beanstandung —
 * eine Pruefung, die rot war, ist nie "nie beanstandet".
 *
 * WACKLER (Issue #1398, Plan #1395, E9): Die zwoelfte Protokollspalte markiert die beiden
 * Laeufe einer wiederholten Pruefung. Gepaart wird je Laufkennung und Pruefung in
 * Zeitfolge; Rot und Gruen ist ein Wackler und keine Beanstandung. Ab
 * REPARATUR_AB_WACKLERN im Fenster ist die Pruefung ein Reparaturkandidat; `candidates`
 * nennt sie aus dem letzten Stand, ohne neu zu rechnen.
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
 * BEREICHE (Issue #1005, Plan #1001): je Bereich Anteil, Laeufe und Minuten, dazu das
 * Inventar der Dateien ohne Bereich und die teuren unter ihnen. Den Zuschnitt rechnet
 * `checks.mjs bereiche` (zweiter Kindprozess, ebenfalls nur ein Vermerk, wenn er scheitert).
 *
 * NICHT-ZIEL: keine Handlungsempfehlung. Das Werkzeug sagt, was auffaellt, nicht was
 * zu tun ist — dieselbe Haltung wie in kit/effort.mjs.
 *
 * NUR ENGLISCHE NAMEN (Issue #1560, Plan #1548 E6-E8): Der Code steht in der englischen Datei,
 * die deutsche Datei entfaellt. Befehle und Optionen sind englisch; ein frueherer deutscher
 * Name endet mit Exit 1 und nennt den englischen. Die Hilfe ist englisch.
 *
 * Aufruf im Projekt-Root:  node .claude/kit/effectiveness.mjs evaluate [--window <tage>]
 *                          node .claude/kit/effectiveness.mjs finding
 *                          node .claude/kit/effectiveness.mjs candidates
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit liefert
 * seine Werkzeuge als eigenstaendig portable Einzeldateien aus.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Der Normalisierer der Einstellungsnamen aus dem Board-Teil config-namen (Issue #1436, Plan
// #1420 E10): Er bildet eine englisch benannte Config auf die deutschen Namen ab, die dieses
// Modul liest. Dynamisch und abgefangen, denn das Modul laeuft auch allein ohne den Board-Teil;
// fehlt er, bleibt die Config, wie sie gelesen wurde.
const { normalisiereConfig = (roh) => ({ config: roh, hinweise: [] }) } =
  await import(new URL("./board/config-namen.mjs", import.meta.url).href).catch(() => ({}));

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "4.2.4";

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

// Dasselbe fuer den Zuschnitt der Bereiche (Issue #1005, Plan #1001, E7): Anteil,
// Hervorhebung und Inventar rechnet `checks.mjs bereiche` — ueber dieselbe Zuordnung,
// die jede Auswahl trifft. Eine zweite Glob-Logik hier bescheinigte ab der ersten
// Abweichung eine Deckung, die die Auswahl nicht sieht.
const CHECKS_KOMMANDO = [".claude", "kit", "checks.mjs"];

// SYNC: PRUEFDAUER_OBERGRENZE_MS in kit/checks.mjs (Issue #1003, Plan #1001, E3, E4).
// Gezaehlt wird hier aus dem Protokoll, nicht aus `ueberObergrenzeMs`: Das steht nur in
// der Zusammenfassung, und die ueberschreibt jeder Lauf.
const PRUEFDAUER_OBERGRENZE_MS = 30_000;

// SYNC: `ausloeserBestimmen` in kit/checks.mjs setzt diese Arten (Issue #1004, E5). Jede
// Art ausser `bereiche` hat ihre Sonderzeile in der Bereichstabelle (E6) — ebenso eine
// Zeile ohne die Spalte, geschrieben vor der Erfassung. Die Werte sind die Schluessel ihrer
// Namen in `TEXTE`.
const AUSLOESER_BEREICHE = "bereiche";
const AUSLOESER_OHNE_ZUORDNUNG = "ohne-zuordnung";
const VOR_DER_ERFASSUNG = "sonderVorErfassung";
const SONDERZEILEN = new Map([
  ["ohne-bereich", "sonderOhneBereich"],
  [AUSLOESER_OHNE_ZUORDNUNG, "sonderOhneZuordnung"],
  ["veroeffentlichung", "sonderVeroeffentlichung"],
  ["anker", "sonderAnker"],
]);
// Eine Art, die dieses Werkzeug nicht kennt — ein neuerer Schreiber genuegt. Ihre Minuten
// stehen in einer eigenen Zeile, statt still aus der Tabelle zu fallen; die Zeile erscheint
// nur, wenn es sie gibt.
const AUSLOESER_UNBEKANNT = "sonderUnbekannt";

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

// Ab so vielen Wacklern im Fenster ist eine Pruefung ein Kandidat fuer eine Reparatur
// (Issue #1398, Plan #1395, E10). Bewusst kein Config-Feld: Der PO hat die Zahl festgelegt.
const REPARATUR_AB_WACKLERN = 3;

// SYNC: `ausfuehrungSchreiben` in kit/checks.mjs setzt diese Werte in die zwoelfte Spalte
// (Issue #1396, Plan #1395, E8): an den roten ersten Lauf und an seine Wiederholung.
const ERSTLAUF = "erstlauf";
const WIEDERHOLUNG = "wiederholung";

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

// SYNC: `listeMaskieren` in kit/checks.mjs (Issue #1004) maskiert in einer Listenspalte
// zusaetzlich das Komma, den Trenner der Eintraege.
const LISTEN_MASKIERUNGEN = new Map([...MASKIERUNGEN, [",", ","]]);

/**
 * Die Texte an Menschen in beiden Sprachen (Issue #1497, Plan #1420 E13): Bericht, Befund
 * (die Hilfe gibt es nur englisch, Issue #1560, Plan #1548 E7), Reparaturkandidaten, die Freitexte des Stands (`text`, `grund`, `vermerk`,
 * `configGelesen`, die Namen der Sonderzeilen) und die Fehler. Unuebersetzt bleibt der
 * Maschinenvertrag (E14): die Feldnamen von `wirksamkeit.json` und der JSON-Ausgabe, die
 * Zustandswerte einer Pruefung, die Schwellenschluessel und `VERSCHOBEN_PRAEFIX`. Den
 * Gleichstand der Schluessel und Platzhalter haelt test/befunde-texte-en.test.mjs.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    // Freitexte des Stands
    configNichtLesbar: "nicht lesbar ({grund})",
    befundNieBeanstandet: "Die Pruefung '{cmd}' lief {ausfuehrungen} ({lauftage}, {dauer}) und hat dabei kein einziges Mal etwas beanstandet.",
    befundQuote: "Von {nenner} Karten, die im Fenster nach 'In review' kamen, gingen {zaehler} Bewegungen zurueck in die Arbeit — Ruecklaeuferquote {quote}.",
    zuschnittEnde: "das Kommando endete mit {status}",
    zuschnittOhneListe: "die Ausgabe traegt keine Liste 'bereiche'",
    zuschnittKeinJson: "das Kommando lieferte kein JSON ({grund})",
    verlaufEnde: "der Adapter endete mit {status}",
    verlaufKeinJson: "der Adapter lieferte kein JSON ({grund})",
    quoteLocal: "der Tracker 'local' fuehrt keinen Verlauf (nur ein synthetischer CREATED-Eintrag, nie eine Bewegung)",
    quoteVerlaufFehl: "der Verlaufs-Aufruf des Boards schlug fehl: {grund}",
    sonderOhneBereich: "ohne Bereich",
    sonderOhneZuordnung: "voller Umfang wegen fehlender Zuordnung",
    sonderVeroeffentlichung: "Veroeffentlichung (push/merge)",
    sonderAnker: "Anker nicht aufloesbar",
    sonderVorErfassung: "vor der Erfassung",
    sonderUnbekannt: "Ausloeser unbekannt",
    // Zahlen und Worte
    tausender: ".",
    dezimal: ",",
    prozent: "{zahl} %",
    nichtGemessen: "nicht gemessen",
    ausfuehrungKeine: "kein einziges Mal",
    ausfuehrungEine: "ein einziges Mal",
    ausfuehrungMehrere: "{n}-mal",
    lauftagKeiner: "an keinem Lauftag",
    lauftagEiner: "an einem einzigen Lauftag",
    lauftagMehrere: "an {n} Lauftagen",
    karteEine: "{n} Karte",
    karteMehrere: "{n} Karten",
    abschlusslaufEiner: "{n} Abschlusslauf",
    abschlusslaufMehrere: "{n} Abschlusslaeufen",
    zustandNichtGelaufen: "nicht gelaufen",
    zustandGewackelt: "ausgefuehrt, gewackelt",
    zustandBeanstandet: "ausgefuehrt, mit Beanstandungen",
    zustandNieBeanstandet: "ausgefuehrt, nie beanstandet",
    ja: "ja",
    nein: "nein",
    jaKopplung: "ja — durch Kopplung erzwungen: {grund}",
    kandidatWackler: "{n} Wackler im Zeitfenster",
    kandidatZeile: "Reparaturkandidat: {cmd} — {kandidat}",
    // Bericht
    titel: "# Wirksamkeit der Pruefungen",
    am: "Auswertung vom {am}.",
    fenster: "Fenster: {tage} Tage, von {von} bis {bis}.",
    abgeschnitten: "Das Ausfuehrungsprotokoll beginnt erst am {beginn} — die Zahlen tragen nur den Zeitraum seit diesem Anfang, nicht das volle Fenster.",
    ohneProtokoll: "Es liegt kein Ausfuehrungsprotokoll vor ({pfad} fehlt) — keine Pruefung traegt eine gemessene Ausfuehrung.",
    pruefungenTitel: "## Pruefungen",
    pruefungenLeer: "Keine einzige Pruefung im Fenster — weder eine vorgeschriebene noch eine protokollierte.",
    pruefungenKopf: "| Kommando | Zustand | Ausfuehrungen | Beanstandungen | Wackler | Dauer | Lauftage |",
    reparatur: "Reparaturkandidat: `{cmd}` — {kandidat} (ab {ab}).",
    momentaufnahme: "Die Zeile zu `{cmd}` stammt aus einem einzigen Lauftag — eine Momentaufnahme, keine Tendenz.",
    nichtVorgeschrieben: "Die Pruefung `{cmd}` steht nicht (mehr) in den buildChecks; ihre Zahlen stammen aus dem Fenster.",
    abschlusszeitTitel: "## Mittlere Pruefzeit je Karte",
    abschlusszeitLeer: "Keine Abschlusszeile mit Kartennummer im Fenster — die mittlere Pruefzeit je Karte ist nicht gemessen. Ein Mittel je Lauf steht hier ausdruecklich nicht: Das waere eine andere Groesse.",
    abschlusszeit: "Gemessen {mittel} je Karte, zum Vergleich ohne die Auslassungen des Abschlusses {vergleich} — getragen von {karten} und {laeufe}.",
    abschlusszeitGrenze: "Messgrenze dieser Zahl: Nur Abschlusslaeufe zaehlen — Pruefzeiten waehrend der Arbeit und beim Veroeffentlichen zaehlen nicht mit.",
    ohneAuslassung: "Keine Pruefung traegt 'nichtBeimAbschluss' — der Vergleichswert ist die gemessene Zeit.",
    ausgelassenNie: "Die beim Abschluss ausgelassene Pruefung `{cmd}` ({grund}) lief im Fenster nie beim Veroeffentlichen — ihre Dauer ist nicht gemessen, und darum bleibt der Vergleichswert offen.",
    ausgelassen: "Die beim Abschluss ausgelassene Pruefung `{cmd}` ({grund}) kostete beim Veroeffentlichen im Mittel {dauer} ({ausfuehrungen} gelaufen).",
    bereicheTitel: "## Bereiche",
    ohneZuschnitt: "Der Zuschnitt aus `checks.mjs bereiche` fehlt: {vermerk}. Anteil, Hervorhebung und Inventar entfallen; Laeufe und Minuten stammen aus dem Protokoll.",
    bereicheKopf: "| Bereich | nennende Kommandos | hervorgehoben | Laeufe | Minuten |",
    bereicheSumme: "Die Summe der Zeilen uebersteigt die Gesamtzeit von {minuten} Minuten, weil eine Ausfuehrung fuer jeden ihrer Bereiche mit voller Dauer zaehlt. Uebernommene Ergebnisse schreiben keine Protokollzeile und zaehlen nicht.",
    inventarTitel: "### Inventar",
    inventarOhneTreffer: "{ohne} von {dateien} versionierten Dateien treffen kein Bereichsmuster.",
    inventarFreigestellt: "freigestellt (`ohnePruefung`, mit Grund): {n}",
    inventarOhneZuordnung: "ohne jede Zuordnung — loest den vollen Umfang aus: {n}",
    teuerTitel: "### Teure Dateien ohne Zuordnung",
    teuerLeer: "Im Fenster loeste keine unzugeordnete Datei den vollen Umfang aus.",
    teuerKopf: "| Datei | volle Laeufe | Minuten |",
    obergrenzeTitel: "### Abschlusslaeufe ueber {grenze}",
    obergrenzeLeer: "Keine Pruefung und kein Abschlusslauf im Fenster.",
    obergrenzeKopf: "| Kommando | Abschlusslaeufe | ueber {grenze} | davon gleichzeitig gemessen |",
    ruecklaufTitel: "## Ruecklaeuferquote",
    ruecklaufEntfallen: "Die Ruecklaeuferquote entfaellt: {grund}. Die Pruefungs-Kennzahlen oben bleiben davon unberuehrt.",
    nichtZuordenbar: "Nicht zuordenbare Bewegungen im Fenster: {n}.",
    restluecke: "Restluecke: Karten, die das Kit nie bewegt hat, stehen nicht im Nenner — eine von Hand am Board nach 'In review' gezogene Karte fehlt in Zaehler und Nenner.",
    kernOhneKarte: "Im Fenster traegt keine Karte eine Kit-Bewegung — die Quote ist nicht berechenbar.",
    kernOhneEintritt: "Kein Eintritt nach 'In review' ist im Fenster zuordenbar — die Quote ist nicht berechenbar, nicht null.",
    kern: "Von {karten}, die im Fenster nach 'In review' {kam}, {bewegungen} zurueck in die Arbeit — Ruecklaeuferquote {quote}.",
    kamEine: "kam",
    kamMehrere: "kamen",
    bewegungEine: "ging 1 Bewegung",
    bewegungMehrere: "gingen {n} Bewegungen",
    deckelEine: "Der Deckel von {max} Karten griff: {n} Karte ist weggefallen — gewertet wurden die {gewertet} juengsten.",
    deckelMehrere: "Der Deckel von {max} Karten griff: {n} Karten sind weggefallen — gewertet wurden die {gewertet} juengsten.",
    bewegungenAbgeschnitten: "Das Bewegungsprotokoll beginnt erst am {beginn} — die Quote traegt nur den Zeitraum seit diesem Anfang.",
    fehlerKarteEine: "{n} Karte lieferte keinen Verlauf (Fehlereintrag des Boards) und fehlen in der Zaehlung.",
    fehlerKartenMehrere: "{n} Karten lieferten keinen Verlauf (Fehlereintrag des Boards) und fehlen in der Zaehlung.",
    bewegungenUnlesbar: "{n} Zeilen des Bewegungsprotokolls waren unlesbar und wurden uebersprungen.",
    befundTitel: "## Befund",
    befundLeer: "Keine Pruefung liegt ueber der Schwelle.",
    schwellen: "Schwellen dieses Laufs: nie beanstandet ab {nie} Ausfuehrungen, Ruecklaeuferquote ab {quote} bei mindestens {ab} Karten, Fenster {tage} Tage. Eine nicht gelaufene Pruefung loest nie einen Befund aus.",
    messgrenzeTitel: "## Messgrenze",
    messgrenze: "Die Salvage-Pruefungen des Nacht-Runners laufen an checks.mjs vorbei und sind hier nicht erfasst.",
    protokollUnlesbar: "{n} Protokollzeilen waren unlesbar oder fehlerhaft und wurden uebersprungen.",
    configHinweis: "Hinweis zur Konfiguration: {grund} — es gelten die Vorgaben.",
    befundKopf: "Auswertung vom {am}, Fenster {tage} Tage seit {von}.",
    // Fehler
    nichtGeschrieben: "{pfad} konnte nicht geschrieben werden: {grund}",
    unbekanntesArgument: "Unbekanntes Argument: '{arg}'",
    fensterErwartet: "--window erwartet eine ganze Zahl groesser null, bekam '{wert}'.",
    befundOhneArgumente: "'finding' nimmt keine Argumente, bekam '{arg}'.",
    kandidatenOhneArgumente: "'candidates' nimmt keine Argumente, bekam '{arg}'.",
    unbekannterBefehl: "Unbekannter Befehl: '{befehl}'. Erwartet: evaluate, finding oder candidates",
    altname: "unbekannt: '{name}' — englischer Name: '{englisch}'",
    fehler: "Fehler",
    unerwarteterFehler: "Unerwarteter Fehler",
  }),
  en: Object.freeze({
    configNichtLesbar: "not readable ({grund})",
    befundNieBeanstandet: "The check '{cmd}' ran {ausfuehrungen} ({lauftage}, {dauer}) and did not flag anything a single time.",
    befundQuote: "Of {nenner} cards that came to 'In review' in the window, {zaehler} moves went back into work — return rate {quote}.",
    zuschnittEnde: "the command ended with {status}",
    zuschnittOhneListe: "the output carries no list 'bereiche'",
    zuschnittKeinJson: "the command returned no JSON ({grund})",
    verlaufEnde: "the adapter ended with {status}",
    verlaufKeinJson: "the adapter returned no JSON ({grund})",
    quoteLocal: "the tracker 'local' keeps no history (only a synthetic CREATED entry, never a move)",
    quoteVerlaufFehl: "the history call of the board failed: {grund}",
    sonderOhneBereich: "without area",
    sonderOhneZuordnung: "full scope due to missing assignment",
    sonderVeroeffentlichung: "Publishing (push/merge)",
    sonderAnker: "Anchor not resolvable",
    sonderVorErfassung: "before recording",
    sonderUnbekannt: "Trigger unknown",
    tausender: ",",
    dezimal: ".",
    prozent: "{zahl} %",
    nichtGemessen: "not measured",
    ausfuehrungKeine: "not a single time",
    ausfuehrungEine: "a single time",
    ausfuehrungMehrere: "{n} times",
    lauftagKeiner: "on no run day",
    lauftagEiner: "on a single run day",
    lauftagMehrere: "on {n} run days",
    karteEine: "{n} card",
    karteMehrere: "{n} cards",
    abschlusslaufEiner: "{n} completion run",
    abschlusslaufMehrere: "{n} completion runs",
    zustandNichtGelaufen: "not run",
    zustandGewackelt: "run, flaky",
    zustandBeanstandet: "run, with findings",
    zustandNieBeanstandet: "run, never flagged",
    ja: "yes",
    nein: "no",
    jaKopplung: "yes — forced by coupling: {grund}",
    kandidatWackler: "{n} flaky runs in the time window",
    kandidatZeile: "Repair candidate: {cmd} — {kandidat}",
    titel: "# Effectiveness of the checks",
    am: "Evaluation of {am}.",
    fenster: "Window: {tage} days, from {von} to {bis}.",
    abgeschnitten: "The execution log only begins on {beginn} — the figures cover only the period since that start, not the full window.",
    ohneProtokoll: "There is no execution log ({pfad} is missing) — no check carries a measured run.",
    pruefungenTitel: "## Checks",
    pruefungenLeer: "Not a single check in the window — neither a required nor a logged one.",
    pruefungenKopf: "| Command | State | Runs | Findings | Flaky | Duration | Run days |",
    reparatur: "Repair candidate: `{cmd}` — {kandidat} (from {ab}).",
    momentaufnahme: "The row for `{cmd}` comes from a single run day — a snapshot, not a trend.",
    nichtVorgeschrieben: "The check `{cmd}` is no longer in the buildChecks; its figures come from the window.",
    abschlusszeitTitel: "## Mean check time per card",
    abschlusszeitLeer: "No completion row with a card number in the window — the mean check time per card is not measured. A mean per run is deliberately not shown here: that would be a different quantity.",
    abschlusszeit: "Measured {mittel} per card, for comparison without the omissions at completion {vergleich} — based on {karten} and {laeufe}.",
    abschlusszeitGrenze: "Measurement limit of this figure: only completion runs count — check times during the work and when publishing do not count.",
    ohneAuslassung: "No check carries 'notAtCompletion' — the comparison value is the measured time.",
    ausgelassenNie: "The check `{cmd}` omitted at completion ({grund}) never ran when publishing in the window — its duration is not measured, so the comparison value stays open.",
    ausgelassen: "The check `{cmd}` omitted at completion ({grund}) took {dauer} on average when publishing (ran {ausfuehrungen}).",
    bereicheTitel: "## Areas",
    ohneZuschnitt: "The breakdown from `checks.mjs bereiche` is missing: {vermerk}. Share, highlighting and inventory are dropped; runs and minutes come from the log.",
    bereicheKopf: "| Area | naming commands | highlighted | Runs | Minutes |",
    bereicheSumme: "The sum of the rows exceeds the total time of {minuten} minutes, because a run counts with its full duration for each of its areas. Adopted results write no log row and do not count.",
    inventarTitel: "### Inventory",
    inventarOhneTreffer: "{ohne} of {dateien} versioned files match no area pattern.",
    inventarFreigestellt: "exempted (`noCheck`, with reason): {n}",
    inventarOhneZuordnung: "without any assignment — triggers the full scope: {n}",
    teuerTitel: "### Expensive files without assignment",
    teuerLeer: "In the window no unassigned file triggered the full scope.",
    teuerKopf: "| File | full runs | Minutes |",
    obergrenzeTitel: "### Completion runs over {grenze}",
    obergrenzeLeer: "No check and no completion run in the window.",
    obergrenzeKopf: "| Command | Completion runs | over {grenze} | of these measured concurrently |",
    ruecklaufTitel: "## Return rate",
    ruecklaufEntfallen: "The return rate does not apply: {grund}. The check figures above are unaffected.",
    nichtZuordenbar: "Moves in the window that cannot be assigned: {n}.",
    restluecke: "Remaining gap: cards the kit never moved are not in the denominator — a card dragged to 'In review' by hand on the board is missing from numerator and denominator.",
    kernOhneKarte: "In the window no card carries a kit move — the rate cannot be computed.",
    kernOhneEintritt: "No entry into 'In review' can be assigned in the window — the rate cannot be computed, it is not zero.",
    kern: "Of {karten} that {kam} to 'In review' in the window, {bewegungen} back into work — return rate {quote}.",
    kamEine: "came",
    kamMehrere: "came",
    bewegungEine: "1 move went",
    bewegungMehrere: "{n} moves went",
    deckelEine: "The cap of {max} cards applied: {n} card was dropped — the {gewertet} latest were evaluated.",
    deckelMehrere: "The cap of {max} cards applied: {n} cards were dropped — the {gewertet} latest were evaluated.",
    bewegungenAbgeschnitten: "The move log only begins on {beginn} — the rate covers only the period since that start.",
    fehlerKarteEine: "{n} card returned no history (error entry of the board) and is missing from the count.",
    fehlerKartenMehrere: "{n} cards returned no history (error entry of the board) and are missing from the count.",
    bewegungenUnlesbar: "{n} rows of the move log were unreadable and were skipped.",
    befundTitel: "## Findings",
    befundLeer: "No check is above the threshold.",
    schwellen: "Thresholds of this run: never flagged from {nie} runs, return rate from {quote} with at least {ab} cards, window {tage} days. A check that did not run never triggers a finding.",
    messgrenzeTitel: "## Measurement limit",
    messgrenze: "The salvage checks of the night runner bypass checks.mjs and are not recorded here.",
    protokollUnlesbar: "{n} log rows were unreadable or faulty and were skipped.",
    configHinweis: "Note on the configuration: {grund} — the defaults apply.",
    befundKopf: "Evaluation of {am}, window {tage} days since {von}.",
    nichtGeschrieben: "{pfad} could not be written: {grund}",
    unbekanntesArgument: "Unknown argument: '{arg}'",
    fensterErwartet: "--window expects a whole number greater than zero, got '{wert}'.",
    befundOhneArgumente: "'finding' takes no arguments, got '{arg}'.",
    kandidatenOhneArgumente: "'candidates' takes no arguments, got '{arg}'.",
    unbekannterBefehl: "Unknown command: '{befehl}'. Expected: evaluate, finding or candidates",
    altname: "unknown: '{name}' — English name: '{englisch}'",
    fehler: "Error",
    unerwarteterFehler: "Unexpected error",
  }),
});

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen wie der Normalisierer:
// Fehlt board/namen.mjs neben effectiveness.mjs, bleiben die Texte deutsch.
const namen = await import(new URL("./board/namen.mjs", import.meta.url).href).catch(() => null);

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

// Die Hilfe gibt es genau einmal, englisch, in jedem Projekt (Issue #1560, Plan #1548 E7).
function hilfe() {
  return `effectiveness.mjs (claude-workflow-kit v${KIT_VERSION}) — Effectiveness of the checks

  node effectiveness.mjs evaluate [--window <days>]
  node effectiveness.mjs finding
  node effectiveness.mjs candidates

evaluate   Reads ${CLAUDE_DIR}/${AUSFUEHRUNGEN_DATEI}, aggregates runs, findings and duration
           per check command over the time window, computes the mean check time
           per card from the completion runs together with a comparison value,
           counts runs and minutes per area (breakdown and inventory via
           checks.mjs areas), determines
           the return rate (candidates from ${CLAUDE_DIR}/${BEWEGUNGEN_DATEI},
           history via board.mjs issue activity) and writes
           ${CLAUDE_DIR}/${BERICHT_DATEI} and ${CLAUDE_DIR}/${STAND_DATEI}. The
           output on stdout is always JSON — also in the empty case and also for a
           rejected call. A failure of the board part is a note in the
           report, not an abort.
finding    Prints the findings block from ${CLAUDE_DIR}/${STAND_DATEI} as text, with the
           date of the evaluation and the window in the header line. If there are no
           findings, or the file is missing or unreadable, the output stays empty.
           Exit always 0 — the findings are not a gate.
candidates Prints one line 'Repair candidate: <cmd> — <n> flaky runs in the time
           window' per check that ${CLAUDE_DIR}/${STAND_DATEI} marks as a repair candidate
           (from ${REPARATUR_AB_WACKLERN} flaky runs in the window). Does not recompute;
           without candidates or without the file the output stays empty. Exit always 0.

  --window <days>   Length of the time window in days (default ${VORGABE_FENSTER_TAGE}).
                    Overrides the config block.
  --version         Kit revision of this file.
  --help, -h        This overview.

Reads ${CLAUDE_DIR}/${CONFIG_DATEI} in the working directory: 'buildChecks' (for
the set of required checks and their 'notAtCompletion' for the
comparison value of the check time per card), 'columns' and 'issueTracker' (for the
return rate) and the optional block 'effectiveness' with 'windowDays',
'neverFlaggedFromRuns', 'candidatesMax' (default ${VORGABE_KANDIDATEN_MAX}),
'rateThreshold' (default ${VORGABE_QUOTE_SCHWELLE}) and 'rateFromPackages' (default
${VORGABE_QUOTE_AB_PAKETEN}). If the block or a field in it is missing, the defaults apply.
`;
}

class WirksamkeitError extends Error {}

function fail(nachricht) {
  throw new WirksamkeitError(nachricht);
}

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt. Bewusst
 * **nicht** `localeCompare` — dessen Reihenfolge haengt an der Locale der Maschine,
 * und zwei Laeufe muessen ueberall dieselbe Liste ergeben.
 *
 * SYNC: dieselbe Funktion steckt in kit/checks.mjs, kit/findings.mjs und kit/night.mjs
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
 * kit/effort.mjs: Es steht nichts auf dem Spiel als die Abweichung von den Vorgaben,
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
    hinweisCmds: [],
    configGelesen: null,
  };
  if (!existsSync(pfad)) return vorgabe;
  let config;
  try {
    config = normalisiereConfig(JSON.parse(readFileSync(pfad, "utf-8"))).config;
  } catch (err) {
    return { ...vorgabe, configGelesen: t("configNichtLesbar", { grund: err.message }) };
  }
  const { buildCmds, abschlussAusgelassen, hinweisCmds } = pruefungenAusConfig(config);
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
    hinweisCmds,
    configGelesen: null,
  };
}

/**
 * Die Pruefungen aus der Config in den zwei Formen, die dieses Werkzeug braucht: die
 * Kommandos der vorgeschriebenen Pruefungen (E3) und die, die der Abschluss einer Karte
 * auslaesst (Issue #946) — ihre Dauer ist der Aufschlag des Vergleichswerts (E8).
 *
 * Die drei Formen eines buildChecks-Eintrags (String, { cmd, areas }, { cmd, ... })
 * interessieren hier nur als Kommando, als `nichtBeimAbschluss` und als `art`. Ohne Stufenfilter —
 * checks.mjs weist eine Config ab, die `nichtBeimAbschluss` mit `push` oder `merge`
 * paart, und ein zweiter Filter hier waere eine zweite Wahrheit ueber dieselbe Regel.
 */
function pruefungenAusConfig(config) {
  const buildCmds = [];
  const abschlussAusgelassen = [];
  const hinweisCmds = [];
  for (const eintrag of Array.isArray(config?.buildChecks) ? config.buildChecks : []) {
    const objekt = typeof eintrag === "string" ? { cmd: eintrag } : eintrag;
    const cmd = objekt?.cmd;
    if (typeof cmd !== "string" || cmd.length === 0) continue;
    // Ein Eintrag der Art `hinweis` endet in checks.mjs immer gruen (Issue #1155, Plan
    // #1150, E11): Er kann nicht beanstanden und ist darum keine Pflichtpruefung — weder
    // "nie beanstandet" noch "nicht gelaufen" sagte ueber ihn etwas aus.
    if (objekt.art === "hinweis") {
      hinweisCmds.push(cmd);
      continue;
    }
    buildCmds.push(cmd);
    const grund = objekt.nichtBeimAbschluss;
    if (typeof grund === "string" && grund.length > 0) abschlussAusgelassen.push({ cmd, grund });
  }
  return { buildCmds, abschlussAusgelassen, hinweisCmds };
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
  let i = 0;
  while (i < feld.length) {
    const ersatz = feld[i] === "\\" ? MASKIERUNGEN.get(feld[i + 1]) : undefined;
    if (ersatz === undefined) {
      text += feld[i];
      i += 1;
      continue;
    }
    text += ersatz;
    i += 2;  // Backslash und maskiertes Zeichen
  }
  return text;
}

/**
 * Wandelt eine Listenspalte aus `listeMaskieren` (kit/checks.mjs, Issue #1004) zurueck:
 * Ein unmaskiertes Komma trennt, `\,` ist ein Komma im Eintrag, sonst dieselben
 * Maskierungen wie beim Kommando — aus demselben Grund in EINEM Durchgang. Eine fehlende
 * oder leere Spalte ist die leere Liste.
 */
function listeLesen(feld) {
  if (typeof feld !== "string" || feld === "") return [];
  const eintraege = [];
  let text = "";
  let i = 0;
  while (i < feld.length) {
    const ersatz = feld[i] === "\\" ? LISTEN_MASKIERUNGEN.get(feld[i + 1]) : undefined;
    if (ersatz !== undefined) {
      text += ersatz;
      i += 2;  // Backslash und maskiertes Zeichen
      continue;
    }
    if (feld[i] === ",") {
      eintraege.push(text);
      text = "";
    } else {
      text += feld[i];
    }
    i += 1;
  }
  eintraege.push(text);
  return eintraege;
}

/**
 * Liest `.claude/ausfuehrungen.tsv` und parst jede Zeile: Zeitpunkt, Kommando,
 * Ergebnis, Dauer — durch Tabs getrennt, wie `ausfuehrungSchreiben` in kit/checks.mjs
 * sie anhaengt. Das Kommando steht dort maskiert und wird zurueckgewandelt.
 *
 * Vier Spalten sind das MINDESTE, nicht die genaue Zahl (Issue #948): Dahinter stehen
 * Anlass, Laufkennung und Karte, seit Issue #1004 noch Ausloeser, Bereiche und Dateien,
 * und weitere koennen folgen. Eine Zeile mit den hinteren
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
  return tabZeilenLesen(join(root, CLAUDE_DIR, AUSFUEHRUNGEN_DATEI), (teile) => {
    const zeitMs = Date.parse(teile[0]);
    const dauerMs = teile.length >= 4 ? Number(teile[3]) : Number.NaN;
    if (teile.length < 4 || Number.isNaN(zeitMs) || !ERGEBNISSE.has(teile[2]) || !Number.isFinite(dauerMs)) return null;
    return {
      zeitMs,
      tag: teile[0].slice(0, 10),
      cmd: kommandoLesen(teile[1]),
      ergebnis: teile[2],
      dauerMs,
      anlass: herkunftsfeld(teile[4]),
      lauf: herkunftsfeld(teile[5]),
      karte: herkunftsfeld(teile[6]),
      // Die drei Spalten aus Issue #1004 sind optional: Eine Zeile ohne sie bleibt
      // gueltig und steht in der Bereichstabelle "vor der Erfassung" (`null`).
      ausloeser: typeof teile[7] === "string" && teile[7] !== "" ? teile[7] : null,
      bereiche: listeLesen(teile[8]),
      dateien: listeLesen(teile[9]),
      // Die elfte Spalte aus Issue #1071: Ohne sie gilt die Dauer als nacheinander gemessen.
      gleichzeitig: teile[10] === "gleichzeitig",
      // Die zwoelfte Spalte aus Issue #1396: `erstlauf`, `wiederholung` oder `null` —
      // ohne sie zaehlt die Zeile wie vorher.
      wiederholung: teile[11] === ERSTLAUF || teile[11] === WIEDERHOLUNG ? teile[11] : null,
    };
  });
}

/**
 * Gemeinsamer Leser der beiden Tab-Protokolle (Issue #1095). Fehlt die Datei oder ist
 * sie unlesbar, heisst das `vorhanden: false`; eine leere Zeile wird uebersprungen.
 * `zeileAus(teile)` entscheidet je Aufrufer, was eine Zeile gueltig macht und welche
 * Felder entstehen — liefert sie `null`, zaehlt die Zeile als fehlerhaft.
 */
function tabZeilenLesen(pfad, zeileAus) {
  if (!existsSync(pfad)) return { vorhanden: false, zeilen: [], fehlerhaft: 0 };
  let inhalt;
  try {
    inhalt = readFileSync(pfad, "utf-8");
  } catch {
    return { vorhanden: false, zeilen: [], fehlerhaft: 0 };
  }
  const zeilen = [];
  let fehlerhaft = 0;
  for (const roh of inhalt.split(/\r?\n/)) {
    if (roh === "") continue;
    const zeile = zeileAus(roh.split("\t"));
    if (zeile) zeilen.push(zeile);
    else fehlerhaft += 1;
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
 * Ausfuehrung erscheint als "nicht gelaufen". Die Zeilen einer Hinweis-Pruefung
 * (`hinweisCmds`, Issue #1155) bleiben draussen: Sie ist immer gruen und stuende sonst
 * als "nie beanstandet" im Befund.
 *
 * `dauerMs` bleibt ohne Ausfuehrung `null` und heisst "nicht gemessen" — nie 0. Eine
 * 0 behauptete, es sei nichts verbraucht worden, und saehe aus wie gemessen (dieselbe
 * Regel wie in kit/effort.mjs).
 *
 * WACKLER (Issue #1398, E9): Ein gepaarter erster Lauf ist keine Beanstandung; seine
 * Wiederholung zaehlt gruen als Wackler, rot als Beanstandung. Beide Zeilen zaehlen als
 * Ausfuehrungen und mit ihrer Dauer. Ein erster Lauf ohne Partner zaehlt wie jede rote Zeile.
 */
function aggregieren(zeilen, buildCmds, fenster, hinweisCmds = []) {
  const hinweis = new Set(hinweisCmds);
  const { gepaarteErstlaeufe, gepaarteWiederholungen } = paaren(zeilen);
  const neu = (cmd, vorgeschrieben) =>
    ({ cmd, vorgeschrieben, ausfuehrungen: 0, beanstandungen: 0, wackler: 0, dauerMs: null, tage: new Set() });
  const jeCmd = new Map();
  for (const cmd of buildCmds) jeCmd.set(cmd, neu(cmd, true));
  for (const z of zeilen) {
    if (!imFenster(z.zeitMs, fenster) || hinweis.has(z.cmd)) continue;
    const p = jeCmd.get(z.cmd) ?? neu(z.cmd, false);
    p.ausfuehrungen += 1;
    if (gepaarteWiederholungen.has(z) && z.ergebnis === "gruen") p.wackler += 1;
    else if (z.ergebnis === "rot" && !gepaarteErstlaeufe.has(z)) p.beanstandungen += 1;
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
      wackler: p.wackler,
      reparaturkandidat: p.wackler >= REPARATUR_AB_WACKLERN,
      dauerMs: p.dauerMs,
      lauftage: p.tage.size,
    }))
    .sort((a, b) => b.ausfuehrungen - a.ausfuehrungen || vergleicheText(a.cmd, b.cmd));
}

/**
 * Die Paare aus erstem Lauf und Wiederholung (Issue #1398, Plan #1395, E9): je Laufkennung
 * und Kommando in Zeitfolge ein `erstlauf` mit der naechsten `wiederholung`. Teillauf und
 * voller Lauf derselben Laufkennung ergeben so getrennte Paare. Gepaart wird ueber das
 * ganze Protokoll und nicht nur das Fenster — ein Paar ueber die Fenstergrenze bleibt ein
 * Paar, gezaehlt wird jede Zeile nur, wenn sie selbst im Fenster liegt.
 *
 * Bei gleichem Zeitpunkt entscheidet die Reihenfolge in der Datei (stabile Sortierung):
 * `checks.mjs` schreibt den ersten Lauf vor seiner Wiederholung.
 */
function paaren(zeilen) {
  const gepaarteErstlaeufe = new Set();
  const gepaarteWiederholungen = new Set();
  const offen = new Map();
  const markiert = zeilen.filter((z) => z.wiederholung !== null).sort((a, b) => a.zeitMs - b.zeitMs);
  for (const z of markiert) {
    const schluessel = `${z.lauf}\t${z.cmd}`;
    if (z.wiederholung === ERSTLAUF) {
      offen.set(schluessel, z);
      continue;
    }
    const erster = offen.get(schluessel);
    if (erster === undefined) continue;
    offen.delete(schluessel);
    gepaarteErstlaeufe.add(erster);
    gepaarteWiederholungen.add(z);
  }
  return { gepaarteErstlaeufe, gepaarteWiederholungen };
}

/** Der Zustand einer Pruefung — genau einer der vier, "nicht gelaufen" zuerst geprueft. */
function zustandVon(p) {
  if (p.ausfuehrungen === 0) return "nicht gelaufen";
  if (p.beanstandungen > 0) return "beanstandet";
  return p.wackler > 0 ? "gewackelt" : "nie beanstandet";
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
      text: t("befundNieBeanstandet", {
        cmd: p.cmd, ausfuehrungen: ausfuehrungsText(p.ausfuehrungen), lauftage: lauftagText(p.lauftage), dauer: dauer(p.dauerMs),
      }),
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

// --- Bereiche (Issue #1005, Plan #1001, E4, E6, E7, E8, E14) -----------------

/**
 * Der Zuschnitt der Bereiche aus `checks.mjs bereiche` ueber genau EINEN Kindprozess, wie
 * der Verlauf beim Board (E7). Ein Fehlschlag ist ein VERMERK, kein Abbruch: Laeufe und
 * Minuten stehen im Protokoll und bleiben auch ohne ihn lesbar.
 *
 * `checks(args, { cwd })` startet das Kommando und liefert ein Ergebnis wie `spawnSync`;
 * die Vorgabe ist der Kindprozess, die Tests geben eine Attrappe (Issue #1213, Plan #1199 E6).
 */
function zuschnittHolen(root, checks) {
  const res = checks(["bereiche"], { cwd: root });
  if (res.status !== 0) {
    const grund = (res.stderr || "").trim() || t("zuschnittEnde", { status: res.status ?? res.error?.message ?? "?" });
    return { fehler: grund };
  }
  try {
    const zuschnitt = JSON.parse(res.stdout);
    if (!Array.isArray(zuschnitt?.bereiche)) return { fehler: t("zuschnittOhneListe") };
    return { zuschnitt };
  } catch (err) {
    return { fehler: t("zuschnittKeinJson", { grund: err.message }) };
  }
}

/**
 * Der Abschnitt "Bereiche": Tabelle, Sonderzeilen, Inventar, teure Dateien, Obergrenze.
 *
 * GEZAEHLT wird jede Protokollzeile im Fenster, alle Anlaesse, Wiederholungen
 * eingeschlossen (E6). Eine Ausfuehrung zaehlt fuer JEDEN ihrer Bereiche mit voller Dauer
 * — die Frage je Bereich ist "wie viel Pruefzeit hat er ausgeloest", und die Antwort
 * teilt sich nicht. Darum uebersteigt die Summe der Bereichszeilen die Gesamtzeit, und
 * der Bericht sagt das. Jede andere Ausloeserart steht in ihrer Sonderzeile, eine Zeile
 * ohne die Spalte "vor der Erfassung" — so faellt keine Minute aus der Tabelle.
 *
 * TEURE DATEIEN (E8): Je unzugeordneter Datei die Zahl der vollen LAEUFE, die sie
 * ausgeloest hat (ein Lauf faehrt mehrere Kommandos und schreibt je eines eine Zeile),
 * und die Minuten aller dieser Zeilen.
 *
 * DIE OBERGRENZE (E4) zaehlt je Kommando die Abschlusszeilen ueber 30 s — auch alte
 * siebenspaltige: Der Anlass steht dort schon, und nur er entscheidet. Davon vermerkt sie,
 * wie viele gleichzeitig gemessen wurden (Issue #1073); eine Zeile ohne die Spalte
 * `gleichzeitig` gilt als nacheinander gemessen.
 */
function bereicheErmitteln(zeilen, fenster, buildCmds, geholt) {
  const jeBereich = new Map();
  const sonder = new Map([...SONDERZEILEN.values(), VOR_DER_ERFASSUNG].map((schluessel) => [schluessel, { name: t(schluessel), laeufe: 0, dauerMs: 0 }]));
  const teuer = new Map();
  const obergrenze = new Map(buildCmds.map((cmd) => [cmd, { cmd, abschlusslaeufe: 0, ueber: 0, ueberGleichzeitig: 0 }]));
  let gesamtDauerMs = 0;

  for (const z of zeilen) {
    if (!imFenster(z.zeitMs, fenster)) continue;
    gesamtDauerMs += z.dauerMs;
    ausloeserZaehlen(z, jeBereich, sonder);
    teuerZaehlen(z, teuer);
    obergrenzeZaehlen(z, obergrenze);
  }

  const zuschnitt = geholt.zuschnitt ?? null;
  return {
    vermerk: geholt.fehler ?? null,
    kommandos: zuschnitt?.kommandos ?? null,
    tabelle: bereichsTabelle(zuschnitt, jeBereich),
    sonderzeilen: [...sonder.values()],
    gesamtDauerMs,
    inventar: zuschnitt?.inventar ?? null,
    teureDateien: [...teuer.entries()]
      .map(([pfad, t]) => ({ pfad, volleLaeufe: t.laeufe.size, dauerMs: t.dauerMs }))
      .sort((a, b) => b.dauerMs - a.dauerMs || vergleicheText(a.pfad, b.pfad)),
    obergrenze: {
      grenzeMs: PRUEFDAUER_OBERGRENZE_MS,
      kommandos: [...obergrenze.values()]
        .sort((a, b) => b.ueber - a.ueber || b.abschlusslaeufe - a.abschlusslaeufe || vergleicheText(a.cmd, b.cmd)),
    },
  };
}

/** Der Eintrag unter `schluessel`, beim ersten Zugriff aus `neu()` angelegt. */
function eintragVon(map, schluessel, neu) {
  if (!map.has(schluessel)) map.set(schluessel, neu());
  return map.get(schluessel);
}

/** Laeufe und Minuten einer Zeile: bei jedem ihrer Bereiche oder in ihrer Sonderzeile (E6). */
function ausloeserZaehlen(z, jeBereich, sonder) {
  const ziele = z.ausloeser === AUSLOESER_BEREICHE
    ? z.bereiche.map((name) => eintragVon(jeBereich, name, () => ({ laeufe: 0, dauerMs: 0 })))
    : [eintragVon(sonder, sonderzeileVon(z.ausloeser), () => ({ name: t(sonderzeileVon(z.ausloeser)), laeufe: 0, dauerMs: 0 }))];
  for (const ziel of ziele) {
    ziel.laeufe += 1;
    ziel.dauerMs += z.dauerMs;
  }
}

/** Der Textschluessel der Sonderzeile einer Ausloeserart — `null` heisst: vor der Erfassung geschrieben. */
function sonderzeileVon(ausloeser) {
  if (ausloeser === null) return VOR_DER_ERFASSUNG;
  return SONDERZEILEN.get(ausloeser) ?? AUSLOESER_UNBEKANNT;
}

/** Die teuren Dateien (E8): je unzugeordneter Datei ihre vollen Laeufe und deren Dauer. */
function teuerZaehlen(z, teuer) {
  if (z.ausloeser !== AUSLOESER_OHNE_ZUORDNUNG) return;
  // Ohne Laufkennung steht der Zeitpunkt fuer den Lauf — eine Zeile, ein Lauf.
  const kennung = z.lauf === UNBEKANNT ? String(z.zeitMs) : z.lauf;
  for (const pfad of z.dateien) {
    const t = eintragVon(teuer, pfad, () => ({ laeufe: new Set(), dauerMs: 0 }));
    t.laeufe.add(kennung);
    t.dauerMs += z.dauerMs;
  }
}

/** Die Obergrenze (E4): je Kommando seine Abschlusszeilen und die ueber der Grenze. */
function obergrenzeZaehlen(z, obergrenze) {
  if (z.anlass !== ANLASS_ABSCHLUSS) return;
  const o = eintragVon(obergrenze, z.cmd, () => ({ cmd: z.cmd, abschlusslaeufe: 0, ueber: 0, ueberGleichzeitig: 0 }));
  o.abschlusslaeufe += 1;
  if (z.dauerMs <= PRUEFDAUER_OBERGRENZE_MS) return;
  o.ueber += 1;
  // Neben anderen Pruefungen gemessen (Issue #1073): Die Dauer enthaelt fremde Last und
  // sagt ueber die Pruefung allein weniger als eine nacheinander gemessene.
  if (z.gleichzeitig) o.ueberGleichzeitig += 1;
}

/**
 * Die Tabellenzeilen je Bereich: zuerst die Bereiche der Config in ihrer Reihenfolge, mit
 * Anteil und Hervorhebung aus dem Zuschnitt — auch ohne einen Lauf, denn ein Bereich, der
 * nie etwas ausloest, ist selbst eine Aussage. Danach die Bereiche, die nur noch im
 * Protokoll stehen (umbenannt oder entfernt, oder der Zuschnitt fehlt); ihr Anteil ist
 * unbekannt, `null`, und nie eine geratene 0.
 */
function bereichsTabelle(zuschnitt, jeBereich) {
  const zeilen = [];
  const gesehen = new Set();
  for (const b of zuschnitt?.bereiche ?? []) {
    const gezaehlt = jeBereich.get(b.name) ?? { laeufe: 0, dauerMs: 0 };
    gesehen.add(b.name);
    zeilen.push({
      name: b.name,
      nennend: b.nennend ?? null,
      von: b.von ?? null,
      hervorgehoben: b.hervorgehoben ?? null,
      kopplungsgrund: b.kopplungsgrund ?? null,
      laeufe: gezaehlt.laeufe,
      dauerMs: gezaehlt.dauerMs,
    });
  }
  const uebrige = [...jeBereich.keys()].filter((name) => !gesehen.has(name)).sort(vergleicheText);
  for (const name of uebrige) {
    const { laeufe, dauerMs } = jeBereich.get(name);
    zeilen.push({ name, nennend: null, von: null, hervorgehoben: null, kopplungsgrund: null, laeufe, dauerMs });
  }
  return zeilen;
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
  return tabZeilenLesen(join(root, CLAUDE_DIR, BEWEGUNGEN_DATEI), (teile) => {
    const zeitMs = Date.parse(teile[0]);
    if (teile.length !== 3 || Number.isNaN(zeitMs) || teile[1] === "") return null;
    return { zeitMs, id: teile[1] };
  });
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
 * auf dem Spiel steht eine Kennzahl, nicht ein Gate. `board` wie `checks` bei
 * `zuschnittHolen`.
 */
function verlaeufeHolen(root, ids, board) {
  const res = board(["issue", "activity", "--ids", ids.join(",")], { cwd: root });
  if (res.status !== 0) {
    const grund = (res.stderr || "").trim() || t("verlaufEnde", { status: res.status ?? res.error?.message ?? "?" });
    return { fehler: grund };
  }
  try {
    return { verlaeufe: JSON.parse(res.stdout) };
  } catch (err) {
    return { fehler: t("verlaufKeinJson", { grund: err.message }) };
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
function ruecklaufErmitteln(root, einstellungen, fensterTage, jetztMs, board) {
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
      grund: t("quoteLocal"),
    };
  }

  const gewertet = kandidatenBestimmen(protokoll.zeilen, fenster, einstellungen.kandidatenMax);
  basis.kandidaten = gewertet.kandidaten;
  if (gewertet.ids.length === 0) return { ...basis, status: "nichtBerechenbar" };

  const geholt = verlaeufeHolen(root, gewertet.ids, board);
  if (geholt.fehler) {
    return { ...basis, status: "entfallen", grund: t("quoteVerlaufFehl", { grund: geholt.fehler }) };
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
    text: t("befundQuote", { nenner: r.nenner, zaehler: r.zaehler, quote: prozent(r.quote) }),
  }];
}

// --- Textformen --------------------------------------------------------------

/**
 * Zahlform der Projektsprache: deutsch Komma als Dezimaltrenner und Punkt als
 * Tausendertrenner, englisch umgekehrt. Von Hand und NICHT ueber `toLocaleString`: Dessen
 * Ergebnis haengt an der Locale der Maschine.
 *
 * SYNC: dieselben Textformen (`zahlform`, `dauer`) stehen in kit/effort.mjs (#440).
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
 * SYNC: dieselbe Funktion steht in kit/effort.mjs (#440).
 */
export function tausenderPunkte(ziffern) {
  if (!NUR_ZIFFERN.test(ziffern)) return ziffern;
  // Angehaengt und einmal umgedreht (Issue #1080): `unshift` verschob bei jeder Gruppe
  // das ganze Array, die Schleife war damit quadratisch — die Wachstumsprobe fand es.
  const gruppen = [];
  for (let ende = ziffern.length; ende > 0; ende -= 3) {
    gruppen.push(ziffern.slice(Math.max(0, ende - 3), ende));
  }
  return gruppen.reverse().join(".");
}

export function zahlform(wert, stellen) {
  const fest = wert.toFixed(stellen);
  const [ganz, bruch] = fest.split(".");
  const vorzeichen = ganz.startsWith("-") ? "-" : "";
  const ziffern = vorzeichen ? ganz.slice(1) : ganz;
  const gruppiert = tausenderPunkte(ziffern).replaceAll(".", t("tausender"));
  return bruch ? `${vorzeichen}${gruppiert}${t("dezimal")}${bruch}` : `${vorzeichen}${gruppiert}`;
}

/**
 * Eine Quote als Prozentzahl — ganzzahlig ohne, sonst mit einer Nachkommastelle.
 * Nie gekappt: 200 % ist eine wahre Aussage ueber zwei Ruecklaeufe je Karte.
 */
function prozent(quote) {
  const p = quote * 100;
  return t("prozent", { zahl: zahlform(p, Number.isInteger(p) ? 0 : 1) });
}

/** Eine Dauer in Minuten mit einer Nachkommastelle — die Spalte der Bereichstabelle. */
function minuten(ms) {
  return zahlform(ms / 60_000, 1);
}

/** Eine Dauer in Millisekunden als lesbare Spanne; `null` sagt "nicht gemessen". */
function dauer(ms) {
  if (ms === null) return t("nichtGemessen");
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
 * keine Tendenz, wie `laufText` in kit/effort.mjs es sagt.
 */
function ausfuehrungsText(n) {
  if (n === 0) return t("ausfuehrungKeine");
  return n === 1 ? t("ausfuehrungEine") : t("ausfuehrungMehrere", { n });
}

/** Eine Zahl mit ihrem Wort — der Text `einzahl` bei genau einem, sonst `mehrzahl`. */
function anzahlText(n, einzahl, mehrzahl) {
  return t(n === 1 ? einzahl : mehrzahl, { n });
}

function lauftagText(n) {
  if (n === 0) return t("lauftagKeiner");
  return n === 1 ? t("lauftagEiner") : t("lauftagMehrere", { n });
}

/** Der Zustand einer Pruefung, wie er in der Tabelle steht. */
function zustandText(p) {
  if (p.zustand === "nicht gelaufen") return t("zustandNichtGelaufen");
  if (p.zustand === "gewackelt") return t("zustandGewackelt");
  return p.zustand === "beanstandet" ? t("zustandBeanstandet") : t("zustandNieBeanstandet");
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
    ...berichtBereiche(e),
    ...berichtRuecklauf(e),
    ...berichtBefund(e),
    // Die Messgrenze aus E17 steht in JEDEM Bericht, auch im Leerfall: Wer die Datei
    // liest, soll wissen, was sie systematisch nicht sieht.
    t("messgrenzeTitel"), "",
    t("messgrenze"),
    "",
    ...berichtFuss(e),
  ].join("\n");
}

function berichtKopf(e) {
  const zeilen = [
    t("titel"), "",
    t("am", { am: e.erzeugtAm }),
    t("fenster", { tage: e.fenster.tage, von: e.fenster.von, bis: e.fenster.bis }),
  ];
  if (e.fenster.abgeschnitten) zeilen.push(t("abgeschnitten", { beginn: e.fenster.erhebungsbeginn }));
  zeilen.push("");
  if (!e.protokoll.vorhanden) {
    zeilen.push(t("ohneProtokoll", { pfad: `${CLAUDE_DIR}/${AUSFUEHRUNGEN_DATEI}` }), "");
  }
  return zeilen;
}

function berichtPruefungen(e) {
  if (e.pruefungen.length === 0) {
    return [t("pruefungenTitel"), "", t("pruefungenLeer"), ""];
  }
  const zeilen = [
    t("pruefungenTitel"), "",
    t("pruefungenKopf"),
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...e.pruefungen.map((p) =>
      `| \`${p.cmd}\` | ${zustandText(p)} | ${p.ausfuehrungen} | ${p.beanstandungen} | ${p.wackler ?? 0} | ${dauer(p.dauerMs)} | ${p.lauftage} |`),
    "",
  ];
  // Je Reparaturkandidat eine Zeile (Issue #1398, E10) — dieselbe Form, die `kandidaten` ausgibt.
  for (const p of e.pruefungen.filter((p) => p.reparaturkandidat)) {
    zeilen.push(t("reparatur", { cmd: p.cmd, kandidat: kandidatText(p), ab: REPARATUR_AB_WACKLERN }));
  }
  // Die Traglast in Worten (AK 7): Eine Zeile aus einem einzigen Lauftag ist eine
  // Momentaufnahme — das steht ausdruecklich da, nicht nur als 1 in einer Spalte.
  for (const p of e.pruefungen.filter((p) => p.ausfuehrungen > 0 && p.lauftage === 1)) {
    zeilen.push(t("momentaufnahme", { cmd: p.cmd }));
  }
  // Eine im Fenster entfernte Pruefung bleibt in der Zeitbilanz (E3) und wird benannt:
  // Ihre Zahlen sagen sonst nichts darueber, warum sie kuenftig fehlen werden.
  for (const p of e.pruefungen.filter((p) => !p.vorgeschrieben)) {
    zeilen.push(t("nichtVorgeschrieben", { cmd: p.cmd }));
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
  const zeilen = [t("abschlusszeitTitel"), ""];
  if (a.karten === 0) {
    zeilen.push(t("abschlusszeitLeer"));
  } else {
    zeilen.push(t("abschlusszeit", {
      mittel: dauer(a.mittelMs),
      vergleich: dauer(a.vergleichMs),
      karten: anzahlText(a.karten, "karteEine", "karteMehrere"),
      laeufe: anzahlText(a.laeufe, "abschlusslaufEiner", "abschlusslaufMehrere"),
    }));
  }
  // Die Messgrenze der Zahl (AK 6): Sie steht in JEDEM Fall da, auch im Leerfall.
  zeilen.push(...abschlusszeitVermerke(a), "", t("abschlusszeitGrenze"), "");
  return zeilen;
}

/** Die Vermerke zur Traglast des Vergleichswerts: je ausgelassener Pruefung eine Zeile. */
function abschlusszeitVermerke(a) {
  if (a.ausgelassen.length === 0) return [t("ohneAuslassung")];
  return a.ausgelassen.map((p) => (p.mittelMs === null
    ? t("ausgelassenNie", { cmd: p.cmd, grund: p.grund })
    : t("ausgelassen", { cmd: p.cmd, grund: p.grund, dauer: dauer(p.mittelMs), ausfuehrungen: ausfuehrungsText(p.ausfuehrungen) })));
}

/**
 * Der Abschnitt "Bereiche" (Issue #1005): die Tabelle mit Sonderzeilen und Summen-Hinweis,
 * das Inventar, die teuren Dateien und die Obergrenze. Fehlt der Zuschnitt, steht der
 * Vermerk vorn, und Anteil wie Inventar entfallen — Laeufe und Minuten bleiben.
 */
function berichtBereiche(e) {
  const b = e.bereiche;
  const zeilen = [t("bereicheTitel"), ""];
  if (b.vermerk !== null) zeilen.push(t("ohneZuschnitt", { vermerk: b.vermerk }), "");
  zeilen.push(
    t("bereicheKopf"),
    "| --- | --- | --- | --- | --- |",
    ...b.tabelle.map((z) => `| ${z.name} | ${anteilText(z)} | ${hervorhebungText(z)} | ${z.laeufe} | ${minuten(z.dauerMs)} |`),
    ...b.sonderzeilen.map((z) => `| ${z.name} | — | — | ${z.laeufe} | ${minuten(z.dauerMs)} |`),
    "",
    t("bereicheSumme", { minuten: minuten(b.gesamtDauerMs) }),
    "",
    ...berichtInventar(b.inventar),
    ...berichtTeureDateien(b.teureDateien),
    ...berichtObergrenze(b.obergrenze),
  );
  return zeilen;
}

/** Der Anteil `n/m` einer Tabellenzeile, ohne Zuschnitt ein Strich. */
function anteilText(z) {
  return z.nennend === null || z.von === null ? "—" : `${z.nennend}/${z.von}`;
}

/** Die Hervorhebung einer Tabellenzeile — bei gekoppelten Bereichen mit Grund (E14). */
function hervorhebungText(z) {
  if (z.hervorgehoben === null) return "—";
  if (!z.hervorgehoben) return t("nein");
  return z.kopplungsgrund ? t("jaKopplung", { grund: z.kopplungsgrund }) : t("ja");
}

function berichtInventar(inventar) {
  if (inventar === null) return [];
  const freigestellt = inventar.freigestellt ?? [];
  const ohneZuordnung = inventar.ohneZuordnung ?? [];
  return [
    t("inventarTitel"), "",
    t("inventarOhneTreffer", { ohne: inventar.ohneTreffer, dateien: inventar.dateien }),
    "",
    t("inventarFreigestellt", { n: freigestellt.length }),
    ...freigestellt.map((f) => `- \`${f.pfad}\` — ${f.grund}`),
    "",
    t("inventarOhneZuordnung", { n: ohneZuordnung.length }),
    ...ohneZuordnung.map((pfad) => `- \`${pfad}\``),
    "",
  ];
}

function berichtTeureDateien(teure) {
  const zeilen = [t("teuerTitel"), ""];
  if (teure.length === 0) {
    zeilen.push(t("teuerLeer"), "");
    return zeilen;
  }
  zeilen.push(
    t("teuerKopf"),
    "| --- | --- | --- |",
    ...teure.map((d) => `| \`${d.pfad}\` | ${d.volleLaeufe} | ${minuten(d.dauerMs)} |`),
    "",
  );
  return zeilen;
}

function berichtObergrenze(o) {
  const grenze = dauer(o.grenzeMs);
  const zeilen = [t("obergrenzeTitel", { grenze }), ""];
  if (o.kommandos.length === 0) {
    zeilen.push(t("obergrenzeLeer"), "");
    return zeilen;
  }
  zeilen.push(
    t("obergrenzeKopf", { grenze }),
    "| --- | --- | --- | --- |",
    ...o.kommandos.map((k) => `| \`${k.cmd}\` | ${k.abschlusslaeufe} | ${k.ueber} | ${k.ueberGleichzeitig ?? 0} |`),
    "",
  );
  return zeilen;
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
    return [t("ruecklaufTitel"), "", t("ruecklaufEntfallen", { grund: r.grund }), ""];
  }
  return [
    t("ruecklaufTitel"), "",
    ruecklaufKernsatz(r),
    t("nichtZuordenbar", { n: r.nichtZuordenbareBewegungen }),
    ...ruecklaufVermerke(r, e.schwellen),
    t("restluecke"),
    "",
  ];
}

/** Die erste Aussage des Quote-Abschnitts: die Quote selbst oder ihr Nicht-Berechenbar-Grund. */
function ruecklaufKernsatz(r) {
  if (r.status !== "berechnet") {
    return r.kandidaten.gewertet === 0 ? t("kernOhneKarte") : t("kernOhneEintritt");
  }
  return t("kern", {
    karten: anzahlText(r.nenner, "karteEine", "karteMehrere"),
    kam: t(r.nenner === 1 ? "kamEine" : "kamMehrere"),
    bewegungen: anzahlText(r.zaehler, "bewegungEine", "bewegungMehrere"),
    quote: prozent(r.quote),
  });
}

/** Die Traglast-Vermerke der Quote — nur die Zeilen, deren Anlass eingetreten ist. */
function ruecklaufVermerke(r, schwellen) {
  const zeilen = [];
  if (r.kandidaten.weggefallen > 0) {
    zeilen.push(t(r.kandidaten.weggefallen === 1 ? "deckelEine" : "deckelMehrere", {
      max: schwellen.kandidatenMax, n: r.kandidaten.weggefallen, gewertet: r.kandidaten.gewertet,
    }));
  }
  if (r.abgeschnitten) zeilen.push(t("bewegungenAbgeschnitten", { beginn: r.erhebungsbeginn }));
  if (r.fehlerKarten > 0) zeilen.push(anzahlText(r.fehlerKarten, "fehlerKarteEine", "fehlerKartenMehrere"));
  if (r.protokoll.fehlerhafteZeilen > 0) zeilen.push(t("bewegungenUnlesbar", { n: r.protokoll.fehlerhafteZeilen }));
  return zeilen;
}

function berichtBefund(e) {
  const zeilen = [t("befundTitel"), ""];
  if (e.befund.length === 0) zeilen.push(t("befundLeer"), "");
  else zeilen.push(...e.befund.map((b) => `- ${b.text}`), "");
  zeilen.push(
    t("schwellen", {
      nie: e.schwellen.nieBeanstandetAbAusfuehrungen,
      quote: prozent(e.schwellen.quoteSchwelle),
      ab: e.schwellen.quoteAbPaketen,
      tage: e.schwellen.fensterTage,
    }),
    ""
  );
  return zeilen;
}

function berichtFuss(e) {
  const zeilen = [];
  if (e.protokoll.fehlerhafteZeilen > 0) zeilen.push(t("protokollUnlesbar", { n: e.protokoll.fehlerhafteZeilen }), "");
  if (e.configGelesen) zeilen.push(t("configHinweis", { grund: e.configGelesen }), "");
  return zeilen;
}

/**
 * Der Befundblock als Text — mit Datum der Auswertung und Fenster in der Kopfzeile.
 *
 * Ohne Befund eine LEERE Zeichenkette, nicht eine mit Kopfzeile: Die Kopfzeile allein
 * waere schon der beruhigende Satz, den das Schweigen bei Unauffaelligkeit
 * ausschliesst (dieselbe Zusage wie `befundText` in kit/effort.mjs).
 */
export function befundText(stand) {
  const befund = Array.isArray(stand?.befund) ? stand.befund : [];
  if (befund.length === 0) return "";
  const kopf = t("befundKopf", { am: stand.erzeugtAm, tage: stand.fenster?.tage ?? "?", von: stand.fenster?.von ?? "?" });
  return [kopf, ...befund.map((b) => `- ${b.text}`)].join("\n") + "\n";
}

/** Die Zahl der Wackler eines Reparaturkandidaten in Worten. */
function kandidatText(p) {
  return t("kandidatWackler", { n: p.wackler });
}

/**
 * Die Reparaturkandidaten als Text, eine Zeile je Kandidat (Issue #1398, Plan #1395, E15).
 * Gefiltert wird `pruefungen` — eine eigene Liste daneben waere eine zweite Wahrheit.
 */
export function kandidatenText(stand) {
  const pruefungen = Array.isArray(stand?.pruefungen) ? stand.pruefungen : [];
  return pruefungen
    .filter((p) => p?.reparaturkandidat === true)
    .map((p) => `${t("kandidatZeile", { cmd: p.cmd, kandidat: kandidatText(p) })}\n`)
    .join("");
}

// --- Kommandos ---------------------------------------------------------------

function schreibeDatei(pfad, inhalt) {
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, inhalt, "utf-8");
  } catch (err) {
    fail(t("nichtGeschrieben", { pfad, grund: err.message }));
  }
}

/** Ein Kommando des installierten Kits als Kindprozess — die Vorgabe fuer `board` und `checks`. */
function kitKommando(pfad) {
  return (args, { cwd }) => spawnSync(process.execPath, [join(cwd, ...pfad), ...args], { cwd, encoding: "utf-8" });
}

/**
 * Die Auswertung. Rueckgabe ist der vollstaendige Stand — dieselbe Struktur, die nach
 * `.claude/wirksamkeit.json` geht und auf stdout steht: eine Form, nicht zwei.
 *
 * `jetzt` ist die Uhr, an der das Fenster haengt; `board` und `checks` starten den
 * Board-Adapter und `checks.mjs` des Projekts (Issue #1213, Plan #1199 E6). Ihre
 * Vorgaben sind die Uhr des Rechners und die Kindprozesse unter `.claude/kit/`.
 */
export function auswerten(root, {
  fenster: fensterArg,
  jetzt = () => new Date(),
  board = kitKommando(BOARD_KOMMANDO),
  checks = kitKommando(CHECKS_KOMMANDO),
} = {}) {
  const einstellungen = ladeEinstellungen(root);
  const fensterTage = fensterArg ?? einstellungen.fensterTage;
  const jetztMs = jetzt().getTime();
  const protokoll = protokollLesen(root);
  const fenster = fensterBestimmen(protokoll.zeilen, fensterTage, jetztMs);
  const pruefungen = aggregieren(protokoll.zeilen, einstellungen.buildCmds, fenster, einstellungen.hinweisCmds);
  const abschlusszeit = abschlusszeitErmitteln(protokoll.zeilen, fenster, einstellungen.abschlussAusgelassen);
  const bereiche = bereicheErmitteln(protokoll.zeilen, fenster, einstellungen.buildCmds, zuschnittHolen(root, checks));
  const ruecklauf = ruecklaufErmitteln(root, einstellungen, fensterTage, jetztMs, board);
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
    bereiche,
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
 *
 * SYNC: dieselbe Funktion steht in kit/effort.mjs (#440).
 */
export function befund(root) {
  const pfad = join(root, CLAUDE_DIR, STAND_DATEI);
  try {
    return befundText(JSON.parse(readFileSync(pfad, "utf-8")));
  } catch {
    return "";
  }
}

/**
 * Die Reparaturkandidaten aus dem letzten Stand. Liest allein `.claude/wirksamkeit.json`
 * und rechnet nicht neu (E15): `push main` und `merge production` sollen den Stand der
 * letzten Auswertung nennen. Nie ein Fehler — eine fehlende oder unlesbare Datei heisst
 * wie bei `befund` "nichts zu nennen".
 */
export function kandidaten(root) {
  try {
    return kandidatenText(JSON.parse(readFileSync(join(root, CLAUDE_DIR, STAND_DATEI), "utf-8")));
  } catch {
    return "";
  }
}

// --- CLI ---------------------------------------------------------------------

/**
 * Die frueheren deutschen Namen der Befehle und der Option, je Eintrag deutsch -> englisch
 * (Issue #1560, Plan #1548 E8). Seit Version 5 nimmt effectiveness.mjs nur die englischen an;
 * diese Tabellen dienen allein der Meldung, die einen deutschen Namen abweist und den
 * englischen nennt — zum Ausfuehren werden sie nie benutzt.
 */
const ALTE_BEFEHLE = Object.freeze({ auswerten: "evaluate", befund: "finding", kandidaten: "candidates" });
const ALTE_OPTIONEN = Object.freeze({ "--fenster": "--window" });

/** Wirft die Abweisung, wenn `name` ein frueherer deutscher Name aus `tabelle` ist. */
function altnameAbweisen(tabelle, name) {
  if (typeof name === "string" && Object.hasOwn(tabelle, name)) {
    fail(t("altname", { name, englisch: tabelle[name] }));
  }
}

// SYNC: `altnameAbweisen`, `parseAuswertenArgs` und `main` stehen gleichlautend in
// kit/effort.mjs (#440) — bis auf die Unterkommandos neben `evaluate` und `finding`: dort
// `info`, hier `candidates` (Issue #1398).
function parseAuswertenArgs(rest) {
  const args = {};
  let i = 0;
  while (i < rest.length) {
    altnameAbweisen(ALTE_OPTIONEN, rest[i]);
    if (rest[i] !== "--window") fail(t("unbekanntesArgument", { arg: rest[i] }));
    const wert = Number(rest[i + 1]);
    if (!Number.isInteger(wert) || wert <= 0) {
      fail(t("fensterErwartet", { wert: rest[i + 1] ?? "" }));
    }
    args.fenster = wert;
    i += 2;  // Option und ihr Wert
  }
  return args;
}

/** Der Fehler eines Aufrufs als stderr-Zeile: `Fehler:` fuer den erwarteten, sonst `Unerwarteter Fehler:`. */
function fehlerZeile(err) {
  const prefix = err instanceof WirksamkeitError ? t("fehler") : t("unerwarteterFehler");
  return `${prefix}: ${err.message}\n`;
}

/**
 * Ein Aufruf wie von der Kommandozeile, aber im selben Prozess (Issue #1213, Plan #1199
 * E6). `argv` ist die Kommandozeile ohne `node effectiveness.mjs`, `cwd` das Projekt;
 * `jetzt`, `board` und `checks` gehen an `auswerten`. Rueckgabe wie bei `spawnSync`:
 * `{ status, stdout, stderr }`.
 *
 * SYNC: dieselbe Funktion steht in kit/effort.mjs (#440).
 */
export function aufrufen(argv, { cwd = process.cwd(), ...abhaengigkeiten } = {}) {
  let stdout = "";
  let stderr = "";
  const ausgabe = {
    stdout: (text) => {
      stdout += text;
    },
  };
  let status;
  try {
    status = main(argv, { cwd, abhaengigkeiten, ...ausgabe });
  } catch (err) {
    stderr += fehlerZeile(err);
    status = 1;
  }
  return { status, stdout, stderr };
}

function main(argv, { cwd, abhaengigkeiten = {}, stdout }) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    stdout(hilfe());
    return 0;
  }
  if (argv[0] === "--version") {
    stdout(`${KIT_VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  // Wie in kit/effort.mjs: Die Abweisung eines deutschen Befehls geht nach stderr, mit
  // Exit 1; stdout bleibt leer, denn `finding` und `candidates` reichen stdout weiter.
  altnameAbweisen(ALTE_BEFEHLE, command);
  if (command === "evaluate") {
    // Immer JSON auf stdout, auch wenn der Aufruf abgewiesen wird: Die Ausgabe dieses
    // Kommandos wird maschinell gelesen. Ein Fliesstext-Fehler mittendrin machte aus
    // jedem Fehlerfall einen Parse-Fehler beim Aufrufer (wie in kit/effort.mjs).
    try {
      stdout(JSON.stringify(auswerten(cwd, { ...parseAuswertenArgs(rest), ...abhaengigkeiten }), null, 2) + "\n");
      return 0;
    } catch (err) {
      stdout(JSON.stringify({ ok: false, fehler: err.message }, null, 2) + "\n");
      return 1;
    }
  }
  if (command === "finding") {
    // Hier gilt das Gegenteil: Was auf stdout steht, reicht ein Skill unveraendert
    // weiter. Ein abgewiesener Aufruf schreibt deshalb nach stderr und laesst stdout
    // leer — sonst stuende eine Fehlermeldung dort, wo ein Befund hingehoert.
    if (rest.length > 0) fail(t("befundOhneArgumente", { arg: rest[0] }));
    stdout(befund(cwd));
    return 0;
  }
  if (command === "candidates") {
    // Wie `finding`: stdout traegt nur, was ein Skill weiterreicht.
    if (rest.length > 0) fail(t("kandidatenOhneArgumente", { arg: rest[0] }));
    stdout(kandidaten(cwd));
    return 0;
  }

  stdout(hilfe());
  return fail(t("unbekannterBefehl", { befehl: command }));
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
    process.exitCode = main(process.argv.slice(2), { cwd: process.cwd(), stdout: (text) => process.stdout.write(text) });
  } catch (err) {
    process.stderr.write(fehlerZeile(err));
    process.exit(1);
  }
}
