# board

- board-2 — Bei gesetztem spec-Block legen `issue create` und `issue update` ein Arbeitspaket nur mit einem Abschnitt '## Spec-Wirkung' an, dessen Zeilen der Grammatik genuegen; geprueft wird ueber die Nachbardatei `spec.mjs`, die ueber den Test-Hook `BOARD_NACHBAR_DIR` aufgeloest wird und deren Ersatz beim Aufruf wirft, statt still durchzulassen; einen Titel mit dem Praefix [Fachlich], [Plan] oder [Idee] legen beide auch ohne den Abschnitt an.
- board-3 — `issue-review synthese-check` haelt die als uebernommen bezeichneten Funde einer Synthese gegen den zugehoerigen Body-Vorschlag und meldet je nicht belegten Fund einen der Gruende `beleg-fehlt`, `zitat-nicht-gefunden` oder `vorschlag-fehlt`; Eingaben kommen wahlweise vom Board ueber die Kartennummer oder aus zwei Dateien, ein abgewiesener Aufruf gibt ebenfalls JSON aus, und ohne behauptete Uebernahme ist das Ergebnis gruen.
- board-4 — `pickReviewers` nimmt eine Ausschlussliste, die in beiden Zweigen zusaetzlich zum Autor wirkt; bleibt der pairs-Zweig danach leer, greift der Regel-Zweig, eine gekuerzte Paarliste wird nicht aufgefuellt, und `issue-review roles --rolle synthese` liefert fest einen Reviewer mit dieser Rolle, dazu `entfall` und die uebergangenen unbekannten Ausschlussnamen.

## Entfallen
