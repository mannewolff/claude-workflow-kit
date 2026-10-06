// Die Bodies der Karten, die beide Fixtures der Nacht-Kette anlegen (Issue #1233): der Lauf im
// selben Prozess (`kette-fixture.mjs`) und der Prozesslauf (`kette-ablauf.mjs`).
//
// Bewusst ohne Import: Laedt der Prozesslauf diese Datei, haengen seine Tests an keinem
// Teil unter kit/night/ — das Kopplungs-Gate in `test/config-teile.test.mjs` misst Importe.

/**
 * Der Body einer fachlichen Anforderung. `marker` setzt die Zeile `Fachplan-Review:` in den
 * Kopf — so sieht eine Karte aus, die schon eine Pruefung hinter sich hat (Plan #904, E16).
 */
export function fachplanBody({ marker = null } = {}) {
  const kopf = marker ? `Autor-Modell: claude-opus-5\n${marker}` : "Autor-Modell: claude-opus-5";
  return `## Ziel\n\nEin Anliegen.\n\n${kopf}\n\n## Fachliche Akzeptanzkriterien\n\n- Eines.\n\n## Nicht-Ziele\n\n- Keines.\n\n## Offene Fragen an den PO\n\nKeine offenen Fragen.\n`;
}

/**
 * Der Body eines Plans, wie ihn /techplan anlegte. `__F__` ersetzt der Fake durch die
 * Nummer des Fachplans (NIGHT_ISSUE_ID). `offeneFragen` ist der Inhalt des Abschnitts;
 * `ohneVerifizierung` laesst den letzten Pflichtabschnitt weg (rote Formpruefung).
 */
export function planBody({ offeneFragen = "- Keine.", ohneVerifizierung = false } = {}) {
  const teile = [
    "Plan-Modell: fixture-modell",
    "Fachliche Quelle: Issue #__F__",
    "",
    "## Ziel", "", "Ein Plan aus dem Fake.", "",
    "## Betroffene Bereiche", "", "- src/plan.mjs", "",
    "## Architektonische Entscheidungen", "",
    "- A1 — Ein Weg, weil er der kuerzeste ist.",
    "- E1: Wie heisst das Feld? Gewaehlt: kurz. Verworfen: lang. Grund: Bestand. Rueckbau: trivial.", "",
    "## Geplante Änderungen", "", "- src/plan.mjs: eine Funktion.", "",
    "## Offene Fragen", "", offeneFragen, "",
  ];
  if (!ohneVerifizierung) teile.push("## Verifizierung", "", "- node --test", "");
  return teile.join("\n");
}
