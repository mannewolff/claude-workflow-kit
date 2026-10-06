// Ablauf-Pruefung: Die Notiz wird im echten Vault gesucht, und ein Abbruch endet ueber
// process.exit — beobachtbar ist das nur am Prozess des Board-Werkzeugs.
//
// `kontext paths` FINDET die Projektnotiz, statt ihren Namen zu konstruieren (Issue #286).
//
// Der Vault gibt die Schreibweise vor, nicht der Repo-Name: Ein Verzeichnis
// `Projekte/shell-app/` mit der Notiz `Shell-App.md` ist die Konvention gewachsener
// Vaults, kein Fehler. Auf macOS faellt der Unterschied nicht auf (case-insensitives
// Dateisystem); auf einem Linux-Runner legt /document dann eine ZWEITE Notiz an, und
// ab da laeuft die Historie doppelt weiter.
//
// Die reine Auswahl steht in test/board-dokumente-kontext-notiz.test.mjs (Issue #1218).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// Derselbe Abbruch, aber ohne Dateisystem: Der Test oben ueberspringt auf macOS,
// weil sich zwei Schreibweisen dort gar nicht anlegen lassen — die Kollision waere
// nur auf dem Linux-Runner gemessen. `waehleNotiz` nimmt die Dateiliste als ersten
// Parameter, also wird sie hier direkt gereicht und der Abbruch auf jedem Rechner
// gleich gemessen. Kindprozess, weil `fail` mit process.exit(1) endet.
test("waehleNotiz: eine Kollision bricht mit beiden Namen ab", () => {
  const script = [
    `import { waehleNotiz } from ${JSON.stringify(pathToFileURL(join(repoRoot, "kit", "board.mjs")).href)};`,
    `waehleNotiz(["Projekt.md", "projekt.md"], "projekt.md", "/vault/Projekte/projekt", true);`,
  ].join("\n");
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf-8" });

  assert.equal(res.status, 1, `erwartet war ein Abbruch: ${res.stderr}`);
  assert.equal(res.stdout, "", "stdout muss bei einem Abbruch leer bleiben");
  assert.match(res.stderr, /Mehrdeutige Notiz in \/vault\/Projekte\/projekt/);
  assert.match(res.stderr, /Projekt\.md, projekt\.md/, "beide Namen gehoeren in die Meldung");
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
