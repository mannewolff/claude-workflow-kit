// Ablauf-Pruefung: Variante B faehrt die Stufe umsetzung, und die laeuft gegen die Hauptkopie unter git und den Lock des Einstiegs kit/night.mjs — im selben Prozess nicht herstellbar.
//
// Ein Plan ohne fachliche Anforderung am Ende der Nacht-Kette (Fachplan #1644, Kriterium 6;
// Plan #1645; Issue #1648): Sind alle Pakete durch, liegt der Plan in In review, und die Idee,
// aus der er entstand, bleibt in Spalte und Inhalt unveraendert. Was die Kette im selben
// Prozess mit einem solchen Plan tut, steht in `night-kette-plan-ohne-anforderung.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  run, board, mitProjekt, planauftrag, planBody, umgebung, sessions, stand, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-ablauf.mjs";

/** Der Body eines Plans ohne Zeile `Fachliche Quelle:`. */
const OHNE_BODY = planBody().replace("Fachliche Quelle: Issue #__F__\n", "");

/** Die Datei einer Karte des lokalen Trackers, mit Kopf, Body und Kommentaren. */
const karteDatei = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");

test("Szenario: Am Ende liegt der Plan in In review, die Idee bleibt", () => {
  mitProjekt((dir) => {
    const idee = board(dir, "issue", "create", "--title", "[Idea] Ein Gedanke", "--body", "## Idee\n\nEin technischer Gedanke.\n");
    const I = String(idee.id);
    const ideeVorher = board(dir, "issue", "get", I);
    const ideeDateiVorher = karteDatei(dir, I);
    const M = planauftrag(dir, null, { titel: "[Plan] Ohne Anforderung", body: OHNE_BODY });
    board(dir, "issue", "label", "add", M, "ziel:umsetzung");

    const env = umgebung(dir, { stufen: { pakete: PAKETE_ANLEGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--chain"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung", "umsetzung", "umsetzung"]);
    const einheit = stand(dir).einheiten.find((e) => e.id === M);
    assert.equal(einheit.variante, "B");
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal("fachplan" in einheit, false);

    // Nach allen Paketen liegt der Plan in In review ...
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.deepEqual(inReview.sort(), [M, ...einheit.stufen.pakete.ids].sort());

    // ... und die Idee steht unveraendert in ihrer Spalte.
    const ideeNachher = board(dir, "issue", "get", I);
    for (const feld of ["status", "title", "body", "labels"]) {
      assert.deepEqual(ideeNachher[feld], ideeVorher[feld], `die Idee hat sich in ${feld} veraendert`);
    }
    assert.equal(karteDatei(dir, I), ideeDateiVorher, "die Kartendatei der Idee samt Kommentaren hat sich veraendert");

    // Der Abschnitt Ursprungsdokumente nennt nur den Plan.
    const bericht = karteDatei(dir, M);
    assert.ok(bericht.includes("### Ursprungsdokumente"), "kein Nachtbericht mit Ursprungsdokumenten am Plan");
    const ursprung = bericht.split("### Ursprungsdokumente")[1].split("\n### ")[0];
    assert.match(ursprung, new RegExp(`- Plan #${Number(M)}: nach In review gewandert\\.`));
    assert.doesNotMatch(ursprung, new RegExp(`fachliche Anforderung|Idee|#0*${Number(I)}\\b`));
  }, { uebergaenge: { abdeckungUmsetzung: true } });
});
