// Ablauf-Pruefung: `issue vorgeschichte` ueber das echte CLI (Issue #1539, Plan #1534).
//
// Das Kommando sucht fruehere Fachplaene des eigenen Boards: je Begriff ueber die Suche, je
// Datei ueber die Kartennummern der letzten Commits und deren Herkunftskette. Es fuehrt
// zusammen, ordnet, begrenzt und holt je Treffer die Karte. Geprueft wird gegen eine
// Attrappe des Toolbox-Servers auf 127.0.0.1 und ein Wegwerf-Git-Repository im Projekt.
// Die Antwortformen folgen test/board-adapter-toolbox-vorgeschichte.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { setupProjekt, starteServer, runBoardAsync } from "./helpers/board-fixture.mjs";

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

/** Ein Ziel-Abschnitt mit erkennbarem Anfang und genug Laenge fuer den Schnitt bei 200 Zeichen. */
function body(nummer) {
  return [
    "## Ziel", `Ziel von ${nummer}. ${"x".repeat(250)}`, "",
    "## Nicht-Ziele", "- nichts", "",
  ].join("\n");
}

/**
 * Die Attrappe: `karten` (Nummer -> { titel, archiviert? }), `suche` (Begriff -> Nummern),
 * `ketten` (Nummer -> Vorfahren in Server-Form). Eine Karte ohne Eintrag antwortet mit 404.
 */
function attrappe({ karten = {}, suche = {}, ketten = {} }) {
  return (req) => {
    const [pfad, query = ""] = req.url.split("?");
    if (pfad === "/api/kanban/search") {
      const nummern = suche[new URLSearchParams(query).get("q")] ?? [];
      const hits = nummern.map((n) => ({ number: n, title: karten[n]?.titel ?? `[Fachlich] ${n}`, archived: Boolean(karten[n]?.archiviert) }));
      return { status: 200, json: { hits, nextCursor: null } };
    }
    const kette = /^\/api\/kanban\/items\/by-number\/(\d+)\/lineage$/.exec(pfad);
    if (kette) return { status: 200, json: { card: { number: Number(kette[1]) }, ancestors: ketten[kette[1]] ?? [], descendants: [] } };
    const einzel = /^\/api\/kanban\/items\/by-number\/(\d+)$/.exec(pfad);
    if (einzel && karten[einzel[1]]) {
      const k = karten[einzel[1]];
      return { status: 200, json: {
        item: { id: Number(einzel[1]) * 10, number: Number(einzel[1]), title: k.titel, body: body(einzel[1]), labels: [] },
        archived: Boolean(k.archiviert), comments: [{ id: 1, body: "Kommentar" }],
      } };
    }
    return null;
  };
}

async function mitBoard(antwort, fn, config = {}) {
  const { server, requests, host } = await starteServer(antwort);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host }, vorgeschichte: true, ...config }, "board-vg-cli-");
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

/**
 * Startet das Kommando und liefert sein JSON; Exit 0 ist Pflicht. Asynchron, weil die Attrappe
 * im selben Prozess laeuft und ein spawnSync ihre Event-Loop blockierte.
 */
async function vorgeschichte(dir, args, env = MIT_TOKEN) {
  const res = await runBoardAsync(dir, ["issue", "vorgeschichte", ...args], env);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

const nurNetz = (requests) => requests.map((r) => r.url);

// --- Begriffe ---

test("Begriffe: nur [Fachlich]-Karten bleiben, zwei Begriffe auf dieselbe Nummer werden eins und ruecken nach vorn", async () => {
  const karten = { 10: { titel: "[Fachlich] Archiv lesen", archiviert: true }, 11: { titel: "[Plan] Archiv lesen" }, 12: { titel: "[Fachlich] Vorgeschichte" } };
  const suche = { Archiv: [10, 11, 12], Vorgeschichte: [12] };
  await mitBoard(attrappe({ karten, suche }), async (dir, requests) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv", "--begriffe", "Vorgeschichte"]);
    assert.equal(erg.ok, true);
    assert.deepEqual(erg.suchbegriffe, ["Archiv", "Vorgeschichte"]);
    assert.deepEqual(erg.dateien, []);
    assert.equal(erg.weitere, 0);
    assert.deepEqual(erg.treffer.map((t) => [t.nummer, t.titel, t.archiviert, t.weg]), [
      [12, "[Fachlich] Vorgeschichte", false, "suche"],
      [10, "[Fachlich] Archiv lesen", true, "suche"],
    ]);
    assert.equal(erg.treffer[0].auszug, `Ziel von 12. ${"x".repeat(250)}`.slice(0, 200));
    assert.equal(Object.hasOwn(erg.treffer[0], "body"), false, "ohne --bodies kein Body");
    assert.ok(!nurNetz(requests).includes("/api/kanban/items/by-number/11"), "die [Plan]-Karte wird nicht geholt");
  });
});

test("Obergrenze 20: der Rest steht in weitere, geordnet nach Nummer absteigend", async () => {
  const nummern = Array.from({ length: 25 }, (_, i) => 100 + i);
  const karten = Object.fromEntries(nummern.map((n) => [n, { titel: `[Fachlich] Karte ${n}` }]));
  await mitBoard(attrappe({ karten, suche: { Archiv: nummern } }), async (dir, requests) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv"]);
    assert.equal(erg.treffer.length, 20);
    assert.equal(erg.weitere, 5);
    assert.deepEqual(erg.treffer.map((t) => t.nummer), nummern.toReversed().slice(0, 20));
    assert.equal(nurNetz(requests).filter((u) => u.includes("/by-number/")).length, 20, "nur die 20 werden einzeln geholt");
  });
});

test("--ohne nimmt Nummern aus den Treffern, ohne sie zu holen", async () => {
  const karten = { 10: { titel: "[Fachlich] A" }, 12: { titel: "[Fachlich] B" } };
  await mitBoard(attrappe({ karten, suche: { Archiv: [10, 12] } }), async (dir, requests) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv", "--ohne", "12"]);
    assert.deepEqual(erg.treffer.map((t) => t.nummer), [10]);
    assert.equal(erg.weitere, 0);
    assert.ok(!nurNetz(requests).includes("/api/kanban/items/by-number/12"));
  });
});

test("--bodies liefert den Body ungekuerzt und ohne Kommentare", async () => {
  await mitBoard(attrappe({ karten: { 10: { titel: "[Fachlich] A" } }, suche: { Archiv: [10] } }), async (dir) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv", "--bodies"]);
    assert.equal(erg.treffer[0].body, body(10));
    assert.equal(Object.hasOwn(erg.treffer[0], "kommentare"), false);
  });
});

test("Leere Begriffs- und Dateiliste: nichts gefunden, ohne Netzaufruf", async () => {
  await mitBoard(attrappe({}), async (dir, requests) => {
    assert.deepEqual(await vorgeschichte(dir, []), { ok: true, suchbegriffe: [], dateien: [], treffer: [], weitere: 0 });
    assert.equal(requests.length, 0);
  });
});

// --- Dateiweg ---

function git(dir, ...args) {
  const res = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
}

/** Drei Commits an kit/a.mjs: mit `(Issue #50)`, mit `Refs #51` und einer ohne Nummer. */
function gitMitCommits(dir) {
  git(dir, "init", "-q");
  mkdirSync(join(dir, "kit"), { recursive: true });
  const commit = (inhalt, botschaft) => {
    writeFileSync(join(dir, "kit", "a.mjs"), inhalt);
    git(dir, "add", "kit/a.mjs");
    git(dir, "commit", "-q", "-m", botschaft);
  };
  commit("1", "Erster Stand (Issue #50)\n\nRefs #50");
  commit("2", "Korrektur\n\nRefs #51");
  commit("3", "Ohne Karte");
}

test("Dateiweg: Kartennummern aus den Commits, Herkunftskette bis zum Fachplan, Luecken uebersprungen", async () => {
  const karten = { 20: { titel: "[Fachlich] Herkunft X", archiviert: true }, 31: { titel: "[Fachlich] Herkunft Y" }, 60: { titel: "[Fachlich] Nur gesucht" } };
  const ketten = {
    50: [
      { number: 45, title: "[Fachlich] im Papierkorb", archived: false, gap: true },
      { number: 30, title: "[Plan] Plan P", archived: true, gap: false },
      { number: 20, title: "[Fachlich] Herkunft X", archived: true, gap: false },
    ],
    51: [{ number: 31, title: "[Fachlich] Herkunft Y", archived: false, gap: false }],
  };
  await mitBoard(attrappe({ karten, ketten, suche: { Archiv: [20, 60] } }), async (dir, requests) => {
    gitMitCommits(dir);
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv", "--dateien", "kit/a.mjs"]);
    assert.deepEqual(erg.dateien, ["kit/a.mjs"]);
    assert.deepEqual(erg.treffer.map((t) => [t.nummer, t.weg, t.archiviert]), [
      [60, "suche", false],
      [20, "suche", true],
      [31, "datei", false],
    ]);
    assert.ok(nurNetz(requests).includes("/api/kanban/items/by-number/50/lineage"));
    assert.ok(nurNetz(requests).includes("/api/kanban/items/by-number/51/lineage"));
    assert.ok(!nurNetz(requests).includes("/api/kanban/items/by-number/45"), "die Luecke wird nicht geholt");
  });
});

// --- Fehlschlaege ---

test("HTTP-Fehler: archiv-nicht-erreichbar nach genau einem Aufruf an die Attrappe", async () => {
  await mitBoard(() => ({ status: 500, json: { message: "Archiv kaputt" } }), async (dir, requests) => {
    gitMitCommits(dir);
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv", "--begriffe", "Vorgeschichte", "--dateien", "kit/a.mjs"]);
    assert.equal(erg.ok, false);
    assert.equal(erg.grund, "archiv-nicht-erreichbar");
    assert.match(erg.meldung, /Archiv kaputt/);
    assert.equal(requests.length, 1);
  });
});

test("Alle Einzelabrufe 404: archiv-nicht-erreichbar statt nichts gefunden", async () => {
  await mitBoard(attrappe({ suche: { Archiv: [10, 12] } }), async (dir) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv"]);
    assert.equal(erg.ok, false);
    assert.equal(erg.grund, "archiv-nicht-erreichbar");
    assert.equal(typeof erg.meldung, "string");
  });
});

test("Einzelne 404: der Treffer wird uebersprungen und nicht gezaehlt", async () => {
  await mitBoard(attrappe({ karten: { 10: { titel: "[Fachlich] A" } }, suche: { Archiv: [10, 12] } }), async (dir) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv"]);
    assert.equal(erg.ok, true);
    assert.deepEqual(erg.treffer.map((t) => t.nummer), [10]);
    assert.equal(erg.weitere, 0);
  });
});

test("Fehlendes Token: archiv-nicht-erreichbar ohne Aufruf an den Server", async () => {
  await mitBoard(attrappe({ suche: { Archiv: [10] } }), async (dir, requests) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv"], {});
    assert.equal(erg.ok, false);
    assert.equal(erg.grund, "archiv-nicht-erreichbar");
    assert.match(erg.meldung, /Token/);
    assert.equal(requests.length, 0);
  });
});

test("Lokaler Tracker: tracker-ohne-suche", async () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" }, vorgeschichte: true }, "board-vg-cli-");
  try {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv"]);
    assert.equal(erg.ok, false);
    assert.equal(erg.grund, "tracker-ohne-suche");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Schalter aus: abgeschaltet, ohne Aufruf an den Server", async () => {
  await mitBoard(attrappe({ suche: { Archiv: [10] } }), async (dir, requests) => {
    const erg = await vorgeschichte(dir, ["--begriffe", "Archiv"]);
    assert.equal(erg.ok, false);
    assert.equal(erg.grund, "abgeschaltet");
    assert.equal(requests.length, 0);
  }, { vorgeschichte: false });
});

// --- Hilfe ---

test("--help nennt das Kommando unter beiden Namen", async () => {
  await mitBoard(attrappe({}), async (dir, requests) => {
    for (const befehl of ["vorgeschichte", "history"]) {
      const res = await runBoardAsync(dir, ["issue", befehl, "--help"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /issue history/);
    }
    assert.equal(requests.length, 0);
  });
});
