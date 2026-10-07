// Ablauf-Pruefung: Ob zwei Prueflaeufe aufeinander warten, zeigt sich nur an zwei gleichzeitig gestarteten Prozessen; im selben Prozess laesst checks.mjs keine zwei Aufrufe zu.
//
// Keine rechnerweite Pruefsperre mehr (Issue #1241, Plan #1199 E12): Zwei Laeufe zweier
// Projekte laufen nebeneinander, keiner meldet eine Wartezeile. Die Pruefung der Quelle
// steht in test/checks-ohne-sperre.test.mjs.
//
// Nachgewiesen wird ueber einen Treffpunkt statt ueber die Uhr: Jeder Lauf hinterlegt ein
// Zeichen und wartet auf das des anderen, sodass nur ein Warten aufeinander den Test rot macht,
// nicht ein langsamer Prozessstart (Issue #1278).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CHECKS } from "./helpers/checks-ablauf.mjs";
import { repoAnlegen, datei } from "./helpers/checks-repo.mjs";

// Hinterlegt das eigene Zeichen im Treffpunkt und wartet in 20-ms-Schritten auf das des
// anderen Laufs; nach 1000 Schritten (20 s) endet es rot. Die Frist dient nur dem Abbruch.
function treffen(treffpunkt, eigen, anderer) {
  const code = `const fs=require('fs'),p=require('path'),t='${treffpunkt}';`
    + `fs.writeFileSync(p.join(t,'${eigen}'),'');let n=0;`
    + `const i=setInterval(()=>{if(fs.existsSync(p.join(t,'${anderer}'))){clearInterval(i);process.exit(0)}`
    + `if(++n>=1000){console.error('Zeichen von ${anderer} fehlt');process.exit(1)}},20)`;
  return `node -e "${code}"`;
}

function lauf(dir) {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, [CHECKS, "run"], { cwd: dir, env: { ...process.env, KIT_ROOT: dir } });
    let ausgabe = "";
    kind.stdout.on("data", (d) => { ausgabe += d; });
    kind.stderr.on("data", (d) => { ausgabe += d; });
    kind.on("close", (status) => fertig({ status, ausgabe }));
  });
}

test("[1241] zwei gleichzeitige Laeufe zweier Projekte warten nicht aufeinander", async () => {
  const treffpunkt = mkdtempSync(join(tmpdir(), "treffpunkt-"));
  const a = repoAnlegen({ config: { buildChecks: [treffen(treffpunkt, "a", "b")] } });
  const b = repoAnlegen({ config: { buildChecks: [treffen(treffpunkt, "b", "a")] } });
  try {
    datei(a, "src/a.txt");
    datei(b, "src/b.txt");

    const [ra, rb] = await Promise.all([lauf(a), lauf(b)]);

    for (const res of [ra, rb]) {
      assert.equal(res.status, 0, res.ausgabe);
      assert.doesNotMatch(res.ausgabe, /Sperre|es wird gewartet/, res.ausgabe);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
    rmSync(treffpunkt, { recursive: true, force: true });
  }
});
