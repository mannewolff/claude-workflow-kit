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

// --- Verzicht in der Auswahl (Issue #304) ---------------------------------
//
// Ein Dokument mit bewusstem Verzicht traegt nie einen Marker. Ohne einen eigenen
// Ausschluss geriete es deshalb in JEDEN Review-Lauf erneut — und weil die Session
// den Verzicht kommentiert statt zu pruefen, verbuchte der Runner das Ergebnis als
// "Review mit Befund". Eine verfallene Vorgabe schliesst dagegen NICHT aus: Sie ist
// ueberholt, damit gilt wieder der Regelfall.

const KONTEXT = (zeilen) => `## Kontext\n\nAutor-Modell: claude-opus-5\n${zeilen}\n\n## Aufgabe\n\nEtwas tun.\n`;

test("selectReviewCandidates: gueltiger Verzicht schliesst das Dokument aus", () => {
  const issues = [
    { id: "1", title: "Mit bewusster Freigabe", labels: [LABEL], body: KONTEXT("Pruefung: Verzicht") },
    { id: "2", title: "Ohne Vorgabe", labels: [LABEL], body: KONTEXT("") },
  ];
  const r = selectReviewCandidates(issues, { label: LABEL });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["2"]);
  assert.equal(r.uebersprungen.length, 1);
  assert.equal(r.uebersprungen[0].id, "1");
  assert.match(r.uebersprungen[0].grund, /verzicht/i);
});

test("selectReviewCandidates: eine verfallene Vorgabe schliesst nicht aus", () => {
  const issues = [{
    id: "1", title: "Nach der Freigabe geaendert", labels: [LABEL],
    body: KONTEXT(`Pruefung: Verzicht\nPruefung-Stand: ${"b".repeat(64)}`),
  }];
  const r = selectReviewCandidates(issues, { label: LABEL });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["1"]);
  assert.deepEqual(r.uebersprungen, []);
});

test("selectReviewCandidates: eine Stufenvorgabe ist kein Verzicht", () => {
  // `Pruefung: 2` sagt "pruefe mit zwei Runden", nicht "pruefe nicht".
  const issues = [{ id: "1", title: "Mit Stufenvorgabe", labels: [LABEL], body: KONTEXT("Pruefung: 2") }];
  assert.deepEqual(selectReviewCandidates(issues, { label: LABEL }).kandidaten.map((i) => i.id), ["1"]);
});

test("selectReviewCandidates: eine kaputte Vorgabe wirft nicht und bleibt Kandidat", () => {
  // Die Auswahl ist eine reine Funktion und darf an einem Tippfehler nicht scheitern.
  // Im Review laesst sich die Zeile reparieren — vor dem Review auszuschliessen waere
  // das Gegenteil dessen, was der Lauf soll.
  const issues = [{ id: "1", title: "Mit Tippfehler", labels: [LABEL], body: KONTEXT("Pruefung: vielleicht") }];
  assert.deepEqual(selectReviewCandidates(issues, { label: LABEL }).kandidaten.map((i) => i.id), ["1"]);
});

test("selectReviewCandidates: ein fehlendes body-Feld stuerzt nicht ab", () => {
  // `issue list` liefert den Body bei allen Trackern mit; fehlt er doch einmal,
  // gilt das als "keine Vorgabe" und nicht als Ausschluss.
  const r = selectReviewCandidates([{ id: "1", title: "Ohne body-Feld", labels: [LABEL] }], { label: LABEL });
  assert.deepEqual(r.kandidaten.map((i) => i.id), ["1"]);
});
