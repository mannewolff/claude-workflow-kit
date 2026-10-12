/**
 * texte/board-vorgeschichte.mjs — die Texttabelle von board/vorgeschichte.mjs (Issue #1539). Eigener
 * Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne
 * die Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1483, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen von `issue vorgeschichte` je Sprache. Vertragswerte bleiben ausserhalb (E14):
 * die Werte von `grund` (`archiv-nicht-erreichbar`, `tracker-ohne-suche`, `abgeschaltet`) und
 * von `weg` (`suche`, `datei`) liest der Aufrufer zurueck.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    alleNichtGefunden: "keine der {zahl} Karten ließ sich einzeln abrufen (HTTP 404) — dem Board fehlt wohl der Abruf nach Nummer",
    optionOhneWert: "--{option} braucht einen Wert",
    keineNummer: "--{option} erwartet eine Kartennummer, nicht „{wert}“",
  }),
  en: Object.freeze({
    alleNichtGefunden: "none of the {zahl} cards could be fetched one by one (HTTP 404) — the board probably lacks the fetch by number",
    optionOhneWert: "--{option} needs a value",
    keineNummer: "--{option} expects a card number, not “{wert}”",
  }),
});
