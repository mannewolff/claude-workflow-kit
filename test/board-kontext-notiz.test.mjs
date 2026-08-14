// `kontext paths` FINDET die Projektnotiz, statt ihren Namen zu konstruieren (Issue #286).
//
// Der Vault gibt die Schreibweise vor, nicht der Repo-Name: Ein Verzeichnis
// `Projekte/shell-app/` mit der Notiz `Shell-App.md` ist die Konvention gewachsener
// Vaults, kein Fehler. Auf macOS faellt der Unterschied nicht auf (case-insensitives
// Dateisystem); auf einem Linux-Runner legt /document dann eine ZWEITE Notiz an, und
// ab da laeuft die Historie doppelt weiter.
//
// Zweigeteilt wie board-kontext-paths: die reine Auswahlfunktion direkt, der
// Dateisystem-Zugriff ueber den CLI-Mantel im Fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { pickNoteFile } from "../kit/board.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

/**
 * Fixture mit umgelenktem HOME und einem ECHTEN Vault im Temp-Verzeichnis.
 * `notizen` ist eine Map "<Projekte-Unterordner>" -> [Dateinamen].
 */
function mitVault({ cfg, notizen = {} }, fn) {
  const dir = setupProjekt(LOKAL, "board-notiz-");
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const vault = join(dir, "vault");
  for (const [ordner, dateien] of Object.entries(notizen)) {
    const ziel = join(vault, "Projekte", ordner);
    mkdirSync(ziel, { recursive: true });
    for (const name of dateien) writeFileSync(join(ziel, name), `# ${name}\n`);
  }
  writeFileSync(
    join(home, ".claude", "kontext.config.json"),
    JSON.stringify({ vault, ...cfg }, null, 2),
  );
  try {
    return fn(dir, { HOME: home, USERPROFILE: home }, vault);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function paths(dir, env, ...cliArgs) {
  const res = runBoard(dir, ["kontext", "paths", ...cliArgs], env);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

// --- pickNoteFile: die reine Auswahl ---

test("pickNoteFile: genau eine .md im Ordner ist die Notiz, egal wie sie heisst", () => {
  assert.deepEqual(pickNoteFile(["Shell-App.md"], "shell-app.md"), { name: "Shell-App.md", kollision: null });
});

test("pickNoteFile: keine .md -> kein Name (Erstanlage)", () => {
  assert.deepEqual(pickNoteFile([], "shell-app.md"), { name: null, kollision: null });
  assert.deepEqual(pickNoteFile(["notiz.txt", "bild.png"], "shell-app.md"), { name: null, kollision: null });
});

test("pickNoteFile: bei mehreren zaehlt der case-insensitiv passende Name", () => {
  const dateien = ["Board-App.md", "Shell-App.md", "Users-App.md"];
  assert.equal(pickNoteFile(dateien, "shell-app.md").name, "Shell-App.md");
});

test("pickNoteFile: mehrere Dateien, keine passt -> kein Name", () => {
  assert.deepEqual(
    pickNoteFile(["Board-App.md", "Users-App.md"], "shell-app.md"),
    { name: null, kollision: null },
  );
});

// Zwei Dateien, die sich nur in der Gross-/Kleinschreibung unterscheiden: Welche
// gemeint ist, kann das Werkzeug nicht wissen. Ein stiller Griff ins Ungewisse waere
// genau der Fehler, den dieses Issue behebt.
test("pickNoteFile: zwei case-insensitiv passende Namen sind eine Kollision", () => {
  const ergebnis = pickNoteFile(["Shell-App.md", "shell-app.md"], "shell-app.md");
  assert.equal(ergebnis.name, null);
  assert.deepEqual(ergebnis.kollision, ["Shell-App.md", "shell-app.md"]);
});

// Im Multi-Repo-Fall teilen sich Dach- und Service-Notiz EIN Verzeichnis. Die
// Kulanzregel "die einzige Datei ist es" wuerde beide auf dieselbe Datei zeigen
// lassen — und /document schriebe den Service-Stand in die Dach-Notiz.
test("pickNoteFile: im geteilten Ordner greift die Einzeldatei-Regel nicht", () => {
  assert.deepEqual(
    pickNoteFile(["Shell-App.md"], "mini-jira.md", { alleinstehend: false }),
    { name: null, kollision: null },
  );
  assert.equal(
    pickNoteFile(["Shell-App.md"], "shell-app.md", { alleinstehend: false }).name,
    "Shell-App.md",
  );
});

test("pickNoteFile: Endungen werden case-insensitiv erkannt", () => {
  assert.equal(pickNoteFile(["Shell-App.MD"], "shell-app.md").name, "Shell-App.MD");
});

// --- CLI: projectNote ---

test("kontext paths liefert den tatsaechlichen Dateinamen der Projektnotiz", () => {
  mitVault({ cfg: {}, notizen: { "shell-app": ["Shell-App.md"] } }, (dir, env, vault) => {
    const ergebnis = paths(dir, env, "--project", "shell-app", "--date", "2026-08-14");
    assert.equal(ergebnis.projectNote, join(vault, "Projekte", "shell-app", "Shell-App.md"));
  });
});

test("kontext paths: leerer Notizordner liefert den konstruierten Pfad", () => {
  mitVault({ cfg: {}, notizen: { "shell-app": [] } }, (dir, env, vault) => {
    const ergebnis = paths(dir, env, "--project", "shell-app", "--date", "2026-08-14");
    assert.equal(ergebnis.projectNote, join(vault, "Projekte", "shell-app", "shell-app.md"));
  });
});

test("kontext paths: fehlender Notizordner liefert den konstruierten Pfad", () => {
  mitVault({ cfg: {}, notizen: {} }, (dir, env, vault) => {
    const ergebnis = paths(dir, env, "--project", "shell-app", "--date", "2026-08-14");
    assert.equal(ergebnis.projectNote, join(vault, "Projekte", "shell-app", "shell-app.md"));
  });
});

test("kontext paths: aus mehreren Notizen wird die passende gewaehlt", () => {
  const notizen = { "mini-jira": ["Board-App.md", "Shell-App.md", "Mini-Jira.md"] };
  mitVault({ cfg: { parentProject: "mini-jira" }, notizen }, (dir, env, vault) => {
    const ergebnis = paths(dir, env, "--project", "shell-app", "--date", "2026-08-14");
    assert.equal(ergebnis.projectNote, join(vault, "Projekte", "mini-jira", "Shell-App.md"));
  });
});

// --- CLI: parentNote, dieselbe Regel ---

test("kontext paths loest auch die Dach-Notiz ueber den tatsaechlichen Namen auf", () => {
  const notizen = { "mini-jira": ["Mini-Jira.md", "Shell-App.md"] };
  mitVault({ cfg: { parentProject: "mini-jira" }, notizen }, (dir, env, vault) => {
    const ergebnis = paths(dir, env, "--project", "shell-app", "--date", "2026-08-14");
    assert.equal(ergebnis.parentNote, join(vault, "Projekte", "mini-jira", "Mini-Jira.md"));
    assert.equal(ergebnis.projectNote, join(vault, "Projekte", "mini-jira", "Shell-App.md"));
  });
});

// Liegt erst eine der beiden Notizen im geteilten Ordner, darf die andere NICHT
// dieselbe Datei bekommen — sonst schreibt /document den Service-Stand in die
// Dach-Notiz.
test("kontext paths: im geteilten Ordner bekommt die fehlende Notiz ihren eigenen Pfad", () => {
  mitVault({ cfg: { parentProject: "mini-jira" }, notizen: { "mini-jira": ["Mini-Jira.md"] } }, (dir, env, vault) => {
    const ergebnis = paths(dir, env, "--project", "shell-app", "--date", "2026-08-14");
    assert.equal(ergebnis.parentNote, join(vault, "Projekte", "mini-jira", "Mini-Jira.md"));
    assert.equal(ergebnis.projectNote, join(vault, "Projekte", "mini-jira", "shell-app.md"));
  });
});

// --- CLI: Fehlerpfade ---

test("kontext paths: zwei case-insensitiv passende Notizen brechen ab", (t) => {
  mitVault({ cfg: {}, notizen: { "shell-app": ["Shell-App.md", "shell-app.md"] } }, (dir, env, vault) => {
    // Auf einem case-insensitiven Dateisystem (macOS-Default) fallen die beiden
    // Dateien zu einer zusammen — der Fall, den dieses Issue behebt, laesst sich
    // dort gar nicht herstellen. Auf dem Linux-Runner der CI laeuft der Test echt.
    const angelegt = readdirSync(join(vault, "Projekte", "shell-app"));
    if (angelegt.length < 2) {
      t.skip("case-insensitives Dateisystem: zwei Schreibweisen fallen zu einer Datei zusammen");
      return;
    }
    const res = runBoard(dir, ["kontext", "paths", "--project", "shell-app"], env);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "", "stdout muss bei einem Abbruch leer bleiben");
    assert.match(res.stderr, /Shell-App\.md/);
    assert.match(res.stderr, /shell-app\.md/);
    assert.match(res.stderr, /shell-app/);
  });
});

test("kontext paths: Notizordner ist eine Datei -> Abbruch mit Pfad", () => {
  mitVault({ cfg: {}, notizen: { "Projekte-Platzhalter": [] } }, (dir, env, vault) => {
    // Projekte/shell-app existiert, ist aber eine Datei — kein leerer Ordner.
    writeFileSync(join(vault, "Projekte", "shell-app"), "kein Verzeichnis\n");
    const res = runBoard(dir, ["kontext", "paths", "--project", "shell-app"], env);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /shell-app/);
  });
});

// --- Vertrag ---

test("kontext paths: der JSON-Vertrag bleibt unveraendert", () => {
  mitVault({ cfg: { always: ["Index.md"] }, notizen: { "shell-app": ["Shell-App.md"] } }, (dir, env) => {
    const ergebnis = paths(dir, env, "--project", "shell-app", "--date", "2026-08-14");
    assert.deepEqual(Object.keys(ergebnis).sort(), [
      "always", "log", "mode", "parentNote", "parentProject", "project", "projectDocs", "projectNote", "vault",
    ]);
  });
});

test("kontext paths: Degraded Mode bleibt ohne Vault-Zugriff", () => {
  const dir = setupProjekt(LOKAL, "board-notiz-degraded-");
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  try {
    const res = runBoard(dir, ["kontext", "paths", "--project", "x"], { HOME: home, USERPROFILE: home });
    assert.equal(res.status, 0, res.stderr);
    const ergebnis = JSON.parse(res.stdout);
    assert.equal(ergebnis.mode, "degraded");
    assert.equal(ergebnis.projectNote, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
