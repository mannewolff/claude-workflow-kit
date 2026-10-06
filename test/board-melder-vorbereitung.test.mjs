// Die vorbereitete Veroeffentlichung in der Laufmeldung (Issue #1248, Plan #1243, A6, A7
// und E13), im selben Prozess gegen den Teil kit/board/melder.mjs.
//
// `nachtlaufMeldung` bildet `stand.vorbereitung` — Form wie `.claude/push-vorbereitung.json`
// (A6) — auf das optionale Feld `releasePreparation` ab. Kennt die Gegenstelle das Feld noch
// nicht, weist sie die Meldung mit 400 ab; `nightrunMelden` meldet dann genau einmal ohne
// das Feld nach (E13). Der Versand ist eingespeist, die Fehler kommen als `BoardError` mit
// `status`, wie sie `_fehler` im Toolbox-Adapter baut.

import { test } from "node:test";
import assert from "node:assert/strict";

import { nachtlaufMeldung, nightrunMelden } from "../kit/board/melder.mjs";
import { BoardError } from "../kit/board/grundlagen.mjs";

const JETZT = new Date("2026-10-06T10:10:00.000Z");
const TOOLBOX = { codeHost: "local", issueTracker: "toolbox", toolbox: { host: "https://board.invalid" } };

function vorbereitung(extra = {}) {
  return {
    ergebnis: "gruen",
    commit: "abc123def456",
    basis: "abc123def456",
    origin: "0011223344",
    version: "3.8.0",
    releaseDateien: true,
    offen: [],
    pakete: ["1244", "1245"],
    rot: null,
    fetch: "ok",
    zeitpunkt: "2026-10-06T05:00:00.000Z",
    laufId: "lauf-1",
    kitStand: "3.7.0",
    abweichung: null,
    ...extra,
  };
}

function stand(extra = {}) {
  return {
    schemaFassung: 1,
    start: "2026-10-06T10:00:00.000Z",
    art: "kette",
    einheiten: [{ id: "1192", titel: "F", ausgang: "fertig", stufen: {
      plan: { dauerMs: 1 }, review: { dauerMs: 1 }, pakete: { dauerMs: 1 }, abdeckung: { dauerMs: 1 }, umsetzung: { dauerMs: 1 },
    } }],
    abschluss: "regulaer",
    complete: true,
    ...extra,
  };
}

test("jedes Ergebnis der Vorbereitung hat seinen Wert in result", () => {
  const erwartet = { gruen: "GREEN", "gruen-offen": "GREEN_PENDING", rot: "RED", "nicht-vorbereitet": "NOT_PREPARED" };
  for (const [ergebnis, result] of Object.entries(erwartet)) {
    const m = nachtlaufMeldung(stand({ vorbereitung: vorbereitung({ ergebnis }) }), JETZT);
    assert.equal(m.releasePreparation.result, result, ergebnis);
  }
});

test("alle Unterfelder werden abgebildet, Kartennummern als Zahlen", () => {
  const v = vorbereitung({
    ergebnis: "rot",
    offen: ["voller Lauf im Build-Dienst (Prüfzweig kit/pruefen)", "Sichtpruefung"],
    rot: { pruefung: "npm test", karten: ["1245"], hinweis: null },
  });
  const m = nachtlaufMeldung(stand({ vorbereitung: v }), JETZT);
  assert.deepEqual(m.releasePreparation, {
    result: "RED",
    commitHash: "abc123def456",
    version: "3.8.0",
    releaseFiles: true,
    pending: ["voller Lauf im Build-Dienst (Prüfzweig kit/pruefen)", "Sichtpruefung"],
    cardNumbers: [1244, 1245],
    redCheck: "npm test",
    redCards: [1245],
  });
});

test("ohne rote Pruefung, Version und Release-Dateien stehen null, false und leere Listen", () => {
  const m = nachtlaufMeldung(stand({ vorbereitung: vorbereitung({ version: null, releaseDateien: false, pakete: [] }) }), JETZT);
  assert.deepEqual(m.releasePreparation, {
    result: "GREEN",
    commitHash: "abc123def456",
    version: null,
    releaseFiles: false,
    pending: [],
    cardNumbers: [],
    redCheck: null,
    redCards: [],
  });
});

test("ein unbekanntes Ergebnis laesst das Feld weg, die Meldung scheitert nicht", () => {
  const m = nachtlaufMeldung(stand({ vorbereitung: vorbereitung({ ergebnis: "halb" }) }), JETZT);
  assert.equal("releasePreparation" in m, false);
});

test("ohne Vorbereitung fehlt das Feld, und stages bleibt bei vier Eintraegen", () => {
  const ohne = nachtlaufMeldung(stand(), JETZT);
  assert.equal("releasePreparation" in ohne, false);
  const mit = nachtlaufMeldung(stand({ vorbereitung: vorbereitung() }), JETZT);
  assert.deepEqual(mit.items[0].stages.map((s) => s.stage), ["plan", "review", "pakete", "abdeckung"]);
  const { releasePreparation, ...rest } = mit;
  assert.ok(releasePreparation);
  assert.deepEqual(rest, ohne, "sonst bleibt die Meldung wie ohne Vorbereitung");
});

// --- Der Nachversuch in `nightrunMelden` (E13) --------------------------------

/** Ein Versand, der der Reihe nach die Ergebnisse in `folge` liefert oder wirft. */
function versand(...folge) {
  const gesendet = [];
  return {
    gesendet,
    senden: async (config, meldung) => {
      gesendet.push(meldung);
      const naechstes = folge[gesendet.length - 1];
      if (naechstes instanceof Error) throw naechstes;
      return naechstes;
    },
  };
}

function abweisung(status) {
  const e = new BoardError(`Toolbox-API-Fehler: HTTP ${status} unbekanntes Feld`);
  e.status = status;
  return e;
}

function melden(datei, senden) {
  const zeilen = [];
  const lauf = nightrunMelden({ datei: "x" }, {
    config: TOOLBOX, lesen: () => JSON.stringify(datei), senden, jetzt: () => JETZT, melde: (z) => zeilen.push(z),
  });
  return { lauf, zeilen };
}

test("nach einer Abweisung mit 400 meldet der Befehl genau einmal ohne das Feld nach und vermerkt den Rueckfall", async () => {
  const { gesendet, senden } = versand(abweisung(400), { outcome: "CREATED" });
  const { lauf, zeilen } = melden(stand({ vorbereitung: vorbereitung() }), senden);
  const antwort = await lauf;
  assert.equal(gesendet.length, 2);
  assert.ok(gesendet[0].releasePreparation);
  assert.equal("releasePreparation" in gesendet[1], false);
  const { releasePreparation, ...ohneFeld } = gesendet[0];
  assert.deepEqual(gesendet[1], ohneFeld, "der Nachversuch ist dieselbe Meldung ohne das Feld");
  assert.equal(antwort.ok, true);
  assert.equal(antwort.outcome, "CREATED");
  assert.match(antwort.rueckfall, /ohne releasePreparation/);
  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /releasePreparation.*HTTP 400/);
});

test("scheitert auch der Nachversuch, kommt sein Fehler durch, ohne dritten Versuch", async () => {
  const { gesendet, senden } = versand(abweisung(400), abweisung(400));
  const { lauf } = melden(stand({ vorbereitung: vorbereitung() }), senden);
  await assert.rejects(lauf, (e) => e instanceof BoardError && e.status === 400);
  assert.equal(gesendet.length, 2);
});

test("kein Nachversuch bei einem anderen Status", async () => {
  for (const status of [409, 422, 500]) {
    const { gesendet, senden } = versand(abweisung(status));
    const { lauf, zeilen } = melden(stand({ vorbereitung: vorbereitung() }), senden);
    await assert.rejects(lauf, (e) => e.status === status);
    assert.equal(gesendet.length, 1, String(status));
    assert.equal(zeilen.length, 0);
  }
});

test("kein Nachversuch bei einem Fehler ohne status", async () => {
  for (const fehler of [new BoardError("Toolbox-API nicht erreichbar"), new Error("HTTP 400")]) {
    const { gesendet, senden } = versand(fehler);
    const { lauf } = melden(stand({ vorbereitung: vorbereitung() }), senden);
    await assert.rejects(lauf, fehler);
    assert.equal(gesendet.length, 1);
  }
});

test("kein Nachversuch, wenn die Meldung das Feld nicht trug", async () => {
  const { gesendet, senden } = versand(abweisung(400));
  const { lauf } = melden(stand(), senden);
  await assert.rejects(lauf, (e) => e.status === 400);
  assert.equal(gesendet.length, 1);
});

test("ohne Abweisung bleibt die Antwort wie heute, ohne Rueckfall", async () => {
  const { gesendet, senden } = versand({ outcome: "REPLACED" });
  const { lauf, zeilen } = melden(stand({ vorbereitung: vorbereitung() }), senden);
  assert.deepEqual(await lauf, { ok: true, outcome: "REPLACED" });
  assert.equal(gesendet.length, 1);
  assert.equal(zeilen.length, 0);
});
