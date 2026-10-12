#!/usr/bin/env node
/**
 * board.mjs — Provider-agnostischer Einstiegspunkt fuer alle Board-Operationen.
 * Liest .claude/workflow.config.json, waehlt anhand issueTracker/codeHost den Adapter
 * und fuehrt die angeforderte Operation aus.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`
 * (aktualisiert den eingebetteten Blob in install.mjs).
 *
 * Ausgabe: JSON auf stdout. Einzige Ausnahme: `issue brief` ohne --json schreibt
 * Markdown (Issue #1023). Fehler: Meldung auf stderr, Exit-Code 1.
 *
 * Nutzung:
 *   node board.mjs issue create --title "..." --body "..." [--author-model <modell>]
      Body braucht eine Zeile "Autor-Modell: <modell>"; --author-model oder
      KIT_AGENT_MODEL setzen sie, sonst Abbruch. [--author-model <modell>]
 *       Der Body braucht eine Zeile "Autor-Modell: <modell>" (Issue #266);
 *       --author-model oder KIT_AGENT_MODEL setzen sie, sonst bricht der Aufruf ab.
 *       [--derived-from <nummer>] schickt die Kartennummer des naechsten Vorfahren
 *       mit (Issue #356). Nur der kanbancompat-Tracker wertet sie aus.
 *   node board.mjs issue get <id>
 *   node board.mjs issue activity <id> | issue activity --ids <n,n,...>
 *   node board.mjs issue list [--status <status>]
 *   node board.mjs issue move <id> <status>
 *   node board.mjs issue update <id> --body "..." | --body-file <pfad> | --body -
 *   node board.mjs issue comment <id> --text "..." | --text-file <pfad> | --text -
 *       '-' liest von stdin, gut fuer kurze Texte. Fuer lange (Review-Befunde) ist
 *       '--text-file' der Weg: eine stueckweise per Shell erzeugte Datei ausserhalb
 *       des Projektverzeichnisses (Issue #584).
 *       '--idempotency-key <wert>' wiederholt 'issue create' und 'issue comment'
 *       gefahrlos, wenn der Ausgang unklar blieb (Issue #834).
 *   node board.mjs issue report <id> --text '<bericht>' | --text-file <pfad>
 *   node board.mjs issue report <id> --part <n> --text '<stueck>'
 *   node board.mjs issue report <id>
 *       Legt den Abschlussbericht ab und zieht nach In review, je Lauf idempotent
 *       (Issue #1022): gleicher Bericht desselben Laufs -> nichts, geaenderter ->
 *       ersetzt. --part schreibt Stueck n nach .claude/berichte/, der Aufruf ohne
 *       --text setzt die Stuecke zusammen und schliesst ab.
 *   node board.mjs issue run-state <id> --state running|aborted|waiting|done --text-file <pfad>
 *       Label und Kommentar '## Laufstand' einer Karte in einem Zug, wiederholbar
 *       (Issue #1083). Labelnamen aus night.stand.labels.
 *   node board.mjs issue brief <id> [--column ready|in_progress] [--json]
 *       Aufgabe, Voraussetzungen und das Urteil "darf beginnen" in einem Zug, rein
 *       lesend (Issue #1023). Ausgabe Markdown, mit --json als JSON.
 *   node board.mjs issue origin <plan>
 *       Ist der Plan durch, und welche Ursprungsdokumente wandern nach In review
 *       (Issue #1285)? Rein lesend, Ausgabe JSON.
 *   node board.mjs issue origin <plan>
      Stand der Ursprungsdokumente eines Plans (Issue #1285, Plan #1283): durch heisst,
      mindestens ein Paket ('Plan: Issue #M') liegt in In review oder Done und keines in
      Backlog, Ready oder In progress. Je Dokument (Plan, fachliche Anforderung aus
      'Fachliche Quelle:') die Aktion wandert | lag bereits in In review | lag bereits
      in Done | bleibt, mit Grund. Rein lesend, bewegt nichts. Ausgabe: { plan, durch,
      grund, fehlend: [{ id, titel, spalte }], dokumente: [{ id, art, spalte, aktion, grund }] }.
  node board.mjs issue label add <id> <name>
 *   node board.mjs issue label remove <id> <name>
 *       Zeichnet ein Issue (z. B. kit:klaeren). Nicht fuer Status-Labels — die
 *       aendert `issue move` (Issue #249).
 *   node board.mjs code repo-name
 *   node board.mjs code pr --from <branch> --to <branch>
 *   node board.mjs code ci-status --commit <sha>
 *       Zustand der CI fuer genau diesen Commit (Issue #316). Dispatcht ueber
 *       resolveCodeHost — die Achse haengt am codeHost, nicht am issueTracker.
 *   node board.mjs code protection status | setup [--branch <z>] | suspend --in <pfad>
 *                              | restore | verify [--branch <z>]
 *       Schutz von Haupt- und Veroeffentlichungszweig (Issue #1408, Plan #1405). status
 *       meldet { geschuetzt, fehlt, ungeprueft }, einrichten schaltet nach der Probe auf
 *       dem Pruefzweig scharf, aussetzen ist der Notfallweg hinter dem Notfall-Gate.
 *       einrichten, aussetzen und nachpruefen sind mit KIT_AGENT_MODEL gesperrt.
 *   node board.mjs context paths [--project <name>] [--date JJJJ-MM-TT]
  node board.mjs context last-log [--project <name>] [--before JJJJ-MM-TT]
  node board.mjs issue-review reviewers --author <modell>
  node board.mjs issue-review check [--path-only]
  node board.mjs issue-review matrix
  node board.mjs issue-review roles --stage <requirement|plan|issue> --author <model>
  node board.mjs issue-review review-brief --role <rolle> --file <ziel> (--id <N> | --material-file <pfad>)
      Montiert den Pruefauftrag eines Pruefers aus kit/rollen/<rolle>.md (Issue #1380).
      Nicht zu verwechseln mit 'issue brief <id>', dem Umsetzungsauftrag einer Karte.
  node board.mjs issue-review start --reviewer <name> | --code-review --brief <datei> --output <datei>
      Startet einen fremden Pruefer ohne Shell mit angehaengter Lesegrenze (Issue #1381).
 */

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "5.0.0";

// Die Hilfe gibt es je Kommando genau einmal, englisch, in jedem Projekt (Issue #1557, Plan
// #1548 E7). Sie antwortet, bevor ein Teil geladen ist (Plan #1199, E2).
const HELP = `board.mjs — board adapter for the claude-workflow-kit

Usage:
  node board.mjs issue create --title "..." --body "..." | --body-file <path> | --body -
                             [--author-model <model>] [--derived-from <number>]
                             [--idempotency-key <value>] [--art requirement|plan|idea|human|task]
      --art puts the English title prefix of the kind in front, such
      as '[Requirement]' (Issue #1427). A title with a prefix stays
      valid; --art next to it is an error. Without --art the title stays as it is.
      --derived-from carries the card number of the nearest ancestor to the board
      (Issue #356). Only kanbancompat evaluates it; the other trackers accept it
      without effect. It cannot be added later — it only works on creation.
      --idempotency-key repeats a call whose outcome stayed unclear without running
      it a second time (Issue #834). Without the switch the key is made per call; the
      error message names it together with the command.
      If the body has a section '## Dependencies', the output carries its 'hinweise'
      as with 'check-form' (Issue #1060); they do not affect the creation.
      A requirement (--art requirement or its title prefix) without a complete
      scenario fails gate F12 as with 'check-form --body-file': nothing is created,
      the message names what is missing, exit 1 (Issue #1590).
  node board.mjs issue get <id>
  node board.mjs issue activity <id>      activity history (local, toolbox)
  node board.mjs issue activity --ids <n,n,...>
      History of several cards as an object {"<number>": [...]}. Resolves the card
      list exactly once; an unknown number appears with its error reason (Issue #786).
  node board.mjs issue list [--status <status>]
  node board.mjs issue move <id> <status>
  node board.mjs issue update <id> --body "..." | --body-file <path> | --body -
      Output { ok, id }, plus 'hinweise' on the section '## Dependencies' as with
      'issue create' (Issue #1060).
  node board.mjs issue comment <id> --text "..." | --text-file <path> | --text -
                             [--idempotency-key <value>]
      '-' reads from stdin, good for short texts; for long ones '--text-file' (Issue #584).
      --idempotency-key as with 'issue create' (Issue #834).
  node board.mjs issue report <id> --text '<report>' | --text-file <path>
  node board.mjs issue report <id> --part <n> --text '<piece>'
  node board.mjs issue report <id>
      Files the completion report and then moves the card to In review (Issue #1022).
      The report gets a run stamp line as its last line (the card's latest move to
      in_progress from .claude/bewegungen.tsv). Idempotent per run: same content ->
      nothing written, changed -> replaced, reports of other runs stay. A ' in the
      report is written in the shell as '\\''.
      --part <n> only writes piece n to .claude/berichte/<id>.<n>.md (no board); the
      call without --text joins the pieces in numeric order, completes and only then
      clears them. If it fails, the retry is the same call.
      Output: { ok, id, bericht: angelegt|ersetzt|unveraendert, status: in_review }.
  node board.mjs issue run-state <id> --state running|aborted|waiting|done --text-file <path>
      Run status of a card in one go (Issue #1083): sets the label of the state and
      removes the other two (done: all three), plus exactly one run status
      comment, replaced on every call. The label names come from
      night.stand.labels in the config. Comments are read strictly; unreadable ->
      exit 1, nothing written. Output: { ok, id, zustand, kommentar: angelegt|ersetzt|unveraendert }.
  node board.mjs issue brief <id> [--column ready|in_progress] [--json]
      Everything an implementation needs before it starts, in one call (Issue #1023):
      verdict (may start | may not start) with consequence (beginnen | bleibt |
      backlog with the literal comment text | geschuetzt: the package names a
      protected file and is not released — backlog, label add kit:protected, then
      the halt comment from issue check-protected plus label line; the label
      kit:protected itself results in backlog, Issue #1052), task (title, body,
      labels, column, comments), plan decisions verbatim (selection from the line
      'Plan-Decisions:', without it all of them), business reason (goal and business
      acceptance criteria of the 'Requirement:'), siblings of the plan with column
      (Issue #1024) and prerequisites from '## Dependencies' (met from In review on).
      What cannot be determined is listed under gaps. Read-only. --column in_progress
      expects the card in In progress instead of Ready.
      Output: Markdown with seven '##' parts -- the only exception to JSON on stdout;
      --json returns the same parts as fields. Exit 0 also on 'may not start', exit 1
      only if the package is not readable.
  node board.mjs issue origin <plan>
      State of the origin documents of a plan (Issue #1285, Plan #1283): done means at
      least one package ('Plan: Issue #M') is in In review or Done and none in Backlog,
      Ready or In progress. Per document (plan, requirement from 'Requirement:') the
      action wandert | lag bereits in In review | lag bereits in Done | bleibt, with a
      reason. Read-only, moves nothing. Output: { plan, durch, grund, fehlend: [{ id,
      titel, spalte }], dokumente: [{ id, art, spalte, aktion, grund }] }.
  node board.mjs issue history [--terms <term>]... [--files <path>]... [--without <number>]... [--bodies]
      Earlier requirements of the own board, archived ones included (Issue #1539, Plan
      #1534): per term via the search (only titles with [Requirement]), per file via the
      card numbers of the last 30 commits and their lineage. Merged by number, ordered by
      the number of matched terms, then number descending, at most 20. Output: { ok,
      suchbegriffe, dateien, treffer: [{ nummer, titel, archiviert, weg, auszug }],
      weitere }; --bodies adds the body of each hit. Without archive { ok: false, grund:
      archiv-nicht-erreichbar | tracker-ohne-suche | abgeschaltet }, exit 0 even then; the
      first failure at the board ends the search.
  node board.mjs issue questions <id> [--body-file <path>] [--compare <path>]
      Grooming state of a requirement for /groom (Issue #1513, Plan #1510): einstieg
      ({ start, grund, meldung }), fragen ({ vermerk, fragen, ungegliedert, offen }),
      stoppKommentar (only with kit:clarify: { kommentar, grund }, otherwise null) and
      vermerkVorschlag (the note 'Keine' with today's date, only without an open
      question). --body-file checks a new body against the card's (pruefung: { ok,
      verstoesse }), exit 1 on violations. --compare lists the changed criteria and
      non-goals between the file and the card's body (aenderungen).
      Read-only: changes neither body nor labels.
  node board.mjs issue label add <id> <name>
  node board.mjs issue label remove <id> <name>
      Marks an issue (e.g. kit:clarify). Status labels are changed by \`issue move\`.
  node board.mjs issue check-form <id> [--art requirement|plan|idea|human|task]
  node board.mjs issue check-form --body-file <path> --title "<titel>" [--art ...]
      Form check against the machine gates of the stage (Issue #628): requirement
      F1 F2 F6 F7 F9 F11 F12, plan P1 P2 P3 P6 P12, work package I1 to I9. The stage comes
      from the title prefix, with --art from the kind as with 'issue create'
      (Issue #1427); --art next to a title with a prefix rejects the call. I7 to I9
      (Issue #1044): '## Task' names a file as a backtick path, no named file is
      protected (locks from the settings of the project root), '## Task' does not name
      the installed copy; a [Human] package passes all three. Always JSON ({ ok, stufe,
      verstoesse }), exit 1 on violations; a rejected call carries 'fehler'. Never
      writes to the board.
      F12 (Issue #1590): the section '## Scenarios' stands between the acceptance
      criteria and the non-goals and holds at least one complete scenario. It applies
      to --body-file always, to <id> only from 'scenariosFrom' on; without that field
      a hint { art: "szenarien-stichtag", meldung } instead.
      For [Plan] additionally 'hinweise' ([{ baustein, test, meldung }], Issue #1031):
      own tests of listed building blocks that the plan does not name, by the
      locations from 'testAblagen' against 'git ls-files'; they affect neither ok nor
      the exit code.
      For a work package 'hinweise' on the section '## Dependencies' ([{ art, nummer,
      stelle, meldung }], Issue #1060): 'schreibweise' per #N outside a reference line
      ('Issue #N' at the start of the line), 'dokument' per #N to a [Plan], [Requirement]
      or [Idea] card. The night run reads both as a dependency; they too affect neither
      ok nor the exit code. A card that cannot be looked up stays silent.
  node board.mjs issue check-protected <id> [--path <path>]
      Protected files of a package (Issue #1045, Plan #987): hits from task and
      acceptance criteria against the locks of the project root; --path (also
      repeated, Issue #1053) adds a path rejected on writing, if it is protected, with
      the line 'beim Schreiben abgewiesen' — for the fallback halt when the task does
      not name it. Plus the label kit:protected and the release — a halt comment
      '## Geschuetzte Datei' with the line 'Label kit:protected gesetzt', the label
      removed and every hit named there. Output: { ok, treffer, label, freigegeben,
      handlung, kommentar }; 'kommentar' is the halt text without the label line.
      Exit 1 on ok false, also for a label without hits. Read-only.
  node board.mjs code repo-name
  node board.mjs code pr --from <branch> --to <branch>
  node board.mjs code ci-status --commit <sha>
      State of the CI for exactly this commit (Issue #316):
      { status: gruen|rot|laeuft|keine, jobs: [{ name, ergebnis, gestartet }] }.
      Precedence rot over laeuft over gruen; 'keine' only with codeHost local, a run
      not yet visible at the host is 'laeuft'. 'gestartet' is the start time of the
      job (ISO) or null as long as it has not started (Issue #1151).
  node board.mjs code protection status
  node board.mjs code protection setup --branch <b>
  node board.mjs code protection suspend --in <path>
  node board.mjs code protection restore
  node board.mjs code protection verify [--branch <b>]
      Protection of main and publishing branch by ruleset (Issue #1408).
      status: { geschuetzt, fehlt, ungeprueft }, exit 0 also on geschuetzt false.
      setup: probe — the head of origin/<mainBranch> goes to the check branch
      (default pushPruefung.zweig, otherwise kit-pruefung; an existing one aborts),
      waits in 30 s steps up to 5 min for the run and 60 min for its completion,
      branch deleted afterwards. Result scharf | offen | anleitung | nicht moeglich.
      suspend: emergency path, only after a green run of stage push in the worktree
      <path>; sets the ruleset of the main branch to disabled. restore: active again,
      if it fails exit 1 with the command to repeat. verify: head again to the check
      branch, result of the build service. setup, suspend, verify are locked with
      KIT_AGENT_MODEL.
  node board.mjs context paths [--project <name>] [--date YYYY-MM-DD]
  node board.mjs context last-log [--project <name>] [--before YYYY-MM-DD]
  node board.mjs issue-review reviewers --author <model>
  node board.mjs issue-review check [--path-only]
      The read boundary per reviewer; kind command without it is not available
      ('keine Lesegrenze'). 'rollen' names the missing role files of all stages.
  node board.mjs issue-review matrix
  node board.mjs issue-review roles --stage <requirement|plan|issue> --author <model>
      'rollenDateien' names pfad and rolleVorhanden per role.
      Cast and roles of the stage from reviewStufen; the author drops out.
      With --stage plan, KIT_PLAN_REVIEWER (1 or 2) sets the reviewer count ahead of reviewStufen.
  node board.mjs issue-review review-brief --role <role> --file <target> (--id <N> | --material-file <path>)
      Review brief for a reviewer, not the implementation brief of 'issue brief <id>'.
      Puts kit/rollen/<role>.md with the list of kinds and the document (--id: from
      the board, with 'Requirement:' and 'Template:') or material (--material-file;
      for code-review with .claude/checks-summary.json) into the file --file. Output
      { ok, rolle, datei, zeichen }; errors (exit 1) rolle-fehlt with pfad,
      platzhalter-offen, material-fehlt, dokument-nicht-lesbar.
  node board.mjs issue-review start --reviewer <name> | --code-review --brief <file> --output <file>
      Starts an outside reviewer (kind command; --code-review: reviewCommand) without
      a shell: brief via stdin, stdout into --output. The read boundary is the last
      argument — from lesegrenze or reviewLesegrenze, otherwise from the table (codex:
      --sandbox read-only). Needs 'node .claude/kit/board.mjs*' in
      sandbox.excludedCommands. Output { ok, reviewer, lesegrenze, ausgabe, zeichen };
      errors (exit 1) keine-lesegrenze, lesegrenze-aufgehoben with schalter
      (--full-auto, --dangerously-bypass-approvals-and-sandbox, --sandbox/-s except
      read-only, -c sandbox_mode, --profile/-p), auftrag-fehlt, nicht-im-path, ausfall
      with exit and an excerpt of stderr.
  node board.mjs nightrun report --file <result.json>
      Delivers a result state of the night runner to POST /api/kanban/night-runs
      (issueTracker toolbox only); the same run is replaced on every report. If the
      state carries a preparation of the release, the report carries
      releasePreparation; if the board rejects it with HTTP 400, the command reports
      exactly once more without the field and notes the fallback in the answer
      ('rueckfall').
  node board.mjs session report [--transcript <path>] [--complete]
      Reports the usage of the running interactive session to the same route
      (kind/mode INTERACTIVE, Issue #734), split by the waypoints from
      .claude/wegmarken.tsv. Without --transcript the path comes as 'transcript_path'
      from the hook body on stdin. --complete reports the end of the session and
      clears the waypoints; without the flag it reports at most every five minutes.
      Stays silent without error when KIT_AGENT_MODEL is set (the night runner
      reports itself) and without a toolbox token.
  node board.mjs hook bash-check
      PreToolUse hook for Bash (Issue #995): reads the hook body of Claude Code on
      stdin and rejects with exit 2 when a pipe, redirection or a further command
      takes the exception away from a command in sandbox.excludedCommands. Patterns
      from .claude/settings.json and .claude/settings.local.json.

  node board.mjs scenarios baseline
      The cut-off for the scenario duty (Issue #1591, Plan #1588 E3): lists every
      card without a status once and prints { ab: <highest number + 1> }, numeric
      also for the padded numbers of the local tracker. Writes nothing; the
      installer enters the value as 'scenariosFrom' when the field is missing.

  node board.mjs names
      The fixed lines of the skills in the project language (Issue #1558, Plan #1548):
      headings, markers, review and incorporation heads. Output: { language, lines:
      { "<German line>": "<line in the project language>" } } from the registers
      MARKER and UEBERSCHRIFTEN; a heading is listed with '## ' in front. Read-only.

  node board.mjs --version

Valid status values: backlog | ready | in_progress | in_review | done

Configuration: .claude/workflow.config.json (issueTracker, codeHost)
For the context axis additionally: ~/.claude/kontext.config.json and
.claude/kontext.config.json (merged, local fields win).
For GitHub board integration: set github.projectNumber in the config. If it is
missing and the owner has exactly one GitHub Project, its number is used.
`;

// Die Texttabelle liegt im Teil texte/ (Issue #1524) und laedt mit den uebrigen Teilen weiter
// unten. Die Hilfe steht nicht darin: Sie antwortet, bevor ein Teil geladen ist.

// Auskunft vor den Teilen (Plan #1199, E2): --version und --help antworten, bevor ein Teil
// geladen ist. Nur so beantwortet board.mjs sie auch als einzeln kopierte Datei, ohne
// kit/board/ daneben (Issue #170) — und genau dort fragt man danach.
const runAsCli = alsCliGestartet();
if (runAsCli) auskunftOhneTeile(process.argv.slice(2));

// Die Teile, mit literalem dynamischem Import und nie als `export { … } from`: Das liesse den
// Teil vor der ersten Codezeile laden. Was bisher exportiert war, bleibt unter demselben
// Namen exportiert.
export const { VALID_STATUSES, COLUMN_DEFAULTS, columnLabels, isStateColumn, exec, execJSON,
  gitRemoteUrl, normalizeRepoName, RUECKMELDUNG, BoardError, fail, out, sleep,
  mergeWorkflowConfig, configWurzel, readWorkflowConfig, loadConfig, labelNamesFrom,
  labelMapFrom, withLabels, normalizeComments, createdFrom, labelToStatus, findeImPath,
  umgebungsWert } = await import("./board/grundlagen.mjs");
export const { TOOLBOX_UEBERLAST_TYPE, TOOLBOX_BUDGET_NACHT_MS, toolboxBudgetMs, toolboxVersuchMs,
  proxyNeustartNoetig, proxyGesetzt, PROXY_HINWEIS, netzfehlerArt, darfWiederholen, rueckmeldungFuer,
  wartezeitMs, VERLAUF_GLEICHZEITIG, hoechstensGleichzeitig, wiederholKommando } = await import("./board/wiederholung.mjs");
export const { nurAutorZeileTrifft, resolveToolboxToken, interpretToolboxCreateResponse, agentModelHeader,
  nightRunHeader, ToolboxIssueTracker, resolveTracker } = await import("./board/adapter.mjs");
// Dispatch braucht dazu die Auswahl des Code-Hosts; der Einstieg exportierte sie nie und tut es
// weiter nicht.
const { resolveCodeHost } = await import("./board/adapter.mjs");
export const { mergeKontextConfig, resolveKontextPaths, pickNoteFile, pickLatestLog, AUTOR_MODELL_ZEILE,
  autorModellSicherstellen, FACHLICH_PRAEFIX, PLAN_PRAEFIX, IDEE_PRAEFIX, MENSCH_PRAEFIX, istFachlich, istPlan,
  istIdee, istMensch, FENCE_ZEILE, fenceLauf, kontextGrenzen, leseTextQuelle, kitStandZeileFuer,
  STAND_LABEL_VORGABEN, AUFTRAG_BACKLOG_TEXTE, abhaengigkeitenLesen, abhaengigkeitenMitHerkunft,
  abhaengigkeitsHinweise, ABSCHNITT_ZEILE } = await import("./board/dokumente.mjs");
// Die Handler der issue-Befehle, die Kontext-Achse und die Abschnittszerlegung braucht der
// Einstieg fuer Dispatch und Formpruefung; exportiert waren sie nie und bleiben es nicht.
const { KONTEXT_DEFAULTS, loadKontextConfig, kontextRepoName, heute, issueCreate,
  issueGet, issueList, issueEpics, issueActivity, issueMove, issueLabel,
  issueComment, issueMelden, issueStand, issueAuftrag, issueUrsprung, issueUpdate, checkFormWege,
  titelMitArt } = await import("./board/dokumente.mjs");
export const { GESCHUETZTE_PFADE, KOPIE_PFADE, geschuetztePfade, trifftGeschuetzt, pfadTokens, tokenFormen,
  geschuetzteTreffer, GESCHUETZT_ANKER, GESCHUETZT_LABEL, GESCHUETZT_LABEL_GESETZT, GESCHUETZT_LABEL_NICHT_GESETZT,
  GESCHUETZT_ABGEWIESEN, abgewieseneTreffer, geschuetztKommentar, geschuetztFreigabe } = await import("./board/geschuetzt.mjs");
// Erkennt ein Label unter jedem seiner Namen (Issue #1424); exportiert war es nie.
const { traegtLabel } = await import("./board/geschuetzt.mjs");
export const { TEST_ABLAGEN_VORGABE, testAblagen, ablageAlsAusdruck, nennungsVerzeichnis, genannteDateien,
  pruefeTestNennung, pruefeForm } = await import("./board/testhinweise.mjs");
// Den Bestand fuer `issue check-form` braucht nur der Einstieg; exportiert war er nie.
const { versionierteDateien } = await import("./board/testhinweise.mjs");
// Ob eine Karte die Szenarien-Pflicht traegt, braucht nur `issue check-form` (Issue #1590).
const { szenarienPflicht } = await import("./board/szenarien.mjs");
export const { pickReviewers, kommandoVerfuegbar, stufeAusTitel } = await import("./board/issue-review.mjs");
// Den Befehlsverteiler der Achse braucht nur Dispatch; exportiert war er nie.
const { dispatchIssueReview } = await import("./board/issue-review.mjs");
export const { nachtlaufAbbruchGrund, nachtlaufMeldung, sitzungProtokoll, wegmarkenAbschnitte,
  sitzungMeldung } = await import("./board/melder.mjs");
// Die Befehlsverteiler der beiden Melder braucht nur Dispatch; exportiert waren sie nie.
const { dispatchNightrun, dispatchSitzung } = await import("./board/melder.mjs");
export const { pruefeBashZeile, pruefeHintergrund } = await import("./board/hook.mjs");
// Den Befehlsverteiler des Hooks braucht nur Dispatch; exportiert war er nie.
const { dispatchHook } = await import("./board/hook.mjs");
export const { SCHUTZ_AUSGESETZT, NACHPRUEFEN_KOMMANDO, NACHT_GESPERRT, rulesetSoll, schutzZustand, anleitung,
  notfallGate, nachtSperre, probe, einrichten, nachpruefen } = await import("./board/schutz.mjs");
// Den Namen eines Rulesets braucht nur `code schutz aussetzen|wiederherstellen`; exportiert war er nie.
const { rulesetName } = await import("./board/adapter.mjs");
// `issue vorgeschichte` (Issue #1539); exportiert war es nie.
const { issueVorgeschichte } = await import("./board/vorgeschichte.mjs");
// Englisch benannte Config auf die deutschen Namen (Issue #1436, Plan #1420 E10).
const { normalisiereConfig } = await import("./board/config-namen.mjs");
// Die Meldung zu einem frueheren deutschen Namen (Issue #1557, Plan #1548).
const { altnameHinweis, EINGABEWERTE, text, projektSprache, festeZeilen } = await import("./board/namen.mjs");
// Die Texte des Einstiegs an den Menschen (Issue #1524: im Teil texte/).
export const { TEXTE } = await import("./texte/board.mjs");

/** Ein Text des Einstiegs in der Projektsprache (Issue #1477, E13). */
const t = (schluessel, werte) => text(TEXTE, schluessel, werte);
/** Die Achsen von board.mjs, englisch wie jeder Name, den das Kommando annimmt (Issue #1557). */
const ACHSEN = ["issue", "code", "context", "issue-review", "nightrun", "session", "hook", "scenarios", "names"];
/**
 * Bricht mit einer Meldung ab wie `fail` aus den Grundlagen, das Praefix in der Projektsprache.
 * `fail` selbst stellen die Grundlagen um (Issue #1483).
 */
function abbruch(meldung) {
  process.stderr.write(`${t("fehler")}: ${meldung}\n`);
  process.exit(1);
}
/** Weist einen unbekannten Befehl einer Achse ab, nach der Hilfe. */
function unbekannterBefehl(achse, befehl) {
  process.stdout.write(HELP);
  abbruch(t("unbekannterBefehl", { achse, befehl }));
}

// --- Argument-Parser ---

function parseArgs(argv) {
  const result = { _: [] };
  // Alle Werte einer mehrfach genannten Option (`--path a --path b`); `result[key]` traegt
  // weiter den letzten. Nicht aufzaehlbar, damit es kein Optionsname werden kann.
  const werte = {};
  Object.defineProperty(result, "werte", { value: werte, enumerable: false });
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        werte[key] = [...(werte[key] ?? []), next];
        i += 1;  // der Wert gehoert zur Option
      } else {
        result[key] = true;
      }
    } else {
      result._.push(a);
    }
    i += 1;
  }
  return result;
}

// ============================================================
// Dispatch
// ============================================================

// Ein Handler je issue-Subbefehl: haelt die Argument-Validierung flach (auf Funktionsebene
// statt tief in verschachtelten switch-cases) und damit die kognitive Komplexitaet niedrig.

/** Weist einen Aufruf ab — mit JSON auf stdout, damit ein Aufrufer die Abweisung lesen kann. */
function checkFormAbweisen(meldung) {
  out({ ok: false, stufe: null, verstoesse: [], fehler: meldung });
  process.stderr.write(`${t("fehler")}: ${meldung}\n`);
  process.exit(1);
}

/** Der Datei-Weg: Body aus --body-file, Titel aus --title. */
function checkFormAusDatei(datei, titel) {
  if (datei === true || datei === "") checkFormAbweisen(t("checkFormOhnePfad", { wege: checkFormWege() }));
  if (typeof titel !== "string" || titel.trim() === "") {
    checkFormAbweisen(t("checkFormOhneTitel", { wege: checkFormWege() }));
  }
  try {
    return { body: readFileSync(datei, "utf-8"), title: titel };
  } catch (e) {
    return checkFormAbweisen(t("checkFormUnlesbar", { datei, grund: e.code || e.message, wege: checkFormWege() }));
  }
}

/** Der Board-Weg: Body und Titel der Karte; eine unbekannte Nummer weist den Aufruf ab. */
async function checkFormVomBoard(tracker, id) {
  try {
    const issue = await tracker.getIssue(String(id));
    return { body: issue.body || "", title: issue.title || "" };
  } catch (e) {
    if (e instanceof BoardError && /HTTP 404|nicht gefunden|not found/i.test(e.message)) return checkFormAbweisen(e.message);
    throw e;
  }
}

async function issueCheckForm(tracker, config, args) {
  const id = args._[0];
  const hatDatei = args["body-file"] !== undefined;
  if (id !== undefined && hatDatei) checkFormAbweisen(t("checkFormBeides", { wege: checkFormWege() }));
  if (id === undefined && !hatDatei) checkFormAbweisen(t("checkFormNichts", { wege: checkFormWege() }));

  const eingabe = hatDatei ? checkFormAusDatei(args["body-file"], args.title) : await checkFormVomBoard(tracker, id);
  const body = eingabe.body;
  // --art waehlt die Stufe ueber den Titel, wie `issue create` ihn anlegt (Issue #1427, E6).
  const { titel: title, fehler } = titelMitArt(eingabe.title, args.art);
  if (fehler) checkFormAbweisen(t("checkFormArt", { fehler, wege: checkFormWege() }));
  const dateien = stufeAusTitel(title) === "plan" ? versionierteDateien() : [];
  // F12: eine Datei ist ein neuer Fachplan, eine Karte erst ab dem Stichtag (Issue #1590, A4, A6).
  const szenarien = hatDatei ? true : szenarienPflicht(id, config);
  const ergebnis = pruefeForm(body, title, config, dateien, configWurzel(), { szenarien });
  if (ergebnis.stufe === "issue") {
    const hinweise = await abhaengigkeitsHinweise(body, tracker);
    if (hinweise.length > 0) ergebnis.hinweise = hinweise;
  }
  out(ergebnis);
  if (!ergebnis.ok) process.exit(1);
}

/**
 * `issue check-geschuetzt <id> [--pfad <pfad>]...` (Issue #1045, Plan #987, E6): Treffer, Label,
 * Freigabe und Halt-Kommentar eines Pakets — die eine Quelle fuer Runner, Auftrag und Skills.
 * `--pfad` nimmt einen beim Schreiben abgewiesenen Pfad mit auf (Issue #1053, E13). Rein lesend.
 * Ein Label ohne Treffer ist ein Befund (Karte aus dem Rueckfall-Halt): Der Runner
 * ueberspringt sie, das Kommando gibt dieselbe Auskunft.
 */
async function issueCheckGeschuetzt(tracker, args) {
  const id = args._[0];
  if (id === undefined) abbruch(t("checkGeschuetztOhneId", { befehl: "issue check-protected" }));
  const issue = await tracker.getIssue(String(id));
  const kommentare = await tracker.kommentareStreng(String(id));
  const labels = issue.labels || [];
  const treffer = [
    ...geschuetzteTreffer(issue.body || "", issue.title || "", configWurzel()),
    ...abgewieseneTreffer(args.werte?.path ?? [], configWurzel()),
  ];
  const label = traegtLabel(labels, "geschuetzt");
  const freigegeben = geschuetztFreigabe(treffer, kommentare, labels);
  const ok = freigegeben || (treffer.length === 0 && !label);
  out({ ok, treffer, label, freigegeben, handlung: geschuetztHandlung(treffer, label, freigegeben), kommentar: treffer.length > 0 ? geschuetztKommentar(treffer) : null });
  if (!ok) process.exit(1);
}

/** Der Satz fuer den Menschen zum Ergebnis von `issue check-geschuetzt`. */
function geschuetztHandlung(treffer, label, freigegeben) {
  if (freigegeben) return t("handlungFreigegeben");
  if (treffer.length === 0 && !label) return t("handlungKeineDatei");
  if (treffer.length === 0) return t("handlungNurLabel", { label: GESCHUETZT_LABEL });
  const pfade = [...new Set(treffer.map((e) => e.pfad))].join(", ");
  if (label) return t("handlungMitLabel", { pfade, label: GESCHUETZT_LABEL });
  return t("handlungAnhalten", { pfade });
}

/**
 * `issue questions <id> [--body-file <pfad>] [--compare <pfad>]` (Issue #1513, Plan #1510 A2,
 * A3, A4, E9), englisch `issue questions` mit `--compare` (Issue #1555, Plan #1548 E8): der
 * Grooming-Stand eines Fachplans fuer `/groom`. Rein lesend — geschrieben
 * wird ueber `issue update --body-file` (A3), Labels bleiben unberuehrt (A4). Die Kommentare
 * liest der Aufruf nur bei `kit:klaeren`: Nur dort gibt es eine Stopp-Frage. Exit 1 allein,
 * wenn `--body-file` gegen den Body der Karte verstoesst.
 */
async function issueFragen(tracker, args) {
  const id = args._[0];
  if (id === undefined) abbruch(t("fragenOhneId"));
  const { groomEinstieg, fragenLesen, stoppKommentar, vermerkZeile, koerperPruefen, kriterienVergleich } =
    await import("./board/grooming.mjs");
  const neu = optionDatei(args, "body-file");
  const start = optionDatei(args, "compare");
  const issue = await tracker.getIssue(String(id));
  const body = issue.body || "";
  const fragen = fragenLesen(body);
  const klaeren = traegtLabel(issue.labels, "klaeren");
  const ausgabe = {
    einstieg: groomEinstieg({ ...issue, id: String(id) }, process.env),
    fragen,
    stoppKommentar: klaeren ? stoppKommentar(await kartenKommentare(tracker, String(id), issue)) : null,
    vermerkVorschlag: fragen.offen === 0 && fragen.fragen.length > 0 ? vermerkZeile(fragen.fragen.length, heute()) : null,
  };
  if (neu !== null) ausgabe.pruefung = koerperPruefen(body, neu);
  if (start !== null) ausgabe.aenderungen = kriterienVergleich(start, body);
  out(ausgabe);
  if (ausgabe.pruefung && !ausgabe.pruefung.ok) process.exit(1);
}

/** Die Kommentare einer Karte: mit der Karte geliefert, sonst streng vom Tracker gelesen. */
async function kartenKommentare(tracker, id, issue) {
  if (Array.isArray(issue.comments)) return issue.comments;
  return tracker.kommentareStreng(id);
}

/** Der Inhalt der Datei hinter `--<name> <pfad>`, null ohne die Option. */
function optionDatei(args, name) {
  if (args[name] === undefined) return null;
  if (args[name] === true) abbruch(t("optionOhneWert", { option: name }));
  try {
    return readFileSync(args[name], "utf-8");
  } catch (e) {
    return abbruch(t("optionDateiUnlesbar", { option: name, datei: args[name], grund: e.code || e.message }));
  }
}

// Was das Urteil von `issue auftrag` aus dem Abschnitt "Geschuetzte Pfade" braucht. Der Teil
// dokumente importiert nie aus dem Einstieg; der Einstieg reicht es ihm herein (Issue #1218).
const AUFTRAG_GESCHUETZT = Object.freeze({ geschuetzteTreffer, geschuetztFreigabe, geschuetztKommentar,
  GESCHUETZT_LABEL, GESCHUETZT_LABEL_GESETZT, GESCHUETZT_LABEL_NICHT_GESETZT });

async function dispatchIssue(command, args) {
  const config = loadConfig();
  const tracker = resolveTracker(config);
  switch (command) {
    case "create":  return issueCreate(tracker, args);
    case "get":     return issueGet(tracker, args);
    case "list":    return issueList(tracker, args);
    case "epics":   return issueEpics(tracker);
    case "activity": return issueActivity(tracker, config, args);
    case "move":    return issueMove(tracker, args);
    case "update":  return issueUpdate(tracker, args);
    case "comment": return issueComment(tracker, args);
    case "report":  return issueMelden(tracker, args);
    case "run-state": return issueStand(tracker, config, args);
    case "brief":   return issueAuftrag(tracker, args, AUFTRAG_GESCHUETZT);
    case "origin":  return issueUrsprung(tracker, args);
    case "questions": return issueFragen(tracker, args);
    case "label":   return issueLabel(tracker, config, args, HELP);
    case "check-form": return issueCheckForm(tracker, config, args);
    case "check-protected": return issueCheckGeschuetzt(tracker, args);
    case "history": return issueVorgeschichte(tracker, config, args, HELP);
    default:
      unbekannterBefehl("issue", command);
  }
}

async function codeRepoName(host) {
  out({ repoName: await host.getRepoName() });
}

async function codePr(host, args) {
  if (!args.from) abbruch(t("optionErforderlich", { option: "from" }));
  if (!args.to) abbruch(t("optionErforderlich", { option: "to" }));
  if (!host.supportsPullRequests()) {
    abbruch(t("keinePullRequests"));
  }
  out(await host.createPullRequest({ from: args.from, to: args.to, title: args.title }));
}

async function codeCiStatus(host, args) {
  if (args.commit === undefined) abbruch(t("optionErforderlich", { option: "commit" }));
  if (args.commit === true) abbruch(t("optionOhneWert", { option: "commit" }));
  out(await host.getCiStatus(String(args.commit)));
}

const SCHUTZ_AKTIONEN = ["status", "setup", "suspend", "restore", "verify"];
const WIEDERHERSTELLEN_KOMMANDO = "node .claude/kit/board.mjs code protection restore";

/** Der Pruefzweig der Probe (E5): `--branch`, sonst `pushPruefung.zweig`, sonst `kit-pruefung`. */
function schutzZweig(config, args) {
  if (args.branch === true) abbruch(t("optionOhneWert", { option: "branch" }));
  return args.branch || config.pushPruefung?.zweig || "kit-pruefung";
}

/** Aussetzen und Wiederherstellen brauchen einen Code-Host mit Schutz. */
function schutzVerlangen(host) {
  const unterstuetzt = typeof host.schutzUnterstuetzt === "function"
    ? host.schutzUnterstuetzt()
    : { ja: false, grund: t("keinSchutz") };
  if (!unterstuetzt.ja) abbruch(unterstuetzt.grund);
}

/**
 * `code protection <aktion>` (Issue #1408, Plan #1405, A10). `setup`, `suspend` und `verify`
 * pushen oder aendern den Code-Host und laufen darum durch die Nacht-Sperre (E8); `status`
 * und `restore` nicht.
 */
async function codeSchutz(host, config, args) {
  const aktion = args._[0];
  if (!SCHUTZ_AKTIONEN.includes(aktion)) {
    process.stdout.write(HELP);
    abbruch(t("unbekannteSchutzAktion", {
      schutz: "protection",
      aktion: aktion ?? "",
      erwartet: SCHUTZ_AKTIONEN.join(" | "),
    }));
  }
  nachtSperre(aktion);
  const mainBranch = config.mainBranch || "main";
  switch (aktion) {
    case "status": return out(await schutzZustand(host, config));
    case "setup":  return out(await einrichten(host, config, schutzZweig(config, args)));
    case "verify": return out(await nachpruefen(host, config, schutzZweig(config, args)));
    case "suspend": {
      if (typeof args.in !== "string") abbruch(t("aussetzenOhneIn"));
      schutzVerlangen(host);
      const gate = await notfallGate(args.in);
      if (!gate.ok) abbruch(t("notfallVerweigert", { grund: gate.grund }));
      return out(await host.setRulesetEnforcement(rulesetName(mainBranch), "disabled"));
    }
    default: {
      schutzVerlangen(host);
      try {
        return out(await host.setRulesetEnforcement(rulesetName(mainBranch), "active"));
      } catch (e) {
        // E10: Der Schutz bleibt ausgesetzt, bis dieser Aufruf gelingt — `status` nennt es.
        abbruch(t("wiederherstellenGescheitert", { grund: e.message, kommando: WIEDERHERSTELLEN_KOMMANDO }));
      }
    }
  }
}

async function dispatchCode(command, args) {
  const config = loadConfig();
  const host = resolveCodeHost(config);
  switch (command) {
    case "repo-name": return codeRepoName(host);
    case "pr":        return codePr(host, args);
    case "ci-status": return codeCiStatus(host, args);
    case "protection": return codeSchutz(host, config, args);
    default:
      unbekannterBefehl("code", command);
  }
}

// Ein Flag ohne Wert wird von parseArgs zu true. Fuer --project/--date waere das ein
// stiller Fehlgriff (falscher Projektname, heutiges statt gemeintem Datum) — deshalb
// Abbruch mit Meldung statt Rueckfall auf den Default.
function kontextOption(args, name) {
  if (args[name] === true) abbruch(t("optionOhneWert", { option: name }));
  return args[name];
}

/**
 * Liest die Dateinamen eines Notizordners (Issue #286).
 *
 * Ein fehlender Ordner ist der Normalfall der Erstanlage und liefert []. Jeder
 * ANDERE Fehler — der Pfad ist eine Datei, das Verzeichnis ist nicht lesbar —
 * bricht ab: Ihn wie einen leeren Ordner zu behandeln hiesse, still auf den
 * konstruierten Namen zurueckzufallen und genau die zweite Notiz anzulegen, die
 * dieses Issue verhindert.
 */
function leseNotizOrdner(ordner) {
  try {
    return readdirSync(ordner);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    abbruch(t("notizordnerUnlesbar", { ordner, grund: e.code || e.message }));
  }
}

// Macht aus einer Mehrdeutigkeit einen Abbruch. Ein stiller Griff ins Ungewisse
// waere genau der Fehler, den Issue #286 behebt — deshalb Exit 1 mit beiden Namen,
// statt eine der beiden Dateien zu raten.
export function waehleNotiz(dateien, notizName, ordner, alleinstehend) {
  const { name, kollision } = pickNoteFile(dateien, notizName, { alleinstehend });
  if (kollision) {
    abbruch(t("notizMehrdeutig", { ordner, dateien: kollision.join(", ") }));
  }
  return name;
}

// Praezedenz des Projektnamens: --project > cfg.project > Repo-Name > basename(cwd).
//
// Der Dateisystem-Zugriff liegt hier und nicht in resolveKontextPaths: Die Funktion
// traegt den Vertrag "rein, ohne Dateisystem" und bleibt damit ohne vorhandenen
// Vault aufrufbar — dieselbe Naht wie bei pickLatestLog/kontextLastLog (Issue #286).
async function kontextPaths(args) {
  const cfg = loadKontextConfig();
  const project = kontextOption(args, "project") || cfg.project || await kontextRepoName();
  const date = kontextOption(args, "date") || heute();
  const basis = resolveKontextPaths({ cfg, project, date });
  if (basis.mode === "degraded") return out(basis);

  // Mit parentProject liegen Dach- und Service-Notiz im selben Ordner; er wird
  // einmal gelesen und beide Namen daraus aufgeloest.
  const parent = basis.parentProject;
  const ordner = join(basis.vault, "Projekte", parent || basis.project);
  const dateien = leseNotizOrdner(ordner);
  out(resolveKontextPaths({
    cfg, project, date,
    projectNoteFile: waehleNotiz(dateien, `${basis.project}.md`, ordner, !parent),
    parentNoteFile: parent ? waehleNotiz(dateien, `${parent}.md`, ordner, false) : null,
  }));
}

// Der juengste vorhandene Log-Eintrag desselben Projekts, als Anknuepfung fuer /document.
// Kein Vault, kein Log-Verzeichnis oder kein Treffer sind alle derselbe Normalfall
// (erster Eintrag eines Projekts) und liefern path: null — kein Fehler.
async function kontextLastLog(args) {
  const cfg = loadKontextConfig();
  if (!cfg.vault) return out({ path: null });

  const project = kontextOption(args, "project") || cfg.project || await kontextRepoName();
  const template = cfg.logPath || KONTEXT_DEFAULTS.logPath;
  const ordner = join(cfg.vault, ...template.split("/").slice(0, -1));

  let dateien;
  try {
    dateien = readdirSync(ordner);
  } catch {
    return out({ path: null });
  }

  const treffer = pickLatestLog(dateien, {
    template,
    project,
    before: kontextOption(args, "before") || heute(),
  });
  out(treffer ? { path: join(ordner, treffer.name), date: treffer.date } : { path: null });
}

async function dispatchKontext(command, args) {
  switch (command) {
    case "paths": return kontextPaths(args);
    case "last-log": return kontextLastLog(args);
    default:
      unbekannterBefehl("context", command);
  }
}

/**
 * `scenarios baseline` (Issue #1591, Plan #1588 E3): die hoechste Nummer aller Karten plus eins.
 * Ein Aufruf ohne Status, damit auch Karten ohne Spalte zaehlen; `Number(id)` macht aus den
 * gepolsterten lokalen Nummern Zahlen. Schreibt nichts — das Feld setzt der Installer.
 */
async function dispatchSzenarien(command) {
  if (command !== "baseline") unbekannterBefehl("scenarios", command);
  const karten = await resolveTracker(loadConfig()).listIssues();
  const nummern = karten.map((k) => Number(k.id)).filter(Number.isFinite);
  out({ ab: Math.max(0, ...nummern) + 1 });
}

/**
 * Weist einen frueheren deutschen Namen ab (Issue #1557, Plan #1548, Entscheidung „Abweisung
 * statt Uebergang“): Achse, Befehl, Aktion von `code protection`, Option oder Auswahlwert von
 * `--art`, `--state` und `--stage`. Exit 1 mit der Meldung, die den englischen Namen nennt —
 * vor jedem Zugriff aufs Board, so bleibt alles unberuehrt.
 */
function altnamenAbweisen(axis, command, rest) {
  const abweisen = (hinweis) => {
    if (hinweis !== null) abbruch(hinweis);
  };
  abweisen(altnameHinweis("achse", axis));
  abweisen(altnameHinweis("befehl", command, axis));
  if (axis === "code" && command === "protection") abweisen(altnameHinweis("schutz", rest[0]));
  rest.forEach((wort, i) => {
    if (!wort.startsWith("--")) return;
    const option = wort.slice(2);
    abweisen(altnameHinweis("option", option));
    if (Object.hasOwn(EINGABEWERTE, option)) abweisen(altnameHinweis("wert", rest[i + 1], option));
  });
}

// Hilfe und --version, beendet den Prozess. Laeuft vor dem Laden der Teile (Plan #1199, E2)
// und vor jedem Config-Zugriff: --version muss auch in einem Projekt ohne
// .claude/workflow.config.json antworten — genau dort fragt man danach.
function auskunftOhneTeile(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv[0] === "--version") {
    process.stdout.write(`board.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
    process.exit(0);
  }
}

/**
 * Spricht der Tracker dieses Projekts selbst ueber fetch (Issue #1259)? Nur der
 * Toolbox-Adapter tut das; GitHub und GitLab gehen ueber ihre CLIs, der lokale Tracker
 * liest Dateien. Gelesen wird allein das Feld aus der geteilten Config, ohne Overrides und
 * Hinweise: Der volle Weg schriebe seine Hinweise sonst vor und nach dem Neustart.
 *
 * Fehlt die Config oder laesst sie sich nicht lesen, bleibt es beim Neustart wie vor
 * #1259 — die sichere Richtung, denn ein unnoetiger Neustart kostet nur Zeit. Der
 * Gewinn: In der Sandbox zahlte jeder Board-Aufruf zwei Prozessstarts, im Lastbeleg mehr
 * als die Haelfte der Zeit einer Ablauf-Pruefung des Nacht-Runners.
 */
function trackerSprichtFetch() {
  try {
    const { config: roh } = normalisiereConfig(JSON.parse(readFileSync(join(configWurzel(), ".claude", "workflow.config.json"), "utf-8")));
    return (roh.issueTracker ?? roh.provider) === "toolbox";
  } catch {
    return true;
  }
}

async function main() {
  const argv = process.argv.slice(2);

  // Hinter einem Proxy (Sandbox von Claude Code) erreicht Nodes fetch das Board nur mit
  // NODE_USE_ENV_PROXY=1 beim Start (Issue #998). Hilfe und --version brauchen kein
  // Netz und sind darum schon beantwortet (auskunftOhneTeile). Ein Tracker ohne fetch
  // braucht den Neustart ebenso wenig (Issue #1259).
  if (proxyNeustartNoetig(process.env) && trackerSprichtFetch()) {
    const kind = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    });
    process.exit(kind.status ?? 1);
  }

  const [axis, command, ...rest] = argv;
  altnamenAbweisen(axis, command, rest);
  const args = parseArgs(rest);

  if (axis === "issue") {
    await dispatchIssue(command, args);
  } else if (axis === "code") {
    await dispatchCode(command, args);
  } else if (axis === "issue-review") {
    await dispatchIssueReview(command, args, HELP);
  } else if (axis === "context") {
    await dispatchKontext(command, args);
  } else if (axis === "nightrun") {
    await dispatchNightrun(command, args, HELP);
  } else if (axis === "session") {
    await dispatchSitzung(command, args, HELP);
  } else if (axis === "hook") {
    await dispatchHook(command, HELP);
  } else if (axis === "scenarios") {
    await dispatchSzenarien(command);
  } else if (axis === "names") {
    // Achse ohne Unterbefehl (Issue #1558): die festen Zeilen in der Projektsprache.
    const language = projektSprache(readWorkflowConfig());
    out({ language, lines: festeZeilen(language) });
  } else {
    process.stdout.write(HELP);
    abbruch(t("unbekannteAchse", { achse: axis, erwartet: ACHSEN.join(" | ") }));
  }
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
// Eine Funktion, weil die Antwort schon am Dateianfang gebraucht wird (auskunftOhneTeile).
function alsCliGestartet() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false; // argv[1] nicht aufloesbar -> kein CLI-Start
  }
}

if (runAsCli) {
  try {
    await main();
  } catch (err) {
    const prefix = t(err instanceof BoardError ? "fehler" : "unerwarteterFehler");
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}

