// Gemeinsame Hilfen der Tests zur Achse `code ci-status` (Issue #316, geteilt mit #836).
//
// Die Tests liegen in zwei Dateien — GitHub und der Rest —, weil eine einzelne Datei
// ihre Tests nacheinander faehrt und damit die Wandzeit der ganzen Suite nach unten
// begrenzte (Issue #836). Was beide brauchen, steht hier: das Fixture mit Fake-CLI und
// die beiden Aufruf-Hilfen. Doppelt gepflegt wird davon nichts.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, fakeCli, runBoard, aufrufZeilen } from "./board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
export const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." }
  : {};

export const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Legt ein Fixture mit Fake-CLI an, ruft `code ci-status` auf und raeumt auf. */
export function ciStatus(config, cliName, regeln, { commitArg = SHA } = {}) {
  const dir = setupProjekt(config, "board-ci-");
  if (cliName) fakeCli(dir, cliName, regeln);
  try {
    const args = ["code", "ci-status"];
    if (commitArg !== null) args.push("--commit");
    if (typeof commitArg === "string") args.push(commitArg);
    const res = runBoard(dir, args);
    return { res, zeilen: cliName ? aufrufZeilen(dir, cliName) : [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Erwartet Exit 0 und liefert die geparste Ausgabe samt Aufrufzeilen. */
export function ciStatusOk(config, cliName, regeln) {
  const { res, zeilen } = ciStatus(config, cliName, regeln);
  assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
  return { daten: JSON.parse(res.stdout), zeilen };
}
