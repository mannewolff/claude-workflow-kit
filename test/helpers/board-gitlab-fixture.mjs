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
// Seit Issue #1217 rufen die GitLab-Tests den Adapter aus kit/board/adapter.mjs im selben
// Prozess (`mitTracker`). Die Hilfen kommen deshalb aus `adapter-fixture.mjs` und nicht
// aus `board-fixture.mjs`: Die startet den Einstieg als Kindprozess, und jeder Test, der
// sie ueber diesen Helfer laedt, galte beim Waechter als Ablauf-Pruefung.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import { rmSync } from "node:fs";

import { setupProjekt, fakeCli, imProjekt } from "./adapter-fixture.mjs";
import { resolveTracker, resolveCodeHost } from "../../kit/board/adapter.mjs";

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

/**
 * Die Variante von `mitProjekt` im selben Prozess (Issue #1217): `fn` bekommt Tracker und
 * CodeHost aus der Config und laeuft mit cwd und Umgebung des Fixtures (`imProjekt`) —
 * so wie `dispatchIssue` und `dispatchCode` sie im Einstieg aufloesen. Aufgeraeumt wird
 * erst, wenn `fn` fertig ist.
 */
export async function mitTracker(fn, { regeln = [], config = GITLAB } = {}) {
  const dir = setupProjekt(config, "board-gitlab-");
  fakeCli(dir, "glab", [...regeln, ...basisRegeln()]);
  try {
    return await imProjekt(dir, () => fn({ tracker: resolveTracker(config), host: resolveCodeHost(config), dir }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Schneidet mit, was `fn` auf stderr schreibt (Issue #1217). Die Adapter melden
 * Hinweise wie ein nicht gesetztes Backlog-Label ueber `process.stderr.write`; im
 * Kindprozess stand das in `res.stderr`, im selben Prozess faengt es dieser Mitschnitt.
 */
export async function mitStderr(fn) {
  const original = process.stderr.write;
  let text = "";
  process.stderr.write = (stueck) => {
    text += String(stueck);
    return true;
  };
  try {
    return { ergebnis: await fn(), stderr: text };
  } finally {
    process.stderr.write = original;
  }
}
