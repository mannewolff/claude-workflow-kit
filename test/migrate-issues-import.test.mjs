// Import-Lauf des Migrationswerkzeugs (Issue #289).
//
// Wie beim export-Lauf laeuft das ECHTE Script aus dem Repo mit cwd in einem
// Fixture-Verzeichnis. kanban-kit wird nicht als Fake-Binary, sondern als lokaler
// HTTP-Mock nachgestellt (starteServer aus test/helpers/board-fixture.mjs, Muster aus
// Issue #188): `import` spricht die API mit eigenem fetch an, es gibt kein CLI
// dazwischen. Ein Lauf gegen eine reale Instanz ist ausdruecklich nicht Teil dieses
// Issues — er folgt in Issue #291.
//
// Der Mock laeuft im selben Prozess wie der Test, deshalb execFile statt spawnSync:
// ein synchroner Aufruf wuerde die Event-Loop blockieren und der Request nie bedient
// (dieselbe Begruendung wie bei runBoardAsync).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupProjekt, fakeCli, aufrufe, starteServer } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Unter Windows uebersprungen: `fakeCli` legt das Fake-`gh` als endungslose Datei mit
// Shebang an, und dort entscheidet die ENDUNG (.cmd/.bat/.exe), ob etwas startbar
// ist. Die Tests unten erreichen das Fake deshalb nicht und starten das echte `gh` —
// in der CI scheitert das an GH_TOKEN (25 Fehlschlaege, Windows-Job rot seit dem
// 2026-08-11). Wortgleich zu test/board-issue-review.test.mjs (Issue #315).
//
// Ausgenommen wird genau die Menge, die das Fake-`gh` startet; die uebrigen Tests
// dieser Datei laufen unter Windows weiter.
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-Binary ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197 und #231." }
  : {};

const MIGRATE = join(repoRoot, "tools", "migrate-issues.mjs");
const FIXTURES = join(repoRoot, "test", "fixtures");

const REPO_URL = "https://github.com/mannewolff/claude-workflow-kit";
const TOKEN = "fixture-token";

// Derselbe Body wie im export-Test: Umlaute, scharfes S und ein Codeblock mit
// Zeichen, die in JSON escaped werden muessen.
const BODY_101 = 'Umlaute: ä ö ü ß — "Zitat"\n\n```js\nconst pfad = "C:\\\\tmp";\n```\n';

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

function kommentar(author, body, createdAt) {
  return { author, body, createdAt };
}

/**
 * Der Mock der kanban-kit-API.
 *
 * `bestand` ist die gruppierte Antwort von GET /api/kanban/items (Spalte -> Karten),
 * genau wie sie das Board liefert. `fehlerAbPost` laesst den n-ten Create scheitern —
 * damit ist der Abbruch mitten im Lauf pruefbar.
 */
function kanbanMock(bestand = {}, { fehlerAbPost = null } = {}) {
  let naechsteId = 5000;
  let posts = 0;
  return (req, koerper) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") {
      return { status: 200, json: bestand };
    }
    if (req.method === "POST" && req.url === "/api/kanban/items") {
      posts += 1;
      if (fehlerAbPost && posts >= fehlerAbPost) {
        return { status: 500, json: { message: "Board kaputt" } };
      }
      const daten = JSON.parse(koerper);
      naechsteId += 1;
      return { status: 200, json: { id: naechsteId, number: daten.number } };
    }
    if (req.method === "POST" && /^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) {
      return { status: 200, json: {} };
    }
    return undefined;
  };
}

async function fixture(praefix, { daten = [], bestand = {}, mockOptionen = {} } = {}) {
  const { server, requests, host } = await starteServer(kanbanMock(bestand, mockOptionen));
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
    outDir: join(dir, "vorschau"),
    ende() {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

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

/** Das Zaehlerobjekt der letzten stdout-Zeile. */
function bilanz(res) {
  const zeilen = res.stdout.trim().split("\n").filter(Boolean);
  return JSON.parse(zeilen[zeilen.length - 1]);
}

function createRequests(requests) {
  return requests
    .filter((r) => r.method === "POST" && r.url === "/api/kanban/items")
    .map((r) => JSON.parse(r.body));
}

function kommentarRequests(requests) {
  return requests
    .filter((r) => r.method === "POST" && /\/comments$/.test(r.url))
    .map((r) => ({ url: r.url, ...JSON.parse(r.body) }));
}

function karte(number, externalKey, column = "BACKLOG") {
  return { id: number * 10, number, title: `Karte ${number}`, body: "", column, externalKey };
}

// ============================================================
// Modi
// ============================================================

test("import ohne --dry-run und ohne --yes endet mit Exit 1 und ohne Request", async () => {
  const f = await fixture("migrate-import-modus-", { daten: [eintrag(101)] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei]);
    assert.equal(res.status, 1);
    assert.deepEqual(f.requests, [], "ohne Modus darf kein Request abgesetzt werden");
  } finally {
    f.ende();
  }
});

test("import mit --dry-run UND --yes endet mit Exit 1 und ohne Request", async () => {
  const f = await fixture("migrate-import-beide-", { daten: [eintrag(101)] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir, "--yes"]);
    assert.equal(res.status, 1);
    assert.deepEqual(f.requests, [], "mit beiden Flags darf kein Request abgesetzt werden");
    assert.equal(existsSync(f.outDir), false, "mit beiden Flags entsteht kein Vorschauverzeichnis");
  } finally {
    f.ende();
  }
});

test("--dry-run ohne --out-dir endet mit Exit 1", async () => {
  const f = await fixture("migrate-import-ohne-outdir-", { daten: [eintrag(101)] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--dry-run"]);
    assert.equal(res.status, 1);
    assert.deepEqual(f.requests, []);
  } finally {
    f.ende();
  }
});

test("--help nennt den ungefilterten Trockenlauf als Vorbedingung des ersten --yes-Laufs", async () => {
  const f = await fixture("migrate-import-hilfe-", { daten: [] });
  try {
    const res = await runMigrate(f.dir, ["--help"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /--dry-run/);
    assert.match(res.stdout, /--yes/);
    assert.match(res.stdout, /voll(en|staendig)/i, "der Hilfetext nennt den vollen Bestand nicht");
  } finally {
    f.ende();
  }
});

// ============================================================
// Trockenlauf
// ============================================================

test("--dry-run schreibt je Eintrag github-<N>.md, meldet die Anzahl und beschreibt den Mock nicht", NUR_POSIX, async () => {
  const f = await fixture("migrate-import-dry-", { daten: [eintrag(101), eintrag(102), eintrag(103)] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(readdirSync(f.outDir).sort(), ["github-101.md", "github-102.md", "github-103.md"]);
    assert.deepEqual(bilanz(res), { selected: 3, created: 0, skipped: 0, failed: 0 });
    assert.deepEqual(f.requests, [], "der Trockenlauf darf keinen Request absetzen");
  } finally {
    f.ende();
  }
});

test("eine vorhandene Zieldatei bricht den Trockenlauf vor dem ersten Schreiben ab", async () => {
  const f = await fixture("migrate-import-dry-kollision-", { daten: [eintrag(101), eintrag(102)] });
  try {
    mkdirSync(f.outDir, { recursive: true });
    writeFileSync(join(f.outDir, "github-102.md"), "vorher", "utf-8");

    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir]);

    assert.equal(res.status, 1);
    assert.equal(readFileSync(join(f.outDir, "github-102.md"), "utf-8"), "vorher",
      "die vorhandene Datei bleibt unveraendert");
    assert.deepEqual(readdirSync(f.outDir), ["github-102.md"],
      "vor dem Abbruch darf keine weitere Datei entstehen");
  } finally {
    f.ende();
  }
});

// ============================================================
// Filter
// ============================================================

test("--limit verarbeitet genau die ersten N Eintraege in Nummernreihenfolge", NUR_POSIX, async () => {
  const daten = [12, 3, 7, 1, 9, 2, 11, 4, 8, 5, 10, 6].map((n) => eintrag(n));
  const f = await fixture("migrate-import-limit-", { daten });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir, "--limit", "10"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(bilanz(res).selected, 10);
    const nummern = readdirSync(f.outDir).map((n) => Number(/github-(\d+)\.md/.exec(n)[1])).sort((a, b) => a - b);
    assert.deepEqual(nummern, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      "erst nach Nummer sortieren, dann limitieren");
  } finally {
    f.ende();
  }
});

test("--from und --to bilden einen inklusiven Bereich", NUR_POSIX, async () => {
  const daten = [195, 199, 200, 210, 220, 221, 300].map((n) => eintrag(n));
  const f = await fixture("migrate-import-bereich-", { daten });
  try {
    const res = await runMigrate(f.dir,
      ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir, "--from", "200", "--to", "220"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(readdirSync(f.outDir).sort(), ["github-200.md", "github-210.md", "github-220.md"]);
    assert.equal(bilanz(res).selected, 3);
  } finally {
    f.ende();
  }
});

test("ungueltige Filter enden vor jedem Datei- und Netzzugriff mit Exit 1", async () => {
  const faelle = [
    ["--from", "220", "--to", "200"],
    ["--from", "200"],
    ["--to", "200"],
    ["--limit", "0"],
    ["--limit", "1.5"],
    ["--limit", "zehn"],
  ];
  for (const fall of faelle) {
    const f = await fixture("migrate-import-filterfehler-", { daten: [eintrag(101)] });
    try {
      const res = await runMigrate(f.dir,
        ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir, ...fall]);
      assert.equal(res.status, 1, `'${fall.join(" ")}' muss mit Exit 1 enden`);
      assert.deepEqual(f.requests, [], `'${fall.join(" ")}' darf keinen Request absetzen`);
      assert.equal(existsSync(f.outDir), false, `'${fall.join(" ")}' darf kein Verzeichnis anlegen`);
    } finally {
      f.ende();
    }
  }
});

test("eine leere Auswahl ist ein erfolgreicher Lauf ohne Verarbeitung", async () => {
  const f = await fixture("migrate-import-leer-", { daten: [eintrag(101)] });
  try {
    const res = await runMigrate(f.dir,
      ["import", "--file", f.datei, "--yes", "--from", "200", "--to", "220"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(bilanz(res), { selected: 0, created: 0, skipped: 0, failed: 0 });
    assert.deepEqual(createRequests(f.requests), [], "eine leere Auswahl legt keine Karte an");
  } finally {
    f.ende();
  }
});

// ============================================================
// Zielspalten
// ============================================================

test("jeder Create-Request traegt number, externalKey und die abgebildete Spalte", NUR_POSIX, async () => {
  const daten = [
    eintrag(101, { spalte: "Backlog" }),
    eintrag(102, { spalte: "Ready" }),
    eintrag(103, { spalte: "In progress" }),
    eintrag(104, { spalte: "In review" }),
    eintrag(105, { spalte: "Done" }),
  ];
  const f = await fixture("migrate-import-spalten-", { daten });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 0, res.stderr);
    const creates = createRequests(f.requests);
    assert.deepEqual(creates.map((c) => [c.number, c.externalKey, c.column]), [
      [101, "github#101", "BACKLOG"],
      [102, "github#102", "READY"],
      [103, "github#103", "IN_PROGRESS"],
      [104, "github#104", "IN_REVIEW"],
      [105, "github#105", "DONE"],
    ]);
    assert.deepEqual(creates.map((c) => c.title), daten.map((e) => e.title), "der Titel wird unveraendert uebernommen");
  } finally {
    f.ende();
  }
});

test("ein Eintrag ohne Spalte landet in BACKLOG und traegt den Literal-Wert 'keine'", NUR_POSIX, async () => {
  const f = await fixture("migrate-import-ohne-spalte-", { daten: [eintrag(101, { spalte: null, body: "Text" })] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 0, res.stderr);
    const [create] = createRequests(f.requests);
    assert.equal(create.column, "BACKLOG");
    assert.equal(create.body, `> Quelle: ${issueUrl(101)}\n> Ursprüngliche Spalte: keine\n\nText`);
  } finally {
    f.ende();
  }
});

test("ein unbekannter Spaltenwert beendet den Lauf vor dem ersten Schreibzugriff", async () => {
  const f = await fixture("migrate-import-fremde-spalte-", {
    daten: [eintrag(101), eintrag(102, { spalte: "Wartet auf Kunde" })],
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Wartet auf Kunde/);
    assert.deepEqual(createRequests(f.requests), [], "auch der gueltige Eintrag darf nicht angelegt werden");
  } finally {
    f.ende();
  }
});

// ============================================================
// Kartenformat und Kommentare
// ============================================================

test("der zusammengesetzte Karten-Body entspricht der Fixture einschliesslich Umlauten und Codeblock", NUR_POSIX, async () => {
  const f = await fixture("migrate-import-body-", {
    daten: [eintrag(101, { spalte: "Ready", body: BODY_101 })],
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 0, res.stderr);
    const erwartet = readFileSync(join(FIXTURES, "migrate-import-karte-101.md"), "utf-8");
    assert.equal(createRequests(f.requests)[0].body, erwartet);
    assert.ok(createRequests(f.requests)[0].body.includes(BODY_101),
      "der urspruengliche Body muss unveraendert enthalten sein");
  } finally {
    f.ende();
  }
});

test("der Trockenlauf schreibt denselben Body in die Vorschaudatei", NUR_POSIX, async () => {
  const f = await fixture("migrate-import-dry-body-", {
    daten: [eintrag(101, { spalte: "Ready", body: BODY_101 })],
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      readFileSync(join(f.outDir, "github-101.md"), "utf-8"),
      readFileSync(join(FIXTURES, "migrate-import-karte-101.md"), "utf-8")
    );
  } finally {
    f.ende();
  }
});

test("jeder Kommentar wird als eigener Board-Kommentar mit Herkunfts-Kopfzeile angelegt", NUR_POSIX, async () => {
  const daten = [eintrag(101, {
    comments: [
      kommentar("mannewolff", "Zweiter", "2026-08-02T11:00:00Z"),
      kommentar("bot", "Erster", "2026-08-01T10:00:00Z"),
      kommentar("", "Dritter", "2026-08-03T12:00:00Z"),
    ],
  })];
  const f = await fixture("migrate-import-kommentare-", { daten });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 0, res.stderr);

    const kommentare = kommentarRequests(f.requests);
    assert.equal(kommentare.length, 3, "je Quellkommentar genau ein Kommentar-Request");
    assert.deepEqual(kommentare.map((k) => k.body), [
      `> Quelle: ${issueUrl(101)}\n> Autor: bot\n> Datum: 2026-08-01T10:00:00Z\n\nErster`,
      `> Quelle: ${issueUrl(101)}\n> Autor: mannewolff\n> Datum: 2026-08-02T11:00:00Z\n\nZweiter`,
      `> Quelle: ${issueUrl(101)}\n> Autor: unbekannt\n> Datum: 2026-08-03T12:00:00Z\n\nDritter`,
    ], "aufsteigend nach createdAt, jeweils mit Herkunfts-Kopfzeile");

    // Der Mock antwortet auf den Create mit einer id; genau an ihr muessen die
    // Kommentare haengen — nicht an der Issue-Nummer.
    assert.deepEqual([...new Set(kommentare.map((k) => k.url))], ["/api/kanban/items/5001/comments"]);

    assert.ok(!createRequests(f.requests)[0].body.includes("Erster"),
      "Kommentare gehoeren nicht in den Karten-Body");
  } finally {
    f.ende();
  }
});

test("Kommentare gleichen Zeitpunkts behalten die Reihenfolge der Exportdatei", NUR_POSIX, async () => {
  const daten = [eintrag(101, {
    comments: [
      kommentar("a", "Zuerst notiert", "2026-08-01T10:00:00Z"),
      kommentar("b", "Danach notiert", "2026-08-01T10:00:00Z"),
    ],
  })];
  const f = await fixture("migrate-import-kommentare-stabil-", { daten });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 0, res.stderr);
    const texte = kommentarRequests(f.requests).map((k) => k.body.split("\n\n")[1]);
    assert.deepEqual(texte, ["Zuerst notiert", "Danach notiert"]);
  } finally {
    f.ende();
  }
});

// ============================================================
// Idempotenz
// ============================================================

test("ein zweiter Lauf ueber denselben Block legt nichts neu an und zaehlt alles als skipped", NUR_POSIX, async () => {
  const daten = [eintrag(101), eintrag(102)];
  const bestand = { BACKLOG: [karte(101, "github#101"), karte(102, "github#102")] };
  const f = await fixture("migrate-import-idempotent-", { daten, bestand });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(bilanz(res), { selected: 2, created: 0, skipped: 2, failed: 0 });
    assert.deepEqual(createRequests(f.requests), [], "eine vorhandene Karte wird nie erneut angelegt");
    assert.deepEqual(kommentarRequests(f.requests), [], "und bekommt auch keine Kommentare erneut");
  } finally {
    f.ende();
  }
});

test("eine belegte Zielnummer mit fremdem externalKey bricht den Lauf ohne Ueberschreiben ab", NUR_POSIX, async () => {
  const daten = [eintrag(101), eintrag(102)];
  const bestand = { BACKLOG: [karte(102, "manuell#7")] };
  const f = await fixture("migrate-import-konflikt-", { daten, bestand });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /102/);
    assert.deepEqual(createRequests(f.requests), [], "der Konflikt wird vor dem ersten Schreibzugriff erkannt");
    assert.equal(f.requests.filter((r) => r.method !== "GET").length, 0, "kein mutierender Request");
  } finally {
    f.ende();
  }
});

test("eine belegte Zielnummer ohne externalKey ist ebenfalls ein Konflikt", async () => {
  const bestand = { READY: [{ id: 900, number: 101, title: "Von Hand", column: "READY" }] };
  const f = await fixture("migrate-import-konflikt-leer-", { daten: [eintrag(101)], bestand });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 1);
    assert.deepEqual(createRequests(f.requests), []);
  } finally {
    f.ende();
  }
});

// ============================================================
// Eingabe- und Fehlerpfade
// ============================================================

test("fehlende Datei, ungueltiges JSON, fehlendes Pflichtfeld und doppelte Nummer enden ohne Request", async () => {
  const faelle = [
    { name: "kaputtes JSON", daten: "{kein json" },
    { name: "kein Array", daten: JSON.stringify({ number: 1 }) },
    { name: "fehlendes Pflichtfeld", daten: JSON.stringify([{ number: 101, title: "ohne body" }]) },
    { name: "falscher Typ", daten: JSON.stringify([{ ...eintrag(101), number: "101" }]) },
    { name: "doppelte Nummer", daten: JSON.stringify([eintrag(101), eintrag(101)]) },
  ];
  for (const fall of faelle) {
    const f = await fixture("migrate-import-schema-", { daten: fall.daten });
    try {
      const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
      assert.equal(res.status, 1, `'${fall.name}' muss mit Exit 1 enden`);
      assert.match(res.stderr, /Fehler:/, `'${fall.name}' meldet nichts auf stderr`);
      assert.deepEqual(f.requests, [], `'${fall.name}' darf keinen Request absetzen`);
    } finally {
      f.ende();
    }
  }

  const f = await fixture("migrate-import-fehlt-", { daten: [] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", join(f.dir, "gibtsnicht.json"), "--yes"]);
    assert.equal(res.status, 1);
    assert.deepEqual(f.requests, [], "eine fehlende Datei darf keinen Request ausloesen");
  } finally {
    f.ende();
  }
});

test("import ohne --file endet mit Exit 1 und ohne Request", async () => {
  const f = await fixture("migrate-import-ohne-file-", { daten: [eintrag(101)] });
  try {
    const res = await runMigrate(f.dir, ["import", "--yes"]);
    assert.equal(res.status, 1);
    assert.deepEqual(f.requests, []);
  } finally {
    f.ende();
  }
});

test("ein fehlgeschlagener Karten-Request bricht ab und meldet die Bilanz bis dahin", NUR_POSIX, async () => {
  const daten = [eintrag(101), eintrag(102), eintrag(103)];
  const bestand = { BACKLOG: [karte(101, "github#101")] };
  const f = await fixture("migrate-import-abbruch-", { daten, bestand, mockOptionen: { fehlerAbPost: 2 } });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Fehler:/);
    assert.deepEqual(bilanz(res), { selected: 3, created: 1, skipped: 1, failed: 1 },
      "die Bilanz nennt die bis dahin angelegten und uebersprungenen Karten");
    assert.equal(createRequests(f.requests).length, 2, "nach dem Fehler wird nicht weitergemacht");
  } finally {
    f.ende();
  }
});

// ============================================================
// Zugriffe
// ============================================================

test("der Trockenlauf fragt den Kartenbestand nicht ab und ruft gh nur lesend auf", NUR_POSIX, async () => {
  const f = await fixture("migrate-import-lesend-", { daten: [eintrag(101)] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--dry-run", "--out-dir", f.outDir]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(f.requests, []);
    for (const argv of aufrufe(f.dir, "gh")) {
      assert.match(argv.join(" "), /repo view/, `unerwarteter gh-Aufruf: ${argv.join(" ")}`);
    }
  } finally {
    f.ende();
  }
});

test("jeder Request an kanban-kit traegt den Token-Header", NUR_POSIX, async () => {
  const f = await fixture("migrate-import-token-", { daten: [eintrag(101, { comments: [kommentar("a", "x", "2026-08-01T10:00:00Z")] })] });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(f.requests.length >= 3, "Bestand, Karte und Kommentar");
    for (const r of f.requests) {
      assert.equal(r.headers["x-kanban-token"], TOKEN, `Request ohne Token: ${r.method} ${r.url}`);
    }
  } finally {
    f.ende();
  }
});
