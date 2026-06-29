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

### 3. PR erstellen

```bash
gh pr create \
  --base <productionBranch> \
  --head <mainBranch> \
  --title "Release: <mainBranch> -> <productionBranch> (<DATUM>)" \
  --body "## Enthaltene Commits
<Liste der Commits>

## Vorbedingungen
- [ ] Alle Issues in dieser Batch auf Done gesetzt
- [ ] Testserver-Prüfung bestanden
- [ ] Kein roter Check"
```

### 4. PR-URL zurückgeben

Gib die PR-URL aus. Der Merge ist Mannes Aufgabe — Claude merged nicht.

> "PR erstellt: <URL>. Der Merge nach production liegt bei dir."

## Was dieser Skill nicht tut

- Kein direkter Push auf `production`
- Kein Merge des PR — das macht der Mensch
- Kein automatischer PR nach Push oder nach grünem Review
- Kein Force-Merge oder Bypass von Branch-Protection-Regeln
