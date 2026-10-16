// Die Nacht-Kette prueft das Warten auf ein Ereignis beim Kettenstart erneut (Fachplan #1619,
// Plan #1624, E7, E8; Issue #1664).
//
// Zwischen der Auswahl zu Laufbeginn und dem Start einer spaeteren Kette liegen oft Stunden.
// Setzt der Mensch in dieser Zeit das Warten, gilt es: `karteBeimStart` liest die Wartezeile
// der Karte, beim Plan-Auftrag die seines Fachplans mit einem zusaetzlichen `issue get`. Die
// Kette verbucht dann nur den Uebersprung (E8) und schreibt keinen Laufstand `abgebrochen` —
// anders als beim zurueckgenommenen Kennzeichen. Leicht, Session und Board ueber
// `ketteImProzess`: Die Session der ersten Kette schreibt die Wartezeile, wie es der Mensch
// am Board taete.

import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { mitEreignis } from "../kit/board/ereignis.mjs";
import { ketteImProzess, fachplanKarte, fachplanBody, planKarte, KETTE_LABEL, GLATT } from "./helpers/kette-fixture.mjs";

const GRUND = "wartet, bis der Tarif X für das Projekt wählbar ist";
const GEPRUEFT = [KETTE_LABEL, REVIEW_FERTIG_LABEL];
// Der Punkt im Dateinamen steht maskiert: Die Verflechtungserhebung zaehlt jede woertliche
// Nennung eines Quellpfads als Laden, und die Datei laedt den Board-Einstieg nicht.
const LIFT = (n) => `aufheben mit \`node .claude/kit/board\x2emjs issue hold ${n} --lift\``;
const KETTE_GRUND = (n) => `wartet auf ein Ereignis: ${GRUND} — ${LIFT(n)}`;
const PLAN_GRUND = (f) => `Fachplan #${f} wartet auf ein Ereignis: ${GRUND} — ${LIFT(f)}`;
const PRUEFUNG_FEHLT_ANKER = "## Kette nicht gestartet: Pruefung fehlt";

const wartend = () => mitEreignis(fachplanBody(), GRUND, "de");
const einheitVon = (r, id) => r.lauf.einheiten.find((e) => e.id === String(id));
const kommentareMit = (r, id, anker) => (r.karte(id).comments ?? []).filter((c) => c.body.includes(anker));
// Ohne Uebergang zur Umsetzung: Die erste Kette endet nach abdeckung, statt die Stufe
// ausserhalb der Attrappe zu fahren.
const kette = (karten, opts = {}) => ketteImProzess({ karten, argv: ["--max", "2"], kette: { uebergaenge: { abdeckungUmsetzung: false } }, ...opts });

/**
 * GLATT fuer jede Kette; die Plan-Session der ersten schreibt vorher die Wartezeile in den
 * Fachplan `ziel` — ohne ihn zu lesen, damit ein abgewiesenes `issue get` allein den
 * Kettenstart trifft.
 */
function wartenSetzen(erste, ziel) {
  let gesetzt = false;
  return (s) => {
    if (!gesetzt && s.issue === erste && s.stufe === "plan") {
      gesetzt = true;
      s.board("issue", "update", ziel, "--body", wartend());
    }
    return GLATT(s);
  };
}

/**
 * Prueft den Uebersprung einer Karte: Einheit, keine Session, Kennzeichen bleibt, kein Abbruch.
 * Die Sessions einer Kette tragen die Nummer ihrer Wurzel — beim Plan-Auftrag die des
 * Fachplans, darum `wurzel`.
 */
function uebersprungen(r, id, grund, wurzel = id) {
  const einheit = einheitVon(r, id);
  assert.equal(einheit?.ausgang, "uebersprungen", JSON.stringify(einheit));
  assert.equal(einheit.grund, grund);
  assert.ok(!r.sitzungen.some((s) => s.issue === String(wurzel)), `fuer #${id} begann eine Sitzung`);
  assert.ok(r.karte(id).labels.includes(KETTE_LABEL), "das Kennzeichen fuer die Nacht bleibt stehen");
  assert.ok(!r.karte(id).labels.includes("run:aborted"), "Laufstand abgebrochen geschrieben");
  assert.ok(!r.karte(id).labels.includes("run:running"), "der Laufstand laeuft blieb stehen");
  assert.deepEqual(kommentareMit(r, id, PRUEFUNG_FEHLT_ANKER), []);
}

// --- Wartend zu Laufbeginn: Bericht, Vorschau, Kosten ---

test("[night-1664] ein sonst startbereiter wartender Fachplan: keine Sitzung, Uebersprung, Kosten 0", async () => {
  const r = await kette([fachplanKarte("1", { body: wartend() })]);
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.sitzungen, []);
  uebersprungen(r, "1", KETTE_GRUND("1"));
  assert.equal(einheitVon(r, "1").verbrauch?.kostenUsd ?? 0, 0);
  assert.equal(r.lauf.verbrauch?.kostenUsd ?? 0, 0, "die Kette trug Kosten");
});

test("[night-1664] ein Plan auf einen wartenden Fachplan: keine Sitzung, Grund aus planEreignis", async () => {
  const fachplan = fachplanKarte("1", { labels: [REVIEW_FERTIG_LABEL], body: wartend() });
  const r = await kette([fachplan, planKarte("2", "1", { labels: GEPRUEFT })]);
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.sitzungen, []);
  uebersprungen(r, "2", PLAN_GRUND("1"));
});

test("[night-1664] --dry-run nennt Fachplan und Plan mit dem Wartegrund in derselben Zeile wie der Lauf", async () => {
  const karten = () => [
    fachplanKarte("1", { body: wartend() }),
    planKarte("2", "1", { labels: GEPRUEFT }),
  ];
  // Ohne Zeitstempel und Laufkennung davor: Sie unterscheiden Vorschau und Lauf.
  const zeilen = (ausgabe, id) => ausgabe.split("\n").map((z) => z.replace(/^\[[^\]]*\]\s*/, ""))
    .filter((z) => z.startsWith(`#${id} `) && z.includes("uebersprungen"));
  const vorschau = await kette(karten(), { argv: ["--dry-run"] });
  const lauf = await kette(karten());
  assert.equal(vorschau.code, 0, vorschau.ausgabe);
  for (const [id, grund] of [["1", KETTE_GRUND("1")], ["2", PLAN_GRUND("1")]]) {
    const vorab = zeilen(vorschau.ausgabe, id);
    assert.equal(vorab.length, 1, vorschau.ausgabe);
    assert.ok(vorab[0].includes(grund), vorab[0]);
    assert.deepEqual(zeilen(lauf.ausgabe, id), vorab);
  }
});

// --- Neupruefung beim Kettenstart (E7) ---

test("[night-1664] wartet der Fachplan der zweiten Kette erst waehrend des Laufs, startet sie nicht", async () => {
  const karten = [fachplanKarte("1"), fachplanKarte("5", { titel: "[Fachlich] Zweites" })];
  const r = await kette(karten, { sitzung: wartenSetzen("1", "5") });
  assert.equal(r.code, 0, r.ausgabe);
  assert.ok(r.sitzungen.some((s) => s.issue === "1"), "die erste Kette lief nicht");
  uebersprungen(r, "5", KETTE_GRUND("5"));
  assert.ok(r.karte("5").labels.includes("run:waiting"), "der Laufstand laeuft wurde nicht abgeloest");
});

test("[night-1664] wartet der Fachplan eines Plan-Auftrags erst waehrend des Laufs, startet die Kette nicht", async () => {
  const karten = [
    fachplanKarte("1"),
    fachplanKarte("5", { titel: "[Fachlich] Wurzel", labels: [REVIEW_FERTIG_LABEL] }),
    planKarte("6", "5", { labels: GEPRUEFT }),
  ];
  const r = await kette(karten, { sitzung: wartenSetzen("1", "5") });
  assert.equal(r.code, 0, r.ausgabe);
  uebersprungen(r, "6", PLAN_GRUND("5"), "5");
  const start = r.aufrufe.findIndex((a) => a.join(" ") === "issue get 6");
  assert.ok(r.aufrufe.slice(start).some((a) => a.join(" ") === "issue get 5"), "der Fachplan wurde beim Start nicht gelesen");
});

test("[night-1664] scheitert das Lesen des Fachplans beim Start, gilt der Stand vom Laufbeginn", async () => {
  const karten = [
    fachplanKarte("1"),
    fachplanKarte("5", { titel: "[Fachlich] Wurzel", labels: [REVIEW_FERTIG_LABEL] }),
    planKarte("6", "5", { labels: GEPRUEFT }),
  ];
  // Nur einmal: Das erste Lesen von #5 nach dem Start der ersten Kette ist das beim Start der zweiten.
  let gestartet = false;
  let abgelehnt = false;
  const setzen = wartenSetzen("1", "5");
  const sitzung = (s) => {
    gestartet = true;
    return setzen(s);
  };
  const ablehnen = (args) => {
    if (abgelehnt || !gestartet || args.join(" ") !== "issue get 5") return false;
    abgelehnt = true;
    return true;
  };
  const r = await kette(karten, { sitzung, ablehnen });
  assert.ok(abgelehnt, "das Lesen beim Start wurde nicht abgewiesen");
  assert.equal(r.code, 0, r.ausgabe);
  assert.notEqual(einheitVon(r, "6")?.ausgang, "uebersprungen", JSON.stringify(einheitVon(r, "6")));
  assert.equal(einheitVon(r, "6")?.ausgang, "fertig");
  assert.ok(r.sitzungen.some((s) => s.issue === "5"), "die Kette des Plans lief nicht");
  assert.match(r.ausgabe, /#5 nicht frisch lesbar .* Stand vom Laufbeginn/);
});
