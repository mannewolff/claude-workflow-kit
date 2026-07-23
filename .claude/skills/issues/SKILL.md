---
name: issues
description: Schritt 3 des 9-Schritt-Prozesses — überführt einen freigegebenen Plan in kleinteilige GitHub-Issues im Vier-Abschnitt-Format. Nutze diesen Skill wenn der Nutzer /issues aufruft, Issues aus einem Plan erstellen will oder Schritt 3 des Prozesses startet.
user-invocable: true
---

# Issues

Schritt 3 des 9-Schritt-Prozesses: Der freigegebene Plan wird in ein oder mehrere Issues überführt. Das Issue ist ab jetzt die Quelle der Wahrheit, nicht der Chat.

## Ablauf

### 1. Plan prüfen

Prüfe, ob ein in **dieser Session** freigegebener Plan existiert. Wenn nein: **STOPP — keine Issues anlegen.** Verweise darauf, dass erst `/plan` laufen und freigegeben werden muss. Eine Ideen-/Use-Case-Liste im Chat ist **kein** freigegebener Plan.

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

**Abhängigkeits-Konvention (maschinenlesbar):** Der Abschnitt enthält entweder exakt `Keine.` oder explizite Referenzen der Form `Issue #N` (mehrere möglich, je eine pro Zeile). Erläuternder Freitext ist zusätzlich erlaubt — aber wenn ein anderes Issue gemeint ist, muss die `#N`-Referenz dabeistehen. Grund: Der Nacht-Runner (`kit/night.mjs`) wertet ausschließlich `#N`-Referenzen aus und stellt Issues mit unerfüllten Abhängigkeiten automatisch zurück; eine nur in Prosa beschriebene Abhängigkeit ist für ihn unsichtbar. Abhängigkeiten auf fremde Repos als `owner/repo#N` schreiben (mit Repo-Präfix) — sie werden bewusst nicht als lokale Issues gewertet.

**Rückverweis auf ein fachliches Issue (PO-Schleife):** Entstehen die Issues aus einem fachlichen Issue (`[Fachlich]`-Titel, via `/plan #N`), bekommt jedes technische Issue den Rückverweis **im Kontext-Abschnitt** — Formulierung: „Fachliche Quelle: Issue #N". **Niemals in den Abhängigkeiten-Abschnitt:** Der Nacht-Runner würde die `Issue #N`-Referenz dort als unerfüllte Abhängigkeit werten, und da das fachliche Issue erst Done wird, wenn seine technischen Kinder fertig sind, würden alle Kinder nachts dauerhaft zurückgestellt (Henne-Ei).

Issue anlegen ueber den Board-Adapter:

```bash
node .claude/kit/board.mjs issue create --title "Titel" --body "..."
```

Der Adapter legt das Issue an, haengt es ans Board und setzt den Status auf Backlog — provider-unabhaengig.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` statt einer Nummer eine `ideaId` mit `pending: true`, ist das Issue als board-lose Idee im Projekt-Ideen-Pool gelandet — die Board-Nummer entsteht erst, wenn der Mensch die Idee einplant. Konsequenzen für diesen Skill:
- Der Abschluss listet solche Issues mit **Titeln** (plus `ideaId`), nicht mit Nummern, und weist darauf hin, dass die Nummern beim Einplanen entstehen.
- Abhängigkeiten zwischen frisch angelegten Issues können noch keine `Issue #N`-Referenz tragen. Sie werden als erläuternder Freitext mit dem **Titel** des anderen Issues notiert; die `Issue #N`-Referenz trägt der Mensch beim Einplanen nach. Für den Nacht-Runner gilt Freitext ohne `#N` als keine prüfbare Abhängigkeit — bewusst akzeptiert, die Ready-Reihenfolge legt ohnehin der Mensch fest.

Status bleibt **Backlog**. Die Bewegung nach Ready ist das menschliche GO (Schritt 4) — Claude zieht Issues nie eigenmaechtig nach Ready. (Beim Ideen-Pool-Flow entsprechend: Einplanen und Ready-Ziehen sind menschlich.)

### 4. Abschluss

Liste alle angelegten Issues mit Nummern und Titeln.

Ergänze eine Tabelle mit einer Modell-Empfehlung pro Issue. Sie hilft dem Menschen, vor dem GO zu entscheiden, mit welchem Modell jedes Issue umgesetzt wird — ohne den Plan-Kontext noch einmal zu lesen.

| Issue | Empfehlung | Begründung |
|-------|------------|------------|
| #N | <Modell> | <ein Satz> |

Heuristik für die Empfehlung:
- **Schnelleres Standard-Modell** für mechanische, klar spezifizierte Aufgaben: ein Enum erweitern, Typen nachziehen, Restyling nach Vorlage, eine Änderung nach bestehendem Muster.
- **Stärkstes verfügbares Modell** für Aufgaben mit Architektur-, Sicherheits- oder komplexer Interaktionslogik: OAuth-Flows, neue Komponenten mit viel Zustand, Nebenläufigkeit, Datenmigrationen.

Halte die Modellnamen generisch ("Standard-Modell" / "stärkstes verfügbares Modell") und nenne das aktuell passende Modell nur als Beispiel, damit der Skill bei jedem Modell-Release aktuell bleibt. Die Begründung bleibt bei einem Satz pro Issue.

Schreibe darunter:
> "Alle Issues liegen in Backlog. Zieh die Issues die du umsetzen willst nach Ready — das ist dein GO."

## Stop-Punkt

Dieser Skill endet nach dem Anlegen der Issues. Kein Code, kein Commit. Das GO (Ready-Bewegung) macht der Mensch.
