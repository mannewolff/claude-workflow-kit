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

import { HALT_FOLGESATZ } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "fachplan", "SKILL.md"), "utf-8");

test("[skills-8] der Skill bleibt unter 110 Zeilen, ohne label-sync und ohne Issue-Verweise", () => {
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 110, `der Skill hat ${zeilen} Zeilen, erlaubt sind weniger als 110`);
  assert.ok(!SKILL.includes("label-sync"), "label-sync steht noch im Skill");
  assert.doesNotMatch(SKILL, /Issue #\d/, "eine Regel wird mit einer Issue-Nummer begruendet");
  assert.doesNotMatch(SKILL, /Abwaegungsbedarf|Abwägungsbedarf/, "der alte Anlass des Halts steht noch da");
});

test("[skills-8] check-form laeuft gegen die Datei, bevor das fachliche Issue entsteht", () => {
  const bash = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  assert.match(bash, /issue check-form --body-file <tmpdir>\/neues-issue\.md --title "\[Fachlich\] <Titel>"/);
  const check = SKILL.indexOf("issue check-form --body-file");
  const create = SKILL.indexOf('issue create --title "[Fachlich] <Titel>"');
  assert.ok(check > 0 && create > check, "check-form steht nicht vor dem Anlegen");
  assert.match(SKILL, /erst bei `ok: true` folgt `issue create`/);
});

test("[skills-8] der Eingang #T kommt aus einem Halt an der Stopp-Klasse", () => {
  assert.match(SKILL, /Stopp-Klasse/, "die Stopp-Klasse ist nicht genannt");
  assert.ok(SKILL.includes(HALT_FOLGESATZ), "der Folgesatz weicht von HALT_FOLGESATZ in kit/night.mjs ab");
  assert.match(SKILL, /Punkt der Stopp-Klasse und die eine Frage/, "was der Halt-Kommentar traegt, steht nicht da");
});
