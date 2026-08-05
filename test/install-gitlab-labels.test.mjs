// install.mjs legt die GitLab-Labels ohne Shell an (Issue #198).
//
// Zuvor wurde der Labelname in eine Kommandozeile interpoliert:
//   glab label create --name "${label.name}" --color "${label.color}"
// Zwei der fuenf Namen enthalten ein Leerzeichen ("In progress", "In review") — ob sie
// als ein Argument ankommen, hing damit am Quoting-Dialekt der Plattform. Es ist
// dieselbe Fehlerklasse wie in Issue #196, nur an anderer Stelle.
//
// Getestet wird gegen das ECHTE install.mjs aus dem Repo, im Piped-Modus mit einem
// Fake-glab im PATH — kein Netz, kein echtes GitLab, und geschrieben wird
// ausschliesslich in ein Wegwerf-Verzeichnis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fakeCli, aufrufe } from "./helpers/board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und install.mjs startet seit #198 bewusst ohne Shell. Siehe Issue #197." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

// Die Antworten auf die Installer-Fragen, in der Reihenfolge von main():
// Scope, codeHost, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel (leer = Default uebernehmen) und zuletzt das j fuer die Labels.
const ANTWORTEN = ["projekt", "gitlab", "gitlab", "", "", "", "", "j"].join("\n") + "\n";

test("install.mjs uebergibt Labelnamen mit Leerzeichen als ein Argument", NUR_POSIX, () => {
  const dir = mkdtempSync(join(tmpdir(), "install-labels-"));
  try {
    fakeCli(dir, "glab", [{ match: "^label create", stdout: "" }]);

    const res = spawnSync(process.execPath, [INSTALLER], {
      cwd: dir,
      input: ANTWORTEN,
      encoding: "utf-8",
      env: { ...process.env, PATH: `${join(dir, "fakebin")}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, `Installer schlug fehl: ${res.stderr}\n${res.stdout}`);

    // Der Installer hat tatsaechlich im Wegwerf-Verzeichnis gearbeitet.
    assert.ok(existsSync(join(dir, ".claude", "workflow.config.json")),
      "die Config haette im Fixture landen muessen");

    const rufe = aufrufe(dir, "glab").filter((argv) => argv[0] === "label" && argv[1] === "create");
    assert.equal(rufe.length, 5, "es muessen fuenf Labels angelegt werden");

    // Der Kern: Namen mit Leerzeichen stehen als EIN argv-Element, ohne Quotes.
    const namen = rufe.map((argv) => argv[argv.indexOf("--name") + 1]);
    assert.deepEqual(namen, ["Backlog", "Ready", "In progress", "In review", "Done"]);

    // Und die Farbe landet an ihrem eigenen Argument, nicht im Namen.
    const farben = rufe.map((argv) => argv[argv.indexOf("--color") + 1]);
    assert.deepEqual(farben, ["#e2e2e2", "#0075ca", "#e4e669", "#d93f0b", "#0e8a16"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs meldet ein bereits vorhandenes Label als solches", NUR_POSIX, () => {
  const dir = mkdtempSync(join(tmpdir(), "install-labels-exists-"));
  try {
    fakeCli(dir, "glab", [
      { match: "^label create --name Backlog", stderr: "label already exists\n", exit: 1 },
      { match: "^label create", stdout: "" },
    ]);

    const res = spawnSync(process.execPath, [INSTALLER], {
      cwd: dir,
      input: ANTWORTEN,
      encoding: "utf-8",
      env: { ...process.env, PATH: `${join(dir, "fakebin")}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, `Installer schlug fehl: ${res.stderr}`);
    assert.match(res.stdout, /~ Backlog \(bereits vorhanden\)/);
    assert.match(res.stdout, /✓ Ready/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs meldet einen echten glab-Fehler als Warnung, ohne abzubrechen", NUR_POSIX, () => {
  const dir = mkdtempSync(join(tmpdir(), "install-labels-fehler-"));
  try {
    fakeCli(dir, "glab", [
      { match: "^label create --name Ready", stderr: "401 Unauthorized\n", exit: 1 },
      { match: "^label create", stdout: "" },
    ]);

    const res = spawnSync(process.execPath, [INSTALLER], {
      cwd: dir,
      input: ANTWORTEN,
      encoding: "utf-8",
      env: { ...process.env, PATH: `${join(dir, "fakebin")}:${process.env.PATH}` },
    });
    // Ein fehlgeschlagenes Label darf die Installation nicht kippen — der Rest
    // der Einrichtung ist davon unabhaengig.
    assert.equal(res.status, 0, `Installer schlug fehl: ${res.stderr}`);
    assert.match(res.stderr + res.stdout, /✗ Ready: 401 Unauthorized/);
    assert.match(res.stdout, /✓ Done/, "die uebrigen Labels muessen weiter angelegt werden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
