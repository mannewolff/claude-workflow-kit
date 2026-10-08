// Rundlauf der Argumente ueber die POSIX-Shell des Kits (Issue #1131, Plan #1128, Abnahme fuer
// E1 und E8).
//
// Die Kommando-Stufe startet ihr Programm ueber `sh` und reicht den Auftrag als Argument `"$@"`
// durch, nie im Shell-String (E9 aus Plan #707). Diese Datei vergleicht Byte fuer Byte, was bei
// einem Node-Fake ankommt: Leerzeichen, Anfuehrungszeichen, `$`, Backslash, Zeilenumbruch,
// Umlaute und ein fuehrender Schraegstrich wie in `/implement-next #1`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { sessionStart } from "../kit/night/session.mjs";

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

// Fuer den Shell-String: einfache Anfuehrungszeichen, ein eingebettetes `'` als `'\''`.
const EINFACH_MASKIERT = String.raw`'\''`;
const quote = (s) => `'${s.replaceAll("'", EINFACH_MASKIERT)}'`;

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

test("[night-shell-rundlauf] Argumente kommen Byte fuer Byte beim Programm an", () => {
  mitFake((kommando) => {
    const res = spawnSync("sh", ["-c", `${kommando} "$@"`, "sh", ...ARGUMENTE]);
    assert.equal(res.status, 0, String(res.stderr));
    assert.deepEqual(res.stdout, Buffer.from(JSON.stringify(ARGUMENTE), "utf-8"),
      `die Argumente kamen veraendert an: ${res.stdout}`);
  });
});

test("[night-shell-rundlauf] der Auftrag der Kommando-Stufe steht nie im Shell-String und kommt unveraendert an", () => {
  const auftrag = ARGUMENTE.join(" | ");
  mitFake((kommando) => {
    const { cmd, cmdArgs } = sessionStart({
      testCmd: null, kommando, prompt: auftrag, modell: "m", args: {}, opts: {},
    });
    assert.equal(cmd, "sh");
    assert.equal(cmdArgs[0], "-c");
    assert.ok(!cmdArgs[1].includes("VERWUNDBAR"), `der Auftrag steht im Shell-String: ${cmdArgs[1]}`);
    assert.equal(cmdArgs.at(-1), auftrag);

    const res = spawnSync(cmd, cmdArgs);
    assert.equal(res.status, 0, String(res.stderr));
    assert.deepEqual(res.stdout, Buffer.from(JSON.stringify([auftrag]), "utf-8"),
      `der Auftrag kam veraendert an: ${res.stdout}`);
  });
});
