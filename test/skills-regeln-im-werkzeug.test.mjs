// Der Massstab "Regel im Text oder Regel im Werkzeug" (Issue #856, Plan #810/E7,
// Fachplan #769/AK 1).
//
// Teil Massstab: Der Abschnitt steht in der Prozessvorlage, weil er fuer jede
// mitgelieferte Anweisung gilt — so wie "Entscheiden statt fragen". Geprueft wird
// die Vorlage unter templates/, nicht die Installer-Kopie unter .claude/.
//
// Die Folgepakete aus Plan #810 erweitern dieselbe Datei um den Teil zu den Skills
// und um den Teil zur Aufstellung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");

// Die Werkzeug-Haelfte wird am Verhalten geprueft, nicht am Text: Eine blosse
// Textsuche nach `fehlermerkmal` bliebe gruen, wenn jemand die Funktion
// auskommentiert — der Name stuende dann immer noch da.
import { fehlermerkmal } from "../kit/checks.mjs";

const skillText = (name) => readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
const LOCAL_CHECK = skillText("local-check");
const CHECKS_MJS = readFileSync(join(repoRoot, "kit", "checks.mjs"), "utf-8");

/** Jede mitgelieferte Anweisung unter `skills/` mit ihrem Namen. */
function alleSkills() {
  return readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, text: skillText(e.name) }));
}

const UEBERSCHRIFT = "## Regel im Text oder Regel im Werkzeug";

/** Der Abschnitt vom eigenen `##` bis zur naechsten `##`-Ueberschrift. */
function abschnitt() {
  const start = VORLAGE.indexOf(UEBERSCHRIFT);
  assert.ok(start >= 0, `'${UEBERSCHRIFT}' fehlt in templates/CLAUDE-workflow.md`);
  const rest = VORLAGE.slice(start + UEBERSCHRIFT.length);
  const ende = rest.indexOf("\n## ");
  return rest.slice(0, ende >= 0 ? ende : rest.length);
}

test("der Massstab steht unmittelbar nach 'Entscheiden statt fragen'", () => {
  const ueberschriften = VORLAGE.split("\n")
    .filter((zeile) => zeile.startsWith("## "))
    .map((zeile) => zeile.trim());
  const vorher = ueberschriften.indexOf("## Entscheiden statt fragen");
  assert.ok(vorher >= 0, "'## Entscheiden statt fragen' fehlt in der Vorlage");
  assert.equal(
    ueberschriften[vorher + 1],
    UEBERSCHRIFT,
    "der Massstab folgt nicht unmittelbar auf 'Entscheiden statt fragen'",
  );
});

test("der Massstab nennt beide Arten mit ihrem Unterscheidungsmerkmal", () => {
  const text = abschnitt();
  assert.ok(/\*\*Bedienvorgabe[.*]/.test(text), "die Art 'Bedienvorgabe' fehlt");
  assert.ok(/\*\*Urteilsregel[.*]/.test(text), "die Art 'Urteilsregel' fehlt");
  // Das Merkmal der Bedienvorgabe: ablesbar und an der Stelle des Lesers ausfuehrbar.
  assert.ok(/ablesbar/.test(text), "das Merkmal 'an Ausgabe oder Ergebnis ablesbar' fehlt");
  assert.ok(
    /an der Stelle des Lesers/.test(text),
    "das Merkmal 'ein Werkzeug koennte sie an der Stelle des Lesers ausfuehren' fehlt",
  );
  // Das Merkmal der Urteilsregel: Entscheidung oder Haltung im Einzelfall.
  assert.ok(
    /Einzelfall/.test(text),
    "das Merkmal 'Entscheidung oder Haltung im Einzelfall' fehlt",
  );
});

test("der Massstab traegt die drei Beispiele", () => {
  const text = abschnitt();
  assert.ok(
    /echten R(ü|ue)ckgabewert des Pr(ü|ue)fkommandos/.test(text),
    "das Beispiel zur Bedienvorgabe (echter Rueckgabewert) fehlt",
  );
  assert.ok(
    /Coverage-Report/.test(text) && /Signal/.test(text),
    "das Beispiel zur Urteilsregel (Coverage-Report als Signal) fehlt",
  );
  assert.ok(
    /Abbruch an der Uhr/.test(text),
    "die erzwingbare Haelfte des gemischten Beispiels fehlt",
  );
  assert.ok(
    /gro(ß|ss)z(ü|ue)gigen Zeitrahmen/i.test(text),
    "die im Text bleibende Haelfte des gemischten Beispiels fehlt",
  );
});

test("die Art einer Regel sagt nichts ueber ihre Ueberfuehrbarkeit", () => {
  const text = abschnitt();
  assert.ok(
    /wird nicht zur Urteilsregel/.test(text),
    "der Satz fehlt, dass eine Bedienvorgabe nicht zur Urteilsregel wird, nur weil ein Werkzeug sie nur teilweise sicherstellen kann",
  );
  assert.ok(/teilweise/.test(text), "die Einschraenkung 'nur teilweise' fehlt");
});

test("der Massstab gilt fuer alle mitgelieferten Anweisungen", () => {
  const text = abschnitt();
  assert.ok(
    /alle mitgelieferten Anweisungen/.test(text),
    "die Geltung fuer alle mitgelieferten Anweisungen fehlt",
  );
  assert.ok(
    /unver(ä|ae)ndert bleiben/.test(text),
    "der Zusatz fehlt, dass die Geltung auch fuer die Anweisungen gilt, die heute unveraendert bleiben",
  );
});

// Teil Skills (Issue #860, Plan #810/E8, E9, E10, E11; Fachplan #769/AK 2, 3, 5, 9).
//
// Die beiden Haelften einer ueberfuehrten Bedienvorgabe stehen je in EINEM Test
// (E9): Faellt der Text zurueck oder faellt das Werkzeug aus, wird derselbe Test
// rot. Zwei getrennte Tests liessen eine Haelfte ohne die andere gruen — und
// genau das ist der Zustand, den die Umstellung ausschliessen soll.

test("der echte Rueckgabewert steht im Werkzeug, nicht mehr im Text", () => {
  // Werkzeug-Haelfte: `run` liest den Rueckgabewert des Kommandos selbst.
  assert.ok(
    /^function kommandoAusfuehren\(/m.test(CHECKS_MJS),
    "kit/checks.mjs fuehrt die Pruefkommandos nicht mehr selbst aus (`kommandoAusfuehren` fehlt)",
  );
  assert.ok(
    /res\.status === 0/.test(CHECKS_MJS),
    "kit/checks.mjs liest den Rueckgabewert des Kommandos nicht mehr",
  );

  // Text-Haelfte: die Bedienanleitung dazu ist aus dem Skill verschwunden.
  assert.ok(
    !/EXIT=/.test(LOCAL_CHECK),
    "skills/local-check/SKILL.md laesst den Exit-Code noch selbst in eine Datei schreiben (`EXIT=`)",
  );
  assert.ok(
    !/\^EXIT=/.test(LOCAL_CHECK),
    "skills/local-check/SKILL.md wertet den Exit-Code noch per `grep \"^EXIT=\"` aus",
  );
  assert.ok(
    /R(ü|ue)ckgabewert/.test(LOCAL_CHECK) && /checks\.mjs run/.test(LOCAL_CHECK),
    "der Ersatzsatz fehlt: `checks.mjs run` liest den Rueckgabewert des Pruefkommandos selbst",
  );
});

test("die allgemeinen Fehlermerkmale stehen im Werkzeug, nicht mehr im Text", () => {
  // Werkzeug-Haelfte: beide Merkmale, an der echten Funktion abgelesen.
  assert.equal(
    fehlermerkmal("[INFO] los\n[ERROR] kaputt\n"),
    "[ERROR]",
    "kit/checks.mjs erkennt das Merkmal `[ERROR]` nicht mehr",
  );
  assert.equal(
    fehlermerkmal("BUILD FAILURE\n"),
    "BUILD FAILURE",
    "kit/checks.mjs erkennt das Merkmal `BUILD FAILURE` nicht mehr",
  );

  // Text-Haelfte: KEIN Skill fordert die Merkmal-Pruefung noch an, auch
  // push-main nicht — sonst bliebe die Regel an zwei Orten mit zwei Listen.
  for (const { name, text } of alleSkills()) {
    assert.ok(
      !/BUILD FAILURE/.test(text),
      `skills/${name}/SKILL.md fordert die Merkmal-Pruefung noch selbst an (BUILD FAILURE)`,
    );
    assert.ok(
      !/\[ERROR\]/.test(text),
      `skills/${name}/SKILL.md fordert die Merkmal-Pruefung noch selbst an ([ERROR])`,
    );
  }
  assert.ok(
    /Fehlermerkmal/i.test(LOCAL_CHECK) && /rot/.test(LOCAL_CHECK),
    "der Ersatzsatz fehlt: `run` uebernimmt die Pruefung, ein Treffer faerbt den Lauf rot",
  );
});

test("der Abbruch an der Uhr steht im Werkzeug, die Bitte um Zeit im Text", () => {
  // Werkzeug-Haelfte: die begleitende Zusammenfassung mit ihrem Abschluss-Feld.
  assert.ok(
    /abgeschlossen/.test(CHECKS_MJS),
    "kit/checks.mjs kennt das Feld `abgeschlossen` nicht — ein Abbruch an der Uhr bliebe unsichtbar",
  );

  // Text-Haelfte: die drei Saetze, die bleiben (AK 6).
  assert.ok(
    /gro(ß|ss)z(ü|ue)gig/i.test(LOCAL_CHECK),
    "die Bitte um einen grosszuegigen Zeitrahmen fehlt",
  );
  assert.ok(
    /nicht mehr Zeit geben kann, als sein Aufrufer/.test(LOCAL_CHECK),
    "der Grund fehlt: ein Werkzeug kann sich nicht mehr Zeit geben, als sein Aufrufer einraeumt",
  );
  assert.ok(
    /stillschweigend mit demselben Wert/.test(LOCAL_CHECK),
    "die Urteilsregel zum Neustart nach Timeout fehlt",
  );
  assert.ok(
    /unabgeschlossen/.test(LOCAL_CHECK),
    "der Satz fehlt, dass die Zusammenfassung nach einem Abbruch an der Uhr unabgeschlossen und ungruen bleibt",
  );
});

test("die Haltung zum Hintergrundlauf bleibt, gleichlautend mit dem #754-Satz", () => {
  assert.ok(
    /Keine Session endet mit laufender eigener Arbeit/.test(LOCAL_CHECK),
    "der #754-Satz fehlt in skills/local-check/SKILL.md",
  );
  // Der erzwingbare Teil ist weg: kein Auftrag mehr, einen Exit-Code einzulesen.
  assert.ok(
    !/Exit-Code einlesen/.test(LOCAL_CHECK),
    "skills/local-check/SKILL.md beauftragt noch das Einlesen eines Exit-Codes",
  );
});

for (const name of ["implement-next", "implement-ready"]) {
  test(`${name}: die Zeile zum Hintergrund-Check nennt keinen Exit-Code mehr`, () => {
    const text = skillText(name);
    assert.ok(
      !/Exit-Code einlesen/.test(text),
      `skills/${name}/SKILL.md traegt den Halbsatz zum Exit-Code noch`,
    );
    // Verweis und #754-Satz bleiben — ohne sie waere die Regel ganz weg.
    assert.ok(
      /Hintergrund-Check im `local-check`-Skill/.test(text),
      `skills/${name}/SKILL.md verweist nicht mehr auf die Leitplanke`,
    );
    assert.ok(
      /Keine Session endet mit laufender eigener Arbeit/.test(text),
      `skills/${name}/SKILL.md traegt den #754-Satz nicht mehr`,
    );
  });
}

test("skills/local-check/SKILL.md verweist auf den Massstab", () => {
  assert.ok(
    /Regel im Text oder Regel im Werkzeug/.test(LOCAL_CHECK),
    "der Verweis auf den Massstab in CLAUDE-workflow.md fehlt",
  );
});

test("push-main wertet den Rueckgabewert weiter aus, ohne eigene Merkmal-Liste", () => {
  const text = skillText("push-main");
  assert.ok(
    /Im Vordergrund ausf(ü|ue)hren/.test(text),
    "die Vorgabe 'Im Vordergrund ausfuehren' fehlt",
  );
  assert.ok(
    !/Exit-Code-Guidance/.test(text),
    "der Verweis auf die Exit-Code-Guidance steht noch — sie gibt es nicht mehr",
  );
  assert.ok(
    /checks\.mjs run/.test(text) && /Fehlermerkmal/i.test(text),
    "der Ersatzsatz fehlt: `checks.mjs run` liest Rueckgabewert und Fehlermerkmale selbst",
  );
});
