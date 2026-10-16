/**
 * texte/board-adapter.mjs — die Texttabelle von board/adapter.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1480, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen der Adapter je Sprache. Vertragswerte bleiben ausserhalb (E14): Feldnamen,
 * Rueckmeldungen, HTTP-Status und die Meldungen, die gh, glab und der Server selbst liefern.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    projektAutomatisch: "Hinweis: github.projectNumber fehlt in workflow.config.json, verwende automatisch "
      + "erkanntes einziges GitHub Project #{num} ('{titel}') fuer Owner '{owner}'. "
      + "Zur dauerhaften Fixierung ergaenzen: '\"github\": { \"projectNumber\": {num} }'",
    projektKeines: "github.projectNumber fehlt in workflow.config.json, und Owner '{owner}' hat kein GitHub Project. "
      + "Bitte erganzen: '\"github\": { \"projectNumber\": <N> }'",
    projektMehrere: "github.projectNumber fehlt in workflow.config.json, Owner '{owner}' hat mehrere Projects: {liste}. "
      + "Bitte erganzen: '\"github\": { \"projectNumber\": <N> }'",
    projektNichtGefunden: "GitHub Project #{num} nicht gefunden fuer Owner '{owner}'",
    statusFeldFehlt: "Kein 'Status'-Feld in GitHub Project #{num} gefunden",
    spalteSchreibweise: "Hinweis: workflow.config.json konfiguriert fuer Status '{status}' das Label '{label}', "
      + "das GitHub Project verwendet tatsaechlich '{option}' (Gross-/Kleinschreibung weicht ab). "
      + "Aktuell noch per Fallback erkannt — zur Vermeidung stiller Folgefehler bitte in "
      + "workflow.config.json anpassen: '\"columns\": { \"{status}\": \"{option}\" }'",
    issueNichtImRepo: "Issue #{id} nicht in Repo '{repo}' gefunden",
    issueNichtImBoard: "Issue #{id} nicht im Project Board #{num} gefunden",
    ghUrlUnlesbar: "Konnte Issue-URL aus gh-Ausgabe nicht lesen: {ausgabe}",
    boardZuordnungFehlgeschlagen: "Hinweis: Board-Zuordnung fehlgeschlagen: {grund}",
    keinStatusFilter: "Hinweis: Kein eindeutiges GitHub Project bestimmbar, kein Board-Status-Filter moeglich. Liste alle offenen Issues.",
    statusOhneOption: "Status '{status}' hat keine Entsprechung im GitHub Project",
    labelsNichtNachgeschlagen: "Hinweis: Labels konnten nicht nachgeschlagen werden ({grund}). Liste ohne Labels.",
    statusUpdateFehlgeschlagen: "Status-Update fehlgeschlagen (auch nach Cache-Refresh): {grund} (urspruenglicher Fehler: {erster})",
    keinJson: "{aufruf} lieferte kein gueltiges JSON: {auszug}",
    enforcementUnbekannt: "enforcement '{wert}' unbekannt. Erwartet: active | disabled",
    rulesetFremd: "Ruleset '{name}' gehoert nicht dem Kit (Name ohne '{praefix}') — es wird nicht angefasst.",
    rulesetFehlt: "Ruleset '{name}' in '{repo}' nicht gefunden.",
    glabIdUnlesbar: "Konnte Issue-ID aus glab-Ausgabe nicht lesen: {ausgabe}",
    backlogLabelFehlgeschlagen: "Hinweis: Backlog-Label konnte nicht gesetzt werden: {grund}",
    kommentareNichtAbrufbar: "Hinweis: Kommentare nicht abrufbar: {grund}",
    gitlabOhneLabel: "Status '{status}' hat kein GitLab-Label-Mapping",
    schutzGitlab: "Bei GitLab richtet das Kit keinen Schutz ein: Haupt- und Veroeffentlichungszweig "
      + "bleiben ungeschuetzt und nehmen auch einen ungeprueften Push an push main vorbei an.",
    schutzLocal: "Bei codeHost local gibt es keinen Code-Host, der einen Push abweisen koennte: "
      + "Haupt- und Veroeffentlichungszweig bleiben ungeschuetzt.",
    issueDateiFehlt: "Issue {id} nicht gefunden: {pfad}",
    kommentarFehlt: "Kommentar {kommentar} an Issue {id} nicht gefunden.",
    kommentarOhneLaufzeile: "Kommentar {kommentar} an Issue {id} traegt nicht die Zeile '{zeile}' — kein Ersetzen.",
    klartextToken: "kein Klartext-Token in workflow.config.json — nutze TBX_TOKEN oder toolbox.tokenFile.",
    tokenDateiUnlesbar: "toolbox.tokenFile '{datei}' nicht lesbar: {grund}",
    tokenDateiLeer: "toolbox.tokenFile '{datei}' ist leer.",
    keinToken: "Kein Toolbox-Token gefunden. Drei Wege: TBX_TOKEN als Umgebungsvariable setzen, "
      + "toolbox.tokenFile in workflow.config.json auf eine Token-Datei zeigen lassen, "
      + "oder Token in der Web-UI erzeugen und 'tbx auth login' ausfuehren.",
    createAntwortUnerwartet: "Unerwartete Create-Response der Kanban-API (weder 'number' noch 'id'): {antwort}",
    keinHost: "Kein Toolbox-Host gefunden. toolbox.host in workflow.config.json setzen oder 'tbx auth login' ausfuehren.",
    tokenUngueltig: "Token ungueltig oder widerrufen. Bitte 'tbx auth login' erneut ausfuehren.",
    wiederholZeile: "board: {methode} {pfad} — Versuch {versuch} endete mit {grund}, erneut in {warte} ms (Frist {frist} s)",
    apiNichtErreichbar: "Toolbox-API nicht erreichbar ({host}): {grund}",
    apiFehler: "Toolbox-API-Fehler: {grund}",
    netzfehler: "Netzfehler ({name}: {meldung})",
    unklarKopf: "Ausgang unklar: {methode} {pfad} ging hinaus, blieb aber ohne verwertbare Antwort — "
      + "die Wirkung kann eingetreten sein.",
    unklarOhneSchluessel: "Der Aufruf lief ohne Idempotenz-Schluessel; eine blinde Wiederholung "
      + "kann ihn ein zweites Mal ausfuehren. Erst am Board nachsehen.",
    unklarMitSchluessel: "Schluessel: {schluessel}. Mit genau diesem Schluessel wiederholen — derselbe "
      + "Schluessel fuehrt die Wirkung hoechstens einmal aus:",
    statusUngueltig: "Ungueltiger Status '{status}'. Gueltig: {gueltig}",
    issueFehlt: "Issue {id} nicht gefunden",
    direktOhneNummer: "Direktes Anlegen lieferte keine Board-Nummer — die Instanz kennt 'direct' offenbar nicht. "
      + "Die Toolbox-Instanz aktualisieren; dann legt sie direkt ins Backlog an.",
    routeUnbekannt: "Die Toolbox-Instanz kennt die Route PATCH {pfad} nicht (HTTP {status}) — Kommentare lassen sich dort nicht ersetzen.",
    labelNichtDefiniert: "Label '{name}' ist am Board nicht definiert. Die Definition muss einmal je Board angelegt werden "
      + "({route}), danach setzt und entfernt die Automatik sie.",
    trackerUnbekannt: "Unbekannter issueTracker: '{name}'. Erwartet: github | gitlab | local | toolbox",
    codeHostUnbekannt: "Unbekannter codeHost: '{name}'. Erwartet: github | gitlab | local",
  }),
  en: Object.freeze({
    projektAutomatisch: "Note: github.projectNumber is missing in workflow.config.json, using the automatically "
      + "detected only GitHub Project #{num} ('{titel}') for owner '{owner}'. "
      + "To pin it permanently, add: '\"github\": { \"projectNumber\": {num} }'",
    projektKeines: "github.projectNumber is missing in workflow.config.json, and owner '{owner}' has no GitHub Project. "
      + "Please add: '\"github\": { \"projectNumber\": <N> }'",
    projektMehrere: "github.projectNumber is missing in workflow.config.json, owner '{owner}' has several Projects: {liste}. "
      + "Please add: '\"github\": { \"projectNumber\": <N> }'",
    projektNichtGefunden: "GitHub Project #{num} not found for owner '{owner}'",
    statusFeldFehlt: "No 'Status' field found in GitHub Project #{num}",
    spalteSchreibweise: "Note: workflow.config.json configures the label '{label}' for status '{status}', "
      + "the GitHub Project actually uses '{option}' (case differs). "
      + "Still recognised by fallback for now — to avoid silent follow-up errors, please adjust "
      + "workflow.config.json: '\"columns\": { \"{status}\": \"{option}\" }'",
    issueNichtImRepo: "Issue #{id} not found in repo '{repo}'",
    issueNichtImBoard: "Issue #{id} not found in Project Board #{num}",
    ghUrlUnlesbar: "Could not read the issue URL from the gh output: {ausgabe}",
    boardZuordnungFehlgeschlagen: "Note: adding to the board failed: {grund}",
    keinStatusFilter: "Note: no unique GitHub Project could be determined, no board status filter possible. Listing all open issues.",
    statusOhneOption: "Status '{status}' has no counterpart in the GitHub Project",
    labelsNichtNachgeschlagen: "Note: labels could not be looked up ({grund}). Listing without labels.",
    statusUpdateFehlgeschlagen: "Status update failed (even after cache refresh): {grund} (original error: {erster})",
    keinJson: "{aufruf} returned no valid JSON: {auszug}",
    enforcementUnbekannt: "enforcement '{wert}' unknown. Expected: active | disabled",
    rulesetFremd: "Ruleset '{name}' does not belong to the kit (name without '{praefix}') — it is left untouched.",
    rulesetFehlt: "Ruleset '{name}' not found in '{repo}'.",
    glabIdUnlesbar: "Could not read the issue ID from the glab output: {ausgabe}",
    backlogLabelFehlgeschlagen: "Note: the backlog label could not be set: {grund}",
    kommentareNichtAbrufbar: "Note: comments not available: {grund}",
    gitlabOhneLabel: "Status '{status}' has no GitLab label mapping",
    schutzGitlab: "With GitLab the kit sets up no protection: the main and release branches "
      + "stay unprotected and also accept an unchecked push that bypasses push main.",
    schutzLocal: "With codeHost local there is no code host that could reject a push: "
      + "the main and release branches stay unprotected.",
    issueDateiFehlt: "Issue {id} not found: {pfad}",
    kommentarFehlt: "Comment {kommentar} on issue {id} not found.",
    kommentarOhneLaufzeile: "Comment {kommentar} on issue {id} does not carry the line '{zeile}' — not replaced.",
    klartextToken: "no plain-text token in workflow.config.json — use TBX_TOKEN or toolbox.tokenFile.",
    tokenDateiUnlesbar: "toolbox.tokenFile '{datei}' not readable: {grund}",
    tokenDateiLeer: "toolbox.tokenFile '{datei}' is empty.",
    keinToken: "No Toolbox token found. Three ways: set TBX_TOKEN as an environment variable, "
      + "point toolbox.tokenFile in workflow.config.json to a token file, "
      + "or create a token in the web UI and run 'tbx auth login'.",
    createAntwortUnerwartet: "Unexpected create response of the Kanban API (neither 'number' nor 'id'): {antwort}",
    keinHost: "No Toolbox host found. Set toolbox.host in workflow.config.json or run 'tbx auth login'.",
    tokenUngueltig: "Token invalid or revoked. Please run 'tbx auth login' again.",
    wiederholZeile: "board: {methode} {pfad} — attempt {versuch} ended with {grund}, retrying in {warte} ms (deadline {frist} s)",
    apiNichtErreichbar: "Toolbox API not reachable ({host}): {grund}",
    apiFehler: "Toolbox API error: {grund}",
    netzfehler: "network error ({name}: {meldung})",
    unklarKopf: "Outcome unclear: {methode} {pfad} went out but got no usable response — "
      + "the effect may have taken place.",
    unklarOhneSchluessel: "The call ran without an idempotency key; a blind retry "
      + "may execute it a second time. Check the board first.",
    unklarMitSchluessel: "Key: {schluessel}. Retry with exactly this key — the same "
      + "key executes the effect at most once:",
    statusUngueltig: "Invalid status '{status}'. Valid: {gueltig}",
    issueFehlt: "Issue {id} not found",
    direktOhneNummer: "Direct creation returned no board number — the instance apparently does not know 'direct'. "
      + "Update the Toolbox instance; it then creates straight into the backlog.",
    routeUnbekannt: "The Toolbox instance does not know the route PATCH {pfad} (HTTP {status}) — comments cannot be replaced there.",
    labelNichtDefiniert: "Label '{name}' is not defined on the board. The definition must be created once per board "
      + "({route}); after that the automation sets and removes it.",
    trackerUnbekannt: "Unknown issueTracker: '{name}'. Expected: github | gitlab | local | toolbox",
    codeHostUnbekannt: "Unknown codeHost: '{name}'. Expected: github | gitlab | local",
  }),
});
