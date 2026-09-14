// Die Rueckfaelle der reinen Funktionen im Nacht-Runner (Issue #405).
//
// Der Runner liest Karten, die er nicht selbst erzeugt hat: aus vier Trackern, mit
// jeweils eigenen Luecken. Ein Body kann fehlen, ein Kommentarfeld auch, eine
// Vorflug-Meldung kann halb sein. Was die Bestandstests pruefen, ist der
// vollstaendige Fall — was hier steht, ist der andere.
//
// Das ist der Unterschied zwischen "aussortiert" und "gecrasht": Der Nacht-Runner
// laeuft unbeaufsichtigt, und ein `undefined.length` um drei Uhr morgens kostet die
// ganze Nacht.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasReviewMarker,
  reviewFreigabe,
  hatKlaerenLabel,
  parseDeps,
  trackerProbeId,
  parseVorflugBefund,
  normalisiereVorflug,
  neueKommentare,
} from "../kit/night.mjs";

const KONTEXT = (...zeilen) => ["## Kontext", "", ...zeilen, "", "## Aufgabe", "", "Text."].join("\n");

// ============================================================
// Leere und fehlende Bodies
// ============================================================

test("die Marker-Pruefungen halten einen fehlenden Body aus", () => {
  for (const body of [null, undefined, ""]) {
    assert.equal(hasReviewMarker(body), false, `hasReviewMarker('${body}') haette false ergeben muessen`);
    assert.deepEqual(parseDeps(body), []);
  }
});

test("ohne Body ist ein Issue ungeprueft, nicht frei", () => {
  // Der gefaehrliche Fehlschluss waere andersherum: Ein leerer Body ohne Marker
  // duerfte nie als freigegeben gelten, sonst laeuft ein ungepruefte Ticket durch.
  for (const body of [null, undefined, ""]) {
    const f = reviewFreigabe(body);
    assert.equal(f.frei, false, `ein Body '${body}' haette nicht frei sein duerfen`);
    assert.equal(f.art, "ungeprueft");
  }
});

test("[night-16] eine Pruefzeile — kaputt oder nicht — aendert am Gate nichts mehr", () => {
  for (const zeile of ["Pruefung: 7", "Pruefung: Verzicht", "Pruefung: 2"]) {
    assert.deepEqual(reviewFreigabe(KONTEXT(zeile)), { frei: false, art: "ungeprueft" }, zeile);
  }
});

test("der Review-Marker schlaegt eine kaputte Pruefzeile", () => {
  // Ein geprueftes Issue soll an einem Formfehler nicht haengenbleiben — das waere
  // strenger als das Bestandsverhalten und stuende in keinem Verhaeltnis zum Anlass.
  const f = reviewFreigabe(KONTEXT("Pruefung: 7", "Issue-Review: fable (2026-08-31)"));
  assert.equal(f.frei, true);
  assert.equal(f.art, "marker");
});

test("hatKlaerenLabel haelt eine Karte ohne Label-Feld aus", () => {
  assert.equal(hatKlaerenLabel({ id: "1" }), false);
  assert.equal(hatKlaerenLabel({ id: "1", labels: null }), false);
  assert.equal(hatKlaerenLabel({ id: "1", labels: ["kit:klaeren"] }), true);
});

// ============================================================
// trackerProbeId: die Reihenfolge der beiden Quellen
// ============================================================

test("trackerProbeId nimmt den ersten Kandidaten, sonst das erste Issue, sonst nichts", () => {
  assert.equal(trackerProbeId([{ id: 7 }], [{ id: 9 }]), "7", "der Kandidat hat Vorrang");
  assert.equal(trackerProbeId([], [{ id: 9 }]), "9", "ohne Kandidaten gilt die Gesamtliste");
  assert.equal(trackerProbeId(null, [{ id: 9 }]), "9");
  assert.equal(trackerProbeId([], []), null, "ohne jedes Issue gibt es nichts zu holen");
  assert.equal(trackerProbeId(null, null), null);
});

// ============================================================
// Der Vorflug-Befund: halbe und kaputte Meldungen
// ============================================================

const befundBlock = (obj) => `Prosa davor\n<<<VORFLUG\n${JSON.stringify(obj)}\nVORFLUG>>>\nProsa danach`;

test("parseVorflugBefund liefert null, wo kein auswertbarer Block steht", () => {
  assert.equal(parseVorflugBefund(), null, "ohne Argument darf es nicht werfen");
  assert.equal(parseVorflugBefund(""), null);
  assert.equal(parseVorflugBefund("Ich habe alles geprueft, alles gut."), null);
  assert.equal(parseVorflugBefund("<<<VORFLUG\n{}"), null, "ein Block ohne Ende ist keiner");
  assert.equal(parseVorflugBefund("<<<VORFLUG\nkein JSON\nVORFLUG>>>"), null);
  assert.equal(parseVorflugBefund(befundBlock("nur ein String")), null,
    "ein JSON-Wert, der kein Objekt ist, taugt nicht als Befund");
});

test("parseVorflugBefund nimmt den LETZTEN Block", () => {
  const text = `${befundBlock({ runde: 1 })}\n${befundBlock({ runde: 2 })}`;
  assert.deepEqual(parseVorflugBefund(text), { runde: 2 },
    "erklaert das Modell erst und meldet dann, gilt die Meldung");
});

test("normalisiereVorflug: Schweigen zaehlt nie als Zustimmung", () => {
  const reviewers = [
    { name: "opus", kind: "claude" },
    { name: "codex", kind: "command" },
    { name: "fremd", kind: "command" },
  ];
  const b = normalisiereVorflug({ reviewers: [{ name: "codex", verfuegbar: true }] }, reviewers);

  const nach = Object.fromEntries(b.reviewers.map((r) => [r.name, r]));
  assert.equal(nach.opus.verfuegbar, true, "ein claude-Reviewer gilt mit der Antwort als belegt");
  assert.equal(nach.codex.verfuegbar, true);
  assert.equal(nach.fremd.verfuegbar, false, "zu 'fremd' kam nichts — das ist kein Ja");
  assert.match(nach.fremd.grund, /nichts gemeldet/);
});

test("normalisiereVorflug haelt eine leere Meldung und eine leere Liste aus", () => {
  assert.deepEqual(normalisiereVorflug(null, null).reviewers, []);
  assert.deepEqual(normalisiereVorflug(undefined, []).reviewers, []);
  // Ein Eintrag ohne Namen in der Meldung wird uebergangen, statt die Map zu kippen.
  const b = normalisiereVorflug({ reviewers: [{ verfuegbar: true }, null] }, [{ name: "codex", kind: "command" }]);
  assert.equal(b.reviewers[0].verfuegbar, false);
});

test("normalisiereVorflug: ein 'nicht verfuegbar' ohne Grund bekommt einen", () => {
  const b = normalisiereVorflug(
    { reviewers: [{ name: "codex", verfuegbar: false }] },
    [{ name: "codex", kind: "command" }],
  );
  assert.equal(b.reviewers[0].verfuegbar, false);
  assert.match(b.reviewers[0].grund, /ohne Grund als nicht verfuegbar gemeldet/,
    "ein leerer Grund waere im Protokoll eine Leerstelle");
});

// ============================================================
// neueKommentare: zwei Speicherformen, eine Antwort
// ============================================================

test("neueKommentare liefert nur das, was in dieser Session dazukam", () => {
  const vorher = { comments: [{ body: "alt" }] };
  const nachher = { comments: [{ body: "alt" }, { body: "neu" }] };
  assert.deepEqual(neueKommentare(vorher, nachher), ["neu"]);
});

test("neueKommentare haelt fehlende Felder auf beiden Seiten aus", () => {
  assert.deepEqual(neueKommentare(null, null), [], "ohne beide Seiten gibt es nichts");
  assert.deepEqual(neueKommentare({}, { comments: [{ body: "neu" }] }), ["neu"],
    "fehlt die Vorher-Liste, ist alles neu");
  assert.deepEqual(neueKommentare({ comments: [] }, {}), [],
    "fehlt die Nachher-Liste, kam nichts dazu");
  assert.deepEqual(neueKommentare({ comments: [] }, { comments: [{}] }), [""],
    "ein Kommentar ohne Body wird zum leeren Text, nicht zu 'undefined'");
});

test("neueKommentare zerlegt den angehaengten Block des lokalen Trackers", () => {
  const alt = "## Kontext\n\nText.\n";
  const anhang = "\n\n---\n**Kommentar** (2026-08-31)\n\nErster\n\n---\n**Kommentar** (2026-08-31)\n\nZweiter";
  assert.deepEqual(neueKommentare({ body: alt }, { body: alt + anhang }), ["Erster", "Zweiter"]);
});

test("neueKommentare wertet einen GEAENDERTEN Body nicht als Kommentar", () => {
  // Kein Praefix heisst: Der Body selbst wurde umgeschrieben. Dann ist der Anhang
  // nicht mehr sauber abzugrenzen — und ein falsch gelesener "Kommentar" wuerde das
  // Gate faelschlich fuer erfuellt halten.
  assert.deepEqual(neueKommentare({ body: "alt" }, { body: "voellig anders" }), []);
  assert.deepEqual(neueKommentare({ body: "alt" }, { body: "alt" }), [], "ohne Zuwachs kam nichts dazu");
});

