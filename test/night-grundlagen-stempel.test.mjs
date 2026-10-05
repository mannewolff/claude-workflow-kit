// Zwei Starts in derselben Sekunde bekommen verschiedene Stempel (Plan #1113, E11; Issue #1190).
//
// Der Stempel gilt erst, wenn `.claude/night-run-<stempel>.json` exklusiv angelegt ist
// (`wx`). Findet ein Start die Datei schon vor, wartet er bis zur naechsten vollen Sekunde
// und bildet den Stempel neu — hoechstens fuenfmal. Geprueft an der Funktion selbst, mit
// eingespeister Uhr und eingespeistem Schlaf, ohne echte Sekunden. Seit Issue #1224 steht
// sie in den Grundlagen; den Nachtrag wartender Berichte prueft night-stempel-bericht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { laufStempelReservieren } from "../kit/night/grundlagen.mjs";

function projekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}

/** Eine Uhr, die nur der eingespeiste Schlaf vorstellt. */
function uhrMitSchlaf(startMs) {
  let uhr = startMs;
  const geschlafen = [];
  return {
    geschlafen,
    uhr: () => new Date(uhr),
    warten: (ms) => {
      geschlafen.push(ms);
      uhr += ms;
    },
  };
}

test("[night-1190] ein zweiter Start in derselben Sekunde bekommt einen anderen Stempel", () => {
  const dir = projekt("night-stempel-");
  const start = Date.UTC(2026, 9, 5, 22, 0, 0, 400);
  const erster = laufStempelReservieren(dir, new Date(start), uhrMitSchlaf(start));
  const u = uhrMitSchlaf(start + 200);
  const zweiter = laufStempelReservieren(dir, new Date(start + 200), u);
  assert.equal(erster.stempel, "2026-10-05-220000");
  assert.equal(zweiter.stempel, "2026-10-05-220001", "der zweite Start traegt denselben Stempel");
  assert.deepEqual(u.geschlafen, [400], "nicht bis zur naechsten vollen Sekunde gewartet");
  for (const s of [erster, zweiter]) assert.ok(existsSync(join(dir, ".claude", `night-run-${s.stempel}.json`)));
  assert.equal(zweiter.jetzt.toISOString(), "2026-10-05T22:00:01.000Z", "der Lauf-Kopf bekaeme die alte Startzeit");
});

test("[night-1190] nach fuenf vergeblichen Neubildungen gibt die Reservierung auf, ohne den Lauf abzubrechen", () => {
  const dir = projekt("night-stempel-voll-");
  const start = Date.UTC(2026, 9, 5, 22, 0, 0);
  for (let s = 0; s <= 5; s++) writeFileSync(join(dir, ".claude", `night-run-2026-10-05-22000${s}.json`), "{}\n");
  const u = uhrMitSchlaf(start);
  const r = laufStempelReservieren(dir, new Date(start), u);
  assert.equal(u.geschlafen.length, 5, "nicht hoechstens fuenfmal neu gebildet");
  assert.match(r.fehler, /5 Neubildungen/);
  assert.equal(r.stempel, "2026-10-05-220005", "nicht der zuletzt gebildete Stempel");
});

test("[night-1190] ohne Kollision traegt die Reservierung keinen Fehler", () => {
  const dir = projekt("night-stempel-frei-");
  const r = laufStempelReservieren(dir, new Date(Date.UTC(2026, 9, 5, 22, 0, 0)));
  assert.equal(r.fehler, null);
});
