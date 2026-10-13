/**
 * texte/board-triage.mjs — die Texttabelle von board/triage.mjs (Issue #1628, #1629). Eigener
 * Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne
 * die Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Meldungen des Einstiegs, von `triageKoerperPruefen` und `ablageAbschliessen` je Sprache.
 * Vertragswerte bleiben ausserhalb: die Werte von `grund` (`keine-idee`, `unbeaufsichtigt`), die
 * Regeln von `triageKoerperPruefen` (`ideentext`, `antwort`) und die Werte von `bahn` und
 * `ergebnis.art`.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    keineIdee: "#{id} ist keine Idee: /triage nimmt nur eine Karte mit dem Präfix {praefix}.",
    unbeaufsichtigt: "Unbeaufsichtigt (KIT_AGENT_MODEL gesetzt): Beim Durchsprechen antwortet ein Mensch, /triage beginnt nicht; Idee und Ablage bleiben unverändert.",
    ideentext: "Der Text der Idee oberhalb von „{ueberschrift}“ ist im neuen Body geändert; er bleibt unverändert stehen.",
    antwortVerloren: "Punkt „{punkt}“ war bestätigt und hat im neuen Body seine Antwortzeile „{antwort}“ verloren; sie bleibt stehen.",
    vorlageFehlt: "Vorlage „{datei}“ liegt nicht als Datei in {pfad}: nichts verschoben, nichts gelöscht. Den Dateinamen aus der Ablage nennen.",
  }),
  en: Object.freeze({
    keineIdee: "#{id} is not an idea: /triage only takes a card with the prefix {praefix}.",
    unbeaufsichtigt: "Unattended (KIT_AGENT_MODEL set): talking an idea through needs a human to answer, /triage does not start; idea and attachments stay unchanged.",
    ideentext: "The text of the idea above “{ueberschrift}” has changed in the new body; it stays unchanged.",
    antwortVerloren: "Point “{punkt}” was confirmed and has lost its answer line “{antwort}” in the new body; it stays.",
    vorlageFehlt: "Template “{datei}” not found as a file in {pfad}: nothing moved, nothing deleted. Name a file from the attachments folder.",
  }),
});
