// Gemeinsame Hilfen der GitHub-Adapter-Tests (Issue #188, geteilt mit Issue #836).
//
// Die Tests des GitHub-Adapters liegen in drei Dateien — Lesen, Project und Schreiben —,
// weil eine einzelne Datei ihre Tests nacheinander faehrt und damit die Wandzeit der
// Suite nach unten begrenzte (Issue #836). Was alle drei brauchen, steht hier: das
// Fake-`gh` samt Basisantworten, die Project-Konfiguration und der Blick in den
// Meta-Cache. Doppelt gepflegt wird davon nichts.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, fakeCli } from "./board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
export const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};

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

export function metaCache(dir) {
  const p = join(dir, ".claude", "board-meta-cache.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
}
