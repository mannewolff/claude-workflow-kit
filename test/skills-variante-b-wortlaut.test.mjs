// Der Variante-B-Satz steht an sechs Stellen und muss zeichengleich bleiben (Issue #898).
//
// Das Gate W1 ist die Quelle: Es zitiert die Regel, die weiter oben in derselben Datei
// steht, und nennt seine Fundstellen selbst. Fuenf weitere Stellen wiederholen den Satz —
// zwei in `templates/CLAUDE-workflow.md`, drei in den Implementierungs-Skills. Keine
// davon ist an die anderen gebunden, und genau das ist die Gefahr: Wird nur eine
// geaendert, behauptet ein Skill weiter, das GO liege am Fachplan, waehrend die Kette es
// an der gekennzeichneten Karte liest. Der Test macht diese Drift rot.
//
// Gelesen wird die Quelle unter templates/ und skills/, nicht die installierte Kopie
// unter .claude/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE_PFAD = ["templates", "CLAUDE-workflow.md"];
const VORLAGE = lies(...VORLAGE_PFAD);

const SATZ_ANFANG = "Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B:";
const SATZ_SCHLUSS = "unter Variante B lief.";

/** Ein Abschnitt der Vorlage, von seiner Ueberschrift bis zur naechsten gleicher Ebene. */
function abschnitt(text, ueberschrift) {
  const idx = text.indexOf(ueberschrift);
  assert.ok(idx >= 0, `Abschnitt '${ueberschrift}' fehlt`);
  const ebene = ueberschrift.split(" ")[0];
  return text.slice(idx + ueberschrift.length).split(`\n${ebene} `)[0];
}

/** Der Variante-B-Satz aus einem Text — vom Anfang bis zum Schluss einschliesslich. */
function varianteBSatz(text, wo) {
  const start = text.indexOf(SATZ_ANFANG);
  assert.ok(start >= 0, `${wo}: der Variante-B-Satz fehlt`);
  const ende = text.indexOf(SATZ_SCHLUSS, start);
  assert.ok(ende >= 0, `${wo}: der Variante-B-Satz endet nicht auf '${SATZ_SCHLUSS}'`);
  return text.slice(start, ende + SATZ_SCHLUSS.length);
}

/** Die fuenf uebrigen Fundstellen: Name, Text, in dem genau eine davon steht. */
const UEBRIGE = [
  ["templates/CLAUDE-workflow.md, „Die drei Stop-Punkte (nie automatisiert)\"",
    () => abschnitt(VORLAGE, "## Die drei Stop-Punkte (nie automatisiert)")],
  ["templates/CLAUDE-workflow.md, „Nachtbetrieb (optional)\"",
    () => abschnitt(VORLAGE, "## Nachtbetrieb (optional)")],
  ["skills/implement-next/SKILL.md", () => lies("skills", "implement-next", "SKILL.md")],
  ["skills/implement-done/SKILL.md", () => lies("skills", "implement-done", "SKILL.md")],
  ["skills/implement-ready/SKILL.md", () => lies("skills", "implement-ready", "SKILL.md")],
];

test("[skills-variante-b-wortlaut-1] der Satz aus W1 steht zeichengleich an den fuenf uebrigen Fundstellen", () => {
  const quelle = varianteBSatz(abschnitt(VORLAGE, "### W1 — Die drei Stop-Punkte bleiben menschlich `[Urteil]`"), "W1");
  for (const [wo, holen] of UEBRIGE) {
    assert.equal(varianteBSatz(holen(), wo), quelle, `${wo}: der Variante-B-Satz weicht vom Wortlaut in W1 ab`);
  }
});

// Der Satz nennt seit Issue #898 die gekennzeichnete Karte, nicht mehr den Fachplan:
// Die Kette nimmt auch ein Plandokument als Auftrag an, und das GO liegt dann dort.
test("[skills-variante-b-wortlaut-2] der Satz verortet das GO an der gekennzeichneten Karte, nicht am Fachplan", () => {
  const quelle = varianteBSatz(abschnitt(VORLAGE, "### W1 — Die drei Stop-Punkte bleiben menschlich `[Urteil]`"), "W1");
  assert.ok(quelle.includes("gekennzeichneten Karte"), "der Satz nennt die gekennzeichnete Karte nicht");
  assert.ok(quelle.includes("fachlichen Anforderung"), "der Satz nennt die fachliche Anforderung als Ort nicht");
  assert.ok(quelle.includes("Plandokument"), "der Satz nennt das Plandokument als Ort nicht");
});

test("[skills-variante-b-wortlaut-3] keine der sechs Dateien verortet das GO noch am Fachplan", () => {
  const dateien = [
    ["templates/CLAUDE-workflow.md", VORLAGE],
    ["skills/implement-next/SKILL.md", lies("skills", "implement-next", "SKILL.md")],
    ["skills/implement-done/SKILL.md", lies("skills", "implement-done", "SKILL.md")],
    ["skills/implement-ready/SKILL.md", lies("skills", "implement-ready", "SKILL.md")],
  ];
  for (const [name, text] of dateien) {
    assert.ok(
      !text.includes("Das GO hat der Mensch am Fachplan gegeben"),
      `${name} verortet das GO noch am Fachplan`
    );
  }
});
