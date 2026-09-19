# checks

- checks-1 — `checks.mjs run` schreibt in die Zusammenfassung je Pfad aus `geaendert` einen Blob-Hash unter `hashes`, ermittelt vor dem ersten Check; ein Pfad, der im Working Tree fehlt, traegt dort `null`.
- checks-2 — Eine wartende Vorhaben-Notiz unter `.claude/vorhaben-wartend-` zaehlt nicht als geaenderte Datei und loest keinen Bereichs-Check aus.
- checks-3 — `checks.mjs run` schreibt in die Zusammenfassung ein Feld `zeitpunkt` im ISO-8601-Format (UTC), gestempelt im selben Moment wie die Blob-Hashes und damit vor dem ersten Kommando; das Feld steht bei gruenem und rotem Lauf ebenso wie beim leeren Paket.
- checks-4 — `checks.mjs run` misst je ausgeführtem Prüfkommando die Dauer und schreibt sie als `dauerMs` in dessen Eintrag unter `laufen`, dazu `dauerGesamtMs` als Summe der gemessenen Kommandos in die Zusammenfassung; ein Eintrag mit dem Ergebnis `nicht gestartet` trägt `null` und nie 0, das leere Paket trägt `dauerGesamtMs: null`, und `checks.mjs plan` trägt beide Felder nicht.

## Entfallen
