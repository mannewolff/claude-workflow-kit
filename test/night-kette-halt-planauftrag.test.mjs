// Der Halt der Kette geht an die gekennzeichnete Karte (Fachplan #883, Plan #890; Issue #896).
//
// Zweierlei wird hier geprueft. Erstens der Adressat: Kommentar und `kit:klaeren` stehen
// an der Karte, die das Kennzeichen trug — beim Fachplan-Auftrag an der fachlichen
// Anforderung, beim Plan-Auftrag am Plandokument. Zweitens, und das ist der teurere Fall,
// der Wortlaut des Hinweises selbst: Wer ihm folgt, muss einen Plan hinterlassen, den
// `planAusschluss` am naechsten Abend annimmt. Der frueher hier stehende Satz "Antwort
// bitte in den Fachplan schreiben" fuehrte den Menschen dazu, die Antwort unter die Frage
// zu setzen — dort liest `stoppFragenGrund` sie als weitere offene Frage, und der Plan
// waere mit dem eigenen Antworttext als Ausschlussgrund uebersprungen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KETTE_HALT_ANKER, KLAEREN_LABEL, REVIEW_FERTIG_LABEL, planAusschluss, stoppFragenGrund } from "../kit/night.mjs";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, planauftrag, umgebung, stand, planBody,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_HALT,
} from "./helpers/kette-fixture.mjs";

const KETTEN_LABEL = "kit:night";
const karteText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");

/** Der Halt-Kommentar einer Karte — der Text ab dem Anker. */
function haltKommentar(dir, id) {
  const text = karteText(dir, id);
  const i = text.indexOf(KETTE_HALT_ANKER);
  assert.ok(i >= 0, `#${id} traegt keinen Halt-Kommentar`);
  return text.slice(i);
}

test("[night-896] eine Fachplan-Kette haelt an der gekennzeichneten Karte an — der fachlichen Anforderung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER },
      plan: planBody({ offeneFragen: "- Ist der neue Endpunkt eine Schnittstelle nach aussen?" }),
    });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);

    assert.ok(board(dir, "issue", "get", F).labels.includes(KLAEREN_LABEL), `${KLAEREN_LABEL} fehlt an #${F}`);
    const kommentar = haltKommentar(dir, F);
    assert.match(kommentar, /Ist der neue Endpunkt eine Schnittstelle nach aussen\?/);
    // Der Plan ist der Ort der Entscheidung, nicht der Adressat des Kommentars.
    assert.match(kommentar, /Plan #0002/);
    assert.ok(!karteText(dir, "0002").includes(KETTE_HALT_ANKER), "der Halt gehoert an die gekennzeichnete Karte, nicht an den Plan");
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "angehalten");
  });
});

test("[night-896] eine Plan-Kette haelt am Plan an, die fachliche Anforderung bleibt unberuehrt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel", null);
    const M = planauftrag(dir, F);
    const res = run(dir, ["--kette"], umgebung(dir, { stufen: { pakete: PAKETE_HALT } }));
    assert.equal(res.status, 0, res.stderr);

    assert.ok(board(dir, "issue", "get", M).labels.includes(KLAEREN_LABEL), `${KLAEREN_LABEL} fehlt am Plan #${M}`);
    const kommentar = haltKommentar(dir, M);
    assert.match(kommentar, /Stufe pakete, Dokument #0002/);
    assert.match(kommentar, /Kein Eingang für \/issues/);
    // Die Anforderung traegt weder Label noch Kommentar: Sie hat das Kennzeichen nicht getragen.
    assert.ok(!board(dir, "issue", "get", F).labels.includes(KLAEREN_LABEL), `${KLAEREN_LABEL} darf nicht an #${F} haengen`);
    assert.ok(!karteText(dir, F).includes(KETTE_HALT_ANKER), `der Halt-Kommentar darf nicht an #${F} stehen`);
    // Ein Plan, der seine Pruefung schon hinter sich hat, wird nicht erneut geschickt.
    assert.doesNotMatch(kommentar, /\/issue-review/, "der Plan-Auftrag braucht den Pruefschritt nicht");
    assert.equal(stand(dir).einheiten.find((e) => e.id === M).ausgang, "angehalten");
  });
});

// --- Der Hinweis gegen die Probe (Issue #896, Punkt 5) ---

/** Der Abschnitt `ueberschrift` von `body`: Index der Zeile und Index hinter seinem Inhalt. */
function abschnittGrenzen(body, ueberschrift) {
  const zeilen = body.split("\n");
  const start = zeilen.findIndex((z) => z.trim() === ueberschrift);
  assert.ok(start >= 0, `der Abschnitt ${ueberschrift} fehlt im Plan`);
  let ende = start + 1;
  while (ende < zeilen.length && !/^##\s/.test(zeilen[ende])) ende++;
  return { zeilen, start, ende };
}

/** Haengt `eintrag` an den Inhalt eines Abschnitts an. */
function abschnittErgaenzen(body, ueberschrift, eintrag) {
  const { zeilen, ende } = abschnittGrenzen(body, ueberschrift);
  return [...zeilen.slice(0, ende), eintrag, "", ...zeilen.slice(ende)].join("\n");
}

/** Ersetzt den Inhalt eines Abschnitts durch `inhalt`. */
function abschnittSetzen(body, ueberschrift, inhalt) {
  const { zeilen, start, ende } = abschnittGrenzen(body, ueberschrift);
  return [...zeilen.slice(0, start + 1), "", inhalt, "", ...zeilen.slice(ende)].join("\n");
}

/**
 * Was der Hinweis verlangt, aus seinem eigenen Text gelesen: die beiden Abschnitte, der
 * Sollwert des zweiten, die Nummer des Plans und ob eine Pruefung dazugehoert.
 *
 * Aus dem Text und nicht aus einer zweiten Vorlage im Test: Eine von Hand gepflegte
 * Abschrift liefe bei der ersten Umformulierung des Hinweises am Hinweis vorbei — und
 * genau dann waere er wieder das, was dieses Paket beseitigt.
 */
function anweisungAus(kommentar) {
  const abschnitte = [...kommentar.matchAll(/'(##\s[^']+)'/g)].map((m) => m[1]);
  assert.equal(abschnitte.length, 2, `der Hinweis nennt nicht genau zwei Abschnitte: ${abschnitte.join(" | ")}`);
  const sollwert = kommentar.match(/'(-\s[^']+)'/)?.[1];
  assert.ok(sollwert, "der Hinweis nennt den Sollwert des Fragen-Abschnitts nicht");
  const planId = kommentar.match(/Plan #(\d+)/)?.[1];
  assert.ok(planId, "der Hinweis nennt den Plan nicht");
  return { entscheidungen: abschnitte[0], fragen: abschnitte[1], sollwert, planId, pruefen: kommentar.includes("/issue-review") };
}

test("[night-896] wer dem Hinweis wortgetreu folgt, hinterlaesst einen Plan, den planAusschluss annimmt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER },
      plan: planBody({ offeneFragen: "- Ist der neue Endpunkt eine Schnittstelle nach aussen?" }),
    });
    assert.equal(run(dir, ["--kette"], env).status, 0);

    const anweisung = anweisungAus(haltKommentar(dir, F));
    const M = anweisung.planId;
    // Gegenprobe zuerst: Vor der Bearbeitung lehnt der Runner den Plan ab.
    assert.ok(planAusschluss(board(dir, "issue", "get", M), KETTEN_LABEL, board(dir, "issue", "list")) !== null);

    // Schritt fuer Schritt, genau wie der Hinweis es sagt.
    let body = board(dir, "issue", "get", M).body;
    body = abschnittErgaenzen(body, anweisung.entscheidungen, "- A2 — Der Endpunkt bleibt intern, weil ihn niemand sonst ruft.");
    body = abschnittSetzen(body, anweisung.fragen, anweisung.sollwert);
    const pfad = join(tmpdir(), `night-896-plan-${process.pid}.md`);
    writeFileSync(pfad, body, "utf-8");
    board(dir, "issue", "update", M, "--body-file", pfad);
    if (anweisung.pruefen) board(dir, "issue", "label", "add", M, REVIEW_FERTIG_LABEL);
    board(dir, "issue", "label", "remove", M, KLAEREN_LABEL);
    board(dir, "issue", "label", "remove", F, KLAEREN_LABEL);
    board(dir, "issue", "label", "add", M, KETTEN_LABEL);

    const plan = board(dir, "issue", "get", M);
    assert.equal(stoppFragenGrund(plan.body), null, "die Antwort darf nicht als offene Frage gelesen werden");
    assert.equal(planAusschluss(plan, KETTEN_LABEL, board(dir, "issue", "list")), null,
      "der Plan wird trotz befolgtem Hinweis abgelehnt");
  });
});
