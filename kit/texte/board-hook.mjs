/**
 * texte/board-hook.mjs — die Texttabelle von board/hook.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1481, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen des Hooks je Sprache. Vertragswerte bleiben ausserhalb (E14): Exitcodes,
 * die Feldnamen `abweisen` und `grund`, die Befehlsnamen `bash-check` und `write-check` und der
 * Anker `## Geschuetzte Datei`, den das Kit in jeder Sprache so liest.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    pipeAbgewiesen: "Abgewiesen: \"{muster}\" steht in sandbox.excludedCommands, aber eine Pipe, eine Umleitung "
      + "oder ein weiterer Befehl in derselben Zeile hebt diese Ausnahme auf (seit Claude Code 2.1.277) — "
      + "der Aufruf liefe in der Sandbox, ohne Netz. Richtige Form: das Kommando allein aufrufen, ohne Pipe, "
      + "Umleitung und Folgebefehl (2>&1 ist erlaubt). Eine grosse Ausgabe legt Claude Code selbst in einer "
      + "Datei ab; die filtert ein zweiter Aufruf.",
    hintergrundAbgewiesen: "Abgewiesen: run_in_background ist ohne Aufsicht gesperrt (KIT_AGENT_MODEL gesetzt). Eine "
      + "unbeaufsichtigte Session hat keinen Folge-Zug — beendet sie ihren Zug, waehrend der Befehl "
      + "noch laeuft, ist die Sitzung zu Ende und sein Ergebnis verloren. Richtige Form: denselben "
      + "Befehl im Vordergrund aufrufen und auf ihn warten; das Bash-Zeitlimit der Session reicht "
      + "bis knapp unter das Rundenlimit (Issue #668).",
    durchgelassen: "board.mjs hook bash-check: {warum} — Aufruf durchgelassen",
    eingabeUnlesbar: "Eingabe nicht lesbar ({grund})",
    dateiUnlesbar: "{pfad} nicht lesbar ({grund})",
    hookUnbekannt: "Unbekannter hook-Befehl: '{befehl}'",
    schreibenAbgewiesen: "Abgewiesen: {werkzeug} auf {pfad} — der Pfad trifft die Schreibsperre \"{sperre}\" aus "
      + "permissions.deny. Diese Datei schreibt nur ein Mensch; der Schutz wird nicht umgangen, auch nicht ueber "
      + "die Shell. Das Paket haelt an, wie es die implement-Skills beschreiben: eigene Aenderungen namentlich "
      + "zuruecknehmen, die Karte nach Backlog, das Label kit:protected, dann den Kommentar aus "
      + "`node .claude/kit/board.mjs issue check-protected <id> --path {pfad}` (Anker ## Geschuetzte Datei) ans Issue.",
    schreibenDurchgelassen: "board.mjs hook write-check: {warum} — Aufruf durchgelassen",
  }),
  en: Object.freeze({
    pipeAbgewiesen: "Rejected: \"{muster}\" is listed in sandbox.excludedCommands, but a pipe, a redirection "
      + "or another command on the same line lifts this exception (since Claude Code 2.1.277) — "
      + "the call would run inside the sandbox, without network. Correct form: call the command alone, without pipe, "
      + "redirection and follow-up command (2>&1 is allowed). Claude Code stores a large output in a file "
      + "itself; a second call filters it.",
    hintergrundAbgewiesen: "Rejected: run_in_background is blocked without supervision (KIT_AGENT_MODEL set). An "
      + "unsupervised session has no follow-up turn — if it ends its turn while the command is "
      + "still running, the session is over and its result is lost. Correct form: call the same "
      + "command in the foreground and wait for it; the session's Bash time limit reaches "
      + "just below the round limit (Issue #668).",
    durchgelassen: "board.mjs hook bash-check: {warum} — call let through",
    eingabeUnlesbar: "input not readable ({grund})",
    dateiUnlesbar: "{pfad} not readable ({grund})",
    hookUnbekannt: "Unknown hook command: '{befehl}'",
    schreibenAbgewiesen: "Rejected: {werkzeug} on {pfad} — the path matches the write lock \"{sperre}\" from "
      + "permissions.deny. Only a human writes this file; the protection is not bypassed, not via the shell "
      + "either. The package stops as the implement skills describe: revert your own changes by name, move the "
      + "card to Backlog, add the label kit:protected, then post the comment from "
      + "`node .claude/kit/board.mjs issue check-protected <id> --path {pfad}` (anchor ## Geschuetzte Datei) to the issue.",
    schreibenDurchgelassen: "board.mjs hook write-check: {warum} — call let through",
  }),
});
