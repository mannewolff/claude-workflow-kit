/**
 * board/ereignis.mjs — die Wartezeile im Fachplan (Issue #1661, Plan #1624 E1, E3, E10):
 * lesen, setzen und entfernen der Zeile `Wartet auf Ereignis: <Grund>`.
 *
 * Ein Fachplan, der auf ein aeusseres Ereignis wartet, traegt die Zeile im Abschnitt Ziel,
 * neben `Autor-Modell:` und `Fachplan-Review:`. Nach ihr richtet sich die Nacht-Kette; das
 * Label `kit:on-hold` ist nur Hilfe am Board. Kommando, Kette und Tagesweg lesen und schreiben
 * die Zeile hier; Kopien liefen beim ersten Aendern auseinander.
 *
 * Gelesen wird allein der Abschnitt Ziel (`## Ziel` oder `## Goal`), die erste nicht leere
 * Zeile gilt. Eine gleichlautende Zeile in einer PO-Frage, einem Zitat, einem Codeblock oder
 * unter `## Vorgeschichte` zaehlt nicht — dieselbe Fence-Auslegung wie `zerlegeAbschnitte`.
 * Schreiben aendert nur die Wartezeile selbst; jedes andere Zeichen des Bodys bleibt stehen.
 *
 * `issueHold` ist das Kommando `issue hold` (Issue #1662, E2 bis E4): Es setzt oder hebt das
 * Warten eines Fachplans in einem Zug, Zeile und Label gleich. Das Kit ruft `--lift` nie selbst.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { LabelFehltError } from "./adapter.mjs";
import { BoardError } from "./grundlagen.mjs";
import { ABSCHNITT_ZEILE, abschnittsTitel, fenceLauf, istFachlich, zerlegeAbschnitte } from "./dokumente.mjs";
import { kanonischeUeberschrift, labelName, leseMarker, markerName, praefix, prozessSprache, text,
  ueberschriftName } from "./namen.mjs";
// Die Texte an den Menschen liegen unter kit/texte/board-ereignis.mjs (Issue #1662).
import { TEXTE } from "../texte/board-ereignis.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

const [ZIEL] = abschnittsTitel("ziel");

// Die Kennzeichnungszeilen, hinter die `mitEreignis` die Wartezeile setzt.
const KOPFZEILEN = new Set(["autorModell", "fachplanReview"]);

/** Der Rest hinter dem Wartemarker, wenn die Zeile ihn ganz vorn traegt; sonst `null`. */
function warteRest(zeile) {
  if (/^\s/.test(zeile)) return null;
  const m = leseMarker(zeile);
  return m?.sache === "ereignis" ? m.rest : null;
}

/** Der Grund aus der Wartezeile im Abschnitt Ziel; `null`, wenn keine Zeile einen traegt. */
export function ereignisGrund(body) {
  const ziel = zerlegeAbschnitte(body ?? "").abschnitte.find((a) => a.titel === ZIEL);
  for (const zeile of ziel?.zeilen ?? []) {
    const grund = warteRest(zeile)?.trim();
    if (grund) return grund;
  }
  return null;
}

/**
 * Zerlegt den Body in Zeilen samt Zeilenende, damit das Zusammensetzen jedes Zeichen
 * wiederherstellt. Je Zeile `imZiel`: Sie steht ausserhalb eines Codeblocks im ersten
 * Abschnitt Ziel; `ueberschrift` traegt jede `##`-Zeile, `kopf` die des Ziels.
 */
function zeilenMitLage(body) {
  const imFence = fenceLauf();
  let zielGesehen = false;
  let imZiel = false;
  // `split` mit erfasstem Trenner: Text und Zeilenende wechseln sich ab.
  const teile = String(body ?? "").split(/(\r\n|\r|\n)/);
  const roh = [];
  for (let i = 0; i < teile.length; i += 2) roh.push({ text: teile[i], ende: teile[i + 1] ?? "" });
  if (roh.at(-1).text === "" && roh.at(-1).ende === "") roh.pop();
  return roh.map(({ text, ende }) => {
    if (imFence(text)) return { text, ende, imZiel: false };
    const kopf = ABSCHNITT_ZEILE.exec(text);
    if (kopf) {
      imZiel = !zielGesehen && kanonischeUeberschrift(kopf[1]) === ZIEL;
      zielGesehen ||= imZiel;
      return { text, ende, imZiel: false, ueberschrift: true, kopf: imZiel };
    }
    return { text, ende, imZiel };
  });
}

const zusammen = (zeilen) => zeilen.map((z) => z.text + z.ende).join("");

const istWartezeile = (z) => z.imZiel && warteRest(z.text) !== null;

/** Der Body ohne jede Wartezeile im Abschnitt Ziel; alle anderen Zeichen bleiben stehen. */
export function ohneEreignis(body) {
  return zusammen(zeilenMitLage(body).filter((z) => !istWartezeile(z)));
}

/**
 * Der Body mit der Wartezeile `grund` im Abschnitt Ziel, in der Sprache `sprache`. Eine
 * vorhandene Wartezeile wird an ihrer Stelle ersetzt, weitere fallen weg. Sonst steht die
 * neue Zeile hinter der letzten Zeile `Autor-Modell:` oder `Fachplan-Review:` des Ziels,
 * ohne sie hinter seiner letzten nicht leeren Zeile. `null`, wenn der Body kein Ziel hat.
 */
export function mitEreignis(body, grund, sprache = prozessSprache()) {
  const zeilen = zeilenMitLage(body);
  const kopf = zeilen.findIndex((z) => z.kopf);
  if (kopf < 0) return null;
  const neu = `${markerName("ereignis", sprache)} ${String(grund).trim()}`;

  const vorhanden = zeilen.findIndex(istWartezeile);
  if (vorhanden >= 0) {
    const bleiben = zeilen.filter((z, i) => i === vorhanden || !istWartezeile(z));
    return zusammen(bleiben.map((z) => (z === zeilen[vorhanden] ? { ...z, text: neu } : z)));
  }

  let anker = kopf;
  let kennzeichnung = -1;
  for (let i = kopf + 1; i < zeilen.length && !zeilen[i].ueberschrift; i++) {
    if (zeilen[i].text.trim() !== "") anker = i;
    if (zeilen[i].imZiel && KOPFZEILEN.has(leseMarker(zeilen[i].text)?.sache)) kennzeichnung = i;
  }
  if (kennzeichnung >= 0) anker = kennzeichnung;
  const zeile = zeilen[anker];
  const ende = zeile.ende || "\n";
  const eingefuegt = { text: neu, ende: zeile.ende };
  return zusammen([...zeilen.slice(0, anker), { ...zeile, ende }, eingefuegt, ...zeilen.slice(anker + 1)]);
}

/**
 * `issue hold <id> --reason "<Grund>" | --lift` (Issue #1662, Plan #1624 E2 bis E4, E11).
 * `--reason` schreibt oder ersetzt die Wartezeile im Ziel und setzt `kit:on-hold`, `--lift`
 * entfernt jede Wartezeile im Ziel und nimmt das Label ab. Nur fuer Fachplaene (E4); weder
 * `kit:clarify` noch die Fragen an den PO werden beruehrt (E11). Der Body geht vor dem Label:
 * Nach der Zeile richtet sich die Nacht, das Label ist nur Hilfe am Board. Fehlt es dort,
 * steht die Zeile trotzdem, `label` ist `null` und `labelFehler` traegt die Meldung des
 * Adapters (E3). Ein Bedienfehler wirft BoardError, bevor die Karte beruehrt ist.
 *
 * Liefert `{ ok, id, wartet, label, labelFehler }`; die Ausgabe macht der Einstieg.
 */
export async function issueHold(tracker, config, args) {
  const { id, setzen, grund } = holdAuftrag(args);
  const issue = await tracker.getIssue(id);
  if (!istFachlich(issue.title || "")) throw new BoardError(t("keinFachplan", { id, praefix: praefix("fachlich") }));
  const body = issue.body || "";
  const neu = setzen ? mitEreignis(body, grund) : ohneEreignis(body);
  if (neu === null) throw new BoardError(t("ohneZiel", { id, ziel: ueberschriftName("ziel") }));
  if (neu !== body) await tracker.updateIssue(id, { body: neu });
  return { ok: true, id, wartet: setzen ? grund : null, ...await holdLabel(tracker, id, setzen) };
}

/** Kartennummer, Richtung und Grund aus den Optionen; ein Bedienfehler wirft BoardError. */
function holdAuftrag(args) {
  const id = args._[0];
  if (id === undefined) throw new BoardError(t("ohneId"));
  const setzen = args.reason !== undefined;
  if (setzen && args.lift !== undefined) throw new BoardError(t("beides"));
  if (!setzen && args.lift === undefined) throw new BoardError(t("ohneOption", { id }));
  const grund = typeof args.reason === "string" ? args.reason.trim() : "";
  if (setzen && grund === "") throw new BoardError(t("grundLeer"));
  return { id: String(id), setzen, grund };
}

/** Setzt oder nimmt `kit:on-hold`; fehlt das Label am Board, `label: null` mit der Meldung (E3). */
async function holdLabel(tracker, id, setzen) {
  try {
    await tracker.labelIssue(id, labelName("ereignis"), setzen ? "add" : "remove");
    return { label: setzen ? "gesetzt" : "abgenommen", labelFehler: null };
  } catch (e) {
    if (!(e instanceof LabelFehltError)) throw e;
    return { label: null, labelFehler: e.message };
  }
}
