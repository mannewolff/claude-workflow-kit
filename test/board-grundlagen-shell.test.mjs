// Die Shell des Board-Werkzeugs setzt Kommandos ohne Shell ab (Issue #196, Live-Befund
// aus #195), belegt im selben Prozess (Issue #1211, Plan #1199, E6).
//
// Bis Issue #1211 standen diese Faelle in `board-shellfrei.test.mjs` und liefen ueber
// den Einstieg des Board-Werkzeugs als Kindprozess gegen ein gefaelschtes `gh` im PATH. Was dort belegt
// wurde — die Argumente kommen als argv an, ein fehlendes CLI wird beim Namen genannt —,
// ist eine Eigenschaft von `exec` und laesst sich an der Funktion selbst zeigen: Der
// Start wird als `spawn` injiziert, und die Attrappe haelt fest, womit er gerufen wurde.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { exec, execJSON } from "../kit/board/grundlagen.mjs";

const GRUNDLAGEN = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "board", "grundlagen.mjs");

// Ein Text, der jede Quoting-Variante zum Stolpern bringt: Zeilenumbrueche (der
// gemeldete Fall), ein Single Quote (POSIX-Escaping), ein Double Quote (cmd.exe),
// ein Dollarzeichen und ein Prozentzeichen (Variablen-Expansion in beiden Welten).
const HEIKLER_TEXT = [
  "## Kontext",
  "Zeile mit 'Single Quote' und \"Double Quote\".",
  "Sonderzeichen: $HOME %PATH% `backtick` & | > <",
].join("\n");

/** Eine Attrappe fuer spawnSync: liefert `antwort` und merkt sich jeden Aufruf. */
function spawnAttrappe(antwort = { status: 0, stdout: "", stderr: "" }) {
  const aufrufe = [];
  const spawn = (befehl, args, optionen) => {
    aufrufe.push({ befehl, args, optionen });
    return antwort;
  };
  return { spawn, aufrufe };
}

const POSIX = { plattform: "linux", env: { PATH: "/usr/bin" } };

test("exec reicht jedes Argument byte-genau als eigenes argv-Element weiter, ohne Shell", () => {
  const { spawn, aufrufe } = spawnAttrappe({ status: 0, stdout: "ok\n", stderr: "" });

  const ergebnis = exec("gh", ["issue", "create", "--title", "Titel mit 'Quote'", "--body", HEIKLER_TEXT], { spawn, ...POSIX });

  assert.equal(ergebnis, "ok");
  assert.equal(aufrufe.length, 1);
  const { befehl, args, optionen } = aufrufe[0];
  assert.equal(befehl, "gh");
  assert.deepEqual(args, ["issue", "create", "--title", "Titel mit 'Quote'", "--body", HEIKLER_TEXT],
    "der Body muss unveraendert als ein Argument ankommen (ohne Quotes, ohne Escapes)");
  assert.equal(optionen.shell, undefined, "exec darf die Shell-Option von spawn nie setzen");
  assert.equal(optionen.env.PATH, "/usr/bin", "die Umgebung des Aufrufs geht an den Start");
});

test("exec nennt ein nicht installiertes CLI beim Namen", () => {
  // Ohne Shell meldet das Betriebssystem ein fehlendes CLI als ENOENT statt mit
  // "command not found" auf stderr. Die Meldung muss trotzdem sagen, was fehlt.
  const { spawn } = spawnAttrappe({ error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }) });
  assert.throws(() => exec("gh", ["issue", "get", "1"], { spawn, ...POSIX }),
    /gh nicht gefunden — ist es installiert und im PATH\?/);
});

test("exec reicht einen anderen Startfehler mit seiner eigenen Meldung durch", () => {
  const { spawn } = spawnAttrappe({ error: Object.assign(new Error("spawn gh EACCES"), { code: "EACCES" }) });
  assert.throws(() => exec("gh", [], { spawn, ...POSIX }), /spawn gh EACCES/);
});

test("exec wirft bei Exit ungleich 0 mit stderr, sonst stdout, sonst dem Exitcode", () => {
  const mit = (antwort) => () => exec("glab", ["issue", "note"], { spawn: spawnAttrappe(antwort).spawn, ...POSIX });
  assert.throws(mit({ status: 1, stdout: "aus stdout", stderr: "  aus stderr\n" }), /^Error: aus stderr$/);
  assert.throws(mit({ status: 1, stdout: "aus stdout\n", stderr: "" }), /^Error: aus stdout$/);
  assert.throws(mit({ status: 3, stdout: "", stderr: "" }), /glab endete mit Exit 3/);
});

test("execJSON liest die Ausgabe als JSON", () => {
  const { spawn } = spawnAttrappe({ status: 0, stdout: '{"id": 42}\n', stderr: "" });
  assert.deepEqual(execJSON("gh", ["issue", "view"], { spawn, ...POSIX }), { id: 42 });
});

test("unter Windows startet ein .cmd-CLI ueber seine sh-Huelle in der Git Bash", () => {
  // Die Startregel aus Issue #1135 (Plan #1128, E8) gilt auch fuer exec: kein cmd.exe.
  const vorhanden = new Set([
    String.raw`C:\npm\gh.CMD`,
    String.raw`C:\npm\gh`,
    String.raw`C:\Git\bin\bash.exe`,
  ]);
  const env = { PATH: String.raw`C:\npm`, PATHEXT: ".EXE;.CMD", CLAUDE_CODE_GIT_BASH_PATH: String.raw`C:\Git\bin\bash.exe` };
  const { spawn, aufrufe } = spawnAttrappe();

  exec("gh", ["issue", "list"], { spawn, env, plattform: "win32", existiert: (p) => vorhanden.has(p) });

  assert.equal(aufrufe[0].befehl, String.raw`C:\Git\bin\bash.exe`);
  assert.equal(aufrufe[0].optionen.env.MSYS_NO_PATHCONV, "1", "die Umgebung der Git Bash fehlt");
  assert.equal(aufrufe[0].optionen.shell, undefined);
});

test("exec meldet ein unter Windows nicht startbares CLI, ohne zu starten", () => {
  const { spawn, aufrufe } = spawnAttrappe();
  const vorhanden = new Set([String.raw`C:\npm\gh.CMD`]);
  assert.throws(
    () => exec("gh", [], { spawn, env: { PATH: String.raw`C:\npm`, PATHEXT: ".CMD" }, plattform: "win32", existiert: (p) => vorhanden.has(p) }),
    /ohne sh-Huelle daneben/,
  );
  assert.equal(aufrufe.length, 0);
});

// Kommentarzeilen raus, bevor geprueft wird: Die Begruendungen im Quelltext nennen die
// alten Konstrukte ausdruecklich ("frueher mit 2>/dev/null ..."), und diese Erklaerung
// ist der Sinn der Sache — der Test darf sie nicht verbieten.
function ohneKommentare(quelltext) {
  return quelltext
    .split("\n")
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join("\n");
}

test("die Grundlagen setzen keine Kommandozeilen-Strings ab", () => {
  const quelle = ohneKommentare(readFileSync(GRUNDLAGEN, "utf-8"));
  assert.doesNotMatch(quelle, /\bshellQuote\b/, "shellQuote ist POSIX-only und muss ersatzlos entfallen sein");
  assert.doesNotMatch(quelle, /\bexecSync\s*\(/,
    "execSync fuehrt ueber eine Shell aus (cmd.exe unter Windows) — spawnSync mit Argument-Array verwenden");
  for (const muster of [/2>\/dev\/null/, /\$\(pwd\)/, /\bbasename\s+\$/]) {
    assert.doesNotMatch(quelle, muster, `POSIX-Shell-Syntax ${muster} laeuft unter Windows nicht`);
  }
});
