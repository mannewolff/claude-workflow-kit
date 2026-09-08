# board

- board-2 — Bei gesetztem spec-Block legen `issue create` und `issue update` ein Arbeitspaket nur mit einem Abschnitt '## Spec-Wirkung' an, dessen Zeilen der Grammatik genuegen; geprueft wird ueber die Nachbardatei `spec.mjs`, die ueber den Test-Hook `BOARD_NACHBAR_DIR` aufgeloest wird und deren Ersatz beim Aufruf wirft, statt still durchzulassen; einen Titel mit dem Praefix [Fachlich], [Plan] oder [Idee] legen beide auch ohne den Abschnitt an.

## Entfallen
