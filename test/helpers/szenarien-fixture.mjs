// Der Abschnitt Szenarien fuer Fachplaene in Test-Fixtures (Issue #1590): Ohne ein
// vollstaendiges Szenario legt `issue create` keinen Fachplan an (Gate F12, Plan #1588 E12).
// Die Schluesselwoerter gelten nur in der Projektsprache, darum je Sprache ein Abschnitt.

export const SZENARIEN = Object.freeze({
  de: "## Szenarien\n\n### Szenario: Ein Anliegen\n- Angenommen ein Anliegen\n- Wenn es eintritt\n- Dann geschieht etwas\n",
  en: "## Scenarios\n\n### Scenario: A concern\n- Given a concern\n- When it occurs\n- Then something happens\n",
});

const NICHT_ZIELE = /^## (Nicht-Ziele|Non-goals)\s*$/m;

/**
 * Der Body mit dem Abschnitt Szenarien der Sprache `sprache`: vor den Nicht-Zielen, wenn der
 * Body sie traegt (F12 verlangt die Lage zwischen Kriterien und Nicht-Zielen), sonst am Ende.
 */
export function mitSzenarien(body, sprache = "de") {
  const abschnitt = SZENARIEN[sprache];
  const treffer = NICHT_ZIELE.exec(body);
  if (treffer) return `${body.slice(0, treffer.index)}${abschnitt}\n${body.slice(treffer.index)}`;
  return `${body.trimEnd()}\n\n${abschnitt}`;
}
