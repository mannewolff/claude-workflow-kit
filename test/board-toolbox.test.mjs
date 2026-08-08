// Tests fuer den Toolbox-/kanbancompat-Adapter in kit/board.mjs (Issue #188).
//
// Fuehrt das Muster aus board-create.test.mjs weiter: Statt gegen ein echtes Board
// laeuft alles gegen einen lokalen HTTP-Mock auf 127.0.0.1. Geprueft werden alle fuenf
// Board-Operationen, die Host-/Token-Aufloesung und die Fehlerpfade der API-Schicht
// (nicht erreichbar, 401, Fehler mit und ohne JSON-Rumpf).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

function karte(number, spalte, extra = {}) {
  return { id: number * 100, number, title: `Karte ${number}`, body: `Body ${number}`, column: spalte, position: 0, ...extra };
}

// Antwortet auf die Board-Abfrage mit dem gruppierten Format der Kanban-API.
function gruppiert(karten) {
  const gruppen = {};
  for (const k of karten) {
    (gruppen[k.column] ||= []).push(k);
  }
  return gruppen;
}

/**
 * Der Token fuer die Aufrufe, die einen brauchen. Er muss bei jedem runBoardAsync
 * ausdruecklich mitgegeben werden: Der Fixture-Helfer loescht TBX_TOKEN aus der
 * Umgebung, damit kein Token vom Entwicklerrechner durchschlaegt. Tests, die das
 * Fehlen oder eine andere Herkunft des Tokens pruefen, uebergeben stattdessen `{}`.
 */
const MIT_TOKEN = { TBX_TOKEN: "test-token" };

/**
 * Startet Mock-Server und Fixture, ruft board.mjs auf und raeumt beides wieder ab.
 * Der Host kommt per Config, der Token pro Aufruf (siehe MIT_TOKEN).
 */
async function mitBoard(antwort, fn, { config = {} } = {}) {
  const { server, requests, host } = await starteServer(antwort);
  // toolbox zuletzt: Ein `config.toolbox` aus dem Test ergaenzt den Mock-Host, statt
  // ihn (samt Adresse des Servers) zu ersetzen.
  const dir = setupProjekt(
    { codeHost: "local", issueTracker: "toolbox", ...config, toolbox: { host, ...config.toolbox } },
    "board-toolbox-"
  );
  try {
    return await fn(dir, requests, host);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

const KARTEN = [karte(7, "READY"), karte(9, "READY", { position: 1 }), karte(3, "BACKLOG"), karte(5, "DONE")];

// Standard-Mock: liefert das Board und quittiert Schreibzugriffe.
function standardAntwort(req) {
  if (req.url === "/api/kanban/items" && req.method === "GET") return { status: 200, json: gruppiert(KARTEN) };
  if (req.url === "/api/kanban/items" && req.method === "POST") return { status: 200, json: { id: 700, number: 7 } };
  if (/^\/api\/kanban\/items\/\d+\/move$/.test(req.url)) return { status: 200, json: { ok: true } };
  if (/^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) return { status: 200, json: [] };
  if (req.url === "/api/kanban/epics") return { status: 200, json: [] };
  return null;
}

// --- Lesen ---

test("list ohne Filter liefert alle Karten numerisch sortiert", async () => {
  await mitBoard(standardAntwort, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout).map((i) => i.id), ["3", "5", "7", "9"]);
  });
});

test("list --status behaelt die Board-Reihenfolge der Spalte", async () => {
  await mitBoard(standardAntwort, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "list", "--status", "ready"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), [
      { id: "7", title: "Karte 7", body: "Body 7", status: "ready", labels: [] },
      { id: "9", title: "Karte 9", body: "Body 9", status: "ready", labels: [] },
    ]);
  });
});

// Epics nehmen nicht am Spalten-Workflow teil — bei Status-Filter fallen sie raus.
test("list --status laesst Epics aussen vor", async () => {
  const karten = [karte(7, "READY"), karte(8, "READY", { type: "epic" })];
  await mitBoard(
    (req) => (req.url === "/api/kanban/items" ? { status: 200, json: gruppiert(karten) } : null),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "list", "--status", "ready"], MIT_TOKEN);
      assert.deepEqual(JSON.parse(res.stdout).map((i) => i.id), ["7"]);
    }
  );
});

// Eine unbekannte Spalte des Backends darf nicht als Status durchschlagen.
test("list bildet eine unbekannte Spalte auf status null ab", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items" ? { status: 200, json: gruppiert([karte(7, "ARCHIV")]) } : null),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
      assert.equal(JSON.parse(res.stdout)[0].status, null);
    }
  );
});

test("get liefert die Karte samt Kommentaren", async () => {
  await mitBoard(
    (req) => {
      if (req.url === "/api/kanban/items" && req.method === "GET") return { status: 200, json: gruppiert(KARTEN) };
      if (req.url === "/api/kanban/items/700/comments") {
        return { status: 200, json: [{ author: "manne", body: "Ein Kommentar", createdAt: "2026-07-28T09:00:00Z" }] };
      }
      return null;
    },
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), {
        id: "7", title: "Karte 7", body: "Body 7", status: "ready",
        comments: [{ author: "manne", body: "Ein Kommentar", createdAt: "2026-07-28T09:00:00Z" }],
      });
    }
  );
});

// Der Kommentar-Endpunkt ist juenger als der Rest der API: eine aeltere Instanz
// antwortet mit 404. Titel und Status sind die Hauptsache — get darf nicht kippen.
test("get ueberlebt einen fehlenden Kommentar-Endpunkt", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items" ? { status: 200, json: gruppiert(KARTEN) } : { status: 404, json: { message: "Not Found" } }),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout).comments, []);
      assert.match(res.stderr, /Kommentare nicht abrufbar/);
    }
  );
});

test("get auf eine unbekannte Nummer schlaegt fehl", async () => {
  await mitBoard(standardAntwort, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "get", "99"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Issue 99 nicht gefunden/);
  });
});

// --- Epics ---

test("epics liefert Nummer, Shortcode und Fortschritt", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/epics"
      ? { status: 200, json: [{ number: 4, title: "Grosses Ganzes", shortcode: "GG", progress: { total: 3, done: 1 } }, { id: 99, title: "Ohne Nummer" }] }
      : null),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "epics"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { id: "4", title: "Grosses Ganzes", shortcode: "GG", progress: { total: 3, done: 1 } },
        { id: "99", title: "Ohne Nummer", shortcode: "", progress: { total: 0, done: 0 } },
      ]);
    }
  );
});

test("epics vertraegt eine Antwort, die kein Array ist", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/epics" ? { status: 200, json: { message: "keine Epics" } } : null),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "epics"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), []);
    }
  );
});

// --- Anlegen ---

test("create legt eine Karte an und liefert die Board-Nummer", async () => {
  await mitBoard(standardAntwort, async (dir, requests, host) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Neu", "--body", "Autor-Modell: m\nText"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { id: "7", url: `${host}/kanban` });

    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    assert.deepEqual(JSON.parse(post.body), { title: "Neu", body: "Autor-Modell: m\nText", column: "BACKLOG", ideaStored: true });
    assert.equal(post.headers["x-kanban-token"], "test-token");
  });
});

// kanban-kit >= 1.5 legt Creates als board-lose Idee im Pool an: nur { id }, die
// Board-Nummer entsteht erst beim menschlichen Einplanen.
test("create meldet eine Pool-Idee als pending", async () => {
  await mitBoard(
    (req) => (req.method === "POST" ? { status: 200, json: { id: 80 } } : standardAntwort(req)),
    async (dir, _requests, host) => {
      const res = await runBoardAsync(dir, ["issue", "create", "--title", "Idee"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), {
        id: null, ideaId: "80", pending: true, url: `${host}/kanban`,
        hinweis: "Als Idee im Projekt-Ideen-Pool angelegt; die Board-Nummer entsteht beim Einplanen.",
      });
    }
  );
});

test("create respektiert toolbox.ideaStored: false", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Direkt ins Backlog"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST");
    assert.equal(JSON.parse(post.body).ideaStored, false);
  }, { config: { toolbox: { ideaStored: false } } });
});

test("create meldet eine unerwartete Antwortform als Fehler", async () => {
  await mitBoard(
    (req) => (req.method === "POST" ? { status: 200, json: { foo: "bar" } } : standardAntwort(req)),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "create", "--title", "Kaputt"], MIT_TOKEN);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /Unerwartete Create-Response/);
    }
  );
});

// --- Verschieben ---

test("move schiebt die Karte ans Ende der Zielspalte", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "move", "7", "in_review"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const move = requests.find((r) => r.url === "/api/kanban/items/700/move");
    // IN_REVIEW ist leer -> Position 0.
    assert.deepEqual(JSON.parse(move.body), { column: "IN_REVIEW", position: 0 });
  });
});

test("move in eine belegte Spalte haengt hinten an", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "move", "3", "ready"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const move = requests.find((r) => r.url === "/api/kanban/items/300/move");
    // READY ist mit zwei Karten belegt -> Position 2.
    assert.deepEqual(JSON.parse(move.body), { column: "READY", position: 2 });
  });
});

// Ziel gleich Ausgangsspalte: die Karte darf nicht ans Ende springen.
test("move innerhalb derselben Spalte haelt die Position", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "move", "9", "ready"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const move = requests.find((r) => r.url === "/api/kanban/items/900/move");
    assert.deepEqual(JSON.parse(move.body), { column: "READY", position: 1 });
  });
});

// --- Kommentieren ---

test("comment schickt den Text an den Kommentar-Endpunkt", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "comment", "7", "--text", "## Abschlussbericht"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items/700/comments");
    assert.deepEqual(JSON.parse(post.body), { body: "## Abschlussbericht" });
  });
});

// --- Host- und Token-Aufloesung ---

test("Host kommt aus der tbx-Config, wenn er nicht in workflow.config.json steht", async () => {
  const { server, requests, host } = await starteServer(standardAntwort);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox" }, "board-toolbox-");
  try {
    mkdirSync(join(dir, "tbx-config"), { recursive: true });
    writeFileSync(join(dir, "tbx-config", "config.json"), JSON.stringify({ host }));
    writeFileSync(join(dir, "tbx-config", "tokens.json"), JSON.stringify({ token: "gespeicherter-token" }));

    const res = await runBoardAsync(dir, ["issue", "list"], {});
    assert.equal(res.status, 0, res.stderr);
    assert.equal(requests[0].headers["x-kanban-token"], "gespeicherter-token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});

test("Ohne Host bricht der Adapter mit Anleitung ab", async () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox" }, "board-toolbox-");
  try {
    const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Kein Toolbox-Host gefunden.*tbx auth login/s);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Eine kaputte tbx-config.json darf nicht mit einem Parser-Absturz enden, sondern
// wie eine fehlende behandelt werden.
test("Kaputte tbx-Config wird wie eine fehlende behandelt", async () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox" }, "board-toolbox-");
  try {
    mkdirSync(join(dir, "tbx-config"), { recursive: true });
    writeFileSync(join(dir, "tbx-config", "config.json"), "{kaputt");
    const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Kein Toolbox-Host gefunden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Token aus toolbox.tokenFile wird gelesen und getrimmt", async () => {
  const { server, requests, host } = await starteServer(standardAntwort);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host, tokenFile: "geheim/tbx.token" } }, "board-toolbox-");
  try {
    mkdirSync(join(dir, "geheim"), { recursive: true });
    writeFileSync(join(dir, "geheim", "tbx.token"), "  datei-token\n");
    const res = await runBoardAsync(dir, ["issue", "list"], {});
    assert.equal(res.status, 0, res.stderr);
    assert.equal(requests[0].headers["x-kanban-token"], "datei-token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});

// Secrets gehoeren nicht ins eingecheckte Repo: ein Klartext-Token bricht immer ab.
test("Klartext-Token in der Config bricht ab", async () => {
  await mitBoard(standardAntwort, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "list"], {});
    assert.equal(res.status, 1);
    assert.match(res.stderr, /kein Klartext-Token in workflow\.config\.json/);
  }, { config: { toolbox: { token: "geheim" } } });
});

test("Ohne jeden Token bricht der Adapter mit den drei Wegen ab", async () => {
  await mitBoard(standardAntwort, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "list"], {});
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Kein Toolbox-Token gefunden.*TBX_TOKEN.*tokenFile.*tbx auth login/s);
  });
});

// --- Fehlerpfade der API-Schicht ---

test("Nicht erreichbarer Host nennt den Host in der Meldung", async () => {
  // Server sofort wieder schliessen: der Port ist dann garantiert frei und tot.
  const { server, host } = await starteServer(standardAntwort);
  server.close();
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-toolbox-");
  try {
    const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, new RegExp(`Toolbox-API nicht erreichbar \\(${host.replace(/[.]/g, "\\.")}\\)`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("401 verweist auf einen erneuten tbx-Login", async () => {
  await mitBoard(() => ({ status: 401, json: { message: "unauthorized" } }), async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Token ungueltig oder widerrufen/);
  });
});

test("Fehlerantwort mit JSON-Rumpf zeigt dessen message", async () => {
  await mitBoard(() => ({ status: 500, json: { message: "Board kaputt" } }), async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Toolbox-API-Fehler: Board kaputt/);
  });
});

test("Fehlerantwort ohne JSON-Rumpf faellt auf den HTTP-Status zurueck", async () => {
  await mitBoard(() => ({ status: 503, text: "Service Unavailable" }), async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Toolbox-API-Fehler: HTTP 503/);
  });
});
