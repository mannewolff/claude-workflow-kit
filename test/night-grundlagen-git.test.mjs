// Die Git-Helfer des Nacht-Runners im selben Prozess (Issue #152, #558, #818, #1224).
//
// `gitReste()` misst, was als unkommittete Arbeit zaehlt, und nimmt die Laufzeit-Dateien des
// Kits aus; dasselbe Kommando nennt der Salvage-Prompt der Session. Seit Issue #1224 nehmen
// die Helfer den git-Aufruf als `spawn` (Plan #1199, E6): Der Test sieht die Argumente und
// gibt die Antwort vor, statt ein Repo anzulegen.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gitResteAusnahmen, gitRestePathspec, salvageSauberkeitsKommando, gitReste, gitClean, lastCommitHash,
  grundlagenAnbinden, ZUSTAND, UMSETZUNG_LOCK, KIT_STAND_MARKIERUNG,
} from "../kit/night/grundlagen.mjs";

grundlagenAnbinden({ laufAbbrechen: (grund) => { throw new Error(`abgebrochen: ${grund}`); } });

/** Ein git, das die Argumente mitschreibt und die Antwort vorgibt. */
function gitAttrappe(antwort) {
  const aufrufe = [];
  const spawn = (befehl, args, optionen) => {
    aufrufe.push({ befehl, args, cwd: optionen.cwd });
    return { status: 0, stdout: "", stderr: "", ...antwort };
  };
  return { spawn, aufrufe };
}

test("die Ausnahmen nennen die Laufzeitpfade des Kits, beim lokalen Tracker auch issuesDir", () => {
  const ausnahmen = gitResteAusnahmen({ issueTracker: "github" });
  for (const pfad of [".claude/night-run-*", UMSETZUNG_LOCK, KIT_STAND_MARKIERUNG, ".claude/wegmarken.tsv", ".claude/protokolle/"]) {
    assert.ok(ausnahmen.includes(pfad), `${pfad} fehlt in den Ausnahmen`);
  }
  assert.equal(ausnahmen.includes("issues"), false);
  assert.equal(gitResteAusnahmen({ issueTracker: "local", local: {} })[0], "issues");
  assert.equal(gitResteAusnahmen({ issueTracker: "local", local: { issuesDir: "karten" } })[0], "karten");
});

test("[night-1254] die vorbereitete Veroeffentlichung stoppt den Rest-Guard nicht", () => {
  const ausnahmen = gitResteAusnahmen({ issueTracker: "github" });
  assert.ok(ausnahmen.includes(".claude/push-vorbereitung.json"), "die Datei der Vorbereitung fehlt in den Ausnahmen");
  assert.ok(gitRestePathspec(ausnahmen).includes(":(exclude).claude/push-vorbereitung.json"));
});

test("die Ausnahmen folgen ohne Argument der geladenen Config", () => {
  const vorher = ZUSTAND.config;
  try {
    ZUSTAND.config = { issueTracker: "local", local: { issuesDir: "aus-der-config" } };
    assert.equal(gitResteAusnahmen()[0], "aus-der-config");
  } finally {
    ZUSTAND.config = vorher;
  }
});

test("der Pathspec schliesst jede Ausnahme aus", () => {
  assert.deepEqual(gitRestePathspec(["a", ".claude/b-*"]), ["--", ".", ":(exclude)a", ":(exclude).claude/b-*"]);
});

test("ein Apostroph im Pfad bleibt im Kommando richtig quotiert", () => {
  assert.equal(salvageSauberkeitsKommando(["it's"]), String.raw`git status --porcelain -- . ':(exclude)it'\''s'`);
});

test("gitReste fragt git status mit dem Pathspec im angegebenen Verzeichnis und liefert die Zeilen", () => {
  const { spawn, aufrufe } = gitAttrappe({ stdout: "?? neu.txt\r\n M alt.txt\n\n" });
  const reste = gitReste("/projekt", { issueTracker: "github" }, { spawn });
  assert.deepEqual(reste, ["?? neu.txt", " M alt.txt"]);
  assert.equal(aufrufe[0].befehl, "git");
  assert.equal(aufrufe[0].cwd, "/projekt");
  assert.deepEqual(aufrufe[0].args, ["status", "--porcelain", ...gitRestePathspec(gitResteAusnahmen({ issueTracker: "github" }))]);
});

test("scheitert git status, bricht gitReste den Lauf ab", () => {
  const schreiben = process.stderr.write;
  process.stderr.write = () => true;
  try {
    assert.throws(() => gitReste("/projekt", null, gitAttrappe({ status: 128 })), /abgebrochen: git status schlug fehl — bin ich im Projekt-Root eines git-Repos\?/);
  } finally {
    process.stderr.write = schreiben;
  }
});

test("gitClean ist die Leerheit von gitReste", () => {
  assert.equal(gitClean("/p", gitAttrappe({ stdout: "" })), true);
  assert.equal(gitClean("/p", gitAttrappe({ stdout: "?? x\n" })), false);
});

test("lastCommitHash liefert den Kurzhash oder ? bei einem Fehlschlag", () => {
  const { spawn, aufrufe } = gitAttrappe({ stdout: "abc1234\n" });
  assert.equal(lastCommitHash("/p", { spawn }), "abc1234");
  assert.deepEqual(aufrufe[0].args, ["log", "-1", "--format=%h"]);
  assert.equal(lastCommitHash("/p", gitAttrappe({ status: 128 })), "?");
});

test("[night-66] eine neue Ausnahme kommt ohne Aenderung am Prompt-Text mit", () => {
  // Die Liste ist der einzige Ort: Was hier hineingereicht wird, steht im Kommando.
  // Waere der Ausschluss im Prompt-Text ausgeschrieben, ginge dieser Fall rot aus.
  const kommando = salvageSauberkeitsKommando([".claude/frisch-erfunden-*", "eigener/pfad"]);
  assert.match(kommando, /^git status --porcelain -- \. /,
    `das Kommando faengt nicht mit dem erwarteten Kopf an: ${kommando}`);
  assert.ok(kommando.includes(":(exclude).claude/frisch-erfunden-*"),
    `die neue Ausnahme fehlt im Kommando: ${kommando}`);
  assert.ok(kommando.includes(":(exclude)eigener/pfad"),
    `die zweite Ausnahme fehlt im Kommando: ${kommando}`);
});
