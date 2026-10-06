// Der glatte Durchlauf einer Nacht-Kette (Plan #638; Issue #643, Stufen Pakete und Abdeckung seit #644).
//
// Ein [Fachlich] mit kit:night geht hinein. Die Session der Stufe plan legt den Plan an, die
// Formpruefung ist gruen, die Session der Stufe review setzt den Marker. Danach: Label
// weg, Ausgang fertig, Sessions liefen im Worktree, der Worktree ist weg, KIT_AGENT_MODEL
// war gesetzt.
//
// Seit Issue #1233 im selben Prozess (`ketteImProzess`, Plan #1199, E6). Was nur der Einstieg
// belegt — Lauf-Kopf, Einlieferung, die echte Formpruefung, die Hauptkopie unter git —,
// steht in `ablauf-night-kette-ablauf.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import {
  ketteImProzess, fachplanKarte, formNachAbschnitten, jeStufe, planAnlegen, planBody, reviewMarker, paketeAnlegen, GLATT,
} from "./helpers/kette-fixture.mjs";
import { TESTHINWEIS_ANKER } from "../kit/night/kette.mjs";

test("[night-19] eine Kette laeuft bis zum geprueften Plan: Label weg, fertig, Worktree entfernt", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);

  // Das Board danach: Label weg, ein Plan mit der Herkunftszeile, im Backlog.
  const fach = r.karte("1");
  assert.ok(!fach.labels.includes("kit:night"), "das Label muss beim Start verbraucht sein");
  assert.ok(!fach.labels.includes("kit:klaeren"));
  const plaene = r.karten.filter((i) => /^\[Plan\]/.test(i.title));
  assert.equal(plaene.length, 1, "genau ein Plan entstanden");
  assert.match(plaene[0].body, /^Fachliche Quelle: Issue #1$/m);
  assert.match(plaene[0].body, /^Plan-Review: opus/m, "die Review-Stufe hat den Marker gesetzt");
  assert.equal(plaene[0].status, "backlog");

  // Die Einheit im Ergebnisstand.
  assert.equal("noWorkReason" in r.lauf, false, "eine Kette mit Arbeit traegt keinen Grund ohne Arbeit (Issue #744)");
  assert.deepEqual(r.abschluss, ["regulaer"]);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.plan.id, plaene[0].id);
  assert.equal(einheit.stufen.plan.korrekturrunden, 0);
  assert.equal(einheit.stufen.review.marker, true);
  assert.equal(einheit.kostenUsd, 4, "vier Sessions zu je 1 $");
  assert.equal(einheit.kostenUnbekannt, 0);
  assert.equal(r.lauf.kostenSumme, 4);
  assert.deepEqual(einheit.stufen.pakete.ids, ["3", "4"]);
  assert.deepEqual(einheit.stufen.pakete.nichtZuordenbar, ["5"], "die fremde Karte gehoert zu keinem Paket");

  // Die Sessions liefen im Worktree — nicht in der Hauptkopie — und KIT_AGENT_MODEL war gesetzt.
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
  for (const s of r.sitzungen) {
    assert.ok(basename(s.cwd).startsWith(`${r.worktreePraefix}1-`), `${s.stufe} lief nicht im Worktree: ${s.cwd}`);
    assert.equal(s.modell, "claude-opus-5", "KIT_AGENT_MODEL fehlt in der Session");
  }
  assert.ok(r.gitAufrufe.some((a) => a.args[0] === "worktree" && a.args[1] === "remove"), "der Worktree wurde nicht abgebaut");
  assert.ok(!readdirSync(tmpdir()).some((n) => n.startsWith(r.worktreePraefix)), "der Worktree liegt noch");
  assert.match(r.ausgabe, /Nacht-Kette beendet: 1 fertig, 0 unvollstaendig, 0 angehalten, 0 abgebrochen/);
});

test("[night-19] ein Issue in In progress haelt die Kette nicht auf — sie laeuft neben der Umsetzungsnacht", async () => {
  const inArbeit = { id: "9", title: "Ein Paket in Arbeit", status: "in_progress", body: "## Kontext\n\nAutor-Modell: x\n\n## Abhaengigkeiten\n\nKeine.\n" };
  const r = await ketteImProzess({ karten: [fachplanKarte("1"), inArbeit], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(r.lauf.einheiten.find((e) => e.id === "1").ausgang, "fertig");
  assert.equal(r.karte("9").status, "in_progress", "die Kette fasst das Paket in Arbeit nicht an");
});

// Testhinweise der Formpruefung (Issue #1033, Plan #1029 A10): Was nach der Planungssitzung an
// Hinweisen stehen bleibt, schreibt der Runner als Kommentar an den Plan. Hinweise aendern `ok`
// nicht: Die Kette laeuft weiter, ohne Korrekturrunde. Welche Hinweise die Formpruefung findet,
// belegen die Tests des Board-Werkzeugs; hier liefert die Attrappe sie.

const NAV = "src/app/nav/side-nav.ts";
const NAV_SPEC = "src/app/nav/side-nav.spec.ts";
const TESTHINWEIS = { baustein: NAV, test: NAV_SPEC, meldung: `${NAV_SPEC} gehört zu ${NAV} und erwartet nichts oberhalb des Fusses.` };
const SCHREIBWEISE = { art: "schreibweise", nummer: 724, stelle: "Nicht #724: erlaeutert nur.", meldung: "Nummer #724 steht ausserhalb einer Verweiszeile und zaehlt als Abhaengigkeit." };

/** Die Kommentare einer Karte mit dem Anker der Testhinweise. */
const testhinweise = (r, id) => r.karte(id).comments.map((c) => c.body).filter((k) => k.includes(TESTHINWEIS_ANKER));

test("[night-19] bleibt ein Testhinweis stehen, laeuft die Kette weiter und der Plan traegt genau einen Kommentar", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")], sitzung: GLATT,
    formPruefung: formNachAbschnitten({ hinweise: (karte) => (/^\[Plan\]/.test(karte.title) ? [TESTHINWEIS] : []) }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.plan.korrekturrunden, 0, "ein Hinweis startet keine Korrekturrunde");
  assert.deepEqual(r.sitzungen.map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);

  const [kommentar, ...mehr] = testhinweise(r, einheit.stufen.plan.id);
  assert.equal(mehr.length, 0, "genau ein Kommentar mit dem Anker am Plan");
  assert.match(kommentar, new RegExp(`^${TESTHINWEIS_ANKER}$`, "m"), "der Anker steht auf einer eigenen Zeile");
  const zeilen = kommentar.split("\n").filter((z) => z.includes(" gehört "));
  assert.equal(zeilen.length, 1, "eine Zeile je Hinweis");
  assert.ok(zeilen[0].includes(NAV) && zeilen[0].includes(NAV_SPEC), zeilen[0]);
  for (const id of einheit.stufen.pakete.ids) {
    assert.deepEqual(testhinweise(r, id), [], `Paket #${id} traegt einen Testhinweis-Kommentar`);
  }
});

test("[night-19] ohne Testhinweis bekommt der Plan keinen Kommentar mit dem Anker", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.deepEqual(testhinweise(r, einheit.stufen.plan.id), []);
});

// Abhaengigkeits-Hinweise der Pakete (Issue #1059, Plan #1057 E4): `issue check-form` liefert
// auch bei Paketen einen Schluessel `hinweise`, aber mit Eintraegen ohne `baustein` und `test`.
// Die Formstufe vermerkt nur echte Testhinweise.
test("[night-19] ein Abhaengigkeits-Hinweis erzeugt keinen Testhinweis-Kommentar, ein echter Testhinweis am Plan weiterhin", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(planBody().replace("- src/plan.mjs: eine Funktion.", `- ${NAV}: der Fuss wandert nach oben.`)), review: reviewMarker, pakete: paketeAnlegen }),
    formPruefung: formNachAbschnitten({ hinweise: (karte) => (/^\[Plan\]/.test(karte.title) ? [TESTHINWEIS, SCHREIBWEISE] : [SCHREIBWEISE]) }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  for (const id of einheit.stufen.pakete.ids) {
    assert.deepEqual(testhinweise(r, id), [], `Paket #${id} traegt einen Testhinweis-Kommentar`);
  }
  const [kommentar, ...mehr] = testhinweise(r, einheit.stufen.plan.id);
  assert.equal(mehr.length, 0, "der echte Testhinweis steht weiterhin genau einmal am Plan");
  assert.ok(kommentar.includes(NAV_SPEC), kommentar);
  assert.ok(!kommentar.includes(SCHREIBWEISE.meldung), "der Abhaengigkeits-Hinweis gehoert nicht in den Kommentar");
});
