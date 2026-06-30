---
name: issues
description: Schritt 3 des 9-Schritt-Prozesses — überführt einen freigegebenen Plan in kleinteilige GitHub-Issues im Vier-Abschnitt-Format. Nutze diesen Skill wenn der Nutzer /issues aufruft, Issues aus einem Plan erstellen will oder Schritt 3 des Prozesses startet.
user-invocable: true
---

# Issues

Schritt 3 des 9-Schritt-Prozesses: Der freigegebene Plan wird in ein oder mehrere GitHub-Issues überführt. Das Issue ist ab jetzt die Quelle der Wahrheit, nicht der Chat.

## Ablauf

### 1. Plan prüfen

Lies den freigegebenen Plan. Wenn kein Plan vorliegt, weise darauf hin: erst `/plan` ausführen und freigeben lassen.

### 2. Issues schneiden

Ein Issue = ein logischer Schritt, der eigenständig getestet werden kann. Kriterien:
- Ein Issue löst genau eine Sache
- Es kann isoliert committed und reviewed werden
- Es hat messbare Akzeptanzkriterien
- Abhängigkeiten zu anderen Issues sind explizit

Wenn ein Schritt sich nicht in einem überschaubaren Aufwand erledigen lässt, in Sub-Issues schneiden.

Portabilitaets-Konvention: Wenn eine Datei oder ein Artefakt als eigenstaendig portabel gedacht ist (Installer, Single-File-Tool, kopierbares Script), muss das Akzeptanzkriterium explizit enthalten: "lauffaehig ohne weiteren Repo-Kontext". Ohne diesen Prueffall bleibt die Portabilitaet ungetestet.

### 3. Issues im Vier-Abschnitt-Format anlegen

Jedes Issue bekommt vier Abschnitte:

```
## Kontext
Warum wird diese Aufgabe gemacht? Was fehlt vorher, welche Vorgeschichte gehört dazu?

## Aufgabe
Was konkret ist zu tun? Betroffene Dateien, zu schreibende Tests (bei TDD zuerst), konkrete Änderungen.

## Akzeptanzkriterium
Wie wird verifiziert, dass die Aufgabe erledigt ist? Konkret, messbar oder ausführbar.

## Abhängigkeiten
Welche anderen Issues müssen zuerst fertig sein? Oder: "Keine."
```

Lies `provider` aus `.claude/workflow.config.json` (Default: `github`).

**GitHub:**
```bash
gh issue create --repo <owner>/<repo> --title "Titel" --body "..."
```

**GitLab:**
```bash
glab issue create --title "Titel" --description "..."
```

### 4. Issues ans Board hängen

**GitHub:** Issues zum Project Board hinzufuegen:
```bash
gh project item-add <BOARD-NR> --owner <owner> --url <issue-url>
```

**GitLab:** GitLab hat keine vollstaendige Board-CLI. Status wird per Label gesetzt:
```bash
glab issue edit <NR> --label "Backlog"
```
Die Labels Backlog, Ready, In-progress, In-review, Done muessen einmalig im GitLab-Projekt angelegt sein (Hinweis gibt der Installer).

Status bleibt **Backlog**. Die Bewegung nach Ready ist das menschliche GO (Schritt 4) — Claude zieht Issues nie eigenmächtig nach Ready.

### 5. Abschluss

Liste alle angelegten Issues mit Nummern und Titeln. Schreibe:
> "Alle Issues liegen in Backlog. Zieh die Issues die du umsetzen willst nach Ready — das ist dein GO."

## Stop-Punkt

Dieser Skill endet nach dem Anlegen der Issues. Kein Code, kein Commit. Das GO (Ready-Bewegung) macht der Mensch.
