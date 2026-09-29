// Kein Vorschlag im Worktree eines Laufs (Issue #1028, Anlass #961 und #1020).
//
// Im Worktree der Nacht-Kette und des Prueflaufs fehlen `befunde.tsv` und
// `befunde-vorschlaege.json` absichtlich (`bleibtInHauptkopie` in kit/night.mjs). Ein
// `vorschlag --art` dort saehe ein leeres Register und legte eine zweite Idee an, obwohl
// die Hauptkopie fuer dieselbe Art schon einen offenen Vorschlag fuehrt. Darum wird im
// Worktree nur gebucht; den Vorschlag macht der Runner beim Abbau in der Hauptkopie.
//
// Gemessen in einem ECHTEN verknuepften Worktree (`git worktree add`) — die Erkennung
// haengt an `git rev-parse --git-dir` gegen `--git-common-dir`, und die unterscheiden
// sich nur dort.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFUNDE = join(repoRoot, "kit", "befunde.mjs");

function zeile(art) {
  return `2026-09-29T00:00:00.000Z\tplan\t1015\treviewer\t${art}\tWICHTIG\t-`;
}

/** Der Stub-Board-Adapter: protokolliert jeden Aufruf und antwortet mit einer Nummer. */
const STUB_BOARD = [
  "import { appendFileSync } from 'node:fs';",
  String.raw`appendFileSync(process.env.STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\n', 'utf-8');`,
  String.raw`process.stdout.write(JSON.stringify({ id: "1099" }) + '\n');`,
].join("\n");

function git(cwd, ...args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

/** Legt die Register-Dateien an: vier Vorkommen, also ueber der Schwelle 3. */
function registerAnlegen(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "befunde.tsv"),
    Array.from({ length: 4 }, () => `${zeile("konvention")}\n`).join(""), "utf-8");
}

/**
 * Ein Temp-Repo mit einem Commit und einem verknuepften Worktree daneben. Der Stub liegt
 * in einem eigenen Verzeichnis (KIT_ROOT), damit er in keinem der beiden Arbeitsbaeume steht.
 */
function mitRepo(fn) {
  const basis = realpathSync(mkdtempSync(join(tmpdir(), "befunde-wt-")));
  const haupt = join(basis, "haupt");
  const wt = join(basis, "wt");
  const kit = join(basis, "kit");
  try {
    mkdirSync(haupt);
    git(haupt, "init", "-q");
    git(haupt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start");
    git(haupt, "worktree", "add", "-q", "--detach", wt);
    mkdirSync(join(kit, ".claude", "kit"), { recursive: true });
    writeFileSync(join(kit, ".claude", "kit", "board.mjs"), STUB_BOARD, "utf-8");
    fn({ haupt, wt, kit, log: join(basis, "board.log") });
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: haupt });
    rmSync(basis, { recursive: true, force: true });
  }
}

function vorschlag({ kit, log }, cwd, ...args) {
  const res = spawnSync(process.execPath, [BEFUNDE, "vorschlag", ...args], {
    cwd, encoding: "utf-8", env: { ...process.env, KIT_ROOT: kit, STUB_LOG: log },
  });
  return { ...res, json: JSON.parse(res.stdout) };
}

function boardAufrufe(log) {
  return existsSync(log) ? readFileSync(log, "utf-8").split("\n").filter(Boolean) : [];
}

test("[befunde-1028] vorschlag --art legt im Worktree nichts an und schreibt kein Register", () => {
  mitRepo((r) => {
    registerAnlegen(r.wt);
    const res = vorschlag(r, r.wt, "--art", "konvention");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.angelegt, false);
    assert.equal(res.json.ergaenzt, false);
    assert.match(res.json.grund, /Worktree/);
    assert.match(res.json.grund, /Hauptkopie/);
    assert.deepEqual(boardAufrufe(r.log), [], "kein Board-Aufruf");
    assert.equal(existsSync(join(r.wt, ".claude", "befunde-vorschlaege.json")), false,
      "das Register bleibt ungeschrieben");
  });
});

test("[befunde-1028] in der Hauptkopie desselben Repos entsteht der Vorschlag wie bisher", () => {
  mitRepo((r) => {
    registerAnlegen(r.haupt);
    const res = vorschlag(r, r.haupt, "--art", "konvention");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.angelegt, true);
    assert.equal(boardAufrufe(r.log).length, 1);
    assert.equal(existsSync(join(r.haupt, ".claude", "befunde-vorschlaege.json")), true);
  });
});

test("[befunde-1028] vorschlag --abgelehnt im Worktree endet ungleich 0 und verweist auf die Hauptkopie", () => {
  mitRepo((r) => {
    registerAnlegen(r.wt);
    const res = vorschlag(r, r.wt, "--abgelehnt", "konvention");
    assert.notEqual(res.status, 0);
    assert.equal(res.json.ok, false);
    assert.match(res.json.fehler, /Hauptkopie/);
    assert.equal(existsSync(join(r.wt, ".claude", "befunde-vorschlaege.json")), false);
  });
});

test("[befunde-1028] die Hilfe nennt die Worktree-Regel", () => {
  const res = spawnSync(process.execPath, [BEFUNDE, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Worktree/);
});
