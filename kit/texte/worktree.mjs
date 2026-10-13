/**
 * texte/worktree.mjs — die Texttabelle von worktree.mjs (Issue #1524). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Texte an Menschen in beiden Sprachen (Issue #1499, Plan #1420 E13): die Fehler dieses
 * Einstiegs. Die Hilfe gibt es genau einmal, englisch, in worktree.mjs selbst (Issue #1564,
 * Plan #1548 E7). Unuebersetzt bleibt der Maschinenvertrag (E14): die Feldnamen der
 * JSON-Ausgaben, die getippten Werte von --result und --fetch, die Referenz und die Dateinamen unter
 * `.claude/`. Was `night/kitstand.mjs` meldet, traegt dessen eigene Tabelle. Den Gleichstand
 * der Schluessel und Platzhalter haelt test/befunde-texte-en.test.mjs.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    keinRepo: "kein git-Repo: {ausgabe}",
    keineHauptkopie: "git worktree list nennt keine Hauptkopie: {ausgabe}",
    exitCode: "Exit-Code {status}",
    signal: "Signal {signal}",
    installRot: "installCommand '{kommando}' endete mit {code} — der Worktree wurde wieder abgebaut",
    entfernenPfad: "remove braucht den Pfad des Worktrees",
    rueckwegPfad: "return braucht den Pfad des Worktrees",
    festhaltenPfad: "record-preparation braucht den Pfad des Worktrees",
    festhaltenErgebnis: "record-preparation braucht --result <{werte}>",
    unbekannterWert: "{option} '{wert}' ist unbekannt — erwartet {werte}",
    altname: "unbekannt: '{name}' — englischer Name: '{englisch}'",
    imForm: "in braucht <pfad> -- <kommando> [argumente]",
    imKeinVerzeichnis: "in: '{pfad}' ist kein Verzeichnis",
    imStart: "in: '{programm}' liess sich nicht starten ({grund})",
    unbekannt: "unbekanntes Kommando '{kommando}' — bekannt sind create, remove, in, catch-up-check, return, record-preparation, check-preparation",
  }),
  en: Object.freeze({
    keinRepo: "not a git repo: {ausgabe}",
    keineHauptkopie: "git worktree list names no main copy: {ausgabe}",
    exitCode: "exit code {status}",
    signal: "signal {signal}",
    installRot: "installCommand '{kommando}' ended with {code} — the worktree was torn down again",
    entfernenPfad: "remove needs the path of the worktree",
    rueckwegPfad: "return needs the path of the worktree",
    festhaltenPfad: "record-preparation needs the path of the worktree",
    festhaltenErgebnis: "record-preparation needs --result <{werte}>",
    unbekannterWert: "{option} '{wert}' is unknown — expected {werte}",
    altname: "unknown: '{name}' — English name: '{englisch}'",
    imForm: "in needs <path> -- <command> [arguments]",
    imKeinVerzeichnis: "in: '{pfad}' is not a directory",
    imStart: "in: '{programm}' could not be started ({grund})",
    unbekannt: "unknown command '{kommando}' — known are create, remove, in, catch-up-check, return, record-preparation, check-preparation",
  }),
});
