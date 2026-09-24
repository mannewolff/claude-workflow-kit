// Der gekennzeichnete Plan als Auftrag der Nacht-Kette (Fachplan #883, Plan #890; Issue #895).
//
// Mit Issue #893 konnte der Runner einen startbereiten Plan nur erkennen. Hier nimmt er
// ihn an: Die Kette ueberspringt die Stufen `plan` und `review`, uebernimmt das
// vorhandene Dokument und faehrt von `pakete` an weiter. Kein zweiter Plan entsteht,
// kein aelterer wird als ueberholt vermerkt.
//
// Die Kollisionen zwischen Auftragsarten stehen in `night-kette-kollision.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, planauftrag, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-fixture.mjs";

/** Die Abdeckungs-Session schneidet ihren Auftrag mit — nur so ist pruefbar, wogegen sie haelt. */
const ABDECKUNG_MITSCHNITT = 'printf "%s" "$NIGHT_PROMPT" > "$KETTE_LOG.abdeckung.txt"';

/**
 * Alle vier erzeugenden Stufen sind belegt, auch `plan` und `review`: Liefe eine von
 * ihnen doch, stuende sie im Protokoll des Fakes — die Zusicherung waere sonst blind.
 */
const STUFEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, abdeckung: ABDECKUNG_MITSCHNITT };

/** Kein Kommentar `Ueberholt durch Plan #` an irgendeiner Karte des Boards. */
function keinUeberholtKommentar(dir) {
  for (const i of board(dir, "issue", "list")) {
    assert.ok(!String(i.body || "").includes("Ueberholt durch Plan #"), `#${i.id} traegt einen Ueberholt-Kommentar`);
  }
}

test("[night-895] ein gekennzeichneter, gepruefter Plan laeuft als Auftrag: nur pakete und abdeckung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel", null);
    const M = planauftrag(dir, F);
    const env = umgebung(dir, { stufen: STUFEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    // Das Kennzeichen ist am Plan verbraucht — dort hat der Mensch es gesetzt.
    assert.ok(!board(dir, "issue", "get", M).labels.includes("kit:night"), "das Label muss am Plan abgenommen sein");

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung"],
      "plan und review duerfen bei einem Plan-Auftrag nicht laufen");

    // Kein zweites Plandokument, kein Ueberholt-Vermerk.
    const plaene = board(dir, "issue", "list").filter((i) => /^\[Plan\]/.test(i.title));
    assert.deepEqual(plaene.map((i) => String(i.id)), [M], "es entstand ein zweites [Plan]-Dokument");
    keinUeberholtKommentar(dir);

    const lauf = stand(dir);
    const einheit = lauf.einheiten.find((e) => e.id === M);
    assert.ok(einheit, "die Einheit traegt die Nummer der gekennzeichneten Karte");
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.auftrag, "plan");
    assert.equal(einheit.fachplan, F);
    assert.equal(einheit.stufen.plan.id, M, "der uebernommene Plan steht im Stand der Stufe plan");
    assert.equal(einheit.stufen.plan.uebernommen, true);
    assert.equal(einheit.stufen.plan.dauerMs, 0, "eine uebernommene Stufe kostet keine Zeit");
    assert.equal("review" in einheit.stufen, false, "die Review-Stufe darf keinen Stand hinterlassen");
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003", "0004"]);
    assert.equal(einheit.kostenUsd, 2, "zwei Sessions zu je 1 $");

    // Die Abdeckung haelt die Pakete gegen die fachliche Anforderung, nicht gegen den Plan.
    const prompt = readFileSync(`${env.logPfad}.abdeckung.txt`, "utf-8");
    assert.match(prompt, new RegExp(`den Fachplan #${F}\\b`));
    assert.match(prompt, new RegExp(`den Plan #${M}\\b`));
    assert.match(prompt, /#0003, #0004/);

    assert.match(res.stdout, new RegExp(`Kette 1/\\d+: Plan #${M} \\(fachliche Quelle #${F}\\) — \\[Plan\\]`));

    // Der Nachtbericht steht an der gekennzeichneten Karte, und die uebernommene Stufe
    // wird nicht abgerechnet (Issue #896).
    assert.equal(einheit.bericht, "veroeffentlicht");
    assert.match(res.stdout, new RegExp(`Nachtbericht als Kommentar an #${M} veroeffentlicht`));
    const bericht = readFileSync(join(dir, "issues", `${M}.md`), "utf-8");
    assert.match(bericht, new RegExp(`### Stufen\\n\\n- Auftrag: Plan #${M} \\(fachliche Quelle #${F}\\)\\n- Variante: A\\n`));
    assert.match(bericht, /als Auftrag uebernommen, nicht neu geschrieben, Pruefer keiner\./);
    assert.doesNotMatch(bericht, /Dauer 0\.0 min/, "die uebernommene Stufe behauptet eine Messung");
    assert.ok(!readFileSync(join(dir, "issues", `${F}.md`), "utf-8").includes("## Nachtbericht, Kette"),
      "der Bericht gehoert an die gekennzeichnete Karte, nicht an die Wurzel");
  });
});

test("[night-895] Variante B am Plan: hinter abdeckung laeuft die Stufe umsetzung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel", null);
    const M = planauftrag(dir, F);
    board(dir, "issue", "label", "add", M, "kit:durchziehen");
    const env = umgebung(dir, { stufen: { ...STUFEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung", "umsetzung", "umsetzung"]);
    const einheit = stand(dir).einheiten.find((e) => e.id === M);
    assert.equal(einheit.variante, "B", "die Variante steht am Plan, nicht an der Wurzel");
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id)),
      einheit.stufen.pakete.ids, "die Pakete stehen nach Variante B in In review");
  });
});

test("[night-895] das Durchziehen-Label an der fachlichen Anforderung bleibt wirkungslos", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel", null);
    board(dir, "issue", "label", "add", F, "kit:durchziehen");
    const M = planauftrag(dir, F);
    const env = umgebung(dir, { stufen: { ...STUFEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung"],
      "die Umsetzungsstufe lief, obwohl der Plan das Kennzeichen nicht traegt");
    const einheit = stand(dir).einheiten.find((e) => e.id === M);
    assert.equal(einheit.variante, "A");
    const backlog = new Set(board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id)));
    for (const id of einheit.stufen.pakete.ids) assert.ok(backlog.has(id), `Paket #${id} liegt nicht in Backlog`);
  });
});

test("[night-895] --kette --dry-run nennt den Plan-Auftrag mit fachlicher Quelle und Variante", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel", null);
    const M = planauftrag(dir, F);
    const vorher = board(dir, "issue", "list");
    const res = run(dir, ["--kette", "--dry-run"], umgebung(dir, { stufen: STUFEN }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout,
      new RegExp(`#${M} \\[Plan\\] Ein fertiger Weg -> Kette 1 \\(Plan-Auftrag, fachliche Quelle #${F}, Variante A\\)`));
    assert.deepEqual(board(dir, "issue", "list"), vorher, "der Dry-Run hat am Board etwas veraendert");
  });
});
