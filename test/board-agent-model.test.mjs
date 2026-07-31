// Tests fuer die Modell-Selbstauskunft des Board-Adapters (Issue #193).
// Ist KIT_AGENT_MODEL gesetzt (der Nacht-Runner setzt es auf den Wert von --model),
// haengt der Toolbox-/kanbancompat-Adapter den Header X-Agent-Model an jeden Request.
// Ohne die Variable bleibt der Header weg — interaktive Sessions machen keine Angabe.
// Zwei Ebenen: die reine Header-Funktion, und ein echter Request gegen einen lokalen
// Stub-Server (Beweis, dass die Funktion auch verdrahtet ist).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { agentModelHeader } from "../kit/board.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("agentModelHeader: gesetzte Variable wird zum X-Agent-Model-Header", () => {
  assert.deepEqual(agentModelHeader({ KIT_AGENT_MODEL: "claude-opus-5" }), { "X-Agent-Model": "claude-opus-5" });
});

test("agentModelHeader: ohne Variable kein Header", () => {
  assert.deepEqual(agentModelHeader({}), {});
});

test("agentModelHeader: leer oder nur Leerzeichen zaehlt als nicht gesetzt", () => {
  assert.deepEqual(agentModelHeader({ KIT_AGENT_MODEL: "" }), {});
  assert.deepEqual(agentModelHeader({ KIT_AGENT_MODEL: "   " }), {});
});

// --- Echter Request gegen einen Stub-Server ---

// Nimmt die Header des ersten /api/kanban/items-Requests entgegen und antwortet
// mit einem leeren, gruppierten Board (die Form, die _boardItems erwartet).
function startStub() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ BACKLOG: [] }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, requests, host: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function setupProjekt(host) {
  const dir = mkdtempSync(join(tmpdir(), "board-agent-model-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "toolbox", toolbox: { host },
  }, null, 2));
  return dir;
}

// Bewusst asynchron: Der Stub-Server laeuft im selben Prozess wie der Test. Ein
// spawnSync wuerde dessen Event-Loop blockieren, der Request nie bedient werden.
const execFileAsync = promisify(execFile);

async function listIssues(dir, extraEnv = {}) {
  const env = { ...process.env };
  // Eine geerbte Variable wuerde den Ohne-Header-Fall verfaelschen.
  delete env.KIT_AGENT_MODEL;
  Object.assign(env, { TBX_TOKEN: "test-token" }, extraEnv);
  return execFileAsync(process.execPath, [join(dir, ".claude", "kit", "board.mjs"), "issue", "list"], { cwd: dir, env });
}

test("Request mit KIT_AGENT_MODEL traegt X-Agent-Model, ohne die Variable nicht", async () => {
  const { server, requests, host } = await startStub();
  const dir = setupProjekt(host);
  try {
    await listIssues(dir, { KIT_AGENT_MODEL: "claude-opus-5" });
    await listIssues(dir);

    assert.equal(requests.length, 2, "es haetten genau zwei Requests ankommen muessen");
    assert.equal(requests[0].headers["x-agent-model"], "claude-opus-5",
      "Modell-Angabe fehlt im Request der Nacht-Session");
    assert.equal(requests[0].headers["x-kanban-token"], "test-token",
      "der Token-Header darf durch die Ergaenzung nicht verloren gehen");
    assert.equal(requests[1].headers["x-agent-model"], undefined,
      "ohne KIT_AGENT_MODEL darf kein X-Agent-Model gesendet werden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});
