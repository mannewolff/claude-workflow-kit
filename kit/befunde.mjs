#!/usr/bin/env node
/**
 * claude-workflow-kit Befunde der Modell-Pruefungen (Issue #799, Plan #797, Fachliche Quelle #768)
 *
 * Haelt die feste Liste der Mangel-Arten und prueft die Form eines Funds: `arten` gibt
 * die zwoelf Arten mit je einem erklaerenden Satz aus, `pruefen --datei <f>` liest einen
 * Befunde-Text und meldet je Fund, welche der drei Pflichtangaben aus dem Abschnitt
 * „Befunde der Modell-Pruefungen" (templates/CLAUDE-workflow.md) fehlt.
 *
 * `buchen --datei <f> --stufe <s> --karte <n>` (Issue #802) schreibt je Fund mit
 * bestaetigter Gegenprobe UND Uebernahmevermerk eine Zeile nach `.claude/befunde.tsv`
 * — anhaengend, nie leerend — und meldet je beruehrter Art den neuen Zaehlerstand und
 * ob die Schwelle erreicht ist. Nicht gepruefte, unvollstaendige und abgelehnte Funde
 * sind keine Vorkommen (AK 7 der fachlichen Quelle #768). Fuer die Stufe `code`
 * ermittelt es zusaetzlich den Vergleichsstand: ob die maschinellen Pflichtpruefungen
 * auf demselben Stand gruen waren (AK 10, Plan #797 E12).
 *
 * WARUM EIN EIGENES WERKZEUG UND KEIN ANBAU AN wirksamkeit.mjs (Plan #797, E1):
 * `wirksamkeit.mjs` misst die Pflichtpruefungen aus `ausfuehrungen.tsv` und
 * `bewegungen.tsv`; Funde von Modellen sind eine andere Quelle und ein anderer
 * Gegenstand, und die Datei traegt bereits rund 960 Zeilen.
 *
 * DIE ARTENLISTE HAT GENAU EINEN WORTLAUT (E4): diesen hier. Der Regeltext zaehlt die
 * Arten nicht auf, sondern verweist auf `befunde arten`, und die Skills setzen sie
 * kuenftig ueber dieses Kommando in ihre Prompts ein. Zwei Orte driften auseinander,
 * sobald eine Art hinzukommt oder ihren Namen wechselt — und die Formpruefung laege
 * dann gegen einen anderen Wortlaut als der Prompt. Ein Projekt ergaenzt keine eigenen
 * Arten; `sonstiges` ist die Auffang-Art.
 *
 * AUS DER FORM WIRD KEIN GATE: Eine fehlende Angabe haelt nichts auf, deshalb endet
 * `pruefen` auch mit lauter unvollstaendigen Funden mit Exit 0. Ungleich 0 wird es nur,
 * wenn der Aufruf selbst nicht geht — fehlendes `--datei`, fehlende oder unlesbare Datei.
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
 * Aufruf im Projekt-Root:  node .claude/kit/befunde.mjs arten
 *                          node .claude/kit/befunde.mjs pruefen --datei <pfad>
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit liefert
 * seine Werkzeuge als eigenstaendig portable Einzeldateien aus.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.0.0";

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
  throw new BefundeError(`checks.mjs liegt nicht neben befunde.mjs (${NACHBAR_CHECKS}) — 'buchen --stufe code' braucht blobHashes und den Ort der Pruef-Zusammenfassung aus dem Nachbarn.`);
};
const { blobHashes, zusammenfassungPfad } = existsSync(NACHBAR_CHECKS)
  ? await import(pathToFileURL(NACHBAR_CHECKS).href)
  : { blobHashes: nachbarFehlt, zusammenfassungPfad: nachbarFehlt };

/**
 * Die zwoelf Mangel-Arten. Grob statt feinmaschig (Nicht-Ziel des Fachkonzepts): Sie
 * decken die Fragen aller fuenf heutigen Rollen-Prompts ab und lassen sich in einem
 * Satz erklaeren. Die Reihenfolge ist die des Plans und bleibt stabil — die Skills
 * setzen die Liste woertlich in ihre Prompts ein.
 */
const ARTEN = [
  { name: "bestandsbehauptung", erklaerung: "Der geprueste Text behauptet etwas ueber den Bestand — eine Datei, eine Zeile, ein Verhalten —, das dort nicht so steht." },
  { name: "unbeobachtbar", erklaerung: "Eine Zusage ist so formuliert, dass sich nicht beobachten laesst, ob sie erfuellt ist." },
  { name: "widerspruch", erklaerung: "Zwei Stellen desselben Texts oder der Text und eine bindende Quelle sagen Verschiedenes." },
  { name: "luecke", erklaerung: "Ein fuer das Ziel noetiger Fall, Schritt oder Bereich fehlt ganz." },
  { name: "unbestimmt", erklaerung: "Eine Angabe laesst mehrere Auslegungen zu, und die Wahl aendert das Ergebnis." },
  { name: "form", erklaerung: "Der Text verletzt eine vorgeschriebene Form — ein Abschnitt, ein Feld, eine Reihenfolge, ein Format." },
  { name: "doppelung", erklaerung: "Dieselbe Aussage steht an zwei Orten, die auseinanderdriften koennen." },
  { name: "korrektheit", erklaerung: "Der beschriebene oder geschriebene Weg fuehrt zu einem falschen Ergebnis." },
  { name: "sicherheit", erklaerung: "Die Aenderung oeffnet einen Zugang, verraet ein Geheimnis oder umgeht eine Schranke." },
  { name: "test", erklaerung: "Ein Beleg fehlt, prueft am Gegenstand vorbei oder kann gar nicht fehlschlagen." },
  { name: "konvention", erklaerung: "Die Stelle weicht ohne Grund von einem im Projekt eingefuehrten Muster ab." },
  { name: "sonstiges", erklaerung: "Auffang-Art fuer einen Fund, der in keine der elf anderen passt; ein Projekt ergaenzt keine eigenen Arten." },
];

const ARTEN_NAMEN = new Set(ARTEN.map((a) => a.name));

const MARKEN = ["KRITISCH", "BLOCKER", "WICHTIG", "HINWEIS"];

// Markdown-Dekoration am Zeilenanfang und -ende: Ueberschriftenraute, Fettmarkierung,
// Listenpunkt, Zitatzeichen. Abgezogen wird sie, damit '#### BLOCKER' und
// '**KRITISCH — Titel**' dieselbe Marke ergeben.
const DEKO_VORN_RE = /^[\s>#*_]+/;
const DEKO_HINTEN_RE = /[\s*_#]+$/;

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

// Die Pflichtzeilen eines Funds. `^Gegenprobe\s*:` trifft bewusst nicht auf
// 'Gegenprobe am Bestand:' — die Form verlangt genau diese Zeile, und eine
// grosszuegigere Erkennung liesse die Altform als erfuellt erscheinen.
const GEGENPROBE_RE = /^Gegenprobe\s*:\s*(.*)$/;
const ART_RE = /^Art\s*:\s*(.*)$/;

// Der Stand am Ende der Gegenprobe-Zeile. Die Umlautfassung gilt mit: Der Regeltext
// schreibt das Kit-uebliche ASCII, aber die Funde kommen von Modellen, die
// 'geprüft, bestätigt' schreiben — eine Meldung darueber waere eine falsche Meldung.
const STAND_RE = /[—–-]\s*(geprueft|geprüft)\s*,\s*(bestaetigt|bestätigt)\s*\.?\s*$|[—–-]\s*nicht\s+(geprueft|geprüft)\s*\.?\s*$/i;

const BUCHEN_STUFEN = ["fachlich", "plan", "issue", "code"];

// Vorgabe des Config-Blocks `befunde.schwelle` (Issue #800): Ab so vielen Vorkommen
// einer Art oberhalb ihres Nullpunkts meldet `buchen` die Schwelle als erreicht.
const SCHWELLE_VORGABE = 3;

const ANGABEN = {
  gegenprobe: "Die Zeile 'Gegenprobe: <Beobachtung, die den Fund widerlegen wuerde>' fehlt oder nennt vor ihrem Stand keine Beobachtung.",
  stand: "Der Stand der Gegenprobe fehlt — erwartet wird '— geprueft, bestaetigt' oder '— nicht geprueft' am Zeilenende.",
  art: "Die Zeile 'Art: <name>' fehlt; gueltig sind die Namen aus 'befunde arten'.",
};

const HELP = `befunde.mjs (claude-workflow-kit v${KIT_VERSION}) — Form und Arten der Funde

  node befunde.mjs arten
  node befunde.mjs pruefen --datei <pfad>
  node befunde.mjs buchen --datei <pfad> --stufe <fachlich|plan|issue|code> --karte <n>

arten    Gibt die ${ARTEN.length} Mangel-Arten mit je einem erklaerenden Satz aus. Diese Liste
         ist der einzige Wortlaut im Kit; ein Projekt ergaenzt keine eigenen Arten.
pruefen  Liest einen Befunde-Text, erkennt die Fundbloecke an ihrer Schweregrad-Marke
         (${MARKEN.join(", ")}) und meldet je Fund die
         fehlenden der drei Pflichtangaben: die Gegenprobe, ihren Stand und die Art.
         Exit 0 auch bei lauter unvollstaendigen Funden — aus der Form wird kein Gate.
         Ungleich 0 wird nur ein Aufruf, der nicht geht: fehlendes --datei, fehlende
         oder unlesbare Datei.
buchen   Schreibt je Fund mit 'Gegenprobe: … — geprueft, bestaetigt' UND
         'Uebernahme: uebernommen' eine Zeile nach .claude/befunde.tsv — anhaengend,
         nie leerend — und meldet je beruehrter Art den neuen Zaehlerstand und ob die
         Schwelle (Config-Block befunde.schwelle, Vorgabe ${SCHWELLE_VORGABE}) erreicht ist. Bei
         --stufe code steht in der letzten Spalte der Vergleichsstand der
         Pflichtpruefungen ('gruen' oder 'nicht-vergleichbar'), sonst '-'.

  --version   Kit-Stand dieser Datei.
  --help, -h  Diese Uebersicht.

Die Ausgabe beider Kommandos ist immer JSON auf stdout — auch im Leerfall und auch bei
einem abgewiesenen Aufruf.
`;

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
  return vorn.replace(DEKO_HINTEN_RE, "");
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
      if (offen !== null && offen.nurUeberschrift) funde.pop();
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
  const stand = STAND_RE.exec(rest);
  return {
    beobachtung: (stand === null ? rest : rest.slice(0, stand.index)).trim(),
    hatStand: stand !== null,
  };
}

/** Welche der drei Pflichtangaben einem Fund fehlen, in fester Reihenfolge. */
function fehlendeAngaben(fund) {
  const zeilen = [fund.titel, ...fund.zeilen];
  const gegenprobe = zeilen.map((z) => GEGENPROBE_RE.exec(z)).find((t) => t !== null);
  const art = zeilen.map((z) => ART_RE.exec(z)).find((t) => t !== null);

  const fehlt = [];
  if (!gegenprobe) {
    // Ohne die Zeile fehlt auch ihr Stand — beides sind eigene Angaben, und ein
    // stillschweigend unterschlagener Stand liesse den Fund vollstaendiger aussehen.
    fehlt.push("gegenprobe", "stand");
  } else {
    // Der Stand allein ist keine Gegenprobe: 'Gegenprobe: — nicht geprueft' nennt nicht
    // „die Beobachtung, die ihn widerlegen wuerde" (templates/CLAUDE-workflow.md), und
    // als vollstaendig gezaehlt saehe das Werkzeug einen Beleg, wo keiner steht.
    const { beobachtung, hatStand } = gegenprobeTeile(gegenprobe[1]);
    if (beobachtung === "") fehlt.push("gegenprobe");
    if (!hatStand) fehlt.push("stand");
  }

  let gefundeneArt = null;
  if (!art) {
    fehlt.push("art");
  } else {
    gefundeneArt = artName(art[1]);
    if (!ARTEN_NAMEN.has(gefundeneArt)) fehlt.push("art");
  }

  return { fehlt, art: gefundeneArt };
}

/** Die Meldung zu einer fehlenden Angabe; bei der Art nennt sie den vorgefundenen Namen. */
function meldung(angabe, gefundeneArt) {
  if (angabe === "art" && gefundeneArt) {
    return `Die Art '${gefundeneArt}' steht nicht in der Liste; gueltig sind die Namen aus 'befunde arten'.`;
  }
  return ANGABEN[angabe];
}

export function pruefen(pfad) {
  let text;
  try {
    text = readFileSync(pfad, "utf-8");
  } catch (err) {
    fail(`Datei nicht lesbar: ${pfad} (${err.code || err.message}).`);
  }

  const eintraege = [];
  const funde = fundeLesen(text).map((fund) => {
    const { fehlt, art } = fehlendeAngaben(fund);
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

  return {
    ok: true,
    datei: pfad,
    funde,
    eintraege,
    vollstaendig: funde.filter((f) => f.fehlt.length === 0).length,
    unvollstaendig: funde.filter((f) => f.fehlt.length > 0).length,
  };
}

export function arten() {
  return { ok: true, anzahl: ARTEN.length, arten: ARTEN };
}

// --- Buchen (Issue #802) -----------------------------------------------------

const PROTOKOLL_DATEI = ".claude/befunde.tsv";
const VORSCHLAEGE_DATEI = ".claude/befunde-vorschlaege.json";
const CONFIG_DATEI = ".claude/workflow.config.json";

// SYNC: dasselbe Praefix steht in kit/checks.mjs (WARTEND_PRAEFIX, Issue #546) —
// Aenderungen dort nachziehen. Die wartenden Vorhaben-Notizen fallen dort aus
// `geaendert` heraus und stehen darum nie in `hashes`; zaehlte der Vergleichsstand
// sie hier mit, waere jeder Lauf mit liegender Notiz faelschlich nicht-vergleichbar.
const WARTEND_PRAEFIX = ".claude/vorhaben-wartend-";

// Der Uebernahmevermerk der einarbeitenden Session, je Fundblock eine Zeile. Die
// Umlautfassung gilt mit, aus demselben Grund wie bei STAND_RE.
const UEBERNAHME_RE = /^(?:Uebernahme|Übernahme)\s*:\s*(.*)$/;

// Die Kennzeichnung aus E6 (Plan #797): Ein so markierter Fund ist kein Vorkommen,
// auch wenn seine uebrigen Angaben vollstaendig aussehen.
const UNVOLLSTAENDIG_RE = /^Angaben\s*:\s*unvollst(?:ae|ä)ndig/i;

// Der Reviewer-Kopf, wie /issue-review Schritt 5 ihn schreibt:
// '### Reviewer <n>: <rolle>, <modell>'. Die Rolle ist der Teil vor dem Komma; das
// Modell dahinter wird bewusst nicht gelesen — keine Spalte traegt es (E15).
const REVIEWER_RE = /^Reviewer\s+\d+\s*:\s*([^,]+),/;

/** Der Uebernahmevermerk eines Funds: 'uebernommen', 'abgelehnt' oder null. */
function uebernahmeVon(fund) {
  for (const zeile of fund.zeilen) {
    const treffer = UEBERNAHME_RE.exec(zeile);
    if (treffer === null) continue;
    const wert = treffer[1].replace(/^[\s*_]+/, "").toLowerCase();
    if (wert.startsWith("uebernommen") || wert.startsWith("übernommen")) return "uebernommen";
    if (wert.startsWith("abgelehnt")) return "abgelehnt";
    return null;
  }
  return null;
}

/** Ob die Gegenprobe eines Funds den Stand 'geprueft, bestaetigt' traegt. */
function gegenprobeBestaetigt(fund) {
  const zeilen = [fund.titel, ...fund.zeilen];
  const gegenprobe = zeilen.map((z) => GEGENPROBE_RE.exec(z)).find((t) => t !== null);
  if (!gegenprobe) return false;
  const stand = STAND_RE.exec(gegenprobe[1]);
  // Gruppe 2 ist das bestaetigt-Wort; der 'nicht geprueft'-Ast fuellt Gruppe 3.
  return stand !== null && stand[2] !== undefined;
}

/** Die Reviewer-Koepfe eines Texts mit ihrer Zeilennummer, in Textreihenfolge. */
function reviewerKoepfe(text) {
  const koepfe = [];
  for (const [i, zeile] of text.split("\n").entries()) {
    const treffer = REVIEWER_RE.exec(kern(zeile));
    if (treffer !== null) koepfe.push({ zeile: i + 1, rolle: treffer[1].trim() });
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
    return readFileSync(pfad, "utf-8").split("\n").filter((z) => z !== "");
  } catch (err) {
    if (err.code !== "ENOENT") {
      process.stderr.write(`Hinweis: Protokoll nicht lesbar (${pfad}): ${err.message}\n`);
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
    const config = JSON.parse(readFileSync(join(process.cwd(), ...CONFIG_DATEI.split("/")), "utf-8"));
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
    const daten = JSON.parse(readFileSync(join(process.cwd(), ...VORSCHLAEGE_DATEI.split("/")), "utf-8"));
    const wert = daten?.[art]?.nullpunkt;
    if (Number.isInteger(wert) && wert >= 0) return wert;
  } catch { /* keine Vorschlagsdatei ist der Regelfall — Nullpunkt null. */ }
  return 0;
}

function gitLauf(...args) {
  return spawnSync("git", args, { cwd: process.cwd(), encoding: "utf-8" });
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
  if (typeof basis !== "string" || basis === "") fail("die Zusammenfassung nennt keine Basis");
  const dateien = new Set();

  const diff = gitLauf("diff", "--name-status", "-z", basis);
  if (diff.status !== 0) fail(`git diff gegen '${basis}' schlug fehl: ${(diff.stderr || "").trim()}`);
  for (const pfad of diffPfade(diff.stdout)) dateien.add(pfad);

  const status = gitLauf("status", "--porcelain", "-z", "--untracked-files=all");
  if (status.status !== 0) fail(`git status schlug fehl: ${(status.stderr || "").trim()}`);
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
  const pfad = zusammenfassungPfad();
  let daten;
  try {
    daten = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    return "nicht-vergleichbar";
  }
  if (daten === null || typeof daten !== "object" || !Array.isArray(daten.laufen)
    || daten.hashes === null || typeof daten.hashes !== "object") return "nicht-vergleichbar";
  // Ausdruecklich `=== false`: Ein fehlendes Feld ist ein altes Format, kein Nein.
  if (daten.leeresPaket !== false) return "nicht-vergleichbar";
  if (daten.laufen.some((e) => e === null || typeof e !== "object" || e.ergebnis !== "gruen")) return "nicht-vergleichbar";
  try {
    const geaendert = heuteGeaendert(daten.basis);
    const aktuell = blobHashes(geaendert);
    for (const p of geaendert) {
      if (!(p in daten.hashes) || daten.hashes[p] !== aktuell[p]) return "nicht-vergleichbar";
    }
  } catch {
    return "nicht-vergleichbar";
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
    text = readFileSync(datei, "utf-8");
  } catch (err) {
    fail(`Datei nicht lesbar: ${datei} (${err.code || err.message}).`);
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

  const pfad = join(process.cwd(), ...PROTOKOLL_DATEI.split("/"));
  const bestand = zaehleArten(protokollZeilen(pfad));

  const zeitpunkt = new Date().toISOString();
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
      process.stderr.write(`Hinweis: Buchung nicht protokolliert (${pfad}): ${err.message}\n`);
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
    arten: [...beruehrt.keys()].sort().map((art) => {
      const stand = (bestand.get(art) ?? 0) + beruehrt.get(art);
      const nullpunkt = nullpunktFuer(art);
      // `>=` oberhalb des Nullpunkts (E20), nicht `==`: Ein uebersprungener Stand
      // verloere den Treffer sonst dauerhaft.
      return { art, stand, nullpunkt, erreicht: stand - nullpunkt >= schwelle };
    }),
  };
}

// --- CLI ---------------------------------------------------------------------

function parsePruefenArgs(rest) {
  let datei = null;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] !== "--datei") fail(`Unbekanntes Argument: '${rest[i]}'`);
    datei = rest[i + 1];
    if (!datei) fail("--datei erwartet einen Pfad.");
    i += 1;
  }
  if (datei === null) fail("'pruefen' braucht --datei <pfad>.");
  return datei;
}

function parseBuchenArgs(rest) {
  const werte = { datei: null, stufe: null, karte: null };
  const optionen = { "--datei": "datei", "--stufe": "stufe", "--karte": "karte" };
  for (let i = 0; i < rest.length; i += 1) {
    const feld = optionen[rest[i]];
    if (!feld) fail(`Unbekanntes Argument: '${rest[i]}'`);
    werte[feld] = rest[i + 1];
    if (!werte[feld]) fail(`${rest[i]} erwartet einen Wert.`);
    i += 1;
  }
  if (werte.datei === null || werte.stufe === null || werte.karte === null) {
    fail("'buchen' braucht --datei <pfad>, --stufe <stufe> und --karte <n>.");
  }
  if (!BUCHEN_STUFEN.includes(werte.stufe)) {
    fail(`Unbekannte Stufe: '${werte.stufe}'. Erwartet: ${BUCHEN_STUFEN.join(", ")}.`);
  }
  return werte;
}

/** Immer JSON auf stdout — auch hier, wo der Aufruf abgewiesen wird. */
function alsJson(bauen) {
  try {
    process.stdout.write(JSON.stringify(bauen(), null, 2) + "\n");
    return 0;
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, fehler: err.message }, null, 2) + "\n");
    return 1;
  }
}

function main() {
  const argv = process.argv.slice(2);

  // Die einzigen beiden Textausgaben: Beide richten sich an einen Menschen am Terminal,
  // nicht an einen Aufrufer.
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === "--version") {
    process.stdout.write(`${KIT_VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === "arten") {
    return alsJson(() => {
      if (rest.length > 0) fail(`'arten' nimmt keine Argumente, bekam '${rest[0]}'.`);
      return arten();
    });
  }
  if (command === "pruefen") {
    return alsJson(() => pruefen(parsePruefenArgs(rest)));
  }
  if (command === "buchen") {
    return alsJson(() => buchen(parseBuchenArgs(rest)));
  }

  // Auch der Aufruf ohne Kommando ist ein Fehler mit JSON-Ausgabe: Wer dieses Werkzeug
  // ruft, liest seine Ausgabe maschinell, und ein Hilfetext auf stdout waere dort ein
  // Parse-Fehler. Die Uebersicht geht deshalb nach stderr.
  process.stderr.write(HELP);
  return alsJson(() => fail(command === undefined
    ? `Kein Kommando. Erwartet: ${["arten", "pruefen", "buchen"].join(", ")}.`
    : `Unbekannter Befehl: '${command}'. Erwartet: arten, pruefen oder buchen.`));
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
    const prefix = err instanceof BefundeError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
