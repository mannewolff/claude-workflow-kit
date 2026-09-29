// Das Ergebnis einer Prueflauf-Session (Fachplan #899, Plan #904, Issue #907).
//
// Gelesen wird der UNTERSCHIED zwischen Vorher- und Nachher-Stand, nie der Nachher-Stand
// allein (E16): Eine erneut gepruefte Karte traegt Marker, `review:fertig` und den
// Befunde-Kommentar schon aus dem Vorlauf. Ohne die Beschraenkung auf neue Spuren meldete
// die Erkennung "geprueft" fuer eine Pruefung, die nie lief.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pruefLaufErgebnis,
  pruefLaufRestVermerken,
  WARTEND_ANKER,
  hatFachplanReviewMarker,
  FACHPLAN_REVIEW_ZEILE,
  PRUEFLAUF_REST_ANKER,
  PRUEFLAUF_BEFUNDE_ANKER,
  PRUEFLAUF_EINARBEITUNG_ANKER,
  REVIEW_REST_ANKER,
  REVIEW_FERTIG_LABEL,
  KLAEREN_LABEL,
} from "../kit/night.mjs";

const MARKER = "Fachplan-Review: opus (2026-09-24, Nachtlauf)";

/** Eine fachliche Karte mit Kommentar-Array, wie `issue get` sie liefert. */
const karte = (extra = {}) => ({
  id: "899",
  title: "[Fachlich] Eine Anforderung",
  body: "## Ziel\nAutor-Modell: claude-opus-5\n",
  labels: [],
  comments: [],
  ...extra,
});

/** Derselbe Stand mit angehaengten Kommentaren. */
const mitKommentaren = (basis, ...texte) => ({
  ...basis,
  comments: [...basis.comments, ...texte.map((t) => ({ body: t }))],
});

// --- Der Marker ---

test("[night-907] hatFachplanReviewMarker liest die Zeile 'Fachplan-Review:' mit Wert", () => {
  assert.equal(hatFachplanReviewMarker(`## Ziel\n${MARKER}\n`), true);
  assert.equal(hatFachplanReviewMarker("## Ziel\nAutor-Modell: claude-opus-5\n"), false);
  assert.equal(hatFachplanReviewMarker("Fachplan-Review:   \n"), false,
    "ein leerer Wert ist kein Marker");
  assert.equal(hatFachplanReviewMarker("  Fachplan-Review: opus\r\n"), true,
    "Einrueckung und CRLF stoeren nicht");
  assert.equal(hatFachplanReviewMarker(null), false);
});

test(String.raw`[night-907] FACHPLAN_REVIEW_ZEILE traegt kein fuehrendes \s* (SonarQube S8786)`, () => {
  assert.ok(!FACHPLAN_REVIEW_ZEILE.source.startsWith(String.raw`^\s*`),
    "der Ausdruck sieht nur die getrimmte Zeile, wie PLAN_REVIEW_ZEILE seit Issue #877");
});

// --- Ausgang geprueft ---

test("[night-907] Marker UND review:fertig im Nachher-Stand heisst geprueft", () => {
  const vorher = karte();
  const nachher = karte({ body: `## Ziel\n${MARKER}\n`, labels: [REVIEW_FERTIG_LABEL] });
  assert.equal(pruefLaufErgebnis(vorher, nachher).ausgang, "geprueft");
});

test("[night-907] Marker ohne Label und Label ohne Marker sind nicht geprueft", () => {
  const vorher = karte();
  const nurMarker = karte({ body: `## Ziel\n${MARKER}\n` });
  const nurLabel = karte({ labels: [REVIEW_FERTIG_LABEL] });
  assert.equal(pruefLaufErgebnis(vorher, nurMarker).ausgang, "unvollstaendig");
  assert.equal(pruefLaufErgebnis(vorher, nurLabel).ausgang, "unvollstaendig");
});

// --- Ausgang klaeren ---

test("[night-907] kit:klaeren heisst klaeren, mit der Frage aus dem letzten neuen Kommentar", () => {
  const vorher = mitKommentaren(karte(), "Eine alte Frage aus dem Vorlauf.");
  const nachher = mitKommentaren(
    { ...vorher, labels: [KLAEREN_LABEL] },
    `${PRUEFLAUF_BEFUNDE_ANKER}\n\nFund 1 (opus, WICHTIG): unklar.`,
    "Halt: Welche der beiden Zielgruppen gilt?",
  );
  const e = pruefLaufErgebnis(vorher, nachher);
  assert.equal(e.ausgang, "klaeren");
  assert.match(e.frage, /Welche der beiden Zielgruppen/);
  assert.ok(!e.frage.includes("alte Frage"),
    "die Frage kommt aus einem neuen Kommentar, nicht aus dem Vorlauf");
});

test("[night-907] kit:klaeren ohne neuen Kommentar nennt die Karte als Fundort", () => {
  const vorher = karte();
  const nachher = karte({ labels: [KLAEREN_LABEL] });
  const e = pruefLaufErgebnis(vorher, nachher);
  assert.equal(e.ausgang, "klaeren");
  assert.match(e.frage, /#899/);
});

test("[night-907] geprueft geht vor klaeren", () => {
  const vorher = karte();
  const nachher = karte({
    body: `## Ziel\n${MARKER}\n`,
    labels: [REVIEW_FERTIG_LABEL, KLAEREN_LABEL],
  });
  assert.equal(pruefLaufErgebnis(vorher, nachher).ausgang, "geprueft");
});

// --- Ausgang unvollstaendig: die drei Schritte ---

test("[night-907] ohne neue Spur ist der Schritt gestartet", () => {
  const e = pruefLaufErgebnis(karte(), karte());
  assert.deepEqual(e, { ausgang: "unvollstaendig", schritt: "gestartet" });
});

test("[night-907] ein neuer Befunde-Kommentar ist der Schritt befunde", () => {
  const vorher = karte();
  const nachher = mitKommentaren(vorher, `${PRUEFLAUF_BEFUNDE_ANKER}\n\nFund 1 (opus, WICHTIG): unklar.`);
  assert.equal(pruefLaufErgebnis(vorher, nachher).schritt, "befunde");
});

test("[night-907] ein neuer Einarbeitungs-Kommentar ist der Schritt eingearbeitet", () => {
  const vorher = karte();
  const nachher = mitKommentaren(
    vorher,
    `${PRUEFLAUF_BEFUNDE_ANKER}\n\nFund 1 (opus, WICHTIG): unklar.`,
    `${PRUEFLAUF_EINARBEITUNG_ANKER}\n\nuebernommen: Fund 1.`,
  );
  assert.equal(pruefLaufErgebnis(vorher, nachher).schritt, "eingearbeitet",
    "der weiteste erreichte Schritt zaehlt");
});

test("[night-907] E16: alte Spuren am Vorher-Stand machen keinen Schritt und kein geprueft", () => {
  // Die Karte kommt aus einem Vorlauf: Marker, Label und Befunde-Kommentar stehen schon
  // am Board. Der Lauf hat beides vor der Session abgeraeumt — hier steht der Fall, in dem
  // das Abraeumen ausbliebe. Die Session endet ohne jede neue Spur.
  const alt = mitKommentaren(
    karte({ body: `## Ziel\n${MARKER}\n`, labels: [] }),
    `${PRUEFLAUF_BEFUNDE_ANKER}\n\nFund 1 (opus, WICHTIG): aus dem Vorlauf.`,
  );
  const e = pruefLaufErgebnis(alt, alt);
  assert.equal(e.ausgang, "unvollstaendig", "kein geprueft ohne Label aus dieser Session");
  assert.equal(e.schritt, "gestartet", "der alte Befunde-Kommentar ist keine neue Spur");
});

test("[night-907] der Vorher-Stand wird nur fuer die Kommentare gelesen, nicht fuer Labels", () => {
  const vorher = karte({ labels: [REVIEW_FERTIG_LABEL, KLAEREN_LABEL] });
  const nachher = karte({ body: `## Ziel\n${MARKER}\n`, labels: [REVIEW_FERTIG_LABEL] });
  assert.equal(pruefLaufErgebnis(vorher, nachher).ausgang, "geprueft",
    "Labels zaehlen im Nachher-Stand, gleich was vorher dranstand");
});

test("[night-907] der lokale Tracker haengt Kommentare an den Body — auch dort zaehlt nur das Neue", () => {
  const anhang = (text) => `\n\n---\n**Kommentar** (2026-09-24)\n\n${text}`;
  const rumpf = "## Ziel\nAutor-Modell: claude-opus-5\n";
  const vorher = { id: "899", title: "[Fachlich] X", labels: [], body: rumpf + anhang(`${PRUEFLAUF_BEFUNDE_ANKER}\n\nalt`) };
  const gleich = { ...vorher };
  assert.equal(pruefLaufErgebnis(vorher, gleich).schritt, "gestartet");
  const nachher = { ...vorher, body: vorher.body + anhang(`${PRUEFLAUF_BEFUNDE_ANKER}\n\nneu`) };
  assert.equal(pruefLaufErgebnis(vorher, nachher).schritt, "befunde");
});

// --- Der Anker des Rest-Vermerks ---

test("[night-907] der Prueflauf hat einen eigenen Rest-Anker (E14)", () => {
  assert.equal(PRUEFLAUF_REST_ANKER, "## Pruefung unvollstaendig");
  assert.notEqual(PRUEFLAUF_REST_ANKER, REVIEW_REST_ANKER,
    "der Anker der Nacht-Kette spricht von Kette, Plan und Plan-Review-Marker");
});

test("[night-907] eine wartende Sitzung bekommt keinen zweiten Vermerk", () => {
  // Kein Board im Spiel: Der Vermerk unterbleibt, bevor irgendetwas geschrieben wird —
  // genau das prueft der Fall. Zwei Kommentare fuer einen Abbruch sagen nichts, was einer
  // nicht sagt.
  const nurWartend = [`${WARTEND_ANKER}\n\nDie Sitzung hat auf einen eigenen Lauf gewartet.`];
  assert.equal(pruefLaufRestVermerken("899", "Zeitbudget", "befunde", nurWartend), false);
  assert.equal(pruefLaufRestVermerken("899", "Zeitbudget", "gestartet", []), false,
    "ohne jede neue Spur gibt es nichts zu vermerken");
});
