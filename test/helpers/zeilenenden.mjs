// Gemeinsame Zeilenende-Regel der Test-Repos (Issue #1168, wie #1125).
//
// Ein Test-Repo per `git init` erbt die `.gitattributes` des Kit-Repos nicht. Unter Windows
// setzt die gehostete Pruefung `core.autocrlf=true`: Checkt Git dort Dateien aus (Worktree,
// Stash, Reset, Checkout), tragen sie CRLF, und ein Test, der Bytes oder `git status`
// vergleicht, wird rot. Dieselbe Regel wie im Kit-Repo haelt die Dateien bei LF.
//
// Diese Datei enthaelt selbst keine Tests.

import { writeFileSync } from "node:fs";

/** Die Regel aus der `.gitattributes` des Kit-Repos. */
export const LF_REGEL = "* text=auto eol=lf\n";

/**
 * Schreibt die LF-Regel nach `pfad`, gedacht als `join(dir, ".gitattributes")` vor dem
 * ersten Einchecken, damit sie mit eingecheckt wird.
 */
export function lfAttribute(pfad) {
  writeFileSync(pfad, LF_REGEL);
}
