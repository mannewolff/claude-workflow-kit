// Tests fuer `issue create --derived-from` (Issue #356).
//
// Das Kit schreibt die Abstammung bisher nur als Body-Zeilen (`Plan: Issue #M`,
// `Fachliche Quelle: Issue #N`) — fuer einen Menschen lueckenlos, fuer das Board
// unsichtbar. kanban-kit nimmt seit 2026-08-26 ein `derivedFrom` am Ingest entgegen;
// hier entsteht der Sender dafuer.
//
// Zwei Dinge werden besonders festgenagelt:
//
//  1. Das NACKTE Flag. `parseArgs` macht aus `--derived-from` ohne Wert ein `true`,
//     und `Number(true) === 1`. Eine Pruefung ueber Number/isInteger/> 0 laesst das
//     durch und sendet still `derivedFrom: 1` — eine falsche Herkunft, die kein
//     Erfolgstest bemerkt. Deshalb ein eigener Zweig, wie ihn `kontextOption` fuer
//     --project/--date schon vormacht.
//  2. Dass github, gitlab und local die Option folgenlos schlucken. Sie bekommen
//     keinen Code; ihre Signaturen ignorieren einen zusaetzlichen Schluessel heute
//     schon. Genau das soll ein Test halten, damit eine spaetere Signaturaenderung
//     es nicht unbemerkt bricht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import {
  setupProjekt, runBoard, runBoardAsync, starteServer, fakeCli,
} from "./helpers/board-fixture.mjs";

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." }
  : {};

function standardAntwort(req) {
  if (req.url === "/api/kanban/items" && req.method === "GET") return { status: 200, json: {} };
  if (req.url === "/api/kanban/items" && req.method === "POST") return { status: 200, json: { id: 700, number: 7 } };
  return null;
}

/** Wie in board-toolbox.test.mjs: Mock-Server, Fixture, Aufraeumen. */
async function mitBoard(antwort, fn, { config = {} } = {}) {
  const { server, requests, host } = await starteServer(antwort);
  const dir = setupProjekt(
    { codeHost: "local", issueTracker: "toolbox", ...config, toolbox: { host, ...config.toolbox } },
    "board-derived-"
  );
  try {
    return await fn(dir, requests, host);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

const postRumpf = (requests) => JSON.parse(requests.find((r) => r.method === "POST").body);

// --- toolbox: der Sender ---

test("create sendet derivedFrom als JSON-Zahl", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Kind", "--derived-from", "42"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const payload = postRumpf(requests);
    assert.equal(payload.derivedFrom, 42);
    // Der Unterschied ist nicht kosmetisch: parseArgs liefert den String "42", und
    // ein String im Feld waere serverseitig ein anderer Typ als die Kartennummer.
    assert.notEqual(payload.derivedFrom, "42");
    assert.equal(typeof payload.derivedFrom, "number");
  });
});

test("create ohne die Option schickt den Schluessel gar nicht mit", async () => {
  await mitBoard(standardAntwort, async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Wurzel"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const payload = postRumpf(requests);
    assert.ok(!("derivedFrom" in payload), "ohne Option darf der Schluessel nicht im Payload stehen");
  });
});

// Der Fall, auf den es ankommt: Eine board-lose Pool-Idee ist fuer den Adapter
// spaeter unerreichbar (kein get, kein comment, kein update), und der idempotente
// Wiederholungs-Ingest verwirft ein nachgereichtes derivedFrom. Geht der Verweis
// hier nicht mit, geht er nie mehr mit.
test("create schickt derivedFrom auch an eine board-lose Pool-Idee", async () => {
  await mitBoard(
    (req) => (req.method === "POST" ? { status: 200, json: { id: 80 } } : standardAntwort(req)),
    async (dir, requests) => {
      const res = await runBoardAsync(dir, ["issue", "create", "--title", "Idee", "--derived-from", "17"], MIT_TOKEN);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(JSON.parse(res.stdout).pending, true);
      assert.equal(postRumpf(requests).derivedFrom, 17);
    },
    // Ohne ideaStored: true griffe der direct-Waechter und der Lauf endete mit
    // Exit 1 — der Test pruefte dann einen Fehlerpfad statt des Pool-Falls.
    { config: { toolbox: { ideaStored: true } } }
  );
});

// --- toolbox: die Formfehler ---

const FORMFEHLER = [
  { name: "Text statt Zahl", argv: ["--derived-from", "abc"] },
  { name: "negative Zahl", argv: ["--derived-from", "-1"] },
  { name: "Null", argv: ["--derived-from", "0"] },
  { name: "Kommazahl", argv: ["--derived-from", "1.5"] },
  { name: "nacktes Flag am Zeilenende", argv: ["--derived-from"] },
  { name: "nacktes Flag vor einer weiteren Option", argv: ["--derived-from", "--body", "Autor-Modell: m\nText"] },
];

for (const fall of FORMFEHLER) {
  test(`create bricht bei ${fall.name} ab, ohne das Netz zu beruehren`, async () => {
    await mitBoard(standardAntwort, async (dir, requests) => {
      const res = await runBoardAsync(dir, ["issue", "create", "--title", "Kaputt", ...fall.argv], MIT_TOKEN);
      assert.equal(res.status, 1, `erwartet Exit 1, war ${res.status}: ${res.stdout}`);
      assert.match(res.stderr, /derived-from/, "die Meldung muss die Option benennen");
      assert.equal(requests.length, 0, "die Formpruefung muss vor jedem Netzaufruf greifen");
    });
  });
}

// --- github, gitlab, local: annehmen und ignorieren ---

test("github nimmt die Option an und veraendert die Ausgabe nicht", NUR_POSIX, () => {
  const regeln = [
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^issue create", stdout: "https://github.com/besitzer/mein-repo/issues/5\n" },
    { match: "^project list", stdout: { projects: [] } },
  ];
  const laufe = (extra) => {
    const dir = setupProjekt({ codeHost: "github", issueTracker: "github" }, "board-derived-gh-");
    fakeCli(dir, "gh", regeln);
    try {
      return runBoard(dir, ["issue", "create", "--title", "Kind", ...extra]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const ohne = laufe([]);
  const mit = laufe(["--derived-from", "42"]);
  assert.equal(mit.status, 0, mit.stderr);
  assert.equal(mit.stdout, ohne.stdout);
});

test("gitlab nimmt die Option an und veraendert die Ausgabe nicht", NUR_POSIX, () => {
  const regeln = [{ match: "^issue create", stdout: "https://gitlab.com/o/r/-/issues/5\n" }];
  const laufe = (extra) => {
    const dir = setupProjekt({ codeHost: "gitlab", issueTracker: "gitlab" }, "board-derived-gl-");
    fakeCli(dir, "glab", regeln);
    try {
      return runBoard(dir, ["issue", "create", "--title", "Kind", ...extra]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const ohne = laufe([]);
  const mit = laufe(["--derived-from", "42"]);
  assert.equal(mit.status, 0, mit.stderr);
  assert.equal(mit.stdout, ohne.stdout);
});

// Byte-Gleichheit gibt es hier in keiner Variante: LocalIssueTracker.createIssue
// liefert { id, path }, und der Pfad zeigt ins jeweilige Fixture. Verglichen wird
// deshalb nach Ersetzen des Fixture-Verzeichnisses — die id muss in beiden Laeufen
// `0001` sein, weil jeder Lauf ein frisches Projekt bekommt.
//
// Normalisiert wird die GEPARSTE Ausgabe, nicht der rohe Text (Issue #374). stdout
// ist JSON: unter Windows steht jeder Backslash des Pfades dort in der escapten Form
// (`C:\\Users\\...`), waehrend das `dir` aus mkdtempSync die einfache traegt. Ein
// `split(dir)` auf dem Rohtext kann deshalb nie greifen — das zufaellige
// mkdtemp-Suffix bleibt stehen und die beiden Laeufe sind nie gleich. Unter POSIX
// faellt das nicht auf, weil es dort keine Backslashes zu escapen gibt; die Luecke
// ist strukturell nur auf Windows sichtbar und hat v1.40.0 mit rotem Gate passieren
// lassen.
test("local nimmt die Option an und veraendert die Ausgabe nicht", () => {
  const laufe = (extra) => {
    const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-derived-lo-");
    try {
      const res = runBoard(dir, ["issue", "create", "--title", "Kind", ...extra]);
      // Vor dem Parsen pruefen: sonst verdeckt ein SyntaxError die stderr-Meldung.
      assert.equal(res.status, 0, res.stderr);
      const roh = JSON.parse(res.stdout);
      return { res, normalisiert: { ...roh, path: String(roh.path).split(dir).join("<FIXTURE>") } };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const ohne = laufe([]);
  const mit = laufe(["--derived-from", "42"]);
  assert.equal(mit.normalisiert.id, "0001");
  assert.deepEqual(mit.normalisiert, ohne.normalisiert);
});

// --- CLI ---

test("--help nennt die Option", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-derived-help-");
  try {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /--derived-from/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
