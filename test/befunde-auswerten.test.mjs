// Bericht und Befundblock der Modell-Pruefungen (Issue #806, Plan #797, Quelle #768).
//
// `auswerten` liest `.claude/befunde.tsv` und `.claude/befunde-vorschlaege.json` und
// schreibt den Bericht nach `.claude/befunde.md` (fuer Menschen) und
// `.claude/befunde.json` (fuer die Ausgabestellen). `befund` liest allein den Stand und
// gibt den Befundblock als Text aus.
//
// Dieselben zwei Zusagen wie bei kit/aufwand.mjs und kit/wirksamkeit.mjs: Exit 0 IN
// JEDEM FALL — auch ohne Datei, mit leerer und mit kaputter Datei, denn der Befund ist
// kein Gate — und byteweise LEERE Ausgabe ohne Befund, ohne Ueberschrift und ohne
// beruhigenden Satz.
//
// Die Stufe `code` wird GETRENNT ausgewiesen (AK 10 der Quelle): die uebernommenen
// Funde mit gruenem Vergleichsstand und die als `nicht-vergleichbar` ausgewiesenen als
// zwei Zahlen, nie als Summe. Ihre Summe saehe aus wie lauter vergleichbare Funde.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFUNDE = join(repoRoot, "kit", "befunde.mjs");

/** Eine Protokollzeile in der Form, die `buchen` schreibt. */
function zeile({ zeitpunkt = "2026-09-20T10:00:00.000Z", stufe = "plan", karte = "42", rolle = "pruefbarkeit", art = "luecke", marke = "WICHTIG", vergleichsstand = "-" } = {}) {
  return [zeitpunkt, stufe, karte, rolle, art, marke, vergleichsstand].join("\t");
}

function befunde(dir, ...args) {
  return spawnSync(process.execPath, [BEFUNDE, ...args], { cwd: dir, encoding: "utf-8" });
}

/** Ein Wegwerf-Projekt mit optionalem Protokoll und optionaler Vorschlagsdatei. */
function mitProjekt({ zeilen = null, vorschlaege = null, config = null }, fn) {
  const dir = mkdtempSync(join(tmpdir(), "kit-befunde-auswerten-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  if (zeilen !== null) {
    writeFileSync(join(dir, ".claude", "befunde.tsv"), zeilen.map((z) => `${z}\n`).join(""), "utf-8");
  }
  if (vorschlaege !== null) {
    writeFileSync(join(dir, ".claude", "befunde-vorschlaege.json"), JSON.stringify(vorschlaege, null, 2), "utf-8");
  }
  if (config !== null) {
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2), "utf-8");
  }
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const standPfad = (dir) => join(dir, ".claude", "befunde.json");
const berichtPfad = (dir) => join(dir, ".claude", "befunde.md");
const bericht = (dir) => readFileSync(berichtPfad(dir), "utf-8");

/** `auswerten` im Projekt; die Ausgabe ist immer JSON. */
function auswerten(dir) {
  const res = befunde(dir, "auswerten");
  assert.equal(res.status, 0, res.stderr || res.stdout);
  return JSON.parse(res.stdout);
}

/** Der Abschnitt des Berichts ab einer Ueberschrift bis zur naechsten. */
function abschnitt(text, ueberschrift) {
  const start = text.indexOf(ueberschrift);
  assert.notEqual(start, -1, `der Abschnitt '${ueberschrift}' fehlt im Bericht:\n${text}`);
  const rest = text.slice(start + ueberschrift.length);
  const ende = rest.search(/^## /m);
  return ende === -1 ? rest : rest.slice(0, ende);
}

// --- auswerten ----------------------------------------------------------------

test("[befunde-auswerten] beide Dateien entstehen auch bei leerem Protokoll, die Ausgabe ist JSON", () => {
  mitProjekt({ zeilen: [] }, (dir) => {
    const stand = auswerten(dir);

    assert.equal(existsSync(standPfad(dir)), true, ".claude/befunde.json fehlt");
    assert.equal(existsSync(berichtPfad(dir)), true, ".claude/befunde.md fehlt");
    assert.equal(stand.ok, true);
    assert.deepEqual(stand.befund, [], "ohne Vorkommen gibt es keinen Befund");
    // Vollstaendig heisst: alle Arten stehen da, auch die mit null Vorkommen — sonst
    // saehe ein Bericht mit einer Art aus wie einer ueber die ganze Liste.
    assert.equal(stand.arten.length, 12, `alle zwoelf Arten gehoeren in den Stand: ${JSON.stringify(stand.arten.map((a) => a.art))}`);
    assert.deepEqual(JSON.parse(readFileSync(standPfad(dir), "utf-8")), stand, "die Datei traegt einen anderen Stand als stdout");
  });
});

test("[befunde-auswerten] ganz ohne Protokolldatei entstehen die Dateien ebenfalls", () => {
  mitProjekt({}, (dir) => {
    const stand = auswerten(dir);

    assert.equal(stand.protokoll.vorhanden, false, "der Stand behauptet ein Protokoll, das es nicht gibt");
    assert.equal(existsSync(standPfad(dir)), true);
    assert.equal(existsSync(berichtPfad(dir)), true);
  });
});

test("[befunde-auswerten] der Bericht weist die Stufe code getrennt aus, nicht als Summe", () => {
  const zeilen = [
    ...Array.from({ length: 3 }, (_, i) => zeile({ stufe: "code", art: "korrektheit", karte: String(700 + i), vergleichsstand: "gruen" })),
    ...Array.from({ length: 2 }, (_, i) => zeile({ stufe: "code", art: "korrektheit", karte: String(800 + i), vergleichsstand: "nicht-vergleichbar" })),
  ];
  mitProjekt({ zeilen }, (dir) => {
    const stand = auswerten(dir);

    assert.equal(stand.code.gruen, 3, "die Zahl der Funde mit gruenem Vergleichsstand stimmt nicht");
    assert.equal(stand.code.nichtVergleichbar, 2, "die Zahl der nicht vergleichbaren Funde stimmt nicht");

    const text = abschnitt(bericht(dir), "## Stufe code");
    const zahlen = new Set((text.match(/\d+/g) ?? []).map(Number));
    assert.ok(zahlen.has(3), `der Abschnitt nennt die 3 gruenen nicht einzeln:\n${text}`);
    assert.ok(zahlen.has(2), `der Abschnitt nennt die 2 nicht vergleichbaren nicht einzeln:\n${text}`);
    assert.ok(!zahlen.has(5), `der Abschnitt nennt die Summe statt beider Zahlen:\n${text}`);
    assert.match(text, /gruen/i, "der Abschnitt benennt den gruenen Vergleichsstand nicht");
    assert.match(text, /nicht[- ]vergleichbar/i, "der Abschnitt benennt den nicht vergleichbaren Stand nicht");
  });
});

// AK 10 der Quelle #768 verlangt die Zahl der uebernommenen Code-Funde auf gruenem
// Stand „getrennt nach Art": Eine Gesamtzahl sagte nicht, welcher Mangel der Maschine
// entgeht — und genau danach fragt das Kriterium.
test("[befunde-auswerten] die Code-Zahlen stehen auch je Art, nicht nur ueber alle", () => {
  const zeilen = [
    zeile({ stufe: "code", art: "korrektheit", vergleichsstand: "gruen" }),
    zeile({ stufe: "code", art: "korrektheit", vergleichsstand: "gruen" }),
    zeile({ stufe: "code", art: "test", vergleichsstand: "nicht-vergleichbar" }),
    zeile({ stufe: "plan", art: "test" }),
  ];
  mitProjekt({ zeilen }, (dir) => {
    const stand = auswerten(dir);

    assert.deepEqual(stand.arten.find((a) => a.art === "korrektheit").code, { gruen: 2, nichtVergleichbar: 0 });
    assert.deepEqual(stand.arten.find((a) => a.art === "test").code, { gruen: 0, nichtVergleichbar: 1 });
    assert.deepEqual(stand.arten.find((a) => a.art === "luecke").code, { gruen: 0, nichtVergleichbar: 0 });
    // Die Gesamtzahl ist die Summe der Teile — zwei Zaehlweisen koennten auseinanderlaufen.
    assert.equal(stand.code.gruen, stand.arten.reduce((s, a) => s + a.code.gruen, 0));
    assert.equal(stand.code.nichtVergleichbar, stand.arten.reduce((s, a) => s + a.code.nichtVergleichbar, 0));

    const kopf = abschnitt(bericht(dir), "## Arten").split("\n").find((z) => z.startsWith("| Art"));
    assert.match(kopf, /code gruen/, "die Tabelle hat keine Spalte fuer den gruenen Vergleichsstand");
    assert.match(kopf, /code nicht-vergleichbar/, "die Tabelle hat keine Spalte fuer den nicht vergleichbaren Stand");
  });
});

test("[befunde-auswerten] je Art stehen Vorkommen und Verteilung ueber die Stufen im Bericht", () => {
  const zeilen = [
    zeile({ stufe: "fachlich", art: "luecke" }),
    zeile({ stufe: "plan", art: "luecke" }),
    zeile({ stufe: "plan", art: "luecke" }),
    zeile({ stufe: "issue", art: "test" }),
  ];
  mitProjekt({ zeilen }, (dir) => {
    const stand = auswerten(dir);

    const luecke = stand.arten.find((a) => a.art === "luecke");
    assert.equal(luecke.vorkommen, 3);
    assert.deepEqual(luecke.stufen, { fachlich: 1, plan: 2, issue: 0, code: 0 });
    assert.equal(stand.arten.find((a) => a.art === "test").vorkommen, 1);
    assert.equal(stand.arten.find((a) => a.art === "form").vorkommen, 0);

    const text = abschnitt(bericht(dir), "## Arten");
    assert.match(text, /luecke/, "die Art 'luecke' fehlt im Bericht");
    assert.match(text, /test/, "die Art 'test' fehlt im Bericht");
  });
});

test("[befunde-auswerten] der Bericht nennt je Art den Stand eines vermerkten Vorschlags", () => {
  const zeilen = [
    ...Array.from({ length: 3 }, () => zeile({ art: "luecke" })),
    ...Array.from({ length: 2 }, () => zeile({ art: "doppelung" })),
  ];
  const vorschlaege = {
    luecke: { karte: "812", ideaId: null, stand: "offen", zaehlerstand: 3, nullpunkt: 0 },
    doppelung: { karte: "813", ideaId: null, stand: "abgelehnt", zaehlerstand: 2, nullpunkt: 2 },
  };
  mitProjekt({ zeilen, vorschlaege }, (dir) => {
    const stand = auswerten(dir);

    assert.equal(stand.arten.find((a) => a.art === "luecke").vorschlag.stand, "offen");
    assert.equal(stand.arten.find((a) => a.art === "luecke").vorschlag.karte, "812");
    assert.equal(stand.arten.find((a) => a.art === "doppelung").vorschlag.stand, "abgelehnt");
    assert.equal(stand.arten.find((a) => a.art === "form").vorschlag, null);

    const text = abschnitt(bericht(dir), "## Arten");
    assert.match(text, /offen/, "der offene Vorschlag steht nicht im Bericht");
    assert.match(text, /abgelehnt/, "der abgelehnte Vorschlag steht nicht im Bericht");
  });
});

test("[befunde-auswerten] der Nullpunkt einer Ablehnung zaehlt: erst darueber greift die Schwelle wieder", () => {
  const zeilen = Array.from({ length: 4 }, () => zeile({ art: "luecke" }));
  const vorschlaege = { luecke: { karte: "812", ideaId: null, stand: "abgelehnt", zaehlerstand: 3, nullpunkt: 3 } };
  mitProjekt({ zeilen, vorschlaege }, (dir) => {
    const stand = auswerten(dir);

    const luecke = stand.arten.find((a) => a.art === "luecke");
    assert.equal(luecke.vorkommen, 4, "gezaehlt wird das ganze Protokoll");
    assert.equal(luecke.nullpunkt, 3);
    assert.equal(luecke.ueberNullpunkt, 1, "oberhalb des Nullpunkts liegt genau ein Fund");
    assert.equal(luecke.erreicht, false, "ein Fund oberhalb des Nullpunkts erreicht die Schwelle 3 nicht");
  });
});

test("[befunde-auswerten] die Schwelle kommt aus dem Config-Block befunde", () => {
  mitProjekt({ zeilen: [zeile({ art: "luecke" })], config: { befunde: { schwelle: 1 } } }, (dir) => {
    const stand = auswerten(dir);

    assert.equal(stand.schwelle, 1);
    assert.equal(stand.arten.find((a) => a.art === "luecke").erreicht, true);
  });
});

test("[befunde-auswerten] fehlerhafte Protokollzeilen werden gezaehlt, nicht gedeutet", () => {
  mitProjekt({ zeilen: [zeile({ art: "luecke" }), "kaputt\tzu\twenig\tspalten"] }, (dir) => {
    const stand = auswerten(dir);

    assert.equal(stand.protokoll.zeilen, 2);
    assert.equal(stand.protokoll.fehlerhafteZeilen, 1);
    assert.equal(stand.arten.find((a) => a.art === "luecke").vorkommen, 1);
  });
});

// --- befund -------------------------------------------------------------------

test("[befunde-befund] mit Vorkommen gibt der Befund je Art eine Zeile mit Zahl und Vorschlagsstand", () => {
  const zeilen = [
    ...Array.from({ length: 3 }, () => zeile({ art: "luecke" })),
    zeile({ art: "test", stufe: "issue" }),
  ];
  const vorschlaege = { luecke: { karte: "812", ideaId: null, stand: "offen", zaehlerstand: 3, nullpunkt: 0 } };
  mitProjekt({ zeilen, vorschlaege }, (dir) => {
    auswerten(dir);

    const res = befunde(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    const [kopf, ...rest] = res.stdout.split("\n");
    assert.match(kopf, /Auswertung vom \d{4}-\d{2}-\d{2}T[\d:.]+Z/, `die Kopfzeile nennt das Datum nicht: ${kopf}`);
    const block = rest.join("\n");
    assert.match(block, /luecke/, "die Art 'luecke' fehlt im Befundblock");
    assert.match(block, /3/, "die Zahl der Vorkommen fehlt");
    assert.match(block, /offen/, "der Stand des Vorschlags fehlt");
    assert.match(block, /test/, "die zweite Art fehlt im Befundblock");
  });
});

test("[befunde-befund] die Stufe code steht auch im Befundblock getrennt", () => {
  const zeilen = [
    zeile({ stufe: "code", art: "korrektheit", vergleichsstand: "gruen" }),
    zeile({ stufe: "code", art: "korrektheit", vergleichsstand: "nicht-vergleichbar" }),
  ];
  mitProjekt({ zeilen }, (dir) => {
    auswerten(dir);

    const { stdout } = befunde(dir, "befund");

    const zeileCode = stdout.split("\n").find((z) => /Stufe `code`/.test(z));
    assert.ok(zeileCode, `im Befundblock steht keine Zeile zur Stufe code:\n${stdout}`);
    assert.match(zeileCode, /gruen/i, "der gruene Vergleichsstand fehlt");
    assert.match(zeileCode, /nicht[- ]vergleichbar/i, "der nicht vergleichbare Stand fehlt");
  });
});

test("[befunde-befund] ohne Vorkommen bleibt die Ausgabe byteweise leer", () => {
  mitProjekt({ zeilen: [] }, (dir) => {
    auswerten(dir);

    const res = befunde(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", `erwartet war eine leere Ausgabe, kam: ${JSON.stringify(res.stdout)}`);
    assert.equal(res.stderr, "", "auch stderr bleibt stumm");
  });
});

test("[befunde-befund] ohne befunde.json bleibt die Ausgabe leer und der Exit-Code 0", () => {
  mitProjekt({}, (dir) => {
    const res = befunde(dir, "befund");

    assert.equal(res.status, 0, `ohne Datei darf der Befund nichts aufhalten: ${res.stderr}`);
    assert.equal(res.stdout, "");
    assert.equal(existsSync(standPfad(dir)), false, "befund legt nichts an — es liest nur");
  });
});

test("[befunde-befund] mit leerer und mit unlesbarer befunde.json bleibt die Ausgabe leer und der Exit-Code 0", () => {
  mitProjekt({}, (dir) => {
    for (const inhalt of ["", "{ das ist kein JSON", JSON.stringify({ erzeugtAm: "2026-09-01T00:00:00.000Z" })]) {
      writeFileSync(standPfad(dir), inhalt, "utf-8");

      const res = befunde(dir, "befund");

      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "", `bei Inhalt ${JSON.stringify(inhalt.slice(0, 20))} kam Ausgabe`);
    }
  });
});

// AK 12 der Quelle: Ein Projekt ohne Modell-Pruefungen sieht nichts — und das ist kein
// Mangel, sondern die Abwesenheit der Pruefung. Ein Config-Schalter waere ein zweiter
// Ort, an dem dasselbe entschieden wird.
test("[befunde-befund] in einem Projekt ohne befunde.tsv bleibt der Befund auch nach auswerten leer", () => {
  mitProjekt({}, (dir) => {
    auswerten(dir);

    const res = befunde(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", `ohne Protokoll darf nichts dastehen, kam: ${JSON.stringify(res.stdout)}`);
  });
});

test("[befunde-befund] der Befund gibt keine Handlungsempfehlung", () => {
  mitProjekt({ zeilen: Array.from({ length: 3 }, () => zeile({ art: "luecke" })) }, (dir) => {
    auswerten(dir);

    const { stdout } = befunde(dir, "befund");

    assert.notEqual(stdout, "", "der Befund haette ausloesen muessen");
    assert.doesNotMatch(stdout, /sollte|empfehl|besser w(ae|ä)re|ratsam/i, "der Befund gibt eine Handlungsempfehlung");
  });
});

test("[befunde-befund] befund weist ein ueberzaehliges Argument ab, ohne etwas auszugeben", () => {
  mitProjekt({}, (dir) => {
    const res = befunde(dir, "befund", "--art", "luecke");

    assert.notEqual(res.status, 0, "ein unbekanntes Argument gehoert abgewiesen");
    assert.equal(res.stdout, "", "auf stdout gehoert hier kein Text, den ein Skill weiterreicht");
    assert.match(res.stderr, /--art/);
  });
});
