/**
 * texte/board-wiederholung.mjs — die Texttabelle von board/wiederholung.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1483, Plan #1420 E13/E14)
// ============================================================

/** Der Proxy-Hinweis je Sprache. Die Werte von RUECKMELDUNG bleiben Vertrag (E14). */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    proxyHinweis: "Der Aufruf lief hinter einem Proxy (HTTPS_PROXY). Die uebliche Abhilfe ist "
      + "NODE_USE_ENV_PROXY=1 vor dem Aufruf, nicht das Verlassen der Sandbox.",
  }),
  en: Object.freeze({
    proxyHinweis: "The call ran behind a proxy (HTTPS_PROXY). The usual remedy is "
      + "NODE_USE_ENV_PROXY=1 before the call, not leaving the sandbox.",
  }),
});
