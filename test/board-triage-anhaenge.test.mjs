// Anhaenge einer kanban-kit-Karte in der Ablage von /triage (Issue #1681): `ablageFuellen`
// schreibt die Anhaenge unter `.claude/ideas/<N>/`, ohne eine vorhandene Datei zu ersetzen,
// `anhaengeLaden` sagt, wann `issue triage` laedt, `ablageLesen` nennt die Herkunft je Datei,
// und die beiden Abrufe des Toolbox-Adapters laufen mit gestelltem `fetch`.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ablageFuellen, ablageLesen, anhaengeHolen, anhaengeLaden, anhangGrund } from "../kit/board/triage.mjs";
import { ToolboxIssueTracker } from "../kit/board/adapter.mjs";
import { BoardError } from "../kit/board/grundlagen.mjs";
import { TOOLBOX_UEBERLAST_TYPE } from "../kit/board/wiederholung.mjs";

// Der Token kommt aus der Umgebung dieses Testprozesses; node:test startet je Datei einen Prozess.
process.env.TBX_TOKEN = "test-token";
process.env.TBX_CONFIG_DIR = "/nicht/vorhanden";
delete process.env.KIT_AGENT_MODEL;

const HOST = "http://board.test";

const wurzeln = [];
const altFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = altFetch;
  for (const w of wurzeln.splice(0)) rmSync(w, { recursive: true, force: true });
});

function wurzel() {
  const w = mkdtempSync(join(tmpdir(), "triage-anhaenge-"));
  wurzeln.push(w);
  return w;
}

const ablage = (w, id = "7") => join(w, ".claude", "ideas", id);

/** Ein Lader, der je Anhang den Inhalt `inhalt:<id>` liefert oder den genannten Fehler wirft. */
function lader(fehler = {}) {
  const geladen = [];
  const laden = async (anhang) => {
    geladen.push(anhang.id);
    if (fehler[anhang.id]) throw fehler[anhang.id];
    return Buffer.from(`inhalt:${anhang.id}`);
  };
  return { laden, geladen };
}

function boardFehler(status) {
  const e = new BoardError(`Fehler ${status}`);
  e.status = status;
  return e;
}

// --- ablageFuellen ---------------------------------------------------------------

test("ablageFuellen legt die Ablage an und schreibt jeden Anhang", async () => {
  const w = wurzel();
  const { laden } = lader();
  const r = await ablageFuellen(w, "7", [{ id: 1, filename: "skizze.png" }, { id: 2, filename: "notiz.md" }], laden);
  assert.deepEqual(r, { geladen: ["skizze.png", "notiz.md"], vorhanden: [], fehlgeschlagen: [] });
  assert.equal(readFileSync(join(ablage(w), "skizze.png"), "utf-8"), "inhalt:1");
  assert.equal(readFileSync(join(ablage(w), "notiz.md"), "utf-8"), "inhalt:2");
});

test("ablageFuellen ergaenzt: eine gleichnamige Datei bleibt Byte fuer Byte und wird nicht geladen", async () => {
  const w = wurzel();
  mkdirSync(ablage(w), { recursive: true });
  const vorher = Buffer.from([0, 1, 2, 255, 10]);
  writeFileSync(join(ablage(w), "skizze.png"), vorher);
  writeFileSync(join(ablage(w), "eigen.md"), "vom Menschen");
  const { laden, geladen } = lader();
  const r = await ablageFuellen(w, "7", [{ id: 1, filename: "skizze.png" }, { id: 2, filename: "neu.pdf" }], laden);
  assert.deepEqual(r, { geladen: ["neu.pdf"], vorhanden: ["skizze.png"], fehlgeschlagen: [] });
  assert.deepEqual(readFileSync(join(ablage(w), "skizze.png")), vorher);
  assert.equal(readFileSync(join(ablage(w), "eigen.md"), "utf-8"), "vom Menschen");
  assert.deepEqual(geladen, [2], "der gleichnamige Anhang wurde abgerufen");
});

test("ablageFuellen: zwei Anhaenge mit gleichem Namen, der zweite zaehlt als vorhanden", async () => {
  const w = wurzel();
  const { laden } = lader();
  const r = await ablageFuellen(w, "7", [{ id: 1, filename: "a.png" }, { id: 2, filename: "unter/a.png" }], laden);
  assert.deepEqual(r, { geladen: ["a.png"], vorhanden: ["a.png"], fehlgeschlagen: [] });
  assert.equal(readFileSync(join(ablage(w), "a.png"), "utf-8"), "inhalt:1");
});

test("ablageFuellen: ../x.png landet als x.png in der Ablage, nicht daneben", async () => {
  const w = wurzel();
  const { laden } = lader();
  const r = await ablageFuellen(w, "7", [{ id: 1, filename: "../x.png" }], laden);
  assert.deepEqual(r.geladen, ["x.png"]);
  assert.equal(existsSync(join(ablage(w), "x.png")), true);
  assert.equal(existsSync(join(w, ".claude", "ideas", "x.png")), false);
});

test("ablageFuellen: leerer Name, . und .. sind nameUngueltig, ohne Datei und ohne Abruf", async () => {
  const w = wurzel();
  const { laden, geladen } = lader();
  const r = await ablageFuellen(w, "7", [{ id: 1, filename: "" }, { id: 2, filename: "." }, { id: 3, filename: ".." }, { id: 4, filename: "a/.." }], laden);
  assert.deepEqual(r.geladen, []);
  assert.deepEqual(r.fehlgeschlagen.map((f) => [f.name, f.grund]),
    [["", "nameUngueltig"], [".", "nameUngueltig"], ["..", "nameUngueltig"], ["a/..", "nameUngueltig"]]);
  assert.deepEqual(geladen, []);
  assert.equal(existsSync(ablage(w)), false, "fuer ungueltige Namen entstand die Ablage");
});

test("ablageFuellen: ein gescheiterter Abruf steht mit Grund unter fehlgeschlagen, der Rest wird geladen", async () => {
  const w = wurzel();
  const { laden } = lader({ 1: boardFehler(404), 2: boardFehler(429), 3: new BoardError("Netz weg") });
  const r = await ablageFuellen(w, "7",
    [{ id: 1, filename: "weg.png" }, { id: 2, filename: "zu.png" }, { id: 3, filename: "netz.png" }, { id: 4, filename: "gut.md" }], laden);
  assert.deepEqual(r.geladen, ["gut.md"]);
  assert.deepEqual(r.fehlgeschlagen.map((f) => [f.name, f.grund]), [["weg.png", "anhangFehlt"], ["zu.png", "gedrosselt"], ["netz.png", "netz"]]);
  for (const f of r.fehlgeschlagen) assert.ok(f.meldung.includes(f.name), f.meldung);
  assert.equal(existsSync(join(ablage(w), "weg.png")), false);
});

test("ablageFuellen: ohne Anhaenge entsteht kein Verzeichnis", async () => {
  const w = wurzel();
  const r = await ablageFuellen(w, "7", [], lader().laden);
  assert.deepEqual(r, { geladen: [], vorhanden: [], fehlgeschlagen: [] });
  assert.equal(existsSync(ablage(w)), false);
  assert.equal(existsSync(join(w, ".claude", "ideas")), false);
});

test("anhangGrund: 404, 429, ohne Status, anderer Status", () => {
  assert.equal(anhangGrund(boardFehler(404)), "anhangFehlt");
  assert.equal(anhangGrund(boardFehler(429)), "gedrosselt");
  assert.equal(anhangGrund(new BoardError("Netz")), "netz");
  assert.equal(anhangGrund(boardFehler(500)), "abgewiesen");
});

// --- anhaengeLaden ---------------------------------------------------------------

const MIT = { listAttachments() {}, downloadAttachment() {} };
const START = { start: true, grund: null, meldung: null };

test("anhaengeLaden: true nur bei start, ohne --body-file, ohne --finish und mit listAttachments", () => {
  assert.equal(anhaengeLaden({ einstieg: START, bodyFile: null, finish: undefined, tracker: MIT }), true);
  assert.equal(anhaengeLaden({ einstieg: { start: false }, bodyFile: null, finish: undefined, tracker: MIT }), false);
  assert.equal(anhaengeLaden({ einstieg: START, bodyFile: "neu", finish: undefined, tracker: MIT }), false);
  assert.equal(anhaengeLaden({ einstieg: START, bodyFile: null, finish: true, tracker: MIT }), false);
  assert.equal(anhaengeLaden({ einstieg: START, bodyFile: null, finish: undefined, tracker: {} }), false);
});

// --- ablageLesen mit vonKarte ----------------------------------------------------

test("ablageLesen: herkunft karte fuer die geladenen Namen, sonst ablage", () => {
  const w = wurzel();
  mkdirSync(ablage(w), { recursive: true });
  writeFileSync(join(ablage(w), "a.png"), "a");
  writeFileSync(join(ablage(w), "b.md"), "b");
  const r = ablageLesen(w, "7", new Set(["a.png"]));
  assert.deepEqual(r.dateien.map((d) => [d.name, d.herkunft]), [["a.png", "karte"], ["b.md", "ablage"]]);
  assert.deepEqual(ablageLesen(w, "7").dateien.map((d) => d.herkunft), ["ablage", "ablage"]);
});

// --- Toolbox-Adapter mit gestelltem fetch ----------------------------------------

/** Ein Tracker mit gestellter Uhr; `antwort(url, nr)` liefert `{ status, json?, body?, headers? }`. */
function toolbox(antwort) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    const a = antwort(url, urls.length);
    const kopf = { "Content-Type": "application/json", ...a.headers };
    return new Response(a.body ?? JSON.stringify(a.json ?? {}), { status: a.status, headers: kopf });
  };
  let jetzt = 0;
  const tracker = new ToolboxIssueTracker({ toolbox: { host: HOST } }, {
    jetzt: () => jetzt, schlaf: async (ms) => { jetzt += ms; }, zufall: () => 0, melde: () => {},
  });
  return { tracker, urls };
}

const KARTE = { status: 200, json: { item: { id: 4711, title: "[Idea] X", column: "BACKLOG" }, comments: [] } };
const UEBERLAST = { status: 429, json: { type: TOOLBOX_UEBERLAST_TYPE, title: "zu viel" }, headers: { "Content-Type": "application/problem+json" } };

test("listAttachments und downloadAttachment rufen mit der internen ID, nicht mit der Nummer", async () => {
  const { tracker, urls } = toolbox((url) => {
    if (url.endsWith("/by-number/12")) return KARTE;
    if (url.endsWith("/attachments")) return { status: 200, json: [{ id: 5, cardId: 4711, filename: "s.png", contentType: "image/png", size: 3, createdAt: "x" }] };
    return { status: 200, body: "png", headers: { "Content-Type": "image/png" } };
  });
  const liste = await tracker.listAttachments(12);
  assert.equal(liste[0].filename, "s.png");
  const bytes = await tracker.downloadAttachment(12, 5);
  assert.equal(Buffer.from(bytes).toString("utf-8"), "png");
  assert.deepEqual(urls, [
    `${HOST}/api/kanban/items/by-number/12`,
    `${HOST}/api/kanban/items/4711/attachments`,
    `${HOST}/api/kanban/items/4711/attachments/5`,
  ]);
});

test("downloadAttachment: 404 wird nicht wiederholt und wird anhangFehlt", async () => {
  const { tracker, urls } = toolbox((url) => (url.endsWith("/by-number/12") ? KARTE : { status: 404, json: { title: "fehlt" } }));
  const w = wurzel();
  const r = await ablageFuellen(w, "12", [{ id: 5, filename: "s.png" }], (a) => tracker.downloadAttachment(12, a.id));
  assert.deepEqual(r.fehlgeschlagen.map((f) => f.grund), ["anhangFehlt"]);
  assert.equal(urls.filter((u) => u.endsWith("/attachments/5")).length, 1);
});

test("downloadAttachment: zweimal 429 mit Ueberlast-Type ergibt genau zwei Abrufe und gedrosselt", async () => {
  const { tracker, urls } = toolbox((url) => (url.endsWith("/by-number/12") ? KARTE : UEBERLAST));
  const w = wurzel();
  const r = await ablageFuellen(w, "12", [{ id: 5, filename: "s.png" }], (a) => tracker.downloadAttachment(12, a.id));
  assert.deepEqual(r.fehlgeschlagen.map((f) => f.grund), ["gedrosselt"]);
  assert.equal(urls.filter((u) => u.endsWith("/attachments/5")).length, 2);
});

test("listAttachments: zweimal 429 ergibt genau zwei Abrufe; der Fehlschlag landet in fehler", async () => {
  const { tracker, urls } = toolbox((url) => (url.endsWith("/by-number/12") ? KARTE : UEBERLAST));
  const w = wurzel();
  const r = await anhaengeHolen(w, "12", tracker);
  assert.deepEqual(r, { geladen: [], vorhanden: [], fehlgeschlagen: [], fehler: "gedrosselt" });
  assert.equal(urls.filter((u) => u.endsWith("/attachments")).length, 2);
  assert.equal(existsSync(ablage(w, "12")), false);
});

test("anhaengeHolen: Liste und Abruf ueber den Tracker, fehler null", async () => {
  const { tracker } = toolbox((url) => {
    if (url.endsWith("/by-number/12")) return KARTE;
    if (url.endsWith("/attachments")) return { status: 200, json: [{ id: 5, filename: "s.png" }] };
    return { status: 200, body: "png", headers: { "Content-Type": "image/png" } };
  });
  const w = wurzel();
  const r = await anhaengeHolen(w, "12", tracker);
  assert.deepEqual(r, { geladen: ["s.png"], vorhanden: [], fehlgeschlagen: [], fehler: null });
  assert.equal(readFileSync(join(ablage(w, "12"), "s.png"), "utf-8"), "png");
});
