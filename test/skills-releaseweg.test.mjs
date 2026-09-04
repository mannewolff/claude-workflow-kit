// Prueflauf vor jedem Commit des Release-Wegs (Issue #472, Plan #467 A10).
//
// Der Release-Weg erzeugt fuenf Commits, nicht drei: den Spec-Commit im
// push-main-Skill, dazu Version-Commit und `--amend` in JEDER der beiden
// Ablauflisten von RELEASING.md (`push main` und `merge production`). Ohne einen
// eigenen Nachweis je Commit weist das Gate aus Issue #470 sie ab — und
// `merge production` ist der Weg nach production.
//
// Gemessen wird die REIHENFOLGE im Text, und zwar zwischen benachbarten Markern:
// Ein einzelner Aufruf am Dateianfang wuerde eine Pruefung "vor jedem Commit" nur
// vortaeuschen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

const LAUF = /node \.claude\/kit\/checks\.mjs run/g;
const LAUF_EINZELN = /node \.claude\/kit\/checks\.mjs run/;

/** Alle Positionen eines Musters im Text. */
function stellen(text, muster) {
  return [...text.matchAll(muster)].map((m) => m.index);
}

/**
 * Belegt, dass vor jedem Marker ein Prueflauf steht — gemessen ab dem
 * vorhergehenden Marker, nicht ab dem Dateianfang.
 */
function prueflaufVorJedemMarker(text, marker, wo) {
  const laeufe = stellen(text, LAUF);
  let vorher = 0;
  for (const { name, muster } of marker) {
    const treffer = stellen(text, muster);
    assert.equal(treffer.length > 0, true, `${wo}: Marker '${name}' nicht gefunden`);
    const pos = treffer.find((p) => p > vorher);
    assert.notEqual(pos, undefined, `${wo}: Marker '${name}' liegt nicht nach dem vorigen`);
    const dazwischen = laeufe.filter((l) => l > vorher && l < pos);
    assert.equal(dazwischen.length >= 1, true,
      `${wo}: zwischen '${name}' und dem vorigen Commit fehlt ein checks.mjs run`);
    vorher = pos;
  }
}

test("[skills-1] push-main faehrt einen Prueflauf vor dem Spec-Commit", () => {
  for (const pfad of [["skills", "push-main", "SKILL.md"], [".claude", "skills", "push-main", "SKILL.md"]]) {
    const text = lies(...pfad);
    prueflaufVorJedemMarker(text, [
      { name: "Spec-Commit", muster: /git commit -m "chore: Spec fortgeschrieben/g },
    ], pfad.join("/"));
  }
});

test("[skills-1] RELEASING.md faehrt in BEIDEN Ablauflisten einen Prueflauf vor Version-Commit und Amend", () => {
  const text = lies("RELEASING.md");
  const ablauf = text.slice(text.indexOf("## Ablauf"), text.indexOf("**Nicht umdrehen:**"));
  // Vier Marker in Reihenfolge: push main (Commit, Amend), merge production (Commit, Amend).
  prueflaufVorJedemMarker(ablauf, [
    { name: "Version-Commit (push main)", muster: /chore: vX\.Y\.Z/g },
    { name: "Amend (push main)", muster: /git commit --amend --no-edit/g },
    { name: "Version-Commit (merge production)", muster: /chore: vX\.Y\.Z/g },
    { name: "Amend (merge production)", muster: /git commit --amend --no-edit/g },
  ], "RELEASING.md");
});

test("[skills-1] merge-production nennt den Prueflauf vor seinen Release-Schritten", () => {
  for (const pfad of [["skills", "merge-production", "SKILL.md"], [".claude", "skills", "merge-production", "SKILL.md"]]) {
    const text = lies(...pfad);
    assert.match(text, LAUF_EINZELN, `${pfad.join("/")}: der Prueflauf fehlt`);
  }
});

test("[skills-1] kein neuer Prueflauf traegt --since", () => {
  // Der Anker ist HEAD: Gemessen wird der uncommittete Stand, der gleich in den
  // Commit geht — nicht der Batch seit merge-base wie in /local-check.
  for (const teile of [["RELEASING.md"], ["skills", "push-main", "SKILL.md"], ["skills", "merge-production", "SKILL.md"]]) {
    const text = lies(...teile);
    for (const m of text.matchAll(/node \.claude\/kit\/checks\.mjs run([^\n]*)/g)) {
      assert.doesNotMatch(m[1], /--since/, `${teile.join("/")}: '${m[0]}' traegt einen Anker`);
    }
  }
});

test("[skills-1] die Reihenfolge der Release-Schritte ist unveraendert", () => {
  const text = lies("RELEASING.md");
  const ablauf = text.slice(text.indexOf("## Ablauf"), text.indexOf("**Nicht umdrehen:**"));
  const folge = ["version.mjs --patch", "sync-blobs.mjs", "chore: vX.Y.Z", "changelog.mjs", "--amend"];
  let vorher = -1;
  for (const marke of folge) {
    const pos = ablauf.indexOf(marke, vorher + 1);
    assert.notEqual(pos, -1, `Marke '${marke}' fehlt oder steht in falscher Reihenfolge`);
    vorher = pos;
  }
});
