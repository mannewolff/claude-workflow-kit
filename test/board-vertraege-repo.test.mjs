/**
 * test/board-vertraege-repo.test.mjs — `vertragsRepoHolen` holt den gebauten Stand des
 * Partnerrepos (Issue #1615, Plan #1611 E7, E8). Ohne Netz: git ist eingesetzt, der Klon legt
 * nur ein Verzeichnis mit einer Datei an.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { vertragsRepoHolen } from "../kit/board/vertraege.mjs";

const URL = "https://example.org/partner.git";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

let wurzel;
let aufrufe;
let commit;

const config = { vertragsRepos: [{ name: "partner", url: URL }, { name: "anderes", url: "https://example.org/anderes.git", zweig: "dev" }] };

/** Ein git ohne Netz: ls-remote nennt `commit`, clone legt das Ziel mit einer Datei an. */
function git(cwd, args) {
  aufrufe.push(args);
  if (args[0] === "ls-remote") return { status: 0, stdout: `${commit}\trefs/heads/${args[2]}\n`, stderr: "" };
  if (args[0] === "clone") {
    const ziel = args.at(-1);
    mkdirSync(ziel, { recursive: true });
    writeFileSync(join(ziel, "board.mjs"), `// ${commit}\n`);
    return { status: 0, stdout: "", stderr: "" };
  }
  if (args[0] === "log") return { status: 0, stdout: "2026-10-12T08:00:00+02:00\n", stderr: "" };
  return { status: 1, stdout: "", stderr: `unerwartet: ${args.join(" ")}` };
}

const abh = () => ({ git, tmpdir: wurzel });
const klone = () => aufrufe.filter((a) => a[0] === "clone");
const cache = () => readdirSync(join(wurzel, "kit-contract-repos")).sort();

beforeEach(() => {
  wurzel = mkdtempSync(join(tmpdir(), "vertragsrepo-"));
  aufrufe = [];
  commit = COMMIT_A;
});
afterEach(() => rmSync(wurzel, { recursive: true, force: true }));

test("erfolgreicher Abruf legt den Klon an und nennt Commit und Pfad", () => {
  const ergebnis = vertragsRepoHolen(config, "partner", abh());
  const pfad = join(wurzel, "kit-contract-repos", `partner-${COMMIT_A.slice(0, 12)}`);
  assert.deepEqual(ergebnis, {
    ok: true, name: "partner", url: URL, branch: "main", commit: COMMIT_A, date: "2026-10-12T08:00:00+02:00", path: pfad,
  });
  assert.match(readFileSync(join(pfad, "board.mjs"), "utf-8"), new RegExp(COMMIT_A));
  assert.deepEqual(aufrufe[0], ["ls-remote", URL, "main"]);
  const klon = klone()[0];
  assert.deepEqual(klon.slice(0, 6), ["clone", "--depth", "1", "--branch", "main", URL]);
  assert.notEqual(klon.at(-1), pfad, "geklont wird in ein temporaeres Verzeichnis, nicht ins Ziel");
  assert.deepEqual(cache(), [`partner-${COMMIT_A.slice(0, 12)}`], "kein temporaeres Verzeichnis bleibt liegen");
});

test("der Zweig aus der Config gilt fuer ls-remote und clone", () => {
  const ergebnis = vertragsRepoHolen(config, "anderes", abh());
  assert.equal(ergebnis.branch, "dev");
  assert.deepEqual(aufrufe[0], ["ls-remote", "https://example.org/anderes.git", "dev"]);
  assert.equal(klone()[0][4], "dev");
});

test("zweiter Aufruf beim selben Commit klont nicht", () => {
  const erstes = vertragsRepoHolen(config, "partner", abh());
  const zweites = vertragsRepoHolen(config, "partner", abh());
  assert.equal(klone().length, 1);
  assert.deepEqual(zweites, erstes);
});

test("neuer Commit loescht den aelteren Stand desselben Namens, fremde Namen bleiben", () => {
  vertragsRepoHolen(config, "partner", abh());
  vertragsRepoHolen(config, "anderes", abh());
  mkdirSync(join(wurzel, "kit-contract-repos", "partner-extra-0123456789ab"));
  commit = COMMIT_B;
  const ergebnis = vertragsRepoHolen(config, "partner", abh());
  assert.equal(ergebnis.commit, COMMIT_B);
  assert.ok(existsSync(ergebnis.path));
  assert.deepEqual(cache(), [`anderes-${COMMIT_A.slice(0, 12)}`, "partner-extra-0123456789ab", `partner-${COMMIT_B.slice(0, 12)}`].sort());
});

test("scheiterndes ls-remote liefert { ok: false, name, reason }", () => {
  const scheitert = (cwd, args) => {
    aufrufe.push(args);
    return { status: 128, stdout: "", stderr: "fatal: unable to access 'https://example.org/partner.git/'\n" };
  };
  const ergebnis = vertragsRepoHolen(config, "partner", { git: scheitert, tmpdir: wurzel });
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.name, "partner");
  assert.match(ergebnis.reason, /unable to access/);
  assert.deepEqual(Object.keys(ergebnis).sort(), ["name", "ok", "reason"]);
  assert.equal(klone().length, 0);
});

test("ein Zweig, den ls-remote nicht kennt, liefert ok false", () => {
  const leer = () => ({ status: 0, stdout: "", stderr: "" });
  const ergebnis = vertragsRepoHolen(config, "partner", { git: leer, tmpdir: wurzel });
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.reason, /main/);
});

test("scheiternder Klon liefert ok false und laesst kein Verzeichnis liegen", () => {
  const ohneKlon = (cwd, args) => {
    if (args[0] === "clone") {
      mkdirSync(args.at(-1), { recursive: true });
      return { status: 128, stdout: "", stderr: "fatal: Remote branch main not found\n" };
    }
    return git(cwd, args);
  };
  const ergebnis = vertragsRepoHolen(config, "partner", { git: ohneKlon, tmpdir: wurzel });
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.reason, /Remote branch main not found/);
  assert.deepEqual(cache(), []);
});

test("unbekannter Name bricht mit der Liste der bekannten Namen ab", () => {
  assert.throws(() => vertragsRepoHolen(config, "gibtesnicht", abh()), (e) => {
    assert.match(e.message, /gibtesnicht/);
    assert.match(e.message, /partner, anderes/);
    return true;
  });
  assert.equal(aufrufe.length, 0);
});

test("ein Name mit / oder .. wird abgewiesen, auch wenn er in der Config steht", () => {
  for (const name of ["../flucht", "a/b", "..", "partner/../../x"]) {
    const boese = { vertragsRepos: [{ name, url: URL }] };
    assert.throws(() => vertragsRepoHolen(boese, name, abh()), new RegExp(name.replaceAll(".", String.raw`\.`)), name);
  }
  assert.equal(aufrufe.length, 0, "kein git-Aufruf vor der Pruefung des Namens");
  assert.ok(!existsSync(join(wurzel, "kit-contract-repos")), "kein Pfad wird angelegt");
});
