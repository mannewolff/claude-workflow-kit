// Gemeinsame Hilfen der GitHub-Adapter-Tests (Issue #188, geteilt mit Issue #836).
//
// Die Tests des GitHub-Adapters liegen in drei Dateien — Lesen, Project und Schreiben —,
// weil eine einzelne Datei ihre Tests nacheinander faehrt und damit die Wandzeit der
// Suite nach unten begrenzte (Issue #836). Was alle drei brauchen, steht hier: das
// Fake-`gh` samt Basisantworten, die Project-Konfiguration und der Blick in den
// Meta-Cache. Doppelt gepflegt wird davon nichts.
//
// Seit Issue #1217 rufen die drei Dateien den Adapter aus kit/board/adapter.mjs im
// selben Prozess (`mitTracker`, `mitStderr`). `mitProjekt` bleibt fuer die Ablauf-Tests
// (`board-auftrag`, `board-melden`), die den Einstieg weiter ueber `runBoard` starten.
// Die Fixtures kommen aus `adapter-fixture.mjs`, nicht aus `board-fixture.mjs`: Wer diese
// Datei laedt, soll beim Waechter nicht als Ablauf-Pruefung gelten.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, fakeCli, imProjekt } from "./adapter-fixture.mjs";
import { resolveTracker, resolveCodeHost } from "../../kit/board/adapter.mjs";

export const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };

const OPTIONEN = [
  { id: "opt-backlog", name: "Backlog" },
  { id: "opt-ready", name: "Ready" },
  { id: "opt-progress", name: "In progress" },
  { id: "opt-review", name: "In review" },
  { id: "opt-done", name: "Done" },
];

// Antworten, die praktisch jeder Pfad braucht. Testspezifische Regeln werden davor
// gehaengt und gewinnen, weil die erste passende Regel zaehlt.
export function basisRegeln() {
  return [
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^project list", stdout: { projects: [{ number: 14, title: "Mein Board", id: "PVT_1" }] } },
    { match: "^project field-list", stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: OPTIONEN }] } },
    { match: "^api graphql", stdout: graphqlItem("ITEM_1", 14, "besitzer") },
    { match: "^project item-edit", stdout: "" },
    { match: "^project item-add", stdout: "" },
    { match: "^issue comment", stdout: "" },
  ];
}

export function graphqlItem(itemId, projektNummer, besitzer) {
  return {
    data: {
      repository: {
        issue: {
          projectItems: {
            nodes: [{ id: itemId, project: { number: projektNummer, owner: { login: besitzer } } }],
          },
        },
      },
    },
  };
}

export function mitProjekt(fn, { regeln = [], config = GITHUB } = {}) {
  const dir = setupProjekt(config, "board-github-");
  fakeCli(dir, "gh", [...regeln, ...basisRegeln()]);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Wie `mitProjekt`, aber im selben Prozess (Issue #1217): `fn` laeuft mit cwd im Fixture
 * und der Umgebung von `runBoard` und bekommt Tracker und CodeHost zur Config. Ein
 * CLI-Aufruf baut seinen Tracker jedes Mal neu; wer einen zweiten Aufruf nachstellt
 * (Memo leer, nur der Datei-Cache bleibt), holt sich mit `resolveTracker(config)` einen
 * frischen.
 */
export async function mitTracker(fn, { regeln = [], config = GITHUB, extraEnv = {} } = {}) {
  const dir = setupProjekt(config, "board-github-");
  fakeCli(dir, "gh", [...regeln, ...basisRegeln()]);
  try {
    return await imProjekt(dir, () => fn({ dir, config, tracker: resolveTracker(config), host: resolveCodeHost(config) }), extraEnv);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Schneidet mit, was `fn` auf stderr schreibt (Issue #1217). Die Adapter melden ihre
 * Hinweise ueber `process.stderr.write`; im Kindprozess las der Test sie aus `res.stderr`.
 * Liefert `{ wert, stderr }`; ein Fehler von `fn` geht unveraendert durch.
 */
export async function mitStderr(fn) {
  const original = process.stderr.write;
  let stderr = "";
  process.stderr.write = (teil) => {
    stderr += String(teil);
    return true;
  };
  try {
    const wert = await fn();
    return { wert, stderr };
  } finally {
    process.stderr.write = original;
  }
}

export function metaCache(dir) {
  const p = join(dir, ".claude", "board-meta-cache.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
}
