// Was passiert, wenn board.mjs nicht neben night.mjs liegt (Issue #394).
//
// night.mjs holt sich `parsePruefvorgabe` vom Nachbarn und haelt fuer den Fall, dass
// dort nichts liegt, einen Fallback bereit, der wirft. Der Grund steht in Issue #170:
// Ein statischer Import scheitert vor der ersten Zeile Code und nimmt dem Runner genau
// die Auskunft, dass board.mjs fehlt.
//
// Der Wurf selbst ist von aussen nicht beobachtbar — beide Aufrufstellen fangen ihn.
// Geprueft wird deshalb, was sie daraus machen: `reviewFreigabe` meldet "ungueltig" mit
// der Meldung als Detail, `hatGueltigenVerzicht` meldet `false`. Faellt dieses
// Fangverhalten weg, crasht der Nacht-Runner, statt auszusortieren.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Laedt night.mjs aus einem Verzeichnis, in dem KEIN board.mjs liegt. */
async function ohneNachbarBoard(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-ohne-board-"));
  try {
    const ziel = join(dir, "night.mjs");
    copyFileSync(join(repoRoot, "kit", "night.mjs"), ziel);
    assert.equal(existsSync(join(dir, "board.mjs")), false, "der Nachbar darf nicht existieren");
    await fn(await import(pathToFileURL(ziel).href));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ohne board.mjs meldet reviewFreigabe ungueltig mit der Meldung als Detail", async () => {
  await ohneNachbarBoard(async (night) => {
    const freigabe = night.reviewFreigabe("## Kontext\nPruefung: 3\n");
    assert.equal(freigabe.frei, false);
    assert.equal(freigabe.art, "ungueltig");
    assert.match(freigabe.detail, /die Pruefvorgabe ist nicht lesbar/);
    assert.match(freigabe.detail, /board\.mjs liegt nicht neben night\.mjs/);
  });
});

test("ohne board.mjs liefert hatGueltigenVerzicht false statt zu werfen", async () => {
  await ohneNachbarBoard(async (night) => {
    // Ein Body, der mit lesbarem Nachbarn einen gueltigen Verzicht ergaebe: Ohne ihn
    // darf daraus kein Verzicht werden — sonst liefe ein ungepruefte Issue durch.
    assert.equal(night.hatGueltigenVerzicht("## Kontext\nPruefung: Verzicht\n"), false);
  });
});
