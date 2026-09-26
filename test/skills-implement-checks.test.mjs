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
  //
  // Gemeint sind die Kommandozeilen, nicht jede Erwaehnung: Seit Issue #835
  // nennt die Regel zum Testumfang `checks.mjs run` auch im Fliesstext, und
  // eine Prosa-Zeile traegt nie ein `--since`.
  test(`${name}: der Aufruf uebergibt kein --since`, () => {
    const zeilen = text
      .split("\n")
      .filter((z) => z.includes("checks.mjs run") && z.trimStart().startsWith("node "));
    assert.ok(zeilen.length > 0, "der Aufruf `checks.mjs run` fehlt ganz");
    for (const zeile of zeilen) {
      assert.doesNotMatch(zeile, /--since/,
        "der Skill uebergibt einen eigenen Anker — den bestimmt das Kommando");
    }
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

// --- Abschlusslauf je Karte (Issue #952) ------------------------------------
//
// Die Mechanik aus Issue #946 wirkt erst, wenn der Abschluss einer Karte den
// Schalter setzt. Gesetzt wird er allein von den implement-Skills — `/local-check`
// misst den Stand mehrerer Pakete gegen den Merge-Base und bleibt aussen vor (E12).

const ABSCHLUSS_SKILLS = ["implement-next", "implement-ready", "implement-done", "implement-test"];

function skillText(name) {
  return readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
}

for (const name of ABSCHLUSS_SKILLS) {
  test(`${name}: der Pruefaufruf vor dem Commit traegt --abschluss <kartennummer>`, () => {
    const text = skillText(name);
    assert.match(text, /checks\.mjs run --abschluss <kartennummer>/,
      "der Abschlusslauf nennt die Kartennummer nicht — dann rechnet die Kennzahl je Karte nicht");
  });

  test(`${name}: der Skill begruendet den Abschlusslauf`, () => {
    const text = skillText(name);
    assert.match(text, /Abschluss genau einer Karte/i,
      "es fehlt der Satz, warum hier `--abschluss` gesetzt wird");
  });
}

for (const name of ["implement-next", "implement-ready", "implement-done"]) {
  test(`${name}: der Bericht uebernimmt die Auslassungen mit ihrem Grund`, () => {
    const text = skillText(name);
    assert.match(text, /Auslassungen? .{0,80}mit (ihrem|dem) Grund/i,
      "der Abschnitt zum Abschlussbericht sagt nicht, dass die Gruende uebernommen werden");
  });
}

test("local-check: der Pruefaufruf setzt kein --abschluss", () => {
  const text = skillText("local-check");
  const zeilen = text
    .split("\n")
    .filter((z) => z.includes("checks.mjs run") && z.trimStart().startsWith("node "));
  assert.ok(zeilen.length > 0, "der Aufruf `checks.mjs run` fehlt ganz");
  for (const zeile of zeilen) {
    assert.doesNotMatch(zeile, /--abschluss/,
      "`/local-check` misst mehrere Pakete gegen den Merge-Base — das ist kein Kartenabschluss");
  }
  assert.match(text, /kein `--abschluss`/,
    "es fehlt der Satz, warum hier kein `--abschluss` gesetzt wird — sonst liest ihn die naechste Session als Versehen");
});

test("push-main: der rote Zweig nennt die Verursacher-Karten und die neue Karte", () => {
  const text = skillText("push-main");
  assert.match(text, /Verursacher/,
    "der rote Zweig sagt nicht, dass der Lauf die verursachenden Karten nennt");
  assert.match(text, /neue Karte/i,
    "der rote Zweig sagt nicht, dass die Reparatur eine neue Karte ist");
  assert.match(text, /nicht aus .In review. zur(ü|ue)ck/i,
    "es fehlt, dass die verursachende Karte nicht aus In review zurueckwandert");
});
