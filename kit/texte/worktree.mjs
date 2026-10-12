/**
 * texte/worktree.mjs — die Texttabelle von worktree.mjs (Issue #1524). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Texte an Menschen in beiden Sprachen (Issue #1499, Plan #1420 E13): Hilfe und die Fehler
 * dieses Einstiegs. Unuebersetzt bleibt der Maschinenvertrag (E14): die Feldnamen der
 * JSON-Ausgaben, die Werte von --ergebnis und --fetch, die Referenz und die Dateinamen unter
 * `.claude/`. Was `night/kitstand.mjs` meldet, traegt dessen eigene Tabelle. Den Gleichstand
 * der Schluessel und Platzhalter haelt test/befunde-texte-en.test.mjs.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    hilfe: `worktree.mjs (claude-workflow-kit v{version}) — Worktree fuer die Release-Skills

  anlegen [--praefix <p>] [--ref <ref>] [--issue <n>]   Worktree auf <ref> (Vorgabe HEAD),
                                                        danach das installCommand der Config
  entfernen <pfad>                                      Worktree abbauen
  nachziehen-pruefen                                    Darf das lokale main rebased werden?
  rueckweg <pfad>                                       Zusammenfassung, Ausfuehrungen, Befunde zurueck
  vorbereitung-festhalten <pfad> --ergebnis <gruen|gruen-offen|rot>
      [--offen "<Text>"]... [--fetch <ok|fehlgeschlagen>]
                                                        Haelt die naechtliche Vorbereitung fest:
                                                        Referenz refs/kit/push-vorbereitet auf
                                                        HEAD des Worktrees, Datei
                                                        .claude/push-vorbereitung.json
  vorbereitung-pruefen [--verwerfen]                    Darf /push-main den vorbereiteten Stand
                                                        uebernehmen? Kein eigenes git fetch.
                                                        --verwerfen loescht Datei und Referenz
  im <pfad> -- <kommando> [argumente]                   Startet <kommando> mit <pfad> als
                                                        Arbeitsverzeichnis, ohne Shell; Ausgabe
                                                        und Exitcode des Kommandos gehen durch

Die letzte Zeile der Ausgabe ist immer JSON — ausser bei 'im', das die Ausgabe des
Kommandos durchreicht und nur bei einem eigenen Fehler JSON schreibt.
`,
    keinRepo: "kein git-Repo: {ausgabe}",
    keineHauptkopie: "git worktree list nennt keine Hauptkopie: {ausgabe}",
    exitCode: "Exit-Code {status}",
    signal: "Signal {signal}",
    installRot: "installCommand '{kommando}' endete mit {code} — der Worktree wurde wieder abgebaut",
    entfernenPfad: "entfernen braucht den Pfad des Worktrees",
    rueckwegPfad: "rueckweg braucht den Pfad des Worktrees",
    festhaltenPfad: "vorbereitung-festhalten braucht den Pfad des Worktrees",
    festhaltenErgebnis: "vorbereitung-festhalten braucht --ergebnis <gruen|gruen-offen|rot>",
    imForm: "im braucht <pfad> -- <kommando> [argumente]",
    imKeinVerzeichnis: "im: '{pfad}' ist kein Verzeichnis",
    imStart: "im: '{programm}' liess sich nicht starten ({grund})",
    unbekannt: "unbekanntes Kommando '{kommando}' — bekannt sind anlegen, entfernen, im, nachziehen-pruefen, rueckweg, vorbereitung-festhalten, vorbereitung-pruefen",
  }),
  en: Object.freeze({
    hilfe: `worktree.mjs (claude-workflow-kit v{version}) — worktree for the release skills

  create [--prefix <p>] [--ref <ref>] [--issue <n>]     Worktree on <ref> (default HEAD),
                                                        then the installCommand of the config
  remove <path>                                         Tear down the worktree
  catch-up-check                                        May the local main be rebased?
  return <path>                                         Summary, executions, findings back
  record-preparation <path> --result <gruen|gruen-offen|rot>
      [--open "<text>"]... [--fetch <ok|fehlgeschlagen>]
                                                        Records the nightly preparation:
                                                        reference refs/kit/push-vorbereitet on
                                                        HEAD of the worktree, file
                                                        .claude/push-vorbereitung.json
  check-preparation [--discard]                         May /push-main take over the prepared
                                                        state? No git fetch of its own.
                                                        --discard deletes file and reference
  in <path> -- <command> [arguments]                    Starts <command> with <path> as
                                                        working directory, without a shell; output
                                                        and exit code of the command pass through

The last line of the output is always JSON — except for 'in', which passes the output of
the command through and writes JSON only on an error of its own.
`,
    keinRepo: "not a git repo: {ausgabe}",
    keineHauptkopie: "git worktree list names no main copy: {ausgabe}",
    exitCode: "exit code {status}",
    signal: "signal {signal}",
    installRot: "installCommand '{kommando}' ended with {code} — the worktree was torn down again",
    entfernenPfad: "remove needs the path of the worktree",
    rueckwegPfad: "return needs the path of the worktree",
    festhaltenPfad: "record-preparation needs the path of the worktree",
    festhaltenErgebnis: "record-preparation needs --result <gruen|gruen-offen|rot>",
    imForm: "in needs <path> -- <command> [arguments]",
    imKeinVerzeichnis: "in: '{pfad}' is not a directory",
    imStart: "in: '{programm}' could not be started ({grund})",
    unbekannt: "unknown command '{kommando}' — known are create, remove, in, catch-up-check, return, record-preparation, check-preparation",
  }),
});
