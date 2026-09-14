// Aufruf, Dry-Run und Kandidatenwahl der Nacht-Kette (Plan #638, A13, E6; Issue #643).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { waehleKettenKandidaten, korrekturPrompt } from "../kit/night.mjs";
import {
  NIGHT, NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, sessions, stand, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";

test("[night-19] --kette mit --label wird abgewiesen: das Kettenlabel steht in der Config", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette", "--label", "kit:x"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--kette kennt kein --label/);
    assert.match(res.stderr, /night\.kette\.label/);
  });
});

test("[night-19] --help nennt --kette", () => {
  const res = spawnSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--kette\s+Nacht-Kette/);
});

test("[night-19] ein kaputtes Budget bricht vor dem Ergebnisstand mit dem Feldnamen ab", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /night\.kette\.planMin muss eine Zahl groesser 0 sein/);
    assert.deepEqual(readdirSync(join(dir, ".claude")).filter((n) => n.startsWith("night-run-")), []);
  }, { planMin: 0 });
});

test("[night-19] --kette --dry-run nennt Kandidaten, Uebersprungene und Budget und legt weder Worktree noch Ergebnisstand an", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const offen = fachplan(dir, "[Fachlich] Mit offener Frage");
    board(dir, "issue", "label", "add", offen, "kit:klaeren");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN } });
    const res = run(dir, ["--kette", "--dry-run"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${F} \\[Fachlich\\] Ein Anliegen -> Kette 1`));
    assert.match(res.stdout, new RegExp(`#${offen} .*-> uebersprungen \\(traegt kit:klaeren`));
    assert.match(res.stdout, /Budget: Plan 20 min, Pakete 15 min, Review 15 min, Abdeckung 10 min, 50 \$ je Kette, 2 Korrekturrunde\(n\)/);
    assert.match(res.stdout, /Dry-Run beendet: 1 Kette\(n\) wuerden laufen/);
    assert.ok(board(dir, "issue", "get", F).labels.includes("kit:night"), "der Dry-Run verbraucht kein Label");
    assert.deepEqual(sessions(env.logPfad), [], "der Dry-Run startet keine Session");
    assert.deepEqual(readdirSync(join(dir, ".claude")).filter((n) => /^night-run-.*\.json$/.test(n)), []);
    assert.ok(!readdirSync(tmpdir()).some((n) => n.startsWith(`kette-${basename(dir)}-`)), "der Dry-Run legt keinen Worktree an");
  });
});

test("[night-19] alte Routing-Labels loesen eine Hinweiszeile aus, ohne Wirkung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const alt = fachplan(dir, "[Fachlich] Mit altem Label", "kit:nightplan");
    const res = run(dir, ["--kette", "--dry-run"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`Hinweis: #${alt} traegt das Label 'kit:nightplan', das es seit Stufe 2 nicht mehr gibt`));
    assert.match(res.stdout, /WARNUNG: keine Karte traegt das Label 'kit:night'/);
    assert.match(res.stdout, /Keine Kette zu fahren/);
  });
});

test("[night-19] mehrere Fachplaene laufen nacheinander in Listenreihenfolge, --max laesst den Rest liegen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const a = fachplan(dir, "[Fachlich] Erstes");
    const b = fachplan(dir, "[Fachlich] Zweites");
    const c = fachplan(dir, "[Fachlich] Drittes");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette", "--max", "2"], env);
    assert.equal(res.status, 0, res.stderr);
    const lauf = stand(dir);
    assert.equal(lauf.einheiten.find((e) => e.id === a).ausgang, "fertig");
    assert.equal(lauf.einheiten.find((e) => e.id === b).ausgang, "fertig");
    assert.equal(lauf.einheiten.find((e) => e.id === c).ausgang, "liegengeblieben");
    assert.ok(board(dir, "issue", "get", c).labels.includes("kit:night"), "die liegengebliebene Karte behaelt ihr Label");
    // Der Worktree heisst kette-<repo>-<F>-<datum>-<uhrzeit>; F steht vor dem Stempel.
    const reihenfolge = sessions(env.logPfad).filter((s) => s.stufe === "plan")
      .map((s) => /-(\d+)-\d{4}-\d{2}-\d{2}-\d{6}$/.exec(basename(s.cwd))?.[1]);
    assert.deepEqual(reihenfolge, [a, b], "die Ketten liefen nicht in Listenreihenfolge");
    assert.equal(lauf.einheiten.find((e) => e.id === b).kostenUsd, 4, "jede Kette hat ihr eigenes Budget");
    assert.match(res.stdout, /Kette 1\/2: Issue #0001/);
    assert.match(res.stdout, /Kette 2\/2: Issue #0002/);
  });
});

test("[night-19] waehleKettenKandidaten: nur Karten mit Label, in Reihenfolge, mit Grund je Ausschluss", () => {
  const karten = [
    { id: "1", title: "[Fachlich] A", status: "backlog", labels: ["kit:night"] },
    { id: "2", title: "[Fachlich] ohne Label", status: "backlog", labels: [] },
    { id: "3", title: "[Plan] P", status: "backlog", labels: ["kit:night"] },
    { id: "4", title: "[Fachlich] in Ready", status: "ready", labels: ["kit:night"] },
    { id: "5", title: "[Fachlich] geklaert?", status: "backlog", labels: ["kit:night", "kit:klaeren"] },
    { id: "6", title: "[Fachlich] B", status: "backlog", labels: ["kit:night"] },
    { id: "7", title: "[Fachlich] C", status: "backlog", labels: ["kit:night"] },
  ];
  const r = waehleKettenKandidaten(karten, "kit:night", 2);
  assert.deepEqual(r.kandidaten.map((k) => k.id), ["1", "6"]);
  assert.deepEqual(r.liegengeblieben.map((k) => k.id), ["7"]);
  assert.deepEqual(r.uebersprungen.map((u) => [u.id, u.grund.split(" — ")[0].split(",")[0]]), [
    ["3", "kein fachliches Issue ([Fachlich])"],
    ["4", "steht in ready"],
    ["5", "traegt kit:klaeren"],
  ]);
  assert.deepEqual(waehleKettenKandidaten(undefined, "kit:night", 3), { kandidaten: [], uebersprungen: [], liegengeblieben: [] });
  assert.equal(waehleKettenKandidaten([{ id: "9", status: "backlog", labels: ["kit:night"] }], "kit:night", 1).uebersprungen[0].grund.startsWith("kein fachliches Issue"), true, "eine Karte ohne Titel ist kein Fachplan");
});

test("[night-19] der Korrekturprompt nennt Dokument, Verstoesse und den Weg ueber issue update", () => {
  const p = korrekturPrompt("0002", [{ gate: "P1", meldung: "Abschnitt fehlt" }, { meldung: "ohne Gate" }]);
  assert.match(p, /Das Dokument #0002 hat die Formpruefung nicht bestanden/);
  assert.match(p, /^- P1: Abschnitt fehlt$/m);
  assert.match(p, /^- ohne Gate$/m);
  assert.match(p, /issue update 0002 --body-file <pfad>/);
  assert.match(p, /Dieser Lauf ist unbeaufsichtigt/);
});
