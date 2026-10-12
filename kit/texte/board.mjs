/**
 * texte/board.mjs — die Texttabelle von board.mjs (Issue #1524). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Texte des Einstiegs an den Menschen (Issue #1477, Plan #1420 E13). Vertragswerte (E14)
 * stehen nicht hier: die Feldnamen der JSON-Ausgaben und die Werte, die ein Aufrufer liest.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    fehler: "Fehler",
    unerwarteterFehler: "Unerwarteter Fehler",
    unbekannteAchse: "Unbekannte Achse: '{achse}'. Erwartet: {erwartet}",
    unbekannterBefehl: "Unbekannter {achse}-Befehl: '{befehl}'",
    unbekannteSchutzAktion: "Unbekannte {schutz}-Aktion: '{aktion}'. Erwartet: {erwartet}",
    optionErforderlich: "--{option} ist erforderlich",
    optionOhneWert: "--{option} braucht einen Wert",
    checkFormOhnePfad: "--body-file braucht einen Pfad. {wege}.",
    checkFormOhneTitel: "--body-file braucht --title, damit die Stufe feststeht. {wege}.",
    checkFormUnlesbar: "--body-file: {datei} ist nicht lesbar ({grund}). {wege}.",
    checkFormBeides: "Kartennummer und --body-file zugleich uebergeben. {wege}.",
    checkFormNichts: "Keine Eingabe uebergeben. {wege}.",
    checkFormArt: "{fehler}. {wege}.",
    checkGeschuetztOhneId: "{befehl} braucht eine Kartennummer: node board.mjs {befehl} <id>",
    fragenOhneId: "issue questions braucht eine Kartennummer: node board.mjs issue questions <id> [--body-file <pfad>] [--compare <pfad>]",
    optionDateiUnlesbar: "--{option}: {datei} ist nicht lesbar ({grund})",
    handlungFreigegeben: "Freigegeben: Der Halt-Kommentar nennt jede geschuetzte Datei und das Label ist abgenommen — das Paket darf beginnen.",
    handlungKeineDatei: "Keine geschuetzte Datei genannt — das Paket darf beginnen.",
    handlungNurLabel: "menschliche Handlung wartet: Die Karte traegt das Label {label}. Ist die geschuetzte Aenderung erledigt, nimmt ein Mensch das Label ab.",
    handlungMitLabel: "menschliche Handlung wartet: Ein Mensch nimmt die Aenderung an {pfade} selbst vor und nimmt danach das Label {label} ab.",
    handlungAnhalten: "menschliche Handlung wartet: Das Paket nennt {pfade}, die nur ein Mensch schreiben darf. Es wird angehalten; der Halt-Kommentar sagt, was zu aendern ist.",
    keinePullRequests: "Dieser codeHost unterstuetzt keine Pull Requests. Nutze einen lokalen git-Merge.",
    keinSchutz: "Der Code-Host kennt keinen Schutz.",
    aussetzenOhneIn: "--in <pfad> ist erforderlich: der Worktree mit dem gruenen Lauf der Stufe push",
    notfallVerweigert: "Notfallweg verweigert: {grund}",
    wiederherstellenGescheitert: "Wiederherstellen gescheitert, der Schutz des Hauptzweigs bleibt ausgesetzt: {grund}\nWiederholen: {kommando}",
    notizordnerUnlesbar: "Notizordner nicht lesbar: {ordner} ({grund})",
    notizMehrdeutig: "Mehrdeutige Notiz in {ordner}: {dateien}. Die Dateinamen unterscheiden sich nur in der Gross-/Kleinschreibung — im Vault auf einen Namen zusammenfuehren.",
  }),
  en: Object.freeze({
    fehler: "Error",
    unerwarteterFehler: "Unexpected error",
    unbekannteAchse: "Unknown axis: '{achse}'. Expected: {erwartet}",
    unbekannterBefehl: "Unknown {achse} command: '{befehl}'",
    unbekannteSchutzAktion: "Unknown {schutz} action: '{aktion}'. Expected: {erwartet}",
    optionErforderlich: "--{option} is required",
    optionOhneWert: "--{option} needs a value",
    checkFormOhnePfad: "--body-file needs a path. {wege}.",
    checkFormOhneTitel: "--body-file needs --title so the stage is known. {wege}.",
    checkFormUnlesbar: "--body-file: {datei} is not readable ({grund}). {wege}.",
    checkFormBeides: "Card number and --body-file given together. {wege}.",
    checkFormNichts: "No input given. {wege}.",
    checkFormArt: "{fehler}. {wege}.",
    checkGeschuetztOhneId: "{befehl} needs a card number: node board.mjs {befehl} <id>",
    fragenOhneId: "issue questions needs a card number: node board.mjs issue questions <id> [--body-file <pfad>] [--compare <pfad>]",
    optionDateiUnlesbar: "--{option}: {datei} is not readable ({grund})",
    handlungFreigegeben: "Released: the halt comment names every protected file and the label is removed — the package may start.",
    handlungKeineDatei: "No protected file named — the package may start.",
    handlungNurLabel: "human action pending: the card carries the label {label}. Once the protected change is done, a human removes the label.",
    handlungMitLabel: "human action pending: a human makes the change to {pfade} themselves and then removes the label {label}.",
    handlungAnhalten: "human action pending: the package names {pfade}, which only a human may write. It is halted; the halt comment says what to change.",
    keinePullRequests: "This codeHost does not support pull requests. Use a local git merge.",
    keinSchutz: "The code host knows no protection.",
    aussetzenOhneIn: "--in <pfad> is required: the worktree with the green run of stage push",
    notfallVerweigert: "Emergency path refused: {grund}",
    wiederherstellenGescheitert: "Restoring failed, the protection of the main branch stays suspended: {grund}\nRepeat: {kommando}",
    notizordnerUnlesbar: "Note folder not readable: {ordner} ({grund})",
    notizMehrdeutig: "Ambiguous note in {ordner}: {dateien}. The file names differ only in upper/lower case — merge them into one name in the vault.",
  }),
});
