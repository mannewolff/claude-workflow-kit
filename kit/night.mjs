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
 *   - Working Tree dirty  -> Salvage-Versuch (siehe unten), sonst harter Stopp
 *   - Working Tree sauber -> Issue mit Kommentar zurueck ins Backlog, weiter
 *
 * Salvage (Issue #167): Eine Session, die einen langen Check im Hintergrund
 * startet und ihren Turn beendet, bevor das Ergebnis da ist, verliert es — eine
 * headless -p-Session hat keinen Folge-Turn. Das Board zeigt dann einen
 * Fehlschlag, obwohl die Arbeit fertig ist. Vor dem harten Stopp verifiziert der
 * Runner deshalb die Pflicht-Pruefungen selbst — mit `checks.mjs run --abschluss <id>
 * --frisch` im Zielprojekt (Issue #919), damit der Nachweis entsteht, den das
 * Commit-Gate liest. Sind sie gruen,
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
 * Abhaengigkeiten: `## Abhaengigkeiten` muss erfuellt sein (referenzierte #N nicht in
 * Backlog, Ready oder In progress), sonst wandert das Issue kommentiert ins Backlog (Kaskade).
 * Nicht implementierbare Issues werden vor dem Session-Start am Titel erkannt und
 * kommentiert ins Backlog gestellt: `[Fachlich]` (PO-Story, wird gegroomt, #146),
 * `[Idee]` (rohe Anforderung, noch kein Arbeitspaket, #192) und `[Plan]` (Plandokument, muss erst
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
 * Kommentar "Ueberholt durch Plan #M". Testhinweise der Formpruefung (eigene Tests
 * gefuehrter Bausteine, die der Plan nicht nennt) halten nichts an; was davon nach der
 * Planungssitzung stehen bleibt, schreibt der Runner als Kommentar "## Testhinweise der
 * Formpruefung" an den Plan (Issue #1033). Jede Stufe endet fertig, angehalten (genau eine Stopp-Frage: Kommentar
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
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, rmSync, readdirSync, renameSync } from "node:fs";
import { join, dirname, resolve, basename, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.6.1";

// SYNC: Die Vorgaben fuer --model und --label stehen als DEFAULT_MODEL und DEFAULT_LABEL in
// kit/night/grundlagen.mjs. Der Text steht hier, weil --help antwortet, bevor ein Teil
// geladen ist; test/night-grundlagen-argumente.test.mjs haelt beide Stellen gleich.
const HILFE = `Nacht-Runner: arbeitet die Ready-Spalte unbeaufsichtigt ab —
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
  --pruefen          Prueflauf am Tag statt Implementierung: je [Fachlich]-Issue mit dem
                     Label aus pruefLauf.label (Default kit:pruefen) eine Session
                     /issue-review in einem Worktree je Lauf, nacheinander. Der Lauf
                     bewegt keine Karte und setzt kein Label ausser dem, was die Pruefung
                     selbst hinterlaesst; begrenzt wird er ueber seine Budgets in
                     pruefLauf, nicht ueber eine Zahl — --max ist erlaubt, aber nicht
                     noetig. --label gilt hier nicht, das Label kommt aus der Config.
                     Eine Vorschau hat er nicht: /issue-review --dry-run zeigt Dokumente
                     und Reviewer.
  --max <N>          maximale Session-Starts pro Lauf (Default 10)
  --model <id>       Modell der Nacht-Sessions (sonst night.modell, sonst claude-opus-5)
  --timeout-min <N>  Zeitlimit pro Runde in Minuten (Default 60)
  --dry-run          zeigt Reihenfolge + Abhaengigkeits-Bewertung, startet nichts
  --yolo             --dangerously-skip-permissions statt auto mode (Warnung!)
  --no-checks-ok     Start ohne Pruefung der Paketstufe erlauben
  --label <name>     nur Ready-Issues mit diesem Label verarbeiten
                     (Default kit:nightrun); --label none schaltet den
                     Filter ab (altes Verhalten: striktes erstes Ready-Issue)
  --verbose [no|yes] Live-Verlaufsprotokoll: Tool-Aufrufe und Text-Snippets
                     der laufenden Session mitloggen (via stream-json). An,
                     ohne dass es ein Flag braucht; --verbose no schaltet es
                     ab, --verbose yes ausdruecklich an, --verbose ohne Wert
                     ist der Vorgabewert und damit wirkungslos
  --version          Kit-Stand dieser Datei
  --help, -h         diese Uebersicht

Salvage (immer an): Endet eine Runde ohne Board-Ergebnis, aber mit Aenderungen im
Working Tree, prueft der Runner selbst nach — mit "checks.mjs run --abschluss <id>
--frisch", also demselben Lauf, dessen Nachweis das Commit-Gate liest. Sind sie gruen, bekommt
genau eine Salvage-Session pro Issue die Chance, den Zwischenstand gegen das Issue
zu pruefen, zu committen und erst bei leerem "git status --porcelain" nach In review
zu verschieben (Zeitlimit 10 min). Das Kommando dazu steht im Prompt der Session und
laesst dieselben Laufzeit-Dateien aus, die auch der Rest-Guard nicht als Rest wertet
— sonst urteilte die Session strenger als der Runner. Rote Checks fuehren zum harten Stopp, und ebenso
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
`;

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
  parseArgs, log, schrittBeginnen, schrittEnden, fail, merkeHartenStopp, hefteStoppGrund, hefteStoppGrundAnLauf,
  resteText, vermerkeOhneArbeit, einheitErgaenzen, laufMelden, ersteZeile, schreibeErgebnisstand,
  BOARD_MAX_BUFFER, board, boardRoh, gitReste, gitClean, lastCommitHash,
  ladeConfigMitOverrides, laufArt } = await import("./night/grundlagen.mjs");
export const { nightStandLaden, journalLesen, laufendeKarten, standSetzen, abgeben, staendeNachtragen,
  hatSitzungsereignis, verwaisteLaeufeAbschliessen, waechterStartOptionen } = await import("./night/laufstand.mjs");
const { LAUF_ORDNER, ABBRUCH_BUDGET_MS, RECHNER, laufPositionSetzen, LAUF_KONTEXT, anhaltenLaeuft, nightStandPruefen,
  pulsSchreiben, laufstandStarten, laufAbbrechen, abbruchHandlerSetzen, zweiterVersuch, vermerkAnDieKarte,
  anhaltenVermerken, laufAnhalten, exitText, waechterLaufen, waechterStarten,
  waechterBeenden } = await import("./night/laufstand.mjs");
export const { umsetzungLockNehmen, UMSETZUNG_WARTEN_MS, aufUmsetzungWarten, RUNNER_SPERREN, nachziehenPruefen,
  worktreeAnlegen, worktreeEntfernen, befundeZurueck, worktreesAufraeumen, kitStandErmitteln, kitStandBereitstellen,
  kitStandEinsetzen, kitStandFreigeben, istStandKind, kitStandZeile } = await import("./night/kitstand.mjs");
const { pidAusInhalt, prozessLaeuft, befundeZurueckUndVorschlagen, KIT_STAND_BAEUME, kitStandAbgeben, kitStandInBaum,
  kitStaendeAufraeumen, kitStandMelden, kitStandFeld,
  kitStandSchritt } = await import("./night/kitstand.mjs");
export const { parseDeps, wartetAufPush, kreiseAb, abhaengigkeitsBefund, abhaengigkeitsBlock,
  abhaengigkeitsZeilen } = await import("./night/abhaengigkeiten.mjs");
const { OFFENE_FRAGEN_NAME, OFFENE_FRAGEN_UEBERSCHRIFT, ENTSCHEIDUNGEN_NAME, PO_FRAGEN_NAME, PO_FRAGEN_UEBERSCHRIFT,
  abschnittLesen, gateKarte, satisfiedIds, kreisLogZeile, leseKarte } = await import("./night/abhaengigkeiten.mjs");
export const { leseStromereignis, werkzeugZeitBeobachter, UEBERNAHME_MARKE, prueflaufBeobachter, fortschrittBeobachter,
  TOOL_RESULTS_PFAD, auskunftArt, auskunftBeobachter, umsetzungsStart, leseKennzahlen, kennzahlenAddieren, verbrauchLeer,
  verbrauchAddieren, verbrauchOhneEinheit, zeitenBauen, zeitenAddieren, prueflaeufeAddieren, kostenAddieren,
  leseErgebnisText, empfohlenesModell, aufgabenStufe, stufenEinstellung, posixShell, konfigKommandoStart, stufeStartbar,
  modellFuerStufe, paketWahl, frischeStufenFelder, warteAufProzessgruppe, sessionUmgebung, SITZUNG_MARKE, sitzungsSuche,
  sitzungsPids, sitzungsProzesse, baumBeendenAufruf, permissionArgs, BASH_RESERVE_MS, bashZeitlimit, sessionStart,
  runSession, lesePruefung, gueteAuswerten, fehlermerkmal, salvagePrompt, laufModell, KETTE_BUDGET_DEFAULTS,
  ladeKetteBudget, KETTE_UEBERGAENGE_DEFAULTS, ladeKetteUebergaenge, ketteBudgetDefaults, PRUEFLAUF_BUDGET_DEFAULTS,
  ladePruefLaufBudget, pruefLaufBudgetDefaults, varianteVon, trackerProbeId, vorflugPrompt, parseVorflugBefund,
  normalisiereVorflug, neueKommentare } = await import("./night/session.mjs");
const { flatten, endlicheZahl, STUFEN_ORDNUNG, SALVAGE_TIMEOUT_MS, paketstufenChecks,
  runBuildChecksSync, verifyChecksForSalvage, VORFLUG_MODEL, reviewerVorflug,
  LOKALER_KOMMENTARKOPF } = await import("./night/session.mjs");

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
    throw new Error("board/dokumente.mjs fehlt neben night.mjs — der Nacht-Runner braucht den Board-Adapter.");
  },
}));

// Die Praefix-Erkennung kommt seit Issue #464 aus demselben Modul, statt hier ein
// zweites Mal als Regex zu stehen. Ihr Fallback WIRFT wie der obige und liefert
// bewusst kein `false`: Ein stilles `false` liesse ein Plandokument als
// Arbeitspaket durch — der Runner implementierte es, und am Board saehe das wie
// ein Erfolg aus. Genau davor schuetzen die Praefixe.
const praefixFallback = (was) => (_title) => {
  throw new Error(`board.mjs liegt nicht neben night.mjs (${NACHBAR_BOARD}) — das Praefix ${was} ist nicht erkennbar.`);
};
// Die Lesung mit Herkunft (Issue #1062, Plan #1057 E1) wirft ohne Nachbarn aus demselben
// Grund: Ein stiller Ersatz liesse den Befund ohne Herkunft stehen, als gaebe es keine.
const abhaengigkeitenFallback = (_body) => {
  throw new Error(`board.mjs liegt nicht neben night.mjs (${NACHBAR_BOARD}) — die Herkunft der Abhaengigkeiten ist nicht lesbar.`);
};
// Die Erkennung geschuetzter Dateien (Issue #1046, Plan #987, E1) wirft ohne Nachbarn wie
// die Praefixe: Ein stilles "keine Treffer" liesse ein Paket mit geschuetzter Datei in eine
// Session — genau der Ausgang, der zweimal eine ganze Nacht gekostet hat.
const geschuetztFallback = (was) => () => {
  throw new Error(`board.mjs liegt nicht neben night.mjs (${NACHBAR_BOARD}) — ${was} ist nicht verfuegbar.`);
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
      istFachlich: praefixFallback("[Fachlich]"),
      istPlan: praefixFallback("[Plan]"),
      istIdee: praefixFallback("[Idee]"),
      istMensch: praefixFallback("[Mensch]"),
      abhaengigkeitenMitHerkunft: abhaengigkeitenFallback,
      geschuetzteTreffer: geschuetztFallback("die Erkennung geschuetzter Dateien"),
      geschuetztKommentar: geschuetztFallback("der Halt-Kommentar fuer geschuetzte Dateien"),
      geschuetztFreigabe: geschuetztFallback("die Freigabe geschuetzter Dateien"),
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

// Dieselbe Trennung fuer die Wirksamkeit (Issue #790): Die Textform kommt aus dem Modul,
// weil sie an beiden Ausgabestellen erscheint — im Laufprotokoll hier und im Kopf von
// `/push-main`. Der Wurf des Ersatzes ist ungefaehrlich, weil wirksamkeitAuswerten() ihn
// abfaengt und daraus die eine Protokollzeile macht, die ein Fehlschlag sein darf (E9).
const wirksamkeitBefundTextFallback = () => {
  throw new Error(`wirksamkeit.mjs liegt nicht neben night.mjs (${NACHBAR_WIRKSAMKEIT})`);
};
const { befundText: wirksamkeitBefundText } = existsSync(NACHBAR_WIRKSAMKEIT)
  ? await import(pathToFileURL(NACHBAR_WIRKSAMKEIT).href)
  : { befundText: wirksamkeitBefundTextFallback };

// Und dieselbe Trennung ein drittes Mal fuer die Befunde der Modell-Pruefungen (Issue
// #806): Auch ihr Befundblock erscheint an zwei Stellen — im Laufprotokoll hier und im
// Kopf von `/push-main` —, und auch hier faengt befundeAuswerten() den Wurf des Ersatzes
// ab und macht daraus die eine Protokollzeile, die ein Fehlschlag sein darf.
const befundeBefundTextFallback = () => {
  throw new Error(`befunde.mjs liegt nicht neben night.mjs (${NACHBAR_BEFUNDE})`);
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

const MAX_ITERATIONS = 500; // Notbremse gegen Endlosschleifen, weit ueber jedem realen Lauf

// --- Logging: Laufzustand und Lauf-Abschluss ---
//
// Der Kern des Logging steht in kit/night/grundlagen.mjs (Issue #1224). Hier bleibt, was
// Funktionen spaeterer Teile braucht und von den Grundlagen nicht gebraucht wird: der
// Laufzustand einzelner Laeufe, die Auswertungen und der Abschluss des Laufs, die Art des
// Laufs und der Lauf-Kopf. Es wandert mit seinem Hauptaufrufer (Plan #1199, E17).

// Die Budgets der Kette, geladen in vorbereiten() — Modul-Zustand wie `config`, weil
// ART_LABEL und die Stufen sie brauchen, ohne dass jede Funktion sie durchreicht.
let KETTE_BUDGET = null;
// Die Budget-Felder, die aus den Defaults stammen (Issue #659) — geladen zusammen mit
// KETTE_BUDGET, gezeigt im Protokoll und am Lauf-Kopf.
let KETTE_BUDGET_AUS_DEFAULT = [];
// Die freigegebenen Uebergaenge der Kette (Issue #1087), geladen zusammen mit KETTE_BUDGET.
let KETTE_UEBERGAENGE = null;
// Dieselben zwei Variablen fuer den Prueflauf (Issue #909), geladen in vorbereiten() —
// getrennt von denen der Kette, weil die beiden Laeufe nebeneinander stehen koennen und
// jeder seine eigenen Zahlen traegt.
let PRUEFLAUF_BUDGET = null;
let PRUEFLAUF_BUDGET_AUS_DEFAULT = [];

// Der Satz einer Rettung ohne Commit (Issue #1089) und der Grund eines abgebrochenen Pakets,
// dessen Reste im Stash liegen — dasselbe Muster wie STOPP_GRUND, fuer den Ausgang
// `abgebrochen`, der den Lauf nicht anhaelt.
let SALVAGE_GRUND = "";
let ABBRUCH_GRUND = "";
// Die Pakete, die in diesem Lauf abgebrochen sind (E15): Ein Paket, das von einem davon
// abhaengt, zeigt am Gate `wartet` statt nur zurueckzugehen.
const ABGEBROCHENE_PAKETE = new Set();

// Hat die Sitzung der laufenden Runde auf eine selbst angestossene Arbeit gewartet
// (Issue #776)? Modul-Zustand nach demselben Muster wie STOPP_GRUND darueber und aus
// demselben Grund: Der Befund faellt in der Auswertung, gebraucht wird er beim Fuellen der
// Einheit — und die Rueckgabewerte der Auswertungswege bleiben die Zaehlwoerter, die
// mehrere Stellen als String vergleichen. Vor jeder Session zurueckgesetzt, damit keine
// Runde den Befund ihrer Vorgaengerin erbt.
let WARTEND_BEENDET = false;

// Ist die Sitzung der laufenden Runde am Zeitlimit abgebrochen worden (Issue #977)?
// Derselbe Modul-Merker nach demselben Muster wie WARTEND_BEENDET darueber und aus
// demselben Grund: Der Befund faellt in den drei Auswertungswegen, gebraucht wird er beim
// Fuellen der Einheit — und deren Rueckgabewerte bleiben die Zaehlwoerter. Vor jeder
// Session zurueckgesetzt, damit keine Runde den Befund ihrer Vorgaengerin erbt.
//
// Gesetzt wird er allein in den Zweigen OHNE In-review-Ergebnis: Eine vom Salvage
// gerettete Karte ist fertig und soll in keiner Auswertung als Zeitabbruch zaehlen
// (Plan #974, E8).
let ZEITLIMIT_BEENDET = false;

// Die Art des Halts der laufenden Runde (Issue #1050, E12): `"klaeren"`, `"geschuetzt"` oder
// `null`. Derselbe Modul-Merker wie WARTEND_BEENDET und aus demselben Grund: Der Befund
// faellt in `werteRunde`, gebraucht wird er beim Fuellen der Einheit und in der Kette —
// und der Rueckgabewert bleibt das Zaehlwort `angehalten`. Vor jeder Session zurueckgesetzt.
let HALT_ART = null;

// Der Pfad, aus dem `config` stammt (Issue #711). Die Runde liest `night.stufen` und
// `night.stufenRegel` unmittelbar vor jedem Paket von dort neu; ohne den gemerkten Pfad
// muesste sie ihn ein zweites Mal zusammensetzen, und zwei Herleitungen desselben Pfades
// liefen bei der ersten Aenderung auseinander.
let CONFIG_PATH = null;

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
  auswertungLaufen(AUFWAND_PATH, "aufwand", "Aufwands-Auswertung", befundText);
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
  auswertungLaufen(WIRKSAMKEIT_PATH, "wirksamkeit", "Wirksamkeits-Auswertung", wirksamkeitBefundText);
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
  auswertungLaufen(BEFUNDE_PATH, "befunde", "Befunde-Auswertung", befundeBefundText);
}

// Das Zeitlimit beider Auswertungen (Issue #824, night-67). Ohne Limit haengt der
// ganze Abschluss an ihnen: `kit/wirksamkeit.mjs` ruft fuer die Ruecklaeuferquote
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
 * Lauf-Kopf, Name in der Protokollzeile und die Textform ihres Befundblocks.
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
    if (!existsSync(pfad)) throw new Error(`${pfad} liegt nicht vor`);
    // maxBuffer wie bei den Board-Aufrufen: Der Stand traegt alle einbezogenen Laeufe,
    // und ein abgeschnittener Puffer machte daraus einen Parse-Fehler.
    const res = spawnSync(process.execPath, [pfad, "auswerten"], {
      encoding: "utf-8",
      cwd: process.cwd(),
      maxBuffer: BOARD_MAX_BUFFER,
      timeout: timeoutMs,
    });
    // ETIMEDOUT bekommt eine eigene Meldung: "liess sich nicht starten" waere hier falsch
    // — das Werkzeug lief, es kam nur nicht zurueck.
    if (res.error?.code === "ETIMEDOUT") throw new Error(`Zeitlimit von ${timeoutMs} ms ueberschritten`);
    if (res.error) throw new Error(`${pfad} liess sich nicht starten: ${res.error.message}`);
    if (res.status !== 0) throw new Error(`Exit ${res.status}: ${ersteZeile(res.stderr || res.stdout)}`);
    let stand;
    try {
      stand = JSON.parse(res.stdout);
    } catch (err) {
      throw new Error(`Ausgabe nicht lesbar: ${err.message}`);
    }
    ZUSTAND.LAUF[feld] = stand;
    for (const zeile of textform(stand).split("\n")) {
      if (zeile.trim() !== "") log(zeile);
    }
  } catch (err) {
    // Nur, wenn kein Ergebnis vorliegt: Wirft erst der Textbau, bleibt das gelesene
    // Ergebnis am Lauf-Kopf stehen — es ist gemessen, und der Fehlschlag betrifft die Form.
    if (!(feld in ZUSTAND.LAUF)) ZUSTAND.LAUF[feld] = { ok: false, fehler: err.message };
    log(`${bezeichnung} fehlgeschlagen: ${err.message} — der Lauf endet unveraendert.`);
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
const ART_MODUS = { implementierung: "Implementierung", kette: "Kette", pruefung: "Pruefung" };
const ART_LABEL = {
  implementierung: (args) => args.label,
  kette: () => KETTE_BUDGET?.label ?? KETTE_BUDGET_DEFAULTS.label,
  pruefung: () => PRUEFLAUF_BUDGET?.label ?? PRUEFLAUF_BUDGET_DEFAULTS.label,
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
  if (args?.kette) return { budget: KETTE_BUDGET, ausDefault: KETTE_BUDGET_AUS_DEFAULT };
  if (args?.pruefen) return { budget: PRUEFLAUF_BUDGET, ausDefault: PRUEFLAUF_BUDGET_AUS_DEFAULT };
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
 * ueberschriebe sonst den ersten. Ohne Trennzeichen, weil Doppelpunkte unter Windows
 * in Dateinamen verboten sind. Zwei Starts in derselben Sekunde trennt
 * `laufStempelReservieren` (Issue #1190).
 */
function ergebnisstandAnlegen(args, aktivesLabel, jetztVorher) {
  if (args.dryRun) return;
  const budgetStand = laufBudget(args);
  const { stempel, jetzt, pfad, fehler } = laufStempelReservieren(process.cwd(), jetztVorher);
  // Wie jeder Schreibfehler am Ergebnisstand bricht auch dieser den Lauf nicht ab: Der
  // Stempel bleibt der zuletzt gebildete, die Kollision ist dann hingenommen wie frueher.
  if (fehler) log(`Ergebnisstand konnte nicht reserviert werden: ${fehler}`);
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
  };
}

// --- Wurzel belegt (Plan #1113, E5, E6) ---
//
// Laufstand, Puls, Abbruch, Umgebung und Waechter stehen seit Issue #1225 in
// kit/night/laufstand.mjs. Hier bleibt, was aus dem Laufstand-Text liest, ob ein anderer
// Runner eine fachliche Wurzel haelt: Es fragt Plan-Praefix, fachliche Quelle,
// Prozess-Probe und die Budgets von Kette und Prueflauf und geht mit seinem Hauptaufrufer,
// der Kette, in deren Teil (Plan #1199, E17).

/** Reserve auf die Gesamtzeit-Obergrenze, bevor ein fremder Laufstand als verwaist gilt (E5). */
const WURZEL_RESERVE_MS = 15 * 60_000;

/**
 * Die Gesamtzeit-Obergrenze einer Karte in Millisekunden (E5): die Summe der Kettenstufen
 * oder das Budget des Prueflaufs. Der Laufstand nennt seine Laufart nicht; darum gilt die
 * groessere — ein lebender Lauf darf nie als tot gelten, ein toter wartet nur laenger.
 */
function wurzelObergrenzeMs({ kette, pruefLauf }) {
  const ketteMin = kette.planMin + kette.paketeMin + kette.reviewMin + kette.abdeckungMin + kette.umsetzungMin;
  return Math.max(ketteMin, pruefLauf.pruefungMin) * 60_000;
}

/** Lauf-ID, Stand und Position aus einem Laufstand-Text (#1186) — `null` ohne Lauf-ID. */
function laufstandKopf(text) {
  const t = String(text ?? "");
  const laufId = /^Lauf-ID:[^\S\n]*(\S+)[^\S\n]*$/m.exec(t)?.[1];
  if (!laufId) return null;
  const [host, pid] = laufId.split("/");
  const stand = Date.parse(/^Stand:[^\S\n]*(\S+)[^\S\n]*$/m.exec(t)?.[1] ?? "");
  const k = Number(/^Position:[^\S\n]*(\d+)[^\S\n]+von[^\S\n]+\d+[^\S\n]*$/m.exec(t)?.[1]);
  return { laufId, host, pid: Number(pid), stand, k: k > 0 ? k : 1 };
}

/**
 * Haelt ein lebender Runner die fachliche Wurzel `F` (Plan #1113, E5, E6)? Rein bis auf die
 * Prozess-Probe auf demselben Rechner.
 *
 * Gewertet werden F selbst und jeder Plan (`isPlan`) mit `Fachliche Quelle:` F; Arbeitspakete
 * tragen dieselbe Zeile, ihre Konkurrenz regelt aber die Umsetzungssperre. `staende` ordnet
 * Kartennummern ihren Laufstand `{ zustand, text }` zu (Map oder Objekt). Nur `laeuft` mit
 * Lauf-ID belegt; lebend heisst auf demselben Rechner (`host` wie in der Lauf-ID) ein
 * laufender Prozess, von einem anderen Rechner aus ein `Stand:`, der juenger ist als Position
 * mal Gesamtzeit-Obergrenze plus Reserve — Karte k kommt fruehestens nach k−1 Budgets dran.
 *
 * Rueckgabe `{ karte, laufId }` des ersten lebenden Halters, sonst `null`.
 */
export function wurzelBelegt(F, issues, staende, jetzt, host, { budgets = { kette: ladeKetteBudget({}), pruefLauf: ladePruefLaufBudget({}) } } = {}) {
  const wurzel = String(F);
  const standVon = (id) => (staende instanceof Map ? staende.get(id) : staende?.[id]);
  const obergrenzeMs = wurzelObergrenzeMs(budgets);
  const karten = (issues || [])
    .filter((i) => String(i?.id) === wurzel || (isPlan(i?.title ?? "") && fachlicheQuelleVon(i?.body || "") === wurzel))
    .map((i) => String(i.id));
  for (const karte of karten) {
    const stand = standVon(karte);
    if (stand?.zustand !== "laeuft") continue;
    const kopf = laufstandKopf(stand.text);
    if (!kopf) continue;
    const lebt = kopf.host === host
      ? Number.isInteger(kopf.pid) && kopf.pid > 0 && prozessLaeuft(kopf.pid)
      : Number.isFinite(kopf.stand) && jetzt.getTime() - kopf.stand < kopf.k * obergrenzeMs + WURZEL_RESERVE_MS;
    if (lebt) return { karte, laufId: kopf.laufId };
  }
  return null;
}

// --- Umsetzungs-Lock, Worktree je Kette, fester Kit-Stand ---
//
// Die drei Abschnitte stehen seit Issue #1226 im Teil kit/night/kitstand.mjs (Plan #1199,
// E17); der Einstieg laedt ihn oben und exportiert seine Namen weiter.

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

// Der Pruefer-Vermerk am Plan, den /issue-review dort hinterlaesst.
//
// Derselbe Ausdruck trug bisher an drei Stellen dieselbe Arbeit — zweimal als blosse
// Marker-Probe (`\s*\S`), einmal als Wert-Auslese (`\s*(.+?)\s*$`) —, und die beiden
// Fassungen waren sich uneinig: 'Plan-Review:   ' war der einen ein Wert, der anderen
// keiner. Jetzt liest eine Funktion den Wert, und die Marker-Probe fragt sie.
//
// Der Ausdruck sieht nur noch die getrimmte Zeile: Das fuehrende `\s*` hinter `^` mit
// m-Flag war der SonarQube-Fund (S8786, Issue #877) — derselbe, den Issue #496 fuer
// REVIEW_MARKER_ZEILE behoben hat, und er wird auf demselben Weg behoben. Die Form des
// Werts ist die von AUTOR_MODELL_ZEILE: vom ersten bis zum letzten Nicht-Leerzeichen.
export const PLAN_REVIEW_ZEILE = /^Plan-Review:[^\S\n]*(\S(?:[^\n]*\S)?)[^\S\n]*$/;

/**
 * Der Wert eines Marker-Ausdrucks im Body — sonst `null`.
 *
 * `trimStart()` statt `[^\S\n]*` im Ausdruck, aus demselben Grund wie bei
 * `hasReviewMarker`: Es raeumt dieselben Zeichen ab, `\r` aus CRLF eingeschlossen.
 */
function markerWert(body, ausdruck) {
  for (const zeile of String(body ?? "").split("\n")) {
    const treffer = ausdruck.exec(zeile.trimStart());
    if (treffer !== null) return treffer[1];
  }
  return null;
}

/** Der Pruefer aus der Zeile 'Plan-Review: <pruefer>' eines Plan-Bodys — sonst `null`. */
export function planReviewWert(body) {
  return markerWert(body, PLAN_REVIEW_ZEILE);
}

/** Ob der Body eines Plans den Plan-Review-Marker mit einem Wert traegt. */
export function hatPlanReviewMarker(body) {
  return planReviewWert(body) !== null;
}

// Der Pruefer-Vermerk an der fachlichen Anforderung, den /issue-review dort hinterlaesst
// (Fachplan #899, Plan #904, Issue #907). Gebaut wie PLAN_REVIEW_ZEILE, weil er dasselbe
// leistet — nur an der anderen Kartenart. Den Namen kennt `kit/board.mjs` bereits als
// Gate F11 der fachlichen Anforderung.
export const FACHPLAN_REVIEW_ZEILE = /^Fachplan-Review:[^\S\n]*(\S(?:[^\n]*\S)?)[^\S\n]*$/;

/** Der Pruefer aus der Zeile 'Fachplan-Review: <pruefer>' — sonst `null`. */
export function fachplanReviewWert(body) {
  return markerWert(body, FACHPLAN_REVIEW_ZEILE);
}

/** Ob der Body einer fachlichen Anforderung den Fachplan-Review-Marker mit Wert traegt. */
export function hatFachplanReviewMarker(body) {
  return fachplanReviewWert(body) !== null;
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
 * Das Zeichen fuer eine wartende menschliche Handlung an einer geschuetzten Datei (Issue
 * #1046, Plan #987, E11).
 *
 * Dieselbe Richtung wie bei `kit:klaeren`: Die Maschine SETZT das Label, abnehmen darf es
 * allein der Mensch — das Abnehmen ist zusammen mit dem Halt-Kommentar die Freigabe (E5).
 * Ein Lauf, der es abraeumen duerfte, gaebe sich selbst frei; `issue label remove` mit
 * diesem Namen kommt im Runner darum nicht vor. Ein eigenes Label und nicht `kit:klaeren`,
 * weil hier nichts zu entscheiden, sondern etwas zu tun ist.
 *
 * SYNC: `GESCHUETZT_LABEL` und `GESCHUETZT_ANKER` stehen gleichlautend in kit/board.mjs
 * (Issue #1045), wo `geschuetztKommentar` den Halt-Text baut und `geschuetztFreigabe` ihn
 * zurueckliest. Wer einen hier aendert, aendert ihn dort mit — der Gleichlauf-Test in
 * test/night-geschuetzt-gate.test.mjs vergleicht beide Seiten.
 */
export const GESCHUETZT_LABEL = "kit:geschuetzt";
export const GESCHUETZT_ANKER = "## Geschuetzte Datei";
// Die Zeile, mit der `issue check-geschuetzt --pfad` einen beim Schreiben abgewiesenen Pfad
// fuehrt (Issue #1053). Der Auffang aus #1051 erkennt daran, dass der Pfad aus dem Stream der
// Session stammt und nicht aus der Aufgabe. SYNC: gleichlautend in kit/board.mjs.
export const GESCHUETZT_ABGEWIESEN = "beim Schreiben abgewiesen";

export function hatGeschuetztLabel(issue) {
  return (issue?.labels || []).includes(GESCHUETZT_LABEL);
}

// Der Kommentar des Label-Gates. SYNC: Ohne das Praefix `Nachtlauf: ` steht er als
// Backlog-Text von `issue auftrag` in kit/board.mjs (Issue #1052).
export const GESCHUETZT_LABEL_GATE_TEXT = `Nachtlauf: Traegt ${GESCHUETZT_LABEL} — eine menschliche Handlung an einer geschuetzten Datei wartet, wird nicht implementiert. Das Label nimmt nur ein Mensch ab.`;

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

// Wie eine fachliche Anforderung sagt, dass keine Frage mehr offen ist: die erste
// nichtleere Zeile beginnt mit "Keine" — ein fuehrender Listenstrich davor und ein
// beliebiger Zusatz dahinter sind erlaubt. Bewusst laxer als `KEINE_STOPP_FRAGEN`:
// `/fachplan` schreibt keine Listenform vor, und die vorhandenen Anforderungen tragen
// dort Fliesstext ("Keine. Die vier Fragen hat der PO entschieden …").
const KEINE_PO_FRAGEN = /^(?:[-*+]\s+)?Keine/;

/**
 * Traegt eine fachliche Anforderung offene Fragen an den PO (Issue #916)? — `null`, wenn
 * nicht.
 *
 * Eigene Funktion neben `stoppFragenGrund` und mit eigener Ueberschrift-Konstante: Die
 * beiden Faelle unterscheiden sich in Ueberschrift, erlaubter Schreibweise und Wirkung
 * (Halt mitten in der Kette gegen Ausschluss vor dem Start). Ein gemeinsamer Parameter
 * verbaende zwei Regeln, die getrennt wandern koennen.
 *
 * Ein FEHLENDER Abschnitt laeuft, anders als beim Plandokument: Ob eine fachliche
 * Anforderung ihren Pflichtabschnitt traegt, prueft Gate F7 in board.mjs; die Kette misst
 * sie nicht ein zweites Mal daran.
 */
export function offeneFragenGrund(body) {
  const abschnitt = abschnittLesen(body, PO_FRAGEN_UEBERSCHRIFT);
  if (abschnitt === null) return null;
  // Nur Zeilen ausserhalb eines Fence, aus demselben Grund wie bei `stoppFragenGrund`:
  // Eine im Codeblock gezeigte Beispielfrage ist keine offene Frage.
  const erste = abschnitt.zeilen.find((z, i) => abschnitt.ausserhalb[i] && z.trim() !== "");
  if (erste === undefined) return null;
  if (KEINE_PO_FRAGEN.test(erste.trim())) return null;
  return `offene Frage an den PO: ${flatten(erste, STOPP_FRAGE_ZITAT)}`;
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

/**
 * Die fachliche Wurzel eines Plandokuments (Fachplan #883, Plan #890) — `null` ohne sie.
 *
 * Dieselbe Zeilenform wie in `stammtAusErzeugung`, nur ohne vorgegebene Nummer: Dort
 * wird gefragt „traegt dieses Dokument Quelle #N?", hier „welche Quelle traegt es?".
 * Der Feldname kommt aus `HERKUNFT_FELD.plan`, damit die Schreibweise nicht an zwei
 * Stellen gepflegt wird.
 *
 * Die Nummer geht UNVERAENDERT zurueck, ohne fuehrende Nullen zu streichen: Der lokale
 * Tracker nummeriert `0001`, und eine normalisierte `1` traefe dort keine Karte. Wer
 * vergleicht, vergleicht zeichengleich.
 */
export function fachlicheQuelleVon(body) {
  const zeile = new RegExp(
    String.raw`^[^\S\n]*${HERKUNFT_FELD.plan}:[^\S\n]*Issue[^\S\n]*#(\d+)[^\S\n]*$`,
    "m",
  );
  return zeile.exec(String(body ?? ""))?.[1] ?? null;
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

// --- Gehoert der Nachweis zum Commit des Pakets? (Issue #865) ---
//
// Die Zusammenfassung traegt keinen Vermerk darueber, welchen Stand sie gemessen hat —
// sie ist schlicht die letzte, die eine Session hinterlassen hat. Lauf #118 zeigte, was
// daraus folgt: Nach einem gruen geprueften Commit startete die Session eine weitere
// Pruefung und brach sie ab; deren Zwischenfassung ("nicht gestartet") stand danach in
// der Datei, und der Runner meldete ein sauberes Paket als "Nachweis rot".
//
// Die Frage ist dieselbe, die das Commit-Gate (.githooks/gate.mjs) vor jedem Commit
// stellt, nur gegen den Commit statt gegen den Index: Traegt die Zusammenfassung fuer
// JEDE Datei, die der Commit aendert, genau den Blob, der dort gelandet ist?
//
// Die Richtung ist mit Bedacht die des Gates (Commit -> Nachweis) und nicht die
// umgekehrte: Eine Zusammenfassung enthaelt regelmaessig mehr, als der Commit aufnimmt
// — der Board-Move nach In progress aendert beim lokalen Tracker issues/<id>.md, und
// die Session committet die Datei nicht. Gegen diese Beifaenge zu pruefen, hiesse den
// Nachweis in jedem Lauf dieses Repos als fremd zu verwerfen.

const NACHPRUEF_GRUND = "Nachpruefung des Commits (Nachweis war fremd)";

/** Die Pfade samt Status, die ein Commit aendert. `null`, wenn git nicht antwortet. */
function commitEintraege(commit) {
  // `--root`, damit auch ein erster Commit ohne Eltern Eintraege liefert; `-z` und
  // `--no-renames` aus denselben Gruenden wie im Gate (quotePath, R-Zeilen mit zwei Pfaden).
  const res = spawnSync("git", ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", "--root", commit],
    { encoding: "utf-8", cwd: process.cwd() });
  if (res.status !== 0) return null;
  const felder = res.stdout.split("\0");
  const eintraege = [];
  for (let i = 0; i + 1 < felder.length; i += 2) {
    if (felder[i]) eintraege.push({ status: felder[i], pfad: felder[i + 1] });
  }
  return eintraege;
}

/** Der Blob eines Pfads im Commit, oder `null`, wenn er dort nicht liegt. */
function blobImCommit(commit, pfad) {
  const res = spawnSync("git", ["rev-parse", `${commit}:${pfad}`], { encoding: "utf-8", cwd: process.cwd() });
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * Passt die Zusammenfassung `daten` zum Commit `commit`? Mit dem Grund, wenn nicht —
 * er nennt die erste abweichende Stelle und geht so, wie er ist, in Log und Bericht.
 *
 * Zwei Faelle heissen "nicht beurteilbar" und gelten darum als passend: eine
 * Zusammenfassung ohne `hashes` (Format vor Issue #469) und ein git-Aufruf, der
 * scheitert. Ein Nachweis, den dieser Abgleich nicht lesen kann, soll denselben Weg
 * gehen wie vor diesem Paket — nicht einen strengeren.
 */
function nachweisPasstZuCommit(daten, commit) {
  if (!daten || daten.hashes === null || typeof daten.hashes !== "object") return { passt: true, grund: null };
  // `abgeschlossen: false` heisst: Diese Fassung hat ein Abbruch hinterlassen (Issue
  // #857). Sie kann nie der Nachweis eines Commits sein, unabhaengig von den Blobs.
  if (daten.abgeschlossen === false) return { passt: false, grund: "die Pruefung wurde abgebrochen" };
  const eintraege = commitEintraege(commit);
  if (eintraege === null) return { passt: true, grund: null };
  for (const { status, pfad } of eintraege) {
    if (!(pfad in daten.hashes)) return { passt: false, grund: `${pfad} ist darin nicht geprueft` };
    // Bei einer Loeschung genuegt, dass der Pfad geprueft wurde — einen Blob gibt es
    // im Commit nicht mehr, und die Zusammenfassung fuehrt ihn mit `null`.
    if (status.startsWith("D")) continue;
    if (daten.hashes[pfad] !== blobImCommit(commit, pfad)) {
      return { passt: false, grund: `${pfad} wurde in einer anderen Fassung geprueft` };
    }
  }
  return { passt: true, grund: null };
}

/**
 * Der Pruefstand der Nachpruefung: der Abschlussumfang, bis einschliesslich des roten
 * Kommandos. Was `paketstufenChecks` auslaesst, erscheint auch hier nicht — die
 * Nachpruefung vollzieht den Abschluss nach und faehrt nie mehr als er (Plan #944, E14).
 */
function nachpruefLaufen(cfg, nach) {
  const laufen = [];
  for (const eintrag of paketstufenChecks(cfg)) {
    const cmd = typeof eintrag === "string" ? eintrag : eintrag.cmd;
    const rot = !nach.ok && cmd === nach.rotesKommando;
    laufen.push({ cmd, grund: NACHPRUEF_GRUND, ergebnis: rot ? "rot" : "gruen" });
    if (rot) break;
  }
  return laufen;
}

/**
 * Der Pruefstand einer Session, gegen den Commit des Pakets gehalten (Issue #865).
 *
 * Ohne Commit — die Runde hat nichts abgeliefert — bleibt alles, wie `lesePruefung` es
 * gelesen hat: Es gibt keinen Stand, zu dem der Nachweis gehoeren muesste.
 *
 * Passt er nicht, faehrt der Runner die Paketstufe selbst nach, statt den Fall nur zu
 * melden. Ein Morgen mit "unklar" zwingt den Menschen zu genau der Pruefung, die der
 * Runner nachts billiger hat.
 */
function bewertePruefung(issueId, commit, cfg) {
  const { roh, ...pruefung } = lesePruefung(issueId);
  if (!commit || !roh) return pruefung;
  const abgleich = nachweisPasstZuCommit(roh, commit);
  if (abgleich.passt) return pruefung;

  log(`  Der Pruefnachweis gehoert nicht zum Commit ${commit} (${abgleich.grund}) — die Pflicht-Checks werden nachgefahren.`);
  const nach = runBuildChecksSync(cfg);
  const ausgang = nach.ok ? "gruen" : `rot — ${nach.rotesKommando}`;
  log(`  Nachpruefung ${ausgang}.`);
  return {
    ...pruefung,
    zustand: nach.ok ? "nachgeprueft" : "rot",
    ...(nach.ok ? {} : { rotesKommando: nach.rotesKommando, rotesErgebnis: "rot" }),
    // Der Umfang ist der der Nachpruefung, nicht der des fremden Nachweises: Sie faehrt
    // den Abschlussumfang ohne Bereichsauswahl.
    laufen: nachpruefLaufen(cfg, nach),
    ausgelassen: [],
    vollerUmfang: true,
    leeresPaket: false,
    basis: commit,
    bereiche: null,
    dauerGesamtMs: null,
    // Ganz hinten (Issue #776): Neue Felder haengen an, die bestehenden behalten Namen
    // und Reihenfolge.
    nachweisFremd: true,
    nachweisGrund: abgleich.grund,
  };
}

function pruefListe(eintraege, leerText) {
  return eintraege.length === 0 ? leerText : eintraege.map((e) => `${e.cmd} (${e.grund})`).join("; ");
}

/** Eine Zeile je Session — auch die ohne Pruefung, sonst saehe sie aus wie keine. */
function pruefZeile(p) {
  // Der fremde Nachweis zuerst (Issue #865): Was hier zaehlt, ist nicht das Ergebnis der
  // Session, sondern das der Nachpruefung — und der Grund, aus dem sie noetig war.
  if (p.nachweisFremd) {
    const ergebnis = p.zustand === "rot" ? `Nachpruefung rot — ${p.rotesKommando} endete rot` : "Nachpruefung gruen";
    return `  Issue #${p.id}: ${p.zustand} — Nachweis gehoerte nicht zum Commit (${p.nachweisGrund}), ${ergebnis}.`;
  }
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
  // Die Nachpruefung zaehlt mit (Issue #865): Sie ist gelaufen, ihre Kommandos stehen im
  // Pruefstand, und "0 Pruefung(en) gelaufen" waere nach einem nachgefahrenen Lauf falsch.
  // Die Session-Zahl davor bleibt getrennt — `nachgeprueft` hat dort seine eigene Stelle.
  const mitLaeufen = pruefungen.filter((p) => p.zustand === "geprueft" || p.zustand === "nachgeprueft");
  const summe = (feld, filter = () => true) =>
    mitLaeufen.reduce((n, p) => n + p[feld].filter(filter).length, 0);
  const rot = summe("laufen", (e) => e.ergebnis === "rot");
  return `  Summe: ${pruefungen.length} Session(s) — ${geprueft.length} mit Pruefung, `
    + `${zaehle("nachgeprueft")} nachgeprueft, `
    + `${zaehle("leeresPaket")} ohne Aenderung, ${zaehle("ungeprueft") + zaehle("unlesbar")} ungeprueft, `
    + `${zaehle("rot")} rot; `
    + `${summe("laufen")} Pruefung(en) gelaufen (davon ${rot} rot), ${summe("ausgelassen")} ausgelassen.`;
}

/**
 * Der Pruefteil des Lauf-Berichts: je Session eine Zeile, darunter eine Summe.
 * Kriterium 11 aus Issue #420 verlangt die Auslassungen an zwei Stellen — am
 * Arbeitspaket (Abschlussbericht, Issue #426) und hier.
 */
function pruefBericht(pruefungen, einheiten = [], zielMin = undefined) {
  const zahlen = prueflaufZeilen(einheiten, zielMin);
  if (pruefungen.length === 0) return ["Pruefungen: keine Implementierungs-Runde gelaufen.", ...zahlen];
  return ["Pruefungen der Sessions:", ...pruefungen.flatMap(pruefZeilen), pruefSummenzeile(pruefungen), ...zahlen];
}

// --- Prueflaeufe und Zielmarke im Bericht (Issue #926, Plan #917, E6-E9) ---

/**
 * Die Zielmarke einer Umsetzung in Minuten — aus der Konfiguration, sonst die Vorgabe.
 *
 * Abschalten ist nicht vorgesehen: Fehlt `night.zielUmsetzungMin`, gilt die Vorgabe des
 * Schemas. Eine Marke, die sich wegkonfigurieren laesst, waere eine Messung, die genau
 * dort verschwindet, wo sie unangenehm wird.
 */
// SYNC: dieselbe Vorgabe steht im Schema von kit/einstellungen.mjs (night.zielUmsetzungMin).
const ZIEL_UMSETZUNG_VORGABE_MIN = 10;

function zielUmsetzungMin(wert) {
  const zahl = endlicheZahl(wert);
  return zahl !== null && zahl > 0 ? zahl : ZIEL_UMSETZUNG_VORGABE_MIN;
}

/**
 * Die Zahlenzeile eines Pakets: gemessene Dauer, dazu die Prueflaeufe — oder deren Fehlen.
 *
 * Hinter den Abschlussversuchen steht die Wartezeit auf den Abschluss (Issue #1073, Plan
 * #1066, A9): der letzte Abschluss aus `wartezeitMs` des Pruefstands, die Summe aller
 * Abschlussversuche aus dem Zaehler des Runners. Fehlt eine der beiden Zahlen, entfaellt
 * ihr Teil — dieselbe Haltung wie beim fehlenden Zaehler, und die Zeile bleibt kurz.
 */
function prueflaufPaketZeile(einheit) {
  const kopf = `- Issue #${einheit.id}: Dauer ${minutenText(einheit.dauerMs)} min`;
  const arbeit = einheit.prueflaeufe?.arbeit;
  // "nicht gemessen" und keine Null (E9): Eine 0 hiesse, die Session habe nichts geprueft —
  // hier ist nur niemand dabei gewesen (Stufe ohne Strom).
  if (!arbeit) return `${kopf}, Prueflaeufe nicht gemessen`;
  const abschluss = einheit.prueflaeufe?.abschluss;
  const abschlussText = abschluss ? `, Abschlussversuche ${abschluss.anzahl ?? 0}` : "";
  const letzter = endlicheZahl(einheit.pruefung?.wartezeitMs);
  const summe = (abschluss?.anzahl ?? 0) > 0 ? endlicheZahl(abschluss.dauerMs) : null;
  const letzterText = letzter === null ? "" : `, letzter Abschluss ${(letzter / 1000).toFixed(1)} s`;
  const summeText = summe === null ? "" : `, Abschluss-Wartezeit zusammen ${minutenText(summe)} min`;
  return `${kopf}, Prueflaeufe ${arbeit.anzahl ?? 0} (volle ${arbeit.volle ?? 0}, `
    + `Gruppenlaeufe ${arbeit.volleNoetig ?? 0})${abschlussText}${letzterText}${summeText}`;
}

/**
 * Die Prueflaeufe je Paket und die Summe gegen die Zielmarke — derselbe Block in BEIDEN
 * Berichten (E6): im `pruefBericht` der Umsetzungsnacht und unter `### Umsetzung` des
 * Kettenberichts. Der Anlassfall — ein Paket von 43 Minuten — lief in einer
 * Umsetzungsnacht; stuende die Zahl nur im Kettenbericht, blieb genau dieser Lauf
 * unbeobachtet.
 *
 * Gezaehlt werden die Einheiten, die eine Implementierungs-Runde durchlaufen haben —
 * erkennbar an ihrem `pruefung`. Die Fachplan-Einheit der Kette und die Einheiten ohne
 * Session (zurueckgestellt, uebersprungen, ohne startbare Stufe) tragen keines und bleiben
 * draussen: Sie haben keine Umsetzung, deren Dauer sich an einer Marke messen liesse.
 *
 * Gerechnet wird mit `einheit.dauerMs`, der Rundendauer einschliesslich aller Pruefungen
 * und Korrekturen (Konvention aus `kit/aufwand.mjs`) — nicht mit `zeiten.dauerMs`.
 * Gerechnet wird hier und nicht in der Datei (E7): Zwei Rechnungen ueber dieselbe Messung
 * driften auseinander.
 */
export function prueflaufZeilen(einheiten, ziel = undefined) {
  const marke = zielUmsetzungMin(ziel);
  const pakete = (Array.isArray(einheiten) ? einheiten : []).filter((e) => e?.pruefung);
  if (pakete.length === 0) return ["Prueflaeufe und Zielmarke: keine Umsetzung gemessen."];
  const zeilen = ["Prueflaeufe und Zielmarke:"];
  for (const e of pakete) {
    zeilen.push(prueflaufPaketZeile(e));
    // Jede Datei mit Namen (E8): Eine Zahl sagte nicht, wo das Loch ist. Der Abschluss
    // bleibt davon unberuehrt — die Luecke ist ein Befund, kein rotes Ergebnis.
    const ohne = e.pruefung?.ohneZuordnung ?? [];
    if (ohne.length > 0) zeilen.push(`- Issue #${e.id}: ohne Zuordnung: ${ohne.join(", ")}`);
    // Je Hinweis eine Zeile, Datei und Grund stehen im Text des Werkzeugs (Issue #1156,
    // E12): gemeldet, nicht gewertet — die Einheit bleibt erfolgreich.
    for (const h of e.pruefung?.hinweise ?? []) {
      for (const zeile of h?.zeilen ?? []) zeilen.push(`- Issue #${e.id}: hinweis: ${zeile}`);
    }
  }
  const erreicht = pakete.filter((e) => (endlicheZahl(e.dauerMs) ?? Infinity) <= marke * 60000).length;
  zeilen.push(`- ${erreicht} von ${pakete.length} Paketen unter ${marke} Minuten.`);
  return zeilen;
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
    KETTE_BUDGET = ladeKetteBudget(ZUSTAND.config);
    KETTE_UEBERGAENGE = ladeKetteUebergaenge(ZUSTAND.config);
  } catch (e) {
    fail(e.message, "zustand");
  }
  KETTE_BUDGET_AUS_DEFAULT = ketteBudgetDefaults(ZUSTAND.config);
}

/** Dasselbe fuer den Prueflauf (Issue #909): eine kaputte Zahl ist ein Config-Fehler, kein Lauf. */
function pruefLaufBudgetLaden() {
  try {
    PRUEFLAUF_BUDGET = ladePruefLaufBudget(ZUSTAND.config);
  } catch (e) {
    fail(e.message, "zustand");
  }
  PRUEFLAUF_BUDGET_AUS_DEFAULT = pruefLaufBudgetDefaults(ZUSTAND.config);
}

// Was die Protokollzeile je Lauf-Art ueber ihren Config-Block sagen muss. Getrennt von der
// Zeile selbst, weil nur diese drei Angaben sich unterscheiden — der Satzbau nicht.
const KETTE_BUDGET_TEXT = { name: "der Kette", block: "night.kette", defaults: KETTE_BUDGET_DEFAULTS };
const PRUEFLAUF_BUDGET_TEXT = { name: "des Prueflaufs", block: "pruefLauf", defaults: PRUEFLAUF_BUDGET_DEFAULTS };

/**
 * Die Protokollzeile zu den Budgets aus den Defaults (Issue #659), `null` ohne solche.
 * Setzt der Block kein einziges Feld, sagt die Zeile das dazu: Ob er fehlt oder leer ist,
 * macht fuer den Leser keinen Unterschied — beide Male gilt kein eigener Wert.
 *
 * `text` nennt den Lauf und seinen Block (Issue #909): Kette und Prueflauf bilden dieselbe
 * Zeile, und zwei Fassungen desselben Satzes liefen bei der ersten Aenderung auseinander.
 */
function budgetDefaultsZeile(budget, ausDefault, text = KETTE_BUDGET_TEXT) {
  if (ausDefault.length === 0) return null;
  const werte = ausDefault.map((feld) => `${feld}=${budget[feld]}`).join(", ");
  const ganz = ausDefault.length === Object.keys(text.defaults).length
    ? ` — ${text.block} in .claude/workflow.config.json fehlt oder setzt kein Feld.`
    : "";
  return `Budget ${text.name} aus den Defaults: ${werte}${ganz}`;
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
  const einstellung = stufenEinstellung(ZUSTAND.config);
  if (!einstellung.aktiv) return;
  for (const stufe of STUFEN_ORDNUNG) {
    const eintrag = einstellung.stufen[stufe];
    if (!eintrag) continue;
    const { ok, grund } = stufeStartbar(eintrag, ZUSTAND.config.night?.modelle);
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
  ZUSTAND.config = ladeConfigMitOverrides(configPath);
  CONFIG_PATH = configPath;
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
  // Journal und Puls (Issue #1084): ab hier hinterlaesst der Lauf ein Lebenszeichen.
  laufstandStarten();
  // Der Waechter (Issue #1085): Stirbt der Lauf ohne Abschied, schliesst er ihn ab.
  waechterStarten();

  // Ein Lauf ohne Zahlendeckel sagt das aus (Plan #904, E9): "max null Sessions" liesse
  // offen, ob die Zahl fehlt oder keine gilt.
  const maxAngabe = args.max === null ? "max ohne Deckel" : `max ${args.max} Sessions`;
  log(`Nacht-Runner startet (Modus ${modus}, ${maxAngabe}, Modell ${args.model} (${args.modellHerkunft}), Label ${aktivesLabel}${dryRunAngabe}${yoloAngabe})`);
  // Der feste Kit-Stand (Issue #1102, A7): eine Zeile, mit der der Morgen den Lauf vom Stand
  // in seiner Arbeitskopie unterscheidet.
  kitStandMelden();
  if (args.yolo && !args.dryRun) {
    log("WARNUNG: --yolo umgeht ALLE Permission-Checks der Nacht-Sessions. Die Stop-Punkte haengen dann allein am Skill-Prompt.");
  }

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
  // Dies ist der Halt, dem kit/einstellungen.mjs dieselbe Bedingung als WARNUNG vor dem
  // Speichern gegenueberstellt (Issue #949): Die Config bleibt speicherbar, nachts
  // implementiert wird auf ihr nicht.
  if (paketstufenChecks(ZUSTAND.config).length === 0 && !args.noChecksOk) {
    fail("buildChecks in workflow.config.json traegt keine Pruefung, die beim Abschluss eines Arbeitspakets laeuft — damit hat die Umsetzung nachts kein Gate. Gezaehlt wird die Paketstufe ohne 'nichtBeimAbschluss' und ohne 'guete'-Block: Eintraege mit stufe 'push' oder 'merge' laufen erst beim Veroeffentlichen, Eintraege mit 'nichtBeimAbschluss' ebenso, und eine Guetemessung braucht die vollstaendige Testmenge. Override: --no-checks-ok", "zustand");
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
  const reviewerListe = (ZUSTAND.config.issueReview?.reviewers || [])
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
//
// Der zweite Teil ist die Regel aus `CLAUDE-workflow.md` („Keine Session endet mit
// laufender eigener Arbeit", Issue #774), fuer die Stufen-Sessions ausgeschrieben: Sie
// haben keinen Skill, der sie ihnen sagt — `/techplan`, `/issue-review` und `/issues`
// fuehren sie nicht, und die Korrektur- und Abdeckungs-Sessions laufen ohne Skill. Die
// Implementierungs-Runde bekommt den Zusatz ausdruecklich NICHT: Ihre Anweisung steht in
// `implement-next` und `implement-done`, und zwei Orte fuer dieselbe Regel liefen
// auseinander.
//
// Ausnahme ist die Abdeckungs-Session: Sie aendert nichts und gibt ihr Ergebnis als letzte
// Nachricht aus. Der Satz ueber das Board widersprach ihrem Auftrag, darum bekommt sie
// `ABDECKUNG_ZUSATZ` — dieselben Saetze ohne ihn (Issue #1106).
//
// Exportiert fuer die Tests.
export const KETTE_ZUSATZ = "Dieser Lauf ist unbeaufsichtigt: Es sieht niemand zu, und es wird nicht gefragt. "
  + "Schreibe dein Ergebnis ans Board, bevor die Session endet. "
  + "Beende deine Arbeit nicht, solange eine von dir angestossene lange Arbeit laeuft: "
  + "Warte auf ihr Ergebnis oder brich sie ab und melde den Abbruch als Fehlschlag.";
export const ABDECKUNG_ZUSATZ = "Dieser Lauf ist unbeaufsichtigt: Es sieht niemand zu, und es wird nicht gefragt. "
  + "Gib dein Ergebnis als letzte Nachricht aus, bevor die Session endet. "
  + "Beende deine Arbeit nicht, solange eine von dir angestossene lange Arbeit laeuft: "
  + "Warte auf ihr Ergebnis oder brich sie ab und melde den Abbruch als Fehlschlag.";
// Der Anker des Halt-Kommentars am Fachplan.
export const KETTE_HALT_ANKER = "## Kette angehalten";
// Die Routing-Labels der beiden entfallenen Betriebsarten: Wer sie noch setzt, bekommt
// eine Zeile im Protokoll statt einer stillen Nacht (Fachplan #635, Kriterium 12).
const ALTE_ROUTING_LABELS = ["kit:nightreview", "kit:nightplan", "kit:nightissues"];
// Unter dieser Restzeit startet keine Session mehr: Eine Minute reicht fuer keinen Plan.
const KETTE_MINDEST_REST_MS = 60 * 1000;
// Die Ausgaenge einer Stufe und einer Kette (Fachplan #635, Kriterium 2; erweitert um
// `unvollstaendig`, Issue #862). `unvollstaendig` steht zwischen `fertig` und den beiden
// Stoerungen: Die Kette lief durch, hat aber etwas Bestelltes nicht getan. Sie haelt
// niemanden auf — anders als `angehalten` wartet keine Frage auf einen Menschen —, und
// sie ist kein Fehler — anders als `abgebrochen` ist nichts schiefgegangen.
const KETTE_AUSGAENGE = ["fertig", "unvollstaendig", "angehalten", "abgebrochen"];

/**
 * Der Anfang des Grundes, den eine Kette traegt, deren bestellte Umsetzung ausblieb
 * (Issue #862) — woertlich aus dem Arbeitspaket. Exportiert fuer die Tests.
 */
export const UMSETZUNG_AUSGELASSEN_PRAEFIX = "Umsetzung ausgelassen: ";
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
].join("\n");

export function abdeckungPrompt(fachplanId, planId, paketIds) {
  const pakete = paketIds.map((id) => `#${id}`).join(", ");
  return `Du haeltst die Arbeitspakete gegen die fachliche Anforderung. Lies mit \`node .claude/kit/board.mjs issue get <nummer>\` den Fachplan #${fachplanId}, den Plan #${planId} und die Pakete ${pakete}.\n${ABDECKUNG_PROMPT}`;
}

/**
 * Der Grund, aus dem eine gekennzeichnete fachliche Anforderung nicht laeuft — `null`,
 * wenn sie laeuft.
 *
 * Die Reihenfolge ist die Antwort: Erst die Spalte (E4: ausserhalb von Backlog ist ein
 * Versehen), dann `kit:klaeren` (A2: die Antwort auf die Stopp-Frage muss vorher am
 * Fachplan stehen), dann die fehlende Pruefung (Fachplan #702), zuletzt die offenen
 * Fragen an den PO (Issue #916). Die Pruefung steht hinter `kit:klaeren`, damit ein
 * Fachplan mit offener Frage den spezifischeren Grund behaelt: Wer die Frage beantwortet,
 * kommt weiter, wer nur pruefen laesst, nicht.
 *
 * Die Praefix-Probe steht seit Issue #895 NICHT mehr hier, sondern in
 * `waehleKettenKandidaten`: Dort entscheidet sie ueber die Auftragsart, und eine Karte
 * ohne beide Praefixe bekommt dort ihren Grund. Zwei Praefix-Proben — eine je Art —
 * liefen bei der ersten Aenderung auseinander.
 */
function kettenAusschluss(issue, kettenLabel) {
  if (issue.status !== "backlog") return `steht in ${issue.status ?? "unbekannt"}, nicht in Backlog`;
  if (hatKlaerenLabel(issue)) return `traegt ${KLAEREN_LABEL} — die Antwort auf die Stopp-Frage muss vorher am Fachplan stehen, dann das Label abnehmen`;
  if (!hatReviewFertigLabel(issue)) return pruefungFehltGrund(issue.id, kettenLabel).text;
  // Zuletzt die offenen Fragen an den PO (Issue #916): Wer die Pruefung noch gar nicht
  // laufen liess, soll das zuerst erfahren; die Fragen sind der naechste Schritt danach.
  // `review:fertig` bezeugt die Pruefung durch fremde Modelle — die Reviewer duerfen die
  // PO-Fragen ausdruecklich nicht beantworten, also sagt das Label darueber nichts.
  const poFrage = offeneFragenGrund(issue?.body || "");
  if (poFrage !== null) {
    return `${poFrage}; die Fragen im Body beantworten und '## ${PO_FRAGEN_NAME}' auf 'Keine' setzen`;
  }
  return null;
}

/**
 * Der Grund, aus dem ein gekennzeichneter Plan nicht laeuft — `null`, wenn er laeuft
 * (Fachplan #883, Plan #890, E6).
 *
 * Die Reihenfolge folgt derselben Regel wie die von `kettenAusschluss`: Der
 * spezifischere Grund gewinnt, damit die Karte morgens den Satz traegt, der den
 * naechsten Schritt nennt. Erst die Spalte (ausserhalb von Backlog ist ein Versehen),
 * dann die fachliche Herkunft (ohne sie hat die Kette nichts, wogegen sie die Pakete
 * halten koennte), dann `kit:klaeren` (die Entscheidung gehoert in den Plan), dann die
 * offene Frage im Plan, zuletzt die fehlende Pruefung. Die beiden letzten stehen in
 * dieser Folge, weil wer die Frage beantwortet weiterkommt, wer nur pruefen laesst
 * nicht.
 *
 * `karten` ist die Liste aus `issue list`: Die Herkunftsnummer muss eine Karte DIESES
 * Boards treffen, zeichengleich — siehe `fachlicheQuelleVon`.
 */
export function planAusschluss(issue, kettenLabel, karten) {
  if (issue?.status !== "backlog") return `steht in ${issue?.status ?? "unbekannt"}, nicht in Backlog`;
  const quelle = fachlicheQuelleVon(issue?.body || "");
  if (quelle === null || !(karten || []).some((k) => String(k?.id) === quelle)) {
    return `die fachliche Herkunft ist nicht erkennbar — die Zeile '${HERKUNFT_FELD.plan}: Issue #N' fehlt im Plan oder nennt keine Karte dieses Boards (die Nummer wird zeichengleich verglichen, fuehrende Nullen zaehlen mit)`;
  }
  if (hatKlaerenLabel(issue)) return `traegt ${KLAEREN_LABEL} — die Entscheidung gehoert in den Plan, danach nimmt ein Mensch das Label ab`;
  const frage = stoppFragenGrund(issue?.body || "");
  if (frage !== null) {
    return `eine Entscheidung wartet: ${frage}; sie gehoert als Eintrag unter '## ${ENTSCHEIDUNGEN_NAME}' des Plans, danach traegt '## ${OFFENE_FRAGEN_NAME}' wieder '${KEINE_STOPP_FRAGEN}' — ein Satz in der fachlichen Anforderung genuegt nicht`;
  }
  if (!hatReviewFertigLabel(issue)) return pruefungFehltGrund(issue.id, kettenLabel).text;
  return null;
}

/**
 * Der Hinweis auf das Nicht-Ziel der fachlichen Anforderung #899: Der Prueflauf gilt
 * allein fachlichen Anforderungen. Er steht an jeder gekennzeichneten Karte, die keine
 * ist — am Plandokument wie am Arbeitspaket.
 */
const PRUEFLAUF_NICHT_FACHLICH = "der Prueflauf gilt allein fachlichen Anforderungen (Nicht-Ziel 'Plandokumente und Arbeitspakete')";

/**
 * Der Grund, aus dem eine gekennzeichnete Karte nicht geprueft wird — `null`, wenn sie
 * geprueft wird (Fachplan #899, Plan #904, Issue #906).
 *
 * Bewusst OHNE Spaltenbedingung, anders als `kettenAusschluss`: Ein
 * `[Fachlich]`-Dokument geht nie nach Ready, und die Geste des Menschen gilt der Karte,
 * nicht ihrem Ort. Die Reihenfolge folgt derselben Regel wie dort — der spezifischere
 * Grund gewinnt: erst das fehlende Kennzeichen (ohne die Geste steht die Karte hier gar
 * nicht zur Debatte), dann die Art der Karte (E6: ein Plandokument gehoert nie hierher,
 * auch nicht nach einer Antwort), zuletzt `kit:klaeren` — wer die wartende Frage
 * beantwortet, kommt weiter.
 */
export function pruefLaufAusschluss(issue, label) {
  if (!(issue?.labels || []).includes(label)) return `traegt das Kennzeichen ${label} nicht`;
  const titel = issue?.title ?? "";
  if (!isFachlich(titel)) {
    const art = isPlan(titel) ? "traegt [Plan]" : "traegt kein [Fachlich]";
    return `${art} — ${PRUEFLAUF_NICHT_FACHLICH}`;
  }
  if (hatKlaerenLabel(issue)) return `traegt ${KLAEREN_LABEL} — eine Entscheidung wartet auf einen Menschen, eine zweite Pruefung beantwortet sie nicht`;
  return null;
}

/**
 * Waehlt die Karten eines Prueflaufs aus allen Karten (Plan #904, E6, E9).
 *
 * Reine Funktion ueber `issue list` OHNE Status-Filter, nach dem Muster von
 * `waehleKettenKandidaten`: Was das Kennzeichen traegt, aber nicht geprueft wird, geht mit
 * Grund nach `uebersprungen` und behaelt sein Kennzeichen — abgenommen wird es erst im
 * Lauf, unmittelbar vor der Session. Kandidaten sind rohe Issues; eine Auftragsart wie bei
 * der Kette gibt es nicht, es laeuft nur eine.
 *
 * `max` darf `null` sein (E9: kein Zahlendeckel, begrenzt wird ueber die Budgets); dann
 * werden alle Kandidaten geliefert. Ab `max` bleiben sie liegen — das ist kein Ausschluss
 * und steht darum in `liegengeblieben`, nicht in `uebersprungen`.
 *
 * Nach den eigenen Gruenden steht die belegte Wurzel wie bei der Kette (Plan #1113, E8;
 * Issue #1189): Eine gekennzeichnete fachliche Anforderung ist ihre eigene Wurzel, und
 * `belegt(F)` liefert ihren lebenden Halter `{ karte, laufId }` oder `null`. Auch sie
 * verbraucht keinen Platz.
 */
export function waehlePruefLaufKandidaten(issues, label, max, { belegt = () => null } = {}) {
  const alle = (issues || []).filter((i) => (i?.labels || []).includes(label));
  const kandidaten = [];
  const uebersprungen = [];
  const liegengeblieben = [];
  const deckel = Number.isFinite(max) ? max : Infinity;
  for (const issue of alle) {
    const ausschluss = pruefLaufAusschluss(issue, label);
    const halter = ausschluss === null ? belegt(String(issue.id)) : null;
    const grund = halter ? beanspruchtGrund(halter.laufId) : ausschluss;
    if (grund !== null) uebersprungen.push({ id: String(issue.id), title: issue.title ?? "", grund });
    else if (kandidaten.length >= deckel) liegengeblieben.push({ id: String(issue.id), title: issue.title ?? "" });
    else kandidaten.push(issue);
  }
  return { kandidaten, uebersprungen, liegengeblieben };
}

/**
 * Der Fingerabdruck der geprueften Fassung eines Kartentexts (Plan #904, E7).
 *
 * Der Lauf bildet ihn unmittelbar vor der Session und nennt ihn in Liste, Protokoll und
 * Ergebnisstand. Damit steht hinterher fest, WAS geprueft wurde: Wer den Text waehrend der
 * Pruefung aendert, sieht am Fingerabdruck, dass die Pruefung eine andere Fassung gelesen
 * hat. Eine Erkennung der Aenderung selbst gibt es nicht — ein Aenderungsverlauf ist nur bei
 * zwei von vier Trackern zu haben und seine Feldform nirgends festgelegt.
 *
 * Zwoelf Hexstellen, nicht die ganzen vierundsechzig: Verglichen wird er von Menschen, und
 * innerhalb eines Laufs unterscheidet dieser Anfang jede Fassung.
 *
 * Der Laufstand gehoert nicht zur Fassung (Issue #1189): Der lokale Tracker haengt ihn an den
 * Body, und der Lauf schreibt ihn selbst zwischen Kandidatenliste und Session. Ohne den
 * Abzug nennte die Liste eine andere Fassung als die Einheit, obwohl niemand den Text
 * geaendert hat.
 */
export function pruefLaufFassung(body) {
  const ohneLaufstand = String(body ?? "")
    .split(new RegExp(`(?=${LOKALER_KOMMENTARKOPF.source})`))
    .filter((teil) => !new RegExp(`^${LOKALER_KOMMENTARKOPF.source}## Laufstand`).test(teil))
    .join("");
  return createHash("sha256").update(ohneLaufstand).digest("hex").slice(0, 12);
}

// Der Laufstand einer geprueften Karte je Ausgang (E8); alles Uebrige ist `abgebrochen`.
const PRUEFLAUF_STAND = { geprueft: "fertig", klaeren: "wartet" };

/**
 * Der Laufstand am Ende einer Karte des Prueflaufs (Plan #1113, E8; Issue #1189): `fertig`
 * bei geprueft, `wartet` bei klaeren mit der Frage, `abgebrochen` mit Grund bei
 * unvollstaendig und bei einer Karte, die der Lauf nach der Auswahl nicht mehr prueft —
 * etwa am Kostendeckel. Rueckgabe `{ zustand, text }` fuer `standSetzen`.
 */
export function pruefLaufStand({ ausgang, frage, schritt, grund }) {
  const zustand = PRUEFLAUF_STAND[ausgang] ?? "abgebrochen";
  const kopf = `Pruefung beendet: ${ausgang} um ${new Date().toISOString()}`;
  if (ausgang === "klaeren") return { zustand, text: `${kopf}\n\nWartende Entscheidung: ${ersteZeile(frage ?? "")}` };
  if (zustand === "fertig") return { zustand, text: kopf };
  const erreicht = schritt ? `, erreichter Schritt: ${schritt}` : "";
  return { zustand, text: `${kopf}${erreicht}\n\n${grund ?? "ohne Grund"}` };
}

/** Die ersten Zeilen der beiden Kommentare, die eine Pruefung an der Karte hinterlaesst. */
export const PRUEFLAUF_BEFUNDE_ANKER = "## Fachplan-Review, Runde 1";
export const PRUEFLAUF_EINARBEITUNG_ANKER = "## Einarbeitung, Runde 1";

/** Der zuletzt erreichte Schritt einer abgebrochenen Pruefung (E13) aus ihren neuen Spuren. */
function pruefLaufSchritt(neue) {
  if (neue.some((k) => k.includes(PRUEFLAUF_EINARBEITUNG_ANKER))) return "eingearbeitet";
  if (neue.some((k) => k.includes(PRUEFLAUF_BEFUNDE_ANKER))) return "befunde";
  return "gestartet";
}

/**
 * Das Ergebnis einer Prueflauf-Session am Unterschied der Board-Spuren (Plan #904, E16).
 *
 * Reine Funktion: Gelesen wird der UNTERSCHIED zwischen Vorher- und Nachher-Stand, nie der
 * Nachher-Stand allein. Eine erneut gepruefte Karte traegt Marker, `review:fertig` und den
 * Befunde-Kommentar schon aus dem Vorlauf; ohne die Beschraenkung auf neue Spuren meldete
 * die Erkennung "geprueft" fuer eine Pruefung, die nie lief.
 *
 * Marker und Label darf der Nachher-Stand trotzdem allein beantworten: Beides hat der Lauf
 * unmittelbar vor der Session selbst abgeraeumt (E16), es kann also nur aus ihr stammen.
 * Der Vorher-Stand dient allein dem Kommentar-Vergleich; seine Labels werden nicht gelesen.
 *
 * Drei Ausgaenge: `geprueft`, `klaeren` mit der wartenden Frage, sonst `unvollstaendig` mit
 * dem zuletzt erreichten Schritt.
 */
export function pruefLaufErgebnis(vorher, nachher) {
  if (hatFachplanReviewMarker(nachher?.body) && hatReviewFertigLabel(nachher)) {
    return { ausgang: "geprueft" };
  }
  const neue = neueKommentare(vorher, nachher);
  if (hatKlaerenLabel(nachher)) {
    const frage = neue.at(-1) ?? `siehe den letzten Kommentar an #${nachher?.id}`;
    return { ausgang: "klaeren", frage };
  }
  return { ausgang: "unvollstaendig", schritt: pruefLaufSchritt(neue) };
}

/**
 * Der Anker des Vermerks, den ein Abbruch des Prueflaufs an der fachlichen Anforderung
 * hinterlaesst (Plan #904, E14).
 *
 * Ein EIGENER Anker, nicht der `REVIEW_REST_ANKER` der Nacht-Kette: Der spricht von Kette,
 * Plan und Plan-Review-Marker und gehoert der Kette.
 */
export const PRUEFLAUF_REST_ANKER = "## Pruefung unvollstaendig";

/**
 * Der Vermerk an der Karte, wenn die Pruefung abbricht, nachdem sie Spuren hinterlassen hat
 * (Plan #904) — `true`, wenn er geschrieben wurde.
 *
 * Dieselbe Luecke wie bei `reviewRestVermerken`: Die Pruefung ist bezahlt, ihre Befunde
 * stehen am Board, der Body traegt keinen Marker. Wer die Karte spaeter sichtet, sieht eine
 * ungepruefte und prueft erneut.
 *
 * `spuren` sind die neuen Kommentare der Session. Eine WARTENDE Sitzung bekommt nur ihren
 * `wartendVermerk`, nicht zusaetzlich diesen Anker — ihr eigener Kommentar ist kurz zuvor an
 * die Karte gegangen (Issue #778), und zwei Kommentare fuer einen Abbruch sagen nichts, was
 * einer nicht sagt. Bleibt danach keine Spur, gibt es nichts zu vermerken.
 */
export function pruefLaufRestVermerken(id, grund, schritt, spuren = []) {
  const fremde = (spuren || []).filter((k) => !String(k).includes(WARTEND_ANKER));
  if (fremde.length === 0) return false;
  const pfad = join(tmpdir(), `night-prueflauf-rest-${process.pid}-${id}-${ZUSTAND.LAUF_STEMPEL ?? Date.now()}.md`);
  const text = [
    PRUEFLAUF_REST_ANKER,
    "",
    `Prueflauf ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}: Die Pruefung ist gelaufen, ihre Befunde stehen als Kommentar an dieser Karte.`,
    "",
    `Sie ist unvollstaendig geblieben — der Lauf endete davor (${grund}) —, zuletzt erreichter Schritt: ${schritt}. Der Body traegt deshalb keinen Fachplan-Review-Marker, obwohl geprueft wurde.`,
    "",
    `Weg nach vorn: /issue-review #${id} von Hand fahren.`,
    "",
  ].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    board("issue", "comment", String(id), "--text-file", pfad);
    log(`  Pruefung #${id} abgebrochen (${schritt}) — Vermerk '${PRUEFLAUF_REST_ANKER}' an #${id} geschrieben.`);
  } finally {
    rmSync(pfad, { force: true });
  }
  return true;
}

/** Der Grund an einer gekennzeichneten Karte, die keine der beiden Auftragsarten traegt. */
const KEINE_AUFTRAGSART_GRUND = "weder [Fachlich] noch [Plan] — das Kennzeichen gilt an der fachlichen Anforderung oder am Plandokument";

/** Die Auftragsart am Titel-Praefix — `null`, wenn die Karte keine der beiden traegt. */
function auftragsartVon(titel) {
  if (isPlan(titel)) return "plan";
  if (isFachlich(titel)) return "fachplan";
  return null;
}

/**
 * Der Auftrag zu einer Karte: Wurzel und Plannummer stehen je Art woanders.
 *
 * Beim Fachplan-Auftrag ist die Karte selbst die Wurzel und es gibt keinen Plan; beim
 * Plan-Auftrag kommt die Wurzel aus der Herkunftszeile — dass sie dort steht und eine
 * Karte des Boards trifft, hat `planAusschluss` schon geprueft.
 */
function auftragAus(issue, art) {
  return art === "plan"
    ? { karte: issue, art, F: fachlicheQuelleVon(issue.body || ""), planId: String(issue.id) }
    : { karte: issue, art, F: String(issue.id), planId: null };
}

/**
 * Der Grund, aus dem ein Auftrag einer anderen Karte weicht — `null`, wenn er bleibt
 * (Issue #895).
 *
 * Beide Kollisionen haengen am selben Wert: dem juengsten gekennzeichneten Plan zur
 * Wurzel des Auftrags. Eine Anforderung weicht ihm immer, ein Plan nur einem juengeren
 * als er selbst.
 */
function kollisionsGrund(auftrag, juengster) {
  if (juengster === null) return null;
  if (auftrag.art === "fachplan") {
    return `zu dieser Anforderung ist Plan #${juengster.id} gekennzeichnet — er laeuft an ihrer Stelle, ein zweiter Plan entstuende sonst daneben`;
  }
  if (juengster.id !== auftrag.planId) {
    return `zur fachlichen Quelle #${auftrag.F} ist ein juengerer Plan gekennzeichnet — #${juengster.id} laeuft an seiner Stelle`;
  }
  return null;
}

/**
 * Waehlt die Ketten einer Nacht aus allen Karten (Plan #638, A2, A13, E4, W5; zwei
 * Auftragsarten seit Fachplan #883, Plan #890, Issue #895).
 *
 * Reine Funktion ueber `issue list` OHNE Status-Filter: Was das Label traegt, aber nicht
 * laufen darf, geht mit Grund in `uebersprungen` — im Ergebnisstand sichtbar, das Label
 * bleibt stehen. Kandidaten laufen in Listenreihenfolge; ab `max` bleiben sie liegen.
 *
 * Ein Kandidat ist seit #895 kein rohes Issue mehr, sondern ein Auftrag
 * `{ karte, art, F, planId }`: `art` kommt aus dem Titel-Praefix, `F` ist immer die
 * fachliche Wurzel (beim Plan-Auftrag aus `fachlicheQuelleVon`, sonst die Karte selbst),
 * `planId` nur beim Plan-Auftrag. Die Kette braucht beide Nummern — die gekennzeichnete
 * Karte fuer Label und Einheit, die Wurzel fuer Abdeckung und Bericht.
 *
 * Die Kollisionen stehen zwischen Ausschluss und `max` (Kriterium 10 der fachlichen
 * Quelle): Eine Karte, die einer anderen weicht, soll keinen der knappen Plaetze
 * verbrauchen. Massgeblich fuer beide Regeln ist die Menge der GEKENNZEICHNETEN Plaene,
 * nicht die der laufenden — das Kennzeichen hat der Mensch gesetzt, und eine Anforderung
 * soll auch dann nicht ersatzweise neu geplant werden, wenn der Plan daneben an einer
 * eigenen Voraussetzung scheitert.
 *
 * Vor den Kollisionen steht die belegte Wurzel (Plan #1113, E7; Issue #1188): `belegt(F)`
 * liefert den lebenden Halter `{ karte, laufId }` oder `null`, wie `wurzelBelegt`. Auch sie
 * verbraucht keinen Platz.
 */
export function waehleKettenKandidaten(issues, label, max, { belegt = () => null } = {}) {
  const alle = (issues || []).filter((i) => (i?.labels || []).includes(label));
  const gruende = new Map();
  const auftraege = [];

  // Jeder gekennzeichnete Plan mit erkennbarer Wurzel, unabhaengig von seinem Ausschluss.
  const gekennzeichnetePlaene = alle
    .filter((i) => isPlan(i?.title ?? ""))
    .map((i) => ({ id: String(i.id), F: fachlicheQuelleVon(i?.body || "") }))
    .filter((p) => p.F !== null);
  /** Der juengste gekennzeichnete Plan zu einer Wurzel — `null`, wenn es keinen gibt. */
  const juengsterPlanZu = (F) => gekennzeichnetePlaene
    .filter((p) => p.F === F)
    .sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;

  for (const issue of alle) {
    const art = auftragsartVon(issue?.title ?? "");
    if (art === null) {
      gruende.set(String(issue.id), KEINE_AUFTRAGSART_GRUND);
      continue;
    }
    const grund = art === "plan" ? planAusschluss(issue, label, issues || []) : kettenAusschluss(issue, label);
    if (grund === null) auftraege.push(auftragAus(issue, art));
    else gruende.set(String(issue.id), grund);
  }

  const kandidaten = [];
  const liegengeblieben = [];
  for (const auftrag of auftraege) {
    const id = String(auftrag.karte.id);
    const halter = belegt(auftrag.F);
    const kollision = kollisionsGrund(auftrag, juengsterPlanZu(auftrag.F));
    if (halter) gruende.set(id, beanspruchtGrund(halter.laufId));
    else if (kollision !== null) gruende.set(id, kollision);
    else if (kandidaten.length >= max) liegengeblieben.push({ id, title: auftrag.karte.title ?? "" });
    else kandidaten.push(auftrag);
  }

  // `uebersprungen` in Board-Reihenfolge, nicht in der Reihenfolge der beiden Durchgaenge:
  // Wer morgens das Protokoll liest, liest es neben dem Board.
  const uebersprungen = alle
    .filter((i) => gruende.has(String(i.id)))
    .map((i) => ({ id: String(i.id), title: i.title ?? "", grund: gruende.get(String(i.id)) }));
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
  if (ZUSTAND.config.issueTracker !== "local") return;
  const pfad = join(wt, ".claude", "workflow.config.json");
  if (!existsSync(pfad)) return;
  const wtConfig = JSON.parse(readFileSync(pfad, "utf-8"));
  wtConfig.local = { ...wtConfig.local, issuesDir: resolve(repoRoot, ZUSTAND.config.local?.issuesDir || "issues") };
  writeFileSync(pfad, JSON.stringify(wtConfig, null, 2) + "\n", "utf-8");
}

/**
 * Die eine Stufe ohne Erkennung der wartenden Sitzung (Issue #778).
 *
 * Der Schlusstext der Abdeckung ist kein Abschlussbericht, sondern das Arbeitsergebnis
 * selbst: `stufeAbdeckung` liest ihn mit `leseErgebnisText` als Befundliste ein, und bei
 * einem anderen Ausgang als `fertig` faellt der Befund weg. Ein Befundsatz wie
 * "Kriterium 3: Ergebnis steht noch aus" traefe die Musterliste und liesse die Stufe als
 * wartend abbrechen — der Befund waere verworfen, und zwar genau dann, wenn er etwas zu
 * sagen hat.
 */
const STUFE_OHNE_WARTEND_ERKENNUNG = "abdeckung";

/**
 * Der Vermerk einer wartenden Stufen-Session am Dokument ihrer Stufe (Issue #778).
 *
 * Derselbe Text wie am Arbeitspaket — `wartendVermerk` ist die eine Fassung —, nur OHNE
 * die Pfade aus `gitReste()`: Die Stufen-Session arbeitet im Worktree der Kette, und die
 * Reste der Hauptkopie sagten ueber sie nichts.
 *
 * Ueber eine Datei wie `reviewRestVermerken`, und aus demselben Grund: Der Vermerk traegt
 * bis zu 2.000 Zeichen fremden Schlusstext, und der geht nicht als Argument an eine
 * Kommandozeile.
 */
function wartendVermerken(dokId, stufe, schlusstext) {
  const pfad = join(tmpdir(), `night-wartend-${process.pid}-${dokId}-${ZUSTAND.LAUF_STEMPEL ?? Date.now()}.md`);
  writeFileSync(pfad, wartendVermerk(schlusstext), "utf-8");
  try {
    board("issue", "comment", String(dokId), "--text-file", pfad);
    log(`  Stufe ${stufe}: ${GRUND_WARTEND} — Vermerk '${WARTEND_ANKER}' an #${dokId} geschrieben.`);
  } finally {
    rmSync(pfad, { force: true });
  }
}

/**
 * Ob eine Stufen-Session als wartend endet — und wenn ja, mit Vermerk am Dokument der Stufe.
 *
 * Klingt der Schlusstext nach Warten, entscheidet `ergebnisDa` (Issue #1207): Liegt das
 * Ergebnis der Stufe vor, endet die Session nicht als wartend, und eine Protokollzeile
 * sagt, dass der Schlusstext nach Warten klang.
 */
function wartendBeendet(stufe, schlusstext, dokId, ergebnisDa) {
  if (stufe === STUFE_OHNE_WARTEND_ERKENNUNG || !wartendeSession(schlusstext)) return false;
  if (ergebnisDa?.()) {
    log(`  Stufe ${stufe}: Schlusstext klang nach Warten, das Ergebnis liegt aber vor — die Session gilt als fertig.`);
    return false;
  }
  if (dokId) wartendVermerken(dokId, stufe, schlusstext);
  return true;
}

/**
 * Eine Session der Kette mit Zeit- und Kostenbudget (Plan #638, A5, A6).
 *
 * `stufeStart` und `budgetMs` beschreiben die Stufe: Jede Session bekommt als Timeout,
 * was von der Stufe noch uebrig ist — Korrekturrunden zaehlen gegen dieselbe Stufe.
 * Nach der Session werden die Kosten addiert und gegen das Kettenbudget gehalten; ein
 * Ueberschreiten endet NACH der Session, nicht mittendrin (ein halb geschriebenes
 * Dokument waere der teurere Fehler). Rueckgabe: `{ ausgang, grund, dauerMs, kennzahlen, res }`.
 *
 * `dokId` ist das Dokument der Stufe — der Fachplan, solange es keinen Plan gibt, sonst
 * der Plan oder das Paket in der Formpruefung. Nur eine wartende Sitzung braucht es
 * (Issue #778); eine Stufe ohne Dokument uebergibt nichts und bekommt keinen Vermerk.
 *
 * `ergebnisDa` prueft, ob das Ergebnis der Stufe nach der Session vorliegt (Issue #1207).
 * Aufgerufen wird es nur, wenn der Schlusstext nach Warten klingt: Das Ergebnis ist ein
 * Beleg, der Schlusstext nur ein Indiz. Liefert es `true`, endet die Session `fertig`,
 * ohne Vermerk am Dokument.
 */
async function ketteSession(kette, stufe, prompt, stufeStart, budgetMs, dokId = null, ergebnisDa = null) {
  const rest = budgetMs - (Date.now() - stufeStart);
  if (rest < KETTE_MINDEST_REST_MS) {
    return { ausgang: "abgebrochen", grund: `Zeitbudget ${stufe} erschoepft, bevor eine weitere Session starten konnte`, dauerMs: 0, kennzahlen: null, sitzungsAbbruch: true };
  }
  const t = Date.now();
  const res = await runSession(kette.F, kette.args, {
    prompt: `${prompt}\n\n${stufe === "abdeckung" ? ABDECKUNG_ZUSATZ : KETTE_ZUSATZ}`, cwd: kette.wt, stream: true, stufe, timeoutMs: rest,
  });
  const dauerMs = Date.now() - t;
  const minuten = (dauerMs / 60000).toFixed(1);
  const kennzahlen = leseKennzahlen(res.stdout);
  kostenAddieren(kette.kosten, kennzahlen);
  if (ZUSTAND.LAUF) kostenAddieren(ZUSTAND.LAUF, kennzahlen);
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  if (timedOut) {
    return { ausgang: "abgebrochen", grund: `Zeitbudget ${stufe}: die Session wurde nach ${minuten} min am Limit beendet`, dauerMs, kennzahlen, sitzungsAbbruch: true };
  }
  if (res.umgebungGescheitert) laufAnhalten(`Sitzungsstart der Stufe ${stufe} zu #${kette.F} auch im 2. Versuch gescheitert (${exitText(res)})`);
  if (res.error || res.status !== 0) {
    const exitInfo = exitText(res);
    return { ausgang: "abgebrochen", grund: `technischer Fehler: die Session der Stufe ${stufe} endete mit ${exitInfo}`, dauerMs, kennzahlen, sitzungsAbbruch: true };
  }
  // Die wartende Sitzung (Plan #773, Issue #778) — hinter Zeitbudget und technischem
  // Fehler, weil sie ein REGULAERES Ende verfeinert: Die Session hat eine lange Arbeit
  // angestossen, darauf gewartet und damit ihren Zug beendet. Ohne diesen Zweig zaehlte
  // sie als `fertig`, obwohl sie nichts hinterlassen hat.
  //
  // Vor dem Kostendeckel, weil der Grund der konkretere ist: Eine Kette, die beides
  // zugleich erreicht, soll morgens den Fall benennen und nicht den Betrag.
  if (wartendBeendet(stufe, leseErgebnisText(res.stdout), dokId, ergebnisDa)) {
    // `wartend` reist am Ergebnis mit, statt ueber den Modul-Merker WARTEND_BEENDET zu
    // laufen: Der gehoert einer Implementierungs-RUNDE und wird vor jeder zurueckgesetzt
    // — unter Variante B saehe die Ketten-Einheit sonst den Befund einer Paket-Session.
    return { ausgang: "abgebrochen", grund: GRUND_WARTEND, wartend: true, dauerMs, kennzahlen };
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
  const summe = (s) => { stand.dauerMs += s.dauerMs; stand.kennzahlen = kennzahlenAddieren(stand.kennzahlen, s.kennzahlen); };

  const vorher = new Set(board("issue", "list").map((i) => String(i.id)));
  log(`  Stufe plan: /techplan #${F} (Budget ${budget.planMin} min).`);
  // Das Ergebnis ist die Herkunftszeile, nicht der Session-Text (E2): nur neue
  // [Plan]-Karten mit `Fachliche Quelle: Issue #F`; bei mehreren die hoechste Nummer.
  const neuePlaene = () => board("issue", "list")
    .filter((i) => !vorher.has(String(i.id)) && stammtAusErzeugung(i, F, "plan"))
    .sort((a, b) => Number(b.id) - Number(a.id));
  // Dokument der Stufe ist der Fachplan: Der Plan entsteht erst in dieser Session.
  const s = await ketteSession(kette, "plan", `/techplan #${F}`, stufeStart, budgetMs, F, () => neuePlaene().length > 0);
  summe(s);
  if (s.ausgang !== "fertig") return s;

  const neue = neuePlaene();
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
    const form = boardRoh("issue", "check-form", stand.id, { cwd: kette.wt });
    if (!form.json) return { ausgang: "abgebrochen", grund: `technischer Fehler: check-form #${stand.id} lieferte kein JSON (${form.text.slice(0, 200)})` };
    // I8 ist kein Korrekturfall (Plan #987, E15): Die geschuetzte Datei verlangt eine
    // [Mensch]-Karte und eine Teilung, und der korrekturPrompt verbietet beides. Der Verstoss
    // steht im Protokoll, die Karte laeuft ins Gate der Umsetzungsstufe.
    const geschuetzt = (form.json.verstoesse || []).filter((v) => v.gate === "I8");
    const zuKorrigieren = (form.json.verstoesse || []).filter((v) => v.gate !== "I8");
    if (geschuetzt.length > 0) {
      const meldungen = geschuetzt.map((v) => `${v.gate}: ${v.meldung}`).join("; ");
      log(`  Formpruefung #${stand.id}: ${meldungen} — kein Korrekturfall, das Paket haelt in der Umsetzungsstufe an.`);
    }
    if (form.json.ok || zuKorrigieren.length === 0) {
      log(`  Formpruefung #${stand.id} gruen.`);
      // Nur Eintraege mit Baustein und Test sind Testhinweise; Abhaengigkeits-Hinweise der
      // Pakete (Plan #1057 E4) tragen keine und bleiben hier ohne Kommentar (Issue #1059).
      testhinweiseVermerken(stand.id, (form.json.hinweise || []).filter((h) => h.baustein && h.test));
      return null;
    }
    const verstoesse = zuKorrigieren.map((v) => `${v.gate}: ${v.meldung}`).join("; ");
    if (stand.korrekturrunden >= budget.korrekturrunden) {
      return { ausgang: "abgebrochen", grund: `Form nach ${stand.korrekturrunden} Korrekturrunde(n) weiterhin verletzt (#${stand.id}): ${verstoesse}` };
    }
    stand.korrekturrunden++;
    log(`  Formpruefung #${stand.id} rot (${verstoesse}) — Korrekturrunde ${stand.korrekturrunden} von ${budget.korrekturrunden}.`);
    const k = await ketteSession(kette, "form", korrekturPrompt(stand.id, zuKorrigieren), stufeStart, budgetMs, stand.id);
    summe(k);
    if (k.ausgang !== "fertig") return k;
    if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  }
}

/** Der Anker des Kommentars mit den Testhinweisen, die nach der Planungssitzung stehen bleiben. */
export const TESTHINWEIS_ANKER = "## Testhinweise der Formpruefung";

/**
 * Die Testhinweise der Formpruefung als Kommentar am Plan (Issue #1033, Plan #1029 A10, E1).
 *
 * Nachts reagiert die planende Sitzung selbst auf die Hinweise; was danach stehen bleibt,
 * schreibt der Runner an den Plan — nicht die Sitzung, damit der Kommentar nicht an ihrer
 * Disziplin haengt. Ein Hinweis haelt nichts an: Scheitert das Kommentieren, steht das im
 * Protokoll, und die Kette laeuft weiter. Pakete koennen Abhaengigkeits-Hinweise tragen
 * (Plan #1057 E4); die sind keine Testhinweise und werden hier nicht vermerkt — der Aufrufer
 * reicht nur Eintraege mit `baustein` und `test` weiter (Issue #1059).
 */
function testhinweiseVermerken(dokId, hinweise) {
  if (!Array.isArray(hinweise) || hinweise.length === 0) return;
  const pfad = join(tmpdir(), `night-testhinweise-${process.pid}-${dokId}-${ZUSTAND.LAUF_STEMPEL ?? Date.now()}.md`);
  const text = [TESTHINWEIS_ANKER, "", ...hinweise.map((h) => `- ${h.meldung}`), ""].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    const res = boardRoh("issue", "comment", dokId, "--text-file", pfad);
    if (res.status === 0) log(`  ${hinweise.length} Testhinweis(e) als Kommentar '${TESTHINWEIS_ANKER}' an Plan #${dokId} geschrieben.`);
    else log(`  Testhinweise an Plan #${dokId} nicht geschrieben (${res.text.slice(0, 200)}) — die Kette laeuft weiter.`);
  } finally {
    rmSync(pfad, { force: true });
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
  const pfad = join(tmpdir(), `night-review-rest-${process.pid}-${planId}-${ZUSTAND.LAUF_STEMPEL ?? Date.now()}.md`);
  const text = [
    REVIEW_REST_ANKER,
    "",
    `Kette ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}, Stufe review: Die Pruefung ist gelaufen, ihre Befunde stehen als Kommentar an diesem Dokument.`,
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
  // Ergebnis der Stufe ist eine Marker-Zeile, die nach der Session da und anders als vorher
  // ist — neu oder mit neuem Datum (Issue #1207). Das Label `review:fertig` taugt dafuer
  // nicht: Es kann von einer frueheren Pruefung stehen.
  const markerNeu = () => {
    const wert = planReviewWert(board("issue", "get", planId).body);
    return wert !== null && wert !== planReviewWert(vorher.body);
  };
  const s = await ketteSession(kette, "review", `/issue-review #${planId}`, Date.now(), budget.reviewMin * 60 * 1000, planId, markerNeu);
  stand.dauerMs = s.dauerMs;
  stand.kennzahlen = s.kennzahlen;
  if (s.ausgang !== "fertig") {
    // Auch beim Abbruch wird nachgesehen, was in der bezahlten Zeit entstanden ist.
    const rest = board("issue", "get", planId);
    stand.marker = hatPlanReviewMarker(rest.body);
    // Der eigene Vermerk der wartenden Sitzung zaehlt hier nicht (Issue #778): Er ist in
    // genau diesem Zweig kurz zuvor an den Plan gegangen, und ohne den Ausschluss
    // behauptete die Spur daneben, es lägen Reviewer-Befunde am Dokument.
    const fremde = neueKommentare(vorher, rest).filter((k) => !String(k).includes(WARTEND_ANKER));
    if (!stand.marker && fremde.length > 0) reviewRestVermerken(kette, planId, s.grund);
    return s;
  }
  if (kostenErschoepft(kette)) return kostenErschoepft(kette);
  const nachher = board("issue", "get", planId);
  stand.marker = hatPlanReviewMarker(nachher.body);
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
  const summe = (s) => { stand.dauerMs += s.dauerMs; stand.kennzahlen = kennzahlenAddieren(stand.kennzahlen, s.kennzahlen); };

  const vorherIds = new Set(board("issue", "list").map((i) => String(i.id)));
  const vorherPlan = board("issue", "get", planId);
  log(`  Stufe pakete: /issues #${planId} (Budget ${budget.paketeMin} min).`);
  const paketeEntstanden = () => board("issue", "list").some((i) => !vorherIds.has(String(i.id)) && stammtAusErzeugung(i, planId, "issue"));
  const s = await ketteSession(kette, "pakete", `/issues #${planId}`, stufeStart, budgetMs, planId, paketeEntstanden);
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
  const einheit = ZUSTAND.LAUF?.einheiten.findLast((e) => e.id === String(id));
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
      const einheit = ZUSTAND.LAUF?.einheiten.findLast((e) => e.id === String(id));
      stand.umgesetzt.push({
        id, stufe: einheit?.stufe ?? null, stufeVerwendet: einheit?.stufeVerwendet ?? null, modell: einheit?.modell ?? null,
        effort: einheit?.effort ?? null,
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

/** Die nicht begonnenen Pakete ueber alle Ketten des Laufs — fuer die Schlusszeile (Issue #1170). */
let NICHT_BEGONNEN_GESAMT = 0;

/** Fuehrt Pakete als nicht begonnen mit ihrem Grund — im Bericht und im Protokoll. */
function paketeNichtBegonnen(stand, ids, grund) {
  for (const id of ids) {
    stand.nichtBegonnen.push({ id: String(id), grund });
    NICHT_BEGONNEN_GESAMT++;
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
 * Der Vermerk am Paket, das auf einen Push wartet (Issue #1170) — sonst saehe der Mensch am
 * Board nur ein ausgelassenes Paket. Je Lauf hoechstens einer: Traegt der letzte Kommentar
 * der Karte schon denselben Vermerk, liefert die Funktion `null`.
 */
export function pushVermerk(karte, verweise) {
  const text = `Nachtlauf: Paket wartet auf einen Push (${verweise}). Nach \`push main\` kann es nach Ready gezogen werden.`;
  return kommentareVon(karte).at(-1)?.trim() === text ? null : text;
}

/** Schreibt den Push-Vermerk an die Karte; ein Fehlschlag haelt den Lauf nicht an. */
function wartenAmBoardVermerken(karte, verweise) {
  const text = pushVermerk(karte, verweise);
  if (text === null) return;
  const res = boardRoh("issue", "comment", String(karte.id), "--text", text);
  if (res.status !== 0) log(`  Paket #${karte.id}: Push-Vermerk nicht geschrieben (${res.text.slice(0, 200)}) — bitte morgens sichten.`);
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
    // Am Board wie im Einzellauf (E9, E14), nur ohne Move — das Paket steht schon in
    // Backlog. Der Bericht fuehrt es zusaetzlich als nicht begonnen.
    if (gate.art === "geschuetzt") {
      log(gate.log);
      geschuetztAmBoardVermerken(karte, gate);
    } else if (gate.unmet) {
      const text = gate.block ? `${gate.kommentar}\n\n${gate.block}` : gate.kommentar;
      const res = boardRoh("issue", "comment", id, "--text", text);
      if (res.status !== 0) log(`  Paket #${id}: Abhaengigkeits-Kommentar nicht geschrieben (${res.text.slice(0, 200)}) — bitte morgens sichten.`);
    }
    paketeNichtBegonnen(lauf.stand, [id], gate.kommentar.replace(/^Nachtlauf:\s*/, ""));
    return null;
  }
  // Wartet das Paket auf einen Push (Issue #1104), zieht die Kette es nicht nach Ready: Es
  // bleibt sichtbar wartend in Backlog, und Pakete, die von ihm abhaengen, fallen ueber
  // ihre Gates von selbst heraus.
  const push = wartetAufPush(karte.body);
  if (push.length > 0) {
    const verweise = push.map((n) => "Issue #" + n).join(", ");
    paketeNichtBegonnen(lauf.stand, [id], `wartet auf einen Push (${verweise})`);
    wartenAmBoardVermerken(karte, verweise);
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
  if (ausgang === "angehalten") {
    lauf.stand.angehalten.push(id);
    // Die Art je Paket (Issue #1050): Stufengrund und Bericht nennen sie.
    lauf.stand.haltArten[id] = HALT_ART ?? "klaeren";
  }
  return ausgang === "hardStop" ? `Stufe umsetzung: harter Stopp in der Runde zu Paket #${id}` : null;
}

/**
 * Der Stufengrund einer Umsetzung mit angehaltenen Paketen, je Art des Halts (Issue #1050,
 * E12) — dazu die Art der Stufe: `klaeren`, sobald ein Paket an einer Stopp-Frage haelt,
 * sonst `geschuetzt`. Ein Paket ohne vermerkte Art (Stand von vor #1050) zaehlt als
 * Stopp-Frage, wie es damals verbucht wurde.
 */
export function umsetzungHaltGrund(stand) {
  const art = (id) => stand.haltArten?.[id] ?? "klaeren";
  const teile = [];
  for (const [a, text] of [["klaeren", "haelt an einer Stopp-Frage"], ["geschuetzt", "haelt an einer geschuetzten Datei"]]) {
    const ids = stand.angehalten.filter((id) => art(id) === a);
    if (ids.length > 0) teile.push(`${ids.map((id) => "#" + id).join(", ")} ${text}`);
  }
  return {
    grund: `Stufe umsetzung: ${teile.join("; ")}`,
    haltArt: stand.angehalten.some((id) => art(id) === "klaeren") ? "klaeren" : "geschuetzt",
  };
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
 * Pakete stehen als nicht begonnen im Bericht), `unvollstaendig` bei einem Umsetzungs-Lock,
 * der bis zum Ende des Umsetzungsbudgets gehalten blieb (Issue #696, #1185, der Rueckfall
 * auf Variante A), und bei einer unsauberen
 * Hauptkopie vor dem ersten Paket (Issue #878, derselbe Rueckfall) — beide liefen gar
 * nicht erst an, siehe `umsetzungAusgelassen` (Issue #862) —, `angehalten` bei mindestens
 * einem angehaltenen Paket — aber ohne `haltAmAuftrag` (E17) —, `abgebrochen` nur beim
 * harten Stopp.
 */
/**
 * Die Stufe umsetzung hat ihre Arbeit ausgelassen (Issue #862) — der gemeinsame Ausgang
 * der beiden Rueckfaelle auf Variante A: gehaltener Lock und unsaubere Hauptkopie.
 *
 * Beide sind aus Sicht des Menschen derselbe Befund: Er hat abends "zieh die Pakete gleich
 * durch" bestellt, und die Bestellung wurde nicht ausgefuehrt. Sie auseinanderzuziehen
 * ergaebe zwei Wahrheiten ueber eine Lage; was sie unterscheidet, steht im `grund`.
 *
 * `stand.ausgelassen` ist der Befund fuer den Bericht — nur daran, nicht an einer leeren
 * `umgesetzt`-Liste, ist "gar nicht erst gelaufen" von "gelaufen und nichts geschafft" zu
 * unterscheiden.
 */
function umsetzungAusgelassen(kette, stand, paketIds, stufeStart, grund, zusatz = "") {
  paketeNichtBegonnen(stand, paketIds, grund);
  stand.ausgelassen = grund;
  stand.dauerMs = Date.now() - stufeStart;
  log(`  Stufe umsetzung ausgelassen: ${grund} — Rueckfall auf Variante A, die Pakete bleiben in Backlog.${zusatz}`);
  return { ausgang: "unvollstaendig", grund: `${UMSETZUNG_AUSGELASSEN_PRAEFIX}${grund}` };
}

async function stufeUmsetzung(kette, paketIds) {
  const { budget } = kette;
  const stufeStart = Date.now();
  const stand = { umgesetzt: [], angehalten: [], haltArten: {}, zurueckgestellt: [], nichtBegonnen: [], dauerMs: 0 };
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
  // Belegt wartet die Kette im Rahmen ihres Umsetzungsbudgets darauf (E10).
  const lock = await aufUmsetzungWarten({
    nehmen: () => umsetzungLockNehmen(kette.repoRoot),
    jetzt: Date.now,
    schlafen: (ms) => new Promise((r) => setTimeout(r, ms)),
    budgetMs: lauf.budgetMs,
    standSetzen: (zustand, text) => ketteStand(kette, zustand, text),
  });
  if (!lock.ok) return umsetzungAusgelassen(kette, stand, paketIds, stufeStart, lock.grund);
  if (lock.hinweis) log(`  ${lock.hinweis}`);

  try {
    if (kette.wt) {
      befundeZurueckUndVorschlagen(kette);
      worktreeEntfernen(kette.wt, kette.repoRoot);
      kette.wt = null;
      log(`  Worktree abgebaut — die Stufe umsetzung baut in der Hauptkopie ${kette.repoRoot}.`);
    }
    // Variante B baut in der Hauptkopie: Auch dort arbeiten die Sessions mit dem festen
    // Kit-Stand (Issue #1102, A3). Die Markierung ist vom Sauberkeits-Guard ausgenommen.
    kitStandInBaum(kette.repoRoot);
    log(`  Stufe umsetzung: ${paketIds.length} Paket(e) (Budget ${budget.umsetzungMin} min, Kostendeckel ${kettenKostendeckel(kette)} $).`);

    // Einmal vor dem ersten Paket: Was die Sessions selbst hinterlassen, pruefen danach
    // Rest-Guard und Dirty-Guard in `werteRunde`.
    //
    // Ausgang `unvollstaendig` wie beim gehaltenen Lock darueber (Issue #878, #862): Eine
    // unsaubere Hauptkopie ist kein technischer Fehler, sondern ein Zustand, den nur ein
    // Mensch bereinigen kann. Die Arbeitspakete stehen fertig da, sie lassen sich heute
    // nacht nur nicht bauen — derselbe Rueckfall auf Variante A, und derselbe Ausgang.
    if (!gitClean(kette.repoRoot)) {
      const grund = `die Hauptkopie ist vor dem ersten Paket nicht sauber (${resteText(gitReste(kette.repoRoot))})`;
      return umsetzungAusgelassen(kette, stand, paketIds, stufeStart, grund,
        " Bitte bereinigen und die Pakete selbst nach Ready ziehen.");
    }

    let ergebnis;
    try {
      ergebnis = await umsetzungSchleife(kette, paketIds, lauf);
    } finally {
      // Auch nach einem Wurf: Die Rueckstellpflicht ist der Grund fuer dieses finally.
      paketeAbschliessen(stand, lauf.gezogen);
      stand.dauerMs = Date.now() - stufeStart;
      for (const zeile of pruefBericht(lauf.pruefungen, ZUSTAND.LAUF?.einheiten ?? [], ZUSTAND.config?.night?.zielUmsetzungMin)) log(`  ${zeile}`);
    }
    if (ergebnis.ausgang === "fertig" && stand.angehalten.length > 0) {
      // Das kit:klaeren traegt bereits das Paket; ein zweites am Fachplan schloesse ihn aus
      // `waehleKettenKandidaten` aus und blockierte die naechste Kette (E17).
      return { ausgang: "angehalten", ...umsetzungHaltGrund(stand), ohneHaltAmFachplan: true };
    }
    return ergebnis;
  } finally {
    // Auch nach einem Wurf aus der Stufe heraus: Ein liegengebliebener Lock haelt die
    // naechste Nacht ab, bis sein Prozess als tot erkannt wird.
    lock.freigeben();
    kitStandAbgeben(kette.repoRoot);
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
    board("issue", "comment", id, "--text", `${anker} (Kette ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}). Die naechste Kette begann von vorn; dieser Entwurf bleibt nur als Verlauf.`);
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
 * Der Weg nach vorn im Halt-Kommentar: die Schritte, nach denen der Plan am naechsten
 * Abend als Plan-Auftrag wieder anlaeuft (Issue #896).
 *
 * Der Ort der Entscheidung ist seit Issue #895 der Plan, nicht die fachliche Anforderung:
 * Die naechste Kette uebernimmt das Dokument und faehrt von der Stufe `pakete` an weiter,
 * statt von vorn zu beginnen. Die Schritte nennen darum genau die Form, die
 * `planAusschluss` wieder durchlaesst.
 *
 * Der frueher hier stehende Satz "Antwort bitte in den Fachplan schreiben" fuehrte an
 * diesem Weg vorbei — und der naheliegende Griff, die Antwort unter die Frage zu setzen,
 * war der teuerste: `stoppFragenGrund` liest die erste nichtleere Zeile unter `## Offene
 * Fragen` und liesse den Plan allein bei `- Keine.` durch. Der Antworttext selbst waere
 * am naechsten Abend der Ausschlussgrund gewesen.
 *
 * `/issue-review` entfaellt beim Plan-Auftrag: Dort traegt der Plan sein
 * `review:fertig` schon, sonst haette `planAusschluss` ihn nie als Auftrag durchgelassen.
 */
function haltWegNachVorn(kette, planId) {
  const P = `Plan #${planId}`;
  const schritte = [
    `1. Die Antwort als Eintrag unter '## ${ENTSCHEIDUNGEN_NAME}' von ${P} schreiben.`,
    `2. '## ${OFFENE_FRAGEN_NAME}' von ${P} wieder auf '${KEINE_STOPP_FRAGEN}' setzen (ein Zusatz dahinter ist erlaubt).`
      + " Die Antwort gehoert NICHT in diesen Abschnitt: Dort liest die naechste Kette sie als weitere offene Frage und ueberspringt den Plan.",
  ];
  if (kette.art !== "plan") schritte.push(`3. /issue-review #${planId} laufen lassen.`);
  schritte.push(
    `${schritte.length + 1}. ${KLAEREN_LABEL} an ${P} abnehmen — und an der fachlichen Anforderung #${kette.F}, wenn es dort noch haengt.`,
    `${schritte.length + 2}. Zuletzt das Label ${kette.budget.label} an ${P} setzen.`,
  );
  return [
    `Die Entscheidung gehoert in ${P}, nicht in die fachliche Anforderung #${kette.F}: Die naechste Kette nimmt den Plan als Auftrag und faehrt von der Stufe pakete an weiter. Der Weg nach vorn:`,
    "",
    ...schritte,
    "",
    "Bis dahin geschnittene Pakete bleiben als Entwurf stehen.",
  ];
}

/**
 * Der Halt der Kette (Plan #638, A8): die eine Frage als Kommentar an der gekennzeichneten
 * Karte und kit:klaeren dort. Der Plan bleibt als Entwurf stehen. Das Label abnehmen darf
 * nur der Mensch — dieselbe Regel wie im Implementierungslauf.
 *
 * Adressat ist die Karte, die das Kennzeichen trug (Issue #896), nicht die Wurzel: Beim
 * Plan-Auftrag ist das der Plan selbst, und ein `kit:klaeren` an der fachlichen
 * Anforderung sperrte dort eine Karte, die diese Nacht nichts beauftragt hat.
 */
function haltAmAuftrag(kette, ergebnis) {
  const ziel = String(kette.karte.id);
  // Bei jedem `angehalten` steht der Plan schon fest: Die Stufe `plan` setzt ihre Nummer,
  // bevor sie an einer Stopp-Frage halten kann, und der Plan-Auftrag bringt sie mit.
  const planId = kette.stufen.plan?.id ?? ergebnis.dokId;
  const pfad = join(tmpdir(), `night-halt-${process.pid}-${ziel}-${ZUSTAND.LAUF_STEMPEL ?? Date.now()}.md`);
  const text = [
    KETTE_HALT_ANKER,
    "",
    `Kette ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}, Stufe ${ergebnis.stufe}, Dokument #${ergebnis.dokId}: ${ergebnis.grund}.`,
    "",
    ergebnis.frage,
    "",
    ...haltWegNachVorn(kette, planId),
    "",
  ].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    board("issue", "comment", ziel, "--text-file", pfad);
    board("issue", "label", "add", ziel, KLAEREN_LABEL);
  } finally {
    rmSync(pfad, { force: true });
  }
  // Der Halt-Stand (Issue #1090, E1): Erst mit ihm ist am Board ohne Deutung zu sehen, dass
  // eine Frage wartet und kein technischer Abbruch vorliegt — auch wenn die Kette ausserhalb
  // einer Stufe anhielt.
  ketteStand(kette, "wartet", HALT_WARTET);
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

const SITZUNGSUMFANG_KOPF = "Sitzungsumfang:";

/**
 * Der Wert der Zeile `Sitzungsumfang: passt | reisst — <ein Satz>` aus dem `## Kontext`
 * eines Pakets (Konvention aus Issue #979): `"reisst"`, `"passt"` oder `null`, wenn die
 * Karte die Zeile nicht traegt. Zwei Werte und kein dritter — eine Zwischenstufe naehme
 * der Einschaetzung ihre einzige Aussage, und `null` heisst darum "nicht eingeschaetzt",
 * nicht "passt".
 */
function sitzungsumfangVon(body) {
  const abschnitt = abschnittLesen(body, KONTEXT_UEBERSCHRIFT);
  if (!abschnitt) return null;
  for (let i = 0; i < abschnitt.zeilen.length; i++) {
    if (!abschnitt.ausserhalb[i]) continue;
    const zeile = abschnitt.zeilen[i].trim();
    if (!zeile.toLowerCase().startsWith(SITZUNGSUMFANG_KOPF.toLowerCase())) continue;
    const wert = zeile.slice(SITZUNGSUMFANG_KOPF.length).trim();
    if (/^rei(?:ss|ß)t\b/i.test(wert)) return "reisst";
    if (/^passt\b/i.test(wert)) return "passt";
  }
  return null;
}

/**
 * Die letzte Zeile des Stufen-Blocks: welche Pakete voraussichtlich ueber der
 * Sitzungszeitgrenze liegen (Issue #980, Kriterium 1 des Fachplans #963).
 *
 * Ohne sie steht die Einschaetzung nur im `## Kontext` der Karten, und wer morgens den
 * Kettenbericht liest, muesste jede einzelne oeffnen. Genannt werden die Pakete mit
 * `reisst`; ein Paket ohne die Zeile erscheint als "nicht eingeschaetzt", weil ein
 * fehlendes Urteil kein gutes ist.
 */
function berichtSitzungsumfangZeile(ids, pakete) {
  const teile = [];
  for (const id of ids) {
    const wert = sitzungsumfangVon(pakete.find((k) => String(k.id) === String(id))?.body);
    if (wert === "reisst") teile.push(`#${id}`);
    else if (wert === null) teile.push(`#${id} nicht eingeschätzt`);
  }
  return `- Voraussichtlich über der Sitzungszeitgrenze: ${teile.length > 0 ? teile.join(", ") : "keine"}`;
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
  const { stufeVerwendet, modell, effort } = eintrag;
  const stufeText = stufeVerwendet && stufeVerwendet !== stufe
    ? `Aufgabenstufe ${stufe}, ueber Stufe ${stufeVerwendet}`
    : `Aufgabenstufe ${stufe}`;
  // Die Gruendlichkeit hinten und nur, wenn gesetzt (Issue #846) — dieselbe Regel wie in
  // `rundenHinweis` und im Dry-Run; ein Eintrag aus einem aelteren Ergebnisstand kennt
  // das Feld nicht und erscheint darum wie bisher.
  const effortText = effort ? `, Gruendlichkeit ${effort}` : "";
  return modell ? `${stufeText}, Modell ${modell}${effortText}` : `${stufeText}${effortText}`;
}

function berichtUmsetzungEintrag(pakete, eintrag) {
  const id = eintrag && typeof eintrag === "object" ? eintrag.id : eintrag;
  return `${paketBezeichnung(pakete, id)} (${berichtUmsetzungStufe(eintrag)})`;
}

function berichtUmsetzung(einheit, pakete, einheiten, ziel) {
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
    // Die Auslassung zuerst und als eigene Zeile (Issue #862): Sie sagt, dass die
    // bestellte Umsetzung gar nicht erst anlief, was sie verhindert hat und wo die Pakete
    // danach liegen. Aus den drei Listen darunter waere das nur zu erschliessen — und wer
    // erschliessen muss, sieht nicht nach.
    ...(stand.ausgelassen ? [`- ausgelassen: ${stand.ausgelassen} — die Pakete bleiben in Backlog.`] : []),
    `- umgesetzt: ${umgesetztText}`,
    `- angehalten: ${liste(stand.angehalten ?? [])}`,
    `- nicht begonnen: ${nichtBegonnenText}`,
    // Die Prueflaeufe und die Zielmarke (Issue #926, E6) — derselbe Block, den die
    // Umsetzungsnacht ins Protokoll schreibt. Beide Berichtsorte nennen dieselben Zahlen,
    // damit keiner von beiden der Ort ist, an dem eine Messung fehlt.
    ...prueflaufZeilen(einheiten, ziel),
    "",
  ];
}

/**
 * Die erste Zeile der Stufen: welcher Auftrag diese Kette war (Issue #896) — `null`, wenn
 * die Einheit keine der beiden Arten ausweist.
 *
 * Ohne sie waere dem Bericht nicht anzusehen, was der Mensch abends gezeichnet hat: Beim
 * Plan-Auftrag traegt die Einheit die Nummer des Plans, beim Fachplan-Auftrag die der
 * Anforderung — dieselbe Zahl an derselben Stelle, zwei verschiedene Gesten.
 */
function berichtAuftragZeile(einheit) {
  if (einheit.auftrag === "plan") return `- Auftrag: Plan #${einheit.stufen?.plan?.id} (fachliche Quelle #${einheit.fachplan})`;
  return einheit.id ? `- Auftrag: fachliche Anforderung #${einheit.id}` : null;
}

/**
 * Die Planzeile der Stufen — je nachdem, ob der Plan in dieser Nacht entstanden ist.
 *
 * Eine uebernommene Stufe hat keine Dauer, keine Kosten und keine Korrekturrunden:
 * `Dauer 0.0 min` behauptete eine Messung, die es nicht gab (Issue #896).
 */
function berichtPlanZeile(stufen, plan) {
  const p = stufen.plan;
  const pruefer = planReviewWert(plan?.body) ?? "keiner";
  const titel = plan?.title ? ` (${plan.title})` : "";
  if (p.uebernommen) return `- Plan #${p.id}${titel}: als Auftrag uebernommen, nicht neu geschrieben, Pruefer ${pruefer}.`;
  const kosten = p.kennzahlen?.kostenUsd;
  const kostenText = typeof kosten === "number" ? `${kosten.toFixed(2)} $` : "unbekannt";
  return `- Plan #${p.id}${titel}: Dauer ${minutenText(p.dauerMs)} min, Kosten der letzten Session ${kostenText}, `
    + `Korrekturrunden ${p.korrekturrunden ?? 0}, Pruefer ${pruefer}, Marker ${stufen.review?.marker ? "gesetzt" : "fehlt"}.`;
}

function berichtStufen(einheit, plan, pakete) {
  const stufen = einheit.stufen ?? {};
  const auftrag = berichtAuftragZeile(einheit);
  const zeilen = [...(auftrag ? [auftrag] : []), `- Variante: ${einheit.variante === "B" ? "B" : "A"}`];
  zeilen.push(stufen.plan?.id ? berichtPlanZeile(stufen, plan) : "- Plan: keiner entstanden.");
  const ids = stufen.pakete?.ids ?? [];
  zeilen.push(ids.length > 0
    ? `- Pakete (${ids.length}, Korrekturrunden ${stufen.pakete?.korrekturrunden ?? 0}): ${ids.map((id) => paketBezeichnung(pakete, id)).join(", ")}.`
    : "- Pakete: keine.");
  const fremd = stufen.pakete?.nichtZuordenbar ?? [];
  if (fremd.length > 0) zeilen.push(`- Nicht zuordenbar (ohne 'Plan: Issue #${stufen.plan?.id}'): ${fremd.map((id) => "#" + id).join(", ")}.`);
  // Als letzte Zeile des Blocks (Issue #980): `test/night-kette-bericht.test.mjs` fixiert
  // die Folge bis einschliesslich `- Pakete: …`, und hinten angehaengt bleibt sie gueltig.
  zeilen.push(berichtSitzungsumfangZeile(ids, pakete));
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

/**
 * Was ein Halt der Kette fuer den Bericht ist (Issue #1050, E12): eine Stopp-Frage, und wie
 * viele Pakete an einer geschuetzten Datei warten. Ein geschuetzter Halt ist keine Frage —
 * er erscheint weder im Zaehler `Stopp-Fragen` noch unter `### Offene Stopp-Frage`.
 */
function berichtHaltArten(einheit) {
  if (einheit.ausgang !== "angehalten") return { stoppFrage: false, geschuetzt: 0 };
  const stand = einheit.stufen?.umsetzung;
  // Ein Halt ausserhalb der Umsetzung ist immer eine Stopp-Frage (Plan, Review, Schneiden).
  if ((stand?.angehalten?.length ?? 0) === 0) return { stoppFrage: true, geschuetzt: 0 };
  const arten = stand.angehalten.map((id) => stand.haltArten?.[id] ?? "klaeren");
  return { stoppFrage: arten.includes("klaeren"), geschuetzt: arten.filter((a) => a === "geschuetzt").length };
}

export function berichtBauen(einheit, {
  plan = null, pakete = [], einarbeitung = null, abdeckung = null, budget = {}, start, stempel, frage = null, jetzt = Date.now(),
  // Die Paket-Einheiten des Laufs und die Zielmarke (Issue #926): Der Bericht rechnet die
  // Prueflaeufe daraus, und als Argumente bleibt er eine reine Funktion ueber Fixtures.
  einheiten = [], zielUmsetzungMin: ziel = undefined,
  // Der feste Kit-Stand des Laufs (Issue #1103). Er steht im Text selbst: Ein wartender
  // Bericht, den ein spaeterer Lauf nachtraegt, nennt so den Stand des Laufs, der ihn schrieb.
  kitStand = ZUSTAND.LAUF?.kitStand ?? null,
} = {}) {
  const stufen = einheit.stufen ?? {};
  const z = [`${BERICHT_ANKER} ${stempel ?? ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}`, ""];
  z.push(
    "### Ausgang", "", einheit.grund ? `${einheit.ausgang} — ${einheit.grund}` : String(einheit.ausgang), "",
    "### Stufen", "", ...berichtStufen(einheit, plan, pakete), "",
  );
  if (einheit.variante === "B") z.push(...berichtUmsetzung(einheit, pakete, einheiten, ziel));

  const entscheidungen = berichtEntscheidungen(stufen, plan, pakete);
  z.push("### Entscheidungen der Nacht", "");
  if (entscheidungen.length === 0) z.push("- Keine.");
  entscheidungen.forEach((e, i) => z.push(`${i + 1}. ${e}`));

  z.push(
    "",
    "### Abgelehnte Befunde", "", ...berichtAbgelehnt(einarbeitung), "",
    "### Abdeckung gegen den Fachplan", "",
  );
  if (abdeckung?.text) z.push(abdeckung.text);
  else z.push(`Keine Abdeckung: ${abdeckung?.grund ?? "die Kette hat die Stufe abdeckung nicht erreicht"}.`);
  if (einheit.abdeckungSchrieb) z.push("", "Hinweis: die Abdeckungs-Session hat am Board geschrieben, obwohl sie nur lesen sollte.");
  z.push("");

  const halt = berichtHaltArten(einheit);
  const startZeit = start instanceof Date ? start : new Date(start ?? jetzt);
  const paketeErreicht = (stufen.pakete?.ids ?? []).length > 0;
  z.push("### Kennzahlen", "",
    `- Pakete erreicht: ${paketeErreicht ? "ja" : "nein"}`,
    `- Dauer der Kette: ${minutenText(jetzt - startZeit.getTime())} min ab ${startZeit.toISOString()}`,
    `- Entscheidungen: ${entscheidungen.length}`,
    `- Stopp-Fragen: ${halt.stoppFrage ? 1 : 0}`,
    ...(halt.geschuetzt > 0 ? [`- Geschuetzte Dateien: ${halt.geschuetzt}`] : []),
    `- Kosten: ${Number(einheit.kostenUsd ?? 0).toFixed(2)} $ von ${budget.kostenUsd ?? "?"} $`,
    `- kostenUnbekannt: ${einheit.kostenUnbekannt ?? 0}`,
    "");
  if (halt.stoppFrage) z.push("### Offene Stopp-Frage", "", frage ?? einheit.grund ?? "siehe den Halt-Kommentar an der gekennzeichneten Karte", "");
  if (halt.geschuetzt > 0) z.push("### Wartende Handlung an geschuetzter Datei", "", einheit.grund ?? "siehe den Halt-Kommentar am Paket", "");
  if ((einheit.ueberholt ?? []).length > 0) z.push("### Ueberholt", "", ...einheit.ueberholt.map((id) => `- Plan #${id}`), "");
  if ((einheit.ueberholtUnbestaetigt ?? []).length > 0) {
    z.push("### Ueberholt, nicht bestaetigt", "", ...einheit.ueberholtUnbestaetigt.map((e) => `- Plan #${e.id} — ${e.grund}`), "");
  }
  if (kitStand) z.push(kitStandZeile(kitStand), "");
  z.push(BERICHT_SCHLUSS, "");
  return z.join("\n");
}

/**
 * Schreibt den Bericht als Kommentar an die gekennzeichnete Karte (A11; Issue #896) —
 * ueber eine Datei ausserhalb des Projekts, nie als Argument. Nimmt der Tracker ihn nicht
 * an, wartet er als `.claude/night-bericht-<zielId>-<stempel>.md` in der Hauptkopie.
 * Rueckgabe ist der Wert fuer `einheit.bericht`: "veroeffentlicht" oder der wartende Pfad.
 * Kein `fail`: Ein toter Tracker beim letzten Schritt darf die Kette nicht als Absturz
 * enden lassen.
 *
 * `zielId` ist die Nummer der Karte, die das Kennzeichen trug — beim Plan-Auftrag der
 * Plan. Der Bericht gehoert dorthin, wo der Mensch morgens nachsieht: an die Karte, die
 * er abends gezeichnet hat. `berichteNachtragen` liest die Nummer weiter aus dem
 * Dateinamen und bleibt davon unberuehrt.
 */
export function berichtSchreiben(zielId, text, { stempel = ZUSTAND.LAUF_STEMPEL, repoRoot = process.cwd() } = {}) {
  const name = `${BERICHT_DATEI_PRAEFIX}${zielId}-${stempel ?? Date.now()}.md`;
  // Mit der Prozess-Id: Zwei Runner in derselben Sekunde teilten sich sonst die Zwischendatei.
  const pfad = join(tmpdir(), `${process.pid}-${name}`);
  writeFileSync(pfad, text, "utf-8");
  try {
    const res = boardRoh("issue", "comment", String(zielId), "--text-file", pfad);
    if (res.status === 0) {
      log(`  Nachtbericht als Kommentar an #${zielId} veroeffentlicht.`);
      return "veroeffentlicht";
    }
    const wartend = join(".claude", name);
    mkdirSync(join(repoRoot, ".claude"), { recursive: true });
    writeFileSync(join(repoRoot, wartend), text, "utf-8");
    log(`  Nachtbericht konnte nicht an #${zielId} geschrieben werden (${res.text.slice(0, 200)}) — liegt wartend unter ${wartend} und wird beim naechsten Start nachgetragen.`);
    return wartend;
  } finally {
    rmSync(pfad, { force: true });
  }
}

/**
 * Traegt wartende Berichte nach — beim Start jeder Betriebsart, nach `vorbereiten`.
 * Aufsteigend nach Dateiname, jeder genau einmal; gelingt das Schreiben, ist die Datei
 * weg, sonst bleibt sie liegen und der Lauf geht weiter. Liefert die nachgetragenen Namen.
 *
 * Genau einmal auch bei zwei Runnern (Plan #1113, E12; Issue #1190): Vor dem Posten wird
 * der Bericht auf `<name>.sendet-<pid>` umbenannt. Das Umbenennen ist atomar — wem es nicht
 * gelingt, dem hat ein anderer Runner den Bericht abgenommen, und er ueberspringt ihn.
 * Scheitert das Posten, wird zurueckbenannt. Eine `.sendet-`-Datei, deren Prozess nicht
 * mehr lebt, benennt der naechste Start zurueck und traegt sie im selben Zug nach.
 * `posten` und `pid` sind fuer die Tests einspeisbar.
 */
export function berichteNachtragen(repoRoot = process.cwd(), {
  posten = (F, pfad) => boardRoh("issue", "comment", F, "--text-file", pfad),
  pid = process.pid,
} = {}) {
  const ordner = join(repoRoot, ".claude");
  if (!existsSync(ordner)) return [];
  verwaisteSendungenZurueck(ordner);
  // Codepoint-Ordnung wie bisher (Issue #956, S2871): Die Berichte tragen den
  // Zeitstempel im Namen, aufsteigend nach Dateiname ist aufsteigend nach Zeit.
  const dateien = readdirSync(ordner)
    .filter((n) => n.startsWith(BERICHT_DATEI_PRAEFIX) && n.endsWith(".md")).sort(vergleicheText);
  const nachgetragen = [];
  for (const name of dateien) {
    const F = name.slice(BERICHT_DATEI_PRAEFIX.length).split("-")[0];
    const pfad = join(ordner, name);
    const sendet = `${pfad}${SENDET_MARKE}${pid}`;
    try {
      renameSync(pfad, sendet);
    } catch {
      log(`Wartenden Nachtbericht uebersprungen: .claude/${name} — ein anderer Runner traegt ihn nach.`);
      continue;
    }
    const res = posten(F, sendet);
    if (res.status === 0) {
      rmSync(sendet, { force: true });
      nachgetragen.push(name);
      log(`Wartenden Nachtbericht nachgetragen: .claude/${name} -> Kommentar an #${F}.`);
    } else {
      renameSync(sendet, pfad);
      log(`Wartender Nachtbericht bleibt liegen: .claude/${name} — ${res.text.slice(0, 200)}`);
    }
  }
  return nachgetragen;
}

/** Die Marke zwischen Berichtsname und Prozess-Id eines gerade gesendeten Berichts (E12). */
const SENDET_MARKE = ".sendet-";

/**
 * Benennt jede `.sendet-<pid>`-Datei zurueck, deren Prozess nicht mehr lebt (Plan #1113,
 * E12): Ein Runner, der beim Posten starb, liess den Bericht unter dem Sendenamen liegen,
 * und ohne Rueckbenennung truege ihn niemand mehr nach.
 */
function verwaisteSendungenZurueck(ordner) {
  for (const n of readdirSync(ordner)) {
    if (!n.startsWith(BERICHT_DATEI_PRAEFIX)) continue;
    const stelle = n.lastIndexOf(SENDET_MARKE);
    if (stelle < 0) continue;
    const halter = pidAusInhalt(n.slice(stelle + SENDET_MARKE.length));
    if (halter !== null && prozessLaeuft(halter)) continue;
    const name = n.slice(0, stelle);
    try {
      renameSync(join(ordner, n), join(ordner, name));
      log(`Verwaisten Nachtbericht zurueckbenannt: .claude/${n} -> .claude/${name} (Prozess ${halter ?? "unbekannt"} lebt nicht mehr).`);
    } catch {
      // Ein anderer Start benannte ihn im selben Augenblick zurueck — dann liegt er schon da.
    }
  }
}

/**
 * Der Vorflug ist vor der ersten Kette gescheitert: Der Vorab-Stand jedes Kandidaten wird
 * `abgebrochen` mit `Kette nicht gestartet` und dem Befund (Issue #1090, E17) — der
 * fruehere eigene Kommentar geht darin auf. Das Label bleibt, die Geste ist nicht
 * verbraucht, denn es lief nichts. Ohne `fail`, weil der Aufrufer gleich selbst hart stoppt.
 */
function ketteNichtGestartet(kandidaten, grund) {
  const zeit = new Date().toISOString();
  for (const k of kandidaten) {
    const ergebnis = standSetzen(k.id, "abgebrochen", `Kette nicht gestartet um ${zeit}: ${grund}`, { budgetMs: ABBRUCH_BUDGET_MS });
    log(ergebnis === "geschrieben"
      ? `  #${k.id}: Laufstand 'Kette nicht gestartet' geschrieben, Label bleibt.`
      : `  #${k.id}: Laufstand 'Kette nicht gestartet' nicht geschrieben — bleibt offen im Journal.`);
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
  log(`Hinweis: keine Karte am Board traegt '${REVIEW_FERTIG_LABEL}' — deshalb wird jeder Auftrag abgelehnt.`);
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

/**
 * Die Paket-Einheiten genau dieser Kette, in der Reihenfolge des Laufs (Issue #926).
 *
 * `LAUF.einheiten` fuehrt jede Einheit des Nachtlaufs — auch die frueherer Ketten und
 * die Ketten-Einheiten selbst. Fuer den Bericht einer Karte zaehlen allein die Pakete,
 * die diese Kette bestellt hat.
 */
export function ketteEinheiten(kette, alle = undefined) {
  const ids = new Set((kette?.stufen?.pakete?.ids ?? []).map(String));
  if (ids.size === 0) return [];
  const quelle = alle ?? ZUSTAND.LAUF?.einheiten ?? [];
  return quelle.filter((e) => ids.has(String(e?.id)));
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
    budget: kette.budget, start: kette.start, stempel: ZUSTAND.LAUF_STEMPEL, frage: ergebnis.frage ?? null,
    // Die Paket-Einheiten DIESER Kette (Issue #926, eingegrenzt im Code-Review): Aus
    // ihnen rechnet der Bericht die Prueflaeufe und die Zielmarke; die Ketten-Einheit
    // selbst traegt sie nicht. Die Eingrenzung auf `kette.stufen.pakete.ids` ist noetig,
    // weil `LAUF.einheiten` ALLE Einheiten des Nachtlaufs fuehrt: Ab der zweiten Kette
    // eines Laufs stuenden sonst fremde Pakete im Kommentar dieser Karte, und die Zeile
    // "N von M" zaehlte sie mit.
    einheiten: ketteEinheiten(kette), zielUmsetzungMin: ZUSTAND.config?.night?.zielUmsetzungMin,
  });
}

/**
 * Fuehrt eine Stufe der Kette aus und meldet danach den Lauf (Issue #794).
 *
 * Der Grund liegt bei der Gegenstelle: kanban-kit erklaert einen nicht abgeschlossenen
 * Lauf fuer verstummt, wenn laenger als seine Stillefrist keine neue Meldung kam, und
 * als Lebenszeichen zaehlt allein eine Meldung (kanban-kit #1086, AK 6; ein eigenes
 * Lebenszeichen hat es mit #1074 bewusst abgelehnt). Zwischen der Startmeldung (Issue
 * #743) und der ersten Paket-Meldung lag bis hierher die ganze Planungsphase — mit den
 * Budgets dieses Repos bis zu 95 Minuten, mehr als die Frist. Ein gesunder Kettenlauf
 * fiel dort mitten in der Planung aus den aktiven Laeufen.
 *
 * Die Stufe meldet, nicht ihr Ausgang: Jede Stufe hat ein Budget von hoechstens 30
 * Minuten, und weil dieser Wrapper JEDEN Aufruf in `stufenDerKette` umschliesst, fuehrt
 * kein Weg durch die Kette ueber zwei Stufen ohne Meldung — gleich, ob eine Stufe fertig
 * wird, anhaelt oder abbricht. Stuende der Aufruf stattdessen an den Rueckgabepunkten der
 * Stufen selbst, waere er an jedem neuen `return` erneut zu bedenken.
 *
 * Erst schreiben, dann melden, wie beim Start: `laufMelden()` liest ERGEBNIS_FILE ueber
 * einen eigenen Prozess von der Platte. Ohne eigene Protokollzeile — `laufMelden()`
 * bringt seine eigene mit, und `meldezeile()` fasst sie ueber den ganzen Lauf zu einer
 * zusammen.
 */
async function mitMeldung(stufe) {
  const ergebnis = await stufe();
  schreibeErgebnisstand();
  laufMelden();
  return ergebnis;
}

// --- Vorhandenes Ergebnis einer Stufe (Issue #1086, Plan #1079 E2, E9, E10, E11) ---
//
// Eine Stufe prueft vor ihrem Start und nach jedem Abbruch am Board, ob ihr Ergebnis
// schon vorliegt, statt vorher und nachher zu vergleichen: Der Vergleich sieht nach einem
// Absturz nichts mehr. So gilt ein Pruefvermerk, der vor dem Zeitlimit im Plan stand, als
// Ergebnis (Belegfall 2 aus #1075), und `kit:night` an der Karte setzt bei der ersten
// Stufe ohne Ergebnis an.

// Ein Plan in Done zaehlt nicht: Wer einen frischen Plan will, schliesst den alten (E9).
const PLAN_VORHANDEN_SPALTEN = new Set(["backlog", "ready", "in_review"]);
const PAKET_UMGESETZT_SPALTEN = new Set(["in_review", "done"]);
// Der Kopf des Kommentars, den `werteInReview` an ein Paket mit Nachweis-Mangel schreibt.
const NACHWEIS_MANGEL_KOPF = "Nachtlauf: Nachweis ";
// Der Wortlaut des Teilschnitts (E10) — hinter der Liste der angelegten Pakete.
const TEILSCHNITT_FOLGE = "eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night";

/** Ein Laufstand-Eintrag einer Stufe: `<stufe> begonnen|fertig für #<ziel>`. */
const stufenEintrag = (stufe, was, ziel) => `${stufe} ${was} für #${ziel}`;

/** Traegt einer der Texte den Eintrag — mit Zahlgrenze, sonst passte #12 auf #123. */
function eintragDa(texte, stufe, was, ziel) {
  const muster = new RegExp(`(?:^|[^\\w])${stufe} ${was} für #${ziel}(?!\\d)`, "m");
  return texte.some((t) => muster.test(t));
}

/**
 * Der Kommentar `## Laufstand` einer Karte, wie er jetzt am Board steht — leer ohne ihn.
 */
const laufstandAmBoard = (karteId) => kommentareVon(leseKarte(karteId)).filter((k) => k.startsWith("## Laufstand"));

/**
 * Der Laufstand-Text der tragenden Karte aus allen Quellen (E10): der Kommentar, wie ihn
 * die Kette beim Start vorfand (`auftrag.laufstandVorher`), wie er jetzt steht, und die
 * Standzeilen dieser Karte in jedem Journal unter `.claude/lauf/`. Der Kommentar wird bei
 * jedem Wechsel ersetzt — von den eigenen Stufen dieses Laufs, von einem Abbruch oder vom
 * Waechter —, das Journal haengt nur an und haelt die Stufenzeilen fest.
 */
function laufstandTexte(auftrag) {
  const karteId = auftrag.karte.id;
  const texte = [...(auftrag.laufstandVorher ?? []), ...laufstandAmBoard(karteId)];
  const ordner = join(auftrag.repoRoot, LAUF_ORDNER);
  if (existsSync(ordner)) {
    for (const name of readdirSync(ordner).filter((n) => n.endsWith(".jsonl")).sort(vergleicheText)) {
      for (const s of journalLesen(join(ordner, name)).staende) {
        if (s.karte === String(karteId)) texte.push(String(s.text ?? ""));
      }
    }
  }
  return texte;
}

/**
 * Ist dieses Paket umgesetzt (E9)? In In review oder Done und ohne den Kommentar, den
 * `werteInReview` bei fehlendem, unlesbarem oder rotem Nachweis schreibt — derselbe Guard
 * wie dort (Issue #471). Exportiert fuer die Tests.
 */
export function paketUmgesetzt(issue) {
  if (!issue || !PAKET_UMGESETZT_SPALTEN.has(issue.status)) return false;
  return !kommentareVon(issue).some((k) => k.startsWith(NACHWEIS_MANGEL_KOPF));
}

/** Die Arbeitspakete zum Plan am Board, aufsteigend nach Nummer. */
function paketeZumPlan(planId) {
  return board("issue", "list")
    .filter((i) => stammtAusErzeugung(i, planId, "issue"))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((i) => String(i.id));
}

/**
 * Liegt das Ergebnis dieser Stufe schon vor (E9)? `null`, wenn nicht, sonst ein Objekt mit
 * dem, was die folgenden Stufen brauchen.
 *
 * `auftrag` traegt `karte` (die Karte, die die Kette traegt), `F`, `repoRoot`, dazu je
 * nach Stufe `planId` und `paketIds`. Die Eintraege von pakete und abdeckung stehen an der
 * tragenden Karte (E2). `abdeckung fertig` deckt `pakete fertig` mit: Der Laufstand-
 * Kommentar nennt nur den zuletzt abgeschlossenen Schritt, und die Abdeckung kommt nach
 * den Paketen.
 */
export function ergebnisVorhanden(stufe, auftrag) {
  return Object.hasOwn(ERGEBNIS_REGELN, stufe) ? ERGEBNIS_REGELN[stufe](auftrag) : null;
}

/** Die fuenf Ergebnisregeln aus E9, je Stufe eine. */
const ERGEBNIS_REGELN = {
  plan: (auftrag) => {
    const plan = board("issue", "list")
      .filter((i) => PLAN_VORHANDEN_SPALTEN.has(i.status) && stammtAusErzeugung(i, auftrag.F, "plan"))
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    return plan ? { id: String(plan.id) } : null;
  },
  review: (auftrag) => (hatPlanReviewMarker(leseKarte(auftrag.planId)?.body) ? {} : null),
  pakete: (auftrag) => {
    const texte = laufstandTexte(auftrag);
    const fertig = eintragDa(texte, "pakete", "fertig", auftrag.planId) || eintragDa(texte, "abdeckung", "fertig", auftrag.planId);
    return fertig ? { ids: paketeZumPlan(auftrag.planId) } : null;
  },
  abdeckung: (auftrag) => (eintragDa(laufstandTexte(auftrag), "abdeckung", "fertig", auftrag.planId) ? {} : null),
  umsetzung: (auftrag) => {
    const ids = auftrag.paketIds ?? [];
    return ids.length > 0 && ids.every((id) => paketUmgesetzt(leseKarte(id))) ? { ids } : null;
  },
};

/**
 * Der Teilschnitt (E10): Der Laufstand dieser Karte traegt `pakete begonnen für #M` ohne
 * `pakete fertig für #M`, und am Board liegen schon Pakete zum Plan. Die Stufe startet
 * dann nicht — `/issues` kennt keinen Wiedereinstieg, und eine Wiederholung legte doppelt
 * an. Pakete ohne jeden Laufstand-Eintrag zaehlen wie bisher (Issue #895): Die Stufe
 * laeuft. `null` ohne Teilschnitt.
 */
function teilschnitt(auftrag, planId) {
  if (!eintragDa(laufstandTexte(auftrag), "pakete", "begonnen", planId)) return null;
  const ids = paketeZumPlan(planId);
  if (ids.length === 0) return null;
  return { ausgang: "abgebrochen", grund: `Teilschnitt vorhanden (${ids.map((id) => "#" + id).join(", ")}) — ${TEILSCHNITT_FOLGE}` };
}

// Der Wortlaut von `wartet` bei einem inhaltlichen Halt (E1), wie er im Regeltext steht.
const HALT_WARTET = `Halt: Frage wartet auf den Menschen — siehe \`${KETTE_HALT_ANKER}\``;

/**
 * Schreibt den Laufstand der tragenden Karte (E2): zuletzt begonnener und zuletzt
 * abgeschlossener Schritt, darueber bei einem Abbruch oder Halt dessen Grund. Ein Board,
 * das nicht annimmt, haelt nichts an — `standSetzen` laesst die Zeile offen im Journal.
 */
function ketteStand(kette, zustand, kopf = null) {
  const s = kette.laufstand;
  const zeilen = [
    ...(kopf ? [kopf, ""] : []),
    ...(s.begonnen ? [`zuletzt begonnen: ${s.begonnen}`] : []),
    ...(s.abgeschlossen ? [`zuletzt abgeschlossen: ${s.abgeschlossen}`] : []),
  ];
  standSetzen(kette.karte.id, zustand, zeilen.join("\n"), { repoRoot: kette.repoRoot });
  kette.standGesetzt = true;
}

/** Der Laufstand zum Beginn einer Stufe. `ziel` ist die Karte, an der sie arbeitet. */
function stufeBeginnt(kette, stufe, ziel) {
  kette.laufstand.begonnen = `${stufenEintrag(stufe, "begonnen", ziel)} um ${new Date().toISOString()}`;
  ketteStand(kette, "laeuft");
}

/** Der Laufstand zum Ende einer Stufe — `fertig`, oder ihr Abbruch beziehungsweise Halt. */
function stufeEndet(kette, stufe, ziel, ergebnis) {
  if (ergebnis.ausgang === "fertig") {
    kette.laufstand.abgeschlossen = `${stufenEintrag(stufe, "fertig", ziel)} um ${new Date().toISOString()}`;
    ketteStand(kette, "fertig");
  } else if (ergebnis.ausgang === "angehalten") {
    // Haelt ein Paket der Umsetzung an, steht die Frage am Paket, nicht an dieser Karte (E17).
    ketteStand(kette, "wartet", ergebnis.ohneHaltAmFachplan ? `Halt: ${ergebnis.grund}` : HALT_WARTET);
  } else {
    ketteStand(kette, ergebnis.ausgang === "abgebrochen" ? "abgebrochen" : "fertig", `${ergebnis.ausgang}: Stufe ${stufe}: ${ergebnis.grund ?? "ohne Grund"}`);
  }
}

/**
 * Eine Stufe mit Ergebnispruefung (E9): vorher am Board nachsehen und ohne Session
 * `fertig` mit `vorgefunden: true` melden; sonst laufen lassen und nach dem Abbruch
 * einer Session noch einmal nachsehen. `vorfinden` setzt den Stand der Stufe fuer den vorgefundenen
 * Fall und liefert das Ergebnis der Stufe.
 */
async function stufeMitErgebnis(kette, stufe, ziel, { auftrag, laufen, vorfinden, vorab = null }) {
  const vorhanden = ergebnisVorhanden(stufe, auftrag);
  if (vorhanden) {
    log(`  Stufe ${stufe}: Ergebnis liegt vor — keine Session, die Stufe gilt als fertig.`);
    const ergebnis = vorfinden(vorhanden);
    stufeEndet(kette, stufe, ziel, ergebnis);
    return ergebnis;
  }
  const sperre = vorab?.();
  if (sperre) {
    log(`  Stufe ${stufe}: ${sperre.grund}.`);
    stufeEndet(kette, stufe, ziel, sperre);
    return sperre;
  }
  const vorherLog = schrittBeginnen(kette.karte.id, stufe);
  try {
    return await stufeLaufen(kette, stufe, ziel, { auftrag, laufen, vorfinden });
  } finally {
    schrittEnden(vorherLog);
  }
}

/** Der laufende Teil von `stufeMitErgebnis`, ganz im Protokoll seines Schritts. */
async function stufeLaufen(kette, stufe, ziel, { auftrag, laufen, vorfinden }) {
  stufeBeginnt(kette, stufe, ziel);
  let ergebnis = await laufen();
  // Nur nach dem Abbruch einer SESSION von aussen (Zeitlimit, technischer Fehler): Dort ist
  // offen, was sie hinterlassen hat. Eine rote Form, ein erschoepftes Kostenbudget oder ein
  // harter Stopp sind dagegen ein Urteil ueber das Ergebnis — ein vorgefundener Plan
  // ueberginge die Form, eine vorgefundene Stufe das Budget. Die wartende Sitzung ebenso:
  // Sie sagt selbst, dass ihre Arbeit noch nicht durch ist (Issue #778).
  if (ergebnis.ausgang === "abgebrochen" && ergebnis.sitzungsAbbruch && !kette.kostenGrund) {
    const nachher = ergebnisVorhanden(stufe, auftrag);
    if (nachher) {
      log(`  Stufe ${stufe}: abgebrochen (${ergebnis.grund}), das Ergebnis liegt aber vor — die Stufe gilt als fertig.`);
      ergebnis = vorfinden(nachher, kette.stufen[stufe]);
    }
  }
  stufeEndet(kette, stufe, ziel, ergebnis);
  return ergebnis;
}

// --- Freigegebene Uebergaenge (Issue #1087, Plan #1079 E1, E12) ---

// Die beiden Wortlaute von `wartet` aus E1, wie sie im Regeltext stehen.
const uebergangNichtFreigegeben = (uebergang) => `wartet: Übergang ${uebergang} im Projekt nicht freigegeben — weiter mit kit:night`;
const OHNE_FREIGABE_ZUR_UMSETZUNG = "wartet: Karte ohne Freigabe zur Umsetzung";

/**
 * Folgt die naechste Stufe automatisch? Gesperrt wird nur das Folgen auf eine Stufe, die in
 * DIESEM Lauf lief. War die vorige vorgefunden, ist die naechste die erste offene, und dort
 * hat der Mensch mit `kit:night` selbst angestossen — sonst setzte die Geste, die der
 * Wartetext nennt, nie bei der wartenden Stufe an. Gesperrt ist nur ein ausdrueckliches
 * `false`; ein nicht gesetzter `abdeckungUmsetzung` (`null`) sperrt nicht (Issue #1105).
 */
const uebergangGesperrt = (kette, uebergang, vorige) => !vorige.vorgefunden && kette.uebergaenge[uebergang] === false;

/** Ende der Kette vor `stufe`: Laufstand `wartet` mit dem Wortlaut, Ausgang `unvollstaendig`. */
function ketteWartet(kette, stufe, text) {
  log(`  Stufe ${stufe}: ${text}.`);
  ketteStand(kette, "wartet", text);
  return { ausgang: "unvollstaendig", grund: text, stufe };
}

/**
 * Endet die Kette nach der Abdeckung? Das GO steht an der Karte (`kit:durchziehen`), das
 * Projekt kann es nur zulassen (E12). Ohne Label endet sie `fertig`, nur ein gesetztes `true`
 * laesst sie auf die Freigabe der Karte warten; mit Label sperrt nur ein gesetztes `false`
 * (Issue #1105). `null`, wenn die Umsetzung folgt.
 */
function vorDerUmsetzung(kette, abdeckung) {
  if (kette.variante !== "B") {
    return kette.uebergaenge.abdeckungUmsetzung === true ? ketteWartet(kette, "umsetzung", OHNE_FREIGABE_ZUR_UMSETZUNG) : { ausgang: "fertig" };
  }
  return uebergangGesperrt(kette, "abdeckungUmsetzung", abdeckung)
    ? ketteWartet(kette, "umsetzung", uebergangNichtFreigegeben("abdeckungUmsetzung"))
    : null;
}

/**
 * Die Stufen einer Kette in Reihenfolge; die erste, die nicht fertig wird, ist der
 * Ausgang der Kette (mit ihrem Namen fuer den Halt-Kommentar). Unter Variante B kommt
 * hinter `abdeckung` die fuenfte Stufe `umsetzung` dazu (Plan #691, E12).
 *
 * Jede der vier erzeugenden Stufen laeuft durch `mitMeldung` (Issue #794). Die Stufe
 * `umsetzung` nicht: Sie meldet ueber `laufeRunde` schon nach jedem fertigen Paket.
 *
 * Jede Stufe laeuft durch `stufeMitErgebnis` (Issue #1086): Liegt ihr Ergebnis schon vor,
 * startet keine Session, und ihr Laufstand steht an der Karte, die die Kette traegt.
 */
async function stufenDerKette(kette) {
  // Der Laufstand, den die Kette vorfand — VOR ihrem ersten eigenen, der ihn ersetzt.
  const auftrag = { F: kette.F, karte: kette.karte, repoRoot: kette.repoRoot, laufstandVorher: kette.laufstandVorher ?? laufstandAmBoard(kette.karte.id) };
  kette.laufstand ??= { begonnen: null, abgeschlossen: null };
  let planId;
  if (kette.art === "plan") {
    // Der Plan ist der Auftrag: Er steht schon da, geprueft und ohne offene Frage.
    // Traegt er aus einem frueheren Lauf bereits Arbeitspakete OHNE Laufstand-Eintrag,
    // laeuft die Stufe trotzdem unveraendert und zaehlt nur die neu entstandenen Karten —
    // ein hingenommener Fall (Issue #895): Die aelteren Pakete bleiben in Backlog stehen,
    // und ein weiteres Tor davor sperrte den haeufigen Fall aus, um den seltenen zu
    // verhindern. Mit Eintrag gelten sie als vorgefunden oder als Teilschnitt (#1086).
    planId = kette.stufen.plan.id;
  } else {
    const plan = await mitMeldung(() => stufeMitErgebnis(kette, "plan", kette.F, {
      auftrag,
      laufen: () => stufePlan(kette),
      vorfinden: (v, vorher) => {
        kette.stufen.plan = { dauerMs: 0, kennzahlen: null, korrekturrunden: 0, weitere: [], ...vorher, id: v.id, vorgefunden: true };
        return { ausgang: "fertig", id: v.id, vorgefunden: true };
      },
    }));
    if (plan.ausgang !== "fertig") return { ...plan, stufe: "plan" };
    planId = plan.id;
    if (uebergangGesperrt(kette, "planReview", plan)) return ketteWartet(kette, "review", uebergangNichtFreigegeben("planReview"));
    const review = await mitMeldung(() => stufeMitErgebnis(kette, "review", planId, {
      auftrag: { ...auftrag, planId },
      laufen: () => stufeReview(kette, planId),
      vorfinden: (v, vorher) => {
        kette.stufen.review = { dauerMs: 0, kennzahlen: null, ...vorher, marker: true, vorgefunden: true };
        return { ausgang: "fertig", vorgefunden: true };
      },
    }));
    if (review.ausgang !== "fertig") return { ...review, stufe: "review" };
    if (uebergangGesperrt(kette, "reviewPakete", review)) return ketteWartet(kette, "pakete", uebergangNichtFreigegeben("reviewPakete"));
  }
  const pakete = await mitMeldung(() => stufeMitErgebnis(kette, "pakete", planId, {
    auftrag: { ...auftrag, planId },
    laufen: () => stufePakete(kette, planId),
    vorab: () => teilschnitt(auftrag, planId),
    vorfinden: (v, vorher) => {
      kette.stufen.pakete = { nichtZuordenbar: [], dauerMs: 0, kennzahlen: null, korrekturrunden: 0, ...vorher, ids: v.ids, vorgefunden: true };
      return { ausgang: "fertig", ids: v.ids, vorgefunden: true };
    },
  }));
  if (pakete.ausgang !== "fertig") return { ...pakete, stufe: "pakete" };
  if (uebergangGesperrt(kette, "paketeAbdeckung", pakete)) return ketteWartet(kette, "abdeckung", uebergangNichtFreigegeben("paketeAbdeckung"));
  const abdeckung = await mitMeldung(() => stufeMitErgebnis(kette, "abdeckung", planId, {
    auftrag: { ...auftrag, planId },
    laufen: () => stufeAbdeckung(kette, kette.F, planId, pakete.ids),
    vorfinden: () => {
      kette.stufen.abdeckung = { dauerMs: 0, kennzahlen: null, text: null, grund: "aus einem frueheren Lauf vorgefunden — der Text steht in dessen Bericht", vorgefunden: true };
      return { ausgang: "fertig", vorgefunden: true };
    },
  }));
  if (abdeckung.ausgang !== "fertig") return { ...abdeckung, stufe: "abdeckung" };
  const ohneUmsetzung = vorDerUmsetzung(kette, abdeckung);
  if (ohneUmsetzung) return ohneUmsetzung;
  // Die Paketliste kommt aus dem Stand der Stufe pakete (E16), nicht aus der
  // Ready-Spalte und nicht aus einer erneuten Abfrage nach Herkunft. Was davon schon
  // umgesetzt ist, laeuft nicht noch einmal (E9).
  const paketIds = kette.stufen.pakete?.ids ?? [];
  const umsetzung = await stufeMitErgebnis(kette, "umsetzung", planId, {
    auftrag: { ...auftrag, planId, paketIds },
    laufen: async () => {
      const vorgefunden = paketIds.filter((id) => paketUmgesetzt(leseKarte(id)));
      const ergebnis = await stufeUmsetzung(kette, paketIds.filter((id) => !vorgefunden.includes(id)));
      if (vorgefunden.length > 0) kette.stufen.umsetzung.vorgefundenePakete = vorgefunden;
      return ergebnis;
    },
    vorfinden: (v, vorher) => {
      kette.stufen.umsetzung = { umgesetzt: [], angehalten: [], zurueckgestellt: [], nichtBegonnen: [], dauerMs: 0, ...vorher, vorgefundenePakete: v.ids, vorgefunden: true };
      return { ausgang: "fertig", vorgefunden: true };
    },
  });
  if (umsetzung.ausgang !== "fertig") return { ...umsetzung, stufe: "umsetzung" };
  return { ausgang: "fertig" };
}

/**
 * Der Auftakt einer Kette: Protokollzeile, verbrauchtes Kennzeichen, Ausgangslage.
 *
 * Rueckgabe sind die aelteren Plaene zur Wurzel, die nach einem NEUEN Plan den
 * Ueberholt-Kommentar bekommen (A8). Beim Plan-Auftrag ist die Liste leer und die Stufe
 * `plan` stattdessen vorbelegt: Es entsteht kein neuer Plan, und der uebernommene ist
 * keiner, der einen anderen ueberholte — er ist der, den der Mensch gewaehlt hat. Leer
 * ist sie auch, wenn ein Plan vorgefunden wird (Issue #1086, E9): Die Stufe plan legt
 * dann keinen neuen an.
 */
function ketteBeginnen(kette, auftrag, nummer, args) {
  const karte = auftrag.karte;
  log(auftrag.art === "plan"
    ? `Kette ${nummer}/${args.max}: Plan #${auftrag.planId} (fachliche Quelle #${kette.F}) — ${karte.title}`
    : `Kette ${nummer}/${args.max}: Issue #${kette.F} — ${karte.title}`);
  // Das Kennzeichen ist mit dem Start verbraucht (A2): Ein Abbruch fuehrt zu einem
  // Bericht mit Grund und einer neuen Geste, nicht zur stillen Wiederholung.
  board("issue", "label", "remove", String(karte.id), kette.budget.label);
  log(`  Label '${kette.budget.label}' entfernt — jedes Setzen autorisiert genau eine Kette.`);

  if (auftrag.art === "plan") {
    kette.stufen.plan = { id: auftrag.planId, uebernommen: true, dauerMs: 0, kennzahlen: null, korrekturrunden: 0, weitere: [] };
    log(`  Plan #${auftrag.planId} uebernommen — die Stufen plan und review entfallen.`);
    return [];
  }
  // Ein vorgefundener Plan (E9) ist das Ergebnis der Stufe plan, kein neuer: Er ueberholt
  // keinen anderen, und der Ueberholt-Kommentar entfaellt.
  if (ergebnisVorhanden("plan", { F: kette.F })) return [];
  // VOR der Plan-Stufe gesammelt: Danach stuende der neue Plan mit in der Liste.
  return board("issue", "list")
    .filter((i) => stammtAusErzeugung(i, kette.F, "plan"))
    .map((i) => String(i.id));
}

/**
 * Eine Kette zu einem Auftrag: Label verbrauchen, Worktree, Stufen, Einheit.
 *
 * Rueckgabe ist der Ausgang der Kette. Der Worktree wird in jedem Fall entfernt — auch
 * nach einem Wurf mitten in einer Stufe; ein liegengebliebener raeumt der naechste Start.
 */
async function laufeEineKette(auftrag, nummer, args) {
  const karte = auftrag.karte;
  const F = String(auftrag.F);
  const einheit = einheitAnlegen(String(karte.id), karte.title);
  const kette = {
    F, art: auftrag.art, karte, args, budget: KETTE_BUDGET, repoRoot: process.cwd(), wt: null, start: new Date(),
    kosten: { kostenSumme: 0, kostenUnbekannt: 0 }, kostenGrund: null, stufen: {},
    // Die Variante steht an der gekennzeichneten Karte, nicht an der Wurzel: Wer den
    // Plan durchziehen lassen will, zeichnet den Plan (Issue #895).
    variante: varianteVon(karte, KETTE_BUDGET),
    uebergaenge: KETTE_UEBERGAENGE,
    // Der Laufstand vor dem Vorab-Stand dieses Laufs (Issue #1090) — fuer die Ergebnispruefung.
    laufstandVorher: auftrag.laufstandVorher,
  };
  // Haelt der Lauf wegen der Umgebung an, sind die naechsten die Pakete des Auftrags ohne
  // Ergebnis (E15).
  Object.assign(LAUF_KONTEXT, {
    karte: String(karte.id),
    kandidaten: () => (kette.stufen.pakete?.ids ?? []).map(String).filter((id) => !paketUmgesetzt(leseKarte(id))),
  });
  const aeltere = ketteBeginnen(kette, auftrag, nummer, args);

  let ergebnis;
  try {
    kette.wt = worktreeAnlegen({ repoRoot: kette.repoRoot, issueId: F, stempel: ZUSTAND.LAUF_STEMPEL ?? String(Date.now()) });
    // Nach dem Spiegel: Der Stand ueberschreibt die gespiegelte Kopie der Hauptkopie (Issue #1102, A3).
    kitStandInBaum(kette.wt);
    trackerImWorktreeUmleiten(kette.wt, kette.repoRoot);
    log(`  Worktree: ${kette.wt}`);
  } catch (e) {
    ergebnis = { ausgang: "abgebrochen", grund: `technischer Fehler: ${e.message}` };
  }
  try {
    if (!ergebnis) ergebnis = await stufenDerKette(kette);
    // `ohneHaltAmFachplan` setzt allein die Stufe umsetzung (E17): Dort traegt das
    // angehaltene PAKET bereits kit:klaeren, und ein zweites an der gekennzeichneten Karte
    // schloesse sie aus der naechsten Kette aus. Der Feldname bleibt der von E17.
    if (ergebnis.ausgang === "angehalten" && !ergebnis.ohneHaltAmFachplan) haltAmAuftrag(kette, ergebnis);
    // Endet die Kette, bevor sie einen Stand setzte — etwa am Worktree —, stuende sonst der
    // Vorab-Stand `laeuft` weiter an der Karte (Issue #1090, E17).
    if (!kette.standGesetzt) {
      const zustand = { abgebrochen: "abgebrochen", angehalten: "wartet" }[ergebnis.ausgang] ?? "fertig";
      ketteStand(kette, zustand, `${ergebnis.ausgang}: ${ergebnis.grund ?? "ohne Grund"}`);
    }
    const neuerPlan = kette.stufen.plan?.id;
    const ueberholung = neuerPlan && aeltere.length > 0
      ? aeltereUeberholen(kette, aeltere, neuerPlan)
      : { ueberholt: [], ueberholtUnbestaetigt: [] };
    einheitErgaenzen(einheit, {
      ausgang: ergebnis.ausgang,
      ...(ergebnis.grund ? { grund: ergebnis.grund } : {}),
      // Die Auftragsart und — nur beim Plan-Auftrag — die fachliche Wurzel (Issue #895):
      // Die Einheit traegt die Nummer der gekennzeichneten Karte, und ohne `fachplan`
      // waere von aussen nicht zu sehen, wogegen die Abdeckung gehalten hat.
      auftrag: kette.art,
      ...(kette.art === "plan" ? { fachplan: kette.F } : {}),
      variante: kette.variante,
      stufen: kette.stufen,
      ...(ueberholung.ueberholt.length > 0 ? { ueberholt: ueberholung.ueberholt } : {}),
      ...(ueberholung.ueberholtUnbestaetigt.length > 0 ? { ueberholtUnbestaetigt: ueberholung.ueberholtUnbestaetigt } : {}),
      ...(kette.abdeckungSchrieb ? { abdeckungSchrieb: true } : {}),
      // Derselbe Feldname wie an der Einheit einer Implementierungsrunde (Issue #776) und
      // aus demselben Grund WEG statt `false`, wenn der Fall nicht eintrat: Ein `false`
      // behauptete eine Messung, die es nicht gab. Der Befund kommt aus dem Ergebnis der
      // Stufe und nicht aus dem Modul-Merker — die Begruendung steht in `ketteSession`.
      ...(ergebnis.wartend ? { wartendBeendet: true } : {}),
      kostenUsd: kette.kosten.kostenSumme,
      kostenUnbekannt: kette.kosten.kostenUnbekannt,
    });
    // Der Bericht ist der letzte Schritt jeder Kette, bei jedem Ausgang (A10) — nach dem
    // Halt-Kommentar, damit er hinter der Frage steht, und vor dem Abbau des Worktrees.
    // Adressat ist die gekennzeichnete Karte, wie beim Halt (Issue #896).
    einheitErgaenzen(einheit, { bericht: berichtSchreiben(String(karte.id), berichtFuerKette(kette, einheit, ergebnis)) });
  } finally {
    if (kette.wt) {
      befundeZurueckUndVorschlagen(kette);
      worktreeEntfernen(kette.wt, kette.repoRoot);
    }
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
        log(`Hinweis: #${issue.id} traegt das Label '${alt}', das es seit Stufe 2 nicht mehr gibt — es hat keine Wirkung. Die Nacht-Kette startet ueber '${KETTE_BUDGET.label}' an der fachlichen Anforderung oder am Plandokument.`);
      }
    }
  }
}

/** Die Bestaetigungsfrist des Beanspruchens (Plan #1113, E4), ab dem eigenen Schreiben. */
export const BESTAETIGUNGSFRIST_MS = 10_000;

const bestaetigungsfristMs = () => (process.env.NIGHT_BESTAETIGUNG_MS !== undefined
  ? Number(process.env.NIGHT_BESTAETIGUNG_MS)
  : BESTAETIGUNGSFRIST_MS);

/** Der Grund, mit dem ein Runner eine Wurzel auslaesst, die ein anderer haelt (Kriterium 3 aus #1014). */
export const beanspruchtGrund = (laufId) => `bereits von einem laufenden Runner beansprucht (${laufId})`;

/** Der Name des Labels `laeuft` aus `night.stand.labels` — dieselbe Vorgabe wie in kit/board.mjs. */
const laeuftLabel = () => ZUSTAND.config?.night?.stand?.labels?.laeuft?.trim() || "lauf:laeuft";

/**
 * Die Laufstand-Kommentare einer gelesenen Karte und ihr juengster Stand fuer
 * `wurzelBelegt` — `zustand` ist `laeuft`, wenn die Karte das Label traegt.
 */
function laufstandDerKarte(karte) {
  const texte = kommentareVon(karte).filter((k) => k.startsWith("## Laufstand"));
  const zustand = (karte?.labels || []).includes(laeuftLabel()) ? "laeuft" : null;
  return { texte, stand: texte.length > 0 ? { zustand, text: texte.at(-1) } : null };
}

/**
 * Die erste Haelfte des Beanspruchens fuer eine Karte: lesen und, wenn kein lebender Runner
 * sie haelt, unmittelbar danach `laeuft` schreiben. Rueckgabe `{ grund }` fuer eine
 * ausgelassene Karte, sonst `{}`, mit `uebernommen`, wenn ein toter Halter abgeloest wurde.
 */
function lesenUndSchreiben(a, { lesen, schreiben, host, eintrag }) {
  const id = String(a.karte.id);
  const karte = lesen(id);
  if (!karte) return { grund: "Laufstand nicht lesbar — nicht beansprucht" };
  const { texte, stand } = laufstandDerKarte(karte);
  const halter = wurzelBelegt(a.F, [karte], stand ? { [id]: stand } : {}, new Date(), host);
  if (halter) return { grund: beanspruchtGrund(halter.laufId) };
  const alt = stand?.zustand === "laeuft" ? laufstandKopf(stand.text) : null;
  if (alt) log(`  #${id}: Wurzel #${a.F} uebernommen — der Runner ${alt.laufId} laeuft nicht mehr.`);
  a.laufstandVorher = texte;
  schreiben(id, "laeuft", eintrag);
  return alt ? { uebernommen: { id, laufId: alt.laufId } } : {};
}

/**
 * Beansprucht die Wurzeln der ausgewaehlten Auftraege am Board (Plan #1113, E3, E4, E7;
 * Issue #1188). Das Board kennt kein bedingtes Schreiben, darum je Karte: lesen, schreiben,
 * warten, wiederlesen.
 *
 * Traegt der gelesene Laufstand eine lebende Lauf-ID (`wurzelBelegt`), schreibt der Runner
 * nicht und laesst die Karte aus. Sonst schreibt er unmittelbar `laeuft`; der gelesene
 * Laufstand wird zu `laufstandVorher` (Grundlage von `ergebnisVorhanden`), nie einer mit
 * lebender Lauf-ID. Haelt ihn ein Runner, der nicht mehr laeuft (E5), nennt das Protokoll
 * die Uebernahme mit der alten Lauf-ID. Nach dem letzten Schreiben wartet er die Frist
 * einmal fuer alle Karten ab — jede liegt so mindestens die Frist hinter ihrem Schreiben —
 * und liest wieder: Gehoert der juengste Laufstand dann ihm, ist die Wurzel seine, denn
 * `issue stand` ersetzt immer den juengsten und der letzte Schreiber gewinnt. Sonst traegt
 * er die Karte im Journal als `abgegeben` aus und schreibt nichts mehr an sie.
 *
 * Eingespeist fuer die Tests: `lesen` (`issue get`), `schreiben` (`standSetzen`), `warten`,
 * `abgeben`, die eigene `laufId` und der Rechner `host`. Rueckgabe `{ beansprucht,
 * abgegeben, uebernommen }`; `abgegeben` traegt `{ id, title, grund }` wie `uebersprungen`.
 */
export function beanspruchen(auftraege, {
  lesen = leseKarte,
  schreiben = (karte, zustand, text) => standSetzen(karte, zustand, text),
  warten = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  abgeben: austragen = (karte) => abgeben(karte),
  laufId = `${RECHNER}/${process.pid}/${ZUSTAND.LAUF_STEMPEL}`,
  host = RECHNER,
  frist = bestaetigungsfristMs(),
} = {}) {
  const eintrag = `Lauf angenommen um ${new Date().toISOString()}, Vorabprüfung läuft`;
  const geschrieben = [];
  const abgegeben = [];
  const uebernommen = [];
  const auslassen = (a, grund) => abgegeben.push({ id: String(a.karte.id), title: a.karte.title ?? "", grund });
  for (const a of auftraege) {
    const gelesen = lesenUndSchreiben(a, { lesen, schreiben, host, eintrag });
    if (gelesen.grund) auslassen(a, gelesen.grund);
    else geschrieben.push(a);
    if (gelesen.uebernommen) uebernommen.push(gelesen.uebernommen);
  }
  if (geschrieben.length > 0) warten(frist);
  const beansprucht = [];
  for (const a of geschrieben) {
    const id = String(a.karte.id);
    const karte = lesen(id);
    const juengster = karte ? laufstandKopf(laufstandDerKarte(karte).stand?.text) : null;
    if (juengster?.laufId === laufId) {
      beansprucht.push(a);
      continue;
    }
    austragen(id);
    auslassen(a, karte ? beanspruchtGrund(juengster?.laufId ?? "ohne Lauf-ID") : "Bestaetigung nicht lesbar — nicht beansprucht");
  }
  return { beansprucht, abgegeben, uebernommen };
}

/**
 * Wer haelt welche Wurzel (Issue #1188)? Gelesen werden nur Karten mit dem Label `laeuft`,
 * die eine Wurzel tragen koennen: eine gekennzeichnete Karte, ihre fachliche Quelle und
 * die Plaene zu ihr. Rueckgabe ist `belegt(F)` fuer `waehleKettenKandidaten` und
 * `waehlePruefLaufKandidaten`.
 */
function belegteWurzeln(alle, label) {
  const wurzeln = new Set();
  for (const i of alle.filter((k) => (k?.labels || []).includes(label))) {
    wurzeln.add(String(i.id));
    const quelle = isPlan(i?.title ?? "") ? fachlicheQuelleVon(i?.body || "") : null;
    if (quelle) wurzeln.add(quelle);
  }
  const lesbar = (i) => wurzeln.has(String(i.id)) || (isPlan(i?.title ?? "") && wurzeln.has(fachlicheQuelleVon(i?.body || "")));
  const staende = new Map();
  for (const i of alle.filter((k) => (k?.labels || []).includes(laeuftLabel()) && lesbar(k))) {
    const karte = leseKarte(i.id);
    const stand = karte ? laufstandDerKarte(karte).stand : null;
    if (stand) staende.set(String(i.id), stand);
  }
  const jetzt = new Date();
  return (F) => wurzelBelegt(F, alle, staende, jetzt, RECHNER);
}

/**
 * Der Vorab-Stand (Issue #1090, E17), seit #1188 das Beanspruchen mit Bestaetigung: Stirbt
 * der Lauf in der Vorabpruefung, zeigt die Karte, dass er sie angenommen hatte
 * (Belegfall 1). Nicht im Trockenlauf — er veraendert kein Label. Seit #1189 geht auch der
 * Prueflauf diesen Weg, mit seinen Karten als eigene Wurzel. Der Laufstand vorher steht
 * danach am Auftrag (E10).
 */
function vorabStandSetzen(args, auftraege) {
  if (args.dryRun) return { beansprucht: auftraege, abgegeben: [] };
  auftraege.forEach((a, i) => laufPositionSetzen(a.karte.id, { k: i + 1, n: auftraege.length }));
  return beanspruchen(auftraege);
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
  const auswahl = waehleKettenKandidaten(alle, budget.label, args.max, { belegt: belegteWurzeln(alle, budget.label) });
  const { liegengeblieben } = auswahl;
  uebersprungeneVerbuchen(auswahl.uebersprungen, alle, budget.label, args.dryRun);
  for (const l of liegengeblieben) {
    log(`  #${l.id} ${l.title} -> ueber --max ${args.max}, bleibt liegen.`);
    einheitErgaenzen(einheitAnlegen(l.id, l.title), { ausgang: "liegengeblieben" });
  }

  // Direkt nach der Auswahl beanspruchen (E7): Wer die Bestaetigung verliert, weicht wie
  // eine belegte Wurzel aus der Auswahl.
  const { beansprucht: auftraege, abgegeben } = vorabStandSetzen(args, auswahl.kandidaten);
  uebersprungeneVerbuchen(abgegeben, alle, budget.label, args.dryRun);
  const uebersprungen = [...auswahl.uebersprungen, ...abgegeben];
  // Vorflug, Nicht-gestartet-Kommentar und Tracker-Probe arbeiten mit Karten, nicht mit
  // Auftraegen (Issue #895): Ihr Verhalten haengt an keiner der beiden Auftragsarten.
  const kandidaten = auftraege.map((a) => a.karte);
  if (kandidaten.length === 0 && uebersprungen.length === 0 && !alle.some((i) => (i.labels || []).includes(budget.label))) {
    const vorhanden = [...new Set(alle.flatMap((i) => i.labels || []))];
    log(`WARNUNG: keine Karte traegt das Label '${budget.label}' — es wird nichts verarbeitet.`);
    log(`  Vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
  }

  // Der Reviewer-Vorflug bleibt (A16): Die Pruefer-Session braucht die Reviewer in ihrer
  // eigenen Sandbox, und die Vorflug-Session ist die einzige Probe dafuer.
  await fuehreVorflug(args, kandidaten, "--kette --dry-run", (grund) => ketteNichtGestartet(kandidaten, grund));

  if (kandidaten.length === 0) {
    if (uebersprungen.length > 0) {
      vermerkeOhneArbeit("ketteAlleUebersprungen", { anzahl: uebersprungen.length, label: budget.label });
    } else {
      vermerkeOhneArbeit("ketteKeinLabel", { label: budget.label });
    }
    laufAbschliessen("regulaer");
    process.exit(0);
  }

  if (args.dryRun) {
    log(`Budget: Plan ${budget.planMin} min, Pakete ${budget.paketeMin} min, Review ${budget.reviewMin} min, Abdeckung ${budget.abdeckungMin} min, ${budget.kostenUsd} $ je Kette, ${budget.korrekturrunden} Korrekturrunde(n).`);
    auftraege.forEach((a, i) => {
      const art = a.art === "plan" ? `Plan-Auftrag, fachliche Quelle #${a.F}, ` : "";
      log(`  #${a.karte.id} ${a.karte.title} -> Kette ${i + 1} (${art}Variante ${varianteVon(a.karte, budget)})`);
    });
    log(`Dry-Run beendet: ${auftraege.length} Kette(n) wuerden laufen — kein Worktree, kein Label veraendert.`);
    process.exit(0);
  }

  const zaehler = Object.fromEntries(KETTE_AUSGAENGE.map((a) => [a, 0]));
  let nummer = 0;
  for (const auftrag of auftraege) {
    nummer++;
    const ausgang = await laufeEineKette(auftrag, nummer, args);  // NOSONAR S9382: Ketten laufen einzeln, sonst raeumen sie sich die Worktrees weg
    zaehler[ausgang]++;
  }
  log(`Nacht-Kette beendet: ${zaehler.fertig} fertig, ${zaehler.unvollstaendig} unvollstaendig, ${zaehler.angehalten} angehalten, ${zaehler.abgebrochen} abgebrochen, ${uebersprungen.length} uebersprungen, ${liegengeblieben.length} liegengeblieben, ${NICHT_BEGONNEN_GESAMT} Paket(e) nicht begonnen.`);
  log(`Morgen-Ritual: Plaene und Pakete sichten, Abdeckung lesen, Pakete nach Ready ziehen — das GO bleibt deins. Nach Variante A liegen die Pakete morgens in Backlog; Variante B (Label '${budget.varianteBLabel}') hat sie in derselben Nacht umgesetzt, sie stehen dann in In review. Protokoll: ${ZUSTAND.LOG_FILE}`);
  laufAbschliessen("regulaer");
  process.exit(0);
}

// --- Der Prueflauf am Tag (Fachplan #899, Plan #904; Issue #909) ---
//
// Ein Lauf, der mehrere gekennzeichnete fachliche Anforderungen nacheinander pruefen laesst:
// je Karte eine Session `/issue-review #N`, alle in EINEM Worktree je Lauf. Er bewegt keine
// Karte, zieht nichts nach Ready, setzt kein `kit:night` und nimmt kein `kit:klaeren` ab. Er
// laeuft am Tag, neben dem arbeitenden Menschen und neben einer Nacht-Kette — deshalb faellt
// er weder auf einen unsauberen Arbeitsbaum noch auf ein Paket in In progress herein.
//
// Der dritte Modus des vorhandenen Runners und keine eigene Kit-Datei (Plan #904, E1):
// Sessionstart, Worktree, Ergebnisstand, Protokoll und die Kosten- und Wartend-Erkennung
// liegen hier und sind zum Teil nicht exportiert.

/** Der Worktree-Praefix des Prueflaufs — getrennt von dem der Kette (Issue #908). */
const PRUEFLAUF_PRAEFIX = "pruefung";

/** Die Stufe, unter der die Sessions des Prueflaufs laufen (NIGHT_KETTE_STUFE). */
const PRUEFLAUF_STUFE = "pruefung";

/**
 * Der Vorflug ist vor der ersten Pruefung gescheitert: jeder Kandidat bekommt den Kommentar
 * `Pruefung nicht gestartet` mit Grund, das Kennzeichen bleibt — die Geste ist nicht
 * verbraucht, denn es lief nichts. Ohne `fail`, weil der Aufrufer gleich selbst hart stoppt.
 *
 * Zwilling von `ketteNichtGestartet` und bewusst nicht mit ihm geteilt: Der erste Satz nennt
 * den Lauf, und ein Kommentar, der am Tag von einer Kette spraeche, schickte den Leser in die
 * falsche Ecke.
 */
function pruefungNichtGestartet(kandidaten, grund) {
  for (const k of kandidaten) {
    const res = boardRoh("issue", "comment", String(k.id), "--text", `Pruefung nicht gestartet: ${grund}`);
    log(res.status === 0
      ? `  #${k.id}: Kommentar 'Pruefung nicht gestartet' geschrieben, Kennzeichen bleibt.`
      : `  #${k.id}: Kommentar 'Pruefung nicht gestartet' nicht geschrieben (${res.text.slice(0, 120)}).`);
  }
}

/**
 * Die eine Session einer Pruefung, mit Zeitbudget (Plan #904).
 *
 * Nach dem Muster von `ketteSession`, aber ohne Stufen: Es gibt genau eine Session je Karte,
 * ihr Zeitbudget ist `pruefungMin`, und Korrekturrunden kennt der Lauf nicht. Die Kosten
 * gehen auf den LAUF, nicht auf die Karte — der Deckel gilt dem Lauf.
 *
 * Rueckgabe: `{ dauerMs, kennzahlen, kosten }`, bei einem Abbruch dazu `abbruch` mit dem
 * Grund. Ob daraus `unvollstaendig` wird, entscheidet allein der Unterschied der Board-Spuren
 * (`pruefLaufErgebnis`): Eine Session kann am Zeitlimit sterben, nachdem sie fertig war.
 */
async function pruefLaufSession(lauf, id) {
  const budgetMs = lauf.budget.pruefungMin * 60 * 1000;
  const t = Date.now();
  const res = await runSession(id, lauf.args, {
    prompt: `/issue-review #${id}\n\n${KETTE_ZUSATZ}`,
    cwd: lauf.wt, stream: true, stufe: PRUEFLAUF_STUFE, timeoutMs: budgetMs,
  });
  const dauerMs = Date.now() - t;
  const kennzahlen = leseKennzahlen(res.stdout);
  // Dreimal dieselbe Kennzahl, drei verschiedene Empfaenger: die Karte (ihre Einheit), der
  // Lauf (sein Deckel) und der Lauf-Kopf (sein Verbrauch).
  const messung = { dauerMs, kennzahlen, kosten: kostenAddieren({}, kennzahlen) };
  kostenAddieren(lauf.kosten, kennzahlen);
  if (ZUSTAND.LAUF) kostenAddieren(ZUSTAND.LAUF, kennzahlen);

  const minuten = (dauerMs / 60000).toFixed(1);
  if (res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM") {
    return { ...messung, abbruch: `Zeitbudget: die Session wurde nach ${minuten} min am Limit beendet` };
  }
  if (res.error || res.status !== 0) {
    const exitInfo = res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`;
    return { ...messung, abbruch: `technischer Fehler: die Session endete mit ${exitInfo}` };
  }
  // Die wartende Sitzung (Plan #773) hinter Zeitbudget und technischem Fehler, weil sie ein
  // REGULAERES Ende verfeinert: Die Session hat eine lange Arbeit angestossen, darauf
  // gewartet und damit ihren Zug beendet.
  const schlusstext = leseErgebnisText(res.stdout);
  if (wartendeSession(schlusstext)) return { ...messung, abbruch: GRUND_WARTEND, wartend: true, schlusstext };
  return messung;
}

/**
 * Eine Karte pruefen lassen: Fassung, Kennzeichen, Session, Ergebnis, Vermerk, Einheit.
 *
 * Rueckgabe ist die Zeile der Ergebnisliste als Objekt — der Lauf sammelt sie und schreibt
 * sie am Ende aus.
 */
async function pruefeEineKarte(lauf, issue, nummer) {
  const id = String(issue.id);
  const titel = issue.title ?? "";
  const einheit = einheitAnlegen(id, titel);
  // Der Vorher-Stand kommt frisch vom Board und nicht aus der Kandidatenliste: Zwischen der
  // Auswahl und dieser Zeile liegen der Vorflug und alle vorigen Pruefungen des Laufs.
  const vorher = leseKarte(id);
  if (!vorher) {
    const grund = "die Karte ist nicht lesbar — es lief keine Session, das Kennzeichen bleibt";
    log(`Pruefung ${nummer}/${lauf.gesamt}: Issue #${id} uebersprungen (${grund}).`);
    pruefLaufStandSetzen(id, { ausgang: "uebersprungen", grund });
    einheitErgaenzen(einheit, { ausgang: "uebersprungen", grund });
    return { id, titel, ausgang: "uebersprungen", grund };
  }

  // Die gepruefte Fassung (E7): gebildet unmittelbar vor der Session. Wer den Text waehrend
  // der Pruefung aendert, sieht hinterher am Fingerabdruck, dass eine andere Fassung gelesen
  // wurde — erkennen kann der Lauf die Aenderung nicht.
  const fassung = pruefLaufFassung(vorher.body);
  log(`Pruefung ${nummer}/${lauf.gesamt}: Issue #${id} — ${titel} (Fassung ${fassung})`);
  // Das Kennzeichen ist mit dem Start verbraucht (E2): Ein Abbruch fuehrt zu einem Vermerk
  // mit Grund und einer neuen Geste, nicht zur stillen Wiederholung.
  board("issue", "label", "remove", id, lauf.budget.label);
  log(`  Label '${lauf.budget.label}' entfernt — jedes Setzen autorisiert genau eine Pruefung.`);
  // Und `review:fertig` gleich mit (E16): Nur so beantwortet der Nachher-Stand die Frage nach
  // DIESER Session und nicht die nach einem Vorlauf. `kit:klaeren` nimmt der Lauf nie ab —
  // das darf allein ein Mensch.
  if (hatReviewFertigLabel(vorher)) {
    board("issue", "label", "remove", id, REVIEW_FERTIG_LABEL);
    log(`  Label '${REVIEW_FERTIG_LABEL}' aus einem Vorlauf entfernt — nur diese Session darf es neu setzen.`);
  }

  // Die Session hat ihr eigenes Protokoll (Issue #1090, E16): Laeuft daneben eine Kette,
  // stehen ihre Zeilen sonst verschraenkt im selben Tagesprotokoll (Belegfall 5).
  const vorherLog = schrittBeginnen(id, PRUEFLAUF_STUFE);
  let s;
  try {
    s = await pruefLaufSession(lauf, id);
  } finally {
    schrittEnden(vorherLog);
  }
  const nachher = leseKarte(id) ?? vorher;
  const ergebnis = pruefLaufErgebnis(vorher, nachher);

  if (s.wartend) {
    // Eine wartende Sitzung bekommt NUR diesen Vermerk und keinen zweiten: Zwei Kommentare
    // fuer einen Abbruch sagen nichts, was einer nicht sagt.
    wartendVermerken(id, PRUEFLAUF_STUFE, s.schlusstext);
  } else if (ergebnis.ausgang === "unvollstaendig") {
    pruefLaufRestVermerken(id, s.abbruch ?? PRUEFLAUF_OHNE_MARKER, ergebnis.schritt, neueKommentare(vorher, nachher));
  }
  pruefLaufStandSetzen(id, { ...ergebnis, grund: s.abbruch ?? PRUEFLAUF_OHNE_MARKER });

  einheitErgaenzen(einheit, {
    ausgang: ergebnis.ausgang,
    fassung,
    ...(ergebnis.schritt ? { schritt: ergebnis.schritt } : {}),
    ...(ergebnis.frage ? { frage: ergebnis.frage } : {}),
    ...(s.abbruch ? { grund: s.abbruch } : {}),
    // Derselbe Feldname wie an der Einheit einer Implementierungsrunde (Issue #776) und aus
    // demselben Grund WEG statt `false`, wenn der Fall nicht eintrat.
    ...(s.wartend ? { wartendBeendet: true } : {}),
    dauerMs: s.dauerMs,
    kennzahlen: s.kennzahlen,
    kostenUsd: s.kosten.kostenSumme,
    kostenUnbekannt: s.kosten.kostenUnbekannt,
  });
  const zusatz = s.abbruch ? ` — ${s.abbruch}` : "";
  log(`  Pruefung #${id}: ${ergebnis.ausgang}${zusatz} (${s.kosten.kostenSumme.toFixed(2)} $).`);
  return { id, titel, fassung, ...ergebnis, ...(s.abbruch ? { grund: s.abbruch } : {}) };
}

/** Der Grund einer unvollstaendigen Pruefung, deren Session ohne Abbruch endete. */
const PRUEFLAUF_OHNE_MARKER = "die Session endete, ohne den Fachplan-Review-Marker zu setzen";

/** Setzt den Laufstand einer Karte des Prueflaufs nach ihrem Ausgang (E8). */
function pruefLaufStandSetzen(id, ergebnis) {
  const { zustand, text } = pruefLaufStand(ergebnis);
  standSetzen(id, zustand, text);
}

/**
 * Eine Zeile der Ergebnisliste (Plan #904, E4).
 *
 * Die Liste steht auf der Konsole, weil der Lauf dem Tag gehoert: Wer ihn startet, sieht sein
 * Ergebnis. Je Ausgang steht genau das dabei, was den naechsten Schritt bestimmt — bei einer
 * wartenden Entscheidung die Frage, bei einem Abbruch der erreichte Schritt.
 */
function pruefLaufZeile(e) {
  const fassung = e.fassung ? `, Fassung ${e.fassung}` : "";
  switch (e.ausgang) {
    case "geprueft":
      return `  #${e.id} ${e.titel}: geprueft${fassung}`;
    case "klaeren":
      return `  #${e.id} ${e.titel}: wartende Entscheidung${fassung}, Frage: ${ersteZeile(e.frage)}`;
    case "unvollstaendig":
      return `  #${e.id} ${e.titel}: unvollstaendig${fassung}, erreichter Schritt: ${e.schritt}`;
    default:
      return `  #${e.id} ${e.titel}: ${e.ausgang} — ${e.grund}`;
  }
}

/**
 * Eine Karte, die dieser Lauf nicht (mehr) prueft: Protokollzeile, Einheit, Listenzeile.
 *
 * Drei Anlaesse, ein Weg — der Ausschluss bei der Auswahl, der Zahlendeckel und der
 * erschoepfte Kostendeckel. Sie unterscheiden sich allein im Ausgang und im Grund, und drei
 * Stellen, die dasselbe verbuchen, liefen bei der ersten Aenderung auseinander.
 */
function pruefLaufOhneSession(ergebnisse, id, titel, ausgang, grund) {
  log(`  #${id} ${titel} -> ${ausgang} (${grund})`);
  einheitErgaenzen(einheitAnlegen(id, titel), { ausgang, grund });
  ergebnisse.push({ id: String(id), titel, ausgang, grund });
}

/**
 * Verbucht die Auswahl des Prueflaufs und nennt die Kandidaten (Plan #904, E7, E10).
 *
 * Alles vor der ersten Session an einer Stelle: die Karten, die nicht laufen, die Warnung bei
 * einem Label, das nirgends vorkommt, und die Kandidatenliste samt Fassung. Eine Vorschau
 * bekommt der Lauf nicht, also ist diese Liste die einzige Stelle, an der VORHER steht, was
 * laufen wird.
 */
function pruefLaufAuswahlMelden(args, budget, alle, auswahl, ergebnisse) {
  const { kandidaten, uebersprungen, liegengeblieben } = auswahl;
  for (const u of uebersprungen) {
    pruefLaufOhneSession(ergebnisse, u.id, u.title, "uebersprungen", u.grund);
  }
  for (const l of liegengeblieben) {
    pruefLaufOhneSession(ergebnisse, l.id, l.title, "liegengeblieben", `ueber --max ${args.max}, bleibt liegen`);
  }
  if (kandidaten.length === 0 && uebersprungen.length === 0 && liegengeblieben.length === 0) {
    const vorhanden = [...new Set(alle.flatMap((i) => i.labels || []))];
    log(`WARNUNG: keine Karte traegt das Label '${budget.label}' — es wird nichts geprueft.`);
    log(`  Vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
  }
  kandidaten.forEach((k, i) => {
    log(`  #${k.id} ${k.title} -> Pruefung ${i + 1}/${kandidaten.length} (Fassung ${pruefLaufFassung(k.body)})`);
  });
}

/**
 * Die Pruefungen eines Laufs, eine nach der anderen, in EINEM Worktree (Plan #904, E11).
 *
 * Der Worktree wird in jedem Fall entfernt — auch nach einem Wurf mitten in einer Pruefung;
 * einen liegengebliebenen raeumt der naechste Start ab.
 */
async function pruefLaufRunden(lauf, kandidaten, ergebnisse) {
  try {
    // Die Sessions lesen und schreiben am Board, nicht im Arbeitsbaum — ein Worktree je Karte
    // kostete Zeit fuer eine Trennung ohne Gegenstand.
    lauf.wt = worktreeAnlegen({ repoRoot: lauf.repoRoot, stempel: ZUSTAND.LAUF_STEMPEL ?? String(Date.now()), praefix: PRUEFLAUF_PRAEFIX });
    // Nach dem Spiegel: Der Stand ueberschreibt die gespiegelte Kopie der Hauptkopie (Issue #1102, A3).
    kitStandInBaum(lauf.wt);
    trackerImWorktreeUmleiten(lauf.wt, lauf.repoRoot);
    log(`Worktree des Laufs: ${lauf.wt}`);

    let nummer = 0;
    for (const issue of kandidaten) {
      nummer++;
      // Ein Abbruch beendet nur diese Karte (E3): Die naechste kommt dran, und der Grund steht
      // an ihrer Einheit und in der Liste.
      ergebnisse.push(await pruefeEineKarte(lauf, issue, nummer));
      // Der Kostendeckel gilt dem LAUF und wird NACH jeder Session geprueft, nie mittendrin:
      // Eine halb gelesene Pruefung waere der teurere Fehler.
      if (lauf.kosten.kostenSumme > lauf.budget.kostenUsd) {
        const grund = `Kostenbudget: ${lauf.kosten.kostenSumme.toFixed(2)} $ von ${lauf.budget.kostenUsd} $ nach Pruefung ${nummer}`;
        for (const rest of kandidaten.slice(nummer)) {
          pruefLaufOhneSession(ergebnisse, rest.id, rest.title ?? "", "uebersprungen", grund);
          pruefLaufStandSetzen(rest.id, { ausgang: "uebersprungen", grund });
        }
        return;
      }
    }
  } finally {
    // Erst die im Worktree gebuchten Befunde zurueck, dann der Abbau (Issue #1028) — auch
    // nach einem Wurf, sonst gingen sie mit dem Worktree verloren.
    if (lauf.wt) {
      befundeZurueckUndVorschlagen(lauf);
      worktreeEntfernen(lauf.wt, lauf.repoRoot);
    }
  }
}

/**
 * Programm Prueflauf (Plan #904): Kandidaten, Vorflug, ein Worktree, Karte fuer Karte.
 * Beendet den Prozess selbst, wie die Kette und der Dry-Run.
 */
export async function laufePrueflauf(args) {
  const budget = PRUEFLAUF_BUDGET;
  const repoRoot = process.cwd();
  const defaultsZeile = budgetDefaultsZeile(budget, PRUEFLAUF_BUDGET_AUS_DEFAULT, PRUEFLAUF_BUDGET_TEXT);
  if (defaultsZeile) log(defaultsZeile);
  // Nur der eigene Praefix (Issue #908): Eine Nacht-Kette kann daneben laufen, und ihr
  // Worktree gehoert ihr.
  for (const p of worktreesAufraeumen(repoRoot, PRUEFLAUF_PRAEFIX)) log(`Liegengebliebenen Worktree entfernt: ${p}`);

  const alle = board("issue", "list");
  const gewaehlt = waehlePruefLaufKandidaten(alle, budget.label, args.max, { belegt: belegteWurzeln(alle, budget.label) });
  // Direkt nach der Auswahl beanspruchen wie die Kette (Plan #1113, E8): Erst damit sieht
  // eine Kette oder ein zweiter Prueflauf, dass dieser Lauf die Wurzel haelt. Wer die
  // Bestaetigung verliert, weicht wie eine belegte Wurzel.
  const { beansprucht, abgegeben } = vorabStandSetzen(args, gewaehlt.kandidaten.map((karte) => ({ karte, F: String(karte.id) })));
  const kandidaten = beansprucht.map((a) => a.karte);
  const uebersprungen = [...gewaehlt.uebersprungen, ...abgegeben];
  const auswahl = { ...gewaehlt, kandidaten, uebersprungen };
  const ergebnisse = [];
  pruefLaufAuswahlMelden(args, budget, alle, auswahl, ergebnisse);

  // Der Reviewer-Vorflug wie bei der Kette: Die Pruefer-Session braucht die Reviewer in ihrer
  // eigenen Sandbox, und die Vorflug-Session ist die einzige Probe dafuer. Scheitert er,
  // behaelt jeder Kandidat sein Kennzeichen und bekommt einen Kommentar — es lief nichts.
  await fuehreVorflug(args, kandidaten, "/issue-review --dry-run", (grund) => pruefungNichtGestartet(kandidaten, grund));

  if (kandidaten.length === 0) {
    if (uebersprungen.length > 0) {
      vermerkeOhneArbeit("pruefLaufAlleUebersprungen", { anzahl: uebersprungen.length, label: budget.label });
    } else {
      vermerkeOhneArbeit("pruefLaufKeinLabel", { label: budget.label });
    }
    laufAbschliessen("regulaer");
    process.exit(0);
  }

  const lauf = {
    args, budget, repoRoot, wt: null, gesamt: kandidaten.length,
    kosten: { kostenSumme: 0, kostenUnbekannt: 0 },
  };
  await pruefLaufRunden(lauf, kandidaten, ergebnisse);

  log("Ergebnisliste des Prueflaufs:");
  for (const e of ergebnisse) log(pruefLaufZeile(e));
  const zahl = (ausgang) => ergebnisse.filter((e) => e.ausgang === ausgang).length;
  log(`Prueflauf beendet: ${zahl("geprueft")} geprueft, ${zahl("klaeren")} mit wartender Entscheidung, `
    + `${zahl("unvollstaendig")} unvollstaendig, ${zahl("uebersprungen")} uebersprungen, ${zahl("liegengeblieben")} liegengeblieben.`);
  log(`Danach: Eine geprueft hinterlassene Karte erfuellt die Aufnahmevoraussetzung der Nacht-Kette — das GO bleibt deins. `
    + `Eine Karte mit '${KLAEREN_LABEL}' wartet auf deine Antwort; das Label nimmt nur ein Mensch ab. Protokoll: ${ZUSTAND.LOG_FILE}`);
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
function dryRunStufenVermerk({ modell, herkunft, stufe, stufeVerwendet, grund, effort }) {
  if (herkunft === "karte") return `, Modell ${modell} (Karte)`;
  if (herkunft === "lauf") {
    const nachsatz = grund ? ` — ${grund}` : "";
    return `, Modell ${modell} (Lauf)${nachsatz}`;
  }
  const stufeText = stufeVerwendet === stufe ? `Stufe ${stufe}` : `Stufe ${stufe} nicht belegt`;
  // Die Gruendlichkeit steht hinten und nur, wenn sie gesetzt ist (Issue #846): Wer vor
  // der Nacht prueft, WOMIT ein Paket liefe, prueft auch, wie gruendlich — ohne sie bleibt
  // die Zeile zeichengleich mit der von vor dieser Aenderung.
  const effortText = effort ? `, Gruendlichkeit ${effort}` : "";
  return `, ${stufeText}, Modell ${modell} (Stufe ${stufeVerwendet})${effortText}`;
}

// Die vier Titel-Praefixe, deren Karte keine Session umsetzt, mit dem Wort, das der Dry-Run
// dafuer nennt. Als Tabelle und nicht als vier `if`-Zeilen: Der Dry-Run muss dieselbe Auskunft
// geben wie `pruefeIssueGates` im echten Lauf, und eine Liste an einer Stelle laeuft mit der
// Reihenfolge dort nicht auseinander (Issue #984).
const DRY_RUN_PRAEFIXE = [
  [isFachlich, "fachliches Issue"],
  [isIdee, "Idee"],
  [isPlan, "Plan-Dokument"],
  [isMensch, "Menschenschritt"],
];

/** Der Befund des Body-Gates aus `geschuetztGate` im Konjunktiv, `null` ohne Halt (Issue #1047). */
function dryRunGeschuetzt(issue, full) {
  const treffer = geschuetzteTreffer(full.body || "", issue.title || full.title || "", hauptWurzel());
  if (treffer.length === 0) return null;
  const kommentare = kommentareVon(full).map((k) => ({ body: k }));
  if (geschuetztFreigabe(treffer, kommentare, full.labels || issue.labels || [])) return null;
  return `wuerde ins Backlog (geschuetzte Datei ${treffer.map((t) => t.pfad).join(", ")})`;
}

function dryRunBefund(issue, ctx, assumedDone) {
  let befund = null;
  const aus = (grund) => ({ grund, vermerk: "", befund });
  if (!ctx.hasLabel(issue)) return aus(`uebersprungen (kein Label '${ctx.labelFilter}')`);
  const praefix = DRY_RUN_PRAEFIXE.find(([passt]) => passt(issue.title));
  if (praefix) return aus(`wuerde ins Backlog (${praefix[1]}, wird nicht implementiert)`);
  if (hatKlaerenLabel(issue)) return aus("wuerde ins Backlog (kit:klaeren, offene Entscheidung)");
  // Beide Gates fuer geschuetzte Dateien in der Reihenfolge von `pruefeIssueGates` (Issue
  // #1047, Plan #987, E19): erst das Label, das auch eine Karte ohne Pfad im Body traegt,
  // dann der Treffer, sofern der Mensch ihn nicht nach E5 freigegeben hat.
  if (hatGeschuetztLabel(issue)) return aus(`wuerde ins Backlog (${GESCHUETZT_LABEL}, menschliche Handlung wartet)`);

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
    if (!freigabe.frei) return aus(`wuerde ins Backlog (${GATE_ABLEHNUNG[freigabe.art].kurz()})`);
  }
  const unmet = parseDeps(full.body).filter((d) => !assumedDone.has(d));
  if (unmet.length > 0) {
    return aus(`wuerde ins Backlog (Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt)`);
  }

  // Ohne aktive Einstellung bleibt die Zeile zeichengleich mit der von vor #712 (Kriterium
  // 1 des Issues) — dieselben zwei Zweige wie bisher, unveraendert.
  const einstellung = stufenEinstellung(ZUSTAND.config);
  if (!einstellung.aktiv) {
    // Das Modell gehoert in den Dry-Run (Issue #665): Wer vor der Nacht prueft, was
    // laufen wuerde, prueft auch, WOMIT. Herkunft dazu, sonst liesse sich ein Rueckfall
    // auf das Lauf-Modell nicht von einer Karte unterscheiden, die es selbst empfiehlt.
    const { modell, grund } = empfohlenesModell(full.body, ZUSTAND.config.night?.modelle);
    if (modell) return { grund: null, vermerk: `, Modell ${modell} (Karte)`, befund };
    const nachsatz = grund ? ` — ${grund}` : "";
    return { grund: null, vermerk: `, Modell ${ctx.laufModell} (Lauf)${nachsatz}`, befund };
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
    return aus(`wuerde nicht starten (keine startbare Stufe fuer Aufgabenstufe ${modellStand.stufe}: ${modellStand.grund})`);
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
      log(`  #${issue.id} ${issue.title} -> ueber --max ${args.max}, bliebe liegen`);
      befundZeilen.forEach((zeile) => log(zeile));
      continue;
    }
    planned++;
    assumedDone.add(Number(issue.id));
    log(`  #${issue.id} ${issue.title} -> Session ${planned}${vermerk}`);
    befundZeilen.forEach((zeile) => log(zeile));
  }
  log(`Dry-Run beendet: ${planned} Session(s) wuerden starten.`);
  process.exit(0);
}

/**
 * Die sieben Gruende, aus denen ein Ready-Issue nicht implementiert wird (Issue #404, #984).
 *
 * Rueckgabe: `null`, wenn das Issue drankommt — sonst `{ log, kommentar }` mit der
 * Protokollzeile und dem Text, der am Board haengen bleibt. Der Aufrufer verschiebt
 * das Issue danach ins Backlog; welcher Grund gilt, entscheidet allein diese
 * Funktion.
 *
 * Der volle Body wird erst geholt, wenn die fuenf Titel- und Label-Gates durch sind.
 * Ihn vorher zu laden waere ein Board-Aufruf je Issue, das ohnehin ausscheidet.
 *
 * SYNC: Die fuenf Backlog-Kommentare der Titel- und Label-Gates stehen ohne das Praefix
 * `Nachtlauf: ` als `AUFTRAG_BACKLOG_TEXTE` in kit/board.mjs (`issue auftrag`, Issue
 * #1023). Wer einen hier aendert, aendert ihn dort mit — der Gleichlauf-Test in
 * test/ablauf-board-dokumente-auftrag.test.mjs vergleicht beide Seiten.
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
      kommentar: `Nachtlauf: Idee — mit Abwaegung erst /fachplan #${top.id}, ohne Abwaegung /task #${top.id}, wird nicht implementiert.`,
    };
  }
  if (isPlan(top.title)) {
    return {
      log: `#${top.id} uebersprungen: Plan-Dokument ([Plan]), wird nicht implementiert.`,
      kommentar: `Nachtlauf: Plan-Dokument — wird nicht implementiert, bitte per /issues #${top.id} in Arbeitspakete ueberfuehren.`,
    };
  }
  // Der Menschenschritt (Issue #984): Die Aufgabe liegt ausserhalb des Repositories, kein Zug
  // einer Sitzung erledigt sie. Der Kommentar sagt ausdruecklich, dass die Karte wartet und
  // nicht gescheitert ist — sonst sieht sie im Backlog aus wie ein gescheitertes Paket, und
  // wer morgens die Spalten liest, findet sie nicht mehr da, wo er sie hingelegt hat.
  if (isMensch(top.title)) {
    return {
      log: `#${top.id} uebersprungen: Menschenschritt ([Mensch]), wird nicht implementiert.`,
      kommentar: "Nachtlauf: Menschenschritt — wird nicht implementiert, die Karte wartet auf einen Menschen und ist nicht gescheitert.",
    };
  }
  // Das Label bleibt dabei stehen: Es abzunehmen ist Sache des Menschen (A4).
  if (hatKlaerenLabel(top)) {
    return {
      log: `#${top.id} uebersprungen: traegt ${KLAEREN_LABEL}, eine offene Entscheidung wartet.`,
      kommentar: "Nachtlauf: Traegt kit:klaeren — eine offene Entscheidung wartet auf einen Menschen, wird nicht implementiert.",
    };
  }
  // Auch dieses Label bleibt stehen (E11): Erst wenn der Mensch es abnimmt, prueft das
  // Body-Gate unten die Freigabe.
  if (hatGeschuetztLabel(top)) {
    return {
      log: `#${top.id} uebersprungen: traegt ${GESCHUETZT_LABEL}, eine menschliche Handlung an einer geschuetzten Datei wartet.`,
      kommentar: GESCHUETZT_LABEL_GATE_TEXT,
    };
  }

  const full = gateKarte(top);
  // Vor Review- und Abhaengigkeits-Gate (E10): Der Befund nennt dem Menschen eine Handlung,
  // die teurere Auskunft gehoert zuerst gemeldet.
  const geschuetzt = geschuetztGate(top, full);
  if (geschuetzt) return geschuetzt;
  // Ungepruefte Issues zurueckstellen (Issue #223). Nur wenn ausdruecklich aktiviert:
  // Ein Kit-Update darf keinem Bestandsprojekt ueber Nacht den Runner anhalten, deshalb
  // ist der Default false. Anders als bei [Fachlich]/[Idee] wuerde der Runner ein
  // ungepruftes Issue nicht ablehnen — er wuerde es implementieren, und die Maengel
  // fielen erst im Code auf.
  if (ZUSTAND.config.issueReview?.requiredBeforeReady) {
    const freigabe = reviewFreigabe(full.body);
    if (!freigabe.frei) {
      const texte = GATE_ABLEHNUNG[freigabe.art];
      return {
        log: `#${top.id} ${texte.log()}`,
        kommentar: `Nachtlauf: ${texte.kommentar(top.id)}`,
      };
    }
  }

  // Der Befund erst, wenn es Abhaengigkeiten gibt: Ein Paket mit "Keine." kostet so
  // keinen Abruf der Sperrspalten mehr als vorher.
  if (parseDeps(full.body).length === 0) return null;
  const befund = abhaengigkeitsBefund(top, full.body, satisfiedIds());
  const unmet = befund.abhaengigkeiten.filter((a) => !a.erfuellt).map((a) => a.nummer);
  if (unmet.length > 0) {
    return {
      unmet,
      log: `#${top.id} zurueckgestellt: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt.`,
      kommentar: `Nachtlauf: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.`,
      block: abhaengigkeitsBlock(befund),
      kreisLog: befund.kreise.map((k) => kreisLogZeile(top.id, k)),
    };
  }
  // Ein startendes Paket wird nicht zurueckgestellt, also kein Kommentar (E11) — aber der
  // Dokument-Verweis steht im Protokoll.
  const dokumente = befund.abhaengigkeiten.filter((a) => a.dokument);
  if (dokumente.length > 0) {
    const verweise = dokumente.map((a) => `#${a.nummer} (${a.dokument})`).join(", ");
    log(`#${top.id} startet mit Dokument-Verweis: ${verweise} — ein Dokument ist kein Arbeitspaket.`);
  }
  return null;
}

/**
 * Das Gate fuer ein Paket, das eine geschuetzte Datei beim Namen nennt (Issue #1046, Plan
 * #987, E10). Rueckgabe `null`, wenn nichts getroffen ist oder der Mensch nach E5
 * freigegeben hat — sonst `{ art: "geschuetzt", log, kommentar }` mit dem Halt-Text aus
 * `geschuetztKommentar` ohne Label-Zeile; die setzt `geschuetztAmBoardVermerken`, weil erst
 * nach dem `label add` feststeht, wie sie lautet.
 *
 * Gemessen wird gegen die Wurzel der Hauptkopie, nicht gegen einen Worktree: Die lokalen
 * Einstellungen sind nicht versioniert und fehlen dort — ihre Schreibsperren gaelten sonst
 * in der Kette nicht.
 */
export function geschuetztGate(top, full) {
  const body = full?.body || "";
  const treffer = geschuetzteTreffer(body, top.title || full?.title || "", hauptWurzel());
  if (treffer.length === 0) return null;
  const kommentare = kommentareVon(full).map((k) => ({ body: k }));
  if (geschuetztFreigabe(treffer, kommentare, full?.labels || top.labels || [])) return null;
  const fundstellen = treffer.map((t) => `${t.pfad} (Zeile: '${t.zeile.trim()}')`).join("; ");
  return {
    art: "geschuetzt",
    log: `#${top.id} angehalten: nennt geschuetzte Datei ${fundstellen} — ein Mensch nimmt die Aenderung selbst vor und nimmt danach ${GESCHUETZT_LABEL} ab.`,
    kommentar: geschuetztKommentar(treffer),
  };
}

/** Die Wurzel der Hauptkopie: das Verzeichnis, aus dem die Lauf-Config stammt. */
function hauptWurzel() {
  return CONFIG_PATH ? dirname(dirname(CONFIG_PATH)) : process.cwd();
}

/**
 * Label und Halt-Kommentar an einem Paket mit geschuetzter Datei (Issue #1046, Plan #987,
 * E11, E14), in dieser Reihenfolge: erst `label add`, dann der Kommentar, der dessen
 * Ausgang als eigene Zeile vermerkt — nur so traegt er die Freigabe-Bedingung aus E5.
 *
 * Das Label geht ueber `boardRoh`: `board()` beendete bei Exit != 0 die ganze Nacht, und
 * ein Board, an dem `kit:geschuetzt` (noch) nicht angelegt ist, weist es ab. Der Fehlschlag
 * steht im Protokoll und im Kommentar; der Lauf geht weiter.
 */
function geschuetztAmBoardVermerken(karte, gate) {
  const id = String(karte.id);
  const res = boardRoh("issue", "label", "add", id, GESCHUETZT_LABEL);
  const gesetzt = res.status === 0;
  if (!gesetzt) {
    const grund = res.text || "Exit " + res.status;
    log(`#${id}: Label ${GESCHUETZT_LABEL} nicht gesetzt — ${grund}. Der Halt-Kommentar vermerkt es; der Lauf geht weiter.`);
  }
  const zeile = `Label ${GESCHUETZT_LABEL} ${gesetzt ? "gesetzt" : "nicht gesetzt"}`;
  board("issue", "comment", id, "--text", `${gate.kommentar}\n\n${zeile}`);
}

/**
 * Der Salvage-Versuch nach einer Runde, die nichts abgeschlossen hat (Issue #167).
 *
 * Bevor der Lauf hart stoppt, pruefen wir selbst, ob die Arbeit inhaltlich fertig
 * ist. Gruene buildChecks sind das Indiz dafuer, dass die Session nur ihr Ergebnis
 * verloren hat (Hintergrund-Check ohne Folge-Turn) und nicht wirklich gescheitert
 * ist. Genau ein Versuch pro Issue.
 *
 * Vier Ausgaenge, und sie sind nicht dasselbe: `erfolg` (der Lauf geht weiter),
 * `gescheitert` (harter Stopp, die Begruendung steht bereits im Protokoll), `ohneCommit`
 * (Issue #1089: kein Commit, kein Zug — der Aufrufer sichert die Reste im Stash) und
 * `nichtMoeglich` (rote Checks — danach gilt die regulaere Fehlschlag-Meldung des
 * Aufrufers). Wer die letzten beiden zusammenfasst, schreibt entweder eine
 * Fehlschlag-Zeile zu viel oder eine zu wenig.
 *
 * Der Ausgang `gescheitert` traegt seit Issue #672 drei unterscheidbare Endzustaende,
 * weil sie morgens drei verschiedene Griffe verlangen (seit Issue #1089 traegt der erste
 * den eigenen Rueckgabewert `ohneCommit`; die beiden anderen bleiben harter Stopp):
 *   - kein neuer Commit, Karte nicht bewegt -> die Session hat nichts hinterlassen
 *   - neuer Commit, Karte nicht bewegt      -> die Arbeit ist da, der Board-Zug fehlt
 *   - Karte in In review, Baum unsauber     -> die Karte behauptet mehr, als committet ist
 * Ob committet wurde, sagt der Vergleich des Commit-Hashes vor und nach der Session:
 * Der Arbeitsbaum ist vor der regulaeren Runde sauber, ein neuer Commit ist damit die
 * einzige Spur, die die Salvage-Session sicher hinterlaesst.
 */
async function versucheSalvage(top, args, sessionWahl, res, pruefung) {
  const checks = verifyChecksForSalvage(ZUSTAND.config, top.id);
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
    // Der Strom wie in der regulaeren Runde und in der Kette (Issue #871): `sessionStart`
    // haengt `--output-format stream-json` nur bei `args.verbose || opts.stream` an, und
    // `runProcess` misst unter derselben Bedingung. Ohne das Feld lief die Rettung unter
    // `--verbose no` ohne Strom, und ihre Kennzahlen fehlten im Verbrauch der Einheit —
    // entgegen der Zusage in docs/dokumentation.md, dass weder die Datei noch die
    // Kennzahlen an einem Flag haengen.
    stream: true,
    ...sessionWahl,
    extraEnv: { NIGHT_SALVAGE: "1" },
  });
  const salvaged = board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
  const reste = gitReste();
  if (salvaged && reste.length === 0) {
    log(`  Salvage erfolgreich, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
    // EIN Satz zum Zeitabbruch der regulaeren Runde, nicht der volle Vermerk (Plan #974,
    // E11): Kein Stand-Abschnitt und keine Empfehlung — an einer fertigen Karte ist nichts
    // zu teilen, und wer den Abbruch morgens einordnen will, braucht hier nur die Auskunft,
    // dass die Uhr und nicht die Arbeit die regulaere Runde beendet hat. `ZEITLIMIT_BEENDET`
    // bleibt aus demselben Grund ungesetzt (E8).
    //
    // Der Befund muss durchgereicht werden: `behandleDirtyRunde` kehrt bei `erfolg` sofort
    // zurueck und erreicht seinen eigenen `rundenGrund`-Aufruf nie.
    const zeitlimitSatz = rundenGrund(res, pruefung) === GRUND_ZEITLIMIT
      ? ` Die regulaere Runde endete am Zeitlimit — ${GRUND_ZEITLIMIT}, die Grenze dieser Runde: ${grenzeText(grenzeMinuten(res))}.`
      : "";
    board("issue", "comment", String(top.id), "--text",
      `Nachtlauf: Die regulaere Runde endete ohne Board-Ergebnis, die Pflicht-Checks waren extern aber gruen. Eine Salvage-Session hat den Zwischenstand geprueft, committet und das Issue nach In review verschoben. Bitte beim Review besonders auf Vollstaendigkeit achten.${zeitlimitSatz}`);
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
    // Ohne Commit und ohne Zug liegt nur der Arbeitsbaum da (Issue #1089, E14): Kein harter
    // Stopp mehr, der Aufrufer sichert die Reste im Stash, und die Nacht laeuft weiter. Die
    // beiden Faelle darueber bleiben harter Stopp — dort kann ein Commit unvollstaendig sein.
    const satzOhne = `SALVAGE-VERSUCH gescheitert. Issue #${top.id}: kein Commit, Board nicht bewegt.`;
    log(`  ${satzOhne}`);
    SALVAGE_GRUND = satzOhne;
    return "ohneCommit";
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
// Session, die auf etwas gewartet hat; ein Zeitlimit heisst, dass die Zeit ausging —
// warum, folgt nicht aus dem Abbruch und steht allenfalls im Vermerk unter
// `ZEITLIMIT_ANKER` am Arbeitspaket; ein `is_error` ist ein Abbruch; ein roter
// Pflichtcheck ist Arbeit am Code.
const GRUND_END_TURN = "Grund: Session regulaer beendet ohne Commit (end_turn)";
const GRUND_ZEITLIMIT = "Grund: Session am Zeitlimit beendet";
const GRUND_IS_ERROR = "Grund: Session mit is_error beendet";
const GRUND_UNBEKANNT = "Grund: Session ohne auswertbares Ergebnis-Ereignis beendet";
const grundCheckRot = (kommando, quelle) => `Grund: Pflichtcheck rot — ${kommando} (${quelle})`;

// --- Die wartende Sitzung (Plan #773, Issue #775) ---
//
// Der fuenfte Grund, und der einzige, der nicht aus einem Feld der CLI kommt, sondern aus
// dem, was die Sitzung zuletzt gesagt hat: Sie hat eine lange Arbeit angestossen, darauf
// gewartet und damit ihren Zug beendet — headless gibt es keinen Folge-Turn. Bis hierher
// sah dieser Ausgang aus wie ein regulaeres Ende ohne Commit, also wie Aufgeben.
//
// Woertliche Konstante aus demselben Grund wie die vier darueber: Der Text erscheint in
// Protokoll, Board-Kommentar und `grund` des Ergebnisstands zugleich.
const GRUND_WARTEND =
  "Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden";

// Erkannt wird am Schlusstext, nicht am Werkzeug und nicht an der Zeit (Plan #773, A1).
// Die Muster sind benannt, weil sie zwei verschiedene Dinge beschreiben: das Warten auf
// eine selbst angestossene Arbeit — der Fall — und das Warten auf einen Menschen, das
// keiner ist. Eine Sitzung, die auf eine Antwort wartet, hat nichts verloren; ihre Frage
// steht am Board und der Halt-Weg hat sie schon verbucht.
//
// Ueberall `\b…\b`: Ohne Wortgrenze traefe das kurze "GO" der Ausnahmeliste in beliebigen
// Woertern (ALGOL, Logo) und zoege damit echte Faelle aus der Wertung — die Ausnahme hat
// Vorrang, also ist ein Fehltreffer dort teurer als einer in der Musterliste.
const WARTEN_MUSTER = [
  // Case-sensitiv (Issue #1207): Das Verb steht klein ("warte", "wartet", "warten") oder
  // gross am Satzanfang ("Warte", "Wartet"); "Warten" gross ist im Deutschen das
  // Substantiv ("begrenztes Warten auf eine Bedingung") und beschreibt keinen Zustand der
  // Sitzung. Die Versalform bleibt erkannt, wie vor der Schaerfung.
  /\b(?:warte[nt]?|Wartet?|WARTE[NT]?)\s+(?:auf|AUF)\b/,
  /\bl(?:ae|ä)uft\s+noch\b/i,
  // "sobald … fertig ist" — die beiden Woerter stehen selten direkt beieinander
  // ("sobald der Lauf durch ist"), darum eine begrenzte Spanne dazwischen und keine
  // Satzgrenze darin.
  /\bsobald\b[^.!?\n]{0,80}\b(?:fertig|durch)\b/i,
  /\bErgebnis\s+steht\s+noch\s+aus\b/i,
];

// "im Hintergrund" steht nicht in der Musterliste, weil die Wendung ueber den Zeitpunkt
// nichts sagt (Issue #819): Dieselben drei Woerter stehen im Rueckblick einer fertigen
// Sitzung ("die Checks liefen im Hintergrund durch, alles gruen"). Als eigenes Muster
// gewertet, endete eine erledigte Runde als abgebrochen und ihr Paket bekam den Vermerk
// der wartenden Sitzung. Sie zaehlt darum nur zusammen mit einem Warteverb im Praesens —
// das Praeteritum ("liefen") und ein Abschlusswort ("erledigt") bleiben draussen.
const HINTERGRUND_MUSTER = /\bim\s+Hintergrund\b/i;
const HINTERGRUND_PRAESENS_MUSTER = /\b(?:l(?:ae|ä)uft|laufen|warte[nt]?|noch\s+nicht\s+fertig)\b/i;

const WARTEN_AUSNAHME_MUSTER = [
  /\bAntwort\b/i,
  /\bR(?:ue|ü)ckmeldung\b/i,
  /\bFreigabe\b/i,
  // Case-sensitiv und ohne Bindestrich an den Raendern, waehrend die uebrigen Ausnahmen
  // `i` tragen: "GO" ist als kurzes Wort so unspezifisch, dass jede Lockerung es in
  // Bezeichnern treffen laesst ("Go-Test", "GO-Baustein") — und weil die Ausnahme Vorrang
  // hat, zoege jeder solche Treffer einen echten Wartefall aus der Wertung.
  /(?<![\w-])GO(?![\w-])/,
  /\bKl(?:ae|ä)rung\b/i,
  /\bReview\s+durch\b/i,
];

/**
 * Hat diese Sitzung auf eine selbst angestossene Arbeit gewartet (Plan #773, A2)?
 *
 * Reine Funktion neben `rundenGrund` und `istHalt`: nur Text hinein, nur Ja/Nein heraus —
 * kein Board, kein Dateisystem. Nur so ist die Zuordnung an Fixtures pruefbar, ohne eine
 * Nacht zu fahren.
 *
 * Gelesen wird ausschliesslich der Schlusstext. Eine Wartemeldung mitten im Strom bleibt
 * damit folgenlos: Wer spaeter fertig wird, sagt zum Schluss etwas anderes.
 *
 * Exportiert fuer die Tests.
 */
export function wartendeSession(text) {
  const s = typeof text === "string" ? text : "";
  if (s.trim() === "") return false;
  if (WARTEN_AUSNAHME_MUSTER.some((m) => m.test(s))) return false;
  if (HINTERGRUND_MUSTER.test(s) && HINTERGRUND_PRAESENS_MUSTER.test(s)) return true;
  return WARTEN_MUSTER.some((m) => m.test(s));
}

/**
 * Der Anker des Vermerks am Arbeitspaket (Plan #773, A8).
 *
 * Woertlich derselbe Text, den `implement-next` und `implement-done` nennen: Die Skills
 * weisen die naechste Sitzung an, ihn zu melden, statt stillschweigend auf halbem Weg
 * weiterzumachen. Zwei Fassungen waeren zwei Anker, und einer davon fuehrte ins Leere.
 *
 * Exportiert fuer die Tests und die Auswertungswege der Folgepakete.
 */
export const WARTEND_ANKER = "## Nachtlauf: wartende Sitzung";

// Mehr als 2.000 Zeichen Schlusstext sagen ueber den Stand nichts Neues, machen den
// Board-Kommentar aber unlesbar.
const WARTEND_STAND_MAX = 2000;

/**
 * Der Vermerk, den eine wartende Sitzung am Arbeitspaket hinterlaesst (Plan #773, A8).
 *
 * Reine Funktion: Schlusstext und die Pfade aus `gitReste()` hinein, Text heraus. Mehr
 * weiss der Runner nicht — eine Liste der angefangenen und nicht abgeschlossenen Schritte
 * waere geraten und saehe aus wie Wissen.
 *
 * Ist die Pfadliste leer, entfaellt der Abschnitt ersatzlos statt "keine" zu melden: Im
 * Rueckstellungsfall ist der Baum sauber, und eine Meldung ueber nichts ist keine.
 *
 * Einen Fall "Schlusstext fehlt" gibt es nicht — `leseErgebnisText` liefert bei leerem
 * Text `null`, und ohne Schlusstext erkennt `wartendeSession` den Fall gar nicht erst.
 *
 * Exportiert fuer die Tests und die Auswertungswege der Folgepakete.
 */
export function wartendVermerk(schlusstext, pfade = []) {
  const stand = String(schlusstext ?? "");
  const gekuerzt = stand.length > WARTEND_STAND_MAX
    ? `${stand.slice(0, WARTEND_STAND_MAX)}\n\n(Schlusstext auf ${WARTEND_STAND_MAX} Zeichen gekuerzt.)`
    : stand;

  const teile = [
    WARTEND_ANKER,
    "",
    GRUND_WARTEND,
    "",
    "### Zuletzt bekannter Stand",
    "",
    gekuerzt,
  ];

  if (Array.isArray(pfade) && pfade.length > 0) {
    // `resteText` kuerzt ab dem elften Eintrag auf Anzahl und die ersten zehn — dieselbe
    // Darstellung wie in jedem anderen Grund des Runners (night-11).
    teile.push("", "### Im Arbeitsverzeichnis", "", resteText(pfade));
  }

  return `${teile.join("\n")}\n`;
}

/**
 * Der Anker des Zeitabbruch-Vermerks am Arbeitspaket (Plan #974, Issue #976).
 *
 * Neben `WARTEND_ANKER` und aus demselben Grund woertlich: Die implement-Skills weisen die
 * naechste Sitzung an, einen Vermerk unter diesem Anker zu melden, statt stillschweigend
 * auf halbem Weg weiterzumachen. Zwei Fassungen waeren zwei Anker, und einer fuehrte ins
 * Leere.
 */
export const ZEITLIMIT_ANKER = "## Nachtlauf: Zeitgrenze erreicht";

/**
 * Die Grenze in Minuten fuer den Vermerkstext (Issue #976).
 *
 * Fehlt sie, steht das da — eine erfundene Zahl an der Karte waere schlimmer als keine,
 * und "unbekannt" ist dieselbe Regel wie "nicht gemessen" statt 0. Nicht ganze Werte
 * behalten eine Nachkommastelle: Unter `NIGHT_TIMEOUT_MS` sind Grenzen unter einer Minute
 * ueblich, und "0 Minuten" waere falsch.
 */
function grenzeText(grenzeMin) {
  if (typeof grenzeMin !== "number" || !Number.isFinite(grenzeMin)) return "Grenze nicht bekannt";
  return `${Number.isInteger(grenzeMin) ? grenzeMin : grenzeMin.toFixed(1)} Minuten`;
}

/**
 * Die wirksame Grenze dieser Runde in Minuten — oder `null` (Issue #977).
 *
 * Aus `res.timeoutMs`, das `runSession` seit Issue #976 fuehrt, und NICHT aus
 * `args.timeoutMin`: Gerechnet hat die Runde mit dem einen Wert, den `runSession`
 * bestimmt hat — `NIGHT_TIMEOUT_MS`, `opts.timeoutMs` oder das Flag. Eine zweite
 * Herleitung aus dem Flag laege an genau den Stellen daneben, an denen es darauf ankommt.
 *
 * Fehlt das Feld, bleibt es bei `null`; `grenzeText` macht daraus "Grenze nicht bekannt"
 * statt einer erfundenen Zahl.
 */
function grenzeMinuten(res) {
  const ms = res?.timeoutMs;
  return typeof ms === "number" && Number.isFinite(ms) ? ms / 60000 : null;
}

/**
 * Der Vermerk, den ein Zeitabbruch am Arbeitspaket hinterlaesst (Plan #974, Issue #976).
 *
 * Reine Funktion wie `wartendVermerk`: die wirksame Grenze, das Ergebnis des
 * `fortschrittBeobachter` und die Pfade aus `gitReste()` hinein, Text heraus. Wer ihn an
 * die Karte schreibt, entsteht im Folgepaket.
 *
 * `fortschritt` traegt drei unterscheidbare Zustaende, und alle drei stehen verschieden im
 * Text: `null` heisst "nicht beobachtet" (kein Strom — die Kommando-Stufe, ein Lauf ohne
 * `stream`), eine leere Liste heisst "nichts gemeldet", und eine gefuellte traegt den
 * Stand. Die beiden ersten zusammenzufassen waere dieselbe Luege wie eine 0 fuer einen
 * fehlenden Messwert.
 *
 * Der Schlusstext fehlt hier strukturell: Am Zeitlimit wird die Sitzung samt Prozessgruppe
 * gekillt, ein `result`-Ereignis kommt nie an, und `leseErgebnisText` liefert `null`. Was
 * die Sitzung unterwegs gesagt hat, ist alles, was bleibt.
 *
 * Exportiert fuer die Tests und die Verdrahtung des Folgepakets.
 */
export function zeitlimitVermerk(grenzeMin, fortschritt, pfade = []) {
  const zeilen = Array.isArray(fortschritt?.zeilen) ? fortschritt.zeilen : null;

  const stand = [];
  if (zeilen === null) {
    stand.push("Fortschritt nicht beobachtet (kein Strom) — ueber den Stand dieser Sitzung liegt nichts vor.");
  } else if (zeilen.length === 0) {
    stand.push("keine Auskunft der Sitzung — sie hat bis zum Abbruch keine Fortschrittszeile gemeldet.");
  } else {
    stand.push(...zeilen);
    const gesehen = fortschritt.gesehen;
    if (typeof gesehen === "number" && gesehen > zeilen.length) {
      // Ohne diesen Satz saehe eine gekappte Liste wie die ganze aus.
      stand.push("", `(${gesehen} Fortschrittszeilen gemeldet, die juengsten ${zeilen.length} stehen hier.)`);
    }
  }

  const teile = [
    ZEITLIMIT_ANKER,
    "",
    `${GRUND_ZEITLIMIT} — die Grenze dieser Runde: ${grenzeText(grenzeMin)}.`,
    "Das ist kein inhaltlicher Fehlschlag: Die Sitzung wurde an der Uhr abgebrochen, nicht an ihrer Arbeit.",
    "",
    "### Stand nach eigener Auskunft der Sitzung",
    "",
    ...stand,
    "",
    "### Naechster Schritt (Mensch)",
    "",
    "Empfehlung (keine Vorgabe): dieses Paket in Teile schneiden, die je in eine Sitzung passen.",
    "Ob geteilt wird und wie, entscheidet ein Mensch — hier steht keine Aufgabe, sondern ein Vorschlag.",
    "",
    // Kriterium 5 des Fachplans: Der Abbruch ist ein Befund ueber die Uhr und keiner ueber
    // das Paket. Wer ihn als "zu gross geschnitten" liest, hat die Ursache geraten.
    "Aus dem Abbruch folgt keine Aussage ueber seine Ursache: Dass die Zeit ausging, sagt nicht,",
    "ob das Paket zu gross geschnitten war, ob die Sitzung sich verlaufen hat oder ob ein einzelner",
    "Lauf ungewoehnlich lange gebraucht hat.",
  ];

  if (Array.isArray(pfade) && pfade.length > 0) {
    // Wie bei `wartendVermerk`: ohne Pfade entfaellt der Abschnitt ersatzlos, statt "keine"
    // zu melden — und `resteText` kuerzt lange Listen wie in jedem anderen Grund des Runners.
    teile.push("", "### Im Arbeitsverzeichnis", "", resteText(pfade));
  }

  return `${teile.join("\n")}\n`;
}

/**
 * Warum hat diese Runde nichts abgeschlossen (Issue #668)?
 *
 * Reine Funktion ueber dem Ergebnis von `runSession` und der Pruef-Zusammenfassung der
 * Session, damit die Zuordnung an Fixtures pruefbar ist. Die Reihenfolge ist die
 * Rangfolge: Das Zeitlimit schlaegt alles, weil ein gekillter Baum ueber seinen
 * `stop_reason` nichts mehr sagt; danach der Abbruch; danach ein roter Pflichtcheck der
 * Session, weil er konkreter ist als jedes Ende; zuletzt das regulaere Ende.
 *
 * Der Grund der wartenden Sitzung (Plan #773, A4) sitzt hinter dem roten Pflichtcheck und
 * vor `end_turn`: Er VERFEINERT das regulaere Ende und loest es nicht ab — eine Sitzung,
 * die regulaer endet, ohne zu warten, behaelt `GRUND_END_TURN`. Ein anderer `stop_reason`
 * sagt ueber den Ausgang zu wenig, um den Fall zu behaupten.
 *
 * Exportiert fuer die Tests.
 */
export function rundenGrund(res, pruefung) {
  if (res?.error?.code === "ETIMEDOUT" || res?.signal === "SIGTERM") return GRUND_ZEITLIMIT;
  const kennzahlen = leseKennzahlen(res?.stdout);
  if (kennzahlen?.isError === true) return GRUND_IS_ERROR;
  if (pruefung?.zustand === "rot") return grundCheckRot(pruefung.rotesKommando ?? "unbenanntes Kommando", "Session");
  if (kennzahlen?.stopReason === "end_turn") {
    return wartendeSession(leseErgebnisText(res?.stdout)) ? GRUND_WARTEND : GRUND_END_TURN;
  }
  return GRUND_UNBEKANNT;
}

/**
 * Der Vermerk zu einem Grund — oder `null`, wenn dieser Grund keinen traegt (Issue #977).
 *
 * Zwei der Gruende haben einen eigenen Text am Paket: die wartende Sitzung (Plan #773) und
 * der Zeitabbruch (Plan #974). Sie hier zusammenzuführen hat einen Grund: Beide Zweige der
 * Auswertung — Rueckstellung bei sauberem Baum und Fehlschlag bei unsauberem — treffen
 * dieselbe Wahl, und zwei Fassungen davon liefen auseinander. Der Aufrufer entscheidet
 * allein, WIE er den Vermerk setzt: als ganzen Kommentar oder angehaengt an seinen eigenen.
 *
 * `pfade` reicht durch: Im Rueckstellungszweig ist der Baum sauber und die Liste leer, im
 * Fehlschlag-Zweig traegt sie die Reste. Beide Vermerke lassen den Abschnitt bei leerer
 * Liste ersatzlos weg.
 */
/**
 * Der Grund, der eine Rueckstellung bei SAUBEREM Baum benennt — oder `null` (Issue #977).
 *
 * Nur zwei der Gruende erscheinen hier: die wartende Sitzung und der Zeitabbruch. Die
 * uebrigen (is_error, roter Pflichtcheck, regulaeres Ende) bleiben stumm — in diesem Zweig
 * ist der Baum sauber, und der bisherige Rueckstellungstext war fuer sie nie falsch.
 *
 * Die Wartend-Erkennung bleibt bei `wartendeSession` und wechselt NICHT zu `rundenGrund`:
 * Die beiden sind nicht deckungsgleich — `rundenGrund` liefert `GRUND_WARTEND` nur bei
 * `stopReason === "end_turn"` —, und ein stiller Wechsel aenderte das Verhalten von
 * night-55. `rundenGrund` wird allein fuer den Zeitlimit-Fall befragt.
 *
 * Die Reihenfolge entscheidet nichts, sie macht nur sichtbar, dass beides zugleich nicht
 * eintreten kann: Am Zeitlimit wird die Sitzung samt Prozessgruppe gekillt,
 * `leseErgebnisText` liefert `null`, und ohne Schlusstext ist `wartendeSession` nie wahr.
 */
function rueckstellungsGrund(res, pruefung) {
  if (wartendeSession(leseErgebnisText(res?.stdout))) return GRUND_WARTEND;
  if (rundenGrund(res, pruefung) === GRUND_ZEITLIMIT) return GRUND_ZEITLIMIT;
  return null;
}

function rundenVermerk(grund, res, pfade = []) {
  if (grund === GRUND_WARTEND) return wartendVermerk(leseErgebnisText(res?.stdout), pfade);
  if (grund === GRUND_ZEITLIMIT) return zeitlimitVermerk(grenzeMinuten(res), res?.fortschritt, pfade);
  return null;
}

/**
 * Der Halt mit unsauberem Baum (Issue #572, beide Arten seit #1050, E12) — `null`, wenn die
 * Session keinen Halt hinterliess, sonst `hardStop`. Steht VOR dem Salvage: Dessen Auftrag
 * lautet, einen passenden Stand zu committen und die Karte nach In review zu schieben — an
 * einer angehaltenen Karte waere das genau der halbfertige Stand, den der Halt verworfen hat.
 *
 * `kit:klaeren` gilt wie bisher schon am Label allein, der geschuetzte Halt an seinem
 * vollstaendigen Nachweis — sein Label kann fehlen (E11).
 */
function haltMitUnsauberemBaum(top, minutes, vorher) {
  // Frisch gelesen: `top` stammt aus der Ready-Liste VOR der Session und kennt das
  // Label nicht, das die Session selbst gesetzt hat.
  const nachher = board("issue", "get", String(top.id));
  const haltArt = hatKlaerenLabel(nachher) ? "klaeren" : istHalt(vorher, nachher);
  if (!haltArt) return null;
  const befund = haltArt === "klaeren" ? `traegt ${KLAEREN_LABEL}` : "haelt an einer geschuetzten Datei";
  const satz = `HALT MIT UNSAUBEREM BAUM nach ${minutes} min: Issue #${top.id} ${befund}, aber der Working Tree ist dirty — kein Salvage, harter Stopp.`;
  log(`  ${satz}`);
  const getan = haltArt === "klaeren" ? "hat kit:klaeren gesetzt" : "hat den Halt an einer geschuetzten Datei vermerkt";
  board("issue", "comment", String(top.id), "--text",
    `Nachtlauf: Halt mit unsauberem Working Tree — die Session ${getan}, aber Aenderungen liegen gelassen; kein Salvage, Lauf hart gestoppt. Bitte morgens manuell sichten.`);
  merkeHartenStopp("harterStopp", `${satz} ${resteText(gitReste())}`);
  return "hardStop";
}

/**
 * Die Runde hat nichts abgeschlossen und den Baum veraendert (Issue #404). Bis Issue
 * #1089 der vierte harte Stopp; seitdem gehen die Reste in den Stash, und der Lauf geht
 * weiter (E14). Harter Stopp bleibt der Halt mit unsauberem Baum und eine Rettung, die
 * committet oder gezogen hat.
 *
 * Zuerst bekommt der Salvage seinen einen Versuch. Erst wenn der nicht moeglich war
 * — rote Checks —, gilt die regulaere Fehlschlag-Meldung. Ein GESCHEITERTER Salvage
 * hat seine Begruendung dagegen schon protokolliert und kommentiert; die Zeile hier
 * waere die zweite zum selben Fall.
 *
 * Die wartende Sitzung (Plan #773, night-56) wird in BEIDEN Fehlschlag-Wegen vermerkt,
 * nicht nur im Fehlschlag-Zweig unten: Bei `gescheitert` kehrt die Funktion vor
 * `rundenGrund` zurueck, und ohne den eigenen Griff dort entstuende der Befund nur fuer
 * die Haelfte der Faelle. Geprueft wird allein der Schlusstext der REGULAEREN Runde —
 * die Salvage-Session hat mit night-27 bereits drei eigene Endzustaende samt Grund, und
 * ein zweites Urteil ueber denselben Vorgang waere eine zweite Wahrheit.
 *
 * Mit dem Stash geht das Issue ins Backlog (Issue #1089): Bliebe es in Ready, zoege der Lauf
 * es erneut. Vom zurueckgestellten Ticket unterscheiden es Laufstand `abgebrochen` und
 * Kommentar, die beide den Stash nennen. Beim harten Stopp bleibt es liegen, wo es ist.
 *
 * Den Ausschluss der angehaltenen Karte (Issue #572) prueft der Aufrufer vorher, seit
 * Issue #1050 in `haltMitUnsauberemBaum` — er braucht die Karte vor der Session.
 */
async function behandleDirtyRunde(top, args, minutes, salvageAttempted, res, pruefung, sessionWahl) {
  // Vor Salvage und Stash (Issue #1051, E20): Scheiterte die Session am Schutz einer Datei und
  // vermerkte keinen Halt, haelt der Runner das Paket selbst an.
  const auffang = geschuetztAuffangen(top, res, minutes);
  if (auffang) return auffang;
  if (!salvageAttempted.has(String(top.id))) {
    salvageAttempted.add(String(top.id));
    const salvage = await versucheSalvage(top, args, sessionWahl, res, pruefung);
    if (salvage === "erfolg") return "erfolg";
    // Klasse und Grund hat versucheSalvage bereits gemerkt — hier bleibt nur der Ausgang.
    // Ohne Commit (Issue #1089, E14) dieselben Vermerke, danach der Stash statt des Stopps.
    if (salvage === "gescheitert" || salvage === "ohneCommit") return salvageGescheitert(top, salvage, res, pruefung);
  }
  // Der Grund steht VOR dem Zustand (Issue #668): Wer morgens sichtet, liest zuerst,
  // warum die Runde nichts abgeschlossen hat, und danach, was der Runner vorgefunden hat.
  // Der Zustandstext bleibt erhalten — er war nie falsch, nur unvollstaendig.
  const grund = rundenGrund(res, pruefung);
  // `rundenGrund` traegt den Fall der wartenden Sitzung bereits mit seiner Rangfolge —
  // ein zweiter Aufruf von `wartendeSession` hier waere eine zweite Herleitung desselben
  // Befunds, ohne Zeitlimit, Abbruch und roten Pflichtcheck davor.
  const wartend = grund === GRUND_WARTEND;
  if (wartend) WARTEND_BEENDET = true;
  // Derselbe Griff fuer den Zeitabbruch (Issue #977): Der Grund steht schon heute im Text,
  // neu sind Auskunft, Empfehlung und Ursachen-Vorbehalt des Vermerks.
  if (grund === GRUND_ZEITLIMIT) ZEITLIMIT_BEENDET = true;
  const satz = `FEHLSCHLAG nach ${minutes} min: Issue #${top.id} — ${grund}; nicht in In review UND Working Tree dirty.`;
  log(`  ${satz}`);
  // Der Vermerk ERWEITERT den Kommentar, anders als im Rueckstellungsfall: Dort ist er
  // die ganze Botschaft, hier steht der Fehlschlag davor — mit den Pfaden aus
  // `gitReste()`, denn der Baum ist unsauber.
  const vermerk = rundenVermerk(grund, res, gitReste());
  return resteSichern(top, `${satz} ${resteText(gitReste())}`, `Nachtlauf: Runde fehlgeschlagen und Working Tree nicht sauber hinterlassen. ${grund}.`, vermerk);
}

// Die Werkzeuge, mit denen eine Session Dateien schreibt. Abweisungen anderer Werkzeuge —
// vor allem `Bash` durch den Hook `bash-pruefen` — stehen in derselben Liste und zaehlen
// hier nicht.
const SCHREIBWERKZEUGE = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Ein Pfad mit aufgeloesten Verweisen, auch wenn die Datei oder ihre Ordner (noch) fehlen:
 * aufgeloest wird der naechste vorhandene Vorfahre, der Rest haengt woertlich daran. Sonst
 * stuende unter macOS `/var/…` neben `/private/var/…`, und kein Pfad laege im Baum.
 */
function echterPfad(pfad) {
  let kopf = resolve(pfad);
  const rest = [];
  while (!existsSync(kopf) && dirname(kopf) !== kopf) {
    rest.unshift(basename(kopf));
    kopf = dirname(kopf);
  }
  try {
    return join(realpathSync(kopf), ...rest);
  } catch {
    return resolve(pfad);
  }
}

/** Die `permission_denials` einer Zeile des Streams, wenn sie eine `result`-Zeile ist, sonst `[]`. */
function abweisungenDerZeile(zeile) {
  if (!zeile.includes("permission_denials")) return [];
  try {
    const ereignis = JSON.parse(zeile);
    return ereignis?.type === "result" && Array.isArray(ereignis.permission_denials) ? ereignis.permission_denials : [];
  } catch {
    return [];
  }
}

/**
 * Die Pfade, deren Schreibanfrage die Session abgewiesen bekam (Issue #1051, Beleg an Issue
 * #1042): aus `permission_denials` der `result`-Zeilen des `stream-json`, je Eintrag mit
 * `tool_name` eines Schreibwerkzeugs und `tool_input.file_path`. Relativ zum Arbeitsbaum der
 * Session, damit sie gegen die Sperrliste der Projektwurzel gelesen werden koennen; ein Pfad
 * ausserhalb des Baums faellt weg. Reine Funktion ueber den Text.
 */
export function abgewieseneSchreibpfade(stream, baum = process.cwd()) {
  const wurzel = echterPfad(baum);
  const pfade = [];
  for (const d of String(stream ?? "").split("\n").flatMap(abweisungenDerZeile)) {
    const datei = d?.tool_input?.file_path ?? d?.tool_input?.notebook_path;
    if (!SCHREIBWERKZEUGE.has(d?.tool_name) || typeof datei !== "string") continue;
    const rel = relative(wurzel, echterPfad(isAbsolute(datei) ? datei : join(wurzel, datei)));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) pfade.push(rel.split("\\").join("/"));
  }
  return [...new Set(pfade)];
}

/**
 * Der Auffang aus E20 (Issue #1051): Traegt der Stream der Session eine abgewiesene
 * Schreibanfrage auf einen geschuetzten Pfad, sichert der Runner den Zwischenstand im Stash,
 * zieht die Karte nach Backlog, vermerkt den Halt wie der Rueckfall der Skills (Label, dann
 * Anker-Kommentar mit dem Ort des Zwischenstands) und macht mit dem naechsten Paket weiter.
 * `null`, wenn kein solcher Pfad abgewiesen wurde oder sich der Baum nicht sichern liess —
 * dann greift der Bestand (Salvage, Stash oder harter Stopp).
 */
function geschuetztAuffangen(top, res, minutes) {
  const pfade = abgewieseneSchreibpfade(res?.stdout);
  if (pfade.length === 0) return null;
  const id = String(top.id);
  const pruef = boardRoh("issue", "check-geschuetzt", id, ...pfade.flatMap((p) => ["--pfad", p]));
  const abgewiesen = (pruef.json?.treffer ?? []).filter((t) => t.zeile === GESCHUETZT_ABGEWIESEN);
  if (abgewiesen.length === 0 || !pruef.json?.kommentar) return null;

  const { ok, name, meldung } = resteInStash(top);
  if (!ok) {
    log(`  Auffang an geschuetzter Datei fuer Issue #${id} nicht moeglich: Reste nicht im Stash gesichert (${meldung}).`);
    return null;
  }
  const dateien = [...new Set(abgewiesen.map((t) => t.pfad))].join(", ");
  log(`  AUFFANG GESCHUETZT nach ${minutes} min: Issue #${id} — die Session scheiterte beim Schreiben an ${dateien} und vermerkte keinen Halt; Zwischenstand im Stash „${name}“, Issue ins Backlog, weiter.`);
  board("issue", "move", id, "backlog");
  geschuetztAmBoardVermerken(top, { kommentar: `${pruef.json.kommentar}\n\nZwischenstand: Stash „${name}“ (\`git stash list\`).` });
  HALT_ART = "geschuetzt";
  return "angehalten";
}

/**
 * Die Rettung ist gescheitert (`gescheitert`) oder blieb ohne Commit (`ohneCommit`, Issue
 * #1089): erst die Vermerke der regulaeren Runde, dann harter Stopp oder Stash.
 */
function salvageGescheitert(top, salvage, res, pruefung) {
  const schlusstext = leseErgebnisText(res?.stdout);
  if (wartendeSession(schlusstext)) {
    WARTEND_BEENDET = true;
    // Vorangestellt, nicht ersetzt: Der night-27-Grund ist die konkretere Auskunft
    // ueber das, was morgens im Arbeitsverzeichnis liegt, und war nie falsch — zwei
    // Vorgaenge sind zu berichten: warum die regulaere Runde nichts hinterliess, und
    // was der Salvage vorfand.
    if (salvage === "gescheitert") merkeHartenStopp("harterStopp", `${GRUND_WARTEND}; ${ZUSTAND.STOPP_GRUND}`);
    else SALVAGE_GRUND = `${GRUND_WARTEND}; ${SALVAGE_GRUND}`;
    board("issue", "comment", String(top.id), "--text", wartendVermerk(schlusstext, gitReste()));
  } else if (rundenGrund(res, pruefung) === GRUND_ZEITLIMIT) {
    // Derselbe eigene Griff wie fuer die wartende Sitzung darueber, und aus demselben
    // Grund (Issue #977): Dieser Zweig kehrt zurueck, bevor der Fehlschlag-Zweig unten
    // mit `rundenGrund` erreicht ist — ohne ihn entstuende der Befund nur fuer die
    // Haelfte der Faelle. Der Stopp-Grund bleibt unangetastet: Der night-27-Satz
    // benennt, was morgens im Arbeitsverzeichnis liegt, der Zeitabbruch steht im
    // Vermerk und am Feld `zeitlimitBeendet` der Einheit.
    //
    // `else if`, nicht ein zweites `if`: Zeitlimit und wartend schliessen einander aus
    // (am Zeitlimit kommt kein `result`-Ereignis an, `leseErgebnisText` liefert `null`),
    // und zwei Vermerke zu derselben Runde waeren zwei Wahrheiten ueber sie.
    ZEITLIMIT_BEENDET = true;
    board("issue", "comment", String(top.id), "--text",
      zeitlimitVermerk(grenzeMinuten(res), res?.fortschritt, gitReste()));
  }
  if (salvage === "gescheitert") return "hardStop";
  return resteSichern(top, `${SALVAGE_GRUND} ${resteText(gitReste())}`,
    "Nachtlauf: Pflicht-Checks extern gruen, aber die Salvage-Session hat weder committet noch das Board bewegt.");
}

/**
 * Die Pfade der Reste, wie `gitReste()` sie zaehlt — aus `git status -z`, damit Leerzeichen,
 * Anfuehrungszeichen und Umbenennungen (beide Pfade) heil ankommen.
 */
function restPfade(cwd = process.cwd()) {
  const res = spawnSync("git", ["status", "--porcelain", "-z", ...gitRestePathspec(gitResteAusnahmen())], { encoding: "utf-8", cwd });
  if (res.status !== 0) return [];
  const teile = res.stdout.split("\0").filter(Boolean);
  const pfade = [];
  let i = 0;
  while (i < teile.length) {
    pfade.push(teile[i].slice(3));
    // Eine Umbenennung traegt ihren alten Pfad als naechsten Eintrag.
    if (/^[RC]/.test(teile[i])) pfade.push(teile[i + 1]);
    i += /^[RC]/.test(teile[i]) ? 2 : 1;
  }
  return pfade;
}

/** Der Name des Stashs, in dem die Reste eines abgebrochenen Pakets liegen (E14). */
const nachtrestName = (id, lauf) => `nachtrest #${id} ${lauf ?? "ohne-lauf"}`;

/**
 * Legt die Reste eines Pakets in den Stash `nachtrest #<id> <lauf>`. Gesichert wird genau,
 * was `gitReste()` als Rest zaehlt — samt unversionierter Dateien, ohne Journal, Protokoll und
 * Board-Dateien. `ok` erst, wenn der Baum danach sauber ist.
 */
function resteInStash(top) {
  const name = nachtrestName(top.id, ZUSTAND.LAUF_STEMPEL);
  // Die Pfade einzeln und woertlich, nicht die Ausschluesse als Pathspec: `git stash push`
  // bricht ab, sobald ein Ausschluss auf eine ignorierte Datei zeigt.
  // Ohne Pfad kein Aufruf: `git stash push` ohne Pathspec saehe alles, auch Journal und Protokoll.
  const pfade = restPfade();
  const res = pfade.length > 0
    ? spawnSync("git", ["stash", "push", "--include-untracked", "-m", name, "--", ...pfade.map((p) => `:(literal)${p}`)], { encoding: "utf-8", cwd: process.cwd() })
    : { status: 1, stderr: "keine Pfade der Reste lesbar" };
  if (res.status === 0 && gitClean()) return { ok: true, name };
  return { ok: false, name, meldung: ersteZeile(res.stderr || res.stdout || "Exit " + res.status) };
}

/**
 * Sichert die Reste eines gescheiterten Pakets im Stash (Issue #1089, Plan #1079 E14) und
 * legt die Karte nach Backlog: Die Nacht laeuft weiter, und das naechste Paket baut nicht auf
 * halben Aenderungen auf. Laesst sich der Baum so nicht saeubern, bleibt es beim harten
 * Stopp: Weiterbauen auf einem unsauberen Baum ist genau das, was der Stash verhindern soll.
 */
function resteSichern(top, grund, kommentar, vermerk = null) {
  const { ok, name, meldung } = resteInStash(top);
  if (!ok) {
    const satz = `HARTER STOPP: Reste zu Issue #${top.id} liessen sich nicht im Stash sichern (${meldung}).`;
    log(`  ${satz}`);
    board("issue", "comment", String(top.id), "--text", `${kommentar} Die Reste liessen sich nicht im Stash sichern — Lauf hart gestoppt. Bitte morgens manuell sichten.`);
    merkeHartenStopp("harterStopp", `${satz} ${grund}`);
    return "hardStop";
  }
  log(`  Reste zu Issue #${top.id} im Stash „${name}“ gesichert — Issue ins Backlog, weiter.`);
  const text = `${kommentar} Die Reste liegen im Stash „${name}“ (\`git stash list\`), die Karte geht ins Backlog, und der Lauf geht weiter.`;
  board("issue", "comment", String(top.id), "--text", vermerk ? `${text}\n\n${vermerk}` : text);
  board("issue", "move", String(top.id), "backlog");
  ABBRUCH_GRUND = `${grund} Reste im Stash „${name}“.`;
  return "abgebrochen";
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
 * Der Grund, aus dem eine Runde ohne jede Board-Aenderung endet (Issue #927).
 *
 * Eine EIGENE Konstante neben `DEFERRED_GRUND`, nicht dessen zweite Verwendung: Die
 * Faelle sind verschieden — dort wurde ein Zustand gelesen und war nicht `in_review`,
 * hier ist er unbekannt —, und ihr Text ist das Einzige, woran der Morgen sie
 * unterscheidet. Ein nicht lesbarer Zustand ist keine Aussage ueber die Spalte, also
 * folgt ihm auch keine Rueckstellung.
 */
const ZUSTAND_UNLESBAR_GRUND = "Zustand der Karte war nicht lesbar — Karte und Commit bleiben unangetastet, Lauf geht mit dem naechsten Issue weiter.";

/**
 * Uebersetzt den Rueckgabewert von werteRunde in die Felder der Einheit (Issue #488).
 *
 * Die Woerter der Zaehler (`deferred`, `hardStop`) und das Vokabular des
 * Ergebnisstands (`zurueckgestellt`, `harterStopp`) bleiben getrennt: Die Zaehler
 * gehoeren dem Textprotokoll und den bestehenden Tests, die Einheit dem Leitstand.
 */
/**
 * Das Feld `wartendBeendet` fuer die Einheit — oder gar keines (Issue #776).
 *
 * Die eine Stelle, an der alle drei Auswertungswege des Plans #773 ihren Befund in die
 * Einheit bringen. Ohne den Fall bleibt das Feld WEG statt `false` zu tragen: Dieselbe
 * Linie wie bei den nicht gemessenen Feldern des Ergebnisstands — ein `false` behauptete
 * eine Messung, die es nicht gab, und eine Zaehlung ueber mehrere Naechte kaeme auf
 * dieselbe Zahl, egal ob gemessen wurde oder nicht.
 *
 * `ausgang` ruehrt es nicht an: Ausgang und Weiterlauf haengen am Zustand des
 * Arbeitsverzeichnisses und nicht an diesem Fall.
 */
function wartendFelder() {
  return WARTEND_BEENDET ? { wartendBeendet: true } : {};
}

/**
 * Das Feld `zeitlimitBeendet` fuer die Einheit — oder gar keines (Issue #977).
 *
 * Dieselbe Anlage wie `wartendFelder` darueber und aus demselben Grund: Ohne den Fall
 * bleibt das Feld WEG statt `false` zu tragen. Ein `false` behauptete eine Messung, die es
 * nicht gab, und eine Zaehlung ueber mehrere Naechte kaeme auf dieselbe Zahl, egal ob
 * gemessen wurde oder nicht. Die Auswertung der Zielmarke (Issue #978) liest genau dieses
 * Feld, um Zeitabbrueche aus ihren Mittelwerten herauszuhalten.
 */
function zeitlimitFelder() {
  return ZEITLIMIT_BEENDET ? { zeitlimitBeendet: true } : {};
}

function ausgangsFelder(ausgang) {
  if (ausgang === "deferred") return { ausgang: "zurueckgestellt", grund: DEFERRED_GRUND };
  if (ausgang === "hardStop") return { ausgang: "harterStopp" };
  // Das Paket ist an sich selbst gescheitert, seine Reste liegen im Stash (Issue #1089).
  if (ausgang === "abgebrochen") return { ausgang, grund: ABBRUCH_GRUND };
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
 *
 * Rueckgabe ist die ART des Halts (Issue #1050, Plan #987, E12): `"klaeren"` fuer eine
 * Stopp-Frage (`kit:klaeren` samt `HALT_FOLGESATZ`), `"geschuetzt"` fuer eine Session, die
 * erst beim Schreiben am Schutz scheiterte (`GESCHUETZT_ANKER` in einem neuen Kommentar),
 * sonst `null`. Das Label ist fuer den geschuetzten Halt keine Spur: Es kann nach E11
 * fehlen, wenn es am Board nicht angelegt ist. Wer beide Arten zu einem `true` faltete,
 * meldete morgens eine Entscheidung, wo eine Handlung wartet.
 */
export function istHalt(vorher, nachher) {
  if (nachher?.status !== "backlog") return null;
  const neue = neueKommentare(vorher, nachher).map(String);
  if (hatKlaerenLabel(nachher) && neue.some((text) => text.includes(HALT_FOLGESATZ))) return "klaeren";
  if (neue.some((text) => text.includes(GESCHUETZT_ANKER))) return "geschuetzt";
  return null;
}

/** Die Logzeile nach `istHalt`, je Art des Halts (Issue #1050). */
const HALT_LOG_TEXT = {
  klaeren: "eine offene Entscheidung wartet auf einen Menschen",
  geschuetzt: "eine Handlung an einer geschuetzten Datei wartet auf einen Menschen",
};

/** Der Laufstand eines angehaltenen Pakets, je Art des Halts (Issue #1050). */
const HALT_STAND_TEXT = {
  klaeren: "eine offene Entscheidung wartet am Board auf einen Menschen",
  geschuetzt: "eine Handlung an einer geschuetzten Datei wartet am Board auf einen Menschen",
};

/**
 * Wertet eine gelaufene Runde aus. Die Angaben kommen als EIN Objekt statt als acht
 * Parameter (Sonar S107): Die einzige Aufrufstelle uebergibt ohnehin die Felder einer
 * Runde, und benannt gelesen kann keine zwei von ihnen die Reihenfolge vertauschen.
 */
async function werteRunde({ top, res, minutes, args, salvageAttempted, pruefung, vorher, sessionWahl }) {
  // Der Zustand kommt vom Einzelabruf an der Karte, nicht aus der Sammelliste
  // `issue list --status in_review` (Issue #927): Im Lauf night-run-2026-09-25-061517
  // fuehrte die Liste eine Karte nicht, die nachweislich in In review stand — die
  // Session hatte sie dorthin gezogen, gruen geprueft und committet —, und der Runner
  // stellte ein fertiges Paket zurueck. `leseKarte` fragt dort, wo die Antwort
  // eindeutig ist; denselben Weg geht der Ketten-Pfad in `paketeAbschliessen`.
  const kartenStatus = leseKarte(top.id)?.status ?? null;
  // Unbekannter Zustand: KEINE Board-Mutation. Aus fehlendem Wissen eine
  // Rueckstellung zu machen ist genau der Fehlgriff, den dieses Paket behebt. Der
  // Ausgang ist `fehlschlag` — das Wort des Laufs fuer "Karte bleibt, Commit bleibt,
  // weiter"; WARUM sie bleibt, sagt allein diese Log-Zeile.
  if (kartenStatus === null) {
    log(`  Fehlschlag nach ${minutes} min: Issue #${top.id} — ${ZUSTAND_UNLESBAR_GRUND}`);
    return "fehlschlag";
  }
  if (kartenStatus === "in_review") return werteInReview(top, minutes, pruefung);

  // Infrastruktur-Guard (Issue #149): Exit != 0 ohne Timeout heisst, das CLI selbst
  // ist gescheitert (Auth abgelaufen, Fehlkonfiguration) — mit dem Issue ist nichts
  // falsch. Harter Stopp ohne Kommentar und ohne Backlog-Move, sonst raeumt eine
  // kaputte Umgebung die ganze Ready-Spalte leer.
  //
  // Seit Issue #1088 (E13) nur noch, wenn die Sitzung kein Ereignis gemeldet hat, und erst
  // nach dem einen Versuch in runSession: Eine Sitzung, die zustande kam und mit Exit
  // ungleich 0 endete, ist ein Paketfehler und geht den Weg jeder Runde ohne Ergebnis.
  // Die Kommando-Stufe meldet keine Ereignisse und bleibt beim harten Stopp.
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  const kommando = Boolean(sessionWahl?.kommando);
  if (!timedOut && (res.error || res.status !== 0) && (kommando || !hatSitzungsereignis(res.stdout))) {
    const exitInfo = exitText(res);
    const detail = (res.stderr || res.stdout || "").trim().split(/\r?\n/).slice(0, 3).join(" | ");
    const kopf = `INFRASTRUKTUR-FEHLSCHLAG nach ${minutes} min (${exitInfo}): Session-Start gescheitert — harter Stopp, Issue #${top.id} bleibt unangetastet.`;
    log(`  ${kopf}`);
    if (detail) log(`  CLI-Meldung: ${detail}`);
    // Beide Protokollzeilen, in derselben Reihenfolge (Issue #558): Die CLI-Meldung ist
    // hier das Einzige, was den Ausfall benennt — exitInfo allein sagt nur, dass es ihn gab.
    merkeHartenStopp("umgebung", detail ? `${kopf}\nCLI-Meldung: ${detail}` : kopf);
    anhaltenVermerken(detail ? `Sitzungsstart gescheitert (${exitInfo}): ${detail}` : `Sitzungsstart gescheitert (${exitInfo})`);
    return "hardStop";
  }

  if (!gitClean()) return haltMitUnsauberemBaum(top, minutes, vorher) ?? behandleDirtyRunde(top, args, minutes, salvageAttempted, res, pruefung, sessionWahl);

  // Der Halt-Zweig (Issue #572) — NACH dem Infrastruktur- und dem Dirty-Guard und VOR
  // der Rueckstellung. Ein abgestuerztes CLI und ein unsauberer Baum sind auch dann
  // kein Halt, wenn das Label steht. Hier ist der Halt kein Fehler: eigene Log-Zeile,
  // kein Board-Kommentar und kein Move — beides hat die Session bereits getan.
  const haltArt = istHalt(vorher, board("issue", "get", String(top.id)));
  if (haltArt) {
    HALT_ART = haltArt;
    log(`  angehalten: ${HALT_LOG_TEXT[haltArt]} — Issue #${top.id} nach ${minutes} min von der Session ins Backlog gezeichnet, kein Kommentar und kein Move durch den Runner, weiter.`);
    return "angehalten";
  }

  return stelleRundeZurueck(top, res, minutes, pruefung);
}

/**
 * Der Erfolgspfad: Die Karte steht in In review (Issue #404, herausgezogen in #927).
 *
 * Steht getrennt von `werteRunde`, seit dort mit dem unlesbaren Zustand eine dritte
 * Verzweigung hinzukam: Die Auswertung liest sich sonst als eine Folge von Guards, in
 * deren erstem Zweig zwei weitere Guards stecken.
 */
function werteInReview(top, minutes, pruefung) {
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

/**
 * Der Rueckstellungsweg: kein In-review-Ergebnis, Arbeitsbaum sauber, kein Halt
 * (Issue #488, um die wartende Sitzung erweitert in #776).
 *
 * Steht getrennt von `werteRunde`, seit der Zweig zwei Faelle unterscheidet — die
 * Auswertung liest sich sonst als eine Folge von Guards mit einem Schluss, der selbst
 * wieder verzweigt.
 *
 * Der Fall der wartenden Sitzung (Plan #773) VERFEINERT die Rueckstellung und loest sie
 * nicht ab: Ausgangsart, Backlog-Move und Weiterlauf haengen am Zustand des
 * Arbeitsverzeichnisses, und der ist hier sauber. Anders ist nur, was der Morgen liest —
 * ein Text, der den Fall benennt, statt eine geordnete Rueckstellung zu behaupten.
 */
function stelleRundeZurueck(top, res, minutes, pruefung) {
  const grund = rueckstellungsGrund(res, pruefung);
  if (grund === GRUND_WARTEND) WARTEND_BEENDET = true;
  if (grund === GRUND_ZEITLIMIT) ZEITLIMIT_BEENDET = true;
  // Der Grund steht VOR dem Zustand — dieselbe Ordnung wie im Dirty-Zweig (Issue #668):
  // erst warum die Runde nichts abgeschlossen hat, dann was der Runner vorgefunden hat.
  const grundTeil = grund ? ` — ${grund};` : "";
  log(`  Fehlschlag nach ${minutes} min: Issue #${top.id}${grundTeil} nicht in In review, Tree sauber — Issue ins Backlog, weiter.`);
  // Der Vermerk IST der Kommentar: Er traegt seinen Grund bereits im Wortlaut, und ein
  // vorangestelltes zweites Mal waere dieselbe Aussage doppelt. Ohne Pfade — in diesem
  // Zweig ist der Baum sauber, und eine Meldung ueber nichts ist keine.
  const vermerk = rundenVermerk(grund, res);
  board("issue", "comment", String(top.id), "--text", vermerk ?? `Nachtlauf: ${DEFERRED_GRUND}`);
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
  // Beim geschuetzten Treffer erst der Move, dann Label und Kommentar (E11) — der Kommentar
  // ist der Halt-Text samt Label-Zeile, ein zweiter entsteht nicht.
  if (gate.art === "geschuetzt") {
    board("issue", "move", String(top.id), "backlog");
    geschuetztAmBoardVermerken(top, gate);
    einheitErgaenzen(einheitAnlegen(top.id, top.title), { ausgang: "zurueckgestellt", grund: gate.log });
    return;
  }
  // Die zweite Logzeile je Kreis (Issue #1063, E10) — die erste bleibt einzeilig wie bisher.
  for (const zeile of gate.kreisLog ?? []) log(zeile);
  // Der Befund-Block des Abhaengigkeits-Gates (Issue #1062, E10) nur hier, an der Karte.
  const text = gate.block ? `${gate.kommentar}\n\n${gate.block}` : gate.kommentar;
  board("issue", "comment", String(top.id), "--text", text);
  board("issue", "move", String(top.id), "backlog");
  einheitErgaenzen(einheitAnlegen(top.id, top.title), { ausgang: "zurueckgestellt", grund: gate.kommentar });
  // Haengt das Paket an einem Paket, das in diesem Lauf abgebrochen ist, wartet es (E15) —
  // zusaetzlich zum Rueckstell-Kommentar, der unveraendert bleibt.
  const an = (gate.unmet ?? []).filter((n) => ABGEBROCHENE_PAKETE.has(Number(n)));
  if (an.length > 0) standSetzen(top.id, "wartet", an.map((n) => `hängt an #${n} (abgebrochen in diesem Lauf)`).join("\n"));
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
  const { stufen, stufenRegel, grund } = frischeStufenFelder(CONFIG_PATH, ZUSTAND.config);
  if (grund) log(`  ${grund}`);
  ZUSTAND.config.night ??= {};
  for (const [feld, wert] of [["stufen", stufen], ["stufenRegel", stufenRegel]]) {
    if (wert === undefined) delete ZUSTAND.config.night[feld];
    else ZUSTAND.config.night[feld] = wert;
  }
}

/**
 * Die Hinweiszeile einer Runde zur Modellwahl, oder `null` (Issue #665, erweitert um #711
 * und #846).
 *
 * Sie erscheint nur, wenn es etwas zu sagen gibt — eine Stufe im Spiel oder ein Grund.
 * Ein Paket ohne beides protokolliert wie bisher nichts: Eine Zeile je Paket, die nur
 * "Modell des Laufs" wiederholt, machte die interessanten Zeilen unsichtbar.
 */
function rundenHinweis({ modell, herkunft, grund, stufe, stufeVerwendet, effort }) {
  if (!stufe && !grund) return null;
  const teile = [];
  if (stufe) teile.push(`Aufgabenstufe ${stufe}`);
  teile.push(modell ? `Modell ${modell} (${herkunft})` : `kein Modell (${herkunft})`);
  if (stufeVerwendet && stufeVerwendet !== stufe) teile.push(`ueber Stufe ${stufeVerwendet}`);
  // Nur wenn gesetzt (Issue #846): Ohne Gruendlichkeit bleibt die Zeile wortgleich mit
  // der von vorher — eine Stufe ohne `effort` faehrt mit der Voreinstellung der CLI, und
  // das ist keine Auskunft, die eine eigene Angabe verdient.
  if (effort) teile.push(`Gruendlichkeit ${effort}`);
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
  // Jede Runde ist ein Schritt ihres Pakets mit eigenem Protokoll (Issue #1090, E16) —
  // die Salvage-Session derselben Runde schreibt mit hinein.
  const vorherLog = schrittBeginnen(top.id, "umsetzung");
  try {
    return await rundeLaufen(top, args, salvageAttempted, pruefungen);
  } finally {
    schrittEnden(vorherLog);
  }
}

/** Der Inhalt von `laufeRunde`, ganz im Protokoll ihres Schritts. */
async function rundeLaufen(top, args, salvageAttempted, pruefungen) {
  // Die Einheit entsteht VOR der Session und wird sofort geschrieben: Bricht der Lauf
  // mitten in der Runde ab, steht das gezogene Paket trotzdem im Stand — mit ausgang
  // "unbekannt", was etwas anderes sagt als ein Fehlschlag.
  const commitVorher = lastCommitHash();
  const started = Date.now();
  // Der Laufstand des Pakets an der Paketkarte (Issue #1089, E2) — in Kette und
  // Umsetzungsnacht gleich, denn beide gehen durch diese Runde.
  standSetzen(top.id, "laeuft", `Umsetzung laeuft seit ${new Date(started).toISOString()}`);
  ABBRUCH_GRUND = "";
  // Vor dem Start verwerfen, direkt danach lesen (Issue #428): So zaehlt fuer eine
  // Session nur, was sie selbst geschrieben hat — und die Salvage-Session, die
  // weiter unten in werteRunde laufen kann, ist aussen vor.
  verwerfeZusammenfassung();
  // Ebenfalls vor dem Start (Issue #776): Der Merker der wartenden Sitzung gehoert dieser
  // einen Runde. Ohne das Zuruecksetzen truege die naechste Einheit den Befund der
  // vorigen — und im Ergebnisstand stuende eine Runde als wartend, die es nie war.
  WARTEND_BEENDET = false;
  // Und der Merker des Zeitabbruchs, aus demselben Grund (Issue #977).
  ZEITLIMIT_BEENDET = false;
  // Und die Art des Halts (Issue #1050).
  HALT_ART = null;
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
    einstellung: stufenEinstellung(ZUSTAND.config),
    erlaubteModelle: ZUSTAND.config.night?.modelle,
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
  if (!modellStand.startbar) {
    const ohne = ohneSessionGescheitert(top, einheit, modellStand, started);
    paketStandAbschliessen(top, ohne, einheit.grund);
    return ohne;
  }

  // Womit die Session startet (Issue #711): Modellname oder die Kommandozeile der Stufe.
  // Dasselbe Buendel geht spaeter an die Salvage-Session desselben Pakets — sie prueft den
  // Zwischenstand der regulaeren Runde und muss dafuer auf demselben Weg laufen.
  // `effort` gehoert ins selbe Buendel (Issue #846): Es ist die Gruendlichkeit der Stufe,
  // die auch das Modell gestellt hat, und die Salvage-Session desselben Pakets soll auf
  // demselben Weg laufen — mit demselben Modell und derselben Gruendlichkeit.
  const sessionWahl = modellStand.kommando
    ? { model: modellStand.modell, kommando: modellStand.kommando, stufenName: modellStand.stufenName, aufgabenstufe: modellStand.stufe }
    : { model: modellStand.modell, effort: modellStand.effort };
  // `stream` und `vordergrundCheck` seit Issue #668. Der Strom traegt `stop_reason`, an
  // dem der Grund-Praefix haengt — ohne ihn waere der Fall, den dieses Paket erkennbar
  // macht, in genau den Laeufen unsichtbar, die mit `--verbose no` fahren. `vordergrundCheck`
  // sperrt `Monitor` und hebt die Bash-Zeitlimits; beides gilt nur fuer die
  // Implementierungs-Runde.
  const res = await runSession(top.id, args, { stream: true, vordergrundCheck: true, ...sessionWahl });
  // Einmal lesen und durchreichen (Issue #471): Die Salvage-Session, die in
  // werteRunde laufen kann, wuerde die Datei sonst ueberschreiben, und der
  // zweite Lesevorgang bewertete ihren Lauf statt den der regulaeren Session.
  //
  // Der Commit dieser Session, sofort nach ihr (Issue #865): Er ist der Stand, zu dem
  // der Nachweis gehoeren muss. `commitNachher` weiter unten taugt dafuer nicht — es
  // steht hinter werteRunde und kann der Commit einer Salvage-Session sein.
  const commitDerSession = lastCommitHash();
  const pruefung = bewertePruefung(top.id, commitDerSession === commitVorher ? null : commitDerSession, ZUSTAND.config);
  pruefungen.push(pruefung);
  // Die gerundete Minutenangabe fuer die Textzeilen der Auswertung: Sie benennt die
  // Dauer der Implementierungs-Session und wird deshalb VOR werteRunde bestimmt.
  const minutes = ((Date.now() - started) / 60000).toFixed(1);

  const ausgang = await werteRunde({ top, res, minutes, args, salvageAttempted, pruefung, vorher, sessionWahl });
  // Die Rohdifferenz fuer den Ergebnisstand, NACH werteRunde (Issue #488, korrigiert im
  // Code-Review zu #924): In werteRunde kann eine Salvage-Session laufen, samt ihrer
  // Vorpruefungen. Vor dem Aufruf gemessen fehlte diese Zeit, und ein Paket mit langer
  // Rettung erschiene faelschlich unter der Zielmarke — die Quelle verlangt die Dauer
  // "bis zum bestandenen Abschluss, einschliesslich aller Pruefungen und Korrekturen".
  const dauerMs = Date.now() - started;
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
    // Ganz hinten (Issue #776): Neue Felder haengen an, die bestehenden behalten Namen und
    // Reihenfolge — sie sind der Vertrag mit den Auswertungen.
    ...wartendFelder(),
    ...zeitlimitFelder(),
    // Die Art des Halts (Issue #1050), nur beim Halt — sonst WEG, wie die beiden davor.
    ...(ausgang === "angehalten" && HALT_ART ? { haltArt: HALT_ART } : {}),
  });
  paketStandAbschliessen(top, ausgang, rundenStandGrund(ausgang, { einheit, pruefung, res, commit: commitNachher }));
  return ausgang;
}

// Der Laufstand eines Pakets nach dem Ausgang seiner Runde (E2); alles Uebrige ist `abgebrochen`.
const RUNDEN_STAND = { erfolg: "fertig", angehalten: "wartet" };

/** Der Grund im Laufstand einer Runde, je Ausgang aus dem, was die Auswertung schon weiss. */
function rundenStandGrund(ausgang, { einheit, pruefung, res, commit }) {
  if (ausgang === "erfolg") return `In review mit Nachweis (${pruefung?.zustand ?? "ungeprueft"}), Commit ${commit}`;
  if (ausgang === "angehalten") return HALT_STAND_TEXT[HALT_ART ?? "klaeren"];
  if (ausgang === "deferred") return `${rundenGrund(res, pruefung)}; die Karte ging ins Backlog, der Lauf weiter`;
  if (ausgang === "fehlschlag") return nachweisMangel(pruefung) ?? ZUSTAND_UNLESBAR_GRUND;
  return einheit.grund ?? ZUSTAND.STOPP_GRUND;
}

/**
 * Setzt den Laufstand eines Pakets zum Ende seiner Runde (Issue #1089, E2): `fertig` bei In
 * review mit Nachweis, `wartet` beim Halt, sonst `abgebrochen` mit Grund. Nach dem Anhalten
 * steht der Stand schon (E15). Ein abgebrochenes Paket merkt sich der Lauf fuer das Gate.
 */
function paketStandAbschliessen(top, ausgang, grund) {
  if (anhaltenLaeuft()) return;
  const zustand = RUNDEN_STAND[ausgang] ?? "abgebrochen";
  if (zustand === "abgebrochen") ABGEBROCHENE_PAKETE.add(Number(top.id));
  standSetzen(top.id, zustand, `Runde beendet: ${ausgang} um ${new Date().toISOString()}\n\n${grund}`);
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
 * Der Fall eines Laufs, dem Ready ausgegangen ist (Issue #887).
 *
 * Eine leere Spalte, die dieser Lauf selbst geraeumt hat, ist keine leere Spalte:
 * "Ready ist leer" schickte den Morgen dann in die falsche Richtung.
 */
function fallLeeresReady(lauf) {
  return lauf.zaehler.deferred > 0
    ? { fall: "alleZurueckgestellt", daten: { anzahl: lauf.zaehler.deferred } }
    : { fall: "readyLeer", daten: {} };
}

/**
 * Vermerkt am Lauf, was ein nicht genommener Umsetzungs-Lock bedeutet (Issue #887).
 *
 * Die beiden Arten stehen fuer Verschiedenes (Issue #886): Ein belegter Lock ist ein
 * ruhiger Lauf neben einem anderen und endet ohne Paket; ein Schreibfehler ist eine
 * Stoerung der Umgebung und gehoert als harter Stopp gemeldet, nicht als ruhige Nacht
 * weggeschrieben. Der Schreibfehler geht denselben Weg wie der Vorflug-Guard: Hier ist
 * kein Paket gezogen, der Grund gehoert deshalb an den Lauf und nicht an eine Einheit.
 *
 * Die Schleife ruft das und bricht danach ab — sie bricht also nicht ohne Auskunft ab.
 */
function lockFehlschlagVermerken(lauf) {
  if (lauf.lock.art === "schreibfehler") {
    merkeHartenStopp("umgebung", lauf.lock.grund);
    hefteStoppGrundAnLauf();
    lauf.hardStop = true;
    return;
  }
  lauf.ohneArbeit = { fall: "umsetzungBelegt", daten: { grund: lauf.lock.grund } };
}

/**
 * Die Runden der Umsetzungsnacht, eine nach der anderen.
 *
 * Fuehrt ihren Zustand in `lauf`, nicht ueber Rueckgaben: Bricht sie mit `break` ab — und
 * das tun vier harte Stopps —, muss der Aufrufer trotzdem wissen, wie weit sie kam.
 *
 * Kein `break` ohne Auskunft (Fachliche Quelle #880): Jedes Ende ohne Paket merkt sich
 * seinen Fall auf `lauf.ohneArbeit`, ausgewertet wird er EINMAL nach der Schleife. Dass
 * die Faelle hier nur gemerkt und nicht schon vermerkt werden, ist der Punkt: Ob der
 * Lauf ueberhaupt ohne Arbeit blieb, weiss erst der Aufrufer — und vier Stellen, die
 * dieselbe Frage beantworten, laufen auseinander.
 */
async function implementierungsSchleife(args, ctx, lauf) {
  let iterations = 0;
  Object.assign(LAUF_KONTEXT, { karte: null, kandidaten: () => umsetzungsKandidaten(ctx) });
  while (lauf.sessions < args.max && iterations < MAX_ITERATIONS) {
    iterations++;
    LAUF_KONTEXT.karte = null;
    const ready = board("issue", "list", "--status", "ready");
    if (ready.length === 0) {
      lauf.ohneArbeit = fallLeeresReady(lauf);
      break;
    }
    warnWennLabelNirgendsVorkommt(ctx, ready);

    // Routing-Label (#159): erstes Ready-Issue mit dem gesuchten Label; ungelabelte
    // Issues davor bleiben unangetastet. Kein Treffer -> Lauf endet wie bei leerem Ready.
    const top = ctx.labelFilter === null ? ready[0] : ready.find(ctx.hasLabel);
    if (!top) {
      lauf.ohneArbeit = { fall: "keinLabel", daten: { label: ctx.labelFilter, anzahl: ready.length } };
      break;
    }
    // Ab hier ist es die Karte des Laufs: Ein Umgebungsfehler wird an ihr vermerkt (E13).
    LAUF_KONTEXT.karte = String(top.id);

    const gate = pruefeIssueGates(top);
    if (gate) {
      stelleAmGateZurueck(top, gate);
      lauf.zaehler.deferred++;
      continue;
    }

    // Erst hier, nicht beim Eintritt: Ein Lauf, der an leerem Ready, am Routing-Label oder
    // an lauter Gates endet, setzt keine Umsetzung in Gang und darf keine Kette abhalten.
    lauf.lock ??= lockVorErsterSession();
    if (!lauf.lock.ok) {
      lockFehlschlagVermerken(lauf);
      break;
    }
    // Der feste Kit-Stand in der Hauptkopie (Issue #1102, A3): nach dem Zustands-Vorflug und
    // erst mit dem Lock — ein Lauf ohne ihn ueberschriebe die Kopie dessen, der gerade baut.
    kitStandInBaum(process.cwd());

    lauf.sessions++;
    log(`Session ${lauf.sessions}/${args.max}: Issue #${top.id} — ${top.title}`);
    const ausgang = await laufeRunde(top, args, lauf.salvageAttempted, lauf.pruefungen);
    // Kein `break` bei Paketfehlern (Issue #1089, E14): Ein abgebrochenes Paket haelt nur
    // sich und die von ihm abhaengigen an. Der harte Stopp bleibt fuer Umgebung und Reste
    // nach einem Erfolg.
    if (ausgang === "hardStop") {
      lauf.hardStop = true;
      break;
    }
    lauf.zaehler[ausgang]++;
  }
}

/**
 * Die Karten, die die Schleife jetzt als naechste aufnaehme (E15): Ready mit Routing-Label,
 * die `pruefeIssueGates` bestehen — so, wie sie im Moment des Anhaltens am Board liegen.
 */
function umsetzungsKandidaten(ctx) {
  const ready = board("issue", "list", "--status", "ready");
  return ready
    .filter((issue) => ctx.labelFilter === null || ctx.hasLabel(issue))
    .filter((issue) => !pruefeIssueGates(issue))
    .map((issue) => String(issue.id));
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
    zaehler: { erfolg: 0, deferred: 0, fehlschlag: 0, angehalten: 0, abgebrochen: 0 },
    // Genau ein Salvage-Versuch pro Issue und Lauf (#167).
    salvageAttempted: new Set(),
    // Der Fall, an dem die Schleife ohne Paket endete (Issue #887) — gemerkt in der
    // Schleife, ausgewertet danach.
    ohneArbeit: null,
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
    kitStandAbgeben(process.cwd());
  }
  const { sessions, hardStop } = lauf;

  // Die eine Stelle, die "gab es Arbeit?" beantwortet (Issue #887). Ein harter Stopp ist
  // kein Lauf ohne Arbeit, sondern eine Stoerung: Er traegt seinen `fehlerText`, und ein
  // `noWorkReason` daneben liesse ihn wie eine ruhige Nacht aussehen. Fehlt der Fall,
  // sagt der Rueckfall ausdruecklich, dass hier eine Lage unbenannt geblieben ist.
  if (sessions === 0 && !hardStop) {
    const { fall, daten } = lauf.ohneArbeit ?? { fall: null, daten: {} };
    vermerkeOhneArbeit(fall, daten);
  }

  // Der Abschluss gehoert hierher und nicht in main(): Der Dry-Run beendet den Prozess
  // selbst und kaeme an einer Stelle in main() nie an.
  laufAbschliessen(hardStop ? "harterStopp" : "regulaer");
  return {
    sessions, hardStop, pruefungen,
    succeeded: zaehler.erfolg,
    deferred: zaehler.deferred,
    ohneNachweis: zaehler.fehlschlag,
    angehalten: zaehler.angehalten,
    abgebrochen: zaehler.abgebrochen,
  };
}

async function main() {
  // Der Waechter eines Laufs (Issue #1085) ist kein Lauf: keine Handler, kein Lauf-Kopf.
  if (process.argv[2] === "--waechter") {
    await waechterLaufen(process.argv[3]);
    process.exit(0);
  }
  const args = parseArgs(process.argv.slice(2));
  // Der feste Kit-Stand (Issue #1102, A2): Hat der Lauf einen, arbeitet ein Kind aus ihm, und
  // dieser Prozess reicht nur noch Signale weiter und endet mit dessen Exit-Code. `--version`
  // und `--help` enden schon in parseArgs, `--dry-run` und `--waechter` brauchen keinen Stand.
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
  // Die Kette steht vor dem Dry-Run: --kette --dry-run ist ein Trockenlauf DER KETTE.
  if (args.kette) {
    await laufeKette(args);
    return;
  }
  // Der Prueflauf ebenso vor dem Dry-Run (Plan #904, E17): `--pruefen --dry-run` weist
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
  const abgebrochen = ergebnis.abgebrochen ? ", " + ergebnis.abgebrochen + " abgebrochen mit Resten im Stash" : "";
  log(`Nacht-Runner beendet: ${ergebnis.succeeded} erfolgreich, ${ergebnis.deferred} zurueckgestellt, ${ergebnis.ohneNachweis ?? 0} ohne gueltigen Nachweis, ${ergebnis.sessions} Session(s) gestartet, ${ergebnis.angehalten ?? 0} angehalten${abgebrochen}${ergebnis.hardStop ? ", HARTER STOPP" : ""}.`);
  for (const zeile of pruefBericht(ergebnis.pruefungen, ZUSTAND.LAUF?.einheiten ?? [], ZUSTAND.config?.night?.zielUmsetzungMin)) log(zeile);
  log(`Morgen-Ritual: /review -> Test -> push main. Protokoll: ${ZUSTAND.LOG_FILE}`);
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

if (runAsCli) await main();
