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
 * Ausgabe: JSON auf stdout. Fehler: Meldung auf stderr, Exit-Code 1.
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

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, realpathSync, accessSync, constants } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "2.0.6";

const VALID_STATUSES = ["backlog", "ready", "in_progress", "in_review", "done"];

const COLUMN_DEFAULTS = {
  backlog:     "Backlog",
  ready:       "Ready",
  in_progress: "In progress",
  in_review:   "In review",
  done:        "Done",
};

function columnLabels(config) {
  return config.columns || COLUMN_DEFAULTS;
}

// Entscheidungskriterium fuer den GitLab-Adapter: 'done' ist immer der GitLab-Zustand
// Closed. 'backlog' ist der GitLab-Zustand Open nur, wenn so konfiguriert
// (columns.backlog === "Open"); sonst ein normales Label. Alle anderen Spalten sind
// immer Labels. Einzige Quelle der Wahrheit fuer createIssue/moveIssue/listIssues/labelToStatus.
function isStateColumn(status, config) {
  if (status === "done") return true;
  if (status === "backlog") return columnLabels(config).backlog === "Open";
  return false;
}

const HELP = `board.mjs — Board-Adapter fuer das claude-workflow-kit

Nutzung:
  node board.mjs issue create --title "..." --body "..." | --body-file <pfad> | --body -
                             [--author-model <modell>] [--derived-from <nummer>]
      --derived-from traegt die Kartennummer des naechsten Vorfahren ins Board
      (Issue #356). Nur kanbancompat wertet sie aus; die uebrigen Tracker nehmen
      sie folgenlos an. Nachtragen geht nicht — sie wirkt nur beim Anlegen.
  node board.mjs issue get <id>
  node board.mjs issue activity <id>      Aktivitaetsverlauf (local, toolbox)
  node board.mjs issue activity --ids <n,n,...>
      Verlauf mehrerer Karten als Objekt {"<nummer>": [...]}. Loest die Kartenliste
      genau einmal auf; eine unbekannte Nummer erscheint mit Fehlergrund (Issue #786).
  node board.mjs issue list [--status <status>]
  node board.mjs issue move <id> <status>
  node board.mjs issue update <id> --body "..." | --body-file <pfad> | --body -
  node board.mjs issue comment <id> --text "..." | --text-file <pfad> | --text -
      '-' liest von stdin, gut fuer kurze Texte; fuer lange '--text-file' (Issue #584).
  node board.mjs issue label add <id> <name>
  node board.mjs issue label remove <id> <name>
      Zeichnet ein Issue (z. B. kit:klaeren). Status-Labels aendert \`issue move\`.
  node board.mjs issue check-form <id>
  node board.mjs issue check-form --body-file <pfad> --title "<titel>"
      Formpruefung gegen die maschinellen Gates der Stufe (Issue #628): fachlich
      F1 F2 F6 F7 F9 F11, plan P1 P2 P3 P6 P12, Arbeitspaket I1 bis I5. Die Stufe
      kommt aus dem Titel-Praefix. Immer JSON ({ ok, stufe, verstoesse }), Exit 1
      bei Verstoessen; ein abgewiesener Aufruf traegt 'fehler'. Schreibt nie ans Board.
  node board.mjs code repo-name
  node board.mjs code pr --from <branch> --to <branch>
  node board.mjs code ci-status --commit <sha>
      Zustand der CI fuer genau diesen Commit (Issue #316):
      { status: gruen|rot|laeuft|keine, jobs: [{ name, ergebnis }] }. Vorrang rot vor
      laeuft vor gruen; 'keine' nur bei codeHost local, ein am Host noch unsichtbarer
      Lauf ist 'laeuft'.
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

  node board.mjs --version

Gueltige Status-Werte: ${VALID_STATUSES.join(" | ")}

Konfiguration: .claude/workflow.config.json (issueTracker, codeHost)
Fuer die kontext-Achse zusaetzlich: ~/.claude/kontext.config.json und
.claude/kontext.config.json (gemergt, lokale Felder gewinnen).
Fuer GitHub-Board-Integration: github.projectNumber in der Config setzen. Fehlt sie,
wird bei genau einem GitHub Project fuer den Owner automatisch dessen Nummer verwendet.
`;

// --- Shell-Hilfsfunktionen ---

// Kommandos werden OHNE Shell gestartet: Datei plus Argument-Array (Issue #196).
//
// Vorher lief alles ueber execSync mit einer zusammengesetzten Kommandozeile. Node
// waehlt dann die Shell nach Plattform — /bin/sh auf POSIX, cmd.exe auf Windows —
// und das Quoting muesste zu beiden passen. Es passte nur zu einer: Ein mehrzeiliger
// Issue-Body zerfiel unter Windows in einzelne Argumente (Live-Befund #195).
//
// Ohne Shell gibt es das Problem nicht mehr: Die Argumente gehen als argv direkt ans
// Betriebssystem, es existiert kein Escaping-Layer, der pro Plattform anders arbeitet.
// Nebenbei entfaellt jede Kommando-Injection-Flaeche — ein Issue-Titel kann keine
// zweite Kommandozeile mehr eroeffnen.
function exec(datei, args = []) {
  const res = spawnSync(datei, args, { encoding: "utf-8" });
  if (res.error) {
    // Haeufigster Fall: das CLI ist nicht installiert (ENOENT).
    throw new Error(res.error.code === "ENOENT"
      ? `${datei} nicht gefunden — ist es installiert und im PATH?`
      : res.error.message);
  }
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || "").trim() || `${datei} endete mit Exit ${res.status}`);
  }
  return (res.stdout || "").trim();
}

function execJSON(datei, args = []) {
  return JSON.parse(exec(datei, args));
}

// Die Remote-URL des Repos, oder null wenn es keine gibt (kein Repo, kein origin).
//
// Ersetzt die frueheren POSIX-Kommandozeilen der drei getRepoName-Pfade (Issue #196):
// `2>/dev/null` gibt es unter cmd.exe nicht, `||` und `$(pwd)` ebenso wenig. exec
// verwirft stderr ohnehin und wirft nur bei Exit ungleich 0 — daraus wird hier ein
// schlichtes null, das jeder Aufrufer nach seiner eigenen Regel behandelt.
function gitRemoteUrl() {
  try {
    return exec("git", ["remote", "get-url", "origin"]) || null;
  } catch {
    return null;
  }
}

/**
 * Bringt jede Auskunft ueber das Repo auf die eine verbindliche Form: `owner/repo`.
 *
 * Noetig, weil die drei getRepoName-Implementierungen frueher drei verschiedene Formen
 * lieferten (Issue #214): GitHub gab bei erreichbarem gh `owner/repo` zurueck, bei
 * scheiterndem gh aber die volle Remote-URL — der einzige der drei Fallback-Zweige, in
 * dem die Normalisierung beim Windows-Umbau (Issue #196) nicht mitgewandert ist. Der
 * lokale Host lieferte nur `repo`, ohne Owner.
 *
 * Verarbeitet HTTPS-URLs, die SSH-Form `git@host:owner/repo` und ein bereits
 * normalisiertes `owner/repo`. Untergruppen werden auf die letzten zwei Segmente
 * gekuerzt — die bisherige GitLab-Semantik, hier beibehalten.
 */
export function normalizeRepoName(raw) {
  if (!raw) return null;
  const ohneGit = String(raw).trim().replace(/\.git$/, "");
  if (!ohneGit) return null;
  // SSH-Form zuerst: dort trennt ein Doppelpunkt Host und Pfad, kein Slash.
  const ssh = /^[^@/]+@[^:/]+:(.+)$/.exec(ohneGit);
  const pfad = ssh ? ssh[1] : ohneGit.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, "");
  const teile = pfad.split("/").filter(Boolean);
  if (teile.length === 0) return null;
  // Ein einzelnes Segment bleibt es — ohne Owner wird keiner hinzuerfunden.
  return teile.length === 1 ? teile[0] : teile.slice(-2).join("/");
}

// --- Fehlerbehandlung ---

// Erwartete Fehler aus den Adaptern: abfangbar, im CLI-Layer als "Fehler: ..." ausgegeben
class BoardError extends Error {}

function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

function out(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Config laden ---

// Zweiter Kandidat ist normalerweise der eigene Ort (<kit-dir>/..), damit der Adapter
// auch aus einem Unterverzeichnis des Projekts heraus die Config findet. KIT_ROOT
// ueberschreibt ihn und ist ein Test-Hook (Issue #188, dasselbe Muster wie in
// tools/sync-blobs.mjs, Issue #186): Ohne ihn faende ein Test, der das Fehlen der
// Config prueft, die Dogfooding-Config des Kit-Repos und liefe gegen echtes gh.
function configRoot() {
  return process.env.KIT_ROOT ? resolve(process.env.KIT_ROOT) : join(__dirname, "..");
}

// Felder, die aus workflow.config.local.json gewinnen duerfen (Issue #207). Alles andere
// gilt teamweit und wird aus der lokalen Datei ignoriert.
//
// Die Allowlist ist die eigentliche Entscheidung hinter der Zwei-Datei-Trennung: Waeren
// buildChecks lokal ueberschreibbar, koennte sich jeder sein Gate wegkonfigurieren und die
// Trennung waere Kosmetik. Die geteilte Datei laesst sich zwar weiterhin lokal editieren —
// dann steht sie aber in `git status`, und sichtbare Abweichung ist etwas anderes als
// per Design unsichtbare.
//
// Punkt-Pfade greifen am Blatt, nicht am Elternobjekt: `toolbox.tokenFile` darf nicht das
// ganze toolbox-Objekt ersetzen. Genau dieser Fehler hat in Issue #188 den Mock-Host mit
// weggeraeumt und zwanzig Tests still ohne Token laufen lassen.
// SYNC: dieselbe Liste und Logik steckt in kit/night.mjs und kit/einstellungen.mjs — Aenderungen dort nachziehen.
const LOCAL_OVERRIDE_ALLOWLIST = ["reviewModel", "reviewCommand", "reviewScope", "triggers", "toolbox.tokenFile"];

// Das Reviewer-Paar (Issue #432): genau eines von reviewModel und reviewCommand gilt.
// Beide Felder sind persoenlich ueberschreibbar — waere nur eines davon in der Allowlist,
// koennte jemand seinen Claude-Reviewer lokal setzen, seinen Kommando-Reviewer aber nicht.
// SYNC: dieselbe Zuordnung steckt in kit/night.mjs und kit/einstellungen.mjs.
const REVIEWER_PAAR = { reviewModel: "reviewCommand", reviewCommand: "reviewModel" };

/**
 * Mergt die persoenliche Config in die geteilte, aber nur an den erlaubten Pfaden.
 * Liefert `{ config, ignored }` — `ignored` nennt jedes verworfene Feld beim Namen,
 * damit der Aufrufer es melden kann statt still das Falsche zu tun.
 */
/**
 * Zerlegt die Allowlist in die zwei Formen, in denen sie abgefragt wird: ganze Felder
 * (`reviewModel`) und einzelne Blaetter unter einem Kopf (`toolbox.tokenFile`).
 *
 * Eigene Funktion, weil das eine andere Frage beantwortet als das Mischen darunter:
 * hier wird eine Schreibweise ausgewertet, dort eine Config zusammengefuehrt.
 */
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

/**
 * Setzt ein persoenliches Feld und raeumt beim Reviewer-Paar das Gegenstueck weg.
 *
 * Eigene Funktion, weil hier eine Regel greift, die dem strikt feldweisen Mischen
 * fehlt: Von reviewModel und reviewCommand darf genau eines gelten (Issue #432). Ein
 * lokales reviewCommand neben dem geteilten reviewModel ergaebe sonst eine Config mit
 * beiden Feldern — und das ist kein Randfall, sondern der Normalfall, wenn das Team
 * den Claude-Default faehrt und einer mit fremder CLI reviewt.
 *
 * Stehen beide Felder in der lokalen Datei, bleiben auch beide stehen: Diese Datei ist
 * dann schon fuer sich ungueltig, und eines davon wegzuwerfen wuerde den Fehler
 * verstecken statt ihn der Schema-Pruefung zu ueberlassen.
 *
 * SYNC: strukturgleich in kit/night.mjs.
 */
function setzePersoenlichesFeld(config, feld, wert, local) {
  config[feld] = wert;
  const gegenstueck = REVIEWER_PAAR[feld];
  if (gegenstueck && !(gegenstueck in local)) delete config[gegenstueck];
}

export function mergeWorkflowConfig(shared, local) {
  const config = { ...shared };
  const ignored = [];
  if (!local) return { config, ignored };

  const { erlaubteFelder, erlaubteBlaetter } = zerlegeAllowlist(LOCAL_OVERRIDE_ALLOWLIST);

  for (const [feld, wert] of Object.entries(local)) {
    if (erlaubteFelder.has(feld)) {
      setzePersoenlichesFeld(config, feld, wert, local);
    } else if (erlaubteBlaetter.has(feld) && wert && typeof wert === "object") {
      const blaetter = erlaubteBlaetter.get(feld);
      const zusammen = { ...config[feld] };
      for (const [unterfeld, unterwert] of Object.entries(wert)) {
        if (blaetter.has(unterfeld)) zusammen[unterfeld] = unterwert;
        else ignored.push(`${feld}.${unterfeld}`);
      }
      config[feld] = zusammen;
    } else {
      ignored.push(feld);
    }
  }
  return { config, ignored };
}

// Die persoenliche Config neben der geteilten. Fehlt sie, aendert sich nichts; ist sie
// kaputt, wird sie mit Hinweis uebersprungen — eine Datei, die nur einem Entwickler
// gehoert, darf nicht die Arbeitsgrundlage des ganzen Teams kippen. Bei der geteilten
// Config bleibt ein Syntaxfehler dagegen ein harter Fehler.
function readLocalOverrides(sharedPfad) {
  const pfad = join(dirname(sharedPfad), "workflow.config.local.json");
  if (!existsSync(pfad)) return null;
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    process.stderr.write(`Hinweis: ${pfad} ist kein gueltiges JSON und wird ignoriert.\n`);
    return null;
  }
}

// Liefert die Config oder null, wenn es keine gibt. Der weiche Weg fuer Aufrufer, die
// ohne Config weiterarbeiten koennen (kontext paths, Issue #202). Eine vorhandene, aber
// kaputte Datei bleibt ein harter Fehler: Sie stillschweigend wie "keine Config" zu
// behandeln, wuerde einen Tippfehler in einen unsichtbaren Verhaltenswechsel verwandeln.
/**
 * Liest eine konkrete Config-Datei und bringt sie auf den heutigen Stand (Issue #404).
 *
 * Getrennt von der Kandidatensuche, weil es eine andere Frage ist: readWorkflowConfig
 * entscheidet, WELCHE Datei gilt; diese Funktion, WIE ihr Inhalt zu lesen ist —
 * Kompatibilitaets-Abbildung, persoenliche Overrides, Hinweise auf Ignoriertes.
 */
function ladeConfigDatei(p) {
  const raw = JSON.parse(readFileSync(p, "utf-8"));
  // Rueckwaertskompatibilitaet: provider -> codeHost/issueTracker
  if (raw.provider && !raw.codeHost) raw.codeHost = raw.provider;
  if (raw.provider && !raw.issueTracker) raw.issueTracker = raw.provider;
  const { config, ignored } = mergeWorkflowConfig(raw, readLocalOverrides(p));
  // Hinweis auf stderr, nicht auf stdout: stdout bleibt maschinenlesbar, die Skills
  // parsen ihn als JSON. Kein Abbruch — die Wirkung bleibt ohnehin aus, und ein
  // harter Fehler waere bei jedem board.mjs-Aufruf laut.
  for (const feld of ignored) {
    process.stderr.write(
      `Hinweis: '${feld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`
    );
  }
  return config;
}

function readWorkflowConfig() {
  const candidates = [
    resolve(".claude", "workflow.config.json"),
    join(configRoot(), ".claude", "workflow.config.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return ladeConfigDatei(p);
    } catch {
      fail(`workflow.config.json konnte nicht gelesen werden: ${p}`);
    }
  }
  return null;
}

function loadConfig() {
  const config = readWorkflowConfig();
  if (!config) {
    fail("Keine .claude/workflow.config.json gefunden. Bitte zuerst den Installer ausfuehren.");
  }
  return config;
}

// --- Argument-Parser ---

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(a);
    }
  }
  return result;
}

// ============================================================
// GitHub-Adapter
// ============================================================

class GitHubIssueTracker {
  constructor(config) {
    this._cfg = config;
    this._repoName = null;
    this._projectId = null;
    this._statusField = null; // { id, options: { [status]: optionId } }
    this._projectNumberCache = null;
  }

  _repo() {
    if (!this._repoName) {
      this._repoName = exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    }
    return this._repoName;
  }

  _owner() {
    return this._repo().split("/")[0];
  }

  // Ohne konfigurierte github.projectNumber wird versucht, die Nummer automatisch zu
  // erkennen: gibt es fuer den Owner genau ein GitHub Project, wird dieses verwendet
  // (mit Hinweis, kein stiller Schreibzugriff auf workflow.config.json). Bei keinem
  // oder mehreren Projects bleibt es beim harten Fehler mit Projekt-Liste. Ergebnis
  // wird pro Prozess memoisiert und die Auto-Erkennung zusaetzlich prozessuebergreifend
  // gecacht (siehe _readAutoProjectNumberCache), damit nicht jeder Aufruf ohne
  // konfigurierte Nummer erneut gh project list kostet.
  _projectNumber() {
    if (this._projectNumberCache) return this._projectNumberCache;

    const configured = this._cfg.github?.projectNumber;
    if (configured) {
      this._projectNumberCache = configured;
      return configured;
    }

    const owner = this._owner();
    const cachedAuto = this._readAutoProjectNumberCache(owner);
    if (cachedAuto) {
      this._projectNumberCache = cachedAuto;
      return cachedAuto;
    }

    const projects = execJSON("gh", ["project", "list", "--owner", owner, "--format", "json"]).projects || [];
    if (projects.length === 1) {
      const num = projects[0].number;
      process.stderr.write(
        `Hinweis: github.projectNumber fehlt in workflow.config.json, verwende automatisch ` +
        `erkanntes einziges GitHub Project #${num} ('${projects[0].title}') fuer Owner '${owner}'. ` +
        `Zur dauerhaften Fixierung ergaenzen: '"github": { "projectNumber": ${num} }'\n`
      );
      this._writeAutoProjectNumberCache(owner, num);
      this._projectNumberCache = num;
      return num;
    }
    if (projects.length === 0) {
      throw new BoardError(
        `github.projectNumber fehlt in workflow.config.json, und Owner '${owner}' hat kein GitHub Project. ` +
        `Bitte erganzen: '"github": { "projectNumber": <N> }'`
      );
    }
    const list = projects.map((p) => `#${p.number} (${p.title})`).join(", ");
    throw new BoardError(
      `github.projectNumber fehlt in workflow.config.json, Owner '${owner}' hat mehrere Projects: ${list}. ` +
      `Bitte erganzen: '"github": { "projectNumber": <N> }'`
    );
  }

  _autoCacheKey(owner) {
    return `${owner}#auto`;
  }

  _readAutoProjectNumberCache(owner) {
    const p = this._metaCachePath();
    if (!existsSync(p)) return null;
    try {
      const all = JSON.parse(readFileSync(p, "utf-8"));
      return all[this._autoCacheKey(owner)]?.projectNumber || null;
    } catch {
      return null;
    }
  }

  _writeAutoProjectNumberCache(owner, num) {
    const p = this._metaCachePath();
    let all = {};
    if (existsSync(p)) {
      try { all = JSON.parse(readFileSync(p, "utf-8")); } catch { all = {}; }
    }
    all[this._autoCacheKey(owner)] = { projectNumber: num };
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(all, null, 2) + "\n");
  }

  // Project-ID, Status-Field-ID und Option-IDs aendern sich praktisch nie. Sie werden
  // deshalb persistent gecacht (.claude/board-meta-cache.json), damit nicht jeder
  // board.mjs-Aufruf zwei GraphQL-Abfragen (gh project list / field-list) kostet — der
  // In-Memory-Cache haelt nur innerhalb eines Prozesses, jeder CLI-Aufruf ist aber neu.
  _metaCachePath() {
    return resolve(".claude", "board-meta-cache.json");
  }

  _metaCacheKey() {
    return `${this._owner()}#${this._projectNumber()}`;
  }

  _readMetaCache() {
    const p = this._metaCachePath();
    if (!existsSync(p)) return null;
    let all;
    try {
      all = JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return null; // korrupte Cache-Datei wie Cache-Miss behandeln
    }
    const entry = all[this._metaCacheKey()];
    if (!entry?.projectId || !entry?.statusField) return null;
    // Bei geaenderten Spalten-Labels ist die Option-Zuordnung veraltet — neu aufbauen.
    if (JSON.stringify(entry.columnLabels) !== JSON.stringify(columnLabels(this._cfg))) return null;
    return entry;
  }

  _writeMetaCache() {
    const p = this._metaCachePath();
    let all = {};
    if (existsSync(p)) {
      try { all = JSON.parse(readFileSync(p, "utf-8")); } catch { all = {}; }
    }
    all[this._metaCacheKey()] = {
      projectId: this._projectId,
      statusField: this._statusField,
      columnLabels: columnLabels(this._cfg),
    };
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(all, null, 2) + "\n");
  }

  _invalidateMetaCache() {
    this._projectId = null;
    this._statusField = null;
    const p = this._metaCachePath();
    if (!existsSync(p)) return;
    try {
      const all = JSON.parse(readFileSync(p, "utf-8"));
      delete all[this._metaCacheKey()];
      writeFileSync(p, JSON.stringify(all, null, 2) + "\n");
    } catch {
      // korrupte Datei: der naechste _writeMetaCache ueberschreibt sie ohnehin
    }
  }

  _ensureProjectMeta() {
    if (this._projectId && this._statusField) return;

    const cached = this._readMetaCache();
    if (cached) {
      this._projectId = cached.projectId;
      this._statusField = cached.statusField;
      return;
    }

    this._loadProjectMetaFromApi();
    this._writeMetaCache();
  }

  _loadProjectMetaFromApi() {
    const owner = this._owner();
    const num = this._projectNumber();

    // Project-ID
    const projectList = execJSON("gh", ["project", "list", "--owner", owner, "--format", "json"]);
    const project = (projectList.projects || []).find((p) => p.number === num);
    if (!project) throw new BoardError(`GitHub Project #${num} nicht gefunden fuer Owner '${owner}'`);
    this._projectId = project.id;

    // Status-Field und Optionen
    const fields = execJSON("gh", ["project", "field-list", String(num), "--owner", owner, "--format", "json"]);
    const statusField = (fields.fields || []).find((f) => f.name === "Status");
    if (!statusField) throw new BoardError(`Kein 'Status'-Feld in GitHub Project #${num} gefunden`);

    const optionMap = {};
    for (const opt of statusField.options || []) {
      // Normalisiere den Option-Namen auf den Status-Enum
      const labels = columnLabels(this._cfg);
      const key = Object.keys(labels).find(
        (k) => labels[k].toLowerCase() === opt.name.toLowerCase()
      );
      if (key) {
        if (labels[key] !== opt.name) {
          process.stderr.write(
            `Hinweis: workflow.config.json konfiguriert fuer Status '${key}' das Label '${labels[key]}', ` +
            `das GitHub Project verwendet tatsaechlich '${opt.name}' (Gross-/Kleinschreibung weicht ab). ` +
            `Aktuell noch per Fallback erkannt — zur Vermeidung stiller Folgefehler bitte in ` +
            `workflow.config.json anpassen: '"columns": { "${key}": "${opt.name}" }'\n`
          );
        }
        optionMap[key] = opt.id;
      }
    }
    this._statusField = { id: statusField.id, options: optionMap };
  }

  // Gezielter Lookup der Project-Item-ID fuer genau dieses eine Issue via GraphQL-
  // Einzelabfrage (repository -> issue -> projectItems). Kostet ~1 Kontingentpunkt
  // unabhaengig von der Boardgroesse — statt eines paginierten `gh project item-list`
  // ueber alle bis zu 1000 Items, das je nach Board zweistellige Punktzahlen verbraucht.
  _getProjectItemId(issueNumber) {
    const owner = this._owner();
    const repoName = this._repo().split("/")[1];
    const num = this._projectNumber();
    const number = Number(issueNumber);

    const query = [
      "query($owner:String!,$repo:String!,$number:Int!){",
      "  repository(owner:$owner,name:$repo){",
      "    issue(number:$number){",
      "      projectItems(first:20){",
      "        nodes{",
      "          id",
      "          project{ number owner{ ... on User{ login } ... on Organization{ login } } }",
      "        }",
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n");

    const data = execJSON("gh", [
      "api", "graphql",
      "-f", `query=${query}`,
      "-f", `owner=${owner}`,
      "-f", `repo=${repoName}`,
      "-F", `number=${number}`,
    ]);

    const issue = data?.data?.repository?.issue;
    if (!issue) throw new BoardError(`Issue #${issueNumber} nicht in Repo '${this._repo()}' gefunden`);

    const nodes = issue.projectItems?.nodes || [];
    const item = nodes.find(
      (n) => n.project?.number === num && n.project?.owner?.login === owner
    );
    if (!item) throw new BoardError(`Issue #${issueNumber} nicht im Project Board #${num} gefunden`);
    return item.id;
  }

  async createIssue({ title, body }) {
    const repo = this._repo();
    const output = exec("gh", ["issue", "create", "--repo", repo, "--title", title, "--body", body || ""]);
    // gh gibt ggf. Hinweiszeilen vor der URL aus — URL und ID per Regex extrahieren
    const match = output.match(/(https?:\/\/\S+\/issues\/(\d+))/);
    if (!match) throw new BoardError(`Konnte Issue-URL aus gh-Ausgabe nicht lesen: ${output}`);
    const url = match[1];
    const id = match[2];

    // Ans Project Board haengen. _projectNumber() wirft, wenn weder konfiguriert
    // noch eindeutig automatisch erkennbar — dann bleibt die Zuordnung aus (Hinweis).
    try {
      const owner = this._owner();
      const num = this._projectNumber();
      exec("gh", ["project", "item-add", String(num), "--owner", owner, "--url", url]);
      // Status auf backlog setzen. item-list zeigt frisch hinzugefuegte Items
      // teils verzoegert (Eventual Consistency) — daher kurzer Retry.
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) await sleep(2500);
        try {
          await this.moveIssue(id, "backlog");
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;
    } catch (e) {
      process.stderr.write(`Hinweis: Board-Zuordnung fehlgeschlagen: ${e.message}\n`);
    }
    return { id, url };
  }

  async getIssue(id) {
    const repo = this._repo();
    // createdAt muss ausdruecklich angefordert werden — gh liefert nur die Felder aus
    // dieser Liste, ein Weglassen waere still zu "kein Anlagedatum" geworden (#457).
    const data = execJSON("gh", ["issue", "view", String(id), "--repo", repo, "--json", "number,title,body,state,comments,labels,createdAt"]);
    return {
      id: String(data.number),
      title: data.title,
      body: data.body,
      status: null, // Board-Status nicht im Issue-Objekt, erfordert Project-Abfrage
      labels: labelNamesFrom(data.labels),
      comments: normalizeComments(data.comments),
      ...createdFrom(data.createdAt),
    };
  }

  async listIssues(status) {
    const repo = this._repo();

    if (!status) {
      // `gh issue list` liefert Labels direkt mit, sobald das Feld angefordert wird
      // (verifiziert 2026-07-29, Issue #180).
      const items = execJSON("gh", ["issue", "list", "--repo", repo, "--state", "open", "--json", "number,title,body,labels"]);
      return items.map((i) => ({
        id: String(i.number), title: i.title, body: i.body, status: null, labels: labelNamesFrom(i.labels),
      }));
    }

    // Filterung nach Board-Status via Project
    let num;
    try {
      num = this._projectNumber();
    } catch {
      process.stderr.write(
        "Hinweis: Kein eindeutiges GitHub Project bestimmbar, kein Board-Status-Filter moeglich. Liste alle offenen Issues.\n"
      );
      return this.listIssues(undefined);
    }

    this._ensureProjectMeta();
    const owner = this._owner();
    const items = execJSON("gh", ["project", "item-list", String(num), "--owner", owner, "--format", "json", "--limit", "1000"]);

    const optionId = this._statusField.options[status];
    if (!optionId) throw new BoardError(`Status '${status}' hat keine Entsprechung im GitHub Project`);

    const wantedStatus = githubStatusName(status, this._cfg).toLowerCase();
    // Kein ID-Re-Sort: gh project item-list liefert die manuelle Projekt-Reihenfolge,
    // gefiltert auf eine Spalte ist das die Board-Reihenfolge (oben zuerst, #128).
    const gefiltert = (items.items || [])
      .filter((i) => (i.status || "").toLowerCase() === wantedStatus)
      .map((i) => ({
        id: String(i.content?.number),
        title: i.content?.title,
        body: null,
        status,
        labels: [],
      }));

    return this._mitLabels(gefiltert, repo);
  }

  // `gh project item-list` liefert keine Labels (Issue #180) — sie werden ueber einen
  // zweiten Aufruf nachgeschlagen. Schlaegt der fehl, bleibt es bei labels: [] und die
  // Liste selbst ueberlebt: Ein Netzwerkschluckauf darf einen Nachtlauf nicht kippen.
  _mitLabels(items, repo) {
    if (items.length === 0) return items;
    try {
      const raw = execJSON("gh", ["issue", "list", "--repo", repo, "--state", "all", "--json", "number,labels", "--limit", "1000"]);
      return withLabels(items, labelMapFrom(raw));
    } catch (e) {
      process.stderr.write(
        `Hinweis: Labels konnten nicht nachgeschlagen werden (${e.message}). Liste ohne Labels.\n`
      );
      return items;
    }
  }

  async moveIssue(id, to) {
    this._ensureProjectMeta();
    const itemId = this._getProjectItemId(id);
    this._optionIdFor(to); // wirft frueh, falls Status unbekannt

    try {
      this._editItemStatus(itemId, to);
    } catch (firstErr) {
      // Gecachte IDs koennten veraltet sein (z.B. Option-ID im Project entfernt) —
      // Cache verwerfen, Meta frisch aus der API laden und einmal wiederholen.
      this._invalidateMetaCache();
      this._ensureProjectMeta();
      try {
        this._editItemStatus(itemId, to);
      } catch (retryErr) {
        throw new BoardError(
          `Status-Update fehlgeschlagen (auch nach Cache-Refresh): ${retryErr.message} ` +
          `(urspruenglicher Fehler: ${firstErr.message})`
        );
      }
    }
  }

  _optionIdFor(status) {
    const optionId = this._statusField.options[status];
    if (!optionId) throw new BoardError(`Status '${status}' hat keine Entsprechung im GitHub Project`);
    return optionId;
  }

  _editItemStatus(itemId, status) {
    exec("gh", [
      "project", "item-edit",
      "--id", itemId,
      "--project-id", this._projectId,
      "--field-id", this._statusField.id,
      "--single-select-option-id", this._optionIdFor(status),
    ]);
  }

  async commentIssue(id, text) {
    const repo = this._repo();
    exec("gh", ["issue", "comment", String(id), "--repo", repo, "--body", text]);
  }

  async updateIssue(id, { body }) {
    const repo = this._repo();
    exec("gh", ["issue", "edit", String(id), "--repo", repo, "--body", body]);
  }

  // gh setzt und entfernt Labels namentlich und additiv: Die uebrigen Labels des
  // Issues bleiben unberuehrt, und beide Richtungen sind von sich aus idempotent.
  // Eine unbekannte Labeldefinition meldet gh mit Exit != 0 — das schlaegt bewusst
  // durch, damit eine nie gesetzte Zeichnung nicht als gesetzt gilt.
  async labelIssue(id, name, aktion) {
    const repo = this._repo();
    const flag = aktion === "add" ? "--add-label" : "--remove-label";
    exec("gh", ["issue", "edit", String(id), "--repo", repo, flag, name]);
  }
}

function githubStatusName(status, config) {
  return columnLabels(config)[status] || status;
}

// ============================================================
// CI-Status (Achse `code ci-status`, Issue #316)
// ============================================================

// Ein lokal gruener Lauf sagt nichts ueber die CI: Dieses Repo faehrt seit Issue #196
// einen zweiten Job auf windows-latest, und genau der war rot, als v1.37.0 und v1.38.0
// nach production gingen. Die Auskunft gehoert in den Adapter und nicht als `gh`-Aufruf
// in einen Skill-Text — die Skills sind provider-unabhaengig, und `gh run list` gibt es
// bei GitLab und im lokalen Modus nicht.

const GITHUB_CI_GRUEN = new Set(["success", "neutral", "skipped"]);
const GITHUB_CI_ROT = new Set(["failure", "timed_out", "cancelled", "startup_failure", "action_required"]);
const GITLAB_CI_GRUEN = new Set(["success", "skipped"]);
const GITLAB_CI_ROT = new Set(["failed", "canceled"]);

// Ein unbekannter oder fehlender Zustand ist `laeuft`: Die Zustandslisten der beiden
// Hosts wachsen, und ein neuer Wert stillschweigend als `gruen` zu werten hiesse, ein
// Release auf eine Auskunft zu stuetzen, die es nicht gibt.
function ciErgebnis(wert, gruen, rot) {
  if (gruen.has(wert)) return "gruen";
  if (rot.has(wert)) return "rot";
  return "laeuft";
}

/**
 * Das Gesamturteil aus den Einzeljobs: rot vor laeuft vor gruen.
 *
 * Eine LEERE Jobliste ist `laeuft`, nicht `gruen`: Unmittelbar nach einem Push ist der
 * Lauf fuer einige Sekunden unsichtbar, und ein `gruen` an dieser Stelle risse genau die
 * Luecke wieder auf, die diese Achse schliesst. `keine` gibt es nur bei codeHost `local`
 * — dort ist die Abwesenheit von CI der Dauerzustand und kein Zwischenschritt.
 */
function ciGesamturteil(jobs) {
  if (jobs.some((j) => j.ergebnis === "rot")) return "rot";
  if (jobs.length === 0 || jobs.some((j) => j.ergebnis === "laeuft")) return "laeuft";
  return "gruen";
}

/**
 * Wie execJSON, aber jeder Fehlweg endet als abfangbarer BoardError mit Klartext:
 * fehlendes CLI, fehlende Authentifizierung, Netzfehler und ungueltiges JSON. Ohne das
 * traegt die Meldung „Unerwarteter Fehler" und sieht aus wie ein Defekt des Adapters.
 */
function ciJSON(datei, args) {
  let roh;
  try {
    roh = exec(datei, args);
  } catch (e) {
    throw new BoardError(`${datei} ${args.join(" ")}: ${e.message}`);
  }
  try {
    return JSON.parse(roh);
  } catch {
    throw new BoardError(`${datei} ${args.join(" ")} lieferte kein gueltiges JSON: ${roh.slice(0, 200)}`);
  }
}

class GitHubCodeHost {
  constructor(config) { this._cfg = config; }

  async getRepoName() {
    try {
      return exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    } catch {
      // Frueher eine POSIX-Kommandozeile mit || und $(pwd) — unter cmd.exe gibt es
      // beides nicht (Issue #196). Dieselbe Logik in JavaScript.
      //
      // normalizeRepoName ist hier nicht optional: Ohne sie lieferte dieser Zweig die
      // volle Remote-URL statt owner/repo, und zwar still (Issue #214). Sichtbar wurde
      // das nur, wenn gh nicht durchkommt — etwa unter einer Sandbox, die die
      // TLS-Pruefung blockiert.
      return normalizeRepoName(gitRemoteUrl()) || basename(resolve("."));
    }
  }

  supportsPullRequests() { return true; }

  async createPullRequest({ from, to, title }) {
    const t = title || `${from} → ${to}`;
    const url = exec("gh", ["pr", "create", "--base", to, "--head", from, "--title", t, "--body", ""]);
    return { url };
  }

  // Das Urteil entsteht ausschliesslich aus jobs[]: `gh run list --json name` liefert den
  // WORKFLOW-Namen, nicht den Job — damit waere der rote Job nicht zu benennen, und genau
  // sein Name ist es, den das Gate in `/merge-production` ausgibt.
  async getCiStatus(commit) {
    const laeufe = ciJSON("gh", [
      "run", "list", "--commit", commit, "--json", "databaseId,workflowName,conclusion,status",
    ]);
    const jobs = [];
    for (const lauf of Array.isArray(laeufe) ? laeufe : []) {
      const detail = ciJSON("gh", ["run", "view", String(lauf.databaseId), "--json", "jobs"]);
      for (const job of Array.isArray(detail.jobs) ? detail.jobs : []) {
        jobs.push({ name: job.name, ergebnis: ciErgebnis(job.conclusion, GITHUB_CI_GRUEN, GITHUB_CI_ROT) });
      }
    }
    return { status: ciGesamturteil(jobs), jobs };
  }
}

// ============================================================
// GitLab-Adapter
// ============================================================

class GitLabIssueTracker {
  constructor(config) { this._cfg = config; }

  async createIssue({ title, body }) {
    const output = exec("glab", ["issue", "create", "--title", title, "--description", body || ""]);
    // glab gibt die Issue-URL aus, z.B. https://gitlab.com/owner/repo/-/issues/42
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) throw new BoardError(`Konnte Issue-ID aus glab-Ausgabe nicht lesen: ${output}`);
    const id = match[1];
    // Backlog-Label nur setzen, wenn backlog per Config ueberhaupt ein Label ist
    // (nicht der native Open-Zustand) — sonst bleibt das neue Issue einfach offen.
    if (!isStateColumn("backlog", this._cfg)) {
      const label = columnLabels(this._cfg).backlog;
      try {
        exec("glab", ["issue", "update", String(id), "--label", label]);
      } catch (e) {
        process.stderr.write(`Hinweis: Backlog-Label konnte nicht gesetzt werden: ${e.message}\n`);
      }
    }
    return { id, url: output.trim() };
  }

  async getIssue(id) {
    const data = execJSON("glab", ["issue", "view", String(id), "--output", "json"]);
    const labelNames = labelNamesFrom(data.labels);
    const status = labelToStatus(labelNames, this._cfg, data.state) || null;
    return {
      id: String(data.iid || data.id),
      title: data.title,
      body: data.description,
      status,
      labels: labelNames,
      comments: this._notes(id),
      ...createdFrom(data.created_at),
    };
  }

  // Kommentare liegen bei GitLab als "Notes" an einem eigenen Endpunkt (kanban-kit#449).
  // Ein Fehlschlag darf `issue get` nicht kippen — der Verlauf ist Zusatzinformation,
  // Titel/Body/Status sind die Hauptsache. Deshalb leeres Array statt Abbruch.
  _notes(id) {
    try {
      return normalizeComments(execJSON("glab", ["api", `projects/:id/issues/${id}/notes`]));
    } catch (e) {
      process.stderr.write(`Hinweis: Kommentare nicht abrufbar: ${e.message}\n`);
      return [];
    }
  }

  /**
   * Uebersetzt einen Board-Status in die CLI-Flags von `glab issue list` (Issue #404).
   *
   * Eigene Funktion, weil hier eine Uebersetzung stattfindet und keine Abfrage: Der
   * Status ist ein Kit-Begriff, die Flags sind GitLabs Modell aus Zustaenden und
   * Labels. listIssues fragt danach ab und formt das Ergebnis — zwei Aufgaben, die
   * ineinander nur schwer zu lesen waren.
   */
  _listArgs(status) {
    const args = ["issue", "list", "--output", "json"];
    if (!status) return args;
    // Board-Reihenfolge statt numerisch: relative_position ist GitLabs Feld fuer die
    // manuelle Board-Sortierung (oben zuerst, #128). Nur im Status-Filter-Pfad.
    args.push("--order", "relative_position", "--sort", "asc");
    if (!isStateColumn(status, this._cfg)) {
      const label = columnLabels(this._cfg)[status];
      if (!label) throw new BoardError(`Status '${status}' hat kein GitLab-Label-Mapping`);
      args.push("--label", label);
      return args;
    }
    if (status === "done") {
      args.push("--closed");
      return args;
    }
    // backlog als Open-Zustand: offene Issues ohne die anderen Status-Labels.
    const otherLabels = Object.entries(columnLabels(this._cfg))
      .filter(([s]) => s !== "backlog" && !isStateColumn(s, this._cfg))
      .map(([, l]) => l);
    for (const l of otherLabels) args.push("--not-label", l);
    return args;
  }

  async listIssues(status) {
    const items = execJSON("glab", this._listArgs(status));
    const mapped = (Array.isArray(items) ? items : []).map((i) => {
      const labelNames = labelNamesFrom(i.labels);
      return {
        id: String(i.iid),
        title: i.title,
        body: i.description,
        status: labelToStatus(labelNames, this._cfg, i.state) || null,
        labels: labelNames,
      };
    });
    // Mit Status-Filter gilt die Board-Reihenfolge (relative_position, s. o.);
    // ungefiltert bleibt die stabile numerische Sortierung.
    return status ? mapped : mapped.sort((a, b) => Number(a.id) - Number(b.id));
  }

  async moveIssue(id, to) {
    const labels = columnLabels(this._cfg);
    const statusLabels = Object.values(labels);

    // backlog (falls als Open-Zustand konfiguriert) und done sind GitLab-Zustaende,
    // keine Labels: nur Status-Labels entfernen, Issue oeffnen bzw. schliessen, kein
    // Phantom-Label setzen.
    if (isStateColumn(to, this._cfg)) {
      const unlabelArgs = statusLabels.flatMap((l) => ["--unlabel", l]);
      exec("glab", ["issue", "update", String(id), ...unlabelArgs]);
      exec("glab", ["issue", to === "done" ? "close" : "reopen", String(id)]);
      return;
    }

    const label = labels[to];
    if (!label) throw new BoardError(`Status '${to}' hat kein GitLab-Label-Mapping`);
    // Alle anderen Status-Labels entfernen, Ziel-Label setzen (Ziel-Label
    // NICHT im selben Aufruf unlabeln, sonst verrechnet glab beides gegeneinander).
    const unlabelArgs = statusLabels
      .filter((l) => l !== label)
      .flatMap((l) => ["--unlabel", l]);
    exec("glab", ["issue", "update", String(id), ...unlabelArgs, "--label", label]);
  }

  async commentIssue(id, text) {
    // 'glab issue note <id>', NICHT 'issue note create <id>' (Issue #216): Ein
    // create-Subkommando gibt es hier nicht — anders als bei 'issue create', wo die
    // Analogie naheliegt. glab liest ein vorangestelltes 'create' als zusaetzliches
    // Argument und bricht mit "Accepts 1 arg(s), received 2" ab.
    exec("glab", ["issue", "note", String(id), "--message", text]);
  }

  async updateIssue(id, { body }) {
    // Bei GitLab heisst der Body 'description' — dasselbe Flag wie in createIssue.
    exec("glab", ["issue", "update", String(id), "--description", body]);
  }

  // Dieselben Flags wie in moveIssue, nur mit genau einem Namen und ohne die
  // Status-Labels anzufassen: Die Sperre gegen Spaltennamen sitzt im Dispatcher,
  // bevor irgendein Adapter gerufen wird.
  async labelIssue(id, name, aktion) {
    const flag = aktion === "add" ? "--label" : "--unlabel";
    exec("glab", ["issue", "update", String(id), flag, name]);
  }
}

class GitLabCodeHost {
  async getRepoName() {
    // Ohne Remote (kein Repo, kein origin) bleibt der Verzeichnisname — frueher ueber
    // `basename $(pwd)`, das cmd.exe nicht kennt (Issue #196).
    return normalizeRepoName(gitRemoteUrl()) || basename(resolve("."));
  }

  supportsPullRequests() { return true; }

  async createPullRequest({ from, to, title }) {
    const t = title || `${from} -> ${to}`;
    const url = exec("glab", [
      "mr", "create",
      "--source-branch", from,
      "--target-branch", to,
      "--title", t,
      "--description", "",
      "--yes",
    ]);
    // glab gibt die MR-URL aus
    const match = url.match(/https?:\/\/\S+/);
    return { url: match ? match[0] : url.trim() };
  }

  // `glab ci status` scheidet aus: Es filtert nach Branch, nicht nach SHA. `ci list`
  // liefert absteigend nach id (glab-Default), das erste Element ist also die neueste
  // Pipeline des Commits; ihre Jobs holt `ci get --with-job-details`.
  async getCiStatus(commit) {
    const pipelines = ciJSON("glab", ["ci", "list", "--sha", commit, "--output", "json"]);
    const liste = Array.isArray(pipelines) ? pipelines : [];
    if (liste.length === 0) return { status: "laeuft", jobs: [] };

    const detail = ciJSON("glab", [
      "ci", "get", "--pipeline-id", String(liste[0].id), "--with-job-details", "--output", "json",
    ]);
    const jobs = (Array.isArray(detail.jobs) ? detail.jobs : []).map((job) => ({
      name: job.name,
      ergebnis: ciErgebnis(job.status, GITLAB_CI_GRUEN, GITLAB_CI_ROT),
    }));
    return { status: ciGesamturteil(jobs), jobs };
  }
}

// ============================================================
// Local-Adapter
// ============================================================

// Minimaler YAML-Frontmatter-Parser fuer die Issue-Dateien (kein externes Modul).
// Bewusst minimal: nur flaches, einzeiliges YAML (reicht fuer das Issue-Format).
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split("\n")) {
    // Fuehrende Leerzeichen nach dem Doppelpunkt uebernimmt das nachgelagerte .trim();
    // deshalb hier bewusst kein \s* (vermeidet ueberlappende Zeichenklassen/Backtracking).
    const m = line.match(/^(\w+):(.*)$/);
    if (m) meta[m[1]] = m[2].trim().replaceAll(/^["']|["']$/g, "");
  }
  return { meta, body: match[2] };
}

function serializeFrontmatter(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// Labels des lokalen Trackers liegen als kommaseparierter Frontmatter-String —
// parseFrontmatter kann kein YAML-Array (Issue #158/#159). Lesen und Schreiben
// teilen sich diese Form, damit listIssues und labelIssue nicht zwei Lesarten
// desselben Feldes entwickeln.
function labelsAusFrontmatter(meta) {
  return typeof meta.labels === "string" && meta.labels.trim()
    ? meta.labels.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
}

function issuesDir(config) {
  return resolve(config.local?.issuesDir || "issues");
}

function padId(n) {
  return String(n).padStart(4, "0");
}

// Epic-Fortschritt aus den Kindern (parent-Zeiger).
// Kinder = nicht-Epic-Issues mit parent == epicId; done = Kinder im Status "done".
function epicProgress(issues, epicId) {
  const children = issues.filter((i) => i.type !== "epic" && i.parent === epicId);
  const done = children.filter((i) => i.status === "done").length;
  return { total: children.length, done };
}

// Trifft ein Body, der NUR aus der Autor-Modell-Zeile besteht? Dann bekommt er
// die Abschnitts-Vorlage angehaengt (Issue #266, angewandt in createIssue).
//
// Der Ausdruck fasst die rohe Zeile, den umgebenden Leerraum raeumt der Aufrufer
// per `trim()` ab — dasselbe Muster, das #403 bei PRUEFUNG_ZEILE angewandt hat.
// Die fruehere Fassung `/^\s*Autor-Modell:[^\S\n]*\S[^\n]*\s*$/` legte `\s*` um
// den GANZEN Body: `[^\n]*` und `\s*` akzeptieren beide Leerzeichen, also
// probierte die Engine bei einem scheiternden Rest jede Aufteilung durch
// (S8786, Issue #406). Gemessen mit 256 KiB Leerraum hinter der Zeile: 21,7 s
// vorher, 0,3 ms danach. Der Aufrufvertrag aus #396 schuetzte hier nicht — der
// Ausdruck laeuft ueber den ganzen Body, nicht ueber eine Zeile aus `.split()`.
const NUR_AUTOR_ZEILE = /^Autor-Modell:[^\S\n]*\S[^\n]*$/;

export function nurAutorZeileTrifft(body) {
  return NUR_AUTOR_ZEILE.test((body || "").trim());
}

class LocalIssueTracker {
  constructor(config) { this._cfg = config; }

  _dir() {
    return issuesDir(this._cfg);
  }

  _allFiles() {
    const dir = this._dir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort(); // aufsteigend nach Dateiname = aufsteigend nach id
  }

  _filePath(id) {
    return join(this._dir(), `${padId(id)}.md`);
  }

  _read(id) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(`Issue ${id} nicht gefunden: ${p}`);
    const raw = readFileSync(p, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    const type = meta.type || "task";
    // Fuer ein Vorhaben ist `status` bedingungslos null — ein etwaiges Feld im
    // Frontmatter wird ignoriert. `createIssue` schreibt bei Epics keins, aber
    // `moveIssue` setzt `meta.status` ohne Typpruefung (Issue #377).
    // `created` faellt weg statt "" zu liefern, wenn das Frontmatter keins oder ein
    // formwidriges traegt (Issue #457) — sonst muessten Aufrufer zwei Formen von
    // "kein Datum" unterscheiden.
    return { id: meta.id || padId(id), type, parent: meta.parent || "", title: meta.title || "", status: type === "epic" ? null : (meta.status || "backlog"), ...createdFrom(meta.created), labels: labelsAusFrontmatter(meta), body };
  }

  _nextId() {
    const files = this._allFiles();
    if (files.length === 0) return 1;
    const nums = files.map((f) => Number.parseInt(f, 10)).filter((n) => !Number.isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
  }

  async createIssue({ title, body, type, parent, color, shortcode }) {
    const dir = this._dir();
    mkdirSync(dir, { recursive: true });
    const n = this._nextId();
    const id = padId(n);
    const today = new Date().toISOString().slice(0, 10);
    const t = type || "task";
    const meta = { id: `"${id}"`, type: t };
    if (parent) meta.parent = `"${parent}"`;
    if (color) meta.color = color;
    if (shortcode) meta.shortcode = shortcode;
    // Epics nehmen nicht am Spalten-Workflow teil (E5): kein status-Feld.
    if (t !== "epic") meta.status = "backlog";
    meta.title = title;
    meta.created = today;
    // Die Abschnitts-Vorlage greift auch dann, wenn der Body nur aus der
    // Autor-Modell-Zeile besteht (Issue #266). Seit der Leitplanke in issueCreate
    // ist ein Body nie mehr wirklich leer — ohne diese Erweiterung haette ein
    // `create` ohne --body still die Vorlage verloren.
    const nurAutorZeile = nurAutorZeileTrifft(body);
    const VORLAGE = "\n## Kontext\n\n## Aufgabe\n\n## Akzeptanzkriterium\n\n## Abhaengigkeiten\n";
    let rumpf = body;
    if (!body) rumpf = VORLAGE;
    else if (nurAutorZeile) rumpf = `${body.trimEnd()}\n${VORLAGE}`;
    const content = serializeFrontmatter(meta, rumpf);
    writeFileSync(this._filePath(n), content, "utf-8");
    return { id, path: this._filePath(n) };
  }

  async getIssue(id) {
    return this._read(id);
  }

  /**
   * Aktivitaetsverlauf, synthetisch (Issue #460).
   *
   * Der lokale Tracker fuehrt keinen Verlauf — er hat nur das Frontmatter. Daraus
   * entsteht **ein** Eintrag vom Typ CREATED, damit Auswertungen (etwa
   * `wirksamkeit.mjs` ueber `issue activity`) hier dieselbe Quelle lesen koennen
   * wie beim Board.
   *
   * Fehlt `created:`, ist der Verlauf leer. Das ist ehrlicher als ein erfundenes
   * Datum: Eine Datei ohne Anlagedatum hat schlicht keinen Anlage-Eintrag.
   */
  async listActivity(id) {
    const { created } = this._read(id);
    if (!created) return [];
    return [{ type: "CREATED", createdAt: created, detail: "Karte angelegt" }];
  }

  /**
   * Sammelform des Verlaufs (Issue #786).
   *
   * Hier gibt es nichts einzusparen — jede Nummer ist ein Dateizugriff, die
   * Beschleunigung von `--ids` betrifft allein das Board. Was bleibt, ist die
   * gemeinsame Zusage der Sammelform: Eine Nummer ohne Datei wird zum Eintrag mit
   * Fehlergrund und nicht zum Abbruch, damit ein geloeschtes Paket die Auswertung
   * der uebrigen nicht kostet.
   */
  async listActivityMany(ids) {
    const ergebnis = {};
    for (const id of ids) {
      try {
        ergebnis[id] = await this.listActivity(id);
      } catch (e) {
        ergebnis[id] = { fehler: e.message };
      }
    }
    return ergebnis;
  }

  // Alle Issue-Dateien roh, ohne jede Filterung. Gemeinsame Quelle fuer listIssues
  // (das Vorhaben ausschliesst) und listEpics (das genau sie braucht) — ohne die
  // Trennung liefe listEpics nach dem Epic-Ausschluss leer (Issue #377).
  _alleItems() {
    return this._allFiles()
      .map((f) => {
        const raw = readFileSync(join(this._dir(), f), "utf-8");
        const { meta, body } = parseFrontmatter(raw);
        const labels = labelsAusFrontmatter(meta);
        return { id: meta.id || basename(f, ".md"), type: meta.type || "task", parent: meta.parent || "", color: meta.color || "", shortcode: meta.shortcode || "", title: meta.title || "", status: meta.status || "backlog", labels, body };
      });
  }

  async listIssues(status) {
    // Epics nehmen nicht am Spalten-Workflow teil (E5) — der Ausschluss gilt
    // unabhaengig vom Filter (Issue #377), siehe die Begruendung im Toolbox-Adapter.
    return this._alleItems()
      .filter((i) => i.type !== "epic" && (!status || i.status === status));
  }

  async listEpics() {
    const all = this._alleItems();
    return all
      .filter((i) => i.type === "epic")
      .map((e) => ({ ...e, progress: epicProgress(all, e.id) }));
  }

  async moveIssue(id, to) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(`Issue ${id} nicht gefunden: ${p}`);
    const raw = readFileSync(p, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    meta.status = to;
    writeFileSync(p, serializeFrontmatter(meta, body), "utf-8");
  }

  async commentIssue(id, text) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(`Issue ${id} nicht gefunden: ${p}`);
    const raw = readFileSync(p, "utf-8");
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const comment = `\n\n---\n**Kommentar** (${timestamp})\n\n${text}`;
    writeFileSync(p, raw + comment, "utf-8");
  }

  async updateIssue(id, { body }) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(`Issue ${id} nicht gefunden: ${p}`);
    const { meta } = parseFrontmatter(readFileSync(p, "utf-8"));
    // Nur der Body wird ersetzt; Status, Titel und Labels gehoeren anderen Kommandos.
    writeFileSync(p, serializeFrontmatter(meta, body), "utf-8");
  }

  // Nur das Feld `labels` wird angefasst — alle uebrigen Metadaten und der Body
  // gehen unveraendert durch serializeFrontmatter zurueck. Bleibt kein Label uebrig,
  // verschwindet das Feld ganz: `labels: ` waere beim naechsten Lesen zwar ebenfalls
  // ein leeres Array, aber eine Zeile, die etwas zu behaupten scheint.
  async labelIssue(id, name, aktion) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(`Issue ${id} nicht gefunden: ${p}`);
    const { meta, body } = parseFrontmatter(readFileSync(p, "utf-8"));
    const vorhanden = labelsAusFrontmatter(meta);
    const ergaenzt = vorhanden.includes(name) ? vorhanden : [...vorhanden, name];
    const neu = aktion === "add" ? ergaenzt : vorhanden.filter((l) => l !== name);
    if (neu.length > 0) meta.labels = neu.join(", ");
    else delete meta.labels;
    writeFileSync(p, serializeFrontmatter(meta, body), "utf-8");
  }
}

class LocalCodeHost {
  async getRepoName() {
    // Frueher mit 2>/dev/null — die Umleitung gibt es unter cmd.exe nicht (#196);
    // gitRemoteUrl liefert stattdessen null, wenn kein Remote da ist.
    //
    // Liefert seit Issue #214 owner/repo statt nur repo: Alle drei Code-Hosts geben
    // dieselbe Form zurueck, sonst beantwortet dasselbe Kommando je nach Projekt etwas
    // anderes. Ohne Remote bleibt es beim Verzeichnisnamen — dokumentiertes Verhalten
    // des lokalen Modus.
    return normalizeRepoName(gitRemoteUrl()) || basename(resolve("."));
  }

  // Kein createPullRequest: codePr() bricht schon an supportsPullRequests() ab und gibt
  // den Hinweis auf den lokalen git-Merge aus. Eine Methode hier waere unerreichbar
  // (entfernt in Issue #188) — und ein zweiter, abweichender Wortlaut fuer denselben Fall.
  supportsPullRequests() { return false; }

  // `keine` liefert ausschliesslich dieser Host: Ein Projekt ohne CI darf nicht
  // releaseunfaehig werden, deshalb Exit 0 und kein Fehler.
  async getCiStatus() {
    return { status: "keine", jobs: [] };
  }
}

// ============================================================
// Toolbox-Adapter (eigenes Kanban-Board als Issue-Tracker, #368)
// ============================================================

// Kit-Status <-> KanbanColumn (Backend). Simple Uppercase-Abbildung.
const TOOLBOX_STATUS_TO_COLUMN = {
  backlog:     "BACKLOG",
  ready:       "READY",
  in_progress: "IN_PROGRESS",
  in_review:   "IN_REVIEW",
  done:        "DONE",
};
const TOOLBOX_COLUMN_TO_STATUS = Object.fromEntries(
  Object.entries(TOOLBOX_STATUS_TO_COLUMN).map(([s, c]) => [c, s])
);

/**
 * Loest das kanban-kit-Token pro App auf (#135). Reine Funktion: cfg, env und readFile werden
 * injiziert, damit die Precedence ohne Dateisystem testbar ist. Erste Fundstelle gewinnt:
 *   1. env.TBX_TOKEN (getrimmt)
 *   2. cfg.toolbox.tokenFile — Datei lesen, Inhalt trimmen (Pfad relativ zum cwd)
 *   3. <TBX_CONFIG_DIR | ~/.config/toolbox-cli>/tokens.json .token (globaler tbx-Login, #367)
 * Fail-fast: ein Klartext-Token in der Config (cfg.toolbox.token) bricht immer ab —
 * Secrets gehoeren nicht ins eingecheckte Repo.
 */
export function resolveToolboxToken({ cfg, env, readFile }) {
  if (cfg?.toolbox?.token) {
    throw new BoardError(
      "kein Klartext-Token in workflow.config.json — nutze TBX_TOKEN oder toolbox.tokenFile."
    );
  }

  const envToken = (env?.TBX_TOKEN || "").trim();
  if (envToken) return envToken;

  const tokenFile = cfg?.toolbox?.tokenFile;
  if (tokenFile) {
    let content;
    try {
      content = readFile(resolve(tokenFile));
    } catch (e) {
      throw new BoardError(`toolbox.tokenFile '${tokenFile}' nicht lesbar: ${e.message}`);
    }
    const fileToken = (content || "").trim();
    if (!fileToken) throw new BoardError(`toolbox.tokenFile '${tokenFile}' ist leer.`);
    return fileToken;
  }

  const dir = env?.TBX_CONFIG_DIR || join(homedir(), ".config", "toolbox-cli");
  let storedToken = "";
  try {
    const tokens = JSON.parse(readFile(join(dir, "tokens.json")));
    if (typeof tokens?.token === "string") storedToken = tokens.token.trim();
  } catch { /* kein oder kaputter tbx-Login — faellt in die Fehlermeldung unten */ }
  if (storedToken) return storedToken;

  throw new BoardError(
    "Kein Toolbox-Token gefunden. Drei Wege: TBX_TOKEN als Umgebungsvariable setzen, " +
    "toolbox.tokenFile in workflow.config.json auf eine Token-Datei zeigen lassen, " +
    "oder Token in der Web-UI erzeugen und 'tbx auth login' ausfuehren."
  );
}

/**
 * Interpretiert die Response von POST /api/kanban/items (#141, Bug #140). Reine Funktion,
 * damit die drei Vertragsfaelle ohne Netz testbar sind:
 *   1. { number } vorhanden — alter Vertrag (Original-Toolbox, kanban-kit vor #373):
 *      die angelegte Board-Karte traegt sofort eine Anzeigenummer.
 *   2. nur { id } — neuer Pool-Vertrag (kanban-kit >= 1.5): der Create landet als board-lose
 *      Idee im Projekt-Ideen-Pool; die Board-Nummer entsteht erst beim menschlichen Einplanen.
 *   3. weder number noch id — harter Fehler mit Response-Auszug, nie stilles "undefined".
 */
export function interpretToolboxCreateResponse(created) {
  if (created?.number != null) return { id: String(created.number) };
  if (created?.id != null) return { id: null, ideaId: String(created.id), pending: true };
  throw new BoardError(
    `Unerwartete Create-Response der Kanban-API (weder 'number' noch 'id'): ${JSON.stringify(created)}`
  );
}

/**
 * Modell-Selbstauskunft fuer Board-Requests (#193). Reine Funktion ueber der Umgebung:
 * Ist KIT_AGENT_MODEL gesetzt (der Nacht-Runner setzt es auf den Wert von --model und
 * vererbt es ueber die Claude-Session bis in diesen Prozess), tragen die Requests den
 * Header X-Agent-Model. Ohne die Variable — also in jeder interaktiven Session — bleibt
 * er weg; keine Angabe ist ehrlicher als eine geratene.
 *
 * Ausdruecklich eine Selbstauskunft des Clients, kein Nachweis: Der Server kann Session
 * und Token verifizieren, das Modell nicht. Die Board-Seite kennzeichnet den Wert
 * entsprechend ("lt. Angabe").
 */
export function agentModelHeader(env = process.env) {
  const model = (env.KIT_AGENT_MODEL || "").trim();
  return model ? { "X-Agent-Model": model } : {};
}

/**
 * Issue-Tracker gegen das eigene Toolbox-Kanban-Board. Zwei-Achsen-Modell (#368): der Code liegt
 * weiter auf GitHub (codeHost bleibt github), nur der Issue-Tracker ist das Board.
 *
 * Auth: Token per resolveToolboxToken() (TBX_TOKEN > toolbox.tokenFile > globaler tbx-Login,
 * #135); Host aus ~/.config/toolbox-cli/config.json (dieselbe Quelle wie das tbx-CLI, #367),
 * per config.toolbox.host ueberschreibbar. Alle Aufrufe tragen den Header X-Kanban-Token,
 * im Nachtbetrieb zusaetzlich X-Agent-Model als Selbstauskunft (siehe agentModelHeader).
 *
 * number vs. DB-id: Der Workflow adressiert Issues ueber die Board-Anzeigenummer (#N). Move/Comment
 * brauchen die DB-id aus der Item-Response; sie wird intern per Board-Fetch aufgeloest.
 */
class ToolboxIssueTracker {
  constructor(config) { this._cfg = config; }

  _auth() {
    const dir = process.env.TBX_CONFIG_DIR || join(homedir(), ".config", "toolbox-cli");
    const stored = this._readJson(join(dir, "config.json"));
    const host = this._cfg.toolbox?.host || stored?.host;
    if (!host) {
      throw new BoardError(
        "Kein Toolbox-Host gefunden. toolbox.host in workflow.config.json setzen oder 'tbx auth login' ausfuehren."
      );
    }
    const token = resolveToolboxToken({
      cfg: this._cfg,
      env: process.env,
      readFile: (path) => readFileSync(path, "utf-8"),
    });
    return { host, token };
  }

  _readJson(path) {
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
  }

  async _fetch(path, options = {}) {
    const { host, token } = this._auth();
    let res;
    try {
      res = await fetch(`${host}${path}`, {
        ...options,
        headers: { ...options.headers, "X-Kanban-Token": token, ...agentModelHeader() },
      });
    } catch (e) {
      throw new BoardError(`Toolbox-API nicht erreichbar (${host}): ${e.message}`);
    }
    if (res.status === 401) {
      throw new BoardError("Token ungueltig oder widerrufen. Bitte 'tbx auth login' erneut ausfuehren.");
    }
    if (!res.ok) {
      // Der Status bleibt stehen, auch wenn der Server eine eigene Meldung schickt
      // (Issue #460): Fuer den Aufrufer ist der Unterschied zwischen 404 und 500
      // die Diagnose — "Route gibt es nicht" gegen "Route ist kaputt". Frueher
      // ersetzte body.message den Status und nahm sie mit.
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) msg = `${msg}: ${body.message}`;
      } catch { /* kein JSON-Body */ }
      throw new BoardError(`Toolbox-API-Fehler: ${msg}`);
    }
    return res;
  }

  _toColumn(status) {
    const column = TOOLBOX_STATUS_TO_COLUMN[status];
    if (!column) throw new BoardError(`Ungueltiger Status '${status}'. Gueltig: ${VALID_STATUSES.join(", ")}`);
    return column;
  }

  _toStatus(column) {
    return TOOLBOX_COLUMN_TO_STATUS[column] || null;
  }

  /** Liest das gruppierte Board und liefert eine flache Liste inkl. abgeleitetem Status. */
  async _boardItems() {
    const res = await this._fetch("/api/kanban/items");
    const grouped = await res.json();
    return Object.values(grouped)
      .flat()
      .map((item) => ({ ...item, status: this._toStatus(item.column) }));
  }

  _findByNumber(items, number) {
    return items.find((i) => i.number === number) || null;
  }

  _resolveByNumber(items, number) {
    const item = this._findByNumber(items, number);
    if (!item) throw new BoardError(`Issue ${number} nicht gefunden`);
    return item;
  }

  async createIssue({ title, body, derivedFrom }) {
    const { host } = this._auth();
    // Neu angelegte Issues gehen DIREKT ins Backlog und tragen sofort ihre
    // Board-Nummer. Das ist die Vorgabe (Issue #313); der Ideen-Speicher
    // (kanban-kit #245) ist die bewusste Abwahl per `ideaStored: true`.
    //
    // Deshalb `!== true` und nicht `=== false`: Frueher lenkte ein FEHLENDES Feld
    // die Karte in den Pool — ohne Nummer, in keiner Spalte, sichtbar erst nach dem
    // manuellen Einplanen. Aufgefallen ist das niemandem, weil dieses Repo den Wert
    // explizit setzt und das Dogfooding damit am Default vorbeilief.
    //
    // Das Wire-Feld heisst seit kanban-kit 2026-08 `direct` (Issue #295) — der
    // frueher gesendete Schluessel `ideaStored` wird serverseitig ignoriert und geht
    // deshalb in KEINEM Modus mehr mit. Der Config-Schluessel behaelt bewusst seinen
    // Namen: Er beschreibt die Absicht des Nutzers, nicht die API-Form, und eine
    // Umbenennung waere fuer jedes Bestandsprojekt ein stiller Bruch.
    //
    // Backends ohne `direct` ignorieren das Feld und legen wie bisher an.
    const direkt = this._cfg.toolbox?.ideaStored !== true;
    const payload = { title, body: body || "", column: "BACKLOG" };
    if (direkt) payload.direct = true;
    // Die Herkunft geht nur beim Anlegen mit (Issue #356). Ein Nachtragen gibt es
    // nicht: Eine board-lose Pool-Idee ist fuer den Adapter unerreichbar, und der
    // idempotente Wiederholungs-Ingest verwirft ein spaeter mitgeschicktes Feld.
    //
    // Instanzen, die `derivedFrom` nicht kennen, ignorieren den Schluessel still —
    // die Karte entsteht, die Herkunft fehlt, nichts weist darauf hin. Anders als
    // bei `direct` daneben gibt es hier bewusst KEINEN Waechter: Er braeuchte ein
    // Echo in der Antwort, und genau die Pool-Idee liefert keines. Eine Absicherung,
    // die im wichtigsten Fall nicht greift, waere schlechter als die benannte
    // Luecke — sie steht in docs/dokumentation.md.
    if (derivedFrom !== undefined) payload.derivedFrom = derivedFrom;
    const res = await this._fetch("/api/kanban/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const created = await res.json();
    const result = interpretToolboxCreateResponse(created);
    // interpretToolboxCreateResponse wertet nur die Antwort aus und kennt den
    // gesendeten Modus nicht — deshalb sitzt die Pruefung hier. Ohne sie meldete ein
    // direkt angefordertes Anlegen, das nur eine ideaId zurueckbringt, faelschlich
    // `pending` samt Pool-Hinweis: Der Aufruf saehe erfolgreich aus, die Karte haette
    // keine Nummer, und niemand bemerkt es.
    if (direkt && result.pending) {
      throw new BoardError(
        "Direktes Anlegen lieferte keine Board-Nummer — die Instanz kennt 'direct' offenbar nicht. "
        + "Direkt ins Backlog ist die Vorgabe; wer bewusst in den Ideen-Pool anlegen will, "
        + "setzt 'toolbox.ideaStored: true' in .claude/workflow.config.json."
      );
    }
    if (result.pending) {
      return {
        ...result,
        url: `${host}/kanban`,
        hinweis: "Als Idee im Projekt-Ideen-Pool angelegt; die Board-Nummer entsteht beim Einplanen.",
      };
    }
    return { ...result, url: `${host}/kanban` };
  }

  async getIssue(number) {
    const num = Number(number);
    const item = this._resolveByNumber(await this._boardItems(), num);
    const type = item.type || "task";
    return {
      id: String(item.number),
      title: item.title,
      body: item.body,
      // Ein Vorhaben hat keinen Status: `CardService.move` laesst es gar nicht auf
      // dem Board positionieren, die Compat-API liefert BACKLOG nur als Fallback.
      // `null` heisst "hat keinen" — das ist die Wahrheit (Issue #377).
      status: type === "epic" ? null : item.status,
      labels: labelNamesFrom(item.labels),
      type,
      comments: await this._comments(item.id),
      // Der Feldname der Karten-API ist nicht gegen die Live-Instanz belegt (#457,
      // manueller Pruefpunkt). Darum drei Kandidaten statt eines geratenen Namens:
      // createdAt fuehrt der Kommentar-Endpunkt derselben API bereits, created_at
      // ist die REST-uebliche Form, created die knappe. Liefert die Instanz keins
      // davon, fehlt `created` — #450/#451 muessen damit rechnen.
      ...createdFrom(item.createdAt, item.created_at, item.created),
    };
  }

  // Kommentare ueber den Lesepfad aus kanban-kit#448 (kanban-kit#449). Der Endpunkt
  // ist juenger als der Rest der API: Eine Instanz, die ihn noch nicht kennt,
  // antwortet mit 404/405 und wuerde `issue get` sonst komplett scheitern lassen.
  // Der Verlauf ist Zusatzinformation — Titel/Body/Status sind die Hauptsache.
  // Deshalb leeres Array statt Abbruch, mit Hinweis auf stderr.
  async _comments(itemId) {
    try {
      const res = await this._fetch(`/api/kanban/items/${itemId}/comments`);
      return normalizeComments(await res.json());
    } catch (e) {
      process.stderr.write(`Hinweis: Kommentare nicht abrufbar: ${e.message}\n`);
      return [];
    }
  }

  /**
   * Aktivitaetsverlauf einer Karte (Issue #460).
   *
   * Die Route ist `/api/kanban/items/{id}/activity` (Issue #670) und adressiert die
   * **interne** ID — dieselbe Falle wie bei move, comments und labels (Befund vom
   * 2026-08-29). Daher `_resolveByNumber`. Sie gibt es seit kanban-kit v1.43.0: Dort
   * bleibt ein board-gebundenes Token auf `/api/kanban/**` beschraenkt (kanban-kit
   * #877), und der Verlauf ist innerhalb dieser Grenze lesbar (#876). Die fruehere
   * Karten-Route ausserhalb der Grenze beantwortet ein solches Token mit 403.
   *
   * Ein Unterschied zu `_comments` bleibt, und er ist beabsichtigt: **Ein Fehler wird
   * nicht geschluckt.** `_comments` faengt 404/405 aelterer Instanzen ab und liefert
   * `[]`; hier waere das falsch. Der Verlauf ist die Quelle des Anlagedatums — eine
   * leere Liste hiesse „Karte ohne Geschichte" und liesse das Gate ein altes Paket fuer
   * neu halten. Der Aufrufer soll den Fehler sehen, samt HTTP-Status.
   */
  async listActivity(number) {
    const num = Number(number);
    const item = this._resolveByNumber(await this._boardItems(), num);
    const res = await this._fetch(`/api/kanban/items/${item.id}/activity`);
    return await res.json();
  }

  /**
   * Sammelform des Verlaufs (Issue #786).
   *
   * Der Grund fuer diese Methode steht in EINER Zeile: `_boardItems()` laeuft genau
   * einmal. Die Einzelform holt die vollstaendige Kartenliste bei jedem Aufruf mit;
   * die Ruecklaeuferquote fragt Dutzende Karten ab und haette sie sonst Dutzende Male
   * geholt — gegen eine API, die drosselt.
   *
   * Eine nicht auffindbare Nummer wird zum Eintrag mit Fehlergrund. Ein TRANSPORTFEHLER
   * dagegen — 403, 404 auf die Verlaufs-Route, Netz weg — reisst den Aufruf rot ab, wie
   * in der Einzelform: Er betrifft nicht eine Karte, sondern den Zugang. Still
   * weitergezaehlt ergaebe er eine Quote, die nach Null aussieht und in Wahrheit nichts
   * gemessen hat.
   */
  async listActivityMany(numbers) {
    const items = await this._boardItems();
    const ergebnis = {};
    for (const number of numbers) {
      const item = this._findByNumber(items, Number(number));
      if (!item) {
        ergebnis[number] = { fehler: `Issue ${number} nicht gefunden` };
        continue;
      }
      const res = await this._fetch(`/api/kanban/items/${item.id}/activity`);
      ergebnis[number] = await res.json();
    }
    return ergebnis;
  }

  // Ohne eigene Status-Validierung: issueList() im Dispatch prueft den Wert gegen
  // VALID_STATUSES, bevor irgendein Tracker ihn sieht — die Pruefung hier war
  // unerreichbar (entfernt in Issue #188) und als einzige der vier Tracker doppelt.
  async listIssues(status) {
    const items = await this._boardItems();
    const filtered = items
      // Epics nehmen nicht am Spalten-Workflow teil: bei Status-Filter ausschliessen.
      // Vorhaben sind nie Arbeitspakete — der Ausschluss gilt unabhaengig vom Filter
      // (Issue #377). Die frueher fuehrende Bedingung `!status ||` schaltete ihn ab,
      // sobald ungefiltert gelistet wurde. Sie ersatzlos zu streichen waere falsch:
      // ohne Filter ist `status` undefined, und `i.status === undefined` trifft auf
      // keine echte Karte zu — die Liste kaeme leer zurueck.
      .filter((i) => i.type !== "epic" && (!status || i.status === status));
    // Mit Status-Filter liegen alle Items in derselben Spalte: die API-Reihenfolge
    // (positionInColumn) ist die Board-/Listen-Reihenfolge und bleibt erhalten (#128);
    // ungefiltert bleibt die stabile numerische Sortierung.
    if (!status) filtered.sort((a, b) => a.number - b.number);
    // Die Karten-API liefert Labels — gegen die Live-Instanz belegt am 2026-08-12
    // (Issue #312). Eine aeltere Antwort ohne das Feld bleibt bei [], deshalb der
    // Normalisierer statt eines direkten Zugriffs. Der Schreibpfad steht seit
    // Issue #375 daneben (siehe labelIssue) — dieser Adapter kann Labels lesen
    // und schreiben.
    // `type` wird durchgereicht wie beim lokalen Tracker, samt dessen Default: ein
    // Item ohne das Feld liefert "task" statt undefined, das JSON.stringify auslassen
    // wuerde (Issue #377).
    return filtered.map((i) => ({ id: String(i.number), title: i.title, body: i.body, status: i.status, labels: labelNamesFrom(i.labels), type: i.type || "task" }));
  }

  async listEpics() {
    const res = await this._fetch("/api/kanban/epics");
    const epics = await res.json();
    return (Array.isArray(epics) ? epics : []).map((e) => ({
      id: String(e.number ?? e.id),
      title: e.title,
      shortcode: e.shortcode || "",
      progress: e.progress || { total: 0, done: 0 },
    }));
  }

  async moveIssue(number, to) {
    const num = Number(number);
    const column = this._toColumn(to);
    const items = await this._boardItems();
    const item = this._resolveByNumber(items, num);
    // Zielposition = Ende der Zielspalte (bei gleichbleibender Spalte: aktuelle Position halten).
    const targetPosition =
      item.column === column ? item.position : items.filter((i) => i.column === column).length;
    await this._fetch(`/api/kanban/items/${item.id}/move`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column, position: targetPosition }),
    });
  }

  async commentIssue(number, text) {
    const num = Number(number);
    const item = this._resolveByNumber(await this._boardItems(), num);
    await this._fetch(`/api/kanban/items/${item.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
  }

  async updateIssue(number, { body }) {
    const num = Number(number);
    const item = this._resolveByNumber(await this._boardItems(), num);
    await this._fetch(`/api/kanban/items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Der Titel wird mitgeschickt, obwohl er sich nicht aendert: Behandelt das
      // Backend das PUT als Vollersatz, ginge er sonst verloren.
      body: JSON.stringify({ title: item.title, body }),
    });
  }

  // Diese Stelle hat lange geworfen, mit Verweis auf mannewolff/kanban-kit#457: die
  // API biete kein atomares Setzen per Name, und eine listenersetzende Route waere
  // unbrauchbar. Seit kanban-kit#574 stimmt beides nicht mehr — POST ergaenzt genau
  // ein Label, DELETE entfernt genau eines, die uebrige Liste bleibt unangetastet
  // (Issue #375).
  //
  // Zwei Eigenheiten der Routen zaehlen hier:
  //  - Adressiert wird die INTERNE Karten-ID, nicht die Kartennummer — wie bei
  //    /move und /comments. Daher der Umweg ueber _resolveByNumber.
  //  - Beim Entfernen steht der Name im QUERY, nicht im Pfad. Der Server trimmt ihn
  //    nur und lehnt allein Leerstrings ab; jedes andere Zeichen ist gueltig, auch
  //    `/`. Ein Pfadsegment truege das nicht, weil Tomcat kodierte Slashes per
  //    Default ablehnt — deshalb encodeURIComponent statt Interpolation.
  async labelIssue(number, name, aktion) {
    const num = Number(number);
    const item = this._resolveByNumber(await this._boardItems(), num);
    // Der Server antwortet mit 404, wenn das Board keine Definition dieses Namens
    // fuehrt (LabelNotFoundException) — absichtlich hart, damit ein Tippfehler im
    // Nachtlauf keinen Label-Muell erzeugt. Roh durchgereicht ist dieser 404 aber
    // nicht zu deuten: Er nennt weder den Namen noch den Ausweg (Issue #384).
    const uebersetze = async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof BoardError && /HTTP 404|nicht gefunden/i.test(e.message)) {
          throw new BoardError(
            `Label '${name}' ist am Board nicht definiert. Die Definition muss einmal je Board angelegt werden (POST /api/boards/{boardId}/labels), danach setzt und entfernt die Automatik sie.`
          );
        }
        throw e;
      }
    };
    if (aktion === "add") {
      await uebersetze(() => this._fetch(`/api/kanban/items/${item.id}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }));
      return;
    }
    await uebersetze(() => this._fetch(`/api/kanban/items/${item.id}/labels?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }));
  }
}

// ============================================================
// Hilfsfunktionen
// ============================================================

// Normalisiert die roh vom Backend gelieferten Labels auf ein flaches Array von
// Namen: GitLab liefert Objekte ({name}), andere Backends evtl. nackte Strings,
// oder das Feld fehlt ganz. Fehlform oder fehlendes Feld -> [].
//
// Von `listIssues` UND `getIssue` aller Tracker geteilt (Issue #312), damit
// dieselbe Karte ueber beide Wege dieselben Labels liefert. Aufrufer (z. B. das
// Routing-Label in night.mjs, Issue #159) bekommen verlaesslich ein Array — ein
// fehlendes Feld wuerde sonst still zu "keine Labels" statt zu einem Fehler
// (Issue #158).
export function labelNamesFrom(rawLabels) {
  if (!Array.isArray(rawLabels)) return [];
  return rawLabels
    .map((l) => (l && typeof l === "object" ? l.name : l))
    .filter((n) => n != null);
}

// Labels nachbeschaffen fuer den GitHub-Tracker (Issue #180).
//
// `gh project item-list` liefert pro Item nur body, number, repository, title, type
// und url — kein labels-Feld, und ein Flag zur Feldauswahl gibt es nicht. Ohne
// Nachschlag traegt bei issueTracker: github kein Ready-Issue jemals ein Label, und
// das Routing-Label des Nacht-Runners (Issue #159) ueberspringt zwangslaeufig alles.
//
// Aufgeteilt in zwei reine Funktionen, weil die Tracker-Klassen selbst wegen ihrer
// CLI-Nebenwirkungen nicht exportiert und damit nicht direkt testbar sind.

// Rohantwort von `gh issue list --json number,labels` -> Map "<nummer>" -> [Namen].
// Schluessel bewusst als String: Die Items tragen ihre id als String, ein
// Zahlen-Schluessel wuerde nie treffen.
export function labelMapFrom(rawIssues) {
  const map = new Map();
  if (!Array.isArray(rawIssues)) return map;
  for (const issue of rawIssues) {
    if (issue?.number == null) continue;
    map.set(String(issue.number), labelNamesFrom(issue.labels));
  }
  return map;
}

// Heftet die nachgeschlagenen Labels an die Items. Die Reihenfolge bleibt
// unangetastet — sie ist bei status-gefilterten Listen die Board-Reihenfolge
// (Issue #128), nach der der Nacht-Runner abarbeitet. Eine fehlende Nummer fuehrt
// zu [] statt undefined, damit Aufrufer nie auf einem fehlenden Feld arbeiten.
export function withLabels(items, labelMap) {
  if (!Array.isArray(items)) return [];
  return items.map((i) => ({ ...i, labels: labelMap.get(String(i.id)) || [] }));
}

// Normalisiert die roh gelieferten Kommentare auf {author, body, createdAt}
// (kanban-kit#449). Die drei Tracker liefern drei Formen:
//   GitHub        author.login   + createdAt
//   GitLab        author.username + created_at, dazu System-Notes (system: true),
//                 die keine echten Kommentare sind ("changed the description")
//   kanbancompat  author bereits als String + createdAt
// Fehlform oder fehlendes Feld -> []. Fehlende Einzelfelder werden zu leeren
// Strings statt undefined, damit Aufrufer nicht pro Feld pruefen muessen.
// Kommentare ohne Body werden verworfen: Es gibt nichts anzuzeigen, und ein
// leerer Eintrag im Verlauf ist irrefuehrender als gar keiner.
//
// Abgrenzung (siehe Issue #155): Kommentare tragen Verlauf und Berichte. Die
// fachliche PO-Verhandlung bleibt im Body — daran aendert dieses Feld nichts.
export function normalizeComments(rawComments) {
  if (!Array.isArray(rawComments)) return [];
  return rawComments
    .filter((c) => c && typeof c === "object" && !c.system)
    .map((c) => ({
      author: typeof c.author === "object" && c.author !== null
        ? String(c.author.login ?? c.author.username ?? "")
        : String(c.author ?? ""),
      body: String(c.body ?? ""),
      createdAt: String(c.createdAt ?? c.created_at ?? ""),
    }))
    .filter((c) => c.body !== "");
}

// Normalisiert das Anlagedatum eines Issues auf den Kalendertag `JJJJ-MM-TT`
// (Issue #457). Von `getIssue` aller vier Tracker geteilt, analog zu
// labelNamesFrom (#158) und normalizeComments (kanban-kit#449) — sonst stuende
// dieselbe Kuerzung viermal da und koennte viermal auseinanderlaufen.
//
// Uebernommen werden die ersten zehn Zeichen des Plattformwerts, OHNE Umrechnung
// in eine Zeitzone: GitHub liefert UTC mit `Z`, GitLab mit Offset. "In UTC
// umrechnen" und "den Tag nehmen, den die Plattform nennt" sind verschiedene
// Ergebnisse, und das Gate aus Ausbaustufe 4 vergleicht Tage.
//
// Rueckgabe ist ein Objekt zum Spreaden, kein String: Fehlt oder taugt der Wert
// nicht, kommt {} zurueck und das Feld `created` fehlt im Ergebnis. Weder "" noch
// "heute" — ein erfundenes Anlagedatum waere schlimmer als keins, weil das Gate ein
// altes Paket als neu werten und an ihm scheitern wuerde. Das gilt auch fuer das
// handgeschriebene Frontmatter des local-Trackers: `14.08.2026` wird nicht
// umgedeutet, es faellt weg.
//
// Variadisch, weil der Toolbox-Adapter mehrere Feldnamen in Betracht zieht: Der
// erste Kandidat, der einen gueltigen Tag ergibt, gewinnt.
export function createdFrom(...kandidaten) {
  for (const roh of kandidaten) {
    if (typeof roh !== "string") continue;
    const tag = roh.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(tag)) return { created: tag };
  }
  return {};
}

function labelToStatus(labelNames, config, state) {
  for (const [status, label] of Object.entries(columnLabels(config))) {
    if (isStateColumn(status, config)) continue;
    if (labelNames.includes(label)) return status;
  }
  if (state === "closed") return "done";
  if (state === "opened" && isStateColumn("backlog", config)) return "backlog";
  return null;
}

// ============================================================
// Adapter-Auswahl
// ============================================================

function resolveTracker(config) {
  switch (config.issueTracker) {
    case "github": return new GitHubIssueTracker(config);
    case "gitlab": return new GitLabIssueTracker(config);
    case "local":  return new LocalIssueTracker(config);
    case "toolbox": return new ToolboxIssueTracker(config);
    default: fail(`Unbekannter issueTracker: '${config.issueTracker}'. Erwartet: github | gitlab | local | toolbox`);
  }
}

function resolveCodeHost(config) {
  switch (config.codeHost) {
    case "github": return new GitHubCodeHost(config);
    case "gitlab": return new GitLabCodeHost();
    case "local":  return new LocalCodeHost();
    default: fail(`Unbekannter codeHost: '${config.codeHost}'. Erwartet: github | gitlab | local`);
  }
}

// ============================================================
// Kontext-Achse (Vault-Pfade fuer /kontext und /document, Issue #202)
// ============================================================

// Die Zielpfade im Memory-Vault entstehen hier in Code statt als Prosa im Skill-Prompt.
// Grund: Teilen sich mehrere Service-Repos einen Vault, schrieben bisher alle in dieselbe
// Tageslog-Datei — in einem Nextcloud-Vault ein Sync-Konflikt, bei parallelen Sessions ein
// ueberschriebener Abschnitt. Und ein stiller Pfadfehler faellt bei einem Skill, der einmal
// pro Session laeuft, erst Wochen spaeter auf: genau die Fehlerklasse, fuer die das
// Leitplanken-Prinzip (Issue #122) ein Gate statt einer Formulierung verlangt.

const KONTEXT_DEFAULTS = {
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
    fail(`kontext.config.json konnte nicht gelesen werden: ${pfad}`);
  }
}

// Eigene Suche statt loadConfig(): Das ist kontext.config.json, nicht
// workflow.config.json. Home ueber homedir() und nicht ueber HOME — unter Windows
// liest homedir() USERPROFILE (Issue #187).
function loadKontextConfig() {
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
async function kontextRepoName() {
  const config = readWorkflowConfig();
  if (!config || !KNOWN_CODE_HOSTS.has(config.codeHost)) return basename(resolve("."));
  const repoName = await resolveCodeHost(config).getRepoName();
  return repoName.replace(/\.git$/, "").split("/").pop();
}

// Tagesdatum lokal statt per toISOString(): Eine Session um 23:30 MESZ gehoert ins Log
// von heute, nicht in das von morgen — in UTC waere der Tag da schon gewechselt.
function heute() {
  const jetzt = new Date();
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}`;
}

// ============================================================
// Dispatch
// ============================================================

// Ein Handler je issue-Subbefehl: haelt die Argument-Validierung flach (auf Funktionsebene
// statt tief in verschachtelten switch-cases) und damit die kognitive Komplexitaet niedrig.
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
export const AUTOR_MODELL_ZEILE = /^Autor-Modell:[^\S\n]*(\S(?:[^\n]*\S)?)[^\S\n]*$/m;
const AUTOR_MODELL_HILFE =
  'Der Body braucht eine Zeile "Autor-Modell: <modell>" im Kontext-Abschnitt. ' +
  'Alternativ --author-model <modell> setzen; im Nachtbetrieb genuegt gesetztes KIT_AGENT_MODEL.';

/**
 * Liefert den Body mit garantierter Autor-Modell-Zeile — oder bricht ab.
 *
 * Reihenfolge: vorhandene Zeile gewinnt, sonst --author-model, sonst
 * KIT_AGENT_MODEL. Widersprechen sich Zeile und Flag, ist das ein Fehler und kein
 * stilles Ueberschreiben: Wer eine Autorschaft ueberschreibt, faelscht sie.
 */
export function autorModellSicherstellen(body, flagWert, env = process.env) {
  const vorhanden = body.match(AUTOR_MODELL_ZEILE);
  const flag = typeof flagWert === "string" ? flagWert.trim() : "";
  if (vorhanden) {
    if (flag && flag !== vorhanden[1]) {
      fail(`--author-model '${flag}' widerspricht der vorhandenen Zeile 'Autor-Modell: ${vorhanden[1]}'. Eine der beiden weglassen.`);
    }
    return body;
  }
  const wert = flag || (env.KIT_AGENT_MODEL || "").trim();
  if (!wert) fail(`Kein Autor-Modell angegeben. ${AUTOR_MODELL_HILFE}`);

  // Ans Ende des Kontext-Abschnitts, nicht ans Dateiende: Dort suchen der
  // /issues-Skill und /issue-review sie. Ohne Kontext-Abschnitt (Ideen, fremde
  // Formate) kommt sie an den Anfang — Hauptsache, sie ist da und auffindbar.
  const kontext = body.match(/^## Kontext[^\n]*\n/m);
  if (!kontext) return `Autor-Modell: ${wert}\n\n${body}`;
  const start = kontext.index + kontext[0].length;
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
 * Die drei Titel-Praefixe der Dokumente, die nie implementiert werden: `[Fachlich]`
 * (PO-Schleife), `[Plan]` (Plandokument aus /techplan) und `[Idee]` (rohe Idee).
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
 * saehe das wie ein Erfolg aus (#276).
 *
 * `\s*` und `i` wie im Nacht-Runner, damit die Erkennung zeichengleich bleibt:
 * fuehrender Leerraum erlaubt, Gross- und Kleinschreibung gleichgueltig, das
 * Praefix steht am Titelanfang. `[Fachplan]`, `[Konzept]`, `Fachlich: …` und ein
 * `[Plan]` mitten im Titel sind KEIN Praefix — sie bezeichnen Arbeitspakete.
 */
export const FACHLICH_PRAEFIX = /^\s*\[fachlich\]/i;
export const PLAN_PRAEFIX = /^\s*\[plan\]/i;
export const IDEE_PRAEFIX = /^\s*\[idee\]/i;

export function istFachlich(title) {
  return FACHLICH_PRAEFIX.test(title || "");
}

export function istPlan(title) {
  return PLAN_PRAEFIX.test(title || "");
}

export function istIdee(title) {
  return IDEE_PRAEFIX.test(title || "");
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

/** Kontextueberschrift — dieselbe Form, die `autorModellSicherstellen` erkennt. */
const KONTEXT_UEBERSCHRIFT = /^## Kontext(?:[ \t].*)?$/;
// Der negative Lookahead ist der Kern (Issue #403): Ohne ihn akzeptieren `{3,} und
// [^\n]* dieselben Zeichen, und eine Zeile aus lauter Backticks ohne Zeilenende
// laesst die Engine jede Aufteilung durchprobieren — 78 ms bei 16 KiB, quadratisch
// wachsend. Mit ihm ist die Fence-Laenge eindeutig: 0,04 ms, linear.
export const FENCE_ZEILE = /^ {0,3}(`{3,}(?!`)|~{3,}(?!~))([^\n]*)$/;

/** \r\n und einzelne \r zu \n — sonst haengt der Stand am Zeilenende des Editors. */
function normalisiereZeilenenden(body) {
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
        if (KONTEXT_UEBERSCHRIFT.test(zeile)) start = offset;
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
  if (wert === true) fail("--derived-from braucht einen Wert (Kartennummer des naechsten Vorfahren)");
  const nummer = Number(wert);
  if (!Number.isInteger(nummer) || nummer < 1) {
    fail(`--derived-from '${wert}' ist keine positive Ganzzahl.`);
  }
  return nummer;
}

async function issueCreate(tracker, args) {
  if (!args.title) fail("--title ist erforderlich");
  // Ohne jede Body-Quelle bleibt der Body leer — der lokale Tracker setzt dann
  // seine Abschnitts-Vorlage. leseTextQuelle wuerde einen leeren Text ablehnen,
  // deshalb wird es nur befragt, wenn ueberhaupt eine Quelle angegeben ist.
  const hatQuelle = args.body !== undefined || args["body-file"] !== undefined;
  // Vor jeder Body-Aufloesung und damit vor jedem Netzaufruf: Ein Tippfehler in der
  // Nummer soll keine Karte anlegen und keine Datei lesen.
  const derivedFrom = derivedFromOption(args["derived-from"]);
  const roh = hatQuelle ? leseTextQuelle(args.body, args["body-file"], "body") : "";
  const felder = {
    title: args.title,
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
  out(await tracker.createIssue(felder));
}

async function issueGet(tracker, args) {
  const id = args._[0];
  if (!id) fail("id ist erforderlich: board.mjs issue get <id>");
  out(await tracker.getIssue(id));
}

async function issueList(tracker, args) {
  if (args.status && !VALID_STATUSES.includes(args.status)) {
    fail(`Ungueltiger Status '${args.status}'. Gueltig: ${VALID_STATUSES.join(", ")}`);
  }
  out(await tracker.listIssues(args.status));
}

async function issueEpics(tracker) {
  if (typeof tracker.listEpics !== "function") {
    fail("epics wird von diesem Tracker nicht unterstuetzt (verfuegbar bei: local, toolbox)");
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
async function issueActivity(tracker, config, args) {
  const id = args._[0];
  const ids = args.ids;
  // Beide Eingabewege zusammen werden abgewiesen statt einer stillschweigend zu
  // gewinnen: Welcher das waere, kann der Aufrufer nicht wissen, und die Ausgabeform
  // der beiden ist verschieden (Liste gegen Objekt).
  if (ids !== undefined && id) {
    fail("--ids und eine Einzelnummer schliessen sich aus: board.mjs issue activity <id> | issue activity --ids <n,n,...>");
  }
  if (ids === undefined && !id) fail("id ist erforderlich: board.mjs issue activity <id> | --ids <n,n,...>");
  if (typeof tracker.listActivity !== "function") {
    const name = config?.issueTracker ?? "dieser Tracker";
    fail(`activity wird von diesem Tracker nicht unterstuetzt — '${name}' fuehrt keinen Aktivitaetsverlauf (verfuegbar bei: local, toolbox)`);
  }
  if (ids !== undefined) {
    // `--ids` ohne Wert kommt als `true` aus parseArgs. Ein leerer oder nur aus Kommas
    // bestehender Wert bliebe sonst eine Sammelabfrage ueber nichts und gaebe `{}` aus —
    // von einem Ergebnis ohne Ruecklaeufer nicht zu unterscheiden.
    const nummern = (ids === true ? [] : String(ids).split(",").map((n) => n.trim()).filter(Boolean));
    if (!nummern.length) fail("--ids braucht mindestens eine Kartennummer: board.mjs issue activity --ids 12,13");
    out(await tracker.listActivityMany(nummern));
    return;
  }
  out(await tracker.listActivity(id));
}

// Spalten, deren Betreten den Beginn eines zuordenbaren Abschnitts markiert (Issue #733).
// Ready, Backlog und Done stehen bewusst nicht dabei: Sie sind Ablagen, keine Arbeit.
const WEGMARKEN_SPALTEN = new Set(["in_progress", "in_review"]);
const WEGMARKEN_DATEI = "wegmarken.tsv";

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
    process.stderr.write(`Hinweis: Wegmarke nicht geschrieben (${pfad}): ${e.message}\n`);
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
    process.stderr.write(`Hinweis: Bewegung nicht protokolliert (${pfad}): ${e.message}\n`);
  }
}

async function issueMove(tracker, args) {
  const [id, toStatus] = args._;
  if (!id) fail("id ist erforderlich: board.mjs issue move <id> <status>");
  if (!toStatus) fail("status ist erforderlich: board.mjs issue move <id> <status>");
  if (!VALID_STATUSES.includes(toStatus)) {
    fail(`Ungueltiger Status '${toStatus}'. Gueltig: ${VALID_STATUSES.join(", ")}`);
  }
  await tracker.moveIssue(id, toStatus);
  // Erst nach dem Zug: Eine Wegmarke auf eine gescheiterte Bewegung waere eine Buchung
  // ohne Vorgang und wuerde dem Melder einen Abschnitt erfinden. Fuer das
  // Bewegungsprotokoll gilt dasselbe — es saehe sonst Ruecklaeufer, die es nicht gab.
  wegmarkeSchreiben(id, toStatus);
  bewegungSchreiben(id, toStatus);
  out({ ok: true, id, status: toStatus });
}

const LABEL_AKTIONEN = ["add", "remove"];

// Abbruch mit Hilfe: dieselbe Form wie die Dispatcher-Zweige fuer unbekannte Befehle.
function labelFail(msg) {
  process.stdout.write(HELP);
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
async function issueLabel(tracker, config, args) {
  const [aktion, id, name, ...zuviel] = args._;
  if (!LABEL_AKTIONEN.includes(aktion)) {
    labelFail(`Unbekannter label-Befehl: '${aktion ?? ""}'. Erwartet: ${LABEL_AKTIONEN.join(" | ")}`);
  }
  if (!id) labelFail("id ist erforderlich: board.mjs issue label add <id> <name>");
  if (!name) labelFail("name ist erforderlich: board.mjs issue label add <id> <name>");
  if (zuviel.length > 0) {
    labelFail(`Zu viele Argumente: '${zuviel.join(" ")}'. Erwartet genau <id> und <name>.`);
  }
  if (/[,\n]/.test(name)) {
    labelFail(`Labelname darf kein Komma und keinen Zeilenumbruch enthalten: '${name}'`);
  }

  // Spaltennamen sind bei GitLab selbst Labels — ohne diese Sperre koennte das
  // generische Label-Kommando `issue move` umgehen und den Boardzustand
  // beschaedigen. Die Sperre gilt bei allen Trackern: Ein Kommando, das je nach
  // Projekt einmal den Status aendert und einmal nicht, ist die schlechtere Wahl.
  // Verglichen wird exakt — nur der wortgleiche Name ist das Statuslabel.
  if (Object.values(columnLabels(config)).includes(name)) {
    fail(`Status-Label \`${name}\` nur ueber \`issue move\` aendern`);
  }

  await tracker.labelIssue(id, name, aktion);
  out({ ok: true, id, label: name, aktion });
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
 */
export function leseTextQuelle(direkt, dateiPfad, flagName) {
  const dateiFlag = `--${flagName}-file`;
  const hatDatei = typeof dateiPfad === "string" && dateiPfad !== "";
  const hatDirekt = typeof direkt === "string";

  // Beide angegeben: Fehler statt Vorrangregel. Wer beides setzt, meint etwas
  // anderes als das, was eine stille Vorrangregel taete.
  if (hatDirekt && hatDatei) fail(`--${flagName} und ${dateiFlag} schliessen sich aus — nur eine Quelle angeben.`);
  if (dateiPfad === true) fail(`${dateiFlag} braucht einen Pfad.`);
  if (direkt === true) fail(`--${flagName} braucht einen Wert (oder '-' fuer stdin).`);

  let text;
  if (hatDatei) {
    if (!existsSync(dateiPfad)) fail(`${dateiFlag}: Datei nicht gefunden: ${dateiPfad}`);
    try {
      text = readFileSync(dateiPfad, "utf-8");
    } catch (e) {
      fail(`${dateiFlag}: ${dateiPfad} ist nicht lesbar (${e.code || e.message}).`);
    }
  } else if (direkt === "-") {
    try {
      text = readFileSync(0, "utf-8"); // fd 0 = stdin
    } catch (e) {
      fail(`--${flagName} -: stdin ist nicht lesbar (${e.code || e.message}).`);
    }
  } else {
    text = direkt;
  }

  if (typeof text !== "string" || text.trim() === "") {
    fail(`--${flagName} ist erforderlich und darf nicht leer sein (Argument, ${dateiFlag} oder '-' fuer stdin).`);
  }
  return text;
}

async function issueComment(tracker, args) {
  const id = args._[0];
  if (!id) fail("id ist erforderlich: board.mjs issue comment <id> --text \"...\"");
  await tracker.commentIssue(id, leseTextQuelle(args.text, args["text-file"], "text"));
  out({ ok: true, id });
}

// Schreibt den Body eines bestehenden Issues (Issue #237). Bewusst nur --body:
// Titel und Labels aendert kein Skill, und ein Kommando, das alles kann, laedt dazu
// ein, mehr zu aendern als beabsichtigt.
//
// Ein leerer Body ist ein harter Fehler statt eines stillen No-ops — ein
// versehentlich geleerter Issue-Body ist nicht wiederherstellbar.
async function issueUpdate(tracker, args) {
  const id = args._[0];
  if (!id) fail("id ist erforderlich: board.mjs issue update <id> --body \"...\"");
  const neu = leseTextQuelle(args.body, args["body-file"], "body");
  // Seit Plan #638 (A15) ohne Pruefvorgabe-Leitplanke: Der Body wird geschrieben, wie
  // er kommt.
  await tracker.updateIssue(id, { body: neu });
  out({ ok: true, id });
}

// ============================================================
// Formpruefung: issue check-form (Issue #628)
// ============================================================

const CHECK_FORM_WEGE =
  "check-form nimmt genau einen Eingabeweg: eine Kartennummer <id> ODER "
  + "--body-file <pfad> zusammen mit --title \"<titel>\"";

/** Die Pflichtabschnitte je Stufe, normalisiert (klein, transliteriert). */
const CHECK_FORM_ABSCHNITTE = {
  fachlich: ["ziel", "fachliche akzeptanzkriterien", "nicht-ziele", "offene fragen an den po"],
  plan: ["ziel", "betroffene bereiche", "architektonische entscheidungen", "geplante aenderungen", "offene fragen", "verifizierung"],
  issue: ["kontext", "aufgabe", "akzeptanzkriterium", "abhaengigkeiten"],
};

/** Ueberschriften vergleichbar machen: Umlaute zaehlen in beiden Schreibweisen. */
function normUeberschrift(text) {
  return String(text).trim().toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replaceAll(/\s+/g, " ");
}

/**
 * Zerlegt den Body ohne Codebloecke in Kopf und `##`-Abschnitte.
 *
 * Dieselbe Fence-Auslegung wie ueberall im Adapter (`fenceLauf`): Eine
 * Ueberschrift im Codeblock existiert fuer die Pruefung nicht — weder als
 * Treffer noch als Verstoss. `###` ist keine Abschnittsgrenze.
 */
function zerlegeAbschnitte(body) {
  const imFence = fenceLauf();
  const kopf = [];
  const abschnitte = [];
  let aktuell = null;
  for (const zeile of normalisiereZeilenenden(body).split("\n")) {
    if (imFence(zeile)) continue;
    const m = zeile.match(/^##[ \t]+(.+?)[ \t]*$/);
    if (m) {
      aktuell = { titel: normUeberschrift(m[1]), zeilen: [] };
      abschnitte.push(aktuell);
      continue;
    }
    (aktuell ? aktuell.zeilen : kopf).push(zeile);
  }
  return { kopf, abschnitte };
}

function ersteNichtLeere(zeilen) {
  return zeilen.map((z) => z.trim()).find((z) => z !== "") ?? null;
}

function istLeer(zeilen) {
  return ersteNichtLeere(zeilen) === null;
}

/** `Autor-Modell: <wert>` (bzw. eine andere Kennzeichnungszeile) mit nicht leerem Wert. */
function hatKennzeichnung(zeilen, name) {
  const muster = new RegExp(`^${name}:[ \\t]*(\\S.*)?$`);
  return zeilen.some((z) => {
    const m = z.trim().match(muster);
    return Boolean(m && m[1] && m[1].trim() !== "");
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

function pruefeIssue(abschnitte) {
  const finde = (name) => abschnitte.find((a) => a.titel === name);
  const verstoesse = [...pruefeReihenfolge(abschnitte, CHECK_FORM_ABSCHNITTE.issue), ...pruefeI1Lage(abschnitte)]
    .map((meldung) => ({ gate: "I1", meldung }));
  const kontext = finde("kontext");
  if (!kontext || !hatKennzeichnung(kontext.zeilen, "Autor-Modell")) {
    verstoesse.push({ gate: "I2", meldung: "'Autor-Modell:' steht nicht mit Wert im Abschnitt '## Kontext'" });
  }
  verstoesse.push(...pruefeVorlage(kontext, finde("akzeptanzkriterium")));
  const abh = finde("abhaengigkeiten");
  return abh ? [...verstoesse, ...pruefeAbhaengigkeiten(abh.zeilen)] : verstoesse;
}

/**
 * Prueft ein Dokument gegen die maschinellen Formgates seiner Stufe (Issue #628).
 *
 * fachlich: F1 F2 F6 F7 F9 F11 aus CLAUDE-Fachplan.md. plan: P1 P2 P3 P6 P12 aus
 * CLAUDE-Plan.md (P4 braucht eine zweite Karte und bleibt Sache des Reviewers).
 * Arbeitspaket: I1 bis I5 — Abschnitte, Autor-Modell, Abhaengigkeiten als `#N`
 * oder `Keine.`, keine Herkunftszeile im Abhaengigkeiten-Abschnitt, bei verbindlicher
 * Vorlage ein Bildschirmfoto im Akzeptanzkriterium. Die
 * `[Urteil]`-Gates bleiben beim Reviewer.
 */
export function pruefeForm(body, title) {
  const stufe = stufeAusTitel(title);
  const { kopf, abschnitte } = zerlegeAbschnitte(body);
  const alleZeilen = [...kopf, ...abschnitte.flatMap((a) => a.zeilen)];
  let verstoesse;
  if (stufe === "fachlich") verstoesse = pruefeFachlich(abschnitte, alleZeilen);
  else if (stufe === "plan") verstoesse = pruefePlan(kopf, abschnitte, alleZeilen);
  else verstoesse = pruefeIssue(abschnitte);
  return { ok: verstoesse.length === 0, stufe, verstoesse };
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

async function issueCheckForm(tracker, args) {
  const id = args._[0];
  const hatDatei = args["body-file"] !== undefined;
  if (id !== undefined && hatDatei) checkFormAbweisen(`Kartennummer und --body-file zugleich uebergeben. ${CHECK_FORM_WEGE}.`);
  if (id === undefined && !hatDatei) checkFormAbweisen(`Keine Eingabe uebergeben. ${CHECK_FORM_WEGE}.`);

  const { body, title } = hatDatei ? checkFormAusDatei(args["body-file"], args.title) : await checkFormVomBoard(tracker, id);
  const ergebnis = pruefeForm(body, title);
  out(ergebnis);
  if (!ergebnis.ok) process.exit(1);
}

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
    case "label":   return issueLabel(tracker, config, args);
    case "check-form": return issueCheckForm(tracker, args);
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

// Windows-Default aus der Doku von cmd.exe, falls PATHEXT nicht gesetzt ist.
const PATHEXT_DEFAULT = ".COM;.EXE;.BAT;.CMD";

/**
 * Sucht ein Kommando im PATH und liefert den gefundenen Pfad oder null (Issue #231).
 *
 * Bewusst eine Dateisystem-Pruefung statt eines Prozessstarts. Der Vorflug will wissen,
 * ob das Werkzeug DA ist — dafuer braucht es keinen Prozess. Der fruehere Weg (`datei
 * --version` starten) lieferte unter Windows falsch negative Ergebnisse: Ein per npm
 * installiertes CLI liegt dort als `codex.cmd`, und fuer `.cmd` wirft Node seit
 * CVE-2024-27980 `EINVAL` ohne `shell: true` — das aber hat board.mjs in Issue #196
 * bewusst abgeschafft. Getroffen haette es ausgerechnet die fremden Modelle, fuer die
 * der `command`-Adapter gebaut wurde.
 *
 * Nebenbei: kein Startaufwand, keine Annahme darueber, dass ein CLI `--version` kennt,
 * und kein Risiko, dass ein Probeaufruf Nebenwirkungen hat.
 *
 * Plattform und Dateisystem sind injizierbar, damit die Windows-Semantik ohne Windows
 * pruefbar ist — reine Funktion in der Linie von `normalizeRepoName` und `pickReviewers`.
 */
export function findeImPath(datei, opts = {}) {
  const istWindows = (opts.platform || process.platform) === "win32";
  const existiert = opts.existiert || existsSync;
  const ausfuehrbar = opts.ausfuehrbar || ((p) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false; // vorhanden, aber nicht ausfuehrbar — kein Kommando
    }
  });

  // Unter Windows entscheidet die Endung, ob etwas startbar ist. Traegt der Name schon
  // eine, gilt nur sie ('codex.exe' darf nicht zu 'codex.exe.CMD' werden).
  const kandidaten = (name) => {
    if (!istWindows) return [name];
    if (extname(name)) return [name];
    return (opts.pathext ?? PATHEXT_DEFAULT).split(";").filter(Boolean).map((e) => name + e);
  };

  // Das X-Bit gibt es nur unter POSIX; unter Windows waere die Pruefung bedeutungslos.
  const passt = (p) => existiert(p) && (istWindows || ausfuehrbar(p));

  // Wer einen Pfad angibt, meint diesen Pfad — keine PATH-Suche, auch nicht als Fallback.
  if ((istWindows ? /[\\/]/ : /\//).test(datei)) {
    return kandidaten(datei).find(passt) || null;
  }

  for (const dir of (opts.path ?? "").split(istWindows ? ";" : ":").filter(Boolean)) {
    for (const kandidat of kandidaten(datei)) {
      // Nicht join(): Das ist immer die Variante des LAUFENDEN Hosts, waehrend hier die
      // Semantik der uebergebenen `platform` gilt. Beide Richtungen gehen sonst schief —
      // win32-Faelle auf einem POSIX-Host bekamen '/' statt '\', POSIX-Faelle auf einem
      // Windows-Host '\' statt '/'. Der zweite Fall hat den Windows-Job gekippt, nachdem
      // der erste bereits bedacht war.
      const voll = istWindows ? `${dir}\\${kandidat}` : `${dir}/${kandidat}`;
      if (passt(voll)) return voll;
    }
  }
  return null;
}

// Verfuegbarkeit eines Kommandos: Das erste Wort muss als startbare Datei auffindbar
// sein. `command -v` waere kuerzer, gibt es unter cmd.exe aber nicht (Issue #196).
// Liefert zusaetzlich den aufgeloesten Pfad — der Probelauf unten startet damit, statt
// noch einmal zu suchen (unter Windows steckt in `pfad` die Endung aus PATHEXT).
function kommandoVerfuegbar(kommandozeile) {
  const datei = kommandozeile.trim().split(/\s+/)[0];
  const pfad = findeImPath(datei, { path: process.env.PATH, pathext: process.env.PATHEXT });
  return { datei, ok: pfad !== null, pfad };
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
 */
function probelauf(kommandozeile, pfad) {
  const argumente = kommandozeile.trim().split(/\s+/).slice(1);
  const res = spawnSync(pfad, argumente, {
    input: PROBE_PROMPT,
    encoding: "utf-8",
    timeout: PROBE_TIMEOUT_MS,
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
    const letzte = (res.stderr || "").trim().split("\n").findLast(Boolean);
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
    const { datei, ok, pfad } = kommandoVerfuegbar(r.command);
    if (!ok) return { ...basis, verfuegbar: false, geprueft: "pfad", grund: `${datei} nicht im PATH` };
    if (nurPfad) return { ...basis, verfuegbar: true, geprueft: "pfad" };
    const probe = probelauf(r.command, pfad);
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
  angehalten: ["RED", "AWAITING_DECISION"],
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
  const stages = NACHTLAUF_STUFEN.filter((stage) => stufen[stage]).map((stage) => ({
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
const NACHTLAUF_BUDGET_FELDER = ["planMin", "reviewMin", "paketeMin", "abdeckungMin", "kostenUsd"];

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
    .filter((feld) => NACHTLAUF_BUDGET_FELDER.includes(feld));
  budget.origin = defaultFields.length ? "DEFAULTED" : "CONFIGURED";
  if (defaultFields.length) budget.defaultFields = defaultFields;
  return budget;
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
  return {
    startedAt: stand.start,
    kind: NACHTLAUF_ART,
    mode,
    durationMs: Math.max(0, jetzt.getTime() - new Date(stand.start).getTime()),
    processedCount: items.length - grau,
    skippedCount: grau,
    unparsedCount: 0,
    complete: stand.complete === true,
    usage: nachtlaufUsage(stand.verbrauch),
    items,
    // Nur bei einem Lauf ohne Arbeit gesetzt (Issue #744) — die Gegenstelle setzt den
    // gruenen Ersatztext sonst nur bei null Arbeitspaketen; ihn immer mitzuschicken
    // liesse zwei Stellen ueber dieselbe Frage entscheiden.
    ...(noWorkReason !== null ? { noWorkReason } : {}),
    // Nur, wo der Stand ein Budget fuehrt (Issue #808) — heute allein die Kette.
    ...(budget !== null ? { budget } : {}),
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
  switch (command) {
    case "melden": return nightrunMelden(args);
    default:
      process.stdout.write(HELP);
      fail(`Unbekannter nightrun-Befehl: '${command}'`);
  }
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
    return stand?.sitzung === start ? Date.parse(stand.zuletzt) : NaN;
  } catch {
    return NaN;
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
  switch (command) {
    case "melden": return sitzungMelden(args);
    default:
      process.stdout.write(HELP);
      fail(`Unbekannter sitzung-Befehl: '${command}'`);
  }
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

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }

  // Vor jedem Config-Zugriff: --version muss auch in einem Projekt ohne
  // .claude/workflow.config.json antworten — genau dort fragt man danach.
  if (argv[0] === "--version") {
    process.stdout.write(`board.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
    process.exit(0);
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
  } else {
    process.stdout.write(HELP);
    fail(`Unbekannte Achse: '${axis}'. Erwartet: issue | code | kontext | issue-review | nightrun | sitzung`);
  }
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
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
