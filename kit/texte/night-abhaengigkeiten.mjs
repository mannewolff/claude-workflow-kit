/**
 * texte/night-abhaengigkeiten.mjs — die Texttabelle von night/abhaengigkeiten.mjs (Issue #1525). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// --- Texte an den Menschen (Plan #1420, E13, E14; Issue #1450) ---
//
// Was dieser Teil an den Menschen ausgibt — der Block unter dem Rueckstell-Kommentar mit
// `DOKUMENT_SATZ_ERST`, die Zeilen des Probelaufs, die Logzeile eines Kreises und die Fehler der
// Anbindung —, steht in dieser Tabelle und geht ueber den Texthelfer aus kit/board/namen.mjs.
// Vertrag bleibt (E14): das Feld `dokument` des Befunds (`[Plan]`, `[Fachlich]`, `[Idee]`) und
// `herkunft`; angezeigt wird das Praefix im Namen der Projektsprache.
export const TEXTE = Object.freeze({
  de: Object.freeze({
    dokumenteFehlt: "board/dokumente.mjs fehlt neben night.mjs ({pfad}) — {was} ist nicht verfuegbar.",
    wasFenceRegel: "die Fence-Regel",
    wasPraefix: "das Praefix {praefix}",
    wasHerkunft: "die Herkunft der Abhaengigkeiten",
    abhaengigkeitUnbekannt: "abhaengigkeitenAbhaengigkeiten kennt keine Abhaengigkeit '{name}'",
    satzPlan: "ein Plandokument wird nie durch Umsetzung erledigt",
    satzErst: "eine fachliche Anforderung oder Idee ist erst erledigt, wenn ihre Pakete fertig sind",
    kreis: "Kreis: {kreis}",
    kreisWartet: "Kreis: {kreis} — dieses Paket wartet auf einen Kreis.",
    kreisLogSteht: "#{paket} steht in einem Kreis: {kreis}",
    kreisLogWartet: "#{paket} wartet auf einen Kreis: {kreis}",
    erfuellt: "erfuellt",
    unerfuellt: "unerfuellt",
    ausVerweiszeile: "aus einer Verweiszeile",
    ausText: "aus erlaeuterndem Text",
    dokument: " — Dokument ({dokument}), kein Arbeitspaket: {satz}.",
    zeile: "- #{nummer}{titel}: {stand}, {herkunft}: „{stelle}“{dokument}",
    blockKopf: "Abhaengigkeiten, wie der Nachtlauf sie liest:",
  }),
  en: Object.freeze({
    dokumenteFehlt: "board/dokumente.mjs is missing next to night.mjs ({pfad}) — {was} is not available.",
    wasFenceRegel: "the fence rule",
    wasPraefix: "the prefix {praefix}",
    wasHerkunft: "the origin of the dependencies",
    abhaengigkeitUnbekannt: "abhaengigkeitenAbhaengigkeiten knows no dependency '{name}'",
    satzPlan: "a plan document is never done by implementation",
    satzErst: "a requirement or idea is only done when its packages are done",
    kreis: "Cycle: {kreis}",
    kreisWartet: "Cycle: {kreis} — this package waits on a cycle.",
    kreisLogSteht: "#{paket} is in a cycle: {kreis}",
    kreisLogWartet: "#{paket} waits on a cycle: {kreis}",
    erfuellt: "fulfilled",
    unerfuellt: "unfulfilled",
    ausVerweiszeile: "from a reference line",
    ausText: "from explanatory text",
    dokument: " — document ({dokument}), not a work package: {satz}.",
    zeile: "- #{nummer}{titel}: {stand}, {herkunft}: „{stelle}“{dokument}",
    blockKopf: "Dependencies as the night run reads them:",
  }),
});
