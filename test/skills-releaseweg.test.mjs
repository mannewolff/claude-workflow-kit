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
    // Der Weg ueber den Build-Dienst (Issue #1216, Plan #1199 E14) zaehlt hier nicht mit:
    // Dort faehrt der Build-Dienst den vollen Lauf, und der Skill selbst nur den Nachweis
    // fuer die Release-Dateien — belegt in test/skills-push-main.test.mjs.
    const text = lies(...pfad).replace(/\n## Weg über den Build-Dienst[\s\S]*?(?=\n## )/, "\n");
    const wo = pfad.join("/");
    const laeufe = [...text.matchAll(LAUF)];
    assert.equal(laeufe.length, 1, `${wo}: genau ein 'checks.mjs run' erwartet, gefunden ${laeufe.length}`);

    // Der Anker ist der Batch, nicht HEAD. Er entscheidet seit Issue #849 nicht mehr,
    // WAS laeuft — die Veroeffentlichungsstufen fahren den vollen Umfang —, wohl aber,
    // welchen Stand die Zusammenfassung bezeugt: `basis`, `geaendert` und die Hashes,
    // gegen die das Commit-Gate den Index prueft. Ohne ihn naehme `planen` HEAD als
    // Basis, und der Nachweis spraeche ueber das letzte Stueck statt ueber den Batch.
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

// --- Der Vor-Push-Schritt (Issue #1154, Plan #1150, E6) ---

/** Abschnitt `## Vor dem Push` von RELEASING.md bis zur naechsten Ueberschrift Ebene 2. */
function vorDemPush() {
  const text = lies("RELEASING.md");
  const start = text.indexOf("## Vor dem Push");
  assert.notEqual(start, -1, "RELEASING.md fuehrt keinen Abschnitt '## Vor dem Push'");
  const ende = text.indexOf("\n## ", start + 1);
  return { text, start, abschnitt: text.slice(start, ende === -1 ? undefined : ende) };
}

test("[skills-20] RELEASING.md nennt den Vor-Push-Schritt ausserhalb der Ablauflisten", () => {
  const { text, start } = vorDemPush();
  const ablauf = text.indexOf("## Ablauf");
  const warum = text.indexOf("### Warum", ablauf);
  assert.ok(start < ablauf || start > warum, "der Abschnitt steht zwischen '## Ablauf' und '### Warum'");
  assert.doesNotMatch(ablauflisten(), /windows-pruefung/, "das Werkzeug steht in den Ablauflisten");
});

test("[skills-20] der Vor-Push-Schritt nennt das Kommando und die Exit-Bedeutungen", () => {
  const { abschnitt } = vorDemPush();
  assert.match(abschnitt, /node tools\/windows-pruefung\.mjs --vorab/, "das Kommando fehlt");
  assert.match(abschnitt, /Exit 0/, "Exit 0 fehlt");
  assert.match(abschnitt, /Exit 1/, "Exit 1 fehlt");
  assert.match(abschnitt, /jeder andere Exit/i, "die Bedeutung aller anderen Exits fehlt");
});

test("[skills-20] die Arbeitsteilung nennt den Vor-Push-Schritt als Ausnahme", () => {
  const listen = ablauflisten();
  const absatz = listen.split(/\n\s*\n/).find((a) => /weder das\s+Festschreiben/.test(a));
  assert.ok(absatz, "der Absatz zur Arbeitsteilung fehlt");
  assert.match(absatz, /Vor-Push-Schritt/, "der Absatz nennt den Vor-Push-Schritt nicht");
  assert.match(absatz, /Ausnahme/, "der Vor-Push-Schritt steht nicht als Ausnahme");
  assert.match(absatz, /Wegwerf-Zweig/, "es steht nicht, dass er auf einen Wegwerf-Zweig legt");
});

test("[skills-20] die Rueckmeldung zur Windows-Pruefung nennt #316 und #1129 abgeloest, der Hook bleibt als Netz", () => {
  const text = lies("RELEASING.md");
  const start = text.indexOf("### Rueckmeldung zur Windows-Pruefung");
  assert.notEqual(start, -1, "der Abschnitt zur Rueckmeldung fehlt");
  const abschnitt = text.slice(start, text.indexOf("\n## ", start));
  assert.match(abschnitt, /#316/, "#316 fehlt");
  assert.match(abschnitt, /#1129/, "#1129 fehlt");
  assert.match(abschnitt, /abgel(ö|oe)st/, "es steht nicht, dass die Festlegungen abgeloest sind");
  assert.match(abschnitt, /Netz/, "es steht nicht, dass der Hook als Netz bleibt");
  assert.match(abschnitt, /au(ß|ss)erhalb von `push main`/, "es steht nicht, fuer welche Pushes der Hook bleibt");
});
