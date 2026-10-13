// Ablauf-Pruefung: tools/sprachfassungen.mjs exportiert nichts und liest den Wurzelpfad aus KIT_ROOT; Pruefung und Exitcode zeigt nur der Start als Programm.
//
// tools/sprachfassungen.mjs prueft auch die Paare unter dem Spiegel en/ (Issue #1465, Plan
// #1420 E17): `en/<pfad>` gegen `<pfad>` mit denselben Abschnittsstempeln wie die Doku, aber
// ohne Gleichheit der Codebloecke, weil die englischen Befehle die englischen Namen tragen.
// Eine fehlende Fassung und ein lueckenloses Anfangsstueck sind kein Fehler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "sprachfassungen.mjs");
// Seit Issue #1566 gibt es keine englischen Skills mehr; der Spiegel traegt Vorlagen, Rollen und Agenten.
const PAAR = "en/agents/probe.md";

function lauf(args, root) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf-8", env: { ...process.env, KIT_ROOT: root } });
}

const DEUTSCH = [
  "---",
  "name: probe",
  "description: Prueft etwas.",
  "---",
  "",
  "# Probe",
  "",
  "Einleitung.",
  "",
  "## Ablauf",
  "",
  "```bash",
  "node .claude/kit/board.mjs issue auftrag <id>",
  "```",
  "",
  "## Ende",
  "",
  "Schluss.",
  "",
].join("\n");

/** Die Stempel der deutschen Quelle, wie --erwartet sie ausgibt: [{ stempel, kopf }]. */
function erwartet(dir) {
  const res = lauf(["--erwartet", PAAR], dir);
  assert.equal(res.status, 0, res.stderr);
  return res.stdout
    .trim()
    .split("\n")
    .map((z) => {
      const m = /^<!-- de: ([0-9a-f]{12}) --> {2}(\S.*)$/.exec(z);
      assert.ok(m, `unerwartete Zeile: ${z}`);
      return { stempel: m[1], kopf: m[2] };
    });
}

/** Englische Fassung mit Stempel nach dem Frontmatter und unter jeder Ueberschrift. */
function englisch(st, { befehl = "node .claude/kit/board.mjs issue auftrag <id>", bis } = {}) {
  const stempel = Object.fromEntries(st.map((s) => [s.kopf, s.stempel]));
  const teile = [
    "---",
    "name: probe",
    "description: Checks something.",
    "---",
    `<!-- de: ${stempel["Abschnitt 0"]} -->`,
    "",
    "# Probe",
    `<!-- de: ${stempel["# Probe"]} -->`,
    "",
    "Introduction.",
    "",
    "## Steps",
    `<!-- de: ${stempel["## Ablauf"]} -->`,
    "",
    "```bash",
    befehl,
    "```",
    "",
    "## End",
    `<!-- de: ${stempel["## Ende"]} -->`,
    "",
    "Done.",
    "",
  ].join("\n");
  return bis ? teile.slice(0, teile.indexOf(bis)) : teile;
}

function mitFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "sprachfassungen-en-"));
  try {
    mkdirSync(join(dir, "docs", "en"), { recursive: true });
    mkdirSync(join(dir, "docs-site"));
    writeFileSync(join(dir, "docs-site", "sprachen.json"), JSON.stringify({ englischAktiv: true, historisch: [] }));
    mkdirSync(join(dir, "agents"), { recursive: true });
    mkdirSync(join(dir, "en", "agents"), { recursive: true });
    writeFileSync(join(dir, "agents", "probe.md"), DEUTSCH);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function schreibeEn(dir, text) {
  writeFileSync(join(dir, PAAR), text);
}

test("--erwartet en/agents/<name>.md gibt die Stempel der deutschen Quelle aus", () => {
  mitFixture((dir) => {
    const st = erwartet(dir);
    assert.deepEqual(
      st.map((s) => s.kopf),
      ["Abschnitt 0", "# Probe", "## Ablauf", "## Ende"]
    );
  });
});

test("ein Paar mit passenden Stempeln ist gruen", () => {
  mitFixture((dir) => {
    schreibeEn(dir, englisch(erwartet(dir)));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 0, res.stderr);
  });
});

test("ein veralteter Stempel ist rot mit Seite, Abschnitt und erwartetem Stempel", () => {
  mitFixture((dir) => {
    schreibeEn(dir, englisch(erwartet(dir)));
    writeFileSync(join(dir, "agents", "probe.md"), DEUTSCH.replace("Schluss.", "Schluss, geaendert."));
    const neu = erwartet(dir).find((s) => s.kopf === "## Ende");
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /en\/agents\/probe\.md/);
    assert.match(res.stderr, /## Ende/);
    assert.ok(res.stderr.includes(`<!-- de: ${neu.stempel} -->`), res.stderr);
    assert.doesNotMatch(res.stderr, /## Ablauf/);
  });
});

test("abweichende Codebloecke sind gruen", () => {
  mitFixture((dir) => {
    const en = englisch(erwartet(dir), { befehl: "node .claude/kit/board.mjs issue order <id>" });
    schreibeEn(dir, en.replace("```bash", "```sh") + "\n```bash\necho extra\n```\n");
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 0, res.stderr);
  });
});

test("eine fehlende Fassung ist gruen", () => {
  mitFixture((dir) => {
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 0, res.stderr);
  });
});

test("ein lueckenloses Anfangsstueck ist gruen, eine Luecke nicht", () => {
  mitFixture((dir) => {
    const st = erwartet(dir);
    schreibeEn(dir, englisch(st, { bis: "## End" }));
    assert.equal(lauf(["--check"], dir).status, 0);

    const voll = englisch(st);
    schreibeEn(dir, voll.slice(0, voll.indexOf("## Steps")) + voll.slice(voll.indexOf("## End")));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /en\/agents\/probe\.md/);
    assert.match(res.stderr, /## Ablauf/);
  });
});

test("eine englische Fassung ohne deutsche Quelle wird gemeldet", () => {
  mitFixture((dir) => {
    mkdirSync(join(dir, "en", "agents"), { recursive: true });
    writeFileSync(join(dir, "en", "agents", "waise.md"), "# Orphan\n");
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /en\/agents\/waise\.md/);
  });
});
