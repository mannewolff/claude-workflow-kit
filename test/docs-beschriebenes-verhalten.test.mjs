// Die Doku zum beschriebenen Verhalten (Issue #454).
//
// Zwei Dinge sind hier die Hauptsache:
//
//   1. Der Grammatik-Codeblock wird gegen die QUELLE im Werkzeug geprueft
//      (WIRKUNG_GRAMMATIK aus kit/spec.mjs), nicht gegen eine Abschrift im Test.
//      Sonst gaebe es drei Fassungen desselben Textes — Plan, Doku, Test —, und die
//      driften. Genau dieses Argument hat die Grammatik in den Plan gezogen.
//   2. Die tragenden Aussagen werden als ABSATZ mit mehreren Mustern geprueft, nicht
//      als einzelnes Wort irgendwo im Kapitel: „Die Einbahnstrasse steht drin" heisst,
//      dass beide Haelften zusammen dastehen — was das Kit nicht anbietet UND was ein
//      Mensch trotzdem kann.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { WIRKUNG_GRAMMATIK } from "../kit/spec.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOKU = readFileSync(join(repoRoot, "docs/dokumentation.md"), "utf-8");
const README = readFileSync(join(repoRoot, "README.md"), "utf-8");

const UEBERSCHRIFT = "## Beschriebenes Verhalten";

/**
 * Der Text des Kapitels, von seiner Ueberschrift bis zur naechsten `## `-Zeile
 * AUSSERHALB eines Code-Fences.
 *
 * Die Fence-Behandlung ist keine Vorsicht auf Verdacht: Das Kapitel zeigt die
 * Dateiform mit einem Beispielblock, in dem `## Entfallen` am Zeilenanfang steht.
 * Eine Extraktion ohne Fence-Bewusstsein endet genau dort — mitten im Kapitel — und
 * meldet dann Aussagen als fehlend, die zwei Absaetze weiter unten stehen. Dieselbe
 * Falle behandelt die Leitplanke in board.mjs (Issue #443).
 */
function kapitel() {
  const zeilen = DOKU.split("\n");
  const von = zeilen.indexOf(UEBERSCHRIFT);
  assert.notEqual(von, -1, `das Kapitel '${UEBERSCHRIFT}' fehlt`);

  const gesammelt = [];
  let imFence = false;
  for (const zeile of zeilen.slice(von + 1)) {
    if (/^\s*```/.test(zeile)) imFence = !imFence;
    else if (!imFence && zeile.startsWith("## ")) break;
    gesammelt.push(zeile);
  }
  return gesammelt.join("\n");
}

/** Ein Absatz, in dem ALLE Muster vorkommen. Umlaut und Umschrift gelten gleich. */
function absatzMit(text, ...muster) {
  return text.split(/\n\s*\n/).some((absatz) => muster.every((m) => m.test(absatz)));
}

test("das Kapitel gibt es, mit genau diesem Wortlaut und auf Ebene ##", () => {
  assert.match(DOKU, new RegExp(`^${UEBERSCHRIFT}$`, "m"));
});

test("der Grammatik-Codeblock ist zeichengleich mit der Quelle im Werkzeug", () => {
  // Nicht gegen eine Abschrift: WIRKUNG_GRAMMATIK ist die eine Fassung, aus der auch
  // der Parser und die Skill-Texte leben.
  assert.ok(
    kapitel().includes(WIRKUNG_GRAMMATIK),
    "der Codeblock weicht von WIRKUNG_GRAMMATIK aus kit/spec.mjs ab",
  );
});

test("die Einbahnstrasse steht mit BEIDEN Haelften in einem Absatz", () => {
  // Ohne die zweite Haelfte waere die Zusage unehrlich: Das Kit bietet keinen Weg
  // zurueck an — hindern kann es niemanden.
  assert.ok(
    absatzMit(kapitel(), /nicht zur(ü|ue)ckzunehmen|kein(en)? Weg zur(ü|ue)ck/, /von Hand/, /l(ö|oe)sch/),
    "der Absatz nennt nicht beide Haelften: was das Kit nicht anbietet und was ein Mensch kann",
  );
});

test("die Regel zu den IDs steht mit Begruendung und Datum in einem Absatz", () => {
  assert.ok(
    absatzMit(kapitel(), /## Entfallen/, /nie wieder|nicht wieder|neu vergeben/, /Datum|Jahre/),
    "der Absatz nennt nicht, dass IDs nie neu vergeben werden, samt Grund",
  );
});

test("die Reihenfolge des Gates steht da — apply vor den Pflicht-Checks, check danach", () => {
  const k = kapitel();
  const iApply = k.indexOf("apply");
  const iChecks = k.indexOf("Pflicht-Checks");
  const iCheck = k.lastIndexOf("check");
  assert.ok(iApply !== -1 && iChecks !== -1 && iCheck !== -1, "apply, Pflicht-Checks oder check fehlen");
  assert.ok(iApply < iChecks, "apply muss VOR den Pflicht-Checks stehen");
  assert.ok(iCheck > iApply, "check muss NACH apply stehen");
});

test("was ein Projekt ohne Schalter merkt, steht da: nichts", () => {
  assert.ok(
    absatzMit(kapitel(), /ohne/, /spec|Block|Schalter/, /nichts|unver(ä|ae)ndert/),
    "das Kapitel sagt nicht, dass ein Projekt ohne Schalter nichts merkt",
  );
});

test("die ausgeschlossenen und die moeglichen Tracker stehen da", () => {
  assert.ok(
    absatzMit(kapitel(), /github/i, /gitlab/i, /toolbox/i),
    "das Kapitel nennt nicht, welche Tracker das Verhalten tragen",
  );
});

test("die Kommandos der Uebersicht sind genau die von spec.mjs --help", () => {
  // In BEIDE Richtungen: kein Kommando fehlt, keines ist erfunden. Eine Teilmengen-
  // pruefung liesse ein vergessenes Kommando gruen durchgehen.
  const inDoku = new Set(
    [...kapitel().matchAll(/node \.claude\/kit\/spec\.mjs (\w+)/g)].map((m) => m[1]),
  );
  const hilfe = spawnSync(process.execPath, [join(repoRoot, "kit/spec.mjs"), "--help"], { encoding: "utf-8" });
  assert.equal(hilfe.status, 0, hilfe.stderr);
  const inHelp = new Set([...hilfe.stdout.matchAll(/node spec\.mjs (\w+)/g)].map((m) => m[1]));

  assert.deepEqual(
    [...inDoku].sort(),
    [...inHelp].sort(),
    "die Kommandoliste der Doku und die von --help sind nicht dieselbe Menge",
  );
});

test("das Kapitel nennt weder Board-Nummern noch A-Kuerzel", () => {
  // Ein Leser von docs.mwolff.org hat weder Plan noch Board. Die Verweise sind Hilfen
  // fuer das Arbeitspaket, nicht Text der Doku.
  const k = kapitel();
  assert.doesNotMatch(k, /Issue #\d+/, "das Kapitel nennt eine Issue-Nummer");
  assert.doesNotMatch(k, /Plan #\d+/, "das Kapitel nennt eine Plan-Nummer");
  assert.doesNotMatch(k, /\bA\d{1,2}\b/, "das Kapitel nennt ein A-Kuerzel aus dem Plan");
});

test("die fuenf Bestandsabschnitte verweisen auf das Kapitel", () => {
  for (const abschnitt of ["### /push-main", "### /issues", "### /plan", "### /kontext", "## Die Config-Datei"]) {
    const start = DOKU.indexOf(`\n${abschnitt}\n`);
    assert.notEqual(start, -1, `${abschnitt} fehlt`);
    const naechste = DOKU.indexOf("\n#", start + abschnitt.length + 2);
    const text = DOKU.slice(start, naechste === -1 ? undefined : naechste);
    assert.match(text, /beschriebenes-verhalten/, `${abschnitt} verweist nicht auf das Kapitel`);
  }
});

test("die Frageliste zaehlt so viele Punkte, wie der Einleitungssatz nennt", () => {
  const ZAHLWORT = { sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11 };
  const satz = DOKU.match(/Der Installer stellt (\w+) Fragen/);
  assert.ok(satz, "der Einleitungssatz zur Frageliste fehlt");
  const genannt = ZAHLWORT[satz[1].toLowerCase()];
  assert.ok(genannt, `unbekanntes Zahlwort: ${satz[1]}`);

  // Die nummerierten Punkte zwischen dem Satz und dem naechsten Absatz ohne Nummer.
  const ab = DOKU.slice(DOKU.indexOf(satz[0]));
  const punkte = [...ab.matchAll(/^\*\*(\d+)\./gm)].map((m) => Number(m[1]));
  const hoechste = Math.max(...punkte);
  // Der letzte Punkt ist der Vault-Pfad (nur global) — er ist die im Satz genannte
  // zusaetzliche Frage, deshalb genannt + 1.
  assert.equal(hoechste, genannt + 1, `der Satz nennt ${genannt} Fragen, die Liste geht bis ${hoechste}`);
});

test("die README verweist auf das Kapitel, ohne es zu wiederholen", () => {
  assert.match(README, /Beschriebenes Verhalten/);
  assert.match(README, /docs\/dokumentation\.md/);
  assert.doesNotMatch(README, /NEU {2,}<BEREICH>/, "die README wiederholt die Grammatik");
});
