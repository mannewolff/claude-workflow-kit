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

// `createdAt` ist der Feldname, den der Kommentar-Endpunkt derselben API bereits
// fuehrt (kanban-kit#449). Fuer die Karten-Route ist er zum Zeitpunkt von Issue #457
// NICHT gegen die Live-Instanz belegt — dieser Mock belegt darum nur, dass der
// Adapter die Form verarbeitet, nicht dass die Plattform sie liefert. Der Adapter
// nimmt deshalb auch created_at und created an; die Klaerung steht als manueller
// Pruefpunkt an Issue #457.
function karte(number, spalte, extra = {}) {
  return { id: number * 100, number, title: `Karte ${number}`, body: `Body ${number}`, column: spalte, position: 0, createdAt: "2026-08-14T09:12:33Z", ...extra };
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
  // Beide Label-Routen antworten 204 ohne Rumpf — genau wie KanbanCompatController.
  if (/^\/api\/kanban\/items\/\d+\/labels$/.test(req.url) && req.method === "POST") return { status: 204, text: "" };
  if (/^\/api\/kanban\/items\/\d+\/labels\?/.test(req.url) && req.method === "DELETE") return { status: 204, text: "" };
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
      { id: "7", title: "Karte 7", body: "Body 7", status: "ready", labels: [], type: "task" },
      { id: "9", title: "Karte 9", body: "Body 9", status: "ready", labels: [], type: "task" },
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

// Ohne Status-Filter galt der Epic-Ausschluss frueher nicht — Vorhaben erschienen
// als gewoehnliche Karten mit erfundenem Status (Issue #377).
test("list ohne Filter laesst Epics ebenfalls aussen vor", async () => {
  const karten = [karte(7, "READY"), karte(8, "BACKLOG", { type: "epic" })];
  await mitBoard(
    (req) => (req.url === "/api/kanban/items" ? { status: 200, json: gruppiert(karten) } : null),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout).map((i) => i.id), ["7"]);
    }
  );
});

// Der Default haelt die Form stabil: Ein Item ohne type-Feld darf das Feld nicht
// fehlen lassen — JSON.stringify wuerde undefined auslassen (Issue #377).
test("list liefert type, auch bei einer Karte ohne type-Feld", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items" ? { status: 200, json: gruppiert([karte(7, "READY")]) } : null),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
      assert.equal(JSON.parse(res.stdout)[0].type, "task");
    }
  );
});

// Ein Vorhaben hat keinen Status: CardService.move laesst es gar nicht auf dem
// Board positionieren. Die Compat-API liefert BACKLOG als Fallback (Issue #377).
test("get auf ein Vorhaben liefert status null und type epic", async () => {
  await mitBoard(
    (req) => {
      if (req.url === "/api/kanban/items") return { status: 200, json: gruppiert([karte(8, "BACKLOG", { type: "epic" })]) };
      if (/^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) return { status: 200, json: [] };
      return null;
    },
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "get", "8"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      const karte8 = JSON.parse(res.stdout);
      assert.equal(karte8.status, null);
      assert.equal(karte8.type, "epic");
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
        id: "7", title: "Karte 7", body: "Body 7", status: "ready", labels: [], type: "task",
        comments: [{ author: "manne", body: "Ein Kommentar", createdAt: "2026-07-28T09:00:00Z" }],
        created: "2026-08-14", // Anlagedatum aus createdAt (Issue #457)
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
  // Ausdruecklich im Pool-Modus: Seit Issue #313 ist das Direktanlegen die Vorgabe,
  // und dieser Test prueft den Payload OHNE `direct`.
  await mitBoard(standardAntwort, async (dir, requests, host) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Neu", "--body", "Autor-Modell: m\nText"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { id: "7", url: `${host}/kanban` });

    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    // Weder `direct` noch `ideaStored`: Der Pool ist ausdruecklich gewaehlt, und das
    // tote Wire-Feld wird seit Issue #295 in keinem Modus mehr gesendet.
    assert.deepEqual(JSON.parse(post.body), { title: "Neu", body: "Autor-Modell: m\nText", column: "BACKLOG" });
    assert.equal(post.headers["x-kanban-token"], "test-token");
  }, { config: { toolbox: { ideaStored: true } } });
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
    },
    { config: { toolbox: { ideaStored: true } } }
  );
});

// Der Config-Schluessel bleibt `ideaStored`, das Wire-Feld heisst `direct`
// (Issue #295). Die Umkehrung ist Absicht: Der Config-Name beschreibt die Absicht
// des Nutzers, das Wire-Feld die API-Form von kanban-kit.
test("create schickt bei toolbox.ideaStored: false ein direct: true", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Direkt ins Backlog"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const payload = JSON.parse(requests.find((r) => r.method === "POST").body);
    assert.equal(payload.direct, true);
    assert.ok(!("ideaStored" in payload), "das tote Wire-Feld darf nicht mehr mitgehen");
    assert.equal(payload.column, "BACKLOG");
  }, { config: { toolbox: { ideaStored: false } } });
});

// Der eigentliche Nachweis von Issue #313: OHNE den Schluessel gilt das
// Direktanlegen. Der alte Code verglich strikt auf `false` — ein fehlendes Feld
// lenkte die Karte damit in den Pool, ohne Nummer, in keiner Spalte. Aufgefallen
// ist das niemandem, weil dieses Repo den Wert explizit setzt und das Dogfooding
// deshalb am Default vorbeilaeuft.
test("create schickt ohne toolbox.ideaStored ein direct: true", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Ohne Schluessel"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const payload = JSON.parse(requests.find((r) => r.method === "POST").body);
    assert.equal(payload.direct, true, "ohne Angabe muss direkt angelegt werden");
    assert.ok(!("ideaStored" in payload), "das tote Wire-Feld darf nicht mitgehen");
    assert.equal(payload.column, "BACKLOG");
  });
});

test("create schickt bei toolbox.ideaStored: true weder direct noch ideaStored", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "In den Pool"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const payload = JSON.parse(requests.find((r) => r.method === "POST").body);
    assert.ok(!("direct" in payload), "ohne Direktwunsch kein direct");
    assert.ok(!("ideaStored" in payload));
  }, { config: { toolbox: { ideaStored: true } } });
});

// Der stille Fall: direkt angefordert, aber nur eine ideaId zurueck. Ohne eigenen
// Fehlerpfad meldete der Adapter hier `pending` samt Pool-Hinweis — das Anlegen
// saehe erfolgreich aus, die Karte haette keine Nummer, und niemand merkt es.
test("create bricht ab, wenn direct angefordert war und keine Nummer kam", async () => {
  await mitBoard(
    (req) => (req.method === "POST" ? { status: 200, json: { id: 80 } } : standardAntwort(req)),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "create", "--title", "Direkt"], MIT_TOKEN);
      assert.notEqual(res.status, 0, "muss scheitern statt pending zu melden");
      assert.match(res.stderr, /Direktes Anlegen lieferte keine Board-Nummer/);
      assert.ok(!/pending/.test(res.stdout), "kein pending im Erfolgskanal");
      assert.ok(!/Ideen-Pool/.test(res.stdout), "kein Pool-Hinweis");
      // Ohne gesetzten Schluessel kann diesen Abbruch seit Issue #313 auch ein
      // Projekt sehen, das ihn nie kannte — die Meldung muss den Weg zurueck nennen.
      assert.match(res.stderr, /toolbox\.ideaStored: true/);
    },
  );
});

// Aeltere Backends kennen weder Pool noch `direct` und liefern immer eine Nummer.
test("create liefert im Pool-Modus eine Legacy-Nummer ohne Pool-Hinweis", async () => {
  await mitBoard(standardAntwort, async (dir, _requests, host) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Alt"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { id: "7", url: `${host}/kanban` });
  }, { config: { toolbox: { ideaStored: true } } });
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

// --- Labels ---
//
// Der toolbox-Adapter hat den Schreibpfad lange verweigert, weil die kanbancompat-API
// angeblich kein atomares Setzen per Name bot. Seit kanban-kit#574 kann sie es
// (POST/DELETE /items/{id}/labels). Diese Tests nageln die drei Stellen fest, an denen
// eine naive Umsetzung falsch liegt (Issue #375).

// Adressiert wird die INTERNE Karten-ID, nicht die Kartennummer — wie bei move und
// comments. Karte 7 liegt intern unter 700: eine ungeprueft durchgereichte Nummer
// traefe eine fremde Karte oder nichts.
test("label add loest die Kartennummer in die interne ID auf", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "label", "add", "3", "review:offen"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items/300/labels");
    assert.ok(post, "POST auf die interne ID 300 erwartet");
  });
});

test("label add schickt den Namen als JSON-Rumpf", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "label", "add", "7", "review:offen"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items/700/labels");
    assert.deepEqual(JSON.parse(post.body), { name: "review:offen" });
  });
});

// Beim Entfernen steht der Name im Query, nicht im Pfad: der Server laesst jedes
// Zeichen ausser Leerstring zu, und ein Pfadsegment truege einen Slash nicht.
test("label remove nimmt den Namen im Query-Parameter", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "label", "remove", "7", "review:offen"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const del = requests.find((r) => r.method === "DELETE" && r.url.startsWith("/api/kanban/items/700/labels"));
    assert.ok(del, "DELETE auf die Label-Route erwartet");
    assert.equal(del.url, "/api/kanban/items/700/labels?name=review%3Aoffen");
  });
});

// Der Fall, an dem eine ungekapselte Query bricht.
test("label remove kodiert einen Namen mit Schraegstrich", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "label", "remove", "7", "bereich/ui"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const del = requests.find((r) => r.method === "DELETE" && r.url.startsWith("/api/kanban/items/700/labels"));
    assert.equal(del.url, "/api/kanban/items/700/labels?name=bereich%2Fui");
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
    const hostMuster = host.replaceAll(/[.]/g, String.raw`\.`);
    assert.match(res.stderr, new RegExp(`Toolbox-API nicht erreichbar \\(${hostMuster}\\)`));
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

// --- Labels bei `issue get` (Issue #312) ---
//
// Die Karten-API liefert Labels (gegen die Live-Instanz belegt am 2026-08-12);
// getIssue reichte sie nur nicht durch. Eine aeltere Antwort ohne das Feld bleibt
// bei [] — rueckwaertskompatibel, aber nie undefined.

test("get liefert die Labels als Namen-Array", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items"
      ? { status: 200, json: gruppiert([karte(7, "READY", { labels: ["kit:nightrun", "fix"] })]) }
      : { status: 200, json: [] }),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout).labels, ["kit:nightrun", "fix"]);
    },
  );
});

test("get ohne Label-Feld in der Antwort liefert ein leeres Array, nie undefined", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items"
      ? { status: 200, json: gruppiert([karte(7, "READY")]) }
      : { status: 200, json: [] }),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout).labels, []);
    },
  );
});

test("get und list liefern fuer dieselbe Karte dieselben Labels", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items"
      ? { status: 200, json: gruppiert([karte(7, "READY", { labels: [{ name: "kit:nightrun" }] })]) }
      : { status: 200, json: [] }),
    async (dir) => {
      const geholt = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
      const gelistet = await runBoardAsync(dir, ["issue", "list"], MIT_TOKEN);
      assert.equal(geholt.status, 0, geholt.stderr);
      assert.equal(gelistet.status, 0, gelistet.stderr);
      assert.deepEqual(
        JSON.parse(geholt.stdout).labels,
        JSON.parse(gelistet.stdout).find((i) => i.id === "7").labels,
      );
    },
  );
});

// --- Anlagedatum bei `issue get` (Issue #457) ---
//
// ACHTUNG: Anders als bei den Labels (#312) ist der Feldname der Karten-API hier
// NICHT gegen die Live-Instanz belegt. Diese Tests zeigen, dass der Adapter die
// drei plausiblen Formen verarbeitet und ohne Datum kein Feld erfindet — welche
// Form die Instanz tatsaechlich liefert (oder ob sie gar keine liefert), ist der
// manuelle Pruefpunkt an Issue #457.

test("get liefert das Anlagedatum als Kalendertag", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items"
      ? { status: 200, json: gruppiert([karte(7, "READY")]) }
      : { status: 200, json: [] }),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.match(JSON.parse(res.stdout).created, /^\d{4}-\d{2}-\d{2}$/);
    },
  );
});

test("get nimmt auch created_at und created als Anlagefeld", async () => {
  for (const feld of ["created_at", "created"]) {
    await mitBoard(
      (req) => (req.url === "/api/kanban/items"
        ? { status: 200, json: gruppiert([karte(7, "READY", { createdAt: undefined, [feld]: "2026-08-14T23:30:00+02:00" })]) }
        : { status: 200, json: [] }),
      async (dir) => {
        const res = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
        assert.equal(res.status, 0, res.stderr);
        assert.equal(JSON.parse(res.stdout).created, "2026-08-14", `Feld ${feld}`);
      },
    );
  }
});

// Liefert die Instanz gar kein Anlagefeld, fehlt `created` — kein erfundener Wert,
// sonst wertet das Gate ein altes Paket als neu (#450/#451 muessen damit rechnen).
test("get ohne Anlagefeld in der Antwort laesst created weg", async () => {
  await mitBoard(
    (req) => (req.url === "/api/kanban/items"
      ? { status: 200, json: gruppiert([karte(7, "READY", { createdAt: undefined })]) }
      : { status: 200, json: [] }),
    async (dir) => {
      const res = await runBoardAsync(dir, ["issue", "get", "7"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.equal("created" in JSON.parse(res.stdout), false);
    },
  );
});
