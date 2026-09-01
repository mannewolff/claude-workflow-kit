// Verbleibende Wege in kit/board.mjs (Issue #405).
//
// Drei Stellen, an denen die Bestandstests nur die eine Haelfte pruefen:
//
// 1. Die Uebersetzung des 404 beim Label-Setzen. Geprueft war, dass ein fehlendes
//    Label eine sprechende Meldung bekommt; dass JEDER ANDERE Fehler unveraendert
//    durchgereicht wird, stand nirgends. Wer ihn mit uebersetzt, meldet bei einem
//    kaputten Server "Label nicht definiert" — und schickt den Menschen morgens
//    Labels anlegen, die es laengst gibt.
// 2. Eine Textdatei, die da ist, sich aber nicht lesen laesst. Der Unterschied zu
//    "nicht gefunden" ist die halbe Diagnose.
// 3. Die mehrdeutige Vault-Notiz (Issue #286). Sie braucht ein Dateisystem, das
//    Gross- und Kleinschreibung unterscheidet — auf einem case-insensitiven
//    Dateisystem (macOS-Standard) laesst sich der Fall nicht einmal herstellen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, chmodSync, rmSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupProjekt, runBoard, runBoardAsync, board, starteServer } from "./helpers/board-fixture.mjs";

function karte(number, extra = {}) {
  return { id: number * 100, number, title: `Karte ${number}`, body: "## Kontext\n\nText.\n", column: "BACKLOG", position: 0, ...extra };
}

// ============================================================
// Label-Fehler: uebersetzt wird nur der 404
// ============================================================

// Der Mock laeuft im selben Prozess wie der Test: Ein synchroner spawnSync wuerde
// die Event-Loop blockieren und der Request nie bedient — deshalb runBoardAsync
// (dieselbe Begruendung wie im Kopf von board-fixture.mjs).
async function mitToolbox(labelAntwort, fn) {
  const karten = [karte(7)];
  const { server, host } = await starteServer((req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") {
      const g = {};
      for (const k of karten) (g[k.column] ||= []).push(k);
      return { status: 200, json: g };
    }
    if (/^\/api\/kanban\/items\/\d+\/labels/.test(req.url)) return labelAntwort;
    return null;
  });
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-luecken-label-");
  try {
    await fn(dir);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ACHTUNG, Fundstelle: Die Uebersetzung haengt am TEXT der Meldung
// (`/HTTP 404|nicht gefunden/i`), nicht am Statuscode. Liefert der Server zum 404
// einen JSON-Body mit `message`, ersetzt `_fetch` den Text durch diese Meldung —
// "HTTP 404" steht dann nirgends mehr, und die Uebersetzung aus Issue #384 greift
// nicht. Der Test bildet deshalb den Fall OHNE message-Body ab; der andere ist als
// eigener Befund gemeldet und nicht Gegenstand dieses Issues.
test("ein fehlendes Label wird uebersetzt und nennt den Ausweg", async () => {
  await mitToolbox({ status: 404, text: "" }, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "label", "add", "7", "review:offen"], { TBX_TOKEN: "t" });

    assert.notEqual(res.status, 0, "ein fehlendes Label haette den Aufruf scheitern lassen muessen");
    assert.match(res.stderr, /Label 'review:offen' ist am Board nicht definiert/,
      "die Meldung nennt weder Namen noch Ursache");
    assert.match(res.stderr, /POST \/api\/boards\/\{boardId\}\/labels/,
      "die Meldung nennt den Ausweg nicht");
  });
});

test("jeder andere Label-Fehler wird unveraendert durchgereicht", async () => {
  // Ein 500 ist KEIN fehlendes Label. Wuerde er mit uebersetzt, schickte die Meldung
  // den Menschen Definitionen anlegen, die es laengst gibt — waehrend der Server
  // kaputt ist.
  await mitToolbox({ status: 500, json: { message: "Board kaputt" } }, async (dir) => {
    const res = await runBoardAsync(dir, ["issue", "label", "add", "7", "review:offen"], { TBX_TOKEN: "t" });

    assert.notEqual(res.status, 0, "ein Serverfehler haette den Aufruf scheitern lassen muessen");
    assert.doesNotMatch(res.stderr, /nicht definiert/,
      "ein Serverfehler darf nicht als fehlendes Label gemeldet werden");
    assert.match(res.stderr, /Board kaputt|HTTP 500/,
      "die Meldung des Servers fehlt — ohne sie ist der Fehler nicht zuzuordnen");
  });
});

// ============================================================
// Eine Textdatei, die sich nicht lesen laesst
// ============================================================

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Leseschutz haengt an POSIX-Dateirechten, chmod wirkt dort anders." }
  : {};

test("eine unlesbare --text-file wird von einer fehlenden unterschieden", NUR_POSIX, () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-luecken-text-");
  const datei = join(dir, "kommentar.txt");
  try {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");
    writeFileSync(datei, "Inhalt\n", "utf-8");
    chmodSync(datei, 0o000);

    const res = runBoard(dir, ["issue", "comment", String(issue.id), "--text-file", datei]);

    assert.notEqual(res.status, 0, "eine unlesbare Datei haette den Aufruf scheitern lassen muessen");
    assert.match(res.stderr, /ist nicht lesbar \(EACCES\)/,
      "der Unterschied zu 'nicht gefunden' ist die halbe Diagnose und fehlt");
    assert.doesNotMatch(res.stderr, /nicht gefunden/,
      "eine vorhandene Datei darf nicht als fehlend gemeldet werden");
  } finally {
    if (existsSync(datei)) chmodSync(datei, 0o644);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Mehrdeutige Vault-Notiz (Issue #286)
// ============================================================

/**
 * Ob das Dateisystem Gross- und Kleinschreibung unterscheidet.
 *
 * Auf macOS ist es per Default case-insensitiv: Dort laesst sich der Fall gar nicht
 * herstellen, weil die zweite Datei die erste ueberschreibt. Der Test wird dann
 * uebersprungen — mit sichtbarem Grund, damit er nicht wie bestanden aussieht
 * (Issue #197).
 */
function fsUnterscheidetGrossschreibung() {
  const dir = mkdtempSync(join(tmpdir(), "fs-case-"));
  try {
    writeFileSync(join(dir, "Aa"), "1");
    writeFileSync(join(dir, "aA"), "2");
    // Gezaehlt, nicht per existsSync geprueft: Auf einem case-insensitiven
    // Dateisystem treffen BEIDE Namen dieselbe Datei, und existsSync meldet fuer
    // beide `true` — der Unterschied zeigt sich nur an der Zahl der Eintraege.
    return readdirSync(dir).length === 2;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NUR_CASE_SENSITIV = fsUnterscheidetGrossschreibung()
  ? {}
  : { skip: "Dateisystem unterscheidet keine Gross-/Kleinschreibung — zwei so benannte Notizen sind hier nicht anlegbar." };

test("zwei Notizen, die sich nur in der Schreibweise unterscheiden, werden gemeldet", NUR_CASE_SENSITIV, () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-luecken-notiz-");
  const vault = join(dir, "vault");
  try {
    const ordner = join(vault, "Projekte", "meinprojekt");
    mkdirSync(ordner, { recursive: true });
    writeFileSync(join(ordner, "meinprojekt.md"), "# klein\n");
    writeFileSync(join(ordner, "MeinProjekt.md"), "# gross\n");
    writeFileSync(join(dir, ".claude", "kontext.config.json"),
      JSON.stringify({ vault, project: "meinprojekt" }), "utf-8");

    const res = runBoard(dir, ["kontext", "paths"]);

    assert.notEqual(res.status, 0, "eine mehrdeutige Notiz haette den Aufruf scheitern lassen muessen");
    assert.match(res.stderr, /Mehrdeutige Notiz/, "die Mehrdeutigkeit wird nicht benannt");
    assert.match(res.stderr, /meinprojekt\.md/, "die beteiligten Dateien werden nicht genannt");
    assert.match(res.stderr, /Gross-\/Kleinschreibung/,
      "ohne die Ursache kann niemand den Vault reparieren");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
