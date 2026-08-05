// board.mjs setzt Kommandos ohne Shell ab (Issue #196, Live-Befund aus #195).
//
// Der gemeldete Windows-Fehler entstand, weil execSync ohne shell-Option unter
// Windows cmd.exe nimmt, waehrend das Quoting POSIX-Single-Quotes erzeugte. Die
// Antwort darauf ist nicht ein zweiter Quoting-Dialekt, sondern gar keiner: Die
// Argumente gehen als argv direkt ans Betriebssystem.
//
// Die Tests hier sichern beide Seiten dieser Entscheidung ab:
//
// 1. Strukturell — dass niemand versehentlich wieder eine Kommandozeile zusammensetzt.
//    Das ist kein Selbstzweck: Unter POSIX faellt ein Rueckfall nicht auf, der Schaden
//    zeigt sich erst auf einer Windows-Maschine, die hier niemand hat.
// 2. Verhalten — dass Sonderzeichen unveraendert als EIN Argument ankommen. Auf POSIX
//    war das auch vorher so (die Shell entfernte die Quotes wieder); unter Windows
//    zerfiel genau hier der mehrzeilige Body in sieben Argumente.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { setupProjekt, fakeCli, board, runBoard, aufrufe } from "./helpers/board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};


const BOARD_QUELLE = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "board.mjs");

// Ein Body, der jede Quoting-Variante zum Stolpern bringt: Zeilenumbrueche (der
// gemeldete Fall), ein Single Quote (POSIX-Escaping), ein Double Quote (cmd.exe),
// ein Dollarzeichen und ein Prozentzeichen (Variablen-Expansion in beiden Welten).
const HEIKLER_TEXT = [
  "## Kontext",
  "Zeile mit 'Single Quote' und \"Double Quote\".",
  "Sonderzeichen: $HOME %PATH% `backtick` & | > <",
  "",
  "## Abhaengigkeiten",
  "Keine.",
].join("\n");

// --- 1. Strukturell ---

// Kommentarzeilen raus, bevor geprueft wird: Die Begruendungen im Quelltext nennen die
// alten Konstrukte ausdruecklich ("frueher mit 2>/dev/null ..."), und diese Erklaerung
// ist der Sinn der Sache — der Test darf sie nicht verbieten. Die Heuristik (Zeilen, die
// mit // oder * beginnen) genuegt fuer diese Datei; sie kennt keine Block-Kommentare
// mitten in einer Codezeile, und solche gibt es hier nicht.
function ohneKommentare(quelltext) {
  return quelltext
    .split("\n")
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join("\n");
}

test("kit/board.mjs setzt keine Kommandozeilen-Strings mehr ab", () => {
  const quelle = ohneKommentare(readFileSync(BOARD_QUELLE, "utf-8"));

  assert.doesNotMatch(quelle, /\bshellQuote\b/,
    "shellQuote ist POSIX-only und muss ersatzlos entfallen sein");
  assert.doesNotMatch(quelle, /\bexecSync\s*\(/,
    "execSync fuehrt ueber eine Shell aus (cmd.exe unter Windows) — spawnSync mit Argument-Array verwenden");

  // Die Shell-Konstrukte der frueheren repo-name-Pfade: unter cmd.exe existiert
  // weder die Umleitung noch basename, und $(...) wird nicht ersetzt.
  for (const muster of [/2>\/dev\/null/, /\$\(pwd\)/, /\bbasename\s+\$/]) {
    assert.doesNotMatch(quelle, muster,
      `POSIX-Shell-Syntax ${muster} laeuft unter Windows nicht`);
  }
});

// Ohne Shell meldet das Betriebssystem ein fehlendes CLI als ENOENT statt mit
// "command not found" auf stderr. Die Meldung muss trotzdem sagen, was fehlt.
test("Ein nicht installiertes CLI wird als solches gemeldet", () => {
  const dir = setupProjekt({ codeHost: "github", issueTracker: "github" });
  try {
    // PATH auf ein Verzeichnis ohne gh — sonst greift ein echtes gh der Maschine.
    const res = runBoard(dir, ["issue", "get", "1"], { PATH: join(dir, "leer") });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /gh nicht gefunden — ist es installiert und im PATH\?/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 2. Verhalten: GitHub ---

test("GitHub: mehrzeiliger Body mit Sonderzeichen kommt als ein Argument an", NUR_POSIX, () => {
  const dir = setupProjekt({ codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } });
  try {
    fakeCli(dir, "gh", [
      { match: "^repo view", stdout: "besitzer/mein-repo\n" },
      { match: "^issue create", stdout: "https://github.com/besitzer/mein-repo/issues/42\n" },
      { match: "^project item-add", stdout: "" },
      { match: "^project item-list", stdout: JSON.stringify({ items: [] }) },
      { match: "^project field-list", stdout: JSON.stringify({ fields: [] }) },
      { match: "", stdout: "{}" },
    ]);

    board(dir, "issue", "create", "--title", "Titel mit 'Quote'", "--body", HEIKLER_TEXT);

    const create = aufrufe(dir, "gh").find((argv) => argv[0] === "issue" && argv[1] === "create");
    assert.ok(create, "kein issue-create-Aufruf protokolliert");

    // Der Kern: Body und Titel stehen als je EIN argv-Element, byte-genau wie uebergeben.
    const body = create[create.indexOf("--body") + 1];
    assert.equal(body, HEIKLER_TEXT,
      "der Body muss unveraendert als ein Argument ankommen (ohne Quotes, ohne Escapes)");
    assert.equal(create[create.indexOf("--title") + 1], "Titel mit 'Quote'");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GitHub: Kommentartext mit Sonderzeichen kommt als ein Argument an", NUR_POSIX, () => {
  const dir = setupProjekt({ codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } });
  try {
    fakeCli(dir, "gh", [
      { match: "^repo view", stdout: "besitzer/mein-repo\n" },
      { match: "", stdout: "" },
    ]);

    board(dir, "issue", "comment", "42", "--text", HEIKLER_TEXT);

    const kommentar = aufrufe(dir, "gh").find((argv) => argv[0] === "issue" && argv[1] === "comment");
    assert.equal(kommentar[kommentar.indexOf("--body") + 1], HEIKLER_TEXT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 2. Verhalten: GitLab (der Tracker des Melders aus #195) ---

test("GitLab: mehrzeiliger Body mit Sonderzeichen kommt als ein Argument an", NUR_POSIX, () => {
  const dir = setupProjekt({ codeHost: "gitlab", issueTracker: "gitlab" });
  try {
    fakeCli(dir, "glab", [
      { match: "^issue create", stdout: "https://gitlab.com/besitzer/mein-repo/-/issues/42\n" },
      { match: "", stdout: "" },
    ]);

    board(dir, "issue", "create", "--title", "Titel mit 'Quote'", "--body", HEIKLER_TEXT);

    const create = aufrufe(dir, "glab").find((argv) => argv[0] === "issue" && argv[1] === "create");
    assert.ok(create, "kein issue-create-Aufruf protokolliert");
    assert.equal(create[create.indexOf("--description") + 1], HEIKLER_TEXT);
    assert.equal(create[create.indexOf("--title") + 1], "Titel mit 'Quote'");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GitLab: Kommentartext mit Sonderzeichen kommt als ein Argument an", NUR_POSIX, () => {
  const dir = setupProjekt({ codeHost: "gitlab", issueTracker: "gitlab" });
  try {
    fakeCli(dir, "glab", [{ match: "", stdout: "" }]);

    board(dir, "issue", "comment", "42", "--text", HEIKLER_TEXT);

    const note = aufrufe(dir, "glab").find((argv) => argv[0] === "issue" && argv[1] === "note");
    assert.equal(note[note.indexOf("--message") + 1], HEIKLER_TEXT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
