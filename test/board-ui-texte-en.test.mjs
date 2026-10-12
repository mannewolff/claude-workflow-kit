// Ablauf-Pruefung: Ob ein englisches Projekt ohne Repo-Kontext nur englische Meldungen sieht, belegt nur ein echter Server aus den verteilten Dateien.
//
// Lokale Board-Oberflaeche kit/board-ui.mjs zweisprachig (Issue #1500, Teil 1 von #1457,
// Plan #1420 E13/E14/E21).
//
// board-ui.mjs traegt seine Texte in einer Tabelle `{ de, en }` und gibt sie ueber den
// Texthelfer aus kit/board/namen.mjs aus; die Seite bekommt die Tabelle ihrer Sprache
// eingebettet. Teil 1 deckt die Datei bis vor `renderMarkdown`: Hilfe, Archiv, die
// Antworten der API, den GO-Commit und den Kopf der Seite. Hier steht, was das Paket verlangt:
//
//   - Paritaet: je Sprache dieselben Schluessel und Platzhalter.
//   - Englische Stichproben: Hilfe und Seite.
//   - Ein englisches Projekt sieht in diesem Umfang keine deutsche Meldung — geprueft an einem
//     echten Server aus einem Wegwerf-Verzeichnis, in dem nur die verteilten Dateien liegen.
//   - Der Maschinenvertrag (E14) bleibt: Feldnamen der Antworten, Spaltenschluessel und der
//     Kommentar-Marker in der Issue-Datei.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TEXTE, helpText, seite } from "../kit/board-ui.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit");

afterEach(() => spracheFestlegen(null));

test("[1500] die Texttabelle von board-ui.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  for (const k of ["hilfe", "archiviert", "titelLeer", "statusUngueltig", "issueFehlt", "goCommit", "untertitel"]) {
    assert.ok(Object.hasOwn(TEXTE.de, k), `die Tabelle traegt "${k}"`);
  }
});

test("[1500] englische Stichproben: Hilfe und Seite", () => {
  spracheFestlegen("en");
  assert.match(helpText(), /a simple viewer/);
  assert.match(helpText(), /^Usage \(from the project root\):$/m);
  const html = seite();
  assert.match(html, /<html lang="en">/);
  assert.match(html, />Local mode — files in issues\/</);
  assert.match(html, />List</);
  assert.match(html, />\+ New</);
  assert.match(html, /"titelLeer":"Title must not be empty"/, "die Seite traegt die englische Tabelle");
  assert.doesNotMatch(html, /"titelLeer":"Titel darf nicht leer sein"/, "die deutsche Tabelle bleibt draussen");
  assert.doesNotMatch(html, /<span class="subtitle" id="board-subtitle">Lokaler Modus/, "der Kopf der Seite ist englisch");
});

test("[1500] die deutsche Vorgabe bleibt: mit Deutsch spricht die Oberflaeche wie bisher", () => {
  spracheFestlegen("de");
  assert.match(helpText(), /ein einfacher Viewer/);
  const html = seite();
  assert.match(html, /<html lang="de">/);
  assert.match(html, />Lokaler Modus — Dateien in issues\/</);
  assert.match(html, />Liste</);
  assert.match(html, /"titelLeer":"Titel darf nicht leer sein"/);
});

test("[1501] die Tabelle traegt die Texte der Seite ab renderMarkdown und des Starts", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  for (const k of ["keineIssues", "kommentarKopf", "bearbeiten", "neuesIssue", "vorlageNeuesIssue", "storiesFertig", "alleEpics", "speichernFehler", "anlegenFehler", "laeuftAuf", "issuesVerzeichnis", "archivierungFehler", "statusArchiv"]) {
    assert.ok(Object.hasOwn(TEXTE.de, k), `die Tabelle traegt "${k}"`);
  }
});

test("[1501] englische Stichproben: Texte der Seite ab renderMarkdown", () => {
  spracheFestlegen("en");
  const html = seite();
  const tabelle = JSON.parse(html.match(/const TEXTE_SEITE = (.*);\n/)[1]);
  assert.equal(tabelle.keineIssues, "No issues");
  assert.equal(tabelle.bearbeiten, "Edit");
  assert.equal(tabelle.storiesFertig, "{done}/{total} stories done");
  assert.match(tabelle.vorlageNeuesIssue, /^## Acceptance criteria$/m, "die Vorlage traegt die englischen Formatueberschriften");
  // Das Seitenskript holt seine Texte aus der Tabelle, nicht als festen deutschen Wortlaut.
  // Zeilenkommentare sind keine Meldungen und bleiben aussen vor.
  const skript = html.match(/<script>([\s\S]*)<\/script>/)[1]
    .split("\n").filter((zeile) => !zeile.trimStart().startsWith("//")).join("\n");
  for (const deutsch of ["Keine Issues", "Bearbeiten", "Neues Issue", "Stories fertig", "Alle Epics", "Speichern fehlgeschlagen", "Lokaler Modus", "Reihenfolge ändern"]) {
    assert.ok(!skript.includes(deutsch), `"${deutsch}" steht nicht mehr fest im Skript`);
  }
  assert.match(skript, /tx\("keineIssues"\)/);
});

test("[1501] die deutsche Vorgabe bleibt fuer die Texte der Seite", () => {
  spracheFestlegen("de");
  const tabelle = JSON.parse(seite().match(/const TEXTE_SEITE = (.*);\n/)[1]);
  assert.equal(tabelle.keineIssues, "Keine Issues");
  assert.equal(tabelle.storiesFertig, "{done}/{total} Stories fertig");
  assert.match(tabelle.vorlageNeuesIssue, /^## Akzeptanzkriterium$/m);
});

/**
 * Die festen Bruchstuecke der deutschen Texte, die im Englischen nicht vorkommen: Was davon
 * in einer Ausgabe steht, ist eine deutsche Meldung. Kurze Bruchstuecke sagen nichts ueber
 * die Sprache und bleiben aussen vor.
 */
function deutscheBruchstuecke() {
  const englisch = Object.values(TEXTE.en).join("\n");
  const stuecke = new Set();
  for (const wert of Object.values(TEXTE.de)) {
    for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
      const t = teil.trim();
      if (t.length >= 8 && !englisch.includes(t)) stuecke.add(t);
    }
  }
  return [...stuecke];
}

function freierPort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function warteAufServer(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/config`);
      if (r.ok) return;
    } catch {
      // Server noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("board-ui startet nicht");
}

/** Wartet, bis `lesen()` auf `muster` passt; scheitert nach fuenf Sekunden mit Befund. */
async function warteAufAusgabe(lesen, muster) {
  for (let i = 0; i < 50; i++) {
    if (muster.test(lesen())) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`keine Ausgabe ${muster} in: ${lesen()}`);
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

test("[1500] ein englisches Projekt sieht keine deutsche Meldung — echter Server, nur die verteilten Dateien", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-ui-en-"));
  const kit = join(dir, ".claude", "kit");
  mkdirSync(kit, { recursive: true });
  copyFileSync(join(KIT, "board-ui.mjs"), join(kit, "board-ui.mjs"));
  cpSync(join(KIT, "board"), join(kit, "board"), { recursive: true });
  cpSync(join(KIT, "texte"), join(kit, "texte"), { recursive: true });
  const port = await freierPort();
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({ language: "en", local: { uiPort: port } }));
  const issues = join(dir, "issues");
  mkdirSync(issues);
  writeFileSync(join(issues, "0007.md"), "---\nid: 7\ntitle: Probe\nstatus: backlog\n---\n\nText\n");
  writeFileSync(join(issues, "0008.md"), "---\nid: 8\ntitle: Alt\nstatus: done\ndone_at: 2020-01-01\n---\n\nText\n");
  lfAttribute(join(dir, ".gitattributes"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.org");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");

  const boardUi = join(kit, "board-ui.mjs");
  const hilfe = spawnSync(process.execPath, [boardUi, "--help"], { cwd: dir, encoding: "utf-8" });
  assert.equal(hilfe.status, 0, hilfe.stderr);
  assert.match(hilfe.stdout, /a simple viewer/);

  const kind = spawn(process.execPath, [boardUi], { cwd: dir, stdio: "pipe" });
  let stdout = "";
  let stderr = "";
  kind.stdout.on("data", (d) => (stdout += d));
  kind.stderr.on("data", (d) => (stderr += d));
  try {
    await warteAufServer(port);
    const post = async (pfad, body) => {
      const r = await fetch(`http://localhost:${port}${pfad}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: await r.json() };
    };
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    const antworten = [
      await post("/api/issues", { title: " " }),
      await post("/api/issues/0007/move", { to: "nirgends" }),
      await post("/api/issues/99/move", { to: "ready" }),
      await post("/api/issues/0007/edit", { title: "" }),
      await post("/api/issues/99/edit", { title: "x" }),
      await post("/api/issues/0007/comment", { text: "" }),
      await post("/api/issues/99/comment", { text: "x" }),
      await post("/api/issues/reorder", { ids: "x" }),
    ];
    assert.ok(antworten.every((a) => a.status >= 400 && Object.keys(a.json).join() === "error"), "Feldname error bleibt Vertrag (E14)");
    assert.match(antworten[0].json.error, /^Title must not be empty$/);
    assert.match(antworten[1].json.error, /^Invalid status 'nirgends'\. Valid: backlog, ready, in_progress, in_review, done$/);
    assert.match(antworten[2].json.error, /^Issue 99 not found$/);
    assert.match(antworten[5].json.error, /^Empty comment$/);
    assert.match(antworten[7].json.error, /^ids must be an array$/);

    const kommentar = await post("/api/issues/0007/comment", { text: "Hallo" });
    assert.equal(kommentar.status, 200);
    assert.match(readFileSync(join(issues, "0007.md"), "utf-8"), /\n---\n\*\*Kommentar\*\* \(/, "der Kommentar-Marker der Datei bleibt Vertrag (E14)");

    const go = await post("/api/issues/0007/move", { to: "ready" });
    assert.equal(go.status, 200);
    assert.equal(git(dir, "log", "-1", "--format=%s").trim(), "GO: #0007 to ready", stderr);

    // Das Archiv laeuft beim Start im Hintergrund; seine Meldung steht spaetestens jetzt da.
    await warteAufAusgabe(() => stdout, /^Archived: 0008\.md$/m);
    assert.match(stdout, /^Board running at http:\/\/localhost:\d+$/m, "der Start meldet sich englisch (Issue #1501)");
    assert.match(stdout, /^Issues directory: /m);

    // Was der Mensch auf der Seite sieht: das Markup ohne Skript und Stil, dazu die Werte der
    // eingebetteten Tabelle. Kommentare und Bezeichner im Skript sind keine Meldungen.
    const markup = html.replaceAll(/<(script|style)>[\s\S]*?<\/\1>/g, "");
    const tabelle = JSON.parse(html.match(/const TEXTE_SEITE = (.*);\n/)[1]);
    const alles = [hilfe.stdout, stdout, stderr, markup, ...Object.values(tabelle), ...antworten.map((a) => a.json.error)].join("\n");
    assert.match(html, /<html lang="en">/);
    const gefunden = deutscheBruchstuecke().filter((s) => alles.includes(s));
    assert.deepEqual(gefunden, [], "deutsche Meldung in einem englischen Projekt");
  } finally {
    const beendet = kind.exitCode !== null || kind.signalCode !== null
      ? Promise.resolve()
      : new Promise((ok) => kind.once("exit", ok));
    kind.kill();
    await beendet;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
