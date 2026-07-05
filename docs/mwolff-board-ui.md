# mwolff-board-ui — das eigenständige Board

Die lokale Kanban-GUI (`board-ui.mjs`) und der Board-Adapter (`board.mjs`) leben seit der Auslösung in einem eigenen Projekt: [mannewolff/board-ui](https://github.com/mannewolff/board-ui). Dort werden sie unabhängig vom Kit weiterentwickelt, primär um eine **Epic/Story-Ebene**.

Für Kit-Nutzer ändert sich nichts: Der Installer (`install.mjs`) bettet beide Dateien weiterhin als Base64-Blobs ein und legt sie unter `.claude/kit/` ab. Die Grundbedienung (Board starten, Drag, Detailansicht, Listenansicht, Archivierung, CLI) ist unter [Lokal arbeiten](./lokal#board-starten) beschrieben — diese Seite ergänzt nur, was über das eigenständige Projekt und die Epic-Ebene hinzukommt.

## Verhältnis zum Kit

- **Quelle der Wahrheit** ist ab jetzt das board-ui-Repo (`src/board.mjs`, `src/board-ui.mjs`).
- Das Kit **bettet** die fertigen Dateien in `install.mjs` ein. Nach Änderungen im board-ui-Repo wird der Installer über einen **manuellen Sync** aktualisiert (siehe unten).
- Beide Dateien bleiben bewusst eigenständige **Single-File-Tools** ohne npm-Dependencies — jede ist einzeln lauffähig und portabel.

## Epics und Stories

Zusätzlich zu den bisherigen Issues (reine Tasks) kennt das Board zwei Organisationsebenen: **Epic → Story/Task**. Bewusst genau zwei Ebenen, **keine** Sub-tasks: wird eine Story zu groß, wird sie in kleinere Stories unter demselben Epic geschnitten, statt eine dritte Ebene einzuführen.

Epics sind reine Organisationseinheiten. Sie **nehmen nicht am Spalten-Workflow teil** — kein Kanban-Status, nicht nach Ready ziehbar, tauchen nie in der Ready-Filterung oder bei `implement-ready` auf.

### Datenmodell

Das Frontmatter-Format ist **abwärtskompatibel** erweitert. Fehlende Felder bedeuten das bisherige Verhalten (reiner Task). Bestehende Issue-Dateien ohne `type`/`parent` funktionieren unverändert.

Ein Epic:

```markdown
---
id: "0001"
type: epic
color: "#534AB7"
shortcode: AUTH
title: Login und Authentifizierung
created: 2026-07-01
---
```

Eine Story darunter:

```markdown
---
id: "0003"
type: story
parent: "0001"
status: ready
title: Login-Formular bauen
created: 2026-07-02
---
```

- `type`: `epic | story | task` (Default: `task`)
- `parent`: id des Epics (nur bei `story`/`task`)
- `color`, `shortcode`: optionale Anzeige-Attribute am Epic (für das Karten-Badge)
- Epics tragen **kein** `status`-Feld.

Es wird nur ein **Parent-Zeiger** gespeichert, keine Kind-Liste am Epic. Die Kinder werden beim Lesen über `parent` aus allen Issues zusammengesucht — so gibt es keine zweite Quelle der Wahrheit, die driften könnte.

### Der Epics-Tab

Neben **Board** und **Liste** gibt es einen dritten Tab **Epics**. Er listet alle Epics mit Titel, Kurzbeschreibung und einem **Fortschrittsbalken** (z.B. „1/3 Stories fertig"), berechnet aus dem Status der Kinder.

Klick auf ein Epic öffnet die **Detailansicht**: ein Mini-Board nur für dieses Epic, dessen Stories/Tasks nach Status-Spalten gruppiert sind — **ohne Drag** (Epics haben keinen eigenen Workflow). Von dort legt der Button **+ Neue Story** direkt ein Issue mit vorbelegtem Parent an.

### Epic-Badge auf den Karten

Stories und Tasks mit Epic-Zugehörigkeit tragen in **Board und Liste** ein Badge: einen Farbpunkt mit Kürzel-Chip in der Epic-Farbe sowie einen farbigen linken Kartenrand. So ist die Zuordnung auch außerhalb der Epic-Ansicht auf einen Blick erkennbar. Die Farbe kommt aus dem `color`-Feld, sonst wird sie deterministisch aus einer festen Palette vergeben; das Kürzel aus `shortcode`, sonst aus den Titel-Initialen. Karten ohne Epic bleiben schlicht.

Board und Liste zeigen weiterhin **nur Stories/Tasks als Karten** — Epics erscheinen dort nicht.

### Anlegen mit Typ und Epic

Das **+ Neu**-Modal hat eine Typ-Auswahl (Task / Story / Epic) und, wenn nicht Epic, einen **Epic-Picker** über die bestehenden Epics. Bei Typ *Epic* entfällt der Picker. Aus der Epic-Detailansicht heraus ist der Parent vorbelegt.

## CLI-Erweiterungen

Der Adapter (`board.mjs`) kennt die neuen Felder:

```bash
# Epic anlegen
node .claude/kit/board.mjs issue create --title "Login und Auth" --type epic --shortcode AUTH --color "#534AB7"

# Story unter einem Epic anlegen
node .claude/kit/board.mjs issue create --title "Login-Formular" --type story --parent 0001

# Alle Epics mit Fortschritt anzeigen (nur lokaler Modus)
node .claude/kit/board.mjs issue epics
```

`issue list --status ready` gibt weiterhin nie ein Epic zurück — die Epic-Ebene ist eine Eigenschaft des lokalen Modus (`issue epics` existiert nur dort).

## Sync mit dem Kit

Nach Änderungen im board-ui-Repo wird der Kit-Installer von Hand aktualisiert (im ausgecheckten Kit-Repo):

```bash
# 1. aktuelle Dateien ins Kit kopieren
cp <board-ui>/src/board.mjs    <kit>/kit/board.mjs
cp <board-ui>/src/board-ui.mjs <kit>/kit/board-ui.mjs

# 2. eingebettete Blobs in install.mjs neu generieren
cd <kit> && node tools/sync-blobs.mjs

# 3. im Kit-Repo committen und pushen
```

`node tools/sync-blobs.mjs --check` prüft nur auf Drift (Exit 1), ohne zu ändern. Eine automatisierte CI-Variante wurde bewusst zugunsten dieses manuellen Wegs zurückgestellt — sie bräuchte Cross-Repo-Tokens.

## Stand und Ausblick

**Vorhanden:** Extraktion ins eigene Repo, Epic/Story-Datenmodell (abwärtskompatibel), Epics-Tab mit Fortschritt, Epic-Detailansicht, Epic-Badges auf Karten, Typ-/Parent-Auswahl im Anlegen-Modal, CLI-Erweiterungen, manueller Kit-Sync.

**Bewusst zurückgestellt:**

- **Jira-Adapter** — als nächster Adapter nach `github`/`gitlab`/`local` denkbar. Das Epic/Story-Modell (Parent-Referenz) ist bewusst nah am Jira-Modell gewählt, damit ein solcher Adapter es nur mappen müsste.
- **Toolbox-Anbindung** — dieselbe UI gegen das Kanban-Backend der Toolbox (React/Spring/Keycloak) laufen zu lassen, ist pausiert.
- **Sub-tasks / dritte Hierarchie-Ebene** — verworfen (siehe oben).
