// Rundlauf der Argumente ueber die POSIX-Shell des Kits (Issue #1131, Plan #1128, Abnahme fuer
// E1 und E8).
//
// Die Kommando-Stufe startet ihr Programm ueber `posixShell()` — `sh` auf POSIX, die Git Bash
// unter Windows — und reicht den Auftrag als Argument `"$@"` durch, nie im Shell-String (E9 aus
// Plan #707). Diese Datei laeuft auf allen Plattformen und vergleicht Byte fuer Byte, was bei
// einem Node-Fake ankommt: Leerzeichen, Anfuehrungszeichen, `$`, Backslash, Zeilenumbruch,
// Umlaute und ein fuehrender Schraegstrich wie in `/implement-next #1`. Den letzten verwandelt
// die Git Bash auf dem Weg zu einem nativen Programm sonst in einen Windows-Pfad.
//
// Gestartet wird wie im Kit ueber `spawnAufruf` (Issue #1143): Die Git Bash zerlegt ihre
// Windows-Kommandozeile nach eigenen Regeln, und erst die selbst geschriebene Kommandozeile
// bringt `\\` in Anfuehrungszeichen unveraendert an. Auf POSIX aendert der Aufruf nichts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { posixShell, sessionStart } from "../kit/night.mjs";
import { spawnAufruf } from "../kit/board.mjs";

const ARGUMENTE = [
  "/implement-next #1131",
  "mit Leerzeichen  doppelt",
  `"doppelt" und 'einfach'`,
  "$HOME ${PATH} $(echo VERWUNDBAR) `echo VERWUNDBAR`",
  String.raw`C:\Users\anna\pfad\ \\ende\\`,
  "erste Zeile\nzweite Zeile\n",
  "Grüße aus Köln: äöüß ÄÖÜ €",
  "",
  "; echo VERWUNDBAR; #",
];

// Fuer den Shell-String: einfache Anfuehrungszeichen, ein eingebettetes `'` als `'\''`. Die
// Git Bash nimmt Windows-Pfade mit Schraegstrichen, darum werden Backslashes umgestellt —
// das betrifft nur die festen Pfade des Tests, nie die Argumente.
const EINFACH_MASKIERT = String.raw`'\''`;
const quote = (s) => `'${s.replaceAll("\\", "/").replaceAll("'", EINFACH_MASKIERT)}'`;

function mitFake(fn) {
  const dir = mkdtempSync(join(tmpdir(), "shell-rundlauf-"));
  try {
    const fake = join(dir, "fake.mjs");
    writeFileSync(fake, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    return fn(`${quote(process.execPath)} ${quote(fake)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const shell = posixShell();

test("[night-shell-rundlauf] die POSIX-Shell des Kits ist auf dieser Plattform vorhanden", () => {
  assert.equal(shell.fehler, null, shell.fehler);
  assert.ok(shell.pfad);
});

test("[night-shell-rundlauf] Argumente kommen Byte fuer Byte beim Programm an", () => {
  mitFake((kommando) => {
    const aufruf = spawnAufruf(shell.pfad, ["-c", `${kommando} "$@"`, "sh", ...ARGUMENTE], shell);
    const res = spawnSync(aufruf.befehl, aufruf.args, {
      ...aufruf.optionen,
      env: { ...process.env, ...shell.umgebung },
    });
    assert.equal(res.status, 0, String(res.stderr));
    assert.deepEqual(res.stdout, Buffer.from(JSON.stringify(ARGUMENTE), "utf-8"),
      `die Argumente kamen veraendert an: ${res.stdout}`);
  });
});

test("[night-shell-rundlauf] der Auftrag der Kommando-Stufe steht nie im Shell-String und kommt unveraendert an", () => {
  const auftrag = ARGUMENTE.join(" | ");
  mitFake((kommando) => {
    const { cmd, cmdArgs, umgebung, gitBash } = sessionStart({
      testCmd: null, kommando, prompt: auftrag, modell: "m", args: {}, opts: {},
    });
    assert.equal(cmd, shell.pfad);
    assert.equal(cmdArgs[0], "-c");
    assert.ok(!cmdArgs[1].includes("VERWUNDBAR"), `der Auftrag steht im Shell-String: ${cmdArgs[1]}`);
    assert.equal(cmdArgs.at(-1), auftrag);

    const aufruf = spawnAufruf(cmd, cmdArgs, { gitBash });
    const res = spawnSync(aufruf.befehl, aufruf.args, { ...aufruf.optionen, env: { ...process.env, ...umgebung } });
    assert.equal(res.status, 0, String(res.stderr));
    assert.deepEqual(res.stdout, Buffer.from(JSON.stringify([auftrag]), "utf-8"),
      `der Auftrag kam veraendert an: ${res.stdout}`);
  });
});
