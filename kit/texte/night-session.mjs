/**
 * texte/night-session.mjs — die Texttabelle von night/session.mjs (Issue #1525). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// --- Texte an den Menschen (Issue #1488, Plan #1420 E13/E14) ---

// Teil 1 (#1488) deckt den Quelltext bis vor `permissionArgs`, Teil 2 (#1489) den Rest. Deutsch
// bleiben dort die Prompts an Sessions (`salvagePrompt`, `vorflugPrompt`, die Probe) — sie liest
// ein Modell; nur der Vorgabeprompt geht ueber die Tabelle (#1471) — und `gueteAuswerten`, deren Wortlaut dem Original in kit/checks.mjs folgt.
// Vertrag bleibt (E14): die Marken `Ergebnis uebernommen` und `Pruefung festgefahren:`, die
// kit/checks.mjs schreibt und dieser Teil aus dem Strom liest, die Stufenwerte
// `schwer|mittel|leicht` und die Feldnamen `modell`, `kommando` und `night.modelle`.
export const TEXTE = Object.freeze({
  de: Object.freeze({
    checksFehlt: "checks.mjs liegt nicht neben night.mjs ({pfad}) — der Ort der Pruef-Zusammenfassung ist unbekannt.",
    namenFehlt: "board/namen.mjs fehlt neben night.mjs ({pfad}) — Marker sind nicht lesbar.",
    modellBindestrich: "Empfohlenes Modell \"{name}\" beginnt mit einem Bindestrich und ist kein Modellname — Modell des Laufs.",
    modellNichtErlaubt: "Empfohlenes Modell \"{name}\" steht nicht in night.modelle — Modell des Laufs.",
    stufeUnbekannt: "Aufgabenstufe \"{wert}\" ist kein bekannter Stufenwert (schwer, mittel, leicht) — keine Stufe.",
    startModellNichtErlaubt: "Modell \"{modell}\" steht nicht in night.modelle",
    startOhneEintrag: "weder modell noch kommando gesetzt",
    startNurUmgebung: "die Kommandozeile \"{kommando}\" nennt nur Umgebung und kein Programm",
    startShell: "die Shell fuer \"{programm}\" liess sich nicht starten: {fehler}",
    startNichtAuffindbar: "das Programm \"{programm}\" ist ueber die Shell nicht auffindbar",
    keineAufgabenstufe: "\"{stufe}\" ist keine Aufgabenstufe",
    stufeNichtBelegt: "Stufe {stufe} nicht belegt",
    stufeNichtStartbar: "Stufe {stufe} nicht startbar: {grund}",
    modellUndStufe: "Karte nennt Modell und Aufgabenstufe {stufe} — der Modellname gewinnt.",
    einstellungNichtFrisch: "die Einstellung liess sich nicht frisch lesen ({fehler}) — es gilt der Stand des Laufbeginns.",
    prozesseNachEnde: "  Hinweis: Nach dem Ende der Session liefen noch Prozesse ihrer Gruppe, als die Frist ablief — "
      + "die folgende Messung kann von ihnen gestoert sein.",
    // Teil 2 (#1489): ab `permissionArgs`.
    claudeFehlt: "claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?",
    shellFehlt: "die Shell \"{cmd}\" fuer die Kommando-Stufe wurde nicht gefunden",
    sitzungsstartGescheitert: "Sitzungsstart zu #{id} gescheitert ({exit})",
    merkmalRot: "Fehlermerkmal in der Ausgabe: '{merkmal}' — der Lauf gilt als rot",
    gueteOhneErgebnis: "Guete: kein auswertbares Ergebnis ({grund})",
    gueteErgebnis: "Guete: {anteil} % erreicht, Marke {marke} % — {grund}",
    checksFehltPfad: "{pfad} liegt nicht vor — die Pflicht-Pruefungen lassen sich nicht fahren.",
    formatFixStart: "  buildChecks rot — einmaliger Format-Fix wird angewendet: {cmd}",
    formatFixNichtGestartet: "  Format-Fix nicht gestartet: {fehler}",
    formatFixGruen: "  FORMAT-FIX angewendet, buildChecks jetzt gruen — der Lauf geht weiter.",
    laufModellNichtErlaubt: "night.modell '{wert}' steht nicht in night.modelle — bitte dort eintragen oder night.modell aendern.",
    nichtLeererText: "{feld} muss ein nicht leerer Text sein",
    zahlGroesserNull: "{feld} muss eine Zahl groesser 0 sein, ist {wert}",
    ganzzahlig: "{feld} muss ganzzahlig sein, ist {wert}",
    uebergaengeKeinObjekt: "night.kette.uebergaenge muss ein Objekt mit Wahrheitswerten sein",
    uebergangUnbekannt: "night.kette.uebergaenge.{feld} ist kein Uebergang der Kette (bekannt: {bekannt})",
    uebergangKeinWahrheitswert: "night.kette.uebergaenge.{feld} muss true oder false sein, ist {wert}",
    zielUnbekannt: "zielLabelName: unbekanntes Ziel \"{ziel}\"",
    vorflugProtokoll: "--- Vorflug-Session ---",
    vorflugNichtsGemeldet: "die Vorflug-Session hat zu diesem Reviewer nichts gemeldet",
    vorflugOhneGrund: "ohne Grund als nicht verfuegbar gemeldet",
    vorflugKeinTracker: "die Vorflug-Session hat keinen Tracker-Befund gemeldet",
    vorflugZeitlimit: "Zeitlimit von {ms} ms ueberschritten",
    vorflugOhneBlock: "die Vorflug-Session endete ohne auswertbaren Befund-Block",
    vorflugExitOhneBlock: "die Vorflug-Session endete mit Exit {status} und ohne auswertbaren Befund-Block",
    // Der Vorgabeprompt einer Umsetzungs-Session (Issue #1471): Der Skill-Name ist in beiden
    // Sprachen derselbe, und `umsetzungsStart` erkennt ihn.
    vorgabePrompt: "/implement-next #{id}",
  }),
  en: Object.freeze({
    checksFehlt: "checks.mjs is not next to night.mjs ({pfad}) — the location of the check summary is unknown.",
    namenFehlt: "board/namen.mjs is missing next to night.mjs ({pfad}) — markers cannot be read.",
    modellBindestrich: "Recommended model \"{name}\" starts with a hyphen and is not a model name — model of the run.",
    modellNichtErlaubt: "Recommended model \"{name}\" is not in night.modelle — model of the run.",
    stufeUnbekannt: "Task tier \"{wert}\" is not a known tier value (schwer, mittel, leicht) — no tier.",
    startModellNichtErlaubt: "model \"{modell}\" is not in night.modelle",
    startOhneEintrag: "neither modell nor kommando set",
    startNurUmgebung: "the command line \"{kommando}\" names only environment and no program",
    startShell: "the shell for \"{programm}\" could not be started: {fehler}",
    startNichtAuffindbar: "the program \"{programm}\" cannot be found via the shell",
    keineAufgabenstufe: "\"{stufe}\" is not a task tier",
    stufeNichtBelegt: "tier {stufe} not assigned",
    stufeNichtStartbar: "tier {stufe} not startable: {grund}",
    modellUndStufe: "Card names a model and task tier {stufe} — the model name wins.",
    einstellungNichtFrisch: "the settings could not be read fresh ({fehler}) — the state at the start of the run applies.",
    prozesseNachEnde: "  Note: processes of its group were still running when the deadline after the end of the session "
      + "expired — the following measurement may be disturbed by them.",
    claudeFehlt: "claude CLI not found. Is Claude Code installed and on the PATH?",
    shellFehlt: "the shell \"{cmd}\" for the command tier was not found",
    sitzungsstartGescheitert: "Session start for #{id} failed ({exit})",
    merkmalRot: "Error marker in the output: '{merkmal}' — the run counts as red",
    gueteOhneErgebnis: "Quality: no evaluable result ({grund})",
    gueteErgebnis: "Quality: {anteil} % reached, threshold {marke} % — {grund}",
    checksFehltPfad: "{pfad} does not exist — the required checks cannot be run.",
    formatFixStart: "  buildChecks red — one-time format fix being applied: {cmd}",
    formatFixNichtGestartet: "  Format fix not started: {fehler}",
    formatFixGruen: "  FORMAT FIX applied, buildChecks now green — the run continues.",
    laufModellNichtErlaubt: "night.modell '{wert}' is not in night.modelle — add it there or change night.modell.",
    nichtLeererText: "{feld} must be a non-empty text",
    zahlGroesserNull: "{feld} must be a number greater than 0, is {wert}",
    ganzzahlig: "{feld} must be an integer, is {wert}",
    uebergaengeKeinObjekt: "night.kette.uebergaenge must be an object of booleans",
    uebergangUnbekannt: "night.kette.uebergaenge.{feld} is not a transition of the chain (known: {bekannt})",
    uebergangKeinWahrheitswert: "night.kette.uebergaenge.{feld} must be true or false, is {wert}",
    zielUnbekannt: "zielLabelName: unknown goal \"{ziel}\"",
    vorflugProtokoll: "--- Preflight session ---",
    vorflugNichtsGemeldet: "the preflight session reported nothing about this reviewer",
    vorflugOhneGrund: "reported as unavailable without a reason",
    vorflugKeinTracker: "the preflight session reported no tracker finding",
    vorflugZeitlimit: "time limit of {ms} ms exceeded",
    vorflugOhneBlock: "the preflight session ended without an evaluable finding block",
    vorflugExitOhneBlock: "the preflight session ended with exit {status} and without an evaluable finding block",
    vorgabePrompt: "/implement-next #{id}",
  }),
});
