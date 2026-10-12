/**
 * texte/board-melder.mjs — die Texttabelle von board/melder.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Texte an Menschen in beiden Sprachen (Issue #1454, Plan #1420 E13): die Freitextfelder der
 * Meldung (`excerpt`, `abortReason`), die Fehler und Hinweise der Melder und der Rueckfall-Vermerk.
 * Unuebersetzt bleibt der Vertrag (E14): `stages`, `errorClass`, `state`, `grundArt`, die
 * Feldnamen der Meldung und der Antworten, die Schweige-Gruende des Sitzungs-Melders und die
 * Werte von `abschluss`. `title` und `noWorkReason` kommen aus dem Stand und gehen unveraendert
 * durch. Den Gleichstand der Schluessel und Platzhalter haelt test/board-melder-texte-en.test.mjs.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    auszugPruefung: "Pruefung: {pruefung}",
    auszugFehler: "Fehler: {fehler}",
    abbruchHarterStopp: "Harter Stopp",
    abbruchVerstummt: "Verstummt",
    abbruchAbgebrochen: "Abgebrochen",
    abbruchMitKlasse: "{grund} ({fehlerklasse})",
    keineSchnittstelle: "Lauf-Art '{art}' hat keine Nachtlauf-Schnittstelle (erwartet: {erwartet})",
    nurToolbox: "Einlieferung nur mit issueTracker toolbox moeglich, konfiguriert ist '{tracker}'.",
    dateiFehlt: "nightrun report braucht --file <ergebnisstand.json>",
    nichtLesbar: "Ergebnisstand {datei} nicht lesbar: {grund}",
    nachversuch: "Hinweis: Laufmeldung mit releasePreparation abgewiesen (HTTP 400), Nachversuch ohne das Feld: {grund}",
    rueckfall: "ohne releasePreparation nachgemeldet nach HTTP 400",
    unbekanntNightrun: "Unbekannter nightrun-Befehl: '{befehl}'",
    standNichtGeschrieben: "Hinweis: Sitzungs-Stand nicht geschrieben ({pfad}): {grund}",
    nichtEingeliefert: "Hinweis: Sitzungs-Meldung nicht eingeliefert: {grund}",
    unbekanntSitzung: "Unbekannter session-Befehl: '{befehl}'",
  }),
  en: Object.freeze({
    auszugPruefung: "Check: {pruefung}",
    auszugFehler: "Error: {fehler}",
    abbruchHarterStopp: "Hard stop",
    abbruchVerstummt: "Went silent",
    abbruchAbgebrochen: "Aborted",
    abbruchMitKlasse: "{grund} ({fehlerklasse})",
    keineSchnittstelle: "Run type '{art}' has no night-run interface (expected: {erwartet})",
    nurToolbox: "Delivery only possible with issueTracker toolbox, configured is '{tracker}'.",
    dateiFehlt: "nightrun report needs --file <result.json>",
    nichtLesbar: "Result file {datei} not readable: {grund}",
    nachversuch: "Note: run report with releasePreparation rejected (HTTP 400), retrying without the field: {grund}",
    rueckfall: "reported again without releasePreparation after HTTP 400",
    unbekanntNightrun: "Unknown nightrun command: '{befehl}'",
    standNichtGeschrieben: "Note: session state not written ({pfad}): {grund}",
    nichtEingeliefert: "Note: session report not delivered: {grund}",
    unbekanntSitzung: "Unknown session command: '{befehl}'",
  }),
});
