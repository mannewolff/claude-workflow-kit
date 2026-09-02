// Tests fuer `issue activity` (Issue #460).
//
// Das Kommando gibt den Aktivitaetsverlauf einer Karte aus. `spec.mjs` liest daraus
// das Anlagedatum, seit an der Instanz belegt ist, dass die Karten-Route keins fuehrt
// (Issue #457, manuelle Pruefung vom 2026-09-02).
//
// Zwei Dinge sind hier die Hauptsache:
//   1. Der Endpunkt adressiert die INTERNE cardId, nicht die Kartennummer — dieselbe
//      Falle wie bei move, comments und labels (Befund vom 2026-08-29). Die Fixture
//      setzt id = number * 100, damit eine Verwechslung auffaellt.
//   2. Ein 404 wird NICHT zur leeren Liste abgeschwaecht. Bei den Kommentaren ist das
//      richtig (aeltere Instanzen kennen die Route nicht), hier waere es falsch: Der
//      Verlauf ist die Hauptsache, und ein fehlender Endpunkt saehe aus wie eine Karte
//      ohne Geschichte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

function karte(number, spalte = "BACKLOG") {
  return { id: number * 100, number, title: `Karte ${number}`, body: `Body ${number}`, column: spalte, position: 0 };
}

function gruppiert(karten) {
  const g = {};
  for (const k of karten) (g[k.column] ||= []).push(k);
  return g;
}

async function mitBoard(antwort, fn) {
  const { server, requests, host } = await starteServer(antwort);
  const dir = setupProjekt({ issueTracker: "toolbox", toolbox: { host } });
  try {
    await fn(dir, requests);
  } finally {
    server.close();
  }
}

// --- toolbox: die cardId-Falle ---

test("[board-1] activity adressiert die interne cardId, nicht die Kartennummer", async () => {
  const VERLAUF = [{ id: 1, type: "CREATED", createdAt: "2026-08-14T09:12:33Z", detail: "Karte angelegt" }];
  await mitBoard((req) => {
    if (req.url === "/api/kanban/items") return { status: 200, json: gruppiert([karte(12)]) };
    // Nur die interne ID wird bedient. Kommt die Nummer, faellt der Test auf 404.
    if (req.url === "/api/cards/1200/activity") return { status: 200, json: VERLAUF };
    return null;
  }, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "12"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), VERLAUF);
    assert.ok(
      requests.some((r) => r.url === "/api/cards/1200/activity"),
      "der Request ging nicht an die interne cardId",
    );
    assert.ok(
      !requests.some((r) => r.url === "/api/cards/12/activity"),
      "der Request ging an die Kartennummer statt an die cardId",
    );
  });
});

test("[board-1] activity gibt den Verlauf unveraendert als JSON aus", async () => {
  const VERLAUF = [
    { id: 2, type: "MOVED", createdAt: "2026-09-01T10:00:00Z", detail: "Verschoben nach Ready" },
    { id: 1, type: "CREATED", createdAt: "2026-08-14T09:12:33Z", detail: "Karte angelegt" },
  ];
  await mitBoard((req) => {
    if (req.url === "/api/kanban/items") return { status: 200, json: gruppiert([karte(7)]) };
    if (req.url === "/api/cards/700/activity") return { status: 200, json: VERLAUF };
    return null;
  }, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "7"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    // Unveraendert heisst: auch die Reihenfolge der Antwort bleibt, wie sie kam.
    assert.deepEqual(JSON.parse(res.stdout), VERLAUF);
  });
});

test("[board-1] activity schwaecht einen 404 nicht zur leeren Liste ab", async () => {
  await mitBoard((req) => {
    if (req.url === "/api/kanban/items") return { status: 200, json: gruppiert([karte(7)]) };
    if (req.url === "/api/cards/700/activity") return { status: 404, json: { message: "Not Found" } };
    return null;
  }, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "7"], MIT_TOKEN);
    assert.notEqual(res.status, 0, "ein 404 muss den Aufruf rot machen");
    assert.match(res.stderr, /404/, "der HTTP-Status fehlt in der Meldung");
    assert.equal(res.stdout.trim(), "", "stdout muss im Fehlerfall leer bleiben");
  });
});

test("[board-1] activity meldet eine unbekannte Kartennummer", async () => {
  await mitBoard((req) => {
    if (req.url === "/api/kanban/items") return { status: 200, json: gruppiert([karte(7)]) };
    return null;
  }, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "99"], MIT_TOKEN);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /99/);
  });
});

// --- local: der synthetische Verlauf ---

function lokalesProjekt(frontmatter) {
  const dir = setupProjekt({ issueTracker: "local", local: { issuesDir: "issues" } });
  mkdirSync(join(dir, "issues"), { recursive: true });
  writeFileSync(join(dir, "issues", "0007.md"), `---\n${frontmatter}\n---\n\n## Kontext\n\nAutor-Modell: test\n`, "utf-8");
  return dir;
}

test("[board-1] local synthetisiert aus created einen einzelnen CREATED-Eintrag", async () => {
  const dir = lokalesProjekt('id: "0007"\ntitle: Sieben\nstatus: backlog\ncreated: 2026-08-14');
  const res = await runBoardAsync(dir, ["issue", "activity", "7"], {});
  assert.equal(res.status, 0, res.stderr);
  const verlauf = JSON.parse(res.stdout);
  assert.equal(verlauf.length, 1);
  assert.equal(verlauf[0].type, "CREATED");
  assert.match(verlauf[0].createdAt, /^2026-08-14/);
});

test("[board-1] local ohne created liefert einen leeren Verlauf", async () => {
  const dir = lokalesProjekt('id: "0007"\ntitle: Sieben\nstatus: backlog');
  const res = await runBoardAsync(dir, ["issue", "activity", "7"], {});
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), []);
});

// --- github/gitlab: kein Verlauf ---

for (const tracker of ["github", "gitlab"]) {
  test(`[board-1] ${tracker} weist activity ab — dort gibt es keinen Verlauf`, async () => {
    const dir = setupProjekt({ issueTracker: tracker });
    const res = await runBoardAsync(dir, ["issue", "activity", "7"], {});
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Aktivitaetsverlauf|Aktivitätsverlauf/);
    assert.match(res.stderr, new RegExp(tracker));
  });
}
