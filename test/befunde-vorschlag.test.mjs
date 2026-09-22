// Der Vorschlag am Board (Issue #804, Plan #797, Fachliche Quelle #768).
//
// `vorschlag --art <a>` legt eine Idee an, sobald die Art oberhalb ihres Nullpunkts die
// Schwelle erreicht; ein zweiter Aufruf ergaenzt sie, statt eine zweite anzulegen.
// `vorschlag --abgelehnt <a>` setzt den Nullpunkt auf den aktuellen Zaehlerstand.
//
// Der Vorschlag ist eine Beobachtung, keine Entscheidung (AK 9): Ob daraus eine
// maschinelle Pruefung wird, entscheidet der Mensch.
//
// Gemessen wird gegen einen STUB-Board-Adapter unter `<dir>/.claude/kit/board.mjs`,
// den `befunde.mjs` ueber KIT_ROOT findet — dasselbe Test-Hook-Muster wie in
// kit/night.mjs (Issue #189). So laeuft das ECHTE kit/befunde.mjs, und die drei
// Antwortformen des Adapters (Nummer, Pool-Idee, Fehlschlag) sind ohne Netz pruefbar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFUNDE = join(repoRoot, "kit", "befunde.mjs");

/** Eine Protokollzeile, wie `befunde.mjs buchen` sie schreibt — sieben Spalten, Art in Spalte 5. */
function zeile(art, { karte = "797", stufe = "plan", rolle = "reviewer", marke = "WICHTIG" } = {}) {
  return `2026-09-22T00:00:00.000Z\t${stufe}\t${karte}\t${rolle}\t${art}\t${marke}\t-`;
}

/**
 * Der Stub-Board-Adapter: schreibt jeden Aufruf als JSON-Zeile in `board-aufrufe.log`
 * und antwortet so, wie `antwort` es vorgibt. `exit` ungleich 0 stellt den
 * gescheiterten Board-Aufruf nach.
 *
 * Der Inhalt von `--body-file`/`--text-file` wandert MIT ins Protokoll: Die Datei liegt
 * in einem Wegwerf-Verzeichnis ausserhalb des Projekts und ist nach dem Aufruf weg —
 * der Test kaeme sonst nicht mehr an den uebergebenen Text.
 */
function stubBoard({ antwort = { id: "812" }, exit = 0 } = {}) {
  return [
    "import { appendFileSync, readFileSync } from 'node:fs';",
    "const argv = process.argv.slice(2);",
    "const i = argv.findIndex((a) => a === '--body-file' || a === '--text-file');",
    "const text = i === -1 ? null : readFileSync(argv[i + 1], 'utf-8');",
    String.raw`appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv, text }) + '\n', 'utf-8');`,
    `const exitCode = ${exit};`,
    String.raw`if (exitCode !== 0) { process.stderr.write('Stub: Board nicht erreichbar\n'); process.exit(exitCode); }`,
    `process.stdout.write(JSON.stringify(${JSON.stringify(antwort)}) + '\\n');`,
  ].join("\n");
}

function setup({ protokoll = [], vorschlaege = null, config = null, board = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "befunde-vorschlag-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  if (protokoll.length > 0) {
    writeFileSync(join(dir, ".claude", "befunde.tsv"), protokoll.map((z) => `${z}\n`).join(""), "utf-8");
  }
  if (vorschlaege !== null) {
    writeFileSync(join(dir, ".claude", "befunde-vorschlaege.json"),
      typeof vorschlaege === "string" ? vorschlaege : JSON.stringify(vorschlaege, null, 2), "utf-8");
  }
  if (config) writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config), "utf-8");
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), stubBoard(board), "utf-8");
  return dir;
}

function mitDir(einstellungen, fn) {
  const dir = setup(einstellungen);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fuehrt `befunde.mjs vorschlag …` im Projekt aus; KIT_ROOT zeigt auf den Stub. */
function vorschlag(dir, ...args) {
  const res = spawnSync(process.execPath, [BEFUNDE, "vorschlag", ...args], {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, KIT_ROOT: dir, STUB_LOG: join(dir, "board-aufrufe.log") },
  });
  return { ...res, json: JSON.parse(res.stdout) };
}

/** Die Board-Aufrufe dieses Laufs als `{ argv, text }`, in Reihenfolge. */
function boardAufrufe(dir) {
  const pfad = join(dir, "board-aufrufe.log");
  if (!existsSync(pfad)) return [];
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
}

function zustand(dir) {
  const pfad = join(dir, ".claude", "befunde-vorschlaege.json");
  if (!existsSync(pfad)) return null;
  return JSON.parse(readFileSync(pfad, "utf-8"));
}

/** Der Wert hinter einem Flag im Argumentvektor eines Board-Aufrufs. */
function wertVon(aufruf, flag) {
  const i = aufruf.argv.indexOf(flag);
  return i === -1 ? null : aufruf.argv[i + 1];
}

const DREI = [zeile("luecke"), zeile("luecke"), zeile("luecke")];

// --- Anlegen ------------------------------------------------------------------

test("[befunde-vorschlag] drei Vorkommen ergeben genau eine Idee am Board", () => {
  mitDir({ protokoll: DREI }, (dir) => {
    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.angelegt, true);
    assert.equal(res.json.karte, "812");

    const aufrufe = boardAufrufe(dir);
    assert.equal(aufrufe.length, 1, "genau ein Board-Aufruf");
    assert.deepEqual(aufrufe[0].argv.slice(0, 2), ["issue", "create"]);
    assert.equal(wertVon(aufrufe[0], "--title"), "[Idee] Maschinelle Pruefung fuer Mangel-Art luecke?");

    assert.deepEqual(zustand(dir), {
      luecke: { karte: "812", ideaId: null, stand: "offen", zaehlerstand: 3, nullpunkt: 0 },
    });
  });
});

test("[befunde-vorschlag] ein vierter Fund ergaenzt den offenen Vorschlag, statt einen zweiten anzulegen", () => {
  mitDir({ protokoll: DREI }, (dir) => {
    assert.equal(vorschlag(dir, "--art", "luecke").status, 0);
    // Der vierte Fund kommt dazu, dann ein erneuter Aufruf.
    writeFileSync(join(dir, ".claude", "befunde.tsv"),
      [...DREI, zeile("luecke", { karte: "805" })].map((z) => `${z}\n`).join(""), "utf-8");

    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.angelegt, false, "keine zweite Idee");
    assert.equal(res.json.ergaenzt, true);

    const aufrufe = boardAufrufe(dir);
    assert.equal(aufrufe.length, 2, "create und comment, kein zweites create");
    assert.deepEqual(aufrufe[1].argv.slice(0, 3), ["issue", "comment", "812"]);
    assert.equal(zustand(dir).luecke.zaehlerstand, 4, "der Vergleichspunkt wandert mit");
    assert.equal(zustand(dir).luecke.karte, "812", "dieselbe Karte");
  });
});

test("[befunde-vorschlag] der Body nennt alle zugrunde liegenden Funde und den Satz zur Streuung", () => {
  const protokoll = [
    zeile("luecke", { karte: "801", stufe: "fachlich", rolle: "po-blick", marke: "KRITISCH" }),
    zeile("luecke", { karte: "802", stufe: "plan", rolle: "architektur-bestand", marke: "WICHTIG" }),
    zeile("luecke", { karte: "803", stufe: "issue", rolle: "schnitt", marke: "HINWEIS" }),
  ];
  mitDir({ protokoll }, (dir) => {
    assert.equal(vorschlag(dir, "--art", "luecke").status, 0);
    const body = boardAufrufe(dir)[0].text;
    assert.match(body, /Nicht alle Funde dieser Art sind mit derselben Pruefung zu fangen\./);
    for (const teil of ["801", "802", "803", "po-blick", "architektur-bestand", "schnitt",
      "fachlich", "plan", "issue", "KRITISCH", "WICHTIG", "HINWEIS", "2026-09-22T00:00:00.000Z"]) {
      assert.ok(body.includes(teil), `'${teil}' fehlt im Body der Idee:\n${body}`);
    }
  });
});

test("[befunde-vorschlag] die Art 'sonstiges' fragt nach der Liste, nicht nach einer Pruefung", () => {
  mitDir({ protokoll: [zeile("sonstiges"), zeile("sonstiges"), zeile("sonstiges")] }, (dir) => {
    assert.equal(vorschlag(dir, "--art", "sonstiges").status, 0);
    assert.equal(wertVon(boardAufrufe(dir)[0], "--title"), "[Idee] Liste der Mangel-Arten erweitern?");
  });
});

test("[befunde-vorschlag] unterhalb der Schwelle entsteht nichts, und das ist kein Fehler", () => {
  mitDir({ protokoll: [zeile("luecke"), zeile("luecke")] }, (dir) => {
    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.erreicht, false);
    assert.equal(res.json.angelegt, false);
    assert.deepEqual(boardAufrufe(dir), [], "kein Board-Aufruf");
    assert.equal(zustand(dir), null, "keine Zustandsdatei ohne Vorschlag");
  });
});

test("[befunde-vorschlag] die Schwelle kommt aus dem Config-Block befunde", () => {
  mitDir({ protokoll: [zeile("luecke"), zeile("luecke")], config: { befunde: { schwelle: 2 } } }, (dir) => {
    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.json.erreicht, true);
    assert.equal(res.json.angelegt, true);
  });
});

// --- Pool-Idee ohne Nummer ----------------------------------------------------

test("[befunde-vorschlag] eine Pool-Idee wird mit ihrer ideaId vermerkt, Stand offen, Exit 0", () => {
  mitDir({ protokoll: DREI, board: { antwort: { id: null, ideaId: "idea-7f3", pending: true } } }, (dir) => {
    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(zustand(dir), {
      luecke: { karte: null, ideaId: "idea-7f3", stand: "offen", zaehlerstand: 3, nullpunkt: 0 },
    });
  });
});

test("[befunde-vorschlag] eine Pool-Idee ohne Nummer laesst sich nicht ergaenzen — gemeldet, nicht gedoppelt", () => {
  mitDir({ protokoll: DREI, board: { antwort: { id: null, ideaId: "idea-7f3", pending: true } } }, (dir) => {
    assert.equal(vorschlag(dir, "--art", "luecke").status, 0);
    writeFileSync(join(dir, ".claude", "befunde.tsv"),
      [...DREI, zeile("luecke")].map((z) => `${z}\n`).join(""), "utf-8");

    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.angelegt, false, "keine zweite Idee");
    assert.equal(res.json.ergaenzt, false);
    assert.match(res.json.grund, /idea-7f3/);
    assert.equal(boardAufrufe(dir).length, 1, "nach dem create kein weiterer Board-Aufruf");
  });
});

// --- Ablehnung ----------------------------------------------------------------

test("[befunde-vorschlag] --abgelehnt setzt den Nullpunkt auf den Zaehlerstand und ruft das Board nicht", () => {
  mitDir({ protokoll: DREI }, (dir) => {
    assert.equal(vorschlag(dir, "--art", "luecke").status, 0);
    const res = vorschlag(dir, "--abgelehnt", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(zustand(dir).luecke.stand, "abgelehnt");
    assert.equal(zustand(dir).luecke.nullpunkt, 3);
    assert.equal(boardAufrufe(dir).length, 1, "die Ablehnung ist ein Handgriff ohne Board-Aufruf");
  });
});

test("[befunde-vorschlag] nach der Ablehnung legt ein weiterer Fund keinen neuen Vorschlag an", () => {
  mitDir({ protokoll: DREI }, (dir) => {
    vorschlag(dir, "--art", "luecke");
    vorschlag(dir, "--abgelehnt", "luecke");
    writeFileSync(join(dir, ".claude", "befunde.tsv"),
      [...DREI, zeile("luecke")].map((z) => `${z}\n`).join(""), "utf-8");

    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.erreicht, false, "vier Vorkommen, Nullpunkt drei — die Schwelle ist nicht erreicht");
    assert.equal(res.json.angelegt, false);
    assert.equal(boardAufrufe(dir).length, 1, "nur das create von vorhin");
  });
});

test("[befunde-vorschlag] erst ab dem Nullpunkt erneut erreichte Schwelle entsteht wieder ein Vorschlag", () => {
  mitDir({ protokoll: DREI }, (dir) => {
    vorschlag(dir, "--art", "luecke");
    vorschlag(dir, "--abgelehnt", "luecke");
    writeFileSync(join(dir, ".claude", "befunde.tsv"),
      [...DREI, zeile("luecke"), zeile("luecke"), zeile("luecke")].map((z) => `${z}\n`).join(""), "utf-8");

    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.erreicht, true, "sechs Vorkommen, Nullpunkt drei");
    assert.equal(res.json.angelegt, true);
    assert.equal(zustand(dir).luecke.stand, "offen");
    assert.equal(zustand(dir).luecke.nullpunkt, 3, "der Nullpunkt der Ablehnung bleibt stehen");
    assert.equal(boardAufrufe(dir).filter((a) => a.argv[1] === "create").length, 2);
  });
});

test("[befunde-vorschlag] --abgelehnt ohne vermerkten Vorschlag setzt den Nullpunkt trotzdem", () => {
  mitDir({ protokoll: DREI }, (dir) => {
    const res = vorschlag(dir, "--abgelehnt", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(zustand(dir).luecke.nullpunkt, 3);
    assert.equal(zustand(dir).luecke.karte, null);
  });
});

// --- Fehlschlag und abgewiesene Aufrufe ---------------------------------------

test("[befunde-vorschlag] ein gescheiterter Board-Aufruf laesst die Zustandsdatei unveraendert", () => {
  mitDir({ protokoll: DREI, board: { exit: 1 } }, (dir) => {
    const res = vorschlag(dir, "--art", "luecke");
    assert.notEqual(res.status, 0, "ein Fehlschlag endet ungleich 0");
    assert.equal(res.json.ok, false, "auch der Fehlschlag ist JSON auf stdout");
    assert.equal(zustand(dir), null, "kein halb vermerkter Vorschlag");
  });
});

test("[befunde-vorschlag] ein gescheitertes Ergaenzen laesst den vermerkten Stand unveraendert", () => {
  mitDir({ protokoll: DREI }, (dir) => {
    assert.equal(vorschlag(dir, "--art", "luecke").status, 0);
    // Ab jetzt antwortet der Stub mit Exit 1.
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), stubBoard({ exit: 1 }), "utf-8");
    writeFileSync(join(dir, ".claude", "befunde.tsv"),
      [...DREI, zeile("luecke")].map((z) => `${z}\n`).join(""), "utf-8");

    const res = vorschlag(dir, "--art", "luecke");
    assert.notEqual(res.status, 0);
    assert.equal(res.json.ok, false);
    assert.equal(zustand(dir).luecke.zaehlerstand, 3, "der Vergleichspunkt bleibt auf dem Stand der Anlage");
  });
});

test("[befunde-vorschlag] eine unlesbare Zustandsdatei wird abgewiesen, statt ueberschrieben", () => {
  mitDir({ protokoll: DREI, vorschlaege: "{kein json" }, (dir) => {
    const res = vorschlag(dir, "--art", "luecke");
    assert.notEqual(res.status, 0);
    assert.equal(res.json.ok, false);
    assert.equal(readFileSync(join(dir, ".claude", "befunde-vorschlaege.json"), "utf-8"), "{kein json");
    assert.deepEqual(boardAufrufe(dir), [], "vor jedem Board-Aufruf abgewiesen");
  });
});

for (const [name, args] of [
  ["ohne --art und ohne --abgelehnt", []],
  ["mit beiden zugleich", ["--art", "luecke", "--abgelehnt", "luecke"]],
  ["mit einer unbekannten Art", ["--art", "gibtsnicht"]],
  ["mit einer unbekannten abgelehnten Art", ["--abgelehnt", "gibtsnicht"]],
  ["mit --art ohne Wert", ["--art"]],
  ["mit einem unbekannten Argument", ["--art", "luecke", "--sonstwas"]],
]) {
  test(`[befunde-vorschlag] ein Aufruf ${name} wird abgewiesen, mit JSON auf stdout`, () => {
    mitDir({ protokoll: DREI }, (dir) => {
      const res = vorschlag(dir, ...args);
      assert.notEqual(res.status, 0, `'${args.join(" ")}' haette abgewiesen werden muessen`);
      assert.equal(res.json.ok, false);
      assert.ok(typeof res.json.fehler === "string" && res.json.fehler !== "");
      assert.deepEqual(boardAufrufe(dir), []);
    });
  });
}

test("[befunde-vorschlag] ohne Protokolldatei ist der Zaehlerstand null und nichts entsteht", () => {
  mitDir({}, (dir) => {
    const res = vorschlag(dir, "--art", "luecke");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.zaehlerstand, 0);
    assert.equal(res.json.angelegt, false);
    assert.deepEqual(boardAufrufe(dir), []);
  });
});

test("[befunde-vorschlag] der Vorschlag einer Art laesst den Vermerk der anderen stehen", () => {
  mitDir({ protokoll: [...DREI, zeile("doppelung"), zeile("doppelung"), zeile("doppelung")] }, (dir) => {
    assert.equal(vorschlag(dir, "--art", "luecke").status, 0);
    assert.equal(vorschlag(dir, "--art", "doppelung").status, 0);
    assert.deepEqual(Object.keys(zustand(dir)).sort(), ["doppelung", "luecke"]);
  });
});

test("[befunde-vorschlag] das Kommando steht im Hilfetext", () => {
  const res = spawnSync(process.execPath, [BEFUNDE, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /vorschlag --art <art>/);
  assert.match(res.stdout, /vorschlag --abgelehnt <art>/);
});
