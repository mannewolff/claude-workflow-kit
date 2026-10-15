/**
 * texte/checks-verflechtung.mjs — die Texttabelle von checks/verflechtung.mjs (Issue #1714,
 * Plan #1713 P13; die Gruende des Vermerks „unvollstaendig" seit Issue #1715, A6). Eigener
 * Teil wie die uebrigen Tabellen, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de
 * und en ausnehmen kann. Unuebersetzt bleibt `git ls-files`:
 * Das ist der Name des Kommandos, nicht ein Wort an Menschen.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    lsFilesFehler: "git ls-files schlug fehl: {grund}",
    lsFilesLeer: "git ls-files fand nichts unter {pfad}",
    kopf: "| Testdatei | laedt | nennt | Anzahl |",
    aliasOhneTreffer: "{datei}: Import \"{ziel}\" passt auf einen Alias aus {tsconfig}, trifft aber keine Datei",
    tsconfigUnlesbar: "{datei}: {tsconfig} ist nicht lesbar ({grund}), Aliase lassen sich nicht aufloesen",
  }),
  en: Object.freeze({
    lsFilesFehler: "git ls-files failed: {grund}",
    lsFilesLeer: "git ls-files found nothing under {pfad}",
    kopf: "| Test file | loads | mentions | Count |",
    aliasOhneTreffer: "{datei}: import \"{ziel}\" matches an alias from {tsconfig} but no file",
    tsconfigUnlesbar: "{datei}: {tsconfig} cannot be read ({grund}), aliases cannot be resolved",
  }),
});
