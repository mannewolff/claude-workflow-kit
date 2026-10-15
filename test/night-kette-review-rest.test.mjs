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
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  ketteImProzess, fachplanKarte, formNachAbschnitten, jeStufe, planAnlegen, reviewMarker, paketeAnlegen, GLATT,
} from "./helpers/kette-fixture.mjs";
import { REVIEW_REST_ANKER, TESTHINWEIS_ANKER } from "../kit/night/kette.mjs";
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

// Ein Helfer schreibt die Vermerke der Kette und wirft nie (Issue #1698, Plan #1697 E12).
//
// `testhinweiseVermerken` und `reviewRestVermerken` gehen ueber `kommentarVermerken`: Datei
// unter `tmpdir()`, `issue comment --text-file`, Datei weg. Scheitert das Board, wirft der
// Helfer nicht; der Aufrufer protokolliert. Fuer den Review-Rest ist das neu — vorher warf
// `abh.board`, obwohl die Spur nur Hinweis ist.

/** Die Dateien des Helfers, die dieser Prozess unter `tmpdir()` liegen gelassen hat. */
const reste = (art) => readdirSync(tmpdir()).filter((n) => n.startsWith(`night-${art}-${process.pid}-`));

/** Ob der Board-Aufruf ein Kommentar ueber eine Datei ist, deren Text `anker` traegt. */
const dateiKommentarMit = (anker) => (args) =>
  args[0] === "issue" && args[1] === "comment" && args[3] === "--text-file" && readFileSync(args[4], "utf-8").includes(anker);

test("[night-19] scheiterndes Board beim Review-Rest wirft nicht und protokolliert reviewRestNicht", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: (s) => { befunde(s); return EXIT_3; } }),
    ablehnen: dateiKommentarMit(REVIEW_REST_ANKER),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, id, text } = plan(r);
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.match(einheit.grund, /technischer Fehler: die Session der Stufe review endete mit Exit 3/);
  assert.equal(anker(text), 0, "das Board hat den Vermerk abgewiesen");
  assert.ok(r.aufrufe.some((a) => a[1] === "comment" && a[3] === "--text-file"), "der Vermerk wurde versucht");
  assert.match(r.ausgabe, new RegExp(`Vermerk '${REVIEW_REST_ANKER}' an Plan #${id} nicht geschrieben`));
  assert.doesNotMatch(r.ausgabe, new RegExp(`Vermerk '${REVIEW_REST_ANKER}' an Plan #${id} geschrieben`));
  assert.deepEqual(reste("review-rest"), [], "die Datei unter tmpdir() ist weg");
});

test("[night-19] gelingt der Vermerk des Review-Rests, steht er am Plan und im Protokoll", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({ plan: planAnlegen(), review: (s) => { befunde(s); return EXIT_3; } }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, id, text } = plan(r);
  assert.equal(einheit.ausgang, "abgebrochen");
  assert.equal(anker(text), 1, `der Vermerk fehlt am Plan:\n${text}`);
  assert.match(text, new RegExp(`^${REVIEW_REST_ANKER}$`, "m"));
  assert.match(r.ausgabe, new RegExp(`Review #${id} abgebrochen, Befunde ohne Einarbeitung — Vermerk '${REVIEW_REST_ANKER}' an Plan #${id} geschrieben`));
  assert.deepEqual(reste("review-rest"), [], "die Datei unter tmpdir() ist weg");
});

/** Ein Testhinweis, den die Formpruefung am Plan stehen laesst. */
const TESTHINWEIS = { baustein: "src/nav.ts", test: "src/nav.spec.ts", meldung: "src/nav.spec.ts gehört zu src/nav.ts." };
const MIT_TESTHINWEIS = formNachAbschnitten({ hinweise: (karte) => (/^\[Plan\]/.test(karte.title) ? [TESTHINWEIS] : []) });

test("[night-19] die Testhinweise protokollieren ihren Erfolg wie bisher und raeumen die Datei", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: GLATT, formPruefung: MIT_TESTHINWEIS });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, id, text } = plan(r);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.ok(text.includes(TESTHINWEIS_ANKER), "der Kommentar steht am Plan");
  assert.match(r.ausgabe, new RegExp(`1 Testhinweis\\(e\\) als Kommentar '${TESTHINWEIS_ANKER}' an Plan #${id} geschrieben`));
  assert.deepEqual(reste("testhinweise"), [], "die Datei unter tmpdir() ist weg");
});

test("[night-19] scheitern die Testhinweise am Board, protokolliert die Kette und laeuft weiter", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")], sitzung: GLATT, formPruefung: MIT_TESTHINWEIS,
    ablehnen: dateiKommentarMit(TESTHINWEIS_ANKER),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const { einheit, id, text } = plan(r);
  assert.equal(einheit.ausgang, "fertig", einheit.grund);
  assert.ok(!text.includes(TESTHINWEIS_ANKER), "das Board hat den Kommentar abgewiesen");
  assert.match(r.ausgabe, new RegExp(`Testhinweise an Plan #${id} nicht geschrieben \\(Board-Attrappe: issue comment ${id} abgewiesen\\) — die Kette laeuft weiter`));
  assert.deepEqual(reste("testhinweise"), [], "die Datei unter tmpdir() ist weg");
});
