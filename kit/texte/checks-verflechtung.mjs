/**
 * texte/checks-verflechtung.mjs — die Texttabelle von checks/verflechtung.mjs (Issue #1714,
 * Plan #1713 P13). Eigener Teil wie die uebrigen Tabellen, damit `sonar.cpd.exclusions` die
 * gleich gebauten Haelften de und en ausnehmen kann. Unuebersetzt bleibt `git ls-files`:
 * Das ist der Name des Kommandos, nicht ein Wort an Menschen.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    lsFilesFehler: "git ls-files schlug fehl: {grund}",
    lsFilesLeer: "git ls-files fand nichts unter {pfad}",
    kopf: "| Testdatei | laedt | nennt | Anzahl |",
  }),
  en: Object.freeze({
    lsFilesFehler: "git ls-files failed: {grund}",
    lsFilesLeer: "git ls-files found nothing under {pfad}",
    kopf: "| Test file | loads | mentions | Count |",
  }),
});
