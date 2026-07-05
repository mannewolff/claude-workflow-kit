# mwolff-board-ui — das Kanban-Board

Eine schlanke Kanban-Oberfläche für die Issues deines Projekts. Sie läuft lokal im Browser, zeigt alle Issues auf einen Blick und lässt dich sie anlegen, verschieben, kommentieren und in Epics organisieren.

## Starten

```bash
node .claude/kit/board-ui.mjs
```

Öffnet das Board auf `http://localhost:3000`. Oben rechts wechselst du zwischen drei Ansichten — **Board**, **Liste** und **Epics** — und legst über **+ Neu** ein Issue an.

## Board

Die klassische Kanban-Ansicht mit fünf Spalten: **Backlog**, **Ready**, **In Progress**, **In Review**, **Done**. Die Spalten füllen die Bildschirmbreite; erst bei sehr schmalen Fenstern wird horizontal gescrollt.

- **Karten verschieben:** Zieh eine Karte per Drag in eine andere Spalte — das ändert den Status des Issues.
- **Details öffnen:** Klick auf eine Karte öffnet die Detailansicht mit dem vollen Text (siehe unten).
- **Epic-Zugehörigkeit:** Gehört eine Karte zu einem Epic, trägt sie ein farbiges Kürzel-Label und einen farbigen linken Rand in der Epic-Farbe — so siehst du die Zuordnung auf einen Blick.

## Liste

Eine kompakte Tabelle aller Issues über die volle Breite. Jede Zeile zeigt Nummer, Status, Titel und einen kurzen Textauszug.

- **Filtern:** Die Buttons oben blenden einzelne Status ein oder aus. **Archiv** ist standardmäßig ausgeblendet.
- **Sortieren:** Zieh Issues am `⠿`-Griff in eine andere Reihenfolge (außer Done und archivierte). Die Reihenfolge gilt sofort auch für die Kartenreihenfolge im Board.
- **Spaltenbreite:** Die Grenze zwischen Titel und Textauszug lässt sich wie in einer Tabelle per Maus ziehen; die Breite bleibt über Reloads erhalten.
- Auch hier tragen Issues mit Epic-Zugehörigkeit ihr farbiges Kürzel-Label.

## Epics

Die dritte Ansicht organisiert Issues in **Epics** (größere Vorhaben) mit ihren **Stories** und **Tasks** darunter.

- **Übersicht:** Jedes Epic erscheint als Karte mit Titel, Kurzbeschreibung und einem **Fortschrittsbalken** (z.B. „3/7 Stories fertig"), der sich aus dem Stand der zugehörigen Issues ergibt.
- **Hineinschauen:** Klick auf ein Epic öffnet ein Mini-Board nur für dieses Epic — seine Stories und Tasks nach Status-Spalten sortiert. Von dort legst du über **+ Neue Story** direkt ein Issue an, das dem Epic zugeordnet ist.

Epics selbst erscheinen bewusst nicht als Karten im Board oder in der Liste — dort stehen nur die tatsächlich abarbeitbaren Stories und Tasks.

## Ein Issue im Detail

Ein Klick auf eine Karte (oder eine Listenzeile) öffnet die Detailansicht:

- Der **volle Issue-Text** mit den vier Abschnitten Kontext, Aufgabe, Akzeptanzkriterium und Abhängigkeiten.
- Über **Bearbeiten** änderst du Titel und Haupttext direkt; vorhandene Kommentare bleiben erhalten.
- Unten kannst du einen **Kommentar** anhängen — etwa Notizen aus einem Review.

## Neues Issue anlegen

Der Button **+ Neu** oben rechts öffnet das Anlegen-Formular:

- **Typ:** Task, Story oder Epic.
- **Epic:** Bei Task oder Story wählst du optional ein übergeordnetes Epic aus. (Bei Typ Epic entfällt das.)
- **Titel** und **Beschreibung** — die Beschreibung ist mit der Vier-Abschnitt-Vorlage (Kontext, Aufgabe, Akzeptanzkriterium, Abhängigkeiten) vorbefüllt.

Das neue Issue landet in der Backlog-Spalte.

## Automatisches Archivieren

Issues, die länger als drei Tage im Status **Done** stehen, werden automatisch archiviert. Sie verschwinden aus Board und Liste, bleiben aber über den **Archiv**-Filter in der Listenansicht sichtbar. So bleibt das Board übersichtlich, ohne dass Erledigtes verloren geht.
