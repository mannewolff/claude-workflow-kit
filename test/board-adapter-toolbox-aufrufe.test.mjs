// Tests fuer die Zahl der Board-Aufrufe der Einzelkarten-Methoden des Toolbox-Adapters
// (Issue #1650 lesend, Issue #1651 schreibend, Plan #1638).
//
// Lesende, schreibende Methoden und `moveIssue` loesen die Kartennummer ueber den
// Einzelabruf `GET /api/kanban/items/by-number/{n}` auf statt ueber die ganze Kartenliste
// (E1); eine zweite Methode auf derselben Karte nimmt die Zuordnung (E2). Die Attrappe schreibt jeden Request mit; so laesst sich zeigen, welche Routen ein
// Aufruf beruehrt. Eine archivierte Karte und ein 404 vom Einzelabruf melden dasselbe wie
// eine fehlende Nummer (E5, E6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { LabelFehltError, resolveTracker } from "../kit/board/adapter.mjs";
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

/** Detailantwort fuer Karte 42 (interne ID 4200), wahlweise archiviert; Schreibrouten antworten leer. */
function einzelabruf({ archived = false, body = () => "Text" } = {}) {
  return (req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items/by-number/42") {
      return { status: 200, json: {
        item: { id: 4200, number: 42, title: "Karte", body: body(), column: "READY", position: 3, labels: [], type: "task" },
        archived, createdAt: "2026-10-01T08:00:00Z", movedToDoneAt: null,
        comments: [{ id: 1, author: "kit", body: "Hallo", createdAt: "2026-10-02T08:00:00Z" }],
      } };
    }
    if (req.method === "GET" && req.url === "/api/kanban/items/4200/activity") return { status: 200, json: [] };
    if (req.method !== "GET" && req.url.startsWith("/api/kanban/items/4200")) return { status: 200, json: {} };
    return null;
  };
}

/**
 * Karte 42 mit veraenderlichem Stand (Issue #1668): `zustand.title` benennt um,
 * `zustand.vorhanden = false` entfernt sie; die Label-Route kennt nur `zustand.labels`
 * und antwortet sonst wie das Backend mit 404 — auch fuer eine fehlende Karte.
 */
function veraenderlich(zustand) {
  return (req, koerper) => {
    if (!zustand.vorhanden) return null;
    if (req.method === "GET" && req.url === "/api/kanban/items/by-number/42") {
      return { status: 200, json: {
        item: { id: 4200, number: 42, title: zustand.title, body: "Text", column: "READY", position: 3, labels: [], type: "task" },
        archived: false, comments: [],
      } };
    }
    if (req.method === "POST" && req.url === "/api/kanban/items/4200/labels") {
      return zustand.labels.includes(JSON.parse(koerper).name) ? { status: 200, json: {} } : null;
    }
    if (req.method !== "GET" && req.url.startsWith("/api/kanban/items/4200")) return { status: 200, json: {} };
    return null;
  };
}

/** Requests als `METHODE url`. */
const zeilen = (requests) => requests.map((r) => `${r.method} ${r.url}`);

const LESENDE = {
  getIssue: (t) => t.getIssue(42),
  kommentareStreng: (t) => t.kommentareStreng(42),
  listActivity: (t) => t.listActivity(42),
};

/** Je schreibende Methode der Aufruf und der Schreibaufruf, den er absetzt. */
const SCHREIBENDE = {
  commentIssue: [(t) => t.commentIssue(42, "Hallo"), "POST /api/kanban/items/4200/comments"],
  labelIssue: [(t) => t.labelIssue(42, "kit:clarify", "add"), "POST /api/kanban/items/4200/labels"],
  updateIssue: [(t) => t.updateIssue(42, { body: "Neu" }), "PUT /api/kanban/items/4200"],
  ersetzeKommentar: [(t) => t.ersetzeKommentar(42, 7, "Neu"), "PATCH /api/kanban/items/4200/comments/7"],
  moveIssue: [(t) => t.moveIssue(42, "in_review"), "PUT /api/kanban/items/4200/move"],
};

const FEHLSCHLAG = {
  ...LESENDE,
  ...Object.fromEntries(Object.entries(SCHREIBENDE).map(([name, [aufruf]]) => [name, aufruf])),
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

test("Schreibende Einzelkarten-Methoden rufen die Kartenliste nicht", async () => {
  for (const [name, [aufruf, schreib]] of Object.entries(SCHREIBENDE)) {
    await mitBoard(einzelabruf(), async (dir, requests) => {
      await amBoard(dir, aufruf);
      assert.deepEqual(zeilen(requests), ["GET /api/kanban/items/by-number/42", schreib], name);
    });
  }
});

test("Zweite Methode auf derselben Karte nutzt die Zuordnung", async () => {
  await mitBoard(einzelabruf(), async (dir, requests) => {
    await amBoard(dir, async (t) => {
      await t.commentIssue(42, "Hallo");
      await t.labelIssue(42, "kit:clarify", "add");
      await t.updateIssue(42, { body: "Neu" });
    });
    // updateIssue liest frisch, damit es keinen alten Titel zurueckschreibt (Issue #1668).
    assert.deepEqual(zeilen(requests), [
      "GET /api/kanban/items/by-number/42",
      "POST /api/kanban/items/4200/comments",
      "POST /api/kanban/items/4200/labels",
      "GET /api/kanban/items/by-number/42",
      "PUT /api/kanban/items/4200",
    ]);
    assert.equal(JSON.parse(requests[4].body).title, "Karte");
  });
});

test("Zweite Methode auf derselben Karte nutzt die Zuordnung, eine zweite Instanz nicht", async () => {
  await mitBoard(einzelabruf(), async (dir, requests) => {
    await amBoard(dir, async (t) => {
      await t.getIssue(42);
      await t.listActivity(42);
    });
    assert.deepEqual(zeilen(requests), [
      "GET /api/kanban/items/by-number/42",
      "GET /api/kanban/items/4200/activity",
    ]);
    // Die Zuordnung gilt je Instanz: Ein frischer Adapter holt die Karte selbst.
    await amBoard(dir, (t) => t.listActivity(42));
    assert.deepEqual(zeilen(requests).slice(2), [
      "GET /api/kanban/items/by-number/42",
      "GET /api/kanban/items/4200/activity",
    ]);
  });
});

test("getIssue nach einer Änderung liest frisch", async () => {
  let stand = "Alt";
  const antwort = einzelabruf({ body: () => stand });
  await mitBoard((req) => {
    if (req.method === "PUT" && req.url === "/api/kanban/items/4200") stand = "Neu";
    return antwort(req);
  }, async (dir, requests) => {
    const karte = await amBoard(dir, async (t) => {
      await t.getIssue(42);
      await t.updateIssue(42, { body: "Neu" });
      return t.getIssue(42);
    });
    assert.equal(karte.body, "Neu");
    assert.deepEqual(zeilen(requests), [
      "GET /api/kanban/items/by-number/42",
      "GET /api/kanban/items/by-number/42",
      "PUT /api/kanban/items/4200",
      "GET /api/kanban/items/by-number/42",
    ]);
  });
});

test("moveIssue verschiebt ohne Kartenliste", async () => {
  for (const [ziel, position] of [["ready", 3], ["in_review", 2147483647]]) {
    await mitBoard(einzelabruf(), async (dir, requests) => {
      await amBoard(dir, async (t) => {
        await t.commentIssue(42, "Hallo");
        await t.moveIssue(42, ziel);
      });
      // moveIssue liest frisch, auch wenn die Zuordnung die Karte schon kennt (E2).
      assert.deepEqual(zeilen(requests), [
        "GET /api/kanban/items/by-number/42",
        "POST /api/kanban/items/4200/comments",
        "GET /api/kanban/items/by-number/42",
        "PUT /api/kanban/items/4200/move",
      ], ziel);
      assert.deepEqual(JSON.parse(requests[3].body).position, position, ziel);
    });
  }
});

test("Archivierte Karte gilt als nicht gefunden", async () => {
  for (const [name, aufruf] of Object.entries(FEHLSCHLAG)) {
    await mitBoard(einzelabruf({ archived: true }), async (dir, requests) => {
      await wirftIssueFehlt(amBoard(dir, aufruf), 42);
      assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ["GET /api/kanban/items/by-number/42"], name);
    });
  }
});

test("404 vom Einzelabruf meldet die fehlende Karte", async () => {
  // Auch labelIssue meldet `issueFehlt`: Die fehlende Karte ist keine fehlende Label-Definition.
  for (const [name, aufruf] of Object.entries(FEHLSCHLAG)) {
    await mitBoard(() => null, async (dir, requests) => {
      await wirftIssueFehlt(amBoard(dir, aufruf), 42);
      assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ["GET /api/kanban/items/by-number/42"], name);
    });
  }
});

test("updateIssue schreibt einen zwischendurch geänderten Titel nicht zurück", async () => {
  const zustand = { vorhanden: true, title: "Alt", labels: [] };
  await mitBoard(veraenderlich(zustand), async (dir, requests) => {
    await amBoard(dir, async (t) => {
      await t.getIssue(42);
      zustand.title = "Neu";
      await t.updateIssue(42, { body: "Text 2" });
    });
    const put = requests.find((r) => r.method === "PUT" && r.url === "/api/kanban/items/4200");
    assert.deepEqual(JSON.parse(put.body), { title: "Neu", body: "Text 2" });
  });
});

test("Eine fehlende Karte fällt aus der Zuordnung", async () => {
  const zustand = { vorhanden: true, title: "Karte", labels: ["kit:clarify"] };
  await mitBoard(veraenderlich(zustand), async (dir, requests) => {
    await amBoard(dir, async (t) => {
      await t.getIssue(42);
      zustand.vorhanden = false;
      await wirftIssueFehlt(t.getIssue(42), 42);
      await wirftIssueFehlt(t.labelIssue(42, "kit:clarify", "add"), 42);
    });
    // Der Eintrag ist weg: labelIssue holt die Karte selbst, statt die Label-Route zu fragen.
    assert.deepEqual(zeilen(requests), [
      "GET /api/kanban/items/by-number/42",
      "GET /api/kanban/items/by-number/42",
      "GET /api/kanban/items/by-number/42",
    ]);
  });
});

test("Label-404 einer Karte aus der Zuordnung, die inzwischen fehlt, meldet die fehlende Karte", async () => {
  const zustand = { vorhanden: true, title: "Karte", labels: ["kit:clarify"] };
  await mitBoard(veraenderlich(zustand), async (dir, requests) => {
    await amBoard(dir, async (t) => {
      await t.getIssue(42);
      zustand.vorhanden = false;
      await wirftIssueFehlt(t.labelIssue(42, "kit:clarify", "add"), 42);
    });
    assert.deepEqual(zeilen(requests), [
      "GET /api/kanban/items/by-number/42",
      "POST /api/kanban/items/4200/labels",
      "GET /api/kanban/items/by-number/42",
    ]);
  });
});

test("Label-404 bei vorhandener Karte bleibt fehlendes Label", async () => {
  const zustand = { vorhanden: true, title: "Karte", labels: [] };
  await mitBoard(veraenderlich(zustand), async (dir, requests) => {
    await amBoard(dir, async (t) => {
      await t.getIssue(42);
      await assert.rejects(t.labelIssue(42, "kit:unbekannt", "add"), LabelFehltError);
    });
    assert.deepEqual(zeilen(requests), [
      "GET /api/kanban/items/by-number/42",
      "POST /api/kanban/items/4200/labels",
      "GET /api/kanban/items/by-number/42",
    ]);
  });
});
