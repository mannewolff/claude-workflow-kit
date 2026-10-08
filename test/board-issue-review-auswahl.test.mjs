// Reviewer-Auswahl und PATH-Suche der issue-review-Achse (Issue #220), im selben Prozess
// gegen den Teil kit/board/issue-review.mjs (Issue #1221, Plan #1199, E6 und E18).
//
// Der Autor eines Issues hat den Kontext im Kopf, aus dem es entstanden ist; was er
// nicht hingeschrieben hat, faellt ihm beim Lesen nicht auf. Deshalb prueft nie das
// Modell, das geschrieben hat — darauf beruht das ganze Verfahren, und `pickReviewers`
// ist die Stelle, an der es durchgesetzt wird.
//
// Reviewer koennen Claude-Subagenten oder fremde CLIs sein. Der Verfuegbarkeits-Check
// unterscheidet beides: Ein Claude-Reviewer laeuft immer, ein Kommando nur, wenn sein
// erstes Wort im PATH liegt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pickReviewers, kommandoVerfuegbar } from "../kit/board/issue-review.mjs";
import { findeImPath } from "../kit/board/grundlagen.mjs";

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const FABLE = { name: "fable", kind: "claude", model: "claude-fable-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };
const ALLE = [OPUS, SONNET, FABLE, CODEX];

// --- pickReviewers ---

test("pickReviewers: der Autor wird nie ausgewaehlt", () => {
  const { gewaehlt } = pickReviewers(ALLE, "opus");
  assert.equal(gewaehlt.length, 2);
  assert.ok(!gewaehlt.some((r) => r.name === "opus"), "der Autor darf nicht sein eigener Reviewer sein");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
});

test("pickReviewers: die Reihenfolge der Config bestimmt die Paarung", () => {
  // So laesst sich eine feste Paarung erzwingen, ohne eine Matrix zu pflegen.
  const umsortiert = [CODEX, FABLE, SONNET, OPUS];
  assert.deepEqual(pickReviewers(umsortiert, "sonnet").gewaehlt.map((r) => r.name), ["codex", "fable"]);
});

test("pickReviewers: unbekannter Autor nimmt die ersten zwei", () => {
  // Aeltere Issues ohne Autor-Modell-Zeile, oder ein Mensch als Autor.
  const { gewaehlt, unterbesetzt, autorAufgeloest } = pickReviewers(ALLE, "unbekannt");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
  assert.equal(unterbesetzt, false);
  // Die Auswahl ist unveraendert, aber nicht mehr stumm: Ein Aufrufer ohne Menschen
  // davor soll erkennen, dass sie nicht auf einem erkannten Autor beruht (Issue #241).
  assert.equal(autorAufgeloest, false);
});

// --- Autor-Aufloesung: Modell-ID -> Reviewer-Kurzname (Issue #241) ---
//
// `/issues` schreibt die volle Modell-ID in den Kontext-Abschnitt
// (`Autor-Modell: claude-opus-5`), `pairs` ist mit Kurznamen geschluesselt (`opus`).
// Ohne Uebersetzung greift pairs nicht — und schlimmer: der Regel-Zweig filtert ueber
// `r.name !== autor`, und "opus" !== "claude-opus-5" ist wahr. Der Autor bleibt also
// im Kandidatenfeld und **prueft sein eigenes Issue**. Genau das, was pairs aus #225
// verhindern sollte, nur eine Ebene tiefer.

test("pickReviewers: die Modell-ID waehlt dieselben Reviewer wie der Kurzname", () => {
  const pairs = { opus: ["sonnet", "fable"] };
  const perId = pickReviewers(ALLE, "claude-opus-5", 2, pairs);
  const perName = pickReviewers(ALLE, "opus", 2, pairs);
  assert.deepEqual(perId.gewaehlt.map((r) => r.name), perName.gewaehlt.map((r) => r.name));
  assert.equal(perId.quelle, "pairs");
  assert.equal(perId.autorAufgeloest, true);
});

test("pickReviewers: ohne pairs prueft der Autor sein eigenes Issue nicht mehr", () => {
  // Der Kern des Bugs: Vorher stand 'opus' hier im Ergebnis.
  const { gewaehlt, autorAufgeloest } = pickReviewers(ALLE, "claude-opus-5");
  assert.ok(!gewaehlt.some((r) => r.name === "opus"),
    "der Autor darf nicht sein eigener Reviewer sein");
  assert.equal(autorAufgeloest, true);
});

test("pickReviewers: ein Kurzname loest weiterhin auf sich selbst auf", () => {
  const { autorAufgeloest, quelle } = pickReviewers(ALLE, "sonnet", 2, { sonnet: ["opus"] });
  assert.equal(autorAufgeloest, true);
  assert.equal(quelle, "pairs");
});

test("pickReviewers: ein Reviewer ohne model-Feld stoert die Aufloesung nicht", () => {
  // kind:'command'-Reviewer haben kein `model` — undefined darf nicht gegen einen
  // fehlenden Autor matchen.
  const { gewaehlt, autorAufgeloest } = pickReviewers(ALLE, undefined);
  assert.equal(autorAufgeloest, false);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
});

test("pickReviewers: zu wenige Kandidaten melden unterbesetzt", () => {
  // Kein Fehler: Der Skill entscheidet, ob er damit faehrt — muss es aber sichtbar machen.
  const { gewaehlt, unterbesetzt } = pickReviewers([OPUS, SONNET], "opus");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["sonnet"]);
  assert.equal(unterbesetzt, true);
});

test("pickReviewers: leere Liste ergibt keine Reviewer", () => {
  const { gewaehlt, unterbesetzt } = pickReviewers([], "opus");
  assert.deepEqual(gewaehlt, []);
  assert.equal(unterbesetzt, true);
});

test("pickReviewers: die Anzahl ist einstellbar", () => {
  assert.equal(pickReviewers(ALLE, "opus", 3).gewaehlt.length, 3);
  assert.equal(pickReviewers(ALLE, "opus", 1).gewaehlt.length, 1);
});

// --- findeImPath (Issue #231) ---
//
// PATH und Dateisystem werden injiziert: Die Pruefung laeuft ohne echte Dateien.

// Baut eine `existiert`-Funktion aus einer Liste vorhandener Pfade.
function fs_mit(...pfade) {
  const vorhanden = new Set(pfade);
  return (p) => vorhanden.has(p);
}

// `ausfuehrbar` gehoert zur Grundausstattung: findeImPath prueft das X-Bit, und die
// Fixture-Pfade existieren real nicht — ohne Injektion wuerde der echte accessSync jeden
// Treffer wieder verwerfen.
const POSIX = { path: "/usr/bin:/usr/local/bin", ausfuehrbar: () => true };

test("findeImPath: posix probiert keine Endungen", () => {
  const nackt = findeImPath("codex", { ...POSIX, existiert: fs_mit("/usr/bin/codex") });
  assert.equal(nackt, "/usr/bin/codex");
  const mitEndung = findeImPath("codex", { ...POSIX, existiert: fs_mit("/usr/bin/codex.cmd") });
  assert.equal(mitEndung, null);
});

test("findeImPath: der PATH trennt mit ':'", () => {
  assert.equal(
    findeImPath("codex", { ...POSIX, path: "/a:/b", existiert: fs_mit("/b/codex") }),
    "/b/codex",
  );
});

test("findeImPath: der Treffer setzt Verzeichnis und Name mit '/' zusammen", () => {
  const posix = findeImPath("codex", { ...POSIX, path: "/usr/bin", existiert: () => true });
  assert.equal(posix, "/usr/bin/codex");
});

test("findeImPath: nicht gefunden liefert null", () => {
  assert.equal(findeImPath("gibtsnicht", { ...POSIX, existiert: () => false }), null);
});

test("findeImPath: ein Pfad in der Eingabe wird direkt geprueft, ohne PATH-Suche", () => {
  // Ein Reviewer-Kommando darf auf ein Werkzeug ausserhalb des PATH zeigen.
  assert.equal(
    findeImPath("/opt/tools/x", { ...POSIX, existiert: fs_mit("/opt/tools/x") }),
    "/opt/tools/x",
  );
  assert.equal(
    findeImPath("./meintool", { ...POSIX, existiert: fs_mit("./meintool") }),
    "./meintool",
  );
  // Kein Fallback auf die PATH-Suche: Wer einen Pfad angibt, meint diesen Pfad.
  assert.equal(
    findeImPath("./meintool", { ...POSIX, existiert: fs_mit("/usr/bin/meintool") }),
    null,
  );
});

test("findeImPath: posix verlangt zusaetzlich das Ausfuehrbar-Bit", () => {
  // Eine lesbare, aber nicht ausfuehrbare Datei ist kein Kommando. Der alte
  // Prozessstart fing das implizit ab; die Dateisystem-Pruefung darf nicht
  // dahinter zurueckfallen.
  const treffer = findeImPath("codex", {
    ...POSIX,
    existiert: fs_mit("/usr/bin/codex"),
    ausfuehrbar: () => false,
  });
  assert.equal(treffer, null);
});

test("kommandoVerfuegbar: POSIX liefert den gefundenen Pfad unveraendert", () => {
  const { ok, pfad } = kommandoVerfuegbar("codex exec", {
    env: { PATH: "/usr/local/bin:/usr/bin" },
    existiert: fs_mit("/usr/bin/codex"),
    ausfuehrbar: () => true,
  });
  assert.equal(ok, true);
  assert.equal(pfad, "/usr/bin/codex");
});

test("kommandoVerfuegbar: ein Kommando ausserhalb des PATH ist nicht verfuegbar", () => {
  const ergebnis = kommandoVerfuegbar("codex exec", {
    env: { PATH: "/usr/bin" },
    existiert: () => false,
  });
  assert.deepEqual(ergebnis, { datei: "codex", ok: false, pfad: null });
});

test("findeImPath: leerer PATH liefert null statt zu werfen", () => {
  assert.equal(findeImPath("codex", { ...POSIX, path: "", existiert: () => true }), null);
  assert.equal(findeImPath("codex", { ...POSIX, path: undefined, existiert: () => true }), null);
});

// --- pairs: explizite Zuordnung (Issue #225) ---
//
// Die Regel allein waehlt immer die vordersten Eintraege: Bei vier Reviewern kam der
// vierte nie zum Zug — ausgerechnet das Modell aus dem fremden Haus, dessen Wert darin
// liegt, die blinden Flecken der Familie NICHT zu teilen. pairs macht die Zuordnung
// ablesbar statt errechenbar.

const PAARE = { opus: ["codex", "sonnet"], sonnet: ["opus", "codex"] };

test("pickReviewers: ein pairs-Eintrag gewinnt ueber die Regel", () => {
  const { gewaehlt, quelle } = pickReviewers(ALLE, "opus", 2, PAARE);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
  assert.equal(quelle, "pairs");
});

test("pickReviewers: die Reihenfolge im pairs-Eintrag wird eingehalten", () => {
  assert.deepEqual(
    pickReviewers(ALLE, "sonnet", 2, PAARE).gewaehlt.map((r) => r.name),
    ["opus", "codex"]
  );
});

test("pickReviewers: fehlt der Autor in pairs, greift die Regel", () => {
  const { gewaehlt, quelle } = pickReviewers(ALLE, "fable", 2, PAARE);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
  assert.equal(quelle, "regel");
});

test("pickReviewers: ohne pairs bleibt das Verhalten wie vorher", () => {
  // Regressionsschutz — die Regel darf sich durch das neue Feld nicht aendern.
  const ohne = pickReviewers(ALLE, "opus");
  assert.deepEqual(ohne.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
  assert.equal(ohne.quelle, "regel");
  assert.deepEqual(pickReviewers(ALLE, "opus", 2, {}).gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
});

test("pickReviewers: ein leerer pairs-Eintrag faellt auf die Regel zurueck", () => {
  assert.equal(pickReviewers(ALLE, "opus", 2, { opus: [] }).quelle, "regel");
});

// --- pickReviewers: Kuerzung auch im pairs-Zweig (Issue #278) ---

test("pickReviewers: ein pairs-Eintrag wird auf die Anzahl gekuerzt", () => {
  // Ohne diese Kuerzung liefe die Stufe `issue` mit zwei Reviewern statt mit einem.
  const { gewaehlt, quelle, unterbesetzt } = pickReviewers(ALLE, "opus", 1, { opus: ["codex", "sonnet"] });
  assert.deepEqual(gewaehlt.map((r) => r.name), ["codex"]);
  assert.equal(quelle, "pairs");
  assert.equal(unterbesetzt, false);
});

test("pickReviewers: die Kuerzung haelt die konfigurierte Reihenfolge ein", () => {
  const { gewaehlt } = pickReviewers(ALLE, "sonnet", 1, { sonnet: ["fable", "codex"] });
  assert.deepEqual(gewaehlt.map((r) => r.name), ["fable"]);
});
