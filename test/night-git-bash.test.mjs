// Die Git Bash als POSIX-Shell des Kits unter Windows (Issue #1131, Plan #1128, E1/E2/E8).
//
// Unter Windows gibt es kein `sh`, und `bash` ueber den PATH ist dort haeufig der WSL-Starter
// `C:\Windows\System32\bash.exe` — WSL gilt laut Fachplan #1126 als Linux, nicht als natives
// Windows. Das Kit sucht die Git Bash darum der Reihe nach: `CLAUDE_CODE_GIT_BASH_PATH`, dann
// vom Pfad der im PATH gefundenen `git.exe` aufwaerts bis zu dem Verzeichnis, das
// `bin\bash.exe` enthaelt (E1).
//
// `startbefehlFuer` ist die Startregel aus E8: Eine `.exe` startet direkt; liegt nur eine
// `.cmd`- oder `.bat`-Huelle vor, startet die gleichnamige sh-Huelle daneben ueber die Git
// Bash. Ein `.cmd` ueber `shell: true` faellt aus — Node lehnt das seit CVE-2024-27980 ohne
// Shell ab, und cmd-Quoting kann keine Zeilenumbrueche.
//
// Alles mit injizierter Umgebung, Plattform und Dateisystem: Die Windows-Semantik ist so auf
// jedem Host pruefbar. Die Suche und die Startregel selbst stehen im Board-Teil
// kit/board/wiederholung.mjs und werden in test/board-wiederholung-git-bash.test.mjs
// geprueft (Issue #1215); hier steht, wie der Nacht-Runner sie anwendet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnAufruf, GIT_BASH_UMGEBUNG } from "../kit/board/wiederholung.mjs";
import { posixShell, sessionStart } from "../kit/night.mjs";
import { msysZerlegen } from "./helpers/msys-zerlegen.mjs";

const GIT = String.raw`C:\Program Files\Git`;
const BASH = String.raw`${GIT}\bin\bash.exe`;
const NPM = String.raw`C:\Users\anna\AppData\Roaming\npm`;

/** Ein Dateisystem aus einer Liste vorhandener Pfade, ohne Ruecksicht auf Gross-/Kleinschreibung. */
const dateien = (...pfade) => {
  const da = new Set(pfade.map((p) => p.toLowerCase()));
  return (p) => da.has(p.toLowerCase());
};

const WIN = { plattform: "win32" };

// --- posixShell: sh auf POSIX, Git Bash unter Windows ---

test("[night-git-bash] posixShell liefert auf POSIX sh ohne Zusatzumgebung", () => {
  assert.deepEqual(posixShell({ plattform: "linux", env: {} }), { pfad: "sh", fehler: null, umgebung: {} });
});

test("[night-git-bash] posixShell liefert unter Windows die Git Bash und schaltet die Pfadumwandlung ab", () => {
  const r = posixShell({ ...WIN, env: { PATH: `${GIT}\\cmd` }, existiert: dateien(`${GIT}\\cmd\\git.exe`, BASH) });
  assert.equal(r.pfad, BASH);
  assert.equal(r.fehler, null);
  // Ohne das verwandelte die Git Bash einen Auftrag wie `/implement-next #1` auf dem Weg zu
  // einem nativen Programm in `C:/Program Files/Git/implement-next #1`.
  assert.deepEqual(r.umgebung, GIT_BASH_UMGEBUNG);
  assert.equal(GIT_BASH_UMGEBUNG.MSYS_NO_PATHCONV, "1");
});

test("[night-git-bash] posixShell meldet unter Windows die fehlende Git Bash", () => {
  const r = posixShell({ ...WIN, env: {}, existiert: dateien() });
  assert.equal(r.pfad, null);
  assert.match(r.fehler, /Git Bash nicht gefunden/);
});

const MIT_GIT = { env: { PATH: `${GIT}\\cmd` }, existiert: dateien(`${GIT}\\cmd\\git.exe`, BASH) };

test("[night-git-bash] posixShell kennzeichnet unter Windows den Start ueber die Git Bash", () => {
  assert.equal(posixShell({ ...WIN, ...MIT_GIT }).gitBash, true);
  assert.equal(posixShell({ plattform: "linux", env: {} }).gitBash, undefined);
});

test("[night-git-bash] die Kommando-Stufe startet einen Windows-Pfad mit Backslashes ueber die Git Bash", () => {
  const prog = String.raw`C:\Users\anna\stufen-programm`;
  const s = sessionStart({
    testCmd: null, kommando: prog, prompt: "/implement-next #1", modell: "m", args: {}, opts: {},
    ...WIN, ...MIT_GIT,
  });
  assert.equal(s.startfehler, null);
  assert.equal(s.cmd, BASH);
  // Der Pfad steht mit Schraegstrichen im Shell-String — mit Backslashes verloere er sie in
  // der Shell (`C:UsersRUNNER~1…stufen-programm: command not found`). Der Auftrag steht nie
  // darin, sondern als Argument daneben.
  assert.deepEqual(s.cmdArgs, ["-c", 'C:/Users/anna/stufen-programm "$@"', "sh", "/implement-next #1"]);
  assert.deepEqual(s.umgebung, GIT_BASH_UMGEBUNG);
  assert.equal(s.gitBash, true);

  const r = spawnAufruf(s.cmd, s.cmdArgs, { gitBash: s.gitBash, ...WIN });
  assert.equal(r.optionen.windowsVerbatimArguments, true);
  assert.deepEqual(msysZerlegen(r.args.join(" ")), s.cmdArgs);
});

test("[night-git-bash] fuehrende Zuweisungen und Argumente der Kommandozeile bleiben unberuehrt", () => {
  const s = sessionStart({
    testCmd: null, kommando: String.raw`OLLAMA_HOST=127.0.0.1 D:\runner\lauf.exe --stufe leicht`,
    prompt: "/implement-next #1", modell: "m", args: {}, opts: {}, ...WIN, ...MIT_GIT,
  });
  assert.equal(s.cmdArgs[1], 'OLLAMA_HOST=127.0.0.1 D:/runner/lauf.exe --stufe leicht "$@"');
});

test("[night-git-bash] auf POSIX bleibt die Kommandozeile der Kommando-Stufe woertlich", () => {
  const s = sessionStart({
    testCmd: null, kommando: String.raw`mein\ programm`, prompt: "/implement-next #1", modell: "m",
    args: {}, opts: {}, plattform: "linux", env: {},
  });
  assert.equal(s.cmd, "sh");
  assert.deepEqual(s.cmdArgs, ["-c", String.raw`mein\ programm "$@"`, "sh", "/implement-next #1"]);
  assert.equal(s.gitBash, undefined);
});

test("[night-git-bash] claude ueber seine sh-Huelle ist ein Start ueber die Git Bash", () => {
  const s = sessionStart({
    testCmd: null, kommando: null, prompt: "/implement-next #1", modell: "m", args: {}, opts: {},
    ...WIN,
    env: { PATH: `${NPM};${GIT}\\cmd` },
    existiert: dateien(`${NPM}\\claude.cmd`, `${NPM}\\claude`, `${GIT}\\cmd\\git.exe`, BASH),
  });
  assert.equal(s.cmd, BASH);
  assert.equal(s.gitBash, true);
  assert.deepEqual(s.cmdArgs.slice(0, 3), [`${NPM}\\claude`, "-p", "/implement-next #1"]);
});
