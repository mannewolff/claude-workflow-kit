# checks

- checks-1 — `checks.mjs run` schreibt in die Zusammenfassung je Pfad aus `geaendert` einen Blob-Hash unter `hashes`, ermittelt vor dem ersten Check; ein Pfad, der im Working Tree fehlt, traegt dort `null`.
- checks-2 — Eine wartende Vorhaben-Notiz unter `.claude/vorhaben-wartend-` zaehlt nicht als geaenderte Datei und loest keinen Bereichs-Check aus.

## Entfallen
