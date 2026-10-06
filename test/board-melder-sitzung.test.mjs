// Der Sitzungs-Melder fuer den interaktiven Verbrauch (Issue #734), im selben Prozess gegen
// den Teil kit/board/melder.mjs (Issue #1222, Plan #1199, E6 und E18).
//
// Was der Melder tut: Er liest das Sitzungsprotokoll von Claude Code, summiert die
// Tokenmengen, teilt sie anhand der Wegmarken aus Issue #733 auf die Karten auf und
// liefert sie ueber dieselbe Route ein wie der Nacht-Runner — mit kind/mode INTERACTIVE.
//
// Drei Eigenschaften entscheiden und werden deshalb an der Wirkung geprueft:
//
// 1. ER ZAEHLT NICHT DOPPELT. Im Protokoll traegt jede Zeile eines Zuges dieselbe
//    `message.id` und dieselbe `usage` — ein langer Zug steht bis zu sechsmal da
//    (nachgemessen am 2026-09-18 an den echten Protokollen dieses Projekts: 90 Zeilen
//    mit usage, 40 verschiedene message.id). Wer jede Zeile zaehlt, meldet ein
//    Vielfaches des Verbrauchs.
// 2. ER SCHWEIGT, statt zu schaetzen oder doppelt zu melden: nachts (E15) und ohne
//    Token (E3) gibt es keinen HTTP-Aufruf.
// 3. ER RAET KEINEN BETRAG. Ein Modell ohne Eintrag in der Preistabelle fuehrt zu
//    keinem Dollarbetrag — nicht zu 0, denn 0 waere eine Messung.


import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { sitzungProtokoll, wegmarkenAbschnitte, sitzungMeldung, sitzungMelden } from "../kit/board/melder.mjs";

const T0 = Date.parse("2026-09-18T08:00:00.000Z");
const MIN = 60_000;
const JETZT = new Date(T0 + 60 * MIN);

/** Eine Protokollzeile, wie Claude Code sie schreibt — auf das Noetige gekuerzt. */
function zug({ id, ms, modell = "claude-sonnet-5", eingabe = 0, ausgabe = 0, cache5m = 0, cache1h = 0, gelesen = 0 }) {
  return JSON.stringify({
    type: "assistant",
    timestamp: new Date(T0 + ms).toISOString(),
    uuid: `${id}-${ms}`,
    message: {
      id,
      model: modell,
      usage: {
        input_tokens: eingabe,
        output_tokens: ausgabe,
        cache_creation_input_tokens: cache5m + cache1h,
        cache_read_input_tokens: gelesen,
        cache_creation: { ephemeral_5m_input_tokens: cache5m, ephemeral_1h_input_tokens: cache1h },
      },
    },
  });
}

/** Eine Zeile ohne usage — Benutzereingabe, Hook-Ausgabe, Warteschlange. */
function ohneUsage(ms) {
  return JSON.stringify({ type: "user", timestamp: new Date(T0 + ms).toISOString(), message: { role: "user", content: "x" } });
}

function protokoll(...zeilen) {
  return zeilen.join("\n") + "\n";
}

/** Eine Wegmarken-Datei, wie `issue move` sie anlegt. */
function marken(...eintraege) {
  return eintraege.map(([ms, karte, status]) => `${new Date(T0 + ms).toISOString()}\t${karte}\t${status}`).join("\n") + "\n";
}

// --- Protokoll lesen --------------------------------------------------------

test("[board-11] die Zeilen eines Zuges zaehlen einmal, nicht so oft wie sie dastehen", () => {
  const text = protokoll(
    ohneUsage(0),
    zug({ id: "msg_a", ms: 1000, eingabe: 5, ausgabe: 100, cache1h: 2000, gelesen: 30_000 }),
    zug({ id: "msg_a", ms: 1200, eingabe: 5, ausgabe: 100, cache1h: 2000, gelesen: 30_000 }),
    zug({ id: "msg_a", ms: 1400, eingabe: 5, ausgabe: 100, cache1h: 2000, gelesen: 30_000 }),
    zug({ id: "msg_b", ms: 9000, eingabe: 3, ausgabe: 50, cache5m: 10, gelesen: 40_000 }),
  );
  const { start, zuege, unlesbar } = sitzungProtokoll(text);
  assert.equal(zuege.length, 2, "drei Zeilen mit derselben message.id sind ein Zug");
  assert.equal(start, new Date(T0).toISOString(), "der Start ist die erste Zeile, auch ohne usage");
  assert.equal(unlesbar, 0);
  assert.deepEqual(zuege.map((z) => z.ausgabe), [100, 50]);
});

test("[board-11] unlesbare Zeilen werden gezaehlt, nicht geworfen", () => {
  const { zuege, unlesbar } = sitzungProtokoll(protokoll("{kaputt", zug({ id: "msg_a", ms: 0, ausgabe: 7 }), "", "kein json"));
  assert.equal(zuege.length, 1);
  assert.equal(unlesbar, 2, "die Leerzeile zaehlt nicht mit");
});

// --- Wegmarken in Abschnitte ------------------------------------------------

test("[board-13] zwei Wegmarken ohne Abschluss staffeln sich: die zweite beendet die erste", () => {
  const a = wegmarkenAbschnitte(marken([10 * MIN, "10", "in_progress"], [20 * MIN, "20", "in_progress"]));
  assert.deepEqual(a, [
    { karte: "10", von: T0 + 10 * MIN, bis: T0 + 20 * MIN },
    { karte: "20", von: T0 + 20 * MIN, bis: null },
  ]);
});

test("[board-13] in_review schliesst den Abschnitt seiner eigenen Karte", () => {
  const a = wegmarkenAbschnitte(marken([10 * MIN, "10", "in_progress"], [30 * MIN, "10", "in_review"]));
  assert.deepEqual(a, [{ karte: "10", von: T0 + 10 * MIN, bis: T0 + 30 * MIN }]);
});

test("[board-13] zwei gleichzeitige Sitzungen erzeugen sich ueberlappende Abschnitte", () => {
  // Sitzung A arbeitet an #10, Sitzung B faengt mittendrin #20 an und wird zuerst fertig.
  const a = wegmarkenAbschnitte(marken(
    [10 * MIN, "10", "in_progress"],
    [20 * MIN, "20", "in_progress"],
    [30 * MIN, "20", "in_review"],
    [40 * MIN, "10", "in_review"],
  ));
  assert.deepEqual(a, [
    { karte: "10", von: T0 + 10 * MIN, bis: T0 + 40 * MIN },
    { karte: "20", von: T0 + 20 * MIN, bis: T0 + 30 * MIN },
  ]);
});

test("[board-13] kaputte Zeilen und fremde Spalten fallen aus den Abschnitten heraus", () => {
  const a = wegmarkenAbschnitte(`kaputt\n\nkeinZeitstempel\t10\tin_progress\n${marken([5 * MIN, "10", "ready"], [10 * MIN, "10", "in_progress"])}`);
  assert.deepEqual(a, [{ karte: "10", von: T0 + 10 * MIN, bis: null }]);
});

// --- Aufteilung und Meldung -------------------------------------------------

const MELDUNG = (text, markenText, extra = {}) => sitzungMeldung({
  ...sitzungProtokoll(text),
  abschnitte: wegmarkenAbschnitte(markenText ?? ""),
  complete: true,
  jetzt: JETZT,
  ...extra,
});

test("[board-11] der Rumpf traegt kind und mode INTERACTIVE, Start und Sitzungssumme", () => {
  const m = MELDUNG(protokoll(
    zug({ id: "a", ms: 0, eingabe: 4, ausgabe: 100, cache1h: 1000, gelesen: 50_000 }),
    zug({ id: "b", ms: 5 * MIN, eingabe: 2, ausgabe: 200, cache1h: 500, gelesen: 60_000 }),
  ), null);
  assert.equal(m.kind, "INTERACTIVE");
  assert.equal(m.mode, "INTERACTIVE");
  assert.equal(m.startedAt, new Date(T0).toISOString());
  assert.equal(m.durationMs, 60 * MIN);
  assert.equal(m.complete, true);
  assert.equal(m.unparsedCount, 0);
  // Eingabemenge ist alles Verarbeitete, der Zwischenspeicher-Anteil nur das Gelesene —
  // dieselbe Deutung wie beim Nachtlauf (nachtlaufUsage).
  assert.equal(m.usage.inputTokens, 4 + 1000 + 50_000 + 2 + 500 + 60_000);
  assert.equal(m.usage.outputTokens, 300);
  assert.equal(m.usage.cachedInputTokens, 110_000);
});

test("[board-13] eine Sitzung ohne Wegmarke meldet alles als Rest ohne Kartennummer", () => {
  const m = MELDUNG(protokoll(zug({ id: "a", ms: 0, ausgabe: 100 }), zug({ id: "b", ms: 5 * MIN, ausgabe: 50 })), null);
  assert.deepEqual(m.items, [], "kein Abschnitt heisst keine Karte");
  assert.equal(m.usage.outputTokens, 150, "der ganze Verbrauch steht in der Sitzungssumme");
  assert.equal(m.processedCount, 0);
  assert.equal(m.skippedCount, 0);
});

test("[board-13] zwei Wegmarken teilen den Verbrauch auf, und die Teile ergeben die Summe", () => {
  const m = MELDUNG(
    protokoll(
      zug({ id: "vorher", ms: 1 * MIN, ausgabe: 7 }),
      zug({ id: "a", ms: 12 * MIN, eingabe: 1, ausgabe: 100, cache1h: 10, gelesen: 1000 }),
      zug({ id: "b", ms: 25 * MIN, eingabe: 2, ausgabe: 200, cache1h: 20, gelesen: 2000 }),
    ),
    marken([10 * MIN, "10", "in_progress"], [20 * MIN, "20", "in_progress"]),
  );
  assert.deepEqual(m.items.map((i) => i.cardNumber), [10, 20]);
  assert.equal(m.items[0].usage.outputTokens, 100);
  assert.equal(m.items[1].usage.outputTokens, 200);
  const teile = m.items.reduce((s, i) => s + i.usage.outputTokens, 0);
  assert.equal(teile + 7, m.usage.outputTokens, "Karten plus Rest ergeben die Sitzungssumme");
  assert.equal(m.processedCount, 2);
});

test("[board-13] der ueberlappende Abschnitt zweier Sitzungen wird Rest, nicht geraten", () => {
  const m = MELDUNG(
    protokoll(
      zug({ id: "nur10", ms: 15 * MIN, ausgabe: 10 }),
      zug({ id: "beide", ms: 25 * MIN, ausgabe: 999 }),
      zug({ id: "wieder10", ms: 35 * MIN, ausgabe: 20 }),
    ),
    marken([10 * MIN, "10", "in_progress"], [20 * MIN, "20", "in_progress"], [30 * MIN, "20", "in_review"], [40 * MIN, "10", "in_review"]),
  );
  assert.deepEqual(m.items.map((i) => i.cardNumber), [10]);
  assert.equal(m.items[0].usage.outputTokens, 30, "nur die eindeutigen Abschnitte gehoeren #10");
  assert.equal(m.usage.outputTokens, 1029, "der ueberlappende Zug bleibt in der Summe, aber ohne Karte");
});

test("[board-11] der Rumpf haelt die Laengengrenzen des Vertrags ein", () => {
  const m = MELDUNG(protokoll(zug({ id: "a", ms: 12 * MIN, ausgabe: 1 })), marken([10 * MIN, "10", "in_progress"]));
  assert.deepEqual(m.items[0], {
    cardNumber: 10,
    title: "#10",
    state: "GREEN",
    errorClass: null,
    durationMs: 50 * MIN,
    commitHash: null,
    excerpt: null,
    usage: m.items[0].usage,
  });
});

// --- Dollarbetrag -----------------------------------------------------------

test("[board-15] der Betrag wird aus den Mengen gerechnet, getrennt nach Cache-Dauer", () => {
  // 1.000.000 Eingabe zu 2, 1.000.000 Ausgabe zu 10, je 1.000.000 Cache zu 2,5 und 4,
  // 1.000.000 gelesen zu 0,20 — Stufe von Sonnet 5 (tier_2_10, Issue #994).
  const m = MELDUNG(protokoll(zug({
    id: "a", ms: 0, modell: "claude-sonnet-5",
    eingabe: 1e6, ausgabe: 1e6, cache5m: 1e6, cache1h: 1e6, gelesen: 1e6,
  })), null);
  assert.equal(m.usage.costUsd, 2 + 10 + 2.5 + 4 + 0.2);
});

test("[board-15] ein Modell ohne Eintrag fuehrt zu keinem Betrag, nicht zu 0", () => {
  const m = MELDUNG(protokoll(zug({ id: "a", ms: 0, modell: "qwen-kit", ausgabe: 1e6 })), null);
  assert.equal(m.usage.costUsd, null);
  assert.equal(m.usage.outputTokens, 1e6, "die Menge steht trotzdem da");
});

test("[board-15] ein unbekanntes Modell ohne Token kostet nichts und verdirbt den Betrag nicht", () => {
  // `<synthetic>` sind Claude Codes eigene Platzhalter — immer mit null Token
  // (nachgemessen 2026-09-18). Null Token kosten zu jedem Preis null; das ist
  // Rechnen, kein Raten.
  const m = MELDUNG(protokoll(
    zug({ id: "a", ms: 0, modell: "claude-sonnet-5", ausgabe: 1e6 }),
    zug({ id: "b", ms: 1 * MIN, modell: "<synthetic>" }),
  ), null);
  assert.equal(m.usage.costUsd, 10);
});

test("[board-15] der Betrag einer Karte faellt weg, ohne den der anderen mitzunehmen", () => {
  const m = MELDUNG(
    protokoll(
      zug({ id: "a", ms: 12 * MIN, modell: "claude-sonnet-5", ausgabe: 1e6 }),
      zug({ id: "b", ms: 25 * MIN, modell: "modell-von-morgen", ausgabe: 1e6 }),
    ),
    marken([10 * MIN, "10", "in_progress"], [20 * MIN, "20", "in_progress"]),
  );
  assert.equal(m.items[0].usage.costUsd, 10);
  assert.equal(m.items[1].usage.costUsd, null);
  assert.equal(m.usage.costUsd, null, "die Sitzungssumme ist unbekannt, sobald ein Teil es ist");
});
// --- Das Kommando -----------------------------------------------------------
//
// Umgebung, Config, Ablage, stdin, Uhr, Versand und Hinweiskanal sind injiziert; die Ablage
// ist ein eigenes Verzeichnis unter tmpdir, damit Drosselung und Wegmarken echte Dateien
// lesen und schreiben. Den Weg ueber die Kommandozeile belegt
// `test/ablauf-board-melder-cli.test.mjs`.

const TOOLBOX = { codeHost: "local", issueTracker: "toolbox", toolbox: { host: "https://board.invalid" } };
const EIN_ZUG = protokoll(zug({ id: "a", ms: 0, ausgabe: 100 }));
const MIT_TOKEN = { TBX_TOKEN: "test-token", KIT_AGENT_MODEL: "" };
/**
 * Ein Melder mit eigener Ablage unter tmpdir. `protokollText` liegt als echte Datei darin:
 * Der Melder liest `--protokoll` vom Dateisystem.
 */
function umgebung({ config = TOOLBOX, env = MIT_TOKEN, protokollText = EIN_ZUG, markenText = null, antwort = { outcome: "REPLACED" }, versandFehler = null } = {}) {
  const ablage = mkdtempSync(join(tmpdir(), "board-melder-sitzung-"));
  const pfad = join(ablage, "protokoll.jsonl");
  writeFileSync(pfad, protokollText, "utf-8");
  if (markenText !== null) writeFileSync(join(ablage, "wegmarken.tsv"), markenText, "utf-8");
  const gesendet = [];
  const hinweise = [];
  const optionen = {
    // Ein leerer tbx-Ordner, damit der globale Login des Rechners nicht als Token zaehlt.
    env: { TBX_CONFIG_DIR: join(ablage, "tbx-config"), ...env },
    leseConfig: () => config,
    ablage,
    stdinLesen: () => { throw new Error("kein stdin"); },
    jetzt: () => JETZT,
    senden: async (cfg, meldung) => {
      if (versandFehler) throw versandFehler;
      gesendet.push({ cfg, meldung });
      return antwort;
    },
    melde: (zeile) => hinweise.push(zeile),
  };
  return {
    ablage, pfad, gesendet, hinweise,
    melden: (args, extra = {}) => sitzungMelden(args, { ...optionen, ...extra }),
    aufraeumen: () => rmSync(ablage, { recursive: true, force: true }),
  };
}

test("[board-11] sitzung melden schickt den Rumpf mit kind/mode INTERACTIVE an das Board", async () => {
  const u = umgebung();
  try {
    const antwort = await u.melden({ protokoll: u.pfad, complete: true });
    assert.deepEqual(antwort, { ok: true, gemeldet: true, complete: true, karten: 0, outcome: "REPLACED" });
    assert.equal(u.gesendet.length, 1);
    assert.equal(u.gesendet[0].cfg, TOOLBOX);
    const body = u.gesendet[0].meldung;
    assert.equal(body.kind, "INTERACTIVE");
    assert.equal(body.mode, "INTERACTIVE");
    assert.equal(body.complete, true);
    assert.equal(body.durationMs, 60 * MIN, "die Dauer misst die injizierte Uhr");
    assert.equal(body.usage.outputTokens, 100);
  } finally {
    u.aufraeumen();
  }
});

test("[board-12] bei gesetztem KIT_AGENT_MODEL wird nichts gesendet und keine Config gelesen", async () => {
  const u = umgebung({ env: { TBX_TOKEN: "t", KIT_AGENT_MODEL: "claude-opus-5" } });
  try {
    const antwort = await u.melden({ complete: true }, { leseConfig: () => assert.fail("die Config darf nachts nicht gelesen werden") });
    assert.deepEqual(antwort, { ok: true, gemeldet: false, grund: "nachtbetrieb" });
    assert.equal(u.gesendet.length, 0, "der Nacht-Runner meldet diese Session bereits selbst");
  } finally {
    u.aufraeumen();
  }
});

test("[board-12] ohne Zugriffstoken wird nichts gesendet", async () => {
  const u = umgebung({ env: { KIT_AGENT_MODEL: "" } });
  try {
    assert.deepEqual(await u.melden({ protokoll: u.pfad, complete: true }), { ok: true, gemeldet: false, grund: "kein-token" });
    assert.equal(u.gesendet.length, 0);
  } finally {
    u.aufraeumen();
  }
});

test("[board-12] ohne Board-Tracker, ohne Config, ohne Protokoll und ohne Zuege wird nichts gemeldet", async () => {
  const lokal = umgebung({ config: { codeHost: "local", issueTracker: "local" } });
  const ohneConfig = umgebung({ config: null });
  const ohne = umgebung();
  const leer = umgebung({ protokollText: protokoll(ohneUsage(0)) });
  try {
    assert.equal((await lokal.melden({ protokoll: lokal.pfad })).grund, "kein-board");
    assert.equal((await ohneConfig.melden({})).grund, "kein-board");
    assert.equal((await ohne.melden({ protokoll: join(ohne.ablage, "gibt-es-nicht.jsonl") })).grund, "protokoll-nicht-lesbar");
    assert.equal((await ohne.melden({ protokoll: undefined })).grund, "kein-protokoll", "ein unlesbarer Hook-Rumpf heisst: kein Protokoll");
    assert.equal((await leer.melden({ protokoll: leer.pfad })).grund, "nichts-gemessen");
    for (const u of [lokal, ohneConfig, ohne, leer]) assert.equal(u.gesendet.length, 0);
  } finally {
    for (const u of [lokal, ohneConfig, ohne, leer]) u.aufraeumen();
  }
});

test("[board-12] ein Hook-Rumpf ohne transcript_path heisst: kein Protokoll", async () => {
  const u = umgebung();
  try {
    const antwort = await u.melden({ protokoll: undefined }, { stdinLesen: () => JSON.stringify({ session_id: "x" }) });
    assert.equal(antwort.grund, "kein-protokoll");
  } finally {
    u.aufraeumen();
  }
});

test("[board-11] ohne --protokoll kommt der Pfad aus dem Hook-Rumpf auf stdin", async () => {
  const u = umgebung();
  try {
    const { pfad } = u;
    const antwort = await u.melden({ protokoll: undefined, complete: true }, { stdinLesen: () => JSON.stringify({ transcript_path: pfad }) });
    assert.equal(antwort.gemeldet, true);
    assert.equal(u.gesendet.length, 1);
  } finally {
    u.aufraeumen();
  }
});

test("[board-14] zwei Zuege binnen fuenf Minuten erzeugen genau eine Zwischenmeldung", async () => {
  const u = umgebung();
  try {
    const { pfad } = u;
    assert.equal((await u.melden({ protokoll: pfad })).gemeldet, true);

    writeFileSync(pfad, protokoll(zug({ id: "a", ms: 0, ausgabe: 100 }), zug({ id: "b", ms: 1000, ausgabe: 50 })), "utf-8");
    const zweite = await u.melden({ protokoll: pfad }, { jetzt: () => new Date(JETZT.getTime() + 4 * MIN) });
    assert.deepEqual(zweite, { ok: true, gemeldet: false, grund: "gedrosselt" });
    assert.equal(u.gesendet.length, 1);

    // Nach Ablauf der fuenf Minuten meldet die naechste Zwischenmeldung wieder.
    const spaeter = await u.melden({ protokoll: pfad }, { jetzt: () => new Date(JETZT.getTime() + 5 * MIN) });
    assert.equal(spaeter.gemeldet, true);

    // Das Sitzungsende wird nicht gedrosselt — sonst verloere jede kurze Sitzung ihren
    // Abschluss und der Leitstand haette nie einen vollstaendigen Stand.
    const ende = await u.melden({ protokoll: pfad, complete: true }, { jetzt: () => new Date(JETZT.getTime() + 6 * MIN) });
    assert.equal(ende.gemeldet, true);
    assert.deepEqual(u.gesendet.map((g) => g.meldung.complete), [false, false, true]);
  } finally {
    u.aufraeumen();
  }
});

test("[board-14] ein fremder oder kaputter Stand zaehlt als noch nie gemeldet", async () => {
  const u = umgebung();
  try {
    const { pfad } = u;
    writeFileSync(join(u.ablage, "sitzung-meldung.json"), "{kaputt", "utf-8");
    assert.equal((await u.melden({ protokoll: pfad })).gemeldet, true);
    writeFileSync(join(u.ablage, "sitzung-meldung.json"), JSON.stringify({ sitzung: "andere", zuletzt: JETZT.toISOString() }), "utf-8");
    assert.equal((await u.melden({ protokoll: pfad })).gemeldet, true);
  } finally {
    u.aufraeumen();
  }
});

test("[board-14] nach complete ist die Wegmarken-Datei leer, nach einer Zwischenmeldung nicht", async () => {
  const markenText = marken([10 * MIN, "10", "in_progress"]);
  const u = umgebung({ markenText });
  const datei = join(u.ablage, "wegmarken.tsv");
  try {
    const { pfad } = u;
    await u.melden({ protokoll: pfad });
    assert.equal(readFileSync(datei, "utf-8"), markenText, "eine Zwischenmeldung laesst die Abschnitte stehen");
    assert.equal(u.gesendet[0].meldung.items.length, 0, "der Zug liegt vor der Wegmarke und gehoert keiner Karte");

    await u.melden({ protokoll: pfad, complete: true });
    assert.equal(existsSync(datei), true, "die Datei bleibt, sie wird geleert");
    assert.equal(readFileSync(datei, "utf-8"), "", "nach dem Sitzungsende zaehlt keine Wegmarke mehr");
    assert.deepEqual(JSON.parse(readFileSync(join(u.ablage, "sitzung-meldung.json"), "utf-8")), { sitzung: new Date(T0).toISOString(), zuletzt: null });
  } finally {
    u.aufraeumen();
  }
});

test("[board-14] eine gescheiterte Meldung leert die Wegmarken nicht und beendet die Sitzung nicht hart", async () => {
  const markenText = marken([10 * MIN, "10", "in_progress"]);
  const u = umgebung({ markenText, versandFehler: new Error("HTTP 500 kaputt") });
  try {
    const antwort = await u.melden({ protokoll: u.pfad, complete: true });
    assert.deepEqual(antwort, { ok: true, gemeldet: false, grund: "nicht-eingeliefert" }, "der Melder ist Buchhaltung, keine Bedingung");
    assert.deepEqual(u.hinweise, ["Hinweis: Sitzungs-Meldung nicht eingeliefert: HTTP 500 kaputt"]);
    assert.equal(readFileSync(join(u.ablage, "wegmarken.tsv"), "utf-8"), markenText, "nicht eingeliefert heisst nicht verbucht");
    assert.equal(existsSync(join(u.ablage, "sitzung-meldung.json")), false, "und nicht gedrosselt");
  } finally {
    u.aufraeumen();
  }
});

test("[board-14] ein Stand, der sich nicht schreiben laesst, bleibt ein Hinweis", async () => {
  const u = umgebung();
  try {
    const { pfad } = u;
    // Die Ablage ist eine Datei: mkdir scheitert, die Meldung ist trotzdem raus.
    const versperrt = join(u.ablage, "versperrt");
    writeFileSync(versperrt, "", "utf-8");
    const antwort = await u.melden({ protokoll: pfad }, { ablage: versperrt });
    assert.equal(antwort.gemeldet, true);
    assert.equal(u.hinweise.length, 1);
    assert.match(u.hinweise[0], /^Hinweis: Sitzungs-Stand nicht geschrieben/);
  } finally {
    u.aufraeumen();
  }
});
