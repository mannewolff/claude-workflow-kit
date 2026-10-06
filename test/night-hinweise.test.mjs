// Die Hinweis-Zeilen erreichen den Nacht-Runner (Issue #1156, Plan #1150, E11/E12).
//
// Eine Hinweis-Pruefung aus Issue #1155 endet immer `gruen` und traegt ihre Funde in
// `hinweise[]` der Zusammenfassung von `checks.mjs run`, je Kommando `{ cmd, zeilen }`.
// Der Runner uebernimmt sie in den Pruefstand der Einheit (Laufbericht-JSON), schreibt
// je Hinweis eine Zeile in den Pruefteil des Protokolls und unter `### Umsetzung` des
// Nachtberichts — und wertet sie nicht: Eine Einheit mit Hinweisen bleibt erfolgreich.
//
// E2E wie test/night-pruefstand-felder.test.mjs: Der Fake schreibt die Zusammenfassung
// selbst statt checks.mjs — gemessen wird, was der Runner aus der Datei macht. Die Zeilen
// des Berichts selbst prueft test/night-bericht-hinweise.test.mjs im selben Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const HINWEISE = [
  { cmd: "node tools/windows-brueche.mjs", zeilen: ["test/a.test.mjs:12 — Plattform-Skip ohne Vermerk", "kit/b.mjs:3 — Pfad in Mac-Schreibweise"] },
];

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nbin/\n");
  lfAttribute(join(dir, ".gitattributes"));
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.invalid"]],
    ["git", ["config", "user.name", "Night Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-q", "-m", "setup"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

function laufStand(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

function einheit(dir, id) {
  const treffer = laufStand(dir).einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand`);
  return treffer;
}

const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';

function summary(felder) {
  return `printf '%s' '${JSON.stringify(felder)}' > .claude/checks-summary.json`;
}

const GRUENER_LAUF = {
  laufen: [{ cmd: "true", ergebnis: "gruen", grund: "beruehrt", dauerMs: 5 }],
  ausgelassen: [],
};

test("[night-1156] Hinweise der Zusammenfassung stehen in pruefung.hinweise und im Protokoll, die Einheit bleibt erfolgreich", () => {
  const dir = setupProjekt("night-hinweise-mit-");
  try {
    const id = readyIssue(dir, "Paket mit Hinweis");
    const fake = [summary({ ...GRUENER_LAUF, hinweise: HINWEISE }), ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.deepEqual(e.pruefung.hinweise, HINWEISE);
    assert.equal(e.pruefung.zustand, "geprueft", "ein Hinweis aendert den Zustand nicht (E12)");
    assert.equal(e.ausgang, "erfolg", "eine Einheit mit Hinweisen bleibt erfolgreich");
    assert.equal(board(dir, "issue", "get", id).status, "in_review");

    const ausgabe = `${res.stdout}\n${res.stderr}`;
    assert.match(ausgabe, new RegExp(`- Issue #${id}: hinweis: test/a\\.test\\.mjs:12 — Plattform-Skip ohne Vermerk`));
    assert.match(ausgabe, new RegExp(`- Issue #${id}: hinweis: kit/b\\.mjs:3 — Pfad in Mac-Schreibweise`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-1156] eine Zusammenfassung ohne hinweise ergibt keine Hinweis-Zeile und pruefung.hinweise null", () => {
  const dir = setupProjekt("night-hinweise-ohne-");
  try {
    const id = readyIssue(dir, "Paket ohne Hinweis");
    const fake = [summary(GRUENER_LAUF), ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.pruefung.hinweise, null, "ein Stand ohne das Feld weiss nichts ueber Hinweise");
    assert.equal(e.ausgang, "erfolg");
    assert.doesNotMatch(`${res.stdout}\n${res.stderr}`, /: hinweis: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
