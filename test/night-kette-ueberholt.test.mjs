// Ueberholte Plaene (Plan #638, A8; Issue #644).
//
// Eine zweite Kette zum selben Fachplan beginnt von vorn. Der aeltere Plan bekommt den
// Kommentar "Ueberholt durch Plan #M2", kein Label, keinen Move; ein Plan zu einem
// anderen Fachplan bleibt unberuehrt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, stand, boardFakeInstallieren,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";
import { UEBERHOLT_UNBESTAETIGT_GRUND as UNBESTAETIGT_GRUND } from "../kit/night.mjs";

const RESULT_TEXT = "Alle Kriterien sind abgebildet.";

/**
 * Die erste Kette zum Fachplan: legt den aelteren Plan an und liefert Fachplan- und
 * Plannummer. Die zweite Kette startet der Test selbst — sie braucht je nach Fall eine
 * andere Umgebung.
 */
function ersteKette(dir, env) {
  const F = fachplan(dir);
  const erster = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
  assert.equal(erster.status, 0, erster.stderr);
  const alt = board(dir, "issue", "list").filter((i) => /^\[Plan\]/.test(i.title)).map((i) => String(i.id));
  assert.equal(alt.length, 1, "die erste Kette hinterlaesst genau einen Plan");
  return { F, alt: alt[0] };
}

/** Die zweite Kette zum selben Fachplan: der Mensch setzt das Label neu. */
function zweiteKette(dir, F, env) {
  board(dir, "issue", "label", "add", F, "kit:night");
  const res = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
  assert.equal(res.status, 0, res.stderr);
  return { res, einheit: stand(dir).einheiten.find((e) => e.id === F), text: readFileSync(join(dir, "issues", `${F}.md`), "utf-8") };
}

test("[night-20] die zweite Kette kommentiert den aelteren Plan als ueberholt, den fremden nicht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const anderer = fachplan(dir, "[Fachlich] Ein anderes Anliegen", null);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const erster = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(erster.status, 0, erster.stderr);
    const altePlaene = board(dir, "issue", "list").filter((i) => /^\[Plan\]/.test(i.title)).map((i) => i.id);
    assert.deepEqual(altePlaene, ["0003"]);
    // Ein Plan zu einem anderen Fachplan, wie ihn eine andere Kette hinterliesse.
    const fremd = board(dir, "issue", "create", "--title", "[Plan] Fremder Weg", "--body",
      `Plan-Modell: x\nFachliche Quelle: Issue #${anderer}\n\n## Ziel\n\nx\n\n## Betroffene Bereiche\n\n- y\n\n## Architektonische Entscheidungen\n\n- Keine.\n\n## Geplante Änderungen\n\n- z\n\n## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- w\n`);

    // Die zweite Kette: der Mensch setzt das Label neu.
    board(dir, "issue", "label", "add", F, "kit:night");
    const zweiter = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(zweiter.status, 0, zweiter.stderr);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(einheit.ueberholt, ["0003"]);
    const neuerPlan = einheit.stufen.plan.id;
    assert.notEqual(neuerPlan, "0003");
    const alt = readFileSync(join(dir, "issues", "0003.md"), "utf-8");
    assert.match(alt, new RegExp(`Ueberholt durch Plan #${neuerPlan} \\(Kette `));
    assert.equal(board(dir, "issue", "get", "0003").status, "backlog", "der alte Plan wird nicht bewegt");
    assert.doesNotMatch(readFileSync(join(dir, "issues", `${fremd.id}.md`), "utf-8"), /Ueberholt/, "ein Plan zu einem anderen Fachplan bleibt unberuehrt");
    assert.match(zweiter.stdout, new RegExp(`Plan #0003 als ueberholt kommentiert \\(neuer Plan #${neuerPlan}\\)`));
  });
});

test("[night-20] ohne aelteren Plan traegt die Einheit kein Feld ueberholt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(res.status, 0, res.stderr);
    assert.equal("ueberholt" in stand(dir).einheiten.find((e) => e.id === F), false);
  });
});

test("[night-20] ist der Ueberholt-Kommentar nach dem Schreiben auffindbar, steht der Plan im Bericht unter Ueberholt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const { F, alt } = ersteKette(dir, env);
    const { res, einheit, text } = zweiteKette(dir, F, env);

    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(einheit.ueberholt, [alt]);
    assert.equal("ueberholtUnbestaetigt" in einheit, false);
    assert.ok(text.includes(`### Ueberholt\n\n- Plan #${alt}\n`), "der bestaetigte Plan steht unter Ueberholt");
    assert.ok(!text.includes("### Ueberholt, nicht bestaetigt"), "ohne unbestaetigten Kommentar entfaellt der Abschnitt");
    assert.match(res.stdout, new RegExp(`Plan #${alt} als ueberholt kommentiert \\(neuer Plan #${einheit.stufen.plan.id}\\)`));
  });
});

test("[night-20] ist der Ueberholt-Kommentar nicht auffindbar, steht der Plan getrennt im Bericht und der Lauf laeuft weiter", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const { F, alt } = ersteKette(dir, env);
    // Ab hier nimmt das Board den Kommentar an den alten Plan an, ohne ihn zu speichern.
    boardFakeInstallieren(dir);
    const { res, einheit, text } = zweiteKette(dir, F, { ...env, BOARD_FAKE_SCHLUCKEN: alt });

    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal("ueberholt" in einheit, false, "ohne Zustellnachweis gilt kein Plan als ueberholt");
    assert.deepEqual(einheit.ueberholtUnbestaetigt, [{ id: alt, grund: UNBESTAETIGT_GRUND }]);
    assert.ok(!text.includes("### Ueberholt\n"), "der unbestaetigte Plan steht nicht unter Ueberholt");
    assert.ok(text.includes(`### Ueberholt, nicht bestaetigt\n\n- Plan #${alt} — ${UNBESTAETIGT_GRUND}\n`));
    assert.match(res.stdout, new RegExp(`Plan #${alt}: der Ueberholt-Kommentar ist am Board nicht auffindbar`));
    assert.doesNotMatch(res.stdout, new RegExp(`Plan #${alt} als ueberholt kommentiert`));
  });
});
