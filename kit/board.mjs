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

import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
// Einstieg fuer Dispatch und Formpruefung; exportiert waren sie nie und bleiben es nicht.
const { KONTEXT_DEFAULTS, loadKontextConfig, kontextRepoName, heute, normalisiereZeilenenden, issueCreate,
  issueGet, issueList, issueEpics, issueActivity, issueMove, issueLabel,
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
export const { nachtlaufAbbruchGrund, nachtlaufMeldung, sitzungProtokoll, wegmarkenAbschnitte,
  sitzungMeldung } = await import("./board/melder.mjs");
// Die Befehlsverteiler der beiden Melder braucht nur Dispatch; exportiert waren sie nie.
const { dispatchNightrun, dispatchSitzung } = await import("./board/melder.mjs");

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
    await dispatchNightrun(command, args, HELP);
  } else if (axis === "sitzung") {
    await dispatchSitzung(command, args, HELP);
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

