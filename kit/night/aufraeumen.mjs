/**
 * night/aufraeumen.mjs — die Protokollfrist des Nacht-Runners (Issue #1696, Idee #1684).
 *
 * Die Protokolle des Runners wachsen ohne Grenze; sie dienen nur der Diagnose in den Tagen
 * nach einem Lauf. Zu Beginn jedes Laufs loescht der Runner darum, was aelter ist als die
 * Frist `night.protokollFristTage` (Vorgabe 14 Tage): die Tagesprotokolle
 * `.claude/night-run-<datum>.log` und die Laufordner unter `.claude/protokolle/`.
 *
 * Alles mit Kennzahlen bleibt: `night-run-*.json`, `ausfuehrungen.tsv`, `bewegungen.tsv`,
 * `befunde.tsv`. `.claude/checks-protokolle/` leert `checks.mjs` selbst, und eine Datei
 * unter `.claude/protokolle/` ausserhalb eines Laufordners gehoert keinem Lauf.
 *
 * Das Alter ist die Aenderungszeit, beim Laufordner die juengste einer Datei darin: Ein
 * Tagesprotokoll beschreiben mehrere Laeufe desselben Tages, und die Aenderungszeit trifft
 * das Ende des letzten. Kein Board-Abruf, keine Sperre gegen parallele Laeufe: Ein laufender
 * Lauf schreibt sein Protokoll gerade, und ein doppeltes Loeschen ist mit `force` harmlos.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

// Das Register mit literalem Pfad und abgefangen, wie in den uebrigen Teilen (Issue #1485):
// Fehlt board/namen.mjs neben night.mjs, bleiben die Texte deutsch.
const namen = await import("../board/namen.mjs").catch(() => null);

export const TEXTE = Object.freeze({
  de: Object.freeze({
    geloescht: "Protokollfrist {frist} Tage: {anzahl} Protokoll(e) geloescht, {mb} MB frei geworden",
    wuerdeLoeschen: "Protokollfrist {frist} Tage: wuerde {anzahl} Protokoll(e) loeschen, {mb} MB (DRY-RUN)",
    nichtGeloescht: "WARNUNG: Protokoll nicht geloescht: {pfad} — {grund}. Der Lauf geht weiter.",
  }),
  en: Object.freeze({
    geloescht: "Log retention {frist} days: {anzahl} log(s) deleted, {mb} MB freed",
    wuerdeLoeschen: "Log retention {frist} days: would delete {anzahl} log(s), {mb} MB (DRY-RUN)",
    nichtGeloescht: "WARNING: log not deleted: {pfad} — {grund}. The run continues.",
  }),
});

function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

export const PROTOKOLL_FRIST_VORGABE = 14;
const TAG_MS = 24 * 60 * 60 * 1000;
const TAGESPROTOKOLL = /^night-run-\d{4}-\d{2}-\d{2}\.log$/;

/** Die Frist in Tagen aus der Config; fehlt das Feld oder ist es keine ganze Zahl ab 1, gilt die Vorgabe. */
export function protokollFrist(config) {
  const wert = config?.night?.protokollFristTage;
  return Number.isInteger(wert) && wert >= 1 ? wert : PROTOKOLL_FRIST_VORGABE;
}

/** Juengste Aenderungszeit und Groesse aller Dateien unter einem Ordner; ein leerer Ordner zaehlt mit seiner eigenen. */
function ordnerStand(pfad) {
  let juengste = 0;
  let bytes = 0;
  let dateien = 0;
  for (const eintrag of readdirSync(pfad, { withFileTypes: true })) {
    const kind = join(pfad, eintrag.name);
    if (eintrag.isDirectory()) {
      const unter = ordnerStand(kind);
      if (unter.dateien > 0) juengste = Math.max(juengste, unter.mtimeMs);
      bytes += unter.bytes;
      dateien += unter.dateien;
    } else {
      const s = statSync(kind);
      juengste = Math.max(juengste, s.mtimeMs);
      bytes += s.size;
      dateien += 1;
    }
  }
  return { mtimeMs: dateien > 0 ? juengste : statSync(pfad).mtimeMs, bytes, dateien };
}

/** Was unter `.claude/` als Protokoll gilt, mit Alter und Groesse. */
function kandidaten(claude) {
  const liste = [];
  if (!existsSync(claude)) return liste;
  for (const eintrag of readdirSync(claude, { withFileTypes: true })) {
    if (!eintrag.isFile() || !TAGESPROTOKOLL.test(eintrag.name)) continue;
    const pfad = join(claude, eintrag.name);
    const s = statSync(pfad);
    liste.push({ pfad, mtimeMs: s.mtimeMs, bytes: s.size });
  }
  const protokolle = join(claude, "protokolle");
  if (!existsSync(protokolle)) return liste;
  for (const eintrag of readdirSync(protokolle, { withFileTypes: true })) {
    if (!eintrag.isDirectory()) continue;
    const pfad = join(protokolle, eintrag.name);
    const stand = ordnerStand(pfad);
    liste.push({ pfad, mtimeMs: stand.mtimeMs, bytes: stand.bytes });
  }
  return liste;
}

/**
 * Loescht im Projekt die Protokolle, die aelter sind als die Frist. Wirft nie: Ein
 * gescheitertes Loeschen steht mit Grund unter `gescheitert`, die uebrigen laufen weiter.
 * Im Dry-Run loescht sie nichts und nennt, was sie loeschen wuerde.
 *
 * @param {string} projekt Projektverzeichnis
 * @param {{fristTage?: number, jetzt?: number, dryRun?: boolean, entfernen?: (pfad: string) => void}} [optionen]
 * @returns {{anzahl: number, bytes: number, pfade: string[], gescheitert: {pfad: string, grund: string}[], dryRun: boolean, fristTage: number}}
 */
export function protokolleAufraeumen(projekt, optionen = {}) {
  const fristTage = optionen.fristTage ?? PROTOKOLL_FRIST_VORGABE;
  const jetzt = optionen.jetzt ?? Date.now();
  const dryRun = optionen.dryRun === true;
  const entfernen = optionen.entfernen ?? ((pfad) => rmSync(pfad, { recursive: true, force: true }));
  const grenze = jetzt - fristTage * TAG_MS;
  const ergebnis = { anzahl: 0, bytes: 0, pfade: [], gescheitert: [], dryRun, fristTage };

  let liste;
  try {
    liste = kandidaten(join(projekt, ".claude"));
  } catch (fehler) {
    ergebnis.gescheitert.push({ pfad: join(projekt, ".claude"), grund: fehler.message });
    return ergebnis;
  }
  for (const { pfad, mtimeMs, bytes } of liste) {
    if (mtimeMs >= grenze) continue;
    if (!dryRun) {
      try {
        entfernen(pfad);
      } catch (fehler) {
        ergebnis.gescheitert.push({ pfad, grund: fehler.message });
        continue;
      }
    }
    ergebnis.anzahl += 1;
    ergebnis.bytes += bytes;
    ergebnis.pfade.push(pfad);
  }
  return ergebnis;
}

/**
 * Die Zeilen fuer das Nacht-Log aus dem Ergebnis: eine mit Anzahl und frei gewordenem Platz
 * in MB, im Dry-Run als "wuerde loeschen", dazu je gescheitertem Pfad eine mit Grund.
 */
export function aufraeumZeilen(ergebnis) {
  const werte = { frist: ergebnis.fristTage, anzahl: ergebnis.anzahl, mb: (ergebnis.bytes / (1024 * 1024)).toFixed(1) };
  return [
    t(ergebnis.dryRun ? "wuerdeLoeschen" : "geloescht", werte),
    ...ergebnis.gescheitert.map(({ pfad, grund }) => t("nichtGeloescht", { pfad, grund })),
  ];
}
