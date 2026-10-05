// Die Zerlegung einer Windows-Kommandozeile durch die Git Bash (Issue #1143), fuer die Tests
// von `spawnAufruf` (test/board-wiederholung-git-bash.test.mjs) und der Kommando-Stufe des
// Nacht-Runners (test/night-git-bash.test.mjs).
//
// Die Git Bash ist ein MSYS-Programm und zerlegt ihre Windows-Kommandozeile nicht nach den
// Regeln, nach denen Node sie baut. `msysZerlegen` bildet die Zerlegung der MSYS-Laufzeit
// fuer vollstaendig gequotete Woerter nach (dcrt0.cc, `quoted` und `globify`): `\` schuetzt
// das naechste Zeichen, das Wort endet am ungeschuetzten `"`.

import assert from "node:assert/strict";

export function msysZerlegen(zeile) {
  const wort = /"((?:\\[\s\S]|[^"\\])*)"(?: |$)/y;
  const woerter = [];
  while (wort.lastIndex < zeile.length) {
    const treffer = wort.exec(zeile);
    assert.ok(treffer, `jedes Wort steht in Anfuehrungszeichen: ${zeile.slice(wort.lastIndex)}`);
    woerter.push(treffer[1].replaceAll(/\\([\\"])/g, "$1"));
  }
  return woerter;
}
