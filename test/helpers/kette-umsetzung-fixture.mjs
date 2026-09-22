// Gemeinsame Hilfen der Tests zur Stufe umsetzung (Plan #691; Issue #695, geteilt #836).
//
// Die Tests liegen in zwei Dateien — Ablauf und Rueckstellpflicht —, weil eine einzelne
// Datei ihre Tests nacheinander faehrt und damit die Wandzeit der ganzen Suite nach
// unten begrenzte (Issue #836). Was beide brauchen, steht hier: der Fachplan mit beiden
// Labels, der Zugriff auf den Stand der Stufe und die drei Zusicherungen ueber die
// Spalten des Boards. Doppelt gepflegt wird davon nichts.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import assert from "node:assert/strict";

import { board, fachplan, stand, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN } from "./kette-fixture.mjs";

/** Die vier erzeugenden Stufen, wie sie jeder dieser Tests braucht. */
export const ERZEUGEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };

/** Ein Fachplan mit beiden Labels: Kettenlabel und das Kennzeichen der Variante B. */
export function fachplanB(dir, titel = "[Fachlich] Ein Anliegen") {
  const F = fachplan(dir, titel);
  board(dir, "issue", "label", "add", F, "kit:durchziehen");
  return F;
}

/** Die Einheit der Kette und ihr Stand der Stufe umsetzung. */
export function umsetzung(dir, F) {
  const einheit = stand(dir).einheiten.find((e) => e.id === F);
  assert.ok(einheit, `keine Einheit fuer Fachplan #${F}`);
  return { einheit, stufe: einheit.stufen?.umsetzung };
}

/** Die Nummern der Karten einer Spalte. */
export function inSpalte(dir, status) {
  return board(dir, "issue", "list", "--status", status).map((i) => String(i.id));
}

/** Keine Karte bleibt in Ready oder In progress zurueck — die Zusicherung aus dem Akzeptanzkriterium. */
export function keinRestInArbeit(dir, erlaubtInReady = []) {
  assert.deepEqual(inSpalte(dir, "ready"), erlaubtInReady, "es blieb ein Paket in Ready liegen");
  assert.deepEqual(inSpalte(dir, "in_progress"), [], "es blieb ein Paket in In progress liegen");
}

/** Jedes genannte Paket liegt in Backlog — neben Fachplan, Plan und fremden Karten, die dort ohnehin stehen. */
export function stehenInBacklog(dir, ids) {
  const backlog = inSpalte(dir, "backlog");
  for (const id of ids) assert.ok(backlog.includes(id), `Paket #${id} liegt nicht in Backlog, sondern in ${board(dir, "issue", "get", id).status}`);
}
