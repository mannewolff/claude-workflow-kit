#!/usr/bin/env node
/**
 * copy-downloads-for-docs.mjs — kopiert die zum Download angebotenen Dateien nach
 * docs/public/, damit VitePress sie unveraendert im Site-Root ausliefert
 * (docs.mwolff.org/install.mjs, docs.mwolff.org/board-ui.mjs).
 *
 * Die Kopien unter docs/public/ sind Generate und stehen in .gitignore: Jede Datei
 * ist im Repo genau einmal getrackt. Zwei getrackte Kopien derselben Datei driften
 * auseinander — genau das war am 09.07. die Ursache des Blob-Drifts ueber
 * board-ui.mjs.
 *
 * Laeuft als predev/prebuild-Hook von docs-site.
 *
 * Nutzung: node tools/copy-downloads-for-docs.mjs
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(root, "docs", "public");

// Quellpfade relativ zum Repo-Root. Der Dateiname im Site-Root ergibt sich aus dem
// Basisnamen — er ist Teil der oeffentlichen URL und darf sich nicht verschieben.
const DOWNLOADS = [
  join(root, "install.mjs"),
  join(root, "kit", "board-ui.mjs"),
];

mkdirSync(targetDir, { recursive: true });

for (const source of DOWNLOADS) {
  const target = join(targetDir, basename(source));
  copyFileSync(source, target);
  console.log(`✓ ${basename(source)} kopiert nach ${target}`);
}
