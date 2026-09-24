// Die beiden Proben, an denen der Runner einen startbereiten Plan erkennt
// (Fachplan #883, Plan #890; Issue #893).
//
// Hier stehen die reinen Funktionen: `fachlicheQuelleVon` liest die fachliche Wurzel
// aus dem Body eines Plandokuments, `planAusschluss` sagt, warum ein gekennzeichneter
// Plan nicht laeuft. Verdrahtet sind sie seit Issue #895 — was `waehleKettenKandidaten`
// daraus macht, steht in `night-kette-planauftrag.test.mjs` und
// `night-kette-kollision.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fachlicheQuelleVon, planAusschluss, waehleKettenKandidaten,
  pruefungFehltGrund, UNGEPRUEFT_PRAEFIX, REVIEW_FERTIG_LABEL, KLAEREN_LABEL,
} from "../kit/night.mjs";

/** Ein Plandokument, das jede Probe besteht — einzelne Felder ueberschreibbar. */
function plan(over = {}) {
  return {
    id: "890",
    title: "[Plan] Ein fertiger Plan",
    status: "backlog",
    labels: ["kit:night", REVIEW_FERTIG_LABEL],
    body: "Fachliche Quelle: Issue #883\n\n## Offene Fragen\n\n- Keine.\n",
    ...over,
  };
}

/** Die Kartenliste des Boards, wie `issue list` sie liefert. */
const KARTEN = [{ id: "883", title: "[Fachlich] Die Wurzel", status: "backlog" }];

// --- fachlicheQuelleVon ---

test("[night-893] fachlicheQuelleVon liest die Nummer aus der Herkunftszeile", () => {
  assert.equal(fachlicheQuelleVon("Autor-Modell: x\nFachliche Quelle: Issue #883\n\n## Ziel\n"), "883");
});

test("[night-893] fachlicheQuelleVon liefert null ohne Herkunftszeile", () => {
  assert.equal(fachlicheQuelleVon("## Ziel\n\nEin Plan ohne Herkunft.\n"), null);
  assert.equal(fachlicheQuelleVon(""), null);
});

test("[night-893] fachlicheQuelleVon liefert null, wenn hinter der Nummer noch Text steht", () => {
  assert.equal(fachlicheQuelleVon("Fachliche Quelle: Issue #883 (ueberholt)\n"), null);
});

test("[night-893] fachlicheQuelleVon liefert null, wenn die Zeile nicht am Zeilenanfang steht", () => {
  assert.equal(fachlicheQuelleVon("Siehe dazu Fachliche Quelle: Issue #883\n"), null);
});

test("[night-893] fachlicheQuelleVon normalisiert fuehrende Nullen nicht", () => {
  assert.equal(fachlicheQuelleVon("Fachliche Quelle: Issue #0883\n"), "0883");
});

// --- planAusschluss: der gruene Fall ---

test("[night-893] ein gepruefter Plan in Backlog mit erkennbarer Herkunft laeuft", () => {
  assert.equal(planAusschluss(plan(), "kit:night", KARTEN), null);
});

// --- planAusschluss: die sieben Gruende, in der Reihenfolge aus E6 ---

test("[night-893] ein Plan ausserhalb von Backlog nennt seine Spalte", () => {
  assert.equal(planAusschluss(plan({ status: "ready" }), "kit:night", KARTEN), "steht in ready, nicht in Backlog");
});

test("[night-893] ohne Herkunftszeile ist die fachliche Wurzel nicht erkennbar", () => {
  const grund = planAusschluss(plan({ body: "## Offene Fragen\n\n- Keine.\n" }), "kit:night", KARTEN);
  assert.match(grund, /^die fachliche Herkunft ist nicht erkennbar/);
  assert.match(grund, /'Fachliche Quelle: Issue #N'/);
});

test("[night-893] eine Herkunftszeile auf eine Nummer ausserhalb des Boards zaehlt nicht", () => {
  const grund = planAusschluss(plan({ body: "Fachliche Quelle: Issue #999\n\n## Offene Fragen\n\n- Keine.\n" }), "kit:night", KARTEN);
  assert.match(grund, /^die fachliche Herkunft ist nicht erkennbar/);
});

test("[night-893] die Nummer wird zeichengleich verglichen — #1 trifft die Karte 0001 nicht", () => {
  const karten = [{ id: "0001", title: "[Fachlich] Lokaler Tracker", status: "backlog" }];
  const p = plan({ body: "Fachliche Quelle: Issue #1\n\n## Offene Fragen\n\n- Keine.\n" });
  const grund = planAusschluss(p, "kit:night", karten);
  assert.match(grund, /^die fachliche Herkunft ist nicht erkennbar/);
  assert.match(grund, /fuehrende Nullen zaehlen mit/);
  const passend = plan({ body: "Fachliche Quelle: Issue #0001\n\n## Offene Fragen\n\n- Keine.\n" });
  assert.equal(planAusschluss(passend, "kit:night", karten), null, "zeichengleich geschrieben traegt dieselbe Karte");
});

test("[night-893] kit:klaeren am Plan haelt ihn auf und nennt den Weg", () => {
  const grund = planAusschluss(plan({ labels: ["kit:night", REVIEW_FERTIG_LABEL, KLAEREN_LABEL] }), "kit:night", KARTEN);
  assert.match(grund, new RegExp(`^traegt ${KLAEREN_LABEL}`));
  assert.match(grund, /Plan/);
  assert.match(grund, /Label/);
});

test("[night-893] eine offene Frage im Plan nennt die Frage und wohin die Entscheidung gehoert", () => {
  const p = plan({ body: "Fachliche Quelle: Issue #883\n\n## Offene Fragen\n\n- Welcher Adapter zuerst?\n" });
  const grund = planAusschluss(p, "kit:night", KARTEN);
  assert.match(grund, /^eine Entscheidung wartet: /);
  assert.match(grund, /Welcher Adapter zuerst\?/);
  assert.match(grund, /## Architektonische Entscheidungen/);
  assert.match(grund, /'- Keine\.'/);
  assert.match(grund, /ein Satz in der fachlichen Anforderung genuegt nicht/);
});

test("[night-893] ein fehlender Abschnitt Offene Fragen zaehlt als wartende Entscheidung", () => {
  const p = plan({ body: "Fachliche Quelle: Issue #883\n\n## Ziel\n\nEtwas.\n" });
  assert.match(planAusschluss(p, "kit:night", KARTEN), /^eine Entscheidung wartet: kein Abschnitt ## Offene Fragen/);
});

test("[night-893] ohne review:fertig traegt der Plan den unveraenderten Pruefungsgrund", () => {
  const p = plan({ id: "890", labels: ["kit:night"] });
  const grund = planAusschluss(p, "kit:night", KARTEN);
  assert.equal(grund, pruefungFehltGrund("890", "kit:night").text);
  assert.ok(grund.startsWith(UNGEPRUEFT_PRAEFIX));
});

test("[night-893] der Pruefungsgrund nennt das Kettenlabel aus der Config", () => {
  const grund = planAusschluss(plan({ labels: ["kit:eigenes"] }), "kit:eigenes", KARTEN);
  assert.match(grund, /das Label kit:eigenes bleibt dran/);
  assert.ok(!grund.includes("kit:night"));
});

// --- planAusschluss: die Reihenfolge ---

test("[night-893] treffen mehrere Gruende zu, gewinnt der spezifischere", () => {
  // Alle vier hinteren Gruende zugleich: fehlende Herkunft schlaegt kit:klaeren,
  // kit:klaeren schlaegt die offene Frage, die offene Frage schlaegt die Pruefung.
  const ohneAlles = plan({ labels: [KLAEREN_LABEL], body: "## Offene Fragen\n\n- Was denn?\n" });
  assert.match(planAusschluss(ohneAlles, "kit:night", KARTEN), /^die fachliche Herkunft ist nicht erkennbar/);

  const mitHerkunft = plan({ labels: [KLAEREN_LABEL], body: "Fachliche Quelle: Issue #883\n\n## Offene Fragen\n\n- Was denn?\n" });
  assert.match(planAusschluss(mitHerkunft, "kit:night", KARTEN), new RegExp(`^traegt ${KLAEREN_LABEL}`));

  const ohneKlaeren = plan({ labels: [], body: "Fachliche Quelle: Issue #883\n\n## Offene Fragen\n\n- Was denn?\n" });
  assert.match(planAusschluss(ohneKlaeren, "kit:night", KARTEN), /^eine Entscheidung wartet: /);

  const ausserhalb = plan({ status: "in_review", labels: [KLAEREN_LABEL], body: "## Offene Fragen\n\n- Was denn?\n" });
  assert.equal(planAusschluss(ausserhalb, "kit:night", KARTEN), "steht in in_review, nicht in Backlog");
});

// --- Was die Auswahl daraus macht (Issue #895) ---

test("[night-895] waehleKettenKandidaten nimmt einen startbereiten Plan als Plan-Auftrag an", () => {
  const karten = [...KARTEN, plan({ id: "890" })];
  const r = waehleKettenKandidaten(karten, "kit:night", 5);
  assert.deepEqual(r.uebersprungen, []);
  assert.deepEqual(r.kandidaten.map((a) => [a.karte.id, a.art, a.F, a.planId]), [["890", "plan", "883", "890"]]);
});

test("[night-895] ein abgelehnter Plan geht mit dem Grund aus planAusschluss nach uebersprungen", () => {
  const abgelehnt = plan({ id: "890", status: "ready" });
  const r = waehleKettenKandidaten([...KARTEN, abgelehnt], "kit:night", 5);
  assert.deepEqual(r.kandidaten, []);
  assert.deepEqual(r.uebersprungen.map((u) => [u.id, u.grund]),
    [["890", planAusschluss(abgelehnt, "kit:night", KARTEN)]]);
});
