// Der Nachtbericht am Fachplan (Plan #638, A10; Issue #645).
//
// Jede Kette hinterlaesst bei jedem Ausgang genau einen Kommentar mit dem Anker
// `## Nachtbericht, Kette <stempel>`: Ausgang, Stufen, alle Entscheidungen der Nacht
// nummeriert, abgelehnte Befunde, Abdeckung, Kennzahlen, bei angehalten die Stopp-Frage
// und zum Schluss der Satz, dass der Bericht Verlauf ist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { berichtBauen, einarbeitungVon, kommentareVon, BERICHT_ANKER, BERICHT_SCHLUSS } from "../kit/night.mjs";
import {
  NUR_POSIX, run, mitProjekt, fachplan, umgebung, stand, planBody,
  PLAN_ANLEGEN, REVIEW_MARKER, REVIEW_HALT, PAKETE_ANLEGEN, EINARBEITUNG_ZEILE_ABGELEHNT, PAKET_ENTSCHEIDUNG,
} from "./helpers/kette-fixture.mjs";

const RESULT_TEXT = "### Zuordnung 1 -> #0003. ### Ohne Paket Alle Kriterien sind abgebildet. ### Zuwachs Nichts Zusaetzliches.";
const ABSCHNITTE = ["### Ausgang", "### Stufen", "### Entscheidungen der Nacht", "### Abgelehnte Befunde", "### Abdeckung gegen den Fachplan", "### Kennzahlen"];

function fachplanText(dir, F) {
  return readFileSync(join(dir, "issues", `${F}.md`), "utf-8");
}

test("[night-21] nach einem fertigen Lauf traegt der Fachplan genau einen Nachtbericht mit allen Abschnitten", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: RESULT_TEXT });
    assert.equal(res.status, 0, res.stderr);
    const lauf = stand(dir);
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.bericht, "veroeffentlicht");

    const text = fachplanText(dir, F);
    const stempel = lauf.start.slice(0, 10) + "-" + lauf.start.slice(11, 19).replaceAll(":", "");
    assert.equal(text.split(`${BERICHT_ANKER} ${stempel}`).length - 1, 1, "genau ein Nachtbericht mit dem Stempel des Laufs");
    for (const a of ABSCHNITTE) assert.ok(text.includes(a), `${a} fehlt`);
    assert.match(text, /### Ausgang\n\nfertig\n/);
    assert.match(text, /- Plan #0002 \(\[Plan\] Ein Weg\): Dauer [\d.]+ min, Kosten der letzten Session 1\.00 \$, Korrekturrunden 0, Pruefer opus \(2026-09-14, Nachtlauf\), Marker gesetzt\./);
    assert.match(text, /- Pakete \(2, Korrekturrunden 0\): #0003 Paket 1, #0004 Paket 2\./);
    assert.match(text, /- Nicht zuordenbar \(ohne 'Plan: Issue #0002'\): #0005\./);
    // Die A- und E-Zeilen des Plans woertlich, dann die Entscheidung des Pakets, fortlaufend nummeriert.
    assert.ok(text.includes("1. A1 — Ein Weg, weil er der kuerzeste ist. (Plan #0002)"));
    assert.ok(text.includes("2. E1: Wie heisst das Feld? Gewaehlt: kurz. Verworfen: lang. Grund: Bestand. Rueckbau: trivial. (Plan #0002)"));
    assert.ok(text.includes(`3. ${PAKET_ENTSCHEIDUNG} (Paket #0003)`));
    assert.ok(text.includes(EINARBEITUNG_ZEILE_ABGELEHNT), "die abgelehnte Zeile der Einarbeitung fehlt");
    assert.ok(!text.includes("### Abgelehnte Befunde\n\n- Fund 1"), "eine uebernommene Zeile gehoert nicht zu den abgelehnten");
    assert.ok(text.includes(`### Abdeckung gegen den Fachplan\n\n${RESULT_TEXT}`));
    assert.match(text, /- Pakete erreicht: ja\n- Dauer der Kette: [\d.]+ min ab \d{4}-\d{2}-\d{2}T[\d:.]+Z\n- Entscheidungen: 3\n- Stopp-Fragen: 0\n- Kosten: 4\.00 \$ von 50 \$\n- kostenUnbekannt: 0/);
    assert.ok(!text.includes("### Offene Stopp-Frage"));
    assert.ok(!text.includes("### Ueberholt"));
    assert.ok(text.trimEnd().endsWith(BERICHT_SCHLUSS), "der Schlussabsatz ist das Letzte im Bericht");
    assert.match(res.stdout, /Nachtbericht als Kommentar an #0001 veroeffentlicht/);
  });
});

test("[night-21] nach angehalten steht die Stopp-Frage im Bericht, hinter dem Halt-Kommentar", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_HALT } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "angehalten");
    assert.equal(einheit.bericht, "veroeffentlicht");
    const text = fachplanText(dir, F);
    assert.match(text, /### Ausgang\n\nangehalten — Stopp-Frage aus dem Review von #0002/);
    assert.match(text, /### Offene Stopp-Frage\n\nEinarbeitung: Frage der Stopp-Klasse — ist das eine Schnittstelle nach aussen\?/);
    assert.match(text, /- Stopp-Fragen: 1/);
    assert.match(text, /- Pakete erreicht: nein/);
    assert.ok(text.indexOf("## Kette angehalten") < text.indexOf(BERICHT_ANKER), "erst die Frage, dann der Bericht");
  });
});

test("[night-21] nach abgebrochen steht der Grund im Bericht; ohne Plan gibt es keine Entscheidungen und keine Einarbeitung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: {} });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    const text = fachplanText(dir, F);
    assert.match(text, /### Ausgang\n\nabgebrochen — kein Plan entstanden/);
    assert.match(text, /### Stufen\n\n- Plan: keiner entstanden\.\n- Pakete: keine\./);
    assert.match(text, /### Entscheidungen der Nacht\n\n- Keine\./);
    assert.match(text, /### Abgelehnte Befunde\n\n- keine Einarbeitung gefunden/);
    assert.match(text, /### Abdeckung gegen den Fachplan\n\nKeine Abdeckung: die Kette hat die Stufe abdeckung nicht erreicht\./);
    assert.ok(text.trimEnd().endsWith(BERICHT_SCHLUSS));
  });
});

test("[night-21] eine Stopp-Frage im Plan haelt vor dem Review an — der Bericht nennt sie und die Einarbeitung fehlt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, {
      stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER },
      plan: planBody({ offeneFragen: "- Ist der Endpunkt ein Vertrag nach aussen?" }),
    });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const text = fachplanText(dir, F);
    assert.match(text, /### Offene Stopp-Frage\n\n- Ist der Endpunkt ein Vertrag nach aussen\?/);
    assert.match(text, /### Abgelehnte Befunde\n\n- keine Einarbeitung gefunden/);
    assert.match(text, /Marker fehlt\./);
  });
});

test("[night-21] berichtBauen nummeriert Entscheidungen aus Plan und Paketen, nennt Ueberholt und liest Kommentare als Array", () => {
  const plan = {
    id: "12", title: "[Plan] X",
    body: "Plan-Modell: a\nPlan-Review: b (2026-09-14)\n\n## Ziel\n\nx\n\n## Architektonische Entscheidungen\n\n- A1 — erstens.\n  - Unterpunkt zaehlt nicht.\n- E1: zweitens.\n\n```\n- im Codeblock zaehlt nicht\n```\n\n## Offene Fragen\n\n- Keine.\n",
    comments: [
      { body: "## Plan-Review, Runde 1\n\nFund: abgelehnt waere hier falsch gelesen." },
      { body: "## Einarbeitung, Runde 1\n\n- F1: übernommen.\n- F2: abgelehnt — Grund." },
    ],
  };
  const pakete = [
    { id: "13", title: "P1", body: "## Kontext\n\nPlan: Issue #12\nEntscheidung: Q? Gewählt: a. Verworfen: b. Grund: c. Rückbau: trivial.\n\n## Aufgabe\n\nx\n" },
    { id: "14", title: "P2", body: "## Kontext\n\nPlan: Issue #12\n\n## Aufgabe\n\nEntscheidung: nicht im Kontext, zaehlt nicht.\n" },
  ];
  const einheit = {
    id: "7", ausgang: "fertig",
    stufen: { plan: { id: "12", dauerMs: 90000, kennzahlen: { kostenUsd: 2.5 }, korrekturrunden: 1 }, review: { marker: true }, pakete: { ids: ["13", "14"], nichtZuordenbar: [], korrekturrunden: 0 }, abdeckung: { text: null, grund: "Zeitbudget abdeckung" } },
    ueberholt: ["9"], abdeckungSchrieb: true, kostenUsd: 3.25, kostenUnbekannt: 1,
  };
  assert.deepEqual(kommentareVon(plan).length, 2);
  assert.match(einarbeitungVon(plan), /^## Einarbeitung, Runde 1/);
  const start = new Date("2026-09-14T22:00:00.000Z");
  const text = berichtBauen(einheit, {
    plan, pakete, einarbeitung: einarbeitungVon(plan), abdeckung: einheit.stufen.abdeckung,
    budget: { kostenUsd: 50 }, start, stempel: "2026-09-14-220000", jetzt: start.getTime() + 30 * 60000,
  });
  assert.ok(text.startsWith("## Nachtbericht, Kette 2026-09-14-220000\n"));
  assert.match(text, /- Plan #12 \(\[Plan\] X\): Dauer 1\.5 min, Kosten der letzten Session 2\.50 \$, Korrekturrunden 1, Pruefer b \(2026-09-14\), Marker gesetzt\./);
  assert.ok(text.includes("1. A1 — erstens. (Plan #12)\n2. E1: zweitens. (Plan #12)\n3. Entscheidung: Q? Gewählt: a. Verworfen: b. Grund: c. Rückbau: trivial. (Paket #13)\n"));
  assert.ok(!text.includes("Unterpunkt"), "nur die erste Ebene");
  assert.ok(!text.includes("im Codeblock"), "nichts aus Codebloecken");
  assert.match(text, /### Abgelehnte Befunde\n\n- F2: abgelehnt — Grund\.\n/);
  assert.ok(!text.includes("falsch gelesen"), "nur der Einarbeitungs-Kommentar zaehlt");
  assert.match(text, /### Abdeckung gegen den Fachplan\n\nKeine Abdeckung: Zeitbudget abdeckung\.\n\nHinweis: die Abdeckungs-Session hat am Board geschrieben/);
  assert.match(text, /- Dauer der Kette: 30\.0 min ab 2026-09-14T22:00:00\.000Z\n- Entscheidungen: 3\n- Stopp-Fragen: 0\n- Kosten: 3\.25 \$ von 50 \$\n- kostenUnbekannt: 1/);
  assert.match(text, /### Ueberholt\n\n- Plan #9\n/);
  assert.ok(text.trimEnd().endsWith(BERICHT_SCHLUSS));
  // Ohne Einarbeitung, ohne abgelehnte Zeile: zwei verschiedene Aussagen.
  assert.match(berichtBauen({ ausgang: "fertig" }, { stempel: "s" }), /- keine Einarbeitung gefunden/);
  assert.match(berichtBauen({ ausgang: "fertig" }, { stempel: "s", einarbeitung: "## Einarbeitung, Runde 1\n\n- alles übernommen." }), /- keine abgelehnten Befunde/);
});
