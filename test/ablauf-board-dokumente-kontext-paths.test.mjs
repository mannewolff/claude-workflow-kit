// Ablauf-Pruefung: Der CLI-Mantel der kontext-Achse liest HOME, die Vault-Dateien und endet bei
// Fehlern ueber process.exit — beobachtbar ist das nur am Prozess des Board-Werkzeugs.
//
// Der CLI-Mantel der kontext-Achse von kit/board.mjs (Issue #202). Er laeuft gegen ein
// Fixture-Projekt im Temp-Verzeichnis (siehe test/helpers/board-fixture.mjs). HOME und USERPROFILE
// zeigen dabei in den Fixture-Ordner, damit os.homedir() nicht die echte globale
// kontext.config.json des Entwicklerrechners findet (dieselbe Umlenkung wie in
// test/install-flow.test.mjs, Issue #187 — USERPROFILE ist der Windows-Pfad).
//
// Pfade werden nie als String mit "/" erwartet, sondern mit join() gebaut: Die
// Testsuite laeuft in der CI auch unter Windows (Issue #197).
//
// Die reinen Funktionen stehen in test/board-dokumente-kontext-paths.test.mjs (Issue #1218).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

import { setupProjekt, runBoard, fakeCli } from "./helpers/board-fixture.mjs";

const VAULT = join("/Users", "x", "ClaudeMemory");
const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

/**
 * Fixture mit umgelenktem HOME plus optionaler globaler und lokaler kontext.config.json.
 * `global`/`local` duerfen ein Objekt (wird serialisiert) oder Rohtext sein — letzteres
 * fuer den Fall der kaputten Datei.
 */
function mitKontext({ global = null, local = null, config = LOKAL } = {}, fn) {
  const dir = setupProjekt(config, "board-kontext-");
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const schreibe = (pfad, inhalt) =>
    writeFileSync(pfad, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt, null, 2));
  if (global) schreibe(join(home, ".claude", "kontext.config.json"), global);
  if (local) schreibe(join(dir, ".claude", "kontext.config.json"), local);
  try {
    fn(dir, { HOME: home, USERPROFILE: home });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ruft `kontext paths` auf, erwartet Exit 0 und liefert die geparste Ausgabe. */
function paths(dir, env, ...cliArgs) {
  const res = runBoard(dir, ["kontext", "paths", ...cliArgs], env);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

// --- mergeKontextConfig ---
// --- CLI: Akzeptanzkriterium ---

test("kontext paths gibt JSON mit allen Feldern aus", () => {
  mitKontext({ global: { vault: VAULT, always: ["Index.md"] } }, (dir, env) => {
    const ergebnis = paths(dir, env, "--project", "demo", "--date", "2026-08-06");
    assert.deepEqual(ergebnis, {
      mode: "full",
      vault: VAULT,
      project: "demo",
      parentProject: null,
      log: join(VAULT, "Log", "2026-08-06.md"),
      projectNote: join(VAULT, "Projekte", "demo", "demo.md"),
      parentNote: null,
      always: [join(VAULT, "Index.md")],
      projectDocs: ["CLAUDE-*", ".claude/CLAUDE-*"],
    });
  });
});

test("kontext paths mergt globale und lokale Config", () => {
  mitKontext(
    {
      global: { vault: VAULT, always: ["Index.md"], logPath: "Log/{date}.md" },
      local: { parentProject: "MeinSystem", logPath: "Log/{date}-{project}.md" },
    },
    (dir, env) => {
      const ergebnis = paths(dir, env, "--project", "auth-service", "--date", "2026-08-06");
      assert.equal(ergebnis.vault, VAULT, "vault muss von global geerbt werden");
      assert.equal(ergebnis.log, join(VAULT, "Log", "2026-08-06-auth-service.md"));
      assert.equal(ergebnis.parentNote, join(VAULT, "Projekte", "MeinSystem", "MeinSystem.md"));
    }
  );
});

test("kontext paths ohne --date nimmt den heutigen Tag", () => {
  mitKontext({ global: { vault: VAULT } }, (dir, env) => {
    const ergebnis = paths(dir, env, "--project", "demo");
    assert.match(ergebnis.log, /\d{4}-\d{2}-\d{2}\.md$/);
  });
});

test("kontext paths ohne jede Config laeuft im Degraded Mode", () => {
  mitKontext({}, (dir, env) => {
    const ergebnis = paths(dir, env, "--project", "demo", "--date", "2026-08-06");
    assert.equal(ergebnis.mode, "degraded");
    assert.equal(ergebnis.log, null);
  });
});

// --- CLI: Projektname-Praezedenz ---

test("kontext paths: --project schlaegt cfg.project", () => {
  mitKontext({ global: { vault: VAULT, project: "aus-config" } }, (dir, env) => {
    assert.equal(paths(dir, env, "--project", "vom-flag").project, "vom-flag");
  });
});

test("kontext paths: cfg.project schlaegt den Repo-Namen", () => {
  mitKontext({ global: { vault: VAULT, project: "EBDC" } }, (dir, env) => {
    // Kein Fake-git noetig: Steht der Name in der Config, wird der Code-Host gar
    // nicht erst gefragt — genau das prueft dieser Test.
    assert.equal(paths(dir, env).project, "EBDC");
  });
});

test("kontext paths: ohne cfg.project gilt der Repo-Name des Code-Hosts", () => {
  mitKontext({ global: { vault: VAULT } }, (dir, env) => {
    fakeCli(dir, "git", [{ match: "remote get-url origin", stdout: "https://example.com/team/auth-service.git\n" }]);
    assert.equal(paths(dir, env).project, "auth-service");
  });
});

// Akzeptanzkriterium: board.mjs ist als kopierbares Single-File-Tool auch in einem
// Projekt ohne workflow.config.json lauffaehig — dort gibt es keinen Code-Host, und
// der Verzeichnisname ist die beste verfuegbare Auskunft.
test("kontext paths: ohne workflow.config.json greift der Verzeichnisname", () => {
  mitKontext({ config: null, global: { vault: VAULT } }, (dir, env) => {
    const ergebnis = paths(dir, env, "--date", "2026-08-06");
    assert.equal(ergebnis.project, basename(dir));
    assert.equal(ergebnis.projectNote, join(VAULT, "Projekte", basename(dir), `${basename(dir)}.md`));
  });
});

test("kontext paths: unbekannter codeHost faellt auf den Verzeichnisnamen zurueck", () => {
  mitKontext({ config: { codeHost: "svn", issueTracker: "local" }, global: { vault: VAULT } }, (dir, env) => {
    assert.equal(paths(dir, env, "--date", "2026-08-06").project, basename(dir));
  });
});

// --- CLI: Hilfe und Fehlerpfade ---

test("Die Hilfe nennt die kontext-Achse", () => {
  mitKontext({}, (dir, env) => {
    const res = runBoard(dir, ["--help"], env);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /kontext paths/);
  });
});

test("Unbekannte Achse nennt issue | code | kontext", () => {
  mitKontext({}, (dir, env) => {
    const res = runBoard(dir, ["quatsch"], env);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Erwartet: issue \| code \| kontext/);
  });
});

test("Unbekannter kontext-Befehl: Hilfe plus Fehlermeldung", () => {
  mitKontext({}, (dir, env) => {
    const res = runBoard(dir, ["kontext", "fliegen"], env);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /Board-Adapter/);
    assert.match(res.stderr, /Unbekannter kontext-Befehl: 'fliegen'/);
  });
});

test("--project und --date ohne Wert brechen mit Meldung ab", () => {
  mitKontext({ global: { vault: VAULT } }, (dir, env) => {
    const ohneProjekt = runBoard(dir, ["kontext", "paths", "--project"], env);
    assert.equal(ohneProjekt.status, 1);
    assert.match(ohneProjekt.stderr, /--project braucht einen Wert/);

    const ohneDatum = runBoard(dir, ["kontext", "paths", "--date"], env);
    assert.equal(ohneDatum.status, 1);
    assert.match(ohneDatum.stderr, /--date braucht einen Wert/);
  });
});

// Eine kaputte kontext.config.json wird nicht stillschweigend als "keine Config"
// behandelt: Sonst liefe /document unbemerkt im Degraded Mode und schriebe Wochen
// lang am Vault vorbei — genau die Fehlerklasse, fuer die diese Aufloesung in Code
// gezogen wurde.
test("Kaputte kontext.config.json: Meldung nennt den Pfad, Exit 1", () => {
  mitKontext({ local: "{ das ist kein JSON" }, (dir, env) => {
    const res = runBoard(dir, ["kontext", "paths"], env);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /kontext\.config\.json konnte nicht gelesen werden/);
  });
});

/** Legt einen echten Vault mit Log-Dateien an und gibt seinen Pfad zurueck. */
function mitVault(dir, dateien) {
  const vault = join(dir, "vault");
  mkdirSync(join(vault, "Log"), { recursive: true });
  for (const name of dateien) writeFileSync(join(vault, "Log", name), `# ${name}\n`);
  return vault;
}

test("kontext last-log liefert Pfad und Datum des juengsten Eintrags", () => {
  const dir = setupProjekt(LOKAL, "board-lastlog-");
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const vault = mitVault(dir, ["2026-08-01-auth.md", "2026-08-04-auth.md", "2026-08-04-payment.md"]);
  writeFileSync(
    join(home, ".claude", "kontext.config.json"),
    JSON.stringify({ vault, logPath: "Log/{date}-{project}.md" })
  );
  try {
    const res = runBoard(dir, ["kontext", "last-log", "--project", "auth"], { HOME: home, USERPROFILE: home });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {
      path: join(vault, "Log", "2026-08-04-auth.md"),
      date: "2026-08-04",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kontext last-log ohne Vorgaenger liefert path null", () => {
  const dir = setupProjekt(LOKAL, "board-lastlog-");
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const vault = mitVault(dir, []);
  writeFileSync(join(home, ".claude", "kontext.config.json"), JSON.stringify({ vault }));
  try {
    const res = runBoard(dir, ["kontext", "last-log", "--project", "auth"], { HOME: home, USERPROFILE: home });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { path: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kontext last-log ohne Vault liefert path null statt eines Fehlers", () => {
  mitKontext({}, (dir, env) => {
    const res = runBoard(dir, ["kontext", "last-log", "--project", "auth"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { path: null });
  });
});

test("kontext last-log: fehlendes Log-Verzeichnis ist kein Fehler", () => {
  const dir = setupProjekt(LOKAL, "board-lastlog-");
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const vault = join(dir, "vault-ohne-log");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(home, ".claude", "kontext.config.json"), JSON.stringify({ vault }));
  try {
    const res = runBoard(dir, ["kontext", "last-log", "--project", "auth"], { HOME: home, USERPROFILE: home });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { path: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
