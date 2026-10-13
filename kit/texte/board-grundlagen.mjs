/**
 * texte/board-grundlagen.mjs — die Texttabelle von board/grundlagen.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1483, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen der Grundlagen je Sprache. Vertragswerte bleiben ausserhalb (E14): die Werte
 * von RUECKMELDUNG, die Spaltennamen, die Dateinamen unter `.claude/` und die Feldnamen der
 * Config, die die Hinweise nennen.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    nichtGefunden: "{datei} nicht gefunden — ist es installiert und im PATH?",
    exitCode: "{datei} endete mit Exit {status}",
    fehler: "Fehler: {meldung}",
    hinweis: "Hinweis: {hinweis}",
    lokalKaputt: "{pfad} ist kein gueltiges JSON und wird ignoriert.",
    feldIgnoriert: "'{feld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.",
    configUnlesbar: "workflow.config.json konnte nicht gelesen werden: {pfad}",
    keineConfig: "Keine .claude/workflow.config.json gefunden. Bitte zuerst den Installer ausfuehren.",
  }),
  en: Object.freeze({
    nichtGefunden: "{datei} not found — is it installed and in PATH?",
    exitCode: "{datei} ended with exit {status}",
    fehler: "Error: {meldung}",
    hinweis: "Note: {hinweis}",
    lokalKaputt: "{pfad} is not valid JSON and is ignored.",
    feldIgnoriert: "'{feld}' from workflow.config.local.json is ignored — the field applies to the whole team.",
    configUnlesbar: "workflow.config.json could not be read: {pfad}",
    keineConfig: "No .claude/workflow.config.json found. Please run the installer first.",
  }),
});
