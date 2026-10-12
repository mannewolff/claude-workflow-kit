// Die Texttabellen liegen im Teil kit/texte/ (Issue #1524).
//
// Seit Stufe 3 des Umbaus auf Englisch traegt jedes Modul `TEXTE = { de, en }`, und beide
// Haelften haben dieselbe Gestalt. SonarCloud zaehlt sie als duplizierte Zeilen. Die
// Tabellen ziehen darum in einen eigenen Teil, den `sonar.cpd.exclusions` als Ganzes
// ausnimmt; die Logik der Module bleibt gemessen. Diese Pruefung haelt fest, dass keine
// Tabelle in ihr Modul zurueckwandert und dass der Installer jede Textdatei mitbringt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Die Module, deren Tabelle schon unter kit/texte/ liegt. Die Teile unter kit/night/ legen
// ihre Tabelle als night-<modul>.mjs ab (Issue #1525), die unter kit/board/ als
// board-<modul>.mjs (Issue #1526).
const MODULE = [
  "kit/aufwand.mjs", "kit/befunde.mjs", "kit/board.mjs", "kit/worktree.mjs",
  "kit/night/kette.mjs", "kit/night/bericht.mjs", "kit/night/wartend.mjs", "kit/night/grundlagen.mjs",
  "kit/night/session.mjs", "kit/night/tag.mjs", "kit/night/kitstand.mjs", "kit/night/laufstand.mjs",
  "kit/night/abhaengigkeiten.mjs",
  "kit/board/dokumente.mjs", "kit/board/adapter.mjs", "kit/board/issue-review.mjs", "kit/board/schutz.mjs",
  "kit/board/hook.mjs", "kit/board/geschuetzt.mjs", "kit/board/grundlagen.mjs", "kit/board/melder.mjs",
  "kit/board/testhinweise.mjs", "kit/board/ursprung.mjs", "kit/board/wiederholung.mjs",
];

const name = (modul) => modul.replace(/^kit\//, "").replaceAll("/", "-");

for (const modul of MODULE) {
  test(`${modul}: die Tabelle liegt unter kit/texte/${name(modul)}`, async () => {
    const ablage = join(repoRoot, "kit", "texte", name(modul));
    assert.ok(existsSync(ablage), `kit/texte/${name(modul)} fehlt`);
    const { TEXTE } = await import(join(repoRoot, "kit", "texte", name(modul)));
    assert.ok(TEXTE?.de && TEXTE?.en, `kit/texte/${name(modul)} exportiert keine Tabelle { de, en }`);
  });

  test(`${modul}: das Modul weist TEXTE nicht mehr selbst zu`, () => {
    const quelle = readFileSync(join(repoRoot, modul), "utf-8");
    assert.doesNotMatch(quelle, /\bTEXTE\s*=/, `${modul} traegt seine Tabelle noch selbst`);
  });
}

test("install.mjs: der Blob des Teils texte traegt jede Datei aus kit/texte/", () => {
  const install = readFileSync(join(repoRoot, "install.mjs"), "utf-8");
  const m = install.match(/const KIT_TEXTE_B64 = "([A-Za-z0-9+/=]*)";/);
  assert.ok(m, "install.mjs traegt keinen Blob KIT_TEXTE_B64");
  const blob = JSON.parse(Buffer.from(m[1], "base64").toString("utf-8"));
  const dir = join(repoRoot, "kit", "texte");
  const dateien = existsSync(dir) ? readdirSync(dir).filter((d) => !d.startsWith(".")).sort() : [];
  assert.ok(dateien.length > 0, "kit/texte/ ist leer");
  assert.deepEqual(Object.keys(blob).sort(), dateien);
  for (const datei of dateien) {
    assert.equal(blob[datei], readFileSync(join(dir, datei), "utf-8"), `${datei} im Blob weicht von der Quelle ab`);
  }
});
