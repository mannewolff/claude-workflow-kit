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
 *   --kette            Nacht-Kette (Plan #638): je [Fachlich]-Issue mit dem Label aus
 *                      night.kette.label eine Kette aus /techplan, Formpruefung,
 *                      /issue-review — im eigenen Worktree, mit Zeit- und Kostenbudget.
 *                      --max zaehlt hier Ketten (Default 3). Laeuft neben einer
 *                      Umsetzungsnacht; ein Issue in In progress haelt sie nicht auf.
 *                      Ausnahme unter Variante B: Deren Umsetzungsstufe baut in der
 *                      Hauptkopie und nimmt dafuer denselben Lock wie die
 *                      Umsetzungsnacht (.claude/night-umsetzung.lock, Issue #696) —
 *                      wer ihn gehalten vorfindet, laesst die Umsetzung aus.
 *   --max <N>          maximale Session-Starts pro Lauf (Default 10)
 *   --model <id>       Modell der Nacht-Sessions (Default claude-opus-5)
 *   --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
 *   --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
 *   --yolo             --dangerously-skip-permissions statt acceptEdits (Warnung!)
 *   --no-checks-ok     Start ohne Pruefung der Paketstufe erlauben
 *   --label <name>     verarbeitet nur Ready-Issues mit diesem Label (Default
 *                      kit:nightrun); --label none schaltet den Filter ab (altes
 *                      Verhalten: striktes ready[0])
 *   --verbose          Live-Verlaufsprotokoll: liest den stream-json-Output der
 *                      Session und loggt Tool-Aufrufe und Text-Snippets mit
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
 * Runner deshalb die buildChecks der Paketstufe selbst (nicht mutationCommand —
 * das ist ein nachgelagerter Check, kein Blocker fuer diese Entscheidung). Sind sie gruen,
 * bekommt genau eine Salvage-Session pro Issue die Chance, den Zwischenstand
 * gegen das Issue zu pruefen, zu committen und erst bei sauberem Arbeitsbaum das
 * Board zu bewegen. Rote Checks -> harter Stopp. Endet die Session nicht mit
 * sauberem Baum UND der Karte in In review, stoppt der Lauf ebenfalls hart und
 * unterscheidet dabei drei Endzustaende (Issue #672): kein Commit und kein
 * Board-Zug (gescheitert), Commit ohne Board-Zug (unvollstaendig) und In review
 * bei unsauberem Baum (widerspruechlich). Immer an; ein Opt-out-Flag waere in der
 * Praxis wirkungslos, weil man es nachts vergisst.
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
 * `[Idee]` (rohe Idee ohne /techplan-Zyklus, #192) und `[Plan]` (Plandokument, muss erst
 * per /issues in Arbeitspakete zerlegt werden, #276).
 *
 * Seit Stufe 2 des Prozess-Umbaus (Plan #638) kennt diese Datei zwei Betriebsarten: die
 * Implementierung (ohne Flag) und die Nacht-Kette (--kette). Die Flags --review,
 * --erzeuge, --stufe, --review-label und --erzeuge-label bleiben dem Parser bekannt und
 * enden mit einer Meldung, die das sagt — ein "unbekanntes Argument" liesse den
 * Menschen raten, ob er sich vertippt hat.
 *
 * Nacht-Kette (--kette, Plan #638, Issue #643): Ein [Fachlich]-Issue mit dem Label aus
 * night.kette.label ist der Auftrag; der Start entfernt das Label (jedes Setzen
 * autorisiert genau eine Kette). Je Kette ein eigener Worktree unter dem
 * Temp-Verzeichnis, darin nacheinander /techplan #F (Stufe plan), issue check-form mit
 * hoechstens night.kette.korrekturrunden Korrektursessions, /issue-review #M (Stufe
 * review), /issues #M (Stufe pakete, Formpruefung je Paket) und eine lesende
 * Abdeckungs-Session, die die Pakete gegen den Fachplan haelt (Stufe abdeckung, ihr Text
 * steht im Ergebnisstand). Aeltere Plandokumente zum selben Fachplan bekommen den
 * Kommentar "Ueberholt durch Plan #M". Jede Stufe endet fertig, angehalten (genau eine Stopp-Frage: Kommentar
 * "## Kette angehalten" und kit:klaeren am Fachplan) oder abgebrochen (Zeitbudget der
 * Stufe, Kostenbudget der Kette, technischer Fehler, kein Plan entstanden). Kandidaten
 * ausserhalb von Backlog oder mit kit:klaeren werden uebersprungen, ihr Label bleibt.
 * Der Ergebnisstand traegt die Art "kette".
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
 *   NIGHT_NACHBAR_DIR Verzeichnis, aus dem night.mjs board.mjs und checks.mjs
 *                     laedt (statt neben der eigenen Datei). Nur fuer Tests.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, realpathSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir, homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Woher diese Datei ihre beiden Nachbarn holt — board.mjs und checks.mjs. Der Pfad
// steht hier oben, weil schon der erste dynamische Import unten ihn braucht.
//
// Bewusst der Nachbarpfad und nicht BOARD_PATH: KIT_ROOT verlegt die CLI-AUFRUFE in ein
// fremdes Projekt (Test-Hook); eine reine Funktion holt man sich dort nicht her, sondern
// aus dem board.mjs, das zu dieser Datei gehoert.
//
// NIGHT_NACHBAR_DIR ist die eine Ausnahme, und auch sie ist ein reiner Test-Hook
// (Issue #498): Er verlegt die Suche nach den Nachbarn, aufgeloest mit resolve() wie
// KIT_ROOT. Ohne ihn ergibt sich dieselbe Modul-URL wie bei einem literalen
// "./board.mjs". Es gibt ihn, weil die Ersatzfunktionen weiter unten sonst
// unerreichbar sind: Sie laufen nur, wenn der Nachbar fehlt, und das war bisher nur
// mit einer Kopie im Temp-Verzeichnis herstellbar — deren Treffer bildet SonarCloud
// nicht auf kit/night.mjs ab. Zeigt der Hook auf ein Verzeichnis mit einem eigenen
// board.mjs, wird dieses geladen; das ist Absicht und nicht zu verhindern.
const NACHBAR_DIR = process.env.NIGHT_NACHBAR_DIR ? resolve(process.env.NIGHT_NACHBAR_DIR) : __dirname;
const NACHBAR_BOARD = join(NACHBAR_DIR, "board.mjs");
const NACHBAR_CHECKS = join(NACHBAR_DIR, "checks.mjs");
const NACHBAR_AUFWAND = join(NACHBAR_DIR, "aufwand.mjs");

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
 * Ueber NACHBAR_BOARD und nicht ueber den literalen Spezifizierer "./board.mjs":
 * Ein Literal haengt an keiner Pfadkonstante, NIGHT_NACHBAR_DIR erreichte dieses
 * `.catch` also nie — und die beiden Board-Importe dieser Datei zeigten unter Hook
 * auf verschiedene Dateien (Issue #498).
 */
const { fenceLauf } = await import(pathToFileURL(NACHBAR_BOARD).href).catch(() => ({
  fenceLauf: () => {
    throw new Error("board.mjs fehlt neben night.mjs — der Nacht-Runner braucht den Board-Adapter.");
  },
}));

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

// Dasselbe fuer die Aufwands-Auswertung (Issue #752): Sie wird als Kindprozess gerufen,
// nicht importiert, und misst das Projekt, in dem der Runner arbeitet — also derselbe
// KIT_ROOT-Weg wie beim Board. Die reine Textform kommt dagegen ueber NACHBAR_AUFWAND,
// genau wie board.mjs zweimal auftaucht: einmal als CLI, einmal als Funktion.
const AUFWAND_PATH = process.env.KIT_ROOT
  ? join(resolve(process.env.KIT_ROOT), ".claude", "kit", "aufwand.mjs")
  : join(__dirname, "aufwand.mjs");

// Die Praefix-Erkennung kommt seit Issue #464 aus demselben Modul, statt hier ein
// zweites Mal als Regex zu stehen. Ihr Fallback WIRFT wie der obige und liefert
// bewusst kein `false`: Ein stilles `false` liesse ein Plandokument als
// Arbeitspaket durch — der Runner implementierte es, und am Board saehe das wie
// ein Erfolg aus. Genau davor schuetzen die Praefixe.
const praefixFallback = (was) => (title) => {
  throw new Error(`board.mjs liegt nicht neben night.mjs (${NACHBAR_BOARD}) — das Praefix ${was} ist nicht erkennbar.`);
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
} = existsSync(NACHBAR_BOARD)
  ? await import(pathToFileURL(NACHBAR_BOARD).href)
  : {
      istFachlich: praefixFallback("[Fachlich]"),
      istPlan: praefixFallback("[Plan]"),
      istIdee: praefixFallback("[Idee]"),
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
const zusammenfassungPfadFallback = (root) => {
  throw new Error(`checks.mjs liegt nicht neben night.mjs (${NACHBAR_CHECKS}) — der Ort der Pruef-Zusammenfassung ist unbekannt.`);
};
const { zusammenfassungPfad } = existsSync(NACHBAR_CHECKS)
  ? await import(pathToFileURL(NACHBAR_CHECKS).href)
  : { zusammenfassungPfad: zusammenfassungPfadFallback };

// Die Form des Befundblocks kommt aus aufwand.mjs und wird NICHT nachgebaut (Issue #752):
// Es ist die eine Form, die an beiden Ausgabestellen erscheint — im Laufprotokoll hier und
// in `/push-main`. Ein zweiter Textbau waere eine zweite Wahrheit darueber, wie ein Befund
// aussieht, und die beiden liefen bei der ersten Aenderung auseinander.
//
// Bedingt und mit werfendem Ersatz wie die beiden Nachbarn darueber: `--version` und
// `--help` antworten auch ohne Nachbarn (Issue #170). Der Wurf ist hier ungefaehrlich —
// aufwandAuswerten() faengt ihn ab und macht daraus die eine Protokollzeile, die ein
// Fehlschlag der Auswertung sein darf (E15).
const befundTextFallback = () => {
  throw new Error(`aufwand.mjs liegt nicht neben night.mjs (${NACHBAR_AUFWAND})`);
};
const { befundText } = existsSync(NACHBAR_AUFWAND)
  ? await import(pathToFileURL(NACHBAR_AUFWAND).href)
  : { befundText: befundTextFallback };

// Nur fuer Tests; der Runner nutzt die Bindungen direkt, nicht ueber dieses Objekt.
// Ohne den Export ist der Identitaetsnachweis nicht fuehrbar — ob im Regelbetrieb die
// echte Funktion oder ihr Ersatz gebunden ist, sieht man von aussen sonst an keinem
// Ergebnis, und zusammenfassungPfad bliebe ganz unerreichbar (Issue #498).
export const nachbarn = {
  fenceLauf,
  istFachlich: isFachlich,
  istPlan: isPlan,
  istIdee: isIdee,
  zusammenfassungPfad,
};

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "2.0.1";
const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_LABEL = "kit:nightrun";
const DEFAULT_MAX_SESSIONS = 10;
// --max der Kette zaehlt Ketten (Plan #638, A13): dieselben drei wie fruehere
// Ausgangsdokumente je Nacht.
const DEFAULT_MAX_KETTEN = 3;
const MAX_ITERATIONS = 500; // Notbremse gegen Endlosschleifen, weit ueber jedem realen Lauf

// --- Argumente ---

function printHelp() {
  process.stdout.write(`Nacht-Runner: arbeitet die Ready-Spalte unbeaufsichtigt ab —
pro Issue eine frische Headless-Session (/implement-next #N), sequenziell.
Erfolg wird am Board gemessen (Issue in In review). Gepusht wird nie.

Aufruf (im Projekt-Root):
  node .claude/kit/night.mjs [Flags]

Flags:
  --kette            Nacht-Kette statt Implementierung: je [Fachlich]-Issue mit dem
                     Label aus night.kette.label (Default kit:night) eine Kette aus
                     /techplan, Formpruefung, /issue-review, /issues und Abdeckung im
                     eigenen Worktree, mit Nachtbericht am Fachplan. Ein zweites Label
                     aus night.kette.varianteBLabel (Default kit:durchziehen) waehlt
                     Variante B statt Variante A; ohne dieses Label laeuft Variante A.
                     --max zaehlt Ketten (Default 3); --label gilt hier nicht, das
                     Label kommt aus der Config. Budgets in night.kette.
  --max <N>          maximale Session-Starts pro Lauf (Default 10)
  --model <id>       Modell der Nacht-Sessions (Default ${DEFAULT_MODEL})
  --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
  --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
  --yolo             --dangerously-skip-permissions statt acceptEdits (Warnung!)
  --no-checks-ok     Start ohne Pruefung der Paketstufe erlauben
  --label <name>     nur Ready-Issues mit diesem Label verarbeiten
                     (Default ${DEFAULT_LABEL}); --label none schaltet den
                     Filter ab (altes Verhalten: striktes erstes Ready-Issue)
  --verbose          Live-Verlaufsprotokoll: Tool-Aufrufe und Text-Snippets
                     der laufenden Session mitloggen (via stream-json)
  --version          Kit-Stand dieser Datei
  --help, -h         diese Uebersicht

Salvage (immer an): Endet eine Runde ohne Board-Ergebnis, aber mit Aenderungen im
Working Tree, fuehrt der Runner die buildChecks der Paketstufe selbst aus — ohne
bereichsbezogene Auswahl, denn was die Runde angefasst hat, weiss niemand. Sind sie gruen, bekommt
genau eine Salvage-Session pro Issue die Chance, den Zwischenstand gegen das Issue
zu pruefen, zu committen und erst bei leerem "git status --porcelain" nach In review
zu verschieben (Zeitlimit 10 min). Rote Checks fuehren zum harten Stopp, und ebenso
jeder Salvage, der nicht mit sauberem Baum und der Karte in In review endet — das
Protokoll nennt dann einen von drei Endzustaenden: "SALVAGE-VERSUCH gescheitert"
(kein Commit, Board nicht bewegt), "SALVAGE UNVOLLSTAENDIG" (Commit, Board nicht
bewegt) oder "SALVAGE WIDERSPRUECHLICH" (In review, aber Arbeit blieb liegen).

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

// Die drei Sorten Argument als Tabellen statt als Kette (Issue #404). Der Schnitt
// folgt dem, was ein Flag mit dem Lauf macht, nicht seinem Namen: Auskunft geben und
// enden, einen Wert mitbringen, oder einen Schalter umlegen. Wer ein Flag ergaenzt,
// traegt es in genau eine Tabelle ein und aendert die Schleife nicht mehr.

// Auskunftsflags: antworten sofort und beenden den Prozess. Sie greifen vor allen
// Vorflug-Checks, damit sie auch in einem Verzeichnis ohne Config und ohne board.mjs
// funktionieren.
const zeigeHilfe = () => { printHelp(); process.exit(0); };
const SOFORT_FLAGS = {
  "--help": zeigeHilfe,
  "-h": zeigeHilfe,
  "--version": () => {
    process.stdout.write(`night.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
    process.exit(0);
  },
};

// Flags mit Wert: der jeweils naechste argv-Eintrag, bei Zahlen konvertiert. Ob der
// Wert plausibel ist, entscheidet pruefeArgs — nicht diese Tabelle.
const WERT_FLAGS = {
  "--max": (args, wert) => { args.max = Number(wert); },
  "--model": (args, wert) => { args.model = wert; },
  "--label": (args, wert) => { args.label = wert; args.labelGesetzt = true; },
  "--timeout-min": (args, wert) => { args.timeoutMin = Number(wert); },
};

// Schalter ohne Wert: Flag -> Feldname, immer auf true.
const SCHALTER_FLAGS = {
  "--kette": "kette",
  "--dry-run": "dryRun",
  "--yolo": "yolo",
  "--no-checks-ok": "noChecksOk",
  "--verbose": "verbose",
};

// Die Flags der beiden entfallenen Betriebsarten (Plan #638, A1). Sie bleiben dem Parser
// bekannt, damit die Meldung sagt, WAS es nicht mehr gibt: Ein "unbekanntes Argument"
// liesse den Menschen raten, ob er sich vertippt hat. Die Meldung faellt vor jedem
// Board-Zugriff und vor dem Ergebnisstand — es gibt keinen Lauf, der zu berichten haette.
const ENTFALLENE_FLAGS = new Set(["--review", "--erzeuge", "--stufe", "--review-label", "--erzeuge-label"]);

function entfallenesFlag(a) {
  const zusatz = a === "--stufe" ? ", und die Kette hat keine Stufen" : "";
  fail(`${a} gibt es seit Stufe 2 nicht mehr; die Nacht-Kette ist --kette${zusatz}.`);
}

function parseArgs(argv) {
  // max bleibt bewusst null: Der Default haengt am Modus, und der steht erst fest,
  // wenn alle Flags gelesen sind. Ein unbedingtes 10 hier machte einen modusabhaengigen
  // Wert von einem gesetzten ununterscheidbar (Issue #517). pruefeArgs loest ihn auf.
  const args = { max: null, model: DEFAULT_MODEL, timeoutMin: 60, dryRun: false, yolo: false, noChecksOk: false, verbose: false, label: DEFAULT_LABEL, labelGesetzt: false, kette: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (ENTFALLENE_FLAGS.has(a)) entfallenesFlag(a);
    if (Object.hasOwn(SOFORT_FLAGS, a)) {
      SOFORT_FLAGS[a]();
      continue;
    }
    if (Object.hasOwn(WERT_FLAGS, a)) {
      WERT_FLAGS[a](args, argv[++i]);
      continue;
    }
    if (Object.hasOwn(SCHALTER_FLAGS, a)) {
      args[SCHALTER_FLAGS[a]] = true;
      continue;
    }
    fail(`Unbekanntes Argument: ${a} — siehe --help`);
  }
  pruefeArgs(args);
  return args;
}

/**
 * Loest den Default von `max` auf (Issue #517, seit Plan #638 nur noch ein Feld).
 *
 * `max` ist beim Einlesen null, damit ein gesetzter Wert von einem Default unterscheidbar
 * bleibt. Ein gesetzter Wert gewinnt — auch ein unbrauchbarer: `--max abc` faellt hier NICHT
 * auf den Default zurueck, sondern geht als NaN in die Zahlenpruefung und wird dort
 * abgewiesen. Exportiert, weil `parseArgs`/`pruefeArgs` es nicht sind.
 */
export function loeseModusDefaults(args) {
  if (args.kette) {
    // Die Kette baut nichts und committet nichts: Die buildChecks-Pflicht gilt ihr
    // nicht, und --max zaehlt Ketten, nicht Sessions (Plan #638, A13).
    return { max: args.max ?? DEFAULT_MAX_KETTEN, noChecksOk: true };
  }
  return { max: args.max ?? DEFAULT_MAX_SESSIONS };
}

/**
 * Prueft die eingelesenen Argumente auf Plausibilitaet und bricht bei Verstoss ab.
 *
 * Getrennt vom Einlesen, weil es eine andere Frage ist: parseArgs uebersetzt argv in
 * ein Objekt, diese Funktion entscheidet, ob damit gearbeitet werden darf.
 *
 */
function pruefeArgs(args) {
  // Der Abend hat genau eine Geste: Das Kettenlabel kommt aus night.kette.label, ein
  // zweiter Weg zum selben Wert waere eine zweite Wahrheit (Plan #638, E6).
  if (args.kette && args.labelGesetzt) {
    fail("--kette kennt kein --label — das Kettenlabel steht in night.kette.label der workflow.config.json.");
  }
  // Die Aufloesung steht VOR der Zahlenpruefung: Die Vorbelegung ist null, und die
  // Pruefung wiese sonst jeden Aufruf ohne --max ab.
  Object.assign(args, loeseModusDefaults(args));

  if (!Number.isFinite(args.max) || args.max < 1) fail("--max braucht eine Zahl >= 1");
  if (!Number.isFinite(args.timeoutMin) || args.timeoutMin < 1) fail("--timeout-min braucht eine Zahl >= 1");
}

// --- Logging ---

let LOG_FILE = null;

// Der maschinenlesbare Ergebnisstand (Issue #486): Pfad und Objekt liegen im
// Modul-Zustand wie LOG_FILE darueber, nicht im Kontext — nur so erreicht auch
// fail() sie, das von ueberall her abbricht. Beide bleiben null, solange der Lauf
// --dry-run faehrt; dann schreibt schreibeErgebnisstand() nichts.
let ERGEBNIS_FILE = null;
let LAUF = null;
// Der Zeitstempel des Laufs, wie er im Dateinamen des Ergebnisstands steht: Die Kette
// nennt ihn im Worktree-Namen und im Bericht.
let LAUF_STEMPEL = null;
// Die Budgets der Kette, geladen in vorbereiten() — Modul-Zustand wie `config`, weil
// ART_LABEL und die Stufen sie brauchen, ohne dass jede Funktion sie durchreicht.
let KETTE_BUDGET = null;
// Die Budget-Felder, die aus den Defaults stammen (Issue #659) — geladen zusammen mit
// KETTE_BUDGET, gezeigt im Protokoll und am Lauf-Kopf.
let KETTE_BUDGET_AUS_DEFAULT = [];

// Der Grund des zuletzt gemerkten harten Stopps (Issue #558). Er nimmt denselben Weg
// wie die Fehlerklasse — Modul-Zustand statt neuem Rueckgabewert —, damit die
// Rueckgabewerte der hardStop-Pfade unveraendert bleiben (Issue #488). Gebraucht wird
// er zweimal: beim Anheften an die betroffene Einheit und, falls das ausbleibt, vom
// Sicherheitsnetz in laufAbschliessen().
let STOPP_GRUND = "";

// Die geladene Config auf Modulebene, zugewiesen in main() (Issue #232). Dasselbe
// Muster wie LOG_FILE darueber, und aus demselben Grund: gitReste() braucht sie, wird
// aber aus der Hauptschleife heraus aufgerufen. Seit das Hauptprogramm in main()
// steckt (damit reine Funktionen importierbar sind), waere eine dort deklarierte
// Konstante fuer gitReste() unsichtbar.
let config = null;

// Der Pfad, aus dem `config` stammt (Issue #711). Die Runde liest `night.stufen` und
// `night.stufenRegel` unmittelbar vor jedem Paket von dort neu; ohne den gemerkten Pfad
// muesste sie ihn ein zweites Mal zusammensetzen, und zwei Herleitungen desselben Pfades
// liefen bei der ersten Aenderung auseinander.
let CONFIG_PATH = null;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stdout.write(line + "\n");
  if (LOG_FILE) appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

/**
 * Bricht den Lauf ab und schliesst den Ergebnisstand ab (Issue #488).
 *
 * Die Klasse sagt, WO es gerissen ist: `umgebung`, `tracker`, `zustand`,
 * `harterStopp` oder `unbekannt`. Sie steht hier und nicht nur im Fehlertext, weil eine Auswertung sonst
 * Meldungen parsen muesste; der Text bleibt trotzdem erhalten, damit der Mensch die
 * Einordnung nachpruefen kann.
 *
 * Der Abschluss gehoert an genau diese Stelle: Die Datei kennt kein try/finally und
 * keinen exit-Handler, und ein Stand, der erst am regulaeren Ende entstuende, fehlte
 * im interessantesten Fall. Ohne ihn saehe ein erkannter Stopp aus wie ein Absturz.
 */
function fail(msg, klasse = "unbekannt") {
  const line = `Fehler: ${msg}`;
  process.stderr.write(line + "\n");
  if (LOG_FILE) appendFileSync(LOG_FILE, line + "\n", "utf-8");
  if (LAUF) {
    LAUF.fehlerklasse = klasse;
    LAUF.fehlerText = msg;
    LAUF.abschluss = "harterStopp";
    schreibeErgebnisstand();
    laufMelden();
  }
  process.exit(1);
}

/**
 * Vermerkt Fehlerklasse UND Grund eines harten Stopps, der NICHT ueber fail() laeuft
 * (Issue #488, um den Grund erweitert in #558).
 *
 * Die hardStop-Pfade in werteRunde, behandleDirtyRunde, versucheSalvage,
 * reviewRundeGestoppt und fuehreVorflug geben einen String oder ein Ja/Nein zurueck und
 * beenden den Prozess nicht selbst — sie hinterlegen beides hier, bevor sie
 * zurueckkehren. Ihre Rueckgabewerte bleiben dadurch unveraendert.
 *
 * Der Grund ist Pflichtparameter und keine Option: Eine Fehlerklasse ohne Grund ist
 * genau der Zustand, den Issue #558 abgeschafft hat. Er ist woertlich der Text, der
 * ohnehin ins Protokoll geht — dieser Weg reicht ihn weiter, er ermittelt ihn nicht neu.
 */
function merkeHartenStopp(klasse, grund) {
  STOPP_GRUND = grund;
  if (LAUF) {
    LAUF.fehlerklasse = klasse;
    schreibeErgebnisstand();
  }
}

/**
 * Heftet den gemerkten Stoppgrund an die betroffene Einheit (Issue #558).
 *
 * Getrennt vom Merken, weil beides an verschiedenen Stellen faellig ist: Die Klasse
 * kennt der Guard, die Einheit kennt erst sein Aufrufer. `fehlerEinheit` am Lauf ist
 * der Verweis darauf — ohne ihn muesste eine Auswertung raten, welche der Einheiten
 * die gestoppte war.
 */
function hefteStoppGrund(einheit) {
  einheit.grund = STOPP_GRUND;
  if (LAUF) {
    LAUF.fehlerEinheit = einheit.id;
    schreibeErgebnisstand();
  }
}

/**
 * Heftet den gemerkten Stoppgrund an den LAUF — fuer den einen Weg ohne Karte.
 *
 * Der Vorflug-Guard laeuft, bevor ein Kandidat gezogen ist. Ein `fehlerEinheit`, der
 * auf nichts zeigt, waere schlimmer als keiner; der Grund gehoert deshalb an
 * `fehlerText`, dieselbe Stelle, an der ihn auch fail() ablegt.
 */
function hefteStoppGrundAnLauf() {
  if (!LAUF) return;
  LAUF.fehlerText = STOPP_GRUND;
  schreibeErgebnisstand();
}

/**
 * Die liegengebliebenen Dateien als ein Satz — ab dem elften Eintrag gekuerzt.
 *
 * Bis zehn Eintraege vollstaendig, darueber die Anzahl und die ersten zehn, in genau
 * der Reihenfolge von `git status --porcelain`. Die Grenze ist Absicht: Ein Grund, der
 * hundert Zeilen fuehrt, ist morgens nicht mehr das, was man zuerst liest — und die
 * Anzahl sagt bereits alles, was die Liste dann noch sagen wuerde.
 *
 * Die leere Liste hat ihren eigenen Text statt eines Sonderfalls beim Aufrufer: Ein
 * gescheiterter Salvage kann einen sauberen Baum hinterlassen, und "keine" ist dort
 * eine Auskunft und kein Mangel.
 */
function resteText(reste) {
  if (reste.length === 0) return "keine unkommittierten Reste";
  const gezeigt = reste.slice(0, 10).join(" | ");
  return reste.length > 10
    ? `${reste.length} unkommittierte Reste, die ersten zehn: ${gezeigt}`
    : `unkommittierte Reste: ${gezeigt}`;
}

/**
 * Der Ersatztext, wenn kein Abbruchweg einen Grund hinterlegt hat (Issue #558).
 *
 * Er sagt ausdruecklich, dass hier etwas fehlt, und bittet um Meldung: Ein leeres Feld
 * liesse offen, ob der Lauf nichts zu sagen hatte oder ob die Uebergabe gerissen ist.
 */
export const ERSATZ_GRUND = "Kein Grund ermittelbar — der Lauf ist hart gestoppt, ohne dass ein Abbruchweg "
  + "seinen Grund hinterlegt hat. Der Weg steht im Textprotokoll daneben; bitte melden.";

/** Der Zusatz, wenn der Grund nur ueber den Modul-Zustand kam und nicht ueber die Uebergabe. */
export const ANKER_FEHLT = "(Der Uebergabe-Anker fehlte: Dieser Text stammt aus dem zuletzt gemerkten harten "
  + "Stopp, nicht von der betroffenen Einheit und nicht vom Lauf. Bitte melden.)";

// Die Gruende eines Laufs ohne Arbeitspaket (Issue #744) — derselbe Wortlaut steht im
// Textprotokoll und am Lauf-Kopf (`LAUF.noWorkReason`), damit beide nie auseinanderlaufen.
const KETTE_LEER_GRUND = "Keine Kette zu fahren — nichts zu tun.";
const READY_LEER_GRUND = "Ready ist leer — nichts zu tun.";

/**
 * Das Sicherheitsnetz fuer einen harten Stopp ohne Grund — der Text, oder `null`
 * (Issue #558).
 *
 * An EINER Stelle statt an sieben: Ein Netz je Abbruchweg waere sieben Stellen, an
 * denen dieselbe Entscheidung getroffen wird, und die achte vergaesse man.
 *
 * Als vorhandener Grund zaehlt ausschliesslich ein nicht leerer `fehlerText` des Laufs
 * oder ein nicht leerer `grund` der ueber `fehlerEinheit` referenzierten Einheit.
 * Gruende ANDERER Einheiten zaehlen ausdruecklich nicht: Eine begruendet
 * zurueckgestellte oder uebersprungene Einheit hat mit dem spaeteren Stopp nichts zu
 * tun, und wuerde sie das Netz unterdruecken, saehe der Stand vollstaendig aus,
 * waehrend der eigentliche Grund fehlt.
 *
 * Rein und mit explizitem Laufzustand, damit die Fallunterscheidung ohne einen
 * kompletten Nachtlauf pruefbar ist — `laufAbschliessen` selbst ist nicht exportiert.
 */
export function sicherheitsnetzGrund(lauf, stoppGrund) {
  const gefuellt = (text) => typeof text === "string" && text.trim() !== "";
  if (gefuellt(lauf.fehlerText)) return null;
  const betroffen = lauf.fehlerEinheit == null
    ? null
    : (lauf.einheiten || []).find((e) => String(e.id) === String(lauf.fehlerEinheit));
  if (betroffen && gefuellt(betroffen.grund)) return null;
  return gefuellt(stoppGrund) ? `${stoppGrund} ${ANKER_FEHLT}` : ERSATZ_GRUND;
}

/** Legt die Einheit eines Pakets an und schreibt sofort — auch ohne Ergebnisstand. */
function einheitAnlegen(id, titel, modellStand = null) {
  // Das Objekt entsteht immer, damit der Aufrufer nicht zwei Wege kennen muss. Im
  // Dry-Run haengt es an nichts und wird nie geschrieben.
  //
  // `modell`, `modellHerkunft` und `modellGrund` stehen direkt nach `titel` (Issue #665),
  // dahinter `stufe` und `stufeVerwendet` (Issue #711). Die Feldreihenfolge ist der Vertrag
  // mit den Auswertungen: Die fuenf alten Namen behalten ihre Plaetze, die neuen kommen
  // hinten an. `schemaFassung` bleibt 1, weil nur Felder hinzukommen. Ohne uebergebenen
  // Stand — die Kette, ein Gate-Rueckfall — tragen sie `null` statt zu fehlen: Ein fehlendes
  // Feld liesse offen, ob niemand gemessen hat oder ob die Frage sich nicht stellte.
  //
  // `stufe` ist die Stufe, die das Paket sich selbst gegeben hat; `stufeVerwendet` die, die
  // das Modell wirklich gestellt hat. Beide getrennt, weil das Ausweichen nach oben genau
  // der Unterschied zwischen ihnen ist — ein Feld liesse ihn verschwinden.
  const einheit = {
    id: String(id),
    titel,
    modell: modellStand?.modell ?? null,
    modellHerkunft: modellStand?.herkunft ?? null,
    modellGrund: modellStand?.grund ?? null,
    stufe: modellStand?.stufe ?? null,
    stufeVerwendet: modellStand?.stufeVerwendet ?? null,
    // Die Lauf-Art je Einheit (Issue #669): Die auswertende Seite ordnet ihr den
    // Arbeitsschritt an der Karte zu und sieht den Dateikopf dort nicht mehr.
    art: LAUF?.art ?? null,
    ausgang: "unbekannt",
  };
  if (LAUF) {
    LAUF.einheiten.push(einheit);
    schreibeErgebnisstand();
  }
  return einheit;
}

/** Ergaenzt eine Einheit um das Ergebnis ihrer Runde und schreibt erneut. */
function einheitErgaenzen(einheit, felder) {
  Object.assign(einheit, felder);
  schreibeErgebnisstand();
  // Fortschreibend eingeliefert (Issue #669): Ein harter Stopp nimmt sonst die Daten der
  // ganzen Nacht mit. Der Server ersetzt denselben Lauf bei jeder Meldung.
  if (felder.ausgang !== undefined) laufMelden();
}

// Die zuletzt protokollierte Einliefer-Meldung — dieselbe Zeile steht nur einmal im
// Protokoll, auch wenn fortschreibend nach jeder Einheit gemeldet wird.
let LETZTE_MELDEZEILE = null;

function meldezeile(zeile) {
  if (zeile === LETZTE_MELDEZEILE) return;
  LETZTE_MELDEZEILE = zeile;
  log(zeile);
}

/**
 * Liefert den Ergebnisstand ueber `board.mjs nightrun melden` an kanban-kit ein (Issue #669).
 *
 * Nie ein Abbruch: Faellt die Einlieferung aus, bleibt die Datei der Rueckfall, und das
 * Protokoll nennt den Grund. Nur der toolbox-Tracker kennt die Schnittstelle; bei jedem
 * anderen entfaellt der Aufruf mit einer Zeile. `NIGHT_MELDEN_ERZWINGEN` ist ein Test-Hook,
 * der den Aufruf auch ohne toolbox erzwingt, damit der Fehlerpfad pruefbar ist.
 */
function laufMelden() {
  if (!ERGEBNIS_FILE || !LAUF) return;
  const tracker = config?.issueTracker;
  if (tracker !== "toolbox" && !process.env.NIGHT_MELDEN_ERZWINGEN) {
    meldezeile(`Einlieferung entfaellt: issueTracker '${tracker}' kennt keine Nachtlauf-Schnittstelle — der Ergebnisstand bleibt als Datei.`);
    return;
  }
  const res = boardRoh("nightrun", "melden", "--datei", ERGEBNIS_FILE);
  if (res.status !== 0) {
    meldezeile(`Einlieferung fehlgeschlagen: ${res.text.trim().slice(0, 300)} — der Ergebnisstand bleibt als Datei.`);
    return;
  }
  if (LAUF.abschluss !== null) meldezeile(`Nachtlauf eingeliefert (${res.json?.outcome ?? "ohne Rueckmeldung"}).`);
}

/** Die erste Zeile eines Fremdtextes, gekuerzt — damit eine Meldung eine Zeile bleibt. */
function ersteZeile(text) {
  const zeile = (text || "").split(/\r?\n/).find((z) => z.trim() !== "") ?? "";
  return boardZitat(zeile.trim());
}

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
  try {
    // Die fehlende Datei wird vorher abgefangen, statt sie in Node laufen zu lassen: Der
    // Kindprozess endete dann zwar auch mit Exit 1, aber die erste Zeile seines stderr ist
    // ein Pfad aus dem Modul-Lader ("node:internal/modules/cjs/loader:1573"). Die eine
    // Zeile, die dieser Fehlschlag sein darf, soll den Grund nennen und nicht den Ort.
    if (!existsSync(AUFWAND_PATH)) throw new Error(`${AUFWAND_PATH} liegt nicht vor`);
    // maxBuffer wie bei den Board-Aufrufen: Der Stand traegt alle einbezogenen Laeufe,
    // und ein abgeschnittener Puffer machte daraus einen Parse-Fehler.
    const res = spawnSync(process.execPath, [AUFWAND_PATH, "auswerten"], {
      encoding: "utf-8",
      cwd: process.cwd(),
      maxBuffer: BOARD_MAX_BUFFER,
    });
    if (res.error) throw new Error(`${AUFWAND_PATH} liess sich nicht starten: ${res.error.message}`);
    if (res.status !== 0) throw new Error(`Exit ${res.status}: ${ersteZeile(res.stderr || res.stdout)}`);
    let stand;
    try {
      stand = JSON.parse(res.stdout);
    } catch (err) {
      throw new Error(`Ausgabe nicht lesbar: ${err.message}`);
    }
    LAUF.aufwand = stand;
    for (const zeile of befundText(stand).split("\n")) {
      if (zeile.trim() !== "") log(zeile);
    }
  } catch (err) {
    // Nur, wenn kein Ergebnis vorliegt: Wirft erst der Textbau, bleibt das gelesene
    // Ergebnis am Lauf-Kopf stehen — es ist gemessen, und der Fehlschlag betrifft die Form.
    if (!("aufwand" in LAUF)) LAUF.aufwand = { ok: false, fehler: err.message };
    log(`Aufwands-Auswertung fehlgeschlagen: ${err.message} — der Lauf endet unveraendert.`);
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
 * Und erst danach `laufMelden()`: Eingeliefert wird der Stand einschliesslich seiner
 * Auswertung, nicht der Stand davor.
 */
function laufAbschliessen(abschluss) {
  if (!LAUF) return;
  LAUF.abschluss = abschluss;
  LAUF.complete = abschluss === "regulaer";
  if (abschluss === "harterStopp") {
    const netz = sicherheitsnetzGrund(LAUF, STOPP_GRUND);
    if (netz !== null) LAUF.fehlerText = netz;
  }
  schreibeErgebnisstand();
  aufwandAuswerten();
  schreibeErgebnisstand();
  laufMelden();
}

/**
 * Die Art des Laufs — der Wert des Feldes `art` (Issue #522).
 *
 * Seit Plan #638 gibt es hier nur die Implementierung; die Nacht-Kette bringt ihre
 * eigene Art mit den Folgepaketen. Die Funktion bleibt, weil `art`, Routing-Label und
 * die Startzeile weiterhin an einer Stelle entschieden werden sollen.
 */
function laufArt(args) {
  return args?.kette ? "kette" : "implementierung";
}

// Was je Art am Grundgeruest und in der Startzeile haengt. Das Kettenlabel kommt aus
// der Config, die in vorbereiten() vor dieser Abfrage geladen ist.
const ART_MODUS = { implementierung: "Implementierung", kette: "Kette" };
const ART_LABEL = {
  implementierung: (args) => args.label,
  kette: () => KETTE_BUDGET?.label ?? KETTE_BUDGET_DEFAULTS.label,
};

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
 * ueberschriebe sonst den ersten. Ohne Trennzeichen, weil Doppelpunkte unter Windows
 * in Dateinamen verboten sind; eine Kollision innerhalb derselben Sekunde ist
 * hingenommen.
 */
function ergebnisstandAnlegen(args, aktivesLabel, jetzt) {
  if (args.dryRun) return;
  const iso = jetzt.toISOString();
  const stempel = `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(":", "")}`;
  LAUF_STEMPEL = stempel;
  ERGEBNIS_FILE = join(process.cwd(), ".claude", `night-run-${stempel}.json`);
  // Feldreihenfolge und Schluessel sind der Vertrag mit allen Auswertungen —
  // schemaFassung steht zuerst, damit ein Leser die Fassung kennt, bevor er den
  // Rest deutet.
  LAUF = {
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
    ...(args.kette ? { budget: { ...KETTE_BUDGET } } : {}),
    // Nur wenn Felder aus den Defaults stammen (Issue #659): Ein vollstaendiger Block
    // hinterlaesst keine Spur, damit das Feld selbst schon der Befund ist.
    ...(args.kette && KETTE_BUDGET_AUS_DEFAULT.length > 0 ? { budgetAusDefault: [...KETTE_BUDGET_AUS_DEFAULT] } : {}),
    einheiten: [],
    abschluss: null,
    // Ab hier Issue #669, hinter abschluss, weil die Folge stufe → einheiten Vertrag ist.
    // `complete` ist `false`, solange der Lauf laeuft, und `true` nur am regulaeren Ende: Ein
    // harter Stopp laesst es stehen, damit die Nacht am Board nicht als ganze erscheint.
    complete: false,
    // Der Verbrauch des ganzen Laufs, einschliesslich der Sessions ohne Karte, und der Teil
    // davon, der zu keiner Einheit gehoert.
    verbrauch: verbrauchLeer(),
    verbrauchOhneEinheit: verbrauchLeer(),
  };
}

/**
 * Schreibt den Ergebnisstand vollstaendig neu (Issue #486).
 *
 * Idempotent und ohne Anhaengen: JSON kennt kein Append, die Datei traegt immer den
 * ganzen Stand. Sie darf den Lauf nie abbrechen — ein Schreibfehler ist eine Zeile
 * im Textprotokoll und kein fail(): Der Ergebnisstand ist Protokoll, nicht Auftrag,
 * und eine Nacht wegen eines vollen Datentraegers zu beenden hiesse, das Protokoll
 * ueber die Arbeit zu stellen.
 */
function schreibeErgebnisstand() {
  if (!ERGEBNIS_FILE || !LAUF) return;
  try {
    writeFileSync(ERGEBNIS_FILE, JSON.stringify(LAUF, null, 2) + "\n", "utf-8");
  } catch (err) {
    log(`Ergebnisstand konnte nicht geschrieben werden: ${err.message}`);
  }
}

// --- Board-Adapter als Kind-Prozess (keine Logik-Duplikation) ---

// Ohne `maxBuffer` puffert Node hoechstens 1 MB stdout/stderr, beendet den Kindprozess
// mit SIGTERM (ENOBUFS) und die Fehlermeldung traegt die halb gelesene Ausgabe statt
// eines Befunds (Issue #699): `issue list` ohne Statusfilter lag im kanban-kit bei
// 1.110 KB, die Done-Spalte allein bei 801 KB. 256 MB ist grosszuegig bemessen und gilt
// fuer beide Board-Helfer.
const BOARD_MAX_BUFFER = 256 * 1024 * 1024;

// Eine zitierte Board-Ausgabe traegt hoechstens so viele Zeichen (Issue #699) — eine
// echte Fehlermeldung von board.mjs steht fast immer in den ersten Zeilen.
const BOARD_ZITAT_MAX = 500;

function boardZitat(text) {
  if (text.length <= BOARD_ZITAT_MAX) return text;
  return `${text.slice(0, BOARD_ZITAT_MAX)}… (${text.length - BOARD_ZITAT_MAX} Zeichen gekürzt)`;
}

/**
 * Reine Funktion (Issue #699): baut die Fehlermeldung eines gescheiterten board()-Aufrufs.
 * Nennt Fehlercode bzw. Signal des Kindprozesses, sofern gesetzt, und zitiert
 * `stderr || stdout` gekuerzt auf `BOARD_ZITAT_MAX` Zeichen.
 */
export function boardFehlertext(cliArgs, res) {
  const hinweise = [];
  if (res.error?.code) hinweise.push(res.error.code);
  if (res.signal) hinweise.push(`Signal ${res.signal}`);
  const praefix = hinweise.length ? ` (${hinweise.join(", ")})` : "";
  const zitat = boardZitat((res.stderr || res.stdout || "").trim());
  return `board.mjs ${cliArgs.join(" ")} schlug fehl${praefix}: ${zitat}`;
}

// Das letzte Argument darf ein Optionsobjekt sein — heute nur `cwd` (Plan #638, A4):
// Die Kette arbeitet in einem eigenen Worktree, und ein Board-Aufruf dort liest die
// Config des Worktrees. Ohne Objekt bleibt alles, wie es war.
function board(...cliArgs) {
  const letztes = cliArgs.at(-1);
  const opts = letztes && typeof letztes === "object" ? cliArgs.pop() : {};
  const res = spawnSync(process.execPath, [BOARD_PATH, ...cliArgs], { encoding: "utf-8", cwd: opts.cwd ?? process.cwd(), maxBuffer: BOARD_MAX_BUFFER });
  if (res.status !== 0) {
    fail(boardFehlertext(cliArgs, res), "tracker");
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    fail(`board.mjs ${cliArgs.join(" ")} lieferte kein JSON: ${res.stdout.slice(0, 200)}`, "tracker");
  }
}

/**
 * Ein Board-Aufruf, der NICHT abbricht (Plan #638, A7): `issue check-form` endet bei
 * Verstoessen mit Exit 1 und JSON — fuer die Kette ist das ein Befund, kein Ausfall.
 * Rueckgabe `{ status, json, text }`; `json` ist null, wenn stdout kein JSON traegt.
 */
function boardRoh(...cliArgs) {
  const res = spawnSync(process.execPath, [BOARD_PATH, ...cliArgs], { encoding: "utf-8", maxBuffer: BOARD_MAX_BUFFER });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, json, text: boardZitat((res.stderr || res.stdout || "").trim()) };
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
function gitReste(cwd = process.cwd()) {
  // Beim lokalen Tracker sind Board-Moves Dateiaenderungen unter issuesDir —
  // Board-Zustand ist kein Code-Zustand und zaehlt nicht als dirty.
  const pathspec = ["--", "."];
  if (config.issueTracker === "local") {
    pathspec.push(`:(exclude)${config.local?.issuesDir || "issues"}`);
  }
  // Das Nacht-Protokoll (Textdatei und Ergebnisstand, Issue #486) entsteht waehrend
  // des Laufs im Arbeitsbaum: Protokoll-Zustand ist kein Code-Zustand. Anders als die
  // issuesDir-Ausnahme gilt diese unabhaengig vom Tracker — der Runner legt seine
  // Dateien in jedem Projekt an, und ohne die Ausnahme stoppte der Rest-Guard (#152)
  // nach jeder erfolgreichen Runde hart, sobald .gitignore .claude/* nicht fuehrt.
  pathspec.push(":(exclude).claude/night-run-*");
  // Eine wartende Vorhaben-Notiz (Issue #546) entsteht beim Planen und wird erst
  // beim naechsten `push main` nach specs/vorhaben/ aufgehoben: Vorhaben-Zustand ist
  // kein Code-Zustand. Wie beim Protokoll darueber steht der Ausschluss ausdruecklich
  // hier, obwohl `.gitignore` den Pfad meist deckt — der Installer laesst eine
  // vorhandene eigene `.claude`-Regel unangetastet, also gibt es Projekte ohne den
  // Block, und dort hielte die erste geplante Notiz den Lauf an.
  pathspec.push(":(exclude).claude/vorhaben-wartend-*");
  // Ein wartender Nachtbericht (Issue #645) liegt in der Hauptkopie, bis der Tracker ihn
  // annimmt — Protokoll-Zustand wie `night-run-*`, und aus demselben Grund hier ausgeschlossen.
  pathspec.push(":(exclude).claude/night-bericht-*");
  // Der Umsetzungs-Lock (Issue #696) liegt waehrend jeder Umsetzung in der Hauptkopie:
  // Laufzeit-Zustand, kein Code-Zustand. Der Ausschluss steht hier aus demselben Grund wie
  // die Vorhaben-Notiz darueber — nachgewiesen, nicht angenommen: Ohne ihn stoppte der
  // Rest-Guard (#152) in jedem Projekt ohne den `.claude/*`-Block nach der ersten
  // erfolgreichen Runde hart, und die Umsetzungsstufe saehe die Hauptkopie schon vor ihrem
  // ersten Paket als unsauber.
  pathspec.push(`:(exclude)${UMSETZUNG_LOCK}`);
  // Die Wegmarken (Issue #733) entstehen bei JEDEM Zug nach In progress oder In review —
  // der Runner schreibt zwei je Runde, die Session weitere. Buchhaltung, kein
  // Code-Zustand, und aus demselben Grund hier ausgeschlossen wie das Protokoll darueber:
  // Ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt ohne den
  // `.claude/*`-Block nach der ersten erfolgreichen Runde hart. Damit waere die Wegmarke
  // eine Bedingung der Arbeit statt ihrer Buchhaltung.
  // SYNC: derselbe Pfad steckt als WEGMARKEN_DATEI in kit/board.mjs, das ihn schreibt;
  // die Kit-Werkzeuge sind bewusst eigenstaendige Single-File-Tools ohne gemeinsames
  // Modul (#440), geteilte Konstanten werden dupliziert und hier markiert.
  pathspec.push(":(exclude).claude/wegmarken.tsv");
  // Die Aufwands-Auswertung (Issue #752) entsteht am Ende JEDES Laufs im Arbeitsbaum —
  // `.claude/aufwand.md` fuer Menschen, `.claude/aufwand.json` fuer die zwei
  // Ausgabestellen. Protokoll-Zustand, kein Code-Zustand, und aus demselben Grund
  // ausgeschlossen wie `night-run-*` darueber: Ohne den Ausschluss stoppte der Rest-Guard
  // (#152) im naechsten Lauf nach der ersten erfolgreichen Runde hart, sobald `.gitignore`
  // den `.claude/*`-Block nicht fuehrt. Die Messung machte dann die Arbeit unmoeglich,
  // die sie misst.
  pathspec.push(":(exclude).claude/aufwand.*");
  const res = spawnSync("git", ["status", "--porcelain", ...pathspec], { encoding: "utf-8", cwd });
  if (res.status !== 0) fail("git status schlug fehl — bin ich im Projekt-Root eines git-Repos?");
  return res.stdout.split("\n").filter((zeile) => zeile.trim() !== "");
}

/**
 * Ist der Arbeitsbaum sauber? Die Leerheit von gitReste() — eine Quelle, nicht zwei.
 *
 * Seit Issue #558 braucht jeder Guard, der hier anschlaegt, auch die Namen der
 * liegengebliebenen Dateien fuer seinen Grund. Zwei getrennte git-Aufrufe mit
 * getrennten Ausschluessen waeren zwei Wahrheiten darueber, was als Rest zaehlt.
 */
function gitClean(cwd = process.cwd()) {
  return gitReste(cwd).length === 0;
}

function lastCommitHash(cwd = process.cwd()) {
  // PATH-Aufloesung bewusst, siehe Begruendung ueber gitReste() (S4036, Issue #183).
  const res = spawnSync("git", ["log", "-1", "--format=%h"], { encoding: "utf-8", cwd });
  return res.status === 0 ? res.stdout.trim() : "?";
}

// --- Der Umsetzungs-Lock (Plan #691, E10; Issue #696) ---
//
// Kette und Umsetzungsnacht liefen bisher ausdruecklich nebeneinander: Die Kette baute im
// Worktree, die Umsetzungsnacht in der Hauptkopie. Unter Variante B stimmt das nicht mehr —
// die Umsetzungsstufe baut selbst in der Hauptkopie (E4), und zwei Laeufe, die gleichzeitig
// in denselben Working Tree committen, hinterlassen einen Zustand, den morgens niemand
// entwirrt. E10 entscheidet deshalb den Lock und nicht einen Satz in der Dokumentation:
// Ein Satz, den ein Cron-Eintrag nicht liest, verhindert nichts.
//
// Verwaist wird ueber die Prozess-Id erkannt, nicht ueber eine Verfallsfrist. Eine Frist
// waere geraten — eine Umsetzungsnacht darf laenger dauern als jede Schaetzung, und ein zu
// kurzer Verfall gaebe genau die Gleichzeitigkeit frei, die der Lock verhindern soll.
//
// Die Datei liegt unter `.claude/` und ist damit in jedem Projekt mit dem `.claude/*`-Block
// des Installers per `.gitignore` gedeckt — in den uebrigen deckt sie der Ausschluss in
// `gitReste()`, wie bei Protokoll, Vorhaben-Notiz und wartendem Bericht. Beendet ein harter
// Stopp den Prozess an einem `finally` vorbei, bleibt sie liegen; der naechste Lauf erkennt
// sie als verwaist.

/** Der Pfad der Lock-Datei, relativ zur Hauptkopie. */
export const UMSETZUNG_LOCK = ".claude/night-umsetzung.lock";

/**
 * Die Prozess-Id aus einer Lock-Datei — null, wenn es sie nicht gibt, sie nicht lesbar ist
 * oder nicht als positive ganze Zahl dasteht. Alle drei zaehlen als verwaist: Ein Lock,
 * dessen Halter nicht benennbar ist, kann niemanden abhalten.
 *
 * `0` ist ausdruecklich keine gueltige Id — `process.kill(0, 0)` zielte auf die eigene
 * Prozessgruppe und meldete damit fuer jede kaputte Datei einen lebenden Halter.
 */
function lockPid(pfad) {
  try {
    const pid = Number(readFileSync(pfad, "utf-8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Laeuft der Prozess mit dieser Id noch? `ESRCH` heisst nein; `EPERM` heisst, es gibt ihn
 * und er gehoert einem anderen Nutzer — das ist kein verwaister Lock.
 */
function prozessLaeuft(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

/**
 * Nimmt den Umsetzungs-Lock in der Hauptkopie.
 *
 * Rueckgabe ist `{ ok: true, hinweis, freigeben }` oder `{ ok: false, grund }`. Ein
 * Schreibfehler zaehlt wie ein vorgefundener Lock und laesst die Umsetzung aus: Ein Lock,
 * der bei Schreibfehlern uebergangen wird, ist keiner — und die Kette faellt in diesem Fall
 * auf Variante A zurueck, was ein vorgesehener Ausgang ist.
 *
 * Wer `ok: false` bekommt, ruft `freigeben` nicht: Der Lock gehoert dann einem anderen Lauf.
 */
export function umsetzungLockNehmen(repoRoot) {
  const pfad = join(repoRoot, UMSETZUNG_LOCK);
  const pid = lockPid(pfad);
  if (pid !== null && prozessLaeuft(pid)) {
    return { ok: false, grund: `eine andere Umsetzung haelt ${UMSETZUNG_LOCK} (Prozess ${pid})` };
  }
  const verwaist = existsSync(pfad);
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, `${process.pid}\n`, "utf-8");
  } catch (e) {
    return { ok: false, grund: `${UMSETZUNG_LOCK} liess sich nicht schreiben (${e.message})` };
  }
  return {
    ok: true,
    hinweis: verwaist ? `verwaisten Lock ${UMSETZUNG_LOCK} aufgeraeumt und selbst genommen` : null,
    freigeben: () => {
      try {
        rmSync(pfad, { force: true });
      } catch (e) {
        // Gerufen wird das aus einem `finally`; ein Wurf von hier risse den ganzen Lauf
        // mit, nach getaner Arbeit. Liegenbleiben ist unschaedlich — der naechste Lauf
        // findet die Id dieses Prozesses vor und erkennt sie als verwaist.
        log(`${UMSETZUNG_LOCK} liess sich nicht entfernen (${e.message}) — der naechste Lauf raeumt ihn als verwaist auf.`);
      }
    },
  };
}

// --- Worktree je Kette (Plan #638, A3) ---
//
// Die Nacht-Kette arbeitet in einem eigenen Worktree ausserhalb des Repos: Im Repo laege
// er als untracked Verzeichnis im `git status` der Umsetzungsnacht. `.claude/` ist bis
// auf `workflow.config.json` und `launch.json` nicht versioniert; ein frischer Worktree
// traegt damit die Config, aber weder Kit-Kopie noch Skills, Settings oder Token. Der
// Runner spiegelt deshalb `.claude/` der Hauptkopie hinein — ohne `night-run-*`, denn
// Log und Ergebnisstand bleiben in der Hauptkopie.

/** Der Ordnername eines Kette-Worktrees; der Praefix dient dem Aufraeumen beim Start. */
function worktreePraefix(repoRoot) {
  return `kette-${basename(resolve(repoRoot))}-`;
}

function gitIm(repoRoot, gitArgs) {
  // PATH-Aufloesung bewusst, siehe Begruendung ueber gitReste() (S4036, Issue #183).
  return spawnSync("git", gitArgs, { encoding: "utf-8", cwd: repoRoot });
}

/**
 * Spiegelt `.claude/` der Hauptkopie in den Worktree, ohne Protokolle und Ergebnisstaende.
 *
 * `force`, weil der Worktree `workflow.config.json` schon traegt — dieselbe Datei, sie
 * wird ueberschrieben, nicht gedoppelt.
 *
 * Die Aufwands-Auswertung (`aufwand.md`, `aufwand.json`, Issue #752) bleibt aus demselben
 * Grund zurueck wie `night-run-*`: Sie gehoert dem Lauf, der sie geschrieben hat, und
 * liegt in der Hauptkopie. Im Worktree waere sie ein fremder Stand, der mit ihm verginge.
 */
function claudeSpiegeln(repoRoot, pfad) {
  const quelle = join(repoRoot, ".claude");
  if (!existsSync(quelle)) return;
  cpSync(quelle, join(pfad, ".claude"), {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = basename(src);
      return !name.startsWith("night-run-") && !name.startsWith("aufwand.");
    },
  });
}

/**
 * Legt den Worktree einer Kette an und liefert seinen Pfad.
 *
 * Scheitert `git worktree add`, wirft die Funktion mit der git-Meldung; ob daraus ein
 * `abgebrochen` wird, entscheidet der Aufrufer — ein stiller Rueckfall auf die Hauptkopie
 * hiesse, dass die Kette manchmal neben der Umsetzung im selben Baum liefe.
 */
export function worktreeAnlegen({ repoRoot, issueId, stempel }) {
  const pfad = join(tmpdir(), `${worktreePraefix(repoRoot)}${issueId}-${stempel}`);
  const res = gitIm(repoRoot, ["worktree", "add", "--detach", pfad, "HEAD"]);
  if (res.status !== 0) {
    throw new Error(`git worktree add schlug fehl: ${(res.stderr || res.stdout || "").trim()}`);
  }
  claudeSpiegeln(repoRoot, pfad);
  return pfad;
}

/**
 * Kopiert wartende Vorhaben-Notizen aus dem Worktree in die Hauptkopie.
 *
 * `/techplan` legt sie unter `.claude/vorhaben-wartend-*.md` ab, und der naechste
 * `push main` hebt sie aus der Hauptkopie auf — im Worktree gingen sie mit ihm verloren.
 * Liefert die Namen der kopierten Dateien.
 */
export function notizenZurueck(pfad, repoRoot) {
  const quelle = join(pfad, ".claude");
  if (!existsSync(quelle)) return [];
  const notizen = readdirSync(quelle).filter((name) => /^vorhaben-wartend-.*\.md$/.test(name));
  if (notizen.length > 0) mkdirSync(join(repoRoot, ".claude"), { recursive: true });
  for (const name of notizen) cpSync(join(quelle, name), join(repoRoot, ".claude", name), { force: true });
  return notizen;
}

/** Entfernt den Worktree — ueber git, und den Ordner, falls er danach noch liegt. */
export function worktreeEntfernen(pfad, repoRoot) {
  gitIm(repoRoot, ["worktree", "remove", "--force", pfad]);
  rmSync(pfad, { recursive: true, force: true });
}

/**
 * Raeumt liegengebliebene Worktrees dieses Repos auf — beim Start jeder Kette.
 *
 * Ein harter Absturz laesst den Ordner unter dem Temp-Verzeichnis und den Eintrag in
 * `git worktree list` zurueck; beide muessen weg, sonst legt der naechste Lauf einen
 * zweiten Worktree neben einen toten. Liefert die entfernten Pfade.
 */
export function worktreesAufraeumen(repoRoot) {
  gitIm(repoRoot, ["worktree", "prune"]);
  const praefix = worktreePraefix(repoRoot);
  const entfernt = [];
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(praefix)) continue;
    const pfad = join(tmpdir(), name);
    worktreeEntfernen(pfad, repoRoot);
    entfernt.push(pfad);
  }
  return entfernt;
}

// Review-Marker aus /issue-review (Issue #223). Anders als die beiden Filter darueber
// greift dieser am BODY: Der Marker steht im Kontext-Abschnitt, nicht im Titel. Der
// Body liegt ohnehin vor, weil parseDeps ihn braucht — kein zusaetzlicher Board-Aufruf.
//
// Bewusst streng: Nur eine Zeile, die mit 'Issue-Review:' beginnt und danach etwas
// traegt, zaehlt. 'Issue-Review folgt noch' ist das Gegenteil einer Freigabe und darf
// nicht als eine durchgehen.
// `[^\S\n]*` statt `\s*` nach dem Doppelpunkt (Issue #403): Der Wert muss auf
// derselben Zeile stehen. Vorher lief `\s*` in die Folgezeile, sodass
// "Issue-Review:\nGO" als Marker galt — das Gegenteil dessen, was der Kommentar
// oben seit jeher beschreibt. Die einzige gewollte Verhaltensaenderung dieser Etappe.
//
// Kein fuehrender Leerraum mehr im Ausdruck (Issue #496): `^[^\S\n]*` mit m-Flag
// war der Teil, den SonarCloud als S8786 fuehrte — eine unbegrenzte Wiederholung
// direkt hinter einem Zeilenanfang, der an jeder Zeile ansetzen kann. #403 hatte
// den Ausdruck an dieser Stelle noch fuer harmlos gehalten und ihn nur gemessen;
// der Fund blieb trotzdem offen. Die Einrueckung raeumt jetzt `hasReviewMarker`
// je Zeile per `trimStart()` ab — derselbe Weg, den #403 fuer PRUEFUNG_ZEILE
// gegangen ist. Die Funktion antwortet auf jeden Body wie zuvor; der Ausdruck
// allein tut es nicht mehr, denn er sieht nur noch die getrimmte Zeile.
export const REVIEW_MARKER_ZEILE = /^Issue-Review:[^\S\n]*\S/i;

export function hasReviewMarker(body) {
  // `trimStart()` statt `[^\S\n]*` im Ausdruck: Es raeumt genau dieselben Zeichen
  // ab — jeden Leerraum ausser dem Zeilenumbruch, den `split` schon entfernt hat.
  // `[ \t]` waere hier zu eng gewesen: Ein `\r` aus CRLF-Zeilenenden faellt nicht
  // darunter.
  return (body || "").split("\n").some((zeile) => REVIEW_MARKER_ZEILE.test(zeile.trimStart()));
}

/**
 * Der Freigabe-Befund eines Ready-Issues fuer das Gate `requiredBeforeReady` (#304,
 * gekuerzt in Plan #638, A17).
 *
 * Zwei Arten, und sie bleiben unterscheidbar, weil sie morgens Verschiedenes bedeuten:
 *   `marker`     — es ist geprueft worden (Issue-Review-Marker im Body), frei
 *   `ungeprueft` — kein Marker, zurueckgestellt
 *
 * Die Arten `verzicht`, `verfallen` und `ungueltig` hingen an der Pruefvorgabe
 * (`Pruefung:`-Zeile), die mit Stufe 2 des Umbaus entfaellt. Eine solche Zeile im Body
 * hat keine Wirkung mehr.
 */
export function reviewFreigabe(body) {
  if (hasReviewMarker(body)) return { frei: true, art: "marker" };
  return { frei: false, art: "ungeprueft" };
}

/** Protokollzeile, Board-Kommentar und Dry-Run-Grund je Ablehnungsart (#304). */
const GATE_ABLEHNUNG = {
  ungeprueft: {
    kurz: () => "ungeprueft, kein Issue-Review-Marker",
    log: () => "uebersprungen: ungeprueft (kein Issue-Review-Marker im Body).",
    kommentar: (id) => `Ungeprueft — bitte erst /issue-review #${id} laufen lassen, dann wieder nach Ready.`,
  },
};

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

/**
 * Die Spur einer gelaufenen Pruefung, die die Nacht-Kette voraussetzt (Fachplan #702,
 * Plan #716, E2).
 *
 * Der Name ist eine feste Konstante und kommt bewusst NICHT aus der Config: Die Regel
 * soll in jedem Projekt ohne Einstellung gelten, und ein Config-Feld waere ueber einen
 * leeren Wert genau die Abschaltung, die es nicht geben soll. `/issue-review` setzt das
 * Label; die Kette liest es nur.
 */
export const REVIEW_FERTIG_LABEL = "review:fertig";

export function hatReviewFertigLabel(issue) {
  return (issue?.labels || []).includes(REVIEW_FERTIG_LABEL);
}

/**
 * Das feste Praefix jedes Grundes „Pruefung fehlt" (Plan #716).
 *
 * Fest, weil der ganze Grundtext je Karte verschieden ist — er nennt ihre Nummer. Wer
 * die Faelle wiedererkennen will (der Kommentar an der abgelehnten Anforderung), prueft
 * auf dieses Praefix und nicht auf den ganzen Text.
 */
export const UNGEPRUEFT_PRAEFIX = `ungeprueft: Label '${REVIEW_FERTIG_LABEL}' fehlt`;

/**
 * Grund und naechster Schritt fuer eine Karte ohne `review:fertig` — getrennt geliefert.
 *
 * Das Kettenlabel kommt als Argument aus `night.kette.label` und wird nicht fest
 * geschrieben: Der Bestand nennt es ueberall dynamisch, und in einem Projekt mit anderem
 * Label waere `kit:night` im Text schlicht falsch (Plan #716, E8).
 */
export function pruefungFehltGrund(id, kettenLabel) {
  const schritt = `mit /issue-review #${id} pruefen lassen, das setzt ${REVIEW_FERTIG_LABEL}; das Label ${kettenLabel} bleibt dran`;
  return { praefix: UNGEPRUEFT_PRAEFIX, schritt, text: `${UNGEPRUEFT_PRAEFIX} — ${schritt}` };
}

/**
 * Der Anker des Kommentars an der wegen fehlender Pruefung abgelehnten Anforderung
 * (Fachplan #702, Kriterium 4; Plan #716, E3).
 *
 * Er steht als erste Zeile des Kommentars und traegt keinen Laufstempel: Genau daran
 * erkennt der naechste Lauf, dass der Hinweis schon dasteht, und schreibt keinen
 * zweiten. Ein Label als Merker verlangte ein weiteres Kennzeichen am Board, eine
 * lokale Datei ueberlebte den Worktree nicht.
 *
 * Aehnlich, aber nicht dasselbe wie der Kommentar `Kette nicht gestartet` bei
 * gescheitertem Reviewer-Vorflug: Der eine sagt, die Pruefung der Anforderung fehlt,
 * der andere, die Reviewer waren nicht erreichbar.
 */
export const KETTE_UNGEPRUEFT_ANKER = "## Kette nicht gestartet: Pruefung fehlt";

/**
 * Der feste Folgesatz, an dem der Runner einen Halt-Kommentar erkennt (Issue #572).
 *
 * Eine Implementierungs-Session, bei der doch eine Abwaegung auftaucht, zeichnet die
 * Karte, benennt die Entscheidung in einem Kommentar und schiebt sie nach Backlog.
 * Dieser Satz schliesst den Kommentar ab — und nur an ihm ist er von jedem anderen
 * Kommentar zu unterscheiden. Dass irgendein Kommentar hinzukam, genuegt nicht: Das
 * ist im Regelbetrieb fast immer wahr, und der Abbruch VOR dem Kommentar bliebe
 * unerkannt.
 *
 * Exportiert, damit der Skill-Text (Issue #573) in einem Test gegen diese Konstante
 * geprueft werden kann statt gegen eine Abschrift — zwei Literale liefen auseinander,
 * und der Halt waere danach still wirkungslos.
 */
export const HALT_FOLGESATZ = "Daraus soll per /fachplan eine fachliche Anforderung entstehen.";


// --- Stopp-Fragen und Herkunft erzeugter Dokumente ---

// Die vorgeschriebene Form eines Plandokuments ohne offene Punkte (Regel P6): erste
// nichtleere Zeile des Abschnitts, ein Zusatz dahinter ist der Regelfall.
const KEINE_STOPP_FRAGEN = "- Keine.";
// Wie viel von einer offenen Frage in den Grund wandert. Kurz genug fuer eine Log-Zeile,
// lang genug, um die Frage wiederzuerkennen.
const STOPP_FRAGE_ZITAT = 120;

/**
 * Die Stopp-Fragen-Pruefung eines Plandokuments (Issue #519) — `null`, wenn keine offen ist.
 *
 * Sie ersetzt die am 28. August gestrichene Regel P8 (Begruendung: Plan #513, A5); P8
 * selbst wird nicht wiederbelebt.
 *
 * Ein FEHLENDER Abschnitt ist ein Ausschluss, keine Erlaubnis: Das `parseDeps`-Muster
 * liefert bei fehlender Ueberschrift eine leere Liste, und "keine Zeile, also keine offene
 * Frage" liesse ausgerechnet einen Plan ohne den Pflichtabschnitt durch.
 */
export function stoppFragenGrund(body) {
  const abschnitt = abschnittLesen(body, OFFENE_FRAGEN_UEBERSCHRIFT);
  if (abschnitt === null) return `kein Abschnitt ## ${OFFENE_FRAGEN_NAME}`;
  // Nur Zeilen ausserhalb eines Fence: Ein Plan, der die Regelform als Beispiel zeigt,
  // haette sich sonst mit seinem eigenen Codeblock freigegeben.
  const erste = abschnitt.zeilen.find((z, i) => abschnitt.ausserhalb[i] && z.trim() !== "");
  if (erste === undefined) return `Abschnitt ## ${OFFENE_FRAGEN_NAME} ist leer`;
  if (erste.trim().startsWith(KEINE_STOPP_FRAGEN)) return null;
  return `offene Stopp-Frage: ${flatten(erste, STOPP_FRAGE_ZITAT)}`;
}

// --- Das Erfolgssignal der Erzeugung (Issue #520) ---

// Welche Herkunftszeile ein erzeugtes Dokument seiner Quelle traegt: Ein Plandokument
// nennt die `Fachliche Quelle`, ein Arbeitspaket den `Plan`. Nicht `derivedFrom` — das
// Feld wertet allein der toolbox-Adapter aus, die uebrigen Tracker nehmen es folgenlos
// an; die Zeilen stehen im Body und tragen ueberall.
export const HERKUNFT_FELD = { plan: "Fachliche Quelle", issue: "Plan" };

/**
 * Traegt dieses Dokument die Zielstufe des Laufs (Issue #520)?
 *
 * `plan` erzeugt ein `[Plan]`-Dokument, `issue` erzeugt Arbeitspakete — und die tragen
 * keines der drei Praefixe.
 */
function zielstufePasst(title, stufe) {
  if (stufe === "plan") return isPlan(title);
  return !isPlan(title) && !isFachlich(title) && !isIdee(title);
}

/**
 * Ist dieses Dokument in diesem Lauf aus dieser Quelle entstanden (Issue #520)?
 *
 * Zwei Bedingungen, und beide muessen tragen:
 *
 *   1. eine GANZE Zeile `Fachliche Quelle: Issue #N` bzw. `Plan: Issue #M` mit exakt
 *      dieser Nummer. Das Zeilenende hinter der Nummer ist der Kern: Ohne es zaehlte ein
 *      Lauf zu Quelle #40 jedes Dokument aus #408 als sein eigenes Ergebnis. Eine
 *      Erwaehnung im Fliesstext oder in Fettung ist keine Herkunftszeile.
 *   2. die Zielstufe am Titel. Ohne sie unterdrueckten Arbeitspakete eines frueheren
 *      Laufs die Plan-Session, weil sie dieselbe `Fachliche Quelle` tragen — und das
 *      "vorhandene Dokument" waere dann ein Arbeitspaket statt eines Plans.
 *
 * Reine Funktion: Sie beantwortet dieselbe Frage fuer den
 * Fortsetzen-Check VOR der Session und fuer die Backlog-Differenz DANACH — zwei
 * Rechenwege liefen auseinander, und der Lauf legte Dokumente doppelt an.
 */
export function stammtAusErzeugung(issue, quelleId, stufe) {
  // `Object.hasOwn` wie in `erzeugungsEingangsstufe`: 'constructor' als Stufe lieferte
  // sonst eine Funktion statt eines Feldnamens.
  if (!Object.hasOwn(HERKUNFT_FELD, stufe ?? "")) return false;
  if (!zielstufePasst(issue?.title ?? "", stufe)) return false;
  // Nur Ziffern, und die Nummer geht unveraendert in den Ausdruck: Kartennummern sind
  // numerisch, und ein Sonderzeichen aus einer fremden Id wuerde hier zum Metazeichen.
  // Die Session schreibt die Nummer so, wie der Auftrag sie ihr genannt hat — beim
  // lokalen Tracker also mitsamt fuehrenden Nullen.
  const nummer = String(quelleId ?? "");
  if (!/^\d+$/.test(nummer)) return false;
  // `[^\S\n]` statt `\s`: `\s*$` duerfte mit dem m-Flag ueber Zeilenumbrueche laufen und
  // haette das Zeilenende damit wieder aufgeweicht.
  const zeile = new RegExp(
    String.raw`^[^\S\n]*${HERKUNFT_FELD[stufe]}:[^\S\n]*Issue[^\S\n]*#${nummer}[^\S\n]*$`,
    "m",
  );
  return zeile.test(issue?.body || "");
}

// --- Abhaengigkeiten ---

const DEPS_UEBERSCHRIFT = /^ {0,3}##\s*Abh(?:ä|ae)ngigkeiten\s*$/i;
const ABSCHNITTS_ENDE = /^ {0,3}##\s/;
const LOKALE_REFERENZ = /(?<![\w`/#])#(\d+)/g;
// Der Pflichtabschnitt eines Plandokuments (Regel P6), gelesen von der Stopp-Fragen-
// Pruefung des Erzeugungsmodus. Name und Ausdruck gehoeren zusammen: Der Name steht in
// den Gruenden, damit dort keine zweite Schreibweise entsteht.
const OFFENE_FRAGEN_NAME = "Offene Fragen";
const OFFENE_FRAGEN_UEBERSCHRIFT = /^ {0,3}##\s*Offene\s+Fragen\s*$/i;

/**
 * Die Zeilen eines Markdown-Abschnitts — `null`, wenn die Ueberschrift fehlt.
 *
 * Herausgezogen aus `parseDeps` (Issue #519), weil die Stopp-Fragen-Pruefung des
 * Erzeugungsmodus dieselbe Fence-Regel braucht. Zwei Ausdruecke fuer "Abschnitt lesen"
 * liefen auseinander, und die Regel ist zu fein, um sie zweimal richtig zu treffen.
 *
 * `ausserhalb` liegt bei, weil die beiden Leser den Inhalt verschieden brauchen:
 * `parseDeps` sucht Referenzen im GANZEN Abschnitt (auch in Codebloecken — eine dort
 * zitierte Nummer ist trotzdem eine Abhaengigkeit), die Stopp-Fragen-Pruefung nur
 * ausserhalb (eine dort gezeigte Regelform ist kein Nachweis).
 */
function abschnittLesen(body, ueberschrift) {
  const zeilen = String(body || "").split(/\r\n|\r|\n/);
  const imFence = fenceLauf();
  const ausserhalb = [];
  let start = -1;

  for (let i = 0; i < zeilen.length; i++) {
    ausserhalb[i] = !imFence(zeilen[i]);
    if (ausserhalb[i] && ueberschrift.test(zeilen[i])) start = i;
  }
  if (start < 0) return null;

  let ende = zeilen.length;
  for (let i = start + 1; i < zeilen.length; i++) {
    if (ausserhalb[i] && ABSCHNITTS_ENDE.test(zeilen[i])) { ende = i; break; }
  }
  return { zeilen: zeilen.slice(start + 1, ende), ausserhalb: ausserhalb.slice(start + 1, ende) };
}

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
  const gelesen = abschnittLesen(body, DEPS_UEBERSCHRIFT);
  if (gelesen === null) return [];

  const abschnitt = gelesen.zeilen.join("\n");
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
  const flat = (str || "").replaceAll(/\s+/g, " ").trim();
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

// --- Werkzeugzeit am Session-Strom (Issue #748) ---

/**
 * Beobachtet einen `stream-json`-Strom und misst, wie lange eine Session an ihren
 * Werkzeugen gehangen hat (Plan #745, E1/E2).
 *
 * Gemessen wird allein die SPANNE: Ein `assistant`-Ereignis mit `tool_use`-Bloecken
 * eroeffnet einen Schub, das letzte zugehoerige `tool_result` schliesst ihn. Der Inhalt
 * eines Aufrufs wird nie gelesen — kein Werkzeugname, kein Argument wird gespeichert.
 * Deutete der Beobachter den Aufruf, haette er eine Meinung darueber, was "Arbeit" ist;
 * so hat er nur eine Uhr.
 *
 * Drei parallele Aufrufe eines Schubs zaehlen als EIN Zeitraum. Ihre Einzelspannen zu
 * addieren buchte dieselbe Wanduhr dreifach — die Session hat einmal gewartet, nicht
 * dreimal. Dass es mehr als einer war, steht darum in `nebenlaeufigeSchuebe` und nicht
 * in der Zeit.
 *
 * Ein Schub, dessen `tool_result` nie ankommt (abgeschnittener Strom, Zeitlimit), zaehlt
 * als `offeneSchuebe` und geht NICHT in `werkzeugMs` ein: Ein fehlender Messwert darf
 * nicht als Null erscheinen, und die Spanne bis zum letzten gesehenen Ereignis waere eine
 * Schaetzung, die sich als Messung ausgaebe.
 *
 * Eigener Zustand statt einer reinen Funktion ueber dem ganzen stdout (wie
 * `leseKennzahlen`), weil die Zeitstempel aus der ANKUNFT der Zeilen stammen — im
 * gesammelten stdout stehen sie nicht mehr. Der Aufrufer gibt den Zeitstempel darum mit;
 * das haelt den Beobachter an Fixtures prueffbar, und deshalb ist er exportiert.
 *
 * `zeile(roh, ts)` nimmt eine Rohzeile oder ein bereits geparstes Objekt, `ergebnis()`
 * liefert jederzeit `{ werkzeugMs, schuebe, nebenlaeufigeSchuebe, offeneSchuebe }`.
 * Unlesbare Zeilen werden tolerant uebersprungen, wie in `leseKennzahlen()` — eine
 * Kennzahl darf einen laufenden Nachtlauf nicht zu Fall bringen.
 */
export function werkzeugZeitBeobachter() {
  let werkzeugMs = 0;
  let schuebe = 0;
  let nebenlaeufigeSchuebe = 0;
  let verwaiste = 0;
  // Der Schub, der gerade laeuft: Startzeit, noch offene tool_use-Ids und die Zahl der
  // Aufrufe, mit der er begonnen hat.
  let offen = null;

  const parse = (roh) => {
    if (roh && typeof roh === "object") return roh;
    if (typeof roh !== "string") return null;
    const trimmed = roh.trim();
    // Billiger Vorfilter wie in leseKennzahlen: Ein Stream-Ereignis ist immer ein
    // JSON-Objekt. Das haelt JSON.parse von jeder Fliesstext-Zeile fern — und der
    // Beobachter sitzt im stdout-Handler jeder Session.
    if (!trimmed.startsWith("{")) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };

  return {
    zeile(roh, ts) {
      const obj = parse(roh);
      if (!obj || !Array.isArray(obj.message?.content)) return;

      if (obj.type === "assistant") {
        // Ohne Id liesse sich einem Aufruf kein Ergebnis zuordnen; er eroeffnet darum
        // keinen Schub, statt einen zu eroeffnen, der nie schliesst.
        const ids = obj.message.content
          .filter((b) => b?.type === "tool_use" && typeof b.id === "string" && b.id)
          .map((b) => b.id);
        if (!ids.length) return;
        // Ein neuer Schub, waehrend der alte noch offen ist: Der alte bekommt kein
        // Ergebnis mehr und zaehlt als offen.
        if (offen) verwaiste += 1;
        offen = { start: ts, ids: new Set(ids), aufrufe: ids.length };
        return;
      }

      if (!offen) return;
      for (const block of obj.message.content) {
        if (block?.type === "tool_result") offen.ids.delete(block.tool_use_id);
      }
      if (offen.ids.size === 0) {
        werkzeugMs += ts - offen.start;
        schuebe += 1;
        if (offen.aufrufe > 1) nebenlaeufigeSchuebe += 1;
        offen = null;
      }
    },
    ergebnis() {
      // Der noch laufende Schub wird hier dazugezaehlt statt beim Eintreffen abgeschlossen:
      // ergebnis() darf mehrfach abgerufen werden, ohne den Zustand zu veraendern.
      return { werkzeugMs, schuebe, nebenlaeufigeSchuebe, offeneSchuebe: verwaiste + (offen ? 1 : 0) };
    },
  };
}

// --- Session-Kennzahlen (Issue #487) ---

// Ein Feld gilt nur als gelesen, wenn es eine endliche Zahl ist — auch die 0. Alles
// andere (fehlend, null, String, Objekt) wird zu null. Ein `|| null` taete das nicht:
// Es machte aus einer echten 0 ein "nicht verfuegbar", und im Ergebnisstand liesse sich
// eine Session ohne Zug nicht mehr von einer ohne Messwert unterscheiden.
function endlicheZahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

// Dieselbe Strenge fuer die beiden Felder, an denen der Ausgang einer Session haengt
// (Issue #668): Ein `stop_reason`, das kein String ist, und ein `is_error`, das kein
// Boolean ist, sind kein Messwert, sondern eine unbekannte Fassung des Ereignisses.
// Sie als `null` zu fuehren sagt "nicht gemessen"; sie durchzureichen hiesse, einen
// Grund-Praefix auf ein Objekt zu stuetzen.
function nurString(wert) {
  return typeof wert === "string" ? wert : null;
}

function nurBoolean(wert) {
  return typeof wert === "boolean" ? wert : null;
}

/**
 * Liest Kosten, API-Dauer und Zahl der Zuege aus dem `result`-Ereignis eines
 * Session-Streams.
 *
 * Reine Funktion ueber dem stdout aus `runSession`: Board, Dateisystem und Subprozesse
 * bleiben draussen, damit das Fehlerverhalten an Fixtures pruefbar ist (Linie von
 * `parseDeps`). Exportiert genau deshalb.
 *
 * `interpretStreamEvent` bleibt unberuehrt — es wertet ausschliesslich `assistant`-
 * Ereignisse fuer das Live-Protokoll aus. Diese Funktion tritt daneben, nicht an seine
 * Stelle.
 *
 * Das `result`-Ereignis gibt es nur mit `--verbose`; ohne das Flag liefert `claude -p`
 * reinen Text, und die Antwort ist `null`. Unlesbare Zeilen (abgeschnitten beim Kill am
 * Zeitlimit, Fremdausgabe) werden uebersprungen statt geworfen: Eine Kennzahl darf einen
 * ausgewerteten Lauf nicht zu Fall bringen.
 *
 * Bei mehreren `result`-Zeilen zaehlt die letzte. `subtype` bleibt unbeachtet — auch
 * eine abgebrochene Session hat gekostet, und ihr Ausgang steht ohnehin am Board.
 *
 * Seit Issue #668 kommen `stop_reason` und `is_error` mit: An ihnen haengt, ob eine
 * Runde ohne Ergebnis regulaer beendet wurde (`end_turn` — die Session hat auf etwas
 * gewartet, das nie kam) oder abgebrochen ist. Sie stehen in derselben Zeile; ein
 * zweiter Durchlauf ueber dasselbe stdout waere Aufwand ohne Gewinn, und zwei Stellen,
 * die dieselbe Zeile deuten, laufen auseinander.
 *
 * Rueckgabe: `{ kostenUsd, apiDauerMs, zuege, stopReason, isError }` in US-Dollar,
 * Millisekunden, Anzahl, Zeichenkette und Ja/Nein — je ein Wert oder `null` —, oder
 * `null`, wenn keine `result`-Zeile im stdout steht. Die Schluessel sind verbindlich:
 * Issue #488 uebernimmt sie in den Ergebnisstand.
 */
export function leseKennzahlen(stdout) {
  let letzte = null;
  for (const zeile of String(stdout ?? "").split(/\r\n|\r|\n/)) {
    const trimmed = zeile.trim();
    // Billiger Vorfilter: Ein Stream-Ereignis ist immer ein JSON-Objekt. Das haelt
    // JSON.parse von jeder Fliesstext-Zeile fern.
    if (!trimmed.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // unlesbare Zeile tolerant ueberspringen, wie in emitVerbose
    }
    if (obj && typeof obj === "object" && obj.type === "result") letzte = obj;
  }
  if (!letzte) return null;
  // Die vier Mengen aus `usage` (Issue #669): Die CLI meldet sie ohnehin, und nur wer sie
  // nicht verwirft, kann sie am Board zeigen. Kein Rechnen, nur Durchreichen.
  const usage = letzte.usage && typeof letzte.usage === "object" ? letzte.usage : {};
  // Die Teilung des Zwischenspeichers nach Haltedauer (Issue #749, Review-Fund W2): Die
  // Preistabelle (kit/preise.mjs) fuehrt zwei Saetze, die um bis zu 60 Prozent auseinander
  // liegen — ohne die Teilung waere die Kostenverteilung geraten. `cacheErzeugtTokens`
  // bleibt unveraendert die Summe; fehlt `usage.cache_creation` im Strom, bleiben beide
  // neuen Felder `null` statt einer Schaetzung.
  const teilung = usage.cache_creation && typeof usage.cache_creation === "object" ? usage.cache_creation : null;
  return {
    kostenUsd: endlicheZahl(letzte.total_cost_usd),
    apiDauerMs: endlicheZahl(letzte.duration_api_ms),
    zuege: endlicheZahl(letzte.num_turns),
    stopReason: nurString(letzte.stop_reason),
    isError: nurBoolean(letzte.is_error),
    eingabeTokens: endlicheZahl(usage.input_tokens),
    ausgabeTokens: endlicheZahl(usage.output_tokens),
    cacheErzeugtTokens: endlicheZahl(usage.cache_creation_input_tokens),
    cacheGelesenTokens: endlicheZahl(usage.cache_read_input_tokens),
    cache5mTokens: endlicheZahl(teilung?.ephemeral_5m_input_tokens),
    cache1hTokens: endlicheZahl(teilung?.ephemeral_1h_input_tokens),
  };
}

// --- Verbrauch je Einheit und Lauf (Issue #669) ---

/** Die Felder des Verbrauchs, in dieser Reihenfolge im Ergebnisstand. */
const VERBRAUCH_FELDER = ["kostenUsd", "eingabeTokens", "ausgabeTokens", "cacheErzeugtTokens", "cacheGelesenTokens"];

/** Ein Verbrauch, in dem noch nichts gemessen wurde: jedes Feld `null`, nie 0. */
export function verbrauchLeer() {
  return Object.fromEntries(VERBRAUCH_FELDER.map((feld) => [feld, null]));
}

/**
 * Addiert die Mengen einer Session feldweise auf `ziel`. Eine fehlende Menge traegt nichts
 * bei; ein Feld, zu dem nie eine Menge kam, bleibt `null` — eine 0 behauptete, es sei
 * nichts verbraucht worden. Reine Funktion ueber dem uebergebenen Objekt.
 */
export function verbrauchAddieren(ziel, kennzahlen) {
  for (const feld of VERBRAUCH_FELDER) {
    const wert = kennzahlen?.[feld];
    if (typeof wert === "number" && Number.isFinite(wert)) ziel[feld] = (ziel[feld] ?? 0) + wert;
  }
  return ziel;
}

/**
 * Der Verbrauch, der zu keiner Einheit gehoert: Lauf-Summe minus Summe ueber die Einheiten.
 * Nur der Runner kennt beide Seiten — gerechnet aus den Einheiten allein waere der Rest per
 * Konstruktion null. Ohne Lauf-Menge bleibt ein Feld `null`; eine Seite ohne Einheiten zaehlt
 * 0, denn dann gehoert der ganze Verbrauch zu keiner Karte. Die Kosten werden auf sechs
 * Stellen gerundet, damit kein Gleitkomma-Rauschen als Rest erscheint.
 */
export function verbrauchOhneEinheit(lauf) {
  const einheiten = verbrauchLeer();
  for (const e of lauf?.einheiten ?? []) verbrauchAddieren(einheiten, e.verbrauch);
  const rest = verbrauchLeer();
  for (const feld of VERBRAUCH_FELDER) {
    const gesamt = lauf?.verbrauch?.[feld];
    if (typeof gesamt !== "number") continue;
    const differenz = gesamt - (einheiten[feld] ?? 0);
    // `+ 0` macht aus einer gerundeten -0 eine 0.
    rest[feld] = feld === "kostenUsd" ? Math.round(differenz * 1e6) / 1e6 + 0 : differenz;
  }
  return rest;
}

/**
 * Verbucht die Mengen einer Session auf den Lauf und — gehoert sie zu einer Karte — auf
 * deren juengste Einheit; danach steht der Rest neu im Stand. `issueId` ist `null` fuer
 * Sessions ohne Karte, etwa den Vorflug.
 */
function verbrauchErfassen(issueId, kennzahlen) {
  if (!LAUF || !kennzahlen) return;
  verbrauchAddieren(LAUF.verbrauch, kennzahlen);
  const einheit = issueId === null ? null : LAUF.einheiten.findLast((e) => e.id === String(issueId));
  if (einheit) verbrauchAddieren(einheit.verbrauch ??= verbrauchLeer(), kennzahlen);
  LAUF.verbrauchOhneEinheit = verbrauchOhneEinheit(LAUF);
  schreibeErgebnisstand();
}

/**
 * Die Zeiten einer Session nach den Begriffen aus Issue #737 (Plan #745, E1/E2): Nachdenken
 * ist die API-Dauer der Session, Werkzeugarbeit kommt vom Beobachter aus Issue #748, und der
 * Rest ist die Session-Dauer selbst — kein gerechneter dritter Wert, sondern die Gesamtspanne,
 * aus der Nachdenken und Werkzeugarbeit ohnehin Teilmengen sind.
 *
 * Reine Funktion ueber den drei Quellen, damit sie an Fixtures pruefbar ist — dieselbe Linie
 * wie `verbrauchAddieren`. Ein nicht gemessener Wert bleibt `null`, nie 0.
 */
export function zeitenBauen(dauerMs, kennzahlen, werkzeug) {
  return {
    dauerMs: endlicheZahl(dauerMs),
    nachdenkenMs: endlicheZahl(kennzahlen?.apiDauerMs),
    werkzeugMs: endlicheZahl(werkzeug?.werkzeugMs),
    werkzeugSchuebe: endlicheZahl(werkzeug?.schuebe),
    nebenlaeufigeSchuebe: endlicheZahl(werkzeug?.nebenlaeufigeSchuebe),
  };
}

/**
 * Schreibt die Zeiten einer Session auf die juengste Einheit der Karte — an derselben
 * Stelle aufgerufen wie `verbrauchErfassen()`, mit demselben Ziel-Muster (`findLast`): Laeuft
 * dieselbe Karte mehrfach in einem Lauf (etwa regulaere Runde und Salvage), trifft jeder
 * Aufruf dieselbe, juengste Einheit und ueberschreibt ihre Zeiten mit dem neuesten Stand.
 *
 * `issueId === null` (eine Session ohne Karte, etwa der Vorflug) schreibt nichts: Es gibt
 * keine Einheit, der die Zeit gehoert.
 */
function zeitenErfassen(issueId, dauerMs, kennzahlen, werkzeug) {
  if (!LAUF || issueId === null) return;
  const einheit = LAUF.einheiten.findLast((e) => e.id === String(issueId));
  if (!einheit) return;
  einheit.zeiten = zeitenBauen(dauerMs, kennzahlen, werkzeug);
  schreibeErgebnisstand();
}

/**
 * Addiert die Kosten einer Session auf den Lauf (Plan #638, A5; E1).
 *
 * `kostenUsd: null` — kein `result`-Ereignis, kein Wert — zaehlt 0 und erhoeht
 * `kostenUnbekannt`: Eine fehlende Kennzahl ist kein Verstoss gegen das Budget, aber
 * der Bericht soll sagen, dass eine Session nicht gemessen wurde. Reine Funktion ueber
 * dem uebergebenen Lauf-Objekt, damit sie an Fixtures pruefbar ist; die Pruefung gegen
 * das Budget sitzt dort, wo der Ausgang entschieden wird.
 */
export function kostenAddieren(lauf, kennzahlen) {
  lauf.kostenSumme = (lauf.kostenSumme ?? 0);
  lauf.kostenUnbekannt = (lauf.kostenUnbekannt ?? 0);
  const kosten = kennzahlen?.kostenUsd;
  if (typeof kosten === "number" && Number.isFinite(kosten)) lauf.kostenSumme += kosten;
  else lauf.kostenUnbekannt += 1;
  return lauf;
}

/**
 * Der Text der letzten Nachricht einer Session — das Feld `result` des letzten
 * `result`-Ereignisses (Plan #638, A9). Dieselbe Zeile, aus der `leseKennzahlen` die
 * Kosten liest; `null`, wenn keine da ist oder der Text leer ist.
 */
export function leseErgebnisText(stdout) {
  let letzte = null;
  for (const zeile of String(stdout ?? "").split(/\r\n|\r|\n/)) {
    const trimmed = zeile.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && obj.type === "result") letzte = obj;
  }
  const text = typeof letzte?.result === "string" ? letzte.result.trim() : "";
  return text === "" ? null : text;
}

// --- Das Modell einer Karte (Issue #665) ---

// So eng gefasst wie AUTOR_MODELL_ZEILE in kit/board.mjs: Anker am Zeilenanfang, damit
// eine Erwaehnung im Fliesstext nicht trifft, und `\S+` als Wert — kein Leerraum, kein
// zweites Wort. Ein Wert wie `claude-opus-5 --yolo` faellt damit schon hier durch und
// nicht erst am Vergleich mit der Liste.
const EMPFOHLENES_MODELL_ZEILE = /^Empfohlenes Modell:[^\S\n]*(\S+)[^\S\n]*$/m;

/**
 * Das Modell, mit dem die Session dieser Karte starten soll (Issue #665).
 *
 * Reine Funktion ueber Body und Liste — kein Board, kein Dateisystem —, damit die
 * Zuordnung an Fixtures pruefbar ist.
 *
 * **Die Liste ist die einzige Pruefung** (Plan #663, E3), und sie ist der
 * Sicherheitskern dieses Wegs: Ohne sie wanderte ein Wert aus einem Issue-Body unbesehen
 * in `argv`. Ein Paket mit `Empfohlenes Modell: --dangerously-skip-permissions` waere ein
 * Angriff ueber eine Karte — deshalb gilt ein Wert mit fuehrendem Bindestrich nicht
 * einmal als Kandidat, und deshalb wird gegen eine Liste verglichen statt gegen ein
 * Muster. Ein Muster liesse sich erweitern, eine Liste nicht.
 *
 * Rueckgabe `{ modell, grund }`:
 *   - Name auf der Liste  -> `{ modell: <name>, grund: null }`
 *   - Name nicht auf der Liste -> `{ modell: null, grund: <ein Satz> }`
 *   - keine Zeile, leere oder fehlende Liste -> `{ modell: null, grund: null }`
 *
 * Der Unterschied zwischen den letzten beiden Faellen ist der Punkt: Ein abgewiesener
 * Name gehoert in die Einheit, eine fehlende Empfehlung ist der Normalfall und kein
 * Befund.
 */
export function empfohlenesModell(body, erlaubte) {
  const liste = Array.isArray(erlaubte) ? erlaubte : [];
  if (liste.length === 0) return { modell: null, grund: null };

  const treffer = String(body ?? "").match(EMPFOHLENES_MODELL_ZEILE);
  if (!treffer) return { modell: null, grund: null };

  const name = treffer[1];
  // Fuehrender Bindestrich: nie ein Modellname, immer ein Flag. Der Vergleich mit der
  // Liste wuerde ihn ohnehin abweisen — die eigene Zeile steht hier, weil diese Stelle
  // die ist, an der jemand spaeter eine Abkuerzung einbauen koennte.
  if (name.startsWith("-")) {
    return { modell: null, grund: `Empfohlenes Modell "${name}" beginnt mit einem Bindestrich und ist kein Modellname — Modell des Laufs.` };
  }
  if (!liste.includes(name)) {
    return { modell: null, grund: `Empfohlenes Modell "${name}" steht nicht in night.modelle — Modell des Laufs.` };
  }
  return { modell: name, grund: null };
}

// --- Die Stufe einer Karte (Issue #709, Plan #707) ---

// Derselbe enge Anker wie EMPFOHLENES_MODELL_ZEILE: Zeilenanfang, ein Wort ohne Leerraum.
// Eine Erwaehnung im Fliesstext ("... siehe Aufgabenstufe: leicht ...") trifft er nicht,
// und ein Wert aus zwei Woertern faellt schon hier durch.
const AUFGABENSTUFE_ZEILE = /^Aufgabenstufe:[^\S\n]*(\S+)[^\S\n]*$/m;

// Die Ordnung der Stufen, von der leichtesten zur schwersten. Sie ist die Richtung, in die
// ausgewichen wird: nach oben, nie nach unten. Eine Aufgabe, fuer die die vorgesehene Stufe
// fehlt, laeuft lieber mit einem staerkeren Modell als mit einem schwaecheren.
const STUFEN_ORDNUNG = ["leicht", "mittel", "schwer"];

/**
 * Die Stufe, die ein Arbeitspaket sich selbst gibt (Issue #709).
 *
 * Reine Funktion ueber den Body — kein Board, kein Dateisystem, keine Einstellung.
 *
 * Rueckgabe `{ stufe, grund }`:
 *   - bekannter Wert -> `{ stufe: <schwer|mittel|leicht>, grund: null }`
 *   - anderer Wert   -> `{ stufe: null, grund: <ein Satz> }`
 *   - keine Zeile    -> `{ stufe: null, grund: null }`
 *
 * Der Unterschied zwischen den letzten beiden Faellen ist derselbe wie bei
 * `empfohlenesModell`: Ein abgewiesener Wert gehoert in die Einheit, eine fehlende Zeile ist
 * der Normalfall und kein Befund. Bestandspakete tragen die Zeile nicht (Plan #707, E12).
 */
export function aufgabenStufe(body) {
  const treffer = String(body ?? "").match(AUFGABENSTUFE_ZEILE);
  if (!treffer) return { stufe: null, grund: null };

  const wert = treffer[1];
  if (!STUFEN_ORDNUNG.includes(wert)) {
    return { stufe: null, grund: `Aufgabenstufe "${wert}" ist kein bekannter Stufenwert (schwer, mittel, leicht) — keine Stufe.` };
  }
  return { stufe: wert, grund: null };
}

const alsText = (wert) => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

/**
 * `night.stufen` als normalisierte Abbildung Stufe -> `{ modell, kommando, name }`
 * (Issue #709).
 *
 * Leere Stufen werden weggeworfen: Was weder `modell` noch `kommando` traegt, ist keine
 * Stufe, sondern eine Luecke — und eine Luecke soll zum Ausweichen nach oben fuehren und
 * nicht zu einem Eintrag, den `modellFuerStufe` erst wieder pruefen muesste.
 *
 * `aktiv` ist wahr, sobald **eine** Stufe belegt ist (Plan #707, E4): Teilbelegung ist der
 * beabsichtigte Normalfall — ein Projekt, das nur die leichten Pakete billiger fahren will,
 * belegt genau eine Stufe. Ein fehlender Block, ein leerer Block und drei leere Stufen
 * ergeben `aktiv: false`, und damit bleibt alles beim Modell des Laufs.
 */
export function stufenEinstellung(config) {
  const roh = config?.night?.stufen;
  const stufen = {};
  if (roh && typeof roh === "object") {
    for (const stufe of STUFEN_ORDNUNG) {
      const eintrag = roh[stufe];
      if (!eintrag || typeof eintrag !== "object") continue;
      const modell = alsText(eintrag.modell);
      const kommando = alsText(eintrag.kommando);
      if (!modell && !kommando) continue;
      stufen[stufe] = { modell, kommando, name: alsText(eintrag.name) };
    }
  }
  return { aktiv: Object.keys(stufen).length > 0, stufen };
}

// Fuehrende Zuweisungen einer Kommandozeile (`OLLAMA_HOST=… PORT=9 mein-runner …`) sind
// Umgebung und nicht das Programm. Wer sie mitsucht, sucht nach einem Programm namens
// `OLLAMA_HOST=…` und weicht still nach oben aus, obwohl das Programm daliegt (E8).
const ZUWEISUNG = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Laesst sich diese Stufe starten (Issue #709, Plan #707, E8)?
 *
 * Die Pruefung liegt nachweislich **vor** dem ersten Arbeitsschritt — das ist ihr Zweck:
 * Nur was hier scheitert, darf nach oben ausweichen, ohne eine begonnene Umsetzung zu
 * wiederholen. Jeder spaetere Fehlschlag faellt unter die bisherigen Fehlerregeln.
 *
 *   - `modell`: Der Name steht in `night.modelle` (E18). Dieselbe eine Liste wie bei
 *     `empfohlenesModell`; zwei Listen nebeneinander liefen auseinander.
 *   - `kommando`: Die Plattform ist nicht Windows (E17), und das erste Wort nach den
 *     fuehrenden Zuweisungen ist ueber **dieselbe Shell** auffindbar, die spaeter startet.
 *     `command -v` statt einer eigenen PATH-Suche, damit auch Builtins und Funktionen
 *     gelten — eine halbe Nachbildung der Shell scheitert still am ersten Sonderfall.
 *
 * Rueckgabe `{ ok, grund }`; `grund` ist bei `ok: true` immer `null`.
 */
export function stufeStartbar(eintrag, erlaubteModelle) {
  const modell = alsText(eintrag?.modell);
  const kommando = alsText(eintrag?.kommando);

  if (modell) {
    const liste = Array.isArray(erlaubteModelle) ? erlaubteModelle : [];
    if (!liste.includes(modell)) return { ok: false, grund: `Modell "${modell}" steht nicht in night.modelle` };
    return { ok: true, grund: null };
  }

  if (!kommando) return { ok: false, grund: "weder modell noch kommando gesetzt" };

  if (process.platform === "win32") {
    return { ok: false, grund: "eine Kommando-Stufe braucht eine POSIX-Shell, die es unter Windows nicht gibt" };
  }

  const woerter = kommando.trim().split(/\s+/);
  const programm = woerter.find((w) => !ZUWEISUNG.test(w));
  if (!programm) return { ok: false, grund: `die Kommandozeile "${kommando}" nennt nur Umgebung und kein Programm` };

  // Das Wort steht als Argument daneben und nie im Shell-String — dieselbe Trennung wie
  // beim spaeteren Start (E9), damit die Pruefung nicht zur Einsetzungsluecke wird.
  const res = spawnSync("sh", ["-c", 'command -v -- "$1" >/dev/null', "sh", programm], { encoding: "utf-8" });
  if (res.error) return { ok: false, grund: `die Shell fuer "${programm}" liess sich nicht starten: ${res.error.message}` };
  if (res.status !== 0) return { ok: false, grund: `das Programm "${programm}" ist ueber die Shell nicht auffindbar` };
  return { ok: true, grund: null };
}

/**
 * Die Stufe, mit der ein Paket dieser Aufgabenstufe laeuft (Issue #709, Plan #707, E7).
 *
 * Geht von `stufe` aus nach oben — leicht, mittel, schwer — und liefert die erste belegte
 * **und** startbare Stufe. Unbelegt und nicht startbar fuehren zur selben Bewegung: Beide
 * Anlaesse stehen deshalb in einer Funktion, damit sie bei einer Aenderung nicht
 * auseinanderlaufen. Der Unterschied liegt allein im Ende der Kette, und darueber
 * entscheidet der Aufrufer — diese Funktion liefert nur den Befund.
 *
 * Rueckgabe `{ stufeVerwendet, eintrag, grund }`. `grund` nennt je uebersprungener Stufe
 * einen Satz und ist `null`, wenn nichts uebersprungen wurde. Findet sich keine Stufe,
 * steht `stufeVerwendet: null` mit Grund.
 */
export function modellFuerStufe(einstellung, stufe, erlaubteModelle) {
  const stufen = einstellung?.stufen ?? {};
  const start = STUFEN_ORDNUNG.indexOf(stufe);
  if (start < 0) return { stufeVerwendet: null, eintrag: null, grund: `"${stufe}" ist keine Aufgabenstufe` };

  const uebersprungen = [];
  for (const kandidat of STUFEN_ORDNUNG.slice(start)) {
    const eintrag = stufen[kandidat];
    if (!eintrag) {
      uebersprungen.push(`Stufe ${kandidat} nicht belegt`);
      continue;
    }
    const { ok, grund } = stufeStartbar(eintrag, erlaubteModelle);
    if (!ok) {
      uebersprungen.push(`Stufe ${kandidat} nicht startbar: ${grund}`);
      continue;
    }
    return { stufeVerwendet: kandidat, eintrag, grund: uebersprungen.length > 0 ? uebersprungen.join("; ") : null };
  }
  return { stufeVerwendet: null, eintrag: null, grund: uebersprungen.join("; ") };
}

/** Die Gruende eines Pakets in einem Satz — leere Teile fallen weg. */
const gruendeFassen = (...teile) => {
  const gefuellt = teile.filter((t) => typeof t === "string" && t.trim() !== "");
  return gefuellt.length > 0 ? gefuellt.join(" ") : null;
};

/**
 * Womit dieses Arbeitspaket laeuft (Issue #711, Plan #707, E5/E6).
 *
 * Die eine Stelle, an der Modellname und Aufgabenstufe aufeinandertreffen — reine Funktion
 * ueber Body, Einstellung und Modell des Laufs, damit die Reihenfolge an Fixtures pruefbar
 * ist. Sie ist der Kern des Pakets, und ihre Reihenfolge ist die Sache selbst:
 *
 *   1. Der Modellname der Karte nach den heutigen Regeln. Er gewinnt gegen die Stufe
 *      (Kriterium 8); traegt das Paket beides, vermerkt der Grund die doppelte Angabe.
 *   2. Ein ABGEWIESENER Name faellt auf das Modell des Laufs und **nicht** auf die Stufe
 *      (E6). Ein Vertipper darf nicht still ein anderes Modell in Gang setzen — wer
 *      `claude-opus-5` falsch schreibt, bekommt den Lauf und einen Grund, nicht das Modell
 *      einer Stufe, an die er nicht gedacht hat.
 *   3. Sonst, und nur bei aktiver Einstellung, die Stufe mit dem Ausweichen nach oben.
 *   4. Sonst das Modell des Laufs.
 *
 * Rueckgabe: `{ modell, herkunft, grund, stufe, stufeVerwendet, kommando, stufenName,
 * startbar }`. `startbar: false` heisst, dass die Stufe des Pakets auf keiner erreichbaren
 * Ebene startet — dann darf **keine** Session beginnen (Kriterium 10), und der Aufrufer
 * verbucht das Paket als Fehlschlag. `herkunft` kennt `karte`, `stufe` und `lauf`.
 *
 * Bei einer Kommando-Stufe steht in `modell` die Selbstauskunft der Stufe (ihr Feld `name`,
 * ersatzweise `stufe-<aufgabenstufe>`) — derselbe Wert, den `runSession` als
 * KIT_AGENT_MODEL setzt. Einen Modellnamen gibt es dort nicht, und `null` im Ergebnisstand
 * liesse offen, womit das Paket gelaufen ist.
 */
export function paketWahl({ body, einstellung, erlaubteModelle, laufModell }) {
  const { modell: ausKarte, grund: modellGrund } = empfohlenesModell(body, erlaubteModelle);
  const { stufe, grund: stufenGrund } = aufgabenStufe(body);
  const rahmen = { stufe, stufeVerwendet: null, kommando: null, stufenName: null, startbar: true };

  if (ausKarte) {
    // Die doppelte Angabe ist kein Fehler, sondern eine Auskunft: Der Mensch soll sehen,
    // dass die Stufe der Karte an diesem Paket ohne Wirkung blieb.
    const doppelt = stufe ? `Karte nennt Modell und Aufgabenstufe ${stufe} — der Modellname gewinnt.` : null;
    return { ...rahmen, modell: ausKarte, herkunft: "karte", grund: gruendeFassen(doppelt, stufenGrund) };
  }

  const beimLauf = (grund) => ({ ...rahmen, modell: laufModell, herkunft: "lauf", grund: gruendeFassen(grund) });

  if (modellGrund) return beimLauf(modellGrund);
  if (!einstellung?.aktiv || !stufe) return beimLauf(stufenGrund);

  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, stufe, erlaubteModelle);
  if (!stufeVerwendet) {
    // Kein Rueckfall auf das Modell des Laufs (Kriterium 10): Wer eine Stufe setzt, will
    // dieses Paket auf dieser Ebene laufen lassen — ein stiller Ersatz waere eine Umsetzung,
    // die niemand so beauftragt hat.
    return { ...rahmen, modell: null, herkunft: "stufe", grund: gruendeFassen(grund), startbar: false };
  }
  const selbstauskunft = eintrag.name || `stufe-${stufe}`;
  return {
    ...rahmen,
    stufeVerwendet,
    kommando: eintrag.kommando,
    stufenName: eintrag.name,
    modell: eintrag.modell ?? selbstauskunft,
    herkunft: "stufe",
    grund: gruendeFassen(grund),
  };
}

/**
 * `night.stufen` und `night.stufenRegel`, frisch von Platte (Issue #711, Plan #707, E19).
 *
 * Nur diese beiden Felder: Alles andere bleibt beim Stand des Laufbeginns, weil ein Lauf,
 * der mitten in der Nacht sein Label, seine Checks oder seinen Tracker wechselt, nicht mehr
 * derselbe Lauf waere. Die Stufen dagegen sollen wirken, sobald sie jemand aendert — sonst
 * saehe ein laufender Nachtlauf eine Aenderung erst am naechsten Abend.
 *
 * Ein unlesbarer Stand haelt den Lauf nie auf: Dann gilt, was beim Start gelesen wurde, und
 * `grund` sagt es. Reine Funktion ueber Pfad und Startstand, damit dieser Fall ohne einen
 * kaputten Nachtlauf pruefbar ist.
 */
export function frischeStufenFelder(configPfad, stand) {
  const vomStart = (grund) => ({ stufen: stand?.night?.stufen, stufenRegel: stand?.night?.stufenRegel, grund });
  if (!configPfad) return vomStart(null);
  try {
    const frisch = ladeConfigMitOverrides(configPfad);
    return { stufen: frisch?.night?.stufen, stufenRegel: frisch?.night?.stufenRegel, grund: null };
  } catch (fehler) {
    return vomStart(`die Einstellung liess sich nicht frisch lesen (${fehler.message}) — es gilt der Stand des Laufbeginns.`);
  }
}

// --- Nacht-Session ---

/**
 * Wartet, bis in der Prozessgruppe einer beendeten Session kein Prozess mehr laeuft
 * (Issue #668).
 *
 * `runProcess` gibt jedem Kind eine eigene Prozessgruppe, toetet sie aber nur am
 * Zeitlimit. Endet eine Session regulaer, waehrend sie noch einen Hintergrundlauf haelt
 * — den Pflichtcheck, auf den sie zu warten glaubte —, laeuft dieser weiter. Zwei
 * Schaeden entstehen daraus, und beide sind in der Nacht zu #900 zu besichtigen:
 *
 *   1. Die Vorpruefung des Salvage startet ihren eigenen `mvn verify` daneben. Zwei
 *      gleichzeitige Testcontainers-Laeufe reissen einander die Ressourcen weg; die
 *      Vorpruefung war nach 72 Sekunden rot, bei einem Lauf, der Minuten braucht.
 *   2. Der ueberlebende `checks.mjs run` schreibt seine Zusammenfassung spaeter — im
 *      schlimmsten Fall nach `verwerfeZusammenfassung()` der naechsten Runde, deren
 *      Nachweis er damit faelscht.
 *
 * Gewartet wird hoechstens `restMs`; was laenger braucht, als die Runde hat, ist ohnehin
 * verloren, und ein unbegrenztes Warten waere genau der Hang, den der Zeitlimit-Timer
 * verhindern soll. Rueckgabe: `true`, wenn die Gruppe leer ist, `false` bei Ablauf der
 * Frist — der Aufrufer protokolliert das, haelt den Lauf aber nicht an.
 *
 * Windows kennt diese Prozessgruppen nicht (`runProcess` setzt `detached` dort nicht);
 * die Funktion meldet dort sofort `true`. Dieselbe bekannte Einschraenkung wie beim
 * Kill am Zeitlimit.
 */
export async function warteAufProzessgruppe(pgid, restMs, { pollMs = 200, jetzt = Date.now } = {}) {
  if (process.platform === "win32" || !pgid || restMs <= 0) return true;
  const frist = jetzt() + restMs;
  // `ps -o pid= -g <pgid>` listet die Prozesse der Gruppe; leere Ausgabe heisst leer.
  // Ein Fehlschlag von ps (Gruppe schon weg, ps nicht da) gilt ebenfalls als leer: Diese
  // Wartezeit ist eine Vorsichtsmassnahme und darf keine Runde aufhalten, weil ein
  // Werkzeug fehlt.
  const gruppeLaeuft = () => {
    const res = spawnSync("ps", ["-o", "pid=", "-g", String(pgid)], { encoding: "utf-8" });
    if (res.error || res.status !== 0) return false;
    return (res.stdout || "").trim() !== "";
  };
  while (gruppeLaeuft()) {
    if (jetzt() >= frist) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return true;
}

// Startet einen Prozess asynchron, sammelt stdout/stderr und (bei useStream)
// parst stdout live zeilenweise. Eigener Timeout-Timer statt spawnSync-timeout,
// weil wir waehrend des Laufs streamen muessen. Das Rueckgabe-Objekt spiegelt
// die von spawnSync bekannten Felder (status, signal, error, stdout, stderr),
// damit der Infrastruktur-Guard (#149) und die Erfolgs-/Fehlschlag-Pfade
// unveraendert weiterarbeiten; seit Issue #748 kommt `werkzeugzeit` dazu.
//
// `useStream` und `verbose` sind seit Issue #748 zwei Schalter und nicht mehr einer
// (Plan #745, Fund B1): MESSEN gehoert an den angeforderten Strom, AUSGEBEN an
// --verbose. Waeren sie weiterhin derselbe Schalter, gaebe es nur zwei gleich falsche
// Stellungen — die Werkzeugzeit in jedem normalen Nachtlauf dauerhaft "nicht gemessen",
// oder jedes Stream-Ereignis jeder Session in Konsole und Tagesprotokoll.
function runProcess(cmd, cmdArgs, { issueId, timeoutMs, useStream, verbose, extraEnv, cwd }) {
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
      // stdin geschlossen (Issue #620): Ohne Angabe waere es eine offene Pipe, die der
      // Runner nie schliesst — die CLI wartete je Session drei Sekunden auf Eingabe und
      // schrieb "no stdin data received" ins Protokoll. Niemand schreibt in stdin, der
      // Prompt geht als Argument; eine Session, die stdin liest, bekommt so sofort das
      // Dateiende. stdout und stderr bleiben Pipes fuer das Sammeln und Streamen.
      stdio: ["ignore", "pipe", "pipe"],
      // Plan #638, A4: Die Kette laesst ihre Sessions im Worktree laufen. Ohne Angabe
      // erbt das Kind das cwd des Runners, wie bisher.
      cwd: cwd ?? process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    let buf = "";
    let timedOut = false;
    let settled = false;
    const timers = [];
    // Nur angelegt, wenn der Strom auch angefordert ist (Issue #748). Ohne Strom gibt es
    // nichts zu messen, und `werkzeugzeit: null` sagt genau das — ein Ergebnis mit Nullen
    // waere die Behauptung, eine Session habe kein Werkzeug benutzt.
    const werkzeugzeit = useStream ? werkzeugZeitBeobachter() : null;
    // Fuer die Restfrist, in der nach dem Ende der Session auf ihre Prozessgruppe
    // gewartet wird (Issue #668): Sie teilt sich das Zeitlimit mit der Session selbst.
    const gestartet = Date.now();

    const done = (result) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      // An genau einer Stelle angehaengt, damit auch die Zeitlimit- und Fehlerpfade das
      // Gemessene mitbringen: Gerade eine abgebrochene Session ist die, bei der die
      // Werkzeugzeit erklaert, woran die Runde haengengeblieben ist.
      resolve({ ...result, werkzeugzeit: werkzeugzeit ? werkzeugzeit.ergebnis() : null });
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
        // Der Zeitstempel je Zeile stammt aus ihrer ANKUNFT — daraus entsteht die Spanne,
        // und im gesammelten stdout am Ende steht sie nicht mehr. Ein Stempel je Chunk
        // genuegt: Die Zeilen eines Chunks sind zusammen eingetroffen.
        const ts = Date.now();
        buf += text;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const zeile = buf.slice(0, idx);
          werkzeugzeit.zeile(zeile, ts);
          // Getrennt von der Messung (Issue #748): Ausgegeben wird nur bei --verbose,
          // gemessen wird immer, sobald der Strom angefordert ist.
          if (verbose) emitVerbose(issueId, zeile);
          buf = buf.slice(idx + 1);
        }
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => done({ status: null, signal: null, error: err, stdout, stderr }));
    child.on("close", async (code, signal) => {
      // Die letzte Zeile ohne Zeilenumbruch — oft die interessanteste einer Session, und
      // beim Zeitlimit die abgeschnittene. Auch sie geht erst in die Messung, dann in die
      // Ausgabe.
      if (useStream && buf.trim()) {
        werkzeugzeit.zeile(buf, Date.now());
        if (verbose) emitVerbose(issueId, buf);
      }
      const error = timedOut
        ? Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
        : null;
      // Erst messen, wenn niemand mehr arbeitet (Issue #668). Nach einem Zeitlimit
      // entfaellt das: Dort hat killTree die Gruppe gerade erledigt, und ein weiteres
      // Warten haenge den Lauf genau an dem Baum auf, den er eben abgeraeumt hat.
      if (!timedOut) {
        const restMs = Math.max(0, timeoutMs - (Date.now() - gestartet));
        const leer = await warteAufProzessgruppe(child.pid, restMs);
        if (!leer) {
          log(`  Hinweis: Nach dem Ende der Session liefen noch Prozesse ihrer Gruppe, als die Frist ablief — die folgende Messung kann von ihnen gestoert sein.`);
        }
      }
      done({ status: code, signal, error, stdout, stderr });
    });
  });
}

// opts (Issue #167): { prompt, timeoutMs, extraEnv } — die Salvage-Session nutzt
// denselben Mechanismus wie eine regulaere Runde, nur mit anderem Prompt und
// eigenem Zeitlimit. Ohne opts bleibt alles wie vor #167.
//
// Seit Plan #638 dazu: `cwd` (der Worktree der Kette, A4), `stream` (fordert den
// stream-json-Strom unabhaengig von --verbose an, A5 — das Kostenbudget darf nicht am
// Konsolenflag haengen; das Echo auf der Konsole bleibt an --verbose) und `stufe`
// (geht als NIGHT_KETTE_STUFE in die Kind-Umgebung, A14 — fuer die Test-Fakes und das
// Protokoll; KIT_AGENT_MODEL bleibt daneben das alleinige Erkennungsmerkmal der Skills).
//
// Seit Issue #668 `vordergrundCheck`: sperrt der Session das `Monitor`-Werkzeug und gibt
// ihr Bash-Zeitlimits in Hoehe des Rundenzeitlimits mit. Beides gehoert zusammen und
// traegt darum EINEN Schalter — die Sperre allein liesse die Session im Vordergrund an
// der Zehn-Minuten-Grenze des Bash-Werkzeugs sterben, die Zeitlimits allein aenderten
// nichts daran, dass sie weiterhin wartend enden kann. Gesetzt wird er fuer die
// Implementierungs-Runde; die Salvage-Session bekommt ihn nicht, ihr Prompt verbietet
// lange Laeufe ohnehin.
//
// Seit Issue #710 der Kommando-Zweig (Plan #707, E9/E10): `kommando` (die Kommandozeile
// der Stufe), `stufenName` (ihr Feld `name`) und `aufgabenstufe` (schwer, mittel, leicht)
// — gesetzt, wenn dieses Paket ueber ein Programm des Projekts statt ueber `claude` laufen
// soll. `aufgabenstufe` heisst bewusst nicht `stufe`: Das ist hier die Stufe der Nacht-Kette
// und bleibt es (E20). Ohne `kommando` aendert sich nichts.

/**
 * Womit eine Session startet: `{ cmd, cmdArgs }` fuer `runProcess()` (Issue #710).
 *
 * Drei Wege, und ihre Reihenfolge ist Teil der Sache:
 *
 *   1. `NIGHT_CLAUDE_CMD` — der Test-Hook. Er behaelt seinen Vorrang vor beiden anderen
 *      Zweigen; die Testsuite ersetzt damit die ganze Session. Bleibt bewusst bei `sh`
 *      (Issue #199): Die Fake-Skripte sind POSIX-Shell, und die night-Tests sind unter
 *      Windows ohnehin ausgenommen (Issue #197).
 *   2. `kommando` — das Programm der Stufe (Plan #707, E9). Der Auftrag steht als Argument
 *      daneben und erreicht das Programm ueber `"$@"`; er wird **nie** in den Shell-String
 *      eingesetzt. Eine Einsetzung waere die Einsetzungsluecke im eigenen Haus: Ein Auftrag
 *      mit Anfuehrungszeichen oder Backtick liefe dann als Shell-Kommando.
 *      `sh -c` statt einer eigenen Zerlegung der Kommandozeile (E17) — sie darf
 *      Anfuehrungszeichen und fuehrende NAME=WERT-Zuweisungen tragen, und eine halbe
 *      Nachbildung der Shell scheitert still am ersten Sonderfall. Unter Windows steht der
 *      Zweig damit nicht zur Verfuegung; das faengt `stufeStartbar` vor dem Start ab.
 *      `--model` entfaellt hier: Das Programm ist nicht `claude` und kennt das Flag nicht.
 *   3. sonst `claude --model <name>` wie bisher.
 *
 * NIGHT_PROMPT und der geschlossene stdin (Issue #620) haengen an `runProcess()` und gelten
 * darum in jedem der drei Wege.
 */
function sessionStart({ testCmd, kommando, prompt, modell, args, opts }) {
  if (testCmd) return { cmd: "sh", cmdArgs: ["-c", testCmd] };
  if (kommando) return { cmd: "sh", cmdArgs: ["-c", `${kommando} "$@"`, "sh", prompt] };

  const permArgs = args.yolo
    ? ["--dangerously-skip-permissions"]
    : ["--permission-mode", "acceptEdits"];
  const streamArgs = (args.verbose || opts.stream) ? ["--output-format", "stream-json", "--verbose"] : [];
  // Die Werkzeugsperre (Issue #668). `Monitor` ist das Werkzeug, mit dem eine Session
  // auf einen eigenen Hintergrundlauf wartet — und genau damit beendet sie ihren Zug,
  // weil eine headless -p-Session keinen Folge-Turn hat. Ohne das Werkzeug bleibt ihr
  // der Vordergrund-Aufruf, dessen Ergebnis sie noch verwerten kann.
  //
  // Die Sperre ersetzt eine Anweisung, die es laengst gibt: local-check verlangt seit
  // Issue #167 woertlich, einen Hintergrund-Check aktiv abzuwarten statt mit einer
  // Ankuendigung zu enden. Sie stand im Kontext der Sessions, die trotzdem so endeten
  // (kanban-kit #891, #899, #900). Das ist das #122-Prinzip am lebenden Objekt: Was ein
  // Modell klassenweise falsch macht, gehoert ins Gate und nicht in den Prompt.
  const werkzeugArgs = opts.vordergrundCheck ? ["--disallowedTools", "Monitor"] : [];
  return {
    cmd: "claude",
    cmdArgs: ["-p", prompt, "--model", modell, ...permArgs, ...streamArgs, ...werkzeugArgs],
  };
}

// Exportiert fuer die Kette und ihre Tests.
export async function runSession(issueId, args, opts = {}) {
  const timeoutMs = process.env.NIGHT_TIMEOUT_MS
    ? Number(process.env.NIGHT_TIMEOUT_MS)
    : (opts.timeoutMs ?? args.timeoutMin * 60 * 1000);
  // Das Issue wird der Session verbindlich uebergeben (Issue #191) — sie waehlt
  // nicht mehr selbst. Der Prompt geht zusaetzlich als NIGHT_PROMPT in die
  // Kindprozess-Umgebung, damit der Auftrag auch im Test-Hook-Pfad sichtbar ist.
  const prompt = opts.prompt || `/implement-next #${issueId}`;
  // Das Modell dieser Session (Issue #665). `opts.model ?? args.model` statt eines
  // Pflichtparameters: `runSession` ist exportiert und wird an mehreren Stellen mit
  // `args` allein gerufen — die Kette behaelt so ohne Zutun das Modell des Laufs.
  const modell = opts.model ?? args.model;
  // Die Kommandozeile der Stufe (Issue #710). Leerer Text zaehlt wie nicht gesetzt: Eine
  // Stufe ohne Programm ist keine Kommando-Stufe, und `sh -c ' "$@"'` startete gar nichts.
  const kommando = alsText(opts.kommando);
  // Die Selbstauskunft dieser Session (Plan #707, E10). Im Kommando-Zweig gibt es keinen
  // Modellnamen, den man melden koennte — dort steht das Feld `name` der Stufe, ersatzweise
  // `stufe-<schwer|mittel|leicht>`. Leer darf der Wert unter keinen Umstaenden sein:
  // KIT_AGENT_MODEL ist das alleinige Erkennungsmerkmal des unbeaufsichtigten Laufs, und
  // ohne Wert hielte sich jeder Skill dieser Session fuer beaufsichtigt.
  const selbstauskunft = kommando
    ? (alsText(opts.stufenName) || `stufe-${alsText(opts.aufgabenstufe) || "unbekannt"}`)
    : modell;
  const testCmd = process.env.NIGHT_CLAUDE_CMD;
  const { cmd, cmdArgs } = sessionStart({ testCmd, kommando, prompt, modell, args, opts });
  // Die Session-Dauer fuer die Zeiten-Erfassung (Issue #749): gemessen um genau den
  // Prozesslauf, wie Nachdenken (apiDauerMs) und Werkzeugarbeit (werkzeugzeit) es auch sind.
  const gestartet = Date.now();
  const res = await runProcess(cmd, cmdArgs, {
    // Verarbeitet wird der Strom, sobald er angefordert ist — dieselbe Bedingung wie in
    // `sessionStart` (Issue #748). Bisher stand hier `args.verbose` allein, und damit lag
    // der Strom jedes normalen Nachtlaufs unausgewertet als Block in `res.stdout`.
    // `verbose` daneben steuert nur noch die Ausgabe der Ereignisse.
    issueId, timeoutMs, useStream: args.verbose || opts.stream, verbose: args.verbose, cwd: opts.cwd,
    // KIT_AGENT_MODEL (Issue #193): Modell-Selbstauskunft fuer den Aktivitaetsverlauf
    // des Boards. Die Variable wird von den Bash-Kindprozessen der Session geerbt und
    // von board.mjs als Header X-Agent-Model gesendet — so steht im Verlauf, mit
    // welchem Modell der Nachtlauf gearbeitet hat. Nur hier gesetzt: interaktive
    // Sessions machen bewusst keine Angabe.
    extraEnv: {
      NIGHT_PROMPT: prompt,
      // Derselbe Wert wie in --model (Issue #665): Der Aktivitaetsverlauf des Boards
      // soll das Modell zeigen, mit dem wirklich gearbeitet wurde, nicht das des Laufs.
      // Im Kommando-Zweig steht hier der Name der Stufe (Issue #710, E10) — nie leer.
      KIT_AGENT_MODEL: selbstauskunft,
      ...(opts.stufe ? { NIGHT_KETTE_STUFE: opts.stufe } : {}),
      // Die zweite Haelfte der Werkzeugsperre (Issue #668): Ohne `Monitor` faehrt die
      // Session ihren Pflichtcheck im Vordergrund — und liefe dann in das Zeitlimit des
      // Bash-Werkzeugs, das bei zehn Minuten endet. Ein voller `mvn verify` mit
      // Testcontainers liegt darueber; die Session staerbe an der Uhr statt am Code.
      // Das Rundenzeitlimit ist die richtige Obergrenze: Was laenger braucht, als die
      // Runde hat, ist ohnehin verloren.
      ...(opts.vordergrundCheck
        ? { BASH_MAX_TIMEOUT_MS: String(timeoutMs), BASH_DEFAULT_TIMEOUT_MS: String(timeoutMs) }
        : {}),
      ...opts.extraEnv,
    },
  });
  if (!testCmd && res.error?.code === "ENOENT") {
    if (kommando) {
      // Im Kommando-Zweig bedeutet ein ENOENT des Spawns allein, dass `sh` selbst fehlt —
      // der Windows-Fall aus E17. Ein von der Shell nicht gefundenes Programm endet mit
      // Exit 127 und ist bereits von `stufeStartbar` vor dem Start gefangen (E8).
      //
      // Darum kein `fail()` wie beim fehlenden claude-CLI: Der Aufrufer soll nach oben
      // ausweichen koennen, statt den ganzen Lauf an einer Stufe zu verlieren, die nur
      // dieses eine Paket betrifft.
      res.startfehler = `die Shell "sh" fuer die Kommando-Stufe wurde nicht gefunden`;
    } else {
      fail("claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?", "umgebung");
    }
  }
  if (LOG_FILE) {
    appendFileSync(LOG_FILE, `--- Session-Output Issue #${issueId} ---\n${res.stdout || ""}${res.stderr || ""}\n`, "utf-8");
  }
  // Jede Session einer Karte an genau einer Stelle verbucht (Issue #669): Implementierung,
  // Salvage und alle Stufen der Kette laufen hier durch.
  const kennzahlen = leseKennzahlen(res.stdout);
  verbrauchErfassen(issueId, kennzahlen);
  zeitenErfassen(issueId, Date.now() - gestartet, kennzahlen, res.werkzeugzeit);
  return res;
}

// --- Pruef-Zusammenfassungen der Sessions (Issue #428) ---
//
// Der Runner sieht von einer Session nur Exit-Code, Board-Zustand und Working Tree.
// Was sie INNERHALB gepruft und was sie ausgelassen hat, erfaehrt er allein aus der
// Zusammenfassung, die `checks.mjs run` hinterlaesst (Issue #424). Bewusst NICHT aus
// dem Abschlussbericht: Der ist von einem Modell formulierter Text, und was die
// Maschine braucht, geht in diesem Repo nirgends durch Text.
//
// Nur die regulaeren Implementierungs-Runden liefern hier etwas ab. Die
// Salvage-Session ist strukturell aussen vor — sie laeuft erst nach dem Einsammeln,
// und ihr Prompt verbietet ihr Checks ausdruecklich; sie erschiene sonst als
// "ungeprueft", obwohl verifyChecksForSalvage extern die volle Liste gruen gefahren
// hat. Der Vorflug ebenso: Er gehoert zum Review-Modus, der diese Schleife nicht
// durchlaeuft.

/**
 * Loescht die Zusammenfassung vor dem Start einer Runde. Ohne diesen Schritt liesse
 * eine liegengebliebene Datei — vom Vortag oder von einer Session, die vor ihrer
 * Pruefung starb — eine ungepruefte Session als geprueft erscheinen. Erst dadurch
 * genuegt der feste Dateiname aus Issue #424.
 */
function verwerfeZusammenfassung() {
  try {
    rmSync(zusammenfassungPfad(process.cwd()), { force: true });
  } catch (err) {
    // Nicht loeschbar ist ein Grund, der Datei danach nicht zu glauben — aber kein
    // Grund, einen Nachtlauf zu beenden. Die Runde laeuft, der Vermerk steht im Log.
    log(`  Hinweis: die vorherige Pruef-Zusammenfassung liess sich nicht loeschen (${err.message}).`);
  }
}

/**
 * Liest, was die soeben beendete Session hinterlassen hat. Fehlt die Datei, ist das
 * KEIN harter Stopp: Die Session hat dann keine Pruefung gefahren, und der Bericht
 * sagt genau das. Faehrt eine Session `run` mehrfach (rot, Fix, erneut), steht hier
 * der letzte Lauf — daraus entsteht bewusst keine Historie.
 */
function lesePruefung(issueId) {
  const pfad = zusammenfassungPfad(process.cwd());
  if (!existsSync(pfad)) return { id: String(issueId), zustand: "ungeprueft" };
  try {
    const daten = JSON.parse(readFileSync(pfad, "utf-8"));
    // Der Umfang der Pruefung (Issue #749, Review-Fund): Kriterium 2 der Auswertung fragt,
    // wie oft eine Pruefung im vollen statt im eingegrenzten Umfang lief — ohne diese Felder
    // waere das nicht beantwortbar. Ein Stand aus der Zeit vor diesem Paket fuehrt sie nicht;
    // ein fehlendes Feld gilt als `unbekannt` und nicht als `eingegrenzt`, darum `null` und
    // nie `false`.
    const umfangFelder = {
      vollerUmfang: typeof daten.vollerUmfang === "boolean" ? daten.vollerUmfang : null,
      leeresPaket: typeof daten.leeresPaket === "boolean" ? daten.leeresPaket : null,
      basis: typeof daten.basis === "string" ? daten.basis : null,
      bereiche: Array.isArray(daten.bereiche) ? daten.bereiche : null,
      dauerGesamtMs: endlicheZahl(daten.dauerGesamtMs),
    };
    // Die Guetemessung (Issue #764): Das Feld steht nur da, wenn das Projekt eine Messung
    // benannt hat — dann aber in jedem Zustand, auch beim leeren Paket und beim roten Lauf
    // (Issue #763). Es wird hier nur weitergereicht und nirgends ausgewertet: Der Halt wegen
    // verfehlter Marke ist bereits der rote Lauf, und eine zweite Beurteilung an dieser
    // Stelle waere ein zweites Gate fuer dieselbe Entscheidung.
    const guete = daten.guete && typeof daten.guete === "object" ? { guete: daten.guete } : {};
    if (daten.leeresPaket) return { id: String(issueId), zustand: "leeresPaket", ...umfangFelder, ...guete };
    const laufen = daten.laufen ?? [];
    // Ein nicht gruener Eintrag ist etwas anderes als eine fehlende Datei: Dort ist
    // eine Pruefung gelaufen und hat versagt, hier ist keine gelaufen. Bis Issue
    // #471 fielen beide zusammen — jede lesbare Datei galt als "geprueft", auch
    // eine mit rotem Lauf, und der Zustand floss in werteRunde gar nicht ein.
    const ungruen = laufen.find((e) => e.ergebnis !== "gruen");
    return {
      id: String(issueId),
      zustand: ungruen ? "rot" : "geprueft",
      ...(ungruen ? { rotesKommando: ungruen.cmd, rotesErgebnis: ungruen.ergebnis } : {}),
      laufen,
      ausgelassen: daten.ausgelassen ?? [],
      ...umfangFelder,
      ...guete,
    };
  } catch (err) {
    // Eine unlesbare Datei ist keine Pruefung. Sie bekommt aber ihren eigenen Grund:
    // "kaputt" sagt etwas anderes als "gar nicht gelaufen".
    return { id: String(issueId), zustand: "unlesbar", fehler: err.message };
  }
}

function pruefListe(eintraege, leerText) {
  return eintraege.length === 0 ? leerText : eintraege.map((e) => `${e.cmd} (${e.grund})`).join("; ");
}

/** Eine Zeile je Session — auch die ohne Pruefung, sonst saehe sie aus wie keine. */
function pruefZeile(p) {
  if (p.zustand === "ungeprueft") return `  Issue #${p.id}: ungeprueft — die Session hat keine Pruefung gefahren.`;
  if (p.zustand === "unlesbar") return `  Issue #${p.id}: ungeprueft — Zusammenfassung nicht lesbar (${p.fehler}).`;
  if (p.zustand === "leeresPaket") return `  Issue #${p.id}: leeres Paket — keine Pruefung, weil nichts veraendert wurde.`;
  if (p.zustand === "rot") return `  Issue #${p.id}: rot — ${p.rotesKommando} endete ${p.rotesErgebnis}.`;
  const gelaufen = p.laufen.map((e) => `${e.cmd} -> ${e.ergebnis} (${e.grund})`).join("; ") || "keine";
  return `  Issue #${p.id}: gelaufen: ${gelaufen} | ausgelassen: ${pruefListe(p.ausgelassen, "keine")}`;
}

/**
 * Die Guete-Zeile einer Session (Issue #764, AK 9 aus #738): der erreichte Anteil und die
 * Marke, nach JEDEM Lauf — auch wenn er genuegt. Sonst bliebe genau das Problem des
 * Fachplans bestehen: Das Ergebnis wird angesehen, und dann passiert nichts. Hier faellt
 * ein Absinken frueh auf (Plan #753, E6).
 *
 * Eine eigene Zeile und kein Anhaengsel der Pruefzeile: Die traegt je nach Zustand
 * Verschiedenes, und der Anteil gehoert in keinen ihrer Saetze.
 */
function pruefGueteZeile(p) {
  const g = p.guete;
  const anteil = typeof g.anteil === "number" ? `${g.anteil} % erreicht` : `kein Anteil erhoben (${g.grund})`;
  const bewertung = typeof g.anteil === "number" ? ` — ${g.grund}` : "";
  return `  Issue #${p.id}: Guete: ${anteil}, Marke ${g.marke} %${bewertung}`;
}

/** Die Zeilen einer Session: die Pruefzeile, und darunter die Guete-Zeile, wenn gemessen wurde. */
function pruefZeilen(p) {
  return p.guete ? [pruefZeile(p), pruefGueteZeile(p)] : [pruefZeile(p)];
}

function pruefSummenzeile(pruefungen) {
  const zaehle = (zustand) => pruefungen.filter((p) => p.zustand === zustand).length;
  const geprueft = pruefungen.filter((p) => p.zustand === "geprueft");
  const summe = (feld, filter = () => true) =>
    geprueft.reduce((n, p) => n + p[feld].filter(filter).length, 0);
  const rot = summe("laufen", (e) => e.ergebnis === "rot");
  return `  Summe: ${pruefungen.length} Session(s) — ${geprueft.length} mit Pruefung, `
    + `${zaehle("leeresPaket")} ohne Aenderung, ${zaehle("ungeprueft") + zaehle("unlesbar")} ungeprueft, `
    + `${zaehle("rot")} rot; `
    + `${summe("laufen")} Pruefung(en) gelaufen (davon ${rot} rot), ${summe("ausgelassen")} ausgelassen.`;
}

/**
 * Der Pruefteil des Lauf-Berichts: je Session eine Zeile, darunter eine Summe.
 * Kriterium 11 aus Issue #420 verlangt die Auslassungen an zwei Stellen — am
 * Arbeitspaket (Abschlussbericht, Issue #426) und hier.
 */
function pruefBericht(pruefungen) {
  if (pruefungen.length === 0) return ["Pruefungen: keine Implementierungs-Runde gelaufen."];
  return ["Pruefungen der Sessions:", ...pruefungen.flatMap(pruefZeilen), pruefSummenzeile(pruefungen)];
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

/**
 * Die Eintraege aus `buildChecks`, die die Paketstufe tragen (Plan #753, E13/E14).
 *
 * Ein Eintrag ohne `stufe` gehoert zur Paketstufe — die String-Form, das Objekt
 * ohne `stufe` und `stufe: "paket"` bedeuten dasselbe. Das ist derselbe Default
 * wie in checks.mjs, und er haelt jede bestehende Config bei ihrem Verhalten.
 *
 * Der Nacht-Runner braucht sie an zwei Stellen: fuer die Salvage-Vorpruefung
 * (welche Kommandos laufen) und fuer den Start-Guard (gibt es ueberhaupt ein
 * Gate). Beide meinen die Paketstufe, denn beide urteilen ueber ein Arbeitspaket.
 */
// SYNC: derselbe Default steht in kit/checks.mjs (normalisiere) und wird in
// kit/einstellungen.mjs geprueft.
function paketstufenChecks(cfg) {
  return (cfg.buildChecks || []).filter((eintrag) => {
    const stufe = typeof eintrag === "string" ? undefined : eintrag.stufe;
    return (stufe ?? "paket") === "paket";
  });
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
//
// KEINE bereichsbezogene Auswahl, absichtlich (Entscheidung A6 des Plans #421,
// Issue #428): auch nicht ueber checks.mjs. Wer das spaeter als Luecke liest,
// dreht die Frage um, die diese Pruefung beantwortet. Nach einem sauberen
// Arbeitspaket lautet sie "hat diese Arbeit etwas kaputtgemacht?" — dort genuegen
// die beruehrten Bereiche. Beim Retten lautet sie "ist dieser unklare
// Zwischenstand ueberhaupt brauchbar?", und eine Runde ohne Ergebnis ist genau
// die, deren Absicht niemand kennt: Was sie angefasst hat, sagt kein Anker
// verlaesslich.
//
// Die STUFENauswahl beantwortet eine andere Frage und greift deshalb sehr wohl
// (Plan #753, E13): "ist dieser Zwischenstand brauchbar?" ist die Frage der
// Paketstufe. Eintraege mit `stufe` push oder merge sind erst beim Veroeffentlichen
// faellig; liefen sie hier mit, wartete jeder Rettungsversuch auf Pruefungen, die
// ihn nichts angehen. Beide Auswahlen sind unabhaengig: Bereich aus, Stufe an.
//
// Die Eintragsformen aus Issue #422 (String, { cmd, areas }, { cmd, always })
// meinen hier alle dasselbe — nur Kommando und Stufe zaehlen. `areas` wird nicht
// gelesen.
function runBuildChecksSync(cfg) {
  const env = checkEnv();
  let output = "";
  for (const eintrag of paketstufenChecks(cfg)) {
    const cmd = typeof eintrag === "string" ? eintrag : eintrag.cmd;
    const res = spawnSync(cmd, { cwd: process.cwd(), encoding: "utf-8", env, shell: true });
    output += `$ ${cmd}\n${res.stdout || ""}${res.stderr || ""}`;
    // Das rote Kommando namentlich (Issue #668): Ohne es nennt die Stopp-Meldung nur,
    // DASS die Checks rot waren. Im Protokoll zu #900 fehlte deshalb jede Spur davon,
    // welcher der vier Checks versagt hat — und die Ursache liess sich nicht pruefen.
    if (res.status !== 0) return { ok: false, output, rotesKommando: cmd };
  }
  return { ok: true, output, rotesKommando: null };
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
  if (first.ok) return { ok: true, output: first.output, formatFixCmd: null, rotesKommando: null };

  const fixCmd = (cfg.formatFixCommand || "").trim();
  if (!fixCmd) return { ok: false, output: first.output, formatFixCmd: null, rotesKommando: first.rotesKommando };

  log(`  buildChecks rot — einmaliger Format-Fix wird angewendet: ${fixCmd}`);
  // Wie oben: fixCmd kommt aus der Config und braucht deshalb die Shell der Plattform
  // (Issue #199). PATH-Aufloesung bewusst (S4036, Issue #183).
  spawnSync(fixCmd, { cwd: process.cwd(), encoding: "utf-8", env: checkEnv(), shell: true });

  const second = runBuildChecksSync(cfg);
  if (!second.ok) return { ok: false, output: second.output, formatFixCmd: null, rotesKommando: second.rotesKommando };
  log(`  FORMAT-FIX angewendet, buildChecks jetzt gruen — der Lauf geht weiter.`);
  return { ok: true, output: second.output, formatFixCmd: fixCmd, rotesKommando: null };
}

// Baut den Prompt der Salvage-Session. Kernpunkt: die Checks sind bereits extern
// gruen — die Session darf sie NICHT erneut starten, sonst laeuft sie in genau
// den Hintergrund-Check, der die Runde ueberhaupt erst gekostet hat.
//
// Zweiter Kernpunkt seit Issue #672: Der Board-Zug steht HINTER der Sauberkeits-
// pruefung, nicht daneben. Bis dahin liess Schritt 3 committen, verschieben und
// kommentieren in einem Zug — und im Nachtlauf vom 2026-08-05 (kanban-kit) stand die
// Karte danach in In review, waehrend Arbeit im Baum lag. Das Board meldete Erfolg,
// der Lauf meldete Fehlschlag, und auf main lag ein roter Stand. Wer nicht committen
// kann, soll die Karte gar nicht erst bewegen.
function salvagePrompt(issueId, checksOutput, formatFixCmd) {
  const tail = (checksOutput || "").trim().split("\n").slice(-15).join("\n");
  return [
    `Die Pflicht-Checks (buildChecks) dieses Projekts wurden soeben EXTERN ausgefuehrt und sind GRUEN.`,
    `Fuehre sie NICHT erneut aus und starte keine langen Builds.`,
    ``,
    `Im Working Tree liegen unkommittete Aenderungen zu Issue #${issueId}. Deine einzige Aufgabe:`,
    `1. Lies das Issue: node .claude/kit/board.mjs issue get ${issueId}`,
    `2. Sieh dir den Stand an: git status und git diff`,
    `3. Passt der Stand zum Issue, arbeite GENAU DIESE REIHENFOLGE ab:`,
    `   a) Committe ihn (Betreff mit "(Issue #${issueId})", im Body "Refs #${issueId}"`,
    `      — niemals Closes/Fixes/Resolves).`,
    `   b) Pruefe danach den Arbeitsbaum: git status --porcelain`,
    `   c) NUR wenn diese Ausgabe leer ist, bewege das Board und kommentiere:`,
    `      node .claude/kit/board.mjs issue move ${issueId} in_review`,
    `      node .claude/kit/board.mjs issue comment ${issueId} --text "..."`,
    `   d) Ist die Ausgabe NICHT leer, bleibt das Board unberuehrt: nicht verschieben,`,
    `      nicht kommentieren, sondern die liegengebliebenen Pfade in deiner Ausgabe benennen.`,
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

// SYNC: Allowlist und Merge-Logik stehen identisch in kit/board.mjs und kit/einstellungen.mjs
// (LOCAL_OVERRIDE_ALLOWLIST, mergeWorkflowConfig) — Aenderungen dort nachziehen.
// board.mjs und night.mjs sind bewusst eigenstaendige Single-File-Tools ohne
// gemeinsames Modul; geteilte Logik wird dupliziert und hier markiert.
//
// Fuer den Runner ist die Allowlist besonders wichtig: Die Pruefung auf leere
// buildChecks weiter unten ist sein einziges Gate. Waere das Feld lokal
// ueberschreibbar, koennte ein Nachtlauf ohne jede Absicherung durchlaufen.
const LOCAL_OVERRIDE_ALLOWLIST = ["reviewModel", "reviewCommand", "reviewScope", "triggers", "toolbox.tokenFile"];

// Das Reviewer-Paar (Issue #432): genau eines von reviewModel und reviewCommand gilt.
// Beide sind persoenlich ueberschreibbar — sonst koennte jemand seinen Claude-Reviewer
// lokal setzen, seinen Kommando-Reviewer aber nicht.
// SYNC: dieselbe Zuordnung steckt in kit/board.mjs und kit/einstellungen.mjs.
const REVIEWER_PAAR = { reviewModel: "reviewCommand", reviewCommand: "reviewModel" };

// SYNC: strukturgleich zu zerlegeAllowlist in kit/board.mjs.
// Zerlegt die Allowlist in die zwei Formen, in denen sie abgefragt wird: ganze Felder
// (`reviewModel`) und einzelne Blaetter unter einem Kopf (`toolbox.tokenFile`). Eigene
// Funktion, weil das eine andere Frage beantwortet als das Mischen darunter.
function zerlegeAllowlist(allowlist) {
  const erlaubteBlaetter = new Map();
  const erlaubteFelder = new Set();
  for (const pfad of allowlist) {
    const [kopf, blatt] = pfad.split(".");
    if (blatt) {
      if (!erlaubteBlaetter.has(kopf)) erlaubteBlaetter.set(kopf, new Set());
      erlaubteBlaetter.get(kopf).add(blatt);
    } else {
      erlaubteFelder.add(kopf);
    }
  }
  return { erlaubteFelder, erlaubteBlaetter };
}

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

  return mischeErlaubteFelder(shared, local);
}

/**
 * Legt die erlaubten Felder der persoenlichen Config ueber die geteilte (Issue #404).
 *
 * Getrennt vom Laden, weil es eine andere Frage ist: ladeConfigMitOverrides
 * beschafft die beiden Dateien und entscheidet, ob es ueberhaupt etwas zu mischen
 * gibt; diese Funktion entscheidet Feld fuer Feld, was uebernommen wird.
 */
/**
 * Setzt ein persoenliches Feld und raeumt beim Reviewer-Paar das Gegenstueck weg.
 *
 * Von reviewModel und reviewCommand darf genau eines gelten (Issue #432); striktes
 * feldweises Mischen liesse sonst beide stehen, sobald das Team den Claude-Default
 * faehrt und einer lokal mit fremder CLI reviewt. Stehen beide Felder in der lokalen
 * Datei, bleiben beide — die Datei ist dann schon fuer sich ungueltig.
 *
 * SYNC: strukturgleich zu setzePersoenlichesFeld in kit/board.mjs.
 */
function setzePersoenlichesFeld(config, feld, wert, local) {
  config[feld] = wert;
  const gegenstueck = REVIEWER_PAAR[feld];
  if (gegenstueck && !(gegenstueck in local)) delete config[gegenstueck];
}

function mischeErlaubteFelder(shared, local) {
  const config = { ...shared };
  const { erlaubteFelder, erlaubteBlaetter } = zerlegeAllowlist(LOCAL_OVERRIDE_ALLOWLIST);

  for (const [feld, wert] of Object.entries(local)) {
    if (erlaubteFelder.has(feld)) {
      setzePersoenlichesFeld(config, feld, wert, local);
    } else if (erlaubteBlaetter.has(feld) && wert && typeof wert === "object") {
      config[feld] = mischeBlattfelder(config[feld], wert, erlaubteBlaetter.get(feld), feld);
    } else {
      process.stderr.write(`Hinweis: '${feld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`);
    }
  }
  return config;
}

/**
 * Mischt die erlaubten Unterfelder eines Blocks (etwa `toolbox.tokenFile`).
 *
 * Eigene Funktion, weil hier eine zweite Allowlist gilt: Nicht der Block ist
 * freigegeben, sondern einzelne Blaetter darin. Ein nicht freigegebenes Unterfeld
 * wird gemeldet und faellt weg — es teamweit zu ueberschreiben waere genau das,
 * was die Trennung der beiden Dateien verhindern soll.
 */
function mischeBlattfelder(bisher, wert, blaetter, feld) {
  const zusammen = { ...bisher };
  for (const [unterfeld, unterwert] of Object.entries(wert)) {
    if (blaetter.has(unterfeld)) zusammen[unterfeld] = unterwert;
    else process.stderr.write(`Hinweis: '${feld}.${unterfeld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`);
  }
  return zusammen;
}

// --- Budgets der Nacht-Kette (Plan #638, A6; night.kette) ---

// Startwerte aus Fachplan #635, Kriterium 6. Alle Zeiten in Minuten, Kosten in US-Dollar.
export const KETTE_BUDGET_DEFAULTS = Object.freeze({
  label: "kit:night",
  varianteBLabel: "kit:durchziehen",
  planMin: 20,
  paketeMin: 15,
  reviewMin: 15,
  abdeckungMin: 10,
  umsetzungMin: 120,
  kostenUsd: 50,
  kostenUsdB: 150,
  korrekturrunden: 2,
});

/**
 * Liest `night.kette` aus der Config und prueft jede Zahl.
 *
 * Wirft einen Error mit dem Feldnamen statt `fail` zu rufen: Die Funktion ist rein und
 * an Fixtures pruefbar; die Kette macht aus dem Wurf den Abbruch vor der ersten Session.
 * Eine Zahl muss endlich und groesser 0 sein, `korrekturrunden` dazu ganzzahlig — ein
 * Budget von 0 waere eine Kette, die nie startet, und niemand saehe morgens, warum.
 */
export function ladeKetteBudget(config) {
  const block = config?.night?.kette ?? {};
  const budget = { ...KETTE_BUDGET_DEFAULTS };
  if (block.label !== undefined) {
    if (typeof block.label !== "string" || block.label.trim() === "") throw new Error("night.kette.label muss ein nicht leerer Text sein");
    budget.label = block.label.trim();
  }
  if (block.varianteBLabel !== undefined) {
    if (typeof block.varianteBLabel !== "string" || block.varianteBLabel.trim() === "") throw new Error("night.kette.varianteBLabel muss ein nicht leerer Text sein");
    budget.varianteBLabel = block.varianteBLabel.trim();
  }
  for (const feld of ["planMin", "paketeMin", "reviewMin", "abdeckungMin", "umsetzungMin", "kostenUsd", "kostenUsdB", "korrekturrunden"]) {
    if (block[feld] === undefined) continue;
    const wert = block[feld];
    if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
      throw new Error(`night.kette.${feld} muss eine Zahl groesser 0 sein, ist ${JSON.stringify(wert)}`);
    }
    if (feld === "korrekturrunden" && !Number.isInteger(wert)) {
      throw new Error(`night.kette.korrekturrunden muss ganzzahlig sein, ist ${wert}`);
    }
    budget[feld] = wert;
  }
  return budget;
}

/**
 * Die Budget-Felder, die nicht in `night.kette` stehen und deshalb aus den Defaults
 * kommen (Issue #659), in der Reihenfolge von `ladeKetteBudget`.
 *
 * Eigene Funktion statt einer zweiten Rueckgabe von `ladeKetteBudget`: Deren Ergebnis ist
 * exportiert und an Fixtures getestet, die Herkunft ist eine andere Frage.
 */
export function ketteBudgetDefaults(config) {
  const block = config?.night?.kette ?? {};
  return Object.keys(KETTE_BUDGET_DEFAULTS).filter((feld) => block[feld] === undefined);
}

/**
 * Die Variante einer Kette fuer eine Karte (Plan #691, E2/E3): "B", wenn die Karte
 * das Label aus `budget.varianteBLabel` traegt, sonst "A". Reine Funktion, nie ein
 * Wurf — die Variante ist eine Einordnung, kein Vorflug: eine Karte ohne `labels`,
 * ein leeres Label-Array und ein fehlendes `budget` ergeben alle "A".
 */
export function varianteVon(issue, budget) {
  const label = budget?.varianteBLabel;
  if (!label) return "A";
  return (issue?.labels || []).includes(label) ? "B" : "A";
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
export function vorflugPrompt(kommandoReviewers, trackerId) {
  // Die zulaessigen Werte fuer "name" stehen zur Bauzeit des Prompts fest — das Modell
  // soll sie nicht aus dem Kommandostring ableiten muessen (Issue #409).
  const erlaubteNamen = kommandoReviewers.map((r) => JSON.stringify(String(r.name))).join(", ");
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
      ...kommandoReviewers.map((r) => String.raw`  printf '%s\n' '${VORFLUG_PROBE_PROMPT}' | ${r.command}   # Reviewer-Name fuer den Befund: ${r.name}`),
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
    // Der Name entscheidet, ob der Befund ankommt: Der Runner gleicht ueber den
    // Reviewer-Namen aus der Config ab. Wird stattdessen der Modellname aus der
    // Kommandozeile gemeldet, findet er keinen Treffer und traegt fuer einen
    // verfuegbaren Reviewer "nichts gemeldet" ein — der Lauf bricht ab, obwohl
    // nichts fehlt (Issue #409).
    ...(kommandoReviewers.length === 0
      ? []
      : [
        `"name" ist WOERTLICH der Reviewer-Name aus dem Kommentar "# Reviewer-Name fuer den Befund:"`,
        `am Ende der jeweiligen Zeile in Schritt 1 — gib dort AUF KEINEN FALL den Modellnamen aus der Kommandozeile zurueck.`,
        `Zulaessig sind genau diese Werte: ${erlaubteNamen}.`,
        ``,
      ]),
    `Gib als ALLERLETZTE Ausgabe genau diesen Block aus, ohne Code-Fence und ohne Text danach:`,
    ``,
    VORFLUG_START,
    `{"reviewers": [{"name": "<name>", "verfuegbar": true, "grund": ""}], "tracker": {"erreichbar": true, "geprueft": "<kommando>", "grund": ""}}`,
    VORFLUG_ENDE,
  );
  return zeilen.join("\n");
}

/** Schneidet den Befund-Block aus der Session-Ausgabe. null = nichts Auswertbares. */
export function parseVorflugBefund(stdout = "") {
  const text = stdout;
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
    (roh?.reviewers || []).filter((r) => r?.name).map((r) => [String(r.name), r]),
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
    // stream-json seit Issue #669: Nur so meldet die Vorflug-Session ihren Verbrauch, und
    // sie ist die Session ohne Karte, deren Mengen den Rest des Laufs ausmachen. Der
    // Befund-Block steht dann im Text des result-Ereignisses (siehe reviewerVorflug).
    cmdArgs = ["-p", prompt, "--model", VORFLUG_MODEL, "--output-format", "stream-json", "--verbose", ...permArgs];
  }
  const timeoutMs = process.env.NIGHT_VORFLUG_TIMEOUT_MS
    ? Number(process.env.NIGHT_VORFLUG_TIMEOUT_MS)
    : VORFLUG_TIMEOUT_MS;
  const gestartet = Date.now();
  const res = await runProcess(cmd, cmdArgs, {
    issueId: "vorflug", timeoutMs, useStream: false,
    extraEnv: { NIGHT_PROMPT: prompt, KIT_AGENT_MODEL: VORFLUG_MODEL, NIGHT_VORFLUG: "1" },
  });
  if (LOG_FILE) {
    appendFileSync(LOG_FILE, `--- Vorflug-Session ---\n${res.stdout || ""}${res.stderr || ""}\n`, "utf-8");
  }
  const kennzahlen = leseKennzahlen(res.stdout);
  verbrauchErfassen(null, kennzahlen);
  // issueId null: die Vorflug-Session gehoert zu keiner Karte, zeitenErfassen schreibt
  // darum nichts (derselbe Aufruf wie verbrauchErfassen, Issue #749).
  zeitenErfassen(null, Date.now() - gestartet, kennzahlen, res.werkzeugzeit);
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

  // Im Strom steht der Befund im Text des result-Ereignisses; ohne Strom (Test-Fakes, eine
  // CLI, die das Format ignoriert) ist stdout selbst der Text.
  const roh = parseVorflugBefund(leseErgebnisText(res.stdout) ?? res.stdout);
  if (!roh) {
    return gescheitert(res.status === 0
      ? "die Vorflug-Session endete ohne auswertbaren Befund-Block"
      : `die Vorflug-Session endete mit Exit ${res.status} und ohne auswertbaren Befund-Block`);
  }
  return { sessionStartbar: true, grund: null, ...normalisiereVorflug(roh, reviewers) };
}

// --- Kommentare einer Session (Issue #310) ---

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

// Vorflug-Warnung zum Routing-Label (Issue #179). Ein Vertipper im --label-Wert ist
// syntaktisch gueltig: --label no filtert auf ein Label namens "no", findet nichts,
// und der Lauf endet ohne Arbeit — im Protokoll nicht von einem abgearbeiteten Board
// zu unterscheiden. Die Warnung trennt die beiden Faelle.
//
// Bewusst nur eine Warnung, kein Stopp: Ein Lauf ohne passende Issues ist ein
// legitimer Zustand. Ein zusaetzlicher naechtlicher Abbruchgrund waere schlimmer als
// das Problem, das er meldet (dieselbe Abwaegung wie bei der Versions-Drift, #172).
//
// Der "einmal zeigen"-Zustand steht im Kontext statt in einer Closure: Beide
// Programme, die warnen koennen (Dry-Run und Implementierung), teilen sich denselben
// Kontext, und die Warnung soll je Lauf einmal erscheinen — nicht je Programm.
function warnWennLabelNirgendsVorkommt(ctx, ready) {
  if (ctx.labelWarnungGezeigt || ctx.labelFilter === null || ready.length === 0) return;
  if (ready.some(ctx.hasLabel)) return;
  ctx.labelWarnungGezeigt = true;
  const vorhanden = [...new Set(ready.flatMap((i) => i.labels || []))];
  log(`WARNUNG: kein Ready-Issue traegt das Label '${ctx.labelFilter}' — es wird nichts verarbeitet.`);
  log(`  In Ready vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
  log(`  Tippfehler im --label-Wert? Mit --label none laeuft der Nachtlauf ohne Label-Filter.`);
}

/** Laedt die Budgets der Kette; eine kaputte Zahl ist ein Config-Fehler, kein Lauf. */
function ketteBudgetLaden() {
  try {
    KETTE_BUDGET = ladeKetteBudget(config);
  } catch (e) {
    fail(e.message, "zustand");
  }
  KETTE_BUDGET_AUS_DEFAULT = ketteBudgetDefaults(config);
}

/**
 * Die Protokollzeile zu den Budgets aus den Defaults (Issue #659), `null` ohne solche.
 * Setzt `night.kette` kein einziges Feld, sagt die Zeile das dazu: Ob der Block fehlt oder
 * leer ist, macht fuer den Leser keinen Unterschied — beide Male gilt kein eigener Wert.
 */
function budgetDefaultsZeile(budget, ausDefault) {
  if (ausDefault.length === 0) return null;
  const werte = ausDefault.map((feld) => `${feld}=${budget[feld]}`).join(", ");
  const ganz = ausDefault.length === Object.keys(KETTE_BUDGET_DEFAULTS).length
    ? " — night.kette in .claude/workflow.config.json fehlt oder setzt kein Feld."
    : "";
  return `Budget der Kette aus den Defaults: ${werte}${ganz}`;
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
 * Vorflug). Home ueber homedir() wie in board.mjs (unter Windows USERPROFILE, #187).
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
  const meldung = `settings-Datei ungueltig — keine ihrer Einstellungen (env, sandbox, permissions) waere in den Nacht-Sessions wirksam: ${befunde.join(" | ")}`;
  if (args.dryRun) {
    log(`  WARNUNG: ${meldung}`);
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
  const einstellung = stufenEinstellung(config);
  if (!einstellung.aktiv) return;
  for (const stufe of STUFEN_ORDNUNG) {
    const eintrag = einstellung.stufen[stufe];
    if (!eintrag) continue;
    const { ok, grund } = stufeStartbar(eintrag, config.night?.modelle);
    if (!ok) log(`  WARNUNG: Stufe ${stufe} nicht startbar: ${grund}`);
  }
}

/** Die beiden Zustands-Vorfluege der Implementierung: kein Absturzrest, sauberer Baum. */
function zustandsVorflug() {
  const inProgress = board("issue", "list", "--status", "in_progress");
  if (inProgress.length > 0) {
    fail(`Issue(s) in In progress (${inProgress.map((i) => "#" + i.id).join(", ")}) — Crash-Rest? Bitte manuell aufraeumen, dann neu starten.`, "zustand");
  }
  if (!gitClean()) fail("Working Tree ist nicht sauber. Bitte committen oder aufraeumen, dann neu starten.", "zustand");
}

/**
 * Der gemeinsame Vorspann aller drei Programme: Phasen 2 bis 6 aus Issue #398.
 *
 * Config lesen, Logdatei festlegen, Label-Filter bilden, Versions-Drift melden,
 * Vorbedingungen pruefen. Liefert den Kontext, mit dem Dry-Run und Implementierung
 * arbeiten. Bricht bei verletzten Vorbedingungen selbst ab (`fail`) — das ist die
 * Stelle, an der ein Lauf gar nicht erst beginnen darf.
 */
export function vorbereiten(args) {
  if (!existsSync(BOARD_PATH)) fail(`board.mjs nicht gefunden unter ${BOARD_PATH}`);
  const configPath = join(process.cwd(), ".claude", "workflow.config.json");
  if (!existsSync(configPath)) fail("Keine .claude/workflow.config.json — bitte im Projekt-Root starten.");
  config = ladeConfigMitOverrides(configPath);
  CONFIG_PATH = configPath;
  if (args.kette) ketteBudgetLaden();

  const jetzt = new Date();
  mkdirSync(join(process.cwd(), ".claude"), { recursive: true });
  LOG_FILE = join(process.cwd(), ".claude", `night-run-${jetzt.toISOString().slice(0, 10)}.log`);

  // Routing-Label (Issue #159): nur Ready-Issues mit diesem Label werden verarbeitet,
  // alle anderen bleiben unangetastet liegen. --label none schaltet den Filter ab
  // (null = striktes ready[0], das Verhalten vor #159).
  const labelFilter = args.label === "none" ? null : args.label;
  const ctx = {
    labelFilter,
    hasLabel: (issue) => labelFilter === null || (issue.labels || []).includes(labelFilter),
    labelWarnungGezeigt: false,
  };

  const art = laufArt(args);
  const modus = ART_MODUS[art];
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

  log(`Nacht-Runner startet (Modus ${modus}, max ${args.max} Sessions, Modell ${args.model}, Label ${aktivesLabel}${dryRunAngabe}${yoloAngabe})`);
  if (args.yolo && !args.dryRun) {
    log("WARNUNG: --yolo umgeht ALLE Permission-Checks der Nacht-Sessions. Die Stop-Punkte haengen dann allein am Skill-Prompt.");
  }

  // Vorflug-Checks
  warnBeiVersionsDrift();
  // Die beiden Zustands-Vorfluege gelten der Implementierung: Sie arbeitet in der
  // Hauptkopie und darf nicht auf einem Absturzrest aufsetzen. Die Kette arbeitet in
  // einem eigenen Worktree und laeuft neben einer Umsetzungsnacht (Plan #638, A3): Ein
  // Paket in In progress ist fuer sie kein Absturzrest, ein unsauberer Baum kein Hindernis.
  if (!args.kette) zustandsVorflug();
  // In jeder Betriebsart, nach dem Baum (Issue #618): Eine ungueltige settings-Datei
  // traefe jede Session, ob sie baut oder plant.
  settingsVorflug(args);
  // Nachts ohne Gate zu implementieren ist riskant; ein Lauf, der nichts baut, hebt die
  // Pflicht ueber `noChecksOk` auf (so machen es die Folgepakete fuer die Kette).
  //
  // Gezaehlt wird die Paketstufe und nicht die Listenlaenge (Plan #753, E14): Eine
  // gefuellte Liste aus lauter Push-Pruefungen liefe hier sonst durch, obwohl die
  // Umsetzung eines Arbeitspakets damit kein einziges Gate haette — genau der
  // Zustand, den dieser Guard verhindern soll. Die Meldung nennt deshalb den Grund
  // und nicht nur "leer": Wer drei Eintraege in seiner Config sieht, sucht bei einem
  // blossen "ist leer" an der falschen Stelle.
  if (paketstufenChecks(config).length === 0 && !args.noChecksOk) {
    fail("buildChecks in workflow.config.json ist leer an der Paketstufe — keine Pruefung traegt die Stufe 'paket', und damit hat die Umsetzung nachts kein Gate. Eintraege mit stufe 'push' oder 'merge' laufen erst beim Veroeffentlichen. Override: --no-checks-ok", "zustand");
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
    log(`  Vorflug-Session nicht auswertbar: ${vorflug.grund}`);
  }
  for (const r of vorflug.reviewers) {
    const stand = r.verfuegbar ? "verfuegbar" : `NICHT verfuegbar — ${r.grund}`;
    log(`  Reviewer ${r.name} (${r.kind}) in ${r.umgebung}: ${stand}`);
  }
  // Gar kein Reviewer konfiguriert: eigener Text, weil die Abhilfe eine andere ist —
  // nicht "Werkzeug installieren", sondern "Block uebernehmen".
  const KEIN_REVIEWER = "issueReview.reviewers ist leer oder fehlt — Block aus .claude/workflow.config.example.json uebernehmen";
  if (reviewerListe.length === 0) log(`  Kein Reviewer konfiguriert: ${KEIN_REVIEWER}`);
  const getVermerk = vorflug.tracker.uebersprungen
    ? ` — issue get uebersprungen: ${vorflug.tracker.uebersprungen}`
    : "";
  const trackerStand = vorflug.tracker.erreichbar
    ? `erreichbar${getVermerk}`
    : `NICHT erreichbar — ${vorflug.tracker.grund}`;
  log(`  Tracker (${vorflug.tracker.umgebung}): ${trackerStand}`);

  // Drei getrennte Befunde, drei getrennte Meldungen.
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
  const reviewerListe = (config.issueReview?.reviewers || [])
    .filter((r) => r && typeof r.name === "string")
    .map((r) => ({ name: r.name, kind: r.kind === "command" ? "command" : "claude", command: r.command }));
  const trackerId = trackerProbeId(kandidaten, kandidaten.length > 0 ? null : board("issue", "list"));

  const probeAngabe = trackerId ? `Issue #${trackerId}` : "nur issue list";
  log(`  Vorflug-Session startet (Modell ${VORFLUG_MODEL}, Tracker-Probe ${probeAngabe}).`);
  const vorflug = await reviewerVorflug(args, reviewerListe, trackerId);

  // Eine Vorflug-Session darf so wenig am Repository anfassen wie eine Review-Session.
  // Tut sie es doch, ist die Lage unklar und der Lauf endet hier — dieselbe Leitplanke
  // wie nach einer Review-Session (Issue #152), und sie gilt auch im Dry-Run: Ein
  // veraenderter Working Tree ist kein Befund, sondern ein Unfall.
  const reste = gitReste();
  if (reste.length > 0) {
    const satz = "HARTER STOPP: die Vorflug-Session hat den Working Tree veraendert. Sie darf nichts anfassen — bitte morgens sichten.";
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
    fail(`${probleme.join(" | ")} — ein unterbesetzter Lauf sieht am Board aus wie ein vollstaendiger. Mit ${dryRunHinweis} pruefen, dann das fehlende Werkzeug installieren, die Freigaben der Sessions weiten oder den Reviewer aus issueReview.reviewers nehmen.`);
  }
}

// --- Die Nacht-Kette (Plan #638; Issue #643) ---
//
// Ein Fachplan geht abends hinein, morgens liegen Plan, Pakete und der Nachtbericht am
// Fachplan vor (#643 bis zum geprueften Plan, #644 Pakete und Abdeckung, #645 Bericht).

// Der Zusatz, der einer Kette-Session die Betriebsart nennt. Massgeblich bleibt allein
// KIT_AGENT_MODEL — der Satz wiederholt es nur an der Stelle, an der es ankommt.
const KETTE_ZUSATZ = "Dieser Lauf ist unbeaufsichtigt: Es sieht niemand zu, und es wird nicht gefragt. Schreibe dein Ergebnis ans Board, bevor die Session endet.";
// Der Anker des Halt-Kommentars am Fachplan.
export const KETTE_HALT_ANKER = "## Kette angehalten";
// Die Routing-Labels der beiden entfallenen Betriebsarten: Wer sie noch setzt, bekommt
// eine Zeile im Protokoll statt einer stillen Nacht (Fachplan #635, Kriterium 12).
const ALTE_ROUTING_LABELS = ["kit:nightreview", "kit:nightplan", "kit:nightissues"];
// Unter dieser Restzeit startet keine Session mehr: Eine Minute reicht fuer keinen Plan.
const KETTE_MINDEST_REST_MS = 60 * 1000;
// Die drei Ausgaenge einer Stufe und einer Kette (Fachplan #635, Kriterium 2).
const KETTE_AUSGAENGE = ["fertig", "angehalten", "abgebrochen"];
// Woran der Runner den Halt von /issues erkennt: der Kommentar, den der Skill
// unbeaufsichtigt an den Plan schreibt, wenn er kein Paket anlegt (skills-14).
export const ISSUES_HALT_KOPF = "Kein Eingang für /issues";

/**
 * Der Prompt der Abdeckungs-Session (Plan #638, A9): Sie liest Fachplan, Plan und Pakete,
 * aendert nichts und gibt als letzte Nachricht die Zuordnung zurueck. Ihr Text landet im
 * Ergebnisstand und im Bericht — kein eigener Kommentar, kein Tor (Kriterium 5).
 */
export const ABDECKUNG_PROMPT = [
  "Aendere dabei NICHTS: kein Kommentar, keine Karte, kein Label, keine Datei.",
  "",
  "Gib als letzte Nachricht genau diese drei Abschnitte aus, in Markdown:",
    "",
    "### Zuordnung",
    "Je fachlichem Akzeptanzkriterium des Fachplans eine Zeile: das Kriterium (Nummer und Anfang des Wortlauts) und das Paket oder die Pakete, in denen es abgebildet ist, oder \"kein Paket\".",
    "",
    "### Ohne Paket",
    "Jedes Kriterium, das in keinem Paket abgebildet ist, mit seinem Wortlaut. Sonst der Satz: Alle Kriterien sind abgebildet.",
    "",
  "### Zuwachs",
  "Was in den Paketen steht, ohne im Fachplan zu stehen — je Punkt das Paket und ein Satz. Sonst der Satz: Nichts Zusaetzliches.",
  "",
  KETTE_ZUSATZ,
].join("\n");

export function abdeckungPrompt(fachplanId, planId, paketIds) {
  const pakete = paketIds.map((id) => `#${id}`).join(", ");
  return `Du haeltst die Arbeitspakete gegen die fachliche Anforderung. Lies mit \`node .claude/kit/board.mjs issue get <nummer>\` den Fachplan #${fachplanId}, den Plan #${planId} und die Pakete ${pakete}.\n${ABDECKUNG_PROMPT}`;
}

/**
 * Der Grund, aus dem eine gekennzeichnete Karte nicht laeuft — `null`, wenn sie laeuft.
 *
 * Die Reihenfolge ist die Antwort: Erst das Praefix (das Kennzeichen gilt nur am
 * Fachplan), dann die Spalte (E4: ausserhalb von Backlog ist ein Versehen), dann
 * `kit:klaeren` (A2: die Antwort auf die Stopp-Frage muss vorher am Fachplan stehen),
 * zuletzt die fehlende Pruefung (Fachplan #702). Die Pruefung steht hinter
 * `kit:klaeren`, damit ein Fachplan mit offener Frage den spezifischeren Grund behaelt:
 * Wer die Frage beantwortet, kommt weiter, wer nur pruefen laesst, nicht.
 */
function kettenAusschluss(issue, kettenLabel) {
  if (!isFachlich(issue.title ?? "")) return "kein fachliches Issue ([Fachlich]) — das Kennzeichen gilt nur am Fachplan";
  if (issue.status !== "backlog") return `steht in ${issue.status ?? "unbekannt"}, nicht in Backlog`;
  if (hatKlaerenLabel(issue)) return `traegt ${KLAEREN_LABEL} — die Antwort auf die Stopp-Frage muss vorher am Fachplan stehen, dann das Label abnehmen`;
  if (!hatReviewFertigLabel(issue)) return pruefungFehltGrund(issue.id, kettenLabel).text;
  return null;
}

/**
 * Waehlt die Ketten einer Nacht aus allen Karten (Plan #638, A2, A13, E4, W5).
 *
 * Reine Funktion ueber `issue list` OHNE Status-Filter: Was das Label traegt, aber nicht
 * laufen darf, geht mit Grund in `uebersprungen` — im Ergebnisstand sichtbar, das Label
 * bleibt stehen. Kandidaten laufen in Listenreihenfolge; ab `max` bleiben sie liegen.
 */
export function waehleKettenKandidaten(issues, label, max) {
  const kandidaten = [];
  const uebersprungen = [];
  const liegengeblieben = [];
  for (const issue of issues || []) {
    if (!(issue?.labels || []).includes(label)) continue;
    const grund = kettenAusschluss(issue, label);
    if (grund !== null) {
      uebersprungen.push({ id: String(issue.id), title: issue.title ?? "", grund });
      continue;
    }
    if (kandidaten.length >= max) {
      liegengeblieben.push({ id: String(issue.id), title: issue.title ?? "" });
      continue;
    }
    kandidaten.push(issue);
  }
  return { kandidaten, uebersprungen, liegengeblieben };
}

/**
 * Der Prompt einer Korrektursession (Plan #638, A7): genau die Verstoesse, nichts sonst.
 */
export function korrekturPrompt(dokId, verstoesse) {
  const liste = (verstoesse || []).map((v) => {
    const gate = v.gate ? `${v.gate}: ` : "";
    return `- ${gate}${v.meldung ?? JSON.stringify(v)}`;
  }).join("\n");
  return [
    `Das Dokument #${dokId} hat die Formpruefung nicht bestanden (\`node .claude/kit/board.mjs issue check-form ${dokId}\`):`,
    liste,
    "",
    `Behebe genau diese Verstoesse im Body von #${dokId}. Lies den Body mit \`node .claude/kit/board.mjs issue get ${dokId}\`,`,
    "schreibe den vollstaendigen korrigierten Body stueckweise in eine Datei ausserhalb des Projektverzeichnisses",
    `und uebertrage ihn mit \`node .claude/kit/board.mjs issue update ${dokId} --body-file <pfad>\`.`,
    "Aendere sonst nichts: keinen Inhalt, keine anderen Karten, keine Dateien im Projekt.",
    "",
    KETTE_ZUSATZ,
  ].join("\n");
}

/** Der Text eines Abschnitts ohne Ueberschrift, fuer den Halt-Kommentar. */
function abschnittText(body, ueberschrift) {
  const abschnitt = abschnittLesen(body, ueberschrift);
  return abschnitt ? abschnitt.zeilen.join("\n").trim() : "";
}

/**
 * Beim lokalen Tracker liegt das Board als Dateien im Repo — im Worktree also als Kopie.
 * Eine Session dort schriebe Karten in den Worktree, und die Hauptkopie saehe nichts.
 * Deshalb zeigt die Config im Worktree auf das issues-Verzeichnis der Hauptkopie
 * (`board.mjs` loest den Pfad mit `resolve` auf, ein absoluter traegt). GitHub, GitLab
 * und Toolbox sind nicht betroffen: Ihr Board liegt nicht im Repo.
 */
function trackerImWorktreeUmleiten(wt, repoRoot) {
  if (config.issueTracker !== "local") return;
  const pfad = join(wt, ".claude", "workflow.config.json");
  if (!existsSync(pfad)) return;
  const wtConfig = JSON.parse(readFileSync(pfad, "utf-8"));
  wtConfig.local = { ...wtConfig.local, issuesDir: resolve(repoRoot, config.local?.issuesDir || "issues") };
  writeFileSync(pfad, JSON.stringify(wtConfig, null, 2) + "\n", "utf-8");
}

/**
 * Eine Session der Kette mit Zeit- und Kostenbudget (Plan #638, A5, A6).
 *
 * `stufeStart` und `budgetMs` beschreiben die Stufe: Jede Session bekommt als Timeout,
 * was von der Stufe noch uebrig ist — Korrekturrunden zaehlen gegen dieselbe Stufe.
 * Nach der Session werden die Kosten addiert und gegen das Kettenbudget gehalten; ein
 * Ueberschreiten endet NACH der Session, nicht mittendrin (ein halb geschriebenes
 * Dokument waere der teurere Fehler). Rueckgabe: `{ ausgang, grund, dauerMs, kennzahlen, res }`.
 */
async function ketteSession(kette, stufe, prompt, stufeStart, budgetMs) {
  const rest = budgetMs - (Date.now() - stufeStart);
  if (rest < KETTE_MINDEST_REST_MS) {
    return { ausgang: "abgebrochen", grund: `Zeitbudget ${stufe} erschoepft, bevor eine weitere Session starten konnte`, dauerMs: 0, kennzahlen: null };
  }
  const t = Date.now();
  const res = await runSession(kette.F, kette.args, {
    prompt: `${prompt}\n\n${KETTE_ZUSATZ}`, cwd: kette.wt, stream: true, stufe, timeoutMs: rest,
  });
  const dauerMs = Date.now() - t;
  const minuten = (dauerMs / 60000).toFixed(1);
  const kennzahlen = leseKennzahlen(res.stdout);
  kostenAddieren(kette.kosten, kennzahlen);
  if (LAUF) kostenAddieren(LAUF, kennzahlen);
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  if (timedOut) {
    return { ausgang: "abgebrochen", grund: `Zeitbudget ${stufe}: die Session wurde nach ${minuten} min am Limit beendet`, dauerMs, kennzahlen };
  }
  if (res.error || res.status !== 0) {
    const exitInfo = res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`;
    return { ausgang: "abgebrochen", grund: `technischer Fehler: die Session der Stufe ${stufe} endete mit ${exitInfo}`, dauerMs, kennzahlen };
  }
  // Das Kostenbudget wird hier nur gemerkt: Die Stufe verbucht erst, was die Session
  // hinterlassen hat (den Plan, die Korrektur), und bricht dann ab — sonst stuende ein
  // angelegter Plan nicht im Ergebnisstand.
  const deckel = kettenKostendeckel(kette);
  if (kette.kosten.kostenSumme > deckel && !kette.kostenGrund) {
    kette.kostenGrund = `Kostenbudget: ${kette.kosten.kostenSumme.toFixed(2)} $ von ${deckel} $ nach der Stufe ${stufe}`;
  }
  return { ausgang: "fertig", dauerMs, kennzahlen, res };
}

/**
 * Der Kostendeckel DIESER Kette (Plan #691): unter Variante B `kostenUsdB` an der Stelle
 * von `kostenUsd`.
 *
 * Der Deckel gilt der ganzen Kette und nicht nur der Umsetzungsstufe: Eine B-Kette, die
 * in der Plan-Stufe am Deckel einer A-Nacht abbraeche, erreichte die Umsetzung nie — und
 * der groessere Betrag stuende in der Config fuer eine Stufe, die dann nicht laeuft.
 */
function kettenKostendeckel(kette) {
  return kette.variante === "B" ? kette.budget.kostenUsdB : kette.budget.kostenUsd;
}

/** Der Abbruch wegen Kosten — `null`, solange das Budget reicht. */
function kostenErschoepft(kette) {
  return kette.kostenGrund ? { ausgang: "abgebrochen", grund: kette.kostenGrund } : null;
}

/**
 * Stufe Plan: /techplan, Formpruefung mit Korrekturrunden, Stopp-Frage (Plan #638, A7, A8, E2).
 */
async function stufePlan(kette) {
  const { F, budget } = kette;
  const stufeStart = Date.now();
  const budgetMs = budget.planMin * 60 * 1000;
  const stand = { id: null, dauerMs: 0, kennzahlen: null, korrekturrunden: 0, weitere: [] };
  kette.stufen.plan = stand;
  const summe = (s) => { stand.dauerMs += s.dauerMs; stand.kennzahlen = s.kennzahlen ?? stand.kennzahlen; };

  const vorher = new Set(board("issue", "list").map((i) => String(i.id)));
  log(`  Stufe plan: /techplan #${F} (Budget ${budget.planMin} min).`);
  const s = await ketteSession(kette, "plan", `/techplan #${F}`, stufeStart, budgetMs);
  summe(s);
  const notizen = notizenZurueck(kette.wt, kette.repoRoot);
  for (const n of notizen) log(`  Vorhaben-Notiz aus dem Worktree in die Hauptkopie geholt: .claude/${n}`);
  if (s.ausgang !== "fertig") return s;

  // Das Ergebnis ist die Herkunftszeile, nicht der Session-Text (E2): nur neue
  // [Plan]-Karten mit `Fachliche Quelle: Issue #F`; bei mehreren die hoechste Nummer.
  const neue = board("issue", "list")
    .filter((i) => !vorher.has(String(i.id)) && stammtAusErzeugung(i, F, "plan"))
    .sort((a, b) => Number(b.id) - Number(a.id));
  if (neue.length === 0) return { ausgang: "abgebrochen", grund: "kein Plan entstanden — die Session hat kein [Plan]-Dokument mit der Herkunftszeile angelegt" };
  stand.id = String(neue[0].id);
  stand.weitere = neue.slice(1).map((i) => String(i.id));
  const weitere = stand.weitere.length ? ` (weitere: ${stand.weitere.map((i) => "#" + i).join(", ")})` : "";
  log(`  Plan #${stand.id} entstanden aus Issue #${F}${weitere}.`);
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);

  const form = await formSicherstellen(kette, stand, stufeStart, budgetMs, summe);
  if (form !== null) return form;

  // Die Stopp-Frage steht im Plan (A8): `## Offene Fragen` ohne `- Keine.`.
  const body = board("issue", "get", stand.id).body;
  const grund = stoppFragenGrund(body);
  if (grund !== null) {
    return { ausgang: "angehalten", grund: `Stopp-Frage im Plan #${stand.id}`, dokId: stand.id, frage: abschnittText(body, OFFENE_FRAGEN_UEBERSCHRIFT) || grund };
  }
  return { ausgang: "fertig", id: stand.id };
}

/**
 * Formpruefung mit Korrekturrunden (Plan #638, A7) — `null`, wenn die Form gruen ist,
 * sonst der Ausgang der Stufe.
 *
 * Das Kommando sagt "fertig", nicht die Selbstauskunft der Session, obwohl der Skill
 * selbst prueft. Jede Korrekturrunde ist eine frische Session mit genau den Verstoessen;
 * ihre Zeit zaehlt gegen dieselbe Stufe.
 */
async function formSicherstellen(kette, stand, stufeStart, budgetMs, summe) {
  const { budget } = kette;
  for (;;) {
    const form = boardRoh("issue", "check-form", stand.id);
    if (!form.json) return { ausgang: "abgebrochen", grund: `technischer Fehler: check-form #${stand.id} lieferte kein JSON (${form.text.slice(0, 200)})` };
    if (form.json.ok) {
      log(`  Formpruefung #${stand.id} gruen.`);
      return null;
    }
    const verstoesse = (form.json.verstoesse || []).map((v) => `${v.gate}: ${v.meldung}`).join("; ");
    if (stand.korrekturrunden >= budget.korrekturrunden) {
      return { ausgang: "abgebrochen", grund: `Form nach ${stand.korrekturrunden} Korrekturrunde(n) weiterhin verletzt (#${stand.id}): ${verstoesse}` };
    }
    stand.korrekturrunden++;
    log(`  Formpruefung #${stand.id} rot (${verstoesse}) — Korrekturrunde ${stand.korrekturrunden} von ${budget.korrekturrunden}.`);
    const k = await ketteSession(kette, "form", korrekturPrompt(stand.id, form.json.verstoesse), stufeStart, budgetMs);
    summe(k);
    if (k.ausgang !== "fertig") return k;
    if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  }
}

/** Der Anker des Vermerks, den ein Abbruch der Review-Stufe am Plandokument hinterlaesst. */
export const REVIEW_REST_ANKER = "## Review unvollstaendig";

/**
 * Der Vermerk am Plan, wenn die Review-Stufe zwischen Befunden und Einarbeitung abbricht
 * (Issue #654).
 *
 * Die Einarbeitung steht am Ende der Stufe, hinter Reviewer-Laeufen und Befunde-Kommentar
 * — ein Abbruch trifft deshalb fast immer genau diese Luecke. Zurueck bleibt der teuerste
 * aller Zustaende: Die Pruefung ist bezahlt, ihre Befunde stehen am Board, der Body ist
 * unveraendert und traegt keinen Marker. Wer das Dokument spaeter sichtet, sieht ein
 * ungeprueftes und prueft erneut; genau so blieb Issue #316 einen Monat lang liegen.
 *
 * Ein groesseres Zeitbudget verschiebt die Grenze, es beseitigt sie nicht — eine Spur am
 * Dokument schon. Sie aendert den Ausgang nicht: Der Abbruch bleibt ein Abbruch mit
 * seinem Grund, die Spur ist Hinweis, kein Zustand.
 */
function reviewRestVermerken(kette, planId, grund) {
  const pfad = join(tmpdir(), `night-review-rest-${process.pid}-${planId}-${LAUF_STEMPEL ?? Date.now()}.md`);
  const text = [
    REVIEW_REST_ANKER,
    "",
    `Kette ${LAUF_STEMPEL ?? "ohne Stempel"}, Stufe review: Die Pruefung ist gelaufen, ihre Befunde stehen als Kommentar an diesem Dokument.`,
    "",
    `Die Einarbeitung fehlt — der Lauf endete davor (${grund}) —, und der Body ist deshalb unveraendert: Er traegt keinen Plan-Review-Marker, obwohl geprueft wurde.`,
    "",
    `Weg nach vorn: /issue-review #${planId} von Hand fahren.`,
    "",
  ].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    board("issue", "comment", planId, "--text-file", pfad);
    log(`  Review #${planId} abgebrochen, Befunde ohne Einarbeitung — Vermerk '${REVIEW_REST_ANKER}' an Plan #${planId} geschrieben.`);
  } finally {
    rmSync(pfad, { force: true });
  }
}

/**
 * Stufe Review: /issue-review am Plan, Halt an kit:klaeren (Plan #638, A8, A16).
 */
async function stufeReview(kette, planId) {
  const { budget } = kette;
  const stand = { dauerMs: 0, kennzahlen: null, marker: false };
  kette.stufen.review = stand;
  const vorher = board("issue", "get", planId);
  log(`  Stufe review: /issue-review #${planId} (Budget ${budget.reviewMin} min).`);
  const s = await ketteSession(kette, "review", `/issue-review #${planId}`, Date.now(), budget.reviewMin * 60 * 1000);
  stand.dauerMs = s.dauerMs;
  stand.kennzahlen = s.kennzahlen;
  if (s.ausgang !== "fertig") {
    // Auch beim Abbruch wird nachgesehen, was in der bezahlten Zeit entstanden ist.
    const rest = board("issue", "get", planId);
    stand.marker = /^\s*Plan-Review:\s*\S/m.test(rest.body || "");
    if (!stand.marker && neueKommentare(vorher, rest).length > 0) reviewRestVermerken(kette, planId, s.grund);
    return s;
  }
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  const nachher = board("issue", "get", planId);
  stand.marker = /^\s*Plan-Review:\s*\S/m.test(nachher.body || "");
  if (hatKlaerenLabel(nachher)) {
    const neue = neueKommentare(vorher, nachher);
    return { ausgang: "angehalten", grund: `Stopp-Frage aus dem Review von #${planId}`, dokId: planId, frage: neue.at(-1) ?? `siehe den letzten Kommentar an #${planId}` };
  }
  log(`  Review #${planId} durch${stand.marker ? ", Marker gesetzt" : ""}.`);
  return { ausgang: "fertig" };
}

/**
 * Stufe Pakete: /issues am Plan, Formpruefung je Paket, Halt am Kommentar (Plan #638, A7, E2).
 *
 * Ergebnis sind nur Karten mit `Plan: Issue #M` (E2); andere neue Karten stehen als
 * `nichtZuordenbar` in der Einheit. Kein Paket und ein Kommentar `Kein Eingang für
 * /issues` am Plan heisst angehalten; kein Paket ohne den Kommentar heisst abgebrochen.
 */
async function stufePakete(kette, planId) {
  const { budget } = kette;
  const stufeStart = Date.now();
  const budgetMs = budget.paketeMin * 60 * 1000;
  const stand = { ids: [], nichtZuordenbar: [], dauerMs: 0, kennzahlen: null, korrekturrunden: 0 };
  kette.stufen.pakete = stand;
  const summe = (s) => { stand.dauerMs += s.dauerMs; stand.kennzahlen = s.kennzahlen ?? stand.kennzahlen; };

  const vorherIds = new Set(board("issue", "list").map((i) => String(i.id)));
  const vorherPlan = board("issue", "get", planId);
  log(`  Stufe pakete: /issues #${planId} (Budget ${budget.paketeMin} min).`);
  const s = await ketteSession(kette, "pakete", `/issues #${planId}`, stufeStart, budgetMs);
  summe(s);
  if (s.ausgang !== "fertig") return s;

  const neue = board("issue", "list").filter((i) => !vorherIds.has(String(i.id)));
  const pakete = neue.filter((i) => stammtAusErzeugung(i, planId, "issue"));
  stand.ids = pakete.map((i) => String(i.id));
  stand.nichtZuordenbar = neue.filter((i) => !stammtAusErzeugung(i, planId, "issue")).map((i) => String(i.id));
  if (stand.nichtZuordenbar.length > 0) {
    log(`  Neue Karten ohne Herkunftszeile 'Plan: Issue #${planId}', nicht zuordenbar: ${stand.nichtZuordenbar.map((i) => "#" + i).join(", ")}.`);
  }
  if (pakete.length === 0) {
    const nachherPlan = board("issue", "get", planId);
    const halt = neueKommentare(vorherPlan, nachherPlan).find((k) => String(k).startsWith(ISSUES_HALT_KOPF));
    if (halt) {
      return { ausgang: "angehalten", grund: `Stopp-Frage beim Schneiden von #${planId}`, dokId: planId, frage: halt };
    }
    return { ausgang: "abgebrochen", grund: `kein Paket entstanden — die Session hat keine Karte mit 'Plan: Issue #${planId}' angelegt` };
  }
  log(`  Pakete aus Plan #${planId}: ${stand.ids.map((i) => "#" + i).join(", ")}.`);
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);

  // Formpruefung je Paket, mit demselben Korrekturbudget je Dokument wie beim Plan.
  for (const id of stand.ids) {
    const paketStand = { id, korrekturrunden: 0 };
    const form = await formSicherstellen(kette, paketStand, stufeStart, budgetMs, summe);
    stand.korrekturrunden += paketStand.korrekturrunden;
    if (form !== null) return form;
  }
  return { ausgang: "fertig", ids: stand.ids };
}

/**
 * Stufe Abdeckung: eine lesende Session haelt die Pakete gegen den Fachplan (Plan #638, A9).
 *
 * Ihr Text kommt aus dem `result`-Ereignis. Zeitbudget, Fehlstart oder fehlender Text
 * lassen die Kette trotzdem `fertig` enden — die Abdeckung ist eine Auskunft, kein Tor
 * (Kriterium 5); der Grund steht an der Stufe. Nur das Kostenbudget bricht ab.
 */
async function stufeAbdeckung(kette, fachplanId, planId, paketIds) {
  const { budget } = kette;
  const stand = { dauerMs: 0, kennzahlen: null, text: null };
  kette.stufen.abdeckung = stand;
  const vorherKarten = board("issue", "list").length;
  const vorherFachplan = board("issue", "get", fachplanId);
  log(`  Stufe abdeckung: Pakete gegen Fachplan #${fachplanId} (Budget ${budget.abdeckungMin} min).`);
  const s = await ketteSession(kette, "abdeckung", abdeckungPrompt(fachplanId, planId, paketIds), Date.now(), budget.abdeckungMin * 60 * 1000);
  stand.dauerMs = s.dauerMs;
  stand.kennzahlen = s.kennzahlen;
  if (s.ausgang !== "fertig") {
    stand.grund = s.grund;
    log(`  Abdeckung ohne Text: ${s.grund}.`);
    return { ausgang: "fertig" };
  }
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  stand.text = leseErgebnisText(s.res.stdout);
  if (stand.text === null) {
    stand.grund = "die Abdeckungs-Session lieferte keinen Text";
    log(`  Abdeckung ohne Text: ${stand.grund}.`);
  }
  // Der Prompt verbietet Schreiben; ein Verstoss ist ein Befund fuer den Morgen, kein
  // Grund, die Pakete zu verwerfen.
  const nachherKarten = board("issue", "list").length;
  const nachherFachplan = board("issue", "get", fachplanId);
  if (nachherKarten !== vorherKarten || neueKommentare(vorherFachplan, nachherFachplan).length > 0) {
    kette.abdeckungSchrieb = true;
    log("  Hinweis: die Abdeckungs-Session hat am Board geschrieben, obwohl sie nur lesen soll — steht im Ergebnisstand.");
  }
  return { ausgang: "fertig" };
}

// --- Stufe Umsetzung, nur unter Variante B (Plan #691, E4-E8, E11, E14, E16-E18) ---

/** Der Kommentar an einem selbst gezogenen Paket, das nicht in In review endet (E7). */
const UMSETZUNG_RUECKSTELLUNG = "Nacht-Kette, Variante B: Der Runner hatte dieses Paket fuer die Umsetzungsstufe "
  + "selbst nach Ready gezogen; die Runde endete nicht in In review. Es geht zurueck nach Backlog — ein Paket in "
  + "Ready waere fuer die naechste Nacht und fuer /implement-ready ein GO, das niemand gegeben hat.";

/** Der Grund, mit dem ein bereits von der Session zurueckgelegtes Paket im Bericht steht. */
const UMSETZUNG_SCHON_ZURUECK = "die Runde endete ohne In-review-Ergebnis; die Session hatte das Paket selbst zurueckgelegt";

/**
 * Bucht die Kosten der eben gelaufenen Runde auf die Kette.
 *
 * Die Kennzahlen stehen in der Einheit, die `laufeRunde` ohnehin anlegt — der
 * Session-Strom wird kein zweites Mal gelesen, und `laufeRunde` bleibt unveraendert (E8).
 * Ohne Ergebnisstand zaehlt die Runde als nicht gemessen, wie jede Session ohne Kennzahl.
 */
function rundeVerbuchen(kette, id) {
  const einheit = LAUF?.einheiten.findLast((e) => e.id === String(id));
  kostenAddieren(kette.kosten, einheit?.kennzahlen);
}

/**
 * Der Endstand jedes selbst gezogenen Pakets — die Rueckstellpflicht aus E7.
 *
 * Genau eine Stelle entscheidet, in welche Liste ein gezogenes Paket faellt, und sie
 * fragt dafuer das Board, nicht den Rueckgabewert der Runde: Sie laeuft auch nach einem
 * Wurf und nach einem harten Stopp, wo es keinen Rueckgabewert gibt.
 *
 * Was in Backlog liegt, bleibt liegen — ein angehaltenes Paket hat die Session selbst
 * dorthin geschoben und kommentiert, ein zweiter Kommentar waere die zweite Wahrheit
 * ueber denselben Vorgang. Pakete, die der Runner nicht gezogen hat, sind hier nie
 * dabei. `boardRoh` statt `board`: Ein toter Tracker darf diesen Aufraeumschritt nicht
 * in einen Prozessabbruch verwandeln, der den eigentlichen Fehler verschluckt.
 *
 * Ein umgesetztes Paket traegt zusaetzlich `stufe`, `stufeVerwendet` und `modell` —
 * dieselben Werte, die `laufeRunde` in der Paket-Einheit ablegt (Issue #713). Die
 * Paket-Einheit steht in `LAUF.einheiten`; ohne sie (Dry-Run, toter Ergebnisstand)
 * tragen alle drei `null`.
 */
function paketeAbschliessen(stand, gezogen) {
  for (const id of gezogen) {
    const status = leseKarte(id)?.status ?? null;
    if (status === "in_review") {
      const einheit = LAUF?.einheiten.findLast((e) => e.id === String(id));
      stand.umgesetzt.push({
        id, stufe: einheit?.stufe ?? null, stufeVerwendet: einheit?.stufeVerwendet ?? null, modell: einheit?.modell ?? null,
      });
      continue;
    }
    if (stand.angehalten.includes(id)) continue;
    if (status === "backlog") {
      stand.zurueckgestellt.push({ id, grund: UMSETZUNG_SCHON_ZURUECK });
      continue;
    }
    stand.zurueckgestellt.push({ id, grund: `die Runde endete in ${status ?? "unbekanntem Zustand"} statt in In review` });
    boardRoh("issue", "comment", id, "--text", UMSETZUNG_RUECKSTELLUNG);
    const move = boardRoh("issue", "move", id, "backlog");
    log(move.status === 0
      ? `  Paket #${id} nach Backlog zurueckgestellt — es steht nicht in In review.`
      : `  Paket #${id} liess sich nicht zurueckstellen (${move.text.slice(0, 200)}) — bitte morgens sichten.`);
  }
}

/** Fuehrt Pakete als nicht begonnen mit ihrem Grund — im Bericht und im Protokoll. */
function paketeNichtBegonnen(stand, ids, grund) {
  for (const id of ids) {
    stand.nichtBegonnen.push({ id: String(id), grund });
    log(`  Paket #${id} nicht begonnen: ${grund}.`);
  }
}

/**
 * Der Grund, aus dem vor dem naechsten Paket keine Session mehr startet — `null`,
 * solange beide Budgets reichen.
 *
 * Die Mindestrestzeit ist dieselbe wie bei den erzeugenden Stufen: Was darunter liegt,
 * reicht fuer kein Arbeitspaket, und eine Session, die sofort ins Limit laeuft, kostet
 * nur. Der Kostendeckel ist unter Variante B `kostenUsdB`.
 */
function umsetzungBudgetGrund(kette, lauf) {
  const restMs = lauf.budgetMs - (Date.now() - lauf.stufeStart);
  if (restMs < KETTE_MINDEST_REST_MS) {
    return `Zeitbudget umsetzung (${kette.budget.umsetzungMin} min) erschoepft, bevor eine weitere Session starten konnte`;
  }
  const deckel = kettenKostendeckel(kette);
  if (kette.kosten.kostenSumme > deckel) {
    return `Kostenbudget: ${kette.kosten.kostenSumme.toFixed(2)} $ von ${deckel} $ erschoepft`;
  }
  return null;
}

/**
 * Ein Paket der Stufe umsetzung: pruefen, ziehen, Runde fahren, verbuchen.
 *
 * Rueckgabe ist `null`, solange die Stufe weiterlaufen kann — sonst der Grund ihres
 * Abbruchs. Das Paket wird erst UNMITTELBAR vor seiner Session gezogen (E5), und die
 * Gates laufen VOR dem Zug (E6): Ein angehaltenes oder gescheitertes Paket steht in
 * Backlog, damit ist jede `Issue #N`-Referenz auf es unerfuellt und die abhaengigen
 * fallen hier von selbst heraus. Bei `issueReview.requiredBeforeReady` faellt so jedes
 * Paket heraus und die Kette auf Variante A zurueck (E18).
 */
async function umsetzePaket(kette, id, lauf, zaehler) {
  const karte = leseKarte(id);
  if (!karte) {
    paketeNichtBegonnen(lauf.stand, [id], "die Karte war am Board nicht lesbar");
    return null;
  }
  const gate = pruefeIssueGates(karte);
  if (gate) {
    paketeNichtBegonnen(lauf.stand, [id], gate.kommentar.replace(/^Nachtlauf:\s*/, ""));
    return null;
  }

  board("issue", "move", id, "ready");
  lauf.gezogen.add(id);
  log(`  Paket #${id} nach Ready gezogen — Session ${zaehler} der Stufe umsetzung.`);
  // Test-Hook wie NIGHT_MELDEN_ERZWINGEN: Von aussen laesst sich hier sonst keine
  // Ausnahme ausloesen, und der Wurf-Pfad der Rueckstellpflicht bliebe ungeprueft —
  // genau der Pfad, der ein Paket in Ready zuruecklassen wuerde.
  if (process.env.NIGHT_KETTE_WURF === id) throw new Error(`Test-Hook NIGHT_KETTE_WURF bei Paket #${id}`);

  const ausgang = await laufeRunde({ id, title: karte.title, labels: karte.labels }, kette.args, lauf.salvageAttempted, lauf.pruefungen);
  rundeVerbuchen(kette, id);
  if (ausgang === "angehalten") lauf.stand.angehalten.push(id);
  return ausgang === "hardStop" ? `Stufe umsetzung: harter Stopp in der Runde zu Paket #${id}` : null;
}

/** Die Pakete der Reihe nach (E16), bis eines hart stoppt oder ein Budget endet. */
async function umsetzungSchleife(kette, paketIds, lauf) {
  for (let i = 0; i < paketIds.length; i++) {
    const budgetGrund = umsetzungBudgetGrund(kette, lauf);
    if (budgetGrund) {
      paketeNichtBegonnen(lauf.stand, paketIds.slice(i), budgetGrund);
      break;
    }
    const stopp = await umsetzePaket(kette, String(paketIds[i]), lauf, `${i + 1}/${paketIds.length}`);
    if (stopp) {
      paketeNichtBegonnen(lauf.stand, paketIds.slice(i + 1), "der Lauf ist an einem frueheren Paket hart gestoppt");
      return { ausgang: "abgebrochen", grund: stopp };
    }
  }
  return { ausgang: "fertig" };
}

/**
 * Stufe Umsetzung: die Pakete des gekennzeichneten Fachplans in derselben Nacht bauen.
 *
 * Sie baut zuerst den Worktree ab und arbeitet in der Hauptkopie (E4) — seine Commits
 * traegen kein Ref und waeren am Morgen verloren. Die Pakete kommen aus
 * `kette.stufen.pakete.ids` (E16); gewertet wird mit `laufeRunde` unveraendert (E8), und
 * die Session erfaehrt von der Variante nichts — sie sieht ein regulaeres Ready-Paket (E11).
 *
 * Ausgaenge: `fertig` auch bei erschoepftem Zeit- oder Kostenbudget (E14, die uebrigen
 * Pakete stehen als nicht begonnen im Bericht) und bei einem gehaltenen Umsetzungs-Lock
 * (Issue #696, der Rueckfall auf Variante A), `angehalten` bei mindestens einem
 * angehaltenen Paket — aber ohne `haltAmFachplan` (E17) —, `abgebrochen` nur beim harten
 * Stopp und bei einer unsauberen Hauptkopie vor dem ersten Paket.
 */
async function stufeUmsetzung(kette, paketIds) {
  const { budget } = kette;
  const stufeStart = Date.now();
  const stand = { umgesetzt: [], angehalten: [], zurueckgestellt: [], nichtBegonnen: [], dauerMs: 0 };
  kette.stufen.umsetzung = stand;
  const lauf = {
    stand, gezogen: new Set(), salvageAttempted: new Set(), pruefungen: [],
    stufeStart, budgetMs: budget.umsetzungMin * 60 * 1000,
  };

  // Der Lock steht vor allem anderen — auch vor dem Worktree-Abbau und vor dem
  // Sauberkeits-Guard. Haelt ihn ein lebender Lauf, verhaelt sich die Kette wie eine unter
  // Variante A und laesst den Worktree bis zu ihrem eigenen Ende stehen. Und eine
  // Hauptkopie, in der gerade ein anderer Lauf baut, ist erwartbar unsauber: Der Lock ist
  // dafuer die genauere Auskunft als "nicht sauber" und der freundlichere Ausgang.
  const lock = umsetzungLockNehmen(kette.repoRoot);
  if (!lock.ok) {
    paketeNichtBegonnen(stand, paketIds, lock.grund);
    stand.dauerMs = Date.now() - stufeStart;
    log(`  Stufe umsetzung ausgelassen: ${lock.grund} — Rueckfall auf Variante A, die Pakete bleiben in Backlog.`);
    return { ausgang: "fertig" };
  }
  if (lock.hinweis) log(`  ${lock.hinweis}`);

  try {
    if (kette.wt) {
      worktreeEntfernen(kette.wt, kette.repoRoot);
      kette.wt = null;
      log(`  Worktree abgebaut — die Stufe umsetzung baut in der Hauptkopie ${kette.repoRoot}.`);
    }
    log(`  Stufe umsetzung: ${paketIds.length} Paket(e) (Budget ${budget.umsetzungMin} min, Kostendeckel ${kettenKostendeckel(kette)} $).`);

    // Einmal vor dem ersten Paket: Was die Sessions selbst hinterlassen, pruefen danach
    // Rest-Guard und Dirty-Guard in `werteRunde`.
    if (!gitClean(kette.repoRoot)) {
      const grund = `die Hauptkopie ist vor dem ersten Paket nicht sauber (${resteText(gitReste(kette.repoRoot))})`;
      paketeNichtBegonnen(stand, paketIds, grund);
      stand.dauerMs = Date.now() - stufeStart;
      return { ausgang: "abgebrochen", grund: `Stufe umsetzung: ${grund}` };
    }

    let ergebnis = { ausgang: "fertig" };
    try {
      ergebnis = await umsetzungSchleife(kette, paketIds, lauf);
    } finally {
      // Auch nach einem Wurf: Die Rueckstellpflicht ist der Grund fuer dieses finally.
      paketeAbschliessen(stand, lauf.gezogen);
      stand.dauerMs = Date.now() - stufeStart;
      for (const zeile of pruefBericht(lauf.pruefungen)) log(`  ${zeile}`);
    }
    if (ergebnis.ausgang === "fertig" && stand.angehalten.length > 0) {
      // Das kit:klaeren traegt bereits das Paket; ein zweites am Fachplan schloesse ihn aus
      // `waehleKettenKandidaten` aus und blockierte die naechste Kette (E17).
      return {
        ausgang: "angehalten",
        grund: `Stufe umsetzung: ${stand.angehalten.map((id) => "#" + id).join(", ")} haelt an einer Stopp-Frage`,
        ohneHaltAmFachplan: true,
      };
    }
    return ergebnis;
  } finally {
    // Auch nach einem Wurf aus der Stufe heraus: Ein liegengebliebener Lock haelt die
    // naechste Nacht ab, bis sein Prozess als tot erkannt wird.
    lock.freigeben();
  }
}

/** Der Grund, der im Bericht hinter einem nicht bestaetigten Ueberholt-Kommentar steht. */
export const UEBERHOLT_UNBESTAETIGT_GRUND = "der Kommentar wurde geschrieben, war danach aber an der Karte nicht auffindbar";

/**
 * Aeltere Plandokumente zum selben Fachplan sind mit dem neuen Plan ueberholt (Plan
 * #638, A8): ein Kommentar je Karte, kein Label, kein Move.
 *
 * Jeder Kommentar wird danach einmal zurueckgelesen (Issue #653). Ein erfolgreicher
 * POST ist kein Beweis, dass der Kommentar am Board steht — am 2026-09-14 fehlte er an
 * Plan #577, obwohl der Bericht ihn auswies. Ein Bericht, der eine Handlung behauptet,
 * die niemand sieht, ist schlimmer als keiner: Wer ihn liest, sieht nicht nach.
 *
 * Nicht bestaetigt heisst getrennt ausweisen, nicht abbrechen: Der Kommentar ist
 * Hinweis, kein Gate. Rueckgabe sind beide Listen — die Funktion setzt nichts an
 * `kette`, sie wird an genau einer Stelle gerufen.
 */
function aeltereUeberholen(kette, aeltere, neuerPlan) {
  const ueberholt = [];
  const ueberholtUnbestaetigt = [];
  for (const id of aeltere) {
    // Der Anker steht am Zeilenanfang des geschriebenen Textes und traegt den
    // Kettenstempel nicht — er bleibt ueber Laeufe hinweg wiedererkennbar.
    const anker = `Ueberholt durch Plan #${neuerPlan}`;
    board("issue", "comment", id, "--text", `${anker} (Kette ${LAUF_STEMPEL ?? "ohne Stempel"}). Die naechste Kette begann von vorn; dieser Entwurf bleibt nur als Verlauf.`);
    if (kommentareVon(board("issue", "get", id)).some((k) => k.includes(anker))) {
      ueberholt.push(id);
      log(`  Plan #${id} als ueberholt kommentiert (neuer Plan #${neuerPlan}).`);
    } else {
      ueberholtUnbestaetigt.push({ id, grund: UEBERHOLT_UNBESTAETIGT_GRUND });
      log(`  Plan #${id}: der Ueberholt-Kommentar ist am Board nicht auffindbar — im Bericht als nicht bestaetigt gefuehrt.`);
    }
  }
  return { ueberholt, ueberholtUnbestaetigt };
}

/**
 * Der Halt der Kette (Plan #638, A8): die eine Frage als Kommentar am Fachplan und
 * kit:klaeren dort. Der Plan bleibt als Entwurf stehen; die naechste Kette beginnt von
 * vorn. Das Label abnehmen darf nur der Mensch — dieselbe Regel wie im Implementierungslauf.
 */
function haltAmFachplan(kette, ergebnis) {
  const pfad = join(tmpdir(), `night-halt-${process.pid}-${kette.F}-${LAUF_STEMPEL ?? Date.now()}.md`);
  const text = [
    KETTE_HALT_ANKER,
    "",
    `Kette ${LAUF_STEMPEL ?? "ohne Stempel"}, Stufe ${ergebnis.stufe}, Dokument #${ergebnis.dokId}: ${ergebnis.grund}.`,
    "",
    ergebnis.frage,
    "",
    `Plan und bis dahin geschnittene Pakete bleiben als Entwurf stehen. Antwort bitte in den Fachplan schreiben, ${KLAEREN_LABEL} abnehmen und das Label ${kette.budget.label} neu setzen — die naechste Kette beginnt von vorn.`,
    "",
  ].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    board("issue", "comment", kette.F, "--text-file", pfad);
    board("issue", "label", "add", kette.F, KLAEREN_LABEL);
  } finally {
    rmSync(pfad, { force: true });
  }
}

// --- Der Nachtbericht am Fachplan (Plan #638, A10, A11; Issue #645) ---
//
// Der Mensch liest morgens am Fachplan, was die Nacht entschieden hat — bei jedem
// Ausgang. Der Bericht ist Verlauf, kein Vertrag: Verbindlich wird eine Entscheidung
// erst als Satz im Fachplan. Kann der Tracker ihn nicht annehmen, wartet er als Datei in
// der Hauptkopie und geht beim naechsten Start jeder Betriebsart nach.

export const BERICHT_ANKER = "## Nachtbericht, Kette";
export const BERICHT_SCHLUSS = "Dieser Bericht ist Verlauf. Verbindlich fuer die naechste Kette wird eine Entscheidung erst als Satz im Fachplan.";
const BERICHT_DATEI_PRAEFIX = "night-bericht-";
const ENTSCHEIDUNGEN_UEBERSCHRIFT = /^ {0,3}##\s*Architektonische\s+Entscheidungen\s*$/i;
const KONTEXT_UEBERSCHRIFT = /^ {0,3}##\s*Kontext\s*$/i;
const ENTSCHEIDUNGEN_KOMMENTAR_UEBERSCHRIFT = /^ {0,3}###\s*Entscheidungen\s*$/i;
const EINARBEITUNG_KOPF = /^## Einarbeitung, Runde \d+/;

function minutenText(ms) {
  return ((ms ?? 0) / 60000).toFixed(1);
}

/**
 * Alle Kommentare einer Karte, aelteste zuerst — dieselbe Zweiteilung wie in
 * `neueKommentare`: GitHub, GitLab und Toolbox liefern ein Array, der lokale Tracker
 * haengt sie an den Body.
 */
export function kommentareVon(issue) {
  if (Array.isArray(issue?.comments)) return issue.comments.map((k) => String(k?.body ?? ""));
  return String(issue?.body || "").split(LOKALER_KOMMENTARKOPF).slice(1).map((k) => k.trim()).filter(Boolean);
}

/** Der Kommentar `## Einarbeitung, Runde N` am Plan — bei mehreren der letzte; null ohne. */
export function einarbeitungVon(plan) {
  const treffer = kommentareVon(plan).filter((k) => EINARBEITUNG_KOPF.test(k));
  return treffer.length > 0 ? treffer.at(-1) : null;
}

/** Die Aufzaehlungspunkte erster Ebene eines Abschnitts, ausserhalb von Codebloecken, ohne `- Keine.`. */
function punkteErsterEbene(body, ueberschrift) {
  const abschnitt = abschnittLesen(body, ueberschrift);
  if (!abschnitt) return [];
  return abschnitt.zeilen
    .filter((z, i) => abschnitt.ausserhalb[i] && /^[-*+]\s+\S/.test(z))
    .map((z) => z.replace(/^[-*+]\s+/, "").trim())
    .filter((z) => !/^keine\.?$/i.test(z));
}

/** Die `Entscheidung:`-Zeilen aus `## Kontext` eines Pakets. */
function entscheidungsZeilen(body) {
  const abschnitt = abschnittLesen(body, KONTEXT_UEBERSCHRIFT);
  if (!abschnitt) return [];
  return abschnitt.zeilen.filter((z, i) => abschnitt.ausserhalb[i] && /^\s*Entscheidung:/.test(z)).map((z) => z.trim());
}

/**
 * Die Aufzaehlungspunkte aus `### Entscheidungen` in den Kommentaren eines Pakets —
 * Format des Abschlussberichts (`skills/implement-ready/SKILL.md`, Issue #697). Ein
 * Paket ohne diesen Block und eines ganz ohne Kommentare liefern beide `[]`, kein Wurf.
 */
function entscheidungenAusKommentaren(paket) {
  const eintraege = [];
  for (const kommentar of kommentareVon(paket)) eintraege.push(...punkteErsterEbene(kommentar, ENTSCHEIDUNGEN_KOMMENTAR_UEBERSCHRIFT));
  return eintraege;
}

/** `#<id> <Titel>` fuer den Bericht — nur `#<id>`, wenn die Karte ihren Titel nicht mitbringt. */
function paketBezeichnung(pakete, id) {
  const titel = pakete.find((k) => String(k.id) === String(id))?.title;
  return titel ? `#${id} ${titel}` : `#${id}`;
}

/**
 * Der Abschnitt `### Umsetzung`, ausschliesslich unter Variante B (Issue #697): die drei
 * Listen umgesetzt / angehalten / nicht begonnen, jede mit `keine` statt Weglassen. Die
 * Rueckstellungen (`zurueckgestellt` — gezogen, aber ohne In-review-Ergebnis) zaehlen im
 * Bericht zu "nicht begonnen": Kriterium 4 des Fachplans #681 nennt genau drei Zustaende,
 * und fuer den Menschen zaehlt an dieser Stelle nur, ob ein Paket in Review liegt.
 */
function berichtUmsetzungMitGrund(pakete, id, grund) {
  const bezeichnung = paketBezeichnung(pakete, id);
  return `${bezeichnung} (${grund})`;
}

/**
 * Stufe und Modell hinter einem umgesetzten Paket, als Klammerzusatz (Issue #713).
 *
 * Ein Eintrag ohne `stufe` — auch ein reiner Id-String aus einem Ergebnisstand vor
 * dieser Aenderung, dem die neuen Felder ganz fehlen — erscheint als "ohne Stufe"; die
 * Funktion wirft dafuer nie. Wich der Lauf auf eine hoehere Stufe aus, stehen beide
 * Stufen da, wie in `rundenHinweis`.
 */
function berichtUmsetzungStufe(eintrag) {
  const stufe = eintrag && typeof eintrag === "object" ? eintrag.stufe : null;
  if (!stufe) return "ohne Stufe";
  const { stufeVerwendet, modell } = eintrag;
  const stufeText = stufeVerwendet && stufeVerwendet !== stufe
    ? `Aufgabenstufe ${stufe}, ueber Stufe ${stufeVerwendet}`
    : `Aufgabenstufe ${stufe}`;
  return modell ? `${stufeText}, Modell ${modell}` : stufeText;
}

function berichtUmsetzungEintrag(pakete, eintrag) {
  const id = eintrag && typeof eintrag === "object" ? eintrag.id : eintrag;
  return `${paketBezeichnung(pakete, id)} (${berichtUmsetzungStufe(eintrag)})`;
}

function berichtUmsetzung(einheit, pakete) {
  const stand = einheit.stufen?.umsetzung ?? {};
  const liste = (ids) => (ids.length > 0 ? `${ids.map((id) => paketBezeichnung(pakete, id)).join(", ")}.` : "keine");
  const umgesetzt = stand.umgesetzt ?? [];
  const umgesetztText = umgesetzt.length > 0
    ? `${umgesetzt.map((e) => berichtUmsetzungEintrag(pakete, e)).join(", ")}.`
    : "keine";
  const nichtBegonnen = [...(stand.nichtBegonnen ?? []), ...(stand.zurueckgestellt ?? [])];
  const nichtBegonnenText = nichtBegonnen.length > 0
    ? `${nichtBegonnen.map((e) => berichtUmsetzungMitGrund(pakete, e.id, e.grund)).join(", ")}.`
    : "keine";
  return [
    "### Umsetzung", "",
    `- umgesetzt: ${umgesetztText}`,
    `- angehalten: ${liste(stand.angehalten ?? [])}`,
    `- nicht begonnen: ${nichtBegonnenText}`,
    "",
  ];
}

function berichtStufen(einheit, plan, pakete) {
  const stufen = einheit.stufen ?? {};
  const p = stufen.plan;
  const zeilen = [`- Variante: ${einheit.variante === "B" ? "B" : "A"}`];
  if (p?.id) {
    const pruefer = String(plan?.body || "").match(/^\s*Plan-Review:\s*(.+?)\s*$/m)?.[1] ?? "keiner";
    const kosten = p.kennzahlen?.kostenUsd;
    const kostenText = typeof kosten === "number" ? `${kosten.toFixed(2)} $` : "unbekannt";
    const titel = plan?.title ? ` (${plan.title})` : "";
    zeilen.push(`- Plan #${p.id}${titel}: Dauer ${minutenText(p.dauerMs)} min, Kosten der letzten Session ${kostenText}, Korrekturrunden ${p.korrekturrunden ?? 0}, Pruefer ${pruefer}, Marker ${stufen.review?.marker ? "gesetzt" : "fehlt"}.`);
  } else {
    zeilen.push("- Plan: keiner entstanden.");
  }
  const ids = stufen.pakete?.ids ?? [];
  zeilen.push(ids.length > 0
    ? `- Pakete (${ids.length}, Korrekturrunden ${stufen.pakete?.korrekturrunden ?? 0}): ${ids.map((id) => paketBezeichnung(pakete, id)).join(", ")}.`
    : "- Pakete: keine.");
  const fremd = stufen.pakete?.nichtZuordenbar ?? [];
  if (fremd.length > 0) zeilen.push(`- Nicht zuordenbar (ohne 'Plan: Issue #${p?.id}'): ${fremd.map((id) => "#" + id).join(", ")}.`);
  return zeilen;
}

function berichtAbgelehnt(einarbeitung) {
  if (einarbeitung === null) return ["- keine Einarbeitung gefunden"];
  const abgelehnt = einarbeitung.split(/\r\n|\r|\n/).map((z) => z.trim()).filter((z) => /abgelehnt/i.test(z));
  if (abgelehnt.length === 0) return ["- keine abgelehnten Befunde"];
  return abgelehnt.map((z) => (/^[-*+]\s/.test(z) ? z : `- ${z}`));
}

/**
 * Der Nachtbericht als Markdown (Plan #638, A10). Reine Funktion ueber der Einheit und
 * den gelesenen Karten, damit sie an Fixtures pruefbar ist; `jetzt` nur fuer Tests.
 *
 * Die Entscheidungen der Nacht sind die Aufzaehlungspunkte erster Ebene aus den
 * Architektonischen Entscheidungen des Plans, woertlich, die `Entscheidung:`-Zeilen aus
 * dem Kontext jedes Pakets und die `### Entscheidungen`-Bloecke aus dessen Kommentaren
 * (Abschlussbericht, Issue #697) — fortlaufend nummeriert, mit dem Ort in Klammern.
 */
/** Alle Entscheidungen der Nacht, woertlich, mit dem Ort in Klammern — siehe `berichtBauen`. */
function berichtEntscheidungen(stufen, plan, pakete) {
  const entscheidungen = punkteErsterEbene(plan?.body, ENTSCHEIDUNGEN_UEBERSCHRIFT).map((e) => `${e} (Plan #${stufen.plan?.id})`);
  for (const k of pakete) {
    for (const e of entscheidungsZeilen(k.body)) entscheidungen.push(`${e} (Paket #${k.id})`);
    for (const e of entscheidungenAusKommentaren(k)) entscheidungen.push(`${e} (Paket #${k.id})`);
  }
  return entscheidungen;
}

export function berichtBauen(einheit, {
  plan = null, pakete = [], einarbeitung = null, abdeckung = null, budget = {}, start, stempel, frage = null, jetzt = Date.now(),
} = {}) {
  const stufen = einheit.stufen ?? {};
  const z = [`${BERICHT_ANKER} ${stempel ?? LAUF_STEMPEL ?? "ohne Stempel"}`, ""];
  z.push("### Ausgang", "", einheit.grund ? `${einheit.ausgang} — ${einheit.grund}` : String(einheit.ausgang), "");
  z.push("### Stufen", "", ...berichtStufen(einheit, plan, pakete), "");
  if (einheit.variante === "B") z.push(...berichtUmsetzung(einheit, pakete));

  const entscheidungen = berichtEntscheidungen(stufen, plan, pakete);
  z.push("### Entscheidungen der Nacht", "");
  if (entscheidungen.length === 0) z.push("- Keine.");
  entscheidungen.forEach((e, i) => z.push(`${i + 1}. ${e}`));
  z.push("");

  z.push("### Abgelehnte Befunde", "", ...berichtAbgelehnt(einarbeitung), "");

  z.push("### Abdeckung gegen den Fachplan", "");
  if (abdeckung?.text) z.push(abdeckung.text);
  else z.push(`Keine Abdeckung: ${abdeckung?.grund ?? "die Kette hat die Stufe abdeckung nicht erreicht"}.`);
  if (einheit.abdeckungSchrieb) z.push("", "Hinweis: die Abdeckungs-Session hat am Board geschrieben, obwohl sie nur lesen sollte.");
  z.push("");

  const startZeit = start instanceof Date ? start : new Date(start ?? jetzt);
  const paketeErreicht = (stufen.pakete?.ids ?? []).length > 0;
  z.push("### Kennzahlen", "",
    `- Pakete erreicht: ${paketeErreicht ? "ja" : "nein"}`,
    `- Dauer der Kette: ${minutenText(jetzt - startZeit.getTime())} min ab ${startZeit.toISOString()}`,
    `- Entscheidungen: ${entscheidungen.length}`,
    `- Stopp-Fragen: ${einheit.ausgang === "angehalten" ? 1 : 0}`,
    `- Kosten: ${Number(einheit.kostenUsd ?? 0).toFixed(2)} $ von ${budget.kostenUsd ?? "?"} $`,
    `- kostenUnbekannt: ${einheit.kostenUnbekannt ?? 0}`,
    "");
  if (einheit.ausgang === "angehalten") z.push("### Offene Stopp-Frage", "", frage ?? einheit.grund ?? "siehe den Halt-Kommentar am Fachplan", "");
  if ((einheit.ueberholt ?? []).length > 0) z.push("### Ueberholt", "", ...einheit.ueberholt.map((id) => `- Plan #${id}`), "");
  if ((einheit.ueberholtUnbestaetigt ?? []).length > 0) {
    z.push("### Ueberholt, nicht bestaetigt", "", ...einheit.ueberholtUnbestaetigt.map((e) => `- Plan #${e.id} — ${e.grund}`), "");
  }
  z.push(BERICHT_SCHLUSS, "");
  return z.join("\n");
}

/**
 * Schreibt den Bericht als Kommentar an den Fachplan (A11) — ueber eine Datei ausserhalb
 * des Projekts, nie als Argument. Nimmt der Tracker ihn nicht an, wartet er als
 * `.claude/night-bericht-<F>-<stempel>.md` in der Hauptkopie. Rueckgabe ist der Wert
 * fuer `einheit.bericht`: "veroeffentlicht" oder der wartende Pfad. Kein `fail`: Ein
 * toter Tracker beim letzten Schritt darf die Kette nicht als Absturz enden lassen.
 */
export function berichtSchreiben(F, text, { stempel = LAUF_STEMPEL, repoRoot = process.cwd() } = {}) {
  const name = `${BERICHT_DATEI_PRAEFIX}${F}-${stempel ?? Date.now()}.md`;
  // Mit der Prozess-Id: Zwei Runner in derselben Sekunde teilten sich sonst die Zwischendatei.
  const pfad = join(tmpdir(), `${process.pid}-${name}`);
  writeFileSync(pfad, text, "utf-8");
  try {
    const res = boardRoh("issue", "comment", String(F), "--text-file", pfad);
    if (res.status === 0) {
      log(`  Nachtbericht als Kommentar an #${F} veroeffentlicht.`);
      return "veroeffentlicht";
    }
    const wartend = join(".claude", name);
    mkdirSync(join(repoRoot, ".claude"), { recursive: true });
    writeFileSync(join(repoRoot, wartend), text, "utf-8");
    log(`  Nachtbericht konnte nicht an #${F} geschrieben werden (${res.text.slice(0, 200)}) — liegt wartend unter ${wartend} und wird beim naechsten Start nachgetragen.`);
    return wartend;
  } finally {
    rmSync(pfad, { force: true });
  }
}

/**
 * Traegt wartende Berichte nach — beim Start jeder Betriebsart, nach `vorbereiten`.
 * Aufsteigend nach Dateiname, jeder genau einmal; gelingt das Schreiben, ist die Datei
 * weg, sonst bleibt sie liegen und der Lauf geht weiter. Liefert die nachgetragenen Namen.
 */
export function berichteNachtragen(repoRoot = process.cwd()) {
  const ordner = join(repoRoot, ".claude");
  if (!existsSync(ordner)) return [];
  const dateien = readdirSync(ordner).filter((n) => n.startsWith(BERICHT_DATEI_PRAEFIX) && n.endsWith(".md")).sort();
  const nachgetragen = [];
  for (const name of dateien) {
    const F = name.slice(BERICHT_DATEI_PRAEFIX.length).split("-")[0];
    const pfad = join(ordner, name);
    const res = boardRoh("issue", "comment", F, "--text-file", pfad);
    if (res.status === 0) {
      rmSync(pfad, { force: true });
      nachgetragen.push(name);
      log(`Wartenden Nachtbericht nachgetragen: .claude/${name} -> Kommentar an #${F}.`);
    } else {
      log(`Wartender Nachtbericht bleibt liegen: .claude/${name} — ${res.text.slice(0, 200)}`);
    }
  }
  return nachgetragen;
}

/**
 * Der Vorflug ist vor der ersten Kette gescheitert: jeder Kandidat bekommt den Kommentar
 * `Kette nicht gestartet` mit Grund, das Label bleibt — die Geste ist nicht verbraucht,
 * denn es lief nichts. Ohne `fail`, weil der Aufrufer gleich selbst hart stoppt.
 */
function ketteNichtGestartet(kandidaten, grund) {
  for (const k of kandidaten) {
    const res = boardRoh("issue", "comment", String(k.id), "--text", `Kette nicht gestartet: ${grund}`);
    log(res.status === 0
      ? `  #${k.id}: Kommentar 'Kette nicht gestartet' geschrieben, Label bleibt.`
      : `  #${k.id}: Kommentar 'Kette nicht gestartet' nicht geschrieben (${res.text.slice(0, 120)}).`);
  }
}

/**
 * Der einmalige Hinweis an einer Anforderung, die die Kette wegen fehlender Pruefung
 * abgelehnt hat (Fachplan #702, Kriterium 4; Issue #719).
 *
 * Grund und naechster Schritt stehen im Wortlaut des Protokolls: Wer morgens die Karte
 * liest, soll nicht erst im Protokoll nachsehen muessen. Einmalig wird der Kommentar
 * ueber den Anker — die Karte wird vorher zurueckgelesen, wie die Kette es mit ihren
 * Ueberholt-Kommentaren haelt (Plan #716, E3).
 *
 * Nicht lesbar heisst nicht schreiben: Ohne die vorhandenen Kommentare ist nicht zu
 * entscheiden, ob der Hinweis schon dasteht, und ein Lauf, der das jede Nacht neu
 * versucht, haengte der Karte den Hinweis mehrfach an. Ein gescheiterter Board-Aufruf
 * wird protokolliert und haelt den Lauf nicht auf — der Kommentar ist Hinweis, kein Gate.
 */
function pruefungFehltKommentieren(u) {
  const karte = leseKarte(u.id);
  if (!karte) {
    log(`  #${u.id}: Hinweis-Kommentar nicht geschrieben (Karte nicht lesbar).`);
    return;
  }
  if (kommentareVon(karte).some((k) => k.includes(KETTE_UNGEPRUEFT_ANKER))) {
    log(`  #${u.id}: Hinweis-Kommentar steht schon am Board — kein zweiter.`);
    return;
  }
  const res = boardRoh("issue", "comment", String(u.id), "--text", `${KETTE_UNGEPRUEFT_ANKER}\n\n${u.grund}.\n`);
  log(res.status === 0
    ? `  #${u.id}: Hinweis-Kommentar geschrieben, Label bleibt.`
    : `  #${u.id}: Hinweis-Kommentar nicht geschrieben (${res.text.slice(0, 120)}).`);
}

/**
 * Der Hinweis, dass das Board `review:fertig` offenbar gar nicht kennt (Fachplan #702,
 * Kriterium 8; Plan #716, E4).
 *
 * Ob das Kennzeichen am Board definiert ist, kann der Runner nicht fragen — kein
 * Kommando liest die dort angelegten Labels. Der Hinweis entsteht deshalb als Heuristik
 * ueber die ohnehin geholte Liste: Traegt keine einzige Karte das Label, ist er in
 * beiden Lesarten wahr, und sein Text nennt beide Wege.
 *
 * Er erscheint nur, wenn mindestens eine Anforderung deshalb abgelehnt wurde — ohne
 * Adressaten waere er Rauschen in jedem Protokoll. In Vorschau und Lauf gleichermassen:
 * Er schreibt nichts, er sagt nur etwas.
 */
function hinweisAufUnbekanntesKennzeichen(alle, abgelehnt, kettenLabel) {
  if (abgelehnt.length === 0 || (alle || []).some(hatReviewFertigLabel)) return;
  log(`Hinweis: keine Karte am Board traegt '${REVIEW_FERTIG_LABEL}' — deshalb wird jede fachliche Anforderung abgelehnt.`);
  log(`  Entweder ist das Kennzeichen am Board noch nicht angelegt — dann einmal anlegen, wie das Label '${kettenLabel}' —, oder es hat noch keine Anforderung eine Pruefung hinter sich (/issue-review <Nummer> setzt es).`);
}

/**
 * Die uebersprungenen Karten einer Nacht: Protokollzeile und Einheit im Ergebnisstand
 * wie bisher, dazu der Hinweis an den wegen fehlender Pruefung abgelehnten Anforderungen
 * (Issue #719).
 *
 * Beides steht VOR dem Reviewer-Vorflug (Plan #716, E7): Der Vorflug betrifft nur die
 * laufenden Ketten; scheitert er, sollen die abgelehnten Fachplaene ihren Kommentar
 * trotzdem schon haben.
 */
function uebersprungeneVerbuchen(uebersprungen, alle, kettenLabel, dryRun) {
  // Erkannt am festen Praefix, nicht am ganzen Grundtext: Der traegt je Karte ihre
  // Nummer und ist deshalb kein Vergleichswert.
  const abgelehnt = uebersprungen.filter((u) => String(u.grund).startsWith(UNGEPRUEFT_PRAEFIX));
  for (const u of uebersprungen) {
    log(`  #${u.id} ${u.title} -> uebersprungen (${u.grund})`);
    einheitErgaenzen(einheitAnlegen(u.id, u.title), { ausgang: "uebersprungen", grund: u.grund });
    // Der Dry-Run schreibt nichts ans Board; der Hinweis auf das Kennzeichen kommt
    // auch dort, er ist nur eine Protokollzeile.
    if (!dryRun && abgelehnt.includes(u)) pruefungFehltKommentieren(u);
  }
  hinweisAufUnbekanntesKennzeichen(alle, abgelehnt, kettenLabel);
}

/** Eine Karte ohne harten Stopp — null, wenn der Tracker sie nicht liefert. */
function leseKarte(id) {
  const res = boardRoh("issue", "get", String(id));
  return res.status === 0 && res.json ? res.json : null;
}

/** Sammelt Plan, Pakete, Einarbeitung und Abdeckung der Kette und baut den Bericht. */
function berichtFuerKette(kette, einheit, ergebnis) {
  const planId = kette.stufen.plan?.id;
  const plan = planId ? leseKarte(planId) : null;
  const pakete = (kette.stufen.pakete?.ids ?? []).map(leseKarte).filter(Boolean);
  const a = kette.stufen.abdeckung;
  return berichtBauen(einheit, {
    plan, pakete, einarbeitung: plan ? einarbeitungVon(plan) : null,
    abdeckung: a ? { text: a.text, grund: a.grund } : null,
    budget: kette.budget, start: kette.start, stempel: LAUF_STEMPEL, frage: ergebnis.frage ?? null,
  });
}

/**
 * Die Stufen einer Kette in Reihenfolge; die erste, die nicht fertig wird, ist der
 * Ausgang der Kette (mit ihrem Namen fuer den Halt-Kommentar). Unter Variante B kommt
 * hinter `abdeckung` die fuenfte Stufe `umsetzung` dazu (Plan #691, E12).
 */
async function stufenDerKette(kette) {
  const plan = await stufePlan(kette);
  if (plan.ausgang !== "fertig") return { ...plan, stufe: "plan" };
  const review = await stufeReview(kette, plan.id);
  if (review.ausgang !== "fertig") return { ...review, stufe: "review" };
  const pakete = await stufePakete(kette, plan.id);
  if (pakete.ausgang !== "fertig") return { ...pakete, stufe: "pakete" };
  const abdeckung = await stufeAbdeckung(kette, kette.F, plan.id, pakete.ids);
  if (abdeckung.ausgang !== "fertig") return { ...abdeckung, stufe: "abdeckung" };
  if (kette.variante !== "B") return { ausgang: "fertig" };
  // Die Paketliste kommt aus dem Stand der Stufe pakete (E16), nicht aus der
  // Ready-Spalte und nicht aus einer erneuten Abfrage nach Herkunft.
  const umsetzung = await stufeUmsetzung(kette, kette.stufen.pakete?.ids ?? []);
  if (umsetzung.ausgang !== "fertig") return { ...umsetzung, stufe: "umsetzung" };
  return { ausgang: "fertig" };
}

/**
 * Eine Kette zu einem Fachplan: Label verbrauchen, Worktree, Stufen, Einheit.
 *
 * Rueckgabe ist der Ausgang der Kette. Der Worktree wird in jedem Fall entfernt — auch
 * nach einem Wurf mitten in einer Stufe; ein liegengebliebener raeumt der naechste Start.
 */
async function laufeEineKette(kandidat, nummer, args) {
  const F = String(kandidat.id);
  const einheit = einheitAnlegen(F, kandidat.title);
  const kette = {
    F, args, budget: KETTE_BUDGET, repoRoot: process.cwd(), wt: null, start: new Date(),
    kosten: { kostenSumme: 0, kostenUnbekannt: 0 }, kostenGrund: null, stufen: {},
    variante: varianteVon(kandidat, KETTE_BUDGET),
  };
  log(`Kette ${nummer}/${args.max}: Issue #${F} — ${kandidat.title}`);
  // Das Kennzeichen ist mit dem Start verbraucht (A2): Ein Abbruch fuehrt zu einem
  // Bericht mit Grund und einer neuen Geste, nicht zur stillen Wiederholung.
  board("issue", "label", "remove", F, kette.budget.label);
  log(`  Label '${kette.budget.label}' entfernt — jedes Setzen autorisiert genau eine Kette.`);

  // Aeltere Plaene zum selben Fachplan, VOR der Plan-Stufe gesammelt: Nach einem neuen
  // Plan bekommen sie den Ueberholt-Kommentar (A8).
  const aeltere = board("issue", "list")
    .filter((i) => stammtAusErzeugung(i, F, "plan"))
    .map((i) => String(i.id));

  let ergebnis;
  try {
    kette.wt = worktreeAnlegen({ repoRoot: kette.repoRoot, issueId: F, stempel: LAUF_STEMPEL ?? String(Date.now()) });
    trackerImWorktreeUmleiten(kette.wt, kette.repoRoot);
    log(`  Worktree: ${kette.wt}`);
  } catch (e) {
    ergebnis = { ausgang: "abgebrochen", grund: `technischer Fehler: ${e.message}` };
  }
  try {
    if (!ergebnis) ergebnis = await stufenDerKette(kette);
    // `ohneHaltAmFachplan` setzt allein die Stufe umsetzung (E17): Dort traegt das
    // angehaltene PAKET bereits kit:klaeren, und ein zweites am Fachplan schloesse ihn
    // aus der naechsten Kette aus.
    if (ergebnis.ausgang === "angehalten" && !ergebnis.ohneHaltAmFachplan) haltAmFachplan(kette, ergebnis);
    const neuerPlan = kette.stufen.plan?.id;
    const ueberholung = neuerPlan && aeltere.length > 0
      ? aeltereUeberholen(kette, aeltere, neuerPlan)
      : { ueberholt: [], ueberholtUnbestaetigt: [] };
    einheitErgaenzen(einheit, {
      ausgang: ergebnis.ausgang,
      ...(ergebnis.grund ? { grund: ergebnis.grund } : {}),
      variante: kette.variante,
      stufen: kette.stufen,
      ...(ueberholung.ueberholt.length > 0 ? { ueberholt: ueberholung.ueberholt } : {}),
      ...(ueberholung.ueberholtUnbestaetigt.length > 0 ? { ueberholtUnbestaetigt: ueberholung.ueberholtUnbestaetigt } : {}),
      ...(kette.abdeckungSchrieb ? { abdeckungSchrieb: true } : {}),
      kostenUsd: kette.kosten.kostenSumme,
      kostenUnbekannt: kette.kosten.kostenUnbekannt,
    });
    // Der Bericht ist der letzte Schritt jeder Kette, bei jedem Ausgang (A10) — nach dem
    // Halt-Kommentar, damit er am Fachplan hinter der Frage steht, und vor dem Abbau des
    // Worktrees.
    einheitErgaenzen(einheit, { bericht: berichtSchreiben(F, berichtFuerKette(kette, einheit, ergebnis)) });
  } finally {
    if (kette.wt) worktreeEntfernen(kette.wt, kette.repoRoot);
  }
  const zusatz = ergebnis.grund ? ` — ${ergebnis.grund}` : "";
  log(`  Kette zu Issue #${F}: ${ergebnis.ausgang}${zusatz} (${kette.kosten.kostenSumme.toFixed(2)} $).`);
  return ergebnis.ausgang;
}

/** Die Hinweise zu Labels, die es nicht mehr gibt (Fachplan #635, Kriterium 12). */
function warneVorAltenLabels(issues) {
  for (const issue of issues) {
    for (const alt of ALTE_ROUTING_LABELS) {
      if ((issue.labels || []).includes(alt)) {
        log(`Hinweis: #${issue.id} traegt das Label '${alt}', das es seit Stufe 2 nicht mehr gibt — es hat keine Wirkung. Die Nacht-Kette startet ueber '${KETTE_BUDGET.label}' am Fachplan.`);
      }
    }
  }
}

/**
 * Programm Kette (Plan #638): Kandidaten, Vorflug, Dry-Run, dann Kette fuer Kette.
 * Beendet den Prozess selbst, wie der Dry-Run der Implementierung.
 */
export async function laufeKette(args) {
  const budget = KETTE_BUDGET;
  const repoRoot = process.cwd();
  const defaultsZeile = budgetDefaultsZeile(budget, KETTE_BUDGET_AUS_DEFAULT);
  if (defaultsZeile) log(defaultsZeile);
  if (!args.dryRun) {
    for (const p of worktreesAufraeumen(repoRoot)) log(`Liegengebliebenen Worktree entfernt: ${p}`);
  }
  const alle = board("issue", "list");
  warneVorAltenLabels(alle);
  const { kandidaten, uebersprungen, liegengeblieben } = waehleKettenKandidaten(alle, budget.label, args.max);
  uebersprungeneVerbuchen(uebersprungen, alle, budget.label, args.dryRun);
  for (const l of liegengeblieben) {
    log(`  #${l.id} ${l.title} -> ueber --max ${args.max}, bleibt liegen.`);
    einheitErgaenzen(einheitAnlegen(l.id, l.title), { ausgang: "liegengeblieben" });
  }
  if (kandidaten.length === 0 && uebersprungen.length === 0 && !alle.some((i) => (i.labels || []).includes(budget.label))) {
    const vorhanden = [...new Set(alle.flatMap((i) => i.labels || []))];
    log(`WARNUNG: keine Karte traegt das Label '${budget.label}' — es wird nichts verarbeitet.`);
    log(`  Vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
  }

  // Der Reviewer-Vorflug bleibt (A16): Die Pruefer-Session braucht die Reviewer in ihrer
  // eigenen Sandbox, und die Vorflug-Session ist die einzige Probe dafuer.
  await fuehreVorflug(args, kandidaten, "--kette --dry-run", (grund) => ketteNichtGestartet(kandidaten, grund));

  if (kandidaten.length === 0) {
    log(KETTE_LEER_GRUND);
    if (LAUF) LAUF.noWorkReason = KETTE_LEER_GRUND;
    laufAbschliessen("regulaer");
    process.exit(0);
  }

  if (args.dryRun) {
    log(`Budget: Plan ${budget.planMin} min, Pakete ${budget.paketeMin} min, Review ${budget.reviewMin} min, Abdeckung ${budget.abdeckungMin} min, ${budget.kostenUsd} $ je Kette, ${budget.korrekturrunden} Korrekturrunde(n).`);
    kandidaten.forEach((k, i) => log(`  #${k.id} ${k.title} -> Kette ${i + 1} (Variante ${varianteVon(k, budget)})`));
    log(`Dry-Run beendet: ${kandidaten.length} Kette(n) wuerden laufen — kein Worktree, kein Label veraendert.`);
    process.exit(0);
  }

  const zaehler = Object.fromEntries(KETTE_AUSGAENGE.map((a) => [a, 0]));
  let nummer = 0;
  for (const kandidat of kandidaten) {
    nummer++;
    const ausgang = await laufeEineKette(kandidat, nummer, args);
    zaehler[ausgang]++;
  }
  log(`Nacht-Kette beendet: ${zaehler.fertig} fertig, ${zaehler.angehalten} angehalten, ${zaehler.abgebrochen} abgebrochen, ${uebersprungen.length} uebersprungen, ${liegengeblieben.length} liegengeblieben.`);
  log(`Morgen-Ritual: Plaene und Pakete sichten, Abdeckung lesen, Pakete nach Ready ziehen — das GO bleibt deins. Nach Variante A liegen die Pakete morgens in Backlog; Variante B (Label '${budget.varianteBLabel}') hat sie in derselben Nacht umgesetzt, sie stehen dann in In review. Protokoll: ${LOG_FILE}`);
  laufAbschliessen("regulaer");
  process.exit(0);
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
function dryRunStufenVermerk({ modell, herkunft, stufe, stufeVerwendet, grund }) {
  if (herkunft === "karte") return `, Modell ${modell} (Karte)`;
  if (herkunft === "lauf") {
    const nachsatz = grund ? ` — ${grund}` : "";
    return `, Modell ${modell} (Lauf)${nachsatz}`;
  }
  const stufeText = stufeVerwendet === stufe ? `Stufe ${stufe}` : `Stufe ${stufe} nicht belegt`;
  return `, ${stufeText}, Modell ${modell} (Stufe ${stufeVerwendet})`;
}

function dryRunBefund(issue, ctx, assumedDone) {
  const aus = (grund) => ({ grund, vermerk: "" });
  if (!ctx.hasLabel(issue)) return aus(`uebersprungen (kein Label '${ctx.labelFilter}')`);
  if (isFachlich(issue.title)) return aus("wuerde ins Backlog (fachliches Issue, wird nicht implementiert)");
  if (isIdee(issue.title)) return aus("wuerde ins Backlog (Idee, wird nicht implementiert)");
  if (isPlan(issue.title)) return aus("wuerde ins Backlog (Plan-Dokument, wird nicht implementiert)");
  if (hatKlaerenLabel(issue)) return aus("wuerde ins Backlog (kit:klaeren, offene Entscheidung)");

  const full = board("issue", "get", String(issue.id));
  // Dasselbe Review-Gate wie im echten Lauf (Issue #304). Bis dahin lief es hier
  // NICHT mit: Der Dry-Run bildete nur Praefixe, Abhaengigkeiten und --max ab und
  // wies Tickets als Session aus, die der echte Lauf zurueckstellt. Wer damit
  // prueft, ob die Nacht laeuft, bekaeme eine Antwort ueber einen anderen Lauf.
  if (config.issueReview?.requiredBeforeReady) {
    const freigabe = reviewFreigabe(full.body);
    if (!freigabe.frei) return aus(`wuerde ins Backlog (${GATE_ABLEHNUNG[freigabe.art].kurz()})`);
  }
  const unmet = parseDeps(full.body).filter((d) => !assumedDone.has(d));
  if (unmet.length > 0) {
    return aus(`wuerde ins Backlog (Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt)`);
  }

  // Ohne aktive Einstellung bleibt die Zeile zeichengleich mit der von vor #712 (Kriterium
  // 1 des Issues) — dieselben zwei Zweige wie bisher, unveraendert.
  const einstellung = stufenEinstellung(config);
  if (!einstellung.aktiv) {
    // Das Modell gehoert in den Dry-Run (Issue #665): Wer vor der Nacht prueft, was
    // laufen wuerde, prueft auch, WOMIT. Herkunft dazu, sonst liesse sich ein Rueckfall
    // auf das Lauf-Modell nicht von einer Karte unterscheiden, die es selbst empfiehlt.
    const { modell, grund } = empfohlenesModell(full.body, config.night?.modelle);
    if (modell) return { grund: null, vermerk: `, Modell ${modell} (Karte)` };
    const nachsatz = grund ? ` — ${grund}` : "";
    return { grund: null, vermerk: `, Modell ${ctx.laufModell} (Lauf)${nachsatz}` };
  }

  // Bei aktiver Einstellung entscheidet dieselbe Funktion wie im echten Lauf, samt Stufe
  // und Ausweichen nach oben (Issue #712).
  const modellStand = paketWahl({
    body: full.body,
    einstellung,
    erlaubteModelle: config.night?.modelle,
    laufModell: ctx.laufModell,
  });
  if (!modellStand.startbar) {
    return aus(`wuerde nicht starten (keine startbare Stufe fuer Aufgabenstufe ${modellStand.stufe}: ${modellStand.grund})`);
  }
  return { grund: null, vermerk: dryRunStufenVermerk(modellStand) };
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
    log(READY_LEER_GRUND);
    if (LAUF) LAUF.noWorkReason = READY_LEER_GRUND;
    process.exit(0);
  }
  warnWennLabelNirgendsVorkommt(ctx, ready);
  const satisfied = satisfiedIds();
  const assumedDone = new Set(satisfied); // Annahme: frühere Runden gelingen
  let planned = 0;
  for (const issue of ready) {
    const { grund, vermerk } = dryRunBefund(issue, ctx, assumedDone);
    if (grund !== null) {
      log(`  #${issue.id} ${issue.title} -> ${grund}`);
      continue;
    }
    if (planned >= args.max) {
      log(`  #${issue.id} ${issue.title} -> ueber --max ${args.max}, bliebe liegen`);
      continue;
    }
    planned++;
    assumedDone.add(Number(issue.id));
    log(`  #${issue.id} ${issue.title} -> Session ${planned}${vermerk}`);
  }
  log(`Dry-Run beendet: ${planned} Session(s) wuerden starten.`);
  process.exit(0);
}

/**
 * Die sechs Gruende, aus denen ein Ready-Issue nicht implementiert wird (Issue #404).
 *
 * Rueckgabe: `null`, wenn das Issue drankommt — sonst `{ log, kommentar }` mit der
 * Protokollzeile und dem Text, der am Board haengen bleibt. Der Aufrufer verschiebt
 * das Issue danach ins Backlog; welcher Grund gilt, entscheidet allein diese
 * Funktion.
 *
 * Der volle Body wird erst geholt, wenn die vier Titel- und Label-Gates durch sind.
 * Ihn vorher zu laden waere ein Board-Aufruf je Issue, das ohnehin ausscheidet.
 */
export function pruefeIssueGates(top) {
  if (isFachlich(top.title)) {
    return {
      log: `#${top.id} uebersprungen: fachliches Issue ([Fachlich]), wird nicht implementiert.`,
      kommentar: `Nachtlauf: Fachliches Issue — wird nicht implementiert, bitte per /techplan #${top.id} in technische Issues ueberfuehren.`,
    };
  }
  if (isIdee(top.title)) {
    return {
      log: `#${top.id} uebersprungen: Idee ([Idee]), wird nicht implementiert.`,
      kommentar: `Nachtlauf: Idee — braucht erst /techplan #${top.id} + /issues, wird nachts nicht implementiert.`,
    };
  }
  if (isPlan(top.title)) {
    return {
      log: `#${top.id} uebersprungen: Plan-Dokument ([Plan]), wird nicht implementiert.`,
      kommentar: `Nachtlauf: Plan-Dokument — wird nicht implementiert, bitte per /issues #${top.id} in Arbeitspakete ueberfuehren.`,
    };
  }
  // Das Label bleibt dabei stehen: Es abzunehmen ist Sache des Menschen (A4).
  if (hatKlaerenLabel(top)) {
    return {
      log: `#${top.id} uebersprungen: traegt ${KLAEREN_LABEL}, eine offene Entscheidung wartet.`,
      kommentar: `Nachtlauf: Traegt kit:klaeren — eine offene Entscheidung wartet auf einen Menschen, wird nicht implementiert.`,
    };
  }

  const full = board("issue", "get", String(top.id));
  // Ungepruefte Issues zurueckstellen (Issue #223). Nur wenn ausdruecklich aktiviert:
  // Ein Kit-Update darf keinem Bestandsprojekt ueber Nacht den Runner anhalten, deshalb
  // ist der Default false. Anders als bei [Fachlich]/[Idee] wuerde der Runner ein
  // ungepruftes Issue nicht ablehnen — er wuerde es implementieren, und die Maengel
  // fielen erst im Code auf.
  if (config.issueReview?.requiredBeforeReady) {
    const freigabe = reviewFreigabe(full.body);
    if (!freigabe.frei) {
      const texte = GATE_ABLEHNUNG[freigabe.art];
      return {
        log: `#${top.id} ${texte.log()}`,
        kommentar: `Nachtlauf: ${texte.kommentar(top.id)}`,
      };
    }
  }

  const unmet = parseDeps(full.body).filter((d) => !satisfiedIds().has(d));
  if (unmet.length > 0) {
    return {
      log: `#${top.id} zurueckgestellt: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt.`,
      kommentar: `Nachtlauf: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt (nicht in In review/Done) — Issue zurueckgestellt.`,
    };
  }
  return null;
}

/**
 * Der Salvage-Versuch nach einer Runde, die nichts abgeschlossen hat (Issue #167).
 *
 * Bevor der Lauf hart stoppt, pruefen wir selbst, ob die Arbeit inhaltlich fertig
 * ist. Gruene buildChecks sind das Indiz dafuer, dass die Session nur ihr Ergebnis
 * verloren hat (Hintergrund-Check ohne Folge-Turn) und nicht wirklich gescheitert
 * ist. Genau ein Versuch pro Issue.
 *
 * Drei Ausgaenge, und sie sind nicht dasselbe: `erfolg` (der Lauf geht weiter),
 * `gescheitert` (harter Stopp, die Begruendung steht bereits im Protokoll) und
 * `nichtMoeglich` (rote Checks — danach gilt die regulaere Fehlschlag-Meldung des
 * Aufrufers). Wer die letzten beiden zusammenfasst, schreibt entweder eine
 * Fehlschlag-Zeile zu viel oder eine zu wenig.
 *
 * Der Ausgang `gescheitert` traegt seit Issue #672 drei unterscheidbare Endzustaende,
 * weil sie morgens drei verschiedene Griffe verlangen (Rueckgabewert bleibt einer —
 * `behandleDirtyRunde` behandelt alle drei als harten Stopp):
 *   - kein neuer Commit, Karte nicht bewegt -> die Session hat nichts hinterlassen
 *   - neuer Commit, Karte nicht bewegt      -> die Arbeit ist da, der Board-Zug fehlt
 *   - Karte in In review, Baum unsauber     -> die Karte behauptet mehr, als committet ist
 * Ob committet wurde, sagt der Vergleich des Commit-Hashes vor und nach der Session:
 * Der Arbeitsbaum ist vor der regulaeren Runde sauber, ein neuer Commit ist damit die
 * einzige Spur, die die Salvage-Session sicher hinterlaesst.
 */
async function versucheSalvage(top, args, sessionWahl) {
  const checks = verifyChecksForSalvage(config);
  if (!checks.ok) {
    // Kommando und Ausgabe dazu (Issue #668): Ohne sie stand hier ein Satz, der nur das
    // Urteil nannte. Wer morgens sichtet, braucht den Befund — die letzten Zeilen sind
    // dieselbe Menge, die auch der Salvage-Prompt mitgibt.
    const tail = (checks.output || "").trim().split("\n").slice(-15).join("\n");
    log(`  Salvage nicht moeglich: ${grundCheckRot(checks.rotesKommando ?? "unbenanntes Kommando", "Vorpruefung des Runners")} — die Runde ist wirklich gescheitert.`);
    if (tail) log(`  Ausgabe des roten Checks:\n${tail}`);
    return "nichtMoeglich";
  }
  log(`  SALVAGE-VERSUCH gestartet (Checks extern verifiziert gruen): Issue #${top.id} — Zwischenstand wird gegen das Issue geprueft.`);
  const commitVorher = lastCommitHash();
  await runSession(top.id, args, {
    prompt: salvagePrompt(top.id, checks.output, checks.formatFixCmd),
    timeoutMs: SALVAGE_TIMEOUT_MS,
    // Derselbe Weg wie die regulaere Runde (Issue #665, erweitert um #711): Der Salvage
    // prueft deren Zwischenstand gegen das Issue. Ein anderes Modell beurteilte fremde
    // Arbeit nach anderem Massstab, und die Wahl galt der Karte, nicht der Betriebsart —
    // darum geht bei einer Kommando-Stufe auch die Kommandozeile mit.
    ...sessionWahl,
    extraEnv: { NIGHT_SALVAGE: "1" },
  });
  const salvaged = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
  const reste = gitReste();
  if (salvaged && reste.length === 0) {
    log(`  Salvage erfolgreich, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
    board("issue", "comment", String(top.id), "--text",
      "Nachtlauf: Die regulaere Runde endete ohne Board-Ergebnis, die Pflicht-Checks waren extern aber gruen. Eine Salvage-Session hat den Zwischenstand geprueft, committet und das Issue nach In review verschoben. Bitte beim Review besonders auf Vollstaendigkeit achten.");
    return "erfolg";
  }
  // Der Grund traegt den Protokollsatz woertlich. Wo der Satz die Reste bereits nennt,
  // waere ein zweites `resteText` dieselbe Liste ein zweites Mal — nur beim engen
  // "kein Commit"-Satz kommt sie hier dazu, denn morgens braucht auch er die Namen.
  const commitNachher = lastCommitHash();
  const committet = commitNachher !== commitVorher;
  let satz;
  let grund;
  let kommentar;
  if (salvaged) {
    satz = `SALVAGE WIDERSPRUECHLICH — harter Stopp. Issue #${top.id} steht in In review, obwohl Arbeit liegen blieb; ${resteText(reste)}.`;
    grund = satz;
    kommentar = "Nachtlauf: Die Salvage-Session hat das Issue nach In review verschoben, obwohl Arbeit im Working Tree liegen blieb — Lauf hart gestoppt. Die Karte behauptet mehr, als committet ist. Bitte morgens manuell sichten.";
  } else if (committet) {
    satz = `SALVAGE UNVOLLSTAENDIG — harter Stopp. Issue #${top.id}: Commit ${commitNachher}, Board nicht bewegt; ${resteText(reste)}.`;
    grund = satz;
    kommentar = `Nachtlauf: Die Salvage-Session hat committet, aber Arbeit liegen gelassen und das Board nicht bewegt — Lauf hart gestoppt. Der Commit ${commitNachher} liegt lokal. Bitte morgens manuell sichten.`;
  } else {
    satz = `SALVAGE-VERSUCH gescheitert — harter Stopp. Issue #${top.id}: kein Commit, Board nicht bewegt.`;
    grund = `${satz} ${resteText(reste)}`;
    kommentar = "Nachtlauf: Pflicht-Checks extern gruen, aber die Salvage-Session hat weder committet noch das Board bewegt — Lauf hart gestoppt. Bitte morgens manuell sichten.";
  }
  log(`  ${satz}`);
  board("issue", "comment", String(top.id), "--text", kommentar);
  // Der Stopp wird HIER gemerkt und nicht beim Aufrufer (Issue #558): Der Text steht an
  // dieser Stelle, und eine Kopie in behandleDirtyRunde waere eine zweite, die
  // auseinanderlaeuft. Der Rueckgabewert bleibt derselbe String wie bisher.
  merkeHartenStopp("harterStopp", grund);
  return "gescheitert";
}

// Die Gruende einer Runde ohne Ergebnis (Issue #668).
//
// Woertliche Konstanten, weil Tests per Regex auf sie pruefen und weil sie in drei
// Ausgaben zugleich erscheinen: Protokoll, Board-Kommentar und `grund` des
// Ergebnisstands. Eine zweite Fassung an einer der drei Stellen waere eine zweite
// Wahrheit ueber denselben Vorgang.
//
// Sie beantworten die Frage, die der bisherige Text offenliess: nicht WAS der Runner
// vorgefunden hat — "nicht in In review UND Working Tree dirty" —, sondern WARUM. Die
// naechsten Schritte sind je Fall verschieden: Ein `end_turn` ohne Commit ist eine
// Session, die auf etwas gewartet hat; ein Zeitlimit ist ein zu grosses Paket; ein
// `is_error` ist ein Abbruch; ein roter Pflichtcheck ist Arbeit am Code.
const GRUND_END_TURN = "Grund: Session regulaer beendet ohne Commit (end_turn)";
const GRUND_ZEITLIMIT = "Grund: Session am Zeitlimit beendet";
const GRUND_IS_ERROR = "Grund: Session mit is_error beendet";
const GRUND_UNBEKANNT = "Grund: Session ohne auswertbares Ergebnis-Ereignis beendet";
const grundCheckRot = (kommando, quelle) => `Grund: Pflichtcheck rot — ${kommando} (${quelle})`;

/**
 * Warum hat diese Runde nichts abgeschlossen (Issue #668)?
 *
 * Reine Funktion ueber dem Ergebnis von `runSession` und der Pruef-Zusammenfassung der
 * Session, damit die Zuordnung an Fixtures pruefbar ist. Die Reihenfolge ist die
 * Rangfolge: Das Zeitlimit schlaegt alles, weil ein gekillter Baum ueber seinen
 * `stop_reason` nichts mehr sagt; danach der Abbruch; danach ein roter Pflichtcheck der
 * Session, weil er konkreter ist als jedes Ende; zuletzt das regulaere Ende.
 *
 * Exportiert fuer die Tests.
 */
export function rundenGrund(res, pruefung) {
  if (res?.error?.code === "ETIMEDOUT" || res?.signal === "SIGTERM") return GRUND_ZEITLIMIT;
  const kennzahlen = leseKennzahlen(res?.stdout);
  if (kennzahlen?.isError === true) return GRUND_IS_ERROR;
  if (pruefung?.zustand === "rot") return grundCheckRot(pruefung.rotesKommando ?? "unbenanntes Kommando", "Session");
  if (kennzahlen?.stopReason === "end_turn") return GRUND_END_TURN;
  return GRUND_UNBEKANNT;
}

/**
 * Der vierte harte Stopp: die Runde hat nichts abgeschlossen und den Baum
 * veraendert (Issue #404).
 *
 * Zuerst bekommt der Salvage seinen einen Versuch. Erst wenn der nicht moeglich war
 * — rote Checks —, gilt die regulaere Fehlschlag-Meldung. Ein GESCHEITERTER Salvage
 * hat seine Begruendung dagegen schon protokolliert und kommentiert; die Zeile hier
 * waere die zweite zum selben Fall.
 *
 * Das Issue bleibt liegen, wo es ist: Ein Backlog-Move saehe morgens aus wie ein
 * regulaer zurueckgestelltes Ticket, nicht wie ein Lauf, der stehengeblieben ist.
 *
 * Vor allem anderen steht seit Issue #572 der Ausschluss der angehaltenen Karte. Der
 * Auftrag des Salvage lautet, einen passenden Stand zu committen und die Karte nach
 * In review zu schieben — an einer angehaltenen Karte waere das genau der halbfertige
 * Stand, den der Halt gerade verworfen hat.
 */
async function behandleDirtyRunde(top, args, minutes, salvageAttempted, res, pruefung, sessionWahl) {
  // Frisch gelesen: `top` stammt aus der Ready-Liste VOR der Session und kennt das
  // Label nicht, das die Session selbst gesetzt hat.
  if (hatKlaerenLabel(board("issue", "get", String(top.id)))) {
    const satz = `HALT MIT UNSAUBEREM BAUM nach ${minutes} min: Issue #${top.id} traegt ${KLAEREN_LABEL}, aber der Working Tree ist dirty — kein Salvage, harter Stopp.`;
    log(`  ${satz}`);
    board("issue", "comment", String(top.id), "--text",
      "Nachtlauf: Halt mit unsauberem Working Tree — die Session hat kit:klaeren gesetzt, aber Aenderungen liegen gelassen; kein Salvage, Lauf hart gestoppt. Bitte morgens manuell sichten.");
    merkeHartenStopp("harterStopp", `${satz} ${resteText(gitReste())}`);
    return "hardStop";
  }
  if (!salvageAttempted.has(String(top.id))) {
    salvageAttempted.add(String(top.id));
    const salvage = await versucheSalvage(top, args, sessionWahl);
    if (salvage === "erfolg") return "erfolg";
    // Klasse und Grund hat versucheSalvage bereits gemerkt — hier bleibt nur der Ausgang.
    if (salvage === "gescheitert") return "hardStop";
  }
  // Der Grund steht VOR dem Zustand (Issue #668): Wer morgens sichtet, liest zuerst,
  // warum die Runde nichts abgeschlossen hat, und danach, was der Runner vorgefunden hat.
  // Der Zustandstext bleibt erhalten — er war nie falsch, nur unvollstaendig.
  const grund = rundenGrund(res, pruefung);
  const satz = `FEHLSCHLAG nach ${minutes} min: Issue #${top.id} — ${grund}; nicht in In review UND Working Tree dirty — harter Stopp.`;
  log(`  ${satz}`);
  board("issue", "comment", String(top.id), "--text",
    `Nachtlauf: Runde fehlgeschlagen und Working Tree nicht sauber hinterlassen — Lauf hart gestoppt. ${grund}. Bitte morgens manuell sichten.`);
  merkeHartenStopp("harterStopp", `${satz} ${resteText(gitReste())}`);
  return "hardStop";
}

/**
 * Wertet aus, was eine Implementierungs-Runde hinterlassen hat (Issue #404).
 *
 * Rueckgabe: `"erfolg"`, `"fehlschlag"`, `"hardStop"`, `"angehalten"` (Issue #572)
 * oder `"deferred"`. Die Worte sind die Zaehler des Laufs; der Unterschied zwischen
 * ihnen ist das Signal, das der Morgen liest.
 */
/**
 * Der Mangel am Nachweis, oder `null` — Grund fuer Log und Board in einem.
 *
 * `geprueft` und `leeresPaket` sind Erfolg wie bisher; die drei uebrigen Zustaende
 * sind es nicht. Jeder traegt seinen eigenen Text: #463 verlangt, dass der Betreiber
 * den Grund von Absturz und Infrastrukturfehler unterscheiden kann, und der
 * generische "Session ohne In-review-Ergebnis" leistet das nicht.
 */
function nachweisMangel(pruefung) {
  const zustand = pruefung?.zustand;
  if (zustand === "ungeprueft") {
    return "Nachweis fehlt — die Session hat keine Pruefung gefahren";
  }
  if (zustand === "unlesbar") {
    return `Nachweis unlesbar (${pruefung.fehler})`;
  }
  if (zustand === "rot") {
    return `Nachweis rot — ${pruefung.rotesKommando} endete ${pruefung.rotesErgebnis}`;
  }
  return null;
}

/**
 * Der Grund, aus dem werteRunde ein Paket zuruecklegt (Issue #488).
 *
 * Ein Text fuer Board-Kommentar und Ergebnisstand: Zwei Formulierungen desselben
 * Vorgangs waeren zwei Wahrheiten darueber, warum das Paket liegen blieb.
 */
const DEFERRED_GRUND = "Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter.";

/**
 * Uebersetzt den Rueckgabewert von werteRunde in die Felder der Einheit (Issue #488).
 *
 * Die Woerter der Zaehler (`deferred`, `hardStop`) und das Vokabular des
 * Ergebnisstands (`zurueckgestellt`, `harterStopp`) bleiben getrennt: Die Zaehler
 * gehoeren dem Textprotokoll und den bestehenden Tests, die Einheit dem Leitstand.
 */
function ausgangsFelder(ausgang) {
  if (ausgang === "deferred") return { ausgang: "zurueckgestellt", grund: DEFERRED_GRUND };
  if (ausgang === "hardStop") return { ausgang: "harterStopp" };
  // `angehalten` braucht keinen eigenen Zweig (Issue #572): Der Default liefert
  // `{ ausgang: "angehalten" }`, und einen Grund traegt der Halt nicht — er steht
  // als Kommentar der Session an der Karte, und eine zweite Fassung waere eine
  // zweite Wahrheit ueber denselben Vorgang.
  return { ausgang };
}

/**
 * Hat die Session einen VOLLSTAENDIG nachgewiesenen Halt hinterlassen (Issue #572)?
 *
 * Drei Spuren muessen zusammenkommen — die vierte, der saubere Arbeitsbaum, hat der
 * Dirty-Guard beim Aufrufer bereits geprueft. Das Label allein genuegt ausdruecklich
 * nicht: Eine Session kann nach dem Label und vor Kommentar oder Move abbrechen, und
 * der Infrastruktur-Guard laesst ein Timeout absichtlich passieren. Fehlt eine Spur,
 * faellt die Runde auf den bisherigen Rueckstellungsweg zurueck.
 *
 * Gewertet wird nur, was WAEHREND der Session hinzukam — ueber `neueKommentare`,
 * dieselbe Funktion, die auch der Review-Modus benutzt. Ein Zeitstempel wird nicht
 * herangezogen: Ein Zeitfenster belegt keine Urheberschaft (Issue #568).
 */
export function istHalt(vorher, nachher) {
  if (!hatKlaerenLabel(nachher)) return false;
  if (nachher?.status !== "backlog") return false;
  return neueKommentare(vorher, nachher).some((text) => String(text).includes(HALT_FOLGESATZ));
}

async function werteRunde(top, res, minutes, args, salvageAttempted, pruefung, vorher, sessionWahl) {
  const nowInReview = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
  if (nowInReview) {
    log(`  Erfolg nach ${minutes} min, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
    // Rest-Guard (Issue #152): Eine erfolgreiche Runde muss den Tree sauber
    // hinterlassen. Unkommittete Reste (z. B. Temp-Dateien) wuerden die
    // Diagnose der Folgerunde verfaelschen und koennten sie faelschlich als
    // dirty hart stoppen — darum hier stoppen, wo die Ursache noch klar ist.
    const reste = gitReste();
    if (reste.length > 0) {
      const satz = `HARTER STOPP: erfolgreiche Runde zu Issue #${top.id} hat unkommittete Reste hinterlassen — bitte morgens sichten und aufraeumen.`;
      log(`  ${satz}`);
      merkeHartenStopp("harterStopp", `${satz} ${resteText(reste)}`);
      return "hardStop";
    }
    // Nachweis-Guard (Issue #471): NACH dem Rest-Guard und nur hier, im
    // In-review-Pfad. Stuende er weiter oben, griffe er auch fuer eine Karte in
    // Ready — und weil die Karte dabei liegen bleibt, zoege die naechste Iteration
    // dasselbe Issue erneut, bis MAX_ITERATIONS erschoepft ist. Dazu bekaeme ein
    // gescheiterter CLI-Start (Infrastruktur-Guard, #149) den Kommentar "keine
    // Pruefung gefahren", und der Dirty-Guard waere umgangen.
    const mangel = nachweisMangel(pruefung);
    if (mangel) {
      log(`  Fehlschlag nach ${minutes} min: Issue #${top.id} in In review, aber ${mangel} — Karte bleibt, Commit bleibt, weiter.`);
      board("issue", "comment", String(top.id),
        "--text", `Nachtlauf: ${mangel}. Die Karte bleibt in In review und der Commit unangetastet — bitte den Stand pruefen.`);
      return "fehlschlag";
    }
    return "erfolg";
  }

  // Infrastruktur-Guard (Issue #149): Exit != 0 ohne Timeout heisst, das CLI selbst
  // ist gescheitert (Auth abgelaufen, Fehlkonfiguration) — mit dem Issue ist nichts
  // falsch. Harter Stopp ohne Kommentar und ohne Backlog-Move, sonst raeumt eine
  // kaputte Umgebung die ganze Ready-Spalte leer.
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  if (!timedOut && (res.error || res.status !== 0)) {
    const exitInfo = res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`;
    const detail = (res.stderr || res.stdout || "").trim().split("\n").slice(0, 3).join(" | ");
    const kopf = `INFRASTRUKTUR-FEHLSCHLAG nach ${minutes} min (${exitInfo}): Session-Start gescheitert — harter Stopp, Issue #${top.id} bleibt unangetastet.`;
    log(`  ${kopf}`);
    if (detail) log(`  CLI-Meldung: ${detail}`);
    // Beide Protokollzeilen, in derselben Reihenfolge (Issue #558): Die CLI-Meldung ist
    // hier das Einzige, was den Ausfall benennt — exitInfo allein sagt nur, dass es ihn gab.
    merkeHartenStopp("umgebung", detail ? `${kopf}\nCLI-Meldung: ${detail}` : kopf);
    return "hardStop";
  }

  if (!gitClean()) return behandleDirtyRunde(top, args, minutes, salvageAttempted, res, pruefung, sessionWahl);

  // Der Halt-Zweig (Issue #572) — NACH dem Infrastruktur- und dem Dirty-Guard und VOR
  // der Rueckstellung. Ein abgestuerztes CLI und ein unsauberer Baum sind auch dann
  // kein Halt, wenn das Label steht. Hier ist der Halt kein Fehler: eigene Log-Zeile,
  // kein Board-Kommentar und kein Move — beides hat die Session bereits getan.
  if (istHalt(vorher, board("issue", "get", String(top.id)))) {
    log(`  angehalten: eine offene Entscheidung wartet auf einen Menschen — Issue #${top.id} nach ${minutes} min von der Session ins Backlog gezeichnet, kein Kommentar und kein Move durch den Runner, weiter.`);
    return "angehalten";
  }

  log(`  Fehlschlag nach ${minutes} min: Issue #${top.id} nicht in In review, Tree sauber — Issue ins Backlog, weiter.`);
  board("issue", "comment", String(top.id), "--text", `Nachtlauf: ${DEFERRED_GRUND}`);
  board("issue", "move", String(top.id), "backlog");
  return "deferred";
}

/**
 * Ein Paket, das an einem Gate haengenbleibt: Log, Board-Kommentar, Backlog — und
 * seine Einheit im Ergebnisstand (Issue #404, erweitert um #488).
 *
 * Die Einheit traegt denselben Text, der am Board haengt. Als blosser Zaehler bliebe
 * morgens offen, WELCHES Issue an welchem Gate liegt.
 */
function stelleAmGateZurueck(top, gate) {
  log(gate.log);
  board("issue", "comment", String(top.id), "--text", gate.kommentar);
  board("issue", "move", String(top.id), "backlog");
  einheitErgaenzen(einheitAnlegen(top.id, top.title), { ausgang: "zurueckgestellt", grund: gate.kommentar });
}

/**
 * Uebernimmt `night.stufen` und `night.stufenRegel` frisch von Platte in die Lauf-Config
 * (Issue #711, Plan #707, E19).
 *
 * Geschrieben wird in dieselbe `config`, mit der der Lauf ohnehin arbeitet: Eine zweite,
 * daneben gefuehrte Fassung der Einstellung waere eine zweite Wahrheit darueber, was
 * gerade gilt. Ein Feld, das auf Platte verschwunden ist, verschwindet auch hier — sonst
 * bliebe eine geloeschte Stufe bis zum Laufende aktiv.
 */
function stufenFelderAuffrischen() {
  const { stufen, stufenRegel, grund } = frischeStufenFelder(CONFIG_PATH, config);
  if (grund) log(`  ${grund}`);
  config.night ??= {};
  for (const [feld, wert] of [["stufen", stufen], ["stufenRegel", stufenRegel]]) {
    if (wert === undefined) delete config.night[feld];
    else config.night[feld] = wert;
  }
}

/**
 * Die Hinweiszeile einer Runde zur Modellwahl, oder `null` (Issue #665, erweitert um #711).
 *
 * Sie erscheint nur, wenn es etwas zu sagen gibt — eine Stufe im Spiel oder ein Grund.
 * Ein Paket ohne beides protokolliert wie bisher nichts: Eine Zeile je Paket, die nur
 * "Modell des Laufs" wiederholt, machte die interessanten Zeilen unsichtbar.
 */
function rundenHinweis({ modell, herkunft, grund, stufe, stufeVerwendet }) {
  if (!stufe && !grund) return null;
  const teile = [];
  if (stufe) teile.push(`Aufgabenstufe ${stufe}`);
  teile.push(modell ? `Modell ${modell} (${herkunft})` : `kein Modell (${herkunft})`);
  if (stufeVerwendet && stufeVerwendet !== stufe) teile.push(`ueber Stufe ${stufeVerwendet}`);
  return grund ? `${teile.join(", ")} — ${grund}` : teile.join(", ");
}

/**
 * Ein Paket, dessen Stufe auf keiner Ebene startet (Issue #711, Kriterium 10).
 *
 * Fehlschlag und nicht Rueckstellung: Zurueckgestellt ist ein Paket, das an einem Gate
 * haengt oder dessen Session nichts abgeschlossen hat — hier ist die Einstellung des
 * Projekts unvollstaendig, und das soll morgens als Fehlschlag sichtbar sein. Das Issue
 * wandert nach Backlog wie bei jeder Runde ohne Ergebnis; bliebe es in Ready, zoege die
 * naechste Iteration dasselbe Paket erneut, bis MAX_ITERATIONS erschoepft ist.
 */
function ohneSessionGescheitert(top, einheit, modellStand, started) {
  const grund = `Keine startbare Stufe fuer Aufgabenstufe ${modellStand.stufe}: ${modellStand.grund}`;
  log(`  Fehlschlag ohne Session: Issue #${top.id} — ${grund} — Issue ins Backlog, weiter.`);
  board("issue", "comment", String(top.id), "--text", `Nachtlauf: ${grund} Es wurde keine Session gestartet.`);
  board("issue", "move", String(top.id), "backlog");
  einheitErgaenzen(einheit, {
    ausgang: "fehlschlag",
    grund,
    dauerMs: Date.now() - started,
    commit: null,
    endStatus: board("issue", "get", String(top.id)).status,
    // Ohne Session gibt es weder Pruefstand noch Kennzahlen. Beide Felder stehen trotzdem
    // da: Ein fehlendes Feld liesse offen, ob niemand gemessen hat oder ob nichts lief.
    pruefung: null,
    kennzahlen: null,
  });
  return "fehlschlag";
}

/**
 * Eine vollstaendige Runde: Session starten, auswerten, Einheit fuellen (Issue #488).
 *
 * Liefert den Ausgang aus `werteRunde` unveraendert zurueck — die Uebersetzung ins
 * Vokabular des Ergebnisstands passiert hier drin, die Zaehler des Aufrufers bleiben
 * bei ihren alten Woertern.
 */
async function laufeRunde(top, args, salvageAttempted, pruefungen) {
  // Die Einheit entsteht VOR der Session und wird sofort geschrieben: Bricht der Lauf
  // mitten in der Runde ab, steht das gezogene Paket trotzdem im Stand — mit ausgang
  // "unbekannt", was etwas anderes sagt als ein Fehlschlag.
  const commitVorher = lastCommitHash();
  const started = Date.now();
  // Vor dem Start verwerfen, direkt danach lesen (Issue #428): So zaehlt fuer eine
  // Session nur, was sie selbst geschrieben hat — und die Salvage-Session, die
  // weiter unten in werteRunde laufen kann, ist aussen vor.
  verwerfeZusammenfassung();
  // Die Karte VOR der Session, vollstaendig (Issue #572): Nur gegen diesen Stand
  // laesst sich sagen, welche Kommentare die Session selbst beigetragen hat — und nur
  // ein eigener Kommentar belegt den Halt. `top` stammt aus der Ready-Liste und
  // traegt den Body nicht in jeder Adapter-Fassung.
  const vorher = board("issue", "get", String(top.id));
  // Die Einstellung frisch von Platte, unmittelbar vor diesem Paket (Issue #711, E19):
  // Eine Aenderung an den Stufen soll noch in derselben Nacht wirken. Alles andere bleibt
  // beim Stand des Laufbeginns.
  stufenFelderAuffrischen();
  // Modell und Stufe dieser Karte (Issue #665, #711) — aus dem Body, den `vorher` ohnehin
  // traegt. Ein eigener `issue get` je Karte waere ein zweiter Aufruf gegen eine API, die
  // drosselt, fuer einen Wert, der bereits vorliegt.
  const modellStand = paketWahl({
    body: vorher?.body,
    einstellung: stufenEinstellung(config),
    erlaubteModelle: config.night?.modelle,
    laufModell: args.model,
  });
  // Die Einheit entsteht erst hier, weil sie das Modell traegt — und das steht erst fest,
  // wenn der Body gelesen ist. Sie wird weiterhin VOR der Session geschrieben: Bricht der
  // Lauf mitten in der Runde ab, steht das gezogene Paket trotzdem im Stand.
  const einheit = einheitAnlegen(top.id, top.title, modellStand);
  const hinweis = rundenHinweis(modellStand);
  if (hinweis) log(`  Hinweis zu #${top.id}: ${hinweis}`);

  // Kein startbarer Weg fuer die Stufe dieses Pakets (Issue #711, Kriterium 10): Das Paket
  // wird OHNE Session als Fehlschlag verbucht und der Lauf zieht das naechste. Der Rueckfall
  // auf das Modell des Laufs waere hier falsch — wer eine Stufe setzt, will dieses Paket auf
  // dieser Ebene laufen lassen. Und weil die Entscheidung vor dem ersten Arbeitsschritt
  // faellt, wird keine begonnene Umsetzung mit einem zweiten Modell wiederholt.
  if (!modellStand.startbar) return ohneSessionGescheitert(top, einheit, modellStand, started);

  // Womit die Session startet (Issue #711): Modellname oder die Kommandozeile der Stufe.
  // Dasselbe Buendel geht spaeter an die Salvage-Session desselben Pakets — sie prueft den
  // Zwischenstand der regulaeren Runde und muss dafuer auf demselben Weg laufen.
  const sessionWahl = modellStand.kommando
    ? { model: modellStand.modell, kommando: modellStand.kommando, stufenName: modellStand.stufenName, aufgabenstufe: modellStand.stufe }
    : { model: modellStand.modell };
  // `stream` und `vordergrundCheck` seit Issue #668. Der Strom traegt `stop_reason`, an
  // dem der Grund-Praefix haengt — ohne ihn waere der Fall, den dieses Paket erkennbar
  // macht, in genau den Laeufen unsichtbar, die ohne --verbose fahren. `vordergrundCheck`
  // sperrt `Monitor` und hebt die Bash-Zeitlimits; beides gilt nur fuer die
  // Implementierungs-Runde.
  const res = await runSession(top.id, args, { stream: true, vordergrundCheck: true, ...sessionWahl });
  // Einmal lesen und durchreichen (Issue #471): Die Salvage-Session, die in
  // werteRunde laufen kann, wuerde die Datei sonst ueberschreiben, und der
  // zweite Lesevorgang bewertete ihren Lauf statt den der regulaeren Session.
  const pruefung = lesePruefung(top.id);
  pruefungen.push(pruefung);
  // Die Rohdifferenz fuer den Ergebnisstand, die gerundete Minutenangabe fuer die
  // Textzeile (Issue #488): Eine Auswertung soll nicht "1.4" zurueckrechnen muessen.
  const dauerMs = Date.now() - started;
  const minutes = (dauerMs / 60000).toFixed(1);

  const ausgang = await werteRunde(top, res, minutes, args, salvageAttempted, pruefung, vorher, sessionWahl);
  // Unmittelbar nach der Auswertung (Issue #558): Die Guards kennen den Grund, aber
  // nicht die Einheit — hier liegt beides vor.
  if (ausgang === "hardStop") hefteStoppGrund(einheit);
  const commitNachher = lastCommitHash();
  einheitErgaenzen(einheit, {
    ...ausgangsFelder(ausgang),
    dauerMs,
    // Nur ein WIRKLICH neuer Hash zaehlt: Ein unveraenderter Stand hiesse sonst,
    // dem Paket den Commit des vorigen zuzuschreiben.
    commit: commitNachher === commitVorher ? null : commitNachher,
    endStatus: board("issue", "get", String(top.id)).status,
    pruefung,
    kennzahlen: leseKennzahlen(res.stdout),
  });
  return ausgang;
}

/**
 * Nimmt den Umsetzungs-Lock und meldet, was daraus wurde (Issue #696).
 *
 * Steht getrennt, damit die Schleife nur zwei Zeilen dafuer braucht: Sie ruft die Funktion
 * ueber `??=` genau einmal — vor der ersten Session — und liest danach nur noch `ok`.
 */
function lockVorErsterSession() {
  const lock = umsetzungLockNehmen(process.cwd());
  if (!lock.ok) log(`Umsetzung ausgelassen: ${lock.grund}. Der Lauf endet ohne Paket.`);
  else if (lock.hinweis) log(lock.hinweis);
  return lock;
}

/**
 * Vermerkt den Grund, wenn die Umsetzungsschleife mit leerem Ready endet, ohne bis
 * hierher ein einziges Paket gezogen zu haben (Issue #744). Ein Lauf mit Arbeit endet
 * an dieser Stelle ebenso, aber ohne noWorkReason — sonst entschiede diese Stelle
 * dieselbe Frage wie processedCount noch einmal.
 */
function readyLeerGrundVermerken(lauf) {
  if (lauf.sessions === 0 && LAUF) LAUF.noWorkReason = READY_LEER_GRUND;
}

/**
 * Die Runden der Umsetzungsnacht, eine nach der anderen.
 *
 * Fuehrt ihren Zustand in `lauf`, nicht ueber Rueckgaben: Bricht sie mit `break` ab — und
 * das tun vier harte Stopps —, muss der Aufrufer trotzdem wissen, wie weit sie kam.
 */
async function implementierungsSchleife(args, ctx, lauf) {
  let iterations = 0;
  while (lauf.sessions < args.max && iterations < MAX_ITERATIONS) {
    iterations++;
    const ready = board("issue", "list", "--status", "ready");
    if (ready.length === 0) {
      readyLeerGrundVermerken(lauf);
      break;
    }
    warnWennLabelNirgendsVorkommt(ctx, ready);

    // Routing-Label (#159): erstes Ready-Issue mit dem gesuchten Label; ungelabelte
    // Issues davor bleiben unangetastet. Kein Treffer -> Lauf endet wie bei leerem Ready.
    const top = ctx.labelFilter === null ? ready[0] : ready.find(ctx.hasLabel);
    if (!top) break;

    const gate = pruefeIssueGates(top);
    if (gate) {
      stelleAmGateZurueck(top, gate);
      lauf.zaehler.deferred++;
      continue;
    }

    // Erst hier, nicht beim Eintritt: Ein Lauf, der an leerem Ready, am Routing-Label oder
    // an lauter Gates endet, setzt keine Umsetzung in Gang und darf keine Kette abhalten.
    lauf.lock ??= lockVorErsterSession();
    if (!lauf.lock.ok) break;

    lauf.sessions++;
    log(`Session ${lauf.sessions}/${args.max}: Issue #${top.id} — ${top.title}`);
    const ausgang = await laufeRunde(top, args, lauf.salvageAttempted, lauf.pruefungen);
    if (ausgang === "hardStop") {
      lauf.hardStop = true;
      break;
    }
    lauf.zaehler[ausgang]++;
  }
}

/**
 * Die Implementierungsschleife (Phase 9 aus Issue #398).
 *
 * Liefert ein Ergebnisobjekt und beendet den Prozess NIE selbst. In der Phase endete
 * bis Issue #404 kein Pfad mit `return`: Die vier harten Stopps setzten `hardStop`
 * und brachen mit `break` ab, die uebrigen Enden liessen es ungesetzt, und der
 * Exit-Code entstand am Ende von main(). Wuerde die Schleife selbst exiten, ginge der
 * Unterschied zwischen "sauber beendet" und "hart gestoppt" verloren — und das ist
 * das Signal, das der Morgen liest.
 */
export async function laufeImplementierung(args, ctx) {
  const lauf = {
    sessions: 0,
    hardStop: false,
    // Die Ausgaenge von werteRunde als Zaehler, unter ihren eigenen Namen. Der
    // Ausgang indiziert direkt — eine if/else-Kette waere eine zweite Stelle, an der
    // die Woerter des Laufs stehen. `angehalten` (Issue #572) ist kein Fehlschlag und
    // keine Rueckstellung: Es steht als eigener Zaehler daneben, damit der Morgen die
    // wartende Entscheidung nicht in der Rueckstellungszahl sucht.
    zaehler: { erfolg: 0, deferred: 0, fehlschlag: 0, angehalten: 0 },
    // Genau ein Salvage-Versuch pro Issue und Lauf (#167).
    salvageAttempted: new Set(),
    // Was jede Session gepruft und was sie ausgelassen hat (#428) — je Runde ein Eintrag,
    // auch bei hartem Stopp: Der Bericht soll gerade dann sagen, was noch geprueft wurde.
    pruefungen: [],
    lock: null,
  };
  const { zaehler, pruefungen } = lauf;

  try {
    await implementierungsSchleife(args, ctx, lauf);
  } finally {
    // Nur den eigenen: Wer ihn nicht genommen hat, gibt ihn nicht frei.
    if (lauf.lock?.ok) lauf.lock.freigeben();
  }
  const { sessions, hardStop } = lauf;

  // Der Abschluss gehoert hierher und nicht in main(): Der Dry-Run beendet den Prozess
  // selbst und kaeme an einer Stelle in main() nie an.
  laufAbschliessen(hardStop ? "harterStopp" : "regulaer");
  return {
    sessions, hardStop, pruefungen,
    succeeded: zaehler.erfolg,
    deferred: zaehler.deferred,
    ohneNachweis: zaehler.fehlschlag,
    angehalten: zaehler.angehalten,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const ctx = vorbereiten(args);
  // Wartende Nachtberichte gehen vor jeder Betriebsart nach (Issue #645) — nicht im
  // Dry-Run, der nichts am Board veraendert.
  if (!args.dryRun) berichteNachtragen();

  // Drei einander ausschliessende Programme. Kette und Dry-Run beenden den Prozess
  // selbst; nur die Implementierung kehrt zurueck und laesst main() den Exit-Code bilden.
  // Die Kette steht vor dem Dry-Run: --kette --dry-run ist ein Trockenlauf DER KETTE.
  if (args.kette) {
    await laufeKette(args);
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
  log(`Nacht-Runner beendet: ${ergebnis.succeeded} erfolgreich, ${ergebnis.deferred} zurueckgestellt, ${ergebnis.ohneNachweis ?? 0} ohne gueltigen Nachweis, ${ergebnis.sessions} Session(s) gestartet, ${ergebnis.angehalten ?? 0} angehalten${ergebnis.hardStop ? ", HARTER STOPP" : ""}.`);
  for (const zeile of pruefBericht(ergebnis.pruefungen)) log(zeile);
  log(`Morgen-Ritual: /review -> Test -> push main. Protokoll: ${LOG_FILE}`);
  process.exit(ergebnis.hardStop ? 1 : 0);
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
