/**
 * board-zustand-grenze.test.mjs — der fuenfte Pruefzustand `grenze` (Issue #516).
 *
 * „Pruefgrenze erreicht, Befunde offen" war bis hierher nicht von „es geht gleich
 * weiter" zu unterscheiden — beides war `befunde`. Der neue Zustand macht den
 * Unterschied sichtbar; #408 verlangt vier unterscheidbare Endzustaende.
 *
 * Drei Festlegungen tragen die Ableitung, und an jeder liegt eine naive Umsetzung
 * falsch: Gezaehlt wird die ANZAHL der Anker (nicht die Rundennummer — `/issue-review`
 * nummeriert je Session ab 1), gezaehlt wird mit `>=` (sonst faellt ein Dokument mit
 * vier Ankern auf `befunde` zurueck), und ein Ausfall ist keine Pruefung.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { reviewZustand, pruefvorgabeStand, GRENZE_RUNDEN } from "../kit/board.mjs";
import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const BODY = "## Kontext\n\nText.\n";
const komm = (...texte) => texte.map((body) => ({ author: "wer", body, createdAt: "2026-09-08" }));
const runde = (n) => `## Issue-Review, Runde ${n}\n\nEin Befund.`;
const ausfall = (n) => `## Issue-Review, Runde ${n}\nReviewer fable ausgefallen: nicht startbar.\n\nKeine Befunde.`;

// --- Die Schwelle als exportierte Konstante ---

test("[board-3] GRENZE_RUNDEN ist exportiert und steht auf 3", () => {
  assert.equal(GRENZE_RUNDEN, 3, "night.mjs importiert die Schwelle statt sie zu wiederholen");
});

// --- Die Ableitung ---

test("[board-3] Drei Runden-Anker ohne Marker ergeben grenze", () => {
  assert.equal(reviewZustand(BODY, komm(runde(1), runde(2), runde(3)), "issue"), "grenze");
});

// Mit `===` statt `>=` fiele das Dokument hier auf `befunde` zurueck — genau der
// Zustand, den das Paket unterscheidbar machen soll.
test("[board-3] Vier Runden-Anker ergeben ebenfalls grenze", () => {
  assert.equal(reviewZustand(BODY, komm(runde(1), runde(2), runde(3), runde(4)), "issue"), "grenze");
});

// `/issue-review` nummeriert je Session ab 1: Drei Naechte hinterlassen dreimal
// „Runde 1". Wer die hoechste Nummer naehme, erreichte die Grenze nie.
test("[board-3] Dreimal 'Runde 1' ergibt grenze — die Anzahl zaehlt, nicht die Nummer", () => {
  assert.equal(reviewZustand(BODY, komm(runde(1), runde(1), runde(1)), "issue"), "grenze");
});

test("[board-3] Zwei Runden-Anker bleiben befunde", () => {
  assert.equal(reviewZustand(BODY, komm(runde(1), runde(2)), "issue"), "befunde");
});

// --- Was die Grenze schlaegt ---

test("[board-3] Ein Marker der eigenen Stufe schlaegt die Grenze", () => {
  const body = "## Kontext\n\nIssue-Review: fable (2026-09-08)\n";
  assert.equal(reviewZustand(body, komm(runde(1), runde(2), runde(3)), "issue"), "fertig");
});

test("[board-3] Ein gueltiger Pruefung: Verzicht schlaegt die Grenze", () => {
  const roh = "## Kontext\n\nPruefung: Verzicht\nAutor-Modell: claude-opus-5\n";
  const body = roh.replace("Autor-Modell", `Pruefung-Stand: ${pruefvorgabeStand(roh)}\nAutor-Modell`);
  assert.equal(reviewZustand(body, komm(runde(1), runde(2), runde(3)), "issue"), "fertig");
});

// --- Ein Ausfall ist keine Pruefung ---

test("[board-3] Drei Anker, davon einer mit Ausfallvermerk, ergeben befunde", () => {
  assert.equal(reviewZustand(BODY, komm(runde(1), ausfall(2), runde(3)), "issue"), "befunde");
});

test("[board-3] Drei Befund-Anker gefolgt von einem Ausfall ergeben ausgefallen", () => {
  const c = komm(runde(1), runde(2), runde(3), ausfall(4));
  assert.equal(reviewZustand(BODY, c, "issue"), "ausgefallen");
});

// --- Das Label ---

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

/** Mock-Server, Fixture, Aufraeumen — wie in board-label-sync.test.mjs. */
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
    "board-grenze-"
  );
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

test("[board-3] label-sync setzt review:grenze und raeumt die uebrigen Zustandslabels ab", async () => {
  const karte = {
    id: 700,
    number: 7,
    title: "Karte 7",
    body: BODY,
    column: "BACKLOG",
    position: 0,
    labels: [{ name: "review:befunde" }, { name: "review:offen" }],
  };
  await mitBoard([karte], async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue-review", "label-sync", "7"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, id: "7", zustand: "grenze", label: "review:grenze" });

    const l = requests.filter((r) => /\/labels/.test(r.url));
    const post = l.find((r) => r.method === "POST");
    assert.deepEqual(JSON.parse(post.body), { name: "review:grenze" });
    const entfernt = l
      .filter((r) => r.method === "DELETE")
      .map((r) => new URL(r.url, "http://x").searchParams.get("name"));
    assert.deepEqual(entfernt.sort(), ["review:befunde", "review:offen"]);
  }, {
    config: { issueReview: { statusLabels: true } },
    kommentare: komm(runde(1), runde(2), runde(3)),
  });
});
