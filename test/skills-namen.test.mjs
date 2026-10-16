// Skill-Namen und Skill-Beschreibungen nach Plan #1548, Block D (Issue #1567, E12, E13).
//
// Claude Code waehlt einen Skill an seiner Beschreibung im Frontmatter; die ist englisch, der
// Koerper bleibt deutsch (E12). Ob eine Beschreibung englisch ist, prueft eine Wortliste statt
// eines Modells: kein deutscher Umlaut und keines der Funktionswoerter `Nutze`, `wenn`, `der`,
// `und` als ganzes Wort.
//
// Kein Skill des Kits traegt den Namen eines Kommandos, das Claude Code selbst mitbringt
// (Kriterium 3 der fachlichen Quelle #1527). Die Liste steht mit Fassung und Stand in
// `test/fixtures/claude-code-kommandos.json` (E13); der Release-Schritt frischt sie auf.
//
// Kein Skill ruft einen frueheren Namen auf: weder einen deutschen Befehls-, Achsen-, Options-
// oder Wertnamen von board.mjs aus `ALTNAMEN` noch einen alten Skill-Namen. Dazu nennt der
// Koerper nur die englischen Titel-Praefixe und Labels.
//
// Geprueft wird die Quelle unter `skills/`, nicht die Kopie unter `.claude/skills/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALTNAMEN, LABELS, PRAEFIXE } from "../kit/board/namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name).sort();
const text = (name) => readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");

function beschreibung(name) {
  const [vorn, kopf] = text(name).split("\n---", 1)[0].split("---\n");
  assert.ok(vorn === "" && kopf, `${name}: kein Frontmatter`);
  const zeile = /^description: (.+)$/m.exec(kopf);
  assert.ok(zeile, `${name}: keine description`);
  return zeile[1];
}

const zeilenMit = (inhalt, muster) => inhalt.split("\n")
  .map((z, i) => [i + 1, z]).filter(([, z]) => muster.test(z)).map(([n, z]) => `${n}: ${z.trim().slice(0, 120)}`);

const esc = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
// Ein Name als ganzer Name: kein Wortzeichen und kein Bindestrich davor oder dahinter.
const ganz = (s) => `(?<![\\w-])${s}(?![\\w-])`;

test("Fixture: Fassung, Stand und Liste der eingebauten Kommandos", () => {
  const f = JSON.parse(readFileSync(join(repoRoot, "test", "fixtures", "claude-code-kommandos.json"), "utf-8"));
  assert.equal(f.fassung, "2.1.296");
  assert.equal(f.stand, "2026-10-12");
  assert.ok(Array.isArray(f.kommandos) && f.kommandos.length > 100, "die Liste ist zu kurz");
  for (const k of ["context", "review", "plan", "init", "code-review"]) assert.ok(f.kommandos.includes(k), `${k} fehlt`);
});

test("es gibt die 17 Skills", () => {
  assert.equal(SKILLS.length, 17, SKILLS.join(", "));
});

for (const name of SKILLS) {
  test(`${name}: description ist englisch`, () => {
    const d = beschreibung(name);
    assert.doesNotMatch(d, /[äöüÄÖÜß]/, `${name}: Umlaut in der description: ${d}`);
    for (const wort of ["Nutze", "wenn", "der", "und"]) {
      assert.doesNotMatch(d, new RegExp(`(?<![\\p{L}])${wort}(?![\\p{L}])`, "u"), `${name}: Wort "${wort}" in der description: ${d}`);
    }
  });
}

test("kein Skill-Name ist ein eingebautes Kommando von Claude Code", () => {
  const { kommandos } = JSON.parse(readFileSync(join(repoRoot, "test", "fixtures", "claude-code-kommandos.json"), "utf-8"));
  const treffer = SKILLS.filter((n) => kommandos.includes(n));
  assert.deepEqual(treffer, [], `Skill-Namen, die Claude Code selbst mitbringt: ${treffer.join(", ")}`);
});

// Die frueheren Namen als Aufruf: `board.mjs <achse>`, `<achse> <befehl>`, `protection <aktion>`,
// `--<option>` und `--<option> <wert>`.
const ALT_AUFRUFE = [
  ...Object.keys(ALTNAMEN.achsen).map((a) => [`Achse ${a}`, new RegExp(`board\\.mjs\\s+${ganz(esc(a))}`)]),
  ...Object.entries(ALTNAMEN.befehle).flatMap(([achse, befehle]) =>
    Object.keys(befehle).map((b) => [`Befehl ${achse} ${b}`, new RegExp(`${ganz(esc(achse))}\\s+${esc(b)}(?![\\w-])`)])),
  ...Object.keys(ALTNAMEN.schutz).map((a) => [`Aktion ${a}`, new RegExp(`(?:protection|schutz)\\s+${esc(a)}(?![\\w-])`)]),
  ["Befehl code schutz", /\bcode\s+schutz(?![\w-])/],
  ...Object.keys(ALTNAMEN.optionen).map((o) => [`Option --${o}`, new RegExp(`(?<![\\w-])--${esc(o)}(?![\\w-])`)]),
  ...Object.entries(ALTNAMEN.werte).flatMap(([option, werte]) =>
    Object.keys(werte).map((w) => [`Wert --${option} ${w}`, new RegExp(`--${esc(option)}[\\s=]+${esc(w)}(?![\\w-])`)])),
];

// Ein alter Skill-Name als Aufruf; Pfade wie `docs/plan.md` zaehlen nicht.
const ALTE_SKILLS = /(?<![\w/.-])\/(?:fachplan|kontext|context|review|plan|local-check)(?![\w-]|\.\w)/;

for (const name of SKILLS) {
  test(`${name}: ruft keinen frueheren Namen auf`, () => {
    const inhalt = text(name);
    const funde = [
      ...zeilenMit(inhalt, ALTE_SKILLS).map((z) => `alter Skill-Name — ${z}`),
      ...ALT_AUFRUFE.flatMap(([was, muster]) => zeilenMit(inhalt, muster).map((z) => `${was} — ${z}`)),
    ];
    assert.deepEqual(funde, [], `${name}:\n${funde.join("\n")}`);
  });

  test(`${name}: nennt nur englische Titel-Praefixe und Labels`, () => {
    const inhalt = text(name);
    const deutsch = [...Object.values(PRAEFIXE), ...Object.values(LABELS)].filter(({ de, en }) => de !== en).map(({ de }) => de);
    const funde = deutsch.flatMap((n) => zeilenMit(inhalt, new RegExp(ganz(esc(n)))).map((z) => `${n} — ${z}`));
    assert.deepEqual(funde, [], `${name}:\n${funde.join("\n")}`);
  });
}

// Die Skills sind einsprachig deutsch; was sie als feste Zeile schreiben, kommt ueber
// `board.mjs names` in der Projektsprache an (Issue #1568, Plan #1548, Entscheidung „Feste
// Zeilen der Skills über ein Kommando“). Jeder Skill, der Dokumente, Kommentare oder
// Markerzeilen schreibt, nennt das Kommando und die Regel.
const SCHREIBENDE = ["requirement", "techplan", "issues", "issue-review", "groom", "task",
  "implement-next", "implement-ready", "implement-test", "implement-done", "kit-review",
  "push-main", "retro", "document", "triage"];

for (const name of SCHREIBENDE) {
  test(`${name}: nennt board.mjs names und schreibt die ausgegebene Fassung`, () => {
    const inhalt = text(name);
    assert.match(inhalt, /^\*\*Feste Zeilen\.\*\* /m, `${name}: Absatz „Feste Zeilen“ fehlt`);
    assert.match(inhalt, /node \.claude\/kit\/board\.mjs names/, `${name}: Aufruf board.mjs names fehlt`);
    assert.match(inhalt.replaceAll(/\s+/g, " "), /schreibt die ausgegebene Fassung/, `${name}: Regel fehlt`);
  });
}

// Ein deutsches Schluesselwort, das ein Skill als Argument erwartet, heisst englisch (E14).
test("push-main erwartet die Modi prepare und emergency, nicht vorbereiten und notfall", () => {
  const inhalt = text("push-main");
  assert.match(inhalt, /`\/push-main prepare`/);
  assert.match(inhalt, /`\/push-main emergency`/);
  assert.doesNotMatch(inhalt, /\/push-main (?:vorbereiten|notfall)\b/);
  assert.doesNotMatch(inhalt, /Modus `vorbereiten`|\(`notfall`\)/);
});
