/**
 * texte/board-szenarien.mjs — die Texttabelle von board/szenarien.mjs (Issue #1589, Plan #1588).
 * Eigener Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen
 * kann, ohne die Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die
 * Tabelle und exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen zum Abschnitt Szenarien je Sprache. Die Form eines Szenarios setzt das Modul
 * aus den Registern in kit/board/namen.mjs zusammen; hier stehen nur die Platzhalter fuer
 * Titel, Ausgangslage, Handlung und Ergebnis.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    fehlt: "Der Fachplan braucht einen Abschnitt Szenarien mit mindestens einem vollständigen Szenario.",
    lage: "Der Abschnitt Szenarien steht nicht zwischen „{kriterien}“ und „{nichtZiele}“.",
    formEinleitung: "Form eines Szenarios:",
    platzTitel: "<Titel>",
    platzAusgangslage: "<Ausgangslage>",
    platzHandlung: "<Handlung>",
    platzErgebnis: "<beobachtbares Ergebnis>",
    stichtagFehlt: "Stichtag fehlt: `{feld}` ist in der Config nicht gesetzt, darum gilt die Szenarien-Pflicht für keine Karte am Board. Nachholen: `{kommando}` aufrufen und den Wert `ab` als `{feld}` in `.claude/workflow.config.json` eintragen.",
  }),
  en: Object.freeze({
    fehlt: "The requirement needs a Scenarios section with at least one complete scenario.",
    lage: 'The Scenarios section is not placed between "{kriterien}" and "{nichtZiele}".',
    formEinleitung: "Form of a scenario:",
    platzTitel: "<title>",
    platzAusgangslage: "<starting point>",
    platzHandlung: "<action>",
    platzErgebnis: "<observable result>",
    stichtagFehlt: "Cut-off missing: `{feld}` is not set in the config, so the scenario duty applies to no card on the board. To catch up: run `{kommando}` and enter the value `ab` as `{feld}` in `.claude/workflow.config.json`.",
  }),
});
