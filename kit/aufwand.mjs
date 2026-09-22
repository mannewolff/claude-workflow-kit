#!/usr/bin/env node
/**
 * claude-workflow-kit Aufwands-Auswertung (Issue #750, Plan #745, Fachliche Quelle #737)
 *
 * Macht aus den Ergebnisstaenden der unbeaufsichtigten Laeufe eine Aussage darueber, wo
 * die Zeit und das Geld eines Prozesslaufs hingehen: `auswerten` liest sie, aggregiert
 * Zeit, Pruefungen, Umfang, Kosten und den Aufwand je Aufgabenstufe (Issue #848)
 * und schreibt `.claude/aufwand.md` (fuer Menschen)
 * und `.claude/aufwand.json` (fuer die zwei Ausgabestellen). `befund` gibt allein den
 * Befundblock als Text aus.
 *
 * WARUM EINE EIGENE DATEI UND KEIN ANBAU AN night.mjs (Plan #745, E7): `/push-main` muss
 * den Befund lesen koennen, ohne den Nacht-Runner zu starten. night.mjs traegt ueber
 * 5.000 Zeilen, und diese Auswertung ist eine reine Leseoperation ueber Dateien — ohne
 * Board, ohne Git. Genau deshalb ist sie vollstaendig an Fixtures pruefbar.
 *
 * DIE DATENQUELLE SIND DIE ERGEBNISSTAENDE (E5): `.claude/night-run-*.json` tragen seit
 * Issue #748 und #749 Dauer, Kosten, Mengen, Modell und Pruefstand je Einheit, bleiben
 * liegen und schliessen fehlgeschlagene wie abgebrochene Laeufe ein. Eine zweite Ablage
 * waere dieselbe Wahrheit an einem zweiten Ort.
 *
 * ZWEI REGELN ZIEHEN SICH DURCH ALLES:
 *
 *   Ein fehlender Messwert bleibt `null` und heisst "nicht gemessen" — nie 0. Eine 0
 *   behauptete, es sei nichts verbraucht worden, und saehe aus wie gemessen. Dieselbe
 *   Regel steht hinter `verbrauchLeer()` in night.mjs.
 *
 *   Jede Kennzahl traegt die Zahl der Laeufe, die sie getragen haben. Ohne sie liesse
 *   sich eine Summe aus einem Lauf nicht von einer aus zehn unterscheiden, und eine
 *   Momentaufnahme laese sich als Tendenz.
 *
 * NICHT-ZIEL: keine Handlungsempfehlung. Das Werkzeug sagt, was auffaellt, nicht was zu
 * tun ist — und es schweigt, wenn nichts auffaellt (Kriterium 11).
 *
 * Aufruf im Projekt-Root:  node .claude/kit/aufwand.mjs auswerten [--laeufe <n>]
 *                          node .claude/kit/aufwand.mjs befund
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit liefert
 * seine Werkzeuge als eigenstaendig portable Einzeldateien aus.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.1.0";

const CLAUDE_DIR = ".claude";
const STAND_DATEI = "aufwand.json";
const BERICHT_DATEI = "aufwand.md";
const CONFIG_DATEI = "workflow.config.json";

// Der Dateiname eines Ergebnisstands. Der Stempel ist zugleich der Sortierschluessel:
// `YYYY-MM-DD-HHMMSS` ist lexikografisch dieselbe Reihenfolge wie chronologisch, also
// braucht es kein Datums-Parsen (und keine Zeitzone, die dabei danebenginge).
const STAND_MUSTER = /^night-run-(\d{4}-\d{2}-\d{2}-\d{6})\.json$/;

/**
 * Die eingebauten Vorgaben (Kriterium 5). Sie gelten, solange die Config schweigt —
 * damit ein bestehendes Projekt die Auswertung bekommt, sobald es die neue Fassung des
 * Werkzeugkastens erhaelt, ohne weitere Einrichtung (Kriterium 12).
 */
const VORGABE_LAEUFE = 10;
const VORGABE_SCHWELLEN = {
  pruefungAnteil: 0.5,
  eingrenzungOhneWirkung: true,
  werkzeugAnteil: 0.5,
  schreibkostenAnteil: 0.75,
};

// Die Preistabelle als Nachbardatei, nach demselben Muster wie in board.mjs: bedingtes
// `await import`, damit diese Datei auch allein kopiert laeuft. Fehlt sie, kennt die
// Auswertung keinen Preis — dann entfaellt die Kostenteilung mit Vermerk, statt dass ein
// Satz geraten wird.
const NACHBAR_DIR = dirname(fileURLToPath(import.meta.url));
const NACHBAR_PREISE = join(NACHBAR_DIR, "preise.mjs");
const preiseModul = existsSync(NACHBAR_PREISE) ? await import(pathToFileURL(NACHBAR_PREISE).href) : null;
const preisFuer = preiseModul?.preisFuer ?? (() => null);
const PREISE_STAND = preiseModul?.PREISE_STAND ?? null;

const HELP = `aufwand.mjs (claude-workflow-kit v${KIT_VERSION}) — Aufwand des Prozesses

  node aufwand.mjs auswerten [--laeufe <n>]
  node aufwand.mjs befund

auswerten  Liest die juengsten Ergebnisstaende aus ${CLAUDE_DIR}/, aggregiert Zeit,
           Pruefungen, Umfang, Kosten und den Aufwand je Aufgabenstufe und schreibt
           ${CLAUDE_DIR}/${BERICHT_DATEI} sowie
           ${CLAUDE_DIR}/${STAND_DATEI}. Die Ausgabe auf stdout ist immer JSON —
           auch im Leerfall und auch bei einem abgewiesenen Aufruf.
befund     Gibt den Befundblock aus ${CLAUDE_DIR}/${STAND_DATEI} als Text aus, mit dem
           Zeitpunkt der Auswertung als erster Zeile. Liegt kein Befund vor, fehlt die
           Datei oder ist sie unlesbar, bleibt die Ausgabe leer. Exit immer 0 — der
           Befund ist kein Gate.

  --laeufe <n>    Wie viele Staende hoechstens einbezogen werden, die juengsten zuerst
                  (Vorgabe ${VORGABE_LAEUFE}). Sticht den Config-Block.
  --version       Kit-Stand dieser Datei.
  --help, -h      Diese Uebersicht.

Gelesen wird ${CLAUDE_DIR}/${CONFIG_DATEI} im Arbeitsverzeichnis, Block 'aufwand':
'laeufe' und 'schwellen' (pruefungAnteil, eingrenzungOhneWirkung, werkzeugAnteil,
schreibkostenAnteil). Der Block ist optional; fehlt er oder ein Feld darin, gelten die
Vorgaben.
`;

class AufwandError extends Error {}

function fail(nachricht) {
  throw new AufwandError(nachricht);
}

/** Eine Zahl oder `null` — dieselbe Regel wie `endlicheZahl` in night.mjs. */
function zahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt. Bewusst
 * **nicht** `localeCompare` — dessen Reihenfolge haengt an der Locale der Maschine, und
 * zwei Laeufe muessen ueberall dieselbe Liste ergeben.
 *
 * SYNC: dieselbe Funktion steckt in kit/checks.mjs und kit/wirksamkeit.mjs. Die drei sind
 * bewusst eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440); geteilte
 * Logik wird dupliziert und hier markiert.
 */
function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// --- Messreihen --------------------------------------------------------------
//
// Eine Messreihe ist eine Summe plus die Menge der Laeufe, die zu ihr beigetragen
// haben. Sie beginnt bei `null` und nicht bei 0: Erst der erste gemessene Wert macht
// aus "nicht gemessen" eine Zahl.

function reihe() {
  return { summe: null, laeufe: new Set() };
}

function messen(r, wert, laufId) {
  const n = zahl(wert);
  if (n === null) return false;
  r.summe = (r.summe ?? 0) + n;
  r.laeufe.add(laufId);
  return true;
}

/**
 * Die Messreihe als Ergebnis. Die Kosten werden auf sechs Stellen gerundet, wie
 * `verbrauchOhneEinheit` in night.mjs — sonst stuende Gleitkomma-Rauschen im Betrag.
 * `+ 0` macht aus einer gerundeten -0 eine 0.
 */
function fertig(r, { geld = false } = {}) {
  if (r.summe === null) return { wert: null, laeufe: r.laeufe.size };
  return { wert: geld ? runden(r.summe) : r.summe, laeufe: r.laeufe.size };
}

/** Ein Dollarbetrag auf sechs Stellen; `+ 0` macht aus einer gerundeten -0 eine 0. */
function runden(betrag) {
  return Math.round(betrag * 1e6) / 1e6 + 0;
}

// --- Config ------------------------------------------------------------------

/**
 * Der Block `aufwand` aus der Config, gegen die Vorgaben aufgefuellt.
 *
 * Eine fehlende oder kaputte Config ist hier KEIN Abbruch — anders als in checks.mjs,
 * wo eine fehlende Config Pruefungen wegnaehme. Hier steht nichts auf dem Spiel als die
 * Abweichung von den Vorgaben, und `befund` soll auch in einem halb eingerichteten
 * Projekt lesbar bleiben. Was ausfiel, steht im Bericht.
 */
function ladeEinstellungen(root) {
  const pfad = join(root, CLAUDE_DIR, CONFIG_DATEI);
  const vorgabe = { laeufe: VORGABE_LAEUFE, schwellen: { ...VORGABE_SCHWELLEN }, configGelesen: null };
  if (!existsSync(pfad)) return vorgabe;
  let config;
  try {
    config = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (err) {
    return { ...vorgabe, configGelesen: `nicht lesbar (${err.message})` };
  }
  const block = config?.aufwand && typeof config.aufwand === "object" ? config.aufwand : {};
  const schwellen = { ...VORGABE_SCHWELLEN };
  for (const [name, standard] of Object.entries(VORGABE_SCHWELLEN)) {
    const wert = block.schwellen?.[name];
    if (typeof standard === "boolean") {
      if (typeof wert === "boolean") schwellen[name] = wert;
    } else if (zahl(wert) !== null) {
      schwellen[name] = wert;
    }
  }
  const laeufe = Number.isInteger(block.laeufe) && block.laeufe > 0 ? block.laeufe : VORGABE_LAEUFE;
  return { laeufe, schwellen, configGelesen: null };
}

// --- Ergebnisstaende lesen ---------------------------------------------------

/**
 * Die Staende, die in die Auswertung gehen: die juengsten `grenze` Stueck, absteigend
 * nach dem Stempel im Dateinamen.
 *
 * Eine unlesbare Datei ist ein Vermerk und kein Abbruch: Sie entsteht regelmaessig,
 * wenn ein Lauf gerade schreibt, und eine halbe Datei darf keine Auswertung kosten.
 * Sie zaehlt aber nicht als "gefunden", denn sie traegt nichts bei.
 */
function ladeStaende(root, grenze) {
  const dir = join(root, CLAUDE_DIR);
  let eintraege = [];
  try {
    eintraege = readdirSync(dir);
  } catch {
    return { staende: [], gefunden: 0, unlesbar: [] };
  }
  const kandidaten = [];
  for (const name of eintraege) {
    const treffer = STAND_MUSTER.exec(name);
    if (treffer) kandidaten.push({ stempel: treffer[1], datei: join(dir, name) });
  }
  // Absteigend: der juengste zuerst. Der Stempel ist bereits sortierbar.
  kandidaten.sort((a, b) => vergleicheText(b.stempel, a.stempel));

  const staende = [];
  const unlesbar = [];
  for (const kandidat of kandidaten) {
    if (staende.length >= grenze) break;
    try {
      staende.push({ ...kandidat, daten: JSON.parse(readFileSync(kandidat.datei, "utf-8")) });
    } catch (err) {
      unlesbar.push({ datei: kandidat.datei, fehler: err.message });
    }
  }
  return { staende, gefunden: kandidaten.length - unlesbar.length, unlesbar };
}

// --- Kosten je Einheit -------------------------------------------------------

/**
 * Die Summe der gemessenen Posten je Million Token — `null`, wenn kein einziger gemessen
 * ist (Issue #821).
 *
 * Eine fehlende Menge traegt nichts bei und macht die Summe nicht zur 0: Ein Posten ohne
 * jede Menge ist nicht gemessen, und eine 0 behauptete, es sei nichts verbraucht worden.
 * Dieselbe Regel wie in `reihe()`, nur eine Ebene tiefer.
 */
function postenSumme(posten) {
  const gemessen = posten.filter((p) => p !== null);
  if (gemessen.length === 0) return null;
  return gemessen.reduce((summe, p) => summe + p, 0) / 1e6;
}

/**
 * Die Cache-Erzeugung, die keine Teilung nach Haltedauer traegt: was `cacheErzeugtTokens`
 * ueber `cache5mTokens` + `cache1hTokens` hinaus ausweist.
 *
 * Ohne gemessene Erzeugung ist es nichts; ohne gemessene Teilung ist es alles. Negativ
 * kann es nicht werden — `kennzahlen` traegt nur die letzte Session einer Karte, und die
 * darf nicht mehr ausweisen, als `verbrauch` fuer alle zusammen zaehlt.
 */
function ungeteilteErzeugung(erzeugt, geteilt) {
  if (erzeugt === null) return 0;
  if (geteilt === null) return erzeugt;
  return Math.max(0, erzeugt - geteilt);
}

/**
 * Teilt den Verbrauch einer Einheit in Lese- und Schreibkosten.
 *
 * Lesekosten sind Eingabe, Cache-Erzeugung und Cache-Lesen; Schreibkosten allein die
 * Ausgabe. Die Teilung nach Haltedauer entscheidet ueber bis zu 60 Prozent des
 * Cache-Betrags (kit/preise.mjs): Was die Einheit als `cache5mTokens`/`cache1hTokens`
 * traegt, wird mit dem eigenen Satz bepreist; was darueber hinaus in
 * `cacheErzeugtTokens` steht — etwa weil eine Karte mehrere Sessions hatte und
 * `kennzahlen` nur die letzte traegt —, faellt auf den STUNDEN-Satz und zaehlt als
 * ungeteilt.
 *
 * Der Stunden-Satz ist hier die richtige Vorsicht, nicht der guenstigere: Claude Code
 * faehrt fuer lange Sitzungen den Stunden-Speicher, und genau diese Laeufe sind lang.
 * Dass geraten wurde, steht im Bericht — sonst saehe der Betrag aus wie gemessen.
 *
 * EINE FEHLENDE MENGE IST KEINE NULL (Issue #821): Jeder Posten steht auf `null`, solange
 * keine seiner Mengen gemessen ist. Frueher wurde jede fehlende Menge mit `?? 0` gerechnet
 * — eine Einheit mit gemeldetem Betrag, aber ohne Mengen ergab Lesen, Schreiben und Gesamt
 * je 0, und der gemeldete Betrag verschwand zwischen den Posten.
 *
 * Rueckgabe `null`, wenn die Preistabelle das Modell nicht kennt: Der Aufrufer macht
 * daraus den Posten "nicht zuordenbar", nie eine 0. Sind beide Posten `null`, ist keine
 * Menge gemessen — auch daraus macht der Aufrufer "nicht zuordenbar".
 */
export function einheitKosten(einheit) {
  const preis = preisFuer(einheit?.modell);
  if (!preis) return null;
  const v = einheit.verbrauch ?? {};
  const k = einheit.kennzahlen ?? {};

  const eingabe = zahl(v.eingabeTokens);
  const gelesen = zahl(v.cacheGelesenTokens);
  const ausgabe = zahl(v.ausgabeTokens);
  const erzeugt = zahl(v.cacheErzeugtTokens);
  const c5 = zahl(k.cache5mTokens);
  const c1 = zahl(k.cache1hTokens);
  const geteilt = c5 === null && c1 === null ? null : (c5 ?? 0) + (c1 ?? 0);
  const ungeteilt = ungeteilteErzeugung(erzeugt, geteilt);

  return {
    lesen: postenSumme([
      eingabe === null ? null : eingabe * preis.eingabe,
      gelesen === null ? null : gelesen * preis.cacheLesen,
      c5 === null ? null : c5 * preis.cacheSchreiben5m,
      c1 === null ? null : c1 * preis.cacheSchreiben1h,
      erzeugt === null ? null : ungeteilt * preis.cacheSchreiben1h,
    ]),
    schreiben: postenSumme([ausgabe === null ? null : ausgabe * preis.ausgabe]),
    ungeteilt,
  };
}

// --- Aggregation -------------------------------------------------------------

/** Die leeren Sammler einer Auswertung — ein Ort, an dem steht, was ueberhaupt gezaehlt wird. */
function sammlerAnlegen() {
  return {
    zeit: { gesamt: reihe(), nachdenken: reihe(), werkzeug: reihe(), rest: reihe() },
    // Die Grundlage des Werkzeuganteils: NUR die Einheiten, die Gesamtdauer und
    // Werkzeugzeit beide tragen (Issue #821). Zaehler und Nenner aus zwei verschiedenen
    // Mengen zu bilden ergaebe einen Anteil, den keine Einheit belegt.
    werkzeugBasis: { gesamt: reihe(), werkzeug: reihe(), ohneBeide: { einheiten: 0, laeufe: new Set() } },
    nebenlaeufig: { einheiten: 0, laeufe: new Set() },
    wartendBeendet: { einheiten: 0, laeufe: new Set() },
    kommandos: new Map(),
    pruefGesamt: reihe(),
    umfang: { voll: 0, eingegrenzt: 0, unbekannt: 0, laeufe: new Set() },
    eingrenzung: { faelle: 0, gemessen: 0 },
    kosten: { lesen: reihe(), schreiben: reihe(), nichtZuordenbar: reihe() },
    ohneTeilung: { einheiten: 0, tokens: 0 },
    ohneMengen: { einheiten: 0 },
    ohnePreissatz: { einheiten: 0, modelle: new Set() },
    // Je Paar aus Aufgabenstufe und Gruendlichkeit ein Sammler (Issue #848). Eine Map und
    // keine feste Liste: Welche Stufen und welche `effort`-Werte ein Projekt fuehrt, steht
    // in seiner Config und nicht hier.
    jeStufe: new Map(),
    unvollstaendig: [],
    einheitenGesamt: 0,
  };
}

/**
 * Die Zeiten einer Einheit.
 *
 * Nachdenken und Werkzeugarbeit sind Teilmengen der Gesamtdauer, der Rest ist, was
 * uebrig bleibt. Ein negativer Rest heisst Ueberlappung (nebenlaeufige Werkzeugaufrufe)
 * — als Zahl waere er Unsinn, also wird er gemeldet statt gerechnet.
 */
function zeitErfassen(s, einheit, stempel) {
  const z = einheit?.zeiten;
  if (!z) {
    werkzeugbasisErfassen(s, null, null, stempel);
    return false;
  }
  const gesamt = zahl(z.dauerMs);
  const nachdenken = zahl(z.nachdenkenMs);
  const werkzeug = zahl(z.werkzeugMs);
  messen(s.zeit.gesamt, gesamt, stempel);
  messen(s.zeit.nachdenken, nachdenken, stempel);
  messen(s.zeit.werkzeug, werkzeug, stempel);
  werkzeugbasisErfassen(s, gesamt, werkzeug, stempel);
  if (gesamt === null || nachdenken === null || werkzeug === null) return true;
  const rest = gesamt - nachdenken - werkzeug;
  if (rest >= 0) {
    messen(s.zeit.rest, rest, stempel);
  } else {
    s.nebenlaeufig.einheiten += 1;
    s.nebenlaeufig.laeufe.add(stempel);
  }
  return true;
}

/**
 * Die Grundlage des Werkzeuganteils (Issue #821).
 *
 * Beitragen darf nur eine Einheit, die BEIDE Zeiten traegt — sonst stuenden Zaehler und
 * Nenner auf verschiedenen Mengen: Eine Einheit mit 600 von 1.000 ms und eine mit 9.000 ms
 * ohne Werkzeugmessung ergaeben 6 statt 60 Prozent, und der Befund verschwaende an einer
 * Einheit, die zur Frage gar nichts sagt.
 *
 * Die uebrigen zaehlt `ohneBeide` — damit im Bericht steht, worauf der Anteil NICHT
 * beruht. Das Schweigen darueber liesse den Anteil vollstaendiger aussehen, als er ist.
 */
function werkzeugbasisErfassen(s, gesamt, werkzeug, stempel) {
  if (gesamt !== null && werkzeug !== null) {
    messen(s.werkzeugBasis.gesamt, gesamt, stempel);
    messen(s.werkzeugBasis.werkzeug, werkzeug, stempel);
    return;
  }
  s.werkzeugBasis.ohneBeide.einheiten += 1;
  s.werkzeugBasis.ohneBeide.laeufe.add(stempel);
}

/**
 * Die wartend beendeten Sitzungen (Issue #779): Einheiten, deren Session auf eine selbst
 * angestossene Arbeit gewartet hat und ohne Ergebnis beendet worden ist. Das Feld
 * `wartendBeendet` setzt night.mjs an die Einheit (Issue #776).
 *
 * Ein fehlendes Feld traegt 0 bei und macht den Lauf NICHT unvollstaendig — anders als
 * bei den Messwerten: Hier heisst das Schweigen "der Fall trat nicht ein", nicht "nicht
 * gemessen". Die allermeisten Naechte haben ihn schlicht nicht.
 */
function wartendErfassen(s, einheit, stempel) {
  if (einheit?.wartendBeendet !== true) return;
  s.wartendBeendet.einheiten += 1;
  s.wartendBeendet.laeufe.add(stempel);
}

/**
 * Der Grund, den allein die BEREICHSAUSWAHL in checks.mjs schreibt (`entscheidung`):
 * "Bereich kern unberuehrt" beziehungsweise "Bereiche kern, doku unberuehrt".
 *
 * Nur er belegt eine gegriffene Eingrenzung. Die anderen Gruende einer Auslassung sagen
 * etwas anderes: "Stufe push, gefahren wird paket" heisst, die Pruefung war nicht dran,
 * und "leeres Paket: keine Aenderung seit ..." heisst, es gab nichts zu pruefen. Beide
 * entstehen auch im vollen Umfang.
 */
const BEREICH_UNBERUEHRT = /^Bereiche? .+ unberuehrt$/;

/**
 * Pruefstand und Umfang einer Einheit: je Kommando Anzahl und Summe der Dauer,
 * wiederholte Ausfuehrungen desselben Eintrags zusammengefasst — eine Session darf
 * `run` mehrfach fahren (rot, Fix, erneut).
 *
 * Ob die Eingrenzung gegriffen hat, haengt allein an einer Auslassung wegen UNBERUEHRTEN
 * BEREICHS (Issue #821). `vollerUmfang === false` belegt sie nicht: checks.mjs setzt das
 * Feld standardmaessig so, an der Merge-Stufe sogar bewusst — es markiert den Zweifelsfall
 * und nicht die Eingrenzung. Und eine Auslassung allein genuegt auch nicht: Auslassungen
 * wegen spaeterer Stufen legt checks.mjs im vollen Umfang genauso an.
 */
function pruefungErfassen(s, einheit, stempel) {
  const p = einheit?.pruefung;
  for (const eintrag of Array.isArray(p?.laufen) ? p.laufen : []) {
    // "nicht gestartet" ist keine Ausfuehrung: Dort war ein frueheres Kommando rot, und
    // dieses hier lief nie. Dieselbe Begruendung, aus der `ausfuehrungSchreiben` in
    // checks.mjs ihm keine Zeile im Protokoll gibt.
    if (eintrag?.ergebnis === "nicht gestartet") continue;
    const cmd = typeof eintrag?.cmd === "string" ? eintrag.cmd : "(ohne Namen)";
    const k = s.kommandos.get(cmd) ?? { cmd, anzahl: 0, dauer: reihe() };
    k.anzahl += 1;
    messen(k.dauer, eintrag?.dauerMs, stempel);
    messen(s.pruefGesamt, eintrag?.dauerMs, stempel);
    s.kommandos.set(cmd, k);
  }
  if (!p) return false;
  s.umfang.laeufe.add(stempel);
  if (p.vollerUmfang === true) s.umfang.voll += 1;
  else if (p.vollerUmfang === false) s.umfang.eingegrenzt += 1;
  else s.umfang.unbekannt += 1;
  s.eingrenzung.gemessen += 1;
  const ausgelassen = Array.isArray(p.ausgelassen) ? p.ausgelassen : [];
  if (ausgelassen.some((e) => BEREICH_UNBERUEHRT.test(e?.grund ?? ""))) s.eingrenzung.faelle += 1;
  return true;
}

/**
 * Die Kosten einer Einheit: geteilt, wo ein Preissatz UND eine Menge vorliegen; sonst der
 * gemeldete Betrag als "nicht zuordenbar". Ein geratener Satz erzeugte einen Betrag, der
 * aussieht wie gemessen — dieselbe Begruendung wie bei `preisFuer`.
 *
 * Die beiden Ausfaelle bleiben getrennt gezaehlt (Issue #821), weil sie Verschiedenes
 * sagen: Der Preistabelle fehlt ein Satz, oder dem Stand fehlt die Menge. Wer beide in
 * einen Topf wuerfe, suchte den Fehler an der falschen Stelle.
 */
function kostenErfassen(s, einheit, stempel) {
  const anteile = einheitKosten(einheit);
  if (!anteile) {
    s.ohnePreissatz.einheiten += 1;
    if (typeof einheit?.modell === "string") s.ohnePreissatz.modelle.add(einheit.modell);
    messen(s.kosten.nichtZuordenbar, einheit?.verbrauch?.kostenUsd, stempel);
    return;
  }
  // Keine einzige gemessene Menge: Der gemeldete Betrag ist alles, was diese Einheit
  // hergibt. Geteilt ergaeben sich zweimal 0 — und die 0 saehe aus wie gemessen.
  if (anteile.lesen === null && anteile.schreiben === null) {
    s.ohneMengen.einheiten += 1;
    messen(s.kosten.nichtZuordenbar, einheit?.verbrauch?.kostenUsd, stempel);
    return;
  }
  messen(s.kosten.lesen, anteile.lesen, stempel);
  messen(s.kosten.schreiben, anteile.schreiben, stempel);
  if (anteile.ungeteilt > 0) {
    s.ohneTeilung.einheiten += 1;
    s.ohneTeilung.tokens += anteile.ungeteilt;
  }
}

// --- Aufgabenstufe und Gruendlichkeit ----------------------------------------
//
// Der Fachplan #837 verlangt, dass sich jede Aufgabenstufe vor und nach einer Umstellung
// der Gruendlichkeit vergleichen laesst, ohne eigenen Vergleichslauf (AK 5). Die Staende
// tragen dafuer seit Issue #711 `stufeVerwendet` und seit Issue #846 `effort` je Einheit.

/**
 * Ob eine Einheit in die Stufen-Auswertung geht: ein Arbeitspaket, fuer das wirklich eine
 * Session lief.
 *
 * `art: "implementierung"` schliesst die Ketten-Einheiten aus (Fachplan, Technik, Plan,
 * Zuschnitt) — sie setzen kein Paket um, und ihre Dauer gehoerte keiner Aufgabenstufe.
 * Das FELD `endStatus` schliesst die Einheiten ohne Session aus: `uebersprungen`,
 * `liegengeblieben` und `zurueckgestellt` legt der Runner an, bevor eine Session startet,
 * und sie tragen weder Endstatus noch Pruefstand. Als Nacharbeit gezaehlt waeren sie
 * allesamt eine — die Quote saehe katastrophal aus und maesse nur, wie oft ein Gate hielt.
 */
function mitSession(einheit) {
  return einheit?.art === "implementierung" && einheit?.endStatus !== undefined && einheit?.endStatus !== null;
}

/**
 * Nacharbeit: eine gezaehlte Einheit, die nicht sauber in In review gelandet ist ODER
 * deren Pruefstand rot war.
 *
 * Beides zusammen und nicht nur der Endstatus: Eine Session kann festschreiben und
 * verschieben und dabei einen roten Pflichtcheck hinterlassen haben — "Nachpruefung rot"
 * aus dem Fachplan meint genau diesen Zustand, den `lesePruefung` in night.mjs schreibt.
 */
function istNacharbeit(einheit) {
  return einheit.endStatus !== "in_review" || einheit.pruefung?.zustand === "rot";
}

/** Der leere Sammler eines Paares — ein Ort, an dem steht, was je Stufe gezaehlt wird. */
function stufenSammler(stufe, effort) {
  return {
    stufe,
    effort,
    einheiten: { anzahl: 0, laeufe: new Set() },
    dauer: reihe(),
    kosten: reihe(),
    rot: { anzahl: 0, laeufe: new Set() },
    nacharbeit: { anzahl: 0, laeufe: new Set() },
  };
}

/**
 * Eine Einheit in ihr Paar aus Stufe und Gruendlichkeit.
 *
 * Ein fehlendes `effort` und ein `effort: null` sind derselbe Fall und landen zusammen:
 * Beide heissen, dass die Session mit der Voreinstellung der CLI fuhr — einmal, weil der
 * Stand aelter ist als Issue #846, einmal, weil die Stufe keine Gruendlichkeit setzt.
 * Zwei Zeilen daraus zu machen teilte dieselbe Messung in zwei zu kleine Haelften.
 *
 * Die Dauer kommt aus `einheit.dauerMs` und nicht aus `zeiten.dauerMs`: Das ist die
 * Rundendauer, die der Runner selbst misst — sie liegt fuer jede Einheit mit Session vor,
 * waehrend `zeiten` aus der Zusammenfassung der Session stammt und fehlen kann.
 */
function stufeErfassen(s, einheit, stempel) {
  if (!mitSession(einheit)) return;
  const stufe = typeof einheit.stufeVerwendet === "string" ? einheit.stufeVerwendet : null;
  const effort = typeof einheit.effort === "string" ? einheit.effort : null;
  const schluessel = `${stufe ?? ""} ${effort ?? ""}`;
  const g = s.jeStufe.get(schluessel) ?? stufenSammler(stufe, effort);
  g.einheiten.anzahl += 1;
  g.einheiten.laeufe.add(stempel);
  messen(g.dauer, einheit.dauerMs, stempel);
  messen(g.kosten, einheit.verbrauch?.kostenUsd, stempel);
  if (einheit.pruefung?.zustand === "rot") {
    g.rot.anzahl += 1;
    g.rot.laeufe.add(stempel);
  }
  if (istNacharbeit(einheit)) {
    g.nacharbeit.anzahl += 1;
    g.nacharbeit.laeufe.add(stempel);
  }
  s.jeStufe.set(schluessel, g);
}

/**
 * Die Zeilen je Stufe als Ergebnis, in fester Reihenfolge: nach Stufe, dann nach
 * Gruendlichkeit — und "ohne Stufe" am Ende.
 *
 * Ans Ende, weil die Zeile keine Aufgabenstufe vergleicht, sondern die Reste sammelt:
 * Staende vor Issue #711 und Karten, deren Modell nicht ueber eine Stufe kam. Zwischen
 * den Stufen stuende sie als vierte Stufe da.
 */
function stufenErgebnis(s) {
  return [...s.jeStufe.values()]
    .sort((a, b) => {
      if ((a.stufe === null) !== (b.stufe === null)) return a.stufe === null ? 1 : -1;
      return vergleicheText(a.stufe ?? "", b.stufe ?? "") || vergleicheText(a.effort ?? "", b.effort ?? "");
    })
    .map((g) => ({
      stufe: g.stufe,
      effort: g.effort,
      einheiten: { wert: g.einheiten.anzahl, laeufe: g.einheiten.laeufe.size },
      dauerMs: fertig(g.dauer),
      kostenUsd: fertig(g.kosten, { geld: true }),
      rotePruefstaende: { wert: g.rot.anzahl, laeufe: g.rot.laeufe.size },
      nacharbeit: { wert: g.nacharbeit.anzahl, laeufe: g.nacharbeit.laeufe.size },
    }));
}

/**
 * Warum ein Lauf als unvollstaendig gilt. Er wird deshalb NICHT verworfen — er geht mit
 * dem ein, was er traegt: Verworfen saehen die Summen vollstaendig aus und waeren zu
 * klein. Die Liste sagt nur, worauf sie nicht beruhen.
 */
function unvollstaendigkeit(daten, einheiten, mitZeiten, mitPruefstand) {
  const gruende = [];
  if (daten?.complete !== true) gruende.push(`nicht regulaer abgeschlossen (${daten?.abschluss ?? "ohne Abschluss"})`);
  if (einheiten.length === 0) gruende.push("ohne Einheit");
  if (einheiten.length > 0 && mitZeiten === 0) gruende.push("ohne Zeiten je Einheit");
  if (einheiten.length > 0 && mitPruefstand === 0) gruende.push("ohne Pruefstand");
  return gruende;
}

/** Ein Stand: alle seine Einheiten, dann der Verbrauch, der zu keiner Karte gehoert. */
function standErfassen(s, { stempel, daten }) {
  const einheiten = Array.isArray(daten?.einheiten) ? daten.einheiten : [];
  s.einheitenGesamt += einheiten.length;
  let mitZeiten = 0;
  let mitPruefstand = 0;
  for (const einheit of einheiten) {
    if (zeitErfassen(s, einheit, stempel)) mitZeiten += 1;
    if (pruefungErfassen(s, einheit, stempel)) mitPruefstand += 1;
    kostenErfassen(s, einheit, stempel);
    wartendErfassen(s, einheit, stempel);
    stufeErfassen(s, einheit, stempel);
  }
  // Was zu keiner Karte gehoert (Vorflug, Kette) — nur der Runner kennt diesen Rest.
  messen(s.kosten.nichtZuordenbar, daten?.verbrauchOhneEinheit?.kostenUsd, stempel);

  const gruende = unvollstaendigkeit(daten, einheiten, mitZeiten, mitPruefstand);
  if (gruende.length > 0) s.unvollstaendig.push({ stempel, gruende });
}

/** Die Kostenposten als Ergebnis, samt Gesamtbetrag ueber die drei Teile. */
function kostenErgebnis(s) {
  const lesenUsd = fertig(s.kosten.lesen, { geld: true });
  const schreibenUsd = fertig(s.kosten.schreiben, { geld: true });
  const nichtZuordenbarUsd = fertig(s.kosten.nichtZuordenbar, { geld: true });
  const laeufe = new Set([...s.kosten.lesen.laeufe, ...s.kosten.schreiben.laeufe, ...s.kosten.nichtZuordenbar.laeufe]);
  const teile = [lesenUsd.wert, schreibenUsd.wert, nichtZuordenbarUsd.wert].filter((w) => w !== null);
  return {
    lesenUsd,
    schreibenUsd,
    nichtZuordenbarUsd,
    gesamtUsd: {
      wert: teile.length === 0 ? null : runden(teile.reduce((summe, w) => summe + w, 0)),
      laeufe: laeufe.size,
    },
    ohneTeilung: s.ohneTeilung,
    ohneMengen: s.ohneMengen,
    ohnePreissatz: { einheiten: s.ohnePreissatz.einheiten, modelle: [...s.ohnePreissatz.modelle].sort(vergleicheText) },
    preistabelle: PREISE_STAND,
  };
}

/**
 * Fasst die Staende zusammen. Reine Funktion ueber den gelesenen Daten, damit sie ohne
 * Dateisystem pruefbar bleibt — dieselbe Linie wie `verbrauchAddieren` in night.mjs.
 */
function aggregieren(staende) {
  const s = sammlerAnlegen();
  for (const stand of staende) standErfassen(s, stand);

  return {
    einheiten: s.einheitenGesamt,
    wartendBeendet: { einheiten: s.wartendBeendet.einheiten, laeufe: s.wartendBeendet.laeufe.size },
    zeit: {
      gesamtMs: fertig(s.zeit.gesamt),
      nachdenkenMs: fertig(s.zeit.nachdenken),
      werkzeugMs: fertig(s.zeit.werkzeug),
      restMs: fertig(s.zeit.rest),
      nebenlaeufig: { einheiten: s.nebenlaeufig.einheiten, laeufe: s.nebenlaeufig.laeufe.size },
      werkzeugBasis: {
        gesamtMs: fertig(s.werkzeugBasis.gesamt),
        werkzeugMs: fertig(s.werkzeugBasis.werkzeug),
        ohneBeideZeiten: {
          einheiten: s.werkzeugBasis.ohneBeide.einheiten,
          laeufe: s.werkzeugBasis.ohneBeide.laeufe.size,
        },
      },
    },
    pruefungen: {
      // Absteigend nach Dauer: Die teuerste Pruefung ist die, um die es geht. Gleiche
      // Dauer entscheidet der Name, damit die Reihenfolge ueberall dieselbe ist.
      kommandos: [...s.kommandos.values()]
        .map((k) => ({ cmd: k.cmd, anzahl: k.anzahl, ...fertigDauer(k.dauer) }))
        .sort((a, b) => (b.dauerMs ?? -1) - (a.dauerMs ?? -1) || vergleicheText(a.cmd, b.cmd)),
      gesamtMs: fertig(s.pruefGesamt),
    },
    umfang: { voll: s.umfang.voll, eingegrenzt: s.umfang.eingegrenzt, unbekannt: s.umfang.unbekannt, laeufe: s.umfang.laeufe.size },
    eingrenzung: { gegriffen: s.eingrenzung.faelle, gemessen: s.eingrenzung.gemessen },
    unvollstaendig: s.unvollstaendig,
    kosten: kostenErgebnis(s),
    jeStufe: stufenErgebnis(s),
  };
}


/** Die Messreihe eines Pruefkommandos: `dauerMs` und `laeufe` statt `wert`. */
function fertigDauer(r) {
  const f = fertig(r);
  return { dauerMs: f.wert, laeufe: f.laeufe };
}

// --- Schwellen ---------------------------------------------------------------

/**
 * Prueft die vier Schwellen und gibt je ueberschrittener einen Befund in Worten zurueck
 * (Kriterium 4), dazu die Namen derer, die sich nicht bestimmen liessen.
 *
 * Die Grenze selbst loest NICHT aus — "ueber der Haelfte", nicht "ab der Haelfte":
 * Sonst faellt ein sauber halbiertes Verhaeltnis jedes Mal auf.
 *
 * Ein nicht bestimmbarer Anteil erzeugt keinen Befund, gilt aber auch nie als Beleg
 * fuer Unauffaelligkeit: Er steht in `nichtBestimmbar` und damit im Bericht. Und die
 * Anteile werden ueber die GEMESSENEN Werte gerechnet, nicht ueber alle Laeufe — sonst
 * verduennte ein Lauf ohne Messwerte einen echten Befund weg.
 */
function schwellenPruefen(a, schwellen) {
  const befund = [];
  const nichtBestimmbar = [];
  for (const pruefe of [anteilPruefung, anteilEingrenzung, anteilWerkzeug, anteilSchreibkosten]) {
    const ergebnis = pruefe(a, schwellen);
    if (ergebnis === null) continue;
    (typeof ergebnis === "string" ? nichtBestimmbar : befund).push(ergebnis);
  }
  return { befund, nichtBestimmbar };
}

/**
 * Ein Anteil ueber seiner Grenze wird zum Befund; die Grenze selbst loest NICHT aus —
 * "ueber der Haelfte", nicht "ab der Haelfte". Sonst faellt ein sauber halbiertes
 * Verhaeltnis jedes Mal auf.
 *
 * `null`: geprueft und unauffaellig. Der Name als Zeichenkette: nicht bestimmbar.
 */
function anteilBefund(name, zaehler, nenner, grenze, laeufe, text) {
  if (nenner === null || nenner <= 0 || zaehler === null) return name;
  const anteil = zaehler / nenner;
  return anteil > grenze ? { schwelle: name, wert: anteil, grenze, laeufe, text: text(anteil) } : null;
}

/** Eine einzelne Pruefung ueber ihrem Anteil an der gesamten Pruefzeit. */
function anteilPruefung(a, schwellen) {
  const gesamt = a.pruefungen.gesamtMs.wert;
  const groesste = a.pruefungen.kommandos.find((k) => k.dauerMs !== null);
  if (!groesste) return "pruefungAnteil";
  const laeufe = a.pruefungen.gesamtMs.laeufe;
  return anteilBefund("pruefungAnteil", groesste.dauerMs, gesamt, schwellen.pruefungAnteil, laeufe,
    (anteil) => `Die Pruefung '${groesste.cmd}' verbraucht ${prozent(anteil)} der gemessenen Pruefzeit `
      + `(${dauer(groesste.dauerMs)} von ${dauer(gesamt)}, ${groesste.anzahl} Ausfuehrungen), `
      + `gemessen ${laufText(laeufe)}.`);
}

/**
 * Eine Eingrenzung, die in keinem Fall gegriffen hat.
 *
 * Gemessen wird an den Auslassungen wegen UNBERUEHRTEN BEREICHS — sie allein sind die
 * Eingrenzung (Issue #821). Weder `vollerUmfang === false` noch eine Auslassung wegen
 * spaeterer Stufe noch das leere Paket belegen sie; alle drei entstehen auch dort, wo die
 * volle Auswahl lief, und als Beleg genommen liessen sie den Befund ausbleiben.
 */
function anteilEingrenzung(a, schwellen) {
  if (a.eingrenzung.gemessen === 0) return "eingrenzungOhneWirkung";
  if (!schwellen.eingrenzungOhneWirkung || a.eingrenzung.gegriffen > 0) return null;
  return {
    schwelle: "eingrenzungOhneWirkung",
    wert: 0,
    grenze: 0,
    laeufe: a.umfang.laeufe,
    text: `Die Eingrenzung der Pruefungen hat in keinem der ${a.eingrenzung.gemessen} Pruefstaende gegriffen: `
      + "In keinem wurde eine Pruefung wegen eines unberuehrten Bereichs ausgelassen, "
      + "es lief jedes Mal die volle Auswahl.",
  };
}

/**
 * Werkzeugarbeit ueber ihrem Anteil an der Gesamtzeit — gerechnet ueber die Einheiten,
 * die BEIDE Zeiten tragen (Issue #821). Die Summen aus `zeit.gesamtMs` und
 * `zeit.werkzeugMs` stehen auf verschiedenen Mengen; ihr Quotient waere ein Anteil, den
 * keine einzige Einheit belegt.
 */
function anteilWerkzeug(a, schwellen) {
  const gesamt = a.zeit.werkzeugBasis.gesamtMs.wert;
  const werkzeug = a.zeit.werkzeugBasis.werkzeugMs.wert;
  const laeufe = a.zeit.werkzeugBasis.werkzeugMs.laeufe;
  return anteilBefund("werkzeugAnteil", werkzeug, gesamt, schwellen.werkzeugAnteil, laeufe,
    (anteil) => `Werkzeugarbeit macht ${prozent(anteil)} der Gesamtzeit der Einheiten aus, die beide Zeiten tragen `
      + `(${dauer(werkzeug)} von ${dauer(gesamt)}), gemessen ${laufText(laeufe)}.`);
}

/** Schreibkosten ueber ihrem Anteil an den Gesamtkosten. */
function anteilSchreibkosten(a, schwellen) {
  const gesamt = a.kosten.gesamtUsd.wert;
  const schreiben = a.kosten.schreibenUsd.wert;
  const laeufe = a.kosten.schreibenUsd.laeufe;
  return anteilBefund("schreibkostenAnteil", schreiben, gesamt, schwellen.schreibkostenAnteil, laeufe,
    (anteil) => `Schreibkosten machen ${prozent(anteil)} der gerechneten Gesamtkosten aus `
      + `(${geld(schreiben)} von ${geld(gesamt)}), gemessen ${laufText(laeufe)}.`);
}

// --- Textformen --------------------------------------------------------------

const NICHT_GEMESSEN = "nicht gemessen";

/**
 * Deutsche Zahlform: Komma als Dezimaltrenner, Punkt als Tausendertrenner.
 *
 * Von Hand und NICHT ueber `toLocaleString`: Dessen Ergebnis haengt an der Locale der
 * Maschine, und derselbe Bericht soll ueberall dieselben Zahlen zeigen — dieselbe
 * Begruendung, aus der `vergleicheText` in checks.mjs kein `localeCompare` nimmt.
 */
function zahlform(wert, stellen) {
  const fest = wert.toFixed(stellen);
  const [ganz, bruch] = fest.split(".");
  const vorzeichen = ganz.startsWith("-") ? "-" : "";
  const ziffern = vorzeichen ? ganz.slice(1) : ganz;
  const gruppiert = ziffern.replaceAll(/\B(?=(\d{3})+$)/g, ".");
  return bruch ? `${vorzeichen}${gruppiert},${bruch}` : `${vorzeichen}${gruppiert}`;
}

function prozent(anteil) {
  return `${zahlform(Math.round(anteil * 1000) / 10, 1)} Prozent`;
}

/** Eine Dauer in Millisekunden als lesbare Spanne; `null` sagt "nicht gemessen". */
function dauer(ms) {
  if (ms === null) return NICHT_GEMESSEN;
  if (ms < 1000) return `${zahlform(ms, 0)} ms`;
  const sekunden = Math.round(ms / 1000);
  if (sekunden < 60) return `${sekunden} s`;
  const minuten = Math.floor(sekunden / 60);
  if (minuten < 60) return `${minuten} min ${sekunden % 60} s`;
  return `${zahlform(Math.floor(minuten / 60), 0)} h ${minuten % 60} min`;
}

function geld(usd) {
  return usd === null ? NICHT_GEMESSEN : `${zahlform(usd, 2)} USD`;
}

/**
 * "ueber n Laeufe" — und bei genau einem Lauf ausdruecklich, dass es einer ist
 * (Kriterium 6). Eine Aussage aus einem einzigen Lauf ist keine Tendenz; wer das nicht
 * liest, haelt eine Momentaufnahme fuer einen Durchschnitt.
 */
function laufText(n) {
  if (n === 0) return "ohne einen einzigen Lauf";
  if (n === 1) return "aus einem einzigen Lauf";
  return `ueber ${n} Laeufe`;
}

/** Eine Kennzahl mit ihrer Traglast: Wert und die Zahl der Laeufe dahinter. */
function kennzahl(feld, formatieren) {
  return `${formatieren(feld.wert)} (${laufText(feld.laeufe)})`;
}

/**
 * Der Bericht fuer Menschen: Fliesstext und Tabellen, nach jedem Aufruf neu geschrieben
 * — auch wenn nichts auffaellt. Die Befunde stehen hier in Worten und ohne
 * Handlungsempfehlung; was zu tun ist, entscheidet ein Mensch (Nicht-Ziel).
 */
export function berichtText(e) {
  if (e.laeufe.einbezogen === 0) {
    return [
      "# Aufwand des Prozesses", "",
      `Auswertung vom ${e.erzeugtAm}.`, "",
      "Es liegt kein Ergebnisstand vor — es gibt nichts auszuwerten.", "",
      ...(e.laeufe.unlesbar.length > 0 ? [unlesbarAbsatz(e), ""] : []),
      dauerzeile(e), "",
    ].join("\n");
  }
  return [
    ...berichtKopf(e),
    ...berichtZeit(e),
    ...berichtPruefungen(e),
    ...berichtUmfang(e),
    ...berichtKosten(e),
    ...berichtStufen(e),
    ...berichtBefund(e),
    ...berichtFuss(e),
  ].join("\n");
}

function berichtKopf(e) {
  const zeilen = [
    "# Aufwand des Prozesses", "",
    `Auswertung vom ${e.erzeugtAm}.`,
    `Einbezogen sind ${e.laeufe.einbezogen} von ${e.laeufe.gefunden} Ergebnisstaenden `
    + `(Grenze ${e.laeufe.grenze}), der juengste vom ${e.juengsterLauf}. `
    + `Sie tragen ${e.einheiten} Arbeitseinheiten.`,
  ];
  // Kriterium 6: Eine Aussage aus einem einzigen Lauf ist keine Tendenz. Wer das nicht
  // liest, haelt eine Momentaufnahme fuer einen Durchschnitt.
  if (e.laeufe.einbezogen === 1) {
    zeilen.push("", "Die Zahlen stammen aus **einem einzigen Lauf**. Das ist eine Momentaufnahme, keine Tendenz.");
  }
  zeilen.push("", wartendZeile(e), "");
  return zeilen;
}

/**
 * Die wartend beendeten Sitzungen in Worten (Issue #779).
 *
 * Die Zeile steht auch bei 0 — und dann ausdruecklich als Null: Der Fall ist selten, und
 * ein Schweigen liesse offen, ob er nicht eintrat oder nicht gezaehlt wurde. Was gezaehlt
 * wurde, sagt die Zeile aus, statt einen Feldnamen zu zeigen.
 */
function wartendZeile(e) {
  const { einheiten, laeufe } = e.wartendBeendet;
  const gewartet = "auf eine selbst angestossene Arbeit gewartet und";
  if (einheiten === 0) return `Keine Sitzung hat ${gewartet} ist ohne Ergebnis beendet worden.`;
  if (einheiten === 1) return `Eine Sitzung hat ${gewartet} ist ohne Ergebnis beendet worden (${laufText(laeufe)}).`;
  return `${einheiten} Sitzungen haben ${gewartet} sind ohne Ergebnis beendet worden (${laufText(laeufe)}).`;
}

function berichtZeit(e) {
  const zeilen = ["## Zeit", "", "| Posten | Wert | Grundlage |", "| --- | --- | --- |"];
  for (const [name, feld] of [
    ["Gesamtdauer der Sessions", e.zeit.gesamtMs],
    ["Nachdenken", e.zeit.nachdenkenMs],
    ["Werkzeugarbeit", e.zeit.werkzeugMs],
    ["Rest (Start, Warten, Uebriges)", e.zeit.restMs],
  ]) {
    zeilen.push(`| ${name} | ${dauer(feld.wert)} | ${laufText(feld.laeufe)} |`);
  }
  zeilen.push("");
  // Woraufhin der Werkzeuganteil gerechnet wird, und was nicht eingeht (Issue #821):
  // Ohne den Absatz saehe der Anteil aus, als beruhte er auf allen Einheiten.
  const basis = e.zeit.werkzeugBasis;
  zeilen.push(
    "Der Werkzeuganteil wird ueber die Einheiten gebildet, die Gesamtdauer und Werkzeugzeit beide tragen: "
    + `${dauer(basis.werkzeugMs.wert)} von ${dauer(basis.gesamtMs.wert)} (${laufText(basis.werkzeugMs.laeufe)}).`
    + (basis.ohneBeideZeiten.einheiten > 0
      ? ` ${basis.ohneBeideZeiten.einheiten} Einheiten (${laufText(basis.ohneBeideZeiten.laeufe)}) tragen nur eine `
        + "der beiden Zeiten oder keine; sie gehen in den Anteil nicht ein."
      : ""),
    ""
  );
  if (e.zeit.nebenlaeufig.einheiten > 0) {
    zeilen.push(
      `Bei ${e.zeit.nebenlaeufig.einheiten} Einheiten (${laufText(e.zeit.nebenlaeufig.laeufe)}) uebersteigt die Summe `
      + "aus Nachdenken und Werkzeugarbeit die Gesamtdauer: Dort lief beides nebenlaeufig. Diese Einheiten tragen "
      + "keinen Rest bei — eine negative Zeit waere keine Zahl, die etwas bedeutet.",
      ""
    );
  }
  return zeilen;
}

function berichtPruefungen(e) {
  if (e.pruefungen.kommandos.length === 0) {
    return ["## Pruefungen", "", "Kein Pruefstand in den einbezogenen Staenden.", ""];
  }
  // "Dauer gemessen in" statt "Grundlage": Die Zahl der Ausfuehrungen zaehlt ueber alle
  // einbezogenen Laeufe, die Dauer nur ueber die, die sie ueberhaupt messen — seit
  // Issue #747. Eine gemeinsame Spalte liesse offen, worauf sich welche Zahl stuetzt.
  return [
    "## Pruefungen", "",
    "| Kommando | Ausfuehrungen | Dauer | Dauer gemessen in |", "| --- | --- | --- | --- |",
    ...e.pruefungen.kommandos.map((k) => `| \`${k.cmd}\` | ${k.anzahl} | ${dauer(k.dauerMs)} | ${laufText(k.laeufe)} |`),
    "", `Summe der gemessenen Pruefzeit: ${kennzahl(e.pruefungen.gesamtMs, dauer)}.`, "",
  ];
}

function berichtUmfang(e) {
  const staende = e.umfang.voll + e.umfang.eingegrenzt + e.umfang.unbekannt;
  return [
    "## Umfang der Pruefungen", "",
    `Von ${staende} Pruefstaenden (${laufText(e.umfang.laeufe)}) liefen ${e.umfang.voll} im vollen Umfang, `
    + `${e.umfang.eingegrenzt} eingegrenzt und ${e.umfang.unbekannt} ohne Angabe dazu. `
    + "Ein Stand ohne Angabe zaehlt als unbekannt, nie als eingegrenzt.",
    "",
  ];
}

function berichtKosten(e) {
  const zeilen = ["## Kosten", "", "| Posten | Betrag | Grundlage |", "| --- | --- | --- |"];
  for (const [name, feld] of [
    ["Lesekosten (Eingabe, Cache-Erzeugung, Cache-Lesen)", e.kosten.lesenUsd],
    ["Schreibkosten (Ausgabe)", e.kosten.schreibenUsd],
    ["Nicht zuordenbar", e.kosten.nichtZuordenbarUsd],
    ["Gesamt", e.kosten.gesamtUsd],
  ]) {
    zeilen.push(`| ${name} | ${geld(feld.wert)} | ${laufText(feld.laeufe)} |`);
  }
  zeilen.push("", kostenHinweise(e).join("\n"), "");
  return zeilen;
}

/**
 * Ein Zaehler mit seiner Traglast — dieselbe Form wie `kennzahl`, nur fuer gezaehlte
 * Faelle statt gemessener Werte.
 *
 * Bei 0 steht die Null ALLEIN: Ein Fall, der nicht eintrat, hat keine tragenden Laeufe,
 * und "ohne einen einzigen Lauf" daneben laese sich als "nicht gemessen" — das Gegenteil
 * der Aussage.
 */
function zaehlzelle(feld) {
  return feld.wert === 0 ? "0" : `${feld.wert} (${laufText(feld.laeufe)})`;
}

/**
 * Ein Messwert mit seiner Traglast. Ein nicht gemessener Wert steht ALLEIN da: Die
 * Traglast eines Werts, den es nicht gibt, ist keine Auskunft, sondern eine Dopplung.
 */
function messzelle(feld, formatieren) {
  return feld.wert === null ? NICHT_GEMESSEN : kennzahl(feld, formatieren);
}

/**
 * Aufwand je Aufgabenstufe und Gruendlichkeit (Issue #848).
 *
 * Der Abschnitt macht die Frage des Fachplans ohne Vergleichslauf beantwortbar: Was kostet
 * eine Stufe an Zeit und Geld, und wie oft muss danach nachgearbeitet werden. Gezaehlt
 * werden nur Einheiten mit gestarteter Session (siehe `mitSession`); die Kosten sind die
 * je Einheit GEMELDETEN Betraege, nicht die gerechnete Teilung aus dem Abschnitt "Kosten"
 * — sie liegen ohne Preistabelle und ohne Token-Mengen vor.
 */
function berichtStufen(e) {
  if (e.jeStufe.length === 0) {
    return [
      "## Nach Aufgabenstufe", "",
      "Keine Einheit mit gestarteter Session in den einbezogenen Staenden — es gibt nichts zu vergleichen.", "",
    ];
  }
  const zeilen = [
    "## Nach Aufgabenstufe", "",
    "| Stufe | Gruendlichkeit | Einheiten | Dauer | Kosten | Rote Pruefstaende | Nacharbeit |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...e.jeStufe.map((z) => "| " + [
      z.stufe ?? "ohne Stufe",
      z.effort ?? "Voreinstellung",
      zaehlzelle(z.einheiten),
      messzelle(z.dauerMs, dauer),
      messzelle(z.kostenUsd, geld),
      zaehlzelle(z.rotePruefstaende),
      zaehlzelle(z.nacharbeit),
    ].join(" | ") + " |"),
    "",
  ];
  // Die Definition steht unter der Tabelle und nicht in der Dokumentation allein: Wer die
  // Spalte liest, muss wissen, was sie zaehlt — sonst haelt er jede zurueckgestellte Karte
  // fuer Nacharbeit oder umgekehrt jede rote Pruefung fuer erledigt.
  zeilen.push(
    "Als Nacharbeit zaehlt eine Einheit, deren Endstatus nicht `in_review` ist oder deren Pruefstand rot war. "
    + "Gezaehlt werden nur Arbeitspakete mit gestarteter Session; Einheiten ohne Session (uebersprungen, "
    + "liegengeblieben, zurueckgestellt) und die Einheiten der Kette bleiben aussen vor. Die Kosten sind die je "
    + "Einheit gemeldeten Betraege, nicht die gerechnete Teilung aus dem Abschnitt Kosten.",
    ""
  );
  if (e.jeStufe.some((z) => z.stufe === null)) {
    zeilen.push("Einheiten ohne Aufgabenstufe: Modell von der Karte oder vom Lauf, Staende vor #711.", "");
  }
  return zeilen;
}

function berichtBefund(e) {
  const zeilen = ["## Befund", ""];
  if (e.befund.length === 0) zeilen.push("Keine der vier Schwellen ist ueberschritten.", "");
  else zeilen.push(...e.befund.map((b) => `- ${b.text}`), "");
  const eingrenzung = e.schwellen.eingrenzungOhneWirkung ? "geprueft" : "abgeschaltet";
  zeilen.push(
    "Schwellen dieses Laufs: "
    + `Anteil einer einzelnen Pruefung ${prozent(e.schwellen.pruefungAnteil)}, `
    + `Werkzeugarbeit ${prozent(e.schwellen.werkzeugAnteil)}, `
    + `Schreibkosten ${prozent(e.schwellen.schreibkostenAnteil)}, `
    + `Eingrenzung ohne Wirkung ${eingrenzung}.`,
    ""
  );
  // Was sich nicht bestimmen liess, steht ausdruecklich da: Sonst laese sich sein
  // Schweigen als Unauffaelligkeit.
  if (e.nichtBestimmbar.length > 0) {
    zeilen.push(
      `Nicht bestimmbar mangels Messwerten: ${e.nichtBestimmbar.join(", ")}. `
      + "Das ist kein Beleg dafuer, dass dort nichts auffaellt.",
      ""
    );
  }
  return zeilen;
}

function berichtFuss(e) {
  const zeilen = [];
  if (e.laeufe.unvollstaendig.length > 0) {
    zeilen.push(
      "## Unvollstaendige Laeufe", "",
      ...e.laeufe.unvollstaendig.map((u) => `- ${u.stempel}: ${u.gruende.join("; ")}`),
      "", "Sie gehen mit dem ein, was sie tragen — verworfen saehen die Summen vollstaendig aus und waeren zu klein.", ""
    );
  }
  if (e.laeufe.unlesbar.length > 0) zeilen.push(unlesbarAbsatz(e), "");
  if (e.configGelesen) zeilen.push(`Hinweis zur Konfiguration: ${e.configGelesen} — es gelten die Vorgaben.`, "");
  zeilen.push(dauerzeile(e), "");
  return zeilen;
}

/** Die eigene Laufzeit — gemessen bis vor das Schreiben dieser Datei, nicht darueber hinaus. */
function dauerzeile(e) {
  return `Die Auswertung selbst dauerte ${dauer(e.dauerMs)} (ohne das Schreiben dieser Datei).`;
}

function unlesbarAbsatz(e) {
  const liste = e.laeufe.unlesbar.map((u) => `- ${u.datei}: ${u.fehler}`).join("\n");
  return `## Unlesbare Staende\n\n${liste}`;
}

function kostenHinweise(e) {
  const hinweise = [];
  if (e.kosten.preistabelle === null) {
    hinweise.push(
      "Die Preistabelle `kit/preise.mjs` liegt nicht daneben: Die Kostenteilung in Lesen und Schreiben entfaellt. "
      + "Der gemeldete Gesamtbetrag steht weiter, geraten wird kein Satz."
    );
  } else {
    hinweise.push(`Gerechnet mit der Preistabelle vom ${e.kosten.preistabelle}.`);
  }
  if (e.kosten.ohneTeilung.einheiten > 0) {
    hinweise.push(
      `Bei ${e.kosten.ohneTeilung.einheiten} Einheiten lagen ${e.kosten.ohneTeilung.tokens} Token der Cache-Erzeugung `
      + "ohne Teilung nach Haltedauer vor. Sie wurden mit dem Stunden-Satz bepreist — dem teureren. "
      + "Der Betrag ist insoweit eine Obergrenze und kein Messwert."
    );
  }
  if (e.kosten.ohneMengen.einheiten > 0) {
    hinweise.push(
      `Bei ${e.kosten.ohneMengen.einheiten} Einheiten liegt keine einzige Token-Menge vor. `
      + "Ihr gemeldeter Betrag steht unter 'nicht zuordenbar'; geteilt wird er nicht. "
      + "Eine fehlende Menge wird nicht als 0 gerechnet — sonst verschwaende der Betrag zwischen den Posten."
    );
  }
  if (e.kosten.ohnePreissatz.einheiten > 0) {
    const modelle = e.kosten.ohnePreissatz.modelle.length > 0 ? e.kosten.ohnePreissatz.modelle.join(", ") : "ohne Modellangabe";
    hinweise.push(
      `Fuer ${e.kosten.ohnePreissatz.einheiten} Einheiten kennt die Preistabelle keinen Satz (${modelle}). `
      + "Ihr gemeldeter Betrag steht unter 'nicht zuordenbar'; geteilt wird er nicht."
    );
  }
  return hinweise;
}

/**
 * Der Befundblock als Text — die eine Form, die an beiden Ausgabestellen erscheint.
 *
 * Ohne Befund eine LEERE Zeichenkette, nicht eine mit Kopfzeile: Kriterium 11 verlangt
 * Schweigen bei Unauffaelligkeit, und die Kopfzeile allein waere schon der beruhigende
 * Satz, den es ausschliesst.
 */
export function befundText(stand) {
  const befund = Array.isArray(stand?.befund) ? stand.befund : [];
  if (befund.length === 0) return "";
  const kopf = `Auswertung vom ${stand.erzeugtAm} ${laufText(stand.laeufe?.einbezogen ?? 0)} bis ${stand.juengsterLauf}.`;
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
 * `.claude/aufwand.json` geht und auf stdout steht: eine Form, nicht zwei.
 */
export function auswerten(root, { laeufe: grenzeArg } = {}) {
  // Kriterium 13 gibt der Auswertung ein Zeitbudget. Sie misst sich deshalb selbst,
  // statt das einem `time` davor zu ueberlassen: So steht der Wert in jedem Lauf und
  // nicht nur dort, wo jemand daran gedacht hat.
  const gestartet = process.hrtime.bigint();
  const einstellungen = ladeEinstellungen(root);
  const grenze = grenzeArg ?? einstellungen.laeufe;
  const { staende, gefunden, unlesbar } = ladeStaende(root, grenze);
  const a = aggregieren(staende);
  const { befund, nichtBestimmbar } = schwellenPruefen(a, einstellungen.schwellen);

  const ergebnis = {
    erzeugtAm: new Date().toISOString(),
    juengsterLauf: staende[0]?.stempel ?? null,
    kitVersion: KIT_VERSION,
    laeufe: {
      gefunden,
      einbezogen: staende.length,
      grenze,
      stempel: staende.map((s) => s.stempel),
      unvollstaendig: a.unvollstaendig,
      unlesbar,
    },
    einheiten: a.einheiten,
    wartendBeendet: a.wartendBeendet,
    zeit: a.zeit,
    pruefungen: a.pruefungen,
    umfang: a.umfang,
    eingrenzung: a.eingrenzung,
    kosten: a.kosten,
    // Haengt hinten an den Aggregaten (Issue #848): Die bestehenden Bloecke behalten Namen
    // und Platz — sie sind der Vertrag mit den beiden Ausgabestellen.
    jeStufe: a.jeStufe,
    schwellen: einstellungen.schwellen,
    nichtBestimmbar,
    // Immer gesetzt, auch leer: Eine neuere Auswertung ohne Befund loescht damit den
    // alten Stand (Kriterium 9). Ein ausgelassenes Feld liesse den Befund von gestern
    // ueber dem unauffaelligen Lauf von heute stehen.
    befund,
    configGelesen: einstellungen.configGelesen,
    dauerMs: Math.round(Number(process.hrtime.bigint() - gestartet) / 1e6),
  };

  schreibeDatei(join(root, CLAUDE_DIR, BERICHT_DATEI), berichtText(ergebnis));
  schreibeDatei(join(root, CLAUDE_DIR, STAND_DATEI), JSON.stringify(ergebnis, null, 2) + "\n");
  return ergebnis;
}

/**
 * Der Befund als Text. Nie ein Fehler: Eine fehlende oder unlesbare Datei ist dasselbe
 * wie kein Befund — an beiden Ausgabestellen soll dann nichts stehen, und nichts soll
 * aufgehalten werden (Kriterium 10).
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
    if (rest[i] !== "--laeufe") fail(`Unbekanntes Argument: '${rest[i]}'`);
    const wert = Number(rest[i + 1]);
    if (!Number.isInteger(wert) || wert <= 0) {
      fail(`--laeufe erwartet eine ganze Zahl groesser null, bekam '${rest[i + 1] ?? ""}'.`);
    }
    args.laeufe = wert;
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
    // Kommandos wird maschinell gelesen (night.mjs legt sie am Lauf-Kopf ab). Ein
    // Fliesstext-Fehler mittendrin machte aus jedem Fehlerfall einen Parse-Fehler
    // beim Aufrufer.
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
    // leer — sonst stuende eine Fehlermeldung im Laufprotokoll, wo ein Befund hingehoert.
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
    const prefix = err instanceof AufwandError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
