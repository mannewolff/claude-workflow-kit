// Git Bash und Spawn, der Board-Teil kit/board/wiederholung.mjs (Issue #1131, Plan #1128,
// E1/E2/E8; als Teil seit Issue #1215, Plan #1199, E17).
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
// jedem Host pruefbar. Wie der Nacht-Runner diese Regeln anwendet (posixShell, sessionStart),
// prueft test/night-git-bash.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { gitBashPfad, startbefehlFuer, spawnAufruf, GIT_BASH_UMGEBUNG } from "../kit/board/wiederholung.mjs";
import { msysZerlegen } from "./helpers/msys-zerlegen.mjs";

const GIT = String.raw`C:\Program Files\Git`;
const BASH = String.raw`${GIT}\bin\bash.exe`;
const NPM = String.raw`C:\Users\anna\AppData\Roaming\npm`;
const SYSTEM32 = String.raw`C:\Windows\System32`;

/** Ein Dateisystem aus einer Liste vorhandener Pfade, ohne Ruecksicht auf Gross-/Kleinschreibung. */
const dateien = (...pfade) => {
  const da = new Set(pfade.map((p) => p.toLowerCase()));
  return (p) => da.has(p.toLowerCase());
};

const WIN = { plattform: "win32" };

// --- gitBashPfad: die Reihenfolge aus E1 ---

test("[board-wiederholung-git-bash] CLAUDE_CODE_GIT_BASH_PATH geht der Suche ueber git vor", () => {
  const eigene = String.raw`D:\tools\git\bin\bash.exe`;
  const r = gitBashPfad({
    ...WIN,
    env: { CLAUDE_CODE_GIT_BASH_PATH: eigene, PATH: `${GIT}\\cmd` },
    existiert: dateien(eigene, `${GIT}\\cmd\\git.exe`, BASH),
  });
  assert.deepEqual(r, { pfad: eigene, fehler: null });
});

test("[board-wiederholung-git-bash] ein CLAUDE_CODE_GIT_BASH_PATH, der nicht existiert, faellt auf die Suche ueber git zurueck", () => {
  const r = gitBashPfad({
    ...WIN,
    env: { CLAUDE_CODE_GIT_BASH_PATH: String.raw`D:\weg\bash.exe`, PATH: `${GIT}\\cmd` },
    existiert: dateien(`${GIT}\\cmd\\git.exe`, BASH),
  });
  assert.equal(r.pfad, BASH);
});

for (const ort of ["cmd", "bin", String.raw`mingw64\bin`]) {
  test(`[board-wiederholung-git-bash] von ${ort}\\git.exe aufwaerts findet die Suche bin\\bash.exe`, () => {
    const r = gitBashPfad({
      ...WIN,
      env: { PATH: `${SYSTEM32};${GIT}\\${ort}` },
      existiert: dateien(`${GIT}\\${ort}\\git.exe`, BASH),
    });
    assert.deepEqual(r, { pfad: BASH, fehler: null });
  });
}

test("[board-wiederholung-git-bash] die Suche nimmt PATHEXT und die Schreibweise Path der Windows-Umgebung", () => {
  const r = gitBashPfad({
    ...WIN,
    env: { Path: `${GIT}\\cmd`, PATHEXT: ".COM;.EXE" },
    existiert: dateien(`${GIT}\\cmd\\git.EXE`, BASH),
  });
  assert.equal(r.pfad, BASH);
});

test(String.raw`[board-wiederholung-git-bash] System32\bash.exe im PATH ist nie die Git Bash`, () => {
  const r = gitBashPfad({
    ...WIN,
    env: { PATH: SYSTEM32 },
    existiert: dateien(`${SYSTEM32}\\bash.exe`, `${SYSTEM32}\\wsl.exe`),
  });
  assert.equal(r.pfad, null);
  assert.match(r.fehler, /^Git Bash nicht gefunden \(Voraussetzung unter Windows\)/);
});

test("[board-wiederholung-git-bash] ohne git und ohne Variable meldet die Suche die fehlende Git Bash", () => {
  const r = gitBashPfad({ ...WIN, env: { PATH: "" }, existiert: dateien() });
  assert.equal(r.pfad, null);
  assert.match(r.fehler, /Git Bash nicht gefunden \(Voraussetzung unter Windows\)/);
});

test(String.raw`[board-wiederholung-git-bash] git ohne bin\bash.exe in einem der Elternverzeichnisse ist kein Fund`, () => {
  const r = gitBashPfad({
    ...WIN,
    env: { PATH: String.raw`C:\portable\git\cmd` },
    existiert: dateien(String.raw`C:\portable\git\cmd\git.exe`),
  });
  assert.equal(r.pfad, null);
  assert.match(r.fehler, /Git Bash nicht gefunden/);
});

// --- startbefehlFuer: die Startregel aus E8 ---

test("[board-wiederholung-git-bash] auf POSIX startet ein Programm unveraendert ueber seinen Namen", () => {
  assert.deepEqual(startbefehlFuer("claude", { plattform: "darwin", env: {} }),
    { befehl: "claude", vorArgs: [], umgebung: {}, fehler: null });
});

test("[board-wiederholung-git-bash] eine .exe startet direkt", () => {
  const exe = String.raw`C:\Programme\claude\claude.exe`;
  const r = startbefehlFuer("claude", {
    ...WIN,
    env: { PATH: String.raw`C:\Programme\claude` },
    existiert: dateien(exe),
  });
  // Die Endung kommt aus PATHEXT und traegt deren Schreibweise; Windows unterscheidet nicht.
  assert.equal(r.befehl.toLowerCase(), exe.toLowerCase());
  assert.deepEqual({ ...r, befehl: exe }, { befehl: exe, vorArgs: [], umgebung: {}, fehler: null });
});

test("[board-wiederholung-git-bash] eine .cmd mit sh-Huelle daneben startet die Huelle ueber die Git Bash", () => {
  const r = startbefehlFuer("claude", {
    ...WIN,
    env: { PATH: `${NPM};${GIT}\\cmd` },
    existiert: dateien(`${NPM}\\claude.cmd`, `${NPM}\\claude`, `${GIT}\\cmd\\git.exe`, BASH),
  });
  assert.deepEqual(r, { befehl: BASH, vorArgs: [`${NPM}\\claude`], umgebung: GIT_BASH_UMGEBUNG, gitBash: true, fehler: null });
});

test("[board-wiederholung-git-bash] eine .bat mit sh-Huelle folgt derselben Regel", () => {
  const r = startbefehlFuer("codex", {
    ...WIN,
    env: { PATH: `${NPM};${GIT}\\cmd`, PATHEXT: ".BAT;.EXE" },
    existiert: dateien(`${NPM}\\codex.BAT`, `${NPM}\\codex`, `${GIT}\\cmd\\git.exe`, BASH),
  });
  assert.equal(r.befehl, BASH);
  assert.deepEqual(r.vorArgs, [`${NPM}\\codex`]);
});

test("[board-wiederholung-git-bash] eine .cmd ohne sh-Huelle ist ohne cmd.exe nicht startbar", () => {
  const r = startbefehlFuer("claude", {
    ...WIN,
    env: { PATH: `${NPM};${GIT}\\cmd` },
    existiert: dateien(`${NPM}\\claude.cmd`, `${GIT}\\cmd\\git.exe`, BASH),
  });
  assert.equal(r.befehl, null);
  assert.match(r.fehler, /claude/);
  assert.match(r.fehler, /nicht ohne cmd\.exe startbar/);
});

test("[board-wiederholung-git-bash] eine .cmd mit Huelle, aber ohne Git Bash nennt die fehlende Git Bash", () => {
  const r = startbefehlFuer("claude", {
    ...WIN,
    env: { PATH: NPM },
    existiert: dateien(`${NPM}\\claude.cmd`, `${NPM}\\claude`),
  });
  assert.equal(r.befehl, null);
  assert.match(r.fehler, /Git Bash nicht gefunden/);
});

test("[board-wiederholung-git-bash] ein Programm, das nicht im PATH liegt, bleibt beim Namen und scheitert erst beim Start", () => {
  // So greift weiter die bestehende Meldung zum fehlenden claude-CLI (ENOENT des Spawns).
  const r = startbefehlFuer("claude", { ...WIN, env: { PATH: NPM }, existiert: dateien() });
  assert.deepEqual(r, { befehl: "claude", vorArgs: [], umgebung: {}, fehler: null });
});

// --- Die Kommandozeile eines Starts ueber die Git Bash (Issue #1143) ---
//
// Die Git Bash ist ein MSYS-Programm und zerlegt ihre Windows-Kommandozeile nicht nach den
// Regeln, nach denen Node sie baut: In Anfuehrungszeichen wird `\\` zu `\`, und ein Wort
// mit `*`, `?`, `[` oder `{` laeuft durch die Dateinamen-Erweiterung. Der CI-Lauf zu
// v3.6.0 zeigte das am Argument `C:\Users\anna\pfad\ \\ende\\`, das mit einem Backslash
// weniger ankam. `msysZerlegen` (test/helpers/msys-zerlegen.mjs) bildet die Zerlegung der MSYS-Laufzeit fuer vollstaendig
// gequotete Woerter nach (dcrt0.cc, `quoted` und `globify`): `\` schuetzt das naechste
// Zeichen, das Wort endet am ungeschuetzten `"`.

const UNTER_WINDOWS = [
  "/implement-next #1",
  "mit Leerzeichen  doppelt",
  `"doppelt" und 'einfach'`,
  String.raw`C:\Users\anna\pfad\ \\ende\\`,
  "erste Zeile\nzweite Zeile\n",
  "Grüße aus Köln",
  "",
  "*.mjs {a,b} [x] ~ ?",
  String.raw`\"`,
];

test("[board-wiederholung-git-bash] ein Start ueber die Git Bash schreibt seine Kommandozeile selbst und woertlich", () => {
  const r = spawnAufruf(BASH, ["-c", 'C:/prog "$@"', "sh", "/implement-next #1"], { gitBash: true, ...WIN });
  assert.equal(r.befehl, BASH);
  assert.deepEqual(r.optionen, { windowsVerbatimArguments: true, argv0: `"${BASH}"` });
  assert.deepEqual(r.args, ['"-c"', String.raw`"C:/prog \"$@\""`, '"sh"', '"/implement-next #1"']);
});

test("[board-wiederholung-git-bash] jedes Argument kommt nach der Zerlegung der Git Bash Byte fuer Byte an", () => {
  const r = spawnAufruf(BASH, UNTER_WINDOWS, { gitBash: true, ...WIN });
  assert.deepEqual(msysZerlegen(r.args.join(" ")), UNTER_WINDOWS);
});

test("[board-wiederholung-git-bash] ohne Git Bash bleibt der Start unveraendert", () => {
  const args = ["-p", String.raw`a\\b "c"`];
  assert.deepEqual(spawnAufruf("claude", args), { befehl: "claude", args, optionen: {} });
  assert.deepEqual(spawnAufruf("sh", args, { gitBash: false, ...WIN }), { befehl: "sh", args, optionen: {} });
});

test("[board-wiederholung-git-bash] eine injizierte Windows-Shell startet auf einem POSIX-Rechner mit unveraenderten Argumenten", () => {
  // Die Kommandozeile gibt es nur unter Windows; auf POSIX gehen die Argumente als argv.
  const args = ["-c", 'command -v -- "$1"', "sh", "prog"];
  assert.deepEqual(spawnAufruf(BASH, args, { gitBash: true, plattform: "linux" }), { befehl: BASH, args, optionen: {} });
});

