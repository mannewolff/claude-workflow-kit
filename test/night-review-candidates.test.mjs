// Auswahl der Review-Kandidaten fuer den Nacht-Review (Issue #232).
//
// Reine Funktion, importiert aus kit/night.mjs — kein Board, kein Dateisystem, keine
// Session. Moeglich wurde das erst durch den main()-Umbau derselben Aufgabe: Vorher
// lag das Hauptprogramm auf Top-Level, ein Import haette einen Nachtlauf gestartet.
//
// Bewusst die billige erste Stufe: Label und Titel-Praefix stehen im Ergebnis von
// `issue list`. Der Review-Marker steht im BODY und braucht ein `issue get` pro
// Issue — den prueft die Schleife spaeter, wo der Body ohnehin vorliegt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { selectReviewCandidates } from "../kit/night.mjs";

const LABEL = "kit:nightreview";

function issue(id, title, labels = [LABEL]) {
  return { id: String(id), title, labels };
}

test("selectReviewCandidates: leere Eingabe liefert leere Listen", () => {
  const r = selectReviewCandidates([], { label: LABEL });
  assert.deepEqual(r.kandidaten, []);
  assert.deepEqual(r.uebersprungen, []);
});

test("selectReviewCandidates: label null laesst alles durch", () => {
  const issues = [issue(1, "Eins", []), issue(2, "Zwei", ["fremd"])];
  const r = selectReviewCandidates(issues, { label: null });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["1", "2"]);
  assert.deepEqual(r.uebersprungen, []);
});

test("selectReviewCandidates: ohne passendes Label wird uebersprungen", () => {
  const issues = [issue(1, "Mit", [LABEL]), issue(2, "Ohne", ["andres"])];
  const r = selectReviewCandidates(issues, { label: LABEL });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["1"]);
  assert.equal(r.uebersprungen.length, 1);
  assert.equal(r.uebersprungen[0].id, "2");
  assert.match(r.uebersprungen[0].grund, /kit:nightreview/);
});

test("selectReviewCandidates: [Fachlich] und [Idee] werden uebersprungen", () => {
  const issues = [
    issue(1, "Technisch"),
    issue(2, "[Fachlich] Eine Story"),
    issue(3, "[Idee] Ein Einfall"),
  ];
  const r = selectReviewCandidates(issues, { label: LABEL });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["1"]);
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["2", "3"]);
  assert.match(r.uebersprungen[0].grund, /fachlich/i);
  assert.match(r.uebersprungen[1].grund, /idee/i);
});

test("selectReviewCandidates: [Plan] wird uebersprungen, mit [Plan] im Grund", () => {
  // Das passende Label ist noetig: Ohne es greift der Label-Filter zuerst und der
  // Grund lautete "kein Label" — der Test pruefte dann am Plan-Gate vorbei (#276).
  const r = selectReviewCandidates([{ id: "1", title: "[Plan] Beispiel", labels: [LABEL] }], { label: LABEL });
  assert.deepEqual(r.kandidaten, []);
  assert.equal(r.uebersprungen.length, 1);
  assert.match(r.uebersprungen[0].grund, /\[Plan\]/);
});

test("selectReviewCandidates: die Praefixe greifen unabhaengig von Schreibweise und Leerraum", () => {
  const issues = [
    issue(1, "[FACHLICH] Gross"),
    issue(2, "  [idee] mit Leerraum davor"),
    issue(3, "[Fachlich]Ohne Leerzeichen dahinter"),
    issue(4, "[Plan] Ein Weg"),
    issue(5, "  [PLAN]Gross, Leerraum davor, keiner dahinter"),
  ];
  const r = selectReviewCandidates(issues, { label: LABEL });
  assert.deepEqual(r.kandidaten, []);
  assert.equal(r.uebersprungen.length, 5);
});

test("selectReviewCandidates: ein Praefix mitten im Titel zaehlt nicht", () => {
  // Nur der Anfang entscheidet — sonst faellt ein Issue heraus, das ueber ein
  // fachliches Issue oder ein Plandokument nur SPRICHT.
  const issues = [issue(1, "Doku: [Fachlich]-Issues beschreiben"), issue(2, "Doku zu [Plan]-Issues")];
  const r = selectReviewCandidates(issues, { label: LABEL });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["1", "2"]);
});

test("selectReviewCandidates: ein fehlendes labels-Feld stuerzt nicht ab", () => {
  const ohneFeld = { id: "1", title: "Kein labels-Feld" };
  assert.deepEqual(selectReviewCandidates([ohneFeld], { label: null }).kandidaten.length, 1);
  const r = selectReviewCandidates([ohneFeld], { label: LABEL });
  assert.deepEqual(r.kandidaten, []);
  assert.equal(r.uebersprungen.length, 1);
});

test("selectReviewCandidates: die Eingabereihenfolge bleibt erhalten", () => {
  // Die Board-Reihenfolge ist die Steuerung — nicht numerisch umsortieren.
  const issues = [issue(9, "Neun"), issue(3, "Drei"), issue(7, "Sieben")];
  const r = selectReviewCandidates(issues, { label: LABEL });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["9", "3", "7"]);
});

test("selectReviewCandidates: jeder uebersprungene Eintrag traegt id, title und Grund", () => {
  const issues = [issue(2, "[Idee] Ein Einfall"), issue(4, "Ohne Label", [])];
  const r = selectReviewCandidates(issues, { label: LABEL });
  for (const u of r.uebersprungen) {
    assert.ok(u.id, "id fehlt");
    assert.ok(u.title, "title fehlt");
    assert.ok(u.grund && u.grund.trim().length > 0, "grund fehlt oder ist leer");
  }
});

test("selectReviewCandidates: fehlende opts sind kein Fehler", () => {
  const issues = [issue(1, "Eins", [])];
  assert.equal(selectReviewCandidates(issues).kandidaten.length, 1);
  assert.equal(selectReviewCandidates(issues, {}).kandidaten.length, 1);
});

// --- Praefix-Erkennung (Issue #279) ---------------------------------------
//
// Die Stufenwahl im Skill haengt an genau dieser Erkennung. Sie ist Bestands-
// verhalten, war aber nie festgenagelt: Bis Issue #279 gab es keinen Test, der
// Gross-/Kleinschreibung, fuehrenden Leerraum, ein fehlendes Leerzeichen nach `]`
// und ein Praefix MITTEN im Titel gegeneinander abgrenzt. Faellt eine dieser
// Formen bei einer Umformulierung heraus, waehlt der Skill still die falsche Stufe.
test("selectReviewCandidates: Praefix-Erkennung ist tolerant, aber nicht beliebig", () => {
  const issues = [
    { id: "1", title: "[FACHLICH] Grossgeschrieben", body: "" },
    { id: "2", title: "  [plan] Fuehrender Leerraum", body: "" },
    { id: "3", title: "[Plan]Ohne Leerzeichen", body: "" },
    { id: "4", title: "Text ueber [Plan] mitten drin", body: "" },
    { id: "5", title: "[Idee] Rohe Idee", body: "" },
    { id: "6", title: "Ein normales Arbeitspaket", body: "" },
  ];
  const { kandidaten, uebersprungen } = selectReviewCandidates(issues);
  const ids = (liste) => liste.map((x) => String(x.id)).sort();

  // 1, 2, 3 tragen ein echtes Praefix und 5 ist die Idee -> alle vier raus.
  assert.deepEqual(ids(uebersprungen), ["1", "2", "3", "5"],
    "tolerante Formen und [Idee] muessen erkannt werden");
  // 4 hat das Praefix nur im Fliesstext, 6 gar keines -> beide sind Arbeitspakete.
  assert.deepEqual(ids(kandidaten), ["4", "6"],
    "ein Praefix mitten im Titel darf nicht zaehlen");
});
