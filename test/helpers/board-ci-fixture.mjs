// Gemeinsame Hilfen der Tests zur Achse `code ci-status` (Issue #316, geteilt mit #836).
//
// Die Tests liegen in zwei Dateien — GitHub und der Rest —, weil eine einzelne Datei
// ihre Tests nacheinander faehrt und damit die Wandzeit der ganzen Suite nach unten
// begrenzte (Issue #836). Was beide brauchen, steht hier: das Fixture mit Fake-CLI und
// die beiden Aufruf-Hilfen. Doppelt gepflegt wird davon nichts.
//
// Seit Issue #1217 rufen die Hilfen `getCiStatus` des CodeHosts aus kit/board/adapter.mjs
// im selben Prozess, so wie `codeCiStatus` im Einstieg es tut. Deshalb laedt dieser Helfer
// nur `adapter-fixture.mjs`: Wer `board-fixture.mjs` laedt, startet den Einstieg und gilt
// beim Waechter als Ablauf-Pruefung. Die CLI-Form der Achse (fehlendes `--commit`, Hilfe)
// prueft `ablauf-board-adapter-ci-status-cli.test.mjs` mit eigenem Aufruf.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import { rmSync } from "node:fs";

import { setupProjekt, fakeCli, imProjekt, aufrufZeilen } from "./adapter-fixture.mjs";
import { resolveCodeHost } from "../../kit/board/adapter.mjs";

export const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * Legt ein Fixture mit Fake-CLI an, fragt den CI-Status zum SHA im selben Prozess ab
 * und raeumt auf. Liefert das Urteil und die abgesetzten Kommandozeilen; scheitert der
 * Adapter, wird das Promise mit seinem BoardError abgelehnt.
 */
export async function ciStatus(config, cliName, regeln) {
  const dir = setupProjekt(config, "board-ci-");
  if (cliName) fakeCli(dir, cliName, regeln);
  try {
    const daten = await imProjekt(dir, () => resolveCodeHost(config).getCiStatus(SHA));
    return { daten, zeilen: cliName ? aufrufZeilen(dir, cliName) : [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Startzeit je Job (Issue #1151): `gh run view --json jobs` liefert `startedAt`, `glab ci
// get` liefert `started_at`. Je Host ein gestarteter und ein noch wartender Job — der
// wartende traegt das Feld gar nicht (GitLab: `null`), bei GitHub zusaetzlich die
// Null-Zeit, die gh fuer einen nie gestarteten Job ausgibt.
export const STARTZEIT = "2026-10-04T16:00:00Z";
export const GH_NULLZEIT = "0001-01-01T00:00:00Z";

export const GH_JOBS_START = [
  { name: "check (ubuntu-latest)", conclusion: "success", status: "completed", startedAt: STARTZEIT },
  { name: "check (windows-latest)", conclusion: null, status: "queued" },
  { name: "check (macos-latest)", conclusion: null, status: "queued", startedAt: GH_NULLZEIT },
];

export const GLAB_JOBS_START = [
  { name: "test", status: "running", started_at: STARTZEIT },
  { name: "lint", status: "pending", started_at: null },
];
