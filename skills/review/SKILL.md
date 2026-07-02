---
name: review
description: Startet einen Review durch einen Opus-Subagent in frischer Session ohne Implementierungs-Kontext. Nutze diesen Skill wenn der Nutzer /review aufruft oder Schritt 7 des Prozesses startet (Code-Review durch zweites Modell).
user-invocable: true
---

# Review

Startet Schritt 7 des 9-Schritt-Prozesses: Code-Review durch ein zweites Modell in frischer Session, ohne Kenntnis der Implementierungs-Session.

## Vorbedingung

Lies `.claude/workflow.config.json`. Die relevanten Felder:

- `reviewScope`: `"diff"` (nur git diff seit letztem Push) oder `"full"` (gesamter Quelltext)
- `reviewModel`: Modell-ID für den Reviewer (Default: `claude-opus-4-8`)
- `mainBranch`: Basis-Branch für den Diff (Default: `main`)

Fehlt die Config oder fehlen die Felder, nutze `reviewScope: "diff"` und `reviewModel: "claude-opus-4-8"` als Default und weise darauf hin.

## Ablauf

### 1. Review-Material zusammenstellen

**Bei `reviewScope: "diff"`:**
```bash
git diff origin/<mainBranch>...HEAD
```
`<mainBranch>` ist der Wert aus der Config (Default: `main`). Falls kein Remote-Commit existiert: `git diff HEAD~1 HEAD` (letzter Commit).

**Bei `reviewScope: "full"`:**
Alle relevanten Quelltext-Dateien lesen (keine Build-Artefakte, keine `node_modules`, keine `.git`-Inhalte).

### 2. Reviewer-Subagent starten

Starte einen Subagent über das Agent-Tool mit:
- **Modell:** Wert aus `reviewModel` (Opus-Pin)
- **Isolation:** frische Session, kein Implementierungs-Kontext
- **Prompt:** Der folgende Text, befüllt mit dem Review-Material aus Schritt 1:

```
Du bist Code-Reviewer. Du hast keinen Kontext über die Implementierungs-Session und das ist gewollt — du bringst einen frischen Blick.

Überprüfe das folgende Material und berichte über:
1. Korrektheit: Logikfehler, Edge Cases, falsche Annahmen
2. Sicherheit: Injections, fehlende Validierung, Secrets im Code, unsichere Patterns
3. Qualität: fehlende Tests, unklare Benennung, unnötige Komplexität
4. Architektur: Brüche gegen erkennbare Konventionen, unnötige Abhängigkeiten

Für jeden Fund:
- Datei und Zeile (wenn aus dem Material ableitbar)
- Schweregrad: KRITISCH / WICHTIG / HINWEIS
- Konkrete Beschreibung des Problems
- Vorschlag zur Behebung

Wenn du nichts findest: schreibe das explizit, nicht "alles gut".

--- REVIEW-MATERIAL ---
{{REVIEW_MATERIAL}}
```

Ersetze `{{REVIEW_MATERIAL}}` durch das tatsächliche Diff oder den Quelltext.

### 3. Ergebnis dokumentieren

Schreibe die Befunde als Kommentar ans aktuelle Issue:

```bash
node .claude/kit/board.mjs issue comment <ISSUE-NUMMER> --text "## Code-Review (Schritt 7)

<BEFUNDE>"
```

Falls kein Issue ermittelbar: Gib die Befunde direkt aus.

## Stop-Punkt

Nach dem Review wartet der Prozess auf den Menschen. Claude setzt das Issue auf **In review** — der Commit-Push (Schritt 8) erfolgt nur auf explizite Trigger-Phrase `push main`.
