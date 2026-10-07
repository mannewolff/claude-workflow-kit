// Auswertung der Ursprungsdokumente eines Plans (Issue #1285, Plan #1283 A3–A8, A11, E2–E4,
// E9): Ist der Plan durch, und welche Ursprungsdokumente — das Plandokument und die
// fachliche Anforderung dahinter — wandern nach In review?
//
// `ursprungAuswerten` ist rein: Die Karten kommen als Fixture in der Form, die
// `auftragAlleKarten` liefert ({ id, titel, body, spalte }), die Kommentare weiterer Plaene
// ueber `kommentareVon`. `ursprungNachziehen` laeuft gegen eine Tracker-Attrappe; das
// Kommando `issue ursprung` prueft test/ablauf-board-dokumente-ursprung.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ursprungAuswerten, ursprungNachziehen } from "../kit/board/ursprung.mjs";

const plan = (id, spalte, { quelle = "10", titel = `[Plan] Plan ${id}` } = {}) => ({
  id, titel, spalte, body: quelle ? `Plan-Modell: x\nFachliche Quelle: Issue #${quelle}\n\n## Ziel\nz` : "## Ziel\nz",
});
const fachlich = (id, spalte, titel = `[Fachlich] Anforderung ${id}`) => ({ id, titel, spalte, body: "## Ziel\nz" });
const paket = (id, planNr, spalte, titel = `Paket ${id}`) => ({
  id, titel, spalte, body: `## Kontext\nPlan: Issue #${planNr}\n\n## Aufgabe\na`,
});

/** Eine `kommentareVon`, die jeden Aufruf mitschreibt. */
function kommentare(je = {}) {
  const aufrufe = [];
  const fn = async (nr) => {
    aufrufe.push(nr);
    return (je[nr] ?? []).map((body) => ({ body }));
  };
  return { fn, aufrufe };
}

const auswerten = (karten, planNr = "20", kv = kommentare().fn) => ursprungAuswerten({ karten, planNr, kommentareVon: kv });
const dok = (ergebnis, art) => ergebnis.dokumente.find((d) => d.art === art);

test("letztes Paket kommt in In review: Plan und Anforderung wandern", async () => {
  const e = await auswerten([fachlich("10", "backlog"), plan("20", "backlog"), paket("21", "20", "done"), paket("22", "20", "in_review")]);
  assert.equal(e.plan, "20");
  assert.equal(e.durch, true);
  assert.deepEqual(e.fehlend, []);
  assert.equal(dok(e, "plan").aktion, "wandert");
  assert.equal(dok(e, "plan").id, "20");
  assert.equal(dok(e, "fachlich").aktion, "wandert");
  assert.equal(dok(e, "fachlich").id, "10");
});

for (const spalte of ["backlog", "ready", "in_progress"]) {
  test(`ein Paket in ${spalte}: Dokumente bleiben, das Paket steht mit Spalte in fehlend`, async () => {
    const e = await auswerten([fachlich("10", "backlog"), plan("20", "ready"), paket("21", "20", "in_review"), paket("22", "20", spalte, "Offen")]);
    assert.equal(e.durch, false);
    assert.deepEqual(e.fehlend, [{ id: "22", titel: "Offen", spalte }]);
    assert.equal(dok(e, "plan").aktion, "bleibt");
    assert.equal(dok(e, "fachlich").aktion, "bleibt");
    assert.match(dok(e, "plan").grund, /#22/);
  });
}

test("ein Paket mit Nachweis-Mangel in In review zaehlt als erledigt (Spalte, nicht paketUmgesetzt)", async () => {
  const mangel = { ...paket("21", "20", "in_review"), body: "Plan: Issue #20\n\nNachtlauf: Nachweis fehlt" };
  const e = await auswerten([fachlich("10", "backlog"), plan("20", "backlog"), mangel]);
  assert.equal(e.durch, true);
  assert.equal(dok(e, "plan").aktion, "wandert");
});

test("Plan schon in In review: lag bereits in In review, kein Zug", async () => {
  const e = await auswerten([fachlich("10", "backlog"), plan("20", "in_review"), paket("21", "20", "done")]);
  assert.equal(dok(e, "plan").aktion, "lag bereits in In review");
  assert.equal(dok(e, "fachlich").aktion, "wandert");
});

test("Plan und Anforderung schon in Done: lag bereits in Done, kein Zug", async () => {
  const e = await auswerten([fachlich("10", "done"), plan("20", "done"), paket("21", "20", "done")]);
  assert.equal(dok(e, "plan").aktion, "lag bereits in Done");
  assert.equal(dok(e, "fachlich").aktion, "lag bereits in Done");
});

test("Anforderung schon in In review: lag bereits in In review", async () => {
  const e = await auswerten([fachlich("10", "in_review"), plan("20", "backlog"), paket("21", "20", "done")]);
  assert.equal(dok(e, "fachlich").aktion, "lag bereits in In review");
});

test("Plan ohne Fachliche Quelle: nur der Plan", async () => {
  const e = await auswerten([plan("20", "backlog", { quelle: null }), paket("21", "20", "in_review")]);
  assert.equal(e.durch, true);
  assert.deepEqual(e.dokumente.map((d) => [d.art, d.aktion]), [["plan", "wandert"]]);
});

test("zwei Plaene einer Anforderung ohne Vermerk: Anforderung erst, wenn beide durch sind", async () => {
  const basis = [fachlich("10", "backlog"), plan("20", "backlog"), paket("21", "20", "in_review"), plan("30", "backlog")];
  const vorher = await auswerten([...basis, paket("31", "30", "in_progress")]);
  assert.equal(dok(vorher, "plan").aktion, "wandert");
  assert.equal(dok(vorher, "fachlich").aktion, "bleibt");
  assert.match(dok(vorher, "fachlich").grund, /#30/);

  const nachher = await auswerten([...basis, paket("31", "30", "done")]);
  assert.equal(dok(nachher, "fachlich").aktion, "wandert");
});

test("ein Plan mit Kommentar 'Ueberholt durch Plan #…' haelt die Anforderung nicht fest", async () => {
  const kv = kommentare({ 30: ["Ueberholt durch Plan #20 (Kette 2026-10-01). Die naechste Kette begann von vorn."] });
  const e = await auswerten([fachlich("10", "backlog"), plan("20", "backlog"), paket("21", "20", "done"), plan("30", "backlog")], "20", kv.fn);
  assert.equal(dok(e, "fachlich").aktion, "wandert");
  assert.deepEqual(kv.aufrufe, ["30"]);
});

test("ein ersetzter Plan ohne Anker haelt die Anforderung fest, auch in Done, und wird als Grund genannt", async () => {
  const kv = kommentare({ 30: ["Ersetzt durch #20, bitte nicht mehr verwenden."] });
  const e = await auswerten([fachlich("10", "backlog"), plan("20", "backlog"), paket("21", "20", "done"), plan("30", "done")], "20", kv.fn);
  assert.equal(dok(e, "plan").aktion, "wandert");
  assert.equal(dok(e, "fachlich").aktion, "bleibt");
  assert.match(dok(e, "fachlich").grund, /Plan #30/);
});

test("Plan ohne Pakete ist nicht durch", async () => {
  const e = await auswerten([fachlich("10", "backlog"), plan("20", "backlog")]);
  assert.equal(e.durch, false);
  assert.equal(dok(e, "plan").aktion, "bleibt");
  assert.equal(dok(e, "fachlich").aktion, "bleibt");
});

test("alle Pakete mit Spalte null: nicht feststellbar, nichts wandert", async () => {
  const e = await auswerten([fachlich("10", null), plan("20", null), paket("21", "20", null), paket("22", "20", null)]);
  assert.equal(e.durch, false);
  assert.equal(e.grund, "nicht feststellbar: Spalten der Pakete nicht lesbar");
  assert.ok(e.dokumente.every((d) => d.aktion !== "wandert"));
});

test("Karte hinter Fachliche Quelle ohne Praefix [Fachlich] bleibt, wo sie ist (E3)", async () => {
  const e = await auswerten([fachlich("10", "backlog", "[Idee] Nur eine Idee"), plan("20", "backlog"), paket("21", "20", "done")]);
  assert.equal(dok(e, "plan").aktion, "wandert");
  assert.equal(dok(e, "fachlich").aktion, "bleibt");
  assert.match(dok(e, "fachlich").grund, /\[Fachlich\]/);
});

test("Karte hinter Plan: ohne Praefix [Plan] bleibt, wo sie ist (E3)", async () => {
  const e = await auswerten([fachlich("10", "backlog"), plan("20", "backlog", { titel: "Ein gewoehnliches Paket" }), paket("21", "20", "done")]);
  assert.equal(e.durch, false);
  assert.ok(e.dokumente.every((d) => d.aktion !== "wandert"));
  assert.match(e.grund, /^nicht feststellbar: .*\[Plan\]/);
});

test("Plan-Karte nicht lesbar: nicht feststellbar mit Grund (E2)", async () => {
  const e = await auswerten([fachlich("10", "backlog"), paket("21", "20", "done")]);
  assert.equal(e.durch, false);
  assert.match(e.grund, /^nicht feststellbar: .*#20/);
  assert.ok(e.dokumente.every((d) => d.aktion !== "wandert"));
});

test("fuehrende Nullen (lokaler Tracker): Plan: Issue #0042 trifft Karte 42", async () => {
  const p = { ...paket("43", "0042", "in_review") };
  const e = await auswerten([{ ...plan("42", "backlog", { quelle: "0010" }) }, fachlich("10", "backlog"), p], "0042");
  assert.equal(e.plan, "42");
  assert.equal(e.durch, true);
  assert.equal(dok(e, "plan").id, "42");
  assert.equal(dok(e, "fachlich").id, "10");
  assert.equal(dok(e, "fachlich").aktion, "wandert");
});

test("kommentareVon wird nicht gerufen, solange der eigene Plan nicht durch ist (E4)", async () => {
  const kv = kommentare();
  await auswerten([fachlich("10", "backlog"), plan("20", "backlog"), paket("21", "20", "ready"), plan("30", "backlog")], "20", kv.fn);
  assert.deepEqual(kv.aufrufe, []);
});

test("kommentareVon wird nicht gerufen, wenn die Anforderung schon in In review oder Done liegt (E4)", async () => {
  for (const spalte of ["in_review", "done"]) {
    const kv = kommentare();
    await auswerten([fachlich("10", spalte), plan("20", "backlog"), paket("21", "20", "done"), plan("30", "backlog")], "20", kv.fn);
    assert.deepEqual(kv.aufrufe, [], spalte);
  }
});

// --- ursprungNachziehen gegen eine Tracker-Attrappe ---

/** Ein Tracker, dessen Spaltenlisten aus `karten` kommen; Zuege und Kommentarabrufe werden mitgeschrieben. */
function trackerAttrappe(karten, { moveFehler = {}, listFehler = null, kommentareJe = {} } = {}) {
  const zuege = [];
  return {
    zuege,
    async listIssues(status) {
      if (listFehler) throw new Error(listFehler);
      return karten.filter((k) => k.spalte === status).map((k) => ({ id: k.id, title: k.titel, body: k.body, status: k.spalte }));
    },
    async moveIssue(id, status) {
      if (moveFehler[id]) throw new Error(moveFehler[id]);
      zuege.push([id, status]);
    },
    async kommentareStreng(id) {
      return (kommentareJe[id] ?? []).map((body) => ({ body }));
    },
  };
}

/** Fuehrt `fn` in einem leeren Arbeitsverzeichnis aus — Wegmarke und Bewegung landeten dort. */
async function imLeerenVerzeichnis(fn) {
  const dir = mkdtempSync(join(tmpdir(), "ursprung-"));
  const vorher = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(vorher);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ursprungNachziehen bewegt nur Aktionen wandert, nur nach in_review, und bucht weder Wegmarke noch Bewegung (E9)", async () => {
  await imLeerenVerzeichnis(async (dir) => {
    const t = trackerAttrappe([fachlich("10", "backlog"), plan("20", "in_review"), paket("21", "20", "done")]);
    const e = await ursprungNachziehen(t, "20");
    assert.deepEqual(t.zuege, [["10", "in_review"]]);
    assert.deepEqual(e.fehler, []);
    assert.equal(dok(e, "plan").aktion, "lag bereits in In review");
    assert.equal(existsSync(join(dir, ".claude", "wegmarken.tsv")), false);
    assert.equal(existsSync(join(dir, ".claude", "bewegungen.tsv")), false);
  });
});

test("ursprungNachziehen zieht nie nach done, auch wenn alles in Done liegt", async () => {
  const t = trackerAttrappe([fachlich("10", "done"), plan("20", "done"), paket("21", "20", "done")]);
  await ursprungNachziehen(t, "20");
  assert.deepEqual(t.zuege, []);
});

test("ursprungNachziehen sammelt einen Fehler je Dokument mit dem Kommando zum Nachziehen (A8)", async () => {
  const t = trackerAttrappe([fachlich("10", "backlog"), plan("20", "backlog"), paket("21", "20", "in_review")],
    { moveFehler: { 20: "Board antwortet nicht" } });
  const e = await ursprungNachziehen(t, "20");
  assert.deepEqual(t.zuege, [["10", "in_review"]]);
  assert.equal(e.fehler.length, 1);
  assert.equal(e.fehler[0].id, "20");
  assert.equal(e.fehler[0].art, "Dokument nicht bewegt");
  assert.match(e.fehler[0].grund, /Board antwortet nicht/);
  assert.match(e.fehler[0].kommando, /issue move 20 in_review/);
});

test("ursprungNachziehen: ein Lesefehler der Listen ergibt nicht feststellbar ohne Zug", async () => {
  const t = trackerAttrappe([], { listFehler: "Netz weg" });
  const e = await ursprungNachziehen(t, "20");
  assert.deepEqual(t.zuege, []);
  assert.equal(e.durch, false);
  assert.match(e.grund, /^nicht feststellbar: .*Netz weg/);
  assert.deepEqual(e.fehler, []);
});

test("ursprungNachziehen liest Kommentare weiterer Plaene ueber den Tracker", async () => {
  const t = trackerAttrappe([fachlich("10", "backlog"), plan("20", "backlog"), paket("21", "20", "done"), plan("30", "backlog")],
    { kommentareJe: { 30: ["Ueberholt durch Plan #20 (Kette x)."] } });
  await ursprungNachziehen(t, "20");
  assert.deepEqual(t.zuege, [["20", "in_review"], ["10", "in_review"]]);
});
