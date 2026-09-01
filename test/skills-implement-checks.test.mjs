// Tests fuer den Pruef-Aufruf in den drei implement-Skills (Issue #426).
//
// Der Nacht-Runner startet seine Sessions mit `/implement-next #<id>`. Die Skills
// nannten `local-check` nur als Leitplanken-Verweis und riefen nie eine Pruefung
// auf — dass die Checks trotzdem liefen, ergab sich aus Prosa. Damit ist dieser
// Ort die einzige Stelle, an der die bereichsbezogene Auswahl (Issue #422 ff.)
// den Nachtbetrieb ueberhaupt erreicht.
//
// Geprueft wird Text, nicht Verhalten — wie in
// `test/skills-issue-review-nightfail.test.mjs`. Der Wert liegt darin, dass eine
// spaetere Umformulierung auffaellt, bevor sie eine Nacht ungeprueft laufen laesst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SKILLS = ["implement-next", "implement-ready", "implement-done"].map((name) => ({
  name,
  text: readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8"),
}));

// Der Abschnitt ab "### Tests und Checks" bis zum Ende seines Codeblocks — dort
// steht das Berichtsformat, das die Session ausfuellt.
function berichtsformat(text) {
  const start = text.indexOf("### Tests und Checks");
  assert.notEqual(start, -1, "der Abschnitt '### Tests und Checks' fehlt");
  return text.slice(start, start + 600);
}

for (const { name, text } of SKILLS) {
  // Kriterium 9 aus Issue #420: Der Anker `HEAD` misst nur dann genau ein
  // Arbeitspaket, wenn der Aufruf VOR dem Commit steht. Danach saehe er nichts.
  test(`${name}: der checks.mjs-Aufruf steht vor dem Commit-Abschnitt`, () => {
    const aufruf = text.indexOf("checks.mjs run");
    assert.notEqual(aufruf, -1, "der Aufruf `checks.mjs run` fehlt ganz");

    const commit = text.search(/### \d+\. Lokal committen/);
    assert.notEqual(commit, -1, "der Commit-Abschnitt wurde nicht gefunden");
    assert.ok(aufruf < commit,
      "der Pruef-Aufruf steht hinter dem Commit — dann misst `HEAD` das Paket nicht mehr");
  });

  // Den Anker uebergibt der Skill nie selbst: `implement-*` prueft vor dem Commit
  // (Default `HEAD`), `/local-check` vor dem Push (merge-base). Ein hier
  // eingetragenes `--since` machte daraus zwei Rechenwege.
  test(`${name}: der Aufruf uebergibt kein --since`, () => {
    const zeile = text.split("\n").find((z) => z.includes("checks.mjs run"));
    assert.doesNotMatch(zeile, /--since/,
      "der Skill uebergibt einen eigenen Anker — den bestimmt das Kommando");
  });

  // Kriterium 11 aus Issue #420, erste der beiden Stellen. Nur die Laeufe zu
  // nennen genuegt nicht: Ein verkuerzter Lauf saehe aus wie ein vollstaendiger.
  test(`${name}: das Berichtsformat nennt gelaufene und ausgelassene Pruefungen`, () => {
    const format = berichtsformat(text);
    assert.match(format, /gelaufen/i,
      "das Berichtsformat weist die gelaufenen Pruefungen nicht als solche aus");
    assert.match(format, /ausgelassen/i,
      "das Berichtsformat nennt die ausgelassenen Pruefungen nicht");
    assert.match(format, /Grund/i,
      "zu den Auslassungen fehlt der Grund");
  });

  // Kriterium 10: Ein leeres Paket ist ein Ergebnis, kein Loch. Als leere Liste
  // waere es von "nichts berichtet" nicht zu unterscheiden.
  test(`${name}: der Fall leeresPaket steht ausdruecklich im Bericht`, () => {
    assert.match(text, /leeresPaket/,
      "der Skill nennt den Fall `leeresPaket` nicht");
    assert.match(text, /keine Pr(ü|ue)fung, weil nichts ver(ä|ae)ndert wurde/i,
      "der Wortlaut fuer das leere Paket fehlt — als leere Liste bliebe er unlesbar");
  });
}

// Die Leitplanken-Verweise betreffen das WIE der Ausfuehrung (Timeout,
// Hintergrund-Check, Modell-Fehler), nicht die Auswahl. Sie bleiben.
for (const name of ["implement-next", "implement-ready"]) {
  test(`${name}: die local-check-Leitplanken bleiben erhalten`, () => {
    const text = SKILLS.find((s) => s.name === name).text;
    assert.match(text, /Timeout-Leitplanke im `local-check`-Skill/);
    assert.match(text, /Hintergrund-Check im `local-check`-Skill/);
    assert.match(text, /Leitplanken-Prinzip im `local-check`-Skill/);
  });
}

// Bestandsdefekt: Der Absatz war in das `--text`-Argument des Beispielkommandos
// geraten. So kopiert, postete eine Session die Regel als Kommentartext.
test("implement-done: die Regel zu manuellen Pruefpunkten steht ausserhalb des Beispielkommandos", () => {
  const text = SKILLS.find((s) => s.name === "implement-done").text;
  assert.match(text, /\*\*Manuelle Pruefpunkte blockieren den Abschluss nicht\.\*\*/,
    "der Absatz fehlt ganz");

  const bloecke = text.match(/```bash\n[\s\S]*?```/g) ?? [];
  for (const block of bloecke) {
    assert.doesNotMatch(block, /Manuelle Pruefpunkte blockieren den Abschluss nicht/,
      "der Absatz steht in einem Kommando-Block statt als Prosa");
  }
});
