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
 *   node board.mjs issue create --title "..." --body "..."
 *   node board.mjs issue get <id>
 *   node board.mjs issue list [--status <status>]
 *   node board.mjs issue move <id> <status>
 *   node board.mjs issue update <id> --body "..."
 *   node board.mjs issue comment <id> --text "..."
 *   node board.mjs code repo-name
 *   node board.mjs code pr --from <branch> --to <branch>
 *   node board.mjs kontext paths [--project <name>] [--date JJJJ-MM-TT]
  node board.mjs kontext last-log [--project <name>] [--before JJJJ-MM-TT]
  node board.mjs issue-review reviewers --author <modell>
  node board.mjs issue-review check
  node board.mjs issue-review matrix
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, realpathSync, accessSync, constants } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "1.32.1";

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
  node board.mjs issue create --title "..." --body "..."
  node board.mjs issue get <id>
  node board.mjs issue list [--status <status>]
  node board.mjs issue move <id> <status>
  node board.mjs issue update <id> --body "..."
  node board.mjs issue comment <id> --text "..."
  node board.mjs code repo-name
  node board.mjs code pr --from <branch> --to <branch>
  node board.mjs kontext paths [--project <name>] [--date JJJJ-MM-TT]
  node board.mjs kontext last-log [--project <name>] [--before JJJJ-MM-TT]
  node board.mjs issue-review reviewers --author <modell>
  node board.mjs issue-review check
  node board.mjs issue-review matrix

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
// SYNC: dieselbe Liste und Logik steckt in kit/night.mjs — Aenderungen dort nachziehen.
const LOCAL_OVERRIDE_ALLOWLIST = ["reviewModel", "reviewScope", "triggers", "toolbox.tokenFile"];

/**
 * Mergt die persoenliche Config in die geteilte, aber nur an den erlaubten Pfaden.
 * Liefert `{ config, ignored }` — `ignored` nennt jedes verworfene Feld beim Namen,
 * damit der Aufrufer es melden kann statt still das Falsche zu tun.
 */
export function mergeWorkflowConfig(shared, local) {
  const config = { ...(shared || {}) };
  const ignored = [];
  if (!local) return { config, ignored };

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
function readWorkflowConfig() {
  const candidates = [
    resolve(".claude", "workflow.config.json"),
    join(configRoot(), ".claude", "workflow.config.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
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
      } catch {
        fail(`workflow.config.json konnte nicht gelesen werden: ${p}`);
      }
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
    const data = execJSON("gh", ["issue", "view", String(id), "--repo", repo, "--json", "number,title,body,state,comments"]);
    return {
      id: String(data.number),
      title: data.title,
      body: data.body,
      status: null, // Board-Status nicht im Issue-Objekt, erfordert Project-Abfrage
      comments: normalizeComments(data.comments),
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
}

function githubStatusName(status, config) {
  return columnLabels(config)[status] || status;
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
    const labelNames = (data.labels || []).map((l) => l.name || l);
    const status = labelToStatus(labelNames, this._cfg, data.state) || null;
    return {
      id: String(data.iid || data.id),
      title: data.title,
      body: data.description,
      status,
      comments: this._notes(id),
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

  async listIssues(status) {
    const args = ["issue", "list", "--output", "json"];
    if (status) {
      // Board-Reihenfolge statt numerisch: relative_position ist GitLabs Feld fuer die
      // manuelle Board-Sortierung (oben zuerst, #128). Nur im Status-Filter-Pfad.
      args.push("--order", "relative_position", "--sort", "asc");
      if (isStateColumn(status, this._cfg)) {
        if (status === "done") {
          args.push("--closed");
        } else {
          // backlog als Open-Zustand: offene Issues ohne die anderen Status-Labels.
          const otherLabels = Object.entries(columnLabels(this._cfg))
            .filter(([s]) => s !== "backlog" && !isStateColumn(s, this._cfg))
            .map(([, l]) => l);
          for (const l of otherLabels) args.push("--not-label", l);
        }
      } else {
        const label = columnLabels(this._cfg)[status];
        if (!label) throw new BoardError(`Status '${status}' hat kein GitLab-Label-Mapping`);
        args.push("--label", label);
      }
    }
    const items = execJSON("glab", args);
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
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: match[2] };
}

function serializeFrontmatter(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
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
    return { id: meta.id || padId(id), type: meta.type || "task", parent: meta.parent || "", title: meta.title || "", status: meta.status || "backlog", created: meta.created || "", body };
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
    const content = serializeFrontmatter(
      meta,
      body || "\n## Kontext\n\n## Aufgabe\n\n## Akzeptanzkriterium\n\n## Abhaengigkeiten\n"
    );
    writeFileSync(this._filePath(n), content, "utf-8");
    return { id, path: this._filePath(n) };
  }

  async getIssue(id) {
    return this._read(id);
  }

  async listIssues(status) {
    return this._allFiles()
      .map((f) => {
        const raw = readFileSync(join(this._dir(), f), "utf-8");
        const { meta, body } = parseFrontmatter(raw);
        // Labels als kommaseparierter Frontmatter-String (parseFrontmatter kann kein
        // YAML-Array) -> Namen-Array, analog zu den anderen Trackern (Issue #158/#159).
        const labels = typeof meta.labels === "string" && meta.labels.trim()
          ? meta.labels.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        return { id: meta.id || basename(f, ".md"), type: meta.type || "task", parent: meta.parent || "", color: meta.color || "", shortcode: meta.shortcode || "", title: meta.title || "", status: meta.status || "backlog", labels, body };
      })
      // Epics nehmen nicht am Spalten-Workflow teil (E5): bei Status-Filterung
      // (z.B. --status ready für implement-ready) tauchen sie nie auf.
      .filter((i) => !status || (i.type !== "epic" && i.status === status));
  }

  async listEpics() {
    const all = await this.listIssues();
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
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
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

  async createIssue({ title, body }) {
    const { host } = this._auth();
    // Ideen-Speicher (kanban-kit #245): neu angelegte Issues landen als Idee im Sammelbecken
    // statt direkt im Backlog. Per Config abschaltbar (toolbox.ideaStored: false). Aeltere
    // Backends ohne #245 ignorieren das Feld und legen wie bisher im Backlog an.
    const ideaStored = this._cfg.toolbox?.ideaStored !== false;
    const res = await this._fetch("/api/kanban/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: body || "", column: "BACKLOG", ideaStored }),
    });
    const created = await res.json();
    const result = interpretToolboxCreateResponse(created);
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
    return {
      id: String(item.number),
      title: item.title,
      body: item.body,
      status: item.status,
      comments: await this._comments(item.id),
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

  // Ohne eigene Status-Validierung: issueList() im Dispatch prueft den Wert gegen
  // VALID_STATUSES, bevor irgendein Tracker ihn sieht — die Pruefung hier war
  // unerreichbar (entfernt in Issue #188) und als einzige der vier Tracker doppelt.
  async listIssues(status) {
    const items = await this._boardItems();
    const filtered = items
      // Epics nehmen nicht am Spalten-Workflow teil: bei Status-Filter ausschliessen.
      .filter((i) => !status || (i.type !== "epic" && i.status === status));
    // Mit Status-Filter liegen alle Items in derselben Spalte: die API-Reihenfolge
    // (positionInColumn) ist die Board-/Listen-Reihenfolge und bleibt erhalten (#128);
    // ungefiltert bleibt die stabile numerische Sortierung.
    if (!status) filtered.sort((a, b) => a.number - b.number);
    // labels erst echt gefuellt, sobald kanbancompat sie exponiert (mannewolff/kanban-kit#457);
    // bis dahin liefert die Karten-API kein labels-Feld -> [] (rueckwaertskompatibel).
    return filtered.map((i) => ({ id: String(i.number), title: i.title, body: i.body, status: i.status, labels: labelNamesFrom(i.labels) }));
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
}

// ============================================================
// Hilfsfunktionen
// ============================================================

// Normalisiert die roh vom Backend gelieferten Labels auf ein flaches Array von
// Namen: GitLab liefert Objekte ({name}), andere Backends evtl. nackte Strings,
// oder das Feld fehlt ganz. Fehlform oder fehlendes Feld -> []. Von GitLab- und
// Toolbox-listIssues geteilt, damit Aufrufer (z. B. night.mjs Routing-Label,
// Issue #159) verlaesslich ein Array bekommen (Issue #158).
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

const KNOWN_CODE_HOSTS = ["github", "gitlab", "local"];

/**
 * Feldweiser Merge der beiden kontext.config.json, lokale Felder gewinnen. Fehlende
 * Datei = leeres Objekt, kein Fehler.
 *
 * Bewusst Merge und nicht "erstes gefundenes gewinnt": Der Multi-Repo-Fall braucht eine
 * lokale Config, die nur `project`/`parentProject` setzt und `vault` von global erbt —
 * bei "erstes gewinnt" waere der Vault-Pfad verloren.
 */
export function mergeKontextConfig(globalCfg, localCfg) {
  return { ...(globalCfg || {}), ...(localCfg || {}) };
}

/**
 * Berechnet die Zielpfade im Vault. Reine Funktion ohne Dateisystem-Zugriff — Projektname
 * und Datum kommen von aussen (das --date-Flag ist die Testbarkeits-Naht, ohne es waere
 * jeder Erwartungswert datumsabhaengig).
 *
 * Ohne `vault` ist das Ergebnis mode "degraded" statt eines Fehlers: /kontext und
 * /document haben dafuer einen dokumentierten Modus ohne persistentes Memory.
 */
export function resolveKontextPaths({ cfg = {}, project, date }) {
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
    projectNote: join(vault, "Projekte", notizOrdner, `${projectName}.md`),
    parentNote: parentProject ? join(vault, "Projekte", parentProject, `${parentProject}.md`) : null,
    always: (cfg.always || []).map((datei) => join(vault, datei)),
    projectDocs,
  };
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
      if (teil === "{date}") return "(\\d{4}-\\d{2}-\\d{2})";
      const literal = teil === "{project}" ? project : teil;
      return literal.replace(REGEX_SONDERZEICHEN, "\\$&");
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
  if (!config || !KNOWN_CODE_HOSTS.includes(config.codeHost)) return basename(resolve("."));
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
async function issueCreate(tracker, args) {
  if (!args.title) fail("--title ist erforderlich");
  out(await tracker.createIssue({
    title: args.title,
    body: args.body || "",
    type: args.type,
    parent: args.parent,
    color: args.color,
    shortcode: args.shortcode,
  }));
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
    fail("epics wird nur im lokalen Modus unterstuetzt (issueTracker: local)");
  }
  out(await tracker.listEpics());
}

async function issueMove(tracker, args) {
  const [id, toStatus] = args._;
  if (!id) fail("id ist erforderlich: board.mjs issue move <id> <status>");
  if (!toStatus) fail("status ist erforderlich: board.mjs issue move <id> <status>");
  if (!VALID_STATUSES.includes(toStatus)) {
    fail(`Ungueltiger Status '${toStatus}'. Gueltig: ${VALID_STATUSES.join(", ")}`);
  }
  await tracker.moveIssue(id, toStatus);
  out({ ok: true, id, status: toStatus });
}

async function issueComment(tracker, args) {
  const id = args._[0];
  if (!id) fail("id ist erforderlich: board.mjs issue comment <id> --text \"...\"");
  if (!args.text) fail("--text ist erforderlich");
  await tracker.commentIssue(id, args.text);
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
  if (typeof args.body !== "string" || args.body.trim() === "") {
    fail("--body ist erforderlich und darf nicht leer sein: board.mjs issue update <id> --body \"...\"");
  }
  await tracker.updateIssue(id, { body: args.body });
  out({ ok: true, id });
}

async function dispatchIssue(command, args) {
  const tracker = resolveTracker(loadConfig());
  switch (command) {
    case "create":  return issueCreate(tracker, args);
    case "get":     return issueGet(tracker, args);
    case "list":    return issueList(tracker, args);
    case "epics":   return issueEpics(tracker);
    case "move":    return issueMove(tracker, args);
    case "update":  return issueUpdate(tracker, args);
    case "comment": return issueComment(tracker, args);
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

async function dispatchCode(command, args) {
  const host = resolveCodeHost(loadConfig());
  switch (command) {
    case "repo-name": return codeRepoName(host);
    case "pr":        return codePr(host, args);
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

// Praezedenz des Projektnamens: --project > cfg.project > Repo-Name > basename(cwd).
async function kontextPaths(args) {
  const cfg = loadKontextConfig();
  const project = kontextOption(args, "project") || cfg.project || await kontextRepoName();
  out(resolveKontextPaths({ cfg, project, date: kontextOption(args, "date") || heute() }));
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

const ISSUE_REVIEW_DEFAULT_ROUNDS = 1;
const REVIEWER_KINDS = ["claude", "command"];

/**
 * Waehlt die Reviewer fuer ein Issue: die ersten `anzahl` Eintraege, deren Name nicht
 * der Autor ist. Reine Funktion — die Reihenfolge der Config ist die Steuerung, wer
 * eine feste Paarung will, sortiert entsprechend.
 *
 * `unterbesetzt` statt eines Fehlers, wenn zu wenige uebrig bleiben: Der Skill
 * entscheidet, ob er mit einem Reviewer faehrt — er muss es nur sichtbar machen.
 */
export function pickReviewers(alle, autor, anzahl = 2, pairs = {}) {
  // Explizite Zuordnung schlaegt die Regel (Issue #225). Ohne sie waehlt die Regel
  // immer die vordersten Eintraege — bei vier Reviewern kam der vierte nie zum Zug,
  // ausgerechnet das Modell aus dem fremden Haus. Und wer wissen will, wer sein Issue
  // prueft, soll es ablesen koennen statt es auszurechnen.
  const genannt = pairs?.[autor];
  if (Array.isArray(genannt) && genannt.length > 0) {
    const gewaehlt = genannt.map((n) => (alle || []).find((r) => r.name === n)).filter(Boolean);
    return { gewaehlt, unterbesetzt: gewaehlt.length < anzahl, quelle: "pairs" };
  }
  const passend = (alle || []).filter((r) => r.name !== autor);
  const gewaehlt = passend.slice(0, anzahl);
  return { gewaehlt, unterbesetzt: gewaehlt.length < anzahl, quelle: "regel" };
}

// Beide Faelle sind harte Fehler, aus derselben Begruendung wie validateReviewers:
// Ein stiller Skip verwandelt einen Tippfehler in einen unsichtbaren Ein-Reviewer-Lauf.
// Und ein Autor, der sich selbst nennt, hebelt den Zweck des Verfahrens aus — das
// gehoert beim Schreiben der Config bemerkt, nicht beim Lesen des Review-Berichts.
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

function issueReviewConfig() {
  const block = loadConfig().issueReview || {};
  const reviewers = validateReviewers(Array.isArray(block.reviewers) ? block.reviewers : []);
  return {
    rounds: block.rounds || ISSUE_REVIEW_DEFAULT_ROUNDS,
    reviewers,
    pairs: validatePairs(block.pairs, reviewers),
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
function kommandoVerfuegbar(kommandozeile) {
  const datei = kommandozeile.trim().split(/\s+/)[0];
  return { datei, ok: findeImPath(datei, { path: process.env.PATH, pathext: process.env.PATHEXT }) !== null };
}

function issueReviewReviewers(args) {
  const autor = args.author === true ? fail("--author braucht einen Wert") : args.author;
  const { rounds, reviewers, pairs } = issueReviewConfig();
  out({ autor: autor || null, ...pickReviewers(reviewers, autor, 2, pairs), rounds });
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
      return { autor, reviewer: gewaehlt.map((r) => r.name), quelle };
    }),
  });
}

// Auskunft, kein Gate: Exit bleibt 0, auch wenn ein Reviewer fehlt. Wer daraus ein
// Gate macht, ist der Skill — er kann den Menschen fragen, dieses Kommando nicht.
function issueReviewCheck() {
  const { reviewers } = issueReviewConfig();
  const ergebnis = reviewers.map((r) => {
    if (r.kind === "claude") return { name: r.name, kind: r.kind, verfuegbar: true };
    const { datei, ok } = kommandoVerfuegbar(r.command);
    return ok
      ? { name: r.name, kind: r.kind, verfuegbar: true }
      : { name: r.name, kind: r.kind, verfuegbar: false, grund: `${datei} nicht im PATH` };
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

async function dispatchIssueReview(command, args) {
  switch (command) {
    case "reviewers": return issueReviewReviewers(args);
    case "check": return issueReviewCheck();
    case "matrix": return issueReviewMatrix();
    default:
      process.stdout.write(HELP);
      fail(`Unbekannter issue-review-Befehl: '${command}'`);
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
  } else {
    process.stdout.write(HELP);
    fail(`Unbekannte Achse: '${axis}'. Erwartet: issue | code | kontext | issue-review`);
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
