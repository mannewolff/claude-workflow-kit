#!/usr/bin/env node
/**
 * board-ui.mjs — Lokale Kanban-GUI fuer das claude-workflow-kit.
 * Startet einen HTTP-Server, der Issues aus issues/*.md als Board zeigt.
 *
 * Nutzung:
 *   node .claude/kit/board-ui.mjs [--port 3000]
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync, statSync } from "node:fs";
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
    .filter((f) => f.endsWith(".md") && statSync(join(issuesDir, f)).isFile())
    .sort()
    .map((f) => {
      const raw = readFileSync(join(issuesDir, f), "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      return {
        id: meta.id || basename(f, ".md"),
        title: meta.title || f,
        status: (meta.status || "backlog").replace(/-/g, "_"),
        created: meta.created || "",
        done_at: meta.done_at || "",
        priority: meta.priority ? Number(meta.priority) : null,
        body,
      };
    });
}

// --- Archiv ---

function archiveOldIssues(issuesDir) {
  if (!existsSync(issuesDir)) return;
  const archiveDir = join(issuesDir, "archive");
  const now = Date.now();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const files = readdirSync(issuesDir).filter(
    (f) => f.endsWith(".md") && statSync(join(issuesDir, f)).isFile()
  );
  for (const f of files) {
    const path = join(issuesDir, f);
    const raw = readFileSync(path, "utf-8");
    const { meta } = parseFrontmatter(raw);
    const status = (meta.status || "").replace(/-/g, "_");
    if (status !== "done" || !meta.done_at) continue;
    const doneTs = new Date(meta.done_at).getTime();
    if (isNaN(doneTs) || now - doneTs < THREE_DAYS_MS) continue;
    mkdirSync(archiveDir, { recursive: true });
    renameSync(path, join(archiveDir, f));
    process.stdout.write(`Archiviert: ${f}\n`);
  }
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

  // GET /api/config
  if (req.method === "GET" && url.pathname === "/api/config") {
    const colMap = config.columns || {
      backlog: "Backlog", ready: "Ready",
      in_progress: "In Progress", in_review: "In Review", done: "Done",
    };
    const columns = Object.entries(colMap).map(([key, label]) => ({ key, label }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ columns }));
    return;
  }

  // GET /api/issues  (optional: ?archive=1 für archivierte Issues)
  if (req.method === "GET" && url.pathname === "/api/issues") {
    if (url.searchParams.get("archive") === "1") {
      const archiveDir = join(issuesDir, "archive");
      const archived = readIssues(archiveDir).map((i) => ({ ...i, status: "archived" }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(archived));
    } else {
      const issues = readIssues(issuesDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(issues));
    }
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
        if (to === "done") {
          meta.done_at = new Date().toISOString().slice(0, 10);
        } else {
          delete meta.done_at;
        }
        writeFileSync(file, serializeFrontmatter(meta, issueBody), "utf-8");

        // GO-Commit: Drag nach ready erzeugt einen eigenen git-Commit
        if (to === "ready") {
          try {
            execSync(`git add ${JSON.stringify(file)}`, { stdio: "pipe" });
            // --only: nur die Issue-Datei committen, fremde gestagte Aenderungen bleiben im Index
            execSync(`git commit -o -m "GO: #${id} nach ready" -- ${JSON.stringify(file)}`, { stdio: "pipe" });
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

  // POST /api/issues/:id/comment
  const commentMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/comment$/);
  if (req.method === "POST" && commentMatch) {
    const id = commentMatch[1];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { text } = JSON.parse(body);
        if (!text || !text.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Leerer Kommentar" }));
          return;
        }
        const file = join(issuesDir, `${id}.md`);
        if (!existsSync(file)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Issue ${id} nicht gefunden` }));
          return;
        }
        const now = new Date();
        const ts = now.toISOString().slice(0, 16).replace("T", " ");
        const block = `\n\n---\n**Kommentar** (${ts})\n\n${text.trim()}`;
        const raw = readFileSync(file, "utf-8");
        writeFileSync(file, raw + block, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/issues/reorder
  if (req.method === "POST" && url.pathname === "/api/issues/reorder") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { ids } = JSON.parse(body);
        if (!Array.isArray(ids)) throw new Error("ids muss ein Array sein");
        ids.forEach((id, idx) => {
          const file = join(issuesDir, `${id}.md`);
          if (!existsSync(file)) return;
          const raw = readFileSync(file, "utf-8");
          const { meta, body: issueBody } = parseFrontmatter(raw);
          meta.priority = String(idx + 1);
          writeFileSync(file, serializeFrontmatter(meta, issueBody), "utf-8");
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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
    min-height: calc(100vh - 93px);
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

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.45);
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 40px 16px;
    overflow-y: auto;
  }
  .modal-window {
    background: #fff;
    border-radius: 8px;
    width: 100%;
    max-width: 700px;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,.24);
    position: relative;
  }
  .modal-header {
    padding: 16px 48px 12px 20px;
    border-bottom: 1px solid #e8e8e8;
  }
  .modal-title {
    font-size: 18px;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 6px;
  }
  .modal-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #6b778c;
  }
  .modal-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
  }
  .modal-close {
    position: absolute;
    top: 12px;
    right: 14px;
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: #6b778c;
    line-height: 1;
    padding: 4px 6px;
    border-radius: 4px;
  }
  .modal-close:hover { background: #f0f0f0; color: #172b4d; }
  .modal-body {
    padding: 20px;
  }
  .modal-body h2 { font-size: 14px; font-weight: 600; margin: 14px 0 5px; }
  .modal-body h3 { font-size: 13px; font-weight: 600; margin: 10px 0 4px; color: #344563; }
  .modal-body p { margin: 5px 0; line-height: 1.6; color: #344563; }
  .modal-body ul { margin: 5px 0 5px 18px; }
  .modal-body li { margin: 3px 0; line-height: 1.5; color: #344563; }
  .modal-body strong { font-weight: 600; }
  .modal-body code {
    background: #f4f5f7;
    padding: 1px 5px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 12px;
  }
  .modal-body pre {
    background: #f4f5f7;
    padding: 10px 12px;
    border-radius: 5px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .modal-body pre code { background: none; padding: 0; }

  .modal-comments { padding: 0 20px; }
  .modal-comment {
    background: #f8f8f8;
    border: 1px solid #e8e8e8;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 10px;
  }
  .modal-comment-meta {
    font-size: 11px;
    color: #6b778c;
    margin-bottom: 6px;
    font-weight: 600;
  }
  .modal-comment-body p { margin: 3px 0; line-height: 1.5; color: #344563; }
  .modal-comment-body ul { margin: 3px 0 3px 16px; }
  .modal-comment-body li { margin: 2px 0; line-height: 1.5; color: #344563; }
  .modal-comment-body code {
    background: #efefef;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 12px;
  }

  .modal-comment-form {
    padding: 12px 20px 20px;
    border-top: 1px solid #e8e8e8;
    margin-top: 8px;
  }
  .modal-comment-form textarea {
    width: 100%;
    min-height: 80px;
    padding: 8px 10px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    font-family: inherit;
    font-size: 13px;
    resize: vertical;
    color: #172b4d;
  }
  .modal-comment-form textarea:focus { outline: none; border-color: #0075ca; }
  .modal-comment-send {
    margin-top: 8px;
    padding: 6px 14px;
    background: #0075ca;
    color: #fff;
    border: none;
    border-radius: 5px;
    font-size: 13px;
    cursor: pointer;
    font-weight: 500;
  }
  .modal-comment-send:disabled { background: #a0c4e4; cursor: default; }
  .modal-comment-send:not(:disabled):hover { background: #005fa3; }

  .empty {
    text-align: center;
    color: #97a0af;
    font-size: 12px;
    padding: 20px 8px;
  }

  /* View-Toggle */
  .view-toggle {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  .view-btn {
    padding: 4px 12px;
    border: 1px solid #dfe1e6;
    background: #fff;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    color: #42526e;
  }
  .view-btn.active {
    background: #0075ca;
    border-color: #0075ca;
    color: #fff;
  }

  /* Listenansicht */
  .list-view {
    padding: 20px;
  }
  .list-filter {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .list-filter-btn {
    padding: 4px 12px;
    border: 1px solid #dfe1e6;
    background: #fff;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    color: #6b778c;
    transition: all .15s;
  }
  .list-filter-btn.active {
    background: #172b4d;
    border-color: #172b4d;
    color: #fff;
  }
  .list-row {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #fff;
    border: 1px solid #e8e8e8;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 6px;
    cursor: pointer;
    transition: box-shadow .15s;
    user-select: none;
  }
  .list-row:hover { box-shadow: 0 2px 8px rgba(0,0,0,.12); }
  .list-handle {
    color: #97a0af;
    font-size: 16px;
    cursor: grab;
    flex-shrink: 0;
    line-height: 1;
    user-select: none;
  }
  .list-handle.disabled { opacity: 0; cursor: default; pointer-events: none; }
  .list-id {
    font-size: 11px;
    color: #6b778c;
    flex-shrink: 0;
    width: 38px;
  }
  .list-badge {
    flex-shrink: 0;
  }
  .list-title {
    font-weight: 500;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .list-excerpt {
    color: #6b778c;
    font-size: 12px;
    flex-shrink: 0;
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .list-row.drag-target {
    border-top: 2px solid #0075ca;
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
  <div class="view-toggle">
    <button class="view-btn active" id="btn-board" onclick="switchView('board')">Board</button>
    <button class="view-btn" id="btn-list" onclick="switchView('list')">Liste</button>
  </div>
</header>

<div class="board" id="board"></div>
<div class="list-view" id="list-view" style="display:none"></div>

<script>
let COLUMNS = [
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
    const colIssues = (byStatus[col.key] || []).sort((a, b) => {
      const pa = a.priority ?? Infinity, pb = b.priority ?? Infinity;
      if (pa !== pb) return pa - pb;
      return (a.id || '').localeCompare(b.id || '');
    });
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

const STATUS_BADGE = {
  backlog:     { bg: "#dfe1e6", color: "#42526e", label: "Backlog" },
  ready:       { bg: "#deebff", color: "#0747a6", label: "Ready" },
  in_progress: { bg: "#fffae6", color: "#7a6000", label: "In Progress" },
  in_review:   { bg: "#ffedeb", color: "#bf2600", label: "In Review" },
  done:        { bg: "#e3fcef", color: "#006644", label: "Done" },
  archived:    { bg: "#f0f0f0", color: "#666", label: "Archiv" },
};

function parseIssueBody(raw) {
  const parts = raw.split(/(?=\\n\\n---\\n\\*\\*Kommentar\\*\\*)/);
  const mainBody = parts[0];
  const comments = parts.slice(1).map((block) => {
    const m = block.match(/\\n\\n---\\n\\*\\*Kommentar\\*\\*\\s*\\(([^)]*)\\)\\n\\n([\\s\\S]*)/);
    return m ? { ts: m[1], text: m[2].trim() } : { ts: "", text: block.trim() };
  });
  return { mainBody, comments };
}

function openModal(issue) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const badge = STATUS_BADGE[issue.status] || STATUS_BADGE.backlog;
  const badgeHtml = \`<span class="modal-badge" style="background:\${badge.bg};color:\${badge.color}">\${badge.label}</span>\`;

  const { mainBody, comments } = parseIssueBody(issue.body || "");

  const commentsHtml = comments.map(c =>
    \`<div class="modal-comment">
      <div class="modal-comment-meta">Kommentar · \${escHtml(c.ts)}</div>
      <div class="modal-comment-body">\${renderMarkdown(c.text)}</div>
    </div>\`
  ).join("");

  const window_ = document.createElement("div");
  window_.className = "modal-window";
  window_.innerHTML =
    \`<div class="modal-header">
      <div class="modal-title">\${escHtml(issue.title)}</div>
      <div class="modal-meta">\${badgeHtml}<span>#\${escHtml(issue.id)}</span></div>
      <button class="modal-close" aria-label="Schliessen">×</button>
    </div>
    <div class="modal-body">\${renderMarkdown(mainBody)}</div>
    \${comments.length ? \`<div class="modal-comments">\${commentsHtml}</div>\` : ""}
    <div class="modal-comment-form">
      <textarea placeholder="Kommentar schreiben..."></textarea>
      <button class="modal-comment-send" disabled>Senden</button>
    </div>\`;

  overlay.appendChild(window_);
  document.body.appendChild(overlay);

  // Kommentar-Formular
  const textarea = window_.querySelector("textarea");
  const sendBtn = window_.querySelector(".modal-comment-send");
  textarea.addEventListener("input", () => {
    sendBtn.disabled = !textarea.value.trim();
  });
  sendBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    await fetch(\`/api/issues/\${issue.id}/comment\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    closeModal();
    const freshIssues = await (await fetch("/api/issues")).json();
    buildBoard(freshIssues);
    const fresh = freshIssues.find(i => i.id === issue.id);
    if (fresh) openModal(fresh);
  });

  // Schließen via × oder Overlay-Klick (nicht Modal selbst)
  window_.querySelector(".modal-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", handleEsc);
}

function handleEsc(e) {
  if (e.key === "Escape") closeModal();
}

function closeModal() {
  const overlay = document.querySelector(".modal-overlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", handleEsc);
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
    </div>\`;

  let dragging = false;
  card.addEventListener("dragstart", (e) => {
    dragging = true;
    e.dataTransfer.setData("text/plain", issue.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    setTimeout(() => { dragging = false; }, 0);
  });

  card.querySelector(".card-header").addEventListener("click", () => {
    if (!dragging) openModal(issue);
  });

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

// --- View-Switching ---
let currentView = 'board';
const activeFilters = new Set(['backlog','ready','in_progress','in_review','done']);

function switchView(v) {
  currentView = v;
  document.getElementById('board').style.display = v === 'board' ? '' : 'none';
  document.getElementById('list-view').style.display = v === 'list' ? '' : 'none';
  document.getElementById('btn-board').classList.toggle('active', v === 'board');
  document.getElementById('btn-list').classList.toggle('active', v === 'list');
  if (v === 'list') loadList();
}

// --- Listenansicht ---
const LIST_STATUSES = [
  { key: 'backlog',     label: 'Backlog' },
  { key: 'ready',       label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review',   label: 'In Review' },
  { key: 'done',        label: 'Done' },
  { key: 'archived',    label: 'Archiv' },
];

function bodyExcerpt(raw) {
  return raw.replace(/\\n/g, ' ').replace(/#+\\s*/g, '').replace(/[*_\`]/g, '').trim().slice(0, 80);
}

function buildList(issues) {
  const container = document.getElementById('list-view');
  container.innerHTML = '';

  // Filter-Leiste
  const filterBar = document.createElement('div');
  filterBar.className = 'list-filter';
  for (const s of LIST_STATUSES) {
    const btn = document.createElement('button');
    btn.className = 'list-filter-btn' + (activeFilters.has(s.key) ? ' active' : '');
    btn.textContent = s.label;
    btn.dataset.key = s.key;
    btn.addEventListener('click', () => {
      if (activeFilters.has(s.key)) activeFilters.delete(s.key);
      else activeFilters.add(s.key);
      buildList(issues);
    });
    filterBar.appendChild(btn);
  }
  container.appendChild(filterBar);

  // Gefiltertes + sortiertes Issue-Array
  const visible = issues
    .filter(i => activeFilters.has(i.status))
    .sort((a, b) => {
      const pa = a.priority ?? Infinity, pb = b.priority ?? Infinity;
      if (pa !== pb) return pa - pb;
      return (a.id || '').localeCompare(b.id || '');
    });

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Keine Issues';
    container.appendChild(empty);
    return;
  }

  for (const issue of visible) {
    const row = buildListRow(issue);
    container.appendChild(row);
  }

}

let listAllIssues = [];
let listDragId = null;

function buildListRow(issue) {
  const row = document.createElement('div');
  row.className = 'list-row';
  row.dataset.id = issue.id;
  const isArchived = issue.status === 'archived';

  const badge = STATUS_BADGE[issue.status] || { bg: '#e0e0e0', color: '#444', label: issue.status };
  const badgeEl = \`<span class="modal-badge list-badge" style="background:\${badge.bg};color:\${badge.color}">\${badge.label}</span>\`;

  row.innerHTML =
    \`<span class="list-handle\${isArchived ? ' disabled' : ''}" title="Reihenfolge ändern">⠿</span>
     <span class="list-id">#\${escHtml(issue.id)}</span>
     \${badgeEl}
     <span class="list-title">\${escHtml(issue.title)}</span>
     <span class="list-excerpt">\${escHtml(bodyExcerpt(issue.body || ''))}</span>\`;

  if (!isArchived) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      listDragId = issue.id;
      e.dataTransfer.setData('text/plain', issue.id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { row.style.opacity = '0.4'; }, 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      document.querySelectorAll('.list-row').forEach(r => r.classList.remove('drag-target'));
      listDragId = null;
    });
  }

  row.addEventListener('dragover', (e) => {
    if (!listDragId || listDragId === issue.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.list-row').forEach(r => r.classList.remove('drag-target'));
    row.classList.add('drag-target');
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-target');
    if (!listDragId || listDragId === issue.id) return;
    const container = document.getElementById('list-view');
    const draggedEl = container.querySelector(\`.list-row[data-id="\${listDragId}"]\`);
    if (draggedEl) container.insertBefore(draggedEl, row);
    listSaveOrder();
    listDragId = null;
  });

  let clicking = false;
  row.addEventListener('mousedown', () => { clicking = true; });
  row.addEventListener('dragstart', () => { clicking = false; });
  row.addEventListener('click', () => { if (clicking) openModal(issue); clicking = false; });
  return row;
}

async function listSaveOrder() {
  const container = document.getElementById('list-view');
  const orderedIds = [...container.querySelectorAll('.list-row')].map(r => r.dataset.id).filter(Boolean);
  const reorderIds = listAllIssues
    .filter(i => i.status !== 'archived')
    .sort((a, b) => {
      const ai = orderedIds.indexOf(a.id), bi = orderedIds.indexOf(b.id);
      return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
    })
    .map(i => i.id);
  await fetch('/api/issues/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: reorderIds }),
  });
  reorderIds.forEach((id, idx) => {
    const iss = listAllIssues.find(i => i.id === id);
    if (iss) iss.priority = idx + 1;
  });
}

async function loadList() {
  const [res, archRes] = await Promise.all([
    fetch('/api/issues'),
    activeFilters.has('archived') ? fetch('/api/issues?archive=1') : Promise.resolve(null),
  ]);
  const issues = await res.json();
  const archived = archRes ? await archRes.json() : [];
  listAllIssues = [...issues, ...archived];
  buildList(listAllIssues);
}

async function init() {
  const res = await fetch("/api/config");
  const cfg = await res.json();
  if (cfg.columns && cfg.columns.length) COLUMNS = cfg.columns;
  await loadBoard();
}

init();
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

archiveOldIssues(issuesDir);
setInterval(() => archiveOldIssues(issuesDir), 60 * 60 * 1000);

server.listen(args.port, () => {
  console.log(`Board läuft auf http://localhost:${args.port}`);
  console.log(`Issues-Verzeichnis: ${issuesDir}`);
});
