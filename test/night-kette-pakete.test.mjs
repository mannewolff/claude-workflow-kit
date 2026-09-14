// Stufe Pakete der Nacht-Kette (Plan #638, A7, E2; Issue #644).
//
// Nach dem Review faehrt die Kette /issues am Plan. Ergebnis sind nur Karten mit
// `Plan: Issue #M`; andere neue Karten stehen als nicht zuordenbar in der Einheit. Kein
// Paket mit dem Halt-Kommentar von /issues heisst angehalten, ohne ihn abgebrochen. Jedes
// Paket geht durch die Formpruefung mit Korrekturrunden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, PAKETE_HALT, PAKET_OHNE_ABHAENGIGKEITEN, PAKET_REPARIEREN,
} from "./helpers/kette-fixture.mjs";

const RESULT_TEXT = "### Zuordnung ... ### Ohne Paket Alle Kriterien sind abgebildet. ### Zuwachs Nichts Zusaetzliches.";

test("[night-20] zwei Pakete mit Herkunftszeile zaehlen, die fremde Karte steht als nicht zuordenbar", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003", "0004"]);
    assert.deepEqual(einheit.stufen.pakete.nichtZuordenbar, ["0005"]);
    assert.equal(einheit.stufen.pakete.korrekturrunden, 0);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    for (const id of ["0003", "0004"]) {
      const p = board(dir, "issue", "get", id);
      assert.equal(p.status, "backlog", "Pakete bleiben im Backlog — Ready ist das GO des Menschen");
      assert.match(p.body, /^Plan: Issue #0002$/m);
    }
    assert.match(res.stdout, /Pakete aus Plan #0002: #0003, #0004\./);
    assert.match(res.stdout, /nicht zuordenbar: #0005/);
    assert.match(res.stdout, /Morgen-Ritual: Plaene und Pakete sichten/);
  });
});

test("[night-20] kein Paket mit Halt-Kommentar von /issues heisst angehalten: Frage und kit:klaeren am Fachplan", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_HALT } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "angehalten");
    assert.match(einheit.grund, /Stopp-Frage beim Schneiden von #0002/);
    assert.deepEqual(einheit.stufen.pakete.ids, []);
    const fach = board(dir, "issue", "get", F);
    assert.ok(fach.labels.includes("kit:klaeren"));
    const text = readFileSync(join(dir, "issues", `${F}.md`), "utf-8");
    assert.match(text, /## Kette angehalten/);
    assert.match(text, /Stufe pakete, Dokument #0002/);
    assert.match(text, /Ist der Endpunkt ein Vertrag nach aussen\?/);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete"], "keine Abdeckung nach dem Halt");
  });
});

test("[night-20] kein Paket und kein Halt-Kommentar heisst abgebrochen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: ":" } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /kein Paket entstanden/);
    assert.ok(!board(dir, "issue", "get", F).labels.includes("kit:klaeren"));
  });
});

test("[night-20] ein Paket ohne Abhaengigkeiten-Abschnitt loest eine Korrekturrunde aus, dann ist die Kette fertig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKET_OHNE_ABHAENGIGKEITEN, form: PAKET_REPARIEREN },
    });
    const res = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003"]);
    assert.equal(einheit.stufen.pakete.korrekturrunden, 1);
    assert.match(board(dir, "issue", "get", "0003").body, /## Abhängigkeiten\n\nKeine\./);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "form", "abdeckung"]);
    assert.match(res.stdout, /Formpruefung #0003 rot .*Korrekturrunde 1 von 2/);
  });
});
