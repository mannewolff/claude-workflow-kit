// `spec.mjs luecken` — wo die Beschreibung schweigt (Issue #445).
//
// Der gefaehrlichere Fall ist nicht die falsche Aussage, sondern die fehlende:
// Sie sieht aus wie Vollstaendigkeit. Deshalb ist die Liste selbst das Ergebnis
// und nicht ihr Inhalt — sie steht auch dann in der Ausgabe, wenn sie leer ist.
// Sonst waere nicht zu unterscheiden, ob geprueft wurde und nichts fehlte, oder
// ob gar nicht geprueft wurde. Genau das messen die ersten Tests.
//
// Gemessen wird an drei Dingen: dem JSON auf stdout, dem Exit-Code und der
// Trennung der Kanaele. Eine Luecke ist ein Befund und kein Fehler — sie endet
// mit 0. Ein Fehlerpfad laesst stdout leer, damit ein Skript, das nur stdout
// liest, eine Meldung nie fuer ein Ergebnis haelt (dieselbe Haltung wie `show`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitFixture, spec, configSchreiben, dateiSchreiben } from "./helpers/spec-fixture.mjs";

const BEREICHE = { alpha: ["kit/**"], beta: ["tools/**"] };

/** Schreibt specs/<bereich>.md aus einzelnen Zeilen. */
function specSchreiben(dir, bereich, ...zeilen) {
  dateiSchreiben(dir, `specs/${bereich}.md`, [`# ${bereich}`, "", ...zeilen, ""].join("\n"));
}

/**
 * Legt ein Wegwerf-Verzeichnis ohne specs/ an, schreibt die Config und ruft
 * `luecken` mit den uebergebenen Argumenten auf. `specBlock: null` laesst den
 * Block weg, `config: null` die ganze Datei.
 */
function mitProjekt(bauen, args, fn, { specBlock = { seit: "2026-09-02", bereiche: BEREICHE }, config = {} } = {}) {
  mitFixture(null, (dir) => {
    bauen(dir);
    if (config !== null) configSchreiben(dir, specBlock === null ? config : { ...config, spec: specBlock });
    fn(spec(dir, "luecken", ...args), dir);
  });
}

/** Das JSON auf stdout — der Aufruf muss gruen gewesen sein. */
function ausgabe(res) {
  assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// --- Die Liste ist das Ergebnis ---------------------------------------------

test("ein Bereich ohne Luecken steht mit leerer, aber sichtbarer Liste in der Ausgabe", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "kit/zwei.mjs");
      specSchreiben(dir, "alpha",
        "- alpha-1 — Der Lauf liest kit/eins.mjs und meldet den Grund.",
        "- alpha-2 — kit/zwei.mjs schreibt die Zusammenfassung.");
    },
    ["--bereich", "alpha"],
    (res) => {
      const daten = ausgabe(res);
      assert.deepEqual(daten.bereiche.alpha.luecken, [],
        "der Bereich hat keine Luecke — die Liste muss trotzdem dastehen");
      assert.ok("luecken" in daten.bereiche.alpha,
        "eine fehlende Liste waere nicht von 'nicht geprueft' zu unterscheiden");
    },
  );
});

test("ein Bereich ohne Beschreibungsdatei meldet jeden seiner Punkte als Luecke", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "kit/unter/zwei.mjs");
    },
    ["--bereich", "alpha"],
    (res) => {
      assert.deepEqual(ausgabe(res).bereiche.alpha.luecken, ["kit/eins.mjs", "kit/unter/zwei.mjs"]);
      assert.equal(res.status, 0, "eine Luecke ist ein Befund, kein Fehler");
    },
  );
});

test("eine Beschreibung ohne gueltige Aussage ergibt die volle Lueckenliste", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "kit/zwei.mjs");
      specSchreiben(dir, "alpha",
        "Nur Prosa ueber kit/eins.mjs, keine Aussage.",
        "",
        "## Entfallen",
        "",
        "- alpha-1 — kit/zwei.mjs tat frueher etwas. (entfallen 2026-08-14, Paket #123)");
    },
    ["--bereich", "alpha"],
    (res) => {
      assert.deepEqual(ausgabe(res).bereiche.alpha.luecken, ["kit/eins.mjs", "kit/zwei.mjs"],
        "weder Prosa noch eine entfallene Aussage beruehrt einen Punkt");
    },
  );
});

test("nur eine entfallene Aussage beruehrt den Punkt: Luecke, und die ID steht dabei", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/gelesen.mjs");
      dateiSchreiben(dir, "kit/verwaist.mjs");
      specSchreiben(dir, "alpha",
        "- alpha-1 — Der Lauf liest kit/gelesen.mjs.",
        "",
        "## Entfallen",
        "",
        "- alpha-2 — kit/verwaist.mjs schrieb ein Protokoll. (entfallen 2026-08-14, Paket #123)");
    },
    ["--bereich", "alpha"],
    (res) => {
      const alpha = ausgabe(res).bereiche.alpha;
      assert.deepEqual(alpha.luecken, ["kit/verwaist.mjs"],
        "eine entfallene Aussage beruehrt nicht — sonst deckte eine gestrichene Zusage den Punkt zu");
      assert.deepEqual(alpha.entfallen, ["alpha-2"],
        "die entfallene ID gehoert dazu, sonst sucht der Leser die alte Zusage von Hand");
    },
  );
});

test("die Luecken sind nach Pfad sortiert", () => {
  mitProjekt(
    (dir) => {
      for (const name of ["z.mjs", "a.mjs", "m.mjs"]) dateiSchreiben(dir, `kit/${name}`);
    },
    ["--bereich", "alpha"],
    (res) => {
      assert.deepEqual(ausgabe(res).bereiche.alpha.luecken, ["kit/a.mjs", "kit/m.mjs", "kit/z.mjs"]);
    },
  );
});

// --- Mehrere Bereiche -------------------------------------------------------

test("die Ausgabe ist gueltiges JSON mit einem Schluessel je angegebenem Bereich", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "tools/zwei.mjs");
      specSchreiben(dir, "beta", "- beta-1 — tools/zwei.mjs kopiert die Blobs.");
    },
    ["--bereich", "alpha", "--bereich", "beta"],
    (res) => {
      const daten = ausgabe(res);
      assert.deepEqual(Object.keys(daten.bereiche), ["alpha", "beta"]);
      assert.deepEqual(daten.bereiche.alpha.luecken, ["kit/eins.mjs"]);
      assert.deepEqual(daten.bereiche.beta.luecken, [],
        "auch der Bereich ohne Luecke bekommt seinen Schluessel");
    },
  );
});

test("mehrere Namen hinter einem einzelnen --bereich werden getrennt ausgewiesen", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "tools/zwei.mjs");
    },
    ["--bereich", "alpha", "beta"],
    (res) => {
      const daten = ausgabe(res);
      assert.deepEqual(daten.bereiche.alpha.luecken, ["kit/eins.mjs"]);
      assert.deepEqual(daten.bereiche.beta.luecken, ["tools/zwei.mjs"]);
    },
  );
});

test("ein doppelt genannter Bereich steht einmal in der Ausgabe", () => {
  mitProjekt(
    (dir) => dateiSchreiben(dir, "kit/eins.mjs"),
    ["--bereich", "alpha", "--bereich", "alpha"],
    (res) => {
      assert.deepEqual(Object.keys(ausgabe(res).bereiche), ["alpha"]);
    },
  );
});

test("ein Punkt gehoert nur dem Bereich, dessen Glob ihn erfasst", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "docs/ausserhalb.md");
    },
    ["--bereich", "alpha", "beta"],
    (res) => {
      const daten = ausgabe(res);
      assert.deepEqual(daten.bereiche.alpha.luecken, ["kit/eins.mjs"]);
      assert.deepEqual(daten.bereiche.beta.luecken, [],
        "docs/ trifft kein Muster und ist damit kein Punkt");
    },
  );
});

test(".git und node_modules liefern keine Punkte", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "kit/node_modules/fremd/index.mjs");
      dateiSchreiben(dir, "kit/.git/HEAD");
    },
    ["--bereich", "alpha"],
    (res) => {
      assert.deepEqual(ausgabe(res).bereiche.alpha.luecken, ["kit/eins.mjs"],
        "fremder Code und die Buchhaltung des Repos sind kein beschriebenes Verhalten");
    },
  );
});

// --- Fehlerpfade ------------------------------------------------------------

test("ein unbekannter Bereichsname endet mit Exit 1 und leerem stdout", () => {
  mitProjekt(() => {}, ["--bereich", "nixda"], (res) => {
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "", "ein Fehler darf auf stdout nichts hinterlassen");
    assert.match(res.stderr, /nixda/);
    assert.match(res.stderr, /alpha, beta/, "die Meldung nennt die bekannten Bereiche");
  });
});

test("ein unbekannter Name neben einem bekannten bricht ebenso ab", () => {
  mitProjekt(
    (dir) => dateiSchreiben(dir, "kit/eins.mjs"),
    ["--bereich", "alpha", "--bereich", "nixda"],
    (res) => {
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "",
        "eine Teilausgabe saehe aus wie ein vollstaendiges Ergebnis");
    },
  );
});

test("luecken ohne --bereich endet mit Exit 1 und nennt die bekannten Bereiche", () => {
  mitProjekt(() => {}, [], (res) => {
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /alpha, beta/);
  });
});

test("--bereich ohne Wert endet mit Exit 1", () => {
  mitProjekt(() => {}, ["--bereich"], (res) => {
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
  });
});

test("ein unbekanntes Argument endet mit Exit 1", () => {
  mitProjekt(() => {}, ["--alles"], (res) => {
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
  });
});

// --- Die Config als Schalter ------------------------------------------------

test("ohne spec-Block gibt es einen Hinweis auf stderr und Exit 0", () => {
  mitProjekt(
    (dir) => dateiSchreiben(dir, "kit/eins.mjs"),
    ["--bereich", "alpha"],
    (res) => {
      assert.equal(res.status, 0);
      assert.equal(res.stdout, "", "ohne Schalter gibt es keine Lueckenliste");
      assert.match(res.stderr, /spec/, "der Hinweis nennt den Block, der fehlt");
    },
    { specBlock: null },
  );
});

test("ohne Config-Datei laeuft luecken im Wegwerf-Verzeichnis mit Hinweis und Exit 0", () => {
  mitProjekt(() => {}, ["--bereich", "x"], (res) => {
    assert.equal(res.status, 0, "ein Projekt ohne Config ist kein Fehlerfall");
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /spec/);
  }, { config: null });
});

test("ein spec-Block mit leerem bereiche endet mit Exit 1", () => {
  mitProjekt(() => {}, ["--bereich", "alpha"], (res) => {
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
  }, { specBlock: { seit: "2026-09-02", bereiche: {} } });
});

test("ein spec-Block mit bereiche als Array endet mit Exit 1", () => {
  mitProjekt(() => {}, ["--bereich", "alpha"], (res) => {
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
  }, { specBlock: { seit: "2026-09-02", bereiche: ["alpha"] } });
});

test("ein fehlendes specs/ gilt als leere Beschreibung fuer jeden Bereich", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "kit/eins.mjs");
      dateiSchreiben(dir, "tools/zwei.mjs");
    },
    ["--bereich", "alpha", "beta"],
    (res, dir) => {
      const daten = ausgabe(res);
      assert.deepEqual(daten.bereiche.alpha.luecken, ["kit/eins.mjs"]);
      assert.deepEqual(daten.bereiche.beta.luecken, ["tools/zwei.mjs"]);
      assert.ok(dir, "specs/ wurde nie angelegt — das ist kein Fehler, sondern der Nullstand");
    },
  );
});

test("ein Bereich, dessen Config-Eintrag keine Datei unter specs/ hat, ist bekannt", () => {
  mitProjekt(
    (dir) => {
      dateiSchreiben(dir, "tools/zwei.mjs");
      specSchreiben(dir, "alpha", "- alpha-1 — Etwas ueber kit/.");
    },
    ["--bereich", "beta"],
    (res) => {
      assert.deepEqual(ausgabe(res).bereiche.beta.luecken, ["tools/zwei.mjs"]);
    },
  );
});

test("eine Datei specs/<x>.md ohne Config-Eintrag macht x nicht bekannt", () => {
  mitProjekt(
    (dir) => specSchreiben(dir, "gamma", "- gamma-1 — Etwas."),
    ["--bereich", "gamma"],
    (res) => {
      assert.equal(res.status, 1, "bekannt sind allein die Schluessel von spec.bereiche");
      assert.equal(res.stdout, "");
    },
  );
});
