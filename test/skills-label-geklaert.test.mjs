// Das Label `kit:clarified` / `kit:geklaert` zeigt am Board, dass keine Frage an den PO offen ist (Issue #1587).
//
// Geprueft werden Register und TEXT: dass beide Skills und der Regeltext das Label nennen und dass
// die Kette weiter den Vermerk prueft, nicht das Label. Nur die Quellen, nicht die Kopie unter `.claude/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LABELS, erkenneLabel, labelName } from "../kit/board/namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

test("Register: kit:geklaert und kit:clarified sind dieselbe Sache", () => {
  assert.deepEqual({ ...LABELS.geklaert }, { de: "kit:geklaert", en: "kit:clarified" });
  assert.equal(erkenneLabel("kit:geklaert"), erkenneLabel("kit:clarified"));
  assert.equal(labelName(erkenneLabel("kit:geklaert")), "kit:clarified");
});

test("/issue-review setzt kit:clarified nach dem Vermerk aus issue questions", () => {
  const skill = lies("skills", "issue-review", "SKILL.md");
  assert.match(skill, /issue questions <id>/);
  assert.match(skill, /fragen\.vermerk/);
  assert.match(skill, /issue label add <id> kit:clarified/);
});

test("/groom setzt kit:clarified nach dem Vermerk und nennt die Ausnahme im Stop-Punkt", () => {
  const skill = lies("skills", "groom", "SKILL.md");
  assert.match(skill, /issue label add <N> kit:clarified/);
  assert.match(skill, /Einzige Ausnahme: `kit:clarified`/);
});

test("Regeltext nennt kit:clarified und dass die Kette weiter den Vermerk prueft", () => {
  const regel = lies("templates", "CLAUDE-workflow.md");
  assert.match(regel, /`kit:clarified`/);
  assert.match(regel, /Die Kette prueft weiter den Vermerk, nicht das Label/);
});
