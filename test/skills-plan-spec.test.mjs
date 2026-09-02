// Die Beschreibung als erste Quelle in /plan (Issue #447, Plan #437).
//
// Sie pruefen Text, nicht Verhalten — was ein Skill tut, entscheidet das Modell,
// das ihn liest. Wert haben sie trotzdem: Der Kern des Vorhabens ist eine
// Rangfolge zwischen zwei Quellen, und eine Rangfolge, die nur ungefaehr
// dasteht, ist keine. Faellt die Passage bei einer Umformulierung heraus, plant
// /plan wieder schweigend gegen den Produktionscode — und nichts geht kaputt,
// woran man es merken wuerde.
//
// Die heikelste Stelle ist die Ebene der Lueckenliste: `### Beschreibungs-Luecken`
// ist ein Unterabschnitt von `## Betroffene Bereiche`. Ein `##` waere ein
// siebter Abschnitt und damit ein Formverstoss gegen das verbindliche
// Plan-Format (test/skills-plan-format.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "plan", "SKILL.md"), "utf-8");

/** Ein `###`-Schritt des Skills, bis zur naechsten Ueberschrift gleicher Ebene. */
function schritt(ueberschrift) {
  const idx = SKILL.indexOf(`### ${ueberschrift}`);
  assert.ok(idx >= 0, `der Schritt '### ${ueberschrift}' fehlt`);
  return SKILL.slice(idx).split(/\n### /)[0];
}

// --- Die Lueckenliste ist ein Unterabschnitt ---------------------------------

test("die Lueckenliste steht als `###`, nie als siebter `##`-Abschnitt", () => {
  assert.ok(
    SKILL.includes("### Beschreibungs-Luecken"),
    "die woertliche Ueberschrift `### Beschreibungs-Luecken` fehlt",
  );
  assert.doesNotMatch(
    SKILL,
    /^## Beschreibungs-Luecken/m,
    "die Lueckenliste steht als `##` — das waere ein siebter Abschnitt und ein Formverstoss",
  );
});

test("der Unterabschnitt ist `## Betroffene Bereiche` zugeordnet", () => {
  const idx = SKILL.indexOf("### Beschreibungs-Luecken");
  assert.match(
    SKILL.slice(Math.max(0, idx - 800), idx + 800),
    /`## Betroffene Bereiche`/,
    "es steht nirgends in der Naehe, unter welchem der sechs Abschnitte die Liste haengt",
  );
});

// --- Die Rangfolge der Quellen ----------------------------------------------

test("Schritt 2 nennt die Rangfolge zwischen Spec und Produktionscode", () => {
  const abschnitt = schritt("2. Relevante Dateien lesen");
  assert.ok(
    abschnitt.includes("erst, wenn"),
    "die Zeichenkette `erst, wenn` fehlt — ohne sie ist die Rangfolge eine Empfehlung",
  );
  assert.match(abschnitt, /specs\/INDEX\.md/,
    "der Index als Einstieg in die Beschreibung fehlt");
  assert.match(abschnitt, /`spec`-Block/,
    "der Schalter, an dem die Rangfolge haengt, ist nicht benannt");
});

test("betroffene Bereiche kommen aus dem Index, nicht aus checkAreas", () => {
  const abschnitt = schritt("2. Relevante Dateien lesen");
  assert.match(abschnitt, /checkAreas/,
    "die Abgrenzung gegen `checkAreas` fehlt — die Namen sehen sich zum Verwechseln aehnlich");
  assert.match(abschnitt, /anderer Namensraum/i,
    "es steht nicht, dass `checkAreas` ein anderer Namensraum ist");
});

test("der Degraded Mode ist beschrieben: melden, weiterlaufen, keine leere Liste", () => {
  const abschnitt = schritt("2. Relevante Dateien lesen");
  const absatz = abschnitt.split(/\n\n/).find((a) => /Degraded Mode/i.test(a));
  assert.ok(absatz, "kein Absatz zum Degraded Mode");
  assert.match(absatz, /fehlt|leer/i,
    "der Ausloeser (Index fehlt oder ist leer) ist nicht benannt");
  assert.match(absatz, /einmal/i,
    "es steht nicht, dass die Meldung einmal im Plan-Text steht");
  assert.match(absatz, /kein Abbruch|nicht ab|laeuft.{0,40}weiter|läuft.{0,40}weiter/i,
    "es steht nicht, dass der Skill weiterlaeuft");
  assert.match(absatz, /leere[rn]? (Lueckenliste|Lückenliste|Liste)/i,
    "die verbotene leere Lueckenliste ist nicht benannt");
});

// --- Beide Sorten Eintraege --------------------------------------------------

test("der Code-als-Quelle-Ausweis hat die Form `gelesen:`", () => {
  assert.ok(
    SKILL.includes("gelesen:"),
    "die Form des Ausweises fehlt — ohne sie ist nicht erkennbar, welche Zeile eine gelesene Datei nennt",
  );
  assert.match(
    SKILL,
    /gelesen: <Datei>/,
    "die Zeilenform `— gelesen: <Datei>` steht nicht als Vorlage da",
  );
});

test("Code lesen bleibt erlaubt und ist kein Verbot", () => {
  assert.match(SKILL, /kein Verbot|Code lesen bleibt erlaubt/i,
    "der Skill liest sich als Verbot — Kriterium 4 verlangt Ausweisen, nicht Unterlassen");
});

test("beide Leerfaelle stehen woertlich fest", () => {
  for (const zeile of [
    "- Keine Beschreibungs-Luecken in den geladenen Bereichen: <Liste der Bereiche>.",
    "- Kein Spec-Bereich betroffen.",
  ]) {
    assert.ok(SKILL.includes(zeile), `die Leerfall-Zeile fehlt woertlich: ${zeile}`);
  }
});

test("`- Keine.` ist fuer die Lueckenliste ausdruecklich ausgeschlossen", () => {
  // Die Form gehoert zu `## Architektonische Entscheidungen` und `## Offene
  // Fragen`. Waere sie hier zugelassen, waeren die drei Leerfaelle nicht mehr
  // auseinanderzuhalten.
  const idx = SKILL.indexOf("### Beschreibungs-Luecken");
  assert.ok(idx >= 0, "der Unterabschnitt fehlt");
  assert.match(SKILL.slice(idx), /Bewusst \*\*nicht\*\* `- Keine\.`/,
    "der Ausschluss von `- Keine.` fehlt");
});

// --- Vorhaben-Notiz ----------------------------------------------------------

/** Der Unterabschnitt zur Vorhaben-Notiz. */
function vorhabenAbschnitt() {
  const idx = SKILL.indexOf("#### Vorhaben-Notiz");
  assert.ok(idx >= 0, "der Unterabschnitt `#### Vorhaben-Notiz` fehlt");
  const rest = SKILL.slice(idx);
  const grenze = rest.indexOf("\n## ");
  return grenze >= 0 ? rest.slice(0, grenze) : rest;
}

test("der Rueckfall `plan-<M>` nennt beide Ausloeser", () => {
  const abschnitt = vorhabenAbschnitt();
  assert.match(abschnitt, /plan-<M>/, "die Form des Rueckfalls fehlt");
  assert.match(abschnitt, /leere[rn]? Liste|Liste ist leer/i,
    "die leere Liste als Ausloeser fehlt");
  assert.match(abschnitt, /Exitcode ungleich 0|Exit-?code ≠ 0/i,
    "der Exitcode ungleich 0 als zweiter Ausloeser fehlt — bei github und gitlab endet `issue epics` mit einem Fehler");
  assert.match(abschnitt, /github|gitlab/i,
    "die Tracker, bei denen der Aufruf fehlschlaegt, sind nicht benannt");
});

test("die Notiz kennt beide Quellen des Kuerzels und den Bahn-1-Fall", () => {
  const abschnitt = vorhabenAbschnitt();
  assert.match(abschnitt, /issue epics/, "das Kommando fuer die Vorhaben-Liste fehlt");
  assert.match(abschnitt, /genau ein/i, "der Fall 'genau ein Vorhaben' fehlt");
  assert.match(abschnitt, /mehrere[nr]?/i, "der Fall 'mehrere Vorhaben' fehlt");
  assert.match(abschnitt, /fragt.{0,60}Mensch|Mensch.{0,60}fragt|Rückfrage|Rueckfrage/i,
    "bei mehreren Vorhaben wird der Mensch nicht gefragt");
  assert.match(abschnitt, /ideaId/, "der Pool-Fall (ideaId statt Nummer) fehlt");
  assert.match(abschnitt, /Bahn 1/, "der Bahn-1-Fall (kein Plan-Dokument, kein Aufruf) fehlt");
  assert.match(abschnitt, /leere[rn]? `?shortcode`?|`shortcode` (ist )?leer/i,
    "der leere shortcode als dritter Rueckfall-Grund fehlt");
});

test("`--grund` ist bei `--code-gelesen ja` als Pflicht ausgewiesen", () => {
  const abschnitt = vorhabenAbschnitt();
  assert.match(abschnitt, /`--grund`[^.]{0,80}Pflicht[^.]{0,80}`--code-gelesen ja`|Pflicht bei `--code-gelesen ja`/,
    "die Pflicht von `--grund` bei `ja` steht nicht da");
  assert.match(abschnitt, /bei `?nein`?[^.]{0,60}entf/i,
    "es steht nicht, dass `--grund` bei `nein` entfaellt");
});

// --- Der Fall ohne spec-Block ------------------------------------------------

test("der Skill sagt ausdruecklich, dass ohne `spec`-Block nichts davon gilt", () => {
  const absatz = SKILL.split(/\n\n/).find(
    (a) => /[Oo]hne `spec`-Block/.test(a) && /unver(ä|ae)ndert/.test(a),
  );
  assert.ok(absatz, "kein Absatz, der den Fall ohne `spec`-Block als unveraendert beschreibt");
  assert.match(absatz, /Lücken|Luecken/i, "die Lueckenliste ist im Absatz nicht ausgenommen");
  assert.match(absatz, /Vorhaben-Notiz/, "die Vorhaben-Notiz ist im Absatz nicht ausgenommen");
});

// --- Die genannten Optionen gibt es wirklich ---------------------------------
//
// Muster aus test/docs-pruefstufen.test.mjs: Ein Skill, der Optionen nennt, die
// das Programm nicht kennt, ist schlimmer als einer, der schweigt — er scheitert
// erst zur Laufzeit und nur dort, wo niemand zusieht.

/** Alle Optionen und Unterbefehle, die der Skill an `spec.mjs` uebergibt. */
function genannteSpecOptionen() {
  const gefunden = new Set();
  for (const zeile of SKILL.split("\n")) {
    const treffer = /spec\.mjs\s+([a-z-]+)(.*)$/.exec(zeile);
    if (!treffer) continue;
    if (treffer[1].startsWith("--")) continue;
    gefunden.add(treffer[1]);
    for (const option of treffer[2].match(/--[a-z-]+/g) ?? []) gefunden.add(option);
  }
  return [...gefunden].sort();
}

test("jede im Skill genannte spec.mjs-Option kommt in `spec.mjs --help` vor", () => {
  const help = execFileSync(process.execPath, [join(repoRoot, "kit", "spec.mjs"), "--help"], {
    encoding: "utf-8",
  });

  const genannt = genannteSpecOptionen();
  for (const erwartet of ["luecken", "--bereich", "vorhaben", "--kuerzel", "--code-gelesen", "--grund"]) {
    assert.ok(genannt.includes(erwartet), `der Skill nennt '${erwartet}' nicht`);
  }
  for (const option of genannt) {
    assert.ok(help.includes(option), `'${option}' steht im Skill, aber nicht in 'spec.mjs --help'`);
  }
});
