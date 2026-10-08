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
import { existsSync, readFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "4.1.0";

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
                     Ein Ziel-Label bestimmt, wo die Kette endet: ziel:plan, ziel:pakete,
                     ziel:umsetzung oder ziel:push-vorbereitet. planreview:1 oder
                     planreview:2 an der Anforderung legt fest, wie viele Modelle den
                     Plan pruefen. Mit ziel:push-vorbereitet folgt nach allen Ketten
                     einmal die Stufe vorbereitung: /push-main vorbereiten, ohne Push,
                     Ergebnis in .claude/push-vorbereitung.json und als Nachtbericht.
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
  parseArgs, log, fail, merkeHartenStopp, hefteStoppGrundAnLauf,
  resteText, vermerkeOhneArbeit, laufMelden, ersteZeile, schreibeErgebnisstand,
  BOARD_MAX_BUFFER, board, gitReste, gitClean,
  ladeConfigMitOverrides, laufArt } = await import("./night/grundlagen.mjs");
export const { nightStandLaden, journalLesen, laufendeKarten, standSetzen, abgeben, staendeNachtragen,
  hatSitzungsereignis, verwaisteLaeufeAbschliessen, waechterStartOptionen } = await import("./night/laufstand.mjs");
const { anhaltenLaeuft, nightStandPruefen, pulsSchreiben, laufstandStarten, laufAbbrechen, abbruchHandlerSetzen,
  zweiterVersuch, vermerkAnDieKarte, laufAnhalten, waechterLaufen, waechterStarten,
  waechterBeenden } = await import("./night/laufstand.mjs");
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
  normalisiereVorflug, neueKommentare } = await import("./night/session.mjs");
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
  const andereAngabe = andere ? `v${andere}` : "unbekannt (Kopie ohne Versionsstempel)";
  log(
    `WARNUNG: Versions-Drift in .claude/kit/ — night.mjs ist v${KIT_VERSION}, ` +
    `board.mjs ist ${andereAngabe}. ` +
    `Die Installation ist halb aufgefrischt; bitte per install.mjs erneuern. Der Lauf geht weiter.`
  );
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

// Die Gates eines Ready-Issues, der Salvage-Versuch, die Gruende einer Runde ohne Ergebnis,
// die wartende Sitzung, die Auswertung der Runde und die Implementierungsschleife stehen seit
// Issue #1231 im Teil kit/night/wartend.mjs (Plan #1199, E17); der Einstieg laedt ihn oben
// und exportiert seine Namen weiter.

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

// Die Implementierungsschleife im Teil wartend schliesst den Lauf ab, ohne den Einstieg zu
// importieren (Plan #1199, E16): Der Abschluss steht noch hier und wird hier angebunden.
wartendAnbinden({ laufAbschliessen });

// Ebenso die Kette: Sie schliesst den Lauf ab und faehrt den Reviewer-Vorflug, ohne den
// Einstieg zu importieren (Plan #1199, E16).
ketteAnbinden({ laufAbschliessen, fuehreVorflug });

// Ebenso der Prueflauf am Tag (Issue #1234, Plan #1199, E16).
tagAnbinden({ laufAbschliessen, fuehreVorflug });

if (runAsCli) await main();
