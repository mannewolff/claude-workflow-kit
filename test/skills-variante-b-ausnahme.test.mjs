// Die Ausnahme fuer Variante B in den Stop-Punkten der Skills (Issue #692, Test aus Issue #700).
//
// Unter Variante B der Nacht-Kette zieht allein der Nacht-Runner die entstandenen
// Arbeitspakete selbst nach Ready. Acht Skills nennen diese Ausnahme in ihrem
// Stop-Punkt-Abschnitt — und jeder haelt fuer sich selbst an der Regel fest, dass er
// keine Ready-Bewegung ausloest. Die acht Stellen sind bewusst verschieden formuliert;
// geprueft werden deshalb Teilstuecke, die in allen vorkommen, und je Skill die Wendung,
// mit der er die Ausnahme dem Runner zuweist.
//
// Gelesen wird die Quelle unter skills/, nicht die installierte Kopie unter .claude/skills/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(repoRoot, "skills");
const AUSNAHME = "Umsetzungsstufe der Nacht-Kette unter Variante B";

// Je Skill die Wendung, mit der er die Ausnahme nicht fuer sich in Anspruch nimmt.
const EIGENE_REGEL = {
  "implement-ready": /Ausserhalb dieser Stufe gilt/,
  "implement-next": /Ausserhalb dieser Stufe gilt/,
  "implement-done": /Ausserhalb dieser Stufe gilt/,
  "implement-test": /nicht diesen Skill/,
  issues: /nicht diesem Skill/,
  task: /nicht diesem Skill/,
  techplan: /nicht diesem Skill/,
  "issue-review": /nicht diesem Skill/,
};

const skillText = (name) => readFileSync(join(SKILLS, name, "SKILL.md"), "utf-8");

test("[skills-28] jeder der acht Skills nennt die Ausnahme fuer Variante B", () => {
  for (const name of Object.keys(EIGENE_REGEL)) {
    const text = skillText(name);
    assert.ok(text.includes(AUSNAHME), `${name}: die Ausnahme fuer die ${AUSNAHME} fehlt`);
    assert.ok(text.includes("Nacht-Runner"), `${name}: der Nacht-Runner als Traeger der Ausnahme fehlt`);
  }
});

test("[skills-28] keiner der acht Skills nimmt die Ausnahme fuer sich in Anspruch", () => {
  for (const [name, wendung] of Object.entries(EIGENE_REGEL)) {
    assert.match(skillText(name), wendung, `${name}: haelt nicht fest, dass die Ausnahme nicht dem Skill selbst gilt`);
  }
});

test("[skills-28] die Ausnahme steht nur in diesen acht Skills", () => {
  const andere = readdirSync(SKILLS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !(e.name in EIGENE_REGEL))
    .map((e) => e.name)
    .filter((name) => existsSync(join(SKILLS, name, "SKILL.md")));
  assert.ok(andere.length > 0, "keine weiteren Skills gefunden — die Gegenprobe prueft nichts");
  const mitAusnahme = andere.filter((name) => skillText(name).includes(AUSNAHME));
  assert.deepEqual(mitAusnahme, [], `die Ausnahme steht auch in: ${mitAusnahme.join(", ")}`);
});
