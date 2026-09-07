# installer

- installer-2 — Der Installer schreibt `.githooks/gate.mjs` und `.githooks/pre-commit` ins Zielprojekt und setzt `core.hooksPath` nur auf Zustimmung und nur, wenn weder ein anderer Wert wirksam ist noch eine aktive Datei im Hooks-Verzeichnis liegt; ausserhalb eines Git-Repos und bei globaler Installation entfaellt die Frage.
- installer-3 — Traegt die Bestandsconfig beide Reviewer-Felder, schlaegt der Installer `reviewCommand` vor und `reviewModel` leer, benennt den Widerspruch vor den beiden Fragen und nennt in der Zurueckweisung beide Auswege; blosses Bestaetigen fuehrt zu einer Config mit genau einem Reviewer.
- installer-4 — Vor der Spec-Frage nennt der Installer Spec-Driven Development beim Namen, seine Wirkung auf jedes Arbeitspaket und jeden Push sowie den Doku-Abschnitt zum Nachlesen; die Unumkehrbarkeit wird an der Sache begruendet, nicht am Aufbau der Config.

## Entfallen
