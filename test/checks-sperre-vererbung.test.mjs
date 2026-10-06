// Der Sperrpfad eines Laufs gilt nur diesem Lauf (Issue #1256).
//
// `tools/lastbeleg.mjs` gab jedem Lauf einen eigenen `KIT_CHECKS_LOCK`. Der Wert vererbte
// sich ueber den aeusseren `checks.mjs run` an jedes Pruefkommando und damit an jede
// Testdatei. Der Sperr-Helfer der Tests legt nur dann einen eigenen Pfad an, wenn keiner
// gesetzt ist — also nahmen alle inneren `checks.mjs`-Aufrufe die Sperre, die der aeussere
// Lauf gerade selbst hielt, und warteten auf ihn. In drei gleichzeitigen Laeufen hingen
// so dieselben fuenf Dateien bis zu 900 s, deterministisch und ohne Last.
//
// Ein Pruefkommando ist ein anderer Lauf als der, der es startet. Es bekommt den
// Sperrpfad des aeusseren Laufs deshalb nicht mit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mitRepo, checksMit, datei, repoAnlegen, zusammenfassung } from "./helpers/checks-repo.mjs";

const CHECKS = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "checks.mjs");

const ZEIGE_SPERRE = String.raw`node -e "process.stdout.write('SPERRPFAD=' + (process.env.KIT_CHECKS_LOCK ?? 'leer') + '\n')"`;

async function mitSperrverzeichnis(fn) {
  const dir = mkdtempSync(join(tmpdir(), "checks-vererbung-"));
  try {
    return await fn(join(dir, "aussen.lock"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[1256] ein Pruefkommando sieht den Sperrpfad des Laufs nicht, der es startet", async () => {
  await mitSperrverzeichnis(async (pfad) => {
    await mitRepo({ config: { buildChecks: [ZEIGE_SPERRE] } }, async (dir) => {
      datei(dir, "src/a.txt");

      const res = await checksMit(dir, { env: { KIT_CHECKS_LOCK: pfad } }, "run");

      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.match(res.stdout, /^SPERRPFAD=leer$/m, res.stdout);
      assert.ok(!res.stdout.includes("SPERRPFAD=" + pfad), res.stdout);
    });
  });
});

test("[1256] ein checks-Lauf in einem Pruefkommando wartet nicht auf die Sperre des aeusseren Laufs", async () => {
  await mitSperrverzeichnis(async (pfad) => {
    const innen = repoAnlegen({ config: { buildChecks: ["node -e 0"] } });
    try {
      datei(innen, "src/b.txt");
      const verschachtelt = `cd "${innen}" && node "${CHECKS}" run`;
      await mitRepo({ config: { buildChecks: [verschachtelt] } }, async (dir) => {
        datei(dir, "src/a.txt");

        // Eine kurze Obergrenze fuer fremde Halter: Wartete der innere Lauf, staende die
        // Wartezeile in der Ausgabe, ohne dass der Test Minuten braucht.
        const res = await checksMit(dir, { env: { KIT_CHECKS_LOCK: pfad, KIT_CHECKS_LOCK_FOREIGN_TIMEOUT_MS: "3000" } }, "run");

        assert.equal(res.status, 0, res.stdout + res.stderr);
        // Geprueft wird nur die Sperre des aeusseren Laufs. Ohne geerbten Pfad nimmt der innere
        // Lauf die Vorgabe-Sperre des Rechners, wie jeder eigenstaendige Lauf; haelt sie
        // gerade ein anderer Lauf (etwa der volle Abschlusslauf, in dem dieser Test steckt),
        // darf er darauf kurz warten.
        const wartezeilen = res.stdout.split("\n").filter((z) => z.includes("es wird gewartet"));
        assert.ok(!wartezeilen.some((z) => z.includes(pfad)), res.stdout);
        assert.equal(zusammenfassung(innen).laufen[0].ergebnis, "gruen");
      });
    } finally {
      rmSync(innen, { recursive: true, force: true });
    }
  });
});
