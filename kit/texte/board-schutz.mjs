/**
 * texte/board-schutz.mjs — die Texttabelle von board/schutz.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1482, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen des Schutzes je Sprache. Vertragswerte bleiben ausserhalb (E14): die
 * Feldnamen der Ergebnisse, die Werte von `ergebnis` und `status`, die Ruleset-Arten, die
 * Aktionsnamen von `code protection`, die Kommandos und die Bezeichnungen der Oberflaeche des
 * Code-Hosts, die die Anleitung woertlich nennt.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    artUnbekannt: "Ruleset-Art '{art}' unbekannt. Erwartet: {arten}",
    regelFehlt: "Regel {typ} fehlt",
    pflichtjobs: "Pflichtjobs {ist} statt {soll}",
    bypassNichtLeer: "Bypass-Liste nicht leer",
    freigaben: "pull_request verlangt {anzahl} Freigabe(n) statt 0",
    keine: "(keine)",
    keinSchutz: "Der Code-Host kennt keinen Schutz.",
    pushPruefung: "Pruefung vor dem Push nicht im Build-Dienst (pushPruefung)",
    schutzAusgesetzt: "Schutz des Hauptzweigs ausgesetzt",
    rulesetFehlt: "Ruleset '{name}' fehlt",
    rulesetAusgesetzt: "Ruleset '{name}' ausgesetzt",
    rulesetAbweichung: "Ruleset '{name}' weicht ab: {befund}",
    anleitungZiel: "3. Target branches → Add target → Include by pattern: {zweig} (Zielzweig: {zweig})",
    anleitungBypass: "4. Bypass list: leer lassen, keine Rolle und kein Nutzer",
    anleitungRegeln: "5. Regeln einschalten:",
    anleitungJobs: "6. Bei Require status checks to pass diese Jobs als Pflichtpruefung eintragen: {jobs}",
    keinGruenerLauf: "kein gruener Lauf",
    rotPruefung: "rot: {pruefung}",
    keinVollerLauf: "Kein gruener voller Lauf der Stufe push im Worktree ({warum}). Erst: node .claude/kit/checks.mjs run --stage push --retry",
    falscheStufe: "Der letzte gruene Lauf hatte die Stufe {stufe}, verlangt ist push.",
    stufeUnbekannt: "(unbekannt)",
    keineHashes: "Die Zusammenfassung nennt keine Blob-Hashes; der gepruefte Stand ist nicht belegt.",
    standUnlesbar: "Der Stand der geprueften Dateien liess sich nicht lesen: {fehler}",
    seitLaufGeaendert: "Seit dem Lauf geaendert: {dateien} — der Stand ist nicht mehr der gepruefte.",
    nachtGesperrt: "code protection {aktion} ist ohne Aufsicht gesperrt (KIT_AGENT_MODEL gesetzt): Die Aktion pusht oder aendert den Code-Host, und die Nacht pusht nie. Nur status ist erlaubt.",
    originFehltLokal: "origin/{zweig} fehlt im lokalen Repository — erst git fetch origin {zweig}.",
    pruefzweigBelegt: "Der Pruefzweig '{zweig}' ist auf origin schon vorhanden — vielleicht laeuft dort ein push main. Die Probe ueberschreibt ihn nicht; erst wenn er weg ist, erneut aufrufen.",
    probeLaeuft: "Probe auf {zweig}: {minuten} min gewartet, Lauf laeuft",
    probeOhneLauf: "Probe auf {zweig}: {minuten} min gewartet, noch kein Lauf",
    offenerSchritt: "Der Build-Dienst muss bei einem Push auf den Pruefzweig '{zweig}' den Lauf der Stufe push fahren: {kommando}",
    originFehlt: "origin/{zweig} fehlt — ohne Remote-Stand gibt es nichts zu pruefen.",
    nichtZuEnde: "Der Build-Dienst lief nicht binnen 60 Minuten zu Ende auf '{zweig}'.",
    keinLauf: "Der Build-Dienst fuhr binnen 5 Minuten keinen Lauf auf '{zweig}'.",
    ohneAdmin: "Ohne Admin-Recht am Repository richtet das Kit nichts ein.",
    abgewiesen403: "Der Code-Host wies das Einrichten ab (403): {fehler}",
  }),
  en: Object.freeze({
    artUnbekannt: "Ruleset kind '{art}' unknown. Expected: {arten}",
    regelFehlt: "rule {typ} missing",
    pflichtjobs: "required jobs {ist} instead of {soll}",
    bypassNichtLeer: "bypass list not empty",
    freigaben: "pull_request requires {anzahl} approval(s) instead of 0",
    keine: "(none)",
    keinSchutz: "The code host knows no protection.",
    pushPruefung: "Check before push not in the build service (pushPruefung)",
    schutzAusgesetzt: "Main branch protection suspended",
    rulesetFehlt: "Ruleset '{name}' is missing",
    rulesetAusgesetzt: "Ruleset '{name}' suspended",
    rulesetAbweichung: "Ruleset '{name}' deviates: {befund}",
    anleitungZiel: "3. Target branches → Add target → Include by pattern: {zweig} (target branch: {zweig})",
    anleitungBypass: "4. Bypass list: leave empty, no role and no user",
    anleitungRegeln: "5. Enable rules:",
    anleitungJobs: "6. Under Require status checks to pass, enter these jobs as required checks: {jobs}",
    keinGruenerLauf: "no green run",
    rotPruefung: "red: {pruefung}",
    keinVollerLauf: "No green full run of stage push in the worktree ({warum}). First: node .claude/kit/checks.mjs run --stage push --retry",
    falscheStufe: "The last green run had stage {stufe}, push is required.",
    stufeUnbekannt: "(unknown)",
    keineHashes: "The summary names no blob hashes; the checked state is not proven.",
    standUnlesbar: "The state of the checked files could not be read: {fehler}",
    seitLaufGeaendert: "Changed since the run: {dateien} — the state is no longer the checked one.",
    nachtGesperrt: "code protection {aktion} is blocked without supervision (KIT_AGENT_MODEL set): the action pushes or changes the code host, and the night never pushes. Only status is allowed.",
    originFehltLokal: "origin/{zweig} is missing in the local repository — first git fetch origin {zweig}.",
    pruefzweigBelegt: "The check branch '{zweig}' already exists on origin — perhaps a push main is running there. The probe does not overwrite it; call again only once it is gone.",
    probeLaeuft: "Probe on {zweig}: waited {minuten} min, run in progress",
    probeOhneLauf: "Probe on {zweig}: waited {minuten} min, no run yet",
    offenerSchritt: "On a push to the check branch '{zweig}' the build service must run the stage push: {kommando}",
    originFehlt: "origin/{zweig} is missing — without a remote state there is nothing to check.",
    nichtZuEnde: "The build service did not finish within 60 minutes on '{zweig}'.",
    keinLauf: "The build service started no run within 5 minutes on '{zweig}'.",
    ohneAdmin: "Without admin rights on the repository the kit sets up nothing.",
    abgewiesen403: "The code host rejected the setup (403): {fehler}",
  }),
});
