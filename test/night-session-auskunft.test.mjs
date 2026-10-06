// Die Zeit fuer Board-Auskuenfte am Session-Strom (Issue #1026, Plan #1015, E11/E12/E15).
//
// Gemessen wird Zeit, nicht die Zahl der Rueckfragen: die Werkzeugspanne (tool_use bis
// tool_result) jedes Aufrufs, der eine Rueckfrage ist oder deren Antwort aufbereitet.
// Drei Ebenen: `auskunftArt()` als Klassifizierer, `auskunftBeobachter()` an
// aufgezeichneten Stromzeilen, und der Weg in die Einheit des Ergebnisstands ueber
// `runSession` im selben Prozess, mit einer Attrappe statt der Session (Issue #1229).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { einheitAnlegen } from "../kit/night/grundlagen.mjs";
import {
  auskunftArt, auskunftBeobachter, umsetzungsStart, runSession, salvagePrompt,
  TOOL_RESULTS_PFAD,
} from "../kit/night/session.mjs";
import { sessionAbh, mitLauf, ARGS } from "./helpers/session-attrappe.mjs";

/** Ein Bash-`tool_use`-Block. */
function bash(command, id = "t1") {
  return { type: "tool_use", id, name: "Bash", input: { command } };
}

// ============================================================
// auskunftArt — Rueckfragen (E11)
// ============================================================

test("[night-1026] jede Rueckfrage-Form aus E11 wird erkannt", () => {
  const faelle = [
    "node .claude/kit/board.mjs issue get 1026",
    "node .claude/kit/board.mjs issue list --status ready",
    "node .claude/kit/board.mjs issue epics",
    "node .claude/kit/board.mjs issue activity 17",
    "node .claude/kit/board.mjs issue auftrag 1026",
    "node .claude/kit/board.mjs kontext",
    "gh issue view 12 --comments",
    "gh issue list --state open",
    "glab issue view 3",
    "glab issue list",
    "gh api repos/o/r/issues/12/comments",
    "gh api -X GET repos/o/r/issues?state=open",
    // Ein zusammengesetzter Aufruf bleibt eine Rueckfrage.
    "cd /tmp/projekt && node .claude/kit/board.mjs issue get 5",
    // Umleitung in eine Datei ist keine Aufbereitung.
    "node .claude/kit/board.mjs issue list > /tmp/liste.json",
  ];
  for (const cmd of faelle) assert.equal(auskunftArt(bash(cmd)), "rueckfrage", cmd);
});

test("[night-1026] schreibende Board-Aufrufe sind keine Rueckfrage", () => {
  const faelle = [
    "node .claude/kit/board.mjs issue move 1026 in_progress",
    "node .claude/kit/board.mjs issue comment 1026 --text 'Hallo'",
    "node .claude/kit/board.mjs issue melden 1026 --text '## Abschlussbericht'",
    "node .claude/kit/board.mjs issue label add 1026 kit:klaeren",
    "node .claude/kit/board.mjs issue create --title x",
    "gh issue comment 12 --body x",
    "gh api repos/o/r/pulls/3",
    "git status --porcelain",
    "node --test test/night-session-auskunft.test.mjs",
  ];
  for (const cmd of faelle) assert.equal(auskunftArt(bash(cmd)), null, cmd);
});

test("[night-1026] ein node -e ohne Rueckfrage zaehlt nicht", () => {
  assert.equal(auskunftArt(bash("node -e 'console.log(1+1)'")), null);
  assert.equal(auskunftArt(bash("cat package.json | jq .scripts")), null);
  assert.equal(auskunftArt(bash("echo x | python3 -c 'import sys; print(sys.stdin.read())'")), null);
});

// ============================================================
// auskunftArt — Aufbereitung (E11)
// ============================================================

test("[night-1026] eine Rueckfrage per Pipe an jq, node -e oder python ist Aufbereitung", () => {
  const faelle = [
    "node .claude/kit/board.mjs issue get 5 | jq -r .body",
    "node .claude/kit/board.mjs issue list --status ready | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d)'",
    "gh issue view 12 --json body | python3 -c 'import json,sys; print(json.load(sys.stdin))'",
    "gh api repos/o/r/issues/12 | python -m json.tool",
    "node .claude/kit/board.mjs issue get 5 2>&1 | jq .title",
  ];
  for (const cmd of faelle) assert.equal(auskunftArt(bash(cmd)), "aufbereitung", cmd);
});

test("[night-1026] ein || nach einer Rueckfrage ist keine Pipe", () => {
  assert.equal(auskunftArt(bash("node .claude/kit/board.mjs issue get 5 || python3 -c 'print(1)'")), "rueckfrage");
});

test("[night-1026] ein Aufruf mit ausgelagertem Werkzeugergebnis-Pfad ist Aufbereitung — in jedem Werkzeug", () => {
  const pfad = `/Users/x/.claude/projects/-Users-x-projekt/0f0e0d0c-aaaa-bbbb-cccc-123456789abc/${TOOL_RESULTS_PFAD}b0x1.txt`;
  assert.equal(auskunftArt({ type: "tool_use", id: "r1", name: "Read", input: { file_path: pfad } }), "aufbereitung");
  assert.equal(auskunftArt({ type: "tool_use", id: "g1", name: "Grep", input: { pattern: "Plan", path: pfad } }), "aufbereitung");
  assert.equal(auskunftArt(bash(`jq -r .body ${pfad}`)), "aufbereitung");
  assert.equal(auskunftArt(bash(`node -e 'require("fs").readFileSync("${pfad}")'`)), "aufbereitung");
});

test("[night-1026] das Pfadmuster ist eine Konstante und endet am Verzeichnis", () => {
  assert.equal(TOOL_RESULTS_PFAD, "tool-results/");
});

// Die Gegenprobe gegen eine ECHTE Transkriptzeile (Claude Code 2.1.236, Kette #754 vom
// 2026-09-21), gekuerzt auf Typ, Fassung, Zeitpunkt und den Inhalt der Nachricht. Eine
// nachgebaute Zeile pruefte nur die eigene Annahme ueber das Pfadformat.
test("[night-1026] eine echte Transkriptzeile mit ausgelagertem Werkzeugergebnis ist Aufbereitung", () => {
  const pfad = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "auskunft", "transkript-tool-results.jsonl");
  const zeile = JSON.parse(readFileSync(pfad, "utf-8").trim());
  assert.equal(zeile.version, "2.1.236");
  const bloecke = zeile.message.content.filter((b) => b.type === "tool_use");
  assert.equal(bloecke.length, 1);
  assert.equal(auskunftArt(bloecke[0]), "aufbereitung");
});

test("[night-1026] Nicht-Aufrufe und unlesbare Bloecke ergeben null", () => {
  assert.equal(auskunftArt(null), null);
  assert.equal(auskunftArt({ type: "text", text: "node .claude/kit/board.mjs issue get 5" }), null);
  assert.equal(auskunftArt({ type: "tool_use", id: "x", name: "Bash" }), null);
  assert.equal(auskunftArt({ type: "tool_use", id: "x", name: "Read", input: { file_path: "kit/night.mjs" } }), null);
});

// ============================================================
// auskunftBeobachter — Spannen eines aufgezeichneten Stroms
// ============================================================

function aufrufe(...bloecke) {
  return JSON.stringify({ type: "assistant", message: { content: bloecke } });
}

function ergebnisse(...ids) {
  return JSON.stringify({
    type: "user",
    message: { content: ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: "ok" })) },
  });
}

function beobachte(paare) {
  const b = auskunftBeobachter();
  for (const [zeile, ts] of paare) b.zeile(zeile, ts);
  return b.ergebnis();
}

test("[night-1026] der Beobachter summiert die Spannen tool_use bis tool_result zu { ms, aufrufe }", () => {
  const erg = beobachte([
    [aufrufe(bash("node .claude/kit/board.mjs issue auftrag 7", "a1")), 1000],
    [ergebnisse("a1"), 1800],
    // Ein Aufruf, der nicht zaehlt: seine Spanne geht nicht ein.
    [aufrufe(bash("node --test test/x.test.mjs", "n1")), 2000],
    [ergebnisse("n1"), 9000],
    [aufrufe(bash("node .claude/kit/board.mjs issue get 7 | jq .body", "a2")), 10000],
    [ergebnisse("a2"), 10300],
    // Nachdenkzeit zwischen zwei Aufrufen zaehlt nicht: nur die Spanne je Aufruf.
    [aufrufe({ type: "tool_use", id: "a3", name: "Read", input: { file_path: `/x/${TOOL_RESULTS_PFAD}y.txt` } }), 20000],
    [ergebnisse("a3"), 20100],
  ]);
  assert.deepEqual(erg, { ms: 800 + 300 + 100, aufrufe: 3 });
});

test("[night-1026] parallele Auskuenfte eines Schubs zaehlen einzeln, jede mit ihrer Spanne", () => {
  const erg = beobachte([
    [aufrufe(bash("gh issue view 1", "p1"), bash("gh issue view 2", "p2"), bash("git log", "p3")), 1000],
    [ergebnisse("p1"), 1200],
    [ergebnisse("p2", "p3"), 1500],
  ]);
  assert.deepEqual(erg, { ms: 200 + 500, aufrufe: 2 });
});

test("[night-1026] ein Strom ohne Auskunftsaufruf ergibt { ms: 0, aufrufe: 0 }", () => {
  const erg = beobachte([
    [aufrufe(bash("git status", "g1")), 1000],
    [ergebnisse("g1"), 1100],
  ]);
  assert.deepEqual(erg, { ms: 0, aufrufe: 0 });
});

test("[night-1026] eine Auskunft ohne Ergebnis zaehlt als Aufruf, ihre Spanne geht nicht ein", () => {
  const erg = beobachte([
    [aufrufe(bash("node .claude/kit/board.mjs issue get 1", "o1")), 1000],
  ]);
  assert.deepEqual(erg, { ms: 0, aufrufe: 1 });
});

test("[night-1026] unlesbare Zeilen werden uebersprungen, ergebnis() ist mehrfach abrufbar", () => {
  const b = auskunftBeobachter();
  b.zeile("kein json", 1);
  b.zeile("{kaputt", 2);
  b.zeile(JSON.parse(aufrufe(bash("node .claude/kit/board.mjs kontext", "k1"))), 1000);
  b.zeile(ergebnisse("k1"), 1400);
  assert.deepEqual(b.ergebnis(), { ms: 400, aufrufe: 1 });
  assert.deepEqual(b.ergebnis(), { ms: 400, aufrufe: 1 });
});

// ============================================================
// Einheit: Feldreihenfolge und Umsetzungs-Merkmal (E12, E15)
// ============================================================

test("[night-1026] eine neue Einheit traegt auskunft: null als letztes Feld, davor das Umsetzungs-Merkmal", () => {
  const e = einheitAnlegen("5", "Paket");
  const keys = Object.keys(e);
  assert.equal(keys.at(-1), "auskunft", `Feldreihenfolge: ${keys.join(", ")}`);
  assert.equal(e.auskunft, null);
  assert.equal(keys.at(-2), "umsetzung");
  assert.equal(e.umsetzung, false);
  assert.deepEqual(keys.slice(0, 7), ["id", "titel", "modell", "modellHerkunft", "modellGrund", "stufe", "stufeVerwendet"]);
});

test("[night-1026] das Umsetzungs-Merkmal haengt am Start mit /implement-*, nicht an der Laufart", () => {
  for (const p of ["/implement-next #5", "/implement-ready", "/implement-test #5", "/implement-done #5", "  /implement-next 5\n\nZusatz"]) {
    assert.equal(umsetzungsStart(p), true, p);
  }
  // Kette, Kartenanlage, Pruefung und die Rettung einer Runde sind keine Umsetzungsstarts.
  for (const p of ["/techplan #5", "/issues #9", "/issue-review #9", "/fachplan #3", "/task", salvagePrompt("5", "", null), "", null, "/implement-nextx", "bitte /implement-next #5"]) {
    assert.equal(umsetzungsStart(p), false, String(p));
  }
});

// ============================================================
// Einheit des Ergebnisstands: ueber runSession im selben Prozess (Issue #1229)
// ============================================================
//
// Die Session ist eine Attrappe (`sessionAbh`), die ihren Strom abspielt und dabei die
// eingesetzte Uhr stellt — dieselbe Linie wie night-session-zeiten.test.mjs.

function schub(id, command) {
  return [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } }),
    { ms: 50 },
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } }),
  ];
}

/** Die Umsetzungsrunde, wie der Runner sie faehrt: Strom angefordert, Prompt /implement-next. */
function umsetzung(id, drehbuch) {
  const { abh } = sessionAbh(drehbuch);
  return runSession(id, ARGS, { stream: true, vordergrundCheck: true }, abh);
}

test("[night-1026] nach einer Umsetzungssession traegt die Einheit auskunft { ms, aufrufe } und umsetzung: true", async () => {
  await mitLauf(["7"], async ({ einheit, stand }) => {
    await umsetzung("7", [
      ...schub("a1", "node .claude/kit/board.mjs issue auftrag 1"),
      ...schub("a2", "git status --porcelain"),
    ]);

    const e = einheit("7");
    assert.equal(e.umsetzung, true, "der Runner startet /implement-next — das ist eine Umsetzung");
    assert.deepEqual(e.auskunft, { ms: 50, aufrufe: 1 }, "nur der Auftrag ist eine Auskunft, mit seiner Spanne");
    const keys = Object.keys(stand().einheiten[0]);
    assert.ok(keys.indexOf("auskunft") > keys.indexOf("ausgang"), `auskunft steht hinten: ${keys.join(", ")}`);
  });
});

test("[night-1026] eine beobachtete Session ohne Auskunftsaufruf traegt { ms: 0, aufrufe: 0 }", async () => {
  await mitLauf(["7"], async ({ einheit }) => {
    await umsetzung("7", [...schub("g1", "git status")]);
    assert.deepEqual(einheit("7").auskunft, { ms: 0, aufrufe: 0 }, "gemessen und keine Auskunft ist ein Befund, keine Luecke");
  });
});

test("[night-1026] eine Einheit ohne Session bleibt auskunft: null und ist keine Umsetzung", async () => {
  // Karte 8 bekommt keine Session (im Lauf etwa eine Idee, die das Gate zurueckweist); die
  // Session der Karte 7 daneben beruehrt ihre Einheit nicht.
  await mitLauf(["8", "7"], async ({ einheit }) => {
    await umsetzung("7", [...schub("a1", "node .claude/kit/board.mjs issue auftrag 7")]);
    assert.equal(einheit("8").auskunft, null, "nicht beobachtet heisst nicht gemessen, nie 0");
    assert.equal(einheit("8").umsetzung, false);
  });
});

test("[night-1026] eine Salvage-Session addiert ihre Auskunft, ohne die Einheit zur Umsetzung zu machen", async () => {
  await mitLauf(["7"], async ({ einheit }) => {
    const { abh } = sessionAbh([...schub("s1", "node .claude/kit/board.mjs issue get 7")]);
    await runSession("7", ARGS, { stream: true, prompt: salvagePrompt("7", "", null) }, abh);
    assert.deepEqual(einheit("7").auskunft, { ms: 50, aufrufe: 1 });
    assert.equal(einheit("7").umsetzung, false, "die Rettung einer Runde ist kein Umsetzungsstart");

    await umsetzung("7", [...schub("a1", "node .claude/kit/board.mjs issue auftrag 7")]);
    assert.deepEqual(einheit("7").auskunft, { ms: 100, aufrufe: 2 }, "zwei Sessions derselben Einheit addieren sich");
    assert.equal(einheit("7").umsetzung, true);
  });
});

test("[night-1026] eine Stufe ohne Strom liefert auskunft: null", async () => {
  const { abh, aufrufe } = sessionAbh(["fertig"]);
  const res = await runSession("1", { ...ARGS, timeoutMin: 1 }, {
    kommando: "stufen-programm", aufgabenstufe: "leicht", stufenName: "lokal", prompt: "/implement-next #1", stream: true,
  }, abh);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(aufrufe.length, 1, "die Stufe startete genau ein Programm");
  assert.equal(res.auskunft, null, "ohne Strom gibt es nichts zu messen — 0 hiesse gemessen, keine");
});
