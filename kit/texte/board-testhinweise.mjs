/**
 * texte/board-testhinweise.mjs — die Texttabelle von board/testhinweise.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1483, Plan #1420 E13/E14)
// ============================================================

/** Der Testhinweis je Sprache. Die Feldnamen der Hinweise bleiben Vertrag (E14). */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    testNichtGenannt: "Zu {baustein} gehört {test}, der Plan nennt ihn nicht. Bleibt er grün, oder fehlt er in der Liste der Änderungen?",
  }),
  en: Object.freeze({
    testNichtGenannt: "{test} belongs to {baustein}, the plan does not name it. Does it stay green, or is it missing from the list of changes?",
  }),
});
