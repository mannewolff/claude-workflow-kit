// Tests fuer die drei lesenden Archiv-Aufrufe des Toolbox-Adapters (Issue #1538, Plan #1534).
//
// Suche, Einzelabruf nach Nummer und Herkunftskette laufen gegen eine lokale
// Server-Attrappe auf 127.0.0.1, nach dem Muster von board-adapter-toolbox.test.mjs.
// Die Antwortformen folgen kanban-kit, docs/dogfooding.md, Abschnitt „Archivierte Karten:
// Nummer, Suche, Herkunftskette“. Ob die echte Instanz dieselben Feldnamen liefert, ist
// ein manueller Pruefpunkt an Issue #1538 — die Attrappe belegt nur, dass der Adapter die
// dokumentierte Form verarbeitet.
//
// Das kurze Budget kommt ueber KIT_TOOLBOX_BUDGET_MS aus `imProjekt`: Es bleibt bei einem
// Versuch, auch gegen eine Attrappe, die mit 500 antwortet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { resolveTracker } from "../kit/board/adapter.mjs";
import { BoardError, loadConfig } from "../kit/board/grundlagen.mjs";
import { setupProjekt, starteServer, imProjekt } from "./helpers/adapter-fixture.mjs";

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

async function mitBoard(antwort, fn) {
  const { server, requests, host } = await starteServer(antwort);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-toolbox-vg-");
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

function amBoard(dir, aufruf, extraEnv = MIT_TOKEN) {
  return imProjekt(dir, () => aufruf(resolveTracker(loadConfig())), extraEnv);
}

async function wirftBoardError(versprechen, muster) {
  await assert.rejects(versprechen, (e) => {
    assert.ok(e instanceof BoardError, `BoardError erwartet, bekam ${e?.name}: ${e?.message}`);
    assert.match(e.message, muster);
    return true;
  });
}

function treffer(number, archived = false) {
  return {
    id: number * 100, number, title: `[Fachlich] Karte ${number}`, kind: "FACHLICH",
    column: "DONE", archived, createdAt: "2026-10-01T08:00:00Z", movedToDoneAt: null,
    excerpt: { text: "… Archiv …", source: "BODY", commentId: null },
  };
}

/** Pfad und Query einer mitgeschriebenen Anfrage-URL. */
function zerlege(url) {
  const [pfad, query = ""] = url.split("?");
  return { pathname: pfad, searchParams: new URLSearchParams(query) };
}

/** Suche in zwei Teilen: erst 1415 und 1403, dann ueber `nextCursor` 1390. */
function sucheInZweiTeilen(req) {
  const url = zerlege(req.url);
  if (url.pathname !== "/api/kanban/search") return null;
  if (!url.searchParams.get("cursor")) {
    return { status: 200, json: { hits: [treffer(1415, true), treffer(1403)], nextCursor: "1403" } };
  }
  if (url.searchParams.get("cursor") === "1403") {
    return { status: 200, json: { hits: [treffer(1390, true)], nextCursor: null } };
  }
  return null;
}

// --- Suche ---

test("sucheFachplaene liest ueber nextCursor in Teilen weiter und fragt ohne kind", async () => {
  await mitBoard(sucheInZweiTeilen, async (dir, requests) => {
    const ergebnis = await amBoard(dir, (t) => t.sucheFachplaene("Archiv lesen", { limit: 10 }));
    assert.deepEqual(ergebnis, {
      treffer: [
        { nummer: 1415, titel: "[Fachlich] Karte 1415", archiviert: true },
        { nummer: 1403, titel: "[Fachlich] Karte 1403", archiviert: false },
        { nummer: 1390, titel: "[Fachlich] Karte 1390", archiviert: true },
      ],
      mehr: false,
    });
    assert.equal(requests.length, 2);
    const erste = zerlege(requests[0].url);
    assert.equal(erste.pathname, "/api/kanban/search");
    assert.equal(erste.searchParams.get("q"), "Archiv lesen");
    assert.equal(erste.searchParams.has("kind"), false, "E8: ohne kind-Parameter");
    assert.equal(erste.searchParams.has("cursor"), false);
    const zweite = zerlege(requests[1].url);
    assert.equal(zweite.searchParams.get("cursor"), "1403");
    assert.equal(zweite.searchParams.get("q"), "Archiv lesen");
    assert.equal(requests[0].headers["x-kanban-token"], "test-token");
  });
});

test("sucheFachplaene schneidet bei limit ab, setzt mehr und holt keinen weiteren Teil", async () => {
  await mitBoard(sucheInZweiTeilen, async (dir, requests) => {
    const ergebnis = await amBoard(dir, (t) => t.sucheFachplaene("Archiv", { limit: 1 }));
    assert.deepEqual(ergebnis, {
      treffer: [{ nummer: 1415, titel: "[Fachlich] Karte 1415", archiviert: true }],
      mehr: true,
    });
    assert.equal(requests.length, 1);
  });
});

test("sucheFachplaene setzt mehr, wenn limit genau am Ende eines Teils mit nextCursor endet", async () => {
  await mitBoard(sucheInZweiTeilen, async (dir, requests) => {
    const ergebnis = await amBoard(dir, (t) => t.sucheFachplaene("Archiv", { limit: 2 }));
    assert.equal(ergebnis.treffer.length, 2);
    assert.equal(ergebnis.mehr, true);
    assert.equal(requests.length, 1);
  });
});

test("sucheFachplaene: limit genau so gross wie alle Treffer setzt mehr nicht", async () => {
  await mitBoard(sucheInZweiTeilen, async (dir) => {
    const ergebnis = await amBoard(dir, (t) => t.sucheFachplaene("Archiv", { limit: 3 }));
    assert.equal(ergebnis.treffer.length, 3);
    assert.equal(ergebnis.mehr, false);
  });
});

// --- Einzelabruf ---

test("karteNachNummer liefert Body und archiviert: true", async () => {
  const antwort = (req) => req.url === "/api/kanban/items/by-number/1415"
    ? { status: 200, json: {
      item: { id: 9123, number: 1415, title: "[Fachlich] Vorgeschichte", body: "## Ziel\nFrühere Fachpläne", column: "DONE", labels: [], derivedFrom: null },
      archived: true, createdAt: "2026-10-01T08:00:00Z", movedToDoneAt: null, comments: [],
    } }
    : null;
  await mitBoard(antwort, async (dir) => {
    const karte = await amBoard(dir, (t) => t.karteNachNummer(1415));
    assert.deepEqual(karte, { nummer: 1415, titel: "[Fachlich] Vorgeschichte", body: "## Ziel\nFrühere Fachpläne", archiviert: true });
  });
});

test("karteNachNummer liefert bei HTTP 404 null", async () => {
  await mitBoard(() => ({ status: 404, json: { message: "Karte nicht gefunden" } }), async (dir, requests) => {
    assert.equal(await amBoard(dir, (t) => t.karteNachNummer(999)), null);
    assert.equal(requests[0].url, "/api/kanban/items/by-number/999");
  });
});

// --- Herkunftskette ---

test("herkunftskette liefert die Glieder in Server-Reihenfolge, eine Luecke bleibt erkennbar", async () => {
  const antwort = (req) => req.url === "/api/kanban/items/by-number/1577/lineage"
    ? { status: 200, json: {
      card: { number: 1577, title: "Archivierte Karte abrufen", kind: "ARBEITSPAKET", column: "in_review", archived: false, depth: 0, gap: false },
      ancestors: [
        { number: 1574, title: null, kind: null, column: null, archived: false, depth: 1, gap: true },
        { number: 1571, title: "[Fachlich] Archivierte Karten lesbar", kind: "FACHLICH", column: "done", archived: true, depth: 2, gap: false },
      ],
      descendants: [],
    } }
    : null;
  await mitBoard(antwort, async (dir) => {
    const glieder = await amBoard(dir, (t) => t.herkunftskette(1577));
    assert.deepEqual(glieder, [
      { nummer: 1574, titel: null, archiviert: false, gap: true },
      { nummer: 1571, titel: "[Fachlich] Archivierte Karten lesbar", archiviert: true, gap: false },
    ]);
  });
});

// --- Fehler ---

test("HTTP 500 wirft BoardError bei allen drei Aufrufen", async () => {
  await mitBoard(() => ({ status: 500, json: { message: "Archiv kaputt" } }), async (dir) => {
    await wirftBoardError(amBoard(dir, (t) => t.sucheFachplaene("x", { limit: 5 })), /HTTP 500: Archiv kaputt/);
    await wirftBoardError(amBoard(dir, (t) => t.karteNachNummer(1)), /HTTP 500: Archiv kaputt/);
    await wirftBoardError(amBoard(dir, (t) => t.herkunftskette(1)), /HTTP 500: Archiv kaputt/);
  });
});

test("Ohne Token werfen alle drei Aufrufe BoardError, ohne den Server zu fragen", async () => {
  await mitBoard(() => ({ status: 200, json: {} }), async (dir, requests) => {
    await wirftBoardError(amBoard(dir, (t) => t.sucheFachplaene("x", { limit: 5 }), {}), /Token/);
    await wirftBoardError(amBoard(dir, (t) => t.karteNachNummer(1), {}), /Token/);
    await wirftBoardError(amBoard(dir, (t) => t.herkunftskette(1), {}), /Token/);
    assert.equal(requests.length, 0);
  });
});

test("Die uebrigen Adapter fuehren keine der drei Methoden", () => {
  for (const issueTracker of ["github", "gitlab", "local"]) {
    const tracker = resolveTracker({ issueTracker });
    for (const name of ["sucheFachplaene", "karteNachNummer", "herkunftskette"]) {
      assert.equal(typeof tracker[name], "undefined", `${issueTracker}: ${name}`);
    }
  }
});
