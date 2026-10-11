// Ablauf-Pruefung: Ob ein englisches Projekt am Einstieg kit/board.mjs nur englische Meldungen des Melders sieht, belegt nur ein gestarteter Prozess, der die Sprache selbst aus der Config liest.
//
// Freitextfelder des Melders zweisprachig (Issue #1454, Plan #1420 E13/E14, Gruppe f).
//
// kit/board/melder.mjs traegt seine Texte an den Menschen in einer Tabelle TEXTE { de, en } und
// gibt sie ueber den Texthelfer aus kit/board/namen.mjs aus:
//   - Paritaet: dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben: `excerpt`, `abortReason`, die Fehler und Hinweise der Melder.
//   - Die deutschen Wortlaut-Tests (test/board-melder-*.test.mjs) bleiben, wie sie sind, und
//     laufen mit der Vorgabe Deutsch.
// Vertrag bleibt (E14): `stages`, `errorClass`, `state`, `grundArt`, die Feldnamen der Meldung
// und der Antworten, die Schweige-Gruende des Sitzungs-Melders (`kein-board`, …), die Werte
// von `abschluss` und die Ergebnisse der Vorbereitung. `title` und `noWorkReason` reicht der
// Melder aus dem Stand durch; die Sprache dieser Texte bestimmt, wer den Stand schreibt.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TEXTE, nachtlaufMeldung, nachtlaufAbbruchGrund, nightrunMelden, sitzungMelden } from "../kit/board/melder.mjs";
import { BoardError } from "../kit/board/grundlagen.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { deutschAmHelferVorbei, deutschImEnglischen } from "./helpers/quelltext-texte.mjs";
import { setupProjekt, runBoardAsync } from "./helpers/board-fixture.mjs";

afterEach(() => spracheFestlegen(null));

const JETZT = new Date("2026-09-16T10:10:00.000Z");
const TOOLBOX = { issueTracker: "toolbox", toolbox: { host: "https://board.example" } };
const SCHWEIGEN = ["nachtbetrieb", "kein-board", "kein-token", "kein-protokoll", "protokoll-nicht-lesbar", "nichts-gemessen", "gedrosselt", "nicht-eingeliefert"];
// Der Wert `nicht-vorbereitet` des Ergebnisses der Vorbereitung (Issue #1248, A6) ist ebenfalls Vertrag.
const VERTRAG = [...SCHWEIGEN, "nicht-vorbereitet"];

function stand(einheiten, extra = {}) {
  return { schemaFassung: 1, start: "2026-09-16T10:00:00.000Z", art: "implementierung", einheiten, abschluss: "regulaer", complete: true, ...extra };
}

test("[1454] die Texttabelle des Melders hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  assert.ok(Object.keys(TEXTE.de).length >= 10, "die Tabelle traegt die Texte des Moduls");
});

test("[1454] die englische Haelfte der Tabelle traegt keine deutschen Woerter", () => {
  assert.deepEqual(deutschImEnglischen(TEXTE), []);
});

test("[1454] jeder deutsche Text des Melders geht ueber den Texthelfer", () => {
  assert.deepEqual(deutschAmHelferVorbei("kit/board/melder.mjs", TEXTE, VERTRAG), []);
});

test("[1454] englisch: excerpt eines festgefahrenen Pakets und abortReason ohne Grund im Stand", () => {
  spracheFestlegen("en");
  const m = nachtlaufMeldung(stand([
    { id: "7", titel: "T", ausgang: "festgefahren", grund: "stuck", grundArt: "sonst", festgefahren: { pruefung: "npm test", fehler: "exit 1" } },
  ]), JETZT);
  assert.equal(m.items[0].excerpt, "stuck\nCheck: npm test\nError: exit 1");
  assert.equal(m.items[0].state, "RED", "state bleibt Vertrag");
  assert.equal(m.items[0].errorClass, "CHECKS_RED", "errorClass bleibt Vertrag");

  assert.equal(nachtlaufAbbruchGrund({ abschluss: "harterStopp" }), "Hard stop");
  assert.equal(nachtlaufAbbruchGrund({ abschluss: "harterStopp", fehlerklasse: "harterStopp" }), "Hard stop (harterStopp)");
  assert.equal(nachtlaufAbbruchGrund({ abschluss: "verstummt" }), "Went silent");
  assert.equal(nachtlaufAbbruchGrund({ abschluss: "abgebrochen" }), "Aborted");
  assert.equal(nachtlaufAbbruchGrund({ abschluss: "harterStopp", fehlerText: "Working tree dirty" }), "Working tree dirty", "ein Grund aus dem Stand geht unveraendert durch");
});

test("[1454] englisch: title und noWorkReason gehen unveraendert durch, der leere Titel faellt auf die Nummer", () => {
  spracheFestlegen("en");
  const m = nachtlaufMeldung(stand([{ id: "8", titel: "", ausgang: "fertig" }], { noWorkReason: "Nothing in Ready" }), JETZT);
  assert.equal(m.items[0].title, "#8");
  assert.equal(m.noWorkReason, "Nothing in Ready");
});

test("[1454] englisch: Fehler und Hinweise von nightrun melden", async () => {
  spracheFestlegen("en");
  const senden = async () => ({ outcome: "CREATED" });
  await assert.rejects(nightrunMelden({ datei: "x" }, { config: { issueTracker: "local" }, senden }),
    { message: "Delivery only possible with issueTracker toolbox, configured is 'local'." });
  await assert.rejects(nightrunMelden({}, { config: TOOLBOX, senden }), { message: "nightrun report needs --file <result.json>" });
  await assert.rejects(nightrunMelden({ datei: "kaputt.json" }, { config: TOOLBOX, lesen: () => "{kaputt", senden }),
    { message: /^Result file kaputt\.json not readable: / });
  assert.throws(() => nachtlaufMeldung({ art: "pruefung" }, JETZT), {
    message: "Run type 'pruefung' has no night-run interface (expected: implementierung | kette)",
  });

  const zeilen = [];
  let erster = true;
  const abweisend = async () => {
    if (erster) {
      erster = false;
      const e = new BoardError("Toolbox API error: HTTP 400 unknown field");
      e.status = 400;
      throw e;
    }
    return { outcome: "CREATED" };
  };
  const antwort = await nightrunMelden({ datei: "x" }, {
    config: TOOLBOX,
    lesen: () => JSON.stringify(stand([], { vorbereitung: { ergebnis: "gruen" } })),
    senden: abweisend,
    jetzt: () => JETZT,
    melde: (z) => zeilen.push(z),
  });
  assert.equal(antwort.rueckfall, "reported again without releasePreparation after HTTP 400");
  assert.deepEqual(zeilen, ["Note: run report with releasePreparation rejected (HTTP 400), retrying without the field: Toolbox API error: HTTP 400 unknown field"]);
});

test("[1454] englisch: Hinweise des Sitzungs-Melders, die Schweige-Gruende bleiben Vertrag", async () => {
  spracheFestlegen("en");
  const ablage = mkdtempSync(join(tmpdir(), "board-melder-texte-en-"));
  try {
    const pfad = join(ablage, "protokoll.jsonl");
    writeFileSync(pfad, JSON.stringify({ timestamp: "2026-09-18T08:00:00.000Z", message: { id: "a", model: "claude-sonnet-5", usage: { input_tokens: 0, output_tokens: 100 } } }) + "\n");
    const hinweise = [];
    const optionen = {
      env: { TBX_CONFIG_DIR: join(ablage, "tbx"), TBX_TOKEN: "t" },
      leseConfig: () => TOOLBOX,
      ablage,
      stdinLesen: () => { throw new Error("kein stdin"); },
      jetzt: () => JETZT,
      melde: (z) => hinweise.push(z),
    };
    const antwort = await sitzungMelden({ protokoll: pfad }, { ...optionen, senden: async () => { throw new Error("HTTP 500 broken"); } });
    assert.deepEqual(antwort, { ok: true, gemeldet: false, grund: "nicht-eingeliefert" });
    assert.deepEqual(hinweise, ["Note: session report not delivered: HTTP 500 broken"]);

    hinweise.length = 0;
    await sitzungMelden({ protokoll: pfad }, { ...optionen, ablage: join(pfad, "kein-verzeichnis"), senden: async () => ({ outcome: "CREATED" }) });
    assert.match(hinweise[0], /^Note: session state not written \(.+\): /);
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[1454] die deutsche Vorgabe bleibt: ohne Spracheinstellung spricht der Melder Deutsch", () => {
  spracheFestlegen("de");
  assert.equal(nachtlaufAbbruchGrund({ abschluss: "verstummt" }), "Verstummt");
  const m = nachtlaufMeldung(stand([{ id: "7", titel: "T", ausgang: "festgefahren", grund: "g", festgefahren: { pruefung: "p", fehler: "f" } }]), JETZT);
  assert.equal(m.items[0].excerpt, "g\nPruefung: p\nFehler: f");
});

test("[1454] ein englisches Projekt sieht keine deutsche Meldung des Melders — gestarteter Einstieg", async () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", language: "en" }, "board-melder-texte-en-");
  try {
    const melden = await runBoardAsync(dir, ["nightrun", "report", "--file", join(dir, "x.json")], {});
    assert.equal(melden.status, 1);
    assert.match(melden.stderr, /Delivery only possible with issueTracker toolbox, configured is 'local'\./);
    for (const achse of ["nightrun", "session"]) {
      const res = await runBoardAsync(dir, [achse, "gibtsnicht"], {});
      assert.equal(res.status, 1, achse);
      assert.match(res.stderr, new RegExp(`Unknown ${achse} command: 'gibtsnicht'`));
      assert.doesNotMatch(res.stderr, /Unbekannter/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
