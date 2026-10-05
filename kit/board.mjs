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
 * Ausgabe: JSON auf stdout. Einzige Ausnahme: `issue auftrag` ohne --json schreibt
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
 *   node board.mjs issue melden <id> --text '<bericht>' | --text-file <pfad>
 *   node board.mjs issue melden <id> --teil <n> --text '<stueck>'
 *   node board.mjs issue melden <id>
 *       Legt den Abschlussbericht ab und zieht nach In review, je Lauf idempotent
 *       (Issue #1022): gleicher Bericht desselben Laufs -> nichts, geaenderter ->
 *       ersetzt. --teil schreibt Stueck n nach .claude/berichte/, der Aufruf ohne
 *       --text setzt die Stuecke zusammen und schliesst ab.
 *   node board.mjs issue stand <id> --zustand laeuft|abgebrochen|wartet|fertig --text-file <pfad>
 *       Label und Kommentar '## Laufstand' einer Karte in einem Zug, wiederholbar
 *       (Issue #1083). Labelnamen aus night.stand.labels.
 *   node board.mjs issue auftrag <id> [--spalte ready|in_progress] [--json]
 *       Aufgabe, Voraussetzungen und das Urteil "darf beginnen" in einem Zug, rein
 *       lesend (Issue #1023). Ausgabe Markdown, mit --json als JSON.
 *   node board.mjs issue label add <id> <name>
 *   node board.mjs issue label remove <id> <name>
 *       Zeichnet ein Issue (z. B. kit:klaeren). Nicht fuer Status-Labels — die
 *       aendert `issue move` (Issue #249).
 *   node board.mjs code repo-name
 *   node board.mjs code pr --from <branch> --to <branch>
 *   node board.mjs code ci-status --commit <sha>
 *       Zustand der CI fuer genau diesen Commit (Issue #316). Dispatcht ueber
 *       resolveCodeHost — die Achse haengt am codeHost, nicht am issueTracker.
 *   node board.mjs kontext paths [--project <name>] [--date JJJJ-MM-TT]
  node board.mjs kontext last-log [--project <name>] [--before JJJJ-MM-TT]
  node board.mjs issue-review reviewers --author <modell>
  node board.mjs issue-review check [--nur-pfad]
  node board.mjs issue-review matrix
  node board.mjs issue-review roles --stufe <fachlich|plan|issue> --author <modell>
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, realpathSync } from "node:fs";
import path, { resolve, join, dirname, basename, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.6.1";


const HELP = `board.mjs — Board-Adapter fuer das claude-workflow-kit

Nutzung:
  node board.mjs issue create --title "..." --body "..." | --body-file <pfad> | --body -
                             [--author-model <modell>] [--derived-from <nummer>]
                             [--idempotency-key <wert>]
      --derived-from traegt die Kartennummer des naechsten Vorfahren ins Board
      (Issue #356). Nur kanbancompat wertet sie aus; die uebrigen Tracker nehmen
      sie folgenlos an. Nachtragen geht nicht — sie wirkt nur beim Anlegen.
      --idempotency-key wiederholt einen Aufruf, dessen Ausgang unklar blieb, ohne
      ihn ein zweites Mal auszufuehren (Issue #834). Ohne den Schalter entsteht der
      Schluessel je Auftrag selbst; die Fehlermeldung nennt ihn samt Kommando.
      Hat der Body einen Abschnitt '## Abhaengigkeiten', traegt die Ausgabe dessen
      'hinweise' wie bei 'check-form' (Issue #1060); sie beruehren das Anlegen nicht.
  node board.mjs issue get <id>
  node board.mjs issue activity <id>      Aktivitaetsverlauf (local, toolbox)
  node board.mjs issue activity --ids <n,n,...>
      Verlauf mehrerer Karten als Objekt {"<nummer>": [...]}. Loest die Kartenliste
      genau einmal auf; eine unbekannte Nummer erscheint mit Fehlergrund (Issue #786).
  node board.mjs issue list [--status <status>]
  node board.mjs issue move <id> <status>
  node board.mjs issue update <id> --body "..." | --body-file <pfad> | --body -
      Ausgabe { ok, id }, dazu 'hinweise' zum Abschnitt '## Abhaengigkeiten' wie bei
      'issue create' (Issue #1060).
  node board.mjs issue comment <id> --text "..." | --text-file <pfad> | --text -
                             [--idempotency-key <wert>]
      '-' liest von stdin, gut fuer kurze Texte; fuer lange '--text-file' (Issue #584).
      --idempotency-key wie bei 'issue create' (Issue #834).
  node board.mjs issue melden <id> --text '<bericht>' | --text-file <pfad>
  node board.mjs issue melden <id> --teil <n> --text '<stueck>'
  node board.mjs issue melden <id>
      Legt den Abschlussbericht ab und zieht die Karte danach nach In review (Issue
      #1022). Der Bericht bekommt als letzte Zeile 'Bericht-Lauf: <stempel>' (juengster
      Zug der Karte nach in_progress aus .claude/bewegungen.tsv). Je Lauf idempotent:
      gleicher Inhalt -> nichts geschrieben, geaenderter -> ersetzt, Berichte anderer
      Laeufe bleiben. Ein ' im Bericht wird in der Shell als '\\'' geschrieben.
      --teil <n> schreibt nur Stueck n nach .claude/berichte/<id>.<n>.md (ohne Board);
      der Aufruf ohne --text setzt die Stuecke in Nummernfolge zusammen, schliesst ab
      und raeumt sie erst danach. Scheitert er, ist die Wiederholung derselbe Aufruf.
      Ausgabe: { ok, id, bericht: angelegt|ersetzt|unveraendert, status: in_review }.
  node board.mjs issue stand <id> --zustand laeuft|abgebrochen|wartet|fertig --text-file <pfad>
      Laufstand einer Karte in einem Zug (Issue #1083): setzt das Label des Zustands
      und nimmt die beiden anderen ab (fertig: alle drei), dazu genau ein Kommentar
      '## Laufstand', bei jedem Aufruf ersetzt. Die Labelnamen kommen aus
      night.stand.labels der Config (Vorgaben lauf:laeuft, lauf:abgebrochen,
      lauf:wartet). Kommentare werden streng gelesen; nicht lesbar -> Exit 1, nichts
      geschrieben. Ausgabe: { ok, id, zustand, kommentar: angelegt|ersetzt|unveraendert }.
  node board.mjs issue auftrag <id> [--spalte ready|in_progress] [--json]
      Alles, was eine Umsetzung vor dem Beginn braucht, in einem Aufruf (Issue #1023):
      Urteil (darf beginnen | darf nicht beginnen) mit Folge (beginnen | bleibt |
      backlog samt woertlichem Kommentartext | geschuetzt: nennt das Paket eine
      geschuetzte Datei und ist nicht freigegeben, Backlog, label add kit:geschuetzt,
      dann der Halt-Kommentar aus check-geschuetzt plus Label-Zeile; das Label
      kit:geschuetzt selbst ergibt backlog, Issue #1052), Aufgabe (Titel, Body, Labels, Spalte,
      Kommentare), Plan-Entscheidungen im Wortlaut (Auswahl aus der Zeile
      'Plan-Entscheidungen:', ohne sie alle), fachlicher Anlass (Ziel und Fachliche
      Akzeptanzkriterien der 'Fachlichen Quelle'), Geschwister des Plans mit Spalte
      (Issue #1024) und Voraussetzungen aus '## Abhaengigkeiten' (erfuellt ab In review).
      Was sich nicht ermitteln laesst, steht unter Luecken. Rein lesend. --spalte in_progress erwartet die Karte in In progress statt Ready.
      Ausgabe: Markdown mit sieben '##'-Gliedern -- die einzige Ausnahme von JSON auf
      stdout; --json liefert dieselben Glieder als Felder. Exit 0 auch bei 'darf nicht
      beginnen', Exit 1 nur, wenn das Paket nicht lesbar ist.
  node board.mjs issue label add <id> <name>
  node board.mjs issue label remove <id> <name>
      Zeichnet ein Issue (z. B. kit:klaeren). Status-Labels aendert \`issue move\`.
  node board.mjs issue check-form <id>
  node board.mjs issue check-form --body-file <pfad> --title "<titel>"
      Formpruefung gegen die maschinellen Gates der Stufe (Issue #628): fachlich
      F1 F2 F6 F7 F9 F11, plan P1 P2 P3 P6 P12, Arbeitspaket I1 bis I9. Die Stufe
      kommt aus dem Titel-Praefix. I7 bis I9 (Issue #1044): '## Aufgabe' nennt eine
      Datei als Backtick-Pfad, keine genannte Datei ist geschuetzt (Sperren aus den
      Einstellungen der Projektwurzel), '## Aufgabe' nennt nicht die installierte
      Kopie; ein [Mensch]-Paket besteht alle drei. Immer JSON ({ ok, stufe, verstoesse }), Exit 1
      bei Verstoessen; ein abgewiesener Aufruf traegt 'fehler'. Schreibt nie ans Board.
      Bei [Plan] zusaetzlich 'hinweise' ([{ baustein, test, meldung }], Issue #1031):
      eigene Tests gefuehrter Bausteine, die der Plan nicht nennt, nach den Ablagen aus
      'testAblagen' gegen 'git ls-files'; sie beruehren weder ok noch den Exit-Code.
      Beim Arbeitspaket 'hinweise' zum Abschnitt '## Abhaengigkeiten' ([{ art, nummer,
      stelle, meldung }], Issue #1060): 'schreibweise' je #N ausserhalb einer Verweiszeile
      ('Issue #N' am Zeilenanfang), 'dokument' je #N auf eine [Plan]-, [Fachlich]- oder
      [Idee]-Karte. Der Nachtlauf liest beide als Abhaengigkeit; auch sie beruehren weder
      ok noch den Exit-Code. Eine Karte, die sich nicht nachschlagen laesst, bleibt still.
  node board.mjs issue check-geschuetzt <id> [--pfad <pfad>]
      Geschuetzte Dateien eines Pakets (Issue #1045, Plan #987): Treffer aus Aufgabe und
      Akzeptanzkriterium gegen die Sperren der Projektwurzel; --pfad (auch mehrfach,
      Issue #1053) nimmt einen beim Schreiben abgewiesenen Pfad dazu, ist er geschuetzt,
      mit der Zeile 'beim Schreiben abgewiesen' — fuer den Rueckfall-Halt, wenn die
      Aufgabe ihn nicht nennt. Dazu das Label kit:geschuetzt
      und die Freigabe — ein Halt-Kommentar '## Geschuetzte Datei' mit der Zeile
      'Label kit:geschuetzt gesetzt', das Label abgenommen und jeder Treffer dort
      genannt. Ausgabe: { ok, treffer, label, freigegeben, handlung, kommentar };
      'kommentar' ist der Halt-Text ohne Label-Zeile. Exit 1 bei ok false, auch bei
      Label ohne Treffer. Rein lesend.
  node board.mjs code repo-name
  node board.mjs code pr --from <branch> --to <branch>
  node board.mjs code ci-status --commit <sha>
      Zustand der CI fuer genau diesen Commit (Issue #316):
      { status: gruen|rot|laeuft|keine, jobs: [{ name, ergebnis, gestartet }] }. Vorrang
      rot vor laeuft vor gruen; 'keine' nur bei codeHost local, ein am Host noch
      unsichtbarer Lauf ist 'laeuft'. 'gestartet' ist die Startzeit des Jobs (ISO) oder
      null, solange er nicht gestartet ist (Issue #1151).
  node board.mjs kontext paths [--project <name>] [--date JJJJ-MM-TT]
  node board.mjs kontext last-log [--project <name>] [--before JJJJ-MM-TT]
  node board.mjs issue-review reviewers --author <modell>
  node board.mjs issue-review check [--nur-pfad]
  node board.mjs issue-review matrix
  node board.mjs issue-review roles --stufe <fachlich|plan|issue> --author <modell>
      Besetzung und Rollen der Stufe aus reviewStufen; der Autor faellt weg.
  node board.mjs nightrun melden --datei <ergebnisstand.json>
      Liefert einen Ergebnisstand des Nacht-Runners an POST /api/kanban/night-runs ein
      (nur issueTracker toolbox); derselbe Lauf wird bei jeder Meldung ersetzt.
  node board.mjs sitzung melden [--protokoll <pfad>] [--complete]
      Meldet den Verbrauch der laufenden interaktiven Sitzung an dieselbe Route
      (kind/mode INTERACTIVE, Issue #734), aufgeteilt nach den Wegmarken aus
      .claude/wegmarken.tsv. Ohne --protokoll kommt der Pfad als 'transcript_path'
      aus dem Hook-Rumpf auf stdin. --complete meldet das Sitzungsende und leert die
      Wegmarken; ohne das Flag wird hoechstens alle fuenf Minuten gemeldet.
      Schweigt ohne Fehler bei gesetztem KIT_AGENT_MODEL (der Nacht-Runner meldet
      selbst) und ohne Toolbox-Token.
  node board.mjs hook bash-pruefen
      PreToolUse-Hook fuer Bash (Issue #995): liest den Hook-Rumpf von Claude Code auf
      stdin und weist mit Exit 2 ab, wenn eine Pipe, Umleitung oder ein weiterer Befehl
      einem Kommando aus sandbox.excludedCommands die Ausnahme nimmt. Muster aus
      .claude/settings.json und .claude/settings.local.json.

  node board.mjs --version

Gueltige Status-Werte: backlog | ready | in_progress | in_review | done

Konfiguration: .claude/workflow.config.json (issueTracker, codeHost)
Fuer die kontext-Achse zusaetzlich: ~/.claude/kontext.config.json und
.claude/kontext.config.json (gemergt, lokale Felder gewinnen).
Fuer GitHub-Board-Integration: github.projectNumber in der Config setzen. Fehlt sie,
wird bei genau einem GitHub Project fuer den Owner automatisch dessen Nummer verwendet.
`;

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
  umgebungsWert, GIT_BASH_UMGEBUNG, gitBashPfad, spawnAufruf, startbefehlFuer } = await import("./board/grundlagen.mjs");
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
// Einstieg fuer Dispatch, Formpruefung und Melder; exportiert waren sie nie und bleiben es nicht.
const { KONTEXT_DEFAULTS, loadKontextConfig, kontextRepoName, heute, normalisiereZeilenenden, issueCreate,
  issueGet, issueList, issueEpics, issueActivity, WEGMARKEN_SPALTEN, WEGMARKEN_DATEI, issueMove, issueLabel,
  issueComment, issueMelden, issueStand, issueAuftrag, issueUpdate, CHECK_FORM_WEGE, CHECK_FORM_ABSCHNITTE,
  zerlegeAbschnitte } = await import("./board/dokumente.mjs");

// --- Argument-Parser ---

function parseArgs(argv) {
  const result = { _: [] };
  // Alle Werte einer mehrfach genannten Option (`--pfad a --pfad b`); `result[key]` traegt
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

// ============================================================
// Geschuetzte Pfade (Issue #1041, Plan #987, fachliche Quelle #868)
// ============================================================
//
// Zwei Naechte endeten hart, weil ein Paket eine Datei aendern sollte, die nur ein Mensch
// schreiben darf: Claude Code weist den Schreibzugriff ab, die Session darf den Schutz
// nicht umgehen und laesst ihre Arbeit liegen. Hier und nur hier wird entschieden, ob ein
// Paket einen solchen Pfad beim Namen nennt — Formgates, `issue check-geschuetzt` und das
// Gate des Runners rufen diese Funktionen, statt die Regel ein zweites Mal zu schreiben.
//
// Die Vorgabeliste traegt die Sperre, die Claude Code ueberall fuehrt und die sich nicht
// auslesen laesst: die Team- und die lokalen Einstellungen und das Hook-Verzeichnis (E2).
// Was ein Projekt zusaetzlich sperrt, kommt aus `permissions.deny` dieser beiden Dateien.
// Die Pruefeinstellungen des Kits (`workflow.config.json`) stehen bewusst NICHT darin: Sie
// sind versioniert und unter `permissions.allow` ausdruecklich freigegeben — eine Session
// darf sie schreiben, und ein Gate darauf waere ein Fehlalarm.

const EINSTELLUNGS_DATEIEN = Object.freeze([".claude/settings.json", ".claude/settings.local.json"]);

export const GESCHUETZTE_PFADE = Object.freeze([...EINSTELLUNGS_DATEIEN, ".claude/hooks/"]);

// Die installierte Kopie des Kits (E7): Sie wird nie von Hand geaendert, gemeint ist im Kit
// die Quelle, in einem installierten Projekt ein Kit-Update. Dieselbe Trefferregel (E16);
// das Gate dazu (I9) liest sie, nicht die Erkennung geschuetzter Pfade.
export const KOPIE_PFADE = Object.freeze([".claude/kit/", ".claude/skills/", ".claude/CLAUDE-*.md"]);

// `Edit(…)`/`Write(…)` aus `permissions.deny` — andere Werkzeuge sperren kein Schreiben.
const SCHREIB_REGEL = /^(?:Edit|Write)\(([^()]+)\)$/;

/**
 * Ein Claude-Code-Muster auf die Projektwurzel normalisiert (E16): `//` absolut, `~/` im
 * Home, sonst relativ zur Wurzel — ein fuehrendes `./` oder `/` faellt dabei weg.
 */
function normalisiereSchreibMuster(muster) {
  if (muster.startsWith("//")) return muster.slice(1);
  if (muster.startsWith("~/")) return join(homedir(), muster.slice(2));
  if (muster.startsWith("./")) return muster.slice(2);
  return muster.startsWith("/") ? muster.slice(1) : muster;
}

/** Die Schreibsperren einer Einstellungsdatei; fehlt oder bricht sie, sind es keine. */
function schreibSperren(datei) {
  let einstellungen;
  try {
    einstellungen = JSON.parse(readFileSync(datei, "utf8"));
  } catch {
    return [];
  }
  const deny = einstellungen?.permissions?.deny;
  if (!Array.isArray(deny)) return [];
  return deny.flatMap((regel) => {
    const m = SCHREIB_REGEL.exec(typeof regel === "string" ? regel.trim() : "");
    return m ? [normalisiereSchreibMuster(m[1].trim())] : [];
  });
}

/**
 * Die geschuetzten Pfade unter `wurzel`: die Vorgabeliste, dahinter die Schreibsperren aus
 * Team- und lokalen Einstellungen, ohne Doppel. Eine fehlende oder unlesbare Datei liefert
 * nur die Vorgabeliste und haelt nichts auf.
 */
export function geschuetztePfade(wurzel) {
  const pfade = new Set(GESCHUETZTE_PFADE);
  for (const datei of EINSTELLUNGS_DATEIEN) {
    for (const muster of schreibSperren(join(wurzel, datei))) pfade.add(muster);
  }
  return [...pfade];
}

const GLOB_ZEICHEN = /[*?]/;
const GLOB_TEIL = /\*\*\/|\*\*|\*|\?/g;

/**
 * Ein Glob als verankerter Ausdruck: `*` und `?` bleiben im Segment, `**` geht ueber
 * Segmentgrenzen, und `**` samt folgendem Trenner darf ganz verschwinden. Ein Muster ohne
 * Schraegstrich gilt wie bei `.gitignore`, nach dessen Regeln Claude Code liest, in jeder Tiefe.
 */
function globAlsAusdruck(muster) {
  const teile = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]" };
  let quelle = "";
  let letzte = 0;
  for (const m of muster.matchAll(GLOB_TEIL)) {
    quelle += escapeRegex(muster.slice(letzte, m.index)) + teile[m[0]];
    letzte = m.index + m[0].length;
  }
  quelle += escapeRegex(muster.slice(letzte));
  return new RegExp(`^${muster.includes("/") ? "" : "(?:.*/)?"}${quelle}$`);
}

/**
 * Trifft ein Pfad-Token einen Eintrag der Liste (E16)? Bei Gleichheit; bei einem Eintrag mit
 * Endung `/` auch das Verzeichnis selbst und alles darunter; bei einem Glob nach dessen Regeln.
 * Ein fuehrendes `./` am Token zaehlt nicht.
 */
export function trifftGeschuetzt(token, eintrag) {
  const pfad = String(token).startsWith("./") ? String(token).slice(2) : String(token);
  const verzeichnis = eintrag.endsWith("/");
  if (GLOB_ZEICHEN.test(eintrag)) return globAlsAusdruck(verzeichnis ? `${eintrag}**` : eintrag).test(pfad);
  if (!verzeichnis) return pfad === eintrag;
  return pfad === eintrag.slice(0, -1) || pfad.startsWith(eintrag);
}

const BACKTICK_LAUF = /`+/g;

// Die Kennzeichnung einer blossen Erwaehnung (Issue #1179): unmittelbar hinter dem Span.
const NUR_GENANNT = /^ \(nur genannt\)/;

/**
 * Die Pfad-Token der Zeilen (E3): der Inhalt jedes Backtick-Spans ohne Leerraum, je mit der
 * Zeile, in der er steht. Gepaart wird wie in Markdown — ein Span endet am naechsten Lauf
 * gleicher Laenge, ein Lauf ohne Partner ist Text. Codebloecke gibt es hier nicht mehr: Die
 * Zeilen kommen aus `zerlegeAbschnitte`, `fenceLauf` bleibt die einzige Fence-Auslegung.
 * `genannt` ist gesetzt, wenn unmittelbar hinter dem Span ` (nur genannt)` steht: Der Autor
 * erwaehnt den Pfad, das Paket schreibt ihn nicht (Issue #1179).
 */
export function pfadTokens(zeilen) {
  const tokens = [];
  for (const zeile of zeilen) {
    const laeufe = [...zeile.matchAll(BACKTICK_LAUF)];
    let i = 0;
    while (i < laeufe.length) {
      const auf = laeufe[i];
      const zu = laeufe.findIndex((l, j) => j > i && l[0].length === auf[0].length);
      if (zu === -1) {
        i += 1;
        continue;
      }
      const inhalt = zeile.slice(auf.index + auf[0].length, laeufe[zu].index);
      const genannt = NUR_GENANNT.test(zeile.slice(laeufe[zu].index + laeufe[zu][0].length));
      if (inhalt !== "" && !/\s/.test(inhalt)) tokens.push({ token: inhalt, zeile, genannt });
      i = zu + 1;
    }
  }
  return tokens;
}

/**
 * Das Token, wie es steht, absolut und — liegt es unter der Wurzel — relativ zu ihr, mit `/`
 * geschrieben wie die Sperrliste. Die relative Form entsteht ueber `relative` des Pfadmoduls
 * (Issue #1124): Unter Windows trennt `resolve` mit `\`, und ein Vergleich auf `${basis}/` liess
 * sie dort weg. `pfad` ist fuer Tests austauschbar (`path.win32`).
 */
export function tokenFormen(token, wurzel, pfad = path) {
  const basis = pfad.resolve(wurzel);
  const absolut = token.startsWith("~/") ? pfad.join(homedir(), token.slice(2)) : pfad.resolve(basis, token);
  const formen = [token, absolut];
  const rel = pfad.relative(basis, absolut);
  if (rel && !rel.startsWith("..") && !pfad.isAbsolute(rel)) formen.push(rel.split(pfad.sep).join("/"));
  return formen;
}

// Gebaut wird, was in der Aufgabe steht; geprueft, was im Kriterium steht (E4). Der Kontext
// erzaehlt die Vorgeschichte und zitiert Pfade, die das Paket gerade nicht aendert.
const GESCHUETZT_ABSCHNITTE = new Set(["aufgabe", "akzeptanzkriterium"]);

/**
 * Die geschuetzten Pfade, die ein Paket in `## Aufgabe` und `## Akzeptanzkriterium` beim
 * Namen nennt, gegen `geschuetztePfade(wurzel)`. Je Treffer der Pfad und die woertliche Zeile
 * (E17); derselbe Pfad in derselben Zeile zaehlt einmal. Ein absolut genanntes Token unter
 * der Wurzel wird auch relativ verglichen und umgekehrt, damit relative wie absolute Sperren
 * greifen. Ein als ` (nur genannt)` gekennzeichneter Pfad zaehlt an dieser Stelle nicht
 * (Issue #1179). Ein `[Mensch]`-Titel liefert immer eine leere Liste (E8): Seine Aufgabe liegt
 * ausserhalb des Repositories und ist genau die Handlung, die der Mensch vornehmen soll.
 */
export function geschuetzteTreffer(body, title, wurzel) {
  if (istMensch(title)) return [];
  const zeilen = zerlegeAbschnitte(body).abschnitte
    .filter((a) => GESCHUETZT_ABSCHNITTE.has(a.titel))
    .flatMap((a) => a.zeilen);
  return listenTreffer(zeilen, geschuetztePfade(wurzel), wurzel, { ohneGenannt: true });
}

// Halt-Kommentar und Freigabe (Issue #1045, Plan #987, E5, E11, E17). Der Text ist
// Schreib- und Leseformat zugleich: Das Gate liest beim naechsten Anlauf aus genau diesem
// Kommentar zurueck, welche Pfade der Mensch freigegeben hat. Darum baut ihn nur
// `geschuetztKommentar`, und `kit/night.mjs` prueft seine eigenen Konstanten gegen diese.

export const GESCHUETZT_ANKER = "## Geschuetzte Datei";
export const GESCHUETZT_LABEL = "kit:geschuetzt";
export const GESCHUETZT_LABEL_GESETZT = `Label ${GESCHUETZT_LABEL} gesetzt`;
export const GESCHUETZT_LABEL_NICHT_GESETZT = `Label ${GESCHUETZT_LABEL} nicht gesetzt`;
// Die zitierte Zeile eines Pfads, den der Schutz beim Schreiben abwies (Issue #1053, E13):
// Die Aufgabe nennt ihn gerade nicht, es gibt keine Zeile aus dem Paket zu zitieren.
export const GESCHUETZT_ABGEWIESEN = "beim Schreiben abgewiesen";

/**
 * Die beim Schreiben abgewiesenen Pfade, die geschuetzt sind, als Treffer mit der Zeile
 * `GESCHUETZT_ABGEWIESEN` — fuer den Halt-Kommentar des Rueckfalls, wenn die Aufgabe den
 * Pfad nicht nennt. Ein fremder Pfad ist kein Treffer.
 */
export function abgewieseneTreffer(pfade, wurzel) {
  const liste = geschuetztePfade(wurzel);
  return [...new Set(pfade)]
    .filter((pfad) => liste.some((eintrag) => tokenFormen(pfad, wurzel).some((f) => trifftGeschuetzt(f, eintrag))))
    .map((pfad) => ({ pfad, zeile: GESCHUETZT_ABGEWIESEN }));
}

/**
 * Der Pfad einer Listenzeile `- <lauf><pfad><lauf>` mit genau einem Backtick-Pfad, sonst
 * null. Die zitierten Zeilen darunter beginnen mit `>` und zaehlen darum nie als genannt,
 * auch wenn sie selbst Pfade tragen.
 */
function listenPfad(zeile) {
  if (!zeile.startsWith("- `")) return null;
  const rest = zeile.slice(2);
  const lauf = /^`+/.exec(rest)[0];
  const ende = rest.length - lauf.length;
  if (ende <= lauf.length || !rest.endsWith(lauf) || rest[ende - 1] === "`") return null;
  return rest.slice(lauf.length, ende);
}

/** Ein Pfad in einem Backtick-Lauf, der laenger ist als jeder Lauf im Pfad selbst. */
function inBackticks(pfad) {
  const laengster = Math.max(0, ...[...pfad.matchAll(BACKTICK_LAUF)].map((m) => m[0].length));
  const lauf = "`".repeat(laengster + 1);
  return `${lauf}${pfad}${lauf}`;
}

/**
 * Der Halt-Kommentar nach E17 ohne die Label-Zeile aus E11: unter dem Anker je getroffenem
 * Pfad eine Listenzeile mit genau einem Backtick-Pfad, darunter die Zeilen aus Aufgabe und
 * Akzeptanzkriterium, in denen er steht, woertlich als Zitat.
 */
export function geschuetztKommentar(treffer) {
  const jePfad = new Map();
  for (const { pfad, zeile } of treffer) {
    if (!jePfad.has(pfad)) jePfad.set(pfad, []);
    jePfad.get(pfad).push(zeile);
  }
  const liste = [...jePfad].flatMap(([pfad, zeilen]) => [`- ${inBackticks(pfad)}`, ...zeilen.map((z) => `  > ${z}`)]);
  return [
    GESCHUETZT_ANKER,
    "",
    `Dieses Paket nennt Dateien, die nur ein Mensch schreiben darf — eine Session darf sie nicht aendern und den Schutz nicht umgehen. Ein Mensch nimmt die Aenderung, die die zitierten Zeilen verlangen, selbst vor und nimmt danach das Label \`${GESCHUETZT_LABEL}\` ab; beim naechsten Anlauf laeuft das Paket dann durch, solange es keine weitere geschuetzte Datei nennt.`,
    "",
    ...liste,
  ].join("\n");
}

/** Die Pfade der Listenzeilen eines Halt-Kommentars, oder null, wenn er nicht freigeben kann. */
function freigegebenePfade(body) {
  const zeilen = String(body ?? "").replaceAll("\r", "").split("\n").map((z) => z.trimEnd());
  if (!zeilen.includes(GESCHUETZT_ANKER) || !zeilen.includes(GESCHUETZT_LABEL_GESETZT)) return null;
  if (zeilen.includes(GESCHUETZT_LABEL_NICHT_GESETZT)) return null;
  return new Set(zeilen.map(listenPfad).filter((p) => p !== null));
}

/**
 * Ist das Paket nach E5 freigegeben? Nur wenn das Label nicht (mehr) haengt und ein Kommentar
 * mit dem Anker die Zeile `Label kit:geschuetzt gesetzt` traegt und jeden aktuellen Treffer
 * in seiner Backtick-Liste nennt. `Label kit:geschuetzt nicht gesetzt` gibt nie frei — dort
 * fehlt das Label, weil das Setzen scheiterte, nicht weil ein Mensch es abnahm. Ohne Treffer
 * gibt es nichts freizugeben: `false`.
 */
export function geschuetztFreigabe(treffer, kommentare, labels) {
  if (treffer.length === 0 || labels.includes(GESCHUETZT_LABEL)) return false;
  return kommentare.some((k) => {
    const pfade = freigegebenePfade(k.body);
    return pfade !== null && treffer.every((t) => pfade.has(t.pfad));
  });
}

/**
 * Die Pfad-Token der Zeilen, die einen Eintrag der Liste treffen, je Pfad und Zeile einmal.
 * Mit `ohneGenannt` zaehlt ein als ` (nur genannt)` gekennzeichnetes Token nicht.
 */
function listenTreffer(zeilen, liste, wurzel, { ohneGenannt = false } = {}) {
  const treffer = [];
  const gesehen = new Set();
  for (const { token, zeile, genannt } of pfadTokens(zeilen)) {
    if (ohneGenannt && genannt) continue;
    const formen = tokenFormen(token, wurzel);
    if (!liste.some((eintrag) => formen.some((f) => trifftGeschuetzt(f, eintrag)))) continue;
    const schluessel = `${token}\n${zeile}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    treffer.push({ pfad: token, zeile });
  }
  return treffer;
}

function ersteNichtLeere(zeilen) {
  return zeilen.map((z) => z.trim()).find((z) => z !== "") ?? null;
}

function istLeer(zeilen) {
  return ersteNichtLeere(zeilen) === null;
}

/** `Autor-Modell: <wert>` (bzw. eine andere Kennzeichnungszeile) mit nicht leerem Wert. */
function hatKennzeichnung(zeilen, name) {
  const muster = new RegExp(String.raw`^${name}:[ \t]*(\S.*)?$`);
  return zeilen.some((z) => {
    const m = muster.exec(z.trim());
    return Boolean(m?.[1] && m[1].trim() !== "");
  });
}

/**
 * Pflichtabschnitte je genau einmal und in dieser Reihenfolge. Liefert die
 * Meldungen; leer heisst erfuellt. Andere Abschnitte werden hier nicht bewertet.
 */
function pruefeReihenfolge(abschnitte, erwartet) {
  const meldungen = [];
  let letzte = -1;
  for (const name of erwartet) {
    const stellen = abschnitte.map((a, i) => (a.titel === name ? i : -1)).filter((i) => i >= 0);
    if (stellen.length === 0) { meldungen.push(`Abschnitt '## ${name}' fehlt`); continue; }
    if (stellen.length > 1) meldungen.push(`Abschnitt '## ${name}' steht ${stellen.length}-mal`);
    if (stellen[0] < letzte) meldungen.push(`Abschnitt '## ${name}' steht nicht in der vorgeschriebenen Reihenfolge`);
    letzte = Math.max(letzte, stellen[0]);
  }
  return meldungen;
}

/** Zeilen ausserhalb von Codebloecken, die mit einem der Praefixe beginnen. */
function zeilenMitPraefix(zeilen, muster) {
  return zeilen.filter((z) => muster.test(z.trim()));
}

/** Meldungen fuer die Marker-Zeile, die auf dieser Stufe nicht stehen darf (F11, P12). */
function markerVerstoesse(zeilen, gate, richtigerMarker) {
  return zeilenMitPraefix(zeilen, /^Issue-Review:/i)
    .map((z) => ({ gate, meldung: `'${z.trim()}' — der Marker dieser Stufe heisst '${richtigerMarker}'` }));
}

function pruefeFachlich(abschnitte, alleZeilen) {
  const erwartet = CHECK_FORM_ABSCHNITTE.fachlich;
  const finde = (name) => abschnitte.find((a) => a.titel === name);
  const verstoesse = pruefeReihenfolge(abschnitte, erwartet).map((meldung) => ({ gate: "F1", meldung }));
  const ziel = finde("ziel");
  if (!ziel || !hatKennzeichnung(ziel.zeilen, "Autor-Modell")) {
    verstoesse.push({ gate: "F2", meldung: "'Autor-Modell:' steht nicht mit Wert im Abschnitt '## Ziel'" });
  }
  for (const name of ["ziel", "fachliche akzeptanzkriterien", "nicht-ziele"]) {
    const a = finde(name);
    if (a && istLeer(a.zeilen)) verstoesse.push({ gate: "F6", meldung: `Abschnitt '## ${name}' ist leer` });
  }
  if (!finde("offene fragen an den po")) {
    verstoesse.push({ gate: "F7", meldung: "Abschnitt '## Offene Fragen an den PO' fehlt" });
  }
  for (const z of zeilenMitPraefix(alleZeilen, /^(Fachliche Quelle|Plan):/)) {
    verstoesse.push({ gate: "F9", meldung: `Herkunftszeile an der Wurzel: '${z.trim()}'` });
  }
  return [...verstoesse, ...markerVerstoesse(alleZeilen, "F11", "Fachplan-Review:")];
}

/** P6 fuer einen Abschnitt: nicht leer; `- Keine.` nur wo erlaubt und nur als erste Zeile. */
function pruefeP6(name, zeilen) {
  const inhalt = zeilen.map((z) => z.trim()).filter((z) => z !== "");
  if (inhalt.length === 0) return `Abschnitt '## ${name}' ist leer`;
  const keineErlaubt = name === "architektonische entscheidungen" || name === "offene fragen";
  const hatKeine = inhalt.some((z) => z.startsWith("- Keine."));
  if (!hatKeine) return null;
  if (!keineErlaubt) return `'- Keine.' ist in '## ${name}' nicht erlaubt`;
  const nurKeine = inhalt.every((z, i) => (i === 0 ? z.startsWith("- Keine.") : !z.startsWith("- Keine.")));
  return nurKeine ? null : `'- Keine.' in '## ${name}' muss die erste Zeile sein und darf keine weiteren Eintraege haben`;
}

function pruefePlan(kopf, abschnitte, alleZeilen) {
  const erwartet = CHECK_FORM_ABSCHNITTE.plan;
  const verstoesse = pruefeReihenfolge(abschnitte, erwartet).map((meldung) => ({ gate: "P1", meldung }));
  for (const a of abschnitte) {
    if (!erwartet.includes(a.titel)) {
      verstoesse.push({ gate: "P2", meldung: `zusaetzliche Ueberschrift '## ${a.titel}' — nur ### ist zwischen den sechs Abschnitten erlaubt` });
    }
  }
  if (!hatKennzeichnung(kopf, "Plan-Modell")) {
    verstoesse.push({ gate: "P3", meldung: "'Plan-Modell:' steht nicht mit Wert im Kopf vor '## Ziel'" });
  }
  for (const a of abschnitte.filter((x) => erwartet.includes(x.titel))) {
    const meldung = pruefeP6(a.titel, a.zeilen);
    if (meldung) verstoesse.push({ gate: "P6", meldung });
  }
  return [...verstoesse, ...markerVerstoesse(alleZeilen, "P12", "Plan-Review:")];
}

/** I1 ueber die Reihenfolge hinaus: Abhaengigkeiten zuletzt. */
function pruefeI1Lage(abschnitte) {
  const meldungen = [];
  const abh = abschnitte.findIndex((a) => a.titel === "abhaengigkeiten");
  if (abh >= 0 && abh !== abschnitte.length - 1) meldungen.push("'## Abhaengigkeiten' ist nicht der letzte Abschnitt");
  return meldungen;
}

/** I3 und I4 am Abhaengigkeiten-Abschnitt. */
function pruefeAbhaengigkeiten(zeilen) {
  const verstoesse = [];
  const erste = ersteNichtLeere(zeilen);
  if (erste === null) {
    verstoesse.push({ gate: "I3", meldung: "'## Abhaengigkeiten' ist leer — 'Keine.' oder 'Issue #N'" });
  } else if (!erste.startsWith("Keine.") && !zeilen.some((z) => /#\d+/.test(z))) {
    verstoesse.push({ gate: "I3", meldung: "'## Abhaengigkeiten' nennt weder 'Keine.' noch eine #N-Referenz — der Nacht-Runner liest nur #N" });
  }
  for (const z of zeilenMitPraefix(zeilen, /^(Fachliche Quelle|Plan):/)) {
    verstoesse.push({ gate: "I4", meldung: `'${z.trim()}' gehoert in '## Kontext', nicht in die Abhaengigkeiten — der Runner laese sie als Abhaengigkeit` });
  }
  return verstoesse;
}

// Die Vorlage-Zeile im Kontext (Issue #683): `Vorlage: <Pfad> — verbindlich | Anregung`.
const VORLAGE_VERBINDLICH = /^Vorlage:[^\S\n]*\S.*[—–-][^\S\n]*verbindlich[^\S\n]*$/i;

/**
 * I5: Eine verbindliche Vorlage verlangt die Abnahme per Bildschirmfoto im Akzeptanzkriterium
 * (Issue #683). Ohne Pruefung verdunstet die Vorlage zwischen Plan und Paket — alle Checks
 * gruen, und die Ansicht sieht aus wie vorher. Der Block unter dem Kriterium zaehlt mit.
 */
function pruefeVorlage(kontext, akzeptanz) {
  if (!kontext?.zeilen.some((z) => VORLAGE_VERBINDLICH.test(z.trim()))) return [];
  if (akzeptanz?.zeilen.some((z) => /bildschirmfoto/i.test(z))) return [];
  return [{ gate: "I5", meldung: "'Vorlage: … — verbindlich' im Kontext, aber '## Akzeptanzkriterium' nennt keine Abnahme per Bildschirmfoto" }];
}

// Ein Dateipfad unter den Pfad-Token (E7): mit Schraegstrich oder mit Dateiendung. Ein Label
// wie `kit:klaeren` oder eine Konstante wie `KOPIE_PFADE` nennt keine Datei.
const DATEIPFAD = /(?:\/)|(?:\.[a-z0-9]+$)/;

const KOPIE_MELDUNG = "Die installierte Kopie unter `.claude/kit/`/`.claude/skills/` wird nie von Hand geändert; "
  + "im Kit ist die Quelle unter `kit/`/`skills/` gemeint, in einem installierten Projekt ein Kit-Update.";

/**
 * I7 bis I9 (Issue #1044, Plan #987, E7): Ein Paket, das eine geschuetzte Datei aendern muss,
 * faellt beim Schneiden auf, nicht erst nachts an der abgewiesenen Schreibanfrage.
 *
 * I7 — `## Aufgabe` nennt mindestens einen Dateipfad als Backtick-Token; ohne ihn findet die
 * Erkennung nichts. I8 — ein Token aus Aufgabe oder Akzeptanzkriterium ist geschuetzt
 * (`geschuetzteTreffer`); die Aenderung gehoert als `[Mensch]`-Karte heraus. Ein als
 * ` (nur genannt)` gekennzeichnetes Token zaehlt fuer I7 und I8 nicht (Issue #1179). I9 — ein Token
 * nur aus `## Aufgabe` liegt in der installierten Kopie: Das Kriterium darf sie aufrufen
 * (`node .claude/kit/checks.mjs run`), bauen soll das Paket an der Quelle.
 *
 * Ein `[Mensch]`-Paket besteht alle drei (E8): Seine Aufgabe liegt ausserhalb des
 * Repositories, und es ist genau die Karte, die I8 verlangt.
 */
function pruefeGeschuetzt(abschnitte, title, wurzel) {
  if (istMensch(title)) return [];
  const verstoesse = [];
  const aufgabe = abschnitte.find((a) => a.titel === "aufgabe")?.zeilen ?? [];
  if (!pfadTokens(aufgabe).some(({ token, genannt }) => !genannt && DATEIPFAD.test(token))) {
    verstoesse.push({ gate: "I7", meldung: "'## Aufgabe' nennt keine Datei als Backtick-Pfad (z. B. `kit/board.mjs`) — ohne genannte Datei erkennt das Kit keine geschuetzte" });
  }
  const zeilen = abschnitte.filter((a) => GESCHUETZT_ABSCHNITTE.has(a.titel)).flatMap((a) => a.zeilen);
  for (const { pfad, zeile } of listenTreffer(zeilen, geschuetztePfade(wurzel), wurzel, { ohneGenannt: true })) {
    verstoesse.push({
      gate: "I8",
      meldung: `'${pfad}' ist geschuetzt, nur ein Mensch darf die Datei schreiben (Zeile: '${zeile.trim()}') — die Aenderung gehoert als eigene [Mensch]-Karte heraus, dieses Paket nennt die Datei dann nicht mehr`,
    });
  }
  for (const { pfad, zeile } of listenTreffer(aufgabe, KOPIE_PFADE, wurzel)) {
    verstoesse.push({ gate: "I9", meldung: `'${pfad}' in '## Aufgabe' (Zeile: '${zeile.trim()}') — ${KOPIE_MELDUNG}` });
  }
  return verstoesse;
}

/**
 * Die Kommandos, die eine Guetemessung starten: `mutationCommand`, das `cmd` des
 * `buildChecks`-Eintrags mit `guete`-Block und die Liste `guetekommandos`, alle drei
 * aus der Konfiguration des Projekts.
 *
 * Bewusst keine eingebaute Namensliste (`stryker`, `pitest`, …): Die veraltet und trifft
 * fremde Werkzeuge nicht, die Konfiguration weiss es genau. Ein Projekt ohne alle drei
 * Felder liefert eine leere Liste — dort weist I6 nichts ab.
 *
 * `guetekommandos` ist der Weg fuer einen Treiber, den die Config noch nicht als Pruefung
 * fuehren kann, weil ihn erst ein kommendes Paket baut (Issue #942): Das Projekt nennt sein
 * Kommando-Praefix, und I6 greift schon, bevor der Treiber existiert.
 */
function guetekommandos(config) {
  const checks = Array.isArray(config?.buildChecks) ? config.buildChecks : [];
  const ausChecks = checks.filter((c) => c && typeof c === "object" && c.guete).map((c) => c.cmd);
  const benannt = Array.isArray(config?.guetekommandos) ? config.guetekommandos : [];
  return [config?.mutationCommand, ...ausChecks, ...benannt]
    .map((cmd) => (typeof cmd === "string" ? cmd.trim().replaceAll(/\s+/g, " ") : ""))
    .filter((cmd) => cmd !== "");
}

// Der Anker des Blocks, der den Session-Abschluss nicht blockiert (Issue #215).
// `###` ist keine Abschnittsgrenze, der Block steht also in den Zeilen des
// Akzeptanzkriteriums — I6 liest nur, was davor steht.
const MANUELLE_PRUEFUNG_ZEILE = /^###[ \t]+manuelle[ \t]+pr(ü|ue)fung/i;

// Eine Entscheidungszeile im Kontext, die die Guetemess-Konvention aufhebt: Sie handelt
// von einem Vollauf oder einer Guetemessung und beantwortet das mit `Gewaehlt: ja`.
const ENTSCHEIDUNG_ZEILE = /^Entscheidung:/;
const GUETE_BEZUG = /vollauf|g(ü|ue)temessung|mutationspruefung|mutationspr(ü|ue)fung/i;

// Die Antwort ist das erste Wort nach dem **ersten** `Gewaehlt:` der Zeile — nicht irgendein
// `Gewaehlt: ja` im Text. Ein Paket, das diese Regel selbst baut, zitiert den Wortlaut naemlich
// in seinem eigenen Kontext, und die Regel wies sich prompt selbst ab.
const GEWAEHLT_ANTWORT = /gew(ä|ae)hlt:[ \t]*(\S+)/i;

/** Beantwortet die Entscheidungszeile ihre Frage mit `ja`? */
function mitJaEntschieden(zeile) {
  const treffer = GEWAEHLT_ANTWORT.exec(zeile);
  return treffer !== null && /^ja\b/i.test(treffer[2]);
}

/** Die Zeilen des Akzeptanzkriteriums bis zum Block `### Manuelle Pruefung`. */
function maschinelleKriterien(zeilen) {
  const ab = zeilen.findIndex((z) => MANUELLE_PRUEFUNG_ZEILE.test(z.trim()));
  return ab === -1 ? zeilen : zeilen.slice(0, ab);
}

/**
 * I6: Das Akzeptanzkriterium ruft keine Guetemessung auf (Issue #901), und keine
 * Entscheidung im Kontext hebt diese Konvention auf (Issue #942).
 *
 * Eine Mutationspruefung laeuft einmal je Veroeffentlichung an ihrer Stufe, nicht einmal
 * je Paket. Als Zeile in der Karte kostet sie die Zeit, die dem Paket fehlt: Ein Vollauf
 * hat eine Nacht-Runde exakt ins Rundenzeitlimit gefahren, samt verlorener Schlussmeldung.
 *
 * Die zweite Haelfte faengt den Fall, in dem der Planer die Regel selbst aushebelt — in
 * kanban-kit #1215 stand die Ausnahme als `Entscheidung:`-Zeile im Kontext, und der Code
 * des Pakets war fertig, als die Runde an den drei Vollaeufen starb.
 *
 * Der Block `### Manuelle Pruefung` zaehlt nicht mit: Dort gehoert der Nachweis hin, dass
 * ein neuer Treiber wirklich durchlaeuft, denn er blockiert den Abschluss nicht.
 */
function pruefeGuetemessung(akzeptanz, kontext, config) {
  const verstoesse = [];
  if (akzeptanz) {
    const text = maschinelleKriterien(akzeptanz.zeilen).join(" ").replaceAll(/\s+/g, " ");
    for (const cmd of guetekommandos(config).filter((c) => text.includes(c))) {
      verstoesse.push({
        gate: "I6",
        meldung: `'## Akzeptanzkriterium' ruft die Guetemessung '${cmd}' auf — sie gehoert als buildChecks-Eintrag mit 'stufe: push' einmal an die Veroeffentlichung, nicht einmal in jedes Paket`,
      });
    }
  }
  for (const zeile of zeilenMitPraefix(kontext?.zeilen ?? [], ENTSCHEIDUNG_ZEILE)) {
    const z = zeile.trim();
    if (!GUETE_BEZUG.test(z) || !mitJaEntschieden(z)) continue;
    verstoesse.push({
      gate: "I6",
      meldung: `'${z}' hebt die Guetemess-Konvention auf — sie gilt ohne Ausnahme, auch fuer ein Paket, das den Mess-Treiber selbst baut. Dass ein Vollauf durchlaeuft, steht unter '### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)'`,
    });
  }
  return verstoesse;
}

function pruefeIssue(abschnitte, config, title, wurzel) {
  const finde = (name) => abschnitte.find((a) => a.titel === name);
  const verstoesse = [...pruefeReihenfolge(abschnitte, CHECK_FORM_ABSCHNITTE.issue), ...pruefeI1Lage(abschnitte)]
    .map((meldung) => ({ gate: "I1", meldung }));
  const kontext = finde("kontext");
  if (!kontext || !hatKennzeichnung(kontext.zeilen, "Autor-Modell")) {
    verstoesse.push({ gate: "I2", meldung: "'Autor-Modell:' steht nicht mit Wert im Abschnitt '## Kontext'" });
  }
  verstoesse.push(
    ...pruefeVorlage(kontext, finde("akzeptanzkriterium")),
    ...pruefeGuetemessung(finde("akzeptanzkriterium"), kontext, config),
    ...pruefeGeschuetzt(abschnitte, title, wurzel),
  );
  const abh = finde("abhaengigkeiten");
  return abh ? [...verstoesse, ...pruefeAbhaengigkeiten(abh.zeilen)] : verstoesse;
}

// ------------------------------------------------------------
// Testhinweise fuer Plaene (Issue #1031, Plan #1029)
// ------------------------------------------------------------

/**
 * Die Test-Ablagen, die ohne Einstellung gelten (A5): TypeScript mit `.test`/`.spec`
 * neben der Quelle, Java nach Maven-Gliederung. `{pfad}` steht fuer null oder mehr
 * Verzeichnisse, `{name}` fuer den Dateinamen ohne Endung, `*` im Test-Muster fuer
 * beliebige Zeichen innerhalb eines Segments.
 */
export const TEST_ABLAGEN_VORGABE = Object.freeze([
  { quelle: "{pfad}/{name}.ts", test: "{pfad}/{name}.test.ts" },
  { quelle: "{pfad}/{name}.ts", test: "{pfad}/{name}.spec.ts" },
  { quelle: "{pfad}/{name}.tsx", test: "{pfad}/{name}.test.tsx" },
  { quelle: "{pfad}/{name}.tsx", test: "{pfad}/{name}.spec.tsx" },
  { quelle: "src/main/java/{pfad}/{name}.java", test: "src/test/java/{pfad}/{name}Test.java" },
]);

/**
 * Die Ablagen eines Projekts aus `config.testAblagen`: fehlt das Feld, gelten die
 * Vorgaben; ein Array ersetzt sie; ein Eintrag `{ "vorgaben": true }` fuegt die
 * Vorgaben an dieser Stelle ein; `[]` schaltet die Pruefung ab. Die Form des Feldes
 * prueft das Schema — hier zaehlt nur, was als Paar lesbar ist.
 */
export function testAblagen(config) {
  const feld = config?.testAblagen;
  if (!Array.isArray(feld)) return [...TEST_ABLAGEN_VORGABE];
  return feld.flatMap((eintrag) => {
    if (eintrag?.vorgaben === true) return TEST_ABLAGEN_VORGABE;
    const gueltig = typeof eintrag?.quelle === "string" && eintrag.quelle !== ""
      && typeof eintrag?.test === "string" && eintrag.test !== "";
    return gueltig ? [{ quelle: eintrag.quelle, test: eintrag.test }] : [];
  });
}

const ABLAGE_TEIL = /\{pfad\}\/|\{pfad\}|\{name\}|\*/g;

/**
 * Ein Ablage-Muster als verankerter Ausdruck (A4). Ohne `feste` fangen die benannten
 * Gruppen `pfad` und `name` die Werte ein — `{pfad}/` darf dabei leer sein, die Gruppe
 * fehlt dann. Mit `feste` stehen dieselben Werte woertlich im Ausdruck: So findet das
 * Test-Muster genau die Tests, die zu der gefangenen Quelle gehoeren, ohne dass ein `*`
 * neben `{name}` die Grenze verschieben koennte.
 */
export function ablageAlsAusdruck(muster, feste = null) {
  const gesehen = new Set();
  const gruppe = (name, ausdruck) => {
    if (gesehen.has(name)) return String.raw`\k<${name}>`;
    gesehen.add(name);
    return `(?<${name}>${ausdruck})`;
  };
  const text = String(muster);
  let quelle = "";
  let letzte = 0;
  for (const m of text.matchAll(ABLAGE_TEIL)) {
    quelle += escapeRegex(text.slice(letzte, m.index)) + ablageTeilAlsAusdruck(m[0], feste, gruppe);
    letzte = m.index + m[0].length;
  }
  return new RegExp(`^${quelle}${escapeRegex(text.slice(letzte))}$`);
}

const ABLAGE_PFAD = "[^/]+(?:/[^/]+)*";

/** Ein Platzhalter der Ablage: gefangen (`gruppe`) oder mit dem festen Wert woertlich. */
function ablageTeilAlsAusdruck(teil, feste, gruppe) {
  if (teil === "*") return "[^/]*";
  if (teil === "{name}") return feste ? escapeRegex(feste.name) : gruppe("name", "[^/]+");
  if (teil === "{pfad}") return feste ? escapeRegex(feste.pfad) : gruppe("pfad", ABLAGE_PFAD);
  if (!feste) return `(?:${gruppe("pfad", ABLAGE_PFAD)}/)?`;
  return feste.pfad === "" ? "" : escapeRegex(`${feste.pfad}/`);
}

function escapeRegex(text) {
  return String(text).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Der Dateiname ohne seine letzte Endung. */
function dateiStamm(datei) {
  const name = basename(datei);
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/**
 * Das Verzeichnis, gegen das Nennungen aufgeloest werden (A8): jedes Pfad-Endstueck ab
 * einer Segmentgrenze und jeder Dateiname ohne Endung, beide auf die Dateien, die sie
 * bezeichnen. Eindeutig ist eine Nennung, wenn ihr Eintrag genau eine Datei traegt.
 */
export function nennungsVerzeichnis(dateien) {
  const endstuecke = new Map();
  const staemme = new Map();
  const eintragen = (karte, schluessel, datei) => {
    const liste = karte.get(schluessel);
    if (liste) liste.push(datei);
    else karte.set(schluessel, [datei]);
  };
  for (const datei of dateien) {
    const segmente = datei.split("/");
    for (let i = 0; i < segmente.length; i += 1) eintragen(endstuecke, segmente.slice(i).join("/"), datei);
    eintragen(staemme, dateiStamm(datei), datei);
  }
  return { endstuecke, staemme };
}

const NENNUNG_TOKEN = /[A-Za-z0-9_./-]+/g;

/** Punkt, Bindestrich und Schraegstrich am Tokenende gehoeren zum Satz, nicht zur Datei. */
function ohneSatzzeichenAmEnde(token) {
  let ende = token.length;
  while (ende > 0 && "./-".includes(token[ende - 1])) ende -= 1;
  return token.slice(0, ende);
}

/**
 * Die Dateien, die ein Text eindeutig nennt: Tokens aus Pfadzeichen, Satzzeichen am Ende
 * abgeschnitten, aufgeloest ueber das Endstueck und mit `stamm` auch ueber den Dateinamen
 * ohne Endung. Eine mehrdeutige Nennung zaehlt fuer keine der Dateien.
 */
export function genannteDateien(text, verzeichnis, { stamm = false } = {}) {
  const genannt = new Set();
  for (const [roh] of String(text).matchAll(NENNUNG_TOKEN)) {
    const token = ohneSatzzeichenAmEnde(roh.startsWith("./") ? roh.slice(2) : roh);
    if (token === "") continue;
    const treffer = verzeichnis.endstuecke.get(token) ?? (stamm ? verzeichnis.staemme.get(token) : undefined);
    if (treffer?.length === 1) genannt.add(treffer[0]);
  }
  return genannt;
}

// Nur hier fuehrt ein Plan seine Bausteine (A6); Ziel und Verifizierung erwaehnen nur.
const BAUSTEIN_ABSCHNITTE = new Set(["betroffene bereiche", "geplante aenderungen"]);

/**
 * Die Testhinweise eines Plans (A6 bis A9). Bausteine sind die Dateien, die
 * `## Betroffene Bereiche` und `## Geplante Aenderungen` ausserhalb von Codebloecken
 * mindestens mit Dateiname und Endung nennen. Je Baustein ergeben die Ablagen seine
 * eigenen Tests — nur existierende Dateien, die Quelle selbst nicht, keine Import-Analyse.
 * Ein Test gilt als genannt, wenn der ganze Body ihn eindeutig nennt, auch im Kopf und in
 * Codebloecken, auch nur mit seinem Stamm.
 */
export function pruefeTestNennung(abschnitte, body, dateien, config) {
  const ablagen = testAblagen(config);
  if (ablagen.length === 0 || dateien.length === 0) return [];
  const verzeichnis = nennungsVerzeichnis(dateien);
  const bausteinText = abschnitte.filter((a) => BAUSTEIN_ABSCHNITTE.has(a.titel)).flatMap((a) => a.zeilen).join("\n");
  const bausteine = genannteDateien(bausteinText, verzeichnis);
  if (bausteine.size === 0) return [];
  const genannt = genannteDateien(body, verzeichnis, { stamm: true });
  const hinweise = [];
  const gemeldet = new Set();
  for (const baustein of bausteine) {
    for (const ablage of ablagen) {
      const m = ablageAlsAusdruck(ablage.quelle).exec(baustein);
      if (!m) continue;
      const feste = { pfad: m.groups?.pfad ?? "", name: m.groups?.name ?? "" };
      const testAusdruck = ablageAlsAusdruck(ablage.test, feste);
      for (const test of dateien.filter((d) => testAusdruck.test(d))) {
        const schluessel = `${baustein}\n${test}`;
        if (test === baustein || genannt.has(test) || gemeldet.has(schluessel)) continue;
        gemeldet.add(schluessel);
        hinweise.push({
          baustein,
          test,
          meldung: `Zu ${baustein} gehört ${test}, der Plan nennt ihn nicht. Bleibt er grün, oder fehlt er in der Liste der Änderungen?`,
        });
      }
    }
  }
  return hinweise;
}

/**
 * Die versionierten Dateien des Projekts als Bestand der Testhinweise (A3, E5):
 * `git ls-files --full-name` liefert Pfade ab der Repo-Wurzel, auch aus einem
 * Unterverzeichnis. Ohne Repo gibt es keinen Bestand und damit keine Hinweise.
 */
function versionierteDateien() {
  const res = spawnSync("git", ["ls-files", "--full-name", "-z"], {
    cwd: process.cwd(), encoding: "utf-8", maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return [];
  return res.stdout.split("\0").filter((d) => d !== "");
}

/**
 * Prueft ein Dokument gegen die maschinellen Formgates seiner Stufe (Issue #628).
 *
 * fachlich: F1 F2 F6 F7 F9 F11 aus CLAUDE-Fachplan.md. plan: P1 P2 P3 P6 P12 aus
 * CLAUDE-Plan.md (P4 braucht eine zweite Karte und bleibt Sache des Reviewers).
 * Arbeitspaket: I1 bis I9 — Abschnitte, Autor-Modell, Abhaengigkeiten als `#N`
 * oder `Keine.`, keine Herkunftszeile im Abhaengigkeiten-Abschnitt, bei verbindlicher
 * Vorlage ein Bildschirmfoto im Akzeptanzkriterium, keine Guetemessung im
 * Akzeptanzkriterium und keine Entscheidung im Kontext, die diese Konvention aufhebt;
 * dazu eine Datei als Backtick-Pfad in der Aufgabe (I7), keine geschuetzte Datei in
 * Aufgabe oder Kriterium (I8) und nicht die installierte Kopie in der Aufgabe (I9) —
 * ein `[Mensch]`-Paket besteht I7 bis I9. Die `[Urteil]`-Gates bleiben beim Reviewer.
 *
 * `config` braucht I6 — fuer die Guetekommandos des Projekts — und beim Plan die
 * Test-Ablagen (`testAblagen`). `wurzel` ist die Projektwurzel, deren Einstellungen I8
 * nach Schreibsperren liest; die Kommandozeile reicht die Wurzel der Config.
 *
 * Beim Plan kommen die Testhinweise dazu (Issue #1031): je eigener Test eines
 * gefuehrten Bausteins, den der Plan nicht nennt, ein Eintrag in `hinweise`, gegen den
 * Bestand `dateien`. Sie sind **kein Gate** — `ok` haengt allein an `verstoesse`, und
 * der Schluessel `hinweise` steht nur bei mindestens einem Treffer im Ergebnis.
 *
 * Beim Arbeitspaket haengt `issue check-form` die Hinweise zum Abschnitt
 * `## Abhaengigkeiten` an (`abhaengigkeitsHinweise`, Issue #1060) — nicht hier, weil sie
 * das Board nachschlagen und `pruefeForm` rein bleibt. Auch sie sind kein Gate.
 */
export function pruefeForm(body, title, config = {}, dateien = [], wurzel = ".") {
  const stufe = stufeAusTitel(title);
  const { kopf, abschnitte } = zerlegeAbschnitte(body);
  const alleZeilen = [...kopf, ...abschnitte.flatMap((a) => a.zeilen)];
  let verstoesse;
  if (stufe === "fachlich") verstoesse = pruefeFachlich(abschnitte, alleZeilen);
  else if (stufe === "plan") verstoesse = pruefePlan(kopf, abschnitte, alleZeilen);
  else verstoesse = pruefeIssue(abschnitte, config, title, wurzel);
  const ergebnis = { ok: verstoesse.length === 0, stufe, verstoesse };
  if (stufe === "plan") {
    const hinweise = pruefeTestNennung(abschnitte, normalisiereZeilenenden(body), dateien, config);
    if (hinweise.length > 0) ergebnis.hinweise = hinweise;
  }
  return ergebnis;
}

/** Weist einen Aufruf ab — mit JSON auf stdout, damit ein Aufrufer die Abweisung lesen kann. */
function checkFormAbweisen(meldung) {
  out({ ok: false, stufe: null, verstoesse: [], fehler: meldung });
  process.stderr.write(`Fehler: ${meldung}\n`);
  process.exit(1);
}

/** Der Datei-Weg: Body aus --body-file, Titel aus --title. */
function checkFormAusDatei(datei, titel) {
  if (datei === true || datei === "") checkFormAbweisen(`--body-file braucht einen Pfad. ${CHECK_FORM_WEGE}.`);
  if (typeof titel !== "string" || titel.trim() === "") {
    checkFormAbweisen(`--body-file braucht --title, damit die Stufe feststeht. ${CHECK_FORM_WEGE}.`);
  }
  try {
    return { body: readFileSync(datei, "utf-8"), title: titel };
  } catch (e) {
    return checkFormAbweisen(`--body-file: ${datei} ist nicht lesbar (${e.code || e.message}). ${CHECK_FORM_WEGE}.`);
  }
}

/** Der Board-Weg: Body und Titel der Karte; eine unbekannte Nummer weist den Aufruf ab. */
async function checkFormVomBoard(tracker, id) {
  try {
    const issue = await tracker.getIssue(String(id));
    return { body: issue.body || "", title: issue.title || "" };
  } catch (e) {
    if (e instanceof BoardError && /HTTP 404|nicht gefunden/i.test(e.message)) return checkFormAbweisen(e.message);
    throw e;
  }
}

async function issueCheckForm(tracker, config, args) {
  const id = args._[0];
  const hatDatei = args["body-file"] !== undefined;
  if (id !== undefined && hatDatei) checkFormAbweisen(`Kartennummer und --body-file zugleich uebergeben. ${CHECK_FORM_WEGE}.`);
  if (id === undefined && !hatDatei) checkFormAbweisen(`Keine Eingabe uebergeben. ${CHECK_FORM_WEGE}.`);

  const { body, title } = hatDatei ? checkFormAusDatei(args["body-file"], args.title) : await checkFormVomBoard(tracker, id);
  const dateien = stufeAusTitel(title) === "plan" ? versionierteDateien() : [];
  const ergebnis = pruefeForm(body, title, config, dateien, configWurzel());
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
  if (id === undefined) fail("issue check-geschuetzt braucht eine Kartennummer: node board.mjs issue check-geschuetzt <id>");
  const issue = await tracker.getIssue(String(id));
  const kommentare = await tracker.kommentareStreng(String(id));
  const labels = issue.labels || [];
  const treffer = [
    ...geschuetzteTreffer(issue.body || "", issue.title || "", configWurzel()),
    ...abgewieseneTreffer(args.werte?.pfad ?? [], configWurzel()),
  ];
  const label = labels.includes(GESCHUETZT_LABEL);
  const freigegeben = geschuetztFreigabe(treffer, kommentare, labels);
  const ok = freigegeben || (treffer.length === 0 && !label);
  out({ ok, treffer, label, freigegeben, handlung: geschuetztHandlung(treffer, label, freigegeben), kommentar: treffer.length > 0 ? geschuetztKommentar(treffer) : null });
  if (!ok) process.exit(1);
}

/** Der Satz fuer den Menschen zum Ergebnis von `issue check-geschuetzt`. */
function geschuetztHandlung(treffer, label, freigegeben) {
  if (freigegeben) return "Freigegeben: Der Halt-Kommentar nennt jede geschuetzte Datei und das Label ist abgenommen — das Paket darf beginnen.";
  if (treffer.length === 0 && !label) return "Keine geschuetzte Datei genannt — das Paket darf beginnen.";
  if (treffer.length === 0) return `menschliche Handlung wartet: Die Karte traegt das Label ${GESCHUETZT_LABEL}. Ist die geschuetzte Aenderung erledigt, nimmt ein Mensch das Label ab.`;
  const pfade = [...new Set(treffer.map((t) => t.pfad))].join(", ");
  if (label) return `menschliche Handlung wartet: Ein Mensch nimmt die Aenderung an ${pfade} selbst vor und nimmt danach das Label ${GESCHUETZT_LABEL} ab.`;
  return `menschliche Handlung wartet: Das Paket nennt ${pfade}, die nur ein Mensch schreiben darf. Es wird angehalten; der Halt-Kommentar sagt, was zu aendern ist.`;
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
    case "melden":  return issueMelden(tracker, args);
    case "stand":   return issueStand(tracker, config, args);
    case "auftrag": return issueAuftrag(tracker, args, AUFTRAG_GESCHUETZT);
    case "label":   return issueLabel(tracker, config, args, HELP);
    case "check-form": return issueCheckForm(tracker, config, args);
    case "check-geschuetzt": return issueCheckGeschuetzt(tracker, args);
    default:
      process.stdout.write(HELP);
      fail(`Unbekannter issue-Befehl: '${command}'`);
  }
}

async function codeRepoName(host) {
  out({ repoName: await host.getRepoName() });
}

async function codePr(host, args) {
  if (!args.from) fail("--from ist erforderlich");
  if (!args.to) fail("--to ist erforderlich");
  if (!host.supportsPullRequests()) {
    fail("Dieser codeHost unterstuetzt keine Pull Requests. Nutze einen lokalen git-Merge.");
  }
  out(await host.createPullRequest({ from: args.from, to: args.to, title: args.title }));
}

async function codeCiStatus(host, args) {
  if (args.commit === undefined) fail("--commit ist erforderlich");
  if (args.commit === true) fail("--commit braucht einen Wert");
  out(await host.getCiStatus(String(args.commit)));
}

async function dispatchCode(command, args) {
  const host = resolveCodeHost(loadConfig());
  switch (command) {
    case "repo-name": return codeRepoName(host);
    case "pr":        return codePr(host, args);
    case "ci-status": return codeCiStatus(host, args);
    default:
      process.stdout.write(HELP);
      fail(`Unbekannter code-Befehl: '${command}'`);
  }
}

// Ein Flag ohne Wert wird von parseArgs zu true. Fuer --project/--date waere das ein
// stiller Fehlgriff (falscher Projektname, heutiges statt gemeintem Datum) — deshalb
// Abbruch mit Meldung statt Rueckfall auf den Default.
function kontextOption(args, name) {
  if (args[name] === true) fail(`--${name} braucht einen Wert`);
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
    fail(`Notizordner nicht lesbar: ${ordner} (${e.code || e.message})`);
  }
}

// Macht aus einer Mehrdeutigkeit einen Abbruch. Ein stiller Griff ins Ungewisse
// waere genau der Fehler, den Issue #286 behebt — deshalb Exit 1 mit beiden Namen,
// statt eine der beiden Dateien zu raten.
export function waehleNotiz(dateien, notizName, ordner, alleinstehend) {
  const { name, kollision } = pickNoteFile(dateien, notizName, { alleinstehend });
  if (kollision) {
    fail(
      `Mehrdeutige Notiz in ${ordner}: ${kollision.join(", ")}. ` +
      "Die Dateinamen unterscheiden sich nur in der Gross-/Kleinschreibung — " +
      "im Vault auf einen Namen zusammenfuehren."
    );
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

// ============================================================
// Issue-Review-Achse (Issue #220)
// ============================================================
//
// Ein Issue ist die Quelle der Wahrheit fuer die Implementierung — ein Fehler darin
// pflanzt sich in die ganze Umsetzung fort. Der Autor sieht ihn nicht, weil er den
// Kontext im Kopf hat, aus dem das Issue entstanden ist. Deshalb pruefen zwei andere
// Modelle, und deshalb ist der Autor hier nie sein eigener Reviewer.
//
// Reviewer sind ein Adapter, keine Modell-Liste: `kind: "claude"` laeuft ueber das
// Agent-Tool, `kind: "command"` ueber ein beliebiges fremdes CLI. Damit nehmen auch
// Modelle aus anderen Haeusern teil — die teilen die blinden Flecken einer Familie
// nicht. Das Kit kennt das fremde Werkzeug nicht und muss es nicht kennen.

const REVIEWER_KINDS = ["claude", "command"];

// Die drei Stufen der Pruefung (Issue #278): das fachliche Anliegen, der Plan dorthin,
// das einzelne Arbeitspaket. Jede schaut anders hin und ist anders besetzt — fachlich
// und Plan mit je zwei Reviewern, das Arbeitspaket mit einem.
const REVIEW_STUFEN = ["fachlich", "plan", "issue"];

// Rueckfallebene, wenn `reviewStufen` ganz fehlt: das Verhalten vor dieser Aenderung —
// zwei Reviewer mit den beiden Rollen, die /issue-review schon kennt. Ein Kit-Update
// darf keinem Bestandsprojekt den Review umbauen, dieselbe Vorsicht wie bei
// `requiredBeforeReady`, das per Default aus ist.
const REVIEW_STUFEN_DEFAULT = { reviewer: 2, rollen: ["vollstaendigkeit-pruefbarkeit", "scope-risiko-bestand"] };

/**
 * Uebersetzt einen Autor-Wert auf einen Reviewer-Kurznamen (Issue #241).
 *
 * `/issues` schreibt die volle Modell-ID in den Kontext-Abschnitt
 * (`Autor-Modell: claude-opus-5`), `pairs` und `reviewers[].name` benutzen Kurznamen
 * (`opus`). Ohne Uebersetzung greift `pairs` nicht — und der Regel-Zweig filtert ueber
 * `r.name !== autor`, wo `"opus" !== "claude-opus-5"` wahr ist: Der Autor bleibt im
 * Kandidatenfeld und prueft sein eigenes Issue. Genau das, was `pairs` aus Issue #225
 * verhindern sollte, nur eine Ebene tiefer.
 *
 * Die Zuordnung steht schon in der Config — `reviewers[].model`. Es braucht deshalb
 * weder eine zweite Tabelle noch eine Heuristik auf Namensbestandteilen.
 *
 * Rueckgabe `null`, wenn nichts trifft: Das ist der erlaubte Fall (aelteres Issue ohne
 * Autor-Zeile, ein Mensch als Autor) — er soll nur nicht mehr stumm bleiben.
 */
function aufloesenAutor(alle, autor) {
  if (!autor) return null;
  const liste = alle || [];
  if (liste.some((r) => r.name === autor)) return autor;
  // `model` ist bei kind:"command" nicht gesetzt; der Vergleich gegen undefined
  // duerfte niemals treffen, deshalb die Existenzpruefung.
  const perModell = liste.find((r) => r.model && r.model === autor);
  return perModell ? perModell.name : null;
}

/**
 * Waehlt die Reviewer fuer ein Issue: die ersten `anzahl` Eintraege, deren Name nicht
 * der Autor ist. Reine Funktion — die Reihenfolge der Config ist die Steuerung, wer
 * eine feste Paarung will, sortiert entsprechend.
 *
 * `unterbesetzt` statt eines Fehlers, wenn zu wenige uebrig bleiben: Der Skill
 * entscheidet, ob er mit einem Reviewer faehrt — er muss es nur sichtbar machen.
 *
 * `autorAufgeloest` sagt, ob der uebergebene Autor einem Reviewer zugeordnet werden
 * konnte. Bei `false` ist die Auswahl unveraendert gueltig, beruht aber nicht auf einem
 * erkannten Autor — ein Aufrufer ohne Menschen davor soll das sehen koennen.

 */
// SYNC: dieselbe Wahl bildet kit/einstellungen.mjs (waehleReviewer) fuer die Oberflaeche nach.
export function pickReviewers(alle, autor, anzahl = 2, pairs = {}) {
  const aufgeloest = aufloesenAutor(alle, autor);
  const schluessel = aufgeloest ?? autor;
  const gesperrt = new Set([schluessel]);

  // Explizite Zuordnung schlaegt die Regel (Issue #225). Ohne sie waehlt die Regel
  // immer die vordersten Eintraege — bei vier Reviewern kam der vierte nie zum Zug,
  // ausgerechnet das Modell aus dem fremden Haus. Und wer wissen will, wer sein Issue
  // prueft, soll es ablesen koennen statt es auszurechnen.
  const eintrag = pairs?.[schluessel];
  const genannt = Array.isArray(eintrag) ? eintrag.filter((n) => !gesperrt.has(n)) : [];
  if (genannt.length > 0) {
    // Auch hier auf `anzahl` kuerzen, nicht nur im Regel-Zweig unten (Issue #278):
    // Sonst liefert eine Stufe mit einem Reviewer trotzdem beide Namen aus der
    // Paar-Tabelle — der eine Reviewer waere stillschweigend zwei geblieben.
    // Gekuerzt wird in konfigurierter Reihenfolge, sie ist die Steuerung.
    const gewaehlt = genannt.map((n) => (alle || []).find((r) => r.name === n)).filter(Boolean).slice(0, anzahl);
    return { gewaehlt, unterbesetzt: gewaehlt.length < anzahl, quelle: "pairs", autorAufgeloest: aufgeloest !== null };
  }
  const passend = (alle || []).filter((r) => !gesperrt.has(r.name));
  const gewaehlt = passend.slice(0, anzahl);
  return { gewaehlt, unterbesetzt: gewaehlt.length < anzahl, quelle: "regel", autorAufgeloest: aufgeloest !== null };
}

// Beide Faelle sind harte Fehler, aus derselben Begruendung wie validateReviewers:
// Ein stiller Skip verwandelt einen Tippfehler in einen unsichtbaren Ein-Reviewer-Lauf.
// Und ein Autor, der sich selbst nennt, hebelt den Zweck des Verfahrens aus — das
// gehoert beim Schreiben der Config bemerkt, nicht beim Lesen des Review-Berichts.
// SYNC: dieselbe Regel prueft kit/einstellungen.mjs (regelPaare) vor dem Speichern.
function validatePairs(pairs, reviewers) {
  const bekannt = new Set(reviewers.map((r) => r.name));
  for (const [autor, genannt] of Object.entries(pairs || {})) {
    const wo = `issueReview.pairs['${autor}']`;
    if (!Array.isArray(genannt)) fail(`${wo}: muss eine Liste von Reviewer-Namen sein.`);
    for (const name of genannt) {
      if (name === autor) fail(`${wo}: nennt '${autor}' sich selbst — der Autor darf nicht sein eigener Reviewer sein.`);
      if (!bekannt.has(name)) fail(`${wo}: '${name}' steht nicht in issueReview.reviewers.`);
    }
  }
  return pairs || {};
}

// Eine halb ausgefuellte Reviewer-Definition still zu ueberspringen wuerde einen
// Tippfehler in einen unsichtbaren Ein-Reviewer-Lauf verwandeln — und der sieht am
// Board aus wie ein vollstaendiger. Deshalb harter Fehler mit sprechender Meldung.
function validateReviewers(reviewers) {
  reviewers.forEach((r, i) => {
    const wo = `issueReview.reviewers[${i}]`;
    if (!r || typeof r.name !== "string" || !r.name) fail(`${wo}: 'name' fehlt oder ist leer.`);
    if (!REVIEWER_KINDS.includes(r.kind)) {
      fail(`${wo} ('${r.name}'): 'kind' muss ${REVIEWER_KINDS.join(" oder ")} sein, ist '${r.kind}'.`);
    }
    if (r.kind === "claude" && !r.model) fail(`${wo} ('${r.name}'): 'model' fehlt.`);
    if (r.kind === "command" && !r.command) fail(`${wo} ('${r.name}'): 'command' fehlt.`);
  });
  return reviewers;
}

/**
 * Liest den `reviewStufen`-Block und prueft ihn (Issue #278).
 *
 * Hart wie im uebrigen Config-Bereich, aus derselben Begruendung wie validateReviewers
 * und validatePairs: Ein stiller Skip verwandelt einen Tippfehler in einen unsichtbaren
 * unterbesetzten Lauf — und der sieht am Board aus wie ein vollstaendiger.
 *
 * Defaults greifen ausschliesslich, wenn der GESAMTE Block fehlt. Waere eine einzelne
 * vergessene Stufe auch still ergaenzt, liesse sie sich von einer bewussten
 * Rueckfallebene nicht unterscheiden.
 */
// SYNC: die Regel rollen.length === reviewer prueft kit/einstellungen.mjs (regelRollenzahl) vor dem Speichern.
function validateReviewStufen(block) {
  if (block === undefined || block === null) {
    return { stufen: Object.fromEntries(REVIEW_STUFEN.map((s) => [s, REVIEW_STUFEN_DEFAULT])), stufenQuelle: "default" };
  }
  if (typeof block !== "object" || Array.isArray(block)) {
    fail(`reviewStufen: muss ein Objekt mit den Stufen ${REVIEW_STUFEN.join(", ")} sein.`);
  }
  const stufen = {};
  for (const stufe of REVIEW_STUFEN) {
    const wo = `reviewStufen.${stufe}`;
    const eintrag = block[stufe];
    if (!eintrag || typeof eintrag !== "object" || Array.isArray(eintrag)) {
      fail(`${wo}: fehlt oder ist kein Objekt mit 'reviewer' und 'rollen'.`);
    }
    const { reviewer, rollen } = eintrag;
    if (!Number.isInteger(reviewer) || reviewer < 1) {
      fail(`${wo}.reviewer: muss eine positive Ganzzahl sein, ist '${reviewer}'.`);
    }
    if (!Array.isArray(rollen)) fail(`${wo}.rollen: muss eine Liste von Rollennamen sein.`);
    rollen.forEach((name, i) => {
      if (typeof name !== "string" || !name) fail(`${wo}.rollen[${i}]: muss ein nicht leerer Rollenname sein.`);
    });
    if (new Set(rollen).size !== rollen.length) fail(`${wo}.rollen: nennt einen Rollennamen doppelt.`);
    if (rollen.length !== reviewer) {
      fail(`${wo}: rollen.length (${rollen.length}) stimmt nicht mit reviewer (${reviewer}) ueberein.`);
    }
    stufen[stufe] = { reviewer, rollen };
  }
  return { stufen, stufenQuelle: "stufen" };
}

function issueReviewConfig() {
  const config = loadConfig();
  const block = config.issueReview || {};
  const reviewers = validateReviewers(Array.isArray(block.reviewers) ? block.reviewers : []);
  return {
    reviewers,
    pairs: validatePairs(block.pairs, reviewers),
    // `reviewStufen` steht auf oberster Ebene, nicht in `issueReview`: Die Besetzung
    // gilt fuer die drei Stufen der Pruefung, waehrend `issueReview` beschreibt, WER
    // ueberhaupt prueft. Geprueft wird trotzdem hier, damit ein kaputter Block bei
    // jedem issue-review-Befehl auffaellt und nicht erst beim ersten `roles`.
    reviewStufen: validateReviewStufen(config.reviewStufen),
  };
}


// Verfuegbarkeit eines Kommandos: Das erste Wort muss als startbare Datei auffindbar
// sein. `command -v` waere kuerzer, gibt es unter cmd.exe aber nicht (Issue #196).
// Liefert zusaetzlich den aufgeloesten Pfad und den Startbefehl dazu — der Probelauf
// unten startet damit, statt noch einmal zu suchen. Unter Windows steckt in `pfad` die
// Endung aus PATHEXT, und ein per npm installiertes `codex.cmd` startet ueber seine
// sh-Huelle in der Git Bash (Issue #1135, E8); fehlt die Huelle, steht das in
// `start.fehler`. Umgebung, Plattform und Dateisystem sind injizierbar wie bei
// `startbefehlFuer`.
export function kommandoVerfuegbar(kommandozeile, { env = process.env, plattform = process.platform, existiert, ausfuehrbar } = {}) {
  const datei = kommandozeile.trim().split(/\s+/)[0];
  const pfad = findeImPath(datei, {
    platform: plattform,
    path: umgebungsWert(env, "PATH"),
    pathext: umgebungsWert(env, "PATHEXT"),
    existiert,
    ausfuehrbar,
  });
  if (pfad === null) return { datei, ok: false, pfad, start: null };
  return { datei, ok: true, pfad, start: startbefehlFuer(pfad, { env, plattform, existiert }) };
}

// Ein Prompt, der nichts verlangt: Der Probelauf startet ein frei konfiguriertes
// fremdes Werkzeug, das seinerseits ein Agent sein kann. Er soll feststellen, ob es
// laeuft — nicht, was es kann.
// KIT_PROBE_PROMPT ist ein Test-Hook (dasselbe Muster wie KIT_PROBE_TIMEOUT_MS): Nur
// mit einem Prompt oberhalb des Pipe-Puffers laesst sich EPIPE deterministisch
// erzeugen, also der Fall, dass das Kommando weg ist, bevor der Prompt geschrieben
// wurde (Issue #393).
const PROBE_PROMPT = process.env.KIT_PROBE_PROMPT || "Antworte nur mit dem Wort OK.\n";

// Zeitlimit ist Pflicht, nicht Kuer: Ein haengender Reviewer ist fuer den Vorflug
// dasselbe Problem wie ein fehlender, und ohne Limit haengt der Vorflug mit.
// KIT_PROBE_TIMEOUT_MS ist ein Test-Hook (dasselbe Muster wie NIGHT_TIMEOUT_MS).
const PROBE_TIMEOUT_MS = Number(process.env.KIT_PROBE_TIMEOUT_MS) || 60_000;

/**
 * Startet ein Reviewer-Kommando einmal mit einem harmlosen Prompt ueber stdin.
 *
 * Der Grund (Issue #262): Die PATH-Suche sagt, dass etwas startbar ist, nicht dass es
 * benutzbar ist. Am 2026-08-08 lag `codex` im PATH und scheiterte trotzdem bei jedem
 * Aufruf an einem HTTP 400 — der Vorflug meldete `verfuegbar`, und nachts haette der
 * Lauf mit einem toten Reviewer begonnen.
 *
 * Ohne Shell, wie alles in dieser Datei (Issue #196): Die Kommandozeile wird am
 * Whitespace zerlegt und als argv uebergeben. Dieselbe Annahme wie in
 * kommandoVerfuegbar — eine Reviewer-Kommandozeile mit Quotes oder Pipes ist damit
 * nicht abgedeckt, und das ist der Preis dafuer, dass es unter Windows laeuft.
 * Gestartet wird nach `start` aus kommandoVerfuegbar (Issue #1135, E8).
 */
function probelauf(kommandozeile, start) {
  const argumente = kommandozeile.trim().split(/\s+/).slice(1);
  const aufruf = spawnAufruf(start.befehl, [...start.vorArgs, ...argumente], start);
  const res = spawnSync(aufruf.befehl, aufruf.args, {
    ...aufruf.optionen,
    input: PROBE_PROMPT,
    encoding: "utf-8",
    timeout: PROBE_TIMEOUT_MS,
    env: { ...process.env, ...start.umgebung },
  });
  if (res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM") {
    return { ok: false, grund: `Zeitlimit von ${PROBE_TIMEOUT_MS} ms ueberschritten` };
  }
  // Der Exit-Status schlaegt den Fehler (Issue #393). Endet das Kommando, bevor der
  // Prompt in seine stdin geschrieben ist, meldet spawnSync EPIPE — zusaetzlich zum
  // Status und zusaetzlich zu dem, was in stderr steht. Wer den Fehler zuerst prueft,
  // gibt `spawnSync ... EPIPE` aus und wirft genau die Auskunft weg, fuer die es den
  // Probelauf gibt.
  if (res.status !== null) {
    if (res.status === 0) return { ok: true };
    // Die Fehlermeldung des Werkzeugs ist die eigentliche Auskunft — sie sagt, ob ein
    // Modell fehlt, ein Token abgelaufen ist oder etwas ganz anderes klemmt.
    const letzte = (res.stderr || "").trim().split(/\r?\n/).findLast(Boolean);
    return { ok: false, grund: (letzte || `Exit ${res.status}`).slice(0, 300) };
  }
  if (res.error) return { ok: false, grund: res.error.message };
  // Kein Status und kein Fehler heisst: durch ein Signal gestorben (SIGSEGV, SIGKILL).
  // Ohne diesen Zweig fiele der Fall auf `ok: true` durch, und ein abgestuerzter
  // Reviewer gaelte als verfuegbar.
  return { ok: false, grund: `Durch Signal ${res.signal} beendet` };
}

function issueReviewReviewers(args) {
  const autor = args.author === true ? fail("--author braucht einen Wert") : args.author;
  const { reviewers, pairs } = issueReviewConfig();
  out({ autor: autor || null, ...pickReviewers(reviewers, autor, 2, pairs) });
}

/**
 * Besetzung und Blickwinkel einer Pruefstufe (Issue #278; gekuerzt in Plan #638, A15).
 *
 * `--author` ist verpflichtend, nicht bequem: `pickReviewers` braucht den Autor fuer
 * `pairs` und fuer den Selbstausschluss. Ohne ihn koennte der Befehl genau das nicht
 * leisten, wofuer es ihn gibt — und wuerde trotzdem eine Reviewer-Liste ausgeben.
 *
 * Zwei Quellen, zwei Felder: `quelle` bleibt die Quelle der Reviewer-AUSWAHL
 * ("pairs" | "regel", Bestandsverhalten), `stufenQuelle` nennt die Herkunft der
 * STUFENBESETZUNG ("stufen" | "default").
 *
 * `--issue`, `--rolle` und `--ausschluss` sind mit der Pruefvorgabe und der
 * Synthese-Pruefung entfallen. Sie werden abgewiesen statt still uebergangen: Ein
 * stilles Flag waere eine zweite Wahrheit ueber das, was das Kommando tut.
 */
const ROLES_ENTFALLEN = ["issue", "rolle", "ausschluss"];

async function issueReviewRoles(args) {
  for (const option of ROLES_ENTFALLEN) {
    if (args[option] !== undefined) {
      fail(`--${option} gibt es seit Stufe 2 des Prozess-Umbaus nicht mehr — roles kennt nur --stufe und --author.`);
    }
  }
  const stufe = args.stufe === true ? fail("--stufe braucht einen Wert") : args.stufe;
  if (!stufe) fail(`--stufe fehlt. Erwartet: ${REVIEW_STUFEN.join(" | ")}`);
  if (!REVIEW_STUFEN.includes(stufe)) {
    fail(`--stufe '${stufe}' ist keine bekannte Stufe. Erwartet: ${REVIEW_STUFEN.join(" | ")}`);
  }
  const autor = args.author === true ? fail("--author braucht einen Wert") : args.author;
  if (!autor) fail("--author fehlt — ohne Autor greifen weder pairs noch der Selbstausschluss.");

  const { reviewers, pairs, reviewStufen } = issueReviewConfig();
  const { reviewer, rollen } = reviewStufen.stufen[stufe];
  out({
    stufe,
    reviewer,
    rollen,
    stufenQuelle: reviewStufen.stufenQuelle,
    autor,
    ...pickReviewers(reviewers, autor, reviewer, pairs),
  });
}

// Die Tabelle, nach der man eigentlich fragt: wer prueft wen. Autoren sind alle
// Reviewer-Namen plus alle pairs-Schluessel — letztere auch dann, wenn sie selbst nicht
// als Reviewer auftreten (ein Modell kann schreiben, ohne zu pruefen).
function issueReviewMatrix() {
  const { reviewers, pairs } = issueReviewConfig();
  const autoren = [...new Set([...reviewers.map((r) => r.name), ...Object.keys(pairs)])];
  out({
    matrix: autoren.map((autor) => {
      const { gewaehlt, quelle } = pickReviewers(reviewers, autor, 2, pairs);
      // Die Modell-ID dazu (Issue #241): In den Issues steht `Autor-Modell:
      // claude-opus-5`, in dieser Tabelle stand bisher nur `opus`. Wer die Matrix
      // liest, soll den Wert wiedererkennen, der in seinen Issues steht.
      const modell = reviewers.find((r) => r.name === autor)?.model || null;
      return { autor, modell, reviewer: gewaehlt.map((r) => r.name), quelle };
    }),
  });
}

// Die Umgebung, in der dieses Kommando misst (Issue #269). Ein Befund von hier stammt
// immer aus dem aufrufenden Prozess — interaktiv ist das die Session des Menschen, im
// Runner der Runner selbst. Der Wert steht ausdruecklich im Befund, damit niemand ein
// `verfuegbar: true` auf eine Umgebung bezieht, in der gar nicht geprueft wurde. Der
// Nacht-Runner erkennt seinen eigenen Session-Vorflug am Gegenwert "review-session";
// ein direkt hier gestarteter Prozess kann ihn nie erzeugen.
const CHECK_UMGEBUNG = "runner";

// Auskunft, kein Gate: Exit bleibt 0, auch wenn ein Reviewer fehlt. Wer daraus ein
// Gate macht, ist der Skill — er kann den Menschen fragen, dieses Kommando nicht.
function issueReviewCheck(args = {}) {
  // `--nur-pfad` faellt auf das Verhalten vor Issue #262 zurueck, fuer den Fall, dass
  // ein Probelauf zu teuer oder unerwuenscht ist. Das Feld `geprueft` macht in beiden
  // Faellen sichtbar, worauf sich die Aussage stuetzt.
  const nurPfad = args["nur-pfad"] === true;
  const { reviewers } = issueReviewConfig();
  const ergebnis = reviewers.map((r) => {
    const basis = { name: r.name, kind: r.kind, umgebung: CHECK_UMGEBUNG };
    if (r.kind === "claude") return { ...basis, verfuegbar: true };
    const { datei, ok, start } = kommandoVerfuegbar(r.command);
    if (!ok) return { ...basis, verfuegbar: false, geprueft: "pfad", grund: `${datei} nicht im PATH` };
    // Im PATH, aber nicht startbar: eine `.cmd` ohne sh-Huelle unter Windows (E8).
    if (start.fehler) return { ...basis, verfuegbar: false, geprueft: "pfad", grund: start.fehler };
    if (nurPfad) return { ...basis, verfuegbar: true, geprueft: "pfad" };
    const probe = probelauf(r.command, start);
    return probe.ok
      ? { ...basis, verfuegbar: true, geprueft: "probelauf" }
      : { ...basis, verfuegbar: false, geprueft: "probelauf", grund: probe.grund };
  });
  // Ohne konfigurierte Reviewer waere `every()` auf dem leeren Array true — der Vorflug
  // haette einen Lauf durchgelassen, der garantiert nichts liefert: Jede Session startet,
  // der Skill beendet sich mangels Reviewern, und der Runner bucht sie als "ohne
  // Ergebnis". Eine ganze Nacht verbrannt, ohne dass etwas nach Fehler aussieht.
  // Dieselbe Fehlerklasse wie beim [Idee]-Gate (Issue #192): eine vorhersehbare Lage
  // gehoert ins Gate, nicht in einen Prompt.
  out(reviewers.length === 0
    ? { reviewers: [], alleVerfuegbar: false, grund: "issueReview.reviewers ist leer oder fehlt — Block aus .claude/workflow.config.example.json uebernehmen" }
    : { reviewers: ergebnis, alleVerfuegbar: ergebnis.every((r) => r.verfuegbar) });
}

/**
 * Die Pruefstufe aus dem Titel-Praefix, wie sie auch `/issue-review` bestimmt.
 *
 * Nutzt die Praedikate von oben. Bis Issue #464 stand die Praefix-Form hier ein
 * drittes Mal — in derselben Datei, in der sie seither definiert ist.
 */
export function stufeAusTitel(title) {
  if (istFachlich(title)) return "fachlich";
  if (istPlan(title)) return "plan";
  return "issue";
}

async function dispatchIssueReview(command, args) {
  switch (command) {
    case "reviewers": return issueReviewReviewers(args);
    case "check": return issueReviewCheck(args);
    case "matrix": return issueReviewMatrix();
    case "roles": return issueReviewRoles(args);
    default:
      process.stdout.write(HELP);
      fail(`Unbekannter issue-review-Befehl: '${command}'`);
  }
}

// ============================================================
// Nachtlauf einliefern (Issue #669)
// ============================================================
//
// Der Vertrag ist `POST /api/kanban/night-runs` in kanban-kit (NightRunIngestController,
// Plan #943): ein fertig gedeuteter Lauf mit Farbe je Arbeitspaket. Die Deutung folgt
// kanban-kit `frontend/src/lib/nightRunErgebnisstand.ts`, beschraenkt auf die beiden
// Lauf-Arten, die night.mjs heute schreibt. Anders als der Parser dort lehnt sie einen
// unbekannten Ausgang nicht ab: Der Runner kann nachts niemanden fragen, und ein roter
// UNEXPECTED_STATE ist ehrlicher als eine verlorene Nacht.

// Laengengrenzen des Vertrags (NightRunController, NightRunLimits).
const NACHTLAUF_TITEL_MAX = 300;
// Gilt fuer jeden Auszug des Vertrags: den `excerpt` eines Arbeitspakets und den
// `abortReason` des Laufs (Issue #881) — beide misst die Gegenstelle an EXCERPT_MAX.
const NACHTLAUF_AUSZUG_MAX = 4000;
const NACHTLAUF_COMMIT_MAX = 40;
const NACHTLAUF_EINHEITEN_MAX = 200;
// Die Gegenstelle kuerzt `noWorkReason` nicht selbst und weist es ab, wenn es laenger
// ist (Issue #744) — die Kuerzung passiert deshalb hier.
const NACHTLAUF_NOWORKREASON_MAX = 300;

const NACHTLAUF_MODUS = { implementierung: "IMPLEMENTATION", kette: "CHAIN" };

// Die Art des Laufs im Vertrag (mannewolff/kanban-kit#1012). Der Endpunkt faellt ohne das
// Feld auf NIGHT zurueck; ausgeschrieben steht es trotzdem hier, damit ein Nachtlauf nicht
// am Vorgabewert haengt, sobald derselbe Endpunkt auch andere Arten annimmt.
const NACHTLAUF_ART = "NIGHT";

// Farbe nach Pruefzustand, getrennt fuer erfolg und fehlschlag (NACH_ZUSTAND dort).
const NACHTLAUF_NACH_PRUEFUNG = {
  geprueft: { erfolg: ["GREEN", null] },
  // Der Runner hat den Nachweis selbst nachgefahren, weil der hinterlassene nicht zum
  // Commit des Pakets gehoerte (Issue #865) — gruen ist gruen, wie bei `geprueft`.
  nachgeprueft: { erfolg: ["GREEN", null] },
  leeresPaket: { erfolg: ["GREEN", null] },
  ungeprueft: { erfolg: ["YELLOW", "CHECKS_NOT_STARTED"], fehlschlag: ["RED", "CHECKS_NOT_STARTED"] },
  unlesbar: { erfolg: ["YELLOW", "CHECKS_NOT_STARTED"], fehlschlag: ["RED", "CHECKS_NOT_STARTED"] },
  rot: { erfolg: ["YELLOW", "CHECKS_RED"], fehlschlag: ["RED", "CHECKS_RED"] },
};

// Ausgaenge mit fester Farbe, in beiden Lauf-Arten.
const NACHTLAUF_FEST = {
  uebersprungen: ["GREY", null],
  liegengeblieben: ["GREY", null],
  unbekannt: ["RED", "HARD_ABORT"],
  harterStopp: ["RED", "HARD_ABORT"],
  // Eine Einheit, die der Waechter eines verstummten Laufs abgeschlossen hat (Issue #1085,
  // E18). `abgebrochen` steht bewusst NICHT hier: Die Kette fuehrt es als eigenen Ausgang
  // mit dem Zeitbudget als Unterscheidung (farbeAbgebrochen).
  verstummt: ["RED", "HARD_ABORT"],
  angehalten: ["RED", "AWAITING_DECISION"],
  // Der Vorgang lief durch und hat etwas Bestelltes nicht getan (Issue #862): die Kette,
  // deren Umsetzung an einer belegten Sperre ausblieb, und die Pruefung, deren Ergebnis
  // den Body nie erreichte. GELB, weil GRUEN das Fehlende verschwiege und ROT aus einem
  // vorgesehenen Ausgang eine Stoerung machte; ohne Fehlerklasse, weil keine der
  // vorhandenen ihn trifft — den Grund traegt der `excerpt` der Einheit.
  unvollstaendig: ["YELLOW", null],
  fertig: ["GREEN", null],
};

/** Die Farbe eines zurueckgestellten Pakets — erster Treffer gewinnt (ZURUECKGESTELLT dort). */
function farbeZurueckgestellt(grund) {
  if (grund.includes("Abhaengigkeit")) return ["GREY", "DEPENDENCY_UNMET"];
  if (grund.includes("kit:klaeren")) return ["RED", "AWAITING_DECISION"];
  if (grund.startsWith("Session ohne In-review-Ergebnis")) return ["RED", "UNEXPECTED_STATE"];
  return ["GREY", null];
}

/** Die Farbe eines abgebrochenen Ketten-Vorgangs (deuteKettenAusgang dort). */
function farbeAbgebrochen(einheit, grund) {
  if (!grund.startsWith("Zeitbudget ")) return ["RED", "HARD_ABORT"];
  const s = einheit.stufen;
  const dokument = typeof s?.plan?.id === "string" || (Array.isArray(s?.pakete?.ids) && s.pakete.ids.length > 0);
  return [dokument ? "YELLOW" : "RED", "TIME_BUDGET_EXCEEDED"];
}

function nachtlaufFarbe(einheit) {
  const grund = typeof einheit.grund === "string" ? einheit.grund : "";
  const ausgang = einheit.ausgang;
  if (NACHTLAUF_FEST[ausgang]) return NACHTLAUF_FEST[ausgang];
  if (ausgang === "zurueckgestellt") return farbeZurueckgestellt(grund);
  if (ausgang === "abgebrochen") return farbeAbgebrochen(einheit, grund);
  if (ausgang === "erfolg" || ausgang === "fehlschlag") {
    const zeile = NACHTLAUF_NACH_PRUEFUNG[einheit.pruefung?.zustand ?? "ungeprueft"];
    return zeile?.[ausgang] ?? ["RED", "UNEXPECTED_STATE"];
  }
  return ["RED", "UNEXPECTED_STATE"];
}

/** Eine endliche Zahl oder `null` — die Waehrung aller gemeldeten Kennzahlen. */
function nachtlaufZahl(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/**
 * Die Mengen im Vertragsformat, `null`, wenn nichts gemessen wurde. Eingabemenge ist alles
 * Verarbeitete — eigene Eingabe plus beide Zwischenspeicher-Mengen —, der Zwischenspeicher-
 * Anteil nur das daraus Gelesene. So ergibt das Beispiel aus Issue #669 die dort genannten
 * 97,8 Prozent.
 *
 * Seit Issue #808 kommen Modellzeit und Zuege aus den `kennzahlen` dazu — sie stehen nicht
 * im `verbrauch`, dessen Feldliste (VERBRAUCH_FELDER in night.mjs) unveraendert bleibt.
 */
function nachtlaufUsage(v, kennzahlen = null) {
  const zahl = nachtlaufZahl;
  const eingaben = [v?.eingabeTokens, v?.cacheErzeugtTokens, v?.cacheGelesenTokens].map(zahl).filter((x) => x !== null);
  const usage = {
    costUsd: zahl(v?.kostenUsd),
    inputTokens: eingaben.length ? eingaben.reduce((a, b) => a + b, 0) : null,
    outputTokens: zahl(v?.ausgabeTokens),
    cachedInputTokens: zahl(v?.cacheGelesenTokens),
    modelDurationMs: zahl(kennzahlen?.apiDauerMs),
    turns: zahl(kennzahlen?.zuege),
  };
  return Object.values(usage).every((x) => x === null) ? null : usage;
}

/**
 * Modellzeit und Zuege einer Einheit: die eigenen Kennzahlen, je Feld — traegt die Einheit
 * keins, die Summe ueber ihre Stufen, wie `zuegeDerEinheit` (kanban-kit,
 * nightRunErgebnisstand.ts) es im Browser tut. Ein Feld ohne jede Meldung bleibt `null`,
 * eine leere Summe stuende sonst als 0 da, wo nichts gemessen wurde.
 */
function nachtlaufKennzahlen(einheit) {
  const summe = {};
  for (const feld of ["apiDauerMs", "zuege"]) {
    const eigen = nachtlaufZahl(einheit.kennzahlen?.[feld]);
    if (eigen !== null) { summe[feld] = eigen; continue; }
    const gemeldet = Object.values(einheit.stufen ?? {}).map((s) => nachtlaufZahl(s?.kennzahlen?.[feld])).filter((x) => x !== null);
    summe[feld] = gemeldet.length ? gemeldet.reduce((a, b) => a + b, 0) : null;
  }
  return summe;
}

// Die vier Stufen, die eine Meldung je Ketten-Vorgang fuehrt (Issue #808, E17), in der
// Reihenfolge der Kette. `umsetzung` bleibt draussen: Der Vertrag nimmt hoechstens vier
// Stufen an, ein fuenfter Eintrag liesse die ganze Meldung scheitern — ihr Verbrauch
// bleibt im `usage` des Vorgangs und damit in jeder Gesamtsumme enthalten.
const NACHTLAUF_STUFEN = ["plan", "review", "pakete", "abdeckung"];

/** Die Stufen einer Ketten-Einheit fuer die Meldung; `null` ohne Stufen (Implementierung). */
function nachtlaufStages(einheit) {
  const stufen = einheit.stufen;
  if (!stufen || typeof stufen !== "object") return null;
  // Eine uebernommene Stufe (Plan-Auftrag, Issue #895) ist nie gelaufen: Sie traegt nur
  // die Plannummer. Gemeldet ergaebe sie `durationMs: 0` mit leerem `usage` — eine
  // Messung, die es nicht gab. Darum bleibt sie draussen, wie im Nachtbericht.
  const stages = NACHTLAUF_STUFEN.filter((stage) => stufen[stage] && stufen[stage].uebernommen !== true).map((stage) => ({
    stage,
    durationMs: nachtlaufZahl(stufen[stage].dauerMs),
    // Die Stufe fuehrt Mengen und Kennzahlen in EINEM Objekt (leseKennzahlen nutzt
    // dieselben Feldnamen wie der Verbrauch) — es bedient beide Parameter.
    usage: nachtlaufUsage(stufen[stage].kennzahlen, stufen[stage].kennzahlen),
  }));
  return stages.length ? stages : null;
}

// Die Budget-Felder, die die Fusszeile der Laeufe-Seite zeigt (Issue #808, E4) — nur auf
// sie wird Budget und Herkunft zugeschnitten. KETTE_BUDGET_DEFAULTS (night.mjs) fuehrt
// mehr; ungefiltert entstuende "aus Voreinstellungen" mit lauter Feldern, die niemand sieht.
const NACHTLAUF_BUDGET_FELDER = new Set(["planMin", "reviewMin", "paketeMin", "abdeckungMin", "kostenUsd"]);

/**
 * Das Budget des Laufs samt Herkunft fuer die Meldung; `null`, wenn der Stand keins fuehrt
 * (nur die Kette traegt eins). Ist nach dem Zuschnitt kein Default-Feld uebrig, heisst die
 * Herkunft CONFIGURED ohne Aufzaehlung — eine leere Liste saehe aus wie eine Aussage.
 */
function nachtlaufBudget(stand) {
  const b = stand?.budget;
  if (!b || typeof b !== "object") return null;
  const budget = {};
  for (const feld of NACHTLAUF_BUDGET_FELDER) {
    const wert = nachtlaufZahl(b[feld]);
    if (wert !== null) budget[feld] = wert;
  }
  const defaultFields = (Array.isArray(stand.budgetAusDefault) ? stand.budgetAusDefault : [])
    .filter((feld) => NACHTLAUF_BUDGET_FELDER.has(feld));
  budget.origin = defaultFields.length ? "DEFAULTED" : "CONFIGURED";
  if (defaultFields.length) budget.defaultFields = defaultFields;
  return budget;
}

/**
 * Der Grund, an dem ein Lauf hart gestoppt ist; `null`, solange keiner vorliegt (Issue #881).
 * Seit Issue #1085 ebenso fuer einen verstummten und einen abgebrochenen Lauf.
 *
 * Die Kaskade folgt den drei Stopp-Pfaden in night.mjs: `fail()` schreibt den Text an den
 * Lauf-Kopf, der Vorflug-Stopp und der harte Stopp der Implementierung lassen ihn dort
 * genau dann leer, wenn das Sicherheitsnetz aus Issue #558 den Grund an der betroffenen
 * Einheit sieht. Bleibt beides leer, ist die Fehlerklasse das Letzte, was der Lauf noch
 * ueber sich sagen kann — ein leerer Grund waere schlechter als ein grober.
 *
 * Reine Funktion wie `nachtlaufBudget`: Sie liest den Stand und schreibt nichts hinein.
 */
// Die Abschluesse, die eine Stoerung sind, mit dem Grund, der bleibt, wenn der Stand keinen
// nennt. `verstummt` setzt der Waechter, `abgebrochen` die Abbruch-Handler (Issue #1085,
// E18): Beide schliessen den Lauf ab, und ohne Grund stuende er am Leitstand wie ein
// regulaer beendeter.
const NACHTLAUF_ABBRUCH = { harterStopp: "Harter Stopp", verstummt: "Verstummt", abgebrochen: "Abgebrochen" };

export function nachtlaufAbbruchGrund(stand) {
  const ersatz = NACHTLAUF_ABBRUCH[stand?.abschluss];
  if (ersatz === undefined) return null;
  const gefuellt = (text) => typeof text === "string" && text !== "";
  if (gefuellt(stand.fehlerText)) return stand.fehlerText.slice(0, NACHTLAUF_AUSZUG_MAX);
  const einheiten = Array.isArray(stand.einheiten) ? stand.einheiten : [];
  const betroffen = stand.fehlerEinheit == null
    ? null
    : einheiten.find((e) => String(e?.id) === String(stand.fehlerEinheit));
  if (betroffen && gefuellt(betroffen.grund)) return betroffen.grund.slice(0, NACHTLAUF_AUSZUG_MAX);
  return gefuellt(stand.fehlerklasse) ? `${ersatz} (${stand.fehlerklasse})` : ersatz;
}

function nachtlaufDauer(einheit) {
  if (typeof einheit.dauerMs === "number") return einheit.dauerMs;
  const stufen = Object.values(einheit.stufen ?? {}).map((s) => s?.dauerMs).filter((d) => typeof d === "number");
  return stufen.length ? stufen.reduce((a, b) => a + b, 0) : null;
}

/**
 * Eine Einheit, der ihr Ausgang noch fehlt (Issue #794).
 *
 * `unbekannt` ist der Platzhalter, den `night.mjs` beim Anlegen einer Einheit setzt; ein
 * ganz fehlendes Feld zaehlt genauso. Beides heisst dasselbe: Hier steht noch kein
 * Ergebnis.
 */
function nachtlaufOhneAusgang(einheit) {
  const ausgang = einheit?.ausgang;
  return ausgang === undefined || ausgang === null || ausgang === "" || ausgang === "unbekannt";
}

/**
 * Uebersetzt einen Ergebnisstand in die Meldung fuer `POST /api/kanban/night-runs`.
 * Reine Funktion; `jetzt` bestimmt die Dauer seit dem Start, weil der Stand fortschreibend
 * und damit vor seinem Ende gemeldet wird.
 *
 * Solange der Lauf laeuft, gehen nur Einheiten mit Ausgang mit (Issue #794): Eine Kette
 * legt ihre Einheit beim Start an und traegt den Ausgang erst hinter der letzten Stufe
 * ein — in der ganzen Planungsphase stuende der Fachplan sonst als rotes Paket in der
 * Auswertung, obwohl nur noch nichts entschieden ist. Ein eigener Zustand "laeuft" waere
 * eine Vertragsaenderung ohne Nutzen: Der Lauf selbst gilt bei der Gegenstelle ohnehin
 * als laufend, solange er nicht abgeschlossen ist.
 *
 * NACH dem Abschluss bleibt dieselbe Einheit sichtbar: Dort ist der fehlende Ausgang
 * kein Zwischenstand mehr, sondern der Befund, dass sie nie zu ihrem Ergebnis kam — und
 * genau dafuer haelt `nachtlaufFarbe` den harten Abbruch bereit.
 */
export function nachtlaufMeldung(stand, jetzt = new Date()) {
  const mode = NACHTLAUF_MODUS[stand?.art];
  if (!mode) throw new BoardError(`Lauf-Art '${stand?.art}' hat keine Nachtlauf-Schnittstelle (erwartet: ${Object.keys(NACHTLAUF_MODUS).join(" | ")})`);
  const laeuft = stand.abschluss === null || stand.abschluss === undefined;
  const items = (Array.isArray(stand.einheiten) ? stand.einheiten : [])
    .filter((e) => /^\d+$/.test(String(e?.id)))
    // Vor dem Kappen auf NACHTLAUF_EINHEITEN_MAX, damit eine laufende Einheit den Platz
    // nicht einer belegt, die ihr Ergebnis schon hat.
    .filter((e) => !(laeuft && nachtlaufOhneAusgang(e)))
    .slice(0, NACHTLAUF_EINHEITEN_MAX)
    .map((e) => {
      const [state, errorClass] = nachtlaufFarbe(e);
      const grund = typeof e.grund === "string" && e.grund !== "" ? e.grund : null;
      const stages = nachtlaufStages(e);
      return {
        cardNumber: Number(e.id),
        // @NotBlank im Vertrag: Ein leerer Titel faellt auf die Nummer zurueck.
        title: String(e.titel || `#${e.id}`).slice(0, NACHTLAUF_TITEL_MAX),
        state,
        errorClass,
        durationMs: nachtlaufDauer(e),
        commitHash: typeof e.commit === "string" ? e.commit.slice(0, NACHTLAUF_COMMIT_MAX) : null,
        excerpt: grund === null ? null : grund.slice(0, NACHTLAUF_AUSZUG_MAX),
        usage: nachtlaufUsage(e.verbrauch, nachtlaufKennzahlen(e)),
        // Nur, wo der Stand Stufen fuehrt (Issue #808) — ein Implementierungs-Paket
        // meldet das Feld gar nicht erst, wie noWorkReason am Lauf-Kopf.
        ...(stages !== null ? { stages } : {}),
      };
    });
  const grau = items.filter((i) => i.state === "GREY").length;
  const noWorkReason = typeof stand.noWorkReason === "string" && stand.noWorkReason !== ""
    ? stand.noWorkReason.slice(0, NACHTLAUF_NOWORKREASON_MAX)
    : null;
  const budget = nachtlaufBudget(stand);
  const abortReason = nachtlaufAbbruchGrund(stand);
  return {
    startedAt: stand.start,
    kind: NACHTLAUF_ART,
    mode,
    durationMs: Math.max(0, jetzt.getTime() - new Date(stand.start).getTime()),
    processedCount: items.length - grau,
    skippedCount: grau,
    unparsedCount: 0,
    // Abgeschlossen ist ein Lauf am Board, sobald sein Ergebnisstand einen Abschluss
    // traegt — regulaer ODER hart gestoppt (Issue #881). Bis dahin kam die Aussage aus
    // `stand.complete`, das nur das regulaere Ende kennt: Ein hart gestoppter Lauf stand
    // dort ewig unter den aktiven Laeufen, obwohl er lange tot war. Der `abortReason`
    // daneben sagt der Gegenstelle, dass dieser Abschluss eine Stoerung ist.
    complete: !laeuft,
    usage: nachtlaufUsage(stand.verbrauch),
    items,
    // Nur bei einem Lauf ohne Arbeit gesetzt (Issue #744) — die Gegenstelle setzt den
    // gruenen Ersatztext sonst nur bei null Arbeitspaketen; ihn immer mitzuschicken
    // liesse zwei Stellen ueber dieselbe Frage entscheiden.
    ...(noWorkReason !== null ? { noWorkReason } : {}),
    // Nur, wo der Stand ein Budget fuehrt (Issue #808) — heute allein die Kette.
    ...(budget !== null ? { budget } : {}),
    // Nur bei einem hart gestoppten, verstummten oder abgebrochenen Lauf (Issue #881,
    // #1085) — wie noWorkReason und budget:
    // Das Feld immer mitzuschicken liesse zwei Stellen ueber dieselbe Frage entscheiden.
    ...(abortReason !== null ? { abortReason } : {}),
  };
}

async function nightrunMelden(args) {
  const config = loadConfig();
  if (config.issueTracker !== "toolbox") {
    fail(`Einlieferung nur mit issueTracker toolbox moeglich, konfiguriert ist '${config.issueTracker}'.`);
  }
  if (!args.datei) fail("nightrun melden braucht --datei <ergebnisstand.json>");
  let stand;
  try {
    stand = JSON.parse(readFileSync(args.datei, "utf-8"));
  } catch (e) {
    fail(`Ergebnisstand ${args.datei} nicht lesbar: ${e.message}`);
  }
  const res = await new ToolboxIssueTracker(config)._fetch("/api/kanban/night-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nachtlaufMeldung(stand)),
  });
  let antwort = null;
  try { antwort = await res.json(); } catch { /* kein JSON-Rumpf */ }
  process.stdout.write(JSON.stringify({ ok: true, outcome: antwort?.outcome ?? null }) + "\n");
}

async function dispatchNightrun(command, args) {
  if (command === "melden") return nightrunMelden(args);
  process.stdout.write(HELP);
  fail(`Unbekannter nightrun-Befehl: '${command}'`);
}

// ============================================================
// Sitzungs-Melder fuer den interaktiven Verbrauch (Issue #734)
// ============================================================
//
// WARUM HIER UND NICHT IN EINER EIGENEN kit/sitzung.mjs (die Entscheidung, die das
// Arbeitspaket offen liess): Der Melder braucht vier Dinge, die alle in dieser Datei
// liegen und keine davon ist exportiert — `loadConfig`, `resolveToolboxToken`,
// `ToolboxIssueTracker._fetch` und `agentModelHeader`. Eine Nachbardatei muesste sie
// entweder nachbauen (zwei Wege zum selben Board, die auseinanderlaufen) oder ihre
// Freigabe erzwingen (der interne Adapter wird oeffentlicher Vertrag). Dazu kommt:
// Ein neues Kit-Werkzeug braucht Blob, Stempel und eine Zeile im Installer —
// Aufwand, den das Paket nicht verlangt. Die Preistabelle liegt trotzdem daneben
// (kit/preise.mjs): Sie ist Pflegedaten mit eigenem Stand, kein Code, und genau
// deshalb hat sie eine eigene Datei verdient.
//
// Der Vertrag ist derselbe wie beim Nachtlauf (`POST /api/kanban/night-runs`,
// mannewolff/kanban-kit#1012), nur mit `kind`/`mode` INTERACTIVE und dem
// Sitzungsstart als fachlichem Schluessel.

const SITZUNG_ART = "INTERACTIVE";
const SITZUNG_ZUSTAND = "GREEN";
const SITZUNG_DROSSEL_MS = 5 * 60 * 1000;
const SITZUNG_STAND_DATEI = "sitzung-meldung.json";

// Das Verzeichnis, in dem board.mjs seine Nachbardateien sucht — heute allein
// kit/preise.mjs. BOARD_NACHBAR_DIR ist ein reiner Test-Hook (wie
// NIGHT_NACHBAR_DIR in night.mjs): Ohne ihn ist der Fallback-Zweig nur mit einer
// Kopie im Temp-Verzeichnis erreichbar, deren Treffer die Coverage nicht auf
// kit/board.mjs abbildet. Bewusst nicht KIT_ROOT: Das verlegt die Suche in ein
// fremdes Projekt — eine Nachbardatei gehoert zu dieser Datei, nicht zum cwd.
const NACHBAR_DIR = process.env.BOARD_NACHBAR_DIR ? resolve(process.env.BOARD_NACHBAR_DIR) : __dirname;

// Die Preistabelle als Nachbardatei: bedingtes `await import`, damit board.mjs
// auch als allein kopierte Datei laeuft (dieselbe Bauart wie die Fallbacks in
// night.mjs). Fehlt sie, kennt der Melder keinen Preis — und meldet dann eben
// keinen Betrag. Das ist genau das Verhalten, das board-15 fuer ein unbekanntes
// Modell verlangt, und deshalb braucht dieser Weg keinen zweiten Fehlerpfad.
const NACHBAR_PREISE = join(NACHBAR_DIR, "preise.mjs");
const { preisFuer } = existsSync(NACHBAR_PREISE)
  ? await import(pathToFileURL(NACHBAR_PREISE).href)
  : { preisFuer: () => null };

/**
 * Liest das Sitzungsprotokoll von Claude Code (JSON Lines).
 *
 * DER KERN IST DIE ENTDOPPLUNG. Ein Zug steht mit einer Zeile je Inhaltsblock im
 * Protokoll — Text, Werkzeugaufruf, Gedanke —, und JEDE dieser Zeilen traegt dieselbe
 * `message.id` und dieselbe `usage`. An den Protokollen dieses Projekts gemessen
 * (2026-09-18): 90 Zeilen mit usage auf 40 Zuege. Wer je Zeile addiert, meldet das
 * Zwei- bis Sechsfache des Verbrauchs. Es gewinnt die letzte Zeile einer id: Waehrend
 * ein Zug laeuft, waechst seine usage, und der letzte Stand ist der vollstaendige.
 *
 * `start` ist der frueheste Zeitstempel im Protokoll — auch aus einer Zeile ohne
 * usage, denn die Sitzung beginnt mit der Eingabe des Menschen, nicht mit der ersten
 * Antwort. Er ist der fachliche Schluessel der Meldung; derselbe Schluessel ersetzt
 * am Endpunkt die vorige Meldung derselben Sitzung.
 *
 * Unlesbare Zeilen werden gezaehlt, nicht geworfen: Ein Protokoll, das gerade
 * geschrieben wird, endet regelmaessig mitten in einer Zeile, und eine halbe Zeile
 * darf keine Meldung kosten. Die Zahl geht als `unparsedCount` in den Vertrag.
 */
export function sitzungProtokoll(text) {
  const proId = new Map();
  let start = null;
  let unlesbar = 0;
  for (const zeile of String(text ?? "").split(/\r\n|\r|\n/)) {
    if (zeile.trim() === "") continue;
    let obj;
    try { obj = JSON.parse(zeile); } catch { unlesbar++; continue; }
    const zeit = Date.parse(obj?.timestamp);
    if (Number.isFinite(zeit) && (start === null || zeit < start)) start = zeit;
    const zug = sitzungZug(obj, zeit);
    if (zug) proId.set(zug.id, zug);
  }
  return {
    start: start === null ? null : new Date(start).toISOString(),
    zuege: [...proId.values()].sort((a, b) => a.zeit - b.zeit),
    unlesbar,
  };
}

/** Ein Protokolleintrag als Zug, oder `null`, wenn er keine Mengen traegt. */
function sitzungZug(obj, zeit) {
  const usage = obj?.message?.usage;
  const id = obj?.message?.id;
  if (!usage || typeof usage !== "object" || typeof id !== "string" || !Number.isFinite(zeit)) return null;
  const zahl = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  // Der Zwischenspeicher wird nach Haltedauer getrennt gefuehrt: Der Stunden-Speicher
  // kostet das Doppelte der Eingabe, der Fuenf-Minuten-Speicher das 1,25-fache. Das
  // Protokoll fuehrt beide Mengen unter `cache_creation`, und ihre Summe ist immer
  // `cache_creation_input_tokens` (an allen Protokollen dieses Projekts geprueft).
  // Fehlt die Aufschluesselung, faellt alles auf den Fuenf-Minuten-Satz — die Angabe
  // gibt es seit es die Stunden-Variante gibt, und der kleinere Satz behauptet im
  // Zweifel weniger.
  const teile = usage.cache_creation;
  const erzeugt = zahl(usage.cache_creation_input_tokens);
  const cache1h = teile && typeof teile === "object" ? zahl(teile.ephemeral_1h_input_tokens) : 0;
  return {
    id,
    zeit,
    modell: typeof obj?.message?.model === "string" ? obj.message.model : null,
    eingabe: zahl(usage.input_tokens),
    ausgabe: zahl(usage.output_tokens),
    cache1h,
    cache5m: erzeugt - cache1h,
    cacheGelesen: zahl(usage.cache_read_input_tokens),
  };
}

// Die beiden Spalten, die `issue move` vermerkt (WEGMARKEN_SPALTEN oben). `in_review`
// SCHLIESST den Abschnitt seiner Karte, `in_progress` oeffnet ihn.
const WEGMARKE_SCHLIESST = "in_review";

/**
 * Uebersetzt `.claude/wegmarken.tsv` in Abschnitte `{ karte, von, bis }` in
 * Millisekunden; `bis === null` heisst "bis zum Ende der Sitzung".
 *
 * ZWEI DURCHGAENGE, UND DAS IST DER GANZE PUNKT. Die Datei ist eine flache,
 * angehaengte Liste ohne Sitzungskennung — laufen zwei Sitzungen im selben
 * Verzeichnis, mischen sich ihre Wegmarken darin. Nur die Paarung aus eigenem
 * `in_progress` und eigenem `in_review` macht sichtbar, dass zwei Karten
 * GLEICHZEITIG offen waren (E21). Wer die Marken bloss der Reihe nach als Grenzen
 * liest, sieht diese Ueberlappung nie und schreibt den Verbrauch der einen Sitzung
 * der Karte der anderen zu.
 *
 * Durchgang 1 paart jedes `in_review` mit dem juengsten offenen `in_progress`
 * derselben Karte — das ergibt die geschlossenen Abschnitte.
 * Durchgang 2 nimmt die `in_progress` ohne eigenen Abschluss: Sie enden an der
 * naechsten Wegmarke einer ANDEREN Karte (der Normalfall der gestaffelten Arbeit) —
 * oder gar nicht, wenn keine mehr kommt.
 *
 * Was kein Abschnitt abdeckt oder was zwei Abschnitte abdecken, bekommt keine Karte.
 * Geraten wird nicht; die Zuordnung selbst macht `sitzungMeldung`.
 */
export function wegmarkenAbschnitte(text) {
  const marken = [];
  for (const zeile of String(text ?? "").split(/\r\n|\r|\n/)) {
    const [zeitText, karte, status] = zeile.split("\t");
    const zeit = Date.parse(zeitText);
    if (!Number.isFinite(zeit) || !karte || !WEGMARKEN_SPALTEN.has(status)) continue;
    marken.push({ zeit, karte, status });
  }
  marken.sort((a, b) => a.zeit - b.zeit);

  const abschnitte = [];
  const offen = new Map(); // karte -> Index der eroeffnenden Marke
  for (const [i, marke] of marken.entries()) {
    if (marke.status === WEGMARKE_SCHLIESST) {
      const start = offen.get(marke.karte);
      if (start !== undefined) {
        abschnitte.push({ karte: marke.karte, von: marken[start].zeit, bis: marke.zeit });
        offen.delete(marke.karte);
      }
      continue;
    }
    if (!offen.has(marke.karte)) offen.set(marke.karte, i);
  }
  for (const [karte, start] of offen) {
    const naechste = marken.slice(start + 1).find((m) => m.karte !== karte);
    abschnitte.push({ karte, von: marken[start].zeit, bis: naechste ? naechste.zeit : null });
  }
  return abschnitte.sort((a, b) => a.von - b.von);
}

/**
 * Die Karte eines Zeitpunkts — `null`, wenn ihn kein Abschnitt abdeckt oder mehr als
 * einer. Beides ist "ohne Karte": kein Abschnitt heisst, es lief keine Karte; zwei
 * Abschnitte heissen, es liefen zwei Sitzungen und keine Zuordnung waere belegbar.
 */
function sitzungKarte(abschnitte, zeit) {
  const treffer = abschnitte.filter((a) => zeit >= a.von && (a.bis === null || zeit < a.bis));
  return treffer.length === 1 ? treffer[0].karte : null;
}

/**
 * Der Dollarbetrag einer Menge Zuege, oder `null`, wenn er nicht bestimmbar ist.
 *
 * `null` statt 0, sobald EIN Zug ein Modell fuehrt, das die Preistabelle nicht kennt
 * und das Token verbraucht hat: Die Summe waere dann zu klein, saehe aber aus wie
 * gemessen. Ein unbekanntes Modell OHNE Token kostet dagegen zu jedem Preis nichts —
 * das ist Rechnen, kein Raten, und es haelt Claude Codes eigene Platzhalter-Eintraege
 * (`<synthetic>`, immer null Token) aus dem Ergebnis heraus.
 *
 * Auf sechs Stellen gerundet, wie `verbrauchOhneEinheit` in night.mjs: Sonst stuende
 * Gleitkomma-Rauschen im Betrag.
 */
function sitzungKosten(zuege) {
  let summe = 0;
  for (const z of zuege) {
    const mengen = [z.eingabe, z.ausgabe, z.cache5m, z.cache1h, z.cacheGelesen];
    if (mengen.every((m) => m === 0)) continue;
    const preis = preisFuer(z.modell);
    if (!preis) return null;
    const saetze = [preis.eingabe, preis.ausgabe, preis.cacheSchreiben5m, preis.cacheSchreiben1h, preis.cacheLesen];
    summe += mengen.reduce((s, menge, i) => s + (menge * saetze[i]) / 1e6, 0);
  }
  return Math.round(summe * 1e6) / 1e6 + 0;
}

/**
 * Die Mengen einer Menge Zuege im Vertragsformat — dieselbe Deutung wie
 * `nachtlaufUsage`: Eingabemenge ist alles Verarbeitete (eigene Eingabe plus beide
 * Zwischenspeicher-Mengen), der Zwischenspeicher-Anteil nur das Gelesene.
 */
function sitzungUsage(zuege) {
  const summe = (feld) => zuege.reduce((s, z) => s + z[feld], 0);
  return {
    costUsd: sitzungKosten(zuege),
    inputTokens: summe("eingabe") + summe("cache5m") + summe("cache1h") + summe("cacheGelesen"),
    outputTokens: summe("ausgabe"),
    cachedInputTokens: summe("cacheGelesen"),
  };
}

/**
 * Baut den Rumpf fuer `POST /api/kanban/night-runs`. Reine Funktion; `jetzt` bestimmt
 * die Dauer, weil fortschreibend gemeldet wird.
 *
 * Der Rest ohne Kartennummer steht NICHT als eigener Eintrag in `items` — er ergibt
 * sich als Sitzungssumme minus Summe der Karten, genau wie `verbrauchOhneEinheit`
 * beim Nachtlauf. Ein Eintrag ohne `cardNumber` waere ein neues Feld im Vertrag eines
 * fremden Dienstes; die Differenz ist dieselbe Auskunft ohne Vertragsaenderung.
 *
 * `state: GREEN` mit `errorClass: null` fuer jede Karte: Eine interaktive Sitzung
 * meldet Verbrauch, keinen Ausgang. GREY hiesse "uebersprungen" und waere falsch — an
 * der Karte wurde gearbeitet.
 */
export function sitzungMeldung({ start, zuege, unlesbar = 0, abschnitte = [], complete = false, jetzt = new Date() }) {
  const jeKarte = new Map();
  for (const z of zuege) {
    const karte = sitzungKarte(abschnitte, z.zeit);
    if (karte === null) continue;
    if (!jeKarte.has(karte)) jeKarte.set(karte, []);
    jeKarte.get(karte).push(z);
  }
  const ende = jetzt.getTime();
  const items = [...jeKarte.entries()]
    .filter(([karte]) => /^\d+$/.test(karte))
    .slice(0, NACHTLAUF_EINHEITEN_MAX)
    .map(([karte, eigene]) => ({
      cardNumber: Number(karte),
      // @NotBlank im Vertrag. Den Titel kennt der Melder nicht — ihn zu holen waere ein
      // Board-Aufruf je Karte fuer eine Angabe, die am Board ohnehin steht.
      title: `#${karte}`.slice(0, NACHTLAUF_TITEL_MAX),
      state: SITZUNG_ZUSTAND,
      errorClass: null,
      durationMs: abschnitte
        .filter((a) => a.karte === karte)
        .reduce((s, a) => s + Math.max(0, Math.min(a.bis ?? ende, ende) - a.von), 0),
      commitHash: null,
      excerpt: null,
      usage: sitzungUsage(eigene),
    }));
  const beginn = start === null ? ende : Date.parse(start);
  return {
    startedAt: start,
    kind: SITZUNG_ART,
    mode: SITZUNG_ART,
    durationMs: Math.max(0, ende - beginn),
    processedCount: items.length,
    skippedCount: 0,
    unparsedCount: unlesbar,
    complete,
    usage: sitzungUsage(zuege),
    items,
  };
}

/** Der Pfad des Protokolls: `--protokoll`, sonst `transcript_path` aus dem Hook-Rumpf. */
function sitzungProtokollPfad(args) {
  if (typeof args.protokoll === "string") return args.protokoll;
  // Ein Claude-Code-Hook reicht seinen Rumpf ueber stdin herein. Ist keine da oder
  // steht nichts Brauchbares drin, meldet der Melder nichts — er soll nie raten,
  // welches der Protokolle im Benutzerverzeichnis die laufende Sitzung ist.
  try {
    const rumpf = JSON.parse(readFileSync(0, "utf-8"));
    return typeof rumpf?.transcript_path === "string" ? rumpf.transcript_path : null;
  } catch {
    return null;
  }
}

/** Das Ergebnis eines Laufs ohne Meldung — immer Exit 0, nie ein Fehler. */
function sitzungSchweigt(grund) {
  process.stdout.write(JSON.stringify({ ok: true, gemeldet: false, grund }) + "\n");
}

/**
 * Der Stand der letzten Meldung dieser Sitzung, fuer die Drosselung. Liegt neben den
 * Wegmarken unter `.claude/`; eine fremde oder kaputte Datei zaehlt als "noch nie
 * gemeldet" — im Zweifel wird gemeldet, nicht geschwiegen.
 */
function sitzungStandLesen(start) {
  try {
    const stand = JSON.parse(readFileSync(resolve(".claude", SITZUNG_STAND_DATEI), "utf-8"));
    return stand?.sitzung === start ? Date.parse(stand.zuletzt) : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/**
 * Verbucht eine gelungene Meldung: Zwischenmeldung -> Zeitpunkt merken (Drosselung),
 * Sitzungsende -> Wegmarken leeren und den Stand wegraeumen.
 *
 * Geleert, nicht geloescht: Die Datei ist der Ort, an den `issue move` anhaengt, und
 * sie zu entfernen hiesse, das naechste Anhaengen auf `mkdir` zurueckzuwerfen.
 * Scheitert das Schreiben, bleibt es beim Hinweis — die Meldung ist raus, und daran
 * aendert eine klemmende Datei nichts mehr.
 */
function sitzungVerbuchen(start, complete, jetzt) {
  const stand = resolve(".claude", SITZUNG_STAND_DATEI);
  try {
    mkdirSync(dirname(stand), { recursive: true });
    if (complete) {
      writeFileSync(resolve(".claude", WEGMARKEN_DATEI), "", "utf-8");
      writeFileSync(stand, JSON.stringify({ sitzung: start, zuletzt: null }) + "\n", "utf-8");
    } else {
      writeFileSync(stand, JSON.stringify({ sitzung: start, zuletzt: jetzt.toISOString() }) + "\n", "utf-8");
    }
  } catch (e) {
    process.stderr.write(`Hinweis: Sitzungs-Stand nicht geschrieben (${stand}): ${e.message}\n`);
  }
}

/**
 * `sitzung melden` — der Verbrauch der laufenden Sitzung ans Board (Issue #734).
 *
 * Jeder Grund zu schweigen endet mit Exit 0 und ohne HTTP-Aufruf. Der Melder laeuft
 * an einem Hook und darf eine Sitzung niemals stoeren: Er ist Buchhaltung, keine
 * Bedingung — dieselbe Haltung wie bei `wegmarkeSchreiben`.
 *
 * Die Reihenfolge der Pruefungen ist bindend. KIT_AGENT_MODEL steht ganz vorn, VOR
 * jedem Config- und Dateizugriff: Nachts ist diese Sitzung bereits in der Meldung des
 * Runners enthalten (E15), und ein Melder, der erst die Config liest, koennte an ihr
 * scheitern statt zu schweigen.
 */
async function sitzungMelden(args) {
  if (agentModelHeader()["X-Agent-Model"]) return sitzungSchweigt("nachtbetrieb");

  const config = readWorkflowConfig();
  if (config?.issueTracker !== "toolbox") return sitzungSchweigt("kein-board");
  // E3: Ohne projektgebundenes Token gibt es kein Zielprojekt — und es wird auch
  // keines aus dem Aufruf geraten. Die Bindung des Tokens bestimmt, wohin gemeldet wird.
  try {
    resolveToolboxToken({ cfg: config, env: process.env, readFile: (p) => readFileSync(p, "utf-8") });
  } catch {
    return sitzungSchweigt("kein-token");
  }

  const pfad = sitzungProtokollPfad(args);
  if (!pfad) return sitzungSchweigt("kein-protokoll");
  let protokoll;
  try {
    protokoll = sitzungProtokoll(readFileSync(pfad, "utf-8"));
  } catch {
    return sitzungSchweigt("protokoll-nicht-lesbar");
  }
  if (protokoll.zuege.length === 0) return sitzungSchweigt("nichts-gemessen");

  // E16: Das Sitzungsende meldet immer. Dazwischen hoechstens einmal je fuenf Minuten —
  // nur am Ende zu melden verloere jede abgestuerzte Sitzung, ungedrosselt erzeugte
  // jeder Zug einen HTTP-Aufruf.
  const complete = args.complete === true;
  const jetzt = new Date();
  const zuletzt = sitzungStandLesen(protokoll.start);
  if (!complete && Number.isFinite(zuletzt) && jetzt.getTime() - zuletzt < SITZUNG_DROSSEL_MS) {
    return sitzungSchweigt("gedrosselt");
  }

  let wegmarken = "";
  try { wegmarken = readFileSync(resolve(".claude", WEGMARKEN_DATEI), "utf-8"); } catch { /* keine Wegmarke: alles Rest */ }
  const meldung = sitzungMeldung({
    ...protokoll,
    abschnitte: wegmarkenAbschnitte(wegmarken),
    complete,
    jetzt,
  });

  let antwort = null;
  try {
    const res = await new ToolboxIssueTracker(config)._fetch("/api/kanban/night-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meldung),
    });
    try { antwort = await res.json(); } catch { /* kein JSON-Rumpf */ }
  } catch (e) {
    // Nicht eingeliefert heisst nicht verbucht: Weder wird gedrosselt noch werden die
    // Wegmarken geleert — der naechste Versuch soll denselben Abschnitt noch sehen.
    process.stderr.write(`Hinweis: Sitzungs-Meldung nicht eingeliefert: ${e.message}\n`);
    return sitzungSchweigt("nicht-eingeliefert");
  }
  sitzungVerbuchen(protokoll.start, complete, jetzt);
  process.stdout.write(JSON.stringify({
    ok: true, gemeldet: true, complete, karten: meldung.items.length, outcome: antwort?.outcome ?? null,
  }) + "\n");
}

async function dispatchSitzung(command, args) {
  if (command === "melden") return sitzungMelden(args);
  process.stdout.write(HELP);
  fail(`Unbekannter sitzung-Befehl: '${command}'`);
}

// ============================================================
// Hook gegen Pipe und Umleitung hinter ausgenommenen Kommandos (Issue #995)
// ============================================================
//
// Seit Claude Code 2.1.277 nimmt `sandbox.excludedCommands` eine zusammengesetzte
// Zeile nur noch aus der Sandbox, wenn JEDER Teil zu einem Eintrag passt. Ein
// `node .claude/kit/board.mjs … | head` laeuft darum ganz in der Sandbox — ohne Netz,
// samt dem codex, das board.mjs startet (Nachtlauf 2026-09-28, Issue #986). Eine
// Eingabeumleitung (`codex exec … < datei`) hebt die Ausnahme ebenfalls auf, auch
// wenn sonst nichts in der Zeile steht. Der Hook weist solche Zeilen ab, bevor sie
// laufen, und nennt die richtige Form.
//
// Die Muster kommen zur Laufzeit aus den Settings des Projekts, nicht aus einer festen
// Liste: Genau diese Eintraege verlieren ihre Wirkung, auch fremde wie `mvn *`.

/** Ein Muster aus `excludedCommands` als RegExp: `*` steht fuer einen beliebigen Rest. */
function bashMusterRegex(muster) {
  const quelle = muster.split("*").map((s) => s.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join(".*");
  return new RegExp(`^${quelle}$`, "s");
}

// Ein Umlenken auf einen anderen Dateideskriptor (`2>&1`, `>&2`, `<&0`) — kein Dateiziel.
const BASH_FD_DUPLIKAT = /^[<>]&(\d+|-)/;
// Eine Umleitung in oder aus einer Datei, laengste Form zuerst.
const BASH_UMLEITUNG = /^(&>>|&>|<<-|<<|>>|>\||<|>)/;
// Zeichen, an denen das Wort hinter einer Umleitung (ihr Ziel) endet.
const BASH_OPERATOR_ZEICHEN = "|;&<>\n";

/**
 * Zerlegt eine Bash-Zeile in ihre Befehle und merkt, ob sie in eine Datei oder aus
 * einer Datei umleitet. Operatoren zaehlen nur ausserhalb von Anfuehrungszeichen und
 * nicht hinter einem Backslash — `--text "a > b"` ist Text, kein Operator.
 *
 * Bewusst keine vollstaendige Shell: Befehlsersetzung (`$(…)`, Backticks) bleibt Teil
 * des Wortes. Im Zweifel faellt die Zeile damit nicht auf; abgewiesen wird nur, was
 * an der Oberflaeche sichtbar ist.
 */
class BashZerleger {
  constructor(zeile) {
    this.zeile = zeile;
    this.pos = 0;
    this.teile = [];
    this.aktuell = "";
    this.quote = null;
    this.umleitung = false;
    // Das Wort hinter einer Umleitung ist ihr Ziel, kein Argument des Befehls:
    // null (kein Ziel offen), "davor" (Leerraum vor dem Ziel), "drin" (im Ziel).
    this.ziel = null;
  }

  zerlege() {
    while (this.pos < this.zeile.length) this.schritt(this.zeile[this.pos]);
    this.schliessen();
    return { teile: this.teile.filter((t) => t.length > 0), umleitung: this.umleitung };
  }

  schreibe(text) {
    if (this.ziel) this.ziel = "drin";
    else this.aktuell += text;
    this.pos += text.length;
  }

  schliessen() {
    this.teile.push(this.aktuell.trim());
    this.aktuell = "";
    this.ziel = null;
  }

  schritt(c) {
    if (this.quote) return this.inAnfuehrung(c);
    if (c === "\\") return this.schreibe(this.zeile.slice(this.pos, this.pos + 2));
    if (c === "'" || c === '"') { this.quote = c; return this.schreibe(c); }
    if (this.imZiel(c)) { this.pos++; return; }
    if (this.trenner(c) || this.umlenkung()) return;
    this.aktuell += c;
    this.pos++;
  }

  inAnfuehrung(c) {
    if (c === "\\" && this.quote === '"') return this.schreibe(this.zeile.slice(this.pos, this.pos + 2));
    if (c === this.quote) this.quote = null;
    this.schreibe(c);
  }

  /** Verbraucht Zeichen des Umleitungsziels; `false`, wenn keines offen ist oder es endet. */
  imZiel(c) {
    if (!this.ziel) return false;
    if (c !== "\n" && /\s/.test(c)) {
      if (this.ziel === "drin") { this.ziel = null; this.aktuell += " "; }
      return true;
    }
    if (!BASH_OPERATOR_ZEICHEN.includes(c)) { this.ziel = "drin"; return true; }
    this.ziel = null;
    return false;
  }

  /** `|`, `||`, `|&`, `&&`, `&`, `;`, Zeilenumbruch: Ende eines Befehls. */
  trenner(c) {
    const zwei = this.zeile.slice(this.pos, this.pos + 2);
    let laenge = 0;
    if (zwei === "&&" || zwei === "||" || zwei === "|&") laenge = 2;
    else if ("\n;|".includes(c) || (c === "&" && zwei !== "&>")) laenge = 1;
    if (laenge === 0) return false;
    this.schliessen();
    this.pos += laenge;
    return true;
  }

  umlenkung() {
    const rest = this.zeile.slice(this.pos);
    const dup = BASH_FD_DUPLIKAT.exec(rest);
    if (dup) {
      this.aktuell += dup[0];
      this.pos += dup[0].length;
      return true;
    }
    const um = BASH_UMLEITUNG.exec(rest);
    if (!um) return false;
    this.umleitung = true;
    // Die Nummer des umgeleiteten Deskriptors (`2>/dev/null`) gehoert zur Umleitung.
    this.aktuell = this.aktuell.replace(/(^|\s)\d+$/, "$1");
    this.ziel = "davor";
    this.pos += um[0].length;
    return true;
  }
}

/**
 * Weist eine Bash-Zeile ab, wenn ein Teil davon zu einem Muster aus
 * `sandbox.excludedCommands` passt, die Zeile die Ausnahme aber wieder aufhebt:
 * durch eine Umleitung in oder aus einer Datei, oder durch eine Pipe bzw. einen
 * weiteren Befehl (`&&`, `||`, `;`, Zeilenumbruch), dessen Teile nicht alle passen.
 *
 * MESSUNG zu `2>&1` (Claude Code 2.1.283, 2026-09-29, interaktive Session im
 * Auto-Modus mit aktiver Projekt-Sandbox dieses Repos; als Probe diente
 * `node .claude/kit/board.mjs issue get <n>`, ausgenommen und auf das Netz
 * angewiesen — in der Sandbox scheitert es mit "fetch failed"):
 *   - ohne Umleitung:  Board erreicht, laeuft ausserhalb der Sandbox.
 *   - mit `2>&1`:      Board erreicht, die Ausnahme bleibt bestehen.
 *   - mit `2>/dev/null`: nicht gemessen (die Messung wurde vom Auto-Modus
 *                      abgelehnt); faellt als Umleitung in eine Datei unter die
 *                      Grundregel und wird abgewiesen.
 * Die im Arbeitspaket vorgesehene headless Session (`claude -p`) wurde vom
 * Auto-Modus als neuer Agent abgelehnt; die Sandbox-Entscheidung liegt aber in
 * derselben Claude-Code-Fassung. Darum bleibt ein reines Umlenken auf einen anderen
 * Deskriptor (`2>&1`, `>&2`) erlaubt.
 *
 * @param {string} zeile  die Bash-Zeile aus `tool_input.command`
 * @param {string[]} muster  die Eintraege aus `excludedCommands`
 * @returns {{ abweisen: boolean, grund: string|null }}
 */
export function pruefeBashZeile(zeile, muster) {
  const erlaubt = { abweisen: false, grund: null };
  if (typeof zeile !== "string" || !Array.isArray(muster) || muster.length === 0) return erlaubt;
  const regexe = muster.filter((m) => typeof m === "string" && m.trim()).map((m) => [m, bashMusterRegex(m.trim())]);
  const { teile, umleitung } = new BashZerleger(zeile).zerlege();
  const passend = (teil) => regexe.find(([, re]) => re.test(teil))?.[0];

  const treffer = teile.map(passend);
  const erstes = treffer.find(Boolean);
  if (!erstes) return erlaubt;
  if (!umleitung && treffer.every(Boolean)) return erlaubt;

  return {
    abweisen: true,
    grund: `Abgewiesen: "${erstes}" steht in sandbox.excludedCommands, aber eine Pipe, eine Umleitung `
      + "oder ein weiterer Befehl in derselben Zeile hebt diese Ausnahme auf (seit Claude Code 2.1.277) — "
      + "der Aufruf liefe in der Sandbox, ohne Netz. Richtige Form: das Kommando allein aufrufen, ohne Pipe, "
      + "Umleitung und Folgebefehl (2>&1 ist erlaubt). Eine grosse Ausgabe legt Claude Code selbst in einer "
      + "Datei ab; die filtert ein zweiter Aufruf.",
  };
}

/**
 * Hintergrundarbeit ohne Aufsicht (Issue #1081): Eine headless Session hat keinen
 * Folge-Zug. Startet sie einen Bash-Aufruf mit `run_in_background` und beendet dann ihren
 * Zug, ist die Sitzung zu Ende und das Ergebnis verloren — in der Nacht zum 30.09.2026 bei
 * #1065, obwohl die Regel im Skilltext stand (#668, #754, #983). Unbeaufsichtigt heisst wie
 * ueberall im Kit: `KIT_AGENT_MODEL` ist gesetzt. Interaktiv bleibt Hintergrundarbeit
 * erlaubt, dort gibt es den Folge-Zug.
 */
export function pruefeHintergrund(toolInput, env = process.env) {
  const unbeaufsichtigt = typeof env.KIT_AGENT_MODEL === "string" && env.KIT_AGENT_MODEL.trim() !== "";
  if (!unbeaufsichtigt || toolInput?.run_in_background !== true) return { abweisen: false, grund: null };
  return {
    abweisen: true,
    grund: "Abgewiesen: run_in_background ist ohne Aufsicht gesperrt (KIT_AGENT_MODEL gesetzt). Eine "
      + "unbeaufsichtigte Session hat keinen Folge-Zug — beendet sie ihren Zug, waehrend der Befehl "
      + "noch laeuft, ist die Sitzung zu Ende und sein Ergebnis verloren. Richtige Form: denselben "
      + "Befehl im Vordergrund aufrufen und auf ihn warten; das Bash-Zeitlimit der Session reicht "
      + "bis knapp unter das Rundenlimit (Issue #668).",
  };
}

/** Die Muster aus `sandbox.excludedCommands` und `sandbox.network.excludedCommands` einer Settings-Datei. */
function bashMusterAus(pfad) {
  if (!existsSync(pfad)) return [];
  const settings = JSON.parse(readFileSync(pfad, "utf-8"));
  const sandbox = settings?.sandbox ?? {};
  return [sandbox.excludedCommands, sandbox.network?.excludedCommands].flatMap((l) => (Array.isArray(l) ? l : []));
}

/**
 * `hook bash-pruefen` — PreToolUse-Hook von Claude Code. Exit 2 mit Begruendung auf
 * stderr weist den Aufruf ab; bei eigenem Fehler laesst der Hook durch (Exit 0, eine
 * Zeile auf stderr): Ein kaputter Hook darf nicht jede Bash-Zeile einer Session sperren.
 */
function hookBashPruefen() {
  const durchlassen = (warum) => { process.stderr.write(`board.mjs hook bash-pruefen: ${warum} — Aufruf durchgelassen\n`); };
  let eingabe;
  try {
    eingabe = JSON.parse(readFileSync(0, "utf-8"));
  } catch (e) {
    return durchlassen(`Eingabe nicht lesbar (${e.message})`);
  }
  if (eingabe?.tool_name !== "Bash" || typeof eingabe?.tool_input?.command !== "string") return;
  const hintergrund = pruefeHintergrund(eingabe.tool_input);
  if (hintergrund.abweisen) {
    process.stderr.write(hintergrund.grund + "\n");
    process.exitCode = 2;
    return;
  }

  const wurzel = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const muster = [];
  for (const datei of ["settings.json", "settings.local.json"]) {
    const pfad = join(wurzel, ".claude", datei);
    try {
      muster.push(...bashMusterAus(pfad));
    } catch (e) {
      return durchlassen(`${pfad} nicht lesbar (${e.message})`);
    }
  }
  const ergebnis = pruefeBashZeile(eingabe.tool_input.command, [...new Set(muster)]);
  if (ergebnis.abweisen) {
    process.stderr.write(ergebnis.grund + "\n");
    process.exitCode = 2;
  }
}

async function dispatchHook(command) {
  if (command === "bash-pruefen") return hookBashPruefen();
  process.stdout.write(HELP);
  fail(`Unbekannter hook-Befehl: '${command}'`);
}

async function dispatchKontext(command, args) {
  switch (command) {
    case "paths": return kontextPaths(args);
    case "last-log": return kontextLastLog(args);
    default:
      process.stdout.write(HELP);
      fail(`Unbekannter kontext-Befehl: '${command}'`);
  }
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

async function main() {
  const argv = process.argv.slice(2);

  // Hinter einem Proxy (Sandbox von Claude Code) erreicht Nodes fetch das Board nur mit
  // NODE_USE_ENV_PROXY=1 beim Start (Issue #998). Hilfe und --version brauchen kein
  // Netz und sind darum schon beantwortet (auskunftOhneTeile).
  if (proxyNeustartNoetig(process.env)) {
    const kind = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    });
    process.exit(kind.status ?? 1);
  }

  const [axis, command, ...rest] = argv;
  const args = parseArgs(rest);

  if (axis === "issue") {
    await dispatchIssue(command, args);
  } else if (axis === "code") {
    await dispatchCode(command, args);
  } else if (axis === "issue-review") {
    await dispatchIssueReview(command, args);
  } else if (axis === "kontext") {
    await dispatchKontext(command, args);
  } else if (axis === "nightrun") {
    await dispatchNightrun(command, args);
  } else if (axis === "sitzung") {
    await dispatchSitzung(command, args);
  } else if (axis === "hook") {
    await dispatchHook(command);
  } else {
    process.stdout.write(HELP);
    fail(`Unbekannte Achse: '${axis}'. Erwartet: issue | code | kontext | issue-review | nightrun | sitzung | hook`);
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
    const prefix = err instanceof BoardError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}

