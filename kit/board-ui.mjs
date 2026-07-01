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
import { execSync } from "node:child_process";

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

        // GO-Commit: Drag nach ready erzeugt einen eigenen git-Commit
        if (to === "ready") {
          try {
            execSync(`git add ${JSON.stringify(file)}`, { stdio: "pipe" });
            execSync(`git commit -m "GO: #${id} nach ready"`, { stdio: "pipe" });
          } catch (e) {
            process.stderr.write(`GO-Commit fehlgeschlagen (nicht kritisch): ${e.message}\n`);
          }
        }

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

// --- HTML (eingebettet, kein Build-Step, keine externen Abhaengigkeiten) ---

const HTML = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>claude-workflow-kit Board</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    background: #f4f5f7;
    color: #172b4d;
    min-height: 100vh;
  }

  header {
    background: #fff;
    border-bottom: 1px solid #dfe1e6;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header h1 { font-size: 16px; font-weight: 600; }
  header .subtitle { color: #6b778c; font-size: 12px; }

  .board {
    display: flex;
    gap: 12px;
    padding: 20px;
    overflow-x: auto;
    align-items: flex-start;
    min-height: calc(100vh - 53px);
  }

  .column {
    flex: 0 0 240px;
    background: #ebecf0;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 93px);
  }

  .column-header {
    padding: 10px 12px 8px;
    border-radius: 8px 8px 0 0;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: .04em;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .column-header .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .column-header .count {
    margin-left: auto;
    font-size: 11px;
    opacity: .7;
  }

  .column-body {
    padding: 8px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .column-body.drag-over {
    background: rgba(0,0,0,.05);
    border-radius: 0 0 8px 8px;
  }

  .card {
    background: #fff;
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,.12);
    cursor: grab;
    transition: box-shadow .15s;
  }
  .card:active { cursor: grabbing; }
  .card.dragging { opacity: .4; }
  .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.18); }

  .card-header {
    padding: 10px 12px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }
  .card-id {
    font-size: 11px;
    color: #6b778c;
    flex-shrink: 0;
    padding-top: 1px;
  }
  .card-title { flex: 1; font-weight: 500; line-height: 1.4; }
  .card-chevron {
    flex-shrink: 0;
    color: #6b778c;
    font-size: 10px;
    transition: transform .2s;
    padding-top: 2px;
  }
  .card.open .card-chevron { transform: rotate(180deg); }

  .card-body {
    display: none;
    padding: 0 12px 12px;
    border-top: 1px solid #f0f0f0;
    padding-top: 10px;
  }
  .card.open .card-body { display: block; }

  .card-body h2 { font-size: 13px; font-weight: 600; margin: 10px 0 4px; }
  .card-body h3 { font-size: 12px; font-weight: 600; margin: 8px 0 4px; color: #344563; }
  .card-body p { margin: 4px 0; line-height: 1.5; color: #344563; }
  .card-body ul { margin: 4px 0 4px 16px; }
  .card-body li { margin: 2px 0; line-height: 1.5; color: #344563; }
  .card-body strong { font-weight: 600; }
  .card-body code {
    background: #f4f5f7;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 12px;
  }

  .empty {
    text-align: center;
    color: #97a0af;
    font-size: 12px;
    padding: 20px 8px;
  }

  /* Spalten-Farben */
  .col-backlog    .column-header { background: #dfe1e6; color: #42526e; }
  .col-backlog    .dot           { background: #6b7280; }
  .col-ready      .column-header { background: #deebff; color: #0747a6; }
  .col-ready      .dot           { background: #0075ca; }
  .col-in_progress .column-header { background: #fffae6; color: #7a6000; }
  .col-in_progress .dot          { background: #e4b400; }
  .col-in_review  .column-header { background: #ffedeb; color: #bf2600; }
  .col-in_review  .dot           { background: #d93f0b; }
  .col-done       .column-header { background: #e3fcef; color: #006644; }
  .col-done       .dot           { background: #0e8a16; }
</style>
</head>
<body>

<header>
  <h1>claude-workflow-kit Board</h1>
  <span class="subtitle">Lokaler Modus — Dateien in issues/</span>
</header>

<div class="board" id="board"></div>

<script>
const COLUMNS = [
  { key: "backlog",     label: "Backlog" },
  { key: "ready",       label: "Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "in_review",   label: "In Review" },
  { key: "done",        label: "Done" },
];

// --- Mini Markdown-Renderer ---
function renderMarkdown(text) {
  const lines = text.split("\\n");
  const out = [];
  let inList = false;

  for (const raw of lines) {
    let line = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Inline: **bold**, \`code\`
    line = line
      .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
      .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
      .replace(/\\*([^*]+)\\*/g, "<em>$1</em>");

    if (/^### /.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<h3>" + line.slice(4) + "</h3>");
    } else if (/^## /.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<h2>" + line.slice(3) + "</h2>");
    } else if (/^# /.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<h2>" + line.slice(2) + "</h2>");
    } else if (/^- /.test(raw)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + line.slice(2) + "</li>");
    } else if (raw.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<p>" + line + "</p>");
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\\n");
}

// --- Board rendern ---
function buildBoard(issues) {
  const board = document.getElementById("board");
  board.innerHTML = "";

  const byStatus = {};
  for (const col of COLUMNS) byStatus[col.key] = [];
  for (const issue of issues) {
    const key = issue.status || "backlog";
    if (byStatus[key]) byStatus[key].push(issue);
    else byStatus["backlog"].push(issue);
  }

  for (const col of COLUMNS) {
    const colIssues = byStatus[col.key];
    const colEl = document.createElement("div");
    colEl.className = "column col-" + col.key;
    colEl.dataset.status = col.key;

    colEl.innerHTML =
      \`<div class="column-header">
        <span class="dot"></span>
        \${col.label}
        <span class="count">\${colIssues.length}</span>
      </div>
      <div class="column-body" data-status="\${col.key}"></div>\`;

    const body = colEl.querySelector(".column-body");

    if (colIssues.length === 0) {
      body.innerHTML = '<div class="empty">Keine Issues</div>';
    } else {
      for (const issue of colIssues) {
        body.appendChild(buildCard(issue));
      }
    }

    // Drop-Zone
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      body.classList.add("drag-over");
    });
    body.addEventListener("dragleave", () => body.classList.remove("drag-over"));
    body.addEventListener("drop", async (e) => {
      e.preventDefault();
      body.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      const to = body.dataset.status;
      await moveIssue(id, to);
    });

    board.appendChild(colEl);
  }
}

function buildCard(issue) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = issue.id;

  card.innerHTML =
    \`<div class="card-header">
      <span class="card-id">#\${issue.id}</span>
      <span class="card-title">\${escHtml(issue.title)}</span>
      <span class="card-chevron">▼</span>
    </div>
    <div class="card-body">\${renderMarkdown(issue.body || "")}</div>\`;

  card.querySelector(".card-header").addEventListener("click", () => {
    card.classList.toggle("open");
  });

  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", issue.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  return card;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function moveIssue(id, to) {
  const res = await fetch("/api/issues/" + id + "/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  if (res.ok) {
    await loadBoard();
  }
}

async function loadBoard() {
  const res = await fetch("/api/issues");
  const issues = await res.json();
  buildBoard(issues);
}

loadBoard();
</script>
</body>
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
