// Die Mitteilungsregel im Prozesstext (Issue #560, Plan #554, fachlich #541).
//
// Sagt der Mensch "der Nachtlauf laeuft noch", gilt das — die Sitzung schlaegt nicht
// nach, sondern uebernimmt und weist die Nichtpruefung in einer festen Zeile aus.
// Erzwingen laesst sich das nicht; wer die Zeile schreibt und daneben doch nachsieht,
// erzeugt aber einen sichtbaren Widerspruch. Dasselbe Muster wie `Bestand: gelesen`
// in `skills/issue-review/SKILL.md` (Issue #268).
//
// Geprueft wird Text, nicht Verhalten. Deshalb greifen die Tests GEZIELT den einen
// Abschnitt bzw. den einen Skill-Abschnitt heraus: Ein Wortfund ueber die ganze Datei
// waere hier wertlos. "explizit" steht in beiden Release-Skills laengst mehrfach, ein
// globaler Test waere schon vor der Aenderung gruen gewesen — dieselbe Falle, die der
// Kopfkommentar von `docs-lebenszyklus.test.mjs` beschreibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE = lies("templates", "CLAUDE-workflow.md");

const UEBERSCHRIFT = "## Mitteilungen des Menschen";

/** Der Wortlaut der Antwortform — eine Zeile, samt Platzhaltern. */
const ANTWORTFORM =
  'Mitteilung übernommen, ungeprüft — <Reichweite>. Folge: <ein Satz; „Keine Änderung." ist gültig>.';

/** Die beiden Reichweiten-Varianten, zwischen denen das System entscheidet. */
const REICHWEITEN = ["gilt, bis du Entwarnung gibst", "gilt für dieses Gespräch"];

/**
 * Der Text eines Abschnitts: von seiner Ueberschrift bis zur naechsten Ueberschrift
 * derselben Ebene (oder zum Dateiende). Unterabschnitte gehoeren dazu.
 */
function abschnitt(text, ueberschrift) {
  const ebene = ueberschrift.match(/^#+/)[0];
  const start = text.indexOf(`${ueberschrift}\n`);
  if (start === -1) return "";
  const rest = text.slice(start + ueberschrift.length);
  const naechste = rest.search(new RegExp(`^${ebene} `, "m"));
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

/** Die Inhalte aller eingezaeunten Codebloecke eines Textstuecks. */
function codebloecke(text) {
  return [...text.matchAll(/^ {0,3}```[^\n]*\n([\s\S]*?)^ {0,3}```/gm)].map((m) => m[1]);
}

test("Die Vorlage fuehrt den Abschnitt 'Mitteilungen des Menschen' genau einmal", () => {
  const treffer = VORLAGE.match(/^## Mitteilungen des Menschen$/gm) || [];
  assert.equal(
    treffer.length,
    1,
    `'${UEBERSCHRIFT}' steht ${treffer.length}-mal in templates/CLAUDE-workflow.md —`
      + " zwei Abschnitte gaeben zwei Fassungen derselben Regel, keiner gar keine",
  );
});

// Einzelne Wortfunde genuegen hier nicht: Sie blieben gruen, wenn die Marker an
// getrennten Stellen der Datei staenden oder die feste Form zusaetzliche Zeilen
// bekaeme. Beides waere eine andere Regel als die beschlossene.
test("Der Abschnitt gibt die Antwortform woertlich vor und erklaert beide Reichweiten", () => {
  const text = abschnitt(VORLAGE, UEBERSCHRIFT);
  assert.ok(text, `Abschnitt '${UEBERSCHRIFT}' fehlt`);

  const bloecke = codebloecke(text);
  assert.ok(
    bloecke.some((b) => b.trim() === ANTWORTFORM),
    "kein Codeblock im Abschnitt enthaelt genau die Antwortform. Gefunden:\n"
      + bloecke.map((b) => JSON.stringify(b)).join("\n"),
  );

  for (const variante of REICHWEITEN) {
    assert.ok(
      text.includes(variante),
      `die Reichweiten-Variante "${variante}" wird im Abschnitt nicht erlaeutert`,
    );
  }
});

test("Der Abschnitt nimmt den unbeaufsichtigten Betrieb aus", () => {
  const text = abschnitt(VORLAGE, UEBERSCHRIFT);
  assert.match(
    text,
    /unbeaufsichtigt/i,
    "der Abschnitt sagt nichts zum unbeaufsichtigten Lauf — dann laese eine"
      + " Nacht-Session Prompt-Text als Mitteilung, obwohl niemand sie gegeben hat",
  );
});

// Derselbe Schnitt wie "Der Verweis aus CLAUDE-Plan.md zeigt auf einen existierenden
// Abschnitt" (Issue #380): Ein Verweis ist nur dann einer, wenn sein Ziel da ist.
test("W1 nennt das Zitat-Kriterium und verweist auf einen existierenden Abschnitt", () => {
  const w1 = abschnitt(VORLAGE, "### W1 — Die drei Stop-Punkte bleiben menschlich `[Urteil]`");
  assert.ok(w1, "Gate W1 fehlt in templates/CLAUDE-workflow.md");
  assert.match(
    w1,
    /Mitteilungen des Menschen/,
    "W1 nennt die Fundstelle 'Mitteilungen des Menschen' nicht",
  );
  assert.match(
    w1,
    /zitiert/,
    "W1 sagt nicht, dass eine zitierte Trigger-Phrase kein getippter Trigger ist",
  );
  assert.match(VORLAGE, /^## Mitteilungen des Menschen$/m, "der Abschnitt, auf den W1 zeigt, fehlt");
});

test("[skills-5] Beide Release-Skills verlangen die Trigger-Phrase getippt, nicht zitiert", () => {
  for (const skill of ["push-main", "merge-production"]) {
    const trigger = abschnitt(lies("skills", skill, "SKILL.md"), "## Trigger-Phrase");
    assert.ok(trigger, `${skill}: Abschnitt 'Trigger-Phrase' fehlt`);
    assert.match(
      trigger,
      /getippt/,
      `${skill}: der Abschnitt 'Trigger-Phrase' verlangt die Phrase nicht ausdruecklich getippt`,
    );
    assert.match(
      trigger,
      /Zitat|zitiert/,
      `${skill}: der Abschnitt 'Trigger-Phrase' sagt nicht, dass eine zitierte Phrase Text ist`,
    );
    assert.match(
      trigger,
      /Mitteilungen des Menschen/,
      `${skill}: der Abschnitt 'Trigger-Phrase' nennt die Fundstelle nicht`,
    );
    assert.match(
      trigger,
      /CLAUDE-workflow\.md/,
      `${skill}: der Abschnitt 'Trigger-Phrase' nennt die Datei der Fundstelle nicht`,
    );
  }
});
