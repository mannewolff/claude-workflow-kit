---
name: push-main
description: Schritt 8 des 9-Schritt-Prozesses — pusht den aktuellen Commit-Batch auf main. Nur auf explizite Trigger-Phrase des Menschen. Nutze diesen Skill NUR wenn der Nutzer explizit "push main" tippt.
user-invocable: true
disable-model-invocation: true
---

# Push Main

Schritt 8 des 9-Schritt-Prozesses: Den aktuellen Commit-Batch auf `origin/main` pushen.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen.

## Trigger-Phrase

Der Mensch tippt: `push main` (oder die in `.claude/workflow.config.json` unter `triggers.push` konfigurierte Phrase).

Eine frühere Push-Freigabe in derselben Session gilt **nicht** für neue Commits. Jeder Push braucht eine neue explizite Freigabe.

## Ablauf

### 1. Config lesen

Lies `.claude/workflow.config.json`:
- `mainBranch`: Ziel-Branch (Default: `main`)

### 2. Stand prüfen

```bash
git status
git log origin/main..HEAD --oneline
```

Zeige welche Commits gepusht werden. Der Mensch soll wissen, was fährt.

### 3. Release-Schritte (falls `RELEASING.md` existiert)

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Push-Trigger (`push main`) beschriebenen
  Release-Schritte aus — typischerweise ein Version-Bump. Nimm alle dabei
  geänderten Dateien in **denselben** Push-Batch auf (mit committen), bevor du
  pushst.
- **Nein:** Nichts weiter tun — direkt weiter zu Schritt 4.

Der Skill selbst kennt keine projektspezifische Versions- oder Release-Logik;
diese lebt ausschließlich in der `RELEASING.md` des jeweiligen Repos.

### 4. Pushen

```bash
git push origin <mainBranch>
```

### 5. Bestätigung

Melde den neuen Stand auf `origin/<mainBranch>` mit dem letzten Commit-Hash.

Hinweis auf nächsten Schritt:
> "Commit-Batch gepusht. Wenn der Test-Server automatisch zieht: dort prüfen. Dann auf Wunsch \`merge production\` für den PR nach production."

## Was dieser Skill nicht tut

- Keine Force-Pushes
- Kein Push auf `production` oder andere Branches
- Kein Push ohne vorherige Bestätigung durch den Menschen (Trigger-Phrase)
- Kein automatischer Push nach Commit, nach grünem Check oder nach Review
