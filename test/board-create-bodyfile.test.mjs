// Tests fuer `issue create` mit Body aus Datei oder stdin (Issue #271).
//
// Issue #270 hat comment und update umgestellt, create blieb zurueck. Der Beleg
// entstand beim Anlegen von #271 selbst: `--body -` wurde als Literal gelesen,
// die Autor-Modell-Leitplanke fand darin keine Zeile und brach ab.
//
// Der heikle Teil ist das Zusammenspiel mit ebenjener Leitplanke (Issue #266):
// Sie muss auf dem AUFGELOESTEN Text laufen, nicht auf dem Argument.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { setupProjekt, runBoard, board, BOARD } from "./helpers/board-fixture.mjs";

const CONFIG = { issueTracker: "local", codeHost: "local", local: { issuesDir: "issues" } };
const projekt = () => setupProjekt(CONFIG, "create-bodyfile-");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function runMitStdin(dir, cliArgs, eingabe, extraEnv = {}) {
  return spawnSync(process.execPath, [BOARD, ...cliArgs], {
    cwd: dir, encoding: "utf-8", input: eingabe,
    env: { ...process.env, KIT_ROOT: dir, KIT_AGENT_MODEL: "fixture-modell", ...extraEnv },
  });
}

const BODY = [
  "## Kontext",
  "Autor-Modell: claude-opus-5",
  "Zeile mit 'Single' und \"Double\" Quote, $HOME und `backtick`.",
  "",
  "## Aufgabe",
  "Etwas tun.",
].join("\n");

test("issue create --body-file legt das Issue mit dem Dateiinhalt an", () => {
  const dir = projekt();
  const datei = join(dir, "body.md");
  writeFileSync(datei, BODY);
  const res = runBoard(dir, ["issue", "create", "--title", "Aus Datei", "--body-file", datei]);
  assert.equal(res.status, 0, res.stderr);
  const geholt = board(dir, "issue", "get", String(JSON.parse(res.stdout).id));
  assert.match(geholt.body, /\$HOME und `backtick`/);
  assert.match(geholt.body, /Zeile mit 'Single' und "Double" Quote/);
});

test("issue create --body - liest von stdin", () => {
  const dir = projekt();
  const res = runMitStdin(dir, ["issue", "create", "--title", "Aus stdin", "--body", "-"], BODY);
  assert.equal(res.status, 0, res.stderr);
  assert.match(board(dir, "issue", "get", String(JSON.parse(res.stdout).id)).body, /Etwas tun\./);
});

test("--body und --body-file gleichzeitig legen kein Issue an", () => {
  const dir = projekt();
  const datei = join(dir, "body.md");
  writeFileSync(datei, BODY);
  const res = runBoard(dir, ["issue", "create", "--title", "Konflikt", "--body", BODY, "--body-file", datei]);
  assert.notEqual(res.status, 0);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("ein Body von 20 KB geht ueber beide Wege durch", () => {
  const gross = `## Kontext\nAutor-Modell: m\n${"y".repeat(20_000)}\n`;
  const dirA = projekt();
  const datei = join(dirA, "gross.md");
  writeFileSync(datei, gross);
  assert.equal(runBoard(dirA, ["issue", "create", "--title", "Gross", "--body-file", datei]).status, 0);
  assert.ok(board(dirA, "issue", "get", "0001").body.includes("y".repeat(5000)));

  const dirB = projekt();
  assert.equal(runMitStdin(dirB, ["issue", "create", "--title", "Gross", "--body", "-"], gross).status, 0);
});

test("die Autor-Modell-Zeile aus der Datei wird erkannt, keine zweite ergaenzt", () => {
  const dir = projekt();
  const datei = join(dir, "body.md");
  writeFileSync(datei, BODY);
  const res = runBoard(dir, ["issue", "create", "--title", "Mit Zeile", "--body-file", datei]);
  const treffer = board(dir, "issue", "get", String(JSON.parse(res.stdout).id)).body.match(/^Autor-Modell: .*$/gm) || [];
  assert.equal(treffer.length, 1, `genau eine Zeile erwartet, gefunden: ${treffer.length}`);
  assert.equal(treffer[0], "Autor-Modell: claude-opus-5");
});

test("Datei ohne Autor-Modell und ohne Flag und ohne Umgebung -> kein Issue", () => {
  const dir = projekt();
  const datei = join(dir, "ohne.md");
  writeFileSync(datei, "## Kontext\nKeine Zeile hier.\n");
  const res = runBoard(dir, ["issue", "create", "--title", "Ohne", "--body-file", datei], { KIT_AGENT_MODEL: "" });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Autor-Modell:/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("--author-model setzt die Zeile in den Kontext-Abschnitt des Dateiinhalts", () => {
  const dir = projekt();
  const datei = join(dir, "ohne.md");
  writeFileSync(datei, "## Kontext\nWarum.\n\n## Aufgabe\nWas.\n");
  const res = runBoard(dir, ["issue", "create", "--title", "Per Flag", "--body-file", datei, "--author-model", "claude-fable-5"]);
  assert.equal(res.status, 0, res.stderr);
  const body = board(dir, "issue", "get", String(JSON.parse(res.stdout).id)).body;
  assert.match(body, /^Autor-Modell: claude-fable-5$/m);
  assert.ok(body.indexOf("Autor-Modell:") < body.indexOf("## Aufgabe"), "die Zeile steht nicht im Kontext-Abschnitt");
});

test("der /issues-Skill zeigt den stdin-Weg beim Anlegen", () => {
  const skill = readFileSync(join(repoRoot, "skills", "issues", "SKILL.md"), "utf-8");
  assert.doesNotMatch(skill, /issue create --title "Titel" --body "/,
    "der Skill zeigt noch den Argument-Weg");
  assert.match(skill, /--body -/);
  assert.match(skill, /ausserhalb des Projektverzeichnisses|außerhalb des Projektverzeichnisses/);
});
