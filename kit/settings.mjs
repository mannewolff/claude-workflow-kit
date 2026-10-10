#!/usr/bin/env node
/**
 * settings.mjs — englischer Einstieg in kit/einstellungen.mjs (Issue #1462, Plan #1420 E18).
 *
 * Ruft die Nachbardatei einstellungen.mjs mit denselben Argumenten auf und endet mit ihrem
 * Exitcode. Die Quelle wird nicht umbenannt: Hooks, Sandbox-Ausnahmen und Projekte nennen
 * den alten Pfad.
 *
 * Wie die Quelle ist dieser Einstieg Download und nicht Installation: Er wirkt nur neben
 * einer heruntergeladenen einstellungen.mjs und wird darum nicht nach .claude/kit/ gelegt.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const quelle = join(dirname(fileURLToPath(import.meta.url)), "einstellungen.mjs");
const res = spawnSync(process.execPath, [quelle, ...process.argv.slice(2)], { stdio: "inherit" });
if (res.error) {
  process.stderr.write(`settings.mjs: ${quelle} liess sich nicht starten (${res.error.message})\n`);
  process.exit(1);
}
process.exit(res.status ?? 1);
