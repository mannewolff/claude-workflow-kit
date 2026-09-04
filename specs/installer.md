# installer

- installer-2 — Der Installer schreibt `.githooks/gate.mjs` und `.githooks/pre-commit` ins Zielprojekt und setzt `core.hooksPath` nur auf Zustimmung und nur, wenn weder ein anderer Wert wirksam ist noch eine aktive Datei im Hooks-Verzeichnis liegt; ausserhalb eines Git-Repos und bei globaler Installation entfaellt die Frage.

## Entfallen
