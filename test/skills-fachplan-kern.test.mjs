// `/fachplan` nach dem Prozess-Umbau Stufe 1 (Issue #632).
//
// Der Eingang `/fachplan #T` kommt aus einem Halt an der Stopp-Klasse, die Form
// prueft `issue check-form` aus der Datei, label-sync und Vorfallsverweise sind weg.
// Story-Format, PO-Schleife und die Spur zurueck bleiben (skills-fachplan-autor,
// skills-task-halt [skills-8]).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { HALT_FOLGESAETZE } from "../kit/night/wartend.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "requirement", "SKILL.md"), "utf-8");

// Die Grenze stieg um die zwei Zeilen des Absatzes „Feste Zeilen“ (Issue #1568) und um
// die acht Zeilen des Abschnitts Szenarien im Story-Format samt seiner Regel (Issue #1594).
test("[skills-8] der Skill bleibt unter 120 Zeilen, ohne label-sync und ohne Issue-Verweise", () => {
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 120, `der Skill hat ${zeilen} Zeilen, erlaubt sind weniger als 120`);
  assert.ok(!SKILL.includes("label-sync"), "label-sync steht noch im Skill");
  assert.doesNotMatch(SKILL, /Issue #\d/, "eine Regel wird mit einer Issue-Nummer begruendet");
  assert.doesNotMatch(SKILL, /Abwaegungsbedarf|Abwägungsbedarf/, "der alte Anlass des Halts steht noch da");
});

test("[skills-8] check-form laeuft gegen die Datei, bevor das fachliche Issue entsteht", () => {
  const bash = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  assert.match(bash, /issue check-form --art requirement --body-file <tmpdir>\/neues-issue\.md --title "<Titel>"/);
  const check = SKILL.indexOf("issue check-form --art requirement");
  const create = SKILL.indexOf('issue create --art requirement --title "<Titel>"');
  assert.ok(check > 0 && create > check, "check-form steht nicht vor dem Anlegen");
  assert.match(SKILL, /erst bei `ok: true` folgt `issue create`/);
});

test("[skills-8] der Eingang #T kommt aus einem Halt an der Stopp-Klasse", () => {
  assert.match(SKILL, /Stopp-Klasse/, "die Stopp-Klasse ist nicht genannt");
  assert.ok(HALT_FOLGESAETZE.some((satz) => SKILL.includes(satz)), "der Folgesatz weicht von HALT_FOLGESAETZE in kit/night/wartend.mjs ab");
  assert.match(SKILL, /Punkt der Stopp-Klasse und die eine Frage/, "was der Halt-Kommentar traegt, steht nicht da");
});

// Kriterium 6 des Fachplans #1586: Beim Anlegen schreibt die Session die Szenarien mit,
// zwischen Kriterien und Nicht-Zielen, in den Schluesselwoertern der Projektsprache (Issue #1594).
test("[1594-1] das Story-Format traegt Szenarien zwischen Kriterien und Nicht-Zielen", () => {
  const block = SKILL.match(/```markdown\n([\s\S]*?)```/)[1];
  const kriterien = block.indexOf("## Fachliche Akzeptanzkriterien");
  const szenarien = block.indexOf("## Szenarien");
  const nichtZiele = block.indexOf("## Nicht-Ziele");
  assert.ok(kriterien >= 0 && szenarien > kriterien && nichtZiele > szenarien, "## Szenarien steht nicht zwischen Kriterien und Nicht-Zielen");
  assert.match(block, /### Szenario: <Titel>\n- Angenommen .*\n- Wenn .*\n- Dann /);
  assert.match(SKILL, /Szenarien schreibt die Session beim Anlegen mit/);
  assert.match(SKILL, /`## Scenarios`, `### Scenario: <title>`, `Given`, `When`, `Then`, `And`/);
  assert.match(SKILL, /weist `issue check-form` den Body mit F12 ab/);
});
