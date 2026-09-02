// Der Verweis auf die Aussage-ID im Testnamen (Issue #449, Plan #437).
//
// Das Gate aus Issue #451 prueft je Paket, dass jede `NEU`/`GEAENDERT`-Aussage von
// einem Test referenziert wird (A5). Erzeugt werden die Verweise beim Implementieren
// — also in den vier implement-Skills. Faellt die Passage bei einer Umformulierung
// heraus, geht das Gate bei jedem Paket mit einer neuen Aussage rot, ohne dass
// jemand wuesste, wie es gruen wird.
//
// Die Tests pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das
// Modell, das ihn liest. Die heiklen Stellen sind zwei: die Wortgleichheit des
// Blocks zwischen den drei test-schreibenden Skills (zwei Fassungen waeren zwei
// Wahrheiten darueber, was gilt) und die `GEAENDERT`-Regel — ein bloss
// nachgetragener Verweis ueber einem Test, der noch das alte Verhalten prueft,
// macht das Gate gruen, ohne dass die Aussage belegt waere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Quelle eines Skills unter `skills/` — nie die Dogfooding-Kopie. */
function quelle(name) {
  return readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
}

// Die drei Skills, die Tests schreiben, und der eine, der sie nur vorfindet.
const SCHREIBEND = ["implement-ready", "implement-next", "implement-test"];
const ALLE_VIER = [...SCHREIBEND, "implement-done"];

const SKILL = Object.fromEntries(ALLE_VIER.map((name) => [name, quelle(name)]));

/** Der Regelblock ab der Fettmarke bis zur naechsten Ueberschrift. */
function regelblock(name) {
  const text = SKILL[name];
  const idx = text.indexOf("**Aussage-ID in den Testnamen");
  assert.ok(idx >= 0, `in ${name} fehlt der Block zur Aussage-ID`);
  const rest = text.slice(idx);
  const grenze = rest.search(/\n#{2,4} /);
  return (grenze >= 0 ? rest.slice(0, grenze) : rest).trim();
}

// --- Je ein Test auf jede der vier Quellen -----------------------------------

for (const name of ALLE_VIER) {
  test(`${name}: die Verweisform \`[<ID>]\` und die ID-Form stehen im Skill`, () => {
    const block = regelblock(name);
    assert.match(block, /`\[<ID>\]`/, "die Verweisform `[<ID>]` fehlt");
    assert.match(block, /`<bereich>-<N>`/, "die ID-Form `<bereich>-<N>` fehlt");
    assert.match(
      block,
      /Titel-String|`test\("\[<ID>\]/,
      "es steht nicht, was „im Testnamen“ heisst",
    );
    assert.match(
      block,
      /@DisplayName/,
      "der Rueckfall fuer Sprachen ohne Klammern im Testnamen (JUnit, pytest) fehlt",
    );
    assert.match(
      block,
      /Dateitext/,
      "es steht nicht, dass der Verweis im Dateitext gefunden werden muss",
    );
  });

  test(`${name}: der Verweis gilt fuer NEU und GEAENDERT, ENTFAELLT ist ausgenommen`, () => {
    const block = regelblock(name);
    assert.match(block, /`NEU`/, "`NEU` ist nicht benannt");
    assert.match(block, /`GEAENDERT`/, "`GEAENDERT` ist nicht benannt");
    assert.match(
      block,
      /\*\*`ENTFAELLT` braucht keinen\*\* neuen Verweis/,
      "die Ausnahme fuer `ENTFAELLT` steht nicht ausdruecklich da",
    );
  });

  test(`${name}: die beiden Config-Felder sind mit Fundort benannt`, () => {
    const block = regelblock(name);
    assert.match(block, /`spec\.testPattern`/, "`spec.testPattern` fehlt");
    assert.match(block, /`spec\.testGlobs`/, "`spec.testGlobs` fehlt");
    assert.match(
      block,
      /`spec`-Block der `\.claude\/workflow\.config\.json`/,
      "der Fundort der beiden Felder ist nicht benannt",
    );
  });

  test(`${name}: KEINE und Projekte ohne spec-Block bleiben unveraendert`, () => {
    const block = regelblock(name);
    const zeile = block
      .split("\n")
      .find((z) => /`KEINE`/.test(z) && /`spec`-Block/.test(z));
    assert.ok(zeile, "kein Satz, der `KEINE` und den Fall ohne `spec`-Block zusammen nennt");
    assert.match(
      zeile,
      /aendert sich nichts|ändert sich nichts/,
      "es steht nicht, dass sich in beiden Faellen nichts aendert",
    );
  });
}

// --- Wortgleichheit unter den drei test-schreibenden Skills ------------------

test("der Block steht in implement-ready, -next und -test wortgleich", () => {
  const [erster, ...weitere] = SCHREIBEND;
  for (const name of weitere) {
    assert.equal(
      regelblock(name),
      regelblock(erster),
      `der Block in ${name} weicht von dem in ${erster} ab — zwei Fassungen sind zwei Wahrheiten`,
    );
  }
});

test("der Block steht im Test-Schritt des jeweiligen Skills", () => {
  const schritt = {
    "implement-ready": "### 3. Implementieren",
    "implement-next": "### 3. Implementieren",
    "implement-test": "### 4. Nur die Tests schreiben",
    "implement-done": "### 3. Pruefungen vor dem Commit",
  };
  for (const name of ALLE_VIER) {
    const anfang = SKILL[name].indexOf(schritt[name]);
    assert.ok(anfang >= 0, `in ${name} fehlt der Schritt '${schritt[name]}'`);
    const block = SKILL[name].indexOf("**Aussage-ID in den Testnamen");
    assert.ok(
      block > anfang,
      `in ${name} steht der Block vor '${schritt[name]}' statt darin`,
    );
    const naechster = SKILL[name].indexOf("\n### ", anfang + 1);
    assert.ok(
      naechster < 0 || block < naechster,
      `in ${name} steht der Block hinter dem Schritt '${schritt[name]}'`,
    );
  }
});

// --- implement-done: Pruefung vor dem Commit, kein Testschreiben -------------

test("implement-done fasst die Regel als Pruefung vor dem Commit", () => {
  const block = regelblock("implement-done");
  assert.match(
    block,
    /Pruefung vor dem Commit/,
    "der Block ist nicht als Pruefung vor dem Commit ueberschrieben",
  );
  assert.match(
    block,
    /nachgetragen/,
    "es steht nicht, dass ein fehlender Verweis nachgetragen wird",
  );
  assert.match(
    block,
    /ohne Ruecksprache/,
    "es steht nicht, dass das die eine Testcode-Aenderung ohne Ruecksprache ist",
  );
  assert.match(
    block,
    /kein Verhalten aendert|kein Verhalten ändert/,
    "der Grund (der Nachtrag aendert kein Verhalten) fehlt",
  );
});

test("implement-done widerspricht sich nicht: die Ausnahme steht auch bei der Testcode-Regel", () => {
  // Schritt 2 und der Stop-Punkt sagen „Testcode nicht anfassen“. Ohne den
  // Hinweis auf die Ausnahme laesen sich Skill und Regelblock gegenseitig auf.
  const text = SKILL["implement-done"];
  const stelle = text.split("\n").filter((z) => /Testcode/.test(z));
  assert.ok(stelle.length >= 2, "die Testcode-Regel steht nicht mehr an beiden Stellen");
  for (const zeile of stelle) {
    assert.match(
      zeile,
      /\[<ID>\]|Aussage-Verweis|Ausnahme/,
      `die Zeile nennt die Ausnahme nicht: ${zeile}`,
    );
  }
});

// --- Die GEAENDERT-Regel -----------------------------------------------------

test("ein unveraenderter Test ist bei GEAENDERT kein Beleg", () => {
  for (const name of ALLE_VIER) {
    assert.match(
      regelblock(name),
      /unveraenderter Test ist kein Beleg/,
      `in ${name} fehlt die Regel — der Verweis allein sagt bei \`GEAENDERT\` nichts`,
    );
  }
});

// --- Die Mehrfach-Form -------------------------------------------------------

test("mehrere Aussagen stehen als `[board-7] [board-8]` in eigenen Klammern", () => {
  for (const name of ALLE_VIER) {
    const block = regelblock(name);
    assert.match(block, /`\[board-7\] \[board-8\]`/, `in ${name} fehlt die Mehrfach-Form`);
    assert.match(
      block,
      /eigenen Klammer/,
      `in ${name} steht nicht, dass jede ID eine eigene Klammer bekommt`,
    );
  }
});

// --- Der Lese-Satz in allen vier Skills --------------------------------------

test("alle vier Skills lassen alle Abschnitte lesen, nicht nur vier", () => {
  for (const name of ALLE_VIER) {
    assert.ok(
      SKILL[name].includes("Lies alle Abschnitte des Issues"),
      `in ${name} fehlt der Satz 'Lies alle Abschnitte des Issues'`,
    );
    assert.ok(
      !SKILL[name].includes("Lies alle vier Abschnitte"),
      `in ${name} steht noch 'Lies alle vier Abschnitte' — genau der Abschnitt mit den IDs waere ausgeschlossen`,
    );
  }
});

test("der Lese-Satz nennt `## Spec-Wirkung` als Quelle der IDs", () => {
  const zusatz =
    "bei gesetztem `spec`-Block auch `## Spec-Wirkung`; daraus stammen die IDs fuer die Testnamen.";
  for (const name of ALLE_VIER) {
    assert.ok(
      SKILL[name].includes(zusatz),
      `in ${name} fehlt der Zusatz zum Lese-Satz woertlich`,
    );
  }
});
