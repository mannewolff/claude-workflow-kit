// Der Nach-Push-Schritt aus `RELEASING.md` in `/push-main` (Issue #1523).
//
// Nach dem Nachziehen in Schritt 8 steht die Hauptkopie auf dem eben veröffentlichten
// Stand. Genau dann fährt der Skill den Nach-Push-Schritt, den `RELEASING.md` nennt — im
// Kit-Repo `node tools/sync-blobs.mjs`, damit die installierte Kopie diesem Stand folgt.
//
// Geprüft wird Text, nicht Verhalten — wie in test/skills-push-main.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Datei als Text mit LF, damit ein Checkout mit CRLF den Vergleich nicht verfälscht. */
function lies(...teile) {
  return readFileSync(join(repoRoot, ...teile), "utf-8").replaceAll("\r\n", "\n");
}

/** Der Abschnitt ab einer Überschrift bis zur nächsten derselben oder höheren Ebene. */
function abschnitt(text, ueberschrift) {
  const start = text.indexOf(ueberschrift);
  if (start < 0) return null;
  const ebene = ueberschrift.match(/^#+/)[0].length;
  const rest = text.slice(start + ueberschrift.length);
  const ende = rest.search(new RegExp(`\\n#{1,${ebene}} `));
  return ende < 0 ? text.slice(start) : text.slice(start, start + ueberschrift.length + ende);
}

const FASSUNGEN = [
  {
    name: "deutsch",
    text: lies("skills", "push-main", "SKILL.md"),
    schritt8: "### 8. Rückweg, Nachziehen, Worktree abbauen",
    schritt4: "### 4. Release-Dateien erzeugen",
    begriff: "Nach-Push-Schritt",
    wahr: "**`nachziehen: true`**",
    falsch: "**`nachziehen: false`**",
    abbau: "worktree.mjs entfernen",
    rebase: "git rebase origin/<mainBranch>",
  },
  {
    name: "englisch",
    text: lies("en", "skills", "push-main", "SKILL.md"),
    schritt8: "### 8. Way back, catching up, tearing down the worktree",
    schritt4: "### 4. Create release files",
    begriff: "post-push step",
    wahr: "**`nachziehen: true`**",
    falsch: "**`nachziehen: false`**",
    abbau: "worktree.mjs remove",
    rebase: "git rebase origin/<mainBranch>",
  },
];

for (const f of FASSUNGEN) {
  test(`${f.name}: Schritt 8 nennt den Nach-Push-Schritt aus RELEASING.md nach dem Nachziehen, vor dem Abbau`, () => {
    const s8 = abschnitt(f.text, f.schritt8);
    assert.ok(s8, `Schritt 8 fehlt in der ${f.name}en Fassung`);
    const begriff = s8.indexOf(f.begriff);
    assert.ok(begriff >= 0, `Schritt 8 nennt keinen ${f.begriff}`);
    assert.match(s8, /RELEASING\.md/);
    const wahr = s8.indexOf(f.wahr);
    const rebase = s8.indexOf(f.rebase, wahr);
    const abbau = s8.indexOf(f.abbau);
    assert.ok(wahr >= 0 && rebase > wahr, "Nachziehen fehlt");
    // Der Nach-Push-Schritt steht nach dem Rebase und vor dem Abbau.
    const nachRebase = s8.indexOf(f.begriff, rebase);
    assert.ok(nachRebase > rebase && nachRebase < abbau, `${f.begriff} steht nicht zwischen Rebase und Abbau`);
  });

  test(`${f.name}: Schritt 8 fährt den Nach-Push-Schritt nur bei nachziehen: true, sonst steht er im Bericht`, () => {
    const s8 = abschnitt(f.text, f.schritt8);
    const wahr = s8.indexOf(f.wahr);
    const falsch = s8.indexOf(f.falsch);
    assert.ok(falsch > wahr);
    const wahrTeil = s8.slice(wahr, falsch);
    const falschTeil = s8.slice(falsch, s8.indexOf(f.abbau));
    assert.ok(wahrTeil.includes(f.begriff), `der Zweig nachziehen: true nennt den ${f.begriff} nicht`);
    assert.ok(falschTeil.includes(f.begriff), `der Zweig nachziehen: false nennt den ${f.begriff} nicht`);
  });

  test(`${f.name}: Abschnitt Release-Dateien erzeugen kennt den Nach-Push-Schritt`, () => {
    const s4 = abschnitt(f.text, f.schritt4);
    assert.ok(s4, `Schritt 4 fehlt in der ${f.name}en Fassung`);
    assert.ok(s4.includes(f.begriff), `Schritt 4 nennt keinen ${f.begriff}`);
  });
}

test("RELEASING.md nennt unter push main einen Nach-Push-Schritt node tools/sync-blobs.mjs", () => {
  const rel = lies("RELEASING.md");
  const start = rel.indexOf("**Bei `push main`**");
  const ende = rel.indexOf("**Bei `merge production`**");
  assert.ok(start >= 0 && ende > start);
  const teil = rel.slice(start, ende);
  assert.match(teil, /Nach-Push-Schritt[^\n]*`node tools\/sync-blobs\.mjs`/);
});
