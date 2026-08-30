/**
 * board-label-sync.test.mjs — `issue-review label-sync` (Issue #384).
 *
 * Das Kommando schreibt den abgeleiteten Pruefzustand als Label ans Ticket. Das
 * Label ist Projektion, nie Wahrheit (Plan #368, A1) — kein Gate liest es.
 *
 * Vier Dinge werden hier festgenagelt, weil eine naive Umsetzung an jedem davon
 * scheitert: der Schalter, der Kollisions-Guard, der Vorhaben-Fall und vor allem
 * die REIHENFOLGE des Tauschs (erst entfernen, dann setzen — sonst traegt die
 * Karte einen Moment lang zwei Zustandslabels).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

function karte(number, extra = {}) {
  return { id: number * 100, number, title: `Karte ${number}`, body: "## Kontext\n\nText.\n", column: "BACKLOG", position: 0, ...extra };
}

/** Mock-Server, Fixture, Aufraeumen — wie in board-toolbox.test.mjs. */
async function mitBoard(karten, fn, { config = {}, kommentare = [] } = {}) {
  const antwort = (req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") {
      const g = {};
      for (const k of karten) (g[k.column] ||= []).push(k);
      return { status: 200, json: g };
    }
    if (/^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) return { status: 200, json: kommentare };
    if (/^\/api\/kanban\/items\/\d+\/labels/.test(req.url)) return { status: 204, text: "" };
    return null;
  };
  const { server, requests, host } = await starteServer(antwort);
  const dir = setupProjekt(
    { codeHost: "local", issueTracker: "toolbox", ...config, toolbox: { host, ...config.toolbox } },
    "board-labelsync-"
  );
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

const AN = { issueReview: { statusLabels: true } };
const labelRequests = (requests) => requests.filter((r) => /\/labels/.test(r.url));

// --- Schalter ---

test("Ohne statusLabels passiert nichts: Exit 0, Meldung auf stderr, kein Schreib-Request", async () => {
  await mitBoard([karte(7)], async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /statusLabels/);
    assert.equal(res.stdout.trim(), "", "stdout muss leer bleiben — dort steht sonst JSON");
    assert.deepEqual(labelRequests(requests), []);
  });
});

// --- Kollisions-Guard ---

test("Kollision mit einem Spalten-Label bricht ab und nennt den Namen", async () => {
  await mitBoard([karte(7)], async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    assert.notEqual(res.status, 0, "Guard hat nicht abgebrochen");
    assert.match(res.stderr, /review:offen/);
    assert.deepEqual(labelRequests(requests), [], "trotz Kollision geschrieben");
  }, { config: { ...AN, columns: { backlog: "review:offen", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" } } });
});

// --- Vorhaben ---

test("Ein Vorhaben endet mit Exit 0 und ohne Schreibversuch", async () => {
  await mitBoard([karte(8, { type: "epic" })], async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue-review", "label-sync", "8"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /Vorhaben/i);
    assert.deepEqual(labelRequests(requests), []);
  }, { config: AN });
});

// --- Der Tausch ---

test("Erst entfernen, dann setzen: kein POST vor dem letzten DELETE", async () => {
  await mitBoard([karte(7)], async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const l = labelRequests(requests);
    const letztesDelete = l.map((r) => r.method).lastIndexOf("DELETE");
    const erstesPost = l.map((r) => r.method).indexOf("POST");
    assert.ok(erstesPost > letztesDelete,
      `POST an Position ${erstesPost} liegt vor dem letzten DELETE an ${letztesDelete} — die Karte traegt kurzzeitig zwei Zustandslabels`);
  }, { config: AN });
});

test("Der abgeleitete Zustand landet als Label am Ticket", async () => {
  await mitBoard([karte(7)], async (dir, requests) => {
    await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    const post = labelRequests(requests).find((r) => r.method === "POST");
    assert.deepEqual(JSON.parse(post.body), { name: "review:offen" });
  }, { config: AN });
});

test("ausgefallen bildet auf review:offen ab", async () => {
  const k = [{ author: "wer", body: "## Issue-Review, Runde 1\nReviewer fable ausgefallen: nicht startbar.", createdAt: "2026-08-29" }];
  await mitBoard([karte(7)], async (dir, requests) => {
    await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    const post = labelRequests(requests).find((r) => r.method === "POST");
    assert.deepEqual(JSON.parse(post.body), { name: "review:offen" });
  }, { config: AN, kommentare: k });
});

test("Ein Review-Kommentar fuehrt zu review:befunde", async () => {
  const k = [{ author: "wer", body: "## Issue-Review, Runde 1\n\nEin Befund.", createdAt: "2026-08-29" }];
  await mitBoard([karte(7)], async (dir, requests) => {
    await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    const post = labelRequests(requests).find((r) => r.method === "POST");
    assert.deepEqual(JSON.parse(post.body), { name: "review:befunde" });
  }, { config: AN, kommentare: k });
});

test("Idempotent: ein zweiter Lauf setzt dasselbe Label", async () => {
  await mitBoard([karte(7, { labels: [{ name: "review:offen" }] })], async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const post = labelRequests(requests).find((r) => r.method === "POST");
    assert.deepEqual(JSON.parse(post.body), { name: "review:offen" });
  }, { config: AN });
});

// --- LabelNotFound ---

test("LabelNotFound wird als Einrichtungshinweis uebersetzt — auch bei issue label add", async () => {
  const antwort = (req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") return { status: 200, json: { BACKLOG: [karte(7)] } };
    if (/\/labels/.test(req.url)) return { status: 404, json: { message: "Label nicht gefunden" } };
    return null;
  };
  const { server, host } = await starteServer(antwort);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-labelsync-404-");
  try {
    const res = await runBoardAsync(dir, ["issue", "label", "add", "7", "review:offen"], MIT_TOKEN);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /review:offen/, "der fehlende Labelname wird nicht genannt");
    assert.match(res.stderr, /Definition|anlegen/i, "der Hinweis aufs Anlegen fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});
