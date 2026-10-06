// Ablauf-Pruefung: tools/frischer-checkout.mjs prueft einen frischen git-Checkout; das zeigt nur der Start als Programm gegen ein Wegwerf-Repo.
//
// Schutztest des Pruefwerkzeugs fuer den frischen Checkout (Issue #1038, Plan #1035).
//
// Das Werkzeug legt einen Worktree des aufrufenden Stands ohne `.claude/` an, faehrt
// darin die Suite mit dem Spur-Einstieg und meldet je Testdatei, was im frischen Stand
// fehlt. Jeder Fall baut dafuer ein Wegwerf-Repo im Temp-Verzeichnis — `.gitignore` mit
// `.claude/*`, ein oder zwei Mini-Tests, eine versionierte Config — und startet das
// Werkzeug darin als echten Prozess, genau wie die Push-Stufe es tut.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const werkzeug = join(repoRoot, "tools", "frischer-checkout.mjs");

function git(cwd, ...a) {
  const res = spawnSync("git", a, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

function schreibe(wurzel, name, inhalt) {
  const pfad = join(wurzel, name);
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}

/**
 * Ein Repo mit den versionierten Dateien `dateien` (Name → Inhalt) und einem Commit.
 * `config` ist die versionierte `.claude/workflow.config.json`.
 */
function repoMit(dateien, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "frischrepo-"));
  schreibe(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\n");
  schreibe(dir, ".claude/workflow.config.json", `${JSON.stringify(config)}\n`);
  for (const [name, inhalt] of Object.entries(dateien)) schreibe(dir, name, inhalt);
  lfAttribute(join(dir, ".gitattributes"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

function mitRepo(dateien, fn, config) {
  const dir = repoMit(dateien, config);
  const angelegt = [];
  try {
    return fn(dir, angelegt);
  } finally {
    for (const p of angelegt) rmSync(p, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

function pruefe(cwd) {
  return spawnSync(process.execPath, [werkzeug], { cwd, encoding: "utf-8", env: { ...process.env } });
}

/** Kein Worktree mit Praefix `frisch` mehr — weder in git noch im Temp-Verzeichnis. */
function keinFrischerWorktree(dir) {
  const liste = git(dir, "worktree", "list");
  assert.ok(!/[\\/]frisch-/.test(liste), `Worktree mit Praefix frisch steht noch: ${liste}`);
  const reste = readdirSync(tmpdir()).filter((n) => n.startsWith(`frisch-${basename(dir)}-`));
  assert.deepEqual(reste, [], "Ordner des frischen Worktrees liegt noch im Temp-Verzeichnis");
}

const ROT = {
  "test/rot.test.mjs": [
    `import { test } from "node:test";`,
    `import { readFileSync } from "node:fs";`,
    `test("liest die Kopie", () => { readFileSync(".claude/x.md", "utf8"); });`,
    ``,
  ].join("\n"),
};

const GRUEN = {
  "test/gruen.test.mjs": `import { test } from "node:test";\ntest("nichts", () => {});\n`,
};

test("[1038] Rot-Fall: ein Test liest eine nur lokal liegende Datei — Exit 1 mit Testdatei, Pfad und Befundart", () => {
  mitRepo(ROT, (dir) => {
    schreibe(dir, ".claude/x.md", "lokal\n");
    const r = pruefe(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /test\/rot\.test\.mjs: rot im frischen Checkout \(Test "liest die Kopie"\)/);
    assert.match(r.stdout, /fehlt im frischen Stand: \.claude\/x\.md/);
    assert.doesNotMatch(r.stdout, /\[ERROR\]|BUILD FAILURE/);
  });
});

test("[1038] stiller Fall: ein Test ueberspringt die fehlende Datei und ist gruen — Exit 1 mit \"suchte aber\"", () => {
  mitRepo(
    {
      "test/still.test.mjs": [
        `import { test } from "node:test";`,
        `import { existsSync } from "node:fs";`,
        `test("still", () => { if (!existsSync(".claude/x.md")) return; });`,
        ``,
      ].join("\n"),
    },
    (dir) => {
      schreibe(dir, ".claude/x.md", "lokal\n");
      const r = pruefe(dir);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /test\/still\.test\.mjs: gruen im frischen Checkout, suchte aber: \.claude\/x\.md/);
    },
  );
});

test("[1038] Kindprozess: der Zugriff eines mit { ...process.env } gestarteten node wird der Testdatei zugeordnet", () => {
  mitRepo(
    {
      "kind.mjs": `import { existsSync, readFileSync } from "node:fs";\nif (existsSync(".claude/x.md")) readFileSync(".claude/x.md");\n`,
      "test/eltern.test.mjs": [
        `import { test } from "node:test";`,
        `import assert from "node:assert/strict";`,
        `import { spawnSync } from "node:child_process";`,
        `test("startet ein Kind", () => {`,
        `  const r = spawnSync(process.execPath, ["kind.mjs"], { env: { ...process.env }, encoding: "utf8" });`,
        `  assert.equal(r.status, 0, r.stderr);`,
        `});`,
        ``,
      ].join("\n"),
    },
    (dir) => {
      schreibe(dir, ".claude/x.md", "lokal\n");
      const r = pruefe(dir);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /test\/eltern\.test\.mjs: gruen im frischen Checkout, suchte aber: \.claude\/x\.md/);
    },
  );
});

test("[1038] sauberer Fall: ueberall fehlender Pfad und Pfad der Ausnahmeliste — Exit 0, genau eine Zeile", () => {
  mitRepo(
    {
      "test/sauber.test.mjs": [
        `import { test } from "node:test";`,
        `import { existsSync } from "node:fs";`,
        `test("prueft", () => {`,
        `  existsSync("fehlt-ueberall.md");`,
        `  existsSync(".claude/workflow.config.local.json");`,
        `});`,
        ``,
      ].join("\n"),
    },
    (dir) => {
      schreibe(dir, ".claude/workflow.config.local.json", "{}\n");
      const r = pruefe(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const zeilen = r.stdout.split("\n").filter(Boolean);
      assert.equal(zeilen.length, 1, `genau eine Zeile erwartet: ${r.stdout}`);
      assert.match(zeilen[0], /1 Testdatei/);
      assert.doesNotMatch(r.stdout, /suchte aber|rot im frischen Checkout|Befund/);
    },
  );
});

// Issue #1120: Ein scheiternder, als offen vermerkter oder uebersprungener Test ist kein Befund — `node --test` zaehlt ihn
// nicht als Fehlschlag, und der Vermerk sagt bewusst „Absicht offen“. Daran hing der rote
// frische Checkout von `push main` am 2026-10-02 (config-teile, night-vorflug-stopp).
test("[1120] ein scheiternder todo- und ein uebersprungener Test sind kein Befund — Exit 0", () => {
  mitRepo(
    {
      "test/offen.test.mjs": [
        `import { test } from "node:test";`,
        `import assert from "node:assert/strict";`,
        `test("Absicht offen", { todo: "spaeter" }, () => { assert.fail("noch nicht"); });`,
        `test("ausgelassen", { skip: "nicht hier" }, () => { assert.fail("nie"); });`,
        `test("laeuft", () => {});`,
        ``,
      ].join("\n"),
    },
    (dir) => {
      const r = pruefe(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /rot im frischen Checkout|Befund/);
    },
  );
});

// Issue #1120: Die Einstellungsdateien liest `geschuetztePfade` nur, um die Sperrliste zu
// ergaenzen; ohne sie gilt die Vorgabeliste. Sie sind unversioniert und duerfen fehlen.
test("[1120] die Einstellungsdateien stehen auf der Ausnahmeliste", async () => {
  const { AUSNAHMEN } = await import("../tools/frischer-checkout.mjs");
  for (const pfad of [".claude/settings.json", ".claude/settings.local.json"]) {
    assert.ok(typeof AUSNAHMEN[pfad] === "string" && AUSNAHMEN[pfad].length > 0, `${pfad} fehlt auf der Ausnahmeliste oder traegt keinen Grund`);
  }
});

test("[1038] unkommittierte Aenderung: geaenderte versionierte und ungetrackte Datei liegen auch im frischen Stand", () => {
  mitRepo(
    {
      "daten.txt": "alt\n",
      "test/daten.test.mjs": [
        `import { test } from "node:test";`,
        `import assert from "node:assert/strict";`,
        `import { readFileSync } from "node:fs";`,
        `test("sieht den Arbeitsstand", () => {`,
        `  assert.equal(readFileSync("daten.txt", "utf8").replaceAll("\\r\\n", "\\n"), "neu\\n");`,
        `  assert.equal(readFileSync("extra.txt", "utf8").replaceAll("\\r\\n", "\\n"), "dazu\\n");`,
        `});`,
        ``,
      ].join("\n"),
    },
    (dir) => {
      schreibe(dir, "daten.txt", "neu\n");
      schreibe(dir, "extra.txt", "dazu\n");
      const r = pruefe(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
    },
  );
});

test("[1038] Stand des Aufrufers: im zweiten Worktree wird dessen Commit geprueft, nicht der der Hauptkopie", () => {
  mitRepo(GRUEN, (dir, angelegt) => {
    const zweiter = mkdtempSync(join(tmpdir(), "zweiter-"));
    rmSync(zweiter, { recursive: true, force: true });
    angelegt.push(zweiter);
    git(dir, "worktree", "add", "-q", "-b", "zweig", zweiter);
    schreibe(zweiter, "test/rot.test.mjs", ROT["test/rot.test.mjs"]);
    git(zweiter, "add", "-A");
    git(zweiter, "commit", "-q", "-m", "roter Test");
    schreibe(zweiter, ".claude/x.md", "lokal\n");
    try {
      const r = pruefe(zweiter);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /test\/rot\.test\.mjs: rot im frischen Checkout/);
      assert.match(r.stdout, /fehlt im frischen Stand: \.claude\/x\.md/);
      assert.equal(pruefe(dir).status, 0, "die Hauptkopie selbst ist gruen");
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", zweiter], { cwd: dir });
    }
  });
});

test("[1038] Abbau: nach gruenem und nach rotem Lauf steht kein Worktree mit Praefix frisch mehr", () => {
  mitRepo({ ...GRUEN, ...ROT }, (dir) => {
    rmSync(join(dir, "test", "rot.test.mjs"));
    assert.equal(pruefe(dir).status, 0);
    keinFrischerWorktree(dir);
    git(dir, "checkout", "--", "test/rot.test.mjs");
    schreibe(dir, ".claude/x.md", "lokal\n");
    assert.equal(pruefe(dir).status, 1);
    keinFrischerWorktree(dir);
  });
});

test("[1038] technischer Fehler: ein scheiterndes installCommand ergibt Exit 1 mit Grund", () => {
  mitRepo(
    GRUEN,
    (dir) => {
      const r = pruefe(dir);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /technischer Fehler/);
      assert.match(r.stdout, /installCommand/);
      assert.match(r.stdout, /Exit-Code 3/);
      keinFrischerWorktree(dir);
    },
    { installCommand: `node -e "process.exit(3)"` },
  );
});
