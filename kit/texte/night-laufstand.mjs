/**
 * texte/night-laufstand.mjs — die Texttabelle von night/laufstand.mjs (Issue #1525). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// --- Texte an den Menschen (Issue #1486, Plan #1420 E13/E14) ---

// Die Kopfzeilen des Laufstands (`Lauf-ID:`, `Stand:`, `Position:`, `Protokoll:`) nimmt der
// Teil aus dem Register `MARKER` in kit/board/namen.mjs, nicht aus dieser Tabelle: Dort steht,
// was kanban-kit und die Leser im Kit unter beiden Namen erkennen.
// Vertrag bleibt (E14): die Zeilenarten und Zustaende des Journals (`lauf`, `stand`,
// `quittung`; `laeuft`, `abgebrochen`, `wartet`, `abgegeben`), die Felder des Pulses und die
// Werte des Laufberichts (`abschluss`, `ausgang` `verstummt`).
export const TEXTE = Object.freeze({
  de: Object.freeze({
    standZahl: "night.stand.{feld} muss eine Zahl groesser 0 sein, ist {wert}.",
    standPause: "night.stand.pauseMin ({pause}) muss kleiner sein als night.stand.fristMin ({frist}) — sonst gaelte ein "
      + "lebender Lauf in der Pause vor seinem zweiten Versuch als verstummt.",
    abhaengigkeitUnbekannt: "laufstandAbhaengigkeiten kennt keine Abhaengigkeit '{name}'",
    journalFehler: "Journal {pfad} nicht geschrieben: {fehler}",
    positionWert: "{k} von {n}",
    standFehler: "Laufstand #{karte} {zustand} nicht geschrieben ({antwort}) — bleibt offen im Journal und wird nachgetragen.",
    nachgetragen: "Laufstand nachgetragen: #{karte} {zustand} (Journal .claude/lauf/{lauf}.jsonl).",
    pulsFehler: "Puls {pfad} nicht geschrieben: {fehler}",
    laufBegonnen: "begonnen",
    abgebrochen: "abgebrochen, {grund}",
    laufAbgebrochen: "Lauf {text}.",
    abgebrochenUm: "{text} (um {zeit})",
    umgebungsfehler: "Umgebungsfehler: {grund} — 2. Versuch nach {sekunden} s Pause.",
    zweiterVersuch: "2. Versuch: {grund}",
    versuchVermerk: "2. Versuch nach Umgebungsfehler um {zeit}: {grund}",
    laufHaeltAn: "Lauf haelt an: {grund}",
    abgebrochenUmgebung: "abgebrochen, Umgebungsfehler um {zeit}: {grund}",
    naechsteUnbestimmt: "  Die naechsten Karten liessen sich nicht bestimmen ({fehler}) — am Board gilt ihr zuletzt sichtbarer Stand.",
    nichtBegonnenLog: "  #{id} nicht begonnen.",
    nichtBegonnen: "nicht begonnen: der Lauf hielt um {zeit} an — {grund}",
    laufAngehalten: "Lauf angehalten: {grund}",
    lebenszeichenUnbekannt: "unbekannt",
    verstummtText: "nicht beendet, letztes Lebenszeichen {zeit}, Frist {frist}",
    verstummtLog: "Lauf {lauf} verstummt: {text}.",
    verstummtJournal: "verstummt, {text}",
    laufberichtFehler: "Laufbericht {lauf} nicht geschrieben: {fehler}",
    waechterFehler: "Waechter nicht gestartet: {fehler}",
    waechterGestartet: "Waechter gestartet",
  }),
  en: Object.freeze({
    standZahl: "night.stand.{feld} must be a number greater than 0, is {wert}.",
    standPause: "night.stand.pauseMin ({pause}) must be smaller than night.stand.fristMin ({frist}) — otherwise a "
      + "living run would count as silent during the pause before its second attempt.",
    abhaengigkeitUnbekannt: "laufstandAbhaengigkeiten knows no dependency '{name}'",
    journalFehler: "Journal {pfad} not written: {fehler}",
    positionWert: "{k} of {n}",
    standFehler: "Run status #{karte} {zustand} not written ({antwort}) — stays open in the journal and will be added later.",
    nachgetragen: "Run status added later: #{karte} {zustand} (journal .claude/lauf/{lauf}.jsonl).",
    pulsFehler: "Pulse {pfad} not written: {fehler}",
    laufBegonnen: "started",
    abgebrochen: "aborted, {grund}",
    laufAbgebrochen: "Run {text}.",
    abgebrochenUm: "{text} (at {zeit})",
    umgebungsfehler: "Environment error: {grund} — 2nd attempt after a {sekunden} s pause.",
    zweiterVersuch: "2nd attempt: {grund}",
    versuchVermerk: "2nd attempt after environment error at {zeit}: {grund}",
    laufHaeltAn: "Run stopping: {grund}",
    abgebrochenUmgebung: "aborted, environment error at {zeit}: {grund}",
    naechsteUnbestimmt: "  The next cards could not be determined ({fehler}) — on the board their last visible status applies.",
    nichtBegonnenLog: "  #{id} not started.",
    nichtBegonnen: "not started: the run stopped at {zeit} — {grund}",
    laufAngehalten: "Run stopped: {grund}",
    lebenszeichenUnbekannt: "unknown",
    verstummtText: "not finished, last sign of life {zeit}, limit {frist}",
    verstummtLog: "Run {lauf} went silent: {text}.",
    verstummtJournal: "silent, {text}",
    laufberichtFehler: "Run report {lauf} not written: {fehler}",
    waechterFehler: "Watchdog not started: {fehler}",
    waechterGestartet: "Watchdog started",
  }),
});
