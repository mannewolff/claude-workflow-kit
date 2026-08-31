// Test fuer den Release-Ablauf gegen ein Wegwerf-Repo (Issue #265).
//
// Der reine parseVersions-Test kann nicht zeigen, was hier schiefging: Der
// Changelog wurde VOR dem Version-Commit erzeugt und war damit in dem Moment
// veraltet, in dem er committet wurde. Das faellt erst auf, wenn man den ganzen
// Ablauf einmal faehrt — mit echten Commits, in der Reihenfolge aus RELEASING.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = join(repoRoot, "tools", "changelog.mjs");

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

/** Leeres Repo mit Identitaet und der Startmarke, ab der changelog.mjs liest. */
function wegwerfRepo() {
  const dir = mkdtempSync(join(tmpdir(), "changelog-ablauf-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "datei.txt"), "start\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: v1.16.0");
  return dir;
}

function commit(dir, betreff, inhalt = String(Math.random())) {
  writeFileSync(join(dir, "datei.txt"), inhalt + "\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", betreff);
}

const changelog = (dir, ...args) =>
  execFileSync(process.execPath, [CHANGELOG, ...args], { cwd: dir, encoding: "utf-8" });

/** changelog --check als Wahrheitswert, ohne den Test bei Exit 1 abzubrechen. */
function checkGruen(dir) {
  try {
    changelog(dir, "--check");
    return true;
  } catch {
    return false;
  }
}

test("nach dem Ablauf aus RELEASING.md ist --check gruen — ohne Force-Push", () => {
  const dir = wegwerfRepo();
  try {
    commit(dir, "Ein Feature (Issue #1)");

    // Der Ablauf: Bump-Commit ZUERST, Changelog danach, per --amend hinein.
    commit(dir, "chore: v1.16.1");
    changelog(dir);
    git(dir, "add", "CHANGELOG.md");
    git(dir, "commit", "-q", "--amend", "--no-edit");

    assert.ok(checkGruen(dir), "--check ist direkt nach dem Release-Commit rot");
    const inhalt = readFileSync(join(dir, "CHANGELOG.md"), "utf-8");
    assert.match(inhalt, /## \[1\.16\.1\]/, "die frisch gebumpte Version fehlt im Changelog");
    assert.match(inhalt, /Ein Feature \(#1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("die alte Reihenfolge zeigt den Fehler — Changelog vor dem Commit", () => {
  // Regressionsschutz fuer die Begruendung in RELEASING.md: Wer den Changelog
  // wieder vor den Version-Commit zieht, bekommt genau diesen roten Check zurueck.
  const dir = wegwerfRepo();
  try {
    commit(dir, "Ein Feature (Issue #1)");
    changelog(dir);                       // vor der Marke — kennt sie noch nicht
    git(dir, "add", "CHANGELOG.md");
    git(dir, "commit", "-q", "-m", "chore: v1.16.1");
    assert.equal(checkGruen(dir), false, "die alte Reihenfolge muesste rot sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein Commit nach dem Release erzeugt keinen zweiten Block mit derselben Nummer", () => {
  const dir = wegwerfRepo();
  try {
    commit(dir, "Ein Feature (Issue #1)");
    commit(dir, "chore: v1.16.1");
    changelog(dir);
    git(dir, "add", "CHANGELOG.md");
    git(dir, "commit", "-q", "--amend", "--no-edit");

    commit(dir, "Danach (Issue #2)");
    changelog(dir);
    const ueberschriften = (readFileSync(join(dir, "CHANGELOG.md"), "utf-8").match(/^## \[.*?\]/gm) || []);
    assert.deepEqual(ueberschriften, ["## [Unreleased]", "## [1.16.1]"]);
    assert.equal(new Set(ueberschriften).size, ueberschriften.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Die beiden Wege, auf denen das Werkzeug gar nicht arbeiten kann (Issue #405) ---

test("--check ohne vorhandene CHANGELOG.md meldet 'nicht aktuell' statt zu crashen", () => {
  const dir = wegwerfRepo();
  try {
    commit(dir, "Ein Feature (Issue #1)");
    commit(dir, "chore: v1.16.1");
    // Es wurde nie ein Changelog geschrieben: Der Vergleich laeuft gegen den leeren
    // Text. Das ist der Zustand eines frisch aufgesetzten Projekts, und er muss als
    // "nicht aktuell" enden — nicht als Lesefehler.
    assert.equal(existsSync(join(dir, "CHANGELOG.md")), false, "das Fixture bringt schon ein Changelog mit");

    let fehler = null;
    try {
      changelog(dir, "--check");
    } catch (e) {
      fehler = e;
    }

    assert.ok(fehler, "--check haette ohne Changelog nicht gruen sein duerfen");
    assert.equal(fehler.status, 1, "erwartet wird der regulaere Fehler-Exit, kein Absturz");
    assert.match(String(fehler.stderr), /CHANGELOG\.md ist nicht aktuell/,
      "die Meldung nennt weder Datei noch Abhilfe");
    assert.equal(existsSync(join(dir, "CHANGELOG.md")), false, "--check darf nichts anlegen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ausserhalb eines git-Repos bricht changelog mit der git-Meldung ab", () => {
  // Kein `git init`: `git log` scheitert, und die eigene Meldung des Werkzeugs muss
  // die von git mitfuehren — sonst sucht man den Fehler im Changelog statt im Repo.
  const dir = mkdtempSync(join(tmpdir(), "changelog-ohne-repo-"));
  try {
    let fehler = null;
    try {
      // LC_ALL=C erzwingt die englische git-Meldung: Sonst haengt der Test an der
      // Sprache der Maschine — lokal deutsch, in der CI englisch.
      execFileSync(process.execPath, [CHANGELOG], {
        cwd: dir, encoding: "utf-8", env: { ...process.env, LC_ALL: "C", LANG: "C" },
      });
    } catch (e) {
      fehler = e;
    }

    assert.ok(fehler, "ohne git-Repo haette changelog nicht durchlaufen duerfen");
    assert.match(String(fehler.stderr), /git .* schlug fehl/, "die eigene Meldung fehlt");
    assert.match(String(fehler.stderr), /not a git repository/i,
      "die Meldung von git selbst fehlt — ohne sie ist die Ursache nicht zuzuordnen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
