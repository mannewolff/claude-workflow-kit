// Die Vorbereitung wartet befristet, bis in der Nacht nichts mehr baut (Issue #1250,
// Plan #1243, E8; Kriterium 13 aus #1192).
//
// `aufVorbereitungWarten` wartet im Takt der Umsetzungssperre, bis es die Sperre haelt und
// kein fremder Lauf dieses Projekts mehr baut. Nicht gezaehlt werden der eigene Puls, ein
// Prueflauf und ein Lauf, der selbst in seiner Vorbereitung wartet. Nach Ablauf der Frist
// kommt `ok: false` mit Grund, und die Sperre bleibt frei.
//
// Geprueft im selben Prozess: Uhr und Pause ueber `ketteAbhaengigkeiten`, die Pulse in einem
// eigenen Projektverzeichnis, die Prozess-Probe aus helpers/laufstand-attrappe.mjs. Die
// Sperre ist die echte Datei — ihr Halter ist dieser Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { aufVorbereitungWarten, ketteAbhaengigkeiten, KETTE_ABHAENGIGKEITEN, REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { BERICHT_ANKER } from "../kit/night/bericht.mjs";
import { laufstandStarten, LAUF_ORDNER } from "../kit/night/laufstand.mjs";
import { UMSETZUNG_WARTEN_MS } from "../kit/night/kitstand.mjs";
import { ZUSTAND, UMSETZUNG_LOCK } from "../kit/night/grundlagen.mjs";
import { mitProjekt } from "./helpers/laufstand-attrappe.mjs";
import { ketteImProzess, fachplanKarte, planKarte, planBody, paketBody, jeStufe, vorbereitungAblegen, KETTE_LABEL, GLATT } from "./helpers/kette-fixture.mjs";

const LAUF = "2026-10-06-220000";
const FREMD = "2026-10-06-210000";
const FREMD_PID = 4_000_101;
const ZWEITER_PID = 4_000_102;

const pulsPfad = (dir, lauf) => join(dir, LAUF_ORDNER, `${lauf}.puls`);
const pulsLesen = (dir, lauf = LAUF) => JSON.parse(readFileSync(pulsPfad(dir, lauf), "utf-8"));

/** Legt den Puls eines fremden Laufs an. */
function fremderPuls(dir, lauf, felder) {
  mkdirSync(join(dir, LAUF_ORDNER), { recursive: true });
  writeFileSync(pulsPfad(dir, lauf), JSON.stringify({ zeit: "2026-10-06T21:00:00.000Z", ...felder }), "utf-8");
}

/**
 * Ein eigenes Projekt mit gestartetem Laufstand, eingespeister Uhr und Pause. `beimSchlafen`
 * laeuft in jeder Pause und darf die Lage aendern; jede Pause wird mit der Phase des eigenen
 * Pulses aufgezeichnet. Das blockierende `schlaf` wirft.
 */
async function mitVorbereitung(fn, { lebende = [process.pid], beimSchlafen = () => {} } = {}) {
  await mitProjekt(async (ctx) => {
    const { dir, uhr } = ctx;
    ZUSTAND.LAUF_STEMPEL = LAUF;
    ZUSTAND.LAUF = { art: "kette" };
    laufstandStarten();
    const pausen = [];
    ketteAbhaengigkeiten({
      jetzt: uhr.jetzt,
      schlafen: async (ms) => {
        pausen.push({ ms, phase: pulsLesen(dir).phase });
        uhr.vor(ms);
        await beimSchlafen(pausen.length, ctx);
      },
      schlaf: () => { throw new Error("die Vorbereitung hat das blockierende schlaf benutzt"); },
    });
    try {
      await fn({ ...ctx, kette: { repoRoot: dir, budget: { vorbereitungMin: 120 } }, pausen });
    } finally {
      ketteAbhaengigkeiten();
      rmSync(join(dir, UMSETZUNG_LOCK), { force: true });
    }
  }, { lebende });
}

test("[night-1250] KETTE_ABHAENGIGKEITEN fuehrt ein asynchrones schlafen neben dem blockierenden schlaf", async () => {
  assert.equal(typeof KETTE_ABHAENGIGKEITEN.schlaf, "function");
  const pause = KETTE_ABHAENGIGKEITEN.schlafen(0);
  assert.ok(pause instanceof Promise, "schlafen liefert kein Promise");
  await pause;
});

test("[night-1250] freie Bahn: die Sperre kommt sofort, ohne Pause, und bleibt gehalten", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "ohne Grund gewartet");
    assert.equal(existsSync(join(dir, UMSETZUNG_LOCK)), true, "die Sperre wurde nicht gehalten");
    assert.equal("phase" in pulsLesen(dir), false, "die Phase blieb nach dem Warten stehen");
    ergebnis.freigeben();
    assert.equal(existsSync(join(dir, UMSETZUNG_LOCK)), false, "freigeben raeumt die Sperre nicht");
  });
});

test("[night-1250] belegte Sperre: gewartet wird im Takt der Umsetzung, bis sie frei ist", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    // Die Sperre prueft ihren Halter mit der echten Prozess-Probe: der Elternprozess lebt.
    writeFileSync(join(dir, UMSETZUNG_LOCK), `${process.ppid}\n`, "utf-8");
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.deepEqual(pausen.map((p) => p.ms), [UMSETZUNG_WARTEN_MS, UMSETZUNG_WARTEN_MS]);
    assert.equal(readFileSync(join(dir, UMSETZUNG_LOCK), "utf-8").trim(), String(process.pid));
    ergebnis.freigeben();
  }, {
    beimSchlafen: (n, { dir }) => { if (n === 2) rmSync(join(dir, UMSETZUNG_LOCK)); },
  });
});

test("[night-1250] fremder lebender Lauf: gewartet wird, bis er endet; die Phase steht nur waehrenddessen im Puls", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "kette" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 3);
    assert.deepEqual(pausen.map((p) => p.phase), Array(3).fill("vorbereitung-wartet"), "waehrend des Wartens fehlte die Phase im Puls");
    assert.equal("phase" in pulsLesen(dir), false, "die Phase blieb nach dem Warten stehen");
    assert.equal(pulsLesen(dir).art, "kette", "die Laufart ging beim Zuruecknehmen der Phase verloren");
    ergebnis.freigeben();
  }, {
    lebende: [process.pid, FREMD_PID],
    beimSchlafen: (n, { lebend }) => { if (n === 3) lebend.delete(FREMD_PID); },
  });
});

test("[night-1250] ein toter fremder Puls zaehlt nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "implementierung" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0);
    ergebnis.freigeben();
  });
});

test("[night-1250] der eigene Puls zaehlt nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    assert.equal(pulsLesen(dir).pid, process.pid, "der eigene Puls fehlt");
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "auf den eigenen Puls gewartet");
    ergebnis.freigeben();
  });
});

test("[night-1250] ein lebender Prueflauf zaehlt nicht, er baut nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "pruefung" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "auf einen Prueflauf gewartet");
    ergebnis.freigeben();
  }, { lebende: [process.pid, FREMD_PID] });
});

test("[night-1250] zwei wartende Vorbereitungen verklemmen nicht: eine fremde wartende zaehlt nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "kette", phase: "vorbereitung-wartet" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "auf eine selbst wartende Vorbereitung gewartet");
    ergebnis.freigeben();
  }, { lebende: [process.pid, FREMD_PID] });
});

test("[night-1250] zwei Vorbereitungen laufen nacheinander: die zweite bekommt die Sperre erst nach der ersten", async () => {
  await mitVorbereitung(async ({ kette }) => {
    const folge = [];
    const erste = aufVorbereitungWarten(kette, {}).then(async (lock) => {
      folge.push("erste beginnt");
      await Promise.resolve();
      folge.push("erste endet");
      lock.freigeben();
      return lock;
    });
    const zweite = aufVorbereitungWarten(kette, {}).then((lock) => {
      folge.push("zweite beginnt");
      lock.freigeben();
      return lock;
    });
    const [a, b] = await Promise.all([erste, zweite]);
    assert.equal(a.ok, true, a.grund);
    assert.equal(b.ok, true, b.grund);
    assert.deepEqual(folge, ["erste beginnt", "erste endet", "zweite beginnt"]);
  });
});

test("[night-1250] Frist abgelaufen: ok false mit Grund, keine gehaltene Sperre, keine Phase", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: ZWEITER_PID, art: "kette" });
    const ergebnis = await aufVorbereitungWarten(kette, { fristMin: 3 });
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.grund, new RegExp(FREMD), "der Grund nennt den bauenden Lauf nicht");
    assert.match(ergebnis.grund, /3 min/, "der Grund nennt die Frist nicht");
    assert.equal(pausen.reduce((s, p) => s + p.ms, 0), 3 * 60_000, "ueber die Frist hinaus gewartet");
    assert.equal(existsSync(join(dir, UMSETZUNG_LOCK)), false, "die Sperre blieb nach Fristablauf gehalten");
    assert.equal("phase" in pulsLesen(dir), false, "die Phase blieb nach Fristablauf stehen");
  }, { lebende: [process.pid, ZWEITER_PID] });
});

test("[night-1250] ohne Angabe gilt die Frist vorbereitungMin der Kette", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: ZWEITER_PID, art: "kette" });
    const ergebnis = await aufVorbereitungWarten({ ...kette, budget: { vorbereitungMin: 5 } }, {});
    assert.equal(ergebnis.ok, false);
    assert.equal(pausen.reduce((s, p) => s + p.ms, 0), 5 * 60_000);
  }, { lebende: [process.pid, ZWEITER_PID] });
});

// --- Die Stufe vorbereitung im Lauf der Kette (Plan #1243, A4, A6, E7, E12, E17; Issue #1254) ---
//
// Die Vorbereitung ist eine Stufe des Laufs, nicht einer Kette: `ketteFahren` sammelt die
// Ketten, deren Umsetzung mit Ziel `push-vorbereitet` fertig wurde, und faehrt nach der
// Schleife genau eine Session `/push-main vorbereiten` in der Hauptkopie. Deren Ergebnis ist
// die Datei `.claude/push-vorbereitung.json`; geprueft werden Laufkennung und Zeitpunkt.
// Jede ausloesende Karte bekommt Stufenzeilen und einen eigenen Nachtbericht. Leicht:
// Session, Board und Uhr ueber `ketteImProzess` (KETTE_ABHAENGIGKEITEN), ohne feste Pause.

const ZIEL_PV = "ziel:push-vorbereitet";
const VORBEREITUNG_KENNUNG = `${BERICHT_ANKER} 2026-10-06-020000 — Vorbereitung`;

/**
 * Eine Anforderung `F` mit gepruftem Plan `P` und umgesetzten Paketen, dazu der Laufstand nach
 * der Abdeckung: Plan bis Abdeckung sind vorgefunden, die Umsetzung ebenso, wenn es Pakete gibt.
 * Ohne Pakete laeuft die Stufe umsetzung in diesem Lauf (mit nichts zu tun).
 */
function bisAbdeckung(F, P, paketIds, labels) {
  const markiert = planBody().replace("Plan-Modell: fixture-modell", "Plan-Modell: fixture-modell\nPlan-Review: opus (2026-09-28, Nachtlauf)");
  const pakete = paketIds.map((id, i) => ({
    id, title: `Paket ${id}`, status: "in_review", labels: [], body: paketBody(P, F, { n: i + 1, aufgabe: `Paket ${id}.` }),
  }));
  const karte = fachplanKarte(F, { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, ...labels, "lauf:abgebrochen"] });
  karte.comments = [{ body: `## Laufstand\n\nzuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z` }];
  return [karte, planKarte(P, F, { body: markiert }), ...pakete];
}

const B_FREI = { uebergaenge: { abdeckungUmsetzung: true } };
const vorbereitungen = (r) => r.sitzungen.filter((s) => s.stufe === "vorbereitung");
const berichteDerVorbereitung = (r, id) => r.karte(id).comments.map((c) => c.body).filter((b) => b.startsWith(VORBEREITUNG_KENNUNG));
const staendeVon = (r, id) => r.journal.filter((z) => z.art === "stand" && z.karte === id).map((z) => z.text);
const sperreDa = ({ dir }) => existsSync(join(dir, UMSETZUNG_LOCK));

test("[night-1254] ziel:push-vorbereitet nach fertiger Umsetzung: eine Session /push-main vorbereiten in der Hauptkopie", async () => {
  let ort = null;
  const r = await ketteImProzess({
    karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: B_FREI,
    sitzung: jeStufe({ vorbereitung: (s) => { ort = realpathSync(s.cwd); vorbereitungAblegen()(s); } }),
    nachher: ({ dir }) => ({ dir: realpathSync(dir), sperre: sperreDa({ dir }) }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const [s] = vorbereitungen(r);
  assert.equal(vorbereitungen(r).length, 1);
  assert.match(s.prompt, /^\/push-main vorbereiten/);
  assert.equal(s.modell, r.lauf.modell, "die Session laeuft nicht mit KIT_AGENT_MODEL des Laufs");
  assert.equal(ort, r.nachher.dir, "die Session lief nicht in der Hauptkopie");
  assert.equal(r.lauf.vorbereitung.ergebnis, "gruen");
  assert.deepEqual(r.lauf.vorbereitung.karten, ["1"]);
  assert.equal(r.nachher.sperre, false, "die Umsetzungssperre blieb nach der Vorbereitung gehalten");
  assert.deepEqual(r.abschluss, ["regulaer"]);
});

test("[night-1254] die Laufkennung KIT_NIGHT_RUN erreicht die Session ohne eigenes extraEnv der Vorbereitung", async () => {
  const r = await ketteImProzess({ karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(vorbereitungen(r)[0].laufId, r.lauf.start);
  assert.equal(r.lauf.vorbereitung.laufId, r.lauf.start);
});

test("[night-1254] keine Vorbereitung ohne Ziel push-vorbereitet oder ohne fertige Umsetzung", async () => {
  const umsetzung = await ketteImProzess({ karten: bisAbdeckung("1", "2", ["3", "4"], ["ziel:umsetzung"]), kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }) });
  assert.equal(umsetzung.code, 0, umsetzung.ausgabe);
  assert.deepEqual(vorbereitungen(umsetzung), []);
  assert.equal(umsetzung.lauf.vorbereitung, undefined);
  assert.deepEqual(berichteDerVorbereitung(umsetzung, "1"), []);

  // Die Abdeckung laeuft in diesem Lauf, und die Umsetzung ist im Projekt gesperrt.
  const grenze = await ketteImProzess({ karten: [fachplanKarte("1", { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, ZIEL_PV] })], sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: false } } });
  assert.equal(grenze.code, 0, grenze.ausgabe);
  assert.deepEqual(vorbereitungen(grenze), []);
  assert.equal(grenze.lauf.vorbereitung, undefined);
});

test("[night-1254] mehrere ausloesende Ketten: genau eine Vorbereitung, Stufenzeilen und Bericht an jeder Karte", async () => {
  const r = await ketteImProzess({
    karten: [...bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), ...bisAbdeckung("5", "6", ["7"], [ZIEL_PV])],
    kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen({ pakete: ["3", "4", "7"] }) }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(vorbereitungen(r).length, 1, "mehr als eine Vorbereitung im Lauf");
  assert.deepEqual(r.lauf.vorbereitung.karten, ["1", "5"]);
  for (const id of ["1", "5"]) {
    const staende = staendeVon(r, id).join("\n---\n");
    assert.match(staende, new RegExp(`zuletzt begonnen: vorbereitung begonnen für #${id} um `), staende);
    assert.match(staende, new RegExp(`zuletzt abgeschlossen: vorbereitung fertig für #${id} um `), staende);
    assert.ok(staendeVon(r, id).at(-1).startsWith("fertig bis push-vorbereitet\n"), staendeVon(r, id).at(-1));
    const berichte = berichteDerVorbereitung(r, id);
    assert.equal(berichte.length, 1, `#${id}: ${berichte.length} Berichte der Vorbereitung`);
    assert.match(berichte[0], /#3, #4, #7/);
  }
  // Der Bericht jeder Kette steht davor und bleibt ohne Vorbereitung.
  const kettenbericht = r.karte("1").comments.map((c) => c.body).find((b) => b.startsWith(BERICHT_ANKER) && !b.startsWith(VORBEREITUNG_KENNUNG));
  assert.ok(kettenbericht, "der Bericht der Kette fehlt");
  assert.doesNotMatch(kettenbericht, /Vorbereitung/);
});

test("[night-1254] nur Ketten mit vorbereitung: true gehen an die Vorbereitung", async () => {
  const r = await ketteImProzess({
    karten: [...bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), ...bisAbdeckung("5", "6", ["7"], ["ziel:umsetzung"])],
    kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.lauf.vorbereitung.karten, ["1"]);
  assert.equal(berichteDerVorbereitung(r, "1").length, 1);
  assert.deepEqual(berichteDerVorbereitung(r, "5"), []);
  assert.doesNotMatch(staendeVon(r, "5").join("\n"), /vorbereitung/);
});

test("[night-1254] fehlt die Datei, heisst das Ergebnis nicht-vorbereitet mit Grund", async () => {
  const r = await ketteImProzess({ karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: B_FREI, nachher: sperreDa });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(vorbereitungen(r).length, 1);
  assert.equal(r.lauf.vorbereitung.ergebnis, "nicht-vorbereitet");
  assert.match(r.lauf.vorbereitung.grund, /push-vorbereitung\.json fehlt/);
  const [bericht] = berichteDerVorbereitung(r, "1");
  assert.match(bericht, /nicht vorbereitet/);
  assert.match(bericht, /push-vorbereitung\.json fehlt/);
  assert.match(staendeVon(r, "1").at(-1), /^abgebrochen: Stufe vorbereitung: /);
  assert.equal(r.nachher, false, "die Sperre blieb nach dem Fehlschlag gehalten");
});

test("[night-1254] eine fremde Datei — andere Laufkennung oder aelterer Zeitpunkt — ergibt nicht-vorbereitet", async () => {
  const fremd = await ketteImProzess({ karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen({ laufId: "2026-10-05T02:00:00.000Z" }) }) });
  assert.equal(fremd.lauf.vorbereitung.ergebnis, "nicht-vorbereitet");
  assert.match(fremd.lauf.vorbereitung.grund, /anderen Lauf/);

  const alt = await ketteImProzess({ karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen({ zeitpunkt: "2026-10-05T23:00:00.000Z" }) }) });
  assert.equal(alt.lauf.vorbereitung.ergebnis, "nicht-vorbereitet");
  assert.match(alt.lauf.vorbereitung.grund, /vor dem Beginn der Vorbereitung/);
});

test("[night-1254] Frist abgelaufen: nicht-vorbereitet ohne Session, die fremde Sperre bleibt unberuehrt", async () => {
  const r = await ketteImProzess({
    karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: { ...B_FREI, vorbereitungMin: 2 },
    sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }),
    // Die Sperre haelt ein lebender fremder Prozess: der Elternprozess dieses Tests.
    vorher: ({ dir }) => writeFileSync(join(dir, UMSETZUNG_LOCK), `${process.ppid}\n`, "utf-8"),
    nachher: ({ dir }) => readFileSync(join(dir, UMSETZUNG_LOCK), "utf-8").trim(),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(vorbereitungen(r), []);
  assert.equal(r.lauf.vorbereitung.ergebnis, "nicht-vorbereitet");
  assert.match(r.lauf.vorbereitung.grund, /Frist 2 min/);
  assert.equal(r.nachher, String(process.ppid));
  assert.match(berichteDerVorbereitung(r, "1")[0], /Frist 2 min/);
});

test("[night-1254] umsetzungVorbereitung: false wartet nach einer Umsetzung, die in diesem Lauf lief", async () => {
  // Ohne Pakete ist die Umsetzung nicht vorgefunden: Die Stufe laeuft in diesem Lauf.
  const r = await ketteImProzess({ karten: bisAbdeckung("1", "2", [], [ZIEL_PV]), kette: { uebergaenge: { abdeckungUmsetzung: true, umsetzungVorbereitung: false } }, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(vorbereitungen(r), []);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "unvollstaendig");
  assert.match(einheit.grund, /Übergang umsetzungVorbereitung im Projekt nicht freigegeben/);
  assert.equal(r.lauf.vorbereitung, undefined);
});

test("[night-1254] E7: eine in diesem Lauf vorgefundene Umsetzung sperrt nicht, auch bei umsetzungVorbereitung: false", async () => {
  const r = await ketteImProzess({ karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: { uebergaenge: { abdeckungUmsetzung: true, umsetzungVorbereitung: false } }, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(vorbereitungen(r).length, 1);
  assert.equal(r.lauf.vorbereitung.ergebnis, "gruen");
});

test("[night-1254] der Ergebnisstand traegt vorbereitung", async () => {
  const r = await ketteImProzess({
    karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen() }),
    nachher: ({ dir }) => JSON.parse(readFileSync(join(dir, ".claude", "night-run-2026-10-06-020000.json"), "utf-8")),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(r.nachher.vorbereitung.ergebnis, "gruen");
  assert.equal(r.nachher.vorbereitung.commit, "c0ffee1234567890");
  assert.deepEqual(r.nachher.vorbereitung.karten, ["1"]);
});

test("[night-1254] E17: gruen-offen mit Build-Dienst-Punkt geht unveraendert in Bericht und Ergebnisstand", async () => {
  const offen = ["voller Lauf im Build-Dienst (Prüfzweig kit-pruefung/vorbereitung)", "Windows-Vorabprüfung (windows-pruefung.mjs --vorab)"];
  const r = await ketteImProzess({ karten: bisAbdeckung("1", "2", ["3", "4"], [ZIEL_PV]), kette: B_FREI, sitzung: jeStufe({ vorbereitung: vorbereitungAblegen({ ergebnis: "gruen-offen", offen }) }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(r.lauf.vorbereitung.ergebnis, "gruen-offen");
  assert.deepEqual(r.lauf.vorbereitung.offen, offen);
  const [bericht] = berichteDerVorbereitung(r, "1");
  assert.match(bericht, /grün, Prüfung offen/);
  assert.ok(bericht.includes(`- ${offen[0]}\n- ${offen[1]}`), bericht);
  assert.ok(!r.gitAufrufe.some((a) => a.args[0] === "push"), "der Runner hat gepusht");
});
