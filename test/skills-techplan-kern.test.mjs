// `/techplan` nach dem Prozess-Umbau Stufe 1 (Issue #630).
//
// Entscheidungen statt offener Fragen: Nur eine Stopp-Frage steht in
// `## Offene Fragen`, alles andere wird entschieden und als E-Eintrag festgehalten.
// Die Form prueft `issue check-form` aus der Datei, bevor das Plandokument entsteht;
// label-sync und Vorfallsverweise sind weg.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "techplan", "SKILL.md"), "utf-8");
const PLAN_REGISTER = readFileSync(join(repoRoot, "templates", "CLAUDE-Plan.md"), "utf-8");

test("[skills-2] der Skill bleibt unter 220 Zeilen, ohne label-sync und ohne Issue-Verweise", () => {
  const zeilen = SKILL.split("\n").length;
  assert.ok(zeilen < 220, `der Skill hat ${zeilen} Zeilen, erlaubt sind weniger als 220`);
  assert.ok(!SKILL.includes("label-sync"), "label-sync steht noch im Skill");
  assert.doesNotMatch(SKILL, /Issue #\d/, "eine Regel wird mit einer Issue-Nummer begruendet");
  assert.ok(!SKILL.includes("Annahme:"), "die alte Annahme-Form steht noch da");
});

test("[skills-2] check-form laeuft gegen die Datei, bevor das Plandokument entsteht", () => {
  const bash = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  assert.match(bash, /issue check-form --art plan --body-file <tmpdir>\/plandokument\.md --title "<Titel>"/);
  assert.ok(SKILL.indexOf("issue check-form --art plan") < SKILL.indexOf("**Angelegt über:**"),
    "check-form steht nicht vor dem Anlege-Block");
  assert.match(SKILL, /erst bei `ok: true` folgt `issue create`/);
});

test("[skills-2] Offene Fragen sind die Stopp-Klasse, Entscheidungen stehen als E-Eintraege", () => {
  const treffer = SKILL.match(/Entscheiden statt fragen/g) || [];
  assert.ok(treffer.length >= 2, `der Verweis steht ${treffer.length}-mal, erwartet in Schritt 1 und Schritt 3`);
  assert.match(SKILL, /Fragen aus der Stopp-Klasse in `CLAUDE-workflow\.md`/);
  assert.match(SKILL, /E-Einträge aus „Entscheiden statt fragen"/);
});

test("[skills-2] Gate P7 im Plan-Register verweist auf die Stopp-Klasse", () => {
  const p7 = PLAN_REGISTER.slice(PLAN_REGISTER.indexOf("## P7"), PLAN_REGISTER.indexOf("## P8"));
  assert.match(p7, /Stopp-Klasse/, "P7 nennt die Stopp-Klasse nicht");
  assert.match(p7, /Entscheiden statt fragen/, "P7 verweist nicht auf den Abschnitt");
  assert.doesNotMatch(p7, /Die Antwort aendert den Zuschnitt des Plans/, "die alte Definition steht noch da");
});

// Testhinweise der Formpruefung (Issue #1034, Plan #1029 A11, A12, E7): Interaktiv sieht der
// Mensch sie vor dem Anlegen, zusammen mit dem Plan; nachts entscheidet die Sitzung selbst,
// und was stehen bleibt, schreibt der Nacht-Runner an den Plan. Angehalten wird nie.

/** Der Text eines `###`-Schritts bis zum naechsten `###`. */
function schritt(nummer) {
  const start = SKILL.indexOf(`### ${nummer}. `);
  assert.ok(start !== -1, `Schritt ${nummer} fehlt`);
  const ende = SKILL.indexOf("\n### ", start + 5);
  return SKILL.slice(start, ende === -1 ? undefined : ende);
}

test("[skills-2] Schritt 4 prueft den Entwurf mit check-form --body-file und zeigt die hinweise mit dem Plan", () => {
  const vier = schritt(4);
  assert.match(vier, /check-form --art plan --body-file/, "Schritt 4 nennt check-form --art plan --body-file nicht");
  assert.match(vier, /`hinweise`/, "Schritt 4 nennt die hinweise nicht");
  assert.ok(SKILL.indexOf("hinweise") < SKILL.indexOf("### 5. "), "die Nennung steht nicht vor Schritt 5");
  assert.match(vier, /bleibt grün/, "Schritt 4 nennt die Aufnahme als ‚bleibt grün' nicht");
});

test("[skills-2] Schritt 5 haelt an Hinweisen nicht an, den Kommentar schreibt nachts der Nacht-Runner", () => {
  const fuenf = schritt(5);
  assert.match(fuenf, /json\.hinweise \?\? \[\]/, "Schritt 5 liest hinweise nicht");
  assert.match(fuenf, /Hinweise halten nie an/, "Schritt 5 sagt nicht, dass Hinweise nicht anhalten");
  assert.match(fuenf, /Nacht-Runner/, "Schritt 5 nennt den Nacht-Runner nicht");
  assert.ok(fuenf.includes("## Testhinweise der Formpruefung"), "Schritt 5 nennt den Kommentar-Anker nicht");
});

// Kriterium 4 und E6 aus Plan #1588 (Issue #1594): `/techplan #N` beginnt keinen Plan aus
// einem pflichtigen Fachplan ohne Szenarien; es nennt Grund und `/groom #N` und endet.
test("[1594-2] /techplan #N prueft am Eingang mit check-form und endet bei F12 mit /groom #N", () => {
  const eingang = SKILL.slice(SKILL.indexOf("## Eingang `/techplan #N`"), SKILL.indexOf("## Ablauf"));
  const bash = [...eingang.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  assert.match(bash, /node \.claude\/kit\/board\.mjs issue check-form <N>/, "check-form steht nicht am Eingang");
  assert.match(eingang, /`F12`/);
  assert.match(eingang, /den Weg `\/groom #N`/);
  assert.match(eingang, /es entsteht kein Plan/);
  assert.match(eingang, /Die Szenarien ergänzt der Skill nie selbst/);
});
