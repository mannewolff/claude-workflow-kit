// Ablauf-Pruefung: Zeitablauf, technischer Fehler und Wurf einer Paket-Session treffen die Runde der Stufe umsetzung, die ihre Sessions selbst als Prozesse startet — nur im Lauf von kit/night.mjs beobachtbar.
//
// Rueckstellpflicht und Budgets der Stufe umsetzung (Plan #691, E4-E8, E11; Issue #695).
//
// Zweite von zwei Dateien zur Stufe (Issue #836): Was die Stufe gezogen hat und nicht in
// In review endet, geht zurueck nach Backlog — ein Paket in Ready waere fuer die naechste
// Nacht ein GO, das niemand gegeben hat. Geprueft werden hier die Wege dorthin:
// Zeitablauf, technischer Fehler, Wurf aus der Stufe heraus sowie die erschoepften
// Budgets. Ablauf, Worktree und Paketauswahl liegen in
// `ablauf-night-kette-umsetzung.test.mjs`, die gemeinsamen Hilfen in
// `helpers/kette-umsetzung-fixture.mjs`.
//
// Wie in den uebrigen Ketten-Tests laeuft das ECHTE kit/night.mjs gegen ein Temp-Repo
// mit lokalem Tracker; die Sessions sind Shell-Fakes ueber NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, board, mitProjekt, umgebung, sessions, UMSETZUNG_ERFOLG } from "./helpers/kette-ablauf.mjs";
import {
  ERZEUGEN, fachplanB, umsetzung, inSpalte, keinRestInArbeit, stehenInBacklog,
} from "./helpers/kette-umsetzung-fixture.mjs";

test("[night-34] Rueckstellpflicht nach Zeitablauf: das gezogene Paket steht am Ende in Backlog", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: "sleep 5" } }); // # haengt — das Zeitlimit beendet die Paket-Session, der Test wartet nicht auf sie
    // Das kurze Limit gilt nur der Umsetzung (Issue #1080): Die vier erzeugenden Sessions
    // rissen es unter Last.
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "1500", NIGHT_TIMEOUT_STUFE: "umsetzung" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit } = umsetzung(dir, F);
    stehenInBacklog(dir, einheit.stufen.pakete.ids);
    assert.deepEqual(inSpalte(dir, "in_review"), []);
    keinRestInArbeit(dir);
  });
});

test("[night-34] Rueckstellpflicht nach einem technischen Fehler: harter Stopp, das gezogene Paket steht in Backlog", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    // Ein Fehlstart ohne Ereignis der Session: seit Issue #1088 (E13) mit einem zweiten
    // Versuch nach der Pause, danach der harte Stopp.
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: "exit 3" } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen", einheit.grund);
    const [erstes, zweites] = einheit.stufen.pakete.ids;
    assert.deepEqual(stufe.zurueckgestellt.map((p) => p.id), [erstes], "das gezogene Paket steht nicht als zurueckgestellt");
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), [zweites], "das zweite Paket wurde begonnen");
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "umsetzung").length, 2, "es lief nicht genau ein zweiter Versuch");
    stehenInBacklog(dir, [erstes, zweites]);
    keinRestInArbeit(dir);
  }, {}, "night-kette-", { night: { stand: { pauseMin: 0.0001 } } });
});

test("[night-34] Rueckstellpflicht nach einem Wurf aus der Stufe heraus: das gezogene Paket steht in Backlog", () => {
  mitProjekt((dir) => {
    fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    // Der Test-Hook wirft zwischen `issue move ready` und der Session des ersten Pakets —
    // die Stelle, an der ein Wurf das Paket in Ready zuruecklassen wuerde.
    const res = run(dir, ["--kette"], { ...env, NIGHT_KETTE_WURF: "0003" });
    assert.notEqual(res.status, 0, "ein Wurf aus der Stufe heraus endet nicht regulaer");

    // Der Wurf reisst die Kette mitten aus der Stufe; die Einheit traegt deshalb keinen
    // Stand der Stufen mehr. Die Paketnummern des lokalen Trackers stehen fest.
    stehenInBacklog(dir, ["0003", "0004"]);
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "umsetzung").length, 0, "es lief eine Umsetzungs-Session");
    keinRestInArbeit(dir);
  });
});

test("[night-34] erschoepftes Zeitbudget der Stufe: die Kette bleibt fertig, die Pakete sind nicht begonnen", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), einheit.stufen.pakete.ids);
    for (const p of stufe.nichtBegonnen) assert.match(p.grund, /Zeitbudget umsetzung/);
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "umsetzung").length, 0, "es lief eine Umsetzungs-Session");
    stehenInBacklog(dir, einheit.stufen.pakete.ids);
    keinRestInArbeit(dir);
  }, { umsetzungMin: 0.5 });
});

test("[night-34] erschoepftes Kostenbudget: kostenUsdB tritt an die Stelle von kostenUsd, die Kette bleibt fertig", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    // Vier erzeugende Sessions zu je 0.25 $ = 1.00 $. Unter `kostenUsd` (0.5 $) waere die
    // Kette laengst abgebrochen; unter `kostenUsdB` (1.1 $) laeuft das erste Paket und
    // treibt die Summe auf 1.25 $ — das zweite beginnt nicht mehr.
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG }, kosten: 0.25 });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    const [erstes, zweites] = einheit.stufen.pakete.ids;
    assert.deepEqual(stufe.umgesetzt.map((e) => e.id), [erstes]);
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), [zweites]);
    assert.match(stufe.nichtBegonnen[0].grund, /Kostenbudget/);
    assert.equal(board(dir, "issue", "get", zweites).status, "backlog");
    keinRestInArbeit(dir);
  }, { kostenUsd: 0.5, kostenUsdB: 1.1 });
});

test("[night-34] mit issueReview.requiredBeforeReady faellt die Kette auf Variante A zurueck und bleibt fertig", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(stufe.umgesetzt, []);
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), einheit.stufen.pakete.ids);
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "umsetzung").length, 0, "es lief eine Umsetzungs-Session");
    stehenInBacklog(dir, einheit.stufen.pakete.ids);
    keinRestInArbeit(dir);
  }, {}, undefined, { issueReview: { requiredBeforeReady: true, reviewers: [{ name: "opus", kind: "claude", model: "claude-opus-5" }] } });
});
