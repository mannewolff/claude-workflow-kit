#!/usr/bin/env node
/**
 * board-ui.mjs — Lokale Kanban-GUI fuer das claude-workflow-kit.
 * Startet einen HTTP-Server, der Issues aus issues/*.md als Board zeigt.
 *
 * Nutzung:
 *   node .claude/kit/board-ui.mjs [--port 3000]
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";

// --- Argument-Parser ---

function parseArgs(argv) {
  const result = { port: 3000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) {
      result.port = Number(argv[i + 1]);
      i++;
    }
  }
  return result;
}

// --- Config laden ---

function loadConfig() {
  const candidates = [
    resolve(".claude", "workflow.config.json"),
    resolve("workflow.config.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        // ignorieren, naechste Datei versuchen
      }
    }
  }
  return {};
}

// --- Frontmatter-Parser ---

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

// --- Issues lesen ---

function readIssues(issuesDir) {
  if (!existsSync(issuesDir)) return [];
  return readdirSync(issuesDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const raw = readFileSync(join(issuesDir, f), "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      return {
        id: meta.id || basename(f, ".md"),
        title: meta.title || f,
        status: meta.status || "backlog",
        created: meta.created || "",
        body,
      };
    });
}

// --- HTTP-Handler ---

function handleRequest(req, res, issuesDir) {
  const url = new URL(req.url, `http://localhost`);

  // GET /
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  // GET /api/issues
  if (req.method === "GET" && url.pathname === "/api/issues") {
    const issues = readIssues(issuesDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(issues));
    return;
  }

  // POST /api/issues/:id/move
  const moveMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/move$/);
  if (req.method === "POST" && moveMatch) {
    const id = moveMatch[1];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { to } = JSON.parse(body);
        const file = join(issuesDir, `${id}.md`);
        if (!existsSync(file)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Issue ${id} nicht gefunden` }));
          return;
        }
        const raw = readFileSync(file, "utf-8");
        const { meta, body: issueBody } = parseFrontmatter(raw);
        meta.status = to;
        writeFileSync(file, serializeFrontmatter(meta, issueBody), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id, status: to }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

// --- HTML-Platzhalter (wird in Issue #38 ersetzt) ---

const HTML = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>claude-workflow-kit Board</title></head>
<body><h1>Board</h1><p>Frontend kommt in Issue #38.</p></body>
</html>`;

// --- Start ---

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const issuesDir = resolve(config.local?.issuesDir || "issues");

const server = createServer((req, res) => {
  try {
    handleRequest(req, res, issuesDir);
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
});

server.listen(args.port, () => {
  console.log(`Board läuft auf http://localhost:${args.port}`);
  console.log(`Issues-Verzeichnis: ${issuesDir}`);
});
