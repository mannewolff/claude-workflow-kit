// Gleichlauf der beiden `auskunftArt`-Fassungen (Issue #1027, Plan #1015, E11/E13).
//
// kit/aufwand.mjs traegt eine Kopie des Klassifizierers aus kit/night.mjs, damit
// `aufwand.mjs auskunft` Transkripte mit derselben Regel misst wie der Runner den
// Live-Strom. Dieser Test laesst beide Fassungen ueber dieselben Fixtures laufen und
// zeigt, dass eine abweichende Kopie auffaellt. Er steht unter night-*, weil die Gruppe
// `night-a*` bei Aenderungen an beiden Dateien laeuft (Bereiche aufwand und nacht-einstieg).

import { test } from "node:test";
import assert from "node:assert/strict";

import { auskunftArt as auskunftArtAufwand } from "../kit/aufwand.mjs";
import { auskunftArt as auskunftArtNight, TOOL_RESULTS_PFAD } from "../kit/night.mjs";

const tr = `/Users/x/.claude/projects/-p/0f0e/${TOOL_RESULTS_PFAD}b0x1.txt`;
const bash = (command) => ({ type: "tool_use", id: "t", name: "Bash", input: { command } });
const ART_FIXTURES = [
  bash("node .claude/kit/board.mjs issue get 5"),
  bash("node .claude/kit/board.mjs issue list --status ready"),
  bash("node .claude/kit/board.mjs issue lists"),
  bash("node .claude/kit/board.mjs issue epics"),
  bash("node .claude/kit/board.mjs issue activity 3"),
  bash("node .claude/kit/board.mjs issue auftrag 5"),
  bash("node .claude/kit/board.mjs kontext"),
  bash("node .claude/kit/board.mjs issue move 5 in_progress"),
  bash("node .claude/kit/board.mjs issue melden 5 --text 'x'"),
  bash("gh issue view 12 --comments"),
  bash("glab issue list"),
  bash("sigh issue view 3"),
  bash("gh api repos/o/r/issues/12/comments"),
  bash("gh api repos/o/r/pulls/3"),
  bash("node .claude/kit/board.mjs issue get 5 | jq -r .body"),
  bash("node .claude/kit/board.mjs issue get 5 || python3 -c 'print(1)'"),
  bash("gh issue view 12 --json body | python3 -c 'import sys'"),
  bash("node .claude/kit/board.mjs issue list | node -e 'x'"),
  bash("cat package.json | jq .scripts"),
  bash("echo 1 | jq . ; node .claude/kit/board.mjs issue get 5"),
  bash(`jq -r .body ${tr}`),
  { type: "tool_use", id: "r", name: "Read", input: { file_path: tr } },
  { type: "tool_use", id: "r", name: "Read", input: { file_path: "/Users/x/notiz.txt" } },
  { type: "tool_use", id: "g", name: "Grep", input: { pattern: "Plan", path: tr } },
  { type: "tool_use", id: "b", name: "Bash" },
  { type: "text", text: "node .claude/kit/board.mjs issue get 5" },
  null,
];

function artAbweichungen(kopie) {
  return ART_FIXTURES.filter((b) => kopie(b) !== auskunftArtNight(b));
}

test("[night-1027] Gleichlauf: auskunftArt in aufwand.mjs stimmt auf allen Fixtures mit night.mjs ueberein", () => {
  assert.deepEqual(artAbweichungen(auskunftArtAufwand), []);
  // Die Fixtures decken alle drei Antworten ab — sonst bewiese der Gleichlauf wenig.
  assert.deepEqual(new Set(ART_FIXTURES.map(auskunftArtNight)), new Set(["rueckfrage", "aufbereitung", null]));
});

test("[night-1027] Gleichlauf: eine abweichende Kopie faellt auf", () => {
  const ohnePipe = (b) => (auskunftArtAufwand(b) === "aufbereitung" && b?.input?.command?.includes("|") ? "rueckfrage" : auskunftArtAufwand(b));
  const ohnePfad = (b) => (b?.name === "Read" ? null : auskunftArtAufwand(b));
  const ohneKontext = (b) => (b?.input?.command?.includes("kontext") ? null : auskunftArtAufwand(b));
  assert.notDeepEqual(artAbweichungen(ohnePipe), []);
  assert.notDeepEqual(artAbweichungen(ohnePfad), []);
  assert.notDeepEqual(artAbweichungen(ohneKontext), []);
});
