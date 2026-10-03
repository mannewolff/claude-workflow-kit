// Plattformneutrale Kommandos fuer test/checks-haengen.test.mjs (Issue #1127).
//
// Unter Windows fuehrt `checks.mjs` jede Pruefung ueber `cmd.exe` aus, das weder
// `&` als Hintergrund, `$!` noch `;` als Trenner kennt. Dieses Skript ersetzt die
// POSIX-Shellsyntax der Tests durch einen Node-Aufruf, der ueberall gleich laeuft:
//
//   node haenger.mjs enkel         startet einen Enkel, schreibt seine PID nach
//                                  `enkel.pid` im Arbeitsverzeichnis und wartet auf ihn
//   node haenger.mjs warte <ms>    wartet <ms> Millisekunden und gibt `fertig` aus

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [modus, wert] = process.argv.slice(2);

if (modus === "enkel") {
  const enkel = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" });
  writeFileSync("enkel.pid", `${enkel.pid}\n`);
  enkel.on("exit", (code) => process.exit(code ?? 1));
} else if (modus === "warte") {
  setTimeout(() => console.log("fertig"), Number(wert));
} else {
  console.error(`haenger.mjs: unbekannter Modus ${modus}`);
  process.exit(2);
}
