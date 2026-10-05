// Zwei Starts in derselben Sekunde bekommen verschiedene Stempel, und ein wartender Bericht
// geht genau einmal ans Board (Plan #1113, E11 und E12; Issue #1190).
//
// E11: Der Stempel gilt erst, wenn `.claude/night-run-<stempel>.json` exklusiv angelegt ist
// (`wx`). Findet ein Start die Datei schon vor, wartet er bis zur naechsten vollen Sekunde
// und bildet den Stempel neu — hoechstens fuenfmal.
//
// E12: `berichteNachtragen` benennt einen wartenden Bericht vor dem Posten auf
// `<name>.sendet-<pid>` um. Wem das Umbenennen nicht gelingt, der hat ihn nicht und
// ueberspringt ihn. Scheitert das Posten, wird zurueckbenannt; eine `.sendet-`-Datei eines
// toten Prozesses benennt der naechste Start zurueck.
//
// Geprueft an den Funktionen selbst, mit eingespeister Uhr und eingespeistem Posten — ohne
// echte Sekunden und ohne Board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { laufStempelReservieren, berichteNachtragen } from "../kit/night.mjs";

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

/** Ein Projekt mit wartenden Berichten. */
function mitBerichten(...namen) {
  const dir = projekt("night-nachtrag-");
  for (const n of namen) writeFileSync(join(dir, ".claude", n), `Bericht ${n}\n`, "utf-8");
  return dir;
}

test("[night-1190] zwei Nachtragende posten jeden wartenden Bericht genau einmal", () => {
  const r1 = "night-bericht-11-2026-10-05-220000.md";
  const r2 = "night-bericht-12-2026-10-05-220001.md";
  const dir = mitBerichten(r1, r2);
  const gepostet = [];
  // Runner B startet, waehrend A den ersten Bericht postet: B sieht r1 nicht mehr, nimmt r2;
  // A hat r2 schon gelistet, sein Umbenennen scheitert, und er ueberspringt ihn.
  let bGelaufen = false;
  const postenB = (F, pfad) => {
    gepostet.push({ wer: "B", F, pfad });
    return { status: 0, text: "" };
  };
  const postenA = (F, pfad) => {
    gepostet.push({ wer: "A", F, pfad });
    if (!bGelaufen) {
      bGelaufen = true;
      berichteNachtragen(dir, { posten: postenB, pid: 4242 });
    }
    return { status: 0, text: "" };
  };
  berichteNachtragen(dir, { posten: postenA, pid: process.pid });
  assert.deepEqual(gepostet.map((g) => `${g.wer}:${g.F}`), ["A:11", "B:12"], "ein Bericht ging doppelt oder gar nicht");
  assert.match(gepostet[0].pfad, new RegExp(`${r1}\\.sendet-${process.pid}$`), "A postete nicht aus der umbenannten Datei");
  assert.match(gepostet[1].pfad, new RegExp(`${r2}\\.sendet-4242$`));
  assert.deepEqual(readdirSync(join(dir, ".claude")), [], "nach dem Posten blieb etwas liegen");
});

test("[night-1190] scheitert das Posten, liegt der Bericht wieder unter seinem Namen", () => {
  const r1 = "night-bericht-11-2026-10-05-220000.md";
  const dir = mitBerichten(r1);
  const nachgetragen = berichteNachtragen(dir, { posten: () => ({ status: 1, text: "Board weg" }) });
  assert.deepEqual(nachgetragen, []);
  assert.deepEqual(readdirSync(join(dir, ".claude")), [r1]);
});

test("[night-1190] eine verwaiste .sendet-Datei eines toten Prozesses wird zurueckbenannt und nachgetragen", () => {
  const tot = spawnSync(process.execPath, ["-e", ""]).pid;
  const r1 = "night-bericht-11-2026-10-05-220000.md";
  const r2 = "night-bericht-12-2026-10-05-220001.md";
  // r2 haelt ein lebender Prozess (dieser): Er sendet gerade und bleibt unberuehrt.
  const dir = mitBerichten(`${r1}.sendet-${tot}`, `${r2}.sendet-${process.pid}`);
  const gepostet = [];
  const nachgetragen = berichteNachtragen(dir, {
    posten: (F) => {
      gepostet.push(F);
      return { status: 0, text: "" };
    },
    pid: 4242,
  });
  assert.deepEqual(gepostet, ["11"], "die verwaiste Datei wurde nicht nachgetragen oder die lebende angefasst");
  assert.deepEqual(nachgetragen, [r1]);
  assert.deepEqual(readdirSync(join(dir, ".claude")), [`${r2}.sendet-${process.pid}`]);
});

test("[night-1190] ohne Posten eine verwaiste .sendet-Datei: sie liegt danach wieder unter ihrem Namen", () => {
  const tot = spawnSync(process.execPath, ["-e", ""]).pid;
  const r1 = "night-bericht-11-2026-10-05-220000.md";
  const dir = mitBerichten(`${r1}.sendet-${tot}`);
  berichteNachtragen(dir, { posten: () => ({ status: 1, text: "Board weg" }) });
  assert.deepEqual(readdirSync(join(dir, ".claude")), [r1]);
});
