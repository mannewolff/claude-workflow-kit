// Der feste Kit-Stand als Einheit (Issue #1102, Plan #1101): ermitteln, bereitstellen,
// einsetzen, freigeben, die Erkennung des Kindes und das Aufraeumen liegengebliebener
// Staende — im selben Prozess gegen den Teil kit/night/kitstand.mjs (Issue #1226, Plan #1199,
// E6). git, das sync-blobs des Stands und die Uhr sind eingesetzt; was ein echter Push, ein
// echtes sync-blobs und der Runner als Kind ergeben, belegt
// test/ablauf-night-kitstand-bereitstellen.test.mjs.
//
// Der Stand ist der Commit, auf den `refs/remotes/origin/<mainBranch>` beim Start zeigt
// (E1, ohne `git fetch`). Er greift nur, wenn dieser Commit die Kit-Quelle selbst traegt
// (E3); andere Projekte laufen unveraendert. Kann er nicht bereitgestellt werden, wirft das
// Bereitstellen, statt still auf die Kopie der Hauptkopie zurueckzufallen (E2).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { KIT_STAND_MARKIERUNG } from "../kit/night/grundlagen.mjs";
import {
  kitStandErmitteln, kitStandBereitstellen, kitStandEinsetzen, kitStandFreigeben, istStandKind, kitStandZeile,
  worktreesAufraeumen, kitstandAbhaengigkeiten,
} from "../kit/night/kitstand.mjs";

const COMMIT = "c0ffee1234567890c0ffee1234567890c0ffee12";
const ZEIT = "2026-10-05T21:13:03+02:00";
const JETZT = new Date("2026-10-06T01:02:03.000Z");
// Die installierte Kit-Kopie unter `.claude/`, als ein Segment geschrieben.
const KOPIE = ".claude/kit";

afterEach(() => kitstandAbhaengigkeiten());

/**
 * Eine git-Attrappe mit Aufzeichnung. `verweis` ist der Commit hinter origin/main oder
 * `null`; `kitQuelle` die Refs, unter denen die Kit-Quelle liegt (Runner und sync-blobs).
 * `worktree add` legt den Ordner mit `tools/` und `templates/` an — wie ein Checkout des
 * Pushs —, oder scheitert mit `addFehler`.
 */
function gitAttrappe({ verweis = COMMIT, kitQuelle = [COMMIT, "HEAD"], addFehler = null } = {}) {
  const aufrufe = [];
  const git = (cwd, args) => {
    aufrufe.push(args.join(" "));
    const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
    const fehler = (stderr) => ({ status: 128, stdout: "", stderr });
    switch (args[0]) {
      case "rev-parse": return verweis ? ok(`${verweis}\n`) : { status: 1, stdout: "", stderr: "" };
      case "cat-file": return kitQuelle.includes(args[2].split(":")[0]) ? ok() : fehler("fatal: path does not exist");
      case "show": return ok(`${ZEIT}\n`);
      case "worktree": return worktree(args, { ok, fehler, addFehler });
      default: return fehler(`unerwartet: git ${args.join(" ")}`);
    }
  };
  return { git, aufrufe };
}

function worktree(args, { ok, fehler, addFehler }) {
  const pfad = args[3];
  if (args[1] === "add") {
    if (addFehler) return fehler(addFehler);
    mkdirSync(join(pfad, "tools"), { recursive: true });
    mkdirSync(join(pfad, "templates"), { recursive: true });
    writeFileSync(join(pfad, "templates", "CLAUDE-workflow.md"), "# Regeln des Pushs\n");
    writeFileSync(join(pfad, "templates", "workflow.config.json"), "{}\n");
    return ok();
  }
  if (args[1] === "remove") rmSync(pfad, { recursive: true, force: true });
  return ok();
}

/** Ein sync-blobs des Stands, das die Kopie schreibt — oder mit `fehler` rot endet. */
function syncAttrappe({ fehler = null } = {}) {
  const aufrufe = [];
  const spawnSync = (befehl, args, optionen) => {
    aufrufe.push({ befehl, args, optionen });
    if (fehler) return { status: 1, stdout: "", stderr: fehler };
    writeFileSync(join(optionen.cwd, KOPIE, "night.mjs"), "// Runner des Pushs\n");
    mkdirSync(join(optionen.cwd, ".claude", "skills", "issue-review"), { recursive: true });
    return { status: 0, stdout: "", stderr: "" };
  };
  return { spawnSync, aufrufe };
}

/** Eine Hauptkopie ohne git; die Staende landen daneben im Temp-Verzeichnis. */
function mitHauptkopie(fn) {
  const dir = mkdtempSync(join(tmpdir(), "kitstand-leicht-"));
  try {
    return fn(dir);
  } finally {
    for (const name of readdirSync(tmpdir()).filter((n) => n.includes(`-${basename(dir)}-`))) {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Ermitteln (E1, E3) ---

test("[kitstand-1] der Stand ist der lokale Verweis origin/main, gelesen ohne fetch", () => {
  const { git, aufrufe } = gitAttrappe();
  kitstandAbhaengigkeiten({ git });
  const stand = kitStandErmitteln("/repo", "main");
  assert.deepEqual(stand, { commit: COMMIT, ref: "origin/main", commitZeit: ZEIT });
  assert.equal(aufrufe[0], `rev-parse --verify --quiet refs/remotes/origin/main^{commit}`);
  assert.ok(!aufrufe.some((a) => a.startsWith("fetch")), `kein fetch: ${aufrufe.join(" | ")}`);
});

test("[kitstand-1] der Verweis folgt mainBranch aus der Config", () => {
  const { git, aufrufe } = gitAttrappe();
  kitstandAbhaengigkeiten({ git });
  assert.equal(kitStandErmitteln("/repo", "trunk").ref, "origin/trunk");
  assert.match(aufrufe[0], /refs\/remotes\/origin\/trunk/);
});

test("[kitstand-1] traegt der Commit unter origin keine Kit-Quelle, greift der Mechanismus nicht", () => {
  kitstandAbhaengigkeiten({ git: gitAttrappe({ kitQuelle: [] }).git });
  assert.equal(kitStandErmitteln("/repo", "main"), null);
});

test("[kitstand-1] fehlt der Verweis in einem Repo mit Kit-Quelle, wirft das Ermitteln mit Grund", () => {
  kitstandAbhaengigkeiten({ git: gitAttrappe({ verweis: null, kitQuelle: ["HEAD"] }).git });
  assert.throws(() => kitStandErmitteln("/repo", "main"), /origin\/main fehlt/);
});

test("[kitstand-1] ohne Verweis und ohne Kit-Quelle ist es ein anderes Projekt: kein Stand, kein Fehler", () => {
  kitstandAbhaengigkeiten({ git: gitAttrappe({ verweis: null, kitQuelle: [] }).git });
  assert.equal(kitStandErmitteln("/repo", "main"), null);
});

test("[kitstand-1] die Zeile des Stands nennt zwoelf Stellen, Ref und Commit-Zeit", () => {
  assert.equal(kitStandZeile({ commit: COMMIT, ref: "origin/main", commitZeit: ZEIT }),
    "Kit-Stand: c0ffee123456 (origin/main vom 2026-10-05 21:13)");
  assert.equal(kitStandZeile({ commit: COMMIT, ref: "origin/main", commitZeit: null }), "Kit-Stand: c0ffee123456 (origin/main)");
});

// --- Bereitstellen (A1, E2, E4) ---

test("[kitstand-2] bereitgestellt wird ein Worktree auf dem Stand mit der Kopie, die sein eigenes sync-blobs schreibt", () => {
  mitHauptkopie((dir) => {
    const { git, aufrufe } = gitAttrappe();
    const sync = syncAttrappe();
    kitstandAbhaengigkeiten({ git, spawnSync: sync.spawnSync, jetzt: () => JETZT });

    const pfad = kitStandBereitstellen(dir, COMMIT, "implementierung");

    assert.equal(basename(pfad), `kitstand-implementierung-${basename(dir)}-20261006010203000-${process.pid}`);
    assert.deepEqual(aufrufe, [`worktree add --detach ${pfad} ${COMMIT}`], "abgeloest auf dem Stand, nichts abgeraeumt");
    assert.equal(sync.aufrufe.length, 1);
    const { befehl, args, optionen } = sync.aufrufe[0];
    assert.equal(befehl, process.execPath);
    assert.deepEqual(args, [join(pfad, "tools", "sync-blobs.mjs")], "das sync-blobs DIESES Stands");
    assert.equal(optionen.cwd, pfad);
    assert.equal(optionen.env.KIT_ROOT, pfad, "eine ererbte KIT_ROOT schriebe in den fremden Root");
    assert.equal(readFileSync(join(pfad, ".claude", "CLAUDE-workflow.md"), "utf-8"), "# Regeln des Pushs\n",
      "die Regeltexte des Stands liegen unter .claude/");
    assert.equal(existsSync(join(pfad, ".claude", "workflow.config.json")), false, "nur CLAUDE-*.md");
    assert.ok(existsSync(join(pfad, KOPIE, "night.mjs")));
    const halter = JSON.parse(readFileSync(`${pfad}.halter`, "utf-8"));
    assert.equal(halter.pid, process.pid);
    assert.equal(halter.seit, JETZT.toISOString());
  });
});

test("[kitstand-2] das Bereitstellen allein laesst einen fremden Stand derselben Laufart stehen", () => {
  mitHauptkopie((dir) => {
    const alt = join(tmpdir(), `kitstand-implementierung-${basename(dir)}-alt`);
    mkdirSync(alt, { recursive: true });
    kitstandAbhaengigkeiten({ git: gitAttrappe().git, spawnSync: syncAttrappe().spawnSync });
    kitStandBereitstellen(dir, COMMIT, "implementierung");
    assert.ok(existsSync(alt), "der Stand derselben Laufart bleibt — auch ohne lebenden Halter");
  });
});

test("[kitstand-2] scheitert worktree add, wirft das Bereitstellen mit Grund und laesst keinen Halter liegen", () => {
  mitHauptkopie((dir) => {
    const sync = syncAttrappe();
    kitstandAbhaengigkeiten({ git: gitAttrappe({ addFehler: "fatal: invalid reference" }).git, spawnSync: sync.spawnSync });
    assert.throws(() => kitStandBereitstellen(dir, "0".repeat(40), "kette"), /worktree add schlug fehl: fatal: invalid reference/);
    assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.includes(`-${basename(dir)}-`)), []);
    assert.equal(sync.aufrufe.length, 0, "ohne Worktree kein sync-blobs");
  });
});

test("[kitstand-2] scheitert sync-blobs im Stand, wirft das Bereitstellen mit Grund und laesst keinen Worktree liegen", () => {
  mitHauptkopie((dir) => {
    const { git, aufrufe } = gitAttrappe();
    kitstandAbhaengigkeiten({ git, spawnSync: syncAttrappe({ fehler: "Blob-Konstante fehlt\nzweite Zeile" }).spawnSync });
    assert.throws(() => kitStandBereitstellen(dir, COMMIT, "pruefung"),
      /sync-blobs im Stand c0ffee123456 schlug fehl: Blob-Konstante fehlt$/);
    assert.ok(aufrufe.some((a) => a.startsWith("worktree remove --force")), aufrufe.join(" | "));
    assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.includes(`-${basename(dir)}-`)), [], "ein halber Stand bleibt nicht liegen");
  });
});

// --- Einsetzen und Freigeben (A3, A4, E5) ---

/** Ein Stand ohne git: ein Verzeichnis mit installierter Kopie. */
function standAnlegen() {
  const pfad = mkdtempSync(join(tmpdir(), "kitstand-stand-"));
  mkdirSync(join(pfad, KOPIE, "night"), { recursive: true });
  mkdirSync(join(pfad, ".claude", "skills", "issue-review"), { recursive: true });
  writeFileSync(join(pfad, KOPIE, "aufwand.mjs"), "// Stand\n");
  writeFileSync(join(pfad, KOPIE, "night", "probe.mjs"), "// Teil des Stands\n");
  writeFileSync(join(pfad, ".claude", "skills", "issue-review", "SKILL.md"), "# Skill des Stands\n");
  writeFileSync(join(pfad, ".claude", "CLAUDE-workflow.md"), "# Regeln des Stands\n");
  writeFileSync(join(pfad, ".claude", "settings.json"), "{}\n");
  return pfad;
}

test("[kitstand-3] Einsetzen ueberschreibt Kit, Skills und Regeltexte, loescht nichts und markiert den Baum", () => {
  const pfad = standAnlegen();
  const baum = mkdtempSync(join(tmpdir(), "kitstand-baum-"));
  kitstandAbhaengigkeiten({ jetzt: () => JETZT });
  try {
    mkdirSync(join(baum, KOPIE), { recursive: true });
    writeFileSync(join(baum, KOPIE, "aufwand.mjs"), "// Tagstand\n");
    writeFileSync(join(baum, KOPIE, "board-ui.mjs"), "// nicht Teil des Stands\n");

    kitStandEinsetzen({ commit: COMMIT, pfad }, baum);

    assert.equal(readFileSync(join(baum, KOPIE, "aufwand.mjs"), "utf-8"), "// Stand\n", "ueberschrieben mit dem Stand");
    assert.equal(readFileSync(join(baum, KOPIE, "board-ui.mjs"), "utf-8"), "// nicht Teil des Stands\n",
      "was der Stand nicht kennt, bleibt");
    assert.equal(readFileSync(join(baum, KOPIE, "night", "probe.mjs"), "utf-8"), "// Teil des Stands\n",
      "die Teile unter .claude/kit/night/ kommen mit (Issue #1209)");
    assert.ok(existsSync(join(baum, ".claude", "skills", "issue-review", "SKILL.md")));
    assert.ok(existsSync(join(baum, ".claude", "CLAUDE-workflow.md")));
    assert.equal(existsSync(join(baum, ".claude", "settings.json")), false, "nur Kit, Skills und Regeltexte");

    const markierung = JSON.parse(readFileSync(join(baum, KIT_STAND_MARKIERUNG), "utf-8"));
    assert.deepEqual(markierung, { commit: COMMIT, pfad, pid: process.pid, seit: JETZT.toISOString() });

    kitStandFreigeben(baum);
    assert.equal(existsSync(join(baum, KIT_STAND_MARKIERUNG)), false, "die Markierung ist weg");
    assert.equal(readFileSync(join(baum, KOPIE, "aufwand.mjs"), "utf-8"), "// Stand\n", "die Kopie bleibt auf dem Stand (E5)");
  } finally {
    kitStandFreigeben(baum);
    rmSync(pfad, { recursive: true, force: true });
    rmSync(baum, { recursive: true, force: true });
  }
});

// --- Erkennung des Kindes (A2) ---

test("[kitstand-4] Kind ist nur, wer KIT_STAND traegt UND aus dem Stand laeuft", () => {
  const stand = mkdtempSync(join(tmpdir(), "kitstand-kind-"));
  try {
    mkdirSync(join(stand, KOPIE), { recursive: true });
    const skript = join(stand, KOPIE, "night.mjs");
    writeFileSync(skript, "");
    assert.equal(istStandKind(skript, { KIT_STAND: "abc", KIT_STAND_PFAD: stand }), true);
    assert.equal(istStandKind(skript, { KIT_STAND_PFAD: stand }), false, "ohne KIT_STAND kein Kind");
    assert.equal(istStandKind(skript, { KIT_STAND: "abc" }), false, "ohne Pfad kein Kind");
    assert.equal(istStandKind(join(tmpdir(), "anderswo", "night.mjs"), { KIT_STAND: "abc", KIT_STAND_PFAD: stand }), false,
      "ein Runner ausserhalb des Stands ist kein Kind, auch mit ererbter Variable");
    assert.equal(istStandKind(skript, { KIT_STAND: "abc", KIT_STAND_PFAD: "/nicht/vorhanden" }), false);
    assert.equal(istStandKind(skript, { KIT_STAND: "abc", KIT_STAND_PFAD: `${stand}-nachbar` }), false,
      "ein Namensvetter des Pfads zaehlt nicht");
    assert.equal(istStandKind(stand, { KIT_STAND: "abc", KIT_STAND_PFAD: stand }), false, "der Stand selbst ist kein Skript darin");
  } finally {
    rmSync(stand, { recursive: true, force: true });
  }
});

// --- Aufraeumen (Issue #1200) ---

test("[kitstand-6] der eigene Stand bleibt beim Aufraeumen ausdruecklich stehen, auch ohne lebenden Halter", () => {
  mitHauptkopie((dir) => {
    const base = basename(dir);
    const eigen = join(tmpdir(), `kitstand-implementierung-${base}-eigen`);
    const alt = join(tmpdir(), `kitstand-implementierung-${base}-alt`);
    const kette = join(tmpdir(), `kitstand-kette-${base}-fremd`);
    for (const p of [eigen, alt, kette]) mkdirSync(p, { recursive: true });
    const { git, aufrufe } = gitAttrappe();
    kitstandAbhaengigkeiten({ git });

    const entfernt = worktreesAufraeumen(dir, "kitstand-implementierung", eigen);

    // Gemeldet wird der realpath (Issue #1372): Gelistet wird unter dem realpath des Temp-Verzeichnisses.
    const altEcht = join(realpathSync(tmpdir()), basename(alt));
    assert.deepEqual(entfernt, [altEcht]);
    assert.ok(existsSync(eigen), "der eigene Stand bleibt");
    assert.ok(existsSync(kette), "eine andere Laufart raeumt einander nichts weg");
    assert.equal(existsSync(alt), false);
    assert.deepEqual(aufrufe, ["worktree prune", `worktree remove --force ${altEcht}`]);
  });
});
