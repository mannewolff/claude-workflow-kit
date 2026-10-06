// Ein wartender Bericht geht genau einmal ans Board (Plan #1113, E12; Issue #1190). Die
// Reservierung des Stempels (E11) prueft seit Issue #1224 night-grundlagen-stempel.
//
// E12: `berichteNachtragen` benennt einen wartenden Bericht vor dem Posten auf
// `<name>.sendet-<pid>` um. Wem das Umbenennen nicht gelingt, der hat ihn nicht und
// ueberspringt ihn. Scheitert das Posten, wird zurueckbenannt; eine `.sendet-`-Datei eines
// toten Prozesses benennt der naechste Start zurueck.
//
// Geprueft an der Funktion selbst, mit eingespeistem Posten — ohne Board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { berichteNachtragen } from "../kit/night/bericht.mjs";

function projekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}

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
