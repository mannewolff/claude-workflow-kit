# Dokumentation: claude-workflow-kit

Eine dünne Werkzeugschicht, die einen 9-Schritt-Kernprozess für KI-gestützte Entwicklung in Claude Code ausführbar macht. Das Kit automatisiert die KI-Schritte und lässt die drei menschlichen Verantwortungsschwellen bewusst stehen.

## Konzept

Das Kit ist keine Plattform und kein Agent. Es ist eine Bibliothek aus zehn Skills, eine projektlokale Config und ein Installer.

Die Skills sind projekt-unabhängig geschrieben. Alles Projekt-Spezifische (Build-Kommandos, Branch-Namen, Review-Modell) kommt aus der Config-Datei. Ein Update an einem Skill gilt damit in allen Projekten, in denen du das Kit nutzt. Du musst nicht in jedem Repo etwas anpassen, wenn sich der Prozess weiterentwickelt.

Der Kernprozess hat neun Schritte. Schritt 1 ist deine Anforderung; die KI übernimmt die Schritte 2, 3, 5, 6 und 7. Die drei menschlichen Stop-Punkte sind Schritt 4 (GO), Schritt 8 (Push) und Schritt 9 (Merge); zwischen Push und Merge prüfst du den Test-Server. Drei weitere Skills stehen außerhalb der Nummerierung und strukturieren den Arbeitsrhythmus: /kontext, /retro und /document.

## Voraussetzungen

**Node.js 18 oder neuer.** Der Installer ist in Node geschrieben und läuft damit auf Mac, Windows und Linux ohne Abhängigkeit zu einem bestimmten Shell-Ökosystem.

**git.** Claude Code und der gesamte Prozess setzen git voraus. Ohne git-Repository funktioniert kein Skill.

**Claude Code in einer aktuellen Version.** Die Skills nutzen das Skills-System von Claude Code. Ältere Versionen kennen dieses System möglicherweise nicht.

**Ein Board-Adapter — und die passende CLI dazu.** Alle Issue- und Board-Operationen laufen über `.claude/kit/board.mjs`, den Board-Adapter. Der Adapter schirmt die Skills von der konkreten Plattform ab. Was du brauchst, hängt vom gewählten Issue-Tracker ab:

| Issue-Tracker | Voraussetzung |
|---------------|---------------|
| `github` | `gh` (GitHub CLI), einmalig `gh auth login` |
| `gitlab` | `glab` (GitLab CLI), einmalig `glab auth login` |
| `local` | Nichts — Issues liegen als Dateien in `issues/` |

**Ein Projekt-Board, falls du GitHub oder GitLab als Issue-Tracker nutzt.** Das Board braucht diese fünf Spalten: Backlog, Ready, In Progress, In Review, Done. Bei GitHub sind das Projekt-Board-Spalten (GitHub Projects), bei GitLab werden sie durch Labels abgebildet. Im lokalen Modus gibt es kein Board — der Adapter schreibt und liest YAML-Frontmatter-Dateien direkt.

**`kontext.config.json` für /kontext und /document (optional).** Beide Skills laufen auch ohne diese Datei im Degraded Mode. Wenn du persistentes projektübergreifendes Memory willst: Bei globaler Installation fragt der Installer nach dem Vault-Pfad und legt die Datei automatisch an, bei projektlokaler Installation legst du sie manuell an. Details im Abschnitt [kontext.config.json](#kontext-config-json-referenz).

## Installation

Wechsle in deinen Projektordner und führe aus:

```bash
npx claude-workflow-kit
```

Alternativ kannst du den Installer herunterladen und direkt starten:

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

Oder in einem Schritt ohne lokale Datei:

```bash
node <(curl -s https://docs.mwolff.org/install.mjs)
```

Der Installer stellt sieben Fragen — bei globaler Installation folgt eine achte:

**1. Global oder projektlokal.** Global legt die Skills in `~/.claude/skills/` ab. Sie stehen dann in allen deinen Projekten zur Verfügung. Projektlokal legt sie in `./.claude/skills/` ab. Sie gehören zum Repo. Für teamverbindliche Prozesse wähle projektlokal, für die persönliche Nutzung global. Bei projektlokal fügt der Installer `.claude/` automatisch in `.gitignore` ein.

**2. Code-Host.** Wo liegen Pull Requests und das Repo? `github`, `gitlab` oder `local` (kein Remote, kein PR).

**3. Issue-Tracker.** Wo werden Issues verwaltet? Standard ist der Wert von Code-Host. Unabhängige Wahl ist möglich, z.B. `issueTracker: local` bei `codeHost: github`.

**4. Name des main-Branch.** In den meisten Repos `main`, manchmal `develop` oder `master`. Dieser Branch ist das Ziel von /push-main.

**5. Name des production-Branch.** Oft `production` oder `release`. /merge-production erstellt einen PR oder MR von main auf diesen Branch.

**6. Review-Umfang (`diff` oder `full`).** Mit `diff` bekommt der Review-Skill nur die geänderten Zeilen zu sehen. Mit `full` alle Dateien im Repo. Für kleine Änderungen reicht `diff`. Für größere Refactorings ist `full` aussagekräftiger, kann aber bei sehr großen Repos das Kontextfenster überlasten.

**7. Review-Modell.** Das Modell, das in der frischen Review-Session läuft. Standard ist `claude-opus-4-8`.

**8. Vault-Pfad (nur bei globaler Installation).** Pfad zum Memory-Vault für /kontext und /document. Leer lassen überspringt den Schritt; mit Pfad schreibt der Installer die globale `~/.claude/kontext.config.json`.

Der Installer kopiert die zehn Skills, schreibt eine `.claude/workflow.config.json` mit deinen Antworten, legt eine `CLAUDE-workflow.md` mit der Prozessbeschreibung ab und schreibt den Board-Adapter in `.claude/kit/board.mjs` sowie die lokale Board-UI in `.claude/kit/board-ui.mjs` (eine Kanban-Ansicht für den lokalen Modus, siehe [Lokal arbeiten](./lokal#board-starten)). Bei GitLab fragt er zusätzlich, ob er die fünf Labels automatisch anlegen soll. Kein Hintergrundprozess, kein Service, keine Registry-Einträge.

Nach der Installation startest du Claude Code neu. Die Skills erscheinen dann unter `/help`.

## Was ist der Vault?

Der Vault ist ein persönlicher Memory-Speicher außerhalb des Repos. Er hält projektübergreifendes Wissen: dein Profil, Arbeitsregeln, Entscheidungshistorie und Tages-Logs. /kontext lädt ihn zu Session-Beginn, /document schreibt am Session-Ende in ihn hinein.

Der Vault ist optional. Ohne Vault laufen beide Skills im Degraded Mode (Details im Abschnitt [Was passiert ohne Vault?](#was-passiert-ohne-vault)).

Wenn du einen Vault einrichten willst, lege ein Verzeichnis an und trage den Pfad in `~/.claude/kontext.config.json` ein. Die erwartete Struktur:

```
/pfad/zu/deinem/memory-vault/
  Index.md                          (Übersicht, was im Vault liegt)
  Profil.md                         (oder vergleichbare always-Dateien)
  Projekte/
    {repo-name}/
      {repo-name}.md                (Projektnotiz, wird von /document aktualisiert)
  Log/
    YYYY-MM-DD.md                   (Tages-Logs, von /document geschrieben)
```

Die Dateinamen der always-Dateien (Index.md, Profil.md) konfigurierst du selbst in `kontext.config.json`. Die Verzeichnisstruktur unter `Projekte/` und `Log/` wird von den Skills erwartet und muss einmalig manuell angelegt werden.

## Die Config-Datei

Die `.claude/workflow.config.json` ist die einzige projektlokale Stelle. Alle Skills lesen ausschließlich aus dieser Datei (nirgendwo sonst werden Projektparameter hart kodiert).

```json
{
  "codeHost": "github",
  "issueTracker": "github",
  "buildChecks": ["<dein build-kommando>", "<dein test-kommando>"],
  "mutationCommand": "",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" },
  "local": { "issuesDir": "issues" },
  "github": { "projectNumber": 11 }
}
```

`codeHost` steuert, welche Plattform für Repository und Pull Requests genutzt wird (`github`, `gitlab` oder `local`). `issueTracker` steuert, wo Issues angelegt und bewegt werden — unabhängig von `codeHost` wählbar. Der Board-Adapter `.claude/kit/board.mjs` liest beide Felder und leitet alle Board-Operationen entsprechend weiter.

`local.issuesDir` gibt das Verzeichnis an, in dem lokale Issues als Markdown-Dateien liegen (`issues/0001.md`, `issues/0002.md`, …). `github.projectNumber` ist die Projekt-Nummer des GitHub Projects Board — nur für `issueTracker: github` relevant.

Bei `issueTracker: github` legt der Adapter beim ersten Zugriff eine Cache-Datei `.claude/board-meta-cache.json` mit den Project-Metadaten (Project-ID, Status-Feld- und Options-IDs) an. Sie erspart jedem weiteren `board.mjs`-Aufruf zwei GraphQL-Abfragen und schont so das GitHub-Kontingent. Die Datei ist maschinenlokal und gehört nicht ins Repository — der Installer ignoriert `.claude/` ohnehin komplett; committest du `.claude/` selbst, nimm `.claude/board-meta-cache.json` in die `.gitignore` auf. Löschst du sie, wird sie beim nächsten Aufruf neu aufgebaut; veraltete IDs heilt der Adapter automatisch.

`columns` steuert die Spaltennamen auf dem Board. Die fünf Schlüssel (`backlog`, `ready`, `in_progress`, `in_review`, `done`) sind fix — sie stehen im Frontmatter der Issue-Dateien und sind die internen Status-Werte. Die Werte sind die angezeigten Bezeichnungen und frei wählbar. Bei GitHub entsprechen die Werte den Spaltennamen im Project Board, bei GitLab den Label-Namen. Ohne `columns` in der Config gelten die Defaults: Backlog, Ready, In Progress, In Review, Done.

`buildChecks` enthält die Kommandos, die `/local-check` sequenziell ausführt. Alle müssen grün sein, bevor der Skill Vollzug meldet. `mutationCommand` ist aus `buildChecks` ausgelagert, weil Mutation Testing deutlich länger läuft (ein leerer String deaktiviert es). `reviewScope` steuert den Umfang für `/review`. `reviewModel` pinnt das Modell über Sessiongrenzen hinweg. `triggers` hält die natürlichsprachlichen Phrasen, falls du lieber tippst als Slash-Befehle nutzt.

**Rückwärtskompatibilität:** Repos, die noch `"provider": "github"` oder `"provider": "gitlab"` in der Config haben, funktionieren weiter. Der Adapter migriert das Feld beim Lesen automatisch auf `codeHost` und `issueTracker`.

Beispiele für verschiedene Stacks:

| Stack | buildChecks | mutationCommand |
|-------|-------------|-----------------|
| Java / Maven | `["mvn verify"]` | `"mvn org.pitest:pitest-maven:mutationCoverage"` |
| Node / npm | `["npm test", "npm run build"]` | `""` |
| Python | `["pytest", "python -m build"]` | `""` |
| Go | `["go test ./...", "go build ./..."]` | `""` |

Du kannst die Config-Datei jederzeit manuell bearbeiten. Der Installer überschreibt sie beim erneuten Ausführen nur, wenn du das explizit bestätigst.

## Die zehn Skills und der 9-Schritt-Kernprozess

Der Kernprozess hat neun Schritte. Drei weitere Skills (Querschnitts-Skills) stehen außerhalb der Nummerierung.

| Schritt | Was | Wer | Skill |
|---------|-----|-----|-------|
| **1** | **Anforderung formulieren** | **Mensch** | (kein Skill) |
| 2 | Anforderung planen | KI | /plan |
| 3 | Issues anlegen | KI | /issues |
| **4** | **GO: Issues nach Ready ziehen** | **Mensch** | (kein Skill) |
| 5 | Ready-Issues implementieren | KI | /implement-ready |
| 6 | Lokale Checks ausführen | KI | /local-check |
| 7 | Review durchführen | KI | /review |
| **8** | **Push auf main** | **Mensch** | /push-main |
| **9** | **Merge nach production** | **Mensch** | /merge-production |

Zwischen Schritt 8 und 9 prüfst du den Test-Server im Browser — kein eigener Skill, aber Pflicht. Diese Zählung ist dieselbe wie in der `CLAUDE-workflow.md` und in den Skill-Definitionen.

Querschnitts-Skills: /kontext (Session-Start), /retro (Wartungsrhythmus), /document (Session-Ende).

### /kontext

**Querschnitts-Skill, Session-Start.**

Der Skill lädt den Kontext, den du brauchst, um sofort arbeitsfähig zu sein, ohne den Chat der letzten Session im Kopf haben zu müssen. Er liest `kontext.config.json` (zuerst global aus `~/.claude/`, dann lokal aus `.claude/`, wobei lokale Werte die globalen überschreiben).

Wenn ein Vault konfiguriert ist, lädt er die `always`-Dateien daraus (Profil, Arbeitsregeln), erkennt die Projektnotiz automatisch anhand des Repo-Namens und liest zusätzliche `projectDocs`. Ohne Vault holt er die offenen Issues per CLI und liest `projectDocs` aus dem Repo. Die Ausgabe ist ein kurzer Lageüberblick: offene Issues, letzte Entscheidungen, was als nächstes ansteht.

### /plan

**Schritt 2, nach der Anforderung (Schritt 1), vor der Implementierung.**

Du gibst die Anforderung, der Skill erzeugt einen Plan. Der Plan benennt Ziel und Nutzerwirkung, betroffene Bereiche und Dateien, architektonische Entscheidungen mit Begründung, offene Fragen und die geplante Verifizierung. Anschließend stellt er den Plan zur Diskussion.

Der Skill implementiert nichts. Er stellt keine Issues an. Er wartet auf dein Feedback. Der Plan ist Diskussionsgrundlage, kein Auftrag und noch keine Freigabe.

### /issues

**Schritt 3, nach der Plan-Freigabe.**

Aus dem freigegebenen Plan werden ein oder mehrere Issues. Jedes Issue ist kleinteilig genug, um eigenständig getestet zu werden, und enthält vier Abschnitte: Kontext (warum), Aufgabe (was genau), Akzeptanzkriterium (wie prüfbar) und Abhängigkeiten (was muss vorher fertig sein).

Ab diesem Punkt ist das Issue die Quelle der Wahrheit (nicht der Chat, nicht dein Gedächtnis, nicht der Plan-Text). Die Issues landen im Backlog.

Zum Abschluss listet der Skill die angelegten Issues und gibt pro Issue eine Modell-Empfehlung (schnelleres Standard-Modell für mechanische Aufgaben, stärkstes verfügbares Modell für Architektur- oder Sicherheitslogik, jeweils mit einem Satz Begründung). So entscheidest du vor dem GO, mit welchem Modell du jedes Issue umsetzt, ohne den Plan-Kontext noch einmal zu lesen.

### Schritt 4: GO (menschlich)

Du ziehst die Issues, die du im aktuellen Batch umsetzen willst, am Board nach Ready. Das ist deine Entscheidung: wie viel Arbeit du freigibst und was in diesen Durchlauf kommt. Die KI zieht nie eigenmächtig Issues nach Ready.

### /implement-ready

**Schritt 5, nach dem GO.**

Der Skill liest die Ready-Spalte, sortiert nach Issue-Nummer und arbeitet sie sequenziell ab. Pro Issue: Board nach In progress bewegen, Issue vollständig lesen, Code und Tests gegen das Issue schreiben, lokal committen, Board nach In review bewegen. Dann das nächste Issue. Ist Ready leer, meldet der Skill Vollzug.

Zwei feste Grenzen: Der Skill pusht nie. Er zieht keine Backlog-Issues eigenmächtig nach Ready.

### /local-check

**Schritt 6, vor dem Review.**

Der Skill führt alle Kommandos aus `buildChecks` sequenziell aus und führt danach `mutationCommand` aus, sofern gesetzt. Bei Frontend-Änderungen erinnert er an die manuelle UI-Verifikation im Browser und vermerkt im Bericht, wenn diese nicht automatisch möglich war.

Die Ausgabe ist eine Checklist mit grünen Häkchen oder rotem Stopp. Ein roter Check blockiert den weiteren Prozess. Es gibt keine Ausnahmen und kein Übergehen.

### /review

**Schritt 7, nach dem lokalen Check.**

Der Skill öffnet eine neue Claude-Session ohne den Implementierungskontext der aktuellen Session. Ein Reviewer, der den Entstehungsweg nicht kennt, liest den Code als Fremder und sieht Probleme, die dem Implementierer nicht auffallen.

Je nach `reviewScope` bekommt der Reviewer den Diff oder alle Dateien im Repo (im Modell aus `reviewModel`). Die Befunde landen als Kommentar im Issue oder PR. Für Security-Muster, die einen korpusgetriebenen Ansatz erfordern (Secrets-Scan, SQL-Konkatenation, fehlendes Input-Validation), verlässt sich der Skill nicht allein auf das Modell. Diese Prüfungen gehören in dein CI.

### /push-main

**Schritt 8, nach dem Review, auf dein explizites Kommando.**

Pusht den aktuellen Commit-Batch auf den main-Branch. Diesen Skill tippst nur du. Er ist gegen autonome Invocation gesperrt und reagiert nur auf die explizite Trigger-Phrase. Eine frühere Push-Freigabe in derselben Session gilt nicht für neue Commits. Jeder Batch braucht eine eigene Freigabe.

Ein roter `/local-check` aus Schritt 6 blockiert diesen Schritt mechanisch: Du hast keinen grünen Pflicht-Check, also kein Push.

### Test-Server prüfen (menschlich, zwischen Schritt 8 und 9)

Nach dem Push zieht der Test-Server automatisch oder du deployest manuell. Du prüfst das Ergebnis im Browser: den Golden Path, kritische Edge Cases, keine sichtbaren Regressionen. Erst nach dieser Prüfung gehst du zu Schritt 9.

### /merge-production

**Schritt 9, nach der Test-Server-Prüfung, auf dein explizites Kommando.**

Erstellt einen Pull Request (GitHub) oder Merge Request (GitLab) von main nach production. Auch dieser Skill ist gegen autonome Invocation gesperrt. Den finalen Merge führst du selbst im PR/MR durch, denn du bist es, der auf dem Test-Server geprüft hat, dass das Ergebnis stimmt.

### Eigene Release-Schritte per RELEASING.md

`/push-main` und `/merge-production` prüfen bei jedem Lauf, ob eine `RELEASING.md` im Projekt-Root liegt. Falls ja, lesen sie diese Datei und führen den dort beschriebenen Ablauf aus, bevor gepusht bzw. der PR erstellt wird — zum Beispiel ein Versions-Bump-Kommando mit anschließendem Commit. Falls keine `RELEASING.md` existiert, wird dieser Schritt ersatzlos übersprungen.

Das ist eine reine Opt-in-Konvention, kein Kit-internes Feature: Jedes Projekt, das per `/push-main`/`/merge-production` arbeitet, kann so eigene Release-Schritte (Versionierung, Changelog-Pflege, was auch immer) andocken, ohne die generischen Skills zu forken. Das claude-workflow-kit-Repo selbst nutzt das für seine eigene Versionierung — siehe [RELEASING.md](https://github.com/mannewolff/claude-workflow-kit/blob/main/RELEASING.md) im Repo.

### /retro

**Querschnitts-Skill, Wartungsrhythmus (alle ein bis zwei Wochen).**

Die KI-Retrospektive ist kein Entwicklungszyklus-Schritt, sondern ein Wartungsschritt für den Prozess selbst. Drei Fragen: Wo hat die Mensch-KI-Zusammenarbeit gehakt? Welche Memory-Einträge sind veraltet oder falsch? Welche Workflow-Regel braucht eine Schärfung?

Der Output sind keine Erkenntnisse, sondern konkrete Änderungen an den Konventionsdateien und am Memory. Wenn eine Retrospektive keine Datei verändert, war sie zu abstrakt.

### /document

**Querschnitts-Skill, Session-Ende.**

Wenn ein Vault konfiguriert ist, schreibt der Skill einen Tageslog-Eintrag in `{vault}/Log/YYYY-MM-DD.md` mit dem, was heute entschieden und implementiert wurde, und aktualisiert den Zeitstempel in der Projektnotiz. Ohne Vault schreibt er in `docs/session-log/YYYY-MM-DD.md` im Projektverzeichnis.

Die Dokumentation entsteht nicht als nachträgliche Pflicht, sondern als automatischer Abschluss jeder Arbeitseinheit. Was nicht dokumentiert ist, existiert in der nächsten Session nicht mehr.

## Ein vollständiger Durchlauf

Du rufst `/kontext` auf, um mit einem frischen Lageüberblick in die Session zu starten.

**Schritte 1 und 2:** Du diktierst die Anforderung (Schritt 1) und rufst `/plan` (Schritt 2). Du liest den Plan, gibst Feedback und genehmigst ihn.

**Schritt 3:** Du rufst `/issues`. Die Issues landen im Backlog.

**Schritt 4 (GO):** Du ziehst die Issues, die du im aktuellen Batch umsetzen willst, am Board nach Ready. Das ist eine bewusste Entscheidung, nie eine stillschweigende Verschiebung durch die KI.

**Schritt 5:** Du rufst `/implement-ready`. Die KI arbeitet die Ready-Spalte ab, committet lokal und legt die Ergebnisse in In review.

**Schritt 6:** Du rufst `/local-check`. Alle Checks müssen grün sein.

**Schritt 7:** Du rufst `/review`. Ein frischer Blick ohne Entstehungskontext. Du liest das Review. Gibt es Befunde, die du adressieren willst, gehst du zurück zu Schritt 5.

**Schritt 8:** Du rufst `/push-main` (explizite Trigger-Phrase). Main ist jetzt aktuell.

**Zwischen Push und Merge:** Du prüfst das Ergebnis auf dem Test-Server im Browser.

**Schritt 9:** Stimmt alles, rufst du `/merge-production`. Der PR/MR wird erstellt, du mergst ihn selbst.

Zum Abschluss `/document`.

## Die drei menschlichen Stop-Punkte

**Schritt 4: das GO.** Du entscheidest, welche Issues in diesen Batch kommen. Darin liegt die Planung: wie viel Arbeit auf einmal, welche Priorität, welche Abhängigkeiten.

**Schritt 8: der Push.** Du veränderst den Test-Server. Jeder Batch braucht eine eigene Freigabe, weil zwischen Commit und Push die letzte Chance liegt, den Scope zu überdenken.

**Schritt 9: der Merge.** Du bringst Code nach production. Du hast auf dem Test-Server geprüft, du trägst die Verantwortung, du mergst.

Das Kit automatisiert diese drei nicht. Das ist kein fehlendes Feature. Es ist der Sinn des Kits: KI macht die Arbeit, Menschen treffen die Entscheidungen.

## Was bewusst nicht im Kit ist

**Security-Gates gehören ins CI, nicht in einen Skill.** gitleaks findet Secrets, Semgrep oder SpotBugs finden SQL-Konkatenation und fehlende Input-Validation. Ein deterministisches Tool teilt mit keinem Sprachmodell einen blinden Fleck. Ein roter Build blockiert den Push mechanisch, verlässlicher als jedes Modell. Der Review-Skill ergänzt diese Tools, ersetzt sie nicht.

**Kein Multi-Tool-Adapter.** Das Konzept ist übertragbar, das Format nicht. Codex liest `AGENTS.md`, Cursor `.cursor/rules`. Wenn du mehrere Engines einsetzen willst, brauchst du die Skill-Bibliothek in mehreren Formaten parallel im Repo. Das ist machbar, aber nicht Bestandteil dieses Kits.

## Issue-Tracker und Code-Host

Das Kit unterstützt GitHub, GitLab und einen vollständig lokalen Modus. Die Wahl erfolgt über zwei unabhängige Achsen: `codeHost` (für Pull Requests und Repo-Erkennung) und `issueTracker` (für Issues und Board-Bewegungen). Beide können auf verschiedene Plattformen zeigen.

### Voraussetzungen je nach Konfiguration

| Wert | CLI | Authentifizierung |
|------|-----|-------------------|
| `github` | `gh` (GitHub CLI) | `gh auth login` |
| `gitlab` | `glab` (GitLab CLI) | `glab auth login` |
| `local` | keine | keine |

### Board-Adapter

Alle Board-Operationen laufen über `.claude/kit/board.mjs`. Der Adapter hat zwei Hauptbereiche:

- **Issue-Tracker-Interface:** `issue create`, `issue list`, `issue get`, `issue move`, `issue comment`
- **Code-Host-Interface:** `code repo-name`, `code pr`

Die Skills rufen ausschließlich den Adapter auf — sie wissen nichts von `gh` oder `glab`. Du kannst `issueTracker` und `codeHost` jederzeit in der Config ändern; alle Skills passen sich beim nächsten Aufruf an.

### Lokaler Modus

Mit `issueTracker: local` legt der Adapter Issues als Markdown-Dateien in `issues/` an:

```
issues/
  0001.md
  0002.md
```

Jede Datei hat YAML-Frontmatter:

```markdown
---
id: 1
status: backlog
title: Beispiel-Issue
created: 2026-07-01
---

## Kontext
…

## Aufgabe
…

## Akzeptanzkriterium
…

## Abhängigkeiten
Keine.
```

Der Status (`backlog | ready | in_progress | in_review | done`) steht im Frontmatter. Kein Board-API, kein Label-Setup.

### Was sich bei GitLab unterscheidet

**Pull Request heisst Merge Request.** `/merge-production` erstellt bei GitLab einen Merge Request statt eines Pull Requests.

**Board-Status per Label.** GitLab bildet die fünf Spalten über Labels ab: `~Backlog`, `~Ready`, `~In Progress`, `~In Review`, `~Done`. Der Installer legt die Labels automatisch an, wenn du beim Setup "j" bestätigst. Die Board-Ansicht selbst (Issues → Boards → "Add list") musst du einmalig manuell in der GitLab-UI anlegen.

### Konfiguration einstellen

```json
{
  "codeHost": "github",
  "issueTracker": "local",
  ...
  "local": { "issuesDir": "issues" },
  "github": { "projectNumber": 11 }
}
```

Du kannst beide Felder jederzeit manuell ändern. Alle Skills lesen sie beim nächsten Aufruf.

## Aktualisieren und mehrere Projekte

Weil die Skills projekt-unabhängig sind und nur die Config projektlokal ist, aktualisierst du das Kit, indem du den Installer erneut laufen lässt. Deine Config bleibt erhalten (der Installer fragt dich, bevor er sie überschreibt).

In einem neuen Projekt brauchst du nur den Installer auszuführen oder die `workflow.config.json` aus einem bestehenden Projekt zu kopieren und die Branch-Namen anzupassen. Alle Skills sind sofort einsatzbereit.

## Troubleshooting

**Die Skills tauchen nicht in `/help` auf.**
Hast du Claude Code nach der Installation neu gestartet? Das Laden der Skills passiert beim Start. Prüfe außerdem, ob die Dateien im richtigen Verzeichnis liegen: `~/.claude/skills/` für globale Installation, `.claude/skills/` für projektlokale.

**`/implement-ready` tut nichts oder meldet "Ready ist leer".**
Mindestens ein Issue muss in der Ready-Spalte (GitHub) oder mit dem Label `~Ready` (GitLab) markiert sein. Der Skill arbeitet ausschließlich Ready ab, er zieht keine Issues aus Backlog nach vorn.

**`/review` bringt dünne oder zu allgemeine Befunde.**
Prüfe `reviewScope` in der Config. Bei `diff` sieht der Reviewer nur die geänderten Zeilen. Für größere Refactorings stelle auf `full` um. Bei sehr großen Repos kann `full` das Kontextfenster überlasten; dann besser `diff` mit manuell ausgewählten Dateipfaden im Review-Prompt ergänzen.

**`/push-main` passiert nicht oder die KI fragt nicht danach.**
Der Skill ist gegen autonome Invocation gesperrt. Du musst die exakte Trigger-Phrase tippen (standardmäßig `push main`). Eine frühere Freigabe in derselben Session gilt nicht für neue Commits.

**`/kontext` oder `/document` meldet einen Fehler.**
Prüfe, ob `kontext.config.json` vorhanden ist (global in `~/.claude/` oder lokal in `.claude/`). Beide Skills laufen auch ohne Vault im Degraded Mode. Nutzt du `codeHost: github` oder `issueTracker: github`, muss `gh` authentifiziert sein. Nutzt du `gitlab`, braucht `glab` `auth login`. Im lokalen Modus gibt es keine externe CLI-Abhängigkeit.

## kontext.config.json: Referenz

Konfiguriert den `/kontext`-Skill (Session-Start) und den `/document`-Skill (Session-Ende). Beide lesen dieselbe Datei, damit du Vault-Pfad und always-Dateien nur einmal angibst.

### Warum zwei Config-Dateien?

`workflow.config.json` ist repo-spezifisch: Build-Kommandos, Branch-Namen, Review-Modell. Sie gehört ins Repo und wird mit dem Team geteilt. Jeder, der das Repo klont, hat dieselbe Prozessgrundlage.

`kontext.config.json` ist personenbezogen: dein Memory-Vault, deine always-Dateien. Sie zeigt auf deine lokale Infrastruktur und gehört nicht ins Repo. Zwei Entwickler im selben Repo haben unterschiedliche Vaults und unterschiedliche Profil-Dateien.

### Speicherorte

| Pfad | Zweck |
|------|-------|
| `~/.claude/kontext.config.json` | Global, gilt für alle Projekte auf diesem Rechner |
| `.claude/kontext.config.json` | Projektlokal, überschreibt einzelne Felder der globalen Config |

Die Dateien werden gemergt. Felder, die in der lokalen Config nicht stehen, werden von der globalen geerbt. Wenn keine Config gefunden wird, laufen `/kontext` und `/document` im Degraded Mode.

### Felder

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|--------------|
| `vault` | `string` | optional | Absoluter Pfad zum Memory-Vault. Ohne dieses Feld läuft der Skill im Degraded Mode. |
| `always` | `string[]` | optional | Dateien relativ zum `vault`-Root, die immer gelesen werden (z.B. Profil, Arbeitsregeln) |
| `projectDocs` | `string[]` | optional | Dateien oder Glob-Muster relativ zum Projektverzeichnis. Fallback: `["CLAUDE-*", ".claude/CLAUDE-*"]` |
| `project` | `string` | optional | Override für den Vault-Projektnamen, nur nötig wenn Repo-Name und Vault-Ordnername voneinander abweichen |

### Was passiert ohne Vault?

Wenn `vault` nicht gesetzt ist oder keine Config-Datei gefunden wird, laufen beide Skills im Degraded Mode weiter:

`/kontext` lädt offene Issues per CLI und liest `projectDocs` aus dem Repo. Am Ende erscheint ein Hinweis: "Kein Vault konfiguriert, arbeite ohne persistentes Memory."

`/document` schreibt den Tageslog in `docs/session-log/YYYY-MM-DD.md` im Projektverzeichnis. Am Ende: "Kein Vault konfiguriert. Log ins Projektverzeichnis geschrieben."

Der Degraded Mode ist der richtige Einstieg, wenn du das Kit ausprobieren willst ohne vorher eine Vault-Infrastruktur aufzusetzen. Für dauerhaftes projektübergreifendes Memory trägst du den `vault`-Pfad in `~/.claude/kontext.config.json` ein.

### Glob-Muster in projectDocs

`projectDocs` unterstützt Glob-Muster. Der Skill expandiert sie per `find` im Projektverzeichnis:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
find .claude -maxdepth 1 -name "CLAUDE-*" -type f
```

Muster ohne Treffer werden stillschweigend übersprungen (kein Fehler, kein Abbruch).

### Projektnotiz auto-detektieren

Der Skill ermittelt die aktive Projektnotiz automatisch aus dem Repo-Namen:

```bash
node .claude/kit/board.mjs code repo-name
```

Der Board-Adapter gibt `{ "repoName": "owner/repo" }` zurück. Das letzte Segment (`repo`) wird als Projektname genutzt. Wenn Repo-Name und Vault-Ordnername nicht übereinstimmen, trägst du den korrekten Namen als `project`-Feld in der lokalen Config ein.

### Beispiele

Globale Config (einmal anlegen, gilt auf diesem Rechner für alle Projekte):

```json
{
  "vault": "/pfad/zu/deinem/memory-vault",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

Lokale Config (nur anlegen, wenn Repo-Name und Vault-Projektname voneinander abweichen):

```json
{
  "project": "MeinProjekt"
}
```

## Lizenz

MIT. Das Kit ist frei verwendbar, veränderbar und weitergabe-fähig.
