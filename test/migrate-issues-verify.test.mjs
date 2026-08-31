// verify-Lauf des Migrationswerkzeugs (Issue #290).
//
// Aufbau wie beim import-Test (#289): das ECHTE Script mit cwd in einem Fixture-
// Verzeichnis, kanban-kit als lokaler HTTP-Mock. verify liest nur — der Mock
// zeichnet jeden Request auf, damit "keine Schreibzugriffe" nicht bloss behauptet,
// sondern belegt wird.
//
// Die Exit-Codes trennen zwei Lagen, die man nicht verwechseln darf:
//   1 = fachliche Abweichung (das Gate schlaegt an, die Daten stimmen nicht)
//   2 = Betriebsfehler (die Pruefung konnte gar nicht stattfinden)
// Ein Kommentar-Endpunkt, der 404 liefert, ist Lage 2 und nicht "null Kommentare" —
// sonst waere ein ausgefallener Endpunkt von echtem Datenverlust ununterscheidbar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupProjekt, fakeCli, starteServer } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATE = join(repoRoot, "tools", "migrate-issues.mjs");

const REPO_URL = "https://github.com/mannewolff/claude-workflow-kit";
const TOKEN = "fixture-token";

function issueUrl(number) {
  return `${REPO_URL}/issues/${number}`;
}

function eintrag(number, extra = {}) {
  return {
    number,
    title: `Issue ${number}`,
    body: `Body ${number}`,
    comments: [],
    labels: [],
    spalte: "Backlog",
    ...extra,
  };
}

/** Die Karte, wie sie nach einem Import aussieht: Kopfzeile + Original-Body. */
function karte(quelle, extra = {}) {
  const spalte = quelle.spalte == null || String(quelle.spalte).trim() === "" ? "keine" : quelle.spalte;
  return {
    id: 5000 + quelle.number,
    number: quelle.number,
    title: quelle.title,
    body: `> Quelle: ${issueUrl(quelle.number)}\n> Ursprüngliche Spalte: ${spalte}\n\n${quelle.body}`,
    column: "BACKLOG",
    ...extra,
  };
}

/**
 * Mock der Lese-API. `kommentare` bildet Karten-ID auf die Kommentarliste ab.
 * `kommentarFehler` laesst den Kommentar-Endpunkt scheitern (Betriebsfehler-Pfad).
 */
function kanbanMock(karten = [], { kommentare = {}, kommentarFehler = null } = {}) {
  const gruppiert = {};
  for (const k of karten) {
    (gruppiert[k.column] ??= []).push(k);
  }
  return (req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") {
      return { status: 200, json: gruppiert };
    }
    const treffer = /^\/api\/kanban\/items\/(\d+)\/comments$/.exec(req.url);
    if (req.method === "GET" && treffer) {
      if (kommentarFehler === "404") return { status: 404, json: { message: "nicht da" } };
      if (kommentarFehler === "500") return { status: 500, json: { message: "kaputt" } };
      if (kommentarFehler === "kaputt") return { status: 200, json: { keinArray: true } };
      return { status: 200, json: kommentare[treffer[1]] ?? [] };
    }
    return undefined;
  };
}

async function fixture(praefix, { daten = [], karten = [], mockOptionen = {} } = {}) {
  const { server, requests, host } = await starteServer(kanbanMock(karten, mockOptionen));
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    praefix
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);

  const datei = join(dir, "export.json");
  writeFileSync(datei, typeof daten === "string" ? daten : JSON.stringify(daten, null, 2), "utf-8");

  return {
    dir,
    datei,
    requests,
    ende() {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function runMigrate(dir, cliArgs) {
  const env = { ...process.env };
  delete env.KIT_AGENT_MODEL;
  Object.assign(env, {
    PATH: `${join(dir, "fakebin")}:${process.env.PATH}`,
    TBX_TOKEN: TOKEN,
    TBX_CONFIG_DIR: join(dir, "tbx-config"),
  });
  return new Promise((fertig) => {
    execFile(process.execPath, [MIGRATE, ...cliArgs], { cwd: dir, env }, (err, stdout, stderr) => {
      fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** Die Abweichungszeilen ohne die Schlusszeile. */
function abweichungen(res) {
  return res.stdout.trim().split("\n").filter((z) => z.startsWith("#"));
}

function schlusszeile(res) {
  const zeilen = res.stdout.trim().split("\n").filter(Boolean);
  return zeilen.at(-1);
}

// ------------------------------------------------------------
// Deckungsgleich
// ------------------------------------------------------------

test("verify: deckungsgleicher Bestand meldet null Abweichungen und Exit 0", async () => {
  const quellen = [eintrag(101), eintrag(102)];
  const f = await fixture("verify-gleich", { daten: quellen, karten: quellen.map((q) => karte(q)) });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(abweichungen(res), []);
    assert.match(schlusszeile(res), /^2 Karten geprüft, 0 Abweichungen$/);
  } finally {
    f.ende();
  }
});

test("verify: eine importierte Karte gilt trotz Herkunfts-Kopfzeile als body-gleich", async () => {
  const quelle = eintrag(101, { body: 'Umlaute: ä ö ü ß\n\n```js\nconst p = "C:\\\\tmp";\n```\n' });
  const f = await fixture("verify-kopfzeile", { daten: [quelle], karten: [karte(quelle)] });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(abweichungen(res), []);
  } finally {
    f.ende();
  }
});

// ------------------------------------------------------------
// Fachliche Abweichungen (Exit 1)
// ------------------------------------------------------------

test("verify: geaenderter Titel wird gemeldet, Exit 1", async () => {
  const quelle = eintrag(101);
  const f = await fixture("verify-titel", {
    daten: [quelle],
    karten: [karte(quelle, { title: "Etwas anderes" })],
  });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 1);
    const zeilen = abweichungen(res);
    assert.equal(zeilen.length, 1);
    assert.match(zeilen[0], /^#101 field=title source="Issue 101" target="Etwas anderes"$/);
  } finally {
    f.ende();
  }
});

test("verify: geaenderter Body bei GLEICHER Laenge wird erkannt", async () => {
  const quelle = eintrag(101, { body: "abcdefghij" });
  const gefaelscht = karte(quelle);
  gefaelscht.body = gefaelscht.body.replace("abcdefghij", "abcdefghiX");
  const f = await fixture("verify-body-gleichlang", { daten: [quelle], karten: [gefaelscht] });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 1);
    assert.match(abweichungen(res)[0], /^#101 field=body /);
  } finally {
    f.ende();
  }
});

test("verify: geaenderter Kommentar-Body bei gleicher Anzahl wird erkannt", async () => {
  const quelle = eintrag(101, {
    comments: [{ author: "a", body: "Erster", createdAt: "2026-01-01T00:00:00Z" }],
  });
  const k = karte(quelle);
  const f = await fixture("verify-kommentar-inhalt", {
    daten: [quelle],
    karten: [k],
    mockOptionen: { kommentare: { [k.id]: [{ author: "a", body: "Zweiter", createdAt: "2026-01-01T00:00:00Z" }] } },
  });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 1);
    assert.match(abweichungen(res)[0], /^#101 field=comment\[0\] /);
  } finally {
    f.ende();
  }
});

test("verify: im Ziel fehlende Karte wird als field=card target=null gemeldet", async () => {
  const f = await fixture("verify-fehlt", { daten: [eintrag(101)], karten: [] });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 1);
    assert.match(abweichungen(res)[0], /^#101 field=card source=.* target=null$/);
  } finally {
    f.ende();
  }
});

test("verify: abweichende Spalte wird gemeldet, Schreibweise allein nicht", async () => {
  const a = eintrag(101, { spalte: "Ready" });
  const b = eintrag(102, { spalte: "In progress" });
  const f = await fixture("verify-spalte", {
    daten: [a, b],
    karten: [karte(a, { column: "DONE" }), karte(b, { column: "IN_PROGRESS" })],
  });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 1);
    const zeilen = abweichungen(res);
    assert.equal(zeilen.length, 1, `nur #101 darf abweichen: ${zeilen.join(" | ")}`);
    assert.match(zeilen[0], /^#101 field=spalte source="ready" target="done"$/);
  } finally {
    f.ende();
  }
});

test("verify: Quelle ohne Spalte gegen Backlog-Zielkarte ist keine Abweichung", async () => {
  const quelle = eintrag(101, { spalte: null });
  const f = await fixture("verify-spalte-null", { daten: [quelle], karten: [karte(quelle)] });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(abweichungen(res), []);
  } finally {
    f.ende();
  }
});

// ------------------------------------------------------------
// Betriebsfehler (Exit 2)
// ------------------------------------------------------------

for (const [name, fehler] of [["404", "404"], ["500", "500"], ["ungueltigem JSON", "kaputt"]]) {
  test(`verify: Kommentar-Endpunkt mit ${name} ist Betriebsfehler, Exit 2`, async () => {
    const quelle = eintrag(101);
    const f = await fixture(`verify-komm-${fehler}`, {
      daten: [quelle],
      karten: [karte(quelle)],
      mockOptionen: { kommentarFehler: fehler },
    });
    try {
      const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
      assert.equal(res.status, 2, res.stdout + res.stderr);
      assert.match(res.stderr, /Kommentare nicht prüfbar/);
    } finally {
      f.ende();
    }
  });
}

test("verify: fehlendes --in ist Exit 2", async () => {
  const f = await fixture("verify-ohne-in", { daten: [eintrag(101)] });
  try {
    const res = await runMigrate(f.dir, ["verify"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /--in/);
  } finally {
    f.ende();
  }
});

test("verify: nicht lesbare Datei und ungueltiges JSON sind Exit 2", async () => {
  const f = await fixture("verify-json", { daten: "{kein json" });
  try {
    const fehlt = await runMigrate(f.dir, ["verify", "--in", join(f.dir, "gibtsnicht.json")]);
    assert.equal(fehlt.status, 2);
    const kaputt = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(kaputt.status, 2);
  } finally {
    f.ende();
  }
});

// ------------------------------------------------------------
// Bereich
// ------------------------------------------------------------

test("verify: --from/--to schraenkt inklusive ein", async () => {
  const quellen = [eintrag(100), eintrag(101), eintrag(102), eintrag(103)];
  // Nur 100 und 103 weichen ab — beide liegen ausserhalb von 101..102.
  const karten = [
    karte(quellen[0], { title: "kaputt" }),
    karte(quellen[1]),
    karte(quellen[2]),
    karte(quellen[3], { title: "kaputt" }),
  ];
  const f = await fixture("verify-bereich", { daten: quellen, karten });
  try {
    const drin = await runMigrate(f.dir, ["verify", "--in", f.datei, "--from", "101", "--to", "102"]);
    assert.equal(drin.status, 0, drin.stdout + drin.stderr);
    assert.match(schlusszeile(drin), /^2 Karten geprüft, 0 Abweichungen$/);

    const grenzen = await runMigrate(f.dir, ["verify", "--in", f.datei, "--from", "100", "--to", "103"]);
    assert.equal(grenzen.status, 1);
    assert.equal(abweichungen(grenzen).length, 2, "beide Grenzen werden geprüft");
  } finally {
    f.ende();
  }
});

test("verify: from > to ist Exit 2, leerer gueltiger Bereich ist Exit 0", async () => {
  const f = await fixture("verify-bereich-leer", { daten: [eintrag(101)], karten: [karte(eintrag(101))] });
  try {
    const verdreht = await runMigrate(f.dir, ["verify", "--in", f.datei, "--from", "200", "--to", "100"]);
    assert.equal(verdreht.status, 2);

    const leer = await runMigrate(f.dir, ["verify", "--in", f.datei, "--from", "900", "--to", "999"]);
    assert.equal(leer.status, 0, leer.stdout + leer.stderr);
    assert.match(schlusszeile(leer), /^0 Karten geprüft, 0 Abweichungen$/);
  } finally {
    f.ende();
  }
});

// ------------------------------------------------------------
// Keine Schreibzugriffe
// ------------------------------------------------------------

test("verify: nutzt ausschliesslich GET und laesst die Exportdatei bytegleich", async () => {
  const quellen = [eintrag(101), eintrag(102)];
  const f = await fixture("verify-readonly", { daten: quellen, karten: quellen.map((q) => karte(q)) });
  try {
    const vorher = readFileSync(f.datei);
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);
    assert.equal(res.status, 0, res.stderr);
    const methoden = [...new Set(f.requests.map((r) => r.method))];
    assert.deepEqual(methoden, ["GET"], `nur GET erwartet, war: ${methoden.join(", ")}`);
    assert.deepEqual(readFileSync(f.datei), vorher);
  } finally {
    f.ende();
  }
});
