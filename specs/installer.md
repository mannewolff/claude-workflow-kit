# installer

- installer-2 — Der Installer schreibt `.githooks/gate.mjs` und `.githooks/pre-commit` ins Zielprojekt und setzt `core.hooksPath` nur auf Zustimmung und nur, wenn weder ein anderer Wert wirksam ist noch eine aktive Datei im Hooks-Verzeichnis liegt; ausserhalb eines Git-Repos und bei globaler Installation entfaellt die Frage.
- installer-3 — Traegt die Bestandsconfig beide Reviewer-Felder, schlaegt der Installer `reviewCommand` vor und `reviewModel` leer, benennt den Widerspruch vor den beiden Fragen und nennt in der Zurueckweisung beide Auswege; blosses Bestaetigen fuehrt zu einer Config mit genau einem Reviewer.
- installer-4 — Vor der Spec-Frage nennt der Installer Spec-Driven Development beim Namen, seine Wirkung auf jedes Arbeitspaket und jeden Push sowie den Doku-Abschnitt zum Nachlesen; die Unumkehrbarkeit wird an der Sache begruendet, nicht am Aufbau der Config.
- installer-5 — Der Installer erzwingt bei gesetztem Test-Hook den Blob-Fehlerpfad und die TTY-Fuehrung der Fragen; der Blob-Hook traegt keinen Inhalt, ohne gesetzte Hooks verhaelt sich der Installer unveraendert, und beide Namen erscheinen in keiner Ausgabe.
- installer-6 — Der Installer schreibt Skills ausschliesslich aus dem eingebetteten Blob; konnte er keinen einzigen schreiben, bricht er mit einer benennenden Meldung und Exit-Code ungleich 0 ab, statt einen Dateisystem-Pfad zu versuchen, und ein Blob-Eintrag ohne Dateien wird als uebersprungen gemeldet.
- installer-7 — Der Installer legt die Prozessvorlage und die beiden Gate-Register bytegleich zur jeweiligen Vorlage unter `templates/` ab.

## Entfallen
