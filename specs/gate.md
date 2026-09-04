# gate

- gate-1 — `.githooks/gate.mjs` (Kommando `pre-commit`, aufgerufen vom Hook `.githooks/pre-commit`) weist einen Commit ab, wenn die Pruef-Zusammenfassung fehlt, unlesbar ist, kein Feld `hashes` traegt, einen nicht gruenen Lauf enthaelt oder eine gestagte Datei nicht mit passendem Hash deckt; eine gestagte Loeschung ist durch einen `null`-Eintrag gedeckt.

## Entfallen
