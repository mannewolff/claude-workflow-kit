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
  hasStageMarker,
  hatKlaerenLabel,
  hatGueltigenVerzicht,
  selectReviewCandidates,
  parseDeps,
  trackerProbeId,
  parseVorflugBefund,
  normalisiereVorflug,
  neueKommentare,
  bodyVorschlagVorhanden,
} from "../kit/night.mjs";

const KONTEXT = (...zeilen) => ["## Kontext", "", ...zeilen, "", "## Aufgabe", "", "Text."].join("\n");

// ============================================================
// Leere und fehlende Bodies
// ============================================================

test("die Marker-Pruefungen halten einen fehlenden Body aus", () => {
  for (const body of [null, undefined, ""]) {
    assert.equal(hasReviewMarker(body), false, `hasReviewMarker('${body}') haette false ergeben muessen`);
    assert.equal(hasStageMarker(body, "issue"), false);
    assert.equal(hatGueltigenVerzicht(body), false);
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

test("eine kaputte Pruefzeile macht das Issue ungueltig, nicht frei", () => {
  const f = reviewFreigabe(KONTEXT("Pruefung: 7"));
  assert.equal(f.frei, false);
  assert.equal(f.art, "ungueltig");
  assert.match(f.detail, /Erlaubt: 1, 2, 3 oder Verzicht/, "die Ursache steht nicht im Detail");
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
// selectReviewCandidates ohne Eingabe
// ============================================================

test("selectReviewCandidates haelt eine fehlende Kartenliste aus", () => {
  for (const issues of [null, undefined, []]) {
    assert.deepEqual(selectReviewCandidates(issues), { kandidaten: [], uebersprungen: [] });
  }
});

test("selectReviewCandidates: eine Karte ohne Label faellt beim Label-Filter heraus", () => {
  const r = selectReviewCandidates([{ id: "1", title: "Paket", body: "" }], { label: "kit:nightreview" });
  assert.deepEqual(r.kandidaten, []);
  assert.equal(r.uebersprungen[0].grund, "kein Label 'kit:nightreview'");
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

// ============================================================
// bodyVorschlagVorhanden: leere Eingaben und die Rundenlogik
// ============================================================

test("bodyVorschlagVorhanden ohne Kommentare ist false", () => {
  for (const k of [null, undefined, []]) {
    assert.equal(bodyVorschlagVorhanden(k), false);
  }
});

test("bodyVorschlagVorhanden verlangt Text unter der Ueberschrift", () => {
  assert.equal(bodyVorschlagVorhanden(["## Body-Vorschlag, Runde 1"]), false,
    "eine Ueberschrift ohne Text ist kein uebernehmbarer Vorschlag");
  assert.equal(bodyVorschlagVorhanden(["## Body-Vorschlag, Runde 1\n\nDer neue Body."]), true);
});

test("bodyVorschlagVorhanden verlangt den Vorschlag zur HOECHSTEN Runde", () => {
  const kommentare = [
    "## Issue-Review, Runde 1\n\nBefunde.",
    "## Body-Vorschlag, Runde 1\n\nAlter Vorschlag.",
    "## Issue-Review, Runde 2\n\nNeue Befunde.",
  ];
  assert.equal(bodyVorschlagVorhanden(kommentare), false,
    "der Vorschlag zur letzten Runde fehlt — Runde 1 traegt sie nicht");

  assert.equal(bodyVorschlagVorhanden([...kommentare, "## Body-Vorschlag, Runde 2\n\nNeuer Vorschlag."]), true);
});

test("die Praefix-Pruefungen halten eine Karte ohne Titel aus", () => {
  // Ein Titel kann fehlen: Der lokale Tracker liest ihn aus dem Frontmatter, und eine
  // von Hand angelegte Datei hat ihn nicht zwingend. Ohne Titel ist die Karte ein
  // gewoehnliches Arbeitspaket — kein [Fachlich], keine [Idee], kein [Plan].
  const r = selectReviewCandidates([{ id: "1", body: KONTEXT("Autor-Modell: m") }]);
  assert.deepEqual(r.uebersprungen, [], "eine Karte ohne Titel wurde faelschlich aussortiert");
  assert.equal(r.kandidaten.length, 1);

  // Und in den oberen Stufen faellt sie heraus, weil das Praefix fehlt — mit Grund.
  const fachlich = selectReviewCandidates([{ id: "1", body: "" }], { stufe: "fachlich" });
  assert.equal(fachlich.uebersprungen[0].grund, "kein fachliches Issue ([Fachlich])");
  const plan = selectReviewCandidates([{ id: "1", body: "" }], { stufe: "plan" });
  assert.equal(plan.uebersprungen[0].grund, "kein Plan-Dokument ([Plan])");
});
