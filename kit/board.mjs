#!/usr/bin/env node
/**
 * board.mjs — Provider-agnostischer Einstiegspunkt fuer alle Board-Operationen.
 * Liest .claude/workflow.config.json, waehlt anhand issueTracker/codeHost den Adapter
 * und fuehrt die angeforderte Operation aus.
 *
 * Ausgabe: JSON auf stdout. Fehler: Meldung auf stderr, Exit-Code 1.
 *
 * Nutzung:
 *   node board.mjs issue create --title "..." --body "..."
 *   node board.mjs issue get <id>
 *   node board.mjs issue list [--status <status>]
 *   node board.mjs issue move <id> <status>
 *   node board.mjs issue comment <id> --text "..."
 *   node board.mjs code repo-name
 *   node board.mjs code pr --from <branch> --to <branch>
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_STATUSES = ["backlog", "ready", "in_progress", "in_review", "done"];

const COLUMN_DEFAULTS = {
  backlog:     "Backlog",
  ready:       "Ready",
  in_progress: "In Progress",
  in_review:   "In Review",
  done:        "Done",
};

function columnLabels(config) {
  return config.columns || COLUMN_DEFAULTS;
}

const HELP = `board.mjs — Board-Adapter fuer das claude-workflow-kit

Nutzung:
  node board.mjs issue create --title "..." --body "..."
  node board.mjs issue get <id>
  node board.mjs issue list [--status <status>]
  node board.mjs issue move <id> <status>
  node board.mjs issue comment <id> --text "..."
  node board.mjs code repo-name
  node board.mjs code pr --from <branch> --to <branch>

Gueltige Status-Werte: ${VALID_STATUSES.join(" | ")}

Konfiguration: .claude/workflow.config.json (issueTracker, codeHost)
Fuer GitHub-Board-Integration: github.projectNumber in der Config setzen.
`;

// --- Shell-Hilfsfunktionen ---

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    throw new Error(e.stderr?.toString().trim() || e.message);
  }
}

function execJSON(cmd) {
  return JSON.parse(exec(cmd));
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

function loadConfig() {
  const candidates = [
    resolve(".claude", "workflow.config.json"),
    join(__dirname, "..", ".claude", "workflow.config.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8"));
        // Rueckwaertskompatibilitaet: provider -> codeHost/issueTracker
        if (raw.provider && !raw.codeHost) raw.codeHost = raw.provider;
        if (raw.provider && !raw.issueTracker) raw.issueTracker = raw.provider;
        return raw;
      } catch {
        fail(`workflow.config.json konnte nicht gelesen werden: ${p}`);
      }
    }
  }
  fail(
    "Keine .claude/workflow.config.json gefunden. Bitte zuerst den Installer ausfuehren."
  );
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
  }

  _repo() {
    if (!this._repoName) {
      this._repoName = exec("gh repo view --json nameWithOwner -q .nameWithOwner");
    }
    return this._repoName;
  }

  _owner() {
    return this._repo().split("/")[0];
  }

  _projectNumber() {
    const n = this._cfg.github?.projectNumber;
    if (!n) throw new BoardError(
      "github.projectNumber fehlt in workflow.config.json. " +
      "Bitte erganzen: '\"github\": { \"projectNumber\": <N> }'"
    );
    return n;
  }

  _ensureProjectMeta() {
    if (this._projectId && this._statusField) return;

    const owner = this._owner();
    const num = this._projectNumber();

    // Project-ID
    const projectList = execJSON(`gh project list --owner ${owner} --format json`);
    const project = (projectList.projects || []).find((p) => p.number === num);
    if (!project) throw new BoardError(`GitHub Project #${num} nicht gefunden fuer Owner '${owner}'`);
    this._projectId = project.id;

    // Status-Field und Optionen
    const fields = execJSON(`gh project field-list ${num} --owner ${owner} --format json`);
    const statusField = (fields.fields || []).find((f) => f.name === "Status");
    if (!statusField) throw new BoardError(`Kein 'Status'-Feld in GitHub Project #${num} gefunden`);

    const optionMap = {};
    for (const opt of statusField.options || []) {
      // Normalisiere den Option-Namen auf den Status-Enum
      const labels = columnLabels(this._cfg);
      const key = Object.keys(labels).find(
        (k) => labels[k].toLowerCase() === opt.name.toLowerCase()
      );
      if (key) optionMap[key] = opt.id;
    }
    this._statusField = { id: statusField.id, options: optionMap };
  }

  _getProjectItemId(issueNumber) {
    const owner = this._owner();
    const num = this._projectNumber();
    const items = execJSON(`gh project item-list ${num} --owner ${owner} --format json --limit 1000`);
    const item = (items.items || []).find(
      (i) => i.content?.number === Number(issueNumber)
    );
    if (!item) throw new BoardError(`Issue #${issueNumber} nicht im Project Board #${num} gefunden`);
    return item.id;
  }

  async createIssue({ title, body }) {
    const repo = this._repo();
    const output = exec(
      `gh issue create --repo ${repo} --title ${shellQuote(title)} --body ${shellQuote(body || "")}`
    );
    // gh gibt ggf. Hinweiszeilen vor der URL aus — URL und ID per Regex extrahieren
    const match = output.match(/(https?:\/\/\S+\/issues\/(\d+))/);
    if (!match) throw new BoardError(`Konnte Issue-URL aus gh-Ausgabe nicht lesen: ${output}`);
    const url = match[1];
    const id = match[2];

    // Ans Project Board haengen, falls konfiguriert
    if (this._cfg.github?.projectNumber) {
      try {
        const owner = this._owner();
        const num = this._projectNumber();
        exec(`gh project item-add ${num} --owner ${owner} --url ${url}`);
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
    }
    return { id, url };
  }

  async getIssue(id) {
    const repo = this._repo();
    const data = execJSON(
      `gh issue view ${id} --repo ${repo} --json number,title,body,state`
    );
    return {
      id: String(data.number),
      title: data.title,
      body: data.body,
      status: null, // Board-Status nicht im Issue-Objekt, erfordert Project-Abfrage
    };
  }

  async listIssues(status) {
    const repo = this._repo();

    if (!status) {
      const items = execJSON(
        `gh issue list --repo ${repo} --state open --json number,title,body`
      );
      return items.map((i) => ({ id: String(i.number), title: i.title, body: i.body, status: null }));
    }

    // Filterung nach Board-Status via Project
    if (!this._cfg.github?.projectNumber) {
      process.stderr.write(
        "Hinweis: Ohne github.projectNumber kein Board-Status-Filter moeglich. Liste alle offenen Issues.\n"
      );
      return this.listIssues(undefined);
    }

    this._ensureProjectMeta();
    const owner = this._owner();
    const num = this._projectNumber();
    const items = execJSON(`gh project item-list ${num} --owner ${owner} --format json --limit 1000`);

    const optionId = this._statusField.options[status];
    if (!optionId) throw new BoardError(`Status '${status}' hat keine Entsprechung im GitHub Project`);

    return (items.items || [])
      .filter((i) => i.status === githubStatusName(status, this._cfg))
      .map((i) => ({
        id: String(i.content?.number),
        title: i.content?.title,
        body: null,
        status,
      }))
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  async moveIssue(id, to) {
    this._ensureProjectMeta();
    const itemId = this._getProjectItemId(id);
    const optionId = this._statusField.options[to];
    if (!optionId) throw new BoardError(`Status '${to}' hat keine Entsprechung im GitHub Project`);

    exec(
      `gh project item-edit --id ${itemId} --project-id ${this._projectId} ` +
      `--field-id ${this._statusField.id} --single-select-option-id ${optionId}`
    );
  }

  async commentIssue(id, text) {
    const repo = this._repo();
    exec(`gh issue comment ${id} --repo ${repo} --body ${shellQuote(text)}`);
  }
}

function githubStatusName(status, config) {
  return columnLabels(config)[status] || status;
}

class GitHubCodeHost {
  constructor(config) { this._cfg = config; }

  async getRepoName() {
    try {
      return exec("gh repo view --json nameWithOwner -q .nameWithOwner");
    } catch {
      return exec("git remote get-url origin 2>/dev/null || basename $(pwd)");
    }
  }

  supportsPullRequests() { return true; }

  async createPullRequest({ from, to, title }) {
    const t = title || `${from} → ${to}`;
    const url = exec(
      `gh pr create --base ${to} --head ${from} --title ${shellQuote(t)} --body ""`
    );
    return { url };
  }
}

// ============================================================
// GitLab-Adapter
// ============================================================

class GitLabIssueTracker {
  constructor(config) { this._cfg = config; }

  async createIssue({ title, body }) {
    const output = exec(
      `glab issue create --title ${shellQuote(title)} --description ${shellQuote(body || "")}`
    );
    // glab gibt die Issue-URL aus, z.B. https://gitlab.com/owner/repo/-/issues/42
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) throw new BoardError(`Konnte Issue-ID aus glab-Ausgabe nicht lesen: ${output}`);
    const id = match[1];
    // Label 'Backlog' setzen
    try {
      exec(`glab issue edit ${id} --label "Backlog"`);
    } catch (e) {
      process.stderr.write(`Hinweis: Backlog-Label konnte nicht gesetzt werden: ${e.message}\n`);
    }
    return { id, url: output.trim() };
  }

  async getIssue(id) {
    const data = execJSON(`glab issue view ${id} --output json`);
    const labelNames = (data.labels || []).map((l) => l.name || l);
    const status = labelToStatus(labelNames, this._cfg) || null;
    return {
      id: String(data.iid || data.id),
      title: data.title,
      body: data.description,
      status,
    };
  }

  async listIssues(status) {
    let cmd = "glab issue list --state opened --output json";
    if (status) {
      const label = columnLabels(this._cfg)[status];
      if (!label) throw new BoardError(`Status '${status}' hat kein GitLab-Label-Mapping`);
      cmd += ` --label ${shellQuote(label)}`;
    }
    const items = execJSON(cmd);
    return (Array.isArray(items) ? items : [])
      .map((i) => {
        const labelNames = (i.labels || []).map((l) => l.name || l);
        return {
          id: String(i.iid),
          title: i.title,
          body: i.description,
          status: labelToStatus(labelNames, this._cfg) || null,
        };
      })
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  async moveIssue(id, to) {
    const labels = columnLabels(this._cfg);
    const label = labels[to];
    if (!label) throw new BoardError(`Status '${to}' hat kein GitLab-Label-Mapping`);
    // Alle Status-Labels entfernen, Ziel-Label setzen
    const unlabelArgs = Object.values(labels)
      .map((l) => `--unlabel ${shellQuote(l)}`)
      .join(" ");
    exec(`glab issue edit ${id} ${unlabelArgs} --label ${shellQuote(label)}`);
  }

  async commentIssue(id, text) {
    exec(`glab issue note create ${id} --message ${shellQuote(text)}`);
  }
}

class GitLabCodeHost {
  async getRepoName() {
    try {
      const url = exec("git remote get-url origin");
      return url.replace(/\.git$/, "").split("/").slice(-2).join("/");
    } catch {
      return exec("basename $(pwd)");
    }
  }

  supportsPullRequests() { return true; }

  async createPullRequest({ from, to, title }) {
    const t = title || `${from} -> ${to}`;
    const url = exec(
      `glab mr create --source-branch ${from} --target-branch ${to} --title ${shellQuote(t)} --description "" --yes`
    );
    // glab gibt die MR-URL aus
    const match = url.match(/https?:\/\/\S+/);
    return { url: match ? match[0] : url.trim() };
  }
}

// ============================================================
// Local-Adapter
// ============================================================

// Minimaler YAML-Frontmatter-Parser fuer die Issue-Dateien (kein externes Modul)
// SYNC: bewusst dupliziert in kit/board.mjs UND kit/board-ui.mjs — beide Dateien
// sind eigenstaendig portable Single-File-Tools, ein gemeinsames Modul wuerde das
// brechen. Aenderungen immer in beiden Dateien identisch nachziehen.
// Bewusst minimal: nur flaches, einzeiliges YAML (reicht fuer das Issue-Format).
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
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
    return { id: meta.id || padId(id), title: meta.title || "", status: meta.status || "backlog", created: meta.created || "", body };
  }

  _nextId() {
    const files = this._allFiles();
    if (files.length === 0) return 1;
    const nums = files.map((f) => parseInt(f, 10)).filter((n) => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
  }

  async createIssue({ title, body }) {
    const dir = this._dir();
    mkdirSync(dir, { recursive: true });
    const n = this._nextId();
    const id = padId(n);
    const today = new Date().toISOString().slice(0, 10);
    const content = serializeFrontmatter(
      { id: `"${id}"`, status: "backlog", title, created: today },
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
        return { id: meta.id || basename(f, ".md"), title: meta.title || "", status: meta.status || "backlog", body };
      })
      .filter((i) => !status || i.status === status);
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
}

class LocalCodeHost {
  async getRepoName() {
    try {
      const url = exec("git remote get-url origin 2>/dev/null");
      return url.replace(/\.git$/, "").split("/").pop();
    } catch {
      return basename(resolve("."));
    }
  }

  supportsPullRequests() { return false; }

  async createPullRequest({ from, to }) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        message: `Lokaler Modus: kein Pull Request. Fuehre einen lokalen Merge durch:\n  git checkout ${to}\n  git merge ${from}\n  git push`
      }, null, 2) + "\n"
    );
    process.exit(0);
  }
}

// ============================================================
// Hilfsfunktionen
// ============================================================

function shellQuote(str) {
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

function labelToStatus(labelNames, config) {
  for (const [status, label] of Object.entries(columnLabels(config))) {
    if (labelNames.includes(label)) return status;
  }
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
    default: fail(`Unbekannter issueTracker: '${config.issueTracker}'. Erwartet: github | gitlab | local`);
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
// Dispatch
// ============================================================

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const [axis, command, ...rest] = argv;
  const args = parseArgs(rest);

  if (axis === "issue") {
    const config = loadConfig();
    const tracker = resolveTracker(config);

    switch (command) {
      case "create": {
        if (!args.title) fail("--title ist erforderlich");
        out(await tracker.createIssue({ title: args.title, body: args.body || "" }));
        break;
      }
      case "get": {
        const id = args._[0];
        if (!id) fail("id ist erforderlich: board.mjs issue get <id>");
        out(await tracker.getIssue(id));
        break;
      }
      case "list": {
        if (args.status && !VALID_STATUSES.includes(args.status)) {
          fail(`Ungueltiger Status '${args.status}'. Gueltig: ${VALID_STATUSES.join(", ")}`);
        }
        out(await tracker.listIssues(args.status));
        break;
      }
      case "move": {
        const [id, toStatus] = args._;
        if (!id) fail("id ist erforderlich: board.mjs issue move <id> <status>");
        if (!toStatus) fail("status ist erforderlich: board.mjs issue move <id> <status>");
        if (!VALID_STATUSES.includes(toStatus)) {
          fail(`Ungueltiger Status '${toStatus}'. Gueltig: ${VALID_STATUSES.join(", ")}`);
        }
        await tracker.moveIssue(id, toStatus);
        out({ ok: true, id, status: toStatus });
        break;
      }
      case "comment": {
        const id = args._[0];
        if (!id) fail("id ist erforderlich: board.mjs issue comment <id> --text \"...\"");
        if (!args.text) fail("--text ist erforderlich");
        await tracker.commentIssue(id, args.text);
        out({ ok: true, id });
        break;
      }
      default:
        process.stdout.write(HELP);
        fail(`Unbekannter issue-Befehl: '${command}'`);
    }

  } else if (axis === "code") {
    const config = loadConfig();
    const host = resolveCodeHost(config);

    switch (command) {
      case "repo-name":
        out({ repoName: await host.getRepoName() });
        break;
      case "pr": {
        if (!args.from) fail("--from ist erforderlich");
        if (!args.to) fail("--to ist erforderlich");
        if (!host.supportsPullRequests()) {
          fail("Dieser codeHost unterstuetzt keine Pull Requests. Nutze einen lokalen git-Merge.");
        }
        out(await host.createPullRequest({ from: args.from, to: args.to, title: args.title }));
        break;
      }
      default:
        process.stdout.write(HELP);
        fail(`Unbekannter code-Befehl: '${command}'`);
    }

  } else {
    process.stdout.write(HELP);
    fail(`Unbekannte Achse: '${axis}'. Erwartet: issue | code`);
  }
}

main().catch((err) => {
  const prefix = err instanceof BoardError ? "Fehler" : "Unerwarteter Fehler";
  process.stderr.write(`${prefix}: ${err.message}\n`);
  process.exit(1);
});
