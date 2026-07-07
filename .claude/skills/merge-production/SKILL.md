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

### 3. Versions-Bump

```bash
node tools/version.mjs --minor
```

Bumpt `.claude/workflow.config.json` **und** synchronisiert install.mjs' `VERSION`-Konstante
(install.mjs traegt damit beim naechsten Docs-Deploy, ausgeloest durch den Push auf
`productionBranch`, die korrekte Version). Ergebnis committen und auf `mainBranch` pushen:

```bash
git add .claude/workflow.config.json install.mjs
git commit -m "chore: vX.Y.Z"
git push origin <mainBranch>
```

Dieser Commit loest **keinen** zusaetzlichen Patch-Bump aus — er ist Teil dieses
Release-Schritts, kein separates `push main` fuer denselben Commit.

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
