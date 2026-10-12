/**
 * texte/board-ursprung.mjs — die Texttabelle von board/ursprung.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1483, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Gruende der Auswertung je Sprache. Vertragswerte bleiben ausserhalb (E14): die Werte
 * von `aktion` (`wandert`, `bleibt`, `lag bereits in <Spalte>`, kit/board/dokumente.mjs liest
 * sie zurueck), von `art` der Dokumente und die Spaltennamen.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    nichtFeststellbar: "nicht feststellbar: {grund}",
    spaltenNichtLesbar: "Spalten der Pakete nicht lesbar",
    keinePakete: "Plan #{plan} hat keine Pakete (noch nicht geschnitten)",
    nichtDurch: "Plan #{plan} nicht durch: {liste}",
    paketInSpalte: "#{id} in {spalte}",
    ohneVermerk: "Plan #{plan} ohne Vermerk „{anker}…“ — {grund}",
    planNichtAufBoard: "Plan #{plan} steht in keiner Spalte des Boards",
    nichtAufBoard: "#{id} steht in keiner Spalte des Boards",
    keinUrsprung: "kein Ursprungsdokument: #{id} trägt kein Präfix {praefix}",
    keinPraefix: "#{id} trägt kein Präfix {praefix}",
    spalteNichtLesbar: "Spalte von #{id} nicht lesbar",
    kommentareNichtLesbar: "Kommentare von Plan #{plan} nicht lesbar ({fehler})",
    kartenNichtLesbar: "Karten nicht lesbar ({fehler})",
    allePlaeneDurch: "alle Pläne der Anforderung sind durch",
    allePaketeDurch: "alle Pakete liegen in In review oder Done",
    nichtBewegt: "Dokument nicht bewegt",
  }),
  en: Object.freeze({
    nichtFeststellbar: "not determinable: {grund}",
    spaltenNichtLesbar: "columns of the packages not readable",
    keinePakete: "Plan #{plan} has no packages (not cut yet)",
    nichtDurch: "Plan #{plan} not done: {liste}",
    paketInSpalte: "#{id} in {spalte}",
    ohneVermerk: "Plan #{plan} without note “{anker}…” — {grund}",
    planNichtAufBoard: "plan #{plan} is in no column of the board",
    nichtAufBoard: "#{id} is in no column of the board",
    keinUrsprung: "not an origin document: #{id} does not carry the prefix {praefix}",
    keinPraefix: "#{id} does not carry the prefix {praefix}",
    spalteNichtLesbar: "column of #{id} not readable",
    kommentareNichtLesbar: "comments of plan #{plan} not readable ({fehler})",
    kartenNichtLesbar: "cards not readable ({fehler})",
    allePlaeneDurch: "all plans of the requirement are done",
    allePaketeDurch: "all packages are in In review or Done",
    nichtBewegt: "document not moved",
  }),
});
