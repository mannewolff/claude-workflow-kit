// Gemeinsame Hilfen der GitLab-Adapter-Tests (Issue #188, geteilt mit Issue #836).
//
// Die Tests des GitLab-Adapters liegen in zwei Dateien — Anlegen/Lesen und
// Listen/Verschieben —, weil eine einzelne Datei ihre Tests nacheinander faehrt und
// damit die Wandzeit der ganzen Suite nach unten begrenzte (Issue #836). Was beide
// brauchen, steht hier: das Fake-`glab` samt Basisantworten und die beiden
// Konfigurationen. Doppelt gepflegt wird davon nichts.
//
// Besonderheit von GitLab: Spalten sind Labels, ausser 'done' (immer der Zustand
// Closed) und 'backlog', wenn es per Config der Zustand Open ist
// (columns.backlog === "Open"). Beide Konfigurationen werden geprueft.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import { rmSync } from "node:fs";

import { setupProjekt, fakeCli } from "./board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
export const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};

export const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };
// backlog als nativer Open-Zustand statt als Label.
export const GITLAB_OPEN = { codeHost: "gitlab", issueTracker: "gitlab", columns: { backlog: "Open", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" } };

export function basisRegeln() {
  return [
    { match: "^issue update", stdout: "" },
    { match: "^issue close", stdout: "" },
    { match: "^issue reopen", stdout: "" },
    { match: "^issue note", stdout: "" },
    { match: "^api projects", stdout: [] },
  ];
}

export function mitProjekt(fn, { regeln = [], config = GITLAB } = {}) {
  const dir = setupProjekt(config, "board-gitlab-");
  fakeCli(dir, "glab", [...regeln, ...basisRegeln()]);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
