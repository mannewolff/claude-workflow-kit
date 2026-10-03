// Die implement-Skills und geschuetzte Dateien (Issue #1053, Plan #987, E11, E13, E17;
// Plan-Verifizierung 13, Teil implement-Skills).
//
// Zwei Stellen: die Folge `geschuetzt` aus `issue auftrag` in Schritt 0 — das Paket nennt
// eine geschuetzte Datei und wird gar nicht erst begonnen — und der Rueckfall aus E13 —
// eine Session scheitert erst beim Schreiben am Schutz, weil die Aufgabe die Datei nicht
// beim Namen nennt. Der Rueckfall ist nicht der Halt der Stopp-Frage: anderes Label,
// anderer Anker, Backlog vor dem Label, und kein `/fachplan` als Weg nach vorn.
//
// Geprueft wird der Skill-TEXT der Quelle unter `skills/`. Label und Anker kommen aus den
// Konstanten in kit/night.mjs, nicht aus Abschriften (Muster test/skills-task-halt.test.mjs):
// Eine Abschrift bliebe gruen, wenn der Runner den Namen aendert.
//
// Jede Pruefung ist eine Funktion ueber den Text, damit die abgewandelten Kopien unten
// zeigen, dass sie rot wird, wenn ein Skill die Folge oder den Rueckfall nicht nennt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GESCHUETZT_ANKER, GESCHUETZT_LABEL, HALT_FOLGESATZ } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Quelle eines Skills unter `skills/` — nie die Dogfooding-Kopie. */
function quelle(name) {
  return readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
}

const SKILLS = ["implement-next", "implement-ready", "implement-test", "implement-done"];

const FOLGE_MARKE = "- **`geschuetzt`**";
const RUECKFALL_MARKE = "**Rueckfall: Schreibzugriff auf eine geschuetzte Datei abgewiesen.**";

/** Der Eintrag der Folge `geschuetzt`: von seiner Marke bis zur naechsten Leerzeile ohne Einrueckung. */
function folgeEintrag(text, name) {
  const anfang = text.indexOf(FOLGE_MARKE);
  assert.ok(anfang >= 0, `${name}: die Folge \`geschuetzt\` fehlt in Schritt 0`);
  const rest = text.slice(anfang);
  const ende = rest.search(/\n\n(?! )/);
  return ende < 0 ? rest : rest.slice(0, ende);
}

/** Der Rueckfall: von seiner Marke bis zur naechsten `### `-Ueberschrift. */
function rueckfall(text, name) {
  const anfang = text.indexOf(RUECKFALL_MARKE);
  assert.ok(anfang >= 0, `${name}: der Rueckfall '${RUECKFALL_MARKE}' fehlt`);
  const ende = text.indexOf("\n### ", anfang);
  assert.ok(ende > anfang, `${name}: der Rueckfall steht nicht vor einer folgenden Ueberschrift`);
  return text.slice(anfang, ende).trim();
}

/** Die Stellen muessen in dieser Reihenfolge stehen, jede genau einmal gesucht. */
function inReihenfolge(abschnitt, stellen, name) {
  let vorige = -1;
  for (const [muster, was] of stellen) {
    const treffer = abschnitt.search(muster);
    assert.ok(treffer >= 0, `${name}: ${was} fehlt`);
    assert.ok(treffer > vorige, `${name}: ${was} steht nicht in der vorgeschriebenen Reihenfolge`);
    vorige = treffer;
  }
}

const LABEL_ADD = new RegExp(`issue label add <id> ${GESCHUETZT_LABEL}`);

/** Schritt 0: Folge `geschuetzt` mit Backlog, Label, Kommentar samt Label-Zeile per Datei. */
function pruefeFolge(text, name) {
  const eintrag = folgeEintrag(text, name);
  inReihenfolge(eintrag, [
    [/issue move <id> backlog/, "der Move nach Backlog"],
    [LABEL_ADD, `der Aufruf label add ${GESCHUETZT_LABEL}`],
    [/issue comment <id> --text-file /, "der Kommentar ueber eine Datei"],
  ], `${name} (Folge geschuetzt)`);
  assert.match(eintrag, /Fehlschlag[^.]*gemeldet[^.]*nicht auf/, `${name}: dass ein Fehlschlag des Labels gemeldet wird und nicht aufhaelt, fehlt`);
  assert.match(eintrag, /Kommentar fuer die Karte \(woertlich\)/, `${name}: der Kommentar kommt nicht aus dem Auftrag`);
  assert.match(eintrag, /Label-Zeile/, `${name}: die Label-Zeile fehlt`);
  assert.match(eintrag, /Lange Texte ans Board/, `${name}: die Transportregel ist nicht benannt`);
  assert.doesNotMatch(eintrag, /issue comment <id> --text '/, `${name}: der Halt-Kommentar geht als Argument`);
}

/** Leitplanke: `kit:geschuetzt` wird wie `kit:klaeren` nie entfernt. */
function pruefeLeitplanke(text, name) {
  const muster = new RegExp(`\`${GESCHUETZT_LABEL}\` wird[^\\n]*nie entfernt`);
  assert.match(text, muster, `${name}: die Leitplanke, dass ${GESCHUETZT_LABEL} nie entfernt wird, fehlt`);
}

/** Der Rueckfall aus E13 in der Reihenfolge aus E11. */
function pruefeRueckfall(text, name) {
  const abschnitt = rueckfall(text, name);
  inReihenfolge(abschnitt, [
    [/\*\*namentlich\*\* zuruecknehmen/, "das namentliche Zuruecknehmen"],
    [/issue move <id> backlog/, "der Move nach Backlog"],
    [LABEL_ADD, `der Aufruf label add ${GESCHUETZT_LABEL}`],
    [/issue check-geschuetzt <id> --pfad </, "der Kommentar aus check-geschuetzt --pfad"],
    [/issue comment <id> --text-file /, "der Kommentar ueber eine Datei"],
  ], `${name} (Rueckfall)`);
  assert.ok(abschnitt.includes(GESCHUETZT_ANKER), `${name}: der Anker ${GESCHUETZT_ANKER} fehlt im Rueckfall`);
  assert.match(abschnitt, /Fehlschlag[^.]*gemeldet/, `${name}: dass ein Fehlschlag des Labels gemeldet wird, fehlt`);
  assert.match(abschnitt, /Label-Zeile/, `${name}: die Label-Zeile fehlt`);
  assert.match(abschnitt, /bleibt in In progress/, `${name}: der Fall ohne namentliche Ruecknahme fehlt`);
  assert.match(abschnitt, /nie[^.]*umgangen|nicht[^.]*umgeh/, `${name}: dass der Schutz nicht umgangen wird, fehlt`);
  assert.ok(!abschnitt.includes(HALT_FOLGESATZ), `${name}: der Rueckfall traegt den Folgesatz der Stopp-Frage`);
  assert.ok(!abschnitt.includes("kit:klaeren"), `${name}: der Rueckfall nennt kit:klaeren`);
}

function pruefeSkill(text, name) {
  pruefeFolge(text, name);
  pruefeLeitplanke(text, name);
  pruefeRueckfall(text, name);
}

// --- Die vier Skills ---------------------------------------------------------

for (const name of SKILLS) {
  test(`[skills-1053] ${name} nennt die Folge geschuetzt, die Leitplanke und den Rueckfall`, () => {
    pruefeSkill(quelle(name), name);
  });
}

test("[skills-1053] die Folge geschuetzt steht in Schritt 0 bei den uebrigen Folgen", () => {
  for (const name of SKILLS) {
    const text = quelle(name);
    const backlog = text.indexOf("- **`backlog`**");
    const folge = text.indexOf(FOLGE_MARKE);
    assert.ok(backlog >= 0 && folge > backlog, `${name}: die Folge geschuetzt steht nicht hinter backlog`);
    assert.ok(folge < text.indexOf(RUECKFALL_MARKE), `${name}: die Folge steht hinter dem Rueckfall`);
  }
});

test("[skills-1053] /implement-next endet mit der Folge geschuetzt, /implement-ready geht zum naechsten Issue", () => {
  assert.match(folgeEintrag(quelle("implement-next"), "implement-next"), /endet/);
  assert.match(folgeEintrag(quelle("implement-ready"), "implement-ready"), /n(?:ae|ä)chsten (?:Ready-)?Issue/);
  for (const name of ["implement-test", "implement-done"]) {
    assert.match(folgeEintrag(quelle(name), name), /endet/, `${name}: endet nicht`);
  }
});

test("[skills-1053] der Rueckfall steht in allen vier Skills wortgleich", () => {
  const [erster, ...weitere] = SKILLS;
  for (const name of weitere) {
    assert.equal(rueckfall(quelle(name), name), rueckfall(quelle(erster), erster),
      `der Rueckfall in ${name} weicht von dem in ${erster} ab — zwei Fassungen sind zwei Wahrheiten`);
  }
});

test("[skills-1053] in next und ready steht der Rueckfall in Schritt 3 hinter dem Halt der Stopp-Frage", () => {
  for (const name of ["implement-next", "implement-ready"]) {
    const text = quelle(name);
    const halt = text.indexOf("**Entscheiden statt fragen.**");
    const marke = text.indexOf(RUECKFALL_MARKE);
    assert.ok(halt >= 0 && marke > halt, `${name}: der Rueckfall steht nicht hinter dem Halt`);
    assert.ok(marke < text.indexOf("### 4. Pruefungen vor dem Commit"), `${name}: der Rueckfall steht hinter Schritt 4`);
  }
});

// --- Abgewandelte Kopien: die Pruefung wird rot ------------------------------

test("[skills-1053] ohne die Folge geschuetzt wird die Pruefung rot", () => {
  for (const name of SKILLS) {
    const text = quelle(name);
    const ohne = text.replace(folgeEintrag(text, name), "");
    assert.throws(() => pruefeSkill(ohne, name), /Folge/, `${name}: Kopie ohne Folge blieb gruen`);
  }
});

test("[skills-1053] ohne den Rueckfall wird die Pruefung rot", () => {
  for (const name of SKILLS) {
    const text = quelle(name);
    const ohne = text.replace(rueckfall(text, name), "");
    assert.throws(() => pruefeSkill(ohne, name), /Rueckfall/, `${name}: Kopie ohne Rueckfall blieb gruen`);
  }
});

test("[skills-1053] ohne die Leitplanke oder mit vertauschter Reihenfolge wird die Pruefung rot", () => {
  const name = "implement-next";
  const text = quelle(name);
  const ohneLeitplanke = text.replaceAll(`\`${GESCHUETZT_LABEL}\` wird`, "`kit:anders` wird");
  assert.throws(() => pruefeLeitplanke(ohneLeitplanke, name), /nie entfernt/);
  const abschnitt = rueckfall(text, name);
  const vertauscht = abschnitt.replace(/issue move <id> backlog/, "issue move <id> anders");
  assert.throws(() => pruefeRueckfall(text.replace(abschnitt, vertauscht), name), /Move nach Backlog/);
});
