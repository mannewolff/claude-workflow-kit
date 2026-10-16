#!/usr/bin/env node
/**
 * claude-workflow-kit Nacht-Runner (Issue #131)
 *
 * Arbeitet die Ready-Spalte unbeaufsichtigt ab: pro Issue eine FRISCHE
 * Headless-Session (`claude -p "/implement-next #N"`), sequenziell, bis Ready
 * leer oder --max erreicht ist. Das Board ist einziges Koordinations- und
 * Erfolgssignal (Issue in In review = Erfolg). Der Runner pusht nie.
 *
 * Die Issue-Wahl liegt ausschliesslich hier (Issue #191): Label-Filter,
 * Abhaengigkeits-Pruefung und Board-Reihenfolge entscheiden, welches Issue dran
 * ist, und die Session bekommt es als Argument verbindlich uebergeben. Solange
 * der Skill selbst "das oberste Ready-Issue" waehlte, gab es zwei Wahrheiten
 * ueber das Dran-Sein: eine Session konnte am Label-Filter vorbei ein fremdes
 * Issue implementieren, waehrend das beauftragte faelschlich als Fehlschlag ins
 * Backlog wanderte (live beobachtet in kanban-kit, 2026-07-29).
 *
 * Aufruf im Projekt-Root:  node .claude/kit/night.mjs [Flags]
 *
 * Flags:
 *   --chain            Nacht-Kette (Plan #638): je [Fachlich]-Issue mit dem Label aus
 *                      night.kette.label eine Kette aus /techplan, Formpruefung,
 *                      /issue-review — im eigenen Worktree, mit Zeit- und Kostenbudget.
 *                      --max zaehlt hier Ketten (Default 3). Laeuft neben einer
 *                      Umsetzungsnacht; ein Issue in In progress haelt sie nicht auf.
 *                      Ausnahme unter Variante B: Deren Umsetzungsstufe baut in der
 *                      Hauptkopie und nimmt dafuer denselben Lock wie die
 *                      Umsetzungsnacht (.claude/night-umsetzung.lock, Issue #696) —
 *                      wer ihn gehalten vorfindet, laesst die Umsetzung aus.
 *   --max <N>          maximale Session-Starts pro Lauf (Default 10)
 *   --model <id>       Modell der Nacht-Sessions (sonst night.modell, sonst claude-opus-5)
 *   --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
 *   --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
 *   --yolo             --dangerously-skip-permissions statt auto mode (Warnung!)
 *   --no-checks-ok     Start ohne Pruefung der Paketstufe erlauben
 *   --label <name>     verarbeitet nur Ready-Issues mit diesem Label (Default
 *                      kit:nightrun); --label none schaltet den Filter ab (altes
 *                      Verhalten: striktes ready[0])
 *   --verbose [no|yes] Live-Verlaufsprotokoll: liest den stream-json-Output der
 *                      Session und loggt Tool-Aufrufe und Text-Snippets mit. Das
 *                      ist der Normalfall und braucht kein Flag; --verbose no
 *                      schaltet es ab, --verbose allein ist der Vorgabewert und
 *                      damit wirkungslos
 *   --version          Kit-Stand dieser Datei (greift vor allen Checks)
 *   --help, -h         Usage-Uebersicht (greift vor allen Checks, keine Config noetig)
 *
 * Verhalten bei Fehlschlag einer Runde (Issue nicht in In review):
 *   - Session-Exit != 0 (kein Timeout) -> Infrastruktur-Fehler (Auth, CLI kaputt):
 *     harter Stopp, Issue bleibt unangetastet (kein Kommentar, kein Backlog-Move)
 *   - Working Tree dirty  -> Salvage-Versuch (siehe unten); kommt er nicht zustande
 *     oder endet ohne Commit, liegen die Reste im Stash `nachtrest #<id> <lauf>`, das
 *     Issue geht mit Vermerk ins Backlog, Laufstand `abgebrochen`, und der Lauf geht
 *     weiter (Issue #1089). Harter Stopp nur, wenn der Stash scheitert oder ein Commit
 *     der Rettung unvollstaendig sein kann
 *   - Working Tree sauber -> Issue mit Kommentar zurueck ins Backlog, weiter
 *   - Bremse (Issue #1388-#1390): Faehrt die Session dieselbe Pruefung zu oft gleich
 *     rot, beendet der Runner sie vor der Zeitgrenze. Ausgang `festgefahren`: kein
 *     Salvage, Reste wie oben im Stash, Vermerk mit Pruefung und Fehler, Backlog, weiter
 *
 * Salvage (Issue #167): Eine Session, die einen langen Check im Hintergrund
 * startet und ihren Turn beendet, bevor das Ergebnis da ist, verliert es — eine
 * headless -p-Session hat keinen Folge-Turn. Das Board zeigt dann einen
 * Fehlschlag, obwohl die Arbeit fertig ist. Vor dem harten Stopp verifiziert der
 * Runner deshalb die Pflicht-Pruefungen selbst — mit `checks.mjs run --finish <id>
 * --fresh` im Zielprojekt (Issue #919), damit der Nachweis entsteht, den das
 * Commit-Gate liest. Sind sie gruen,
 * bekommt genau eine Salvage-Session pro Issue die Chance, den Zwischenstand
 * gegen das Issue zu pruefen, zu committen und erst bei sauberem Arbeitsbaum das
 * Board zu bewegen. Rote Checks -> kein Salvage, die Reste gehen in den Stash.
 * Endet die Session nicht mit sauberem Baum UND der Karte in In review, unterscheidet
 * der Runner drei Endzustaende (Issue #672): kein Commit und kein Board-Zug (Stash wie
 * oben, Issue #1089), Commit ohne Board-Zug (unvollstaendig) und In review bei
 * unsauberem Baum (widerspruechlich) — die beiden letzten stoppen hart. Immer an; ein
 * Opt-out-Flag waere in der Praxis wirkungslos, weil man es nachts vergisst.
 * Die Vorpruefung mergt den env-Block aus .claude/settings.json und
 * .claude/settings.local.json (local gewinnt, wie in Claude Code) in die eigene
 * Kindprozess-Umgebung (settingsEnv/runBuildChecksSync) — sonst fehlen
 * projektspezifische Variablen, die sonst nur Claude Codes eigene Bash-Aufrufe
 * bekommen, und die Vorpruefung liefert ein falsches Rot (kanban-kit #445, #168).
 * Sind die Checks rot und ist config.formatFixCommand gesetzt, laeuft das Kommando
 * genau einmal und die Checks werden genau einmal wiederholt (Issue #169): ein
 * reiner Formatverstoss ist mechanisch behebbar und darf keinen Lauf beenden, in
 * dem noch zwanzig Issues warten. Bleiben sie rot, war das Format nicht die Ursache.
 * Timeout (--timeout-min) zaehlt als issue-spezifisch, nicht als Infrastruktur.
 * Verhalten bei Erfolg einer Runde (Issue in In review):
 *   - Working Tree sauber -> weiter mit der naechsten Runde
 *   - Working Tree dirty   -> harter Stopp (unkommittete Reste wuerden die naechste
 *     Runde vergiften, siehe Issue #152)
 * Abhaengigkeiten: `## Abhaengigkeiten` muss erfuellt sein (referenzierte #N nicht in
 * Backlog, Ready oder In progress), sonst wandert das Issue kommentiert ins Backlog (Kaskade).
 * Nicht implementierbare Issues werden vor dem Session-Start am Titel erkannt und
 * kommentiert ins Backlog gestellt: `[Fachlich]` (PO-Story, wird gegroomt, #146),
 * `[Idee]` (rohe Anforderung, noch kein Arbeitspaket, #192) und `[Plan]` (Plandokument, muss erst
 * per /issues in Arbeitspakete zerlegt werden, #276).
 *
 * Seit Stufe 2 des Prozess-Umbaus (Plan #638) kennt diese Datei zwei Betriebsarten: die
 * Implementierung (ohne Flag) und die Nacht-Kette (--chain). Die Flags --review,
 * --erzeuge, --stufe, --review-label und --erzeuge-label bleiben dem Parser bekannt und
 * enden mit einer Meldung, die das sagt — ein "unbekanntes Argument" liesse den
 * Menschen raten, ob er sich vertippt hat.
 *
 * Nacht-Kette (--chain, Plan #638, Issue #643): Ein [Fachlich]-Issue mit dem Label aus
 * night.kette.label ist der Auftrag; der Start entfernt das Label (jedes Setzen
 * autorisiert genau eine Kette). Je Kette ein eigener Worktree unter dem
 * Temp-Verzeichnis, darin nacheinander /techplan #F (Stufe plan), issue check-form mit
 * hoechstens night.kette.korrekturrunden Korrektursessions, /issue-review #M (Stufe
 * review), /issues #M (Stufe pakete, Formpruefung je Paket) und eine lesende
 * Abdeckungs-Session, die die Pakete gegen den Fachplan haelt (Stufe abdeckung, ihr Text
 * steht im Ergebnisstand). Aeltere Plandokumente zum selben Fachplan bekommen den
 * Kommentar "Ueberholt durch Plan #M". Testhinweise der Formpruefung (eigene Tests
 * gefuehrter Bausteine, die der Plan nicht nennt) halten nichts an; was davon nach der
 * Planungssitzung stehen bleibt, schreibt der Runner als Kommentar "## Testhinweise der
 * Formpruefung" an den Plan (Issue #1033). Jede Stufe endet fertig, angehalten (genau eine Stopp-Frage: Kommentar
 * "## Kette angehalten" und kit:klaeren am Fachplan; eine offene Frage im Plan haelt erst nach
 * der Stufe review an, vor dem Schnitt in Pakete, Plan #1697) oder abgebrochen (Zeitbudget der
 * Stufe, Kostenbudget der Kette, technischer Fehler, kein Plan entstanden). Kandidaten
 * ausserhalb von Backlog oder mit kit:klaeren werden uebersprungen, ihr Label bleibt.
 * Ebenso ein Fachplan, der im Ziel die Zeile "Wartet auf Ereignis:" traegt, und ein Plan,
 * dessen Fachplan sie traegt; der Grund nennt den Wartegrund und `issue hold <N> --lift`
 * (Plan #1624, Issue #1663). Der Ergebnisstand traegt die Art "kette".
 *
 * Test-Hooks (nur fuer Tests gedacht):
 *   NIGHT_CLAUDE_CMD  ersetzt den claude-Aufruf durch ein Shell-Kommando
 *                     (erhaelt NIGHT_ISSUE_ID als Umgebungsvariable).
 *   NIGHT_VORFLUG_CMD ersetzt den Start der VORFLUG-Session durch ein
 *                     Shell-Kommando — getrennt von NIGHT_CLAUDE_CMD, damit ein
 *                     Test die beiden Session-Arten auseinanderhalten kann
 *                     (Issue #269).
 *   NIGHT_VORFLUG_TIMEOUT_MS ueberschreibt das Zeitlimit der Vorflug-Session.
 *   NIGHT_PROMPT      wird jeder Session als Umgebungsvariable gesetzt und
 *                     enthaelt genau den Prompt, mit dem sie gestartet wurde.
 *                     Nur so ist der uebergebene Auftrag (/implement-next #N)
 *                     auch dann pruefbar, wenn NIGHT_CLAUDE_CMD den echten
 *                     claude-Aufruf ersetzt (Issue #191).
 *   NIGHT_TIMEOUT_MS  ueberschreibt das Rundenzeitlimit in Millisekunden
 *                     (statt --timeout-min), damit der Timeout-Pfad schnell
 *                     testbar ist. Gilt auch fuer die Salvage-Session.
 *   NIGHT_TIMEOUT_STUFE beschraenkt NIGHT_TIMEOUT_MS auf die Sessions dieser
 *                     Stufe (plan, review, pakete, abdeckung, umsetzung); alle
 *                     anderen behalten ihr regulaeres Limit (Issue #1080).
 *   NIGHT_SALVAGE     wird der Salvage-Session als Umgebungsvariable gesetzt
 *                     (Wert "1"), damit ein Fake-Hook die beiden Session-Arten
 *                     unterscheiden kann.
 *   NIGHT_NACHBAR_DIR Verzeichnis, aus dem night.mjs board.mjs, board/ und checks.mjs
 *                     laedt (statt neben der eigenen Datei). Nur fuer Tests.
 *   NIGHT_AUSWERTUNG_TIMEOUT_MS ueberschreibt das Zeitlimit der beiden
 *                     Auswertungen (Aufwand, Wirksamkeit), damit der
 *                     Timeout-Pfad schnell testbar ist.
 *   NIGHT_PULS_MS     ueberschreibt den Takt der Puls-Datei (Vorgabe eine Minute),
 *                     damit ein Test ihre Erneuerung sehen kann (Issue #1084).
 *   NIGHT_BESTAETIGUNG_MS ueberschreibt die Bestaetigungsfrist des Beanspruchens
 *                     (Vorgabe zehn Sekunden), damit nicht jeder Kettentest sie
 *                     abwartet (Issue #1188).
 *   KIT_NIGHT_WAECHTER=0 unterdrueckt den Start des Waechters (Issue #1085).
 *   KIT_NIGHT_WAECHTER_FRIST_S setzt die Frist des Waechters in Sekunden statt
 *                     night.stand.fristMin (Issue #1085).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "5.2.3";

// ============================================================
// Texte an den Menschen (Issue #1484, Plan #1420 E13/E14)
// ============================================================
//
// Die Zeilen, die kanban-kit aus dem Textprotokoll liest (Laufstart, Laufende, Dry-Run,
// WARNUNG, Vorflug, Morgen-Ritual), nehmen englisch genau die Form der Vorlage am Plan #1420.
// Vertrag bleibt (E14): die Fehlerklassen von fail(), die Werte des Ergebnisstands und die
// Feldnamen (`ok`, `fehler`), der Ausgang `harterStopp`.
//
// Die Hilfe gibt es einmal, englisch, in jedem Projekt (Issue #1565, Plan #1548 E7); die
// uebrigen Meldungen stehen zweisprachig in TEXTE.
//
// SYNC: Die Vorgaben fuer --model und --label stehen als DEFAULT_MODEL und DEFAULT_LABEL in
// kit/night/grundlagen.mjs. Der Text steht hier, weil --help antwortet, bevor ein Teil
// geladen ist; test/night-grundlagen-argumente.test.mjs haelt beide Stellen gleich.
const HILFE = `Night runner: works through the Ready column unattended —
one fresh headless session per issue (/implement-next #N), one after another.
Success is measured on the board (issue in In review). It never pushes.

Usage (in the project root):
  node .claude/kit/night.mjs [flags]

Flags:
  --chain            Night chain instead of implementation: for each
                     [Requirement] issue with the label from night.kette.label (default
                     kit:night) a chain of /techplan, form check, /issue-review, /issues
                     and coverage in its own worktree, with a night report on the
                     requirement. A second label
                     from night.kette.varianteBLabel (default kit:carry-through) selects
                     variant B instead of variant A; without that label variant A runs.
                     A goal label decides where the chain ends: goal:plan, goal:packages,
                     goal:implementation or goal:push-prepared. planreview:1 or
                     planreview:2 on the requirement sets how many models review the
                     plan. With goal:push-prepared the stage preparation follows once after
                     all chains: prepare /push-main, without a push, result in
                     .claude/push-vorbereitung.json and as a night report.
                     --max counts chains (default 3); --label does not apply here, the
                     label comes from the config. Budgets in night.kette.
  --check            Check run by day instead of implementation: for each
                     [Requirement] issue with the label from pruefLauf.label (default
                     kit:check) one /issue-review session in a worktree per run, one
                     after another. The run
                     moves no card and sets no label beyond what the review itself
                     leaves behind; it is limited by its budgets in pruefLauf, not by a
                     number — --max is allowed but not needed. --label does not apply
                     here, the label comes from the config. It has no preview:
                     /issue-review --dry-run shows documents and reviewers.
  --max <N>          maximum session starts per run (default 10)
  --model <id>       model of the night sessions (otherwise night.modell, otherwise claude-opus-5)
  --timeout-min <N>  time limit per round in minutes (default 60)
  --dry-run          shows order + dependency assessment, starts nothing
  --yolo             --dangerously-skip-permissions instead of auto mode (warning!)
  --no-checks-ok     allow a start without checks at package level
  --label <name>     process only Ready issues with this label
                     (default kit:nightrun); --label none switches the
                     filter off (old behaviour: strictly the first Ready issue)
  --verbose [no|yes] live log: tool calls and text snippets of the running
                     session are logged (via stream-json). On without a
                     flag; --verbose no switches it off, --verbose yes
                     switches it on explicitly, --verbose without a value
                     is the default and therefore has no effect
  --version          kit version of this file
  --help, -h         this overview

Salvage (always on): If a round ends without a board result but with changes in the
working tree, the runner verifies on its own — with "checks.mjs run --finish <id>
--fresh", the same run whose evidence the commit gate reads. If they are green, exactly
one salvage session per issue gets the chance to check the intermediate state against
the issue, to commit, and only with an empty "git status --porcelain" to move it to
In review (time limit 10 min). The command for this is in the session's prompt and
leaves out the same runtime files the leftover guard does not count as leftovers
— otherwise the session would judge more strictly than the runner. Red checks lead to a
hard stop, and so does every salvage that does not end with a clean tree and the card in
In review — the log then names one of three end states: "SALVAGE ATTEMPT failed"
(no commit, board not moved), "SALVAGE INCOMPLETE" (commit, board not moved) or
"SALVAGE CONTRADICTORY" (In review, but work was left behind).

If "formatFixCommand" is set in the config (e.g. "mvn spotless:apply" or
"npx prettier --write ."), it runs exactly once on red checks, then the checks are
repeated exactly once: a pure format violation no longer topples a run this way. If
the checks stay red, the format was not the cause -> hard stop.
Without the field nothing changes.

Examples:
  caffeinate -i node .claude/kit/night.mjs
  TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs

Details: chapter "Night operation" in the kit documentation.
`;

export const TEXTE = Object.freeze({
  de: Object.freeze({
    dokumenteFehlt: "board/dokumente.mjs fehlt neben night.mjs — der Nacht-Runner braucht den Board-Adapter.",
    boardFehltPraefix: "board.mjs liegt nicht neben night.mjs ({pfad}) — das Praefix {praefix} ist nicht erkennbar.",
    boardFehltAbhaengigkeiten: "board.mjs liegt nicht neben night.mjs ({pfad}) — die Herkunft der Abhaengigkeiten ist nicht lesbar.",
    boardFehltErkennung: "board.mjs liegt nicht neben night.mjs ({pfad}) — die Erkennung geschuetzter Dateien ist nicht verfuegbar.",
    boardFehltKommentar: "board.mjs liegt nicht neben night.mjs ({pfad}) — der Halt-Kommentar fuer geschuetzte Dateien ist nicht verfuegbar.",
    boardFehltFreigabe: "board.mjs liegt nicht neben night.mjs ({pfad}) — die Freigabe geschuetzter Dateien ist nicht verfuegbar.",
    checksFehlt: "checks.mjs liegt nicht neben night.mjs ({pfad}) — der Ort der Pruef-Zusammenfassung ist unbekannt.",
    nachbarFehlt: "{datei} liegt nicht neben night.mjs ({pfad})",
    auswertungAufwand: "Aufwands-Auswertung",
    auswertungWirksamkeit: "Wirksamkeits-Auswertung",
    auswertungBefunde: "Befunde-Auswertung",
    auswertungDateiFehlt: "{pfad} liegt nicht vor",
    auswertungZeitlimit: "Zeitlimit von {ms} ms ueberschritten",
    auswertungStart: "{pfad} liess sich nicht starten: {fehler}",
    auswertungExit: "Exit {status}: {zeile}",
    auswertungUnlesbar: "Ausgabe nicht lesbar: {fehler}",
    auswertungFehlgeschlagen: "{bezeichnung} fehlgeschlagen: {fehler} — der Lauf endet unveraendert.",
    ergebnisstandNichtReserviert: "Ergebnisstand konnte nicht reserviert werden: {fehler}",
    modusImplementierung: "Implementierung",
    modusKette: "Kette",
    modusPruefung: "Pruefung",
    versionUnbekannt: "unbekannt (Kopie ohne Versionsstempel)",
    versionsDrift: "WARNUNG: Versions-Drift in .claude/kit/ — night.mjs ist v{version}, board.mjs ist {andere}. "
      + "Die Installation ist halb aufgefrischt; bitte per install.mjs erneuern. Der Lauf geht weiter.",
    warnung: "WARNUNG: {meldung}",
    settingsUngueltig: "settings-Datei ungueltig — keine ihrer Einstellungen (env, sandbox, permissions) waere in den Nacht-Sessions wirksam: {befunde}",
    stufeNichtStartbar: "WARNUNG: Stufe {stufe} nicht startbar: {grund}",
    inProgress: "Issue(s) in In progress ({ids}) — Crash-Rest? Bitte manuell aufraeumen, dann neu starten.",
    baumUnsauber: "Working Tree ist nicht sauber. Bitte committen oder aufraeumen, dann neu starten.",
    boardFehlt: "board.mjs nicht gefunden unter {pfad}",
    configFehlt: "Keine .claude/workflow.config.json — bitte im Projekt-Root starten.",
    maxOhneDeckel: "max ohne Deckel",
    maxSessions: "max {max} Sessions",
    start: "Nacht-Runner startet (Modus {modus}, {max}, Modell {modell} ({herkunft}), Label {label}{dryRun}{yolo})",
    yoloWarnung: "WARNUNG: --yolo umgeht ALLE Permission-Checks der Nacht-Sessions. Die Stop-Punkte haengen dann allein am Skill-Prompt.",
    keinGate: "buildChecks in workflow.config.json traegt keine Pruefung, die beim Abschluss eines Arbeitspakets laeuft — damit hat die Umsetzung nachts kein Gate. Gezaehlt wird die Paketstufe ohne 'nichtBeimAbschluss' und ohne 'guete'-Block: Eintraege mit stufe 'push' oder 'merge' laufen erst beim Veroeffentlichen, Eintraege mit 'nichtBeimAbschluss' ebenso, und eine Guetemessung braucht die vollstaendige Testmenge. Override: --no-checks-ok",
    vorflugNichtAuswertbar: "Vorflug-Session nicht auswertbar: {grund}",
    reviewerVerfuegbar: "verfuegbar",
    reviewerNichtVerfuegbar: "NICHT verfuegbar — {grund}",
    reviewerZeile: "Reviewer {name} ({art}) in {umgebung}: {stand}",
    keinReviewerGrund: "issueReview.reviewers ist leer oder fehlt — Block aus .claude/workflow.config.example.jsonc uebernehmen",
    keinReviewer: "Kein Reviewer konfiguriert: {grund}",
    getUebersprungen: " — issue get uebersprungen: {grund}",
    trackerErreichbar: "erreichbar{vermerk}",
    trackerNichtErreichbar: "NICHT erreichbar — {grund}",
    trackerZeile: "Tracker ({umgebung}): {stand}",
    problemSession: "Die Vorflug-Session lieferte kein Ergebnis ({grund})",
    problemKeinReviewer: "Kein Reviewer konfiguriert ({grund}). Ohne Reviewer wuerde jede Session ergebnislos enden",
    problemReviewer: "Reviewer in der Session nicht verfuegbar: {liste}",
    problemTracker: "Tracker aus der Session nicht erreichbar: {grund}",
    probeIssue: "Issue #{id}",
    probeListe: "nur issue list",
    vorflugStart: "Vorflug-Session startet (Modell {modell}, Tracker-Probe {probe}).",
    vorflugVeraendert: "HARTER STOPP: die Vorflug-Session hat den Working Tree veraendert. Sie darf nichts anfassen — bitte morgens sichten.",
    vorflugUnterbesetzt: "{probleme} — ein unterbesetzter Lauf sieht am Board aus wie ein vollstaendiger. Mit {hinweis} pruefen, dann das fehlende Werkzeug installieren, die Freigaben der Sessions weiten oder den Reviewer aus issueReview.reviewers nehmen.",
    dryModellKarte: ", Modell {modell} (Karte)",
    dryModellLauf: ", Modell {modell} (Lauf){nachsatz}",
    dryStufe: "Stufe {stufe}",
    dryStufeNichtBelegt: "Stufe {stufe} nicht belegt",
    dryGruendlichkeit: ", Gruendlichkeit {effort}",
    dryStufenVermerk: ", {stufe}, Modell {modell} (Stufe {verwendet}){effort}",
    artFachlich: "fachliches Issue",
    artIdee: "Idee",
    artPlan: "Plan-Dokument",
    artMensch: "Menschenschritt",
    dryGeschuetzt: "wuerde ins Backlog (geschuetzte Datei {pfade})",
    dryOhneLabel: "uebersprungen (kein Label '{label}')",
    dryPraefix: "wuerde ins Backlog ({art}, wird nicht implementiert)",
    dryKlaeren: "wuerde ins Backlog ({label}, offene Entscheidung)",
    dryGeschuetztLabel: "wuerde ins Backlog ({label}, menschliche Handlung wartet)",
    dryGate: "wuerde ins Backlog ({grund})",
    dryAbhaengigkeit: "wuerde ins Backlog (Abhaengigkeit {ids} nicht erfuellt)",
    dryKeineStufe: "wuerde nicht starten (keine startbare Stufe fuer Aufgabenstufe {stufe}: {grund})",
    dryUeberMax: "ueber --max {max}, bliebe liegen",
    drySession: "Session {nr}{vermerk}",
    dryEnde: "Dry-Run beendet: {anzahl} Session(s) wuerden starten.",
    endeAbgebrochen: ", {anzahl} abgebrochen mit Resten im Stash",
    endeFestgefahren: ", {anzahl} festgefahren",
    endeHarterStopp: ", HARTER STOPP",
    ende: "Nacht-Runner beendet: {erfolgreich} erfolgreich, {zurueckgestellt} zurueckgestellt, {ohneNachweis} ohne gueltigen Nachweis, {sessions} Session(s) gestartet, {angehalten} angehalten{abgebrochen}{festgefahren}{harterStopp}.",
    morgenRitual: "Morgen-Ritual: /kit-review -> Test -> push main. Protokoll: {pfad}",
  }),
  en: Object.freeze({
    dokumenteFehlt: "board/dokumente.mjs is missing next to night.mjs — the night runner needs the board adapter.",
    boardFehltPraefix: "board.mjs is not next to night.mjs ({pfad}) — the prefix {praefix} cannot be recognised.",
    boardFehltAbhaengigkeiten: "board.mjs is not next to night.mjs ({pfad}) — the origin of the dependencies cannot be read.",
    boardFehltErkennung: "board.mjs is not next to night.mjs ({pfad}) — the detection of protected files is not available.",
    boardFehltKommentar: "board.mjs is not next to night.mjs ({pfad}) — the halt comment for protected files is not available.",
    boardFehltFreigabe: "board.mjs is not next to night.mjs ({pfad}) — the release of protected files is not available.",
    checksFehlt: "checks.mjs is not next to night.mjs ({pfad}) — the location of the check summary is unknown.",
    nachbarFehlt: "{datei} is not next to night.mjs ({pfad})",
    auswertungAufwand: "Effort evaluation",
    auswertungWirksamkeit: "Effectiveness evaluation",
    auswertungBefunde: "Findings evaluation",
    auswertungDateiFehlt: "{pfad} does not exist",
    auswertungZeitlimit: "time limit of {ms} ms exceeded",
    auswertungStart: "{pfad} could not be started: {fehler}",
    auswertungExit: "exit {status}: {zeile}",
    auswertungUnlesbar: "output not readable: {fehler}",
    auswertungFehlgeschlagen: "{bezeichnung} failed: {fehler} — the run ends unchanged.",
    ergebnisstandNichtReserviert: "Result file could not be reserved: {fehler}",
    modusImplementierung: "implementation",
    modusKette: "chain",
    modusPruefung: "check",
    versionUnbekannt: "unknown (copy without version stamp)",
    versionsDrift: "WARNING: version drift in .claude/kit/ — night.mjs is v{version}, board.mjs is {andere}. "
      + "The installation is half refreshed; please renew it with install.mjs. The run continues.",
    warnung: "WARNING: {meldung}",
    settingsUngueltig: "settings file invalid — none of its settings (env, sandbox, permissions) would take effect in the night sessions: {befunde}",
    stufeNichtStartbar: "WARNING: stage {stufe} cannot be started: {grund}",
    inProgress: "Issue(s) in In progress ({ids}) — crash leftover? Please clean up manually, then restart.",
    baumUnsauber: "Working tree is not clean. Please commit or clean up, then restart.",
    boardFehlt: "board.mjs not found at {pfad}",
    configFehlt: "No .claude/workflow.config.json — please start in the project root.",
    maxOhneDeckel: "max without cap",
    maxSessions: "max {max} sessions",
    start: "Night runner starting (mode {modus}, {max}, model {modell} ({herkunft}), label {label}{dryRun}{yolo})",
    yoloWarnung: "WARNING: --yolo bypasses ALL permission checks of the night sessions. The stop points then depend on the skill prompt alone.",
    keinGate: "buildChecks in workflow.config.json has no check that runs when a work package is completed — so the implementation has no gate at night. Counted is the package level without 'nichtBeimAbschluss' and without a 'guete' block: entries with stufe 'push' or 'merge' run only on publishing, entries with 'nichtBeimAbschluss' as well, and a quality measurement needs the complete test set. Override: --no-checks-ok",
    vorflugNichtAuswertbar: "Preflight session not evaluable: {grund}",
    reviewerVerfuegbar: "available",
    reviewerNichtVerfuegbar: "NOT available — {grund}",
    reviewerZeile: "Reviewer {name} ({art}) in {umgebung}: {stand}",
    keinReviewerGrund: "issueReview.reviewers is empty or missing — take over the block from .claude/workflow.config.example.jsonc",
    keinReviewer: "No reviewer configured: {grund}",
    getUebersprungen: " — issue get skipped: {grund}",
    trackerErreichbar: "reachable{vermerk}",
    trackerNichtErreichbar: "NOT reachable — {grund}",
    trackerZeile: "Tracker ({umgebung}): {stand}",
    problemSession: "The preflight session delivered no result ({grund})",
    problemKeinReviewer: "No reviewer configured ({grund}). Without a reviewer every session would end without a result",
    problemReviewer: "Reviewer not available in the session: {liste}",
    problemTracker: "Tracker not reachable from the session: {grund}",
    probeIssue: "issue #{id}",
    probeListe: "issue list only",
    vorflugStart: "Preflight session starting (model {modell}, tracker probe {probe}).",
    vorflugVeraendert: "HARD STOP: the preflight session changed the working tree. It must not touch anything — please review in the morning.",
    vorflugUnterbesetzt: "{probleme} — an understaffed run looks like a complete one on the board. Check with {hinweis}, then install the missing tool, widen the permissions of the sessions or remove the reviewer from issueReview.reviewers.",
    dryModellKarte: ", model {modell} (card)",
    dryModellLauf: ", model {modell} (run){nachsatz}",
    dryStufe: "stage {stufe}",
    dryStufeNichtBelegt: "stage {stufe} not assigned",
    dryGruendlichkeit: ", effort {effort}",
    dryStufenVermerk: ", {stufe}, model {modell} (stage {verwendet}){effort}",
    artFachlich: "requirement",
    artIdee: "idea",
    artPlan: "plan document",
    artMensch: "human step",
    dryGeschuetzt: "would go to Backlog (protected file {pfade})",
    dryOhneLabel: "skipped (no label '{label}')",
    dryPraefix: "would go to Backlog ({art}, not implemented)",
    dryKlaeren: "would go to Backlog ({label}, open decision)",
    dryGeschuetztLabel: "would go to Backlog ({label}, human action pending)",
    dryGate: "would go to Backlog ({grund})",
    dryAbhaengigkeit: "would go to Backlog (dependency {ids} not met)",
    dryKeineStufe: "would not start (no startable stage for task level {stufe}: {grund})",
    dryUeberMax: "over --max {max}, would remain pending",
    drySession: "session {nr}{vermerk}",
    dryEnde: "Dry run finished: {anzahl} session(s) would start.",
    endeAbgebrochen: ", {anzahl} aborted with leftovers in the stash",
    endeFestgefahren: ", {anzahl} stuck",
    endeHarterStopp: ", HARD STOP",
    ende: "Night runner finished: {erfolgreich} succeeded, {zurueckgestellt} deferred, {ohneNachweis} without valid evidence, {sessions} session(s) started, {angehalten} halted{abgebrochen}{festgefahren}{harterStopp}.",
    morgenRitual: "Morning ritual: /kit-review -> test -> push main. Log: {pfad}",
  }),
});

// Der Texthelfer aus dem Register, mit literalem Pfad und abgefangen: --help antwortet auch
// als einzeln kopierte Datei (Issue #170). Fehlt das Register, spricht der Einstieg deutsch
// wie vor Plan #1420 — ohne board/ daneben arbeitet der Runner ohnehin nicht.
const namen = await import("./board/namen.mjs").catch(() => null);

function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Der Name eines Kit-Labels, englisch in jedem Projekt (Issue #1553, Plan #1548 E2); ohne Register ebenso. */
function kitLabel(sache) {
  return namen ? namen.labelName(sache) : { klaeren: "kit:clarify", geschuetzt: "kit:protected" }[sache];
}

// Auskunft vor den Teilen (Plan #1199, E2): --version und --help antworten, bevor ein Teil
// geladen ist. Nur so beantwortet night.mjs sie auch als einzeln kopierte Datei, ohne
// kit/night/ daneben (Issue #170) — und genau dort will man wissen, aus welchem Kit-Stand
// eine gefundene Datei stammt. Es zaehlt das erste Auskunftsflag in argv, gleich an welcher
// Stelle: Sie greifen vor allen Vorflug-Checks, auch in einem Verzeichnis ohne Config.
const runAsCli = alsCliGestartet();
if (runAsCli) auskunftOhneTeile(process.argv.slice(2));

// Die Teile, mit literalem dynamischem Import und nie als `export { … } from`: Das liesse den
// Teil vor der ersten Codezeile laden. Was bisher exportiert war, bleibt unter demselben
// Namen exportiert.
export const { loeseModusDefaults, schrittProtokollPfad, ERSATZ_GRUND, ANKER_FEHLT, OHNE_ARBEIT_UNBEKANNT,
  grundOhneArbeit, sicherheitsnetzGrund, einheitAnlegen, laufStempelReservieren, boardFehlertext, boardUmgebung,
  gitResteAusnahmen, gitRestePathspec, salvageSauberkeitsKommando, UMSETZUNG_LOCK,
  KIT_STAND_MARKIERUNG, vergleicheText } = await import("./night/grundlagen.mjs");
// Was die uebrigen Abschnitte des Einstiegs aus den Grundlagen brauchen; exportiert war es nie
// und bleibt es nicht.
const { ZUSTAND, grundlagenAnbinden, NACHBAR_DIR, NACHBAR_BOARD, NACHBAR_CHECKS, NACHBAR_AUFWAND,
  NACHBAR_WIRKSAMKEIT, NACHBAR_BEFUNDE, BOARD_PATH, AUFWAND_PATH, WIRKSAMKEIT_PATH, BEFUNDE_PATH,
  parseArgs, log, fail, merkeHartenStopp, hefteStoppGrundAnLauf,
  resteText, vermerkeOhneArbeit, laufMelden, ersteZeile, schreibeErgebnisstand,
  BOARD_MAX_BUFFER, board, gitReste, gitClean,
  ladeConfigMitOverrides, laufArt } = await import("./night/grundlagen.mjs");
export const { nightStandLaden, journalLesen, laufendeKarten, standSetzen, abgeben, staendeNachtragen,
  hatSitzungsereignis, verwaisteLaeufeAbschliessen, waechterStartOptionen } = await import("./night/laufstand.mjs");
const { anhaltenLaeuft, nightStandPruefen, pulsSchreiben, laufstandStarten, laufAbbrechen, abbruchHandlerSetzen,
  zweiterVersuch, vermerkAnDieKarte, laufAnhalten, waechterLaufen, waechterStarten,
  waechterBeenden, RECHNER } = await import("./night/laufstand.mjs");
export const { umsetzungLockNehmen, UMSETZUNG_WARTEN_MS, aufUmsetzungWarten, RUNNER_SPERREN, nachziehenPruefen,
  worktreeAnlegen, worktreeEntfernen, befundeZurueck, worktreesAufraeumen, kitStandErmitteln, kitStandBereitstellen,
  kitStandEinsetzen, kitStandFreigeben, istStandKind, kitStandZeile } = await import("./night/kitstand.mjs");
const { KIT_STAND_BAEUME, kitStaendeAufraeumen, kitStandMelden, kitStandFeld,
  kitStandSchritt } = await import("./night/kitstand.mjs");
export const { parseDeps, wartetAufPush, kreiseAb, abhaengigkeitsBefund, abhaengigkeitsBlock,
  abhaengigkeitsZeilen } = await import("./night/abhaengigkeiten.mjs");
const { satisfiedIds } = await import("./night/abhaengigkeiten.mjs");
export const { leseStromereignis, werkzeugZeitBeobachter, UEBERNAHME_MARKE, prueflaufBeobachter, fortschrittBeobachter,
  TOOL_RESULTS_PFAD, auskunftArt, auskunftBeobachter, umsetzungsStart, leseKennzahlen, kennzahlenAddieren, verbrauchLeer,
  verbrauchAddieren, verbrauchOhneEinheit, zeitenBauen, zeitenAddieren, prueflaeufeAddieren, kostenAddieren,
  leseErgebnisText, empfohlenesModell, aufgabenStufe, stufenEinstellung, konfigKommandoStart, stufeStartbar,
  modellFuerStufe, paketWahl, frischeStufenFelder, warteAufProzessgruppe, sessionUmgebung, baumBeendenAufruf,
  permissionArgs, BASH_RESERVE_MS, bashZeitlimit, sessionStart,
  runSession, lesePruefung, gueteAuswerten, fehlermerkmal, salvagePrompt, laufModell, KETTE_BUDGET_DEFAULTS,
  ladeKetteBudget, KETTE_UEBERGAENGE_DEFAULTS, ladeKetteUebergaenge, ketteBudgetDefaults, PRUEFLAUF_BUDGET_DEFAULTS,
  ladePruefLaufBudget, pruefLaufBudgetDefaults, varianteVon, trackerProbeId, vorflugPrompt, parseVorflugBefund,
  normalisiereVorflug, neueKommentare, kennzeichenName } = await import("./night/session.mjs");
const { STUFEN_ORDNUNG, paketstufenChecks, VORFLUG_MODEL,
  reviewerVorflug } = await import("./night/session.mjs");
export const { PLAN_REVIEW_ZEILE, planReviewWert, hatPlanReviewMarker, FACHPLAN_REVIEW_ZEILE, fachplanReviewWert,
  hatFachplanReviewMarker, prueflaufZeilen, BERICHT_ANKER, BERICHT_SCHLUSS, kommentareVon, einarbeitungVon,
  berichtBauen, berichtSchreiben, berichteNachtragen, ketteEinheiten } = await import("./night/bericht.mjs");
const { pruefBericht, zielUmsetzungMin } = await import("./night/bericht.mjs");
export const { REVIEW_MARKER_ZEILE, hasReviewMarker, reviewFreigabe, KLAEREN_LABEL, hatKlaerenLabel,
  GESCHUETZT_LABEL, GESCHUETZT_ANKER, GESCHUETZT_ABGEWIESEN, hatGeschuetztLabel, GESCHUETZT_LABEL_GATE_TEXT,
  HALT_FOLGESATZ, pruefeIssueGates, geschuetztGate, wartendeSession, WARTEND_ANKER, wartendVermerk, ZEITLIMIT_ANKER,
  zeitlimitVermerk, rundenGrund, abgewieseneSchreibpfade, istHalt,
  laufeImplementierung } = await import("./night/wartend.mjs");
const { wartendAnbinden, GATE_ABLEHNUNG, hauptWurzel,
  warnWennLabelNirgendsVorkommt } = await import("./night/wartend.mjs");
export const { wurzelBelegt, REVIEW_FERTIG_LABEL, hatReviewFertigLabel, UNGEPRUEFT_PRAEFIX, pruefungFehltGrund,
  KETTE_UNGEPRUEFT_ANKER, stoppFragenGrund, offeneFragenGrund, HERKUNFT_FELD, stammtAusErzeugung, fachlicheQuelleVon,
  KETTE_ZUSATZ, ABDECKUNG_ZUSATZ, KETTE_HALT_ANKER, UMSETZUNG_AUSGELASSEN_PRAEFIX, ISSUES_HALT_KOPF, ABDECKUNG_PROMPT,
  abdeckungPrompt, planAusschluss, waehleKettenKandidaten, korrekturPrompt, TESTHINWEIS_ANKER, REVIEW_REST_ANKER,
  pushVermerk, umsetzungHaltGrund, UEBERHOLT_UNBESTAETIGT_GRUND, paketUmgesetzt, ergebnisVorhanden,
  BESTAETIGUNGSFRIST_MS, beanspruchtGrund, beanspruchen, laufeKette } = await import("./night/kette.mjs");
const { ketteAnbinden, ketteBudgetSetzen, ketteBudgetStand } = await import("./night/kette.mjs");
export const { pruefLaufAusschluss, waehlePruefLaufKandidaten, pruefLaufFassung, pruefLaufStand,
  PRUEFLAUF_BEFUNDE_ANKER, PRUEFLAUF_EINARBEITUNG_ANKER, pruefLaufErgebnis, PRUEFLAUF_REST_ANKER,
  pruefLaufRestVermerken, laufePrueflauf } = await import("./night/tag.mjs");
const { tagAnbinden, pruefLaufBudgetSetzen, pruefLaufBudgetStand } = await import("./night/tag.mjs");
export const { protokollFrist, protokolleAufraeumen, aufraeumZeilen } = await import("./night/aufraeumen.mjs");

/**
 * Die Fence-Regel wird geteilt, nicht kopiert (Issue #308): board.mjs fuehrt sie als
 * einzige Auslegung fuer Abschnittsgrenzen, Parser und Bezugsstand, und ihr eigener
 * Kommentar warnt vor einer weiteren. Der Import ist nebenwirkungsfrei — die CLI von
 * board.mjs haengt an ihrem runAsCli-Guard.
 *
 * Bewusst DYNAMISCH und abgefangen, nicht statisch. night.mjs traegt seit Issue #170
 * die Zusage, `--version` und `--help` auch als allein kopierte Datei zu beantworten
 * — genau dort will man wissen, aus welchem Kit-Stand eine gefundene Datei stammt.
 * Ein statischer Import scheitert vor der ersten Codezeile und nimmt diese Auskunft
 * mit; der Ersatz unten laesst sie durch und meldet den fehlenden Nachbarn erst,
 * wenn ihn wirklich jemand braucht. Ehrlich ist das, weil night.mjs ohne board.mjs
 * ohnehin nichts tun kann: Jeder Board-Zugriff startet sie als Subprozess.
 *
 * Ueber NACHBAR_DIR und nicht ueber den literalen Spezifizierer "./board/dokumente.mjs":
 * Ein Literal haengt an keiner Pfadkonstante, NIGHT_NACHBAR_DIR erreichte dieses
 * `.catch` also nie — und die Board-Importe dieser Datei zeigten unter Hook auf
 * verschiedene Dateien (Issue #498).
 *
 * Die Fence-Auslegung fuehrt seit Issue #1218 der Board-Teil dokumente (Plan #1199, E17);
 * der Runner holt sie von dort und nicht aus dem Einstieg. Der Pfad ist nicht literal,
 * deshalb nennen die Nacht-Gruppen den Bereich board-dokumente von Hand (E3).
 */
const { fenceLauf } = await import(pathToFileURL(join(NACHBAR_DIR, "board", "dokumente.mjs")).href).catch(() => ({
  fenceLauf: () => {
    throw new Error(t("dokumenteFehlt"));
  },
}));

// Die Praefix-Erkennung kommt seit Issue #464 aus demselben Modul, statt hier ein
// zweites Mal als Regex zu stehen. Ihr Fallback WIRFT wie der obige und liefert
// bewusst kein `false`: Ein stilles `false` liesse ein Plandokument als
// Arbeitspaket durch — der Runner implementierte es, und am Board saehe das wie
// ein Erfolg aus. Genau davor schuetzen die Praefixe.
const praefixFallback = (was) => (_title) => {
  throw new Error(t("boardFehltPraefix", { pfad: NACHBAR_BOARD, praefix: was }));
};
// Die Lesung mit Herkunft (Issue #1062, Plan #1057 E1) wirft ohne Nachbarn aus demselben
// Grund: Ein stiller Ersatz liesse den Befund ohne Herkunft stehen, als gaebe es keine.
const abhaengigkeitenFallback = (_body) => {
  throw new Error(t("boardFehltAbhaengigkeiten", { pfad: NACHBAR_BOARD }));
};
// Die Erkennung geschuetzter Dateien (Issue #1046, Plan #987, E1) wirft ohne Nachbarn wie
// die Praefixe: Ein stilles "keine Treffer" liesse ein Paket mit geschuetzter Datei in eine
// Session — genau der Ausgang, der zweimal eine ganze Nacht gekostet hat.
const geschuetztFallback = (schluessel) => () => {
  throw new Error(t(schluessel, { pfad: NACHBAR_BOARD }));
};
// Warum bedingt und nicht als `import`-Zeile oben: `--version` und `--help` muessen auch
// dann Auskunft geben, wenn NICHTS neben der Datei liegt (Issue #170) — ein statischer
// Import scheitert vor jeder Zeile Code und nimmt genau diese Auskunft. Fehlt der Nachbar,
// bleibt der Stub stehen; arbeitsfaehig ist der Runner ohne board.mjs ohnehin nicht, main()
// bricht dafuer mit eigener Meldung ab.
const {
  istFachlich: isFachlich,
  istPlan: isPlan,
  istIdee: isIdee,
  istMensch: isMensch,
  abhaengigkeitenMitHerkunft,
  geschuetzteTreffer,
  geschuetztKommentar,
  geschuetztFreigabe,
} = existsSync(NACHBAR_BOARD)
  ? await import(pathToFileURL(NACHBAR_BOARD).href)
  : {
      istFachlich: praefixFallback("[Requirement]"),
      istPlan: praefixFallback("[Plan]"),
      istIdee: praefixFallback("[Idea]"),
      istMensch: praefixFallback("[Human]"),
      abhaengigkeitenMitHerkunft: abhaengigkeitenFallback,
      geschuetzteTreffer: geschuetztFallback("boardFehltErkennung"),
      geschuetztKommentar: geschuetztFallback("boardFehltKommentar"),
      geschuetztFreigabe: geschuetztFallback("boardFehltFreigabe"),
    };

// Der Ort der Pruef-Zusammenfassung kommt aus checks.mjs und wird NICHT nachgerechnet
// (Issue #428). Ein zweiter Rechenweg waere genau das, was checks.mjs fuer die Auswahl
// ausdruecklich ausschliesst — und "das Kommando nennt den Ort in seiner Ausgabe" hilft
// dem Runner nicht: Er sieht von einer Session nur Exit-Code, Board und Working Tree,
// nie ihren Text.
//
// Bedingt und abgefangen wie oben beim Board: `--version` und `--help` muessen auch
// dann antworten, wenn nichts neben der Datei liegt (Issue #170). Fehlt der Nachbar,
// bleibt der Stub stehen — er wirft erst, wenn wirklich jemand den Pfad braucht.
//
// NACHBAR_CHECKS steht oben neben NACHBAR_BOARD: Beide Nachbarn kommen aus demselben
// Verzeichnis, und beide folgen NIGHT_NACHBAR_DIR.
const zusammenfassungPfadFallback = (_root) => {
  throw new Error(t("checksFehlt", { pfad: NACHBAR_CHECKS }));
};
const { zusammenfassungPfad } = existsSync(NACHBAR_CHECKS)
  ? await import(pathToFileURL(NACHBAR_CHECKS).href)
  : { zusammenfassungPfad: zusammenfassungPfadFallback };

// Die Form des Befundblocks kommt aus effort.mjs und wird NICHT nachgebaut (Issue #752):
// Es ist die eine Form, die an beiden Ausgabestellen erscheint — im Laufprotokoll hier und
// in `/push-main`. Ein zweiter Textbau waere eine zweite Wahrheit darueber, wie ein Befund
// aussieht, und die beiden liefen bei der ersten Aenderung auseinander.
//
// Bedingt und mit werfendem Ersatz wie die beiden Nachbarn darueber: `--version` und
// `--help` antworten auch ohne Nachbarn (Issue #170). Der Wurf ist hier ungefaehrlich —
// aufwandAuswerten() faengt ihn ab und macht daraus die eine Protokollzeile, die ein
// Fehlschlag der Auswertung sein darf (E15).
const befundTextFallback = () => {
  throw new Error(t("nachbarFehlt", { datei: "effort.mjs", pfad: NACHBAR_AUFWAND }));
};
const { befundText } = existsSync(NACHBAR_AUFWAND)
  ? await import(pathToFileURL(NACHBAR_AUFWAND).href)
  : { befundText: befundTextFallback };

// Dieselbe Trennung fuer die Wirksamkeit (Issue #790): Die Textform kommt aus dem Modul,
// weil sie an beiden Ausgabestellen erscheint — im Laufprotokoll hier und im Kopf von
// `/push-main`. Der Wurf des Ersatzes ist ungefaehrlich, weil wirksamkeitAuswerten() ihn
// abfaengt und daraus die eine Protokollzeile macht, die ein Fehlschlag sein darf (E9).
const wirksamkeitBefundTextFallback = () => {
  throw new Error(t("nachbarFehlt", { datei: "effectiveness.mjs", pfad: NACHBAR_WIRKSAMKEIT }));
};
const { befundText: wirksamkeitBefundText } = existsSync(NACHBAR_WIRKSAMKEIT)
  ? await import(pathToFileURL(NACHBAR_WIRKSAMKEIT).href)
  : { befundText: wirksamkeitBefundTextFallback };

// Und dieselbe Trennung ein drittes Mal fuer die Befunde der Modell-Pruefungen (Issue
// #806): Auch ihr Befundblock erscheint an zwei Stellen — im Laufprotokoll hier und im
// Kopf von `/push-main` —, und auch hier faengt befundeAuswerten() den Wurf des Ersatzes
// ab und macht daraus die eine Protokollzeile, die ein Fehlschlag sein darf.
const befundeBefundTextFallback = () => {
  throw new Error(t("nachbarFehlt", { datei: "findings.mjs", pfad: NACHBAR_BEFUNDE }));
};
const { befundText: befundeBefundText } = existsSync(NACHBAR_BEFUNDE)
  ? await import(pathToFileURL(NACHBAR_BEFUNDE).href)
  : { befundText: befundeBefundTextFallback };

// Nur fuer Tests; der Runner nutzt die Bindungen direkt, nicht ueber dieses Objekt.
// Ohne den Export ist der Identitaetsnachweis nicht fuehrbar — ob im Regelbetrieb die
// echte Funktion oder ihr Ersatz gebunden ist, sieht man von aussen sonst an keinem
// Ergebnis, und zusammenfassungPfad bliebe ganz unerreichbar (Issue #498).
export const nachbarn = {
  fenceLauf,
  istFachlich: isFachlich,
  istPlan: isPlan,
  istIdee: isIdee,
  istMensch: isMensch,
  abhaengigkeitenMitHerkunft,
  geschuetzteTreffer,
  geschuetztKommentar,
  geschuetztFreigabe,
  zusammenfassungPfad,
};

// --- Hauptprogramm ---
//
// In eine Funktion gefasst, damit die reinen Funktionen dieser Datei importierbar
// sind, ohne dass der Runner losläuft (Issue #232). Vorher lag das Hauptprogramm auf
// Top-Level: Ein `import { parseDeps }` haette einen kompletten Nachtlauf
// gestartet. Dieselbe Loesung wie in board.mjs seit Issue #135.
//
// Seit Issue #404 ist es kein einzelner Block mehr. Die Vermessung in #398 hatte den
// Befund geliefert, an dem der Schnitt haengt: main() war nicht eine Funktion, sondern
// DREI einander ausschliessende Programme mit gemeinsamem Vorspann — Review, Dry-Run,
// Implementierung. Der Vorspann heisst jetzt vorbereiten() und liefert den Kontext, die
// drei Programme stehen daneben, und main() dirigiert nur noch.
//
// Zum Hauptprogramm gehoert seit dem Abschluss der Zerlegung (Issue #1234) auch, was vorher
// als Abschnitt "Logging: Laufzustand und Lauf-Abschluss" hier stand: der Lauf-Kopf, die
// drei Auswertungen und der Abschluss des Laufs. Ihr Hauptaufrufer ist vorbereiten() bzw.
// der Vorflug; die Teile wartend, kette und tag rufen den Abschluss ueber ihre Anbindung.
// Der Kern des Logging steht in kit/night/grundlagen.mjs (Issue #1224).

// Die Budgets von Kette und Prueflauf stehen in ihren Teilen kit/night/kette.mjs und
// kit/night/tag.mjs und kommen ueber ketteBudgetStand() bzw. pruefLaufBudgetStand().

// Die Merker der laufenden Runde (Salvage- und Abbruchgrund, wartend, Zeitlimit, Art des
// Halts) stehen seit Issue #1231 im Teil kit/night/wartend.mjs; die Kette liest die Art des
// Halts ueber rundenMerker(). Der Pfad der Config steht als ZUSTAND.CONFIG_PATH in den
// Grundlagen.

/**
 * Ruft die Aufwands-Auswertung und legt ihr Ergebnis am Lauf-Kopf ab (Issue #752).
 *
 * Als KINDPROZESS und nicht als Funktion: Die Auswertung schreibt `.claude/aufwand.md`
 * und `.claude/aufwand.json` fuer das Projekt, in dem der Runner arbeitet — dieselbe
 * Trennung wie beim Board. Die Textform des Befundblocks kommt dagegen aus dem Modul
 * (siehe befundText oben), damit beide Ausgabestellen dieselbe Form zeigen.
 *
 * KEIN GATE (E15): Jeder Fehlschlag — ein Kindprozess mit Exit ungleich 0, eine
 * unlesbare Ausgabe, eine fehlende Datei — ist genau eine Protokollzeile und nie ein
 * `fail()`. Die Auswertung misst den Lauf; sie darf ihn nicht beenden, und ein Lauf, der
 * an seiner eigenen Buchhaltung scheitert, verlöre den Bericht ueber die Arbeit.
 *
 * KRITERIUM 11: Ohne Befund bleibt das Protokoll stumm. `befundText` liefert dann eine
 * leere Zeichenkette, und es wird nichts geschrieben — keine Ueberschrift, keine leere
 * Tabelle, kein beruhigender Satz.
 */
function aufwandAuswerten() {
  auswertungLaufen(AUFWAND_PATH, "aufwand", "auswertungAufwand", befundText);
}

/**
 * Ruft die Wirksamkeits-Auswertung und legt ihr Ergebnis am Lauf-Kopf ab (Issue #790).
 *
 * Die Zwillingsfunktion zu aufwandAuswerten(), mit derselben Aufloesung des Nachbarn,
 * derselben Fehlerbehandlung und derselben Zusage aus E9: Jeder Fehlschlag ist genau eine
 * Protokollzeile und nie ein `fail()`. Ihr Befundblock geht als EIGENER Block hinter den
 * Aufwands-Block; ohne Befund bleibt das Protokoll an dieser Stelle stumm.
 */
function wirksamkeitAuswerten() {
  auswertungLaufen(WIRKSAMKEIT_PATH, "wirksamkeit", "auswertungWirksamkeit", wirksamkeitBefundText);
}

/**
 * Ruft die Befunde-Auswertung und legt ihr Ergebnis am Lauf-Kopf ab (Issue #806).
 *
 * Die dritte Schwester der beiden darueber, ueber dieselbe geteilte Funktion und mit
 * derselben Zusage: Jeder Fehlschlag ist genau eine Protokollzeile und nie ein `fail()`.
 * Ihr Befundblock geht als EIGENER Block hinter den der Wirksamkeit; ohne Befund bleibt
 * das Protokoll an dieser Stelle stumm — und ohne `.claude/befunde.tsv` ist genau das
 * der Regelfall (AK 12 der Quelle #768): Ein Projekt ohne Modell-Pruefungen sieht nichts
 * und braucht dafuer keinen Schalter.
 */
function befundeAuswerten() {
  auswertungLaufen(BEFUNDE_PATH, "befunde", "auswertungBefunde", befundeBefundText);
}

// Das Zeitlimit beider Auswertungen (Issue #824, night-67). Ohne Limit haengt der
// ganze Abschluss an ihnen: `kit/effectiveness.mjs` ruft fuer die Ruecklaeuferquote
// `board.mjs issue activity` und damit das Netz — bleibt der Aufruf stehen, erreichte
// der Lauf `laufMelden()` erst, wenn die Grenzen von `fetch` greifen. Grosszuegig
// bemessen: Die Auswertung liest ein ganzes Bewegungsprotokoll und holt Aktivitaeten
// fuer bis zu `kandidatenMax` Karten; 120 s sind ein Hut ueber dem Normalfall und
// keine Vorgabe, wie schnell sie zu sein hat.
const AUSWERTUNG_TIMEOUT_MS = 120 * 1000;

/**
 * Der geteilte Kern beider Auswertungen (Issue #790).
 *
 * Geteilt und nicht zweimal geschrieben, weil „dieselbe Fehlerbehandlung" sonst bei der
 * ersten Aenderung an einer der beiden Stellen aufhoerte, dieselbe zu sein. Was die
 * beiden unterscheidet, steht in den vier Parametern: Pfad des Werkzeugs, Feldname am
 * Lauf-Kopf, Schluessel ihres Namens in TEXTE fuer die Protokollzeile und die Textform ihres
 * Befundblocks.
 */
function auswertungLaufen(pfad, feld, bezeichnung, textform) {
  const timeoutMs = process.env.NIGHT_AUSWERTUNG_TIMEOUT_MS
    ? Number(process.env.NIGHT_AUSWERTUNG_TIMEOUT_MS)
    : AUSWERTUNG_TIMEOUT_MS;
  try {
    // Die fehlende Datei wird vorher abgefangen, statt sie in Node laufen zu lassen: Der
    // Kindprozess endete dann zwar auch mit Exit 1, aber die erste Zeile seines stderr ist
    // ein Pfad aus dem Modul-Lader ("node:internal/modules/cjs/loader:1573"). Die eine
    // Zeile, die dieser Fehlschlag sein darf, soll den Grund nennen und nicht den Ort.
    if (!existsSync(pfad)) throw new Error(t("auswertungDateiFehlt", { pfad }));
    // maxBuffer wie bei den Board-Aufrufen: Der Stand traegt alle einbezogenen Laeufe,
    // und ein abgeschnittener Puffer machte daraus einen Parse-Fehler.
    const res = spawnSync(process.execPath, [pfad, "evaluate"], {
      encoding: "utf-8",
      cwd: process.cwd(),
      maxBuffer: BOARD_MAX_BUFFER,
      timeout: timeoutMs,
    });
    // ETIMEDOUT bekommt eine eigene Meldung: "liess sich nicht starten" waere hier falsch
    // — das Werkzeug lief, es kam nur nicht zurueck.
    if (res.error?.code === "ETIMEDOUT") throw new Error(t("auswertungZeitlimit", { ms: timeoutMs }));
    if (res.error) throw new Error(t("auswertungStart", { pfad, fehler: res.error.message }));
    if (res.status !== 0) throw new Error(t("auswertungExit", { status: res.status, zeile: ersteZeile(res.stderr || res.stdout) }));
    let stand;
    try {
      stand = JSON.parse(res.stdout);
    } catch (err) {
      throw new Error(t("auswertungUnlesbar", { fehler: err.message }));
    }
    ZUSTAND.LAUF[feld] = stand;
    for (const zeile of textform(stand).split("\n")) {
      if (zeile.trim() !== "") log(zeile);
    }
  } catch (err) {
    // Nur, wenn kein Ergebnis vorliegt: Wirft erst der Textbau, bleibt das gelesene
    // Ergebnis am Lauf-Kopf stehen — es ist gemessen, und der Fehlschlag betrifft die Form.
    if (!(feld in ZUSTAND.LAUF)) ZUSTAND.LAUF[feld] = { ok: false, fehler: err.message };
    log(t("auswertungFehlgeschlagen", { bezeichnung: t(bezeichnung), fehler: err.message }));
  }
}

/**
 * Schliesst den Lauf ab — `regulaer` oder `harterStopp`, aber nie mehr `null`.
 *
 * Bei `harterStopp` greift hier das Sicherheitsnetz aus Issue #558: Kam kein Grund an,
 * traegt der Lauf den zuletzt gemerkten samt Ankervermerk, sonst den Ersatztext. Ein
 * Stand ohne Grund entsteht damit nicht mehr.
 *
 * DIE REIHENFOLGE IST BEGRUENDET (Issue #752, W6): erst schreiben, dann auswerten, dann
 * erneut schreiben. `abschluss` und `complete` stehen bis hierher nur im Speicher; auf
 * der Platte traegt die Datei dieses Laufs noch `abschluss: null, complete: false`. Genau
 * die liest die Auswertung, und der frischeste Lauf — der, um den es im Abschlussblock
 * geht — ginge als unvollstaendig ein. Wer diese Reihenfolge spaeter aendert, nimmt dem
 * Block seine Aussage.
 *
 * ALLE DREI Auswertungen stehen zwischen den zwei Schreibvorgaengen (Issue #790, #806):
 * erst der Aufwand, dann die Wirksamkeit, dann die Befunde, dann das zweite Schreiben.
 * Ein Schreibvorgang dazwischen waere nicht falsch, aber ueberfluessig; entscheidend ist,
 * dass der geschriebene Stand am Ende ALLE DREI Ergebnisse traegt. Die Folge der Aufrufe
 * ist die Folge ihrer Bloecke im Protokoll — Aufwand, Wirksamkeit, Befunde.
 *
 * Und erst danach `laufMelden()`: Eingeliefert wird der Stand einschliesslich seiner
 * Auswertung, nicht der Stand davor.
 */
function laufAbschliessen(abschluss) {
  if (!ZUSTAND.LAUF) return;
  ZUSTAND.LAUF.abschluss = abschluss;
  ZUSTAND.LAUF.complete = abschluss === "regulaer";
  if (abschluss === "harterStopp") {
    const netz = sicherheitsnetzGrund(ZUSTAND.LAUF, ZUSTAND.STOPP_GRUND);
    if (netz !== null) ZUSTAND.LAUF.fehlerText = netz;
  }
  schreibeErgebnisstand();
  aufwandAuswerten();
  wirksamkeitAuswerten();
  befundeAuswerten();
  schreibeErgebnisstand();
  laufMelden();
  waechterBeenden();
}

// laufArt, die Art des Laufs, steht in kit/night/grundlagen.mjs: Der Teil kitstand braucht
// sie fuer den Praefix seines Stands (Issue #1226).

// Was je Art am Grundgeruest und in der Startzeile haengt. Die Labels der beiden
// unbeaufsichtigten Laeufe kommen aus der Config, die in vorbereiten() vor dieser Abfrage
// geladen ist.
const ART_MODUS = { implementierung: "modusImplementierung", kette: "modusKette", pruefung: "modusPruefung" };
const ART_LABEL = {
  implementierung: (args) => args.label,
  kette: () => ketteBudgetStand().budget?.label ?? KETTE_BUDGET_DEFAULTS.label,
  pruefung: () => pruefLaufBudgetStand().budget?.label ?? PRUEFLAUF_BUDGET_DEFAULTS.label,
};

/**
 * Die Budgets DIESES Laufs und die Felder daraus, die aus den Vorgabewerten stammen —
 * `null` bei einer Art ohne Budget (Issue #909).
 *
 * Eine Stelle statt zweier Abfragen je Verwendung: Lauf-Kopf und Protokollzeile fragen
 * dasselbe, und zwei Fallunterscheidungen ueber dieselben drei Arten liefen bei der
 * naechsten Art auseinander.
 */
function laufBudget(args) {
  if (args?.kette) return ketteBudgetStand();
  if (args?.pruefen) return pruefLaufBudgetStand();
  return null;
}

/**
 * Legt Pfad und Grundgeruest des Ergebnisstands an (Issue #486).
 *
 * Nur, wo es etwas zu berichten gibt: Der Dry-Run arbeitet nichts ab und ist damit der
 * einzige Ausschluss. Bleiben beide Variablen null, schreibt schreibeErgebnisstand()
 * nichts.
 *
 * An --verbose haengt die Entstehung ausdruecklich NICHT mehr (Issue #557): Es fehlte
 * sonst genau in der Nacht die Auswertung, in der jemand das Flag vergessen hat — und
 * das ist die Nacht, in der man sie braucht. Der Grund eines Abbruchs wiegt mehr als die
 * Kennzahlen eines glatten Laufs.
 *
 * Seit Issue #668 haengen auch die KENNZAHLEN nicht mehr am Flag: Der Implementierungslauf
 * fordert den Strom immer an, wie die Kette es seit Plan #638 tut. Der frueher hier
 * gesetzte `kennzahlenHinweis` ist damit gegenstandslos und entfallen.
 *
 * Die Uhrzeit gehoert in den Dateinamen, weil das Textprotokoll eine Tagesdatei zum
 * Anhaengen ist, JSON aber nicht angehaengt werden kann — der zweite Lauf eines Tages
 * ueberschriebe sonst den ersten. Ohne Trennzeichen, weil Doppelpunkte in Dateinamen
 * nicht ueberall erlaubt sind. Zwei Starts in derselben Sekunde trennt
 * `laufStempelReservieren` (Issue #1190).
 */
function ergebnisstandAnlegen(args, aktivesLabel, jetztVorher) {
  if (args.dryRun) return;
  const budgetStand = laufBudget(args);
  const { stempel, jetzt, pfad, fehler } = laufStempelReservieren(process.cwd(), jetztVorher);
  // Wie jeder Schreibfehler am Ergebnisstand bricht auch dieser den Lauf nicht ab: Der
  // Stempel bleibt der zuletzt gebildete, die Kollision ist dann hingenommen wie frueher.
  if (fehler) log(t("ergebnisstandNichtReserviert", { fehler }));
  const iso = jetzt.toISOString();
  ZUSTAND.LAUF_STEMPEL = stempel;
  ZUSTAND.ERGEBNIS_FILE = pfad;
  // Feldreihenfolge und Schluessel sind der Vertrag mit allen Auswertungen —
  // schemaFassung steht zuerst, damit ein Leser die Fassung kennt, bevor er den
  // Rest deutet.
  ZUSTAND.LAUF = {
    schemaFassung: 1,
    erzeugtVon: KIT_VERSION,
    start: iso,
    art: laufArt(args),
    modell: args.model,
    max: args.max,
    label: aktivesLabel === "none" ? null : aktivesLabel,
    // Bleibt als Feld erhalten, weil die Feldreihenfolge der Vertrag der Schemafassung 1
    // ist (Issue #522); seit Plan #638 gibt es keine Stufe mehr, der Wert ist immer null.
    stufe: null,
    // `kennzahlenHinweis` ist mit Issue #668 entfallen und kommt nicht zurueck: Seit
    // der Implementierungslauf den Strom immer anfordert, gibt es keinen Lauf mehr ohne
    // Kennzahlen, den er erklaeren koennte. Das Feld bedingt stehenzulassen waere
    // schlechter als es zu streichen — es behauptete ein Fehlen, das es nicht gibt.
    // Die Kette fordert den Strom immer an (Plan #638, A5) und traegt ihre Budgets
    // am Lauf-Kopf, damit eine Auswertung den Abbruchgrund gegen die Zahl halten kann.
    // Der Prueflauf ebenso (Issue #909): Er hat keinen Zahlendeckel, und die Deckel, an
    // denen seine Abbrueche gemessen werden, sind genau diese Budgets — ohne sie am
    // Lauf-Kopf waere der Grund "Kostenbudget erschoepft" gegen nichts zu halten.
    ...(budgetStand?.budget ? { budget: { ...budgetStand.budget } } : {}),
    // Nur wenn Felder aus den Defaults stammen (Issue #659): Ein vollstaendiger Block
    // hinterlaesst keine Spur, damit das Feld selbst schon der Befund ist.
    ...(budgetStand && budgetStand.ausDefault.length > 0 ? { budgetAusDefault: [...budgetStand.ausDefault] } : {}),
    einheiten: [],
    abschluss: null,
    // Ab hier Issue #669, hinter abschluss, weil die Folge stufe → einheiten Vertrag ist.
    // `complete` ist `false`, solange der Lauf laeuft, und `true` nur am regulaeren Ende: Ein
    // harter Stopp laesst es in der DATEI auf `false` stehen — der Lauf kam nie durch.
    // Die MELDUNG ans Board sagt seit Issue #881 etwas anderes: Sie leitet `complete` aus
    // `abschluss` ab und traegt den harten Stopp als abgeschlossen samt `abortReason`,
    // damit er dort nicht ewig unter den aktiven Laeufen steht.
    complete: false,
    // Der Verbrauch des ganzen Laufs, einschliesslich der Sessions ohne Karte, und der Teil
    // davon, der zu keiner Einheit gehoert.
    verbrauch: verbrauchLeer(),
    verbrauchOhneEinheit: verbrauchLeer(),
    // Die Zielmarke, mit der DIESER Lauf gerechnet hat (Issue #978) — hinten angehaengt,
    // wie jedes neue Feld der Schemafassung 1. Sie steht hier und nicht erst in der
    // Auswertung, weil sie zwischen zwei Naechten eine andere gewesen sein kann: Wer
    // spaeter die Config laese, bewertete den Lauf von gestern gegen die Vorgabe von
    // heute. Der Wert ist der aufgeloeste — die Vorgabe des Schemas, wo die Config
    // schweigt —, damit an keiner Stelle ein zweites Mal aufgeloest werden muss.
    zielUmsetzungMin: zielUmsetzungMin(ZUSTAND.config?.night?.zielUmsetzungMin),
    // Der feste Kit-Stand dieses Laufs (Issue #1102, A7) — hinten angehaengt, die Fassung
    // bleibt 1 (E9). `null` heisst: Der Lauf arbeitete mit der Kopie der Hauptkopie.
    kitStand: kitStandFeld(),
    // Der Rechner dieses Laufs (Issue #1687, Plan #1685) — hinten angehaengt, die Fassung
    // bleibt 1. Ein Bericht ueber kopierte Staende liest ihn aus dem Stand, nicht aus dem Pfad.
    rechner: RECHNER,
  };
}

// Die Abschnitte der Teile — Laufstand, Kit-Stand, Abhaengigkeiten, Session, Bericht, die
// wartende Sitzung samt Runde, Kette und Prueflauf am Tag — stehen seit der Zerlegung unter
// kit/night/ (Plan #1199, E17); der Einstieg laedt sie oben und exportiert ihre Namen weiter.

// Versions-Drift zwischen den beiden Kit-Dateien (Issue #172). Sie werden
// gemeinsam installiert, koennen aber auseinanderlaufen (einzeln kopiert,
// abgebrochenes Re-Install). Der Runner ruft dann Adapter-Funktionen auf, die eine
// aeltere board.mjs nicht kennt — das aeussert sich als schwer zuzuordnendes
// Fehlverhalten. Bewusst nur eine Warnung: ein Unterschied macht den Lauf nicht
// zwingend kaputt, und ein zusaetzlicher naechtlicher Abbruchgrund waere schlimmer
// als das Problem, das er meldet.
function boardKitVersion() {
  try {
    const m = readFileSync(BOARD_PATH, "utf-8").match(/const KIT_VERSION = "([^"]*)";/);
    return m ? m[1] : null;
  } catch {
    return null; // nicht lesbar -> wie fehlende Konstante behandeln
  }
}

function warnBeiVersionsDrift() {
  const andere = boardKitVersion();
  if (andere === KIT_VERSION) return;
  const andereAngabe = andere ? `v${andere}` : t("versionUnbekannt");
  log(t("versionsDrift", { version: KIT_VERSION, andere: andereAngabe }));
}

// Die Warnung zum Routing-Label steht seit Issue #1231 im Teil kit/night/wartend.mjs bei der
// Implementierungsschleife; der Dry-Run nimmt sie von dort.

/** Laedt die Budgets der Kette; eine kaputte Zahl ist ein Config-Fehler, kein Lauf. */
function ketteBudgetLaden() {
  try {
    ketteBudgetSetzen(ZUSTAND.config);
  } catch (e) {
    fail(e.message, "zustand");
  }
}

/** Dasselbe fuer den Prueflauf (Issue #909): eine kaputte Zahl ist ein Config-Fehler, kein Lauf. */
function pruefLaufBudgetLaden() {
  try {
    pruefLaufBudgetSetzen(ZUSTAND.config);
  } catch (e) {
    fail(e.message, "zustand");
  }
}

/**
 * Prueft settings-Dateien auf gueltiges JSON (Issue #618, Idee #555). Nur die Syntax,
 * kein Schema: Eine ungueltige Datei setzt ALLE ihre Einstellungen ausser Kraft — env,
 * sandbox, permissions —, und nachts sieht man davon nur eine Genehmigungsabfrage, die
 * niemand beantwortet. Eine fehlende Datei ist kein Befund. Liefert je ungueltiger Datei
 * den absoluten Pfad mit der Meldung des Parsers.
 */
export function pruefeSettingsSyntax(pfade) {
  const befunde = [];
  for (const pfad of pfade) {
    if (!existsSync(pfad)) continue;
    try {
      JSON.parse(readFileSync(pfad, "utf-8"));
    } catch (e) {
      befunde.push(`${pfad}: ${e.message}`);
    }
  }
  return befunde;
}

/**
 * Der Vorflug ueber die drei Dateien, die jede Nacht-Session liest — in jeder
 * Betriebsart: harter Stopp ohne Dry-Run, im Dry-Run nur berichtet (wie der Reviewer-
 * Vorflug). Home ueber homedir() wie in board.mjs, nicht ueber HOME (#187).
 * settingsEnv() bleibt daneben tolerant: fuer eine Datei, die erst waehrend des Laufs
 * unbrauchbar wird.
 */
function settingsVorflug(args) {
  const befunde = pruefeSettingsSyntax([
    join(process.cwd(), ".claude", "settings.json"),
    join(process.cwd(), ".claude", "settings.local.json"),
    join(homedir(), ".claude", "settings.json"),
  ]);
  if (befunde.length === 0) return;
  const meldung = t("settingsUngueltig", { befunde: befunde.join(" | ") });
  if (args.dryRun) {
    log(`  ${t("warnung", { meldung })}`);
    return;
  }
  fail(meldung, "zustand");
}

/**
 * Je belegter Stufe eine Pruefung ohne Netz, ob sie startbar ist (Issue #712, Plan #707).
 *
 * Dieselbe `stufeStartbar` wie vor jedem Paket, hier nur einmal vor der ersten Kette —
 * eine Probe-Session je Stufe kostete Zeit und Geld fuer eine Aussage, die `laufeRunde`
 * ohnehin vor jedem Paket neu erhebt. Kein `fail`, auch nicht ausserhalb des Dry-Runs: Eine
 * nicht erreichbare Stufe weicht bei den betroffenen Paketen nach oben aus (oder scheitert
 * ohne Session), das ist kein Grund, die Nacht abzusagen (Kriterium 11). Bei nicht aktiver
 * Einstellung schreibt sie keine Zeile (Kriterium 12).
 */
function stufenVorflug() {
  const einstellung = stufenEinstellung(ZUSTAND.config);
  if (!einstellung.aktiv) return;
  for (const stufe of STUFEN_ORDNUNG) {
    const eintrag = einstellung.stufen[stufe];
    if (!eintrag) continue;
    const { ok, grund } = stufeStartbar(eintrag, ZUSTAND.config.night?.modelle);
    if (!ok) log(`  ${t("stufeNichtStartbar", { stufe, grund })}`);
  }
}

/** Die beiden Zustands-Vorfluege der Implementierung: kein Absturzrest, sauberer Baum. */
function zustandsVorflug() {
  const inProgress = board("issue", "list", "--status", "in_progress");
  if (inProgress.length > 0) {
    fail(t("inProgress", { ids: inProgress.map((i) => "#" + i.id).join(", ") }), "zustand");
  }
  if (!gitClean()) fail(t("baumUnsauber"), "zustand");
}

/**
 * Der gemeinsame Vorspann aller drei Programme: Phasen 2 bis 6 aus Issue #398.
 *
 * Config lesen, Logdatei festlegen, Label-Filter bilden, Versions-Drift melden,
 * Vorbedingungen pruefen. Liefert den Kontext, mit dem Dry-Run und Implementierung
 * arbeiten. Bricht bei verletzten Vorbedingungen selbst ab (`fail`) — das ist die
 * Stelle, an der ein Lauf gar nicht erst beginnen darf.
 */
/** Loescht die Protokolle jenseits der Frist und schreibt das Ergebnis ins Nacht-Log (Issue #1696). */
function protokolleAufraeumenMelden(args) {
  const ergebnis = protokolleAufraeumen(process.cwd(),
    { fristTage: protokollFrist(ZUSTAND.config), dryRun: args.dryRun === true });
  for (const zeile of aufraeumZeilen(ergebnis)) log(zeile);
}

export function vorbereiten(args) {
  if (!existsSync(BOARD_PATH)) fail(t("boardFehlt", { pfad: BOARD_PATH }));
  const configPath = join(process.cwd(), ".claude", "workflow.config.json");
  if (!existsSync(configPath)) fail(t("configFehlt"));
  ZUSTAND.config = ladeConfigMitOverrides(configPath);
  ZUSTAND.CONFIG_PATH = configPath;
  const lauf = laufModell(args, ZUSTAND.config);
  if (lauf.fehler) fail(lauf.fehler, "zustand");
  args.model = lauf.modell;
  args.modellHerkunft = lauf.herkunft;
  // Vor der ersten Session und vor dem Laufbericht (Issue #1084, E6): Ein falscher Block
  // haelt den Lauf an, bevor er etwas veraendert.
  nightStandPruefen(ZUSTAND.config);
  if (args.kette) ketteBudgetLaden();
  if (args.pruefen) pruefLaufBudgetLaden();

  const jetzt = new Date();
  mkdirSync(join(process.cwd(), ".claude"), { recursive: true });
  ZUSTAND.LOG_FILE = join(process.cwd(), ".claude", `night-run-${jetzt.toISOString().slice(0, 10)}.log`);

  // Routing-Label (Issue #159): nur Ready-Issues mit diesem Label werden verarbeitet,
  // alle anderen bleiben unangetastet liegen. --label none schaltet den Filter ab
  // (null = striktes ready[0], das Verhalten vor #159).
  const labelFilter = args.label === "none" ? null : args.label;
  const ctx = {
    labelFilter,
    // Unter jedem Namen des Labels (Issue #1425); ein Name ausserhalb des Registers fuer sich.
    hasLabel: (issue) => labelFilter === null || kennzeichenName(issue.labels, labelFilter) !== null,
    labelWarnungGezeigt: false,
  };

  const art = laufArt(args);
  const modus = t(ART_MODUS[art]);
  const aktivesLabel = ART_LABEL[art](args);
  const dryRunAngabe = args.dryRun ? ", DRY-RUN" : "";
  const yoloAngabe = args.yolo ? ", YOLO" : "";

  ergebnisstandAnlegen(args, aktivesLabel, jetzt);
  // Meldet den Lauf sofort mit leerer Paketliste (Issue #743): Ein Stopp im Vorflug oder
  // in der ersten Session soll am Board sichtbar sein, nicht erst nach dem ersten Paket.
  // laufMelden() liest ERGEBNIS_FILE ueber einen eigenen Prozess von der Platte, darum
  // erst schreiben, dann melden — sonst faende board.mjs die Datei noch nicht vor.
  schreibeErgebnisstand();
  laufMelden();
  // Journal und Puls (Issue #1084): ab hier hinterlaesst der Lauf ein Lebenszeichen.
  laufstandStarten();
  // Der Waechter (Issue #1085): Stirbt der Lauf ohne Abschied, schliesst er ihn ab.
  waechterStarten();

  // Ein Lauf ohne Zahlendeckel sagt das aus (Plan #904, E9): "max null Sessions" liesse
  // offen, ob die Zahl fehlt oder keine gilt.
  const maxAngabe = args.max === null ? t("maxOhneDeckel") : t("maxSessions", { max: args.max });
  log(t("start", { modus, max: maxAngabe, modell: args.model, herkunft: args.modellHerkunft, label: aktivesLabel,
    dryRun: dryRunAngabe, yolo: yoloAngabe }));
  // Der feste Kit-Stand (Issue #1102, A7): eine Zeile, mit der der Morgen den Lauf vom Stand
  // in seiner Arbeitskopie unterscheidet.
  kitStandMelden();
  if (args.yolo && !args.dryRun) {
    log(t("yoloWarnung"));
  }
  // Die Protokollfrist (Issue #1696): vor den Vorfluegen, damit sie fuer Implementierung,
  // Kette und Prueflauf gleichermassen gilt. Ein gescheitertes Loeschen haelt nicht an.
  protokolleAufraeumenMelden(args);

  // Vorflug-Checks
  warnBeiVersionsDrift();
  // Die beiden Zustands-Vorfluege gelten der Implementierung: Sie arbeitet in der
  // Hauptkopie und darf nicht auf einem Absturzrest aufsetzen. Die Kette arbeitet in
  // einem eigenen Worktree und laeuft neben einer Umsetzungsnacht (Plan #638, A3): Ein
  // Paket in In progress ist fuer sie kein Absturzrest, ein unsauberer Baum kein Hindernis.
  //
  // Fuer den Prueflauf gilt dasselbe, und bei ihm noch deutlicher (Issue #909): Er laeuft am
  // TAG, neben dem arbeitenden Menschen. Dass dessen Arbeitsbaum unsauber ist und eine Karte
  // in In progress steht, ist dort der Normalzustand — er fasst die Hauptkopie nicht an.
  if (!args.kette && !args.pruefen) zustandsVorflug();
  // In jeder Betriebsart, nach dem Baum (Issue #618): Eine ungueltige settings-Datei
  // traefe jede Session, ob sie baut oder plant.
  settingsVorflug(args);
  // Nachts ohne Gate zu implementieren ist riskant; ein Lauf, der nichts baut, hebt die
  // Pflicht ueber `noChecksOk` auf (so machen es die Folgepakete fuer die Kette).
  //
  // Gezaehlt wird, was der ABSCHLUSS einer Karte faehrt, und nicht die Listenlaenge
  // (Plan #753, E14; Plan #944, E14): Eine gefuellte Liste aus lauter Push-Pruefungen
  // liefe hier sonst durch, ebenso eine, in der jeder Paketstufen-Eintrag
  // `nichtBeimAbschluss` oder eine Guetemessung traegt — obwohl die Umsetzung eines
  // Arbeitspakets damit kein einziges Gate haette, genau der Zustand, den dieser Guard
  // verhindern soll. Die Meldung nennt deshalb alle drei Gruende und nicht nur "leer":
  // Wer drei Eintraege in seiner Config sieht, sucht bei einem blossen "ist leer" an der
  // falschen Stelle.
  //
  // Dies ist der Halt, dem kit/settings.mjs dieselbe Bedingung als WARNUNG vor dem
  // Speichern gegenueberstellt (Issue #949): Die Config bleibt speicherbar, nachts
  // implementiert wird auf ihr nicht.
  if (paketstufenChecks(ZUSTAND.config).length === 0 && !args.noChecksOk) {
    fail(t("keinGate"), "zustand");
  }
  // Nach den bestehenden Vorfluegen (Issue #712): eine Warnzeile je nicht erreichbarer
  // Stufe, ohne den Lauf aufzuhalten.
  stufenVorflug();

  // Erst hinter dem Vorflug (Issue #486): Ein Baum, der schon vor dem Lauf unsauber
  // war, soll weiterhin die alte Meldung bekommen und nicht eine, die die eben
  // angelegte Datei mitverschuldet haben koennte.
  schreibeErgebnisstand();

  return ctx;
}

/**
 * Wertet den Vorflug einer Review-Nacht aus und meldet ihn (Issue #404).
 *
 * Getrennt vom Programm, weil hier drei Befunde getrennt gehalten werden muessen:
 * Ein `verfuegbar: false`, das in Wahrheit ein toter Tracker war, schickt den
 * Menschen morgens in die falsche Ecke. Liefert die Liste der Probleme; ob sie den
 * Lauf anhalten, entscheidet der Aufrufer — im Dry-Run wird nur berichtet.
 */
function meldeVorflug(vorflug, reviewerListe) {
  if (!vorflug.sessionStartbar) {
    log(`  ${t("vorflugNichtAuswertbar", { grund: vorflug.grund })}`);
  }
  for (const r of vorflug.reviewers) {
    const stand = r.verfuegbar ? t("reviewerVerfuegbar") : t("reviewerNichtVerfuegbar", { grund: r.grund });
    log(`  ${t("reviewerZeile", { name: r.name, art: r.kind, umgebung: r.umgebung, stand })}`);
  }
  // Gar kein Reviewer konfiguriert: eigener Text, weil die Abhilfe eine andere ist —
  // nicht "Werkzeug installieren", sondern "Block uebernehmen".
  const KEIN_REVIEWER = t("keinReviewerGrund");
  if (reviewerListe.length === 0) log(`  ${t("keinReviewer", { grund: KEIN_REVIEWER })}`);
  const getVermerk = vorflug.tracker.uebersprungen
    ? t("getUebersprungen", { grund: vorflug.tracker.uebersprungen })
    : "";
  const trackerStand = vorflug.tracker.erreichbar
    ? t("trackerErreichbar", { vermerk: getVermerk })
    : t("trackerNichtErreichbar", { grund: vorflug.tracker.grund });
  log(`  ${t("trackerZeile", { umgebung: vorflug.tracker.umgebung, stand: trackerStand })}`);

  // Drei getrennte Befunde, drei getrennte Meldungen.
  const probleme = [];
  if (!vorflug.sessionStartbar) probleme.push(t("problemSession", { grund: vorflug.grund }));
  if (reviewerListe.length === 0) {
    probleme.push(t("problemKeinReviewer", { grund: KEIN_REVIEWER }));
  } else if (vorflug.sessionStartbar) {
    const fehlen = vorflug.reviewers.filter((r) => r.verfuegbar !== true).map((r) => `${r.name} (${r.grund})`);
    if (fehlen.length > 0) probleme.push(t("problemReviewer", { liste: fehlen.join(", ") }));
  }
  if (vorflug.sessionStartbar && vorflug.tracker.erreichbar !== true) {
    probleme.push(t("problemTracker", { grund: vorflug.tracker.grund }));
  }
  return probleme;
}

/**
 * Faehrt den Vorflug und macht ihn zum Gate (Issue #233, Umgebung korrigiert in #269).
 *
 * Geteilt von Review- und Erzeugungsmodus (Issue #518): Beide starten spaeter dieselben
 * `/issue-review`-Sessions, also messen sie dieselbe Umgebung. Zwei Kopien wuerden
 * auseinanderlaufen, und ein Erzeugungslauf pruefte dann etwas anderes als ein
 * Review-Lauf, ohne dass es jemandem auffiele.
 *
 * `issue-review check` ist fuer sich eine Auskunft, kein Gate — der interaktive Skill
 * fragt den Menschen, wenn einer fehlt. Nachts fragt niemand, und ein unterbesetzter Lauf
 * sieht am Board aus wie ein vollstaendiger. Deshalb hier ein harter Stopp, bewusst ohne
 * Opt-out: Wer wissen will, ob alles steht, faehrt vorher --dry-run.
 *
 * Im Dry-Run selbst wird nur berichtet, nicht abgebrochen — sonst zeigt ausgerechnet der
 * Lauf nichts an, der das Problem aufklaeren soll. Die eine Vorflug-Session laeuft auch
 * dort, sonst pruefte der Trockenlauf etwas anderes als der Ernstfall.
 *
 * `dryRunHinweis` traegt den Aufruf, mit dem der Mensch den Befund selbst sieht — er
 * unterscheidet sich je Modus und gehoert deshalb an den Aufrufer.
 */
export async function fuehreVorflug(args, kandidaten, dryRunHinweis, beiStopp = null) {
  // Die Reviewer-Liste kommt direkt aus der Config statt aus `issue-review check`: Der
  // Runner braucht hier nur die Kommandozeilen fuer den Auftrag der Vorflug-Session,
  // und die Verfuegbarkeit misst ohnehin nur noch die Session.
  const reviewerListe = (ZUSTAND.config.issueReview?.reviewers || [])
    .filter((r) => r && typeof r.name === "string")
    .map((r) => ({ name: r.name, kind: r.kind === "command" ? "command" : "claude", command: r.command }));
  const trackerId = trackerProbeId(kandidaten, kandidaten.length > 0 ? null : board("issue", "list"));

  const probeAngabe = trackerId ? t("probeIssue", { id: trackerId }) : t("probeListe");
  log(`  ${t("vorflugStart", { modell: VORFLUG_MODEL, probe: probeAngabe })}`);
  const vorflug = await reviewerVorflug(args, reviewerListe, trackerId);

  // Eine Vorflug-Session darf so wenig am Repository anfassen wie eine Review-Session.
  // Tut sie es doch, ist die Lage unklar und der Lauf endet hier — dieselbe Leitplanke
  // wie nach einer Review-Session (Issue #152), und sie gilt auch im Dry-Run: Ein
  // veraenderter Working Tree ist kein Befund, sondern ein Unfall.
  //
  // Ausgenommen ist die Kette (Issue #878): Sie misst hier nicht, ob der Vorflug etwas
  // veraendert hat, sondern nur, ob die Hauptkopie ueberhaupt Reste traegt — und die
  // traegt sie erwartbar, weil die Kette neben einer Umsetzungsnacht laeuft (Plan #638,
  // A3; aus demselben Grund laesst sie `zustandsVorflug()` aus). Ein Vorher-nachher-
  // Vergleich waere kein Ausweg: Ein parallel schreibender Lauf haelt ihn nicht an. Der
  // Zustand der Hauptkopie ist der Kette darum ganz egal; nur ihre Stufe `umsetzung`
  // prueft ihn, weil erst sie dort baut.
  //
  // Der Prueflauf ist aus demselben Grund ausgenommen (Issue #909), und bei ihm waere die
  // Messung noch sicherer falsch: Er laeuft am Tag neben dem arbeitenden Menschen, dessen
  // Reste hier erwartbar liegen. Er baut in keiner Stufe, also prueft er den Baum nie.
  const reste = args.kette || args.pruefen ? [] : gitReste();
  if (reste.length > 0) {
    const satz = t("vorflugVeraendert");
    log(`  ${satz}`);
    if (beiStopp) beiStopp(satz);
    merkeHartenStopp("harterStopp", `${satz} ${resteText(reste)}`);
    // Der einzige der sieben Wege ohne Karte (Issue #558): Der Vorflug laeuft, bevor
    // ein Kandidat gezogen ist, und `fehlerEinheit` bleibt darum leer.
    hefteStoppGrundAnLauf();
    laufAbschliessen("harterStopp");
    process.exit(1);
  }

  const probleme = meldeVorflug(vorflug, reviewerListe);
  if (probleme.length > 0 && !args.dryRun) {
    // Erst die Kandidaten benachrichtigen (Issue #645): Ohne diesen Kommentar bliebe ein
    // Kennzeichen, dessen Kette nie begann, am Morgen ohne Spur am Board.
    if (beiStopp) beiStopp(probleme.join(" | "));
    fail(t("vorflugUnterbesetzt", { probleme: probleme.join(" | "), hinweis: dryRunHinweis }));
  }
}

/**
 * Was der Dry-Run zu einem Ready-Issue melden wuerde (Issue #404).
 *
 * Rueckgabe: `{ grund, vermerk }`. Ist `grund` null, liefe das Issue — `vermerk`
 * traegt dann den Zusatz, der an die Session-Zeile gehoert.
 *
 * Dieselben Gruende wie im echten Lauf (pruefeIssueGates), aber im Konjunktiv und
 * ohne jede Wirkung am Board: Der Dry-Run kommentiert nichts und verschiebt nichts.
 * Getrennt gehalten statt geteilt, weil die Texte verschieden sein muessen — "wuerde
 * ins Backlog" ist eine andere Aussage als "ins Backlog verschoben".
 */
/**
 * Der Zusatz an die Session-Zeile des Dry-Runs, wenn `night.stufen` aktiv ist (Issue #712).
 *
 * Dieselbe `paketWahl` wie im echten Lauf, nur im Konjunktiv: Stufe und Modell, die
 * eingesetzt wuerden, samt Herkunft — inklusive einer nicht belegten eigenen Stufe, die
 * nach oben ausweicht (Kriterium siehe Aufgabe: `, Stufe leicht, Modell <x> (Stufe leicht)`
 * bzw. `, Stufe leicht nicht belegt, Modell <x> (Stufe mittel)`). Herkunft "karte" und
 * "lauf" bleiben wortgleich mit der Zeile von vor der Stufen-Einstellung.
 */
function dryRunStufenVermerk({ modell, herkunft, stufe, stufeVerwendet, grund, effort }) {
  if (herkunft === "karte") return t("dryModellKarte", { modell });
  if (herkunft === "lauf") {
    const nachsatz = grund ? ` — ${grund}` : "";
    return t("dryModellLauf", { modell, nachsatz });
  }
  const stufeText = t(stufeVerwendet === stufe ? "dryStufe" : "dryStufeNichtBelegt", { stufe });
  // Die Gruendlichkeit steht hinten und nur, wenn sie gesetzt ist (Issue #846): Wer vor
  // der Nacht prueft, WOMIT ein Paket liefe, prueft auch, wie gruendlich — ohne sie bleibt
  // die Zeile zeichengleich mit der von vor dieser Aenderung.
  const effortText = effort ? t("dryGruendlichkeit", { effort }) : "";
  return t("dryStufenVermerk", { stufe: stufeText, modell, verwendet: stufeVerwendet, effort: effortText });
}

// Die vier Titel-Praefixe, deren Karte keine Session umsetzt, mit dem Wort, das der Dry-Run
// dafuer nennt. Als Tabelle und nicht als vier `if`-Zeilen: Der Dry-Run muss dieselbe Auskunft
// geben wie `pruefeIssueGates` im echten Lauf, und eine Liste an einer Stelle laeuft mit der
// Reihenfolge dort nicht auseinander (Issue #984).
const DRY_RUN_PRAEFIXE = [
  [isFachlich, "artFachlich"],
  [isIdee, "artIdee"],
  [isPlan, "artPlan"],
  [isMensch, "artMensch"],
];

/** Der Befund des Body-Gates aus `geschuetztGate` im Konjunktiv, `null` ohne Halt (Issue #1047). */
function dryRunGeschuetzt(issue, full) {
  const treffer = geschuetzteTreffer(full.body || "", issue.title || full.title || "", hauptWurzel());
  if (treffer.length === 0) return null;
  const kommentare = kommentareVon(full).map((k) => ({ body: k }));
  if (geschuetztFreigabe(treffer, kommentare, full.labels || issue.labels || [])) return null;
  return t("dryGeschuetzt", { pfade: treffer.map((tr) => tr.pfad).join(", ") });
}

function dryRunBefund(issue, ctx, assumedDone) {
  let befund = null;
  const aus = (grund) => ({ grund, vermerk: "", befund });
  if (!ctx.hasLabel(issue)) return aus(t("dryOhneLabel", { label: ctx.labelFilter }));
  const praefix = DRY_RUN_PRAEFIXE.find(([passt]) => passt(issue.title));
  if (praefix) return aus(t("dryPraefix", { art: t(praefix[1]) }));
  if (hatKlaerenLabel(issue)) return aus(t("dryKlaeren", { label: kitLabel("klaeren") }));
  // Beide Gates fuer geschuetzte Dateien in der Reihenfolge von `pruefeIssueGates` (Issue
  // #1047, Plan #987, E19): erst das Label, das auch eine Karte ohne Pfad im Body traegt,
  // dann der Treffer, sofern der Mensch ihn nicht nach E5 freigegeben hat.
  if (hatGeschuetztLabel(issue)) return aus(t("dryGeschuetztLabel", { label: kitLabel("geschuetzt") }));

  const full = board("issue", "get", String(issue.id));
  const geschuetzt = dryRunGeschuetzt(issue, full);
  if (geschuetzt) return aus(geschuetzt);
  // Der Befund wie im Rueckstell-Kommentar, auch fuer ein Paket, das startet (Issue #1064):
  // Gerade eine versehentliche, zufaellig erfuellte Abhaengigkeit fiele sonst nicht auf.
  befund = abhaengigkeitsBefund(issue, full.body, assumedDone);
  // Dasselbe Review-Gate wie im echten Lauf (Issue #304). Bis dahin lief es hier
  // NICHT mit: Der Dry-Run bildete nur Praefixe, Abhaengigkeiten und --max ab und
  // wies Tickets als Session aus, die der echte Lauf zurueckstellt. Wer damit
  // prueft, ob die Nacht laeuft, bekaeme eine Antwort ueber einen anderen Lauf.
  if (ZUSTAND.config.issueReview?.requiredBeforeReady) {
    const freigabe = reviewFreigabe(full.body);
    if (!freigabe.frei) return aus(t("dryGate", { grund: GATE_ABLEHNUNG[freigabe.art].kurz() }));
  }
  const unmet = parseDeps(full.body).filter((d) => !assumedDone.has(d));
  if (unmet.length > 0) {
    return aus(t("dryAbhaengigkeit", { ids: unmet.map((d) => "#" + d).join(", ") }));
  }

  // Ohne aktive Einstellung bleibt die Zeile zeichengleich mit der von vor #712 (Kriterium
  // 1 des Issues) — dieselben zwei Zweige wie bisher, unveraendert.
  const einstellung = stufenEinstellung(ZUSTAND.config);
  if (!einstellung.aktiv) {
    // Das Modell gehoert in den Dry-Run (Issue #665): Wer vor der Nacht prueft, was
    // laufen wuerde, prueft auch, WOMIT. Herkunft dazu, sonst liesse sich ein Rueckfall
    // auf das Lauf-Modell nicht von einer Karte unterscheiden, die es selbst empfiehlt.
    const { modell, grund } = empfohlenesModell(full.body, ZUSTAND.config.night?.modelle);
    if (modell) return { grund: null, vermerk: t("dryModellKarte", { modell }), befund };
    const nachsatz = grund ? ` — ${grund}` : "";
    return { grund: null, vermerk: t("dryModellLauf", { modell: ctx.laufModell, nachsatz }), befund };
  }

  // Bei aktiver Einstellung entscheidet dieselbe Funktion wie im echten Lauf, samt Stufe
  // und Ausweichen nach oben (Issue #712).
  const modellStand = paketWahl({
    body: full.body,
    einstellung,
    erlaubteModelle: ZUSTAND.config.night?.modelle,
    laufModell: ctx.laufModell,
  });
  if (!modellStand.startbar) {
    return aus(t("dryKeineStufe", { stufe: modellStand.stufe, grund: modellStand.grund }));
  }
  return { grund: null, vermerk: dryRunStufenVermerk(modellStand), befund };
}

/**
 * Programm 2 — der Dry-Run (Phase 8 aus Issue #398).
 *
 * Zeigt Reihenfolge und Abhaengigkeits-Bewertung an, bewegt nichts und startet
 * nichts. Beendet den Prozess selbst; deshalb bleibt die Testbarkeit auf
 * Subprozess-Tests beschraenkt.
 */
export function laufeDryRun(args, ctx) {
  // Das Modell des Laufs wandert in den ctx, damit `dryRunBefund` es fuer den Rueckfall
  // nennen kann, ohne `args` zu kennen (Issue #665).
  ctx = { ...ctx, laufModell: args.model };
  const ready = board("issue", "list", "--status", "ready");
  if (ready.length === 0) {
    vermerkeOhneArbeit("readyLeer", {});
    process.exit(0);
  }
  warnWennLabelNirgendsVorkommt(ctx, ready);
  const assumedDone = satisfiedIds(); // Annahme: frühere Runden gelingen
  let planned = 0;
  for (const issue of ready) {
    const { grund, vermerk, befund } = dryRunBefund(issue, ctx, assumedDone);
    const befundZeilen = abhaengigkeitsZeilen(befund);
    if (grund !== null) {
      log(`  #${issue.id} ${issue.title} -> ${grund}`);
      befundZeilen.forEach((zeile) => log(zeile));
      continue;
    }
    if (planned >= args.max) {
      log(`  #${issue.id} ${issue.title} -> ${t("dryUeberMax", { max: args.max })}`);
      befundZeilen.forEach((zeile) => log(zeile));
      continue;
    }
    planned++;
    assumedDone.add(Number(issue.id));
    log(`  #${issue.id} ${issue.title} -> ${t("drySession", { nr: planned, vermerk })}`);
    befundZeilen.forEach((zeile) => log(zeile));
  }
  log(t("dryEnde", { anzahl: planned }));
  process.exit(0);
}

// Die Gates eines Ready-Issues, der Salvage-Versuch, die Gruende einer Runde ohne Ergebnis,
// die wartende Sitzung, die Auswertung der Runde und die Implementierungsschleife stehen seit
// Issue #1231 im Teil kit/night/wartend.mjs (Plan #1199, E17); der Einstieg laedt ihn oben
// und exportiert seine Namen weiter.

async function main() {
  // Der Waechter eines Laufs (Issue #1085) ist kein Lauf: keine Handler, kein Lauf-Kopf.
  if (process.argv[2] === "--watcher") {
    await waechterLaufen(process.argv[3]);
    process.exit(0);
  }
  const args = parseArgs(process.argv.slice(2));
  // Der feste Kit-Stand (Issue #1102, A2): Hat der Lauf einen, arbeitet ein Kind aus ihm, und
  // dieser Prozess reicht nur noch Signale weiter und endet mit dessen Exit-Code. `--version`
  // und `--help` enden schon in parseArgs, `--dry-run` und `--watcher` brauchen keinen Stand.
  // Vor den Abbruch-Handlern: Ein Signal soll hier das Kind erreichen, nicht diesen Prozess beenden.
  const kindExit = await kitStandSchritt(args, process.argv.slice(2));
  if (kindExit !== null) process.exit(kindExit);
  // Jeder Abbruch endet in process.exit und erreicht kein finally mehr: Die Markierung des
  // festen Kit-Stands (Issue #1102, A4) faellt deshalb beim Ende, synchron.
  abbruchHandlerSetzen({ beimEnde: () => {
    for (const baum of [...KIT_STAND_BAEUME]) kitStandFreigeben(baum);
  } });

  const ctx = vorbereiten(args);
  // Erst nach den Vorpruefungen (Issue #1200): Ein Start, der nicht laufen darf, raeumt nichts ab.
  kitStaendeAufraeumen(args);
  // Wartende Nachtberichte gehen vor jeder Betriebsart nach (Issue #645) — nicht im
  // Dry-Run, der nichts am Board veraendert. Offene Laufstaende aus dem Journal ebenso
  // (Issue #1084, E5) — nicht in vorbereiten(), das auch im Dry-Run laeuft.
  // Verwaiste Laeufe zuerst (Issue #1085, E7): Ihr `abgebrochen` geht vor den Nachtrag.
  if (!args.dryRun) {
    berichteNachtragen();
    verwaisteLaeufeAbschliessen();
    staendeNachtragen();
  }

  // Vier einander ausschliessende Programme. Kette, Prueflauf und Dry-Run beenden den Prozess
  // selbst; nur die Implementierung kehrt zurueck und laesst main() den Exit-Code bilden.
  // Die Kette steht vor dem Dry-Run: --chain --dry-run ist ein Trockenlauf DER KETTE.
  if (args.kette) {
    await laufeKette(args);
    return;
  }
  // Der Prueflauf ebenso vor dem Dry-Run (Plan #904, E17): `--check --dry-run` weist
  // `pruefeArgs` ab, und dieser Zweig haelt den Aufruf auch dann bei seinem Lauf, wenn dort
  // je einmal eine Vorschau entstehen sollte.
  if (args.pruefen) {
    await laufePrueflauf(args);
    return;
  }
  if (args.dryRun) {
    laufeDryRun(args, ctx);
    return;
  }

  const ergebnis = await laufeImplementierung(args, ctx);
  // `angehalten` steht NACH `Session(s) gestartet` (Issue #572): Die bestehenden
  // Label-Tests matchen die Zeile bis dorthin, und ein Einschub davor haette sie
  // gebrochen, ohne dass sich an ihrer Aussage etwas geaendert haette.
  // Nur wenn es sie gab (Issue #1089): Die Label-Tests matchen die Zeile bis `angehalten.`.
  const abgebrochen = ergebnis.abgebrochen ? t("endeAbgebrochen", { anzahl: ergebnis.abgebrochen }) : "";
  // Ebenso nur, wenn es sie gab (Issue #1391, Plan #1386, E13): die von der Bremse beendeten Runden.
  const festgefahren = ergebnis.festgefahren ? t("endeFestgefahren", { anzahl: ergebnis.festgefahren }) : "";
  log(t("ende", { erfolgreich: ergebnis.succeeded, zurueckgestellt: ergebnis.deferred, ohneNachweis: ergebnis.ohneNachweis ?? 0,
    sessions: ergebnis.sessions, angehalten: ergebnis.angehalten ?? 0, abgebrochen, festgefahren,
    harterStopp: ergebnis.hardStop ? t("endeHarterStopp") : "" }));
  for (const zeile of pruefBericht(ergebnis.pruefungen, ZUSTAND.LAUF?.einheiten ?? [], ZUSTAND.config?.night?.zielUmsetzungMin)) log(zeile);
  log(t("morgenRitual", { pfad: ZUSTAND.LOG_FILE }));
  process.exit(ergebnis.hardStop ? 1 : 0);
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen.
// Eine Funktion, weil die Antwort schon am Dateianfang gebraucht wird (auskunftOhneTeile).
function alsCliGestartet() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false; // argv[1] nicht aufloesbar -> kein CLI-Start
  }
}

/** Beantwortet --help, -h und --version und beendet den Prozess; sonst geschieht nichts. */
function auskunftOhneTeile(argv) {
  const flag = argv.find((a) => a === "--help" || a === "-h" || a === "--version");
  if (flag === undefined) return;
  process.stdout.write(flag === "--version" ? `night.mjs (claude-workflow-kit v${KIT_VERSION})\n` : HILFE);
  process.exit(0);
}

// Die Grundlagen rufen Puls, Abbruch und zweiten Versuch des Laufstands, ohne ihn zu
// importieren (Plan #1199, E16): Der Einstieg bindet sie hier an.
grundlagenAnbinden({
  pulsSchreiben,
  laufAbbrechen,
  anhaltenLaeuft,
  zweiterVersuch,
  vermerkAnDieKarte,
  laufAnhalten,
});

// Die Implementierungsschleife im Teil wartend schliesst den Lauf ab, ohne den Einstieg zu
// importieren (Plan #1199, E16): Der Abschluss steht noch hier und wird hier angebunden.
wartendAnbinden({ laufAbschliessen });

// Ebenso die Kette: Sie schliesst den Lauf ab und faehrt den Reviewer-Vorflug, ohne den
// Einstieg zu importieren (Plan #1199, E16).
ketteAnbinden({ laufAbschliessen, fuehreVorflug });

// Ebenso der Prueflauf am Tag (Issue #1234, Plan #1199, E16).
tagAnbinden({ laufAbschliessen, fuehreVorflug });

if (runAsCli) await main();
