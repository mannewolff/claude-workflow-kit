// Tests fuer `issue activity` (Issue #460).
//
// Das Kommando gibt den Aktivitaetsverlauf einer Karte aus. Auswertungen wie
// `wirksamkeit.mjs` lesen daraus die Ereignisdaten, seit an der Instanz belegt ist,
// dass die Karten-Route kein Anlagedatum fuehrt (Issue #457, manuelle Pruefung vom
// 2026-09-02).
//
// Zwei Dinge sind hier die Hauptsache:
//   1. Der Endpunkt adressiert die INTERNE cardId, nicht die Kartennummer — dieselbe
//      Falle wie bei move, comments und labels (Befund vom 2026-08-29). Die Fixture
//      setzt id = number * 100, damit eine Verwechslung auffaellt. Seit Issue #670
//      liegt er unter `/api/kanban/items/{id}/activity`: kanban-kit v1.43.0 laesst ein
//      board-gebundenes Token nur noch unter `/api/kanban/**` zu (#877) und bietet den
//      Verlauf dort an (#876). Die fruehere Karten-Route beantwortet es mit 403.
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
    if (req.url === "/api/kanban/items/1200/activity") return { status: 200, json: VERLAUF };
    return null;
  }, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "12"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), VERLAUF);
    assert.ok(
      requests.some((r) => r.url === "/api/kanban/items/1200/activity"),
      "der Request ging nicht an die interne cardId unter /api/kanban/items",
    );
    assert.ok(
      !requests.some((r) => r.url === "/api/kanban/items/12/activity"),
      "der Request ging an die Kartennummer statt an die cardId",
    );
    // Die Karten-Route beantwortet einem board-gebundenen Token seit kanban-kit #877 jede
    // Anfrage mit 403 — schon ein einziger Aufruf dorthin schluege fehl.
    assert.ok(
      !requests.some((r) => r.url.startsWith("/api/cards/")),
      "es ging noch eine Anfrage an die Karten-Route ausserhalb der Board-Grenze",
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
    if (req.url === "/api/kanban/items/700/activity") return { status: 200, json: VERLAUF };
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
    if (req.url === "/api/kanban/items/700/activity") return { status: 404, json: { message: "Not Found" } };
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

// ============================================================
// Sammelabfrage `--ids` (Issue #786)
// ============================================================
//
// Die Ruecklaeuferquote fragt den Verlauf von Dutzenden Karten ab. Jeder Einzelaufruf
// loest ueber `_boardItems()` die vollstaendige Kartenliste mit auf — bei vierzig
// Kandidaten waeren das vierzig ueberfluessige Requests gegen eine drosselnde API.
// `--ids` loest sie genau EINMAL auf; genau das prueft der erste Test, und er prueft
// es an der Zahl der Requests, nicht am Code.
//
// Der zweite Punkt: Eine Nummer, die es am Board nicht mehr gibt, darf die Auswertung
// nicht kosten. Sie erscheint mit einem Fehlergrund im Objekt, statt den Aufruf
// abzubrechen.

for (const tracker of ["github", "gitlab"]) {
  test(`[board-18] ${tracker} weist auch die Sammelform ab`, async () => {
    const dir = setupProjekt({ issueTracker: tracker });
    const res = await runBoardAsync(dir, ["issue", "activity", "--ids", "7,8"], {});
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Aktivitaetsverlauf|Aktivitätsverlauf/);
  });
}

test("[board-18] --ids loest die Kartenliste genau einmal auf", async () => {
  const VERLAUF_7 = [{ id: 1, type: "CREATED", createdAt: "2026-08-14T09:12:33Z", detail: "Karte angelegt" }];
  const VERLAUF_12 = [{ id: 2, type: "MOVED", createdAt: "2026-09-01T10:00:00Z", detail: "Verschoben nach Backlog" }];
  await mitBoard((req) => {
    if (req.url === "/api/kanban/items") return { status: 200, json: gruppiert([karte(7), karte(12)]) };
    if (req.url === "/api/kanban/items/700/activity") return { status: 200, json: VERLAUF_7 };
    if (req.url === "/api/kanban/items/1200/activity") return { status: 200, json: VERLAUF_12 };
    return null;
  }, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "--ids", "7,12"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { 7: VERLAUF_7, 12: VERLAUF_12 });
    const listen = requests.filter((r) => r.url === "/api/kanban/items");
    assert.equal(listen.length, 1, `die Kartenliste wurde ${listen.length}-mal geholt statt einmal`);
  });
});

test("[board-18] eine unbekannte Nummer erscheint mit Fehlergrund, ohne den Aufruf rot zu machen", async () => {
  const VERLAUF = [{ id: 1, type: "CREATED", createdAt: "2026-08-14T09:12:33Z", detail: "Karte angelegt" }];
  await mitBoard((req) => {
    if (req.url === "/api/kanban/items") return { status: 200, json: gruppiert([karte(7)]) };
    if (req.url === "/api/kanban/items/700/activity") return { status: 200, json: VERLAUF };
    return null;
  }, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "--ids", "7,99"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const objekt = JSON.parse(res.stdout);
    assert.deepEqual(objekt["7"], VERLAUF, "die auffindbare Karte liefert ihren Verlauf");
    assert.match(String(objekt["99"]?.fehler), /99/, "die unbekannte Nummer traegt einen Fehlergrund, der sie nennt");
  });
});

test("[board-18] --ids zusammen mit einer Einzelnummer wird abgewiesen", async () => {
  const dir = lokalesProjekt('id: "0007"\ntitle: Sieben\nstatus: backlog\ncreated: 2026-08-14');
  const res = await runBoardAsync(dir, ["issue", "activity", "7", "--ids", "7,8"], {});
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /--ids/, "die Meldung benennt die beiden Eingabewege");
});

test("[board-18] --ids ohne Nummer wird abgewiesen", async () => {
  const dir = lokalesProjekt('id: "0007"\ntitle: Sieben\nstatus: backlog\ncreated: 2026-08-14');
  const res = await runBoardAsync(dir, ["issue", "activity", "--ids"], {});
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /--ids/);
});

test("[board-18] local liefert in der Sammelform je Nummer denselben synthetischen Verlauf", async () => {
  const dir = lokalesProjekt('id: "0007"\ntitle: Sieben\nstatus: backlog\ncreated: 2026-08-14');
  const res = await runBoardAsync(dir, ["issue", "activity", "--ids", "7,99"], {});
  assert.equal(res.status, 0, res.stderr);
  const objekt = JSON.parse(res.stdout);
  assert.equal(objekt["7"].length, 1);
  assert.equal(objekt["7"][0].type, "CREATED");
  assert.match(String(objekt["99"]?.fehler), /99/, "die fehlende Datei endet als Fehlergrund, nicht als Abbruch");
});
