#!/usr/bin/env node
/**
 * copy-install-for-docs.mjs — kopiert install.mjs nach docs/public/,
 * damit VitePress es unveraendert unter docs.mwolff.org/install.mjs ausliefert.
 *
 * Nutzung: node tools/copy-install-for-docs.mjs
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "install.mjs");
const targetDir = join(root, "docs", "public");
const target = join(targetDir, "install.mjs");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

console.log(`✓ install.mjs kopiert nach ${target}`);
