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
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

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
  issueComment, issueMelden, issueStand, issueAuftrag, issueUpdate, CHECK_FORM_WEGE,
  zerlegeAbschnitte } = await import("./board/dokumente.mjs");
export const { GESCHUETZTE_PFADE, KOPIE_PFADE, geschuetztePfade, trifftGeschuetzt, pfadTokens, tokenFormen,
  geschuetzteTreffer, GESCHUETZT_ANKER, GESCHUETZT_LABEL, GESCHUETZT_LABEL_GESETZT, GESCHUETZT_LABEL_NICHT_GESETZT,
  GESCHUETZT_ABGEWIESEN, abgewieseneTreffer, geschuetztKommentar, geschuetztFreigabe } = await import("./board/geschuetzt.mjs");
// Die Formgates der Stufen braucht `pruefeForm`; exportiert waren sie nie und bleiben es nicht.
const { pruefeFachlich, pruefePlan, pruefeIssue } = await import("./board/geschuetzt.mjs");
export const { TEST_ABLAGEN_VORGABE, testAblagen, ablageAlsAusdruck, nennungsVerzeichnis, genannteDateien,
  pruefeTestNennung } = await import("./board/testhinweise.mjs");
// Den Bestand fuer `issue check-form` braucht nur der Einstieg; exportiert war er nie.
const { versionierteDateien } = await import("./board/testhinweise.mjs");
export const { pickReviewers, kommandoVerfuegbar, stufeAusTitel } = await import("./board/issue-review.mjs");
// Den Befehlsverteiler der Achse braucht nur Dispatch; exportiert war er nie.
const { dispatchIssueReview } = await import("./board/issue-review.mjs");

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
    dispatchIssueReview(command, args, HELP);
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

