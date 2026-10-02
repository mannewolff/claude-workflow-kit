// Gemeinsame Hilfen der Tests zum festen Kit-Stand (Issue #1102, Plan #1101).
//
// Das Fixture ist ein Kit-Repo im Kleinen (E8): Es traegt die Kit-Quelle vollstaendig,
// soweit `tools/sync-blobs.mjs` sie liest — `install.mjs`, `kit/`, `skills/`, `templates/`,
// `.githooks/` —, fuehrt `.claude/*` in der `.gitignore` wie das Kit-Repo und hat ein
// blosses `origin`, auf das sein Hauptstand gepusht ist. Die installierte Kopie unter
// `.claude/` entsteht wie beim Menschen ueber `sync-blobs`, sie wird nicht committet —
// anders als in `kette-fixture.mjs`, das seine Kit-Kopie versioniert.
//
// Der Runner startet ohne KIT_ROOT, KIT_STAND und KIT_STAND_PFAD in der Umgebung: Er
// soll seinen Stand selbst bilden, wie in einer echten Nacht.
//
// Diese Datei enthaelt selbst keine Tests.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const NIGHT = join(repoRoot, "kit", "night.mjs");

export const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

/** Die Antwort einer Vorflug-Session, die alles erreicht (wie in kette-fixture.mjs). */
export const VORFLUG_OK = "cat <<'EOF'\n<<<VORFLUG\n{\"reviewers\":[],\"tracker\":{\"erreichbar\":true,\"geprueft\":\"issue list\"}}\nVORFLUG>>>\nEOF";

/** Eine minimale `result`-Zeile, damit der Lauf Kosten und Ende der Session sieht. */
export const RESULT = `echo '{"type":"result","total_cost_usd":1,"duration_api_ms":5,"num_turns":1,"usage":{"input_tokens":1,"output_tokens":1},"result":"ok"}'`;

/** Die Umgebung eines Prozesses, der einen Kit-Stand weder erbt noch umgeleitet bekommt. */
export function umgebungOhneStand(zusatz = {}) {
  const env = { ...process.env };
  delete env.KIT_ROOT;
  delete env.KIT_STAND;
  delete env.KIT_STAND_PFAD;
  return { ...env, KIT_AGENT_MODEL: "fixture-modell", KIT_NIGHT_WAECHTER: "0", NIGHT_KILL_GRACE_MS: "200", ...zusatz };
}

export function git(dir, ...gitArgs) {
  const res = spawnSync("git", gitArgs, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${gitArgs.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

export function sha256(inhalt) {
  return createHash("sha256").update(inhalt).digest("hex");
}

/**
 * Die Zeile, mit der das Gate des Fixtures sich meldet: `gate <marke> <eigener Pfad>`. Sie
 * steht im committeten Gate; ein Paket, das die Marke aendert, aendert damit das Gate.
 */
export const GATE_MARKE = "gate-alt";

function gateMitSpur() {
  const [shebang, ...rest] = readFileSync(join(repoRoot, ".githooks", "gate.mjs"), "utf-8").split("\n");
  const spur = [
    'import { appendFileSync as spurSchreiben } from "node:fs";',
    `if (process.env.BELEG_SPUR) spurSchreiben(process.env.BELEG_SPUR, \`gate ${GATE_MARKE} \${new URL(import.meta.url).pathname}\\n\`);`,
  ];
  return [shebang, ...spur, ...rest].join("\n");
}

/**
 * Legt das Fixture an. `mitKitQuelle: false` laesst die Kit-Quelle weg — dann traegt
 * `origin` nur eine README, und der Mechanismus darf nicht greifen (E3). `ohneOrigin`
 * laesst den Push weg. `config` ergaenzt die Projektkonfiguration.
 */
export function kitFixture({ mitKitQuelle = true, ohneOrigin = false, config = {}, praefix = "kitfx-" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  const origin = mkdtempSync(join(tmpdir(), `${praefix}origin-`));
  if (mitKitQuelle) {
    for (const teil of ["install.mjs", "kit", "skills", "templates"]) {
      cpSync(join(repoRoot, teil), join(dir, teil), { recursive: true });
    }
    mkdirSync(join(dir, "tools"), { recursive: true });
    cpSync(join(repoRoot, "tools", "sync-blobs.mjs"), join(dir, "tools", "sync-blobs.mjs"));
    mkdirSync(join(dir, ".githooks"), { recursive: true });
    writeFileSync(join(dir, ".githooks", "gate.mjs"), gateMitSpur());
    writeFileSync(join(dir, ".githooks", "pre-commit"), readFileSync(join(repoRoot, ".githooks", "pre-commit"), "utf-8"), { mode: 0o755 });
  }
  writeFileSync(join(dir, "README.md"), "fixture\n");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", mainBranch: "main",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
    night: { stand: { pauseMin: 0.0001 } },
    ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n/issues/\n/helfer/\n");
  // Die Blobs in install.mjs passen zur Quelle des Fixtures, bevor sie committet wird —
  // das Gate traegt eine Spur, und die Arbeitskopie des Repos kann dem Blob voraus sein.
  if (mitKitQuelle) syncBlobs(dir);

  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  // Erst jetzt das Gate: Der Setup-Commit hat noch keinen Pruefnachweis.
  if (mitKitQuelle) git(dir, "config", "core.hooksPath", ".githooks");

  git(origin, "init", "-q", "--bare", "-b", "main");
  git(dir, "remote", "add", "origin", origin);
  if (!ohneOrigin) git(dir, "push", "-q", "-u", "origin", "main");

  // Die installierte Kopie, auf dem Weg des Menschen: Verzeichnisse anlegen, sync-blobs.
  if (mitKitQuelle) {
    mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
    mkdirSync(join(dir, ".claude", "skills"), { recursive: true });
    syncBlobs(dir);
  }
  mkdirSync(join(dir, "helfer"), { recursive: true });
  return { dir, origin };
}

/** `node tools/sync-blobs.mjs` im Fixture — das eigene Script des Fixtures, ohne KIT_ROOT. */
export function syncBlobs(dir, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(dir, "tools", "sync-blobs.mjs"), ...cliArgs], {
    cwd: dir, encoding: "utf-8", env: umgebungOhneStand(),
  });
  assert.equal(res.status, 0, `sync-blobs im Fixture: ${res.stdout}${res.stderr}`);
  return res;
}

/** Der Runner aus dem Repo, gestartet im Fixture — ohne geerbten Stand. */
export function runner(dir, cliArgs, env = {}) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], { cwd: dir, encoding: "utf-8", env: umgebungOhneStand(env) });
}

export function board(dir, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(dir, ".claude", "kit", "board.mjs"), ...cliArgs], {
    cwd: dir, encoding: "utf-8", env: umgebungOhneStand(),
  });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Der Ergebnisstand des juengsten Laufs im Fixture. */
export function laufStand(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.ok(dateien.length > 0, "kein Ergebnisstand geschrieben");
  return JSON.parse(readFileSync(join(dir, ".claude", dateien.at(-1)), "utf-8"));
}

/** Die Stand-Worktrees dieses Fixtures unter dem Temp-Verzeichnis. */
export function standWorktrees(dir) {
  const kennung = `-${basename(dir)}-`;
  return readdirSync(tmpdir()).filter((n) => n.startsWith("kitstand-") && n.includes(kennung)).map((n) => join(tmpdir(), n));
}

/** Raeumt Fixture, origin und die Worktrees des Fixtures ab. */
export function aufraeumen({ dir, origin }) {
  for (const pfad of readdirSync(tmpdir()).filter((n) => n.includes(`-${basename(dir)}-`)).map((n) => join(tmpdir(), n))) {
    rmSync(pfad, { recursive: true, force: true });
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(origin, { recursive: true, force: true });
}
