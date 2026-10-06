// Ablauf-Pruefung: Lauf-Kopf des Ergebnisstands, Einlieferung ueber das Board-Werkzeug, die echte Formpruefung von kit/board.mjs und die Hauptkopie unter git entstehen erst im Lauf des Einstiegs kit/night.mjs.
//
// Der glatte Durchlauf einer Nacht-Kette (Plan #638; Issue #643), soweit er den Einstieg
// braucht. Was die Kette selbst entscheidet, steht im selben Prozess in
// `night-kette-ablauf.test.mjs` (Issue #1233).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  run, mitProjekt, fachplan, umgebung, stand, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-ablauf.mjs";
import { TESTHINWEIS_ANKER } from "../kit/night/kette.mjs";

test("[night-19] eine unsaubere Hauptkopie haelt die Kette nicht auf (Issue #878)", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    // Der Rest, den eine parallel laufende Umsetzungsnacht in der Hauptkopie liegen hat.
    // Er steht schon vor dem Start da — die Kette misst ihn gar nicht erst.
    writeFileSync(join(dir, "unfertig.md"), "ein Rest aus einem anderen Lauf\n");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /HARTER STOPP/, "die Kette stoppte wegen des fremden Rests hart");

    const lauf = stand(dir);
    assert.equal(lauf.abschluss, "regulaer");
    assert.equal("fehlerklasse" in lauf, false, "der Lauf traegt eine Fehlerklasse");
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003", "0004"], "die Pakete entstanden nicht");

    // Unter Variante A fasst die Kette die Hauptkopie nicht an: Der fremde Rest liegt noch.
    assert.equal(existsSync(join(dir, "unfertig.md")), true, "die Kette hat den fremden Rest angefasst");
  });
});

// Die Herkunft der Budgets am Lauf (Issue #659): Defaults sind im Protokoll und im
// Ergebnisstand sichtbar, ein vollstaendiger Block hinterlaesst keine Spur.
const VOLLER_BLOCK = {
  label: "kit:night", varianteBLabel: "kit:durchziehen", planMin: 30, paketeMin: 25, reviewMin: 30,
  abdeckungMin: 10, umsetzungMin: 120, kostenUsd: 50, kostenUsdB: 150, korrekturrunden: 2,
};

test("[night-28] ohne gesetzte Budget-Felder traegt der Lauf-Kopf budgetAusDefault und das Protokoll die Hinweiszeile", () => {
  mitProjekt((dir) => {
    const env = umgebung(dir);
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const lauf = stand(dir);
    assert.deepEqual(lauf.budgetAusDefault,
      ["label", "varianteBLabel", "planMin", "paketeMin", "reviewMin", "abdeckungMin", "umsetzungMin", "kostenUsd", "kostenUsdB", "korrekturrunden"]);
    assert.deepEqual(Object.keys(lauf).slice(Object.keys(lauf).indexOf("budget"), Object.keys(lauf).indexOf("budget") + 2), ["budget", "budgetAusDefault"],
      "budgetAusDefault steht unmittelbar hinter budget");
    assert.match(res.stdout, /aus den Defaults: .*reviewMin=15.*night\.kette/);
  });
});

test("[night-28] mit vollstaendigem Block fehlen budgetAusDefault und die Hinweiszeile", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal("budgetAusDefault" in stand(dir), false);
    assert.doesNotMatch(res.stdout, /aus den Defaults/);
  }, VOLLER_BLOCK);
});

test("[night-28] fehlt genau ein Feld, nennt der Lauf genau dieses", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(stand(dir).budgetAusDefault, ["reviewMin"]);
    assert.match(res.stdout, /aus den Defaults: reviewMin=15/);
    assert.doesNotMatch(res.stdout, /night\.kette in/);
  }, { ...VOLLER_BLOCK, reviewMin: undefined });
});

// Verbrauch, Lauf-Art, complete und Einlieferung am Lauf (Issue #669).
test("[night-29] [night-30] die Kette traegt Verbrauch je Einheit und Lauf, den Rest, die Art je Einheit und complete", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const lauf = stand(dir);
    const e = lauf.einheiten.find((x) => x.id === F);
    assert.equal(e.art, "kette");
    assert.deepEqual(e.verbrauch, { kostenUsd: 4, eingabeTokens: 40, ausgabeTokens: 80, cacheErzeugtTokens: 120, cacheGelesenTokens: 160 }, "vier Sessions");
    assert.deepEqual(lauf.verbrauch, e.verbrauch, "keine Session ohne Karte");
    assert.deepEqual(lauf.verbrauchOhneEinheit, { kostenUsd: 0, eingabeTokens: 0, ausgabeTokens: 0, cacheErzeugtTokens: 0, cacheGelesenTokens: 0 });
    assert.equal(lauf.complete, true, "[night-31] regulaer beendet");
  });
});

// Die Zeile zur Einlieferung schreibt der Lauf einmal je Prozess (`meldezeile`): Nur ein
// eigener Prozess je Lauf zeigt sie verlaesslich.
test("[night-31] mit lokalem Tracker entfaellt die Einlieferung und das Protokoll sagt es", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Einlieferung entfaellt: issueTracker 'local'/);
  });
});

test("[night-31] eine gescheiterte Einlieferung beendet den Lauf nicht als Fehlschlag, das Protokoll nennt den Grund", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = { ...umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } }), NIGHT_MELDEN_ERZWINGEN: "1" };
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /Einlieferung fehlgeschlagen: .*nur mit issueTracker toolbox/);
    assert.equal(stand(dir).einheiten.find((x) => x.id === F).ausgang, "fertig");
    assert.equal(stand(dir).abschluss, "regulaer");
  });
});

const NAV = "src/app/nav/side-nav.ts";
const NAV_SPEC = "src/app/nav/side-nav.spec.ts";

/** Legt Baustein und eigenen Test versioniert ins Fixture-Repo — der Worktree entsteht aus HEAD. */
function navVersionieren(dir) {
  mkdirSync(join(dir, "src", "app", "nav"), { recursive: true });
  writeFileSync(join(dir, NAV), "export const nav = [];\n");
  writeFileSync(join(dir, NAV_SPEC), "// erwartet nichts oberhalb des Fusses\n");
  for (const a of [["add", NAV, NAV_SPEC], ["commit", "-q", "-m", "Navigation"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
}

/** Wie oft der Anker in der Datei einer Karte steht. */
function testhinweisAnker(dir, id) {
  return readFileSync(join(dir, "issues", `${id}.md`), "utf-8").split(TESTHINWEIS_ANKER).length - 1;
}

test("[night-19] die Paket-Formpruefung schreibt keinen Testhinweis-Kommentar, auch wenn ein Paket den Baustein fuehrt", () => {
  mitProjekt((dir) => {
    navVersionieren(dir);
    const F = fachplan(dir);
    // Ein Paket, das denselben Baustein in seiner Aufgabe fuehrt: Die Stufe `issue` kennt keine
    // Testhinweise, also auch keinen Kommentar.
    const paketMitNav = PAKETE_ANLEGEN.replaceAll("Paket %s in", `Paket %s: ${NAV}, in`);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: paketMitNav } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.pakete.ids.length, 2);
    for (const id of einheit.stufen.pakete.ids) {
      assert.ok(readFileSync(join(dir, "issues", `${id}.md`), "utf-8").includes(NAV), `Paket #${id} fuehrt den Baustein nicht`);
      assert.equal(testhinweisAnker(dir, id), 0, `Paket #${id} traegt einen Testhinweis-Kommentar`);
    }
  });
});
