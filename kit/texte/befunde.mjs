/**
 * texte/befunde.mjs — die Texttabelle von befunde.mjs (Issue #1524). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Texte an Menschen in beiden Sprachen (Issue #1498, Plan #1420 E13): Hilfe, die
 * Erklaerungen der Mangel-Arten, die Meldungen von `pruefen`, die Gruende von `vorschlag`,
 * Titel und Body der Idee samt Ergaenzung, Bericht `befunde.md`, Befundblock und die Fehler.
 * Unuebersetzt bleibt der Maschinenvertrag (E14): die Feldnamen der JSON-Ausgaben, die
 * Artnamen, die Marken, die Formwoerter des Fundblocks (`Gegenprobe:`, `— geprueft,
 * bestaetigt`, `— nicht geprueft`, `Art:`), die Stufen, Rollen, Angaben-Schluessel
 * (`keine-pruefer`, `reviewer-kopf`), die Vorschlagsstaende im Stand und die Werte des
 * Vergleichsstands (`gruen`, `nicht-vergleichbar`). Den Gleichstand der Schluessel und
 * Platzhalter haelt test/befunde-texte-en.test.mjs.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    hilfe: `befunde.mjs (claude-workflow-kit v{version}) — Form und Arten der Funde

  node befunde.mjs arten
  node befunde.mjs pruefen --datei <pfad>
  node befunde.mjs buchen --datei <pfad> --stufe <fachlich|plan|issue|code> --karte <n>
  node befunde.mjs vorschlag --art <art>
  node befunde.mjs vorschlag --abgelehnt <art>
  node befunde.mjs auswerten
  node befunde.mjs befund

arten    Gibt die {anzahl} Mangel-Arten mit je einem erklaerenden Satz aus. Diese Liste
         ist der einzige Wortlaut im Kit; ein Projekt ergaenzt keine eigenen Arten.
pruefen  Liest einen Befunde-Text, erkennt die Fundbloecke an ihrer Schweregrad-Marke
         ({marken}) und meldet je Fund die
         fehlenden der drei Pflichtangaben: die Gegenprobe, ihren Stand und die Art.
         Im Befunde-Kommentar von /issue-review ('## <Stufe>-Review, Runde <n>')
         meldet es dazu einen Fund ohne vorangehenden Reviewer-Kopf
         '### Reviewer <n>: <rolle>, <modell>' als 'reviewer-kopf', und traegt
         der Text gar keinen solchen Kopf, unter 'meldungen' '{keinePruefer}'.
         Exit 0 auch bei lauter unvollstaendigen Funden — aus der Form wird kein Gate.
         Ungleich 0 wird nur ein Aufruf, der nicht geht: fehlendes --datei, fehlende
         oder unlesbare Datei.
buchen   Schreibt je Fund mit 'Gegenprobe: … — geprueft, bestaetigt' UND
         'Uebernahme: uebernommen' eine Zeile nach .claude/befunde.tsv — anhaengend,
         nie leerend — und meldet je beruehrter Art den neuen Zaehlerstand und ob die
         Schwelle (Config-Block befunde.schwelle, Vorgabe {schwelle}) erreicht ist, dazu
         mit 'vorschlag', ob die Art an der Schwelle einen Vorschlag erzeugt. Bei
         --stufe code steht in der letzten Spalte der Vergleichsstand der
         Pflichtpruefungen ('gruen' oder '{nichtVergleichbar}'), sonst '-'.
vorschlag
         --art <art> legt am Board eine Idee an, sobald die Art oberhalb ihres
         Nullpunkts die Schwelle erreicht — nur fuer form, konvention, sicherheit
         (Frage nach einer Pruefung) und sonstiges (Frage nach der Artenliste); eine
         Urteils-Art legt nichts an und endet mit 0; ein bereits offener Vorschlag wird
         ergaenzt statt gedoppelt. Unterhalb der Schwelle entsteht nichts, und das
         ist kein Fehler. --abgelehnt <art> vermerkt die Ablehnung und setzt den
         Nullpunkt auf den aktuellen Zaehlerstand — ein Handgriff ohne Board-Aufruf.
         Der Vermerk steht in {vorschlaege}; ein gescheiterter
         Board-Aufruf laesst ihn unveraendert und endet ungleich 0. Eine nicht mehr
         auffindbare Vorschlagskarte gilt als erledigt: Ihr Stand wird der neue
         Nullpunkt, und eine neue Idee traegt nur die Funde danach. Im Worktree
         eines Laufs legt --art nichts an (der Vorschlag folgt beim Abbau in der
         Hauptkopie), und --abgelehnt endet ungleich 0.
auswerten
         Liest {protokoll} und {vorschlaege} und
         schreibt {bericht} sowie {stand}: je Art
         die Zahl der Vorkommen, die Verteilung ueber die Stufen und den Stand eines
         Vorschlags, dazu die Stufe 'code' getrennt nach gruenem und nicht
         vergleichbarem Vergleichsstand. Beide Dateien entstehen vollstaendig, auch
         wenn nichts auffaellt.
befund   Gibt den Befundblock aus {stand} als Text aus. Liegt kein
         Befund vor, fehlt die Datei oder ist sie leer oder unlesbar, bleibt die
         Ausgabe leer. Exit immer 0 — der Befund ist kein Gate.

  --version   Kit-Stand dieser Datei.
  --help, -h  Diese Uebersicht.

Die Ausgabe aller Kommandos ist JSON auf stdout — auch im Leerfall und auch bei einem
abgewiesenen Aufruf. Einzige Ausnahme ist 'befund': Was dort auf stdout steht, reicht
eine Ausgabestelle unveraendert weiter, und eine Fehlermeldung haette darin nichts zu
suchen.
`,
    art_bestandsbehauptung: "Der geprueste Text behauptet etwas ueber den Bestand — eine Datei, eine Zeile, ein Verhalten —, das dort nicht so steht.",
    art_unbeobachtbar: "Eine Zusage ist so formuliert, dass sich nicht beobachten laesst, ob sie erfuellt ist.",
    art_widerspruch: "Zwei Stellen desselben Texts oder der Text und eine bindende Quelle sagen Verschiedenes.",
    art_luecke: "Ein fuer das Ziel noetiger Fall, Schritt oder Bereich fehlt ganz.",
    art_unbestimmt: "Eine Angabe laesst mehrere Auslegungen zu, und die Wahl aendert das Ergebnis.",
    art_form: "Der Text verletzt eine vorgeschriebene Form — ein Abschnitt, ein Feld, eine Reihenfolge, ein Format.",
    art_doppelung: "Dieselbe Aussage steht an zwei Orten, die auseinanderdriften koennen.",
    art_korrektheit: "Der beschriebene oder geschriebene Weg fuehrt zu einem falschen Ergebnis.",
    art_sicherheit: "Die Aenderung oeffnet einen Zugang, verraet ein Geheimnis oder umgeht eine Schranke.",
    art_test: "Ein Beleg fehlt, prueft am Gegenstand vorbei oder kann gar nicht fehlschlagen.",
    art_konvention: "Die Stelle weicht ohne Grund von einem im Projekt eingefuehrten Muster ab.",
    art_sonstiges: "Auffang-Art fuer einen Fund, der in keine der elf anderen passt; ein Projekt ergaenzt keine eigenen Arten.",
    angabeGegenprobe: "Die Zeile 'Gegenprobe: <Beobachtung, die den Fund widerlegen wuerde>' fehlt oder nennt vor ihrem Stand keine Beobachtung.",
    angabeStand: "Der Stand der Gegenprobe fehlt — erwartet wird '— geprueft, bestaetigt' oder '{nichtGeprueft}' am Zeilenende.",
    angabeArt: "Die Zeile 'Art: <name>' fehlt; gueltig sind die Namen aus 'befunde arten'.",
    angabeReviewerKopf: "Vor dem Fund steht kein Reviewer-Kopf '### Reviewer <n>: <rolle>, <modell>' — ohne ihn bucht 'buchen' die Rolle als 'unbekannt'.",
    artNichtInListe: "Die Art '{art}' steht nicht in der Liste; gueltig sind die Namen aus 'befunde arten'.",
    keinePruefer: "Der Text traegt keinen einzigen Reviewer-Kopf '### Reviewer <n>: <rolle>, <modell>' — kein Pruefer lief, die Pruefung gilt nicht als erledigt (review:fertig wird nicht gesetzt).",
    nachbarFehlt: "checks.mjs liegt nicht neben befunde.mjs ({pfad}) — 'buchen --stufe code' braucht blobHashes und den Ort der Pruef-Zusammenfassung aus dem Nachbarn.",
    dateiNichtLesbar: "Datei nicht lesbar: {pfad} ({grund}).",
    protokollNichtLesbar: "Hinweis: Protokoll nicht lesbar ({pfad}): {grund}",
    buchungNichtProtokolliert: "Hinweis: Buchung nicht protokolliert ({pfad}): {grund}",
    keineBasis: "die Zusammenfassung nennt keine Basis",
    gitDiffFehl: "git diff gegen '{basis}' schlug fehl: {grund}",
    gitStatusFehl: "git status schlug fehl: {grund}",
    boardFehlt: "board.mjs liegt nicht neben befunde.mjs ({pfad}) — 'vorschlag' schreibt ueber den Board-Adapter.",
    boardStartFehl: "board.mjs liess sich nicht starten: {grund}",
    boardFehl: "board.mjs {befehl} schlug fehl: {grund}",
    boardKeinJson: "board.mjs {befehl} lieferte kein JSON: {grund}",
    kennungFehlt: "board.mjs issue create lieferte weder 'id' noch 'ideaId': {antwort}",
    zustandNichtLesbar: "Zustandsdatei nicht lesbar: {datei} ({grund}).",
    zustandKaputt: "Zustandsdatei nicht lesbar: {datei} ({grund}). Von Hand richten — ein Ueberschreiben verloere die Nullpunkte aller Arten.",
    zustandKeinObjekt: "Zustandsdatei {datei} traegt kein Objekt.",
    nichtGeschrieben: "{datei} konnte nicht geschrieben werden: {grund}",
    grundUrteilsArt: "'{art}' ist eine Urteils-Art — ein Review beurteilt sie, eine maschinelle Pruefung faengt sie nicht. Es entsteht kein Vorschlag.",
    abgelehntImWorktree: "'vorschlag --abgelehnt' im Worktree eines Laufs wirkt nirgends und geht mit dem Worktree verloren — den Aufruf in der Hauptkopie machen.",
    grundWorktree: "Worktree eines Laufs — der Vorschlag folgt beim Abbau in der Hauptkopie.",
    grundUnterSchwelle: "{zaehlerstand} Vorkommen ueber dem Nullpunkt {nullpunkt} erreichen die Schwelle {schwelle} nicht.",
    grundPoolIdee: "Die Pool-Idee {idee} traegt noch keine adressierbare Nummer — sie laesst sich erst ergaenzen, wenn ein Mensch sie einplant.",
    grundKarteErledigt: "Die vermerkte Vorschlagskarte #{karte} wurde am Board nicht mehr gefunden und gilt als erledigt; {zaehlerstand} Vorkommen ueber dem neuen Nullpunkt {nullpunkt} erreichen die Schwelle {schwelle} nicht.",
    streuung: "Nicht alle Funde dieser Art sind mit derselben Pruefung zu fangen.",
    titelListe: "{praefix} Liste der Mangel-Arten erweitern?",
    titelPruefung: "{praefix} Maschinelle Pruefung fuer Mangel-Art {art}?",
    tabelleKopf: "| Zeitpunkt | Stufe | Karte | Rolle | Schweregrad |",
    frageListe: "Die Auffang-Art `sonstiges` hat die Schwelle {schwelle} erreicht. Das ist ein Hinweis darauf, dass die Liste der Mangel-Arten einen Fall nicht benennt, den die Reviewer regelmaessig finden — nicht darauf, dass eine Pruefung fehlt.",
    fragePruefung: "Die Mangel-Art `{art}` hat die Schwelle {schwelle} erreicht. Lohnt sich daraus eine maschinelle Pruefung, die solche Funde kuenftig faengt, bevor ein Modell sie melden muss?",
    ideeKontext: "## Kontext",
    ideeAutor: "Autor-Modell: {autor}",
    ideeStand: "Stand im Protokoll `{protokoll}`: {zaehlerstand} Vorkommen, Nullpunkt {nullpunkt}, Schwelle {schwelle}.",
    ideeBeobachtung: "Dieser Vorschlag ist eine Beobachtung, keine Entscheidung: Ob daraus eine Pruefung wird, entscheidet ein Mensch. Ohne sein Zutun entsteht keine.",
    ideeFundeKopf: "## Die zugrunde liegenden Funde",
    ideeWegKopf: "## Weg nach vorn",
    ideeWeg: "Diese Idee ist keine Aufgabe. Wer sie aufgreift, fuehrt sie ueber `/techplan #<n>` und `/issues` in Arbeitspakete; wer sie verwirft, ruft `node .claude/kit/befunde.mjs vorschlag --abgelehnt {art}` — dann zaehlt die Art ab dem heutigen Stand neu.",
    ergaenzungKopf: "## Weitere Funde der Mangel-Art `{art}`",
    ergaenzungStand: "Seit dem Stand dieses Vorschlags ({vorher}) sind {neu} Vorkommen dazugekommen — Stand jetzt {zaehlerstand}.",
    vorschlagUrteilsArt: "kein Vorschlag (Urteils-Art)",
    vorschlagKeiner: "kein Vorschlag vermerkt",
    vorschlagKarte: "Vorschlag {stand} (#{karte})",
    vorschlagIdee: "Vorschlag {stand} (Idee {idee})",
    vorschlagStand: "Vorschlag {stand}",
    stand_offen: "offen",
    stand_abgelehnt: "abgelehnt",
    stand_erledigt: "erledigt",
    berichtTitel: "# Befunde der Modell-Pruefungen",
    berichtAuswertung: "Auswertung vom {am} (claude-workflow-kit v{version}).",
    berichtProtokoll: "Protokoll `{datei}`: {zeilen} Zeilen, davon {fehlerhaft} unlesbar.",
    berichtOhneProtokoll: "Protokoll `{datei}` liegt nicht vor — in diesem Projekt hat noch keine Modell-Pruefung gebucht.",
    berichtSchwelle: "Schwelle: {schwelle} Vorkommen oberhalb des Nullpunkts einer Art.",
    artenTitel: "## Arten",
    artenKopf: "| Art | Vorkommen | {stufen} | code gruen | code nicht-vergleichbar | ueber Nullpunkt | Schwelle erreicht | Vorschlag |",
    ja: "ja",
    nein: "nein",
    codeTitel: "## Stufe code",
    codeKeiner: "Kein uebernommener Fund der Stufe `code` steht im Protokoll.",
    codeZeile: "Uebernommene Funde der Stufe `code` auf einem Stand mit gruenen Pflichtpruefungen: {gruen}. Als `{wert}` ausgewiesen: {anzahl}.",
    befundTitel: "## Befund",
    befundKeiner: "Keine Art traegt ein Vorkommen.",
    befundKopf: "Befunde der Modell-Pruefungen — Auswertung vom {am}: {vorkommen} Vorkommen in {arten} {artenWort}, Schwelle {schwelle}.",
    artEins: "Art",
    artMehr: "Arten",
    befundArt: "`{art}`: {vorkommen} Vorkommen{stufen}{schwellenteil} — {vorschlag}.",
    befundSchwellenteil: ", Schwelle {schwelle} erreicht",
    befundCode: "Stufe `code`: {gruen} auf einem Stand mit gruenen Pflichtpruefungen, {anzahl} als `{wert}` ausgewiesen.",
    aufrufLaeuft: "befunde.mjs: aufrufen laeuft schon — zwei Aufrufe zugleich gehen nicht",
    unbekanntesArgument: "Unbekanntes Argument: '{arg}'",
    dateiErwartet: "--datei erwartet einen Pfad.",
    pruefenBraucht: "'pruefen' braucht --datei <pfad>.",
    optionWert: "{option} erwartet einen Wert.",
    buchenBraucht: "'buchen' braucht --datei <pfad>, --stufe <stufe> und --karte <n>.",
    unbekannteStufe: "Unbekannte Stufe: '{stufe}'. Erwartet: {stufen}.",
    optionArt: "{option} erwartet eine Mangel-Art.",
    vorschlagBeides: "'vorschlag' nimmt --art ODER --abgelehnt, nicht beides.",
    vorschlagBraucht: "'vorschlag' braucht --art <art> oder --abgelehnt <art>.",
    unbekannteArt: "Unbekannte Art: '{art}'. Gueltig sind die Namen aus 'befunde arten'.",
    artenOhneArgumente: "'arten' nimmt keine Argumente, bekam '{arg}'.",
    auswertenOhneArgumente: "'auswerten' nimmt keine Argumente, bekam '{arg}'.",
    befundOhneArgumente: "'befund' nimmt keine Argumente, bekam '{arg}'.",
    keinKommando: "Kein Kommando. Erwartet: arten, pruefen, buchen, vorschlag, auswerten, befund.",
    unbekannterBefehl: "Unbekannter Befehl: '{befehl}'. Erwartet: arten, pruefen, buchen, vorschlag, auswerten oder befund.",
    fehler: "Fehler",
    unerwarteterFehler: "Unerwarteter Fehler",
  }),
  en: Object.freeze({
    hilfe: `befunde.mjs (claude-workflow-kit v{version}) — form and kinds of findings

  node findings.mjs kinds
  node findings.mjs check --file <path>
  node findings.mjs record --file <path> --stage <fachlich|plan|issue|code> --card <n>
  node findings.mjs suggest --kind <kind>
  node findings.mjs suggest --rejected <kind>
  node findings.mjs evaluate
  node findings.mjs finding

kinds    Prints the {anzahl} defect kinds with one explaining sentence each. This list
         is the only wording in the kit; a project adds no kinds of its own.
check    Reads a findings text, recognises the finding blocks by their severity mark
         ({marken}) and reports for each finding the
         missing ones of the three required entries: the counter-check, its state and the kind.
         In the findings comment of /issue-review ('## <Stage>-Review, Round <n>')
         it also reports a finding without a preceding reviewer head
         '### Reviewer <n>: <role>, <model>' as 'reviewer-kopf', and if the text
         carries no such head at all, '{keinePruefer}' under 'meldungen'.
         Exit 0 even with only incomplete findings — the form is no gate.
         Only a call that cannot work ends non-zero: missing --file, missing
         or unreadable file.
record   Writes one row to .claude/befunde.tsv for each finding with
         'Gegenprobe: … — geprueft, bestaetigt' AND 'Uebernahme: uebernommen' —
         appending, never emptying — and reports for each touched kind the new count
         and whether the threshold (config block findings.threshold, default {schwelle})
         is reached, plus with 'vorschlag' whether the kind creates a suggestion at the
         threshold. With --stage code the last column carries the comparison state of
         the required checks ('gruen' or '{nichtVergleichbar}'), otherwise '-'.
suggest
         --kind <kind> creates an idea on the board as soon as the kind reaches the
         threshold above its zero point — only for form, konvention, sicherheit
         (question about a check) and sonstiges (question about the list of kinds); a
         judgement kind creates nothing and ends with 0; an open suggestion is
         extended instead of doubled. Below the threshold nothing is created, and that
         is no error. --rejected <kind> records the rejection and sets the
         zero point to the current count — a manual step without a board call.
         The record lives in {vorschlaege}; a failed
         board call leaves it unchanged and ends non-zero. A suggestion card that can
         no longer be found counts as done: its count becomes the new
         zero point, and a new idea carries only the findings after it. In the worktree
         of a run --kind creates nothing (the suggestion follows at teardown in the
         main copy), and --rejected ends non-zero.
evaluate
         Reads {protokoll} and {vorschlaege} and
         writes {bericht} as well as {stand}: for each kind
         the number of occurrences, the distribution over the stages and the state of a
         suggestion, plus the stage 'code' split by green and
         not comparable comparison state. Both files are written in full, even
         when nothing stands out.
finding  Prints the finding block from {stand} as text. If there is
         no finding, or the file is missing, empty or unreadable, the output
         stays empty. Exit always 0 — the finding is no gate.

  --version   Kit revision of this file.
  --help, -h  This overview.

The output of all commands is JSON on stdout — also when empty and also for a
rejected call. The only exception is 'finding': what it prints on stdout an output
point passes on unchanged, and an error message would be out of place there.
`,
    art_bestandsbehauptung: "The checked text claims something about the existing state — a file, a line, a behaviour — that is not so there.",
    art_unbeobachtbar: "A commitment is worded so that one cannot observe whether it is met.",
    art_widerspruch: "Two places of the same text, or the text and a binding source, say different things.",
    art_luecke: "A case, step or area needed for the goal is missing entirely.",
    art_unbestimmt: "A statement allows several readings, and the choice changes the result.",
    art_form: "The text violates a prescribed form — a section, a field, an order, a format.",
    art_doppelung: "The same statement stands in two places that can drift apart.",
    art_korrektheit: "The described or written way leads to a wrong result.",
    art_sicherheit: "The change opens an access, reveals a secret or bypasses a barrier.",
    art_test: "Evidence is missing, checks past the subject or cannot fail at all.",
    art_konvention: "The place deviates without reason from a pattern established in the project.",
    art_sonstiges: "Catch-all kind for a finding that fits none of the other eleven; a project adds no kinds of its own.",
    angabeGegenprobe: "The line 'Gegenprobe: <observation that would refute the finding>' is missing or names no observation before its state.",
    angabeStand: "The state of the counter-check is missing — expected is '— geprueft, bestaetigt' or '{nichtGeprueft}' at the end of the line.",
    angabeArt: "The line 'Art: <name>' is missing; valid are the names from 'findings kinds'.",
    angabeReviewerKopf: "The finding has no reviewer head '### Reviewer <n>: <role>, <model>' before it — without it 'record' books the role as 'unbekannt'.",
    artNichtInListe: "The kind '{art}' is not in the list; valid are the names from 'findings kinds'.",
    keinePruefer: "The text carries not a single reviewer head '### Reviewer <n>: <role>, <model>' — no reviewer ran, the review does not count as done (review:done is not set).",
    nachbarFehlt: "checks.mjs is not next to befunde.mjs ({pfad}) — 'record --stage code' needs blobHashes and the location of the check summary from the neighbour.",
    dateiNichtLesbar: "File not readable: {pfad} ({grund}).",
    protokollNichtLesbar: "Note: log not readable ({pfad}): {grund}",
    buchungNichtProtokolliert: "Note: booking not logged ({pfad}): {grund}",
    keineBasis: "the summary names no base",
    gitDiffFehl: "git diff against '{basis}' failed: {grund}",
    gitStatusFehl: "git status failed: {grund}",
    boardFehlt: "board.mjs is not next to befunde.mjs ({pfad}) — 'suggest' writes through the board adapter.",
    boardStartFehl: "board.mjs could not be started: {grund}",
    boardFehl: "board.mjs {befehl} failed: {grund}",
    boardKeinJson: "board.mjs {befehl} returned no JSON: {grund}",
    kennungFehlt: "board.mjs issue create returned neither 'id' nor 'ideaId': {antwort}",
    zustandNichtLesbar: "State file not readable: {datei} ({grund}).",
    zustandKaputt: "State file not readable: {datei} ({grund}). Fix it by hand — overwriting it would lose the zero points of all kinds.",
    zustandKeinObjekt: "State file {datei} carries no object.",
    nichtGeschrieben: "{datei} could not be written: {grund}",
    grundUrteilsArt: "'{art}' is a judgement kind — a review judges it, a machine check does not catch it. No suggestion is created.",
    abgelehntImWorktree: "'suggest --rejected' in the worktree of a run has no effect and is lost with the worktree — make the call in the main copy.",
    grundWorktree: "Worktree of a run — the suggestion follows at teardown in the main copy.",
    grundUnterSchwelle: "{zaehlerstand} occurrences above the zero point {nullpunkt} do not reach the threshold {schwelle}.",
    grundPoolIdee: "The pool idea {idee} has no addressable number yet — it can only be extended once a human schedules it.",
    grundKarteErledigt: "The recorded suggestion card #{karte} was no longer found on the board and counts as done; {zaehlerstand} occurrences above the new zero point {nullpunkt} do not reach the threshold {schwelle}.",
    streuung: "Not all findings of this kind can be caught by the same check.",
    titelListe: "{praefix} Extend the list of defect kinds?",
    titelPruefung: "{praefix} Machine check for defect kind {art}?",
    tabelleKopf: "| Time | Stage | Card | Role | Severity |",
    frageListe: "The catch-all kind `sonstiges` has reached the threshold {schwelle}. This hints that the list of defect kinds does not name a case the reviewers find regularly — not that a check is missing.",
    fragePruefung: "The defect kind `{art}` has reached the threshold {schwelle}. Is a machine check worth it that catches such findings in future before a model has to report them?",
    ideeKontext: "## Context",
    ideeAutor: "Author-Model: {autor}",
    ideeStand: "State in the log `{protokoll}`: {zaehlerstand} occurrences, zero point {nullpunkt}, threshold {schwelle}.",
    ideeBeobachtung: "This suggestion is an observation, not a decision: whether a check comes of it, a human decides. Without their doing, none is created.",
    ideeFundeKopf: "## The underlying findings",
    ideeWegKopf: "## Way forward",
    ideeWeg: "This idea is no task. Whoever takes it up leads it via `/techplan #<n>` and `/issues` into work packages; whoever discards it calls `node .claude/kit/findings.mjs suggest --rejected {art}` — then the kind counts anew from today's state.",
    ergaenzungKopf: "## More findings of the defect kind `{art}`",
    ergaenzungStand: "Since the state of this suggestion ({vorher}), {neu} occurrences have been added — count now {zaehlerstand}.",
    vorschlagUrteilsArt: "no suggestion (judgement kind)",
    vorschlagKeiner: "no suggestion recorded",
    vorschlagKarte: "suggestion {stand} (#{karte})",
    vorschlagIdee: "suggestion {stand} (idea {idee})",
    vorschlagStand: "suggestion {stand}",
    stand_offen: "open",
    stand_abgelehnt: "rejected",
    stand_erledigt: "done",
    berichtTitel: "# Findings of the model reviews",
    berichtAuswertung: "Evaluation of {am} (claude-workflow-kit v{version}).",
    berichtProtokoll: "Log `{datei}`: {zeilen} rows, {fehlerhaft} of them unreadable.",
    berichtOhneProtokoll: "Log `{datei}` is missing — no model review has booked anything in this project yet.",
    berichtSchwelle: "Threshold: {schwelle} occurrences above the zero point of a kind.",
    artenTitel: "## Kinds",
    artenKopf: "| Kind | Occurrences | {stufen} | code green | code not comparable | above zero point | threshold reached | Suggestion |",
    ja: "yes",
    nein: "no",
    codeTitel: "## Stage code",
    codeKeiner: "No accepted finding of the stage `code` is in the log.",
    codeZeile: "Accepted findings of the stage `code` on a state with green required checks: {gruen}. Marked as `{wert}`: {anzahl}.",
    befundTitel: "## Finding",
    befundKeiner: "No kind carries an occurrence.",
    befundKopf: "Findings of the model reviews — evaluation of {am}: {vorkommen} occurrences in {arten} {artenWort}, threshold {schwelle}.",
    artEins: "kind",
    artMehr: "kinds",
    befundArt: "`{art}`: {vorkommen} occurrences{stufen}{schwellenteil} — {vorschlag}.",
    befundSchwellenteil: ", threshold {schwelle} reached",
    befundCode: "Stage `code`: {gruen} on a state with green required checks, {anzahl} marked as `{wert}`.",
    aufrufLaeuft: "befunde.mjs: aufrufen is already running — two calls at once are not possible",
    unbekanntesArgument: "Unknown argument: '{arg}'",
    dateiErwartet: "--file expects a path.",
    pruefenBraucht: "'check' needs --file <path>.",
    optionWert: "{option} expects a value.",
    buchenBraucht: "'record' needs --file <path>, --stage <stage> and --card <n>.",
    unbekannteStufe: "Unknown stage: '{stufe}'. Expected: {stufen}.",
    optionArt: "{option} expects a defect kind.",
    vorschlagBeides: "'suggest' takes --kind OR --rejected, not both.",
    vorschlagBraucht: "'suggest' needs --kind <kind> or --rejected <kind>.",
    unbekannteArt: "Unknown kind: '{art}'. Valid are the names from 'findings kinds'.",
    artenOhneArgumente: "'kinds' takes no arguments, got '{arg}'.",
    auswertenOhneArgumente: "'evaluate' takes no arguments, got '{arg}'.",
    befundOhneArgumente: "'finding' takes no arguments, got '{arg}'.",
    keinKommando: "No command. Expected: kinds, check, record, suggest, evaluate, finding.",
    unbekannterBefehl: "Unknown command: '{befehl}'. Expected: kinds, check, record, suggest, evaluate or finding.",
    fehler: "Error",
    unerwarteterFehler: "Unexpected error",
  }),
});
