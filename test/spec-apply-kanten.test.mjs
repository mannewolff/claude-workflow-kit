// Die Raender der Fortschreibung (Issue #500, Coverage aus Plan #492).
//
// test/spec-apply.test.mjs prueft, was `apply` im Regelfall tut. Diese Datei
// prueft die Faelle daneben — die Dateiformen, auf die das Einfuegen trifft, und
// die Befunde, die es aufhalten:
//
//   Wo landet eine Aussage in einer Datei ohne '## Entfallen'? In einer, die die
//   Ueberschrift hat, aber nichts darunter? In einer leeren Datei?
//   Was passiert bei GEAENDERT auf eine bereits gestrichene Aussage, was bei
//   ENTFAELLT auf eine ID, die es nie gab?
//
// Jeder dieser Wege entscheidet darueber, ob eine Zusage auf der richtigen Seite
// der Ueberschrift landet. Eine gueltige Aussage, die unter '## Entfallen'
// rutscht, gilt ab dem ersten Tag als gestrichen — der Fehler ginge in die
// unsichere Richtung und faellt niemandem auf.
//
// Gemessen wird am geschriebenen Dateitext und am Exit-Code, gegen ein echtes
// Repo und den echten Adapter (helpers/spec-repo.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, spec, commit, kopf, paketAnlegen, specText, specStand, SEIT, BEREICHE } from "./helpers/spec-repo.mjs";

const SPEC_BLOCK = { seit: SEIT, bereiche: { ...BEREICHE, delta: ["docs/**"] } };

/** Schreibt eine Bereichsdatei roh — auch ohne abschliessenden Zeilenumbruch. */
function bereichSchreiben(dir, name, text) {
  writeFileSync(join(dir, "specs", `${name}.md`), text, "utf-8");
}

/**
 * Legt die Pakete an, committet je einen Commit mit Marke und ruft `apply` mit
 * dem Anker davor. `vorbereiten` laeuft davor und darf specs/ zurechtlegen.
 */
function applyMit(pakete, fn, { vorbereiten = () => {}, specBlock = SPEC_BLOCK, args = [] } = {}) {
  mitRepo({ specBlock }, (dir) => {
    vorbereiten(dir);
    const anker = kopf(dir);
    for (const [nummer, wirkung] of pakete) {
      paketAnlegen(dir, nummer, { wirkung });
      commit(dir, `Arbeit an ${nummer} (Issue #${nummer})`);
    }
    fn(spec(dir, "apply", "--anker", anker, ...args), dir);
  });
}

/** Der Aufruf muss gruen gewesen sein — sonst sagt die Meldung, woran es lag. */
function gruen(res) {
  assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
  return res;
}

// --- Die Argumente von apply ------------------------------------------------

test("apply mit einem unbekannten Argument: Exit 1 und die Meldung zeigt den Aufruf", () => {
  mitRepo({ specBlock: SPEC_BLOCK }, (dir) => {
    const res = spec(dir, "apply", "--ankerr", kopf(dir));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unerwartetes Argument: '--ankerr'/);
    assert.match(res.stderr, /node spec\.mjs apply --anker <sha> \[--dry-run\]/,
      "wer sich vertippt hat, soll die Form sehen, ohne die Hilfe zu suchen");
  });
});

test("apply --anker ohne Wert: der Folgeschalter gilt nicht als Anker", () => {
  // Wuerde '--dry-run' als Anker durchgehen, endete der Lauf mit der Meldung
  // ueber einen nicht aufloesbaren Anker — und die wiese in die falsche Richtung.
  mitRepo({ specBlock: SPEC_BLOCK }, (dir) => {
    const res = spec(dir, "apply", "--anker", "--dry-run");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /'--anker' braucht einen Wert\./);
  });
});

// --- Wo eine gueltige Aussage landet ----------------------------------------

test("NEU in einen Bereich ohne '## Entfallen' haengt hinter die letzte Aussage", () => {
  // beta.md kennt die Ueberschrift nicht — dann ist die Grenze das Dateiende,
  // und die neue Zeile darf trotzdem nicht ans Ende der Prosa rutschen.
  applyMit([[7, "NEU beta beta-2 — Die Auskunft nennt den Bereich."]], (res, dir) => {
    gruen(res);
    assert.match(specText(dir, "beta.md"),
      /- beta-1 — Die Auskunft antwortet auch ohne Config\.\n- beta-2 — Die Auskunft nennt den Bereich\.\n$/);
    assert.doesNotMatch(specText(dir, "beta.md"), /## Entfallen/,
      "ohne Streichung entsteht die Ueberschrift nicht");
  });
});

test("NEU in eine leere Bereichsdatei schreibt die Aussage in die erste Zeile", () => {
  // Eine Datei ohne jede Zeile ist der Rand des Einfuegens: Es gibt keine
  // Ueberschrift, hinter die man sich haengen koennte, und keine Prosa, von der
  // eine Leerzeile trennen muesste.
  applyMit(
    [[7, "NEU delta delta-1 — Die Beschreibung faengt hier an."]],
    (res, dir) => {
      gruen(res);
      assert.equal(specText(dir, "delta.md"), "- delta-1 — Die Beschreibung faengt hier an.\n");
    },
    { vorbereiten: (dir) => bereichSchreiben(dir, "delta", "") },
  );
});

// --- Wo eine gestrichene Aussage landet -------------------------------------

test("ENTFAELLT in einem Bereich ohne '## Entfallen' legt die Ueberschrift an", () => {
  applyMit([[7, "ENTFAELLT beta-1 — Die Config ist inzwischen Pflicht."]], (res, dir) => {
    gruen(res);
    const text = specText(dir, "beta.md");
    assert.match(text, /## Entfallen\n\n+- beta-1 — Die Auskunft antwortet auch ohne Config\. \(entfallen \d{4}-\d{2}-\d{2}, Paket #7\)\n$/,
      "die Ueberschrift entsteht, und die Aussage steht darunter");
    assert.equal((text.match(/- beta-1/g) ?? []).length, 1,
      "die Aussage wird verschoben, nicht kopiert — sonst gaelte sie doppelt");
    assert.doesNotMatch(text.slice(0, text.indexOf("## Entfallen")), /- beta-1/,
      "oberhalb der Ueberschrift darf sie nicht stehenbleiben — dort gaelte sie weiter");
  });
});

test("NEU und ENTFAELLT im selben Batch: die Aussage entsteht gleich unter '## Entfallen'", () => {
  // Der Bereich hat noch keine Datei; sie entsteht mit leerer Ueberschrift, und
  // die erste Zeile darunter muss trotzdem die richtige Leerzeile ueber sich
  // bekommen.
  applyMit(
    [
      [7, "NEU gamma gamma-1 — Der Zwischenstand wird gemeldet."],
      [8, "ENTFAELLT gamma-1 — Der Zwischenstand kam nie an."],
    ],
    (res, dir) => {
      gruen(res);
      assert.match(specText(dir, "gamma.md"),
        /^# gamma\n\n## Entfallen\n\n- gamma-1 — Der Zwischenstand wird gemeldet\. \(entfallen \d{4}-\d{2}-\d{2}, Paket #8\)\n$/,
        "die Streichung nennt das Paket, das gestrichen hat — nicht das, das angelegt hat");
    },
  );
});

test("NEU und ENTFAELLT in eine leere Datei: die Ueberschrift steht in der ersten Zeile", () => {
  // Der aeusserste Rand: Die Datei hat nichts, an das sich die Ueberschrift
  // anhaengen koennte — dann faengt die Datei mit ihr an, ohne fuehrende
  // Leerzeile.
  applyMit(
    [
      [7, "NEU delta delta-1 — Der Zwischenstand wird gemeldet."],
      [8, "ENTFAELLT delta-1 — Der Zwischenstand kam nie an."],
    ],
    (res, dir) => {
      gruen(res);
      assert.match(specText(dir, "delta.md"),
        /^## Entfallen\n\n- delta-1 — Der Zwischenstand wird gemeldet\. \(entfallen \d{4}-\d{2}-\d{2}, Paket #8\)\n$/);
    },
    { vorbereiten: (dir) => bereichSchreiben(dir, "delta", "") },
  );
});

test("eine Datei, die mit '## Entfallen' endet, bekommt eine Leerzeile vor die Aussage", () => {
  // Der Rand: Unter der Ueberschrift steht nichts, nicht einmal eine leere
  // Zeile — die Datei hoert mit ihr auf. Ohne den Trenner klebte die Aussage an
  // der Ueberschrift, und die Datei saehe anders aus als jede andere.
  applyMit(
    [[7, "ENTFAELLT delta-1 — Die Zusage war nie eingeloest."]],
    (res, dir) => {
      gruen(res);
      const text = specText(dir, "delta.md");
      assert.match(text, /## Entfallen\n\n- delta-1 — Der Anfang\. \(entfallen \d{4}-\d{2}-\d{2}, Paket #7\)\n$/,
        "genau eine Leerzeile zwischen Ueberschrift und Aussage");
      assert.doesNotMatch(text.slice(0, text.indexOf("## Entfallen")), /- delta-1/);
    },
    { vorbereiten: (dir) => bereichSchreiben(dir, "delta", "# delta\n\n- delta-1 — Der Anfang.\n\n## Entfallen") },
  );
});

// --- Die Befunde, die aufhalten ---------------------------------------------

test("GEAENDERT auf eine bereits gestrichene Aussage: Exit 1, nichts geschrieben", () => {
  // Eine gestrichene Zusage laesst sich nicht aendern — sie gilt nicht mehr.
  // Waere das erlaubt, wanderte sie stillschweigend zurueck in den gueltigen Teil.
  applyMit([[7, "GEAENDERT alpha-4 — Der Lauf schreibt wieder ein Protokoll."]], (res, dir) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7: Die ID 'alpha-4' ist bereits entfallen\./);
    assert.match(specStand(dir), /- alpha-4 — Der Lauf schrieb frueher ein Protokoll je Session\. \(entfallen 2026-08-14, Paket #123\)/);
  });
});

test("ENTFAELLT auf eine nie vergebene ID: Exit 1 mit Paketnummer", () => {
  applyMit([[7, "ENTFAELLT alpha-9 — Gab es nie."]], (res) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7: Die ID 'alpha-9' ist nicht vergeben\./);
  });
});

// --- Der Index -------------------------------------------------------------

test("GEAENDERT laesst die Zahlen gleich: der Index wird nicht angefasst", () => {
  // Der Index zaehlt gueltige und entfallene Aussagen. Aendert sich nur ein
  // Aussagetext, aendert sich keine Zahl — dann darf auch keine Meldung
  // behaupten, der Index sei geschrieben worden.
  const index = "# Spec-Index\n\n| Bereich | Datei | Gueltig | Entfallen |\n| --- | --- | --- | --- |\n"
    + "| alpha | specs/alpha.md | 3 | 1 |\n| beta | specs/beta.md | 1 | 0 |\n";

  applyMit(
    [[7, "GEAENDERT alpha-1 — Der Lauf meldet jede ausgelassene Pruefung mit Grund und Dauer."]],
    (res, dir) => {
      gruen(res);
      assert.match(res.stdout, /specs\/alpha\.md geschrieben\./);
      assert.doesNotMatch(res.stdout, /INDEX\.md geschrieben/,
        "ein unveraenderter Index darf nicht neu geschrieben gemeldet werden");
      assert.equal(readFileSync(join(dir, "specs", "INDEX.md"), "utf-8"), index, "byte-gleich geblieben");
    },
    { vorbereiten: (dir) => writeFileSync(join(dir, "specs", "INDEX.md"), index, "utf-8") },
  );
});

// --- 'seit': der Stichtag ---------------------------------------------------

test("ohne 'spec.seit' wird jedes Paket gewertet", () => {
  // Kein Stichtag heisst: kein Filter. Ein Projekt, das das Feld nie gesetzt hat,
  // darf nicht schweigend alle Pakete auslassen.
  applyMit(
    [[7, "NEU beta beta-2 — Die Auskunft nennt den Bereich."]],
    (res, dir) => {
      gruen(res);
      assert.match(specText(dir, "beta.md"), /- beta-2 — Die Auskunft nennt den Bereich\./);
    },
    { specBlock: { bereiche: SPEC_BLOCK.bereiche } },
  );
});

test("ein leeres 'spec.seit' wirkt wie kein Stichtag", () => {
  applyMit(
    [[7, "NEU beta beta-2 — Die Auskunft nennt den Bereich."]],
    (res, dir) => {
      gruen(res);
      assert.match(specText(dir, "beta.md"), /- beta-2 — Die Auskunft nennt den Bereich\./);
    },
    { specBlock: { seit: "", bereiche: SPEC_BLOCK.bereiche } },
  );
});

test("ein spec-Block ohne 'bereiche': jede NEU-Zeile ist ein Befund", () => {
  applyMit(
    [[7, "NEU beta beta-2 — Die Auskunft nennt den Bereich."]],
    (res) => {
      assert.equal(res.status, 1);
      assert.match(res.stderr, /Unbekannter Bereich 'beta'/);
    },
    { specBlock: { seit: SEIT } },
  );
});

// --- Der Diff der Vorschau --------------------------------------------------

test("--dry-run: zwei weit auseinander liegende Aenderungen ergeben zwei Hunks", () => {
  // Der Diff fasst Aenderungen zusammen, solange sie sich Kontextzeilen teilen.
  // Liegen sie weiter auseinander, muessen es zwei Hunks werden — sonst zeigte
  // die Vorschau die ganze Datei als eine einzige Aenderung.
  const lang = ["# delta", "", ...Array.from({ length: 12 }, (_, i) => `- delta-${i + 1} — Aussage ${i + 1}.`), ""].join("\n");

  applyMit(
    [
      [7, "GEAENDERT delta-1 — Die erste Aussage, neu gefasst."],
      [8, "GEAENDERT delta-12 — Die letzte Aussage, neu gefasst."],
    ],
    (res, dir) => {
      gruen(res);
      // Nur der Diff der Bereichsdatei zaehlt: Der Index steht als eigener Diff
      // dahinter und braeuchte sonst mitgezaehlt zu werden.
      const teil = res.stdout.slice(0, res.stdout.indexOf("--- specs/INDEX.md"));
      assert.equal((teil.match(/^@@ /gm) ?? []).length, 2,
        `zwei getrennte Hunks erwartet, Diff war:\n${teil}`);
      assert.equal(specText(dir, "delta.md"), lang, "--dry-run schreibt nicht");
    },
    { vorbereiten: (dir) => bereichSchreiben(dir, "delta", lang), args: ["--dry-run"] },
  );
});

test("--dry-run: eine ersatzlos wegfallende Index-Zeile steht als reine Loeschung im Diff", () => {
  // Der Index nennt einen Bereich, den es nicht mehr gibt. Er wird vollstaendig
  // neu geschrieben, also faellt genau diese Zeile weg — und nichts tritt an
  // ihre Stelle. Der Diff muss das als Loeschung zeigen und nicht als
  // Ersetzung, sonst behauptete er eine Aenderung, die niemand gemacht hat.
  const kopfzeilen = "# Spec-Index\n\n| Bereich | Datei | Gueltig | Entfallen |\n| --- | --- | --- | --- |\n";
  const index = `${kopfzeilen}| alpha | specs/alpha.md | 3 | 1 |\n| beta | specs/beta.md | 2 | 0 |\n`
    + "| zeta | specs/zeta.md | 1 | 0 |\n";

  applyMit(
    [[7, "NEU beta beta-2 — Die Auskunft nennt den Bereich."]],
    (res) => {
      gruen(res);
      assert.match(res.stdout, /^-\| zeta \| specs\/zeta\.md \| 1 \| 0 \|$/m,
        "die Zeile des verschwundenen Bereichs wird geloescht");
      assert.doesNotMatch(res.stdout, /^\+\| zeta /m, "und nichts tritt an ihre Stelle");
    },
    { vorbereiten: (dir) => writeFileSync(join(dir, "specs", "INDEX.md"), index, "utf-8"), args: ["--dry-run"] },
  );
});

test("--dry-run zeigt das Verschieben unter '## Entfallen' als Loeschung und Zugang", () => {
  // Beim Streichen verschwindet eine Zeile oben und kommt unten wieder — der
  // Diff muss beides zeigen, sonst saehe es nach einer blossen Ergaenzung aus.
  applyMit(
    [[7, "ENTFAELLT alpha-2 — Leere Pakete gibt es nicht mehr."]],
    (res) => {
      gruen(res);
      assert.match(res.stdout, /^-- alpha-2 — Ein leeres Paket wird als solches benannt\.$/m);
      assert.match(res.stdout, /^\+- alpha-2 — Ein leeres Paket wird als solches benannt\. \(entfallen /m);
    },
    { args: ["--dry-run"] },
  );
});
