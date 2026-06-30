# Dokumentation: claude-workflow-kit

Eine dünne Werkzeugschicht, die einen 9-Schritt-Kernprozess für KI-gestützte Entwicklung in Claude Code ausführbar macht. Das Kit automatisiert die KI-Schritte und lässt die drei menschlichen Verantwortungsschwellen bewusst stehen.

## Konzept

Das Kit ist keine Plattform und kein Agent. Es ist eine Bibliothek aus zehn Skills, eine projektlokale Config und ein Installer.

Die Skills sind projekt-unabhängig geschrieben. Alles Projekt-Spezifische (Build-Kommandos, Branch-Namen, Review-Modell) kommt aus der Config-Datei. Ein Update an einem Skill gilt damit in allen Projekten, in denen du das Kit nutzt. Du musst nicht in jedem Repo etwas anpassen, wenn sich der Prozess weiterentwickelt.

Der Kernprozess hat neun Schritte. Die KI übernimmt Schritte 1, 2, 4, 5 und 6. Die drei menschlichen Stop-Punkte sind Schritt 3 (GO), Schritt 7 (Push) und Schritt 9 (Merge). Schritt 8 (Test-Server prüfen) ist ebenfalls menschlich. Drei weitere Skills stehen außerhalb der Nummerierung und strukturieren den Arbeitsrhythmus: /kontext, /retro und /document.

## Voraussetzungen

**Node.js 18 oder neuer.** Der Installer ist in Node geschrieben und läuft damit auf Mac, Windows und Linux ohne Abhängigkeit zu einem bestimmten Shell-Ökosystem.

**git.** Claude Code und der gesamte Prozess setzen git voraus. Ohne git-Repository funktioniert kein Skill.

**Claude Code in einer aktuellen Version.** Die Skills nutzen das Skills-System von Claude Code. Ältere Versionen kennen dieses System möglicherweise nicht.

**Eine Issue-und-Board-CLI, authentifiziert.** Das Kit legt Issues an, bewegt Board-Karten und liest den Repo-Namen. Je nach Provider brauchst du `gh` (GitHub CLI) oder `glab` (GitLab CLI). Beide müssen einmalig per `auth login` authentifiziert werden.

**Ein Projekt-Board mit fünf Spalten.** Das Board braucht diese fünf Spalten: Backlog, Ready, In Progress, In Review, Done. Bei GitHub sind das Projekt-Board-Spalten, bei GitLab werden sie durch Labels abgebildet. Die Namen sind case-sensitiv.

**`kontext.config.json` für /kontext und /document (optional).** Beide Skills laufen auch ohne diese Datei im Degraded Mode. Wenn du persistentes projektübergreifendes Memory willst, legst du die Config manuell an. Der Installer erzeugt sie nicht automatisch. Details im Abschnitt [kontext.config.json](#kontext-config-json-referenz).

## Installation

Wechsle in deinen Projektordner und führe aus:

```bash
npx claude-workflow-kit
```

Alternativ kannst du den Installer herunterladen und direkt starten:

```bash
curl -O https://mwolff.org/claude-workflow-kit/install.mjs
node install.mjs
```

Oder in einem Schritt ohne lokale Datei:

```bash
node <(curl -s https://mwolff.org/claude-workflow-kit/install.mjs)
```

Der Installer stellt fünf Fragen:

**1. Global oder projektlokal.** Global legt die Skills in `~/.claude/skills/` ab. Sie stehen dann in allen deinen Projekten zur Verfügung. Projektlokal legt sie in `./.claude/skills/` ab. Sie gehören zum Repo und werden über git mit dem Team geteilt. Für teamverbindliche Prozesse wähle projektlokal, für die persönliche Nutzung global.

**2. Name des main-Branch.** In den meisten Repos `main`, manchmal `develop` oder `master`. Dieser Branch ist das Ziel von /push-main.

**3. Name des production-Branch.** Oft `production` oder `release`. /merge-production erstellt einen PR oder MR von main auf diesen Branch.

**4. Review-Umfang (`diff` oder `full`).** Mit `diff` bekommt der Review-Skill nur die geänderten Zeilen zu sehen. Mit `full` alle Dateien im Repo. Für kleine Änderungen reicht `diff`. Für größere Refactorings ist `full` aussagekräftiger, kann aber bei sehr großen Repos das Kontextfenster überlasten.

**5. Review-Modell.** Das Modell, das in der frischen Review-Session läuft. Standard ist `claude-opus-4-8` (das leistungsstärkste Modell für unabhängige Code-Reviews).

Der Installer kopiert die zehn Skills, schreibt eine `.claude/workflow.config.json` mit deinen Antworten und legt eine `CLAUDE-workflow.md` mit der Prozessbeschreibung ab. Bei GitLab fragt er zusätzlich, ob er die fünf Labels (Backlog, Ready, In Progress, In Review, Done) automatisch anlegen soll. Bei "j" legt er sie per `glab label create` direkt im aktuellen Projekt an. Damit das klappt, muss das Repository vorher existieren und du musst im geklonten Verzeichnis sein. Kein Hintergrundprozess, kein Service, keine Registry-Einträge.

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
  "provider": "github",
  "buildChecks": ["<dein build-kommando>", "<dein test-kommando>"],
  "mutationCommand": "",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" }
}
```

`provider` steuert, ob das Kit `gh` (GitHub) oder `glab` (GitLab) nutzt. `buildChecks` enthält die Kommandos, die `/local-check` sequenziell ausführt. Alle müssen grün sein, bevor der Skill Vollzug meldet. `mutationCommand` ist aus `buildChecks` ausgelagert, weil Mutation Testing deutlich länger läuft und du es manchmal separat ziehen willst (ein leerer String deaktiviert es). `reviewScope` steuert den Umfang für `/review`. `reviewModel` pinnt das Modell über Sessiongrenzen hinweg. `triggers` hält die natürlichsprachlichen Phrasen, falls du lieber tippst als Slash-Befehle nutzt.

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
| 1 | Anforderung planen | KI | /plan |
| 2 | Issues anlegen | KI | /issues |
| **3** | **GO: Issues nach Ready ziehen** | **Mensch** | (kein Skill) |
| 4 | Ready-Issues implementieren | KI | /implement-ready |
| 5 | Lokale Checks ausführen | KI | /local-check |
| 6 | Review durchführen | KI | /review |
| **7** | **Push auf main** | **Mensch** | /push-main |
| **8** | **Test-Server prüfen** | **Mensch** | (kein Skill) |
| **9** | **Merge nach production** | **Mensch** | /merge-production |

Querschnitts-Skills: /kontext (Session-Start), /retro (Wartungsrhythmus), /document (Session-Ende).

### /kontext

**Querschnitts-Skill, Session-Start.**

Der Skill lädt den Kontext, den du brauchst, um sofort arbeitsfähig zu sein, ohne den Chat der letzten Session im Kopf haben zu müssen. Er liest `kontext.config.json` (zuerst global aus `~/.claude/`, dann lokal aus `.claude/`, wobei lokale Werte die globalen überschreiben).

Wenn ein Vault konfiguriert ist, lädt er die `always`-Dateien daraus (Profil, Arbeitsregeln), erkennt die Projektnotiz automatisch anhand des Repo-Namens und liest zusätzliche `projectDocs`. Ohne Vault holt er die offenen Issues per CLI und liest `projectDocs` aus dem Repo. Die Ausgabe ist ein kurzer Lageüberblick: offene Issues, letzte Entscheidungen, was als nächstes ansteht.

### /plan

**Schritt 1, nach der Anforderung, vor der Implementierung.**

Du gibst die Anforderung, der Skill erzeugt einen Plan. Der Plan benennt Ziel und Nutzerwirkung, betroffene Bereiche und Dateien, architektonische Entscheidungen mit Begründung, offene Fragen und die geplante Verifizierung. Anschließend stellt er den Plan zur Diskussion.

Der Skill implementiert nichts. Er stellt keine Issues an. Er wartet auf dein Feedback. Der Plan ist Diskussionsgrundlage, kein Auftrag und noch keine Freigabe.

### /issues

**Schritt 2, nach der Plan-Freigabe.**

Aus dem freigegebenen Plan werden ein oder mehrere Issues. Jedes Issue ist kleinteilig genug, um eigenständig getestet zu werden, und enthält vier Abschnitte: Kontext (warum), Aufgabe (was genau), Akzeptanzkriterium (wie prüfbar) und Abhängigkeiten (was muss vorher fertig sein).

Ab diesem Punkt ist das Issue die Quelle der Wahrheit (nicht der Chat, nicht dein Gedächtnis, nicht der Plan-Text). Die Issues landen im Backlog.

### Schritt 3: GO (menschlich)

Du ziehst die Issues, die du im aktuellen Batch umsetzen willst, am Board nach Ready. Das ist deine Entscheidung: wie viel Arbeit du freigibst und was in diesen Durchlauf kommt. Die KI zieht nie eigenmächtig Issues nach Ready.

### /implement-ready

**Schritt 4, nach dem GO.**

Der Skill liest die Ready-Spalte, sortiert nach Issue-Nummer und arbeitet sie sequenziell ab. Pro Issue: Board nach In progress bewegen, Issue vollständig lesen, Code und Tests gegen das Issue schreiben, lokal committen, Board nach In review bewegen. Dann das nächste Issue. Ist Ready leer, meldet der Skill Vollzug.

Zwei feste Grenzen: Der Skill pusht nie. Er zieht keine Backlog-Issues eigenmächtig nach Ready.

### /local-check

**Schritt 5, vor dem Review.**

Der Skill führt alle Kommandos aus `buildChecks` sequenziell aus und führt danach `mutationCommand` aus, sofern gesetzt. Bei Frontend-Änderungen erinnert er an die manuelle UI-Verifikation im Browser und vermerkt im Bericht, wenn diese nicht automatisch möglich war.

Die Ausgabe ist eine Checklist mit grünen Häkchen oder rotem Stopp. Ein roter Check blockiert den weiteren Prozess. Es gibt keine Ausnahmen und kein Übergehen.

### /review

**Schritt 6, nach dem lokalen Check.**

Der Skill öffnet eine neue Claude-Session ohne den Implementierungskontext der aktuellen Session. Ein Reviewer, der den Entstehungsweg nicht kennt, liest den Code als Fremder und sieht Probleme, die dem Implementierer nicht auffallen.

Je nach `reviewScope` bekommt der Reviewer den Diff oder alle Dateien im Repo (im Modell aus `reviewModel`). Die Befunde landen als Kommentar im Issue oder PR. Für Security-Muster, die einen korpusgetriebenen Ansatz erfordern (Secrets-Scan, SQL-Konkatenation, fehlendes Input-Validation), verlässt sich der Skill nicht allein auf das Modell. Diese Prüfungen gehören in dein CI.

### /push-main

**Schritt 7, nach dem Review, auf dein explizites Kommando.**

Pusht den aktuellen Commit-Batch auf den main-Branch. Diesen Skill tippst nur du. Er ist gegen autonome Invocation gesperrt und reagiert nur auf die explizite Trigger-Phrase. Eine frühere Push-Freigabe in derselben Session gilt nicht für neue Commits. Jeder Batch braucht eine eigene Freigabe.

Ein roter `/local-check` aus Schritt 5 blockiert diesen Schritt mechanisch: Du hast keinen grünen Pflicht-Check, also kein Push.

### Schritt 8: Test-Server prüfen (menschlich)

Nach dem Push zieht der Test-Server automatisch oder du deployest manuell. Du prüfst das Ergebnis im Browser: den Golden Path, kritische Edge Cases, keine sichtbaren Regressionen. Erst nach dieser Prüfung gehst du zu Schritt 9.

### /merge-production

**Schritt 9, nach der Test-Server-Prüfung, auf dein explizites Kommando.**

Erstellt einen Pull Request (GitHub) oder Merge Request (GitLab) von main nach production. Auch dieser Skill ist gegen autonome Invocation gesperrt. Den finalen Merge führst du selbst im PR/MR durch, denn du bist es, der auf dem Test-Server geprüft hat, dass das Ergebnis stimmt.

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

**Schritt 1:** Du diktierst die Anforderung und rufst `/plan`. Du liest den Plan, gibst Feedback und genehmigst ihn.

**Schritt 2:** Du rufst `/issues`. Die Issues landen im Backlog.

**Schritt 3 (GO):** Du ziehst die Issues, die du im aktuellen Batch umsetzen willst, am Board nach Ready. Das ist eine bewusste Entscheidung, nie eine stillschweigende Verschiebung durch die KI.

**Schritt 4:** Du rufst `/implement-ready`. Die KI arbeitet die Ready-Spalte ab, committet lokal und legt die Ergebnisse in In review.

**Schritt 5:** Du rufst `/local-check`. Alle Checks müssen grün sein.

**Schritt 6:** Du rufst `/review`. Ein frischer Blick ohne Entstehungskontext. Du liest das Review. Gibt es Befunde, die du adressieren willst, gehst du zurück zu Schritt 4.

**Schritt 7:** Du rufst `/push-main` (explizite Trigger-Phrase). Main ist jetzt aktuell.

**Schritt 8:** Du prüfst das Ergebnis auf dem Test-Server im Browser.

**Schritt 9:** Stimmt alles, rufst du `/merge-production`. Der PR/MR wird erstellt, du mergst ihn selbst.

Zum Abschluss `/document`.

## Die drei menschlichen Stop-Punkte

**Schritt 3: das GO.** Du entscheidest, welche Issues in diesen Batch kommen. Darin liegt die Planung: wie viel Arbeit auf einmal, welche Priorität, welche Abhängigkeiten.

**Schritt 7: der Push.** Du veränderst den Test-Server. Jeder Batch braucht eine eigene Freigabe, weil zwischen Commit und Push die letzte Chance liegt, den Scope zu überdenken.

**Schritt 9: der Merge.** Du bringst Code nach production. Du hast auf dem Test-Server geprüft, du trägst die Verantwortung, du mergst.

Das Kit automatisiert diese drei nicht. Das ist kein fehlendes Feature. Es ist der Sinn des Kits: KI macht die Arbeit, Menschen treffen die Entscheidungen.

## Was bewusst nicht im Kit ist

**Security-Gates gehören ins CI, nicht in einen Skill.** gitleaks findet Secrets, Semgrep oder SpotBugs finden SQL-Konkatenation und fehlende Input-Validation. Ein deterministisches Tool teilt mit keinem Sprachmodell einen blinden Fleck. Ein roter Build blockiert den Push mechanisch, verlässlicher als jedes Modell. Der Review-Skill ergänzt diese Tools, ersetzt sie nicht.

**Kein Multi-Tool-Adapter.** Das Konzept ist übertragbar, das Format nicht. Codex liest `AGENTS.md`, Cursor `.cursor/rules`. Wenn du mehrere Engines einsetzen willst, brauchst du die Skill-Bibliothek in mehreren Formaten parallel im Repo. Das ist machbar, aber nicht Bestandteil dieses Kits.

## GitHub oder GitLab

Das Kit unterstützt beide Plattformen. Du wählst beim Installer, mit welchem Provider du arbeitest.

### Voraussetzungen je nach Provider

| Provider | CLI | Authentifizierung |
|----------|-----|-------------------|
| GitHub | `gh` (GitHub CLI) | `gh auth login` |
| GitLab | `glab` (GitLab CLI) | `glab auth login` |

Installiere die jeweilige CLI vor dem ersten Einsatz.

### Was sich bei GitLab unterscheidet

**Pull Request heisst Merge Request.** `/merge-production` erstellt bei GitLab einen Merge Request statt eines Pull Requests. Das Ergebnis ist dasselbe.

**Board-Status per Label, nicht per Board-Karte.** GitHub Projects hat eine API, über die das Kit die Board-Spalten direkt setzt. GitLab bietet das per CLI noch nicht vollständig. Das Kit bildet die fünf Spalten stattdessen über Labels ab: `~Backlog`, `~Ready`, `~In Progress`, `~In Review`, `~Done`. Die Bewegung der Issues zwischen den Spalten bleibt dieselbe, sie ist nur nicht als visuelle Board-Karte sichtbar, sondern als Label am Issue.

Der Installer legt die fünf Labels automatisch an, wenn du beim Setup-Schritt "j" bestätigst. Das Repository muss dafür bereits existieren und du musst im geklonten Verzeichnis sein, damit `glab` das richtige Projekt erkennt. Die Board-Spalten selbst (Issues → Boards → "Add list") musst du einmalig manuell in der GitLab-UI anlegen.

**Repo-Erkennung per git remote.** `/kontext` und `/document` ermitteln den Projekt-Namen bei GitLab über `git remote get-url origin` statt über die GitHub-API.

### Provider einstellen

Der Installer fragt beim Setup nach dem Provider:

```
GitHub oder GitLab? [github/gitlab]: gitlab
```

Der Wert wird in `.claude/workflow.config.json` geschrieben:

```json
{
  "provider": "gitlab",
  "buildChecks": ["<dein build-kommando>"],
  ...
}
```

Du kannst den Wert jederzeit manuell ändern. Alle Skills lesen ihn beim nächsten Aufruf.

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
Prüfe, ob `kontext.config.json` vorhanden ist (global in `~/.claude/` oder lokal in `.claude/`). Beide Skills laufen auch ohne Vault im Degraded Mode, brauchen aber eine erreichbare CLI. Ist `gh` oder `glab` nicht authentifiziert, schlägt der Skill früh fehl.

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
gh repo view --json name --jq '.name'   # GitHub
git remote get-url origin               # GitLab (Fallback)
```

Ergebnis `{name}` sucht `{vault}/Projekte/{name}/{name}.md`. Wenn Repo-Name und Vault-Ordnername nicht übereinstimmen, trägst du den korrekten Namen als `project`-Feld in der lokalen Config ein.

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
