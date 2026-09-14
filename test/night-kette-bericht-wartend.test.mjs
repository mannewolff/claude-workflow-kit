// Wartende Nachtberichte und "Kette nicht gestartet" (Plan #638, A11; Issue #645).
//
// Nimmt der Tracker den Bericht nicht an, wartet er als `.claude/night-bericht-<F>-<stempel>.md`
// in der Hauptkopie — kein Rest im Arbeitsbaum — und geht beim naechsten Start jeder
// Betriebsart nach. Scheitert der Reviewer-Vorflug vor der ersten Kette, bekommt jeder
// Kandidat den Kommentar "Kette nicht gestartet" und behaelt sein Label.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BERICHT_ANKER } from "../kit/night.mjs";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, stand, boardFakeInstallieren, VORFLUG_KAPUTT,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";

function wartende(dir) {
  return readdirSync(join(dir, ".claude")).filter((n) => n.startsWith("night-bericht-")).sort();
}

test("[night-21] nimmt der Tracker den Bericht nicht an, wartet er in der Hauptkopie und der naechste Lauf traegt ihn nach", NUR_POSIX, () => {
  mitProjekt((dir) => {
    boardFakeInstallieren(dir);
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const erster = run(dir, ["--kette"], { ...env, BOARD_FAKE_ABLEHNEN: F });
    assert.equal(erster.status, 0, erster.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    const [datei] = wartende(dir);
    assert.ok(datei, "kein wartender Bericht");
    assert.match(datei, new RegExp(`^night-bericht-${F}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.md$`));
    assert.equal(einheit.bericht, join(".claude", datei));
    assert.match(readFileSync(join(dir, ".claude", datei), "utf-8"), new RegExp(`^${BERICHT_ANKER} `));
    assert.ok(!readFileSync(join(dir, "issues", `${F}.md`), "utf-8").includes(BERICHT_ANKER), "am Fachplan steht noch nichts");
    assert.match(erster.stdout, /Nachtbericht konnte nicht an #0001 geschrieben werden .* liegt wartend unter \.claude\/night-bericht-/);
    // Kein Rest im Arbeitsbaum: dieselbe Ausnahme wie night-run-* — die Fixture-.gitignore deckt die Datei NICHT.
    const status = spawnSync("git", ["status", "--porcelain", "--", ".", ":(exclude)issues", ":(exclude).claude/night-bericht-*"], { cwd: dir, encoding: "utf-8" });
    assert.equal(status.stdout.trim(), "", "ausser dem wartenden Bericht liegt nichts im Baum");
    assert.match(spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" }).stdout, /night-bericht-/, "die Fixture-.gitignore deckt die Datei nicht — der Runner muss sie selbst ausnehmen");

    // Der folgende Implementierungslauf: sein Zustands-Vorflug haelt den Baum fuer sauber, traegt nach, loescht.
    const zweiter = run(dir, [], env);
    assert.equal(zweiter.status, 0, `${zweiter.stdout}\n${zweiter.stderr}`);
    assert.match(zweiter.stdout, new RegExp(`Wartenden Nachtbericht nachgetragen: \\.claude/${datei} -> Kommentar an #${F}\\.`));
    assert.deepEqual(wartende(dir), []);
    const text = readFileSync(join(dir, "issues", `${F}.md`), "utf-8");
    assert.equal(text.split(BERICHT_ANKER).length - 1, 1, "genau einmal nachgetragen");
    assert.equal(stand(dir).abschluss, "regulaer");
  });
});

test("[night-21] bleibt der Tracker tot, bleibt der Bericht liegen und der Lauf geht weiter", NUR_POSIX, () => {
  mitProjekt((dir) => {
    boardFakeInstallieren(dir);
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    assert.equal(run(dir, ["--kette"], { ...env, BOARD_FAKE_ABLEHNEN: F }).status, 0);
    const [datei] = wartende(dir);
    const res = run(dir, [], { ...env, BOARD_FAKE_ABLEHNEN: F });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`Wartender Nachtbericht bleibt liegen: \\.claude/${datei}`));
    assert.deepEqual(wartende(dir), [datei]);
    assert.match(res.stdout, /Nacht-Runner beendet: 0 erfolgreich/, "der Lauf geht weiter");
  });
});

test("[night-21] im Dry-Run wird nichts nachgetragen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    boardFakeInstallieren(dir);
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    assert.equal(run(dir, ["--kette"], { ...env, BOARD_FAKE_ABLEHNEN: F }).status, 0);
    const vorher = wartende(dir);
    assert.equal(vorher.length, 1);
    const res = run(dir, ["--dry-run"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(wartende(dir), vorher);
    assert.doesNotMatch(res.stdout, /Nachtbericht nachgetragen/);
  });
});

test("[night-21] scheitert der Vorflug vor der ersten Kette, bekommt jeder Kandidat 'Kette nicht gestartet' und behaelt sein Label", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const a = fachplan(dir);
    const b = fachplan(dir, "[Fachlich] Ein zweites Anliegen");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN } });
    const res = run(dir, ["--kette"], { ...env, NIGHT_VORFLUG_CMD: VORFLUG_KAPUTT });
    assert.equal(res.status, 1, "der Lauf endet wie bisher mit hartem Stopp");
    for (const F of [a, b]) {
      const karte = board(dir, "issue", "get", F);
      assert.ok(karte.labels.includes("kit:night"), `das Label an #${F} bleibt`);
      const text = readFileSync(join(dir, "issues", `${F}.md`), "utf-8");
      assert.match(text, /Kette nicht gestartet: Die Vorflug-Session lieferte kein Ergebnis \(die Vorflug-Session endete ohne auswertbaren Befund-Block\)/);
      assert.ok(!text.includes(BERICHT_ANKER), "ohne Kette kein Nachtbericht");
    }
    assert.match(res.stdout, /#0001: Kommentar 'Kette nicht gestartet' geschrieben, Label bleibt\./);
    assert.equal(board(dir, "issue", "list").length, 2, "kein Plan entstanden");
    assert.equal(stand(dir).abschluss, "harterStopp");
    assert.ok(!existsSync(join(dir, "helfer", "kette-sessions.log")), "keine Ketten-Session gestartet");
  });
});
