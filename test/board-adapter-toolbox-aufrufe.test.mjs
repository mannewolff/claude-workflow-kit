// Tests fuer die Zahl der Board-Aufrufe der lesenden Einzelkarten-Methoden des
// Toolbox-Adapters (Issue #1650, Plan #1638).
//
// `getIssue`, `kommentareStreng` und `listActivity` loesen die Kartennummer ueber den
// Einzelabruf `GET /api/kanban/items/by-number/{n}` auf statt ueber die ganze Kartenliste
// (E1). Die Attrappe schreibt jeden Request mit; so laesst sich zeigen, welche Routen ein
// Aufruf beruehrt. Eine archivierte Karte und ein 404 vom Einzelabruf melden dasselbe wie
// eine fehlende Nummer (E5, E6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { resolveTracker } from "../kit/board/adapter.mjs";
import { BoardError, loadConfig } from "../kit/board/grundlagen.mjs";
import { setupProjekt, starteServer, imProjekt } from "./helpers/adapter-fixture.mjs";

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

async function mitBoard(antwort, fn) {
  const { server, requests, host } = await starteServer(antwort);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-toolbox-aufrufe-");
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

/** Je Aufruf ein frischer Adapter: keine Zuordnung aus einem vorigen Aufruf. */
function amBoard(dir, aufruf) {
  return imProjekt(dir, () => aufruf(resolveTracker(loadConfig())), MIT_TOKEN);
}

async function wirftIssueFehlt(versprechen, nummer) {
  await assert.rejects(versprechen, (e) => {
    assert.ok(e instanceof BoardError, `BoardError erwartet, bekam ${e?.name}: ${e?.message}`);
    assert.match(e.message, new RegExp(`Issue ${nummer} (nicht gefunden|not found)`));
    return true;
  });
}

/** Detailantwort fuer Karte 42 (interne ID 4200), wahlweise archiviert. */
function einzelabruf({ archived = false } = {}) {
  return (req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items/by-number/42") {
      return { status: 200, json: {
        item: { id: 4200, number: 42, title: "Karte", body: "Text", column: "READY", labels: [], type: "task" },
        archived, createdAt: "2026-10-01T08:00:00Z", movedToDoneAt: null,
        comments: [{ id: 1, author: "kit", body: "Hallo", createdAt: "2026-10-02T08:00:00Z" }],
      } };
    }
    if (req.method === "GET" && req.url === "/api/kanban/items/4200/activity") return { status: 200, json: [] };
    return null;
  };
}

const LESENDE = {
  getIssue: (t) => t.getIssue(42),
  kommentareStreng: (t) => t.kommentareStreng(42),
  listActivity: (t) => t.listActivity(42),
};

test("getIssue braucht genau einen Aufruf", async () => {
  await mitBoard(einzelabruf(), async (dir, requests) => {
    const karte = await amBoard(dir, (t) => t.getIssue(42));
    assert.equal(karte.id, "42");
    assert.equal(karte.status, "ready");
    assert.equal(karte.comments.length, 1);
    assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ["GET /api/kanban/items/by-number/42"]);
  });
});

test("Archivierte Karte gilt als nicht gefunden", async () => {
  for (const [name, aufruf] of Object.entries(LESENDE)) {
    await mitBoard(einzelabruf({ archived: true }), async (dir, requests) => {
      await wirftIssueFehlt(amBoard(dir, aufruf), 42);
      assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ["GET /api/kanban/items/by-number/42"], name);
    });
  }
});

test("404 vom Einzelabruf meldet die fehlende Karte", async () => {
  for (const [name, aufruf] of Object.entries(LESENDE)) {
    await mitBoard(() => null, async (dir, requests) => {
      await wirftIssueFehlt(amBoard(dir, aufruf), 42);
      assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ["GET /api/kanban/items/by-number/42"], name);
    });
  }
});
