// Der Release-Weg: ein Lauf, ein Commit (Issue #658, Plan #652).
//
// Bis v1.53 wechselten sich Erzeugen und Festschreiben ab, und weil das Commit-Gate fuer
// JEDEN Commit einen Nachweis auf genau diesem Stand verlangt, kostete jeder Zwischenstand
// einen eigenen Prueflauf — bis zu vier bei `push main`, zwei bei `merge production`.
// Jetzt gilt: erst alle Dateien des Wegs erzeugen, dann EIN Lauf ueber den fertigen Stand,
// dann EIN Commit.
//
// Die Arbeitsteilung verschiebt sich damit. `RELEASING.md` fuehrt nur noch die
// ERZEUGUNGSSCHRITTE; Lauf, Commit und Push kommen aus dem Skill. Das ist der Grund, warum
// hier auf die ABWESENHEIT von `checks.mjs run` in `RELEASING.md` geprueft wird: Stuende er
// dort, gaebe es zwei Stellen, die denselben Lauf anordnen, und eine fremde `RELEASING.md`
// brauchte plotzlich Wissen ueber das Gate.
//
// Gemessen wird ausschliesslich die QUELLE unter `skills/`, nicht die Dogfooding-Kopie
// unter `.claude/skills/`: Die ist per `.gitignore` ausgeschlossen und fehlt in jedem
// frischen Checkout — ein Test, der sie liest, ist lokal gruen und in der CI rot. Dass
// Quelle und Kopie zusammenpassen, prueft `node tools/sync-blobs.mjs --check`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

const LAUF = /node \.claude\/kit\/checks\.mjs run/g;
const PUSH_MAIN = ["skills", "push-main", "SKILL.md"];
const MERGE_PRODUCTION = ["skills", "merge-production", "SKILL.md"];

/** Der Abschnitt `## Ablauf` von RELEASING.md — nur dort stehen die beiden Listen. */
function ablauflisten() {
  const text = lies("RELEASING.md");
  const start = text.indexOf("## Ablauf");
  assert.notEqual(start, -1, "RELEASING.md fuehrt keinen Abschnitt '## Ablauf'");
  const ende = text.indexOf("### Warum", start);
  assert.notEqual(ende, -1, "nach den Ablauflisten fehlt der begruendende Abschnitt");
  return text.slice(start, ende);
}

// --- RELEASING.md fuehrt nur noch Erzeugungsschritte ---

test("[skills-20] RELEASING.md ordnet keinen Prueflauf mehr an — der steht im Skill", () => {
  const treffer = [...lies("RELEASING.md").matchAll(LAUF)];
  assert.equal(treffer.length, 0,
    `RELEASING.md nennt ${treffer.length}x 'checks.mjs run'; der Lauf gehoert in den Skill, damit es nur eine Stelle gibt`);
});

test("[skills-20] keine Ablaufliste kennt noch --amend", () => {
  assert.doesNotMatch(ablauflisten(), /--amend/,
    "der Changelog wandert nicht mehr nachtraeglich in den Commit — er entsteht davor");
});

test("[skills-20] keine Ablaufliste enthaelt einen Commit- oder Push-Schritt", () => {
  const listen = ablauflisten();
  assert.doesNotMatch(listen, /git commit/, "das Festschreiben kommt aus dem Skill");
  assert.doesNotMatch(listen, /git push/, "das Pushen kommt aus dem Skill");
});

test("[skills-20] beide Ablauflisten fuehren Bump, Stempel und Changelog in dieser Reihenfolge", () => {
  const listen = ablauflisten();
  for (const [name, bump] of [["push main", "version.mjs --patch"], ["merge production", "version.mjs --minor"]]) {
    const start = listen.indexOf(bump);
    assert.notEqual(start, -1, `die Liste fuer '${name}' nennt '${bump}' nicht`);
    const stempel = listen.indexOf("sync-blobs.mjs", start);
    const changelog = listen.indexOf("changelog.mjs --marke", stempel);
    assert.notEqual(stempel, -1, `'${name}': sync-blobs fehlt oder steht vor dem Bump`);
    assert.notEqual(changelog, -1, `'${name}': 'changelog.mjs --marke' fehlt oder steht vor dem Stempel`);
  }
});

// --- Die Skills: ein Lauf, ein Commit ---

test("[skills-20] beide Release-Skills fahren genau einen Prueflauf, und zwar mit Batch-Anker", () => {
  for (const pfad of [PUSH_MAIN, MERGE_PRODUCTION]) {
    const text = lies(...pfad);
    const wo = pfad.join("/");
    const laeufe = [...text.matchAll(LAUF)];
    assert.equal(laeufe.length, 1, `${wo}: genau ein 'checks.mjs run' erwartet, gefunden ${laeufe.length}`);

    // Der Anker ist der Batch, nicht HEAD. Ohne ihn naehme `planen` HEAD als Basis; ist
    // seit HEAD nichts geaendert, meldete es `leeresPaket` und liesse JEDE Pruefung aus —
    // ein Projekt ohne RELEASING.md liefe damit vor dem Push durch eine leere Pruefung.
    const zeile = text.slice(laeufe[0].index).split("\n")[0];
    assert.match(zeile, /--since/, `${wo}: der Lauf traegt keinen Anker: ${zeile}`);
    assert.match(zeile, /git merge-base/, `${wo}: der Anker ist nicht der Batch-Anker: ${zeile}`);
  }
});

test("[skills-20] beide Release-Skills schreiben genau einen Commit fest", () => {
  for (const pfad of [PUSH_MAIN, MERGE_PRODUCTION]) {
    const text = lies(...pfad);
    const wo = pfad.join("/");
    // Gezaehlt werden ausfuehrbare Commit-Zeilen, nicht Erwaehnungen im Fliesstext.
    const commits = [...text.matchAll(/^git commit /gm)];
    assert.equal(commits.length, 1, `${wo}: genau ein 'git commit' erwartet, gefunden ${commits.length}`);
    assert.doesNotMatch(text, /git commit --amend/, `${wo}: kein Amend mehr auf diesem Weg`);
  }
});

test("[skills-21] beide Release-Skills melden Fortschritt und weisen den Lauf je Commit nach", () => {
  for (const pfad of [PUSH_MAIN, MERGE_PRODUCTION]) {
    const text = lies(...pfad);
    const wo = pfad.join("/");
    assert.match(text, /Schritt k von n/, `${wo}: die Fortschrittszeile ist nicht beschrieben`);
    assert.match(text, /zeitpunkt/, `${wo}: die Nachweiszeile nennt den Zeitpunkt des Laufs nicht`);
  }
});
