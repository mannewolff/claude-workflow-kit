// Ablauf-Pruefung: Ob ein Aufruf einen Idempotency-Key traegt und ob --idempotency-key unveraendert durchgeht, entscheidet der Dispatch im Einstieg; belegt ist das erst an dem, was auf der Leitung ankommt.
//
// Wiederholung gegen Ueberlast ueber die CLI (Issue #834, #842, Teil
// kit/board/wiederholung.mjs seit Issue #1215): Die Entscheidungen selbst prueft
// test/board-wiederholung-entscheidungen.test.mjs im selben Prozess. Hier steht nur, was
// erst am gestarteten board.mjs gegen den Mock-Server aus board-fixture sichtbar wird:
// welcher Aufruf einen `Idempotency-Key` traegt, dass `--idempotency-key` unveraendert
// durchgeht, und dass die Fixture das Budget per KIT_TOOLBOX_BUDGET_MS kuerzt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { setupProjekt, runBoardAsync, starteServer, repoRoot } from "./helpers/board-fixture.mjs";

const KARTE = { id: 700, number: 7, title: "Karte 7", body: "Body", column: "BACKLOG", position: 0 };

async function mitBoard(fn) {
  const { server, requests, host } = await starteServer((req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") return { status: 200, json: { BACKLOG: [KARTE] } };
    if (req.url === "/api/kanban/items" && req.method === "POST") return { status: 200, json: { id: 700, number: 7 } };
    if (/^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) return { status: 200, json: [] };
    if (/^\/api\/kanban\/items\/\d+\/move$/.test(req.url)) return { status: 200, json: { ok: true } };
    if (/^\/api\/kanban\/items\/\d+\/labels/.test(req.url)) return { status: 204, text: "" };
    return null;
  });
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-wdh-");
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

test("Nur create und comment tragen einen Idempotency-Key", async () => {
  await mitBoard(async (dir, requests) => {
    const create = await runBoardAsync(dir, ["issue", "create", "--title", "Neu", "--body", "## Kontext\n\nAutor-Modell: x\n"], MIT_TOKEN);
    assert.equal(create.status, 0, create.stderr);
    const kommentar = await runBoardAsync(dir, ["issue", "comment", "7", "--text", "Hallo"], MIT_TOKEN);
    assert.equal(kommentar.status, 0, kommentar.stderr);
    const move = await runBoardAsync(dir, ["issue", "move", "7", "ready"], MIT_TOKEN);
    assert.equal(move.status, 0, move.stderr);
    const label = await runBoardAsync(dir, ["issue", "label", "add", "7", "kit:test"], MIT_TOKEN);
    assert.equal(label.status, 0, label.stderr);

    const mitSchluessel = requests.filter((r) => r.headers["idempotency-key"]);
    assert.deepEqual(
      mitSchluessel.map((r) => `${r.method} ${r.url.replaceAll(/\d+/g, "N")}`),
      ["POST /api/kanban/items", "POST /api/kanban/items/N/comments"]
    );
    for (const r of mitSchluessel) assert.match(r.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
  });
});

test("--idempotency-key erreicht den Aufruf unveraendert", async () => {
  await mitBoard(async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "comment", "7", "--text", "Hallo", "--idempotency-key", "von-aussen-1"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST");
    assert.equal(post.headers["idempotency-key"], "von-aussen-1");
  });
});

test("--idempotency-key wirkt auch bei issue create", async () => {
  await mitBoard(async (dir, requests) => {
    const res = await runBoardAsync(
      dir,
      ["issue", "create", "--title", "Neu", "--body", "## Kontext\n\nAutor-Modell: x\n", "--idempotency-key", "create-9"],
      MIT_TOKEN
    );
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    assert.equal(post.headers["idempotency-key"], "create-9");
  });
});

// Der neue Import `node:crypto` ist ein Builtin und darf die Einzeldatei-Tauglichkeit
// nicht antasten (Issue #834): board.mjs bleibt allein kopierbar, ohne Repo, ohne
// node_modules, ohne Nachbardateien.
test("board.mjs bleibt allein kopierbar", () => {
  const ziel = mkdtempSync(join(tmpdir(), "board-allein-"));
  try {
    copyFileSync(join(repoRoot, "kit", "board.mjs"), join(ziel, "board.mjs"));
    const res = spawnSync(process.execPath, ["board.mjs", "--help"], { cwd: ziel, encoding: "utf-8" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /--idempotency-key/);
  } finally {
    rmSync(ziel, { recursive: true, force: true });
  }
});

test("--idempotency-key ohne Wert wird abgewiesen, bevor irgendetwas hinausgeht", async () => {
  await mitBoard(async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "comment", "7", "--text", "Hallo", "--idempotency-key"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--idempotency-key braucht einen Wert/);
    assert.equal(requests.length, 0);
  });
});

// Das Budget der Wiederholschleife per Umgebungsvariable (Issue #842): Ohne
// KIT_TOOLBOX_BUDGET_MS wartete jeder Aufruf gegen einen dauerhaft mit 5xx antwortenden
// Server das volle Budget ab, mit KIT_AGENT_MODEL aus der Fixture zwei Minuten.

test("Ein Fixture-Aufruf gegen einen 5xx-Server endet in Sekunden, nicht in Minuten", async () => {
  const { server, host } = await starteServer(() => ({ status: 503, json: { message: "kaputt" } }));
  const dir = setupProjekt(
    { codeHost: "local", issueTracker: "toolbox", toolbox: { host } },
    "board-budget-"
  );
  try {
    const start = Date.now();
    const res = await runBoardAsync(dir, ["issue", "list"], { TBX_TOKEN: "test-token" });
    const dauer = Date.now() - start;
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Toolbox-API-Fehler: HTTP 503/);
    // Unter dem Vorgabe-Budget von 30 s, mit Reserve fuer Last (Issue #1080): 5 s riss
    // unter der Last eines vollen Prueflaufs schon der Start von board.mjs.
    assert.ok(dauer < 20_000, `Aufruf brauchte ${dauer} ms — die Fixture setzt KIT_TOOLBOX_BUDGET_MS nicht`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});
