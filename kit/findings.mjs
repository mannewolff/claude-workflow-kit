#!/usr/bin/env node
/**
 * claude-workflow-kit Befunde der Modell-Pruefungen (Issue #799, Plan #797, Fachliche Quelle #768)
 *
 * Haelt die feste Liste der Mangel-Arten und prueft die Form eines Funds: `kinds` gibt
 * die zwoelf Arten mit je einem erklaerenden Satz aus, `check --file <f>` liest einen
 * Befunde-Text und meldet je Fund, welche der drei Pflichtangaben aus dem Abschnitt
 * „Befunde der Modell-Pruefungen" (templates/CLAUDE-workflow.md) fehlt.
 *
 * `record --file <f> --stage <s> --card <n>` (Issue #802) schreibt je Fund mit
 * bestaetigter Gegenprobe UND Uebernahmevermerk eine Zeile nach `.claude/befunde.tsv`
 * — anhaengend, nie leerend — und meldet je beruehrter Art den neuen Zaehlerstand und
 * ob die Schwelle erreicht ist. Nicht gepruefte, unvollstaendige und abgelehnte Funde
 * sind keine Vorkommen (AK 7 der fachlichen Quelle #768). Fuer die Stufe `code`
 * ermittelt es zusaetzlich den Vergleichsstand: ob die maschinellen Pflichtpruefungen
 * auf demselben Stand gruen waren (AK 10, Plan #797 E12).
 *
 * `evaluate` (Issue #806) liest Protokoll und Vorschlagsstand und schreibt den Bericht
 * nach `.claude/befunde.md` (fuer Menschen) und `.claude/befunde.json` (fuer die
 * Ausgabestellen); `finding` gibt allein den Befundblock aus diesem Stand als Text aus —
 * dieselbe Teilung von Messen und Anzeigen wie bei `effort.mjs` und `effectiveness.mjs`.
 *
 * `suggest --kind <a>` (Issue #804) legt am Board eine Idee an, sobald die Art oberhalb
 * ihres Nullpunkts die Schwelle erreicht — und ergaenzt einen bereits offenen Vorschlag,
 * statt einen zweiten anzulegen (AK 8). `suggest --rejected <a>` vermerkt die
 * Ablehnung und setzt den Nullpunkt auf den aktuellen Zaehlerstand (AK 9). Der Vorschlag
 * ist eine BEOBACHTUNG, keine Entscheidung: Ob daraus eine maschinelle Pruefung wird,
 * entscheidet der Mensch; ohne sein Zutun entsteht keine.
 *
 * WARUM EIN EIGENES WERKZEUG UND KEIN ANBAU AN effectiveness.mjs (Plan #797, E1):
 * `effectiveness.mjs` misst die Pflichtpruefungen aus `ausfuehrungen.tsv` und
 * `bewegungen.tsv`; Funde von Modellen sind eine andere Quelle und ein anderer
 * Gegenstand, und die Datei traegt bereits rund 960 Zeilen.
 *
 * DIE ARTENLISTE HAT GENAU EINEN WORTLAUT (E4): diesen hier. Der Regeltext zaehlt die
 * Arten nicht auf, sondern verweist auf `findings kinds`, und die Skills setzen sie
 * kuenftig ueber dieses Kommando in ihre Prompts ein. Zwei Orte driften auseinander,
 * sobald eine Art hinzukommt oder ihren Namen wechselt — und die Formpruefung laege
 * dann gegen einen anderen Wortlaut als der Prompt. Ein Projekt ergaenzt keine eigenen
 * Arten; `sonstiges` ist die Auffang-Art.
 *
 * AUS DER FORM WIRD KEIN GATE: Eine fehlende Angabe haelt nichts auf, deshalb endet
 * `check` auch mit lauter unvollstaendigen Funden mit Exit 0. Ungleich 0 wird es nur,
 * wenn der Aufruf selbst nicht geht — fehlendes `--file`, fehlende oder unlesbare Datei.
 *
 * GRAMMATIK DES FUNDBLOCKS: Ein Marken-Abschnitt beginnt bei einer der vier
 * Schweregrad-Marken (`KRITISCH`, `BLOCKER`, `WICHTIG`, `HINWEIS` — E3 vereinheitlicht
 * sie bewusst nicht) und endet vor der naechsten Marke oder vor der naechsten
 * Ueberschrift ohne Marke. Innerhalb eines Abschnitts beginnt jede fette Kopfzeile
 * einen eigenen Fund: Die Befunde-Kommentare des Kits fuehren die Marke als
 * Gruppenueberschrift ueber mehreren Funden, und ohne diese Unterteilung zaehlte ein
 * Abschnitt mit sechs Funden als einer. Eine Marke mitten im Fliesstext eroeffnet
 * nichts — sonst meldete die Pruefung einen Mangel an einem Absatz, der gar kein Fund
 * ist (der Abschnitt „Geprueft ohne Befund" nennt die Marken regelmaessig).
 *
 * Marke und Kopfzeile gelten auch als Eintrag einer Aufzaehlung: Reviewer schreiben
 * ihre Funde als Liste ('1. **WICHTIG — Titel**'), und ohne das Abziehen der
 * Listenmarke lieferte ein solcher Review ueberhaupt keine Funde (Issue #823). Fett ist
 * dabei nur die ganz fett gesetzte Zeile; '**Datei:** …' innerhalb eines Funds ist eine
 * Beschriftung und keine Kopfzeile.
 *
 * NUR ENGLISCHE NAMEN (Issue #1559, Plan #1548 E5-E7): Befehle, Optionen und der Wert von
 * `--stage` sind englisch; ein frueherer deutscher Name endet mit Exit 1 und nennt den
 * englischen. Die Befund-Arten hinter `Art:` bleiben deutsch, die Fundblock-Zeilen
 * (`Gegenprobe:`, `Art:`, `— geprueft, bestaetigt`) werden in beiden Sprachen gelesen (E19).
 *
 * Aufruf im Projekt-Root:  node .claude/kit/findings.mjs kinds
 *                          node .claude/kit/findings.mjs check --file <pfad>
 *                          node .claude/kit/findings.mjs suggest --kind <art>
 *                          node .claude/kit/findings.mjs evaluate
 *                          node .claude/kit/findings.mjs finding
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit liefert
 * seine Werkzeuge als eigenstaendig portable Einzeldateien aus. Mit ihnen reist allein ihre
 * Texttabelle unter texte/ (Issue #1524).
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TEXTE } from "./texte/findings.mjs";

// Der Normalisierer der Einstellungsnamen aus dem Board-Teil config-namen (Issue #1436, Plan
// #1420 E10): Er bildet eine englisch benannte Config auf die deutschen Namen ab, die dieses
// Modul liest. Dynamisch und abgefangen, denn das Modul laeuft auch allein ohne den Board-Teil;
// fehlt er, bleibt die Config, wie sie gelesen wurde.
const { normalisiereConfig = (roh) => ({ config: roh, hinweise: [] }) } =
  await import(new URL("./board/config-namen.mjs", import.meta.url).href).catch(() => ({}));

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "5.0.0";

// Blob-Hash und Ort der Pruef-Zusammenfassung kommen aus checks.mjs und werden NICHT
// nachgebaut (Issue #802, Plan #797 E13): Zwei Implementierungen derselben Frage
// weichen irgendwann ab, und der Vergleichsstand saehe dann einen Unterschied, den es
// nicht gibt. Aufgeloest als Nachbardatei mit dynamischem Import, wie night.mjs es
// fuer `zusammenfassungPfad` tut (Issue #498) — die Kit-Werkzeuge sind bewusst
// eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440), und die
// Nachbar-Aufloesung mit Fallback ist die Form, in der sie sich trotzdem etwas teilen.
//
// Bedingt und mit WERFENDEM Ersatz: `arten`, `pruefen` und `buchen` unterhalb der
// Code-Stufe laufen auch ohne Nachbarn weiter (Portabilitaets-Zusage), erst der
// Vergleichsstand braucht ihn — und meldet den fehlenden Nachbarn dann als Fehler,
// statt still einen falschen Hash zu liefern.
const NACHBAR_CHECKS = join(dirname(fileURLToPath(import.meta.url)), "checks.mjs");
const nachbarFehlt = () => {
  throw new BefundeError(t("nachbarFehlt", { pfad: NACHBAR_CHECKS }));
};
const { blobHashes, zusammenfassungPfad } = existsSync(NACHBAR_CHECKS)
  ? await import(pathToFileURL(NACHBAR_CHECKS).href)
  : { blobHashes: nachbarFehlt, zusammenfassungPfad: nachbarFehlt };

// Der Board-Adapter als KINDPROZESS, nicht als Import (Issue #804): `vorschlag` schreibt
// ans Board, und board.mjs ist ein CLI mit eigener Config-Aufloesung und eigenem
// Auth-Weg. KIT_ROOT ist derselbe Test-Hook wie in kit/night.mjs (Issue #189) — nur so
// laeuft in den Tests das ECHTE kit/findings.mjs gegen einen Stub-Adapter, statt eine
// Kopie im Temp-Verzeichnis zu messen. Ohne die Variable ist es der Nachbar, in `kit/`
// wie in `.claude/kit/`.
const BOARD_PATH = process.env.KIT_ROOT
  ? join(resolve(process.env.KIT_ROOT), ".claude", "kit", "board.mjs")
  : join(dirname(fileURLToPath(import.meta.url)), "board.mjs");

// --- Aufrufumgebung ----------------------------------------------------------

/**
 * Die Umgebung des laufenden Aufrufs (Issue #1213, Plan #1199 E6), nach dem Muster von
 * kit/checks.mjs. Als CLI ist sie leer, und jeder Zugriff unten faellt auf den Prozess
 * zurueck. `aufrufen` setzt sie fuer die Dauer eines Aufrufs im selben Prozess:
 * Arbeitsverzeichnis, Ausgabe, Uhr, der Start des Board-Adapters und der von git.
 */
let umgebung = {};

const wurzel = () => umgebung.cwd ?? process.cwd();
const jetzt = () => (umgebung.jetzt ? umgebung.jetzt() : new Date());
const aufStdout = (text) => (umgebung.stdout ? umgebung.stdout(text) : process.stdout.write(text));
const aufStderr = (text) => (umgebung.stderr ? umgebung.stderr(text) : process.stderr.write(text));

/**
 * Die zwoelf Mangel-Arten. Grob statt feinmaschig (Nicht-Ziel des Fachkonzepts): Sie
 * decken die Fragen aller fuenf heutigen Rollen-Prompts ab und lassen sich in einem
 * Satz erklaeren. Die Reihenfolge ist die des Plans und bleibt stabil — die Skills
 * setzen die Liste woertlich in ihre Prompts ein.
 *
 * `vorschlag` sagt, welche Frage `vorschlag --art` an der Schwelle stellt (Issue #1182):
 * `"pruefung"` fragt nach einer maschinellen Pruefung, `"liste"` nach einer Erweiterung
 * der Artenliste, `null` stellt keine. Nach einer Pruefung fragen nur die Arten, deren
 * Merkmal ein Werkzeug am Text oder Code erkennen kann; die uebrigen sind Urteile eines
 * Reviews, und der PO hat die Frage dazu wiederholt abgelehnt. Eine hoehere Schwelle
 * verschoebe dieselbe Karte nur.
 */
const ARTEN = [
  { name: "bestandsbehauptung", vorschlag: null },
  { name: "unbeobachtbar", vorschlag: null },
  { name: "widerspruch", vorschlag: null },
  { name: "luecke", vorschlag: null },
  { name: "unbestimmt", vorschlag: null },
  { name: "form", vorschlag: "pruefung" },
  { name: "doppelung", vorschlag: null },
  { name: "korrektheit", vorschlag: null },
  { name: "sicherheit", vorschlag: "pruefung" },
  { name: "test", vorschlag: null },
  { name: "konvention", vorschlag: "pruefung" },
  { name: "sonstiges", vorschlag: "liste" },
];

const ARTEN_NAMEN = new Set(ARTEN.map((a) => a.name));

/**
 * Ob eine Art an der Schwelle einen Vorschlag erzeugt. Eine fremde Art — nur aus einer
 * aelteren oder fremden Buchung moeglich — zaehlt als Urteils-Art: `vorschlag` nimmt
 * sie ohnehin nicht an.
 */
function erzeugtVorschlag(art) {
  return (ARTEN.find((a) => a.name === art)?.vorschlag ?? null) !== null;
}

const MARKEN = ["KRITISCH", "BLOCKER", "WICHTIG", "HINWEIS"];

// Markdown-Dekoration am Zeilenanfang und -ende: Ueberschriftenraute, Fettmarkierung,
// Listenpunkt, Zitatzeichen. Abgezogen wird sie, damit '#### BLOCKER' und
// '**KRITISCH — Titel**' dieselbe Marke ergeben.
const DEKO_VORN_RE = /^[\s>#*_]+/;
// Hinten steht ein Ausdruck fuer EIN Zeichen, nicht fuer den Lauf: `/[\s*_#]+$/` war ein
// S8786-Fund (Issue #877), weil der Lauf und das Zeilenende einander ueberlappten — eine
// lange Leerraum-Schleppe liess die Engine jede Aufteilung durchprobieren. Vorn stellt
// sich die Frage nicht: Dort ankert `^` den Lauf an genau einer Stelle.
const DEKO_HINTEN_ZEICHEN = /[\s*_#]/;

/** Der Text ohne Markdown-Dekoration am Ende. */
export function ohneDekoHinten(text) {
  let ende = text.length;
  while (ende > 0 && DEKO_HINTEN_ZEICHEN.test(text[ende - 1])) ende -= 1;
  return text.slice(0, ende);
}

// Die Aufzaehlungsmarke am Zeilenanfang: Bindestrich, Plus, Stern oder Nummer mit Punkt
// oder Klammer. Sie faellt vor jeder Erkennung weg, damit '- **WICHTIG — Titel**' und
// '1. **WICHTIG — Titel**' dieselbe Marke ergeben wie '**WICHTIG — Titel**' — Reviewer
// schreiben ihre Funde durchweg als Liste (Issue #823). Der Stern zaehlt nur mit
// folgendem Leerzeichen als Listenpunkt, sonst verschluckte die Marke jede Fettschrift.
const LISTE_VORN_RE = /^\s*(?:[-+*]|\d+[.)])\s+/;

// Eine Fund-Kopfzeile ist ganz fett gesetzt. Die Beschriftungen innerhalb eines Funds
// ('**Datei:** kit/board.mjs:12', '**Behebung:** …') beginnen zwar ebenfalls fett,
// tragen danach aber weiteren Text — zaehlte jede fette Zeile als Kopfzeile, ergaebe ein
// Review mit 30 Funde tragenden Bloecken 90 Funde.
const KOPFZEILE_RE = /^\*\*.+\*\*$/;

const MARKE_RE = new RegExp(`^(${MARKEN.join("|")})(?![A-Za-zÄÖÜäöü])`);

/**
 * Der Wert einer Angabenzeile 'Kopf: Wert' — `null`, wenn die Zeile nicht mit genau
 * einem der Koepfe und einem Doppelpunkt beginnt.
 *
 * Der Wert traegt keinen fuehrenden Leerraum mehr, seinen nachlaufenden aber schon:
 * genau das, was die alten Ausdruecke `^Kopf\s*:\s*(.*)$` lieferten. Das Stutzen hinten
 * machen die Aufrufer (`artName`, `trim`).
 *
 * In zwei Schritten statt in einem Ausdruck (S8786, Issue #877): Dort ueberlappten sich
 * `\s*` und `(.*)` hinter dem Doppelpunkt — dieselbe Form, die Issue #403 fuer
 * PRUEFUNG_ZEILE auseinandergenommen hat. Erst den Doppelpunkt suchen, dann die beiden
 * Teile lesen; keiner der Schritte kann zuruecksetzen.
 *
 * 'Gegenprobe am Bestand:' ist weiterhin kein Treffer — die Form verlangt genau die eine
 * Zeile, und eine grosszuegigere Erkennung liesse die Altform als erfuellt erscheinen.
 */
export function angabenWert(zeile, ...koepfe) {
  const trenner = zeile.indexOf(":");
  if (trenner === -1) return null;
  // `trimEnd()` steht fuer das `\s*` vor dem Doppelpunkt, `trimStart()` fuer das dahinter
  // — beide raeumen dieselben Zeichen ab, `\r` aus CRLF eingeschlossen.
  if (!koepfe.includes(zeile.slice(0, trenner).trimEnd())) return null;
  return zeile.slice(trenner + 1).trimStart();
}

// Die drei Striche, mit denen ein Stand beginnen darf: Geviert-, Halbgeviert- und
// Bindestrich.
const STAND_STRICHE = "—–-";

// Die Umlautfassung gilt jeweils mit: Der Regeltext schreibt das Kit-uebliche ASCII, aber
// die Funde kommen von Modellen, die 'geprüft, bestätigt' schreiben — eine Meldung
// darueber waere eine falsche Meldung.
const GEPRUEFT = new Set(["geprueft", "geprüft"]);
const BESTAETIGT = new Set(["bestaetigt", "bestätigt"]);

/** Der Text ohne Leerraum an den Raendern und ohne einen einzelnen Schlusspunkt. */
function ohneSchlusspunkt(text) {
  const knapp = text.trim();
  return knapp.endsWith(".") ? knapp.slice(0, -1).trimEnd() : knapp;
}

/**
 * Ob der Text hinter einem Strich genau einer der beiden Staende ist — und welcher.
 *
 * `null` heisst: kein Stand. Sonst `true` fuer 'geprueft, bestaetigt' und `false` fuer
 * 'nicht geprueft'.
 */
function standArt(text) {
  const kern = ohneSchlusspunkt(text).toLowerCase();
  const komma = kern.indexOf(",");
  if (komma === -1) {
    // Der zweite Ast: 'nicht geprueft'. Das Leerzeichen zwischen den Woertern ist
    // Pflicht — 'nichtgeprueft' war auch dem alten `nicht\s+` kein Treffer.
    if (!kern.startsWith("nicht")) return null;
    const dahinter = kern.slice("nicht".length);
    if (dahinter.trimStart() === dahinter) return null;
    return GEPRUEFT.has(dahinter.trim()) ? false : null;
  }
  const vorn = kern.slice(0, komma).trim();
  const hinten = kern.slice(komma + 1).trim();
  return STAND_BESTAETIGT.some(([g, b]) => g.has(vorn) && b.has(hinten)) ? true : null;
}

/**
 * Der Stand am Ende eines Gegenprobe-Texts: die Position des Strichs, ab dem er steht,
 * und ob er 'bestaetigt' lautet — `null`, wenn der Text keinen Stand traegt.
 *
 * In zwei Schritten statt in einem Ausdruck (Issue #877): Der alte `STAND_RE` war der
 * einzige Fund, den SonarQube doppelt meldete — als super-linear (S8786), weil sich
 * `\s*\.?\s*$` am Ende selbst ueberlappte, und als zu komplex (S5843, 31 statt der
 * erlaubten 20), weil zwei Alternativen mit je fuenf Leerraum-Laeufen nebeneinander
 * standen. Jetzt sucht der erste Schritt den Strich, der zweite liest den Text dahinter.
 *
 * Gesucht wird der Strich, hinter dem der Stand steht — nicht der erste Strich
 * ueberhaupt: 'Ein zweiter Ort in skills/ — kein Treffer. — geprueft, bestaetigt' traegt
 * beide, und geteilt wird am Stand.
 *
 * Es ist der LETZTE Strich, und das ist dieselbe Stelle, die der alte Ausdruck fand:
 * Ein Stand reicht bis zum Zeilenende und traegt selbst keinen Strich, also gibt es
 * hoechstens einen, hinter dem einer steht. Ueber alle Striche zu laufen und je einen
 * Rest abzuschneiden waere quadratisch gewesen — der Fehler, den dieses Paket behebt.
 */
export function standVon(rest) {
  const index = Math.max(...[...STAND_STRICHE].map((s) => rest.lastIndexOf(s)));
  if (index === -1) return null;
  const art = standArt(rest.slice(index + 1));
  return art === null ? null : { index, bestaetigt: art };
}

const BUCHEN_STUFEN = ["fachlich", "plan", "issue", "code"];

// Vorgabe des Config-Blocks `befunde.schwelle` (Issue #800): Ab so vielen Vorkommen
// einer Art oberhalb ihres Nullpunkts meldet `buchen` die Schwelle als erreicht.
const SCHWELLE_VORGABE = 3;

// Je fehlender Angabe der Schluessel ihrer Meldung in `TEXTE`.
const ANGABEN = {
  gegenprobe: "angabeGegenprobe",
  stand: "angabeStand",
  art: "angabeArt",
  "reviewer-kopf": "angabeReviewerKopf",
};

// Vertragswerte (E14), die auch ein englischer Text woertlich nennt: der zweite Stand der
// Gegenprobe, die Angabe ohne Pruefer und der Vergleichsstand ohne gruene Deckung.
const STAND_NICHT_GEPRUEFT = "— nicht geprueft";
const ANGABE_KEINE_PRUEFER = "keine-pruefer";
const NICHT_VERGLEICHBAR = "nicht-vergleichbar";

// Die Dateien, mit denen dieses Werkzeug arbeitet. Hier oben und nicht bei
// `buchen`, weil der Hilfetext sie nennt und ein `const` unterhalb von ihm beim Laden
// in die temporale Totzone liefe.
const PROTOKOLL_DATEI = ".claude/befunde.tsv";
const VORSCHLAEGE_DATEI = ".claude/befunde-vorschlaege.json";
const CONFIG_DATEI = ".claude/workflow.config.json";
// Die beiden Ergebnisse von `auswerten` (Issue #806), im Muster von effectiveness.mjs:
// der Bericht fuer Menschen, der Stand fuer die Ausgabestellen.
const BERICHT_DATEI = ".claude/befunde.md";
const STAND_DATEI = ".claude/befunde.json";

// Die Texttabelle liegt im Teil texte/ (Issue #1524); exportiert bleibt sie unter ihrem Namen.
export { TEXTE };

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen wie der Normalisierer:
// Fehlt board/namen.mjs neben findings.mjs, bleiben die Texte deutsch.
const namen = await import(new URL("./board/namen.mjs", import.meta.url).href).catch(() => null);

// Das Register der Marker (Issue #1443, Plan #1420 E15): Der Kopf des Befunde-Kommentars gilt
// unter beiden Namen; fehlt der Teil, erkennt `reviewKopfDa` den deutschen Kopf wie vor dem Register.
const leseMarker = namen?.leseMarker ?? null;

// Die Fundblock-Zeilen in beiden Sprachen aus demselben Register (Issue #1559, Plan #1548 E19):
// `Gegenprobe:`/`Counter-check:`, `Art:`/`Kind:` und der Stand `— geprueft, bestaetigt`/
// `— checked, confirmed`. Fehlt der Teil, gelten die Wortlaute von dort als Vorgabe.
const FUNDBLOCK = {
  gegenprobe: namen?.MARKER.gegenprobe ?? { de: "Gegenprobe:", en: "Counter-check:" },
  art: namen?.MARKER.art ?? { de: "Art:", en: "Kind:" },
  geprueftBestaetigt: namen?.MARKER.geprueftBestaetigt ?? { de: "— geprueft, bestaetigt", en: "— checked, confirmed" },
  // Uebernahme- und Angabenvermerk, als ganze Zeile (Issue #1568).
  uebernommen: namen?.MARKER.uebernommen ?? { de: "Uebernahme: uebernommen", en: "Adoption: adopted" },
  abgelehnt: namen?.MARKER.abgelehnt ?? { de: "Uebernahme: abgelehnt", en: "Adoption: rejected" },
  unvollstaendig: namen?.MARKER.unvollstaendig ?? { de: "Angaben: unvollstaendig", en: "Details: incomplete" },
};

/** Die Koepfe einer Fundblock-Zeile ohne ihren Doppelpunkt, deutsch und englisch. */
const koepfe = ({ de, en }) => [de, en].map((k) => k.replace(/:$/, ""));
const GEGENPROBE_KOEPFE = koepfe(FUNDBLOCK.gegenprobe);
const ART_KOEPFE = koepfe(FUNDBLOCK.art);

// Je Sprache die beiden Woerter des bestaetigten Stands; die deutschen mit ihrer Umlautfassung.
const englischerStand = FUNDBLOCK.geprueftBestaetigt.en.replace(/^[—–-]\s*/, "").toLowerCase().split(",").map((w) => w.trim());
const STAND_BESTAETIGT = [
  [GEPRUEFT, BESTAETIGT],
  [new Set([englischerStand[0]]), new Set([englischerStand[1]])],
];

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Das Titel-Praefix der Idee, in jedem Projekt englisch (Issue #1552, Plan #1548 E2). */
function ideePraefix() {
  return namen ? namen.praefix("idee") : "[Idea]";
}

// Die Hilfe gibt es genau einmal, englisch, in jedem Projekt (Issue #1559, Plan #1548 E7).
// Eine Funktion, weil die Kit-Version und die Konstanten weiter unten erst beim Aufruf stehen.
function hilfe() {
  return `findings.mjs (claude-workflow-kit v${KIT_VERSION}) — form and kinds of findings

  node findings.mjs kinds
  node findings.mjs check --file <path>
  node findings.mjs record --file <path> --stage <${BUCHEN_STUFEN.map(stufeEnglisch).join("|")}> --card <n>
  node findings.mjs suggest --kind <kind>
  node findings.mjs suggest --rejected <kind>
  node findings.mjs evaluate
  node findings.mjs finding

kinds    Prints the ${ARTEN.length} defect kinds with one explaining sentence each. This list
         is the only wording in the kit; a project adds no kinds of its own.
check    Reads a findings text, recognises the finding blocks by their severity mark
         (${MARKEN.join(", ")}) and reports for each finding the
         missing ones of the three required entries: the counter-check, its state and the kind.
         The lines 'Gegenprobe:', 'Art:' and '— geprueft, bestaetigt' are read in both
         languages ('Counter-check:', 'Kind:', '— checked, confirmed'); the kind names
         behind them stay as listed by 'kinds'.
         In the findings comment of /issue-review ('## <Stage>-Review, Round <n>')
         it also reports a finding without a preceding reviewer head
         '### Reviewer <n>: <role>, <model>' as 'reviewer-kopf', and if the text
         carries no such head at all, '${ANGABE_KEINE_PRUEFER}' under 'meldungen'.
         Exit 0 even with only incomplete findings — the form is no gate.
         Only a call that cannot work ends non-zero: missing --file, missing
         or unreadable file.
record   Writes one row to ${PROTOKOLL_DATEI} for each finding with
         'Gegenprobe: … — geprueft, bestaetigt' AND 'Uebernahme: uebernommen' —
         appending, never emptying — and reports for each touched kind the new count
         and whether the threshold (config block findings.threshold, default ${SCHWELLE_VORGABE})
         is reached, plus with 'vorschlag' whether the kind creates a suggestion at the
         threshold. --stage requirement is booked as the stage 'fachlich'. With
         --stage code the last column carries the comparison state of
         the required checks ('gruen' or '${NICHT_VERGLEICHBAR}'), otherwise '-'.
suggest
         --kind <kind> creates an idea on the board as soon as the kind reaches the
         threshold above its zero point — only for form, konvention, sicherheit
         (question about a check) and sonstiges (question about the list of kinds); a
         judgement kind creates nothing and ends with 0; an open suggestion is
         extended instead of doubled. Below the threshold nothing is created, and that
         is no error. --rejected <kind> records the rejection and sets the
         zero point to the current count — a manual step without a board call.
         The record lives in ${VORSCHLAEGE_DATEI}; a failed
         board call leaves it unchanged and ends non-zero. A suggestion card that can
         no longer be found counts as done: its count becomes the new
         zero point, and a new idea carries only the findings after it. In the worktree
         of a run --kind creates nothing (the suggestion follows at teardown in the
         main copy), and --rejected ends non-zero.
evaluate
         Reads ${PROTOKOLL_DATEI} and ${VORSCHLAEGE_DATEI} and
         writes ${BERICHT_DATEI} as well as ${STAND_DATEI}: for each kind
         the number of occurrences, the distribution over the stages and the state of a
         suggestion, plus the stage 'code' split by green and
         not comparable comparison state. Both files are written in full, even
         when nothing stands out.
finding  Prints the finding block from ${STAND_DATEI} as text. If there is
         no finding, or the file is missing, empty or unreadable, the output
         stays empty. Exit always 0 — the finding is no gate.

  --version   Kit revision of this file.
  --help, -h  This overview.

A German command, option or stage name of earlier versions ends with exit 1 and names the
English one. The output of all commands is JSON on stdout — also when empty and also for a
rejected call. The only exception is 'finding': what it prints on stdout an output
point passes on unchanged, and an error message would be out of place there.
`;
}

class BefundeError extends Error {}

function fail(nachricht) {
  throw new BefundeError(nachricht);
}

/** Der Zeilentext ohne fuehrende Aufzaehlungsmarke — sonst unveraendert. */
function ohneListenmarke(zeile) {
  return zeile.replace(LISTE_VORN_RE, "");
}

/**
 * Der Zeilentext ohne Markdown-Dekoration an beiden Enden.
 *
 * Vorn wird in Runden abgezogen, weil Listenmarke und Dekoration einander umschliessen
 * koennen: '- **WICHTIG**' braucht beide, '> - #### WICHTIG' die Runde noch einmal.
 */
function kern(zeile) {
  let vorn = zeile;
  for (;;) {
    const kuerzer = ohneListenmarke(vorn).replace(DEKO_VORN_RE, "");
    if (kuerzer === vorn) break;
    vorn = kuerzer;
  }
  return ohneDekoHinten(vorn);
}

/** Die Schweregrad-Marke, mit der eine Zeile beginnt — null, wenn keine. */
function markeVon(kernText) {
  const treffer = MARKE_RE.exec(kernText);
  return treffer === null ? null : treffer[1];
}

/** Der Name einer Art, normalisiert: ohne Backticks, Anfuehrungszeichen und Schlusspunkt. */
function artName(rest) {
  return rest.replaceAll(/[`"'„“]/g, "").replace(/\.\s*$/, "").trim().toLowerCase();
}

/**
 * Zerlegt einen Befunde-Text in Fundbloecke — die Grammatik steht im Kopfkommentar.
 *
 * Gezaehlt wird nur innerhalb eines Marken-Abschnitts: Ein Text ohne jede Marke traegt
 * keine Funde, und das ist kein Mangel, sondern ein Review ohne Beanstandung.
 */
function fundeLesen(text) {
  const funde = [];
  let marke = null;
  let offen = null;

  const beginne = (m, titel, zeilennummer) => {
    // Eine Zeile, die ausser der Marke nichts traegt, ist eine Gruppenueberschrift und
    // kein Fundtitel: Folgt ihr eine fette Kopfzeile, bevor eine Inhaltszeile
    // dazukommt, tritt diese an ihre Stelle. Sonst zaehlte '#### WICHTIG' mit drei
    // Funden darunter als vier.
    offen = { marke: m, titel, zeile: zeilennummer, zeilen: [], nurUeberschrift: titel === m };
    funde.push(offen);
  };

  for (const [i, zeile] of text.split("\n").entries()) {
    const roh = zeile.trim();
    const text_ = kern(zeile);
    const gefunden = markeVon(text_);

    if (gefunden) {
      marke = gefunden;
      beginne(gefunden, text_, i + 1);
      continue;
    }
    // Eine Ueberschrift ohne Marke schliesst den Abschnitt: Was darunter steht, gehoert
    // zu keinem Fund mehr — etwa der Abschnitt „Geprueft ohne Befund".
    if (roh.startsWith("#")) {
      marke = null;
      offen = null;
      continue;
    }
    if (marke !== null && KOPFZEILE_RE.test(ohneListenmarke(roh))) {
      if (offen?.nurUeberschrift) funde.pop();
      beginne(marke, text_, i + 1);
      continue;
    }
    if (offen !== null && roh !== "") {
      offen.nurUeberschrift = false;
      offen.zeilen.push(text_);
    }
  }

  // Erst hier durchnummerieren: `beginne` kennt die Zeile, nicht die Position.
  return funde.map((fund, i) => ({ nummer: i + 1, marke: fund.marke, titel: fund.titel, zeile: fund.zeile, zeilen: fund.zeilen }));
}

/**
 * Beobachtung und Stand einer Gegenprobe-Zeile.
 *
 * Getrennt wird am Stand-Suffix und damit am Zeilenende, nicht am ersten Gedankenstrich:
 * 'Ein zweiter Ort in skills/ — kein Treffer. — geprueft, bestaetigt' traegt beides.
 */
function gegenprobeTeile(rest) {
  const stand = standVon(rest);
  return {
    beobachtung: (stand === null ? rest : rest.slice(0, stand.index)).trim(),
    hatStand: stand !== null,
  };
}

/**
 * Der Wert der ersten Zeile, die eine Angabe mit einem dieser Koepfe traegt — sonst
 * `null`. Auf `null` statt auf Wahrheit geprueft: Ein leerer Wert ist eine vorhandene
 * Angabe, und `!wert` haette ihn mit der fehlenden Zeile verwechselt.
 */
function ersterAngabenWert(zeilen, ...koepfe) {
  for (const zeile of zeilen) {
    const wert = angabenWert(zeile, ...koepfe);
    if (wert !== null) return wert;
  }
  return null;
}

/** Welche der drei Pflichtangaben einem Fund fehlen, in fester Reihenfolge. */
function fehlendeAngaben(fund) {
  const zeilen = [fund.titel, ...fund.zeilen];
  const gegenprobe = ersterAngabenWert(zeilen, ...GEGENPROBE_KOEPFE);
  const art = ersterAngabenWert(zeilen, ...ART_KOEPFE);

  const fehlt = [];
  if (gegenprobe === null) {
    // Ohne die Zeile fehlt auch ihr Stand — beides sind eigene Angaben, und ein
    // stillschweigend unterschlagener Stand liesse den Fund vollstaendiger aussehen.
    fehlt.push("gegenprobe", "stand");
  } else {
    // Der Stand allein ist keine Gegenprobe: 'Gegenprobe: — nicht geprueft' nennt nicht
    // „die Beobachtung, die ihn widerlegen wuerde" (templates/CLAUDE-workflow.md), und
    // als vollstaendig gezaehlt saehe das Werkzeug einen Beleg, wo keiner steht.
    const { beobachtung, hatStand } = gegenprobeTeile(gegenprobe);
    if (beobachtung === "") fehlt.push("gegenprobe");
    if (!hatStand) fehlt.push("stand");
  }

  let gefundeneArt = null;
  if (art === null) {
    fehlt.push("art");
  } else {
    gefundeneArt = artName(art);
    if (!ARTEN_NAMEN.has(gefundeneArt)) fehlt.push("art");
  }

  return { fehlt, art: gefundeneArt };
}

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt.
 *
 * Ausgeschrieben statt weggelassen, damit an jeder Fundstelle steht, dass die
 * Reihenfolge Absicht ist (S2871). Bewusst **nicht** `localeCompare`: Dessen
 * Reihenfolge haengt an der Locale der Maschine, und zwei Laeufe muessen
 * ueberall dieselbe Liste ergeben — die Artnamen stehen im Bericht und in der
 * Ausgabe von `buchen`.
 *
 * SYNC: dieselbe Funktion steckt in kit/checks.mjs, kit/night.mjs und
 * kit/effectiveness.mjs — Aenderungen dort nachziehen. Die Kit-Werkzeuge sind
 * bewusst eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440);
 * geteilte Logik wird dupliziert und hier markiert.
 *
 * Exportiert, damit der Locale-Test sie direkt pruefen kann (Issue #493).
 */
export function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Die Meldung zu einer fehlenden Angabe; bei der Art nennt sie den vorgefundenen Namen. */
function meldung(angabe, gefundeneArt) {
  if (angabe === "art" && gefundeneArt) return t("artNichtInListe", { art: gefundeneArt });
  return t(ANGABEN[angabe], { nichtGeprueft: STAND_NICHT_GEPRUEFT });
}

// Die erste Zeile des Befunde-Kommentars von /issue-review Schritt 5:
// '## <Issue|Fachplan|Plan>-Review, Runde <n>'. Nur dort verlangt `pruefen` den
// Reviewer-Kopf (Issue #1182) — der Code-Review aus /review schreibt einen Text ohne
// Reviewer-Koepfe, und `buchen` gibt ihm die Rolle `code-review` aus der Stufe.
const ISSUE_REVIEW_KOPF_RE = /^## (?:Issue|Fachplan|Plan)-Review, Runde \d+[^\S\n]*$/m;
const REVIEW_RUNDEN = new Set(["issueReviewRunde", "fachplanReviewRunde", "planReviewRunde"]);

/** Traegt der Text den Kopf `## <Stufe>-Review, Runde <n>` als ganze Zeile, unter beiden Namen? */
function reviewKopfDa(text) {
  if (leseMarker === null) return ISSUE_REVIEW_KOPF_RE.test(text);
  return text.split("\n").some((zeile) => {
    const m = zeile.startsWith("## ") ? leseMarker(zeile) : null;
    return m !== null && REVIEW_RUNDEN.has(m.sache) && /^ \d+[^\S\n]*$/.test(m.rest);
  });
}

export function pruefen(pfad) {
  let text;
  try {
    text = readFileSync(resolve(wurzel(), pfad), "utf-8");
  } catch (err) {
    fail(t("dateiNichtLesbar", { pfad, grund: err.code || err.message }));
  }

  // Der Reviewer-Kopf ist eine Angabe des Texts, nicht des Funds: `fehlendeAngaben`
  // bleibt bei den drei Pflichtangaben, sonst fiele bei `buchen` jeder Fund ohne Kopf
  // aus dem Protokoll, statt mit der Rolle 'unbekannt' gebucht zu werden.
  const koepfe = reviewKopfDa(text) ? reviewerKoepfe(text) : null;
  const eintraege = [];
  const funde = fundeLesen(text).map((fund) => {
    const { fehlt, art } = fehlendeAngaben(fund);
    if (koepfe !== null && !koepfe.some((k) => k.zeile < fund.zeile)) fehlt.push("reviewer-kopf");
    for (const angabe of fehlt) {
      eintraege.push({
        fund: fund.nummer,
        zeile: fund.zeile,
        marke: fund.marke,
        titel: fund.titel,
        angabe,
        meldung: meldung(angabe, art),
      });
    }
    return { nummer: fund.nummer, marke: fund.marke, titel: fund.titel, zeile: fund.zeile, art, fehlt };
  });

  // Kriterium 8 (Issue #1342, Plan #1375 E6, Issue #1382): Traegt der Befunde-Text von
  // /issue-review keinen einzigen Reviewer-Kopf, lief kein Pruefer — Schritt 6 setzt
  // `review:fertig` dann nicht. Eine Angabe des Texts, darum neben den Eintraegen je Fund.
  const meldungen = koepfe !== null && koepfe.length === 0
    ? [{ angabe: ANGABE_KEINE_PRUEFER, meldung: t("keinePruefer") }]
    : [];

  return {
    ok: true,
    datei: pfad,
    funde,
    eintraege,
    meldungen,
    vollstaendig: funde.filter((f) => f.fehlt.length === 0).length,
    unvollstaendig: funde.filter((f) => f.fehlt.length > 0).length,
  };
}

export function arten() {
  return { ok: true, anzahl: ARTEN.length, arten: ARTEN.map((a) => ({ ...a, erklaerung: t(`art_${a.name}`) })) };
}

// --- Buchen (Issue #802) -----------------------------------------------------

// SYNC: dasselbe Praefix steht in kit/checks.mjs (WARTEND_PRAEFIX, Issue #546) —
// Aenderungen dort nachziehen. Die wartenden Vorhaben-Notizen fallen dort aus
// `geaendert` heraus und stehen darum nie in `hashes`; zaehlte der Vergleichsstand
// sie hier mit, waere jeder Lauf mit liegender Notiz faelschlich nicht-vergleichbar.
const WARTEND_PRAEFIX = ".claude/vorhaben-wartend-";

// Die Kennzeichnung aus E6 (Plan #797): Ein so markierter Fund ist kein Vorkommen,
// auch wenn seine uebrigen Angaben vollstaendig aussehen.
// Englisch `Details: incomplete` aus dem Register (Issue #1568).
const [UNVOLLSTAENDIG_EN_KOPF, UNVOLLSTAENDIG_EN_WERT] = FUNDBLOCK.unvollstaendig.en.split(":").map((w) => w.trim());
const UNVOLLSTAENDIG_RE = new RegExp(String.raw`^(?:Angaben\s*:\s*unvollst(?:ae|ä)ndig|${UNVOLLSTAENDIG_EN_KOPF}\s*:\s*${UNVOLLSTAENDIG_EN_WERT})`, "i");

// Der Reviewer-Kopf, wie /issue-review Schritt 5 ihn schreibt:
// '### Reviewer <n>: <rolle>, <modell>'. Die Rolle ist der Teil vor dem Komma; das
// Modell dahinter wird bewusst nicht gelesen — keine Spalte traegt es (E15).
// Der Kopf bis zum Doppelpunkt: das Wort, dann die Nummer. Die beiden Laeufe darin
// akzeptieren Verschiedenes und koennen einander darum nicht in die Quere kommen.
const REVIEWER_KOPF_RE = /^Reviewer[^\S\n]+\d+$/;

/**
 * Die Rolle aus einem Reviewer-Kopf — `null`, wenn die Zeile keiner ist.
 *
 * In zwei Schritten statt in einem Ausdruck (S8786, Issue #877): In
 * `^Reviewer\s+\d+\s*:\s*([^,]+),` ueberlappten sich `\s*` und `[^,]+` hinter dem
 * Doppelpunkt — ein Leerzeichen ist kein Komma —, sodass eine Zeile ohne Komma jede
 * Aufteilung durchprobierte.
 */
export function reviewerRolle(zeile) {
  const trenner = zeile.indexOf(":");
  if (trenner === -1) return null;
  if (!REVIEWER_KOPF_RE.test(zeile.slice(0, trenner).trimEnd())) return null;
  const rest = zeile.slice(trenner + 1);
  const komma = rest.indexOf(",");
  return komma === -1 ? null : rest.slice(0, komma).trim();
}

// Der englische Uebernahmevermerk aus dem Register (Issue #1568): Kopf und die beiden Werte.
const zerlegt = (zeile) => zeile.split(":").map((w) => w.trim());
const UEBERNAHME_EN = {
  kopf: zerlegt(FUNDBLOCK.uebernommen.en)[0],
  uebernommen: zerlegt(FUNDBLOCK.uebernommen.en)[1].toLowerCase(),
  abgelehnt: zerlegt(FUNDBLOCK.abgelehnt.en)[1].toLowerCase(),
};

/** Der Uebernahmevermerk eines Funds, deutsch oder englisch: 'uebernommen', 'abgelehnt' oder null. */
function uebernahmeVon(fund) {
  for (const zeile of fund.zeilen) {
    const roh = angabenWert(zeile, "Uebernahme", "Übernahme", UEBERNAHME_EN.kopf);
    if (roh === null) continue;
    const wert = roh.replace(/^[\s*_]+/, "").toLowerCase();
    if (wert.startsWith("uebernommen") || wert.startsWith("übernommen") || wert.startsWith(UEBERNAHME_EN.uebernommen)) return "uebernommen";
    if (wert.startsWith("abgelehnt") || wert.startsWith(UEBERNAHME_EN.abgelehnt)) return "abgelehnt";
    return null;
  }
  return null;
}

/** Ob die Gegenprobe eines Funds den Stand 'geprueft, bestaetigt' traegt. */
function gegenprobeBestaetigt(fund) {
  const zeilen = [fund.titel, ...fund.zeilen];
  const gegenprobe = ersterAngabenWert(zeilen, ...GEGENPROBE_KOEPFE);
  if (gegenprobe === null) return false;
  return standVon(gegenprobe)?.bestaetigt === true;
}

/** Die Reviewer-Koepfe eines Texts mit ihrer Zeilennummer, in Textreihenfolge. */
function reviewerKoepfe(text) {
  const koepfe = [];
  for (const [i, zeile] of text.split("\n").entries()) {
    const rolle = reviewerRolle(kern(zeile));
    if (rolle !== null) koepfe.push({ zeile: i + 1, rolle });
  }
  return koepfe;
}

/** Die Rolle eines Funds: der letzte Reviewer-Kopf davor, sonst der Stufen-Fallback. */
function rolleFuer(fundZeile, koepfe, stufe) {
  let rolle = stufe === "code" ? "code-review" : "unbekannt";
  for (const kopf of koepfe) {
    if (kopf.zeile >= fundZeile) break;
    rolle = kopf.rolle;
  }
  return rolle;
}

/** Die vorhandenen Protokollzeilen; eine fehlende oder unlesbare Datei zaehlt als keine. */
function protokollZeilen(pfad) {
  try {
    return readFileSync(pfad, "utf-8").split(/\r?\n/).filter((z) => z !== "");
  } catch (err) {
    if (err.code !== "ENOENT") {
      aufStderr(`${t("protokollNichtLesbar", { pfad, grund: err.message })}\n`);
    }
    return [];
  }
}

/** Zaehlerstand je Art aus den Protokollzeilen (Spalte 5); fehlerhafte Zeilen zaehlen nicht. */
function zaehleArten(zeilen) {
  const zaehler = new Map();
  for (const zeile of zeilen) {
    const spalten = zeile.split("\t");
    if (spalten.length < 7) continue;
    zaehler.set(spalten[4], (zaehler.get(spalten[4]) ?? 0) + 1);
  }
  return zaehler;
}

/**
 * Die Schwelle aus `.claude/workflow.config.json`, Block `befunde` (Issue #800).
 * Teamweit und ohne persoenliche Abweichung — die local-Datei wird darum gar nicht
 * erst gelesen. Fehlt der Block, das Feld oder die Datei, gilt die Vorgabe; ein
 * unbrauchbarer Wert ebenso, die Konfigurationspruefung der Einstellungen meldet ihn.
 */
function schwelleLesen() {
  try {
    const { config } = normalisiereConfig(JSON.parse(readFileSync(join(wurzel(), ...CONFIG_DATEI.split("/")), "utf-8")));
    const wert = config?.befunde?.schwelle;
    if (Number.isInteger(wert) && wert > 0) return wert;
  } catch { /* keine Config ist ein normaler Zustand — Vorgabe. */ }
  return SCHWELLE_VORGABE;
}

/**
 * Der Nullpunkt je Art aus `.claude/befunde-vorschlaege.json` (Plan #797, E11):
 * Eine Ablehnung setzt ihn auf den damaligen Zaehlerstand, und erst oberhalb davon
 * zaehlt die Schwelle wieder. Fehlt die Datei, die Art oder das Feld, ist er null.
 */
function nullpunktFuer(art) {
  try {
    const daten = JSON.parse(readFileSync(join(wurzel(), ...VORSCHLAEGE_DATEI.split("/")), "utf-8"));
    const wert = daten?.[art]?.nullpunkt;
    if (Number.isInteger(wert) && wert >= 0) return wert;
  } catch { /* keine Vorschlagsdatei ist der Regelfall — Nullpunkt null. */ }
  return 0;
}

function gitLauf(...args) {
  const optionen = { cwd: wurzel(), encoding: "utf-8" };
  return umgebung.git ? umgebung.git(args, optionen) : spawnSync("git", args, optionen);
}

/**
 * Ob das Arbeitsverzeichnis ein VERKNUEPFTER git-Worktree ist (Issue #1028): Nur dort
 * unterscheiden sich `--git-dir` und `--git-common-dir`. Ausserhalb eines Repos ist es
 * keiner — dann gilt das Verhalten der Hauptkopie.
 */
function imVerknuepftenWorktree() {
  const res = gitLauf("rev-parse", "--git-dir", "--git-common-dir");
  if (res.status !== 0) return false;
  const [gitDir, commonDir] = res.stdout.split("\n").map((z) => z.trim());
  if (!gitDir || !commonDir) return false;
  return resolve(wurzel(), gitDir) !== resolve(wurzel(), commonDir);
}

/**
 * Was heute — zum Zeitpunkt der Buchung — gegenueber der Basis des Prueflaufs
 * geaendert ist. Die Richtung ist die des Commit-Gates (gate-1): Gedeckt sein muss
 * der heutige Stand, nicht der von damals; eine nach dem Lauf erstmals geaenderte
 * Datei stuende in `hashes` gar nicht und muss hier auftauchen, um durchzufallen.
 *
 * SYNC: der Nachbau von `geaenderteDateien`/`diffPfade`/`untracktePfade` in
 * kit/checks.mjs — Aenderungen dort nachziehen. Nur `blobHashes` ist exportiert
 * (checks-8); die Aenderungsermittlung wird nach dem Muster #440 dupliziert und
 * hier markiert, statt die Schnittstelle des Nachbarn weiter zu verbreitern.
 */
/** Die Pfade aus `git diff --name-status -z` — R- und C-Zeilen tragen zwei. */
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

function heuteGeaendert(basis) {
  if (typeof basis !== "string" || basis === "") fail(t("keineBasis"));
  const dateien = new Set();

  const diff = gitLauf("diff", "--name-status", "-z", basis);
  if (diff.status !== 0) fail(t("gitDiffFehl", { basis, grund: (diff.stderr || "").trim() }));
  for (const pfad of diffPfade(diff.stdout)) dateien.add(pfad);

  const status = gitLauf("status", "--porcelain", "-z", "--untracked-files=all");
  if (status.status !== 0) fail(t("gitStatusFehl", { grund: (status.stderr || "").trim() }));
  for (const eintrag of status.stdout.split("\0")) {
    if (eintrag.startsWith("?? ")) dateien.add(eintrag.slice(3));
  }

  return [...dateien]
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => !p.startsWith(WARTEND_PRAEFIX));
}

/**
 * Der Vergleichsstand der Code-Stufe (Plan #797, E12): `gruen`, wenn jeder Eintrag
 * unter `laufen` gruen ist, `leeresPaket` falsch ist und jede heute geaenderte Datei
 * einen Eintrag unter `hashes` mit passendem Hash hat — sonst `nicht-vergleichbar`,
 * auch bei fehlender oder unlesbarer Zusammenfassung. Eine AUSLASSUNG macht den
 * Stand nie unvergleichbar: W3 des Regeltextes zaehlt den unberuehrten Bereich zur
 * vollstaendigen Pflichtpruefung, und die faellige Stufe bestimmt den Umfang —
 * waere die Stufen-Auslassung ein Makel, gaelte jeder Code-Review vor dem Push als
 * unvergleichbar und AK 10 liefe leer.
 *
 * KEIN Textvergleich auf `grund` (E12, Fund W4 der Plan-Pruefung): `grund` ist in
 * checks.mjs freier Text und braeche bei jeder Umformulierung still; `leeresPaket`
 * ist dagegen ein Boolean der Zusammenfassung.
 *
 * Der Aufruf von `zusammenfassungPfad` steht VOR dem try: Sein werfender Ersatz
 * meldet den fehlenden Nachbarn als Fehler des Aufrufs — jeder Fehler DANACH ist
 * dagegen nur ein nicht vergleichbarer Stand, keine Abweisung.
 */
function vergleichsstandCode() {
  const pfad = zusammenfassungPfad(wurzel());
  let daten;
  try {
    daten = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    return NICHT_VERGLEICHBAR;
  }
  if (daten === null || typeof daten !== "object" || !Array.isArray(daten.laufen)
    || daten.hashes === null || typeof daten.hashes !== "object") return NICHT_VERGLEICHBAR;
  // Ausdruecklich `=== false`: Ein fehlendes Feld ist ein altes Format, kein Nein.
  if (daten.leeresPaket !== false) return NICHT_VERGLEICHBAR;
  if (daten.laufen.some((e) => e === null || typeof e !== "object" || e.ergebnis !== "gruen")) return NICHT_VERGLEICHBAR;
  try {
    const geaendert = heuteGeaendert(daten.basis);
    const aktuell = blobHashes(geaendert, wurzel());
    for (const p of geaendert) {
      if (!(p in daten.hashes) || daten.hashes[p] !== aktuell[p]) return NICHT_VERGLEICHBAR;
    }
  } catch {
    return NICHT_VERGLEICHBAR;
  }
  return "gruen";
}

/** Ein Spaltenwert des Protokolls — Tab und Zeilenumbruch koennen keine tragen. */
function spalte(wert) {
  return wert.replaceAll(/[\t\n\r]/g, " ").trim();
}

export function buchen({ datei, stufe, karte }) {
  let text;
  try {
    text = readFileSync(resolve(wurzel(), datei), "utf-8");
  } catch (err) {
    fail(t("dateiNichtLesbar", { pfad: datei, grund: err.code || err.message }));
  }

  // Vor dem Schreiben ermittelt: Ein fehlender Nachbar weist den Aufruf ab,
  // BEVOR eine Zeile entsteht.
  const vergleichsstand = stufe === "code" ? vergleichsstandCode() : "-";

  const koepfe = reviewerKoepfe(text);
  const buchbar = fundeLesen(text).flatMap((fund) => {
    const { fehlt, art } = fehlendeAngaben(fund);
    const zaehlt = fehlt.length === 0
      && gegenprobeBestaetigt(fund)
      && uebernahmeVon(fund) === "uebernommen"
      && !fund.zeilen.some((z) => UNVOLLSTAENDIG_RE.test(z));
    return zaehlt ? [{ fund, art }] : [];
  });

  const pfad = join(wurzel(), ...PROTOKOLL_DATEI.split("/"));
  const bestand = zaehleArten(protokollZeilen(pfad));

  const zeitpunkt = jetzt().toISOString();
  const zeilen = buchbar.map(({ fund, art }) => [
    zeitpunkt, spalte(stufe), spalte(karte),
    spalte(rolleFuer(fund.zeile, koepfe, stufe)),
    spalte(art), fund.marke, vergleichsstand,
  ].join("\t"));

  // Anhaengend, nie leerend (E7) — und im Leerfall gar nicht erst angelegt. Ein
  // gescheitertes Schreiben bleibt ein Hinweis auf stderr, der die Ausgabe nicht
  // veraendert: Das Protokoll ist Buchhaltung, keine Bedingung (Muster checks-7).
  if (zeilen.length > 0) {
    try {
      mkdirSync(dirname(pfad), { recursive: true });
      appendFileSync(pfad, zeilen.map((z) => `${z}\n`).join(""), "utf-8");
    } catch (err) {
      aufStderr(`${t("buchungNichtProtokolliert", { pfad, grund: err.message })}\n`);
    }
  }

  const beruehrt = new Map();
  for (const { art } of buchbar) {
    beruehrt.set(art, (beruehrt.get(art) ?? 0) + 1);
  }

  const schwelle = schwelleLesen();
  return {
    ok: true,
    datei,
    stufe,
    karte,
    vergleichsstand,
    geschrieben: zeilen.length,
    protokoll: PROTOKOLL_DATEI,
    schwelle,
    arten: [...beruehrt.keys()].sort(vergleicheText).map((art) => {
      const stand = (bestand.get(art) ?? 0) + beruehrt.get(art);
      const nullpunkt = nullpunktFuer(art);
      // `>=` oberhalb des Nullpunkts (E20), nicht `==`: Ein uebersprungener Stand
      // verloere den Treffer sonst dauerhaft. `vorschlag` sagt den aufrufenden Skills,
      // ob an der Schwelle ueberhaupt ein Vorschlag folgt (Issue #1182).
      return { art, stand, nullpunkt, erreicht: stand - nullpunkt >= schwelle, vorschlag: erzeugtVorschlag(art) };
    }),
  };
}

// --- Vorschlag (Issue #804) --------------------------------------------------

/**
 * Der Schluessel des Satzes, der in jeder Idee und jeder Ergaenzung steht (AK 8 der
 * fachlichen Quelle #768). Er ist die Leitplanke gegen den naheliegenden Kurzschluss, eine Art sei eine
 * Pruefung: Drei Funde der Art `luecke` koennen drei verschiedene Luecken sein.
 */
const STREUUNG_SATZ = "streuung";

/**
 * Die Autorschaft der Idee. Kein Modellname, denn keines hat sie geschrieben: Der Body
 * entsteht aus Protokollzeilen, ohne dass ein Modell den Text erzeugt. Die
 * Autor-Modell-Leitplanke in board.mjs (Issue #266) verlangt eine Zeile; eine erfundene
 * Modellangabe waere eine gefaelschte Autorschaft, der Werkzeugname ist die wahre.
 */
const AUTOR = "kit/findings.mjs";

/** Der Titel der Idee zu einer Art; `sonstiges` fragt nach der Liste, nicht nach einer Pruefung. */
function vorschlagTitel(art) {
  return ARTEN.find((a) => a.name === art)?.vorschlag === "liste"
    ? t("titelListe", { praefix: ideePraefix() })
    : t("titelPruefung", { praefix: ideePraefix(), art });
}

/** Die Vorkommen einer Art aus den Protokollzeilen, in Protokollreihenfolge. */
function vorkommenFuer(zeilen, art) {
  const treffer = [];
  for (const zeile of zeilen) {
    const s = zeile.split("\t");
    if (s.length < 7 || s[4] !== art) continue;
    treffer.push({ zeitpunkt: s[0], stufe: s[1], karte: s[2], rolle: s[3], schweregrad: s[5] });
  }
  return treffer;
}

/** Die Vorkommen als Markdown-Tabelle — je Zeile ein Fund mit seinen fuenf Angaben. */
function vorkommenTabelle(vorkommen) {
  return [
    t("tabelleKopf"),
    "| --- | --- | --- | --- | --- |",
    ...vorkommen.map((v) => `| ${v.zeitpunkt} | ${v.stufe} | ${v.karte} | ${v.rolle} | ${v.schweregrad} |`),
  ].join("\n");
}

/**
 * Der Body der Idee. Die zugrunde liegenden Funde sind die OBERHALB des Nullpunkts:
 * Was vor einer Ablehnung lag, hat der Mensch bereits gesehen und verworfen — es noch
 * einmal aufzuzaehlen truege die abgeraeumte Frage zurueck in die neue Idee.
 */
function ideeBody(art, vorkommen, { zaehlerstand, nullpunkt, schwelle }) {
  const frage = ARTEN.find((a) => a.name === art)?.vorschlag === "liste"
    ? t("frageListe", { schwelle })
    : t("fragePruefung", { art, schwelle });
  return [
    t("ideeKontext"),
    "",
    t("ideeAutor", { autor: AUTOR }),
    "",
    frage,
    "",
    t("ideeStand", { protokoll: PROTOKOLL_DATEI, zaehlerstand, nullpunkt, schwelle }),
    "",
    t("ideeBeobachtung"),
    "",
    t(STREUUNG_SATZ),
    "",
    t("ideeFundeKopf"),
    "",
    vorkommenTabelle(vorkommen),
    "",
    t("ideeWegKopf"),
    "",
    t("ideeWeg", { art }),
    "",
  ].join("\n");
}

/** Der Kommentar, mit dem ein offener Vorschlag um die seither gebuchten Funde waechst. */
function ergaenzungText(art, neue, { zaehlerstand, vorher }) {
  return [
    t("ergaenzungKopf", { art }),
    "",
    t("ergaenzungStand", { vorher, neu: neue.length, zaehlerstand }),
    "",
    vorkommenTabelle(neue),
    "",
    t(STREUUNG_SATZ),
    "",
  ].join("\n");
}

/** Die Antwort von `boardLauf`, wenn der Adapter die genannte Karte nicht aufloest. */
const KARTE_FEHLT = Symbol("karte-fehlt");

// Die Meldung, mit der der lokale und der Toolbox-Tracker eine fehlende Karte melden, in
// beiden Sprachen des Adapters — gelesen, nicht geschrieben, darum Vertrag (E14).
const KARTE_FEHLT_MELDUNG = "(?:nicht gefunden|not found)";

/**
 * Ruft den Board-Adapter und liefert seine JSON-Antwort; jeder Fehlschlag wirft — bis
 * auf die nicht gefundene Karte, nach der der Aufrufer mit `karte` ausdruecklich fragt.
 *
 * Werfend und nicht meldend, weil der Aufrufer danach die Zustandsdatei schreibt: Ein
 * Fehlschlag, der als Wert zurueckkaeme, muesste an jeder Aufrufstelle einzeln
 * abgefangen werden — und die eine vergessene Stelle hinterliesse einen Vermerk ohne
 * Karte (die Zusage aus der Aufgabe: kein halb vermerkter Vorschlag).
 */
function boardStarten(args) {
  if (!existsSync(BOARD_PATH)) fail(t("boardFehlt", { pfad: BOARD_PATH }));
  return spawnSync(process.execPath, [BOARD_PATH, ...args], { cwd: wurzel(), encoding: "utf-8" });
}

function boardLauf(args, { karte = null } = {}) {
  const res = umgebung.board ? umgebung.board(args, { cwd: wurzel() }) : boardStarten(args);
  if (res.error) fail(t("boardStartFehl", { grund: res.error.message }));
  if (res.status !== 0) {
    const grund = (res.stderr || res.stdout || "").trim().split(/\r?\n/)[0] || `Exit ${res.status}`;
    // Die eine Ausnahme vom Werfen (Issue #1100): Wer eine `karte` nennt, bekommt deren
    // Fehlen als Wert zurueck. Erkannt wird allein die Meldung, die der lokale und der
    // Toolbox-Tracker dafuer liefern — ein Netz- oder Zugangsfehler wirft weiter.
    if (karte !== null && new RegExp(`\\bIssue #?${karte} ${KARTE_FEHLT_MELDUNG}\\b`).test(grund)) return KARTE_FEHLT;
    fail(t("boardFehl", { befehl: args.slice(0, 2).join(" "), grund }));
  }
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    fail(t("boardKeinJson", { befehl: args.slice(0, 2).join(" "), grund: err.message }));
  }
}

/**
 * Fuehrt `fn` mit dem Pfad einer Datei aus, die den Text traegt, und raeumt sie danach weg.
 *
 * AUSSERHALB des Projektverzeichnisses (Issue #270, #584): Der Nacht-Runner stoppt hart,
 * wenn eine erfolgreiche Runde unkommittete Reste hinterlaesst — eine Hilfsdatei im
 * Arbeitsbaum waere genau so ein Rest. Und als Datei statt als Argument, weil ein Body
 * mit dreissig Fundzeilen jede Kommandozeilen-Grenze reisst.
 */
function mitTextdatei(name, text, fn) {
  const dir = mkdtempSync(join(tmpdir(), "kit-befunde-"));
  try {
    const pfad = join(dir, name);
    writeFileSync(pfad, text, "utf-8");
    return fn(pfad);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Der Pfad der Zustandsdatei im aktuellen Projekt. */
function vorschlaegePfad() {
  return join(wurzel(), ...VORSCHLAEGE_DATEI.split("/"));
}

/**
 * Die vermerkten Vorschlaege. Eine fehlende Datei ist der Regelfall und liefert `{}`;
 * eine UNLESBARE wirft dagegen. Sie stillschweigend als leer zu behandeln hiesse, sie
 * beim naechsten Schreiben zu ueberschreiben — mit ihr gingen die Nullpunkte aller
 * anderen Arten verloren, und abgelehnte Vorschlaege kaemen von selbst wieder.
 */
function vorschlaegeLesen() {
  let roh;
  try {
    roh = readFileSync(vorschlaegePfad(), "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    return fail(t("zustandNichtLesbar", { datei: VORSCHLAEGE_DATEI, grund: err.code || err.message }));
  }
  let daten;
  try {
    daten = JSON.parse(roh);
  } catch (err) {
    return fail(t("zustandKaputt", { datei: VORSCHLAEGE_DATEI, grund: err.message }));
  }
  if (daten === null || typeof daten !== "object" || Array.isArray(daten)) {
    return fail(t("zustandKeinObjekt", { datei: VORSCHLAEGE_DATEI }));
  }
  return daten;
}

function vorschlaegeSchreiben(daten) {
  const pfad = vorschlaegePfad();
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, `${JSON.stringify(daten, null, 2)}\n`, "utf-8");
}

/** Der vermerkte Eintrag einer Art in seiner vollen Form; fehlende Felder gefuellt. */
function eintragVon(daten, art) {
  const roh = daten[art];
  if (roh === null || typeof roh !== "object") return null;
  return {
    karte: typeof roh.karte === "string" ? roh.karte : null,
    ideaId: typeof roh.ideaId === "string" ? roh.ideaId : null,
    stand: roh.stand === "abgelehnt" || roh.stand === "erledigt" ? roh.stand : "offen",
    zaehlerstand: Number.isInteger(roh.zaehlerstand) ? roh.zaehlerstand : 0,
    nullpunkt: Number.isInteger(roh.nullpunkt) && roh.nullpunkt >= 0 ? roh.nullpunkt : 0,
  };
}

/** Die Kennung, die `issue create` geliefert hat — Nummer oder Pool-Idee (board.mjs Z. 1499). */
function kennungVon(antwort) {
  const karte = antwort?.id == null ? null : String(antwort.id);
  const ideaId = antwort?.ideaId == null ? null : String(antwort.ideaId);
  if (karte === null && ideaId === null) {
    fail(t("kennungFehlt", { antwort: JSON.stringify(antwort) }));
  }
  return { karte, ideaId };
}

/**
 * Legt den Vorschlag an oder ergaenzt ihn (`--art`), beziehungsweise vermerkt seine
 * Ablehnung (`--abgelehnt`).
 *
 * DIE REIHENFOLGE IST DIE ZUSAGE: erst lesen, dann das Board rufen, erst danach
 * schreiben. Scheitert der Board-Aufruf, wirft `boardLauf` — die Zustandsdatei ist zu
 * diesem Zeitpunkt noch unberuehrt, und es entsteht kein Vermerk ohne Karte.
 */
export function vorschlag({ art, abgelehnt }) {
  const zielArt = art ?? abgelehnt;
  // Eine Urteils-Art stellt keine Frage (Issue #1182) — weder neu noch als Ergaenzung
  // eines frueher vermerkten Vorschlags. Kein Fehler: Die aufrufenden Skills rufen
  // `vorschlag` je Art an der Schwelle, und ein Exit ungleich 0 waere ein Fehlschlag,
  // den es nicht gibt. `--abgelehnt` bleibt erlaubt, es setzt nur einen Nullpunkt.
  if (art !== null && !erzeugtVorschlag(art)) {
    return {
      ok: true, art, vorschlag: false, angelegt: false, ergaenzt: false,
      grund: t("grundUrteilsArt", { art }),
    };
  }
  // Im Worktree eines Laufs wird nur gebucht (Issue #1028): Dort fehlen Protokoll und
  // Vorschlagsregister der Hauptkopie absichtlich, ein Vorschlag saehe ein leeres Register
  // und doppelte einen offenen. Den Vorschlag macht der Runner beim Abbau in der Hauptkopie.
  if (imVerknuepftenWorktree()) {
    if (abgelehnt !== null) {
      fail(t("abgelehntImWorktree"));
    }
    return {
      ok: true, art: zielArt, angelegt: false, ergaenzt: false,
      grund: t("grundWorktree"),
    };
  }
  const daten = vorschlaegeLesen();
  const alt = eintragVon(daten, zielArt);
  const zeilen = protokollZeilen(join(wurzel(), ...PROTOKOLL_DATEI.split("/")));
  const vorkommen = vorkommenFuer(zeilen, zielArt);
  const zaehlerstand = vorkommen.length;

  if (abgelehnt !== null) {
    // Ein Handgriff ohne Board-Aufruf (Plan #797, E11): Ob eine Idee als abgelehnt
    // gilt, laesst sich am Board nicht je Tracker gleich erkennen — `github` und
    // `gitlab` kennen den Ideen-Pool gar nicht. Auch ohne vermerkten Vorschlag wird der
    // Nullpunkt gesetzt: Wer ablehnt, will ab hier Ruhe, nicht eine Fehlermeldung.
    const eintrag = {
      karte: alt?.karte ?? null,
      ideaId: alt?.ideaId ?? null,
      stand: "abgelehnt",
      zaehlerstand: alt?.zaehlerstand ?? zaehlerstand,
      nullpunkt: zaehlerstand,
    };
    vorschlaegeSchreiben({ ...daten, [zielArt]: eintrag });
    return { ok: true, art: zielArt, ...eintrag, vorschlaege: VORSCHLAEGE_DATEI };
  }

  const nullpunkt = alt?.nullpunkt ?? 0;
  const schwelle = schwelleLesen();
  const erreicht = zaehlerstand - nullpunkt >= schwelle;
  const basis = {
    ok: true, art: zielArt, zaehlerstand, nullpunkt, schwelle, erreicht,
    angelegt: false, ergaenzt: false,
    karte: alt?.karte ?? null, ideaId: alt?.ideaId ?? null,
    vorschlaege: VORSCHLAEGE_DATEI,
  };

  if (!erreicht) {
    // Kein Fehler, sondern der Normalfall zwischen zwei Schwellentreffern.
    return { ...basis, grund: t("grundUnterSchwelle", { zaehlerstand, nullpunkt, schwelle }) };
  }

  if (alt !== null && alt.stand === "offen") {
    if (alt.karte === null) {
      // Eine Pool-Idee traegt nur eine `ideaId` und keine adressierbare Nummer — bis ein
      // Mensch sie einplant, laesst sie sich nicht kommentieren. Gemeldet statt gedoppelt:
      // Eine zweite Idee waere genau das, was AK 8 ausschliesst.
      return { ...basis, grund: t("grundPoolIdee", { idee: alt.ideaId }) };
    }
    const neue = vorkommen.slice(alt.zaehlerstand);
    const text = ergaenzungText(zielArt, neue, { zaehlerstand, vorher: alt.zaehlerstand });
    const antwort = mitTextdatei(`${zielArt}-ergaenzung.md`, text, (pfad) =>
      boardLauf(["issue", "comment", alt.karte, "--text-file", pfad], { karte: alt.karte }));
    if (antwort !== KARTE_FEHLT) {
      vorschlaegeSchreiben({ ...daten, [zielArt]: { ...alt, zaehlerstand } });
      return { ...basis, ergaenzt: true, zaehlerstand };
    }
    // Die vermerkte Karte ist am Board nicht mehr adressierbar (Issue #1100) — erledigt
    // oder entfernt. Der Vorschlag gilt als erledigt, und sein Stand wird der neue
    // Nullpunkt: Die alte Karte hat die frueheren Funde schon getragen, eine neue Idee
    // wiederholte sie nur.
    const neuerNullpunkt = alt.zaehlerstand;
    if (zaehlerstand - neuerNullpunkt < schwelle) {
      vorschlaegeSchreiben({ ...daten, [zielArt]: { ...alt, stand: "erledigt", nullpunkt: neuerNullpunkt } });
      return {
        ...basis, erreicht: false, nullpunkt: neuerNullpunkt,
        grund: t("grundKarteErledigt", { karte: alt.karte, zaehlerstand, nullpunkt: neuerNullpunkt, schwelle }),
      };
    }
    return ideeAnlegen({ daten, art: zielArt, vorkommen, nullpunkt: neuerNullpunkt, schwelle, basis });
  }

  // Neu — entweder gab es nie einen Vorschlag, oder der abgelehnte oder erledigte hat
  // oberhalb seines Nullpunkts erneut die Schwelle erreicht.
  return ideeAnlegen({ daten, art: zielArt, vorkommen, nullpunkt, schwelle, basis });
}

/**
 * Legt die Idee am Board an und vermerkt sie danach als offen. Der Nullpunkt BLEIBT
 * stehen: Er ist die Grenze, ab der gezaehlt wird, und nicht der Stand dieser Anlage.
 */
function ideeAnlegen({ daten, art, vorkommen, nullpunkt, schwelle, basis }) {
  const zaehlerstand = vorkommen.length;
  const titel = vorschlagTitel(art);
  const body = ideeBody(art, vorkommen.slice(nullpunkt), { zaehlerstand, nullpunkt, schwelle });
  const antwort = mitTextdatei(`${art}-idee.md`, body, (pfad) =>
    boardLauf(["issue", "create", "--title", titel, "--body-file", pfad, "--author-model", AUTOR]));
  const { karte, ideaId } = kennungVon(antwort);
  const eintrag = { karte, ideaId, stand: "offen", zaehlerstand, nullpunkt };
  vorschlaegeSchreiben({ ...daten, [art]: eintrag });
  return { ...basis, nullpunkt, angelegt: true, titel, karte, ideaId };
}

// --- Auswerten und Befund (Issue #806) ---------------------------------------

/**
 * Die Protokollzeilen als Datensaetze.
 *
 * Eine zu kurze Zeile wird GEZAEHLT und nicht gedeutet — dieselbe Linie wie in
 * `zaehleArten`: Eine Zeile, deren Spalten nicht aufgehen, ist keine halbe Buchung,
 * und ein stillschweigend ergaenztes Feld erfaende eine Angabe, die nie gebucht wurde.
 */
function protokollLesen(zeilen) {
  const eintraege = [];
  let fehlerhafteZeilen = 0;
  for (const zeile of zeilen) {
    const s = zeile.split("\t");
    if (s.length < 7) {
      fehlerhafteZeilen += 1;
      continue;
    }
    eintraege.push({ zeitpunkt: s[0], stufe: s[1], karte: s[2], rolle: s[3], art: s[4], schweregrad: s[5], vergleichsstand: s[6] });
  }
  return { eintraege, fehlerhafteZeilen };
}

/**
 * Die Arten des Berichts: die zwoelf der Liste in ihrer festen Reihenfolge, dahinter
 * jede im Protokoll vorgefundene fremde Art.
 *
 * Alle zwoelf, auch mit null Vorkommen (die Zusage „beide Dateien entstehen
 * vollstaendig"): Ein Bericht, der nur die getroffenen Arten fuehrt, saehe bei einer
 * Art genauso aus wie ein Bericht ueber die ganze Liste. Und die fremde Art wird
 * angehaengt statt verschluckt — sie kann nur aus einer aelteren oder fremden Buchung
 * stammen, und wegzulassen hiesse, ein Vorkommen verschwinden zu lassen.
 */
function artenReihenfolge(eintraege) {
  const fremde = [...new Set(eintraege.map((e) => e.art).filter((a) => !ARTEN_NAMEN.has(a)))].sort(vergleicheText);
  return [...ARTEN.map((a) => a.name), ...fremde];
}

/** Die Verteilung der Eintraege ueber die Stufen; die vier bekannten stehen immer da. */
function stufenVerteilung(eintraege) {
  const verteilung = Object.fromEntries(BUCHEN_STUFEN.map((s) => [s, 0]));
  for (const e of eintraege) {
    verteilung[e.stufe] = (verteilung[e.stufe] ?? 0) + 1;
  }
  return verteilung;
}

/**
 * Der Vorschlag als ein Satzteil: Stand und, wenn vorhanden, wo er liegt. Eine
 * Urteils-Art traegt keinen (Issue #1182) — auch dann nicht, wenn aus der Zeit davor
 * noch ein offener vermerkt ist: Den ergaenzt `vorschlag` nicht mehr.
 */
function vorschlagText(art, vorschlag) {
  if (ARTEN.find((a) => a.name === art)?.vorschlag === null) return t("vorschlagUrteilsArt");
  if (vorschlag === null) return t("vorschlagKeiner");
  // Der Stand ist im Stand ein Vertragswert (E14); angezeigt wird sein Wort in der Sprache.
  const stand = t(`stand_${vorschlag.stand}`);
  if (vorschlag.karte !== null) return t("vorschlagKarte", { stand, karte: vorschlag.karte });
  if (vorschlag.ideaId !== null) return t("vorschlagIdee", { stand, idee: vorschlag.ideaId });
  return t("vorschlagStand", { stand });
}

/** Die Stufenverteilung als Aufzaehlung der getroffenen Stufen. */
function stufenText(stufen) {
  const teile = Object.entries(stufen).filter(([, n]) => n > 0).map(([s, n]) => `${s} ${n}`);
  return teile.length === 0 ? "" : ` (${teile.join(", ")})`;
}

/**
 * Die Zaehlung der Code-Stufe, GETRENNT nach Vergleichsstand (AK 10 der Quelle #768).
 *
 * Zwei Zahlen und ausdruecklich nicht ihre Summe: Ein Fund auf einem Stand, dessen
 * Pflichtpruefungen gruen waren, sagt etwas ueber die Luecke der Maschine — ein Fund
 * ohne vergleichbaren Stand sagt darueber nichts. Zusammengezaehlt saehen beide aus
 * wie das erste.
 *
 * Dieselbe Funktion je Art und ueber alle: AK 10 verlangt die Zahl „getrennt nach Art",
 * und der Gesamtstand ist die Summe derselben Zaehlung ueber alle Eintraege. Eine
 * zweite Zaehlweise fuer die Gesamtzahl koennte von der Summe ihrer Teile abweichen.
 */
function codeZaehlung(eintraege) {
  const code = eintraege.filter((e) => e.stufe === "code");
  return {
    gruen: code.filter((e) => e.vergleichsstand === "gruen").length,
    nichtVergleichbar: code.filter((e) => e.vergleichsstand === NICHT_VERGLEICHBAR).length,
  };
}

/** Der Berichtstext fuer Menschen — `.claude/befunde.md`. */
function berichtText(stand) {
  const kopfzeilen = [
    t("berichtTitel"),
    "",
    t("berichtAuswertung", { am: stand.erzeugtAm, version: stand.kitVersion }),
    "",
    stand.protokoll.vorhanden
      ? t("berichtProtokoll", { datei: stand.protokoll.datei, zeilen: stand.protokoll.zeilen, fehlerhaft: stand.protokoll.fehlerhafteZeilen })
      : t("berichtOhneProtokoll", { datei: stand.protokoll.datei }),
    "",
    t("berichtSchwelle", { schwelle: stand.schwelle }),
    "",
    t("artenTitel"),
    "",
    t("artenKopf", { stufen: BUCHEN_STUFEN.join(" | ") }),
    `| --- | --- | ${BUCHEN_STUFEN.map(() => "---").join(" | ")} | --- | --- | --- | --- | --- |`,
    ...stand.arten.map((a) => [
      "", `\`${a.art}\``, a.vorkommen, ...BUCHEN_STUFEN.map((s) => a.stufen[s] ?? 0),
      a.code.gruen, a.code.nichtVergleichbar,
      a.ueberNullpunkt, t(a.erreicht ? "ja" : "nein"), vorschlagText(a.art, a.vorschlag), "",
    ].join(" | ").trim()),
    "",
    t("codeTitel"),
    "",
    stand.code.gruen + stand.code.nichtVergleichbar === 0
      ? t("codeKeiner")
      : t("codeZeile", { gruen: stand.code.gruen, wert: NICHT_VERGLEICHBAR, anzahl: stand.code.nichtVergleichbar }),
    "",
    t("befundTitel"),
    "",
  ];
  const befundzeilen = stand.befund.length === 0
    ? [t("befundKeiner")]
    : stand.befund.map((b) => `- ${b.text}`);
  return [...kopfzeilen, ...befundzeilen, ""].join("\n");
}

/**
 * Der Befundblock als Text — mit Datum der Auswertung in der Kopfzeile.
 *
 * Ohne Befund eine LEERE Zeichenkette, nicht eine mit Kopfzeile: Die Kopfzeile allein
 * waere schon der beruhigende Satz, den das Schweigen bei Unauffaelligkeit ausschliesst
 * (dieselbe Zusage wie `befundText` in kit/effort.mjs und kit/effectiveness.mjs).
 */
export function befundText(stand) {
  const befund = Array.isArray(stand?.befund) ? stand.befund : [];
  if (befund.length === 0) return "";
  const arten = befund.filter((b) => b.art !== null).length;
  const vorkommen = befund.reduce((summe, b) => summe + (b.vorkommen ?? 0), 0);
  const kopf = t("befundKopf", {
    am: stand.erzeugtAm, vorkommen, arten, artenWort: t(arten === 1 ? "artEins" : "artMehr"), schwelle: stand.schwelle ?? "?",
  });
  return [kopf, ...befund.map((b) => `- ${b.text}`)].join("\n") + "\n";
}

/**
 * Der Befund: je Art mit mindestens einem Vorkommen eine Zeile, dahinter die Zeile
 * zur Code-Stufe, sobald dort etwas gebucht ist.
 *
 * Nicht erst ab der Schwelle (anders als beim Vorschlag): Im Protokoll steht nur, was
 * gegengeprueft, bestaetigt und uebernommen wurde — jede Zeile ist ein belegter
 * Mangel, den eine Maschine nicht gefunden hat. Die Schwelle steuert, wann daraus eine
 * Idee am Board wird, nicht, ab wann der Mensch die Zahl sehen darf.
 */
function befundBestimmen(arten, code, schwelle) {
  const befund = arten.filter((a) => a.vorkommen > 0).map((a) => {
    const schwellenteil = a.erreicht ? t("befundSchwellenteil", { schwelle }) : "";
    return {
      art: a.art,
      vorkommen: a.vorkommen,
      text: t("befundArt", {
        art: a.art, vorkommen: a.vorkommen, stufen: stufenText(a.stufen), schwellenteil, vorschlag: vorschlagText(a.art, a.vorschlag),
      }),
    };
  });
  if (befund.length > 0 && code.gruen + code.nichtVergleichbar > 0) {
    befund.push({
      art: null,
      vorkommen: 0,
      text: t("befundCode", { gruen: code.gruen, anzahl: code.nichtVergleichbar, wert: NICHT_VERGLEICHBAR }),
    });
  }
  return befund;
}

function schreibeDatei(datei, inhalt) {
  const pfad = join(wurzel(), ...datei.split("/"));
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, inhalt, "utf-8");
  } catch (err) {
    fail(t("nichtGeschrieben", { datei, grund: err.message }));
  }
}

/**
 * Die Auswertung. Rueckgabe ist der vollstaendige Stand — dieselbe Struktur, die nach
 * `.claude/befunde.json` geht und auf stdout steht: eine Form, nicht zwei.
 */
export function auswerten() {
  const protokollPfad = join(wurzel(), ...PROTOKOLL_DATEI.split("/"));
  const zeilen = protokollZeilen(protokollPfad);
  const { eintraege, fehlerhafteZeilen } = protokollLesen(zeilen);
  const vorschlaege = vorschlaegeLesen();
  const schwelle = schwelleLesen();

  const arten = artenReihenfolge(eintraege).map((art) => {
    const eigene = eintraege.filter((e) => e.art === art);
    // Aus demselben Eintrag wie der Nullpunkt, nicht ueber `nullpunktFuer`: Der liest
    // die Zustandsdatei bei jedem Aufruf neu, und hier ist sie schon gelesen.
    const eintrag = eintragVon(vorschlaege, art);
    const nullpunkt = eintrag?.nullpunkt ?? 0;
    const vorschlag = eintrag === null ? null : { stand: eintrag.stand, karte: eintrag.karte, ideaId: eintrag.ideaId };
    const ueberNullpunkt = Math.max(0, eigene.length - nullpunkt);
    return {
      art,
      vorkommen: eigene.length,
      stufen: stufenVerteilung(eigene),
      // Je Art, nicht nur ueber alle: AK 10 der Quelle #768 verlangt die Zahl der
      // uebernommenen Code-Funde auf gruenem Stand „getrennt nach Art" — eine
      // Gesamtzahl sagte nicht, welcher Mangel der Maschine entgeht.
      code: codeZaehlung(eigene),
      nullpunkt,
      ueberNullpunkt,
      erreicht: ueberNullpunkt >= schwelle,
      vorschlag,
    };
  });
  const code = codeZaehlung(eintraege);

  const ergebnis = {
    ok: true,
    erzeugtAm: jetzt().toISOString(),
    kitVersion: KIT_VERSION,
    protokoll: {
      datei: PROTOKOLL_DATEI,
      vorhanden: existsSync(protokollPfad),
      zeilen: zeilen.length,
      fehlerhafteZeilen,
    },
    schwelle,
    arten,
    code,
    // Immer gesetzt, auch leer: Eine neuere Auswertung ohne Befund loescht damit den
    // alten Stand — ein ausgelassenes Feld liesse den Befund von gestern stehen.
    befund: befundBestimmen(arten, code, schwelle),
    bericht: BERICHT_DATEI,
  };

  schreibeDatei(BERICHT_DATEI, berichtText(ergebnis));
  schreibeDatei(STAND_DATEI, JSON.stringify(ergebnis, null, 2) + "\n");
  return ergebnis;
}

/**
 * Der Befund als Text. Nie ein Fehler: Eine fehlende, leere oder unlesbare Datei ist
 * dasselbe wie kein Befund — es soll dann nichts dastehen und nichts aufgehalten
 * werden. Das gilt ausdruecklich auch fuer ein Projekt ohne Modell-Pruefungen (AK 12
 * der Quelle #768): Ohne Protokoll entsteht kein Befund, und niemand muss dafuer einen
 * Schalter umlegen.
 */
export function befund() {
  try {
    return befundText(JSON.parse(readFileSync(join(wurzel(), ...STAND_DATEI.split("/")), "utf-8")));
  } catch {
    return "";
  }
}

// --- CLI ---------------------------------------------------------------------

/**
 * Die frueheren deutschen Namen der Befehle, Optionen und Stufenwerte, je Eintrag deutsch ->
 * englisch (Issue #1559, Plan #1548 E5). Seit Version 5 nimmt findings.mjs nur die englischen
 * an; diese Tabellen dienen allein der Meldung, die einen deutschen Namen abweist und den
 * englischen nennt — zum Ausfuehren werden sie nie benutzt.
 */
const ALTE_BEFEHLE = Object.freeze({
  arten: "kinds",
  pruefen: "check",
  buchen: "record",
  vorschlag: "suggest",
  auswerten: "evaluate",
  befund: "finding",
});
const ALTE_OPTIONEN = Object.freeze({
  "--datei": "--file",
  "--stufe": "--stage",
  "--karte": "--card",
  "--art": "--kind",
  "--abgelehnt": "--rejected",
});
const ALTE_STUFEN = Object.freeze({ fachlich: "requirement" });

/** Der englische Wert von `--stage` zur internen Stufe (E5: `requirement` -> `fachlich`). */
function stufeEnglisch(stufe) {
  return Object.hasOwn(ALTE_STUFEN, stufe) ? ALTE_STUFEN[stufe] : stufe;
}

/** Wirft die Abweisung, wenn `name` ein frueherer deutscher Name aus `tabelle` ist. */
function altnameAbweisen(tabelle, name) {
  if (typeof name === "string" && Object.hasOwn(tabelle, name)) {
    fail(t("altname", { name, englisch: tabelle[name] }));
  }
}

function parsePruefenArgs(rest) {
  let datei = null;
  let i = 0;
  while (i < rest.length) {
    altnameAbweisen(ALTE_OPTIONEN, rest[i]);
    if (rest[i] !== "--file") fail(t("unbekanntesArgument", { arg: rest[i] }));
    datei = rest[i + 1];
    if (!datei) fail(t("dateiErwartet"));
    i += 2;  // Option und ihr Wert
  }
  if (datei === null) fail(t("pruefenBraucht"));
  return datei;
}

function parseBuchenArgs(rest) {
  const werte = { datei: null, stufe: null, karte: null };
  const optionen = { "--file": "datei", "--stage": "stufe", "--card": "karte" };
  let i = 0;
  while (i < rest.length) {
    altnameAbweisen(ALTE_OPTIONEN, rest[i]);
    const feld = optionen[rest[i]];
    if (!feld) fail(t("unbekanntesArgument", { arg: rest[i] }));
    werte[feld] = rest[i + 1];
    if (!werte[feld]) fail(t("optionWert", { option: rest[i] }));
    i += 2;  // Option und ihr Wert
  }
  if (werte.datei === null || werte.stufe === null || werte.karte === null) {
    fail(t("buchenBraucht"));
  }
  // Getippt wird der englische Wert, gebucht die interne Stufe (E5).
  altnameAbweisen(ALTE_STUFEN, werte.stufe);
  const stufe = BUCHEN_STUFEN.find((s) => stufeEnglisch(s) === werte.stufe);
  if (stufe === undefined) {
    fail(t("unbekannteStufe", { stufe: werte.stufe, stufen: BUCHEN_STUFEN.map(stufeEnglisch).join(", ") }));
  }
  return { ...werte, stufe };
}

function parseVorschlagArgs(rest) {
  const werte = { art: null, abgelehnt: null };
  const optionen = { "--kind": "art", "--rejected": "abgelehnt" };
  let i = 0;
  while (i < rest.length) {
    altnameAbweisen(ALTE_OPTIONEN, rest[i]);
    const feld = optionen[rest[i]];
    if (!feld) fail(t("unbekanntesArgument", { arg: rest[i] }));
    werte[feld] = rest[i + 1];
    if (!werte[feld]) fail(t("optionArt", { option: rest[i] }));
    i += 2;  // Option und ihr Wert
  }
  // Beide zugleich sind zwei gegenlaeufige Auftraege; welcher gewinnt, waere geraten.
  if (werte.art !== null && werte.abgelehnt !== null) {
    fail(t("vorschlagBeides"));
  }
  if (werte.art === null && werte.abgelehnt === null) {
    fail(t("vorschlagBraucht"));
  }
  const zielArt = werte.art ?? werte.abgelehnt;
  if (!ARTEN_NAMEN.has(zielArt)) {
    fail(t("unbekannteArt", { art: zielArt }));
  }
  return werte;
}

/** Immer JSON auf stdout — auch hier, wo der Aufruf abgewiesen wird. */
function alsJson(bauen) {
  try {
    aufStdout(JSON.stringify(bauen(), null, 2) + "\n");
    return 0;
  } catch (err) {
    aufStdout(JSON.stringify({ ok: false, fehler: err.message }, null, 2) + "\n");
    return 1;
  }
}

/** Der Fehler eines Aufrufs als stderr-Zeile: `Fehler:` fuer den erwarteten, sonst `Unerwarteter Fehler:`. */
function fehlerZeile(err) {
  const prefix = t(err instanceof BefundeError ? "fehler" : "unerwarteterFehler");
  return `${prefix}: ${err.message}\n`;
}

/**
 * Ein Aufruf wie von der Kommandozeile, aber im selben Prozess (Issue #1213, Plan #1199
 * E6). `argv` ist die Kommandozeile ohne `node findings.mjs`, `cwd` das Projekt, `jetzt`
 * die Uhr der Buchung und der Auswertung. `board(args, { cwd })` ersetzt den Start des
 * Board-Adapters, `git(args, optionen)` den von git — beide im Ergebnis wie `spawnSync`.
 *
 * Rueckgabe: `{ status, stdout, stderr }` wie bei einem Kindprozess. Zwei Aufrufe zugleich
 * gehen nicht — die Umgebung gilt fuer das ganze Modul —, der zweite bricht darum ab.
 */
export function aufrufen(argv, { cwd, jetzt: uhr, board, git } = {}) {
  if (umgebung.aktiv) throw new Error(t("aufrufLaeuft"));
  let stdout = "";
  let stderr = "";
  umgebung = {
    aktiv: true,
    cwd,
    jetzt: uhr,
    board,
    git,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  };
  let status;
  try {
    status = main(argv);
  } catch (err) {
    aufStderr(fehlerZeile(err));
    status = 1;
  } finally {
    umgebung = {};
  }
  return { status, stdout, stderr };
}

function main(argv) {
  // Die einzigen beiden Textausgaben: Beide richten sich an einen Menschen am Terminal,
  // nicht an einen Aufrufer.
  if (argv[0] === "--help" || argv[0] === "-h") {
    aufStdout(hilfe());
    return 0;
  }
  if (argv[0] === "--version") {
    aufStdout(`${KIT_VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  if (Object.hasOwn(ALTE_BEFEHLE, command)) {
    return alsJson(() => altnameAbweisen(ALTE_BEFEHLE, command));
  }
  if (command === "kinds") {
    return alsJson(() => {
      if (rest.length > 0) fail(t("artenOhneArgumente", { arg: rest[0] }));
      return arten();
    });
  }
  if (command === "check") {
    return alsJson(() => pruefen(parsePruefenArgs(rest)));
  }
  if (command === "record") {
    return alsJson(() => buchen(parseBuchenArgs(rest)));
  }
  if (command === "suggest") {
    return alsJson(() => vorschlag(parseVorschlagArgs(rest)));
  }
  if (command === "evaluate") {
    return alsJson(() => {
      if (rest.length > 0) fail(t("auswertenOhneArgumente", { arg: rest[0] }));
      return auswerten();
    });
  }
  if (command === "finding") {
    // Hier gilt das Gegenteil der JSON-Regel: Was auf stdout steht, reicht eine
    // Ausgabestelle unveraendert weiter. Ein abgewiesener Aufruf schreibt deshalb nach
    // stderr und laesst stdout leer — sonst stuende eine Fehlermeldung dort, wo ein
    // Befund hingehoert (wie in kit/effectiveness.mjs).
    if (rest.length > 0) fail(t("befundOhneArgumente", { arg: rest[0] }));
    aufStdout(befund());
    return 0;
  }

  // Auch der Aufruf ohne Kommando ist ein Fehler mit JSON-Ausgabe: Wer dieses Werkzeug
  // ruft, liest seine Ausgabe maschinell, und ein Hilfetext auf stdout waere dort ein
  // Parse-Fehler. Die Uebersicht geht deshalb nach stderr.
  aufStderr(hilfe());
  return alsJson(() => fail(command === undefined ? t("keinKommando") : t("unbekannterBefehl", { befehl: command })));
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
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(fehlerZeile(err));
    process.exit(1);
  }
}
