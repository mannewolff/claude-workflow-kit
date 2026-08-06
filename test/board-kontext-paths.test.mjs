// Tests fuer die kontext-Achse von kit/board.mjs (Issue #202).
//
// Zweigeteilt, entlang der Naht des Issues:
//
// 1. Die reinen Funktionen (mergeKontextConfig, resolveKontextPaths) werden direkt
//    importiert und ohne Dateisystem geprueft — dort liegen Merge-Praezedenz,
//    Template-Aufloesung und der Degraded Mode.
// 2. Der CLI-Mantel laeuft wie in allen board-*-Tests gegen ein Fixture-Projekt im
//    Temp-Verzeichnis (siehe test/helpers/board-fixture.mjs). HOME und USERPROFILE
//    zeigen dabei in den Fixture-Ordner, damit os.homedir() nicht die echte globale
//    kontext.config.json des Entwicklerrechners findet (dieselbe Umlenkung wie in
//    test/install-flow.test.mjs, Issue #187 — USERPROFILE ist der Windows-Pfad).
//
// Pfade werden nie als String mit "/" erwartet, sondern mit join() gebaut: Die
// Testsuite laeuft in der CI auch unter Windows (Issue #197).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

import { setupProjekt, runBoard, fakeCli } from "./helpers/board-fixture.mjs";
import { mergeKontextConfig, resolveKontextPaths } from "../kit/board.mjs";

const VAULT = join("/Users", "x", "ClaudeMemory");
const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};

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

test("mergeKontextConfig: lokale Felder gewinnen feldweise, der Rest bleibt global", () => {
  const merged = mergeKontextConfig(
    { vault: VAULT, always: ["Index.md"], project: "aus-global" },
    { project: "EBDC" }
  );
  assert.deepEqual(merged, { vault: VAULT, always: ["Index.md"], project: "EBDC" });
});

test("mergeKontextConfig: fehlende lokale Datei laesst die globale Config unveraendert", () => {
  const global = { vault: VAULT, always: ["Index.md"] };
  assert.deepEqual(mergeKontextConfig(global, undefined), global);
  assert.deepEqual(mergeKontextConfig(global, {}), global);
});

test("mergeKontextConfig: ohne globale Datei zaehlt allein die lokale", () => {
  const local = { vault: VAULT, project: "MeinProjekt" };
  assert.deepEqual(mergeKontextConfig(undefined, local), local);
  assert.deepEqual(mergeKontextConfig(undefined, undefined), {});
});

// --- resolveKontextPaths ---

// Regressionsschutz: ohne parentProject und ohne logPath muessen exakt die Pfade
// herauskommen, die /kontext und /document bisher als Prosa zusammengesetzt haben.
test("resolveKontextPaths: Default-Fall ergibt die heutigen Pfade", () => {
  const ergebnis = resolveKontextPaths({
    cfg: { vault: VAULT, always: ["Index.md", "Profil.md"] },
    project: "claude-workflow-kit",
    date: "2026-08-06",
  });
  assert.deepEqual(ergebnis, {
    mode: "full",
    vault: VAULT,
    project: "claude-workflow-kit",
    parentProject: null,
    log: join(VAULT, "Log", "2026-08-06.md"),
    projectNote: join(VAULT, "Projekte", "claude-workflow-kit", "claude-workflow-kit.md"),
    parentNote: null,
    always: [join(VAULT, "Index.md"), join(VAULT, "Profil.md")],
    projectDocs: ["CLAUDE-*", ".claude/CLAUDE-*"],
  });
});

test("resolveKontextPaths: Multi-Repo mit parentProject und logPath", () => {
  const ergebnis = resolveKontextPaths({
    cfg: {
      vault: VAULT,
      parentProject: "MeinSystem",
      logPath: "Log/{date}-{project}.md",
      always: ["Index.md"],
      projectDocs: ["CLAUDE-service.md"],
    },
    project: "auth-service",
    date: "2026-08-06",
  });
  assert.equal(ergebnis.mode, "full");
  assert.equal(ergebnis.parentProject, "MeinSystem");
  assert.equal(ergebnis.log, join(VAULT, "Log", "2026-08-06-auth-service.md"));
  assert.equal(ergebnis.projectNote, join(VAULT, "Projekte", "MeinSystem", "auth-service.md"));
  assert.equal(ergebnis.parentNote, join(VAULT, "Projekte", "MeinSystem", "MeinSystem.md"));
  assert.deepEqual(ergebnis.projectDocs, ["CLAUDE-service.md"]);
});

// Ein logPath ohne {project} ist bei mehreren Services zwar eine schlechte Wahl (alle
// schreiben wieder in dieselbe Datei), aber eine Entscheidung des Nutzers. Der Wert
// wird respektiert und nicht stillschweigend um den Projektnamen ergaenzt.
test("resolveKontextPaths: logPath ohne {project} bleibt trotz parentProject unveraendert", () => {
  const ergebnis = resolveKontextPaths({
    cfg: { vault: VAULT, parentProject: "MeinSystem", logPath: "Log/{date}.md" },
    project: "auth-service",
    date: "2026-08-06",
  });
  assert.equal(ergebnis.log, join(VAULT, "Log", "2026-08-06.md"));
});

test("resolveKontextPaths: ohne vault Degraded Mode mit lauter null-Pfaden", () => {
  const ergebnis = resolveKontextPaths({
    cfg: { always: ["Index.md"], parentProject: "MeinSystem" },
    project: "auth-service",
    date: "2026-08-06",
  });
  assert.deepEqual(ergebnis, {
    mode: "degraded",
    vault: null,
    project: "auth-service",
    parentProject: "MeinSystem",
    log: null,
    projectNote: null,
    parentNote: null,
    always: [],
    projectDocs: ["CLAUDE-*", ".claude/CLAUDE-*"],
  });
});

test("resolveKontextPaths: uebergebenes Projekt schlaegt cfg.project", () => {
  const cfg = { vault: VAULT, project: "aus-config" };
  assert.equal(
    resolveKontextPaths({ cfg, project: "vom-flag", date: "2026-08-06" }).project,
    "vom-flag"
  );
  assert.equal(resolveKontextPaths({ cfg, date: "2026-08-06" }).project, "aus-config");
});

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

test("kontext paths: ohne cfg.project gilt der Repo-Name des Code-Hosts", NUR_POSIX, () => {
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
