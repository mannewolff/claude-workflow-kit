/**
 * texte/board-geschuetzt.mjs — die Texttabelle von board/geschuetzt.mjs (Issue #1526). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1482, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen dieses Teils je Sprache: die Erklaerung im Halt-Kommentar und die Befunde der
 * Formgates. Vertragswerte bleiben ausserhalb (E14): die Gate-Kennungen, der Anker
 * `## Geschuetzte Datei`, die Label-Zeilen `Label kit:geschuetzt gesetzt|nicht gesetzt` und
 * die Zeile `beim Schreiben abgewiesen` — der Runner liest sie zurueck. Was ein Gate woertlich
 * erkennt (`- Keine.`, `Keine.`, `verbindlich`, `Bildschirmfoto`, `Gewaehlt: ja`), nennen
 * auch die englischen Texte woertlich.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    haltErklaerung: "Dieses Paket nennt Dateien, die nur ein Mensch schreiben darf — eine Session darf sie nicht aendern und den Schutz nicht umgehen. Ein Mensch nimmt die Aenderung, die die zitierten Zeilen verlangen, selbst vor und nimmt danach das Label `{label}` ab; beim naechsten Anlauf laeuft das Paket dann durch, solange es keine weitere geschuetzte Datei nennt.",
    abschnittFehlt: "Abschnitt '## {name}' fehlt",
    abschnittMehrfach: "Abschnitt '## {name}' steht {anzahl}-mal",
    abschnittReihenfolge: "Abschnitt '## {name}' steht nicht in der vorgeschriebenen Reihenfolge",
    abschnittLeer: "Abschnitt '## {name}' ist leer",
    markerFalsch: "'{zeile}' — der Marker dieser Stufe heisst '{marker}'",
    f2AutorModell: "'Autor-Modell:' steht nicht mit Wert im Abschnitt '## Ziel'",
    f7PoFragen: "Abschnitt '## Offene Fragen an den PO' fehlt",
    f9Herkunft: "Herkunftszeile an der Wurzel: '{zeile}'",
    p6KeineVerboten: "'- Keine.' ist in '## {name}' nicht erlaubt",
    p6KeineErste: "'- Keine.' in '## {name}' muss die erste Zeile sein und darf keine weiteren Eintraege haben",
    p2Zusatz: "zusaetzliche Ueberschrift '## {name}' — nur ### ist zwischen den sechs Abschnitten erlaubt",
    p3PlanModell: "'Plan-Modell:' steht nicht mit Wert im Kopf vor '## Ziel'",
    i1Letzter: "'## Abhaengigkeiten' ist nicht der letzte Abschnitt",
    i2AutorModell: "'Autor-Modell:' steht nicht mit Wert im Abschnitt '## Kontext'",
    i3Leer: "'## Abhaengigkeiten' ist leer — 'Keine.' oder 'Issue #N'",
    i3OhneReferenz: "'## Abhaengigkeiten' nennt weder 'Keine.' noch eine #N-Referenz — der Nacht-Runner liest nur #N",
    i4Herkunft: "'{zeile}' gehoert in '## Kontext', nicht in die Abhaengigkeiten — der Runner laese sie als Abhaengigkeit",
    i5Vorlage: "'Vorlage: … — verbindlich' im Kontext, aber '## Akzeptanzkriterium' nennt keine Abnahme per Bildschirmfoto",
    i6Kriterium: "'## Akzeptanzkriterium' ruft die Guetemessung '{cmd}' auf — sie gehoert als buildChecks-Eintrag mit 'stufe: push' einmal an die Veroeffentlichung, nicht einmal in jedes Paket",
    i6Entscheidung: "'{zeile}' hebt die Guetemess-Konvention auf — sie gilt ohne Ausnahme, auch fuer ein Paket, das den Mess-Treiber selbst baut. Dass ein Vollauf durchlaeuft, steht unter '### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)'",
    i7OhneDatei: "'## Aufgabe' nennt keine Datei als Backtick-Pfad (z. B. `kit/board.mjs`) — ohne genannte Datei erkennt das Kit keine geschuetzte",
    i8Geschuetzt: "'{pfad}' ist geschuetzt, nur ein Mensch darf die Datei schreiben (Zeile: '{zeile}') — die Aenderung gehoert als eigene [Mensch]-Karte heraus, dieses Paket nennt die Datei dann nicht mehr",
    i9Kopie: "'{pfad}' in '## Aufgabe' (Zeile: '{zeile}') — Die installierte Kopie unter `.claude/kit/`/`.claude/skills/` wird nie von Hand geändert; im Kit ist die Quelle unter `kit/`/`skills/` gemeint, in einem installierten Projekt ein Kit-Update.",
  }),
  en: Object.freeze({
    haltErklaerung: "This package names files that only a human may write — a session must not change them and must not bypass the protection. A human makes the change the quoted lines require themselves and then removes the label `{label}`; on the next attempt the package then runs through, as long as it names no further protected file.",
    abschnittFehlt: "Section '## {name}' is missing",
    abschnittMehrfach: "Section '## {name}' appears {anzahl} times",
    abschnittReihenfolge: "Section '## {name}' is not in the prescribed order",
    abschnittLeer: "Section '## {name}' is empty",
    markerFalsch: "'{zeile}' — the marker of this stage is '{marker}'",
    f2AutorModell: "'Author-Model:' is not given with a value in section '## Goal'",
    f7PoFragen: "Section '## Open questions for the PO' is missing",
    f9Herkunft: "Origin line at the root: '{zeile}'",
    p6KeineVerboten: "'- Keine.' is not allowed in '## {name}'",
    p6KeineErste: "'- Keine.' in '## {name}' must be the first line and must have no further entries",
    p2Zusatz: "additional heading '## {name}' — only ### is allowed between the six sections",
    p3PlanModell: "'Plan-Model:' is not given with a value in the header before '## Goal'",
    i1Letzter: "'## Dependencies' is not the last section",
    i2AutorModell: "'Author-Model:' is not given with a value in section '## Context'",
    i3Leer: "'## Dependencies' is empty — 'Keine.' or 'Issue #N'",
    i3OhneReferenz: "'## Dependencies' names neither 'Keine.' nor a #N reference — the night runner reads only #N",
    i4Herkunft: "'{zeile}' belongs in '## Context', not in the dependencies — the runner would read it as a dependency",
    i5Vorlage: "'Template: … — verbindlich' in the context, but '## Acceptance criteria' names no acceptance by screenshot ('Bildschirmfoto')",
    i6Kriterium: "'## Acceptance criteria' calls the quality measurement '{cmd}' — it belongs as a buildChecks entry with 'stufe: push' once at the release, not once in every package",
    i6Entscheidung: "'{zeile}' lifts the quality-measurement convention — it applies without exception, also to a package that builds the measurement driver itself. That a full run goes through belongs under '### Manual check (human, not part of the session close)'",
    i7OhneDatei: "'## Task' names no file as a backtick path (e.g. `kit/board.mjs`) — without a named file the kit detects no protected one",
    i8Geschuetzt: "'{pfad}' is protected, only a human may write the file (line: '{zeile}') — the change belongs on its own [Mensch] card, and this package then no longer names the file",
    i9Kopie: "'{pfad}' in '## Task' (line: '{zeile}') — The installed copy under `.claude/kit/`/`.claude/skills/` is never changed by hand; in the kit the source under `kit/`/`skills/` is meant, in an installed project a kit update.",
  }),
});
