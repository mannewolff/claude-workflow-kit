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
import { createServer } from "node:http";

import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

function karte(number, spalte = "BACKLOG") {
  return { id: number * 100, number, title: `Karte ${number}`, body: `Body ${number}`, column: spalte, position: 0 };
}

function gruppiert(karten) {
  const g = {};
  for (const k of karten) {
    g[k.column] ||= [];
    g[k.column].push(k);
  }
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

// ============================================================
// Gleichzeitige Verlaufsabrufe (Issue #1095)
// ============================================================
//
// Die Sammelform holte den Verlauf je Karte nacheinander — bei Dutzenden Karten der
// Ruecklaeuferquote eine Kette von Wartezeiten. Jetzt laufen hoechstens vier Abrufe
// zugleich: mehr als einer, damit sich die Wartezeiten ueberlappen, und nicht alle,
// weil die API drosselt. Gemessen wird am Fake-Server ueber die Zahl gleichzeitig
// offener Verlaufsanfragen, nicht ueber die Wanduhr: Der Server haelt jede Anfrage
// fest, bis vier offen sind oder eine kurze Frist ablaeuft, und antwortet erst dann.

const GRENZE = 4;

function verlaufVon(number) {
  return [{ id: number, type: "CREATED", createdAt: "2026-08-14T09:12:33Z", detail: `Karte ${number} angelegt` }];
}

/**
 * Fake-Server, der Verlaufsanfragen zurueckhaelt und das Maximum offener Anfragen
 * zaehlt. `status(number)` liefert den HTTP-Status je Kartennummer (Default 200).
 */
async function mitHaltendemBoard(karten, status, fn) {
  const zustand = { offen: 0, maximum: 0, wartend: [], listen: 0 };
  const loesen = () => {
    const alle = zustand.wartend.splice(0);
    for (const antworte of alle) antworte();
  };
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url === "/api/kanban/items") {
        zustand.listen++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(gruppiert(karten)));
        return;
      }
      const treffer = /^\/api\/kanban\/items\/(\d+)\/activity$/.exec(req.url);
      if (!treffer) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "keine Route" }));
        return;
      }
      const number = Number(treffer[1]) / 100;
      zustand.offen++;
      zustand.maximum = Math.max(zustand.maximum, zustand.offen);
      zustand.wartend.push(() => {
        zustand.offen--;
        const code = status(number);
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(code === 200 ? verlaufVon(number) : { message: "Forbidden" }));
      });
      // Vier offene Anfragen sind die Grenze: dann sofort antworten. Darunter erst
      // nach einer kurzen Frist — ein nacheinander arbeitender Adapter kommt nie ueber
      // eine offene Anfrage hinaus und laeuft so trotzdem durch.
      if (zustand.offen >= GRENZE) loesen();
      else setTimeout(loesen, 40);
    });
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const host = `http://127.0.0.1:${server.address().port}`;
  const dir = setupProjekt({ issueTracker: "toolbox", toolbox: { host } });
  try {
    await fn(dir, zustand);
  } finally {
    server.close();
  }
}

const ZEHN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test("[board-18] --ids holt hoechstens vier Verlaeufe zugleich, und mehr als einen", async () => {
  await mitHaltendemBoard(ZEHN.map((n) => karte(n)), () => 200, async (dir, zustand) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "--ids", ZEHN.join(",")], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(zustand.maximum <= GRENZE, `${zustand.maximum} Verlaufsabrufe waren zugleich offen, erlaubt sind ${GRENZE}`);
    assert.ok(zustand.maximum > 1, "die Verlaufsabrufe liefen nacheinander statt gleichzeitig");
    assert.equal(zustand.listen, 1, `die Kartenliste wurde ${zustand.listen}-mal geholt statt einmal`);
  });
});

test("[board-18] --ids liefert gleichzeitig je Nummer denselben Verlauf, eine unbekannte Nummer mit fehler", async () => {
  await mitHaltendemBoard(ZEHN.map((n) => karte(n)), () => 200, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "--ids", [...ZEHN, 99].join(",")], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const objekt = JSON.parse(res.stdout);
    for (const n of ZEHN) assert.deepEqual(objekt[n], verlaufVon(n), `Karte ${n} traegt nicht ihren eigenen Verlauf`);
    assert.match(String(objekt["99"]?.fehler), /99/, "die unbekannte Nummer traegt einen Fehlergrund");
    assert.deepEqual(Object.keys(objekt).sort((a, b) => a - b), [...ZEHN, 99].map(String));
  });
});

test("[board-18] ein 403 auf einen der gleichzeitigen Abrufe laesst den ganzen Aufruf scheitern", async () => {
  await mitHaltendemBoard(ZEHN.map((n) => karte(n)), (n) => (n === 6 ? 403 : 200), async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "activity", "--ids", ZEHN.join(",")], MIT_TOKEN);
    assert.notEqual(res.status, 0, "ein 403 muss den Aufruf rot machen");
    assert.match(res.stderr, /403/, "der HTTP-Status fehlt in der Meldung");
    assert.equal(res.stdout.trim(), "", "stdout muss im Fehlerfall leer bleiben");
  });
});
