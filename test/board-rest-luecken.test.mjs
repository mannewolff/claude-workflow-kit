// Die letzten Verzweigungen in kit/board.mjs (Issue #405).
//
// Vier Bereiche, in denen jeweils ein Weg geprueft war und der andere nicht: der
// Toolbox-Adapter, die Vault-Pfade, der Probelauf der Reviewer und das Setzen der
// Zustandslabels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, chmodSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setupProjekt, runBoard, runBoardAsync, board, starteServer, fakeCli } from "./helpers/board-fixture.mjs";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Die Fakes sind endungslose Dateien mit Shebang, und der Leseschutz haengt an POSIX-Rechten. Siehe Issue #197." }
  : {};

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function karte(number, extra = {}) {
  return { id: number * 100, number, title: `Karte ${number}`, body: "## Kontext\n\nText.\n", column: "BACKLOG", position: 0, ...extra };
}

// ============================================================
// Toolbox-Adapter
// ============================================================

// Der Mock laeuft im selben Prozess wie der Test — deshalb runBoardAsync statt des
// synchronen runBoard (siehe Kopf von board-fixture.mjs).
async function mitToolbox(fn, { karten = [karte(7)], antwort = null, config = {} } = {}) {
  const { server, requests, host } = await starteServer((req, koerper) => {
    if (antwort) {
      const eigen = antwort(req, koerper);
      if (eigen) return eigen;
    }
    if (req.url === "/api/kanban/items" && req.method === "GET") {
      const g = {};
      for (const k of karten) (g[k.column] ||= []).push(k);
      return { status: 200, json: g };
    }
    if (req.method === "POST" && req.url === "/api/kanban/items") {
      return { status: 200, json: { id: 5001, number: 42 } };
    }
    return null;
  });
  const dir = setupProjekt(
    { codeHost: "local", issueTracker: "toolbox", ...config, toolbox: { host, ...config.toolbox } },
    "board-rest-toolbox-",
  );
  try {
    await fn(dir, requests);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("toolbox: ein ungueltiger Status nennt die gueltigen Werte", async () => {
  await mitToolbox(async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "move", "7", "gibt-es-nicht"], { TBX_TOKEN: "t" });

    assert.notEqual(res.status, 0, "ein unbekannter Status haette scheitern muessen");
    assert.match(res.stderr, /Ungueltiger Status 'gibt-es-nicht'/, "der Wert fehlt in der Meldung");
    assert.match(res.stderr, /Gueltig: /, "ohne die Aufzaehlung ist der Tippfehler nicht zu finden");
  });
});

test("toolbox: create ohne --body schickt einen leeren Body, nie 'undefined'", async () => {
  await mitToolbox(async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "create", "--title", "Ohne Body"], { TBX_TOKEN: "t" });

    assert.equal(res.status, 0, `create haette durchlaufen muessen: ${res.stderr}`);
    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    assert.ok(post, "es wurde keine Karte angelegt");
    const daten = JSON.parse(post.body);
    assert.equal(typeof daten.body, "string", "der Body muss ein Text sein");
    assert.ok(!daten.body.includes("undefined"), "'undefined' steht im Body");
  });
});

test("toolbox: ein Token aus der Datei wird gelesen, wenn TBX_TOKEN fehlt", async () => {
  await mitToolbox(async (dir, requests) => {
    writeFileSync(join(dir, ".claude", "kanban-token"), "datei-token\n", "utf-8");

    const res = await runBoardAsync(dir, ["issue", "list"]);

    assert.equal(res.status, 0, `list haette durchlaufen muessen: ${res.stderr}`);
    const get = requests.find((r) => r.method === "GET");
    assert.equal(get.headers["x-kanban-token"], "datei-token",
      "das Token aus der Datei wurde nicht (oder ungetrimmt) mitgeschickt");
  }, { config: { toolbox: { tokenFile: ".claude/kanban-token" } } });
});

// ============================================================
// Vault-Pfade: der Ordner und der Repo-Name
// ============================================================

test("kontext paths: ein fehlender Notizordner ist kein Fehler", () => {
  const dir = setupProjekt(LOKAL, "board-rest-ordner-fehlt-");
  try {
    const vault = join(dir, "vault");
    mkdirSync(vault, { recursive: true });
    writeFileSync(join(dir, ".claude", "kontext.config.json"),
      JSON.stringify({ vault, project: "neu" }), "utf-8");

    const res = runBoard(dir, ["kontext", "paths"]);

    assert.equal(res.status, 0, `paths haette durchlaufen muessen: ${res.stderr}`);
    const daten = JSON.parse(res.stdout);
    assert.equal(daten.mode, "full");
    assert.match(daten.projectNote, /neu[/\\]neu\.md$/,
      "ohne Ordner gilt der konstruierte Name — der Fall der Erstanlage");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kontext paths: ein nicht lesbarer Notizordner wird gemeldet", NUR_POSIX, () => {
  const dir = setupProjekt(LOKAL, "board-rest-ordner-gesperrt-");
  const ordner = join(dir, "vault", "Projekte", "gesperrt");
  try {
    mkdirSync(ordner, { recursive: true });
    // Kein Leserecht: Das ist etwas anderes als "gibt es nicht", und die Meldung
    // muss den Unterschied machen — sonst sucht man die Notiz statt der Rechte.
    chmodSync(ordner, 0o000);

    const res = runBoard(dir, ["kontext", "paths", "--project", "gesperrt"], {
      KIT_KONTEXT_CONFIG: "",
    });
    writeFileSync(join(dir, ".claude", "kontext.config.json"),
      JSON.stringify({ vault: join(dir, "vault"), project: "gesperrt" }), "utf-8");
    const zweiter = runBoard(dir, ["kontext", "paths"]);

    // Der erste Lauf laeuft ohne Vault-Config im Degraded Mode; erst der zweite
    // erreicht den Ordner.
    assert.equal(res.status, 0, "ohne Vault-Config ist paths ein Degraded-Lauf");
    assert.notEqual(zweiter.status, 0, "ein gesperrter Ordner haette scheitern muessen");
    assert.match(zweiter.stderr, /Notizordner nicht lesbar/, "die Ursache wird nicht benannt");
    assert.match(zweiter.stderr, /EACCES|EPERM/, "der Systemfehler fehlt");
  } finally {
    if (existsSync(ordner)) chmodSync(ordner, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kontext last-log ohne Vault liefert path null", () => {
  const dir = setupProjekt(LOKAL, "board-rest-lastlog-");
  try {
    const res = runBoard(dir, ["kontext", "last-log"]);

    assert.equal(res.status, 0, `last-log haette durchlaufen muessen: ${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stdout), { path: null },
      "ohne Vault ist der fehlende Vorgaenger der Normalfall, kein Fehler");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("code repo-name ohne origin-Remote liefert null statt zu raten", NUR_POSIX, () => {
  const dir = setupProjekt(LOKAL, "board-rest-ohne-origin-");
  try {
    // Ein git-Repo ohne origin: `git remote get-url origin` scheitert, und der
    // Adapter darf daraus keinen Namen erfinden.
    for (const args of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"]]) {
      assert.equal(spawnSync("git", args, { cwd: dir }).status, 0, `git ${args.join(" ")} schlug fehl`);
    }

    const res = runBoard(dir, ["code", "repo-name"]);

    assert.equal(res.status, 0, `repo-name haette durchlaufen muessen: ${res.stderr}`);
    const daten = JSON.parse(res.stdout);
    assert.equal(daten.repo ?? daten.name ?? null, null,
      `ohne origin darf kein Name entstehen: ${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Probelauf: die drei Todesarten eines Reviewer-Kommandos
// ============================================================

function fakeBinary(dir, name, rumpf) {
  const binDir = join(dir, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const p = join(binDir, name);
  writeFileSync(p, `#!/bin/sh\n${rumpf}\n`, { mode: 0o755 });
}

function mitReviewer(command, rumpf, fn, name = "fake") {
  const dir = setupProjekt(
    { ...LOKAL, issueReview: { rounds: 1, reviewers: [{ name, kind: "command", command }] } },
    "board-rest-probe-",
  );
  try {
    if (rumpf !== null) fakeBinary(dir, command.split(/\s+/)[0], rumpf);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("probelauf: ein Kommando ohne Ausgabe auf stderr nennt wenigstens den Exit-Code", NUR_POSIX, () => {
  // Scheitert das Werkzeug wortlos, ist der Exit-Code die einzige Auskunft. Ohne
  // diesen Rueckfall stuende dort eine leere Zeichenkette.
  mitReviewer("stumm --flag", "exit 3", (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);

    assert.equal(res.status, 0, "check bleibt eine Auskunft, kein Gate");
    const befund = JSON.parse(res.stdout).reviewers[0];
    assert.equal(befund.verfuegbar, false);
    assert.match(befund.grund, /Exit 3/, "ohne stderr muss der Exit-Code die Auskunft sein");
  });
});

test("probelauf: ein durch Signal gestorbenes Kommando gilt nicht als verfuegbar", NUR_POSIX, () => {
  // SIGSEGV liefert status null UND error undefined. Ohne den dritten Zweig fiele
  // der Fall auf `ok: true` durch — ein abgestuerzter Reviewer gaelte als
  // verfuegbar (Issue #393).
  mitReviewer("crasht --flag", "kill -SEGV $$", (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);

    assert.equal(res.status, 0, "check bleibt eine Auskunft, kein Gate");
    const befund = JSON.parse(res.stdout).reviewers[0];
    assert.equal(befund.verfuegbar, false, "ein Absturz darf nicht als verfuegbar gelten");
    assert.match(befund.grund, /Signal SIGSEGV/, "die Todesart wird nicht benannt");
  });
});

// ============================================================
// Zustandslabels: entfernen, dann setzen
// ============================================================

test("label-sync entfernt fremde Zustandslabels, bevor es das Ziel setzt", async () => {
  const gesetzt = [];
  await mitToolbox(async (dir) => {
    const res = await runBoardAsync(dir, ["issue-review", "label-sync", "7"], { TBX_TOKEN: "t" });

    assert.equal(res.status, 0, `label-sync schlug fehl: ${res.stderr}`);
    // Reihenfolge verbindlich: erst remove, dann add. Umgekehrt traegt die Karte
    // einen Moment lang zwei Zustandslabels (belegt an Issue #375).
    const nurZustand = gesetzt.filter((e) => e.label.startsWith("review:"));
    assert.deepEqual(nurZustand, [
      { aktion: "remove", label: "review:fertig" },
      { aktion: "add", label: "review:offen" },
    ], `Reihenfolge oder Auswahl stimmen nicht: ${JSON.stringify(gesetzt)}`);
  }, {
    // Die Karte traegt bereits ein FALSCHES Zustandslabel — genau der Fall, fuer den
    // das Kommando zugleich die Reparatur ist.
    karten: [karte(7, { labels: ["review:fertig"] })],
    config: { issueReview: { statusLabels: true } },
    antwort: (req, koerper) => {
      const treffer = /^\/api\/kanban\/items\/\d+\/labels(\?name=(.+))?$/.exec(req.url);
      if (!treffer) return null;
      // Beim Entfernen steht der Name im QUERY, beim Setzen im Rumpf — der Adapter
      // spricht zwei verschiedene Routen an, und beide muessen mitgeschrieben werden.
      if (req.method === "DELETE") {
        gesetzt.push({ aktion: "remove", label: decodeURIComponent(treffer[2] || "") });
      } else {
        gesetzt.push({ aktion: "add", label: JSON.parse(koerper || "{}").name });
      }
      return { status: 204, text: "" };
    },
  });
});
