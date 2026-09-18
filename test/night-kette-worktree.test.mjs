// Der Worktree einer Nacht-Kette (Plan #638, A3; Issue #642).
//
// Die Kette arbeitet ausserhalb des Repos, unter dem Temp-Verzeichnis: Im Repo laege der
// Worktree als untracked Verzeichnis im `git status` der Umsetzungsnacht. `.claude/` ist
// nicht versioniert; der Runner spiegelt es hinein — ohne `night-run-*` — und holt
// wartende Vorhaben-Notizen zurueck, bevor er den Worktree entfernt. Liegengebliebene
// Worktrees eines Absturzes raeumt der naechste Start auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { worktreeAnlegen, notizenZurueck, worktreeEntfernen, worktreesAufraeumen } from "../kit/night.mjs";

function git(cwd, ...a) {
  const res = spawnSync("git", a, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

/** Ein Repo mit Commit, einer versionierten Datei und einem `.claude/` voller Lokalzustand. */
function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "nachtrepo-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
  writeFileSync(join(dir, ".claude", "workflow.config.json"), "{\"codeHost\":\"local\",\"issueTracker\":\"local\"}\n");
  writeFileSync(join(dir, "README.md"), "hallo\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  // Lokalzustand, der NICHT im Repo liegt: Kit-Kopie, Token, Settings, Protokoll.
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), "// kopie\n");
  writeFileSync(join(dir, ".claude", "settings.local.json"), "{}\n");
  writeFileSync(join(dir, ".claude", "tbx.token"), "geheim\n");
  writeFileSync(join(dir, ".claude", "night-run-2026-09-14.log"), "protokoll\n");
  writeFileSync(join(dir, ".claude", "night-run-2026-09-14-010203.json"), "{}\n");
  return dir;
}

function mitRepo(fn) {
  const dir = setupRepo();
  const angelegt = [];
  try {
    fn(dir, angelegt);
  } finally {
    for (const p of angelegt) rmSync(p, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[night-17] worktreeAnlegen legt den Worktree unter dem Temp-Verzeichnis an und spiegelt .claude ohne night-run-*", () => {
  mitRepo((dir, angelegt) => {
    const pfad = worktreeAnlegen({ repoRoot: dir, issueId: "635", stempel: "2026-09-14-010203" });
    angelegt.push(pfad);
    assert.ok(pfad.startsWith(join(tmpdir(), `kette-${basename(dir)}-635-`)), `unerwarteter Pfad: ${pfad}`);
    assert.ok(!pfad.startsWith(dir), "der Worktree darf nicht im Repo liegen");
    // Zeilenenden normalisiert: Git auf Windows-Runnern checkt mit CRLF aus; geprueft wird
    // der Stand von HEAD, nicht die Zeilenenden.
    assert.equal(readFileSync(join(pfad, "README.md"), "utf-8").replaceAll("\r\n", "\n"), "hallo\n", "der Worktree traegt den Stand von HEAD");
    for (const datei of ["kit/board.mjs", "settings.local.json", "tbx.token", "workflow.config.json"]) {
      assert.ok(existsSync(join(pfad, ".claude", datei)), `.claude/${datei} fehlt im Worktree`);
    }
    for (const datei of ["night-run-2026-09-14.log", "night-run-2026-09-14-010203.json"]) {
      assert.ok(!existsSync(join(pfad, ".claude", datei)), `.claude/${datei} darf nicht mitkommen`);
    }
    assert.equal(git(dir, "status", "--porcelain").trim(), "", "die Hauptkopie bleibt sauber");
    const liste = git(dir, "worktree", "list").replaceAll("\\", "/");
    const erwartet = realpathSync.native(pfad).replaceAll("\\", "/");
    assert.ok(liste.includes(erwartet), `Pfad ${erwartet} nicht in Worktree-Liste: ${liste}`);
  });
});

test("[night-17] notizenZurueck kopiert wartende Vorhaben-Notizen in die Hauptkopie", () => {
  mitRepo((dir, angelegt) => {
    const pfad = worktreeAnlegen({ repoRoot: dir, issueId: "635", stempel: "s1" });
    angelegt.push(pfad);
    writeFileSync(join(pfad, ".claude", "vorhaben-wartend-plan-9.md"), "notiz\n");
    writeFileSync(join(pfad, ".claude", "anderes.md"), "nicht\n");
    assert.deepEqual(notizenZurueck(pfad, dir), ["vorhaben-wartend-plan-9.md"]);
    assert.equal(readFileSync(join(dir, ".claude", "vorhaben-wartend-plan-9.md"), "utf-8"), "notiz\n");
    assert.ok(!existsSync(join(dir, ".claude", "anderes.md")), "nur Notizen kommen zurueck");
    assert.deepEqual(notizenZurueck(join(dir, "gibt-es-nicht"), dir), [], "ohne .claude gibt es nichts zu kopieren");
  });
});

test("[night-17] worktreeEntfernen loescht Ordner und Eintrag", () => {
  mitRepo((dir, angelegt) => {
    const pfad = worktreeAnlegen({ repoRoot: dir, issueId: "635", stempel: "s2" });
    angelegt.push(pfad);
    worktreeEntfernen(pfad, dir);
    assert.ok(!existsSync(pfad), "der Ordner liegt noch");
    assert.doesNotMatch(git(dir, "worktree", "list"), /kette-/, "der Eintrag steht noch in git worktree list");
    assert.equal(git(dir, "status", "--porcelain").trim(), "");
  });
});

test("[night-17] worktreesAufraeumen entfernt liegengebliebene Worktrees dieses Repos, fremde nicht", () => {
  mitRepo((dir, angelegt) => {
    const eigener = worktreeAnlegen({ repoRoot: dir, issueId: "1", stempel: "alt" });
    angelegt.push(eigener);
    // Ein "toter" Worktree: Ordner weg, Eintrag noch da — wie nach einem Absturz.
    const toter = worktreeAnlegen({ repoRoot: dir, issueId: "2", stempel: "tot" });
    angelegt.push(toter);
    rmSync(toter, { recursive: true, force: true });
    const fremd = mkdtempSync(join(tmpdir(), "kette-anderesrepo-7-"));
    angelegt.push(fremd);

    const entfernt = worktreesAufraeumen(dir);
    assert.deepEqual(entfernt.sort(), [eigener].sort(), "genau der liegengebliebene eigene Worktree wird entfernt");
    assert.ok(!existsSync(eigener));
    assert.ok(existsSync(fremd), "ein Ordner mit fremdem Praefix bleibt");
    assert.doesNotMatch(git(dir, "worktree", "list"), /kette-/, "auch der tote Eintrag ist geprunt");
    assert.ok(!readdirSync(tmpdir()).some((n) => n.startsWith(`kette-${basename(dir)}-`)));
  });
});

test("[night-17] worktreeAnlegen wirft mit der git-Meldung, wenn kein Repo vorliegt", () => {
  const kein = mkdtempSync(join(tmpdir(), "kette-kein-repo-"));
  try {
    assert.throws(() => worktreeAnlegen({ repoRoot: kein, issueId: "1", stempel: "x" }), /git worktree add schlug fehl/);
  } finally {
    rmSync(kein, { recursive: true, force: true });
  }
});
