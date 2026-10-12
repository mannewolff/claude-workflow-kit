/**
 * texte/board-testhinweise.mjs — die Texttabelle von board/testhinweise.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1483, Plan #1420 E13/E14)
// ============================================================

/** Der Testhinweis und der Hinweis auf die Vorgeschichte (Issue #1542) je Sprache. Die Feldnamen der Hinweise bleiben Vertrag (E14). */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    testNichtGenannt: "Zu {baustein} gehört {test}, der Plan nennt ihn nicht. Bleibt er grün, oder fehlt er in der Liste der Änderungen?",
    vorgeschichteFachlich: "Der Fachplan hat keinen Abschnitt ## Vorgeschichte. Das Projekt sucht frühere Fachpläne: Was wurde gesucht, was ist einschlägig, oder steht ausdrücklich da, dass nichts gefunden wurde?",
    vorgeschichtePlan: "Der Plan hat keinen Abschnitt ### Vorgeschichte. Das Projekt sucht frühere Fachpläne: Was wurde gesucht, was ist einschlägig, oder steht ausdrücklich da, dass nichts gefunden wurde?",
  }),
  en: Object.freeze({
    testNichtGenannt: "{test} belongs to {baustein}, the plan does not name it. Does it stay green, or is it missing from the list of changes?",
    vorgeschichteFachlich: "The requirement has no section ## History. The project searches earlier requirements: what was searched, what is relevant, or does it say explicitly that nothing was found?",
    vorgeschichtePlan: "The plan has no section ### History. The project searches earlier requirements: what was searched, what is relevant, or does it say explicitly that nothing was found?",
  }),
});
