// Die verbleibenden erreichbaren Verzweigungen in kit/board.mjs (Issue #502).
//
// Was hier steht, sind Wege, die im Betrieb selten sind und im Test einen Aufbau
// brauchen, den kein anderer Test schon mitbringt: ein git ohne Remote-Antwort, ein
// fremder Prozess, der die Cache-Datei loescht, ein Code-Fence im Kontext-Abschnitt,
// eine stdin, aus der sich nicht lesen laesst, eine Datei im PATH, die zwar das
// X-Bit traegt aber kein startbares Programm ist, und ein Prozess, dessen argv[1]
// nicht aufloesbar ist.
//
// Alle Tracker-Wege laufen ueber die Helfer aus board-fixture.mjs; kein Test spricht
// mit einer echten Instanz.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync, openSync, closeSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { setupProjekt, fakeCli, runBoard, board, aufrufZeilen, BOARD } from "./helpers/board-fixture.mjs";
import { pruefvorgabeDurchsetzen } from "../kit/board.mjs";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Die Fakes sind endungslose Dateien mit sh-Wrapper; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197." }
  : {};

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };

const OPTIONEN = [
  { id: "opt-backlog", name: "Backlog" },
  { id: "opt-ready", name: "Ready" },
  { id: "opt-progress", name: "In progress" },
  { id: "opt-review", name: "In review" },
  { id: "opt-done", name: "Done" },
];

function mitProjekt(fn, config = LOKAL, praefix = "board-offen-") {
  const dir = setupProjekt(config, praefix);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// gitRemoteUrl: ein git, das mit Erfolg nichts sagt
// ============================================================

// `git remote get-url origin` endet mit Exit 0 und leerer Ausgabe, wenn der Remote
// zwar eingetragen ist, aber keine URL traegt (halb geschriebene .git/config, ein
// Remote ohne url-Zeile). exec() liefert dafuer den leeren String, nicht null —
// gitRemoteUrl macht daraus null, damit dahinter nur noch ein Fall zu behandeln ist.
test("code repo-name: ein leerer Remote faellt auf den Verzeichnisnamen zurueck", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fakeCli(dir, "git", [{ match: "^remote get-url origin", stdout: "" }]);

    const res = runBoard(dir, ["code", "repo-name"]);

    assert.equal(res.status, 0, `repo-name haette durchlaufen muessen: ${res.stderr}`);
    assert.equal(JSON.parse(res.stdout).repoName, basename(dir),
      "aus der leeren Remote-Antwort wurde ein leerer Projektname statt des Verzeichnisnamens");
    assert.deepEqual(aufrufZeilen(dir, "git"), ["remote get-url origin"],
      "der Adapter hat git nicht oder anders befragt");
  });
});

// ============================================================
// _invalidateMetaCache: die Cache-Datei ist waehrend des Laufs verschwunden
// ============================================================

// Das Gegenstueck zum zerschossenen Cache aus board-github.test.mjs: Ein paralleler
// Lauf kann die Datei auch ganz entfernen. Das Verwerfen des Caches findet dann
// nichts mehr vor — und muss trotzdem durchlaufen, sonst kippt ein fremder Prozess
// den move.
test("move ueberlebt einen Cache, den ein fremder Prozess mittendrin loescht", NUR_POSIX, () => {
  const dir = setupProjekt(GITHUB, "board-offen-cache-");
  fakeCli(dir, "gh", [
    {
      match: "^project item-edit",
      stderr: "could not find option\n",
      exit: 1,
      times: 1,
      loescht: ".claude/board-meta-cache.json",
    },
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^project list", stdout: { projects: [{ number: 14, title: "Mein Board", id: "PVT_1" }] } },
    { match: "^project field-list", stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: OPTIONEN }] } },
    {
      match: "^api graphql",
      stdout: {
        data: {
          repository: {
            issue: { projectItems: { nodes: [{ id: "ITEM_1", project: { number: 14, owner: { login: "besitzer" } } }] } },
          },
        },
      },
    },
    { match: "^project item-edit", stdout: "" },
  ]);
  try {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);

    assert.equal(res.status, 0, `der move haette durchlaufen muessen: ${res.stderr}`);
    const cache = join(dir, ".claude", "board-meta-cache.json");
    assert.ok(existsSync(cache), "der geloeschte Cache wurde nicht neu geschrieben");
    assert.equal(JSON.parse(readFileSync(cache, "utf-8"))["besitzer#14"].projectId, "PVT_1",
      "der neu geschriebene Cache traegt nicht die frisch geladene Project-ID");
    assert.ok(aufrufZeilen(dir, "gh").some((z) => z.includes("--single-select-option-id opt-ready")),
      "der Wiederholungsversuch hat den Status nicht gesetzt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// mitPruefstand: ein Code-Fence im Kontext-Abschnitt
// ============================================================

// Ein Issue, das das Format an einem Beispiel zeigt, traegt `Pruefung:` im Fence.
// Der Stand gehoert hinter die ECHTE Vorgabezeile — hinter die im Beispiel gesetzt
// veraenderte er den Beispieltext des Dokuments.
test("der Pruefstand wird hinter der echten Vorgabe gesetzt, nicht im Code-Fence", () => {
  const alt = "## Kontext\n\nPruefung: 2\n\n## Aufgabe\n\nAlt.\n";
  const neu = [
    "## Kontext",
    "",
    "Pruefung: 2",
    "",
    "```",
    "Pruefung: 3",
    "```",
    "",
    "## Aufgabe",
    "",
    "Neu.",
    "",
  ].join("\n");

  const ergebnis = pruefvorgabeDurchsetzen(alt, neu, {});

  assert.match(ergebnis, /^Pruefung: 2\nPruefung-Stand: [0-9a-f]{64}$/m,
    "hinter der echten Vorgabezeile steht kein Stand");
  assert.match(ergebnis, /```\nPruefung: 3\n```/,
    "die Beispielzeile im Fence hat einen Stand bekommen oder wurde veraendert");
  assert.equal((ergebnis.match(/^Pruefung-Stand:/gm) || []).length, 1,
    "es steht mehr als ein Pruefstand im Body");
});

// ============================================================
// issue activity ohne id
// ============================================================

test("issue activity ohne id nennt die Aufrufform", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "activity"]);

    assert.equal(res.status, 1, "ein Aufruf ohne id haette scheitern muessen");
    assert.equal(res.stdout, "", "stdout muss bei einem Abbruch leer bleiben");
    assert.match(res.stderr, /board\.mjs issue activity <id>/,
      "die Meldung nennt die Aufrufform nicht");
  });
});

// ============================================================
// leseTextQuelle: eine stdin, aus der sich nicht lesen laesst
// ============================================================

// `--text -` liest fd 0. Zeigt der auf eine nur zum Schreiben geoeffnete Datei,
// scheitert das Lesen mit EBADF. Das ist der einzige Weg, auf dem die stdin-Quelle
// nicht leer, sondern kaputt ist — und er darf nicht als "Text fehlt" durchgehen,
// sonst sucht der Aufrufer den Fehler in seinem Aufruf statt in seiner Umgebung.
test("issue comment --text -: eine nicht lesbare stdin wird als solche gemeldet", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const nurSchreiben = openSync(join(dir, "nur-schreiben.txt"), "w");
    try {
      const res = runBoard(dir, ["issue", "comment", String(issue.id), "--text", "-"], {},
        { stdio: [nurSchreiben, "pipe", "pipe"] });

      assert.equal(res.status, 1, "eine kaputte stdin haette scheitern muessen");
      assert.match(res.stderr, /--text -: stdin ist nicht lesbar \(EBADF\)/,
        `die Meldung nennt weder die Quelle noch den Fehlercode: ${res.stderr}`);
      assert.doesNotMatch(res.stderr, /darf nicht leer sein/,
        "der Fehler wurde als leerer Text gemeldet statt als nicht lesbare stdin");
    } finally {
      closeSync(nurSchreiben);
    }
  });
});

// ============================================================
// probelauf: eine ausfuehrbare Datei, die kein Programm ist
// ============================================================

// Die PATH-Suche prueft Existenz und X-Bit — mehr kann sie nicht. Eine Datei mit
// gesetztem X-Bit ohne Shebang und ohne Binaerformat besteht diese Pruefung und
// scheitert erst beim Start. Wie sie scheitert, haengt an der Plattform (Issue #527):
// Auf macOS meldet spawnSync ENOEXEC — kein Exit-Status, kein Signal, nur ein Fehler.
// Auf Linux faellt execvp bei ENOEXEC historisch auf /bin/sh zurueck; die Shell liest
// die Datei als Skript und beendet mit Status 127, der Fehler kommt bei Node nie an.
// Gemeinsam ist beiden Wegen nur, was der Vorflug daraus macht: eine Begruendung, die
// den Startfehler nennt statt "Durch Signal null beendet".
test("check: eine ausfuehrbare Datei ohne Programmformat meldet ihren Startfehler", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const binDir = join(dir, "fakebin");
    mkdirSync(binDir, { recursive: true });
    const pfad = join(binDir, "kein-programm");
    writeFileSync(pfad, "\x00\x01kein startbares Programm\n");
    chmodSync(pfad, 0o755);

    const res = runBoard(dir, ["issue-review", "check"]);

    assert.equal(res.status, 0, `check bleibt eine Auskunft, kein Gate: ${res.stderr}`);
    const befund = JSON.parse(res.stdout).reviewers[0];
    assert.equal(befund.verfuegbar, false, "ein nicht startbares Programm darf nicht als verfuegbar gelten");
    assert.equal(befund.geprueft, "probelauf",
      "die PATH-Pruefung haette die Datei finden muessen — der Befund kommt aus dem Probelauf");
    // Auf Linux sind beide Formen moeglich: `not found` ist die letzte stderr-Zeile
    // von /bin/sh, `Exit 127` der Rueckfall aus probelauf, wenn stderr leer bleibt.
    const erwartet = process.platform === "darwin" ? /ENOEXEC/ : /not found|Exit 127/;
    assert.match(befund.grund, erwartet,
      `der Startfehler fehlt in der Begruendung: ${befund.grund}`);
    assert.doesNotMatch(befund.grund, /Signal/,
      "der Fall ist als Signal-Tod gemeldet worden, obwohl ein Fehler vorlag");
  }, {
    ...LOKAL,
    issueReview: { rounds: 1, reviewers: [{ name: "kaputt", kind: "command", command: "kein-programm --flag" }] },
  }, "board-offen-enoexec-");
});

// Der Zweig `if (res.error)` in probelauf braucht einen Fall ohne Exit-Status, und
// der Test darueber liefert ihn nur auf macOS (Issue #527): Auf Linux uebernimmt
// /bin/sh die formatlose Datei und erzeugt einen Status. Der sh-Rueckfall von execvp
// gilt aber allein fuer ENOEXEC — ein Shebang auf einen Interpreter, den es nicht
// gibt, scheitert mit ENOENT, und dagegen faengt keine Shell auf. Das ist der Fall,
// der auf beiden Plattformen ohne Status und mit Fehler endet.
test("check: ein Shebang auf einen fehlenden Interpreter meldet den Startfehler", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const binDir = join(dir, "fakebin");
    mkdirSync(binDir, { recursive: true });
    const pfad = join(binDir, "kein-interpreter");
    writeFileSync(pfad, "#!/nicht/vorhanden/interpreter\necho hi\n");
    chmodSync(pfad, 0o755);

    const res = runBoard(dir, ["issue-review", "check"]);

    assert.equal(res.status, 0, `check bleibt eine Auskunft, kein Gate: ${res.stderr}`);
    const befund = JSON.parse(res.stdout).reviewers[0];
    assert.equal(befund.verfuegbar, false, "ein nicht startbares Programm darf nicht als verfuegbar gelten");
    assert.equal(befund.geprueft, "probelauf",
      "die PATH-Pruefung haette die Datei finden muessen — der Befund kommt aus dem Probelauf");
    assert.match(befund.grund, /ENOENT/,
      `der Startfehler fehlt in der Begruendung: ${befund.grund}`);
    assert.doesNotMatch(befund.grund, /Signal/,
      "der Fall ist als Signal-Tod gemeldet worden, obwohl ein Fehler vorlag");
  }, {
    ...LOKAL,
    issueReview: { rounds: 1, reviewers: [{ name: "kaputt", kind: "command", command: "kein-interpreter --flag" }] },
  }, "board-offen-enoent-");
});

// ============================================================
// CLI-Erkennung: ein argv[1], das sich nicht aufloesen laesst
// ============================================================

// board.mjs entscheidet am Vergleich von realpath(argv[1]) mit dem eigenen Modulpfad,
// ob es als CLI laeuft. Ein argv[1], das es nicht (mehr) gibt, laesst realpathSync
// werfen — ohne den catch waere jeder Import der Datei aus einem solchen Prozess ein
// Absturz, statt schlicht "kein CLI-Start".
test("ein unaufloesbares argv[1] laesst den Import durch, ohne die CLI zu starten", () => {
  const dir = mkdtempSync(join(tmpdir(), "board-offen-argv-"));
  try {
    const wrapper = join(dir, "wrapper.mjs");
    writeFileSync(wrapper, [
      // Ein Pfad, den es nicht gibt: realpathSync wirft ENOENT.
      `process.argv[1] = ${JSON.stringify(join(dir, "gibt-es-nicht.mjs"))};`,
      `await import(${JSON.stringify(pathToFileURL(BOARD).href)});`,
      String.raw`process.stdout.write("import-durch\n");`,
      "",
    ].join("\n"), "utf-8");

    const res = spawnSync(process.execPath, [wrapper], { cwd: dir, encoding: "utf-8" });

    assert.equal(res.status, 0, `der Import haette durchlaufen muessen: ${res.stderr}`);
    assert.equal(res.stdout, "import-durch\n",
      "board.mjs hat beim Import Ausgaben erzeugt — die CLI ist gestartet");
    assert.equal(res.stderr, "", `board.mjs hat beim Import auf stderr geschrieben: ${res.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
