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

// Repo-Root: normalerweise der eigene Ort (<tool-dir>/..). KIT_ROOT ueberschreibt ihn
// und ist ein Test-Hook (Issue #186): So laeuft in Tests das ECHTE Script gegen ein
// Fixture-Verzeichnis, statt dass eine Kopie im Temp-Ordner ausgefuehrt wird — deren
// Coverage liesse sich nicht auf die Repo-Datei abbilden.
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
