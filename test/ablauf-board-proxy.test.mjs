// Ablauf-Pruefung: das Verhalten hinter dem Sandbox-Proxy haengt an der Umgebung des Prozesses (HTTPS_PROXY) und am Exitcode von board.mjs; beides zeigt nur ein Programmstart.
//
// board.mjs hinter dem Sandbox-Proxy (Issue #998).
//
// Nodes eingebautes `fetch` nutzt HTTPS_PROXY nur, wenn beim Start
// NODE_USE_ENV_PROXY=1 gesetzt ist. Ohne den Schalter scheitert jeder Board-Aufruf
// in der Sandbox mit "fetch failed". `proxyNeustartNoetig` als reine Funktion steht im
// Board-Teil wiederholung und wird in test/board-wiederholung-entscheidungen.test.mjs
// geprueft (Issue #1215). Hier:
//
//  2. Der Neustart selbst ueber die CLI: Ein `--import`-Fuehler in den execArgv
//     schreibt je Prozessstart eine Zeile. Zwei Zeilen heissen Neustart, und weil
//     der Fuehler auch im Kind wirkt, ist zugleich belegt, dass die execArgv
//     durchgereicht werden.
//  4. Die Umgebung, mit der der Nacht-Runner eine Session startet.
//
// Teil 3, die Meldung am Ende der Wiederholschleife, gehoert zum Toolbox-Adapter und steht
// in test/board-adapter-toolbox-proxy.test.mjs (Issue #1217).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { sessionUmgebung } from "../kit/night.mjs";
import { setupProjekt, BOARD } from "./helpers/board-fixture.mjs";

process.env.TBX_TOKEN = "test-token";
process.env.TBX_CONFIG_DIR = "/nicht/vorhanden";
delete process.env.KIT_AGENT_MODEL;

const PROXY = "http://127.0.0.1:9";

// ============================================================
// 2. Der Neustart ueber die CLI
// ============================================================

const FUEHLER = "data:text/javascript,import{appendFileSync}from'node:fs';"
  + String.raw`appendFileSync(process.env.PROXY_FUEHLER,(process.env.NODE_USE_ENV_PROXY||'-')+'\n')`;

function starts(dir, cliArgs, env) {
  const fuehler = join(dir, "starts.log");
  rmSync(fuehler, { force: true });
  const umgebung = { ...process.env, KIT_ROOT: dir, PROXY_FUEHLER: fuehler, ...env };
  delete umgebung.NODE_USE_ENV_PROXY;
  delete umgebung.HTTPS_PROXY;
  delete umgebung.https_proxy;
  Object.assign(umgebung, env);
  const res = spawnSync(process.execPath, ["--import", FUEHLER, BOARD, ...cliArgs],
    { cwd: dir, encoding: "utf-8", env: umgebung });
  const zeilen = existsSync(fuehler) ? readFileSync(fuehler, "utf-8").trim().split("\n") : [];
  return { res, zeilen };
}

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

test("hinter einem Proxy startet board.mjs genau einmal neu, mit dem Schalter und den execArgv", () => {
  const dir = setupProjekt(LOKAL, "board-proxy-");
  try {
    const { res, zeilen } = starts(dir, ["issue", "list"], { HTTPS_PROXY: PROXY });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(zeilen, ["-", "1"], "erwartet: Elternprozess ohne, Kind mit NODE_USE_ENV_PROXY=1");
    assert.deepEqual(JSON.parse(res.stdout), [], "die Ausgabe des Kinds kommt durch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("der Exitcode des Kinds wird durchgereicht", () => {
  const dir = setupProjekt(LOKAL, "board-proxy-");
  try {
    const { res, zeilen } = starts(dir, ["issue", "gibtsnicht"], { HTTPS_PROXY: PROXY });
    assert.equal(zeilen.length, 2);
    assert.equal(res.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne Proxy und mit gesetztem Schalter startet board.mjs nicht neu", () => {
  const dir = setupProjekt(LOKAL, "board-proxy-");
  try {
    assert.equal(starts(dir, ["issue", "list"], {}).zeilen.length, 1);
    assert.equal(starts(dir, ["issue", "list"], { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: "1" }).zeilen.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--version und die Hilfe brauchen kein Netz und starten nicht neu", () => {
  const dir = setupProjekt(LOKAL, "board-proxy-");
  try {
    const version = starts(dir, ["--version"], { HTTPS_PROXY: PROXY });
    assert.equal(version.res.status, 0);
    assert.match(version.res.stdout, /^board\.mjs \(claude-workflow-kit v/);
    assert.equal(version.zeilen.length, 1);
    for (const hilfe of [[], ["--help"], ["-h"]]) {
      assert.equal(starts(dir, hilfe, { HTTPS_PROXY: PROXY }).zeilen.length, 1, `Hilfe ${hilfe.join(" ")}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 4. Die Umgebung der Nacht-Session
// ============================================================

test("sessionUmgebung setzt NODE_USE_ENV_PROXY=1 neben CLAUDE_CODE_DISABLE_AUTO_MEMORY", () => {
  const env = sessionUmgebung(42, {}, { PATH: "/bin" });
  assert.equal(env.NODE_USE_ENV_PROXY, "1");
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(env.NIGHT_ISSUE_ID, "42");
  assert.equal(env.PATH, "/bin");
});

test("sessionUmgebung: extraEnv kann NODE_USE_ENV_PROXY ueberschreiben", () => {
  const env = sessionUmgebung(42, { NODE_USE_ENV_PROXY: "0", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" }, {});
  assert.equal(env.NODE_USE_ENV_PROXY, "0");
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "0");
});
