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
//
// Seit Issue #1233 laufen die Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6);
// keiner dieser Faelle braucht den Einstieg, darum gibt es zu dieser Datei keine Ablauf-Pruefung.
// Was der Mensch nach dem Hinweis am Board tut, geschieht hier an den Karten der Attrappe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KETTE_HALT_ANKER, REVIEW_FERTIG_LABEL, planAusschluss, stoppFragenGrund } from "../kit/night/kette.mjs";
import { KLAEREN_LABEL } from "../kit/night/wartend.mjs";
import {
  ketteImProzess, fachplanKarte, planKarte, jeStufe, planAnlegen, planBody, reviewMarker, paketeHalt,
} from "./helpers/kette-fixture.mjs";

const KETTEN_LABEL = "kit:night";
/** Die Kommentare einer Karte nach dem Lauf, als ein Text. */
const karteText = (r, id) => r.karte(id).comments.map((c) => c.body).join("\n");

/** Der Halt-Kommentar einer Karte — der Text ab dem Anker. */
function haltKommentar(r, id) {
  const text = karteText(r, id);
  const i = text.indexOf(KETTE_HALT_ANKER);
  assert.ok(i >= 0, `#${id} traegt keinen Halt-Kommentar`);
  return text.slice(i);
}

/** Eine Fachplan-Kette, deren Plan mit einer Stopp-Frage entsteht. */
const mitStoppFrage = () => ketteImProzess({
  karten: [fachplanKarte("1")],
  sitzung: jeStufe({
    plan: planAnlegen(planBody({ offeneFragen: "- Ist der neue Endpunkt eine Schnittstelle nach aussen?" })),
    review: reviewMarker,
  }),
});

test("[night-896] eine Fachplan-Kette haelt an der gekennzeichneten Karte an — der fachlichen Anforderung", async () => {
  const r = await mitStoppFrage();
  assert.equal(r.code, 0, r.ausgabe);

  assert.ok(r.karte("1").labels.includes(KLAEREN_LABEL), `${KLAEREN_LABEL} fehlt an #1`);
  const kommentar = haltKommentar(r, "1");
  assert.match(kommentar, /Ist der neue Endpunkt eine Schnittstelle nach aussen\?/);
  // Der Plan ist der Ort der Entscheidung, nicht der Adressat des Kommentars.
  assert.match(kommentar, /Plan #2\b/);
  assert.ok(!karteText(r, "2").includes(KETTE_HALT_ANKER), "der Halt gehoert an die gekennzeichnete Karte, nicht an den Plan");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "1").ausgang, "angehalten");
});

test("[night-896] eine Plan-Kette haelt am Plan an, die fachliche Anforderung bleibt unberuehrt", async () => {
  const r = await ketteImProzess({
    karten: [
      fachplanKarte("1", { titel: "[Fachlich] Die Wurzel", labels: [REVIEW_FERTIG_LABEL] }),
      planKarte("2", "1", { labels: [KETTEN_LABEL, REVIEW_FERTIG_LABEL] }),
    ],
    sitzung: jeStufe({ pakete: paketeHalt }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  assert.ok(r.karte("2").labels.includes(KLAEREN_LABEL), `${KLAEREN_LABEL} fehlt am Plan #2`);
  const kommentar = haltKommentar(r, "2");
  assert.match(kommentar, /Stufe pakete, Dokument #2\b/);
  assert.match(kommentar, /Kein Eingang für \/issues/);
  // Die Anforderung traegt weder Label noch Kommentar: Sie hat das Kennzeichen nicht getragen.
  assert.ok(!r.karte("1").labels.includes(KLAEREN_LABEL), `${KLAEREN_LABEL} darf nicht an #1 haengen`);
  assert.ok(!karteText(r, "1").includes(KETTE_HALT_ANKER), "der Halt-Kommentar darf nicht an #1 stehen");
  // Ein Plan, der seine Pruefung schon hinter sich hat, wird nicht erneut geschickt.
  assert.doesNotMatch(kommentar, /\/issue-review/, "der Plan-Auftrag braucht den Pruefschritt nicht");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "2").ausgang, "angehalten");
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

test("[night-896] wer dem Hinweis wortgetreu folgt, hinterlaesst einen Plan, den planAusschluss annimmt", async () => {
  const r = await mitStoppFrage();
  assert.equal(r.code, 0, r.ausgabe);

  const anweisung = anweisungAus(haltKommentar(r, "1"));
  const M = anweisung.planId;
  const plan = r.karte(M);
  const fach = r.karte("1");
  // Gegenprobe zuerst: Vor der Bearbeitung lehnt der Runner den Plan ab.
  assert.ok(planAusschluss(structuredClone(plan), KETTEN_LABEL, structuredClone(r.karten)) !== null);

  // Schritt fuer Schritt, genau wie der Hinweis es sagt.
  let body = plan.body;
  body = abschnittErgaenzen(body, anweisung.entscheidungen, "- A2 — Der Endpunkt bleibt intern, weil ihn niemand sonst ruft.");
  body = abschnittSetzen(body, anweisung.fragen, anweisung.sollwert);
  plan.body = body;
  if (anweisung.pruefen) plan.labels.push(REVIEW_FERTIG_LABEL);
  plan.labels = plan.labels.filter((l) => l !== KLAEREN_LABEL);
  fach.labels = fach.labels.filter((l) => l !== KLAEREN_LABEL);
  plan.labels.push(KETTEN_LABEL);

  assert.equal(stoppFragenGrund(plan.body), null, "die Antwort darf nicht als offene Frage gelesen werden");
  assert.equal(planAusschluss(structuredClone(plan), KETTEN_LABEL, structuredClone(r.karten)), null,
    "der Plan wird trotz befolgtem Hinweis abgelehnt");
});
