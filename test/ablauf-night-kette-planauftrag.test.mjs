// Ablauf-Pruefung: Variante B faehrt die Stufe umsetzung, und die laeuft gegen die Hauptkopie unter git und den Lock des Einstiegs kit/night.mjs — im selben Prozess nicht herstellbar.
//
// Der gekennzeichnete Plan als Auftrag der Nacht-Kette (Fachplan #883, Plan #890; Issue #895),
// soweit er die Umsetzung braucht. Was die Kette selbst mit dem Plan-Auftrag tut, steht im
// selben Prozess in `night-kette-planauftrag.test.mjs` (Issue #1233).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  run, board, mitProjekt, fachplan, planauftrag, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG, durchziehen,
} from "./helpers/kette-ablauf.mjs";

/** Die Abdeckungs-Session schneidet ihren Auftrag mit — nur so ist pruefbar, wogegen sie haelt. */
const ABDECKUNG_MITSCHNITT = 'printf "%s" "$NIGHT_PROMPT" > "$KETTE_LOG.abdeckung.txt"';

/**
 * Alle vier erzeugenden Stufen sind belegt, auch `plan` und `review`: Liefe eine von
 * ihnen doch, stuende sie im Protokoll des Fakes — die Zusicherung waere sonst blind.
 */
const STUFEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, abdeckung: ABDECKUNG_MITSCHNITT };

test("[night-895] Variante B am Plan: hinter abdeckung laeuft die Stufe umsetzung", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel", null);
    const M = planauftrag(dir, F);
    durchziehen(dir, M);
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
