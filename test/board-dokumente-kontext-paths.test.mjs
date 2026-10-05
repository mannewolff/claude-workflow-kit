// Die reinen Funktionen der kontext-Achse (Issue #202, #205), im selben Prozess gegen den
// Board-Teil dokumente (Issue #1218, Plan #1199, E18): Merge-Praezedenz, Template-Aufloesung,
// Degraded Mode und die Auswahl des Log-Vorgaengers, ohne Dateisystem. Den CLI-Mantel prueft
// test/ablauf-board-dokumente-kontext-paths.test.mjs.
//
// Pfade werden nie als String mit "/" erwartet, sondern mit join() gebaut: Die
// Testsuite laeuft in der CI auch unter Windows (Issue #197).

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { mergeKontextConfig, resolveKontextPaths, pickLatestLog } from "../kit/board/dokumente.mjs";

const VAULT = join("/Users", "x", "ClaudeMemory");


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

// --- pickLatestLog (Issue #205) ---
//
// Der Log ist die einzige Vault-Datei, die geschrieben wird, ohne dass jemand die
// vorherige Fassung gesehen hat: /kontext liest ihn nicht. Die Auswahl des Vorgaengers
// laeuft deshalb hier in Code — als reine Funktion ueber eine Dateinamensliste, damit
// die Randfaelle ohne Dateisystem pruefbar sind.

const LOG_TEMPLATE = "Log/{date}-{project}.md";

test("pickLatestLog: ohne Kandidaten gibt es keinen Vorgaenger", () => {
  assert.equal(pickLatestLog([], { template: LOG_TEMPLATE, project: "auth" }), null);
  assert.equal(
    pickLatestLog(["Index.md", "Profil.md"], { template: LOG_TEMPLATE, project: "auth" }),
    null
  );
});

test("pickLatestLog: von mehreren Kandidaten gewinnt der juengste", () => {
  const dateien = ["2026-08-01-auth.md", "2026-08-04-auth.md", "2026-07-30-auth.md"];
  assert.deepEqual(pickLatestLog(dateien, { template: LOG_TEMPLATE, project: "auth" }), {
    name: "2026-08-04-auth.md",
    date: "2026-08-04",
  });
});

test("pickLatestLog: der heutige Eintrag zaehlt nicht als eigener Vorgaenger", () => {
  // Zweite Session am selben Tag: Ohne diese Grenze laese der Eintrag sich selbst.
  const dateien = ["2026-08-04-auth.md", "2026-08-06-auth.md"];
  assert.deepEqual(
    pickLatestLog(dateien, { template: LOG_TEMPLATE, project: "auth", before: "2026-08-06" }),
    { name: "2026-08-04-auth.md", date: "2026-08-04" }
  );
});

test("pickLatestLog: Dateien fremder Projekte werden nicht gewaehlt", () => {
  // Der Kern des Multi-Repo-Falls: Im geteilten Log-Ordner liegen die Eintraege aller
  // Services nebeneinander. Der juengste ueberhaupt waere die falsche Anknuepfung.
  const dateien = ["2026-08-05-payment.md", "2026-08-01-auth.md"];
  assert.deepEqual(pickLatestLog(dateien, { template: LOG_TEMPLATE, project: "auth" }), {
    name: "2026-08-01-auth.md",
    date: "2026-08-01",
  });
});

test("pickLatestLog: Dateien ohne gueltigen Datumsteil werden ignoriert", () => {
  const dateien = ["notiz-auth.md", "2026-13-99-auth.md", "2026-08-01-auth.md"];
  assert.deepEqual(pickLatestLog(dateien, { template: LOG_TEMPLATE, project: "auth" }), {
    name: "2026-08-01-auth.md",
    date: "2026-08-01",
  });
});

test("pickLatestLog: Template ohne {project} findet die reinen Datumsdateien", () => {
  // Der Ein-Repo-Default. Ein Projektname darf hier nichts aendern.
  const dateien = ["2026-08-01.md", "2026-08-04.md", "2026-08-04-auth.md"];
  assert.deepEqual(pickLatestLog(dateien, { template: "Log/{date}.md", project: "auth" }), {
    name: "2026-08-04.md",
    date: "2026-08-04",
  });
});

test("pickLatestLog: Sonderzeichen im Projektnamen bleiben woertlich", () => {
  // Ein Punkt im Namen darf im Muster kein Regex-Platzhalter werden.
  const dateien = ["2026-08-01-a.b.md", "2026-08-02-axb.md"];
  assert.deepEqual(pickLatestLog(dateien, { template: LOG_TEMPLATE, project: "a.b" }), {
    name: "2026-08-01-a.b.md",
    date: "2026-08-01",
  });
});

// --- CLI: kontext last-log ---
