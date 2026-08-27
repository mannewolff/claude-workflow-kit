// Labels schreiben: `issue label add|remove <id> <name>` (Issue #249).
//
// Bisher konnten die Adapter Labels nur LESEN (issue.labels). Ohne Schreibpfad gibt
// es keine Zeichnung eines Issues durch die Maschine — und damit kein Liegenbleiben
// eines Falls, den sie nicht aufloesen kann.
//
// Aufbau wie board-github/board-gitlab: gh und glab sind Fake-Binaries im PATH, der
// lokale Tracker arbeitet echt auf Dateien. Geprueft wird die tatsaechlich abgesetzte
// Kommandozeile — bei local der Dateiinhalt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, fakeCli, runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};

const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };
const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };
const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const TOOLBOX = { codeHost: "github", issueTracker: "toolbox", toolbox: { host: "http://127.0.0.1:1" } };

function mitFake(config, praefix, cli, regeln, fn) {
  const dir = setupProjekt(config, praefix);
  fakeCli(dir, cli, regeln);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mitGitHub(fn, regeln = []) {
  return mitFake(GITHUB, "board-label-gh-", "gh", [
    ...regeln,
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^issue edit", stdout: "" },
  ], fn);
}

function mitGitLab(fn, regeln = []) {
  return mitFake(GITLAB, "board-label-gl-", "glab", [
    ...regeln,
    { match: "^issue update", stdout: "" },
    { match: "^issue close", stdout: "" },
    { match: "^issue reopen", stdout: "" },
  ], fn);
}

function mitLokal(fn, frontmatter) {
  const dir = setupProjekt(LOKAL, "board-label-lokal-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  writeFileSync(join(dir, "issues", "0007.md"), frontmatter, "utf-8");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lokalesIssue(dir) {
  return readFileSync(join(dir, "issues", "0007.md"), "utf-8");
}

// Frontmatter mit mehreren Metadaten und einem Body — belegt, dass nur `labels`
// angefasst wird. Bewusst ohne Quotes um die id: parseFrontmatter entfernt sie beim
// Lesen, ein Vergleich mit Quotes wuerde am bestehenden Verhalten von move/update
// scheitern statt am Label-Kommando.
const LOKAL_MIT_LABELS = [
  "---",
  "id: 0007",
  "type: task",
  "status: ready",
  "title: Ein Issue",
  "created: 2026-08-14",
  "labels: kit:nightrun, fix",
  "---",
  "## Kontext",
  "",
  "Text mit --- Strichen.",
  "",
].join("\n");

// Wortgleich zu LOKAL_MIT_LABELS, nur ohne die labels-Zeile: Nur so belegt der
// Vergleich, dass ausschliesslich dieses eine Feld angefasst wurde.
const LOKAL_OHNE_LABELS = LOKAL_MIT_LABELS.replace("labels: kit:nightrun, fix\n", "");

// --- GitHub ---

test("github: add setzt das Label ueber `gh issue edit --add-label`", NUR_POSIX, () => {
  mitGitHub((dir) => {
    assert.deepEqual(board(dir, "issue", "label", "add", "7", "kit:klaeren"), {
      ok: true, id: "7", label: "kit:klaeren", aktion: "add",
    });
    assert.match(
      aufrufZeilen(dir, "gh").join("\n"),
      /issue edit 7 --repo besitzer\/mein-repo --add-label kit:klaeren/,
    );
  });
});

test("github: remove entfernt das Label ueber `--remove-label`", NUR_POSIX, () => {
  mitGitHub((dir) => {
    board(dir, "issue", "label", "remove", "7", "kit:klaeren");
    assert.match(
      aufrufZeilen(dir, "gh").join("\n"),
      /issue edit 7 --repo besitzer\/mein-repo --remove-label kit:klaeren/,
    );
  });
});

test("github: ein zweiter add-Aufruf bleibt bei Exit 0 (idempotent)", NUR_POSIX, () => {
  mitGitHub((dir) => {
    board(dir, "issue", "label", "add", "7", "kit:klaeren");
    const zweiter = runBoard(dir, ["issue", "label", "add", "7", "kit:klaeren"]);
    assert.equal(zweiter.status, 0, zweiter.stderr);
  });
});

// Existiert die Labeldefinition beim Tracker nicht, meldet gh das mit Exit != 0.
// Der Adapter darf das nicht schlucken — sonst gilt eine nie gesetzte Zeichnung als
// gesetzt, und der Nachtlauf haelt ein Issue faelschlich fuer erledigt.
test("github: unbekannte Labeldefinition schlaegt durch", NUR_POSIX, () => {
  mitGitHub((dir) => {
    const res = runBoard(dir, ["issue", "label", "add", "7", "gibtsnicht"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /could not add label/);
  }, [{ match: "^issue edit", stderr: "could not add label: 'gibtsnicht' not found\n", exit: 1 }]);
});

// --- GitLab ---

test("gitlab: add und remove nutzen --label und --unlabel", NUR_POSIX, () => {
  mitGitLab((dir) => {
    board(dir, "issue", "label", "add", "7", "kit:klaeren");
    board(dir, "issue", "label", "remove", "7", "kit:klaeren");
    const zeilen = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeilen, /issue update 7 --label kit:klaeren/);
    assert.match(zeilen, /issue update 7 --unlabel kit:klaeren/);
  });
});

// Bei GitLab SIND die Spaltennamen Labels. Ohne diese Sperre koennte das generische
// Label-Kommando `issue move` umgehen und den Boardzustand beschaedigen.
test("gitlab: ein Status-Label wird abgewiesen, ohne glab zu rufen", NUR_POSIX, () => {
  mitGitLab((dir) => {
    for (const aktion of ["add", "remove"]) {
      const res = runBoard(dir, ["issue", "label", aktion, "7", "Ready"]);
      assert.equal(res.status, 1, res.stderr);
      assert.match(res.stderr, /Status-Label `Ready` nur ueber `issue move` aendern/);
    }
    assert.deepEqual(aufrufZeilen(dir, "glab"), []);
  });
});

// Das Ziel-Label muss den Spaltenwechsel ueberleben: `moveIssue` unlabelt bei GitLab
// nur die Status-Labels, nicht alles.
test("gitlab: ein anschliessendes move erhaelt das gesetzte Label", NUR_POSIX, () => {
  mitGitLab((dir) => {
    board(dir, "issue", "label", "add", "7", "kit:klaeren");
    board(dir, "issue", "move", "7", "ready");
    const moveZeile = aufrufZeilen(dir, "glab").find((z) => z.includes("--label Ready"));
    assert.ok(moveZeile, "kein move-Aufruf mit --label Ready gefunden");
    assert.doesNotMatch(moveZeile, /--unlabel kit:klaeren/);
  });
});

// --- local ---

test("local: add haengt das Label an, remove nimmt es heraus", () => {
  mitLokal((dir) => {
    board(dir, "issue", "label", "add", "7", "kit:klaeren");
    assert.match(lokalesIssue(dir), /^labels: kit:nightrun, fix, kit:klaeren$/m);

    board(dir, "issue", "label", "remove", "7", "kit:klaeren");
    assert.match(lokalesIssue(dir), /^labels: kit:nightrun, fix$/m);
  }, LOKAL_MIT_LABELS);
});

test("local: add legt das Feld an, wenn es noch keines gibt", () => {
  mitLokal((dir) => {
    board(dir, "issue", "label", "add", "7", "kit:klaeren");
    assert.match(lokalesIssue(dir), /^labels: kit:klaeren$/m);
  }, LOKAL_OHNE_LABELS);
});

test("local: uebrige Metadaten und Body bleiben unveraendert, das leere Feld verschwindet", () => {
  mitLokal((dir) => {
    board(dir, "issue", "label", "remove", "7", "kit:nightrun");
    board(dir, "issue", "label", "remove", "7", "fix");
    const inhalt = lokalesIssue(dir);
    assert.equal(inhalt, LOKAL_OHNE_LABELS, "Datei weicht vom labellosen Ausgangsstand ab");
    assert.doesNotMatch(inhalt, /^labels:/m);
  }, LOKAL_MIT_LABELS);
});

test("local: add und remove sind idempotent", () => {
  mitLokal((dir) => {
    board(dir, "issue", "label", "add", "7", "fix");
    assert.match(lokalesIssue(dir), /^labels: kit:nightrun, fix$/m, "add hat dupliziert");

    const zweiterRemove = () => {
      board(dir, "issue", "label", "remove", "7", "gibtsnicht");
      return lokalesIssue(dir);
    };
    assert.equal(zweiterRemove(), zweiterRemove(), "remove eines fremden Labels aendert die Datei");
    assert.match(zweiterRemove(), /^labels: kit:nightrun, fix$/m);
  }, LOKAL_MIT_LABELS);
});

test("local: unbekanntes Issue meldet den Pfad", () => {
  mitLokal((dir) => {
    const res = runBoard(dir, ["issue", "label", "add", "99", "fix"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Issue 99 nicht gefunden/);
  }, LOKAL_MIT_LABELS);
});

// --- toolbox ---

// Der Schreibpfad fehlt serverseitig: Die PAT-geschuetzte API bietet kein atomares
// Hinzufuegen/Entfernen eines Labels per Name (mannewolff/kanban-kit#457). Ein
// erfundener Aufruf waere keine Implementierung — der Zweig weist sich deshalb
// ausdruecklich als nicht verfuegbar aus, statt still etwas anderes zu tun.
test("toolbox: label wird mit Hinweis auf die fehlende Server-Faehigkeit abgewiesen", () => {
  const dir = setupProjekt(TOOLBOX, "board-label-tbx-");
  try {
    const res = runBoard(dir, ["issue", "label", "add", "7", "kit:klaeren"], { TBX_TOKEN: "t" });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /kanban-kit#457/);
    assert.match(res.stderr, /Labels/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Operanden ---

// Alle diese Faelle muessen VOR dem Adapter abbrechen: ein Schreibzugriff auf halbem
// Wissen waere schlimmer als eine Fehlermeldung.
const UNGUELTIG = [
  { name: "ohne Aktion", argv: ["issue", "label"] },
  { name: "ohne Name", argv: ["issue", "label", "add", "7"] },
  { name: "leerer Name", argv: ["issue", "label", "add", "7", ""] },
  { name: "leere ID", argv: ["issue", "label", "add", "", "fix"] },
  { name: "zusaetzliches Argument", argv: ["issue", "label", "add", "7", "fix", "noch-eins"] },
  { name: "Name mit Komma", argv: ["issue", "label", "add", "7", "a,b"] },
  { name: "Name mit Zeilenumbruch", argv: ["issue", "label", "add", "7", "a\nb"] },
];

for (const fall of UNGUELTIG) {
  test(`operanden: ${fall.name} endet mit Exit 1, HELP und ohne CLI-Aufruf`, NUR_POSIX, () => {
    mitGitHub((dir) => {
      const res = runBoard(dir, fall.argv);
      assert.equal(res.status, 1, res.stderr);
      assert.match(res.stdout, /issue label add <id> <name>/);
      assert.ok(res.stderr.trim().length > 0, "keine Meldung auf stderr");
      assert.deepEqual(aufrufZeilen(dir, "gh"), [], "der Adapter wurde trotzdem gerufen");
    });
  });
}

// Leerzeichen und Doppelpunkt sind gueltige Labelbestandteile und muessen als EIN
// Argument ankommen — sonst zerfaellt ein Name unterwegs in zwei.
test("operanden: Name mit Leerzeichen und Doppelpunkt bleibt ein Argument", NUR_POSIX, () => {
  mitGitHub((dir) => {
    board(dir, "issue", "label", "add", "7", "kit: bitte klaeren");
    const argv = readFileSync(join(dir, "fakebin", "gh.log.jsonl"), "utf-8")
      .split("\n").filter(Boolean)
      .map((z) => JSON.parse(z).argv)
      .find((a) => a[0] === "issue" && a[1] === "edit");
    assert.ok(argv, "kein `gh issue edit`-Aufruf im Log");
    assert.ok(argv.includes("kit: bitte klaeren"), `Name zerfallen: ${JSON.stringify(argv)}`);
  });
});

test("operanden: unbekannter Unterbefehl endet mit Exit != 0 und Usage", NUR_POSIX, () => {
  mitGitHub((dir) => {
    const res = runBoard(dir, ["issue", "label", "foo", "7", "fix"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /issue label add <id> <name>/);
    assert.deepEqual(aufrufZeilen(dir, "gh"), []);
  });
});

test("--help nennt beide Label-Kommandos", () => {
  const dir = setupProjekt(LOKAL, "board-label-help-");
  try {
    const res = runBoard(dir, ["--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /issue label add <id> <name>/);
    assert.match(res.stdout, /issue label remove <id> <name>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
