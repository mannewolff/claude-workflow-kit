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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const VORLAGE = readFileSync(join(repoRoot, "templates", "CLAUDE-workflow.md"), "utf-8");

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
