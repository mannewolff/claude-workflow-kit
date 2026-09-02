// `spec.mjs check --paket` — die Form der Spec-Wirkung eines Arbeitspakets (Issue #442).
//
// Der Abschnitt `## Spec-Wirkung` sagt, was ein Paket an der Beschreibung
// aendert; seine Grammatik steht in Plan #437, A12. Die Leitplanke im Adapter
// (#443) prueft nur, DASS der Abschnitt da ist — die Form prueft allein dieses
// Kommando. Zwei Grammatiken waeren zwei Wahrheiten.
//
// Die schaerfste Regel ist A13: Gestrichene Aussagen bleiben in der Datei, IDs
// werden nie wiederverwendet. Deshalb reicht es nicht, eine ID gegen die
// gueltigen Aussagen zu pruefen — auch die unter `## Entfallen` sind vergeben.
//
// Gemessen wird am Exit-Code und an den Meldungszeilen auf stderr: `check` ist
// ein Pruefer, seine Befunde sind Fehler, und ein Skript, das nur stdout liest,
// darf sie nie fuer ein Ergebnis halten.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitFixture, spec, configSchreiben, paketSchreiben } from "./helpers/spec-fixture.mjs";

// Die Fixture 'zwei-bereiche' bringt mit: alpha-1..alpha-3 gueltig, alpha-4
// entfallen, beta-1 gueltig. 'gamma' steht bewusst nur in der Config und hat
// keine Datei unter specs/ — der Normalfall eines frisch eingeschalteten
// Projekts (Kriterium 6).
const BEREICHE = { alpha: ["kit/**"], beta: ["tools/**"], gamma: ["docs/**"] };
const SPEC_BLOCK = { seit: "2026-09-02", bereiche: BEREICHE };

/** Ein Arbeitspaket im Fuenf-Abschnitt-Format; die Wirkungszeilen kommen von aussen. */
function paket(...wirkung) {
  return [
    "## Kontext", "", "Autor-Modell: claude-opus-5", "",
    "## Aufgabe", "", "Etwas tun.", "",
    "## Akzeptanzkriterium", "", "- `node --test` laeuft gruen.", "",
    "## Spec-Wirkung", "",
    ...wirkung,
    "",
    "## Abhängigkeiten", "", "Issue #440", "",
  ].join("\n");
}

/** Ein Paket ohne den fuenften Abschnitt — das Vier-Abschnitt-Format von heute. */
function paketOhneAbschnitt() {
  const voll = paket("KEINE — Aendert nichts.").split("\n");
  const start = voll.indexOf("## Spec-Wirkung");
  const ende = voll.indexOf("## Abhängigkeiten");
  return [...voll.slice(0, start), ...voll.slice(ende)].join("\n");
}

/** Die 1-basierte Zeilennummer einer Zeile im Paket — nie von Hand gezaehlt. */
function zeileVon(body, text) {
  const nr = body.split("\n").indexOf(text) + 1;
  assert.notEqual(nr, 0, `die Zeile '${text}' steht nicht im Paket`);
  return nr;
}

/** Die Befundzeilen auf stderr — alles, was mit 'Zeile ' beginnt. */
function befunde(res) {
  return res.stderr.split("\n").filter((z) => z.startsWith("Zeile "));
}

/**
 * Legt Fixture, Config und Paketdatei an und ruft `check --paket` darauf.
 * `specBlock: null` laesst den Block weg, `config: null` die ganze Datei.
 */
function mitPaket(body, fn, { specBlock = SPEC_BLOCK, config = {} } = {}) {
  mitFixture("zwei-bereiche", (dir) => {
    if (config !== null) configSchreiben(dir, specBlock === null ? config : { ...config, spec: specBlock });
    const pfad = paketSchreiben(dir, body);
    fn(spec(dir, "check", "--paket", pfad), dir);
  });
}

// --- Die vier gueltigen Zeilenformen aus A12 --------------------------------

const GUELTIG = [
  ["NEU", "NEU alpha alpha-9 — Der Lauf nennt die ausgelassenen Pruefungen."],
  ["GEAENDERT", "GEAENDERT alpha-1 — Der Lauf meldet jede Auslassung mit Grund."],
  ["ENTFAELLT", "ENTFAELLT alpha-2 — Die Zusage geht in alpha-1 auf."],
  ["KEINE", "KEINE — Reines Umbenennen ohne Wirkung auf das Verhalten."],
];

for (const [name, zeile] of GUELTIG) {
  test(`${name}: die Zeilenform aus A12 wird angenommen`, () => {
    mitPaket(paket(zeile), (res) => {
      assert.equal(res.status, 0, `'${zeile}' haette angenommen werden muessen: ${res.stderr}`);
      assert.deepEqual(befunde(res), [], "es wurde ein Befund gemeldet");
    });
  });
}

// --- Der Abschnitt selbst ---------------------------------------------------

test("ohne Abschnitt '## Spec-Wirkung': abgewiesen", () => {
  mitPaket(paketOhneAbschnitt(), (res) => {
    assert.equal(res.status, 1, "ein Paket ohne den Abschnitt haette rot enden muessen");
    assert.match(res.stderr, /Spec-Wirkung/, "die Meldung nennt den fehlenden Abschnitt nicht");
    assert.match(res.stderr, /fehlt/, "die Meldung sagt nicht, dass der Abschnitt fehlt");
  });
});

test("Abschnitt nur aus der Ueberschrift: abgewiesen", () => {
  const body = paket();
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "ein leerer Abschnitt haette rot enden muessen");
    assert.match(res.stderr, new RegExp(`Zeile ${zeileVon(body, "## Spec-Wirkung")}:`),
      "die Meldung nennt die Zeile der Ueberschrift nicht");
    assert.match(res.stderr, /KEINE/, "die Meldung nennt den Ausweg 'KEINE' nicht");
  });
});

test("die Abschnittsgrenze ist die naechste '## '-Zeile", () => {
  // Der Unfug steht UNTER '## Abhängigkeiten' und gehoert damit nicht mehr zum
  // Abschnitt. Ohne Grenze pruefte 'check' den halben Body.
  const body = `${paket("KEINE — Aendert nichts.")}\nGEAENDERT nichts-hiervon\n`;
  mitPaket(body, (res) => {
    assert.equal(res.status, 0, `nur der Abschnitt wird geprueft: ${res.stderr}`);
  });
});

// --- Zeilenform -------------------------------------------------------------

test("eine Zeile in keiner der vier Formen: abgewiesen, mit Zeilennummer", () => {
  const unfug = "AENDERT alpha-1 — Ein Schluesselwort, das es nicht gibt.";
  const body = paket(unfug);
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "eine unbekannte Zeilenform haette rot enden muessen");
    assert.match(res.stderr, new RegExp(`Zeile ${zeileVon(body, unfug)}:`),
      "die Meldung nennt die Zeilennummer nicht");
  });
});

test("Bindestrich statt Gedankenstrich: abgewiesen, und die Meldung sagt es", () => {
  const mitStrich = "GEAENDERT alpha-1 - Der Trenner ist hier ein Bindestrich.";
  const body = paket(mitStrich);
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "ein Bindestrich als Trenner haette rot enden muessen");
    assert.match(res.stderr, new RegExp(`Zeile ${zeileVon(body, mitStrich)}:`),
      "die Meldung nennt die Zeilennummer nicht");
    assert.match(res.stderr, /Bindestrich/,
      "die Meldung nennt den Bindestrich nicht — ohne den Hinweis sucht man an der falschen Stelle");
  });
});

test("'KEINE' zusammen mit einer weiteren Zeile: abgewiesen", () => {
  const keine = "KEINE — Aendert nichts.";
  const body = paket(keine, "GEAENDERT alpha-1 — Doch etwas.");
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "'KEINE' neben einer Wirkungszeile haette rot enden muessen");
    assert.match(res.stderr, new RegExp(`Zeile ${zeileVon(body, keine)}:`),
      "die Meldung nennt die Zeile mit 'KEINE' nicht");
    assert.match(res.stderr, /allein/, "die Meldung sagt nicht, dass 'KEINE' allein steht");
  });
});

// --- Bereich ----------------------------------------------------------------

test("unbekannter Bereich: abgewiesen, die Meldung nennt die bekannten", () => {
  const body = paket("NEU delta delta-1 — Ein Bereich, den die Config nicht kennt.");
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "ein unbekannter Bereich haette rot enden muessen");
    assert.match(res.stderr, /delta/, "die Meldung nennt den unbekannten Bereich nicht");
    assert.match(res.stderr, /alpha/, "die Meldung nennt die bekannten Bereiche nicht");
  });
});

test("Bereich passt nicht zum ID-Praefix: abgewiesen (A16)", () => {
  const body = paket("NEU alpha beta-9 — Der Bereich sagt alpha, die ID sagt beta.");
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "ein Praefix, das nicht zum Bereich passt, haette rot enden muessen");
    assert.match(res.stderr, /alpha/, "die Meldung nennt den genannten Bereich nicht");
    assert.match(res.stderr, /beta-9/, "die Meldung nennt die ID nicht");
  });
});

test("NEU in einen Bereich ohne Spec-Datei: angenommen (Kriterium 6)", () => {
  mitPaket(paket("NEU gamma gamma-1 — Die erste Aussage eines frischen Bereichs."), (res) => {
    assert.equal(res.status, 0, `ein Bereich ohne Datei hat keine ID vergeben: ${res.stderr}`);
  });
});

test("GEAENDERT in einen Bereich ohne Spec-Datei: abgewiesen", () => {
  mitPaket(paket("GEAENDERT gamma-1 — Es gibt nichts zu aendern."), (res) => {
    assert.equal(res.status, 1, "ohne Beschreibung gibt es keine Aussage zu aendern");
    assert.match(res.stderr, /keine Beschreibung/, "die Meldung nennt den Grund nicht");
  });
});

// --- ID-Vergabe -------------------------------------------------------------

test("NEU auf eine gueltige ID: abgewiesen (Kollision)", () => {
  const body = paket("NEU alpha alpha-1 — Eine zweite Aussage unter derselben Nummer.");
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "eine Kollision mit einer gueltigen Aussage haette rot enden muessen");
    assert.match(res.stderr, /alpha-1/, "die Meldung nennt die kollidierende ID nicht");
  });
});

test("NEU auf eine entfallene ID: abgewiesen (A13)", () => {
  const body = paket("NEU alpha alpha-4 — Die Nummer einer gestrichenen Aussage.");
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "eine wiederverwendete ID haette rot enden muessen");
    assert.match(res.stderr, /alpha-4/, "die Meldung nennt die ID nicht");
    assert.match(res.stderr, /## Entfallen/,
      "die Meldung sagt nicht, dass die ID unter '## Entfallen' schon vergeben war");
  });
});

test("GEAENDERT auf eine nie vergebene ID: abgewiesen", () => {
  mitPaket(paket("GEAENDERT alpha-99 — Diese Aussage gibt es nicht."), (res) => {
    assert.equal(res.status, 1, "eine nie vergebene ID haette rot enden muessen");
    assert.match(res.stderr, /alpha-99/, "die Meldung nennt die ID nicht");
  });
});

test("GEAENDERT auf eine bereits entfallene ID: abgewiesen", () => {
  mitPaket(paket("GEAENDERT alpha-4 — Eine gestrichene Aussage aendert man nicht."), (res) => {
    assert.equal(res.status, 1, "eine entfallene ID haette rot enden muessen");
    assert.match(res.stderr, /alpha-4/, "die Meldung nennt die ID nicht");
    assert.match(res.stderr, /entfallen/, "die Meldung nennt den Status der ID nicht");
  });
});

test("ENTFAELLT auf eine bereits entfallene ID: abgewiesen", () => {
  mitPaket(paket("ENTFAELLT alpha-4 — Zweimal streichen geht nicht."), (res) => {
    assert.equal(res.status, 1, "eine doppelt gestrichene ID haette rot enden muessen");
    assert.match(res.stderr, /alpha-4/, "die Meldung nennt die ID nicht");
  });
});

test("eine Luecke in der Nummerierung: angenommen (A13)", () => {
  // alpha-5 bis alpha-8 fehlen; Fortlaufigkeit wird bewusst nicht geprueft,
  // sonst blockierten sich parallel geschnittene Pakete gegenseitig.
  mitPaket(paket("NEU alpha alpha-9 — Eine Nummer mit Luecke davor."), (res) => {
    assert.equal(res.status, 0, `eine Luecke ist kein Fehler: ${res.stderr}`);
  });
});

test("dieselbe ID zweimal im Abschnitt: abgewiesen, mit beiden Zeilennummern", () => {
  const erste = "GEAENDERT alpha-1 — Ein neuer Text.";
  const zweite = "ENTFAELLT alpha-1 — Und weg damit.";
  const body = paket(erste, zweite);
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "zwei Zeilen zur selben ID haetten rot enden muessen");
    const text = res.stderr;
    assert.match(text, new RegExp(`\\b${zeileVon(body, erste)}\\b`), "die erste Zeilennummer fehlt");
    assert.match(text, new RegExp(`\\b${zeileVon(body, zweite)}\\b`), "die zweite Zeilennummer fehlt");
  });
});

// --- Meldung und Exitcode ---------------------------------------------------

test("mehrere Fehler: alle werden gemeldet, nicht nur der erste", () => {
  const body = paket(
    "NEU delta delta-1 — Unbekannter Bereich.",
    "GEAENDERT alpha-99 — Nie vergeben.",
    "ENTFAELLT alpha-4 — Schon entfallen.",
  );
  mitPaket(body, (res) => {
    assert.equal(res.status, 1, "drei Fehler haetten rot enden muessen");
    assert.equal(befunde(res).length, 3,
      `es haette drei Befunde geben muessen, gemeldet wurden: ${res.stderr}`);
  });
});

test("Befunde stehen auf stderr, nie auf stdout", () => {
  mitPaket(paket("GEAENDERT alpha-99 — Nie vergeben."), (res) => {
    assert.equal(res.status, 1, "der Befund haette rot enden muessen");
    assert.equal(res.stdout, "",
      "ein Befund auf stdout sieht fuer ein lesendes Skript aus wie ein Ergebnis");
  });
});

// --- Config -----------------------------------------------------------------

test("ohne spec-Block: Exit 0 und ein Hinweis, der 'spec' nennt", () => {
  mitPaket(paket("GEAENDERT alpha-99 — Nie vergeben."), (res) => {
    assert.equal(res.status, 0, "ein Projekt ohne Schalter wird nicht geprueft (Kriterium 2)");
    assert.match(res.stderr, /spec/, "der Hinweis nennt den fehlenden Block nicht");
    assert.deepEqual(befunde(res), [], "ohne Schalter darf kein Befund entstehen");
  }, { specBlock: null, config: { mainBranch: "main" } });
});

test("ohne Config-Datei: Exit 0", () => {
  mitPaket(paket("GEAENDERT alpha-99 — Nie vergeben."), (res) => {
    assert.equal(res.status, 0, "ohne Config gibt es keinen Schalter und nichts zu pruefen");
    assert.match(res.stderr, /spec/, "der Hinweis nennt den fehlenden Block nicht");
  }, { config: null });
});

// --- Aufrufpfade ------------------------------------------------------------

test("check ohne --paket: Exit ungleich 0", () => {
  mitFixture("zwei-bereiche", (dir) => {
    configSchreiben(dir, { spec: SPEC_BLOCK });
    const res = spec(dir, "check");

    assert.notEqual(res.status, 0, "ein Aufruf ohne --paket haette rot enden muessen");
    assert.match(res.stderr, /--paket/, "die Meldung nennt das fehlende Argument nicht");
  });
});

test("--paket ohne Wert: Exit ungleich 0", () => {
  mitFixture("zwei-bereiche", (dir) => {
    configSchreiben(dir, { spec: SPEC_BLOCK });
    const res = spec(dir, "check", "--paket");

    assert.notEqual(res.status, 0, "'--paket' ohne Wert haette rot enden muessen");
    assert.match(res.stderr, /--paket/, "die Meldung nennt das Argument nicht");
  });
});

test("--paket auf eine nicht lesbare Datei: Exit ungleich 0", () => {
  mitFixture("zwei-bereiche", (dir) => {
    configSchreiben(dir, { spec: SPEC_BLOCK });
    const res = spec(dir, "check", "--paket", "gibt-es-nicht.md");

    assert.notEqual(res.status, 0, "eine nicht lesbare Datei haette rot enden muessen");
    assert.match(res.stderr, /gibt-es-nicht\.md/, "die Meldung nennt die Datei nicht");
  });
});

test("die Hilfe nennt 'check'", () => {
  mitFixture(null, (dir) => {
    assert.match(spec(dir, "--help").stdout, /\bcheck\b/, "die Hilfe fuehrt 'check' nicht auf");
  });
});
