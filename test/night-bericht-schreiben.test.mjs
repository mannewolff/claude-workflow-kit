// Der Nachtbericht geht als Kommentar an die gekennzeichnete Karte (Plan #638, A11; Issue
// #645, #896).
//
// `berichtSchreiben` reicht den Text ueber eine Datei ausserhalb des Projekts ans Board,
// nie als Argument. Nimmt der Tracker ihn nicht an, wartet er unter
// `.claude/night-bericht-<zielId>-<stempel>.md` in der Hauptkopie. Geprueft am Teil bericht
// im selben Prozess, mit eingesetztem Board (Plan #1199, E6); das Nachtragen beim naechsten
// Start im Runner prueft test/ablauf-night-bericht-wartend.test.mjs.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { berichtAbhaengigkeiten, berichtSchreiben } from "../kit/night/bericht.mjs";

afterEach(() => berichtAbhaengigkeiten());

/** Ein Board, das jeden Aufruf mitschreibt und den Text der Datei zum Zeitpunkt des Aufrufs festhaelt. */
function boardAttrappe(status, text = "") {
  const aufrufe = [];
  berichtAbhaengigkeiten({
    boardRoh: (...args) => {
      const datei = args[args.indexOf("--text-file") + 1];
      aufrufe.push({ args, inhalt: readFileSync(datei, "utf-8") });
      return { status, text };
    },
  });
  return aufrufe;
}

function mitProjekt(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-bericht-schreiben-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[night-21] nimmt das Board den Bericht an, ist er veroeffentlicht und nichts bleibt liegen", () => {
  mitProjekt((dir) => {
    const aufrufe = boardAttrappe(0);
    const ergebnis = berichtSchreiben("41", "## Nachtbericht, Kette s\n", { stempel: "2026-10-06-010203", repoRoot: dir });
    assert.equal(ergebnis, "veroeffentlicht");
    assert.equal(aufrufe.length, 1);
    assert.deepEqual(aufrufe[0].args.slice(0, 4), ["issue", "comment", "41", "--text-file"]);
    assert.equal(aufrufe[0].inhalt, "## Nachtbericht, Kette s\n", "der Bericht geht ueber die Datei, unveraendert");
    assert.ok(!aufrufe[0].args[4].startsWith(dir), "die Zwischendatei liegt ausserhalb des Projekts");
    assert.ok(!existsSync(aufrufe[0].args[4]), "die Zwischendatei ist danach weg");
    assert.ok(!existsSync(join(dir, ".claude")), "kein wartender Bericht");
  });
});

test("[night-21] nimmt das Board ihn nicht an, wartet er in der Hauptkopie unter seinem Namen", () => {
  mitProjekt((dir) => {
    const aufrufe = boardAttrappe(1, "Tracker weg");
    const ergebnis = berichtSchreiben("41", "Bericht\n", { stempel: "2026-10-06-010203", repoRoot: dir });
    const name = "night-bericht-41-2026-10-06-010203.md";
    assert.equal(ergebnis, join(".claude", name));
    assert.deepEqual(readdirSync(join(dir, ".claude")), [name]);
    assert.equal(readFileSync(join(dir, ".claude", name), "utf-8"), "Bericht\n");
    assert.ok(!existsSync(aufrufe[0].args[4]), "auch im Fehlerfall ist die Zwischendatei weg");
  });
});
