/**
 * board/szenarien.mjs — der Abschnitt Szenarien im Fachplan (Issue #1589, Plan #1588 A1 bis
 * A7, E1 bis E3): lesen, ob ein Szenario vollstaendig ist, ob eine Karte die Pflicht traegt,
 * und die Meldung bei einem Verstoss.
 *
 * Formpruefung, Anlegen, Grooming und Nacht-Kette brauchen dieselbe Antwort auf „ist diese
 * Karte pflichtig, und traegt sie ein vollstaendiges Szenario?" (A7). Sie lesen sie hier;
 * Kopien liefen beim ersten Aendern auseinander.
 *
 * Ein Szenario ist `### Szenario: <Titel>` mit Listenzeilen, die mit `Angenommen`, `Wenn`,
 * `Dann`, `Und` beginnen (A2). Vollstaendig ist es mit Titel und je mindestens einer Zeile
 * `Angenommen`, `Wenn`, `Dann` in dieser Reihenfolge (A3). Die Ueberschriften gelten in beiden
 * Sprachen, die Schluesselwoerter nur in der Projektsprache (E2). Was in einem Codeblock
 * steht, existiert fuer die Pruefung nicht — dieselbe Fence-Auslegung wie `zerlegeAbschnitte`.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { zerlegeAbschnitte, abschnittsTitel } from "./dokumente.mjs";
import { gherkinWort, normUeberschrift, prozessSprache, text, ueberschriftName } from "./namen.mjs";
import { SCHLUESSEL } from "./config-namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-szenarien.mjs.
import { TEXTE } from "../texte/board-szenarien.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

/** Das Kommando, das den Stichtag ermittelt (Plan #1588 E3). */
export const STICHTAG_KOMMANDO = "node .claude/kit/board.mjs scenarios baseline";

const [SZENARIEN, KRITERIEN, NICHT_ZIELE] = abschnittsTitel("szenarien", "fachlicheKriterien", "nichtZiele");

// Die Kopfzeile eines Szenarios: `###` und der Rest; die Ueberschrift prueft `szenarioTitel`.
const SZENARIO_KOPF = /^ {0,3}###(?!#)(.*)$/;
// Eine Listenzeile und ihr erstes Wort.
const LISTENZEILE = /^ {0,3}[-*+][ \t]+(\S+)/;

/**
 * Der Titel hinter `Szenario:` oder `Scenario:`, gleich in welcher Sprache (E2); `null`, wenn
 * die `###`-Zeile kein Szenario einleitet.
 */
function szenarioTitel(kopf) {
  const m = /^([^:]+):(.*)$/.exec(kopf.trim());
  if (!m) return null;
  const name = normUeberschrift(m[1]);
  const passt = ["de", "en"].some((s) => normUeberschrift(gherkinWort("szenario", s)) === name);
  return passt ? m[2].trim() : null;
}

/**
 * Liest den Abschnitt Szenarien aus dem Body: `{ vorhanden, lage, szenarien }`.
 *
 * `vorhanden` sagt, ob die Ueberschrift ausserhalb eines Codeblocks steht. `lage` ist
 * `"zwischen"`, wenn der Abschnitt hinter den fachlichen Kriterien und vor den Nicht-Zielen
 * steht (A1) — ein fehlender Nachbar zaehlt nicht dagegen, den meldet F1 —, sonst
 * `"ausserhalb"`; ohne Abschnitt `null`. Je Szenario stehen Titel, die nicht leeren Zeilen
 * darunter und `vollstaendig` in der Sprache `sprache`.
 */
export function szenarienLesen(body, sprache = prozessSprache()) {
  return lesenAus(zerlegeAbschnitte(body).abschnitte, sprache);
}

/** `szenarienLesen` auf den schon zerlegten Abschnitten, wie die Formpruefung sie hat. */
function lesenAus(abschnitte, sprache) {
  const titel = abschnitte.map((a) => a.titel);
  const index = titel.indexOf(SZENARIEN);
  if (index < 0) return { vorhanden: false, lage: null, szenarien: [] };

  const kriterien = titel.indexOf(KRITERIEN);
  const nichtZiele = titel.indexOf(NICHT_ZIELE);
  const zwischen = (kriterien < 0 || kriterien < index) && (nichtZiele < 0 || index < nichtZiele);

  const szenarien = [];
  let aktuell = null;
  for (const zeile of abschnitte[index].zeilen) {
    const kopf = SZENARIO_KOPF.exec(zeile);
    if (kopf) {
      const titelText = szenarioTitel(kopf[1]);
      aktuell = titelText === null ? null : { titel: titelText, zeilen: [] };
      if (aktuell) szenarien.push(aktuell);
      continue;
    }
    if (aktuell && zeile.trim() !== "") aktuell.zeilen.push(zeile);
  }
  return {
    vorhanden: true,
    lage: zwischen ? "zwischen" : "ausserhalb",
    szenarien: szenarien.map((s) => ({ ...s, vollstaendig: szenarioVollstaendig(s, sprache) })),
  };
}

/**
 * Ob ein Szenario vollstaendig ist (A3): ein Titel und je mindestens eine Listenzeile
 * `Angenommen`, `Wenn`, `Dann` in dieser Reihenfolge, die Schluesselwoerter in der Sprache
 * `sprache` (E2). `Und` und andere Zeilen dazwischen stoeren nicht.
 */
export function szenarioVollstaendig(szenario, sprache = prozessSprache()) {
  if (!szenario?.titel) return false;
  const folge = ["angenommen", "wenn", "dann"].map((sache) => gherkinWort(sache, sprache).toLowerCase());
  let schritt = 0;
  for (const zeile of szenario.zeilen ?? []) {
    const wort = LISTENZEILE.exec(zeile)?.[1].toLowerCase();
    if (wort === folge[schritt]) schritt += 1;
    if (schritt === folge.length) return true;
  }
  return false;
}

/** Der Stichtag aus der Config, gleich unter welchem Namen; `null`, wenn er fehlt oder keine Nummer ab 1 ist. */
function stichtag(config) {
  const wert = config?.szenarienAb ?? config?.[SCHLUESSEL.szenarienAb];
  return Number.isInteger(wert) && wert >= 1 ? wert : null;
}

/**
 * Ob die Karte `id` am Board die Pflicht traegt (A4 bis A6): `true` ab dem Stichtag
 * `szenarienAb`, `false` darunter, `"ohne-stichtag"`, wenn das Feld fehlt — dann gilt die
 * Pflicht fuer keine Karte am Board. Verglichen wird numerisch, auch bei gepolsterten
 * lokalen Nummern (E3). Eine Nummer, die keine ist, gilt als Altbestand.
 */
export function szenarienPflicht(id, config) {
  const ab = stichtag(config);
  if (ab === null) return "ohne-stichtag";
  const nummer = Number(id);
  return Number.isFinite(nummer) && nummer >= ab;
}

/** Die Form eines Szenarios in der Sprache `sprache`, wie die Meldung sie zeigt. */
function form(sprache) {
  const wort = (sache) => gherkinWort(sache, sprache);
  return [
    `## ${ueberschriftName("szenarien", sprache)}`,
    "",
    `### ${wort("szenario")}: ${t("platzTitel")}`,
    `- ${wort("angenommen")} ${t("platzAusgangslage")}`,
    `- ${wort("wenn")} ${t("platzHandlung")}`,
    `- ${wort("dann")} ${t("platzErgebnis")}`,
  ].join("\n");
}

/**
 * Die Meldung zum Abschnitt Szenarien oder `null`, wenn er passt: Er fehlt oder traegt kein
 * vollstaendiges Szenario, oder er steht nicht zwischen Kriterien und Nicht-Zielen (A1, A3).
 * Ein Satz, dahinter die Form eines Szenarios mit den Schluesselwoertern von `sprache`.
 */
export function szenarienVerstoss(body, sprache = prozessSprache()) {
  return szenarienVerstossIn(zerlegeAbschnitte(body).abschnitte, sprache);
}

/**
 * `szenarienVerstoss` auf den Abschnitten aus `zerlegeAbschnitte` — fuer Gate F12 in
 * `pruefeFachlich`, das den Body schon zerlegt hat (Issue #1590).
 */
export function szenarienVerstossIn(abschnitte, sprache = prozessSprache()) {
  const gelesen = lesenAus(abschnitte, sprache);
  let satz = null;
  if (!gelesen.szenarien.some((s) => s.vollstaendig)) {
    satz = t("fehlt");
  } else if (gelesen.lage !== "zwischen") {
    satz = t("lage", {
      kriterien: `## ${ueberschriftName("fachlicheKriterien", sprache)}`,
      nichtZiele: `## ${ueberschriftName("nichtZiele", sprache)}`,
    });
  }
  return satz === null ? null : `${satz}\n\n${t("formEinleitung")}\n\n${form(sprache)}`;
}

/** Der Hinweis, wenn `szenarienAb` fehlt, mit dem Kommando zum Nachholen (A6). */
export function stichtagHinweis(sprache = prozessSprache()) {
  const feld = sprache === "en" ? SCHLUESSEL.szenarienAb : "szenarienAb";
  return t("stichtagFehlt", { feld, kommando: STICHTAG_KOMMANDO });
}
