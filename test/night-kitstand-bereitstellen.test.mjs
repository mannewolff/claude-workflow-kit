// Der feste Kit-Stand eines unbeaufsichtigten Laufs (Issue #1102, Plan #1101): ermitteln,
// bereitstellen, einsetzen, freigeben — und die Erkennung des Kindes.
//
// Der Stand ist der Commit, auf den `refs/remotes/origin/<mainBranch>` beim Start zeigt
// (E1, ohne `git fetch`). Er greift nur, wenn dieser Commit die Kit-Quelle selbst traegt
// (E3); andere Projekte laufen unveraendert. Kann er nicht bereitgestellt werden, bricht
// der Lauf ab, statt still auf die Kopie der Hauptkopie zurueckzufallen (E2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

// Der Runner faehrt ueber die Sitzungen `checks.mjs run`: ein eigener Sperrpfad je Testprozess (Issue #958).
import "./helpers/checks-sperre.mjs";

import {
  kitStandErmitteln, kitStandBereitstellen, kitStandEinsetzen, kitStandFreigeben, istStandKind,
  KIT_STAND_MARKIERUNG,
} from "../kit/night.mjs";
import {
  NUR_POSIX, kitFixture, git, runner, laufStand, standWorktrees, aufraeumen,
} from "./helpers/kitstand-fixture.mjs";

function mitFixture(optionen, fn) {
  const fx = kitFixture(optionen);
  try {
    return fn(fx);
  } finally {
    aufraeumen(fx);
  }
}

// --- Ermitteln (E1, E3) ---

test("[kitstand-1] der Stand ist der lokale Verweis origin/main — ein spaeterer Push ohne fetch aendert ihn nicht", () => {
  mitFixture({}, ({ dir, origin }) => {
    const vorher = git(dir, "rev-parse", "refs/remotes/origin/main");
    // Ein zweiter Klon pusht weiter; die Hauptkopie holt nichts.
    const klon = mkdtempSync(join(tmpdir(), "kitstand-klon-"));
    try {
      git(klon, "clone", "-q", origin, ".");
      git(klon, "config", "user.email", "t@example.invalid");
      git(klon, "config", "user.name", "T");
      writeFileSync(join(klon, "neu.txt"), "neu\n");
      git(klon, "add", "neu.txt");
      git(klon, "commit", "-q", "-m", "neu");
      git(klon, "push", "-q", "origin", "main");
    } finally {
      rmSync(klon, { recursive: true, force: true });
    }

    const stand = kitStandErmitteln(dir, "main");
    assert.equal(stand.commit, vorher, "gelesen wird der lokale Verweis, kein fetch");
    assert.equal(stand.ref, "origin/main");
    assert.equal(stand.commitZeit, git(dir, "show", "-s", "--format=%cI", vorher));
  });
});

test("[kitstand-1] traegt der Commit unter origin keine Kit-Quelle, greift der Mechanismus nicht", () => {
  mitFixture({ mitKitQuelle: false }, ({ dir }) => {
    assert.equal(kitStandErmitteln(dir, "main"), null);
  });
});

test("[kitstand-1] fehlt der Verweis in einem Repo mit Kit-Quelle, wirft das Ermitteln mit Grund", () => {
  mitFixture({ ohneOrigin: true }, ({ dir }) => {
    assert.throws(() => kitStandErmitteln(dir, "main"), /origin\/main/);
  });
});

test("[kitstand-1] ohne Verweis und ohne Kit-Quelle ist es ein anderes Projekt: kein Stand, kein Fehler", () => {
  mitFixture({ mitKitQuelle: false, ohneOrigin: true }, ({ dir }) => {
    assert.equal(kitStandErmitteln(dir, "main"), null);
  });
  const leer = mkdtempSync(join(tmpdir(), "kitstand-ohne-git-"));
  try {
    assert.equal(kitStandErmitteln(leer, "main"), null, "ausserhalb eines Git-Repos gibt es keinen Stand");
  } finally {
    rmSync(leer, { recursive: true, force: true });
  }
});

// --- Bereitstellen (A1, E2, E4) ---

test("[kitstand-2] bereitgestellt wird eine installierte Kopie des Pushs in einem eigenen Worktree", () => {
  mitFixture({}, ({ dir }) => {
    const { commit } = kitStandErmitteln(dir, "main");
    const pfad = kitStandBereitstellen(dir, commit, "implementierung");
    assert.ok(basename(pfad).startsWith(`kitstand-implementierung-${basename(dir)}-`), pfad);
    assert.equal(git(pfad, "rev-parse", "HEAD"), commit, "der Worktree steht auf dem Stand");
    assert.equal(git(pfad, "status", "--porcelain", "--untracked-files=no"), "", "abgeloest und unveraendert");
    for (const datei of [
      [".claude", "kit", "night.mjs"], [".claude", "kit", "checks.mjs"], [".claude", "kit", "board.mjs"],
      [".claude", "skills", "issue-review", "SKILL.md"], [".claude", "CLAUDE-workflow.md"], [".githooks", "gate.mjs"],
    ]) {
      assert.ok(existsSync(join(pfad, ...datei)), `${datei.join("/")} fehlt im Stand`);
    }
    // Die Arbeitskopie steht hier noch auf dem Push.
    assert.equal(readFileSync(join(pfad, ".claude", "kit", "checks.mjs"), "utf-8"),
      readFileSync(join(dir, "kit", "checks.mjs"), "utf-8"), "die Kopie ist die Quelle des Pushs");
  });
});

// Issue #1125 (Teil von #1122): Unter Windows checkt Git mit `core.autocrlf=true` aus. Ohne die
// `.gitattributes` des Repos bekam der Stand-Worktree CRLF, `sync-blobs` sah andere Bytes und
// schrieb Blobs und Stempel neu — in der CI trug der Worktree ` M install.mjs`. Nachgestellt
// ueber dieselbe Einstellung, damit der Fall auch hier laeuft.
test("[kitstand-2] auch mit core.autocrlf=true bleibt der Stand-Worktree unveraendert", () => {
  mitFixture({}, ({ dir }) => {
    git(dir, "config", "core.autocrlf", "true");
    const { commit } = kitStandErmitteln(dir, "main");
    const pfad = kitStandBereitstellen(dir, commit, "implementierung");
    assert.equal(git(pfad, "status", "--porcelain", "--untracked-files=no"), "", "der Stand ist unter CRLF-Auschecken nicht sauber");
  });
});

test("[kitstand-2] vorab wird nur der eigene Praefix abgeraeumt", () => {
  mitFixture({}, ({ dir }) => {
    const base = basename(dir);
    const alt = join(tmpdir(), `kitstand-implementierung-${base}-alt`);
    const kette = join(tmpdir(), `kitstand-kette-${base}-fremd`);
    const pruefung = join(tmpdir(), `pruefung-${base}-fremd`);
    for (const p of [alt, kette, pruefung]) mkdirSync(p, { recursive: true });

    const { commit } = kitStandErmitteln(dir, "main");
    kitStandBereitstellen(dir, commit, "implementierung");

    assert.equal(existsSync(alt), false, "der alte Stand derselben Laufart ist weg");
    assert.ok(existsSync(kette), "der Stand der Kette gehoert der Kette");
    assert.ok(existsSync(pruefung), "fremde Praefixe bleiben unberuehrt");
  });
});

test("[kitstand-2] scheitert worktree add, wirft das Bereitstellen mit Grund", () => {
  mitFixture({}, ({ dir }) => {
    assert.throws(() => kitStandBereitstellen(dir, "0".repeat(40), "kette"), /worktree add/);
  });
});

test("[kitstand-2] scheitert sync-blobs im Stand, wirft das Bereitstellen mit Grund und laesst keinen Worktree liegen", () => {
  mitFixture({}, ({ dir }) => {
    // Ein Push, dessen install.mjs keine Blob-Konstante mehr traegt: sync-blobs endet rot.
    writeFileSync(join(dir, "install.mjs"), 'const VERSION = "1.0.0";\n');
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-am", "kaputt");
    const commit = git(dir, "rev-parse", "HEAD");
    assert.throws(() => kitStandBereitstellen(dir, commit, "pruefung"), /sync-blobs/);
    assert.deepEqual(standWorktrees(dir), [], "ein halber Stand bleibt nicht liegen");
  });
});

// --- Einsetzen und Freigeben (A3, A4, E5) ---

test("[kitstand-3] Einsetzen ueberschreibt Kit, Skills und Regeltexte, loescht nichts und markiert den Baum", () => {
  mitFixture({}, ({ dir }) => {
    const { commit } = kitStandErmitteln(dir, "main");
    const pfad = kitStandBereitstellen(dir, commit, "implementierung");
    const baum = mkdtempSync(join(tmpdir(), "kitstand-baum-"));
    try {
      mkdirSync(join(baum, ".claude", "kit"), { recursive: true });
      writeFileSync(join(baum, ".claude", "kit", "checks.mjs"), "// Tagstand\n");
      writeFileSync(join(baum, ".claude", "kit", "board-ui.mjs"), "// nicht Teil des Stands\n");

      kitStandEinsetzen({ commit, pfad }, baum);

      assert.equal(readFileSync(join(baum, ".claude", "kit", "checks.mjs"), "utf-8"),
        readFileSync(join(pfad, ".claude", "kit", "checks.mjs"), "utf-8"), "ueberschrieben mit dem Stand");
      assert.equal(readFileSync(join(baum, ".claude", "kit", "board-ui.mjs"), "utf-8"), "// nicht Teil des Stands\n",
        "was der Stand nicht kennt, bleibt");
      assert.ok(existsSync(join(baum, ".claude", "skills", "issue-review", "SKILL.md")));
      assert.ok(existsSync(join(baum, ".claude", "CLAUDE-workflow.md")));

      const markierung = JSON.parse(readFileSync(join(baum, KIT_STAND_MARKIERUNG), "utf-8"));
      assert.deepEqual(Object.keys(markierung), ["commit", "pfad", "pid", "seit"]);
      assert.equal(markierung.commit, commit);
      assert.equal(markierung.pfad, pfad);
      assert.equal(markierung.pid, process.pid);

      kitStandFreigeben(baum);
      assert.equal(existsSync(join(baum, KIT_STAND_MARKIERUNG)), false, "die Markierung ist weg");
      assert.equal(readFileSync(join(baum, ".claude", "kit", "checks.mjs"), "utf-8"),
        readFileSync(join(pfad, ".claude", "kit", "checks.mjs"), "utf-8"), "die Kopie bleibt auf dem Stand (E5)");
    } finally {
      rmSync(baum, { recursive: true, force: true });
    }
  });
});

// --- Erkennung des Kindes (A2) ---

test("[kitstand-4] Kind ist nur, wer KIT_STAND traegt UND aus dem Stand laeuft", () => {
  const stand = mkdtempSync(join(tmpdir(), "kitstand-kind-"));
  try {
    mkdirSync(join(stand, ".claude", "kit"), { recursive: true });
    const skript = join(stand, ".claude", "kit", "night.mjs");
    writeFileSync(skript, "");
    assert.equal(istStandKind(skript, { KIT_STAND: "abc", KIT_STAND_PFAD: stand }), true);
    assert.equal(istStandKind(skript, { KIT_STAND_PFAD: stand }), false, "ohne KIT_STAND kein Kind");
    assert.equal(istStandKind(skript, { KIT_STAND: "abc" }), false, "ohne Pfad kein Kind");
    assert.equal(istStandKind(join(tmpdir(), "anderswo", "night.mjs"), { KIT_STAND: "abc", KIT_STAND_PFAD: stand }), false,
      "ein Runner ausserhalb des Stands ist kein Kind, auch mit ererbter Variable");
    assert.equal(istStandKind(skript, { KIT_STAND: "abc", KIT_STAND_PFAD: "/nicht/vorhanden" }), false);
    assert.equal(istStandKind(skript, { KIT_STAND: "abc", KIT_STAND_PFAD: `${stand}-nachbar` }), false,
      "ein Namensvetter des Pfads zaehlt nicht");
  } finally {
    rmSync(stand, { recursive: true, force: true });
  }
});

test("[kitstand-4] ein Runner mit ererbtem KIT_STAND, der nicht aus dem Stand laeuft, baut seinen eigenen", NUR_POSIX, () => {
  mitFixture({}, ({ dir }) => {
    const commit = git(dir, "rev-parse", "refs/remotes/origin/main");
    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "true", KIT_STAND: "deadbeef", KIT_STAND_PFAD: "/nicht/vorhanden" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const lauf = laufStand(dir);
    assert.equal(lauf.schemaFassung, 1);
    assert.deepEqual(lauf.kitStand, {
      commit, ref: "origin/main", commitZeit: git(dir, "show", "-s", "--format=%cI", commit),
    });
    assert.match(res.stdout, new RegExp(`Kit-Stand: ${commit.slice(0, 12)} \\(origin/main vom \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}\\)`));
    const staende = standWorktrees(dir);
    assert.equal(staende.length, 1, `genau ein Stand-Worktree erwartet: ${staende.join(", ")}`);
    assert.ok(basename(staende[0]).startsWith("kitstand-implementierung-"));
    assert.equal(existsSync(join(staende[0], ".claude", "kit", "night.mjs")), true, "der Runner des Stands liegt bereit");
    assert.equal(existsSync(join(dir, KIT_STAND_MARKIERUNG)), false, "ohne Paket keine Markierung in der Hauptkopie");
  });
});

// --- Gegenprobe und Abbruch (E2, E3) ---

test("[kitstand-5] Gegenprobe: ohne kit/night.mjs unter origin laeuft der Runner ohne Stand-Schritt, kitStand ist null", NUR_POSIX, () => {
  mitFixture({ mitKitQuelle: false }, ({ dir }) => {
    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const lauf = laufStand(dir);
    assert.equal(lauf.kitStand, null);
    assert.equal(lauf.schemaFassung, 1);
    assert.deepEqual(standWorktrees(dir), [], "kein Stand-Worktree");
    assert.doesNotMatch(res.stdout, /Kit-Stand:/);
  });
});

test("[kitstand-5] fehlt origin/main in einem Repo mit Kit-Quelle, bricht der Lauf vor der ersten Sitzung ab", NUR_POSIX, () => {
  mitFixture({ ohneOrigin: true }, ({ dir }) => {
    const spur = join(dir, "helfer", "sitzung");
    const res = runner(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: `touch ${spur}` });
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /Kit-Stand/);
    assert.match(res.stderr, /origin\/main/);
    assert.equal(existsSync(spur), false, "keine Sitzung");
    assert.deepEqual(standWorktrees(dir), []);
  });
});
