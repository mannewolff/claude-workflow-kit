#!/usr/bin/env node
/**
 * board-ui.mjs — Lokale Kanban-GUI (eigenstaendiges board-ui-Projekt).
 * Startet einen HTTP-Server, der Issues aus issues/*.md als Board zeigt.
 *
 * Nutzung:
 *   node src/board-ui.mjs [--port 3000] [--name <Board-Name>]
 *
 * Port-Vorrang: config.local.uiPort (workflow.config.json) > --port > 3000.
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { readdir, readFile, mkdir, rename, stat } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { execSync } from "node:child_process";

// Versionskennung (x.y.z). Einzige Anzeige-Quelle — funktioniert auch fuer die
// standalone ins Kit synchronisierte board-ui.mjs (kein package.json noetig).
// Gepflegt von tools/bump-version.mjs (haelt package.json im Gleichschritt):
// "push main" erhoeht z (patch), "merge production" erhoeht y (minor), x nur manuell.
const VERSION = "0.1.4";

// --- Argument-Parser ---

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) {
      result.port = Number(argv[i + 1]);
      i++;
    } else if (argv[i] === "--name" && argv[i + 1]) {
      result.name = argv[i + 1];
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

// --- Issues lesen ---

function columnMap(config) {
  return config.columns || {
    backlog: "Backlog", ready: "Ready",
    in_progress: "In Progress", in_review: "In Review", done: "Done",
  };
}

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
        type: meta.type || "task",
        parent: meta.parent || "",
        color: meta.color || "",
        shortcode: meta.shortcode || "",
        title: meta.title || f,
        status: (meta.status || "backlog").replace(/-/g, "_"),
        created: meta.created || "",
        done_at: meta.done_at || "",
        priority: meta.priority ? Number(meta.priority) : null,
        body,
      };
    });
}

// --- Issue bearbeiten ---

// SYNC: spiegelt die Trennlogik von parseIssueBody im Client-Script (unten im HTML-Template),
// hier aber nur als reiner Text-Split (kein Rendering) — findet den ersten Kommentar-Marker
// und trennt den Haupttext vom unveraenderten Kommentar-Rohtext.
function splitComments(body) {
  const idx = body.search(/\n\n---\n\*\*Kommentar\*\*/);
  if (idx === -1) return { mainBody: body, commentsRaw: "" };
  return { mainBody: body.slice(0, idx), commentsRaw: body.slice(idx) };
}

// --- Issue anlegen ---

// SYNC: ID-Vergabe (padId + nextId) und das Frontmatter-Format bewusst gespiegelt
// aus kit/board.mjs (padId/_nextId/createIssue). board-ui.mjs und board.mjs sind
// eigenstaendige Single-File-Tools ohne gemeinsames Modul — Aenderungen an der
// ID- oder Frontmatter-Logik immer in beiden Dateien identisch nachziehen.
function padId(n) {
  return String(n).padStart(4, "0");
}

// SYNC: Epic-Fortschritt aus den Kindern (parent-Zeiger). Gespiegelt aus board.mjs.
// Kinder = nicht-Epic-Issues mit parent == epicId; done = Kinder im Status "done".
function epicProgress(issues, epicId) {
  const children = issues.filter((i) => i.type !== "epic" && i.parent === epicId);
  const done = children.filter((i) => i.status === "done").length;
  return { total: children.length, done };
}

function nextId(issuesDir) {
  if (!existsSync(issuesDir)) return 1;
  const nums = readdirSync(issuesDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseInt(f, 10))
    .filter((n) => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function createIssue(issuesDir, { title, body, type, parent, color, shortcode }) {
  mkdirSync(issuesDir, { recursive: true });
  const id = padId(nextId(issuesDir));
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
  writeFileSync(join(issuesDir, `${id}.md`), content, "utf-8");
  return { id };
}

// --- Archiv ---

// Asynchron (fs/promises), damit der stuendliche Lauf keine HTTP-Requests blockiert
async function archiveOldIssues(issuesDir) {
  if (!existsSync(issuesDir)) return;
  const archiveDir = join(issuesDir, "archive");
  const now = Date.now();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  for (const f of await readdir(issuesDir)) {
    if (!f.endsWith(".md")) continue;
    const path = join(issuesDir, f);
    if (!(await stat(path)).isFile()) continue;
    const raw = await readFile(path, "utf-8");
    const { meta } = parseFrontmatter(raw);
    const status = (meta.status || "").replace(/-/g, "_");
    if (status !== "done" || !meta.done_at) continue;
    const doneTs = new Date(meta.done_at).getTime();
    if (isNaN(doneTs) || now - doneTs < THREE_DAYS_MS) continue;
    await mkdir(archiveDir, { recursive: true });
    await rename(path, join(archiveDir, f));
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
    const columns = Object.entries(columnMap(config)).map(([key, label]) => ({ key, label }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ columns, boardName: args.name || null, root: process.cwd(), version: VERSION }));
    return;
  }

  // GET /api/state — billige Signatur des issues/-Ordners (Dateianzahl + neuester mtime),
  // ohne volles Issue-JSON. Dient dem Client-Polling zum Erkennen externer Aenderungen.
  if (req.method === "GET" && url.pathname === "/api/state") {
    let count = 0;
    let maxMtime = 0;
    if (existsSync(issuesDir)) {
      for (const f of readdirSync(issuesDir)) {
        if (!f.endsWith(".md")) continue;
        const st = statSync(join(issuesDir, f));
        if (!st.isFile()) continue;
        count++;
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sig: count + ":" + maxMtime }));
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

  // GET /api/epics — Epics mit berechnetem Fortschritt (E5: keine Board-Karten)
  if (req.method === "GET" && url.pathname === "/api/epics") {
    const all = readIssues(issuesDir);
    const epics = all
      .filter((i) => i.type === "epic")
      .map((e) => ({ ...e, progress: epicProgress(all, e.id) }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(epics));
    return;
  }

  // POST /api/issues  (neues Issue anlegen)
  if (req.method === "POST" && url.pathname === "/api/issues") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { title, body: issueBody, type, parent, shortcode, color } = JSON.parse(body);
        if (!title || !title.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Titel darf nicht leer sein" }));
          return;
        }
        const created = createIssue(issuesDir, {
          title: title.trim(),
          body: issueBody,
          type,
          parent,
          shortcode: shortcode && shortcode.trim(),
          color: color && color.trim(),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id: created.id }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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
        const valid = Object.keys(columnMap(config));
        if (!valid.includes(to)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Ungueltiger Status '${to}'. Gueltig: ${valid.join(", ")}` }));
          return;
        }
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

  // POST /api/issues/:id/edit
  const editMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/edit$/);
  if (req.method === "POST" && editMatch) {
    const id = editMatch[1];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { title, body: newBody, shortcode, color } = JSON.parse(body);
        if (!title || !title.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Titel darf nicht leer sein" }));
          return;
        }
        const file = join(issuesDir, `${id}.md`);
        if (!existsSync(file)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Issue ${id} nicht gefunden` }));
          return;
        }
        const raw = readFileSync(file, "utf-8");
        const { meta, body: issueBody } = parseFrontmatter(raw);
        const { commentsRaw } = splitComments(issueBody);
        meta.title = title.trim();
        // shortcode/color nur anfassen, wenn das Feld mitgeschickt wurde (nur Epics tun das).
        // Leerer Wert entfernt das Feld → Titel-Initialen- bzw. Palette-Fallback greift wieder.
        if (shortcode !== undefined) {
          if (shortcode && shortcode.trim()) meta.shortcode = shortcode.trim();
          else delete meta.shortcode;
        }
        if (color !== undefined) {
          if (color && color.trim()) meta.color = color.trim();
          else delete meta.color;
        }
        writeFileSync(file, serializeFrontmatter(meta, (newBody || "") + commentsRaw), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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
  header .version {
    font-size: 11px; font-weight: 600; color: #5e6c84;
    background: #f4f5f7; border: 1px solid #dfe1e6;
    border-radius: 10px; padding: 1px 8px;
  }
  header .copyright { color: #6b778c; font-size: 12px; }
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
    flex: 1 1 0;
    min-width: 220px;
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
  .modal-edit-btn {
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid #dfe1e6;
    background: #fff;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    color: #42526e;
  }
  .modal-edit-btn:hover { background: #f4f5f7; }
  .modal-edit-cancel-btn {
    margin-left: 8px;
    padding: 6px 14px;
    background: #fff;
    border: 1px solid #d0d7de;
    border-radius: 5px;
    font-size: 13px;
    cursor: pointer;
    color: #42526e;
  }
  .modal-edit-cancel-btn:hover { background: #f4f5f7; }
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

  /* Neues Issue */
  .new-issue-btn {
    padding: 6px 14px;
    background: #0e8a16;
    color: #fff;
    border: none;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .new-issue-btn:hover { background: #0a6b11; }

  .new-issue-field { margin-bottom: 14px; }
  .new-issue-field label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #6b778c;
    margin-bottom: 4px;
  }
  .new-issue-field input,
  .new-issue-field textarea,
  .new-issue-field select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    font-family: inherit;
    font-size: 13px;
    color: #172b4d;
    background: #fff;
  }
  .new-issue-field textarea {
    min-height: 180px;
    resize: vertical;
    font-family: monospace;
  }
  .new-issue-field input:focus,
  .new-issue-field textarea:focus,
  .new-issue-field select:focus { outline: none; border-color: #0075ca; }
  .new-issue-create:not(:disabled) { cursor: pointer; }
  .epic-color-picker { display: flex; flex-wrap: wrap; gap: 6px; }
  .epic-swatch {
    width: 24px; height: 24px; padding: 0;
    border-radius: 6px; border: 2px solid transparent;
    cursor: pointer; box-sizing: border-box;
  }
  .epic-swatch.selected { border-color: #172b4d; box-shadow: 0 0 0 2px #fff inset; }
  .epic-swatch-auto {
    background: #f4f5f7; color: #6b778c;
    font-size: 11px; font-weight: 700; line-height: 1;
    border: 1px solid #d0d7de;
  }

  /* Listenansicht */
  .list-view {
    padding: 20px;
    --excerpt-w: 50%;
  }
  .list-view.resizing { cursor: col-resize; user-select: none; }
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
    flex: 0 0 var(--excerpt-w);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .list-resizer {
    align-self: stretch;
    width: 6px;
    flex-shrink: 0;
    cursor: col-resize;
    border-right: 2px solid #e8e8e8;
    transition: border-color .15s;
  }
  .list-row:hover .list-resizer { border-right-color: #c1c7d0; }
  .list-resizer:hover,
  .list-view.resizing .list-resizer { border-right-color: #0075ca; }
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

  /* Epics-Ansicht */
  .epics-view { padding: 20px; display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
  .epics-empty { color: #5e6c84; font-size: 14px; padding: 24px 4px; }
  .epic-card {
    background: #fff; border: 1px solid #dfe1e6; border-left: 4px solid #5e6c84;
    border-radius: 3px; padding: 14px 16px; cursor: pointer;
  }
  .epic-card:hover { border-color: #c1c7d0; box-shadow: 0 1px 3px rgba(9,30,66,.13); }
  .epic-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .epic-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .epic-code { font-size: 11px; font-weight: 700; letter-spacing: .4px; }
  .epic-name { font-size: 15px; font-weight: 600; color: #172b4d; }
  .epic-desc { font-size: 13px; color: #5e6c84; line-height: 1.5; margin-bottom: 10px; }
  .epic-progress { display: flex; align-items: center; gap: 10px; }
  .epic-progress-bar { flex: 1; height: 8px; background: #ebecf0; border-radius: 4px; overflow: hidden; }
  .epic-progress-fill { height: 100%; background: #5e6c84; border-radius: 4px; transition: width .2s; }
  .epic-progress-label { font-size: 12px; color: #5e6c84; white-space: nowrap; }

  /* Epic-Detailansicht */
  .epic-detail-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
  .epic-back {
    border: 1px solid #dfe1e6; background: #fff; color: #42526e; font-size: 13px;
    padding: 6px 12px; border-radius: 3px; cursor: pointer;
  }
  .epic-back:hover { background: #f4f5f7; }
  .epic-detail-title { display: flex; align-items: center; gap: 8px; flex: 1; }
  .epic-add-story { margin-left: auto; }
  .epic-mini-board { display: flex; gap: 10px; align-items: flex-start; }
  .epic-mini-col { flex: 1; min-width: 0; background: #f4f5f7; border-radius: 4px; padding: 8px; }
  .epic-mini-colhead {
    display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .4px; color: #5e6c84; padding: 2px 4px 8px;
  }
  .epic-mini-colhead .dot { width: 8px; height: 8px; border-radius: 50%; background: #97a0af; }
  .epic-mini-count { margin-left: auto; font-weight: 600; }
  .epic-mini-body { display: flex; flex-direction: column; gap: 6px; min-height: 8px; }
  .epic-mini-card {
    background: #fff; border: 1px solid #dfe1e6; border-radius: 3px; padding: 8px 10px;
    font-size: 13px; cursor: pointer; line-height: 1.4;
  }
  .epic-mini-card:hover { border-color: #c1c7d0; box-shadow: 0 1px 2px rgba(9,30,66,.13); }
  .epic-mini-card .card-id { color: #5e6c84; font-size: 12px; margin-right: 4px; }
  .epic-mini-card .card-title { color: #172b4d; }
  .epic-mini-col.col-ready .epic-mini-colhead .dot { background: #0747a6; }
  .epic-mini-col.col-in_progress .epic-mini-colhead .dot { background: #e4b400; }
  .epic-mini-col.col-in_review .epic-mini-colhead .dot { background: #d93f0b; }
  .epic-mini-col.col-done .epic-mini-colhead .dot { background: #0e8a16; }

  /* Epic-Badge auf Story-/Task-Karten (Board + Liste) */
  .card-epic {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px; border-radius: 10px;
    font-size: 10px; font-weight: 700; letter-spacing: .4px;
    width: fit-content;
  }
  .card-epic-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .card > .card-epic { margin: 10px 12px 0; }
  .list-epic { margin-right: 2px; vertical-align: middle; }
</style>
</head>
<body>

<header>
  <h1 id="board-title">claude-workflow-kit Board</h1>
  <span class="copyright" id="board-copyright"></span>
  <span class="version" id="board-version"></span>
  <span class="subtitle" id="board-subtitle">Lokaler Modus — Dateien in issues/</span>
  <div class="view-toggle">
    <button class="view-btn active" id="btn-board" onclick="switchView('board')">Board</button>
    <button class="view-btn" id="btn-list" onclick="switchView('list')">Liste</button>
    <button class="view-btn" id="btn-epics" onclick="switchView('epics')">Epics</button>
  </div>
  <button class="new-issue-btn" onclick="openNewIssueModal()">+ Neu</button>
</header>

<div class="board" id="board"></div>
<div class="list-view" id="list-view" style="display:none"></div>
<div class="epics-view" id="epics-view" style="display:none"></div>

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
    if (issue.type === "epic") continue; // Epics sind keine Board-Karten (E5)
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
      <div class="modal-meta">\${badgeHtml}<span>#\${escHtml(issue.id)}</span><button class="modal-edit-btn" type="button">Bearbeiten</button></div>
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

  // Bearbeiten
  window_.querySelector(".modal-edit-btn").addEventListener("click", () => {
    enterEditMode(window_, issue, mainBody);
  });

  // Schließen nur über × oder Escape — ein Klick neben das Modal schließt NICHT.
  // "Modal" heisst modal: kein versehentliches Zugehen bei Klick auf den Backdrop.
  window_.querySelector(".modal-close").addEventListener("click", closeModal);
  document.addEventListener("keydown", handleEsc);
}

function enterEditMode(window_, issue, mainBody) {
  // Overlay sperren: Backdrop-Klick und Escape schließen jetzt nicht mehr hart,
  // damit im Edit-Formular keine Eingaben verloren gehen.
  const overlay = window_.closest(".modal-overlay");
  if (overlay) {
    overlay.dataset.locked = "1";
    overlay._onCancel = cancelEdit;
  }

  const editBtn = window_.querySelector(".modal-edit-btn");
  if (editBtn) editBtn.style.display = "none";

  // Im Edit-Modus nur noch Speichern/Abbrechen — "×" ausblenden.
  const closeBtn = window_.querySelector(".modal-close");
  if (closeBtn) closeBtn.style.display = "none";

  function cancelEdit() {
    closeModal();
    openModal(issue);
  }

  const commentsEl = window_.querySelector(".modal-comments");
  const commentFormEl = window_.querySelector(".modal-comment-form");
  if (commentsEl) commentsEl.style.display = "none";
  if (commentFormEl) commentFormEl.style.display = "none";

  const bodyEl = window_.querySelector(".modal-body");
  bodyEl.innerHTML =
    \`<div class="new-issue-field">
      <label for="edit-issue-title">Titel</label>
      <input id="edit-issue-title" type="text">
    </div>
    <div class="new-issue-field">
      <label for="edit-issue-body">Beschreibung</label>
      <textarea id="edit-issue-body"></textarea>
    </div>
    <button class="modal-comment-send edit-save-btn">Speichern</button>
    <button class="modal-edit-cancel-btn" type="button">Abbrechen</button>\`;

  const titleInput = bodyEl.querySelector("#edit-issue-title");
  const bodyInput = bodyEl.querySelector("#edit-issue-body");
  titleInput.value = issue.title;
  bodyInput.value = mainBody;

  // Epics: Kuerzel + Farbe editierbar (per DOM eingefuegt, um verschachtelte Templates zu vermeiden).
  const isEpic = issue.type === "epic";
  let shortcodeInput = null;
  let getEpicColor = null;
  if (isEpic) {
    const field = document.createElement("div");
    field.className = "new-issue-field";
    field.innerHTML =
      '<label for="edit-issue-shortcode">Kürzel</label>' +
      '<input id="edit-issue-shortcode" type="text" maxlength="6" placeholder="leer = aus Titel">' +
      '<label style="margin-top:8px">Farbe</label>' +
      '<div class="epic-color-picker" id="edit-issue-color"></div>';
    titleInput.closest(".new-issue-field").after(field);
    shortcodeInput = field.querySelector("#edit-issue-shortcode");
    shortcodeInput.value = issue.shortcode || "";
    getEpicColor = buildColorPicker(field.querySelector("#edit-issue-color"), issue.color || "");
  }

  const saveBtn = bodyEl.querySelector(".edit-save-btn");
  saveBtn.addEventListener("click", async () => {
    const newTitle = titleInput.value.trim();
    if (!newTitle) return;
    saveBtn.disabled = true;
    const payload = { title: newTitle, body: bodyInput.value };
    if (isEpic) {
      payload.shortcode = shortcodeInput.value.trim();
      payload.color = getEpicColor();
    }
    const res = await fetch(\`/api/issues/\${issue.id}/edit\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Speichern fehlgeschlagen: " + (err.error || res.status));
      saveBtn.disabled = false;
      return;
    }
    closeModal();
    if (currentView === "list") loadList();
    else loadBoard();
  });

  bodyEl.querySelector(".modal-edit-cancel-btn").addEventListener("click", cancelEdit);

  titleInput.focus();
}

function handleEsc(e) {
  if (e.key !== "Escape") return;
  const overlay = document.querySelector(".modal-overlay");
  // Gesperrtes Formular: Escape wirkt als Abbrechen, nicht als harter Close.
  if (overlay && overlay.dataset.locked === "1") {
    if (typeof overlay._onCancel === "function") overlay._onCancel();
    return;
  }
  closeModal();
}

function closeModal() {
  const overlay = document.querySelector(".modal-overlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", handleEsc);
}

const NEW_ISSUE_TEMPLATE = "\\n## Kontext\\n\\n## Aufgabe\\n\\n## Akzeptanzkriterium\\n\\n## Abhaengigkeiten\\n";

async function openNewIssueModal(opts) {
  opts = opts || {};
  await loadEpicsMap();
  const epics = Object.values(epicsById);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const window_ = document.createElement("div");
  window_.className = "modal-window";
  window_.innerHTML =
    \`<div class="modal-header">
      <div class="modal-title">Neues Issue</div>
      <button class="modal-close" aria-label="Schliessen">×</button>
    </div>
    <div class="modal-body">
      <div class="new-issue-field">
        <label for="new-issue-type">Typ</label>
        <select id="new-issue-type">
          <option value="task">Task</option>
          <option value="story">Story</option>
          <option value="epic">Epic</option>
        </select>
      </div>
      <div class="new-issue-field" id="new-issue-parent-field">
        <label for="new-issue-parent">Epic</label>
        <select id="new-issue-parent"></select>
      </div>
      <div class="new-issue-field" id="new-issue-epic-fields" style="display:none">
        <label for="new-issue-shortcode">Kürzel</label>
        <input id="new-issue-shortcode" type="text" maxlength="6" placeholder="leer = aus Titel">
        <label style="margin-top:8px">Farbe</label>
        <div class="epic-color-picker" id="new-issue-color"></div>
      </div>
      <div class="new-issue-field">
        <label for="new-issue-title">Titel</label>
        <input id="new-issue-title" type="text" placeholder="Kurzer, praeziser Titel">
      </div>
      <div class="new-issue-field">
        <label for="new-issue-body">Beschreibung</label>
        <textarea id="new-issue-body"></textarea>
      </div>
      <button class="modal-comment-send new-issue-create" disabled>Anlegen</button>
      <button class="modal-edit-cancel-btn new-issue-cancel" type="button">Abbrechen</button>
    </div>\`;

  overlay.appendChild(window_);
  document.body.appendChild(overlay);

  // Formular-Modal: von Anfang an gesperrt, damit Backdrop/Escape den Entwurf nicht verwerfen.
  overlay.dataset.locked = "1";
  overlay._onCancel = closeModal;

  const typeSelect = window_.querySelector("#new-issue-type");
  const parentField = window_.querySelector("#new-issue-parent-field");
  const parentSelect = window_.querySelector("#new-issue-parent");
  const titleInput = window_.querySelector("#new-issue-title");
  const bodyInput = window_.querySelector("#new-issue-body");
  const createBtn = window_.querySelector(".new-issue-create");
  const epicFields = window_.querySelector("#new-issue-epic-fields");
  const shortcodeInput = window_.querySelector("#new-issue-shortcode");
  const getEpicColor = buildColorPicker(window_.querySelector("#new-issue-color"), "");
  bodyInput.value = NEW_ISSUE_TEMPLATE;

  parentSelect.innerHTML = '<option value="">(kein Epic)</option>' +
    epics.map(function (e) {
      return '<option value="' + escHtml(e.id) + '">' + escHtml(epicShortcode(e)) + ' – ' + escHtml(e.title) + '</option>';
    }).join('');

  typeSelect.value = opts.type || "task";
  if (opts.parent) parentSelect.value = opts.parent;

  function syncTypeFields() {
    // Epics haben keinen Parent (E4/E5), dafuer Kuerzel + Farbe.
    const isEpic = typeSelect.value === "epic";
    parentField.style.display = isEpic ? "none" : "";
    epicFields.style.display = isEpic ? "" : "none";
  }
  syncTypeFields();
  typeSelect.addEventListener("change", syncTypeFields);

  titleInput.addEventListener("input", () => {
    createBtn.disabled = !titleInput.value.trim();
  });

  createBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    createBtn.disabled = true;
    const type = typeSelect.value;
    const parent = type === "epic" ? "" : parentSelect.value;
    const payload = { title, body: bodyInput.value, type, parent };
    if (type === "epic") {
      payload.shortcode = shortcodeInput.value.trim();
      payload.color = getEpicColor();
    }
    const res = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Anlegen fehlgeschlagen: " + (err.error || res.status));
      createBtn.disabled = false;
      return;
    }
    closeModal();
    if (currentEpicDetail) openEpicDetail(currentEpicDetail);
    else if (currentView === "list") loadList();
    else if (currentView === "epics") loadEpics();
    else loadBoard();
  });

  titleInput.focus();
  // Schliessen nur ueber Abbrechen/Anlegen — "×" ausblenden, kein Backdrop-Schliessen.
  window_.querySelector(".modal-close").style.display = "none";
  window_.querySelector(".new-issue-cancel").addEventListener("click", closeModal);
  document.addEventListener("keydown", handleEsc);
}

function buildCard(issue) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = issue.id;

  const epic = issue.parent ? epicsById[issue.parent] : null;
  let badgeHtml = "";
  if (epic) {
    const c = epicColor(epic);
    card.style.borderLeft = "4px solid " + c;
    badgeHtml =
      '<div class="card-epic" style="color:' + c + ';background:color-mix(in srgb,' + c + ' 13%,#fff)">' +
        '<span class="card-epic-dot" style="background:' + c + '"></span>' + escHtml(epicShortcode(epic)) +
      '</div>';
  }

  card.innerHTML =
    badgeHtml +
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
  await loadEpicsMap();
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
  document.getElementById('epics-view').style.display = v === 'epics' ? '' : 'none';
  document.getElementById('btn-board').classList.toggle('active', v === 'board');
  document.getElementById('btn-list').classList.toggle('active', v === 'list');
  document.getElementById('btn-epics').classList.toggle('active', v === 'epics');
  if (v === 'list') loadList();
  if (v === 'epics') loadEpics();
}

// --- Epic-Zuordnung, Farbe, Kürzel ---
let epicsById = {};
// Feste Palette (mittel-kräftige Töne, Light Mode) für Epics ohne eigenes color-Feld.
const EPIC_PALETTE = ['#534AB7','#1D9E75','#D4537E','#185FA5','#BA7517','#993C1D','#0F6E56','#0C447C'];

function hashId(id) {
  let h = 0; const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function epicColor(epic) {
  if (!epic) return '#5e6c84';
  const c = (epic.color || '').trim();
  return c || EPIC_PALETTE[hashId(epic.id) % EPIC_PALETTE.length];
}
function epicShortcode(epic) {
  if (!epic) return '';
  const s = (epic.shortcode || '').trim();
  if (s) return s;
  const words = (epic.title || '').split(/\\s+/).filter(Boolean);
  const initials = words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return initials || 'EPIC';
}
// Baut eine Farb-Swatch-Auswahl (Palette + "automatisch") in container und liefert
// einen Getter, der den gewaehlten Farbwert zurueckgibt ('' = automatisch/Fallback).
function buildColorPicker(container, initial) {
  let selected = (initial || '').trim();
  container.innerHTML = '';
  const swatches = [];
  const options = [''].concat(EPIC_PALETTE);
  options.forEach(function (val) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'epic-swatch' + (val === selected ? ' selected' : '');
    if (val) { b.style.background = val; b.title = val; }
    else { b.classList.add('epic-swatch-auto'); b.textContent = 'A'; b.title = 'automatisch'; }
    b.addEventListener('click', function () {
      selected = val;
      swatches.forEach(function (s) { s.el.classList.toggle('selected', s.val === selected); });
    });
    container.appendChild(b);
    swatches.push({ el: b, val: val });
  });
  return function () { return selected; };
}
async function loadEpicsMap() {
  try {
    const res = await fetch('/api/epics');
    const epics = await res.json();
    epicsById = {};
    for (const e of epics) epicsById[e.id] = e;
  } catch (e) { epicsById = {}; }
}

// --- Epics-Ansicht ---
let currentEpicDetail = null;

async function loadEpics() {
  currentEpicDetail = null;
  const res = await fetch('/api/epics');
  const epics = await res.json();
  buildEpics(epics);
}

function buildEpics(epics) {
  const container = document.getElementById('epics-view');
  container.innerHTML = '';
  if (!epics.length) {
    const empty = document.createElement('div');
    empty.className = 'epics-empty';
    empty.textContent = 'Noch keine Epics. Lege über „+ Neu" ein Issue vom Typ Epic an.';
    container.appendChild(empty);
    return;
  }
  for (const epic of epics) {
    const total = epic.progress.total, done = epic.progress.done;
    const pct = total ? Math.round(done / total * 100) : 0;
    const color = epicColor(epic);
    const card = document.createElement('div');
    card.className = 'epic-card';
    card.style.borderLeftColor = color;
    const chip = '<span class="epic-code" style="color:' + escHtml(color) + '">' + escHtml(epicShortcode(epic)) + '</span>';
    card.innerHTML =
      '<div class="epic-card-head">' +
        '<span class="epic-dot" style="background:' + escHtml(color) + '"></span>' +
        chip +
        '<span class="epic-name">' + escHtml(epic.title) + '</span>' +
      '</div>' +
      '<div class="epic-desc">' + escHtml(bodyExcerpt(epic.body || '')) + '</div>' +
      '<div class="epic-progress">' +
        '<div class="epic-progress-bar"><div class="epic-progress-fill" style="width:' + pct + '%;background:' + escHtml(color) + '"></div></div>' +
        '<span class="epic-progress-label">' + done + '/' + total + ' Stories fertig</span>' +
      '</div>';
    card.addEventListener('click', () => openEpicDetail(epic));
    container.appendChild(card);
  }
}

async function openEpicDetail(epic) {
  currentEpicDetail = epic;
  const res = await fetch('/api/issues');
  const all = await res.json();
  const children = all.filter(i => i.type !== 'epic' && i.parent === epic.id);

  const container = document.getElementById('epics-view');
  container.innerHTML = '';
  const color = epicColor(epic);
  const codeHtml = '<span class="epic-code" style="color:' + escHtml(color) + '">' + escHtml(epicShortcode(epic)) + '</span>';

  const head = document.createElement('div');
  head.className = 'epic-detail-head';
  head.innerHTML =
    '<button class="epic-back" type="button">← Alle Epics</button>' +
    '<div class="epic-detail-title"><span class="epic-dot" style="background:' + escHtml(color) + '"></span>' + codeHtml +
      '<span class="epic-name">' + escHtml(epic.title) + '</span></div>' +
    '<button class="new-issue-btn epic-add-story" type="button">+ Neue Story</button>';
  container.appendChild(head);
  head.querySelector('.epic-back').addEventListener('click', () => loadEpics());
  head.querySelector('.epic-add-story').addEventListener('click', () => openNewIssueModal({ type: 'story', parent: epic.id }));

  if (!children.length) {
    const empty = document.createElement('div');
    empty.className = 'epics-empty';
    empty.textContent = 'Noch keine Stories in diesem Epic. Lege über „+ Neue Story“ eine an.';
    container.appendChild(empty);
    return;
  }

  const byStatus = {};
  for (const col of COLUMNS) byStatus[col.key] = [];
  for (const c of children) { (byStatus[c.status] || byStatus['backlog']).push(c); }

  const mini = document.createElement('div');
  mini.className = 'epic-mini-board';
  for (const col of COLUMNS) {
    const items = byStatus[col.key] || [];
    const colEl = document.createElement('div');
    colEl.className = 'epic-mini-col col-' + col.key;
    colEl.innerHTML = '<div class="epic-mini-colhead"><span class="dot"></span>' + col.label +
      ' <span class="epic-mini-count">' + items.length + '</span></div>';
    const bodyEl = document.createElement('div');
    bodyEl.className = 'epic-mini-body';
    for (const child of items) {
      const card = document.createElement('div');
      card.className = 'epic-mini-card';
      card.innerHTML = '<span class="card-id">#' + escHtml(child.id) + '</span> <span class="card-title">' + escHtml(child.title) + '</span>';
      card.addEventListener('click', () => openModal(child));
      bodyEl.appendChild(card);
    }
    colEl.appendChild(bodyEl);
    mini.appendChild(colEl);
  }
  container.appendChild(mini);
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
  return raw.replace(/\\n/g, ' ').replace(/#+\\s*/g, '').replace(/[*_\`]/g, '').trim().slice(0, 240);
}

function buildList(issues) {
  const container = document.getElementById('list-view');
  container.innerHTML = '';
  container.style.setProperty('--excerpt-w', storedExcerptWidth() + '%');

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

  // Gefiltertes + sortiertes Issue-Array (Epics sind keine Listen-Karten, E5)
  const visible = issues
    .filter(i => i.type !== 'epic' && activeFilters.has(i.status))
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
let listResizing = false;

const EXCERPT_WIDTH_KEY = 'stellwerk.listExcerptWidth';

function clampExcerptWidth(pct) {
  return Math.min(75, Math.max(25, pct));
}

function storedExcerptWidth() {
  const v = parseFloat(localStorage.getItem(EXCERPT_WIDTH_KEY));
  return isNaN(v) ? 50 : clampExcerptWidth(v);
}

function startListResize() {
  const container = document.getElementById('list-view');
  listResizing = true;
  container.classList.add('resizing');
  const onMove = (e) => {
    const rect = container.getBoundingClientRect();
    const pct = clampExcerptWidth(((rect.right - e.clientX) / rect.width) * 100);
    container.style.setProperty('--excerpt-w', pct + '%');
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    container.classList.remove('resizing');
    const current = parseFloat(container.style.getPropertyValue('--excerpt-w'));
    localStorage.setItem(EXCERPT_WIDTH_KEY, String(isNaN(current) ? 50 : current));
    // Flag erst nach dem Click-Event zuruecksetzen, damit kein Modal aufgeht
    setTimeout(() => { listResizing = false; }, 0);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function buildListRow(issue) {
  const row = document.createElement('div');
  row.className = 'list-row';
  row.dataset.id = issue.id;
  const isArchived = issue.status === 'archived';

  const badge = STATUS_BADGE[issue.status] || { bg: '#e0e0e0', color: '#444', label: issue.status };
  const badgeEl = \`<span class="modal-badge list-badge" style="background:\${badge.bg};color:\${badge.color}">\${badge.label}</span>\`;

  const epic = issue.parent ? epicsById[issue.parent] : null;
  let epicEl = '';
  if (epic) {
    const c = epicColor(epic);
    row.style.borderLeft = '3px solid ' + c;
    epicEl = '<span class="list-epic card-epic" style="color:' + c + ';background:color-mix(in srgb,' + c + ' 13%,#fff)">' +
      '<span class="card-epic-dot" style="background:' + c + '"></span>' + escHtml(epicShortcode(epic)) + '</span>';
  }

  row.innerHTML =
    \`<span class="list-handle\${isArchived ? ' disabled' : ''}" title="Reihenfolge ändern">⠿</span>
     <span class="list-id">#\${escHtml(issue.id)}</span>
     \${badgeEl}\${epicEl}
     <span class="list-title">\${escHtml(issue.title)}</span>
     <span class="list-resizer" title="Spaltenbreite ziehen"></span>
     <span class="list-excerpt">\${escHtml(bodyExcerpt(issue.body || ''))}</span>\`;

  const resizer = row.querySelector('.list-resizer');
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startListResize();
  });
  resizer.addEventListener('click', (e) => e.stopPropagation());

  if (!isArchived) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      if (listResizing) { e.preventDefault(); return; }
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
  await loadEpicsMap();
  const [res, archRes] = await Promise.all([
    fetch('/api/issues'),
    activeFilters.has('archived') ? fetch('/api/issues?archive=1') : Promise.resolve(null),
  ]);
  const issues = await res.json();
  const archived = archRes ? await archRes.json() : [];
  listAllIssues = [...issues, ...archived];
  buildList(listAllIssues);
}

// --- Auto-Refresh: pollt /api/state und laedt die aktuelle Ansicht neu, wenn sich
// der issues/-Ordner extern geaendert hat (z.B. board.mjs verschiebt ein Issue).
let pollLastSig = null;
let pollPending = false;
let pollTimer = null;
let dragActive = false;
document.addEventListener('dragstart', function () { dragActive = true; });
document.addEventListener('dragend', function () { dragActive = false; });

function pollIsIdle() {
  // Kein Reload waehrend ein Modal offen ist oder ein Drag laeuft.
  return !document.querySelector('.modal-overlay') && !dragActive;
}
function pollRefreshView() {
  if (currentEpicDetail) return openEpicDetail(currentEpicDetail);
  if (currentView === 'list') return loadList();
  if (currentView === 'epics') return loadEpics();
  return loadBoard();
}
async function pollState() {
  let sig;
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    sig = (await res.json()).sig;
  } catch (e) { return; }
  if (pollLastSig === null) { pollLastSig = sig; return; }
  if (sig !== pollLastSig) { pollLastSig = sig; pollPending = true; }
  // Geaenderte Signatur nur anwenden, wenn idle — sonst gemerkt lassen und spaeter nachholen.
  if (pollPending && pollIsIdle()) {
    pollPending = false;
    await pollRefreshView();
  }
}
function pollStart() {
  if (pollTimer) return;
  pollTimer = setInterval(pollState, 3000);
}
function pollStop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
document.addEventListener('visibilitychange', function () {
  // Bei verstecktem Tab pausieren, bei Rueckkehr sofort refreshen.
  if (document.hidden) pollStop();
  else { pollStart(); pollState(); }
});

async function init() {
  document.getElementById("board-copyright").textContent =
    "© " + new Date().getFullYear() + " Manfred Wolff";
  const res = await fetch("/api/config");
  const cfg = await res.json();
  if (cfg.columns && cfg.columns.length) COLUMNS = cfg.columns;
  if (cfg.boardName) {
    const title = cfg.boardName + " Board";
    document.getElementById("board-title").textContent = title;
    document.title = title;
  }
  if (cfg.root) {
    document.getElementById("board-subtitle").textContent =
      "Lokaler Modus — Dateien in issues/ — " + cfg.root;
  }
  if (cfg.version) {
    document.getElementById("board-version").textContent = "v" + cfg.version;
  }
  await loadBoard();
  await pollState(); // Signatur seeden (erster Aufruf laedt nicht neu)
  pollStart();
}

init();
</script>
</body>
</html>`;

// --- Start ---

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const issuesDir = resolve(config.local?.issuesDir || "issues");
// Vorrang: config.local.uiPort (workflow.config.json) > --port > Default 3000.
const port = config.local?.uiPort ?? args.port ?? 3000;

const server = createServer((req, res) => {
  try {
    handleRequest(req, res, issuesDir);
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
});

const logArchiveError = (e) => process.stderr.write(`Archivierung fehlgeschlagen: ${e.message}\n`);
archiveOldIssues(issuesDir).catch(logArchiveError);
setInterval(() => archiveOldIssues(issuesDir).catch(logArchiveError), 60 * 60 * 1000);

server.listen(port, () => {
  console.log(`Board läuft auf http://localhost:${port}`);
  console.log(`Issues-Verzeichnis: ${issuesDir}`);
});
