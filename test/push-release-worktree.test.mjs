// Der Worktree der Release-Skills (Issue #929).
//
// `/push-main` und `/merge-production` erzeugten Release-Dateien, fuhren den Prueflauf und
// committeten im Haupt-Working-Tree — demselben Baum, in dem unter Variante B die
// Umsetzungsstufe des Nacht-Runners baut. Am 2026-09-25 riss das in kanban-kit zweimal die
// Kette ab: Der Runner fand die Release-Dateien als unkommittierte Reste und stoppte hart.
//
// Seither laufen beide Skills in einem eigenen Worktree, und `kit/worktree.mjs` ist ihre
// Tuer zu derselben Vorbereitung, die die Kette benutzt (`worktreeAnlegen` in night.mjs) —
// kein zweiter Weg, einen Worktree anzulegen.
//
// Der Dateiname beginnt mit `push-`, damit die Pflichtpruefung des Bereichs `skills-doku`
// ihn mitfaehrt (Muster `test/push-*.test.mjs`): Ein Test, den kein buildCheck aufruft,
// laeuft nur, solange jemand von Hand daran denkt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WERKZEUG = join(repoRoot, "kit", "worktree.mjs");

function git(cwd, ...a) {
  const res = spawnSync("git", a, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

/** Ruft das Werkzeug im Fixture und liefert Exitcode und das JSON der LETZTEN Zeile. */
function werkzeug(cwd, ...cliArgs) {
  const res = spawnSync(process.execPath, [WERKZEUG, ...cliArgs], { cwd, encoding: "utf-8" });
  const zeilen = res.stdout.split("\n").filter((z) => z.trim() !== "");
  let stand = null;
  if (zeilen.length > 0) {
    try {
      stand = JSON.parse(zeilen.at(-1));
    } catch {
      assert.fail(`keine JSON-Ausgabe: ${res.stdout}${res.stderr}`);
    }
  }
  return { status: res.status, stand, stderr: res.stderr };
}

/** Ein Repo mit zwei Commits, einem zweiten Ref und einem `.claude/` voller Lokalzustand. */
function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "releaserepo-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
  writeFileSync(join(dir, ".claude", "workflow.config.json"), "{\"codeHost\":\"local\",\"issueTracker\":\"local\"}\n");
  writeFileSync(join(dir, "VERSION"), "1.0.0\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "erster");
  git(dir, "branch", "veroeffentlicht");
  writeFileSync(join(dir, "VERSION"), "1.1.0\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "zweiter");
  // Lokalzustand, der NICHT im Repo liegt: Kit-Kopie, Token, Protokolle.
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), "// kopie\n");
  writeFileSync(join(dir, ".claude", "tbx.token"), "geheim\n");
  writeFileSync(join(dir, ".claude", "night-run-2026-09-25.log"), "protokoll\n");
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

test("[release-1] anlegen setzt auf dem uebergebenen Ref auf und spiegelt .claude einschliesslich kit/", () => {
  mitRepo((dir, angelegt) => {
    const { status, stand } = werkzeug(dir, "anlegen", "--praefix", "release", "--ref", "veroeffentlicht");
    assert.equal(status, 0, `anlegen schlug fehl: ${JSON.stringify(stand)}`);
    assert.equal(stand.ok, true);
    angelegt.push(stand.pfad);

    assert.ok(stand.pfad.startsWith(join(tmpdir(), `release-${basename(dir)}-`)), `unerwarteter Pfad: ${stand.pfad}`);
    assert.ok(!stand.pfad.startsWith(dir), "der Worktree darf nicht im Repo liegen");
    // Der Ref entscheidet den Stand: `veroeffentlicht` traegt noch 1.0.0.
    assert.equal(readFileSync(join(stand.pfad, "VERSION"), "utf-8").replaceAll("\r\n", "\n"), "1.0.0\n");
    for (const datei of ["kit/board.mjs", "tbx.token", "workflow.config.json"]) {
      assert.ok(existsSync(join(stand.pfad, ".claude", datei)), `.claude/${datei} fehlt im Worktree`);
    }
    assert.ok(!existsSync(join(stand.pfad, ".claude", "night-run-2026-09-25.log")), "das Protokoll bleibt in der Hauptkopie");
    assert.equal(git(dir, "status", "--porcelain").trim(), "", "die Hauptkopie bleibt sauber");
  });
});

test("[release-1] anlegen ohne --ref nimmt HEAD", () => {
  mitRepo((dir, angelegt) => {
    const { stand } = werkzeug(dir, "anlegen", "--praefix", "release");
    angelegt.push(stand.pfad);
    assert.equal(readFileSync(join(stand.pfad, "VERSION"), "utf-8").replaceAll("\r\n", "\n"), "1.1.0\n");
  });
});

test("[release-1] anlegen raeumt liegengebliebene Worktrees desselben Praefixes auf, fremde nicht", () => {
  mitRepo((dir, angelegt) => {
    const alt = werkzeug(dir, "anlegen", "--praefix", "release").stand.pfad;
    angelegt.push(alt);
    const kette = werkzeug(dir, "anlegen", "--praefix", "kette").stand.pfad;
    angelegt.push(kette);

    const neu = werkzeug(dir, "anlegen", "--praefix", "release").stand.pfad;
    angelegt.push(neu);

    assert.ok(!existsSync(alt), "der liegengebliebene Release-Worktree ist nicht abgeraeumt");
    assert.ok(existsSync(kette), "der Worktree einer laufenden Kette darf nicht mitgerissen werden");
    assert.ok(existsSync(neu));
  });
});

test("[release-1] entfernen loescht Ordner und Eintrag", () => {
  mitRepo((dir, angelegt) => {
    const pfad = werkzeug(dir, "anlegen", "--praefix", "release").stand.pfad;
    angelegt.push(pfad);

    const { status, stand } = werkzeug(dir, "entfernen", pfad);
    assert.equal(status, 0);
    assert.equal(stand.entfernt, pfad);
    assert.ok(!existsSync(pfad));
    assert.doesNotMatch(git(dir, "worktree", "list"), /release-/, "der Eintrag steht noch in git worktree list");
    assert.equal(git(dir, "status", "--porcelain").trim(), "");
  });
});

test("[release-1] eine fremde Aenderung im Haupt-Tree bleibt dort und geht in keinen Prueflauf ein", () => {
  mitRepo((dir, angelegt) => {
    // Genau die Lage des Vorfalls: Waehrend des Release baut im Haupt-Tree jemand anders.
    // Ein absichtlich roter, unversionierter Test darf den Release-Prueflauf nicht erreichen.
    writeFileSync(join(dir, "rot.test.mjs"), "throw new Error('rot');\n");
    writeFileSync(join(dir, "VERSION"), "1.1.0-wip\n");
    const vorher = git(dir, "status", "--porcelain");

    const pfad = werkzeug(dir, "anlegen", "--praefix", "release", "--ref", "HEAD").stand.pfad;
    angelegt.push(pfad);
    assert.ok(!existsSync(join(pfad, "rot.test.mjs")), "die fremde, unversionierte Datei ist im Worktree");
    assert.equal(readFileSync(join(pfad, "VERSION"), "utf-8").replaceAll("\r\n", "\n"), "1.1.0\n",
      "der Worktree traegt den committeten Stand, nicht die fremde Aenderung");

    werkzeug(dir, "entfernen", pfad);
    assert.equal(git(dir, "status", "--porcelain"), vorher,
      "der Haupt-Working-Tree sieht vor und nach dem Lauf gleich aus");
  });
});

test("[release-1] entfernen zielt auch aus dem Worktree heraus auf den Worktree", () => {
  mitRepo((dir, angelegt) => {
    const pfad = werkzeug(dir, "anlegen", "--praefix", "release").stand.pfad;
    angelegt.push(pfad);

    // Der Skill arbeitet im Worktree; `--show-toplevel` liefert dort DEN WORKTREE, und ein
    // Abbau haette auf sich selbst gezielt statt auf den Eintrag in der Hauptkopie.
    const { status, stand } = werkzeug(pfad, "entfernen", pfad);
    assert.equal(status, 0, `entfernen schlug fehl: ${JSON.stringify(stand)}`);
    assert.ok(!existsSync(pfad));
    assert.doesNotMatch(git(dir, "worktree", "list"), /release-/);
  });
});

test("[release-1] ein unbekanntes Kommando endet mit Exit 1 und einem Fehler im JSON", () => {
  mitRepo((dir) => {
    const { status, stand } = werkzeug(dir, "abreissen");
    assert.equal(status, 1);
    assert.equal(stand.ok, false);
    assert.match(stand.fehler, /abreissen/);
  });
});

// --- Die Nachziehpruefung ---

test("[release-2] nachziehen-pruefen sagt ja im sauberen Baum ohne Sperre", () => {
  mitRepo((dir) => {
    const { status, stand } = werkzeug(dir, "nachziehen-pruefen");
    assert.equal(status, 0);
    assert.equal(stand.nachziehen, true, `unerwarteter Grund: ${stand.grund}`);
    assert.equal(stand.grund, null);
  });
});

test("[release-2] nachziehen-pruefen sagt nein, solange eine Sperre mit lebender Prozess-Id liegt", () => {
  mitRepo((dir) => {
    writeFileSync(join(dir, ".claude", "night-umsetzung.lock"), `${process.pid}\n`);
    const { stand } = werkzeug(dir, "nachziehen-pruefen");
    assert.equal(stand.nachziehen, false);
    assert.match(stand.grund, /night-umsetzung\.lock/);

    // Eine verwaiste Sperre haelt nichts auf: Die Prozess-Id gehoert niemandem mehr.
    writeFileSync(join(dir, ".claude", "night-umsetzung.lock"), "2147483647\n");
    assert.equal(werkzeug(dir, "nachziehen-pruefen").stand.nachziehen, true);
  });
});

test("[release-2] nachziehen-pruefen sagt nein im schmutzigen Haupt-Tree, aber nicht wegen Protokollen", () => {
  mitRepo((dir) => {
    // Protokolle und Board-Zustand sind kein Code-Zustand — dieselben Ausnahmen wie beim
    // Rest-Guard des Runners.
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "929.json"), "{}\n");
    writeFileSync(join(dir, ".claude", "wegmarken.tsv"), "zug\n");
    assert.equal(werkzeug(dir, "nachziehen-pruefen").stand.nachziehen, true);

    writeFileSync(join(dir, "VERSION"), "9.9.9\n");
    const { stand } = werkzeug(dir, "nachziehen-pruefen");
    assert.equal(stand.nachziehen, false);
    assert.match(stand.grund, /VERSION/);
  });
});

// --- Der Rueckweg aus dem Worktree ---

test("[release-3] rueckweg holt Zusammenfassung, Ausfuehrungsprotokoll und Befunde in die Hauptkopie", () => {
  mitRepo((dir, angelegt) => {
    writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify({ ergebnis: "alt" }) + "\n");
    writeFileSync(join(dir, ".claude", "ausfuehrungen.tsv"), "2026-09-24T00:00:00.000Z\tnode --test\tgruen\t10\n");
    writeFileSync(join(dir, ".claude", "befunde.tsv"), "alt\tzeile\tmit\tsieben\tspalten\tund\tmehr\n");

    const pfad = werkzeug(dir, "anlegen", "--praefix", "release").stand.pfad;
    angelegt.push(pfad);
    // Was der Prueflauf im Worktree hinterlaesst.
    writeFileSync(join(pfad, ".claude", "checks-summary.json"), JSON.stringify({ ergebnis: "neu" }) + "\n");
    writeFileSync(join(pfad, ".claude", "ausfuehrungen.tsv"), "2026-09-25T00:00:00.000Z\tnode --test\tgruen\t20\n");
    writeFileSync(join(pfad, ".claude", "befunde.tsv"), "neu\tzeile\tmit\tsieben\tspalten\tund\tmehr\n");

    const { status, stand } = werkzeug(dir, "rueckweg", pfad);
    assert.equal(status, 0, `rueckweg schlug fehl: ${JSON.stringify(stand)}`);
    assert.equal(stand.zusammenfassung, true);
    assert.equal(stand.ausfuehrungen, 1, "eine Zeile des Worktrees kommt zurueck");

    assert.equal(JSON.parse(readFileSync(join(dir, ".claude", "checks-summary.json"), "utf-8")).ergebnis, "neu",
      "die Zusammenfassung des Worktrees ersetzt die alte — sie bezeugt den Stand, der gerade gemessen wurde");
    const ausfuehrungen = readFileSync(join(dir, ".claude", "ausfuehrungen.tsv"), "utf-8").split("\n").filter((z) => z !== "");
    assert.equal(ausfuehrungen.length, 2, "angehaengt, nicht ersetzt");
    const befunde = readFileSync(join(dir, ".claude", "befunde.tsv"), "utf-8").split("\n").filter((z) => z !== "");
    assert.equal(befunde.length, 2, "die Befunde des Worktrees kommen angehaengt zurueck");
  });
});

test("[release-3] rueckweg ohne Dateien im Worktree laesst die Hauptkopie unberuehrt", () => {
  mitRepo((dir, angelegt) => {
    writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify({ ergebnis: "alt" }) + "\n");
    const pfad = werkzeug(dir, "anlegen", "--praefix", "release").stand.pfad;
    angelegt.push(pfad);
    rmSync(join(pfad, ".claude", "checks-summary.json"), { force: true });

    const { status, stand } = werkzeug(dir, "rueckweg", pfad);
    assert.equal(status, 0);
    assert.equal(stand.zusammenfassung, false);
    assert.equal(stand.ausfuehrungen, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, ".claude", "checks-summary.json"), "utf-8")).ergebnis, "alt");
  });
});

// --- Auslieferung ---

test("[release-4] worktree.mjs wird gestempelt und ausgeliefert", () => {
  const quelle = readFileSync(WERKZEUG, "utf-8");
  assert.match(quelle, /const KIT_VERSION = "\d+\.\d+\.\d+";/, "der Versions-Stempel fehlt");

  const sync = readFileSync(join(repoRoot, "tools", "sync-blobs.mjs"), "utf-8");
  assert.match(sync, /WORKTREE_MJS_B64/, "die Datei steht nicht im Blob-Register");
  assert.match(sync, /const STAMPED = \[[^\]]*"worktree\.mjs"/, "die Datei steht nicht in STAMPED — ohne das entstuende die Dogfooding-Kopie nie");

  const install = readFileSync(join(repoRoot, "install.mjs"), "utf-8");
  assert.match(install, /const WORKTREE_MJS_B64 = "/, "install.mjs traegt keinen Blob");
  assert.match(install, /worktree\.mjs geschrieben/, "der Installer schreibt die Datei nicht aus");

  // Die installierten Skills rufen `.claude/kit/worktree.mjs`; eine Datei, die nur im
  // Kit-Repo liegt, ginge in jedem Zielprojekt ins Leere (dieselbe Luecke wie #425).
  for (const skill of ["push-main", "merge-production"]) {
    const text = readFileSync(join(repoRoot, "skills", skill, "SKILL.md"), "utf-8");
    assert.match(text, /node \.claude\/kit\/worktree\.mjs anlegen/, `${skill} legt keinen Worktree an`);
    assert.match(text, /node \.claude\/kit\/worktree\.mjs entfernen/, `${skill} baut den Worktree nicht ab`);
    assert.match(text, /node \.claude\/kit\/worktree\.mjs rueckweg/, `${skill} holt nichts aus dem Worktree zurueck`);
    assert.match(text, /node \.claude\/kit\/worktree\.mjs nachziehen-pruefen/, `${skill} prueft das Nachziehen nicht`);
    // Ein frischer Worktree traegt keine installierten Abhaengigkeiten. Ohne diesen Absatz
    // faellt ein Pflichtcheck dort aus einem Grund um, der nichts mit dem Stand zu tun hat.
    const absatz = text.split("\n\n").find((a) => a.includes("Abhängigkeiten im frischen Worktree"));
    assert.ok(absatz, `${skill} sagt nichts zu den Abhaengigkeiten im Worktree`);
    assert.match(absatz, /nie als grüner Lauf gemeldet/, `${skill} laesst die fehlende Installation als gruen durchgehen`);
  }
});

test("[release-4] die Praefixe der Nacht bleiben unberuehrt liegen", () => {
  // Ein Release, das `kette` oder `pruefung` abraeumte, zerstoerte den Worktree eines
  // laufenden Nacht-Laufs. Der Praefix steht darum im Aufruf und nicht in einer Vorgabe,
  // die man vergessen kann.
  const quelle = readFileSync(WERKZEUG, "utf-8");
  assert.doesNotMatch(quelle, /worktreesAufraeumen\(\s*repoRoot\s*\)/,
    "ohne zweites Argument raeumt worktreesAufraeumen den Praefix kette ab");
});
