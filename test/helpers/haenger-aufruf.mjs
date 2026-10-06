// Der Aufruf von `haenger.mjs` als Pruefkommando (Issue #1127, #1212) — gemeinsam fuer
// `checks-haengen.test.mjs` und `ablauf-checks-haengen.test.mjs`.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Der Helfer, der haengt oder kurz wartet; siehe `haenger.mjs`. */
export const HAENGER_HELFER = join(dirname(fileURLToPath(import.meta.url)), "haenger.mjs");

/**
 * Die Kommandozeile, die `haenger.mjs` mit `args` startet. Ein Node-Skript statt
 * POSIX-Shellsyntax: Unter Windows laeuft jede Pruefung ueber eine Shell, die `&`, `$!`
 * und `;` nicht so kennt (Issue #1127).
 */
export function helferAufruf(...args) {
  return [process.execPath, HAENGER_HELFER].map((p) => `"${p}"`).concat(args).join(" ");
}

/** Lebt der Prozess `pid` noch? */
export function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
