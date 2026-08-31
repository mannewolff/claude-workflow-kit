// Validierung der Exportdatei und die unerwarteten Antworten (Issue #405).
//
// Die Exportdatei ist die Schnittstelle zwischen zwei Laeufen, oft mit Tagen
// dazwischen und von Hand nachbearbeitet. Sie wird deshalb Eintrag fuer Eintrag
// geprueft, BEVOR der erste Schreibzugriff passiert — und jede Meldung nennt die
// Stelle ("Eintrag 3, Kommentar 2"), weil eine Datei mit hunderten Eintraegen sonst
// nicht zu reparieren ist.
//
// Dazu die Gegenstuecke auf der anderen Seite: eine GraphQL-Antwort, die nicht die
// erwartete Form hat, ein Kartenbestand, der kein Objekt ist, eine Create-Antwort
// ohne id. Alle drei enden mit einer eigenen Meldung statt mit `undefined`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupProjekt, fakeCli, starteServer } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATE = join(repoRoot, "tools", "migrate-issues.mjs");
const REPO_URL = "https://github.com/mannewolff/claude-workflow-kit";
const TOKEN = "fixture-token";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-Binary ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197 und #231." }
  : {};

function runMigrate(dir, cliArgs, extraEnv = {}) {
  const env = { ...process.env };
  delete env.KIT_AGENT_MODEL;
  Object.assign(env, {
    PATH: `${join(dir, "fakebin")}:${process.env.PATH}`,
    TBX_TOKEN: TOKEN,
    TBX_CONFIG_DIR: join(dir, "tbx-config"),
  }, extraEnv);
  return new Promise((fertig) => {
    execFile(process.execPath, [MIGRATE, ...cliArgs], { cwd: dir, env }, (err, stdout, stderr) => {
      fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

function gueltig(number = 101, extra = {}) {
  return { number, title: `Issue ${number}`, body: "Body", comments: [], labels: [], spalte: "Backlog", ...extra };
}

/** Fixture ohne Server: Die Validierung greift vor jedem Netzzugriff. */
function fixture(praefix, daten) {
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host: "http://127.0.0.1:9" } },
    praefix
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, typeof daten === "string" ? daten : JSON.stringify(daten, null, 2), "utf-8");
  return { dir, datei, ende: () => rmSync(dir, { recursive: true, force: true }) };
}

// ============================================================
// Form der Exportdatei
// ============================================================

// Jeder Fall nennt die Stelle UND das Feld — beides zusammen macht die Datei
// reparierbar. Die Tabelle haelt die Meldungen fest, damit eine Umformulierung
// auffaellt statt still die Diagnose zu verschlechtern.
const FORMFEHLER = [
  { was: "kein Array", daten: { number: 101 }, meldung: /enthaelt kein Array von Eintraegen/ },
  { was: "ein Eintrag ist kein Objekt", daten: ["text"], meldung: /Eintrag 1: kein Objekt/ },
  { was: "ein Eintrag ist ein Array", daten: [[]], meldung: /Eintrag 1: kein Objekt/ },
  { was: "number fehlt", daten: [{ ...gueltig(), number: undefined }], meldung: /Eintrag 1: 'number' fehlt oder ist keine Ganzzahl/ },
  { was: "number ist keine Ganzzahl", daten: [gueltig(1.5)], meldung: /Eintrag 1: 'number' fehlt oder ist keine Ganzzahl/ },
  { was: "title ist kein Text", daten: [gueltig(101, { title: 7 })], meldung: /Eintrag 1: 'title'/ },
  { was: "body fehlt", daten: [gueltig(101, { body: undefined })], meldung: /Eintrag 1: 'body'/ },
  { was: "labels fehlt", daten: [gueltig(101, { labels: undefined })], meldung: /Eintrag 1: 'labels' fehlt oder ist keine Liste von Namen/ },
  { was: "labels enthaelt keine Namen", daten: [gueltig(101, { labels: [1, 2] })], meldung: /Eintrag 1: 'labels' fehlt oder ist keine Liste von Namen/ },
  { was: "spalte ist weder Text noch null", daten: [gueltig(101, { spalte: 7 })], meldung: /Eintrag 1: 'spalte' muss ein Text oder null sein/ },
  { was: "comments fehlt", daten: [gueltig(101, { comments: undefined })], meldung: /Eintrag 1: 'comments' fehlt oder ist keine Liste/ },
  { was: "ein Kommentar ist kein Objekt", daten: [gueltig(101, { comments: ["text"] })], meldung: /Eintrag 1, Kommentar 1: kein Objekt/ },
  { was: "einem Kommentar fehlt der author", daten: [gueltig(101, { comments: [{ body: "b", createdAt: "c" }] })], meldung: /Eintrag 1, Kommentar 1: 'author'/ },
  { was: "eine Nummer kommt doppelt vor", daten: [gueltig(101), gueltig(101)], meldung: /Issue-Nummer 101 kommt mehrfach vor/ },
];

for (const fall of FORMFEHLER) {
  test(`import weist die Exportdatei zurueck: ${fall.was}`, async () => {
    const f = fixture("migrate-form-", fall.daten);
    try {
      const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
      assert.equal(res.status, 1, `import haette mit Exit 1 enden muessen: ${res.stdout}${res.stderr}`);
      assert.match(res.stderr, fall.meldung, "die Meldung benennt die Fundstelle nicht");
    } finally {
      f.ende();
    }
  });
}

test("die Pruefung greift vor jedem Netzzugriff", async () => {
  const { server, requests, host } = await starteServer(() => ({ status: 200, json: {} }));
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    "migrate-form-vor-netz-"
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([gueltig(101), "kaputt"], null, 2), "utf-8");
  try {
    const res = await runMigrate(dir, ["import", "--file", datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.equal(requests.length, 0,
      "die Validierung hat den Server erreicht — ein halb angelegter Bestand waere die Folge");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Unerwartete Antworten der Gegenseite
// ============================================================

test("ein Kartenbestand, der kein Objekt ist, wird als solcher gemeldet", NUR_POSIX, async () => {
  const { server, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, text: '"kein Objekt"' };
    return undefined;
  });
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    "migrate-bestand-kaputt-"
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([gueltig(101)], null, 2), "utf-8");
  try {
    const res = await runMigrate(dir, ["import", "--file", datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /Unerwartete Antwort beim Lesen des Kartenbestands/,
      "die unerwartete Bestandsantwort wird nicht benannt");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eine Create-Antwort ohne id bricht ab, sobald Kommentare anzuhaengen waeren", NUR_POSIX, async () => {
  const { server, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: {} };
    // Die Karte entsteht, aber die Antwort nennt keine id — die Kommentare haetten
    // kein Ziel. Stillschweigend weiterzumachen hiesse, sie zu verlieren.
    if (req.method === "POST" && req.url === "/api/kanban/items") return { status: 200, json: { number: 101 } };
    return undefined;
  });
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    "migrate-create-ohne-id-"
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([
    gueltig(101, { comments: [{ author: "a", body: "b", createdAt: "2026-01-01T00:00:00Z" }] }),
  ], null, 2), "utf-8");
  try {
    const res = await runMigrate(dir, ["import", "--file", datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /Create-Response zu Issue #101 enthaelt keine 'id'/,
      "die fehlende id wird nicht benannt");
    // Die Bilanz zaehlt den Fehlschlag — sie ist der Ansatzpunkt des naechsten Laufs.
    const letzte = res.stdout.trim().split("\n").findLast(Boolean);
    assert.equal(JSON.parse(letzte).failed, 1, "der Fehlschlag steht nicht in der Bilanz");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eine Create-Antwort ohne id genuegt, solange es keine Kommentare gibt", NUR_POSIX, async () => {
  const { server, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: {} };
    if (req.method === "POST" && req.url === "/api/kanban/items") return { status: 200, json: { number: 101 } };
    return undefined;
  });
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    "migrate-create-ohne-id-ok-"
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([gueltig(101)], null, 2), "utf-8");
  try {
    const res = await runMigrate(dir, ["import", "--file", datei, "--yes"]);

    assert.equal(res.status, 0, `import haette durchlaufen muessen: ${res.stderr}`);
    const letzte = res.stdout.trim().split("\n").findLast(Boolean);
    assert.equal(JSON.parse(letzte).created, 1, "die Karte wurde nicht als angelegt gezaehlt");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eine GraphQL-Antwort in unerwarteter Form nennt den gelesenen Gegenstand", NUR_POSIX, async () => {
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, "migrate-graphql-kaputt-");
  fakeCli(dir, "gh", [
    { match: "repo view", stdout: "mannewolff/claude-workflow-kit\n" },
    // Syntaktisch gueltiges JSON, aber ohne die erwartete Verbindung: genau der Fall,
    // den ein API-Umbau auf der Gegenseite erzeugt.
    { match: "api graphql", stdout: '{"data":{"repository":{}}}\n' },
  ]);
  try {
    const res = await runMigrate(dir, ["export"]);

    assert.equal(res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /Unerwartete Antwort beim Lesen von /,
      "die Meldung nennt nicht, was gelesen werden sollte");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("liefert gh kein gueltiges JSON, steht der Anfang der Ausgabe im Fehler", NUR_POSIX, async () => {
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, "migrate-kein-json-");
  fakeCli(dir, "gh", [
    { match: "repo view", stdout: "mannewolff/claude-workflow-kit\n" },
    { match: "api graphql", stdout: "<html>Rate limit</html>\n" },
  ]);
  try {
    const res = await runMigrate(dir, ["export"]);

    assert.equal(res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /lieferte kein gueltiges JSON/, "die Meldung nennt das Problem nicht");
    assert.match(res.stderr, /Rate limit/,
      "ohne den Anfang der Ausgabe ist nicht erkennbar, was stattdessen kam");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
