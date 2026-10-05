// Tests fuer die Modell-Selbstauskunft des Board-Adapters (Issue #193).
// Ist KIT_AGENT_MODEL gesetzt (der Nacht-Runner setzt es auf den Wert von --model),
// haengt der Toolbox-/kanbancompat-Adapter den Header X-Agent-Model an jeden Request.
// Ohne die Variable bleibt der Header weg — interaktive Sessions machen keine Angabe.
// Zwei Ebenen: die reine Header-Funktion, und ein echter Request gegen einen lokalen
// Stub-Server (Beweis, dass die Funktion auch verdrahtet ist). Beide im selben Prozess gegen
// den Board-Teil kit/board/adapter.mjs (Issue #1217, Plan #1199, E6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { agentModelHeader, resolveTracker } from "../kit/board/adapter.mjs";
import { setupProjekt, starteServer, imProjekt } from "./helpers/adapter-fixture.mjs";

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

// Ein leeres, gruppiertes Board (die Form, die _boardItems erwartet).
const LEERES_BOARD = () => ({ status: 200, json: { BACKLOG: [] } });

// `issue list` ruft im Dispatch `listIssues` des Trackers. KIT_AGENT_MODEL setzt
// `imProjekt` auf den Wert des Fixtures; `undefined` nimmt die Variable heraus, damit
// eine geerbte den Ohne-Header-Fall nicht verfaelscht.
function listIssues(dir, host, agentModell) {
  return imProjekt(dir, () => resolveTracker({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }).listIssues(),
    { TBX_TOKEN: "test-token", KIT_AGENT_MODEL: agentModell });
}

test("Request mit KIT_AGENT_MODEL traegt X-Agent-Model, ohne die Variable nicht", async () => {
  const { server, requests, host } = await starteServer(LEERES_BOARD);
  const dir = setupProjekt(null, "board-agent-model-");
  try {
    await listIssues(dir, host, "claude-opus-5");
    await listIssues(dir, host, undefined);

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
