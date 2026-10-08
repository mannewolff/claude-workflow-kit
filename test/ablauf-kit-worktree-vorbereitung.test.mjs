// Ablauf-Pruefung: kit/worktree.mjs exportiert nichts; die Unterkommandos sind nur als Prozess beobachtbar.
//
// Die Kommandozeile der vorbereiteten Veroeffentlichung (Issue #1246, Plan #1243, A5, A6,
// E10). Die Logik pruefen die leichten Faelle in `night-kitstand-vorbereitung.test.mjs`;
// hier steht nur, dass `vorbereitung-festhalten` und `vorbereitung-pruefen` sie aufrufen
// und ihr Ergebnis mit Exit-Code als JSON-Zeile ausgeben — samt `--verwerfen`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WERKZEUG = join(repoRoot, "kit", "worktree.mjs");

function git(cwd, ...a) {
  const res = spawnSync("git", a, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

/** Ruft das Werkzeug und liefert Exitcode und das JSON der letzten Zeile. */
function werkzeug(cwd, env, ...cliArgs) {
  const res = spawnSync(process.execPath, [WERKZEUG, ...cliArgs], { cwd, encoding: "utf-8", env: { ...process.env, ...env } });
  const zeilen = res.stdout.split("\n").filter((z) => z.trim() !== "");
  assert.ok(zeilen.length > 0, `keine Ausgabe: ${res.stderr}`);
  return { status: res.status, stand: JSON.parse(zeilen.at(-1)) };
}

/** Ein Repo mit `origin/main` hinter `main` und ein Worktree mit dem Release-Commit. */
function setup() {
  const repo = mkdtempSync(join(tmpdir(), "vorbereitung-cli-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
  writeFileSync(join(repo, ".claude", "workflow.config.json"), "{\"codeHost\":\"local\",\"issueTracker\":\"local\"}\n");
  writeFileSync(join(repo, "RELEASING.md"), "# Release\n");
  lfAttribute(join(repo, ".gitattributes"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.invalid");
  git(repo, "config", "user.name", "T");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Anfang");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(repo, "b.txt"), "b\n");
  git(repo, "add", "b.txt");
  git(repo, "commit", "-q", "-m", "Paket (Issue #21)");

  const pfad = join(mkdtempSync(join(tmpdir(), "vorbereitung-cli-wt-")), "wt");
  git(repo, "worktree", "add", "-q", "--detach", pfad, "main");
  writeFileSync(join(pfad, "CHANGELOG.md"), "2.0.0\n");
  git(pfad, "add", "CHANGELOG.md");
  git(pfad, "commit", "-q", "-m", "chore: v2.0.0");
  mkdirSync(join(pfad, ".claude"), { recursive: true });
  writeFileSync(join(pfad, ".claude", "checks-summary.json"), JSON.stringify({
    stufe: "push", abgeschlossen: true, laufen: [{ cmd: "npm test", ergebnis: "gruen" }],
  }));
  return { repo, pfad, commit: git(pfad, "rev-parse", "HEAD") };
}

test("vorbereitung-festhalten, vorbereitung-pruefen und --verwerfen als Prozess", () => {
  const s = setup();
  const env = { KIT_NIGHT_RUN: "2026-10-07T01:00:00.000Z", KIT_STAND: "abc123" };

  const fest = werkzeug(s.repo, env, "vorbereitung-festhalten", s.pfad, "--ergebnis", "gruen", "--offen", "Sichtpruefung der Oberflaeche", "--fetch", "fehlgeschlagen");
  assert.equal(fest.status, 0, JSON.stringify(fest.stand));
  assert.equal(fest.stand.ok, true);
  assert.equal(fest.stand.ergebnis, "gruen-offen");
  assert.equal(fest.stand.commit, s.commit);
  assert.equal(fest.stand.version, "2.0.0");
  assert.deepEqual(fest.stand.offen, ["Sichtpruefung der Oberflaeche"]);
  assert.deepEqual(fest.stand.pakete, ["21"]);
  assert.equal(fest.stand.fetch, "fehlgeschlagen");
  assert.equal(fest.stand.laufId, "2026-10-07T01:00:00.000Z");
  assert.equal(fest.stand.kitStand, "abc123");
  assert.ok(existsSync(join(s.repo, ".claude", "push-vorbereitung.json")));

  const urteil = werkzeug(s.repo, {}, "vorbereitung-pruefen");
  assert.equal(urteil.status, 0);
  assert.deepEqual(urteil.stand, {
    ok: true, uebernehmen: true, grund: null, commit: s.commit, offen: ["Sichtpruefung der Oberflaeche"], zeitpunkt: fest.stand.zeitpunkt,
  });

  const weg = werkzeug(s.repo, {}, "vorbereitung-pruefen", "--verwerfen");
  assert.equal(weg.status, 0);
  assert.deepEqual(weg.stand, { ok: true, verworfen: { datei: true, referenz: true } });
  assert.equal(existsSync(join(s.repo, ".claude", "push-vorbereitung.json")), false);
});

test("vorbereitung-festhalten ohne --ergebnis endet mit Exit 1 und Grund", () => {
  const s = setup();
  const res = werkzeug(s.repo, {}, "vorbereitung-festhalten", s.pfad);
  assert.equal(res.status, 1);
  assert.equal(res.stand.ok, false);
  assert.match(res.stand.fehler, /--ergebnis/);
});
