// Der glatte Durchlauf einer Nacht-Kette (Plan #638; Issue #643, Stufen Pakete und Abdeckung seit #644).
//
// Ein [Fachlich] mit kit:night geht hinein. Der Fake legt als /techplan den Plan an, die
// Formpruefung ist gruen, der Fake als /issue-review setzt den Marker. Danach: Label
// weg, Ausgang fertig, Sessions liefen im Worktree, der Worktree ist weg, die Notiz
// liegt in der Hauptkopie, KIT_AGENT_MODEL war gesetzt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, sessions, stand, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";

const PLAN_MIT_NOTIZ = `${PLAN_ANLEGEN}; printf "notiz" > .claude/vorhaben-wartend-plan-1.md`;

test("[night-19] eine Kette laeuft bis zum geprueften Plan: Label weg, fertig, Worktree entfernt, Notiz zurueck", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_MIT_NOTIZ, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `Kette haette durchlaufen muessen:\n${res.stdout}\n${res.stderr}`);

    // Das Board danach: Label weg, ein Plan mit der Herkunftszeile, im Backlog.
    const fach = board(dir, "issue", "get", F);
    assert.ok(!fach.labels.includes("kit:night"), "das Label muss beim Start verbraucht sein");
    assert.ok(!fach.labels.includes("kit:klaeren"));
    const plaene = board(dir, "issue", "list").filter((i) => /^\[Plan\]/.test(i.title));
    assert.equal(plaene.length, 1, "genau ein Plan entstanden");
    assert.match(plaene[0].body, new RegExp(`^Fachliche Quelle: Issue #${F}$`, "m"));
    assert.match(plaene[0].body, /^Plan-Review: opus/m, "die Review-Stufe hat den Marker gesetzt");
    assert.equal(plaene[0].status, "backlog");

    // Der Ergebnisstand.
    const lauf = stand(dir);
    assert.equal(lauf.art, "kette");
    assert.equal(lauf.schemaFassung, 1);
    assert.equal(lauf.label, "kit:night");
    assert.equal(lauf.budget.kostenUsd, 50);
    assert.equal("kennzahlenHinweis" in lauf, false, "die Kette fordert den Strom immer an");
    assert.equal(lauf.abschluss, "regulaer");
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig");
    assert.equal(einheit.stufen.plan.id, plaene[0].id);
    assert.equal(einheit.stufen.plan.korrekturrunden, 0);
    assert.equal(einheit.stufen.review.marker, true);
    assert.equal(einheit.kostenUsd, 4, "vier Sessions zu je 1 $");
    assert.equal(einheit.kostenUnbekannt, 0);
    assert.equal(lauf.kostenSumme, 4);
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003", "0004"]);

    // Die Sessions liefen im Worktree — nicht in der Hauptkopie — und KIT_AGENT_MODEL war gesetzt.
    const gelaufen = sessions(env.logPfad);
    assert.deepEqual(gelaufen.map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    for (const s of gelaufen) {
      assert.notEqual(s.cwd, realpathSync(dir), `${s.stufe} lief in der Hauptkopie`);
      assert.ok(basename(s.cwd).startsWith(`kette-${basename(dir)}-${F}-`), `${s.stufe} lief nicht im Worktree: ${s.cwd}`);
      assert.equal(s.modell, "claude-opus-5", "KIT_AGENT_MODEL fehlt in der Session");
    }
    // Worktree weg, Notiz da.
    assert.ok(!readdirSync(tmpdir()).some((n) => n.startsWith(`kette-${basename(dir)}-`)), "der Worktree liegt noch");
    assert.ok(existsSync(join(dir, ".claude", "vorhaben-wartend-plan-1.md")), "die Vorhaben-Notiz kam nicht zurueck");
    assert.match(res.stdout, /Nacht-Kette beendet: 1 fertig, 0 angehalten, 0 abgebrochen/);
  });
});

test("[night-19] ein Issue in In progress haelt die Kette nicht auf — sie laeuft neben der Umsetzungsnacht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const paket = board(dir, "issue", "create", "--title", "Ein Paket in Arbeit", "--body", "## Kontext\n\nAutor-Modell: x\n\n## Abhaengigkeiten\n\nKeine.\n");
    board(dir, "issue", "move", String(paket.id), "in_progress");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /Crash-Rest/);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "fertig");
  });
});

// Die Herkunft der Budgets am Lauf (Issue #659): Defaults sind im Protokoll und im
// Ergebnisstand sichtbar, ein vollstaendiger Block hinterlaesst keine Spur.
const VOLLER_BLOCK = {
  label: "kit:night", varianteBLabel: "kit:durchziehen", planMin: 30, paketeMin: 25, reviewMin: 30,
  abdeckungMin: 10, umsetzungMin: 120, kostenUsd: 50, kostenUsdB: 150, korrekturrunden: 2,
};

test("[night-28] ohne gesetzte Budget-Felder traegt der Lauf-Kopf budgetAusDefault und das Protokoll die Hinweiszeile", NUR_POSIX, () => {
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

test("[night-28] mit vollstaendigem Block fehlen budgetAusDefault und die Hinweiszeile", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal("budgetAusDefault" in stand(dir), false);
    assert.doesNotMatch(res.stdout, /aus den Defaults/);
  }, VOLLER_BLOCK);
});

test("[night-28] fehlt genau ein Feld, nennt der Lauf genau dieses", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(stand(dir).budgetAusDefault, ["reviewMin"]);
    assert.match(res.stdout, /aus den Defaults: reviewMin=15/);
    assert.doesNotMatch(res.stdout, /night\.kette in/);
  }, { ...VOLLER_BLOCK, reviewMin: undefined });
});

// Verbrauch, Lauf-Art, complete und Einlieferung am Lauf (Issue #669).
test("[night-29] [night-30] die Kette traegt Verbrauch je Einheit und Lauf, den Rest, die Art je Einheit und complete", NUR_POSIX, () => {
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

test("[night-31] mit lokalem Tracker entfaellt die Einlieferung und das Protokoll sagt es", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Einlieferung entfaellt: issueTracker 'local'/);
  });
});

test("[night-31] eine gescheiterte Einlieferung beendet den Lauf nicht als Fehlschlag, das Protokoll nennt den Grund", NUR_POSIX, () => {
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
