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
