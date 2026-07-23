// Tests fuer die Pro-App-Token-Aufloesung in kit/board.mjs (Issue #135).
// Laeuft mit dem eingebauten node:test — keine Dependency:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import { resolveToolboxToken } from "../kit/board.mjs";

// readFile-Fake: bildet Pfade auf Inhalte ab, wirft sonst wie readFileSync (ENOENT).
function fakeReadFile(files) {
  return (path) => {
    if (Object.hasOwn(files, path)) return files[path];
    const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
    err.code = "ENOENT";
    throw err;
  };
}

const TOKENS_DIR = join("/fake", "tbx-config");
const TOKENS_JSON = join(TOKENS_DIR, "tokens.json");

test("Precedence 1: TBX_TOKEN gewinnt vor tokenFile und tokens.json (und wird getrimmt)", () => {
  const token = resolveToolboxToken({
    cfg: { toolbox: { tokenFile: "secrets/tbx.token" } },
    env: { TBX_TOKEN: "  env-token \n", TBX_CONFIG_DIR: TOKENS_DIR },
    readFile: fakeReadFile({
      [resolve("secrets/tbx.token")]: "file-token",
      [TOKENS_JSON]: JSON.stringify({ token: "stored-token" }),
    }),
  });
  assert.equal(token, "env-token");
});

test("Whitespace-only TBX_TOKEN zaehlt als nicht gesetzt", () => {
  const token = resolveToolboxToken({
    cfg: { toolbox: { tokenFile: "secrets/tbx.token" } },
    env: { TBX_TOKEN: "   " },
    readFile: fakeReadFile({ [resolve("secrets/tbx.token")]: "file-token" }),
  });
  assert.equal(token, "file-token");
});

test("Precedence 2: tokenFile gewinnt vor tokens.json, Pfad relativ zum cwd, Inhalt getrimmt", () => {
  const gelesen = [];
  const files = {
    [resolve("secrets/tbx.token")]: "  file-token\n",
    [TOKENS_JSON]: JSON.stringify({ token: "stored-token" }),
  };
  const readFile = (path) => { gelesen.push(path); return fakeReadFile(files)(path); };

  const token = resolveToolboxToken({
    cfg: { toolbox: { tokenFile: "secrets/tbx.token" } },
    env: { TBX_CONFIG_DIR: TOKENS_DIR },
    readFile,
  });
  assert.equal(token, "file-token");
  assert.deepEqual(gelesen, [resolve("secrets/tbx.token")]);
});

test("Precedence 3: Fallback auf tokens.json unter TBX_CONFIG_DIR", () => {
  const token = resolveToolboxToken({
    cfg: {},
    env: { TBX_CONFIG_DIR: TOKENS_DIR },
    readFile: fakeReadFile({ [TOKENS_JSON]: JSON.stringify({ token: "stored-token" }) }),
  });
  assert.equal(token, "stored-token");
});

test("Fail-fast: Klartext-Token in der Config bricht ab, auch wenn TBX_TOKEN gesetzt ist", () => {
  assert.throws(
    () => resolveToolboxToken({
      cfg: { toolbox: { token: "klartext" } },
      env: { TBX_TOKEN: "env-token" },
      readFile: fakeReadFile({}),
    }),
    /kein Klartext-Token in workflow\.config\.json.*TBX_TOKEN.*toolbox\.tokenFile/s
  );
});

test("Konfiguriertes, aber unlesbares tokenFile bricht mit klarer Meldung ab (kein stiller Fallback)", () => {
  assert.throws(
    () => resolveToolboxToken({
      cfg: { toolbox: { tokenFile: "secrets/fehlt.token" } },
      env: { TBX_CONFIG_DIR: TOKENS_DIR },
      readFile: fakeReadFile({ [TOKENS_JSON]: JSON.stringify({ token: "stored-token" }) }),
    }),
    /toolbox\.tokenFile.*secrets\/fehlt\.token.*nicht lesbar/s
  );
});

test("Konfiguriertes, aber leeres tokenFile bricht ab", () => {
  assert.throws(
    () => resolveToolboxToken({
      cfg: { toolbox: { tokenFile: "secrets/leer.token" } },
      env: {},
      readFile: fakeReadFile({ [resolve("secrets/leer.token")]: "   \n" }),
    }),
    /toolbox\.tokenFile.*leer/s
  );
});

test("Kein Token auffindbar: Fehlermeldung nennt alle drei Wege", () => {
  assert.throws(
    () => resolveToolboxToken({
      cfg: {},
      env: { TBX_CONFIG_DIR: TOKENS_DIR },
      readFile: fakeReadFile({}),
    }),
    /TBX_TOKEN.*toolbox\.tokenFile.*tbx auth login/s
  );
});

test("Kaputtes tokens.json wird wie fehlendes Token behandelt", () => {
  assert.throws(
    () => resolveToolboxToken({
      cfg: {},
      env: { TBX_CONFIG_DIR: TOKENS_DIR },
      readFile: fakeReadFile({ [TOKENS_JSON]: "kein json {" }),
    }),
    /TBX_TOKEN.*toolbox\.tokenFile.*tbx auth login/s
  );
});
