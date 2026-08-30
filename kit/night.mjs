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
 *   --max <N>          maximale Session-Starts pro Lauf (Default 10)
 *   --model <id>       Modell der Nacht-Sessions (Default claude-opus-5)
 *   --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
 *   --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
 *   --yolo             --dangerously-skip-permissions statt acceptEdits (Warnung!)
 *   --no-checks-ok     Start trotz leerer buildChecks erlauben
 *   --label <name>     verarbeitet nur Ready-Issues mit diesem Label (Default
 *                      kit:nightrun); --label none schaltet den Filter ab (altes
 *                      Verhalten: striktes ready[0])
 *   --verbose          Live-Verlaufsprotokoll: liest den stream-json-Output der
 *                      Session und loggt Tool-Aufrufe und Text-Snippets mit
 *   --review           Review-Modus (Issue #233): laesst BACKLOG-Issues von
 *                      /issue-review pruefen, statt Ready-Issues zu
 *                      implementieren. Exklusiv zur Implementierungsschleife.
 *   --review-label <n> Routing-Label des Review-Modus (Default kit:nightreview)
 *   --stufe <s>        Pruefstufe des Review-Modus: fachlich | plan | issue
 *                      (Default issue), nur mit --review. Genau eine Stufe pro
 *                      Aufruf (Issue #283).
 *   --version          Kit-Stand dieser Datei (greift vor allen Checks)
 *   --help, -h         Usage-Uebersicht (greift vor allen Checks, keine Config noetig)
 *
 * Verhalten bei Fehlschlag einer Runde (Issue nicht in In review):
 *   - Session-Exit != 0 (kein Timeout) -> Infrastruktur-Fehler (Auth, CLI kaputt):
 *     harter Stopp, Issue bleibt unangetastet (kein Kommentar, kein Backlog-Move)
 *   - Working Tree dirty  -> Salvage-Versuch (siehe unten), sonst harter Stopp
 *   - Working Tree sauber -> Issue mit Kommentar zurueck ins Backlog, weiter
 *
 * Salvage (Issue #167): Eine Session, die einen langen Check im Hintergrund
 * startet und ihren Turn beendet, bevor das Ergebnis da ist, verliert es — eine
 * headless -p-Session hat keinen Folge-Turn. Das Board zeigt dann einen
 * Fehlschlag, obwohl die Arbeit fertig ist. Vor dem harten Stopp verifiziert der
 * Runner deshalb die buildChecks selbst (nicht mutationCommand — das ist ein
 * nachgelagerter Check, kein Blocker fuer diese Entscheidung). Sind sie gruen,
 * bekommt genau eine Salvage-Session pro Issue die Chance, den Zwischenstand
 * gegen das Issue zu pruefen, zu committen und das Board zu bewegen. Rote Checks
 * oder eine gescheiterte Salvage-Session -> harter Stopp. Immer an; ein Opt-out-
 * Flag waere in der Praxis wirkungslos, weil man es nachts vergisst.
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
 * Abhaengigkeiten: `## Abhaengigkeiten` muss erfuellt sein (referenzierte #N in
 * In review oder Done), sonst wandert das Issue kommentiert ins Backlog (Kaskade).
 * Nicht implementierbare Issues werden vor dem Session-Start am Titel erkannt und
 * kommentiert ins Backlog gestellt: `[Fachlich]` (PO-Story, wird gegroomt, #146),
 * `[Idee]` (rohe Idee ohne /plan-Zyklus, #192) und `[Plan]` (Plandokument, muss erst
 * per /issues in Arbeitspakete zerlegt werden, #276).
 *
 * Review-Modus (--review, Issue #233): Statt Ready zu implementieren, laesst der
 * Runner BACKLOG-Issues von /issue-review pruefen. Warum der Backlog und nicht
 * Ready: Zwischen Review und Implementierung liegt das GO. Wuerde der Runner ein
 * Ready-Issue erst reviewen und dann implementieren, haette der Mensch sein GO auf
 * einen Text gegeben, der bei der Implementierung nicht mehr gilt — die
 * Verantwortungsschwelle waere umgangen, ohne dass es jemandem auffaellt. Deshalb
 * auch exklusiv: zwei Laeufe an zwei Abenden, mit dem Menschen dazwischen.
 * Der Vorflug prueft hier zusaetzlich die Reviewer-Verfuegbarkeit und die
 * Erreichbarkeit des Trackers (harter Stopp) — und zwar in einer eigenen
 * Vorflug-Session, nicht im Runner-Prozess (Issue #269). Die buildChecks-Pflicht
 * entfaellt (es wird nichts gebaut und nichts committet).
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
 *   NIGHT_SALVAGE     wird der Salvage-Session als Umgebungsvariable gesetzt
 *                     (Wert "1"), damit ein Fake-Hook die beiden Session-Arten
 *                     unterscheiden kann.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
 */
const { fenceLauf } = await import("./board.mjs").catch(() => ({
  fenceLauf: () => {
    throw new Error("board.mjs fehlt neben night.mjs — der Nacht-Runner braucht den Board-Adapter.");
  },
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
// Normalerweise liegt board.mjs neben dieser Datei in .claude/kit/. KIT_ROOT
// verlegt die Suche in ein anderes Projekt und ist ein Test-Hook (Issue #189,
// dasselbe Muster wie in kit/board.mjs und tools/sync-blobs.mjs): Nur so koennen
// die E2E-Tests das ECHTE Script aus dem Repo gegen ein Fixture-Projekt fahren
// statt eine Kopie im Temp-Verzeichnis — deren Coverage liesse sich nicht auf
// kit/night.mjs abbilden. Genau daran lag es, dass die acht night-Testdateien
// trotz voller E2E-Laeufe null Prozent zur gemessenen Abdeckung beitrugen.
const BOARD_PATH = process.env.KIT_ROOT
  ? join(resolve(process.env.KIT_ROOT), ".claude", "kit", "board.mjs")
  : join(__dirname, "board.mjs");

// Der Parser der Pruefvorgabe kommt aus board.mjs und wird NICHT nachgebaut (Issue #304).
// Eine zweite Regex fuer `Pruefung:` liefe frueher oder spaeter auseinander — und ein
// Runner, der die Zeile anders liest als das Board, waere genau die zweite Wahrheit, die
// dieses Kit ueberall vermeidet. board.mjs laeuft beim Import nicht los; sein Haupt-
// programm liegt seit Issue #135 hinter einem CLI-Guard.
//
// Warum bedingt und nicht als `import`-Zeile oben: `--version` und `--help` muessen auch
// dann Auskunft geben, wenn NICHTS neben der Datei liegt (Issue #170) — ein statischer
// Import scheitert vor jeder Zeile Code und nimmt genau diese Auskunft. Fehlt der Nachbar,
// bleibt der Stub stehen; arbeitsfaehig ist der Runner ohne board.mjs ohnehin nicht, main()
// bricht dafuer mit eigener Meldung ab.
//
// Bewusst der Nachbarpfad und nicht BOARD_PATH: KIT_ROOT verlegt die CLI-AUFRUFE in ein
// fremdes Projekt (Test-Hook); eine reine Funktion holt man sich dort nicht her, sondern
// aus dem board.mjs, das zu dieser Datei gehoert.
const NACHBAR_BOARD = join(__dirname, "board.mjs");
let parsePruefvorgabe = () => {
  throw new Error(`board.mjs liegt nicht neben night.mjs (${NACHBAR_BOARD}) — die Pruefvorgabe ist nicht lesbar.`);
};
if (existsSync(NACHBAR_BOARD)) ({ parsePruefvorgabe } = await import("./board.mjs"));
// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "1.41.1";
const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_LABEL = "kit:nightrun";
// Bewusst ein eigenes Label und nicht kit:nightrun (Issue #233): Die beiden Modi
// laufen in verschiedenen Naechten und meinen verschiedene Spalten — Review den
// Backlog, Implementierung die Ready-Spalte.
const DEFAULT_REVIEW_LABEL = "kit:nightreview";
// Ein Review ist keine Implementierungsrunde: kein Build, kein Commit. Deshalb ein
// eigenes, knapperes Limit statt --timeout-min (analog SALVAGE_TIMEOUT_MS).
const REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ITERATIONS = 500; // Notbremse gegen Endlosschleifen, weit ueber jedem realen Lauf

// --- Argumente ---

function printHelp() {
  process.stdout.write(`Nacht-Runner: arbeitet die Ready-Spalte unbeaufsichtigt ab —
pro Issue eine frische Headless-Session (/implement-next #N), sequenziell.
Erfolg wird am Board gemessen (Issue in In review). Gepusht wird nie.

Aufruf (im Projekt-Root):
  node .claude/kit/night.mjs [Flags]

Flags:
  --max <N>          maximale Session-Starts pro Lauf (Default 10)
  --model <id>       Modell der Nacht-Sessions (Default ${DEFAULT_MODEL})
  --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
  --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
  --yolo             --dangerously-skip-permissions statt acceptEdits (Warnung!)
  --no-checks-ok     Start trotz leerer buildChecks erlauben
  --label <name>     nur Ready-Issues mit diesem Label verarbeiten
                     (Default ${DEFAULT_LABEL}); --label none schaltet den
                     Filter ab (altes Verhalten: striktes erstes Ready-Issue)
  --verbose          Live-Verlaufsprotokoll: Tool-Aufrufe und Text-Snippets
                     der laufenden Session mitloggen (via stream-json)
  --version          Kit-Stand dieser Datei
  --help, -h         diese Uebersicht

Review-Modus (prueft statt zu implementieren):
  --review           laesst Backlog-Issues von /issue-review pruefen, statt
                     Ready-Issues zu implementieren. Exklusiv: die
                     Implementierungsschleife laeuft dann nicht.
  --review-label <n> nur Backlog-Issues mit diesem Label pruefen
  --stufe <s>        Pruefstufe des Review-Modus: fachlich | plan | issue
                     (Default issue). Nur zusammen mit --review. Genau eine
                     Stufe pro Aufruf — zwischen den Stufen steht die
                     menschliche Freigabe.
                     (Default ${DEFAULT_REVIEW_LABEL}); 'none' schaltet den Filter ab

  Zwischen Review und Implementierung liegt das GO, und das GO ist menschlich —
  deshalb sind es zwei Laeufe an zwei Abenden, nicht zwei Phasen in einer Nacht.

  Voraussetzung: ein 'issueReview'-Block mit mindestens einem Reviewer in
  .claude/workflow.config.json. Vorlage zum Uebernehmen liegt nach der
  Installation in .claude/workflow.config.example.json. Fehlt der Block,
  bricht der Vorflug ab, statt Sessions ergebnislos zu verbrennen.

Salvage (immer an): Endet eine Runde ohne Board-Ergebnis, aber mit Aenderungen im
Working Tree, fuehrt der Runner die buildChecks selbst aus. Sind sie gruen, bekommt
genau eine Salvage-Session pro Issue die Chance, den Zwischenstand gegen das Issue
zu pruefen, zu committen und nach In review zu verschieben (Zeitlimit 10 min). Rote
Checks oder ein gescheiterter Salvage-Versuch fuehren zum harten Stopp.

Ist in der Config "formatFixCommand" gesetzt (z.B. "mvn spotless:apply" oder
"npx prettier --write ."), laeuft es bei roten Checks genau einmal, danach werden
die Checks genau einmal wiederholt: ein reiner Formatverstoss kippt so keinen Lauf
mehr. Bleiben die Checks rot, war das Format nicht die Ursache -> harter Stopp.
Ohne das Feld aendert sich nichts.

Beispiele:
  caffeinate -i node .claude/kit/night.mjs
  TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs

Details: Kapitel "Nachtbetrieb" in der Kit-Dokumentation.
`);
}

function parseArgs(argv) {
  const args = { max: 10, model: DEFAULT_MODEL, timeoutMin: 60, dryRun: false, yolo: false, noChecksOk: false, verbose: false, label: DEFAULT_LABEL, review: false, reviewLabel: DEFAULT_REVIEW_LABEL, stufe: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--version") {
      // Wie --help: greift vor allen Vorflug-Checks, damit die Auskunft auch in
      // einem Verzeichnis ohne Config und ohne board.mjs funktioniert.
      process.stdout.write(`night.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
      process.exit(0);
    } else if (a === "--max") args.max = Number(argv[++i]);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--label") args.label = argv[++i];
    else if (a === "--review") args.review = true;
    else if (a === "--review-label") args.reviewLabel = argv[++i];
    else if (a === "--stufe") args.stufe = argv[++i];
    else if (a === "--timeout-min") args.timeoutMin = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yolo") args.yolo = true;
    else if (a === "--no-checks-ok") args.noChecksOk = true;
    else if (a === "--verbose") args.verbose = true;
    else fail(`Unbekanntes Argument: ${a} — siehe --help`);
  }
  if (!Number.isFinite(args.max) || args.max < 1) fail("--max braucht eine Zahl >= 1");
  if (!Number.isFinite(args.timeoutMin) || args.timeoutMin < 1) fail("--timeout-min braucht eine Zahl >= 1");

  // Die Stufenpruefung sitzt hier und nicht spaeter: Sie muss VOR jedem
  // Board-Zugriff und Session-Start greifen. Ein stiller Rueckfall auf `issue`
  // waere der schlimmere Ausgang — der Lauf saehe erfolgreich aus und pruefte
  // die falsche Sorte Dokument.
  if (args.stufe !== null) {
    if (!args.review) {
      fail("--stufe gilt nur im Review-Modus — zusammen mit --review verwenden.");
    }
    if (typeof args.stufe !== "string" || args.stufe.startsWith("--") || args.stufe.trim() === "") {
      fail(`--stufe braucht einen Wert: ${NIGHT_REVIEW_STUFEN.join(" | ")}`);
    }
    if (!NIGHT_REVIEW_STUFEN.includes(args.stufe)) {
      fail(`Unbekannte Stufe '${args.stufe}'. Erlaubt: ${NIGHT_REVIEW_STUFEN.join(" | ")}`);
    }
  }
  return args;
}

// --- Logging ---

let LOG_FILE = null;

// Die geladene Config auf Modulebene, zugewiesen in main() (Issue #232). Dasselbe
// Muster wie LOG_FILE darueber, und aus demselben Grund: gitClean() braucht sie, wird
// aber aus der Hauptschleife heraus aufgerufen. Seit das Hauptprogramm in main()
// steckt (damit reine Funktionen importierbar sind), waere eine dort deklarierte
// Konstante fuer gitClean() unsichtbar.
let config = null;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stdout.write(line + "\n");
  if (LOG_FILE) appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

function fail(msg) {
  const line = `Fehler: ${msg}`;
  process.stderr.write(line + "\n");
  if (LOG_FILE) appendFileSync(LOG_FILE, line + "\n", "utf-8");
  process.exit(1);
}

// --- Board-Adapter als Kind-Prozess (keine Logik-Duplikation) ---

function board(...cliArgs) {
  const res = spawnSync(process.execPath, [BOARD_PATH, ...cliArgs], { encoding: "utf-8" });
  if (res.status !== 0) {
    fail(`board.mjs ${cliArgs.join(" ")} schlug fehl: ${(res.stderr || res.stdout || "").trim()}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    fail(`board.mjs ${cliArgs.join(" ")} lieferte kein JSON: ${res.stdout.slice(0, 200)}`);
  }
}

// --- Git-Helfer ---

// PATH-Aufloesung bei den git- und sh-Aufrufen dieser Datei: bewusst so (Issue #183).
//
// SonarQube S4036 ("OS commands should not rely on PATH resolution") markiert jeden
// Start eines Kommandos ohne absoluten Pfad. Die Regel ist hier nicht erfuellbar,
// ohne mehr kaputtzumachen als sie schuetzt:
//
//   - Absolute Pfade brechen die zugesagte Portabilitaet. Das Kit laeuft auf Mac,
//     Windows und Linux; /usr/bin/git existiert unter Windows nicht, und je nach
//     Installation liegt git auch unter /opt/homebrew/bin.
//   - Ein kontrollierter env.PATH ist kein Fix: Die Regel beanstandet nicht, WELCHEN
//     PATH der Prozess bekommt, sondern DASS ueber PATH aufgeloest wird.
//   - Die sh -c-Aufrufe (runBuildChecksSync, Format-Fix) fuehren frei konfigurierte
//     Kommandozeilen aus der workflow.config.json aus. Die brauchen zwingend eine
//     Shell — ohne sie gibt es das Feature nicht.
//
// Zur Risikobewertung: Das sind lokale Entwickler-Werkzeuge, die der Nutzer auf seiner
// eigenen Maschine startet. Wer dort ein PATH-Verzeichnis beschreiben kann, hat bereits
// Codeausfuehrung unter derselben Kennung — der Angriff setzt voraus, was er erreichen
// soll. Die Findings sind in SonarCloud als accepted markiert, mit derselben Begruendung.
function gitClean() {
  // Beim lokalen Tracker sind Board-Moves Dateiaenderungen unter issuesDir —
  // Board-Zustand ist kein Code-Zustand und zaehlt nicht als dirty.
  const pathspec = ["--", "."];
  if (config.issueTracker === "local") {
    pathspec.push(`:(exclude)${config.local?.issuesDir || "issues"}`);
  }
  const res = spawnSync("git", ["status", "--porcelain", ...pathspec], { encoding: "utf-8" });
  if (res.status !== 0) fail("git status schlug fehl — bin ich im Projekt-Root eines git-Repos?");
  return res.stdout.trim() === "";
}

function lastCommitHash() {
  // PATH-Aufloesung bewusst, siehe Begruendung ueber gitClean() (S4036, Issue #183).
  const res = spawnSync("git", ["log", "-1", "--format=%h"], { encoding: "utf-8" });
  return res.status === 0 ? res.stdout.trim() : "?";
}

// --- Nicht implementierbare Issues: fachlich (#146) und Idee (#192) ---

// [Fachlich]-Titelpraefix = Discovery-Issue: wird gegroomt, nie implementiert.
// Titel-basiert, weil issue list den Titel bei allen Trackern ohne Adapter-
// Erweiterung liefert (Stufe 1; Label-Achse ist als Folgepaket benannt).
function isFachlich(title) {
  return /^\s*\[fachlich\]/i.test(title || "");
}

// [Idee]-Titelpraefix = rohe Idee ohne /plan-Zyklus, ebenfalls nicht nachtlauf-faehig
// (Issue #192). Ohne Gate startet der Runner eine Session, die das Issue korrekt
// ablehnt und ohne In-review-Ergebnis endet — eine korrekte Ablehnung, die der
// Runner nicht von einem Fehlschlag unterscheiden kann. Beobachtet an zwei Tagen
// mit demselben Issue (kanban-kit#494): je Lauf eine verbrannte Session plus ein
// Kommentar, der wie ein Infrastrukturproblem aussieht. Vorhersehbare Modell-
// Entscheidungen gehoeren ins Gate, nicht in Prompts.
// Review-Marker aus /issue-review (Issue #223). Anders als die beiden Filter darueber
// greift dieser am BODY: Der Marker steht im Kontext-Abschnitt, nicht im Titel. Der
// Body liegt ohnehin vor, weil parseDeps ihn braucht — kein zusaetzlicher Board-Aufruf.
//
// Bewusst streng: Nur eine Zeile, die mit 'Issue-Review:' beginnt und danach etwas
// traegt, zaehlt. 'Issue-Review folgt noch' ist das Gegenteil einer Freigabe und darf
// nicht als eine durchgehen.
function hasReviewMarker(body) {
  return /^\s*Issue-Review:\s*\S/im.test(body || "");
}

/**
 * Der Freigabe-Befund eines Ready-Issues fuer das Gate `requiredBeforeReady` (#304).
 *
 * Zwei Gruende lassen ein Issue durch, und sie sind verschiedene Dinge:
 *   `marker`  — es ist geprueft worden (Issue-Review-Marker im Body)
 *   `verzicht`— der Mensch hat ausdruecklich ohne Pruefung freigegeben
 *
 * Drei Gruende halten es zurueck, und auch die duerfen nicht zu einem verschmelzen:
 *   `ungeprueft` — nie entschieden
 *   `verfallen`  — entschieden, aber durch eine inhaltliche Aenderung ueberholt
 *   `ungueltig`  — die Zeile selbst ist kaputt
 * Morgens verlangt jeder dieser drei einen anderen Handgriff; eine pauschale
 * Meldung "ungeprueft" naehme dem Menschen genau diese Unterscheidung.
 *
 * Der Marker wird ZUERST geprueft, noch vor dem Parser. Ein geprueftes Issue soll an
 * einem Formfehler in der `Pruefung:`-Zeile nicht haengenbleiben — das waere strenger
 * als das Bestandsverhalten und stuende in keinem Verhaeltnis zum Anlass.
 */
function reviewFreigabe(body) {
  if (hasReviewMarker(body)) return { frei: true, art: "marker" };
  let vorgabe;
  try {
    vorgabe = parsePruefvorgabe(body || "");
  } catch (e) {
    return { frei: false, art: "ungueltig", detail: e.message };
  }
  // Der gefaehrlichste Fall zuerst: Ein Ticket, das nach der Freigabe inhaltlich
  // veraendert wurde, darf nicht weiter ungeprueft durchlaufen.
  if (vorgabe.verfallen) return { frei: false, art: "verfallen" };
  if (vorgabe.wert === "verzicht") return { frei: true, art: "verzicht" };
  // `Pruefung: 2` sagt "pruefe mit zwei Runden" — das ist keine Freigabe.
  return { frei: false, art: "ungeprueft" };
}

/** Protokollzeile, Board-Kommentar und Dry-Run-Grund je Ablehnungsart (#304). */
const GATE_ABLEHNUNG = {
  ungeprueft: {
    kurz: () => "ungeprueft, kein Issue-Review-Marker",
    log: () => "uebersprungen: ungeprueft (kein Issue-Review-Marker im Body).",
    kommentar: (id) => `Ungeprueft — bitte erst /issue-review #${id} laufen lassen, dann wieder nach Ready.`,
  },
  verfallen: {
    kurz: () => "Pruefvorgabe verfallen",
    log: () => "zurueckgestellt: die Pruefvorgabe ist verfallen — der Inhalt hat sich seit der Entscheidung geaendert.",
    kommentar: (id) =>
      "Pruefvorgabe verfallen — der Inhalt hat sich seit der Entscheidung geaendert, damit gilt wieder der Regelfall. " +
      `Bitte /issue-review #${id} laufen lassen oder die Zeile 'Pruefung:' neu setzen, dann wieder nach Ready.`,
  },
  ungueltig: {
    kurz: () => "ungueltige Pruefvorgabe",
    log: (detail) => `zurueckgestellt: ungueltige Pruefvorgabe (${detail}).`,
    kommentar: (id, detail) =>
      `Ungueltige Pruefvorgabe — ${detail} Bitte die Zeile 'Pruefung:' im Kontext-Abschnitt korrigieren, dann wieder nach Ready.`,
  },
};

// SYNC: dieselben Werte wie REVIEW_STUFEN in kit/board.mjs (Issue #278). Bekommt
// board.mjs eine vierte Stufe, muss sie hier mit — sonst nimmt der Runner sie als
// unbekannten Wert an und bricht ab, waehrend der Skill sie kennt.
const NIGHT_REVIEW_STUFEN = ["fachlich", "plan", "issue"];

// Welcher Marker die jeweilige Stufe nachweist (Issue #279).
const STUFEN_MARKER = {
  fachlich: "Fachplan-Review:",
  plan: "Plan-Review:",
  issue: "Issue-Review:",
};

/**
 * Der Marker-Vergleich des Review-Modus, stufenabhaengig.
 *
 * Bewusst NICHT als Parameter an hasReviewMarker: Die Funktion dient dem
 * Implementierungs-Gate `requiredBeforeReady`, und dort darf ausschliesslich
 * `Issue-Review:` zaehlen (Issue #279). Ein Stufenparameter dort haette das
 * Ready-Gate mitveraendert — der naheliegende, aber falsche Weg.
 */
export function hasStageMarker(body, stufe) {
  const marker = STUFEN_MARKER[stufe];
  if (!marker) return false;
  return new RegExp(`^\\s*${marker}\\s*\\S`, "im").test(body || "");
}

/**
 * Das Zeichen fuer eine offene menschliche Entscheidung (Plan #368, A4).
 *
 * Anders als die Titel-Praefixe haengt dieses Gate an einem Label — und es hat eine
 * Richtung: Die Maschine darf es SETZEN, aber nie ABNEHMEN. Ein Lauf, der sein
 * eigenes `kit:klaeren` abraeumen duerfte, koennte sich selbst freigeben. Deshalb
 * kommt `issue label remove` mit diesem Namen im ganzen Runner nicht vor.
 *
 * Die beiden Labelsorten leisten Verschiedenes: `review:*` **beschreibt** einen
 * abgeleiteten Zustand und ist jederzeit neu berechenbar, `kit:klaeren`
 * **entscheidet** und bleibt stehen, bis ein Mensch es abnimmt.
 */
export const KLAEREN_LABEL = "kit:klaeren";

export function hatKlaerenLabel(issue) {
  return (issue?.labels || []).includes(KLAEREN_LABEL);
}

function isIdee(title) {
  return /^\s*\[idee\]/i.test(title || "");
}

// [Plan]-Titelpraefix = Plandokument aus /plan (Issue #276). Ein Plan beschreibt einen
// Weg, er ist keine Aufgabe: Er wird per /issues erst in Arbeitspakete zerlegt. Ohne
// dieses Gate faellt er unter keine der beiden Sorten darueber und kaeme als normales
// Arbeitspaket durch — er wuerde implementiert, und das saehe am Board wie ein Erfolg aus.
function isPlan(title) {
  return /^\s*\[plan\]/i.test(title || "");
}

// --- Review-Kandidaten (Issue #232) ---

/**
 * Waehlt aus einer Backlog-Liste die Issues, die der Nacht-Review pruefen soll.
 *
 * Reine Funktion: Board, Dateisystem und Sessions bleiben draussen, damit die
 * Auswahlregel fuer sich pruefbar ist (Linie von `pickReviewers` in board.mjs).
 *
 * Bewusst nur die billige erste Stufe. Label und Titel-Praefix stehen im Ergebnis von
 * `issue list`; der Review-Marker steht im BODY und braucht ein `issue get` pro Issue —
 * den prueft die Schleife dort, wo der Body ohnehin vorliegt.
 *
 * Der Backlog ist eine Halde: Ohne Label-Filter geriete jedes liegengebliebene Issue in
 * den Lauf. `label: null` schaltet den Filter trotzdem ab, analog zum Implementierungs-
 * Modus (`--label none`).
 *
 * Uebersprungene Issues gehen nicht still verloren, sondern mit Grund in eine zweite
 * Liste — ein Lauf ohne Arbeit ist sonst im Protokoll nicht von einem abgearbeiteten
 * Board zu unterscheiden (dieselbe Ueberlegung wie bei der Label-Warnung, #179).
 */
/**
 * Gueltiger, nicht verfallener Verzicht am Dokument (Issue #304).
 *
 * Anders als im Gate wirft eine kaputte `Pruefung:`-Zeile hier nicht: Die Auswahl ist
 * eine reine Funktion, und ein Tippfehler darf den ganzen Review-Lauf nicht anhalten.
 * Das Dokument bleibt dann Kandidat — im Review laesst sich die Zeile reparieren, es
 * davor auszuschliessen waere das Gegenteil des Gewollten.
 *
 * Eine VERFALLENE Vorgabe schliesst nicht aus: Sie ist ueberholt, es gilt wieder der
 * Regelfall — und der heisst pruefen.
 */
function hatGueltigenVerzicht(body) {
  try {
    const { wert, verfallen } = parsePruefvorgabe(body || "");
    return wert === "verzicht" && !verfallen;
  } catch {
    return false;
  }
}

export function selectReviewCandidates(issues, opts = {}) {
  const label = opts.label ?? null;
  const stufe = opts.stufe ?? "issue";
  const kandidaten = [];
  const uebersprungen = [];

  for (const issue of issues || []) {
    const eintrag = (grund) => uebersprungen.push({ id: issue.id, title: issue.title, grund });
    // Der Label-Filter zuerst: Die Stufe waehlt innerhalb der freigegebenen Menge
    // aus, sie umgeht die Freigabe nicht.
    if (label !== null && !(issue.labels || []).includes(label)) {
      eintrag(`kein Label '${label}'`);
    } else if (isIdee(issue.title)) {
      // [Idee] ist in JEDER Stufe ausgeschlossen: eine rohe Idee ohne /plan-Zyklus
      // ist kein pruefbares Dokument (Issue #192).
      eintrag("Idee ([Idee])");
    } else if (hatGueltigenVerzicht(issue.body)) {
      // Ebenfalls in jeder Stufe (Issue #304): Ein Dokument mit bewusstem Verzicht
      // traegt nie einen Marker und kaeme sonst in JEDEM Review-Lauf erneut dran.
      // Die Session wuerde den Verzicht kommentieren statt zu pruefen — und der
      // Runner verbuchte diesen Kommentar als "Review mit Befund".
      eintrag("bewusst ohne Pruefung freigegeben (Pruefung: Verzicht)");
    } else if (hatKlaerenLabel(issue)) {
      // In JEDER Stufe (Plan #368, A4): An einem gezeichneten Dokument wartet eine
      // menschliche Entscheidung. Ein erneuter Review wuerde denselben offenen Punkt
      // ein zweites Mal finden und das Ticket ein zweites Mal zeichnen.
      eintrag("kit:klaeren, offene Entscheidung");
    } else if (stufe === "fachlich") {
      if (isFachlich(issue.title)) kandidaten.push(issue);
      else eintrag("kein fachliches Issue ([Fachlich])");
    } else if (stufe === "plan") {
      if (isPlan(issue.title)) kandidaten.push(issue);
      else eintrag("kein Plan-Dokument ([Plan])");
    } else if (isFachlich(issue.title)) {
      eintrag("fachliches Issue ([Fachlich])");
    } else if (isPlan(issue.title)) {
      eintrag("Plan-Dokument ([Plan])");
    } else {
      kandidaten.push(issue);
    }
  }
  return { kandidaten, uebersprungen };
}

// --- Abhaengigkeiten ---

const DEPS_UEBERSCHRIFT = /^ {0,3}##\s*Abh(?:ä|ae)ngigkeiten\s*$/i;
const ABSCHNITTS_ENDE = /^ {0,3}##\s/;
const LOKALE_REFERENZ = /(?<![\w`/#])#(\d+)/g;

/**
 * Liest #N-Referenzen aus dem Abschnitt "## Abhaengigkeiten" (auch "Abhängigkeiten").
 *
 * Bewusst nur nackte #N-Tokens: Referenzen wie `owner/repo`#245 (Backtick/Slash
 * davor) sind fremde Repos und werden nicht als lokale Issues gewertet.
 *
 * Die Ueberschrift zaehlt nur als EIGENE ZEILE und nur AUSSERHALB eines Code-Fence
 * (Issue #308). Vorher traf der Ausdruck auch eine Nennung im Fliesstext und nahm
 * die erste Fundstelle — bei einem Issue, das ueber das Issue-Format selbst
 * handelt, las er dann einen Teil des Aufgabentextes. Das Schadensbild geht in
 * beide Richtungen und faellt am Board nie auf: Eine echte Referenz im richtigen
 * Abschnitt wird unsichtbar (der Runner implementiert zu frueh), oder eine
 * Referenz im falsch gelesenen Bereich erfindet eine Abhaengigkeit (das Issue
 * bleibt dauerhaft liegen).
 *
 * Die Fence-Regel gilt an BEIDEN Enden: Eine `##`-Zeile innerhalb eines Fence
 * beendet den echten Abschnitt nicht. Sonst haette ein Beispielblock im Abschnitt
 * selbst ihn vorzeitig geschlossen — zwei Auslegungen, beide mit dem Anspruch,
 * "Fences ausnehmen" zu erfuellen.
 *
 * Bei mehreren echten Ueberschriften gilt die LETZTE: In einem korrekt
 * formatierten Issue ist der Abschnitt der letzte des Dokuments, und ein
 * vorangestelltes Beispiel ausserhalb eines Fence bleibt damit wirkungslos.
 */
export function parseDeps(body) {
  const zeilen = String(body || "").split(/\r\n|\r|\n/);
  const imFence = fenceLauf();
  const ausserhalb = [];
  let start = -1;

  for (let i = 0; i < zeilen.length; i++) {
    ausserhalb[i] = !imFence(zeilen[i]);
    if (ausserhalb[i] && DEPS_UEBERSCHRIFT.test(zeilen[i])) start = i;
  }
  if (start < 0) return [];

  let ende = zeilen.length;
  for (let i = start + 1; i < zeilen.length; i++) {
    if (ausserhalb[i] && ABSCHNITTS_ENDE.test(zeilen[i])) { ende = i; break; }
  }

  const abschnitt = zeilen.slice(start + 1, ende).join("\n");
  const refs = [...abschnitt.matchAll(LOKALE_REFERENZ)].map((x) => Number(x[1]));
  return [...new Set(refs)];
}

function satisfiedIds() {
  const inReview = board("issue", "list", "--status", "in_review");
  const done = board("issue", "list", "--status", "done");
  return new Set([...inReview, ...done].map((i) => Number(i.id)));
}

// --- Verbose-Stream (Issue #154) ---

// Kuerzt Text auf eine kompakte, einzeilige Log-Zeile.
function flatten(str, max) {
  const flat = (str || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// Waehlt das aussagekraeftigste Argument eines Tool-Aufrufs (Kommando, Pfad),
// faellt auf ein kompaktes JSON zurueck.
function toolArg(block) {
  const input = block.input || {};
  for (const key of ["command", "file_path", "path", "pattern", "url"]) {
    if (typeof input[key] === "string") return input[key];
  }
  const json = JSON.stringify(input);
  return json && json !== "{}" ? json : "";
}

// Uebersetzt eine stream-json-Zeile (ein NDJSON-Objekt) in 0..n kompakte
// Ereigniszeilen: Tool-Aufrufe (Bash/Edit/…) und Text-Snippets der Session.
function interpretStreamEvent(obj) {
  const out = [];
  if (!obj || typeof obj !== "object") return out;
  if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        out.push(`Claude: ${flatten(block.text, 200)}`);
      } else if (block.type === "tool_use" && block.name) {
        const arg = toolArg(block);
        out.push(arg ? `${block.name}: ${flatten(arg, 160)}` : block.name);
      }
    }
  }
  return out;
}

function emitVerbose(issueId, line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return; // unparsebare Zeilen tolerant ueberspringen
  }
  for (const ev of interpretStreamEvent(obj)) {
    log(`  #${issueId} > ${ev}`);
  }
}

// --- Nacht-Session ---

// Startet einen Prozess asynchron, sammelt stdout/stderr und (bei useStream)
// parst stdout live zeilenweise. Eigener Timeout-Timer statt spawnSync-timeout,
// weil wir waehrend des Laufs streamen muessen. Das Rueckgabe-Objekt spiegelt
// die von spawnSync bekannten Felder (status, signal, error, stdout, stderr),
// damit der Infrastruktur-Guard (#149) und die Erfolgs-/Fehlschlag-Pfade
// unveraendert weiterarbeiten.
function runProcess(cmd, cmdArgs, { issueId, timeoutMs, useStream, extraEnv }) {
  return new Promise((resolve) => {
    // detached: true gibt dem Kind eine eigene Prozessgruppe, damit das Zeitlimit den
    // ganzen Baum trifft und nicht nur den direkten Kindprozess (Issue #182). Ohne das
    // ueberlebt ein Enkel (bei `claude` etwa ein Bash-Tool-Aufruf wie `mvn verify`),
    // haelt die geerbte stdout-Pipe offen und verhindert das close-Event — der Runner
    // wartet dann die volle Laufzeit ab, obwohl er laengst gekillt hat.
    // Gemessen: Enkelprozess mit Einzel-Kill 5023 ms statt 307 ms bei 300 ms Limit.
    // Kein unref(): Der Runner soll weiterhin auf das Kind warten.
    const child = spawn(cmd, cmdArgs, {
      env: { ...process.env, NIGHT_ISSUE_ID: String(issueId), ...extraEnv },
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let buf = "";
    let timedOut = false;
    let settled = false;
    const timers = [];

    const done = (result) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      resolve(result);
    };

    // Signal an die ganze Prozessgruppe (negative PID, POSIX). Windows kennt keine
    // Prozessgruppen in dieser Form — dort bleibt es beim Einzel-Kill, die
    // Einschraenkung ist bekannt und nicht behebbar. Ein bereits beendeter Prozess
    // laesst kill mit ESRCH scheitern; das ist der Normalfall, kein Fehler.
    const killTree = (signal) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        /* Prozess(gruppe) bereits weg */
      }
    };

    // Nachfrist bis zum harten Nachsetzen. Ueber NIGHT_KILL_GRACE_MS testbar gemacht,
    // analog zu NIGHT_TIMEOUT_MS.
    const killGraceMs = process.env.NIGHT_KILL_GRACE_MS
      ? Number(process.env.NIGHT_KILL_GRACE_MS)
      : 5000;

    timers.push(setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      // Harte Obergrenze: Reagiert der Baum nicht auf SIGTERM (ignoriertes Signal,
      // haengender I/O), wird nachgesetzt — und wenn auch das close-Event ausbleibt,
      // loest der Runner selbst auf. Ein Nachtlauf darf unter keinen Umstaenden
      // unbegrenzt warten.
      timers.push(setTimeout(() => {
        killTree("SIGKILL");
        timers.push(setTimeout(() => done({
          status: null,
          signal: "SIGKILL",
          error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
          stdout,
          stderr,
        }), killGraceMs));
      }, killGraceMs));
    }, timeoutMs));

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (useStream) {
        buf += text;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          emitVerbose(issueId, buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => done({ status: null, signal: null, error: err, stdout, stderr }));
    child.on("close", (code, signal) => {
      if (useStream && buf.trim()) emitVerbose(issueId, buf);
      const error = timedOut
        ? Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
        : null;
      done({ status: code, signal, error, stdout, stderr });
    });
  });
}

// opts (Issue #167): { prompt, timeoutMs, extraEnv } — die Salvage-Session nutzt
// denselben Mechanismus wie eine regulaere Runde, nur mit anderem Prompt und
// eigenem Zeitlimit. Ohne opts bleibt alles wie vor #167.
async function runSession(issueId, args, opts = {}) {
  const timeoutMs = process.env.NIGHT_TIMEOUT_MS
    ? Number(process.env.NIGHT_TIMEOUT_MS)
    : (opts.timeoutMs ?? args.timeoutMin * 60 * 1000);
  // Das Issue wird der Session verbindlich uebergeben (Issue #191) — sie waehlt
  // nicht mehr selbst. Der Prompt geht zusaetzlich als NIGHT_PROMPT in die
  // Kindprozess-Umgebung, damit der Auftrag auch im Test-Hook-Pfad sichtbar ist.
  const prompt = opts.prompt || `/implement-next #${issueId}`;
  const testCmd = process.env.NIGHT_CLAUDE_CMD;
  let cmd, cmdArgs;
  if (testCmd) {
    // Bleibt bewusst bei sh (Issue #199): Dieser Zweig ist ausschliesslich der
    // Test-Hook, und die Fake-Skripte der Testsuite sind POSIX-Shell. Ihn auf die
    // Plattform-Shell umzustellen wuerde unter Windows nichts gewinnen — die Fakes
    // selbst liefen dort trotzdem nicht. Die night-Tests sind deshalb unter Windows
    // ausgenommen (Issue #197); der Produktivpfad unten ist davon nicht betroffen.
    cmd = "sh";
    cmdArgs = ["-c", testCmd];
  } else {
    const permArgs = args.yolo
      ? ["--dangerously-skip-permissions"]
      : ["--permission-mode", "acceptEdits"];
    const streamArgs = args.verbose ? ["--output-format", "stream-json", "--verbose"] : [];
    cmd = "claude";
    cmdArgs = ["-p", prompt, "--model", args.model, ...permArgs, ...streamArgs];
  }
  const res = await runProcess(cmd, cmdArgs, {
    issueId, timeoutMs, useStream: args.verbose,
    // KIT_AGENT_MODEL (Issue #193): Modell-Selbstauskunft fuer den Aktivitaetsverlauf
    // des Boards. Die Variable wird von den Bash-Kindprozessen der Session geerbt und
    // von board.mjs als Header X-Agent-Model gesendet — so steht im Verlauf, mit
    // welchem Modell der Nachtlauf gearbeitet hat. Nur hier gesetzt: interaktive
    // Sessions machen bewusst keine Angabe.
    extraEnv: { NIGHT_PROMPT: prompt, KIT_AGENT_MODEL: args.model, ...opts.extraEnv },
  });
  if (!testCmd && res.error?.code === "ENOENT") {
    fail("claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?");
  }
  if (LOG_FILE) {
    appendFileSync(LOG_FILE, `--- Session-Output Issue #${issueId} ---\n${res.stdout || ""}${res.stderr || ""}\n`, "utf-8");
  }
  return res;
}

// --- Salvage (Issue #167) ---

// Zeitlimit der Salvage-Session: sie fuehrt keinen Build mehr aus, sondern prueft
// nur den Diff gegen das Issue, committet und bewegt das Board. Bewusst unabhaengig
// von --timeout-min (das bemisst eine volle Implementierungsrunde).
const SALVAGE_TIMEOUT_MS = 10 * 60 * 1000;

// Liest den env-Block aus .claude/settings.json (falls vorhanden). Dort stehen
// projektspezifische Variablen (z.B. DOCKER_HOST/TESTCONTAINERS_DOCKER_SOCKET_
// OVERRIDE fuer Testcontainers unter Colima), die Claude Code seinen eigenen
// Bash-Tool-Aufrufen automatisch mitgibt. night.mjs ist aber ein eigener
// Node-Prozess ausserhalb von Claude Code und bekommt diese Variablen sonst
// nicht — ohne sie liefert runBuildChecksSync ein falsches Rot (beobachtet bei
// kanban-kit #445: mvn verify schlug ohne die beiden Variablen mit Mockito-
// MockMaker-Fehlern fehl, mit ihnen lief er sauber durch).
function settingsEnv() {
  // Precedence wie in Claude Code: settings.json zuerst, settings.local.json
  // gewinnt. Die local-Datei ist gitignored und damit der uebliche Ort fuer
  // maschinenspezifische Werte — genau die, die hier fehlen wuerden (Issue #168).
  const merged = {};
  for (const name of ["settings.json", "settings.local.json"]) {
    const path = join(process.cwd(), ".claude", name);
    if (!existsSync(path)) continue;
    try {
      const settings = JSON.parse(readFileSync(path, "utf-8"));
      if (settings.env && typeof settings.env === "object") Object.assign(merged, settings.env);
    } catch {
      // Kaputtes JSON blockiert die Vorpruefung nicht — nur diese eine Quelle faellt aus.
    }
  }
  return merged;
}

// Fuehrt die buildChecks der Config sequenziell aus und bricht beim ersten roten
// Check ab. mutationCommand bleibt bewusst aussen vor: ein nachgelagerter Check,
// kein Blocker fuer die Salvage-Entscheidung. Die Kindprozess-Umgebung bekommt
// zusaetzlich den env-Block aus .claude/settings.json gemergt (siehe settingsEnv).
// Umgebung fuer die eigenen Kindprozesse (Vorpruefung und Format-Fix): process.env
// plus der gemergte settings-env-Block.
function checkEnv() {
  return { ...process.env, ...settingsEnv() };
}

// Eine Shell ist hier zwingend — anders als in board.mjs, wo Issue #196 sie gerade
// abgeschafft hat. Der Unterschied: Dort stehen die Kommandos fest im Code und lassen
// sich als Argument-Array uebergeben. Hier ist `cmd` eine frei konfigurierte
// Kommandozeile aus der workflow.config.json ("mvn verify", "npm --prefix frontend
// run build"), die Operatoren und Umleitungen enthalten darf. Ohne Shell gaebe es das
// Feature nicht.
//
// Statt fest "sh" zu starten (das es unter Windows nicht gibt, Issue #199) waehlt
// Node mit shell:true die Shell der Plattform: /bin/sh auf POSIX, die ComSpec-Shell
// (im Regelfall cmd.exe) unter Windows. Bewusst nicht PowerShell: Der Wert ist eine
// Nutzer-Konfiguration, und cmd.exe ist das, was ein Windows-Nutzer beim Eintragen
// eines Build-Kommandos erwartet; PowerShell haette zudem eine eigene Operator-Syntax
// (kein && vor Version 7).
//
// Folge fuer die Konfiguration: buildChecks sind damit potenziell plattformspezifisch.
// Ein `mvn verify` laeuft ueberall, eine Verkettung mit && oder eine Umleitung nicht
// zwingend. Das steht so im Nachtbetrieb-Kapitel der Doku.
//
// PATH-Aufloesung bewusst (S4036, Issue #183).
function runBuildChecksSync(cfg) {
  const env = checkEnv();
  let output = "";
  for (const cmd of cfg.buildChecks || []) {
    const res = spawnSync(cmd, { cwd: process.cwd(), encoding: "utf-8", env, shell: true });
    output += `$ ${cmd}\n${res.stdout || ""}${res.stderr || ""}`;
    if (res.status !== 0) return { ok: false, output };
  }
  return { ok: true, output };
}

// Vorpruefung fuer den Salvage inklusive einmaligem Format-Fix (Issue #169).
//
// Ein reiner Formatverstoss ist mechanisch und deterministisch behebbar und sagt
// nichts ueber die fachliche Qualitaet der Arbeit — er darf keinen Lauf beenden,
// in dem noch zwanzig Issues warten (beobachtet bei kanban-kit#463: ein einzelner
// Javadoc-Zeilenumbruch). Ist formatFixCommand gesetzt und sind die Checks rot,
// laeuft das Kommando genau einmal und die Checks werden genau einmal wiederholt.
// Bleiben sie rot, war das Format nicht die Ursache -> harter Stopp wie bisher.
// Ohne formatFixCommand ist das Verhalten exakt wie vor #169.
function verifyChecksForSalvage(cfg) {
  const first = runBuildChecksSync(cfg);
  if (first.ok) return { ok: true, output: first.output, formatFixCmd: null };

  const fixCmd = (cfg.formatFixCommand || "").trim();
  if (!fixCmd) return { ok: false, output: first.output, formatFixCmd: null };

  log(`  buildChecks rot — einmaliger Format-Fix wird angewendet: ${fixCmd}`);
  // Wie oben: fixCmd kommt aus der Config und braucht deshalb die Shell der Plattform
  // (Issue #199). PATH-Aufloesung bewusst (S4036, Issue #183).
  spawnSync(fixCmd, { cwd: process.cwd(), encoding: "utf-8", env: checkEnv(), shell: true });

  const second = runBuildChecksSync(cfg);
  if (!second.ok) return { ok: false, output: second.output, formatFixCmd: null };
  log(`  FORMAT-FIX angewendet, buildChecks jetzt gruen — der Lauf geht weiter.`);
  return { ok: true, output: second.output, formatFixCmd: fixCmd };
}

// Baut den Prompt der Salvage-Session. Kernpunkt: die Checks sind bereits extern
// gruen — die Session darf sie NICHT erneut starten, sonst laeuft sie in genau
// den Hintergrund-Check, der die Runde ueberhaupt erst gekostet hat.
function salvagePrompt(issueId, checksOutput, formatFixCmd) {
  const tail = (checksOutput || "").trim().split("\n").slice(-15).join("\n");
  return [
    `Die Pflicht-Checks (buildChecks) dieses Projekts wurden soeben EXTERN ausgefuehrt und sind GRUEN.`,
    `Fuehre sie NICHT erneut aus und starte keine langen Builds.`,
    ``,
    `Im Working Tree liegen unkommittete Aenderungen zu Issue #${issueId}. Deine einzige Aufgabe:`,
    `1. Lies das Issue: node .claude/kit/board.mjs issue get ${issueId}`,
    `2. Sieh dir den Stand an: git status und git diff`,
    `3. Passt der Stand zum Issue, committe ihn (Betreff mit "(Issue #${issueId})", im Body "Refs #${issueId}"`,
    `   — niemals Closes/Fixes/Resolves), verschiebe das Issue mit`,
    `   node .claude/kit/board.mjs issue move ${issueId} in_review`,
    `   und kommentiere den Abschlussbericht per`,
    `   node .claude/kit/board.mjs issue comment ${issueId} --text "..."`,
    `4. Passt der Stand nicht zum Issue oder wirkt unvollstaendig: NICHT committen,`,
    `   nichts am Board bewegen, und klar benennen was fehlt.`,
    // Ohne diesen Hinweis blieben die Formatierungsaenderungen unkommittiert liegen
    // und der Rest-Guard (#152) wertete die geglueckte Runde doch noch als Fehlschlag.
    ...(formatFixCmd ? [
      ``,
      `WICHTIG: Die Checks waren zunaechst rot; danach lief automatisch das Format-Kommando`,
      `"${formatFixCmd}" und erst dann wurden sie gruen. Die dadurch entstandenen`,
      `Formatierungsaenderungen gehoeren MIT in denselben Commit und in den Abschlussbericht.`,
    ] : []),
    ``,
    `Nicht pushen. Letzte Zeilen der externen Check-Ausgabe:`,
    tail,
  ].join("\n");
}

// --- Config mit persoenlichen Overrides (Issue #207) ---

// SYNC: Allowlist und Merge-Logik stehen identisch in kit/board.mjs
// (LOCAL_OVERRIDE_ALLOWLIST, mergeWorkflowConfig) — Aenderungen dort nachziehen.
// board.mjs und night.mjs sind bewusst eigenstaendige Single-File-Tools ohne
// gemeinsames Modul; geteilte Logik wird dupliziert und hier markiert.
//
// Fuer den Runner ist die Allowlist besonders wichtig: Die Pruefung auf leere
// buildChecks weiter unten ist sein einziges Gate. Waere das Feld lokal
// ueberschreibbar, koennte ein Nachtlauf ohne jede Absicherung durchlaufen.
const LOCAL_OVERRIDE_ALLOWLIST = ["reviewModel", "reviewScope", "triggers", "toolbox.tokenFile"];

function ladeConfigMitOverrides(sharedPfad) {
  const shared = JSON.parse(readFileSync(sharedPfad, "utf-8"));
  const lokalPfad = join(dirname(sharedPfad), "workflow.config.local.json");
  if (!existsSync(lokalPfad)) return shared;

  let local;
  try {
    local = JSON.parse(readFileSync(lokalPfad, "utf-8"));
  } catch {
    // Eine persoenliche Datei mit Tippfehler darf den Lauf nicht kippen.
    process.stderr.write(`Hinweis: ${lokalPfad} ist kein gueltiges JSON und wird ignoriert.\n`);
    return shared;
  }

  const config = { ...shared };
  const erlaubteBlaetter = new Map();
  const erlaubteFelder = new Set();
  for (const pfad of LOCAL_OVERRIDE_ALLOWLIST) {
    const [kopf, blatt] = pfad.split(".");
    if (blatt) {
      if (!erlaubteBlaetter.has(kopf)) erlaubteBlaetter.set(kopf, new Set());
      erlaubteBlaetter.get(kopf).add(blatt);
    } else {
      erlaubteFelder.add(kopf);
    }
  }

  for (const [feld, wert] of Object.entries(local)) {
    if (erlaubteFelder.has(feld)) {
      config[feld] = wert;
    } else if (erlaubteBlaetter.has(feld) && wert && typeof wert === "object") {
      const blaetter = erlaubteBlaetter.get(feld);
      const zusammen = { ...(config[feld] || {}) };
      for (const [unterfeld, unterwert] of Object.entries(wert)) {
        if (blaetter.has(unterfeld)) zusammen[unterfeld] = unterwert;
        else process.stderr.write(`Hinweis: '${feld}.${unterfeld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`);
      }
      config[feld] = zusammen;
    } else {
      process.stderr.write(`Hinweis: '${feld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`);
    }
  }
  return config;
}

// --- Reviewer-Vorflug in einer Session (Issue #269) ---
//
// Warum nicht `board.mjs issue-review check`: Dieser Probelauf laeuft im Runner-Prozess
// und beweist damit nur, dass der RUNNER das Werkzeug starten darf. Gebraucht wird es
// aber in den Review-Sessions — eigene Kindprozesse mit eigener Sandbox, eigener
// Netzwerk-Allowlist und eigenen Freigaben. In der Nacht vom 2026-08-08 lief der Vorflug
// sauber durch, waehrend `codex exec` in der Session an "Run outside of the sandbox"
// scheiterte und `board.mjs issue get` an der leeren Netzwerk-Allowlist: ein Lauf, der
// vollbesetzt startete und mit einem Reviewer arbeitete — genau der Zustand, den der
// harte Stopp aus Issue #233 verhindern soll.
//
// Und warum die Vorflug-Session `board.mjs issue-review check` nicht einfach erneut
// aufrufen darf: In `.claude/settings.json` steht `node .claude/kit/board.mjs*` in
// `sandbox.excludedCommands`. Jeder Aufruf von board.mjs ist damit von der Sandbox
// ausgenommen — gleich von wo. Eine Session, die darueber probt, meldete zuverlaessig
// `verfuegbar: true` und saegte damit denselben Ast an, nur eine Ebene tiefer und
// schwerer zu erkennen. Die Session startet das Reviewer-Kommando deshalb selbst,
// direkt und mit dem Prompt ueber stdin — so, wie es die Review-Rolle spaeter auch tut.

// Modell und Zeitlimit der Vorflug-Session sind bewusst unabhaengig von --model und
// --timeout-min. Wuerde der Vorflug beides erben, kostete jedes `--review --dry-run` eine
// volle Session im Modell des Laufs, nur um "alles steht" zu melden — und der Trockenlauf
// verlore genau die Eigenschaft, wegen der man ihn faehrt: billig und schnell zu sein.
const VORFLUG_MODEL = "haiku";
const VORFLUG_TIMEOUT_MS = 5 * 60 * 1000;

// Marker um den Befund. Ein Modell schreibt neben dem Befund immer auch Prosa; die Marker
// trennen die eine maschinenlesbare Stelle davon ab, statt raten zu muessen, welches
// JSON-Fragment im Fliesstext gemeint war.
const VORFLUG_START = "<<<VORFLUG";
const VORFLUG_ENDE = "VORFLUG>>>";

// Ein Prompt, der nichts verlangt (wie in board.mjs): Die Probe soll feststellen, ob der
// Reviewer laeuft — nicht, was er kann.
const VORFLUG_PROBE_PROMPT = "Antworte nur mit dem Wort OK.";

// Der Stempel, an dem der Gate-Code erkennt, dass ein Befund aus der richtigen Umgebung
// stammt. board.mjs stempelt seine Befunde mit "runner"; ein dort gestarteter Prozess kann
// diesen Wert nie erzeugen.
const UMGEBUNG_SESSION = "review-session";

/**
 * Waehlt das Issue der Tracker-Probe — deterministisch, nicht "irgendeines".
 *
 * Erste Wahl ist der erste Kandidat des Laufs: genau das Issue, an dem die erste
 * Review-Session scheitern wuerde. Ohne Kandidaten faellt die Wahl auf das erste Issue der
 * Gesamtliste. Liefert der Tracker gar keines, gibt es nichts zu holen (null) — die Probe
 * beschraenkt sich dann auf `issue list`.
 */
export function trackerProbeId(kandidaten, alleIssues) {
  const erstes = (kandidaten || [])[0] || (alleIssues || [])[0];
  return erstes ? String(erstes.id) : null;
}

/** Baut den Auftrag der Vorflug-Session. */
function vorflugPrompt(kommandoReviewers, trackerId) {
  const zeilen = [
    `Du bist der technische Vorflug eines Nacht-Reviews. Fuehre genau die Schritte unten aus`,
    `und gib zum Schluss genau einen Befund-Block aus.`,
    `Aendere dabei NICHTS: kein Commit, kein Board-Zug, keine neue Datei, keine Aenderung an`,
    `vorhandenen Dateien.`,
    ``,
    `SCHRITT 1 — Reviewer-Kommandos`,
  ];
  if (kommandoReviewers.length === 0) {
    zeilen.push(
      `Es ist kein Reviewer vom Typ "command" konfiguriert. Schritt 1 entfaellt; "reviewers"`,
      `bleibt im Befund eine leere Liste.`,
    );
  } else {
    zeilen.push(
      `Starte jedes dieser Kommandos GENAU EINMAL ueber das Bash-Tool, mit dem Prompt ueber stdin:`,
      ``,
      ...kommandoReviewers.map((r) => `  printf '%s\\n' '${VORFLUG_PROBE_PROMPT}' | ${r.command}   # Reviewer: ${r.name}`),
      ``,
      `Rufe dafuer AUF KEINEN FALL "board.mjs issue-review check" auf. Dieser Pfad ist von der`,
      `Sandbox ausgenommen und wuerde eine andere Umgebung messen als die, um die es hier geht.`,
      `Ein Reviewer gilt nur bei Exit-Code 0 als verfuegbar. Startfehler, Abbruch, Zeitueberschreitung`,
      `und Exit-Code ungleich 0 ergeben "verfuegbar": false; als "grund" die letzte Fehlerzeile.`,
    );
  }
  zeilen.push(
    ``,
    `SCHRITT 2 — Erreichbarkeit des Trackers`,
    `Fuehre aus:`,
    `  node .claude/kit/board.mjs issue list`,
    ...(trackerId ? [`  node .claude/kit/board.mjs issue get ${trackerId}`] : []),
    trackerId
      ? `Beide muessen mit Exit-Code 0 und auswertbarem JSON enden, sonst ist der Tracker nicht erreichbar.`
      : `Der Tracker fuehrt derzeit kein Issue. Setze "geprueft" auf "issue list" und zusaetzlich`
        + ` "uebersprungen" auf "kein Issue vorhanden"; "erreichbar" ist true, sofern "issue list" mit Exit-Code 0 endete.`,
    `Dieser Befund ist eigenstaendig — vermische ihn nicht mit der Reviewer-Verfuegbarkeit.`,
    ``,
    `SCHRITT 3 — Befund`,
    `Gib als ALLERLETZTE Ausgabe genau diesen Block aus, ohne Code-Fence und ohne Text danach:`,
    ``,
    VORFLUG_START,
    `{"reviewers": [{"name": "<name>", "verfuegbar": true, "grund": ""}], "tracker": {"erreichbar": true, "geprueft": "<kommando>", "grund": ""}}`,
    VORFLUG_ENDE,
  );
  return zeilen.join("\n");
}

/** Schneidet den Befund-Block aus der Session-Ausgabe. null = nichts Auswertbares. */
export function parseVorflugBefund(stdout) {
  const text = stdout || "";
  // lastIndexOf: Erklaert das Modell seinen Befund erst und gibt ihn dann aus, gilt der
  // letzte Block — der Auftrag lautet, ihn als allerletzte Ausgabe zu schreiben.
  const start = text.lastIndexOf(VORFLUG_START);
  if (start < 0) return null;
  const ende = text.indexOf(VORFLUG_ENDE, start);
  if (ende < 0) return null;
  try {
    const roh = JSON.parse(text.slice(start + VORFLUG_START.length, ende));
    return roh && typeof roh === "object" ? roh : null;
  } catch {
    return null;
  }
}

/**
 * Bringt den gemeldeten Befund in die Form, gegen die das Gate prueft.
 *
 * Der Stempel `umgebung` kommt vom Runner, nicht aus der Meldung: Er sagt aus, WO geprueft
 * wurde, und das weiss der Runner sicher — er hat die Session selbst gestartet. Aus der
 * Meldung uebernommen waere er eine Behauptung des Geprueften ueber sich selbst.
 *
 * Streng in beide Richtungen: Nur ein ausdrueckliches `verfuegbar: true` zaehlt, und ein
 * Reviewer, zu dem die Session nichts gemeldet hat, gilt als nicht verfuegbar. Ein
 * Schweigen als Zustimmung zu lesen waere genau der Fehlschluss, den dieses Issue behebt.
 */
export function normalisiereVorflug(roh, reviewers) {
  const gemeldet = new Map(
    (roh?.reviewers || []).filter((r) => r && r.name).map((r) => [String(r.name), r]),
  );
  const befunde = (reviewers || []).map((r) => {
    const basis = { name: r.name, kind: r.kind, umgebung: UMGEBUNG_SESSION };
    // claude-Reviewer laufen als Unterauftrag derselben Session-Art — dass eine
    // Vorflug-Session ueberhaupt geantwortet hat, ist ihr Verfuegbarkeitsnachweis.
    if (r.kind !== "command") return { ...basis, verfuegbar: true };
    const meldung = gemeldet.get(r.name);
    if (!meldung) {
      return { ...basis, verfuegbar: false, grund: "die Vorflug-Session hat zu diesem Reviewer nichts gemeldet" };
    }
    if (meldung.verfuegbar === true) return { ...basis, verfuegbar: true };
    return { ...basis, verfuegbar: false, grund: String(meldung.grund || "").trim() || "ohne Grund als nicht verfuegbar gemeldet" };
  });

  const t = roh?.tracker || {};
  const erreichbar = t.erreichbar === true;
  const tracker = {
    erreichbar,
    umgebung: UMGEBUNG_SESSION,
    geprueft: t.geprueft ? String(t.geprueft) : null,
    ...(t.uebersprungen ? { uebersprungen: String(t.uebersprungen) } : {}),
    ...(erreichbar ? {} : { grund: String(t.grund || "").trim() || "die Vorflug-Session hat keinen Tracker-Befund gemeldet" }),
  };
  return { reviewers: befunde, tracker };
}

/** Startet die Vorflug-Session — dieselbe Bauart wie eine Review-Session (runProcess). */
async function runVorflugSession(args, prompt) {
  const testCmd = process.env.NIGHT_VORFLUG_CMD;
  let cmd, cmdArgs;
  if (testCmd) {
    // Wie bei NIGHT_CLAUDE_CMD bewusst `sh`: Dieser Zweig ist ausschliesslich der
    // Test-Hook, und die Fake-Skripte der Testsuite sind POSIX-Shell (Issue #199).
    cmd = "sh";
    cmdArgs = ["-c", testCmd];
  } else {
    const permArgs = args.yolo ? ["--dangerously-skip-permissions"] : ["--permission-mode", "acceptEdits"];
    cmd = "claude";
    cmdArgs = ["-p", prompt, "--model", VORFLUG_MODEL, ...permArgs];
  }
  const timeoutMs = process.env.NIGHT_VORFLUG_TIMEOUT_MS
    ? Number(process.env.NIGHT_VORFLUG_TIMEOUT_MS)
    : VORFLUG_TIMEOUT_MS;
  const res = await runProcess(cmd, cmdArgs, {
    issueId: "vorflug", timeoutMs, useStream: false,
    extraEnv: { NIGHT_PROMPT: prompt, KIT_AGENT_MODEL: VORFLUG_MODEL, NIGHT_VORFLUG: "1" },
  });
  if (LOG_FILE) {
    appendFileSync(LOG_FILE, `--- Vorflug-Session ---\n${res.stdout || ""}${res.stderr || ""}\n`, "utf-8");
  }
  return { res, timeoutMs };
}

/**
 * Faehrt den Vorflug und liefert `{ sessionStartbar, grund, reviewers, tracker }`.
 *
 * Der Fehlerpfad der Session selbst ist ein eigener Befund und kein stiller Ausfall: Kann
 * der Runner die Vorflug-Session gar nicht erzeugen oder endet sie ohne auswertbaren Block,
 * steht das als `sessionStartbar: false` da. Ohne diesen Fall haette der Vorflug bei einem
 * kaputten Session-Start gar nichts zu sagen — und Schweigen liest sich am Ende wie ein OK.
 */
async function reviewerVorflug(args, reviewers, trackerId) {
  const kommandos = reviewers.filter((r) => r.kind === "command");
  const { res, timeoutMs } = await runVorflugSession(args, vorflugPrompt(kommandos, trackerId));

  const gescheitert = (grund) => ({
    sessionStartbar: false,
    grund,
    reviewers: reviewers.map((r) => ({ name: r.name, kind: r.kind, umgebung: UMGEBUNG_SESSION, verfuegbar: false, grund })),
    tracker: { erreichbar: false, umgebung: UMGEBUNG_SESSION, geprueft: null, grund },
  });

  if (res.error?.code === "ETIMEDOUT") return gescheitert(`Zeitlimit von ${timeoutMs} ms ueberschritten`);
  if (res.error?.code === "ENOENT") return gescheitert("claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?");
  if (res.error) return gescheitert(res.error.message);

  const roh = parseVorflugBefund(res.stdout);
  if (!roh) {
    return gescheitert(res.status === 0
      ? "die Vorflug-Session endete ohne auswertbaren Befund-Block"
      : `die Vorflug-Session endete mit Exit ${res.status} und ohne auswertbaren Befund-Block`);
  }
  return { sessionStartbar: true, grund: null, ...normalisiereVorflug(roh, reviewers) };
}

// --- Review-Schleife (Issue #235) ---

/**
 * Spur, die eine Review-Session am Issue hinterlaesst — ausser dem Marker.
 *
 * Bewusst nicht nur `comments.length`: Der lokale Tracker liefert bei `issue get`
 * **kein** comments-Feld, er haengt Kommentare an den Body an. GitHub, GitLab und
 * Toolbox liefern eines. Body-Laenge und Kommentarzahl zusammen tragen bei allen
 * vier — und beide zu vergleichen kostet nichts.
 */
function issueSpur(full) {
  return `${(full?.body || "").length}:${(full?.comments || []).length}`;
}

// Wie der lokale Tracker einen Kommentar an den Body anhaengt (board.mjs,
// commentIssue). Die Kopplung ist bewusst und eng begrenzt: Nur mit ihr laesst sich
// der neu angehaengte Abschnitt wieder in einzelne Kommentare zerlegen, und nur
// einzelne Kommentare haben eine "erste Zeile".
const LOKALER_KOMMENTARKOPF = /\n\n---\n\*\*Kommentar\*\* \([^\n)]*\)\n\n/;

/**
 * Die Kommentare, die WAEHREND dieser Session hinzugekommen sind (Issue #310).
 *
 * Zwei Speicherformen, ein Ergebnis: GitHub, GitLab und Toolbox liefern ein
 * `comments`-Array, der lokale Tracker haengt Kommentare an den Body. Dieselbe
 * Zweiteilung, die `issueSpur` schon beruecksichtigt.
 *
 * Gewertet wird nur das Neue. Ein Body-Vorschlag aus einem frueheren Lauf ist kein
 * Ergebnis dieser Session — er wuerde das Gate sonst dauerhaft offen halten, gerade
 * bei den Issues, die schon einmal durch einen Review gegangen sind.
 */
export function neueKommentare(vorher, nachher) {
  if (Array.isArray(nachher?.comments) || Array.isArray(vorher?.comments)) {
    const alt = (vorher?.comments || []).length;
    return (nachher?.comments || []).slice(alt).map((k) => String(k?.body ?? ""));
  }

  const altBody = vorher?.body || "";
  const neuBody = nachher?.body || "";
  // Kein Praefix heisst: Der Body selbst wurde geaendert. Dann ist der Anhang nicht
  // mehr sauber abzugrenzen — und der Marker-Zweig hat ohnehin schon entschieden.
  if (!neuBody.startsWith(altBody) || neuBody.length === altBody.length) return [];
  return neuBody
    .slice(altBody.length)
    .split(LOKALER_KOMMENTARKOPF)
    .map((t) => t.trim())
    .filter(Boolean);
}

const VORSCHLAG_KOPF = /^##\s*Body-Vorschlag,\s*Runde\s*(\d+)\s*$/;
const RUNDEN_KOPF = /^##\s*[^\n]*?,\s*Runde\s*(\d+)\s*$/;

/** Die erste Zeile eines Kommentars und der Rest — getrennt, weil nur die erste zaehlt. */
function kopfUndRest(text) {
  const zeilen = String(text || "").split(/\r\n|\r|\n/);
  return { kopf: zeilen[0] ?? "", hatText: zeilen.slice(1).some((z) => z.trim() !== "") };
}

/**
 * Traegt diese Session einen uebernehmbaren Body-Vorschlag bei (Issue #310)?
 *
 * Gueltig ist ein Kommentar, dessen ERSTE Zeile exakt `## Body-Vorschlag, Runde <n>`
 * lautet (n positiv) und unter der mindestens eine nicht leere Textzeile steht. Die
 * Bindung an die erste Zeile schliesst zitierte oder in Befunden erwaehnte Treffer
 * aus; die Textzeile schliesst die blosse Ueberschrift aus, mit der das Gate sonst
 * mit einem Handgriff zu umgehen waere.
 *
 * Bei mehreren Runden zaehlt die HOECHSTE in dieser Session geschriebene Runde:
 * Nur der letzte Vorschlag ist der uebernehmbare Text, fruehere sind Verlauf. Eine
 * Paarungspflicht je Runde bestrafte einen Lauf, der korrekt nur den Endstand
 * vorschlaegt. Kommt gar keine Rundenangabe vor, genuegt irgendein gueltiger
 * Vorschlag.
 */
export function bodyVorschlagVorhanden(kommentare) {
  const vorschlaege = [];
  let hoechsteRunde = null;

  for (const text of kommentare || []) {
    const { kopf, hatText } = kopfUndRest(text);
    const runde = RUNDEN_KOPF.exec(kopf);
    if (runde) {
      const n = Number(runde[1]);
      if (n > 0 && (hoechsteRunde === null || n > hoechsteRunde)) hoechsteRunde = n;
    }
    const m = VORSCHLAG_KOPF.exec(kopf);
    if (m && hatText && Number(m[1]) > 0) vorschlaege.push(Number(m[1]));
  }

  if (vorschlaege.length === 0) return false;
  return hoechsteRunde === null || vorschlaege.includes(hoechsteRunde);
}

/**
 * Laesst jeden Kandidaten von einer frischen /issue-review-Session pruefen.
 *
 * Erfolg ist dreistufig, weil der Skill den Marker nur bei befundfreiem Review setzt:
 *   1. Marker im Body              -> geprueft, ohne gewichtigen Befund
 *   2. kein Marker, aber neue Spur -> geprueft, MIT Befund; wartet planmaessig auf
 *                                     den Menschen. Ebenfalls ein Erfolg.
 *   3. weder noch                  -> die Session hat nichts hinterlassen
 *
 * Stufe 2 als Fehlschlag zu werten waere der teuerste Denkfehler hier: Genau die
 * Issues, bei denen sich der Review gelohnt hat, wuerden als gescheitert gemeldet.
 *
 * Kein Salvage-Pfad: Der prueft buildChecks und committet — fuer eine Session, die
 * keinen Code schreibt, gegenstandslos. Und kein Board-Move in keinem Ausgang; die
 * Kandidaten liegen bereits im Backlog.
 */
async function runReviewLoop(kandidaten, args) {
  const stufe = args.stufe ?? "issue";
  let sessions = 0;
  let ohneBefund = 0;
  let mitBefund = 0;
  let ohneErgebnis = 0;
  let schaerfungFehlt = 0;
  let uebersprungen = 0;
  let hardStop = false;

  for (const kandidat of kandidaten) {
    if (sessions >= args.max) {
      log(`  #${kandidat.id} ${kandidat.title} -> ueber --max ${args.max}, bleibt liegen.`);
      continue;
    }
    const vorher = board("issue", "get", String(kandidat.id));
    if (hasStageMarker(vorher.body, stufe)) {
      log(`#${kandidat.id} uebersprungen: traegt bereits einen Issue-Review-Marker.`);
      uebersprungen++;
      continue;
    }

    sessions++;
    log(`Review-Session ${sessions}/${args.max}: Issue #${kandidat.id} — ${kandidat.title}`);
    const spurVorher = issueSpur(vorher);
    const started = Date.now();
    const res = await runSession(kandidat.id, args, {
      prompt: `/issue-review #${kandidat.id}`,
      timeoutMs: REVIEW_TIMEOUT_MS,
    });
    const minutes = ((Date.now() - started) / 60000).toFixed(1);

    // Infrastruktur-Guard wie in der Implementierungsschleife (#149): Exit != 0 ohne
    // Timeout heisst, das CLI selbst ist gescheitert — mit dem Issue ist nichts falsch.
    // Harter Stopp ohne Kommentar, sonst kommentiert eine kaputte Umgebung den ganzen
    // Backlog voll.
    const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
    if (!timedOut && (res.error || res.status !== 0)) {
      const exitInfo = res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`;
      log(`  INFRASTRUKTUR-FEHLSCHLAG nach ${minutes} min (${exitInfo}): Session-Start gescheitert — harter Stopp, Issue #${kandidat.id} bleibt unangetastet.`);
      hardStop = true;
      break;
    }

    // Eine Review-Session arbeitet ausschliesslich am Board. Hinterlaesst sie
    // Aenderungen im Working Tree, hat sie etwas getan, was sie nicht sollte — und
    // die naechste Runde wuerde darauf aufbauen.
    if (!gitClean()) {
      log(`  HARTER STOPP: die Review-Session zu Issue #${kandidat.id} hat den Working Tree veraendert. Eine Review-Session darf keinen Code anfassen — bitte morgens sichten.`);
      hardStop = true;
      break;
    }

    const nachher = board("issue", "get", String(kandidat.id));
    if (hasStageMarker(nachher.body, stufe)) {
      ohneBefund++;
      log(`  Erfolg nach ${minutes} min: Issue #${kandidat.id} geprueft ohne Befund, Marker gesetzt.`);
    } else if (issueSpur(nachher) !== spurVorher) {
      // Befunde allein sind die halbe Arbeit. Der Skill verlangt den fertig
      // formulierten Body als uebernehmbaren Text; entstanden ist neunmal in Folge
      // nur die Beschreibung dessen, was zu aendern waere (Issue #310). Wer danach
      // implementiert, arbeitet gegen den alten Body und traegt die BLOCKER weiter.
      if (bodyVorschlagVorhanden(neueKommentare(vorher, nachher))) {
        mitBefund++;
        log(`  Erfolg nach ${minutes} min: Issue #${kandidat.id} geprueft mit Befund — kein Marker, wartet auf dich.`);
      } else {
        schaerfungFehlt++;
        log(`  Nach ${minutes} min: Issue #${kandidat.id} — Befunde vorhanden, aber kein Body-Vorschlag — Schaerfung fehlt.`);
        board("issue", "comment", String(kandidat.id),
          "--text", "Nachtlauf: Befunde vorhanden, aber kein Body-Vorschlag — Schaerfung fehlt. "
          + "Der uebernehmbare Body-Text (`## Body-Vorschlag, Runde <n>`) wurde nicht geschrieben; "
          + "bitte morgens aus den Befunden nachziehen oder /issue-review von Hand fahren.");
      }
    } else {
      ohneErgebnis++;
      log(`  Fehlschlag nach ${minutes} min: Issue #${kandidat.id} — die Session hat nichts hinterlassen, weiter mit dem naechsten.`);
      board("issue", "comment", String(kandidat.id),
        "--text", "Nachtlauf: Die Review-Session endete ohne Ergebnis — weder Marker noch Befunde. Bitte morgens sichten oder /issue-review von Hand fahren.");
    }
  }

  // schaerfungFehlt steht getrennt: Der Fall ist weder Erfolg noch leerer Lauf, und
  // morgens verlangt er einen anderen Handgriff als beide (Issue #310). Der
  // Gesamt-Exit bleibt trotzdem 0 — die Befunde stehen am Board, ein harter Stopp
  // waere unverhaeltnismaessig.
  log(`Nacht-Review beendet (Stufe ${stufe}): ${ohneBefund} ohne Befund, ${mitBefund} mit Befund, ${schaerfungFehlt} Schaerfung fehlt, ${uebersprungen} uebersprungen, ${ohneErgebnis} ohne Ergebnis, ${sessions} Session(s) gestartet${hardStop ? ", HARTER STOPP" : ""}.`);
  log(`Morgen-Ritual: Befunde sichten, Issues schaerfen, dann nach Ready ziehen — das GO bleibt deins. Protokoll: ${LOG_FILE}`);
  process.exit(hardStop ? 1 : 0);
}

// --- Hauptprogramm ---
//
// In eine Funktion gefasst, damit die reinen Funktionen dieser Datei importierbar
// sind, ohne dass der Runner losläuft (Issue #232). Vorher lag das Hauptprogramm auf
// Top-Level: Ein `import { selectReviewCandidates }` haette einen kompletten Nachtlauf
// gestartet. Dieselbe Loesung wie in board.mjs seit Issue #135.

async function main() {

  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(BOARD_PATH)) fail(`board.mjs nicht gefunden unter ${BOARD_PATH}`);
  const configPath = join(process.cwd(), ".claude", "workflow.config.json");
  if (!existsSync(configPath)) fail("Keine .claude/workflow.config.json — bitte im Projekt-Root starten.");
  config = ladeConfigMitOverrides(configPath);

  mkdirSync(join(process.cwd(), ".claude"), { recursive: true });
  LOG_FILE = join(process.cwd(), ".claude", `night-run-${new Date().toISOString().slice(0, 10)}.log`);

  // Routing-Label (Issue #159): nur Ready-Issues mit diesem Label werden verarbeitet,
  // alle anderen bleiben unangetastet liegen. --label none schaltet den Filter ab
  // (null = striktes ready[0], das Verhalten vor #159).
  const labelFilter = args.label === "none" ? null : args.label;
  const hasLabel = (issue) => labelFilter === null || (issue.labels || []).includes(labelFilter);

  // Vorflug-Warnung zum Routing-Label (Issue #179). Ein Vertipper im --label-Wert ist
  // syntaktisch gueltig: --label no filtert auf ein Label namens "no", findet nichts,
  // und der Lauf endet ohne Arbeit — im Protokoll nicht von einem abgearbeiteten Board
  // zu unterscheiden. Die Warnung trennt die beiden Faelle.
  //
  // Bewusst nur eine Warnung, kein Stopp: Ein Lauf ohne passende Issues ist ein
  // legitimer Zustand. Ein zusaetzlicher naechtlicher Abbruchgrund waere schlimmer als
  // das Problem, das er meldet (dieselbe Abwaegung wie bei der Versions-Drift, #172).
  let labelWarnungGezeigt = false;
  function warnWennLabelNirgendsVorkommt(ready) {
    if (labelWarnungGezeigt || labelFilter === null || ready.length === 0) return;
    if (ready.some(hasLabel)) return;
    labelWarnungGezeigt = true;
    const vorhanden = [...new Set(ready.flatMap((i) => i.labels || []))];
    log(`WARNUNG: kein Ready-Issue traegt das Label '${labelFilter}' — es wird nichts verarbeitet.`);
    log(`  In Ready vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
    log(`  Tippfehler im --label-Wert? Mit --label none laeuft der Nachtlauf ohne Label-Filter.`);
  }

  const modus = args.review ? "Review" : "Implementierung";
  const aktivesLabel = args.review ? args.reviewLabel : args.label;
  log(`Nacht-Runner startet (Modus ${modus}${args.review ? `, Stufe ${args.stufe ?? "issue"}` : ""}, max ${args.max} Sessions, Modell ${args.model}, Label ${aktivesLabel}${args.dryRun ? ", DRY-RUN" : ""}${args.yolo ? ", YOLO" : ""})`);
  if (args.yolo && !args.dryRun) {
    log("WARNUNG: --yolo umgeht ALLE Permission-Checks der Nacht-Sessions. Die Stop-Punkte haengen dann allein am Skill-Prompt.");
  }

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
    const andereAngabe = andere ? `v${andere}` : "unbekannt (Kopie ohne Versionsstempel)";
    log(
      `WARNUNG: Versions-Drift in .claude/kit/ — night.mjs ist v${KIT_VERSION}, ` +
      `board.mjs ist ${andereAngabe}. ` +
      `Die Installation ist halb aufgefrischt; bitte per install.mjs erneuern. Der Lauf geht weiter.`
    );
  }

  // Vorflug-Checks
  warnBeiVersionsDrift();
  const inProgress = board("issue", "list", "--status", "in_progress");
  if (inProgress.length > 0) {
    fail(`Issue(s) in In progress (${inProgress.map((i) => "#" + i.id).join(", ")}) — Crash-Rest? Bitte manuell aufraeumen, dann neu starten.`);
  }
  if (!gitClean()) fail("Working Tree ist nicht sauber. Bitte committen oder aufraeumen, dann neu starten.");
  // Die buildChecks-Pflicht gilt nur der Implementierung. Im Review-Modus wird nichts
  // gebaut und nichts committet — dort waere die Pruefung gegenstandslos und wuerde
  // Projekte ohne buildChecks zu --no-checks-ok zwingen fuer einen Lauf, der gar nichts baut.
  if (!args.review && (!config.buildChecks || config.buildChecks.length === 0) && !args.noChecksOk) {
    fail("buildChecks in workflow.config.json ist leer — nachts ohne Gate zu implementieren ist riskant. Override: --no-checks-ok");
  }

  // --- Review-Modus (Issue #233) ---
  //
  // Exklusiv zur Implementierungsschleife: Zwischen Review und Implementierung liegt
  // das GO. Beides in einer Nacht hiesse, es zu ueberspringen.
  if (args.review) {
    const reviewLabel = args.reviewLabel === "none" ? null : args.reviewLabel;
    const stufe = args.stufe ?? "issue";
    const backlog = board("issue", "list", "--status", "backlog");
    const { kandidaten, uebersprungen } = selectReviewCandidates(backlog, { label: reviewLabel, stufe });

    for (const u of uebersprungen) log(`  #${u.id} ${u.title} -> uebersprungen (${u.grund})`);

    // Vorflug (Issue #233, Umgebung korrigiert in #269). `issue-review check` ist fuer
    // sich eine Auskunft, kein Gate — der interaktive Skill fragt den Menschen, wenn
    // einer fehlt. Nachts fragt niemand, und ein unterbesetzter Lauf sieht am Board aus
    // wie ein vollstaendiger. Deshalb hier ein harter Stopp, bewusst ohne Opt-out: Wer
    // wissen will, ob alles steht, faehrt vorher --dry-run.
    //
    // Im Dry-Run selbst wird nur berichtet, nicht abgebrochen — sonst zeigt ausgerechnet
    // der Lauf nichts an, der das Problem aufklaeren soll. Die eine Vorflug-Session
    // laeuft auch dort, sonst pruefte der Trockenlauf etwas anderes als der Ernstfall.
    //
    // Die Reviewer-Liste kommt direkt aus der Config statt aus `issue-review check`: Der
    // Runner braucht hier nur die Kommandozeilen fuer den Auftrag der Vorflug-Session,
    // und die Verfuegbarkeit misst ohnehin nur noch die Session.
    const reviewerListe = (config.issueReview?.reviewers || [])
      .filter((r) => r && typeof r.name === "string")
      .map((r) => ({ name: r.name, kind: r.kind === "command" ? "command" : "claude", command: r.command }));
    const trackerId = trackerProbeId(kandidaten, kandidaten.length > 0 ? null : board("issue", "list"));

    log(`  Vorflug-Session startet (Modell ${VORFLUG_MODEL}, Tracker-Probe ${trackerId ? `Issue #${trackerId}` : "nur issue list"}).`);
    const vorflug = await reviewerVorflug(args, reviewerListe, trackerId);

    // Eine Vorflug-Session darf so wenig am Repository anfassen wie eine Review-Session.
    // Tut sie es doch, ist die Lage unklar und der Lauf endet hier — dieselbe Leitplanke
    // wie nach einer Review-Session (Issue #152), und sie gilt auch im Dry-Run: Ein
    // veraenderter Working Tree ist kein Befund, sondern ein Unfall.
    if (!gitClean()) {
      log("  HARTER STOPP: die Vorflug-Session hat den Working Tree veraendert. Sie darf nichts anfassen — bitte morgens sichten.");
      process.exit(1);
    }

    if (!vorflug.sessionStartbar) {
      log(`  Vorflug-Session nicht auswertbar: ${vorflug.grund}`);
    }
    for (const r of vorflug.reviewers) {
      log(`  Reviewer ${r.name} (${r.kind}) in ${r.umgebung}: ${r.verfuegbar ? "verfuegbar" : `NICHT verfuegbar — ${r.grund}`}`);
    }
    // Gar kein Reviewer konfiguriert: eigener Text, weil die Abhilfe eine andere ist —
    // nicht "Werkzeug installieren", sondern "Block uebernehmen".
    const KEIN_REVIEWER = "issueReview.reviewers ist leer oder fehlt — Block aus .claude/workflow.config.example.json uebernehmen";
    if (reviewerListe.length === 0) log(`  Kein Reviewer konfiguriert: ${KEIN_REVIEWER}`);
    log(`  Tracker (${vorflug.tracker.umgebung}): ${vorflug.tracker.erreichbar
      ? `erreichbar${vorflug.tracker.uebersprungen ? ` — issue get uebersprungen: ${vorflug.tracker.uebersprungen}` : ""}`
      : `NICHT erreichbar — ${vorflug.tracker.grund}`}`);

    // Drei getrennte Befunde, drei getrennte Meldungen. Ein `verfuegbar: false`, das in
    // Wahrheit ein toter Tracker war, schickt den Menschen morgens in die falsche Ecke.
    const probleme = [];
    if (!vorflug.sessionStartbar) probleme.push(`Die Vorflug-Session lieferte kein Ergebnis (${vorflug.grund})`);
    if (reviewerListe.length === 0) {
      probleme.push(`Kein Reviewer konfiguriert (${KEIN_REVIEWER}). Ohne Reviewer wuerde jede Session ergebnislos enden`);
    } else if (vorflug.sessionStartbar) {
      const fehlen = vorflug.reviewers.filter((r) => r.verfuegbar !== true).map((r) => `${r.name} (${r.grund})`);
      if (fehlen.length > 0) probleme.push(`Reviewer in der Session nicht verfuegbar: ${fehlen.join(", ")}`);
    }
    if (vorflug.sessionStartbar && vorflug.tracker.erreichbar !== true) {
      probleme.push(`Tracker aus der Session nicht erreichbar: ${vorflug.tracker.grund}`);
    }
    if (probleme.length > 0 && !args.dryRun) {
      fail(`${probleme.join(" | ")} — ein unterbesetzter Lauf sieht am Board aus wie ein vollstaendiger. Mit --review --dry-run pruefen, dann das fehlende Werkzeug installieren, die Freigaben der Sessions weiten oder den Reviewer aus issueReview.reviewers nehmen.`);
    }

    if (kandidaten.length === 0) {
      log(`Keine Review-Kandidaten im Backlog (Stufe ${stufe}) — nichts zu tun.`);
      if (reviewLabel !== null && backlog.length > 0) {
        const vorhanden = [...new Set(backlog.flatMap((i) => i.labels || []))];
        log(`  Im Backlog vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
        log(`  Tippfehler im --review-label-Wert? Mit --review-label none laeuft der Lauf ohne Label-Filter.`);
      }
      process.exit(0);
    }

    if (args.dryRun) {
      let geplant = 0;
      for (const k of kandidaten) {
        const full = board("issue", "get", String(k.id));
        if (hasStageMarker(full.body, stufe)) {
          log(`  #${k.id} ${k.title} -> wuerde uebersprungen (Review-Marker schon im Body)`);
        } else if (geplant >= args.max) {
          log(`  #${k.id} ${k.title} -> ueber --max ${args.max}, bliebe liegen`);
        } else {
          geplant++;
          log(`  #${k.id} ${k.title} -> Review-Session ${geplant}`);
        }
      }
      log(`Dry-Run beendet (Stufe ${stufe}): ${geplant} Review-Session(s) wuerden starten.`);
      process.exit(0);
    }

    await runReviewLoop(kandidaten, args);
    return;
  }

  // Dry-Run: Reihenfolge + Abhaengigkeits-Bewertung anzeigen, nichts bewegen, nichts starten.
  if (args.dryRun) {
    const ready = board("issue", "list", "--status", "ready");
    if (ready.length === 0) {
      log("Ready ist leer — nichts zu tun.");
      process.exit(0);
    }
    warnWennLabelNirgendsVorkommt(ready);
    const satisfied = satisfiedIds();
    const assumedDone = new Set(satisfied); // Annahme: frühere Runden gelingen
    let planned = 0;
    for (const issue of ready) {
      if (!hasLabel(issue)) {
        log(`  #${issue.id} ${issue.title} -> uebersprungen (kein Label '${labelFilter}')`);
        continue;
      }
      if (isFachlich(issue.title)) {
        log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (fachliches Issue, wird nicht implementiert)`);
        continue;
      }
      if (isIdee(issue.title)) {
        log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (Idee, wird nicht implementiert)`);
        continue;
      }
      if (isPlan(issue.title)) {
        log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (Plan-Dokument, wird nicht implementiert)`);
        continue;
      }
      if (hatKlaerenLabel(issue)) {
        log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (kit:klaeren, offene Entscheidung)`);
        continue;
      }
      const full = board("issue", "get", String(issue.id));
      // Dasselbe Review-Gate wie im echten Lauf (Issue #304). Bis dahin lief es hier
      // NICHT mit: Der Dry-Run bildete nur Praefixe, Abhaengigkeiten und --max ab und
      // wies Tickets als Session aus, die der echte Lauf zurueckstellt. Wer damit
      // prueft, ob die Nacht laeuft, bekaeme eine Antwort ueber einen anderen Lauf.
      let freigabe = { frei: true, art: "marker" };
      if (config.issueReview?.requiredBeforeReady) {
        freigabe = reviewFreigabe(full.body);
        if (!freigabe.frei) {
          log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (${GATE_ABLEHNUNG[freigabe.art].kurz()})`);
          continue;
        }
      }
      const unmet = parseDeps(full.body).filter((d) => !assumedDone.has(d));
      // Der Verzicht wird an der Session-Zeile mitgenannt, nicht in einer eigenen:
      // Wer den Dry-Run liest, soll die Freigabe dort sehen, wo das Ticket steht.
      const vermerk = freigabe.art === "verzicht" ? " (bewusst ohne Pruefung freigegeben)" : "";
      if (unmet.length > 0) {
        log(`  #${issue.id} ${issue.title} -> wuerde ins Backlog (Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt)`);
      } else if (planned >= args.max) {
        log(`  #${issue.id} ${issue.title} -> ueber --max ${args.max}, bliebe liegen`);
      } else {
        planned++;
        assumedDone.add(Number(issue.id));
        log(`  #${issue.id} ${issue.title} -> Session ${planned}${vermerk}`);
      }
    }
    log(`Dry-Run beendet: ${planned} Session(s) wuerden starten.`);
    process.exit(0);
  }

  // Echter Lauf
  let sessions = 0;
  let succeeded = 0;
  let deferred = 0;
  let iterations = 0;
  let hardStop = false;
  // Genau ein Salvage-Versuch pro Issue und Lauf (#167).
  const salvageAttempted = new Set();

  while (sessions < args.max && iterations < MAX_ITERATIONS) {
    iterations++;
    const ready = board("issue", "list", "--status", "ready");
    if (ready.length === 0) break;
    warnWennLabelNirgendsVorkommt(ready);

    // Routing-Label (#159): erstes Ready-Issue mit dem gesuchten Label; ungelabelte
    // Issues davor bleiben unangetastet. Kein Treffer -> Lauf endet wie bei leerem Ready.
    const top = labelFilter === null ? ready[0] : ready.find(hasLabel);
    if (!top) break;
    if (isFachlich(top.title)) {
      log(`#${top.id} uebersprungen: fachliches Issue ([Fachlich]), wird nicht implementiert.`);
      board("issue", "comment", String(top.id), "--text",
        `Nachtlauf: Fachliches Issue — wird nicht implementiert, bitte per /plan #${top.id} in technische Issues ueberfuehren.`);
      board("issue", "move", String(top.id), "backlog");
      deferred++;
      continue;
    }
    if (isIdee(top.title)) {
      log(`#${top.id} uebersprungen: Idee ([Idee]), wird nicht implementiert.`);
      board("issue", "comment", String(top.id), "--text",
        `Nachtlauf: Idee — braucht erst /plan #${top.id} + /issues, wird nachts nicht implementiert.`);
      board("issue", "move", String(top.id), "backlog");
      deferred++;
      continue;
    }
    if (isPlan(top.title)) {
      log(`#${top.id} uebersprungen: Plan-Dokument ([Plan]), wird nicht implementiert.`);
      board("issue", "comment", String(top.id), "--text",
        `Nachtlauf: Plan-Dokument — wird nicht implementiert, bitte per /issues #${top.id} in Arbeitspakete ueberfuehren.`);
      board("issue", "move", String(top.id), "backlog");
      deferred++;
      continue;
    }
    // Das Label bleibt dabei stehen: Es abzunehmen ist Sache des Menschen (A4).
    if (hatKlaerenLabel(top)) {
      log(`#${top.id} uebersprungen: traegt ${KLAEREN_LABEL}, eine offene Entscheidung wartet.`);
      board("issue", "comment", String(top.id), "--text",
        `Nachtlauf: Traegt kit:klaeren — eine offene Entscheidung wartet auf einen Menschen, wird nicht implementiert.`);
      board("issue", "move", String(top.id), "backlog");
      deferred++;
      continue;
    }
    const full = board("issue", "get", String(top.id));
    // Ungepruefte Issues zurueckstellen (Issue #223). Nur wenn ausdruecklich aktiviert:
    // Ein Kit-Update darf keinem Bestandsprojekt ueber Nacht den Runner anhalten, deshalb
    // ist der Default false. Anders als bei [Fachlich]/[Idee] wuerde der Runner ein
    // ungepruftes Issue nicht ablehnen — er wuerde es implementieren, und die Maengel
    // fielen erst im Code auf.
    //
    // Seit Issue #304 hat das Gate einen zweiten Freigabegrund: den bewussten Verzicht
    // (fachliche Quelle #285). Ein Ticket, das der Mensch ausdruecklich ohne Pruefung
    // freigegeben hat, traegt nie einen Marker — es hier zurueckzustellen hiesse, seine
    // Entscheidung jede Nacht aufs Neue zu ueberstimmen.
    if (config.issueReview?.requiredBeforeReady) {
      const freigabe = reviewFreigabe(full.body);
      if (!freigabe.frei) {
        const texte = GATE_ABLEHNUNG[freigabe.art];
        log(`#${top.id} ${texte.log(freigabe.detail)}`);
        board("issue", "comment", String(top.id), "--text", `Nachtlauf: ${texte.kommentar(top.id, freigabe.detail)}`);
        board("issue", "move", String(top.id), "backlog");
        deferred++;
        continue;
      }
      if (freigabe.art === "verzicht") {
        log(`#${top.id} bewusst ohne Pruefung freigegeben (Pruefung: Verzicht), wird implementiert.`);
      }
    }
    const unmet = parseDeps(full.body).filter((d) => !satisfiedIds().has(d));
    if (unmet.length > 0) {
      log(`#${top.id} zurueckgestellt: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt.`);
      board("issue", "comment", String(top.id), "--text",
        `Nachtlauf: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt (nicht in In review/Done) — Issue zurueckgestellt.`);
      board("issue", "move", String(top.id), "backlog");
      deferred++;
      continue;
    }

    sessions++;
    log(`Session ${sessions}/${args.max}: Issue #${top.id} — ${top.title}`);
    const started = Date.now();
    const res = await runSession(top.id, args);
    const minutes = ((Date.now() - started) / 60000).toFixed(1);

    const nowInReview = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
    if (nowInReview) {
      succeeded++;
      log(`  Erfolg nach ${minutes} min, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
      // Rest-Guard (Issue #152): Eine erfolgreiche Runde muss den Tree sauber
      // hinterlassen. Unkommittete Reste (z. B. Temp-Dateien) wuerden die
      // Diagnose der Folgerunde verfaelschen und koennten sie faelschlich als
      // dirty hart stoppen — darum hier stoppen, wo die Ursache noch klar ist.
      if (!gitClean()) {
        log(`  HARTER STOPP: erfolgreiche Runde zu Issue #${top.id} hat unkommittete Reste hinterlassen — bitte morgens sichten und aufraeumen.`);
        hardStop = true;
        break;
      }
      continue;
    }

    // Infrastruktur-Guard (Issue #149): Exit != 0 ohne Timeout heisst, das CLI selbst
    // ist gescheitert (Auth abgelaufen, Fehlkonfiguration) — mit dem Issue ist nichts
    // falsch. Harter Stopp ohne Kommentar und ohne Backlog-Move, sonst raeumt eine
    // kaputte Umgebung die ganze Ready-Spalte leer.
    const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
    if (!timedOut && (res.error || res.status !== 0)) {
      const exitInfo = res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`;
      const detail = (res.stderr || res.stdout || "").trim().split("\n").slice(0, 3).join(" | ");
      log(`  INFRASTRUKTUR-FEHLSCHLAG nach ${minutes} min (${exitInfo}): Session-Start gescheitert — harter Stopp, Issue #${top.id} bleibt unangetastet.`);
      if (detail) log(`  CLI-Meldung: ${detail}`);
      hardStop = true;
      break;
    }

    if (!gitClean()) {
      // Salvage (#167): Bevor der Lauf hart stoppt, pruefen wir selbst, ob die Arbeit
      // inhaltlich fertig ist. Gruene buildChecks sind das Indiz dafuer, dass die
      // Session nur ihr Ergebnis verloren hat (Hintergrund-Check ohne Folge-Turn) und
      // nicht wirklich gescheitert ist. Genau ein Versuch pro Issue.
      if (!salvageAttempted.has(String(top.id))) {
        salvageAttempted.add(String(top.id));
        const checks = verifyChecksForSalvage(config);
        if (checks.ok) {
          log(`  SALVAGE-VERSUCH gestartet (Checks extern verifiziert gruen): Issue #${top.id} — Zwischenstand wird gegen das Issue geprueft.`);
          await runSession(top.id, args, {
            prompt: salvagePrompt(top.id, checks.output, checks.formatFixCmd),
            timeoutMs: SALVAGE_TIMEOUT_MS,
            extraEnv: { NIGHT_SALVAGE: "1" },
          });
          const salvaged = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
          if (salvaged && gitClean()) {
            succeeded++;
            log(`  Salvage erfolgreich, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
            board("issue", "comment", String(top.id), "--text",
              "Nachtlauf: Die regulaere Runde endete ohne Board-Ergebnis, die Pflicht-Checks waren extern aber gruen. Eine Salvage-Session hat den Zwischenstand geprueft, committet und das Issue nach In review verschoben. Bitte beim Review besonders auf Vollstaendigkeit achten.");
            continue;
          }
          log(`  SALVAGE-VERSUCH gescheitert — harter Stopp. Issue #${top.id}${salvaged ? " ist in In review, aber der Tree ist weiterhin dirty" : " weiterhin nicht in In review"}.`);
          board("issue", "comment", String(top.id), "--text",
            "Nachtlauf: Pflicht-Checks extern gruen, aber die Salvage-Session konnte den Zwischenstand nicht sauber abschliessen — Lauf hart gestoppt. Bitte morgens manuell sichten.");
          hardStop = true;
          break;
        }
        log(`  Salvage nicht moeglich: buildChecks sind rot — die Runde ist wirklich gescheitert.`);
      }
      log(`  FEHLSCHLAG nach ${minutes} min: Issue #${top.id} nicht in In review UND Working Tree dirty — harter Stopp.`);
      board("issue", "comment", String(top.id), "--text",
        "Nachtlauf: Runde fehlgeschlagen und Working Tree nicht sauber hinterlassen — Lauf hart gestoppt. Bitte morgens manuell sichten.");
      hardStop = true;
      break;
    }

    log(`  Fehlschlag nach ${minutes} min: Issue #${top.id} nicht in In review, Tree sauber — Issue ins Backlog, weiter.`);
    board("issue", "comment", String(top.id), "--text",
      "Nachtlauf: Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter.");
    board("issue", "move", String(top.id), "backlog");
    deferred++;
  }

  log(`Nacht-Runner beendet: ${succeeded} erfolgreich, ${deferred} zurueckgestellt, ${sessions} Session(s) gestartet${hardStop ? ", HARTER STOPP" : ""}.`);
  log(`Morgen-Ritual: /review -> Test -> push main. Protokoll: ${LOG_FILE}`);
  process.exit(hardStop ? 1 : 0);
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen.
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) await main();
