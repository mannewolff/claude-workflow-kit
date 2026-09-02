// `spec.mjs apply --anker` — die Fortschreibung der Beschreibung (Issue #450).
//
// `apply` ist der einzige Schreiber unter specs/: Es liest die Wirkungsangaben
// der Pakete zwischen Anker und HEAD und traegt sie in die Bereichsdateien ein.
// Drei Eigenschaften entscheiden darueber, ob es taugt:
//
//   Atomaritaet — Erst wenn alle Bodies gelesen und geprueft sind, wird die erste
//   Datei geschrieben. Ein halb fortgeschriebener Stand waere schlimmer als gar
//   keiner: Er saehe aus wie ein Ergebnis.
//
//   Idempotenz — Solange nicht gepusht ist, liegen bei jedem Lauf dieselben Pakete
//   im Bereich. Ohne Idempotenz haenge `NEU` die Aussage ein zweites Mal an, und
//   das Gate aus #451 saehe danach eine Beschreibung, die zum Paket passt.
//
//   A13 — `ENTFAELLT` loescht nicht, es verschiebt unter `## Entfallen`. Was einmal
//   zugesagt war, bleibt sichtbar; die ID bleibt vergeben.
//
// Gemessen wird am Exit-Code und an den Dateien, nie an einer Zwischenschicht: Der
// Adapter ist echt, das Repo ist echt (siehe helpers/spec-repo.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  mitRepo, spec, commit, kopf, paketAnlegen, specText, specStand, listing, git, SEIT,
} from "./helpers/spec-repo.mjs";

/** Das lokale Tagesdatum — dieselbe Rechnung wie `heute()` in spec.mjs. */
function heute() {
  const jetzt = new Date();
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}`;
}

/**
 * Legt die Pakete an, committet je einen Commit mit Marke und ruft `apply`.
 * Der Anker wird vor dem ersten Commit genommen — genau wie im Ernstfall die
 * merge-base gegen den Remote-Stand.
 */
function vorbereiten(dir, pakete) {
  const anker = kopf(dir);
  for (const [nummer, optionen] of pakete) {
    paketAnlegen(dir, nummer, optionen);
    commit(dir, `Arbeit an ${nummer} (Issue #${nummer})`);
  }
  return anker;
}

function applyMit(dir, pakete, ...extra) {
  const anker = vorbereiten(dir, pakete);
  return { anker, res: spec(dir, "apply", "--anker", anker, ...extra) };
}

function gruen(res) {
  assert.equal(res.status, 0, `apply haette gruen enden muessen: ${res.stderr}`);
  return res;
}

// --- Die vier Wirkungsarten -------------------------------------------------

test("NEU haengt die Aussage im gueltigen Teil des Bereichs an", () => {
  mitRepo({}, (dir) => {
    const { res } = applyMit(dir, [[1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]]);
    gruen(res);

    const text = specText(dir, "alpha.md");
    assert.match(text, /^- alpha-5 — Der Lauf nennt seinen Anker\.$/m,
      "die neue Aussage steht nicht in der Datei");
    // Oberhalb von '## Entfallen' — sonst gilt sie von Geburt an als gestrichen.
    assert.ok(text.indexOf("- alpha-5 —") < text.indexOf("## Entfallen"),
      "die neue Aussage steht unter '## Entfallen'");
  });
});

test("GEAENDERT ersetzt den Aussagetext, die ID bleibt", () => {
  mitRepo({}, (dir) => {
    const { res } = applyMit(dir, [[1, { wirkung: "GEAENDERT alpha-1 — Der Lauf meldet jede Auslassung mit Grund." }]]);
    gruen(res);

    const text = specText(dir, "alpha.md");
    assert.match(text, /^- alpha-1 — Der Lauf meldet jede Auslassung mit Grund\.$/m);
    assert.doesNotMatch(text, /ausgelassene Pruefung/, "der alte Text steht noch da");
    assert.equal(text.match(/^- alpha-1 —/gm).length, 1, "die ID steht doppelt in der Datei");
  });
});

test("ENTFAELLT verschiebt die Aussage unter '## Entfallen', mit Datum und Paketnummer", () => {
  mitRepo({}, (dir) => {
    const { res } = applyMit(dir, [[7, { wirkung: "ENTFAELLT alpha-2 — Die Zusage geht in alpha-1 auf." }]]);
    gruen(res);

    const text = specText(dir, "alpha.md");
    const zeile = `- alpha-2 — Ein leeres Paket wird als solches benannt. (entfallen ${heute()}, Paket #7)`;
    assert.ok(text.includes(zeile), `die entfallene Aussage fehlt in dieser Form:\n${text}`);
    // A13: verschoben, nicht geloescht — und unterhalb der Ueberschrift.
    assert.ok(text.indexOf(zeile) > text.indexOf("## Entfallen"),
      "die entfallene Aussage steht oberhalb von '## Entfallen'");
    // Der Grund gehoert ins Paket, nicht in die Beschreibung.
    assert.doesNotMatch(text, /geht in alpha-1 auf/, "der Grund aus der ENTFAELLT-Zeile ist in die Datei gewandert");
  });
});

test("KEINE aendert keine einzige Spec-Datei", () => {
  mitRepo({}, (dir) => {
    const vorher = specStand(dir);
    const { res } = applyMit(dir, [[1, { wirkung: "KEINE — Reines Umbenennen ohne Wirkung auf das Verhalten." }]]);
    gruen(res);

    assert.equal(specStand(dir), vorher, "eine Wirkung 'KEINE' hat etwas geschrieben");
  });
});

// --- Reihenfolge und Idempotenz ---------------------------------------------

test("die Wirkungen greifen in Commit-Reihenfolge: NEU in Paket 1, GEAENDERT in Paket 2", () => {
  mitRepo({}, (dir) => {
    const { res } = applyMit(dir, [
      [1, { wirkung: "NEU alpha alpha-5 — Erster Text." }],
      [2, { wirkung: "GEAENDERT alpha-5 — Zweiter Text." }],
    ]);
    gruen(res);

    const text = specText(dir, "alpha.md");
    assert.match(text, /^- alpha-5 — Zweiter Text\.$/m, "der geaenderte Text ist nicht angekommen");
    assert.doesNotMatch(text, /Erster Text/, "der erste Text steht noch da");
  });
});

test("zweimal derselbe Anker: byte-gleiche Dateien und Exit 0", () => {
  mitRepo({}, (dir) => {
    const { anker, res } = applyMit(dir, [
      [1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }],
      [2, { wirkung: "ENTFAELLT alpha-3 — Aufgegangen in alpha-5." }],
    ]);
    gruen(res);
    const nachErstem = specStand(dir);

    gruen(spec(dir, "apply", "--anker", anker));
    assert.equal(specStand(dir), nachErstem, "der zweite Lauf hat die Dateien veraendert");
  });
});

test("NEU mit vergebener ID und anderem Text: Exit 1, Meldung nennt ID und Paket", () => {
  mitRepo({}, (dir) => {
    const vorher = specStand(dir);
    const { res } = applyMit(dir, [[9, { wirkung: "NEU alpha alpha-1 — Ein voellig anderer Text." }]]);

    assert.equal(res.status, 1, "der Konflikt haette rot enden muessen");
    assert.match(res.stderr, /alpha-1/, "die Meldung nennt die ID nicht");
    assert.match(res.stderr, /#9/, "die Meldung nennt die Paketnummer nicht");
    assert.equal(specStand(dir), vorher, "trotz Konflikt wurde geschrieben");
  });
});

// --- Atomaritaet ------------------------------------------------------------

test("ein unlesbarer Body haelt auch die Wirkung des lesbaren Pakets zurueck", () => {
  mitRepo({}, (dir) => {
    const vorher = specStand(dir);
    const anker = kopf(dir);

    paketAnlegen(dir, 1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." });
    commit(dir, "Erstes Paket (Issue #1)");
    // Zu #2 liegt bewusst keine Datei unter issues/ — so sieht ein geloeschtes
    // oder fremdes Issue aus, und der Adapter scheitert daran wirklich.
    commit(dir, "Zweites Paket (Issue #2)");

    const res = spec(dir, "apply", "--anker", anker);
    assert.equal(res.status, 1, "ein unlesbarer Body haette rot enden muessen");
    assert.match(res.stderr, /#2/, "die Meldung nennt die Paketnummer des unlesbaren Bodys nicht");
    assert.equal(specStand(dir), vorher, "die Wirkung des lesbaren Pakets wurde trotzdem geschrieben");
  });
});

test("ein gewertetes Paket ohne '## Spec-Wirkung': Exit 1 mit Paketnummer", () => {
  mitRepo({}, (dir) => {
    const vorher = specStand(dir);
    const { res } = applyMit(dir, [[4, { wirkung: null }]]);

    assert.equal(res.status, 1, "ein Paket ohne Wirkungsabschnitt haette rot enden muessen");
    assert.match(res.stderr, /#4/, "die Meldung nennt die Paketnummer nicht");
    assert.match(res.stderr, /Spec-Wirkung/, "die Meldung nennt den fehlenden Abschnitt nicht");
    assert.equal(specStand(dir), vorher);
  });
});

test("eine formwidrige Wirkungszeile: Exit 1, nichts geschrieben", () => {
  mitRepo({}, (dir) => {
    const vorher = specStand(dir);
    // Bindestrich statt Gedankenstrich — die Falle aus A12.
    const { res } = applyMit(dir, [[5, { wirkung: "NEU alpha alpha-5 - Mit Bindestrich." }]]);

    assert.equal(res.status, 1, "eine formwidrige Zeile haette rot enden muessen");
    assert.match(res.stderr, /#5/, "die Meldung nennt die Paketnummer nicht");
    assert.equal(specStand(dir), vorher);
  });
});

// --- Beschaffung der Paketnummern -------------------------------------------

test("nur die Betreffzeile zaehlt: Body-Nummer, markenloser Commit, Doppel-Commit", () => {
  mitRepo({}, (dir) => {
    const anker = kopf(dir);

    paketAnlegen(dir, 1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." });
    // Zu #2 gibt es keine Datei: Wuerde die im Body zitierte Nummer gewertet,
    // scheiterte der Lauf am unlesbaren Body — der Fehlschlag waere der Beweis.
    commit(dir, "Erster Schritt (Issue #1)", "Siehe auch Issue #2 und foo/bar#3.\n\nRefs #1");
    commit(dir, "Zwischendurch aufgeraeumt");
    commit(dir, "Zweiter Schritt (Issue #1)");

    const res = spec(dir, "apply", "--anker", anker);
    gruen(res);

    const text = specText(dir, "alpha.md");
    assert.equal(text.match(/^- alpha-5 —/gm).length, 1,
      "das zweimal genannte Paket hat die Aussage zweimal angehaengt");
  });
});

test("kein Paket im Bereich: Hinweis, Exit 0, nichts geschrieben", () => {
  mitRepo({}, (dir) => {
    const vorher = specStand(dir);
    const anker = kopf(dir);
    commit(dir, "Nur Kosmetik, ohne Marke");

    const res = spec(dir, "apply", "--anker", anker);
    assert.equal(res.status, 0, `ein Bereich ohne Paket ist kein Fehler: ${res.stderr}`);
    assert.equal(specStand(dir), vorher, "ohne Paket wurde geschrieben");
  });
});

test("A18: ein Paket mit Anlagedatum gleich 'seit' wird gewertet, eines davor nicht", () => {
  mitRepo({}, (dir) => {
    const { res } = applyMit(dir, [
      [1, { wirkung: "NEU alpha alpha-5 — Genau am Stichtag angelegt.", created: SEIT }],
      [2, { wirkung: "NEU alpha alpha-6 — Einen Tag zu frueh angelegt.", created: "2026-08-31" }],
    ]);
    gruen(res);

    const text = specText(dir, "alpha.md");
    assert.match(text, /^- alpha-5 —/m, "das Paket vom Stichtag wurde nicht gewertet");
    assert.doesNotMatch(text, /^- alpha-6 —/m, "ein Paket von vor dem Stichtag wurde gewertet");
  });
});

// --- Anker ------------------------------------------------------------------

for (const [name, anker] of [["leer", ""], ["unbekannt", "0000000000000000000000000000000000000000"]]) {
  test(`--anker ${name}: Exit 1, keine Datei geaendert`, () => {
    mitRepo({}, (dir) => {
      const vorher = specStand(dir);
      paketAnlegen(dir, 1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." });
      commit(dir, "Erster Schritt (Issue #1)");

      const res = spec(dir, "apply", "--anker", anker);
      assert.equal(res.status, 1, `ein ${name}er Anker haette rot enden muessen`);
      assert.equal(specStand(dir), vorher);
    });
  });
}

test("ohne --anker: Exit 1", () => {
  mitRepo({}, (dir) => {
    const res = spec(dir, "apply");
    assert.equal(res.status, 1, "apply ohne Anker haette rot enden muessen");
    assert.match(res.stderr, /--anker/, "die Meldung nennt den fehlenden Schalter nicht");
  });
});

// --- Vorschau ---------------------------------------------------------------

test("--dry-run: Diff auf stdout, keine Datei geaendert und keine neu entstanden", () => {
  mitRepo({}, (dir) => {
    const anker = vorbereiten(dir, [[1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]]);
    // Der Stand wird erst nach dem Anlegen der Pakete genommen: Gemessen wird,
    // was `apply` hinterlaesst, nicht was der Test selbst angelegt hat.
    const standVorher = specStand(dir);
    const listingVorher = listing(dir);

    const res = spec(dir, "apply", "--anker", anker, "--dry-run");
    gruen(res);

    assert.match(res.stdout, /^--- specs\/alpha\.md$/m, "der Diff nennt die alte Datei nicht");
    assert.match(res.stdout, /^\+\+\+ specs\/alpha\.md$/m, "der Diff nennt die neue Datei nicht");
    assert.match(res.stdout, /^@@ /m, "der Diff hat keinen Hunk-Kopf");
    assert.match(res.stdout, /^\+- alpha-5 — Der Lauf nennt seinen Anker\.$/m,
      "die neue Zeile steht nicht als Zugang im Diff");

    assert.equal(specStand(dir), standVorher, "--dry-run hat geschrieben");
    assert.deepEqual(listing(dir), listingVorher, "--dry-run hat etwas angelegt");
  });
});

test("--dry-run legt weder specs/ noch eine Bereichsdatei an", () => {
  mitRepo({ fixture: null }, (dir) => {
    const anker = vorbereiten(dir, [[1, { wirkung: "NEU gamma gamma-1 — Die Auskunft antwortet auch ohne Datei." }]]);
    const listingVorher = listing(dir);

    const res = spec(dir, "apply", "--anker", anker, "--dry-run");
    gruen(res);

    assert.match(res.stdout, /^\+\+\+ specs\/gamma\.md$/m, "der Diff nennt die neue Datei nicht");
    assert.equal(existsSync(join(dir, "specs")), false, "--dry-run hat specs/ angelegt");
    assert.deepEqual(listing(dir), listingVorher, "--dry-run hat etwas angelegt");
  });
});

test("--dry-run ohne Wirkung: 'keine Aenderung'", () => {
  mitRepo({}, (dir) => {
    const { res } = applyMit(dir, [[1, { wirkung: "KEINE — Reines Umbenennen ohne Wirkung auf das Verhalten." }]], "--dry-run");
    gruen(res);

    assert.match(res.stdout, /^keine Aenderung$/m, "die Vorschau sagt nicht, dass nichts zu tun ist");
  });
});

// --- Neue Bereiche und der Index --------------------------------------------

test("NEU in einen Bereich ohne Datei erzeugt die Datei samt '## Entfallen'", () => {
  mitRepo({ fixture: null }, (dir) => {
    const { res } = applyMit(dir, [[1, { wirkung: "NEU gamma gamma-1 — Die Auskunft antwortet auch ohne Config." }]]);
    gruen(res);

    const text = specText(dir, "gamma.md");
    assert.match(text, /^- gamma-1 — Die Auskunft antwortet auch ohne Config\.$/m);
    assert.match(text, /^## Entfallen$/m, "die neue Datei hat keinen Abschnitt '## Entfallen'");
  });
});

test("specs/INDEX.md ist nach apply auf dem neuen Stand", () => {
  mitRepo({}, (dir) => {
    // Die Fixture bringt einen absichtlich falschen Index mit (Bereich 'gamma',
    // den es gar nicht gibt) — nach apply steht dort, was in den Dateien steht.
    const { res } = applyMit(dir, [[1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]]);
    gruen(res);

    const index = specText(dir, "INDEX.md");
    assert.match(index, /^\| alpha \| specs\/alpha\.md \| 4 \| 1 \|$/m, `der Index zaehlt alpha falsch:\n${index}`);
    assert.match(index, /^\| beta \| specs\/beta\.md \| 1 \| 0 \|$/m, "der unberuehrte Bereich fehlt im Index");
    assert.doesNotMatch(index, /gamma/, "der Index nennt einen Bereich ohne Datei");
  });
});

// --- Schalter ---------------------------------------------------------------

test("ohne 'spec'-Block: Hinweis und Exit 0, nichts geschrieben", () => {
  mitRepo({ specBlock: null }, (dir) => {
    const vorher = specStand(dir);
    const { res } = applyMit(dir, [[1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]]);

    assert.equal(res.status, 0, `ohne Block ist apply kein Fehler: ${res.stderr}`);
    assert.match(res.stderr, /spec/, "der Hinweis nennt den fehlenden Block nicht");
    assert.equal(specStand(dir), vorher, "ohne Block wurde geschrieben");
  });
});

test("der Working Tree bleibt ausserhalb von specs/ unberuehrt", () => {
  mitRepo({}, (dir) => {
    const { res } = applyMit(dir, [[1, { wirkung: "NEU alpha alpha-5 — Der Lauf nennt seinen Anker." }]]);
    gruen(res);

    const stand = git(dir, "status", "--porcelain", "--untracked-files=all");
    for (const zeile of stand.split("\n").filter(Boolean)) {
      assert.match(zeile, /(specs\/|issues\/|\.claude\/)/, `apply hat ausserhalb von specs/ etwas angefasst: ${zeile}`);
    }
  });
});
