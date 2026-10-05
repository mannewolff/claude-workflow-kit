// Issue #1137: Der GO-Commit der Board-Oberflaeche startet git ohne Shell.
// Ein Drag nach ready erzeugt den Commit "GO: #N nach ready", auch wenn der
// Pfad Leerzeichen und Anfuehrungszeichen enthaelt; fremde gestagte
// Aenderungen bleiben im Index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const BOARD_UI = resolve("kit/board-ui.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

function freierPort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function warteAufServer(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/config`);
      if (r.ok) return;
    } catch {
      // Server noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("board-ui startet nicht");
}

test("GO-Commit entsteht bei Leerzeichen, Anfuehrungszeichen und $ im Pfad, fremder Index bleibt", async () => {
  const repo = mkdtempSync(join(tmpdir(), "board-ui-git-"));
  // `"` ist in Windows-Pfaden verboten; dort pruefen Leerzeichen, `'` und `$` dieselbe
  // Zusage (Issue #1146).
  const sonder = process.platform === "win32" ? `iss ues 'y' $HOME` : `iss ues "x" 'y' $HOME`;
  const issuesDir = join(repo, sonder);
  mkdirSync(issuesDir);
  mkdirSync(join(repo, ".claude"));
  const port = await freierPort();
  writeFileSync(
    join(repo, ".claude", "workflow.config.json"),
    JSON.stringify({ local: { issuesDir, uiPort: port } }),
  );
  writeFileSync(join(issuesDir, "7.md"), "---\nid: 7\ntitle: Probe\nstatus: backlog\n---\n\nText\n");
  writeFileSync(join(repo, "fremd.txt"), "alt\n");
  lfAttribute(join(repo, ".gitattributes"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@example.org");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "start");
  writeFileSync(join(repo, "fremd.txt"), "neu\n");
  git(repo, "add", "fremd.txt");

  const kind = spawn(process.execPath, [BOARD_UI], { cwd: repo, stdio: "pipe" });
  let stderr = "";
  kind.stderr.on("data", (d) => (stderr += d));
  try {
    await warteAufServer(port);
    const r = await fetch(`http://localhost:${port}/api/issues/7/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "ready" }),
    });
    assert.equal(r.status, 200);
    assert.equal(git(repo, "log", "-1", "--format=%s").trim(), "GO: #7 nach ready", stderr);
    const imCommit = git(repo, "show", "--name-only", "--format=", "HEAD").trim();
    assert.match(imCommit, /7\.md/);
    assert.doesNotMatch(imCommit, /fremd\.txt/);
    assert.equal(git(repo, "diff", "--cached", "--name-only").trim(), "fremd.txt");
  } finally {
    // Unter Windows laesst sich das Verzeichnis nicht loeschen, solange board-ui darin sein
    // Arbeitsverzeichnis hat; kill() stoesst das Ende nur an (Issue #1173).
    const beendet = kind.exitCode !== null || kind.signalCode !== null
      ? Promise.resolve()
      : new Promise((ok) => kind.once("exit", ok));
    kind.kill();
    await beendet;
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
