#!/usr/bin/env node
/**
 * claude-workflow-kit Befunde der Modell-Pruefungen (Issue #799, Plan #797, Fachliche Quelle #768)
 *
 * Haelt die feste Liste der Mangel-Arten und prueft die Form eines Funds: `arten` gibt
 * die zwoelf Arten mit je einem erklaerenden Satz aus, `pruefen --datei <f>` liest einen
 * Befunde-Text und meldet je Fund, welche der drei Pflichtangaben aus dem Abschnitt
 * „Befunde der Modell-Pruefungen" (templates/CLAUDE-workflow.md) fehlt.
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

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "2.0.8";

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

const ANGABEN = {
  gegenprobe: "Die Zeile 'Gegenprobe: <Beobachtung, die den Fund widerlegen wuerde>' fehlt oder nennt vor ihrem Stand keine Beobachtung.",
  stand: "Der Stand der Gegenprobe fehlt — erwartet wird '— geprueft, bestaetigt' oder '— nicht geprueft' am Zeilenende.",
  art: "Die Zeile 'Art: <name>' fehlt; gueltig sind die Namen aus 'befunde arten'.",
};

const HELP = `befunde.mjs (claude-workflow-kit v${KIT_VERSION}) — Form und Arten der Funde

  node befunde.mjs arten
  node befunde.mjs pruefen --datei <pfad>

arten    Gibt die ${ARTEN.length} Mangel-Arten mit je einem erklaerenden Satz aus. Diese Liste
         ist der einzige Wortlaut im Kit; ein Projekt ergaenzt keine eigenen Arten.
pruefen  Liest einen Befunde-Text, erkennt die Fundbloecke an ihrer Schweregrad-Marke
         (${MARKEN.join(", ")}) und meldet je Fund die
         fehlenden der drei Pflichtangaben: die Gegenprobe, ihren Stand und die Art.
         Exit 0 auch bei lauter unvollstaendigen Funden — aus der Form wird kein Gate.
         Ungleich 0 wird nur ein Aufruf, der nicht geht: fehlendes --datei, fehlende
         oder unlesbare Datei.

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

  // Auch der Aufruf ohne Kommando ist ein Fehler mit JSON-Ausgabe: Wer dieses Werkzeug
  // ruft, liest seine Ausgabe maschinell, und ein Hilfetext auf stdout waere dort ein
  // Parse-Fehler. Die Uebersicht geht deshalb nach stderr.
  process.stderr.write(HELP);
  return alsJson(() => fail(command === undefined
    ? `Kein Kommando. Erwartet: ${["arten", "pruefen"].join(" oder ")}.`
    : `Unbekannter Befehl: '${command}'. Erwartet: arten oder pruefen.`));
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
