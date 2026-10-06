// Ablauf-Pruefung: Ob zwei Prueflaeufe aufeinander warten, zeigt sich nur an zwei gleichzeitig gestarteten Prozessen; im selben Prozess laesst checks.mjs keine zwei Aufrufe zu.
//
// Keine rechnerweite Pruefsperre mehr (Issue #1241, Plan #1199 E12): Zwei Laeufe zweier
// Projekte laufen nebeneinander, keiner meldet eine Wartezeile. Die Pruefung der Quelle
// steht in test/checks-ohne-sperre.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CHECKS } from "./helpers/checks-ablauf.mjs";
import { repoAnlegen, datei } from "./helpers/checks-repo.mjs";

// Schreibt Beginn und Ende in eine Datei und wartet dazwischen kurz: So laesst sich ablesen,
// ob die beiden Laeufe gleichzeitig liefen.
const ZEITEN = String.raw`node -e "const fs=require('fs');fs.appendFileSync('zeiten.txt','start '+Date.now()+'\n');setTimeout(()=>fs.appendFileSync('zeiten.txt','ende '+Date.now()+'\n'),400)"`;

function lauf(dir) {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, [CHECKS, "run"], { cwd: dir, env: { ...process.env, KIT_ROOT: dir } });
    let ausgabe = "";
    kind.stdout.on("data", (d) => { ausgabe += d; });
    kind.stderr.on("data", (d) => { ausgabe += d; });
    kind.on("close", (status) => fertig({ status, ausgabe }));
  });
}

function zeiten(dir) {
  const zeilen = readFileSync(join(dir, "zeiten.txt"), "utf-8").trim().split("\n");
  const wert = (art) => Number(zeilen.find((z) => z.startsWith(art)).split(" ")[1]);
  return { start: wert("start"), ende: wert("ende") };
}

test("[1241] zwei gleichzeitige Laeufe zweier Projekte warten nicht aufeinander", async () => {
  const a = repoAnlegen({ config: { buildChecks: [ZEITEN] } });
  const b = repoAnlegen({ config: { buildChecks: [ZEITEN] } });
  try {
    datei(a, "src/a.txt");
    datei(b, "src/b.txt");

    const [ra, rb] = await Promise.all([lauf(a), lauf(b)]);

    for (const res of [ra, rb]) {
      assert.equal(res.status, 0, res.ausgabe);
      assert.doesNotMatch(res.ausgabe, /Sperre|es wird gewartet/, res.ausgabe);
    }
    const za = zeiten(a);
    const zb = zeiten(b);
    assert.ok(za.start < zb.ende && zb.start < za.ende, `die Laeufe ueberlappen nicht: ${JSON.stringify({ za, zb })}`);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});
