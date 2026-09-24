// Der Worktree einer Nacht-Kette (Plan #638, A3; Issue #642).
//
// Die Kette arbeitet ausserhalb des Repos, unter dem Temp-Verzeichnis: Im Repo laege der
// Worktree als untracked Verzeichnis im `git status` der Umsetzungsnacht. `.claude/` ist
// nicht versioniert; der Runner spiegelt es hinein — ohne `night-run-*`. Liegengebliebene
// Worktrees eines Absturzes raeumt der naechste Start auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { worktreeAnlegen, worktreeEntfernen, worktreesAufraeumen } from "../kit/night.mjs";

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

test("[night-68] der Spiegel filtert nur direkt unter .claude/ — Werkzeuge unter .claude/kit/ kommen alle mit", () => {
  mitRepo((dir, angelegt) => {
    // Die Kit-Kopie traegt Werkzeuge, deren Namen wie die Berichte der Hauptkopie
    // beginnen. Ein Filter ueber den blossen Dateinamen liesse sie zurueck, und eine
    // Kettenstufe im Worktree riefe ins Leere.
    for (const werkzeug of ["aufwand.mjs", "wirksamkeit.mjs", "befunde.mjs"]) {
      writeFileSync(join(dir, ".claude", "kit", werkzeug), `// ${werkzeug}\n`);
    }
    // Und die Berichte, die in der Hauptkopie bleiben sollen — direkt unter `.claude/`.
    for (const bericht of ["aufwand.md", "aufwand.json", "wirksamkeit.md", "wirksamkeit.json", "bewegungen.tsv", "ausfuehrungen.tsv"]) {
      writeFileSync(join(dir, ".claude", bericht), `stand ${bericht}\n`);
    }

    const pfad = worktreeAnlegen({ repoRoot: dir, issueId: "824", stempel: "2026-09-21-010203" });
    angelegt.push(pfad);

    for (const werkzeug of ["board.mjs", "aufwand.mjs", "wirksamkeit.mjs", "befunde.mjs"]) {
      assert.ok(existsSync(join(pfad, ".claude", "kit", werkzeug)), `.claude/kit/${werkzeug} fehlt im Worktree`);
    }
    for (const bericht of ["aufwand.md", "aufwand.json", "wirksamkeit.md", "wirksamkeit.json", "bewegungen.tsv", "ausfuehrungen.tsv"]) {
      assert.ok(!existsSync(join(pfad, ".claude", bericht)), `.claude/${bericht} darf nicht in den Worktree`);
    }
  });
});

test("[night-68] ein Unterverzeichnis mit dem Namen eines Berichts kommt mit", () => {
  mitRepo((dir, angelegt) => {
    // `.claude/night-run-*` bleibt zurueck, aber nur direkt unter `.claude/`: Ein
    // gleichnamiger Pfad eine Ebene tiefer ist eine andere Datei.
    mkdirSync(join(dir, ".claude", "kit", "night-run-hilfen"), { recursive: true });
    writeFileSync(join(dir, ".claude", "kit", "night-run-hilfen", "x.mjs"), "// hilfe\n");

    const pfad = worktreeAnlegen({ repoRoot: dir, issueId: "824", stempel: "2026-09-21-010204" });
    angelegt.push(pfad);

    assert.ok(existsSync(join(pfad, ".claude", "kit", "night-run-hilfen", "x.mjs")),
      "nur der Name direkt unter .claude/ entscheidet, nicht der Name irgendwo im Pfad");
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

test("[night-908] worktreeAnlegen legt mit dem Praefix pruefung einen eigenen Ordner an", () => {
  mitRepo((dir, angelegt) => {
    const pfad = worktreeAnlegen({ repoRoot: dir, issueId: "908", stempel: "2026-09-24-010203", praefix: "pruefung" });
    angelegt.push(pfad);
    assert.ok(pfad.startsWith(join(tmpdir(), `pruefung-${basename(dir)}-908-`)), `unerwarteter Pfad: ${pfad}`);
    assert.ok(existsSync(join(pfad, ".claude", "kit", "board.mjs")), "der Spiegel gilt unveraendert");
  });
});

test("[night-908] worktreesAufraeumen raeumt nur den Praefix ab, der uebergeben wurde", () => {
  mitRepo((dir, angelegt) => {
    const kette = worktreeAnlegen({ repoRoot: dir, issueId: "1", stempel: "alt" });
    angelegt.push(kette);
    const pruefung = worktreeAnlegen({ repoRoot: dir, issueId: "2", stempel: "alt", praefix: "pruefung" });
    angelegt.push(pruefung);

    assert.deepEqual(worktreesAufraeumen(dir, "pruefung"), [pruefung],
      "nur der Worktree des uebergebenen Praefixes wird entfernt");
    assert.ok(!existsSync(pruefung));
    assert.ok(existsSync(kette), "der Worktree der laufenden Kette bleibt unberuehrt");

    assert.deepEqual(worktreesAufraeumen(dir), [kette],
      "ohne Argument raeumt der Vorgabewert kette genau die Kette ab");
    assert.ok(!existsSync(kette));
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
