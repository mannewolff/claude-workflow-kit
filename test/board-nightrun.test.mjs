// Die Einlieferung eines Nachtlaufs an kanban-kit (Issue #669).
//
// `nachtlaufMeldung` uebersetzt den Ergebnisstand in den Vertrag von
// `POST /api/kanban/night-runs` (kanban-kit, NightRunIngestController, Plan #943). Die
// Farben folgen der Deutung in kanban-kit `frontend/src/lib/nightRunErgebnisstand.ts`,
// beschraenkt auf die beiden Lauf-Arten, die night.mjs heute schreibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { nachtlaufMeldung } from "../kit/board.mjs";
import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const JETZT = new Date("2026-09-16T10:10:00.000Z");
const V = (kostenUsd, eingabe, ausgabe, erzeugt, gelesen) => ({ kostenUsd, eingabeTokens: eingabe, ausgabeTokens: ausgabe, cacheErzeugtTokens: erzeugt, cacheGelesenTokens: gelesen });

function stand(art, einheiten, extra = {}) {
  return { schemaFassung: 1, start: "2026-09-16T10:00:00.000Z", art, einheiten, abschluss: "regulaer", complete: true, verbrauch: V(8.032575, 148, 62411, 202998, 8883160), ...extra };
}

test("[night-31] Kopf: Modus, Start, Dauer, complete und der Lauf-Verbrauch im Vertragsformat", () => {
  const m = nachtlaufMeldung(stand("implementierung", []), JETZT);
  assert.equal(m.mode, "IMPLEMENTATION");
  assert.equal(m.startedAt, "2026-09-16T10:00:00.000Z");
  assert.equal(m.durationMs, 600000);
  assert.equal(m.complete, true);
  assert.equal(m.unparsedCount, 0);
  // Eingabemenge ist alles Verarbeitete, der Zwischenspeicher-Anteil nur das Gelesene:
  // 8.883.160 von 9.086.306 sind die 97,8 Prozent aus dem Issue.
  assert.deepEqual(m.usage, { costUsd: 8.032575, inputTokens: 9086306, outputTokens: 62411, cachedInputTokens: 8883160 });
  assert.equal(nachtlaufMeldung(stand("kette", []), JETZT).mode, "CHAIN");
  assert.equal(nachtlaufMeldung(stand("kette", [], { complete: false }), JETZT).complete, false);
  assert.equal(nachtlaufMeldung(stand("kette", [], { verbrauch: V(null, null, null, null, null) }), JETZT).usage, null, "nichts gemessen heisst null, nicht 0");
});

// Ein Lauf ohne Arbeitspaket vermerkt seinen Grund am Lauf-Kopf (Issue #744); die
// Meldung traegt ihn als eigenes Feld weiter, ohne ihn selbst zu erfinden oder zu
// interpretieren.
test("[board-16] ein vermerkter Grund ohne Arbeit steht als noWorkReason im Rumpf", () => {
  const m = nachtlaufMeldung(stand("implementierung", [], { noWorkReason: "Ready ist leer — nichts zu tun." }), JETZT);
  assert.equal(m.noWorkReason, "Ready ist leer — nichts zu tun.");
});

// Ohne vermerkten Grund — der Regelfall eines Laufs mit Arbeit — fehlt das Feld ganz,
// statt `null` zu behaupten: Ein leerer Grund waere sonst nicht von einem nicht
// uebermittelten zu unterscheiden.
test("[board-16] ohne vermerkten Grund fehlt noWorkReason im Rumpf", () => {
  const m = nachtlaufMeldung(stand("implementierung", []), JETZT);
  assert.ok(!("noWorkReason" in m), "noWorkReason darf ohne Grund gar nicht erst auftauchen");
});

// Die Gegenstelle kuerzt nicht selbst und weist einen zu langen Grund ab (Issue #744) —
// die Kuerzung auf 300 Zeichen muss deshalb hier passieren, bevor die Meldung das Haus
// verlaesst.
test("[board-16] ein Grund laenger als 300 Zeichen wird auf 300 Zeichen gekuerzt", () => {
  const lang = "x".repeat(400);
  const m = nachtlaufMeldung(stand("implementierung", [], { noWorkReason: lang }), JETZT);
  assert.equal(m.noWorkReason.length, 300);
  assert.equal(m.noWorkReason, "x".repeat(300));
});

// Die Art des Laufs steht seit mannewolff/kanban-kit#1012 ausdruecklich im Rumpf. Der
// Endpunkt faellt ohne das Feld auf NIGHT zurueck — genau deshalb wird es hier gesetzt:
// Sobald der Melder interaktiver Sitzungen dieselbe Route mit einem anderen `kind`
// bedient, darf der Nachtlauf nicht am Vorgabewert haengen.
test("[board-10] die Meldung nennt die Art des Laufs ausdruecklich als NIGHT", () => {
  assert.equal(nachtlaufMeldung(stand("implementierung", []), JETZT).kind, "NIGHT");
  assert.equal(nachtlaufMeldung(stand("kette", []), JETZT).kind, "NIGHT");
});

test("[night-31] eine unbekannte Lauf-Art wird abgewiesen statt geraten", () => {
  assert.throws(() => nachtlaufMeldung(stand("review", []), JETZT), /Lauf-Art 'review'/);
});

test("[night-31] Implementierung: Farbe und Fehlerklasse je Ausgang", () => {
  const e = (ausgang, extra = {}) => ({ id: "7", titel: "T", ausgang, ...extra });
  const farben = [
    e("erfolg", { pruefung: { zustand: "geprueft" } }),
    e("erfolg", { pruefung: { zustand: "leeresPaket" } }),
    e("erfolg", { pruefung: { zustand: "ungeprueft" } }),
    e("fehlschlag", { pruefung: { zustand: "rot", rotesKommando: "node --test", rotesErgebnis: "Exit 1" } }),
    e("zurueckgestellt", { grund: "Nachtlauf: Abhaengigkeit #3 nicht erfuellt" }),
    e("zurueckgestellt", { grund: "Traegt kit:klaeren" }),
    e("zurueckgestellt", { grund: "Session ohne In-review-Ergebnis" }),
    e("zurueckgestellt", { grund: "Fachliches Issue" }),
    e("uebersprungen", { grund: "kein Label" }),
    e("liegengeblieben"),
    e("angehalten"),
    e("unbekannt"),
    e("harterStopp"),
    e("etwasNeues"),
  ].map((x) => nachtlaufMeldung(stand("implementierung", [x]), JETZT).items[0]).map((i) => [i.state, i.errorClass]);
  assert.deepEqual(farben, [
    ["GREEN", null], ["GREEN", null], ["YELLOW", "CHECKS_NOT_STARTED"], ["RED", "CHECKS_RED"],
    ["GREY", "DEPENDENCY_UNMET"], ["RED", "AWAITING_DECISION"], ["RED", "UNEXPECTED_STATE"], ["GREY", null],
    ["GREY", null], ["GREY", null], ["RED", "AWAITING_DECISION"], ["RED", "HARD_ABORT"], ["RED", "HARD_ABORT"],
    ["RED", "UNEXPECTED_STATE"],
  ]);
});

test("[night-31] Kette: fertig, angehalten und die drei Abbrueche", () => {
  const e = (ausgang, extra = {}) => ({ id: "5", titel: "F", ausgang, ...extra });
  const farben = [
    e("fertig"),
    e("angehalten"),
    e("abgebrochen", { grund: "Zeitbudget review: die Session wurde nach 15 min am Limit beendet", stufen: { plan: { id: "12" } } }),
    e("abgebrochen", { grund: "Zeitbudget plan erschoepft", stufen: { plan: { id: null } } }),
    e("abgebrochen", { grund: "Kostenbudget: 51.00 $ von 50 $" }),
  ].map((x) => nachtlaufMeldung(stand("kette", [x]), JETZT).items[0]).map((i) => [i.state, i.errorClass]);
  assert.deepEqual(farben, [
    ["GREEN", null], ["RED", "AWAITING_DECISION"], ["YELLOW", "TIME_BUDGET_EXCEEDED"], ["RED", "TIME_BUDGET_EXCEEDED"], ["RED", "HARD_ABORT"],
  ]);
});

// Eine Einheit, der ihr Ausgang noch fehlt, ist ein laufender Vorgang und kein Befund
// (Issue #794). `einheitAnlegen` traegt bis zum Ergebnis den Platzhalter "unbekannt" ein;
// waehrend der Planungsphase einer Kette stuende der Fachplan damit als rotes Paket in
// der Auswertung. Solange der Lauf laeuft, geht er darum gar nicht mit — kanban-kit
// zeigt den Lauf ohnehin als laufend, und ein eigener Zustand "laeuft" waere eine
// Vertragsaenderung ohne Nutzen.
const LAEUFT = { abschluss: null, complete: false };

test("[board-19] ein laufender Lauf meldet nur Einheiten, die ihren Ausgang schon haben", () => {
  const m = nachtlaufMeldung(stand("kette", [
    { id: "5", titel: "Fachplan in der Planungsphase", ausgang: "unbekannt" },
    { id: "9", titel: "Fertiges Paket", ausgang: "erfolg", pruefung: { zustand: "geprueft" } },
  ], LAEUFT), JETZT);
  assert.equal(m.items.length, 1, "die noch laufende Ketten-Einheit geht nicht mit");
  assert.equal(m.items[0].cardNumber, 9);
  assert.deepEqual(m.items.map((i) => i.errorClass), [null], "kein Item traegt eine Fehlerklasse, nur weil die Kette noch laeuft");
  assert.equal(m.processedCount, 1);
  assert.equal(m.skippedCount, 0);
});

test("[board-19] ein fehlendes Ausgangsfeld zaehlt wie der Platzhalter", () => {
  const m = nachtlaufMeldung(stand("kette", [{ id: "5", titel: "Ohne Feld" }], LAEUFT), JETZT);
  assert.deepEqual(m.items, []);
  assert.equal(m.processedCount, 0);
  assert.equal(m.skippedCount, 0);
});

// Der Gegenfall: Am Ende des Laufs ist derselbe Platzhalter die Aussage, dass diese
// Einheit nie zu ihrem Ergebnis kam — sie bleibt sichtbar und behaelt ihre Farbe.
test("[board-19] am Ende eines Laufs bleibt eine Einheit ohne Ausgang als harter Abbruch sichtbar", () => {
  const hart = nachtlaufMeldung(stand("kette", [{ id: "5", titel: "F", ausgang: "unbekannt" }], { abschluss: "harterStopp", complete: false }), JETZT);
  assert.deepEqual(hart.items.map((i) => [i.state, i.errorClass]), [["RED", "HARD_ABORT"]]);
  const regulaer = nachtlaufMeldung(stand("kette", [{ id: "5", titel: "F", ausgang: "unbekannt" }]), JETZT);
  assert.deepEqual(regulaer.items.map((i) => [i.state, i.errorClass]), [["RED", "HARD_ABORT"]]);
});

test("[night-31] Arbeitspaket: Nummer, gekuerzte Texte, Dauer, Commit, Verbrauch; Zaehlwerte nach Farbe", () => {
  const lang = "x".repeat(5000);
  const m = nachtlaufMeldung(stand("kette", [
    { id: "5", titel: "t".repeat(400), ausgang: "abgebrochen", grund: lang, stufen: { plan: { dauerMs: 100 }, review: { dauerMs: 50 } }, verbrauch: V(1, 2, 3, 4, 5) },
    { id: "6", titel: "Zweite", ausgang: "uebersprungen", grund: "kein Label" },
    { id: "abc", titel: "Keine Karte", ausgang: "fertig" },
  ]), JETZT);
  assert.equal(m.items.length, 2, "eine Einheit ohne Kartennummer geht nicht mit");
  const [a, b] = m.items;
  assert.equal(a.cardNumber, 5);
  assert.equal(a.title.length, 300);
  assert.equal(a.excerpt.length, 4000);
  assert.equal(a.durationMs, 150, "eine Kette traegt ihre Dauer je Stufe");
  assert.deepEqual(a.usage, { costUsd: 1, inputTokens: 11, outputTokens: 3, cachedInputTokens: 5 });
  assert.equal(b.usage, null);
  assert.equal(b.commitHash, null);
  assert.equal(nachtlaufMeldung(stand("implementierung", [{ id: "7", titel: "T", ausgang: "erfolg", pruefung: { zustand: "geprueft" }, dauerMs: 9, commit: "abc1234" }]), JETZT).items[0].commitHash, "abc1234");
  assert.equal(m.processedCount, 1);
  assert.equal(m.skippedCount, 1);
});

test("[night-31] nightrun melden schickt die Meldung mit Token an /api/kanban/night-runs", async () => {
  const { server, requests, host } = await starteServer((req) =>
    req.url === "/api/kanban/night-runs" && req.method === "POST" ? { status: 200, json: { startedAt: "2026-09-16T10:00:00Z", outcome: "REPLACED" } } : null);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-nightrun-");
  try {
    const datei = join(dir, "stand.json");
    writeFileSync(datei, JSON.stringify(stand("implementierung", [{ id: "7", titel: "T", ausgang: "erfolg", pruefung: { zustand: "geprueft" } }])));
    const res = await runBoardAsync(dir, ["nightrun", "melden", "--datei", datei], { TBX_TOKEN: "test-token" });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, outcome: "REPLACED" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers["x-kanban-token"], "test-token");
    assert.equal(requests[0].headers["content-type"], "application/json");
    const body = JSON.parse(requests[0].body);
    assert.equal(body.mode, "IMPLEMENTATION");
    assert.equal(body.kind, "NIGHT");
    assert.equal(body.items[0].state, "GREEN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});

test("[night-31] nightrun melden weist einen anderen Tracker und eine fehlende Datei mit Grund ab", async () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-nightrun-");
  try {
    const lokal = await runBoardAsync(dir, ["nightrun", "melden", "--datei", join(dir, "x.json")], {});
    assert.notEqual(lokal.status, 0);
    assert.match(lokal.stderr, /nur mit issueTracker toolbox/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const tb = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host: "http://127.0.0.1:9" } }, "board-nightrun-");
  try {
    const fehlt = await runBoardAsync(tb, ["nightrun", "melden", "--datei", join(tb, "fehlt.json")], { TBX_TOKEN: "t" });
    assert.notEqual(fehlt.status, 0);
    assert.match(fehlt.stderr, /Ergebnisstand .* nicht lesbar/);
  } finally {
    rmSync(tb, { recursive: true, force: true });
  }
});
