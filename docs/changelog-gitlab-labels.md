# Änderungsprotokoll: GitLab Label-Setup

Commits: `2e43250`, `fb069b3`  
Datum: 2026-06-30

---

## Was wurde geändert

### 1. `install.mjs` — GitLab-Labels automatisch anlegen

**Vorher:**  
Der Installer gab nach dem Setup nur einen Hinweis aus:  
> "GitLab: Lege die Labels Backlog, Ready, In-progress, In-review, Done im Projekt an."

**Nachher:**  
Der Installer fragt aktiv: *"GitLab-Labels jetzt automatisch anlegen? [j/n]"*  
Bei "j" legt er die fünf Labels per `glab label create --name` direkt im aktuellen Projekt an.  
Bei "n" gibt er den manuellen Befehl aus.

Anschließend erklärt er, dass **Board-Spalten manuell** in der GitLab-UI angelegt werden müssen (GitLab bietet dafür keine CLI).

---

### 2. Kanonische Label-Namen — Bindestrich → Leerzeichen

**Vorher:** `In-progress`, `In-review`  
**Nachher:** `In Progress`, `In Review`

**Begründung:** GitLab verwendet Label-Namen 1:1 als Board-Spaltentitel. Mit Bindestrich hieß die Spalte "In-progress", nicht "In Progress". Leerzeichen und Title Case entsprechen dem natürlichen GitLab-Board-Look.

---

### 3. `skills/implement-ready/SKILL.md` — Befehl und Namen korrigiert

| Was | Vorher | Nachher |
|---|---|---|
| CLI-Befehl | `glab issue edit` | `glab issue update` |
| Label In Progress | `"In-progress"` | `"In Progress"` |
| Label In Review | `"In-review"` | `"In Review"` |

`glab issue edit` existiert nicht — der korrekte Befehl ist `glab issue update`.

---

## Was der Installer jetzt tut (GitLab-Pfad)

1. Fragt nach Provider → `gitlab`
2. Schreibt `workflow.config.json` mit `"provider": "gitlab"`
3. Kopiert die Skills
4. Fragt: *"GitLab-Labels jetzt automatisch anlegen? [j/n]"*
5. Legt bei "j" diese Labels an:

| Label | Farbe |
|---|---|
| Backlog | `#e2e2e2` (Grau) |
| Ready | `#0075ca` (Blau) |
| In Progress | `#e4e669` (Gelb) |
| In Review | `#d93f0b` (Orange) |
| Done | `#0e8a16` (Grün) |

6. Gibt Anweisung aus, Board-Spalten manuell anzulegen:  
   **Issues → Boards → "Add list"** → je eine Spalte pro Label, Reihenfolge: Backlog → Ready → In Progress → In Review → Done

---

## Empfohlene Reihenfolge bei GitLab-Projekten

Der Installer legt Labels im **aktuellen GitLab-Projekt** an (das Projekt, auf das `glab` im aktuellen Verzeichnis zeigt). Deshalb muss das Repository vorher existieren.

**Korrekte Reihenfolge:**

1. GitLab-Repository anlegen (UI oder `glab repo create`)
2. Repository lokal klonen: `git clone <url>`
3. In das Verzeichnis wechseln: `cd <projekt>`
4. Installer aufrufen: `node install.mjs`

Wenn man den Installer **vor** dem Repository-Anlegen aufruft, schlägt der Label-Setup-Schritt stillschweigend fehl — `glab` findet kein Projekt.

---

## Was die Doku anpassen muss

- Überall wo `In-progress` / `In-review` steht: auf `In Progress` / `In Review` ändern
- Installer-Beschreibung um den Label-Setup-Schritt ergänzen
- Board-Einrichtung als manuellen Einmalschritt dokumentieren (mit Hinweis auf GitLab-Einschränkung)
- `glab issue edit` in allen Beispielen durch `glab issue update` ersetzen
