/**
 * texte/board-ereignis.mjs — die Texttabelle von board/ereignis.mjs (Issue #1662, Plan #1624 E13).
 * Eigener Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen
 * kann, ohne die Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die
 * Tabelle und exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Plan #1420 E13/E14)
// ============================================================

/**
 * Die Bedienfehler von `issue hold`. Vertragswerte bleiben ausserhalb (E14): die Felder der
 * Ausgabe, die Werte `gesetzt` und `abgenommen`, das Label `kit:on-hold` und die Wartezeile.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    ohneId: "`issue hold` braucht eine Kartennummer: `issue hold <id> --reason \"<Grund>\"` oder `issue hold <id> --lift`.",
    ohneOption: "`issue hold {id}` braucht `--reason \"<Grund>\"` oder `--lift`.",
    beides: "`--reason` und `--lift` schliessen einander aus — ein Aufruf setzt das Warten oder hebt es auf.",
    grundLeer: "`--reason` braucht einen Grund in Worten, etwa `--reason \"Tarif X ist waehlbar\"`.",
    keinFachplan: "#{id} ist kein Fachplan (Titel ohne `{praefix}`) — `issue hold` gilt nur fuer Fachplaene; ein Plan und ein Arbeitspaket haben keinen eigenen Wartezustand.",
    ohneZiel: "#{id} hat keinen Abschnitt `## {ziel}` — dort steht die Wartezeile.",
  }),
  en: Object.freeze({
    ohneId: "`issue hold` needs a card number: `issue hold <id> --reason \"<reason>\"` or `issue hold <id> --lift`.",
    ohneOption: "`issue hold {id}` needs `--reason \"<reason>\"` or `--lift`.",
    beides: "`--reason` and `--lift` exclude each other — a call sets the wait or lifts it.",
    grundLeer: "`--reason` needs a reason in words, such as `--reason \"plan X is available\"`.",
    keinFachplan: "#{id} is not a requirement (title without `{praefix}`) — `issue hold` applies to requirements only; a plan and a work package have no wait state of their own.",
    ohneZiel: "#{id} has no section `## {ziel}` — that is where the wait line goes.",
  }),
});
