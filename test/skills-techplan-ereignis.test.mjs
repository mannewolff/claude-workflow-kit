// Ablauf-Pruefung: `issue check-form` startet kit/board.mjs — Exit-Code und Ausgabe zeigt nur der
// gestartete Prozess.
//
// Ein wartender Fachplan tagsueber (Issue #1665, Plan #1624 E9, E10): `/techplan #N` nennt das
// Warten aus dem Feld `wartet` von `issue check-form` vor allem anderen und plant trotzdem;
// `/groom` und `/issue-review` erhalten die Zeile `Wartet auf Ereignis:` beim Zurueckschreiben.
//
// Geprueft werden TEXT der Skills und das Feld am lokalen Tracker. Nur die Quellen, nicht die
// Kopie unter `.claude/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { setupProjekt, board, runBoard } from "./helpers/board-fixture.mjs";
import { mitSzenarien } from "./helpers/szenarien-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

/** Der Abschnitt „Szenarien vor dem Plan“ bis zur naechsten Ueberschrift. */
function szenarienAbschnitt() {
  const skill = lies("skills", "techplan", "SKILL.md");
  const start = skill.indexOf("**Szenarien vor dem Plan.**");
  assert.ok(start >= 0, "Abschnitt Szenarien vor dem Plan fehlt");
  const ende = skill.indexOf("\n## ", start);
  return skill.slice(start, ende);
}

const BODY = mitSzenarien([
  "## Ziel", "Ein Export.", "",
  "Autor-Modell: claude-opus-5-5", "Wartet auf Ereignis: Tarif X waehlbar", "",
  "## Fachliche Akzeptanzkriterien", "1. Der Export liefert CSV.", "",
  "## Nicht-Ziele", "- Kein PDF.", "",
].join("\n"));

test("Szenario: Tagsüber gibt es einen Hinweis, aber keine Sperre", () => {
  const abschnitt = szenarienAbschnitt();
  assert.match(abschnitt, /Feld `wartet`/);
  assert.match(abschnitt, /issue check-form <N>/);
  assert.ok(abschnitt.includes("„Fachplan #N wartet auf ein Ereignis: <Grund>. Der Plan entsteht trotzdem; das Warten bleibt.“"));
  assert.match(abschnitt, /vor allem anderen/);
  assert.match(abschnitt, /auch unbeaufsichtigt/);
  assert.match(abschnitt, /ruft `issue hold` nicht auf/);

  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "techplan-ereignis-");
  try {
    board(dir, "issue", "create", "--title", "[Requirement] Export", "--body", BODY);
    board(dir, "issue", "create", "--title", "[Requirement] Export ohne", "--body", BODY.replace("Wartet auf Ereignis: Tarif X waehlbar\n", ""));
    const datei = join(dir, "issues", "0001.md");
    const vorher = readFileSync(datei, "utf-8");
    const mit = runBoard(dir, ["issue", "check-form", "1"]);
    const ohne = runBoard(dir, ["issue", "check-form", "2"]);
    assert.equal(JSON.parse(mit.stdout).wartet, "Tarif X waehlbar");
    assert.ok(!("wartet" in JSON.parse(ohne.stdout)));
    assert.equal(mit.status, ohne.status);
    assert.equal(readFileSync(datei, "utf-8"), vorher, "das Warten bleibt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/groom erhaelt die Wartezeile und ruft issue hold nie", () => {
  const skill = lies("skills", "groom", "SKILL.md");
  assert.match(skill, /Kennzeichnungszeilen \([^)]*`Wartet auf Ereignis:`[^)]*\) bleiben unverändert/);
  assert.match(skill, /`\/groom` ruft `issue hold` nie auf/);
});

test("/issue-review erhaelt die Wartezeile beim Einarbeiten", () => {
  const skill = lies("skills", "issue-review", "SKILL.md");
  assert.match(skill, /vorhandene Kennzeichnungszeilen \([^)]*`Wartet auf Ereignis:`[^)]*\) bleiben erhalten/);
});
