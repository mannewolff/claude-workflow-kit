// Tests fuer Text aus Datei und stdin (Issue #270).
//
// `issue comment --text "..."` und `issue update --body "..."` nahmen den Text nur
// als Kommandozeilen-Argument. Sessions, die lange Befunde ans Board bringen
// muessen — /issue-review schreibt sie vor —, bauten sich daraufhin Hilfsskripte,
// die in keiner Allowlist stehen: headless enden sie ohne Board-Spur. Zusaetzlich
// hinterliessen ihre Arbeitsdateien einen unsauberen Working Tree, auf den der
// Nacht-Runner hart stoppt.
//
// Belegt am 2026-08-08 in zwei Projekten: redundancy-detector #2-#9 blieben ohne
// Ergebnis, und im Kit selbst brauchten drei Review-Kommentare (12-14k Zeichen)
// je ein selbstgebautes Script.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync as liesDatei } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { setupProjekt, runBoard, board, BOARD } from "./helpers/board-fixture.mjs";

const CONFIG = { issueTracker: "local", codeHost: "local", local: { issuesDir: "issues" } };

/** Fixture mit einem angelegten Issue — Rueckgabe: [dir, id]. */
function mitIssue() {
  const dir = setupProjekt(CONFIG, "textquelle-");
  const { id } = board(dir, "issue", "create", "--title", "Ziel", "--body", "Autor-Modell: m\nStart.");
  return [dir, String(id)];
}

/** Wie runBoard, aber mit Text auf stdin. */
function runMitStdin(dir, cliArgs, eingabe) {
  return spawnSync(process.execPath, [BOARD, ...cliArgs], {
    cwd: dir,
    encoding: "utf-8",
    input: eingabe,
    env: { ...process.env, KIT_ROOT: dir, KIT_AGENT_MODEL: "fixture-modell" },
  });
}

// Genau die Zeichen, an denen das Quoting durch eine Kommandozeile scheitert.
const HEIKEL = [
  "## Issue-Review, Runde 1",
  "Zeile mit 'Single' und \"Double\" Quote.",
  "Sonderzeichen: $HOME %PATH% `backtick` & | > < \\",
  "",
  "Letzte Zeile.",
].join("\n");

test("issue comment --text-file setzt den Dateiinhalt bytegenau", () => {
  const [dir, id] = mitIssue();
  const datei = join(dir, "befunde.txt");
  writeFileSync(datei, HEIKEL);
  const res = runBoard(dir, ["issue", "comment", id, "--text-file", datei]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(board(dir, "issue", "get", id).body, /Sonderzeichen: \$HOME %PATH% `backtick` & \| > < \\/);
});

test("issue comment --text - liest von stdin", () => {
  const [dir, id] = mitIssue();
  const res = runMitStdin(dir, ["issue", "comment", id, "--text", "-"], HEIKEL);
  assert.equal(res.status, 0, res.stderr);
  assert.match(board(dir, "issue", "get", id).body, /Letzte Zeile\./);
});

test("issue update --body-file und --body - schreiben den Body", () => {
  const [dirA, idA] = mitIssue();
  const datei = join(dirA, "neu.md");
  writeFileSync(datei, "Autor-Modell: m\nGeschaerfter Body.");
  assert.equal(runBoard(dirA, ["issue", "update", idA, "--body-file", datei]).status, 0);
  assert.match(board(dirA, "issue", "get", idA).body, /Geschaerfter Body\./);

  const [dirB, idB] = mitIssue();
  const res = runMitStdin(dirB, ["issue", "update", idB, "--body", "-"], "Autor-Modell: m\nAus stdin.");
  assert.equal(res.status, 0, res.stderr);
  assert.match(board(dirB, "issue", "get", idB).body, /Aus stdin\./);
});

test("zwei Quellen gleichzeitig sind ein Fehler, kein Vorrang", () => {
  const [dir, id] = mitIssue();
  const datei = join(dir, "t.txt");
  writeFileSync(datei, "aus der Datei");
  const kommentar = runBoard(dir, ["issue", "comment", id, "--text", "als Argument", "--text-file", datei]);
  assert.notEqual(kommentar.status, 0, "der Widerspruch haette auffallen muessen");
  const update = runBoard(dir, ["issue", "update", id, "--body", "als Argument", "--body-file", datei]);
  assert.notEqual(update.status, 0);
  // Nichts geschrieben.
  assert.doesNotMatch(board(dir, "issue", "get", id).body, /als Argument|aus der Datei/);
});

test("leere Datei und leerer stdin werden abgelehnt", () => {
  const [dir, id] = mitIssue();
  const leer = join(dir, "leer.txt");
  writeFileSync(leer, "   \n");
  assert.notEqual(runBoard(dir, ["issue", "comment", id, "--text-file", leer]).status, 0);
  assert.notEqual(runBoard(dir, ["issue", "update", id, "--body-file", leer]).status, 0);
  assert.notEqual(runMitStdin(dir, ["issue", "comment", id, "--text", "-"], "").status, 0);
});

test("fehlende Datei nennt den Pfad in der Meldung", () => {
  const [dir, id] = mitIssue();
  const res = runBoard(dir, ["issue", "comment", id, "--text-file", join(dir, "gibtsnicht.txt")]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /gibtsnicht\.txt/);
});

test("ein Text jenseits der Kommandozeilenlaenge geht durch", () => {
  // 200k Zeichen: als Argument waere das am Limit (ARG_MAX), ueber Datei und stdin
  // ist es unauffaellig. Genau der Fall, fuer den dieses Issue existiert.
  const [dir, id] = mitIssue();
  const lang = "x".repeat(200_000);
  const datei = join(dir, "lang.txt");
  writeFileSync(datei, lang);
  assert.equal(runBoard(dir, ["issue", "comment", id, "--text-file", datei]).status, 0);
  assert.ok(board(dir, "issue", "get", id).body.includes("x".repeat(1000)));

  const [dir2, id2] = mitIssue();
  assert.equal(runMitStdin(dir2, ["issue", "comment", id2, "--text", "-"], lang).status, 0);
});

test("--text ohne Wert bleibt ein Fehler", () => {
  // parseArgs macht aus einem Flag ohne Wert `true` — das darf nicht als Text gelten.
  const [dir, id] = mitIssue();
  assert.notEqual(runBoard(dir, ["issue", "comment", id, "--text"]).status, 0);
});

// --- Die Skills muessen den neuen Weg zeigen ---
//
// Solange ein Skill `--text "..."` vormacht, baut die naechste Session wieder ein
// Hilfsskript, sobald der Text nicht mehr durch eine Kommandozeile passt.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = (name) => liesDatei(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");

test("die Skills zeigen den stdin-Weg, nicht mehr --text als Argument", () => {
  for (const name of ["issue-review", "review", "implement-ready", "implement-next"]) {
    const text = skill(name);
    assert.doesNotMatch(text, /issue comment <[^>]*> --text "/,
      `${name}: zeigt noch den Argument-Weg`);
    assert.match(text, /--text -/, `${name}: zeigt den stdin-Weg nicht`);
  }
});

test("issue-review nennt den Grund und die Datei-Regel", () => {
  const text = skill("issue-review");
  assert.match(text, /ueber stdin, nicht als Argument|über stdin, nicht als Argument/);
  assert.match(text, /ausserhalb des Projektverzeichnisses|außerhalb des Projektverzeichnisses/,
    "der Hinweis auf den unsauberen Working Tree fehlt");
});

test("im Heredoc-Beispiel stehen keine Backslash-Escapes mehr", () => {
  // Im Argument-Weg brauchte das Beispiel \" — im Heredoc landet der Backslash
  // woertlich im Board-Kommentar.
  const text = skill("issue-review");
  const block = text.slice(text.indexOf("## Synthese, Runde 1"), text.indexOf("SYNTHESE", text.indexOf("## Synthese, Runde 1")));
  assert.doesNotMatch(block, /\\"/, "Escape aus der Argument-Zeit im Heredoc-Beispiel");
});
