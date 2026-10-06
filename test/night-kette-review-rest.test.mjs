// Der Rest einer abgebrochenen Review-Stufe (Issue #654).
//
// Bricht die Review-Session ab, nachdem sie ihre Befunde schon an den Plan geschrieben
// hat, bleibt der teuerste Zustand zurueck: Die Pruefung ist bezahlt, die Befunde stehen
// am Board, der Body ist unveraendert und traegt keinen `Plan-Review:`-Marker. Wer das
// Dokument spaeter sichtet, sieht ein ungeprueftes und prueft erneut. Der Vermerk macht
// genau diesen Zustand am Dokument selbst sichtbar — ohne den Ausgang zu aendern.
//
// Seit Issue #1233 laufen diese Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6).
// Der Abbruch am Zeitbudget einer haengenden Session braucht die echte Uhr und steht in
// `ablauf-night-kette-review-rest.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, reviewMarker, paketeAnlegen,
} from "./helpers/kette-fixture.mjs";
import { REVIEW_REST_ANKER } from "../kit/night/kette.mjs";
import { WARTEND_ANKER } from "../kit/night/wartend.mjs";

/** Ein Ereignis im Strom der Session: Sie kam zustande, ein Exit ungleich 0 danach ist kein Fehlstart (Issue #1088, E13). */
const EREIGNIS = JSON.stringify({ type: "system", subtype: "init" });

/** Die Session kam zustande und endete dann mit Exit 3, ohne result-Ereignis. */
const EXIT_3 = { zeilen: [EREIGNIS], ohneResult: true, ende: 3 };

/** Stufe review: haengt die Befunde als Kommentar an den Plan aus dem Prompt. */
function befunde(s) {
  const id = /^\/issue-review #(\d+)/.exec(s.prompt)[1];
  s.board("issue", "comment", id, "--text", "Fund 1 (opus, WICHTIG): Kriterium 3 ist im Weg nicht abgebildet.");
}

/** Body und Kommentare einer Karte als ein Text, wie die Datei des lokalen Trackers. */
const kartenText = (r, id) => [r.karte(id).body, ...r.karte(id).comments.map((c) => c.body)].join("\n\n");

/** Der Plan des Laufs und sein Text. */
function plan(r) {
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  const id = einheit.stufen.plan.id;
  return { einheit, id, text: kartenText(r, id) };
}

/** Wie oft der Anker im Dokument steht. */
function anker(text) {
  return text.split(REVIEW_REST_ANKER).length - 1;
}

test("[night-19] bricht die Review-Stufe ohne neuen Kommentar ab, bleibt der Plan ohne Vermerk", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: () => EXIT_3 }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, text } = plan(r);
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /technischer Fehler: die Session der Stufe review endete mit Exit 3/);
  assert.equal(anker(text), 0, "ohne Befunde gibt es nichts zu retten");
  assert.doesNotMatch(r.ausgabe, new RegExp(REVIEW_REST_ANKER));
});

test("[night-19] traegt der Plan beim Abbruch schon den Marker, bleibt er ohne Vermerk", async () => {
  // Die Review-Session hat den Marker gesetzt: Die Einarbeitung war durch, der Abbruch
  // traf sie danach. Seit Issue #1086 (Plan #1079 E9) ist der Marker das Ergebnis der
  // Stufe — sie gilt als fertig, und die Kette laeuft weiter.
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({
      plan: planAnlegen(),
      review: (s) => { reviewMarker(s); befunde(s); return EXIT_3; },
      pakete: paketeAnlegen,
    }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, text } = plan(r);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.equal(einheit.stufen.review.vorgefunden, true);
  assert.match(r.ausgabe, /Stufe review: abgebrochen \(technischer Fehler: die Session der Stufe review endete mit Exit 3\), das Ergebnis liegt aber vor/);
  assert.ok(/^[ \t]*Plan-Review:[ \t]*\S/m.test(text), "der Marker steht im Body");
  assert.equal(anker(text), 0, "mit Marker ist die Einarbeitung durch");
  assert.doesNotMatch(r.ausgabe, new RegExp(REVIEW_REST_ANKER));
});

// Ein Schlusstext, der nach Warten klingt, und ein Ergebnis, das vorliegt (Issue #1207).
//
// Der Lauf 2026-10-05-121520 hielt die Kette in der Stufe review an, obwohl die Session
// fertig war: Der Marker stand neu im Plan, nur der Schlusstext beschrieb ein "Warten auf
// eine Bedingung". Das Ergebnis ist ein Beleg, der Schlusstext nur ein Indiz.

/** Ein Schlusstext, der die Musterliste trifft ("laeuft noch"). */
const WARTE_TEXT = "Das Review ist eingearbeitet, die Formpruefung laeuft noch im Hintergrund.";

test("[night-57] eine Review-Session, die den Marker neu setzt, laeuft trotz wartendem Schlusstext in die Stufe pakete", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({
      plan: planAnlegen(),
      review: (s) => { reviewMarker(s); return { ergebnis: WARTE_TEXT }; },
      pakete: paketeAnlegen,
    }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, text } = plan(r);
  assert.ok(r.sitzungen.map((s) => s.stufe).includes("pakete"), `die Kette lief nicht in die Stufe pakete: ${JSON.stringify(einheit)}`);
  assert.ok(!("wartendBeendet" in einheit), `das Feld steht da, obwohl das Ergebnis vorliegt: ${JSON.stringify(einheit)}`);
  assert.ok(!text.includes(WARTEND_ANKER), `trotz Ergebnis ein Vermerk am Plan:\n${text}`);
  assert.ok(!kartenText(r, "1").includes(WARTEND_ANKER), "trotz Ergebnis ein Vermerk am Fachplan");
  assert.match(r.ausgabe, /Stufe review: Schlusstext klang nach Warten, das Ergebnis liegt aber vor/);
});

test("[night-57] eine Review-Session ohne neuen Marker bricht mit wartendem Schlusstext weiter ab", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: () => ({ ergebnis: WARTE_TEXT }), pakete: paketeAnlegen }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, text } = plan(r);
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /selbst angestossene Arbeit gewartet/);
  assert.equal(einheit.wartendBeendet, true);
  assert.ok(!r.sitzungen.map((s) => s.stufe).includes("pakete"), "die Kette lief trotz wartender Sitzung weiter");
  assert.ok(text.includes(WARTEND_ANKER), `der Vermerk fehlt am Plan:\n${text}`);
});
