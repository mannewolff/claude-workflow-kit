// Ablauf-Pruefung: Der Kommentar am Fachplan entsteht erst im echten Kettenlauf — welcher
// Ausgang welchen Bericht hinterlaesst und dass er hinter dem Halt-Kommentar steht, zeigt nur
// der Runner mit Board und Stufen-Attrappen.
//
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
import { BERICHT_ANKER, BERICHT_SCHLUSS } from "../kit/night/bericht.mjs";
import {
  run, mitProjekt, fachplan, umgebung, stand, planBody,
  PLAN_ANLEGEN, REVIEW_MARKER, REVIEW_HALT, PAKETE_ANLEGEN, EINARBEITUNG_ZEILE_ABGELEHNT, PAKET_ENTSCHEIDUNG,
} from "./helpers/kette-fixture.mjs";

const RESULT_TEXT = "### Zuordnung 1 -> #0003. ### Ohne Paket Alle Kriterien sind abgebildet. ### Zuwachs Nichts Zusaetzliches.";
const ABSCHNITTE = ["### Ausgang", "### Stufen", "### Entscheidungen der Nacht", "### Abgelehnte Befunde", "### Abdeckung gegen den Fachplan", "### Kennzahlen"];

function fachplanText(dir, F) {
  return readFileSync(join(dir, "issues", `${F}.md`), "utf-8");
}

test("[night-21] nach einem fertigen Lauf traegt der Fachplan genau einen Nachtbericht mit allen Abschnitten", () => {
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

test("[night-21] nach angehalten steht die Stopp-Frage im Bericht, hinter dem Halt-Kommentar", () => {
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

test("[night-21] nach abgebrochen steht der Grund im Bericht; ohne Plan gibt es keine Entscheidungen und keine Einarbeitung", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: {} });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "abgebrochen");
    const text = fachplanText(dir, F);
    assert.match(text, /### Ausgang\n\nabgebrochen — kein Plan entstanden/);
    assert.match(text, new RegExp(`### Stufen\\n\\n- Auftrag: fachliche Anforderung #${F}\\n- Variante: A\\n- Plan: keiner entstanden\\.\\n- Pakete: keine\\.`));
    assert.match(text, /### Entscheidungen der Nacht\n\n- Keine\./);
    assert.match(text, /### Abgelehnte Befunde\n\n- keine Einarbeitung gefunden/);
    assert.match(text, /### Abdeckung gegen den Fachplan\n\nKeine Abdeckung: die Kette hat die Stufe abdeckung nicht erreicht\./);
    assert.ok(text.trimEnd().endsWith(BERICHT_SCHLUSS));
  });
});

test("[night-21] eine Stopp-Frage im Plan haelt vor dem Review an — der Bericht nennt sie und die Einarbeitung fehlt", () => {
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
