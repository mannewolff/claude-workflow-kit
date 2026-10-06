// Die Befehle der issue-review-Achse im selben Prozess (Issue #1221, Plan #1199, E6 und E18):
// `reviewers`, `roles`, `matrix` und `check` mit injizierter Config, der Probelauf mit
// injiziertem spawn. Was vorher eine Attrappe im PATH nachstellte — scheitern, haengen,
// abstuerzen, stdin lesen —, ist hier ein Ergebnis von spawnSync, das der Test hereinreicht.
// Die Fehlerwege, an denen der Befehl mit Exit 1 abbricht, und den echten Prozessstart
// pruefen die Ablauf-Pruefungen `test/ablauf-board-issue-review-*.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  issueReviewReviewers, issueReviewRoles, issueReviewMatrix, issueReviewCheck, probelauf,
} from "../kit/board/issue-review.mjs";

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const FABLE = { name: "fable", kind: "claude", model: "claude-fable-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };
const ALLE = [OPUS, SONNET, FABLE, CODEX];
const PAARE = { opus: ["codex", "sonnet"], sonnet: ["opus", "codex"] };

const STUFEN = {
  fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
  plan: { reviewer: 2, rollen: ["architektur-bestand", "schnitt-abhaengigkeiten"] },
  issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
};

const mitReview = (issueReview, reviewStufen) => (reviewStufen ? { issueReview, reviewStufen } : { issueReview });

// --- reviewers ---

test("issue-review reviewers gibt zwei Reviewer ohne den Autor", () => {
  const antwort = issueReviewReviewers({ author: "opus" }, mitReview({ reviewers: ALLE }));
  assert.equal(antwort.autor, "opus");
  assert.deepEqual(antwort.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
  assert.equal(antwort.unterbesetzt, false);
  assert.equal("rounds" in antwort, false, "rounds ist mit Stufe 2 entfallen");
});

test("issue-review reviewers: fehlender issueReview-Block ist kein Fehler", () => {
  const antwort = issueReviewReviewers({ author: "opus" }, {});
  assert.deepEqual(antwort.gewaehlt, []);
  assert.equal(antwort.unterbesetzt, true);
});

test("issue-review reviewers nennt die Quelle der Auswahl und kennt keine Stufen", () => {
  const antwort = issueReviewReviewers({ author: "opus" }, mitReview({ reviewers: ALLE, pairs: PAARE }, STUFEN));
  assert.deepEqual(antwort.gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
  assert.equal(antwort.quelle, "pairs");
  assert.equal(antwort.stufenQuelle, undefined, "reviewers kennt keine Stufen");
});

test("issue-review reviewers ohne --author nennt den Autor null", () => {
  assert.equal(issueReviewReviewers({}, mitReview({ reviewers: ALLE })).autor, null);
});

// --- roles ---

const config = mitReview({ reviewers: ALLE, pairs: PAARE }, STUFEN);

test("issue-review roles: die Stufe issue laeuft mit genau einem Reviewer", () => {
  const antwort = issueReviewRoles({ stufe: "issue", author: "claude-opus-5" }, config);
  assert.equal(antwort.stufe, "issue");
  assert.equal(antwort.reviewer, 1);
  assert.deepEqual(antwort.rollen, ["pruefbarkeit"]);
  // Der Punkt des Vorhabens: pairs.opus nennt zwei Namen, gewaehlt wird genau einer.
  assert.deepEqual(antwort.gewaehlt.map((r) => r.name), ["codex"]);
});

test("issue-review roles: fachlich und plan laufen mit zwei Reviewern", () => {
  for (const stufe of ["fachlich", "plan"]) {
    const antwort = issueReviewRoles({ stufe, author: "opus" }, config);
    assert.equal(antwort.reviewer, 2, stufe);
    assert.deepEqual(antwort.rollen, STUFEN[stufe].rollen, stufe);
    assert.equal(antwort.gewaehlt.length, 2, stufe);
  }
});

test("issue-review roles: die Modell-ID des Autors wird aufgeloest und schliesst ihn aus", () => {
  const antwort = issueReviewRoles({ stufe: "fachlich", author: "claude-opus-5" }, config);
  assert.equal(antwort.autor, "claude-opus-5");
  assert.equal(antwort.autorAufgeloest, true);
  assert.equal(antwort.quelle, "pairs", "pairs.opus greift ueber die aufgeloeste Modell-ID");
  assert.ok(!antwort.gewaehlt.some((r) => r.name === "opus"), "der Autor darf nicht sein eigener Reviewer sein");
});

test("issue-review roles: quelle bleibt die Auswahlquelle, stufenQuelle ist ein eigenes Feld", () => {
  const ausPairs = issueReviewRoles({ stufe: "plan", author: "opus" }, config);
  assert.equal(ausPairs.quelle, "pairs");
  assert.equal(ausPairs.stufenQuelle, "stufen");
  // fable steht nicht in pairs -> die Reihenfolge-Regel waehlt.
  const ausRegel = issueReviewRoles({ stufe: "plan", author: "fable" }, config);
  assert.equal(ausRegel.quelle, "regel");
  assert.equal(ausRegel.stufenQuelle, "stufen");
});

test("issue-review roles: ohne reviewStufen-Block gilt fuer jede Stufe die Rueckfallebene", () => {
  // Ein Kit-Update darf keinem Bestandsprojekt den Review umbauen — dieselbe Vorsicht
  // wie bei requiredBeforeReady, das per Default aus ist.
  for (const stufe of ["fachlich", "plan", "issue"]) {
    const antwort = issueReviewRoles({ stufe, author: "opus" }, mitReview({ reviewers: ALLE, pairs: PAARE }));
    assert.equal(antwort.reviewer, 2, stufe);
    assert.deepEqual(antwort.rollen, ["vollstaendigkeit-pruefbarkeit", "scope-risiko-bestand"], stufe);
    assert.equal(antwort.stufenQuelle, "default", stufe);
    assert.equal(antwort.gewaehlt.length, 2, stufe);
  }
});

test("[board-6] roles liefert keine runden, verzicht und vorgabeQuelle mehr", () => {
  const antwort = issueReviewRoles({ stufe: "plan", author: "claude-opus-5" }, config);
  for (const feld of ["runden", "verzicht", "vorgabeQuelle", "entfall", "ausschlussUnbekannt"]) {
    assert.equal(feld in antwort, false, `${feld} darf nicht mehr ausgegeben werden`);
  }
});

// --- matrix ---

test("issue-review matrix listet jeden bekannten Autor mit Quelle", () => {
  const { matrix } = issueReviewMatrix(mitReview({ reviewers: ALLE, pairs: PAARE }));
  const zeile = (name) => matrix.find((m) => m.autor === name);
  assert.deepEqual(zeile("opus").reviewer, ["codex", "sonnet"]);
  assert.equal(zeile("opus").quelle, "pairs");
  // Die Modell-ID steht dabei (Issue #241) — es ist der Wert, den /issues in die
  // Issues schreibt, und ohne ihn ist die Tabelle nicht mit ihnen abgleichbar.
  assert.equal(zeile("opus").modell, "claude-opus-5");
  // Ein kind:'command'-Reviewer hat keine Modell-ID; null statt undefined, damit
  // das Feld im JSON ueberhaupt erscheint.
  assert.equal(zeile("codex").modell, null);
  assert.deepEqual(zeile("fable").reviewer, ["opus", "sonnet"]);
  assert.equal(zeile("fable").quelle, "regel");
  assert.deepEqual(matrix.map((m) => m.autor).sort(), ["codex", "fable", "opus", "sonnet"]);
});

test("issue-review matrix nimmt auch Autoren auf, die nur in pairs stehen", () => {
  // haiku ist kein Reviewer, kann aber Issues schreiben.
  const { matrix } = issueReviewMatrix(mitReview({ reviewers: ALLE, pairs: { haiku: ["sonnet", "opus"] } }));
  const haiku = matrix.find((m) => m.autor === "haiku");
  assert.deepEqual(haiku.reviewer, ["sonnet", "opus"]);
  assert.equal(haiku.quelle, "pairs");
});

// --- check ---
//
// PATH-Suche und Probelauf sind injiziert: `verfuegbar` liefert, was kommandoVerfuegbar
// liefern wuerde, `probe` das Ergebnis des Probelaufs. Ein Aufruf, der nicht sein darf,
// scheitert am Wurf.

const START = { befehl: "/fake/bin/x", vorArgs: [], umgebung: {}, fehler: null };
const IM_PATH = (kommando) => ({ datei: kommando.split(" ")[0], ok: true, pfad: "/fake/bin/x", start: START });
const NICHT_IM_PATH = (kommando) => ({ datei: kommando.split(" ")[0], ok: false, pfad: null, start: null });
const KEIN_AUFRUF = () => { throw new Error("darf nicht aufgerufen werden"); };
const FAKE = { name: "fake", kind: "command", command: "meinfake --flag" };

test("issue-review check: claude-Reviewer gelten ohne PATH-Suche und Probelauf als verfuegbar", () => {
  const befund = issueReviewCheck({}, { config: mitReview({ reviewers: [OPUS, SONNET] }), verfuegbar: KEIN_AUFRUF, probe: KEIN_AUFRUF });
  assert.equal(befund.alleVerfuegbar, true);
  assert.ok(befund.reviewers.every((r) => r.verfuegbar && r.geprueft === undefined));
});

test("issue-review check: ohne konfigurierte Reviewer ist alleVerfuegbar false", () => {
  // Frueher lieferte `every()` auf dem leeren Array true — der Nacht-Vorflug haette
  // einen Lauf durchgelassen, in dem jede Session ergebnislos endet. Vorhersehbare
  // Lage gehoert ins Gate, nicht in einen Prompt (dieselbe Klasse wie Issue #192).
  const leer = issueReviewCheck({}, { config: mitReview({}) });
  assert.deepEqual(leer.reviewers, []);
  assert.equal(leer.alleVerfuegbar, false);
  assert.match(leer.grund, /workflow\.config\.example\.json/);
  // Auch wenn der Block ganz fehlt, nicht nur wenn er leer ist.
  assert.equal(issueReviewCheck({}, { config: {} }).alleVerfuegbar, false);
});

test("issue-review check: ein Kommando ausserhalb des PATH wird mit Grund gemeldet", () => {
  const befund = issueReviewCheck({}, { config: mitReview({ reviewers: [OPUS, FAKE] }), verfuegbar: NICHT_IM_PATH, probe: KEIN_AUFRUF });
  assert.equal(befund.alleVerfuegbar, false);
  const eintrag = befund.reviewers.find((r) => r.name === "fake");
  assert.equal(eintrag.verfuegbar, false);
  assert.equal(eintrag.geprueft, "pfad");
  assert.match(eintrag.grund, /meinfake nicht im PATH/);
});

test("issue-review check: ein Kommando im PATH, das nicht startbar ist, bekommt keinen Probelauf", () => {
  // Eine `.cmd` ohne sh-Huelle unter Windows (Issue #1135, E8).
  const fehler = "codex.cmd liegt ohne sh-Huelle daneben vor und ist nicht ohne cmd.exe startbar";
  const verfuegbar = () => ({ datei: "meinfake", ok: true, pfad: "x.cmd", start: { ...START, befehl: null, fehler } });
  const befund = issueReviewCheck({}, { config: mitReview({ reviewers: [FAKE] }), verfuegbar, probe: KEIN_AUFRUF });
  assert.equal(befund.reviewers[0].verfuegbar, false);
  assert.equal(befund.reviewers[0].geprueft, "pfad");
  assert.equal(befund.reviewers[0].grund, fehler);
});

test("issue-review check: ein startbares Kommando wird durch einen Probelauf bestaetigt", () => {
  const gesehen = [];
  const probe = (kommando, start) => { gesehen.push([kommando, start]); return { ok: true }; };
  const befund = issueReviewCheck({}, { config: mitReview({ reviewers: [FAKE] }), verfuegbar: IM_PATH, probe });
  assert.equal(befund.alleVerfuegbar, true);
  assert.deepEqual(befund.reviewers[0], { name: "fake", kind: "command", umgebung: "runner", verfuegbar: true, geprueft: "probelauf" });
  assert.deepEqual(gesehen, [["meinfake --flag", START]], "der Probelauf startet nach dem Startbefehl der PATH-Suche");
});

test("issue-review check: ein scheiternder Probelauf macht das Kommando unverfuegbar", () => {
  const probe = () => ({ ok: false, grund: "model is not supported for this account" });
  const befund = issueReviewCheck({}, { config: mitReview({ reviewers: [FAKE] }), verfuegbar: IM_PATH, probe });
  assert.equal(befund.alleVerfuegbar, false);
  assert.equal(befund.reviewers[0].geprueft, "probelauf");
  assert.equal(befund.reviewers[0].grund, "model is not supported for this account");
});

test("issue-review check: --nur-pfad ueberspringt den Probelauf", () => {
  const befund = issueReviewCheck({ "nur-pfad": true }, { config: mitReview({ reviewers: [FAKE] }), verfuegbar: IM_PATH, probe: KEIN_AUFRUF });
  assert.equal(befund.alleVerfuegbar, true);
  assert.equal(befund.reviewers[0].geprueft, "pfad");
});

test("issue-review check: jeder Befund nennt die Umgebung 'runner'", () => {
  // Der Befund von hier stammt immer aus dem aufrufenden Prozess (Issue #269). Wer ihn
  // ohne diesen Stempel liest, koennte ein `verfuegbar: true` auf eine Umgebung beziehen,
  // in der gar nicht geprueft wurde — genau der Fehlschluss aus der Nacht vom 2026-08-08.
  const befund = issueReviewCheck({}, { config: mitReview({ reviewers: [OPUS, FAKE] }), verfuegbar: IM_PATH, probe: () => ({ ok: true }) });
  assert.equal(befund.reviewers.length, 2);
  for (const r of befund.reviewers) assert.equal(r.umgebung, "runner", `${r.name} traegt die falsche Umgebung`);
});

// --- Probelauf (Issue #262, #393) ---
//
// `spawn` bekommt, was spawnSync bekaeme, und liefert, was spawnSync liefern wuerde. So
// sind die Ausgaenge belegt, die eine Attrappe nur mit Haengen, Absturz oder einem
// uebergrossen Prompt erzeugen konnte.

/** Ein spawn, das seine Aufrufe mitschreibt und `ergebnis` liefert. */
function spawnMit(ergebnis) {
  const aufrufe = [];
  const spawn = (befehl, args, optionen) => { aufrufe.push({ befehl, args, optionen }); return ergebnis; };
  return { spawn, aufrufe };
}

test("probelauf: Exit 0 ist verfuegbar, der Prompt geht ueber stdin mit Zeitlimit", () => {
  const { spawn, aufrufe } = spawnMit({ status: 0, stderr: "" });
  const lauf = probelauf("meinfake exec --flag", { ...START, umgebung: { EIGEN: "1" } }, { spawn, prompt: "P\n", timeoutMs: 1234, env: { PATH: "/p" } });
  assert.deepEqual(lauf, { ok: true });
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].befehl, "/fake/bin/x");
  assert.deepEqual(aufrufe[0].args, ["exec", "--flag"], "das erste Wort ersetzt der Startbefehl");
  assert.equal(aufrufe[0].optionen.input, "P\n");
  assert.equal(aufrufe[0].optionen.timeout, 1234);
  assert.deepEqual(aufrufe[0].optionen.env, { PATH: "/p", EIGEN: "1" });
});

test("probelauf: ohne Vorgabe ist der Prompt die harmlose Bitte um OK", () => {
  // Exakt, nicht nur nicht-leer: Der Prompt laesst sich ueber KIT_PROBE_PROMPT ersetzen,
  // ohne die Variable muss er unveraendert bleiben (Issue #393).
  const { spawn, aufrufe } = spawnMit({ status: 0 });
  probelauf("meinfake", START, { spawn });
  assert.equal(aufrufe[0].optionen.input, "Antworte nur mit dem Wort OK.\n");
});

test("probelauf: ein scheiterndes Kommando liefert seine letzte stderr-Zeile als Grund", () => {
  // Der Fall aus dem Befund vom 2026-08-08: startbar, aber nicht benutzbar.
  const { spawn } = spawnMit({ status: 1, stderr: "Warnung\nmodel is not supported for this account\n\n" });
  assert.deepEqual(probelauf("x", START, { spawn }), { ok: false, grund: "model is not supported for this account" });
});

test("probelauf: ohne stderr nennt der Grund den Exit-Status", () => {
  const { spawn } = spawnMit({ status: 3, stderr: "" });
  assert.deepEqual(probelauf("x", START, { spawn }), { ok: false, grund: "Exit 3" });
});

test("probelauf: der Grund ist auf 300 Zeichen gekuerzt", () => {
  const { spawn } = spawnMit({ status: 1, stderr: "x".repeat(500) });
  assert.equal(probelauf("x", START, { spawn }).grund.length, 300);
});

test("probelauf: bei EPIPE gewinnt die Fehlermeldung des Werkzeugs", () => {
  // Der Fall aus dem roten CI-Lauf (Issue #393): Das Kommando ist weg, bevor der
  // Prompt geschrieben ist. spawnSync meldet dann EPIPE *zusaetzlich* zum Exit-Status.
  const epipe = Object.assign(new Error("spawnSync /fake/bin/x EPIPE"), { code: "EPIPE" });
  const { spawn } = spawnMit({ status: 1, stderr: "model is not supported for this account\n", error: epipe });
  const lauf = probelauf("x", START, { spawn });
  assert.equal(lauf.ok, false);
  assert.match(lauf.grund, /model is not supported/);
  assert.doesNotMatch(lauf.grund, /EPIPE/, "EPIPE ist der Nebeneffekt, nicht der Grund");
});

test("probelauf: Exit 0 mit EPIPE ist ein Erfolg", () => {
  // Die Gegenrichtung: Ein Kommando, das stdin nicht liest, bleibt verfuegbar.
  const epipe = Object.assign(new Error("EPIPE"), { code: "EPIPE" });
  const { spawn } = spawnMit({ status: 0, stderr: "", error: epipe });
  assert.deepEqual(probelauf("x", START, { spawn }), { ok: true });
});

test("probelauf: ein haengendes Kommando laeuft ins Zeitlimit", () => {
  const zeit = Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" });
  const { spawn } = spawnMit({ status: null, signal: "SIGTERM", error: zeit });
  assert.deepEqual(probelauf("x", START, { spawn, timeoutMs: 300 }), { ok: false, grund: "Zeitlimit von 300 ms ueberschritten" });
  // SIGTERM allein reicht: spawnSync beendet ein Kommando beim Zeitlimit mit diesem Signal.
  assert.match(probelauf("x", START, { spawn: () => ({ status: null, signal: "SIGTERM" }), timeoutMs: 300 }).grund, /Zeitlimit/);
});

test("probelauf: ein per Signal gestorbenes Kommando gilt als Ausfall", () => {
  // Der dritte Zustand neben "gelaufen" und "nie gestartet": kein Exit-Status, kein
  // error — nur ein Signal. Ohne eigenen Zweig fiele er auf ok: true durch (Issue #393).
  const { spawn } = spawnMit({ status: null, signal: "SIGSEGV" });
  assert.deepEqual(probelauf("x", START, { spawn }), { ok: false, grund: "Durch Signal SIGSEGV beendet" });
});

test("probelauf: ein Startfehler ohne Status ist der Grund", () => {
  const enoent = Object.assign(new Error("spawnSync /fake/bin/x ENOENT"), { code: "ENOENT" });
  const { spawn } = spawnMit({ status: null, signal: null, error: enoent });
  assert.deepEqual(probelauf("x", START, { spawn }), { ok: false, grund: "spawnSync /fake/bin/x ENOENT" });
});
