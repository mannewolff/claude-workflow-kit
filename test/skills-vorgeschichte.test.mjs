// Die Vorgeschichte in Regeltext und Skills (Issue #1543, Plan #1534).
//
// Die Regel steht einmal ausfuehrlich in `templates/CLAUDE-workflow.md`, Abschnitt
// „Vorgeschichte“ (englisch „History“); `/requirement` verweist darauf, `/techplan` ruft das
// Kommando in Schritt 2 und nennt `### Vorgeschichte` in Schritt 3, `/issue-review` sagt, dass
// der Pruefauftrag die gefundenen Fachplaene vollstaendig enthaelt. Geprueft wird Text, nicht
// Verhalten — wie in den uebrigen Skill-Tests. Die Skills gibt es seit Issue #1566 nur in einer
// Fassung; zweisprachig bleibt der Regeltext.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

/** Ein `##`-Abschnitt bis zur naechsten `##`-Ueberschrift. */
function abschnitt(text, kopf) {
  const start = text.indexOf(`\n${kopf}\n`);
  assert.ok(start > -1, `der Abschnitt '${kopf}' fehlt`);
  const ende = text.indexOf("\n## ", start + 1);
  return ende > -1 ? text.slice(start, ende) : text.slice(start);
}

const VERMERKE = ["`Nichts Einschlägiges gefunden.`", "`Keine Vorgeschichte gelesen: <Grund>`", "`Weitere Treffer: <Zahl>`"];
const WIDERSPRUCH = "`- Widerspruch: #N „<Zitat>“ — <Fundstelle>; <warum>`";

const REGEL = {
  de: {
    text: abschnitt(lies("templates", "CLAUDE-workflow.md"), "## Vorgeschichte"),
    kommando: "node .claude/kit/board.mjs issue history --terms",
    optionen: ["--files", "--without"],
    orte: [/`## Vorgeschichte` zwischen `## Nicht-Ziele` und `## Offene Fragen an den PO`/, /`### Vorgeschichte` am Ende von `## Betroffene Bereiche`/],
    rechenregel: /\(Treffer des Kommandos − im Dokument genannte Fundstellen\) \+ `weitere`/,
    keinHalt: /[Kk]ein Halt/,
    schalter: "außer `.claude/workflow.config.json` setzt `history` auf `false`",
  },
  en: {
    text: abschnitt(lies("en", "templates", "CLAUDE-workflow.md"), "## History"),
    kommando: "node .claude/kit/board.mjs issue history --terms",
    optionen: ["--files", "--without"],
    orte: [/`## History` stands between `## Non-goals` and `## Open questions for the PO`/, /`### History` stands at the end of `## Affected areas`/],
    rechenregel: /\(hits of the command − places named in the document\) \+ `weitere`/,
    keinHalt: /[Nn]o halt/,
    schalter: "unless `.claude/workflow.config.json` sets `history` to `false`",
  },
};

for (const [sprache, r] of Object.entries(REGEL)) {
  test(`[${sprache}] der Regeltext nennt Schalter, Kommando und die Zeilen fuer Suchbegriffe und Dateien`, () => {
    assert.ok(r.text.includes(r.schalter), "der Schalter fehlt");
    assert.ok(r.text.includes(r.kommando), "das Kommando fehlt");
    for (const option of r.optionen) assert.ok(r.text.includes(option), `die Option ${option} fehlt`);
    assert.ok(r.text.includes("`Suchbegriffe: <a>; <b>; …`"), "die Zeile Suchbegriffe fehlt");
    assert.ok(r.text.includes("`Dateien: <pfad>; …`") || r.text.includes("`Dateien: <path>; …`"), "die Zeile Dateien fehlt");
  });

  test(`[${sprache}] der Regeltext nennt beide Orte`, () => {
    for (const ort of r.orte) assert.match(r.text, ort);
  });

  test(`[${sprache}] der Regeltext nennt Widerspruchszeile, die drei Vermerke und die Rechenregel`, () => {
    assert.ok(r.text.includes(WIDERSPRUCH), "die Form der Widerspruchszeile fehlt");
    for (const vermerk of VERMERKE) assert.ok(r.text.includes(vermerk), `der Vermerk ${vermerk} fehlt`);
    assert.match(r.text, r.rechenregel, "die Rechenregel fuer die weiteren Treffer fehlt");
  });

  test(`[${sprache}] ein Widerspruch haelt nichts an`, () => {
    assert.match(r.text, r.keinHalt, "dass ein Widerspruch nichts anhaelt, steht nicht da");
  });
}

test("/requirement verweist auf den Abschnitt Vorgeschichte", () => {
  assert.match(lies("skills", "requirement", "SKILL.md"), /`CLAUDE-workflow\.md`, Abschnitt „Vorgeschichte“/);
});

test("Regeltext und Skills knuepfen die Vorgeschichte an `history` ungleich `false` (Issue #1727)", () => {
  for (const datei of [["templates", "CLAUDE-workflow.md"], ["skills", "requirement", "SKILL.md"], ["skills", "techplan", "SKILL.md"], ["skills", "issue-review", "SKILL.md"]]) {
    assert.ok(!lies(...datei).includes("gesetztem Schalter"), `${datei.join("/")} nennt noch den gesetzten Schalter`);
  }
  assert.ok(!REGEL.de.text.includes("wie bisher"), "der Satz „ohne ihn entsteht jedes Dokument wie bisher“ steht noch da");
  assert.ok(!REGEL.en.text.includes("as before"), "der Satz „without it every document comes about as before“ steht noch da");
});

test("/techplan ruft das Kommando in Schritt 2 und nennt `### Vorgeschichte` samt woertlicher Uebernahme", () => {
  const skill = lies("skills", "techplan", "SKILL.md");
  const schritt2 = skill.slice(skill.indexOf("### 2. "), skill.indexOf("### 3. "));
  assert.match(schritt2, /issue history --terms .*--files .*--without/);
  const schritt3 = skill.slice(skill.indexOf("### 3. "), skill.indexOf("### 4. "));
  assert.ok(schritt3.includes("`### Vorgeschichte`"), "`### Vorgeschichte` fehlt in Schritt 3");
  assert.match(schritt3, /`- Widerspruch:`-Zeilen aus `## Vorgeschichte` der Fachlichen Quelle wörtlich/);
  const nacht = abschnitt(skill, "## Im Nachtbetrieb");
  assert.match(nacht, /Widerspruch .*kein E-Eintrag und keine Stopp-Frage/);
});

test("/issue-review nennt die Vorgeschichte im Pruefauftrag", () => {
  assert.match(lies("skills", "issue-review", "SKILL.md"), /außer `history` ist `false`.*gefundenen Fachpläne vollständig/);
});
