---
name: merge-production
description: Schritt 9 des 9-Schritt-Prozesses — erstellt einen PR von main nach production. Nur auf explizite Trigger-Phrase des Menschen. Nutze diesen Skill NUR wenn der Nutzer explizit "merge production" tippt.
user-invocable: true
disable-model-invocation: true
---

# Merge Production

Schritt 9 des 9-Schritt-Prozesses: Einen Pull Request von `mainBranch` nach `productionBranch` erstellen. Der Merge selbst ist Mannes Aufgabe.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen.

## Trigger-Phrase

Der Mensch tippt: `merge production` (oder die in `.claude/workflow.config.json` unter `triggers.merge` konfigurierte Phrase).

## Ablauf

### 1. Config lesen

Lies `.claude/workflow.config.json`:
- `mainBranch`: Quell-Branch (Default: `main`)
- `productionBranch`: Ziel-Branch (Default: `production`)

### 2. Commits zusammenfassen

```bash
git log origin/<productionBranch>..origin/<mainBranch> --oneline
```

Diese Commits kommen in den PR-Body als Änderungsübersicht.

### 3. Release-Schritte (falls `RELEASING.md` existiert)

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Merge-Trigger (`merge production`) beschriebenen
  Release-Schritte aus — typischerweise ein Version-Bump. Committe die geänderten
  Dateien auf `mainBranch`, damit sie im PR nach `production` enthalten sind.
- **Nein:** Nichts weiter tun.

Der Skill selbst kennt keine projektspezifische Versions- oder Release-Logik;
diese lebt ausschließlich in der `RELEASING.md` des jeweiligen Repos.

### 4. PR bzw. MR erstellen

```bash
node .claude/kit/board.mjs code pr \
  --from <mainBranch> \
  --to <productionBranch> \
  --title "Release: <mainBranch> -> <productionBranch> (<DATUM>)"
```

Der Adapter erstellt den PR/MR provider-unabhaengig. Bei `codeHost: local` gibt er einen gefuehrten Merge-Dialog aus.

### 5. PR/MR-URL zurückgeben

Gib die URL aus dem Adapter-Output aus. Der Merge ist Mannes Aufgabe — Claude merged nicht.

> "PR/MR erstellt: <URL>. Der Merge nach production liegt bei dir."

## Was dieser Skill nicht tut

- Kein direkter Push auf `production`
- Kein Merge des PR — das macht der Mensch
- Kein automatischer PR nach Push oder nach grünem Review
- Kein Force-Merge oder Bypass von Branch-Protection-Regeln
