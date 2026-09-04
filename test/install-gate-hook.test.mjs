// Auslieferung und Einhaengen des Commit-Gates (Issue #473, Plan #467 A2/A11).
//
// Der Hook wandert mit dem Clone, die Aktivierung nicht: `core.hooksPath` ist lokale
// git-Config. Die Frage steht deshalb nur dort, wo sie etwas bewirkt — und
// verbraucht sonst KEINE Antwortzeile: Im Pipe-Modus schoebe jede ungefragte Frage
// alle folgenden Antworten.
//
// Die Fixtures setzen GIT_CONFIG_GLOBAL und GIT_CONFIG_NOSYSTEM, sonst laesen die
// Tests die echte globale Config des Entwicklers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows kennt kein x-Bit; die Ausfuehrbarkeit ist dort nicht messbar." }
  : {};

// Woertlich so, wie sie im Installer steht.
const FRAGE = "Soll das Commit-Gate eingehaengt werden?";

function fixture(praefix, { mitGit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  if (mitGit) {
    for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"]]) {
      assert.equal(git(dir, ...a).status, 0);
    }
  }
  return dir;
}

function git(dir, ...args) {
  return spawnSync("git", args, {
    cwd: dir, encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "home", ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1" },
  });
}

function installiere(dir, antworten) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
      GIT_CONFIG_GLOBAL: join(dir, "home", ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

// Scope, codeHost, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel, reviewCommand, Spec-Frage — und an zehnter Stelle die Hook-Frage.
const antworten = (spec, hook) => ["projekt", "github", "toolbox", "", "", "", "", "", spec, hook];

function hooksPath(dir) {
  const res = git(dir, "config", "--get", "core.hooksPath");
  return res.status === 0 ? res.stdout.trim() : null;
}

function mitFixture(praefix, fn, optionen = {}) {
  const dir = fixture(praefix, optionen);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("[installer-2] bei Zustimmung liegen Hook und Gate, und core.hooksPath steht auf .githooks", () => {
  mitFixture("install-gate-ja-", (dir) => {
    const res = installiere(dir, antworten("n", "j"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(existsSync(join(dir, ".githooks", "gate.mjs")), "gate.mjs fehlt");
    assert.ok(existsSync(join(dir, ".githooks", "pre-commit")), "pre-commit fehlt");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] das ausgelieferte gate.mjs ist bytegleich zum Blob", () => {
  mitFixture("install-gate-byte-", (dir) => {
    installiere(dir, antworten("n", "j"));
    assert.equal(
      readFileSync(join(dir, ".githooks", "gate.mjs"), "utf-8"),
      readFileSync(join(repoRoot, ".githooks", "gate.mjs"), "utf-8"),
      "das ausgelieferte Gate weicht von der Quelle ab",
    );
  });
});

test("[installer-2] das ausgelieferte gate.mjs laeuft im Zielprojekt ohne Import-Fehler", () => {
  // Der Nachweis, dass die Pfadaufloesung aus Issue #470 dort greift, wo checks.mjs
  // unter .claude/kit/ liegt — ein statischer Import auf ../kit/ waere hier rot.
  mitFixture("install-gate-import-", (dir) => {
    installiere(dir, antworten("n", "j"));
    const res = spawnSync(process.execPath, [join(dir, ".githooks", "gate.mjs"), "pre-commit"], {
      cwd: dir, encoding: "utf-8",
    });
    assert.doesNotMatch(`${res.stderr}`, /Cannot find module|ERR_MODULE_NOT_FOUND/,
      `das Gate fand sein checks.mjs nicht: ${res.stderr}`);
  });
});

test("[installer-2] pre-commit ist ausfuehrbar", NUR_POSIX, () => {
  mitFixture("install-gate-x-", (dir) => {
    installiere(dir, antworten("n", "j"));
    const mode = statSync(join(dir, ".githooks", "pre-commit")).mode;
    assert.equal((mode & 0o111) !== 0, true, "der Hook muss ausfuehrbar sein");
  });
});

test("[installer-2] bei Ablehnung liegen die Dateien, core.hooksPath bleibt leer", () => {
  mitFixture("install-gate-nein-", (dir) => {
    const res = installiere(dir, antworten("n", "n"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(existsSync(join(dir, ".githooks", "gate.mjs")), "die Dateien gehoeren trotzdem geschrieben");
    assert.equal(hooksPath(dir), null);
  });
});

test("[installer-2] ein belegter core.hooksPath bleibt unveraendert und verbraucht keine Antwortzeile", () => {
  mitFixture("install-gate-belegt-", (dir) => {
    assert.equal(git(dir, "config", "core.hooksPath", ".husky").status, 0);
    // Eine Antwort WENIGER: Wird die Frage doch gestellt, fehlt eine Zeile und der
    // Lauf endet rot — genau das soll der Test fangen.
    const res = installiere(dir, ["projekt", "github", "toolbox", "", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(hooksPath(dir), ".husky", "ein fremder hooksPath darf nicht ueberschrieben werden");
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE), "bei belegtem Wert wird nicht gefragt");
    assert.match(res.stdout, /\.husky/, "der gefundene Wert gehoert gemeldet");
  });
});

test("[installer-2] ein frisches Repo mit nur *.sample-Dateien gilt als frei", () => {
  mitFixture("install-gate-sample-", (dir) => {
    const res = installiere(dir, antworten("n", "j"));
    assert.match(res.stdout, new RegExp(FRAGE), "die Frage haette gestellt werden muessen");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] ein fremdes .githooks/pre-commit bleibt bytegleich erhalten", () => {
  mitFixture("install-gate-fremd-", (dir) => {
    mkdirSync(join(dir, ".githooks"), { recursive: true });
    const fremd = "#!/bin/sh\n# husky\nexit 0\n";
    writeFileSync(join(dir, ".githooks", "pre-commit"), fremd, "utf-8");
    const res = installiere(dir, antworten("n", "j"));
    assert.equal(readFileSync(join(dir, ".githooks", "pre-commit"), "utf-8"), fremd,
      "ein fremder Hook darf nicht ueberschrieben werden");
    assert.match(res.stdout, /stammt nicht aus diesem Kit/);
  });
});

test("[installer-2] ausserhalb eines Git-Repos entfaellt die Frage, der Lauf endet gruen", () => {
  mitFixture("install-gate-ohnegit-", (dir) => {
    const res = installiere(dir, ["projekt", "github", "toolbox", "", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE));
    assert.match(res.stdout, /kein Git-Repo|git nicht gefunden/);
  }, { mitGit: false });
});

test("[installer-2] im Update-Modus mit gesetztem .githooks entfaellt die Frage", () => {
  mitFixture("install-gate-update-", (dir) => {
    assert.equal(git(dir, "config", "core.hooksPath", ".githooks").status, 0);
    const res = installiere(dir, ["projekt", "github", "toolbox", "", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE));
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] bei globalem Install wird nichts nach .githooks geschrieben", () => {
  mitFixture("install-gate-global-", (dir) => {
    const res = installiere(dir, ["global", "github", "toolbox", "", "", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(existsSync(join(dir, ".githooks")), false);
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE));
  });
});

test("[installer-2] gate.mjs steht nicht in STAMPED und wird nicht nach .claude/kit/ kopiert", () => {
  const sync = readFileSync(join(repoRoot, "tools", "sync-blobs.mjs"), "utf-8");
  const stamped = sync.slice(sync.indexOf("const STAMPED"), sync.indexOf("\n", sync.indexOf("const STAMPED")));
  assert.doesNotMatch(stamped, /gate\.mjs/, "das Gate gehoert nicht in die Dogfooding-Kopie");
  assert.equal(existsSync(join(repoRoot, ".claude", "kit", "gate.mjs")), false);
});
