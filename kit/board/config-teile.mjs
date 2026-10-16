/**
 * board/config-teile.mjs — je Einstellung ihr Teil nach Zweck (Issue #1731, Plan #1710 A5 bis A7).
 *
 * Seite, Beispieldatei und Einstellungs-Oberflaeche gliedern die Einstellungen nach denselben
 * vier Teilen; diese Tabelle ist ihre gemeinsame Quelle, das Schema bleibt frei von eigenen
 * `x-`-Feldern (A5). Die Zuordnung je englischem Wurzelfeld legt A6 fest, die Reihenfolge A7.
 * Ein Pfad erbt den Teil seines Wurzelfelds; deutsche Namen werden ueber SCHLUESSEL erkannt.
 *
 * Dieses Modul importiert nur Node-Bordmittel und config-namen.mjs.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */
import { SCHLUESSEL } from "./config-namen.mjs";

/** Die Teile in der Reihenfolge der Seite (A7). */
export const TEILE = Object.freeze(["einrichten", "lohnt", "verwaltet", "fein"]);

const teil = (name, felder) => Object.fromEntries(felder.map((feld) => [feld, name]));

/** Je englischem Wurzelfeld sein Teil (A6). */
export const ZUORDNUNG = Object.freeze({
  ...teil("einrichten", [
    "language", "codeHost", "issueTracker", "github", "local", "toolbox",
    "buildChecks", "mainBranch", "productionBranch", "issueReview",
  ]),
  ...teil("lohnt", [
    "history", "contractRepos", "checkAreas", "coupledAreas", "noCheck", "testLocations",
    "qualityCommands", "mutationCommand", "formatFixCommand", "installCommand", "pushCheck",
    "reviewStages", "reviewModel", "reviewCommand", "reviewScope",
  ]),
  ...teil("verwaltet", ["provider", "scenariosFrom", "version", "scaffoldOnly"]),
  ...teil("fein", [
    "triggers", "columns", "reviewReadLimit", "night", "checkRun", "workload",
    "effectiveness", "findings",
  ]),
});

/** Kennzeichen der Felder, die ein Anwender nie selbst setzt (#1705 Kriterium 4). */
const KENNZEICHEN = Object.freeze({
  provider: "veraltet",
  scenariosFrom: "installer",
  version: "installer",
  scaffoldOnly: "intern",
});

function wurzel(pfad) {
  const erstes = String(pfad).split(".")[0].replace(/\[\]$/, "");
  return Object.hasOwn(ZUORDNUNG, erstes) ? erstes : SCHLUESSEL[erstes] ?? erstes;
}

/** Teil des Wurzelfelds eines Pfads, deutsch oder englisch benannt; `null`, wenn unbekannt. */
export function teilVon(pfad) {
  return ZUORDNUNG[wurzel(pfad)] ?? null;
}

/** Kennzeichen des Wurzelfelds (`veraltet`, `installer`, `intern`) oder `null`. */
export function kennzeichenVon(pfad) {
  return KENNZEICHEN[wurzel(pfad)] ?? null;
}
