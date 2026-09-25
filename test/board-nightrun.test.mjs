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

import { nachtlaufMeldung, nachtlaufAbbruchGrund } from "../kit/board.mjs";
import { verbrauchLeer } from "../kit/night.mjs";
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
  assert.deepEqual(m.usage, { costUsd: 8.032575, inputTokens: 9086306, outputTokens: 62411, cachedInputTokens: 8883160, modelDurationMs: null, turns: null });
  assert.equal(nachtlaufMeldung(stand("kette", []), JETZT).mode, "CHAIN");
  // Ein Lauf ohne Abschluss laeuft noch — wie LAEUFT weiter unten. `complete` haengt seit
  // Issue #881 am Abschluss, nicht mehr am gleichnamigen Feld des Standes.
  assert.equal(nachtlaufMeldung(stand("kette", [], { abschluss: null, complete: false }), JETZT).complete, false);
  assert.equal(nachtlaufMeldung(stand("kette", [], { verbrauch: V(null, null, null, null, null) }), JETZT).usage, null, "nichts gemessen heisst null, nicht 0");
});

// Der harte Stopp des Runners (Issue #881). Bis hierher meldete ihn niemand: Der Lauf
// blieb am Board als unabgeschlossen stehen und stand weiter unter den aktiven Laeufen,
// obwohl er lange tot war. Seit kanban-kit v2.7.0 nimmt die Gegenstelle `abortReason`
// entgegen und wertet den Lauf damit als Stoerung — die Meldung traegt ihn deshalb als
// abgeschlossen (`complete: true`) samt Grund.
//
// Die geschriebene Datei bleibt davon unberuehrt: Dort steht weiterhin `complete: false`.
// Die Quelle der Aussage ist seit diesem Paket `abschluss`.

// Die Laengengrenze des Vertrags fuer Auszuege (NightRunLimits.EXCERPT_MAX); in
// board.mjs traegt sie NACHTLAUF_AUSZUG_MAX, hier steht sie als Erwartung.
const AUSZUG_MAX = 4000;

const HART = (extra = {}) => ({ abschluss: "harterStopp", complete: false, ...extra });

test("[board-21] ein hart gestoppter Lauf gilt als abgeschlossen und traegt seinen Grund", () => {
  const m = nachtlaufMeldung(stand("implementierung", [], HART({ fehlerText: "Working Tree unsauber vor dem Start" })), JETZT);
  assert.equal(m.complete, true, "am Board ist der Lauf vorbei, auch wenn er hart endete");
  assert.equal(m.abortReason, "Working Tree unsauber vor dem Start");
});

test("[board-21] ein regulaer beendeter Lauf meldet kein abortReason", () => {
  const m = nachtlaufMeldung(stand("implementierung", []), JETZT);
  assert.equal(m.complete, true);
  assert.ok(!("abortReason" in m), "ohne Abbruch darf das Feld gar nicht erst auftauchen");
});

test("[board-21] ein laufender Lauf meldet weder complete noch abortReason", () => {
  const m = nachtlaufMeldung(stand("kette", [], { abschluss: null, complete: false }), JETZT);
  assert.equal(m.complete, false);
  assert.ok(!("abortReason" in m));
});

// Die Kaskade aus E3: Der Grund steht je nach Stopp-Pfad an einer anderen Stelle. Das
// Sicherheitsnetz aus Issue #558 laesst `fehlerText` genau dann leer, wenn die betroffene
// Einheit ihn traegt — ohne den zweiten Schritt bliebe der Grund dort liegen.
test("[board-21] der Grund kommt aus fehlerText, sonst von der fehlerEinheit, sonst aus der Fehlerklasse", () => {
  const mitEinheit = [{ id: "7", titel: "T", ausgang: "harterStopp", grund: "Session ohne In-review-Ergebnis" }];
  const gruende = [
    HART({ fehlerText: "Vorflug: Working Tree unsauber", fehlerEinheit: "7", einheiten: mitEinheit }),
    HART({ fehlerText: "", fehlerEinheit: "7", einheiten: mitEinheit }),
    HART({ fehlerText: "", fehlerEinheit: 7, einheiten: mitEinheit }),
    HART({ fehlerText: "", fehlerklasse: "harterStopp" }),
    HART({ fehlerText: "", fehlerEinheit: "9", einheiten: mitEinheit }),
    HART({}),
  ].map((s) => nachtlaufMeldung({ ...stand("implementierung", s.einheiten ?? []), ...s }, JETZT).abortReason);
  assert.deepEqual(gruende, [
    "Vorflug: Working Tree unsauber",
    "Session ohne In-review-Ergebnis",
    "Session ohne In-review-Ergebnis",
    "Harter Stopp (harterStopp)",
    "Harter Stopp",
    "Harter Stopp",
  ]);
});

test("[board-21] ein zu langer Grund wird auf die Laenge des Vertrags gekuerzt", () => {
  const lang = "y".repeat(AUSZUG_MAX + 500);
  const m = nachtlaufMeldung(stand("implementierung", [], HART({ fehlerText: lang })), JETZT);
  assert.equal(m.abortReason.length, AUSZUG_MAX);
  assert.equal(m.abortReason, "y".repeat(AUSZUG_MAX));
});

// `nachtlaufAbbruchGrund` ist eine reine Funktion wie `nachtlaufBudget`: Sie liest den
// Stand und schreibt nichts hinein. Ein tief eingefrorener Eingabestand macht jeden
// Schreibversuch zum Fehler, zwei Aufrufe belegen, dass nichts zwischen ihnen haengen
// bleibt. Fuer die uebrigen nachtlauf*-Hilfen gibt es keinen solchen Test — dieser ist
// der erste.
function tiefEinfrieren(wert) {
  if (wert === null || typeof wert !== "object" || Object.isFrozen(wert)) return wert;
  Object.freeze(wert);
  for (const v of Object.values(wert)) tiefEinfrieren(v);
  return wert;
}

test("[board-21] nachtlaufAbbruchGrund ist rein: eingefrorener Stand, zweimal dasselbe Ergebnis", () => {
  const eingefroren = tiefEinfrieren(stand("implementierung", [
    { id: "7", titel: "T", ausgang: "harterStopp", grund: "Session ohne In-review-Ergebnis" },
  ], HART({ fehlerText: "", fehlerEinheit: "7" })));
  const erst = nachtlaufAbbruchGrund(eingefroren);
  const zweit = nachtlaufAbbruchGrund(eingefroren);
  assert.equal(erst, "Session ohne In-review-Ergebnis");
  assert.equal(zweit, erst);
  assert.equal(nachtlaufAbbruchGrund(tiefEinfrieren(stand("kette", []))), null, "ohne harten Stopp gibt es keinen Grund");
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

// Eine Kette, die ihre bestellte Umsetzung nicht ausfuehren konnte (Issue #862), und eine
// Pruefung, deren Ergebnis den Body nie erreichte — beide tragen den Ausgang
// `unvollstaendig`. GELB und ohne Fehlerklasse: Der Vorgang lief und hat etwas
// hinterlassen, nur nicht alles. GRUEN verschwiege das Fehlende, ROT machte aus einem
// vorgesehenen Ausgang eine Stoerung, und `UNEXPECTED_STATE` — die Farbe bis hierher —
// nannte einen Zustand unerwartet, den das Kit selbst erzeugt. Den Grund traegt der
// `excerpt` der Einheit.
test("[night-862] unvollstaendig ist gelb und ohne Fehlerklasse, in beiden Lauf-Arten", () => {
  const e = { id: "5", titel: "F", ausgang: "unvollstaendig", grund: "Umsetzung ausgelassen: eine andere Umsetzung haelt den Lock (Prozess 4711)" };
  for (const art of ["kette", "implementierung"]) {
    const item = nachtlaufMeldung(stand(art, [e]), JETZT).items[0];
    assert.deepEqual([item.state, item.errorClass], ["YELLOW", null], `Lauf-Art ${art}`);
    assert.match(item.excerpt, /Umsetzung ausgelassen/, `Lauf-Art ${art}: der Grund fehlt im Auszug`);
  }
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
  assert.deepEqual(a.usage, { costUsd: 1, inputTokens: 11, outputTokens: 3, cachedInputTokens: 5, modelDurationMs: null, turns: null });
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

// --- Budgets, Herkunft, Stufen, Modellzeit und Zuege (Issue #808) ---
//
// Der Ergebnisstand fuehrt Budgets, deren Herkunft, die Stufen einer Kette und die
// Kennzahlen je Session vollstaendig; bis Issue #808 las `nachtlaufMeldung` sie nicht.
// Die Herkunft wird auf die fuenf Felder zugeschnitten, die die Fusszeile der
// Laeufe-Seite zeigt (E4), die Stufen auf die vier gemeldeten (E17): `umsetzung`
// als fuenfter Eintrag liesse die ganze Meldung an `@Size(max = 4)` scheitern.

const BUDGET = {
  label: "kit:night", varianteBLabel: "kit:durchziehen",
  planMin: 20, paketeMin: 15, reviewMin: 15, abdeckungMin: 10,
  umsetzungMin: 120, kostenUsd: 50, kostenUsdB: 150, korrekturrunden: 2,
};

test("[board-20] ein Ketten-Lauf meldet sein Budget mit den fuenf gezeigten Feldern und der Herkunft CONFIGURED", () => {
  const m = nachtlaufMeldung(stand("kette", [], { budget: BUDGET }), JETZT);
  assert.deepEqual(m.budget, { planMin: 20, reviewMin: 15, paketeMin: 15, abdeckungMin: 10, kostenUsd: 50, origin: "CONFIGURED" });
  assert.ok(!("defaultFields" in m.budget), "ohne Default-Felder fehlt die Aufzaehlung ganz");
});

// Mit der Konfiguration dieses Projekts stuenden in `budgetAusDefault` genau die drei
// nicht gezeigten Felder — ohne den Zuschnitt entstuende "aus Voreinstellungen" mit
// leerer Aufzaehlung (E4).
test("[board-20] ein budgetAusDefault nur mit nicht gezeigten Feldern heisst CONFIGURED ohne defaultFields", () => {
  const m = nachtlaufMeldung(stand("kette", [], { budget: BUDGET, budgetAusDefault: ["varianteBLabel", "umsetzungMin", "kostenUsdB"] }), JETZT);
  assert.equal(m.budget.origin, "CONFIGURED");
  assert.ok(!("defaultFields" in m.budget));
});

test("[board-20] ein budgetAusDefault mit planMin und kostenUsdB nennt als Default-Feld genau planMin", () => {
  const m = nachtlaufMeldung(stand("kette", [], { budget: BUDGET, budgetAusDefault: ["planMin", "kostenUsdB"] }), JETZT);
  assert.equal(m.budget.origin, "DEFAULTED");
  assert.deepEqual(m.budget.defaultFields, ["planMin"]);
});

test("[board-20] ein Lauf ohne Budget im Stand meldet kein budget-Feld", () => {
  const m = nachtlaufMeldung(stand("implementierung", []), JETZT);
  assert.ok(!("budget" in m), "budget darf ohne Budget im Stand gar nicht erst auftauchen");
});

const K = (kostenUsd, apiDauerMs, zuege) => ({ kostenUsd, apiDauerMs, zuege, eingabeTokens: 10, ausgabeTokens: 20, cacheErzeugtTokens: 30, cacheGelesenTokens: 40 });

test("[board-20] je Vorgang genau die vier gemeldeten Stufen mit Dauer und Verbrauch — umsetzung bleibt draussen", () => {
  const m = nachtlaufMeldung(stand("kette", [{
    id: "5", titel: "F", ausgang: "fertig",
    stufen: {
      plan: { dauerMs: 100, kennzahlen: K(1, 5, 1) },
      review: { dauerMs: 50, kennzahlen: K(1, 5, 1) },
      pakete: { dauerMs: 70, kennzahlen: K(1, 5, 1) },
      abdeckung: { dauerMs: 30, kennzahlen: K(1, 5, 1) },
      umsetzung: { dauerMs: 900, kennzahlen: K(9, 99, 9) },
    },
  }]), JETZT);
  const stages = m.items[0].stages;
  assert.equal(stages.length, 4, "genau vier Stufen, sonst weist der Vertrag die Meldung ab");
  assert.deepEqual(stages.map((s) => s.stage), ["plan", "review", "pakete", "abdeckung"]);
  assert.deepEqual(stages.map((s) => s.durationMs), [100, 50, 70, 30]);
  assert.deepEqual(stages[0].usage, { costUsd: 1, inputTokens: 80, outputTokens: 20, cachedInputTokens: 40, modelDurationMs: 5, turns: 1 });
});

test("[board-20] eine uebernommene Plan-Stufe bleibt aus der Meldung draussen", () => {
  const m = nachtlaufMeldung(stand("kette", [{
    id: "5", titel: "F", ausgang: "fertig",
    stufen: {
      plan: { nummer: "890", uebernommen: true },
      pakete: { dauerMs: 70, kennzahlen: K(1, 5, 1) },
      abdeckung: { dauerMs: 30, kennzahlen: K(1, 5, 1) },
    },
  }]), JETZT);
  const stages = m.items[0].stages;
  assert.deepEqual(stages.map((s) => s.stage), ["pakete", "abdeckung"]);
  assert.deepEqual(stages.map((s) => s.durationMs), [70, 30]);
});

test("[board-20] eine regulaer gelaufene Plan-Stufe wird weiterhin gemeldet", () => {
  const m = nachtlaufMeldung(stand("kette", [{
    id: "5", titel: "F", ausgang: "fertig",
    stufen: { plan: { dauerMs: 100, kennzahlen: K(1, 5, 1) } },
  }]), JETZT);
  assert.deepEqual(m.items[0].stages.map((s) => s.stage), ["plan"]);
});

test("[board-20] ohne stufen fehlt stages am Arbeitspaket", () => {
  const m = nachtlaufMeldung(stand("implementierung", [{ id: "7", titel: "T", ausgang: "erfolg", pruefung: { zustand: "geprueft" } }]), JETZT);
  assert.ok(!("stages" in m.items[0]), "ein Implementierungs-Paket hat keine Stufen zu melden");
});

test("[board-20] Modellzeit und Zuege je Paket aus den eigenen Kennzahlen, bei der Kette aus der Summe der Stufen", () => {
  const impl = nachtlaufMeldung(stand("implementierung", [
    { id: "7", titel: "T", ausgang: "erfolg", pruefung: { zustand: "geprueft" }, verbrauch: V(1, 2, 3, 4, 5), kennzahlen: { apiDauerMs: 296247, zuege: 37 } },
  ]), JETZT).items[0];
  assert.equal(impl.usage.modelDurationMs, 296247);
  assert.equal(impl.usage.turns, 37);
  const kettenItem = nachtlaufMeldung(stand("kette", [
    { id: "5", titel: "F", ausgang: "fertig", verbrauch: V(1, 2, 3, 4, 5), stufen: { plan: { kennzahlen: { apiDauerMs: 5, zuege: 1 } }, review: { kennzahlen: { apiDauerMs: 10, zuege: 2 } } } },
  ]), JETZT).items[0];
  assert.equal(kettenItem.usage.modelDurationMs, 15, "eine Kette ohne eigene Kennzahlen summiert ihre Stufen");
  assert.equal(kettenItem.usage.turns, 3);
});

test("[board-20] ohne Kennzahlen bleiben Modellzeit und Zuege null, und ohne jede Messung bleibt usage null", () => {
  const ohne = nachtlaufMeldung(stand("kette", [{ id: "5", titel: "F", ausgang: "fertig", verbrauch: V(1, 2, 3, 4, 5) }]), JETZT).items[0];
  assert.equal(ohne.usage.modelDurationMs, null);
  assert.equal(ohne.usage.turns, null);
  const leer = nachtlaufMeldung(stand("kette", [{ id: "5", titel: "F", ausgang: "fertig" }]), JETZT).items[0];
  assert.equal(leer.usage, null, "nichts gemessen heisst weiterhin null, nicht ein Objekt aus Nullen");
});

// Der Vertrag des Ergebnisstands bleibt, wie er ist (Issue #808): Modellzeit und Zuege
// stehen nicht in `e.verbrauch`, sondern in `e.kennzahlen` — VERBRAUCH_FELDER waechst
// nicht mit. Belegt ueber das exportierte verbrauchLeer(), das genau diese Felder traegt.
test("[board-20] VERBRAUCH_FELDER des Ergebnisstands bleibt bei den fuenf Mengen-Feldern", () => {
  assert.deepEqual(Object.keys(verbrauchLeer()), ["kostenUsd", "eingabeTokens", "ausgabeTokens", "cacheErzeugtTokens", "cacheGelesenTokens"]);
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
