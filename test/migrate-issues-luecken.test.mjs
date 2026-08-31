// Luecken in den Daten, auf beiden Seiten des Umzugs (Issue #405).
//
// Die Bestandstests fahren vollstaendige Antworten. Was hier geprueft wird, sind die
// Rueckfaelle fuer das, was fehlen kann: ein Issue ohne Titel, ein Kommentar ohne
// Autor, ein Label ohne Namen, eine Karte mit anderer Kommentarzahl.
//
// Das ist kein Randfall-Sammelsurium: GitHubs GraphQL liefert `null` fuer geloeschte
// Autoren und fuer Felder, auf die das Token keinen Zugriff hat. Faellt das Werkzeug
// dort auf `undefined` statt auf einen Rueckfall, steht "undefined" spaeter als Text
// in einer Karte — und der Umzug ist unbemerkt kaputt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupProjekt, fakeCli, starteServer } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATE = join(repoRoot, "tools", "migrate-issues.mjs");
const ZIEL_REPO = "mannewolff/claude-workflow-kit";
const REPO_URL = "https://github.com/mannewolff/claude-workflow-kit";
const TOKEN = "fixture-token";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-Binary ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197 und #231." }
  : {};

function runMigrateSync(dir, cliArgs, extraEnv = {}) {
  return spawnSync(process.execPath, [MIGRATE, ...cliArgs], {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, PATH: `${join(dir, "fakebin")}:${process.env.PATH}`, ...extraEnv },
  });
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

/** Eine einseitige Issues-Antwort mit genau diesen Knoten. */
function issuesAntwort(nodes) {
  return { data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } };
}

const LEERES_PROJEKT = {
  data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } },
};

/** Exportiert mit den uebergebenen Issue-Knoten und liefert die geschriebene Datei. */
function exportiere(praefix, nodes, { repoView = `${ZIEL_REPO}\n` } = {}) {
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, praefix);
  // Unterschieden wird am Query-Text, wie im Bestandstest: "projectV2" ist die
  // Projekt-Abfrage, "states:OPEN" die der offenen Issues.
  fakeCli(dir, "gh", [
    { match: "repo view", stdout: repoView },
    { match: "projectV2", stdout: LEERES_PROJEKT },
    { match: "states:OPEN", stdout: issuesAntwort(nodes) },
  ]);
  const out = join(dir, "raus");
  const res = runMigrateSync(dir, ["export", "--out", out]);
  return {
    dir, res, out,
    gelesen() {
      const datei = readdirSync(out).find((f) => f.endsWith(".json"));
      return JSON.parse(readFileSync(join(out, datei), "utf-8"));
    },
    ende: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ============================================================
// Luecken auf der GitHub-Seite
// ============================================================

test("ein Issue ohne Titel und ohne Body wird zu leeren Texten, nicht zu 'undefined'", NUR_POSIX, () => {
  const f = exportiere("migrate-issue-leer-", [
    { number: 101, labels: { nodes: [] }, comments: { pageInfo: { hasNextPage: false }, nodes: [] } },
  ]);
  try {
    assert.equal(f.res.status, 0, `export schlug fehl: ${f.res.stderr}`);
    const [eintrag] = f.gelesen();
    assert.equal(eintrag.title, "", "ein fehlender Titel muss ein leerer Text werden");
    assert.equal(eintrag.body, "", "ein fehlender Body muss ein leerer Text werden");
  } finally {
    f.ende();
  }
});

test("fehlt der comments-Knoten ganz, entsteht eine leere Kommentarliste", NUR_POSIX, () => {
  const f = exportiere("migrate-ohne-comments-", [
    { number: 101, title: "T", body: "B", labels: { nodes: [] } },
  ]);
  try {
    assert.equal(f.res.status, 0, `export schlug fehl: ${f.res.stderr}`);
    const [eintrag] = f.gelesen();
    assert.deepEqual(eintrag.comments, [], "ohne comments-Knoten muss die Liste leer sein");
  } finally {
    f.ende();
  }
});

test("ein Kommentar ohne createdAt behaelt seinen Text und bekommt ein leeres Datum", NUR_POSIX, () => {
  const f = exportiere("migrate-komm-ohne-datum-", [
    {
      number: 101, title: "T", body: "B", labels: { nodes: [] },
      comments: { pageInfo: { hasNextPage: false }, nodes: [{ author: { login: "a" }, body: "ohne Datum" }] },
    },
  ]);
  try {
    assert.equal(f.res.status, 0, `export schlug fehl: ${f.res.stderr}`);
    const [eintrag] = f.gelesen();
    assert.equal(eintrag.comments.length, 1, "der Kommentar ging verloren");
    assert.equal(eintrag.comments[0].createdAt, "", "ein fehlendes Datum muss ein leerer Text werden");
    assert.equal(eintrag.comments[0].body, "ohne Datum", "der Text des Kommentars ging verloren");
  } finally {
    f.ende();
  }
});

test("ein Kommentar ganz ohne body faellt heraus, statt als leerer Eintrag mitzugehen", NUR_POSIX, () => {
  const f = exportiere("migrate-komm-ohne-body-", [
    {
      number: 101, title: "T", body: "B", labels: { nodes: [] },
      comments: {
        pageInfo: { hasNextPage: false },
        nodes: [{ author: { login: "a" }, createdAt: "2026-01-01T00:00:00Z" }, null, "text"],
      },
    },
  ]);
  try {
    assert.equal(f.res.status, 0, `export schlug fehl: ${f.res.stderr}`);
    const [eintrag] = f.gelesen();
    assert.deepEqual(eintrag.comments, [],
      "ein Kommentar ohne Body ist kein Kommentar — er darf nicht als leerer Eintrag mitwandern");
  } finally {
    f.ende();
  }
});

test("fehlende und namenlose Labels ergeben eine leere Namensliste", NUR_POSIX, () => {
  const f = exportiere("migrate-labels-leer-", [
    { number: 101, title: "T", body: "B", comments: { pageInfo: { hasNextPage: false }, nodes: [] } },
    { number: 102, title: "T", body: "B", labels: { nodes: [{}, null, { name: "" }] }, comments: { pageInfo: { hasNextPage: false }, nodes: [] } },
  ]);
  try {
    assert.equal(f.res.status, 0, `export schlug fehl: ${f.res.stderr}`);
    const eintraege = f.gelesen();
    assert.deepEqual(eintraege[0].labels, [], "ein fehlender labels-Knoten muss eine leere Liste ergeben");
    assert.deepEqual(eintraege[1].labels, [], "namenlose Labels duerfen keine leeren Namen erzeugen");
  } finally {
    f.ende();
  }
});

test("liefert gh einen Repo-Namen ohne Schraegstrich, bricht export mit dem Wert ab", NUR_POSIX, () => {
  const f = exportiere("migrate-repo-kaputt-", [], { repoView: "nurname\n" });
  try {
    assert.equal(f.res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(f.res.stderr, /Konnte das Repository nicht bestimmen: 'nurname'/,
      "der unbrauchbare Wert steht nicht in der Meldung");
  } finally {
    f.ende();
  }
});

test("liefert gh keine URL, bricht import vor jedem Schreibzugriff ab", NUR_POSIX, async () => {
  const { server, requests, host } = await starteServer(() => ({ status: 200, json: {} }));
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    "migrate-url-kaputt-"
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: "kein-url-wert\n" }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([
    { number: 101, title: "T", body: "B", comments: [], labels: [], spalte: "Backlog" },
  ]), "utf-8");
  try {
    const res = await runMigrate(dir, ["import", "--file", datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /Konnte die Repository-URL nicht bestimmen: 'kein-url-wert'/,
      "der unbrauchbare Wert steht nicht in der Meldung");
    assert.equal(requests.length, 0, "trotz unbrauchbarer URL wurde das Board angesprochen");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Luecken beim Schreiben
// ============================================================

test("ein Kommentar ohne Autor wird als 'unbekannt' uebernommen", NUR_POSIX, async () => {
  const { server, requests, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: {} };
    if (req.method === "POST" && req.url === "/api/kanban/items") return { status: 200, json: { id: 5001, number: 101 } };
    if (req.method === "POST" && /\/comments$/.test(req.url)) return { status: 200, json: {} };
    return undefined;
  });
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    "migrate-komm-ohne-autor-"
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([{
    number: 101, title: "T", body: "B", labels: [], spalte: "Backlog",
    comments: [{ author: "   ", body: "Text", createdAt: "2026-01-01T00:00:00Z" }],
  }]), "utf-8");
  try {
    const res = await runMigrate(dir, ["import", "--file", datei, "--yes"]);

    assert.equal(res.status, 0, `import haette durchlaufen muessen: ${res.stderr}`);
    const kommentar = requests.find((r) => r.method === "POST" && /\/comments$/.test(r.url));
    assert.ok(kommentar, "der Kommentar wurde nicht angelegt");
    assert.match(JSON.parse(kommentar.body).body, /> Autor: unbekannt/,
      "ein leerer Autor muss als 'unbekannt' erscheinen, nicht als Leerstelle");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eine Create-Antwort ohne JSON-Koerper gilt als Karte ohne id", NUR_POSIX, async () => {
  const { server, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: {} };
    // Status 200, aber der Koerper ist kein JSON: Der Lauf darf daran nicht zerbrechen.
    if (req.method === "POST" && req.url === "/api/kanban/items") return { status: 200, text: "" };
    return undefined;
  });
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    "migrate-create-leer-"
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([
    { number: 101, title: "T", body: "B", comments: [], labels: [], spalte: "Backlog" },
  ]), "utf-8");
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

// ============================================================
// verify: Abweichungen, die keine Formfehler sind
// ============================================================

function verifyKarte(quelle, extra = {}) {
  const spalte = quelle.spalte == null || String(quelle.spalte).trim() === "" ? "keine" : quelle.spalte;
  return {
    id: 5000 + quelle.number,
    number: quelle.number,
    title: quelle.title,
    body: `> Quelle: ${REPO_URL}/issues/${quelle.number}\n> Ursprüngliche Spalte: ${spalte}\n\n${quelle.body}`,
    column: "BACKLOG",
    ...extra,
  };
}

async function verifyFixture(praefix, daten, karten, kommentare = {}) {
  const gruppiert = {};
  for (const k of karten) (gruppiert[k.column] ??= []).push(k);
  const { server, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: gruppiert };
    const treffer = /^\/api\/kanban\/items\/(\d+)\/comments$/.exec(req.url);
    if (req.method === "GET" && treffer) return { status: 200, json: kommentare[treffer[1]] ?? [] };
    return undefined;
  });
  const dir = setupProjekt(
    { issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host } },
    praefix
  );
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify(daten, null, 2), "utf-8");
  return { dir, datei, ende: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("verify meldet eine abweichende Kommentarzahl mit beiden Werten", NUR_POSIX, async () => {
  const quelle = {
    number: 101, title: "T", body: "B", labels: [], spalte: "Backlog",
    comments: [
      { author: "a", body: "eins", createdAt: "2026-01-01T00:00:00Z" },
      { author: "a", body: "zwei", createdAt: "2026-01-02T00:00:00Z" },
    ],
  };
  // Am Ziel steht nur einer der beiden — genau der Datenverlust, den das Gate finden soll.
  const f = await verifyFixture("migrate-verify-komm-zahl-", [quelle], [verifyKarte(quelle)], {
    5101: [{ body: "> Quelle: x\n> Autor: a\n> Datum: d\n\neins" }],
  });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);

    assert.equal(res.status, 1, "verify haette die Abweichung mit Exit 1 melden muessen");
    assert.match(res.stdout + res.stderr, /#101 field=comments source=2 target=1/,
      "die Zeile nennt nicht beide Zahlen");
  } finally {
    f.ende();
  }
});

test("verify vergleicht Kommentartexte ohne die Herkunfts-Kopfzeile", NUR_POSIX, async () => {
  const quelle = {
    number: 101, title: "T", body: "B", labels: [], spalte: "Backlog",
    comments: [{ author: "a", body: "gleicher Text", createdAt: "2026-01-01T00:00:00Z" }],
  };
  const f = await verifyFixture("migrate-verify-komm-kopf-", [quelle], [verifyKarte(quelle)], {
    5101: [{ body: "> Quelle: x\n> Autor: a\n> Datum: d\n\ngleicher Text" }],
  });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);

    assert.equal(res.status, 0,
      `die Kopfzeile ist Beiwerk des Imports und darf keine Abweichung sein: ${res.stdout}${res.stderr}`);
  } finally {
    f.ende();
  }
});

test("verify meldet einen abweichenden Kommentartext, Kopfzeile hin oder her", NUR_POSIX, async () => {
  const quelle = {
    number: 101, title: "T", body: "B", labels: [], spalte: "Backlog",
    comments: [{ author: "a", body: "Original", createdAt: "2026-01-01T00:00:00Z" }],
  };
  // Ohne Kopfzeile am Ziel: Der Vergleich muss auch dann greifen — sonst waere ein
  // von Hand angelegter Kommentar unpruefbar.
  const f = await verifyFixture("migrate-verify-komm-text-", [quelle], [verifyKarte(quelle)], {
    5101: [{ body: "etwas anderes" }],
  });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);

    assert.equal(res.status, 1, "verify haette die Abweichung melden muessen");
    assert.match(res.stdout + res.stderr, /#101 field=comment\[0\] source="Original" target="etwas anderes"/,
      "die Zeile nennt nicht beide Texte");
  } finally {
    f.ende();
  }
});

test("verify meldet eine Zielkarte ohne Titel und Body als Abweichung mit null", NUR_POSIX, async () => {
  const quelle = { number: 101, title: "Titel", body: "Body", comments: [], labels: [], spalte: "Backlog" };
  // Eine Karte, der beide Textfelder fehlen — so sieht sie aus, wenn sie von Hand
  // angelegt wurde. `undefined` muss dabei als `null` erscheinen: Die Meldezeile ist
  // JSON, und `undefined` haette dort gar keine Entsprechung.
  const f = await verifyFixture("migrate-verify-karte-leer-", [quelle], [
    { id: 5101, number: 101, column: "BACKLOG" },
  ]);
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);

    assert.equal(res.status, 1, "verify haette die Abweichung melden muessen");
    const ausgabe = res.stdout + res.stderr;
    assert.match(ausgabe, /#101 field=title source="Titel" target=null/,
      "ein fehlender Zieltitel muss als null erscheinen, nicht als undefined");
    assert.match(ausgabe, /#101 field=body source="Body" target=""/,
      "ein fehlender Ziel-Body muss als leerer Text erscheinen");
  } finally {
    f.ende();
  }
});

test("verify vergleicht einen Zielkommentar ohne Body als leeren Text", NUR_POSIX, async () => {
  const quelle = {
    number: 101, title: "T", body: "B", labels: [], spalte: "Backlog",
    comments: [{ author: "a", body: "Original", createdAt: "2026-01-01T00:00:00Z" }],
  };
  const f = await verifyFixture("migrate-verify-komm-leer-", [quelle], [verifyKarte(quelle)], {
    5101: [{}],
  });
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);

    assert.equal(res.status, 1, "verify haette die Abweichung melden muessen");
    assert.match(res.stdout + res.stderr, /#101 field=comment\[0\] source="Original" target=""/,
      "ein Zielkommentar ohne Body muss als leerer Text verglichen werden");
  } finally {
    f.ende();
  }
});

test("verify meldet eine fehlende Zielkarte mit target=null", NUR_POSIX, async () => {
  const quelle = { number: 101, title: "Fehlt am Ziel", body: "B", comments: [], labels: [], spalte: "Backlog" };
  const f = await verifyFixture("migrate-verify-ohne-karte-", [quelle], []);
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);

    assert.equal(res.status, 1, "verify haette die fehlende Karte melden muessen");
    assert.match(res.stdout + res.stderr, /#101 field=card source="Fehlt am Ziel" target=null/,
      "die fehlende Karte wird nicht als solche gemeldet");
  } finally {
    f.ende();
  }
});

test("verify bildet eine unbekannte Quellspalte auf sich selbst ab und meldet den Unterschied", NUR_POSIX, async () => {
  const quelle = { number: 101, title: "T", body: "B", comments: [], labels: [], spalte: "Irgendwas Eigenes" };
  const f = await verifyFixture("migrate-verify-spalte-", [quelle], [verifyKarte(quelle)]);
  try {
    const res = await runMigrate(f.dir, ["verify", "--in", f.datei]);

    assert.equal(res.status, 1, "verify haette die abweichende Spalte melden muessen");
    assert.match(res.stdout + res.stderr, /#101 field=spalte source="irgendwas_eigenes" target="backlog"/,
      "eine unbekannte Spalte muss normalisiert, aber nicht abgebildet werden");
  } finally {
    f.ende();
  }
});

// ============================================================
// Konfiguration: die beiden Rueckfaelle
// ============================================================

test("ohne workflow.config.json nennt export das Projektverzeichnis als Ursache", () => {
  const dir = setupProjekt(null, "migrate-ohne-config-");
  try {
    const res = runMigrateSync(dir, ["export"]);

    assert.equal(res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /nicht gefunden — bitte im Projektverzeichnis starten/,
      "die Meldung nennt die eigentliche Ursache nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne TBX_CONFIG_DIR wird der tbx-Login unter HOME gesucht", NUR_POSIX, async () => {
  const { server, requests, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: {} };
    if (req.method === "POST" && req.url === "/api/kanban/items") return { status: 200, json: { id: 5001, number: 101 } };
    return undefined;
  });
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, "migrate-home-");
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify([
    { number: 101, title: "T", body: "B", comments: [], labels: [], spalte: "Backlog" },
  ]), "utf-8");
  // HOME zeigt ins Fixture: Der Rueckfall auf ~/.config/toolbox-cli ist damit
  // pruefbar, ohne den Login der Entwicklermaschine anzufassen.
  const login = join(dir, "home", ".config", "toolbox-cli");
  mkdirSync(login, { recursive: true });
  writeFileSync(join(login, "config.json"), JSON.stringify({ host }), "utf-8");
  writeFileSync(join(login, "tokens.json"), JSON.stringify({ token: "home-token" }), "utf-8");
  try {
    const env = { ...process.env };
    delete env.TBX_TOKEN;
    delete env.TBX_CONFIG_DIR;
    env.PATH = `${join(dir, "fakebin")}:${process.env.PATH}`;
    env.HOME = join(dir, "home");
    env.USERPROFILE = join(dir, "home");

    const res = await new Promise((fertig) => {
      execFile(process.execPath, [MIGRATE, "import", "--file", datei, "--yes"], { cwd: dir, env },
        (err, stdout, stderr) => fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr }));
    });

    assert.equal(res.status, 0, `import haette durchlaufen muessen: ${res.stderr}`);
    const create = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    assert.ok(create, "der Login unter HOME wurde nicht gefunden");
    assert.equal(create.headers["x-kanban-token"], "home-token",
      "das Token aus dem HOME-Login wurde nicht mitgeschickt");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein nicht ausfuehrbares gh meldet den Systemfehler im Klartext", NUR_POSIX, () => {
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, "migrate-gh-eacces-");
  try {
    // Eine Datei ohne Ausfuehrungsrecht: spawnSync liefert EACCES statt ENOENT —
    // der zweite Zweig der Fehlerbehandlung, den die ENOENT-Meldung sonst verdeckt.
    const binDir = join(dir, "fakebin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "gh"), "#!/bin/sh\necho hi\n");
    chmodSync(join(binDir, "gh"), 0o644);

    const res = runMigrateSync(dir, ["export"], { PATH: binDir });

    assert.equal(res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /EACCES|permission denied/i,
      "der Systemfehler wird nicht durchgereicht — ohne ihn ist die Ursache nicht erkennbar");
    assert.doesNotMatch(res.stderr, /nicht gefunden/,
      "ein Rechteproblem darf nicht als 'nicht installiert' gemeldet werden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
