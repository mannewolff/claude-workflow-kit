// Der Nacht-Runner scheitert an grossen Board-Ausgaben ueber 1 MB (Issue #699).
//
// `board()` und `boardRoh()` starteten `board.mjs` per spawnSync ohne `maxBuffer` —
// Node puffert dann hoechstens 1 MB, beendet den Kindprozess mit SIGTERM und die
// Fehlermeldung traegt die komplette bis dahin gelesene Ausgabe statt eines Befunds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { boardFehlertext } from "../kit/night.mjs";
import { NUR_POSIX, run, mitProjekt } from "./helpers/kette-fixture.mjs";

/** Ersetzt die Kit-Kopie von board.mjs im Fixture durch ein eigenes Skript und committet es. */
function fakeBoardInstallieren(dir, script) {
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), script);
  for (const a of [["add", "-A"], ["commit", "-q", "-m", "board-fake"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
}

/** Antwortet auf `issue list` mit einer gueltigen, ueber 1,5 MB grossen JSON-Liste ohne kit:night. */
const GROSSE_LISTE_FAKE = [
  "const args = process.argv.slice(2);",
  'if (args[0] === "issue" && args[1] === "list") {',
  "  const karten = [];",
  "  let groesse = 0;",
  "  let n = 0;",
  "  while (groesse < 1600000) {",
  '    const karte = { id: String(n + 1), title: "Karte " + (n + 1), body: "x".repeat(2000), status: "backlog", labels: [] };',
  "    karten.push(karte);",
  "    groesse += JSON.stringify(karte).length;",
  "    n++;",
  "  }",
  "  process.stdout.write(JSON.stringify(karten));",
  "} else {",
  String.raw`  process.stderr.write("Fake deckt nur issue list\n");`,
  "  process.exitCode = 1;",
  "}",
  "",
].join("\n");

/** Scheitert an `issue list`: Exit 1, kein stderr, 1,6 MB auf stdout. */
const FEHLSCHLAG_FAKE = [
  "const args = process.argv.slice(2);",
  'if (args[0] === "issue" && args[1] === "list") {',
  '  process.stdout.write("x".repeat(1600000));',
  "  process.exitCode = 1;",
  "} else {",
  String.raw`  process.stderr.write("Fake deckt nur issue list\n");`,
  "  process.exitCode = 1;",
  "}",
  "",
].join("\n");

test("[night-32] issue list ueber 1,5 MB bricht die Kette im Dry-Run nicht am Puffer ab", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fakeBoardInstallieren(dir, GROSSE_LISTE_FAKE);
    const res = run(dir, ["--kette", "--dry-run"]);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /keine Karte traegt das Label/);
  });
});

test("[night-32] scheitert board.mjs mit grosser Ausgabe, bleibt die Fehlermeldung kurz", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fakeBoardInstallieren(dir, FEHLSCHLAG_FAKE);
    const res = run(dir, ["--kette", "--dry-run"]);
    assert.equal(res.status, 1);
    assert.ok(res.stderr.length < 2000, `stderr zu lang: ${res.stderr.length} Zeichen`);
    assert.match(res.stderr, /Fehler: board\.mjs issue list schlug fehl/);
  });
});

test("[night-32] boardFehlertext nennt Fehlercode, Signal und kuerzt eine grosse Ausgabe", () => {
  const mitCode = boardFehlertext(["issue", "list"], { error: { code: "ENOBUFS" }, stdout: "", stderr: "" });
  assert.match(mitCode, /ENOBUFS/);

  const mitSignal = boardFehlertext(["issue", "list"], { signal: "SIGTERM", stdout: "", stderr: "" });
  assert.match(mitSignal, /SIGTERM/);

  const grosserText = "y".repeat(1_500_000);
  const gekuerzt = boardFehlertext(["issue", "list"], { stdout: grosserText, stderr: "" });
  assert.ok(gekuerzt.length < 1000, `Text zu lang: ${gekuerzt.length} Zeichen`);
  assert.match(gekuerzt, /… \(1499500 Zeichen gekürzt\)/);
});
