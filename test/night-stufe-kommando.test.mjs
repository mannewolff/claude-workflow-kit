// Der Kommando-Zweig von `runSession` (Issue #710, Plan #707, E9/E10/E17).
//
// Traegt eine Stufe statt eines Modellnamens eine Kommandozeile, startet die Session nicht
// als `claude --model <name>`, sondern ueber `sh -c '<kommando> "$@"' sh <auftrag>`. Zwei
// Dinge daran sind der eigentliche Gegenstand dieser Datei:
//
//   1. Der Auftrag steht als Argument daneben und nie im Shell-String. Ein Auftrag mit
//      Anfuehrungszeichen, `$` und Backtick muss beim Programm woertlich als `$1` ankommen;
//      wuerde er eingesetzt, waere die Einsetzungsluecke im eigenen Haus.
//   2. `KIT_AGENT_MODEL` ist nie leer. Es ist das alleinige Erkennungsmerkmal des
//      unbeaufsichtigten Laufs — ohne Wert hielte sich jeder Skill dieser Session fuer
//      beaufsichtigt und wartete auf eine Antwort, die nachts niemand gibt.
//
// Verdrahtet ist der Zweig in diesem Paket nicht: Ohne `opts.kommando` laeuft alles wie
// bisher, das belegen die uebrigen night-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSession } from "../kit/night.mjs";

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Kommando-Zweig braucht eine POSIX-Shell (Plan #707, E17). Siehe Issue #199." }
  : {};

const ARGS = { model: "fixture-modell", timeoutMin: 1, yolo: false, verbose: false };

async function mitOrdner(fn) {
  const dir = mkdtempSync(join(tmpdir(), "stufe-kommando-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ein Fake-Programm einer Kommando-Stufe: Es schreibt seine Argumente und die Teile der
 * Umgebung, auf die es hier ankommt, in zwei Dateien. Der Pfad traegt keine Leerzeichen —
 * `mkdtemp` unter `tmpdir()` liefert keine —, damit die Kommandozeile so aussieht wie die
 * eines Projekts und nicht wie eine Test-Konstruktion.
 */
function fakeProgramm(dir) {
  const pfad = join(dir, "stufen-programm");
  writeFileSync(pfad, [
    "#!/bin/sh",
    String.raw`printf '%s\n' "$@" > "$NIGHT_ARGS"`,
    "{",
    String.raw`  echo "argc=$#"`,
    String.raw`  echo "modell=$KIT_AGENT_MODEL"`,
    String.raw`  echo "prompt_env=$NIGHT_PROMPT"`,
    '  echo "zuweisung=${MEINE_STUFE-unset}"',
    "} > \"$NIGHT_AUS\"",
    "",
  ].join("\n"), { mode: 0o755 });
  return pfad;
}

/** Die Zeilen aus `$NIGHT_AUS` als Abbildung Schluessel -> Wert. */
function befund(aus) {
  const eintraege = readFileSync(aus, "utf-8").trim().split("\n").map((z) => {
    const i = z.indexOf("=");
    return [z.slice(0, i), z.slice(i + 1)];
  });
  return Object.fromEntries(eintraege);
}

test("[night-34] der Auftrag kommt woertlich als $1 an und wird von der Shell nicht ausgewertet", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const argsDatei = join(dir, "args.txt");
    const prog = fakeProgramm(dir);
    // Anfuehrungszeichen, ein Semikolon mit Folgekommando, ein `$` und ein Backtick: Waere
    // der Auftrag im Shell-String eingesetzt, stuende VERWUNDBAR in der Ausgabe und $HOME
    // waere ersetzt.
    const auftrag = '/implement-next #1 "; echo VERWUNDBAR; # $HOME `id`';
    const res = await runSession("1", ARGS, {
      kommando: prog,
      aufgabenstufe: "leicht",
      stufenName: "lokal",
      prompt: auftrag,
      extraEnv: { NIGHT_AUS: aus, NIGHT_ARGS: argsDatei },
    });
    assert.equal(res.status, 0, res.stderr);
    const daten = befund(aus);
    assert.equal(daten.argc, "1", "der Auftrag muss genau ein Argument sein");
    assert.equal(readFileSync(argsDatei, "utf-8"), `${auftrag}\n`, "der Auftrag kam veraendert an");
    assert.equal(daten.prompt_env, auftrag, "NIGHT_PROMPT steht wie bisher zusaetzlich in der Umgebung");
    assert.ok(!res.stdout.includes("VERWUNDBAR"), `die Shell hat den Auftrag ausgewertet: ${res.stdout}`);
  });
});

test("[night-34] KIT_AGENT_MODEL traegt das Feld name der Stufe", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const argsDatei = join(dir, "args.txt");
    const prog = fakeProgramm(dir);
    await runSession("1", ARGS, {
      kommando: prog,
      aufgabenstufe: "leicht",
      stufenName: "ollama-qwen",
      extraEnv: { NIGHT_AUS: aus, NIGHT_ARGS: argsDatei },
    });
    assert.equal(befund(aus).modell, "ollama-qwen");
  });
});

test("[night-34] ohne name traegt KIT_AGENT_MODEL stufe-<aufgabenstufe> und ist nie leer", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const argsDatei = join(dir, "args.txt");
    const prog = fakeProgramm(dir);
    await runSession("1", ARGS, {
      kommando: prog,
      aufgabenstufe: "leicht",
      extraEnv: { NIGHT_AUS: aus, NIGHT_ARGS: argsDatei },
    });
    const daten = befund(aus);
    assert.equal(daten.modell, "stufe-leicht");
    assert.notEqual(daten.modell, "", "KIT_AGENT_MODEL darf in keinem Fall leer sein");
  });
});

test("[night-34] im Kommando-Zweig erscheint --model nicht in der Argumentliste", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const argsDatei = join(dir, "args.txt");
    const prog = fakeProgramm(dir);
    await runSession("1", ARGS, {
      kommando: prog,
      aufgabenstufe: "mittel",
      stufenName: "lokal",
      extraEnv: { NIGHT_AUS: aus, NIGHT_ARGS: argsDatei },
    });
    const argumente = readFileSync(argsDatei, "utf-8").trim().split("\n");
    assert.deepEqual(argumente, ["/implement-next #1"], `unerwartete Argumente: ${argumente.join(" ")}`);
    assert.ok(!argumente.includes("--model"));
  });
});

test("[night-34] eine fuehrende NAME=WERT-Zuweisung startet und kommt in der Umgebung des Programms an", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const argsDatei = join(dir, "args.txt");
    const prog = fakeProgramm(dir);
    const res = await runSession("1", ARGS, {
      kommando: `MEINE_STUFE=hallo ${prog}`,
      aufgabenstufe: "leicht",
      extraEnv: { NIGHT_AUS: aus, NIGHT_ARGS: argsDatei },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(befund(aus).zuweisung, "hallo");
  });
});

test("[night-34] fehlt sh, meldet runSession einen Startfehler an den Aufrufer statt den Lauf zu beenden", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const leer = join(dir, "leer");
    mkdirSync(leer);
    const prog = fakeProgramm(dir);
    // Ein PATH ohne `sh`: Der Spawn scheitert mit ENOENT — derselbe Befund wie unter
    // Windows, wo es die Shell nicht gibt (E17). Wuerde der Zweig weiter `fail()` rufen,
    // beendete process.exit(1) den Testlauf hier.
    const res = await runSession("1", ARGS, {
      kommando: prog,
      aufgabenstufe: "leicht",
      stufenName: "lokal",
      extraEnv: { PATH: leer },
    });
    assert.equal(res.error?.code, "ENOENT");
    assert.ok(res.startfehler, "der Startfehler fehlt im Rueckgabewert");
    assert.match(res.startfehler, /sh/i);
  });
});

test("[night-34] NIGHT_CLAUDE_CMD hat weiterhin Vorrang, auch wenn kommando gesetzt ist", NUR_POSIX, async () => {
  await mitOrdner(async (dir) => {
    const aus = join(dir, "aus.txt");
    const argsDatei = join(dir, "args.txt");
    const hookAus = join(dir, "hook.txt");
    const prog = fakeProgramm(dir);
    process.env.NIGHT_CLAUDE_CMD = `echo "hook=$KIT_AGENT_MODEL" > "$NIGHT_HOOK"`;
    try {
      await runSession("1", ARGS, {
        kommando: prog,
        aufgabenstufe: "leicht",
        stufenName: "lokal",
        extraEnv: { NIGHT_AUS: aus, NIGHT_ARGS: argsDatei, NIGHT_HOOK: hookAus },
      });
    } finally {
      delete process.env.NIGHT_CLAUDE_CMD;
    }
    assert.ok(existsSync(hookAus), "der Test-Hook lief nicht");
    assert.ok(!existsSync(aus), "das Programm der Stufe darf im Hook-Zweig nicht starten");
  });
});
