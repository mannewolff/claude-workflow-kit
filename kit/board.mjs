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

import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_STATUSES = ["backlog", "ready", "in_progress", "in_review", "done"];

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
`;

// --- Fehlerbehandlung ---

function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

function out(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
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

// --- Argument-Parser (minimalistisch, kein externes Modul) ---

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

// --- Adapter-Stubs (werden in spaeteren Issues implementiert) ---

class GitHubIssueTracker {
  async createIssue(_input) { fail("github-Adapter noch nicht implementiert (Issue #30)"); }
  async getIssue(_id) { fail("github-Adapter noch nicht implementiert (Issue #30)"); }
  async listIssues(_status) { fail("github-Adapter noch nicht implementiert (Issue #30)"); }
  async moveIssue(_id, _to) { fail("github-Adapter noch nicht implementiert (Issue #30)"); }
  async commentIssue(_id, _text) { fail("github-Adapter noch nicht implementiert (Issue #30)"); }
}

class GitLabIssueTracker {
  async createIssue(_input) { fail("gitlab-Adapter noch nicht implementiert (Issue #30)"); }
  async getIssue(_id) { fail("gitlab-Adapter noch nicht implementiert (Issue #30)"); }
  async listIssues(_status) { fail("gitlab-Adapter noch nicht implementiert (Issue #30)"); }
  async moveIssue(_id, _to) { fail("gitlab-Adapter noch nicht implementiert (Issue #30)"); }
  async commentIssue(_id, _text) { fail("gitlab-Adapter noch nicht implementiert (Issue #30)"); }
}

class LocalIssueTracker {
  async createIssue(_input) { fail("local-Adapter noch nicht implementiert (Issue #32)"); }
  async getIssue(_id) { fail("local-Adapter noch nicht implementiert (Issue #32)"); }
  async listIssues(_status) { fail("local-Adapter noch nicht implementiert (Issue #32)"); }
  async moveIssue(_id, _to) { fail("local-Adapter noch nicht implementiert (Issue #32)"); }
  async commentIssue(_id, _text) { fail("local-Adapter noch nicht implementiert (Issue #32)"); }
}

class GitHubCodeHost {
  async getRepoName() { fail("github-Adapter noch nicht implementiert (Issue #30)"); }
  supportsPullRequests() { return true; }
  async createPullRequest(_input) { fail("github-Adapter noch nicht implementiert (Issue #30)"); }
}

class GitLabCodeHost {
  async getRepoName() { fail("gitlab-Adapter noch nicht implementiert (Issue #30)"); }
  supportsPullRequests() { return true; }
  async createPullRequest(_input) { fail("gitlab-Adapter noch nicht implementiert (Issue #30)"); }
}

class LocalCodeHost {
  async getRepoName() { fail("local-Adapter noch nicht implementiert (Issue #32)"); }
  supportsPullRequests() { return false; }
  async createPullRequest(_input) { fail("local-Adapter unterstuetzt keine Pull Requests"); }
}

// --- Adapter-Auswahl ---

function resolveTracker(config) {
  switch (config.issueTracker) {
    case "github": return new GitHubIssueTracker();
    case "gitlab": return new GitLabIssueTracker();
    case "local":  return new LocalIssueTracker();
    default: fail(`Unbekannter issueTracker: '${config.issueTracker}'. Erwartet: github | gitlab | local`);
  }
}

function resolveCodeHost(config) {
  switch (config.codeHost) {
    case "github": return new GitHubCodeHost();
    case "gitlab": return new GitLabCodeHost();
    case "local":  return new LocalCodeHost();
    default: fail(`Unbekannter codeHost: '${config.codeHost}'. Erwartet: github | gitlab | local`);
  }
}

// --- Dispatch ---

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
        const result = await tracker.createIssue({ title: args.title, body: args.body || "" });
        out(result);
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
  process.stderr.write(`Unerwarteter Fehler: ${err.message}\n`);
  process.exit(1);
});
