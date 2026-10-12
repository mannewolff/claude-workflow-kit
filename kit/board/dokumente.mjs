/**
 * board/dokumente.mjs — Form und Inhalt der Karten im Board-Werkzeug (Issue #1218, Plan #1199,
 * E17): Dokument-Praefixe im Titel, Pruefvorgabe am Ticket samt Fence-Auslegung, Kit-Stand-Zeile,
 * Laufstand einer Karte, Auftrag einer Umsetzung, die Abschnittszerlegung von check-form und die
 * Kontext-Achse — dazu die Autor-Modell-Zeile, die `issue create` sicherstellt.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus. Was er aus noch nicht ausgelagerten Abschnitten des Einstiegs braucht — die
 * Erkennung geschuetzter Dateien fuer das Urteil des Auftrags und den Hilfetext fuer
 * `issue label` —, reicht ihm der Einstieg beim Aufruf herein.
 *
 * Der Nacht-Runner laedt diesen Teil als Nachbarn ueber einen nicht literalen Pfad
 * (NACHBAR_DIR, #498) fuer `fenceLauf`. Die Importanalyse sieht das nicht; die Kopplung
 * steht darum von Hand in den `areas` der Pruefkommandos (E3).
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, rmSync, rmdirSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { VALID_STATUSES, COLUMN_DEFAULTS, columnLabels, BoardError, fail, out, configWurzel,
  readWorkflowConfig } from "./grundlagen.mjs";
import { GitHubIssueTracker, resolveCodeHost, LabelFehltError } from "./adapter.mjs";
// Zyklus mit Absicht: ursprung.mjs liest Karten und Herkunftszeilen von hier. Beide Seiten
// rufen sich erst zur Laufzeit, keine liest beim Laden einen Wert der anderen.
import { ursprungLesen, ursprungNachziehen } from "./ursprung.mjs";
import { SPRACHEN, PRAEFIXE, LABELS, prozessSprache, praefix, labelName, erkennePraefix, erkenneLabel, erkenneMarker, leseMarker, markerWerte,
  kanonischeUeberschrift, ueberschriftName, ueberschriftZeile, text } from "./namen.mjs";
import { normalisiereConfig } from "./config-namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-dokumente.mjs (Issue #1526).
import { TEXTE } from "../texte/board-dokumente.mjs";

export { TEXTE };

/** Ein Text dieses Teils in der Projektsprache (Issue #1478, E13). */
const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

// ============================================================
// Kontext-Achse (Vault-Pfade fuer /kontext und /document, Issue #202)
// ============================================================

// Die Zielpfade im Memory-Vault entstehen hier in Code statt als Prosa im Skill-Prompt.
// Grund: Teilen sich mehrere Service-Repos einen Vault, schrieben bisher alle in dieselbe
// Tageslog-Datei — in einem Nextcloud-Vault ein Sync-Konflikt, bei parallelen Sessions ein
// ueberschriebener Abschnitt. Und ein stiller Pfadfehler faellt bei einem Skill, der einmal
// pro Session laeuft, erst Wochen spaeter auf: genau die Fehlerklasse, fuer die das
// Leitplanken-Prinzip (Issue #122) ein Gate statt einer Formulierung verlangt.

export const KONTEXT_DEFAULTS = {
  logPath: "Log/{date}.md",
  projectDocs: ["CLAUDE-*", ".claude/CLAUDE-*"],
};

const KNOWN_CODE_HOSTS = new Set(["github", "gitlab", "local"]);

/**
 * Feldweiser Merge der beiden kontext.config.json, lokale Felder gewinnen. Fehlende
 * Datei = leeres Objekt, kein Fehler.
 *
 * Bewusst Merge und nicht "erstes gefundenes gewinnt": Der Multi-Repo-Fall braucht eine
 * lokale Config, die nur `project`/`parentProject` setzt und `vault` von global erbt —
 * bei "erstes gewinnt" waere der Vault-Pfad verloren.
 */
export function mergeKontextConfig(globalCfg, localCfg) {
  return { ...globalCfg, ...localCfg };
}

/**
 * Berechnet die Zielpfade im Vault. Reine Funktion ohne Dateisystem-Zugriff — Projektname
 * und Datum kommen von aussen (das --date-Flag ist die Testbarkeits-Naht, ohne es waere
 * jeder Erwartungswert datumsabhaengig).
 *
 * Ohne `vault` ist das Ergebnis mode "degraded" statt eines Fehlers: /kontext und
 * /document haben dafuer einen dokumentierten Modus ohne persistentes Memory.
 */
export function resolveKontextPaths({ cfg = {}, project, date, projectNoteFile = null, parentNoteFile = null }) {
  const projectName = project || cfg.project || "";
  const parentProject = cfg.parentProject || null;
  // projectDocs sind Glob-Muster relativ zum PROJEKT-Verzeichnis, keine Vault-Pfade:
  // Sie werden unveraendert durchgereicht und gelten auch im Degraded Mode.
  const projectDocs = cfg.projectDocs || KONTEXT_DEFAULTS.projectDocs;
  const vault = cfg.vault || null;

  if (!vault) {
    return {
      mode: "degraded", vault: null, project: projectName, parentProject,
      log: null, projectNote: null, parentNote: null, always: [], projectDocs,
    };
  }

  // Ein logPath ohne {project} wird nicht stillschweigend um den Projektnamen ergaenzt,
  // auch nicht bei gesetztem parentProject: Der Wert ist eine Entscheidung des Nutzers.
  const logPath = cfg.logPath || KONTEXT_DEFAULTS.logPath;
  // Ohne parentProject liegt die Notiz wie bisher in ihrem eigenen Ordner; mit ihm
  // sammeln sich die Service-Notizen im Ordner des Dach-Projekts.
  const notizOrdner = parentProject || projectName;
  return {
    mode: "full",
    vault,
    project: projectName,
    parentProject,
    log: join(vault, logPath.replaceAll("{date}", date).replaceAll("{project}", projectName)),
    // Ohne uebergebenen Dateinamen bleibt es beim konstruierten — das ist der Fall
    // der Erstanlage und zugleich die Form, in der diese Funktion ohne Vault
    // aufrufbar bleibt (Issue #286).
    projectNote: join(vault, "Projekte", notizOrdner, projectNoteFile || `${projectName}.md`),
    parentNote: parentProject
      ? join(vault, "Projekte", parentProject, parentNoteFile || `${parentProject}.md`)
      : null,
    always: (cfg.always || []).map((datei) => join(vault, datei)),
    projectDocs,
  };
}

/**
 * Waehlt aus den Dateinamen eines Notizordners den tatsaechlichen Namen der Notiz
 * (Issue #286). Reine Funktion ueber Namen — der Dateisystem-Zugriff liegt im
 * Wrapper, wie bei pickLatestLog/kontextLastLog.
 *
 * Der Vault gibt die Schreibweise vor, nicht der Repo-Name: Ein Ordner
 * `Projekte/shell-app/` mit der Notiz `Shell-App.md` ist gewachsene Konvention, und
 * Projekte sollen ihre Ablage nicht nach dem Werkzeug umbenennen muessen. Auf einem
 * case-insensitiven Dateisystem faellt der Unterschied nicht auf; auf einem
 * case-sensitiven legt /document eine ZWEITE Notiz an, und ab da laeuft die Historie
 * doppelt weiter, ohne dass ein Schreibvorgang fehlschlaegt.
 *
 * Vier Ausgaenge:
 *   1. genau eine .md im Ordner            -> ihr Name (siehe `alleinstehend`)
 *   2. keine oder keine passende .md       -> null (Erstanlage, konstruierter Pfad)
 *   3. genau ein case-insensitiver Treffer -> dessen Name
 *   4. mehrere Treffer                     -> kollision, der Aufrufer bricht ab
 *
 * `alleinstehend: false` schaltet Regel 1 ab. Im Multi-Repo-Fall teilen sich
 * Dach- und Service-Notiz EIN Verzeichnis; dort wuerde "die einzige Datei ist es"
 * beide auf dieselbe Datei zeigen lassen — und /document schriebe den Stand des
 * einen Service in die Notiz des Gesamtsystems.
 */
export function pickNoteFile(fileNames, notizName, { alleinstehend = true } = {}) {
  const leer = { name: null, kollision: null };
  const mds = (fileNames || []).filter((n) => n.toLowerCase().endsWith(".md"));
  if (mds.length === 0) return leer;
  if (mds.length === 1 && alleinstehend) return { name: mds[0], kollision: null };

  const ziel = notizName.toLowerCase();
  const treffer = mds.filter((n) => n.toLowerCase() === ziel);
  if (treffer.length === 0) return leer;
  if (treffer.length === 1) return { name: treffer[0], kollision: null };
  return { name: null, kollision: treffer };
}

/** Ein Datum ist nur gueltig, wenn es den Tag auch wirklich gibt: 2026-13-99 nicht. */
function istTagesdatum(wert) {
  const d = new Date(`${wert}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === wert;
}

const REGEX_SONDERZEICHEN = /[.*+?^${}()|[\]\\]/g;

/**
 * Waehlt aus einer Liste von Dateinamen den juengsten Log-Eintrag desselben Projekts.
 * Reine Funktion ueber Namen — kein Dateisystem, damit die Randfaelle pruefbar sind.
 *
 * Das `logPath`-Template wird zum Suchmuster: {date} wird zum Datums-Platzhalter,
 * {project} woertlich zum Projektnamen. Gesucht wird also nie "der juengste Eintrag
 * ueberhaupt" — im Multi-Repo-Fall liegen die Eintraege aller Services im selben
 * Ordner, und der juengste fremde waere die falsche Anknuepfung (Issue #205).
 *
 * `before` grenzt auf Eintraege davor ein. Ohne den Wert laese eine zweite Session am
 * selben Tag sich selbst als Vorgaenger.
 */
export function pickLatestLog(fileNames, { template, project = "", before = null } = {}) {
  const muster = (template || KONTEXT_DEFAULTS.logPath).split("/").pop();
  // Split mit Capture-Group behaelt die Platzhalter als eigene Stuecke: So wird nur der
  // Literaltext escaped, und ein Punkt im Projektnamen bleibt ein Punkt.
  const quelle = muster
    .split(/(\{date\}|\{project\})/)
    .map((teil) => {
      if (teil === "{date}") return String.raw`(\d{4}-\d{2}-\d{2})`;
      const literal = teil === "{project}" ? project : teil;
      return literal.replaceAll(REGEX_SONDERZEICHEN, String.raw`\$&`);
    })
    .join("");
  const regex = new RegExp(`^${quelle}$`);

  let treffer = null;
  for (const name of fileNames) {
    const m = regex.exec(name);
    if (!m || !istTagesdatum(m[1])) continue;
    if (before && m[1] >= before) continue;
    // Bei JJJJ-MM-TT ist lexikografisch identisch mit chronologisch.
    if (!treffer || m[1] > treffer.date) treffer = { name, date: m[1] };
  }
  return treffer;
}

function readKontextConfigFile(pfad) {
  if (!existsSync(pfad)) return {};
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    fail(t("kontextConfigUnlesbar", { pfad }));
  }
}

// Eigene Suche statt loadConfig(): Das ist kontext.config.json, nicht
// workflow.config.json. Home ueber homedir() und nicht ueber HOME — homedir() findet das
// Heimatverzeichnis auch ohne gesetztes HOME (Issue #187).
export function loadKontextConfig() {
  return mergeKontextConfig(
    readKontextConfigFile(join(homedir(), ".claude", "kontext.config.json")),
    readKontextConfigFile(resolve(".claude", "kontext.config.json"))
  );
}

// Letzte Stufe der Projektnamen-Praezedenz. Bewusst weich: board.mjs ist ein kopierbares
// Single-File-Tool und muss `kontext paths` auch in einem Projekt beantworten, das keine
// workflow.config.json (und damit keinen Code-Host) hat — dort ist der Verzeichnisname
// die beste verfuegbare Auskunft. resolveCodeHost() wuerde bei unbekanntem Wert hart
// abbrechen, deshalb die Pruefung davor.
export async function kontextRepoName() {
  const config = readWorkflowConfig();
  if (!config || !KNOWN_CODE_HOSTS.has(config.codeHost)) return basename(resolve("."));
  const repoName = await resolveCodeHost(config).getRepoName();
  return repoName.replace(/\.git$/, "").split("/").pop();
}

// Tagesdatum lokal statt per toISOString(): Eine Session um 23:30 MESZ gehoert ins Log
// von heute, nicht in das von morgen — in UTC waere der Tag da schon gewechselt.
export function heute() {
  const jetzt = new Date();
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}`;
}

// ============================================================
// Autor-Modell-Zeile (Issue #266)
// ============================================================

// Die Autor-Modell-Zeile im Kontext-Abschnitt (Issue #266).
//
// Sie ist die einzige Stelle im System, an der sichtbar wird, WELCHES MODELL einen
// Issue-Text formuliert hat. Der Tracker kann das nicht: `gh issue view` liefert
// fuer jedes Issue den Token-Inhaber als `author`, egal wer geschrieben hat.
// `/issue-review` waehlt anhand dieser Zeile die Pruefer, damit der Autor nicht sein
// eigenes Issue prueft — fehlt sie, fragt der Skill nach, und nachts antwortet
// niemand (belegt am 2026-08-08: Issue #247 kostete so einen Nacht-Slot).
//
// Bis hierher war die Zeile eine Bitte im /issues-Skill. Eine Bitte wird unter Druck
// uebersprungen; dieselbe Lehre wie beim Leitplanken-Prinzip in /local-check.
//
// `(\S(?:[^\n]*\S)?)` statt `(\S[^\n]*?)` mit nachfolgendem `[^\S\n]*$`
// (S8786, Issue #406): Die fruehere Fassung liess die Aufteilung offen — das
// lazy `[^\n]*?` und das folgende `[^\S\n]*` akzeptieren beide Leerzeichen,
// also probierte die Engine jede Grenze zwischen Wert und Leerraum durch.
// Gemessen mit `Autor-Modell: x`, 256 KiB Leerzeichen und einem Zeichen
// dahinter: 61,6 s vorher, 0,2 ms danach.
//
// Der Capture bleibt derselbe: erstes bis letztes Nicht-Leerzeichen der Zeile,
// innen liegender Leerraum inklusive. Jetzt sagt die Form das aber selbst —
// greedy bis zum letzten `\S` —, statt es der Engine zu ueberlassen.
//
// Dass die Messung hier ueberhaupt etwas fand, lag an der Eingabe: Das Ticket
// stufte den Ausdruck nach einem Text als linear ein, bei dem die Zeile sauber
// endet. Erst ein Text, dessen PRAEFIX passt und dessen Rest scheitert, loest
// das Backtracking aus.
//
// Seit Issue #1443 liest `autorModellSicherstellen` die Zeile ueber das Register unter beiden
// Namen; der Ausdruck bleibt als exportierte Form der deutschen Zeile.
export const AUTOR_MODELL_ZEILE = /^Autor-Modell:[^\S\n]*(\S(?:[^\n]*\S)?)[^\S\n]*$/m;

/** Die erste Zeile `## Kontext` (oder `## Context`) mit Zeilenende: `{ ende }` hinter ihr, sonst null. */
function kontextKopf(body) {
  let offset = 0;
  for (const zeile of body.split("\n")) {
    const naechste = offset + zeile.length + 1;
    if (naechste > body.length) return null; // die letzte Zeile ohne Umbruch zaehlte nie
    if (erkenneMarker(zeile) === "kontext" && zeile.startsWith("## ")) return { ende: naechste };
    offset = naechste;
  }
  return null;
}

/**
 * Liefert den Body mit garantierter Autor-Modell-Zeile — oder bricht ab.
 *
 * Reihenfolge: vorhandene Zeile gewinnt, sonst --author-model, sonst
 * KIT_AGENT_MODEL. Widersprechen sich Zeile und Flag, ist das ein Fehler und kein
 * stilles Ueberschreiben: Wer eine Autorschaft ueberschreibt, faelscht sie.
 */
export function autorModellSicherstellen(body, flagWert, env = process.env) {
  // Die Zeile unter beiden Namen ueber das Register (Issue #1443); der Wert reicht wie bei
  // AUTOR_MODELL_ZEILE vom ersten bis zum letzten Nicht-Leerzeichen.
  const vorhanden = markerWerte(body, "autorModell", { eingerueckt: false }).map((w) => w.trim()).find((w) => w !== "");
  const flag = typeof flagWert === "string" ? flagWert.trim() : "";
  if (vorhanden) {
    if (flag && flag !== vorhanden) {
      fail(t("autorModellWiderspruch", { flag, vorhanden }));
    }
    return body;
  }
  const wert = flag || (env.KIT_AGENT_MODEL || "").trim();
  if (!wert) fail(t("autorModellFehlt"));

  // Ans Ende des Kontext-Abschnitts, nicht ans Dateiende: Dort suchen der
  // /issues-Skill und /issue-review sie. Ohne Kontext-Abschnitt (Ideen, fremde
  // Formate) kommt sie an den Anfang — Hauptsache, sie ist da und auffindbar.
  const kontext = kontextKopf(body);
  if (!kontext) return `Autor-Modell: ${wert}\n\n${body}`;
  const start = kontext.ende;
  const naechsterAbschnitt = body.slice(start).search(/^## /m);
  const ende = naechsterAbschnitt === -1 ? body.length : start + naechsterAbschnitt;
  // `(?<!\n)` statt blossem `\n+$`: Der Lookbehind laesst nur den ANFANG des
  // abschliessenden Umbruch-Laufs als Startpunkt zu. Ohne ihn probierte die
  // Engine bei einem Abschnitt, der nicht auf `\n` endet, jede Startposition
  // durch und frass sich jedesmal bis ans Ende (S8786, Issue #406) — 18,8 s bei
  // 256 KiB Leerzeilen, danach 0,4 ms. Das Ergebnis des Ersetzens ist dasselbe:
  // Der erste Treffer lag auch vorher am Anfang des Laufs.
  const davor = body.slice(0, ende).replace(/(?<!\n)\n+$/, "");
  return `${davor}\nAutor-Modell: ${wert}\n\n${body.slice(ende).replace(/^\n+/, "")}`;
}

// ============================================================
// Dokument-Praefixe im Titel (Issue #464)
// ============================================================

/**
 * Die vier Titel-Praefixe der Karten, die keine Sitzung umsetzt: `[Fachlich]`
 * (PO-Schleife), `[Plan]` (Plandokument aus /techplan), `[Idee]` (rohe Idee) und
 * `[Mensch]` (ein Schritt, den nur ein Mensch tun kann).
 *
 * Hier und nur hier. Bis Issue #464 lag die Form doppelt im Bestand — als
 * `isFachlich`/`isIdee`/`isPlan` in kit/night.mjs und als `PLAN_PRAEFIX` in
 * tools/derived-from-report.mjs — und an keiner Stelle abrufbar. Beide Nutzer
 * importieren jetzt von hier; der `runAsCli`-Waechter macht den Import
 * nebenwirkungsfrei.
 *
 * Warum es die Gates gibt — die Begruendungen standen bis #464 an den entfernten
 * Fassungen im Nacht-Runner: `[Fachlich]` wird gegroomt und nie implementiert
 * (#146). Bei `[Idee]` startete der Runner ohne Gate eine Session, die das Issue
 * korrekt ablehnt und ohne In-review-Ergebnis endet — eine korrekte Ablehnung, die
 * er nicht von einem Fehlschlag unterscheiden kann (#192, beobachtet an zwei Tagen
 * mit kanban-kit#494). `[Plan]` beschreibt einen Weg und ist keine Aufgabe; ohne
 * Gate kaeme er als normales Arbeitspaket durch, wuerde implementiert, und am Board
 * saehe das wie ein Erfolg aus (#276). `[Mensch]` kennzeichnet eine Aufgabe ausserhalb
 * des Repositories — eine Einstellung in einer Weboberflaeche, ein Konto, ein Zugang, eine
 * Freigabe: Eine Sitzung erkennt den Fall zwar und tut nichts, aber der Runner kann diese
 * richtige Untaetigkeit nicht von einem Fehlschlag unterscheiden, und die Karte wandert
 * aus Ready ins Backlog, wo sie wie ein gescheitertes Paket aussieht (#984, beobachtet an
 * kanban-kit#1256). Anders als die drei davor ist `[Mensch]` ein Arbeitspaket und kein
 * Dokument: Es faellt bei der Formpruefung in die Stufe `issue`, nur umsetzen kann es
 * niemand ausser dem Menschen.
 *
 * `\s*` und `i` wie im Nacht-Runner, damit die Erkennung zeichengleich bleibt:
 * fuehrender Leerraum erlaubt, Gross- und Kleinschreibung gleichgueltig, das
 * Praefix steht am Titelanfang. `[Fachplan]`, `[Konzept]`, `Fachlich: …` und ein
 * `[Plan]` mitten im Titel sind KEIN Praefix — sie bezeichnen Arbeitspakete.
 *
 * Seit Issue #1423 kommen die Namen aus dem Register kit/board/namen.mjs, und jede Art gilt
 * unter beiden: `[Requirement]` wie `[Fachlich]`, `[Idea]` wie `[Idee]`, `[Human]` wie
 * `[Mensch]` — gleich, welche Sprache das Projekt hat (Plan #1420 E3, E4).
 */
const praefixRegex = (art) => {
  const maskiert = [...new Set(SPRACHEN.map((s) => praefix(art, s)))].map((n) => n.replaceAll(/[[\]]/g, String.raw`\$&`));
  return new RegExp(String.raw`^\s*(?:` + maskiert.join("|") + ")", "i");
};
export const FACHLICH_PRAEFIX = praefixRegex("fachlich");
export const PLAN_PRAEFIX = praefixRegex("plan");
export const IDEE_PRAEFIX = praefixRegex("idee");
export const MENSCH_PRAEFIX = praefixRegex("mensch");

export function istFachlich(title) {
  return erkennePraefix(title) === "fachlich";
}

export function istPlan(title) {
  return erkennePraefix(title) === "plan";
}

export function istIdee(title) {
  return erkennePraefix(title) === "idee";
}

export function istMensch(title) {
  return erkennePraefix(title) === "mensch";
}

// ============================================================
// Pruefvorgabe am Ticket (Issue #301, fachliche Quelle #285)
// ============================================================
//
// Zwei Zeilen im Kontext-Abschnitt tragen die Entscheidung, wie oft ein Dokument
// geprueft wird: `Pruefung: <1|2|3|Verzicht>` setzt der Mensch, `Pruefung-Stand:`
// pflegt die Maschine. Weicht der Stand vom Bezugsstand des Bodys ab, hat sich
// der Inhalt seit der Entscheidung geaendert — die Vorgabe ist verfallen.
//
// Beides lebt hier und nur hier. Der Nacht-Runner importiert diesen Parser,
// statt die Zeilen mit einer zweiten Regex zu lesen: Ein `SYNC:`-Kommentar
// erzwingt keine identische Semantik, und zwei Auslegungen derselben Zeile
// waeren am Board nicht zu sehen.

/** Kontextueberschrift unter beiden Namen (Issue #1443): `## Kontext`, auch mit Zusatz nach Leerraum. */
const istKontextUeberschrift = (zeile) => {
  const m = zeile.startsWith("## ") ? leseMarker(zeile) : null;
  return m?.sache === "kontext" && (m.rest === "" || /^[ \t]/.test(m.rest));
};
// Der negative Lookahead ist der Kern (Issue #403): Ohne ihn akzeptieren `{3,} und
// [^\n]* dieselben Zeichen, und eine Zeile aus lauter Backticks ohne Zeilenende
// laesst die Engine jede Aufteilung durchprobieren — 78 ms bei 16 KiB, quadratisch
// wachsend. Mit ihm ist die Fence-Laenge eindeutig: 0,04 ms, linear.
export const FENCE_ZEILE = /^ {0,3}(`{3,}(?!`)|~{3,}(?!~))([^\n]*)$/;

/** \r\n und einzelne \r zu \n — sonst haengt der Stand am Zeilenende des Editors. */
export function normalisiereZeilenenden(body) {
  return String(body || "").replaceAll(/\r\n?/g, "\n");
}

/**
 * Zustandsautomat fuer Code-Fences, zeilenweise gefuettert.
 *
 * Liefert true, solange die Zeile zu einem Fence gehoert (die oeffnende und die
 * schliessende Zeile eingeschlossen). Mehrere Stellen brauchen dieselbe Auslegung —
 * Abschnittsgrenzen, Formpruefung, Herkunftsleser. Eine weitere Kopie der Bedingung
 * waere die Stelle, an der sie auseinanderlaufen, ohne dass es jemandem auffiele.
 *
 * Seit Issue #308 ist es eine vierte: `parseDeps` in `kit/night.mjs` importiert die
 * Funktion von hier. night.mjs ruft board.mjs sonst als Subprozess auf — fuer eine
 * reine Regel waere das der falsche Weg, und eine Kopie waere genau die Kopie, vor
 * der dieser Kommentar warnt. Der Import ist nebenwirkungsfrei: Die CLI haengt am
 * runAsCli-Guard.
 */
export function fenceLauf() {
  let fence = null;
  return (zeile) => {
    const fm = zeile.match(FENCE_ZEILE);
    if (fence) {
      if (fm && fm[1][0] === fence.zeichen && fm[1].length >= fence.laenge && fm[2].trim() === "") fence = null;
      return true;
    }
    if (fm) {
      fence = { zeichen: fm[1][0], laenge: fm[1].length };
      return true;
    }
    return false;
  };
}

/**
 * Grenzen des ersten `## Kontext`-Abschnitts im normalisierten Body.
 *
 * Code-Fences (drei oder mehr Backticks/Tilden) zaehlen nicht: Ein Issue, das
 * das Vier-Abschnitt-Format als Beispiel zeigt, traegt `## Aufgabe` dort am
 * Zeilenanfang — das darf den Abschnitt nicht beenden. Eingerueckte Codebloecke
 * bleiben bewusst aussen vor.
 *
 * Mehrere Kontext-Abschnitte sind kein Fehler, es gilt der erste — genau so
 * verhaelt sich `autorModellSicherstellen` heute schon.
 */
export function kontextGrenzen(text) {
  const imFence = fenceLauf();
  let start = -1;
  let offset = 0;
  for (const zeile of text.split("\n")) {
    if (!imFence(zeile)) {
      if (start === -1) {
        if (istKontextUeberschrift(zeile)) start = offset;
      } else if (zeile.startsWith("## ")) {
        return { start, ende: offset };
      }
    }
    offset += zeile.length + 1;
  }
  return start === -1 ? null : { start, ende: text.length };
}

/**
 * Liest `--derived-from` und prueft die FORM, nicht den Inhalt (Issue #356).
 *
 * Die Obergrenze bleibt bewusst ungeprueft: `CardNumbers.MAX` ist eine
 * kanban-kit-Konstante. Eine Kopie hier waere eine zweite Wahrheit, die beim
 * naechsten Serverwechsel still falsch wird. Ob die Nummer existiert, auf die Karte
 * selbst zeigt oder einen Zyklus schliesst, prueft der Server — dort liegen die Daten.
 *
 * Der eigene Zweig fuer `true` ist der Kern: `parseArgs` macht aus einem Flag ohne
 * Wert ein `true`, und `Number(true) === 1`. Ohne ihn kaeme ein nacktes
 * `--derived-from` durch jede Number/isInteger-Pruefung und schickte still die
 * Herkunft "Karte 1" ans Board. Dieselbe Falle wie bei `kontextOption`.
 */
function derivedFromOption(wert) {
  if (wert === undefined) return undefined;
  if (wert === true) fail(t("derivedFromOhneWert"));
  const nummer = Number(wert);
  if (!Number.isInteger(nummer) || nummer < 1) {
    fail(t("derivedFromKeineZahl", { wert }));
  }
  return nummer;
}

/**
 * Der Schluessel von aussen (Issue #834). Derselbe eigene Zweig fuer `true` wie bei
 * derivedFromOption: Ein nacktes `--idempotency-key` wuerde sonst als der String
 * "true" ans Board gehen — ein Schluessel, den jeder Aufruf teilt, und damit das
 * Gegenteil dessen, was er soll.
 */
function idempotenzOption(wert) {
  if (wert === undefined) return undefined;
  if (wert === true || String(wert).trim() === "") fail(t("idempotenzOhneWert"));
  return String(wert).trim();
}

/** Die Werte von `--art`, wie das Namen-Register sie kennt (Plan #1420 E6). */
export const ARTEN = Object.freeze(Object.keys(PRAEFIXE));

/**
 * Der Titel mit dem englischen Praefix der Art (Issue #1427, E6; englisch in jedem Projekt seit
 * Issue #1552, Plan #1548 E2): `{ titel }`,
 * oder `{ fehler }`, wenn die Art unbekannt ist oder der Titel schon ein Praefix traegt.
 * Ohne Art bleibt der Titel unveraendert — ein Titel mit Praefix wird nie umgeschrieben.
 * Dieselbe Regel fuer `issue create` und `issue check-form`, damit beide denselben Titel sehen.
 */
export function titelMitArt(title, art) {
  if (art === undefined) return { titel: title };
  if (art === true || !ARTEN.includes(art)) {
    return { fehler: t("artUnbekannt", { arten: ARTEN.join("|") }) };
  }
  if (erkennePraefix(title) !== null) {
    return { fehler: t("artNebenPraefix", { art, titel: title }) };
  }
  return { titel: `${praefix(art)} ${String(title).trimStart()}` };
}

export async function issueCreate(tracker, args) {
  if (!args.title) fail(t("titelErforderlich"));
  // Vor jedem Netzaufruf: Ein Widerspruch zwischen --art und Titel legt keine Karte an.
  const { titel, fehler } = titelMitArt(args.title, args.art);
  if (fehler) fail(fehler);
  // Ohne jede Body-Quelle bleibt der Body leer — der lokale Tracker setzt dann
  // seine Abschnitts-Vorlage. leseTextQuelle wuerde einen leeren Text ablehnen,
  // deshalb wird es nur befragt, wenn ueberhaupt eine Quelle angegeben ist.
  const hatQuelle = args.body !== undefined || args["body-file"] !== undefined;
  // Vor jeder Body-Aufloesung und damit vor jedem Netzaufruf: Ein Tippfehler in der
  // Nummer soll keine Karte anlegen und keine Datei lesen.
  const derivedFrom = derivedFromOption(args["derived-from"]);
  const idempotencyKey = idempotenzOption(args["idempotency-key"]);
  const roh = hatQuelle ? await leseTextQuelle(args.body, args["body-file"], "body") : "";
  const felder = {
    title: titel,
    // Die Autor-Modell-Leitplanke laeuft auf dem AUFGELOESTEN Text (Issue #271):
    // Stuende sie vor der Aufloesung, wuerde ein '-' oder ein Dateipfad geprueft
    // statt des Inhalts — und ein Body mit korrekter Zeile in der Datei abgelehnt.
    body: autorModellSicherstellen(roh, args["author-model"]),
    type: args.type,
    parent: args.parent,
    color: args.color,
    shortcode: args.shortcode,
  };
  // Nur setzen, wenn angegeben: Ein Schluessel mit `undefined` waere im Adapter nicht
  // vom bewussten Weglassen zu unterscheiden.
  if (derivedFrom !== undefined) felder.derivedFrom = derivedFrom;
  // Nur toolbox wertet den Schluessel aus; die uebrigen Tracker ignorieren das Feld.
  if (idempotencyKey !== undefined) felder.idempotencyKey = idempotencyKey;
  const angelegt = await tracker.createIssue(felder);
  out(await mitAbhaengigkeitsHinweisen(angelegt, felder.body, tracker));
}

export async function issueGet(tracker, args) {
  const id = args._[0];
  if (!id) fail(t("idErforderlich", { aufruf: "issue get <id>" }));
  out(await tracker.getIssue(id));
}

export async function issueList(tracker, args) {
  if (args.status && !VALID_STATUSES.includes(args.status)) {
    fail(t("statusUngueltig", { status: args.status, gueltig: VALID_STATUSES.join(", ") }));
  }
  out(await tracker.listIssues(args.status));
}

export async function issueEpics(tracker) {
  if (typeof tracker.listEpics !== "function") {
    fail(t("epicsNichtUnterstuetzt"));
  }
  out(await tracker.listEpics());
}

/**
 * Aktivitaetsverlauf einer Karte (Issue #460).
 *
 * Auswertungen wie `wirksamkeit.mjs` lesen daraus die Ereignisdaten: Die
 * Karten-Route fuehrt kein Anlagedatum — an der Instanz belegt am 2026-09-02
 * (manuelle Pruefung zu Issue #457). Der Verlauf geht unveraendert durch,
 * einschliesslich seiner Reihenfolge; wer das aelteste Ereignis braucht, sucht
 * nach dem kleinsten `createdAt` und verlaesst sich nicht auf die Sortierung
 * der Antwort.
 */
export async function issueActivity(tracker, config, args) {
  const id = args._[0];
  const ids = args.ids;
  // Beide Eingabewege zusammen werden abgewiesen statt einer stillschweigend zu
  // gewinnen: Welcher das waere, kann der Aufrufer nicht wissen, und die Ausgabeform
  // der beiden ist verschieden (Liste gegen Objekt).
  if (ids !== undefined && id) {
    fail(t("activityBeides"));
  }
  if (ids === undefined && !id) fail(t("idErforderlich", { aufruf: "issue activity <id> | --ids <n,n,...>" }));
  if (typeof tracker.listActivity !== "function") {
    const name = config?.issueTracker ?? t("dieserTracker");
    fail(t("activityNichtUnterstuetzt", { name }));
  }
  if (ids !== undefined) {
    // `--ids` ohne Wert kommt als `true` aus parseArgs. Ein leerer oder nur aus Kommas
    // bestehender Wert bliebe sonst eine Sammelabfrage ueber nichts und gaebe `{}` aus —
    // von einem Ergebnis ohne Ruecklaeufer nicht zu unterscheiden.
    const nummern = (ids === true ? [] : String(ids).split(",").map((n) => n.trim()).filter(Boolean));
    if (!nummern.length) fail(t("idsLeer"));
    out(await tracker.listActivityMany(nummern));
    return;
  }
  out(await tracker.listActivity(id));
}

// Spalten, deren Betreten den Beginn eines zuordenbaren Abschnitts markiert (Issue #733).
// Ready, Backlog und Done stehen bewusst nicht dabei: Sie sind Ablagen, keine Arbeit.
export const WEGMARKEN_SPALTEN = new Set(["in_progress", "in_review"]);
export const WEGMARKEN_DATEI = "wegmarken.tsv";

/**
 * Haengt eine Wegmarke an `.claude/wegmarken.tsv` im Arbeitsverzeichnis an (Issue #733).
 *
 * Wozu: Der Melder teilt den Verbrauch einer interaktiven Sitzung anhand der Zeitstempel
 * seines Protokolls auf die hier vermerkten Abschnitte auf. Was zwischen keinen zwei
 * Wegmarken liegt, zaehlt "ohne Karte" — geraten wird nicht.
 *
 * Vermerkt wird der KANONISCHE Status, nicht der Anzeigename der Spalte: Der steht
 * projektweise verschieden unter `columns` in der Config, und der Melder liest die Datei
 * ohne Zugriff auf die Config, die sie erzeugt hat.
 *
 * Angehaengt, nie ueberschrieben — sonst saehe der Melder nur den letzten Abschnitt einer
 * Sitzung. Scheitert das Schreiben, bleibt es bei einem Hinweis auf stderr: Eine Wegmarke
 * ist Buchhaltung, keine Bedingung, und eine gescheiterte Buchung darf die Kartenbewegung
 * nicht mitreissen.
 */
function wegmarkeSchreiben(id, status, jetzt = new Date()) {
  if (!WEGMARKEN_SPALTEN.has(status)) return;
  const pfad = resolve(".claude", WEGMARKEN_DATEI);
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    appendFileSync(pfad, `${jetzt.toISOString()}\t${id}\t${status}\n`, "utf-8");
  } catch (e) {
    process.stderr.write(`${t("wegmarkeNichtGeschrieben", { pfad, grund: e.message })}\n`);
  }
}

// SYNC: Der Dateiname steht auch in kit/night.mjs (Ausschluss im Rest-Guard und in
// der Spiegel-Liste des Worktrees) und in install.mjs (GITIGNORE_BLOCK). Wer ihn hier
// aendert, aendert ihn dort mit — sonst haelt der Dirty-Guard das Protokoll fuer einen
// unkommittierten Rest und stoppt den Nachtlauf.
const BEWEGUNGEN_DATEI = "bewegungen.tsv";

/**
 * Haengt jede geglueckte Kartenbewegung an `.claude/bewegungen.tsv` an (Issue #786).
 *
 * Wozu: Die Ruecklaeuferquote braucht einen KANDIDATENFILTER — welche Karten hat das
 * Kit ueberhaupt je bewegt. Die Wahrheit darueber, ob eine davon zurueckging, holt die
 * Auswertung anschliessend aus dem Aktivitaetsverlauf des Boards; das Protokoll sagt
 * nur, wen sie fragen muss. Deshalb kostet eine fehlende Zeile hier keine Genauigkeit,
 * sondern hoechstens einen Kandidaten.
 *
 * Anders als die Wegmarke daneben protokolliert es JEDEN Status, nicht nur die beiden
 * Arbeitsspalten: Der Ruecklaeufer ist gerade der Zug nach Backlog, und ein Filter, der
 * ihn nicht kennt, faende die Karte nie wieder.
 *
 * Alles Uebrige teilt es mit der Wegmarke, aus denselben Gruenden: der kanonische
 * Status statt des projektweise verschiedenen Spaltennamens, angehaengt statt
 * ueberschrieben, und ein gescheitertes Schreiben bleibt ein Hinweis auf stderr — eine
 * Buchung darf den Vorgang nicht mitreissen, den sie bucht.
 */
function bewegungSchreiben(id, status, jetzt = new Date()) {
  const pfad = resolve(".claude", BEWEGUNGEN_DATEI);
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    appendFileSync(pfad, `${jetzt.toISOString()}\t${id}\t${status}\n`, "utf-8");
  } catch (e) {
    process.stderr.write(`${t("bewegungNichtProtokolliert", { pfad, grund: e.message })}\n`);
  }
}

export async function issueMove(tracker, args) {
  const [id, toStatus] = args._;
  if (!id) fail(t("idErforderlich", { aufruf: "issue move <id> <status>" }));
  if (!toStatus) fail(t("statusErforderlich"));
  if (!VALID_STATUSES.includes(toStatus)) {
    fail(t("statusUngueltig", { status: toStatus, gueltig: VALID_STATUSES.join(", ") }));
  }
  await tracker.moveIssue(id, toStatus);
  // Erst nach dem Zug: Eine Wegmarke auf eine gescheiterte Bewegung waere eine Buchung
  // ohne Vorgang und wuerde dem Melder einen Abschnitt erfinden. Fuer das
  // Bewegungsprotokoll gilt dasselbe — es saehe sonst Ruecklaeufer, die es nicht gab.
  wegmarkeSchreiben(id, toStatus);
  bewegungSchreiben(id, toStatus);
  // Nach dem eigenen Zug, wie in `issue melden` (Issue #1287, Plan #1283 A2, E1): Auch die
  // Rettung und ein Zug des Menschen nach Done koennen das letzte Paket sein. Gezogen wird
  // nur nach In review; kein Fehler hier aendert Exit-Code oder Zug des Pakets (A8).
  const ursprung = URSPRUNG_AUSLOESER.has(toStatus) ? await ursprungDesPakets(tracker, id) : null;
  out({ ok: true, id, status: toStatus, ...(ursprung ? { ursprung } : {}) });
}

const URSPRUNG_AUSLOESER = new Set(["in_review", "done"]);

/**
 * `issue ursprung <plan>` (Issue #1285, Plan #1283 A11): Ist der Plan durch, und welche
 * Ursprungsdokumente wandern? Rein lesend — gibt die Auswertung aus und bewegt nichts.
 */
export async function issueUrsprung(tracker, args) {
  const id = args._[0];
  if (!id) fail(t("planErforderlich"));
  out(await ursprungLesen(tracker, id));
}

const LABEL_AKTIONEN = ["add", "remove"];

// Abbruch mit Hilfe: dieselbe Form wie die Dispatcher-Zweige fuer unbekannte Befehle. Den
// Hilfetext fuehrt der Einstieg; er reicht ihn beim Aufruf herein (Issue #1218).
function labelFailMit(msg, hilfe) {
  process.stdout.write(hilfe);
  fail(msg);
}

/**
 * `issue label add|remove <id> <name>` — zeichnet ein Issue (Issue #249).
 *
 * Die Operandenpruefung laeuft vollstaendig VOR dem Adapter: Ein Schreibzugriff auf
 * halbem Wissen — falsche ID, halber Name — waere schlimmer als eine Fehlermeldung,
 * und bei den externen Trackern ist er nicht ohne Weiteres zurueckzunehmen.
 *
 * Verboten sind Komma und Zeilenumbruch im Namen. Das Komma folgt aus dem lokalen
 * Speicherformat (kommaseparierter Frontmatter-String, siehe labelsAusFrontmatter):
 * Ein Name mit Komma liesse sich daraus nicht mehr eindeutig zurueckgewinnen. Ein
 * Verbot bei allen vier Trackern statt nur bei local, damit derselbe Aufruf nicht je
 * nach Projekt etwas anderes bedeutet.
 *
 * Leerzeichen und Doppelpunkt bleiben erlaubt und gehen als EIN argv-Element durch —
 * `kit:klaeren` und `needs: triage` sind gaengige Labelnamen.
 */
export async function issueLabel(tracker, config, args, hilfe = "") {
  const [aktion, id, name, ...zuviel] = args._;
  const labelFail = (msg) => labelFailMit(msg, hilfe);
  if (!LABEL_AKTIONEN.includes(aktion)) {
    labelFail(t("labelUnbekannt", { aktion: aktion ?? "", erwartet: LABEL_AKTIONEN.join(" | ") }));
  }
  if (!id) labelFail(t("idErforderlich", { aufruf: "issue label add <id> <name>" }));
  if (!name) labelFail(t("labelNameErforderlich"));
  if (zuviel.length > 0) {
    labelFail(t("labelZuViele", { zuviel: zuviel.join(" ") }));
  }
  if (/[,\n]/.test(name)) {
    labelFail(t("labelNameUngueltig", { name }));
  }

  // Spaltennamen sind bei GitLab selbst Labels — ohne diese Sperre koennte das
  // generische Label-Kommando `issue move` umgehen und den Boardzustand
  // beschaedigen. Die Sperre gilt bei allen Trackern: Ein Kommando, das je nach
  // Projekt einmal den Status aendert und einmal nicht, ist die schlechtere Wahl.
  // Verglichen wird exakt — nur der wortgleiche Name ist das Statuslabel.
  if (Object.values(columnLabels(config)).includes(name)) {
    fail(t("statusLabel", { name }));
  }

  out({ ok: true, id, ...await labelAbbilden(tracker, config, aktion, id, name), aktion });
}

/**
 * Die Abbildung der Kit-Labels in `issue label` (Issue #1428, Plan #1420 E6): Kit-eigene
 * Labels gehoeren dem Kit. `add` setzt den englischen Namen, in jedem Projekt (Issue #1552,
 * Plan #1548 E2); fehlt er am Board, endet der Aufruf mit dem Hinweis, die Labels anzulegen —
 * einen Rueckfall auf den deutschen Namen gibt es nicht mehr. `remove` nimmt den Namen ab,
 * den die Karte traegt — GitHub und GitLab melden beim Abnehmen eines nicht gesetzten Labels
 * keinen Fehler, `remove kit:clarify` taete an einer Karte mit dem deutschen Namen sonst still
 * nichts. Fremde Labels und Kit-Labels mit einem Namen fuer beide Sprachen gehen unveraendert
 * durch.
 *
 * Liefert `{ label }` mit dem geschriebenen Namen, dazu `hinweise` als
 * `{ art: "nicht-getragen" | "beide", meldung }`, wenn es etwas zu sagen gibt.
 */
export async function labelAbbilden(tracker, config, aktion, id, name) {
  const sache = erkenneLabel(name);
  if (!sache || LABELS[sache].de === LABELS[sache].en) {
    await tracker.labelIssue(id, name, aktion);
    return { label: name };
  }

  if (aktion === "add") {
    const label = labelName(sache);
    try {
      await tracker.labelIssue(id, label, "add");
    } catch (e) {
      if (!(e instanceof LabelFehltError)) throw e;
      throw new LabelFehltError(t("labelFehltAnlegen", { label, grund: e.message }));
    }
    return { label };
  }

  const namen = [labelName(sache), ...SPRACHEN.map((s) => labelName(sache, s)).filter((n) => n !== labelName(sache))];

  const karte = await tracker.getIssue(id);
  const getragen = namen.filter((n) => (karte.labels || []).includes(n));
  if (getragen.length === 0) {
    const meldung = t("labelNichtGetragen", { id, namen: namen.join(t("labelWederNoch")) });
    return { label: name, hinweise: [{ art: "nicht-getragen", meldung }] };
  }
  for (const n of getragen) await tracker.labelIssue(id, n, "remove");
  if (getragen.length === 1) return { label: getragen[0] };
  const meldung = t("labelBeide", { id, namen: getragen.join(", ") });
  return { label: name, hinweise: [{ art: "beide", meldung }] };
}

/**
 * Loest den Text eines Schreibbefehls aus Argument, Datei oder stdin auf (Issue #270).
 *
 * Warum es die beiden zusaetzlichen Wege braucht: Die Skills dieses Kits erzeugen
 * regelmaessig Texte, die nicht durch eine Kommandozeile passen — die Befunde eines
 * Issue-Reviews lagen am 2026-08-08 bei 12 bis 14 Tausend Zeichen. Ohne einen Weg
 * dafuer bauen Sessions sich Hilfsskripte; die stehen in keiner Allowlist, werden
 * headless abgelehnt, und ihre Arbeitsdateien hinterlassen einen unsauberen Working
 * Tree, auf den der Nacht-Runner hart stoppt. Dieselbe Ueberlegung wie in Issue #196
 * (kein Shell-String-Bau) und wie beim stdin-Weg fuer command-Reviewer in
 * /issue-review — hier fuer die Eingabeseite.
 *
 * Fuer kurze Texte ist stdin der einfachste Weg. Fuer lange fuehrt er nicht mehr ans
 * Ziel: Der Befehls-Parser weist einen Aufruf ab, der den ganzen Text traegt — auch im
 * Heredoc (Issue #584). Dann '--text-file' mit einer stueckweise erzeugten Datei.
 *
 * Asynchron seit Issue #1076: stdin wird ueber die Event-Schleife gelesen
 * (`process.stdin`), nicht mit einem blockierenden `readFileSync(0)`. Blockierend hing
 * das Lesen einer Socket-stdin mit grosser Eingabe — so, wie `spawnSync` mit `input`
 * sie anlegt — sporadisch endlos, obwohl alles angekommen und die Gegenseite
 * geschlossen war; unter Last 5 von 4.800 Aufrufen, ueber die Event-Schleife keiner.
 */
export async function leseTextQuelle(direkt, dateiPfad, flagName) {
  const dateiFlag = `--${flagName}-file`;
  const hatDatei = typeof dateiPfad === "string" && dateiPfad !== "";
  const hatDirekt = typeof direkt === "string";

  // Beide angegeben: Fehler statt Vorrangregel. Wer beides setzt, meint etwas
  // anderes als das, was eine stille Vorrangregel taete.
  if (hatDirekt && hatDatei) fail(t("quelleBeides", { flag: flagName, dateiFlag }));
  if (dateiPfad === true) fail(t("quelleOhnePfad", { dateiFlag }));
  if (direkt === true) fail(t("quelleOhneWert", { flag: flagName }));

  let text;
  if (hatDatei) {
    if (!existsSync(dateiPfad)) fail(t("quelleDateiFehlt", { dateiFlag, pfad: dateiPfad }));
    try {
      text = readFileSync(dateiPfad, "utf-8");
    } catch (e) {
      fail(t("quelleUnlesbar", { dateiFlag, pfad: dateiPfad, grund: e.code || e.message }));
    }
  } else if (direkt === "-") {
    try {
      text = await stdinLesen();
    } catch (e) {
      fail(t("stdinUnlesbar", { flag: flagName, grund: e.code || e.message }));
    }
  } else {
    text = direkt;
  }

  if (typeof text !== "string" || text.trim() === "") {
    fail(t("quelleLeer", { flag: flagName, dateiFlag }));
  }
  return text;
}

/** Liest stdin bis zum Ende ueber die Event-Schleife (Issue #1076, siehe leseTextQuelle). */
function stdinLesen() {
  return new Promise((aufloesen, ablehnen) => {
    const teile = [];
    process.stdin.on("data", (teil) => teile.push(teil));
    process.stdin.on("end", () => aufloesen(Buffer.concat(teile).toString("utf-8")));
    process.stdin.on("error", ablehnen);
  });
}

export async function issueComment(tracker, args) {
  const id = args._[0];
  if (!id) fail(t("idErforderlich", { aufruf: 'issue comment <id> --text "..."' }));
  // Vor jeder Textaufloesung: Ein fehlerhafter Schalter soll nicht erst eine Datei
  // lesen und schon gar nichts ans Board schicken.
  const idempotencyKey = idempotenzOption(args["idempotency-key"]);
  const text = await leseTextQuelle(args.text, args["text-file"], "text");
  const kitZeile = kitStandZeileFuer(text);
  await tracker.commentIssue(id, kitZeile ? `${text.trimEnd()}\n\n${kitZeile}` : text, idempotencyKey);
  out({ ok: true, id });
}

// ============================================================
// Kit-Stand-Zeile (Issue #1103, Plan #1101 A4, A7)
// ============================================================

// Der feste Kit-Stand eines unbeaufsichtigten Laufs steht an jedem Kommentar, den dieser
// Lauf schreibt — vom Runner wie von seinen Sitzungen. Die Zeile setzt das Werkzeug, nicht
// der Skill-Text. Bedingung sind Umgebung UND Markierung (A4): `KIT_STAND` allein erbt jede
// Shell, die aus einer Nachtsitzung heraus gestartet wurde; die Markierung allein bleibt
// nach einem harten Abbruch liegen. Lebend heisst wie in `tools/sync-blobs.mjs`: Die Datei
// liegt vor, und ihr `pid` lebt.
const KIT_STAND_MARKIERUNG = join(".claude", "kit-stand.json");
const KIT_STAND_PRAEFIX = "Kit-Stand:";

function lebendeKitStandMarkierung(baum) {
  let markierung;
  try {
    markierung = JSON.parse(readFileSync(join(baum, KIT_STAND_MARKIERUNG), "utf-8"));
  } catch {
    return null;
  }
  if (!Number.isInteger(markierung?.pid) || markierung.pid <= 0) return null;
  try {
    process.kill(markierung.pid, 0);
  } catch (e) {
    if (e.code !== "EPERM") return null; // EPERM: der Prozess lebt, gehoert nur jemand anderem
  }
  return markierung;
}

/**
 * Die Zeile `Kit-Stand: <commit, 12 Stellen> (origin/<mainBranch> vom <JJJJ-MM-TT HH:MM>)`
 * fuer einen Kommentartext, oder `null`: ohne `KIT_STAND`, ohne lebende Markierung im Baum,
 * oder wenn der Text schon eine Kit-Stand-Zeile traegt — ein nachgetragener Nachtbericht
 * behaelt die Zeile des Laufs, der ihn schrieb. Die Commit-Zeit kommt aus dem Commit; ist
 * er im Baum nicht aufzuloesen, endet die Zeile nach dem Ref.
 */
export function kitStandZeileFuer(text, { env = process.env, baum = process.cwd(), config = null } = {}) {
  if (!env.KIT_STAND) return null;
  if (markerWerte(text, "kitStand").length > 0) return null;
  const markierung = lebendeKitStandMarkierung(baum);
  if (!markierung) return null;
  const commit = String(env.KIT_STAND);
  const mainBranch = config?.mainBranch ?? ladeMainBranch(baum);
  const zeit = spawnSync("git", ["show", "-s", "--format=%cI", commit], { cwd: baum, encoding: "utf-8" });
  const iso = zeit.status === 0 ? zeit.stdout.trim() : "";
  // SYNC: dieselbe Form baut `kitStandZeile` in kit/night.mjs fuer den Nachtbericht.
  const vom = iso ? ` vom ${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "";
  return `${KIT_STAND_PRAEFIX} ${commit.slice(0, 12)} (origin/${mainBranch}${vom})`;
}

function ladeMainBranch(baum) {
  try {
    return normalisiereConfig(JSON.parse(readFileSync(join(baum, ".claude", "workflow.config.json"), "utf-8"))).config.mainBranch || "main";
  } catch {
    return "main";
  }
}

// SYNC: Das Verzeichnis steht auch in kit/night.mjs (Ausschluss im Rest-Guard) und in
// install.mjs (GITIGNORE_BLOCK). Wer es hier aendert, aendert es dort mit — sonst haelt
// der Dirty-Guard liegengebliebene Stuecke fuer einen unkommittierten Rest.
const BERICHTE_ORDNER = "berichte";
const BERICHT_LAUF = "Bericht-Lauf:";

// Kartennummern vergleichbar machen: `issue move 0005` und `issue move 5` meinen beim
// lokalen Tracker dieselbe Karte, und das Protokoll haelt fest, was aufgerufen wurde.
function kartenSchluessel(id) {
  const s = String(id).trim().replace(/^#/, "");
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}

/**
 * Die Laufkennung einer Karte (Plan #1015, E9): der Zeitstempel ihres juengsten Zugs
 * nach In progress aus `.claude/bewegungen.tsv`, oder null.
 *
 * Nicht aus `.claude/wegmarken.tsv`: Die leert `sitzungVerbuchen` bei `--complete`, und
 * eine Wiederholung nach dem Sitzungsende faende ihren Lauf nicht mehr — sie legte einen
 * zweiten Bericht an. Das Bewegungsprotokoll wird nur angehaengt.
 */
function laufkennung(id) {
  const pfad = resolve(".claude", BEWEGUNGEN_DATEI);
  if (!existsSync(pfad)) return null;
  const gesucht = kartenSchluessel(id);
  let stempel = null;
  for (const zeile of readFileSync(pfad, "utf-8").split(/\r?\n/)) {
    const [zeit, karte, status] = zeile.replace(/\r$/, "").split("\t");
    if (status === "in_progress" && karte !== undefined && kartenSchluessel(karte) === gesucht) stempel = zeit;
  }
  return stempel;
}

// Die Stuecke einer Karte in Nummernfolge (numerisch, nicht lexikalisch: 10 nach 2).
function berichtStuecke(id) {
  const ordner = resolve(".claude", BERICHTE_ORDNER);
  if (!existsSync(ordner)) return [];
  const praefix = `${kartenSchluessel(id)}.`;
  return readdirSync(ordner)
    .map((name) => ({ name, m: name.startsWith(praefix) && name.slice(praefix.length).match(/^(\d+)\.md$/) }))
    .filter((e) => e.m)
    .map((e) => ({ nummer: Number(e.m[1]), pfad: join(ordner, e.name) }))
    .sort((a, b) => a.nummer - b.nummer);
}

// Beginnt jedes Stueck auf einer neuen Zeile: Eine Session stueckelt an Abschnittsgrenzen,
// und die Shell nimmt den Zeilenumbruch am Ende eines `--text '…'` nicht mit.
function stueckeZusammensetzen(stuecke) {
  return stuecke.reduce((gesamt, s) => {
    const text = readFileSync(s.pfad, "utf-8");
    if (gesamt === "") return text;
    return gesamt.endsWith("\n") ? gesamt + text : `${gesamt}\n${text}`;
  }, "");
}

/**
 * Traegt der Kommentar die Laufzeile `Bericht-Lauf: <stempel>` — unter beiden Namen des
 * Markers, der Stempel zeichengleich (Issue #1443).
 */
function traegtLaufZeile(body, laufZeile) {
  const stempel = leseMarker(laufZeile)?.rest.trim();
  return markerWerte(body, "berichtLauf").some((w) => w.trim() === stempel);
}

const vergleichbar = (text) => String(text ?? "").replaceAll("\r\n", "\n").trimEnd();

// Abschnitt `### Ursprungsdokumente` im Abschlussbericht (Issue #1286, Plan #1283 A9, E6).
// Er steht unmittelbar vor dem Schwanz aus `Kit-Stand:` und `Bericht-Lauf:`; `issue melden`
// schreibt ihn nach dem Zug, und `berichtAblegen` fuehrt ihn bei einer Wiederholung mit.
// Geschrieben in der Projektsprache wie der Bericht, den er ergaenzt (Issue #1479).
// Zurueckgelesen unter beiden Namen (Issue #1460): `### Ursprungsdokumente` oder `### Origin documents`.
const URSPRUNG_KOPF = ueberschriftZeile("ursprungsdokumente", 3);

// Index der ersten Zeile des Schwanzes: die letzten Zeilen, die mit `Kit-Stand:` oder
// `Bericht-Lauf:` beginnen oder leer sind, ohne fuehrende Leerzeilen.
function schwanzBeginn(zeilen) {
  let beginn = zeilen.length;
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const z = zeilen[i];
    if (z.trim() !== "" && !["kitStand", "berichtLauf"].includes(erkenneMarker(z))) break;
    if (z.trim() !== "") beginn = i;
  }
  return beginn;
}

/** `{ ohne, abschnitt }`: der Bericht ohne den Abschnitt und der Abschnitt selbst oder null. */
function ursprungAbtrennen(body) {
  const zeilen = String(body ?? "").replaceAll("\r\n", "\n").split("\n");
  const kopf = zeilen.findIndex((z) => URSPRUNG_KOPF.test(z));
  const ende = schwanzBeginn(zeilen);
  if (kopf === -1 || kopf >= ende) return { ohne: body, abschnitt: null };
  const vorher = zeilen.slice(0, kopf).join("\n").trimEnd();
  return {
    ohne: `${vorher}\n\n${zeilen.slice(ende).join("\n")}`,
    abschnitt: zeilen.slice(kopf, ende).join("\n").trimEnd(),
  };
}

/** Haengt den Abschnitt vor den Schwanz aus `Kit-Stand:`/`Bericht-Lauf:`. */
function ursprungEinhaengen(body, abschnitt) {
  const zeilen = String(body).replaceAll("\r\n", "\n").split("\n");
  const ende = schwanzBeginn(zeilen);
  return `${zeilen.slice(0, ende).join("\n").trimEnd()}\n\n${abschnitt}\n\n${zeilen.slice(ende).join("\n")}`;
}

// `issue melden <id> --teil <n> --text '…'`: nur das Stueck ablegen, kein Board-Zugriff.
async function meldenStueck(id, args, hatText) {
  if (!/^\d+$/.test(String(args.teil)) || Number(args.teil) < 1) {
    fail(t("meldenTeilKeineZahl", { wert: args.teil }));
  }
  if (!hatText) fail(t("meldenTeilOhneText"));
  const text = await leseTextQuelle(args.text, args["text-file"], "text");
  const nummer = Number(args.teil);
  const pfad = resolve(".claude", BERICHTE_ORDNER, `${kartenSchluessel(id)}.${nummer}.md`);
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, text, "utf-8");
  out({ ok: true, id, teil: nummer, zeichen: text.length });
}

/**
 * Legt den Bericht eines Laufs ab und liefert, was geschah (Plan #1015, E10). Jeder
 * Fehler endet mit Exit 1 — die Karte ist bis hierhin nicht bewegt.
 */
async function berichtAblegen(tracker, id, text, laufZeile) {
  // Die Kit-Stand-Zeile unmittelbar vor `Bericht-Lauf:` (Issue #1103): Diese bleibt die
  // letzte Zeile, an ihr findet eine Wiederholung ihren Bericht.
  const kitZeile = kitStandZeileFuer(text);
  const neu = kitZeile ? `${text.trimEnd()}\n\n${kitZeile}\n${laufZeile}` : `${text.trimEnd()}\n\n${laufZeile}`;
  let kommentare;
  try {
    kommentare = await tracker.kommentareStreng(id);
  } catch (e) {
    fail(t("berichtKommentareUnlesbar", { id, grund: e.message }));
  }
  const dieserLauf = kommentare.filter((c) => traegtLaufZeile(c.body, laufZeile));
  try {
    // Ein Abschnitt `### Ursprungsdokumente` gehoert nicht zum Text der Session: Er zaehlt
    // beim Vergleich nicht und bleibt beim Ersetzen unveraendert stehen (E6).
    if (dieserLauf.some((c) => vergleichbar(ursprungAbtrennen(c.body).ohne) === vergleichbar(neu))) return "unveraendert";
    if (dieserLauf.length > 0) {
      const ziel = dieserLauf.at(-1);
      if (ziel.id == null) throw new BoardError(t("berichtOhneKommentarId"));
      const { abschnitt } = ursprungAbtrennen(ziel.body);
      await tracker.ersetzeKommentar(id, ziel.id, abschnitt ? ursprungEinhaengen(neu, abschnitt) : neu);
      return "ersetzt";
    }
    await tracker.commentIssue(id, neu);
    return "angelegt";
  } catch (e) {
    fail(t("berichtNichtAbgelegt", { id, grund: e.message }));
  }
}

/**
 * `issue melden <id>` — legt den Abschlussbericht eines Laufs ab und zieht die Karte nach
 * In review, in einem Aufruf (Issue #1022, Plan #1015 E2, E8, E9, E10).
 *
 * Drei Formen:
 *  - `--text '…'` (oder `--text-file` von Hand): Bericht direkt, dann Abschluss.
 *  - `--teil <n> --text '…'`: schreibt nur Stueck n nach `.claude/berichte/<id>.<n>.md`,
 *    ueberschreibt es bei Wiederholung, beruehrt das Board nicht.
 *  - ohne beides: setzt die Stuecke zusammen und schliesst ab. Geraeumt wird erst nach
 *    Ablage UND Zug — scheitert einer davon, ist die Wiederholung dieser Aufruf allein.
 *
 * Idempotent je Lauf: Der Bericht traegt als letzte Zeile `Bericht-Lauf: <stempel>`.
 * Findet sich darunter schon ein Kommentar, wird er bei gleichem Inhalt gelassen und
 * sonst ersetzt, nie ein zweiter angelegt. Deshalb werden die Kommentare STRENG gelesen:
 * Ein leer gelesener Stand wuerde den Bericht doppeln. Die Reihenfolge Ablage vor Zug
 * haelt eine Karte ohne Bericht aus In review heraus.
 */
export async function issueMelden(tracker, args) {
  const id = args._[0];
  if (!id) fail(t("idErforderlich", { aufruf: t("meldenAufruf") }));
  const hatText = args.text !== undefined || args["text-file"] !== undefined;

  if (args.teil !== undefined) {
    await meldenStueck(id, args, hatText);
    return;
  }

  const stuecke = berichtStuecke(id);
  if (hatText && stuecke.length > 0) {
    fail(t("meldenTextUndStuecke", { id, anzahl: stuecke.length, ordner: BERICHTE_ORDNER }));
  }
  if (!hatText && stuecke.length === 0) {
    fail(t("meldenKeinBericht", { id, ordner: BERICHTE_ORDNER }));
  }
  const text = hatText ? await leseTextQuelle(args.text, args["text-file"], "text") : stueckeZusammensetzen(stuecke);

  const stempel = laufkennung(id);
  if (!stempel) {
    fail(t("meldenKeinZug", { id, datei: BEWEGUNGEN_DATEI }));
  }
  const bericht = await berichtAblegen(tracker, id, text, `${BERICHT_LAUF} ${stempel}`);

  // Wie `issue move`: Buchungen erst nach dem geglueckten Zug.
  await tracker.moveIssue(id, "in_review");
  wegmarkeSchreiben(id, "in_review");
  bewegungSchreiben(id, "in_review");

  for (const s of stuecke) rmSync(s.pfad, { force: true });
  if (stuecke.length > 0) {
    try { rmdirSync(resolve(".claude", BERICHTE_ORDNER)); } catch { /* nicht leer — Stuecke anderer Karten */ }
  }
  const ursprung = await ursprungMelden(tracker, id, `${BERICHT_LAUF} ${stempel}`);
  out({ ok: true, id, bericht, status: "in_review", ...(ursprung ? { ursprung } : {}) });
}

// Ein Grund kann mehrzeilig sein (Adapter-Meldungen); im Listenpunkt steht er auf einer Zeile.
const einzeilig = (text) => String(text ?? "").replaceAll(/\s+/g, " ").trim();

// Die `aktion` ist Vertrag (E14): `wandert`, `bleibt` oder `lag bereits in <Spalte>`.
const LAG_BEREITS = /^lag bereits in (.+)$/;

function ursprungZeile(d, fehler) {
  const name = t(d.art === "plan" ? "ursprungPlan" : "ursprungFachlich", { id: d.id });
  if (fehler) return t("ursprungFehler", { name, art: fehler.art, grund: einzeilig(fehler.grund), kommando: fehler.kommando });
  if (d.aktion === "wandert") return t("ursprungGewandert", { name });
  if (d.aktion === "bleibt") return t("ursprungBleibt", { name, grund: einzeilig(d.grund) });
  const lag = LAG_BEREITS.exec(d.aktion);
  if (lag) return t("ursprungLagBereits", { name, spalte: lag[1] });
  return `- ${name}: ${d.aktion}`;
}

function ursprungAbschnittText(ergebnis) {
  const zeilen = [`### ${ueberschriftName("ursprungsdokumente", prozessSprache())}`];
  for (const d of ergebnis.dokumente) zeilen.push(ursprungZeile(d, ergebnis.fehler.find((f) => f.id === d.id)));
  for (const f of ergebnis.fehler.filter((f) => !ergebnis.dokumente.some((d) => d.id === f.id))) {
    zeilen.push(`- ${f.art}: ${einzeilig(f.grund)}`);
  }
  return zeilen.join("\n");
}

/**
 * Zieht nach dem Zug eines Pakets dessen Ursprungsdokumente nach (Issue #1286, #1287, Plan
 * #1283 A2, A3, A8). Liefert die Auswertung samt `fehler`, oder null, wenn die Karte keine
 * `Plan:`-Zeile traegt oder selbst ein Dokument ist: Der Zug eines `[Plan]`- oder
 * `[Fachlich]`-Dokuments loest nichts aus. Wirft nie.
 */
async function ursprungDesPakets(tracker, id) {
  let karte;
  try {
    karte = await tracker.getIssue(id);
  } catch (e) {
    return { plan: null, durch: false, grund: t("ursprungPaketNichtLesbarGrund", { grund: e.message }), fehlend: [], dokumente: [],
      fehler: [{ id: kartenSchluessel(id), art: t("ursprungPaketNichtLesbar"), grund: e.message }] };
  }
  if (istPlan(karte.title) || istFachlich(karte.title)) return null;
  const planNr = herkunftNummern(karte.body ?? "", "Plan")[0];
  if (planNr === undefined) return null;
  try {
    return await ursprungNachziehen(tracker, planNr);
  } catch (e) {
    return { plan: planNr, durch: false, grund: e.message, fehlend: [], dokumente: [],
      fehler: [{ id: planNr, art: t("ursprungNachziehenGescheitert"), grund: e.message }] };
  }
}

/**
 * Zieht nach dem Zug des Pakets dessen Ursprungsdokumente nach und nennt sie im Bericht
 * dieses Laufs (Issue #1286, Plan #1283 A1, A3, A8, A9, E6, E7). Liefert die Auswertung samt
 * `fehler` fuer die Ausgabe, oder null, wenn das Paket keine `Plan:`-Zeile traegt.
 *
 * Der Abschnitt entsteht nur, wenn der Plan durch ist oder das Nachziehen scheiterte, und
 * nur, wenn der Bericht noch keinen traegt: Eine Wiederholung saehe die Dokumente schon in
 * In review und meldete „lag bereits“ statt „gewandert“. Kein Fehler hier aendert den
 * Exit-Code (A8) — das Paket liegt schon in In review. Plan und Anforderung bekommen keinen
 * Kommentar (E7); ihre Zuege buchen weder Wegmarke noch Bewegung (E9).
 */
async function ursprungMelden(tracker, id, laufZeile) {
  const ergebnis = await ursprungDesPakets(tracker, id);
  if (ergebnis === null || ergebnis.plan === null) return ergebnis;
  if (!ergebnis.durch && ergebnis.fehler.length === 0) return ergebnis;

  try {
    const kommentare = await tracker.kommentareStreng(id);
    const ziel = kommentare.findLast((c) => traegtLaufZeile(c.body, laufZeile));
    if (!ziel || ziel.id == null) throw new BoardError(t("berichtNichtGefunden"));
    if (ursprungAbtrennen(ziel.body).abschnitt === null) {
      await tracker.ersetzeKommentar(id, ziel.id, ursprungEinhaengen(ziel.body, ursprungAbschnittText(ergebnis)));
    }
  } catch (e) {
    ergebnis.fehler.push({ id: kartenSchluessel(id), art: t("ursprungAbschnittNichtGeschrieben"), grund: e.message });
  }
  return ergebnis;
}

// ============================================================
// Laufstand einer Karte: issue stand (Issue #1083, Plan #1079 E1, E3, E4)
// ============================================================

// Die Sache je Zustand im Namen-Register (Issue #1428, Plan #1420 E7).
const STAND_LABEL_SACHEN = Object.freeze({ laeuft: "laufLaeuft", abgebrochen: "laufAbgebrochen", wartet: "laufWartet" });

// SYNC: dieselben Vorgaben stehen in templates/workflow.config.schema.json unter
// `night.stand.labels` — test/ablauf-board-dokumente-stand.test.mjs vergleicht beide. Ohne
// gesetzten Wert gilt der englische Name, in jedem Projekt (Issue #1552, Plan #1548 E2).
export const STAND_LABEL_VORGABEN = Object.freeze(Object.fromEntries(
  Object.entries(STAND_LABEL_SACHEN).map(([zustand, sache]) => [zustand, labelName(sache)])));
const STAND_ZUSTAENDE = [...Object.keys(STAND_LABEL_VORGABEN), "fertig"];
const LAUFSTAND_ANKER = "## Laufstand";

/**
 * Die drei Labelnamen aus `night.stand.labels`, fehlende aus den englischen Vorgaben (E4).
 * Ein gesetzter Wert gilt unveraendert (Plan #1420 E7).
 */
export function standLabels(config) {
  const block = config?.night?.stand?.labels ?? {};
  const labels = { ...STAND_LABEL_VORGABEN };
  for (const zustand of Object.keys(STAND_LABEL_VORGABEN)) {
    const wert = block[zustand];
    if (wert === undefined) continue;
    if (typeof wert !== "string" || wert.trim() === "") {
      fail(t("standLabelLeer", { zustand, wert: JSON.stringify(wert) }));
    }
    labels[zustand] = wert.trim();
  }
  if (new Set(Object.values(labels)).size !== Object.keys(labels).length) {
    fail(t("standLabelsGleich", { namen: Object.values(labels).join(", ") }));
  }
  return labels;
}

// Die erste Zeile ist der Anker allein, unter beiden Namen (Issue #1443).
const istLaufstand = (body) => {
  const m = leseMarker(String(body ?? "").replaceAll("\r", "").trimStart().split("\n")[0]);
  return m?.sache === "laufstand" && m.rest.trim() === "";
};

/**
 * Die Labels, die `issue stand` vor dem Setzen abnimmt (Issue #1552, Plan #1548 E3): je
 * Zustand der Config-Wert und jeder getragene Name, den das Register als Sache des Zustands
 * erkennt — so geht auch ein deutsches `lauf:laeuft` ab, wenn das Kit `run:running` schreibt.
 * Das Label des Ziels selbst bleibt; fremde Labels bleiben unberuehrt.
 */
export function standAbzuraeumen(labels, getragen, ziel) {
  const weg = new Set();
  for (const [zustand, name] of Object.entries(labels)) {
    weg.add(name);
    for (const g of getragen || []) {
      if (erkenneLabel(g) === STAND_LABEL_SACHEN[zustand]) weg.add(g);
    }
  }
  weg.delete(ziel);
  return [...weg];
}

/**
 * `issue stand <id> --zustand laeuft|abgebrochen|wartet|fertig --text-file <datei>` —
 * setzt das Label des Zustands, nimmt die beiden anderen ab (bei `fertig` alle drei) und
 * ersetzt den Kommentar mit Anker `## Laufstand` oder legt ihn an. Abgenommen wird auch jeder
 * getragene Name derselben Sache in der anderen Sprache (`standAbzuraeumen`).
 *
 * Wiederholbar wie `berichtAblegen`: gleicher Inhalt -> nichts geschrieben, anderer ->
 * ersetzt, nie ein zweiter. Darum wird STRENG gelesen, und zwar vor jedem Schreiben — ein
 * leer gelesener Stand legte einen zweiten Laufstand an. Die Labelnamen kommen allein aus
 * der Config; ein am Board fehlendes Label meldet der Adapter.
 */
export async function issueStand(tracker, config, args) {
  const id = args._[0];
  const aufruf = t("standAufruf");
  if (!id) fail(t("idErforderlich", { aufruf }));
  if (args.labels !== undefined) fail(t("standLabelsGibtsNicht", { aufruf }));
  if (!STAND_ZUSTAENDE.includes(args.zustand)) {
    fail(t("standZustandUnbekannt", { wert: args.zustand ?? "", erwartet: STAND_ZUSTAENDE.join(" | ") }));
  }
  if (args["text-file"] === undefined) fail(t("standTextFileErforderlich", { aufruf }));
  const labels = standLabels(config);
  const text = await leseTextQuelle(undefined, args["text-file"], "text");
  const rumpf = text.replaceAll("\r\n", "\n").trim();
  const neu = istLaufstand(rumpf) ? rumpf : `${LAUFSTAND_ANKER}\n\n${rumpf}`;

  let kommentare;
  try {
    kommentare = await tracker.kommentareStreng(id);
  } catch (e) {
    fail(t("standKommentareUnlesbar", { id, grund: e.message }));
  }
  const getragen = (await tracker.getIssue(id))?.labels ?? [];

  // Erst abnehmen, dann setzen: So haengen nie zwei Laufstand-Labels zugleich.
  const ziel = labels[args.zustand];
  for (const name of standAbzuraeumen(labels, getragen, ziel)) {
    await tracker.labelIssue(id, name, "remove");
  }
  if (ziel) await tracker.labelIssue(id, ziel, "add");

  const staende = kommentare.filter((c) => istLaufstand(c.body));
  let kommentar;
  if (staende.some((c) => vergleichbar(c.body) === vergleichbar(neu))) {
    kommentar = "unveraendert";
  } else if (staende.length > 0) {
    const alt = staende.at(-1);
    if (alt.id == null) fail(t("standOhneKommentarId", { id }));
    await tracker.ersetzeKommentar(id, alt.id, neu);
    kommentar = "ersetzt";
  } else {
    await tracker.commentIssue(id, neu);
    kommentar = "angelegt";
  }
  out({ ok: true, id, zustand: args.zustand, kommentar });
}

// ============================================================
// Auftrag einer Umsetzung: issue auftrag (Issue #1023, Plan #1015)
// ============================================================

// Die Kommentartexte fuer Folge "backlog" — die einzige Fassung fuer die Skills: Seit
// Issue #1025 tragen `implement-*` sie nicht mehr selbst, sondern posten, was der Auftrag
// liefert (test/skills-transport.test.mjs haelt sie aus den Skills heraus).
// SYNC: dieselben Texte stehen mit dem Praefix `Nachtlauf: ` in kit/night.mjs
// (`pruefeIssueGates`). Wer einen hier aendert, aendert ihn dort mit — der
// Gleichlauf-Test in test/ablauf-board-dokumente-auftrag.test.mjs vergleicht beide Seiten.
// In der Projektsprache (Issue #1479); der Gleichlauf gilt fuer die deutsche Fassung.
export const AUFTRAG_BACKLOG_TEXTE = {
  fachlich: (id) => t("backlogFachlich", { id }),
  idee: (id) => t("backlogIdee", { id }),
  plan: (id) => t("backlogPlan", { id }),
  mensch: () => t("backlogMensch"),
  klaeren: () => t("backlogKlaeren", { label: labelName("klaeren", prozessSprache()) }),
  // SYNC: `GESCHUETZT_LABEL_GATE_TEXT` in kit/night.mjs (Issue #1046, #1052).
  geschuetzt: () => t("backlogGeschuetzt", { label: labelName("geschuetzt", prozessSprache()) }),
};

// Dieselbe Pruefreihenfolge wie `pruefeIssueGates` in kit/night.mjs: erst die Praefixe,
// dann das Label.
const AUFTRAG_PRAEFIXE = [
  [istFachlich, "fachlich"],
  [istIdee, "idee"],
  [istPlan, "plan"],
  [istMensch, "mensch"],
];
const AUFTRAG_SPALTEN = new Set(["ready", "in_progress"]);
// Die Spalten, in denen eine Voraussetzung unerfuellt ist (Issue #1149); jede andere Lage
// gilt als erfuellt — wie `satisfiedIds` in kit/night.mjs.
const AUFTRAG_UNERFUELLT = ["backlog", "ready", "in_progress"];

// SYNC: nachgebaut aus `parseDeps` in kit/night.mjs (DEPS_UEBERSCHRIFT, ABSCHNITTS_ENDE,
// LOKALE_REFERENZ, abschnittLesen) — bewusst kein Import, board.mjs laedt den Runner
// nicht. Der Gleichlauf-Test in test/ablauf-board-dokumente-auftrag.test.mjs faehrt beide Lesungen ueber
// dieselben Fixtures.
// Unter beiden Namen (Issue #1460): `## Abhaengigkeiten` oder `## Dependencies`.
const DEPS_UEBERSCHRIFT = ueberschriftZeile("abhaengigkeiten");
const DEPS_ABSCHNITTS_ENDE = /^ {0,3}##\s/;
const DEPS_REFERENZ = /(?<![\w`/#])#(\d+)/g;

/**
 * Die `#N` aus dem Abschnitt `## Abhaengigkeiten`, ohne Doppelte — Auslegung wie
 * `parseDeps`: Die Ueberschrift zaehlt nur als eigene Zeile ausserhalb eines Fence, bei
 * mehreren gilt die letzte, und eine `##`-Zeile im Fence beendet den Abschnitt nicht.
 */
export function abhaengigkeitenLesen(body) {
  return abhaengigkeitenMitHerkunft(body).map((t) => t.nummer);
}

// Plan #1057 E2: `Issue #N` am Zeilenanfang, davor hoechstens Leerraum und ein Listenzeichen.
const DEPS_VERWEISZEILE = /^\s*(?:(?:[-*+]|\d+\.)\s+)?Issue #\d+/;
const DEPS_STELLE_MAX = 100;

/**
 * Die Nummern von `abhaengigkeitenLesen`, je Nummer mit Herkunft und Textstelle
 * (Issue #1058, Plan #1057 E1–E3): `{ nummer, herkunft: "verweiszeile" | "text", stelle }`.
 *
 * Verweiszeile ist eine Zeile ausserhalb eines Fence, die mit `Issue #N` beginnt und keine
 * weitere lokale Nummer traegt; alles andere ist Text, auch eine Nummer im Codeblock des
 * Abschnitts (`parseDeps` liest sie mit). Die Stelle ist die getrimmte Zeile, auf
 * hoechstens 100 Zeichen gekuerzt. Eine doppelte Nummer steht einmal, an ihrem ersten
 * Vorkommen; traegt sie irgendwo eine Verweiszeile, gilt deren Herkunft und Stelle.
 */
export function abhaengigkeitenMitHerkunft(body) {
  const treffer = new Map();
  for (const { zeile, ausserhalb } of depsAbschnittZeilen(body)) {
    const nummern = [...zeile.matchAll(DEPS_REFERENZ)].map((m) => Number(m[1]));
    const verweis = ausserhalb && nummern.length === 1 && DEPS_VERWEISZEILE.test(zeile);
    const herkunft = verweis ? "verweiszeile" : "text";
    const stelle = depsStelle(zeile);
    for (const nummer of nummern) {
      const bisher = treffer.get(nummer);
      if (!bisher) treffer.set(nummer, { nummer, herkunft, stelle });
      else if (verweis && bisher.herkunft === "text") Object.assign(bisher, { herkunft, stelle });
    }
  }
  return [...treffer.values()];
}

/**
 * Die Hinweise zum Abschnitt `## Abhaengigkeiten` beim Schreiben (Issue #1060, Plan #1057
 * E4, E5): `{ art: "schreibweise" | "dokument" | "unbekannt", nummer, stelle, meldung }` —
 * `schreibweise` je Nummer aus Text, `dokument` je Nummer, deren Karte ein Dokument-Praefix
 * traegt, auch in einer Verweiszeile, `unbekannt` je Nummer, die das Board ausdruecklich
 * nicht kennt (Issue #1149) — sie gilt als erfuellt, ein Tippfehler faellt also nur hier auf.
 * Jede Nummer wird einmal nachgeschlagen; scheitert der Abruf aus anderem Grund, entfaellt
 * ihr Hinweis still.
 */
export async function abhaengigkeitsHinweise(body, tracker) {
  const hinweise = [];
  for (const { nummer, herkunft, stelle } of abhaengigkeitenMitHerkunft(body)) {
    if (herkunft === "text") {
      hinweise.push({
        art: "schreibweise", nummer, stelle,
        meldung: t("hinweisSchreibweise", { nummer, stelle }),
      });
    }
    const dokument = await dokumentArt(tracker, nummer);
    if (dokument?.unbekannt) {
      hinweise.push({
        art: "unbekannt", nummer, stelle,
        meldung: t("hinweisUnbekannt", { nummer }),
      });
    } else if (dokument) {
      hinweise.push({
        art: "dokument", nummer, stelle,
        meldung: t("hinweisDokument", { nummer, praefix: dokument.praefix, satz: dokument.satz }),
      });
    }
  }
  return hinweise;
}

/**
 * Praefix und Satz, wenn die Karte ein Dokument ist; `{ unbekannt: true }`, wenn der Tracker
 * die Nummer nicht kennt; sonst oder bei scheiterndem Abruf null.
 */
async function dokumentArt(tracker, nummer) {
  let titel;
  try {
    titel = (await tracker.getIssue(String(nummer))).title;
  } catch (e) {
    return karteUnbekannt(e) ? { unbekannt: true } : null;
  }
  const sprache = prozessSprache();
  if (istPlan(titel)) return { praefix: praefix("plan", sprache), satz: t("dokumentPlanSatz") };
  if (istFachlich(titel)) return { praefix: praefix("fachlich", sprache), satz: t("dokumentErstSatz") };
  if (istIdee(titel)) return { praefix: praefix("idee", sprache), satz: t("dokumentErstSatz") };
  return null;
}

/**
 * Haengt die Hinweise an die Ausgabe eines Schreibwegs, sofern der Body einen Abschnitt
 * `## Abhaengigkeiten` hat und es welche gibt. Ein Fehler dabei laesst den Schreibweg
 * gelingen, dann ohne `hinweise` — geschrieben ist ohnehin schon.
 */
async function mitAbhaengigkeitsHinweisen(ergebnis, body, tracker) {
  if (depsAbschnittZeilen(body).length === 0) return ergebnis;
  try {
    const hinweise = await abhaengigkeitsHinweise(body, tracker);
    return hinweise.length > 0 ? { ...ergebnis, hinweise } : ergebnis;
  } catch {
    return ergebnis;
  }
}

/** Die Zeilen des Abschnitts `## Abhaengigkeiten` samt Fence-Lage — leer, wenn er fehlt. */
function depsAbschnittZeilen(body) {
  const zeilen = String(body || "").split(/\r\n|\r|\n/);
  const imFence = fenceLauf();
  const ausserhalb = zeilen.map((z) => !imFence(z));
  let start = -1;
  zeilen.forEach((z, i) => { if (ausserhalb[i] && DEPS_UEBERSCHRIFT.test(z)) start = i; });
  if (start < 0) return [];
  let ende = zeilen.length;
  for (let i = start + 1; i < zeilen.length; i++) {
    if (ausserhalb[i] && DEPS_ABSCHNITTS_ENDE.test(zeilen[i])) { ende = i; break; }
  }
  return zeilen.slice(start + 1, ende).map((zeile, k) => ({ zeile, ausserhalb: ausserhalb[start + 1 + k] }));
}

function depsStelle(zeile) {
  const getrimmt = zeile.trim();
  return getrimmt.length > DEPS_STELLE_MAX ? getrimmt.slice(0, DEPS_STELLE_MAX - 1) + "…" : getrimmt;
}

/**
 * Die Spalte einer Karte, oder null, wenn sie sich nicht bestimmen laesst.
 *
 * Drei Tracker liefern sie mit der Karte. GitHub nicht (`status: null`, die Spalte lebt
 * im Project): Dort wird sie ueber `listIssues(<spalte>)` gesucht, in der uebergebenen
 * Reihenfolge und nur so weit wie noetig. `spaltenListen` cacht je Aufruf die Listen.
 */
async function auftragSpalte(tracker, issue, reihenfolge, spaltenListen) {
  if (VALID_STATUSES.includes(issue.status)) return issue.status;
  if (!(tracker instanceof GitHubIssueTracker)) return null;
  for (const spalte of [...reihenfolge, ...VALID_STATUSES.filter((s) => !reihenfolge.includes(s))]) {
    if (!spaltenListen.has(spalte)) spaltenListen.set(spalte, await tracker.listIssues(spalte));
    if (spaltenListen.get(spalte).some((i) => String(i.id) === String(issue.id))) return spalte;
  }
  return null;
}

/**
 * Das Urteil ueber eine Voraussetzung (Issue #1149): unerfuellt nur in Backlog, Ready oder
 * In progress; jede andere Spalte und eine Nummer, die der Tracker nicht kennt, gilt als
 * erfuellt. Antwortet das Board nicht, bleibt sie "nicht feststellbar".
 */
async function auftragVoraussetzung(tracker, nummer, spaltenListen) {
  let karte;
  try {
    karte = await tracker.getIssue(String(nummer));
  } catch (e) {
    if (karteUnbekannt(e)) return { id: String(nummer), titel: null, spalte: null, befund: "erfuellt", grund: t("nichtAufDemBoard") };
    return { id: String(nummer), titel: null, spalte: null, befund: "nicht feststellbar", grund: t("karteNichtLesbar", { grund: e.message }) };
  }
  let spalte;
  try {
    spalte = await auftragSpalte(tracker, { ...karte, id: String(nummer) }, AUFTRAG_UNERFUELLT, spaltenListen);
  } catch (e) {
    return { id: String(nummer), titel: karte.title ?? null, spalte: null, befund: "nicht feststellbar", grund: t("spalteNichtLesbar", { grund: e.message }) };
  }
  const eintrag = { id: String(nummer), titel: karte.title ?? null, spalte };
  return { ...eintrag, befund: AUFTRAG_UNERFUELLT.includes(spalte) ? "unerfuellt" : "erfuellt" };
}

/**
 * Der Tracker kennt die Nummer nicht — anders als ein Abruf, der scheitert (Issue #1149).
 * Lokaler Tracker und Toolbox werfen `Issue <n> nicht gefunden` (englisch `not found`), gh und glab ihre eigene
 * Meldung. Ein fehlendes CLI ("gh nicht gefunden") zaehlt nicht dazu.
 */
function karteUnbekannt(e) {
  if (e instanceof BoardError) return /^Issue \S+ (?:nicht gefunden|not found)/.test(e.message);
  return /Could not resolve to an issue|404 Not Found/i.test(String(e?.message ?? ""));
}

const ohneFuehrendeNullen = (id) => String(id).replace(/^0+(?=\d)/, "");

/**
 * Die Nummern aller GANZEN Zeilen `<feld>: Issue #N` — Zeilenregel wie `stammtAusErzeugung`
 * in kit/night.mjs: Eine Erwaehnung im Fliesstext zaehlt nicht, und das Zeilenende hinter
 * der Nummer trennt #30 von #300. Verglichen wird ohne fuehrende Nullen, weil der lokale
 * Tracker seine Nummern mit ihnen schreibt.
 */
export function herkunftNummern(body, feld) {
  // Das Feld kommt mit seinem deutschen Namen; gelesen wird es unter beiden (Issue #1443).
  const sache = erkenneMarker(`${feld}:`);
  if (sache === null) throw new Error(`herkunftNummern: unbekanntes Feld "${feld}"`);
  return markerWerte(body, sache).map((rest) => HERKUNFT_REST.exec(rest)?.[1]).filter(Boolean).map(ohneFuehrendeNullen);
}

// Der Rest einer Herkunftszeile hinter dem Feld: `Issue #N` bis zum Zeilenende.
const HERKUNFT_REST = /^[^\S\n]*Issue[^\S\n]*#(\d+)[^\S\n]*$/;

// Die Kontext-Zeile `Plan-Entscheidungen: E1, E3` (oder `Keine.`), die `/issues` in jedes
// Paket aus einem Plan schreibt (Plan #1015, E1). Gelesen werden die `E<n>` nur aus dieser
// einen Zeile — eine Freitextsuche im Paket traefe auch `E2E`. Der Name kommt aus dem
// Register, erkannt werden beide (Issue #1443).
const E_NUMMER = /\bE(\d+)\b/g;

/** Die genannten `E<n>` ohne Doppelte, `[]` bei `Keine.`, `null` ohne die Zeile (Altbestand). */
function planAuswahlLesen(body) {
  const wert = markerWerte(body, "planEntscheidungen")[0];
  if (wert === undefined) return null;
  return [...new Set([...wert.matchAll(E_NUMMER)].map((t) => `E${Number(t[1])}`))];
}

/**
 * Der Inhalt des `##`-Abschnitts `name` woertlich, ohne Rand-Leerzeilen; `null`, wenn er
 * fehlt oder leer ist. Anders als `zerlegeAbschnitte` bleiben Codebloecke Inhalt: Eine
 * `##`-Zeile darin beendet den Abschnitt nicht und wird mit ausgegeben.
 */
function abschnittWoertlich(body, name) {
  const zeilen = normalisiereZeilenenden(body).split("\n");
  const imFence = fenceLauf();
  // Je Zeile die Ueberschrift ausserhalb eines Codeblocks, sonst null.
  const koepfe = zeilen.map((z) => (imFence(z) ? null : ABSCHNITT_ZEILE.exec(z)?.[1] ?? null));
  const soll = kanonischeUeberschrift(name);
  const start = koepfe.findIndex((k) => k !== null && kanonischeUeberschrift(k) === soll);
  if (start < 0) return null;
  const naechster = koepfe.findIndex((k, i) => i > start && k !== null);
  const inhalt = zeilen.slice(start + 1, naechster < 0 ? zeilen.length : naechster);
  const nichtLeer = (z) => z.trim() !== "";
  const von = inhalt.findIndex(nichtLeer);
  if (von < 0) return null;
  return inhalt.slice(von, inhalt.findLastIndex(nichtLeer) + 1).join("\n");
}

// Ein Eintrag im zweizeiligen Format aus `CLAUDE-workflow.md` („Entscheiden statt fragen“):
// `- E<n>: <Frage>` und eingerueckte Folgezeilen. Eine Leerzeile oder eine nicht
// eingerueckte Zeile beendet ihn.
const E_EINTRAG = /^ {0,3}[-*][ \t]+E(\d+):/;
const E_FOLGEZEILE = /^[ \t]+\S/;

/** Die E-Eintraege aus `## Architektonische Entscheidungen` im Wortlaut, `null` ohne den Abschnitt. */
function planEintraegeLesen(planBody) {
  const abschnitt = abschnittWoertlich(planBody, "Architektonische Entscheidungen");
  if (abschnitt === null) return null;
  const eintraege = [];
  let aktuell = null;
  for (const zeile of abschnitt.split("\n")) {
    const m = E_EINTRAG.exec(zeile);
    if (m) {
      aktuell = { id: `E${Number(m[1])}`, zeilen: [zeile] };
      eintraege.push(aktuell);
    } else if (aktuell && E_FOLGEZEILE.test(zeile)) {
      aktuell.zeilen.push(zeile);
    } else {
      aktuell = null;
    }
  }
  return eintraege.map((e) => ({ id: e.id, text: e.zeilen.join("\n") }));
}

/** Plan-Entscheidungen nach Plan #1015, E1. Jede fehlende Angabe landet in `luecken`. */
function auftragPlanEntscheidungen(karte, planNr, plan, luecken) {
  const auswahl = planAuswahlLesen(karte.body);
  const glied = (hinweis, eintraege = []) => ({ plan: planNr, auswahl, hinweis, eintraege });
  const luecke = (was) => luecken.push(t("lueckePlanEntscheidungen", { was }));
  if (planNr === null) {
    luecke(t("keinVorhabenGrund"));
    return glied(t("keinVorhaben"));
  }
  if (plan.fehler) {
    luecke(t("lueckePlanNichtLesbar", { plan: planNr, grund: plan.fehler }));
    return glied(null);
  }
  if (auswahl !== null && auswahl.length === 0) {
    return glied(t("hinweisKeineAuswahl"));
  }
  const alle = planEintraegeLesen(plan.body) ?? [];
  if (alle.length === 0) {
    luecke(t("lueckePlanOhneEintrag", { plan: planNr, abschnitt: ueberschriftName("architektonischeEntscheidungen", prozessSprache()) }));
  }
  if (auswahl === null) {
    return glied(t("hinweisAlleEintraege"), alle);
  }
  const eintraege = [];
  for (const id of auswahl) {
    const eintrag = alle.find((e) => e.id === id);
    if (eintrag) eintraege.push(eintrag);
    else if (alle.length > 0) luecken.push(t("lueckeEntscheidungFehlt", { e: id, plan: planNr }));
  }
  return glied(null, eintraege);
}

/** Fachlicher Anlass nach Plan #1015, E4: aus dem Paket, sonst aus dem Plan. */
async function auftragFachlicherAnlass(tracker, karte, plan, luecken) {
  const ausPaket = herkunftNummern(karte.body, "Fachliche Quelle")[0];
  const ausPlan = plan?.body === undefined ? undefined : herkunftNummern(plan.body, "Fachliche Quelle")[0];
  const quelle = ausPaket ?? ausPlan ?? null;
  const leer = { quelle: null, herkunft: null, ziel: null, kriterien: null, vollerText: null };
  const luecke = (was) => luecken.push(t("lueckeAnlass", { was }));
  if (quelle === null) {
    luecke(t("anlassOhneQuelle"));
    return leer;
  }
  const anlass = {
    quelle,
    herkunft: ausPaket ? "paket" : "plan",
    ziel: null,
    kriterien: null,
    vollerText: t("anlassVollerText", { quelle }),
  };
  let body;
  try {
    body = (await tracker.getIssue(quelle)).body ?? "";
  } catch (e) {
    luecke(t("anlassNichtLesbar", { quelle, grund: e.message }));
    return anlass;
  }
  anlass.ziel = abschnittWoertlich(body, "Ziel");
  anlass.kriterien = abschnittWoertlich(body, "Fachliche Akzeptanzkriterien");
  const fehlt = (sache) => luecke(t("anlassAbschnittFehlt", { quelle, abschnitt: ueberschriftName(sache, prozessSprache()) }));
  if (anlass.ziel === null) fehlt("ziel");
  if (anlass.kriterien === null) fehlt("fachlicheKriterien");
  return anlass;
}

/**
 * Alle Karten ueber die fuenf Spalten, je mit Body und Spalte (Plan #1015, E7).
 *
 * Die Spalte kommt aus den Spaltenlisten `listIssues(<spalte>)` — dieselbe Lesung wie fuer
 * die Voraussetzungen, `spaltenListen` teilt sie. Bei local, gitlab und toolbox tragen diese
 * Listen auch den Body. GitHub liefert dort keinen Body; die Bodies kommen deshalb aus
 * `listAlleMitBody`, und eine Karte, die in keiner Spaltenliste steht, hat Spalte `null`.
 */
export async function auftragAlleKarten(tracker, spaltenListen) {
  for (const s of VALID_STATUSES) {
    if (!spaltenListen.has(s)) spaltenListen.set(s, await tracker.listIssues(s));
  }
  const spalteVon = new Map();
  const ausListen = new Map();
  for (const s of VALID_STATUSES) {
    // Nur Eintraege, die die Spalte tragen: Ohne bestimmbares Project faellt GitHub auf
    // alle offenen Issues mit `status: null` zurueck — die gehoeren keiner Spalte.
    for (const i of spaltenListen.get(s).filter((k) => k.status === s)) {
      const id = ohneFuehrendeNullen(i.id);
      if (!spalteVon.has(id)) spalteVon.set(id, s);
      if (!ausListen.has(id)) ausListen.set(id, i);
    }
  }
  const karten = tracker instanceof GitHubIssueTracker ? await tracker.listAlleMitBody() : [...ausListen.values()];
  return karten.map((k) => {
    const id = ohneFuehrendeNullen(k.id);
    return { id, titel: k.title ?? "", body: k.body ?? "", spalte: spalteVon.get(id) ?? null };
  });
}

/** Geschwister nach Plan #1015, E7: alle Karten mit der ganzen Zeile `Plan: Issue #M`. */
async function auftragGeschwister(tracker, nummer, planNr, spaltenListen, luecken) {
  if (planNr === null) {
    luecken.push(t("lueckeGeschwister", { was: t("keinVorhabenGrund") }));
    return { plan: null, hinweis: t("keinVorhaben"), karten: [] };
  }
  let alle;
  try {
    alle = await auftragAlleKarten(tracker, spaltenListen);
  } catch (e) {
    luecken.push(t("lueckeGeschwister", { was: t("geschwisterNichtLesbar", { grund: e.message }) }));
    return { plan: planNr, hinweis: t("geschwisterHinweisNichtLesbar"), karten: [] };
  }
  const karten = alle
    .filter((k) => k.id !== nummer && herkunftNummern(k.body, "Plan").includes(planNr))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(({ id, titel, spalte }) => ({ id, titel, spalte }));
  for (const k of karten.filter((g) => g.spalte === null)) {
    luecken.push(t("lueckeGeschwisterSpalte", { id: k.id }));
  }
  return { plan: planNr, hinweis: null, karten };
}

// Die Kommentare einer Karte: mit der Karte geliefert, beim lokalen Tracker aus der Datei.
async function auftragKommentare(tracker, id, karte) {
  if (Array.isArray(karte.comments)) return karte.comments;
  if (typeof tracker.kommentareStreng !== "function") return [];
  try {
    return await tracker.kommentareStreng(id);
  } catch {
    return [];
  }
}

// Die Schritte bei Folge "geschuetzt" (Plan #987, E11): Erst nach dem `label add` steht
// fest, welche Label-Zeile der Kommentar traegt — und nur `gesetzt` gibt nach E5 frei.
function geschuetztSchritte(id, treffer, geschuetzt) {
  const { GESCHUETZT_LABEL, GESCHUETZT_LABEL_GESETZT, GESCHUETZT_LABEL_NICHT_GESETZT } = geschuetzt;
  const pfade = [...new Set(treffer.map((t) => t.pfad))].join(", ");
  return t("geschuetztSchritte", { pfade, id, label: GESCHUETZT_LABEL, gesetzt: GESCHUETZT_LABEL_GESETZT,
    nichtGesetzt: GESCHUETZT_LABEL_NICHT_GESETZT });
}

// Das Urteil nach Plan #1015, E6, um die geschuetzten Dateien erweitert (Issue #1052, Plan
// #987, E10). Reihenfolge: Spalte, Praefix, kit:klaeren, kit:geschuetzt, geschuetzter Pfad,
// Voraussetzungen — wie `pruefeIssueGates` in kit/night.mjs. Die Erkennung geschuetzter
// Dateien (`geschuetzteTreffer`, `geschuetztFreigabe`, `geschuetztKommentar` und die Label-
// Konstanten) fuehrt der Abschnitt "Geschuetzte Pfade"; der Aufrufer reicht sie herein
// (Issue #1218), damit dieser Teil nicht aus dem Einstieg importiert.
function auftragUrteil(id, spalte, erwartet, karte, voraussetzungen, kommentare, geschuetzt) {
  const { geschuetzteTreffer, geschuetztFreigabe, geschuetztKommentar } = geschuetzt;
  const nicht = (folge, grund, kommentar = null) => ({ urteil: t("urteilDarfNicht"), folge, grund, kommentar });
  if (spalte !== erwartet) {
    const wo = spalte ? COLUMN_DEFAULTS[spalte] : t("urteilKeineSpalte");
    return nicht("bleibt", t("urteilNichtInSpalte", { id, erwartet: COLUMN_DEFAULTS[erwartet], wo }));
  }
  const art = AUFTRAG_PRAEFIXE.find(([passt]) => passt(karte.title))?.[1];
  if (art) {
    return nicht("backlog", t("urteilPraefix", { praefix: praefix(art, prozessSprache()) }), AUFTRAG_BACKLOG_TEXTE[art](id));
  }
  // Beide Labels unter jedem ihrer Namen (Issue #1424, Plan #1420 E8); der Grund nennt den
  // Namen, den die Karte traegt.
  const labels = karte.labels || [];
  const klaeren = labels.find((name) => erkenneLabel(name) === "klaeren");
  if (klaeren) {
    return nicht("backlog", t("urteilKlaeren", { label: klaeren }), AUFTRAG_BACKLOG_TEXTE.klaeren(id));
  }
  const geschuetztLabel = labels.find((name) => erkenneLabel(name) === "geschuetzt");
  if (geschuetztLabel) {
    return nicht("backlog", t("urteilGeschuetztLabel", { label: geschuetztLabel }), AUFTRAG_BACKLOG_TEXTE.geschuetzt(id));
  }
  const treffer = geschuetzteTreffer(karte.body || "", karte.title || "", configWurzel());
  if (treffer.length > 0 && !geschuetztFreigabe(treffer, kommentare, labels)) {
    return nicht("geschuetzt", geschuetztSchritte(id, treffer, geschuetzt), geschuetztKommentar(treffer));
  }
  const offen = voraussetzungen.filter((v) => v.befund !== "erfuellt");
  if (offen.length > 0) {
    const liste = offen.map((v) => `#${v.id} ${befundText(v.befund)}`).join(", ");
    return nicht("bleibt", t("urteilVoraussetzung", { liste }));
  }
  return { urteil: t("urteilDarfBeginnen"), folge: "beginnen", grund: null, kommentar: null };
}

// Ein Text im Codeblock, dessen Zaun laenger ist als jeder Backtick-Lauf im Text: So
// bleiben die `##`-Ueberschriften des Bodys Inhalt und keine Glieder der Ausgabe.
function eingezaeunt(text) {
  const laengster = Math.max(0, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
  const zaun = "`".repeat(Math.max(3, laengster + 1));
  return `${zaun}markdown\n${ohneSchlussUmbrueche(String(text))}\n${zaun}`;
}

// Ohne Regex: `/\n+$/` waere ein Kandidat fuer quadratische Laufzeit (sonarjs/slow-regex).
function ohneSchlussUmbrueche(text) {
  let ende = text.length;
  while (ende > 0 && text[ende - 1] === "\n") ende--;
  return text.slice(0, ende);
}

function auftragKommentarBlock(k) {
  return `\n\n${k.author || t("auftragKommentarUnbekannt")}, ${k.createdAt || t("auftragKommentarOhneDatum")}:\n\n${eingezaeunt(k.body)}`;
}

// Der Befund in Worten; im JSON bleibt er Vertrag (E14).
function befundText(befund) {
  if (befund === "erfuellt") return t("befundErfuellt");
  if (befund === "unerfuellt") return t("befundUnerfuellt");
  return t("nichtFeststellbar");
}

function auftragVoraussetzungZeile(v) {
  const grund = v.grund ? " (" + v.grund + ")" : "";
  const spalte = v.spalte ?? (v.befund === "erfuellt" ? t("auftragKeine") : t("nichtFeststellbar"));
  return t("auftragVoraussetzung", { id: v.id, titel: v.titel ?? t("auftragOhneTitel"), spalte, befund: befundText(v.befund), grund });
}

const auftragGlied = (schluessel, inhalt) => `## ${t(schluessel)}\n\n${inhalt}`;

function auftragMarkdown(a) {
  const u = a.urteil;
  let urteil = t("auftragUrteilZeile", { urteil: u.urteil, folge: u.folge });
  if (u.grund) urteil += `\n${t("auftragGrund", { grund: u.grund })}`;
  if (u.kommentar) urteil += `\n\n${t("auftragKommentarWoertlich")}\n\n${u.kommentar}`;
  const teile = [auftragGlied("auftragKopfUrteil", urteil)];

  const auf = a.aufgabe;
  let aufgabe = `Issue #${auf.id}: ${auf.titel}\n${t("auftragSpalte", { spalte: auf.spalte ?? t("nichtFeststellbar") })}\n`
    + `${t("auftragLabels", { labels: auf.labels.length ? auf.labels.join(", ") : t("auftragKeine") })}\n\n${eingezaeunt(auf.body)}`;
  const kommentarBloecke = auf.kommentare.map(auftragKommentarBlock).join("");
  aufgabe += auf.kommentare.length === 0
    ? `\n\n${t("auftragKommentareKeine")}`
    : `\n\n${t("auftragKommentareAnzahl", { anzahl: auf.kommentare.length })}${kommentarBloecke}`;
  teile.push(auftragGlied("auftragKopfAufgabe", aufgabe));

  teile.push(auftragGlied("auftragKopfPlan", planEntscheidungenMarkdown(a.planEntscheidungen)));
  teile.push(auftragGlied("auftragKopfAnlass", fachlicherAnlassMarkdown(a.fachlicherAnlass, a.planEntscheidungen.plan)));
  teile.push(auftragGlied("auftragKopfGeschwister", geschwisterMarkdown(a.geschwister)));

  const keine = t("auftragKeinePunkt");
  const voraus = a.voraussetzungen.length === 0 ? keine : a.voraussetzungen.map(auftragVoraussetzungZeile).join("\n");
  teile.push(auftragGlied("auftragKopfVoraussetzungen", voraus));
  teile.push(auftragGlied("auftragKopfLuecken", a.luecken.length === 0 ? keine : a.luecken.map((l) => "- " + l).join("\n")));
  return `${teile.join("\n\n")}\n`;
}

function planEntscheidungenMarkdown(p) {
  if (p.plan === null) return t("auftragOhnePlan");
  const teile = [`Plan: Issue #${p.plan}`];
  if (p.hinweis) teile.push(p.hinweis);
  if (p.eintraege.length > 0) teile.push(p.eintraege.map((e) => e.text).join("\n"));
  else if (!p.hinweis) teile.push(t("auftragKeineSieheLuecken"));
  return teile.join("\n\n");
}

function fachlicherAnlassMarkdown(f, planNr) {
  if (f.quelle === null) return t("auftragKeineQuelle");
  const herkunft = f.herkunft === "paket" ? t("auftragAusPaket") : t("auftragAusPlan", { plan: planNr });
  const abschnitt = (text) => (text === null ? t("auftragFehlt") : eingezaeunt(text));
  const sprache = prozessSprache();
  return `${t("auftragQuelle", { quelle: f.quelle, herkunft })}\n\n### ${ueberschriftName("ziel", sprache)}\n\n${abschnitt(f.ziel)}\n\n`
    + `### ${ueberschriftName("fachlicheKriterien", sprache)}\n\n${abschnitt(f.kriterien)}\n\n${f.vollerText}`;
}

function geschwisterMarkdown(g) {
  if (g.plan === null) return t("auftragOhnePlan");
  const zeilen = g.karten.map((k) => t("auftragGeschwisterZeile", {
    id: k.id, titel: k.titel || t("auftragOhneTitel"), spalte: k.spalte ?? t("nichtFeststellbar"),
  }));
  return `Plan: Issue #${g.plan}\n\n${g.hinweis ?? (zeilen.length > 0 ? zeilen.join("\n") : t("auftragKeinePunkt"))}`;
}

/**
 * `issue auftrag <id> [--spalte ready|in_progress] [--json]` — Aufgabe, Voraussetzungen
 * und das Urteil, ob eine Umsetzung beginnen darf, in einem Aufruf (Issue #1023, Plan
 * #1015 E2, E3, E5, E6), dazu Plan-Entscheidungen, fachlicher Anlass und Geschwister
 * (Issue #1024, E1, E4, E7). Jede Angabe, die sich nicht ermitteln laesst, steht unter
 * Luecken — keine stille Luecke (AK 3).
 *
 * Rein lesend: keine Bewegung, kein Kommentar. Bei Folge "backlog" liefert der Befehl den
 * Kommentartext, den die Session selbst ans Board haengt; bei Folge "geschuetzt" (Issue
 * #1052) den Halt-Text aus `geschuetztKommentar`, ohne Label-Zeile, die Schritte im Grund. Exit 0 auch bei "darf nicht
 * beginnen" — das ist eine Auskunft, kein Fehler. Exit 1 nur, wenn das Paket selbst nicht
 * lesbar ist.
 *
 * Ausgabe als Markdown, je Glied eine `##`-Ueberschrift in fester Reihenfolge; `--json`
 * liefert dieselben Glieder als Felder. Die einzige Ausnahme von "Ausgabe: JSON".
 */
export async function issueAuftrag(tracker, args, geschuetzt) {
  const id = args._[0];
  if (!id) fail(t("idErforderlich", { aufruf: t("auftragAufruf") }));
  const erwartet = args.spalte ?? "ready";
  if (!AUFTRAG_SPALTEN.has(erwartet)) fail(t("auftragSpalteUngueltig", { spalte: erwartet }));

  let karte;
  try {
    karte = await tracker.getIssue(String(id));
  } catch (e) {
    fail(t("paketNichtLesbar", { id, grund: e.message }));
  }
  const nummer = String(karte.id ?? id).replace(/^0+(?=\d)/, "");
  const spaltenListen = new Map();
  const spalte = await auftragSpalte(tracker, { ...karte, id: nummer }, [erwartet], spaltenListen);

  const voraussetzungen = [];
  for (const n of abhaengigkeitenLesen(karte.body)) voraussetzungen.push(await auftragVoraussetzung(tracker, n, spaltenListen));

  const luecken = [];
  const planNr = herkunftNummern(karte.body, "Plan")[0] ?? null;
  let plan = null;
  if (planNr !== null) {
    try {
      plan = { body: (await tracker.getIssue(planNr)).body ?? "" };
    } catch (e) {
      plan = { fehler: e.message };
    }
  }
  const planEntscheidungen = auftragPlanEntscheidungen(karte, planNr, plan, luecken);
  const fachlicherAnlass = await auftragFachlicherAnlass(tracker, karte, plan, luecken);
  const geschwister = await auftragGeschwister(tracker, nummer, planNr, spaltenListen, luecken);
  if (spalte === null) luecken.push(t("lueckeSpalte"));
  for (const v of voraussetzungen.filter((x) => x.befund === "nicht feststellbar")) {
    luecken.push(t("lueckeVoraussetzung", { id: v.id, grund: v.grund }));
  }

  const kommentare = (await auftragKommentare(tracker, id, karte)).map((k) => ({ author: k.author ?? "", createdAt: k.createdAt ?? null, body: k.body ?? "" }));
  const auftrag = {
    id: nummer,
    urteil: auftragUrteil(nummer, spalte, erwartet, karte, voraussetzungen, kommentare, geschuetzt),
    aufgabe: {
      id: nummer,
      titel: karte.title ?? "",
      spalte,
      labels: karte.labels || [],
      body: karte.body ?? "",
      kommentare,
    },
    planEntscheidungen,
    fachlicherAnlass,
    geschwister,
    voraussetzungen,
    luecken,
  };
  if (args.json) out(auftrag);
  else process.stdout.write(auftragMarkdown(auftrag));
}

// Schreibt den Body eines bestehenden Issues (Issue #237). Bewusst nur --body:
// Titel und Labels aendert kein Skill, und ein Kommando, das alles kann, laedt dazu
// ein, mehr zu aendern als beabsichtigt.
//
// Ein leerer Body ist ein harter Fehler statt eines stillen No-ops — ein
// versehentlich geleerter Issue-Body ist nicht wiederherstellbar.
export async function issueUpdate(tracker, args) {
  const id = args._[0];
  if (!id) fail(t("idErforderlich", { aufruf: 'issue update <id> --body "..."' }));
  const neu = await leseTextQuelle(args.body, args["body-file"], "body");
  // Seit Plan #638 (A15) ohne Pruefvorgabe-Leitplanke: Der Body wird geschrieben, wie
  // er kommt.
  await tracker.updateIssue(id, { body: neu });
  out(await mitAbhaengigkeitsHinweisen({ ok: true, id }, neu, tracker));
}

// ============================================================
// Formpruefung: issue check-form (Issue #628)
// ============================================================

/** Die Titel der Formatueberschriften `sachen`, wie `zerlegeAbschnitte` sie liefert. */
export function abschnittsTitel(...sachen) {
  return sachen.map((sache) => kanonischeUeberschrift(ueberschriftName(sache, "de")));
}

/** Die Eingabewege von `issue check-form` in der Projektsprache (Issue #1479). */
export function checkFormWege() {
  return t("checkFormWege");
}

/**
 * Die Pflichtabschnitte je Stufe, normalisiert (klein, transliteriert) unter ihrem deutschen
 * Namen; `zerlegeAbschnitte` fuehrt einen englischen Titel auf ihn zurueck (Issue #1460).
 */
export const CHECK_FORM_ABSCHNITTE = {
  fachlich: abschnittsTitel("ziel", "fachlicheKriterien", "nichtZiele", "poFragen"),
  plan: abschnittsTitel("ziel", "betroffeneBereiche", "architektonischeEntscheidungen", "geplanteAenderungen", "offeneFragen", "verifizierung"),
  issue: abschnittsTitel("kontext", "aufgabe", "akzeptanzkriterium", "abhaengigkeiten"),
};

// Die Kopfzeile eines `##`-Abschnitts; Gruppe 1 ist ihr Titel.
//
// Der Titel laeuft greedy bis zum Zeilenende, und dahinter steht nichts mehr, was
// scheitern koennte: Das alte `(.+?)[ \t]*$` war ein S8786-Fund (Issue #877), weil das
// lazy Stueck und der Leerraum-Lauf dieselben Zeichen akzeptierten. Den Leerraum am Ende
// stutzt ohnehin `kanonischeUeberschrift` — im Ausdruck stand er doppelt.
export const ABSCHNITT_ZEILE = /^##[ \t]+([^\n]+)/;

/**
 * Zerlegt den Body ohne Codebloecke in Kopf und `##`-Abschnitte.
 *
 * Dieselbe Fence-Auslegung wie ueberall im Adapter (`fenceLauf`): Eine
 * Ueberschrift im Codeblock existiert fuer die Pruefung nicht — weder als
 * Treffer noch als Verstoss. `###` ist keine Abschnittsgrenze. Der Titel ist kanonisch
 * (`kanonischeUeberschrift`, Issue #1460): `## Dependencies` heisst wie `## Abhaengigkeiten`
 * `abhaengigkeiten`, damit die Formgates beide Namen gleich behandeln.
 */
export function zerlegeAbschnitte(body) {
  const imFence = fenceLauf();
  const kopf = [];
  const abschnitte = [];
  let aktuell = null;
  for (const zeile of normalisiereZeilenenden(body).split("\n")) {
    if (imFence(zeile)) continue;
    const m = ABSCHNITT_ZEILE.exec(zeile);
    if (m) {
      aktuell = { titel: kanonischeUeberschrift(m[1]), zeilen: [] };
      abschnitte.push(aktuell);
      continue;
    }
    (aktuell ? aktuell.zeilen : kopf).push(zeile);
  }
  return { kopf, abschnitte };
}
