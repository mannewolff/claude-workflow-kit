// Entscheiden statt fragen in `/implement-next` und `/implement-ready` (Issue #627,
// urspruenglich der Halt bei Abwaegungsbedarf aus Issue #573).
//
// Taucht beim Umsetzen eine Entscheidung auf, wird sie entschieden und im
// Abschlussbericht protokolliert. Nur eine Frage der Stopp-Klasse aus
// CLAUDE-workflow.md haelt an: Die Sitzung nimmt ihren eigenen Anteil zurueck,
// zeichnet das Issue mit `kit:klaeren`, benennt die Frage als Board-Kommentar und
// schiebt nach Backlog.
//
// Geprueft wird der Skill-TEXT, nicht die Laufzeit — was ein Skill tut, entscheidet
// das Modell, das ihn liest. Und ausschliesslich die Quelle unter `skills/`, nicht
// die Dogfooding-Kopie unter `.claude/skills/`; dass beide zusammenpassen, prueft
// `tools/sync-blobs.mjs --check`.
//
// Die heiklen Stellen sind drei: die Wortgleichheit des Abschnitts zwischen den
// beiden Skills (zwei Fassungen waeren zwei Wahrheiten darueber, was gilt), der
// woertliche Folgesatz — an ihm und nur an ihm erkennt der Nacht-Runner den Halt —,
// und die Abgrenzung gegen `/implement-test` und `/implement-done`, die unter
// menschlicher Aufsicht laufen und den Halt nicht kennen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { HALT_FOLGESATZ } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Quelle eines Skills unter `skills/` — nie die Dogfooding-Kopie. */
function quelle(name) {
  return readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
}

// Die beiden Skills, die den Halt tragen, und die beiden, die ihn nicht kennen.
const MIT_HALT = ["implement-next", "implement-ready"];
const OHNE_HALT = ["implement-test", "implement-done"];

const FETTMARKE = "**Entscheiden statt fragen.**";
const ENDMARKE = "### 4. Pruefungen vor dem Commit";

/** Der Halt-Abschnitt von der Fettmarke bis zur Ueberschrift des naechsten Schritts. */
function haltAbschnitt(name) {
  const text = quelle(name);
  const anfang = text.indexOf(FETTMARKE);
  assert.ok(anfang >= 0, `in ${name} fehlt die Fettmarke '${FETTMARKE}'`);
  const ende = text.indexOf(ENDMARKE, anfang);
  assert.ok(ende > anfang, `in ${name} steht der Abschnitt nicht vor '${ENDMARKE}'`);
  return text.slice(anfang, ende).trim();
}

// --- Wortgleichheit und Lage -------------------------------------------------

test("[skills-6] der Halt-Abschnitt steht in implement-next und implement-ready wortgleich", () => {
  const [erster, ...weitere] = MIT_HALT;
  for (const name of weitere) {
    assert.equal(
      haltAbschnitt(name),
      haltAbschnitt(erster),
      `der Abschnitt in ${name} weicht von dem in ${erster} ab — zwei Fassungen sind zwei Wahrheiten`,
    );
  }
});

test("[skills-6] der Halt-Abschnitt steht in Schritt 3, vor Schritt 4", () => {
  for (const name of MIT_HALT) {
    const text = quelle(name);
    const schritt = text.indexOf("### 3. Implementieren");
    assert.ok(schritt >= 0, `in ${name} fehlt der Schritt '### 3. Implementieren'`);
    const marke = text.indexOf(FETTMARKE);
    assert.ok(marke > schritt, `in ${name} steht der Abschnitt vor Schritt 3`);
    const naechster = text.indexOf("\n### ", schritt + 1);
    assert.ok(
      naechster < 0 || marke < naechster,
      `in ${name} steht der Abschnitt hinter Schritt 3`,
    );
    // Schritt 4 bleibt unberuehrt: Der Halt endet davor.
    assert.ok(
      marke < text.indexOf(ENDMARKE),
      `in ${name} steht der Abschnitt hinter Schritt 4`,
    );
  }
});

// --- Der Ablauf gilt ohne Ausnahme -------------------------------------------

// Eine unbeaufsichtigte Session fand die Regel fuer ihren Halt im persoenlichen
// Gedaechtnis des Menschen statt im Skill und klaerte „im Gespraech", wo niemand
// sass (Issue #770). Das Gedaechtnis wird in jede Session geladen, auch in die
// unbeaufsichtigte; der Vorrang gehoert darum in den Skill selbst.

/** Die vier Aussagen, die der Absatz vor dem Halt-Ablauf tragen muss. */
const VORRANG_AUSSAGEN = [
  [/gilt ohne Ausnahme/, "dass der Ablauf ohne Ausnahme gilt"],
  [/in jeder Betriebsart/, "dass er in jeder Betriebsart gilt"],
  [/Vorrang[\s\S]{0,400}Ged(?:ae|ä)chtnis/, "der Vorrang vor dem persoenlichen Gedaechtnis"],
  [/Frage steht am Board/, "dass die Frage am Board steht"],
];

test("[skills-35] der Halt-Ablauf gilt ohne Ausnahme und hat Vorrang vor dem Gedaechtnis", () => {
  for (const name of MIT_HALT) {
    const abschnitt = haltAbschnitt(name);
    for (const [muster, was] of VORRANG_AUSSAGEN) {
      assert.match(abschnitt, muster, `${name}: ${was} fehlt`);
    }
  }
});

test("[skills-35] der Vorrang-Absatz steht vor der nummerierten Liste, nicht dahinter", () => {
  for (const name of MIT_HALT) {
    const abschnitt = haltAbschnitt(name);
    const liste = abschnitt.search(/^1\. Eigene uncommittete Aenderungen/m);
    assert.ok(liste >= 0, `${name}: die nummerierte Liste des Halt-Ablaufs fehlt`);
    for (const [muster, was] of VORRANG_AUSSAGEN) {
      const treffer = abschnitt.search(muster);
      assert.ok(treffer >= 0 && treffer < liste, `${name}: ${was} steht nicht vor der Liste`);
    }
  }
});

// --- Wann angehalten wird ----------------------------------------------------

test("[skills-6] der Halt gilt fuer jedes Arbeitspaket und nur fuer die Stopp-Klasse", () => {
  for (const name of MIT_HALT) {
    const abschnitt = haltAbschnitt(name);
    assert.match(abschnitt, /jede[ms] Arbeitspaket/, `${name}: der Halt ist nicht auf jedes Paket ausgedehnt`);
    assert.match(abschnitt, /Stopp-Klasse/, `${name}: die Stopp-Klasse ist nicht als einziger Anlass benannt`);
    assert.match(abschnitt, /Entscheiden statt fragen/, `${name}: der Verweis auf CLAUDE-workflow.md fehlt`);
    assert.match(abschnitt, /### Entscheidungen/, `${name}: der Ort im Abschlussbericht fehlt`);
    assert.match(abschnitt, /genau eine je Halt/, `${name}: dass ein Halt genau eine Frage traegt, fehlt`);
    assert.doesNotMatch(
      abschnitt,
      /mehrere vertretbare Wege|Der Umfang allein/,
      `${name}: der alte Anlass (Abwaegungsbedarf) steht noch da`,
    );
  }
});

test("[skills-6] ob ein Ready-Issue geprueft wurde, fragen beide Skills nicht mehr", () => {
  for (const name of MIT_HALT) {
    const text = quelle(name);
    assert.ok(!text.includes("Ungepruefte Issues"), `${name}: die Fallunterscheidung steht noch da`);
    assert.ok(!text.includes("Pruefung: Verzicht"), `${name}: der Verzicht wird noch geprueft`);
    assert.match(text, /Ready ist das GO/, `${name}: der Ersatzsatz fehlt`);
  }
});

test("[skills-6] das Berichtformat traegt ### Entscheidungen in next, ready und done", () => {
  for (const name of [...MIT_HALT, "implement-done"]) {
    const text = quelle(name);
    const bloecke = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
    const format = bloecke.find((b) => b.includes("### Hinweise"));
    assert.ok(format, `${name}: der Format-Codeblock fehlt`);
    assert.ok(format.includes("### Entscheidungen"), `${name}: '### Entscheidungen' fehlt im Format`);
    assert.match(text, /entfaellt, wenn es nichts zu entscheiden gab/, `${name}: die Entfall-Regel fehlt`);
  }
  assert.ok(!quelle("implement-test").includes("### Entscheidungen"), "implement-test schreibt keinen Bericht");
});

// --- Die fuenf Schritte ------------------------------------------------------

test("[skills-6] der Halt nimmt erst den eigenen Anteil zurueck, dann Label, Kommentar, Move", () => {
  for (const name of MIT_HALT) {
    const abschnitt = haltAbschnitt(name);
    const stellen = [
      [/\*\*namentlich\*\* zuruecknehmen/, "das namentliche Zuruecknehmen"],
      [/issue label add <id> kit:klaeren/, "der Label-Aufruf"],
      [/issue comment <id> --text-file <tmpdir>\/<id>-halt\.md/, "der Kommentar-Aufruf"],
      [/issue move <id> backlog/, "der Move nach Backlog"],
    ];
    let vorige = -1;
    for (const [muster, was] of stellen) {
      const treffer = abschnitt.search(muster);
      assert.ok(treffer >= 0, `${name}: ${was} fehlt`);
      assert.ok(treffer > vorige, `${name}: ${was} steht nicht in der vorgeschriebenen Reihenfolge`);
      vorige = treffer;
    }
    assert.match(
      abschnitt,
      /nie pauschal den ganzen Arbeitsbaum verwerfen/,
      `${name}: das Verbot, pauschal zu verwerfen, fehlt`,
    );
    assert.match(abschnitt, /\*\*kein Commit\*\*/, `${name}: 'kein Commit' fehlt`);
  }
});

test("[skills-6] der Halt-Kommentar geht ueber eine Datei, nie als Argument", () => {
  for (const name of MIT_HALT) {
    const abschnitt = haltAbschnitt(name);
    assert.match(abschnitt, /--text-file/, `${name}: der Dateiweg fehlt`);
    assert.doesNotMatch(
      abschnitt,
      /issue comment <[^>]*> --text "/,
      `${name}: der Halt-Kommentar zeigt den Argument-Weg`,
    );
    assert.match(
      abschnitt,
      /Lange Texte ans Board/,
      `${name}: die Transportregel ist nicht als Quelle benannt`,
    );
  }
});

test("[skills-6] der Folgesatz steht woertlich so da, wie ihn der Nacht-Runner sucht", () => {
  // Gegen die Konstante aus kit/night.mjs, nicht gegen eine Abschrift: Eine
  // Abschrift bliebe gruen, wenn der Runner den Satz aendert (Issue #572).
  for (const name of MIT_HALT) {
    assert.ok(
      haltAbschnitt(name).includes(HALT_FOLGESATZ),
      `${name}: der Folgesatz weicht von HALT_FOLGESATZ in kit/night.mjs ab`,
    );
  }
});

// --- Der Massstab und der Fall, in dem nicht angehalten wird ------------------

test("[skills-6] gemessen wird der eigene Anteil an den eigenen Werkzeugaufrufen", () => {
  for (const name of MIT_HALT) {
    const abschnitt = haltAbschnitt(name);
    assert.match(abschnitt, /eigenen Werkzeugaufrufe/, `${name}: der Massstab fehlt`);
    assert.match(
      abschnitt,
      /Vergleich gegen den Stand bei Session-Start ist kein Nachweis/,
      `${name}: der verworfene Massstab ist nicht ausdruecklich ausgeschlossen`,
    );
  }
});

test("[skills-6] bleibt ein eigener Anteil zurueck, wird nicht angehalten", () => {
  for (const name of MIT_HALT) {
    const abschnitt = haltAbschnitt(name);
    assert.match(
      abschnitt,
      /wird vor Schritt 2\b/,
      `${name}: es steht nicht, dass die Frage vor dem Label entschieden wird`,
    );
    assert.match(
      abschnitt,
      /kein Label, kein Kommentar, kein Move, kein Commit/,
      `${name}: es steht nicht, dass keiner der Schritte 2 bis 5 laeuft`,
    );
    assert.match(
      abschnitt,
      /bleibt in In progress/,
      `${name}: der Verbleib des Issues ist nicht benannt`,
    );
  }
});

test("[skills-6] das Label wird nie entfernt", () => {
  for (const name of MIT_HALT) {
    assert.match(
      haltAbschnitt(name),
      /\*\*nie\*\* entfernt/,
      `${name}: das Verbot, das Label abzunehmen, fehlt`,
    );
  }
});

// --- Abgrenzung gegen die feinere Gangart ------------------------------------

test("[skills-6] implement-test und implement-done kennen den Halt nicht", () => {
  for (const name of OHNE_HALT) {
    const text = quelle(name);
    assert.ok(!text.includes(FETTMARKE), `${name}: traegt die Fettmarke des Halts`);
    assert.ok(!text.includes(HALT_FOLGESATZ), `${name}: traegt den Folgesatz`);
  }
});

// --- Die Spur in /fachplan ---------------------------------------------------

test("[skills-8] /fachplan nimmt einen angehaltenen `[Task]` als Argument `#T`", () => {
  const text = quelle("fachplan");
  assert.match(text, /\/fachplan #T/, "das Argument `#T` ist nicht benannt");
  assert.ok(
    text.includes(HALT_FOLGESATZ),
    "der Folgesatz, an dem der angehaltene Task erkannt wird, fehlt",
  );
});

test("[skills-8] /fachplan lehnt jede andere Karte ab und legt nichts an", () => {
  const text = quelle("fachplan");
  assert.match(
    text,
    /nur fuer einen angehaltenen `\[Task\]` gilt/,
    "die Ablehnungsmeldung fehlt woertlich",
  );
  assert.match(text, /legt nichts an/, "es steht nicht, dass nichts angelegt wird");
});

test("[skills-8] /fachplan haengt genau einen Kommentar `Fortsetzung: Issue #N` an den Task", () => {
  const text = quelle("fachplan");
  assert.match(
    text,
    /issue comment <T> --text "Fortsetzung: Issue #N"/,
    "der Fortsetzungs-Kommentar fehlt als Aufruf",
  );
  assert.match(text, /genau einen Kommentar/, "es steht nicht, dass es genau einer ist");
});

test("[skills-8] am fachlichen Issue entsteht keine Herkunftszeile, und ohne `#T` entfaellt der Aufruf", () => {
  const text = quelle("fachplan");
  assert.match(
    text,
    /keine\*\* Herkunftszeile|\*\*keine\*\* Herkunftszeile/,
    "der Verzicht auf die Herkunftszeile an der Wurzel fehlt",
  );
  assert.match(
    text,
    /Ohne Argument `#T` entf(?:ae|ä)llt der Aufruf/,
    "der Fall ohne Argument fehlt",
  );
  assert.match(
    text,
    /`ideaId`/,
    "der Randfall Ideen-Pool ohne Kartennummer fehlt",
  );
});
