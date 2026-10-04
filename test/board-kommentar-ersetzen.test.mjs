// Kommentare streng lesen und einen Kommentar ersetzen — die Adapter-Schicht fuer
// `issue melden` (Issue #1021, Plan #1015 E10).
//
// `melden` muss den Bericht eines Laufs unter den Kommentaren wiederfinden und
// ersetzen. Zwei Dinge fehlten dafuer in allen vier Adaptern:
//
//  - ein Lesen, das bei einem Fehler wirft: `_comments` (toolbox) und `_notes`
//    (gitlab) liefern dann `[]`, und ein leer gelesener Stand fuehrte in `melden`
//    zum doppelten Bericht. Die nachsichtigen Pfade bleiben fuer `issue get`.
//  - `ersetzeKommentar(id, kommentarId, text)`.
//
// Die Adapter werden hier IM PROZESS gerufen (`resolveTracker`), weil es noch keinen
// CLI-Befehl dafuer gibt — der kommt mit `issue melden`. gh und glab sind Fake-Binaries
// im PATH dieses Prozesses; node:test startet je Datei einen eigenen Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { resolveTracker } from "../kit/board.mjs";
import {
  setupProjekt, fakeCli, fakePath, aufrufe, starteServer, runBoardAsync, toolboxMitKommentaren, TEST_TOOLBOX_BUDGET_MS,
} from "./helpers/board-fixture.mjs";

process.env.TBX_TOKEN = "test-token";
process.env.TBX_CONFIG_DIR = "/nicht/vorhanden";
process.env.KIT_TOOLBOX_BUDGET_MS = TEST_TOOLBOX_BUDGET_MS;

/** Fake-CLI im PATH dieses Prozesses, danach aufgeraeumt. */
async function mitFakeCli(name, regeln, fn) {
  const dir = setupProjekt(null, `board-ersetzen-${name}-`);
  fakeCli(dir, name, regeln);
  const altPath = process.env.PATH;
  process.env.PATH = fakePath(dir);
  try {
    return await fn(dir);
  } finally {
    process.env.PATH = altPath;
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- GitHub ---

const GITHUB = { issueTracker: "github" };
const GH_KOMMENTARE = {
  comments: [
    { id: "IC_kwDOerster", url: "https://github.com/besitzer/repo/issues/5#issuecomment-111", author: { login: "a" }, body: "Erster", createdAt: "2026-09-01T09:00:00Z" },
    { id: "IC_kwDOzweiter", url: "https://github.com/besitzer/repo/issues/5#issuecomment-222", author: { login: "b" }, body: "Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z", createdAt: "2026-09-01T10:00:00Z" },
  ],
};

test("GitHub: kommentareStreng liefert die REST-IDs", async () => {
  await mitFakeCli("gh", [
    { match: "^repo view", stdout: "besitzer/repo" },
    { match: "^issue view 5 ", stdout: GH_KOMMENTARE },
  ], async () => {
    const kommentare = await resolveTracker(GITHUB).kommentareStreng("5");
    assert.deepEqual(kommentare.map((c) => c.id), ["111", "222"]);
  });
});

test("GitHub: kommentareStreng wirft, wenn gh scheitert", async () => {
  await mitFakeCli("gh", [
    { match: "^repo view", stdout: "besitzer/repo" },
    { match: "^issue view", stderr: "HTTP 502\n", exit: 1 },
  ], async () => {
    await assert.rejects(() => resolveTracker(GITHUB).kommentareStreng("5"), /HTTP 502/);
  });
});

test("GitHub: ersetzeKommentar ruft PATCH auf die numerische Kommentar-ID", async () => {
  await mitFakeCli("gh", [
    { match: "^repo view", stdout: "besitzer/repo" },
    { match: "^api repos/besitzer/repo/issues/comments/222 ", stdout: "{}" },
  ], async (dir) => {
    await resolveTracker(GITHUB).ersetzeKommentar("5", "222", "Neu\nBericht-Lauf: 2026-09-29T10:00:00Z");
    const apiAufrufe = aufrufe(dir, "gh").filter((a) => a[0] === "api");
    assert.equal(apiAufrufe.length, 1, "genau ein Schreibaufruf");
    assert.deepEqual(apiAufrufe[0], [
      "api", "repos/besitzer/repo/issues/comments/222", "-X", "PATCH", "-f", "body=Neu\nBericht-Lauf: 2026-09-29T10:00:00Z",
    ]);
    // Ersetzen legt keinen zweiten Kommentar an.
    assert.equal(aufrufe(dir, "gh").filter((a) => a[0] === "issue" && a[1] === "comment").length, 0);
  });
});

// --- GitLab ---

const GITLAB = { issueTracker: "gitlab" };

test("GitLab: kommentareStreng liefert die Note-IDs", async () => {
  await mitFakeCli("glab", [
    { match: "^api projects/:id/issues/42/notes$", stdout: [
      { id: 7, author: { username: "manne" }, body: "Notiz", created_at: "2026-09-01T10:00:00Z" },
      { id: 8, author: { username: "bot" }, body: "changed", created_at: "2026-09-01T10:01:00Z", system: true },
    ] },
  ], async () => {
    const kommentare = await resolveTracker(GITLAB).kommentareStreng("42");
    assert.deepEqual(kommentare, [{ author: "manne", body: "Notiz", createdAt: "2026-09-01T10:00:00Z", id: "7" }]);
  });
});

test("GitLab: kommentareStreng wirft bei scheiternder Notes-Route, issue get laeuft weiter mit []", async () => {
  await mitFakeCli("glab", [
    { match: "^issue view 42", stdout: { iid: 42, title: "T", description: "B", state: "opened", labels: [] } },
    { match: "^api projects/:id/issues/42/notes$", stderr: "404 Not Found\n", exit: 1 },
  ], async () => {
    const tracker = resolveTracker(GITLAB);
    await assert.rejects(() => tracker.kommentareStreng("42"), /404 Not Found/);
    const geholt = await tracker.getIssue("42");
    assert.deepEqual(geholt.comments, []);
  });
});

test("GitLab: ersetzeKommentar ruft PUT auf die Note", async () => {
  await mitFakeCli("glab", [
    { match: "^api projects/:id/issues/42/notes/7 ", stdout: "{}" },
  ], async (dir) => {
    await resolveTracker(GITLAB).ersetzeKommentar("42", "7", "Neuer Text");
    const alle = aufrufe(dir, "glab");
    assert.equal(alle.length, 1, "genau ein Aufruf, kein zusaetzliches note");
    assert.deepEqual(alle[0], ["api", "projects/:id/issues/42/notes/7", "-X", "PUT", "-f", "body=Neuer Text"]);
  });
});

// --- local ---

async function mitLokal(fn) {
  const dir = setupProjekt(null, "board-ersetzen-local-");
  const issuesDir = join(dir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  try {
    return await fn(resolveTracker({ issueTracker: "local", local: { issuesDir } }), join(issuesDir, "0005.md"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LOKAL_KOPF = "---\nid: \"0005\"\ntype: task\nstatus: in_progress\ntitle: Paket\n---\n\n## Kontext\nText mit --- Strich.\n";
const LOKAL_DATEI = LOKAL_KOPF
  + "\n\n---\n**Kommentar** (2026-09-28 08:00)\n\nFrueherer Bericht\nBericht-Lauf: 2026-09-28T08:00:00Z"
  + "\n\n---\n**Kommentar** (2026-09-29 10:00)\n\nAlter Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z"
  + "\n\n---\n**Kommentar** (2026-09-29 11:00)\n\nNachtrag";

test("local: kommentareStreng liefert die angehaengten Bloecke mit fortlaufender ID", async () => {
  await mitLokal(async (tracker, datei) => {
    writeFileSync(datei, LOKAL_DATEI);
    assert.deepEqual(await tracker.kommentareStreng("5"), [
      { author: "", body: "Frueherer Bericht\nBericht-Lauf: 2026-09-28T08:00:00Z", createdAt: "2026-09-28 08:00", id: "1" },
      { author: "", body: "Alter Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z", createdAt: "2026-09-29 10:00", id: "2" },
      { author: "", body: "Nachtrag", createdAt: "2026-09-29 11:00", id: "3" },
    ]);
  });
});

test("local: kommentareStreng wirft, wenn die Karte fehlt", async () => {
  await mitLokal(async (tracker) => {
    await assert.rejects(() => tracker.kommentareStreng("5"), /nicht gefunden/);
  });
});

test("local: ersetzeKommentar ersetzt genau den Block derselben Bericht-Lauf-Zeile", async () => {
  await mitLokal(async (tracker, datei) => {
    writeFileSync(datei, LOKAL_DATEI);
    const neu = "Neuer Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z";
    await tracker.ersetzeKommentar("5", "2", neu);

    const inhalt = readFileSync(datei, "utf-8");
    const praefix = LOKAL_DATEI.slice(0, LOKAL_DATEI.indexOf("Alter Bericht"));
    assert.ok(inhalt.startsWith(praefix), "Body-Praefix vor dem ersetzten Block ist Byte fuer Byte gleich");
    assert.equal(inhalt, LOKAL_DATEI.replace("Alter Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z", neu));

    const kommentare = await tracker.kommentareStreng("5");
    assert.equal(kommentare.length, 3, "die Zahl der Kommentare bleibt gleich");
    assert.equal(kommentare[1].body, neu);
    assert.equal(kommentare[0].body, "Frueherer Bericht\nBericht-Lauf: 2026-09-28T08:00:00Z");
  });
});

test("local: ersetzeKommentar verweigert einen Block mit anderer Bericht-Lauf-Zeile", async () => {
  await mitLokal(async (tracker, datei) => {
    writeFileSync(datei, LOKAL_DATEI);
    await assert.rejects(
      () => tracker.ersetzeKommentar("5", "1", "Neu\nBericht-Lauf: 2026-09-29T10:00:00Z"),
      /Bericht-Lauf/
    );
    assert.equal(readFileSync(datei, "utf-8"), LOKAL_DATEI, "nichts geschrieben");
  });
});

test("local: ersetzeKommentar mit unbekannter Kommentar-ID wirft", async () => {
  await mitLokal(async (tracker, datei) => {
    writeFileSync(datei, LOKAL_DATEI);
    await assert.rejects(() => tracker.ersetzeKommentar("5", "9", "Neu"), /Kommentar 9/);
  });
});

// --- toolbox ---

const KARTE = { id: 700, number: 7, title: "Karte 7", body: "Body 7", column: "IN_PROGRESS", position: 0 };

async function mitToolbox(optionen, fn) {
  const kommentare = {
    700: [
      { id: 31, author: "manne", body: "Erster", createdAt: "2026-09-01T09:00:00Z" },
      { id: 32, author: "kit", body: "Alter Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z", createdAt: "2026-09-01T10:00:00Z" },
    ],
  };
  const { server, requests, host } = await starteServer(toolboxMitKommentaren({ karten: [KARTE], kommentare, ...optionen }));
  try {
    return await fn(resolveTracker({ issueTracker: "toolbox", toolbox: { host } }), { kommentare, requests, host });
  } finally {
    server.close();
  }
}

test("toolbox: kommentareStreng liefert die Kommentar-IDs", async () => {
  await mitToolbox({}, async (tracker) => {
    const kommentare = await tracker.kommentareStreng("7");
    assert.deepEqual(kommentare.map((c) => c.id), ["31", "32"]);
  });
});

test("toolbox: ersetzeKommentar ersetzt genau den gemeinten Kommentar per PATCH", async () => {
  await mitToolbox({}, async (tracker, { kommentare, requests }) => {
    await tracker.ersetzeKommentar("7", "32", "Neuer Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z");
    const patch = requests.filter((r) => r.method === "PATCH");
    assert.equal(patch.length, 1);
    assert.equal(patch[0].url, "/api/kanban/items/700/comments/32");
    assert.equal(kommentare[700].length, 2, "die Zahl der Kommentare bleibt gleich");
    assert.equal(kommentare[700][0].body, "Erster");
    assert.equal(kommentare[700][1].body, "Neuer Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z");
    assert.equal(requests.filter((r) => r.method === "POST").length, 0, "kein zweiter Kommentar");
  });
});

test("toolbox ohne PATCH-Route: ersetzeKommentar wirft und nennt die Route", async () => {
  await mitToolbox({ patchRoute: false }, async (tracker, { kommentare }) => {
    await assert.rejects(
      () => tracker.ersetzeKommentar("7", "32", "Neu"),
      (e) => {
        assert.match(e.message, /PATCH \/api\/kanban\/items\/700\/comments\/32/);
        assert.match(e.message, /405/);
        return true;
      }
    );
    assert.equal(kommentare[700][1].body, "Alter Bericht\nBericht-Lauf: 2026-09-29T10:00:00Z");
  });
});

test("toolbox: kommentareStreng wirft bei scheiternder Lese-Route, issue get laeuft weiter mit []", async () => {
  await mitToolbox({ leseRoute: false }, async (tracker, { host }) => {
    await assert.rejects(() => tracker.kommentareStreng("7"), /HTTP 500/);

    const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-ersetzen-get-");
    try {
      const res = await runBoardAsync(dir, ["issue", "get", "7"], { TBX_TOKEN: "test-token" });
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout).comments, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
