// Die Sperre der Nacht-Kette gegen ungepruefte Fachplaene (Fachplan #702, Plan #716; Issue #718).
//
// `--kette` nimmt eine fachliche Anforderung nur auf, wenn sie neben dem Kettenlabel
// auch `review:fertig` traegt. Die Sperre sitzt in `kettenAusschluss` hinter
// `kit:klaeren` und wirkt dadurch in Lauf und Vorschau gleichermassen: Beide gehen
// durch dieselbe `waehleKettenKandidaten`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waehleKettenKandidaten, pruefungFehltGrund, UNGEPRUEFT_PRAEFIX, REVIEW_FERTIG_LABEL, KETTE_UNGEPRUEFT_ANKER } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, KETTE_LABEL } from "./helpers/kette-fixture.mjs";

// Die Laeufe unten fahren `laufeKette` im selben Prozess (Issue #1233): Board, Uhr und
// Vorflug sind Attrappen, die Karten stehen in einer Liste.

const GEPRUEFT = (id, titel = "[Fachlich] Geprueft") => fachplanKarte(id, { titel });
const UNGEPRUEFT = (id, titel = "[Fachlich] Ungeprueft") => fachplanKarte(id, { titel, labels: [KETTE_LABEL] });

/** Die Kommentare einer Karte nach dem Lauf, als Texte. */
const kommentare = (r, id) => r.karte(id).comments.map((c) => c.body);

/** Wie oft der Anker des Hinweis-Kommentars an der Karte steht. */
const ankerZaehlen = (r, id) => kommentare(r, id).filter((k) => k.includes(KETTE_UNGEPRUEFT_ANKER)).length;

test("[night-19] ohne review:fertig geht der Fachplan mit Grund und naechstem Schritt in uebersprungen", () => {
  const karten = [
    { id: "1", title: "[Fachlich] Geprueft", status: "backlog", labels: ["kit:night", REVIEW_FERTIG_LABEL] },
    { id: "2", title: "[Fachlich] Ungeprueft", status: "backlog", labels: ["kit:night"] },
  ];
  const r = waehleKettenKandidaten(karten, "kit:night", 5);
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["1"], "die gepruefte Karte laeuft, die ungepruefte nicht");
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["2"]);
  const grund = r.uebersprungen[0].grund;
  assert.ok(grund.startsWith(UNGEPRUEFT_PRAEFIX), `der Grund beginnt nicht mit dem festen Praefix: ${grund}`);
  assert.match(grund, /\/issue-review #2 pruefen lassen/);
  assert.match(grund, /das setzt review:fertig/);
  assert.match(grund, /das Label kit:night bleibt dran/);
});

test("[night-19] der Grundtext trennt festes Praefix und Schritt-Teil", () => {
  const g = pruefungFehltGrund("0007", "kit:eigenes");
  assert.equal(g.praefix, UNGEPRUEFT_PRAEFIX);
  assert.equal(g.praefix, "ungeprueft: Label 'review:fertig' fehlt");
  assert.match(g.schritt, /^mit \/issue-review #0007 pruefen lassen/);
  assert.ok(!g.schritt.includes(g.praefix), "der Schritt-Teil wiederholt das Praefix nicht");
  assert.ok(g.text.startsWith(g.praefix) && g.text.includes(g.schritt), "der Text setzt beide Teile zusammen");
});

test("[night-19] kit:klaeren gewinnt ueber die fehlende Pruefung — der spezifischere Grund bleibt", () => {
  const karten = [{ id: "3", title: "[Fachlich] Offene Frage", status: "backlog", labels: ["kit:night", "kit:klaeren"] }];
  const r = waehleKettenKandidaten(karten, "kit:night", 5);
  assert.equal(r.kandidaten.length, 0);
  assert.match(r.uebersprungen[0].grund, /^traegt kit:klaeren/);
  assert.ok(!r.uebersprungen[0].grund.startsWith(UNGEPRUEFT_PRAEFIX), "die Pruefsperre hat den Klaeren-Grund verdraengt");
});

test("[night-19] der Grundtext nennt das Kettenlabel aus der Config, nicht kit:night fest", () => {
  const karten = [{ id: "4", title: "[Fachlich] Ungeprueft", status: "backlog", labels: ["kit:eigenes"] }];
  const r = waehleKettenKandidaten(karten, "kit:eigenes", 5);
  const grund = r.uebersprungen[0].grund;
  assert.match(grund, /das Label kit:eigenes bleibt dran/);
  assert.ok(!grund.includes("kit:night"), `der feste Name kit:night steht im Grundtext: ${grund}`);
});

test("[night-19] der Dry-Run zeigt die Ablehnung mit Grund und naechstem Schritt vorab", async () => {
  const r = await ketteImProzess({ karten: [GEPRUEFT("1"), UNGEPRUEFT("2")], argv: ["--dry-run"] });
  assert.equal(r.code, 0);
  assert.match(r.ausgabe, /#1 \[Fachlich\] Geprueft -> Kette 1/);
  assert.match(r.ausgabe, /#2 .*-> uebersprungen \(ungeprueft: Label 'review:fertig' fehlt/);
  assert.match(r.ausgabe, /\/issue-review #2 pruefen lassen/);
  assert.match(r.ausgabe, /das Label kit:night bleibt dran/);
  assert.match(r.ausgabe, /Dry-Run beendet: 1 Kette\(n\) wuerden laufen/);
});

test("[night-19] im Lauf behaelt die ungepruefte Karte ihr Kettenlabel und steht mit Grund im Ergebnisstand", async () => {
  const r = await ketteImProzess({ karten: [UNGEPRUEFT("3")] });
  assert.equal(r.code, 0);
  assert.match(r.ausgabe, /Keine Kette zu fahren/);
  const karte = r.karte("3");
  assert.ok(karte.labels.includes(KETTE_LABEL), "das Kettenlabel ist verbraucht, obwohl keine Kette lief");
  assert.ok(!karte.labels.includes(REVIEW_FERTIG_LABEL), "die Karte war ungeprueft");
  const einheit = r.lauf.einheiten.find((e) => e.id === "3");
  assert.equal(einheit.ausgang, "uebersprungen");
  assert.ok(einheit.grund.startsWith(UNGEPRUEFT_PRAEFIX), `der Ergebnisstand nennt den Grund nicht: ${einheit.grund}`);
  assert.deepEqual(r.abschluss, ["regulaer"]);
  assert.deepEqual(r.sitzungen, [], "ohne Kandidaten startet keine Session");
});

// Der Lauf-Kopf vermerkt den Grund, statt ihn nur zu protokollieren (Issue #744), und
// seit Issue #885 benennt der Satz den Fall: Die Karte dieser Lage traegt das
// Kettenlabel, geht aber ungeprueft ueber `kettenAusschluss` nach `uebersprungen` —
// also der Fall `ketteAlleUebersprungen`, nicht das fehlende Label.
test("[night-44] eine Kette ohne Kandidaten vermerkt den Fall der uebersprungenen Karten als noWorkReason", async () => {
  const r = await ketteImProzess({ karten: [UNGEPRUEFT("1")] });
  assert.equal(r.code, 0);
  assert.equal(
    r.lauf.noWorkReason,
    "Keine Kette zu fahren: alle 1 gekennzeichneten Karten mit dem Label 'kit:night' wurden uebersprungen, "
    + "weil eine Voraussetzung fehlt.",
  );
});

// --- Der Kommentar an der abgelehnten Anforderung und der Hinweis auf das
//     unbekannte Kennzeichen (Fachplan #702, Kriterien 4 und 8; Issue #719) ---

test("[night-42] die abgelehnte Anforderung bekommt einmal den Kommentar mit Anker, Grund und Schritt", async () => {
  const r = await ketteImProzess({ karten: [UNGEPRUEFT("7")] });
  assert.equal(r.code, 0);
  assert.equal(ankerZaehlen(r, "7"), 1, "der Hinweis-Kommentar steht nicht genau einmal an der Karte");
  const text = kommentare(r, "7").join("\n");
  assert.match(text, /\/issue-review #7 pruefen lassen/);
  assert.match(text, /das setzt review:fertig/);
  assert.match(text, /das Label kit:night bleibt dran/);
  assert.match(r.ausgabe, /#7: Hinweis-Kommentar geschrieben/);
});

test("[night-42] ein zweiter Lauf schreibt den Kommentar nicht noch einmal", async () => {
  const erster = await ketteImProzess({ karten: [UNGEPRUEFT("7")] });
  assert.equal(erster.code, 0);
  const r = await ketteImProzess({ karten: structuredClone(erster.karten) });
  assert.equal(r.code, 0);
  assert.equal(ankerZaehlen(r, "7"), 1, "der Folgelauf hat einen zweiten Kommentar geschrieben");
  assert.match(r.ausgabe, /steht schon am Board/);
});

test("[night-42] der Dry-Run zeigt die Ablehnung und schreibt keinen Kommentar", async () => {
  const r = await ketteImProzess({ karten: [UNGEPRUEFT("7")], argv: ["--dry-run"] });
  assert.equal(r.code, 0);
  assert.match(r.ausgabe, new RegExp(`#7 .*-> uebersprungen \\(${UNGEPRUEFT_PRAEFIX}`));
  assert.equal(ankerZaehlen(r, "7"), 0, "der Dry-Run hat am Board geschrieben");
  assert.ok(!r.aufrufe.some((a) => a[1] === "comment" || a[1] === "stand"), "der Dry-Run schreibt nichts ans Board");
});

test("[night-42] ein fehlgeschlagener Board-Aufruf wird protokolliert und bricht den Lauf nicht ab", async () => {
  const r = await ketteImProzess({
    karten: [UNGEPRUEFT("7")],
    ablehnen: (a) => a[1] === "comment" && a[2] === "7",
  });
  assert.equal(r.code, 0, "der Lauf ist am Board-Fehler gescheitert");
  assert.match(r.ausgabe, /#7: Hinweis-Kommentar nicht geschrieben/);
  assert.equal(ankerZaehlen(r, "7"), 0);
  assert.match(r.ausgabe, /Keine Kette zu fahren/);
});

test("[night-42] traegt keine Karte review:fertig, meldet der Lauf das unbekannte Kennzeichen", async () => {
  const r = await ketteImProzess({ karten: [UNGEPRUEFT("1")] });
  assert.equal(r.code, 0);
  assert.match(r.ausgabe, /keine Karte am Board traegt 'review:fertig'/);
  assert.match(r.ausgabe, /noch nicht angelegt/);
  assert.match(r.ausgabe, /\/issue-review/);
});

test("[night-42] der Hinweis erscheint auch in der Vorschau", async () => {
  const r = await ketteImProzess({ karten: [UNGEPRUEFT("1")], argv: ["--dry-run"] });
  assert.equal(r.code, 0);
  assert.match(r.ausgabe, /keine Karte am Board traegt 'review:fertig'/);
});

test("[night-42] der Hinweis bleibt aus, sobald eine Karte der Liste das Label traegt", async () => {
  const r = await ketteImProzess({
    karten: [UNGEPRUEFT("1"), fachplanKarte("2", { titel: "[Fachlich] Anderswo geprueft", labels: [REVIEW_FERTIG_LABEL] })],
  });
  assert.equal(r.code, 0);
  assert.ok(!/keine Karte am Board traegt/.test(r.ausgabe), `der Hinweis steht trotz vorhandenem Label:\n${r.ausgabe}`);
  assert.equal(ankerZaehlen(r, "1"), 1, "die Ablehnung selbst bleibt kommentiert");
});

test("[night-42] ohne Ablehnung wegen fehlender Pruefung bleibt der Hinweis aus", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1", { titel: "[Fachlich] Offene Frage", labels: [KETTE_LABEL, "kit:klaeren"] })],
  });
  assert.equal(r.code, 0);
  assert.match(r.ausgabe, /traegt kit:klaeren/);
  assert.ok(!/keine Karte am Board traegt/.test(r.ausgabe), `der Hinweis steht ohne Adressaten:\n${r.ausgabe}`);
  assert.equal(ankerZaehlen(r, "1"), 0, "die Karte mit kit:klaeren wurde faelschlich kommentiert");
});
