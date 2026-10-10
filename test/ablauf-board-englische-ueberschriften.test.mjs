// Ablauf-Pruefung: `issue auftrag` liest Plan, Fachplan und Voraussetzungen ueber das echte
// CLI von board.mjs, das nur ein Programmstart zeigt.
//
// `issue auftrag` liest englische Dokumente wie deutsche (Issue #1460, Plan #1420 E15).
// Ausgegliedert aus test/board-testhinweise-englische-ueberschriften.test.mjs, damit der Start
// von kit/board.mjs in einer Gruppe steht, die der Board-Einstieg ausloest (test/config-teile.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const PAKET_DE = "## Kontext\nAutor-Modell: claude-opus-5-5\n\n## Aufgabe\n1. `kit/x.mjs` aendern.\n\n"
  + "## Akzeptanzkriterium\n- `node --test test/x.test.mjs` ist gruen.\n\n## Abhaengigkeiten\nIssue #7\n";
const PAKET_EN = "## Context\nAuthor-Model: claude-opus-5-5\n\n## Task\n1. Change `kit/x.mjs`.\n\n"
  + "## Acceptance criteria\n- `node --test test/x.test.mjs` is green.\n\n## Dependencies\nIssue #7\n";
const PLAN_EN = "Plan-Model: claude-opus-5-5\n\n## Goal\nGoal.\n\n## Affected areas\n- `kit/x.mjs`\n\n"
  + "## Architectural decisions\n- Keine.\n\n## Planned changes\n- `kit/x.mjs`\n\n"
  + "## Open questions\n- Keine.\n\n## Verification\n- Tests.\n";
const FACHPLAN_EN = "## Goal\nGoal.\n\nAuthor-Model: claude-opus-5-5\n\n## Business acceptance criteria\n1. One.\n\n"
  + "## Non-goals\n- Nothing.\n\n## Open questions for the PO\nKeine.\n";

// --- issue auftrag mit englischen Dokumenten ---

const lokalDatei = (nr, status, titel, body) =>
  `---\nid: "${String(nr).padStart(4, "0")}"\ntype: task\nstatus: ${status}\ntitle: ${titel}\n---\n\n${body}`;

test("issue auftrag: Plan-Entscheidungen, fachlicher Anlass und Voraussetzungen aus englischen Dokumenten", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-englisch-");
  try {
    mkdirSync(join(dir, "issues"));
    const plan = PLAN_EN.replace("- Keine.\n\n## Planned", "- E1: Which?\n  Chosen: A.\n\n## Planned");
    const paket = PAKET_EN.replace("Author-Model: claude-opus-5-5", "Author-Model: x\nPlan: Issue #2\nRequirement: Issue #3")
      .replace("Issue #7", "Issue #4");
    writeFileSync(join(dir, "issues", "0001.md"), lokalDatei(1, "ready", "Paket", paket));
    writeFileSync(join(dir, "issues", "0002.md"), lokalDatei(2, "backlog", "[Plan] Weg", `Requirement: Issue #3\n\n${plan}`));
    writeFileSync(join(dir, "issues", "0003.md"), lokalDatei(3, "backlog", "[Requirement] Anlass", FACHPLAN_EN));
    writeFileSync(join(dir, "issues", "0004.md"), lokalDatei(4, "ready", "Voraussetzung", PAKET_DE));
    const res = runBoard(dir, ["issue", "auftrag", "1", "--json"]);
    assert.equal(res.status, 0, res.stderr);
    const a = JSON.parse(res.stdout);
    assert.deepEqual(a.planEntscheidungen.eintraege, [{ id: "E1", text: "- E1: Which?\n  Chosen: A." }]);
    assert.equal(a.fachlicherAnlass.ziel, "Goal.\n\nAuthor-Model: claude-opus-5-5");
    assert.equal(a.fachlicherAnlass.kriterien, "1. One.");
    assert.deepEqual(a.voraussetzungen.map((v) => v.id), ["4"]);
    assert.equal(a.urteil.folge, "bleibt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
