// `/issues` nach dem Prozess-Umbau Stufe 1 (Issue #631).
//
// Eingang ohne Marker, Entscheidungen im Kontext, check-form je Paket, kein
// Paket-Review als Regelfall. Der Rueckverweis-Abschnitt bleibt woertlich stehen —
// ihn halten skills-derived-from und skills-issues-planverweis fest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issues", "SKILL.md"), "utf-8");

/** Der Skill ohne den Rueckverweis-Abschnitt, der seine Issue-Nummern behalten darf. */
function ausserhalbRueckverweis() {
  const a = SKILL.indexOf("**Rückverweise auf Plan und fachliche Quelle:**");
  const b = SKILL.indexOf("**Zwei Randfälle:**");
  assert.ok(a > 0 && b > a, "der Rueckverweis-Abschnitt ist nicht mehr abgrenzbar");
  return SKILL.slice(0, a) + SKILL.slice(b);
}

test("[skills-14] der Skill bleibt unter 200 Zeilen, ohne label-sync und ohne Vorfallsverweise", () => {
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 200, `der Skill hat ${zeilen} Zeilen, erlaubt sind weniger als 200`);
  assert.ok(!SKILL.includes("label-sync"), "label-sync steht noch im Skill");
  assert.ok(!SKILL.includes("Plan-Review:"), "der Marker steht noch im Skill");
  assert.doesNotMatch(ausserhalbRueckverweis(), /Issue #\d/, "eine Regel wird ausserhalb des Rueckverweis-Abschnitts mit einer Issue-Nummer begruendet");
});

test("[skills-14] check-form laeuft je Paket gegen die Datei, bevor es entsteht", () => {
  const bash = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  assert.match(bash, /issue check-form --body-file <tmpdir>\/neues-issue\.md --title "<Titel>"/);
  const check = SKILL.indexOf("issue check-form --body-file <tmpdir>/neues-issue.md");
  const create = SKILL.indexOf('issue create --title "Titel" --body-file <tmpdir>/neues-issue.md');
  assert.ok(check > 0 && create > check, "check-form steht nicht vor dem Anlege-Block");
  assert.match(SKILL, /erst bei `ok: true` folgt `issue create`/);
});

test("[skills-14] Unklarheiten werden entschieden und stehen als Entscheidung: im Kontext", () => {
  assert.match(SKILL, /### Entscheiden statt fragen/);
  assert.match(SKILL, /^Entscheidung: /m, "die Zeilenform fehlt");
  assert.match(SKILL, /Stopp-Klasse/);
  assert.match(SKILL, /Kein Eingang für \/issues: offene Stopp-Frage/);
});

test("[skills-14] /issue-review kommt genau einmal vor, als Angebot im Abschluss", () => {
  const treffer = SKILL.match(/issue-review/g) || [];
  assert.equal(treffer.length, 1, `issue-review steht ${treffer.length}-mal, erlaubt ist einmal`);
  assert.ok(SKILL.indexOf("/issue-review #N") > SKILL.indexOf("### 4. Abschluss"), "das Angebot steht nicht im Abschluss");
  assert.match(SKILL, /Regelfall ist Ready ohne Paket-Review/);
});
