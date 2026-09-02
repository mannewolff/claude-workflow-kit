// Versionskennung der Kit-Dateien mit --version (Issue #170, spec.mjs mit #440).
//
// board.mjs, night.mjs und spec.mjs werden in Konsumenten-Projekte kopiert. Ohne
// Versionskennung kann man einer installierten Kopie nicht ansehen, aus welchem
// Kit-Stand sie stammt — und damit auch nicht, ob ein Auffrischen noetig ist.
//
// Kern dieser Tests ist die Portabilitaet: --version muss in einem fremden
// Verzeichnis funktionieren, in dem NICHTS liegt ausser der .mjs-Datei selbst —
// keine workflow.config.json, kein Kit-Repo, keine Nachbardatei. Genau dort
// braucht man die Auskunft, und genau dort wuerde ein zu spaeter Config-Zugriff
// sie kaputtmachen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Kopiert genau eine Kit-Datei in ein leeres Temp-Verzeichnis und ruft sie dort
// mit den gegebenen Argumenten auf. Das leere Verzeichnis ist der Testgegenstand:
// es simuliert ein Projekt ohne jeden Kit-Kontext.
function isoliertAufrufen(datei, cliArgs) {
  const dir = mkdtempSync(join(tmpdir(), "kit-version-"));
  try {
    copyFileSync(join(repoRoot, "kit", datei), join(dir, datei));
    return spawnSync(process.execPath, [join(dir, datei), ...cliArgs], {
      cwd: dir,
      encoding: "utf-8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Die Dateien, die --version kennen. checks.mjs traegt zwar denselben Stempel,
// hat aber bewusst kein --version-Flag; es gehoert deshalb nicht in diese Liste.
const MIT_VERSION_FLAG = ["board.mjs", "night.mjs", "spec.mjs"];

for (const datei of MIT_VERSION_FLAG) {
  test(`${datei}: --version gibt die Kit-Version aus, ohne weiteren Repo-Kontext`, () => {
    const res = isoliertAufrufen(datei, ["--version"]);

    assert.equal(res.status, 0,
      `${datei} --version haette mit Exit 0 enden muessen: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, /claude-workflow-kit v\d+\.\d+\.\d+/,
      `${datei} --version nennt keine Kit-Version: ${JSON.stringify(res.stdout)}`);
    assert.match(res.stdout, new RegExp(datei.replace(".", String.raw`\.`)),
      `${datei} --version nennt die Datei nicht, aus der die Auskunft stammt`);
    assert.equal(res.stderr.trim(), "",
      `${datei} --version darf nichts auf stderr schreiben: ${res.stderr}`);
  });

  test(`${datei}: --help bleibt unveraendert nutzbar und nennt --version`, () => {
    const res = isoliertAufrufen(datei, ["--help"]);

    assert.equal(res.status, 0, `${datei} --help schlug fehl: ${res.stderr}`);
    assert.match(res.stdout, /--version/,
      `${datei} --help erwaehnt das neue Flag nicht`);
  });
}

test("alle Kit-Dateien tragen dieselbe Versionskonstante", () => {
  // Eine Installation besteht aus diesen Dateien zusammen. Waeren ihre Stempel
  // schon in der Quelle verschieden, waere jede spaetere Drift-Diagnose wertlos.
  const version = (datei) => {
    const raw = readFileSync(join(repoRoot, "kit", datei), "utf-8");
    const m = raw.match(/const KIT_VERSION = "(\d+\.\d+\.\d+)";/);
    assert.ok(m, `KIT_VERSION-Konstante fehlt in kit/${datei}`);
    return m[1];
  };

  const erwartet = version("board.mjs");
  for (const datei of MIT_VERSION_FLAG) {
    assert.equal(version(datei), erwartet,
      `kit/${datei} traegt einen anderen KIT_VERSION-Wert als kit/board.mjs`);
  }
});
