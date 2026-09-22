// `runSession` mit cwd, Strom und Stufe (Plan #638, A4/A5/A14; Issue #642).
//
// Drei Dinge, die die Kette braucht und der Implementierungslauf nicht: die Session laeuft
// im Worktree (`cwd`), sie fordert den stream-json-Strom unabhaengig von --verbose an
// (sonst gibt es keine Kosten fuer das Budget), und sie traegt NIGHT_KETTE_STUFE in der
// Umgebung — neben KIT_AGENT_MODEL, das unveraendert das Erkennungsmerkmal der Skills
// bleibt. Der Implementierungslauf ruft `runSession` ohne diese Optionen und verhaelt
// sich wie zuvor; das belegen die bestehenden night-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSession, leseKennzahlen } from "../kit/night.mjs";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const ARGS = { model: "fixture-modell", timeoutMin: 1, yolo: false, verbose: false };

async function mitOrdner(fn) {
  const dir = mkdtempSync(join(tmpdir(), "kette-session-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[night-18] runSession startet den Fake im uebergebenen cwd und setzt NIGHT_KETTE_STUFE neben KIT_AGENT_MODEL", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const worktree = join(dir, "wt");
    mkdirSync(worktree);
    const aus = join(dir, "aus.txt");
    process.env.NIGHT_CLAUDE_CMD = `pwd > "$NIGHT_AUS"; echo "stufe=$NIGHT_KETTE_STUFE" >> "$NIGHT_AUS"; echo "modell=$KIT_AGENT_MODEL" >> "$NIGHT_AUS"; echo "prompt=$NIGHT_PROMPT" >> "$NIGHT_AUS"`;
    try {
      const res = await runSession("635", ARGS, { cwd: worktree, stufe: "plan", prompt: "/techplan #635", extraEnv: { NIGHT_AUS: aus } });
      assert.equal(res.status, 0, res.stderr);
    } finally {
      delete process.env.NIGHT_CLAUDE_CMD;
    }
    const zeilen = readFileSync(aus, "utf-8").trim().split("\n");
    assert.equal(realpathSync(zeilen[0]), realpathSync(worktree), "der Fake lief nicht im Worktree");
    assert.equal(zeilen[1], "stufe=plan");
    assert.equal(zeilen[2], "modell=fixture-modell", "KIT_AGENT_MODEL bleibt gesetzt");
    assert.equal(zeilen[3], "prompt=/techplan #635");
  });
});

test("[night-18] ohne stufe steht NIGHT_KETTE_STUFE nicht in der Umgebung, ohne cwd laeuft der Fake im cwd des Runners", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    process.env.NIGHT_CLAUDE_CMD = `pwd > "$NIGHT_AUS"; echo "stufe=\${NIGHT_KETTE_STUFE-unset}" >> "$NIGHT_AUS"`;
    try {
      await runSession("1", ARGS, { extraEnv: { NIGHT_AUS: aus } });
    } finally {
      delete process.env.NIGHT_CLAUDE_CMD;
    }
    const zeilen = readFileSync(aus, "utf-8").trim().split("\n");
    assert.equal(realpathSync(zeilen[0]), realpathSync(process.cwd()));
    assert.equal(zeilen[1], "stufe=unset");
  });
});

/** Ein Fake-`claude` im PATH, das seine Argumente protokolliert und ein result-Ereignis liefert. */
function fakeClaude(dir) {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), [
    "#!/bin/sh",
    String.raw`printf "%s\n" "$@" > "$NIGHT_AUS"`,
    `echo '{"type":"result","total_cost_usd":1.25,"duration_api_ms":10,"num_turns":2}'`,
    "",
  ].join("\n"), { mode: 0o755 });
  return bin;
}

test("[night-18] mit stream: true fordert die Session stream-json auch ohne --verbose an, und leseKennzahlen liefert die Kosten", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const bin = fakeClaude(dir);
    const pathVorher = process.env.PATH;
    process.env.PATH = `${bin}:${pathVorher}`;
    let res;
    try {
      res = await runSession("635", ARGS, { stream: true, prompt: "/techplan #635", extraEnv: { NIGHT_AUS: aus } });
    } finally {
      process.env.PATH = pathVorher;
    }
    assert.ok(existsSync(aus), "der Fake wurde nicht gestartet");
    const argumente = readFileSync(aus, "utf-8").trim().split("\n");
    assert.ok(argumente.includes("--output-format"), `stream-json fehlt: ${argumente.join(" ")}`);
    assert.ok(argumente.includes("stream-json"));
    // stopReason und isError seit Issue #668 im Vertrag; die Fixture-Zeile dieses Tests
    // traegt sie nicht, also stehen sie auf null — das ist der Wert fuer "nicht gemessen".
    assert.deepEqual(leseKennzahlen(res.stdout), { kostenUsd: 1.25, apiDauerMs: 10, zuege: 2, stopReason: null, isError: null, eingabeTokens: null, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null, cache5mTokens: null, cache1hTokens: null });
  });
});

test("[night-18] ohne stream und ohne --verbose bleibt die Kommandozeile wie zuvor", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const bin = fakeClaude(dir);
    const pathVorher = process.env.PATH;
    process.env.PATH = `${bin}:${pathVorher}`;
    try {
      await runSession("1", ARGS, { extraEnv: { NIGHT_AUS: aus } });
    } finally {
      process.env.PATH = pathVorher;
    }
    const argumente = readFileSync(aus, "utf-8").trim().split("\n");
    assert.ok(!argumente.includes("--output-format"), "ohne stream darf kein stream-json angefordert werden");
    assert.deepEqual(argumente.slice(0, 4), ["-p", "/implement-next #1", "--model", "fixture-modell"]);
  });
});
