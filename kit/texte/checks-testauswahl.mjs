/**
 * texte/checks-testauswahl.mjs — die Texttabelle von checks/testauswahl.mjs (Issue #1716,
 * Plan #1713 A6, P13): die Gruende der Urteile „nicht beurteilbar" und „nicht aus der
 * Auswertung abgeleitet". Eigener Teil wie die uebrigen Tabellen, damit `sonar.cpd.exclusions`
 * die gleich gebauten Haelften de und en ausnehmen kann. Unuebersetzt bleiben Kommandos,
 * Optionen und Schluessel der Laeufer: Das sind Namen, nicht Worte an Menschen.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    stringform: "Eintrag in Stringform, laeuft immer",
    immer: "always: true, laeuft immer",
    stufe: "Stufe {stufe}, laeuft nicht beim Abschluss eines Pakets",
    keineTests: "kein Testlaeufer im Kommando erkannt",
    fremdeSprache: "Testlaeufer einer anderen Sprache: {laeufer}",
    eigeneAuswahl: "{datei} waehlt die Tests selbst ({schluessel})",
    optionAuswahl: "{laeufer} {option} waehlt die Tests selbst",
    skriptFehlt: "{datei} kennt kein Skript {skript}",
    skriptVerschachtelt: "Skript {skript} ruft {aufruf} auf, aufgeloest wird nur eine Stufe",
    ortAusserhalb: "Ort {ort} liegt ausserhalb des Repos",
    modulUnbekannt: "Modul {modul} aus -pl laesst sich keinem Ordner zuordnen",
    mitAbhaengigen: "mvn {option} baut weitere Module mit, deren Tests nicht feststehen",
    unlesbar: "{datei} ist nicht lesbar ({grund})",
  }),
  en: Object.freeze({
    stringform: "entry in string form, always runs",
    immer: "always: true, always runs",
    stufe: "stage {stufe}, does not run when a package is finished",
    keineTests: "no test runner recognised in the command",
    fremdeSprache: "test runner of another language: {laeufer}",
    eigeneAuswahl: "{datei} selects the tests itself ({schluessel})",
    optionAuswahl: "{laeufer} {option} selects the tests itself",
    skriptFehlt: "{datei} has no script {skript}",
    skriptVerschachtelt: "script {skript} calls {aufruf}, only one level is resolved",
    ortAusserhalb: "location {ort} lies outside the repository",
    modulUnbekannt: "module {modul} from -pl cannot be mapped to a folder",
    mitAbhaengigen: "mvn {option} also builds further modules whose tests are not known",
    unlesbar: "{datei} cannot be read ({grund})",
  }),
});
