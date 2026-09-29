// Der Halt der Nacht-Kette und die Karten, die sie ueberspringt (Plan #638, A2, A8, E4; Issue #643).
//
// Eine Stopp-Frage im Plan oder kit:klaeren nach dem Review beenden die Kette mit
// `angehalten`: die Frage als Kommentar `## Kette angehalten` am Fachplan, kit:klaeren
// dort, der Plan bleibt im Backlog. Eine gekennzeichnete Karte mit kit:klaeren oder
// ausserhalb von Backlog laeuft nicht und behaelt ihr Label.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, stand, planBody, PLAN_ANLEGEN, REVIEW_HALT, REVIEW_MARKER,
} from "./helpers/kette-fixture.mjs";

const kommentare = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");

test("[night-19] eine Stopp-Frage im Plan haelt die Kette an: Kommentar und kit:klaeren am Fachplan, Plan bleibt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER },
      plan: planBody({ offeneFragen: "- Ist der neue Endpunkt eine Schnittstelle, die jemand anderes nutzt?" }),
    });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    const fach = board(dir, "issue", "get", F);
    assert.ok(fach.labels.includes("kit:klaeren"), "kit:klaeren fehlt am Fachplan");
    assert.ok(!fach.labels.includes("kit:night"), "das Label ist verbraucht");
    const text = kommentare(dir, F);
    assert.match(text, /## Kette angehalten/);
    assert.match(text, /Ist der neue Endpunkt eine Schnittstelle/);
    assert.match(text, /Stufe plan, Dokument #0002/);
    // Der Weg nach vorn fuehrt ueber den Plan, nicht ueber den Fachplan (Issue #896);
    // der Wortlaut selbst steht in night-kette-halt-planauftrag.test.mjs auf der Probe.
    assert.match(text, /kit:klaeren an Plan #0002 abnehmen/);
    assert.match(text, /das Label kit:night an Plan #0002 setzen/);

    const plan = board(dir, "issue", "get", "0002");
    assert.equal(plan.status, "backlog", "der Plan bleibt als Entwurf stehen");
    assert.doesNotMatch(plan.body, /Plan-Review:/, "die Review-Stufe darf nicht mehr laufen");

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "angehalten");
    assert.match(einheit.grund, /Stopp-Frage im Plan #0002/);
    assert.equal("review" in einheit.stufen, false);
    assert.match(res.stdout, /1 angehalten/);
  });
});

test("[night-19] kit:klaeren nach dem Review haelt die Kette an, die Frage ist der letzte Kommentar am Plan", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_HALT } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const fach = board(dir, "issue", "get", F);
    assert.ok(fach.labels.includes("kit:klaeren"));
    const text = kommentare(dir, F);
    assert.match(text, /## Kette angehalten/);
    assert.match(text, /Stufe review, Dokument #0002/);
    assert.match(text, /ist das eine Schnittstelle nach aussen\?/, "die Frage aus dem Review fehlt im Halt-Kommentar");
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "angehalten");
    assert.match(einheit.grund, /Stopp-Frage aus dem Review von #0002/);
  });
});

test("[night-19] ein Fachplan mit kit:klaeren und einer in Ready werden uebersprungen, ihr Label bleibt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const offen = fachplan(dir, "[Fachlich] Mit offener Frage");
    board(dir, "issue", "label", "add", offen, "kit:klaeren");
    const falsch = fachplan(dir, "[Fachlich] In der falschen Spalte");
    board(dir, "issue", "move", falsch, "ready");
    const fremd = board(dir, "issue", "create", "--title", "[Plan] Kein Fachplan", "--body", "## Ziel\n\nx\n\n## Betroffene Bereiche\n\n- y\n\n## Architektonische Entscheidungen\n\n- Keine.\n\n## Geplante Änderungen\n\n- z\n\n## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- w\n");
    board(dir, "issue", "label", "add", String(fremd.id), "kit:night");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    for (const id of [offen, falsch, String(fremd.id)]) {
      assert.ok(board(dir, "issue", "get", id).labels.includes("kit:night"), `#${id} muss sein Label behalten`);
    }
    const lauf = stand(dir);
    const grund = (id) => lauf.einheiten.find((e) => e.id === id).grund;
    assert.equal(lauf.einheiten.find((e) => e.id === offen).ausgang, "uebersprungen");
    assert.match(grund(offen), /traegt kit:klaeren/);
    assert.match(grund(falsch), /steht in ready, nicht in Backlog/);
    // Der Plan traegt keine Herkunftszeile: Seit Issue #895 lehnt ihn `planAusschluss`
    // als Plan-Auftrag ab, nicht mehr die Praefix-Probe des Fachplan-Auftrags.
    assert.match(grund(String(fremd.id)), /die fachliche Herkunft ist nicht erkennbar/);
    assert.match(res.stdout, /Keine Kette zu fahren/);
    assert.equal(board(dir, "issue", "list").filter((i) => /^\[Plan\] Ein Weg/.test(i.title)).length, 0, "keine Session darf gelaufen sein");
  });
});
