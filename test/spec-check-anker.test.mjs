// `spec.mjs check --anker` — das Gate vor dem Push (Issue #451).
//
// `apply` schreibt die Beschreibung fort, `check --anker` prueft, ob dabei auch
// wirklich ankam, was die Pakete angekuendigt haben. Zwei Fragen stellt es je
// gewertetem Paket:
//
//   Uebereinstimmung — Steht die Aussage so unter specs/, wie die Wirkungszeile
//   sie beschreibt? Bei NEU und GEAENDERT mit genau diesem Text, bei ENTFAELLT
//   unter '## Entfallen' mit dieser Paketnummer.
//
//   Test-Verweis (A5) — Traegt mindestens ein Test die Aussage-ID? Eine Zusage
//   ohne Test ist eine Behauptung.
//
// Der Ausfallpfad ist bewusst hart: Ist ein Body nicht lesbar oder fehlt
// 'spec.testGlobs', endet das Gate rot. Ein Gate, das bei Stoerung oeffnet, ist
// die Fehlerklasse aus Issue #316 — es saehe aus wie ein sauberer Durchlauf.
//
// Gemessen wird am Exit-Code und an den Meldungen, gegen ein echtes Repo und
// einen echten Adapter (helpers/spec-repo.mjs). Der gruene Fall entsteht durch
// einen echten `apply`-Lauf, nicht durch eine handgeschriebene Datei: Genau so
// laeuft es in /push-main, und nur so belegt der Test das Zusammenspiel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, spec, commit, kopf, paketAnlegen, SPEC_BLOCK, SEIT } from "./helpers/spec-repo.mjs";
// Reine Schreibhilfe ohne Bezug zur Fixture-Welt: Sie legt eine Datei samt
// Zwischenverzeichnissen an, und genau das brauchen die Tests fuer die Dateien
// unter 'spec.testGlobs'.
import { dateiSchreiben } from "./helpers/spec-fixture.mjs";

/** Der Block, mit dem das Gate vollstaendig pruefen kann — samt Suchraum fuer A5. */
const MIT_GLOBS = { ...SPEC_BLOCK, testGlobs: ["tests/**"] };

const UNBEKANNTER_SHA = "0000000000000000000000000000000000000000";

function mitGate(optionen, fn) {
  mitRepo({ specBlock: MIT_GLOBS, ...optionen }, fn);
}

/** Eine Testdatei, die auf die genannten Aussagen verweist — in der Default-Form `[<ID>]`. */
function verweisAnlegen(dir, ...ids) {
  const zeilen = ids.map((id) => `test("[${id}] die Zusage wird eingehalten", () => {});`);
  dateiSchreiben(dir, "tests/verweise.test.mjs", `${zeilen.join("\n")}\n`);
}

/**
 * Legt die Pakete an, committet je einen Commit mit Marke, schreibt die
 * Beschreibung fort und ruft dann das Gate.
 *
 * `fortschreiben: false` laesst `apply` aus — so sieht ein Batch aus, in dem die
 * Angabe eines Pakets nicht in der Beschreibung angekommen ist.
 */
function checkMit(dir, pakete, { fortschreiben = true, verweise = [] } = {}) {
  const anker = kopf(dir);
  for (const [nummer, optionen] of pakete) {
    paketAnlegen(dir, nummer, optionen);
    commit(dir, `Arbeit an ${nummer} (Issue #${nummer})`);
  }

  if (fortschreiben) {
    const vorlauf = spec(dir, "apply", "--anker", anker);
    assert.equal(vorlauf.status, 0, `apply haette gruen enden muessen: ${vorlauf.stderr}`);
  }
  if (verweise.length > 0) verweisAnlegen(dir, ...verweise);

  return { anker, res: spec(dir, "check", "--anker", anker) };
}

// --- Der gruene Fall --------------------------------------------------------

test("Pakete und Beschreibung passen zusammen, alle Verweise da: Exit 0", () => {
  mitGate({}, (dir) => {
    const { anker, res } = checkMit(dir, [
      [1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }],
      [2, { wirkung: "GEAENDERT alpha-1 — Der Lauf meldet jede Auslassung mit Grund." }],
      [3, { wirkung: "ENTFAELLT alpha-2 — Die Zusage geht in alpha-1 auf." }],
      [4, { wirkung: "KEINE — Reines Umbenennen ohne Wirkung auf das Verhalten." }],
    ], { verweise: ["alpha-5", "alpha-1"] });

    assert.equal(res.status, 0, `das Gate haette oeffnen muessen: ${res.stderr}`);
    assert.match(res.stdout, new RegExp(anker), "die Ausgabe nennt den Anker nicht");
    assert.match(res.stdout, /4 Pakete gewertet/, `die Ausgabe nennt die Zahl der Pakete nicht:\n${res.stdout}`);
  });
});

// --- Pruefung 1: Uebereinstimmung -------------------------------------------

const NICHT_ANGEKOMMEN = [
  ["NEU", 11, "NEU alpha alpha-5 — Der Lauf nennt seinen Anker.", "alpha-5"],
  ["GEAENDERT", 12, "GEAENDERT alpha-1 — Ein Text, den die Datei nicht traegt.", "alpha-1"],
  ["ENTFAELLT", 13, "ENTFAELLT alpha-3 — Die Zusage geht in alpha-1 auf.", "alpha-3"],
];

for (const [art, nummer, wirkung, id] of NICHT_ANGEKOMMEN) {
  test(`${art}: die Angabe ist nicht in der Beschreibung angekommen — Exit 1 mit Paketnummer und ID`, () => {
    mitGate({}, (dir) => {
      // Ohne `apply` steht in der Datei noch der alte Stand: genau der Fall, den
      // das Gate aufhalten soll — eine Zusage im Paket, die es nirgends gibt.
      const { res } = checkMit(dir, [[nummer, { wirkung }]], { fortschreiben: false, verweise: [id] });

      assert.equal(res.status, 1, "eine nicht angekommene Angabe haette rot enden muessen");
      assert.match(res.stderr, new RegExp(`#${nummer}\\b`), "die Meldung nennt die Paketnummer nicht");
      assert.match(res.stderr, new RegExp(id), "die Meldung nennt die Aussage-ID nicht");
    });
  });
}

test("ein gewertetes Paket ohne '## Spec-Wirkung': Exit 1 mit Paketnummer", () => {
  mitGate({}, (dir) => {
    const { res } = checkMit(dir, [[14, { wirkung: null }]], { fortschreiben: false });

    assert.equal(res.status, 1, "ein Paket ohne Wirkungsabschnitt haette rot enden muessen");
    assert.match(res.stderr, /#14\b/, "die Meldung nennt die Paketnummer nicht");
    assert.match(res.stderr, /Spec-Wirkung/, "die Meldung nennt den fehlenden Abschnitt nicht");
  });
});

// --- Pruefung 2: Test-Verweis (A5) ------------------------------------------

test("eine NEU-Aussage ohne Test-Verweis: Exit 1", () => {
  mitGate({}, (dir) => {
    // Die Beschreibung stimmt — es fehlt allein der Test, der die Zusage belegt.
    const { res } = checkMit(dir, [[21, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]]);

    assert.equal(res.status, 1, "eine Aussage ohne Test haette rot enden muessen");
    assert.match(res.stderr, /#21\b/, "die Meldung nennt die Paketnummer nicht");
    assert.match(res.stderr, /alpha-5/, "die Meldung nennt die Aussage-ID nicht");
  });
});

test("ENTFAELLT verlangt keinen Test-Verweis", () => {
  mitGate({}, (dir) => {
    // Es gibt keine Testdatei, die 'alpha-2' nennt — und das ist richtig so: Was
    // nicht mehr gilt, wird nicht mehr belegt.
    const { res } = checkMit(dir, [[22, { wirkung: "ENTFAELLT alpha-2 — Die Zusage geht in alpha-1 auf." }]]);

    assert.equal(res.status, 0, `eine entfallene Aussage braucht keinen Test: ${res.stderr}`);
  });
});

test("ohne 'spec.testGlobs': Exit 1 mit dem Grund 'nicht pruefbar' — das Gate oeffnet nicht", () => {
  mitGate({ specBlock: SPEC_BLOCK }, (dir) => {
    const { res } = checkMit(dir, [[23, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]], {
      verweise: ["alpha-5"],
    });

    assert.equal(res.status, 1, "ohne Suchraum haette das Gate nicht oeffnen duerfen");
    assert.match(res.stderr, /nicht pruefbar/, "die Meldung nennt den Grund nicht");
    assert.match(res.stderr, /testGlobs/, "die Meldung nennt das fehlende Feld nicht");
  });
});

// --- A18: der Stichtag ------------------------------------------------------

test("A18: ein Paket mit Anlagedatum gleich 'seit' wird gewertet, eines davor nicht", () => {
  mitGate({}, (dir) => {
    const { res } = checkMit(dir, [
      [31, { wirkung: "NEU alpha alpha-5 — Genau am Stichtag angelegt.", created: SEIT }],
      // Vor dem Stichtag und ganz ohne Abschnitt — das Gate darf es nicht sehen.
      [32, { wirkung: null, created: "2026-08-31" }],
    ], { fortschreiben: false });

    assert.equal(res.status, 1, "das Paket vom Stichtag haette einen Befund ergeben muessen");
    assert.match(res.stderr, /#31\b/, "das Paket vom Stichtag wurde nicht gewertet");
    assert.doesNotMatch(res.stderr, /#32\b/, "ein Paket von vor dem Stichtag wurde gewertet");
  });
});

test("A18: nur Pakete von vor dem Stichtag — Exit 0, auch ohne '## Spec-Wirkung'", () => {
  mitGate({}, (dir) => {
    const { res } = checkMit(dir, [[33, { wirkung: null, created: "2026-08-31" }]], { fortschreiben: false });

    assert.equal(res.status, 0, `ein Paket von vor dem Stichtag ist kein Befund: ${res.stderr}`);
    assert.match(res.stdout, /0 Pakete gewertet/, "die Ausgabe sagt nicht, dass nichts gewertet wurde");
  });
});

test("A18: ein Paket ohne Anlage-Eintrag gilt als alt und wird sichtbar uebersprungen", () => {
  // Der Aktivitaetsverlauf im kanban-kit beginnt erst mit V13 (2026-07-14) und wurde
  // nicht rueckgefuellt: Karten von davor haben keinen CREATED-Eintrag. Sie zu werten
  // hiesse, jede Altkarte dauerhaft zu blockieren — sie als Fehler zu behandeln
  // ebenso. Beim lokalen Tracker entspricht das einer Datei ohne `created:`.
  mitGate({}, (dir) => {
    const { res } = checkMit(dir, [[34, { wirkung: null, created: null }]], { fortschreiben: false });

    assert.equal(res.status, 0, `ein Paket ohne Anlage-Eintrag ist kein Befund: ${res.stderr}`);
    assert.match(res.stdout, /#34.*ohne Anlage-Eintrag/, "das uebersprungene Paket wurde nicht benannt");
    assert.doesNotMatch(res.stderr, /#34\b/, "das Paket wurde trotzdem gewertet");
  });
});

// --- Der Ausfallpfad --------------------------------------------------------

test("ein nicht lesbarer Body: Exit 1, die Meldung nennt die Paketnummer", () => {
  mitGate({}, (dir) => {
    const anker = kopf(dir);
    // Zu #42 liegt bewusst keine Datei unter issues/ — so sieht ein geloeschtes
    // oder fremdes Issue aus, und der Adapter scheitert daran wirklich.
    commit(dir, "Zweites Paket (Issue #42)");

    const res = spec(dir, "check", "--anker", anker);
    assert.equal(res.status, 1, "ein unlesbarer Body haette rot enden muessen");
    assert.match(res.stderr, /#42\b/, "die Meldung nennt die Paketnummer nicht");
  });
});

// --- Anker und Umfang -------------------------------------------------------

for (const [name, anker] of [["leer", ""], ["unbekannt", UNBEKANNTER_SHA]]) {
  test(`--anker ${name}: Exit 1 mit Meldung`, () => {
    mitGate({}, (dir) => {
      paketAnlegen(dir, 51, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." });
      commit(dir, "Erster Schritt (Issue #51)");

      const res = spec(dir, "check", "--anker", anker);
      assert.equal(res.status, 1, `ein ${name}er Anker haette rot enden muessen`);
      assert.match(res.stderr, /[Aa]nker/, "die Meldung nennt den Anker nicht");
    });
  });
}

test("kein Paket im Bereich: Exit 0, die Ausgabe nennt Anker und '0 Pakete gewertet'", () => {
  mitGate({}, (dir) => {
    const anker = kopf(dir);
    commit(dir, "Nur Kosmetik, ohne Marke");

    const res = spec(dir, "check", "--anker", anker);
    assert.equal(res.status, 0, `ein Bereich ohne Paket ist kein Fehler: ${res.stderr}`);
    // Ohne beide Angaben saehe ein falscher Anker aus wie ein sauberer Lauf.
    assert.match(res.stdout, new RegExp(anker), "die Ausgabe nennt den Anker nicht");
    assert.match(res.stdout, /0 Pakete gewertet/, `die Ausgabe nennt die Zahl nicht:\n${res.stdout}`);
  });
});

// --- Die Aufrufformen -------------------------------------------------------

test("check ohne --paket und ohne --anker: Exit 1", () => {
  mitGate({}, (dir) => {
    const res = spec(dir, "check");

    assert.equal(res.status, 1, "ein Aufruf ohne Flag haette rot enden muessen");
    assert.match(res.stderr, /--anker/, "die Hilfe nennt '--anker' nicht");
    assert.match(res.stderr, /--paket/, "die Hilfe nennt '--paket' nicht");
  });
});

test("check mit --paket und --anker zugleich: Exit 1", () => {
  mitGate({}, (dir) => {
    // Zwei Umfaenge in einem Aufruf: Welcher gilt, waere nicht zu entscheiden.
    const res = spec(dir, "check", "--paket", "paket.md", "--anker", kopf(dir));

    assert.equal(res.status, 1, "beide Flags zugleich haetten rot enden muessen");
    assert.match(res.stderr, /--anker/, "die Hilfe nennt '--anker' nicht");
    assert.match(res.stderr, /--paket/, "die Hilfe nennt '--paket' nicht");
  });
});

// --- Der Schalter -----------------------------------------------------------

test("ohne 'spec'-Block: Exit 0 und ein Hinweis, der 'spec' nennt", () => {
  mitGate({ specBlock: null }, (dir) => {
    const { res } = checkMit(dir, [[61, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]], {
      fortschreiben: false,
    });

    assert.equal(res.status, 0, `ohne Block wird nicht geprueft: ${res.stderr}`);
    assert.match(res.stderr, /spec/, "der Hinweis nennt den fehlenden Block nicht");
  });
});
